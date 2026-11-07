# ForgeERP — Autonomous ERP Research, Audit & Improvement — Progress Report

**Branch:** `arena/c87300cc-erp` · **Base commit:** `cf7a911` · **Checkpoint:** 2026-11-07 (Asia/Kolkata)
**Status:** ACTIVE WORK IN PROGRESS — this is a saved checkpoint, **not** a final production sign-off.
**Safety:** No production database was connected, modified, migrated or deleted. All runtime tests used an isolated throwaway SQLite database at `tests/erp-test.db`. No deploy was run.

> User standing rules honoured: research before coding; preserve correct existing manufacturing logic; no destructive DB changes without backup/migration; no "working" claim without an executed test; continuous module-by-module execution, not just a report; independently identify what a practical manufacturer needs, not just what exists.

---

## 1. Mission & acceptance criteria (abridged)

Act as a complete senior ERP team: research established manufacturing ERPs, map the entire repo, audit lifecycles/calculations/DB/security/UI, create and **execute** tests, fix Critical → High → Medium → Low issues, regression-test, and document. Reference flows (Purchase Requisition→PO→GRN→QC→Invoice→Payment; Customer Order→Planning→BOM→WO→Job Card→Consumption→FG→Dispatch; Jobwork Inward→Process→QC→Outward→Billing) are **references, not assumptions** — the actual implemented processes must be discovered. Final objective: reliable, secure, scalable, professional manufacturing ERP with correct workflows, DB integrity, accurate calculations, usability, thoroughly tested functionality. Quality > feature count.

---

## 2. Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Full repo / architecture / module dependency map | **Done** (static map) — 397 files, 163 `src` files, 66 API routes, 1 Next page, 18 ERP UI components, 670-line MySQL Prisma schema / 33 models / no enums, 14 major `src/lib` services. |
| 2 | Industry + user-supplied research | **Substantially done, still partial.** ERPNext, Odoo, SAP Business One, Dynamics 365 Business Central, Mapsoft landing page, both YouTube playlists (metadata), and 2 of 3 GitHub repos reviewed. Video transcripts and full repo-by-repo code comparison remain. |
| 3 | Lifecycle / workflow audit | **Done for implemented flows** (sales, purchase, payment, jobwork, manufacturing, opening stock, reports, cancellation). Reference flows that do not exist are listed as gaps in §9. |
| 4 | Calculation / rule audit | **Done for implemented engine** (`erp.ts`, `accounting.ts`, `services.ts`, `manufacturing.ts`, `reports.ts`). Verified GST incl./excl., IGST vs CGST+SGST odd paisa, round-off, GSTIN checksum, weighted-average stock cost, append-only reversal GL, FY numbering, 5% jobwork tolerance, 10% task over-production, BOM wastage 0–50. |
| 5 | DB / backend / transactions / races | **Done + fixes.** 33-table FK map, transaction boundaries, conditional-update race guards added, FK-safe full restore. |
| 6 | Frontend / UI-UX | **Static review only.** No browser binary (`chromium`/`firefox`/`playwright`) is available in this sandbox, so button/form/modal/responsive/browser-console tests were **not executed**. 17 pre-existing React-19 ESLint effect-state errors documented, not refactored. |
| 7 | Security | **Executed subset.** Anonymous/forged-session 401, VIEWER write 403, platform-key-in-URL 401, login throttle 429, SQLi/XSS-style search 200, paid-invoice cancel guard, restore typed-confirm. Full IDOR/CSRF/file-upload/privilege-escalation matrix not completed. |
| 8 | Tests | **59/59 executed** HTTP + raw-DB checks on three runtimes (dev, `next start`, standalone production). No unit-runner added; suite is `node tests/erp-audit.mjs`. |
| 9 | Prioritised fixes + regression | **12 root causes fixed and regression-tested** (§5–§6). |
| 10 | Relevant improvements | **Partial.** Backup v3, validation helpers, offline build, type-safe build, concurrency guards, node start script. Large feature gaps remain (§9). |
| 11 | Final build / E2E / report | **Build + typecheck + API/DB regression done.** UI/E2E/responsive/browser-console, production MySQL runtime, live Mapsoft login **not done**. This document is the interim report. |

---

## 3. Architecture map (as discovered, not assumed)

