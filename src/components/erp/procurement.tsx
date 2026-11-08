'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, ClipboardCheck, FileWarning, PackageCheck, RefreshCw, ShoppingCart } from 'lucide-react'
import { apiPost, toastError, useApi } from './api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, Money, SectionHeading, TableSkeleton } from './bits'
import { dateStr } from '@/lib/erp'
import { RfqWorkspace } from './rfq-workspace'

type Item = { id: string; code: string; name: string; uom: string }
type ReqLine = { id: string; qty: number; orderedQty: number; estimatedRate: number; item: Item }
type Requisition = { id: string; reqNo: string; date: string; requiredBy: string | null; department: string | null; purpose: string | null; status: string; lines: ReqLine[] }
type PoLine = { id: string; qty: number; receivedQty: number; acceptedQty: number; rejectedQty: number; billedQty: number; rate: number; item: Item }
type PurchaseOrder = { id: string; poNo: string; date: string; expectedDate: string | null; status: string; grandTotal: number; supplier: { name: string }; lines: PoLine[] }
type GrnLine = { id: string; receivedQty: number; acceptedQty: number; rejectedQty: number; billedQty: number; qcStatus: string; batchNo: string | null; item: Item }
type Receipt = { id: string; grnNo: string; date: string; status: string; supplierDocNo: string | null; purchaseOrder: { poNo: string }; lines: GrnLine[] }
type MatchException = { grnNo: string; itemCode: string; acceptedQty: number; billedQty: number; quantityVariance: number; rateVariance: number[]; invoices: string[] }
type ProcurementData = { requisitions: Requisition[]; orders: PurchaseOrder[]; receipts: Receipt[]; matchExceptions: MatchException[] }

type ReturnDoc = { id: string; returnNo: string; date: string; returnType: string; sourceInvoiceNo: string; status: string; adjustmentNo: string | null; grandTotal: number; qcStatus: string; party: { name: string }; lines: { id: string; acceptedQty: number; rejectedQty: number; item: Item }[] }

const tone = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => status === 'CANCELLED' || status === 'REJECTED' || status === 'FAILED' ? 'destructive' : status === 'APPROVED' || status === 'ACCEPTED' || status === 'POSTED' || status === 'PASSED' ? 'default' : 'secondary'

