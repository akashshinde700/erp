# Local test & audit plan — what to run, in what order, and what counts as pass

Written 2026-11-08 for the P1 work merged in PR #23 (BOM revisions, MRP,
routing/capacity/OEE, manufacturing costing). Everything here is a command you
run on **your** machine; nothing in this file was executed against a database —
the sandbox that wrote this code has no MySQL and no Prisma engine binaries, so
only the static gates could run (see §0).

Read §1 first. Do not skip it: three of the migrations are newer than any
recorded green run, so a rehearsal on a protected copy is worth more than
another green unit test.

---

## 0. Current state — what is already proven, and what is not

| Gate | Status | How it was checked |
| --- | --- | --- |
| `npx tsc --noEmit` | **PASS, 0 errors** | executed 2026-11-08 with a client generated from `prisma/schema.prisma` |
| `npx eslint .` | **PASS, 0 problems** | executed 2026-11-08, full repo |
| `npx next build` | **compiles + typechecks clean**, fails at page-data collection | expected in the sandbox: it generated a fake-engine client, which `next build` refuses (`P2038 Missing configured driver adapter`). On your machine with a real client this gate should pass; if it does not, it is a real failure. |
| `npx prisma validate` | **PASS** | executed with the fake schema engine |
| migration ↔ schema drift | **NOT CHECKED** | `prisma migrate diff` needs a live shadow MySQL; the sandbox cannot reach `binaries.prisma.sh` |
| migrations applied from empty | **NOT RUN** | needs MySQL |
| `tests/*.mjs` suites | **NOT RUN** | need MySQL + a running server; see §5 |
| browser E2E | **NOT RUN** | no Chromium available in the sandbox |
| seed + demo data | **NOT RUN** | needs MySQL |

So: the code typechecks and lints, and the app compiles. **Nothing about runtime
behaviour is proven yet.** Treat every item in §5 as unverified until it prints
green on your machine.

---

## 1. Read this before pointing anything at a real database

Every audit suite below starts with `?force=1` — a **destructive reseed**. They
refuse to run unless the database name looks disposable (`audit`, `test`, `tmp`,
`mig`) or you explicitly confirm it. Keep it that way.

Never point at production. The rehearsal in §2 is the closest you get, and it
works on a copy.

Correct order: §2 (rehearsal on a copy of the dump) → §3 (local MySQL) → §4/§5
(suites) → §6 (manual shop-floor pass) → §7 (what is still open).

---

## 2. Migration rehearsal on a copy of the production dump (the P0 blocker)

This is the item that has been outstanding since the P0 list and it is still the
highest-value hour you can spend. It needs: a dump of production, a throwaway
MySQL instance, 15 minutes.

```bash
# 1. take the dump (on the database host, read-only operation)
mysqldump -h <host> -u <user> -p --single-transaction --routines --triggers \
  forgeerp > forgeerp-$(date +%F).sql

# 2. restore it into a throwaway MySQL 8 (local or a staging box you own)
mysql -u root -p -e "CREATE DATABASE erehearsal CHARACTER SET utf8mb4"
mysql -u root -p erehearsal < forgeerp-$(date +%F).sql

# 3. run the repo's rehearsal script against the COPY
STAGING_DATABASE_URL='mysql://root:<pw>@127.0.0.1:3306/erehearsal' \
  node scripts/staging-rehearsal.mjs

# 4. apply the three new migrations to the COPY and watch for errors
DATABASE_URL='mysql://root:<pw>@127.0.0.1:3306/erehearsal' \
  npx prisma migrate deploy
DATABASE_URL='mysql://root:<pw>@127.0.0.1:3306/erehearsal' \
  npx prisma migrate status
```

What the rehearsal prints and what to do with it:

- **Per-company row counts.** Confirm which `companyId` owns the legacy rows. If
  two companies both hold trading history, the legacy BOM/MRP tables need a
  human decision (see `docs/MIGRATION_RUNBOOK.md`); do not let a script guess.
- **"one live revision per output item" assertion.** If it fails, the copy has
  two `APPROVED` BOMs for one item — the new unique index will refuse the
  migration. Resolve by hand on the copy first: supersede the older revision.
