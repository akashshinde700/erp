# Testing Report

**What counts as tested:** a check that was actually executed in this environment, with its evidence recorded below.
**What does NOT count:** claims about code paths that were never run (mission rule: never report un-executed tests as passing).
**Note:** no automated test suite exists (session scope: demo application, not a shipped product); all verification below is executed, evidence-backed manual/API/browser testing. Reference-repo test suites (gst-billing `scripts/tax-test.mjs`, 1077 lines) were *read* for rule extraction, not executed.

---

## 1. Data-integrity proofs (executed)

| # | Check | Command / method | Result |
|---|---|---|---|
| T1 | Seed produces balanced GL | `bun run prisma/seed.ts --force` (twice, after fixes) | **Dr == Cr == ₹809,504.01** — seed refuses to ship unbalanced data (throws otherwise) |
| T2 | Trial balance integrity endpoint | `GET /api/reports?type=trial-balance` | `balanced: true`, totals equal, after every mutation below |
| T3 | Cancel writes mirrored reversal rows (stock) | raw SQLite query on `StockLedger` for cancelled voucher | Original `qtyOut 10` + reversal `qtyIn 10`, both `isCancelled=1` — append-only audit trail intact |
| T4 | Cancel writes mirrored reversal rows (GL) | raw SQLite query on `AccountLedger` | Dr/Cr swapped on all 5 accounts (DEBT/SALS/CGSTP/SGSTP/RND), both sides flagged |
| T5 | Post-cancel trial balance unchanged | T2 after T3+T4 | Still ₹809,504.01 both sides — reversal is net-zero |
| T6 | Jobwork invoice math | Hand-computed from raw rows | SHOT 480kg×6=2,880 · HT (760kg×8.5)+2×120 lot=7,890 · MACH 150×120=18,000 · QC 3,750 — **all exact** |
| T7 | Gapless-forward numbering | Counter rows after seed + test posts | INV-2627-001…007 sequential; cancelled INV-005 number never reused |

## 2. API smoke tests (executed via curl against live dev server)

| Group | Endpoints | Result |
|---|---|---|
| GET health/list | `/api`, dashboard, reports×8, sales/purchase/payments/jobwork lists, masters×6 | 19/19 → HTTP 200, correct `{success,data}` envelope |
| POST create | sales invoice (B2B intra-state ₹680+61.20+61.20→₹802, round-off −0.40) | Totals match hand-calc; stock row posted @ avg cost 53.11 |
| DELETE cancel | sales invoice INV-2627-005 | Status CANCELLED; T3–T5 proofs above |
| Business guards | over-allocation `amount:10 / alloc:999999` | **400** `"Allocated (999999) exceeds payment amount (10)"` |
| Business guards | selling unstocked items (seed runs) | **400** `"Insufficient stock …"` — fired 3 times during seed iteration, as designed |

## 3. End-to-end browser verification (agent-browser, executed)

| # | Flow | Result |
|---|---|---|
| B1 | Boot `/` → Dashboard | Renders KPIs with Indian formatting (₹ 8,05,973.00), 6-month trend chart, recent invoices with JOBWORK/MANUAL badges; zero page errors |
| B2 | Module navigation | Sidebar → all 9 modules render (Dashboard, Sales, Purchase, Jobwork, Inventory, Accounting, Reports, Masters, Docs) |
| B3 | Sales list → invoice detail | Full GST TAX INVOICE layout: valid company/party GSTINs, PoS "24-Gujarat", IGST-only split (CGST/SGST 0), tax summary by rate, HSN summary, amount-in-words, bank block, Print + Cancel actions |
| B4 | Jobwork module | Inward list with progress bars, challan numbers, card values, status badges; Pending tab; detail view with job cards → process rows → certificate → invoice chain |
| B5 | Reports | GSTR-1 rate-wise (4 invoices, B2B, Nov-2026, totals ₹81,539.07 taxable / ₹14,677.04 tax); Trial balance banner **"Balanced ✓ ΣDr=ΣCr"** |
| B6 | Live create flows (subagent run) | Job card JC-003 ₹7,875 → CERT-002 → INV-006 (source JOBWORK); sales create with IGST preview matching server posting exactly; payment RCP-003 ₹5,000 allocated; insufficient-stock error surfaced as toast with dialog kept open |
| B7 | Mobile (390×844) | Sidebar collapses to hamburger Sheet drawer; tables scroll horizontally; touch targets ≥44px |
| B8 | Sticky footer | Short page: `footerBottom == 1000 == viewport` ✓; long page: pushed naturally, no overlap ✓ (after fix H5) |
| B9 | Color policy | Computed primary = lab(36.4, −36.7, 9.6) → deep emerald; no indigo/blue |
| B10 | Console/page errors | `agent-browser errors` → none across all visited views |

