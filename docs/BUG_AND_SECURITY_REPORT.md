# Bug & Security Report

**Mission phases:** reference-repo defect extraction (Phase 3) + own-implementation hardening log (Phase 8/9).
**Evidence discipline:** every finding carries a file path or a reproduction command. No speculation.

---

## A. Defects found in reference repositories (extracted, NOT copied)

### frappe/erpnext (GPL-3.0) — architecture-level risks we deliberately did NOT inherit
| # | Finding | Evidence | Our mitigation |
|---|---|---|---|
| E1 | God-controllers: `stock/stock_ledger.py` is 3,288 lines; single methods doing reposting, valuation and cancellation | file length in sparse clone | Services split into `erp.ts` (pure engine), `accounting.ts` (GL), `services.ts` (posting) — each ≤ ~600 lines, one concern each |
| E2 | O(n) full recount on every stock write (no incremental bin cache at write time) | `bin.py` recount pattern | Accepted for MVP scale (documented limitation #3); ledger reads aggregate in SQL per report |
| E3 | Backdated posting triggers huge reposting machinery | repost doc types | MVP allows backdated entries (single-user); FY-aware numbering prevents cross-FY number confusion. P2: posting-date lock |
| E4 | Config sprawl (hundreds of doctypes/settings) | doctype count | Fixed 15-account chart + 8 report types; zero configuration surface |

### akashshinde700/laserp (no license — patterns only, zero code copied)
| # | Finding | Evidence | Our mitigation |
|---|---|---|---|
| F1 | Line items lack FK relations to items (bare id strings) | `prisma/schema.prisma` in clone | Every line item carries a real Prisma relation (`SalesInvoiceItem.item`, `JobCardProcess.inwardItem`) — DATABASE_RELATIONSHIP_ANALYSIS.md |
| F2 | Inter-state purchase check compares state **names** | purchase route string equality | All comparisons use GST **state codes** (`pos !== company.stateCode`) — core invariant #5 |
| F3 | Audit log `userName` is client-asserted | audit write in route handler | No audit log in MVP (P1 item); nothing trusts client identity yet. Server-side business guards never read client-computed totals |
| F4 | Dead enum values: `RETURN_IN`, `SALES_RETURN` declared but never posted by any API | grep over api routes | Enum universe = exactly what services post (`OPENING\|PURCHASE\|SALES\|JOBWORK_IN\|ADJUST` reserved) |
| F5 | No GL/journal at all | absence of accounting models | Full double-entry GL with ΣDr=ΣCr assertion before write (`accounting.ts::assertBalanced`) |

### IamRamgarhia/Free-GST-Billing-Software (GST engine source)
| # | Finding | Evidence | Our mitigation |
|---|---|---|---|
| G1 | JSON-file persistence: no concurrency safety, no transactions | storage layer | SQLite + `prisma.$transaction` on every posting |
| G2 | Engine↔screen drift risk (single app, but print code re-derives totals in places) | print templates | ONE shared engine `erp.ts::computeInvoiceTotals` used by UI preview AND server posting AND report aggregation (invariant #4) |
| G3 | Manufacturing depth: single-level only | manufacturing module | Full jobwork chain with partial processing — but BOM/WO intentionally deferred to P2 |

### akashshinde700/erpnashilk — **INACCESSIBLE (HTTP 404, verified `curl -w "%{http_code}"` → 404 and `git ls-remote` auth-fail). No analysis performed; no functionality invented for it** (mission Phase 1 rule).

---

## B. Own implementation — bugs found & fixed during build/verification

| # | Bug | Found by | Fix |
|---|---|---|---|
| H1 | `generateJobworkInvoice` called `postSalesInvoice` (own `db.$transaction`) inside an open transaction → nested Prisma transactions break atomicity / can deadlock SQLite | self-review before first run | Extracted `postSalesInvoiceTx(tx, input)`; jobwork invoicing now posts inside its own transaction (`services.ts`) |
| H2 | GSTR-1 summary pushed whole-invoice totals under the first line's rate — multi-rate invoices double-counted | self-review | Rate buckets built from per-line grouping (`reports.ts::gstr1Report`) |
| H3 | Seed tried to sell items with no stock (Gear Blank 60 pcs, then Flange overdraw) | **availability guard fired during seed run** (proof the guard works) | Seed scenario re-planned around stocked items |
| H4 | Certificates route parsed `req.json()` twice → second parse throws | self-review | Single parse, body reused |
| H5 | Sidebar had fixed `h-[calc(100vh-3.5rem)]` → content row never shrank → footer pushed below viewport on short pages (violated sticky-footer requirement) | agent-browser bounding-box audit | Row gets `min-h-0`; sidebar `h-auto max-h-[calc(100vh-3.5rem)]` — verified `footerBottom == viewportHeight` on short page, natural push on long |
| H6 | Company route returned an error wrapped in a success envelope (`ok({error},400)`) | self-review | `fail(...)` with proper status |
| H7 | Dead variable + double-count remnants in dashboard aggregation | self-review | Removed; outstanding derived from live invoices + opening balances |

## C. Security posture of the MVP (honest disclosure)

1. **No authentication / RBAC** — single-user MVP by scope decision (roadmap P1: laserp's scrypt + DB sessions + HMAC cookie pattern). All endpoints are open; do not expose this port publicly.
2. **Server-side trust boundary:** item GST rates, state codes, rates for job cards, totals, availability, over-processing and allocation ceilings are ALL resolved/validated server-side — client values are advisory only.
3. **GSTIN checksum** validated at data entry (client hint + server rejection, mod-36).
4. **Zod validation** on every mutating route; errors mapped to 400 with field paths.
5. **SQL injection:** none (Prisma parameterized). **XSS:** React escaping; no `dangerouslySetInnerHTML` in the app.
6. **Destructive operations:** none. Cancel = reversal rows. The only wipe is `POST /api/seed?force=1`, an explicit demo-reset endpoint.
7. **Money as Float** (SQLite limitation) — r2 at every step; P1: Postgres + Decimal (documented in DATABASE_RELATIONSHIP_ANALYSIS.md limitations).
8. **Secrets:** none in repo; `DATABASE_URL` in `.env` points at the sandbox-local SQLite file.
