'use client'

/**
 * ForgeERP — shared UI atoms.
 * Status/source badges, money cells, KPI cards, empty states, section
 * headings, table skeletons, progress helpers.
 */

import type { LucideIcon } from 'lucide-react'
import { Ban, CheckCircle2, CircleDashed, Clock, FileText, Inbox, Loader, RotateCw, ShieldAlert, TriangleAlert, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { money, qty as qtyFmt } from '@/lib/erp'
import { cn } from '@/lib/utils'

// ---------- status & source badges ----------

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  POSTED: 'default',
  COMPLETED: 'default',
  INVOICED: 'default',
  ISSUED: 'default',
  RUNNING: 'default',
  APPROVED: 'default',
  OPEN: 'secondary',
  PENDING: 'secondary',
  ASSIGNED: 'secondary',
  IN_PROGRESS: 'outline',
  DRAFT: 'outline',
  SUPERSEDED: 'secondary',
  CLOSED: 'secondary',
  CANCELLED: 'destructive',
}

export function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANT[status] ?? 'secondary'
  return (
    <Badge variant={variant} className="uppercase tracking-wide">
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

export function SourceBadge({ source }: { source: string }) {
  if (source !== 'JOBWORK') {
    return <Badge variant="secondary">MANUAL</Badge>
  }
  return (
    <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
      <Wrench className="size-3" aria-hidden />
      JOBWORK
    </Badge>
  )
}

export function VoucherBadge({ type }: { type: string }) {
  const tone: Record<string, string> = {
    OPENING: 'bg-accent text-accent-foreground',
    PURCHASE: 'bg-secondary text-secondary-foreground',
    SALES: 'bg-primary text-primary-foreground',
    JOBWORK_IN: 'bg-accent text-accent-foreground',
    ADJUST: 'bg-muted text-muted-foreground',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium tracking-wide',
        tone[type] ?? 'bg-muted text-muted-foreground'
      )}
    >
      {type}
    </span>
  )
}

// ---------- money & qty cells ----------

export function Money({
  value,
  className,
  plain = false,
}: {
  value: number
  className?: string
  plain?: boolean
}) {
  return (
    <span className={cn('tabular-nums', plain ? '' : 'text-right', className)}>
      {plain ? '' : '₹'}
      {money(value)}
    </span>
  )
}

export function Qty({ value, className }: { value: number; className?: string }) {
  return <span className={cn('tabular-nums text-right', className)}>{qtyFmt(value)}</span>
}

export function NumCell({ value, className }: { value: number; className?: string }) {
  return <span className={cn('tabular-nums text-right', className)}>{qtyFmt(value)}</span>
}

// ---------- KPI card ----------

export function KpiCard({
  title,
  value,
  icon: Icon,
  hint,
  tone = 'default',
  onClick,
}: {
  title: string
  value: string
  icon: LucideIcon
  hint?: string
  tone?: 'default' | 'positive' | 'negative' | 'warning'
  /** Clickable KPIs drill into the module (Mapsoft-style dashboard nav). */
  onClick?: () => void
}) {
  const toneCls =
    tone === 'positive'
      ? 'text-primary'
      : tone === 'negative'
        ? 'text-destructive'
        : tone === 'warning'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-foreground'
  // Bind the ₹ symbol to the amount with a no-break space so a narrow card
  // never wraps the currency symbol onto its own orphan line. Money values
  // size to the CARD (container queries), not the viewport.
  const valueSafe = value.replace(/^₹\s/, '₹\u00A0')
  const body = (
    <CardContent className="flex flex-col gap-1 p-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <span
        className={cn(
          'font-semibold tabular-nums text-sm @min-[200px]:text-base @min-[260px]:text-xl @min-[320px]:text-2xl',
          toneCls
        )}
        title={value}
      >
        {valueSafe}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </CardContent>
  )
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="@container w-full rounded-lg text-left transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${title}: ${value}${hint ? ` — ${hint}` : ''} — open module`}
      >
        <Card className="border-transparent p-4 shadow-none transition-colors hover:border-primary/50">{body}</Card>
      </button>
    )
  }
  return (
    <div className="@container">
      <Card className="p-4">{body}</Card>
    </div>
  )
}

// ---------- section heading ----------

