# GitHub Reference Repositories — Full Code-Level Review

**Checkpoint:** 2026-11-07 · **Branch:** `arena/281b57f4-erp` · **Companion docs:** `PROJECT_AUDIT_PROGRESS.md` (§2/§4/§9/§12), `YOUTUBE_PLAYLIST_RESEARCH.md`, `docs/SOURCE_REPOSITORY_COMPARISON.md`, `docs/REVERSE_ENGINEERING_SUMMARY.md`

User request: re-check **all GitHub repositories originally supplied** and additionally check [`akashshinde700/utech/tree/main/utech-repo`](https://github.com/akashshinde700/utech/tree/main/utech-repo).

---

## Method & honesty notes

- Read-only research via the authenticated GitHub REST API (`gh api`): recursive `git/trees` for every accessible repo, plus raw `contents` for the actual source files. Nothing was cloned, built, run, modified, copied into this repo, or deployed. No credentials were handled in chat.
- **Code-level, not README-level:** for each repo I opened real implementation files (schema, services, engines, middleware, tests, CI), not just descriptions. Exact numbers below come from the current default-branch trees on 2026-11-07.
- Repo-level claims taken from a repo's own audit docs are labelled **"their doc says"**; where the current tree contradicts those docs, the contradiction is recorded (see §5.7).
- No code was copied. Licensing: ERPNext is **GPL-3.0**, Free-GST is **MIT**, `erpnashilk` / `utech` / `laserp` have **no LICENSE** (all rights reserved). For the unlicensed ones the standing rule is **patterns/ideas only, zero code copying**.
- `laserp` is **no longer reachable** (REST 404 and `git ls-remote` "Repository not found") — its prior findings could not be re-verified.

---

## 0. Repository status matrix (verified 2026-11-07)

| # | Repo | Status | License | Default | Pushed | Size / shape | Reviewed |
|---|---|---|---|---|---|---|---|
| 1 | [`frappe/erpnext`](https://github.com/frappe/erpnext) | Public | GPL-3.0 | `develop` | 2026-11-07 | 41,049 stars, 1,463 open issues | ✅ code-level spot-check of ledger/BOM/WO/Job Card/GL reversal |
| 2 | `akashshinde700/laserp` | **404 — not found** | — | — | — | prior record: HEAD `f05efc9`, ~11 MB | ⚠️ **not re-verifiable**; prior findings only |
| 3 | [`IamRamgarhia/Free-GST-Billing-Software`](https://github.com/IamRamgarhia/Free-GST-Billing-Software) | Public | **MIT** | `main` | 2026-11-07 | 463 stars, 27 open issues, 297 blobs | ✅ `package.json`, `src/utils.js`, `SECURITY.md`, README, 27 test scripts |
| 4 | [`akashshinde700/erpnashilk`](https://github.com/akashshinde700/erpnashilk) | Public | **none** | `main` | 2026-11-07 | 601 blobs, 335 `src/`, 43 tests, 21 E2E specs | ✅ schema, `erp-helpers.ts`, `einvoice.ts`, `credit-apply.ts`, `qc-grn.test.ts`, `PROJECT_STATUS.md` |
| 5 | **NEW** [`akashshinde700/utech` → `utech-repo/`](https://github.com/akashshinde700/utech/tree/main/utech-repo) | Public | **none** | `main` | 2026-10-29 | 512 blobs (232 backend / 177 frontend / 40 MD), 61 models | ✅ schema, services, utils, middleware, CI, 12 audit docs, source tree |

The three originally supplied repos were **ERPNext / laserp / Free-GST-Billing-Software** (per `docs/SOURCE_REPOSITORY_COMPARISON.md`); `erpnashilk` was added later when it became public. Other repos under the owner's account (`sheetaldies_erp`, `yantrix`, `cacrm`, `gmb`, `lasecom`, `drjaju`, `Marine`, `Notes`, `generator`, `iptv_app`, `demo_iptv`, `node-telegram-multi-forwarder`) were **not** supplied as references and were not reviewed.

---

## 1. ERPNext (`frappe/erpnext`, GPL-3.0)

Code actually read: `accounts/general_ledger.py` (528-line `gl_entry.py` + reversal), `stock/stock_ledger.py` (3,368 lines), `manufacturing/doctype/bom/bom.py` (1,838), `work_order/work_order.py` (1,466), `job_card/job_card.py` (2,588), `stock/doctype/stock_entry/stock_entry.py` (2,292).

Verified in source:
- **`make_reverse_gl_entries()`** in `accounts/general_ledger.py:647` — cancellation creates *swapped debit/credit* GL rows (`is_cancelled` guard, `FOR UPDATE`, partial-cancel support). This is the exact append-only-reversal pattern ForgeERP already implements and must keep.
- **`stock_ledger.py`**: `NegativeStockError`, `RepostQueue`, `make_entry()` at line 416, `update_entries_after` class at 794, FIFO/LIFO valuation queues (line ~3308), `get_stock_ledger_entries()` / `get_valuation_rate()`. Signed-qty immutable SLE rows.
- **`BOMRecursionError`** declared at `bom.py:49` and raised at `bom.py:986`; `validate_bom_links()`; `backflush_based_on` BOM / Material Transferred for Manufacture.
- **Work Order statuses** in `work_order.py:181-189`: `Draft → Submitted → Not Started → In Process → Completed / Stopped / Closed`.
- **Job Card** (`job_card.py`): `To Manufacture` status (line 142), overproduction guard against WO "Overproduction Percentage For Work Order" (line 399), `Total Completed Qty + Process Loss Qty + Pending Qty == Qty To Manufacture` (line 1161), and a `Manufacture` Stock Entry created on completion (line 2295-2328).
- **Stock Entry purposes**: `Material Transfer for Manufacture`, `Material Consumption for Manufacture`, `Manufacture` (with `ManufactureStockEntry` service class).

**Takeaway:** unchanged from the earlier audit — ERPNext remains the reference for doc lifecycle, immutable stock ledger, multi-level BOM recursion guard, WIP/FG via Manufacture entry, QC templates, batch/serial and subcontracting. **GPL-3.0** — ideas only, no code copying.

---

## 2. `akashshinde700/laserp` — no longer available

- `GET /repos/akashshinde700/laserp` → **404 Not Found**; `git ls-remote https://github.com/akashshinde700/laserp.git HEAD` → `remote: Repository not found`; code search `laserp user:akashshinde700` → 0 repositories. Not present in the owner's public repo list.
- Prior recorded findings (from `docs/REVERSE_ENGINEERING_SUMMARY.md`, HEAD `f05efc9`, "11 MB full", no LICENSE): same-stack Next.js 16 + Prisma + shadcn/ui reference; `src/lib/erp-helpers.ts`, `postStock`, `computeGst`, `payments/route.ts:83` allocation guard, scrypt + DB sessions + HMAC cookie auth, socket.io notification sidecar, pure-function MRP, `QcInspection` auto-created from GRN, `AuditLog`, CSV parser, pdfkit print, `NumberSeq` per-FY numbering. Known defects to avoid: inter-state check by state **names**, audit identity from request body, declared-but-unposted RETURN_IN/SALES_RETURN ledger types.
- **These are historical claims, not freshly verified.** No license → patterns only. Because `erpnashilk` is its documented production-evolved sibling, the concrete verification now lives in §4.

---

## 3. `IamRamgarhia/Free-GST-Billing-Software` (MIT) — much more mature than the earlier note

The earlier audit described it as "offline-first GST invoicing with GSTR-1/3B, quotations, credit notes, 22 currencies, daily backups". Current `package.json` **v1.10.84** (README: released **7 November 2026**) shows it has grown well beyond that:

- **Compliance:** GSTR-1 / GSTR-3B JSON exports, **GSTR-2B reconciliation**, e-Way Bill JSON, TDS/TCS reports (Form 26Q / 27EQ, sections 194Q / 206C), UTGST, reverse charge, SEZ/LUT export invoices, HSN/SAC/UQC, place-of-supply, multi-GSTIN, 22-country multi-currency.
- **Documents:** Tax Invoice, Proforma, Credit Note, Bill of Supply, Delivery Challan, **Purchase Order**, quotations/estimates, **cancel-not-delete** (stamps CANCELLED on PDF, removes from totals/reports/GST returns, restores stock).
- **Accounting/business:** cashbook, purchase payments, COGS, cost centres, business-type presets (incl. Manufacturing), product catalog with stock, low-stock alerts, product performance, notification bell (overdue + low stock + filings), granular backup with optional Google Drive sync, offline PWA, UPI QR, DOMPurify-sanitised rich-text Terms (13 India presets).
- **Test posture:** `npm run test:unit` chains **27 standalone `scripts/*-test.mjs`** suites (tax, discount-modes, csv, **manufacturing**, einvoice, **po**, errors, costcentre, businesstype, cashbook, purchase-payments, hsnrates, lut-tds, fx, services, gstr1-json, phone, xlsx-read, share, tally-xml, cogs, glass, linux-packaging, installer, server-lock, makedir, search) + `tests/smoke.mjs`; 110 `src/` files; Playwright is a devDependency.
- **Code read:** `src/utils.js` (134 KB) exposes `computeInvoiceTotals` (line 216), `calculateLineItemTax` / `resolveLineDiscount` (tax-inclusive back-solve), `splitLineTax` (CGST/SGST odd paisa, IGST, intra-UT), `gstinChecksumOk` / `decodeGstin` (mod-36), `isInterstateSupply`, `setOffITC`, `stockEffect` / `stockDelta` / `findLowStock`, `b2clThreshold`, `generateEWayBillJSON`, `getUpcomingFilings`, `numberToWords`, `safePageBoundaries`. A single shared engine used by UI and API — the pattern ForgeERP's `computeInvoiceTotals` follows.
- **Security model** (`SECURITY.md`): offline-first, bundled server binds `127.0.0.1`, data in local `_system/data/`, no hosted backend, no multi-tenant service. In-scope: XSS via invoice fields / rich-text Terms / imported JSON-CSV / OCR, CSP bypass, local data exfiltration, supply-chain, backup/restore/updater abuse. Out-of-scope: missing hardening headers without PoC, devDependency advisories. Coordinated disclosure; only latest release supported. **MIT** — the only reference repo whose code could legally be borrowed, but the standing mission rule still keeps it as *reference, not a merge target*.
- **Known gaps (their README roadmap):** purchase return / debit note, bank-statement matching, price levels, credit-limit warning, stock adjustment and reorder→PO, locked filed period with edit history are still planned for 21 November 2026. It is a **billing app**, not a manufacturing ERP: no routing, work orders, WIP, QC gates or jobwork production chain.

---

## 4. `akashshinde700/erpnashilk` ("ManuFlow ERP", no LICENSE)

Correcting the earlier note: current `prisma/schema.prisma` has **66 models** (not 54), 601 blobs, 335 `src/` files, 43 `tests/*.test.ts`, 21 `e2e/**/*.spec.ts`.

Model list (verified): `Company Plan Plant User Item Customer Supplier Warehouse Machine Bom BomItem Enquiry EnquiryItem Quotation QuotationItem SalesOrder SalesOrderItem DeliveryChallan DeliveryChallanItem SalesInvoice SalesInvoiceItem PurchaseRequisition PurchaseRequisitionItem PurchaseOrder PurchaseOrderItem Grn GrnItem PurchaseInvoice PurchaseInvoiceItem Payment Expense WorkOrder MaterialIssue MaterialIssueItem ProductionEntry QcInspection StockLedger StockBalance AuditLog Notification NumberSeq QcCorrection PurchaseOrderClosure IdempotencyKey SalesReturn SalesReturnItem PurchaseReturn PurchaseReturnItem MoneyAccount AccountTxn Loan ItemBatch ItemSerial UserCompanyAccess` + 11 `Tally*` models.

Code actually read:
- `src/lib/erp-helpers.ts` (30 KB): `sessionUser`, `requirePlatformAdmin`, `assertLimit`, `assertFirmAccess`, `resolveCompanyId`, `requireWrite` / `requireRead`, `claimStatus`, `financialYearOf`, `nextDocNumber`, `assertTaxLines`, `computeGst`, **paisa-exact `computeBillTotals`** (line 414), `isInterState` (state **codes**), `postStock` (line 549), `availableQty`, `logAudit`, `notify`.
- `src/lib/credit-apply.ts`: `applyCustomerCredit()` locks the advance / sales-return source row and the target invoice row separately, recomputes remaining credit, refuses over-application and bounced-cheque advances, and writes an `ADVANCE_ADJ` / `CREDIT_NOTE` payment row with **no money movement**.
- `src/lib/einvoice.ts`: `validateForIrp`, `buildEInvoiceJson` (NIC v1.1 bulk-upload shape), `nicDate`, `partyStateCode`, `FREIGHT_SAC 996511`, `PACKING_SAC 998540`, doc-no length 16.
- `tests/qc-grn.test.ts` (53 KB): QC-gated GRN suites — "GRN with four materials", QC outcomes, server-side quantity validation, line-level mapping, GRN workflow, serial-tracked lines, permissions/tenants, **rejected material stays outstanding on the PO**, and the QC-correction case.
- `PROJECT_STATUS.md` (68 KB): Cash & Bank phases 0–5; **190/190 tests**, typecheck/ESLint/build clean; Phase 2 browser check 10/11 (11th was a check-script bug); production deploy on 2026-10-26 on explicit user request; **Phase 5 done locally but NOT committed / NOT deployed**; `IdempotencyKey` exists only in local test DBs. Open unresolved requirements: **CB-R2** (same-day cheque bounce rewrites past statements), **CB-R6** (production account with opening balance but no opening date), **CB-R10** (legacy payment without `accountId` backfill — needs approval). Phase 1b / Phase 6 not started.

**Takeaway:** strongest same-stack reference for paisa-exact billing, IST business dates, tenant isolation, refunds, idempotency, QC-gated GRN, BOM backflush, Tally read-only connector, universal import with XXE protection, and a real test suite. Still **no double-entry GL** (document-derived) and **no jobwork/outsource chain** — ForgeERP's GL and jobwork remain its differentiators. No license → patterns only.

---

## 5. NEW: `akashshinde700/utech` → `utech-repo/` — a complete second manufacturing ERP

### 5.1 What it is

[`utech-repo/README.md`](https://github.com/akashshinde700/utech/blob/main/utech-repo/README.md): **U-Tech Automation Industries — ERP**, "UTech ERP — Smart Manufacturing". Express 4 + Prisma 5 + **MySQL 8** backend, React 18 + Vite + Tailwind frontend, 512 blobs (232 backend / 177 frontend / 40 markdown docs), HEAD `06fa7251` (2026-10-29), **no LICENSE**. Single-tenant, Chikhali Pune, state code 27.

- Backend `package.json`: `express`, `@prisma/client ^5.22`, `zod ^4.6.7`, `decimal.js`, `bcryptjs`, `jsonwebtoken`, `helmet`, `express-rate-limit`, `multer`, `pdfkit`, `exceljs`, `vitest`, `supertest`; scripts for `prisma:generate/migrate/deploy/seed`, `inventory:verify`, `db:check-integrity`, `lint`, `test`.
- Frontend `package.json`: React 18.3, React Router 7, Zustand, Axios, Tailwind 3, `pdfjs-dist`, `recharts`, `@playwright/test`, `@sparticuz/chromium`, `axe-core`, vitest + jsdom + Testing Library.
- **`backend/prisma/schema.prisma`: 61 models, 20 enums, 44 hand-written SQL migrations** (first `20260504133809_init`, last `20261029090000_item_shape`). Their own audit docs are stale (see §5.7).
- **35 routers / 233 route handlers / 77 frontend `<Route>` declarations** (their `FEATURE_INVENTORY.md`, mechanically parsed).

### 5.2 Architecture & the single stock choke-point (code read)

Data flow: UI → axios → Express (`requireAuth` → `requirePermission` → zod `validate`) → controller → `prisma.$transaction` → `stockService` → MySQL.

[`backend/src/services/stockService.js`](https://github.com/akashshinde700/utech/blob/main/utech-repo/backend/src/services/stockService.js) (227 lines) is the **only** writer of `Item.currentStock` + `StockLedger`:
- `validateMovement()` rejects non-finite/negative quantities and >3-decimal values (scaled `roundQuantity` to kill `0.3-0.1` float drift).
- Outward movement uses **conditional atomic `updateMany`** with `where: { id, currentStock: { gte: outQty } }`; `count === 0` → 400 "Insufficient stock" — race-safe, no read-modify-write.
- Balance is re-read *after* the mutation ("authoritative post-move balance — never derived from the stale pre-read"), then a `StockLedger` row is created in the **same transaction**.
- `findStockShortfalls()` + `describeShortfalls()` power the GRN-cancel refusal; `allowNegative: true` exists only as an audited override for holders of `stock.adjust`.
- **Two-bucket inventory is structural**: `moveCustomerMaterial()` never touches `Item.currentStock`; it locks the `CustomerMaterialLot` row with `SELECT … FOR UPDATE` (documented as requiring READ COMMITTED because MySQL's default REPEATABLE READ could leave the later ledger SUM on an old snapshot), derives available qty from the ledger SUM, enforces active job-card **reservations**, and tracks `weightIn/weightOut/weightBalance`. `ownerType COMPANY | CUSTOMER` on the ledger.
- `getLowStockItems()` — shared by the Items list filter and dashboard widget (Prisma cannot compare two columns of the same row in a `where`).

[`backend/src/utils/gst.js`](https://github.com/akashshinde700/utech/blob/main/utech-repo/backend/src/utils/gst.js) (57 lines): `decimal.js` `Money` clone with **40-digit precision, ROUND_HALF_UP**; `calcTaxes()` allocates a flat discount **proportionally across lines BEFORE tax** (documented: "a discount … reduces the taxable value … NOT deducted after tax"), odd paisa to CGST, ₹1 `roundInvoiceTotal`; `stateCodeOf()` from GSTIN. Client totals are always recomputed server-side.

[`backend/src/utils/numbering.js`](https://github.com/akashshinde700/utech/blob/main/utech-repo/backend/src/utils/numbering.js) (122 lines): atomic `NumberSequence` allocation (`UPDATE current = current + 1`), per-key promise chain as belt-and-braces, first-allocation seeds from real max document number, one retry on `P2002/P2010` seeding race, and an explicit comment that the old `max+1` read-then-write produced duplicate numbers under concurrency. Prefixes `INV/QT/VQ/JC/JW/DC/P/IT/CML/VWO` with `YY` year.

[`backend/src/middleware/auth.js`](https://github.com/akashshinde700/utech/blob/main/utech-repo/backend/src/middleware/auth.js) (70 lines): JWT HS256 bearer, **identity re-read from DB on every request** (deactivated user loses access immediately), `effectivePermissions()` = role grants − per-user revocations + per-user grants, `requirePermission(...keys)` with SUPERADMIN bypass, 403 with the missing key named. Their security audit measured **218/233 endpoints permission-gated** and 230/233 returning 401 without a token.

### 5.3 Business-flow concepts (verified in README + BEGINNER_GUIDE_HINGLISH + schema + audit docs)

- **Invoice ≠ dispatch**: creating an invoice or payment does **not** move stock; physical shipment requires a separate **Dispatch Challan** (`DispatchChallan`/`DispatchLine`). PO creation/approval does **not** increase stock; only the **accepted** qty of a GRN does.
- **PO → GRN → QC**: `PurchaseOrder`/`PurchaseOrderLine`, `GRN`/`GrnLine` with `qty`, **`qtyAccepted`, `qtyRejected`**, nullable `itemId` for a vendor-made free-text part, `poLineId`, `vendorWorkOrderLineId`. `QualityCheck`/`QualityCheckLine` with `refType` (`GRN | JOBCARD | DISPATCH`), `result`, `parameter/expected/actual/result`. `ProductionBatch` completion is gated by `assertQualityPassed()` in `productionOutput.js`.
- **GRN cancel refuses when stock is gone** (AUD-210): pre-check lists short items; forced negative reversal only for `stock.adjust`/SUPERADMIN, audited and labelled in the ledger.
- **Sales return requires physical receipt** (AUD-211): `returnChallanNo` + `receivedAt` + `receivedById` (+ optional `dispatchChallanId` capping returned qty at what shipped); `POST /api/sales-returns/:id/receipt`; `process` refuses without it (400).
- **Production**: `ProductionBatch` (`PLANNED → IN_PROGRESS → COMPLETED → CANCELLED`, shift, machine, BOM, qtyPlanned/Produced/Rejected, start/end time) + `ProductionMaterial` (planned vs consumed). Completion moves **FG in + every material out**; `syncJobcardOutput()` recomputes jobcard produced/rejected from COMPLETED batches (one number, not two); `postScrapWriteOff()` books rejects into an auto-created `SCRAP` catalog item.
- **Jobwork**: `JobworkChallan`/`JobworkLine` with `materialOwnerType COMPANY | CUSTOMER`, `customerMaterialLotId`, expected/actual return date, over-receive capped at `qtySent`, cancel reverses outstanding. AUD-206 fixed rejected customer material vanishing from the lot.
- **Two "project" concepts** (their flow analysis warns not to confuse them): `Jobcard` = shop-floor project (operator, project engineer, checklist, BOM lines, operations, ASSEMBLY/SUBASSEMBLY/SUBPART PDF attachments); `Project`/`ProjectTask` = separate simple budget/task admin module.
- **Other modules**: quotations + templates, back orders, vendor work orders, purchase/sales returns, expenses, customer material lots, stock overview + adjustments, attachments (polymorphic `refType/refId`, 100/record cap), notifications, XLSX reports, analytics, Tally export (SSRF-guarded), **Metal Calculator** (11 shapes × 22 metals, 97 profile families / 2,925 profiles, manual kg/m override) and **73 photographed raw-material items** with an `inventory:verify` reconciliation script.
- **Demo safety**: `USE_IN_MEMORY_DB=1` demo with `admin@utech.local / Admin@123` — volatile, dev secrets, explicitly "never reuse credentials"; the in-memory adapter is **blocked in `NODE_ENV=production`**. README states the isolated checks do **not** validate a real MySQL deployment.

### 5.4 Test / CI posture (their docs, exact figures)

- `TEST_EXECUTION_REPORT.md` (2026-10-17): **backend 668 / frontend 132 = 800 tests**, all new; real Express app loaded with `@prisma/client` intercepted via a programmable fake (`Module._load` patch); 548-test generated authorization matrix; axe-core zero violations; explicitly **cannot** catch SQL generation, indexes, transaction isolation, Prisma-internal bugs.
- `FINAL_AUDIT_2026-10-28.md`: baseline **backend 899 / frontend 172**, after changes **backend 900 / frontend 176**, lint clean both sides, production build passes; live in-memory checks for login → party → items → dashboard → stock → invoice PDF (`%PDF-`) → capped XLSX, plus 401/400 negatives.
- `FEATURE_INVENTORY.md`: 35 routers, 233 handlers, 77 routes, zero orphan `.jsx`; BACKEND-ONLY: quotation templates, Tally UI.
- `.github/workflows/ci.yml`: backend lint+test, frontend lint+test+build, a **MySQL 8 service job** replaying `prisma migrate deploy` from empty + `prisma migrate diff --exit-code` against `schema.prisma` + seed + `db:check-integrity` (comment says the hand-written init migration had 5 wrong `ON DELETE` rules and 2 missing FKs, unnoticed for 43 migrations), and a **Playwright E2E job** (`npx playwright install --with-deps chromium`, 10 e2e spec files).
- `BUSINESS_LOGIC_BUGS.md`: 7 defects (AUD-201…207) fixed with pre-fix-failing regression tests — notably AUD-201 (editing a jobcard deleted every Task Progress item via `operations: []` replace-all), AUD-202 (return edit bypassed over-return cap and line ownership), AUD-204 (sales-return discount applied **after** tax → ₹18 over-refund), AUD-206 (rejected customer material vanished). Pass 3 added AUD-210/211/212/213 (zod v4 `.default()` re-injection, 16+21 advisories → 0/0).
- `SECURITY_AUDIT.md`: OWASP mapping, 548-test authz matrix, privilege-escalation holds, XSS/CSRF/SSRF review; open P3s: **JWT in `localStorage`** (AUD-109), rate-limit only on `/api/auth` (AUD-111), unauthenticated `express.static` `/uploads` (AUD-112, UUID filenames), 16 seeded-but-unenforced permission keys (AUD-113), 54 write routes without zod (whitelists hold, AUD-115). Production boot **refuses** placeholder/short `JWT_SECRET`.
- `FINAL_AUDIT` remaining: **no documented backup/restore** (AUD-127, P1-ops), route-level code splitting, stock reconciliation job, timezone-naive dates, password-reset email delivery still unwired, Playwright E2E + real-MySQL replay not run in their sandbox.

### 5.5 Their own honest limitations

- All ~1,076 unit/API tests run against a **programmable Prisma fake**, not MySQL; FK cascades, unique-index collisions, isolation levels and migration safety on real data are **not** covered by execution.
- Print layouts were **not** re-rendered in a real browser in their audit environment.
- OTP/reset is a scaffold: codes are `console.log`ged, `purpose: 'reset'` has no consuming endpoint, `REFRESH_EXPIRES_IN` unused.
- `Bom`/`BomItem` and `Project.budget` exist but **no stepwise production workflow drives them**; batch/shift-wise production reports absent.
- No LICENSE (all rights reserved) → **patterns/ideas only, zero code copying**.

### 5.6 Why this repo matters most for ForgeERP right now

`utech` is the **closest executable proof** of the P0 concepts that `YOUTUBE_PLAYLIST_RESEARCH.md` extracted from the Absolute ERP videos and that ForgeERP currently lacks: QC-gated receipt, PO→GRN with accepted/rejected qty, dispatch-vs-invoice separation, FG receipt + material consumption + scrap, physical-receipt-gated sales return, two-bucket company/customer-owned inventory, dynamic RBAC, migrations + MySQL drift check in CI, and >1,000 automated tests incl. Playwright. It is a **reference for behaviour and test strategy**, not a merge target.

### 5.7 Documentation drift found in `utech` (useful caution)

| Their audit doc claims | Current tree (2026-11-07) |
|---|---|
| 60 models / 20 enums / 36 migrations (`ERP_ARCHITECTURE_AUDIT.md`, `AUDIT_SUMMARY.md`) | **61 models / 20 enums / 44 `migration.sql`** |
| 668 backend + 132 frontend tests (`TEST_EXECUTION_REPORT.md`, `RELEASE_READINESS.md`) | later `FINAL_AUDIT_2026-10-28.md`: **900 + 176** |
| "No CI" (AUD-119, `BUSINESS_LOGIC_BUGS.md`) | `.github/workflows/ci.yml` now exists with 4 jobs |
| "unbounded exports" (AUD-107) | `FINAL_AUDIT` N-05/N-06: 5,000-row cap + `X-Export-Truncated` + toast |
| "no graceful shutdown" (AUD-120) | `FINAL_AUDIT` says it was already implemented |

Their older reports are point-in-time snapshots; **current source wins**. This is the same discipline applied to `docs/` in ForgeERP (M3 drift).

---

## 6. Cross-repo gap matrix vs ForgeERP (this checkout, 33 models)

Legend: ✅ present · ◐ partial · ❌ absent. ForgeERP facts from `PROJECT_AUDIT_PROGRESS.md` §3/§9 and `prisma/schema.prisma` (33 models: `Counter Company OrgUser Plan PlatformInquiry … AccountLedger SalesInvoice PurchaseInvoice JobworkInward JobCard JobworkCertificate Employee Project Bom BomItem WorkOrder WorkOrderLine ProductionTask Payment PaymentAllocation`).

| Concept | ERPNext | laserp | Free-GST | erpnashilk | **utech** | ForgeERP | Priority |
|---|---|---|---|---|---|---|---|
| Append-only stock + GL ledger, mirrored reversal | ✅ | ◐ | ◐ (stock deltas in JSON) | ◐ (no GL) | ✅ (`stockService`, ledger only) | ✅ **stronger** | keep |
| Paisa-exact GST engine (incl./excl., IGST/CGST+SGST, round-off, GSTIN checksum) | ✅ | ✅ | ✅ (single engine) | ✅ (integer paise) | ✅ (`decimal.js` 40-digit) | ✅ | keep |
| Double-entry GL on every voucher + trial-balance assertion | ✅ | ❌ | ◐ (ledger views) | ❌ (doc-derived) | ❌ | ✅ **differentiator** | keep |
| Jobwork Inward→JobCard→Certificate→Invoice with over-process guard | ◐ (subcontracting differs) | ❌ | ❌ | ❌ | ◐ (vendor challans, no certificate/invoice chain) | ✅ **unique** | keep |
| PO / indent → approval → **partial GRN with pending qty** → QC → Bill | ✅ | ✅ | ◐ (PO planned-ish) | ✅ | ✅ | ❌ | **P0** |
| QC inspection template + tolerance + stock gate | ✅ | ✅ (auto from GRN) | ❌ | ✅ (`QcInspection`/`QcCorrection`) | ✅ (`QualityCheckLine`, `qtyAccepted/qtyRejected`) | ❌ | **P0** |
| Quotation → SO → **partial delivery challans → one invoice** | ✅ | ◐ | ◐ | ✅ | ✅ (`DispatchChallan`, quotation) | ❌ | **P0** |
| Production: MRP/reservation, WIP, **FG receipt**, scrap/rework, costing variance | ✅ | ✅ | ❌ | ◐ (MaterialIssue/ProductionEntry) | ✅ (`ProductionBatch` + `ProductionMaterial` + `SCRAP`) | ◐ (WO/Task/`MFG_ISSUE`, no FG receipt) | **P0** |
| Credit/debit notes, refunds, returns with physical-receipt gate | ✅ | ◐ | ✅ (credit note) | ✅ (advances/return credits) | ✅ (AUD-211 gate) | ❌ | **P0** |
| Multi-level BOM + recursion guard + revision | ✅ | ✅ | ◐ (flat, cycle-detect) | ◐ | ◐ (Bom/BomItem, no stepwise) | ◐ (flat `BomItem`) | **P1** |
| Two-bucket company vs **customer-owned** material with reservations | ◐ | ❌ | ❌ | ❌ | ✅ (structural, `ownerType`, `FOR UPDATE`) | ❌ | **P1** |
| Dynamic RBAC (role/permission matrix + per-user overrides) | ✅ | ✅ | ❌ (single user) | ◐ (tenant + roles) | ✅ (`effectivePermissions`) | ◐ (session + VIEWER/write gate) | **P1** |
| Number series atomic under concurrency | ✅ | ✅ | ✅ | ✅ (`NumberSeq`) | ✅ (`NumberSequence` + retry) | ✅ (`Counter` in txn) | keep |
| Checked-in migrations + schema-drift CI | ✅ | ❌ | n/a | ◐ | ✅ (44 SQL + `migrate diff`) | ❌ (no migrations) | **P0/Critical** |
| Automated test suite ≥1,000 incl. browser E2E | ✅ | ❌ | ✅ (27 script suites + Playwright dep) | ✅ (190 + 21 E2E specs) | ✅ (900+176 + Playwright) | ◐ (**59 HTTP/DB checks, no browser E2E**) | **High** |
| Documented backup/restore | ✅ | ❌ | ✅ (granular + Drive) | ✅ | ❌ (**P1-ops open**) | ✅ (v3 round-trip, legacy refusal) | ForgeERP ahead |
| Offline-first / loopback-only threat model | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | out of scope |
| License allowing code reuse | GPL-3.0 | none | **MIT** | none | none | own | patterns only |

---

## 7. What to adopt, what to avoid

**Adopt (concepts, with our own implementation):**
1. **QC gate before stock update** — accepted/rejected qty on the receipt line, inspection template with parameter/expected/actual/result, outward QC report shipped with invoice. (`erpnashilk` + `utech` + ERPNext + Absolute ERP videos all agree.)
2. **Dispatch ≠ invoice** — a physical-dispatch document moves stock; invoice/payment only touches the party/GL ledger. (`utech` README + BEGINNER guide; Absolute ERP DFD of Sales & Marketing and Stores.)
3. **PO → partial GRN → bill chain** with pending qty, multi-location split, and a shortfall refusal on cancellation. (`utech` AUD-210; Absolute ERP GRN video.)
4. **Production completion posts FG in + materials out**, with planned-vs-consumed, scrap register, and QC pass as a completion precondition. (`utech` `productionOutput.js`; ERPNext Manufacture Stock Entry; Business Central output/scrap.)
5. **Returns need evidence** — a physical receipt record before stock is restored, plus over-return caps anchored to the original document lines. (`utech` AUD-202/211.)
6. **Conditional atomic decrement** for every outward stock move and **authoritative post-move balance**. (`utech` `stockService`; ForgeERP already has a conditional-update guard — keep it.)
7. **Atomic number sequence** with retry on seeding race; **IST business-date** normalisation; **paisa-exact** discount-before-tax math. (`erpnashilk`, `utech`, Free-GST.)
8. **Migration drift check in CI** (`prisma migrate deploy` + `migrate diff --exit-code` against a real MySQL service) and a browser E2E job. (`utech` ci.yml — directly addresses our C1/C2 and H1 open items.)
9. **Two-bucket inventory** if customer-owned material is ever in scope (jobwork already handles customer material in ForgeERP, but without a separate structural ledger).
10. **Generated authorization-matrix tests** and **spreadsheet-formula-injection sanitisation** on exports. (`utech` 548-test matrix, N-04.)

**Avoid / do not copy:**
- Any code from the **unlicensed** repos (`laserp`, `erpnashilk`, `utech`); GPL ERPNext code also stays out. Free-GST is MIT but the mission rule is reference-only.
- **Editable/deletable posted documents**, hard deletes, or discount switches that bypass the single tax engine — ForgeERP's `computeInvoiceTotals` + `postGl` + `cancelGlForVoucher` choke-point is stronger.
- `utech`'s open P3s: JWT in `localStorage`, unauthenticated `/uploads`, unwired password-reset OTP, 54 unvalidated write routes, 16 seeded-but-unenforced permission keys, unbounded exports (now capped), TZ-naive dates, and the **missing backup/restore procedure** (ForgeERP already has v3 backup).
- Relying on a **fake Prisma client** as the only test evidence — our 59 checks hit a real SQLite DB over HTTP; keep that, then replay on MySQL.
- Treating their own audit docs as current; their numbers drifted (§5.7). Same caution applies to our `docs/`.

---

## 8. Honest limits of this review

- **Executed here:** GitHub REST tree + raw-file reads of all accessible repos; exact counts derived from current default-branch trees; code quoted above was actually opened. No external repo was cloned, installed, built, or tested in this sandbox (no `node_modules` / browser / MySQL here — see `PROJECT_AUDIT_PROGRESS.md` §11).
- **Not executed:** running any external repo's test suite, a real MySQL migration replay, Playwright/browser checks, or a full line-by-line audit of every file in each repo. ERPNext was spot-checked on the six highest-value modules, not exhaustively (2 GB repo).
- `laserp` is 404 and cannot be re-verified; its section is explicitly historical.
- `utech`'s test counts (800 → 900+176) and release verdicts come from **their** reports, not from a run in this sandbox; they are labelled as such.
- No production database was connected, modified, migrated or deleted; no deployment; no credentials submitted; no code copied into this checkout.

---

## 9. Resulting document updates

`PROJECT_AUDIT_PROGRESS.md` is updated so Phase 2 is now **complete for all supplied GitHub references + utech** (residual: `laserp` 404, Vyapar LIVE transcripts, visual video watching). §4 gains the code-level findings, §9's P0 list is cross-checked against `utech`, §11 lists this deliverable, and §12 no longer lists "full repo-by-repo code comparison" as pending. The Critical items C1/C2 (production MySQL + reviewed migrations) and H1 (browser E2E) remain open — `utech`'s CI job is now the concrete reference for closing them.
