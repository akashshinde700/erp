# ForgeERP — Autonomous ERP Research, Audit & Improvement — Progress Report

**Branch:** `arena/c87300cc-erp` · **Base commit:** `cf7a911` · **Checkpoint:** 2026-11-07 (Asia/Kolkata)
**Status:** ACTIVE WORK IN PROGRESS — this is a saved checkpoint, **not** a final production sign-off.

> **2026-11-07 Quality UI continuation (branch `arena/16264bf2-erp`):** Manufacturing now includes a Quality workspace with pass/fail/quarantine KPIs, inspection audit table, versioned template creation with dynamic numeric/text/boolean parameters, and measurement entry that invokes server-side automatic evaluation. Failed measurements remain non-acceptable and default to quarantine.

> **2026-11-07 traceability UI continuation (branch `arena/16264bf2-erp`):** Inventory now exposes a Lots & Serials workspace with live lot balances, warehouse, manufacture/expiry status, source document, available serial count and parent/child genealogy. A guarded recall action requires a reason and recursively recalls descendant lots/available serials.

> **2026-11-07 lot/serial genealogy continuation (branch `arena/16264bf2-erp`):** added company/item/warehouse-scoped lots, globally item-unique serials per company, append-only lot movements and parent→child production genealogy. QC-accepted GRN and FG batches create trace balances; dispatch validates lot availability/status/expiry and issues the selected batch; document cancellations reverse both stock and trace movements. Serial count must equal tracked quantity, duplicates are blocked, and recursive lot recall marks descendants and available serials recalled. Transfer UI/API, FEFO auto-selection and customer-facing recall UI remain pending.

> **2026-11-07 parameterised Quality Management continuation (branch `arena/16264bf2-erp`):** added company-scoped, item/inspection-type QC templates with immutable version increments and numeric/text/boolean parameters. Required measurements are type-checked and automatically evaluated against min/max, expected text or yes/no criteria; failed inspections cannot be accepted and default to quarantine. Durable measurements, inspector/time, disposition and pass/fail summaries are exposed through `/api/quality`. UI, sampling plans, instrument calibration, CAPA and migrated-schema runtime remain pending.

> **2026-11-07 Production FG/WIP continuation (branch `arena/16264bf2-erp`):** added company-scoped production receipts with production QC quantities, batch/dates, accepted-only FG stock, expected-versus-actual cost and WIP settlement GL. Task completion now capitalises material/labour into WIP; FG receipt settles WIP to inventory plus manufacturing variance. WO closure requires completed operations, QC-accepted output and fully settled actual cost. Receipt cancellation is append-only and blocked after FG consumption. UI, scrap/by-product stock disposition, migration generation and real-MySQL runtime remain pending.

> **2026-11-07 Quote-to-Cash UI continuation (branch `arena/16264bf2-erp`):** Sales now exposes a responsive Quote-to-Cash workspace for quotation revisions/status, submit/approval/SO conversion, SO ordered/dispatched/invoiced progress, approval with credit-limit enforcement, delivery/QC quantities and guarded challan cancellation. Party master now edits the customer credit limit (0 = unlimited). Complex create/revise/dispatch/invoice forms remain API-backed pending migrated-schema runtime verification.

> **2026-11-07 Quote-to-Cash foundation (branch `arena/16264bf2-erp`):** added company-scoped quotation revisions and approval, accepted quotation→sales order conversion, SO approval, partial delivery challans, dispatch QC, accepted-only stock issue and over-dispatch/availability guards. Document numbering, source references and pending/dispatched quantities are durable. Dispatch-backed sales invoicing, credit-limit policy and cancellation reversals were completed in the next continuation: only unbilled QC-accepted dispatch quantities can be invoiced, concurrent billing is guarded, invoice GL posting is atomic without double stock issue, invoice cancellation releases challan/SO billed quantities, and challan cancellation is blocked after billing then reverses dispatched stock and quantities. Party credit limits (0 = unlimited) now block SO approval when current receivable exposure plus order value exceeds the limit. Quote/SO/dispatch UI, payment schedules, migration generation and real-MySQL regression remain pending.

> **2026-11-07 procurement/returns UI continuation (branch `arena/16264bf2-erp`):** Purchase now includes a responsive Procurement & Returns workspace covering requisition submit/approval, PO approval and receipt progress, GRN/QC quantities, live three-way-match exceptions, commercial return/credit/debit-note visibility and guarded cancellation. Complex creation/QC forms remain API-backed pending local migrated-schema runtime verification.

