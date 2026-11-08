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
  20261108090000_finance_reversal_and_document_uniqueness/
    migration.sql                           hand-staged (generated SQL rejected, see
                                            docs/FULL_RUNTIME_AUDIT_2026-11-08.md §5):
                                            ReturnDocument.refundedAmount (backfilled from
                                            POSTED refunds), PaymentAllocation.kind/reversedAt/
                                            reversalReason, PurchaseInvoice.activeSupplierInvoiceNo
                                            and GoodsReceipt.supplierDocKey (backfilled for
                                            non-cancelled rows), IdempotencyKey table; the
                                            unique keys on supplier invoice/challan numbers
                                            become active-only. New indexes are created before
                                            the old unique keys are dropped, so no FK loses its
                                            supporting index.
  20261112100000_manufacturing_cost_rollup/
    migration.sql                           additive: Company.overheadRatePct (default 0 =
                                            absorption off), Bom.standardLabourCost /
                                            standardMinutes, ProductionTask.overheadCost,
                                            WorkOrder.overheadCost. Nothing changes value
                                            until a rate is set; then WIP and receipt cost
                                            rise by the absorbed amount for work completed
                                            afterwards (docs/MANUFACTURING_COSTING.md).
  20261111100000_routing_work_centers_oee/
    migration.sql                           additive: WorkCenter, ShiftCalendar, Shift,
                                            ShiftHoliday, RoutingOperation, MachineDowntime;
                                            ProductionTask.workCenterId (nullable) +
                                            plannedMinutes (default 0). Legacy tasks keep
                                            reporting throughput/yield, they just have no
                                            centre (docs/ROUTING_CAPACITY_OEE.md).
  20261110100000_bom_revisions_and_mrp/
    migration.sql                           hand-staged, additive only: Bom.itemId +
                                            revision/effectiveFrom/effectiveTo/supersedesId
                                            (unique (companyId,itemId,revision)), WorkOrder
                                            outputItemId/outputQty, new MrpRun + MrpLine.
                                            Legacy Bom rows keep itemId = NULL — link them with
                                            scripts/backfill-bom-output-items.mjs and read
                                            docs/MRP_AND_BOM_REVISIONS.md before deploying.
  20261108120000_tenant_isolation/
    migration.sql                           hand-staged: companyId on the 19 legacy root
                                            tables (Party, Item, Warehouse, invoices, ledgers,
                                            jobwork, projects, BOM, work orders, tasks,
                                            payments, AuditLog …), backfilled with the oldest
                                            operating company, then NOT NULL DEFAULT '' + FK
                                            (AuditLog stays nullable). Global unique keys become
                                            (companyId, key); each composite key is created
                                            before the old one is dropped. Counter keys are
                                            prefixed "<companyId>:". Fails (error 1138) on a
                                            database with no operating company, by design.
  20261108130000_advance_sales_order/
    migration.sql                           PartyAdvance.salesOrderId (nullable, SET NULL FK)
  20261108140000_rfq_supplier_quotes/
    migration.sql                           5 new tables (Rfq, RfqLine, RfqSupplier,
                                            SupplierQuote, SupplierQuoteLine). Additive only.
  20261109090000_mapsoft_parity/
    migration.sql                           10 new tables (LedgerAccount, JournalVoucher,
                                            JournalLine, TdsSection, StockAdjustment(+Line),
                                            Salesperson, Lead, LeadActivity, ServiceCall);
                                            nullable/defaulted columns Company.booksLocked*,
                                            Party.creditDays, Payment.tds*, salespersonId on
                                            quotation/order/invoice. Additive only.
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

Pre-flight for `20261108090000_*` (read-only): none needed for uniqueness — the
new keys are strict subsets of the old unique keys. Known limitation: advance
applications made **before** this migration stay `kind = PAYMENT` and cannot be
reversed through `reverse-advance-application` (no column distinguished them).
The live database had no advance applications when this was written.

Pre-flight for `20261110100000_bom_revisions_and_mrp` (read-only):

```sql
-- legacy BOMs without an output item: they stay readable but MRP will not
-- explode them until they are linked (scripts/backfill-bom-output-items.mjs)
SELECT COUNT(*) FROM Bom WHERE itemId IS NULL;
-- any product with two live (non-cancelled) BOMs would violate the new unique
-- key once both are linked to the same item — must return no rows
SELECT itemId, COUNT(*) FROM Bom WHERE itemId IS NOT NULL AND status <> 'CANCELLED'
 GROUP BY itemId HAVING COUNT(*) > 1;
-- open work orders that would have outputQty = 1 by default
SELECT COUNT(*) FROM WorkOrder WHERE status IN ('OPEN','IN_PROGRESS');
```

