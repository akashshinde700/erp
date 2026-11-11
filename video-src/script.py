"""ForgeERP — user-guide video series: scene graph.

Each chapter becomes one MP4. Each scene is one rendered frame (PIL) that the
assembler slowly zooms and cross-fades, with Hinglish narration on top.

Caption text stays in English (the UI language); narration lives in
narration.py so it can be regenerated independently of the visuals.
"""

SHOT_DIR = "../docs/manual-screenshots"

CHAPTERS = [
    {
        "id": "01",
        "slug": "01-start-here",
        "title": "Start Here",
        "subtitle": "Login · Dashboard · Navigation",
        "scenes": [
            {
                "kind": "chapter",
                "title": "Start Here",
                "points": [
                    "Log in with your company email",
                    "Read the dashboard in 60 seconds",
                    "Ctrl + K, keyboard shortcuts",
                    "Full ERP on a phone",
                ],
            },
            {
                "image": "01-login.png",
                "title": "Sign in to your organization",
                "points": [
                    "Company email + password",
                    "One organization never sees another's books",
                    "Sign out on shared computers",
                ],
                "focus": [470, 250, 500, 420],
            },
            {
                "image": "02-dashboard.png",
                "title": "Dashboard — your daily cockpit",
                "points": [
                    "7 KPI cards: sales, receivables, payables, stock",
                    "Quick actions for every routine job",
                    "Low stock and recent invoices below",
                ],
                "focus": [205, 232, 1220, 225],
            },
            {
                "image": "03-command-palette.png",
                "title": "Command palette — Ctrl + K",
                "points": [
                    "Type a party, item or invoice number",
                    "Create actions and recent screens together",
                    "Enter jumps straight to the record",
                ],
                "focus": [420, 210, 600, 330],
            },
            {
                "image": "04-shortcuts.png",
                "title": "Keyboard shortcuts — press ?",
                "points": [
                    "Alt + S: new sales invoice from anywhere",
                    "Alt + P: new purchase invoice",
                    "g then d / s / p / j: module jumps",
                ],
                "focus": [380, 230, 680, 420],
            },
            {
                "image": "64-mobile-dashboard.png",
                "title": "Full ERP on a phone",
                "points": [
                    "Same URL — nothing to install",
                    "Bottom tabs: Home, Sales, Purchase, Jobwork, Stock",
                    "Menu icon opens the full sidebar drawer",
                ],
                "narrow": True,
            },
        ],
    },
    {
        "id": "02",
        "slug": "02-masters-setup",
        "title": "Masters & Setup",
        "subtitle": "Company → Parties → Items → Warehouses",
        "scenes": [
            {
                "kind": "chapter",
                "title": "Masters & Setup",
                "points": [
                    "Company profile prints on every invoice",
                    "Parties: customer, supplier, jobworker",
                    "Items with HSN, UOM, GST %, reorder level",
                    "MAIN and JW warehouses stay separate",
                ],
            },
            {
                "image": "10-masters-company.png",
                "title": "Company profile",
                "points": [
                    "Trade name, GSTIN, state, address",
                    "Bank details land in the invoice bank block",
                    "GSTIN checksum is validated",
                ],
                "focus": [270, 200, 900, 560],
            },
            {
                "image": "05c-masters-new-party.png",
                "title": "New party — customer / supplier",
                "points": [
                    "Code + name, then tick CUSTOMER / SUPPLIER / JOBWORKER",
                    "GSTIN, state and 6-digit pincode for e-Invoice",
                    "Credit limit + credit days drive aging",
                ],
                "focus": [300, 150, 840, 700],
            },
            {
                "image": "11-masters-party-view.png",
                "title": "Party view — one click to the next action",
                "points": [
                    "Receivable / payable and voucher history",
                    "New Invoice, Receive Payment, Party Ledger",
                ],
                "focus": [280, 200, 900, 520],
            },
            {
                "image": "06-masters-items.png",
                "title": "Items",
                "points": [
                    "Group, HSN (6 or 8 digits), UOM, GST %",
                    "Sale rate, cost rate, reorder level",
                    "Service flag = no stock tracking",
                ],
                "focus": [270, 240, 1150, 480],
            },
            {
                "image": "07-masters-warehouses.png",
                "title": "Warehouses — MAIN and JW",
                "points": [
                    "MAIN = your own stock",
                    "JW = customer material for jobwork",
                    "Availability is checked per warehouse",
                ],
                "focus": [270, 210, 1000, 400],
            },
            {
                "image": "08-masters-processes.png",
                "title": "Processes and party rates",
                "points": [
                    "Rate basis: per KG / per piece / per lot",
                    "Lot charge added on top",
                    "Party rate overrides the default",
                ],
                "focus": [270, 210, 1100, 480],
            },
        ],
    },
    {
        "id": "03",
        "slug": "03-sales-gst-invoice",
        "title": "Sales & GST Invoice",
        "subtitle": "Invoice → Print → Payment → Tally",
        "scenes": [
            {
                "kind": "chapter",
                "title": "Sales & GST Invoice",
                "points": [
                    "Post an invoice in one transaction",
                    "Stock, ledger and GST move together",
                    "Print, receive payment, export to Tally",
                    "Quote → Order → Delivery → Invoice",
                ],
            },
            {
                "image": "12-sales-list.png",
                "title": "Sales invoice list",
                "points": [
                    "Totals, outstanding and source per invoice",
                    "MANUAL vs JOBWORK invoices together",
                    "Filter chips by status",
                ],
                "focus": [270, 220, 1150, 380],
            },
            {
                "image": "13-sales-new-invoice.png",
                "title": "New invoice — customer to lines",
                "points": [
                    "Customer sets the place of supply",
                    "Stock from the chosen warehouse only",
                    "Tax-inclusive toggle back-solves GST",
                    "Live preview = print = posted totals",
                ],
                "focus": [240, 118, 985, 775],
            },
            {
                "image": "14-sales-invoice-detail.png",
                "title": "Invoice detail — what next",
                "points": [
                    "Receive Payment, Duplicate, Tally, Print",
                    "Cancel reverses stock and GL (no deletes)",
                    "Full tax invoice with HSN and amount in words",
                ],
                "focus": [270, 200, 1150, 430],
            },
            {
                "image": "15-sales-tally-menu.png",
                "title": "Tally and e-Invoice export",
                "points": [
                    "XML / JSON / CSV per document",
                    "Importer .bat for batch folders",
                    "e-Invoice JSON for the GST portal",
                ],
                "focus": [700, 200, 500, 420],
            },
            {
                "image": "16-sales-quote-to-cash.png",
                "title": "Quote to Cash",
                "points": [
                    "Quotation → Sales Order → Delivery + QC → Invoice",
                    "Quantity carries forward, no double entry",
                ],
                "focus": [270, 220, 1150, 480],
            },
        ],
    },
    {
        "id": "04",
        "slug": "04-purchase-procurement",
        "title": "Purchase & Procurement",
        "subtitle": "Supplier bill, input GST, returns",
        "scenes": [
            {
                "kind": "chapter",
                "title": "Purchase & Procurement",
                "points": [
                    "Supplier bill posts stock + input GST",
                    "Requisition → RFQ → PO → GRN + QC",
                    "Three-way match catches mismatches",
                    "Returns, debit and credit notes",
                ],
            },
            {
                "image": "17-purchase-list.png",
                "title": "Purchase bills",
                "points": [
                    "PIN series, supplier, paid vs balance",
                    "Partial payments tracked per bill",
                ],
                "focus": [270, 220, 1150, 380],
            },
            {
                "image": "18-purchase-new-bill.png",
                "title": "New purchase invoice",
                "points": [
                    "Supplier bill number and date",
                    "CGST + SGST or IGST from the state",
                    "Stock in at weighted-average cost",
                ],
                "focus": [240, 118, 985, 775],
            },
            {
                "image": "19-purchase-procurement.png",
                "title": "Procurement and returns",
                "points": [
                    "Requisitions and RFQ comparison",
                    "GRN + QC passing before real receipt",
                    "Three-way match: PO ↔ GRN ↔ bill",
                ],
                "focus": [270, 230, 1150, 420],
            },
            {
                "image": "57-report-back-orders.png",
                "title": "Back orders",
                "points": [
                    "Order taken but stock not available",
                    "Chase purchase or reschedule delivery",
                    "Clean state today: nothing pending",
                ],
                "focus": [270, 220, 1150, 420],
            },
        ],
    },
    {
        "id": "05",
        "slug": "05-customer-jobwork",
        "title": "Customer Jobwork",
        "subtitle": "Inward → Job Card → Certificate → Invoice",
        "scenes": [
            {
                "kind": "chapter",
                "title": "Customer Jobwork",
                "points": [
                    "Customer material stays value-neutral",
                    "Inward → Job Card → Certificate → Invoice",
                    "Many job cards per inward, partial processing",
                    "Service invoice with SAC 998887",
                ],
            },
            {
                "image": "20-jobwork-inwards.png",
                "title": "Inwards — customer material in",
                "points": [
                    "JWI number, party, items and batches",
                    "Progress bar: processed vs total",
                    "Status: OPEN → COMPLETED → INVOICED",
                ],
                "focus": [270, 220, 1150, 420],
            },
            {
                "image": "21-jobwork-pending.png",
                "title": "Pending — what is left",
                "points": [
                    "Received / processed / remaining per item",
                    "Pending processes in one view",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "24b-jobwork-job-card-filled.png",
                "title": "New job card",
                "points": [
                    "Tick items, adjust qty and weight",
                    "Pick processes; party rate applies",
                    "Live estimate, 5% over-processing guard",
                ],
                "focus": [400, 100, 640, 760],
            },
            {
                "image": "24d-jobwork-certificate.png",
                "title": "Issue the certificate",
                "points": [
                    "CERT number becomes the work proof",
                    "Generate Invoice unlocks after this",
                ],
                "focus": [270, 200, 1150, 500],
            },
            {
                "image": "24f-jobwork-invoice-created.png",
                "title": "Jobwork invoice generated",
                "points": [
                    "Process-wise service lines, GST 18%, SAC 998887",
                    "Appears in Sales with JOBWORK source",
                    "New work = new inward",
                ],
                "focus": [270, 200, 1150, 480],
            },
        ],
    },
    {
        "id": "06",
        "slug": "06-manufacturing",
        "title": "Own Projects & Manufacturing",
        "subtitle": "Plan → Shop floor → Setup → Analyse",
        "scenes": [
            {
                "kind": "chapter",
                "title": "Own Projects & Manufacturing",
                "points": [
                    "Project → BOM → Work Order → Tasks → FG Receipt",
                    "MRP suggests BUY or MAKE",
                    "Capacity, OEE and costing on one floor",
                    "Your material here, customer's in Jobwork",
                ],
            },
            {
                "image": "25-mfg-projects.png",
                "title": "Projects",
                "points": [
                    "KPI cards: running, open WO, WIP, completed",
                    "Project-wise revenue vs cost later in Reports",
                ],
                "focus": [270, 230, 1150, 430],
            },
            {
                "image": "26-mfg-boms.png",
                "title": "BOM — Bill of Material",
                "points": [
                    "Output item, raw material qty per unit",
                    "Labour cost and standard minutes",
                    "Approve locks the revision; Revise to change",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "27-mfg-mrp.png",
                "title": "MRP — how much to buy, how much to make",
                "points": [
                    "Demand from orders exploded through BOM",
                    "Net against stock, open WO, approved PO",
                    "Nothing is purchased until you approve",
                ],
                "focus": [270, 220, 1150, 430],
            },
            {
                "image": "30-mfg-work-orders.png",
                "title": "Work orders",
                "points": [
                    "Priority, schedule, lines and task progress",
                    "Cost rolls up as material and labour post",
                ],
                "focus": [270, 220, 1150, 430],
            },
            {
                "image": "29-mfg-capacity.png",
                "title": "Capacity",
                "points": [
                    "Work-centre load vs shift capacity",
                    "Utilisation above 100% = work does not fit",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "34-mfg-oee.png",
                "title": "OEE",
                "points": [
                    "Availability × Performance × Quality",
                    "Read the caveat box before trusting 0%",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "35-mfg-costing.png",
                "title": "Costing — standard vs actual",
                "points": [
                    "Material, labour, overhead kept separate",
                    "Variance per work order",
                    "Overhead % is a policy switch",
                ],
                "focus": [270, 220, 1150, 450],
            },
        ],
    },
    {
        "id": "07",
        "slug": "07-inventory-accounting",
        "title": "Inventory & Accounting",
        "subtitle": "Stock truth and money in / money out",
        "scenes": [
            {
                "kind": "chapter",
                "title": "Inventory & Accounting",
                "points": [
                    "Ledger-driven stock, weighted-average cost",
                    "Lots, serials and adjustments with reasons",
                    "Payments allocated invoice-wise",
                    "Party ledger and chart of accounts",
                ],
            },
            {
                "image": "38-inventory-summary.png",
                "title": "Stock summary",
                "points": [
                    "In / out / closing, average cost, closing value",
                    "Matches the dashboard stock value",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "39-inventory-ledger.png",
                "title": "Stock ledger",
                "points": [
                    "OPENING, PURCHASE, SALES, JOBWORK_IN, reversal",
                    "Running balance with value",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "40-inventory-lots.png",
                "title": "Lots and serials",
                "points": [
                    "Batch-wise stock and serial numbers",
                    "Genealogy: what was built from which lot",
                ],
                "focus": [270, 220, 1150, 430],
            },
            {
                "image": "41-inventory-adjustments.png",
                "title": "Adjustments",
                "points": [
                    "Physical count variance, damage, scrap",
                    "Reason is mandatory, history stays",
                ],
                "focus": [270, 220, 1150, 430],
            },
            {
                "image": "42-accounting-new-payment.png",
                "title": "New payment / receipt",
                "points": [
                    "RECEIPT or PAYMENT, party, mode",
                    "Allocate against specific invoices",
                    "Unallocated balance becomes an advance",
                ],
                "focus": [400, 100, 640, 740],
            },
            {
                "image": "43b-accounting-party-ledger-filled.png",
                "title": "Party ledger",
                "points": [
                    "Opening, total debit, total credit, closing",
                    "Every voucher with running balance",
                ],
                "focus": [270, 220, 1150, 480],
            },
            {
                "image": "45-accounting-coa.png",
                "title": "Chart of accounts and journals",
                "points": [
                    "Debtors, creditors, GST, WIP, overhead",
                    "Journal vouchers validate Dr = Cr",
                ],
                "focus": [270, 220, 1150, 450],
            },
        ],
    },
    {
        "id": "08",
        "slug": "08-reports-gst-tally",
        "title": "Reports, GST, Tally & Audit",
        "subtitle": "Compliance and control",
        "scenes": [
            {
                "kind": "chapter",
                "title": "Reports, GST, Tally & Audit",
                "points": [
                    "Action Center: what needs you today",
                    "GSTR-1, GSTR-3B, trial balance, aging",
                    "Tally export: masters first, then vouchers",
                    "Append-only audit trail",
                ],
            },
            {
                "image": "47-reports-action-center.png",
                "title": "Action Center",
                "points": [
                    "Overdue receivables, pending tasks, low stock",
                    "Unbilled jobwork in one list",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "48-report-gstr1.png",
                "title": "GSTR-1",
                "points": [
                    "Choose the month, run the report",
                    "B2B rate-wise summary and B2C split",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "49-report-gstr3b.png",
                "title": "GSTR-3B working",
                "points": [
                    "Outward tax, purchase tax, net position",
                    "Books working — not a filed return",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "50-report-trial-balance.png",
                "title": "Trial balance integrity",
                "points": [
                    "Dr = Cr green banner means books are fine",
                    "Account-wise closing balances",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "51-report-outstanding.png",
                "title": "Outstanding and aging",
                "points": [
                    "Customer receivables, supplier payables",
                    "Invoice-level breakup for follow-up",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "53-report-pl.png",
                "title": "Profit and loss",
                "points": [
                    "Sales + jobwork income − purchases",
                    "Management snapshot, compare month on month",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "61-tally-export.png",
                "title": "Tally export",
                "points": [
                    "Step 1 masters XML, step 2 vouchers",
                    "REMOTEID means re-import updates, never duplicates",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "image": "62-audit-trail.png",
                "title": "Audit trail",
                "points": [
                    "Who did what, when — append-only",
                    "Filter and export CSV for the auditor",
                ],
                "focus": [270, 220, 1150, 450],
            },
            {
                "kind": "outro",
                "title": "Ab aap taiyaar hain",
                "points": [
                    "Daily: dashboard → post invoices → payments",
                    "Weekly: outstanding, certificates, tasks",
                    "Monthly: GSTR-1 / 3B → Tally → audit export",
                ],
            },
        ],
    },
]
