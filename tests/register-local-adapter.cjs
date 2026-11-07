/**
 * TEST-ONLY Node preload (NODE_OPTIONS=--require ...): injects the SQLite
 * driver adapter into every PrismaClient constructed in this process. The
 * generated client in this sandbox uses the WASM query engine (the Prisma
 * binary CDN is unreachable here), which requires an adapter argument.
 * Production never loads this file.
 *
 * Both the root @prisma/client (used by `next dev` / `next start`) and the
 * copy bundled into .next/standalone (used by `node .next/standalone/server.js`)
 * are patched, so the same throwaway SQLite DB works in either local mode.
 */
const fs = require('node:fs')
const path = require('node:path')

if (process.env.LOCAL_TEST_SQLITE_URL) {
  let PrismaBetterSQLite3
  const clientIds = ['@prisma/client']
  const standalone = path.join(process.cwd(), '.next', 'standalone', 'node_modules', '@prisma', 'client')
  if (fs.existsSync(standalone)) clientIds.push(standalone)

  for (const id of clientIds) {
    let client
    try { client = require(id) } catch { continue }
    if (!PrismaBetterSQLite3) {
      try { ({ PrismaBetterSQLite3 } = require('@prisma/adapter-better-sqlite3')) } catch { return }
    }
    const Original = client.PrismaClient
    if (Original && !Original.__localAdapterPatched) {
      const Patched = class extends Original {
        constructor(options) {
          const opts = { ...(options || {}) }
          if (!opts.adapter) {
            opts.adapter = new PrismaBetterSQLite3({ url: process.env.LOCAL_TEST_SQLITE_URL })
          }
          super(opts)
        }
      }
      Patched.__localAdapterPatched = true
      Object.defineProperty(client, 'PrismaClient', {
        value: Patched,
        writable: true,
        configurable: true,
        enumerable: true,
      })
    }
  }
}
