# Source Repository Comparison Matrix (Phase 4)

Classifications: **F** = fully implemented & verified · **P** = partially implemented · **UI** = UI only · **BE** = backend only · **N** = not found · **X** = cannot verify / inaccessible.
Verdict: **ADOPT** (implement in target) · **ADAPT** (simplified/contextualized) · **AVOID**.

| # | Feature | ERPNext | Laserp | GST Billing | Verdict | Notes / key evidence |
|---|---|---|---|---|---|---|
| 1 | Doc lifecycle draft/submit/cancel + reversal-not-delete | F (`docstatus`, `make_reverse_gl_entries`) | P (status strings, cancel w/o GL reversal) | P (cancel zeroes stock delta) | **ADOPT** | ERPNext `accounts/doctype/gl_entry`, `general_ledger.py:647` |
| 2 | Append-only stock ledger | F (`stock_ledger.py`, signed qty, queue) | F (immutable StockLedger rows) | P (per-bill deltas in JSON) | **ADOPT** | laserp `erp-helpers.ts::postStock` |
| 3 | Stock valuation (FIFO/MA) | F (both, persisted queue) | F (moving average upsert) | P (purchase-price based) | **ADAPT** | We compute weighted-average cost from ledger at report/posting time |
| 4 | Negative stock prevention | F (0.0001 threshold) | F (clamp + availability check) | N | **ADOPT** | Validate before outward posting |
| 5 | Running balance / bin cache | F (bin table + qty_after_transaction) | F (StockBalance upsert) | N | **ADAPT** | Compute running balance in report query (MVP scale) |
| 6 | GST exclusive calc + intra/inter split | F (template rows) | F (`computeGst`) | F (tested) | **ADOPT** | laserp `erp-helpers.ts:176`; gst `utils.js:216` |
| 7 | GST **inclusive** pricing | F (slope/intercept solver) | N | F (`/(1+rate/100)`, tested) | **ADOPT** | gst `utils.js` tax-test cases |
| 8 | Place-of-supply drives IGST decision | X (regional pack out of scope) | P (uses party state) | F (PoS beats state; tested) | **ADOPT** | gst `utils.js:279-313` |
| 9 | UTGST (5 UTs) | X | N | F (`utils.js:322`) | **ADAPT** | Treat UTGST as SGST bucket in MVP |
| 10 | Reverse charge (RCM) | X | N | F (tested: total = taxable) | **ADAPT** | Roadmap P2 (schema-ready flag) |
| 11 | GSTIN validation | X | N | F (mod-36 checksum + decode) | **ADOPT** | At party data entry |
| 12 | GSTR-1 report | F (via regional+reports) | P (client-side HTML summary) | F (portal JSON + buckets) | **ADAPT** | Rate-wise B2B/B2C summary now; JSON export P2 |
| 13 | Double-entry GL on all vouchers | F | **N — no GL at all** | P (ledger views only) | **ADOPT** | Our differentiator vs laserp; ERPNext `gl_entry` structure |
| 14 | Trial balance integrity check | F | N | N | **ADOPT** | ΣDebit == ΣCredit assertion in report |
| 15 | Payment entry + invoice allocation | F (`payment_entry.py`, validated) | F (amount ≤ outstanding guard) | F (payments[] + receipts) | **ADOPT** | laserp `payments/route.ts:83` |
| 16 | Customer/supplier outstanding | F | F | F (Tally-style matrix + aging) | **ADAPT** | Aging buckets P2 |
| 17 | BOM (multi-level, recursion check) | F (`BOMRecursionError`) | F (Bom/BomItem, scrap%) | P (flat, cycle-detect) | **ADAPT** | Roadmap P2 (not in MVP scope) |
| 18 | Work order + job card | F (89+93 fields, overlap validation) | F (simpler WO+ProductionEntry) | N | **ADAPT** | Our Jobwork module covers the party-jobwork variant |
| 19 | **Jobwork: Inward→JobCard→Certificate→Invoice** | X (subcontracting differs) | **N** | N | **BUILD** | User's core requirement — built fresh per spec |
| 20 | Partial item processing + remaining qty/weight tracking | P (pending_qty on job card) | N | N | **BUILD** | JobworkInwardItem.processedQty/Weight |
| 21 | Process-wise rates (per KG / per piece, party-specific) | X | N (machine hourlyRate only) | N | **BUILD** | Process + PartyProcessRate models |
| 22 | MRP explosion | F (Production Plan) | F (pure fn, unit-tested) | N | **AVOID (now)** | Roadmap P3 |
| 23 | QC inspection | F | F (QcInspection auto from GRN) | N | **AVOID (now)** | Roadmap P3 |
| 24 | Auth + sessions + RBAC | F (frappe roles) | F (scrypt+DB session+middleware) | N (single user) | **AVOID (now)** | Single-user MVP; laserp's pattern is our P0 roadmap item |
| 25 | Audit log | F (versioning) | F (AuditLog on every tx) | P (inline audit docs) | **ADAPT** | Ledger rows + isCancelled trail serve as audit in MVP |
| 26 | Realtime notifications | F | F (socket.io sidecar) | N | **AVOID (now)** | No WS need in MVP |
| 27 | Print: GST tax invoice + amount in words | F (print formats) | F (printHtml + pdfkit + words) | F (compliance layout) | **ADOPT** | gst-billing field list is our print spec |
| 28 | CSV import/export | F | F (dependency-free CSV parser) | F (bulk CSV) | **ADAPT** | CSV export on tables now; import P3 |
| 29 | Dashboard KPIs | F | F (9 KPIs + trend) | F | **ADOPT** | laserp's KPI set + stock value |
| 30 | Multi-company/tenant | F | F | P (multi-profile) | **AVOID** | Single company MVP |
| 31 | Document numbering | F (series) | F (NumberSeq per FY, atomic) | F (atomic + peek) | **ADOPT** | Counter table inside posting transaction |