- **Legacy BOM/MRP readiness.** Rows with `Bom.itemId IS NULL` stay read-only.
  Count them, then decide whether to run `node scripts/backfill-bom-output-items.mjs`
  (it is idempotent, but run it on the copy first, always).

Then the specific pre-flight counts for the three new migrations:

```sql
-- BOM revisions + MRP
SELECT COUNT(*) AS approved_per_item_dupes FROM (
  SELECT itemId FROM Bom WHERE status='APPROVED' AND itemId IS NOT NULL
  GROUP BY itemId HAVING COUNT(*) > 1) x;                     -- must be 0
SELECT COUNT(*) AS legacy_boms_without_item FROM Bom WHERE itemId IS NULL;

-- routing / capacity / OEE
SELECT COUNT(*) AS tasks_without_centre FROM ProductionTask WHERE workCenterId IS NULL;
SELECT COUNT(*) AS open_tasks_without_centre FROM ProductionTask
  WHERE workCenterId IS NULL AND status IN ('PENDING','ASSIGNED','IN_PROGRESS');

-- costing (additive, defaulted; nothing to reconcile — just know the effect)
SELECT COUNT(*) FROM ProductionTask WHERE status='COMPLETED';  -- these keep overheadCost = 0
SELECT overheadRatePct FROM Company;                           -- 0 = absorption off after deploy
```

Expected and safe: `tasks_without_centre` equals your whole task history (the
column is new), and every completed task has `overheadCost = 0` until you set a
rate. Both are documented in `docs/MANUFACTURING_COSTING.md`.

**Do not set `overheadRatePct > 0` in production** until you have decided, with
whoever signs the accounts, that WIP and receipt cost should rise by that
percentage on work completed from then on. It is a policy switch, not a bug fix.

---

## 3. Bring up local MySQL + the app

```bash
# Node 22, npm ci (lockfile is committed)
npm ci

# a local MySQL 8 — pick whichever you have
docker run -d --name forge-mysql -p 3307:3306 \
  -e MYSQL_ROOT_PASSWORD=localpass -e MYSQL_DATABASE=forgeerp_local mysql:8.0
#   …or a system MySQL/MariaDB on 3306

export DATABASE_URL='mysql://root:localpass@127.0.0.1:3307/forgeerp_local'
export SHADOW_DATABASE_URL='mysql://root:localpass@127.0.0.1:3307/forgeerp_shadow'

npx prisma generate
npx prisma validate
npx prisma migrate deploy        # must apply all 10 migrations from empty
npx prisma migrate status        # must say "Database schema is up to date"
npm run typecheck                # 0 errors
npm run lint                     # 0 problems
npm run build                    # must pass with a REAL client (the sandbox could not run this gate)
```

Migration/schema drift — the gate that catches a hand-written migration that does
not match `schema.prisma` (all three new migrations are hand-written):

```bash
mysql -u root -plocalpass -e "CREATE DATABASE forgeerp_shadow"
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code
echo "exit=$?"     # 0 = no drift. This is the check I could not run here.
```

Then start the app the way the suites expect (port 3011 is what the docs use):

```bash
npm run dev -- -p 3011        # or: npm run build && npm start
```

Sanity check the eight new endpoints by hand before trusting the suites:

```bash
curl -s localhost:3011/api/manufacturing/work-centers?all=1 | head -c 400
curl -s localhost:3011/api/manufacturing/schedule?horizonDays=30 | head -c 400
curl -s localhost:3011/api/manufacturing/oee | head -c 400
curl -s localhost:3011/api/manufacturing/costing | head -c 400
```

(These need a session cookie once org logins exist — the suites handle that for
you; a bare `curl` returning 401 is correct behaviour, not a bug.)

### Seed the demo scenario

```bash
KEY=$(cat db/platform-key.key)                   # the server creates it on first boot
curl -s -X POST -H "x-platform-key: $KEY" localhost:3011/api/seed | head -c 600
```

The seed now claims `productionTasks: 11, workCenters: 6, overheadRatePct: 18`.
If `workCenters` is missing from the response, you are running stale code.

