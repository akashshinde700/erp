'use client'

/**
 * ForgeERP — Reports view.
 * GSTR-1 (B2B/B2C rate-wise), Trial Balance (with ΣDr = ΣCr integrity
 * banner), Outstanding, and P&L statement.
 */

import { useState } from 'react'
import { BarChart3, CheckCircle2, FileSpreadsheet, PackageSearch, Scale, TrendingDown, TrendingUp, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  currentMonth,
  useApi,
  type CashBankBook,
  type CustomerPerformanceReport,
  type Gstr1Report,
  type InventoryPlanningReport,
  type Outstanding,
  type Pnl,
  type SupplierPerformanceReport,
  type TrialBalance,
} from './api'
import { EmptyState, Money, SectionHeading, TableSkeleton } from './bits'
import { money } from '@/lib/erp'

export function ReportsView() {
  return (
    <div className="space-y-4">
      <SectionHeading
        title="Reports"
        description="GST, financial and integrity reports — all derived from the append-only ledgers."
      />
      <Tabs defaultValue="gstr1">
        <TabsList className="h-11 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="gstr1" className="h-11 sm:h-9">GSTR-1</TabsTrigger>
          <TabsTrigger value="trial" className="h-11 sm:h-9">Trial Balance</TabsTrigger>
          <TabsTrigger value="outstanding" className="h-11 sm:h-9">Outstanding</TabsTrigger>
          <TabsTrigger value="cashbook" className="h-11 sm:h-9">Cash &amp; Bank</TabsTrigger>
          <TabsTrigger value="customers" className="h-11 sm:h-9">Customers</TabsTrigger>
          <TabsTrigger value="suppliers" className="h-11 sm:h-9">Suppliers</TabsTrigger>
          <TabsTrigger value="inventory" className="h-11 sm:h-9">Inventory Planning</TabsTrigger>
          <TabsTrigger value="pnl" className="h-11 sm:h-9">P&amp;L</TabsTrigger>
        </TabsList>
        <TabsContent value="gstr1" className="mt-4">
          <Gstr1Tab />
        </TabsContent>
        <TabsContent value="trial" className="mt-4">
          <TrialBalanceTab />
        </TabsContent>
        <TabsContent value="outstanding" className="mt-4">
          <OutstandingTab />
        </TabsContent>
        <TabsContent value="cashbook" className="mt-4">
          <CashBankBookTab />
        </TabsContent>
        <TabsContent value="customers" className="mt-4">
          <CustomerPerformanceTab />
        </TabsContent>
        <TabsContent value="suppliers" className="mt-4">
          <SupplierPerformanceTab />
        </TabsContent>
        <TabsContent value="inventory" className="mt-4">
          <InventoryPlanningTab />
        </TabsContent>
        <TabsContent value="pnl" className="mt-4">
          <PnlTab />
        </TabsContent>
      </Tabs>
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
