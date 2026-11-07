/**
 * TEST-ONLY Prisma config: JavaScript/WASM schema engine + SQLite driver
 * adapter, so `prisma db push` works in an offline sandbox with no native
 * engine binaries and no MySQL server. Production never uses this file
 * (deploy.py keeps the MySQL schema and the server's own .env).
 */
import { defineConfig } from 'prisma/config'
import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'

const url = process.env.LOCAL_DATABASE_URL ?? 'file:/home/user/erp/tests/erp-test.db'

export default defineConfig({
  schema: 'schema.sqlite.prisma',
  experimental: { adapter: true },
  engine: 'js',
  adapter: async () => new PrismaBetterSQLite3({ url }),
})
