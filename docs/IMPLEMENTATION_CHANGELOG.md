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

## 14. Word user manual + data + Playwright E2E (2026-11-06, session 3)

User directive: ek word file banao jo pura software kaise use krna hai batao — screenshots + instructions + data add + Playwright test.

### 14.1 Data added to the live app (via real UI flows)
- Sales invoice INV-2627-005 (Flange DN50 SS316 ×10 @ ₹640 → ₹7,552 incl. GST) + full payment received with allocation.
- Jobwork chain: job card JWI-2627-002 (CNC+QC+Packing) → certificate CERT-2627-002 → auto jobwork GST invoice.
- New party CUST-004 Nashik Steel Traders (GSTIN 27AAANF4821K1Z0, pincode 422010) — first attempt failed GSTIN checksum validation (app validation working as designed), corrected with computed checksum.
- Root-caused during this: party POST 400 was invalid-GSTIN checksum (not an app bug); job-cards route is POST-only (GET lives on /api/jobwork/inwards).

### 14.2 Playwright E2E suite — tests/e2e_playwright.py (Python Playwright 1.57 + Chromium)
16 groups · 49 tests · 49 PASS · 0 console/page errors: app load, 12 module navigation, sales data, 7-item Tally dropdown, e-Invoice JSON single+bulk+preview downloads, Tally voucher/masters XML, jobwork chain data, reports tabs, payment recording, masters data, palette/search, audit trail, platform-admin gate+unlock, mobile 390px (no overflow + drawer), sticky footer (0px gap). Results JSON: agent-ctx/playwright-results.json.

