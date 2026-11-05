'use client'

/**
 * ForgeERP — shared UI atoms.
 * Status/source badges, money cells, KPI cards, empty states, section
 * headings, table skeletons, progress helpers.
 */

import type { LucideIcon } from 'lucide-react'
import { FileText, Inbox, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
  OPEN: 'secondary',
  IN_PROGRESS: 'outline',
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
}: {
  title: string
  value: string
  icon: LucideIcon
  hint?: string
  tone?: 'default' | 'positive' | 'negative' | 'warning'
}) {
  const toneCls =
    tone === 'positive'
      ? 'text-primary'
      : tone === 'negative'
        ? 'text-destructive'
        : tone === 'warning'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-foreground'
  return (
    <Card className="p-4">
      <CardContent className="flex flex-col gap-1 p-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
          <span className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Icon className="size-4" aria-hidden />
          </span>
        </div>
        <span className={cn('text-xl font-semibold tabular-nums sm:text-2xl', toneCls)}>{value}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </CardContent>
    </Card>
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