> **2026-11-07 returns/adjustment continuation (branch `arena/16264bf2-erp`):** added company-scoped sales and purchase returns with source-line quantity caps across prior posted returns, mandatory physical/QC accepted and rejected quantities, rejected-QC notes, stock availability guards, restock/return-to-vendor dispositions, credit/debit-note numbering, atomic GST/party GL adjustments, append-only stock reversals and cancellation stock-shortfall protection. Refund/advance-payment application and UI remain pending.

> **2026-11-07 three-way-match hardening:** controlled GRN invoices now require the supplier's invoice number and reject active duplicates per supplier. The procurement dashboard derives accepted-versus-billed quantity and PO-versus-invoice rate exceptions with source GRN/invoice references.

> **2026-11-07 controlled procurement continuation (branch `arena/16264bf2-erp`):** added company-scoped Material Requisition, Purchase Order, GRN, inward QC, generic inspection and item-vendor schema plus transactional services/API. Guards cover approval state, requisition caps, supplier role, duplicate GRN source lines/documents, over-receipt tolerance, full-quantity QC disposition, accepted-only stock posting, rejection reasons and batch/expiry metadata. Continued with GRN-backed purchase invoicing: only unbilled QC-accepted quantities can be invoiced, PO/GRN/rate references are retained, invoice GL posting is atomic, concurrent billing is guarded, invoice cancellation releases billed quantities, and GRN cancellation is blocked after billing or stock consumption before posting ledger reversals. Returns/debit notes, UI, migration generation and real-MySQL regression remain pending; this checkpoint must not be represented as the complete Purchase-to-Pay workflow.

> **2026-11-07 e-Way Bill continuation (branch `arena/d855eb24-erp`):** added pre-validated outward e-Way Bill portal JSON from posted sales invoices, including GST parties/addresses, tax and HSN item details, transport distance, road vehicle or transporter GSTIN, audit logging, and sales invoice list/detail actions. It intentionally generates an upload file only and does not claim NIC authentication or portal acknowledgement.

> **2026-11-07 HSN/SAC continuation (branch `arena/81f22c2f-erp`):** added monthly outward and inward HSN/SAC summaries grouped by HSN, UOM and GST rate, including quantity, taxable value and component taxes, with explicit missing-HSN detection. This complements GSTR-1/GSTR-3B books working without claiming portal filing.

> **2026-11-07 GSTR-3B continuation (branch `arena/81f22c2f-erp`):** added a monthly books-based GSTR-3B working from posted sales/purchase GST: outward taxable/liability, input ITC, per-head net before cross-utilisation and excess ITC. It is explicitly not presented as a filed/portal-ready return because RCM, exempt/nil/non-GST, blocked ITC and statutory cross-utilisation are not represented. Added API/UI, shared UTC month boundaries and reconciliation assertions.

> **2026-11-07 Action Center continuation (branch `arena/81f22c2f-erp`):** implemented a cross-module operational action center derived from source states rather than duplicate notification records: overdue/unassigned production tasks, stock-out/reorder suggestions, jobwork processing→certificate→invoice next actions, and receivable/payable exposure. Reports now opens on Action Center with direct module navigation. Added API/UI and priority-total reconciliation assertions.

> **2026-11-07 Production Efficiency continuation (branch `arena/93e00504-erp`):** implemented operation-, machine- and operator-level throughput from posted production tasks: planned/good/rejected quantity, yield, attainment, hours, output/hour, labour/material/total cost and completion counts. It is honestly labelled efficiency rather than OEE because calendars, availability and downtime loss reasons are not captured. Added API/UI and yield/cost reconciliation assertions.

> **2026-11-07 Production Cost continuation (branch `arena/fbc19138-erp`):** implemented the Business Central/Odoo/SAP/Rootstock expected-vs-actual visibility layer across projects: approved-BOM expected cost, task-frozen material/labour actuals, cost variance, projected margin, production hours, task completion and rejection rate, with work-order drilldown data in the API. No synthetic overhead/WIP values are invented; WIP and overhead GL settlement remain open. Added report UI/API and reconciliation assertions.

