'use client'

/**
 * Inventory → Adjustments: request with a reason code → approval by another
 * user (or the OWNER) → stock + GL posting. Shows the stock and value effect
 * before anything posts.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ClipboardCheck, Plus, Scale, Trash2 } from 'lucide-react'
import { apiPost, toastError, todayISO, useApi, useMasters, type StockSummaryRow } from './api'
import { EmptyState, HumanStatus, Money, TableSkeleton } from './bits'
import { ReasonDialog } from './reason-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateStr, money, qty as qtyFmt } from '@/lib/erp'

const REASONS: { code: string; label: string; dir: 'both' | 'down' | 'up' }[] = [
  { code: 'PHYSICAL_COUNT', label: 'Physical count difference', dir: 'both' },
  { code: 'DAMAGE', label: 'Damaged', dir: 'down' },
  { code: 'EXPIRY', label: 'Expired', dir: 'down' },
  { code: 'THEFT_LOSS', label: 'Theft / loss', dir: 'down' },
  { code: 'SCRAP', label: 'Scrapped', dir: 'down' },
  { code: 'FOUND', label: 'Found (excess)', dir: 'up' },
  { code: 'OTHER', label: 'Other (explain)', dir: 'both' },
]
const reasonLabel = (c: string) => REASONS.find((r) => r.code === c)?.label ?? c

type Adj = {
  id: string; adjNo: string; date: string; reasonCode: string; notes: string | null; status: string; value: number; requestedBy: string | null; decidedBy: string | null; decisionNote: string | null; cancelReason: string | null
  warehouse: { code: string; name: string }; lines: { id: string; qtyChange: number; rate: number; value: number; item: { code: string; name: string; uom: string } }[]
}
type Dash = { adjustments: Adj[]; pending: number; byReason: { reason: string; count: number; value: number }[] }
const A = '/api/stock-adjustments'

export function StockAdjustmentsTab() {
  const dash = useApi<Dash>(A)
  const [open, setOpen] = useState(false)
  const [deciding, setDeciding] = useState<{ adj: Adj; kind: 'approve' | 'reject' | 'cancel' } | null>(null)
  if (dash.loading) return <TableSkeleton rows={5} cols={5} />
  const rows = dash.data?.adjustments ?? []
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><Button className="h-11 gap-2" onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden />Request adjustment</Button>
      {dash.data?.pending ? <span className="text-sm text-amber-700 dark:text-amber-400">{dash.data.pending} waiting for approval</span> : null}</div>
    {!rows.length ? <EmptyState icon={Scale} title="No stock adjustments" hint="Record count differences, damage, expiry or scrap. Nothing changes in stock until another user (or the OWNER) approves it." /> :
      <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Adjustment</TableHead><TableHead>Items</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>
        {rows.map((a) => <TableRow key={a.id}>
          <TableCell className="align-top font-medium">{a.adjNo}<p className="text-xs text-muted-foreground">{dateStr(a.date)} · {a.warehouse.code} · {reasonLabel(a.reasonCode)}</p>{a.notes ? <p className="max-w-xs text-xs text-muted-foreground">{a.notes}</p> : null}<p className="text-xs text-muted-foreground">by {a.requestedBy ?? 'setup'}</p></TableCell>
          <TableCell className="align-top text-sm">{a.lines.map((l) => <p key={l.id}><span className={l.qtyChange < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'}>{l.qtyChange > 0 ? '+' : ''}{qtyFmt(l.qtyChange)} {l.item.uom}</span> {l.item.code} {l.item.name}</p>)}</TableCell>
          <TableCell className="text-right align-top">{a.status === 'APPROVED' || a.status === 'CANCELLED' ? <Money value={a.value} /> : <span className="text-xs text-muted-foreground">valued on approval</span>}</TableCell>
          <TableCell className="align-top"><HumanStatus status={a.status} detail={a.status === 'PENDING' ? 'Another user or the OWNER approves' : a.decidedBy ? `${a.decidedBy}${a.decisionNote ? `: ${a.decisionNote}` : ''}${a.cancelReason ? ` · ${a.cancelReason}` : ''}` : undefined} /></TableCell>
          <TableCell className="space-x-2 whitespace-nowrap text-right align-top">
            {a.status === 'PENDING' ? <><Button className="h-11" onClick={() => setDeciding({ adj: a, kind: 'approve' })}>Approve</Button><Button variant="outline" className="h-11" onClick={() => setDeciding({ adj: a, kind: 'reject' })}>Reject</Button></> : null}
            {a.status === 'PENDING' || a.status === 'APPROVED' ? <Button variant="ghost" className="h-11" onClick={() => setDeciding({ adj: a, kind: 'cancel' })}>Cancel</Button> : null}
          </TableCell>
        </TableRow>)}
      </TableBody></Table></div></CardContent></Card>}
    {dash.data?.byReason.length ? <p className="text-sm text-muted-foreground">Approved so far: {dash.data.byReason.map((r) => `${reasonLabel(r.reason)} ${r.count} (₹ ${money(r.value)})`).join(' · ')}</p> : null}
    {open ? <RequestDialog onClose={() => setOpen(false)} onDone={() => { setOpen(false); dash.reload() }} /> : null}
    {deciding ? <ReasonDialog
      title={`${deciding.kind === 'approve' ? 'Approve' : deciding.kind === 'reject' ? 'Reject' : 'Cancel'} ${deciding.adj.adjNo}?`}
      lines={deciding.kind === 'approve' ? [...deciding.adj.lines.map((l) => `${l.item.code}: ${l.qtyChange > 0 ? 'add' : 'remove'} ${qtyFmt(Math.abs(l.qtyChange))} ${l.item.uom} in ${deciding.adj.warehouse.code}`), 'decreases are valued at weighted-average cost and post Dr Stock Adjustment / Cr Stock; increases the reverse', 'refused if stock would go negative']
        : deciding.kind === 'reject' ? ['nothing posts; the request is closed as rejected'] : deciding.adj.status === 'APPROVED' ? ['posts mirrored stock and GL reversals dated today', 'refused if added stock was already used, or the period is closed'] : ['withdraws the request; nothing was posted']}
      confirm={deciding.kind === 'approve' ? 'Approve and post' : deciding.kind === 'reject' ? 'Reject' : 'Cancel adjustment'}
      optional={deciding.kind === 'approve'} destructive={deciding.kind !== 'approve'}
      placeholder={deciding.kind === 'approve' ? 'e.g. verified with store keeper' : 'Why?'}
      onClose={() => setDeciding(null)}
      onConfirm={async (reason) => {
        const { adj, kind } = deciding
        await apiPost(A, { action: kind, id: adj.id, ...(kind === 'cancel' ? { reason } : { note: reason || undefined }) })
        toast.success(`${adj.adjNo} ${kind === 'approve' ? 'approved and posted' : kind === 'reject' ? 'rejected' : 'cancelled'}`)
        setDeciding(null); dash.reload()
      }} /> : null}
  </div>
}

type Line = { itemId: string; qtyChange: string; rate: string }

function RequestDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { items, warehouses } = useMasters()
  const stock = useApi<StockSummaryRow[]>('/api/reports?type=stock-summary')
  const [date, setDate] = useState(todayISO())
  const [warehouseId, setWarehouseId] = useState('')
  const [reason, setReason] = useState('PHYSICAL_COUNT')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([{ itemId: '', qtyChange: '', rate: '' }])
  const [saving, setSaving] = useState(false)
  const dir = REASONS.find((r) => r.code === reason)?.dir ?? 'both'
  const stockItems = items.filter((i) => !i.isService && i.isStockItem !== false)
  const whCode = warehouses.find((w) => w.id === warehouseId)?.code
  /** On-hand in the chosen warehouse; null when the stock summary is unavailable (the server still checks). */
  const onHand = (itemId: string): number | null => {
    if (!stock.data) return null
    const row = stock.data.find((s) => s.item.id === itemId)
    if (!row) return 0
    return whCode ? row.warehouses?.find((w) => w.code === whCode)?.closing ?? 0 : row.closing
  }
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)))
  const problems = useMemo(() => {
    const p: string[] = []
    if (!warehouseId) p.push('Choose the warehouse')
    if (reason === 'OTHER' && !notes.trim()) p.push('Explain the adjustment')
    lines.forEach((l, i) => {
      const q = Number(l.qtyChange)
      if (!l.itemId) p.push(`Line ${i + 1}: choose an item`)
      if (!q) p.push(`Line ${i + 1}: enter the change (e.g. -5 or 3)`)
      if (dir === 'down' && q > 0) p.push(`Line ${i + 1}: this reason can only reduce stock (use a negative number)`)
      if (dir === 'up' && q < 0) p.push(`Line ${i + 1}: FOUND can only add stock`)
      const have = l.itemId ? onHand(l.itemId) : null
      if (have !== null && q < 0 && have + q < -1e-9) p.push(`Line ${i + 1}: only ${have} on hand`)
    })
    if (new Set(lines.map((l) => l.itemId)).size !== lines.length) p.push('Each item once per adjustment')
    return p
  }, [warehouseId, reason, notes, lines, dir, stock.data])
  const save = async () => {
    setSaving(true)
    try {
      const adj = await apiPost<{ adjNo: string }>(A, { action: 'request', date, warehouseId, reasonCode: reason, notes: notes.trim() || undefined, lines: lines.map((l) => ({ itemId: l.itemId, qtyChange: Number(l.qtyChange), ...(Number(l.rate) > 0 ? { rate: Number(l.rate) } : {}) })) })
      toast.success(`${adj.adjNo} requested`, { description: 'Stock changes only after approval.' })
      onDone()
    } catch (e) { toastError(e) } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Request stock adjustment</DialogTitle><DialogDescription>Negative numbers remove stock, positive add it. Nothing posts until approved.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5"><Label htmlFor="adj-date">Date</Label><Input id="adj-date" type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div className="space-y-1.5"><Label>Warehouse</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.code} {w.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Reason</Label><Select value={reason} onValueChange={setReason}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue /></SelectTrigger><SelectContent>{REASONS.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5 sm:col-span-3"><Label htmlFor="adj-notes">Notes</Label><Input id="adj-notes" className="h-11" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Count sheet CS-14, rack B2" /></div>
    </div>
    <div className="space-y-2">{lines.map((l, i) => <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_7rem_7rem_2.75rem]">
      <Select value={l.itemId} onValueChange={(v) => set(i, { itemId: v })}><SelectTrigger className="h-11 data-[size=default]:h-11" aria-label={`Line ${i + 1} item`}><SelectValue placeholder="Item" /></SelectTrigger><SelectContent>{stockItems.map((it) => <SelectItem key={it.id} value={it.id}>{it.code} {it.name}</SelectItem>)}</SelectContent></Select>
      <Input className="h-11 text-right" inputMode="decimal" aria-label={`Line ${i + 1} change`} placeholder="±qty" value={l.qtyChange} onChange={(e) => set(i, { qtyChange: e.target.value })} />
      <Input className="h-11 text-right" inputMode="decimal" aria-label={`Line ${i + 1} rate`} placeholder="rate (adds)" disabled={Number(l.qtyChange) < 0} value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />
      <Button variant="ghost" className="h-11" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Trash2 className="size-4" aria-hidden /></Button>
      {l.itemId && warehouseId && onHand(l.itemId) !== null ? <p className="text-xs text-muted-foreground sm:col-span-4">On hand {qtyFmt(onHand(l.itemId)!)} → after {qtyFmt(onHand(l.itemId)! + (Number(l.qtyChange) || 0))}</p> : null}
    </div>)}
      <Button variant="outline" className="h-11 gap-2" onClick={() => setLines((ls) => [...ls, { itemId: '', qtyChange: '', rate: '' }])}><Plus className="size-4" aria-hidden />Add item</Button></div>
    {problems.length ? <ul className="list-disc pl-5 text-sm text-muted-foreground">{problems.slice(0, 4).map((p) => <li key={p}>{p}</li>)}</ul> : null}
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11 gap-2" disabled={problems.length > 0 || saving} onClick={() => void save()}><ClipboardCheck className="size-4" aria-hidden />{saving ? 'Sending…' : 'Send for approval'}</Button></DialogFooter>
  </DialogContent></Dialog>
}
