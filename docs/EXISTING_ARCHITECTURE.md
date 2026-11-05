# Existing (Target) Project Architecture — Phase 5

## Honest status
The workspace `/home/z/my-project` is a **greenfield scaffold**, not an existing ERP. Verified by direct inspection:
- `src/app/page.tsx` — scaffold page (to be replaced)
- `src/app/api/route.ts` — placeholder API
- `prisma/schema.prisma` — only demo `User`/`Post` models
- Full `src/components/ui/*` shadcn set, `src/lib/db.ts` (Prisma client), Tailwind 4, `src/hooks/*`
- No ERP code, no business logic, no data to preserve

**Consequence (mission Phase 5):** "features already implemented / broken" lists are empty; the gap analysis compares reference intelligence against the *planned* MVP. Mission rule "never break existing working features" is satisfied trivially — nothing exists yet. No destructive migration risk (fresh `db/custom.db`).

## Chosen architecture (fixed by mission + environment)
| Layer | Decision |
|---|---|
| Framework | Next.js 16 App Router, TypeScript strict |
| UI | shadcn/ui (New York) + Tailwind 4, single-page module-registry shell at `/` (only user-visible route; laserp pattern) |
| API | App Router route handlers under `/api/*` (`{success,data,error}` envelope, laserp pattern) |
| DB | Prisma + SQLite at `db/custom.db` |
| Money | `Float` + `r2()` everywhere (SQLite has no Decimal — documented limitation, P1 roadmap: Postgres migration) |
| Statuses | String constants (SQLite has no enums — laserp convention) |
| Validation | zod on API bodies + hand-rolled form validation |
| State | zustand (view router) + plain fetch hooks |
| Charts | recharts (dashboard trend) |
| Toasts | sonner |

## Module registry (sidebar groups → views)
1. **Dashboard** — KPIs, sales trend, low stock, recent invoices
2. **Sales** — invoices (list / create / view / print / cancel)
3. **Purchase** — invoices (list / create / cancel)
4. **Inventory** — stock ledger, stock summary, opening stock
5. **Jobwork** — inwards (multi-item), job cards (multi-process, partial), pending report
6. **Accounting** — payments + allocations, party ledger
7. **Reports** — GSTR-1 summary, trial balance, outstanding, P&L
8. **Masters** — parties, items, warehouses, processes (+ party rates), company
9. **Docs** — link to documentation set

## Core invariants (from Phase 6 blueprint)
1. Every transaction posts **stock ledger + GL entries atomically** inside one `prisma.$transaction`.
2. Ledgers are **append-only**; cancellation writes reversal rows (`isCancelled: true`), never deletes.
3. Document numbers are **atomic, gapless-on-rollback** (Counter table, FY-aware, inside the same transaction).
4. **One pure tax engine** (`src/lib/erp.ts`) shared by UI live-preview and server posting — no duplication (avoids gst-billing's engine↔screen drift bug).
5. Inter-state decision from **place of supply vs company state code** (codes, not names — avoids laserp bug).
6. Outward stock is **availability-checked** before posting.
7. Trial balance must satisfy **Σdebit == Σcredit** (integrity proof surfaced in the report).
