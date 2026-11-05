#!/usr/bin/env node
/**
 * ForgeERP Tally Connector (PoC) — v0.1.0
 * ---------------------------------------------------------------------------
 * Zero-dependency Node 18+ script you run ON THE TALLY MACHINE. It polls
 * ForgeERP for queued voucher exports and imports them into the local
 * TallyPrime via its XML-over-HTTP interface (port 9000).
 *
 *   node forge-tally-connector.mjs pair --server https://your-forge-erp --code ABCDE-FGHJK
 *   node forge-tally-connector.mjs run          # polling loop (Ctrl+C to stop)
 *   node forge-tally-connector.mjs status
 *   node forge-tally-connector.mjs forget       # wipe the local token
 *
 * Config lives in:
 *   Windows : %APPDATA%\ForgeTallyConnector\connector.json
 *   macOS   : ~/Library/Application Support/ForgeTallyConnector/
 *   Linux   : $XDG_CONFIG_HOME/forge-tally-connector/
 *
 * Notes:
 *  - The token is written once at pairing and never printed again.
 *  - TallyPrime must be open with "TallyPrime acts as: Both" (port 9000).
 *  - PoC status: pairing/poll/result flow is real; tested against mock
 *    servers, not a production TallyPrime install.
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'

const VERSION = '0.1.0-poc'
const DEFAULT_TALLY = 'http://127.0.0.1:9000'
const POLL_SEC = 15

// ---------- config ----------

function configDir() {
  if (process.env.FORGE_CONNECTOR_CONFIG) return process.env.FORGE_CONNECTOR_CONFIG
  if (platform() === 'win32') return join(process.env.APPDATA ?? homedir(), 'ForgeTallyConnector')
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'ForgeTallyConnector')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'forge-tally-connector')
}

function configPath() {
  return join(configDir(), 'connector.json')
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {
    return null
  }
}

function saveConfig(cfg) {
  mkdirSync(configDir(), { recursive: true })
  const tmp = configPath() + '.tmp'
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  renameSync(tmp, configPath())
}

function forgetConfig() {
  if (existsSync(configPath())) renameSync(configPath(), configPath() + '.bak')
}

// ---------- http ----------

async function serverPost(server, path, body, token) {
  const res = await fetch(server.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) throw new Error(json?.error ?? `server ${res.status}`)
  return json.data
}

async function serverGet(server, path, token) {
  const res = await fetch(server.replace(/\/$/, '') + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) throw new Error(json?.error ?? `server ${res.status}`)
  return json.data
}

async function postToTally(tallyUrl, xml) {
  const res = await fetch(tallyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  return text
}

function parseImportResult(xml) {
  const pick = (tag) => {
    const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))
    return m ? Number(m[1]) : 0
  }
  return {
    created: pick('CREATED'),
    altered: pick('ALTERED'),
    errors: pick('ERRORS'),
    exceptions: pick('EXCEPTIONS'),
    lineErrors: (xml.match(/<LINEERROR>([^<]*)<\/LINEERROR>/gi) ?? []).slice(0, 10),
  }
}

// ---------- commands ----------

async function cmdPair(args) {
  const server = args.server
  const code = args.code
  if (!server || !code) {
    console.error('Usage: pair --server <ForgeERP base URL> --code <PAIRING-CODE> [--tally http://127.0.0.1:9000]')
    process.exit(1)
  }
  const data = await serverPost(server, '/api/tally/connector', { action: 'pair', code, version: VERSION, platform: `${platform()}/node${process.versions.node}` })
  if (!data?.token) throw new Error('server did not return a token')
  saveConfig({ server, token: data.token, tally: args.tally ?? DEFAULT_TALLY, pairedAt: new Date().toISOString() })
  console.log('Paired. Token saved to ' + configPath())
  console.log('Now run: node forge-tally-connector.mjs run')
}

async function cmdRun() {
  const cfg = loadConfig()
  if (!cfg) {
    console.error('Not paired. Run the pair command first.')
    process.exit(1)
  }
  console.log(`ForgeERP Tally connector v${VERSION} — polling ${cfg.server} every ${POLL_SEC}s, posting to ${cfg.tally}`)
  console.log('Press Ctrl+C to stop.\n')
  for (;;) {
    try {
      const data = await serverGet(cfg.server, '/api/tally/connector?mode=pending', cfg.token)
      if (data?.job) {
        const { jobId, docNo, xml } = data.job
        console.log(`[${new Date().toLocaleTimeString()}] importing ${docNo} into Tally…`)
        try {
          const respXml = await postToTally(cfg.tally, xml)
          const r = parseImportResult(respXml)
          const ok = r.errors === 0 && r.exceptions === 0
          console.log(`  ${ok ? 'OK' : 'FAILED'} — created=${r.created} altered=${r.altered} errors=${r.errors}${r.lineErrors.length ? '\n  ' + r.lineErrors.join('\n  ') : ''}`)
          await serverPost(cfg.server, '/api/tally/connector', { action: 'result', jobId, ok, created: r.created, altered: r.altered, errors: r.errors + r.exceptions, errorText: r.lineErrors.join(' | ').slice(0, 300) }, cfg.token)
        } catch (e) {
          console.log('  Tally unreachable:', e.message)
          await serverPost(cfg.server, '/api/tally/connector', { action: 'result', jobId, ok: false, errors: 1, errorText: String(e.message).slice(0, 300) }, cfg.token).catch(() => {})
        }
      }
    } catch (e) {
      if (String(e.message).includes('token')) {
        console.error('Connector disconnected in ForgeERP (token revoked). Re-pair to continue.')
        forgetConfig()
        process.exit(1)
      }
      console.error('poll failed:', e.message)
    }
    await new Promise((r) => setTimeout(r, POLL_SEC * 1000))
  }
}

async function cmdStatus() {
  const cfg = loadConfig()
  if (!cfg) {
    console.log('Not paired.')
    return
  }
  try {
    const s = await serverGet(cfg.server, '/api/tally/connector', null)
    console.log('Server says:', JSON.stringify({ paired: s.paired, online: s.online, pending: s.pending }, null, 2))
  } catch {
    console.log('Server unreachable.')
  }
  console.log('Local config:', { server: cfg.server, tally: cfg.tally, pairedAt: cfg.pairedAt })
}

// ---------- main ----------

const [cmd, ...rest] = process.argv.slice(2)
const args = {}
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') ? true : rest[i + 1]
}

try {
  if (cmd === 'pair') await cmdPair(args)
  else if (cmd === 'run') await cmdRun()
  else if (cmd === 'status') await cmdStatus()
  else if (cmd === 'forget') { forgetConfig(); console.log('Local token wiped.') }
  else {
    console.log(`ForgeERP Tally connector v${VERSION}\n\nCommands:\n  pair --server <url> --code <CODE> [--tally <url>]\n  run\n  status\n  forget`)
  }
} catch (e) {
  console.error('[X]', e.message)
  process.exit(1)
}
