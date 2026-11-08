# BOM revisions, engineering change orders and MRP

Status: implemented in code on 2026-11-10 (branch `arena/7cda1275-erp`); **not yet
rehearsed against a production copy** — see the checklist at the end.

This document is the contract for three connected pieces:

1. a BOM now *makes* a catalog item (`Bom.itemId`), so demand can be exploded by item;
2. an approved BOM is immutable and versioned (`revision`, `effectiveFrom/effectiveTo`,
   `supersedesId`), so an engineering change never silently rewrites history;
3. Material Requirements Planning (`MrpRun`/`MrpLine`) explodes approved sales-order and
   released work-order demand through those revisions, nets supply, and produces
   suggestions that only become documents when a user approves them.

## 1. BOM identity

| Field | Meaning |
| --- | --- |
| `Bom.itemId` | The output item this BOM makes. `NULL` only on legacy rows. |
| `Bom.productName` | Human label on the document (free text), not the identity. |
| `Bom.revision` | Starts at 1, +1 per revision of the same output item. |
| `Bom.status` | `DRAFT` → `APPROVED` → `SUPERSEDED`, or `DRAFT`/`APPROVED` → `CANCELLED`. |
| `Bom.effectiveFrom` | Date the revision becomes the live plan (approval date by default). |
| `Bom.effectiveTo` | Set when another revision supersedes it. `NULL` = still open. |
| `Bom.supersedesId` | The revision this one replaces (one row, unique). |

Invariants enforced in `src/lib/manufacturing.ts`:

- **One live BOM per output item.** `createBom` refuses a second non-cancelled BOM for an
  item and points at the existing `bomNo`/status (409).
- **Approved revisions are immutable.** `updateBom` only accepts `DRAFT`. Changing an
  approved design means `reviseBom` (creates `revision + 1` as `DRAFT`) and then
  `approveBom`.
- **Exactly one APPROVED revision per item.** `approveBom` flips the incumbent to
  `SUPERSEDED` and stamps its `effectiveTo` with the new `effectiveFrom`, in the same
  transaction, then recalculates `Project.estCost` from APPROVED BOMs.
- **No retro-effective approvals.** `approveBom` rejects an `effectiveFrom` in the future
  (approve it on that date) — MRP selects the *effective* revision as of the run date, so a
  future-dated approval would create a plan the shop floor cannot build to.
- **`reviseBom` preconditions:** source must be `APPROVED`, must have a linked `itemId`,
  and must not already have a `DRAFT` successor (one open ECO at a time).
- **`cancelBom`** refuses `SUPERSEDED` rows (history is not deletable) and refuses a BOM
  with `OPEN`/`IN_PROGRESS` work orders.
- **Work orders bind to a revision**, never to "the BOM of this product": `WorkOrder.bomId`
  + `outputItemId` + `outputQty` (component lines = BOM net × (1 + wastage) × `outputQty`).
  A `SUPERSEDED` BOM cannot spawn a new work order (409).

`effectiveBomMap(tx, asOf)` is the single resolution point used by MRP: for each
`itemId` it keeps the APPROVED revision with the highest `revision` whose
`effectiveFrom <= asOf` and (`effectiveTo` is null or `> asOf`).

### Legacy rows

Rows created before this change have `itemId = NULL`, `revision = 1`, no dates. They keep
working read-only: they show in the BOM tab flagged **no output item**, cannot be approved
into an ECO chain, cannot generate a work order, and are *never* exploded by MRP (a warning
line is emitted instead). Link them explicitly with
`scripts/backfill-bom-output-items.mjs` (below) — MRP never guesses a mapping from
`productName`.

## 2. MRP pipeline (`src/lib/mrp.ts`)

```
demand     approved/PART_DISPATCHED sales orders       (open qty, dated by deliveryDate)
         + OPEN/IN_PROGRESS work orders                (lines − issued to completed tasks)
   ↓ explosion through the effective BOM (recursive, wastage gross-up, cycle-guarded)
requirements  item × need-by day
   ↓ netting, earliest need first, supply only if dated on/before the need
supply      own stock (JOBWORK_IN excluded)
         → open work-order output of that item
         → approved PO outstanding (qty − receivedQty, dated expectedDate)
         → approved un-ordered requisition (qty − orderedQty, dated requiredBy)
   ↓
suggestion  MAKE (an effective BOM exists) | BUY | NONE (service / cycle / max level)
```

Hard limits: horizon 1–365 days (default 30), `MAX_LEVEL = 6` BOM levels,
`MAX_EVENTS = 20000` demand events; exceeding either returns 409 instead of a runaway plan.
Requirements beyond the horizon are dropped with a warning on the run.

Netting produces no reservations. Stock that a plan "allocates" is still available to every
other consumer; two planners can both see the same on-hand quantity. ATP/reservation is
out of scope until a reservation table exists (`docs/CURRENT_REMAINING_WORK_2026-11-08.md`
P1), so a plan is advice, not a commitment.

