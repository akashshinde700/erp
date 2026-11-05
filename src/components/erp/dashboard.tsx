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
  HandCoins,
  ReceiptText,
  ShoppingCart,
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard title="Month Sales" value={`₹ ${money(data.monthSales)}`} icon={ReceiptText} hint="Posted sales this month" />
        <KpiCard title="Month Purchase" value={`₹ ${money(data.monthPurchase)}`} icon={ShoppingCart} hint="Posted purchases this month" />
        <KpiCard title="Receivables" value={`₹ ${money(data.receivables)}`} icon={HandCoins} tone="positive" hint="Customer outstanding" />
        <KpiCard title="Payables" value={`₹ ${money(data.payables)}`} icon={HandCoins} tone="negative" hint="Supplier outstanding" />
        <KpiCard title="Stock Value" value={`₹ ${money(data.stockValue)}`} icon={Boxes} hint="Closing @ avg cost" />
        <KpiCard title="Open Jobwork" value={`₹ ${money(data.openJobworkValue)}`} icon={Factory} tone="warning" hint="Completed cards, not invoiced" />
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
                    <li key={l.code} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{l.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {l.code} · reorder @ {l.reorderLevel} {l.uom}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        {l.closing} {l.uom}
                      </span>
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
          <Button variant="ghost" size="sm" onClick={() => setView('sales')} className="gap-1">
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
                    <TableHead>Party</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentInvoices.map((inv) => (
                    <TableRow
                      key={inv.id}
                      className="cursor-pointer"
                      onClick={() => setView('sales-detail', { id: inv.id })}
                    >
                      <TableCell className="font-medium tabular-nums">{inv.invoiceNo}</TableCell>
                      <TableCell>{dateStr(inv.date)}</TableCell>
                      <TableCell className="max-w-48 truncate">{inv.party}</TableCell>
                      <TableCell className="text-right font-semibold">
                        <Money value={inv.grandTotal} plain />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Money value={inv.paidAmount} plain />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Money value={inv.grandTotal - inv.paidAmount} plain />
                      </TableCell>
                      <TableCell>
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