- **Runtime:** Next.js 16.4.5 / React 19 / Turbopack, single-page module-registry app (`src/app/page.tsx` + `src/components/erp/*`), Prisma 6.11.1 declared (6.19.3 installed), Zod 4, Tailwind 4, shadcn/Radix.
- **Entry points:** `src/proxy.ts` signature/expiry gate; route-level `assertCompanyAccess`, `assertMutationAccess`, `assertFeature`, `requirePlatformAdmin` in `src/lib/platform.ts`; `src/lib/auth.ts` scrypt salt:hash + HMAC-SHA256 httpOnly 7-day session + DB `tokenVersion` revocation; `src/lib/ratelimit.ts` login throttle; `src/lib/api.ts` error mapping; `src/lib/audit.ts` append-only audit log.
- **Data:** MySQL provider, 33 models, String statuses, Float money with `r2()`, `@db.Text`/`@db.VarChar`. No `companyId` on business tables — explicitly documented as a single-workspace runtime with per-request tenant scoping on the roadmap.
- **Posting choke-points:** `src/lib/services.ts` (sales/purchase/payment/jobwork/opening/party-opening), `src/lib/manufacturing.ts` (Project→BOM→WorkOrder→ProductionTask), `src/lib/accounting.ts` (balanced GL + mirrored reversals), `src/lib/erp.ts` (GST/FY/formatting), `src/lib/reports.ts` (stock ledger, GSTR-1, trial balance, P&L, outstanding, dashboard).
- **Integrations:** Tally XML export (`src/lib/tally.ts`, `/api/tally/*`), IRP e-Invoice JSON (`/api/e-invoice`), JSON backup/restore (`/api/backup*`), PWA/service worker, platform-admin SaaS console (`/api/platform/*`).
- **Dependency chain:** `Party/Item/Warehouse/Process/Employee` → `Project` → `Bom` → `WorkOrder` → `ProductionTask` → `StockLedger(MFG_ISSUE)`; `JobworkInward` → `JobworkInwardItem` → `JobCard` → `JobCardProcess` → `JobworkCertificate`/`JobworkInvoice` → `SalesInvoice`; every posting writes `AccountLedger` and `AuditLog`.
- **Deployment drift:** `.env` contains `file:/home/z/my-project/db/custom.db` (absent) while schema is MySQL; `.zscripts/dev.sh` runs destructive `prisma db push --accept-data-loss`; `deploy.py` has stale SQLite comments, `--reset-db`, and targets a VPS; `.zscripts/build.sh` hardcodes `/home/z/my-project` and requires `bun`. **None were executed.**

---

## 4. Research findings (Phase 2)

**ERPNext** — multi-level/versioned BOM with operations, workstations, scrap %, source/WIP/target warehouses; Work Order from Production Plan/Sales Order tracks transferred vs consumed; Job Cards with time logs, completed/rejected qty; Finish posts Manufacture Stock Entry; mandatory QC templates can block receipt; batch/serial traceability, approvals, India GST/e-Invoice/e-Way Bill, subcontracting ITC-04.

**Odoo** — MO Draft→Confirmed→In Progress→Done→Canceled; reservation on confirmation; routing operations generate sequenced work orders at work centers; start blocked without reserved material; actual consumption/scrap vs BOM; FG enters stock only on Done; QC points can block and trigger rework; lot genealogy; actual material/labour/machine costing.

**SAP Business One** — Item/BOM → MRP → Production Order Planned→Released → Issue for Production → Receipt from Production/backflush → Close; pitfalls: releasing without stock, mixing manual/backflush, leaving WIP open, reporting from the order instead of the immutable stock ledger.

