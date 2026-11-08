'use client'

/**
 * ForgeERP — Projects & Manufacturing module (Absolute-ERP-style fabrication):
 * Project → BOM (wastage, MRP stock check) → Work Order → per-operation
 * Production Tasks (assign → start → complete with material consumption) →
 * Work-order & project completion, plus the task-wise pending board.
 */

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Coins,
  FolderKanban,
  ListTodo,
  Loader2,
  PackageSearch,
  Pencil,
  PlayCircle,
  Plus,
  Gauge,
  RefreshCw,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  Wrench,
  XCircle,
  PackageCheck,
} from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  apiDelete,
  apiPost,
  apiPut,
  num,
  partyTypes,
  toastError,
  todayISO,
  useApi,
  useMasters,
  operationLabel,
  MANUFACTURING_OPERATIONS,
  WO_PRIORITIES,
  type Bom,
  type BomWhereUsed,
  type CostingReport,
  type StandardCost,
  type WorkOrderCostRow,
  type DowntimeRow,
  type Employee,
  type OeeReport,
  type RoutingDetail,
  type RoutingOperationRow,
  type SchedulePlan,
  type WorkCenter,
  type WorkCenterCalendar,
  DOWNTIME_REASONS,
  WORK_CENTER_TYPES,
  type MrpDocumentResult,
  type MrpLineRow,
  type MrpRunDetail,
  type MrpRunSummary,
  type ManufacturingStats,
  type MaterialPlanReport,
  type PendingReport,
  type PendingTaskRow,
  type ProductionTask,
  type Project,
  type ProjectDetail,
  type WorkOrder,
} from './api'
import { EmptyState, ErrorState, KpiCard, Money, ProgressBar, SectionHeading, StatusBadge, TableSkeleton } from './bits'
import { useErpUi } from './store'
import { dateStr, money, qty as qtyFmt, r2 } from '@/lib/erp'
import { cn } from '@/lib/utils'
import { QualityWorkspace } from './quality-workspace'
import { ProductionReceiptsWorkspace } from './production-receipts'

// ===========================================================================
// Module shell
// ===========================================================================

type MfgTab = 'projects' | 'boms' | 'work-orders' | 'mrp' | 'capacity' | 'material-plan' | 'tasks' | 'pending' | 'employees' | 'centers' | 'oee' | 'costing' | 'quality'

export function ManufacturingView() {
  const [tab, setTab] = useState<MfgTab>('projects')
  const [taskWoFilter, setTaskWoFilter] = useState<string>('all')
  const stats = useApi<ManufacturingStats | null>('/api/manufacturing/stats')
  const s = stats.data

  const gotoTasks = (workOrderId?: string) => {
    setTaskWoFilter(workOrderId ?? 'all')
    setTab('tasks')
  }

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Own Projects & Manufacturing"
        description="Make-to-order fabrication using company-owned material: project → BOM → work order → operation tasks. Customer-owned conversion work stays in Customer Jobwork and is never used as own stock."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          title="Running Projects"
          value={s ? String(s.projects.running) : '—'}
          icon={FolderKanban}
          hint={s ? `${s.projects.pending} pending · ${s.projects.completed} done` : undefined}
          onClick={() => setTab('projects')}
        />
        <KpiCard
          title="Open Work Orders"
          value={s ? String(s.workOrders.open + s.workOrders.inProgress) : '—'}
          icon={ClipboardList}
          hint={s ? `${s.workOrders.inProgress} in production` : undefined}
          onClick={() => setTab('work-orders')}
        />
        <KpiCard
          title="Unassigned Tasks"
          value={s ? String(s.tasks.pending) : '—'}
          icon={UserPlus}
          tone={s && s.tasks.pending > 0 ? 'warning' : 'default'}
          hint="waiting for a worker"
          onClick={() => setTab('pending')}
        />
        <KpiCard
          title="WIP Tasks"
          value={s ? String(s.tasks.assigned + s.tasks.inProgress) : '—'}
          icon={ListTodo}
          hint={s ? `${s.tasks.inProgress} on the floor now` : undefined}
          onClick={() => gotoTasks()}
        />
        <KpiCard
          title="Completed Projects"
          value={s ? String(s.projects.completed) : '—'}
          icon={CheckCircle2}
          tone="positive"
          onClick={() => setTab('projects')}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as MfgTab)}>
        {/* The tab row scrolls horizontally on phones (6 module tabs don't fit
            320-360px); globals.css adds a right-edge fade affordance on <sm. */}
        <TabsList className="h-11 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="projects" className="h-11 gap-1.5 sm:h-9">
            <FolderKanban className="size-4" aria-hidden /> Projects
          </TabsTrigger>
          <TabsTrigger value="boms" className="h-11 gap-1.5 sm:h-9">
            <PackageSearch className="size-4" aria-hidden /> BOMs
          </TabsTrigger>
          <TabsTrigger value="work-orders" className="h-11 gap-1.5 sm:h-9">
            <ClipboardList className="size-4" aria-hidden /> Work Orders
          </TabsTrigger>
          <TabsTrigger value="mrp" className="h-11 gap-1.5 sm:h-9">
            <CalendarClock className="size-4" aria-hidden /> MRP
          </TabsTrigger>
          <TabsTrigger value="capacity" className="h-11 gap-1.5 sm:h-9">
            <Gauge className="size-4" aria-hidden /> Capacity
          </TabsTrigger>
          <TabsTrigger value="material-plan" className="h-11 gap-1.5 sm:h-9">
            <PackageSearch className="size-4" aria-hidden /> Material Plan
          </TabsTrigger>
          <TabsTrigger value="tasks" className="h-11 gap-1.5 sm:h-9">
            <Wrench className="size-4" aria-hidden /> Tasks
          </TabsTrigger>
          <TabsTrigger value="pending" className="h-11 gap-1.5 sm:h-9">
            <ListTodo className="size-4" aria-hidden /> Pending
          </TabsTrigger>
          <TabsTrigger value="employees" className="h-11 gap-1.5 sm:h-9">
            <Users className="size-4" aria-hidden /> Employees
          </TabsTrigger>
          <TabsTrigger value="receipts" className="h-11 gap-1.5 sm:h-9">
            <PackageCheck className="size-4" aria-hidden /> FG Receipts
          </TabsTrigger>
          <TabsTrigger value="centers" className="h-11 gap-1.5 sm:h-9">
            <Building2 className="size-4" aria-hidden /> Work Centers
          </TabsTrigger>
          <TabsTrigger value="oee" className="h-11 gap-1.5 sm:h-9">
            <Gauge className="size-4" aria-hidden /> OEE
          </TabsTrigger>
          <TabsTrigger value="costing" className="h-11 gap-1.5 sm:h-9">
            <Coins className="size-4" aria-hidden /> Costing
          </TabsTrigger>
          <TabsTrigger value="quality" className="h-11 gap-1.5 sm:h-9">
            <CheckCircle2 className="size-4" aria-hidden /> Quality
          </TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-4">
          <ProjectsTab onChanged={() => stats.reload()} />
        </TabsContent>
        <TabsContent value="boms" className="mt-4">
          <BomsTab onChanged={() => stats.reload()} />
        </TabsContent>
        <TabsContent value="work-orders" className="mt-4">
          <WorkOrdersTab onViewTasks={gotoTasks} onChanged={() => stats.reload()} />
        </TabsContent>
        <TabsContent value="mrp" className="mt-4">
          <MrpTab onChanged={() => stats.reload()} />
        </TabsContent>
        <TabsContent value="capacity" className="mt-4">
          <CapacityTab />
        </TabsContent>
        <TabsContent value="material-plan" className="mt-4">
          <MaterialPlanTab />
        </TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <TasksTab woFilter={taskWoFilter} onWoFilterChange={setTaskWoFilter} onChanged={() => stats.reload()} />
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <PendingTab onGoTasks={gotoTasks} onChanged={() => stats.reload()} />
        </TabsContent>
        <TabsContent value="employees" className="mt-4">
          <EmployeesTab onChanged={() => stats.reload()} />
        </TabsContent>
        <TabsContent value="receipts" className="mt-4">
          <ProductionReceiptsWorkspace />
        </TabsContent>
        <TabsContent value="centers" className="mt-4">
          <WorkCentersTab />
        </TabsContent>
        <TabsContent value="oee" className="mt-4">
          <OeeTab />
        </TabsContent>
        <TabsContent value="costing" className="mt-4">
          <CostingTab />
        </TabsContent>
        <TabsContent value="quality" className="mt-4">
          <QualityWorkspace />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- shared bits ----------

function PriorityBadge({ priority }: { priority: string }) {
  const cls: Record<string, string> = {
    LOW: 'bg-muted text-muted-foreground',
    NORMAL: 'bg-secondary text-secondary-foreground',
    HIGH: 'border border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400',
    URGENT: 'bg-destructive text-destructive-foreground',
  }
  return (
    <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium tracking-wide', cls[priority] ?? 'bg-muted text-muted-foreground')}>
      {priority}
    </span>
  )
}

function DueCell({ due, overdue }: { due: string | null; overdue?: boolean }) {
  if (!due) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('whitespace-nowrap tabular-nums', overdue && 'font-medium text-destructive')}>
      {dateStr(due)}
      {overdue ? ' ⚠' : ''}
    </span>
  )
}

function isOverdue(due: string | null): boolean {
  // Date-only comparison: due dates are date-only values (UTC midnight in
  // JSON). A task due TODAY must not flag overdue at 00:00 UTC (05:30 IST) —
  // it is overdue only from the NEXT day. Matches the server's
  // pendingTasksReport logic exactly.
  if (!due) return false
  const day = due.slice(0, 10)
  return day < todayISO()
}

// ===========================================================================
// Capacity — finite schedule, load and downtime capture
// ===========================================================================

