# MapSoft ERP — Deep Audit Report (Flow, Logic, Forms, Navigation)

**Target:** https://demo.mapsofterp.in/App/ (Mapsoft Technologies LLP / Demo)
**Credentials used:** Admin (read-only audit — no data created, modified, or deleted)
**Audit type:** Live black-box UI audit via headless browser + API traffic capture (network/console) + calculation verification + reverse-engineering methodology
**Report version:** v2 — **COMPLETE** (all 18 modules / ~75 pages audited: CRM, Project, Purchase, Inventory, Sales, BOM, Manufacturing, Services, General Ledger, AR, AP, Administration, Settings, Taxes, Setup, HRMS, Report Center, Dashboards)
**Evidence:** 135 screenshots in `/tmp/audit/`

---

## 1. Executive Summary

MapSoft ERP is a **multi-tenant, multi-company (multi-"Unit") manufacturing + trading ERP** built as an **Angular SPA** with a separate **REST API backend** (`https://mapsofterp.in/mapsoft-erp-webapi/api/`). It covers CRM → Project → BOM → Manufacturing → Inventory → Sales → GST/e-Invoice compliance → Accounting, plus HRMS and Services.

### Overall verdict

| Area | Grade | Note |
|---|---|---|
| Functional breadth | ★★★★☆ | 18 modules, ~75 pages, 31 reports; wide coverage |
| Workflow completeness | ★★★☆☆ | O2I + P2P chains exist with approvals; 3 dead routes, 1 broken settings API, no terminal order status |
| Manufacturing depth | ★★☆☆☆ | Flat BOM, no routing/scrap/versioning; MO only 2 states; negative stock pervasive |
| Inventory integrity | ★☆☆☆☆ | **24% of stock records negative, 57% zero**; no valuation method; adjustments unapproved |
| Financial controls | ★★☆☆☆ | 2 open FYs; 3-way match bypassable; single-sided vouchers; plaintext secrets |
| Data integrity | ★★☆☆☆ | Duplicate BOMs/series/contacts, junk totals, orphaned "Unknown User" rows |
| API health | ★★★☆☆ | 500s on Proposal/Bank-code; 404 wrong-API on PO files; failing approval-settings API |
| UX consistency | ★★★☆☆ | Consistent list toolbar; inconsistent statuses, formats, placeholders |
| Compliance (GST/TDS/IRN/EWB) | ★★★☆☆ | GST+TDS masters solid; IRN/EWB failing on several invoices |
| Security | ★★☆☆☆ | **SMTP/AWS/IRP secrets in plaintext**; IDOR surface; dev-mode Angular |

### Consolidated findings (severity-ordered)

| # | Severity | Finding |
|---|---|---|
| F1 | 🔴 CRITICAL | **Project → Reports menu dead route** — `NG04002: Cannot match any routes. URL Segment: 'home/projectreport'`. Blank page; project reporting does not exist. |
| F2 | 🔴 CRITICAL | **Negative inventory pervasive**: MO MB25 Q-Avail −22/−23; Products P33 QOH −16, P30 QOH −38; Store Consumption SC14 consumed 12 > opening 10 → closing −2; **Inventory Dashboard confirms 24% of stock records negative**. No stock-feasibility check anywhere. |
| F3 | 🔴 CRITICAL | **API failures in live use:** `Proposal/GetProposalLineItemById` → 500; `ProjectBOM/getProjectBudgetById?id=undefined` → 400; `Autogenerate/Bank` → 500; `SalesOrder/getLinkedFileOrderById` called with PO id → 404; `ModuleSettings/getAllApprovalSettings` → status 0 (fails every load — **approval workflow feature broken**). |
| F4 | 🔴 CRITICAL | **Secrets stored/displayed in PLAINTEXT**: SMTP passwords, AWS SES credentials, Gmail app password (System Settings); IRP Client ID/Secret + e-Invoice username (e-Invoicing page). Anyone with Settings access can read production credentials. |
| F5 | 🔴 CRITICAL | **Over-receipt allowed**: Purchase Receipt PO4-1 line — PO Qty 13, Qty Rec'd **20** — no cap/warning at open qty. |
| F6 | 🔴 CRITICAL | **Inventory Adjustments have no approval workflow** — direct stock write with free-text reason (no reason codes, no approver audit). |
| F7 | 🔴 CRITICAL | **Email Notifications menu dead route** (`home/emailnotifications` NG04002) — feature unreachable; **HRMS Reports menu also dead** (redirects to blank `/App/`). |
| F8 | 🟠 HIGH | **BOM flat/single-level**: no multi-level explosion, scrap %, routing, labor/machine hours, versioning, approval, or cost roll-up. **Duplicate BOMs for P17 with no version disambiguation** — indeterminate MO consumption. |
| F9 | 🟠 HIGH | MO "Req Qty" **doubled vs BOM** in MB25 (22→44, 23→46) with no scrap factor exposed. |
| F10 | 🟠 HIGH | **Two financial years simultaneously Open** (2026-27 AND 2027-28) — weak period control. |
| F11 | 🟠 HIGH | **3-way match bypassable**: Vendor Bill PO number is free-text (auto-fill from receipt exists but editable); no qty/price tolerance check displayed. |
| F12 | 🟠 HIGH | **AR aging contradiction**: ₹40,36,954 receivables overdue >45 days displayed alongside "100% collection progress". |
| F13 | 🟠 HIGH | **Dispatch list includes unapproved Quotes** (Q15 ₹1.14 Cr) — dispatch from quote possible; ₹1.14 Cr pending shipment value stuck on 3 orders. |
| F14 | 🟠 HIGH | Number-series collisions: invoice **O36** (order series); MB/MO mixed; shared prefixes **PR** (PaymentReceipt & ProductRequisition), **SC** (ServiceCall & StoreConsumption), **D** (Deal & DeliveryChallan), **T** (Task & Timesheets), **V** (Voucher & Vendor); **duplicate Proposal series rows** (P1006 & P1001); **missing series** for PO, POS, GRN, journal vouchers. |
| F15 | 🟠 HIGH | **IDOR surface**: sequential integer IDs in URLs (`?Data=1126`, `?BackOrderId=1129`); only 1 role→menu assignment exists for 12 roles/4 users (permissions likely defaulted). |
| F16 | 🟠 HIGH | e-Invoice **IRN Failed** on I40/I41 (₹7.5L); e-Way Bill **EWB Failed** (EWB1). Config contradiction: System Settings `Enable E-Invoice = N` vs e-Invoicing page `ENABLED`. |
| F17 | 🟠 HIGH | **No QC/inspection gate at goods receipt** — "Inspection Terms" is only a text field; rejected qty captured only later in Purchase Return. |
| F18 | 🟡 MEDIUM | Data hygiene: test data ("abc", "OKOK", "XYZ", "tata mo"), persisted typos ("Assebly", "Finsishing", "Mangers Reason", "Openinig Cash", "Motor Vehical"), duplicate contacts, GSTIN "27" accepted, HSN "1200" accepted, ₹518-crore proposal accepted, product P30 sale price ₹8.79 crore. |
| F19 | 🟡 MEDIUM | Status inconsistencies: tasks 100% but "In Progress"; closed service calls IsClosed=No; fully-issued MR still "Partially Issued"; order status caps at 60%; dashboard "Invoices 0" vs "45 invoices overdue". |
| F20 | 🟡 MEDIUM | **Vouchers are single-sided** (no Dr/Cr double-entry journal, no balance validation); voucher prefix mismatch (list VC1002, new V1003). |
| F21 | 🟡 MEDIUM | Cross-customer mismatch accepted (I33 Bill-To C2 vs Ship-To C3); no valuation method (FIFO/WAvg) or opening-stock field on product master; product UOM-as-DB-id codes exposed. |
| F22 | 🟡 MEDIUM | Display bugs: service-invoice Line Amount 0.00 (totals correct); Back Order qty 0 with ₹12,000 price; "SalesTax 2.5%" no-slab match; Gantt "20480 day(s)"; duplicate leave-balance cards. |
| F23 | 🟡 MEDIUM | HRMS blocked for demo user: leave application → "Employee Not Mapped"; 4 dead Operations tiles (Time Tracker, Performance, HR Letters, Tasks). |
| F24 | 🟡 MEDIUM | Report Center: 31 reports/8 categories but **zero HRMS reports**; numbering gaps (2126-27, 2136-38, 2140, 2157 missing); Add Report dialog lacks Category field. |
| F25 | 🟡 MEDIUM | Performance: shell APIs re-fetched every navigation (CompanyInfo ×31, SystemConfig ×29, menu tree ×20); duplicate `getFinancialYears` ×2 calls; Angular **development mode** in production demo. |
| F26 | 🟢 LOW | UX: rotating/blank "Search By …" placeholders; checkboxes without bulk actions (except Send Mail); no CSV/Excel export on lists; "Store Consumption" tab holds labor allocation; Reminders form has no Cancel button; Refund/Void adjacent to Cancel. |
| F27 | 🟢 LOW | Orphaned "Unknown User" on 2 approved timesheets; approver identity not shown; no pending-approval queue; company-edit Units grid empty despite UN01 existing. |

---

## 2. System Architecture (observed, black-box)

- **Frontend:** Angular SPA at `https://demo.mapsofterp.in/App/`; **development mode** active on demo; Syncfusion-style components (Gantt, grids, pickers).
- **Backend:** REST API `https://mapsofterp.in/mapsoft-erp-webapi/api/` — cross-origin (CORS preflight OPTIONS on every call).
- **API style:** POST for list/search reads; GET for by-id and `generate*` number endpoints; masked sequential IDs in query strings.
- **Auth:** cookie/session; role-based menu tree via `Users/getUserMenuTree?userId=`; per-role notifications.
- **Multi-tenancy:** Company → Unit (UN01) hierarchy; unit selector on transaction forms; per-unit numbering (Unit Serial + Starting Number) **in addition to** global Transaction Series (dual numbering config points).
- **Config-driven:** `SystemConfig/getSystemConfigByAppKey` flags: `enable_einvoice`, `enable.po.level1.approval`, `PO_LIMIT` (50000), `auto_order_email`, `auto_purchase_order_email`, `inventory.qavail_warning` (=N — explains negative stock), `unitNameLabel`, `hide.columns_Products`, `CustomerSupportEmail`.
- **Legacy drift (dual systems):** `ProjectBillOfMaterial` vs `ProjectBOM` controllers; `Notifications` vs `Notification` endpoints.

### Shell APIs (every page, no caching)
`AssignRoleMenu/getAllMenus` · `Users/getUserMenuTree` · `CompanyInfo/getCompanyDetails` · both notification endpoints · `SystemConfig/getSystemConfigByAppKey` · `FinancialYear/get-by-date`

---

## 3. Complete Navigation Map

**Home (5 dashboards):** `dashboard` · `SalesDashboard` · `inventorydashboard` · `warehousedashboard` · `AccountingDashboard`

**CRM (6):** Leads `listlead` · Deals `listdeal` · Tasks `listtask` · Contacts `crmcontactlist` · Proposals `listproposal` · Quotes `listQuotes`

**Project (7):** Dashboard `projectDashboard` · Projects `listprojects` · Project & BOM `listProjectBOM` · Phases `listprojectphase` · Tasks `listprojecttask` · Timesheets `projecttimesheet` · **Reports `projectreport` ❌ DEAD ROUTE**

**Purchase (3):** Vendors `listvendors` · Purchase Orders `listPurchaseOrders` · RFQs `listrfq`

**Inventory (9):** Products `listProducts` · Inventory Adjustments `inventoryadjustment` · Purchase Receipts `receipts` · Purchase Returns `Return-PO-List` · Dispatch Orders `dispatchSalesOrder` · Product Requisitions `listproductrequisition` · Store Consumption `storeconsumption` · Delivery Challans `deliverychallan` · Issue Materials `issuematerials`

**Sales (8):** Customers `listCustomers` · Salespersons `listsalesPerson` · Orders `listOrder` · Invoices `listInvoice` · Sales Return `salesreturn` · e-Way Bills `ewaybills` · Back Orders `listbackorder` · POS `pos-invoice`

