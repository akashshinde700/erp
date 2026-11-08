# ForgeERP — Full Runtime Audit, 2026-11-08

Branch `audit/full-runtime-2026-11-08`, based on `main` @ `7ffadb9` (PR #16 merged
at `9e16fe8` plus the P0 migration baseline). Every result below was executed
in this session and its raw output retained; nothing is inferred from earlier
audit text.

## 1. Executive summary

The PR #16 workflows (procurement, quote-to-cash, production receipt/WIP,
quality, lots/serials, returns, advances/refunds, GST exports) were run end to
end against a disposable MySQL 8.0.46 database, through real HTTP requests to
the production build, with raw-SQL reconciliation after every phase.

The first run passed **265 of 305** workflow checks. It exposed two critical
defects that would have hit production immediately:

- every GRN-backed purchase invoice and dispatch-backed sales invoice failed
  with a duplicate-number 409 as soon as any ordinary invoice existed (always
  true on the live database);
- two concurrent advance applications overpaid an invoice (6,000 paid against
  5,900).

Those and 22 further defects are fixed. The final run on a fresh database:
**409 workflow checks, 408 pass**; the one failure is the genuine, unfixed
multi-company isolation gap. Legacy API suite 72/72, backup/restore drill
18/18, browser E2E 68/68 at three viewports, typecheck and lint clean, build OK,
three migrations replay from empty with zero drift.

**Verdict: READY FOR STAGING** (see §19).

## 2. Environment

| Item | Value |
|---|---|
| OS | Windows 11 (dev workstation) |
| Node / npm | v22.20.0 / 11.7.0 |
| Prisma CLI / client | 6.19.3 / 6.19.3 |
| Next.js | 16.4.5 (Turbopack), `output: standalone` |
| Database | MySQL 8.0.46 in Docker (`mysql:8.0`, utf8mb4_unicode_ci, sql_mode includes STRICT_TRANS_TABLES and ONLY_FULL_GROUP_BY) |
| Databases used | `forgeerp_audit` (iteration), `forgeerp_final` (final gates), `forgeerp_empty`, `forgeerp_bf` (backfill fixture), `forgeerp_shadow` — all disposable, container-local |
| Browser | Chromium 1248 (Playwright 1.65), headless |
| Production DB | **not connected, not migrated** |

## 3. Commits audited and produced

Audited: `main` @ `7ffadb9`. Produced on the audit branch:

| Commit | Content |
|---|---|
| `58b5760` | Migration: refund counter, allocation reversal fields, active-only supplier doc uniqueness, idempotency table |
| `f1beb66` | Controlled invoicing collisions, payment races, correction paths |
| `c0d40de` | Lot/serial integrity: FEFO, cycle guard, serials at dispatch |
| `8ca9808` | Production receipt WIP settlement by produced quantity |
| `083e0a5` | GST: credit/debit notes in GSTR-1 and GSTR-3B |
| `989bb42` | Idempotency-Key on document POSTs; malformed JSON is 400 |
| `63c963c` | Workflow audit suite |
| `5d5b7b8` | UI: lint errors, double submit, overflow, touch targets |
| `78497af` | Browser E2E, volume probe |
| (this doc) | Report, runbook, progress log |

## 4. Commands run (final gate, fresh database `forgeerp_final`)

```
npm ci                                   -> 856 packages, exit 0
npx prisma format                        -> no change
npx prisma validate                      -> valid
npx prisma generate                      -> generated 6.19.3
SELECT DATABASE(), @@version             -> forgeerp_final, 8.0.46
npx prisma migrate deploy                -> 3 migrations applied from empty
npx prisma migrate status                -> Database schema is up to date!
prisma migrate diff --from-url <db> --to-schema-datamodel      -> empty
prisma migrate diff --from-migrations --to-schema-datamodel --exit-code (shadow) -> 0
npm run typecheck                        -> 0 errors
npm run lint   (eslint .)                -> 0 problems
npm run build                            -> OK
git diff --check                         -> clean
npm run test:audit                       -> 72/72
node tests/workflow-audit.mjs            -> 408/409
node tests/backup-drill.mjs              -> 18/18
node tests/e2e-browser.mjs               -> 68/68
```

The first `npm ci` attempt failed with `EPERM unlink lightningcss…node`: an
orphaned `next dev` process from this session held the native module. Its
four processes were stopped and the whole gate sequence was rerun from the
start; nothing downstream of the failed attempt is counted.

## 5. Migration result

