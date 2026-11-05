# Implementation Changelog — ForgeERP MVP (this session)

Blueprint sources: REVERSE_ENGINEERING_SUMMARY.md §5 mapping table, ERP_WORKFLOW_DOCUMENTATION.md W1–W6, IMPLEMENTATION_ROADMAP.md P0. Every P0 item shipped and verified.

## 1. Database (prisma/schema.prisma — designed in prior session, pushed this session)
- `bun run db:push` applied the full 18-model schema to `db/custom.db` (SQLite).
- Query logging removed from `src/lib/db.ts` (noise/perf).

## 2. Core engine (`src/lib/`)
| File | Purpose | Key reference lineage |
|---|---|---|
| `erp.ts` | Pure shared engine: `computeInvoiceTotals` (inclusive/exclusive back-solve, PoS-driven IGST vs CGST+SGST, odd-paisa 1e-7 nudge, ₹1 round-off), GSTIN mod-36 checksum + generator, FY code (Apr–Mar), Indian number-to-words, formatters | gst-billing engine (verified test cases read), laserp inter-state rule (codes not names) |
| `accounting.ts` | 15-account chart, `postGl` with hard ΣDr==ΣCr assertion, `cancelGlForVoucher` mirror-reversal | ERPNext gl_entry shape + reversal-not-delete |
| `services.ts` | All posting services: sales/purchase invoices (stock+GL atomic), payments+allocations, opening stock, jobwork inward → job card (partial, multi-process, party rates, 5% over-tolerance, same-process merge, lot-once) → certificate → invoice (JWIN income, SAC 998887); Counter-based FY numbering; weighted-average cost; availability guard | ERPNext docstatus/over-production, laserp transactional choke-point + allocation guard |
| `reports.ts` | stock-ledger/summary, GSTR-1 rate-wise B2B/B2C, trial balance + integrity, outstanding, P&L, party ledger, jobwork pending, dashboard aggregates | gst-billing GSTR-1 buckets, ERPNext derived status |
| `seed.ts` | Demo scenario built ENTIRELY through the real services; refuses to ship unbalanced GL | — |
| `api.ts` | `{success,data}` envelope helpers, BusinessError/Zod/Prisma error mapping | laserp envelope pattern |

## 3. API routes (27 files under `src/app/api/`)
masters (company, parties(+[id]), items(+[id]), warehouses(+[id]), processes(+[id]), party-rates GET/PUT), sales-invoices(+[id] GET/DELETE-cancel), purchase-invoices(+[id]), payments(+[id]), jobwork/inwards(+[id]), jobwork/job-cards(+[id]), jobwork/certificates, jobwork/invoices, inventory/opening, reports (8 types), dashboard, seed, health. Zod on every mutation.

## 4. Frontend (`src/components/erp/` — 16 files, single-page module registry on `/`)
`erp-app.tsx` (shell: emerald sidebar + mobile Sheet + sticky header/footer + setup screen when no company), `api.ts`, `store.ts` (zustand view router), `company.tsx`, `bits.tsx` (StatusBadge/KpiCard/…), `dashboard.tsx` (KPIs + recharts trend + low stock + recents), `invoice-module.tsx` + `sales.tsx`/`purchase.tsx` (list/create with **live GST preview via the shared engine**/detail/cancel/print), `invoice-print.tsx` (compliant GST tax invoice: HSN + tax summaries, amount-in-words, bank block, print CSS), `inventory.tsx` (summary/ledger/opening), `jobwork.tsx` (flagship: inward → job card dialog with remaining-prefill + process multi-select + live estimate → certificate → invoice → pending report), `accounting.tsx` (payments + allocation editor with Σ≤amount validation + party ledger), `reports.tsx` (GSTR-1/TB banner/Outstanding/P&L), `masters.tsx` (6 tabs, live GSTIN checksum ✓/✗), `docs.tsx` (reverse-engineering intelligence page). Plus `src/app/page.tsx` → `<ErpApp/>`, layout toaster, globals.css emerald theme + print rules.