**Bill Of Material (1):** `listBillofMaterial`

**Manufacturing (2):** Manufacturing Batches `listManufacturingOrders` · Material Requests `materialrequests`

**General Ledger (3):** Chart of Accounts `listAccounts` · Bank Accounts `listbank` · Financial Years `listfinancialyear`

**Accounts Receivable (1):** Payment Receipts `listPaymentReceipt`

**Accounts Payable (3):** Vouchers `listVoucher` · Vendor Bills `listvendorbill` · Vendor Payments `listvendorpayment`

**Administration (5):** Roles `listRoles` · Assign Roles `listassignroles` · Users `userlist` · Company Information `companyinformationlist` · Units `listWarehouse`

**Settings (8):** UOM `listUnitsOfMeasure` · Payment Terms `listPaymentTerm` · Product Types `producttype` · Product Groups `listproductgroup` · Product Categories `listproductcategory` · Product Sub-Categories `listproductsubcategory` · System Settings `systemsettings` · Location `listLocation`

**Reports (1):** Report Center `reportcenter`

**Services (2):** Service Calls `listservicecalls` · Service Invoices `listserviceinvoice`

**HRMS (6):** Dashboard `hrmsdashboard` (6 tabs: Dashboard/My Feeds/Profile/Files/Calendar/Expense) · Leaves `listleaves` · Attendance `listattendance` · Timesheets `timesheets` · Operations `operations` (16 tiles) · **Reports `reports` ❌ DEAD ROUTE**

**Taxes & Compliance (3):** GST `gst` · TDS Taxes `tdstaxes` · e-Invoicing `einvoicing`

**Setup & Configurations (4):** Transaction Series `transactionseries` · Reminders `reminders` · Module Settings `modulesettings` (API broken) · **Email Notifications `emailnotifications` ❌ DEAD ROUTE**

**3 dead routes total** (Project Reports, HRMS Reports, Email Notifications) + **1 broken API** (Module Settings approval) = 4 unreachable features via menu.

---

## 4. CRM Module

### 4.1 Leads (`listlead`)
- Columns: Lead Code, Lead Name, Status, Company, Salesperson, Created Date, Created By, IsConverted. 8 leads; statuses Pre-Qualified/Contacted/Lost Lead; **mixed code formats** (L14 vs bare 14).
- New form: Lead Code (auto L15, Manual Entry ☐), Industry, Contact, Annual Revenue, Lead Name, Company, Salesperson, Comments, Lead Status ▾, Lead Source ▾, Email, Mobile.
- APIs: `CRM/getLead`, `generateLeadCode`.
- Issues: no filters; no Lead→Deal convert button; rotating search placeholder.

### 4.2 Deals (`listdeal`)
- Columns: Deal Code, Deal Name, Stage, Expected Revenue, Closing Date, Created Date, Created By, IsClosed. 9 deals; no WON/LOST in data.
- New form: Deal Code, Probability %, Type, Closing Date, Deal Name, Stage ▾ (9 options incl. WON/LOST/Lost To Competition), Contact, Description, Expected Revenue, Salesperson, Lead, Comments.
- Detail: + Closed Date/Time, Comments sub-grid. Buttons: **Update, Close Deal, Create Task, Send Email**.

### 4.3 Tasks (`listtask`)
- Columns: Task Code, Subject, Reminder, Status, Priority, Created Date, Created By, IsClosed. Views: **List/Kanban/Calendar/Gantt**.
- **Bug:** Gantt "Duration: 20480 day(s)".
- New form: Task Code, Deal, User ▾, Contact, Description, Subject, Start Date, Priority, Salesperson, Reminder, Due Date, Status, Closed Date & Time, Comment.

### 4.4 Contacts (`crmcontactlist`)
- Columns: Name, Address, Mobile, Email, City, Country. **Duplicate contacts** (same email); blank search placeholder bug; detail opens inline (no route change).
- Form: Prefix ▾, Contact Name (required), Gender ▾, DOB, Job Title, emails/phones/website/socials, Internal Notes. No dedupe/merge, no company linkage.

### 4.5 Proposals (`listproposal`)
- P1004 ₹1,180 Draft; **P1001 ₹5,18,55,67,564.20 accepted** (no sanity cap).
- **CRITICAL:** `GetProposalLineItemById?id=P1004` → **500**; detail lines never load.
- Form tabs: **Order Lines / Proposal Details / Commercial Schedule / Proposal Special Notes** (template code, process flow, design basis, scope, exclusions, price basis, delivery weeks, validity, guarantee, special notes).

### 4.6 Quotes (`listQuotes`)
- Columns incl. typo "**Bill TO Customer**". Q52 ₹188.80.
- Form tabs: **Order Lines / Other Details**; totals: Header Discount, Freight Charges, Rate on Freight, GST ▾, GST on Freight; Other Details: Reference No, Customer PO, Destination, **Project Name**, Expected Dispatch, Terms of Delivery, Payment Terms.
- Detail buttons: **Update, Move To Order, Cancel** → quote→order conversion works.

---

## 5. Project Module

### 5.1 Project Dashboard (`projectDashboard`)
- KPIs: Open Task 2, Closed Task 3, Open Phases 4, Closed Phases 1; **My Tasks/My Phases tables empty** (user-scope filter broken). `[CountUp] target is null` ×8 console errors.

### 5.2 Projects (`listprojects`)
- 5 projects PJ27…PJ23; PJ27 "In Process" **with blank Start/End dates**.
- Form tabs: **Project / Budget🔒 / Finished Good🔒 / Project Transactions🔒 / Mail Interactions**. Fields: Project Code (auto), WBS, PONumber, dates, Bill-To/Ship-To blocks, Project Budget sub-grid, Expected Completion, Project Status ▾, Scope of Work, Linked Files.
- Detail (PJ27): **Budget** grid total ₹77,787; **Finished Good** grid (QOH 133/Q-Avail 131, BOM Type Manufacture, Status "PO Created"); **Project Transactions** empty; **Mail Interactions** duplicates Project tab fields (no mail history).

### 5.3 Project & BOM (`listProjectBOM`)
- PB3 "TEST", PB2 "OKOK", PB1 "XYZ" — test data.
- Form tabs: **Project / Assembly🔒 / Sub-Assembly🔒 / Child Parts🔒** (progressive enablement).
- Detail: Assembly grid with QOH/Q-Avail/Quantity/UOM/BOM Type/Sub-Assembly; **`48 Motor` QOH 0 accepted with no warning**.
- **Bug:** `getProjectBudgetById?id=undefined` → 400 (frontend passes undefined).
- Dual controllers: `ProjectBillOfMaterial` AND `ProjectBOM`.

### 5.4 Phases (`listprojectphase`)
- Columns incl. Completed tasks (%). Statuses In Progress/On Hold.
- Detail: Assigned To, Project, Status, dates, Closed Date. Buttons: **Update, Close Phase, Cancel**. No dependency sequencing.

### 5.5 Project Tasks (`listprojecttask`)
- PT17 50% "To be Tested"; **PT10/PT7/PT6 100% but "In Progress"** (no auto-close).
- Views: List/Kanban/Calendar/Gantt. Form: Assigned To ▾, Project ▾, Work Hours, **Completion (%) ▾ dropdown** (not free entry), Reminder.

### 5.6 Timesheets (`projecttimesheet`)
- 5 rows all Approved; **TM12/TM10 show "Unknown User"** (orphaned FK).
- Form: Project ▾, Task ▾ (dependent), User ▾, Daily Hours (HH:MM), Billing Type (Billable/Non-Billable), Date, Comments.
- Detail: all inputs disabled (approved lock) + Action Comments; **no approver identity; no pending queue**.

### 5.7 Project Reports (`projectreport`) — **❌ DEAD ROUTE** (F1)

---

## 6. Purchase Module

### 6.1 Vendors (`listvendors`)
- 5 vendors (V5 Om Enterprises, V4 Vikash, V3 Shree Enterprises, V2 Tata Motors…).
- Form: Inventory Vendor ☑ (default ON), Internal Vendor ☐, Vendor Code (auto V6), Description, General Info (address, **State GST-code list "35 - Andaman…"**, GSTIN, contacts).
- Detail tabs: General Information / **Contacts & Addresses** / **Account Payable** (Payment Terms, GL Account, **Outstanding Payables ₹, Vendor Credits ₹**) / Recent Interactions. More → Bank Account.
- Issues: no GSTIN/PAN validation; no vendor approval state.

### 6.2 Purchase Orders (`listPurchaseOrders`)
- Columns: PO No, PO Date, Project, Vendor, Unit, PO Total, Req'd Date, Status, Email Status, Created By, Print.
- Data: S/25/28 (Process), S/25/27 (Pending Level 1 Approval), S/25/26 (Approved ₹1,416), PO4 (Close). Email Status "Not Sent".
- **Workflow states: Process → Pending Level 1 Approval → Approved → Close** — approval driven by configs `enable.po.level1.approval` + `PO_LIMIT` (₹50,000).
- Form: Unit, Vendor, PO No (auto), Ship-To, **Department (default Administration)**, PO Date, Requested Date, **Amendment Number/Date**; tabs **Order Lines** (product search, Qty; grid: Code, Product, UOM, Qty, Cost, Amount, Disc%, NetAmount, GST%, GST₹, LineAmount, Date Required, **Project**) and **PO Details** (Freight + Rate/GST, P&F Charges + Rate/GST, Taxes, Project, Freight Type, Quotation Ref/Date, Transport, Delivery To, Inspection Terms, Payment Terms, Validity, PO Comment, Special Instruction).
- Line math: P30 structure2, 20 × ₹60 = ₹1,200 + 18% ₹216 = ₹1,416 ✓.
- **Bug:** More → Linked Files calls **`SalesOrder/getLinkedFileOrderById`** with PO id → **404**.
- Issues: no Approve/Reject button on PO form itself (approval external); amendment fields but no amendment audit trail.

### 6.3 RFQs (`listrfq`)
- R4 "Rate", R3 "jain", R2 "internal accessories".
- Form: RFQ Code (auto RF4), RFQ Name, Unit, Date; tabs **Vendor List** (Vendor, Address, Phone/Email, **Enter Prices**, Print, Delete) and **Product List** (disabled until vendors; Product, UOM, Price, Qty, Date Required, Remark).
- Issues: **no RFQ→PO conversion button**; no quote comparison matrix.

### 6.4 Procure-to-Receive workflow (VERIFIED)
1. **Product Requisition** (internal demand; Pending Approval → **Approve/Reject** buttons on doc; `IsPOCreated` guard prevents duplicate PO) → 2. optional **RFQ** (vendor prices captured via "Enter Prices") → 3. **Raise PO** from approved requisition → 4. **PO approval** (Level 1, ₹50k limit config) → 5. **Purchase Receipt** (select Vendor → PO → lines auto-pull; **Dr 1204 Inventory / Cr 2103 GRNI Clearing**) → 6. **Purchase Return** against receipt (**Dr 2000 AP / Cr 1204 Inventory**) → 7. PO **Close**. Vendor Bill (AP) settles GRNI.

---

## 7. Inventory Module

### 7.1 Products (`listProducts`)
- Columns: Prod Code, Product Name, **QOH, Q-Avail**, Sale Price, Cost, Product Type, HSN Code.
- Data: P33 ISMC **QOH −16**; P31 OKTEST **QOH −2**; P30 structure2 **QOH −38, Q-Avail −40, Sale Price ₹8.79 CRORE** (no sanity check).
- Form: Type radio **Goods/Service**; Product Type (required), Code (auto P34), Active ☑ / Taxable ☑ / Inventory ☑ / Lot Controlled ☐ / Inventory By Location ☐ / Serial Tracking ☐ checkboxes; Size, Weight, Specification/Grade, Description; UOM, Purchase Cost, Sales Price, HSN/SAC, **GST Rate %**; Product Group (e.g. Raw Materials) → Category → SubCategory; Primary Vendor, Vendor Product Code, Standard Type, Barcode, MFG PartId, MAKE, Remark; tabs General Info / Other Details.
- Detail → More: **Inventory Status** (grid: Unit No, QOH, Q-Avail, Q-Order, Q-BO, Q-Quote, Q-Ship, Q-PO, Q-Def, Q-Rejected, Q-Process), Ledger, Locations.
- **Issues:** no valuation method (FIFO/WAvg) field; **no opening-stock field**; config `hide.columns_Products` exists.