> **2026-11-07 Customer Analysis continuation (branch `arena/93a6cb13-erp`):** implemented the Rootstock/Absolute customer order-history analysis layer from auditable posted sales: invoice/cancellation counts, sales, collections, invoice-scoped outstanding, average invoice, last sale, jobwork share and top items/services with average rates. The report clearly separates invoice outstanding from the control Outstanding report (which also includes opening balances and unallocated advances). Added API/UI and reconciliation assertions.

> **2026-11-07 Supplier Analysis continuation (branch `arena/97112f28-erp`):** implemented Rootstock/Absolute-style vendor analysis using only auditable data currently available: supplier invoice/cancellation counts, gross purchases, paid/outstanding, payment %, average invoice value, last purchase and top purchased items with average rates. The UI explicitly refuses to fabricate on-time delivery, QC acceptance or three-way-match scores before PO→GRN→QC exists. Added API/UI and reconciliation assertions.

> **2026-11-07 Cash & Bank continuation (branch `arena/3b38bfe6-erp`):** implemented the Mapsoft/Absolute/Vyapar-style Cash & Bank Book from ForgeERP's append-only GL. It calculates account-wise opening before the selected period, period receipts/payments, running balance and closing for CASH/BANK, retains voucher/party traceability, and respects cancellation reversals through `isCancelled=false`. Added API/UI and an accounting identity regression assertion.

> **2026-11-07 inventory-planning continuation (branch `arena/74c35357-erp`):** implemented the Absolute ERP/Vyapar stores-planning gap without inventing transactional documents: a new Inventory Planning report calculates company-owned closing stock, reorder-level shortage suggestions, last stock movement, active/slow/dead/no-movement ageing and stock value. Customer `JOBWORK_IN` stock is excluded. Added the API/UI and regression assertions; purchase suggestions remain advisory until the real PR→PO→GRN→QC workflow exists.

