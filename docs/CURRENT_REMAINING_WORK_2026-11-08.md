# Current code audit and remaining implementation

**Date:** 2026-11-08
**Branch:** `arena/fb9b9a36-erp`
**Scope reviewed:** research-to-implementation mapping, full runtime audit + closure report, Prisma schema/migrations, API and service inventory, manufacturing material planning, tests, environment-file tracking. This is a source/repository audit, not a claim that a production database or every HTTP route was exercised in this turn.

## Work implemented in this pass

1. **Removed the tracked local `.env` from Git's index without deleting the user's local file.** `.env.example` now documents the required variable with a placeholder only. `.gitignore` already ignores `.env*`.
2. **Material plan now shows approved PO supply.** Active production material demand reports `incomingQty`, underlying PO numbers/dates, immediate `shortageQty`, and `projectedShortageQty` after open PO supply. PO supply is *not* counted as on-hand; only unreceived quantities on APPROVED/PART_RECEIVED POs are considered, and customer-owned `JOBWORK_IN` stock remains excluded. Query is restricted to the items in active production demand.
3. **Added workflow regression assertions** comparing material-plan PO supply with the database's open PO quantity and current stock, and checking projected shortage arithmetic.
4. **Reconciled `docs/RESEARCH_IMPLEMENTATION_MAPPING.md`** with newer code/closure evidence so completed FG receipts, QC, procurement, order-to-cash, returns, tenant tests, and E2E are no longer called missing.

## Current implemented baseline (from code + latest closure report)

- Tenant isolation, migration framework, purchase requisitions/orders, partial GRN + QC-gated stock, RFQ/quote award, sales quotation/order/dispatch/QC/invoice, returns/credit/debit notes, advances/refunds, payment schedules, production receipt, WIP settlement, lot/serial traceability, paging, and print/PDF have code and are described as tested in `docs/GAP_CLOSURE_REPORT_2026-11-08.md`.
- The manufacturing material plan previously netted only active WOs against owned on-hand stock. This change adds open approved PO supply to the *projected* view; it deliberately does not promise arrival or treat unchecked GRNs as owned available stock.

## Remaining work, in priority order

### P0 — protect live data and release safely

- **Live-database migration rehearsal remains outstanding.** The closure report records a simulated dump rehearsal, not a rehearsal against a protected copy of the actual production database. `scripts/staging-rehearsal.mjs` now *prints* every operating company with its per-table row counts and the legacy BOM/MRP readiness state, and asserts one live revision per output item — the rehearsal still has to be run on the real dump, and a human still has to confirm which company owns the legacy rows. **This is the next action, and it needs the production dump + staging database credentials, neither of which exist in this environment.**
- **Rotate database credentials if the tracked `.env` ever contained live credentials.** Removing it from the current Git tree does not erase prior Git history. Do not rewrite shared history as part of this change; rotate the credential at the database provider, then verify that all deployments use a secret manager/environment settings.
- **CI workflow is now added** at `.github/workflows/ci.yml`: generates Prisma Client, validates schema, deploys migrations to disposable MySQL, checks migration/schema drift, runs typecheck and lint. Its first GitHub Actions run is pending; API/workflow tests and browser E2E still need dedicated CI jobs.
- **Run staging pilot with actual operations users.** The reported browser automation is not a substitute for shop-floor feedback on GRN/QC, dispatch, FG receipt/serial capture, refunds, and print output.

### P1 — finish planning / engineering foundation

