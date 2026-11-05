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