> **2026-11-07 continuation update (branch `arena/3bd3ec40-erp`):** fetched and verified `origin/main` at PR #5 merge commit `94c8eb2`; re-read both YouTube research documents, GitHub research, and this audit. Added `docs/RESEARCH_IMPLEMENTATION_MAPPING.md`; verified that **Customer Jobwork** and **Own Projects & Manufacturing** are distinct ownership/commercial flows, not duplicate modules. Implemented an active-work-order material plan (planned/issued/remaining/company stock/shortage with source WOs), explicitly excludes customer `JOBWORK_IN`, reports customer material separately, prevents duplicate live WOs from the same fixed-quantity BOM, and clarified module names/navigation. Regression verification for this continuation is recorded below; C1/C2/H1 remain open.
>
> **2026-11-07 workflow-hardening continuation (branch `arena/9109664e-erp`):** applied the researched SAP/Business Central/Rootstock production lifecycle to server guards: a project now needs at least one completed WO before closure; a WO needs at least one completed production task; assigned tasks cannot skip Start; and lower-sequence routing operations must complete before a successor starts (same-sequence operations remain parallel). Added four HTTP regression checks to `tests/erp-audit.mjs`. Jobwork was also hardened to the documented Inward → Processing → Completion Certificate → GST Invoice chain: certification requires all inward quantities processed, issued certification freezes further cards, invoicing requires an active certificate, and certificate/card value mismatch blocks posting. Full suite execution remains pending for the documented Prisma-engine environment constraint; no green claim was made.
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
| 2 | Industry + user-supplied research | **Complete for all supplied references (two YouTube batches + GitHub).** ERPNext, Odoo, SAP Business One, Dynamics 365 Business Central and Mapsoft researched; **batch 1**: both YouTube playlists fully reviewed (**39/39 Absolute ERP transcripts + 9/9 Vyapar videos → `YOUTUBE_PLAYLIST_RESEARCH.md`**); **batch 2**: 12 Rootstock ERP 101 webinars + 5 training playlists (Odoo MRP 49, Odoo functional 37, ERPNext 22, SAP S/4HANA PP 59, Business Central 6) = **185 video entries enumerated, 38 transcripts read → `YOUTUBE_ERP_COURSES_RESEARCH.md`**; **all supplied GitHub repos re-checked at code level** (ERPNext, Free-GST-Billing-Software, erpnashilk) plus the newly supplied [`utech/utech-repo`](https://github.com/akashshinde700/utech/tree/main/utech-repo) → `GITHUB_REPOS_RESEARCH.md`. Residual: `akashshinde700/laserp` is now **404 / not re-verifiable**, 3 hidden Absolute ERP videos, 8 Vyapar LIVE-part transcripts, 147 round-2 playlist videos not individually transcribed (enumerated only), full 1–2 h ERPNext livestream transcripts, and visual video watching. |
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

**User-supplied GitHub repos — full code-level review (see `GITHUB_REPOS_RESEARCH.md`)** — the three originally supplied references were ERPNext / `akashshinde700/laserp` / `IamRamgarhia/Free-GST-Billing-Software`; `akashshinde700/erpnashilk` was added later, and on 2026-11-07 the user additionally supplied [`akashshinde700/utech/tree/main/utech-repo`](https://github.com/akashshinde700/utech/tree/main/utech-repo). Current `main`/`develop` trees and real source files were read via the GitHub REST API (no clone/build/copy).

- **ERPNext** (GPL-3.0, `develop`): `make_reverse_gl_entries` (`accounts/general_ledger.py:647`) swaps debit/credit on cancel; `stock_ledger.py` has `NegativeStockError`, `RepostQueue`, `make_entry`, `update_entries_after`, FIFO/LIFO queues; `BOMRecursionError` (`bom.py:49/986`); Work Order `Draft→Submitted→Not Started→In Process→Completed/Stopped/Closed`; Job Card overproduction guard, `Total Completed + Process Loss + Pending == Qty To Manufacture`, and a `Manufacture` Stock Entry on completion.
- **`laserp`**: **404 — no longer public** (REST 404, `git ls-remote` "Repository not found", code search 0). Its prior findings (HEAD `f05efc9`, `erp-helpers.ts`, `postStock`, scrypt sessions, no LICENSE) are recorded in `docs/REVERSE_ENGINEERING_SUMMARY.md` but **could not be re-verified**.
- **Free-GST-Billing-Software** (MIT, v1.10.84 released 2026-11-07): far beyond the earlier "offline GST invoicing" note — GSTR-1/3B JSON, **GSTR-2B reconciliation**, e-Way Bill, TDS/TCS (26Q/27EQ), PO, delivery challan, credit note, cancel-not-delete with stock restore, cashbook/COGS/cost centres, 22 currencies, 27 `scripts/*-test.mjs` suites + Playwright dep, 110 `src/` files. `src/utils.js` holds the single shared engine (`computeInvoiceTotals`, `splitLineTax`, `gstinChecksumOk`, `stockEffect`, `generateEWayBillJSON`). `SECURITY.md`: loopback `127.0.0.1`, local `_system/data/`, XSS/CSP/backup/updater in scope. Still a billing app, **not** a manufacturing ERP.
- **`erpnashilk`** (no LICENSE): **66 models** (correcting the earlier "54"), 601 blobs, 43 tests + 21 E2E specs. `src/lib/erp-helpers.ts` (`computeBillTotals` integer paise + largest-remainder discount, `postStock`, `nextDocNumber`, `requireWrite`), `credit-apply.ts` (row-locked advances/return credits, no money movement), `einvoice.ts` (IRP v1.1 bulk JSON), `tests/qc-grn.test.ts` (QC-gated GRN, rejected qty stays outstanding on PO). `PROJECT_STATUS.md`: 190/190 tests, Phase 5 local-only / not committed / not deployed; open CB-R2, CB-R6, CB-R10.
- **NEW `utech/utech-repo`** (no LICENSE, HEAD `06fa7251`, 2026-10-29): a **second complete manufacturing ERP** — Express 4 + Prisma 5 + MySQL 8 / React 18 + Vite, 512 blobs, **61 models / 20 enums / 44 hand-written SQL migrations**, 35 routers / 233 handlers / 77 frontend routes. `stockService.js` is the single stock choke-point (conditional atomic `updateMany` decrement, 3-decimal validation, authoritative post-move balance, `findStockShortfalls`, structural COMPANY vs CUSTOMER two-bucket inventory with `FOR UPDATE` lot locks and job-card reservations). `gst.js` uses `decimal.js` 40-digit ROUND_HALF_UP with proportional discount-before-tax; `numbering.js` uses an atomic `NumberSequence` with P2002 retry; `auth.js` re-reads identity per request with dynamic role+override permissions (**218/233 endpoints gated**). Business rules verified: **PO does not move stock, only accepted GRN qty does; invoice/payment does not move stock, a Dispatch Challan does**; GRN cancel refuses when stock is gone (AUD-210); sales return needs a recorded physical receipt (AUD-211); production completion posts FG in + materials out and books rejects to a `SCRAP` item. Their CI replays all migrations on a MySQL 8 service + `prisma migrate diff --exit-code`, seeds, checks integrity and runs Playwright E2E; suite reported **900 backend + 176 frontend** tests (their docs, not re-run here). Known open: no documented backup/restore (P1-ops), OTP/reset unwired, JWT in localStorage, 54 unvalidated write routes, no LICENSE. **Their audit docs are stale** (say 60 models / 36 migrations / 668+132 tests / "no CI") — current source wins, same discipline we apply to our own `docs/`.

These are **reference points, not code to copy**: only Free-GST is MIT; ERPNext is GPL-3.0; `laserp`, `erpnashilk` and `utech` have no LICENSE (all rights reserved → patterns/ideas only). `GITHUB_REPOS_RESEARCH.md` §6 holds the full cross-repo gap matrix against this checkout's 33 models.

**YouTube playlists — full content review (see `YOUTUBE_PLAYLIST_RESEARCH.md`)** — Absolute ERP "Demo Video for ERP Software" (42 videos / 5,858 views / 3 hidden → **39 transcripts individually read**) and "Vyapar Desktop Demo LIVE" (9 videos / 94,601 views / ≈9 h 37 m; intro Hindi transcript + all 8 LIVE official descriptions reviewed; LIVE transcripts return raw JS and were **not** claimed as watched).

Concepts extracted from the transcripts, not just titles: routing is created **before** BOM and is **per-process**, with workgroup/machinery **or outsourced vendor**, setup time → fixed cost and cycle time → variable cost from machine hourly rate, and **testing processes carrying QC checklists**; BOM lines are **per operation** with parameter/variant relations and quantity-per-finished-unit (1.25 m silk per shirt), lock/copy/revision discipline. Production DFD: **Manufacturing Order** either Make-to-Order (against Sales Order, BOM/routing/parameters auto-fetched) or Make-to-Stock → production schedule + automatic material requisition slip → MRP → three branches (issue / purchase cycle / reservation) → production entry incl. QC + jobwork → **"Finish Production" updates FG stock** → delivery challan → invoice. Purchase DFD: BOM-driven indent → optional HOD approval → PO (Open/Fixed/General) → **partial GRN with pending qty** → QC → stock → bill-against-GRN → payment / PDC / purchase return / debit note. Sales chain: estimation → quotation (R1/R2 revision, follow-ups, approval) → SO (price-hidden view, lock, payment schedule) → **multiple partial delivery challans → one invoice** → receipt with FIFO allocation, TDS, advance application, credit notes/refunds. QC DFD: **inward/outward inspection templates with tolerance levels**, stock updated **only after** accepted inspection, outward QC report ships with invoice. Jobwork DFD: **returnable challan out** in two modes (same material returns vs transformed material returns) → MRN in → QC → stock. Stores DFD: gate entry / MRN / GRN, production and in-house jobwork as inward sources, returnable / non-returnable / dispatch challans outward. Cross-cutting: 6-level inventory classification (incl. WIP), item parameters/variants, purchase-vs-sale UOM conversion, tolerance, reorder alerts, barcode, storage hierarchy (warehouse/room/rack/shelf), damage records, Excel import/export, maintenance plans with checklists + reminders, configurable number series, multi-level approvals, lock/unlock, custom fields, bell/15-min/3-day-PDC notifications, multi-location and multi-currency, credit limits, and a large report catalogue (SO tracking through production, reason-wise pending/delay, sales forecast, lost opportunity, GSTR/P&L/day book).

**Vyapar is a small-business billing app, not a manufacturing ERP** — no BOM/routing/WO/MRP/WIP/QC. It is usable only as a UX reference for GST reports, low-/dead-stock alerts, offline backups, Excel import and document sharing. Concept-level ForgeERP gap mapping and a P0/P1/P2 adaptation priority are recorded in `YOUTUBE_PLAYLIST_RESEARCH.md`; **nothing is to be copied verbatim**, and ForgeERP's append-only ledgers + mirrored reversals are explicitly stronger than the edit/delete/clone behaviour shown in the demos and must be preserved.

**Round-2 user-supplied YouTube review (2026-11-07 — see `YOUTUBE_ERP_COURSES_RESEARCH.md`)** — 12 unlisted Rootstock Software *ERP 101: A Primer on ERP for Manufacturing* webinars (2016–2017) plus 5 playlists / 173 videos, fully enumerated and reconciled with Round 1. Transcript-verified additions: **part-master discipline** (non-intelligent numbers, reference/phantom parts, UoM per function, direct/indirect/service parts, inventory status good/suspect/scrap/rework), **BOM revisions/ECO with effective dates, version comparison, Where-Used and phantom BOM**, **routing as a "bill of resources"** with routing link codes, send-ahead quantity, serial/parallel operations and setup/run/wait/move times, **capacity calendars** (shifts, shop calendars, machine centers, consolidated calendar, maintenance windows), **OEE** (fully productive / reduced speed / blocked + loss reasons + target), **flushing methods** (forward / backward / manual / pick+ per component line), **production-order status ladders** with Item Availability by BOM Level before release (Business Central) and **settlement-before-close** (SAP), **WIP account with automatic reversal**, **BOM cost shares / expected-vs-actual variance / Cost of Production / Production Order Statistics**, **MPS with forecast vs actual demand, indirect demand and ATP**, **scrap orders with automatic replenishment (PO or replacement MO)**, **three subcontracting supply modes + customer-owned consignment excluded from stock valuation**, **three-way match (PO↔receipt↔invoice) + item–vendor record**, and **project control with a per-project subledger**. Repeated warning worth keeping: **negative inventory produces wrong FG cost/COGS** — our conditional-decrement guards are aligned. Also: India Compliance (e-Invoice, **e-Way Bill**, GST portal/NIC API, tax templates), a gap ForgeERP only partially covers via `src/lib/einvoice.ts`.

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

### Continuation verification — 2026-11-07

| Check | Result |
|---|---|
| Latest main | `git fetch origin main`; branch HEAD and `origin/main` both `94c8eb26fc20fc8a9b4e3cfb6a1dcc6d6f741ae7` (PR #5 merge) |
| Changed-source ESLint | **PASS** for `manufacturing.ts`, material-plan route, API types, manufacturing UI and app navigation. `jobwork.tsx` still has its documented pre-existing `react-hooks/set-state-in-effect` error at line 1037; this update changed only its heading text. |
| Patch integrity | `git diff --check` **PASS** |
| Workflow-hardening continuation | `node --check tests/erp-audit.mjs` **PASS**; ESLint for changed `src/lib/manufacturing.ts` **PASS**. Four new HTTP checks were added but not executed because the Prisma runtime could not be generated in this environment. |
| Inventory-planning continuation | Changed report API/service/UI ESLint **PASS**; `node --check tests/erp-audit.mjs` and `git diff --check` **PASS**. Inventory endpoint + formula assertions added, but runtime suite not executed for the same Prisma-engine constraint. |
| Typecheck/build/API suite | **Not passed or claimed in this continuation.** Dependencies were reinstalled, but Prisma client generation still attempts blocked `binaries.prisma.sh` downloads (network/TLS failure), leaving `@prisma/client` types unavailable. Consequently the prior **59/59 at 2026-11-07T14:04:14Z remains only the baseline**, not evidence for these changes. C1/C2/H1 remain open. |

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

**Not executed — explicitly NOT claimed as passed:** any UI click/form/modal/responsive test, browser console check, Playwright/E2E run, screenshot comparison, production MySQL connection, migration, deploy, live Mapsoft login, or **visual watching of video frames**. YouTube research was performed by reading official descriptions + auto-generated transcripts (39/39 Absolute ERP, 1/9 Vyapar Hindi transcript, 8/9 Vyapar official descriptions), documented separately in `YOUTUBE_PLAYLIST_RESEARCH.md`; this is text-level review, not playback. Reason: no browser binary or Playwright install; Prisma native engine downloads are blocked in this sandbox; demo host is not reachable from the shell; YouTube LIVE parts return JS bootstrap instead of a transcript.

---

## 8. Prioritised remaining issue list

### Critical (open)
- **C1 Production runtime unproven.** `prisma/schema.prisma` is MySQL; `.env` points to an absent SQLite file; native Prisma engine downloads are TLS-blocked here; the local client is generated from `tests/schema.sqlite.prisma` (test-only). Before any deploy: provision MySQL, regenerate the client from the production schema, create a migration from the 33-model schema, verify a backup, and run the 59-check suite against MySQL. **No production DB was touched.**
- **C2 No checked-in migration baseline.** Destructive `db:push --accept-data-loss` and automatic dev-start push were removed on 2026-11-07; `db:deploy` now points to `prisma migrate deploy`. However, there is still no `prisma/migrations/` baseline because the required Prisma schema engine download is blocked in this environment. A schema change still requires a reviewed baseline/incremental migration + verified backup before deployment.
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
- **M6** (closed for supplied references) Both rounds of YouTube textual research (`YOUTUBE_PLAYLIST_RESEARCH.md` for batch 1, `YOUTUBE_ERP_COURSES_RESEARCH.md` for batch 2) and the full code-level GitHub repo review (`GITHUB_REPOS_RESEARCH.md`, incl. the new `utech` repo) are complete. Remaining research-only items: 3 hidden/unavailable Absolute ERP videos, 8 Vyapar LIVE-part transcripts (raw JS only), deeper transcript chunks of the 12 long Rootstock webinars (YouTube sidebar instead of transcript), 147 round-2 playlist videos enumerated but not individually transcribed, full 1–2 h ERPNext livestream transcripts, visual frame watching, and `akashshinde700/laserp` which is permanently 404 / not re-verifiable. Full line-by-line audits of every file in external 2 GB repos were never in scope.

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

**Cross-checked on 2026-11-07 against the newly supplied `utech` repo (see `GITHUB_REPOS_RESEARCH.md` §6):** items **1, 2, 5, 6 and 8** above are all implemented there in executable form — PO→GRN with `qtyAccepted/qtyRejected` and `QualityCheckLine`, `DispatchChallan` separate from invoice, `ProductionBatch` completion posting FG in + materials out + `SCRAP` write-off, and sales/purchase returns with over-return caps and a physical-receipt gate. Item **11** (migrations) is directly addressed by their CI job (`prisma migrate deploy` on MySQL 8 + `migrate diff --exit-code`), which is now the concrete reference for closing our C1/C2. Their ~1,076 tests + Playwright job are the reference for H1. ForgeERP remains ahead on **double-entry GL**, **append-only mirrored reversals**, **v3 backup/restore** and the **Jobwork Inward→JobCard→Certificate→Invoice** chain — all four must be preserved, not replaced.

**Sharpened on 2026-11-07 by the round-2 YouTube courses (see `YOUTUBE_ERP_COURSES_RESEARCH.md` §9–§10):** the P0 list is **confirmed by five independent sources**, and two details are now concrete — an FG receipt must be its own **version-aware posting** (BC Production Orders, SAP Goods Receipt from production) and **variance must be expected-vs-actual per order with GL registration** (BC Cost Control, Odoo Production Analysis, SAP Settlement). New **P1** items: BOM versions/ECO with effective dates + Where-Used + phantom BOM; routing link codes (component→operation consumption timing); per-component flushing policy; capacity calendars with maintenance windows; WIP account with automatic reversal; scrap orders + auto-replenishment; item–vendor + three-way match; MPS/ATP dashboard; OEE. New **P2**: customer-owned consignment valuation exclusion (already conceptually present in jobwork, but no ownership ledger), barcode shop floor, alternative work centers, work-order dependencies, unbuild/reverse manufacturing, by-products, engineer-to-order, project subledger, e-Way Bill/GST portal API. The Odoo "settle Cost of Production" trick is explicitly a **vendor-specific workaround**, not architecture to adopt.

---

## 10. Build / DB / security / performance summary

- **Build:** PASS (exit 0, TypeScript enabled, 66 API routes + 46 static pages). Fonts self-hosted; no network needed at build.
- **DB changes:** **none to production schema or data.** `prisma/schema.prisma` untouched; no migration; isolated test DB only. Backup/restore logic changed in application code.
- **Security:** fixed invalid-input 500s, FK 500s, invalid GST codes, query-string platform key (401), legacy/corrupt restore data loss, anonymous-bootstrap-after-restore gap, duplicate allocations, concurrency double-posting. Remaining: tenant scoping, production secret/env strategy, demo credentials, full IDOR/upload matrix.
- **Performance:** no benchmark run. Conditional `updateMany` guards add one indexed write per posting; full restore now uses one 60 s transaction instead of a partial wipe; report list filters use indexed date ranges. Sibling project notes that per-request full-ledger history needs DB-side aggregation as data grows — same risk applies here.

---

## 11. Workspace / deliverables

- **This checkpoint:** `PROJECT_AUDIT_PROGRESS.md` (required by the user's execution rules) + `YOUTUBE_PLAYLIST_RESEARCH.md` (batch-1 playlist content review) + `YOUTUBE_ERP_COURSES_RESEARCH.md` (batch-2: 12 Rootstock webinars + 5 playlists / 173 videos, added 2026-11-07) + `GITHUB_REPOS_RESEARCH.md` (full code-level review of all supplied GitHub repos incl. `utech/utech-repo`, added 2026-11-07).
- **Executable suite:** `tests/erp-audit.mjs` (`npm run test:audit`); writes `tests/audit-results.json`. The committed/recorded result is **59/59 at 2026-11-07T14:04:14Z** on the isolated SQLite test DB (dev, `next start` and standalone builds).
- **Local test harness (test-only, never a production migration):** `tests/make-local-schema.py`, `tests/schema.sqlite.prisma`, `tests/prisma.local.config.ts`, `tests/register-local-adapter.cjs`, `tests/erp-test.db`.
- **Environment caveat (verified 2026-11-07 on `arena/b5710131-erp`, re-verified 2026-11-07 on `arena/ba36b80d-erp`):** `node_modules/`, `.next/` and `tests/erp-test.db` are gitignored and **are not persisted in this sandbox session** (all three confirmed ABSENT again during the round-2 YouTube research); no standalone server is running. `npm run typecheck` in this session fails with `tsc: not found`. Re-running the build/audit therefore requires re-provisioning (`npm install`, local SQLite Prisma generate/`db push` on the test schema, rebuild standalone, start server with the adapter preload). **This is environment state, not a code regression** — no source file was changed in this turn.
- **Changed production source:** see §6.

---

## 12. Immediate next steps (continue from here)

1. Re-provision the sandbox (`npm install` + local SQLite Prisma harness + standalone build per §11), then re-run `npm run typecheck`, `npm run build`, `npm run test:audit` after every further change. The last recorded green run is **59/59 at 2026-11-07T14:04:14Z**; it has **not** been re-executed in this session because dependencies/build artifacts are absent (docs-only changes in this turn).
2. Provision a real MySQL instance; regenerate Prisma client from `prisma/schema.prisma`; create a reviewed initial migration; replay the 59-check suite against MySQL. Close C1/C2. Reference: `utech`'s `ci.yml` `migrations` job (MySQL 8 service → `migrate deploy` from empty → `migrate diff --exit-code` → seed → integrity check) in `GITHUB_REPOS_RESEARCH.md` §5.4.
3. Install a browser runtime (Playwright + Chromium) and execute `tests/e2e_playwright.py`-style UI, responsive (390/768/1440 px), double-submit, form-reset, empty/error/loading, console-error and print/export checks. Close H1. Reference: `utech`'s `ci.yml` `e2e` job and `erpnashilk`'s 21 `e2e/specs/*.spec.ts`.
4. Resolve the 17 ESLint effect-state errors with `useSyncExternalStore` / derived state, enabling `reactStrictMode:true`.
5. Reconcile `deploy.py` / `.zscripts/*` / `.env` with the MySQL schema; remove `--reset-db` from unattended paths; force production password rotation.
6. Decide, with the owner, which §9 gaps to implement first (recommended: MRP/low-stock + purchase/sales order lifecycle + QC + production costing), preferring a deliberate merge from `erpnashilk` over a rewrite.
7. Complete Mapsoft read-only login check if a POST-capable browser session becomes available; finish docs↔code reconciliation. Both YouTube reviews (`YOUTUBE_PLAYLIST_RESEARCH.md` batch 1, `YOUTUBE_ERP_COURSES_RESEARCH.md` batch 2) and the full GitHub repo-by-repo code comparison (`GITHUB_REPOS_RESEARCH.md`) are **done** — use their P0/P1/P2 concept lists (now sharpened in §9) when choosing §9 gaps. `laserp` stays 404; do not re-plan work around that repo.
8. Only then produce the final sign-off report with total modules audited, issue counts by severity, fixes, remaining issues, improvements, test results, build status, DB changes, security and performance findings.