---

## 4. The fast suite first

`tests/erp-audit.mjs` — broad API + database checks, ~72 checks, fastest signal:

```bash
AUDIT_BASE_URL=http://127.0.0.1:3011 \
AUDIT_DB_URL="$DATABASE_URL" \
AUDIT_PLATFORM_KEY=db/platform-key.key \
node tests/erp-audit.mjs
```

**Pass bar:** every check green, `tests/audit-results.json` written. The last
recorded green on MySQL was **72/72**. New in this branch: it now also pings
`/api/manufacturing/{work-centers,oee,schedule,downtime,costing}`, so a 500 there
fails fast.

---

## 5. The suites that actually exercise the new work

Run these in order. Each one reseeds destructively, so give each its own
throwaway database if you want to keep the results comparable.

### 5a. `tests/workflow-audit.mjs` — the main event (~440 checks)

```bash
AUDIT_BASE_URL=http://127.0.0.1:3011 \
AUDIT_DB_URL='mysql://root:localpass@127.0.0.1:3307/forgeerp_audit' \
node tests/workflow-audit.mjs
```

Phases that matter for this branch — these have **never been executed**:

| Phase | What it proves |
| --- | --- |
| `P12-mrp` | demand explodes through effective revisions; netting order (stock → WO → PO → PR); suggestions create nothing until approved |
| `P12c-ops` | routing is frozen after approval; task minutes = setup + run × batch; regeneration is idempotent; shift overlaps and bad working weeks are rejected; schedule respects route order; downtime guards (overlap, double close); **OEE = A × P × Q** |
| `P12d-costing` | overhead = rate × prime cost; ledger `OVHA` moves; roll-up total = material + labour + overhead; **true-up is idempotent**, restates to a new rate, and refuses an absurd rate |
| `reconcile` (after every phase) | voucher Dr = Cr; trial balance; no negative stock/lot; **WIP fully settled on completed orders including overhead**; **`OVHA` ledger balance = overhead on completed tasks**; **work-order overhead header = sum of its operations** |

Expect to fix a handful of fixture mistakes on the first run — that is normal
(the original audit needed three passes). What matters is that `reconcile`
stays green after each phase.

### 5b. `tests/backup-drill.mjs` — the one that would have caught my bug

```bash
AUDIT_BASE_URL=http://127.0.0.1:3011 AUDIT_DB_URL="$DATABASE_URL" \
  node tests/backup-drill.mjs
```

While writing this plan I found that `POST /api/backup/restore` inserted work
centres **after** the production tasks that reference them, so a restore of any
routed shop floor failed with `P2003`. Fixed in `6aa929f`, and the drill now
asserts both that the seed builds a routed shop floor (≥ 6 centres, ≥ 6
calendars, ≥ 3 routings, ≥ 5 routed tasks, absorbed overhead > 0) and that all
of it survives backup → reseed → restore. **Run this before trusting backup at
all**, then re-run it against a copy of the production dump.

### 5c. `tests/tenant-isolation.mjs` (~68 checks)

```bash
AUDIT_BASE_URL=http://127.0.0.1:3011 \
AUDIT_DB_URL='mysql://root:localpass@127.0.0.1:3307/forgeerp_tenant' \
  node tests/tenant-isolation.mjs
```

The six new models all get their `companyId` from the tenant extension. A work
centre or routing operation visible to the wrong org is a data-leak bug, not a
cosmetic one.

### 5d. `tests/parity-audit.mjs` and `tests/perf-load.mjs`

```bash
AUDIT_BASE_URL=http://127.0.0.1:3011 AUDIT_DB_URL="$AUDIT_URL" node tests/parity-audit.mjs
AUDIT_BASE_URL=http://127.0.0.1:3011 AUDIT_DB_URL="$AUDIT_URL" node tests/perf-load.mjs
```

Parity covers books controls, adjustments, CRM, service calls and a restore
round trip. Perf is the only thing that says anything about report latency — worth
one run now that `manufacturingCostVarianceReport` scans 500 work orders with all
their tasks. **If that report is slow, say so; it is a known shape (per-order
task arrays) rather than a surprise.**

