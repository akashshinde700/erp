'use client'

/**
 * Finished-goods receipt workspace: which work orders can receive FG / close,
 * a guided 4-step receipt (output → quantities & QC → batch / serials /
 * parent lots → review with server-side cost and WIP preview), receipt
 * history and cancellation with the real stock and GL impact spelled out.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Factory, PackageCheck, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { apiGet, apiPost, toastError, useApi, useMasters } from './api'
import { EmptyState, HumanStatus, Money, TableSkeleton } from './bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { dateStr, qty as qtyFmt } from '@/lib/erp'

type Readiness = { id: string; woNo: string; project: { projectNo: string; name: string } | null; status: string; planned: number; produced: number; accepted: number; actualCost: number; settled: number; readyToReceive: boolean; readyToClose: boolean; blockers: string[] }
type Receipt = { id: string; receiptNo: string; date: string; status: string; qcStatus: string; batchNo: string | null; producedQty: number; acceptedQty: number; rejectedQty: number; reworkQty: number; scrapQty: number; expectedCost: number; actualCost: number; variance: number; workOrder: { woNo: string }; outputItem: { code: string; name: string; uom: string }; warehouse: { code: string; name: string } }
type Preview = { woNo: string; planned: number; alreadyAccepted: number; alreadyProduced: number; actualTotal: number; priorSettled: number; remainingActual: number; actualCost: number; expectedCost: number; variance: number; wipAfter: number; warnings: string[]; closesWorkOrder: boolean }
type Lot = { id: string; lotNo: string; status: string; balance: number; expired: boolean; item: { code: string; name: string; uom: string } }

const STEPS = ['Output', 'Quantities & QC', 'Batch & serials', 'Review & post'] as const
const n = (v: string) => (v.trim() === '' ? 0 : Number(v))

export function ProductionReceiptsWorkspace() {
  const readiness = useApi<Readiness[]>('/api/manufacturing/receipts?readiness=1')
  const receipts = useApi<Receipt[]>('/api/manufacturing/receipts')
  const [wizardFor, setWizardFor] = useState<Readiness | null>(null)
  const [cancelling, setCancelling] = useState<Receipt | null>(null)
  const [closing, setClosing] = useState<Readiness | null>(null)
  const [busy, setBusy] = useState(false)
  const reloadAll = async () => { await Promise.all([readiness.reload(), receipts.reload()]) }

  const cancelReceipt = async () => {
    if (!cancelling) return
    setBusy(true)
    try { await apiPost('/api/manufacturing/receipts', { action: 'cancel', id: cancelling.id }); toast.success(`${cancelling.receiptNo} cancelled`, { description: 'Stock, batch and GL reversed; history kept.' }); setCancelling(null); await reloadAll() }
    catch (error) { toastError(error) } finally { setBusy(false) }
  }
  const closeWorkOrder = async () => {
    if (!closing) return
    setBusy(true)
    try { await apiPost(`/api/manufacturing/work-orders/${closing.id}/actions`, { action: 'complete' }); toast.success(`${closing.woNo} closed`); setClosing(null); await reloadAll() }
    catch (error) { toastError(error) } finally { setBusy(false) }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-muted-foreground">Receive QC-accepted finished goods against completed work orders. WIP settles into stock; the cost of rejected output goes to manufacturing variance.</p>
      <Button variant="outline" className="ml-auto h-11 gap-2" onClick={() => void reloadAll()}><RefreshCw className="size-4" aria-hidden />Refresh</Button>
    </div>

    <Card className="p-0"><CardContent className="p-0">
      <div className="flex items-center gap-2 border-b px-4 py-3"><Factory className="size-4 text-muted-foreground" aria-hidden /><p className="text-sm font-medium">Work orders — receipt and closure readiness</p></div>
      {readiness.loading ? <TableSkeleton rows={4} cols={6} /> : !readiness.data?.length ? <div className="p-6"><EmptyState icon={Factory} title="No active work orders" hint="Create a work order from an approved BOM; once its operations are completed you can receive finished goods here." /></div> :
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Work order</TableHead><TableHead className="text-right">Planned</TableHead><TableHead className="text-right">Produced / accepted</TableHead><TableHead className="text-right">WIP cost / settled</TableHead><TableHead>Next action</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
          {readiness.data.map((wo) => <TableRow key={wo.id}>
            <TableCell className="font-medium">{wo.woNo}<p className="text-xs text-muted-foreground">{wo.project ? `${wo.project.projectNo} · ${wo.project.name}` : '—'}</p></TableCell>
            <TableCell className="text-right tabular-nums">{qtyFmt(wo.planned)}</TableCell>
            <TableCell className="text-right tabular-nums">{qtyFmt(wo.produced)} / {qtyFmt(wo.accepted)}</TableCell>
            <TableCell className="text-right"><Money value={wo.actualCost} /><p className="text-xs text-muted-foreground"><Money value={wo.settled} plain /> settled</p></TableCell>
            <TableCell>{wo.readyToClose ? <HumanStatus status="COMPLETED" detail="Ready to close" /> : wo.readyToReceive ? <HumanStatus status="PENDING" detail={wo.blockers.join(' · ')} /> : <HumanStatus status="IN_PROGRESS" detail={wo.blockers.join(' · ')} />}</TableCell>
            <TableCell className="text-right"><div className="flex flex-wrap justify-end gap-2">
              <Button className="h-11 gap-2 sm:h-9" disabled={!wo.readyToReceive} title={wo.readyToReceive ? 'Record a finished-goods receipt' : wo.blockers.join('; ')} onClick={() => setWizardFor(wo)}><PackageCheck className="size-4" aria-hidden />Receive FG</Button>
              <Button variant="outline" className="h-11 gap-2 sm:h-9" disabled={!wo.readyToClose} title={wo.readyToClose ? 'Close this work order' : wo.blockers.join('; ')} onClick={() => setClosing(wo)}><CheckCircle2 className="size-4" aria-hidden />Close WO</Button>
            </div></TableCell>
          </TableRow>)}
        </TableBody></Table></div>}
    </CardContent></Card>

    <Card className="p-0"><CardContent className="p-0">
      <div className="flex items-center gap-2 border-b px-4 py-3"><ClipboardCheck className="size-4 text-muted-foreground" aria-hidden /><p className="text-sm font-medium">Receipt history</p></div>
      {receipts.loading ? <TableSkeleton rows={4} cols={7} /> : !receipts.data?.length ? <div className="p-6"><EmptyState icon={PackageCheck} title="No finished-goods receipts yet" hint="Use Receive FG on a work order whose operations are complete." /></div> :
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Item / batch</TableHead><TableHead className="text-right">Produced</TableHead><TableHead className="text-right">Accepted / rejected / rework / scrap</TableHead><TableHead className="text-right">Expected / actual</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>
          {receipts.data.map((r) => <TableRow key={r.id}>
            <TableCell className="font-medium">{r.receiptNo}<p className="text-xs text-muted-foreground">{dateStr(r.date)} · {r.workOrder.woNo}</p></TableCell>
            <TableCell>{r.outputItem.code}<p className="text-xs text-muted-foreground">{r.batchNo ? `Batch ${r.batchNo}` : 'No batch'} · {r.warehouse.code}</p></TableCell>
            <TableCell className="text-right tabular-nums">{qtyFmt(r.producedQty)} {r.outputItem.uom}</TableCell>
            <TableCell className="text-right tabular-nums">{qtyFmt(r.acceptedQty)} / {qtyFmt(r.rejectedQty)} / {qtyFmt(r.reworkQty)} / {qtyFmt(r.scrapQty)}</TableCell>
            <TableCell className="text-right"><Money value={r.expectedCost} /><p className={r.variance > 0.004 ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}><Money value={r.actualCost} plain /> actual · variance <Money value={r.variance} plain /></p></TableCell>
            <TableCell><HumanStatus status={r.status === 'POSTED' ? (r.qcStatus === 'PASSED' ? 'POSTED' : 'PARTIAL') : r.status} detail={r.status === 'POSTED' && r.qcStatus !== 'PASSED' ? 'Posted with QC rejections' : undefined} /></TableCell>
            <TableCell className="text-right">{r.status === 'POSTED' ? <Button variant="outline" className="h-11 gap-2 sm:h-9" onClick={() => setCancelling(r)}><Trash2 className="size-4" aria-hidden />Cancel</Button> : null}</TableCell>
          </TableRow>)}
        </TableBody></Table></div>}
    </CardContent></Card>

    {wizardFor ? <ReceiptWizard wo={wizardFor} onClose={() => setWizardFor(null)} onPosted={async () => { setWizardFor(null); await reloadAll() }} /> : null}

    <Dialog open={!!cancelling} onOpenChange={(open) => { if (!open) setCancelling(null) }}>
      <DialogContent><DialogHeader><DialogTitle>Cancel {cancelling?.receiptNo}?</DialogTitle><DialogDescription>This cannot be undone, but nothing is deleted — reversal entries keep the full history.</DialogDescription></DialogHeader>
        {cancelling ? <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>takes {qtyFmt(cancelling.acceptedQty)} {cancelling.outputItem.uom} of {cancelling.outputItem.code} back out of {cancelling.warehouse.code}</li>
          <li>reverses <Money value={cancelling.expectedCost} /> finished-goods stock value and <Money value={cancelling.actualCost} /> WIP settlement in the ledger</li>
          {cancelling.batchNo ? <li>reverses the receipt of batch {cancelling.batchNo} (and voids its serial numbers)</li> : null}
          <li>is refused if those finished goods were already sold or consumed</li>
        </ul> : null}
        <DialogFooter><Button variant="outline" onClick={() => setCancelling(null)}>Keep receipt</Button><Button variant="destructive" disabled={busy} onClick={() => void cancelReceipt()}>{busy ? 'Reversing…' : 'Cancel receipt'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!closing} onOpenChange={(open) => { if (!open) setClosing(null) }}>
      <DialogContent><DialogHeader><DialogTitle>Close {closing?.woNo}?</DialogTitle><DialogDescription>All operations are complete, {closing ? qtyFmt(closing.accepted) : ''} units were QC-accepted and WIP is fully settled.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setClosing(null)}>Not yet</Button><Button disabled={busy} onClick={() => void closeWorkOrder()}>{busy ? 'Closing…' : 'Close work order'}</Button></DialogFooter></DialogContent>
    </Dialog>
  </div>
}

function ReceiptWizard({ wo, onClose, onPosted }: { wo: Readiness; onClose: () => void; onPosted: () => Promise<void> }) {
  const { items, warehouses } = useMasters()
  const lots = useApi<Lot[]>('/api/traceability')
  const [step, setStep] = useState(0)
  const [itemId, setItemId] = useState(''); const [warehouseId, setWarehouseId] = useState('')
  const [produced, setProduced] = useState(String(Math.max(0, wo.planned - wo.produced) || '')); const [accepted, setAccepted] = useState(''); const [rejected, setRejected] = useState(''); const [rework, setRework] = useState(''); const [scrap, setScrap] = useState(''); const [qcNotes, setQcNotes] = useState('')
  const [batchNo, setBatchNo] = useState(''); const [mfgDate, setMfgDate] = useState(new Date().toISOString().slice(0, 10)); const [expiry, setExpiry] = useState(''); const [serialText, setSerialText] = useState('')
  const [parents, setParents] = useState<{ lotId: string; qty: string }[]>([])
  const [preview, setPreview] = useState<Preview | null>(null); const [saving, setSaving] = useState(false)
  const fgItems = items.filter((i) => i.isStockItem && !i.isService)
  const serials = useMemo(() => serialText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean), [serialText])
  const nonAccepted = n(rejected) + n(rework) + n(scrap)
  const issuableLots = (lots.data ?? []).filter((l) => l.status === 'AVAILABLE' && !l.expired && l.balance > 0)

  // Each step states exactly why it cannot continue (no surprise errors at Post).
  const problems = [
    [!itemId && 'Choose the finished-goods item', !warehouseId && 'Choose the receiving warehouse'],
    [!(n(produced) > 0) && 'Produced quantity must be positive', !(n(accepted) > 0) && 'At least one unit must pass QC', [produced, accepted, rejected, rework, scrap].some((v) => n(v) < 0 || Number.isNaN(n(v))) && 'Quantities cannot be negative',
      Math.abs(n(accepted) + nonAccepted - n(produced)) > 0.0001 && `Accepted + rejected + rework + scrap must equal produced (${n(produced)}); now ${n(accepted) + nonAccepted}`,
      nonAccepted > 0 && !qcNotes.trim() && 'QC notes are required for rejected, rework or scrap quantity'],
    [serials.length > 0 && !batchNo.trim() && 'Serialised goods need a batch number', serials.length > 0 && serials.length !== n(accepted) && `Enter exactly ${n(accepted)} serial numbers (now ${serials.length})`,
      new Set(serials).size !== serials.length && 'Serial numbers must be unique', !!expiry && !!mfgDate && expiry <= mfgDate && 'Expiry must be after the manufacture date',
      parents.some((p) => !p.lotId || !(n(p.qty) > 0)) && 'Each parent lot needs a lot and a positive consumed quantity', parents.length > 0 && !batchNo.trim() && 'Parent lots link to a batch — enter the batch number'],
    [],
  ].map((list) => list.filter(Boolean) as string[])

  const goTo = async (next: number) => {
    if (next === 3) {
      try { setPreview(await apiGet<Preview>(`/api/manufacturing/receipts?preview=1&workOrderId=${wo.id}&producedQty=${n(produced)}&acceptedQty=${n(accepted)}`)) }
      catch (error) { toastError(error); return }
    }
    setStep(next)
  }
  const post = async () => {
    setSaving(true)
    try {
      const res = await apiPost<{ receiptNo: string }>('/api/manufacturing/receipts', {
        workOrderId: wo.id, outputItemId: itemId, warehouseId, producedQty: n(produced), acceptedQty: n(accepted), rejectedQty: n(rejected), reworkQty: n(rework), scrapQty: n(scrap),
        qcNotes: qcNotes.trim() || undefined, batchNo: batchNo.trim() || undefined, manufacturedAt: mfgDate || undefined, expiryDate: expiry || undefined,
        serialNumbers: serials.length ? serials : undefined, parentLots: parents.length ? parents.map((p) => ({ parentLotId: p.lotId, consumedQty: n(p.qty) })) : undefined,
      })
      toast.success(`${res.receiptNo} posted`, { description: preview?.closesWorkOrder ? `${wo.woNo} can now be closed.` : 'Stock and WIP updated.' })
      await onPosted()
    } catch (error) { toastError(error) } finally { setSaving(false) }
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Receive finished goods — {wo.woNo}</DialogTitle><DialogDescription>Step {step + 1} of {STEPS.length}: {STEPS[step]}</DialogDescription></DialogHeader>
      <ol className="flex flex-wrap gap-1 text-xs" aria-label="Receipt steps">{STEPS.map((label, i) => <li key={label} className={`rounded-md border px-2 py-1 ${i === step ? 'border-primary bg-primary/10 font-medium' : i < step ? 'text-muted-foreground' : 'text-muted-foreground/70'}`} aria-current={i === step ? 'step' : undefined}>{i + 1}. {label}</li>)}</ol>

      {step === 0 ? <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label>Finished-goods item</Label><Select value={itemId} onValueChange={setItemId}><SelectTrigger className="h-11"><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{fgItems.map((i) => <SelectItem key={i.id} value={i.id}>{i.code} · {i.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="sm:col-span-2"><Label>Receiving warehouse</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger className="h-11"><SelectValue placeholder="Select warehouse" /></SelectTrigger><SelectContent>{warehouses.filter((w) => w.active !== false).map((w) => <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent></Select></div>
        <p className="text-xs text-muted-foreground sm:col-span-2">Planned {qtyFmt(wo.planned)} · already produced {qtyFmt(wo.produced)} · already accepted {qtyFmt(wo.accepted)}</p>
      </div> : null}

      {step === 1 ? <div className="grid gap-3 sm:grid-cols-5">
        {([['Produced', produced, setProduced], ['Accepted', accepted, setAccepted], ['Rejected', rejected, setRejected], ['Rework', rework, setRework], ['Scrap', scrap, setScrap]] as const).map(([label, value, set]) => <div key={label}><Label>{label}</Label><Input type="number" inputMode="decimal" min={0} className="h-11" value={value} onChange={(e) => set(e.target.value)} /></div>)}
        {nonAccepted > 0 ? <div className="sm:col-span-5"><Label>QC notes (why {nonAccepted} not accepted) *</Label><Textarea value={qcNotes} onChange={(e) => setQcNotes(e.target.value)} placeholder="e.g. weld porosity on 2 units, 1 sent for rework" /></div> : null}
      </div> : null}

      {step === 2 ? <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label>Batch / lot no.</Label><Input className="h-11" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="Optional unless serialised" /></div>
          <div><Label>Manufactured on</Label><Input type="date" className="h-11" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} /></div>
          <div><Label>Expiry (optional)</Label><Input type="date" className="h-11" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></div>
        </div>
        <div><Label>Serial numbers (optional — one per line, exactly {n(accepted) || 'accepted qty'})</Label><Textarea rows={4} value={serialText} onChange={(e) => setSerialText(e.target.value)} placeholder={'PMP-0001\nPMP-0002'} /><p className="mt-1 text-xs text-muted-foreground">{serials.length} entered</p></div>
        <div className="space-y-2"><div className="flex items-center justify-between"><Label>Parent lots consumed (genealogy)</Label><Button type="button" variant="outline" className="h-9 gap-1" onClick={() => setParents((rows) => [...rows, { lotId: '', qty: '' }])} disabled={!issuableLots.length}><Plus className="size-4" aria-hidden />Add lot</Button></div>
          {!issuableLots.length ? <p className="text-xs text-muted-foreground">No available lots to link.</p> : null}
          {parents.map((p, idx) => <div key={idx} className="grid grid-cols-[1fr_7rem_auto] gap-2">
            <Select value={p.lotId} onValueChange={(v) => setParents((rows) => rows.map((r, i) => (i === idx ? { ...r, lotId: v } : r)))}><SelectTrigger className="h-11"><SelectValue placeholder="Lot" /></SelectTrigger><SelectContent>{issuableLots.map((l) => <SelectItem key={l.id} value={l.id}>{l.lotNo} · {l.item.code} · {qtyFmt(l.balance)} {l.item.uom}</SelectItem>)}</SelectContent></Select>
            <Input type="number" min={0} className="h-11" placeholder="Qty" value={p.qty} onChange={(e) => setParents((rows) => rows.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r)))} />
            <Button type="button" variant="ghost" className="size-11" aria-label="Remove parent lot" onClick={() => setParents((rows) => rows.filter((_, i) => i !== idx))}><XCircle className="size-4" aria-hidden /></Button>
          </div>)}
        </div>
      </div> : null}

      {step === 3 && preview ? <div className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <Card className="p-3"><p className="text-xs text-muted-foreground">Into stock</p><p className="font-medium">{n(accepted)} units at BOM standard</p><Money value={preview.expectedCost} /></Card>
          <Card className="p-3"><p className="text-xs text-muted-foreground">WIP settled by this receipt</p><p className="font-medium"><Money value={preview.actualCost} /></p><p className="text-xs text-muted-foreground">WIP left after: <Money value={preview.wipAfter} plain /></p></Card>
          <Card className="p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Manufacturing variance (actual − expected)</p><p className={preview.variance > 0.004 ? 'font-medium text-destructive' : 'font-medium'}><Money value={preview.variance} /></p>{nonAccepted > 0 ? <p className="text-xs text-muted-foreground">Includes the cost of {nonAccepted} non-accepted unit(s).</p> : null}</Card>
        </div>
        {preview.warnings.length ? <ul className="list-disc space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 pl-6 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
        {preview.closesWorkOrder ? <Badge className="gap-1"><CheckCircle2 className="size-3.5" aria-hidden />After posting, {wo.woNo} can be closed</Badge> : null}
      </div> : null}

      {problems[step]?.length ? <ul className="space-y-1 text-sm text-destructive" role="alert">{problems[step].map((p) => <li key={p}>• {p}</li>)}</ul> : null}
      <DialogFooter className="gap-2">
        {step > 0 ? <Button variant="outline" className="h-11 gap-1" onClick={() => setStep(step - 1)}><ChevronLeft className="size-4" aria-hidden />Back</Button> : <Button variant="outline" className="h-11" onClick={onClose}>Cancel</Button>}
        {step < 3 ? <Button className="h-11 gap-1" disabled={problems[step].length > 0} onClick={() => void goTo(step + 1)}>Next<ChevronRight className="size-4" aria-hidden /></Button>
          : <Button className="h-11" disabled={saving || !preview} onClick={() => void post()}>{saving ? 'Posting stock and GL…' : 'Post receipt'}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
