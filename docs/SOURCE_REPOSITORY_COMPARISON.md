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
Target is fixed: **Next.js 16 + TypeScript + Prisma/SQLite + shadcn/ui** (mission rule: don't change target stack because references differ). ERPNext is Python/Frappe, GST Billing is React/JSON-store — only *ideas* port. Laserp is same-stack but **unlicensed** — patterns only, no code copying.
