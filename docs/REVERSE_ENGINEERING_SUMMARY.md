# Reverse Engineering Summary

**Mission:** Deep reverse engineering of 4 authorized open-source ERP repositories → consolidated intelligence → Manufacturing ERP (GST + Accounting) implementation on the target project.
**Methodology:** Static source analysis with evidence discipline adopted from `reverse-skill` (see §4). All findings below carry file-path evidence from local read-only clones at `/home/z/reference-repos/`.
**Date:** 2026-02 (session execution)

---

## 1. Scope Contract (re-implemented by hand from `reverse-skill/skills/ops/scope-contract.md` — its scripts were NOT executed)

| Item | Value |
|---|---|
| Authorization | User-directed analysis of public open-source repositories (GPL-3.0 / public / MIT as noted) |
| In scope | Read-only static analysis of cloned source trees; documentation |
| Out of scope | Penetration testing, exploitation, network scanning, executing external scripts |
| Network profile | Offline analysis of local clones |
| Target project | `/home/z/my-project` (greenfield — see EXISTING_ARCHITECTURE.md) |

## 2. Repository Access Ledger

| Repository | Access | Clone | Analysis |
|---|---|---|---|
| frappe/erpnext | OK (`git ls-remote` HEAD `c1634fc`) | 44 MB sparse (manufacturing, stock, accounts, selling, buying, controllers, regional) | Task 2-a — done |
| akashshinde700/laserp | OK (HEAD `f05efc9`) | 11 MB full | Task 2-b — done |
| akashshinde700/erpnashilk | **FAILED — 404/removed/private** (`git ls-remote` → auth prompt = not publicly resolvable) | — | **Not analyzed. No functionality invented for it.** Recorded per mission Phase 1 rule. |
| IamRamgarhia/Free-GST-Billing-Software | OK (HEAD `6966543`) | 14 MB full | Task 2-c — done |
| zhaoxuya520/reverse-skill | OK | 15 MB full | Task 2-d — methodology inspection only |
| morluto/rea | OK | 127 MB full | Task 2-d — applicability verdict only |

## 3. Per-Repository Intelligence Extracted

### 3.1 ERPNext (frappe/erpnext, GPL-3.0) — enterprise patterns
- **Document lifecycle:** universal `docstatus 0=Draft/1=Submitted/2=Cancelled` on every transaction doctype; cancelled via **reversal entries, never deletion** (`accounts/general_ledger.py::make_reverse_gl_entries`, `stock/stock_ledger.py::make_sl_entries` cancel path negates `actual_qty`).
- **Stock ledger engine** (`stock/stock_ledger.py`, 3288 lines): signed `actual_qty`, `qty_after_transaction`, `valuation_rate`, `stock_value`, persisted FIFO `stock_queue` JSON; negative-stock threshold 0.0001; **Bin cache** table unique per (item, warehouse) with projected-qty formula (`stock/doctype/bin/bin.py`).
- **Derived status:** Work Order status recomputed from ledger sums (`manufacturing/doctype/work_order/services/status.py::get_status`); over-production percentage guard.
- **Tax engine** (`controllers/taxes_and_totals.py`): slope/intercept model `tax = slope·net + intercept` solving inclusive taxes exactly; currency-fraction rounding (0.05 INR); `rounding_adjustment = rounded_total − grand_total`.
- **GL entry structure** (`accounts/doctype/gl_entry/gl_entry.json`): account, party, debit, credit, against_voucher, is_cancelled.
- **Naming series:** `ACC-SINV-.YYYY.-`, `MAT-STE-`, `MFG-WO-` per doc type + FY.
- **Weaknesses:** god-controllers (3288-line files), O(n) recount on every write, huge backdated reposting machinery, config sprawl.
- **India GST regional pack NOT in sparse scope** (honest limitation — GST split logic sourced from the GST billing repo instead).

