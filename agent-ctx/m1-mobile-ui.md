# M1 — Mobile UI/UX fixes (ForgeERP)

Task ID: **M1** · Files touched: `src/components/erp/{jobwork,masters,inventory,accounting,invoice-module,platform,reports,portal}.tsx`, `src/components/ui/{dialog,alert-dialog}.tsx`. No changes to src/lib, src/app/api, erp-app.tsx, login.tsx, pwa-register.tsx, public, prisma. Emerald theme + desktop (md+) layout preserved; all state wiring identical; aria labels kept; print CSS untouched; no new API calls.

## Completed (all 15 audit items)

1. **jobwork NewInwardDialog row editor** — added `sm:hidden` stacked-card list (full-width Item Select + delete button header, grid-cols-2 Batch/Qty/Weight) mirroring invoice-module pattern; table wrapped in `hidden … sm:block`. State (`setRow`, `rows`) identical.
2. **jobwork NewJobCardDialog lines table** — mobile cards per line: Include checkbox (label tap target), item name + code, "Remaining: X pcs / Y kg" hint, grid-cols-2 Qty/Weight; table `hidden sm:block`.
3. **masters PartyDialog** — sticky footer: `flex max-h-[92dvh] flex-col overflow-hidden`, body in `min-h-0 flex-1 overflow-y-auto erp-scroll-y`, footer sibling with `border-t pt-3`.
4. **masters ItemDialog** — same conversion.
5. **masters WarehouseDialog + ProcessDialog** — same conversion (kept `sm:max-w-md`).
6. **inventory OpeningStockTab** — mobile stacked cards (Item select full width, grid-cols-2 Qty/Rate, computed Value row, delete); table `hidden sm:block`.
7. **masters PartyRatesTab** — `hidden sm:table-cell` on Basis/Default Rate/Default Lot (th+td); row inputs already h-11 (no h-9 Select exists — SKIPPED as not present).
8. **accounting NewPaymentDialog** — Outstanding column `hidden sm:table-cell` (th+td) so Invoice + Allocate fit.
9. **invoice-module** — list row actions `size-9 → size-11 md:size-8` (3 buttons incl. hidden View one).
10. **platform** — Plans Edit/Delete `h-11 md:h-8`; Inquiry Delete `h-11 md:h-9`; Add follow-up `h-11 md:h-8`; Blog Edit/Delete `h-11 md:h-9`; row Selects → `h-11 w-full md:h-9 md:w-36` (Plan) and `h-11 w-full md:h-9 md:w-32` (Inquiry status; actions wrapper got `w-full flex-wrap sm:w-auto` so the responsive width is effective).
11. **Read tables** — StockSummary hides HSN/Avg Cost/Closing Value (footer colSpan made responsive 7↔5); jobwork Inwards hides Card Value; Party Ledger hides Account (opening colSpan 5↔4, closing 3↔2 responsive); masters Processes hides Seq/Basis/Lot Charge.
12. **ui/dialog.tsx** — `p-4` → `pt-4 pl-4 pr-4 pb-[max(1rem,env(safe-area-inset-bottom))]` (sm:p-6 kept). **ui/alert-dialog.tsx** — `p-6` → `pt-6 pl-6 pr-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]`, grid layout kept.
13. **inputMode="decimal"** added to every type="number" money/qty/weight/rate input: jobwork ×8, inventory ×4, accounting ×2, masters ×9, invoice-module ×6 (phone/pincode fields untouched — they use inputMode tel/numeric already).
14. **TabsTrigger h-9 → h-11 sm:h-9**: jobwork ×2, inventory ×3, masters ×9 (incl. PartyViewDialog `h-9 text-xs` → `h-11 text-xs sm:h-9`), accounting ×2, reports ×4.
15. **portal Logout** — `h-9` → `h-11 md:h-9`.

## Verification
- `bun run lint` → clean, zero errors.
- `tsc --noEmit` shows only PRE-EXISTING errors in files owned by the parallel task (api/platform routes, `CreatePreset` import missing at HEAD, `tallySentAt` type, `downloadBackup` apiKey typing) — none introduced by M1 (verified against `git show HEAD:`).
- dev.log: hot recompiles clean (`✓ Compiled`), no runtime errors.

Note for next agent: `hidden` table-cells don't occupy grid columns, so any `colSpan` in rows of tables that hide columns must be made responsive (done for StockSummary totals + Party Ledger opening/closing rows).