export function ProcurementWorkspace() {
  const procurement = useApi<ProcurementData>('/api/procurement')
  const returns = useApi<ReturnDoc[]>('/api/returns')
  const [busy, setBusy] = useState('')

  const run = async (key: string, body: Record<string, unknown>, success: string) => {
    setBusy(key)
    try {
      await apiPost('/api/procurement', body)
      toast.success(success)
      await procurement.reload()
    } catch (error) { toastError(error) } finally { setBusy('') }
  }

  const cancelReturn = async (id: string) => {
    setBusy(id)
    try {
      await apiPost('/api/returns', { action: 'cancel', id })
      toast.success('Return and adjustment note cancelled with ledger reversals')
      await returns.reload()
    } catch (error) { toastError(error) } finally { setBusy('') }
  }

  const data = procurement.data
  return <div className="space-y-5">
    <SectionHeading title="Controlled Procurement & Returns" description="Approval, PO, GRN, QC, three-way matching and commercial returns" actions={<Button variant="outline" className="h-11 gap-2" onClick={() => { void procurement.reload(); void returns.reload() }}><RefreshCw className="size-4" />Refresh</Button>} />
    <Tabs defaultValue="requisitions" className="space-y-4">
      <TabsList className="h-auto flex-wrap justify-start">
        <TabsTrigger value="requisitions" className="h-11 sm:h-9">Requisitions</TabsTrigger><TabsTrigger value="rfq" className="h-11 sm:h-9">RFQ &amp; Comparison</TabsTrigger><TabsTrigger value="orders" className="h-11 sm:h-9">Purchase Orders</TabsTrigger><TabsTrigger value="receipts" className="h-11 sm:h-9">GRN & QC</TabsTrigger><TabsTrigger value="matching" className="h-11 sm:h-9">Three-way Match</TabsTrigger><TabsTrigger value="returns" className="h-11 sm:h-9">Returns & Notes</TabsTrigger>
      </TabsList>
      <TabsContent value="requisitions">
        {procurement.loading ? <TableSkeleton rows={6} cols={6} /> : !data?.requisitions.length ? <EmptyState icon={ClipboardCheck} title="No material requisitions" hint="Create requisitions through the controlled procurement API." /> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Requisition</TableHead><TableHead>Date</TableHead><TableHead>Department</TableHead><TableHead>Items</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{data.requisitions.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.reqNo}<p className="max-w-52 truncate text-xs text-muted-foreground">{row.purpose || '—'}</p></TableCell><TableCell>{dateStr(row.date)}</TableCell><TableCell>{row.department || '—'}</TableCell><TableCell>{row.lines.length}<p className="text-xs text-muted-foreground">₹{row.lines.reduce((sum, line) => sum + line.qty * line.estimatedRate, 0).toFixed(2)}</p></TableCell><TableCell><Badge variant={tone(row.status)}>{row.status}</Badge></TableCell><TableCell className="text-right">{row.status === 'DRAFT' ? <Button size="sm" disabled={busy === row.id} onClick={() => void run(row.id, { action: 'transition-requisition', id: row.id, transition: 'SUBMIT' }, `${row.reqNo} submitted`)}>Submit</Button> : row.status === 'SUBMITTED' ? <Button size="sm" disabled={busy === row.id} onClick={() => void run(row.id, { action: 'transition-requisition', id: row.id, transition: 'APPROVE' }, `${row.reqNo} approved`)}>Approve</Button> : null}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
      </TabsContent>
      <TabsContent value="rfq">
        <RfqWorkspace />
      </TabsContent>
      <TabsContent value="orders">
        {procurement.loading ? <TableSkeleton rows={6} cols={7} /> : !data?.orders.length ? <EmptyState icon={ShoppingCart} title="No purchase orders" hint="Approved requisitions can be converted to purchase orders." /> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Date</TableHead><TableHead>Progress</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{data.orders.map((row) => { const ordered = row.lines.reduce((s, x) => s + x.qty, 0); const accepted = row.lines.reduce((s, x) => s + x.acceptedQty, 0); return <TableRow key={row.id}><TableCell className="font-medium">{row.poNo}</TableCell><TableCell>{row.supplier.name}</TableCell><TableCell>{dateStr(row.date)}</TableCell><TableCell className="tabular-nums">{accepted} / {ordered}<p className="text-xs text-muted-foreground">accepted / ordered</p></TableCell><TableCell className="text-right"><Money value={row.grandTotal} plain /></TableCell><TableCell><Badge variant={tone(row.status)}>{row.status}</Badge></TableCell><TableCell className="text-right">{row.status === 'DRAFT' ? <Button size="sm" disabled={busy === row.id} onClick={() => void run(row.id, { action: 'approve-order', id: row.id }, `${row.poNo} approved`)}>Approve</Button> : null}</TableCell></TableRow> })}</TableBody></Table></CardContent></Card>}
      </TabsContent>
      <TabsContent value="receipts">
        {procurement.loading ? <TableSkeleton rows={6} cols={7} /> : !data?.receipts.length ? <EmptyState icon={PackageCheck} title="No goods receipts" hint="Receive approved purchase orders into GRN before supplier billing." /> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>GRN</TableHead><TableHead>PO</TableHead><TableHead>Supplier Doc</TableHead><TableHead>Received</TableHead><TableHead>Accepted</TableHead><TableHead>Rejected</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{data.receipts.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.grnNo}<p className="text-xs text-muted-foreground">{dateStr(row.date)}</p></TableCell><TableCell>{row.purchaseOrder.poNo}</TableCell><TableCell>{row.supplierDocNo || '—'}</TableCell><TableCell>{row.lines.reduce((s, x) => s + x.receivedQty, 0)}</TableCell><TableCell>{row.lines.reduce((s, x) => s + x.acceptedQty, 0)}</TableCell><TableCell>{row.lines.reduce((s, x) => s + x.rejectedQty, 0)}</TableCell><TableCell><Badge variant={tone(row.status)}>{row.status}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
      </TabsContent>
      <TabsContent value="matching">
        {!data ? <TableSkeleton rows={5} cols={6} /> : !data.matchExceptions.length ? <EmptyState icon={CheckCircle2} title="No three-way match exceptions" hint="Accepted quantities, billed quantities and PO rates reconcile." /> : <Card className="border-amber-500/30"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileWarning className="size-5 text-amber-600" />Match exceptions</CardTitle></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>GRN</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Accepted</TableHead><TableHead className="text-right">Billed</TableHead><TableHead className="text-right">Qty Variance</TableHead><TableHead>Invoices / Rate Variance</TableHead></TableRow></TableHeader><TableBody>{data.matchExceptions.map((row, index) => <TableRow key={`${row.grnNo}-${row.itemCode}-${index}`}><TableCell>{row.grnNo}</TableCell><TableCell>{row.itemCode}</TableCell><TableCell className="text-right">{row.acceptedQty}</TableCell><TableCell className="text-right">{row.billedQty}</TableCell><TableCell className="text-right font-medium text-destructive">{row.quantityVariance}</TableCell><TableCell>{row.invoices.join(', ') || 'Not invoiced'}{row.rateVariance.length ? <p className="text-xs text-destructive">Rate Δ: {row.rateVariance.join(', ')}</p> : null}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
      </TabsContent>
      <TabsContent value="returns">
        {returns.loading ? <TableSkeleton rows={6} cols={7} /> : !returns.data?.length ? <EmptyState icon={PackageCheck} title="No commercial returns" hint="Sales returns create credit notes; purchase returns create debit notes." /> : <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Return</TableHead><TableHead>Type</TableHead><TableHead>Party</TableHead><TableHead>Source</TableHead><TableHead>Adjustment</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{returns.data.map((row) => <TableRow key={row.id}><TableCell className="font-medium">{row.returnNo}<p className="text-xs text-muted-foreground">{dateStr(row.date)}</p></TableCell><TableCell><Badge variant={tone(row.status)}>{row.returnType.replace('_', ' ')}</Badge></TableCell><TableCell>{row.party.name}</TableCell><TableCell>{row.sourceInvoiceNo}</TableCell><TableCell>{row.adjustmentNo || '—'}<p className="text-xs text-muted-foreground">QC {row.qcStatus}</p></TableCell><TableCell className="text-right"><Money value={row.grandTotal} plain /></TableCell><TableCell className="text-right">{row.status === 'POSTED' ? <Button size="sm" variant="destructive" disabled={busy === row.id} onClick={() => void cancelReturn(row.id)}>Cancel</Button> : <Badge variant="outline">{row.status}</Badge>}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
      </TabsContent>
    </Tabs>
  </div>
}
