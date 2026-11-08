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

- **Live-database migration rehearsal remains outstanding.** The closure report records a simulated dump rehearsal, not a rehearsal against a protected copy of the actual production database. Verify which operating company owns legacy rows before any tenant migration/deployment.
- **Rotate database credentials if the tracked `.env` ever contained live credentials.** Removing it from the current Git tree does not erase prior Git history. Do not rewrite shared history as part of this change; rotate the credential at the database provider, then verify that all deployments use a secret manager/environment settings.
- **CI workflow is now added** at `.github/workflows/ci.yml`: generates Prisma Client, validates schema, deploys migrations to disposable MySQL, checks migration/schema drift, runs typecheck and lint. Its first GitHub Actions run is pending; API/workflow tests and browser E2E still need dedicated CI jobs.
- **Run staging pilot with actual operations users.** The reported browser automation is not a substitute for shop-floor feedback on GRN/QC, dispatch, FG receipt/serial capture, refunds, and print output.

### P1 — finish planning / engineering foundation

- **BOM output identity and immutable revisions.** Current `Bom.productName` is a free-text string and `BomItem` is a flat component list. Add a required output `itemId` (with carefully backfilled legacy records), immutable BOM revision/effective date, approve/supersede lifecycle, Where-Used and impact review. Do not mutate an approved revision in place.
- **Full MRP rather than MRP-lite.** This pass nets active-WO material demand against stock and open PO supply. Remaining: derive demand from approved Sales Orders, explode the order's output item through the effective BOM (including wastage), net open WOs, approved/unreceived PO supply and QC-accepted stock, then present dated shortage/planned-order suggestions. Keep suggestions non-posting until a user approves a PR/WO. Add reservations atomically before treating ATP as promised supply.
- **Routing and finite capacity.** Add operation/work-center/machine masters, setup/run/queue/move/inspection times, serial/parallel dependencies, shift calendars, maintenance downtime and operator time capture. Then compute load/capacity and true OEE with downtime reasons; current throughput/yield reports are not OEE.
- **Costing depth.** Core material/labour actuals and WIP settlement exist. Add configurable overhead allocation and expected-vs-actual cost roll-up per revision/operation, with accountant-reviewed postings and reversal tests.

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