## 5. Fixes applied during verification (details in BUG_AND_SECURITY_REPORT.md §B)
H1 nested-transaction refactor · H2 GSTR-1 per-line rate grouping · H3 seed stock scenario · H4 double JSON parse · H5 sticky-footer/sidebar height fix (agent-browser bounding-box audit) · H6 envelope misuse · H7 dead code.

## 6. Deliberate deviations from blueprint
1. Sales/purchase share one parameterized `invoice-module.tsx` (mirrors) instead of duplicated code.
2. Create dialogs expose an optional "Stock From" warehouse select (API already accepted `warehouseId`; demo finished goods live in the JW store).
3. `JW-SERVICE` item seeded by code (services throw a helpful error if absent).
4. Docs view is curated static content (client runtime cannot read `docs/*.md` from disk).

## 7. Not implemented (roadmap)
P1: auth/RBAC, Postgres+Decimal, returns (credit/debit notes), manual journals, backup endpoint, dedicated audit log. P2: quote→order→delivery chain, PO/GRN chain, BOM/WO, GSTR-1 JSON, e-invoice, balance sheet, stock transfer UI, FY close. P3: CSV import, MRP, notifications, command palette, batch/serial, multi-company. P4: TDS/TCS, RCM full, LUT, recurring invoices, PWA.

## 8. Documentation set (10/10 complete)
REVERSE_ENGINEERING_SUMMARY · SOURCE_REPOSITORY_COMPARISON · EXISTING_ARCHITECTURE · DATABASE_RELATIONSHIP_ANALYSIS · ERP_WORKFLOW_DOCUMENTATION · FEATURE_GAP_ANALYSIS · IMPLEMENTATION_ROADMAP · **BUG_AND_SECURITY_REPORT (new)** · **TESTING_REPORT (new)** · **IMPLEMENTATION_CHANGELOG (this file, new)**.

## 9. Analysis addendum session (2026-11) — no application code changed
User revealed that `akashshinde700/erpnashilk` was made public and provided a live commercial demo (demo.mapsofterp.in, Admin credentials) for reference. Actions taken (documentation only — zero changes to `src/`, schema, or APIs):
1. Cloned erpnashilk (47 MB, HEAD `02ea494`) to `/home/z/repos/erpnashilk`; full structural + domain analysis via read-only exploration (54 Prisma models, 129 API route files, 40 screens, 41+ lib files).
2. Verified: **no LICENSE file** (all rights reserved) → patterns-only rule maintained; **no jobwork module** (grep: zero matches in `src/`) → our flagship chain remains unique among all references; `computeBillTotals` integer-paise + largest-remainder math verified by direct read (erp-helpers.ts:414); `DEMO_PASSWORD='demo1234'` verified (password.ts:9).
3. Logged into demo.mapsofterp.in read-only via browser automation; mapped all 18 modules and key screens (dashboard attention/pending panels, manufacturing job + raw-material grid Q-Avail/Q-WIP, GST=HSN master, hierarchical COA with GRNI clearing account, invoice list with IRN/Email status columns).
4. Doc updates: REVERSE_ENGINEERING_SUMMARY.md §2 ledger + new §3.4/§3.5; SOURCE_REPOSITORY_COMPARISON.md addendum rows A1–A20 (ADOPT/ADAPT/AVOID verdicts); BUG_AND_SECURITY_REPORT.md erpnashilk findings N1–N5.
5. Key roadmap inputs captured for future sessions: paisa-exact bill math (A1), bill-level freight/packing charges (A2), cheque lifecycle (A5), advances/credit-apply (A6), dashboard attention panels (A18).

## 10. Feature session (2026-11, same day) — Tally stack + SaaS Platform Admin + Audit + action buttons

User directive: audit erpnashilk's Tally integration (.bat + connector), SaaS platform admin, and remaining UX; implement everything of value. Patterns re-implemented from the Task-1 audit (repo unlicensed — zero code copied).

