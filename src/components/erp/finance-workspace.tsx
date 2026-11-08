'use client'

/**
 * Advances, payment schedules and refunds in one place: open advances with
 * apply / tag-to-order / reverse, schedule editor and per-order reconciliation,
 * refundable credit/debit notes with refund, cancel and a printable
 * acknowledgement. Every financial action states its effect before it posts.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, HandCoins, Link2, Plus, Printer, RefreshCw, Undo2, Wallet, XCircle } from 'lucide-react'
import { apiPost, toastError, useApi } from './api'
import { EmptyState, HumanStatus, Money, TableSkeleton } from './bits'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateStr, money } from '@/lib/erp'

type Allocation = { id: string; invoiceNo: string; invoiceType: string; amount: number; kind: string; reversedAt: string | null; reversalReason: string | null }
type Advance = { id: string; partyId: string; advanceType: 'CUSTOMER' | 'SUPPLIER'; originalAmount: number; appliedAmount: number; status: string; party: { name: string; code: string }; salesOrder: { id: string; orderNo: string } | null; payment: { id: string; paymentNo: string; date: string; status: string; allocations: Allocation[] } }
type Schedule = { id: string; salesOrderId: string; milestone: string; dueDate: string; amount: number; paidAmount: number; status: string; party: { name: string }; salesOrder: { orderNo: string; grandTotal: number } }
type Refund = { id: string; amount: number; returnDocument: { id: string; adjustmentNo: string; returnType: string }; payment: { id: string; paymentNo: string; date: string; mode: string; status: string; partyId: string } }
type Recon = { salesOrderId: string; orderNo: string; orderTotal: number; scheduled: number; scheduledPaid: number; invoiced: number; collected: number; overdue: number; issues: string[] }
type FinanceData = { schedules: Schedule[]; advances: Advance[]; refunds: Refund[]; reconciliation: Recon[] }
type ReturnDoc = { id: string; adjustmentNo: string; returnNo: string; returnType: string; status: string; grandTotal: number; refundedAmount: number; date: string; party: { name: string } }
type Order = { id: string; orderNo: string; status: string; grandTotal: number; partyId: string; party: { name: string } }
type OpenInvoice = { id: string; invoiceNo: string; date: string; grandTotal: number; paidAmount: number; status: string }

const FA = '/api/finance-adjustments'
const r2 = (v: number) => Math.round(v * 100) / 100

export function FinanceAdjustmentsWorkspace() {
  const data = useApi<FinanceData>(FA)
  const returns = useApi<ReturnDoc[]>('/api/returns')
  const o2c = useApi<{ orders: Order[] }>('/api/order-to-cash')
  const [applying, setApplying] = useState<Advance | null>(null)
  const [tagging, setTagging] = useState<Advance | null>(null)
  const [reversing, setReversing] = useState<{ advance: Advance; allocation: Allocation } | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [refunding, setRefunding] = useState<ReturnDoc | null>(null)
  const [cancelRefund, setCancelRefund] = useState<Refund | null>(null)
  const [printing, setPrinting] = useState<Refund | null>(null)
  const reload = async () => { await Promise.all([data.reload(), returns.reload(), o2c.reload()]) }

  const advances = (data.data?.advances ?? []).filter((a) => a.status !== 'CANCELLED' && a.payment.status === 'POSTED')
  const openAdvanceTotal = r2(advances.reduce((s, a) => s + a.originalAmount - a.appliedAmount, 0))
  const overdueTotal = r2((data.data?.schedules ?? []).filter((s) => s.status === 'OVERDUE').reduce((s, r) => s + r.amount - r.paidAmount, 0))
  const refundable = (returns.data ?? []).filter((r) => r.status === 'POSTED' && r.grandTotal - r.refundedAmount > 0.004)
  const schedulesByOrder = useMemo(() => {
    const map = new Map<string, Schedule[]>()
    for (const s of data.data?.schedules ?? []) map.set(s.salesOrderId, [...(map.get(s.salesOrderId) ?? []), s])
    return [...map.entries()]
  }, [data.data])

  if (data.loading) return <TableSkeleton rows={8} cols={6} />
  return <div className="space-y-4">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card className="p-4"><p className="text-xs text-muted-foreground">Unapplied advances</p><p className="text-xl font-semibold"><Money value={openAdvanceTotal} /></p><p className="text-xs text-muted-foreground">{advances.filter((a) => a.originalAmount - a.appliedAmount > 0.004).length} open</p></Card>
      <Card className="p-4"><p className="text-xs text-muted-foreground">Overdue milestones</p><p className={overdueTotal > 0 ? 'text-xl font-semibold text-destructive' : 'text-xl font-semibold'}><Money value={overdueTotal} /></p><p className="text-xs text-muted-foreground">across {new Set((data.data?.schedules ?? []).filter((s) => s.status === 'OVERDUE').map((s) => s.salesOrderId)).size} order(s)</p></Card>
      <Card className="p-4"><p className="text-xs text-muted-foreground">Refundable credit/debit notes</p><p className="text-xl font-semibold"><Money value={r2(refundable.reduce((s, r) => s + r.grandTotal - r.refundedAmount, 0))} /></p><p className="text-xs text-muted-foreground">{refundable.length} note(s)</p></Card>
    </div>
    <div className="flex flex-wrap gap-2"><Button className="h-11 gap-2" onClick={() => setScheduleOpen(true)}><CalendarClock className="size-4" aria-hidden />Set payment schedule</Button><Button variant="outline" className="ml-auto h-11 gap-2" onClick={() => void reload()}><RefreshCw className="size-4" aria-hidden />Refresh</Button></div>

    <Section icon={Wallet} title="Advances">
      {!advances.length ? <EmptyState icon={Wallet} title="No open advances" hint="A receipt or payment that is not allocated to invoices becomes an advance; apply it to invoices here." /> :
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Advance</TableHead><TableHead className="text-right">Original / applied</TableHead><TableHead className="text-right">Available</TableHead><TableHead>Order</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
          {advances.map((a) => { const available = r2(a.originalAmount - a.appliedAmount); const applications = a.payment.allocations.filter((x) => x.kind === 'ADVANCE_APPLICATION'); return <TableRow key={a.id}>
            <TableCell className="font-medium">{a.payment.paymentNo}<p className="text-xs text-muted-foreground">{a.advanceType === 'CUSTOMER' ? 'Customer' : 'Supplier'} · {a.party.name} · {dateStr(a.payment.date)}</p>
              {applications.map((x) => <p key={x.id} className="text-xs">{x.reversedAt ? <s className="text-muted-foreground">{x.invoiceNo} <Money value={x.amount} plain /></s> : <>{x.invoiceNo} <Money value={x.amount} plain /> <button type="button" className="ml-1 inline-flex min-h-8 items-center gap-1 text-destructive underline-offset-2 hover:underline" onClick={() => setReversing({ advance: a, allocation: x })}><Undo2 className="size-3" aria-hidden />reverse</button></>}</p>)}</TableCell>
            <TableCell className="text-right"><Money value={a.originalAmount} /><p className="text-xs text-muted-foreground"><Money value={a.appliedAmount} plain /> applied</p></TableCell>
            <TableCell className="text-right font-medium"><Money value={available} /></TableCell>
            <TableCell>{a.salesOrder?.orderNo ?? <span className="text-muted-foreground">—</span>}</TableCell>
            <TableCell><HumanStatus status={a.status} /></TableCell>
            <TableCell className="text-right"><div className="flex flex-wrap justify-end gap-2">
              <Button className="h-11 gap-1 sm:h-9" disabled={available <= 0.004} title={available <= 0.004 ? 'Nothing left to apply' : undefined} onClick={() => setApplying(a)}><HandCoins className="size-4" aria-hidden />Apply</Button>
              {a.advanceType === 'CUSTOMER' ? <Button variant="outline" className="h-11 gap-1 sm:h-9" onClick={() => setTagging(a)}><Link2 className="size-4" aria-hidden />{a.salesOrder ? 'Re-tag' : 'Tag to order'}</Button> : null}
            </div></TableCell>
          </TableRow> })}
        </TableBody></Table></div>}
    </Section>

    <Section icon={CalendarClock} title="Payment schedules">
      {!schedulesByOrder.length ? <EmptyState icon={CalendarClock} title="No payment schedules" hint="Split a sales order into milestones (advance, on dispatch, balance); collections settle them automatically, oldest due first." action={<Button variant="outline" className="mt-2 h-11" onClick={() => setScheduleOpen(true)}>Set payment schedule</Button>} /> :
        <div className="divide-y">{schedulesByOrder.map(([orderId, rows]) => { const rec = data.data?.reconciliation.find((r) => r.salesOrderId === orderId); return <div key={orderId} className="space-y-2 p-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1"><p className="font-medium">{rows[0].salesOrder.orderNo}</p><p className="text-sm text-muted-foreground">{rows[0].party.name}</p>
            {rec ? <p className="text-xs text-muted-foreground">Order <Money value={rec.orderTotal} plain /> · invoiced <Money value={rec.invoiced} plain /> · collected <Money value={rec.collected} plain /></p> : null}</div>
          {rec?.issues.length ? <p className="text-xs text-amber-700 dark:text-amber-300">{rec.issues.join(' · ')}</p> : null}
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Milestone</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Collected</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>
            {rows.map((s) => <TableRow key={s.id}><TableCell>{s.milestone}</TableCell><TableCell>{dateStr(s.dueDate)}</TableCell><TableCell className="text-right"><Money value={s.amount} /></TableCell><TableCell className="text-right"><Money value={s.paidAmount} /></TableCell><TableCell><HumanStatus status={s.status} detail={s.status !== 'PAID' && s.paidAmount > 0 ? `₹ ${money(r2(s.amount - s.paidAmount))} pending` : undefined} /></TableCell></TableRow>)}
          </TableBody></Table></div>
        </div> })}</div>}
    </Section>

    <Section icon={Undo2} title="Refunds">
      {!refundable.length && !(data.data?.refunds.length) ? <EmptyState icon={Undo2} title="Nothing to refund" hint="Posted sales returns (credit notes) and purchase returns (debit notes) with an unrefunded balance appear here." /> : <>
        {refundable.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Note</TableHead><TableHead className="text-right">Value</TableHead><TableHead className="text-right">Refundable</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
          {refundable.map((r) => <TableRow key={r.id}><TableCell className="font-medium">{r.adjustmentNo}<p className="text-xs text-muted-foreground">{r.returnType === 'SALES_RETURN' ? 'Credit note to' : 'Debit note on'} {r.party.name} · {r.returnNo}</p></TableCell><TableCell className="text-right"><Money value={r.grandTotal} /></TableCell><TableCell className="text-right font-medium"><Money value={r2(r.grandTotal - r.refundedAmount)} /></TableCell><TableCell className="text-right"><Button className="h-11 sm:h-9" onClick={() => setRefunding(r)}>Refund</Button></TableCell></TableRow>)}
        </TableBody></Table></div> : null}
        {data.data?.refunds.length ? <div className="overflow-x-auto border-t"><Table><TableHeader><TableRow><TableHead>Refund</TableHead><TableHead>Against</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
          {data.data.refunds.map((r) => <TableRow key={r.id}><TableCell className="font-medium">{r.payment.paymentNo}<p className="text-xs text-muted-foreground">{dateStr(r.payment.date)} · {r.payment.mode}</p></TableCell><TableCell>{r.returnDocument.adjustmentNo}</TableCell><TableCell className="text-right"><Money value={r.amount} /></TableCell><TableCell><HumanStatus status={r.payment.status} /></TableCell><TableCell className="text-right"><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" className="h-11 gap-1 sm:h-9" onClick={() => setPrinting(r)}><Printer className="size-4" aria-hidden />Acknowledgement</Button>{r.payment.status === 'POSTED' ? <Button variant="outline" className="h-11 gap-1 sm:h-9" onClick={() => setCancelRefund(r)}><XCircle className="size-4" aria-hidden />Cancel</Button> : null}</div></TableCell></TableRow>)}
        </TableBody></Table></div> : null}
      </>}
    </Section>

    {applying ? <ApplyAdvanceDialog advance={applying} onClose={() => setApplying(null)} onDone={async () => { setApplying(null); await reload() }} /> : null}
    {tagging ? <TagAdvanceDialog advance={tagging} orders={(o2c.data?.orders ?? []).filter((o) => o.partyId === tagging.partyId && o.status !== 'CANCELLED')} onClose={() => setTagging(null)} onDone={async () => { setTagging(null); await reload() }} /> : null}
    {reversing ? <ReasonDialog title={`Reverse ${reversing.allocation.invoiceNo} application?`} lines={[`gives ₹ ${money(reversing.allocation.amount)} back to advance ${reversing.advance.payment.paymentNo}`, `re-opens ₹ ${money(reversing.allocation.amount)} outstanding on ${reversing.allocation.invoiceNo}`, 'keeps the application row in history, marked reversed with your reason']} confirm="Reverse application" onClose={() => setReversing(null)} onConfirm={async (reason) => { await apiPost(FA, { action: 'reverse-advance-application', allocationId: reversing.allocation.id, reason }); toast.success('Application reversed'); setReversing(null); await reload() }} /> : null}
    {cancelRefund ? <ReasonDialog title={`Cancel refund ${cancelRefund.payment.paymentNo}?`} lines={[`posts a mirrored ledger reversal of ₹ ${money(cancelRefund.amount)}`, `restores ₹ ${money(cancelRefund.amount)} refundable on ${cancelRefund.returnDocument.adjustmentNo}`, 'keeps the refund in history as cancelled']} confirm="Cancel refund" onClose={() => setCancelRefund(null)} onConfirm={async (reason) => { await apiPost(FA, { action: 'cancel-refund', paymentId: cancelRefund.payment.id, reason }); toast.success('Refund cancelled'); setCancelRefund(null); await reload() }} /> : null}
    {refunding ? <RefundDialog note={refunding} onClose={() => setRefunding(null)} onDone={async () => { setRefunding(null); await reload() }} /> : null}
    {scheduleOpen ? <ScheduleDialog orders={(o2c.data?.orders ?? []).filter((o) => o.status === 'DRAFT' || o.status === 'APPROVED')} onClose={() => setScheduleOpen(false)} onDone={async () => { setScheduleOpen(false); await reload() }} /> : null}
    {printing ? <AcknowledgementDialog refund={printing} onClose={() => setPrinting(null)} /> : null}
  </div>
}

function Section({ icon: Icon, title, children }: { icon: typeof Wallet; title: string; children: React.ReactNode }) {
  return <Card className="p-0"><CardContent className="p-0"><div className="flex items-center gap-2 border-b px-4 py-3"><Icon className="size-4 text-muted-foreground" aria-hidden /><p className="text-sm font-medium">{title}</p></div>{children}</CardContent></Card>
}

function ApplyAdvanceDialog({ advance, onClose, onDone }: { advance: Advance; onClose: () => void; onDone: () => Promise<void> }) {
  const sales = advance.advanceType === 'CUSTOMER'
  const invoices = useApi<OpenInvoice[]>(`/api/${sales ? 'sales' : 'purchase'}-invoices?partyId=${advance.partyId}&status=POSTED`)
  const open = (invoices.data ?? []).filter((i) => i.grandTotal - i.paidAmount > 0.004)
  const [invoiceNo, setInvoiceNo] = useState(''); const [amount, setAmount] = useState(''); const [saving, setSaving] = useState(false)
  const available = r2(advance.originalAmount - advance.appliedAmount)
  const invoice = open.find((i) => i.invoiceNo === invoiceNo)
  const max = invoice ? r2(Math.min(available, invoice.grandTotal - invoice.paidAmount)) : available
  const value = Number(amount)
  const problem = !invoice ? 'Choose an invoice with an outstanding balance' : !(value > 0) ? 'Enter an amount' : value > max + 0.004 ? `At most ₹ ${money(max)} (the smaller of advance available and invoice outstanding)` : ''
  const submit = async () => { setSaving(true); try { await apiPost(FA, { action: 'apply-advance', advanceId: advance.id, invoiceType: sales ? 'SALES' : 'PURCHASE', invoiceNo, amount: value }); toast.success(`₹ ${money(value)} applied to ${invoiceNo}`); await onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>Apply advance {advance.payment.paymentNo}</DialogTitle><DialogDescription>₹ {money(available)} available from {advance.party.name}.</DialogDescription></DialogHeader>
    <div className="space-y-3"><div><Label>Invoice</Label><Select value={invoiceNo} onValueChange={(v) => { setInvoiceNo(v); const inv = open.find((i) => i.invoiceNo === v); if (inv) setAmount(String(r2(Math.min(available, inv.grandTotal - inv.paidAmount)))) }}><SelectTrigger className="h-11"><SelectValue placeholder={invoices.loading ? 'Loading…' : open.length ? 'Select invoice' : 'No open invoices'} /></SelectTrigger><SelectContent>{open.map((i) => <SelectItem key={i.id} value={i.invoiceNo}>{i.invoiceNo} · {dateStr(i.date)} · ₹ {money(r2(i.grandTotal - i.paidAmount))} due</SelectItem>)}</SelectContent></Select></div>
      <div><Label>Amount (max ₹ {money(max)})</Label><Input type="number" inputMode="decimal" min={0} max={max} className="h-11" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      {problem && (invoice || amount) ? <p className="text-sm text-destructive" role="alert">{problem}</p> : null}</div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!!problem || saving} onClick={() => void submit()}>{saving ? 'Applying…' : 'Apply'}</Button></DialogFooter></DialogContent></Dialog>
}

function TagAdvanceDialog({ advance, orders, onClose, onDone }: { advance: Advance; orders: Order[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [orderId, setOrderId] = useState(advance.salesOrder?.id ?? ''); const [saving, setSaving] = useState(false)
  const submit = async (id: string | null) => { setSaving(true); try { await apiPost(FA, { action: 'tag-advance', advanceId: advance.id, salesOrderId: id }); toast.success(id ? 'Advance tagged — milestones updated' : 'Advance untagged'); await onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>Tag advance to a sales order</DialogTitle><DialogDescription>The unapplied part counts toward that order&apos;s payment milestones until it is applied to an invoice.</DialogDescription></DialogHeader>
    <Select value={orderId} onValueChange={setOrderId}><SelectTrigger className="h-11"><SelectValue placeholder={orders.length ? 'Select order' : `No open orders for ${advance.party.name}`} /></SelectTrigger><SelectContent>{orders.map((o) => <SelectItem key={o.id} value={o.id}>{o.orderNo} · ₹ {money(o.grandTotal)}</SelectItem>)}</SelectContent></Select>
    <DialogFooter>{advance.salesOrder ? <Button variant="outline" disabled={saving} onClick={() => void submit(null)}>Untag</Button> : null}<Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!orderId || saving} onClick={() => void submit(orderId)}>Tag</Button></DialogFooter></DialogContent></Dialog>
}

function ScheduleDialog({ orders, onClose, onDone }: { orders: Order[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [orderId, setOrderId] = useState(''); const [rows, setRows] = useState([{ milestone: 'Advance', dueDate: '', amount: '' }, { milestone: 'Balance', dueDate: '', amount: '' }]); const [saving, setSaving] = useState(false)
  const order = orders.find((o) => o.id === orderId)
  const total = r2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))
  const names = rows.map((r) => r.milestone.trim().toLowerCase())
  const problem = !order ? 'Choose a draft or approved sales order' : rows.some((r) => !r.milestone.trim() || !r.dueDate || !(Number(r.amount) > 0)) ? 'Every milestone needs a name, due date and positive amount' : new Set(names).size !== names.length ? 'Milestone names must be unique' : Math.abs(total - order.grandTotal) > 0.01 ? `Milestones total ₹ ${money(total)}; the order is ₹ ${money(order.grandTotal)} (${total < order.grandTotal ? 'short' : 'over'} by ₹ ${money(Math.abs(r2(order.grandTotal - total)))})` : ''
  const submit = async () => { setSaving(true); try { await apiPost(FA, { action: 'set-schedule', salesOrderId: orderId, rows: rows.map((r) => ({ milestone: r.milestone.trim(), dueDate: r.dueDate, amount: Number(r.amount) })) }); toast.success('Payment schedule saved'); await onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Payment schedule</DialogTitle><DialogDescription>Milestones must add up to the order total. Collections settle them oldest-due first.</DialogDescription></DialogHeader>
    <div className="space-y-3"><Select value={orderId} onValueChange={(v) => { setOrderId(v); const o = orders.find((x) => x.id === v); if (o) { const a = r2(o.grandTotal * 0.3); setRows([{ milestone: 'Advance', dueDate: new Date().toISOString().slice(0, 10), amount: String(a) }, { milestone: 'Balance', dueDate: '', amount: String(r2(o.grandTotal - a)) }]) } }}><SelectTrigger className="h-11"><SelectValue placeholder={orders.length ? 'Select sales order' : 'No draft/approved orders'} /></SelectTrigger><SelectContent>{orders.map((o) => <SelectItem key={o.id} value={o.id}>{o.orderNo} · {o.party.name} · ₹ {money(o.grandTotal)}</SelectItem>)}</SelectContent></Select>
      {rows.map((row, idx) => <div key={idx} className="grid grid-cols-[1fr_9rem_8rem_auto] gap-2"><Input className="h-11" aria-label="Milestone" value={row.milestone} onChange={(e) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, milestone: e.target.value } : r)))} /><Input type="date" className="h-11" aria-label="Due date" value={row.dueDate} onChange={(e) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, dueDate: e.target.value } : r)))} /><Input type="number" min={0} className="h-11" aria-label="Amount" value={row.amount} onChange={(e) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, amount: e.target.value } : r)))} /><Button type="button" variant="ghost" className="size-11" aria-label="Remove milestone" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}><XCircle className="size-4" aria-hidden /></Button></div>)}
      <Button type="button" variant="outline" className="h-11 gap-1" onClick={() => setRows((rs) => [...rs, { milestone: '', dueDate: '', amount: '' }])}><Plus className="size-4" aria-hidden />Add milestone</Button>
      <p className="text-sm">Total ₹ {money(total)}{order ? ` of ₹ ${money(order.grandTotal)}` : ''}</p>
      {problem && order ? <p className="text-sm text-destructive" role="alert">{problem}</p> : null}</div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!!problem || saving} onClick={() => void submit()}>{saving ? 'Saving…' : 'Save schedule'}</Button></DialogFooter></DialogContent></Dialog>
}

function RefundDialog({ note, onClose, onDone }: { note: ReturnDoc; onClose: () => void; onDone: () => Promise<void> }) {
  const max = r2(note.grandTotal - note.refundedAmount)
  const [amount, setAmount] = useState(String(max)); const [mode, setMode] = useState('BANK'); const [refNo, setRefNo] = useState(''); const [saving, setSaving] = useState(false)
  const value = Number(amount); const customer = note.returnType === 'SALES_RETURN'
  const problem = !(value > 0) ? 'Enter an amount' : value > max + 0.004 ? `At most ₹ ${money(max)} is refundable` : ''
  const submit = async () => { setSaving(true); try { await apiPost(FA, { action: 'refund-return', returnDocumentId: note.id, amount: value, mode, refNo: refNo || undefined }); toast.success(`Refund of ₹ ${money(value)} posted`); await onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>{customer ? 'Refund customer' : 'Record supplier refund'} — {note.adjustmentNo}</DialogTitle><DialogDescription>{customer ? `Pays ₹ ${money(value || 0)} to ${note.party.name}: Dr customer, Cr ${mode === 'CASH' ? 'cash' : 'bank'}.` : `Receives ₹ ${money(value || 0)} from ${note.party.name}: Dr ${mode === 'CASH' ? 'cash' : 'bank'}, Cr supplier.`}</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-3"><div><Label>Amount (max ₹ {money(max)})</Label><Input type="number" min={0} max={max} className="h-11" value={amount} onChange={(e) => setAmount(e.target.value)} /></div><div><Label>Mode</Label><Select value={mode} onValueChange={setMode}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{['CASH', 'BANK', 'UPI', 'CHEQUE'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div><div><Label>Reference</Label><Input className="h-11" value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="UTR / cheque no." /></div></div>
    {problem ? <p className="text-sm text-destructive" role="alert">{problem}</p> : null}
    <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!!problem || saving} onClick={() => void submit()}>{saving ? 'Posting…' : 'Post refund'}</Button></DialogFooter></DialogContent></Dialog>
}

function ReasonDialog({ title, lines, confirm, onClose, onConfirm }: { title: string; lines: string[]; confirm: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(''); const [saving, setSaving] = useState(false)
  const run = async () => { setSaving(true); try { await onConfirm(reason.trim()) } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>This:</DialogDescription></DialogHeader>
    <ul className="list-disc space-y-1 pl-5 text-sm">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    <div><Label>Reason (required)</Label><Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. applied to the wrong invoice" /></div>
    <DialogFooter><Button variant="outline" onClick={onClose}>Keep</Button><Button variant="destructive" disabled={!reason.trim() || saving} onClick={() => void run()}>{saving ? 'Working…' : confirm}</Button></DialogFooter></DialogContent></Dialog>
}

function AcknowledgementDialog({ refund, onClose }: { refund: Refund; onClose: () => void }) {
  const company = useApi<{ name: string; gstin: string | null; address: string | null; city: string | null }>('/api/masters/company')
  const parties = useApi<{ id: string; name: string; gstin: string | null }[]>('/api/masters/parties')
  const party = { data: parties.data?.find((p) => p.id === refund.payment.partyId) ?? null }
  const customer = refund.returnDocument.returnType === 'SALES_RETURN'
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="sm:max-w-xl"><DialogHeader className="print:hidden"><DialogTitle>Refund acknowledgement</DialogTitle><DialogDescription>Print or save as PDF.</DialogDescription></DialogHeader>
    <div id="refund-ack" className="space-y-3 rounded-md border p-5 text-sm print:border-0">
      <div className="flex justify-between gap-4"><div><p className="text-base font-semibold">{company.data?.name ?? ''}</p><p className="text-xs text-muted-foreground">{[company.data?.address, company.data?.city].filter(Boolean).join(', ')}</p>{company.data?.gstin ? <p className="text-xs">GSTIN {company.data.gstin}</p> : null}</div><div className="text-right"><p className="font-semibold">REFUND {customer ? 'VOUCHER' : 'RECEIPT'}</p><p>{refund.payment.paymentNo}</p><p>{dateStr(refund.payment.date)}</p></div></div>
      <p>{customer ? 'Paid to' : 'Received from'} <strong>{party.data?.name ?? ''}</strong>{party.data?.gstin ? ` (GSTIN ${party.data.gstin})` : ''} the sum of <strong>₹ {money(refund.amount)}</strong> by {refund.payment.mode} against {customer ? 'credit note' : 'debit note'} <strong>{refund.returnDocument.adjustmentNo}</strong>.</p>
      {refund.payment.status === 'CANCELLED' ? <p className="font-semibold text-destructive">CANCELLED</p> : null}
      <div className="grid grid-cols-2 gap-8 pt-10 text-xs"><p className="border-t pt-1">Prepared by</p><p className="border-t pt-1 text-right">{customer ? 'Receiver\'s signature' : 'Authorised signatory'}</p></div>
    </div>
    <DialogFooter className="print:hidden"><Button variant="outline" onClick={onClose}>Close</Button><Button className="gap-2" onClick={() => window.print()}><Printer className="size-4" aria-hidden />Print / PDF</Button></DialogFooter></DialogContent></Dialog>
}

