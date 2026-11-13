'use client'

/**
 * ForgeERP — Reports view.
 * GSTR-1 (B2B/B2C rate-wise), Trial Balance (with ΣDr = ΣCr integrity
 * banner), Outstanding, and P&L statement.
 */

import { useState, type ReactNode } from 'react'
import { BarChart3, CheckCircle2, FileSpreadsheet, PackageSearch, Scale, TrendingDown, TrendingUp, TriangleAlert, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  currentMonth,
  useApi,
  type CashBankBook,
  type CustomerPerformanceReport,
  type Gstr1Report,
  type Gstr3bReport,
  type HsnSummaryReport,
  type InventoryPlanningReport,
  type Outstanding,
  type Pnl,
  type ProductionCostVarianceReport,
  type ProductionEfficiencyMetric,
  type ProductionEfficiencyReport,
  type SupplierPerformanceReport,
  type TrialBalance,
  type WorkflowActionCenterReport,
} from './api'
import { EmptyState, Money, SectionHeading, TableSkeleton } from './bits'
import { money } from '@/lib/erp'
import { useErpUi } from './store'
import { AgingTab, BackOrdersTab, BalanceSheetTab, PnlLedgerTab, ProjectProfitabilityTab, PurchaseBySupplierTab, SalesAnalysisTab } from './reports-extra'

// ---------- grouped report navigation (category → report, 2 levels) ----------

type RepTab =
  | 'action-center' | 'gstr1' | 'gstr3b' | 'hsn' | 'trial' | 'pnl' | 'pnl-ledger'
  | 'balance-sheet' | 'cashbook' | 'outstanding' | 'aging' | 'customers' | 'suppliers'
  | 'sales-analysis' | 'purchase-supplier' | 'back-orders'
  | 'production-cost' | 'efficiency' | 'inventory' | 'projects'

/** Reports grouped the way they are used, instead of one flat 20-tab wall. */
const REPORT_GROUPS: { label: string; items: { value: RepTab; label: string }[] }[] = [
  {
    label: 'Overview',
    items: [{ value: 'action-center', label: 'Action Center' }],
  },
  {
    label: 'GST & Compliance',
    items: [
      { value: 'gstr1', label: 'GSTR-1' },
      { value: 'gstr3b', label: 'GSTR-3B' },
      { value: 'hsn', label: 'HSN Summary' },
    ],
  },
  {
    label: 'Financial',
    items: [
      { value: 'trial', label: 'Trial Balance' },
      { value: 'pnl', label: 'P&L' },
      { value: 'pnl-ledger', label: 'P&L by Ledger' },
      { value: 'balance-sheet', label: 'Balance Sheet' },
      { value: 'cashbook', label: 'Cash & Bank' },
    ],
  },
  {
    label: 'Parties & Outstanding',
    items: [
      { value: 'outstanding', label: 'Outstanding' },
      { value: 'aging', label: 'Aging' },
      { value: 'customers', label: 'Customers' },
      { value: 'suppliers', label: 'Suppliers' },
    ],
  },
  {
    label: 'Sales & Purchase',
    items: [
      { value: 'sales-analysis', label: 'Sales Analysis' },
      { value: 'purchase-supplier', label: 'Purchase by Supplier' },
      { value: 'back-orders', label: 'Back Orders' },
    ],
  },
  {
    label: 'Manufacturing & Stock',
    items: [
      { value: 'production-cost', label: 'Production Cost' },
      { value: 'efficiency', label: 'Efficiency' },
      { value: 'inventory', label: 'Inventory Planning' },
      { value: 'projects', label: 'Project Profitability' },
    ],
  },
]

function chipClass(active: boolean): string {
  return cn(
    'inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium transition-colors',
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border bg-background text-foreground hover:bg-accent',
  )
}

export function ReportsView() {
  const [tab, setTab] = useState<RepTab>('action-center')
  const group = REPORT_GROUPS.find((g) => g.items.some((i) => i.value === tab)) ?? REPORT_GROUPS[0]

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Reports"
        description="GST, financial and integrity reports — all derived from the append-only ledgers."
      />

      {/* Level 1 — pick a category */}
      <nav aria-label="Report categories" className="flex flex-wrap gap-1.5">
        {REPORT_GROUPS.map((g) => {
          const active = g.label === group.label
          return (
            <button key={g.label} type="button" onClick={() => setTab(g.items[0].value)} className={chipClass(active)} aria-current={active ? 'true' : undefined}>
              {g.label}
            </button>
          )
        })}
      </nav>

      {/* Level 2 — pick a report inside the category */}
      <nav aria-label={`Reports — ${group.label}`} className="flex flex-wrap gap-1.5 border-b pb-3">
        {group.items.map((item) => {
          const active = item.value === tab
          return (
            <button key={item.value} type="button" onClick={() => setTab(item.value)} className={chipClass(active)} aria-current={active ? 'true' : undefined}>
              {item.label}
            </button>
          )
        })}
      </nav>

      <div role="tabpanel" aria-label={group.items.find((i) => i.value === tab)?.label ?? 'Report'} className="min-w-0">
        {tab === 'action-center' && <ActionCenterTab />}
        {tab === 'gstr1' && <Gstr1Tab />}
        {tab === 'gstr3b' && <Gstr3bTab />}
        {tab === 'hsn' && <HsnSummaryTab />}
        {tab === 'trial' && <TrialBalanceTab />}
        {tab === 'outstanding' && <OutstandingTab />}
        {tab === 'cashbook' && <CashBankBookTab />}
        {tab === 'customers' && <CustomerPerformanceTab />}
        {tab === 'suppliers' && <SupplierPerformanceTab />}
        {tab === 'production-cost' && <ProductionCostTab />}
        {tab === 'efficiency' && <ProductionEfficiencyTab />}
        {tab === 'inventory' && <InventoryPlanningTab />}
        {tab === 'pnl' && <PnlTab />}
        {tab === 'pnl-ledger' && <PnlLedgerTab />}
        {tab === 'balance-sheet' && <BalanceSheetTab />}
        {tab === 'aging' && <AgingTab />}
        {tab === 'back-orders' && <BackOrdersTab />}
        {tab === 'sales-analysis' && <SalesAnalysisTab />}
        {tab === 'purchase-supplier' && <PurchaseBySupplierTab />}
        {tab === 'projects' && <ProjectProfitabilityTab />}
      </div>
    </div>
  )
}