- ~~**BOM output identity and immutable revisions.**~~ **DONE 2026-11-10** — `Bom.itemId` (output item), `revision`, `effectiveFrom/effectiveTo`, `supersedesId`, `DRAFT → APPROVED → SUPERSEDED` lifecycle, revise-not-edit enforcement, Where-Used API. Legacy rows keep `itemId = NULL`, stay read-only and are linked with `scripts/backfill-bom-output-items.mjs`. Contract: `docs/MRP_AND_BOM_REVISIONS.md`.
- ~~**Full MRP rather than MRP-lite.**~~ **DONE 2026-11-10** (`src/lib/mrp.ts`) — approved/PART_DISPATCHED sales-order demand + released work-order demand exploded through the effective BOM revision (wastage, multi-level, cycle-guarded), netted against own stock (JOBWORK_IN excluded) → open WO output → approved unreceived POs → approved un-ordered requisitions, dated and earliest-need-first. Saved `MrpRun`/`MrpLine` snapshots create nothing; only a user-approved selection produces one DRAFT requisition and/or OPEN work orders. **Still open:** reservations/ATP — netting reduces planning supply but does not commit stock, so a quantity can be suggested twice by two plans (`docs/MRP_AND_BOM_REVISIONS.md` §2).
- ~~**Routing and finite capacity.**~~ **DONE 2026-11-11** — `WorkCenter` (+parallel capacity, cost/hour), `ShiftCalendar`/`Shift`/`ShiftHoliday`, `RoutingOperation` per BOM revision (setup/run-per-unit/queue/move/inspection), task snapshots (`workCenterId`, `plannedMinutes`), `finiteSchedule()` with lane capacity, route precedence and late-work-order reporting, `MachineDowntime` with reasons, and `oee.ts` (availability × performance × quality) that states its own limits. Contract: `docs/ROUTING_CAPACITY_OEE.md`. **Still open:** sequence-dependent changeover matrices, a persisted/frozen schedule, operator-skill matching, overhead roll-up per operation, holiday editing UI, and real MySQL + shop-floor validation. The scheduler is not automatic — it reports, the planner decides.
- ~~**Costing depth.**~~ **DONE 2026-11-12** — `src/lib/costing.ts`: three separate money buckets (material at issue cost, labour at the worker's snapshotted rate, overhead absorbed at `Company.overheadRatePct` of prime cost), absorbed inside the task-completion transaction (Dr WIP / Cr `OVHA` accrual), settled into the finished-goods receipt so WIP reaches zero on closure, `Bom.standardLabourCost`/`standardMinutes` frozen at approval, standard-vs-actual per work order with a pro-rata breakdown per operation, and an **idempotent true-up** that restates absorbed overhead to the current rate on a rate change and refuses a locked period. UI: Manufacturing → Costing (drill-down into operations, true-up with a confirmation that explains the posting). Contract and limits: `docs/MANUFACTURING_COSTING.md`. **Still open / deliberately not done:** no full standard-costing system (no frozen material rates, price-vs-usage split or revaluation at issue), no machine-hour absorption or fixed/variable split, no WIP ageing or period-end over/under-absorption write-off, no scrap account, and no accountant sign-off yet on the OVHA contra/reversal procedure.

### P2 — compliance / ownership depth

- GST research gap remains around full RCM, blocked ITC, exempt supplies, cross-utilisation and direct portal workflows. Existing GSTR reports/e-Invoice/e-Way Bill JSON must not be described as full statutory filing without accountant and portal validation.
- Customer-owned material is excluded from own stock valuation/availability in jobwork, but a general ownership ledger and reservations would be required before expanding consignment scenarios beyond that workflow.
- Real scale validation remains needed for the biggest reports, migration duration/locking, and backups/restores under production-like data volume.

## Audit/test evidence for this pass

- `npm ci --ignore-scripts --no-audit --no-fund`: passed.
- `npm run lint`: passed after the final material-plan edits.
- `npm run typecheck`: could not provide a valid source verdict because Prisma Client was not generated. `npx prisma generate` attempted to fetch Prisma engine artifacts from `binaries.prisma.sh`, which is inaccessible in this environment. Reported Prisma/type errors therefore include missing generated client types and are not accepted as confirmed source-code defects.
- Workflow/E2E suites require a running app and explicitly disposable MySQL databases; no database URL or production database was used. The added MRP workflow checks are committed as test code but require the normal disposable-MySQL workflow runner to execute.
- No live database, migration, staging tenant, or production credential was modified in this pass.

## Documentation drift found

- `docs/FULL_RUNTIME_AUDIT_2026-11-08.md` predates closure and still marks tenant isolation, some UI, pagination and print as open in sections 13/15/17.
- `docs/GAP_CLOSURE_REPORT_2026-11-08.md` reports those items closed, but still leaves the real-live-dump rehearsal and real-user pilot pending.
- `docs/RESEARCH_IMPLEMENTATION_MAPPING.md` had older P0 features marked missing despite the later closure report. That mapping is updated in this pass; the full audit should also be marked superseded rather than silently treated as current.