### 14.3 Word manual — ForgeERP-User-Manual.docx (project root, ~4.9 MB, 30 pages)
- Hindi (Devanagari, Mangal complex-script) + English tech terms; cover recipe R1 + DM-1 palette (per docx skill design system; calcTitleLayout/calcCoverSpacing).
- 33 embedded screenshots (agent-ctx/manual/*.png) with numbered captions; 16 chapters: intro, navigation+shortcuts, masters, sales, payment, jobwork chain (crown chapter), purchase, inventory, accounting, reports, Tally+e-Invoice (incl. GST-portal auto-open steps), platform admin, audit trail, mobile, Playwright results table, troubleshooting table.
- 3-section structure: cover (margin 0) → विषय-सूची TOC (Roman i, ii; TableOfContents field + placeholders) → body (Arabic from 1); footers patched PAGE \* ROMAN / \* arabic; empty pgNumType removed.
- Generator: agent-ctx/manual/generate-manual.js (docx@9.15.2 + image-size); postcheck: 0 errors (2 acceptable warnings: table cell 276 spacing, Mangal font fallback).
- Verified via LibreOffice→PDF render + VLM review of pages 1-5 and mid/end pages: cover, TOC entries, Hindi text, tables, figures all clean.

## 15. Mobile UI/UX + PWA hardening (2026-11-06, session 4)

User directive (master prompt): full PWA/mobile audit → root causes → fixes → viewport testing, preserving the existing theme, business logic and desktop layout.

### 15.1 Root causes found (3-agent module audit + browser verification)
1. **Dialog gutter regression (all modules)**: custom `max-w-*` classes on DialogContent defeated shadcn's `max-w-[calc(100%-2rem)]` via tailwind-merge → full-bleed dialogs below 640px AND a silent 512px (`sm:max-w-lg`) cap on desktop. 9 call sites affected.
2. **Dead sticky table headers**: `Table` primitive's own `overflow-x-auto` wrapper is the nearest scroll container, so `sticky top-0` on thead never engaged the outer `max-h-[62vh]` scroller.
3. **~800px nested line-item editor** inside a 272px dialog (invoice create form) — worst mobile data-entry path.
4. **vh units** (`92vh/62vh/68vh/100vh`) under iOS dynamic toolbars + soft keyboard.
5. **No PWA at all**: no manifest, no icons, no service worker, no viewport/themeColor metadata.
6. **KPI money values**: unbreakable `₹ 12,34,56,789.00` strings at 24px overflowed 149px cards (the source of a 5px document-wide overflow at 768px, traced via scrollWidth forensics).
7. Wide tables (9–11 cols) = 2–3-screen swipe tracks at 320px; 20px checkboxes; 28px inner tabs; sub-40px tap targets on platform/tally rows; missing truncates on user-data strings.

### 15.2 Fixes (files → purpose)
- `ui/dialog.tsx` — hardened base width to `w-[calc(100%-2rem)]` (width group ≠ max-w group, so caller `max-w-*` can never kill the mobile gutter); 36px close-button hit area; `pr-9` title so long titles don't run under the X; mobile `p-4 sm:p-6`.
- Dialog call-sites normalized (`sm:max-w-*` only, no bare `max-w-*`, no `w-full`, `dvh`): invoice-module (create invoice), jobwork (inward + job card), masters (party view/edit, item, warehouse, process), accounting (payment).
- Sticky-header fix without touching the Table primitive: outer scrollers get `[&_[data-slot=table-container]]:overflow-visible` (10 tables across 7 modules) + `62vh→62dvh`/`68vh→68dvh`/`92vh→92dvh` everywhere; erp-app sidebar `100vh→100dvh`.
- `invoice-module.tsx` — **stacked line-item editor below sm** (labeled full-width fields, per-line Taxable/Total footer, 44px delete, same state handlers as the desktop table which stays `hidden sm:block`); list hides Taxable/GST/Paid/Balance below `md` and Source below `lg`; Eye button hidden below md (row tap navigates); item meta 10px→12px.
- Column hiding: masters items (Group/HSN/Cost/Reorder/Flags below sm), parties (Types/State/City/Opening Bal), inventory ledger (Warehouse/Rate/Value/Remarks), accounting payments (Mode/Ref/Allocated below md), allocation (Date below sm), GSTR-1 (CGST/SGST/IGST below md), platform orgs (Usage/Expiry below md).
- `platform.tsx` — org actions collapsed into a `⋯` overflow menu below md (40px trigger, guarded Delete stays its own 40px button); row buttons 40px on touch.
- Truncates/`min-w-0` on unbounded strings (jobwork item/process names, challan, inventory item, masters stat grid, audit details + title tooltip); tally pairing buttons ≥44px, `break-all` on the connector command, LINEERROR title tooltip; invoice-print summary tables `min-w-0 sm:min-w-72`.
- Inputs: phone `type=tel inputMode=tel` (party + company), company pincode digit-strip + inputMode; opening-stock footer stacks with full-width Post; company save full-width below sm.
- `bits.tsx` KpiCard — **container-query font sizing** (`@container` + `@min-[200px/260px/320px]`) so ₹ amounts always fit their card at every breakpoint + `title` tooltip (root fix for the 768px overflow).
- Dashboard: quick-action labels wrap (no truncation), "View all" 40px; palette kbd hints `hidden sm:inline` on touch; masters inner tabs 28px→36/44px; audit filters `w-full sm:w-40`.

### 15.3 PWA built from scratch
- `public/manifest.webmanifest` (standalone, `/` scope+start, any orientation, theme #00785c, bg #f8f7f2, 3 icons incl. maskable), `scripts/gen-icons.mjs` (sharp renders the emerald factory brand mark → 32/192/512/maskable-512/apple-180).
- `public/sw.js` — **never caches `/api/*`** (no stale financial data, no replay); navigations network-first with offline fallback; statics stale-while-revalidate only when the server allows caching (dev HTML `no-store` never pinned — v2); old caches purged on activate; updates wait for explicit user-approved `SKIP_WAITING` (no silent takeovers).
- `public/offline.html` — branded offline page (safe-area aware, dark-mode aware) with retry CTA.
- `src/components/pwa-register.tsx` — SW registration, persistent amber **offline banner** (useSyncExternalStore online status; states that transactions are not queued), update toast with Reload action (guarded controllerchange, no first-visit reload).
- `layout.tsx` — `viewport` export (`viewport-fit=cover`, themeColor light/dark), manifest link, local icon set, appleWebApp metadata.

### 15.4 Performance
- All 15 module views `React.lazy` + Suspense skeleton (`erp-app.tsx`) — initial payload carries only shell+dashboard; heavy chunks (invoice editor, masters, jobwork, charts) load on first navigation. Zustand state unaffected.

### 15.5 Verification (agent-browser, live dev server)
- **Viewport matrix — 8/8 PASS** (320×568, 360×800, 375×812, 390×844, 412×915, 768×1024, 1024×768, 1366×768): zero document-level horizontal overflow on the dashboard; all 11 modules swept clean at 320px.
- Found+fixed during testing: header company-name span (38px overflow at 320) and KPI money overflow (5px at 768).
- **Mobile golden path**: created INV-2627-007 via the stacked line editor at 360px (stock validation correctly blocked MAIN-warehouse post first; succeeded from JW store; ₹5,406→₹6,379 w/ 18% GST; DB row verified) → recorded ₹500 partial payment RCP-2627-005 on mobile (DB: paid 500, balance 5,879, GL committed).
- Drawer: opens/closes, scroll locked while open + restored on close, Escape closes, closes after navigation; tablet 768 shows desktop sidebar + hides hamburger.
- Dialog gutters measured 16px each side at 320/360; 92dvh cap + internal scroll verified; column hiding verified by header inspection (6→5 visible cols items table at 320; 11 restored at 1366).
- PWA: manifest/sw/offline/icons all 200; SW `registered/active/controlled` scope `/`; offline emulation → amber banner shows, page fetches fail honestly (no fake success), offline.html precached (full-outage navigation fallback is code-reviewed + precache-verified; CDP offline emulation does not block the SW's own fetches, so the end-to-end fallback could not be exercised here — flagged honestly).
- e-Invoice JSON + GST-portal auto-open regression PASS (exact portal URL, retry engaged when first open blocked, preview 200 → download 200, toast confirmed).
- Desktop regression: all 11 Sales columns, sidebar, charts, no overflow at 1366; `bun run lint` clean; no dev.log errors; no console errors (only pre-existing Radix a11y warnings).

## 16. SaaS organization login/logout + Platform Admin separation (2026-11-07, session 6)

User directive: "main ek saas product bana raha hoon to multiple organization honge to particular organization ke liye login and logout ye option chahiye na aur maine jo screen shot bheje the admin platform ke us tarah ka admin platform chahiye na is organization main kyon platform admin ka diya he" — per-org login/logout, Platform Admin as a separate console (login-screen entry), NOT inside the organization's ERP.

### 16.1 Auth foundation (new)
- `prisma/schema.prisma` — **OrgUser** model (email unique, scrypt `salt:hash` password, name, role OWNER/ACCOUNTANT/VIEWER, companyId FK cascade, lastLoginAt) + Company.users relation; additive `db push` (existing data untouched).
- `src/lib/auth.ts` — scrypt hash/verify (timing-safe), HMAC-SHA256 signed session token (`base64url(payload).sig`, 7-day expiry), httpOnly/lax/sameSite cookie helpers, `currentSession()` via `cookies()`.
- Routes: `POST /api/auth/login` (no account-enumeration: same "Invalid email or password" for unknown email vs wrong password; lastLoginAt + LOGIN audit), `POST /api/auth/logout` (+LOGOUT audit), `GET /api/auth/session` (session info with `operating` flag + access state + plan), `GET /api/auth/status` (companyExists/usersExist/demoHint for the login screen), `POST /api/auth/bootstrap` (first owner login for an existing company — manual-setup path; refuses once any login exists; auto sign-in).
- `src/proxy.ts` (Next 16 proxy convention — replaces deprecated middleware.ts): API sign-in gate. Public prefixes: /api/auth, /api/platform, /api/seed, /api/masters/company (first-boot), /api/backup. Everything else: 401 without a cookie AND with an invalid/forged/expired token (WebCrypto HMAC verify at the edge, constant-time compare; secret kept in sync with lib/auth).
- `assertCompanyAccess` (lib/platform.ts) now also enforces, once logins exist: session required (401) + session org must BE the operating org for any business mutation (403 "Your organization has no ERP workspace on this deployment yet").
- `GET/POST /api/backup` + restore now platform-key gated (`requirePlatformKey`; `?platformKey=` query accepted for the browser download; platformKeyOk extended). BackupCard in the console passes the key.

### 16.2 Login screen + org portal (new components)
- `login.tsx` — **LoginView**: flat SaaS-style card (brand header, sign-in form, demo-credentials hint chip with Fill button, separate "platform staff → Platform Admin console" dashed entry below a divider). Bootstrap mode ("Create your owner login") when a company exists but no logins do. Also **ManualSetupView** — pre-auth company-basics wizard (name/legal/GSTIN checksum hint/state/city/email → PUT /api/masters/company), replacing the old "full ERP shell with no company" manual path; full profile later in Masters → Company.
- `portal.tsx` — **OrgPortal** for non-operating org sessions: real org data (GSTIN/email/city/plan/trial-end, status badge, blocked message) + the honest "Where are the books?" note (workspace is attached to the operating org; per-org book-keeping is the multi-tenant roadmap) + Logout. Never shows another org's books.
- `seed.ts` — demo owner login (owner@shreeforge.example.com / forge123, Anil Deshpande, OWNER) created with the seeded company.

### 16.3 ErpApp rewiring (SaaS boot flow)
- Boot: company+session probes → skeleton → first-boot (SetupScreen / ManualSetupView) → platformMode console → LoginView → OrgPortal (non-operating session) → ERP shell.
- ERP header: shield/Platform Admin button REMOVED → **UserMenu** (initials avatar, name/email/role/org, Sign out). Suspended/trial banners informational only ("Open Platform Admin" buttons removed). `platform` removed from ErpView/store/palette (recents filtered to known labels).
- Platform console: opened ONLY from the login screen; "Back to ERP" → "Back to login" (key gate + console header); footer honesty line updated.

### 16.4 Platform Admin org logins
- Create-organization dialog gains an "Owner login (optional)" block (owner name / login email / password ≥6) → POST creates the OrgUser; success toast names the login.
- Org row Contact cell shows the owner login (or "no login"); desktop pill + mobile ⋯ menu get **Set login / Reset login** → PATCH `action:'resetLogin' {email, password}` (creates or resets the org's owner login; email conflicts across orgs 409-guarded).

### 16.5 Verification (executed live, headless Chromium + curl)
- Existing-data DB → bootstrap owner created via UI → auto sign-in → ERP shell with live KPIs; UserMenu → Sign out → login screen; demo hint + Fill → sign-in again → ERP.
- Wrong password → inline "Invalid email or password" (login 401 in dev.log). httpOnly cookie confirmed unreadable from JS.
- Platform console: unlocked with forge-admin → created "Acme Precision Works" (Nashik) with owner priya@acme.example.com → org row shows the login → console Logout → key gate → Back to login.
- Priya sign-in → **OrgPortal** with real data (email/city/plan/trial 19 Nov 2026/free-trial badge) + honest books note; her session business mutation → 403 "no ERP workspace"; her sign-out works.
- Operating-org session: business mutation allowed (party created then cleaned up); suspended org → banner shows, mutation 403, reactivated → banner gone.
- Gate matrix (curl): no cookie 401 · forged cookie 401 · public status/company 200 · platform key good 200 / bad 401.
- Palette: no Platform Admin entry; no console/page errors; Sales module spot-check (7 posted, Σ ₹3,18,683) intact; footer bottom-edge at 390×844 and natural push at 1366×768; `bun run lint` clean.

### 16.6 Honest scope (unchanged, now visible in UX)
- The ERP workspace serves the FIRST company; org logins for other orgs land on the real org portal, and their sessions cannot mutate the books. Read-level per-org scoping (companyId on business tables) remains the multi-tenant roadmap item — stated in the portal UI, the platform console footer, and code comments; no fake multi-tenancy is simulated.
