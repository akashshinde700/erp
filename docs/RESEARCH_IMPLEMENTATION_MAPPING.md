# Research-to-Implementation Mapping

**Updated:** 2026-11-07  
**Sources consolidated:** `YOUTUBE_PLAYLIST_RESEARCH.md`, `YOUTUBE_ERP_COURSES_RESEARCH.md`, `GITHUB_REPOS_RESEARCH.md`, Mapsoft notes in `PROJECT_AUDIT_PROGRESS.md`, and the current ForgeERP source.

## Workflow boundary: Customer Jobwork vs Own Projects & Manufacturing

These modules are **not duplicates**, but the old labels/navigation made them look overlapping.

| Concern | Customer Jobwork | Own Projects & Manufacturing |
|---|---|---|
| Commercial model | Conversion/service supplied to a customer | Manufacture/fabricate a contracted product/project |
| Material owner | Customer | Company |
| Entry document | Customer material inward/challan | Project + approved BOM + work order |
| Execution | Job card with priced processes | Sequenced production tasks with employee/machine/labour/material cost |
| Stock valuation | Value-neutral `JOBWORK_IN`; excluded from own availability/cost | Company stock consumed through `MFG_ISSUE` |
| Output | Process certificate + jobwork GST invoice | Completed work order/project (FG receipt remains a P0 gap) |
| Billing basis | Process rate by quantity/weight + lot charge | Project contract/budget vs actual production cost |

**Implemented boundary controls:** manufacturing availability and average cost exclude `JOBWORK_IN`; the new material plan states and displays this separation; navigation now calls the modules **Customer Jobwork** and **Own Projects & Mfg**. A second active work order from the same fixed-quantity BOM is rejected to prevent accidental duplicate demand.

## Consolidated mapping

| Research pattern | ForgeERP status after this update | Implementation / next step |
|---|---|---|
| Immutable stock and GL ledgers; reversal instead of delete | Implemented, stronger than several demos | Preserve posting choke-points and cancellation reversals |
| Customer-owned consignment separated from company stock | Implemented for jobwork availability/cost; now visible in planning | Future structural owner ledger and reservations |
| Jobwork Inward → processing → completion certificate → GST invoice | Implemented and hardened | Certificate now requires full processing, freezes the chain, and invoice requires a matching issued certificate |
| BOM-driven net material planning / shortages | Improved | New active-WO material plan: planned, issued, remaining, own stock, shortage, source WOs |
| Duplicate-safe production demand | Improved | One live WO per fixed-quantity BOM until batch/output quantity is modelled |
| Project → BOM → WO → operations | Partial | Existing; needs routing master, dependencies, capacity calendar and task time logs |
| Finish production → independent FG receipt | Missing (P0) | Add output item/qty, QC gate, atomic FG receipt + material variance posting |
| Planned vs actual production cost/variance + WIP settlement | Partial | Labour/material actual cost exists; expected-vs-actual and WIP GL remain |
| MRP demand/supply netting and purchase suggestions | Improved/partial | Active-WO plan nets demand against own stock; Inventory Planning adds reorder suggestions and ageing. Open PO/PO supply remains absent |
| PO → partial GRN → QC → bill / three-way match | Missing (P0) | Implement as linked documents with accepted/rejected quantity and stock gate |
| Quotation → SO → production → dispatch → invoice | Missing (P0) | Implement SO reservation and physical dispatch separate from invoice |
| BOM revision/ECO/effective dates/Where-Used/phantom | Missing (P1) | Versioned immutable approved BOMs; no in-place mutation |
| QC templates and inward/production/outward gates | Missing (P0) | Parameter/tolerance templates; accepted qty alone posts stock |
| Lot/serial genealogy and FIFO | Missing/very thin | General lot ledger, traceability and valuation required |
| Work centers, calendars, OEE and maintenance | Missing (P1) | Add only after routing and production posting are correct |
| MPS/ATP and forecast demand | Missing (P1) | Build on SO + MRP supply/demand foundation |
| Returns/credit/debit notes/refunds | Missing (P0) | Physical receipt gate and original-line quantity caps |
| MySQL migrations and drift CI | Open C1/C2 | No completion claim until real MySQL replay and reviewed migrations pass |
| Browser E2E | Open H1 | No completion claim until Chromium/Playwright execution passes |

## Implementation order

1. Production output/FG receipt, QC gate, planned-vs-actual consumption and variance.
2. PO → GRN → QC → purchase invoice with partial receipts and three-way match.
3. Quotation/SO → reservation/MTO → dispatch → invoice.
4. MRP supply/demand netting using open PO/WO/SO plus purchase/work-order suggestions.
5. BOM versions/ECO, routing/work centers/capacity, then WIP accounting/OEE.

The implementation must continue to reject negative stock, keep customer material outside company valuation, and post all document/ledger effects atomically.