## 4. Static quality gates (executed)

- `bun run lint` → **0 errors, 0 warnings** (run after final fix).
- Dev log (`dev.log`) → no compile errors, no hydration warnings; all API routes returned 200.

## 5. Honest limitations — NOT tested / NOT covered

1. No concurrent-write stress (SQLite serializes writers; behavior under parallel POST bursts unverified).
2. No cross-FY boundary tests (all seeded docs fall inside FY 2627; numbering rollover exercised only by unit-logic reading, not live posts).
3. Print output verified structurally in DOM only — not as rendered PDF paper.
4. e-invoice/GSTR-1 **JSON export** not implemented (summary only) — P2 roadmap.
5. Performance untested beyond MVP data volume (~10 vouchers); ledger aggregation is O(rows) per report.
6. Auth absent by scope — all authorization paths untestable (P1 roadmap).

---

## 6. Addendum (2026-11) — Tally / Platform / Audit / Backup session (executed)

**Method note:** the sandbox reaps spawned processes between tool calls, so each verification batch is self-contained: dev server started inside the batch, checks executed against it. All results below were executed and observed live.

### 6.1 API verification (curl, 25 checks)

| # | Check | Result |
|---|---|---|
| V1 | `GET /api/masters/company` | Returns subscription block + `access: {state: ACTIVE, blocked: false}` |
| V2 | Tally voucher preview — jobwork service invoice | Sales-ledger credit route (no stock lines): entries Dr 38,374 = Cr(taxes+sales+round-off 0.40) **BALANCED** |
| V3 | Tally voucher preview — stock invoice | 2 inventory lines, qty back-solved from billed amount (33.8983 PCS @ 640 = 21,694.92); **BALANCED** Dr=Cr+stock |
| V4 | `GET /api/tally/masters` | Valid `Import Data`/`All Masters` XML: UNIT (NOS/PCS/…) + LEDGER blocks with PARENTs |
| V5 | `GET /api/tally/bulk` | 26,993-byte combined XML, **9 `<VOUCHER>` elements**, attachment headers |
| V6 | `GET /api/tally/voucher?format=xml` | `Content-Disposition: attachment; filename="INV-2627-004_tally.xml"` + `application/xml` |
| V7 | `POST /api/platform/auth` | `forge-admin` → valid; wrong key → 401 `Invalid platform admin key` |
| V8 | `GET /api/platform/orgs` | Stats (total/active/suspended/MRR/usage) + org row with `operating: true` |
| V9 | `GET /api/platform/plans` | 3 starter plans auto-created (Starter/Growth/Enterprise), sorted by price |
| V10 | `GET /api/audit` | Grouped entities + newest-first rows (every earlier action present) |
| V11 | `PATCH orgs {action:'suspend'}` | `saasStatus: SUSPENDED` |
| V12 | Mutation while suspended | `POST /api/masters/warehouses` → **403** "This organization is suspended…" |
| V13 | Company API reflects blocked | `access.blocked: true` (drives the shell banner) |
| V14 | `PATCH {action:'activate'}` | Status ACTIVE; mutation succeeds again (TESTWH created) |
| V15 | Custom limit `maxItems: 6` | Item create → **403** "Plan limit reached: 6/6 items" |
| V16 | `resetCustom` | Override cleared (`maxItems: null` → plan default) |
| V17 | Connector `new-code` | 10-char unambiguous code (e.g. Z7GJW-6PJXA), 10-min expiry |
| V18 | Connector `pair` | Bearer token issued once (`ftc_…`); status shows paired |
| V19 | Connector `queue` | `jobId` + docNo returned; duplicate queue → `{duplicate:true}` |
| V20 | Connector `?mode=pending` | Job delivered with 3,035-byte XML payload |
| V21 | Connector `result` | `{accepted: true}`; job marked done |
| V22 | Connector status | `recent: [{docNo: INV-2627-004, ok: true, created: 1}]` |
| V23 | `POST /api/tally/voucher mark-sent` | `tallySentAt` stamped; list/detail show "In Tally" badge |
| V24 | `GET /api/backup` | Full snapshot with per-table counts (14 stock rows, 30 GL rows, 4 sales, 2 purchase, 3 payments, 2 inwards…) |
| V25 | Cleanup | TESTWH removed via direct Prisma (verified count 1) |

