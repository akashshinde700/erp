'use client'

/**
 * Reports: back orders, aging by due date, sales analysis, purchase by
 * supplier, P&L by ledger, project profitability. Every table exports to CSV.
 */
import { useState } from 'react'
import { Download } from 'lucide-react'
import { downloadCsv, useApi } from './api'
import { EmptyState, Money, TableSkeleton } from './bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateStr, money, qty as qtyFmt } from '@/lib/erp'
import { BarChart3 } from 'lucide-react'

const fyStart = () => { const d = new Date(); const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-04-01` }
const todayIso = () => new Date().toISOString().slice(0, 10)

function Range({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return <div className="flex flex-wrap items-end gap-2">
    <div className="space-y-1.5"><Label htmlFor="rx-from">From</Label><Input id="rx-from" type="date" className="h-11" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
    <div className="space-y-1.5"><Label htmlFor="rx-to">To</Label><Input id="rx-to" type="date" className="h-11" value={to} onChange={(e) => setTo(e.target.value)} /></div>
  </div>
}
const Csv = ({ name, rows }: { name: string; rows: (string | number)[][] }) => <Button variant="outline" className="h-11 gap-2" onClick={() => downloadCsv(name, rows)}><Download className="size-4" aria-hidden />CSV</Button>

// ---------------------------------------------------------------- back orders

type BackOrders = { rows: { orderNo: string; orderId: string; date: string; deliveryDate: string | null; customer: string; item: string; itemName: string; uom: string; ordered: number; dispatched: number; pending: number; pendingValue: number; onHand: number; late: boolean }[]; totalPendingValue: number; lateLines: number }

export function BackOrdersTab() {
  const { data, loading } = useApi<BackOrders>('/api/reports?type=back-orders')
  if (loading) return <TableSkeleton rows={6} cols={6} />
  if (!data?.rows.length) return <EmptyState icon={BarChart3} title="No back orders" hint="Every approved sales order line is fully dispatched." />
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3"><p className="text-sm">Pending dispatch <strong>₹ {money(data.totalPendingValue)}</strong>{data.lateLines ? <span className="ml-2 text-destructive">· {data.lateLines} line(s) past delivery date</span> : null}</p>
      <Csv name="back-orders.csv" rows={[['Order', 'Date', 'Delivery', 'Customer', 'Item', 'Ordered', 'Dispatched', 'Pending', 'Pending value', 'On hand'], ...data.rows.map((r) => [r.orderNo, r.date.slice(0, 10), r.deliveryDate?.slice(0, 10) ?? '', r.customer, r.item, r.ordered, r.dispatched, r.pending, r.pendingValue, r.onHand])]} /></div>
    <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Pending</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader><TableBody>
      {data.rows.map((r, i) => <TableRow key={`${r.orderId}-${i}`}><TableCell className="font-medium">{r.orderNo}<p className="text-xs text-muted-foreground">{r.customer}{r.deliveryDate ? ` · due ${dateStr(r.deliveryDate)}` : ''}{r.late ? <Badge variant="destructive" className="ml-1">late</Badge> : null}</p></TableCell>
        <TableCell>{r.item}<p className="text-xs text-muted-foreground">{r.itemName}</p></TableCell><TableCell className="text-right">{qtyFmt(r.ordered)}</TableCell><TableCell className="text-right font-medium">{qtyFmt(r.pending)} {r.uom}</TableCell>
        <TableCell className={`text-right ${r.onHand + 1e-9 < r.pending ? 'text-destructive' : ''}`}>{qtyFmt(r.onHand)}</TableCell><TableCell className="text-right"><Money value={r.pendingValue} /></TableCell></TableRow>)}
    </TableBody></Table></div></CardContent></Card>
  </div>
}

// ---------------------------------------------------------------- aging

type Aging = { kind: string; asOf: string; buckets: { key: string; label: string }[]; parties: ({ partyId: string; party: string; code: string; total: number } & Record<string, number>)[]; totals: Record<string, number>; total: number; overdue: number; overduePct: number }

export function AgingTab() {
  const [kind, setKind] = useState<'sales' | 'purchase'>('sales')
  const { data, loading } = useApi<Aging>(`/api/reports?type=aging&kind=${kind}`)
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2"><Button variant={kind === 'sales' ? 'default' : 'outline'} className="h-11" onClick={() => setKind('sales')}>Receivables</Button><Button variant={kind === 'purchase' ? 'default' : 'outline'} className="h-11" onClick={() => setKind('purchase')}>Payables</Button>
      {data ? <Csv name={`${kind}-aging.csv`} rows={[['Party', 'Code', ...data.buckets.map((b) => b.label), 'Total'], ...data.parties.map((p) => [p.party, p.code, ...data.buckets.map((b) => p[b.key] ?? 0), p.total])]} /> : null}</div>
    <p className="text-sm text-muted-foreground">Due date = invoice date + the party&apos;s credit days (set in Masters → Parties).</p>
    {loading ? <TableSkeleton rows={6} cols={7} /> : !data?.parties.length ? <EmptyState icon={BarChart3} title="Nothing outstanding" hint={kind === 'sales' ? 'Every posted sales invoice is fully received.' : 'Every posted purchase invoice is fully paid.'} /> : <>
      <p className="text-sm">Open <strong>₹ {money(data.total)}</strong> · past due <strong className={data.overdue > 0 ? 'text-destructive' : ''}>₹ {money(data.overdue)} ({data.overduePct}%)</strong></p>
      <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Party</TableHead>{data.buckets.map((b) => <TableHead key={b.key} className="text-right">{b.label}</TableHead>)}<TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>
        {data.parties.map((p) => <TableRow key={p.partyId}><TableCell className="font-medium">{p.party}<p className="text-xs text-muted-foreground">{p.code}</p></TableCell>{data.buckets.map((b) => <TableCell key={b.key} className={`text-right ${b.key !== 'notDue' && p[b.key] > 0 ? 'text-destructive' : ''}`}>{p[b.key] ? money(p[b.key]) : '—'}</TableCell>)}<TableCell className="text-right font-medium"><Money value={p.total} /></TableCell></TableRow>)}
      </TableBody><TableFooter><TableRow><TableCell>Total</TableCell>{data.buckets.map((b) => <TableCell key={b.key} className="text-right">{money(data.totals[b.key] ?? 0)}</TableCell>)}<TableCell className="text-right">{money(data.total)}</TableCell></TableRow></TableFooter></Table></div></CardContent></Card>
    </>}
  </div>
}

// ---------------------------------------------------------------- sales analysis

type Bucket = { key: string; label: string; taxable: number; total: number; count: number; qty?: number }
type SalesAnalysis = { from: string; to: string; invoices: number; taxable: number; total: number; byCustomer: Bucket[]; byProduct: Bucket[]; bySalesperson: Bucket[] }

function BucketTable({ title, rows, qty }: { title: string; rows: Bucket[]; qty?: boolean }) {
  return <Card className="p-0"><CardHeader className="pb-0 pt-4"><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{title.replace('By ', '')}</TableHead>{qty ? <TableHead className="text-right">Qty</TableHead> : <TableHead className="text-right">Invoices</TableHead>}<TableHead className="text-right">Taxable</TableHead><TableHead className="text-right">With GST</TableHead></TableRow></TableHeader><TableBody>
    {rows.slice(0, 50).map((r) => <TableRow key={r.key}><TableCell>{r.label}</TableCell><TableCell className="text-right">{qty ? qtyFmt(r.qty ?? 0) : r.count}</TableCell><TableCell className="text-right"><Money value={r.taxable} /></TableCell><TableCell className="text-right"><Money value={r.total} /></TableCell></TableRow>)}
  </TableBody></Table></div></CardContent></Card>
}

export function SalesAnalysisTab() {
  const [from, setFrom] = useState(fyStart()); const [to, setTo] = useState(todayIso())
  const { data, loading, error } = useApi<SalesAnalysis>(`/api/reports?type=sales-analysis&from=${from}&to=${to}`)
  return <div className="space-y-3">
    <div className="flex flex-wrap items-end gap-2"><Range from={from} to={to} setFrom={setFrom} setTo={setTo} />{data ? <Csv name="sales-by-product.csv" rows={[['Product', 'Qty', 'Taxable', 'Total'], ...data.byProduct.map((r) => [r.label, r.qty ?? 0, r.taxable, r.total])]} /> : null}</div>
    {error ? <p className="text-sm text-destructive">{error}</p> : null}
    {loading ? <TableSkeleton rows={6} cols={4} /> : !data?.invoices ? <EmptyState icon={BarChart3} title="No sales in this period" hint="Pick a wider date range." /> : <>
      <p className="text-sm">{data.invoices} invoice(s) · taxable <strong>₹ {money(data.taxable)}</strong> · with GST ₹ {money(data.total)}</p>
      <div className="grid gap-4 lg:grid-cols-2"><BucketTable title="By customer" rows={data.byCustomer} /><BucketTable title="By salesperson" rows={data.bySalesperson} /></div>
      <BucketTable title="By product" rows={data.byProduct} qty />
    </>}
  </div>
}

// ---------------------------------------------------------------- purchase by supplier

type PurchaseBySupplier = { rows: { supplierId: string; supplier: string; orders: number; ordered: number; orderedQty: number; receivedQty: number; acceptedQty: number; rejectedQty: number; billed: number; fillRatePct: number; rejectionPct: number }[] }

export function PurchaseBySupplierTab() {
  const [from, setFrom] = useState(fyStart()); const [to, setTo] = useState(todayIso())
  const { data, loading } = useApi<PurchaseBySupplier>(`/api/reports?type=purchase-by-supplier&from=${from}&to=${to}`)
  return <div className="space-y-3">
    <div className="flex flex-wrap items-end gap-2"><Range from={from} to={to} setFrom={setFrom} setTo={setTo} />{data ? <Csv name="purchase-by-supplier.csv" rows={[['Supplier', 'POs', 'PO value', 'Ordered qty', 'Received', 'Accepted', 'Rejected', 'Billed', 'Fill %', 'Rejection %'], ...data.rows.map((r) => [r.supplier, r.orders, r.ordered, r.orderedQty, r.receivedQty, r.acceptedQty, r.rejectedQty, r.billed, r.fillRatePct, r.rejectionPct])]} /> : null}</div>
    {loading ? <TableSkeleton rows={6} cols={6} /> : !data?.rows.length ? <EmptyState icon={BarChart3} title="No purchase orders in this period" hint="Approved purchase orders appear here." /> :
      <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead className="text-right">PO value</TableHead><TableHead className="text-right">Received / ordered</TableHead><TableHead className="text-right">Rejected</TableHead><TableHead className="text-right">Billed</TableHead></TableRow></TableHeader><TableBody>
        {data.rows.map((r) => <TableRow key={r.supplierId}><TableCell className="font-medium">{r.supplier}<p className="text-xs text-muted-foreground">{r.orders} PO(s)</p></TableCell><TableCell className="text-right"><Money value={r.ordered} /></TableCell><TableCell className="text-right">{qtyFmt(r.receivedQty)} / {qtyFmt(r.orderedQty)}<p className="text-xs text-muted-foreground">{r.fillRatePct}% filled</p></TableCell><TableCell className={`text-right ${r.rejectionPct > 2 ? 'text-destructive' : ''}`}>{qtyFmt(r.rejectedQty)}<p className="text-xs">{r.rejectionPct}%</p></TableCell><TableCell className="text-right"><Money value={r.billed} /></TableCell></TableRow>)}
      </TableBody></Table></div></CardContent></Card>}
  </div>
}

// ---------------------------------------------------------------- P&L by ledger

type PnlLedger = { income: { account: string; name: string; amount: number }[]; expenses: { account: string; name: string; amount: number }[]; totalIncome: number; totalExpenses: number; netProfit: number }

export function PnlLedgerTab() {
  const [from, setFrom] = useState(fyStart()); const [to, setTo] = useState(todayIso())
  const { data, loading } = useApi<PnlLedger>(`/api/reports?type=pnl-ledger&from=${from}&to=${to}`)
  const side = (title: string, rows: { account: string; name: string; amount: number }[], total: number) => <Card className="p-0"><CardHeader className="pb-0 pt-4"><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableBody>
    {rows.map((r) => <TableRow key={r.account}><TableCell className="whitespace-normal break-words">{r.name}<span className="ml-1 text-xs text-muted-foreground">{r.account}</span></TableCell><TableCell className="text-right"><Money value={r.amount} /></TableCell></TableRow>)}
  </TableBody><TableFooter><TableRow><TableCell>Total</TableCell><TableCell className="text-right">₹ {money(total)}</TableCell></TableRow></TableFooter></Table></div></CardContent></Card>
  return <div className="space-y-3">
    <div className="flex flex-wrap items-end gap-2"><Range from={from} to={to} setFrom={setFrom} setTo={setTo} />{data ? <Csv name="pnl-by-ledger.csv" rows={[['Side', 'Ledger', 'Code', 'Amount'], ...data.income.map((r) => ['Income', r.name, r.account, r.amount]), ...data.expenses.map((r) => ['Expense', r.name, r.account, r.amount]), ['', 'Net profit', '', data.netProfit]]} /> : null}</div>
    <p className="text-sm text-muted-foreground">Includes your own income / expense ledgers posted through journals, stock adjustments and manufacturing variance.</p>
    {loading || !data ? <TableSkeleton rows={6} cols={2} /> : <>
      <div className="grid gap-4 lg:grid-cols-2">{side('Income', data.income, data.totalIncome)}{side('Expenses', data.expenses, data.totalExpenses)}</div>
      <p className={`text-lg font-semibold ${data.netProfit < 0 ? 'text-destructive' : ''}`}>{data.netProfit < 0 ? 'Net loss' : 'Net profit'} ₹ {money(Math.abs(data.netProfit))}</p>
    </>}
  </div>
}

// ---------------------------------------------------------------- project profitability

type ProjectRow = { id: string; projectNo: string; name: string; customer: string; status: string; contractValue: number; estCost: number; material: number; labour: number; hours: number; actualCost: number; costVariance: number; costUsedPct: number | null; expectedMargin: number; marginToDate: number; workOrders: number }

export function ProjectProfitabilityTab() {
  const { data, loading } = useApi<ProjectRow[]>('/api/reports?type=project-profitability')
  if (loading) return <TableSkeleton rows={5} cols={6} />
  if (!data?.length) return <EmptyState icon={BarChart3} title="No projects" hint="Create a project under Own Projects & Mfg to track budget against actual cost." />
  return <div className="space-y-3">
    <Csv name="project-profitability.csv" rows={[['Project', 'Name', 'Customer', 'Status', 'Contract', 'Est. cost', 'Material', 'Labour', 'Hours', 'Actual', 'Variance', 'Margin to date'], ...data.map((r) => [r.projectNo, r.name, r.customer, r.status, r.contractValue, r.estCost, r.material, r.labour, r.hours, r.actualCost, r.costVariance, r.marginToDate])]} />
    <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Project</TableHead><TableHead className="text-right">Contract</TableHead><TableHead className="text-right">Estimated cost</TableHead><TableHead className="text-right">Actual cost</TableHead><TableHead className="text-right">Margin to date</TableHead></TableRow></TableHeader><TableBody>
      {data.map((r) => <TableRow key={r.id}><TableCell className="font-medium">{r.projectNo} {r.name}<p className="text-xs text-muted-foreground">{r.customer} · {r.status.toLowerCase()} · {r.workOrders} WO</p></TableCell><TableCell className="text-right"><Money value={r.contractValue} /></TableCell><TableCell className="text-right"><Money value={r.estCost} /></TableCell>
        <TableCell className="text-right"><Money value={r.actualCost} /><p className={`text-xs ${r.costVariance > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{r.costUsedPct === null ? 'no estimate' : `${r.costUsedPct}% of estimate`} · material ₹ {money(r.material)}, labour ₹ {money(r.labour)} ({r.hours} h)</p></TableCell>
        <TableCell className={`text-right font-medium ${r.marginToDate < 0 ? 'text-destructive' : ''}`}><Money value={r.marginToDate} /></TableCell></TableRow>)}
    </TableBody></Table></div></CardContent></Card>
  </div>
}
