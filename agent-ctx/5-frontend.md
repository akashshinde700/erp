# Task 5 — ForgeERP Frontend (single-page module-registry ERP app)

**Agent:** frontend agent (Z.ai Code) · **Date:** 2026-11 (session) · **Task ID:** 5

## Scope

Complete frontend for ForgeERP (manufacturing + jobwork + GST + accounting ERP). Backend was frozen and seeded
(company "Shree Forge Industries"). Only user-visible route: `/` (src/app/page.tsx → `<ErpApp />`).

## Files created / modified

**Modified (only the three allowed app files):**
- `src/app/globals.css` — deep emerald/teal primary + warm stone surfaces, dark-mode vars kept consistent,
  `.erp-scroll` scrollbars, `@media print` rules (`.print-area` visibility isolation + A4 sizing).
- `src/app/layout.tsx` — sonner `<Toaster richColors position="bottom-right" closeButton />` (replaced old
  toaster import), ForgeERP metadata.
- `src/app/page.tsx` — renders `<ErpApp />`.

**Created (`src/components/erp/`):**
- `api.ts` — envelope fetch helper (apiGet/apiPost/apiPut/apiDelete, toastError), full TS types for every
  endpoint, `useApi` hook (stale-while-revalidate, no setState-in-effect), `useMasters`, `useMounted`
  (useSyncExternalStore hydration-safe), `num`/`todayISO`/`currentMonth`.
- `store.ts` — zustand `useErpUi {view, params, setView}` view router (dashboard, sales[-detail], purchase[-detail],
  jobwork[-detail], inventory, accounting, reports, masters, docs).
- `company.tsx` — CompanyProvider/useCompany context.
- `bits.tsx` — StatusBadge, SourceBadge (JOBWORK + wrench icon), VoucherBadge, Money, Qty, KpiCard, SectionHeading,
  EmptyState, TableSkeleton/CardSkeleton, ProgressBar.
- `erp-app.tsx` — shell: boot check (`/api/masters/company` null → setup screen with "Load demo data" →
  POST /api/seed?force=1, or manual setup), sticky header (company + GSTIN + FY + date chips), desktop sidebar
  (deep emerald, groups OVERVIEW/TRANSACTIONS/BOOKS/SETUP) + mobile Sheet drawer, view switch, sticky footer
  (`min-h-screen flex flex-col` root, footer `mt-auto`, safe-area padding).
- `dashboard.tsx` — 6 KPI cards, recharts AreaChart (sales vs purchase, 6-month), Recent Invoices (click →
  sales-detail), Low Stock card.
- `invoice-module.tsx` — shared sales/purchase module: list (search/status filter, Σ totals, max-h scroll,
  sticky header), create dialog (party select w/ state+GSTIN, PoS defaults to party state, taxInclusive switch,
  line editor with item autofill uom/hsn/gst/rate, **live totals via computeInvoiceTotals from @/lib/erp** with
  IGST vs CGST+SGST logic from PoS/company state, per-line preview), detail view with InvoicePrint + Cancel
  (AlertDialog, server-error surfaced via toast) + Print.
- `sales.tsx` / `purchase.tsx` — thin wrappers around InvoiceModule (purchase: interState hint, no PoS select).
- `invoice-print.tsx` — print-compliant GST invoice: company block, TAX INVOICE/PURCHASE INVOICE title, meta
  (PoS as "27-Maharashtra" via stateName), party block, 13-col items table, totals block (taxable/discount/
  CGST/SGST/IGST/roundOff/GRAND TOTAL), tax summary by rate, HSN summary, amountInWords, bank+UPI, declaration,
  signature; wrapped in `.print-area`.
- `inventory.tsx` — Tabs: Stock Summary (lowStock amber badges, closing-value footer), Stock Ledger
  (item/warehouse/date filters, running balance, VoucherBadge), Opening Stock (rows + warehouse + POST → voucherNo).
- `jobwork.tsx` — flagship: Inwards list (progress bar, card value, status), New Inward dialog, **inward detail**
  (progress cards, items table w/ remaining, job cards with per-process rows + cancel-card AlertDialog,
  certificates with parsed details JSON, action bar: New Job Card / Issue Certificate / Generate Invoice /
  Cancel Inward — enabled per chain state), New Job Card dialog (per-item checkbox + qty/weight prefilled with
  remaining and max=remaining, process multi-select with basis+rate, **live estimate using process default rates**
  + note that server uses party rates), Pending tab (jobwork-pending report with process chips).
