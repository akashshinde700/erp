'use client'

/**
 * ForgeERP — Dashboard view.
 * KPI row, 6-month sales/purchase trend (recharts), recent invoices,
 * low-stock alerts. Clicking a recent invoice opens the sales detail view.
 */

import {
  ArrowUpRight,
  Boxes,
  Factory,
  FolderKanban,
  HandCoins,
  PackageOpen,
  Plus,
  ReceiptText,
  ShoppingCart,
  Truck,
  TriangleAlert,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi, type DashboardData } from './api'
import { CardSkeleton, EmptyState, KpiCard, Money, SectionHeading, SourceBadge } from './bits'
import { useErpUi } from './store'
import { dateStr, money } from '@/lib/erp'

const TREND_SALES = 'var(--chart-1)'
const TREND_PURCHASE = 'var(--chart-3)'

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-popover-foreground">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 tabular-nums text-popover-foreground">
          <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden />
          {p.name}: ₹ {money(p.value)}
        </p>
      ))}
    </div>
  )
}

export function DashboardView() {
  const { data, loading } = useApi<DashboardData>('/api/dashboard')
  const setView = useErpUi((s) => s.setView)

  const quickActions = [
    { label: 'New Sales Invoice', icon: ReceiptText, view: 'sales' as const, hint: 'GST tax invoice' },
    { label: 'New Purchase', icon: ShoppingCart, view: 'purchase' as const, hint: 'Supplier bill' },
    { label: 'Jobwork Inward', icon: Factory, view: 'jobwork' as const, hint: 'Customer material in' },
    { label: 'Record Payment', icon: HandCoins, view: 'accounting' as const, hint: 'Receipt / payment' },
    { label: 'Stock Snapshot', icon: PackageOpen, view: 'inventory' as const, hint: 'Balances & ledger' },
    { label: 'Tally Export', icon: Truck, view: 'tally' as const, hint: 'Vouchers & masters' },
  ]

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <SectionHeading title="Dashboard" description="Live business snapshot" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <CardSkeleton className="h-72" />
        <CardSkeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Dashboard"
        description="Month-to-date performance, outstanding balances, stock health and the live jobwork pipeline."
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {quickActions.map((qa) => (
          <button
            key={qa.label}
            type="button"
            onClick={() => setView(qa.view)}
            className="group flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent"
            aria-label={qa.label}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <qa.icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold">{qa.label}</span>
              <span className="block text-[10px] leading-tight text-muted-foreground line-clamp-2">{qa.hint}</span>
            </span>
            <Plus className="ml-auto size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" aria-hidden />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-7">
        <KpiCard title="Month Sales" value={`₹ ${money(data.monthSales)}`} icon={ReceiptText} hint="Posted sales this month" onClick={() => setView('sales')} />
        <KpiCard title="Month Purchase" value={`₹ ${money(data.monthPurchase)}`} icon={ShoppingCart} hint="Posted purchases this month" onClick={() => setView('purchase')} />
        <KpiCard title="Receivables" value={`₹ ${money(data.receivables)}`} icon={HandCoins} tone="positive" hint="Customer outstanding" onClick={() => setView('accounting')} />
        <KpiCard title="Payables" value={`₹ ${money(data.payables)}`} icon={HandCoins} tone="negative" hint="Supplier outstanding" onClick={() => setView('accounting')} />
        <KpiCard title="Stock Value" value={`₹ ${money(data.stockValue)}`} icon={Boxes} hint="Closing @ avg cost" onClick={() => setView('inventory')} />
        <KpiCard title="Open Jobwork" value={`₹ ${money(data.openJobworkValue)}`} icon={Factory} tone="warning" hint="Completed cards, not invoiced" onClick={() => setView('jobwork')} />
        <KpiCard title="Projects & Tasks" value={`${data.runningProjects} / ${data.pendingTasks}`} icon={FolderKanban} tone={data.pendingTasks > 0 ? 'warning' : 'default'} hint="Active projects / pending tasks" onClick={() => setView('manufacturing')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Sales vs Purchase — last 6 months
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={TREND_SALES} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={TREND_SALES} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="purchaseFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={TREND_PURCHASE} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={TREND_PURCHASE} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => (v >= 100000 ? `${Math.round(v / 100000)}L` : v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))}
                />
                <Tooltip content={<TrendTooltip />} />
                <Area type="monotone" dataKey="sales" name="Sales" stroke={TREND_SALES} strokeWidth={2} fill="url(#salesFill)" />
                <Area type="monotone" dataKey="purchase" name="Purchase" stroke={TREND_PURCHASE} strokeWidth={2} fill="url(#purchaseFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
              <TriangleAlert className="size-4 text-amber-500" aria-hidden />
              Low Stock ({data.lowStock.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.lowStock.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState title="No low-stock items" hint="All stock items are above their reorder level." />
              </div>
            ) : (
              <ScrollArea className="h-72">
                <ul className="divide-y">
                  {data.lowStock.map((l) => (
                    <li key={l.code}>
                      <button
                        type="button"
                        onClick={() => setView('inventory')}
                        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/50"
                        aria-label={`Open inventory — ${l.name} below reorder level`}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{l.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {l.code} · reorder @ {l.reorderLevel} {l.uom}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                          {l.closing} {l.uom}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Recent Invoices
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setView('sales')} className="h-10 gap-1">
            View all <ArrowUpRight className="size-4" aria-hidden />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {data.recentInvoices.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No invoices yet" hint="Create a sales invoice to see it here." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="hidden sm:table-cell">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentInvoices.map((inv) => (
                    <TableRow
                      key={inv.id}
                      className="cursor-pointer"
                      onClick={() => setView('sales-detail', { id: inv.id })}
                    >
                      <TableCell>
                        <span className="block font-medium tabular-nums">{inv.invoiceNo}</span>
                        <span className="block max-w-40 truncate text-xs text-muted-foreground">{inv.party}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{dateStr(inv.date)}</TableCell>
                      <TableCell className="text-right font-semibold">
                        <Money value={inv.grandTotal} plain />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        <Money value={inv.paidAmount} plain />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Money value={inv.grandTotal - inv.paidAmount} plain />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <SourceBadge source={inv.source} />
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