### 7.2 Inventory Adjustments (`inventoryadjustment`)
- Form: Date, **Reason (free text — no reason codes)**, Product, Unit, Quantity Available (auto), QOH (auto), **New Quantity On Hand**, UoM (auto), Quantity Adjusted, Reference Number, Description.
- Detail 1127: Choko Jelly QOH 113 → New QOH 150 (+37), Unit Cost ₹125.
- **CRITICAL (F6): no approval workflow — direct stock write, no approver audit.**

### 7.3 Purchase Receipts (`receipts`)
- Columns: Receipt Number (derives from PO no + "-1/-2"), PO Date, Project, Challan No, PO Number, Vendor, Unit, Receipt Amount, Received Date, Status, Created By, Print.
- Creation flow: **select Vendor (radio dialog) → select PO (checkbox dialog) → header+lines auto-pull**; fields: Challan No/Date, Received Date, Department, Freight/P&F/GST; tabs **Order Lines** (Qty, **Qty Rec'd, Qty Open, Qty Cancel**), **Receipt Info** (Price Basis, Transport, Delivery To, Inspection Terms, Transporter, Payment Terms, WBS No, LR-No).
- Detail PO4-1: line welding rod **PO Qty 13, Rec'd 20** (F5 over-receipt); **GL Posting: Dr 1204 Inventory ₹46,620 / Cr 2103 GRNI ₹46,620**.
- **Issues:** over-receipt uncapped; **no QC gate** (Inspection Terms is text only).

### 7.4 Purchase Returns (`Return-PO-List`)
- Form links **Receipt Order Number** → PO auto; grid: **Recd Qty, Rej Qty, Return Qty**.
- Detail PO4-1: MS Plate Recd 10 / Rej 4 / Return 4 @ ₹2,662 = ₹10,648 + GST; **GL: Dr 2000 AP / Cr 1204 Inventory**.

### 7.5 Dispatch Orders (`dispatchSalesOrder`)
- View: Order Lines with **Order Qty / Shipped Qty**; Dispatch Details tab (Supply Type, **Motor Vehical No** [typo], Dispatch Doc No, BOL/LR-RR No, Driver Name/Contact, Dispatch Through, Expected Delivery Date…).
- **Issue (F13): Quotes (Q15 ₹1.14 Cr) appear in dispatch list** — dispatch from unapproved quote possible.

### 7.6 Product Requisitions (`listproductrequisition`)
- Statuses: **Pending Approval → Approved** (Approve/Reject buttons on doc). Detail PR9 buttons: **Update, Raise PO, Cancel**.
- `IsPOCreated` duplicate-PO guard ✓.

### 7.7 Store Consumption (`storeconsumption`)
- Form: SC No (auto), From/End Date, **Employee/Contractor Name, Project, Labor Rate, Total Days, Total Labor Cost**, Unit; Components grid: **Opening Inventory, Consumed Qty, Closing Inventory**, Consumed In Operation, Rate, Total Cost.
- Detail SC14: Boiler Opening 10, **Consumed 12 → Closing −2** (F2 root cause); Rate ₹0 (cost not captured).

### 7.8 Delivery Challans (`deliverychallan`)
- **Challan Type: Job Work | Sales Return | Stock Transfer**. Detail buttons: **Mark as Delivered, Record Returns** (status "Returned").
- D13: FG23 Weight Machine qty 10 @ ₹75,000 (job work to Om Enterprises).

### 7.9 Issue Materials (`issuematerials`)
- No New button — requests originate in Manufacturing → Material Requests. Detail shows **Requested/Issued/Balance Qty** + **Issue** button on Approved MRs.
- **Issue:** MR/1112-1 fully-issued line (balance 0) still flagged "Partially Issued" (F19).

### 7.10 Stock Movement Document Inventory

| Document | Stock | GL signature |
|---|---|---|
| Purchase Receipt | **+** | Dr 1204 Inventory / Cr 2103 GRNI |
| Inventory Adjustment | **+/−** | direct stock write, no approval |
| Purchase Return | **−** | Dr 2000 AP / Cr 1204 Inventory |
| Store Consumption | **−** | (labor + component consumption) |
| Issue Materials (MR) | **−** | (issue to production) |
| Dispatch Orders (SO) | **−** | (Shipped Qty) |
| Delivery Challan | **−/±** | Job Work out / Sales Return / Stock Transfer |

---

## 8. Sales Module

### 8.1 Customers (`listCustomers`)
- 4 customers (C2-C5). Form: Type radio, GST Treatment ▾ (drives GSTIN field enable), AR tab; detail tabs: General Info / Contacts & Addresses / Account Receivables / Recent Interactions; **outstanding balance API**.
- **Issues:** C3 GSTIN "27" accepted; GST Treatment unset on saved customer.

### 8.2 Salespersons (`listsalesPerson`)
- No commission %, targets, territory, or user link — attribution tag only.

### 8.3 Orders (`listOrder`)
- **Quotes and orders mixed in one list (O/Q prefixes)**; third number format "26/27-10" (FY-based) on new orders.
- **Status ladder: Draft – 0% / Confirmed – 20% / Processing – 40% / Released to Fulfillment – 60%** — no terminal Completed/Invoiced status.
- Line grid: Qty, Price, Amount, Disc%, Net Amount, GST%, GST₹, Line Amount, Delivery Date. Math verified: 7 × ₹1,500 + 5% = ₹11,025 ✓.
- Detail buttons: **Update, Move To Shipping, Linked Files, Cancel**.

### 8.4 Invoices (`listInvoice`)
- Columns incl. **IRN Status, Cancel Status, Email Status**. Data: I42 Partially Paid/IRN Success; **I41 ₹7.5L IRN Failed; I40 IRN Failed; "O36" invoice (series collision)**.
- Detail (I42): B2B; **CGST ₹5.40 / SGST ₹5.40 / IGST ₹0.00**; 2 MTR × ₹30 + 18% = ₹70.80 ✓; payment terms COD; tabs + **GL Posting Details**.
- Actions: **Apply Credits**, Print, IRN status-driven. Console error: `Cannot read properties of null (reading 'costCalculation')`.
- POS is a parallel path: TRN2 "abc" ₹5,60,000 Paid (GST 12% ✓).

### 8.5 Sales Return (`salesreturn`)
- SR2 **Approved** ₹141.60 / SR1 **Rejected** — approval workflow exists. **8 reason codes** (Damaged Material, Wrong Item Supplied, Excess Supply, Customer Rejection, Warranty Replacement, Correction In Invoice…).
- Grid: **Invoice Qty, Already Returned, Return Qty**. Buttons: **Refund, Void** (+ GL Posting tab).

### 8.6 e-Way Bills (`ewaybills`)
- EWB1 → I42, **EWB Status Failed**. Transport tab: Mode Road/Rail/Air/Ship, vehicle, distance 410 km. Buttons: **Generate E-Way Bill, Update Vehicle, Extend Validity**.

### 8.7 Back Orders (`listbackorder`)
- Q27-1 from a QUOTE; **BO Qty 0 but Extended Price ₹12,000; "SalesTax ₹300" = 2.5% (no GST slab match)**.

### 8.8 Services
- **Service Calls:** detail has Priority, Technician, appointment from–to, auto-duration; buttons **Update, Close Ticket, Create Service Invoice**; **IsClosed="No" on Closed calls** (F19).
- **Service Invoices:** I33 **Bill-To C2 vs Ship-To C3 accepted**; line iPHONE16PRO HSN "1200" (invalid); **Line Amount column 0.00 while total ₹1,69,330 correct**; "Move To Invoice" conversion; shares I-series with sales invoices.

---

## 9. Bill Of Material (Manufacturing Core)

- 10 BOMs; **P17 Dark Chocolate appears TWICE — duplicate BOMs, no versioning** (F8).
- Form: **Finished Goods** search, Unit, UOM, **Quantity To Produce**, **BOM Type radio: Manufacture | Kit**, Q-Avail (read-only). Tab **Raw Materials** only — grid: Product Code/Name, Size, UOM, Quantity, **MAKE** (free-text brands), Vendor, Product Cost.
- Examples: Milk Chocolate (Sugar 5 @42, caramel 10 @100, biscuit 9 @85, vanilla 6 @150, raisins 3 @101; **UOM cells blank**); Tank (Pipe Clamp 22 @23, Lock Nut 23 @344, **Hex Nut M10×25 22 @₹45,456** outlier).
- **Missing vs ERPNext/Odoo/SAP:** multi-level explosion, scrap %, yield, routing/operations, labor/machine hours, overheads, versioning, approval, effective dates, where-used, cost roll-up, FG valuation link.

---

## 10. Manufacturing (Manufacturing Core)

### 10.1 Manufacturing Batches (`listManufacturingOrders`)
- Columns: Job Number, Start Date, Project Code, Finished Goods, Qty To Produce, Job Status, Finished Qty, Finished Date, Unit, Created By, Print.
- Data: MB26 10→9 Finished; MB25 45→40 Finished; MB24 Kitkat 10→0 Created; **MO20 prefix mixed with MB**; Project Code column holds product names for some rows.
- **Statuses: only "Batch Created" and "Batch Finished"** — no Planned/Released/In Progress/On Hold/Cancelled.
- Form ("Create Manufacturing Job"): Job No (auto MB27), **BOM picked via FG product search**, Unit, BOM Type, Project, Qty To Produce, UOM, Comment, Start Date, **Finish Quantity, Lot Number, Finish Date, Quantity On Hand**. Tabs:
  - **Raw Materials:** Quantity (BOM), Q-Avail, **Req Qty (editable)**, Product Cost, Extended Cost, **Q-WIP, WIP Date**, Vendor, PO No.
  - **Store Consumption = LABOR allocation** (Employee, From/End Date, Total Days) — misleading label; **no machine/work-centre anywhere**.
  - **Delivery Challan:** job-work subcontracting (D/C No, Vendor, Challan Type).
- Detail MB25: **Q-Avail −22/−23; Req Qty 44/46 = doubled vs BOM 22/23** (F2, F9).
- Detail MB24 actions: **Update, Finish Job, Delivery Challan, Auto PO**.
- **Missing:** WIP accounting, planned-vs-actual variance, machines/capacity/shifts, yield/scrap reporting (45→40 loss unreported), lot traceability UI, QC hooks, by-products.

### 10.2 Material Requests (`materialrequests`)
- MR/1111, MR/1112 "Tanker fabrication" — **Fully Issued**. Lines: Requested/Issued/Balance (10/10/0 ✓).
- Issue Materials page exposes **Issue** button on Approved MRs; partial states exist (MR/1112-1 "Partially Issued").
- Issues: no approval flow visible on MR; no link to originating MO id.

---

## 11. Finance Module (General Ledger + AR + AP)

### 11.1 Chart of Accounts (`listAccounts`)
- **530 accounts pattern: 1xxx Assets / 2xxx Liabilities / 4xxx Income / 5xxx Expenses**; columns: Account Code, Name, Type, Group, Financial Statement, Closing Balance.
- Data: 5003 COGS ₹5,00,030; 4002 Sales Revenue −₹7,50,384; 2103 GRNI Clearing −₹51,238; 1204 Inventory Asset −₹4,58,734; 1102 Vendor Advance ₹300.
- **"Recalculate GL Balances"** utility button. Form: Account Name, Code, Type ▾, Group ▾, Opening Balance, Description.
- Issues: flat list (no tree); negative asset balance display counter-intuitive.

### 11.2 Bank Accounts (`listbank`)
- 1 test row. Form: Code, Account No, IFSC, Opening Balance, Bank, Holder, Currency ▾, address.
- **Bug:** `Autogenerate/Bank` → **500** (auto-code broken).

### 11.3 Financial Years (`listfinancialyear`)
- 2027-28 **Open**; 2026-27 **Open**; 2025-26 Locked (Ravikumar). Row actions: **Lock / Close**.
- **CRITICAL (F10): two FYs simultaneously Open.** Duplicate `getFinancialYears` API call on load.

### 11.4 Payment Receipts (`listPaymentReceipt`)
- Statuses Draft/Paid/Void; Payment Types Cash/Cheque/Credit Card/Mobile Payment.
- **3 tabs:** *Payment* (No, Date, Type, **Deposit To (GL)**, Card Type, Customer, Cheque, Amount Received, Amount Used, **Received Full Amount ☐**, Amount Refunded, **Excess Amount → customer credits**, Bank Charges, **Tax Deducted Y/N**); *Open Invoices* (per-invoice allocation grid: Prior Paid, **TDS Amount, Applied Credits, Amount Due, Current Payment, Unprocessed**); *Advance Payment* (**TDS Tax + Rate + Amount + Amount After TDS**, Available Customer Credits).
- Issues: PR20 ₹28.58L stuck in Draft; Void receipt with no reversal linkage.

### 11.5 Vouchers (`listVoucher`)
- VC1002 PAYMENT Tata Motors ₹100. Form: Voucher No (auto **V1003 — prefix mismatch with VC**), Type **Payment Voucher / Receipt Voucher only**, Department, Payee, **Payment Mode (7: Cash, Cheque, Credit/Debit Card, Bank Transfer, Mobile Payment, Online Gateway)**, **Paid Through (GL)**, Reason, Reference; **Voucher Line Items** grid (Account, Description, Amount) + Total.
- **Issue (F20): single-sided — not a double-entry journal; no Dr/Cr columns, no balance validation, no posting status.**

### 11.6 Vendor Bills (`listvendorbill`)
- Statuses Paid/Partially Paid/**Overdue** (VB1018 ₹23,600; VB1021 ₹762.30). Prefix mix B1010 vs VB102x.
- Form: **Receipt Order Number + Search Receipt dialog** → PO, vendor, taxable ₹5,324 + GST auto-populate from receipt — **3-way chain present BUT PO Number remains free-text (bypassable, F11)**; fields: Invoice No (empty on all data), Payment Terms, Due Date, TDS Tax/Rate/Amount, Total Bill Amount.
- **Open Bills allocation** mirrors customer side (Prior Paid, Applied Credits, TDS, Amount Due, Current Payment).

### 11.7 Vendor Payments (`listvendorpayment`)
- VP1018 ₹5,000 Draft Advance. Form mirrors receipts: Paid Through (GL), Pay Full Amount, **Excess → vendor credits**, per-bill allocation, Advance tab.

### 11.8 Invoice↔Receipt↔Payment linkage (summary)
- Customer: receipt → Open Invoices tab → per-invoice Current Payment allocation + TDS + credits + unprocessed tracking ✓.
- Vendor: bill → receipt → PO chain auto-fill ✓ (but PO editable); payment → Open Bills allocation ✓.
- Advances tracked both sides with excess→credit conversion ✓.

---

## 12. Administration Module

### 12.1 Roles (`listRoles`)
- **12 roles:** PoAdmin, POS, HR Manager, Report Manager, CRM Manager, Quality Manager, Production Manager, Accountant Manager, Purchase Manager, Store Manager, Order Entry Clerk, Admin. Permission categories: **Access Right, ReportRights, Widgets, Settings** (icon-only on list).

### 12.2 Assign Roles (`listassignroles`)
- Maps Role → **Menus/Submenus** via checkbox grid (18 top menus with IDs 1111–1128).
- **Only 1 assignment exists** (Code 8629 "Administrator" → Setup & Configurations) for 12 roles/4 users — most roles have no explicit assignment (F15).

### 12.3 Users (`userlist`)
- 4 users: Nandini (never logged in), prsadd, Ravikumar, Admin (logged in Y). Future-dated 2026 logons.
- Form: User Name, names, Email, **Password + Confirm Password in same form**, Employee link, Roles (single-select), Unit, Mobile, Department.

### 12.4 Company Information (`companyinformationlist`)
- 1 company. Edit: Company Code, address, **Registered Under GST Y/N**, GST No, **Units section with GL tabs** (unit grid shows "No Records" despite UN01 existing — F27).

### 12.5 Units (`listWarehouse`)
- UN01 / Mapsoft Technologies LLP / Demo. Form: Active, Unit Code, **Unit Serial + Starting Number (per-unit numbering — dual config with Transaction Series)**, GSTIN, PAN, contact.

---

## 13. Settings / Taxes / Setup

### 13.1 Product Masters (4-level hierarchy)
- **Product Types** (S1111 Sales, FG1112 Finished Goods, RM1113 Raw Materials + **Prefix field** for product coding) → **Groups** (PG02 Finished Goods, PG03 Consumables & MRO…) → **Categories** (PC19-21) → **Sub-Categories** (PB55-56).
- UOM (~50 entries, **DB-id-as-code**), Payment Terms (1114-1117: 30/45/60 DAYS, COD), Location (hierarchical: Business → Warehouse → Section → Rack/Bin, e.g. UN01-B200-C100).

### 13.2 System Settings (`systemsettings`)
- 35 key-value rows: Wastage 0; **SMTP config (AWS SES + Gmail, creds in PLAINTEXT)**; Q-Avail Warning **N** (out-of-stock prevention OFF — root cause of negative stock); **PO Amount Limit 50000**; auto-mail toggles (Invoice, Vendor Payment, Order, Service Call ×2 duplicate, Purchase Order — all Y); Product Code by Type N; **Enable E-Invoice = N**; department SMTP (Administration, Financials).
- **CRITICAL (F4): credentials displayed in plaintext; no change history.**

### 13.3 GST (`gst`)
- HSN/SAC master (~50 rows) with GST Rate % + Effective Date. SAC services all 18%. No CGST/SGST split fields (derived at invoice by state). No end-date/versioning.

### 13.4 TDS Taxes (`tdstaxes`)
- **20 sections with GL mapping** (Payable 2203 / Receivable 1101): TDS001 Salary 0%, TDS002 Interest on Securities 10% (193), TDS003 Dividend 10% (194), TDS005 Contractors 2%, TDS007 Commission 2%, TDS008 Rent 10%, TDS009 Professional Fees 10%, TDS010 Capital Assets 10%, TDS015 Cash Withdrawals, TDS016 Purchase of Goods 0% (393(1)), TDS018 Mutual Fund 10.27%, TDS019/020 0%…
- Issues: several 0% rates (thresholds elsewhere?); mixed section formats.

### 13.5 e-Invoicing (`einvoicing`)
- Status **ENABLED**; generation start 01-08-2023; **Edit Credentials: GSTIN 27ABZFM7073M1Z5, Username (redacted), Password (masked), Client ID + Client Secret in PLAINTEXT** (F4). Contradicts System Settings Enable E-Invoice=N (F16). No sandbox/prod environment selector.

### 13.6 Transaction Series (`transactionseries`) — **full numbering inventory (29 series)**

| Module | Prefix | Start | Preview |
|---|---|---|---|
| Lead | L | 16 | L16 |
| Deal | D | 17 | D17 |
| Task | T | 29 | T29 |
| Proposal | P | 1006 | P1006 |
| **Proposal (DUPLICATE)** | P | 1001 | P1001 |
| Quote | Q | 54 | Q54 |
| ProductRequisition | **PR** | 10 | PR10 |
| DeliveryChallan | **D** | 14 | D14 |
| Order | **26/27-** | 10 | 26/27-10 (FY-based) |
| Invoice | I | 44 | I44 |
| PaymentReceipt | **PR** | 22 | PR22 |
| Voucher | V | 1003 | V1003 |
| VendorBill | VB | 1024 | VB1024 |
| VendorPayment | VP | 1020 | VP1020 |
| ServiceCall | **SC** | 15 | SC15 |
| Project | PJ | 29 | PJ29 |
| ProjectPhase | PP | 25 | PP25 |
| ProjectTask | PT | 19 | PT19 |
| Timesheets | **T** | 14 | T14 |
| Vendor | **V** | 7 | V7 |
| RFQ | RF | 4 | RF4 |
| Customer | C | 7 | C7 |
| SalesPerson | SP | 5 | SP5 |
| ManufacturingBatch | MB | 28 | MB28 |
| StoreConsumption | **SC** | 16 | SC16 |
| ProjectBOM | PB | 5 | PB5 |
| MaterialRequest | MR/ | 1113 | MR/1113 |
| SalesReturn | SR | 4 | SR4 |
| EwayBill | EWB | 1 | EWB1 |

**Shared-prefix collisions (F14):** PR, SC, D, T, V each serve 2 different documents. **Missing series:** Purchase Orders (uses S/25/xx!), POS, GRN receipts (PO4-1 style), journal vouchers. Units additionally carry their own Serial + Starting Number.

### 13.7 Reminders (`reminders`)
- Invoice + Bill due-date reminders ("2 day(s) before"), ON. Form: Name, days before/after, From/Cc, rich-text body with placeholders (Customer Name, Invoice Number, Amount Due, Due Date…).
- **Bug: New Reminder form has NO Cancel button.**

### 13.8 Module Settings (`modulesettings`) — **BROKEN**
- 10 modules (COA, Inventory Adjustments, Invoices, Orders, Products, POs, Purchase Returns, Quotes, Sales Return, Vendor Bills) × one **Approval** setting (No / Simple / Multi-Level).
- **API `getAllApprovalSettings` fails on every load (status 0)** → no current selection renders, no Save button — **approval workflow feature effectively unwired** (F3).

### 13.9 Email Notifications (`emailnotifications`) — **❌ DEAD ROUTE** (F7)

---

## 14. HRMS Module

### 14.1 HRMS Dashboard (`hrmsdashboard`)
- 6 tabs: Dashboard (**Check-in self-marking**, Reporting Manager: 0, On Leave Today, Birthday Buddies) / My Feeds (announcements/surveys/holidays — all 0) / **Profile (full employee master: Basic, Work — designation/employment type/shift/reporting managers — Education, Internal Notes)** / Files (**9 KYC doc categories**: Aadhaar, PAN, degrees, resume, offer letter, experience letters, salary slips, Form 16) / Calendar (FullCalendar) / **Expense & Reimbursement** (KPIs + expense list with Reviewed By).

### 14.2 Leaves (`listleaves`)
- **6 leave types with balances:** WFH 0/0/0, Paternity 15/0/15, Maternity 42/0/42, LOP 0/0/0, Sick 12/0/12, Casual 8/0/8.
- **Duplicate balance cards rendered twice** (F22); typo "**Mangers Reason**".
- **Leave application blocked: "Employee Not Mapped — contact admin"** for demo user (F23).

### 14.3 Attendance (`listattendance`)
- Check-in based (self-service button on HRMS dashboard); manager approval via Operations → **Attendance Approval (with GPS capture, Work Type, Location)**. List/Calendar views; Export button present.

### 14.4 HRMS Timesheets (`timesheets`) vs Project Timesheets
- HRMS variant: self-entry (code TS1004, Manual Entry, Project, Task, User, Daily Hours, Billing Type, Date, Comments) — empty list.
- Project variant: 9 columns with Task + Billing Type, contains 5 approved rows (TM6-TM14) incl. "Unknown User" orphans.

### 14.5 Operations (`operations`) — 16 tiles
- Working tiles: **Onboarding (20-stage pipeline: Candidate Selected → Offer → BGV → Medical → Joined → Probation → Active → Withdrawn/No-Show), Employee Engagement, Files, Assets, Employee Information, Leave Tracker, Location Management, Attendance Approval, Attendance Tracker, Shift, Expense & Reimbursement, Offboarding**.
- **Dead tiles (no navigation): Time Tracker, Performance, HR Letters, Tasks** (F23).

### 14.6 HRMS Reports (`reports`) — **❌ DEAD ROUTE** (F7)

---

## 15. Report Center (`reportcenter`) — Full Inventory (31 reports / 8 categories)

| Category | Count | Reports |
|---|---|---|
| CRM | 3 | Lead By Status; Deal By Stage; Deals Closing This Month |
| General Ledger | 1 | Trial Balance By GL Account |
| Inventory | 2 | Product Master; Inventory Adjustment Summary |
| Payables | 6 | Vendor Balance Summary; Vendor Bills Details; Vendor Payment Details; AP Aging Details By Bill Due Date; Payable Summary; TDS Payables Summary |
| Projects | 2 | **Production Cost Of Project**; All Project |
| Purchases | 4 | Vendor Master; PO Receipt History By Vendor; PO History By Vendor; PO Receipt History By Product |
| Receivables | 5 | Customer Balance Summary; Payments Received; Customer Statement; AR Aging Details By Invoice Due Date; Receivable Summary |
| Sales | 8 | Customer Master; Salesperson Master; Sales By Customer; Sales By Product (×2 variants); Dispatch Sales By Product; Dispatch Sales By Customer; Delivery Challan Details |

- **Zero HRMS reports** (no leave/attendance/timesheet/payroll) (F24).
- Report-number gaps: 2126, 2127, 2136, 2137, 2138, 2140, 2157 missing (deleted/hidden).
- Add Report dialog: Name, Description, Path — **no Category field**; Description duplicates Name in list.

---

## 16. Dashboards Audit

| Dashboard | Key KPIs | Issues |
|---|---|---|
| Main (`dashboard`) | Invoices 0 (last month), Customers 4, Vendors 4, Salespersons 2; **Attention: 45 invoices overdue, 2 bills overdue, 9 POs pending approval**; Pending: 3 SOs unprocessed, 1 payment pending, 1 MR unprocessed; tabs Announcement (3 placeholder cards) / Recent Updates (5 release notes) / Getting Started (3 tips) | **"Invoices 0" vs "45 overdue" contradiction** (F19) |
| Sales | Gross Revenue ₹0, Total Sales 0, Invoiced 0, Customers 0; Revenue Trend, Top Products, Workflow, Tax & GST Distribution charts | All zeros for This Month while demo data has sales — period/filter misalignment; [CountUp] errors |
| Inventory | **Total Inventory Value ₹93,58,854**; Critical Items 129 (↑81%); **Distribution: In Stock 19% / Negative 24% / Zero 57%** | **24% negative stock records** (F2); occasional blank render |
| Warehouse | Pending Shipment Value **₹1,14,42,792 (3 orders)**; Open PO Value ₹5,92,832 (5 orders); Top-10 lists | ₹1.14 Cr stuck on 3 orders incl. a quote (F13) |
| Accounting | **Receivables ₹52,45,871 (Overdue ₹40,36,954 — 77% >45 days)**; Payables ₹25,579; Net Position ₹52,20,292 Surplus; **Closing Cash ₹1,28,15,012**; Cash Flow charts | **Overdue ₹40.4L with "100% collection progress"** (F12); typo "Openinig Cash"; ratio 100%/0% vs outgoing ₹1,240 |

---

## 17. Business Flow Analysis

### 17.1 Procure-to-Pay ✅ VERIFIED (with control gaps)
Requisition (Approve/Reject) → RFQ (Enter Prices) → **Raise PO** → PO Level-1 Approval (`PO_LIMIT` ₹50k) → **Purchase Receipt** (Dr Inventory/Cr GRNI) → Vendor Bill (receipt→PO auto-fill; **PO free-text bypassable**) → Vendor Payment (per-bill allocation, TDS, advances) → Purchase Return (Dr AP/Cr Inventory) → PO Close.
**Gaps:** over-receipt uncapped (13→20); no QC gate; bill Invoice No empty in data; overdue bills.

### 17.2 Order-to-Invoice ✅ VERIFIED (with gaps)
Customer → Quote → **Move To Order** → Order (0→60% statuses) → **Move To Shipping** → Dispatch (Order/Shipped Qty) → Invoice (CGST/SGST/IGST, GL posting, Apply Credits) → IRN + e-Way Bill → Payment Receipt (per-invoice allocation, TDS, credits) → Sales Return (reason-coded, Approved/Rejected, Refund/Void).
**Gaps:** no terminal order status; quotes dispatchable; IRN/EWB failing; POS + Service share I-series.

### 17.3 Manufacture ✅ VERIFIED (critical gaps)
Project → Project BOM (Assembly/Sub-Assembly/Child Parts) → Manufacturing Job (BOM via FG search; RM issue Req Qty + Q-WIP; labor allocation; job-work challans; **Auto PO** for shortage) → **Finish Job** (yield loss 45→40 unreported) → FG stock.
**Gaps:** negative stock; duplicate BOM ambiguity; Req Qty doubling; no routing/machines/capacity; 2 states only; no WIP accounting; lot unused; no QC.

### 17.4 Project Execution ✅ VERIFIED (weak ends)
Project (Budget/Finished Good/Transactions tabs) → Phases (completion %) → Tasks (assignee, work hours, Kanban/Gantt) → Timesheets (approved lock) → **Reports ❌ DEAD**.
Budget-vs-actuals not surfaced; Transactions tab empty; "My Tasks" filter broken.

### 17.5 HR Lifecycle ✅ structure VERIFIED
Onboarding (20-stage) → Employee master (KYC docs) → Attendance (check-in + GPS + approval) → Leaves (6 types, manager review) → Timesheets → Expense & Reimbursement → Offboarding.
**Gaps:** demo user unmapped (leaves blocked); 4 dead tiles; HRMS Reports dead; zero HRMS reports exist.

---

## 18. Compliance (India GST/TDS) Findings

| Area | Status | Evidence |
|---|---|---|
| GST slabs | ✅ | 0/5/12/18/28 dropdowns on documents |
| CGST/SGST/IGST split | ✅ | I42: CGST 5.40 + SGST 5.40 ✓ |
| HSN/SAC master | ✅ | ~50 entries with rates + effective dates |
| GSTIN validation | ❌ | "27" accepted on C3 |
| HSN validation | ❌ | "1200" accepted on service invoice |
| TDS master | ✅ | 20 sections, GL-mapped (2203/1101), rates |
| TDS at bill + payment | ✅ | Both levels (needs consistency control) |
| e-Invoice (IRN) | ⚠️ | Config present (GSP creds); IRN Failed on I40/I41; Enable flag contradiction |
| e-Way Bill | ⚠️ | Transport tab complete; EWB1 Failed |
| Freight GST | ✅ | Quote/PO/Bill: Freight + Rate + GST on Freight |
| TDS sections at 0% | ⚠️ | Salary (392), Purchase of Goods (393(1)), non-residents — thresholds unclear |

---

## 19. Security Findings

1. 🔴 **Secrets in plaintext (F4):** SMTP passwords, AWS SES credentials, Gmail app password (System Settings); **IRP Client ID/Secret + e-Invoice username** (e-Invoicing page). Access = Settings menu.
2. 🔴 **IDOR surface (F15):** sequential IDs in URLs (`?Data=1126`, `?BackOrderId=1129`, `?key=1119`, `?customerId=1112`); object-level authz unverified; only 1 role→menu assignment exists.
3. 🟠 Password + user data in same form (no separate reset flow); single-select role.
4. 🟠 CORS cross-origin API on every call — verify strict origin allowlist.
5. 🟠 Cookie flags (Secure/HttpOnly/SameSite) unverified.
6. 🟡 "Linked Files" upload validation (type/size/AV) unverified.
7. 🟡 No audit trail/who-changed-what on any form; System Settings/Transaction Series editable with generic confirm only.
8. 🟡 Raw DB ids exposed as business codes (UOM, Payment Terms, Assign Roles list).
9. 🟡 Angular development mode in demo (verbose errors).
10. Future-dated data (2026 logons) suggests demo clock manipulation.

---

## 20. UX / Navigation Findings

**Positives:** consistent list toolbar (New + search + pagination); Kanban/Calendar/Gantt on tasks; quote→order, requisition→PO, deal→task, call→invoice conversions; comment sub-grids; approved-record locking; per-invoice allocation grids; reminder placeholder system; hierarchical location master.

**Negatives:** 3 dead routes + 1 dead settings API; rotating/blank "Search By …" placeholders; checkboxes without bulk actions (except Send Mail); **no CSV/Excel export** on lists; status vocabularies inconsistent; date formats mixed (DD/MM/YY vs DD/MM/YYYY); "Store Consumption" = labor; "Mail Interactions" = duplicate fields; Refund/Void adjacent to Cancel; Reminders form no Cancel; duplicate leave cards; multiple typos persisted in UI labels.

---

## 21. API Endpoint Inventory (observed)

Base: `https://mapsofterp.in/mapsoft-erp-webapi/api/`

**Shell:** `AssignRoleMenu/getAllMenus` · `Users/getUserMenuTree` · `CompanyInfo/getCompanyDetails` · `Notifications/Notifications` · `Notification/GetNotifications` · `SystemConfig/getSystemConfigByAppKey` · `FinancialYear/get-by-date`

**CRM:** `CRM/getLead|generateLeadCode|getDeal|getDealById|generateDealCode|getTask|getTaskById|generateTaskCode` · `Contact/getCRMContactslist|GetContactsById` · `Proposal/GetProposal|GetProposalById|generateProposalNumber|GetProposalLineItemById(❌500)` · `SalesOrder/generateQuoteNumber|getSalesOrderStatus` · `DealComment/*` · `TasksComment/*`

**Project:** `ProjectBOM/getProjectBudgetById|getAllProjectBOM|getProjectTransactions` · `ProjectBillOfMaterial/getAllProjectBOM|getProjectBOMById` · `Billofmaterial/getProjectBOMLineitem` · `ProjectTask/*` · `ProjectPhase/*` · `ProjectPhaseImportedTask/getCompletionByPhase` · `Timesheet/*` · `Dashboard/GetProjectDashboardData|GetMyTask|GetMyPhases`

**Purchase:** `Purchaseorder/getPurchaseOrders|getPurchaseOrderById|getPurchaseOrderLineItemById|getPOReturn` · `RFQ/getRFQs|getRFQById` · `Vendor/getVendor|generateVendorNumber` · `Common/getStateList` · `SalesOrder/getLinkedFileOrderById(❌404 with PO id)`

**Inventory:** `Inventory/get?ProductCode=|getByWarehouseId` · `InventoryAdjustment/getInventoryAdjustment` · `POReceipt/getPOReceiptHeader` · `ProductRequisition/getproductrequisition|getproductrequisitionid|IsPOCreated|getproductrequisitionlineitemById` · `MaterialRequest/GetMaterialissues|getMaterialIssuesById|getMaterialIssuesLineItemByMaterialIssuesNo` · `DeliveryChallan/getDeliveryChallan` · `Warehouse/getWarehouses` · `UnitsofMeasure/getUnitsofMeasure`

**Sales:** `Customers/getCustomers|getCustomer|generateCustomersNumber|getGstTreatments|outstanding|getTermByCustomerCode` · `Contact/getCustomerContacts` · `SalesOrder/getSalesOrderNumberByLineItem` · `RecentInteractions/getrecentInteractionsById`

**Manufacturing:** `ProjectManufacturingBatch/getPMOById|getMBOM` · `StoreConsumption/getStoreConsumptionByPMOId`

**Finance:** `Account/GetAccounts` · `Autogenerate/Bank(❌500)` · `FinancialYear/getFinancialYears(×2 duplicate)` · `PaymentReceipt/getPaymentReceiptList` · `Voucher/getVoucher` · `VendorBill/getVendorBill` · `VendorPayment/getVendorPayment` · `AccountingDashboard/accounting-dashboard|cashflow|inventory-stock-distribution` · `Dashboard/getSalesDashboardData|getHomeDashboardData|getOrderStatistics|getPOStatistics|getInventoryValueByWarehouse|getRecentSales|getRecentPurchaseOrders`

**System:** `ModuleSettings/getAllApprovalSettings(❌status 0)` · `Currency/GetCurrency` · `Autogenerate/*`

**Patterns:** POST lists / GET by-id + generate; masked sequential ids; no REST PUT/DELETE; dual controllers (`ProjectBOM`/`ProjectBillOfMaterial`, `Notifications`/`Notification`).

**Broken endpoints observed:** `Proposal/GetProposalLineItemById` (500) · `Autogenerate/Bank` (500) · `ModuleSettings/getAllApprovalSettings` (status 0) · `SalesOrder/getLinkedFileOrderById` with PO id (404) · `ProjectBOM/getProjectBudgetById?id=undefined` (400).

---

## 22.

**Applied methodology:**
1. **Surface mapping** — full menu tree + URL enumeration (Section 3)
2. **Interaction probing** — every list → New form → detail; fields/tabs/actions (Sections 4–14)
3. **Traffic analysis** — per-page API capture; endpoint inventory; verb/payload patterns (Section 21)
4. **State machine recovery** — document statuses across all modules (Sections 6–17)
5. **Data-model inference** — entities & relations from grids/forms/APIs (Appendix C)
6. **Cross-checking** — totals recomputed (6 documents verified); status/flag desyncs; GL posting signatures

---

## 23. Recommendations (Priority Matrix)

### P0 — Immediate (Critical)
1. **Rotate & re-secure all exposed credentials** (SMTP, AWS SES, IRP Client ID/Secret) — move to secrets vault; mask in UI (F4).
2. Enforce **stock availability checks** on every stock-decreasing document (MO issue, Store Consumption, MR issue, Dispatch); turn ON `qavail_warning`; fix the 24%-negative-stock dataset (F2).
3. **Cap receipt qty at open qty** (over-receipt 13→20) (F5).
4. Add **approval workflow to Inventory Adjustments** with reason codes (F6).
5. Fix **3 dead routes** (Project Reports, HRMS Reports, Email Notifications) + **Module Settings API** (F1/F3/F7).
6. Fix broken APIs: Proposal line items (500), Bank auto-code (500), PO Linked Files wrong-endpoint (404), project budget undefined-id (400) (F3).
7. **Close one of the two open financial years**; add single-open-FY constraint (F10).

### P1 — High (this quarter)
8. Resolve **BOM duplication** (unique product+version; add versioning) (F8).
9. Expose/derive **scrap factor** on BOM lines & MO Req Qty (doubling unexplained) (F9).
10. Make **3-way match enforced** (lock PO after receipt selection; qty/price tolerance) (F11).
11. Fix **AR aging vs collection-progress contradiction**; reconcile dashboard KPIs (F12/F19).
12. **Block quotes from dispatch**; add order terminal status (Completed/Invoiced) (F13).
13. Unify **numbering series**: fix shared prefixes (PR/SC/D/T/V), duplicate Proposal row, missing PO/POS/GRN series, O36-invoice data fix (F14).
14. Investigate **IRN/EWB failures**; resolve Enable-E-Invoice flag contradiction (F16).
15. **Object-level authorization audit** (IDOR) + opaque tokens in URLs (F15).
16. Add **QC/inspection gate** at goods receipt (F17).

### P2 — Medium
17. Manufacturing depth: routing/operations, machines/work-centres, WIP accounting, yield/scrap reporting, lot traceability.
18. Data cleanup + validation: GSTIN/HSN formats, price sanity caps, dedupe contacts/BOMs/series, fix "Unknown User" orphans, typo sweep.
19. Status normalization + auto-close rules; MR partial/fully-issued logic fix.
20. **Double-entry journal voucher** (Dr/Cr with balance validation).
21. Valuation method (FIFO/WAvg) + opening stock on product master.
22. HRMS: map demo user → employee (unblock leaves); wire 4 dead tiles; add HRMS reports to Report Center.
23. API shell caching; production Angular build; single FY open guard.
24. Voucher prefix mismatch fix (V vs VC); company Units grid data fix.

### P3 — Low / Polish
25. Bulk actions; CSV/Excel export on lists; fix search placeholders; rename "Store Consumption" tab; Mail Interactions history; confirmation dialogs on Refund/Void; Reminders Cancel button; duplicate leave cards; date-format unification.

---

## 24. Audit Completion Status

| Module group | Status | Coverage |
|---|---|---|
| CRM (6 pages) | ✅ Complete | lists + forms + details + APIs |
| Project (7 pages) | ✅ Complete | incl. dead route proof |
| Purchase (3 pages) | ✅ Complete | PO workflow + approval chain |
| Inventory (9 pages) | ✅ Complete | stock-direction map + GL signatures |
| Sales (8 pages) | ✅ Complete | O2I chain + compliance |
| BOM (1 page) | ✅ Complete | form + duplicate-BOM evidence |
| Manufacturing (2 pages) | ✅ Complete | lifecycle + negative-stock evidence |
| Services (2 pages) | ✅ Complete | call→invoice chain |
| General Ledger (3 pages) | ✅ Complete | COA + FY control |
| AR (1 page) | ✅ Complete | 3-tab receipt + allocation |
| AP (3 pages) | ✅ Complete | 3-way chain + TDS |
| Administration (5 pages) | ✅ Complete | RBAC model |
| Settings (8 pages) | ✅ Complete | 4-level product hierarchy |
| Taxes (3 pages) | ✅ Complete | GST/TDS/IRP config |
| Setup (4 pages) | ✅ Complete | 29-series numbering table |
| HRMS (6 pages + 16 tiles) | ✅ Complete | lifecycle + dead tiles |
| Report Center (1 page) | ✅ Complete | 31-report inventory |
| Dashboards (5 pages) | ✅ Complete | KPI contradictions documented |

**Total: 18 modules / ~75 pages / 135 screenshots / 6 calculation verifications / 27 consolidated findings.**
**No data was created, modified, approved, or deleted** — all forms opened read-only and cancelled; all destructive buttons avoided.

---

## Appendix A — Verified Calculations

| Doc | Line | Math | Result |
|---|---|---|---|
| Order Q25 | 7 EA @1,500, GST 5% | 10,500 + 525 | 11,025 ✓ |
| Invoice I42 | 2 MTR @30, GST 18% | 60 + 10.80 | 70.80 ✓ (CGST 5.40 + SGST 5.40) |
| PO S/25/26 | 20 EA @60, GST 18% | 1,200 + 216 | 1,416 ✓ |
| Sales Return SR2 | 1 @120, GST 18% | 120 + 21.60 | 141.60 ✓ |
| POS TRN2 | 5,00,000, GST 12% | +60,000 | 5,60,000 ✓ |
| Service Inv I33 | 41 @3,500, GST 18% | 1,43,500 + 25,830 | 1,69,330 ✓ (Line Amount col shows 0.00 ✗) |
| Purchase Return PO4-1 | 4 @2,662, GST 18% | 10,648 + 1,916.64 | 12,564.64 ✓ |
| Receipt GL PO4-1 | Dr Inventory / Cr GRNI | 46,620 = 46,620 | ✓ balanced |

## Appendix B — Screenshots Index (`/tmp/audit/`, 135 files)

CRM (`crm-*`), Project (`proj-*`), Sales (`customer-*`, `order-*`, `invoice-*`, `pos-*`), BOM (`bom-*`), Manufacturing (`mo-*`), Purchase (`po-*`, `receipt-*`, `rfq-*`), Inventory (`product-*`, `inventory-*`, `store-*`, `delivery-*`, `requisition-*`, `issue-*`), Finance (`01-listAccounts` … `17-dashboard`), Admin (`01-listRoles` … `05-listWarehouse`), Settings (`06`–`13`), Taxes (`14`–`16`), Setup (`17`–`20`), HRMS (`01-hrmsdashboard` … `08-dashboard`), Report Center (`07-reportcenter` + filters).

## Appendix C — Data Model Inference (reverse-engineered)

- **Parties:** Customer (type, GST treatment, GSTIN, AR terms, outstanding) · Vendor (Inventory/Internal flags, AP terms, GL, outstanding, credits) · Contact (CRM + customer/vendor contacts) · Salesperson · Employee (HRMS: designation, employment type, shift, reporting managers, education, KYC docs)
- **Product:** Product (Goods/Service, type→group→category→sub-category 4-level, UOM, HSN, GST %, cost/price, tracking flags: Lot/Serial/Location, MAKE, primary vendor) · UOM · Warehouse/Unit (serial, starting number) · Location (hierarchical)
- **Project:** Project (WBS, PO number, budget lines, finished goods, transactions) · ProjectPhase · ProjectTask · Timesheet (TM) · ProjectBOM (assembly/sub-assembly/child parts)
- **Manufacturing:** ManufacturingBatch (BOM ref, project, qty, finish qty, lot, status, RM issue lines with Req Qty/Q-WIP, labor lines, challans) · MaterialRequest (requested/issued/balance) · StoreConsumption (labor rate + component consumption)
- **Sales:** Quote/Order + lines (qty/price/disc/GST/delivery) · Invoice (+ IRN/cancel/email status, GL postings, B2B type) · SalesReturn (+ reason, approval) · BackOrder · POSTransaction · EWayBill (transport) · ServiceCall · ServiceInvoice
- **Purchase:** Vendor · RFQ (vendors + prices + products) · PurchaseOrder (+ amendment, approval levels, department, project) · POReceipt (GRN; Dr Inventory/Cr GRNI) · POReturn (Dr AP/Cr Inventory) · ProductRequisition (+ approval, IsPOCreated)
- **Finance:** Account (COA, 1xxx/2xxx/4xxx/5xxx) · BankAccount · FinancialYear (Open/Locked/Closed) · PaymentReceipt (allocation + TDS + credits) · Voucher (payment/receipt, single-sided) · VendorBill (+ 3-way link) · VendorPayment (+ allocation)
- **System:** User · Role (12) · AssignRole (role→menu) · CompanyInfo · TransactionSeries (29) · SystemConfig (key-value + secrets ⚠️) · Reminder · ModuleSettings (approval per module — API broken) · GST (HSN/rates) · TDS (20 sections + GL) · e-Invoice config (IRP creds ⚠️) · Report (31, 8 categories) · Notification (dual systems)

---

*End of report — v2 COMPLETE. All 18 modules audited with read-only access; 27 consolidated findings; 8-point P0 action list. Evidence: 135 screenshots + API traffic captures + console logs.*


Haan bilkul — yehi deep audit hai. Pichhla part Section 6 (Sales/POS/Services) pe cut gaya tha. Ab poori baaki report continue karta hoon: **BOM → Manufacturing → Inventory → Purchase → Accounting → HRMS → Compliance → end-to-end flows → state machines → inferred data model → fix roadmap**. Sab kuch logic-level pe, verified findings (F1–F15) ko flows me weave karke.

*Legend: jo live verify hua woh seedha likha hai; jahan architecture-level deduction hai woh **(inferred)** mark kiya hai.*

---

# MapSoft ERP Deep Audit — Part 2 (Sections 7–20)

## 7. Bill Of Material — Manufacturing Core

### 7.1 Ek hi product ke liye do parallel BOM systems (root problem)

| System | Route | Controller(s) | Nature |
|---|---|---|---|
| **Project-BOM** (engineering) | `listProjectBOM` | `ProjectBOM` + legacy `ProjectBillOfMaterial` | 3-level: Assembly → Sub-Assembly → Child Parts |
| **Manufacturing-BOM** (flat) | `listBillofMaterial` | `Billofmaterial` | Single-level: parent → components |

Dono ek dusre se reconcile nahi hote. Project-BOM form me tabs progressively unlock hote hain (Project → Assembly🔒 → Sub-Assembly🔒 → Child Parts🔒 — save ke baad enable), aur "Back to Assemblies / Back to Sub-Assemblies" navigation hai. Lekin Manufacturing Batches **flat BOM** se consume karte hain. Matlab: engineering structure me aapne Sub-Assembly define kiya, production usko explode nahi karega — **flat list uthayega**.

### 7.2 BOM model me jo cheezein exist hi nahi karti (F4 — HIGH)

| Capability | Status | Implication |
|---|---|---|
| Multi-level explosion | ❌ (flat in mfg BOM) | Sub-assembly cost/qty roll-up impossible |
| Scrap / wastage % per line | ❌ (sirf Project-BOM header pe "Total Wastage") | Consumption planning inaccurate |
| Routing / operations / work centers | ❌ | No capacity planning, no lead-time calc |
| Labor / machine hours | ❌ | Costing me conversion cost missing — sirf material cost |
| Version / revision | ❌ | **Duplicate BOMs (P17 Dark Chocolate ×2) — MO banana pe kaunsa BOM uthaya gaya, indeterminate** |
| Approval workflow | ❌ | Koi bhi BOM turant active |
| Cost roll-up | ⚠ partial (Project-BOM assembly pe "Total Ext. Cost" column dikhta hai) | Standard cost recompute nahi hota **(inferred)** |

### 7.3 BOM → Consumption math (F5 — HIGH)

MB25 batch me observed:

| Component | BOM Qty | Batch "Req Qty" | Factor |
|---|---|---|---|
| Raw material A | 22 | **44** | ×2.0 |
| Raw material B | 23 | **46** | ×2.0 |

Dono lines pe **exact ×2** — random nahi hai, systematic hai. Do possible root causes:

1. **Double multiplication bug** — BOM line already per-batch-qty stored hai, aur MO creation pe batch quantity dobara multiply ho rahi hai **(most likely)**;
2. **Hidden 100% scrap factor** — UI pe koi scrap % exposed nahi hai, silently apply ho raha hai.

Dono case me serious hai: ya to **100% over-issue** record hoga (stock accuracy + costing dono barbaad), ya user ko bataye bina consumption double book ho raha hai. Koi scenario me bhi user UI pe "scrap 100%" ya "batch qty 2" ka explanation nahi dikhta — **transparency zero**.

### 7.4 BOM flow map + break points

```
Product Master (P17, FG23, 48 Motor, RTD, Fixture1…)
      │
      ├──> Project-BOM (PB1/PB2/PB3)          [3-level, engineering view]
      │        Assembly ──> Sub-Assembly ──> Child Parts
      │        ⚠ QOH 0 / Q-Avail 0 wala assembly
      │          ("48 Motor", qty 3, Manufacture) bina warning accept ✔
      │
      └──> Manufacturing-BOM (flat)            [P17 ke 2 duplicate BOM]
               │      ❌ no version → ambiguous selection
               ❌ no scrap, no routing, no labor
               │
               ▼
        Manufacturing Batch (MB/MO…)
```

---

## 8. Manufacturing Module

### 8.1 Manufacturing Batches (`listManufacturingOrders`)

- Numbering: **MB aur MO prefixes mixed** (F6 ka part) — series discipline nahi.
- **Lifecycle = sirf 2 states** (observed) — roughly Open/In-Progress → Completed. **Missing:** Cancelled, On Hold, Partial Complete, QC status. Ek batch adhoora chhod ke restart/undo ka koi mechanism UI me nahi dikha.

**MO state machine (as-is):**

```
[Created] ──> [In Progress] ──> [Completed]
                  │
                  └── ❌ koi cancel/rollback/hold path nahi
```

### 8.2 Material Requests (`materialrequests`)

Flow: **Batch → Material Request → Issue Materials → stock deduct**. MR ek internal demand document hai jo batch ke components se generate hota hai.

### 8.3 Negative inventory logic (F2 — CRITICAL)

MB25 pe issue ke baad:

| Field | Value | Matlab |
|---|---|---|
| Q-Avail | **−22, −23** | On-hand se zyada allocate/issue ho chuka |
| QOH | (positive) | Actual stock positive tha, over-issued |

**Logic kahan fail hui — 2 checkpoints, dono missing:**

1. **MO creation pe stock feasibility check nahi** — "48 Motor" assembly (QOH 0) wale project BOM ko bina warning accept kiya gaya (Section 7.4) — same pattern.
2. **Issue Materials pe hard stop nahi** — available se zyada issue karne par transaction reject hota hi nahi.

**QOH vs Q-Avail semantics (inferred):** `Q-Avail = QOH − (open orders + MOs + DCs me allocated qty)`. Negative Q-Avail ka matlab: over-commitment. Aur issue hone ke baad bhi negative dikha — ya to issue directly Q-Avail ko hit karta hai, ya allocation release nahi hui. Dono me se ek bhi correct behavior nahi hai.

### 8.4 Plan-to-Produce end-to-end (with breaks)

```
Project ──> Project-BOM ──> Mfg Batch ──> Material Request ──> Issue Materials ──> FG Receipt
   │            │                │              │                    │                 │
   │        ❌ F4 flat       ❌ 2 states    ⚠ approval      ❌ F2 negative      ⚠ completion
   │        ❌ no version    ❌ no cancel   flow nahi       ❌ F5 req qty        cost roll-up
   │        ❌ no routing       /hold        dikha           ×2 (F5)           nahi (inferred)
```

Manufacturing depth grade: **★★☆☆☆** — ye ek "issue materials aur FG stock me daal do" level ka lite manufacturing hai, discrete MRP nahi.

---

## 9. Inventory Module (9 pages)

### 9.1 Stock movement ledger — har source (jo system observed hua)

```
                    ┌────────────────────────────────────────────┐
   QOH / Q-Avail ◄──┤  (+) PO Receipt (GRN)                      │
                    │  (+) Sales Return approval                 │
                    │  (+) Manufacturing completion (FG) (inferred)│
                    │  (±) Inventory Adjustment (direct override)│
                    │  (−) Sales Invoice / Dispatch / DC         │
                    │  (−) Issue Materials (no feasibility ✔)    │
                    │  (−) Store Consumption (⚠ actually labor!) │
                    │  (−) Purchase Return (vendor ko wapas)     │
                    └────────────────────────────────────────────┘
   ❌ Physical count / cycle count / stock audit workflow ka koi dedicated page nahi
      (Adjustment hi wo kaam kar raha hai, bina approval ke — inferred)
```

### 9.2 Page-by-page findings

| Page | Route | Role in flow | Issues |
|---|---|---|---|
| Products | `listProducts` | Master: UOM, HSN, GST%, QOH, Q-Avail | Invalid HSN **"1200"** accepted; per-MTR length-based pricing supported |
| Inventory Adjustments | `inventoryadjustment` | Direct ±QOH | No approval trail observed |
| Purchase Receipts | `receipts` | PO→GRN, stock in | — |
| Purchase Returns | `Return-PO-List` | Vendor return, stock out | — |
| Dispatch Orders | `dispatchSalesOrder` | Order "Move To Shipping" ka target | Chain link ✓ (Section 17) |
| Product Requisitions | `listproductrequisition` | Internal demand | — |
| Store Consumption | `storeconsumption` | **Mislabel — isme labor allocation hai (F14)** | Menu naam galat hai, labor cost stock me se "consume" hota hai?? — accounting me double-count risk **(inferred)** |
| Delivery Challans | `deliverychallan` | Goods movement bina invoice | Separate doc ✓, par invoice ke saath reconcile/reconciliation view nahi |
| Issue Materials | `issuematerials` | MR fulfillment | **No feasibility check (F2)** |

### 9.3 Product master data quality

- HSN "1200" (invalid format) accepted on service invoice line — validation none.
- Product codes mixed style: `P17`, `P29`, `FG23`, `48 Motor`, `12 Tank`, `iPHONE16PRO`, `Fixture1` — koi naming convention enforced nahi.

---

## 10. Purchase Module

### 10.1 Procure-to-Pay flow (as designed)

```
Vendor Master ──> RFQ ──> Purchase Order ──> PO Receipt (GRN) ──> Vendor Bill ──> Vendor Payment
                    │            │                  │                │
                    └─ quote      └─ "PO Created"    └─ QOH (+)      └─ AP settle
                       compare      status project
                                   FG pe dikha ✔
```

### 10.2 Findings

| # | Finding | Severity |
|---|---|---|
| P-1 | **3-way match (PO vs Receipt vs Bill) ka koi UI evidence nahi** — Vendor Bill standalone form hai, PO/Receipt linkage ya mismatch flagging nahi dikhi **(inferred from forms)** | HIGH |
| P-2 | Back Order **quote (Q27) se generate hua** — procurement trigger logic inconsistent (order se hona chahiye tha) | MEDIUM |
| P-3 | RFQ → PO conversion route P2P chain me hai, par quote comparison/award analytics nahi | LOW |

---

## 11. General Ledger & Accounting

### 11.1 Structure

| Page | Route | Notes |
|---|---|---|
| Chart of Accounts | `listAccounts` | COA master |
| Bank Accounts | `listbank` | Bank master |
| Financial Years | `listfinancialyear` | FY master; **`FinancialYear/get-by-date` har page navigation pe call hota hai** (F13) |

### 11.2 GL posting logic (observed pattern)

- Invoice / Sales Return / Voucher detail pages pe **"GL Posting Details"** tab save ke baad appear hota hai → transactions GL entries generate karte hain.
- Invoice detail me tax breakup sahi compute hota hai (CGST ₹5.40 / SGST ₹5.40 / IGST ₹0.00 — verified math ✓), matlab tax ledger mapping structured hai.
- **(inferred)** Posting engine event-driven hai per document; unified journal browser / audit trail global level pe nahi dikha.

### 11.3 AR / AP

| Page | Flow role | Evidence |
|---|---|---|
| Payment Receipts | Customer payment → invoice settle | I42 "Partially Paid"; invoice detail pe **Apply Credits** (receipts against invoice) ✓ |
| Vouchers | Internal/journal payment doc | Detail me GL Posting Details tab |
| Vendor Bills | AP invoice | — |
| Vendor Payments | AP settle | — |
| Customer outstanding | `Customers/outstanding?customerId=` API | Per-customer AR rollup exists ✓ |

---

## 12. Taxes & Compliance (GST / TDS / e-Invoicing)

### 12.1 e-Invoice IRN pipeline

```
Invoice (saved) ──> [Generate IRN] ──> GSP/NIC ──> IRN + QR
     │                                   │
     │                            ┌──────┴──────┐
  States:                    Success         Failed
  Not Generated              (I39, I42)     (I40, I41 — ₹7,50,000!)
  Success                                   ⚠ error reason UI me surface
  Failed                                       nahi hua (F8)
  + Cancel: "Expired" (I42)
```

**IRN failure ke likely root causes (demo pe):**
1. Customer GSTIN invalid/incomplete — C3 pe GSTIN sirf **"27"** hai aur system ne accept kar liya (F11 jo F8 ko feed karta hai);
2. Payload validation (HSN invalid "1200", address incomplete);
3. GSP credentials/connectivity demo environment pe.

**High-value invoices (₹7.5L) pe IRN fail hona worst-case hai** — B2B customer input credit block ho jayega.

### 12.2 e-Way Bill pipeline

EWB1 (invoice I42, distance 410 km, vehicle MH12SD4512, Mode Road) — **Status: Failed**. Actions available: Generate E-Way Bill / Update Vehicle / Extend Validity — action set sahi hai, generation endpoint demo pe fail (F8).

### 12.3 Tax config

- GST slabs product pe per-item lagte hain (12%/18% verified math ✓).
- Back Order pe **"SalesTax 2.5%"** label with ₹300 on ₹12,000 — **kisi GST slab se match nahi karta** (F12) — legacy tax engine ka code path ya hardcoded label.
- TDS module (`tdstaxes`) exists — detail audit data demo me nahi tha.

---

## 13. HRMS Module

| Page | Route | Findings |
|---|---|---|
| Dashboard | `hrmsdashboard` | — |
| Leaves | `listleaves` | — |
| Attendance | `listattendance` | — |
| Timesheets | `timesheets` | Approved timesheet pe **saare inputs disabled** (lock ✓) par **approver ka naam kahin nahi**, aur pending-approval queue/inbox nahi |
| Operations | `operations` | — |
| Reports | `reports` | HRMS reports route working hai (Project reports ke ulat — F1 sirf project ka hai) |

**Referential integrity (F15):** TM12/TM10 approved timesheets pe **"Unknown User"** — user delete hone ke baad timesheet FK orphan. Ya to FK constraint nahi hai, ya soft-delete coordination nahi hai. Approved + orphan = **audit trail compromised** (kisne approve kiya, kisne time log kiya — dono unknown).

---

## 14. Administration / Settings / Setup & Configurations

### 14.1 Security architecture (observed)

```
User ──> Role ──> Assign Role Menu ──> Users/getUserMenuTree?userId=
                                          │
                                          └── sidebar = role-scoped menu
Auth: cookie/session based
IDs: masked sequential integers URL me — ?Data=1126, ?BackOrderId=1129,
     ?key=1119, ?customerId=1112, ?id=1130  →  IDOR surface (F7)
     Cross-tenant object-level authorization unverified
```

### 14.2 Transaction Series (`transactionseries`) — numbering chaos ka source (F6)

Ek hi config page se multiple series chalte hain aur strict allocation nahi hai:

| Doc | Observed formats |
|---|---|
| Orders | `O34`, `Q43`, `Q25` (order list me!), `26/27-10` (FY format) |
| Invoices | `I42…I36`, **`O36` (order series se invoice!)**, service invoices bhi I-series share |
| CRM | `L14` vs bare `14` |
| Mfg | `MB25` vs `MO…` |
| Others | Q, SR, BO (Q27-1), TRN, PJ, PP, PT, TM, PB, SP, C, P, EWB, SC/S |

**Logic flaw:** numbering module-scoped nahi hai (ya series per doc-type per-unit bind nahi hai) — isliye quote series order list me aa gayi aur order series invoice pe lag gayi. Business + compliance dono ke liye fatal pattern (GST pe invoice number uniqueness mandatory hai).

### 14.3 Masters (Settings)

UOM, Payment Terms, Product Type/Group/Category/Sub-Category, Location, System Settings, Module Settings, Reminders, Email Notifications — sab standard master CRUD. **Product hierarchy 4 levels** (Type → Group → Category → Sub-Category) hai — classification deep hai, usage reporting me nahi dikhi **(inferred)**.

### 14.4 Multi-tenancy

"Company / Unit" dimension: har transaction form pe Unit dropdown; unit-scoped numbering; `CompanyInfo/getCompanyDetails` har navigation pe (F13). Units page = `listWarehouse` — **Unit aur Warehouse concept overlapped** hai (confusing naming, inferred).

---

## 15. Reports & Dashboards

- **5 dashboards** (Main, Sales, Inventory, Unit/Warehouse, Accounting) — KPI cards structured, par Project Dashboard pe `[CountUp] target null` ×8 aur KPI vs "My Tasks" scope mismatch.
- **Report Center** (`reportcenter`) exists ✓.
- **Project Reports route dead (F1 — CRITICAL):** menu item → `/App/home/projectreport` → `NG0402` route not registered ×4. Project module ka reporting feature **exist hi nahi karta**.
- Kisi bhi list page pe **CSV/Excel export nahi** (F14) — ERP ke liye basic expectation.

---

## 16. End-to-End Flow Analysis (Order-to-Cash sabse important)

### 16.1 Order-to-Cash — link-by-link health

```
Lead ──> Deal ──> Quote ──> Order ──> [Back Order] ──> Dispatch ──> DC ──> Invoice
  │        │        │         │           │              │        │        │
  ⚠ manual  ❌ no    ✓ Move   ✓ Quote→    ❌ quote se    ✓ Move    ✓ doc    ✓ math ✓
  convert   Deal→   To Order  Order       BO bana;       To        exists   (Q25, I42)
  button    Quote   works     banta hai   qty=0 + tax    Shipping           │
  nahi      convert            par status  2.5% bugs                         ▼
  (sirf                terminal 60% pe                              IRN ──> EWB ──> Payment
  IsConverted          reh jaata hai                                  ❌Failed  ❌Failed  ✓Partial
  flag)                (no Completed)                                 (I40,I41) (EWB1)   (Apply
                                                                            Credits)
```

**Verdict:** chain ki *spine* bani hui hai (Quote→Order→Shipping→Invoice→Payment), par **5 links broken/weak** hain aur **terminal states define hi nahi hain** — order kabhi "Completed/Invoiced" nahi hota.

### 16.2 State Machine Catalogue (consolidated)

| Document | Observed states | Kya missing |
|---|---|---|
| Sales Order | Draft 0% → Confirmed 20% → Processing 40% → Released to Fulfillment 60% | **80/100%, Completed, Invoiced, Cancelled** |
| Invoice | Draft → Open → Partially Paid → Paid (+ Cancel) | rounding-off, write-off path |
| IRN | Not Generated → Success/Failed; Cancel Expired | failure reason surface |
| e-Way Bill | Failed observed; actions present | success path unverified |
| Sales Return | Draft → Approved/Rejected → Refund/Void | credit-note linkage |
| Manufacturing Batch | ~2 states only | Cancel/Hold/Partial/QC |
| Deal | 9 stages (incl. WON/LOST — **data me kabhi use nahi hue**) | won/lost analytics |
| CRM/Project Task | Not Started/In Progress/Completed/Deferred/Waiting/To be Tested | 100% + "In Progress" desync (F10) |
| Phase | In Progress / On Hold / Closed (via Close Phase) | dependencies |
| Timesheet | Submitted(?) → Approved (locked) | Reject/Reopen, approver identity |
| Service Call | Open → Closed (button) | **IsClosed flag desync** (F10) |
| Lead | Pre-Qualified/Contacted/Lost + IsConverted | convert action |
| Project | Open / In Process / (vocab: "In Process / WIP") | consistent vocabulary |

**Pattern:** har module ne apna status vocabulary khud banaya — koi central state-machine/status-registry nahi hai. Yahi F10/F6/F15 ka common root hai.

### 16.3 Calculation logic — verified math scorecard

| Doc | Math | Result |
|---|---|---|
| Order Q25 | 7×1,500 + 5% GST = 11,025 | ✓ |
| Invoice I42 | 2 MTR×₹30 + 18% = 70.80 (CGST 5.40+SGST 5.40) | ✓ |
| SR2 | 1×120 + 18% = 141.60 | ✓ |
| POS TRN | 5,00,000 + 12% = 5,60,000 | ✓ |
| Service I33 | 41×3,500 + 18% = 1,69,330 (list total ✓, **line Amount column 0.00 — display bug**) | ⚠ |
| Back Order | 8×1,500 = 12,000; tax 300 = 2.5% (**no slab**) + qty column 0 | ✗ |
| Proposal P1001 | ₹5,18,55,67,564.20 accepted | ✗ (no validation) |
| Mfg batch MB25 | Req = 2× BOM qty, Q-Avail negative | ✗ |

**Core tax/amount engine mostly sahi hai** — bugs display layer, validation layer aur manufacturing logic me hain.

---

## 17. Inferred Data Model (reverse-engineered)

```
Company/Unit ─┬─> Series (per doc-type) ─┬─> all transactions (unit-scoped numbering)
              └─> SystemConfig (AppKey flags: enable_einvoice, auto_order_email,
                              inventory.qavail_warning, unitNameLabel…)

Customer ──> Contact, Address, GST Treatment, outstanding (AR)
Salesperson (attribution-only tag, no user link)

⚠ CRITICAL INFERENCE: Quote + Sales Order + Back Order likely EK hi entity hai
   (doc-type discriminator), evidence:
   • Quotes order list (listOrder) me appear hoti hain (Q43, Q25)
   • `SalesOrder/generateQuoteNumber` + `SalesOrder/getSalesOrderStatus` — same controller
   • BO quote Q27 se bana (`ForceOrderProcess`)
   • Invoice "O36" order-series number se bana
   → Isi wajah se series leak ho rahi hai across doc-types (F6)

Order(line) ──> Invoice(line) ──> IRN/EWB ──> PaymentReceipt (Apply Credits m:n)
Order ──> Dispatch ──> DeliveryChallan
Invoice ──> SalesReturn ──> Refund/Void

Product ──> BOM(flat, no version) ──> ManufacturingBatch ──> MaterialRequest ──> Issue
Product ──> Adjustment / Receipt / Consumption

Vendor ──> RFQ ──> PO ──> Receipt ──> VendorBill ──> VendorPayment
Voucher, Account, Bank, FinancialYear ──> GLPosting (polymorphic source doc)

Project ──> ProjectBOM(Assembly>Sub>Child), Phase, ProjectTask, Timesheet(orphan User!)
ServiceCall ──> ServiceInvoice (I-series shared!)
User ──> Role ──> MenuTree ; Timesheet.UserId → deleted user = "Unknown User"
```

---

## 18. API Architecture (patterns + health)

| Pattern | Example | Note |
|---|---|---|
| List/read | `POST api/{Module}/get{Entity}` | reads bhi POST — cache-layer hostile |
| By-id | `GET …/get{Entity}ById?id=` | **sequential ints exposed (IDOR, F7)** |
| Numbering | `GET …/generate{Entity}Number` | race-condition risk bina lock ke **(inferred)** |
| Comments | `…Comment/get{Entity}CommentsBy{Entity}Id` | consistent sub-resource |
| Config | `SystemConfig/getSystemConfigByAppKey` | flag-driven design ✓ |
| **Dual controllers** | `ProjectBillOfMaterial` vs `ProjectBOM`; `Notifications/Notifications` vs `Notification/GetNotifications` | legacy drift (refactor incomplete) |
| **Broken** | `Proposal/GetProposalLineItemById` → **500**; `ProjectBOM/getProjectBudgetById?id=undefined` → **400** (frontend undefined pass karta hai) | F3 |

**Shell waste per navigation (F13):** CompanyInfo ×31, SystemConfig ×29, menu ×20, notifications ×19×2 — zero client caching + Angular **dev mode** prod pe.

---

## 19. Root-Cause Clusters (findings → 6 clusters)

| Cluster | Findings | Ek line me root cause |
|---|---|---|
| **A. Identity/Numbering** | F6, O36, Q-in-orders, L14/14, MB/MO | Series doc-type+unit pe strictly bind nahi |
| **B. Stock Integrity** | F2, F4, F5 | No feasibility checks + flat versionless BOM + double multiply |
| **C. Route/API Health** | F1, F3 | Dead route, 500s, dual controllers, frontend undefined ids |
| **D. Compliance** | F8, F11 | GSTIN/HSN validation missing → IRN/EWB fail cascade |
| **E. Data Hygiene & States** | F9, F10, F12, F15 | No validation layer + per-module ad-hoc status vocab + FK orphans |
| **F. Performance/UX** | F13, F14 | No caching, dev build, mislabeled tabs, no exports |

## 20. Fix Roadmap (priority)

| Pri | Fix | Effort | Impact |
|---|---|---|---|
| **P0** | Stock feasibility check MO-create + Issue pe (hard stop ya override-with-reason) | S | F2 band |
| **P0** | Req Qty ×2 bug fix (unit test: BOM line × batch qty exactly once) | S | F5 band |
| **P0** | `projectreport` route register karna ya menu item hatana | XS | F1 band |
| **P0** | Proposal line-item 500 + `id=undefined` frontend fix | S | F3 band |
| **P1** | Series engine: per doc-type+unit strict allocation, collision reject | M | F6/O36 band |
| **P1** | GSTIN/HSN format validation customer/product entry pe | S | F8/F11 ka upstream fix |
| **P1** | BOM versioning + duplicate-guard (same product+active version unique) | M | F4 |
| **P1** | Order terminal states (Completed/Invoiced) + status registry centralize | M | F10 |
| **P2** | Multi-level BOM explosion + scrap % + routing | L | Manufacturing depth |
| **P2** | Shell API caching + prod build + controller consolidation | M | F13 |
| **P2** | List exports (CSV), bulk actions, label fixes (Store Consumption), FK soft-delete guard | M | F14/F15 |

---

## Final Verdict (full picture)

**MapSoft ERP = breadth-first ERP.** 18 modules, ~75 pages, Order→Invoice spine, GST/e-Invoice structures, multi-unit — sab *present* hai. Par **depth me manufacturing core sabse weak hai** (flat BOM, 2-state MO, negative stock, ×2 consumption), **compliance pipeline fragile hai** (invalid GSTIN upstream se IRN/EWB fail), aur **data integrity discipline missing hai** (series collisions, orphan users, ₹518-crore proposals, test data).

**Grades:** Breadth ★★★★☆ · Flows ★★★☆☆ · Manufacturing ★★☆☆☆ · Integrity ★★☆☆☆ · Compliance ★★★☆☆ · UX ★★★☆☆.

---

Aage kya karna chahoge? Main ye kar sakta hoon:
1. **Per-module fix specification** — har cluster ka detailed technical fix doc (API contract changes included)
2. **Rebuild blueprint** — iska clean architecture version (Next.js + Prisma schema me sahi data model, state machines, series engine)
3. **Test scenario catalogue** — audit findings ko regression test cases me convert karna