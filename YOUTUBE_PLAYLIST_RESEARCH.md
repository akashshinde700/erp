# YouTube Playlist Research — Full Content Review

**Checkpoint:** 2026-11-07 · **Branch:** `arena/b5710131-erp` · **Companion doc:** `PROJECT_AUDIT_PROGRESS.md` (Phase 2 / §9)

## Method & honesty notes

- Both user-supplied playlists were fetched in full (all chunks). Individual `watch?v=` pages were fetched for **every visible video** — these return the video description **and the full auto-generated transcript**, so this is transcript-level content review, not just title reading.
- Playlist 1: `https://www.youtube.com/playlist?list=PLtBGG0oruX9gaYN5T_441OV8XfUS9qJOv` — **42 videos, 3 unavailable/hidden → 39 reviewable**. All **39/39 transcripts reviewed**.
- Playlist 2: `https://www.youtube.com/playlist?list=PL5ajPPBUqVBaoyWv-vWozx2EeJUCNbUsy` — **9/9 videos enumerated**; the 20-minute intro has a Hindi transcript (partially retrieved); the **8 LIVE-stream parts return raw YouTube JS (180+ chunks) instead of a usable transcript**, so for those only metadata + the (very detailed) official descriptions were reviewed. **Not claimed as watched.**
- YouTube serves an `Error 401 (Bad Request)` header but still returns the page content; this is a transport artefact, not a failed fetch.
- No video was downloaded, no account was used, no data was written anywhere. This is read-only research.
- **Concept extraction only** — per the user's standing rule, nothing here is a blueprint to copy. ForgeERP's own append-only ledgers and transactional posting choke-points are *stronger* than the edit/delete/clone behaviour shown in these demos and must be preserved.

---

## Playlist 1 — "Demo Video for ERP Software | Absolute ERP Software"

