'use client'

/**
 * Proforma invoices (PI): create (standalone or from a sales order), print,
 * convert a standalone PI into the tax invoice, cancel. A PI posts nothing.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Plus, Printer, Trash2 } from 'lucide-react'
import { apiPost, toastError, useApi, useMasters, type InvoiceItem, type SalesInvoice } from './api'
import { EmptyState, TableSkeleton } from './bits'
import { InvoicePrint } from './invoice-print'
import { ReasonDialog } from './reason-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateStr, money } from '@/lib/erp'

interface PiRow {
  id: string
  piNo: string
  date: string
  validUntil: string
  status: 'ISSUED' | 'CONVERTED' | 'CANCELLED'
  expired: boolean
  grandTotal: number
  party: { id: string; code: string; name: string }
  salesOrder: { orderNo: string } | null
  convertedInvoiceNo: string | null
  cancelReason: string | null
  _count: { lines: number }
}
interface PiFull {
  id: string
  piNo: string
  date: string
  validUntil: string
  partyId: string
  placeOfSupply: string
  interState: boolean
  taxable: number
  discount: number
  cgst: number
  sgst: number
  igst: number
  roundOff: number
  grandTotal: number
  status: string
  terms: string | null
  party: { code: string; name: string; gstin: string | null; stateCode: string }
  salesOrder: { orderNo: string } | null
  lines: { id: string; itemId: string; hsn: string | null; uom: string; qty: number; rate: number; discPct: number; gstRate: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; item: { code: string; name: string } }[]
}
interface OpenOrder { id: string; orderNo: string; partyId: string; status: string; grandTotal: number }

const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = { ISSUED: 'default', CONVERTED: 'secondary', CANCELLED: 'destructive' }

/** Adapt a PI to the tax-invoice print layout (same GST maths, different title). */
function asPrintable(pi: PiFull): SalesInvoice {
  const items: InvoiceItem[] = pi.lines.map((l) => ({
    id: l.id, itemId: l.itemId, detail: null, hsn: l.hsn, uom: l.uom, qty: l.qty, rate: l.rate, discPct: l.discPct,
    discAmt: Math.round(l.qty * l.rate * (l.discPct / 100) * 100) / 100, taxable: l.taxable, gstRate: l.gstRate, cgst: l.cgst, sgst: l.sgst, igst: l.igst, total: l.total,
  }))
  return {
    id: pi.id, invoiceNo: pi.piNo, date: pi.date, partyId: pi.partyId, poNo: pi.salesOrder ? `Order ${pi.salesOrder.orderNo}` : null, pos: pi.placeOfSupply, interState: pi.interState,
    taxInclusive: false, taxable: pi.taxable, discount: pi.discount, cgst: pi.cgst, sgst: pi.sgst, igst: pi.igst, roundOff: pi.roundOff, grandTotal: pi.grandTotal, paidAmount: 0,
    status: pi.status, source: 'PROFORMA',
    remarks: `Proforma invoice — not a tax invoice; no GST is payable on it. Valid until ${dateStr(pi.validUntil)}.${pi.terms ? ` Terms: ${pi.terms}` : ''}`,
    party: { code: pi.party.code, name: pi.party.name, gstin: pi.party.gstin, stateCode: pi.party.stateCode },
    items,
  }
}