### 6.2 Browser E2E (agent-browser, executed)

| # | Flow | Result |
|---|---|---|
| B11 | Dashboard quick actions | 6 action cards render (New Sales Invoice / New Purchase / Jobwork Inward / Record Payment / Stock Snapshot / Tally Export) |
| B12 | Sidebar registry | New modules present: Tally Export, Audit Trail, Platform Admin (Setup & Platform group) |
| B13 | Sales list row actions | Per-row View / Duplicate / Tally-export dropdown in an Actions column; toolbar Refresh + CSV |
| B14 | Duplicate flow | Dialog titled "Duplicate INV-2627-003 as new invoice", party+lines prefilled (40 @ 640) |
| B15 | Tally module | All sections render: how-it-works, masters download, bulk export, connector, .bat download, ledger settings |
| B16 | Platform key gate | Key input + disabled Unlock until filled; wrong key → toast error |
| B17 | Platform console | KPI cards, Organizations (1)/Plans (3) tabs, org row with operating badge, GSTIN, usage, +1 mo/+1 yr/+7d trial/Suspend/Delete |
| B18 | Suspend → banner | Banner "This organization is suspended…" appears immediately when leaving Platform Admin (after reload-fix) — no manual refresh needed |
| B19 | Audit Trail UI | Rows with action badges (PLATFORM/EXPORT/CREATE) + details, entity/action filters, CSV export |
| B20 | Mobile 390×844 | Hamburger drawer works; layout responsive |
| B21 | Console/page errors | `agent-browser errors` → none across all new views |
| B22 | Sticky footer | Tall pages push footer naturally (1564 > 900 viewport) — same flex+mt-auto structure as verified fix H5 |

### 6.3 Bugs found & fixed DURING this session's verification (see BUG_AND_SECURITY_REPORT §B H8–H11)

- Round-off residual formula initially excluded inventory value → ₹32,520 fake residual line on invoice-mode vouchers (caught by V2 balance check, fixed + re-verified).
- Service lines (jobwork) initially exported as Tally inventory lines — services now ride the sales ledger.
- Two connector errors were initially returned wrapped in a success envelope (repeat of old bug H6 pattern) — fixed to `fail()`.
- Stale in-memory Prisma client after schema push → dev-server restart required (`plan` include 500).

### 6.4 Honest limitations (this addendum)

1. **Connector end-to-end against a REAL TallyPrime: NOT tested** (no Tally in the sandbox). Pair/queue/poll/result flow verified via curl; XML structure follows the TallyPrime import spec from the audited reference. The `.bat` and connector script are untested against real Windows/Tally.
2. Connector state is in-memory (by design, PoC) — restart clears pairing; documented in UI.
3. Platform "organizations" beyond the first are Company rows without per-request tenant scoping (single-tenant runtime; honest note in the UI).
4. Backup restore verified structurally (transaction + typed confirm + counts) — full round-trip restore not exercised in this session.
