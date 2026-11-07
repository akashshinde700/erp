# ForgeERP — MySQL migration & backfill runbook

Verified on 2026-11-07 against a disposable MySQL 8.0.46 (Docker) — see
"What was verified" at the end. Production is `www.erp.lastrivon.cloud`
(CloudPanel, MySQL, PM2 `laserp`), deployed by `deploy.py`.

## 1. Migration layout

```
prisma/migrations/
  migration_lock.toml                       provider = "mysql"
  20261106000000_init/
    migration.sql                           33 tables — exactly the schema the live DB was
                                            built with by `prisma db push` on 2026-11-06
                                            (git cf7a911); verified: applying it to an empty
                                            DB and diffing against that schema = no drift
    schema.baseline.prisma                  the datamodel the init SQL was generated from;
                                            deploy.py diffs the live DB against it before
                                            marking the baseline as applied
  20261107180328_complete_business_workflows/
    migration.sql                           27 new tables (procurement, quote-to-cash, QC,
                                            lots/serials, production receipts, schedules,
                                            advances, refunds) + 6 columns + 1 unique index
                                            + 73 FKs. Purely additive: 0 DROP, 0 MODIFY,
                                            every new column is NULLable or DEFAULT 0.
```

`db:push` is **not** used anywhere any more: `deploy.py` runs
`prisma migrate deploy`; `npm run db:deploy` is the same command.

## 2. Reviewing a migration before it ships

```bash
npx prisma format && npx prisma validate && npx prisma generate
# incremental SQL for a schema change (no DB needed):
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma --script \
  --shadow-database-url mysql://root:<pw>@127.0.0.1:3307/shadow
```

Checklist for the generated SQL:

- no `DROP TABLE` / `DROP COLUMN` / `MODIFY` unless the change note says so and a
  backup has been taken in the same deploy;
- every new `NOT NULL` column has a `DEFAULT` (otherwise existing rows fail);
- every new `UNIQUE INDEX` on an existing table has a pre-flight duplicate query
  (see §4) — MySQL allows multiple NULLs, so only non-NULL duplicates block;
- new tables are listed in `src/lib/backup-tables.ts` (backup v4, restore and
  force-reseed all read that one list) — otherwise restore/reseed fail with P2003
  and backups silently omit the rows (`tests/backup-drill.mjs` catches both).

## 3. Disposable MySQL for replay / regression (local)

```bash
docker run -d --name erp-migtest -e MYSQL_ROOT_PASSWORD=migtest -e MYSQL_DATABASE=erp_mig \
  -p 3307:3306 mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
export DATABASE_URL=mysql://root:migtest@127.0.0.1:3307/erp_mig
npx prisma migrate deploy                     # replay from empty
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
                                              # must print nothing (no drift)
npm run typecheck && npm run build
npx next dev -p 3010                          # server under test
AUDIT_BASE_URL=http://127.0.0.1:3010 AUDIT_DB_URL=$DATABASE_URL node tests/erp-audit.mjs
AUDIT_BASE_URL=http://127.0.0.1:3010 AUDIT_DB_URL=$DATABASE_URL node tests/backup-drill.mjs
```

Both suites start with a destructive `?force=1` reseed — **never** point them at
production.

## 4. Applying to the live database (first time = baselining)

The live DB has the 33 baseline tables but no `_prisma_migrations` history.
`deploy.py` (`migrate_database()`) handles it in one run:

1. `prisma migrate status` — the init migration shows as pending.
2. Diff live DB ↔ `schema.baseline.prisma`. Empty diff ⇒ db-push-era database ⇒
   `prisma migrate resolve --applied 20261106000000_init` (records history only,
   touches no table). Non-empty diff that is not "create everything" ⇒ **abort**:
   someone changed the live schema by hand; reconcile first.
3. `prisma migrate deploy` applies `20261107180328_complete_business_workflows`.
4. `prisma migrate status` must say "Database schema is up to date!" or the
   deploy stops before the release swap.

Pre-flight on live (read-only; the only constraint that can collide with data):

```sql
SELECT partyId, supplierInvoiceNo, COUNT(*) FROM PurchaseInvoice
 WHERE supplierInvoiceNo IS NOT NULL GROUP BY partyId, supplierInvoiceNo HAVING COUNT(*) > 1;
-- must return no rows; otherwise fix the duplicates before deploying
```

`deploy.py` dumps the database to `~/backups/predeploy/<stamp>.sql.gz` before
step 1 (`--no-backup` skips it — do not). Rollback of the code is
`python deploy.py --rollback`; rollback of the schema is restoring that dump
(the migration is additive, so the old code also runs fine on the migrated
schema — a code rollback alone is normally enough).

## 5. Backfill

None required for this migration: every new column has a default
(`Party.creditLimit = 0`, the `*Id` link columns are NULL) and the new tables
start empty. Legacy orgs seeded before the manufacturing module can add that
demo chain with `POST /api/seed?manufacturing=1` (additive, refuses when
employees/projects exist).

Multi-company isolation (adding `companyId` to the 42 legacy tables, scoped
unique keys, session-company resolver) is **not** part of this migration; it
needs its own reviewed migration with a deterministic backfill
(`UPDATE <table> SET companyId = (SELECT id FROM Company WHERE isPlatform = 0 LIMIT 1)`
is only valid while there is exactly one operating company).

## 6. Backup / restore drill (what `tests/backup-drill.mjs` proves)

1. force reseed → row counts reconcile with `seedDatabase()`'s summary, ledger
   Dr = Cr, no negative stock, no orphan lines, the completed work order has a
   posted production receipt;
2. `GET /api/backup` (v4) → the snapshot covers **every** physical table
   (information_schema) and the per-table counts equal the live counts;
3. second reseed (fresh ids) → restore of the snapshot → every table count equals
   the snapshot again, original ids and invoice totals are back, ledger balanced;
4. a v3-shaped snapshot is refused with 400 while workflow rows exist.

## 7. What was verified on 2026-11-07 (and what was not)

| Step | Result |
|---|---|
| `prisma format` / `validate` / `generate` (MySQL) | OK (format = whitespace + one `@@unique` reorder) |
| Baseline + incremental migration generated and reviewed | OK — additive only |
| Replay both migrations on empty MySQL 8.0.46 → drift diff | empty |
| `init` applied alone → diff vs the 2026-11-06 live schema | empty (init == live) |
| Simulated db-push DB → resolve baseline → deploy → status | up to date, no drift, rows kept |
| `npm run typecheck` | 0 errors (9 fixed: header props, requisition typing, ledger party join, test harness excluded) |
| `npm run build` | OK |
| `npm run lint` | 17 pre-existing `react-hooks/set-state-in-effect` errors, untouched (not type/runtime errors) |
| `tests/erp-audit.mjs` on MySQL | 72/72 |
| `tests/backup-drill.mjs` on MySQL | 18/18 |
| Live DB drift check over SSH tunnel | **not run** (blocked in this session) — deploy.py performs the same diff on the server before baselining |
| Live deploy with migrations | **not run** — awaiting go-ahead |
| Multi-company isolation, browser E2E of the new workflow forms | **not done** |

Runtime bugs found only because the suite ran on the real MySQL client:

- seed completed tasks without starting them (new lifecycle guard) → `startTask` added;
- seed closed the tank work order without a production receipt (new WIP guard) → FG item `FG-2001` + `postProductionReceipt`;
- `?force=1` reseed and `POST /api/backup/restore` wiped only the 33 legacy tables → P2003 on MySQL; backup v3 omitted the 27 workflow tables entirely → backup v4 + shared `WORKFLOW_MODELS_CHILDREN_FIRST`.
