# ERP Workflow Documentation (Implemented) — Phase 2.3 reconstruction → Phase 7 implementation

Format per mission: **User action → UI → validation → API → service → DB/ledgers → response → UI update**. All posting flows are single `prisma.$transaction` atomic units.

## W1 — Sales invoice (manual)
1. Sales → New Invoice → party select (loads state/gstin), date, PoS defaults to party state, tax-inclusive toggle.
2. Line items: item select (auto uom/hsn/gstRate/saleRate), qty, rate, disc% — **live GST preview via shared pure engine** `src/lib/erp.ts::computeInvoiceTotals` (inclusive: `taxable = gross/(1+rate/100)`; inter-state → IGST else CGST+SGST halved with 1e-7 nudge; round-off to ₹1).
3. Save → `POST /api/sales-invoices` (zod: partyId, items≥1, qty>0, rate≥0).
4. Service `postSalesInvoice` (transaction): Counter `INV-{FY}-###` → invoice + items → StockLedger `SALES` qtyOut @ weighted-avg cost (availability check per warehouse; service items skipped) → GL: Dr DEBT / Cr SALS / Cr output GST / RND.
5. UI: list refresh (toast), row shows status POSTED + grand total; **View** opens detail with **Print** (GST tax-invoice layout incl. HSN summary, tax split, amount-in-words Indian).
6. **Cancel**: DELETE `/api/sales-invoices/[id]` → blocked if `paidAmount > 0`; else reversal StockLedger + GL rows (`isCancelled: true`), status CANCELLED. Number is never reused (gapless-forward numbering, cancelled stays visible — audit trail).

## W2 — Purchase invoice
Mirror of W1 with supplier, input GST (CGSTI/SGSTI/IGSTI), StockLedger `PURCHASE` qtyIn @ cost, GL Dr PURC + Dr GST-input / Cr CRED. Cancel: reversal rows; blocked if paid.

## W3 — Payment + allocation
1. Accounting → New Payment: type RECEIPT/PAYMENT, party (filtered by type), amount, mode, ref.
2. Open invoices of that party auto-load with outstanding = grandTotal − paidAmount; allocate (validated: Σallocations ≤ amount, each ≤ outstanding; laserp guard pattern).
3. `POST /api/payments` → transaction: Counter `RCP/PAY-{FY}-###`, payment + allocations, invoice.paidAmount += alloc, invoice status derivable (paid if ≥ grand), GL Dr CASH/BANK Cr DEBT (or inverse).
4. Party ledger view shows invoice debits and payment credits with running balance.

## W4 — Opening stock
Inventory → Opening Stock: rows (item, warehouse, qty, rate) → StockLedger `OPENING` qtyIn; re-submitting same item+warehouse+voucherNo replaces by cancelling old rows first (idempotent-ish).

## W5 — JOBWORK CHAIN (core requirement)
```
Party (customer) → Inward (multi items, qty+weight) → Job Cards (partial, multi-process)
   → Certificate → Invoice
```
1. **Inward**: Masters already define Processes + PartyProcessRate. Jobwork → New Inward: party, challan no, N items × (qty, weight) → `POST /api/jobwork/inwards` → Counter `JWI-`, items saved with processedQty=0, StockLedger `JOBWORK_IN` qtyIn @0 (customer-owned material, value-neutral), status OPEN.
2. **Job Card**: from inward detail → New Job Card: pick **one or more inward items (partial qty/weight allowed — remaining shown)**; pick processes (rates auto from PartyProcessRate else Process default; basis WEIGHT (per KG) or QTY (per piece)); same-process rows for same item merge into one aggregated row; lot charge added once per process. Save → `POST /api/jobwork/job-cards` {complete: true} → Counter `JC-`; validation per item: `processedQty + qty ≤ receivedQty` (5% tolerance, ERPNext over-production pattern) — server-side, client qty untrusted (laserp material-issue pattern); on success items' processedQty/Weight bumped, card COMPLETED with totalAmount; inward status → IN_PROGRESS, or COMPLETED when every item fully processed.
3. **Certificate**: inward detail → Issue Certificate → aggregates completed card processes (totalQty, totalWeight, totalAmount) → Counter `CERT-`, status ISSUED.
4. **Invoice**: inward detail → Generate Invoice → builds SalesInvoice (source=JOBWORK) with one service line per aggregated process amount (item = seeded `JW-SERVICE` SAC 998887, gst 18%), party = inward party, PoS = party state → runs full W1 posting incl. GL (income → JWIN). Inward → INVOICED.
5. **Pending report** (`/api/reports?type=jobwork-pending`): per inward item: received / processed / remaining qty & weight + which processes not yet completed.
6. **Cancel** flows: job card cancel rolls back processed quantities (only if no certificate issued on the inward); inward cancel blocked if any completed card exists.

## W6 — Reports
- **Stock ledger** (filters item/warehouse/date; running balance + value at avg cost).
- **Stock summary**: per item — in, out, closing qty, avg cost, closing value; low-stock flag (closing < reorder).
- **GSTR-1 summary**: POSTED sales invoices grouped B2B (gstin present) / B2C, rate-wise {count, taxable, CGST, SGST, IGST} for a month — engine totals reused, so report ≡ print ≡ invoice by construction.
- **Trial balance**: AccountLedger grouped by account, Dr/Cr totals, closing; integrity banner ΣDr == ΣCr.
- **Outstanding**: per party (customers receivable, suppliers payable) from invoice balances + opening.
- **P&L (period)**: Revenue (SALS+JWIN) − Purchases (PURC) − expenses(N/A MVP) → net; note: cash/matching nuance documented.
- **Party ledger**: chronological vouchers per party with running balance.
- **Dashboard**: month sales/purchase, receivables, payables, stock value, open jobwork value, 6-month sales trend (recharts), recent invoices, low stock list.
