# Manufacturing cost roll-up: standard vs actual, and absorbed overhead

Status: implemented 2026-11-12 on `arena/7cda1275-erp`. Typecheck and lint clean;
the accounting identities are asserted in `tests/workflow-audit.mjs`
(`P12d-costing` + the global `reconcile` phase) but **the suite has not been run
against MySQL** — that needs the disposable-database runner.

## The three money buckets

| Bucket | Source | Evidence |
| --- | --- | --- |
| Material | `ProductionTask.materialCost` — moving average at issue date | stock ledger `MFG_ISSUE` |
| Labour | `hours × labourRate` (rate snapshotted from the worker) | payroll / time cards |
| Overhead | `rate% × (material + labour)`, company policy | **allocation**, not a bill |

`ProductionTask.overheadCost` and `WorkOrder.overheadCost` hold the absorbed
overhead. A work order's actual cost is the sum of all three, and it is what the
finished-goods receipt settles (`production-output.ts`), so WIP reaches zero
when the order closes. `completeWorkOrder` refuses to close an order whose
absorbed overhead was never settled.

## Absorption, and why it is a liability

When an operation completes, inside the same transaction that consumes material:

```
Dr  WIP                        overhead absorbed
    Cr  OVHA (Factory Overhead Absorbed)   overhead absorbed
```

`OVHA` is an **accrual**: no bank account ever pays it. It exists so the credit
side of the absorption is visible and reversible. When an accountant books the
real overhead spend for the period (rent, power, supervision), the `OVHA`
balance is reversed (contram) and the actual expense lands in the P&L. The
report's `limitations` say all of this in the UI, because an absorbed-overhead
balance that looks like profit is a classic way to misread a job-cost report.

The rate lives on `Company.overheadRatePct` (Masters → Company), defaults to
**0 = off**, and is capped at 100 %: past that a typo is far likelier than a
policy. Changing it never rewrites a past posting.

## Standard cost of a revision

`bomStandardCost()` / `GET /api/manufacturing/costing?bomId=…`:

```
material  = Σ BomItem.estCost                 (qty × (1 + wastage) × rate)
labour    = Σ (setup + run/unit) minutes ÷ 60 × WorkCenter.costPerHour
overhead  = rate% × (material + labour)
```

Approving a revision **freezes** `Bom.standardLabourCost` and
`Bom.standardMinutes` — the same rule as the routes themselves: a later route
change cannot silently rewrite an approved standard. Operations pointing at a
centre with no `costPerHour` are listed in `unpricedOperations`, so the UI can
say "labour is understated" instead of quietly showing a low standard.

## Expected vs actual, and the true-up

`GET /api/manufacturing/costing` compares, per work order:

- **standard** = per-unit standard × units *accepted by QC* (nothing received ⇒
  no standard ⇒ the row is `not measured`, and it is excluded from the summary
  rather than counted as a 100 % variance);
- **actual** = the three buckets above.

Because overhead is absorbed *as work happens*, a rate change (or setting a rate
on a factory that has already been running) leaves older operations
under-absorbed and WIP unsettles. `POST /api/manufacturing/costing/:id`
`{ "action": "true-up" }` posts **one** equalising entry against the latest
completed operation and restates the per-operation amounts pro rata to prime
cost, so header and operations always agree. It is idempotent — a second run
posts nothing — and it fails on a locked period instead of silently dropping the
difference (`MFG_OVERHEAD_TRUEUP`).

## What this deliberately does **not** do

- **No standard costing system.** There is no frozen material rate per period,
  no price/usage variance split, no revaluation at issue date. Material variance
  is "BOM rate today vs actual average cost", which is a usable shop signal and
  not an accounting standard-cost system.
- **No machine-hour absorption.** Overhead is absorbed on prime cost, not on
  routing hours × a machine rate. Machine-hour rates would need a fixed/variable
  split and a budget-volume denominator, i.e. a proper absorption-costing model
  with an accountant's sign-off.
- **No WIP ageing or per-operation overhead pools** (setups, QA time, idle time).
- **No automatic post-closing adjustment.** Over/under absorption is only
  cleared through the true-up or a manual journal — there is no period-end
  write-off.
- **No scrap accounting.** Rejected quantities consume material through task
  completion and land in `MFGV` at receipt; there is no scrap account.
- **Finished-goods receipt valuation depends on the BOM line basis.** Every
  BOM revision now says what its component quantities are for
  (`Bom.lineBasis`, `Bom.batchQty`, migration `20261114100000_bom_line_basis`):
  - **UNIT** — each line is the quantity for one finished unit. A work order for
    N units needs line × N. The receipt treats `WorkOrder.outputQty` as planned
    output and values accepted units at the **full standard**: material per unit
    + frozen routed labour per unit + overhead at the company rate. Stock carries
    what a unit should cost; `MFGV` holds only the true job variance.
  - **BATCH** — each line is the quantity for one batch of `batchQty` finished
    units. A work order for N units needs line × N ÷ `batchQty`. The receipt keeps
    the historical rule: material standard pro-rated over planned output (largest
    task quantity), so labour and overhead land in `MFGV`. Every revision that
    existed before this change is BATCH of 1 and posts exactly as before.
  Material standard per unit in `GET /api/manufacturing/costing` and the
  production cost & variance report is the BOM material ÷ units per set for both
  bases. New BOMs created from the UI default to UNIT; the API default stays
  BATCH of 1 so existing integrations are unchanged. A revision inherits its
  basis; change it on the draft before approval.

## Migration

`prisma/migrations/20261112100000_manufacturing_cost_rollup/migration.sql` —
four additive, defaulted columns (`Company.overheadRatePct`,
`Bom.standardLabourCost`, `Bom.standardMinutes`, `ProductionTask.overheadCost`,
`WorkOrder.overheadCost`). Existing rows keep working with absorption off. Before
turning a rate on in production, note that WIP and receipt cost *change* for
work completed afterwards; operations completed before the rate stay at zero
until a true-up.