### 10.1 Schema (`prisma/schema.prisma`, pushed)
- `Plan` (name/priceMonthly/priceYearly/maxItems/maxWarehouses/maxParties/active) + `Company.planId` relation.
- Company subscription: `isPlatform`, `saasStatus` (ACTIVE|SUSPENDED), `billingCycle`, `paidUntil`, `trialEndsAt`, limit overrides (`maxItems/maxWarehouses/maxParties`; null = plan default, 0 = unlimited).
- Company Tally settings: `tallyCompanyName`, `tallySalesLedger/PurchaseLedger/CgstLedger/SgstLedger/IgstLedger/RoundOffLedger`.
- `SalesInvoice`/`PurchaseInvoice`: `tallyExportedAt` / `tallySentAt` stamps.
- `AuditLog` (action/entity/entityId/details, indexed on createdAt+entity).

### 10.2 New libraries
| File | Purpose |
|---|---|
| `src/lib/tally.ts` | One voucher model → XML/JSON/CSV. LEDGERENTRIES invoice mode, debits negative, REMOTEID dedupe (`FORGEERP-SINV-<id>`), qty back-solved from billed amount (Tally recomputes RATE×QTY), round-off residual balancing line, ASCII `tallyText()`, service-lines→sales-ledger routing, masters XML (UNIT+LEDGER with PARENT map, Sundry Debtors/Creditors), payment Receipt/Payment vouchers |
| `src/lib/platform.ts` | `accessState()` single blocking truth (suspended / expired-paid / expired-trial, end-of-day inclusive, free-forever default), `assertCompanyAccess()` guard, `assertLimit()` plan limits, `ensurePlans()` starter plans, platform-key check |
| `src/lib/audit.ts` | `logAudit()` fire-and-forget |

### 10.3 New API routes (10 files)
- `POST/GET/DELETE /api/tally/connector` — pairing-code → token (SHA-256, single-use code, 10-min TTL), queue voucher jobs, `?mode=pending` poll, result recording, status; in-memory PoC store on globalThis.
- `GET /api/tally/voucher` — per-doc XML/JSON/CSV + `?preview=1` warnings envelope; `POST` mark-sent/unmark.
- `GET /api/tally/masters` — All-Masters XML (parties toggle).
- `GET /api/tally/bulk` — date-range combined envelope (sales/purchase/payments toggles).
- `POST /api/platform/auth`; `GET/POST/DELETE /api/platform/plans`(+`[id]` PATCH); `GET/POST /api/platform/orgs`(+`[id]` PATCH actions: setPlan/markPaid/extendTrial/suspend/activate/customize/resetCustom + typed-name DELETE).
- `GET /api/audit` (filters + entity groups); `GET /api/backup`; `POST /api/backup/restore` (typed RESTORE confirm, single transaction).
- Company route: subscription block + `access` in GET; Tally fields in PUT.

### 10.4 Guards + audit wired into 23 existing handlers
`assertCompanyAccess()` on every business mutation (sales/purchase/payments/jobwork chain/opening/seed/masters); `assertLimit('parties'|'items'|'warehouses')` on master creation; `logAudit` after every successful mutation/cancel/export/platform action.

### 10.5 Frontend (3 new modules + upgrades)
- **Tally Export module** (`tally.tsx`): how-it-works, masters download (parties toggle), bulk range export, connector console (pairing code w/ copy-able CLI commands, 10s status polling, recent imports table), .bat download, ledger-name settings form.
- **Platform Admin module** (`platform.tsx`): key gate (sessionStorage), KPI stats (orgs/MRR/documents/warehouses), Organizations tab (plan inline-select, state badges, usage vs limits, +1 mo/+1 yr/+7d trial/Suspend/Activate/typed-name delete, create-org dialog), Plans tab (full CRUD), Data & backup card (download snapshot + typed-RESTORE file restore).
- **Audit Trail module** (`audit.tsx`): entity/action filters, search, newest-first table, CSV export.
- **Shell**: suspension/expiry/trial banners with "Open Platform Admin" shortcut; company refetch on leaving platform view; sidebar group "Setup & Platform".
- **Invoice lists**: Actions column (View / Duplicate / Tally dropdown: XML/CSV/Queue-for-connector/Mark-sent), toolbar Refresh + CSV export; **detail view**: Duplicate + Tally dropdown + "In Tally" badge; duplicate prefill dialog.
- **Dashboard**: 6 quick-action cards.
- Client helpers: `platformApi` (x-platform-key), `downloadUrl`, `downloadCsv` (BOM).