**Dynamics 365 Business Central** — production BOM + routing + work/machine centers; statuses Simulated→Planned→Firm Planned→Released→Finished; consumption via manual / forward / backward flushing; output + scrap journals; reversals are negative quantities in the **same journal**, supervisor-reviewed; Production Order Statistics shows expected vs actual material/capacity cost and variances; subcontracting, quality, capacity load, Power BI manufacturing app [1](https://learnbc.today/how/business-central-manufacturing-sop/) [2](https://www.d365training.com/post/business-central-manufacturing-how-the-production-order-process-works) [3](https://github.com/MicrosoftDocs/dynamics365smb-docs/blob/main/business-central/production-manage-manufacturing.md).

**Mapsoft ERP** — cloud SMB ERP for distributors/light manufacturers; advertised modules: inventory, manufacturing, sales/POS/CRM, purchase, accounting, services, marketing, HR, real-time insights [1](https://maptechsoft.com/erp/). Its demo login page was fetched read-only (`https://demo.mapsofterp.in/App/` → "Welcome / All-in-One Business Platform / Sign In"). **Credentials were NOT submitted**: the available page tool performs GET only, the demo host is blocked from the shell, and putting a password in a URL would leak it. No destructive action on a live demo DB was attempted. Independent manufacturing-module references emphasise production planning from sales orders, BOM, routing, QC parameters, scrap/rework reporting, lot/FIFO inventory, critical-stock alerts, vendor evaluation and preventive maintenance [2](https://www.focussoftnet.com/us/manufacturing-management-module) [3](https://mapolbs.com/enterprise-resource-planning).

**User-supplied GitHub repos** — `akashshinde700/erpnashilk` is a **closely related, actively developed sibling ("ManuFlow ERP")** with 93 commits, a read-only Tally connector, universal XML/JSON/XLSX import with XXE protection, Cash & Bank module (`MoneyAccount`/`AccountTxn`/`Loan`/`Expense`), IST business-date normalisation, tenant isolation, refunds, negative-cash guard, idempotency, 190+ tests and mobile E2E specs (`https://github.com/akashshinde700/erpnashilk`, `PROJECT_STATUS.md`). `IamRamgarhia/Free-GST-Billing-Software` is an offline-first GST invoicing reference with GSTR-1/3B, quotations, credit notes, 22 currencies, daily backups and an explicit "no cloud / no tracking" security model (`https://github.com/IamRamgarhia/Free-GST-Billing-Software`). These are **reference points, not code to copy**: the sibling's maturity is used below only to identify gaps in this checkout.

**YouTube playlists** — Absolute ERP (42 videos: BOM, routing, raw material, production processes, workgroups, multi-level inventory, GRN-against-PO, payment schedule against SO, quality inspection DFD, jobwork DFD) and Vyapar Desktop Demo LIVE (9 billing demos). Playlist metadata fetched; **transcripts/watching not performed**.

---

## 5. Executed baseline audit (before fixes)

`node tests/erp-audit.mjs` against a live local server with real HTTP + direct `better-sqlite3` reads: **23/30 passed, 7 failed**.

| Failed check | Observed | Root cause |
|---|---|---|
| invalid invoice date | 500 | `new Date('not-a-date')` → Invalid Date → Prisma error |
| GSTR-1 `month=2026-99` | 500 | no month validation before report period |
| P&L `from/to=garbage` | 500 | no range validation |
| unknown `warehouseId` | 500 | unvalidated FK → P2003 |
| party `stateCode:'XX'` | 200 accepted | `z.string().length(2)` only, no GST code range |
| backup snapshot | missing manufacturing/platform tables | v2 export covered 17 tables of 33 |
| backup restore | 500 P2003 | `tx.party.deleteMany()` before child rows; legacy snapshot would also erase newer data |

Passing baseline included: anonymous/forged 401, 27 read endpoints 200, seeded trial balance ₹1,761,504.01 Dr=Cr, independent GST hand-calc (2×₹500 −10% @18% → ₹900 / ₹1,062), sales GL Dr=Cr=₹1,062, negative-stock 400, over-allocation 400, jobwork over-processing 400, VIEWER read 200 / write 403, SQLi/XSS-style search 200, login throttle 429, concurrent task completion `200,400` with one `MFG_ISSUE`, final trial balance ₹1,762,566.01.

---

## 6. Fixes implemented and regression-tested

| # | Severity | Root cause | Fix |
|---|---|---|---|
| 1 | Critical | Unvalidated date/month/period strings corrupt FY numbering and produce 500s | New `src/lib/validation.ts`: real-calendar `isValidDateString` (rejects rollover `2026-02-30`), `dateString`, `optionalDate`, `nullableDate`, `monthString`, `gstStateCode`, `dateQueryError`, `dateRangeError`. Wired into 14 voucher routes, `reports/route.ts` (stock-ledger/GSTR-1/trial-balance/P&L), sales/purchase list filters, `/api/e-invoice`, `/api/tally/bulk`, and service-level `iso()` in `services.ts` + `manufacturing.ts`. Sales/purchase filters now use UTC day boundaries. |
| 2 | High | Unvalidated warehouse FK | `resolveWarehouseId()` in `services.ts` validates existence + active before any of the 4 stock-posting paths; clear 400. |
| 3 | High | Invalid GST state/place-of-supply accepted | `gstStateCode` applied to party create/update, company profile, and sales `pos`. |
| 4 | Critical | Backup silently lost 16 tables | `GET /api/backup` now emits **version 3** with all 33 model families incl. employees/projects/BOMs/work orders/tasks/platform console, with `counts`. |
| 5 | Critical | Restore failed on FKs / would erase production history | `POST /api/backup/restore` rewritten: children→parents wipe over the full schema, parents→children insert, nested line restoration, 60 s transaction, typed `RESTORE`, `orgUsers` guard (prevents anonymous-bootstrap takeover), **v1/v2 snapshots refused** when manufacturing data exists, and a bad snapshot rolls back atomically (verified 409 with zero row-count change). |
| 6 | High | Duplicate allocations to one invoice in a single payment | `postPayment` rejects repeated `invoiceType:invoiceNo`; verified 400. |
| 7 | High | Lost-update races on `paidAmount` and jobwork `processedQty` | Conditional `updateMany` with stale-value guards in `postPayment` and `postJobCard`; concurrent full-quantity cards now produce `200,400`, processedQty 10, billed 10, 1 card. |
| 8 | High | Concurrent task completion double material issue | Conditional status claim inside the manufacturing transaction (MySQL-safe; SQLite baseline already passed). |
| 9 | High | Manufacturing schedule / BOM internal validation gaps | `createWorkOrder`/`updateWorkOrder` reject end-before-start; `updateBom` re-validates qty/wastage/rate at the service boundary. |
| 10 | High | `next build` failed offline (Google Fonts fetched at build time) | Self-hosted `public/fonts/Geist-Variable.woff2` + `GeistMono-Variable.woff2` via `next/font/local`; identical typography, zero external build dependency. |
| 11 | Medium | `typescript.ignoreBuildErrors:true` hid type errors | Set to `false`; `tsconfig.json` excludes only the optional `examples/` + `mini-services/` demo folders (missing `socket.io` types); added `npm run typecheck`. Build now runs TypeScript (15.5 s) and passes. |
| 12 | Medium | `start` script required absent `bun` | `NODE_ENV=production node .next/standalone/server.js`; added `npm run test:audit`. |

**Files changed:** `src/lib/validation.ts` (new), `src/lib/services.ts`, `src/lib/manufacturing.ts`, `src/app/api/{backup,backup/restore,reports,e-invoice,tally/bulk,sales-invoices,purchase-invoices,payments,inventory/opening,jobwork/*,manufacturing/*,masters/*}/route.ts`, `src/app/layout.tsx`, `next.config.ts`, `tsconfig.json`, `package.json`, `.gitignore`, `public/fonts/*`, `tests/*`. `prisma/schema.prisma` **untouched** — no migration, no DB change.

---

## 7. Verification actually executed (no unexecuted claims)

| Check | Command / runtime | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| ESLint (all changed files) | `npx eslint <changed files>` | **0 errors** |
| ESLint (whole repo) | `npx eslint .` | **17 pre-existing errors** — `react-hooks/set-state-in-effect` in 9 UI files; documented, not hidden |
| Production build | `npm run build` (with test-only WASM adapter preload) | **exit 0**, compiled, TypeScript validated, 46 static pages, 66 dynamic routes, standalone assets copied |
| Production server | `npx next start` then `node .next/standalone/server.js` | both **200** on `/` and `/api/auth/status`; font asset 200 `font/woff2` |
| API + raw DB suite | `node tests/erp-audit.mjs` | **59/59 passed, 0 failed** on each of: Turbopack dev, `next start`, standalone production |
| Trial balance | end of suite | **₹1,762,684.01 Dr = Cr, balanced** |
| Backup round-trip | v3 snapshot → restore | all business + manufacturing counts preserved, org logins preserved, trial balance balanced |
| Rollback proof | duplicate-company corrupt snapshot | 409, **zero** partial wipe |
| Legacy safety | v2 snapshot → restore | 400, **zero** rows changed |
| Cancellation | sale cancel, paid-invoice cancel, payment cancel | stock restored, 8 append-only GL reversal rows, live GL net 0, paid invoice blocked until payment cancelled |
| Race | 2× task complete, 2× job card | one winner each; exactly 1 `MFG_ISSUE`, 1 job card |

Evidence: `tests/audit-results.json` (gitignored), console logs in `/tmp/erp-audit-*.log`, `/tmp/erp-build*.log`.

**Not executed — explicitly NOT claimed as passed:** any UI click/form/modal/responsive test, browser console check, Playwright/E2E run, screenshot comparison, production MySQL connection, migration, deploy, live Mapsoft login, video transcript review. Reason: no browser binary or Playwright install; Prisma native engine downloads are blocked in this sandbox; demo host is not reachable from the shell.

---

## 8. Prioritised remaining issue list

### Critical (open)
- **C1 Production runtime unproven.** `prisma/schema.prisma` is MySQL; `.env` points to an absent SQLite file; native Prisma engine downloads are TLS-blocked here; the local client is generated from `tests/schema.sqlite.prisma` (test-only). Before any deploy: provision MySQL, regenerate the client from the production schema, create a migration from the 33-model schema, verify a backup, and run the 59-check suite against MySQL. **No production DB was touched.**
- **C2 No migration strategy.** `db:push --accept-data-loss` in `package.json` and `.zscripts/dev.sh`; no `prisma/migrations/`. A schema change today would need a reviewed migration + verified backup, not a push.
- **C3 Full tenant isolation absent.** Business tables have no `companyId`; `src/lib/platform.ts` documents single-workspace operation. Multi-org SaaS claims in the platform console are not backed by row-level scoping. Architectural change — deliberately not attempted without approval.

### High (open)
- **H1 UI/E2E/responsive/browser-console verification gap** (no browser available). Historic `docs/TESTING_REPORT.md` claims are prior-session results, not re-verified here.
- **H2 Feature gaps vs practical manufacturing** (see §9) — the largest remaining business risk.
- **H3 `deploy.py --reset-db`** can drop live tables; stale SQLite default/comments conflict with MySQL schema. Reconcile before deploy.
- **H4 Float money** — `r2()` discipline is consistent and tests pass, but Decimal is the correct long-term type; changing it is a breaking migration.
- **H5 Demo credentials** (`forge123`, `platform123`) are shown in `login.tsx`/`platform.tsx` when `status.demoHint`; seed creates a default OWNER. Production bootstrap must force a password change.

### Medium (open)
- **M1** 17 pre-existing `react-hooks/set-state-in-effect` ESLint errors in `accounting.tsx`, `invoice-module.tsx`, `jobwork.tsx`, `masters.tsx`, `palette.tsx`, `platform.tsx`, `tally.tsx`, `ui/carousel.tsx`, `hooks/use-mobile.ts`. They indicate synchronous setState in effects (cascading renders). Not refactored to avoid redesigning working forms; no runtime failure observed in HTTP tests.
- **M2** `reactStrictMode:false` — hides double-invocation bugs.
- **M3** `docs/` historical reports drift from current code; not fully reconciled.
- **M4** Exhaustive IDOR / CSRF / file-upload (`upload/`, `download/`) / rate-limit-per-route / privilege-escalation matrix not completed.
- **M5** Mapsoft demo login not performed (read-only landing page only).
- **M6** YouTube transcripts not reviewed; playlist metadata only.

### Low (open)
- `package-lock.json` is untracked (kept for reproducibility; sibling repo ignores it because it uses bun).
- `tests/erp-test.db` and `tests/audit-results.json` are now gitignored runtime artifacts.
- `.zscripts/build.sh` hardcodes `/home/z/my-project` and uses `bun`.
- `mini-services/` is only `.gitkeep`; `examples/websocket` has unresolved optional `socket.io` deps (excluded from app typecheck).

---

## 9. Independent "what a manufacturer needs" gap analysis

Present in this checkout: Item/Party/Warehouse/Process/Employee masters, opening stock, purchase & sales invoices with GST, payments + allocation, append-only stock & GL ledgers with reversals, jobwork inward→card→certificate→invoice, Project→BOM→WorkOrder→ProductionTask with material issue, trial balance / P&L / GSTR-1 / stock ledger / outstanding / dashboard, Tally & IRP exports, audit log, RBAC (OWNER/ACCOUNTANT/VIEWER/SUPER_ADMIN), platform SaaS console, JSON backup.

**Absent or materially thin (reference-driven, not assumptions):**
1. Purchase Requisition → PO → approval → GRN → QC → purchase invoice; partial receipts, pending qty, vendor returns/debit notes.
2. Quotation / Sales Order / availability check / delivery challan / dispatch; order-to-production link.
3. MRP / production planning from sales orders; purchase suggestions; low-stock alerts; reorder logic; inventory ageing.
4. Multi-level BOM, BOM versioning/ECO, routing & operations with work/machine centers, capacity planning, time logs, WIP warehouse.
5. Finished-goods receipt into stock, planned vs actual consumption, wastage/scrap/rework capture, by-products, production cost & variance, efficiency/operator/machine reports.
6. QC inspection templates that can block receipt/production/delivery; non-conformance; batch/lot/serial traceability; FIFO valuation.
7. Approvals workflow, notifications, role dashboards, MIS reports, vendor performance, customer outstanding ageing.
8. Credit/debit notes, sales/purchase returns, refunds, advances (present in the sibling `erpnashilk` project, absent here).
9. Cash & Bank / expenses / loans / post-dated cheques / IST business-date normalisation (present in sibling, absent here).
10. Universal data import (XML/JSON/XLSX with XXE protection), read-only Tally connector, idempotency keys, per-module read permissions (present in sibling, absent here).
11. Multi-tenant row-level scoping, Decimal money, migrations, offline-first backup verification, rate limiting per route.

These are **candidates**, not a mandate to copy: the sibling repo proves the owner's own product line already has several of them, so a future phase should reconcile/merge deliberately rather than rebuild from scratch.

---

## 10. Build / DB / security / performance summary

- **Build:** PASS (exit 0, TypeScript enabled, 66 API routes + 46 static pages). Fonts self-hosted; no network needed at build.
- **DB changes:** **none to production schema or data.** `prisma/schema.prisma` untouched; no migration; isolated test DB only. Backup/restore logic changed in application code.
- **Security:** fixed invalid-input 500s, FK 500s, invalid GST codes, query-string platform key (401), legacy/corrupt restore data loss, anonymous-bootstrap-after-restore gap, duplicate allocations, concurrency double-posting. Remaining: tenant scoping, production secret/env strategy, demo credentials, full IDOR/upload matrix.
- **Performance:** no benchmark run. Conditional `updateMany` guards add one indexed write per posting; full restore now uses one 60 s transaction instead of a partial wipe; report list filters use indexed date ranges. Sibling project notes that per-request full-ledger history needs DB-side aggregation as data grows — same risk applies here.

---

## 11. Workspace / deliverables

- **This checkpoint:** `PROJECT_AUDIT_PROGRESS.md` (required by the user's execution rules).
- **Executable suite:** `tests/erp-audit.mjs` (`npm run test:audit`); writes `tests/audit-results.json`.
- **Local test harness (test-only, never a production migration):** `tests/make-local-schema.py`, `tests/schema.sqlite.prisma`, `tests/prisma.local.config.ts`, `tests/register-local-adapter.cjs`, `tests/erp-test.db`.
- **Live preview:** standalone production server on port 3000 (`ForgeERP Production Standalone`), isolated SQLite test DB, no production data.
- **Changed production source:** see §6.

---

## 12. Immediate next steps (continue from here)

1. Re-run `npm run typecheck`, `npm run build`, `npm run test:audit` after every further change (all three currently green).
2. Provision a real MySQL instance; regenerate Prisma client from `prisma/schema.prisma`; create a reviewed initial migration; replay the 59-check suite against MySQL. Close C1/C2.
3. Install a browser runtime (Playwright + Chromium) and execute `tests/e2e_playwright.py`-style UI, responsive (390/768/1440 px), double-submit, form-reset, empty/error/loading, console-error and print/export checks. Close H1.
4. Resolve the 17 ESLint effect-state errors with `useSyncExternalStore` / derived state, enabling `reactStrictMode:true`.
5. Reconcile `deploy.py` / `.zscripts/*` / `.env` with the MySQL schema; remove `--reset-db` from unattended paths; force production password rotation.
6. Decide, with the owner, which §9 gaps to implement first (recommended: MRP/low-stock + purchase/sales order lifecycle + QC + production costing), preferring a deliberate merge from `erpnashilk` over a rewrite.
7. Complete Mapsoft read-only login check if a POST-capable browser session becomes available; review video transcripts; finish docs↔code reconciliation.
8. Only then produce the final sign-off report with total modules audited, issue counts by severity, fixes, remaining issues, improvements, test results, build status, DB changes, security and performance findings.
