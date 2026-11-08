'use client'

/** New sales quotation (customer, salesperson, validity, lines). It starts as DRAFT; submit and approve follow. */
import { useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { apiPost, toastError, useApi, useMasters } from './api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { money } from '@/lib/erp'

type Line = { itemId: string; qty: string; rate: string; discountPct: string }
const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

export function QuotationDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { parties, items } = useMasters()
  const sp = useApi<{ salespersons: { id: string; name: string; active: boolean }[] }>('/api/crm?view=salespersons')
  const customers = parties.filter((p) => p.active && p.types.split(',').includes('CUSTOMER'))
  const [partyId, setPartyId] = useState('')
  const [salespersonId, setSalespersonId] = useState('')
  const [validUntil, setValidUntil] = useState(plus(15))
  const [terms, setTerms] = useState('')
  const [lines, setLines] = useState<Line[]>([{ itemId: '', qty: '', rate: '', discountPct: '' }])
  const [saving, setSaving] = useState(false)
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)))
  const valid = lines.filter((l) => l.itemId && Number(l.qty) > 0 && Number(l.rate) >= 0 && l.rate !== '')
  const taxable = valid.reduce((s, l) => s + Number(l.qty) * Number(l.rate) * (1 - (Number(l.discountPct) || 0) / 100), 0)
  const gst = valid.reduce((s, l) => s + Number(l.qty) * Number(l.rate) * (1 - (Number(l.discountPct) || 0) / 100) * ((items.find((i) => i.id === l.itemId)?.gstRate ?? 0) / 100), 0)
  const ok = !!partyId && valid.length === lines.length && validUntil >= new Date().toISOString().slice(0, 10)
  const save = async () => {
    setSaving(true)
    try {
      const q = await apiPost<{ quotationNo: string }>('/api/order-to-cash', { action: 'create-quotation', partyId, validUntil, terms: terms || undefined, salespersonId: salespersonId || null, lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), rate: Number(l.rate), ...(Number(l.discountPct) > 0 ? { discountPct: Number(l.discountPct) } : {}) })) })
      toast.success(`${q.quotationNo} created as draft`, { description: 'Submit it for approval, then send it to the customer.' })
      onDone()
    } catch (e) { toastError(e) } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>New quotation</DialogTitle><DialogDescription>Rates are before GST; GST is added from each item&apos;s rate.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5 sm:col-span-2"><Label>Customer</Label><Select value={partyId} onValueChange={setPartyId}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{customers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor="q-valid">Valid until</Label><Input id="q-valid" type="date" className="h-11" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
      <div className="space-y-1.5"><Label>Salesperson</Label><Select value={salespersonId || 'none'} onValueChange={(v) => setSalespersonId(v === 'none' ? '' : v)}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{(sp.data?.salespersons ?? []).filter((s) => s.active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="q-terms">Terms</Label><Input id="q-terms" className="h-11" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 50% advance, delivery 3 weeks, ex-works" /></div>
    </div>
    <div className="space-y-2">{lines.map((l, i) => <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_6rem_7rem_5rem_2.75rem]">
      <Select value={l.itemId} onValueChange={(v) => set(i, { itemId: v, rate: l.rate || String(items.find((it) => it.id === v)?.saleRate ?? '') })}><SelectTrigger className="h-11 data-[size=default]:h-11" aria-label={`Line ${i + 1} item`}><SelectValue placeholder="Item" /></SelectTrigger><SelectContent>{items.filter((it) => it.active).map((it) => <SelectItem key={it.id} value={it.id}>{it.code} {it.name}</SelectItem>)}</SelectContent></Select>
      <Input className="h-11 text-right" inputMode="decimal" aria-label={`Line ${i + 1} quantity`} placeholder="Qty" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
      <Input className="h-11 text-right" inputMode="decimal" aria-label={`Line ${i + 1} rate`} placeholder="Rate" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} />
      <Input className="h-11 text-right" inputMode="decimal" aria-label={`Line ${i + 1} discount`} placeholder="Disc %" value={l.discountPct} onChange={(e) => set(i, { discountPct: e.target.value })} />
      <Button variant="ghost" className="h-11" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}><Trash2 className="size-4" aria-hidden /></Button>
    </div>)}
      <Button variant="outline" className="h-11 gap-2" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '', rate: '', discountPct: '' }])}><Plus className="size-4" aria-hidden />Add line</Button></div>
    <p className="text-sm">Taxable ₹ {money(taxable)} · GST ₹ {money(gst)} · <strong>Total ₹ {money(taxable + gst)}</strong></p>
    {!ok ? <p className="text-sm text-muted-foreground">Needed: customer, a future validity date, and item, quantity and rate on every line.</p> : null}
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={!ok || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Create quotation'}</Button></DialogFooter>
  </DialogContent></Dialog>
}
