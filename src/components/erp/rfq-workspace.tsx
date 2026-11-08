'use client'

/**
 * Requisition → RFQ → supplier quotations → commercial comparison → award
 * (OWNER approval, mandatory reason) → purchase order.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Award, FilePlus2, FileSpreadsheet, Plus, RefreshCw, ShoppingCart, Trophy, XCircle } from 'lucide-react'
import { apiPost, toastError, useApi, useMasters } from './api'
import { EmptyState, HumanStatus, Money, TableSkeleton } from './bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateStr, money, qty as qtyFmt } from '@/lib/erp'

type Offer = { quoteId: string; supplier: string; rate: number; discountPct: number; gstRate: number; netRate: number; amount: number }
type CompQuote = { id: string; supplierId: string; supplier: string; landedTotal: number; subtotal: number; taxAmount: number; freight: number; deliveryDays: number; validUntil: string; expired: boolean; status: string }
type Rfq = {
  id: string; rfqNo: string; date: string; dueDate: string | null; status: string; awardReason: string | null; awardedQuoteId: string | null; purchaseOrderId: string | null; cancelReason: string | null
  requisition: { reqNo: string } | null
  lines: { id: string; qty: number; uom: string; item: { id: string; code: string; name: string; gstRate: number } }[]
  suppliers: { supplierId: string; supplier: { id: string; name: string } }[]
  quotes: { id: string; supplierId: string; status: string; rejectionReason: string | null; supplierRef: string | null }[]
  comparison: { quotes: CompQuote[]; lowestQuoteId: string | null; fastestQuoteId: string | null; lines: { rfqLineId: string; item: { code: string; name: string }; qty: number; uom: string; offers: Offer[]; lowestQuoteId: string | null }[] }
}
type Requisition = { id: string; reqNo: string; status: string; lines: { qty: number; orderedQty: number; item: { code: string; name: string } }[] }

export function RfqWorkspace() {
  const rfqs = useApi<Rfq[]>('/api/rfq')
  const procurement = useApi<{ requisitions: Requisition[] }>('/api/procurement')
  const [selectedId, setSelectedId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [quoteFor, setQuoteFor] = useState<{ rfq: Rfq; supplierId: string } | null>(null)
  const [awarding, setAwarding] = useState<{ rfq: Rfq; quote: CompQuote } | null>(null)
  const [cancelling, setCancelling] = useState<Rfq | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = rfqs.data?.find((r) => r.id === selectedId) ?? rfqs.data?.[0] ?? null
  const reload = async () => { await rfqs.reload() }

  const raisePo = async (rfq: Rfq) => {
    setBusy(true)
    try { const po = await apiPost<{ poNo: string }>('/api/rfq', { action: 'create-po', rfqId: rfq.id }); toast.success(`${po.poNo} raised from ${rfq.rfqNo}`, { description: 'Approve it under Purchase Orders.' }); await reload() }
    catch (e) { toastError(e) } finally { setBusy(false) }
  }

  if (rfqs.loading) return <TableSkeleton rows={6} cols={6} />
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2"><Button className="h-11 gap-2" onClick={() => setCreateOpen(true)}><FilePlus2 className="size-4" aria-hidden />New RFQ</Button><Button variant="outline" className="ml-auto h-11 gap-2" onClick={() => void reload()}><RefreshCw className="size-4" aria-hidden />Refresh</Button></div>
    {!rfqs.data?.length ? <EmptyState icon={FileSpreadsheet} title="No RFQs yet" hint="Send a request for quotation to several suppliers from an approved requisition, compare their quotes and award the best one." action={<Button variant="outline" className="mt-2 h-11" onClick={() => setCreateOpen(true)}>New RFQ</Button>} /> : <>
      <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>RFQ</TableHead><TableHead>Suppliers</TableHead><TableHead className="text-right">Lowest landed</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
        {rfqs.data.map((r) => { const low = r.comparison.quotes.find((q) => q.id === r.comparison.lowestQuoteId); return <TableRow key={r.id} className={selected?.id === r.id ? 'bg-muted/50' : 'cursor-pointer'} onClick={() => setSelectedId(r.id)}>
          <TableCell className="font-medium"><button type="button" className="min-h-8 text-left underline-offset-2 hover:underline" onClick={() => setSelectedId(r.id)}>{r.rfqNo}</button><p className="text-xs text-muted-foreground">{dateStr(r.date)}{r.requisition ? ` · from ${r.requisition.reqNo}` : ''}{r.dueDate ? ` · quotes due ${dateStr(r.dueDate)}` : ''}</p></TableCell>
          <TableCell>{r.quotes.length} of {r.suppliers.length} quoted</TableCell>
          <TableCell className="text-right">{low ? <><Money value={low.landedTotal} /><p className="text-xs text-muted-foreground">{low.supplier}</p></> : '—'}</TableCell>
          <TableCell><HumanStatus status={r.status} detail={r.status === 'OPEN' ? (r.quotes.length ? 'Compare and award' : 'Awaiting quotations') : r.status === 'AWARDED' ? 'Raise the purchase order' : undefined} /></TableCell>
        </TableRow> })}
      </TableBody></Table></div></CardContent></Card>
      {selected ? <RfqDetail rfq={selected} busy={busy} onQuote={(supplierId) => setQuoteFor({ rfq: selected, supplierId })} onAward={(quote) => setAwarding({ rfq: selected, quote })} onRaisePo={() => void raisePo(selected)} onCancel={() => setCancelling(selected)} /> : null}
    </>}
    {createOpen ? <CreateRfqDialog requisitions={(procurement.data?.requisitions ?? []).filter((r) => r.status === 'APPROVED' && r.lines.some((l) => l.qty - l.orderedQty > 0.0001))} onClose={() => setCreateOpen(false)} onDone={async (id) => { setCreateOpen(false); await reload(); setSelectedId(id) }} /> : null}
    {quoteFor ? <QuoteDialog rfq={quoteFor.rfq} supplierId={quoteFor.supplierId} onClose={() => setQuoteFor(null)} onDone={async () => { setQuoteFor(null); await reload() }} /> : null}
    {awarding ? <AwardDialog rfq={awarding.rfq} quote={awarding.quote} onClose={() => setAwarding(null)} onDone={async () => { setAwarding(null); await reload() }} /> : null}
    {cancelling ? <CancelRfqDialog rfq={cancelling} onClose={() => setCancelling(null)} onDone={async () => { setCancelling(null); await reload() }} /> : null}
  </div>
}

function RfqDetail({ rfq, busy, onQuote, onAward, onRaisePo, onCancel }: { rfq: Rfq; busy: boolean; onQuote: (supplierId: string) => void; onAward: (q: CompQuote) => void; onRaisePo: () => void; onCancel: () => void }) {
  const c = rfq.comparison
  const order = c.quotes // already sorted by landed total
  const open = rfq.status === 'OPEN'
  return <Card className="p-0"><CardContent className="space-y-4 p-4">
    <div className="flex flex-wrap items-center gap-3"><p className="text-base font-semibold">{rfq.rfqNo}</p><HumanStatus status={rfq.status} />
      <div className="ml-auto flex flex-wrap gap-2">
        {rfq.status === 'AWARDED' ? <Button className="h-11 gap-2" disabled={busy} onClick={onRaisePo}><ShoppingCart className="size-4" aria-hidden />{busy ? 'Raising PO…' : 'Raise purchase order'}</Button> : null}
        {rfq.status === 'OPEN' || rfq.status === 'AWARDED' ? <Button variant="outline" className="h-11 gap-2" onClick={onCancel}><XCircle className="size-4" aria-hidden />Cancel RFQ</Button> : null}
      </div></div>
    {rfq.awardReason ? <p className="text-sm"><span className="text-muted-foreground">Selection reason:</span> {rfq.awardReason}</p> : null}
    {rfq.cancelReason ? <p className="text-sm text-destructive">Cancelled: {rfq.cancelReason}</p> : null}

    <div><p className="mb-2 text-sm font-medium">Invited suppliers</p><div className="flex flex-wrap gap-2">{rfq.suppliers.map((s) => { const q = rfq.quotes.find((x) => x.supplierId === s.supplierId); return <div key={s.supplierId} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
      <span>{s.supplier.name}</span>{q ? <HumanStatus status={q.status} /> : <Badge variant="outline">Awaiting quote</Badge>}
      {open ? <Button variant="ghost" className="h-9 gap-1 px-2" onClick={() => onQuote(s.supplierId)}><Plus className="size-4" aria-hidden />{q ? 'Revise' : 'Record'} quote</Button> : null}
    </div> })}</div></div>

    {!order.length ? <p className="text-sm text-muted-foreground">No quotations recorded yet.</p> : <div className="overflow-x-auto"><Table aria-label="Quotation comparison"><TableHeader><TableRow><TableHead>Item</TableHead>{order.map((q) => <TableHead key={q.id} className="text-right">{q.supplier}{q.id === c.lowestQuoteId ? <Badge className="ml-1 gap-1"><Trophy className="size-3" aria-hidden />Lowest</Badge> : null}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{c.lines.map((line) => <TableRow key={line.rfqLineId}><TableCell>{line.item.code}<p className="text-xs text-muted-foreground">{qtyFmt(line.qty)} {line.uom}</p></TableCell>
        {order.map((q) => { const o = line.offers.find((x) => x.quoteId === q.id); return <TableCell key={q.id} className={`text-right tabular-nums ${o && line.lowestQuoteId === q.id ? 'font-semibold text-emerald-700 dark:text-emerald-300' : ''}`}>{o ? <>₹ {money(o.netRate)}<p className="text-xs font-normal text-muted-foreground">{o.discountPct ? `${o.discountPct}% off ₹ ${money(o.rate)} · ` : ''}GST {o.gstRate}%</p></> : '—'}</TableCell> })}
      </TableRow>)}</TableBody>
      <TableFooter>
        <TableRow><TableCell>Subtotal + GST</TableCell>{order.map((q) => <TableCell key={q.id} className="text-right"><Money value={q.subtotal + q.taxAmount} /></TableCell>)}</TableRow>
        <TableRow><TableCell>Freight</TableCell>{order.map((q) => <TableCell key={q.id} className="text-right"><Money value={q.freight} /></TableCell>)}</TableRow>
        <TableRow><TableCell className="font-semibold">Landed total</TableCell>{order.map((q) => <TableCell key={q.id} className="text-right font-semibold"><Money value={q.landedTotal} /></TableCell>)}</TableRow>
        <TableRow><TableCell>Delivery</TableCell>{order.map((q) => <TableCell key={q.id} className="text-right">{q.deliveryDays} days{q.id === c.fastestQuoteId ? ' · fastest' : ''}</TableCell>)}</TableRow>
        <TableRow><TableCell>Valid until</TableCell>{order.map((q) => <TableCell key={q.id} className="text-right">{q.expired ? <HumanStatus status="EXPIRED" detail={dateStr(q.validUntil)} /> : dateStr(q.validUntil)}</TableCell>)}</TableRow>
        {open ? <TableRow><TableCell /> {order.map((q) => <TableCell key={q.id} className="text-right"><Button className="h-11 gap-1 sm:h-9" disabled={q.expired} title={q.expired ? 'Expired — ask the supplier to revalidate' : 'Award this quotation'} onClick={() => onAward(q)}><Award className="size-4" aria-hidden />Award</Button></TableCell>)}</TableRow> : null}
      </TableFooter></Table></div>}
    {rfq.quotes.filter((q) => q.status === 'REJECTED' && q.rejectionReason).map((q) => <p key={q.id} className="text-xs text-muted-foreground">{rfq.suppliers.find((s) => s.supplierId === q.supplierId)?.supplier.name}: {q.rejectionReason}</p>)}
  </CardContent></Card>
}

function CreateRfqDialog({ requisitions, onClose, onDone }: { requisitions: Requisition[]; onClose: () => void; onDone: (id: string) => Promise<void> }) {
  const { parties, items } = useMasters()
  const suppliers = parties.filter((p) => p.active !== false && p.types.split(',').includes('SUPPLIER'))
  const [source, setSource] = useState<'requisition' | 'manual'>(requisitions.length ? 'requisition' : 'manual')
  const [requisitionId, setRequisitionId] = useState(''); const [invited, setInvited] = useState<string[]>([]); const [dueDate, setDueDate] = useState(''); const [lines, setLines] = useState([{ itemId: '', qty: '' }]); const [saving, setSaving] = useState(false)
  const problem = invited.length === 0 ? 'Invite at least one supplier' : source === 'requisition' && !requisitionId ? 'Choose the approved requisition' : source === 'manual' && lines.some((l) => !l.itemId || !(Number(l.qty) > 0)) ? 'Every line needs an item and a positive quantity' : source === 'manual' && new Set(lines.map((l) => l.itemId)).size !== lines.length ? 'An item may appear only once' : ''
  const submit = async () => {
    setSaving(true)
    try {
      const rfq = await apiPost<{ id: string; rfqNo: string }>('/api/rfq', { action: 'create-rfq', supplierIds: invited, dueDate: dueDate || undefined, ...(source === 'requisition' ? { requisitionId } : { lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })) }) })
      toast.success(`${rfq.rfqNo} created`, { description: 'Record each supplier quotation as it arrives.' }); await onDone(rfq.id)
    } catch (e) { toastError(e) } finally { setSaving(false) }
  }
  const req = requisitions.find((r) => r.id === requisitionId)
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>New request for quotation</DialogTitle><DialogDescription>Quantities come from an approved requisition (its unordered part) or are entered here.</DialogDescription></DialogHeader>
    <div className="space-y-3">
      <div className="flex gap-2"><Button type="button" variant={source === 'requisition' ? 'default' : 'outline'} className="h-11" disabled={!requisitions.length} onClick={() => setSource('requisition')}>From requisition</Button><Button type="button" variant={source === 'manual' ? 'default' : 'outline'} className="h-11" onClick={() => setSource('manual')}>Enter lines</Button></div>
      {source === 'requisition' ? <><Select value={requisitionId} onValueChange={setRequisitionId}><SelectTrigger className="h-11"><SelectValue placeholder="Approved requisition" /></SelectTrigger><SelectContent>{requisitions.map((r) => <SelectItem key={r.id} value={r.id}>{r.reqNo} · {r.lines.length} line(s)</SelectItem>)}</SelectContent></Select>
        {req ? <ul className="text-sm text-muted-foreground">{req.lines.filter((l) => l.qty - l.orderedQty > 0.0001).map((l) => <li key={l.item.code}>{l.item.code} · {qtyFmt(l.qty - l.orderedQty)} open</li>)}</ul> : null}</> :
        <div className="space-y-2">{lines.map((l, idx) => <div key={idx} className="grid grid-cols-[1fr_7rem_auto] gap-2"><Select value={l.itemId} onValueChange={(v) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, itemId: v } : x)))}><SelectTrigger className="h-11"><SelectValue placeholder="Item" /></SelectTrigger><SelectContent>{items.filter((i) => i.active !== false && !i.isService).map((i) => <SelectItem key={i.id} value={i.id}>{i.code} · {i.name}</SelectItem>)}</SelectContent></Select><Input type="number" min={0} className="h-11" aria-label="Quantity" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} /><Button type="button" variant="ghost" className="size-11" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}><XCircle className="size-4" aria-hidden /></Button></div>)}<Button type="button" variant="outline" className="h-11 gap-1" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '' }])}><Plus className="size-4" aria-hidden />Add line</Button></div>}
      <div><Label>Invite suppliers</Label><div className="mt-1 grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">{suppliers.map((s) => <label key={s.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 hover:bg-muted"><Checkbox checked={invited.includes(s.id)} onCheckedChange={(v) => setInvited((xs) => (v ? [...xs, s.id] : xs.filter((x) => x !== s.id)))} /><span className="text-sm">{s.name}</span></label>)}</div></div>
      <div className="max-w-48"><Label>Quotations due by</Label><Input type="date" className="h-11" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      {problem ? <p className="text-sm text-muted-foreground">{problem}</p> : null}
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!!problem || saving} onClick={() => void submit()}>{saving ? 'Creating…' : 'Create RFQ'}</Button></DialogFooter></DialogContent></Dialog>
}

function QuoteDialog({ rfq, supplierId, onClose, onDone }: { rfq: Rfq; supplierId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const supplier = rfq.suppliers.find((s) => s.supplierId === supplierId)?.supplier.name ?? ''
  const [rates, setRates] = useState<Record<string, { rate: string; disc: string; gst: string }>>(() => Object.fromEntries(rfq.lines.map((l) => [l.id, { rate: '', disc: '', gst: String(l.item.gstRate) }])))
  const [validUntil, setValidUntil] = useState(''); const [deliveryDays, setDeliveryDays] = useState(''); const [freight, setFreight] = useState(''); const [terms, setTerms] = useState(''); const [ref, setRef] = useState(''); const [saving, setSaving] = useState(false)
  const totals = useMemo(() => { let sub = 0, tax = 0; for (const l of rfq.lines) { const r = rates[l.id]; const amt = l.qty * (Number(r.rate) || 0) * (1 - (Number(r.disc) || 0) / 100); sub += amt; tax += (amt * (Number(r.gst) || 0)) / 100 } return { sub, tax, landed: sub + tax + (Number(freight) || 0) } }, [rates, freight, rfq.lines])
  const problem = rfq.lines.some((l) => rates[l.id].rate === '' || Number(rates[l.id].rate) < 0) ? 'Enter a rate for every line' : !validUntil ? 'Enter how long the quotation is valid' : deliveryDays === '' || !Number.isInteger(Number(deliveryDays)) || Number(deliveryDays) < 0 ? 'Enter delivery lead time in whole days' : ''
  const submit = async () => {
    setSaving(true)
    try { await apiPost('/api/rfq', { action: 'record-quote', rfqId: rfq.id, supplierId, supplierRef: ref || undefined, validUntil, deliveryDays: Number(deliveryDays), freight: Number(freight) || 0, paymentTerms: terms || undefined, lines: rfq.lines.map((l) => ({ rfqLineId: l.id, rate: Number(rates[l.id].rate), discountPct: Number(rates[l.id].disc) || 0, gstRate: Number(rates[l.id].gst) })) }); toast.success(`Quotation from ${supplier} recorded`); await onDone() }
    catch (e) { toastError(e) } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Quotation — {supplier}</DialogTitle><DialogDescription>{rfq.rfqNo}. Every line must be priced; recording again replaces the earlier quote while the RFQ is open.</DialogDescription></DialogHeader>
    <div className="space-y-3">
      {rfq.lines.map((l) => <div key={l.id} className="grid grid-cols-[1fr_6rem_5rem_5rem] items-end gap-2"><p className="pb-2 text-sm">{l.item.code}<span className="block text-xs text-muted-foreground">{qtyFmt(l.qty)} {l.uom}</span></p>
        {(['rate', 'disc', 'gst'] as const).map((k) => <div key={k}><Label className="text-xs">{k === 'rate' ? 'Rate ₹' : k === 'disc' ? 'Disc %' : 'GST %'}</Label><Input type="number" min={0} className="h-11" value={rates[l.id][k]} onChange={(e) => setRates((rs) => ({ ...rs, [l.id]: { ...rs[l.id], [k]: e.target.value } }))} /></div>)}</div>)}
      <div className="grid gap-3 sm:grid-cols-3"><div><Label>Valid until</Label><Input type="date" className="h-11" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div><div><Label>Delivery (days)</Label><Input type="number" min={0} step={1} className="h-11" value={deliveryDays} onChange={(e) => setDeliveryDays(e.target.value)} /></div><div><Label>Freight ₹</Label><Input type="number" min={0} className="h-11" value={freight} onChange={(e) => setFreight(e.target.value)} /></div><div className="sm:col-span-2"><Label>Payment terms</Label><Input className="h-11" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 30 days credit" /></div><div><Label>Supplier ref.</Label><Input className="h-11" value={ref} onChange={(e) => setRef(e.target.value)} /></div></div>
      <p className="text-sm">Subtotal ₹ {money(totals.sub)} · GST ₹ {money(totals.tax)} · <strong>Landed ₹ {money(totals.landed)}</strong></p>
      {problem ? <p className="text-sm text-muted-foreground">{problem}</p> : null}
    </div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!!problem || saving} onClick={() => void submit()}>{saving ? 'Saving…' : 'Save quotation'}</Button></DialogFooter></DialogContent></Dialog>
}

function AwardDialog({ rfq, quote, onClose, onDone }: { rfq: Rfq; quote: CompQuote; onClose: () => void; onDone: () => Promise<void> }) {
  const lowest = rfq.comparison.quotes.find((q) => q.id === rfq.comparison.lowestQuoteId)
  const premium = lowest && lowest.id !== quote.id ? quote.landedTotal - lowest.landedTotal : 0
  const others = rfq.comparison.quotes.filter((q) => q.id !== quote.id)
  const [reason, setReason] = useState(premium > 0 ? '' : 'Lowest landed cost'); const [saving, setSaving] = useState(false)
  const submit = async () => { setSaving(true); try { await apiPost('/api/rfq', { action: 'award', rfqId: rfq.id, quoteId: quote.id, reason }); toast.success(`${rfq.rfqNo} awarded to ${quote.supplier}`); await onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>Award {rfq.rfqNo} to {quote.supplier}?</DialogTitle><DialogDescription>Supplier selection needs the OWNER&apos;s approval and is recorded in the audit trail.</DialogDescription></DialogHeader>
    <ul className="list-disc space-y-1 pl-5 text-sm"><li>landed total ₹ {money(quote.landedTotal)}, delivery {quote.deliveryDays} days</li>{premium > 0 ? <li className="text-amber-700 dark:text-amber-300">₹ {money(premium)} more than the lowest quote ({lowest?.supplier}) — explain why</li> : <li>this is the lowest landed total</li>}{others.length ? <li>{others.length} other quotation(s) will be closed as not selected, with your reason</li> : null}</ul>
    <div><Label>Selection reason (required)</Label><Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. faster delivery, approved vendor quality" /></div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!reason.trim() || saving} onClick={() => void submit()}>{saving ? 'Awarding…' : 'Award'}</Button></DialogFooter></DialogContent></Dialog>
}

function CancelRfqDialog({ rfq, onClose, onDone }: { rfq: Rfq; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState(''); const [saving, setSaving] = useState(false)
  const submit = async () => { setSaving(true); try { await apiPost('/api/rfq', { action: 'cancel', rfqId: rfq.id, reason }); toast.success(`${rfq.rfqNo} cancelled`); await onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>Cancel {rfq.rfqNo}?</DialogTitle><DialogDescription>Recorded quotations stay for reference. A cancelled RFQ cannot be awarded.</DialogDescription></DialogHeader>
    <div><Label>Reason (required)</Label><Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Keep RFQ</Button><Button variant="destructive" disabled={!reason.trim() || saving} onClick={() => void submit()}>Cancel RFQ</Button></DialogFooter></DialogContent></Dialog>
}
