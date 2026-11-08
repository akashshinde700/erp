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
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  ListTodo,
  Loader2,
  PackageSearch,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  Wrench,
  XCircle,
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
  type Employee,
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

// ===========================================================================
// Module shell
// ===========================================================================

type MfgTab = 'projects' | 'boms' | 'work-orders' | 'material-plan' | 'tasks' | 'pending' | 'employees' | 'quality'

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
        <p className="mt-1 text-xs text-muted-foreground">{data.ownershipRule}</p>
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
                    <TableHead className="text-right">Shortage</TableHead>
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
                      <TableCell className={cn('text-right font-semibold tabular-nums', row.shortageQty > 0 && 'text-destructive')}>
                        {row.shortageQty > 0 ? qtyFmt(row.shortageQty) : '—'}
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
  const [busy, setBusy] = useState(false)
  const rows = list.data ?? []

  const approve = async (b: Bom) => {
    setBusy(true)
    try {
      await apiPost(`/api/manufacturing/boms/${b.id}/actions`, { action: 'approve' })
      toast.success(`${b.bomNo} approved`, { description: 'Project estimated cost recalculated.' })
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
          {rows.length} BOM{rows.length === 1 ? '' : 's'} — approve a BOM to unlock work-order generation.
        </p>
        <Button onClick={() => setCreateOpen(true)} className="h-11 shrink-0 gap-2">
          <Plus className="size-4" aria-hidden /> New BOM
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : list.error ? (
            <div className="p-6">
              <ErrorState error={list.error} onRetry={() => list.reload()} entity="BOMs" />
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No BOMs yet" hint="Pick a project and list the materials it needs." icon={PackageSearch} />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>BOM No</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Product / Assembly</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Est Cost</TableHead>
                    <TableHead className="hidden md:table-cell">Stock Check</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => {
                    const shortages = b.items.filter((i) => i.shortage > 0)
                    return (
                      <TableRow key={b.id} className="cursor-pointer" onClick={() => setViewBom(b)}>
                        <TableCell className="font-medium tabular-nums">{b.bomNo}</TableCell>
                        <TableCell>
                          <span className="block max-w-36 truncate tabular-nums">{b.project?.projectNo}</span>
                          <span className="block max-w-36 truncate text-xs text-muted-foreground">{b.project?.name}</span>
                        </TableCell>
                        <TableCell>
                          <span className="block max-w-44 truncate">{b.productName}</span>
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
                        <TableCell><StatusBadge status={b.status} /></TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {b.status === 'DRAFT' ? (
                              <Button variant="outline" size="sm" className="h-9 gap-1" disabled={busy} onClick={() => approve(b)}>
                                <BadgeCheck className="size-3.5" aria-hidden /> Approve
                              </Button>
                            ) : null}
                            {b.status === 'APPROVED' ? (
                              <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => setWoFromBom(b)}>
                                <ClipboardList className="size-3.5" aria-hidden /> Work Order
                              </Button>
                            ) : null}
                            {b.status !== 'CANCELLED' ? (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-9 gap-1 text-destructive hover:text-destructive" disabled={busy}>
                                    <XCircle className="size-3.5" aria-hidden /> Cancel
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Cancel {b.bomNo}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      The BOM will be voided and its estimate removed from the project cost. Active work orders generated from it must be cancelled first. This cannot be undone.
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
    </div>
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
  const [productName, setProductName] = useState('')
  const [drawingRef, setDrawingRef] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<BomDraftRow[]>([emptyBomRow()])
  const [saving, setSaving] = useState(false)

  const setRow = (key: number, patch: Partial<BomDraftRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const itemMap = useMemo(() => new Map(masters.items.map((i) => [i.id, i])), [masters.items])

  const validRows = rows.filter((r) => r.itemId && num(r.qty) > 0)
  const totalEst = validRows.reduce((s, r) => {
    const it = itemMap.get(r.itemId)
    const rate = num(r.rate) > 0 ? num(r.rate) : (it?.costRate ?? 0)
    return s + num(r.qty) * (1 + num(r.wastagePct) / 100) * rate
  }, 0)

  const save = async () => {
    if (!pid) return toast.error('Pick the project')
    if (!productName.trim()) return toast.error('Product / assembly name is required')
    if (validRows.length === 0) return toast.error('Add at least one material line with quantity')
    setSaving(true)
    try {
      const res = await apiPost<Bom>('/api/manufacturing/boms', {
        projectId: pid,
        productName: productName.trim(),
        drawingRef: drawingRef.trim() || undefined,
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
      setProductName(''); setDrawingRef(''); setNotes('')
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
            <div className={`space-y-1.5 ${projectId ? 'sm:col-span-2' : ''}`}>
              <Label htmlFor="bom-product">Product / Assembly Name</Label>
              <Input id="bom-product" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Canopy Frame — Level 1" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bom-dwg">Drawing Reference</Label>
              <Input id="bom-dwg" value={drawingRef} onChange={(e) => setDrawingRef(e.target.value)} placeholder="Optional" className="h-11" />
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{bom.bomNo} — {bom.productName}</DialogTitle>
          <DialogDescription>
            {bom.project?.projectNo} · {bom.items.length} line(s) · gross = qty + wastage. Stock check against current inventory.
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
                    <span className="block max-w-44 truncate">{i.item.name}</span>
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
  )
}

// ---------- generate work order from BOM ----------

function GenerateWoDialog({ bom, open, onOpenChange, onCreated }: { bom: Bom; open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [priority, setPriority] = useState<string>('NORMAL')
  const [startDate, setStartDate] = useState(todayISO())
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const res = await apiPost<WorkOrder>('/api/manufacturing/work-orders', {
        projectId: bom.projectId,
        bomId: bom.id,
        priority,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        notes: notes.trim() || undefined,
      })
      toast.success(`${res.woNo} generated`, {
        description: `${bom.items.length} line(s) grossed with wastage — now add operation tasks (cutting → … → finishing).`,
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
            Lines are pulled from the approved BOM with wastage gross-up. Schedule and priority below.
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
                    <TableCell className="text-right font-medium tabular-nums">{qtyFmt(i.grossQty)} <span className="text-xs text-muted-foreground">{i.uom}</span></TableCell>
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
          <div className="grid gap-4 sm:grid-cols-3">
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
