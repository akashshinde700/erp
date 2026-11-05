# Database Relationship Analysis & Design — Phase 6 (Blueprint)

SQLite constraints: no enums (status strings), no arrays, no `Decimal` (Float + `r2()` discipline), no deferred FKs. All money = Float rounded to 2 dp at every computation step.

## Entity relationship map

```
Company (1 row)
Party 1──* SalesInvoice 1──* SalesInvoiceItem *──1 Item
Party 1──* PurchaseInvoice 1──* PurchaseInvoiceItem *──1 Item
Party 1──* JobworkInward 1──* JobworkInwardItem *──1 Item
Party 1──* Payment 1──* PaymentAllocation ──(polymorphic)── SalesInvoice | PurchaseInvoice
Party 1──* PartyProcessRate *──1 Process
Process 1──* JobCardProcess *──1 JobCard *──1 JobworkInward
JobCardProcess *──1 JobworkInwardItem (FK — fixes laserp's bare-id weakness)
JobworkInward 1──* JobworkCertificate
Item 1──* StockLedger *──1 Warehouse          (append-only, reversal rows on cancel)
AccountLedger (flat double-entry rows, partyId nullable)
Counter (key: "PREFIX-FY", atomic in-tx increment)
```

## Models & integrity rules

### Masters
- **Company**: name unique, gstin, stateCode (GST state code, drives inter-state), bank details for print.
- **Party**: code unique; `types` CSV `CUSTOMER,SUPPLIER,JOBWORKER`; gstin (checksum-validated); stateCode; `openingBal` (+ = receivable). Index on types.
- **Item**: code unique; `isService` (services skip stock ledger); uom (KG/PCS/MTR/LTR/BOX); gstRate; saleRate/costRate; reorderLevel; hsn.
- **Warehouse**: code unique.
- **Process**: code unique, `seq` (routing order), `basis` WEIGHT|QTY, default rate + lotCharge. **PartyProcessRate** unique (partyId, processId) — party-specific rate overrides.

### Transactions (all: number unique, status POSTED|CANCELLED or OPEN-chain)
- **SalesInvoice**: pos (place of supply code), interState (derived: pos ≠ company.stateCode), taxInclusive, totals (taxable/cgst/sgst/igst/roundOff/grandTotal), paidAmount, source MANUAL|JOBWORK. Items: qty, rate, discPct → taxable, tax split, line total.
- **PurchaseInvoice**: mirrored (input tax).
- **JobworkInward**: status OPEN→IN_PROGRESS→COMPLETED→INVOICED (| CANCELLED). Items carry **qty + weight + processedQty + processedWeight** → remaining = qty − processedQty (partial processing support, the user's core requirement).
- **JobCard**: status DRAFT|COMPLETED|CANCELLED; **JobCardProcess** rows aggregate same process (one row per process per item selection), each with qty, weight, basis, rate, amount = basis=WEIGHT ? weight×rate : qty×rate (+ lot charge once per process).
- **JobworkCertificate**: certNo, inward totals snapshot.
- **Payment**: type RECEIPT|PAYMENT, mode, amount; **PaymentAllocation** rows (invoiceType SALES|PURCHASE, invoiceNo, amount ≤ outstanding guard — laserp `payments/route.ts:83` pattern).

### Ledgers (append-only)
- **StockLedger**: voucherType OPENING|PURCHASE|SALES|JOBWORK_IN|ADJUST; signed qtyIn/qtyOut + rate; `isCancelled` reversal rows reference same voucherNo. Indexes: (itemId, warehouseId, postingDate), (voucherNo).
- **AccountLedger**: account code + name, partyId, debit/credit, voucherType/voucherNo, isCancelled. Indexes: (account, date), (voucherNo).
- Valuation: **weighted average cost** computed from ledger (Σin-value / Σin-qty) at posting/report time — simplified moving average (laserp `postStock` idea, computed rather than cached for MVP scale).

### Chart of accounts (fixed constants, ERPNext `gl_entry` shape)
`DEBT` Debtors · `CRED` Creditors · `SALS` Sales · `PURC` Purchases · `JWIN` Jobwork Income · `CGSTP/SGSTP/IGSTP` Output GST · `CGSTI/SGSTI/IGSTI` Input GST · `CASH` · `BANK` · `RND` Round Off · `OPEN` Opening Balance.

## Posting matrix (what each voucher writes, atomically)

| Voucher | StockLedger | AccountLedger (Dr / Cr) | Other |
|---|---|---|---|
| Sales invoice POST | qtyOut @ avg cost (stock items) | Dr DEBT grand · Cr SALS taxable · Cr CGSTP/SGSTP/IGSTP · Cr/Dr RND roundOff | invoiceNo via Counter |
| Sales CANCEL | reversal qtyIn rows | mirrored reversal rows (isCancelled) | block if paidAmount>0 |
| Purchase POST | qtyIn @ line cost | Dr PURC · Dr GST input · Cr CRED grand · RND | — |
| Payment RECEIPT | — | Dr CASH/BANK · Cr DEBT | allocations update invoice.paidAmount |
| Payment PAYMENT | — | Dr CRED · Cr CASH/BANK | same |
| Jobwork inward POST | qtyIn (JOBWORK_IN) @ 0 cost | — | status OPEN |
| Job card COMPLETE | — | — | bump inward items processedQty/Weight; inward status |
| Certificate ISSUE | — | — | snapshot totals |
| Jobwork invoice | — | (as sales invoice, income → JWIN) | source=JOBWORK |
| Opening stock | qtyIn OPENING @ rate | Dr item-value? no — Cr OPEN equity, Dr STOCK implicit | MVP: stock value tracked in ledger only; GL: Dr OPEN-asset not modeled (see limitations) |

## Known limitations (documented honestly)
1. Float money (no integer paise) — acceptable for MVP scale, r2 at every step; P1: Postgres+Decimal.
2. PaymentAllocation.invoiceId is polymorphic string (SALES|PURCHASE discriminator) — no FK possible.
3. No bin cache; running balances computed on read (fine at MVP volume; ERPNext-style cache is P2).
4. Opening stock posts stock ledger only; a matching GL asset entry is a P2 refinement.
5. Single company, single user (no auth) in MVP — P0 roadmap item.
