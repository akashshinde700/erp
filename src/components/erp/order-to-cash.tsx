'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { FileCheck2, PackageCheck, RefreshCw, ScrollText } from 'lucide-react'
import { apiPost, toastError, useApi } from './api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, Money, SectionHeading, TableSkeleton } from './bits'
import { dateStr } from '@/lib/erp'

type Item = { id: string; code: string; name: string; uom: string }
type Quote = { id: string; quotationNo: string; revisionNo: number; date: string; validUntil: string; status: string; grandTotal: number; party: { name: string }; lines: { id: string; qty: number; item: Item }[] }
type Order = { id: string; orderNo: string; date: string; deliveryDate: string | null; customerPoNo: string | null; status: string; grandTotal: number; creditApproved: boolean; party: { name: string; creditLimit?: number }; lines: { id: string; qty: number; dispatchedQty: number; invoicedQty: number; item: Item }[] }
type Challan = { id: string; challanNo: string; date: string; status: string; vehicleNo: string | null; transporter: string | null; salesOrder: { orderNo: string }; lines: { id: string; plannedQty: number; acceptedQty: number; rejectedQty: number; invoicedQty: number; qcStatus: string; item: Item }[] }
type Data = { quotations: Quote[]; orders: Order[]; challans: Challan[] }

const tone = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => status === 'CANCELLED' || status === 'REJECTED' || status === 'EXPIRED' ? 'destructive' : ['APPROVED', 'ACCEPTED', 'DISPATCHED', 'INVOICED', 'CLOSED'].includes(status) ? 'default' : 'secondary'

export function OrderToCashWorkspace() {
  const report = useApi<Data>('/api/order-to-cash')
  const [busy, setBusy] = useState('')
  const run = async (key: string, body: Record<string, unknown>, message: string) => {
    setBusy(key)
    try { await apiPost('/api/order-to-cash', body); toast.success(message); await report.reload() }
    catch (error) { toastError(error) } finally { setBusy('') }
  }
  const data = report.data
  return <div className="space-y-5">
    <SectionHeading title="Quote to Cash" subtitle="Quotation revisions, sales orders, dispatch QC and challan invoicing" action={<Button variant="outline" className="h-11 gap-2" onClick={() => void report.reload()}><RefreshCw className="size-4" />Refresh</Button>} />
    <Tabs defaultValue="quotations" className="space-y-4">
      <TabsList className="h-auto flex-wrap justify-start"><TabsTrigger value="quotations">Quotations</TabsTrigger><TabsTrigger value="orders">Sales Orders</TabsTrigger><TabsTrigger value="dispatch">Delivery & QC</TabsTrigger></TabsList>
      <TabsContent value="quotations">
        {report.loading ? <TableSkeleton rows={6} cols={7} /> : !data?.quotations.length ? <EmptyState icon={ScrollText} title="No quotations" hint="Create quotations through the controlled order-to-cash API." /> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Quotation</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead><TableHead>Valid Until</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Next action</TableHead></TableRow></TableHeader><TableBody>{data.quotations.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.quotationNo}<p className="text-xs text-muted-foreground">Revision {row.revisionNo} · {row.lines.length} line(s)</p></TableCell><TableCell>{row.party.name}</TableCell><TableCell>{dateStr(row.date)}</TableCell><TableCell>{dateStr(row.validUntil)}</TableCell><TableCell className="text-right"><Money value={row.grandTotal} plain /></TableCell><TableCell><Badge variant={tone(row.status)}>{row.status}</Badge></TableCell><TableCell className="text-right">{row.status === 'DRAFT' ? <Button size="sm" disabled={busy === row.id} onClick={() => void run(row.id, { action: 'transition-quotation', id: row.id, transition: 'SUBMIT' }, `${row.quotationNo} submitted`)}>Submit</Button> : row.status === 'SUBMITTED' ? <Button size="sm" disabled={busy === row.id} onClick={() => void run(row.id, { action: 'transition-quotation', id: row.id, transition: 'APPROVE' }, `${row.quotationNo} approved`)}>Approve</Button> : row.status === 'APPROVED' ? <Button size="sm" disabled={busy === row.id} onClick={() => void run(row.id, { action: 'quotation-to-order', id: row.id }, 'Sales order created')}>Create SO</Button> : null}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
      </TabsContent>
      <TabsContent value="orders">
        {report.loading ? <TableSkeleton rows={6} cols={8} /> : !data?.orders.length ? <EmptyState icon={FileCheck2} title="No sales orders" hint="Approved quotations can be converted to controlled sales orders." /> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Customer PO</TableHead><TableHead>Ordered</TableHead><TableHead>Dispatched</TableHead><TableHead>Invoiced</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{data.orders.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.orderNo}<p className="text-xs text-muted-foreground">{dateStr(row.date)} · ₹{row.grandTotal.toFixed(2)}</p></TableCell><TableCell>{row.party.name}</TableCell><TableCell>{row.customerPoNo || '—'}</TableCell><TableCell>{row.lines.reduce((s, x) => s + x.qty, 0)}</TableCell><TableCell>{row.lines.reduce((s, x) => s + x.dispatchedQty, 0)}</TableCell><TableCell>{row.lines.reduce((s, x) => s + x.invoicedQty, 0)}</TableCell><TableCell><Badge variant={tone(row.status)}>{row.status}</Badge></TableCell><TableCell className="text-right">{row.status === 'DRAFT' ? <Button size="sm" disabled={busy === row.id} onClick={() => void run(row.id, { action: 'approve-order', id: row.id }, `${row.orderNo} approved`)}>Approve</Button> : null}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
      </TabsContent>
      <TabsContent value="dispatch">
        {report.loading ? <TableSkeleton rows={6} cols={8} /> : !data?.challans.length ? <EmptyState icon={PackageCheck} title="No delivery challans" hint="Create a partial delivery challan against an approved sales order." /> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Challan</TableHead><TableHead>Sales Order</TableHead><TableHead>Transport</TableHead><TableHead>Planned</TableHead><TableHead>QC Accepted</TableHead><TableHead>Rejected</TableHead><TableHead>Invoiced</TableHead><TableHead className="text-right">Status / Action</TableHead></TableRow></TableHeader><TableBody>{data.challans.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.challanNo}<p className="text-xs text-muted-foreground">{dateStr(row.date)}</p></TableCell><TableCell>{row.salesOrder.orderNo}</TableCell><TableCell>{row.vehicleNo || row.transporter || '—'}</TableCell><TableCell>{row.lines.reduce((s, x) => s + x.plannedQty, 0)}</TableCell><TableCell>{row.lines.reduce((s, x) => s + x.acceptedQty, 0)}</TableCell><TableCell>{row.lines.reduce((s, x) => s + x.rejectedQty, 0)}</TableCell><TableCell>{row.lines.reduce((s, x) => s + x.invoicedQty, 0)}</TableCell><TableCell className="text-right"><Badge variant={tone(row.status)}>{row.status}</Badge>{['DISPATCHED', 'READY'].includes(row.status) && row.lines.every((line) => line.invoicedQty <= 0) ? <Button size="sm" variant="destructive" className="ml-2" disabled={busy === row.id} onClick={() => void run(row.id, { action: 'cancel-challan', id: row.id }, `${row.challanNo} cancelled`)}>Cancel</Button> : null}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
      </TabsContent>
    </Tabs>
  </div>
}