export function ProformaTab() {
  const list = useApi<PiRow[]>('/api/proforma')
  const [creating, setCreating] = useState(false)
  const [printId, setPrintId] = useState<string | null>(null)
  const [convertRow, setConvertRow] = useState<PiRow | null>(null)
  const [cancelRow, setCancelRow] = useState<PiRow | null>(null)
  const rows = list.data ?? []
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">A proforma is a priced offer with GST, sent before the sale (advance, approval, LC). It posts no stock, ledger or GST until it becomes a tax invoice.</p>
        <Button className="h-11 gap-2" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />New proforma</Button>
      </div>
      {list.loading ? <TableSkeleton rows={5} cols={6} /> : !rows.length ? (
        <EmptyState icon={FileText} title="No proforma invoices yet" hint="Create one for a customer, or from an open sales order." />
      ) : (
        <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>PI</TableHead><TableHead>Customer</TableHead><TableHead>Valid until</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><span className="font-medium tabular-nums">{r.piNo}</span><span className="block text-xs text-muted-foreground">{dateStr(r.date)}{r.salesOrder ? ` · ${r.salesOrder.orderNo}` : ''}</span></TableCell>
                <TableCell><span className="block max-w-48 truncate">{r.party.name}</span><span className="block text-xs text-muted-foreground">{r.party.code}</span></TableCell>
                <TableCell className={r.expired ? 'text-destructive' : ''}>{dateStr(r.validUntil)}{r.expired ? ' (expired)' : ''}</TableCell>
                <TableCell className="text-right tabular-nums">₹ {money(r.grandTotal)}</TableCell>
                <TableCell><Badge variant={STATUS_TONE[r.status]}>{r.status}</Badge>{r.convertedInvoiceNo ? <span className="block text-xs text-muted-foreground">→ {r.convertedInvoiceNo}</span> : null}</TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button variant="outline" size="sm" className="h-10 gap-1.5" onClick={() => setPrintId(r.id)} aria-label={`Print ${r.piNo}`}><Printer className="size-4" aria-hidden />Print</Button>
                    {r.status === 'ISSUED' && !r.salesOrder ? <Button size="sm" className="h-10" disabled={r.expired} title={r.expired ? 'Expired — issue a fresh proforma' : undefined} onClick={() => setConvertRow(r)}>Make invoice</Button> : null}
                    {r.status === 'ISSUED' ? <Button variant="ghost" size="sm" className="h-10 text-destructive" onClick={() => setCancelRow(r)}>Cancel</Button> : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></div></CardContent></Card>
      )}
      {creating ? <CreateProformaDialog onClose={() => setCreating(false)} onDone={() => { setCreating(false); list.reload() }} /> : null}
      {printId ? <PrintProformaDialog id={printId} onClose={() => setPrintId(null)} /> : null}
      {convertRow ? <ConvertDialog row={convertRow} onClose={() => setConvertRow(null)} onDone={() => { setConvertRow(null); list.reload() }} /> : null}
      {cancelRow ? (
        <ReasonDialog
          title={`Cancel ${cancelRow.piNo}?`}
          lines={['The proforma stays on record as CANCELLED.', 'Nothing was posted, so nothing is reversed.']}
          confirm="Cancel proforma"
          onClose={() => setCancelRow(null)}
          onConfirm={async (reason) => { await apiPost('/api/proforma', { action: 'cancel', id: cancelRow.id, reason }); toast.success(`${cancelRow.piNo} cancelled`); setCancelRow(null); list.reload() }}
        />
      ) : null}
    </div>
  )
}

type Line = { itemId: string; qty: string; rate: string; discPct: string }

function CreateProformaDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { parties, items } = useMasters()
  const o2c = useApi<{ orders: OpenOrder[] }>('/api/order-to-cash')
  const customers = parties.filter((p) => p.active && p.types.split(',').includes('CUSTOMER'))
  const [partyId, setPartyId] = useState('')
  const [orderId, setOrderId] = useState('')
  const [validUntil, setValidUntil] = useState(plus(15))
  const [terms, setTerms] = useState('')
  const [lines, setLines] = useState<Line[]>([{ itemId: '', qty: '', rate: '', discPct: '' }])
  const [saving, setSaving] = useState(false)
  const orders = useMemo(() => (o2c.data?.orders ?? []).filter((o) => o.partyId === partyId && !['CANCELLED', 'CLOSED', 'DISPATCHED', 'DRAFT'].includes(o.status)), [o2c.data, partyId])
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)))
  const valid = lines.filter((l) => l.itemId && Number(l.qty) > 0 && l.rate !== '' && Number(l.rate) >= 0)
  const net = (l: Line) => Number(l.qty) * Number(l.rate) * (1 - (Number(l.discPct) || 0) / 100)
  const taxable = valid.reduce((s, l) => s + net(l), 0)
  const gst = valid.reduce((s, l) => s + net(l) * ((items.find((i) => i.id === l.itemId)?.gstRate ?? 0) / 100), 0)
  const ok = !!partyId && validUntil >= new Date().toISOString().slice(0, 10) && (orderId ? true : valid.length === lines.length)
  const save = async () => {
    setSaving(true)
    try {
      const pi = await apiPost<{ piNo: string; grandTotal: number }>('/api/proforma', {
        action: 'create', partyId, validUntil, terms: terms || undefined, salesOrderId: orderId || null,
        ...(orderId ? {} : { lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), rate: Number(l.rate), ...(Number(l.discPct) > 0 ? { discPct: Number(l.discPct) } : {}) })) }),
      })
      toast.success(`${pi.piNo} issued — ₹ ${money(pi.grandTotal)}`)
      onDone()
    } catch (e) { toastError(e) } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>New proforma invoice</DialogTitle><DialogDescription>Rates are before GST; GST is computed exactly like the tax invoice. Pick an open sales order to bill its undispatched quantity.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5 sm:col-span-2"><Label>Customer</Label><Select value={partyId} onValueChange={(v) => { setPartyId(v); setOrderId('') }}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{customers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor="pi-valid">Valid until</Label><Input id="pi-valid" type="date" className="h-11" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
      <div className="space-y-1.5"><Label>From sales order</Label><Select value={orderId || 'none'} onValueChange={(v) => setOrderId(v === 'none' ? '' : v)} disabled={!partyId}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None — enter lines</SelectItem>{orders.map((o) => <SelectItem key={o.id} value={o.id}>{o.orderNo} · ₹ {money(o.grandTotal)}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="pi-terms">Terms</Label><Input id="pi-terms" className="h-11" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 100% advance against this proforma, delivery 2 weeks" /></div>
    </div>
    {orderId ? <p className="text-sm text-muted-foreground">Lines come from the order: every line&apos;s undispatched quantity at the order rate. The order is invoiced later through its delivery challan.</p> : <div className="space-y-2">
      {lines.map((l, i) => <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_6rem_7rem_5rem_2.75rem]">
        <Select value={l.itemId} onValueChange={(v) => set(i, { itemId: v, rate: l.rate || String(items.find((it) => it.id === v)?.saleRate ?? '') })}><SelectTrigger className="h-11 data-[size=default]:h-11" aria-label={`Line ${i + 1} item`}><SelectValue placeholder="Item" /></SelectTrigger><SelectContent>{items.filter((it) => it.active).map((it) => <SelectItem key={it.id} value={it.id}>{it.code} {it.name}</SelectItem>)}</SelectContent></Select>
        <Input className="h-11 text-right" inputMode="decimal" aria-label={`Line ${i + 1} quantity`} placeholder="Qty" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
        <Input className="h-11 text-right" inputMode="decimal" aria-label={`Line ${i + 1} rate`} placeholder="Rate" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />
        <Input className="h-11 text-right" inputMode="decimal" aria-label={`Line ${i + 1} discount`} placeholder="Disc %" value={l.discPct} onChange={(e) => set(i, { discPct: e.target.value })} />
        <Button variant="ghost" className="h-11" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Trash2 className="size-4" aria-hidden /></Button>
      </div>)}
      <Button variant="outline" className="h-11 gap-2" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '', rate: '', discPct: '' }])}><Plus className="size-4" aria-hidden />Add line</Button>
      <p className="text-sm">Taxable ₹ {money(taxable)} · GST ₹ {money(gst)} · <strong>Total ≈ ₹ {money(taxable + gst)}</strong></p>
    </div>}
    {!ok ? <p className="text-sm text-muted-foreground">Needed: customer, a future validity date, and item, quantity and rate on every line (or a sales order).</p> : null}
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={!ok || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Issue proforma'}</Button></DialogFooter>
  </DialogContent></Dialog>
}

function PrintProformaDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const pi = useApi<PiFull>(`/api/proforma?id=${id}`)
  const { items } = useMasters()
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
    <DialogHeader><DialogTitle>{pi.data?.piNo ?? 'Proforma'}</DialogTitle><DialogDescription>Print or save as PDF from the browser print dialog.</DialogDescription></DialogHeader>
    {pi.data ? <InvoicePrint kind="SALES" title="PROFORMA INVOICE" invoice={asPrintable(pi.data)} items={items} /> : <TableSkeleton rows={6} cols={4} />}
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11 gap-2" disabled={!pi.data} onClick={() => window.print()}><Printer className="size-4" aria-hidden />Print</Button></DialogFooter>
  </DialogContent></Dialog>
}

function ConvertDialog({ row, onClose, onDone }: { row: PiRow; onClose: () => void; onDone: () => void }) {
  const { warehouses } = useMasters()
  const active = warehouses.filter((w) => w.active)
  const [warehouseId, setWarehouseId] = useState('')
  const [saving, setSaving] = useState(false)
  const run = async () => {
    setSaving(true)
    try {
      const r = await apiPost<{ invoiceNo: string; grandTotal: number }>('/api/proforma', { action: 'convert', id: row.id, warehouseId })
      toast.success(`${r.invoiceNo} posted from ${row.piNo}`, { description: `₹ ${money(r.grandTotal)} — stock, ledger and GST are posted now.` })
      onDone()
    } catch (e) { toastError(e) } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>Make tax invoice from {row.piNo}</DialogTitle><DialogDescription>Posts a sales invoice with the same lines and rates: stock goes out of the warehouse, the customer is debited and GST becomes payable. This can be done once.</DialogDescription></DialogHeader>
    <div className="space-y-1.5"><Label>Dispatch from warehouse</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{active.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>)}</SelectContent></Select></div>
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={!warehouseId || saving} onClick={() => void run()}>{saving ? 'Posting…' : 'Post tax invoice'}</Button></DialogFooter>
  </DialogContent></Dialog>
}