export function SectionHeading({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

// ---------- empty state ----------

export function EmptyState({
  title,
  hint,
  icon: Icon = Inbox,
  action,
}: {
  title: string
  hint?: string
  icon?: LucideIcon
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
      {action}
    </div>
  )
}

// ---------- error state ----------

/**
 * Honest failure surface for list views. Without it a failed API call renders
 * the EMPTY state ("No records 🎉") — masking data outages as good news. Every
 * list that checks `loading ? skeleton : rows.length === 0 ? empty : table`
 * must branch on `error` FIRST.
 */
export function ErrorState({
  error,
  onRetry,
  entity = 'records',
}: {
  error: string | null | undefined
  onRetry?: () => void
  entity?: string
}) {
  if (!error) return null
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-destructive">Could not load {entity}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{error}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RotateCw className="size-3.5" aria-hidden />
          Retry
        </Button>
      ) : null}
    </div>
  )
}

// ---------- loading skeletons ----------

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-4 flex-1', c === 0 && 'max-w-24')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn('h-28 w-full rounded-xl', className)} />
}

export function DocIcon() {
  return <FileText className="size-4" aria-hidden />
}

// ---------- progress ----------

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-secondary', className)}>
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  )
}

// ---------- human-readable workflow status ----------
// Internal codes never reach the user as-is: each maps to a label, a colour
// family and an icon (colour is never the only signal).
type Tone = 'draft' | 'progress' | 'attention' | 'done' | 'bad' | 'hold'
const TONE_CLASS: Record<Tone, string> = {
  draft: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  progress: 'border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  attention: 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  done: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  bad: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
  hold: 'border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
}
const TONE_ICON: Record<Tone, LucideIcon> = { draft: CircleDashed, progress: Loader, attention: Clock, done: CheckCircle2, bad: Ban, hold: ShieldAlert }
const HUMAN_STATUS: Record<string, [string, Tone]> = {
  DRAFT: ['Draft', 'draft'], OPEN: ['Open', 'progress'], SUBMITTED: ['Submitted', 'progress'], IN_PROGRESS: ['In production', 'progress'],
  PENDING: ['Pending', 'attention'], PENDING_QC: ['Awaiting QC', 'attention'], PART_PAID: ['Partly paid', 'attention'], PART_APPLIED: ['Partly applied', 'attention'],
  PART_RECEIVED: ['Partly received', 'attention'], PART_DISPATCHED: ['Partly dispatched', 'attention'], PARTIAL: ['Partly accepted', 'attention'], RECEIVED: ['Quotation received', 'progress'],
  APPROVED: ['Approved', 'done'], POSTED: ['Posted', 'done'], PAID: ['Paid', 'done'], APPLIED: ['Fully applied', 'done'], COMPLETED: ['Completed', 'done'], PASSED: ['QC passed', 'done'],
  SELECTED: ['Selected', 'done'], AWARDED: ['Awarded', 'done'], ORDERED: ['PO raised', 'done'], DISPATCHED: ['Dispatched', 'done'], INVOICED: ['Invoiced', 'done'], ACCEPTED: ['QC accepted', 'done'],
  OVERDUE: ['Overdue', 'bad'], REJECTED: ['Rejected', 'bad'], CANCELLED: ['Cancelled', 'bad'], FAILED: ['QC failed', 'bad'], RECALLED: ['Recalled', 'bad'], EXPIRED: ['Expired', 'bad'],
  QUARANTINE: ['Quarantined', 'hold'], REWORK: ['Rework', 'hold'], BLOCKED: ['Blocked', 'hold'],
  NEW: ['New', 'draft'], CONTACTED: ['Contacted', 'progress'], QUALIFIED: ['Qualified', 'progress'], PROPOSAL: ['Proposal sent', 'attention'], WON: ['Won', 'done'], LOST: ['Lost', 'bad'],
  ASSIGNED: ['Assigned', 'progress'], RESOLVED: ['Resolved', 'attention'], CLOSED: ['Closed', 'done'],
}

export function HumanStatus({ status, detail }: { status: string; detail?: string }) {
  const [label, tone] = HUMAN_STATUS[status] ?? [status.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()), 'draft' as Tone]
  const Icon = TONE_ICON[tone]
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium', TONE_CLASS[tone])}>
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      {detail ? <span className="text-[11px] text-muted-foreground">{detail}</span> : null}
    </span>
  )
}