// ---------- cross-module action center ----------

function ActionCenterTab() {
  const { data, loading } = useApi<WorkflowActionCenterReport>('/api/reports?type=action-center')
  const setView = useErpUi((state) => state.setView)
  if (loading) return <TableSkeleton rows={8} cols={6} />
  if (!data) return <EmptyState title="No action data" hint="Operational actions will appear from live module states." icon={TriangleAlert} />
  const actionLabel: Record<string, string> = {
    COMPLETE_PROCESSING: 'Complete processing',
    ISSUE_CERTIFICATE: 'Issue certificate',
    GENERATE_INVOICE: 'Generate invoice',
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Critical Actions</p><p className="mt-1 text-xl font-semibold text-destructive">{data.summary.critical}</p><p className="text-xs text-muted-foreground">overdue / stock-out</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">High Priority</p><p className="mt-1 text-xl font-semibold text-amber-600">{data.summary.high}</p><p className="text-xs text-muted-foreground">assignment / billing</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Receivables</p><p className="mt-1 text-lg font-semibold text-primary"><Money value={data.summary.receivables} plain /></p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Payables</p><p className="mt-1 text-lg font-semibold text-destructive"><Money value={data.summary.payables} plain /></p></Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="min-w-0 p-0"><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-3"><CardTitle className="text-sm">Production Tasks</CardTitle><Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => setView('manufacturing')}>Open Manufacturing</Button></CardHeader><CardContent className="p-0">
          {data.tasks.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No pending production tasks.</p> : <div className="max-h-80 overflow-auto"><Table><TableHeader><TableRow><TableHead>Task / Project</TableHead><TableHead>Reason</TableHead><TableHead>Worker</TableHead></TableRow></TableHeader><TableBody>{data.tasks.map((task) => <TableRow key={task.id}><TableCell><span className="font-medium tabular-nums">{task.taskNo}</span><span className="block text-xs text-muted-foreground">{task.projectNo} · {task.woNo} · {task.operation.replaceAll('_', ' ')}</span></TableCell><TableCell><Badge variant={task.priority === 'CRITICAL' ? 'destructive' : task.priority === 'HIGH' ? 'secondary' : 'outline'}>{task.reason}</Badge></TableCell><TableCell className="text-xs">{task.employee?.name ?? 'Unassigned'}</TableCell></TableRow>)}</TableBody></Table></div>}
        </CardContent></Card>
        <Card className="min-w-0 p-0"><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-3"><CardTitle className="text-sm">Stock Reorder</CardTitle><Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => setView('inventory')}>Open Inventory</Button></CardHeader><CardContent className="p-0">
          {data.stock.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No reorder actions.</p> : <div className="max-h-80 overflow-auto"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Closing</TableHead><TableHead className="text-right">Suggested</TableHead></TableRow></TableHeader><TableBody>{data.stock.map((row) => <TableRow key={row.item.id}><TableCell><span className="font-medium">{row.item.name}</span><span className="block text-xs text-muted-foreground">{row.item.code}</span></TableCell><TableCell className="text-right tabular-nums">{row.closing} {row.item.uom}</TableCell><TableCell className="text-right font-semibold text-destructive tabular-nums">{row.suggestedOrderQty} {row.item.uom}</TableCell></TableRow>)}</TableBody></Table></div>}
        </CardContent></Card>
      </div>
      <Card className="min-w-0 p-0"><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-3"><CardTitle className="text-sm">Customer Jobwork Actions</CardTitle><Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => setView('jobwork')}>Open Jobwork</Button></CardHeader><CardContent className="p-0">
        {data.jobwork.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No open jobwork actions.</p> : <div className="overflow-auto"><Table><TableHeader><TableRow><TableHead>Inward / Customer</TableHead><TableHead>Next Action</TableHead><TableHead className="text-right">Processed</TableHead><TableHead className="text-right">Unbilled Card Value</TableHead></TableRow></TableHeader><TableBody>{data.jobwork.map((row) => <TableRow key={row.id}><TableCell><span className="font-medium tabular-nums">{row.inwardNo}</span><span className="block text-xs text-muted-foreground">{row.party}</span></TableCell><TableCell><Badge variant={row.priority === 'HIGH' ? 'secondary' : 'outline'}>{actionLabel[row.action] ?? row.action}</Badge></TableCell><TableCell className="text-right tabular-nums">{row.processedQty}/{row.receivedQty}</TableCell><TableCell className="text-right tabular-nums"><Money value={row.cardValue} plain /></TableCell></TableRow>)}</TableBody></Table></div>}
      </CardContent></Card>
    </div>
  )
}

// ---------- GSTR-1 ----------