- `accounting.tsx` — Payments tab (list + cancel; New Payment dialog: RECEIPT/PAYMENT toggle, party filtered by
  type, mode select, **allocation section auto-listing open POSTED invoices with outstanding**, Σallocated ≤ amount
  + per-line ≤ outstanding validation) and Party Ledger tab (opening row, running balance, closing summary).
- `reports.tsx` — GSTR-1 (month input, B2B/B2C rate-wise tables + totals + count chips), Trial Balance (period
  filters, green/red ΣDr=ΣCr integrity banner), Outstanding (receivables/payables + totals), P&L statement layout.
- `masters.tsx` — Tabs: Parties (search, types badges, **live GSTIN checksum ✓/✗**, openingBal ± hint,
  activate/deactivate), Items (isService switch forces isStockItem off, UOMS/GST rate selects), Warehouses,
  Processes (basis select with ₹/KG vs ₹/piece hint), Party Rates (party select → editable grid, overridden
  badge, save sends only rows differing from defaults — full-list replace), Company (full form + GSTIN validity,
  PUT upsert).
- `docs.tsx` — static "Reverse-Engineering Intelligence" page: per-repo cards (ERPNext / Laserp / GST-Billing /
  erpnashilk-404 honest disclosure), tool disclosure (reverse-skill adopted-by-hand, rea not-applicable),
  implementation mapping table (§5), 7-doc index cards. No runtime fetching.

## Verification performed (headless browser over the live dev server)

- Dashboard KPIs/chart/recent/low-stock render with seeded data; row click → sales detail.
- Sales create: PoS defaulted to party state (Gujarat → IGST preview ₹8,000→₹9,440; WB → IGST 18,880),
  item autofill, live totals panel, post → toast + list refresh.
- Jobwork chain end-to-end on JWI-2627-002: New Job Card (prefilled remaining, estimate) → JC-2627-003 ₹7,875 →
  inward COMPLETED → Issue Certificate CERT-2627-002 (200 pcs / 515 kg / ₹7,875) → Generate Invoice
  (INV-2627-006, source JOBWORK) → inward INVOICED, buttons correctly disabled.
- Payment + allocation W3: receipt RCP-2627-003 ₹5,000 allocated to INV-2627-007; dialog closes on success,
  stays open with toast on server error (insufficient stock in default warehouse — correct guard).
- Reports: GSTR-1 rate-wise (4 B2B invoices 18% bucket), Trial Balance "Balanced ✓ ΣDr = ΣCr = ₹8,18,797.01",
  Outstanding, P&L statement.
- Mobile 390×844: Sheet drawer navigation works.
- `bun run lint` → 0 errors / 0 warnings. `curl localhost:3000/` → 200. dev.log clean.

## Deviations from spec (minor, deliberate)

1. **Shared `invoice-module.tsx`** instead of duplicating sales/purchase logic — `sales.tsx`/`purchase.tsx` are
   thin wrappers (backend mirrors too). Same UX as spec.
2. **Added optional "Stock From" warehouse select** in the invoice/purchase create dialog (API already accepts
   `warehouseId`): seeded finished goods from jobwork sit in the JW store, so selling FG-1001 against the default
   MAIN store correctly fails with "Insufficient stock" — the select makes the demo fully usable. Noted, not a
   backend change.
3. `api.ts`/`store.ts`/`company.tsx`/`invoice-module.tsx` are extra files beyond the suggested list (spec said
   "suggested files").
4. UI tests hit live data: db/custom.db gained INV-2627-007 (₹10,030, allocated ₹5,000), JC-2627-003,
   CERT-2627-002, RCP-2627-003 — all through the public API (no backend file touched).

## Notes for next agents

- All ERP business rules live client-side ONLY for preview; every mutation is server-validated (envelope errors
  are toasted verbatim).
- Status→variant map and formatting helpers are shared via `bits.tsx` + `@/lib/erp`.
- Print: `window.print()` from the detail action bar; `.print-area` isolation + A4 rules in globals.css.
