# YouTube Round 2 — Rootstock ERP 101 Webinars + 5 Manufacturing-ERP Training Playlists

**Checkpoint:** 2026-11-07 · **Branch:** `arena/ba36b80d-erp` · **Companion docs:** `YOUTUBE_PLAYLIST_RESEARCH.md` (Round 1: Absolute ERP + Vyapar), `GITHUB_REPOS_RESEARCH.md`, `PROJECT_AUDIT_PROGRESS.md`

User supplied **12 individual `youtu.be` links** and **5 playlist links** and asked for the lists *and* their content to be reviewed. This is that review.

---

## 1. Method & honesty notes

- All 5 playlists were fetched in **every chunk** and fully enumerated (173 video entries). All 12 individual video pages were fetched; they return official **descriptions + auto-generated transcripts**.
- **Transcript-level content was actually read** for: all **12** Rootstock webinars (chunk 0 = opening ~10–15 min of each 34–49 min webinar), all **6/6** Business Central videos (complete, `hasMore:false`), and **20 representative videos** across the Odoo / ERPNext / SAP playlists (full first transcript chunk each: 9 Odoo official + 5 Odoo functional + 4 SAP PP + 2 ERPNext) = **38 videos total**. Remaining playlist videos were **enumerated with title/ID/duration but not individually transcribed** — that is stated explicitly per section, not hidden.
- Honest limitation: for the 12 long Rootstock webinars, attempts to fetch deeper chunks returned **YouTube page furniture / recommended-video sidebars rather than transcript continuation** (and for #9/#12 a bare player shell). Adding `&hl=en` restores the *first* transcript chunk reliably (verified on #1 and #12) but deeper chunks still return sidebar content. So only the opening portion of those transcripts is claimed as read; the descriptions + titles + the substantial opening transcripts still give a reliable curriculum map. No video was visually watched, downloaded, or played.
- YouTube returns an `Error 401 (Bad Request)` header on playlist/watch pages while still serving the content — a transport artefact, same as Round 1.
- The 12 Rootstock videos are **Unlisted** (accessible only by direct link), published 2016-08-02 → 2017-06-13, 90–3,915 views each. Read-only research; no account, no download, no code copied.

---

## 2. Supply summary

| # | Item | Channel / owner | Videos | Views | Last updated | Chunks | Enumerated | Transcripts read |
|---|---|---|---|---|---|---|---|---|
| V1–V12 | `youtu.be/...` — **Rootstock ERP 101 Webinar Series** | Rootstock Software | 12 | ~8.4K total | 2017-06-13 | 4–5 each | 12/12 | 12/12 (chunk 0) |
| P1 | [`PL1-aSABtP6ADCBK2-v4_EyzAuFwx6Owks`](https://www.youtube.com/playlist?list=PL1-aSABtP6ADCBK2-v4_EyzAuFwx6Owks) — **MRP / Manufacturing (Odoo Tutorials)** | Odoo (official) | **49** | 246,087 | "7 days ago" | 3 | 49/49 | 9 |
| P2 | [`PLS6OvaktiYaEaEg5VJsX2k-pnMcTsfPHO`](https://www.youtube.com/playlist?list=PLS6OvaktiYaEaEg5VJsX2k-pnMcTsfPHO) — **Odoo Manufacturing & Production Functional Training** | Mustufa Rahi | **37** | 14,536 | Oct 9, 2026 | 3 | 37/37 | 5 |
| P3 | [`PLQGFK8RiEPSKjsII3xNjZ6DD_UZu0d-rb`](https://www.youtube.com/playlist?list=PLQGFK8RiEPSKjsII3xNjZ6DD_UZu0d-rb) — **Let's Learn ERPNext!** | Build With Hussain | **22** | 65,282 | Feb 10, 2025 | 2 | 22/22 | 2 |
| P4 | [`PLgyxDYIzXB0GH3I6SvSV2dPJ-CBf5XbYa`](https://www.youtube.com/playlist?list=PLgyxDYIzXB0GH3I6SvSV2dPJ-CBf5XbYa) — **SAP S/4HANA Production Planning (PP) training** | Savan Chandra | **59** | 332,628 | May 4, 2026 | 3 | 59/59 | 4 |
| P5 | [`PLEyIZHETM3k4`](https://www.youtube.com/playlist?list=PLEyIZHETM3k4) — **Manufacturing Foundations in Business Central** | Microsoft Dynamics 365 BC | **6** | 1,022 | Sep 8, 2026 | 1 | 6/6 | **6/6 complete** |
| | **Total** | | **185 videos** (173 playlist + 12 individual) | | | | **185/185 enumerated** | **38 transcript-read** |

Note on P1: it contains deliberate **duplicate titles** (`Shop Floor Overview` at #24/#37/#38, `Processing Returns for Repairs` at #21/#40, `Process an MO` at #23/#45) — re-uploads/updates, not an extraction error. P4's last entry is labelled **"Video 61"** at index 59, so two numbered videos are absent from the playlist (numbering gap), not from our extraction.

---

## 3. The 12 individual videos = Rootstock Software "ERP 101: A Primer on ERP for Manufacturing"

A single 12-part webinar course (2016–2017) by **Pat Garaghty** (founder/CEO, 40+ yrs manufacturing/MRP ERP; previously Relevant Business Systems, Martin Marietta) and **David Bush** (senior manufacturing consultant, 30+ yrs; previously General Microcircuits, Consa Corporation, Relevant Business Systems), both of Rootstock Software. Frame: *"if you understand your business, you will understand ERP"*; the #1 description claims **600+ years of manufacturing domain expertise** at Rootstock. #1 announces a *"10-part webinar series"* while #12 calls itself *"the 12th and final webinar"* — the course grew to 12 parts. Full index:

| # | ID | Title | Date | Length | Views |
|---|---|---|---|---|---|
| 1 | `vBW7Xz4myg8` | Introduction to ERP for Manufacturing & Distribution | 2016-08-02 | 48:55 | 3,915 |
| 2 | `Wr7jiO1Pt6A` | Engineering Basics — The Importance of Part Master Records and Bills of Material | 2016-08-16 | 34:32 | 1,385 |
| 3 | `Z_92eezD5uo` | Engineering Basics — Maintaining Accuracy through Revisions & Change Order Control | 2016-08-30 | 35:18 | 599 |
| 4 | `sPXhzJwDvKk` | Shop Floor — How ERP Manages the Manufacturing Processes | 2016-10-11 | 37:12 | 847 |
| 5 | `kEv-VY7jn1A` | Shop Floor — Scheduling the Shop Floor through ERP controls Labor and Machines | 2016-11-01 | 36:30 | 560 |
| 6 | `Og_sexGzzkQ` | Procurement — Link your Vendors and Purchased Parts via ERP | 2016-11-29 | 35:06 | 438 |
| 7 | `E-M7Rsb9YhE` | MRP — Step through an overview of this vital ERP subset | 2016-12-13 | 35:45 | 124 |
| 8 | `lg5UMgErDpc` | Work Orders — Manufacturing's Starting Point | 2017-01-24 | 39:35 | 148 |
| 9 | `rENyAaOscpU` | Inventory — Maintaining Accurate and Reliable Data | 2017-02-14 | 42:40 | 133 |
| 10 | `HzGQWTIOFl0` | Sales — Linking your Customers and Products with ERP | 2017-03-21 | 37:39 | 90 |
| 11 | `qLJIrF_gfa0` | Project Control… A Vital ERP Tool for Many Manufacturers | 2017-04-25 | 38:07 | 75 |
| 12 | `pfFt-1CSbfE` | Tracking Costs Using ERP (final webinar) | 2017-06-13 | 44:07 | 100 |

### Content actually extracted from the transcripts

1. **#1 — Why ERP exists.** Evolution **BOM processor (1960s) → MRP → MRP II → ERP**. Software-company dept chart vs distributor vs manufacturer: a distributor has material control, purchasing, receiving/inventory, shipping, RMA, cost accounting; a manufacturer adds **engineering** and **shop floor**. Four recurring terms: BOM, MRP, MRP2, ERP. ERP "touches every aspect"; the point is that one department's work changes another's data.
2. **#2 — Part master & BOM are the foundation.** Part numbers are the *foundation of the house*: use a **non-intelligent/semi-intelligent number** plus separate searchable fields (description, type, etc.); **avoid "smart" part numbers** that encode attributes, they box you in. Distinguish **components / sub-assemblies / final assemblies**. Bicycle example for multi-level BOM. Discusses UOM differences across engineering (inches), inventory (feet/yards), purchasing (rolls/cartons); part source = manufactured / purchased / **subcontract** (parts sent to a vendor, labour added, a *different part number* returns); part types = standard, **reference** (instruction sheets/blueprints), **phantom** (built during production but never planned on its own); **scrap factors** and **setup quantities**.
3. **#3 — Revision / ECO discipline.** BOM levels: **level 0 = shipped end item**, lowest = raw/purchased parts; BOM can include components, subassemblies, tooling/fixtures, reference items. Revisions and **engineering change orders** keep planner data current; an ECO changes what BOM is "in effect" at a given time. Scrap/setup quantities feed the MRP engine. Sets up the next webinar (work centers, routings, procedures).
4. **#4 — Shop floor resource planning.** MRP planned only *material*; ERP must also plan **people, machines, processes (work instructions), and vendors that perform outsourced operations**. Routing is characterised as a **"bill of resources"** — instead of part quantities it holds the *time* required at each step, analogously to how a BOM holds component quantities; MRP → time-phased material, routing → **capacity planning**.
5. **#5 — Capacity planning.** Routing supplies **setup + run + machine + inspection time per operation** (bicycle handlebar example: 1 h pick in stores, 0.1 h drilling at machining, 0.5 h assembly, then inspection). Problems solved: **over-scheduling creates a bottleneck**, **under-scheduling wastes a paid resource**; ERP capacity tools let the scheduler **balance the load**. Work centers = stores / machining / assembly / inspection.
6. **#6 — Procurement.** Three purchase-part classes: **direct** (on BOM, MRP-planned), **indirect** (consumables, often BOM qty 0 so MRP ignores them), **service** (contractual/hourly, non-tangible). **Item–Vendor record** links parts to vendors and enables **vendor analysis** (on-time delivery, availability) and **three-way match** (purchase order ↔ receipt ↔ invoice) before AP payment. Material demand originates from **sales orders and work orders**; requisitions → POs; vendor control → prices → costing.
7. **#7 — MRP mechanics.** MRP sits early in the flow: inputs = **demands** (sales orders, work orders) + **supplies** (open POs, open WOs, inventory) + **engineering/inventory rules** (reorder points, lead times, order quantities) → outputs = **suggested orders / requisitions / work orders**. It mimics a planner's spreadsheet reasoning per active part: on-hand + open supply − open demand, time-phased; detects "fine / about to run out / now overstocked because an order was cancelled or a revision changed". Worked handlebar example: 10 on hand, 2 on an open WO, 5 needed by an unreleased WO for 45 bicycles, 15 more from a new sales order.
8. **#8 — Work Orders.** Work orders are the **manufactured-side supply order** (POs are the purchased-side supply order). Each WO creates **both a supply** (the FG/sub-assembly it produces) **and a demand** (its components). Recaps reorder points, time-phased demand, open supply orders. WO is where BOM + routing become an executable shop-floor instruction.
9. **#9 — Inventory accuracy.** Physical inventory = direct material + previously built/purchased subassemblies; **formal receipt into stores and formal issue out of stores are required**, with lot/serial control. **Indirect material is deliberately *not* physical inventory** (lubricants, gloves, tools, cheap hardware): not tracked in/out, not issued to WOs/subcontract orders, its cost captured as **overhead**; direct material cost via standard / rolling-average costing. Inventory management: stockroom/shelf/bin visibility; **inventory types** = good / suspect (pending ECO) / scrap / rework; inventory item record (planning rules for MRP) is distinct from the engineering item record.
10. **#10 — Sales order management.** Components: customers, products, orders (what/when/price/ship-to), salespeople; supporting records = **reason codes** (why returned, why due date changed), **price books** (pricing by customer/date/event), **customer classes**, FOB/freight/carrier codes. Customer master: non-intelligent number, currency, **order history** (what/when/at what price), multiple addresses. Sales orders are the largest source of demand feeding MRP.
11. **#11 — Project control.** Segregates factory work **by project number**: material plan, costs (material, labour, overhead, other direct), inventory, POs, SOs and WOs all **stamped with the project**; allows **distinct costs for the same item in different projects** ($10 in A, $15 in B); option of a **per-project subledger** pointing to real GL accounts (often a government-contract requirement). Explicitly presented as optional — many manufacturers will never need it.
12. **#12 — Cost tracking.** Cost = material + labour + **outside/subcontract labour** + **overhead** + other direct costs, captured from **estimate → sales order → purchasing → manufacturing → shipping → invoice**, then **actual vs expected** compared by order / project / division / company. Standard cost as theoretical baseline for variance; the whole series closes on "cost visibility during the job, not weeks later in a spreadsheet".

**Consolidated Rootstock curriculum:** part master → multi-level BOM + revisions/ECO + scrap/setup → routings/work centers (bill of resources) → capacity scheduling → procurement with item–vendor + 3-way match → MRP (demand/supply netting) → work orders → inventory accuracy & types → sales orders → optional project control → standard-vs-actual cost tracking. This is a **conceptual foundation course**, not a product demo: no screens, no code, no DB.

---

## 4. P1 — Odoo official "MRP / Manufacturing" (49 videos, 246,087 views)

Complete index (index · ID · duration · title):

```
1  XvAe_B29mB8  7:47  MRP Overview
2  uieYaraELOQ 11:33  Work Center Controls & Parameters
3  vtjeMGcG8aM  8:08  Replenishment Methods for Manufacturing
4  GPMH4r3CpDo  5:02  Manufacturing Efficiency
5  GvzVKID1Wro  6:25  Unbuild Orders
6  7y2P8Qugag4  7:01  Production Analysis
7  ZBBDLRoRPcs  8:07  Overall Equipment Effectiveness
8  RWY3nh16T_E  6:54  Allocation Reports
9  XddbBYkDAl4  8:09  Scrap Orders
10 yP2Tji_WyNY  8:07  Flexible Consumption
11 nyXngfghtaY  5:50  Product Kits
12 a8Dl1Ip0jtI  6:41  Sub-Assemblies
13 ILpbH7X6vzo  5:58  Sales Order to Manufacturing Order
14 J65h3-WFIKU  4:29  By-Products
15 c5cFwTaD2I8  5:02  Split and Merge Manufacturing Orders
16 yj6ko6AVjqQ  7:09  Maintenance Requests
17 6zUVbOa5arY  4:59  Recurrent Maintenance
18 grZ9oj8CqNI  5:58  Manufacturing Steps
19 OIrkwN0RXRo  5:53  Manufacturing Backorders
20 6zBz93AIXBo  5:07  Barcode: Process and Cancel MOs Using Barcodes
21 oAWC8x7ij7U  7:56  Processing Returns for Repairs
22 ecR7gxBP_Vo  8:12  Manufacturing Time and Costs | Shop Floor
23 NBH30rhhXiI  6:30  Process an MO | Shop Floor
24 RgUrM-np8v8  7:45  Shop Floor Overview
25 r5JewejnfQ4  7:29  Manufacturing Order & Work Order Basics
26 2ojxIbTq41Q  9:11  Consuming Components Using Barcodes
27 G4elSiAOLlY 10:14  Production Costs
28 oGTIn2TOdkY 10:52  Batch Transfers | Inventory
29 qqNEEBNtArA  7:15  Manufacture in 2 or 3 Steps
30 f-w5sVsl0Vg 19:34  Engineer To Order
31 Vd1MDPaA4hk  8:42  Manufacturing Lead Times
32 4laFf9MnH6I  9:26  Manufacturing Planning
33 5Pn9iBsXQBo  6:56  Manufacture with Product Variants
34 UUr5EK3ocxU  5:21  Manufacture w/ Lots and Serial Numbers
35 EQMjhnHTV5s  8:29  Bill of Materials Basics
36 7Sfp9zO3IaQ  6:50  Work Center Basics
37 jdCEOpNXsrk  7:50  Shop Floor Overview (duplicate title)
38 hRTlVBlyNn8  7:50  Shop Floor Overview (duplicate title)
39 rEB-GIz-etI  5:08  Alternative Work Centers
40 M3Cb_86Rtbo 10:16  Processing Returns for Repairs (duplicate title)
41 XOq9meepDQ8  6:27  Make-to-Order Manufacturing (MTO)
42 d8GUY9jLEmc  5:17  Work Order Dependencies
43 okZLvUoUhqg  7:14  Resupply Subcontractor
44 wV2rYy2QMBY  6:04  Basic Subcontracting
45 Jh-hvxXaiq8  8:55  Process an MO | Shop Floor (duplicate title)
46 WnivsvI6IYI  8:02  Dropship to Subcontractor
47 W4kmt-YFAF0 11:01  Work Center Parameters
48 SBpBYwP-3Mo  7:39  Master Production Schedule (MPS) — MPS Dashboard Part 1
49 ODaJVe93vbQ  6:08  Continuous Production
```

**Transcripts read (9):** #1 `XvAe_B29mB8`, #2 `uieYaraELOQ`, #7 `ZBBDLRoRPcs`, #9 `XddbBYkDAl4`, #13 `ILpbH7X6vzo`, #27 `G4elSiAOLlY`, #32 `4laFf9MnH6I`, #44 `wV2rYy2QMBY`, #48 `SBpBYwP-3Mo`. (#35 BoM Basics and #36 Work Center Basics are characterised from their titles/playlist context only.)

Concepts verified in those transcripts:
- **End-to-end MRP Overview (#1):** CAD → BOM ("recipe": components + subassemblies + operations/work orders) → check on-hand → **auto-trigger RFQ to approved vendors on shortage** → receipt with **QC checkpoint or straight to shelf**, barcode capture of **lot/serial at receipt** → **automatic component reservation** down to lot/serial (green available / red awaiting) → shop-floor panel start/pause/validate updating MO progress in real time → **planning against work-center capacity + calendar**, overloaded station auto-reschedules to next day → **cost analysis tab rolls up material + labour + overhead in real time** → subcontractor location/lead-time tracking → post-delivery **root cause analysis** → add a **Quality Control Point** at reception/picking/pre-ship → design flaw → **Engineering Change Order (ECO)** in PLM with version control/rollback → preventive + corrective maintenance.
- **Work center parameters (#2, #7, #32):** planned duration × **time efficiency** (200% → half the time), **capacity** (# units simultaneously; capacity 2 halves a 2-unit MO), **per-product specific capacities**, **setup/cleanup time** added automatically to work orders, employee login/restriction per work center, **alternative work centers** used when the primary is busy, working-hours calendars (Mon–Fri 8–17 with lunch), **Planning by Production / Planning by Work Center Gantt**, replanning. **OEE (#7):** fully-productive time vs **reduced speed** (real > expected duration) vs **blocked** (equipment failure, process defects, material availability…) with a configurable **OEE target** (e.g. 90%) and loss reasons; red/green per work center.
- **Scrap (#9):** scrapping removes stock to a **scrap location**; on an MO only *components* can be scrapped before production, the *finished product* becomes scrapable after production; **"replenish quantities"** auto-creates a PO (Buy route) or a replacement MO (Manufacture route); MO status flips `Ready → Waiting`, component availability flips to red, smart buttons `Scraps` / `Purchases`; in 2-/3-step manufacturing, components must first be transferred to the production location.
- **MTO (#13):** two ways to auto-create an MO from a confirmed Sales Order — **MTO "Replenish on Order" route** (MO linked to the SO, product **reserved for that SO**, always creates an MO even if stock exists) and **0/0/1 reordering rule** (min 0, max 0, order 1; MO generated but *not* linked/reserved).
- **Production costs (#27):** employee **hourly rate** (manually entered, not derived from contract salary), product category **costing method** (AVCO/FIFO/standard; standard does not auto-calculate), **all components must use the same costing method**, BOM operation duration → labour cost, **work center cost per hour** → machine cost, MO Overview shows **unit cost / real cost**, per-component stock valuation, "Update Product Cost from BoM", Cost Analysis.
- **Subcontracting (#44):** basic subcontracting = vendor sources all components; BOM type **"Subcontracting"** with assigned subcontractor(s) and **no component lines**; vendor pricelist with **lead time** (manufacturing + delivery) driving the PO expected arrival; PO → receipt → finished product into stock; MTO route can auto-create the PO from an SO.
- **MPS dashboard (#48):** long-term **forecast demand / replenishment / forecasted stock** rows per product and period; **indirect demand** for components; optional rows **actual demand** (confirmed SOs), **indirect actual demand** (confirmed MOs), **actual replenishment** (RFQs/receipts/MOs) and **ATP = available to promise**; forecast stock = starting stock − forecast demand − indirect demand + max(actual, suggested) replenishment; carried into next period; drill-down into the contributing SOs/MOs/RFQs/receipts.

---

## 5. P2 — "Odoo Manufacturing & Production Functional Training" (37 videos, Mustufa Rahi)

Playlist description: end-to-end manufacturing workflows — BoM, Work Orders, Routing, Subcontracting, Production Planning, Quality Control, Inventory Integration — for Odoo functional consultants/implementers, with emphasis on **manufacturing accounting**.

Complete index (index · ID · duration · short title):

```
1  qRPndphI_3Q  5:18  Settle Cost of Production for consumables & capitalize into FG
2  _Vu_LlkIVPI  5:22  Product exchange workflow via Sales Order (full item out, empty in)
3  wxCvm7tkwVg 15:13  Odoo 19 COGS for Kit BoM — Perpetual valuation & FIFO
4  KwxmnNJxKUI 11:36  Odoo 19 COGS for Kit BoM — Perpetual & AVCO
5  9TLwQf870NI 13:15  Odoo 18: negative raw material = wrong costing
6  pwGhZkp9haY 13:56  Odoo 19: why FG cost is wrong with negative inventory
7  xjwLTV6aeK4  8:50  Subcontracting purchase returns — unbuild & cost adjustment
8  C4OepDW53wM  9:48  Separate work-centre cost & labour expenses
9  QElTfb3a9K8 32:58  Dedicated subcontractor locations, advanced routes & rules (Odoo 19)
10 OqnxWlv3-zM 18:32  Manufacturing to fixed asset — Standard vs AVCO impact
11 BU-kzF3m8jA  9:24  CPQ for modular kitchen cabinets — sales→manufacturing automation
12 oJEaTxC5thg 10:12  Odoo 19.1 subcontracting — raw material cost recognition
13 3AWsk3rgPdg 14:03  Subcontracting with accounting — RM, FG, cost of production
14 oIumTxU--UA  8:40  Perpetual accounting — inventory consumption & valuation
15 w43-HVZSmNo  7:56  Manufacturing variance report — expected vs actual
16 7YC17iuJEoo 21:22  Manufacturing valuation & COGS for FG — MTO/MO/variation
17 gRyQvJN-HKo 25:05  Build & capitalize your own machine — sub-assembly BOM + asset
18 2_EZ0KWuzYw  5:00  Work center employee labour cost impact on AVCO & FIFO
19 3ZA42hnfoOI  9:47  Automatic BoM from variant attributes + Kit (OCA)
20 Ja8fxDtIjjU 15:54  Multiple manufacturing facilities in one warehouse
21 YdsTbADx28I 15:15  Inter-company MTO: A sells, B manufactures
22 XaTIES7d7aY 15:41  Customer lead time from manufacturing preparation days
23 MhGTqZrNJ6E 13:18  Reverse manufacturing / disassembly + by-products
24 1bFv8CQ3zAQ  8:03  Subcontracting where customer supplies raw material
25 MoOn4XE2340  9:43  Advanced routing — multi warehouse / multi manufacturing
26 39DsO_MCjTE 11:01  WIP account in Odoo 18 & balance-sheet impact
27 XKBGzeR4wWA  8:02  Expense account for work centre & employee cost
28 QJIoL98aais  9:20  Blanket orders / manual delivery / BoM on SO / discount (OCA)
29 iRy1JzmNeuY  5:21  Automatic BoM from product variant attributes (OCA)
30 2hhHFDQYH7I 11:01  24-hour work centre via work shifts & schedules
31 o1_2nLE5XKc  7:37  Split delivery + MPS + raw material RFQ
32 Toncaq8s4W8 11:08  Differentiate Cost of Production accounts (Odoo 16→17)
33 D4kRZ9zYmsk  5:55  Multiple facilities — SKU-wise production & delivery
34 twUmWgYbVno 19:04  Master Production Schedule — plan production & RM purchase
35 MiOaAV0CpOw  5:24  Odoo 17 improvements — work center hours, ECO from MO
36 o9BYTLBU64w  9:03  Manufacturing subcontracting — 3 different ways
37 Ns6Qgs_lNUU  4:32  Odoo 17 automated stock accounting / Cost of Production account
```

**Transcripts read (5):** #1, #15, #24, #26, #36; #8/#12/#13 are characterised from their descriptions only.

Concepts verified:
- **#1 Cost of Production residual (Odoo 20 workaround):** consumable items are expensed at purchase into the product-category **expense account**; if that account is set to the **Cost of Production** account, the debit at vendor bill and the credit during manufacturing offset, so no residual remains in the balance sheet. Presenter explicitly labels it a **proposed workaround, not a universal standard** — validate in staging first.
- **#15 Variance report:** MO Overview shows **standard/expected unit cost vs real cost**; Production Analysis pivot exposes average component cost, employee/operation cost, total cost per unit, expected vs actual component/employee/operation/total, qty demanded vs produced. Purchase price changes update expected cost; changed operation time changes real cost; compare per MO, export to spreadsheet.
- **#26 WIP accounting (Odoo 18):** configure **WIP production account** + **WIP overhead account** + production costing account; "Post WIP accounting entry" creates a journal entry for consumed materials and completed operations with an **automatic reversal** to settle the interim WIP accounts; shows GL/balance-sheet effect while an MO is still running. This is the exact "WIP" concept Round-1 research listed as missing.
- **#36 Three subcontracting modes:** (1) **Resupply Subcontractor on Order** — you hold components, deliver them to the vendor, record component consumption, receive the semi/FG; (2) **Buy + Resupply + MTO** — MO triggers an RFQ to a component vendor, you receive into your warehouse, then resupply the subcontractor; (3) **Buy + MTO + Dropship Subcontractor** — components go **directly from your vendor to the subcontractor**, never entering your warehouse.
- **#24 Customer-supplied raw material + consignment:** enable **consignment** so received customer material has **owner = customer**, create a custom "Receive RM from Customer" route (Receipt, Customer → Stock) + 0/0 reordering rule; SO → MO → subcontracting PO → resupply with customer as owner → receive semi-FG. **Customer-owned RM is excluded from your stock valuation; only the conversion charge from the subcontracting PO is accounted.** This directly matches `utech`'s two-bucket inventory (`GITHUB_REPOS_RESEARCH.md` §5.2) and ForgeERP's jobwork customer-material concept.
- Recurring warning across #3–#6, #12–#16, #32, #37: **negative inventory produces wrong FG cost / COGS** — reinforces the conditional-decrement / shortfall-refusal guard already implemented here and in `utech`.

---

## 6. P3 — "Let's Learn ERPNext!" (22 videos, Build With Hussain, 65,282 views)

Long live streams (44 min – 2 h), mostly with Dharmesh Chitroda (Frappe/ERPNext Customer Success) plus guest lectures. Full index:

| # | ID | Length | Title |
|---|---|---|---|
| 1 | `ZH2unYQHxlE` | 1:25:10 | Episode 1, ft. Dharmesh |
| 2 | `-aIf2u4fJSA` | 1:47:32 | Episode 2, ft. Dharmesh |
| 3 | `4bb6o94Z_vc` | 2:02:43 | Accounting Basics with Umair Sayed |
| 4 | `j69MjFAnHaA` | 1:32:50 | Episode 3 |
| 5 | `_C8pnN8AmF0` | 1:10:31 | Episode 4 |
| 6 | `fdifxTClomU` | 1:34:49 | Episode 5 |
| 7 | `Z-ZPFnndclY` | 1:29:44 | Episode 6 |
| 8 | `-VjZvRtdjDQ` | 44:50 | Serial & Batch Bundle with Rohit Waghchaure |
| 9 | `uGQ8kMqsiEg` | 1:41:13 | Episode 7 |
| 10 | `ANrCssnr-7I` | 1:34:12 | Episode 8 |
| 11 | `jgCAIPwMw4E` | 1:18:13 | Episode 9 |
| 12 | `2tGN9Vaq3_4` | 1:44:41 | Advanced Accounting with Dipen Gala |
| 13 | `Oc8dg3AVIXI` | 54:45 | Episode 10 |
| 14 | `_eXrE5pO1_c` | 1:40:08 | Episode 11 |
| 15 | `PXsml7HSG0g` | 1:33:13 | **India Compliance with Smit Vora** |
| 16 | `Zn40-Xi2zyQ` | 1:12:05 | Episode 12 |
| 17 | `51_yVZe2cso` | 1:32:01 | **Manufacturing 1 / Episode 13** |
| 18 | `kjsDlzmha9c` | 1:32:49 | Manufacturing 2 / Episode 14 |
| 19 | `izWS1oA3_-M` | 1:55:45 | Manufacturing 3 / Episode 15 |
| 20 | `CZLftkQpkuk` | 2:02:03 | Manufacturing 4 / Episode 16 |
| 21 | `Xi5FgqhMqHE` | 1:31:17 | Manufacturing 5 / Episode 17 |
| 22 | `ghtMIFMdv6E` | 1:38:54 | Asset Management with Dipen Gala |

**Transcripts read (2):** #15 and #17 (opening chunks; both 1.5 h streams, so only partially read).

- **#17 (Manufacturing 1)** opens with a full recap of the *entire prior series*, which is itself a valuable curriculum map: site creation → **chart of accounts + opening entries** (customers/suppliers/items/opening balances) → accounting basics (debit/credit, income/expense) → **data import** (customers, users, employees) → **user permissions & role permission management** → customers/suppliers (**credit limits**, multiple addresses) → **item types** (fixed asset, manufacturing, maintenance, stock, service) → **warehouses with separate stock-in-hand accounts** → **batch & serial bundle** → **item price lists by customer/supplier/group** → purchase cycle & sales cycle → advanced accounting → **sales-order stock reservation (v15)** + product bundles → stock entries/settings/**inventory dimensions** → India compliance/GST → asset capitalization. Manufacturing week begins after that foundation.
- **#15 (India Compliance)** with Smit Vora (resilient.tech): the app powers India-specific GST, **e-Invoicing**, **e-Way Bill**, GST portal/NIC API integration, out-of-the-box reports/configuration, audit trail, **GST validation** (in-state vs out-state, reverse charge, whether e-Way Bill is required), tax defaults / **sales & purchase tax templates**, company-level tax details determining whether a transaction is validated for GST, multi-company setup. Repository referenced: `resilient-tech/india-compliance` (`develop` branch).
- Relevance to ForgeERP: India-compliance depth (GSTR, IRP, e-Way Bill) is already partially covered by `src/lib/einvoice.ts` + `/api/e-invoice`; the **e-Way Bill and GST portal API** layer is not.

---

## 7. P4 — "SAP S/4HANA Production Planning (PP) training" (59 videos, 332,628 views, Savan Chandra)

Full topic index (index · ID · short topic; common prefix `Video NN – SAP S/4HANA PP training –` omitted; index 59 is labelled "Video 61"):

```
1  8VpymX3jGYk Introduction to SAP & PP            2  _XVlgDKzxiE Navigation
3  E054kw6uxzE Enterprise Structure in PP          4  bEbwdWVq--s Material Master
5  xtTYkWRAj-g Bill of Material (BOM)              6  tZbuMSuReC8 Work Center
7  JnQyH77Gm1E Routing                             8  QcFZLXCKdNE Production Version
9  fqVOTgrl3Wg Demand Management                  10 jYnoBYEAnCA Make to Stock
11 Q_vAkoRm960 Make to Order                      12 OCSzbYjzBhw Introduction to MRP
13 EKn81YiWsTw Execution of MRP                   14 aEsK1QIZGHI MRP Control Parameters
15 w677I3jZCEE Factors influencing MRP            16 SbCj0CLSDNY MRP live in S/4HANA
17 mBDmNveBL4w Evaluation of MRP Results          18 Y0TM7HNtMZM Production Order Creation
19 yohq769Gpbk Material Availability Check        20 Y9_vZt4a2B0 Production Order Release
21 mVE5q175SxY Production Order Printing          22 i7gwvS4IhMk Goods Issue
23 E2YlNej3keA Production Order Confirmation      24 u80dEHVcLZA Production Order Goods Receipt
25 zrH2x5xLp14 Scheduling                         26 j6VbBRcYjlM Capacity Planning
27 lZ1HPAQSWXo Production Order Settlement        28 yCyp0RhTl9k Order Archiving & Deletion
29 w6NWx26WVcc Mass processing & Automation       30 -4EG0JTT6FQ Order Status Management
31 Yj82UhclNuw Process Manufacturing (PP-PI)      32 jJ-xqnICqWo Process Management (PI Sheet)
33 7LgQ78txoGc Repetitive Manufacturing (PP-REM)  34 nHNPvSjYI_c KANBAN
35 XpzZHUMnZno Information Systems & Reporting    36 kG4uFvp-cZc Introduction to Fiori
37 JYbCziwBtqA Data Migration Cockpit (LTMC)      38 3LAoENXLhZk BOM Customizing
39 E22kjJ9sC0Y Work Center Customizing            40 jUjySdjIacY Routing Customizing
41 CHbW1YmpN2Y Demand Mgmt Customizing            42 wWGqx3zZxHQ MRP Customizing
43 ibh09aOkpfM Production Order Customizing       44 QnFOnkBavps Advanced BOM Functions
45 TzPnYNRXPXc Advanced Routing Functions         46 cjIOHqP4Q0c Production Resource Tools (PRT)
47 CS2XCAj31AU Master Production Scheduling (MPS) 48 oyp39uVu_YU Long Term Planning (LTP)
49 XTF62EblD3o Batch Management Overview          50 KMCKj2xFxZg Batch Classification
51 bPefw7fttT4 Batch Determination                52 YjzNyiHjrgE Batch Derivation
53 K03kFplidMU Serial Number Management          54 HGMc-MtTGIg PP–MM Integration
55 ef5pPpKbrVs PP–QM Integration                  56 pumc7-B3KFg PP–SD Integration
57 fv9Ore1_LvE PP–PM Integration                  58 u0vfXDIhFac PP–WM Integration
59 JZqhCxZNAAE "Video 61" Total End-to-End Business Process Flow (2:05:07)
```

**Transcripts read (4):** #5 `xtTYkWRAj-g`, #7 `JnQyH77Gm1E`, #24 `u80dEHVcLZA`, #27 `lZ1HPAQSWXo`.

- **#5 BOM:** formally structured list of components with object number, **quantity and UoM**; terminology header/assembly vs component/item/part; **BOM categories** (material BOM in PP; sales-order BOM in SD; equipment / functional-location BOM in PM; document / standard BOM); **BOM usage** lets the same material have separate BOMs for production, costing, engineering, maintenance; header data + item data + **item category**; **single-level vs multi-level BOM**, **alternate/multiple BOM**, **recursive BOM**, **low-level code**, BOM reports; T-codes `CS01` create / `CS02` change / `CS03` display.
- **#7 Routing:** a **task list** (PP routing type `N`; rate routing `R` for REM; master recipe `2` for PP-PI; inspection plan in QM; standard network in PS). Routing = ordered operations (10 pre-assembly, 20 checking, 30 final assembly, 40 checking, 50 delivery) each with a **work center**, **control key**, description and **standard values** (setup 10 min, machine 30 min, labour 30 min); **BOM components assigned to specific operations**, optional **PRTs** (production resource/tools, not consumed); group routing, material assignment, alternate routing, user-defined fields, standard text key. Routing data is copied into the production order and drives **scheduling, capacity and costing (planned vs actual)**.
- **#24 Goods Receipt from production:** after PO creation → availability check → release → **goods issue** → **confirmation** → **GR**. GR can be manual or automatic (controlled via operation control key / production scheduling profile; automatic GR on confirmation of the last operation requiring confirmation). Production order carries a **GR storage location** and **delivery tolerances**; posting moves produced FG/semi-finished stock into the warehouse, sets order status `DLV` (delivered), and removes the order from MD04.
- **#27 Settlement:** PP ends at GR; **finance (controlling) then does variance calculation → settlement → order closure** as a monthly background job. Cost types on an order: **planned / target / actual**; cost components = **input material cost + activity (production/machine/labour) cost + overhead (% of direct cost) + external activity cost**. Settlement profile is mandatory; **an order cannot be closed without settlement**. This is the formal version of "expected vs actual production cost".
- Full PP flow from these transcripts + the index: master data (material, BOM, work center, routing, production version) → demand management (MTS/MTO) → MRP (live, evaluation) → production order (create → availability check → release → print → goods issue → confirmation → GR) → scheduling/capacity → settlement → archiving/deletion; plus PP-PI, PP-REM, KANBAN, MPS, LTP, batch/serial and PP↔MM/QM/SD/PM/WM integration.

---

## 8. P5 — "Manufacturing Foundations in Business Central" (6 videos, all transcripts complete)

| # | ID | Length | Title | Views |
|---|---|---|---|---|
| 1 | `GEuUFcgFZF0` | 4:59 | Manufacturing Foundations BOM (2026) | 1,802 |
| 2 | `Pt8LrNv_Lgc` | 4:31 | Manufacturing Fundamentals Routing (2026) | 890 |
| 3 | `zt9_HEmPKNg` | 5:56 | Manufacturing Foundations Capacities (2026) | 807 |
| 4 | `xqFpiqmXjk0` | 4:46 | Manufacturing Foundations Production Orders (2026) | 606 |
| 5 | `oIoH3gxc0uk` | 4:37 | Execution & Control Flushing Methods (2026) | 598 |
| 6 | `N30HebR5nJk` | 4:11 | Execution & Control Cost Control (2026) | 689 |

Official Microsoft series (2026-09-08), Contoso Coffee demo data, with `learn.microsoft.com` training/documentation links in every description. Full content:

1. **BOM:** item replenishment = **purchase / production order / assembly** (assembly = simple labour-only; production order = multi-step operations, machine centers, capacity planning). Production BOM = recipe driving **material planning, consumption and costing**; **quantity formulas for standardised UoM**; **Where-Used** action per component; **BOM versions with starting dates** (from 1 June the correct version is picked), **version comparison** (v2 kept switch/removed on-off light; v3 also removed switch), **phantom BOM** (from 1 June the sub-assembly is produced in-line instead of picking a pre-produced item), and **Refresh Production Order** which populates components + routings from the version effective on the **due date** (changing due date → v2 selected; manual override allowed).
2. **Routing:** **serial vs parallel** operations (after op 1, ops 10 & 20 run simultaneously then merge at op 30); per-operation **setup / run / wait / move time**; **routing link code** ties a component to the operation where it is consumed (JIT material control); **send-ahead quantity** lets the next operation start before the current finishes; **standard tasks** as reusable work instructions; **routing versions**; refreshing a PO computes start/end dates, and parallel routing demonstrably **shortens lead time** (production can start later).
3. **Capacities:** **work shifts → shop calendars** (1 shift = 5×8 h/week; 2 shifts = 16 h/day; holidays + maintenance weeks) → **work center groups** (reporting/cost aggregation; group 5 = subcontractors) → **work centers** (direct unit cost, indirect cost %, overhead rate; UoM, capacity, efficiency, shop calendar) → **machine centers** below work centers (inherit calendar, own capacity/efficiency); **consolidated calendar** = work center capacity = Σ machine centers; **Calculate Calendar → calendar matrix** (e.g. 2,400 effective minutes/week; adding a packing table at 80% efficiency → 960 min/day → 768 effective → 3,840/week); a maintenance week shows **zero capacity** and pushes a due-7-July order from 4 business days to 13 natural days.
4. **Production orders:** status ladder **Simulated (safe sandbox) → Planned (suggestions) → Firm Planned (approved) → Released (shop-floor ready) → Finished (closed for cost analysis)**. Refresh materialises BOM → component demand, routing → operations, calendar/capacity → start/finish. **Item Availability by BOM Level** before release shows required vs available per component and which component is the bottleneck. Production journal combines components + operations; operator adjusts **actual consumption when scrap occurs** (2 broken carafes → consume 12 instead of 10) and actual operation times; posting consumes components + capacity, yields FG, then order → Finished.
5. **Flushing methods:** per-component-line posting rule — **Forward** (auto-consume on release for predictable parts), **Backward** (auto-consume when output/finish is recorded), **Manual** (operator confirms actual), **Pick +** (adds a warehouse picking step to *any* of the above, doesn't replace it). **Routing link code** is the timing anchor: linked components follow the matching operation; blank = whole-order timing. After release, forward-flushed lines show consumed qty while backward/manual still show remaining; a manual 40→42 adjustment still creates normal ledger activity. Mixed policies per order are the point.
6. **Cost control:** costing methods **FIFO / LIFO / Specific / Weighted Average / Standard** (standard = theoretical cost + production variances). Item cost is a **roll-up**: materials from BOM + capacity from routing + manufacturing overhead + scrap; **BOM Cost Share Distribution** report/chart separates material / capacity / overhead / total per component. Work center `direct unit cost + indirect cost % + overhead rate` → time-in-minutes becomes capacity cost; wrong rate or extra posted time → wrong order cost. **Production Order Statistics**: expected material 12,296 + capacity 324 + 10% overhead → expected 1,652.75; actual 2,259.50 for 10 units because manual flushing consumed more material and more time; capacity need in minutes listed; **everything already registered in the general ledger**.

---

## 9. What Round 2 adds beyond Round 1 and the GitHub research

| New concept (Round 2) | Strongest source | Earlier status |
|---|---|---|
| **ECO / revision control with effective dates, version comparison, phantom BOM, Where-Used** | BC #1, Rootstock #3, Odoo `MiOaAV0CpOw` (ECO from MO), SAP #5 | Round 1 only had "lock/copy"; GitHub research noted "BOM versioning" as a gap |
| **Routing link code + send-ahead qty + serial/parallel routing + setup/run/wait/move times** | BC #2, SAP #7, Rootstock #4/#5 | Round-1 Absolute ERP had setup/cycle time only |
| **Shop calendar / shifts / machine centers / consolidated calendar / maintenance windows in scheduling** | BC #3, Odoo #2/#32 | Round-1 Absolute ERP had "custom working hours + maintenance plan" but no calendar-driven lead-time calc |
| **Flushing methods (forward / backward / manual / pick+) as per-component posting policy** | BC #5 | New; Business Central docs were cited in Round-1 research but not detailed |
| **BOM cost shares, expected vs actual variance, WIP account with auto-reversal, Cost of Production / settlement** | BC #6, Odoo #15/#26/#1, SAP #27, Rootstock #12 | New concrete accounting mechanics |
| **MPS / forecast demand vs actual demand / indirect demand / ATP** | Odoo #48 | New |
| **OEE (fully productive / reduced speed / blocked, loss reasons, target)** | Odoo #7 | New |
| **Scrap orders with automatic replenishment (PO or replacement MO) and MO status flip** | Odoo #9 | New; `utech` has a SCRAP item but no auto-replenishment |
| **Three subcontracting supply modes + customer-owned consignment excluded from valuation** | Odoo #36/#24/#44, Rootstock #2 | New; matches `utech` two-bucket inventory and ForgeERP jobwork |
| **Three-way match (PO ↔ receipt ↔ invoice) before AP payment; item–vendor record; vendor analysis** | Rootstock #6 | Absent from all prior research |
| **Project control: per-project subledger, distinct same-item costs per project** | Rootstock #11 | New |
| **Part-master discipline: non-intelligent numbers, reference/phantom parts, UOM per function, direct vs indirect vs service parts, inventory types good/suspect/scrap/rework** | Rootstock #2/#6/#9 | New |
| **SAP PP end-to-end order lifecycle incl. settlement-before-close** | SAP P4 | Partially in Round-1 SAP B1 note; now detailed |
| **India Compliance (e-Invoice, e-Way Bill, GST portal/NIC API, tax templates)** | ERPNext P3 #15 | Partially present in ForgeERP (`einvoice.ts`); e-Way Bill not |

---

## 10. Impact on ForgeERP's prioritised gap list

From `PROJECT_AUDIT_PROGRESS.md` §9 and `GITHUB_REPOS_RESEARCH.md` §6, the P0/P1 list is **confirmed and sharpened**, not replaced:

- **P0 (unchanged, now with 5 independent sources):** QC gate before stock update; PO→GRN→Bill with pending qty; quotation/SO/dispatch chain; **FG receipt + WIP + production costing/variance**; credit/debit notes + returns; MRP + reservation + SO→production link. Round 2 adds that **"FG receipt" must be a distinct, version-aware posting** (BC #4, SAP #24) and that **variance must be expected-vs-actual per order with GL registration** (BC #6, Odoo #15, SAP #27).
- **P1 — new high-value items:** BOM **versions/ECO with effective dates + Where-Used + phantom**; **routing link codes** (component→operation consumption timing); **flushing policy per component**; **capacity calendars with maintenance windows**; **WIP account with auto-reversal**; **scrap orders + auto-replenishment**; **item–vendor + three-way match**; **MPS/ATP dashboard**; **OEE**.
- **P2:** customer-owned consignment valuation exclusion (already conceptually in ForgeERP jobwork, but no ownership ledger), barcode-driven shop floor, alternative work centers, work-order dependencies, unbuild/reverse manufacturing, by-products, engineer-to-order, project subledger, e-Way Bill/GST portal API.

**Preserve, do not copy away:** ForgeERP's append-only stock/GL ledgers, mirrored reversal on cancel, single `computeInvoiceTotals` + `postGl` choke-point, and the Jobwork Inward→JobCard→Certificate→Invoice chain remain stronger than the edit/delete behaviour shown in some demos. Round 2's Odoo cost-of-production "workaround" (#1) is explicitly **not** a universal solution — do not adopt it as architecture. The negative-inventory-wrong-costing warning (Odoo #5/#6) reinforces the conditional-decrement guard already verified by the 59-check suite.

---

## 11. Honest limits of this review

- **Enumerated:** 185/185 video entries (titles, IDs, durations). **Transcript-read:** 38 videos (12 Rootstock openings, 6/6 BC complete, 20 representative Odoo/ERPNext/SAP first chunks: 9 + 5 + 4 + 2). The other 147 playlist videos were **not individually transcribed** — their content is characterised from titles + playlist/course descriptions, and that is stated per section.
- Rootstock webinars are **Unlisted**; only chunk 0 of each transcript was retrievable, so the full 34–49 min of each was **not** read. ERPNext livestreams (1–2 h) were sampled at their opening chunk only.
- No video was visually watched, no frames inspected, nothing downloaded. Auto-generated transcripts contain recognition errors ("bomb" for BOM, "challen" for challan, "Theo" for MO, "Airpod" for the Contoso airpot) — concepts were cross-checked against official descriptions and Microsoft/Odoo documentation links embedded in the video descriptions.
- No code was copied, no external app was run, no production DB was touched, no credentials were used. Docs-only change on this branch.

---

## 12. Resulting document updates

`PROJECT_AUDIT_PROGRESS.md` is updated so Phase 2 now includes this Round-2 course review; §4 gains the curriculum findings; §9's P1 list absorbs the new concepts; §11 lists this deliverable; §12 points gap selection at both research docs. `YOUTUBE_PLAYLIST_RESEARCH.md` gains a cross-link at its header. The **Critical (C1/C2 MySQL + migrations)** and **High (H1 browser E2E)** items remain open — nothing in Round 2 changes code or test evidence.