- **Channel:** Absolute ERP (`@AbsoluteERP`), Noida, India · **Website:** https://www.erpabsolute.com/ · **Contact:** info@erpabsolute.com, +91-9818825303
- **Playlist:** 42 videos, 5,858 views, last updated **Feb 1, 2026**, "In this Playlist Know about Absolute ERP Software", 3 unavailable videos hidden.
- **Product positioning (official site):** cloud manufacturing ERP, multi-level BOM, MRP, production planning/scheduling, job-work management, machine/workstation management, approvals, QC, CRM, finance [1](https://www.erpabsolute.com/manufacturing-erp/) [2](https://softwarefinder.com/manufacturing-software/absolute-erp). Independent listings confirm MRP/CRP, BOM+routing revisions, lot/serial traceability, barcode receiving, vendor scorecards, landed cost, ATP/capacity-aware commitments, WIP reconciliation and variance posting [3](https://absolute-erp.software.informer.com/) [4](https://www.saascounter.com/products/absolute-erp).

### Complete 39-video inventory (index · video ID · duration · views · content actually read)

| # | ID | Title | Dur | Views | Transcript-derived content |
|---|---|---|---|---|---|
| 1 | `-yog_Gext-c` | How to create a Bill of material for your Finished Good? | 3:46 | 5.0K | BOM defines material/components **per process** + quantities. Created only **after routing**. Auto BOM name, **lock/unlock**, **copy** from another product. Select process (cutting/stitching/finishing), category/subcategory, item, map **parameters/variants** (fabric silk, blue colour), notes, qty (e.g. 2 fabric on cutting), n processes, copy-to-repeat. |
| 2 | `6SPJWP5sL68` | How to create the routing process of your finished good | 5:05 | 1.3K | Routing = ordered processes per FG. Each maps **workgroup/machinery**; **setup time** (machine start → fixed cost from hourly rate) and **cycle time** (per unit → variable cost) auto-calculated. **Outsourced/job-work process → vendor name replaces machinery**. **Testing process → checklist with defined parameters** (tearing test, colour test). Reorder via arrows, edit/delete, lock/unlock, extra fixed/variable cost tabs. |
| 3 | `X886nMhlYnc` | How To Create Raw Materials In ERP | 4:37 | 1.1K | Raw-material master: inventory type (RM/FG/semi-finished/supplies), product vs service, purchase/sell flags, category/subcategory, code, **unique barcode**, description, image, **sale unit vs purchase unit + conversion**, **tolerance level** (upper acceptable qty on purchase), **reorder limit → auto notification**, HSN/SAC, purchase rate/MRP, tax-inclusive flag, GST/VAT, **storage location (warehouse/room/rack/shelf)**, **damage recording** (location/date/qty/remarks), Excel bulk import/export, barcode print, edit/delete/view. |
| 4 | `n5fwN9o0MGk` | Way To Create Item Parameters | 1:51 | 772 | Parameters = characteristics (colour, size, grade, length, width) for FG/RM/semi-finished. Code + value pairs; checkbox **"parameter changes raw-material quantity"**. |
| 5 | `tmq5SsJ76DE` | Way To Create Production Processes | 2:25 | 1.5K | Process master: name (cutting/stitching/cooling/pasting…), **auto sequence number**, colour code, mapped **workgroup** based on defined machinery/workstations. |
| 6 | `7sYnH8Pt_tQ` | How To Create Workgroup And Why? | 6:35 | 620 | Workgroup/machine master: auto number, name, **number of instances**, **hourly rate** (feeds routing fixed+variable cost), mapped employees + count, **day-wise custom working hours**, colour code. Workstations: tools with validity date, tool categories (hand/cleaning/sharp…), manufacturing date, tool parameters+values, employee mapping. **Maintenance plan**: daily/weekly/monthly/after-15-days/custom frequency, last maintenance date, **bell notification reminders** to chosen employees, **checklist parameters (range-based or yes/no)** e.g. calibration. |
| 7 | `CkhCCu80jng` | How To Define Multiple Level Of Inventory | 2:06 | 985 | Setup → Items → **Inventory Levels** (up to six levels). Example adds **"Work in Progress"** as a level; new item creation then shows category / subcategory / WIP dropdowns. |
| 8 | `MIcENCIdZ0k` | Classification Of Inventory Types | 5:00 | 4.3K | Inventory types: raw material, finished goods, semi-finished goods, consumables, tools, machineries, supplies. Each type auto-generates its own subhead + item list. Same item-master fields as #3, plus **bulk Excel import/export**, filters by type/name/code. |
| 9 | `J-Tc9uhuW4c` | How To Create Retail Invoice | 3:32 | 568 | POS/retail invoice: auto series number, customer mobile/name/email, **custom field** (Tally invoice number), item-level **or** invoice-level discount (fixed or %), **barcode scan** to pick item, qty, editable tax, multiple payment modes, free/other charges, **save / save+print / hold / hold+search / reset**. |
| 10 | `TwDrfLOJtbI` | How To Create Credit Notes | 3:18 | 547 | Credit note against an existing invoice (defective goods): auto-fetch, transport details (mode/vehicle/ID), amount + tax, attachments, T&C. **Adjust against any unpaid invoice**, **refund option**, delete. Reports: credit-note details, payment status, balance, Excel/print. |
| 11 | `_oBkMSVuk04` | How To Define Schedule of the Payment Against Sales Order | 2:56 | 261 | Payment schedule against SO: multiple dated instalments with title + remarks, **view payment schedule + notifications**, pending-amount tracking, delay-delivery report (salesperson, SO, shipment date, customer, invoice, **delay reason**). |
| 12 | `luUDDsJ9DaQ` | How to Receive Money Against for Specific Customer | 4:57 | 256 | Receipt: location, customer, **overdue amount**, received amount, **TDS deduction + section**, deposit date, mode (bank transfer / cash in hand), deposit-to bank account, ref/cheque no, **auto-allocation to oldest unpaid invoices (FIFO)** with editable amounts, notes, attachment. Reports: **amount received**, **credit note**, **refund history**. |
| 13 | `sEN132XMzHI` | How to Create Invoice | 9:33 | 1.1K | Tax invoice: invoice ledger/state, customer, **auto number series**, order no, due date, **date of supply**, salesperson, **custom fields**, supply type, vehicle/transporter details, item-level or invoice-level discount, **multi-location qty bifurcation**, **live stock availability**, **previous rate to this customer**, tax exempt, freight/other charges, **previous balance**, **apply advance to invoice**, auto-PDF to customer email. Backend: extra columns, same-vs-different number series per invoice type, duplicate/triplicate, optional fields (order no, due date, HSN/SAC, GSTIN, attachments, confirmation letter), **multi-level approval workflow**, packing-slip settings, custom fields, receive-amount, **PDC post-dated cheque**. |
| 14 | `QIIE-undPAI` | How To Transfer Meeting By Using Transfer Meeting Utility | 3:51 | 749 | CRM: transfer a meeting executive→executive, **pending transfer acceptance (accept/reject)**, then appears in My Calling Data + Meeting Details, re-assign with notification. |
| 15 | `-WKE2NaHEyk` | How to Create Proforma Invoice | 4:39 | 1.1K | Proforma = advance-request document, converts **1-click into tax invoice**; also reachable by converting quotation/SO. Discount levels, gross/net weight, MRP, previous invoice rate, tax exempt, freight/other charges, PDF email, **packing slip print**, cancel/delete. |
| 16 | `3KyIe-Y4gks` | How to Created Sales Order Without Price | 2:18 | 293 | **Price-hidden SO view** for departments that must not see prices (role-based field masking). Dashboard shows cash/bank flow, invoice awaiting payment, overdue — week/month filters, print. |
| 17 | `2u1pSdK9-7o` | How To Create Sales Order With Price | 17:39 | 892 | SO: date, customer, auto series, reference, **shipment date**, salesperson, custom fields, discount levels, gross/net weight, **stock availability**, tax exempt, multi-item, extra charges, PDF email + **department notifications**. Backend toggles: **delivery challan / GRN activation** (enables **multiple partial challans & partial receipts**), proforma, **save-and-lock**, **payment schedule**, **approval system**, custom fields. Reports: **SO tracking through to production**, pending sales, **reason-wise pending**, delay delivery. **Multiple delivery challans → single invoice**, receive amount, payment schedule notification, direct SO→invoice conversion. |
| 18 | `f2HhSMrnlpA` | How To Create Quotation | 8:55 | 1.3K | Quotation: date, customer, auto series, reference, **expiry date**, salesperson, custom fields, discount levels, gross/net weight, **stock availability**, previous rate/invoice, tax exempt, extra charges, attachments, T&C, PDF email, **draft / cancel**, **follow-up with 15-min-before bell notification + history**, backend **approval system**, revision toggle, **custom fields**, extra-charge tabs. Reports: quotation details (conversion status), **quotation vs SO with balance qty/amount**. 1-click convert → SO / Proforma / Invoice; clone / cancel / delete. |
| 19 | `lT15GQc_YBc` | How To Revise Quotation | 1:43 | 344 | Revision adds **R1/R2 suffix** to quotation number, **old version retained for comparison**, repeatable. |
| 20 | `tHBrMG_Mahs` | How To Create Items Estimation | 9:15 | 1.2K | Estimation: location, date, customer (add-new inline), billing/shipping address, **currency + conversion rate**, auto number (prefix/suffix), expiry, salesperson, items from masters, **multiple supplier prices**, qty, MRP, **stock availability**, previous rate, tax exempt, extra charges, attachments, T&C, PDF email with attachments. Backend: party master (addresses, **credit limit**, bank, custom fields, **party-specific item prices**), currency setup, number-series setup, item/FG master. Convert **1-click → Quotation**. |
| 21 | `fkvmQfgpIYk` | View Meetings Details | 1:35 | 561 | CRM meeting list with filters, **previous communication history**, post-meeting follow-up moving level to follow-up / not-interested / SO / quotation / invoice. |
| 22 | `KauiDoy73Jc` | Lead Management System - Follow-ups Software | 2:22 | 728 | CRM follow-ups: search by name/phone, comment, **hot/warm/cold priority**, call level, category/service/item, meeting date+time, assign to team member with CRM-board notification. |
| 23 | `gYRvqkuW7-Y` | How to Find not Interested Leads | 2:35 | 429 | CRM **central database of company-wide "not interested" leads** with last reason + full history; re-open via Add Call, change level, set next follow-up. |
| 24 | `zEoGDiRxgTQ` | My Calling Data | 2:35 | 613 | CRM all-leads view, Excel export, follow-up update, **15-min-before pop-up + bell notification**, communication history. |
| 25 | `koWM6Mji5Ds` | How To Transfer Leads By Using Transfer Call | 3:00 | 1.2K | CRM lead transfer with **pending acceptance**, already-transferred leads locked until accepted/rejected, then visible in My Calling Data. |
| 26 | `zLT6JNUUb10` | How To Assign Leads To Executives | 4:43 | 851 | CRM unassigned calls (bulk-uploaded + **API-captured from website / Google Ads / Instagram / Facebook / LinkedIn**), assign one/many to executive, Today New Call board, filters, Excel export, follow-up + notification. |
| 27 | `GTHQjQ0cyzg` | How to Add a New Call In Lead Management System | 11:36 | 14.6K | CRM manual lead: company, contact, email, phone, requirement, **expected lead amount + expected sale date → sales forecast**, source, hot/warm/cold, custom fields, address, **call level** (follow-up/demo/meeting/not-interested/**convert to quotation, SO, invoice**), 15-min reminder. Backend: field validators, **duplicate control on company/email/mobile** (incl. bulk upload), dynamic call status, **API lead-source integration**, lead statuses, priorities, lost reasons, custom fields. Reports: **source-wise, priority-wise, level-wise, call-status-wise, employee-wise, source-wise sales conversion, daily sales, daily invoice, sales forecast, lost-opportunity**, Excel export. |
| 28 | `sVeRzRAKNYA` | How to Upload Bulk Lead In CRM | 3:02 | 1.5K | Excel template (company, contact, email, phone, expected amount/date, salesperson, source, priority, country/state/city/address, requirement), import, **mobile-number duplicate validation toggle**, result in Unassign Calls. |
| 29 | `hDMzX3i1Nu0` | Create Finish Good + Routing + BOM [STEP-BY-STEP] | 6:42 | 3.4K | End-to-end: create FG (inventory type, product/service, purchase/sell, code, name, image, UOM, **reorder limit**, purchase/MRP, GST, **opening stock 200 of 1,000 planned**), add **variants** (size/colour/fabric), routing (cleaning → … → **is-outsourced** finishing → **quality check** → packing, each with workgroup + setup/cycle time → auto fixed/variable cost), then BOM **per process** (1.25 m silk on cleaning, thread on stitching, buttons + brand/size tags on finishing, packing pouch on packing) with colour/fabric relations. |
| 30 | `wSm_RyQ1_2Q` | DFD of Production | 3:57 | 1.4K | **Manufacturing Order** two ways: **Make-to-Order** (against Sales Order; BOM/routing/parameters auto-fetched from masters) and **Make-to-Stock** (future sales). Then two branches: **production schedule** (machine/operator/order) + **automatic material requisition slip → store-manager notification**. **MRP runs** → exact RM requirement. (a) material available → issue to production → production start → **production entry incl. quality check + job work** → **"Finish Production" updates FG stock** → **delivery challan** → sales invoice; (b) material not available → **purchase cycle**; (c) material available but want to reserve → **reservation** first. Production settings: machine setup, processes, parameters, RM + semi-finished items. |
| 31 | `Iw_HPptDKHs` | DFD of Jobwork Routine | 2:14 | 621 | Material OUT → **Returnable Challan**, two modes: (i) **same material returns** (shirt sent for washing/ironing, same shirt returns), (ii) **different material returns** (button/thread/cotton sent, stitched shirt received). Material IN → **Material Receipt Note against returnable gate pass** → **quality inspection with customer-defined parameters** → QC-passed material **updates stock**. |
| 32 | `YuWsd0Ul0iM` | How to Create Bill Against Of GRN | 3:25 | 262 | Select GRN → auto-fetch all details into supplier bill; add supplier **bill number, bill date, due date**, attach received supplier bill + up to 5 files (PO etc.), notes. Bill links back to GRN. |
| 33 | `VvbCBWspYpY` | How To Create Purchase Bill | 5:32 | 463 | Direct bill: location, bill ledger, supplier, bill/order no, bill+due date, **discount type** (none / item-level / order-level), gross/net weight, item parameters/description, **multi-location qty split**, **previous bill rate suggestion**, editable tax, attachments, notes. **Record payment**, **post-dated cheque with 3-day-prior reminder**, **expected payment date**, cancel, **purchase return**, **debit note**, clone, delete. |
| 34 | `gES_2pMi6ko` | How To Create (GRN) Against an Issued Purchase Order | 2:53 | 884 | GRN from PO: auto-fetch supplier/address/GRN no/date/order no; shows **PO qty, received qty, pending qty**, rate, amount, tax; **multi-location split receiving**; after save → **inventory quality check → accepted stock increases + store-manager notification**; edit/PDF/print/letterhead. |
| 35 | `JqeLNKoST40` | How To Create New Purchase Order with Indent Items | 8:02 | 1.7K | PO: location, supplier, billing address, auto PO no, reference, PO date + **delivery date**, **PO type controlling discounts** (none/item-level/order-level), gross/net weight, item+parameters, qty, rate, auto amount, tax exempt/rate, attachments, **deliver-to (organisation or customer)**, T&C, notes. **Indent items** two ways: by indent number (auto-fetch all params/qty/rate/amount/tax), or by item filter with **"select all" to aggregate multiple indent quantities into one PO**. Convert **PO → Bill**; PDF/print/letterhead/email/attach/clone/cancel/delete, expected delivery date. |
| 36 | `JsvfX2wXH4U` | DFD of Sales and Marketing | 1:01 | 724 | Minimal DFD: **Sales Order → Invoice → Dispatch**. |
| 37 | `FWJ3qJQhSDw` | DFD of Quality Inspection | 3:07 | 786 | Two types. **Inward**: create **inspection template with parameters/specification + tolerance levels** → material inward via Material Receipt Note → **quality inspection report** → **stock updated**. **Outward**: outward inspection template → dispatch + invoice → QC report **sent to customer with invoice**. |
| 38 | `rfPHr9xnf5E` | DFD of Stores Department | 2:34 | 1.0K | Stock available → issue to any department; not available → purchase indent → PO. **Inward**: gate entry → Material Receipt Note / GRN against PO → **QC with dynamic parameters + checklist**; other inward sources = **from production**, **from in-house job work**. **Outward**: **returnable challan** (jobwork/repair), **non-returnable challan** (samples), **dispatch challan against Sales Order**. |
| 39 | `NDqGuGOhwW8` | DFD of Purchase and Procurement | 2:17 | 2.2K | **Material requisition from Production→Store based on BOM automatically**; stock available → issue; not available → store creates **purchase indent/requisition** → purchase dept with **optional multi-level approval by HOD** → PO. Three PO types: **Open** (rate fixed, qty per day/week/month schedule), **Fixed** (rate + qty fixed), **General**. |

**3 hidden/unavailable videos:** IDs not exposed by YouTube; content unknown. Not claimed as reviewed.

### Consolidated business concepts (what the playlist actually teaches)

1. **Master-data depth first:** inventory classification + up to six inventory levels (incl. **WIP**), item parameters/variants, purchase-vs-sale UOM conversion, tolerance, reorder alerts, barcode, storage hierarchy (warehouse/room/rack/shelf), damage records, bulk Excel import/export.
2. **Routing before BOM:** ordered operations → workgroup/machine **or outsourced vendor** → setup time + cycle time → auto fixed/variable cost; **testing/checklist parameters embedded in routing**; maintenance plans with checklists and reminders.
3. **BOM is per-process and parameter-aware**, with lock/copy/revision discipline and quantity-per-finished-unit.
4. **Production is demand-driven:** MTO from Sales Order or MTS, MRP → material requisition → reservation/shortage/purchase branches → schedule → production entry (QC + jobwork) → **Finish Production posts FG stock** → delivery challan → invoice.
5. **Purchase chain is document-linked:** BOM-driven indent → approval → PO (3 types) → **partial GRN with pending qty** → QC → stock → bill-against-GRN → payment/PDC/return/debit note.
6. **Sales chain is document-linked:** estimation → quotation (with revision R1/R2, follow-ups, approval) → SO (with/without price, lock, payment schedule) → **multiple partial delivery challans → one invoice** → receipt with **FIFO allocation**, TDS, advances, credit notes/refunds → outstanding.
7. **QC is a gate, not a report:** inward/outward templates with tolerance levels; stock updates **only after** accepted inspection; outward QC report ships with the invoice.
8. **Jobwork is bidirectional material flow:** returnable challan out (same-material vs transformed-material), MRN in, QC, then stock.
9. **Cross-cutting:** configurable number series (prefix + start number per doc type), multi-level approvals, lock/unlock, revision history, clone/cancel, PDF/letterhead/WhatsApp/email, attachments, custom fields, bell notifications (15-min follow-up, 3-day PDC), Excel import/export, multi-location, multi-currency, credit limits, barcode, role-based field masking, audit-style history, and a large report catalogue (SO tracking, pending/reason-wise/delay, sales forecast, lost opportunity, source/priority/level-wise conversion, GSTR/P&L/day book).

---

## Playlist 2 — "Vyapar Desktop Demo LIVE"

- **Channel:** Vyapar App - Billing & Invoicing Software (`@VyaparApp`) · **Playlist:** 9 videos, **94,601 views**, last updated **Dec 17, 2021**, description: "Facing issues with Vyapar app? Don't worry, our experts are here to help you!"
- **Total runtime ≈ 9 h 37 m** (one 20-min Hindi walkthrough + eight 47–74 min weekly live Q&A demos streamed May–Aug 2020).

| # | ID | Title | Duration | Views |
|---|---|---|---|---|
| 1 | `uaYDSZxlRkM` | Vyapar app Kaise use kare? … Vyapar Desktop Demo | 20:48 | 506K |
| 2 | `kKe6-Oq3Cro` | Vyapar Desktop Demo LIVE (Part-1) | 1:01:48 | 176K |
| 3 | `t5AgNUJGwRc` | Vyapar Desktop Demo LIVE (Part-2) | 1:05:57 | 34K |
| 4 | `B9seQ_MhJ9M` | Vyapar Desktop Demo LIVE (Part-3) | 1:06:31 | 16K |
| 5 | `EPMtUnTXLPc` | Vyapar Desktop Demo LIVE (Part-4) | 47:06 | 12K |
| 6 | `RUnW6iZBC1Y` | Vyapar Desktop Demo LIVE (Part-5) | 1:04:11 | 8.8K |
| 7 | `RerSwgmDLuE` | Vyapar Desktop Demo LIVE (Part-6) | 55:27 | 9.8K |
| 8 | `ZlV7Lq0Qv7Y` | Vyapar Desktop Demo LIVE (Part-7) | 1:01:16 | 6.6K |
| 9 | `Uh0p0klRBwY` | Vyapar Desktop Demo LIVE (Part-8) | 1:14:05 | 8.4K |

**Intro video chapters (Hindi):** download desktop → create company → business details → add products/items → add customers & vendors → **bulk import items/parties via Excel** → create sale/purchase/other transactions → create "Online Store" and share catalogue → **auto-generated accounting reports**. Its transcript also mentions transaction/item settings (serial number, manufacturing/expiry date, item-wise options, images) and mobile-number login creating the company.

**All eight LIVE descriptions consistently advertise the same feature set:** GST-ready invoicing, proforma/estimate/quotation, **sale & purchase order formats**, **delivery challan**, **debit/credit notes**, **expense tracking**, **day book**, **cash in hand**, GST composition scheme, **GSTR-1 / GSTR-2 / GSTR-3B / GSTR-4 / GSTR-9 reports + Excel export**, **low-stock / dead-stock / stock-tracking reports**, P&L and daily sales reports, **party/udhar credit PDF reports**, barcode scanning, thermal/letterhead printing, WhatsApp/PDF sharing, offline desktop, multi-device, automatic backup, "Tally ERP 9 replacement" [1](https://vyaparapp.in/gst-accounting-pc) [2](https://www.softwareadvice.com/accounting/vyapar-profile/) [3](https://www.softwaresuggest.com/vyapar-accounting-invoic).

**Interpretation for this project:** Vyapar is a **small-business billing/accounting app**, not a manufacturing ERP — it has **no BOM, routing, work order, MRP, WIP, QC or jobwork production logic**. Its value as a reference is limited to **UX simplicity, GST/reporting ergonomics, low-stock/dead-stock alerts, offline-first backups, Excel import, and document sharing**. It must not be used to justify manufacturing architecture. Independent reviews also note it is intentionally weak for medium/large complex accounting [2](https://www.softwareadvice.com/accounting/vyapar-profile/).

---

## Mapping to ForgeERP (concept-level gap analysis, not a copy plan)

Legend: ✅ present · ◐ partial/thin · ❌ absent. Based on the audited code described in `PROJECT_AUDIT_PROGRESS.md` §3 and §9.

| Concept from the videos | ForgeERP | Gap / note |
|---|---|---|
| Append-only stock + GL ledgers, mirrored reversal on cancel, transactional posting choke-point | ✅ | **Stronger than the demos.** The videos allow edit/delete/clone on posted bills. **Preserve ForgeERP's behaviour** (user's "existing logic preserve" rule). |
| GST engine (incl./excl., IGST vs CGST+SGST, round-off, GSTIN checksum), FY number series | ✅ | Verified by 59/59 executed checks. |
| Jobwork inward → job card → process → certificate → invoice, 5% over-processing guard | ✅ | Strongest module. |
| Project → BOM → Work Order → Production Task with `MFG_ISSUE` stock, labour hours/cost, `rejectionQty` | ◐ | Present but **flat** (single-level BOM, no SO link, no routing/workgroup, no WIP, no FG receipt, no variance costing). |
| `Employee` with skill / machineNo / shift / hourlyRate | ✅ | Already in schema; unused by routing/maintenance. |
| `Process` with seq / basis / rate / lotCharge | ◐ | No workgroup, machine hourly rate, setup/cycle time, QC checklist or maintenance plan. |
| `Item.reorderLevel` + dashboard low-stock KPI | ◐ | Field + KPI exist; **no alert/notification, no purchase suggestion, no dead-stock/ageing report**. |
| `Warehouse` with code/name/location/active | ◐ | No room/rack/shelf hierarchy; no multi-location split on GRN/invoice. |
| `batchNo` | ◐ | Only on `JobworkInwardItem`; no general batch/serial/lot traceability or FIFO valuation. |
| Payment + allocation + GL posting | ✅ | Manual allocation only; **no FIFO auto-allocation, TDS, PDC, payment schedule, refund, advance application**. |
| Purchase **PO → approval → partial GRN with pending qty → QC → Bill** | ❌ | Only `PurchaseInvoice`. **Highest-value missing chain.** |
| Purchase indent / requisition driven by BOM, 3 PO types, vendor return / debit note | ❌ | Absent (vendor returns & debit notes also absent). |
| Estimation / Quotation (+R1 revision) / Sales Order / Proforma / **delivery challan** / partial dispatch | ❌ | Only `SalesInvoice`. Quotations/SO/challans are in the sibling `erpnashilk` project, not here. |
| Credit note / refund / sales return; advance received | ❌ | Credit notes absent; `PaymentAllocation` has no refund path. |
| **QC inspection templates (inward + outward), tolerance levels, QC gate before stock update** | ❌ | Completely absent. This is a **business-correctness** gap, not just a feature. |
| **Make-to-Order from Sales Order, MRP, material reservation, shortage→purchase branch** | ❌ | No MRP, no reservation, no SO-to-production link. |
| **"Finish Production" → finished-goods stock receipt, WIP warehouse, scrap/rework, production cost & variance** | ❌ | `MFG_ISSUE` consumes material but no FG receipt or costing roll-up. |
| Multi-level BOM / sub-assemblies / BOM revision history / lock / copy / parameter-aware BOM | ❌ | Single-level `BomItem` with wastage%; `DRAFT→APPROVED` status but no versions. |
| Item parameters/variants, purchase-vs-sale UOM conversion, tolerance, barcode, damage record, Excel import | ❌ | Flat `Item` master. |
| Returnable / non-returnable / dispatch challan; material OUT for jobwork; MRN + QC before stock | ❌ | Jobwork starts at inward and posts stock immediately. |
| Multi-level approvals, lock/unlock, revision suffix, document clone | ❌ | Only `Counter`-based numbering + status transitions. |
| Notifications / reminders (bell, 15-min follow-up, 3-day PDC), department notifications | ❌ | `AuditLog` only. |
| Custom fields, document templates, PDF/WhatsApp/email/letterhead, attachments | ◐ | Invoice print + Tally/IRP/JSON exports exist; no templates/attachments/WhatsApp. |
| CRM lead management (bulk + API capture, duplicate validation, levels, forecasting, conversion reports) | ◐ | `PlatformInquiry` + follow-ups exist for the **platform console**, not an operational sales CRM. |
| Multi-currency, credit limits, party-specific prices, supplier price history | ❌ | Absent. |
| Bulk Excel import with duplicate/XXE protection | ❌ | Absent here (present in sibling `erpnashilk`). |

### Recommended priority (concepts to adapt, not code to copy)

- **P0 — business correctness / data integrity:** QC gate (inward + outward) before stock update; PO→GRN→Bill chain with pending qty and partial receipts; sales order/quotation/delivery-challan chain; FG receipt + WIP + production costing/variance; credit/debit notes + returns/refunds; MRP + reservation + SO→production link.
- **P1 — depth on what already exists:** routing workgroups with setup/cycle time and machine hourly rate; multi-level BOM + revision/lock; item variants/parameters + UOM conversion; multi-location stock; approvals & lock; notifications/reminders; TDS/PDC/payment schedules; batch/lot traceability; low-stock → purchase suggestion.
- **P2 — usability / reach:** CRM lead module, custom fields, document templates & sharing, barcode, validated bulk import, multi-currency, credit limits, OEE/efficiency/vendor-performance/inventory-ageing MIS.

**Explicitly do NOT adopt:** editable/deletable posted documents, hard-delete of vouchers, or per-document discount-type switches that bypass a single tax engine. ForgeERP's `computeInvoiceTotals` + `postGl` + `cancelGlForVoucher` design is already the correct choke-point; extend it, don't bypass it.

---

## What remains unverified in this research

- 3 hidden/unavailable Absolute ERP videos (IDs not exposed).
- The 8 Vyapar LIVE-part **transcripts** (YouTube returns JS bootstrap, 180+ chunks); only metadata + official descriptions reviewed. The 20-min intro Hindi transcript was partially retrieved.
- No video was visually watched; conclusions come from official descriptions + auto-generated transcripts, which can contain recognition errors (e.g. "bomb" for "BOM", "challen" for "challan"). Business concepts were cross-checked against the vendor's own site and independent listings [1](https://www.erpabsolute.com/demo-video/) [3](https://absolute-erp.software.informer.com/).
- Full code-level comparison with the three GitHub repositories is still pending (see `PROJECT_AUDIT_PROGRESS.md` §12).