function Gstr1Tab() {
  const [month, setMonth] = useState(currentMonth())
  const [applied, setApplied] = useState(currentMonth())
  const { data, loading } = useApi<Gstr1Report>(`/api/reports?type=gstr1&month=${applied}`)

  const bucketTable = (title: string, rows: Gstr1Report['b2b'], total: Gstr1Report['b2bTotal']) => (
    <Card className="p-0">
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {title} — rate-wise summary
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No {title} invoices this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="hidden text-right md:table-cell">CGST</TableHead>
                  <TableHead className="hidden text-right md:table-cell">SGST</TableHead>
                  <TableHead className="hidden text-right md:table-cell">IGST</TableHead>
                  <TableHead className="text-right">Total Tax</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.rate}>
                    <TableCell className="text-right font-medium">{b.rate}%</TableCell>
                    <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Money value={b.taxable} plain />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      <Money value={b.cgst} plain />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      <Money value={b.sgst} plain />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">
                      <Money value={b.igst} plain />
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      <Money value={b.cgst + b.sgst + b.igst} plain />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">{total.count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Money value={total.taxable} plain />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    <Money value={total.cgst} plain />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    <Money value={total.sgst} plain />
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    <Money value={total.igst} plain />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Money value={total.cgst + total.sgst + total.igst} plain />
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:max-w-md sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="gstr-month">Return month</Label>
          <Input id="gstr-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-11" />
        </div>
        <Button onClick={() => setApplied(month)} className="h-11">Run report</Button>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : !data ? (
        <EmptyState title="No data" hint="Run the report for a month." icon={BarChart3} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">{data.invoiceCount} invoices</Badge>
            <Badge className="gap-1">
              B2B <span className="tabular-nums">{data.b2bCount}</span>
            </Badge>
            <Badge variant="outline" className="tabular-nums">B2C {data.b2cCount}</Badge>
            <span className="ml-auto text-sm text-muted-foreground">
              Month <span className="font-medium tabular-nums text-foreground">{data.month}</span> · POSTED sales
              only, B2B = party has GSTIN
            </span>
          </div>
          {bucketTable('B2B', data.b2b, data.b2bTotal)}
          {bucketTable('B2C', data.b2c, data.b2cTotal)}
        </>
      )}
    </div>
  )
}

// ---------- GSTR-3B books working ----------

