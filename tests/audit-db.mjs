/**
 * ForgeERP audit suite — raw-row database access for assertions.
 *
 * The suite verifies DB rows after each HTTP step. Production runs on MySQL,
 * so the primary adapter is mysql2 (AUDIT_DB_URL). The SQLite adapter only
 * serves the offline sandbox harness (AUDIT_DB_PATH + tests/schema.sqlite.prisma)
 * and is loaded lazily, so MySQL runs never need better-sqlite3.
 *
 * Only plain `SELECT ... WHERE col=?` statements are used by the suite; both
 * engines accept `?` placeholders and the Prisma table/column names.
 */
import { createRequire } from 'node:module'

export function openAuditDb({ url, path }) {
  return url ? mysqlAdapter(url) : sqliteAdapter(path)
}

function mysqlAdapter(url) {
  let poolPromise = null
  const pool = () => {
    if (!poolPromise) {
      poolPromise = import('mysql2/promise').then((m) =>
        m.createPool({ uri: url, connectionLimit: 4, decimalNumbers: true }))
    }
    return poolPromise
  }
  return {
    kind: 'mysql',
    async get(sql, args = []) { const [rows] = await (await pool()).query(sql, args); return rows[0] },
    async all(sql, args = []) { const [rows] = await (await pool()).query(sql, args); return rows },
    async run(sql, args = []) { const [res] = await (await pool()).query(sql, args); return res },
    async close() { if (poolPromise) await (await poolPromise).end() },
  }
}

function sqliteAdapter(path) {
  const Database = createRequire(import.meta.url)('better-sqlite3')
  const norm = (args) => args.map((a) => (a instanceof Date ? a.toISOString() : typeof a === 'boolean' ? (a ? 1 : 0) : a))
  const open = (readonly) => new Database(path, { readonly })
  return {
    kind: 'sqlite',
    async get(sql, args = []) { const d = open(true); try { return d.prepare(sql).get(...norm(args)) } finally { d.close() } },
    async all(sql, args = []) { const d = open(true); try { return d.prepare(sql).all(...norm(args)) } finally { d.close() } },
    async run(sql, args = []) { const d = open(false); try { return d.prepare(sql).run(...norm(args)) } finally { d.close() } },
    async close() {},
  }
}
