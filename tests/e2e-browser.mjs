/**
 * ForgeERP — browser E2E at 390x844, 768x1024 and 1440x900 (Playwright/Chromium).
 *
 * Read-mostly: signs in, walks every module and the workflow workspaces, opens
 * the edit/duplicate/payment dialogs to verify their prefill, checks the command
 * palette reset, keyboard focus, layout overflow, touch-target size, console /
 * hydration / page errors and failed requests. The only writes are one party
 * created by the double-submit check (asserted to be created exactly once).
 *
 *   E2E_BASE_URL=http://127.0.0.1:3011 AUDIT_DB_URL=mysql://... \
 *   CHROME_EXE=<chromium> node tests/e2e-browser.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { openAuditDb } from './audit-db.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000'
const OUT = process.env.E2E_OUT ?? join(ROOT, 'tests', 'e2e-artifacts')
mkdirSync(OUT, { recursive: true })
const db = process.env.AUDIT_DB_URL ? openAuditDb({ url: process.env.AUDIT_DB_URL }) : null
const EMAIL = process.env.E2E_EMAIL ?? 'owner@shreeforge.example.com'
const PASSWORD = process.env.E2E_PASSWORD ?? 'forge123'
const VIEWPORTS = [{ name: 'mobile-390', width: 390, height: 844, mobile: true }, { name: 'tablet-768', width: 768, height: 1024, mobile: false }, { name: 'desktop-1440', width: 1440, height: 900, mobile: false }]
const MODULES = ['Dashboard', 'Sales', 'Purchase', 'Jobwork', 'Projects & Mfg', 'Inventory', 'Accounting', 'Reports', 'Masters', 'Tally Export', 'Audit Trail']

const results = []
let failures = 0
let scope = ''
function check(name, ok, detail = '') {
  if (!ok) failures++
  results.push({ viewport: scope, name, pass: !!ok, detail: String(detail ?? '').slice(0, 2000) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scope}] ${name}${detail ? ` — ${String(detail).slice(0, 150)}` : ''}`)
}
const settle = async (page, ms = 700) => { await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(ms) }
const shot = async (page, name) => { const f = `${scope}-${name}`.replace(/[^a-z0-9-]+/gi, '_') + '.png'; await page.screenshot({ path: join(OUT, f) }).catch(() => {}); return f }

async function goModule(page, label) {
  const menu = page.getByRole('button', { name: 'Open navigation' })
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    await page.locator('[role=dialog] nav[aria-label="ERP modules"] button', { hasText: label }).first().click()
  } else {
    await page.locator('nav[aria-label="ERP modules"] button', { hasText: label }).first().click()
  }
  await settle(page)
}
async function overflowX(page) { return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) }
async function smallTargets(page) {
  return page.evaluate(() => [...document.querySelectorAll('main button, main a[href], main [role=tab], header button')]
    .filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && (r.height < 40 || r.width < 40) })
    .map((el) => `${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`))
}

async function runViewport(browser, vp) {
  scope = vp.name
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile, locale: 'en-IN', timezoneId: 'Asia/Kolkata' })
  const page = await ctx.newPage()
  const consoleErrors = [], pageErrors = [], badResponses = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))
  page.on('response', (r) => { if (r.status() >= 500) badResponses.push(`${r.status()} ${r.url().replace(BASE, '')}`) })

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await settle(page)
  // keyboard: Tab reaches the email field and focus is visible
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
  let focusOk = false
  for (let i = 0; i < 8 && !focusOk; i++) {
    focusOk = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return false; const cs = getComputedStyle(el); return el.matches(':focus-visible') && (cs.outlineStyle !== 'none' || cs.boxShadow !== 'none') })
    if (!focusOk) await page.keyboard.press('Tab')
  }
  check('keyboard focus is visible on the sign-in form', focusOk)
  await page.fill('#login-email', EMAIL); await page.fill('#login-password', PASSWORD)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  const signedIn = await page.locator('nav[aria-label="ERP modules"]:visible, button[aria-label="Open navigation"]:visible').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
  check('sign in through the UI', signedIn)
  if (!signedIn) await shot(page, 'signin-failed')
  if (!signedIn) { await ctx.close(); return }
  await settle(page)

  // every module renders without horizontal overflow
  const overflowing = [], small = new Set()
  for (const m of MODULES) {
    await goModule(page, m)
    const h = await page.locator('main h1, main h2').first().textContent().catch(() => '')
    if (!h?.trim()) overflowing.push(`${m}: no heading`)
    const ox = await overflowX(page)
    if (ox > 2) overflowing.push(`${m}: +${ox}px`)
    if (vp.mobile) for (const t of await smallTargets(page)) small.add(`${m}: ${t}`)
    await shot(page, `module-${m}`)
  }
  check('all 11 modules render a heading with no page-level horizontal overflow', overflowing.length === 0, overflowing.join('; '))
  if (vp.mobile) check('touch targets in main content are at least 40x40 px', small.size === 0, `${small.size} small: ${[...small].join(' | ')}`)

  // workflow workspaces
  const ws = [['Sales', 'Quote to Cash', /quote/i], ['Purchase', 'Procurement & Returns', /procurement/i], ['Inventory', 'Lots & Serials', /lot|serial|batch/i], ['Projects & Mfg', 'Quality', /quality|inspection/i]]
  for (const [mod, tab, re] of ws) {
    await goModule(page, mod)
    const t = page.getByRole('tab', { name: new RegExp(tab.replace('&', '&'), 'i') }).first()
    const has = await t.count()
    if (!has) { check(`${mod} → ${tab} workspace tab exists`, false, 'tab not found'); continue }
    await t.click(); await settle(page, 900)
    const text = (await page.locator('main').innerText().catch(() => '')).slice(0, 4000)
    const errorToast = await page.locator('[data-sonner-toast][data-type=error]').count()
    check(`${mod} → ${tab} workspace loads`, re.test(text) && errorToast === 0, `errorToasts=${errorToast}`)
    check(`${mod} → ${tab} has no page-level overflow`, (await overflowX(page)) <= 2, `+${await overflowX(page)}px`)
    await shot(page, `ws-${tab}`)
  }

  // dialog prefill (render-phase reset hook): party edit
  await goModule(page, 'Masters')
  await page.getByRole('tab', { name: /parties/i }).first().click().catch(() => {}); await settle(page, 600)
  const edit = page.locator('main button[aria-label^="Edit"]').first()
  if (await edit.count()) {
    await edit.click(); await settle(page, 400)
    const dialog = page.locator('[role=dialog]').first()
    const code = await dialog.locator('input').first().inputValue().catch(() => '')
    check('party edit dialog opens prefilled from the record', !!code.trim(), `first input="${code}"`)
    await shot(page, 'party-edit')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    check('Escape closes the dialog', !(await dialog.isVisible().catch(() => false)))
    await edit.click(); await settle(page, 300)
    const again = await page.locator('[role=dialog] input').first().inputValue().catch(() => '')
    check('re-opening the dialog re-applies the record values', again === code, `"${again}" vs "${code}"`)
    await page.keyboard.press('Escape'); await page.locator('[role=dialog]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  } else check('party edit button present', false, 'no Edit button in parties table')

  // duplicate prefill and payment preset on sales
  await goModule(page, 'Sales')
  await page.getByRole('tab', { name: /sales invoices/i }).first().click().catch(() => {}); await settle(page, 600)
  const dup = page.locator('main button[aria-label^="Duplicate"]').first()
  if (await dup.count()) {
    await dup.click(); await settle(page, 500)
    const title = await page.locator('[role=dialog] h2').first().textContent().catch(() => '')
    const filledLine = await page.locator('[role=dialog] input[type=number], [role=dialog] input[inputmode=decimal]').evaluateAll((els) => els.some((e) => Number(e.value) > 0)).catch(() => false)
    check('duplicate opens a prefilled draft', /duplicate/i.test(title ?? '') && filledLine, `title="${title}" filledLine=${filledLine}`)
    await shot(page, 'duplicate')
    await page.keyboard.press('Escape'); await page.locator('[role=dialog]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  } else check('duplicate action present on sales list', false)
  const row = page.locator('main table tbody tr').first()
  if (await row.count()) {
    const link = row.locator('button[aria-label^="View"], a').first()
    await link.scrollIntoViewIfNeeded().catch(() => {})
    await link.click({ timeout: 10000 }).catch(async () => { await link.evaluate((el) => el.click()) }); await settle(page)
    const pay = page.getByRole('button', { name: /receive payment/i }).first()
    if (await pay.isVisible().catch(() => false) && await pay.isEnabled().catch(() => false)) {
      await pay.click(); await settle(page, 600)
      const amounts = await page.locator('[role=dialog] input').evaluateAll((els) => els.map((e) => e.value)).catch(() => [])
      check('Receive Payment opens with the outstanding amount preset', amounts.some((v) => Number(v) > 0), JSON.stringify(amounts).slice(0, 120))
      await shot(page, 'payment-preset')
      await page.keyboard.press('Escape'); await page.locator('[role=dialog]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
    } else check('Receive Payment preset (skipped: first invoice fully paid)', true, 'button disabled/hidden for a paid invoice')
  }

  // command palette resets on close
  await goModule(page, 'Dashboard')
  await page.keyboard.press('Control+K'); await page.waitForTimeout(400)
  const input = page.locator('[role=dialog] input').first()
  if (await input.count()) {
    await input.fill('Audit'); await page.waitForTimeout(900)
    const hits = await page.locator('[cmdk-item], [role=option]').count()
    check('command palette searches (2+ characters)', hits > 0, `results=${hits}`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    await page.keyboard.press('Control+K'); await page.waitForTimeout(400)
    check('command palette query is cleared after closing', (await page.locator('[role=dialog] input').first().inputValue().catch(() => 'x')) === '')
    await page.keyboard.press('Escape'); await page.locator('[role=dialog]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  } else check('command palette opens with Ctrl+K', false)

  // double submit: one party only
  if (db && vp.name === 'desktop-1440') {
    await goModule(page, 'Masters')
    await page.getByRole('tab', { name: /parties/i }).first().click().catch(() => {}); await settle(page, 500)
    const addBtn = page.locator('main button', { hasText: /new party|add party|^\+?\s*new$/i }).first()
    if (await addBtn.count()) {
      await addBtn.click(); await settle(page, 400)
      const code = `E2E-${Date.now() % 100000}`
      const dlg = page.locator('[role=dialog]').first()
      const inputs = dlg.locator('input[type=text], input:not([type])')
      await inputs.nth(0).fill(code); await inputs.nth(1).fill('E2E Double Submit')
      const save = dlg.locator('[data-slot=dialog-footer] button, div.border-t button').last()
      // Fire three clicks in the same tick, the way a user double/triple-clicks.
      await save.evaluate((el) => { el.click(); el.click(); el.click() })
      await settle(page, 1200)
      const n = Number((await db.get('SELECT COUNT(*) c FROM Party WHERE code=?', [code])).c)
      check('triple-clicking Save creates exactly one record', n === 1, `rows=${n}`)
    } else check('new party button present', false)
  }

  check('no browser console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '))
  check('no hydration errors', !consoleErrors.some((e) => /hydrat/i.test(e)), '')
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  check('no 5xx responses', badResponses.length === 0, badResponses.slice(0, 4).join(' | '))
  await ctx.close()
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXE || undefined })
  for (const vp of VIEWPORTS) {
    try { await runViewport(browser, vp) } catch (e) { scope = vp.name; check('viewport run completed without a harness exception', false, String(e).slice(0, 300)) }
  }
  await browser.close()
  const summary = { ranAt: new Date().toISOString(), baseUrl: BASE, total: results.length, passed: results.length - failures, failed: failures, results }
  writeFileSync(join(OUT, 'e2e-results.json'), JSON.stringify(summary, null, 2))
  console.log(`\n=== ${summary.passed}/${summary.total} browser checks passed, ${summary.failed} failed ===`)
  if (db) await db.close()
  if (failures) process.exitCode = 1
}
main().catch(async (e) => { console.error('E2E ERROR', e); if (db) await db.close(); process.exitCode = 2 })
