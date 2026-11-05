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