### 5e. Browser E2E (optional but the only UI evidence)

```bash
npm i -D playwright && npx playwright install chromium
E2E_BASE_URL=http://127.0.0.1:3011 AUDIT_DB_URL="$AUDIT_URL" node tests/e2e-browser.mjs
```

I could not run this. The UI added in this branch — **Capacity, Work Centers,
OEE, Costing tabs, the routing editor on the BOM screen, the overhead-rate field
in Masters → Company** — has only ever been typechecked. Until this runs, treat
those screens as unverified.

---

## 6. Manual pass — the things no script can judge

Twenty minutes in the browser, seeded demo data. In this order:

1. **Masters → Company** → set overhead absorption to 18 % → save → reload, value
   sticks. Set 500 → refused with a clear message.
2. **Manufacturing → BOMs** → open the canopy BOM → **Route** → see six
   operations with centres and minutes → change a run time → save → the footer
   shows the recalculated standard cost. Approve the revision → reopen Route →
   editing is now blocked ("frozen").
3. **Manufacturing → Costing** → the seeded tanks/canopy orders appear with
   material/labour/overhead split. Click one → per-operation breakdown adds up to
   the header. Press **True-up** → confirmation explains the posting → post →
   running it again says "nothing to post".
4. **Manufacturing → Capacity** → the plan places routed tasks on centres, load
   vs capacity per centre, late orders flagged. Check a number by hand: a task's
   minutes vs the centre's shift hours.
5. **Manufacturing → OEE** → pick a 14-day window → availability reflects the
   seeded downtime, and the "read this before trusting the numbers" panel lists
   its caveats. **Change the window to before the downtime dates** → availability
   goes to 100 % and the panel says why.
6. **Work Centers** → open a centre → calendar shows Mon–Sat, GENERAL + OT
   shifts, the seeded holiday. Try to save two overlapping shifts → refused.
7. **Manufacturing → Tasks** → complete a task with material → then check
   **Accounting → Trial balance**: `WIP` up by material + labour + overhead,
   `Factory Overhead Absorbed` up by the overhead only, and the voucher balances.
8. **Reports → Production cost & variance** → actual = material + labour +
   overhead, and the note explains what the column does not include.
9. **Backup** → download → **restore** the same file → routed tasks, calendars
   and routings still there (this is the regression from §5b, seen by eye).
10. **Receipts**: receive FG for a fully-costed order → the order closes → WIP
    for that order is **zero**, and any difference shows in `MFGV`.

---

## 7. What is still open after all of that (do not let this list get lost)

1. **P0 — real-dump rehearsal.** §2 is the actual blocker. It needs the dump and
   a throwaway MySQL; nothing in this branch can substitute for it.
2. **P0 — credential rotation** if the previously-tracked `.env` ever held live
   credentials. Verify every deployment reads secrets from the environment.
3. **P0 — a real shop-floor pilot.** A green audit suite is not evidence that a
   fabricator can run a job card on a tablet.
4. ~~Finished-goods receipt valued at material standard only~~ — resolved by the
   BOM line basis (UNIT / BATCH), see `docs/MANUFACTURING_COSTING.md`. UNIT BOMs
   receive at full standard; BATCH (all legacy revisions) keep the old rule.
5. **No reservations/ATP.** MRP netting and the capacity plan are advice; two
   plans can suggest the same quantity twice.
6. **Not built, by design:** sequence-dependent changeover, a persisted/frozen
   schedule, operator-skill matching, machine-hour absorption with a
   fixed/variable split, scrap account, WIP ageing, period-end over/under
   absorption write-off.
7. **Overhead accounting needs an accountant's sign-off** on the `OVHA` accrual
   and its contra before anyone files accounts off these numbers.

---

## 8. Reporting back

If you run §4 and §5, send me `tests/*-results.json`. The two I care about most
are `workflow-audit-results.json` (phases `P12c-ops`, `P12d-costing`, and any
`reconcile` failure) and `backup-drill-results.json`. With those in hand I can
fix real defects instead of describing them.