| Migration | Content | Verified |
|---|---|---|
| `20261106000000_init` | 33 tables = the schema live was built with by `db push` | applied alone == `cf7a911` schema, no drift |
| `20261107180328_complete_business_workflows` | 27 tables, 6 nullable/default columns, 1 unique, 73 FKs | additive only |
| `20261108090000_finance_reversal_and_document_uniqueness` (new) | `ReturnDocument.refundedAmount`, `PaymentAllocation.kind/reversedAt/reversalReason`, `PurchaseInvoice.activeSupplierInvoiceNo`, `GoodsReceipt.supplierDocKey`, `IdempotencyKey` table; unique keys replaced | see below |

The Prisma-generated SQL for the new migration was **rejected after review**:
it dropped `GoodsReceipt_companyId_fkey` without re-adding it and tried to
re-add an FK that already existed. The committed SQL is hand-staged: additive
columns, deterministic backfill, new indexes created before the old unique
keys are dropped (no FK loses its supporting index).

Backfill proven on a fixture database with active and cancelled rows:
refunded total = 300 + 150 with a cancelled 200 refund excluded; active
supplier invoice/challan keys set, cancelled ones NULL; afterwards the DB
rejects an active duplicate, accepts re-entry of a cancelled bill's number and
accepts the same challan number from a different supplier. Replays from empty,
on a populated database and on the fixture all end with zero drift and four
intact FKs.

Rollback is restore-from-dump (`deploy.py` dumps before migrating). All three
migrations are additive for existing data, so a code-only rollback also runs
on the migrated schema.

## 6. Static quality gates

| Gate | Before | After |
|---|---|---|
| typecheck | 0 (after P0) | 0 |
| lint | 17 errors (`react-hooks/set-state-in-effect`) | 0, rule not disabled |
| build | OK | OK |

