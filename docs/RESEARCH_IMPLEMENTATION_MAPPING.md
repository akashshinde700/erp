# Research-to-Implementation Mapping

**Updated:** 2026-11-08 — this mapping was reconciled with the later closure report and current source during the full-code audit. Older P0/P1 labels below were stale and are replaced by the status table. See `docs/CURRENT_REMAINING_WORK_2026-11-08.md` for remaining work and audit evidence.
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
| Output | Process certificate + jobwork GST invoice | QC-accepted finished-goods receipt with lot/serial/genealogy and WIP settlement |
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
| Project → BOM → WO → operations | Partial | Existing sequenced tasks; needs routing master, parallel ops, capacity calendar and machine/task time capture |
| Finish production → independent FG receipt | Implemented | QC-accepted output receipt, lot/serial genealogy, cost/WIP settlement and reversal; verified by workflow audit |
| Planned vs actual production cost/variance + WIP settlement | Implemented core | Material/labour actual, variance, rejection and WIP settlement exist; richer overhead allocation/cost roll-up remains |
| MRP demand/supply netting and purchase suggestions | Partial; PO supply now shown | Active-WO demand nets own stock; open approved PO supply appears separately in projected shortage. SO/MTO demand explosion, BOM output-item mapping and planned-order creation remain |
| PO → partial GRN → QC → bill / three-way match | Implemented core | Requisition/PO/partial GRN/QC accepted-stock gate/invoice and RFQ quote award; richer tolerance/price variance and AP matching policies can expand |
| Quotation → SO → production → dispatch → invoice | Implemented core | Order/dispatch/QC/invoice exist; automatic production planning/reservation from SO demand remains |
| BOM revision/ECO/effective dates/Where-Used/phantom | Missing | Add immutable versions/effective dates and impact/where-used before editing live approved BOMs |
| QC templates and inward/production/outward gates | Implemented core | Versioned templates and inward/dispatch/production acceptance gates; keep extending test coverage per operation/product |
| Lot/serial genealogy and FIFO | Implemented core | Lot/serial tracking, recall and genealogy; review performance/traceability limits at larger scale |
| Operator/machine/operation efficiency | Partial | Throughput, yield, attainment, hours and output/hour exist; true OEE awaits downtime reasons and capacity calendars |
| Work centers, calendars, OEE and maintenance | Missing | Add routing/work-center model, shift calendars, planned maintenance and auditable downtime reasons |
| MPS/ATP and forecast demand | Missing | Build only after item-linked BOM and full SO/PO/WO supply-demand netting |
| Cross-module action center / role dashboard | Improved | Live task, stock reorder, jobwork certification/billing and financial exposure actions derived from source states |
| GST compliance reporting | Improved/partial | GSTR-1, books-based GSTR-3B, outward/inward HSN/SAC summaries, e-Invoice and pre-validated e-Way Bill portal JSON; direct portal filing, RCM/exempt/blocked-ITC and cross-utilisation remain |
| Customer sales history / analysis | Improved | Auditable sales, collections, invoice outstanding, jobwork share, average invoice, last sale and top items/services |
| Supplier/vendor analysis | Improved/partial | Auditable invoice count, spend, paid/outstanding, average invoice, last purchase and top items; on-time/QC scores await PO→GRN→QC |
| Cash & Bank / day book | Implemented | Ledger-backed period opening, receipts, payments, running account balance and closing for CASH/BANK |
| Returns/credit/debit notes/refunds | Implemented core | Physical receipt/QC gates, original-line caps, refund and mirrored cancellation flows; keep expanding edge-case tests |
| MySQL migrations and drift CI | Staging validated; live-data rehearsal open | Disposable MySQL migration/deploy/drift checks pass; still rehearse against a protected staging copy of the actual live database |
| Browser E2E | Implemented/tested | Closure report records 96/96 across 390/768/1440 px including print/PDF; add regression for each new screen |

## Implementation order

1. Rehearse current migrations on a protected staging copy of the live database; confirm legacy-company ownership before any deploy.
2. Complete the planning foundation: BOM output-item mapping + immutable BOM versions, then SO/WO demand explosion and open PO/GRN/stock netting; keep purchase suggestions advisory until approved.
3. Add routing/work centers/calendars/downtime so finite-capacity scheduling and OEE are based on real operation data.
4. Expand overhead cost allocation and statutory GST edge cases (RCM, blocked ITC, cross-utilisation, portal integrations) with accountant-reviewed examples.
5. Add production pilot feedback, then consider structural two-bucket ownership/reservations for customer-owned material.

The implementation must continue to reject negative stock, keep customer material outside company valuation, and post all document/ledger effects atomically.