`deploy.py` dumps the database to `~/backups/predeploy/<stamp>.sql.gz` before
step 1 (`--no-backup` skips it — do not). Rollback of the code is
`python deploy.py --rollback`; rollback of the schema is restoring that dump
(the migration is additive, so the old code also runs fine on the migrated
schema — a code rollback alone is normally enough).

Pre-flight for `20261108120000_tenant_isolation` (read-only):

```sql
SELECT id, name, createdAt FROM Company WHERE isPlatform = 0 ORDER BY createdAt;
-- at least one row; every legacy row is assigned to the FIRST row.
-- More than one row: confirm that the oldest company really owns the legacy data.
```

This migration is **not** additive (NOT NULL columns, re-keyed uniques, renamed
counters): the old code cannot run on the migrated schema. Rollback after it is
applied = restore the predeploy dump. Rehearse it first (§8).

## 5. Backfill

None required for this migration: every new column has a default
(`Party.creditLimit = 0`, the `*Id` link columns are NULL) and the new tables
start empty. Legacy orgs seeded before the manufacturing module can add that
demo chain with `POST /api/seed?manufacturing=1` (additive, refuses when
employees/projects exist).

Multi-company isolation is `20261108120000_tenant_isolation` (§1); its backfill
is inside the migration and deterministic (oldest operating company by
`createdAt`). Child tables need no column: they are scoped through their
required parent. Backups are v5 and platform-wide; restoring a pre-v5 snapshot
assigns it to its legacy organisation and prefixes its counters.

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

Superseded for the third migration and the workflow runtime by
`docs/FULL_RUNTIME_AUDIT_2026-11-08.md` (fresh-database replay, backfill fixture,
408/409 workflow checks, 68/68 browser checks).

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

## 8. Staging rehearsal on a copy of live data

Before the first deploy that includes `20261108120000_tenant_isolation`, on the
server (the predeploy dump never leaves it):

```bash
STAGING_DATABASE_URL=mysql://<user>:<pass>@127.0.0.1:3306/forgeerp_staging_rehearsal   node scripts/staging-rehearsal.mjs ~/backups/predeploy/<latest>.sql.gz
```

The script refuses names that do not contain staging/rehearsal/tmp/test/audit,
refuses a database that already exists, and drops only the one it created
(`--keep` to inspect). It runs the pre-flight above, baselines like `deploy.py`
when history is missing, applies `migrate deploy`, checks status and drift, and
then proves: no table lost rows, every business row belongs to an operating
company, every counter is prefixed, Dr = Cr, no negative stock. Expect
"staging rehearsal: PASSED" before deploying.

Verified 2026-11-08 on a simulated live dump (schema + data as of `d1ef1f0`,
history for the first three migrations): PASSED, three migrations in 20 s.
**Not yet run on the real live dump.**

### One command on the server

`scripts/rehearse-on-server.sh` does all of the above as the site user:

- it picks the newest `~/backups/predeploy/*.sql.gz`;
- it clones `main` into `~/tmp/rehearsal-src`, outside the live site, and runs `npm ci`;
- it builds the rehearsal URL from the live `.env` credentials with a different database name. The URL is never printed.

```bash
# DB user may create databases: uses and drops <live_db>_rehearsal
curl -fsSL https://raw.githubusercontent.com/akashshinde700/erp/main/scripts/rehearse-on-server.sh | bash

# CloudPanel (site DB users usually cannot CREATE DATABASE): first create an
# EMPTY database, e.g. erp_rehearsal, for the same DB user in CloudPanel, then
curl -fsSL https://raw.githubusercontent.com/akashshinde700/erp/main/scripts/rehearse-on-server.sh | REHEARSAL_DB=erp_rehearsal bash -s -- --use-empty
```

`--use-empty` accepts an existing database only if it has no tables. When the
run ends, it drops the tables it loaded and checks that none are left.

Verified 2026-11-09:

- on a simulated pre-parity live dump (6 migrations applied, one operating company): both modes PASSED, and `20261109090000_mapsoft_parity` applied in 9.6 s;
- an existing database without the flag, and a non-empty database with it, are both refused;
- the source database was untouched.