### Known reference defects we explicitly avoid (BUG_AND_SECURITY_REPORT.md §1)
- laserp: purchase inter-state check via state **names** (works only by 1:1 coincidence) — we use state **codes**.
- laserp: audit user identity from request body — all our mutations use server-derived data only (no user system yet).
- laserp: declared RETURN_IN/SALES_RETURN ledger types never posted — we implement invoice cancel reversal instead of dead enums.
- gst-billing: tax logic duplicated engine↔screens — we have ONE pure engine used by UI and API.

## Reference technology vs target stack
Target is fixed: **Next.js 16 + TypeScript + Prisma/SQLite + shadcn/ui** (mission rule: don't change target stack because references differ). ERPNext is Python/Frappe, GST Billing is React/JSON-store — only *ideas* port. Laserp is same-stack but **unlicensed** — patterns only, no code copying. erpnashilk is laserp's production-evolved sibling (same author, same stack, MySQL, 54 models) — **also unlicensed → patterns only, no code copying**. Mapsoft ERP (demo.mapsofterp.in) is a live proprietary commercial product — UX inspiration only.

---

## Addendum (2026-11): erpnashilk + Mapsoft ERP — new comparison rows

erpnashilk was 404 during the original matrix (row set fixed above); it became public afterwards. New findings vs the original matrix (laserp column ≈ erpnashilk baseline since they share the skeleton — only deltas listed):

| # | Feature | erpnashilk (vs laserp baseline) | Mapsoft ERP demo | Verdict for target |
|---|---|---|---|---|
| A1 | Paisa-exact bill math (integer paise + largest-remainder discount spread) | **F** (`computeBillTotals`, erp-helpers.ts:414) | F (commercial) | **ADOPT** — upgrades our r2-only `erp.ts` line math; kills 1-paisa GSTR-1 drift |
| A2 | Bill-level charges: freight/packing as taxable lines + round-off | **F** | P | **ADOPT** — common Indian invoice requirement |
| A3 | GSTR-1 JSON in GSTN offline-tool format (b2b/b2cl/b2cs/cdnr/hsn) | **F** | P (GST=HSN master + e-Invoicing menu) | **ADAPT** — roadmap P2 (we already have summary buckets) |
| A4 | e-Invoice IRP bulk-upload JSON v1.1 + pre-validation | **F** (`einvoice.ts`) | F (IRN Status column per invoice) | **DONE (2026-11 e-Invoice session)** — `src/lib/einvoice.ts` + `/api/e-invoice` per-invoice & bulk export with full pre-validation; see §12 |
| A5 | Cheque lifecycle (pending→deposited→cleared/bounced) + clearing-date accounting | **F** | F (Vouchers) | **ADOPT** — fits our Payments module |
| A6 | Customer advances + return credits applied to invoices (row-locked, no money moves) | **F** (`credit-apply.ts`) | F | **ADOPT** — roadmap P2 |
| A7 | Negative-cash refusal + duplicate-payment detection | **F** (409 + admin override) | N/V | **ADOPT** |
| A8 | Idempotency-Key table on money endpoints | **F** | X | **ADAPT** — strong pattern; our scale may not need it yet |
| A9 | QC-gated GRN (only accepted qty stocks; append-only corrections) | **F** | P | **ADAPT** — roadmap P3 |
| A10 | BOM backflush on production posting | **F** | F (Raw-material grid) | **ADAPT** — internal-production pattern; our Jobwork chain instead consumes materials via job cards |
| A11 | Cost rate captured on outward stock moves (sales-return costing) | **F** (`costRate` on StockLedger) | F | **ADOPT** — when we add sales returns |
| A12 | Batch FEFO + serial/IMEI registry | **F** | P | **ADAPT** — roadmap P3 |
| A13 | Vyapar backup import (.vyb/.vyp with hand-written SQLite reader) | **F** | N | **AVOID (now)** — nice migration story, not our scope |
| A14 | Tally voucher/master export + read-only connector PoC | **F** | N | **AVOID (now)** — roadmap P4 |
| A15 | Multi-tenant SaaS (plans, limits, suspend, tenant backup/restore) | **F** | F | **AVOID** — single-company target (mission rule) |
| A16 | Double-entry GL | **N — still document-derived** | **F** (Chart of Accounts, GRNI clearing acct) | **ADOPT (already ours)** — our differentiator vs both repos; Mapsoft's GRNI clearing pattern noted for P2 accrual |
| A17 | Jobwork (outsource) chain Inward→JobCard→Certificate→Invoice | **N — internal production only** | **N — Manufacturing Batches + Material Requests only** | **BUILD (already ours)** — user-unique requirement; now confirmed absent from ALL 4 repos + both demos |
| A18 | Dashboard "Attention Required / Pending Actions" panels | P (KPI cards + low-stock) | **F** (overdue bills/invoices, approval queues) | **ADOPT** — high-value low-effort dashboard upgrade |
| A19 | Public invoice share link (token, QR, no login) | **F** | P (Email status) | **ADAPT** — roadmap P3 |
| A20 | Money as Float with documented-but-unapplied Decimal plan | **F (weakness)** | F (commercial) | **AVOID their fate** — keep our decimal-safe approach; document the drift risk |

**Mapsoft ERP module breadth NOT to chase** (out of scope for target): CRM/Leads/Deals, Project management/Phases/Timesheets, HRMS (Leaves/Attendance), Services (Service Calls), POS, e-Way Bills, TDS, multi-currency, RFQs, Back Orders, Product Requisitions, Store Consumption, 18-module accordion sidebar. These are noted as commercial-UX inspiration only.

---

## Implementation status of addendum rows (2026-11 feature session)

Rows implemented in ForgeERP (see IMPLEMENTATION_CHANGELOG §10): **A14 (Tally voucher/master/bulk export + .bat + connector PoC)**, **A15-adapted (platform admin: plans, subscription control with real 403 enforcement, limits — single-tenant runtime)**, **A18-adapted (suspension/trial banners; dashboard quick actions)**, plus not-in-matrix additions: audit trail, backup/restore, invoice duplicate action buttons, CSV exports. **§12 session added A4 (e-Invoice IRP JSON v1.1 per-invoice + bulk + pre-validation, Party.pincode, Tally JSON file download, screenshot-parity Tally dropdown).** Still open: A1 (paisa-exact largest-remainder bill math), A2 (bill-level charges), A3 (GSTR-1 JSON), A5 (cheque lifecycle), A6 (advances/credit-apply), A9 (QC-gated GRN), A11 (costRate), A12 (batch/serial), A19 (share links).