### Runs are snapshots

`POST /api/manufacturing/mrp` computes and **persists** the result (`MrpRun` + `MrpLine`).
Reading it (`GET .../mrp/[id]`) never recomputes: numbers approved by a planner must not
change under them. Warnings are stored in `MrpRun.notes` (one per line, joined with the
planner's own note) and returned as `warnings`.

`GET /api/manufacturing/mrp/preview` runs the same engine without saving — used by the UI
for a dry look and by tests to prove a saved run matches a fresh calculation.

### Nothing posts without approval

`createDocumentsFromMrp(runId, { lineIds, projectId, department })` is the only step that
creates documents, and it creates non-posting ones:

- **BUY lines** merge into **one DRAFT purchase requisition** (`department` default
  `PLANNING`, purpose `MRP <runNo> — planned purchase`). It still needs submit + approve.
- **MAKE lines** become **OPEN work orders**, one per line, `outputQty = netQty`, end date
  = need-by; the project is supplied by the user (must be `PENDING`/`RUNNING`).
- The run becomes `APPROVED` with `approvedBy/approvedAt`; lines record
  `createdDocType/createdDocNo` so they cannot be converted twice.
- Whole operation is **one transaction** — a failure creates nothing.

Guards: no line selected, no `netQty`, `suggestion = NONE`, a line already converted, a
**newer non-CLOSED run** exists (409 "approve documents from the latest plan"), missing
`projectId` for MAKE lines, project completed/cancelled, or no effective BOM at conversion
time. `closeMrpRun` retires a snapshot; it cancels nothing.

### Why customer material is never netted

`JOBWORK_IN` stock is customer-owned. It is excluded from on-hand netting exactly as in the
legacy material plan, so own production shortages are never masked by material the company
does not own.

## 3. Database objects

Migration `prisma/migrations/20261110100000_bom_revisions_and_mrp/migration.sql`
(purely additive):

- `Bom`: `itemId`, `revision`, `effectiveFrom`, `effectiveTo`, `supersedesId`
  (+ unique `(companyId, itemId, revision)`, index `(companyId, itemId, status)`, FKs).
- `WorkOrder`: `outputItemId`, `outputQty` (default 1).
- New `MrpRun` (company-scoped) and `MrpLine` (cascade from the run).

Rehearse it on a **protected copy** before production:

```bash
# 1. restore the protected copy into a throwaway schema/server
mysql -h <staging> -u <user> -p <db_copy> < dump.sql
# 2. apply only this migration
cd /home/user/erp && DATABASE_URL='mysql://…/<db_copy>' \
  npx prisma migrate deploy
# 3. confirm the new objects + no drift
npm run scripts/staging-rehearsal.mjs   # see scripts/rehearse-on-server.sh
```

Backfill checklist (run in this order, on the copy first):

1. `node scripts/backfill-bom-output-items.mjs --dry-run` — prints each legacy BOM, its
   `productName`, and the candidate output items it would link, plus the count that cannot
   be matched automatically.
2. Resolve the unmatched rows manually (create the FG/sub-assembly item, then run
   `--map <bomNo>=<itemCode>`); re-run `--dry-run` until nothing is unmatched.
3. Apply: `node scripts/backfill-bom-output-items.mjs --apply --by <email>`.
4. Confirm `SELECT COUNT(*) FROM Bom WHERE itemId IS NULL` is 0, then expand
   `GET /api/manufacturing/mrp/preview` and eyeball the warnings.
5. Only then approve revisions and let MRP drive purchasing.

## 4. API surface

| Route | Purpose |
| --- | --- |
| `GET /api/manufacturing/boms?projectId=&itemId=&status=` | BOM list with revision chain + stock check |
| `POST /api/manufacturing/boms` | Create DRAFT BOM (requires `itemId`) |
| `PUT /api/manufacturing/boms/[id]` | Edit a **DRAFT** BOM |
| `POST /api/manufacturing/boms/[id]/actions` | `approve` \| `revise` \| `cancel` |
| `GET /api/manufacturing/boms/where-used?itemId=` | Every live BOM consuming this item |
| `GET/POST /api/manufacturing/mrp` | List saved runs / compute + save a run |
| `GET /api/manufacturing/mrp/preview?asOf=&horizonDays=` | Dry run, nothing saved |
| `GET /api/manufacturing/mrp/[id]` | Snapshot with lines, warnings, `allowDocuments` |
| `POST /api/manufacturing/mrp/[id]/actions` | `create-documents` (selected lines) \| `close` |

The legacy `GET /api/manufacturing/material-plan` (work-order-only netting view) is kept
unchanged for the existing Material Plan tab and its regression assertions; MRP lives next
to it, not on top of it.