### 3.2 Laserp / "ManuFlow ERP" (akashshinde700/laserp) — same-stack reference
- Stack: Next.js 16 App Router + Prisma/SQLite + shadcn/ui, single-page module-registry UI (`src/components/erp/erp-app.tsx`), Vitest+Playwright.
- 30-model schema (`prisma/schema.prisma`): full chains Enquiry→Quotation→SO→Delivery→Invoice; PR→PO→GRN(QC)→PI; BOM→WorkOrder→MaterialIssue→ProductionEntry; StockLedger+StockBalance; Payment; AuditLog; Notification; NumberSeq per (company, docType, FY).
- `computeGst` (`src/lib/erp-helpers.ts:176`): exclusive-only, inter-state→IGST else CGST=SGST=tax/2, r2 rounding.
- `postStock` single choke-point inside `db.$transaction` with moving-average valuation + low-stock notification.
- Server-derived BOM requirements for material issue (client qty untrusted) — tested by `e2e/material-issues-api.spec.ts`.
- Auth: scrypt + DB sessions + HMAC cookie + header-stripping middleware (`src/proxy.ts`), ~20 roles, `requireWrite` per module, audit log on every mutation.
- **LICENSE: none (all rights reserved)** → we adopt patterns/algorithms only, zero code copying.
- Bugs found (evidence in report): line items lack FK relations; purchase invoice inter-state check uses state *names*; audit `userName` client-asserted; declared stock types (RETURN_IN, SALES_RETURN) never posted by any API; no GL/journal.

### 3.3 Free GST Billing Software (IamRamgarhia) — GST compliance brain
- Pure, unit-tested tax engine `src/utils.js::computeInvoiceTotals` with **verified test cases** in `scripts/tax-test.mjs` (1077 lines).
- Rules implemented: inclusive/exclusive (`taxable = afterDisc/(1+rate/100)`); **place-of-supply beats client state**; 5 UT codes → CGST+UTGST; RCM (seller total = taxable only); LUT zero-rating; TDS/TCS ₹50L marginal thresholds with correct bases (TDS on ex-GST value, TCS on receipt incl. GST); odd-paisa CGST/SGST halving with 1e-7 nudge.
- Offline GSTIN mod-36 Luhn checksum + decode (`utils.js:960-1000`).
- GSTR-1 JSON export: b2b/b2cs/b2cl/cdnr/hsn/doc_issue buckets, `stripEmpty`, hsn_b2b/b2c split ≥ 202505 (`src/utils/gstr1Json.js`).
- Print compliance: GSTINs, HSN summary, amount-in-words, PoS as "27-Maharashtra", doc types (TAX INVOICE/BILL OF SUPPLY/CREDIT NOTE...), page-boundary safety.
- Atomic gapless numbering with `peek` (preview without burning).
- Weaknesses: JSON-file persistence, no RDBMS/multi-user/concurrency, manufacturing is single-level lite.

### 3.4 erpnashilk — INACCESSIBLE (404). No analysis performed.

## 4. Tool Usage Disclosure (mission rule: never claim usage that didn't happen)

- **reverse-skill** (MIT): inspected read-only. It is an agent *skill/methodology pack* for security research. We **adopted by hand**: scope-contract, Evidence(E-nnn)→Finding(F-nnn)→Path discipline, append-only timeline, anti-hallucination tagging. **Its scripts/bootstrap were never executed.**
- **rea** (MIT, `rea-agents` v6.8.0): an agent-assisted RE CLI for **binaries/apps without source** (Ghidra/Hopper/IDA/APK/firmware). **Verdict: not applicable** to authorized static analysis of TypeScript source repos. Not executed; none of its heavy toolchains installed.

## 5. Consolidated → Implementation Mapping

| Reference idea | Where it lands in our ERP |
|---|---|
| docstatus draft/submitted/cancelled + reversal-not-delete | All transaction services (`src/lib/services.ts`) |
| Append-only StockLedger/AccountLedger with `isCancelled` reversals | Prisma models + cancel flows |
| Naming series per doc type + FY | `Counter` table, atomic in-transaction increment |
| Inclusive/exclusive GST + PoS-driven split + UTGST + odd-paisa nudge | `src/lib/erp.ts` pure engine (client+server shared) |
| GSTR-1 B2B/B2C rate-wise summary | `/api/reports?type=gstr1` |
| Jobwork chain Inward→JobCard→Certificate→Invoice (user's core requirement) | Dedicated module set |
| Double-entry GL on every voucher (stronger than laserp) | `src/lib/accounting.ts` + trial balance integrity check |
| Single-page module registry UI + kit DataTable | `src/components/erp/*` |
| GSTIN checksum validation at data entry | Party form + `erp.ts` |
| Amount-in-words (Indian crore/lakh) on print | `erp.ts::numberToWords` |