### 10.6 Static downloads (`public/downloads/tally/`)
- `Tally-Import.bat` (CRLF): config override, drag-drop or newest `*_tally.xml` in Downloads, curl + PowerShell fallback POST to Tally :9000, CREATED/ALTERED/ERRORS/EXCEPTIONS parsing, LINEERROR cheat-sheet, REMOTEID re-import note.
- `forge-tally-connector.mjs`: Node 18+ ESM CLI (pair/run/status/forget), token stored 0600 in APPDATA, 15s poll, imports queued XML into Tally, reports result.

### 10.7 Verification (full detail in TESTING_REPORT §6)
25 API checks + 12 browser E2E flows, all executed live: voucher balance proofs (Dr=Cr on both modes), suspend→403→banner→activate lifecycle, plan-limit 403 at 6/6, connector pair→queue→poll→result lifecycle, backup counts, duplicate prefill, zero console errors, lint clean.

### 10.8 Honest scope notes
- Connector + .bat untested against real TallyPrime (no Tally in sandbox) — XML follows the audited spec; flagged PoC in UI.
- Organizations beyond the first are real Company rows but the ERP runtime stays single-tenant (first company) — per-request tenant scoping remains roadmap.
- Backup restore verified structurally; full round-trip not exercised this session.

## 11. Navigation session (2026-11, same day) — Mapsoft-style page-to-page flows

User directive: make navigation as easy as demo.mapsofterp.in (KPI cards drill into lists, rows open details, detail pages carry the next-step buttons). Patterns observed live on the demo (KPI → listInvoice, row → detail, detail tabs + action buttons) and re-implemented:

