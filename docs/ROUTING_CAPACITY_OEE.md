# Routing, work centres, finite capacity and OEE

Status: implemented 2026-11-11 on `arena/7cda1275-erp`. Verified by typecheck,
lint and the workflow audit assertions (`tests/workflow-audit.mjs`, phases
`P12c-ops`); **not yet exercised against MySQL or run on a real dump** — the
suite needs the disposable-MySQL runner.

## What exists now

| Piece | Where | Notes |
| --- | --- | --- |
| Work centres (`WorkCenter`) | `src/lib/routing.ts` | machine/cell/manual, parallel capacity, daily-hour fallback, cost/hour, retire instead of delete |
| Shift calendar (`ShiftCalendar`, `Shift`, `ShiftHoliday`) | same | working week, up to 7 non-overlapping shifts/day, holidays |
| Routing (`RoutingOperation`) | same | ordered operations per **BOM revision**, setup + run/unit + queue + move + inspection minutes |
| Task snapshots | `ProductionTask.workCenterId/plannedMinutes` | copied from the route when tasks are generated |
| Finite scheduler | `finiteSchedule()` | lanes = parallel slots, route precedence, calendar-aware, reports lateness |
| Downtime (`MachineDowntime`) | `recordDowntime()` / `closeDowntime()` | reasons, planned flag, overlap guard, open stoppages |
| OEE | `src/lib/oee.ts` | availability × performance × quality per centre per day |

### Invariants

- **A route belongs to a revision.** `saveRouting` only accepts `DRAFT`; after
  approval the route is frozen exactly like the material lines, and changing it
  means `reviseBom` → new draft → re-route → approve.
- **Tasks are snapshots, not references.** `generateWorkOrderTasks` writes
  `plannedMinutes` and `workCenterId` onto the task. A later route change never
  rewrites a job that is already being worked on, and it refuses to regenerate
  while operations are `IN_PROGRESS`/`COMPLETED`.
- **Generation is idempotent.** Only missing `(seq, operation)` pairs are
  created; planner-made tasks and re-sequencing survive a re-run.
- **Nothing posts.** Routing, calendars, downtime and scheduling touch no stock
  and no ledger. `MFG_ISSUE` still happens only on task completion.
- **Scheduling reports, never rewrites.** `GET /api/manufacturing/schedule` is a
  read; a planner decides whether to move work. Silent re-sequencing of a live
  shop floor from a page load would be indefensible.
- **Capacity is honest about missing data.** No calendar → `dailyHours` per day
  and the response lists those centres; no route → the task still schedules with
  a fallback duration, and OEE states how much work had no routed ideal time.

## OEE definitions used

```
planned time   = active shift minutes × parallel capacity per working day
run time       = planned − unplanned downtime (MAINTENANCE is excluded)
availability   = run ÷ planned
performance    = (ideal cycle time × good+reject) ÷ run time
                 ideal = routing run minutes per unit for that operation
quality        = good ÷ (good + reject)          [completed tasks]
OEE            = availability × performance × quality
```

Known limits, surfaced in the API response rather than hidden:

- performance covers **only routed operations**; tasks without a route are
  counted in `excluded.tasksWithoutIdealTime` and left out of the ratio;
- downtime is captured only from the deploy onwards, so a window before that
  shows availability as 100 % — the report says so explicitly
  (`no downtime recorded … treat it as unmeasured rather than perfect`);
- a centre without a shift calendar cannot see holidays;
- `plannedMinutes` on a planner-created task with no route defaults to the
  centre's daily capacity (or one hour when the centre has no calendar), and is
  flagged nowhere else — treat non-routed durations as estimates.

## API surface

| Route | Purpose |
| --- | --- |
| `GET/POST /api/manufacturing/work-centers` | list (with calendars, open downtime) / create |
| `GET/PUT/DELETE /api/manufacturing/work-centers/[id]` | calendar detail / update / delete (guarded) |
| `PUT /api/manufacturing/work-centers/[id]/calendar` | replace work week + shifts + holidays atomically |
| `GET/PUT /api/manufacturing/routing?bomId=` | read / replace the route of a **draft** revision |
| `POST /api/manufacturing/work-orders/[id]/actions` | `generate-tasks` (idempotent; `replace` drops untouched tasks) |
| `GET /api/manufacturing/schedule?from=&horizonDays=` | finite plan, load vs capacity, late work orders |
| `GET/POST /api/manufacturing/downtime` | list / `record` \| `close` |
| `GET /api/manufacturing/oee?from=&to=&workCenterId=` | OEE per centre and per day |

## Migration

`prisma/migrations/20261111100000_routing_work_centers_oee/migration.sql`
— additive: five new tables and two nullable/defaulted `ProductionTask`
columns. Pre-flight on a protected copy:

```sql
-- legacy tasks keep working: they simply have no centre
SELECT COUNT(*) FROM ProductionTask WHERE workCenterId IS NULL;
-- tasks the scheduler cannot place until a routing exists
SELECT COUNT(*) FROM ProductionTask WHERE status IN ('PENDING','ASSIGNED','IN_PROGRESS') AND workCenterId IS NULL;
```

`scripts/staging-rehearsal.mjs` already checks the tables survive the migration;
add the two counts above to the operator checklist before the first production
run (`docs/MIGRATION_RUNBOOK.md`).

## What this does *not* solve (deliberately next)

- **Reservations / ATP.** MRP netting and this capacity plan are advice; neither
  reserves stock or machine time.
- **Automatic re-scheduling.** The scheduler computes a plan per request; it does
  not persist a "frozen" schedule, sequence-dependent setup matrices (changeover
  from A to B costs more than B to A), or operator skills matching.
- **Costing per operation.** `costPerHour` is captured on the centre but not yet
  rolled into WIP; job costing still uses task labour/material actuals.
- **Holiday editing UI** — capacity already excludes holidays; only the seed and
  the API can add them.
