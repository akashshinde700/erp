'use client'

/**
 * ForgeERP — Jobwork module (the flagship chain):
 * Inward (multi item, qty + weight) → Job Cards (partial, multi-process,
 * over-processing guarded server-side with 5% tolerance) → Certificate →
 * Sales Invoice (source JOBWORK). Plus the pending report.
 */

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  BadgeCheck,
  ClipboardList,
  FileCheck2,
  Loader2,
  PackageCheck,
  Plus,
  ReceiptText,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  apiDelete,
  apiPost,
  num,
  partyTypes,
  toastError,
  todayISO,
  useApi,
  useMasters,
  type JobworkCertificate,
  type JobworkInward,
  type JobworkPendingRow,
  type Process,
  type SalesInvoice,
} from './api'
import { EmptyState, Money, ProgressBar, SectionHeading, StatusBadge, TableSkeleton } from './bits'
import { useErpUi, useOpenNewParam } from './store'
import { dateStr, money, qty as qtyFmt } from '@/lib/erp'

// ===========================================================================
// Module view (tabs: inwards | pending)
// ===========================================================================

export function JobworkView() {
  return (
    <div className="space-y-4">
      <SectionHeading
        title="Customer Jobwork"
        description="Service/conversion flow for customer-owned material: inward → process job cards → certificate → GST invoice. This stock is kept separate from your own project manufacturing."
      />
      <Tabs defaultValue="inwards">
        <TabsList className="h-11 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="inwards" className="h-11 gap-1.5 sm:h-9">
            <ClipboardList className="size-4" aria-hidden /> Inwards
          </TabsTrigger>
          <TabsTrigger value="pending" className="h-11 gap-1.5 sm:h-9">
            <Wrench className="size-4" aria-hidden /> Pending
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inwards" className="mt-4">
          <InwardsTab />
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          <PendingTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- inwards list ----------

function InwardsTab() {
  const setView = useErpUi((s) => s.setView)
  const list = useApi<JobworkInward[]>('/api/jobwork/inwards')
  const [createOpen, setCreateOpen] = useState(useOpenNewParam())
  const inwards = list.data ?? []

  const progressOf = (iw: JobworkInward) => {
    const total = iw.items.reduce((s, i) => s + i.qty, 0)
    const done = iw.items.reduce((s, i) => s + i.processedQty, 0)
    return { total, done, pct: total > 0 ? (done / total) * 100 : 0 }
  }
  const cardValue = (iw: JobworkInward) => iw.jobCards.reduce((s, c) => s + c.totalAmount, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {inwards.length} inward{inwards.length === 1 ? '' : 's'} — customer-owned material, value-neutral stock.
        </p>
        <Button onClick={() => setCreateOpen(true)} className="h-11 gap-2">
          <Plus className="size-4" aria-hidden /> New Inward
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={5} cols={6} />
          ) : inwards.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No inwards yet"
                hint="Record a customer challan inward to start the jobwork chain."
                icon={ClipboardList}
                action={
                  <Button variant="outline" onClick={() => setCreateOpen(true)} className="mt-2 h-11 gap-2">
                    <Plus className="size-4" aria-hidden /> New Inward
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Inward No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="min-w-36">Progress</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Card Value</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inwards.map((iw) => {
                    const p = progressOf(iw)
                    return (
                      <TableRow key={iw.id} className="cursor-pointer" onClick={() => setView('jobwork-detail', { id: iw.id })}>
                        <TableCell className="font-medium tabular-nums">{iw.inwardNo}</TableCell>
                        <TableCell className="whitespace-nowrap">{dateStr(iw.date)}</TableCell>
                        <TableCell>
                          <span className="block max-w-40 truncate">{iw.party?.name ?? '—'}</span>
                          <span className="block max-w-40 truncate text-xs text-muted-foreground">{iw.challanNo ? `Challan ${iw.challanNo}` : '—'}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{iw.items.length}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <ProgressBar value={p.pct} />
                            <p className="text-xs tabular-nums text-muted-foreground">
                              {qtyFmt(p.done)} / {qtyFmt(p.total)} pcs
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums hidden sm:table-cell">
                          <Money value={cardValue(iw)} plain />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={iw.status} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <NewInwardDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => list.reload()} key={`inw-${createOpen}`} />
    </div>
  )
}

// ---------- new inward dialog ----------

interface InwardRowDraft {
  key: number
  itemId: string
  batchNo: string
  qty: string
  weight: string
}

function NewInwardDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const { parties, items, warehouses } = useMasters()
  const customers = parties.filter((p) => p.active && partyTypes(p).includes('CUSTOMER'))

  const [partyId, setPartyId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [challanNo, setChallanNo] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [notes, setNotes] = useState('')
  const [rows, setRows] = useState<InwardRowDraft[]>([{ key: 1, itemId: '', batchNo: '', qty: '', weight: '' }])
  const [saving, setSaving] = useState(false)

  const seq = rows.length ? Math.max(...rows.map((r) => r.key)) : 0
  const setRow = (key: number, patch: Partial<InwardRowDraft>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const validRows = rows.filter((r) => r.itemId && num(r.qty) > 0)

  const submit = async () => {
    if (!partyId) {
      toast.error('Select a customer party')
      return
    }
    if (validRows.length === 0) {
      toast.error('Add at least one item row with quantity > 0')
      return
    }
    setSaving(true)
    try {
      const res = await apiPost<JobworkInward>('/api/jobwork/inwards', {
        partyId,
        date,
        challanNo: challanNo.trim() || undefined,
        warehouseId: warehouseId || undefined,
        notes: notes.trim() || undefined,
        items: validRows.map((r) => ({
          itemId: r.itemId,
          batchNo: r.batchNo.trim() || undefined,
          qty: num(r.qty),
          weight: num(r.weight),
        })),
      })
      toast.success(`${res.inwardNo} recorded`, {
        description: `${validRows.length} item line(s) — material received into the jobwork store, status OPEN.`,
      })
      onCreated()
      onOpenChange(false)
      setRows([{ key: seq + 1, itemId: '', batchNo: '', qty: '', weight: '' }])
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Jobwork Inward</DialogTitle>
          <DialogDescription>
            Record the customer challan — items are booked qty + weight into the jobwork store (customer-owned,
            value-neutral).
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto erp-scroll-y pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Select value={partyId || undefined} onValueChange={setPartyId}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Select customer…" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inw-date">Date</Label>
              <Input id="inw-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inw-challan">Challan No</Label>
              <Input id="inw-challan" value={challanNo} onChange={(e) => setChallanNo(e.target.value)} placeholder="Customer challan ref" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label>Warehouse</Label>
              <Select value={warehouseId || undefined} onValueChange={(v) => setWarehouseId(v === 'none' ? '' : v)}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Optional — jobwork store" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— skip —</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Mobile (below sm): stacked cards per row — same state wiring as the table. */}
          <div className="space-y-3 sm:hidden">
            {rows.map((r) => (
              <div key={r.key} className="space-y-3 rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <Select value={r.itemId || undefined} onValueChange={(v) => setRow(r.key, { itemId: v })}>
                      <SelectTrigger className="h-11 w-full" aria-label={`Item for row ${r.key}`}>
                        <SelectValue placeholder="Pick item…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {items
                          .filter((i) => i.active)
                          .map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.code} — {i.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                    disabled={rows.length === 1}
                    aria-label={`Remove row ${r.key}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor={`inw-mbatch-${r.key}`} className="text-xs text-muted-foreground">Batch No</Label>
                    <Input
                      id={`inw-mbatch-${r.key}`}
                      value={r.batchNo}
                      onChange={(e) => setRow(r.key, { batchNo: e.target.value })}
                      placeholder="Optional"
                      className="h-11"
                      aria-label="Batch number"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`inw-mqty-${r.key}`} className="text-xs text-muted-foreground">Qty (pcs)</Label>
                    <Input
                      id={`inw-mqty-${r.key}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={r.qty}
                      onChange={(e) => setRow(r.key, { qty: e.target.value })}
                      placeholder="0"
                      className="h-11 text-right tabular-nums"
                      aria-label="Quantity"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`inw-mwt-${r.key}`} className="text-xs text-muted-foreground">Weight (kg)</Label>
                    <Input
                      id={`inw-mwt-${r.key}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={r.weight}
                      onChange={(e) => setRow(r.key, { weight: e.target.value })}
                      placeholder="0"
                      className="h-11 text-right tabular-nums"
                      aria-label="Weight in kg"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop (sm+): classic row editor */}
          <div className="hidden overflow-x-auto rounded-md border sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-44">Item</TableHead>
                  <TableHead className="min-w-28">Batch No</TableHead>
                  <TableHead className="w-24 text-right">Qty (pcs)</TableHead>
                  <TableHead className="w-28 text-right">Weight (kg)</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>
                      <Select value={r.itemId || undefined} onValueChange={(v) => setRow(r.key, { itemId: v })}>
                        <SelectTrigger className="h-11 w-full min-w-40">
                          <SelectValue placeholder="Pick item…" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {items
                            .filter((i) => i.active)
                            .map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.code} — {i.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={r.batchNo}
                        onChange={(e) => setRow(r.key, { batchNo: e.target.value })}
                        placeholder="Optional"
                        className="h-11"
                        aria-label="Batch number"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={r.qty}
                        onChange={(e) => setRow(r.key, { qty: e.target.value })}
                        placeholder="0"
                        className="h-11 text-right tabular-nums"
                        aria-label="Quantity"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={r.weight}
                        onChange={(e) => setRow(r.key, { weight: e.target.value })}
                        placeholder="0"
                        className="h-11 text-right tabular-nums"
                        aria-label="Weight in kg"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground hover:text-destructive md:size-9"
                        onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                        disabled={rows.length === 1}
                        aria-label={`Remove row ${r.key}`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button variant="outline" onClick={() => setRows((rs) => [...rs, { key: seq + 1, itemId: '', batchNo: '', qty: '', weight: '' }])} className="h-11 gap-2">
            <Plus className="size-4" aria-hidden /> Add item
          </Button>

          <div className="space-y-1.5">
            <Label htmlFor="inw-notes">Notes</Label>
            <Textarea id="inw-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — e.g. material condition, dispatch instructions" rows={2} />
          </div>
        </div>

        <DialogFooter className="gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="h-11 gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {saving ? 'Saving…' : 'Record Inward'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- pending report tab ----------

function PendingTab() {
  const setView = useErpUi((s) => s.setView)
  const { data, loading } = useApi<JobworkPendingRow[]>('/api/reports?type=jobwork-pending')
  const rows = data ?? []

  if (loading) return <Card className="p-0"><CardContent className="p-0"><TableSkeleton rows={5} cols={6} /></CardContent></Card>
  if (rows.length === 0) {
    return <EmptyState title="Nothing pending" hint="All inwards are fully processed and invoiced." icon={PackageCheck} />
  }

  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <Card key={r.inward.id} className="p-0">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <button type="button" className="font-semibold tabular-nums underline-offset-2 hover:underline" onClick={() => setView('jobwork-detail', { id: r.inward.id })}>
                {r.inward.inwardNo}
              </button>
              <StatusBadge status={r.inward.status} />
              <span className="text-muted-foreground">
                {r.inward.party.name} · {dateStr(r.inward.date)}
              </span>
            </CardTitle>
            <span className="text-sm text-muted-foreground">
              Card value <span className="font-semibold tabular-nums text-foreground">₹ {money(r.cardValue)}</span>
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Batch</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Processed</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right">Weight Rem.</TableHead>
                    <TableHead className="min-w-40">Pending Processes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.items.map((it, idx) => (
                    <TableRow key={`${it.item.id}-${it.batchNo ?? ''}-${idx}`}>
                      <TableCell>
                        <span className="block max-w-40 truncate font-medium">{it.item.name}</span>
                        <span className="block text-xs text-muted-foreground">{it.item.code}</span>
                      </TableCell>
                      <TableCell className="text-xs">{it.batchNo ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(it.receivedQty)} {it.item.uom}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(it.processedQty)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{qtyFmt(it.remainingQty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(it.remainingWeight)} kg</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {it.pendingProcesses.length === 0 ? (
                            <Badge variant="default" className="gap-1">
                              <BadgeCheck className="size-3" aria-hidden /> All done
                            </Badge>
                          ) : (
                            it.pendingProcesses.map((p) => (
                              <Badge key={p.id} variant="outline" className="gap-1">
                                <Wrench className="size-3" aria-hidden />
                                {p.code}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ===========================================================================
// Inward detail
// ===========================================================================

export function JobworkDetailView({ id }: { id: string }) {
  const setView = useErpUi((s) => s.setView)
  const inv = useApi<JobworkInward | null>(`/api/jobwork/inwards/${id}`)
  const { processes } = useMasters()
  const [cardOpen, setCardOpen] = useState(false)
  const [busy, setBusy] = useState<'cert' | 'invoice' | null>(null)
  const [cancelling, setCancelling] = useState(false)

  if (inv.loading) {
    return <TableSkeleton rows={8} cols={5} />
  }
  if (inv.error || !inv.data) {
    return <EmptyState title="Inward not found" hint={inv.error ?? 'Unknown inward.'} icon={XCircle} />
  }
  const iw = inv.data
  const completedCards = iw.jobCards.filter((c) => c.status === 'COMPLETED')
  const hasActiveCert = iw.certificates.some((c) => c.status === 'ISSUED')
  const anyRemaining = iw.items.some((i) => i.qty - i.processedQty > 0.0001)
  const totalQty = iw.items.reduce((s, i) => s + i.qty, 0)
  const totalWeight = iw.items.reduce((s, i) => s + i.weight, 0)
  const processedQty = iw.items.reduce((s, i) => s + i.processedQty, 0)
  const processedWeight = iw.items.reduce((s, i) => s + i.processedWeight, 0)
  const cardValue = completedCards.reduce((s, c) => s + c.totalAmount, 0)
  const pct = totalQty > 0 ? (processedQty / totalQty) * 100 : 0

  const issueCertificate = async () => {
    setBusy('cert')
    try {
      const res = await apiPost<JobworkCertificate>('/api/jobwork/certificates', { inwardId: id })
      toast.success(`${res.certNo} issued`, {
        description: `${qtyFmt(res.totalQty)} pcs · ${qtyFmt(res.totalWeight)} kg · ₹ ${money(res.totalAmount)} process value.`,
      })
      inv.reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }

  const generateInvoice = async () => {
    setBusy('invoice')
    try {
      const res = await apiPost<SalesInvoice>('/api/jobwork/invoices', { inwardId: id })
      toast.success(`${res.invoiceNo} generated`, {
        description: 'Jobwork invoice posted to Sales (source JOBWORK) — open the Sales module to view or print it.',
      })
      inv.reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }

  const cancelInward = async () => {
    setCancelling(true)
    try {
      await apiDelete(`/api/jobwork/inwards/${id}`)
      toast.success(`${iw.inwardNo} cancelled`, { description: 'Reversal entries posted to the stock ledger.' })
      setView('jobwork')
    } catch (e) {
      toastError(e)
    } finally {
      setCancelling(false)
    }
  }

  const cancelCard = async (cardId: string, cardNo: string) => {
    try {
      await apiDelete(`/api/jobwork/job-cards/${cardId}`)
      toast.success(`${cardNo} cancelled`, { description: 'Processed quantities rolled back on the inward items.' })
      inv.reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="size-11" onClick={() => setView('jobwork')} aria-label="Back to inwards">
            <ArrowLeft className="size-5" aria-hidden />
          </Button>
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold tabular-nums">
              {iw.inwardNo} <StatusBadge status={iw.status} />
            </h2>
            <p className="text-sm text-muted-foreground">
              {iw.party?.name} · {dateStr(iw.date)}
              {iw.challanNo ? ` · Challan ${iw.challanNo}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setCardOpen(true)} disabled={!anyRemaining || iw.status === 'CANCELLED' || iw.status === 'INVOICED'} className="h-11 gap-2">
            <Wrench className="size-4" aria-hidden /> New Job Card
          </Button>
          <Button variant="outline" onClick={issueCertificate} disabled={completedCards.length === 0 || anyRemaining || hasActiveCert || iw.status !== 'COMPLETED' || busy !== null} title={anyRemaining ? 'Finish all inward quantities before certification' : undefined} className="h-11 gap-2">
            {busy === 'cert' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileCheck2 className="size-4" aria-hidden />}
            Issue Certificate
          </Button>
          <Button variant="outline" onClick={generateInvoice} disabled={completedCards.length === 0 || !hasActiveCert || iw.status === 'INVOICED' || iw.status === 'CANCELLED' || busy !== null} title={!hasActiveCert ? 'Issue the completion certificate before invoicing' : undefined} className="h-11 gap-2">
            {busy === 'invoice' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ReceiptText className="size-4" aria-hidden />}
            Generate Invoice
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={iw.status === 'CANCELLED' || cancelling} className="h-11 gap-2">
                {cancelling ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
                Cancel Inward
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel {iw.inwardNo}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Blocked if any completed job card exists. Cancellation posts a reversal to the stock ledger —
                  the inward stays visible as an audit trail.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-11">Keep inward</AlertDialogCancel>
                <AlertDialogAction onClick={cancelInward} className="h-11" disabled={cancelling}>
                  {cancelling ? 'Cancelling…' : 'Cancel inward'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* progress summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quantity processed</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {qtyFmt(processedQty)} <span className="text-sm font-normal text-muted-foreground">/ {qtyFmt(totalQty)} pcs</span>
          </p>
          <ProgressBar value={pct} className="mt-2" />
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Weight processed</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {qtyFmt(processedWeight)} <span className="text-sm font-normal text-muted-foreground">/ {qtyFmt(totalWeight)} kg</span>
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Job card value (not yet invoiced)</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">₹ {money(cardValue)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {completedCards.length} completed card{completedCards.length === 1 ? '' : 's'}
            {hasActiveCert ? ' · certificate issued' : ''}
          </p>
        </Card>
      </div>

      {/* items */}
      <Card className="p-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Inward Items
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead className="text-right">Received Qty</TableHead>
                  <TableHead className="text-right">Processed Qty</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right">Weight (recv / proc / rem)</TableHead>
                  <TableHead className="min-w-28">Progress</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {iw.items.map((it) => {
                  const rem = it.qty - it.processedQty
                  const remW = it.weight - it.processedWeight
                  const p = it.qty > 0 ? (it.processedQty / it.qty) * 100 : 0
                  return (
                    <TableRow key={it.id}>
                      <TableCell>
                        <span className="block max-w-40 truncate font-medium">{it.item?.name ?? it.itemId}</span>
                        <span className="block text-xs text-muted-foreground">{it.item?.code}</span>
                      </TableCell>
                      <TableCell className="text-xs">{it.batchNo ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(it.qty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{qtyFmt(it.processedQty)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{qtyFmt(rem)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {qtyFmt(it.weight)} / {qtyFmt(it.processedWeight)} / {qtyFmt(remW)}
                      </TableCell>
                      <TableCell>
                        <ProgressBar value={p} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* job cards */}
      <Card className="p-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Job Cards ({iw.jobCards.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          {iw.jobCards.length === 0 ? (
            <EmptyState
              title="No job cards yet"
              hint="Create a job card to process inward items — partial quantities allowed, multiple processes per card."
              icon={Wrench}
            />
          ) : (
            iw.jobCards.map((c) => (
              <div key={c.id} className="rounded-lg border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums">{c.cardNo}</span>
                    <StatusBadge status={c.status} />
                    <span className="text-xs text-muted-foreground">{dateStr(c.date)}</span>
                    {c.notes ? <span className="text-xs italic text-muted-foreground">— {c.notes}</span> : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums">₹ {money(c.totalAmount)}</span>
                    {c.status === 'COMPLETED' ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-11 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive md:h-9">
                            <XCircle className="size-4" aria-hidden /> Cancel card
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancel {c.cardNo}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Processed quantities are rolled back onto the inward items. Blocked once a certificate
                              has been issued for this inward.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="h-11">Keep card</AlertDialogCancel>
                            <AlertDialogAction onClick={() => cancelCard(c.id, c.cardNo)} className="h-11">
                              Cancel card
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Process</TableHead>
                        <TableHead>Basis</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Weight</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead className="text-right">Lot Charge</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(c.processes ?? []).map((p) => {
                        const item = iw.items.find((x) => x.id === p.inwardItemId)
                        return (
                          <TableRow key={p.id}>
                            <TableCell>
                              <span className="block max-w-40 truncate font-medium">{p.process?.name ?? p.processId}</span>
                              <span className="block text-xs text-muted-foreground">
                                {p.process?.code}
                                {item ? ` · ${item.item?.code ?? ''}${item.batchNo ? ` / ${item.batchNo}` : ''}` : ''}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-[11px]">
                                {p.basis === 'WEIGHT' ? 'per KG' : 'per piece'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{qtyFmt(p.qty)}</TableCell>
                            <TableCell className="text-right tabular-nums">{qtyFmt(p.weight)} kg</TableCell>
                            <TableCell className="text-right tabular-nums">₹ {money(p.rate)}</TableCell>
                            <TableCell className="text-right tabular-nums">{p.lotCharge > 0 ? `₹ ${money(p.lotCharge)}` : '—'}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">₹ {money(p.amount)}</TableCell>
                          </TableRow>
                        )
                      })}
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={6} className="text-right text-sm font-medium">
                          Card total (incl. lot charges)
                        </TableCell>
                        <TableCell className="text-right text-sm font-bold tabular-nums">₹ {money(c.totalAmount)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* certificates */}
      <Card className="p-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Certificates ({iw.certificates.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {iw.certificates.length === 0 ? (
            <EmptyState
              title="No certificate issued"
              hint="Issue after job cards are completed — aggregates process-wise totals for the customer."
              icon={FileCheck2}
            />
          ) : (
            <div className="space-y-4">
              {iw.certificates.map((c) => (
                <CertificateBlock key={c.id} cert={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <NewJobCardDialog
        inward={iw}
        processes={processes}
        open={cardOpen}
        onOpenChange={setCardOpen}
        onCreated={() => inv.reload()}
      />
    </div>
  )
}

// ---------- certificate display ----------

interface CertDetail {
  code: string
  name: string
  qty: number
  weight: number
  amount: number
}

function CertificateBlock({ cert }: { cert: JobworkCertificate }) {
  const details = useMemo<CertDetail[]>(() => {
    try {
      const parsed: unknown = JSON.parse(cert.details ?? '[]')
      if (Array.isArray(parsed)) return parsed as CertDetail[]
    } catch {
      /* ignore malformed */
    }
    return []
  }, [cert.details])

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tabular-nums">{cert.certNo}</span>
          <StatusBadge status={cert.status} />
          <span className="text-xs text-muted-foreground">{dateStr(cert.date)}</span>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="tabular-nums">{qtyFmt(cert.totalQty)} pcs</span>
          <span className="tabular-nums">{qtyFmt(cert.totalWeight)} kg</span>
          <span className="font-semibold tabular-nums">₹ {money(cert.totalAmount)}</span>
        </div>
      </div>
      {details.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Process</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {details.map((d) => (
              <TableRow key={d.code}>
                <TableCell>
                  <span className="font-medium">{d.name}</span>
                  <span className="block text-xs text-muted-foreground">{d.code}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{qtyFmt(d.qty)}</TableCell>
                <TableCell className="text-right tabular-nums">{qtyFmt(d.weight)} kg</TableCell>
                <TableCell className="text-right tabular-nums">₹ {money(d.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}

// ---------- new job card dialog ----------

interface JcLineState {
  included: boolean
  qty: string
  weight: string
}

function NewJobCardDialog({
  inward,
  processes,
  open,
  onOpenChange,
  onCreated,
}: {
  inward: JobworkInward
  processes: Process[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const [date, setDate] = useState(todayISO())
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [lines, setLines] = useState<Record<string, JcLineState>>({})
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  // reset when re-opened, from the latest inward state
  useEffect(() => {
    if (!open) return
    const fresh: Record<string, JcLineState> = {}
    for (const it of inward.items) {
      const remQ = Math.max(0, it.qty - it.processedQty)
      const remW = Math.max(0, it.weight - it.processedWeight)
      fresh[it.id] = { included: remQ > 0, qty: String(remQ), weight: String(remW) }
    }
    setLines(fresh)
    setSelected({})
    setDate(todayISO())
    setNotes('')
  }, [open, inward])

  const activeProcesses = processes.filter((p) => p.active)
  const selectedIds = activeProcesses.filter((p) => selected[p.id]).map((p) => p.id)
  const includedLines = inward.items.filter((it) => lines[it.id]?.included && num(lines[it.id]?.qty) > 0)

  // live estimate using process default rates (server may use party rates)
  const estimates = selectedIds.flatMap((pid) => {
    const p = activeProcesses.find((x) => x.id === pid)
    if (!p) return []
    const qtySum = includedLines.reduce((s, it) => s + num(lines[it.id]?.qty), 0)
    const weightSum = includedLines.reduce((s, it) => s + num(lines[it.id]?.weight), 0)
    const amount = p.basis === 'WEIGHT' ? weightSum * p.rate : qtySum * p.rate
    return [{ process: p, qtySum, weightSum, amount }]
  })
  const estimateTotal =
    estimates.reduce((s, e) => s + e.amount, 0) +
    selectedIds.reduce((s, pid) => {
      const p = activeProcesses.find((x) => x.id === pid)
      return s + (p?.lotCharge ?? 0)
    }, 0)

  const setLine = (id: string, patch: Partial<JcLineState>) =>
    setLines((ls) => ({
      ...ls,
      [id]: { ...(ls[id] ?? { included: false, qty: '', weight: '' }), ...patch },
    }))

  const toggleProcess = (id: string, on: boolean) => setSelected((s) => ({ ...s, [id]: on }))

  const submit = async () => {
    if (includedLines.length === 0) {
      toast.error('Include at least one item line with qty > 0')
      return
    }
    if (selectedIds.length === 0) {
      toast.error('Select at least one process')
      return
    }
    setSaving(true)
    try {
      const res = await apiPost<{ cardNo: string; totalAmount: number }>('/api/jobwork/job-cards', {
        inwardId: inward.id,
        date,
        notes: notes.trim() || undefined,
        lines: includedLines.map((it) => ({
          inwardItemId: it.id,
          qty: num(lines[it.id].qty),
          weight: num(lines[it.id].weight),
          processIds: selectedIds,
        })),
      })
      toast.success(`${res.cardNo} posted`, {
        description: `Card value ₹ ${money(res.totalAmount)} — processed quantities bumped on the inward (5% over-tolerance guarded server-side).`,
      })
      onCreated()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Job Card — {inward.inwardNo}</DialogTitle>
          <DialogDescription>
            Pick items (partial quantities allowed) and the processes to run. Rates resolve from party rates when
            set, else process defaults — the estimate below uses defaults.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto erp-scroll-y pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="jc-date">Date</Label>
              <Input id="jc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="jc-notes">Notes</Label>
              <Input id="jc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="h-11" />
            </div>
          </div>

          {/* Mobile (below sm): stacked cards per line — same state wiring as the table. */}
          <div className="space-y-3 sm:hidden">
            {inward.items.map((it) => {
              const remQ = Math.max(0, it.qty - it.processedQty)
              const remW = Math.max(0, it.weight - it.processedWeight)
              const st = lines[it.id] ?? { included: false, qty: '0', weight: '0' }
              const disabled = remQ <= 0
              return (
                <div key={it.id} className={`space-y-3 rounded-md border p-3 ${disabled ? 'opacity-50' : ''}`}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <Checkbox
                      checked={st.included}
                      disabled={disabled}
                      onCheckedChange={(v) => setLine(it.id, { included: v === true })}
                      aria-label={`Include ${it.item?.name ?? 'item'}`}
                      className="mt-0.5 size-5"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{it.item?.name ?? it.itemId}</p>
                      <p className="text-xs text-muted-foreground">
                        {it.item?.code}
                        {it.batchNo ? ` · batch ${it.batchNo}` : ''}
                      </p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        Remaining: {qtyFmt(remQ)} pcs / {qtyFmt(remW)} kg
                      </p>
                    </div>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`jc-mqty-${it.id}`} className="text-xs text-muted-foreground">Qty</Label>
                      <Input
                        id={`jc-mqty-${it.id}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max={remQ}
                        step="any"
                        value={st.qty}
                        disabled={disabled || !st.included}
                        onChange={(e) => setLine(it.id, { qty: e.target.value })}
                        className="h-11 text-right tabular-nums"
                        aria-label="Quantity to process"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`jc-mwt-${it.id}`} className="text-xs text-muted-foreground">Weight (kg)</Label>
                      <Input
                        id={`jc-mwt-${it.id}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max={remW}
                        step="any"
                        value={st.weight}
                        disabled={disabled || !st.included}
                        onChange={(e) => setLine(it.id, { weight: e.target.value })}
                        className="h-11 text-right tabular-nums"
                        aria-label="Weight to process"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Desktop (sm+): classic line table */}
          <div className="hidden overflow-x-auto rounded-md border sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Include</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="w-24 text-right">Qty</TableHead>
                  <TableHead className="w-28 text-right">Weight (kg)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inward.items.map((it) => {
                  const remQ = Math.max(0, it.qty - it.processedQty)
                  const remW = Math.max(0, it.weight - it.processedWeight)
                  const st = lines[it.id] ?? { included: false, qty: '0', weight: '0' }
                  const disabled = remQ <= 0
                  return (
                    <TableRow key={it.id} className={disabled ? 'opacity-50' : ''}>
                      <TableCell>
                        <label className="flex size-11 cursor-pointer items-center justify-center">
                          <Checkbox
                            checked={st.included}
                            disabled={disabled}
                            onCheckedChange={(v) => setLine(it.id, { included: v === true })}
                            aria-label={`Include ${it.item?.name ?? 'item'}`}
                            className="size-5"
                          />
                        </label>
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-40 truncate font-medium">{it.item?.name ?? it.itemId}</span>
                        <span className="block text-xs text-muted-foreground">
                          {it.item?.code}
                          {it.batchNo ? ` · batch ${it.batchNo}` : ''}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                        {qtyFmt(remQ)} pcs / {qtyFmt(remW)} kg
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={remQ}
                          step="any"
                          value={st.qty}
                          disabled={disabled || !st.included}
                          onChange={(e) => setLine(it.id, { qty: e.target.value })}
                          className="h-11 text-right tabular-nums"
                          aria-label="Quantity to process"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={remW}
                          step="any"
                          value={st.weight}
                          disabled={disabled || !st.included}
                          onChange={(e) => setLine(it.id, { weight: e.target.value })}
                          className="h-11 text-right tabular-nums"
                          aria-label="Weight to process"
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2">
            <Label>Processes</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {activeProcesses.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent/50 has-[button]:border-primary"
                >
                  <Checkbox
                    checked={!!selected[p.id]}
                    onCheckedChange={(v) => toggleProcess(p.id, v === true)}
                    className="mt-0.5 size-5"
                    aria-label={`Process ${p.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {p.name} <span className="text-xs text-muted-foreground">({p.code})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ₹ {money(p.rate)} {p.basis === 'WEIGHT' ? 'per KG' : 'per piece'}
                      {p.lotCharge > 0 ? ` · lot ₹ ${money(p.lotCharge)}` : ''}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {estimates.length > 0 ? (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Estimate (process default rates)
              </p>
              <ScrollArea className="max-h-40">
                <div className="space-y-1 pr-2 pt-1 text-sm">
                  {estimates.map((e) => (
                    <div key={e.process.id} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {e.process.name}
                        <span className="ml-1 text-xs">
                          ({e.process.basis === 'WEIGHT' ? `${qtyFmt(e.weightSum)} kg` : `${qtyFmt(e.qtySum)} pcs`}
                          {' × '}₹{money(e.process.rate)}
                          {e.process.lotCharge > 0 ? ` + lot ₹${money(e.process.lotCharge)}` : ''})
                        </span>
                      </span>
                      <span className="tabular-nums">₹ {money(e.amount + e.process.lotCharge)}</span>
                    </div>
                  ))}
                  <Separator className="my-1" />
                  <div className="flex justify-between font-semibold">
                    <span>Estimated card total</span>
                    <span className="tabular-nums">₹ {money(estimateTotal)}</span>
                  </div>
                  <p className="pt-1 text-[11px] text-muted-foreground">
                    Server applies party-specific rates when configured (Masters → Party Rates) and validates
                    over-processing with a 5% tolerance.
                  </p>
                </div>
              </ScrollArea>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="h-11 gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {saving ? 'Posting…' : 'Post Job Card'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