### 11.1 Cross-module preset mechanism (`src/components/erp/nav.ts`)
- `setCreatePreset()` — sessionStorage preset (60 s TTL) + CustomEvent; types: `sales-invoice | purchase-invoice | payment | party-ledger`.
- Consumers: InvoiceModule (opens create dialog with party prefilled), AccountingView (payment dialog with type/party/amount/**invoice allocations** prefilled; ledger tab + party selected).
- Recent views (top 6) feed the palette; `GOTO_KEYS` map + `isTypingTarget()` guard shared.

### 11.2 Command palette (`src/components/erp/palette.tsx` + `GET /api/search`)
- Ctrl/⌘+K or `/` — Create group (5 actions), Recent group, Go-to group (11 modules with g-key hints), live search (debounced 300 ms, ≥2 chars) across parties/items/sales/purchase/jobwork inwards → direct detail navigation.
- Header search box ("Search or jump to… ⌘K") on desktop.
- `?` opens the Keyboard Shortcuts help dialog.

### 11.3 Global keyboard (erp-app.tsx)
- g+key navigation (d s p j i a r m t u o, 1.5 s window), Alt+S new sales invoice, Alt+P new purchase, `?` help, `/`+Ctrl+K palette — all guarded when typing in inputs.

### 11.4 Screen-level navigation upgrades
- **Dashboard**: all 6 KPI cards clickable → module; low-stock rows clickable → Inventory; quick-action cards (previous session).
- **Invoice lists/detail**: breadcrumb (Sales / INV-xxx); detail "Receive Payment / Make Payment" button (shows balance chip) → accounting payment dialog prefilled with the party + balance allocated to THIS invoice; posted toast carries a **View** action.
- **Masters parties**: row click / Eye button → **Party view dialog** — profile header, one-click actions (New Invoice, New Purchase, Receive Payment, Pay Supplier, Party Ledger — all preset-driven), Receivable/Payable/Vouchers stat chips, Sales/Purchases/Payments activity tabs.

### 11.5 Verification (executed, browser)
Palette open+search("Mahindra") → party + 2 invoices + 1 inward found → click lands on invoice detail; g s/g t/g d/g m shortcuts; ? help dialog; Alt+S opens prefilled create; breadcrumb text "Sales/INV-2627-004"; Receive Payment → dialog with RECEIPT + CUST-001 + ₹38,374 + allocation "Allocated ₹ 38,374.00 / ₹ 38,374.00"; party view → New Invoice (party prefilled) and Party Ledger (tab + party selected); low-stock click → Inventory; mobile drawer intact; zero console/page errors. `bun run lint` clean.

## 12. e-Invoice IRP JSON + full-app audit session (2026-11-06)

User directive: full audit of the project (buttons/navigation/flows), report on the .bat status, and add the e-Invoice JSON download shown in the user's screenshot (reference app's Tally dropdown with "e-Invoice JSON (GST portal)").

### 12.1 e-Invoice IRP JSON v1.1 engine (`src/lib/einvoice.ts`, A4 → DONE)
- IRP v1.1 schema builder (TranDtls/DocDtls/SellerDtls/BuyerDtls/ItemList/ValDtls) per the published NIC spec; ASCII-hardened text, UQC unit normalization (KG→KGS etc.), qty 3dp / amounts 2dp, Pin as integer.
- **Pre-validation** split into hard errors (block download, 409) vs warnings (toast): seller+buyer GSTIN format, B2B eligibility, 6/8-digit HSN per item, 6-digit pincodes, state codes, future date, cancelled invoice, Σ line AssAmt = AssVal, Σ line tax = header tax, TotInvVal = components + RndOff. 30-day IRN window (Notification 76/2023) as warning.
- TotAmt = Qty × UnitPrice (pre-discount) vs AssAmt (post-discount) per spec; discount lines verified (INV-2627-003 15% line exports TotAmt 25,600 / AssAmt 21,694.92).

### 12.2 API `GET /api/e-invoice` (assertCompanyAccess + logAudit)
- `?id=<salesInvoiceId>` → file download `<INV>_einvoice.json`; `&preview=1` → {valid, errors, warnings, supTyp, itemCount, totInvVal}.
- `?from&to` → bulk `{Version:"1.1", BulkInvList:[…]}` file `forge-einvoice_<from>_<to>.json`; `&preview=1` → {total, eligible, skipped[{docNo, errors}], value} — broken documents never ship to the portal.
- e-Invoice is outward-supply only (sales); purchase dropdown intentionally omits the item.
- `/api/tally/voucher?format=json` upgraded from JSON envelope → attachment file download (`<VCH>_tally.json`).

### 12.3 Tally dropdown → screenshot parity (invoice lists + detail view)
Reference menu structure re-implemented with groups + separators: Tally XML (import file) / **Tally JSON** / **Tally Excel (CSV)** | **Tally importer (.bat)** (static download link) / **Tally masters (XML)** (API download) | Queue for Tally connector / Mark as sent to Tally | **e-Invoice JSON (GST portal)** (sales only) — icons per item.

### 12.4 Tally Export module: e-Invoice bulk card
Date-range card with preview stats (eligible/total, ₹value, skipped invoices with reasons) then bulk download; toast guidance "GST portal: e-Invoice → Upload JSON".

### 12.5 Party.pincode (IRP BuyerDtls prerequisite)
- Prisma: `Party.pincode String?` (nullable, non-breaking) + db push; backfilled 6 seeded parties.
- API: POST/PUT parties accept 6-digit pincode (zod-validated); masters party form pincode input (numeric-only, 6-digit hint) + validation; party view header shows pincode.
- Seed upgraded: proper 6-digit HSN codes (848390/848330/730790/720890/740721) + KGS units; existing DB lines backfilled to match (4-digit HSNs failed IRP pre-validation — caught live by the new validator).

### 12.6 Full-app audit (read-only, 16-point checklist in a dedicated browser session)
All PASS: dashboard KPIs/quick actions, sales/purchase lists + detail, Tally dropdowns (8 items sales / 7 items purchase), jobwork inward detail, inventory summary+ledger, accounting payments+ledger, 4 report types, masters tabs + party view actions, Tally Export cards, audit trail filters, platform key gate, command palette search, shortcuts dialog, mobile 390px (no horizontal overflow, drawer), sticky footer (0px gap at 900px), zero page errors / zero red console errors.

### 12.7 Audit fixes applied
- Controlled selects: `value={x || undefined}` → `value={x}` in inventory (opening warehouse + row item) and accounting (payment party + ledger party) — kills the uncontrolled→controlled flip class.
- Date consistency: party-view Sales/Payments tabs, platform org Paid/Trial cells and trial banner switched from `toLocaleDateString()` (US M/D/YYYY) to shared `dateStr()` (03 Nov 2026).
- Data regression repaired: audit session deactivated CUST-001 — reactivated (6/6 active).
- Non-reproducible ghost warnings from the audit session (2 Radix Description notes) — all dialogs/AlertDialogs statically verified to carry descriptions; could not be reproduced in 5 targeted dialog flows.

### 12.8 Verification (executed live)
- Backend: preview + file endpoints per-invoice and bulk (all 200, attachment headers, correct IRP JSON body; 4/4 seeded invoices pass validation, ₹2,68,054 total); Tally JSON/CSV attachment headers; .bat 200 (4,659 B); masters XML 200.
- Unit-level builder tests: 45-day-old → 30-day warning; future date → error; no buyer pin → error; no buyer GSTIN (B2C) → error; 4-digit HSN → error; discount line math exact.
- Browser golden path: dropdown → e-Invoice JSON → toast + real file in ~/Downloads; detail view same; purchase omits item; bulk card stats + download; party form pincode create → API → DB round-trip; payment-dialog party select placeholder + selection; opening-stock selects; zero console/page errors. `bun run lint` clean.

## 13. e-Invoice JSON → GST portal auto-open (2026-11-06, session 2)

User directive: on clicking "e-Invoice JSON (GST portal)", the GST portal's Bulk Upload page (https://einvoice1.gst.gov.in/Home/Index?ReturnUrl=%2FInvoice%2FBulkUpload) must open together with the JSON download.

### 13.1 Popup-blocker-safe portal launcher (`src/components/erp/api.ts`)
- New exported `EINVOICE_PORTAL_URL` + `openEInvoicePortal()` returning `{retry, cancel}`: the tab is opened **synchronously inside the click gesture** (browsers otherwise block `window.open` after awaits); `retry()` re-attempts if the first open was blocked; `cancel()` closes the tab when pre-validation fails and no JSON is produced.

### 13.2 Both entry points wired (`src/components/erp/tally.tsx`)
- Per-invoice `exportEInvoiceJson(id)` (Sales list + detail "Tally" dropdown item) and the bulk card `go()` (Tally Export page) now: open portal tab → pre-validate → download JSON → keep tab; on validation failure/API error the tab is closed and the reason toasted. Toast copy updated to "the GST portal Bulk Upload page opened — upload this JSON there."

### 13.3 Verification (executed live, headless Chromium)
- Instrumented `window.open` at click time: exactly one call with the exact portal URL, returning a live Window (not blocked); preview 200 → file download 200 per-invoice (INV-2627-003, toast "e-Invoice JSON ready") and bulk (2026-11-01→05 range).
- Portal tab confirmed loading the real government site and staying open (multiple repetitions, both entry points; final tab `einvoice1.gst.gov.in/Home/Index?ReturnUrl=%2FInvoice%2FBulkUpload` stable across checks). `bun run lint` clean; no dev.log errors.