function Gstr3bTab() {
  const [month, setMonth] = useState(currentMonth())
  const [applied, setApplied] = useState(currentMonth())
  const { data, loading } = useApi<Gstr3bReport>(`/api/reports?type=gstr3b&month=${applied}`)
  const taxRows = data ? [
    { label: 'CGST', output: data.outward.cgst, input: data.eligibleItcFromBooks.cgst, net: data.netTaxBeforeCrossUtilisation.cgst, excess: data.excessItcBeforeCrossUtilisation.cgst },
    { label: 'SGST', output: data.outward.sgst, input: data.eligibleItcFromBooks.sgst, net: data.netTaxBeforeCrossUtilisation.sgst, excess: data.excessItcBeforeCrossUtilisation.sgst },
    { label: 'IGST', output: data.outward.igst, input: data.eligibleItcFromBooks.igst, net: data.netTaxBeforeCrossUtilisation.igst, excess: data.excessItcBeforeCrossUtilisation.igst },
  ] : []
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:max-w-md sm:grid-cols-[1fr_auto] sm:items-end"><div className="space-y-1"><Label htmlFor="gstr3b-month">Return month</Label><Input id="gstr3b-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-11" /></div><Button onClick={() => setApplied(month)} className="h-11">Run summary</Button></div>
      {loading ? <TableSkeleton rows={6} cols={5} /> : !data ? <EmptyState title="No data" hint="Run the books summary for a month." icon={BarChart3} /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card className="p-4"><p className="text-xs text-muted-foreground">Outward Taxable</p><p className="mt-1 text-lg font-semibold"><Money value={data.outward.taxable} plain /></p><p className="text-xs text-muted-foreground">{data.salesInvoiceCount} sales invoices</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Purchase Taxable</p><p className="mt-1 text-lg font-semibold"><Money value={data.eligibleItcFromBooks.taxable} plain /></p><p className="text-xs text-muted-foreground">{data.purchaseInvoiceCount} purchase invoices</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Net Tax Before Utilisation</p><p className="mt-1 text-lg font-semibold text-destructive"><Money value={data.netTaxBeforeCrossUtilisation.total} plain /></p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Excess ITC</p><p className="mt-1 text-lg font-semibold text-primary"><Money value={data.excessItcBeforeCrossUtilisation.total} plain /></p></Card>
        </div>
        <Card className="p-0"><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Tax Head</TableHead><TableHead className="text-right">Output Liability</TableHead><TableHead className="text-right">Input ITC (Books)</TableHead><TableHead className="text-right">Net Before Cross-Utilisation</TableHead><TableHead className="text-right">Excess ITC</TableHead></TableRow></TableHeader><TableBody>{taxRows.map((row) => <TableRow key={row.label}><TableCell className="font-medium">{row.label}</TableCell><TableCell className="text-right"><Money value={row.output} plain /></TableCell><TableCell className="text-right"><Money value={row.input} plain /></TableCell><TableCell className="text-right font-semibold text-destructive"><Money value={row.net} plain /></TableCell><TableCell className="text-right font-semibold text-primary"><Money value={row.excess} plain /></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
        <Card className="border-amber-500/30 bg-amber-500/5 p-4"><p className="text-sm font-medium">Books working — not a filed return</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{data.limitations.map((item) => <li key={item}>{item}</li>)}</ul></Card>
      </>}
    </div>
  )
}

// ---------- HSN/SAC summary ----------

function HsnSummaryTab() {
  const [month, setMonth] = useState(currentMonth())
  const [applied, setApplied] = useState(currentMonth())
  const { data, loading } = useApi<HsnSummaryReport>(`/api/reports?type=hsn-summary&month=${applied}`)
  const table = (title: string, rows: HsnSummaryReport['outward']) => <Card className="p-0"><CardHeader className="border-b py-3"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent className="p-0">{rows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No lines this month.</p> : <div className="overflow-auto"><Table><TableHeader><TableRow><TableHead>HSN/SAC</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Qty / UOM</TableHead><TableHead className="text-right">GST Rate</TableHead><TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">CGST</TableHead><TableHead className="text-right">SGST</TableHead><TableHead className="text-right">IGST</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={`${row.hsn}-${row.uom}-${row.gstRate}`}><TableCell><Badge variant={row.hsn === 'MISSING' ? 'destructive' : 'outline'}>{row.hsn}</Badge></TableCell><TableCell>{row.description}</TableCell><TableCell className="text-right tabular-nums">{row.qty} {row.uom}</TableCell><TableCell className="text-right tabular-nums">{row.gstRate}%</TableCell><TableCell className="text-right"><Money value={row.taxable} plain /></TableCell><TableCell className="text-right"><Money value={row.cgst} plain /></TableCell><TableCell className="text-right"><Money value={row.sgst} plain /></TableCell><TableCell className="text-right"><Money value={row.igst} plain /></TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
  return <div className="space-y-4"><div className="grid gap-2 sm:max-w-md sm:grid-cols-[1fr_auto] sm:items-end"><div className="space-y-1"><Label>Month</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-11" /></div><Button onClick={() => setApplied(month)} className="h-11">Run summary</Button></div>{loading ? <TableSkeleton rows={8} cols={8} /> : data ? <><div className="flex flex-wrap gap-2"><Badge variant="secondary">Outward taxable ₹{money(data.outwardTaxable)}</Badge><Badge variant="secondary">Inward taxable ₹{money(data.inwardTaxable)}</Badge>{data.missingHsnLines > 0 ? <Badge variant="destructive">{data.missingHsnLines} missing HSN group(s)</Badge> : <Badge>HSN complete</Badge>}</div>{table('Outward HSN/SAC', data.outward)}{table('Inward HSN/SAC', data.inward)}</> : null}</div>
}

// ---------- trial balance ----------

function TrialBalanceTab() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [applied, setApplied] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const qs = new URLSearchParams({ type: 'trial-balance' })
  if (applied.from) qs.set('from', applied.from)
  if (applied.to) qs.set('to', applied.to)
  const { data, loading } = useApi<TrialBalance>(`/api/reports?${qs.toString()}`)

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11" />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setApplied({ from, to })} className="h-11 flex-1">Apply</Button>
          <Button
            variant="outline"
            onClick={() => {
              setFrom('')
              setTo('')
              setApplied({ from: '', to: '' })
            }}
            className="h-11"
          >
            Reset
          </Button>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={8} cols={4} />
      ) : !data ? (
        <EmptyState title="No data" hint="Adjust the period and apply." icon={Scale} />
      ) : (
        <>
          <div
            className={`flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium ${
              data.balanced
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'border-destructive/40 bg-destructive/10 text-destructive'
            }`}
            role="status"
          >
            {data.balanced ? (
              <>
                <CheckCircle2 className="size-4" aria-hidden />
                Balanced ✓ — ΣDebit = ΣCredit = ₹ {money(data.totalDr)}
              </>
            ) : (
              <>
                <XCircle className="size-4" aria-hidden />
                Out of balance — ΣDr ₹ {money(data.totalDr)} vs ΣCr ₹ {money(data.totalCr)}
              </>
            )}
          </div>

          <Card className="p-0">
            <CardContent className="p-0">
              <div className="max-h-[62dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Closing (Dr − Cr)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.accounts.map((a) => (
                      <TableRow key={a.account}>
                        <TableCell>
                          <span className="block font-medium">{a.accountName}</span>
                          <span className="block font-mono text-xs text-muted-foreground">{a.account}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{a.debit > 0.004 ? money(a.debit) : ''}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.credit > 0.004 ? money(a.credit) : ''}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${a.closing < 0 ? 'text-destructive' : ''}`}>
                          {Math.abs(a.closing) > 0.004 ? money(a.closing) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">₹ {money(data.totalDr)}</TableCell>
                      <TableCell className="text-right tabular-nums">₹ {money(data.totalCr)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        ₹ {money(data.totalDr - data.totalCr)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ---------- outstanding ----------

function OutstandingTab() {
  const { data, loading } = useApi<Outstanding>('/api/reports?type=outstanding')

  const table = (title: string, rows: Outstanding['customers'], total: number, tone: 'in' | 'out') => (
    <Card className="p-0">
      <CardHeader className="flex flex-row items-center justify-between border-b py-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {tone === 'in' ? (
            <TrendingUp className="size-4 text-primary" aria-hidden />
          ) : (
            <TrendingDown className="size-4 text-destructive" aria-hidden />
          )}
          {title}
        </CardTitle>
        <span className="text-sm font-semibold tabular-nums">₹ {money(total)}</span>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing outstanding.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Party</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.party.id}>
                    <TableCell>
                      <span className="block font-medium">{r.party.name}</span>
                      <span className="block text-xs text-muted-foreground">{r.party.code}</span>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      <Money value={r.amount} plain />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {money(total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )

  if (loading) return <TableSkeleton rows={6} cols={2} />
  if (!data) return <EmptyState title="No data" hint="Run the outstanding report." icon={FileSpreadsheet} />

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {table('Receivables (customers)', data.customers, data.totalReceivable, 'in')}
      {table('Payables (suppliers)', data.suppliers, data.totalPayable, 'out')}
    </div>
  )
}

// ---------- cash & bank book ----------

function CashBankBookTab() {
  const now = new Date()
  const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const [from, setFrom] = useState(first)
  const [to, setTo] = useState(today)
  const [applied, setApplied] = useState({ from: first, to: today })
  const { data, loading } = useApi<CashBankBook>(`/api/reports?type=cash-bank-book&from=${applied.from}&to=${applied.to}`)

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
        <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11" /></div>
        <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11" /></div>
        <Button onClick={() => setApplied({ from, to })} disabled={!from || !to || from > to} className="h-11">Run book</Button>
      </div>
      {loading ? <TableSkeleton rows={8} cols={7} /> : !data ? (
        <EmptyState title="No cash/bank data" hint="Post receipts or payments to build the book." icon={FileSpreadsheet} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.accounts.map((account) => (
              <Card key={account.account} className="p-4">
                <div className="flex items-center justify-between"><p className="font-medium">{account.accountName}</p><Badge variant="outline">{account.account}</Badge></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><p className="text-xs text-muted-foreground">Opening</p><Money value={account.opening} plain /></div>
                  <div className="text-right"><p className="text-xs text-muted-foreground">Closing</p><span className="font-semibold"><Money value={account.closing} plain /></span></div>
                  <div><p className="text-xs text-muted-foreground">Receipts</p><span className="text-primary"><Money value={account.receipts} plain /></span></div>
                  <div className="text-right"><p className="text-xs text-muted-foreground">Payments</p><span className="text-destructive"><Money value={account.payments} plain /></span></div>
                </div>
              </Card>
            ))}
          </div>
          <Card className="p-0"><CardContent className="p-0">
            {data.rows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No cash or bank movements in this period.</p> : (
              <div className="max-h-[58dvh] overflow-auto erp-scroll"><Table>
                <TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>Date / Voucher</TableHead><TableHead>Account</TableHead><TableHead>Party / Remarks</TableHead><TableHead className="text-right">Receipt</TableHead><TableHead className="text-right">Payment</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
                <TableBody>{data.rows.map((row) => <TableRow key={row.id}>
                  <TableCell><span className="block text-xs tabular-nums">{row.date.slice(0, 10)}</span><span className="font-medium tabular-nums">{row.voucherType} · {row.voucherNo}</span></TableCell>
                  <TableCell><Badge variant="outline">{row.account}</Badge></TableCell>
                  <TableCell><span className="block">{row.party?.name ?? '—'}</span><span className="block max-w-64 truncate text-xs text-muted-foreground">{row.remarks ?? ''}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{row.debit > 0 ? <Money value={row.debit} plain /> : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.credit > 0 ? <Money value={row.credit} plain /> : '—'}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums"><Money value={row.balance} plain /></TableCell>
                </TableRow>)}</TableBody>
              </Table></div>
            )}
          </CardContent></Card>
        </>
      )}
    </div>
  )
}

// ---------- customer performance ----------

function CustomerPerformanceTab() {
  const { data, loading } = useApi<CustomerPerformanceReport>('/api/reports?type=customer-performance')
  if (loading) return <TableSkeleton rows={8} cols={7} />
  if (!data) return <EmptyState title="No customer data" hint="Create customer masters and post sales to build customer analysis." icon={FileSpreadsheet} />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Active Customers</p><p className="mt-1 text-lg font-semibold">{data.summary.activeCustomers}</p><p className="text-xs text-muted-foreground">{data.summary.customersServed} with sales</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Total Sales</p><p className="mt-1 text-lg font-semibold"><Money value={data.summary.totalSales} plain /></p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Received</p><p className="mt-1 text-lg font-semibold text-primary"><Money value={data.summary.totalReceived} plain /></p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Invoice Outstanding</p><p className="mt-1 text-lg font-semibold text-destructive"><Money value={data.summary.invoiceOutstanding} plain /></p><p className="text-xs text-muted-foreground">Jobwork ₹{money(data.summary.jobworkSales)}</p></Card>
      </div>
      <p className="text-xs text-muted-foreground">{data.note}</p>
      <Card className="p-0"><CardContent className="p-0">
        <div className="max-h-[62dvh] overflow-auto erp-scroll"><Table>
          <TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Last Sale</TableHead><TableHead>Top Items / Services</TableHead></TableRow></TableHeader>
          <TableBody>{data.rows.map((row) => <TableRow key={row.customer.id}>
            <TableCell><span className="block font-medium">{row.customer.name}</span><span className="text-xs text-muted-foreground">{row.customer.code}{row.customer.city ? ` · ${row.customer.city}` : ''}</span>{!row.customer.active ? <Badge variant="secondary" className="mt-1">Inactive</Badge> : null}</TableCell>
            <TableCell className="text-right tabular-nums">{row.invoiceCount}{row.cancelledCount ? <span className="block text-xs text-muted-foreground">{row.cancelledCount} cancelled</span> : null}</TableCell>
            <TableCell className="text-right tabular-nums"><Money value={row.salesValue} plain /><span className="block text-xs text-muted-foreground">avg ₹{money(row.avgInvoiceValue)}</span>{row.jobworkValue > 0 ? <span className="block text-xs text-muted-foreground">jobwork {row.jobworkSharePct}%</span> : null}</TableCell>
            <TableCell className="text-right tabular-nums"><Money value={row.receivedValue} plain /><span className="block text-xs text-muted-foreground">{row.collectionPct}%</span></TableCell>
            <TableCell className={`text-right font-semibold tabular-nums ${row.invoiceOutstanding > 0 ? 'text-destructive' : ''}`}><Money value={row.invoiceOutstanding} plain /></TableCell>
            <TableCell className="whitespace-nowrap text-xs tabular-nums">{row.lastSaleAt ? row.lastSaleAt.slice(0, 10) : 'Never'}</TableCell>
            <TableCell><div className="max-w-64 space-y-1">{row.topItems.length ? row.topItems.map((line) => <p key={line.item.id} className="truncate text-xs" title={`${line.item.name}: ${line.qty} ${line.item.uom}, avg ₹${line.avgRate}`}><span className="font-medium">{line.item.code}</span> · {line.qty} {line.item.uom} · ₹{money(line.taxableValue)}</p>) : <span className="text-xs text-muted-foreground">No posted sales</span>}</div></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>
      </CardContent></Card>
    </div>
  )
}

// ---------- supplier performance ----------

function SupplierPerformanceTab() {
  const { data, loading } = useApi<SupplierPerformanceReport>('/api/reports?type=supplier-performance')
  if (loading) return <TableSkeleton rows={8} cols={7} />
  if (!data) return <EmptyState title="No supplier data" hint="Create supplier masters and post purchases to build vendor analysis." icon={FileSpreadsheet} />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Active Suppliers</p><p className="mt-1 text-lg font-semibold">{data.summary.activeSuppliers}</p><p className="text-xs text-muted-foreground">{data.summary.suppliersUsed} with purchases</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Total Purchases</p><p className="mt-1 text-lg font-semibold"><Money value={data.summary.totalPurchases} plain /></p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Paid</p><p className="mt-1 text-lg font-semibold text-primary"><Money value={data.summary.totalPaid} plain /></p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Outstanding</p><p className="mt-1 text-lg font-semibold text-destructive"><Money value={data.summary.totalOutstanding} plain /></p></Card>
      </div>
      <Card className="border-amber-500/30 bg-amber-500/5 p-4">
        <p className="text-sm font-medium">Auditable metrics only</p>
        <p className="mt-1 text-xs text-muted-foreground">On-time delivery, QC acceptance and three-way-match scores are not fabricated. They will become available after PO → GRN → QC is implemented.</p>
      </Card>
      <Card className="p-0"><CardContent className="p-0">
        <div className="max-h-[62dvh] overflow-auto erp-scroll"><Table>
          <TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>Supplier</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Purchases</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Last Purchase</TableHead><TableHead>Top Purchased Items</TableHead></TableRow></TableHeader>
          <TableBody>{data.rows.map((row) => <TableRow key={row.supplier.id}>
            <TableCell><span className="block font-medium">{row.supplier.name}</span><span className="text-xs text-muted-foreground">{row.supplier.code}{row.supplier.city ? ` · ${row.supplier.city}` : ''}</span>{!row.supplier.active ? <Badge variant="secondary" className="mt-1">Inactive</Badge> : null}</TableCell>
            <TableCell className="text-right tabular-nums">{row.invoiceCount}{row.cancelledCount ? <span className="block text-xs text-muted-foreground">{row.cancelledCount} cancelled</span> : null}</TableCell>
            <TableCell className="text-right tabular-nums"><Money value={row.purchaseValue} plain /><span className="block text-xs text-muted-foreground">avg ₹{money(row.avgInvoiceValue)}</span></TableCell>
            <TableCell className="text-right tabular-nums"><Money value={row.paidValue} plain /><span className="block text-xs text-muted-foreground">{row.paymentPct}%</span></TableCell>
            <TableCell className={`text-right font-semibold tabular-nums ${row.outstanding > 0 ? 'text-destructive' : ''}`}><Money value={row.outstanding} plain /></TableCell>
            <TableCell className="whitespace-nowrap text-xs tabular-nums">{row.lastPurchaseAt ? row.lastPurchaseAt.slice(0, 10) : 'Never'}</TableCell>
            <TableCell><div className="max-w-64 space-y-1">{row.topItems.length ? row.topItems.map((line) => <p key={line.item.id} className="truncate text-xs" title={`${line.item.name}: ${line.qty} ${line.item.uom}, avg ₹${line.avgRate}`}><span className="font-medium">{line.item.code}</span> · {line.qty} {line.item.uom} · ₹{money(line.taxableValue)}</p>) : <span className="text-xs text-muted-foreground">No posted purchases</span>}</div></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>
      </CardContent></Card>
    </div>
  )
}

// ---------- production cost and variance ----------

function ProductionCostTab() {
  const { data, loading } = useApi<ProductionCostVarianceReport>('/api/reports?type=production-cost-variance')
  if (loading) return <TableSkeleton rows={8} cols={8} />
  if (!data) return <EmptyState title="No production cost data" hint="Create projects, approve BOMs and complete production tasks." icon={BarChart3} />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Project Budget</p><p className="mt-1 text-lg font-semibold"><Money value={data.summary.totalBudget} plain /></p><p className="text-xs text-muted-foreground">{data.summary.runningProjects} running</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Expected BOM Cost</p><p className="mt-1 text-lg font-semibold"><Money value={data.summary.expectedCost} plain /></p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Actual Cost So Far</p><p className="mt-1 text-lg font-semibold"><Money value={data.summary.actualCost} plain /></p><p className="text-xs text-muted-foreground">Material ₹{money(data.summary.materialCost)} · Labour ₹{money(data.summary.labourCost)}{data.summary.overheadCost > 0 ? ` · Overhead ₹${money(data.summary.overheadCost)}` : ''}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Projected Margin</p><p className={`mt-1 text-lg font-semibold ${data.summary.projectedMargin >= 0 ? 'text-primary' : 'text-destructive'}`}><Money value={data.summary.projectedMargin} plain /></p><p className={`text-xs ${data.summary.costVariance > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>Cost variance ₹{money(data.summary.costVariance)}</p></Card>
      </div>
      <p className="text-xs text-muted-foreground">{data.note}</p>
      <Card className="p-0"><CardContent className="p-0">
        <div className="max-h-[62dvh] overflow-auto erp-scroll"><Table>
          <TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>Project</TableHead><TableHead className="text-right">Budget</TableHead><TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Material</TableHead><TableHead className="text-right">Labour</TableHead><TableHead className="text-right">Overhead</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Variance</TableHead><TableHead className="text-right">Margin</TableHead><TableHead>Production</TableHead></TableRow></TableHeader>
          <TableBody>{data.rows.map((row) => <TableRow key={row.project.id}>
            <TableCell><span className="block font-medium tabular-nums">{row.project.projectNo}</span><span className="block max-w-44 truncate text-xs">{row.project.name}</span><span className="text-xs text-muted-foreground">{row.project.party.name} · {row.project.status}</span></TableCell>
            <TableCell className="text-right tabular-nums"><Money value={row.budget} plain /></TableCell>
            <TableCell className="text-right tabular-nums"><Money value={row.expectedCost} plain /></TableCell>
            <TableCell className="text-right tabular-nums"><Money value={row.materialCost} plain /></TableCell>
            <TableCell className="text-right tabular-nums"><Money value={row.labourCost} plain /></TableCell>
            <TableCell className="text-right tabular-nums"><Money value={row.overheadCost} plain /></TableCell>
            <TableCell className="text-right font-semibold tabular-nums"><Money value={row.actualCost} plain /></TableCell>
            <TableCell className={`text-right font-semibold tabular-nums ${row.costVariance > 0 ? 'text-destructive' : row.costVariance < 0 ? 'text-primary' : ''}`}><Money value={row.costVariance} plain />{row.variancePct !== null ? <span className="block text-xs">{row.variancePct}%</span> : null}</TableCell>
            <TableCell className={`text-right font-semibold tabular-nums ${row.projectedMargin >= 0 ? 'text-primary' : 'text-destructive'}`}><Money value={row.projectedMargin} plain />{row.projectedMarginPct !== null ? <span className="block text-xs">{row.projectedMarginPct}%</span> : null}</TableCell>
            <TableCell><span className="block text-xs">{row.taskDone}/{row.taskTotal} tasks · {row.productionHours} h</span><span className={`text-xs ${row.rejectionPct > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>Rejection {row.rejectionQty} ({row.rejectionPct}%)</span><span className="block text-xs text-muted-foreground">{row.workOrders.length} work order(s)</span></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>
      </CardContent></Card>
    </div>
  )
}

// ---------- production efficiency ----------

function ProductionEfficiencyTab() {
  const { data, loading } = useApi<ProductionEfficiencyReport>('/api/reports?type=production-efficiency')
  if (loading) return <TableSkeleton rows={8} cols={8} />
  if (!data) return <EmptyState title="No production efficiency data" hint="Create and complete production tasks to build operation metrics." icon={BarChart3} />

  const metricTable = <T extends ProductionEfficiencyMetric>(title: string, rows: T[], label: (row: T) => ReactNode) => (
    <Card className="p-0"><CardHeader className="border-b py-3"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent className="p-0">
      {rows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No recorded data.</p> : <div className="overflow-auto"><Table>
        <TableHeader><TableRow><TableHead>{title.replace(' Performance', '')}</TableHead><TableHead className="text-right">Tasks</TableHead><TableHead className="text-right">Planned</TableHead><TableHead className="text-right">Good Output</TableHead><TableHead className="text-right">Rejected</TableHead><TableHead className="text-right">Yield</TableHead><TableHead className="text-right">Attainment</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Output/Hr</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map((row, index) => <TableRow key={index}><TableCell className="font-medium">{label(row)}</TableCell><TableCell className="text-right tabular-nums">{row.taskDone}/{row.taskTotal}</TableCell><TableCell className="text-right tabular-nums">{row.plannedQty}</TableCell><TableCell className="text-right tabular-nums">{row.actualQty}</TableCell><TableCell className={`text-right tabular-nums ${row.rejectionQty > 0 ? 'text-destructive' : ''}`}>{row.rejectionQty}</TableCell><TableCell className={`text-right font-medium tabular-nums ${row.yieldPct < 95 ? 'text-destructive' : 'text-primary'}`}>{row.yieldPct}%</TableCell><TableCell className="text-right tabular-nums">{row.attainmentPct}%</TableCell><TableCell className="text-right tabular-nums">{row.hours}</TableCell><TableCell className="text-right tabular-nums">{row.outputPerHour}</TableCell><TableCell className="text-right tabular-nums"><Money value={row.totalCost} plain /></TableCell></TableRow>)}</TableBody>
      </Table></div>}
    </CardContent></Card>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Tasks Completed</p><p className="mt-1 text-lg font-semibold">{data.summary.taskDone}/{data.summary.taskTotal}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Good Output / Rejected</p><p className="mt-1 text-lg font-semibold">{data.summary.actualQty} / <span className="text-destructive">{data.summary.rejectionQty}</span></p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Overall Yield</p><p className={`mt-1 text-lg font-semibold ${data.summary.yieldPct < 95 ? 'text-destructive' : 'text-primary'}`}>{data.summary.yieldPct}%</p><p className="text-xs text-muted-foreground">Attainment {data.summary.attainmentPct}%</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Production Hours / Cost</p><p className="mt-1 text-lg font-semibold">{data.summary.hours} h</p><p className="text-xs text-muted-foreground">₹{money(data.summary.totalCost)} · {data.summary.outputPerHour}/h</p></Card>
      </div>
      <Card className="border-amber-500/30 bg-amber-500/5 p-4"><p className="text-sm font-medium">Efficiency, not OEE</p><p className="mt-1 text-xs text-muted-foreground">{data.note}</p></Card>
      {metricTable('Operation Performance', data.operations, (row) => row.operation.replaceAll('_', ' '))}
      {metricTable('Machine Performance', data.machines, (row) => row.machineNo)}
      {metricTable('Operator Performance', data.operators, (row) => <><span className="block">{row.employee.name}</span><span className="text-xs text-muted-foreground">{row.employee.code}</span></>)}
    </div>
  )
}

// ---------- inventory planning ----------

function InventoryPlanningTab() {
  const { data, loading } = useApi<InventoryPlanningReport>('/api/reports?type=inventory-planning')
  if (loading) return <TableSkeleton rows={8} cols={7} />
  if (!data) return <EmptyState title="No inventory data" hint="Post opening stock or purchase receipts to build the plan." icon={PackageSearch} />

  const ageingTone = (value: string) => {
    if (value === 'ACTIVE') return 'default' as const
    if (value === 'SLOW') return 'secondary' as const
    return 'destructive' as const
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Stock Value</p><p className="mt-1 text-lg font-semibold"><Money value={data.summary.stockValue} plain /></p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Reorder Required</p><p className="mt-1 text-lg font-semibold text-destructive">{data.summary.reorderItems}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Slow Moving</p><p className="mt-1 text-lg font-semibold">{data.summary.slowItems}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Dead / No Movement</p><p className="mt-1 text-lg font-semibold">{data.summary.deadItems}</p></Card>
      </div>
      <p className="text-xs text-muted-foreground">
        Reorder suggestion = reorder level − current company-owned stock. Customer Jobwork material is excluded. Ageing: active ≤90 days, slow 91–180, dead &gt;180.
      </p>
      <Card className="p-0">
        <CardContent className="p-0">
          <div className="max-h-[62dvh] overflow-auto erp-scroll">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Reorder Level</TableHead>
                  <TableHead className="text-right">Suggested Order</TableHead>
                  <TableHead>Ageing</TableHead>
                  <TableHead>Last Movement</TableHead>
                  <TableHead className="text-right">Stock Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow key={row.item.id}>
                    <TableCell><span className="block font-medium">{row.item.name}</span><span className="text-xs text-muted-foreground">{row.item.code} · {row.item.uom}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{row.closing}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.item.reorderLevel || '—'}</TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${row.suggestedOrderQty > 0 ? 'text-destructive' : ''}`}>{row.suggestedOrderQty || '—'}</TableCell>
                    <TableCell><Badge variant={ageingTone(row.ageingClass)}>{row.ageingClass.replace('_', ' ')}</Badge><span className="ml-2 text-xs text-muted-foreground">{row.inactiveDays === null ? '' : `${row.inactiveDays}d`}</span></TableCell>
                    <TableCell><span className="block text-xs">{row.lastMovementAt ? row.lastMovementAt.slice(0, 10) : 'Never'}</span><span className="text-xs text-muted-foreground">{row.lastVoucherNo ? `${row.lastVoucherType} · ${row.lastVoucherNo}` : 'No own-stock movement'}</span></TableCell>
                    <TableCell className="text-right tabular-nums"><Money value={row.closingValue} plain /></TableCell>
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

// ---------- P&L ----------

function PnlTab() {
  const now = new Date()
  const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const last = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const [from, setFrom] = useState(first)
  const [to, setTo] = useState(last)
  const [applied, setApplied] = useState<{ from: string; to: string }>({ from: first, to: last })
  const { data, loading } = useApi<Pnl>(
    `/api/reports?type=pnl&from=${applied.from}&to=${applied.to}`
  )

  const row = (label: string, value: number, opts?: { bold?: boolean; tone?: 'pos' | 'neg'; indent?: boolean }) => (
    <div
      className={`flex items-center justify-between border-b py-2 text-sm ${opts?.indent ? 'pl-4' : ''}`}
    >
      <span className={opts?.bold ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
      <span
        className={`tabular-nums ${opts?.bold ? 'font-bold' : ''} ${
          opts?.tone === 'pos' ? 'text-primary' : opts?.tone === 'neg' ? 'text-destructive' : ''
        }`}
      >
        ₹ {money(value)}
      </span>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11" />
        </div>
        <Button onClick={() => setApplied({ from, to })} className="h-11">Run statement</Button>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={2} />
      ) : !data ? (
        <EmptyState title="No data" hint="Pick a period and run." icon={FileSpreadsheet} />
      ) : (
        <Card className="mx-auto w-full max-w-xl p-6">
          <div className="mb-2 text-center">
            <p className="text-sm font-semibold uppercase tracking-wider">Profit &amp; Loss Statement</p>
            <p className="text-xs text-muted-foreground">
              {data.from} → {data.to} · accrual basis (posted vouchers)
            </p>
          </div>
          <div className="mt-4">
            <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Revenue</p>
            {row('Sales', data.sales, { indent: true })}
            {row('Jobwork income', data.jobworkIncome, { indent: true })}
            {row('Total revenue', data.revenue, { bold: true })}
            <p className="pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Costs
            </p>
            {row('Purchases', data.purchases, { indent: true })}
            {row('Gross profit', data.grossProfit, { bold: true, tone: data.grossProfit >= 0 ? 'pos' : 'neg' })}
            {row('Round-off income', data.roundOff, { indent: true })}
            <div className="mt-2 rounded-md border bg-muted/30 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold">Net profit</span>
                <span className={`text-base font-bold tabular-nums ${data.netProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                  ₹ {money(data.netProfit)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Revenue (SALS + JWIN) − purchases (PURC) + round-off — derived from the account ledger.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