The 17 lint errors were real effects copying props into state. Fixed with a
render-phase `useResetOnChange` hook (React's documented pattern),
`useSyncExternalStore` for `matchMedia`, embla and `window.location`, a derived
palette result and callback-started initial loads. Browser E2E confirms the
changed dialogs still prefill and reset.

## 7. API / workflow test results

`tests/workflow-audit.mjs` — HTTP plus raw SQL, global reconciliation after
every phase.

| Phase | Before fixes | Final |
|---|---|---|
| Setup | 28/28 | 28/28 |
| P5 auth / tenant | 43/45 | 44/45 |
| P6 Purchase-to-Pay | 26/33 (aborted) | 72/72 |
| P7 Quote-to-Cash | 32/39 (aborted) | 68/68 |
| P8 Manufacturing / WIP | 47/50 | 50/50 |
| P9 Quality | 31/34 | 35/35 |
| P10 Lots / serials | 31/36 | 42/42 |
| P11 Advances / refunds / reversals | 9/15 (aborted) | 38/38 |
| P12 GST | 6/9 | 12/12 |
| P13 Fuzzing (304 hostile requests) | 0/2 | 4/4 |
| **Total** | **265/305** | **408/409** |

"Before" counts include a few failures that were mistakes in my own test
fixtures (e.g. a fully received PO reused, a comparison against a summed
number the report does not publish); those tests were corrected, not the
product. The remaining failure is §13.

Legacy `tests/erp-audit.mjs` (now database-agnostic): 72/72 on MySQL.

## 8. Browser E2E

`tests/e2e-browser.mjs`, production build, 390x844 / 768x1024 / 1440x900:
sign-in through the UI, keyboard focus visibility, all 11 modules, the four
workflow workspaces, party edit prefill and re-open, duplicate-invoice
prefill, Receive Payment preset, command palette search and reset, triple-click
Save, console/hydration/page errors and 5xx responses.

First production run: 15/20 with harness issues; real findings were a 120 px
horizontal overflow on Reports at 390 px, 24 undersized touch targets and 409
toasts from a triple-clicked Save. All fixed. Final: **68/68**.

Not exercised: print preview (headless Chromium does not open the print
dialog), file downloads, offline behaviour, screen-reader announcements.

## 9. Workflow-by-workflow

| Workflow | Stock effect | GL effect | Cancel / reversal | Result |
|---|---|---|---|---|
| Requisition → PO | none | none | requisition cancel | pass |
| GRN → inward QC | accepted qty only, lot receipt | none | append-only stock + lot reversal; blocked if billed or consumed | pass |
| GRN-backed purchase invoice | none (no double stock) | Dr PURC + input GST, Cr CRED | releases billed qty; re-entry of supplier no. allowed | **fixed** (was 409) |
| Purchase return / debit note | stock out (FEFO lots) | Dr CRED, Cr PURC + GST | blocked while refunded | pass |
| Quotation → SO → challan → dispatch QC | accepted qty out | none | challan cancel reverses stock + lots + serials | **fixed** over-dispatch |
| Dispatch-backed sales invoice | none | Dr DEBT, Cr SALS + GST | releases invoiced qty | **fixed** (was 409) |
| Sales return / credit note | restock | Dr SALS + GST, Cr DEBT | blocked while refunded or stock gone | pass |
| Task completion | material out (FEFO) | Dr WIP, Cr STKV + LABP | — | pass |
| Production receipt | accepted FG in, lot + serials, genealogy | Dr STKV, Cr WIP, ± MFGV | blocked after consumption; mirrored GL | **fixed** WIP settlement |
| Work-order close | — | — | needs FG + fully settled WIP | pass |
| Quality templates / inspections | — | — | versioned; failed inspection blocks GRN acceptance | **fixed** source of truth |
| Lots / serials / recall | — | — | recursive recall, cycle-safe genealogy | **fixed** |
| Advances | — | none on application | reversible application (new) | **fixed** race |
| Refunds | — | Dr DEBT/Cr cash or Dr cash/Cr CRED | cancel-refund with mirrored GL (new) | **fixed** race |
| Payment schedules | — | — | replace before dispatch | pass; milestone collection not implemented |
| GSTR-1 / GSTR-3B / HSN | — | — | — | **fixed** credit/debit notes |

## 10. Accounting reconciliation

After every phase and at the end: every voucher balanced in both its active
and cancelled sets; trial balance Dr = Cr; invoice header = Σ lines + round-off;
`paidAmount` = active allocations; no invoice paid beyond its total; advance
applied within [0, original]; refunds ≤ note value; completed work orders have
WIP fully settled; no duplicate document numbers. All pass in the final run.
Cancellations write mirrored rows; no ledger row was deleted.

## 11. Stock and lot reconciliation

No negative stock per item/warehouse, no negative lot, lot balances never
exceed the stock-ledger balance per item/warehouse, GRN billed ≤ accepted and
accepted + rejected = received, challan invoiced ≤ accepted. The
lot-above-stock invariant failed before the fix (sales of lot-tracked FG
through plain invoices left 9 units in lots with 0 in stock).

## 12. Security

| Check | Result |
|---|---|
| Anonymous GET / POST on 8 workflow routes | 401 |
| Forged session cookie | 401 |
| Revoked session (tokenVersion bump) | 401 |
| Viewer mutation on 7 routes | 403 |
| Suspended organisation | 403 |
| Expired subscription | 403 |
| Second organisation's owner on 10 business routes and by invoice id | 403 |
| Platform-admin session on organisation data | refused |
| Organisation owner on platform routes | refused |
| 304 malformed / hostile requests | all controlled 4xx (malformed JSON was 500 before) |
| Duplicate POST with one Idempotency-Key | one document, replayed response, 422 on a different body |

## 13. Tenant isolation — critical, not fixed

> **Update:** closed on branch `feature/tenant-isolation-and-gaps`; see
> `docs/GAP_CLOSURE_REPORT_2026-11-08.md`.

37 business tables have no `companyId` (AccountLedger, AuditLog, Bom, BomItem,
Counter, DeliveryChallanLine, Employee, GoodsReceiptLine, Item, JobCard,
JobCardProcess, JobworkCertificate, Party, Payment, PurchaseInvoice,
SalesInvoice, StockLedger, Warehouse, WorkOrder, ProductionTask and others).
Services resolve "the operating company" as the first non-platform company.

What is proven: a second organisation's users are refused (403) on every
business route, so no cross-organisation read was possible in this audit.
What follows: one deployment can serve exactly one organisation. Multi-tenant
SaaS on one database needs the companyId migration, scoped unique keys, a
session-company resolver and isolation tests. This is the reason the verdict
is not production.

## 14. Performance (10k stock rows, 2k invoices, 1k lots, 5k serials, 1k tasks)

All 18 heavy endpoints answered in under 400 ms median (dashboard 312 ms,
action center 259 ms, traceability 261 ms). The risk is payload growth from
unpaginated lists:

| Endpoint | Payload |
|---|---|
| `/api/traceability` (every lot with movements and serials) | 3.0 MB |
| `/api/sales-invoices` | 1.1 MB |
| `/api/manufacturing/tasks` | 0.7 MB |

Recommendation: server-side pagination and filtering for these three, and
counts instead of full serial lists in the traceability dashboard. Not changed
in this audit.

## 15. Defects by severity

| # | Severity | Defect | Status |
|---|---|---|---|
| 1 | Critical | Controlled purchase/sales invoices drew from a separate counter and collided with the legacy series (409 on every post) | fixed |
| 2 | Critical | Concurrent advance applications over-applied the advance and overpaid the invoice | fixed |
| 3 | Critical | No row-level multi-company isolation (37 tables) | **open** |
| 4 | High | WIP shared by accepted qty: any QC rejection made the work order impossible to close | fixed |
| 5 | High | Several open challans could over-commit a sales order | fixed |
| 6 | High | Un-batched issues left lots above stock; recalled units sellable through a plain invoice | fixed |
| 7 | High | GSTR-1 / GSTR-3B ignored credit and debit notes | fixed |
| 8 | High | Refunds read-then-write without a guard (race could exceed note value) | fixed |
| 9 | High | Invoice cancel orphaned posted credit/debit notes; return cancel orphaned refunds; generic payment cancel on a refund left REFUND GL unreversed | fixed |
| 10 | Medium | Supplier challan unique across suppliers and after cancellation; cancelled supplier bill number not re-enterable | fixed (migration) |
| 11 | Medium | Multi-hop lot genealogy cycles accepted | fixed |
| 12 | Medium | Dispatch cancel revived a RECALLED lot | fixed |
| 13 | Medium | Serial-tracked dispatch left serials AVAILABLE; a serial could be issued twice | fixed |
| 14 | Medium | Failed parameterised QC did not stop GRN acceptance | fixed (latest inspection per item rules) |
| 15 | Medium | Malformed JSON returned 500 on every workflow route | fixed |
| 16 | Medium | No idempotency; triple-click produced duplicate POSTs | fixed (server key + client in-flight dedupe) |
| 17 | Medium | Receipt cancellation could drive a batch negative | fixed |
| 18 | Medium | Reports overflowed 390 px phones by 120 px | fixed |
| 19 | Medium | Unpaginated large payloads (§14) | open |
| 20 | Low | 17 `set-state-in-effect` lint errors | fixed |
| 21 | Low | Touch targets below 40 px | fixed |
| 22 | Low | Default zod messages ("Too small: expected array…") | fixed |
| 23 | Low | Duplicate supplier challan only rejected with a generic message | fixed |
| 24 | Low | Production receipt, advances, refunds and schedules have no UI (API only) | open |
| 25 | Low | Collections are not allocated to payment milestones, so "paid schedule cannot be replaced" is unreachable | open |

## 16. New API surface (catalogue delta)

| Route | Action | Purpose |
|---|---|---|
| `POST /api/finance-adjustments` | `reverse-advance-application` `{allocationId, reason}` | append-only reversal of one advance application |
| `POST /api/finance-adjustments` | `cancel-refund` `{paymentId, reason}` | cancel a refund with mirrored GL |
| `POST /api/order-to-cash` | `inspect-dispatch` lines accept `serialNumbers[]` | required for serial-tracked batches |
| all document POST routes | header `Idempotency-Key` | replay-safe double submit |
| `GET /api/reports?type=gstr1` | adds `cdnr`, `cdnur`, totals | credit notes |
| `GET /api/reports?type=gstr3b` | adds `outwardInvoices`, `creditNotes`, `inwardInvoices`, `debitNotes`; `outward` / `eligibleItcFromBooks` are now net | notes in liability and ITC |

## 17. Remaining blockers

> **Update:** items 1 and 3–5 are closed, and print/PDF is tested. Item 2 is
> rehearsed on a simulated dump; the real-dump run is still open. See
> `docs/GAP_CLOSURE_REPORT_2026-11-08.md`.

1. Multi-company isolation (§13).
2. Apply the three migrations to a staging copy of the live database and run
   the pre-flight duplicate query in `docs/MIGRATION_RUNBOOK.md` §4 against
   real data — not done here.
3. UI for production receipt, advances, refunds and schedules; RFQ; milestone
   allocation (user roadmap items 3–8).
4. Pagination for the three large endpoints.
5. Print preview and PDF output are untested.

## 18. Files changed

50 files, +1881 / −235: the new migration and schema; services in
`src/lib` (accounting, procurement, order-to-cash, services, returns,
finance-adjustments, traceability, manufacturing, production-output, reports,
api, idempotency, seed); 10 API routes; 20 UI components plus two hooks; four
test scripts.

## 19. Production-readiness verdict

**READY FOR STAGING**

Migrations, MySQL runtime, accounting and stock reconciliation, backup/restore,
security gates and browser E2E pass on disposable databases. Production is
ruled out by the open multi-company isolation gap, and a controlled pilot
should wait until the migration has been applied to a staging copy of the live
database with the pre-flight check clean.