function CapacityTab() {
  const [from, setFrom] = useState(todayISO())
  const [horizon, setHorizon] = useState('60')
  const plan = useApi<SchedulePlan | null>(`/api/manufacturing/schedule?from=${from}&horizonDays=${horizon}`)
  const centers = useApi<WorkCenter[]>('/api/manufacturing/work-centers?all=1')
  const downtime = useApi<DowntimeRow[]>('/api/manufacturing/downtime?open=1')
  const [stopOpen, setStopOpen] = useState(false)
  const data = plan.data

  const closeStop = async (row: DowntimeRow) => {
    try {
      await apiPost('/api/manufacturing/downtime', { action: 'close', id: row.id })
      toast.success(`Downtime closed`, { description: `${row.workCenter.name} · ${row.reason}` })
      downtime.reload()
      centers.reload()
      plan.reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-blue-500/30 bg-blue-500/5 p-4">
        <p className="text-sm font-medium">Finite plan, not an infinite promise</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Open operations are placed on each work centre&apos;s shift calendar, respecting parallel capacity and route
          sequence. This view only reports — it never re-sequences the shop floor by itself.
        </p>
      </Card>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="cap-from" className="text-xs text-muted-foreground">Plan from</Label>
          <Input id="cap-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cap-horizon" className="text-xs text-muted-foreground">Horizon (days)</Label>
          <Input id="cap-horizon" type="number" min="1" max="365" value={horizon} onChange={(e) => setHorizon(e.target.value)} className="h-11 w-28 text-right tabular-nums" />
        </div>
        <Button variant="outline" onClick={() => plan.reload()} className="h-11 gap-2">
          <RefreshCw className="size-4" aria-hidden /> Recalculate
        </Button>
        <Button onClick={() => setStopOpen(true)} className="ml-auto h-11 gap-2" variant="outline">
          <XCircle className="size-4" aria-hidden /> Record downtime
        </Button>
      </div>

      {plan.loading ? <TableSkeleton rows={4} cols={5} /> : null}
      {plan.error ? <ErrorState error={plan.error} onRetry={() => plan.reload()} entity="capacity plan" /> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard title="Scheduled Ops" value={String(data.placements.length)} icon={CalendarClock} hint={`${data.horizonDays} day horizon`} />
            <KpiCard title="Unschedulable" value={String(data.unschedulable.length)} icon={XCircle} tone={data.unschedulable.length ? 'negative' : 'positive'} />
            <KpiCard title="Late Work Orders" value={String(data.lateWorkOrders.length)} icon={ClipboardList} tone={data.lateWorkOrders.length ? 'negative' : 'positive'} />
            <KpiCard title="Open Stoppages" value={String(downtime.data?.length ?? 0)} icon={Wrench} tone={(downtime.data?.length ?? 0) > 0 ? 'warning' : 'default'} />
          </div>

          {data.workCentersWithoutCalendar.length > 0 ? (
            <Card className="border-amber-500/40 bg-amber-500/5 p-4">
              <p className="text-sm font-medium">No shift calendar</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.workCentersWithoutCalendar.join(', ')} — capacity falls back to daily hours and cannot see holidays.
              </p>
            </Card>
          ) : null}

          {data.unschedulable.length > 0 ? (
            <Card className="border-destructive/40 bg-destructive/5 p-4">
              <p className="text-sm font-medium">{data.unschedulable.length} operation(s) could not be placed</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {data.unschedulable.slice(0, 8).map((u, i) => (
                  <li key={i}>• {u.taskNo} ({u.woNo}) — {u.reason}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="p-0">
            <CardContent className="p-0">
              <div className="border-b p-3">
                <SectionHeading title="Load vs capacity" description="Utilisation above 100 % means the horizon cannot hold the work." />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Work Center</TableHead>
                    <TableHead className="text-right">Ops</TableHead>
                    <TableHead className="text-right">Planned (h)</TableHead>
                    <TableHead className="text-right">Capacity (h)</TableHead>
                    <TableHead className="w-40">Utilisation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.load.map((row) => (
                    <TableRow key={row.workCenterId}>
                      <TableCell className="max-w-44 truncate">{row.workCenter}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.tasks}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(r2(row.plannedMinutes / 60))}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(r2(row.capacityMinutes / 60))}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <ProgressBar value={Math.min(100, row.utilisationPct)} />
                          <span className={cn('text-xs tabular-nums', row.utilisationPct > 100 && 'font-medium text-destructive')}>
                            {row.utilisationPct}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.load.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">No active work centres.</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {data.lateWorkOrders.length > 0 ? (
            <Card className="p-0">
              <CardContent className="p-0">
                <div className="border-b p-3">
                  <SectionHeading title="Late against the committed date" description="Planned finish from the finite run versus the work order end date." />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Work Order</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Planned Finish</TableHead>
                      <TableHead className="text-right">Late</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.lateWorkOrders.map((w) => (
                      <TableRow key={w.woNo}>
                        <TableCell className="font-medium tabular-nums">{w.woNo}</TableCell>
                        <TableCell className="tabular-nums">{w.projectNo}</TableCell>
                        <TableCell className="tabular-nums">{dateStr(w.due)}</TableCell>
                        <TableCell className="tabular-nums">{dateStr(w.plannedFinish)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-destructive">{w.lateDays} d</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}

          <Card className="p-0">
            <CardContent className="p-0">
              <div className="border-b p-3">
                <SectionHeading title="Operation schedule" description="One lane per parallel slot; minutes are working minutes from the calendar." />
              </div>
              <div className="max-h-[52dvh] overflow-auto erp-scroll">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Op</TableHead>
                      <TableHead>Work Center</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead className="text-right">Minutes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.placements.map((p) => (
                      <TableRow key={p.taskId}>
                        <TableCell>
                          <span className="block font-medium tabular-nums">{p.taskNo}</span>
                          <span className="block text-xs text-muted-foreground">{p.woNo} · {p.projectNo}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{operationLabel(p.operation)}</TableCell>
                        <TableCell className="max-w-40 truncate">{p.workCenter}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{p.start.slice(0, 16).replace('T', ' ')}</TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{p.end.slice(0, 16).replace('T', ' ')}</TableCell>
                        <TableCell className="text-right tabular-nums">{qtyFmt(p.minutes)}</TableCell>
                      </TableRow>
                    ))}
                    {data.placements.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          Nothing to schedule — open operations need a work centre (add a routing to the BOM).
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {stopOpen ? <DowntimeDialog centers={centers.data ?? []} open={stopOpen} onOpenChange={setStopOpen} onSaved={() => { downtime.reload(); centers.reload(); plan.reload() }} /> : null}
    </div>
  )
}

function DowntimeDialog({ centers, open, onOpenChange, onSaved }: { centers: WorkCenter[]; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const active = centers.filter((c) => c.active)
  const [workCenterId, setWorkCenterId] = useState('')
  const [reason, setReason] = useState<string>('BREAKDOWN')
  const [startedAt, setStartedAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16))
  const [endedAt, setEndedAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!workCenterId) return toast.error('Pick the work centre')
    setSaving(true)
    try {
      await apiPost('/api/manufacturing/downtime', {
        action: 'record',
        workCenterId,
        reason,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: endedAt ? new Date(endedAt).toISOString() : undefined,
        notes: notes.trim() || undefined,
      })
      toast.success('Downtime recorded', { description: endedAt ? 'Counted in availability for its window.' : 'Still open — close it when the machine runs again.' })
      onSaved()
      onOpenChange(false)
      setNotes(''); setEndedAt(''); setWorkCenterId('')
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record downtime</DialogTitle>
          <DialogDescription>
            Unplanned stoppages reduce availability. Leave the end blank while the machine is still down and close it later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Work Center</Label>
              <Select value={workCenterId || undefined} onValueChange={setWorkCenterId}>
                <SelectTrigger className="h-11 data-[size=default]:h-11 w-full"><SelectValue placeholder="Select centre…" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {active.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="h-11 data-[size=default]:h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {DOWNTIME_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dt-start">Started</Label>
              <Input id="dt-start" type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dt-end">Ended (blank = still down)</Label>
              <Input id="dt-end" type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} className="h-11" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dt-notes">Notes</Label>
            <Textarea id="dt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What stopped the machine?" className="min-h-16" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button onClick={save} disabled={saving} className="h-11 min-w-32">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Work centres (master + calendar)
// ===========================================================================

function WorkCentersTab() {
  const list = useApi<WorkCenter[]>('/api/manufacturing/work-centers?all=1')
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<WorkCenter | null>(null)
  const [calendarFor, setCalendarFor] = useState<WorkCenter | null>(null)
  const rows = list.data ?? []

  const toggle = async (c: WorkCenter) => {
    try {
      await apiPut(`/api/manufacturing/work-centers/${c.id}`, { active: !c.active })
      toast.success(`${c.code} ${c.active ? 'retired' : 'reactivated'}`)
      list.reload()
    } catch (e) {
      toastError(e)
    }
  }

  const remove = async (c: WorkCenter) => {
    try {
      await apiDelete(`/api/manufacturing/work-centers/${c.id}`)
      toast.success(`${c.code} deleted`)
      list.reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} work centre{rows.length === 1 ? '' : 's'} — machines and cells that operations, capacity and OEE are measured on.
        </p>
        <Button onClick={() => setCreateOpen(true)} className="h-11 shrink-0 gap-2">
          <Plus className="size-4" aria-hidden /> New Work Center
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={4} cols={6} />
          ) : list.error ? (
            <div className="p-6"><ErrorState error={list.error} onRetry={() => list.reload()} entity="work centres" /></div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No work centres yet" hint="Add the machines or cells your operations run on, then attach a shift calendar and a routing." icon={Building2} />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Center</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Capacity</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Shift</TableHead>
                    <TableHead className="hidden md:table-cell">Routing Ops</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className="block font-medium tabular-nums">{c.code}</span>
                        <span className="block max-w-44 truncate text-xs text-muted-foreground">{c.name}{c.machineNo ? ` · ${c.machineNo}` : ''}</span>
                      </TableCell>
                      <TableCell><Badge variant="outline">{c.type}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">×{c.parallelCapacity}</TableCell>
                      <TableCell className="text-right tabular-nums hidden sm:table-cell">
                        {c.calendar ? `${qtyFmt(r2((c.plannedMinutesPerDay ?? 0) / 60))} h/d` : `${c.dailyHours} h/d (no calendar)`}
                      </TableCell>
                      <TableCell className="tabular-nums hidden md:table-cell">{c._count?.operations ?? 0}</TableCell>
                      <TableCell>
                        {c.downNow ? (
                          <Badge variant="destructive" className="gap-1"><XCircle className="size-3" aria-hidden /> down</Badge>
                        ) : c.active ? (
                          <Badge variant="outline" className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400">active</Badge>
                        ) : (
                          <Badge variant="secondary">retired</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-9" onClick={() => setCalendarFor(c)}>
                            <CalendarClock className="size-3.5" aria-hidden /> Calendar
                          </Button>
                          <Button variant="ghost" size="sm" className="h-9" onClick={() => setEditing(c)} aria-label={`Edit ${c.code}`}>
                            <Pencil className="size-3.5" aria-hidden />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-9" onClick={() => toggle(c)}>
                            {c.active ? 'Retire' : 'Restore'}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-9 text-destructive hover:text-destructive" aria-label={`Delete ${c.code}`}>
                                <Trash2 className="size-3.5" aria-hidden />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete {c.code}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Only allowed when no open task and no routing operation references this centre. Prefer retiring it so history keeps its capacity context.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="h-11">Keep it</AlertDialogCancel>
                                <AlertDialogAction onClick={(e) => { e.preventDefault(); void remove(c) }} className="h-11">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {createOpen || editing ? (
        <WorkCenterDialog
          center={editing}
          open={createOpen || !!editing}
          onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditing(null) } }}
          onSaved={() => { list.reload(); setCreateOpen(false); setEditing(null) }}
        />
      ) : null}
      {calendarFor ? (
        <CalendarDialog
          center={calendarFor}
          open={!!calendarFor}
          onOpenChange={(o) => !o && setCalendarFor(null)}
          onSaved={() => { list.reload(); setCalendarFor(null) }}
        />
      ) : null}
    </div>
  )
}

function WorkCenterDialog({ center, open, onOpenChange, onSaved }: { center: WorkCenter | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [code, setCode] = useState(center?.code ?? '')
  const [name, setName] = useState(center?.name ?? '')
  const [type, setType] = useState<string>(center?.type ?? 'MACHINE')
  const [machineNo, setMachineNo] = useState(center?.machineNo ?? '')
  const [parallel, setParallel] = useState(String(center?.parallelCapacity ?? 1))
  const [dailyHours, setDailyHours] = useState(String(center?.dailyHours ?? 8))
  const [costPerHour, setCostPerHour] = useState(String(center?.costPerHour ?? 0))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!code.trim() || !name.trim()) return toast.error('Code and name are required')
    setSaving(true)
    try {
      const body = {
        code: code.trim(),
        name: name.trim(),
        type,
        machineNo: machineNo.trim() || undefined,
        parallelCapacity: Math.max(1, Math.trunc(num(parallel) || 1)),
        dailyHours: num(dailyHours),
        costPerHour: num(costPerHour),
      }
      if (center) await apiPut(`/api/manufacturing/work-centers/${center.id}`, body)
      else await apiPost('/api/manufacturing/work-centers', body)
      toast.success(center ? `${body.code} updated` : `${body.code} created`)
      onSaved()
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{center ? `Edit ${center.code}` : 'New work center'}</DialogTitle>
          <DialogDescription>
            A work centre is a machine or a manned cell. Parallel capacity is how many jobs can run on it at once.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wc-code">Code</Label>
            <Input id="wc-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="WC-CNC" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wc-name">Name</Label>
            <Input id="wc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="CNC Laser" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-11 data-[size=default]:h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORK_CENTER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wc-machine">Machine No</Label>
            <Input id="wc-machine" value={machineNo} onChange={(e) => setMachineNo(e.target.value)} placeholder="Optional" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wc-parallel">Parallel capacity</Label>
            <Input id="wc-parallel" type="number" min="1" max="50" value={parallel} onChange={(e) => setParallel(e.target.value)} className="h-11 text-right tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wc-hours">Daily hours (fallback)</Label>
            <Input id="wc-hours" type="number" min="0" max="24" step="any" value={dailyHours} onChange={(e) => setDailyHours(e.target.value)} className="h-11 text-right tabular-nums" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="wc-cost">Cost per hour (₹)</Label>
            <Input id="wc-cost" type="number" min="0" step="any" value={costPerHour} onChange={(e) => setCostPerHour(e.target.value)} className="h-11 text-right tabular-nums" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button onClick={save} disabled={saving} className="h-11 min-w-32">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            {center ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const DEFAULT_SHIFTS = [{ name: 'GENERAL', startMin: 540, durationMin: 480, active: true }]

function CalendarDialog({ center, open, onOpenChange, onSaved }: { center: WorkCenter; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const cal = useApi<WorkCenterCalendar | null>(`/api/manufacturing/work-centers/${center.id}`)
  const [loaded, setLoaded] = useState(false)
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [shifts, setShifts] = useState(DEFAULT_SHIFTS)
  const [saving, setSaving] = useState(false)

  // Hydrate once from the server so typing is never overwritten by a refetch.
  if (!loaded && cal.data) {
    setWorkDays(cal.data.workDays.split(',').map((d) => Number(d.trim())).filter((d) => Number.isInteger(d)))
    if (cal.data.shifts.length) setShifts(cal.data.shifts.map((s) => ({ name: s.name, startMin: s.startMin, durationMin: s.durationMin, active: s.active })))
    setLoaded(true)
  }

  const hours = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

  const save = async () => {
    setSaving(true)
    try {
      await apiPut(`/api/manufacturing/work-centers/${center.id}/calendar`, {
        workDays: workDays.join(','),
        shifts: shifts.filter((s) => s.durationMin > 0),
      })
      toast.success(`${center.code} calendar saved`, { description: `${workDays.length} working day(s) · ${shifts.filter((s) => s.durationMin > 0).length} shift(s)` })
      onSaved()
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{center.code} — shift calendar</DialogTitle>
          <DialogDescription>
            Capacity is the sum of active shift minutes × parallel capacity on a working day. Holidays come out of capacity.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto erp-scroll-y pr-1">
          <div className="space-y-1.5">
            <Label>Working days</Label>
            <div className="flex flex-wrap gap-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, index) => {
                const on = workDays.includes(index)
                return (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    className="h-9"
                    onClick={() => setWorkDays((d) => (on ? d.filter((x) => x !== index) : [...d, index].sort()))}
                  >
                    {label}
                  </Button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Shifts</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1"
                onClick={() => setShifts((s) => [...s, { name: 'OT', startMin: 1020, durationMin: 60, active: true }])}
              >
                <Plus className="size-3.5" aria-hidden /> Add shift
              </Button>
            </div>
            <div className="space-y-2">
              {shifts.map((shift, index) => (
                <div key={index} className="grid grid-cols-2 items-end gap-2 rounded-md border p-2 sm:grid-cols-5">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Name</Label>
                    <Input
                      value={shift.name}
                      onChange={(e) => setShifts((s) => s.map((x, i) => (i === index ? { ...x, name: e.target.value } : x)))}
                      className="h-10"
                      aria-label="Shift name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Start</Label>
                    <Input
                      type="time"
                      value={hours(shift.startMin)}
                      onChange={(e) => {
                        const [hh, mm] = e.target.value.split(':').map(Number)
                        setShifts((s) => s.map((x, i) => (i === index ? { ...x, startMin: (hh || 0) * 60 + (mm || 0) } : x)))
                      }}
                      className="h-10"
                      aria-label="Shift start"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Hours</Label>
                    <Input
                      type="number"
                      min="0"
                      max="24"
                      step="0.5"
                      value={String(r2(shift.durationMin / 60))}
                      onChange={(e) => {
                        const minutes = Math.round(num(e.target.value) * 60)
                        setShifts((s) => s.map((x, i) => (i === index ? { ...x, durationMin: Math.max(1, Math.min(1440, minutes)) } : x)))
                      }}
                      className="h-10 text-right tabular-nums"
                      aria-label="Shift duration in hours"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Ends</Label>
                    <p className="h-10 py-2.5 text-sm tabular-nums">{hours((shift.startMin + shift.durationMin) % 1440)}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10 justify-self-end text-muted-foreground hover:text-destructive"
                    onClick={() => setShifts((s) => (s.length > 1 ? s.filter((_, i) => i !== index) : s))}
                    disabled={shifts.length === 1}
                    aria-label="Remove shift"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Daily capacity: {qtyFmt(r2((shifts.filter((s) => s.durationMin > 0).reduce((sum, s) => sum + s.durationMin, 0) / 60) * center.parallelCapacity))} h
              {' '}({shifts.reduce((sum, s) => sum + s.durationMin, 0)} min × {center.parallelCapacity} parallel)
            </p>
          </div>

          {cal.data?.holidays?.length ? (
            <div className="space-y-1">
              <Label>Holidays</Label>
              <div className="flex flex-wrap gap-1">
                {cal.data.holidays.map((h) => (
                  <Badge key={h.id} variant="secondary">{dateStr(h.date)}{h.reason ? ` · ${h.reason}` : ''}</Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Holiday editing ships with the first shop-floor pilot feedback — capacity already excludes these days.</p>
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button onClick={save} disabled={saving || !workDays.length} className="h-11 min-w-32">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
            Save calendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// OEE
// ===========================================================================

function OeeTab() {
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 13)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(todayISO())
  const report = useApi<OeeReport | null>(`/api/manufacturing/oee?from=${from}&to=${to}`)
  const data = report.data

  if (report.loading) return <TableSkeleton rows={6} cols={7} />
  if (report.error) return <ErrorState error={report.error} onRetry={() => report.reload()} entity="OEE" />
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="oee-from" className="text-xs text-muted-foreground">From</Label>
          <Input id="oee-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="oee-to" className="text-xs text-muted-foreground">To</Label>
          <Input id="oee-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 w-40" />
        </div>
        <Button variant="outline" onClick={() => report.reload()} className="h-11 gap-2">
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard title="OEE" value={`${data.summary.oeePct}%`} icon={Gauge} tone={data.summary.oeePct >= 65 ? 'positive' : data.summary.oeePct >= 40 ? 'warning' : 'negative'} hint={`${data.days} day(s)`} />
        <KpiCard title="Availability" value={`${data.summary.availabilityPct}%`} icon={CalendarClock} hint={`${qtyFmt(r2(data.summary.downtimeMinutes / 60))} h lost`} />
        <KpiCard title="Performance" value={`${data.summary.performancePct}%`} icon={PlayCircle} hint="routed cycle time vs run time" />
        <KpiCard title="Quality" value={`${data.summary.qualityPct}%`} icon={BadgeCheck} hint="good ÷ produced" />
      </div>

      {data.notes.length > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-medium">Read this before trusting the numbers</p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {data.notes.map((n, i) => <li key={i}>• {n}</li>)}
          </ul>
        </Card>
      ) : null}

      <Card className="p-0">
        <CardContent className="p-0">
          <div className="border-b p-3">
            <SectionHeading title="By work centre" description="Availability × performance × quality. Sorted worst first — that is where the money is." />
          </div>
          <div className="max-h-[46dvh] overflow-auto erp-scroll">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Work Center</TableHead>
                  <TableHead className="text-right">Planned (h)</TableHead>
                  <TableHead className="text-right">Downtime (h)</TableHead>
                  <TableHead className="text-right">A</TableHead>
                  <TableHead className="text-right">P</TableHead>
                  <TableHead className="text-right">Q</TableHead>
                  <TableHead className="text-right">OEE</TableHead>
                  <TableHead className="hidden lg:table-cell">Main loss</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byWorkCenter.map((row) => {
                  const worst = Object.entries(row.downtimeByReason).sort((a, b) => b[1] - a[1])[0]
                  return (
                    <TableRow key={row.workCenter}>
                      <TableCell className="max-w-44 truncate">{row.workCenter}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(r2(row.plannedMinutes / 60))}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(r2(row.downtimeMinutes / 60))}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.availabilityPct}%</TableCell>
                      <TableCell className="text-right tabular-nums">{row.performancePct}%</TableCell>
                      <TableCell className="text-right tabular-nums">{row.qualityPct}%</TableCell>
                      <TableCell className={cn('text-right font-semibold tabular-nums', row.oeePct < 40 && 'text-destructive')}>{row.oeePct}%</TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {worst ? `${worst[0].replace(/_/g, ' ')} · ${qtyFmt(r2(worst[1] / 60))} h` : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {data.byWorkCenter.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground">No work centre data in this window.</TableCell></TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="p-0">
        <CardContent className="p-0">
          <div className="border-b p-3">
            <SectionHeading title="Daily trend" description="A day with no completed operation still counts — an idle machine is an availability fact." />
          </div>
          <div className="max-h-[40dvh] overflow-auto erp-scroll">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Downtime (h)</TableHead>
                  <TableHead className="text-right">Good</TableHead>
                  <TableHead className="text-right">Reject</TableHead>
                  <TableHead className="text-right">A</TableHead>
                  <TableHead className="text-right">P</TableHead>
                  <TableHead className="text-right">Q</TableHead>
                  <TableHead className="text-right">OEE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byDay.map((row) => (
                  <TableRow key={row.day}>
                    <TableCell className="tabular-nums">{dateStr(row.day)}</TableCell>
                    <TableCell className="text-right tabular-nums">{qtyFmt(r2(row.downtimeMinutes / 60))}</TableCell>
                    <TableCell className="text-right tabular-nums">{qtyFmt(row.goodQty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{qtyFmt(row.rejectQty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.availabilityPct}%</TableCell>
                    <TableCell className="text-right tabular-nums">{row.performancePct}%</TableCell>
                    <TableCell className="text-right tabular-nums">{row.qualityPct}%</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{row.oeePct}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ===========================================================================
// MRP — multi-level explosion through versioned BOMs, netting, suggestions
// ===========================================================================

/**
 * Planner workspace. A run is a snapshot: it is recomputed on demand, never on
 * read. Suggestions only become documents (DRAFT PR / OPEN work orders) when a
 * user selects them and confirms — nothing posts by itself.
 */
function MrpTab({ onChanged }: { onChanged?: () => void }) {
  const runs = useApi<MrpRunSummary[]>('/api/manufacturing/mrp')
  const projects = useApi<Project[]>('/api/manufacturing/projects')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [asOf, setAsOf] = useState(todayISO())
  const [horizon, setHorizon] = useState('30')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)

  const runList = runs.data ?? []
  const activeProjectList = (projects.data ?? []).filter((p) => p.status === 'PENDING' || p.status === 'RUNNING')

  // Default to the newest plan once the list arrives.
  const detail = useApi<MrpRunDetail | null>(selectedId ? `/api/manufacturing/mrp/${selectedId}` : null)
  const run = detail.data

  const selectedLines = (run?.lines ?? []).filter((l) => picked[l.id])
  const selectedMake = selectedLines.filter((l) => l.suggestion === 'MAKE')
  const selectedBuy = selectedLines.filter((l) => l.suggestion === 'BUY')
  const selectableLines = (run?.lines ?? []).filter((l) => !l.createdDocNo && l.netQty > 0 && l.suggestion !== 'NONE')

  const createRun = async () => {
    setBusy(true)
    try {
      const created = await apiPost<MrpRunSummary>('/api/manufacturing/mrp', {
        asOf: asOf || undefined,
        horizonDays: num(horizon) > 0 ? num(horizon) : undefined,
      })
      toast.success(`${created.runNo} planned`, {
        description: `${created.suggestionCount} suggestion(s) · ${created.shortageItems} item(s) short. Nothing is ordered until you approve.`,
      })
      setPicked({})
      setSelectedId(created.id)
      runs.reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const openDocuments = async () => {
    if (!run) return
    if (selectedLines.length === 0) return toast.error('Select at least one suggestion')
    if (selectedMake.length > 0 && !projectId) return toast.error('Pick the project that will execute the planned work orders')
    setBusy(true)
    try {
      const res = await apiPost<MrpDocumentResult>(`/api/manufacturing/mrp/${run.id}/actions`, {
        action: 'create-documents',
        lineIds: selectedLines.map((l) => l.id),
        projectId: projectId || undefined,
      })
      const parts = [
        res.requisition ? `PR ${res.requisition.reqNo}` : null,
        res.workOrders.length ? `${res.workOrders.length} work order(s)` : null,
      ].filter(Boolean)
      toast.success(`${run.runNo} approved`, {
        description: `${parts.join(' + ') || 'no documents'} created — the requisition still needs submit + approve.`,
      })
      setPicked({})
      setSelectedId(run.id)
      detail.reload()
      runs.reload()
      onChanged?.()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const closeRun = async () => {
    if (!run) return
    setBusy(true)
    try {
      await apiPost(`/api/manufacturing/mrp/${run.id}/actions`, { action: 'close' })
      toast.success(`${run.runNo} closed`)
      detail.reload()
      runs.reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) => setPicked((p) => ({ ...p, [id]: !p[id] }))
  const toggleAll = () => {
    const allOn = selectableLines.length > 0 && selectableLines.every((l) => picked[l.id])
    const next: Record<string, boolean> = { ...picked }
    for (const l of selectableLines) next[l.id] = !allOn
    setPicked(next)
  }

  return (
    <div className="space-y-4">
      <Card className="border-blue-500/30 bg-blue-500/5 p-4">
        <p className="text-sm font-medium">Plan first, order later</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Demand comes from approved sales orders and released work orders, exploded through the approved BOM revision of each
          item. Supply nets own stock → open work orders → approved POs → approved requisitions. Nothing is purchased,
          produced or reserved until you select suggestions and approve them here.
        </p>
      </Card>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="mrp-asof" className="text-xs text-muted-foreground">As of</Label>
          <Input id="mrp-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-11 w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mrp-horizon" className="text-xs text-muted-foreground">Horizon (days)</Label>
          <Input
            id="mrp-horizon"
            type="number"
            inputMode="numeric"
            min="1"
            max="365"
            value={horizon}
            onChange={(e) => setHorizon(e.target.value)}
            className="h-11 w-28 text-right tabular-nums"
          />
        </div>
        <Button onClick={createRun} disabled={busy} className="h-11 gap-2">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          Run MRP
        </Button>
        <div className="ml-auto flex items-end gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Saved plans</Label>
            <Select value={selectedId ?? runList[0]?.id ?? undefined} onValueChange={(v) => { setSelectedId(v); setPicked({}) }}>
              <SelectTrigger className="h-11 data-[size=default]:h-11 w-56">
                <SelectValue placeholder="No plans yet" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {runList.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.runNo} · {r.status} · {dateStr(r.asOf)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!selectedId && runList[0] ? (
            <Button variant="outline" className="h-11" onClick={() => setSelectedId(runList[0].id)}>
              Open latest
            </Button>
          ) : null}
        </div>
      </div>

      {runs.loading ? <TableSkeleton rows={4} cols={6} /> : null}
      {runs.error ? <ErrorState error={runs.error} onRetry={() => runs.reload()} entity="MRP runs" /> : null}

      {!runs.loading && !runs.error && runList.length === 0 ? (
        <EmptyState
          title="No MRP run yet"
          hint="Approve a BOM with a linked output item and confirm a sales order, then run MRP to see buy/make suggestions."
          icon={CalendarClock}
        />
      ) : null}

      {run ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard title="Run" value={run.runNo} icon={CalendarClock} hint={`${dateStr(run.asOf)} · ${run.horizonDays}d`} />
            <KpiCard title="Suggestions" value={String(run.suggestionCount)} icon={PackageSearch} />
            <KpiCard title="Short Items" value={String(run.shortageItems)} icon={XCircle} tone={run.shortageItems ? 'negative' : 'positive'} />
            <KpiCard title="Sales Orders" value={String(run.salesOrderCount)} icon={ClipboardList} hint={`${run.workOrderCount} work order(s)`} />
            <KpiCard
              title="Status"
              value={run.status}
              icon={BadgeCheck}
              tone={run.status === 'CLOSED' ? 'default' : 'positive'}
              hint={run.approvedAt ? `approved ${dateStr(run.approvedAt)}` : 'not approved yet'}
            />
          </div>

          {run.warnings.length > 0 ? (
            <Card className="border-amber-500/40 bg-amber-500/5 p-4">
              <p className="text-sm font-medium">Planner warnings</p>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {run.warnings.map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {run.lines.length === 0 ? (
            <EmptyState title="No demand in this horizon" hint="Nothing is due inside the planning window — widen the horizon or check sales orders." icon={PackageSearch} />
          ) : (
            <>
              <Card className="p-0">
                <CardContent className="p-0">
                  <div className="max-h-[56dvh] overflow-auto erp-scroll">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-card">
                        <TableRow>
                          <TableHead className="w-10">
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              aria-label="Select all suggestions"
                              checked={selectableLines.length > 0 && selectableLines.every((l) => picked[l.id])}
                              onChange={toggleAll}
                            />
                          </TableHead>
                          <TableHead>Item</TableHead>
                          <TableHead className="text-right">Lvl</TableHead>
                          <TableHead className="hidden md:table-cell">Need By</TableHead>
                          <TableHead className="text-right">Gross</TableHead>
                          <TableHead className="text-right hidden sm:table-cell">On Hand</TableHead>
                          <TableHead className="text-right hidden sm:table-cell">Incoming</TableHead>
                          <TableHead className="text-right hidden lg:table-cell">WO Supply</TableHead>
                          <TableHead className="text-right">Net</TableHead>
                          <TableHead>Suggestion</TableHead>
                          <TableHead className="hidden xl:table-cell">Pegging</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {run.lines.map((l) => {
                          const selectable = !l.createdDocNo && l.netQty > 0 && l.suggestion !== 'NONE'
                          return (
                            <TableRow key={l.id} className={cn(!selectable && 'opacity-60')}>
                              <TableCell>
                                <input
                                  type="checkbox"
                                  className="size-4 accent-primary"
                                  aria-label={`Select ${l.item.name}`}
                                  disabled={!selectable}
                                  checked={!!picked[l.id]}
                                  onChange={() => toggle(l.id)}
                                />
                              </TableCell>
                              <TableCell>
                                <span className="block max-w-48 truncate font-medium">{l.item.name}</span>
                                <span className="block text-xs text-muted-foreground tabular-nums">{l.item.code} · {l.item.uom}</span>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{l.level}</TableCell>
                              <TableCell className="hidden whitespace-nowrap tabular-nums md:table-cell">{dateStr(l.needBy)}</TableCell>
                              <TableCell className="text-right tabular-nums">{qtyFmt(l.grossQty)}</TableCell>
                              <TableCell className="hidden text-right tabular-nums sm:table-cell">{qtyFmt(l.onHandQty)}</TableCell>
                              <TableCell className="hidden text-right tabular-nums sm:table-cell">{l.incomingQty > 0 ? qtyFmt(l.incomingQty) : '—'}</TableCell>
                              <TableCell className="hidden text-right tabular-nums lg:table-cell">{l.woSupplyQty > 0 ? qtyFmt(l.woSupplyQty) : '—'}</TableCell>
                              <TableCell className={cn('text-right font-semibold tabular-nums', l.netQty > 0 && 'text-destructive')}>
                                {l.netQty > 0 ? qtyFmt(l.netQty) : '—'}
                              </TableCell>
                              <TableCell>
                                <SuggestionBadge line={l} />
                              </TableCell>
                              <TableCell className="hidden max-w-56 xl:table-cell">
                                <span className="block truncate text-xs text-muted-foreground" title={(l.pegging ?? '').split('\n').join(' · ')}>
                                  {(l.pegging ?? '').split('\n')[0] ?? '—'}
                                </span>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {run.allowDocuments ? (
                <Card className="p-4">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Project for planned work orders</Label>
                      <Select value={projectId || undefined} onValueChange={setProjectId}>
                        <SelectTrigger className="h-11 data-[size=default]:h-11 w-64">
                          <SelectValue placeholder={selectedMake.length ? 'Select project…' : 'Not needed for buy lines'} />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {activeProjectList.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.projectNo} — {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selectedLines.length} selected · {selectedMake.length} make · {selectedBuy.length} buy
                    </div>
                    <div className="ml-auto flex gap-2">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" className="h-11 text-muted-foreground" disabled={busy}>
                            Close plan
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Close {run.runNo}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Closing retires this snapshot. Documents already created from it stay as they are — nothing is cancelled.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="h-11">Keep it open</AlertDialogCancel>
                            <AlertDialogAction onClick={(e) => { e.preventDefault(); void closeRun() }} className="h-11">
                              Close plan
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <Button onClick={openDocuments} disabled={busy || selectedLines.length === 0} className="h-11 gap-2">
                        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BadgeCheck className="size-4" aria-hidden />}
                        Create documents
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Buy lines merge into one DRAFT purchase requisition (submit + approve it in Procurement). Make lines become
                    OPEN work orders with the planned quantity and need-by date.
                  </p>
                </Card>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function SuggestionBadge({ line }: { line: MrpLineRow }) {
  if (line.createdDocNo) {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-3" aria-hidden /> {line.createdDocNo}
      </Badge>
    )
  }
  if (line.suggestion === 'MAKE') return <Badge variant="secondary">MAKE</Badge>
  if (line.suggestion === 'BUY') return <Badge variant="default">BUY</Badge>
  return <Badge variant="outline">NONE</Badge>
}

// ===========================================================================
// Consolidated material plan (MRP-lite)
// ===========================================================================

function MaterialPlanTab() {
  const report = useApi<MaterialPlanReport | null>('/api/manufacturing/material-plan')
  const data = report.data
  if (report.loading) return <TableSkeleton rows={6} cols={7} />
  if (report.error) return <ErrorState error={report.error} onRetry={() => report.reload()} entity="material plan" />
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard title="Active Work Orders" value={String(data.summary.activeWorkOrders)} icon={ClipboardList} />
        <KpiCard title="Materials Planned" value={String(data.summary.materialItems)} icon={PackageSearch} />
        <KpiCard title="Shortage Items" value={String(data.summary.shortageItems)} icon={XCircle} tone={data.summary.shortageItems ? 'negative' : 'positive'} />
        <KpiCard title="Customer Material" value={qtyFmt(data.summary.customerMaterialQty)} icon={BadgeCheck} hint="jobwork qty kept separate" />
      </div>

      <Card className="border-blue-500/30 bg-blue-500/5 p-4">
        <p className="text-sm font-medium">No duplicate stock ownership</p>
        <p className="mt-1 text-xs text-muted-foreground">{data.ownershipRule} Open approved PO quantity is shown separately as future supply; it reduces the projected shortage only and is never counted as on-hand stock before QC acceptance.</p>
      </Card>

      {data.rows.length === 0 ? (
        <EmptyState title="No active material demand" hint="Create an active work order from an approved BOM. Its company-owned material requirement will appear here." icon={PackageSearch} />
      ) : (
        <Card className="p-0">
          <CardContent className="p-0">
            <div className="max-h-[62dvh] overflow-auto erp-scroll">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Demand Sources</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right">Issued</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right">Own Stock</TableHead>
                    <TableHead className="text-right">Open PO</TableHead>
                    <TableHead className="text-right">Shortage Now</TableHead>
                    <TableHead className="text-right">After PO</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row) => (
                    <TableRow key={row.item.id}>
                      <TableCell>
                        <span className="block font-medium">{row.item.name}</span>
                        <span className="text-xs text-muted-foreground">{row.item.code} · {row.item.uom}</span>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-64 space-y-0.5">
                          {row.workOrders.map((wo) => (
                            <p key={wo.id} className="truncate text-xs" title={`${wo.woNo} · ${wo.projectNo} · ${wo.projectName}`}>
                              <span className="font-medium tabular-nums">{wo.woNo}</span> · {wo.projectNo} · {qtyFmt(wo.requiredQty)}
                            </p>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(row.requiredQty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(row.issuedQty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(row.remainingQty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(row.availableQty)}</TableCell>
                      <TableCell className="text-right tabular-nums" title={row.purchaseOrders.map((po) => `${po.poNo}: ${qtyFmt(po.qty)}${po.expectedDate ? ` due ${po.expectedDate.slice(0, 10)}` : ''}`).join('\n')}>
                        {row.incomingQty > 0 ? qtyFmt(row.incomingQty) : '—'}
                      </TableCell>
                      <TableCell className={cn('text-right font-semibold tabular-nums', row.shortageQty > 0 && 'text-destructive')}>
                        {row.shortageQty > 0 ? qtyFmt(row.shortageQty) : '—'}
                      </TableCell>
                      <TableCell className={cn('text-right font-semibold tabular-nums', row.projectedShortageQty > 0 && 'text-amber-700')}>
                        {row.projectedShortageQty > 0 ? qtyFmt(row.projectedShortageQty) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ===========================================================================
// Projects tab
// ===========================================================================

function ProjectsTab({ onChanged }: { onChanged?: () => void }) {
  const setView = useErpUi((s) => s.setView)
  const list = useApi<Project[]>('/api/manufacturing/projects')
  const [createOpen, setCreateOpen] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const rows = list.data ?? []

  return (
    <div className="space-y-4">
      {/* flex-wrap: on phones the description takes the full row and the
          action button wraps below it instead of being squeezed (clipped text). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} project{rows.length === 1 ? '' : 's'} — customer fabrication jobs with budget, BOMs and progress.
        </p>
        <Button onClick={() => setCreateOpen(true)} className="h-11 shrink-0 gap-2">
          <Plus className="size-4" aria-hidden /> New Project
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={5} cols={7} />
          ) : list.error ? (
            <div className="p-6">
              <ErrorState error={list.error} onRetry={() => list.reload()} entity="projects" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No projects yet"
                hint="Create a customer project, then add a BOM and generate work orders."
                icon={FolderKanban}
                action={
                  <Button variant="outline" onClick={() => setCreateOpen(true)} className="mt-2 h-11 gap-2">
                    <Plus className="size-4" aria-hidden /> New Project
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden md:table-cell">Manager</TableHead>
                    <TableHead className="hidden lg:table-cell">Start / Due</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Budget</TableHead>
                    <TableHead className="text-right hidden xl:table-cell">Actual Cost</TableHead>
                    <TableHead className="min-w-32">Progress</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => setView('project-detail', { id: p.id })}
                    >
                      <TableCell>
                        <span className="block font-medium tabular-nums">{p.projectNo}</span>
                        <span className="block max-w-48 truncate text-xs text-muted-foreground">{p.name}</span>
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-40 truncate">{p.party?.name ?? '—'}</span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="block max-w-32 truncate">{p.manager ?? '—'}</span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="block whitespace-nowrap tabular-nums">{dateStr(p.startDate)}</span>
                        <span className={cn('block whitespace-nowrap tabular-nums text-xs', isOverdue(p.endDate) && p.status === 'RUNNING' && 'text-destructive')}>
                          {p.endDate ? `due ${dateStr(p.endDate)}` : 'no due date'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right hidden sm:table-cell">
                        <Money value={p.budget} plain />
                        {p.estCost > 0 ? (
                          <span className="block text-xs text-muted-foreground">est <Money value={p.estCost} plain /></span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right hidden xl:table-cell">
                        <Money value={p.stats.actualCost} plain />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <ProgressBar value={p.stats.progressPct} />
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {p.stats.taskDone}/{p.stats.taskTotal} tasks
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={p.status} />
                          {p.status === 'PENDING' || p.status === 'RUNNING' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-11 sm:h-8 sm:w-auto"
                              aria-label={`Edit ${p.projectNo}`}
                              title="Edit project details"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditProject(p)
                              }}
                            >
                              <Pencil className="size-3.5" aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <NewProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => { list.reload(); onChanged?.() }} />
      {editProject ? (
        <NewProjectDialog
          open={!!editProject}
          onOpenChange={(o) => !o && setEditProject(null)}
          project={editProject}
          onCreated={() => { list.reload(); onChanged?.() }}
        />
      ) : null}
    </div>
  )
}

// ---------- new / edit project dialog ----------

function NewProjectDialog({
  open,
  onOpenChange,
  onCreated,
  project,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
  /** Present = EDIT mode (PUT); absent = CREATE mode (POST). */
  project?: Project
}) {
  const masters = useMasters()
  const customers = masters.parties.filter((p) => p.active && partyTypes(p).includes('CUSTOMER'))
  const editing = !!project
  const [name, setName] = useState(project?.name ?? '')
  const [partyId, setPartyId] = useState(project?.partyId ?? '')
  const [manager, setManager] = useState(project?.manager ?? '')
  const [location, setLocation] = useState(project?.location ?? '')
  const [startDate, setStartDate] = useState(project?.startDate?.slice(0, 10) ?? todayISO())
  const [endDate, setEndDate] = useState(project?.endDate?.slice(0, 10) ?? '')
  const [budget, setBudget] = useState(project ? String(project.budget) : '')
  const [documents, setDocuments] = useState(project?.documents ?? '')
  const [notes, setNotes] = useState(project?.notes ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name.trim()) return toast.error('Project name is required')
    if (!partyId) return toast.error('Pick the customer')
    if (endDate && endDate < startDate) return toast.error('Planned end date cannot be before the start date')
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        manager: manager.trim() || undefined,
        location: location.trim() || undefined,
        startDate,
        endDate: endDate || undefined,
        budget: num(budget),
        documents: documents.trim() || undefined,
        notes: notes.trim() || undefined,
      }
      const res = editing
        ? await apiPut<Project>(`/api/manufacturing/projects/${project!.id}`, body)
        : await apiPost<Project>('/api/manufacturing/projects', { ...body, partyId })
      toast.success(editing ? `${res.projectNo} updated` : `${res.projectNo} created`, {
        description: editing ? 'Project details saved.' : `${res.name} — status PENDING. Add a BOM next.`,
      })
      onCreated()
      onOpenChange(false)
      setName(''); setPartyId(''); setManager(''); setLocation(''); setStartDate(todayISO()); setEndDate(''); setBudget(''); setDocuments(''); setNotes('')
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${project!.projectNo}` : 'New Fabrication Project'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Correct the plan — budget, manager, dates, drawing references.' : 'One project per customer job — budget, manager, drawings reference and dates.'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto erp-scroll-y pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="prj-name">Project Name</Label>
              <Input id="prj-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Steel Structure Fabrication" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Customer</Label>
              {/* The customer link is immutable after creation (estimates, WOs
                  and invoices hang off it) — edit mode locks the field. */}
              <Select value={partyId || undefined} onValueChange={setPartyId} disabled={editing}>
                <SelectTrigger className="h-11 data-[size=default]:h-11 w-full">
                  <SelectValue placeholder="Select customer…" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {customers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prj-manager">Project Manager</Label>
              <Input id="prj-manager" value={manager} onChange={(e) => setManager(e.target.value)} placeholder="Optional" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prj-start">Start Date</Label>
              <Input id="prj-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prj-end">Delivery / End Date</Label>
              <Input id="prj-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prj-budget">Project Budget (₹)</Label>
              <Input id="prj-budget" type="number" inputMode="decimal" min="0" step="any" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prj-loc">Project Location</Label>
              <Input id="prj-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Site / yard" className="h-11" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="prj-docs">Drawing / Technical Documents</Label>
              <Textarea id="prj-docs" value={documents} onChange={(e) => setDocuments(e.target.value)} placeholder="References, e.g. DWG-2025-117 canopy, GA-0042, WPS-D1.1" className="min-h-20" />
              <p className="text-xs text-muted-foreground">Document numbers / links — one per line or comma separated.</p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="prj-notes">Notes</Label>
              <Textarea id="prj-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="min-h-16" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button onClick={save} disabled={saving} className="h-11 min-w-32">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : editing ? <Pencil className="size-4" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            {editing ? 'Save Changes' : 'Create Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Project detail (with the completion process)
// ===========================================================================

export function ProjectDetailView({ id }: { id: string }) {
  const setView = useErpUi((s) => s.setView)
  const detail = useApi<ProjectDetail | null>(id ? `/api/manufacturing/projects/${id}` : null)
  const [busy, setBusy] = useState(false)
  const [bomCreateOpen, setBomCreateOpen] = useState(false)
  const [woFromBom, setWoFromBom] = useState<Bom | null>(null)
  const [taskWo, setTaskWo] = useState<WorkOrder | null>(null)
  const [editProject, setEditProject] = useState<ProjectDetail | null>(null)

  const p = detail.data
  const reload = detail.reload

  const action = async (what: string) => {
    setBusy(true)
    try {
      await apiPost(`/api/manufacturing/projects/${id}/actions`, { action: what })
      toast.success(what === 'start' ? 'Project started — status RUNNING' : what === 'complete' ? 'Project COMPLETED 🎉' : 'Project cancelled')
      reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  if (detail.loading) return <TableSkeleton rows={6} cols={4} />
  if (detail.error) {
    return (
      <EmptyState
        title="Could not load project"
        hint={detail.error}
        icon={XCircle}
        action={<Button variant="outline" className="mt-2 h-11" onClick={() => setView('manufacturing')}>Back to Projects</Button>}
      />
    )
  }
  if (!p) return null

  const openWos = p.workOrders.filter((w) => w.status === 'OPEN' || w.status === 'IN_PROGRESS')
  const activeWos = p.workOrders.filter((w) => w.status !== 'CANCELLED')
  const canComplete = p.status === 'RUNNING' && openWos.length === 0 && activeWos.length > 0
  const allTasksDone = openWos.every((w) => w.tasks.filter((t) => t.status !== 'CANCELLED').every((t) => t.status === 'COMPLETED'))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={() => setView('manufacturing')} className="mb-1 h-9 gap-1.5 px-2 text-muted-foreground">
            <ArrowLeft className="size-4" aria-hidden /> Projects
          </Button>
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span className="tabular-nums">{p.projectNo}</span>
            <span className="truncate">{p.name}</span>
            <StatusBadge status={p.status} />
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {p.party?.name} · {p.manager ? `PM ${p.manager}` : 'no manager'}{p.location ? ` · ${p.location}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(p.status === 'PENDING' || p.status === 'RUNNING') ? (
            <Button variant="outline" onClick={() => setEditProject(p)} disabled={busy} className="h-11 gap-2">
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
          ) : null}
          {p.status === 'PENDING' ? (
            <Button onClick={() => action('start')} disabled={busy} className="h-11 gap-2">
              <PlayCircle className="size-4" aria-hidden /> Start Project
            </Button>
          ) : null}
          {p.status === 'RUNNING' ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={busy || !canComplete} className="h-11 gap-2">
                  <BadgeCheck className="size-4" aria-hidden /> Complete Project
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Complete {p.projectNo}?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div>
                      {canComplete ? (
                        <>
                          All {activeWos.length} work order(s) are completed. Final numbers:
                          <ul className="mt-2 space-y-1 text-sm">
                            <li>Budget (contract): <strong>₹{money(p.stats.budget)}</strong></li>
                            <li>Actual cost: <strong className={p.stats.actualCost > p.stats.budget ? 'text-destructive' : 'text-primary'}>₹{money(p.stats.actualCost)}</strong> (labour ₹{money(p.stats.labourCost)} + material ₹{money(p.stats.materialCost)})</li>
                            <li>Margin: <strong className={p.stats.margin >= 0 ? 'text-primary' : 'text-destructive'}>₹{money(p.stats.margin)}</strong></li>
                          </ul>
                        </>
                      ) : (
                        <p>
                          {openWos.length} work order(s) are still open — complete or cancel them first.
                          {!allTasksDone ? ' Pending tasks remain on the floor.' : ''}
                        </p>
                      )}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-11">Not yet</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={!canComplete}
                    onClick={(e) => {
                      e.preventDefault()
                      void action('complete')
                    }}
                    className="h-11"
                  >
                    Mark COMPLETED
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {(p.status === 'PENDING' || (p.status === 'RUNNING' && activeWos.length === 0)) ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={busy} className="h-11 gap-2 text-destructive hover:text-destructive">
                  <XCircle className="size-4" aria-hidden /> Cancel
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel {p.projectNo}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The project and any dangling work orders/tasks will be cancelled. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-11">Keep it</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault()
                      void action('cancel')
                    }}
                    className="h-11"
                  >
                    Cancel project
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </div>

      {/* KPIs + progress */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard title="Budget (Contract)" value={`₹${money(p.stats.budget)}`} icon={FolderKanban} />
        <KpiCard title="Estimated Cost" value={`₹${money(p.stats.estCost)}`} icon={PackageSearch} hint="from approved BOMs" />
        <KpiCard title="Labour Cost" value={`₹${money(p.stats.labourCost)}`} icon={Wrench} tone="warning" />
        <KpiCard title="Material Cost" value={`₹${money(p.stats.materialCost)}`} icon={PackageSearch} tone="warning" />
        <KpiCard
          title="Margin So Far"
          value={`₹${money(p.stats.margin)}`}
          icon={BadgeCheck}
          tone={p.stats.margin >= 0 ? 'positive' : 'negative'}
          hint="budget − actual cost"
        />
        <KpiCard
          title="Progress"
          value={`${p.stats.progressPct}%`}
          icon={CheckCircle2}
          tone={p.stats.progressPct === 100 ? 'positive' : 'default'}
          hint={`${p.stats.taskDone}/${p.stats.taskTotal} tasks · ${p.stats.pendingTasks} pending`}
        />
      </div>

      {/* Overview */}
      <Card className="p-4">
        <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Start Date</p>
            <p className="mt-0.5 tabular-nums">{dateStr(p.startDate)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Delivery Date</p>
            <p className="mt-0.5 tabular-nums">{p.endDate ? dateStr(p.endDate) : '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Completed On</p>
            <p className="mt-0.5 tabular-nums">{p.completedAt ? dateStr(p.completedAt) : '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer</p>
            <p className="mt-0.5 truncate">{p.party?.name ?? '—'}</p>
          </div>
          {p.documents ? (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Drawings / Technical Documents</p>
              <p className="mt-0.5 whitespace-pre-line">{p.documents}</p>
            </div>
          ) : null}
          {p.notes ? (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
              <p className="mt-0.5 whitespace-pre-line">{p.notes}</p>
            </div>
          ) : null}
        </div>
      </Card>

      {/* BOMs */}
      <Card className="p-0">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Bills of Material</h3>
              <p className="text-xs text-muted-foreground">Material plan per product/assembly — approve before generating work orders.</p>
            </div>
            {p.status !== 'COMPLETED' && p.status !== 'CANCELLED' ? (
              <Button variant="outline" onClick={() => setBomCreateOpen(true)} className="h-11 gap-2">
                <Plus className="size-4" aria-hidden /> New BOM
              </Button>
            ) : null}
          </div>
          {p.boms.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No BOMs yet" hint="Add the material list for this project — plates, pipes, consumables." icon={PackageSearch} />
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>BOM No</TableHead>
                    <TableHead>Product / Assembly</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right">Est Cost</TableHead>
                    <TableHead className="hidden md:table-cell">Stock Check</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.boms.map((b) => {
                    const shortages = b.items.filter((i) => i.shortage > 0)
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium tabular-nums">{b.bomNo}</TableCell>
                        <TableCell>
                          <span className="block max-w-48 truncate">{b.productName}</span>
                          {b.drawingRef ? <span className="block text-xs text-muted-foreground">dwg {b.drawingRef}</span> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{b.items.length}</TableCell>
                        <TableCell className="text-right"><Money value={b.items.reduce((s, i) => s + i.estCost, 0)} plain /></TableCell>
                        <TableCell className="hidden md:table-cell">
                          {b.status === 'APPROVED' ? (
                            shortages.length > 0 ? (
                              <Badge variant="destructive" className="gap-1">
                                <PackageSearch className="size-3" aria-hidden /> {shortages.length} short
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="size-3" aria-hidden /> in stock
                              </Badge>
                            )
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell><StatusBadge status={b.status} /></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {/* Terminal projects cannot approve BOMs — the
                                estimate would never feed a work order (server
                                guard mirrors this check). */}
                            {b.status === 'DRAFT' && p.status !== 'COMPLETED' && p.status !== 'CANCELLED' ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 gap-1"
                                disabled={busy}
                                onClick={async () => {
                                  setBusy(true)
                                  try {
                                    await apiPost(`/api/manufacturing/boms/${b.id}/actions`, { action: 'approve' })
                                    toast.success(`${b.bomNo} approved`, { description: 'Project estimated cost recalculated.' })
                                    reload()
                                  } catch (e) {
                                    toastError(e)
                                  } finally {
                                    setBusy(false)
                                  }
                                }}
                              >
                                <BadgeCheck className="size-3.5" aria-hidden /> Approve
                              </Button>
                            ) : null}
                            {b.status === 'APPROVED' && p.status !== 'COMPLETED' && p.status !== 'CANCELLED' ? (
                              <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setWoFromBom(b)}>
                                <ClipboardList className="size-3.5" aria-hidden /> Work Order
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Work orders + tasks */}
      <Card className="p-0">
        <CardContent className="p-0">
          <div className="border-b px-4 py-3">
            <h3 className="text-sm font-semibold">Work Orders & Production Tasks</h3>
            <p className="text-xs text-muted-foreground">
              Operation tasks per work order — assign → start → complete (records actual/rejection/hours/material).
            </p>
          </div>
          {p.workOrders.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No work orders yet" hint="Approve a BOM and generate the first work order." icon={ClipboardList} />
            </div>
          ) : (
            <div className="divide-y">
              {p.workOrders.map((w) => {
                const active = w.tasks.filter((t) => t.status !== 'CANCELLED')
                const done = active.filter((t) => t.status === 'COMPLETED').length
                const woDone = active.length > 0 && done === active.length
                return (
                  <div key={w.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span className="tabular-nums">{w.woNo}</span>
                          <PriorityBadge priority={w.priority} />
                          <StatusBadge status={w.status} />
                          {w.bom ? <span className="text-xs text-muted-foreground">from {w.bom.bomNo}</span> : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {w.lines.length} line(s) · {w.startDate ? `start ${dateStr(w.startDate)}` : 'unscheduled'}
                          {w.endDate ? ` → ${dateStr(w.endDate)}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-28 space-y-1">
                          <ProgressBar value={active.length ? (done / active.length) * 100 : 0} />
                          <p className="text-right text-[11px] tabular-nums text-muted-foreground">{done}/{active.length}</p>
                        </div>
                        {(w.status === 'OPEN' || w.status === 'IN_PROGRESS') ? (
                          <>
                            <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setTaskWo(w)}>
                              <Plus className="size-3.5" aria-hidden /> Task
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 gap-1"
                              disabled={!woDone || busy}
                              title={woDone ? 'All tasks completed' : 'Complete the pending tasks first'}
                              onClick={async () => {
                                setBusy(true)
                                try {
                                  await apiPost(`/api/manufacturing/work-orders/${w.id}/actions`, { action: 'complete' })
                                  toast.success(`${w.woNo} COMPLETED`)
                                  reload()
                                } catch (e) {
                                  toastError(e)
                                } finally {
                                  setBusy(false)
                                }
                              }}
                            >
                              <BadgeCheck className="size-3.5" aria-hidden /> Close WO
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {w.tasks.length > 0 ? (
                      <div className="overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Task</TableHead>
                              <TableHead>Operation</TableHead>
                              <TableHead>Worker</TableHead>
                              <TableHead className="text-right">Planned</TableHead>
                              <TableHead className="text-right hidden sm:table-cell">Actual / Rej</TableHead>
                              <TableHead className="text-right hidden lg:table-cell">Cost</TableHead>
                              <TableHead>Due</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {w.tasks.map((t) => (
                              <TableRow key={t.id}>
                                <TableCell className="font-medium tabular-nums">{t.taskNo}</TableCell>
                                <TableCell className="whitespace-nowrap">{operationLabel(t.operation)}</TableCell>
                                <TableCell>
                                  {t.employee ? (
                                    <span className="block max-w-32 truncate">{t.employee.name}</span>
                                  ) : (
                                    <span className="text-muted-foreground">unassigned</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{qtyFmt(t.plannedQty)}</TableCell>
                                <TableCell className="text-right tabular-nums hidden sm:table-cell">
                                  {t.status === 'COMPLETED' ? (
                                    <>
                                      {qtyFmt(t.actualQty)}
                                      {t.rejectionQty > 0 ? <span className="text-destructive"> / −{qtyFmt(t.rejectionQty)}</span> : ''}
                                    </>
                                  ) : (
                                    '—'
                                  )}
                                </TableCell>
                                <TableCell className="text-right hidden lg:table-cell">
                                  {t.labourCost + t.materialCost > 0 ? <Money value={t.labourCost + t.materialCost} plain /> : '—'}
                                </TableCell>
                                <TableCell><DueCell due={t.dueDate} overdue={t.status !== 'COMPLETED' && isOverdue(t.dueDate)} /></TableCell>
                                <TableCell><StatusBadge status={t.status} /></TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No tasks yet — add the first operation task.</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {bomCreateOpen ? (
        <NewBomDialog
          open={bomCreateOpen}
          onOpenChange={setBomCreateOpen}
          projectId={p.id}
          projectLabel={`${p.projectNo} — ${p.name}`}
          onApproved={reload}
        />
      ) : null}
      {woFromBom ? (
        <GenerateWoDialog
          bom={woFromBom}
          open={!!woFromBom}
          onOpenChange={(o) => !o && setWoFromBom(null)}
          onCreated={reload}
        />
      ) : null}
      {taskWo ? (
        <NewTaskDialog
          open={!!taskWo}
          onOpenChange={(o) => !o && setTaskWo(null)}
          fixedWo={taskWo}
          onCreated={reload}
        />
      ) : null}
      {editProject ? (
        <NewProjectDialog
          open={!!editProject}
          onOpenChange={(o) => !o && setEditProject(null)}
          project={editProject}
          onCreated={reload}
        />
      ) : null}
    </div>
  )
}

// ===========================================================================
// BOMs tab
// ===========================================================================

function BomsTab({ onChanged }: { onChanged?: () => void }) {
  const setView = useErpUi((s) => s.setView)
  const list = useApi<Bom[]>('/api/manufacturing/boms')
  const [createOpen, setCreateOpen] = useState(false)
  const [viewBom, setViewBom] = useState<Bom | null>(null)
  const [woFromBom, setWoFromBom] = useState<Bom | null>(null)
  const [reviseFrom, setReviseFrom] = useState<Bom | null>(null)
  const [routingFor, setRoutingFor] = useState<Bom | null>(null)
  const [statusFilter, setStatusFilter] = useState('live')
  const [busy, setBusy] = useState(false)
  const rows = list.data ?? []

  const liveRows = rows.filter((b) => b.status !== 'SUPERSEDED' && b.status !== 'CANCELLED')
  const visibleRows = statusFilter === 'all' ? rows : statusFilter === 'live' ? liveRows : rows.filter((b) => b.status === statusFilter)

  const approve = async (b: Bom) => {
    setBusy(true)
    try {
      const res = await apiPost<Bom & { supersededBomNo?: string | null }>(`/api/manufacturing/boms/${b.id}/actions`, { action: 'approve' })
      toast.success(`${b.bomNo} rev ${b.revision} approved`, {
        description: res.supersededBomNo
          ? `${res.supersededBomNo} was superseded — project cost recalculated, MRP now explodes this revision.`
          : 'Project estimated cost recalculated — MRP will explode this revision.',
      })
      list.reload()
      onChanged?.()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const cancelBom = async (b: Bom) => {
    setBusy(true)
    try {
      await apiPost(`/api/manufacturing/boms/${b.id}/actions`, { action: 'cancel' })
      toast.success(`${b.bomNo} cancelled`)
      list.reload()
      onChanged?.()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {liveRows.length} live row{liveRows.length === 1 ? '' : 's'} · {rows.length} total — approve to unlock work orders; an
          approved revision is immutable, revise it to change the design.
        </p>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-11 data-[size=default]:h-11 w-40" aria-label="Filter BOM status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="live">Live only</SelectItem>
              <SelectItem value="all">All revisions</SelectItem>
              <SelectItem value="DRAFT">Drafts</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="SUPERSEDED">Superseded</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)} className="h-11 shrink-0 gap-2">
            <Plus className="size-4" aria-hidden /> New BOM
          </Button>
        </div>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : list.error ? (
            <div className="p-6">
              <ErrorState error={list.error} onRetry={() => list.reload()} entity="BOMs" />
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No BOMs yet" hint="Pick a project, choose the output item it makes, then list the materials." icon={PackageSearch} />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>BOM No</TableHead>
                    <TableHead>Output Item</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Est Cost</TableHead>
                    <TableHead className="hidden md:table-cell">Stock Check</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((b) => {
                    const shortages = b.items.filter((i) => i.shortage > 0)
                    return (
                      <TableRow key={b.id} className="cursor-pointer" onClick={() => setViewBom(b)}>
                        <TableCell>
                          <span className="block font-medium tabular-nums">{b.bomNo}</span>
                          <Badge variant="outline" className="mt-0.5 tabular-nums">rev {b.revision}</Badge>
                        </TableCell>
                        <TableCell>
                          {b.item ? (
                            <>
                              <span className="block max-w-40 truncate">{b.item.name}</span>
                              <span className="block text-xs text-muted-foreground tabular-nums">{b.item.code}</span>
                            </>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <TriangleAlertIcon /> no output item
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="block max-w-36 truncate tabular-nums">{b.project?.projectNo}</span>
                          <span className="block max-w-36 truncate text-xs text-muted-foreground">{b.project?.name}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{b.items.length}</TableCell>
                        <TableCell className="text-right hidden sm:table-cell"><Money value={b.totalEstCost} plain /></TableCell>
                        <TableCell className="hidden md:table-cell">
                          {shortages.length > 0 ? (
                            <Badge variant="destructive" className="gap-1">
                              <PackageSearch className="size-3" aria-hidden /> {shortages.length} short
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 border-emerald-600/40 text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="size-3" aria-hidden /> ok
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={b.status} />
                          {b.supersededBy ? (
                            <span className="mt-0.5 block text-[10px] text-muted-foreground">→ {b.supersededBy.bomNo}</span>
                          ) : null}
                          {b.supersedes ? (
                            <span className="mt-0.5 block text-[10px] text-muted-foreground">from rev {b.supersedes.revision}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {b.status === 'DRAFT' ? (
                              <Button variant="outline" size="sm" className="h-9 gap-1" disabled={busy} onClick={() => approve(b)}>
                                <BadgeCheck className="size-3.5" aria-hidden /> Approve
                              </Button>
                            ) : null}
                            {b.status === 'APPROVED' ? (
                              <>
                                <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setWoFromBom(b)}>
                                  <ClipboardList className="size-3.5" aria-hidden /> Work Order
                                </Button>
                                <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setReviseFrom(b)}>
                                  <Pencil className="size-3.5" aria-hidden /> Revise
                                </Button>
                              </>
                            ) : null}
                            <Button variant="ghost" size="sm" className="h-9 gap-1" onClick={() => setRoutingFor(b)}>
                              <Wrench className="size-3.5" aria-hidden /> Route
                            </Button>
                            {b.status !== 'CANCELLED' && b.status !== 'SUPERSEDED' ? (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-9 gap-1 text-destructive hover:text-destructive" disabled={busy}>
                                    <XCircle className="size-3.5" aria-hidden /> Cancel
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Cancel {b.bomNo} rev {b.revision}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      The BOM will be voided and its estimate removed from the project cost. Active work orders generated
                                      from it must be cancelled first. This cannot be undone — to change an approved design, revise it instead.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel className="h-11">Keep it</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={(e) => {
                                        e.preventDefault()
                                        void cancelBom(b)
                                      }}
                                      className="h-11"
                                    >
                                      Cancel BOM
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {createOpen ? (
        <NewBomDialog open={createOpen} onOpenChange={setCreateOpen} onApproved={() => { list.reload(); onChanged?.(); setView('manufacturing') }} />
      ) : null}
      {viewBom ? (
        <BomLinesDialog bom={viewBom} open={!!viewBom} onOpenChange={(o) => !o && setViewBom(null)} />
      ) : null}
      {woFromBom ? (
        <GenerateWoDialog bom={woFromBom} open={!!woFromBom} onOpenChange={(o) => !o && setWoFromBom(null)} onCreated={() => { setView('manufacturing'); onChanged?.() }} />
      ) : null}
      {routingFor ? (
        <RoutingDialog bom={routingFor} open={!!routingFor} onOpenChange={(o) => !o && setRoutingFor(null)} onSaved={() => list.reload()} />
      ) : null}
      {reviseFrom ? (
        <ReviseBomDialog
          bom={reviseFrom}
          open={!!reviseFrom}
          onOpenChange={(o) => !o && setReviseFrom(null)}
          onDone={() => { setView('manufacturing'); list.reload(); onChanged?.() }}
        />
      ) : null}
    </div>
  )
}

function TriangleAlertIcon() {
  return <XCircle className="size-3" aria-hidden />
}

// ---------- revise an approved BOM (new DRAFT revision) ----------

function ReviseBomDialog({ bom, open, onOpenChange, onDone }: { bom: Bom; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [notes, setNotes] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const rev = await apiPost<Bom>(`/api/manufacturing/boms/${bom.id}/actions`, {
        action: 'revise',
        notes: notes.trim() || undefined,
        effectiveFrom: effectiveFrom || undefined,
      })
      toast.success(`${rev.bomNo} rev ${rev.revision} created (DRAFT)`, {
        description: 'Edit the lines, then approve it — approval supersedes the current revision.',
      })
      onDone()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Revise {bom.bomNo} (rev {bom.revision})</DialogTitle>
          <DialogDescription>
            Creates revision {bom.revision + 1} as a DRAFT copy. The current approved revision stays live and keep producing until
            you approve the new one — then it is superseded automatically. Approved BOMs are never edited in place.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rev-eff">Effective From</Label>
            <Input id="rev-eff" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="h-11" />
            <p className="text-xs text-muted-foreground">Optional. Leave blank to use the approval date.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev-notes">Change reason (ECO)</Label>
            <Textarea id="rev-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 8mm gusset instead of 6mm, per customer drawing B" className="min-h-16" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button onClick={save} disabled={saving} className="h-11 min-w-32">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Pencil className="size-4" aria-hidden />}
            Create revision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- new BOM dialog (line editor with live est cost) ----------

interface BomDraftRow {
  key: number
  itemId: string
  grade: string
  thickness: string
  length: string
  width: string
  qty: string
  wastagePct: string
  rate: string
  drawingRef: string
}

let bomSeq = 0
const emptyBomRow = (): BomDraftRow => ({ key: ++bomSeq, itemId: '', grade: '', thickness: '', length: '', width: '', qty: '', wastagePct: '', rate: '', drawingRef: '' })

function NewBomDialog({
  open,
  onOpenChange,
  projectId,
  projectLabel,
  onApproved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  projectId?: string
  projectLabel?: string
  onApproved: () => void
}) {
  const projects = useApi<Project[]>('/api/manufacturing/projects')
  const masters = useMasters()
  const items = masters.items.filter((i) => i.active && i.isStockItem)
  const activeProjects = (projects.data ?? []).filter((p) => p.status === 'PENDING' || p.status === 'RUNNING')

  const [pid, setPid] = useState(projectId ?? '')
  const [outputItemId, setOutputItemId] = useState('')
  const [productName, setProductName] = useState('')
  const [drawingRef, setDrawingRef] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<BomDraftRow[]>([emptyBomRow()])
  const [saving, setSaving] = useState(false)

  const setRow = (key: number, patch: Partial<BomDraftRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const itemMap = useMemo(() => new Map(masters.items.map((i) => [i.id, i])), [masters.items])
  // The output item is what the BOM makes (FG / sub-assembly). Any active,
  // non-service catalog item can be made, so the picker is not narrowed to
  // stock items — fabricated assemblies are often tracked as FG items.
  const outputItems = masters.items.filter((i) => i.active && !i.isService)

  const validRows = rows.filter((r) => r.itemId && num(r.qty) > 0)
  const totalEst = validRows.reduce((s, r) => {
    const it = itemMap.get(r.itemId)
    const rate = num(r.rate) > 0 ? num(r.rate) : (it?.costRate ?? 0)
    return s + num(r.qty) * (1 + num(r.wastagePct) / 100) * rate
  }, 0)

  const save = async () => {
    if (!pid) return toast.error('Pick the project')
    if (!outputItemId) return toast.error('Pick the output item this BOM makes')
    if (validRows.some((r) => r.itemId === outputItemId)) return toast.error('The output item cannot also be a component of its own BOM')
    if (!productName.trim()) return toast.error('Product / assembly name is required')
    if (validRows.length === 0) return toast.error('Add at least one material line with quantity')
    setSaving(true)
    try {
      const res = await apiPost<Bom>('/api/manufacturing/boms', {
        projectId: pid,
        itemId: outputItemId,
        productName: productName.trim(),
        drawingRef: drawingRef.trim() || undefined,
        effectiveFrom: effectiveFrom || undefined,
        notes: notes.trim() || undefined,
        lines: validRows.map((r) => {
          const it = itemMap.get(r.itemId)!
          return {
            itemId: r.itemId,
            grade: r.grade.trim() || undefined,
            thickness: num(r.thickness),
            length: num(r.length),
            width: num(r.width),
            qty: num(r.qty),
            uom: it.uom,
            wastagePct: num(r.wastagePct),
            rate: num(r.rate) > 0 ? num(r.rate) : undefined,
            drawingRef: r.drawingRef.trim() || undefined,
          }
        }),
      })
      toast.success(`${res.bomNo} created (DRAFT)`, {
        description: `${validRows.length} material lines — approve it to lock the plan and enable work orders.`,
      })
      onApproved()
      onOpenChange(false)
      setProductName(''); setDrawingRef(''); setNotes(''); setOutputItemId(''); setEffectiveFrom('')
      setRows([emptyBomRow()])
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>New Bill of Materials</DialogTitle>
          <DialogDescription>
            {projectLabel ? `Project ${projectLabel}` : 'Pick the project, then list every material with grade, size and wastage.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto erp-scroll-y pr-1">
          <div className="grid gap-4 sm:grid-cols-3">
            {!projectId ? (
              <div className="space-y-1.5">
                <Label>Project</Label>
                <Select value={pid || undefined} onValueChange={setPid}>
                  <SelectTrigger className="h-11 data-[size=default]:h-11 w-full">
                    <SelectValue placeholder="Select project…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {activeProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.projectNo} — {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className={`space-y-1.5 ${projectId ? 'sm:col-span-2' : 'sm:col-span-2'}`}>
              <Label>Output Item (what this BOM makes)</Label>
              <Select
                value={outputItemId || undefined}
                onValueChange={(v) => {
                  setOutputItemId(v)
                  if (!productName.trim()) setProductName(itemMap.get(v)?.name ?? '')
                }}
              >
                <SelectTrigger className="h-11 data-[size=default]:h-11 w-full">
                  <SelectValue placeholder="Select finished item…" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {outputItems.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.code} — {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                MRP explodes sales-order demand through this link. A BOM without an output item cannot be approved.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bom-product">Product / Assembly Name</Label>
              <Input id="bom-product" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Canopy Frame — Level 1" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bom-dwg">Drawing Reference</Label>
              <Input id="bom-dwg" value={drawingRef} onChange={(e) => setDrawingRef(e.target.value)} placeholder="Optional" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bom-eff">Effective From</Label>
              <Input id="bom-eff" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="h-11" />
            </div>
          </div>

          {/* Mobile: stacked cards */}
          <div className="space-y-3 sm:hidden">
            {rows.map((r) => {
              const it = itemMap.get(r.itemId)
              return (
                <div key={r.key} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Select value={r.itemId || undefined} onValueChange={(v) => setRow(r.key, { itemId: v, rate: r.rate || String(itemMap.get(v)?.costRate ?? '') })}>
                        <SelectTrigger className="h-11 data-[size=default]:h-11 w-full" aria-label={`Material for line ${r.key}`}>
                          <SelectValue placeholder="Pick material…" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {items.map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.code} — {i.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                      disabled={rows.length === 1}
                      aria-label={`Remove line ${r.key}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Grade</Label>
                      <Input value={r.grade} onChange={(e) => setRow(r.key, { grade: e.target.value })} placeholder="IS2062" className="h-11" aria-label="Material grade" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Thickness (mm)</Label>
                      <Input type="number" inputMode="decimal" min="0" step="any" value={r.thickness} onChange={(e) => setRow(r.key, { thickness: e.target.value })} className="h-11 text-right tabular-nums" aria-label="Thickness" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Qty ({it?.uom ?? '—'})</Label>
                      <Input type="number" inputMode="decimal" min="0" step="any" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} placeholder="0" className="h-11 text-right tabular-nums" aria-label="Required quantity" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Wastage %</Label>
                      <Input type="number" inputMode="decimal" min="0" max="50" step="any" value={r.wastagePct} onChange={(e) => setRow(r.key, { wastagePct: e.target.value })} placeholder="0" className="h-11 text-right tabular-nums" aria-label="Wastage percentage" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Rate (₹)</Label>
                      <Input type="number" inputMode="decimal" min="0" step="any" value={r.rate} onChange={(e) => setRow(r.key, { rate: e.target.value })} placeholder={String(it?.costRate ?? 0)} className="h-11 text-right tabular-nums" aria-label="Rate" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Dwg Ref</Label>
                      <Input value={r.drawingRef} onChange={(e) => setRow(r.key, { drawingRef: e.target.value })} placeholder="Optional" className="h-11" aria-label="Drawing reference" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop: row editor */}
          <div className="hidden overflow-x-auto rounded-md border sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-44">Material</TableHead>
                  <TableHead className="w-24">Grade</TableHead>
                  <TableHead className="w-24 text-right">Thk (mm)</TableHead>
                  <TableHead className="w-28 text-right">Qty</TableHead>
                  <TableHead className="w-24 text-right">Wastage %</TableHead>
                  <TableHead className="w-28 text-right">Rate (₹)</TableHead>
                  <TableHead className="w-28 text-right">Est Cost</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const it = itemMap.get(r.itemId)
                  const rate = num(r.rate) > 0 ? num(r.rate) : (it?.costRate ?? 0)
                  const est = num(r.qty) * (1 + num(r.wastagePct) / 100) * rate
                  return (
                    <TableRow key={r.key}>
                      <TableCell>
                        <Select value={r.itemId || undefined} onValueChange={(v) => setRow(r.key, { itemId: v, rate: r.rate || String(itemMap.get(v)?.costRate ?? '') })}>
                          <SelectTrigger className="h-11 data-[size=default]:h-11 w-full min-w-40">
                            <SelectValue placeholder="Pick material…" />
                          </SelectTrigger>
                          <SelectContent className="max-h-64">
                            {items.map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.code} — {i.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input value={r.grade} onChange={(e) => setRow(r.key, { grade: e.target.value })} placeholder="IS2062" className="h-11" aria-label="Material grade" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" inputMode="decimal" min="0" step="any" value={r.thickness} onChange={(e) => setRow(r.key, { thickness: e.target.value })} className="h-11 text-right tabular-nums" aria-label="Thickness in mm" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" inputMode="decimal" min="0" step="any" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} placeholder="0" className="h-11 text-right tabular-nums" aria-label={`Quantity in ${it?.uom ?? 'units'}`} />
                        {it ? <span className="mt-0.5 block text-[10px] text-muted-foreground">{it.uom}</span> : null}
                      </TableCell>
                      <TableCell>
                        <Input type="number" inputMode="decimal" min="0" max="50" step="any" value={r.wastagePct} onChange={(e) => setRow(r.key, { wastagePct: e.target.value })} placeholder="0" className="h-11 text-right tabular-nums" aria-label="Wastage percentage" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" inputMode="decimal" min="0" step="any" value={r.rate} onChange={(e) => setRow(r.key, { rate: e.target.value })} placeholder={String(it?.costRate ?? 0)} className="h-11 text-right tabular-nums" aria-label="Rate" />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {r.itemId && num(r.qty) > 0 ? `₹${money(r2(est))}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 text-muted-foreground hover:text-destructive"
                          onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                          disabled={rows.length === 1}
                          aria-label={`Remove line ${r.key}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <Button variant="outline" onClick={() => setRows((rs) => [...rs, emptyBomRow()])} className="h-11 w-full gap-2 border-dashed">
            <Plus className="size-4" aria-hidden /> Add material line
          </Button>

          <div className="space-y-1.5">
            <Label htmlFor="bom-notes">Notes</Label>
            <Textarea id="bom-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="min-h-16" />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          <div className="text-sm text-muted-foreground">
            {validRows.length} line(s) · Est total <span className="font-semibold text-foreground tabular-nums">₹{money(r2(totalEst))}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
            <Button onClick={save} disabled={saving} className="h-11 min-w-32">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              Create BOM
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- BOM lines viewer (with MRP stock check) ----------

function BomLinesDialog({ bom, open, onOpenChange }: { bom: Bom; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [usedItem, setUsedItem] = useState<{ id: string; label: string } | null>(null)
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {bom.bomNo} rev {bom.revision} — {bom.productName}
          </DialogTitle>
          <DialogDescription>
            {bom.project?.projectNo} · makes {bom.item ? `${bom.item.code} (${bom.item.name})` : 'an unlinked item'} ·{' '}
            {bom.items.length} line(s) · gross = qty + wastage. Stock check against current inventory.
            {bom.effectiveFrom ? ` Effective ${dateStr(bom.effectiveFrom)}${bom.effectiveTo ? ` → ${dateStr(bom.effectiveTo)}` : ' → open'}.` : ''}
            {bom.supersedes ? ` Supersedes ${bom.supersedes.bomNo} rev ${bom.supersedes.revision}.` : ''}
            {bom.supersededBy ? ` Superseded by ${bom.supersededBy.bomNo} rev ${bom.supersededBy.revision}.` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto erp-scroll-y">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead className="hidden sm:table-cell">Grade / Size</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">+ Wastage</TableHead>
                <TableHead className="text-right">In Stock</TableHead>
                <TableHead className="text-right">Est Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bom.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="block max-w-44 truncate text-left hover:underline focus-visible:underline"
                      title="Show where this material is used"
                      onClick={() => setUsedItem({ id: i.itemId, label: `${i.item.code} — ${i.item.name}` })}
                    >
                      {i.item.name}
                    </button>
                    <span className="block text-xs tabular-nums text-muted-foreground">{i.item.code}</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span className="block">{i.grade ?? '—'}</span>
                    {i.thickness > 0 ? (
                      <span className="block text-xs text-muted-foreground">
                        {i.thickness}mm
                        {i.length > 0 || i.width > 0 ? ` × ${i.length || '—'} × ${i.width || '—'}` : ''}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{qtyFmt(i.qty)} <span className="text-xs text-muted-foreground">{i.uom}</span></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {qtyFmt(i.grossQty)}
                    <span className="block text-[10px] text-muted-foreground">{i.wastagePct}%</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {qtyFmt(i.avail)}
                    {i.shortage > 0 ? (
                      <span className="block text-[10px] font-medium text-destructive">short {qtyFmt(i.shortage)}</span>
                    ) : (
                      <span className="block text-[10px] text-emerald-600 dark:text-emerald-400">ok</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right"><Money value={i.estCost} plain /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <DialogFooter>
          <p className="mr-auto text-sm text-muted-foreground">
            Total est: <span className="font-semibold text-foreground">₹{money(bom.totalEstCost)}</span>
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {usedItem ? (
      <WhereUsedDialog itemId={usedItem.id} label={usedItem.label} open={!!usedItem} onOpenChange={(o) => !o && setUsedItem(null)} />
    ) : null}
    </>
  )
}

// ---------- costing: standard vs actual roll-up ----------

function CostStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function CostingTab() {
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 59)
    return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(todayISO())
  const report = useApi<CostingReport | null>(`/api/manufacturing/costing?from=${from}&to=${to}`)
  const [openWo, setOpenWo] = useState<WorkOrderCostRow | null>(null)
  const [trueUpFor, setTrueUpFor] = useState<WorkOrderCostRow | null>(null)
  const [busy, setBusy] = useState(false)
  const data = report.data

  const trueUp = async () => {
    if (!trueUpFor) return
    setBusy(true)
    try {
      const res = await apiPost<{ woNo: string; posted: number; date: string | null; overheadRatePct: number }>(
        `/api/manufacturing/costing/${trueUpFor.id}`,
        { action: 'true-up' }
      )
      toast.success(
        Math.abs(res.posted) < 0.005 ? `${res.woNo} already matches the ${res.overheadRatePct}% rate` : `${res.woNo} overhead restated`,
        { description: Math.abs(res.posted) < 0.005 ? 'Nothing to post.' : `${res.posted > 0 ? '+' : ''}${money(res.posted)} posted on ${res.date}.` }
      )
      setTrueUpFor(null)
      report.reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  if (report.loading) return <TableSkeleton rows={6} cols={8} />
  if (report.error) return <ErrorState error={report.error} onRetry={() => report.reload()} entity="costing" />
  if (!data) return null

  const s = data.summary

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="cost-from" className="text-xs text-muted-foreground">From</Label>
          <Input id="cost-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cost-to" className="text-xs text-muted-foreground">To</Label>
          <Input id="cost-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 w-40" />
        </div>
        <Button variant="outline" onClick={() => report.reload()} className="h-11 gap-2">
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </Button>
        <p className="text-xs text-muted-foreground">
          Overhead absorption is <span className="font-medium text-foreground">{data.overheadRatePct}%</span> of
          material + labour — {data.overheadRatePct === 0 ? 'set it in Masters → Company to cost work properly.' : 'change it in Masters → Company.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard title="Standard" value={`₹${money(s.standardCost)}`} icon={ClipboardList} hint={`${s.measuredCount} measured order(s)`} />
        <KpiCard title="Actual" value={`₹${money(s.actualCost)}`} icon={Wrench} hint="material + labour + overhead" />
        <KpiCard
          title="Variance"
          value={`₹${money(s.variance)}`}
          icon={s.variance > 0 ? XCircle : BadgeCheck}
          tone={s.variance > 0 ? 'negative' : 'positive'}
          hint={s.variancePct === null ? 'no standard to compare' : `${s.variancePct}% vs standard`}
        />
        <KpiCard
          title="Overhead absorbed"
          value={`₹${money(s.overheadCost)}`}
          icon={Building2}
          hint={`${data.overheadRatePct}% of prime cost`}
        />
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          <div className="border-b p-3">
            <SectionHeading
              title="Work orders: standard vs actual"
              description="Standard is the approved revision's material + routed labour, pro-rated to the units received. Actual is what the floor recorded — click a row for the operation breakdown."
            />
          </div>
          <div className="max-h-[52dvh] overflow-auto erp-scroll">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Work order</TableHead>
                  <TableHead className="hidden md:table-cell">BOM</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Standard</TableHead>
                  <TableHead className="text-right">Material</TableHead>
                  <TableHead className="text-right">Labour</TableHead>
                  <TableHead className="text-right">Overhead</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => setOpenWo(row)}>
                    <TableCell>
                      <div className="font-medium">{row.woNo}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.status.toLowerCase()} · {row.project?.name ?? 'no project'}
                        {!row.hasRouting ? ' · no routing' : ''}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-xs md:table-cell">
                      {row.bomNo ? `${row.bomNo} rev ${row.revision}` : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {qtyFmt(row.acceptedQty)}
                      <span className="text-xs text-muted-foreground"> / {qtyFmt(row.outputQty)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.variance === null ? <span className="text-muted-foreground">not measured</span> : <Money value={row.standardCost} />}
                    </TableCell>
                    <TableCell className="text-right tabular-nums"><Money value={row.materialCost} /></TableCell>
                    <TableCell className="text-right tabular-nums"><Money value={row.labourCost} /></TableCell>
                    <TableCell className="text-right tabular-nums"><Money value={row.overheadCost} /></TableCell>
                    <TableCell className={cn('text-right font-medium tabular-nums', row.variance !== null && row.variance > 0 && 'text-destructive', row.variance !== null && row.variance < 0 && 'text-primary')}>
                      {row.variance === null ? '—' : <Money value={row.variance} />}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 gap-1"
                        onClick={() => setTrueUpFor(row)}
                        disabled={row.overheadCost === 0 && data.overheadRatePct === 0}
                        title="Restate absorbed overhead to the current rate"
                      >
                        <RefreshCw className="size-3.5" aria-hidden /> True-up
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {data.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">No work orders in this window.</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-500/40 bg-amber-500/5 p-4">
        <p className="text-sm font-medium">What these numbers can and cannot tell you</p>
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {data.limitations.map((note, i) => <li key={i}>• {note}</li>)}
          <li>• An order with nothing received yet shows “not measured” — there is no produced quantity to standardise against.</li>
        </ul>
      </Card>

      {openWo ? (
        <Dialog open={!!openWo} onOpenChange={(o) => !o && setOpenWo(null)}>
          <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{openWo.woNo} — cost breakdown</DialogTitle>
              <DialogDescription>
                {openWo.bomNo ? `${openWo.bomNo} rev ${openWo.revision}` : 'No BOM'} · {qtyFmt(openWo.acceptedQty)} of{' '}
                {qtyFmt(openWo.outputQty)} accepted · {qtyFmt(openWo.hours)} hours recorded
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto erp-scroll-y pr-1">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <CostStat label="Standard / unit" value={`₹${money(openWo.standardPerUnit)}`} />
                <CostStat label="Material std / unit" value={`₹${money(openWo.standardMaterialPerUnit)}`} />
                <CostStat label="Labour std / unit" value={`₹${money(openWo.standardLabourPerUnit)}`} />
                <CostStat label="Overhead std / unit" value={`₹${money(openWo.standardOverheadPerUnit)}`} />
              </div>
              <div className="overflow-auto erp-scroll rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Seq</TableHead>
                      <TableHead>Operation</TableHead>
                      <TableHead className="hidden sm:table-cell">Work center</TableHead>
                      <TableHead className="text-right">Material</TableHead>
                      <TableHead className="text-right">Labour</TableHead>
                      <TableHead className="text-right">Overhead</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openWo.tasks.map((task) => (
                      <TableRow key={task.taskNo}>
                        <TableCell className="tabular-nums">{task.seq}</TableCell>
                        <TableCell>
                          {operationLabel(task.operation)}
                          <span className="ml-1 text-xs text-muted-foreground">({task.status.toLowerCase()})</span>
                        </TableCell>
                        <TableCell className="hidden max-w-40 truncate text-xs sm:table-cell">{task.workCenter ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={task.materialCost} /></TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={task.labourCost} /></TableCell>
                        <TableCell className="text-right tabular-nums"><Money value={task.overheadCost} /></TableCell>
                        <TableCell className="text-right font-medium tabular-nums"><Money value={task.total} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {openWo.variance !== null ? (
                <div className="grid grid-cols-3 gap-3">
                  <CostStat label="Material variance" value={`₹${money(openWo.materialVariance ?? 0)}`} />
                  <CostStat label="Labour variance" value={`₹${money(openWo.labourVariance ?? 0)}`} />
                  <CostStat label="Overhead variance" value={`₹${money(openWo.overheadVariance ?? 0)}`} />
                </div>
              ) : null}
              {!openWo.hasRouting ? (
                <p className="text-xs text-muted-foreground">
                  This revision has no routing, so no labour standard exists and labour variance is not meaningful.
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenWo(null)} className="h-11">Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <AlertDialog open={!!trueUpFor} onOpenChange={(o) => !o && setTrueUpFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restate absorbed overhead on {trueUpFor?.woNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              The order absorbed <Money value={trueUpFor?.overheadCost ?? 0} />; the {data.overheadRatePct}% rate says it
              should absorb ₹{money(r2((trueUpFor?.materialCost ?? 0) + (trueUpFor?.labourCost ?? 0)) * (data.overheadRatePct / 100))}.
              The difference is posted once to WIP against the Factory Overhead Absorbed ledger, dated on the last completed
              operation, and the per-operation amounts are restated. Nothing is deleted and running it twice posts nothing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="h-11" disabled={busy} onClick={(e) => { e.preventDefault(); void trueUp() }}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Post true-up
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- routing editor (operations of a BOM revision) ----------

interface RoutingDraftRow {
  key: number
  seq: string
  operation: string
  workCenterId: string
  runMinutesPerUnit: string
  setupMinutes: string
  queueMinutes: string
  moveMinutes: string
  inspectionMinutes: string
}

let routingSeq = 0
const emptyRoutingRow = (seq: number): RoutingDraftRow => ({
  key: ++routingSeq,
  seq: String(seq),
  operation: 'CUTTING',
  workCenterId: '',
  runMinutesPerUnit: '',
  setupMinutes: '',
  queueMinutes: '',
  moveMinutes: '',
  inspectionMinutes: '',
})

function RoutingDialog({ bom, open, onOpenChange, onSaved }: { bom: Bom; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const centers = useApi<WorkCenter[]>('/api/manufacturing/work-centers?all=1')
  const detail = useApi<RoutingDetail | null>(open ? `/api/manufacturing/routing?bomId=${bom.id}` : null)
  // Standard cost of the revision as currently saved: material at line rates plus
  // the labour these routes imply at each centre's cost per hour.
  const standard = useApi<{ standard: StandardCost; overheadRatePct: number } | null>(
    open ? `/api/manufacturing/costing?bomId=${bom.id}` : null
  )
  const [rows, setRows] = useState<RoutingDraftRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const activeCenters = (centers.data ?? []).filter((c) => c.active)
  const frozen = bom.status !== 'DRAFT'

  if (!loaded && detail.data) {
    setRows(
      detail.data.operations.length
        ? detail.data.operations.map((op) => ({
            key: ++routingSeq,
            seq: String(op.seq),
            operation: op.operation,
            workCenterId: op.workCenterId,
            runMinutesPerUnit: String(op.runMinutesPerUnit),
            setupMinutes: String(op.setupMinutes),
            queueMinutes: String(op.queueMinutes),
            moveMinutes: String(op.moveMinutes),
            inspectionMinutes: String(op.inspectionMinutes),
          }))
        : [emptyRoutingRow(1)]
    )
    setLoaded(true)
  }

  const setRow = (key: number, patch: Partial<RoutingDraftRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const totalPerUnit = rows.reduce((sum, r) => sum + num(r.runMinutesPerUnit), 0)
  const totalBatch = rows.reduce(
    (sum, r) => sum + num(r.runMinutesPerUnit) + num(r.setupMinutes) + num(r.queueMinutes) + num(r.moveMinutes) + num(r.inspectionMinutes),
    0
  )

  const save = async () => {
    const valid = rows.filter((r) => r.workCenterId)
    if (!valid.length) return toast.error('Add at least one operation with a work centre')
    setSaving(true)
    try {
      await apiPut('/api/manufacturing/routing', {
        bomId: bom.id,
        operations: valid.map((r, index) => ({
          seq: Math.max(1, Math.trunc(num(r.seq) || index + 1)),
          operation: r.operation,
          workCenterId: r.workCenterId,
          runMinutesPerUnit: num(r.runMinutesPerUnit),
          setupMinutes: num(r.setupMinutes),
          queueMinutes: num(r.queueMinutes),
          moveMinutes: num(r.moveMinutes),
          inspectionMinutes: num(r.inspectionMinutes),
        })),
      })
      toast.success(`${bom.bomNo} routing saved`, { description: `${valid.length} operation(s) — approve the revision to freeze it.` })
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Routing — {bom.bomNo} rev {bom.revision}</DialogTitle>
          <DialogDescription>
            Ordered operations that make {bom.productName}, each on a work centre with setup and run time. Capacity planning and
            OEE both read these numbers, so enter the shop-floor times, not targets.
            {frozen ? ` This revision is ${bom.status}: the route is frozen — create a revision to change it.` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto erp-scroll-y pr-1">
          {detail.error ? <ErrorState error={detail.error} onRetry={() => detail.reload()} entity="routing" /> : null}
          {rows.map((r) => (
            <div key={r.key} className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Operation {r.seq}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-destructive"
                  onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                  disabled={rows.length === 1 || frozen}
                  aria-label="Remove operation"
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Seq</Label>
                  <Input type="number" min="1" value={r.seq} onChange={(e) => setRow(r.key, { seq: e.target.value })} className="h-10 text-right tabular-nums" disabled={frozen} aria-label="Sequence" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Operation</Label>
                  <Select value={r.operation} onValueChange={(v) => setRow(r.key, { operation: v })} disabled={frozen}>
                    <SelectTrigger className="h-10 w-full" aria-label="Operation"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {MANUFACTURING_OPERATIONS.map((o) => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-1 lg:col-span-2">
                  <Label className="text-xs text-muted-foreground">Work Center</Label>
                  <Select value={r.workCenterId || undefined} onValueChange={(v) => setRow(r.key, { workCenterId: v })} disabled={frozen}>
                    <SelectTrigger className="h-10 w-full" aria-label="Work center"><SelectValue placeholder="Select centre…" /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {activeCenters.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} — {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Run min / unit</Label>
                  <Input type="number" min="0" step="any" value={r.runMinutesPerUnit} onChange={(e) => setRow(r.key, { runMinutesPerUnit: e.target.value })} className="h-10 text-right tabular-nums" disabled={frozen} aria-label="Run minutes per unit" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Setup min</Label>
                  <Input type="number" min="0" step="any" value={r.setupMinutes} onChange={(e) => setRow(r.key, { setupMinutes: e.target.value })} className="h-10 text-right tabular-nums" disabled={frozen} aria-label="Setup minutes" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Queue min</Label>
                  <Input type="number" min="0" step="any" value={r.queueMinutes} onChange={(e) => setRow(r.key, { queueMinutes: e.target.value })} className="h-10 text-right tabular-nums" disabled={frozen} aria-label="Queue minutes" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Move min</Label>
                  <Input type="number" min="0" step="any" value={r.moveMinutes} onChange={(e) => setRow(r.key, { moveMinutes: e.target.value })} className="h-10 text-right tabular-nums" disabled={frozen} aria-label="Move minutes" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Inspection min</Label>
                  <Input type="number" min="0" step="any" value={r.inspectionMinutes} onChange={(e) => setRow(r.key, { inspectionMinutes: e.target.value })} className="h-10 text-right tabular-nums" disabled={frozen} aria-label="Inspection minutes" />
                </div>
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            className="h-11 w-full gap-2 border-dashed"
            onClick={() => setRows((rs) => [...rs, emptyRoutingRow(rs.length + 1)])}
            disabled={frozen}
          >
            <Plus className="size-4" aria-hidden /> Add operation
          </Button>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
          <div className="text-xs text-muted-foreground">
            {rows.length} operation(s) · {qtyFmt(r2(totalPerUnit))} min/unit · {qtyFmt(r2(totalBatch))} min per batch (setup + queue + move + inspection)
            {standard.data ? (
              <span className="block">
                Saved standard: ₹{money(standard.data.standard.materialCost)} material + ₹
                {money(standard.data.standard.labourCost)} labour
                {standard.data.overheadRatePct > 0 ? ` + ₹${money(standard.data.standard.overheadCost)} overhead` : ''} ={' '}
                <span className="font-medium text-foreground">₹{money(standard.data.standard.standardCost)} per unit</span>
                {standard.data.standard.unpricedOperations.length > 0
                  ? ` — ${standard.data.standard.unpricedOperations.length} operation(s) have no cost/hour, so labour is understated`
                  : ''}
              </span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Close</Button>
            <Button onClick={save} disabled={saving || frozen || !loaded} className="h-11 min-w-32">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wrench className="size-4" aria-hidden />}
              Save routing
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- where-used / impact review ----------

function WhereUsedDialog({ itemId, label, open, onOpenChange }: { itemId: string; label: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const res = useApi<BomWhereUsed | null>(open ? `/api/manufacturing/boms/where-used?itemId=${itemId}` : null)
  const rows = res.data?.usedIn ?? []
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Where used — {label}</DialogTitle>
          <DialogDescription>
            Every live BOM revision that consumes this item. Check this before changing a component: an approved revision that is
            already consuming it must be superseded, not edited.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto erp-scroll-y">
          {res.loading ? (
            <TableSkeleton rows={4} cols={4} />
          ) : res.error ? (
            <ErrorState error={res.error} onRetry={() => res.reload()} entity="where-used" />
          ) : rows.length === 0 ? (
            <EmptyState title="Not used in any BOM" hint="This item is only consumed directly (task issue) or not consumed at all." icon={PackageSearch} />
          ) : (
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>BOM</TableHead>
                  <TableHead>Makes</TableHead>
                  <TableHead className="text-right">Qty / unit</TableHead>
                  <TableHead className="text-right">Work Orders</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.bomId}>
                    <TableCell>
                      <span className="block font-medium tabular-nums">{r.bomNo}</span>
                      <span className="block text-xs text-muted-foreground">rev {r.revision} · {r.project?.projectNo}</span>
                    </TableCell>
                    <TableCell className="max-w-40 truncate">{r.outputItem ? `${r.outputItem.code}` : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{qtyFmt(r.qtyPer)} <span className="text-xs text-muted-foreground">{r.uom}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{r.workOrders}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- generate work order from BOM ----------

function GenerateWoDialog({ bom, open, onOpenChange, onCreated }: { bom: Bom; open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [priority, setPriority] = useState<string>('NORMAL')
  const [startDate, setStartDate] = useState(todayISO())
  const [endDate, setEndDate] = useState('')
  const [outputQty, setOutputQty] = useState('1')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const batch = num(outputQty) > 0 ? num(outputQty) : 1

  const save = async () => {
    if (!(num(outputQty) > 0)) return toast.error('Output quantity must be greater than zero')
    setSaving(true)
    try {
      const res = await apiPost<WorkOrder>('/api/manufacturing/work-orders', {
        projectId: bom.projectId,
        bomId: bom.id,
        outputQty: batch,
        priority,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        notes: notes.trim() || undefined,
      })
      toast.success(`${res.woNo} generated`, {
        description: `${bom.items.length} line(s) grossed with wastage for ${qtyFmt(batch)} × ${bom.item?.code ?? bom.productName} — now add operation tasks (cutting → … → finishing).`,
      })
      onCreated()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate Work Order from {bom.bomNo}</DialogTitle>
          <DialogDescription>
            Lines are pulled from the approved BOM rev {bom.revision} with wastage gross-up, scaled by the batch quantity. Schedule and priority below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">BOM Qty</TableHead>
                  <TableHead className="text-right">Planned (gross)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bom.items.slice(0, 6).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="max-w-44 truncate">{i.item.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{qtyFmt(i.qty)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{qtyFmt(r2(i.grossQty * batch))} <span className="text-xs text-muted-foreground">{i.uom}</span></TableCell>
                  </TableRow>
                ))}
                {bom.items.length > 6 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-xs text-muted-foreground">
                      + {bom.items.length - 6} more line(s)
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="wo-qty">Output Qty ({bom.item?.uom ?? 'units'})</Label>
              <Input
                id="wo-qty"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={outputQty}
                onChange={(e) => setOutputQty(e.target.value)}
                className="h-11 text-right tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-11 data-[size=default]:h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WO_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wo-start">Start Date</Label>
              <Input id="wo-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wo-end">Target End</Label>
              <Input id="wo-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-11" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wo-notes">Notes</Label>
            <Textarea id="wo-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="min-h-16" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button onClick={save} disabled={saving} className="h-11 min-w-32">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ClipboardList className="size-4" aria-hidden />}
            Generate WO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Work orders tab
// ===========================================================================

function WorkOrdersTab({ onViewTasks, onChanged }: { onViewTasks: (woId?: string) => void; onChanged?: () => void }) {
  const list = useApi<WorkOrder[]>('/api/manufacturing/work-orders')
  const [busy, setBusy] = useState(false)
  const rows = list.data ?? []
  const activeRows = rows.filter((w) => w.status === 'OPEN' || w.status === 'IN_PROGRESS')

  const woAction = async (w: WorkOrder, action: 'complete' | 'cancel') => {
    setBusy(true)
    try {
      await apiPost(`/api/manufacturing/work-orders/${w.id}/actions`, { action })
      toast.success(action === 'complete' ? `${w.woNo} COMPLETED` : `${w.woNo} cancelled`)
      list.reload()
      onChanged?.()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} work order{rows.length === 1 ? '' : 's'} · {activeRows.length} active
        </p>
        <Button variant="outline" onClick={() => onViewTasks()} className="h-11 gap-2">
          <Wrench className="size-4" aria-hidden /> Manage Tasks
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : list.error ? (
            <div className="p-6">
              <ErrorState error={list.error} onRetry={() => list.reload()} entity="work orders" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No work orders yet" hint="Approve a BOM in a project and generate the first work order." icon={ClipboardList} />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>WO No</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead className="hidden lg:table-cell">Schedule</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Lines</TableHead>
                    <TableHead className="min-w-32">Tasks</TableHead>
                    <TableHead className="text-right hidden xl:table-cell">Cost</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-medium tabular-nums">
                        {w.woNo}
                        {w.bom ? <span className="block text-xs text-muted-foreground">{w.bom.bomNo}</span> : null}
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-36 truncate tabular-nums">{w.project?.projectNo}</span>
                        <span className="block max-w-36 truncate text-xs text-muted-foreground">{w.project?.name}</span>
                      </TableCell>
                      <TableCell><PriorityBadge priority={w.priority} /></TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="block whitespace-nowrap tabular-nums text-xs">
                          {w.startDate ? dateStr(w.startDate) : '—'} → {w.endDate ? dateStr(w.endDate) : '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums hidden sm:table-cell">{w.lines.length}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <ProgressBar value={w.stats.progressPct} />
                          <p className="text-xs tabular-nums text-muted-foreground">{w.stats.taskDone}/{w.stats.taskTotal}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right hidden xl:table-cell">
                        {w.stats.labourCost + w.stats.materialCost > 0 ? (
                          <Money value={w.stats.labourCost + w.stats.materialCost} plain />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell><StatusBadge status={w.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => onViewTasks(w.id)}>
                            <Wrench className="size-3.5" aria-hidden /> Tasks
                          </Button>
                          {w.status === 'OPEN' || w.status === 'IN_PROGRESS' ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 gap-1"
                                disabled={busy || w.stats.taskTotal === 0 || w.stats.taskDone < w.stats.taskTotal}
                                title={w.stats.taskDone < w.stats.taskTotal ? 'Complete pending tasks first' : 'All tasks done'}
                                onClick={() => woAction(w, 'complete')}
                              >
                                <BadgeCheck className="size-3.5" aria-hidden /> Close
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 gap-1 text-destructive hover:text-destructive"
                                    disabled={busy || w.stats.taskDone > 0}
                                    aria-label={`Cancel ${w.woNo}`}
                                  >
                                    <XCircle className="size-3.5" aria-hidden />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Cancel {w.woNo}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      The work order and its pending tasks will be cancelled. Completed tasks (if any) block cancellation — this cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel className="h-11">Keep it</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={(e) => {
                                        e.preventDefault()
                                        void woAction(w, 'cancel')
                                      }}
                                      className="h-11"
                                    >
                                      Cancel WO
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ===========================================================================
// Tasks tab (assign → start → complete)
// ===========================================================================

function TasksTab({ woFilter, onWoFilterChange, onChanged }: { woFilter: string; onWoFilterChange: (v: string) => void; onChanged?: () => void }) {
  const wos = useApi<WorkOrder[]>('/api/manufacturing/work-orders')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [createOpen, setCreateOpen] = useState(false)
  const [assignTask, setAssignTask] = useState<ProductionTask | null>(null)
  const [completeTask, setCompleteTask] = useState<ProductionTask | null>(null)
  const [busy, setBusy] = useState(false)

  const activeWos = (wos.data ?? []).filter((w) => w.status === 'OPEN' || w.status === 'IN_PROGRESS')
  const qp = new URLSearchParams()
  if (statusFilter && statusFilter !== 'all') qp.set('status', statusFilter)
  if (woFilter && woFilter !== 'all') qp.set('workOrderId', woFilter)
  const list = useApi<ProductionTask[]>(`/api/manufacturing/tasks?${qp.toString()}`)
  const rows = list.data ?? []
  const capped = rows.length >= 500 // server returns the newest 500; narrow by status or work order for older ones

  const taskAction = async (t: ProductionTask, action: 'start' | 'cancel') => {
    setBusy(true)
    try {
      await apiPost(`/api/manufacturing/tasks/${t.id}/actions`, { action })
      toast.success(action === 'start' ? `${t.taskNo} on the floor` : `${t.taskNo} cancelled`)
      list.reload()
      onChanged?.()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-44 items-center gap-2">
          <Label htmlFor="task-status" className="sr-only">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="task-status" className="h-11 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active (open)</SelectItem>
              <SelectItem value="PENDING">Unassigned</SelectItem>
              <SelectItem value="ASSIGNED">Assigned</SelectItem>
              <SelectItem value="IN_PROGRESS">In progress</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-44 items-center gap-2">
          <Label htmlFor="task-wo" className="sr-only">Work order</Label>
          <Select value={woFilter} onValueChange={onWoFilterChange}>
            <SelectTrigger id="task-wo" className="h-11 w-52">
              <SelectValue placeholder="All work orders" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="all">All work orders</SelectItem>
              {(wos.data ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.woNo} — {w.project?.projectNo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto">
          <Button onClick={() => setCreateOpen(true)} disabled={activeWos.length === 0} title={activeWos.length === 0 ? 'No active work orders — generate one from an approved BOM' : undefined} className="h-11 gap-2">
            <Plus className="size-4" aria-hidden /> New Task
          </Button>
        </div>
      </div>

      {capped ? <p className="text-xs text-muted-foreground">Showing the newest 500 tasks — filter by status or work order to see older ones.</p> : null}
      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={6} cols={7} />
          ) : list.error ? (
            <div className="p-6">
              <ErrorState error={list.error} onRetry={() => list.reload()} entity="tasks" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No tasks here"
                hint="Operation tasks (job cards) live on work orders — create one, or clear the filters."
                icon={Wrench}
              />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead className="hidden md:table-cell">Project / WO</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Actual / Rej</TableHead>
                    <TableHead className="text-right hidden xl:table-cell">Hours</TableHead>
                    <TableHead className="text-right hidden xl:table-cell">Cost</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => {
                    const wo = (wos.data ?? []).find((w) => w.id === t.workOrderId)
                    const active = t.status === 'PENDING' || t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS'
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium tabular-nums">{t.taskNo}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {operationLabel(t.operation)}
                          {t.machineNo ? <span className="block text-[10px] text-muted-foreground">m/c {t.machineNo}</span> : null}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="block max-w-32 truncate tabular-nums">{wo?.project?.projectNo ?? t.workOrderId.slice(0, 8)}</span>
                          <span className="block max-w-32 truncate text-xs text-muted-foreground">{wo?.woNo ?? ''}</span>
                        </TableCell>
                        <TableCell>
                          {t.employee ? (
                            <span className="block max-w-32 truncate">{t.employee.name}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{qtyFmt(t.plannedQty)}</TableCell>
                        <TableCell className="text-right tabular-nums hidden lg:table-cell">
                          {t.status === 'COMPLETED' ? (
                            <>
                              {qtyFmt(t.actualQty)}
                              {t.rejectionQty > 0 ? <span className="text-destructive"> / −{qtyFmt(t.rejectionQty)}</span> : ''}
                            </>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums hidden xl:table-cell">{t.hours > 0 ? qtyFmt(t.hours) : '—'}</TableCell>
                        <TableCell className="text-right hidden xl:table-cell">
                          {t.labourCost + t.materialCost > 0 ? <Money value={t.labourCost + t.materialCost} plain /> : '—'}
                        </TableCell>
                        <TableCell><DueCell due={t.dueDate} overdue={active && isOverdue(t.dueDate)} /></TableCell>
                        <TableCell><StatusBadge status={t.status} /></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {t.status === 'PENDING' || t.status === 'ASSIGNED' ? (
                              <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setAssignTask(t)}>
                                <UserCog className="size-3.5" aria-hidden /> {t.status === 'PENDING' ? 'Assign' : 'Reassign'}
                              </Button>
                            ) : null}
                            {t.status === 'ASSIGNED' ? (
                              <Button variant="outline" size="sm" className="h-9 gap-1" disabled={busy} onClick={() => taskAction(t, 'start')}>
                                <PlayCircle className="size-3.5" aria-hidden /> Start
                              </Button>
                            ) : null}
                            {t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS' ? (
                              <Button size="sm" className="h-9 gap-1" onClick={() => setCompleteTask(t)}>
                                <CheckCircle2 className="size-3.5" aria-hidden /> Complete
                              </Button>
                            ) : null}
                            {active ? (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 text-destructive hover:text-destructive"
                                    disabled={busy}
                                    aria-label={`Cancel ${t.taskNo}`}
                                  >
                                    <XCircle className="size-3.5" aria-hidden />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Cancel {t.taskNo}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {operationLabel(t.operation)} will be cancelled. Completed tasks are final and cannot be cancelled — this cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel className="h-11">Keep it</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={(e) => {
                                        e.preventDefault()
                                        void taskAction(t, 'cancel')
                                      }}
                                      className="h-11"
                                    >
                                      Cancel Task
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {createOpen ? (
        <NewTaskDialog open={createOpen} onOpenChange={setCreateOpen} defaultWoId={woFilter !== 'all' ? woFilter : undefined} onCreated={() => { list.reload(); wos.reload(); onChanged?.() }} />
      ) : null}
      {assignTask ? (
        <AssignDialog task={assignTask} open={!!assignTask} onOpenChange={(o) => !o && setAssignTask(null)} onAssigned={() => { list.reload(); onChanged?.() }} />
      ) : null}
      {completeTask ? (
        <CompleteTaskDialog task={completeTask} open={!!completeTask} onOpenChange={(o) => !o && setCompleteTask(null)} onCompleted={() => { list.reload(); wos.reload(); onChanged?.() }} />
      ) : null}
    </div>
  )
}

// ---------- new task dialog ----------

function NewTaskDialog({
  open,
  onOpenChange,
  fixedWo,
  defaultWoId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  fixedWo?: WorkOrder
  defaultWoId?: string
  onCreated: () => void
}) {
  const wos = useApi<WorkOrder[]>(fixedWo ? null : '/api/manufacturing/work-orders')
  const employees = useApi<Employee[]>('/api/manufacturing/employees')
  const activeWos = fixedWo ? [fixedWo] : (wos.data ?? []).filter((w) => w.status === 'OPEN' || w.status === 'IN_PROGRESS')
  const activeEmps = (employees.data ?? []).filter((e) => e.active)

  const [workOrderId, setWorkOrderId] = useState(fixedWo?.id ?? defaultWoId ?? '')
  const [operation, setOperation] = useState('CUTTING')
  const [seq, setSeq] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [machineNo, setMachineNo] = useState('')
  const [plannedQty, setPlannedQty] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const wo = activeWos.find((w) => w.id === workOrderId)

  const save = async () => {
    if (!workOrderId) return toast.error('Pick the work order')
    if (!(num(plannedQty) > 0)) return toast.error('Planned quantity must be positive')
    setSaving(true)
    try {
      const res = await apiPost<ProductionTask>('/api/manufacturing/tasks', {
        workOrderId,
        operation,
        seq: Math.trunc(num(seq)),
        employeeId: employeeId || undefined,
        machineNo: machineNo.trim() || undefined,
        plannedQty: num(plannedQty),
        dueDate: dueDate || undefined,
        notes: notes.trim() || undefined,
      })
      toast.success(`${res.taskNo} created`, {
        description: employeeId
          ? `${operationLabel(operation)} assigned — status ASSIGNED.`
          : `${operationLabel(operation)} — status PENDING (unassigned).`,
      })
      onCreated()
      onOpenChange(false)
      setOperation('CUTTING'); setSeq(''); setEmployeeId(''); setMachineNo(''); setPlannedQty(''); setDueDate(''); setNotes('')
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Operation Task (Job Card)</DialogTitle>
          <DialogDescription>
            One task per operation — cutting, bending, welding… Assign now or later from the task list.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto erp-scroll-y pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            {!fixedWo ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Work Order</Label>
                <Select value={workOrderId || undefined} onValueChange={setWorkOrderId}>
                  <SelectTrigger className="h-11 data-[size=default]:h-11 w-full">
                    <SelectValue placeholder="Pick work order…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {activeWos.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.woNo} — {w.project?.projectNo} {w.bom ? `(${w.bom.productName})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm sm:col-span-2">
                <span className="font-medium tabular-nums">{fixedWo.woNo}</span>
                <span className="text-muted-foreground"> · {fixedWo.project?.projectNo}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Operation</Label>
              <Select value={operation} onValueChange={setOperation}>
                <SelectTrigger className="h-11 data-[size=default]:h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {MANUFACTURING_OPERATIONS.map((o) => (
                    <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-seq">Sequence</Label>
              <Input id="task-seq" type="number" inputMode="numeric" min="0" step="1" value={seq} onChange={(e) => setSeq(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-qty">Planned Qty{wo?.lines[0] ? ` (${wo.lines[0].uom})` : ''}</Label>
              <Input id="task-qty" type="number" inputMode="decimal" min="0" step="any" value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due">Due Date</Label>
              <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Assign Worker (optional)</Label>
              <Select value={employeeId || undefined} onValueChange={setEmployeeId}>
                <SelectTrigger className="h-11 data-[size=default]:h-11 w-full">
                  <SelectValue placeholder="Leave unassigned…" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {activeEmps.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} {e.skill ? `· ${e.skill}` : ''} · ₹{money(e.hourlyRate)}/h
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-machine">Machine No</Label>
              <Input id="task-machine" value={machineNo} onChange={(e) => setMachineNo(e.target.value)} placeholder="Auto from worker" className="h-11" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="task-notes">Notes</Label>
              <Textarea id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional work instructions" className="min-h-16" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button onClick={save} disabled={saving} className="h-11 min-w-32">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            Create Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- assign dialog (task assigning) ----------

function AssignDialog({ task, open, onOpenChange, onAssigned }: { task: ProductionTask; open: boolean; onOpenChange: (o: boolean) => void; onAssigned: () => void }) {
  const employees = useApi<Employee[]>(open ? '/api/manufacturing/employees' : null)
  const activeEmps = (employees.data ?? []).filter((e) => e.active)
  const [employeeId, setEmployeeId] = useState(task.employeeId ?? '')
  const [machineNo, setMachineNo] = useState(task.machineNo ?? '')
  const [dueDate, setDueDate] = useState(task.dueDate ? task.dueDate.slice(0, 10) : '')
  const [saving, setSaving] = useState(false)

  const emp = activeEmps.find((e) => e.id === employeeId)

  const save = async () => {
    if (!employeeId) return toast.error('Pick a worker')
    setSaving(true)
    try {
      await apiPost(`/api/manufacturing/tasks/${task.id}/actions`, {
        action: 'assign',
        employeeId,
        machineNo: machineNo.trim() || undefined,
        dueDate: dueDate || undefined,
      })
      toast.success(`${task.taskNo} assigned`, {
        description: emp ? `${emp.name}${emp.skill ? ` (${emp.skill})` : ''} — rate ₹${money(emp.hourlyRate)}/h snapshotted.` : undefined,
      })
      onAssigned()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign {task.taskNo}</DialogTitle>
          <DialogDescription>
            {operationLabel(task.operation)} · planned {qtyFmt(task.plannedQty)}
            {task.employee?.name ? ` · currently ${task.employee.name}` : ' · currently unassigned'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Worker</Label>
            <Select value={employeeId || undefined} onValueChange={(v) => {
              setEmployeeId(v)
              const e = activeEmps.find((x) => x.id === v)
              if (e && !machineNo && e.machineNo) setMachineNo(e.machineNo)
            }}>
              <SelectTrigger className="h-11 data-[size=default]:h-11 w-full">
                <SelectValue placeholder="Pick worker…" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {activeEmps.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.code} — {e.name} {e.skill ? `· ${e.skill}` : ''} {e.shift !== 'GENERAL' ? `· ${e.shift}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {emp ? (
              <p className="text-xs text-muted-foreground">
                {emp.machineNo ? `default machine ${emp.machineNo} · ` : ''}₹{money(emp.hourlyRate)}/hour
              </p>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="asg-machine">Machine No</Label>
              <Input id="asg-machine" value={machineNo} onChange={(e) => setMachineNo(e.target.value)} placeholder="CNC-01" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asg-due">Due Date</Label>
              <Input id="asg-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-11" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button onClick={save} disabled={saving} className="h-11 min-w-32">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserCog className="size-4" aria-hidden />}
            Assign Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- complete task dialog (production + material consumption) ----------

function CompleteTaskDialog({ task, open, onOpenChange, onCompleted }: { task: ProductionTask; open: boolean; onOpenChange: (o: boolean) => void; onCompleted: () => void }) {
  const masters = useMasters()
  const stockItems = masters.items.filter((i) => i.active && i.isStockItem)
  const [actualQty, setActualQty] = useState(String(task.plannedQty))
  const [rejectionQty, setRejectionQty] = useState('0')
  const [hours, setHours] = useState('')
  const [labourRate, setLabourRate] = useState(task.labourRate > 0 ? String(task.labourRate) : '')
  const [materialItemId, setMaterialItemId] = useState(task.materialItemId ?? '')
  const [materialQty, setMaterialQty] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const labourCost = num(hours) * (num(labourRate) > 0 ? num(labourRate) : task.labourRate)
  const total = num(actualQty) + num(rejectionQty)
  const over = total > task.plannedQty * 1.1 + 0.001

  const save = async () => {
    if (!(num(actualQty) > 0)) return toast.error('Actual quantity must be positive')
    if (over) return toast.error('Actual + rejection exceeds planned by more than 10%')
    // Material pair validation: picking an item without a positive qty (or
    // vice versa) would 400 on the server — catch it before the round-trip.
    if (materialItemId && !(num(materialQty) > 0)) return toast.error('Enter the consumed quantity for the picked material')
    if (!materialItemId && num(materialQty) > 0) return toast.error('Pick which material was consumed')
    setSaving(true)
    try {
      await apiPost(`/api/manufacturing/tasks/${task.id}/actions`, {
        action: 'complete',
        actualQty: num(actualQty),
        rejectionQty: num(rejectionQty),
        hours: num(hours),
        labourRate: num(labourRate) > 0 ? num(labourRate) : undefined,
        materialItemId: materialItemId || undefined,
        materialQty: num(materialQty) > 0 ? num(materialQty) : undefined,
        notes: notes.trim() || undefined,
      })
      toast.success(`${task.taskNo} COMPLETED`, {
        description: `Qty ${qtyFmt(num(actualQty))}${num(rejectionQty) > 0 ? `, rejection ${qtyFmt(num(rejectionQty))}` : ''}${num(hours) > 0 ? `, labour ₹${money(r2(labourCost))}` : ''}${materialItemId && num(materialQty) > 0 ? ', material issued from stock' : ''}`,
      })
      onCompleted()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Complete {task.taskNo}</DialogTitle>
          <DialogDescription>
            {operationLabel(task.operation)}{task.employee?.name ? ` · ${task.employee.name}` : ''} · planned {qtyFmt(task.plannedQty)}.
            Material consumption is issued from the default warehouse into the stock ledger.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto erp-scroll-y pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cmp-actual">Actual Quantity</Label>
              <Input id="cmp-actual" type="number" inputMode="decimal" min="0" step="any" value={actualQty} onChange={(e) => setActualQty(e.target.value)} className={cn('h-11 text-right tabular-nums', over && 'border-destructive focus-visible:ring-destructive')} />
              <p className={cn('text-xs', over ? 'text-destructive' : 'text-muted-foreground')}>
                planned {qtyFmt(task.plannedQty)}{over ? ' — over 10% tolerance' : ' (10% over-production tolerance)'}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmp-rej">Rejection Quantity</Label>
              <Input id="cmp-rej" type="number" inputMode="decimal" min="0" step="any" value={rejectionQty} onChange={(e) => setRejectionQty(e.target.value)} className="h-11 text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmp-hours">Production Time (hours)</Label>
              <Input id="cmp-hours" type="number" inputMode="decimal" min="0" step="any" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cmp-rate">Labour Rate (₹/hour)</Label>
              <Input id="cmp-rate" type="number" inputMode="decimal" min="0" step="any" value={labourRate} onChange={(e) => setLabourRate(e.target.value)} placeholder={String(task.labourRate || 0)} className="h-11 text-right tabular-nums" />
              <p className="text-xs text-muted-foreground">
                labour cost <span className="font-medium text-foreground tabular-nums">₹{money(r2(labourCost))}</span>
              </p>
            </div>
          </div>

          <Separator />

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Material Consumption (optional)</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Material</Label>
                <Select value={materialItemId || undefined} onValueChange={(v) => setMaterialItemId(v === 'none' ? '' : v)}>
                  <SelectTrigger className="h-11 data-[size=default]:h-11 w-full">
                    <SelectValue placeholder="No material issue" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    <SelectItem value="none">— no material issue —</SelectItem>
                    {stockItems.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.code} — {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cmp-mqty">Consumed Qty</Label>
                <Input id="cmp-mqty" type="number" inputMode="decimal" min="0" step="any" value={materialQty} onChange={(e) => setMaterialQty(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
                <p className="text-xs text-muted-foreground">valued at moving average, availability-guarded</p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cmp-notes">Notes</Label>
            <Textarea id="cmp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — QC remarks, rework notes…" className="min-h-16" />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button onClick={save} disabled={saving || over} className="h-11 min-w-32">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
            Complete Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Pending tab (task-wise pending board)
// ===========================================================================

function PendingTab({ onGoTasks, onChanged }: { onGoTasks: (woId?: string) => void; onChanged?: () => void }) {
  const report = useApi<PendingReport | null>('/api/manufacturing/pending')
  const [assignTask, setAssignTask] = useState<PendingTaskRow | null>(null)
  const r = report.data

  const byProject = useMemo(() => {
    if (!r) return []
    const groups = new Map<string, { project: PendingTaskRow['workOrder']['project']; rows: PendingTaskRow[] }>()
    for (const t of r.rows) {
      const g = groups.get(t.workOrder.project.id) ?? { project: t.workOrder.project, rows: [] }
      g.rows.push(t)
      groups.set(t.workOrder.project.id, g)
    }
    return [...groups.values()]
  }, [r])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1.5 rounded-md px-2.5 py-1 text-xs">
          <ListTodo className="size-3.5" aria-hidden /> {r?.summary.total ?? '—'} pending
        </Badge>
        <Badge variant="destructive" className="gap-1.5 rounded-md px-2.5 py-1 text-xs">
          <CalendarClock className="size-3.5" aria-hidden /> {r?.summary.overdue ?? '—'} overdue
        </Badge>
        <Badge variant="outline" className="gap-1.5 rounded-md px-2.5 py-1 text-xs">
          <UserPlus className="size-3.5" aria-hidden /> {r?.summary.unassigned ?? '—'} unassigned
        </Badge>
        <Badge variant="outline" className="gap-1.5 rounded-md px-2.5 py-1 text-xs">
          <Wrench className="size-3.5" aria-hidden /> {r?.summary.inProgress ?? '—'} on floor
        </Badge>
        <Button variant="outline" onClick={() => onGoTasks()} className="ml-auto h-11 gap-2">
          <Wrench className="size-4" aria-hidden /> Manage in Tasks
        </Button>
      </div>

      {report.loading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : report.error ? (
        <Card className="p-0">
          <CardContent className="p-6">
            <ErrorState error={report.error} onRetry={() => report.reload()} entity="the pending board" />
          </CardContent>
        </Card>
      ) : !r || r.rows.length === 0 ? (
        <Card className="p-0">
          <CardContent className="p-6">
            <EmptyState
              title="Nothing pending 🎉"
              hint="Every task on every work order is completed or cancelled."
              icon={CheckCircle2}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {byProject.map((g) => {
            const overdue = g.rows.filter((t) => t.overdue).length
            return (
              <Card key={g.project.id} className="p-0">
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <span className="tabular-nums">{g.project.projectNo}</span>
                        <span className="truncate font-normal text-muted-foreground">{g.project.name}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{g.rows.length} open task(s)</p>
                    </div>
                    {overdue > 0 ? (
                      <Badge variant="destructive" className="gap-1">
                        <CalendarClock className="size-3" aria-hidden /> {overdue} overdue
                      </Badge>
                    ) : null}
                  </div>
                  <div className="max-h-96 overflow-auto erp-scroll">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-card">
                        <TableRow>
                          <TableHead>Task</TableHead>
                          <TableHead>Operation</TableHead>
                          <TableHead>WO</TableHead>
                          <TableHead>Worker</TableHead>
                          <TableHead className="text-right">Planned</TableHead>
                          <TableHead>Due</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.rows.map((t) => (
                          <TableRow key={t.id} className={cn(t.overdue && 'bg-destructive/5')}>
                            <TableCell className="font-medium tabular-nums">{t.taskNo}</TableCell>
                            <TableCell className="whitespace-nowrap">{operationLabel(t.operation)}</TableCell>
                            <TableCell className="tabular-nums">
                              {t.workOrder.woNo}
                              <PriorityBadge priority={t.workOrder.priority} />
                            </TableCell>
                            <TableCell>
                              {t.employee ? (
                                <span className="block max-w-32 truncate">{t.employee.name}</span>
                              ) : (
                                <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setAssignTask(t)}>
                                  <UserPlus className="size-3.5" aria-hidden /> Assign
                                </Button>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{qtyFmt(t.plannedQty)}</TableCell>
                            <TableCell><DueCell due={t.dueDate} overdue={t.overdue} /></TableCell>
                            <TableCell><StatusBadge status={t.status} /></TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" className="h-9" onClick={() => onGoTasks(t.workOrderId)}>
                                Open →
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {assignTask ? (
        <AssignDialog
          task={assignTask}
          open={!!assignTask}
          onOpenChange={(o) => !o && setAssignTask(null)}
          onAssigned={() => { report.reload(); onChanged?.() }}
        />
      ) : null}
    </div>
  )
}

// ===========================================================================
// Employees tab
// ===========================================================================

function EmployeesTab({ onChanged }: { onChanged?: () => void }) {
  const list = useApi<Employee[]>('/api/manufacturing/employees')
  const [createOpen, setCreateOpen] = useState(false)
  const [editEmp, setEditEmp] = useState<Employee | null>(null)
  const [busy, setBusy] = useState(false)
  const rows = list.data ?? []

  const toggleActive = async (e: Employee) => {
    setBusy(true)
    try {
      await apiPut(`/api/manufacturing/employees/${e.id}`, { active: !e.active })
      toast.success(`${e.name} ${e.active ? 'deactivated' : 'reactivated'}`)
      list.reload()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (e: Employee) => {
    setBusy(true)
    try {
      await apiDelete(`/api/manufacturing/employees/${e.id}`)
      toast.success(`${e.name} removed`)
      list.reload()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} employee{rows.length === 1 ? '' : 's'} — workers, supervisors and managers with skills, shifts and hourly rates.
        </p>
        <Button onClick={() => setCreateOpen(true)} className="h-11 shrink-0 gap-2">
          <Plus className="size-4" aria-hidden /> New Employee
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : list.error ? (
            <div className="p-6">
              <ErrorState error={list.error} onRetry={() => list.reload()} entity="employees" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No employees yet" hint="Add your workers — welders, CNC operators, fitters — for task assignment." icon={Users} />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Role / Skill</TableHead>
                    <TableHead className="hidden lg:table-cell">Machine</TableHead>
                    <TableHead className="hidden sm:table-cell">Shift</TableHead>
                    <TableHead className="text-right">₹/hour</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Tasks</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => (
                    <TableRow key={e.id} className={cn(!e.active && 'opacity-60')}>
                      <TableCell className="font-medium tabular-nums">{e.code}</TableCell>
                      <TableCell>
                        <span className="block max-w-40 truncate">{e.name}</span>
                        {e.phone ? <span className="block text-xs tabular-nums text-muted-foreground">{e.phone}</span> : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="block">{e.role}</span>
                        {e.skill ? <span className="block text-xs text-muted-foreground">{e.skill}</span> : null}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{e.machineNo ?? '—'}</TableCell>
                      <TableCell className="hidden sm:table-cell">{e.shift}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(e.hourlyRate)}</TableCell>
                      <TableCell className="text-right tabular-nums hidden md:table-cell">{e._count?.tasks ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant={e.active ? 'default' : 'secondary'}>{e.active ? 'ACTIVE' : 'INACTIVE'}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" className="h-9" onClick={() => setEditEmp(e)}>Edit</Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9"
                            disabled={busy}
                            onClick={() => toggleActive(e)}
                          >
                            {e.active ? 'Deactivate' : 'Reactivate'}
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-9 text-destructive hover:text-destructive"
                                disabled={busy || (e._count?.tasks ?? 0) > 0}
                                title={(e._count?.tasks ?? 0) > 0 ? 'Has task history — deactivate instead' : 'Delete employee'}
                                aria-label={`Delete ${e.name}`}
                              >
                                <Trash2 className="size-3.5" aria-hidden />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete {e.name}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This permanently removes the employee record. Employees with task history cannot be deleted — deactivate them instead (history stays attributed).
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel className="h-11">Keep</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={(ev) => {
                                    ev.preventDefault()
                                    void remove(e)
                                  }}
                                  className="h-11"
                                >
                                  Delete Employee
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {createOpen ? (
        <EmployeeDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={() => { list.reload(); onChanged?.() }} />
      ) : null}
      {editEmp ? (
        <EmployeeDialog open={!!editEmp} onOpenChange={(o) => !o && setEditEmp(null)} employee={editEmp} onSaved={() => { list.reload(); onChanged?.() }} />
      ) : null}
    </div>
  )
}

function EmployeeDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  employee?: Employee
  onSaved: () => void
}) {
  const [code, setCode] = useState(employee?.code ?? '')
  const [name, setName] = useState(employee?.name ?? '')
  const [role, setRole] = useState(employee?.role ?? 'WORKER')
  const [skill, setSkill] = useState(employee?.skill ?? '')
  const [machineNo, setMachineNo] = useState(employee?.machineNo ?? '')
  const [shift, setShift] = useState(employee?.shift ?? 'GENERAL')
  const [hourlyRate, setHourlyRate] = useState(employee ? String(employee.hourlyRate) : '')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!employee && !code.trim()) return toast.error('Employee code is required')
    if (!name.trim()) return toast.error('Name is required')
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        role,
        skill: skill.trim() || undefined,
        machineNo: machineNo.trim() || undefined,
        shift,
        hourlyRate: num(hourlyRate),
        phone: phone.trim() || undefined,
      }
      const res = employee
        ? await apiPut<Employee>(`/api/manufacturing/employees/${employee.id}`, body)
        : await apiPost<Employee>('/api/manufacturing/employees', { ...body, code: code.trim().toUpperCase() })
      toast.success(`${res.code} — ${res.name} saved`)
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{employee ? `Edit ${employee.code}` : 'New Employee'}</DialogTitle>
          <DialogDescription>Workers appear in task assignment with their machine, shift and rate.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!employee ? (
              <div className="space-y-1.5">
                <Label htmlFor="emp-code">Code</Label>
                <Input id="emp-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="EMP001" className="h-11" />
              </div>
            ) : null}
            <div className={`space-y-1.5 ${employee ? 'sm:col-span-2' : ''}`}>
              <Label htmlFor="emp-name">Name</Label>
              <Input id="emp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-11 data-[size=default]:h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="WORKER">Worker</SelectItem>
                  <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-skill">Skill</Label>
              <Input id="emp-skill" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="Welder / CNC Operator…" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-machine">Default Machine No</Label>
              <Input id="emp-machine" value={machineNo} onChange={(e) => setMachineNo(e.target.value)} placeholder="CNC-01" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Shift</Label>
              <Select value={shift} onValueChange={setShift}>
                <SelectTrigger className="h-11 data-[size=default]:h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GENERAL">General</SelectItem>
                  <SelectItem value="DAY">Day</SelectItem>
                  <SelectItem value="NIGHT">Night</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-rate">Hourly Rate (₹)</Label>
              <Input id="emp-rate" type="number" inputMode="decimal" min="0" step="any" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emp-phone">Phone</Label>
              <Input id="emp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" className="h-11" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button onClick={save} disabled={saving} className="h-11 min-w-32">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Users className="size-4" aria-hidden />}
            Save Employee
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
