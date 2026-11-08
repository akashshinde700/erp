# ForgeERP vs MapSoft ERP: gap closure, 2026-11-09

Source: `MAPSOFT_ERP_AUDIT.md` (a black-box audit of the MapSoft demo, 18
modules, 27 findings). This report:

- compares each MapSoft module with ForgeERP;
- lists what this branch (`feature/mapsoft-parity`) adds;
- lists what is still left out, and why.

HRMS (attendance, leave, timesheets, onboarding) was left out because the
owner asked for it to be dropped.

## 1. Module comparison

| MapSoft module | ForgeERP before | This branch |
|---|---|---|
| CRM: leads, deals, tasks, contacts | none | **Leads** with stages, a follow-up trail, a duplicate-contact guard, conversion to a customer, pipeline and win rate |
| Salespersons | none | **Salesperson master** with a monthly target. Credit flows from quotation to sales order to challan invoice, plus direct invoices. Performance report |
| Quotes | API only, no screen | **New quotation** dialog (customer, salesperson, validity, lines, GST preview) |
| Proposals | none | Not added. A quotation covers it |
| Purchase, RFQ, receipts, returns | already present | unchanged |
| Inventory adjustments | opening stock only | **Stock adjustments** with a reason code, approval by a second user, valued in the GL, and reversal on cancel |
| Store consumption, issue materials | work-order material issue | unchanged |
| Sales, invoices, returns, e-Way Bill | already present | salesperson on the invoice |
| Back orders | none | **Back-order report**: pending quantity per order line, late flag, stock on hand |
| Services: service calls, service invoices | none | **Service calls** with response targets by priority, warranty rules, an engineer, the resolution, and a single service invoice |
| BOM, manufacturing | already deeper than MapSoft (multi-level, WIP, QC, lots) | unchanged |
| Chart of accounts | fixed system accounts | **Organisation ledgers** (expense, income, asset, liability, equity) next to the system accounts |
| Vouchers (MapSoft: single-sided, finding F20) | none | **Journal voucher**: debits must equal credits, stock and WIP ledgers cannot be used, a party is required on debtor and creditor lines, cancel by mirrored reversal |
| Financial years (MapSoft: two years open, finding F10) | FY numbering only | **Books lock / FY close**: nothing can be posted or cancelled on or before the lock date. One lock date means one open period. Only the OWNER can re-open, and must give a reason |
| TDS master, TDS on bills and payments | none | **TDS sections** (6 common ones can be added) and **TDS on payments and receipts**: TDS payable or receivable in the GL, the bill settled at its gross amount, a TDS report, and a TDS line in the Tally export |
| AR / AP aging (MapSoft: aging contradiction, finding F12) | outstanding report only | **Aging by due date** (invoice date plus the party's credit days) in 5 buckets. Uses one measure, the overdue share |
| Payment terms | none | **Party credit days** |
| Report Center (31 reports) | 17 reports | +6: aging, back orders, sales analysis (by customer, product and salesperson), purchase by supplier, P&L by ledger, **project profitability** (MapSoft's project report is a dead route, finding F1). All 6 export to CSV |
| HRMS | none | Left out, as the owner asked |
| POS | none | Left out: no point-of-sale use in a fabrication or jobwork shop |
| Email notifications, reminders | none | Left out: needs an SMTP provider and credentials (see section 4) |
| Transaction series screen | organisation-prefixed FY counters | unchanged. ForgeERP has no shared prefixes (MapSoft finding F14) |
| Module settings, approval matrix | role-based (OWNER, ACCOUNTANT, VIEWER) | unchanged |

## 2. MapSoft findings that ForgeERP does not repeat

ForgeERP already avoided these issues before this branch. The tests named are
the proof.

| MapSoft finding | ForgeERP |
|---|---|
| **F2** negative stock | Every stock-reducing document checks availability. Each suite ends with a reconciliation that confirms no stock is negative. |
| **F5** over-receipt | A goods receipt is capped at the open PO quantity (workflow suite). |
| **F6** adjustments without approval | Now covered by an approval from a different user (parity suite B3). |
| **F10** two financial years open | There is one lock date (parity suite B4). |
| **F11** three-way match can be bypassed | The bill is created from the goods receipt, and billed quantity can never exceed accepted quantity (workflow suite). |
| **F13** a quote can be dispatched | Only an approved sales order can be dispatched. |
| **F15** guessable sequential ids | ids are cuid. Cross-organisation access is refused (tenant suite, 87 checks). |
| **F17** no QC at goods receipt | Goods receipts have a QC gate (workflow suite, P9). |
| **F20** single-sided vouchers | Every GL voucher is checked for Dr = Cr before it is written. |

## 3. Proof

Test environment:

- a fresh MySQL 8.0 database with all 7 migrations applied;
- no drift from the database to the schema, or from the migrations to the schema;
- production build (`next build`, standalone server).

| Suite | Result |
|---|---|
| `tests/parity-audit.mjs` (new) | **202/202** |
| `tests/workflow-audit.mjs` | 462/462 |
| `tests/tenant-isolation.mjs` (19 checks added for the new modules) | 87/87 |
| `tests/erp-audit.mjs` (legacy API) | 72/72 |
| `tests/backup-drill.mjs` | 18/18 |
| `tests/e2e-browser.mjs` (390 / 768 / 1440 px), on workflow data | 165/165 |
| `tests/e2e-browser.mjs` (390 / 768 / 1440 px), on parity data | 162/162 |
| `tsc --noEmit`, `eslint .`, `next build` | clean |

The parity suite checks the following.

**Journals:**

- unbalanced entries, stock and WIP lines, and debtor lines without a party are refused;
- the voucher number is organisation-prefixed;
- cancel is append-only;
- a VIEWER is refused.

**TDS:**

- a deduction above the section rate, or without a section, is refused;
- the GL shows Dr Creditors gross, Cr Bank net and Cr TDS Payable;
- no false supplier advance is created;
- cancelling a receipt restores the invoice;
- the Tally voucher balances.

**Adjustments:**

- self-approval is refused, except for the OWNER;
- two approvals at once: exactly one posts;
- decreases are valued at weighted-average cost;
- the GL stock value equals the stock-ledger value;
- cancel restores stock.

**CRM:**

- stage rules, and LOST needs a reason;
- conversion creates the customer;
- the salesperson is carried from quotation to order to challan invoice;
- only the OWNER can re-open a lost lead.

**Service calls:**

- the response target follows the priority;
- a call cannot be resolved before an engineer is assigned;
- a warranty call cannot carry a charge;
- two invoice attempts at once give exactly one invoice;
- invoicing moves no stock;
- a call cannot be closed before its charge is invoiced.

**Lock:**

- posting, journals, adjustments and cancellation in a closed period are all refused;
- an ACCOUNTANT cannot re-open; re-opening needs a reason and is audited;
- FY close.

**Backup:**

- all 10 new tables round-trip;
- the salesperson and TDS links on invoices and payments survive the restore.

## 4. Deliberately not done

- **HRMS:** the owner asked for it to be dropped.
- **POS, proposals, CRM contacts as a separate entity:** a quotation and the party master cover these for this business.
- **Email notifications and reminders:** they need an SMTP or SES account. MapSoft stores those secrets in plain text (finding F4). Doing this properly needs a provider choice and secret storage; that is the owner's decision.
- **The books lock covers GL documents.** Every invoice, payment, return, receipt, journal and stock adjustment posts to the GL, so all of them are covered. Jobwork documents that move only customer-owned material (no GL row) are not locked.

## 5. Deployment

Migration `20261109090000_mapsoft_parity` is additive:

- new tables;
- nullable or defaulted columns;
- no data rewrite.

It can be deployed after the tenant-isolation migration. The staging rehearsal
in `docs/MIGRATION_RUNBOOK.md` §8 still applies to the tenant migration that
comes before it.
