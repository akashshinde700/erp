'use client'

/**
 * ForgeERP — Accounting view.
 * Tabs: Payments (list + create with open-invoice allocation) and Party
 * Ledger (chronological vouchers with running balance).
 */

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BookOpen,
  Loader2,
  Plus,
  Scale,
  XCircle,
} from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  apiDelete,
  apiPost,
  num,
  partyTypes,
  toastError,
  todayISO,
  useApi,
  useMasters,
  type Party,
  type PartyLedger,
  type Payment,
  type PurchaseInvoice,
  type SalesInvoice,
} from './api'
import { EmptyState, Money, SectionHeading, StatusBadge, TableSkeleton } from './bits'
import { onPreset, takeCreatePreset } from './nav'
import { dateStr, money, PAYMENT_MODES } from '@/lib/erp'

type AnyInvoice = SalesInvoice | PurchaseInvoice

export function AccountingView() {
  const [tab, setTab] = useState<'payments' | 'ledger'>('payments')
  const [paymentPreset, setPaymentPreset] = useState<PaymentPreset | null>(null)
  const [ledgerPartyId, setLedgerPartyId] = useState('')

  // Cross-module presets: "Receive Payment" from an invoice detail opens the
  // payment dialog prefilled; "Party ledger" jumps straight to the ledger tab.
  useEffect(() => {
    const apply = (p: CreatePreset) => {
      if (p.type === 'payment') {
        setTab('payments')
        setPaymentPreset({
          partyId: p.partyId,
          paymentType: p.paymentType,
          amount: p.amount,
          allocations: p.allocations,
          stamp: Date.now(),
        })
      } else if (p.type === 'party-ledger') {
        setTab('ledger')
        setLedgerPartyId(p.partyId ?? '')
      }
    }
    const pending = takeCreatePreset()
    if (pending) apply(pending)
    return onPreset(apply)
  }, [])

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Accounting"
        description="Double-entry payments with invoice allocation, and per-party ledgers with running balances."
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'payments' | 'ledger')}>
        <TabsList className="h-11 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="payments" className="h-11 sm:h-9">Payments</TabsTrigger>
          <TabsTrigger value="ledger" className="h-11 sm:h-9">Party Ledger</TabsTrigger>
        </TabsList>
        <TabsContent value="payments" className="mt-4">
          <PaymentsTab preset={paymentPreset} onPresetConsumed={() => setPaymentPreset(null)} />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4">
          {/* keyed remount: a preset partyId arrives as fresh initial state */}
          <PartyLedgerTab key={ledgerPartyId} presetPartyId={ledgerPartyId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- payments ----------

function TypeBadge({ type }: { type: string }) {
  return type === 'RECEIPT' ? (
    <Badge className="gap-1">
      <ArrowDownCircle className="size-3" aria-hidden /> RECEIPT
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1">
      <ArrowUpCircle className="size-3" aria-hidden /> PAYMENT
    </Badge>
  )
}

export interface PaymentPreset {
  partyId?: string
  paymentType?: 'RECEIPT' | 'PAYMENT'
  amount?: number
  allocations?: { invoiceNo: string; amount: number }[]
  stamp: number
}

function PaymentsTab({ preset, onPresetConsumed }: { preset: PaymentPreset | null; onPresetConsumed: () => void }) {
  const list = useApi<Payment[]>('/api/payments')
  const [manualOpen, setManualOpen] = useState(false)
  const payments = list.data ?? []
  // A cross-module preset forces the dialog open (derived, not synced).
  const open = manualOpen || !!preset

  const cancelPayment = async (p: Payment) => {
    try {
      await apiDelete(`/api/payments/${p.id}`)
      toast.success(`${p.paymentNo} cancelled`, {
        description: 'Allocations reversed and invoice paid amounts rolled back.',
      })
      list.reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {payments.length} voucher{payments.length === 1 ? '' : 's'} — receipts & payments with allocation.
        </p>
        <Button onClick={() => setManualOpen(true)} className="h-11 gap-2">
          <Plus className="size-4" aria-hidden /> New Payment
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={6} cols={6} />
          ) : payments.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No payments yet"
                hint="Record receipts from customers or payments to suppliers, allocated against open invoices."
                action={
                  <Button variant="outline" onClick={() => setManualOpen(true)} className="mt-2 h-11 gap-2">
                    <Plus className="size-4" aria-hidden /> New Payment
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Voucher No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden md:table-cell">Mode / Ref</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Allocated</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => {
                    const alloc = (p.allocations ?? []).reduce((s, a) => s + a.amount, 0)
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium tabular-nums">{p.paymentNo}</TableCell>
                        <TableCell className="whitespace-nowrap">{dateStr(p.date)}</TableCell>
                        <TableCell>
                          <TypeBadge type={p.type} />
                        </TableCell>
                        <TableCell>
                          <span className="block max-w-40 truncate">{p.party?.name ?? '—'}</span>
                          <span className="block text-xs text-muted-foreground">{p.party?.code}</span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          <Money value={p.amount} plain />
                        </TableCell>
                        <TableCell className="hidden text-xs md:table-cell">
                          {p.mode ?? '—'}
                          {p.refNo ? <span className="block text-muted-foreground">{p.refNo}</span> : null}
                        </TableCell>
                        <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground md:table-cell">
                          {alloc > 0 ? money(alloc) : '—'}
                          {p.allocations && p.allocations.length > 0 ? (
                            <span className="block text-[10px]">{p.allocations.length} inv.</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={p.status} />
                        </TableCell>
                        <TableCell>
                          {p.status === 'POSTED' ? (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-11 text-muted-foreground hover:text-destructive md:size-9"
                                  aria-label={`Cancel ${p.paymentNo}`}
                                >
                                  <XCircle className="size-4" aria-hidden />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Cancel {p.paymentNo}?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Allocations are reversed and invoice paid amounts rolled back. GL reversal
                                    entries keep the ledgers append-only.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="h-11">Keep payment</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => cancelPayment(p)} className="h-11">
                                    Cancel payment
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : null}
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

      <NewPaymentDialog
        open={open}
        onOpenChange={(o) => {
          setManualOpen(o)
          if (!o) onPresetConsumed()
        }}
        onCreated={() => {
          list.reload()
          onPresetConsumed()
        }}
        preset={preset}
      />
    </div>
  )
}

// ---------- new payment dialog ----------

function NewPaymentDialog({
  open,
  onOpenChange,
  onCreated,
  preset,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
  preset?: PaymentPreset | null
}) {
  const { parties } = useMasters()
  const [type, setType] = useState<'RECEIPT' | 'PAYMENT'>('RECEIPT')
  const [partyId, setPartyId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState('BANK')
  const [refNo, setRefNo] = useState('')
  const [notes, setNotes] = useState('')
  const [allocs, setAllocs] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const eligible = parties.filter((p) =>
    p.active && partyTypes(p).includes(type === 'RECEIPT' ? 'CUSTOMER' : 'SUPPLIER')
  )

  const invPath = partyId
    ? type === 'RECEIPT'
      ? `/api/sales-invoices?partyId=${partyId}&status=POSTED`
      : `/api/purchase-invoices?partyId=${partyId}&status=POSTED`
    : null
  const invoices = useApi<AnyInvoice[]>(invPath)

  const openInvoices = useMemo(
    () => (invoices.data ?? []).filter((i) => i.grandTotal - i.paidAmount > 0.004),
    [invoices.data]
  )

  const amountN = num(amount)
  const allocated = openInvoices.reduce((s, inv) => s + num(allocs[inv.invoiceNo] ?? ''), 0)
  const over = allocated > amountN + 0.004
  const perInvoiceOver = openInvoices.some((inv) => {
    const a = num(allocs[inv.invoiceNo] ?? '')
    return a > inv.grandTotal - inv.paidAmount + 0.004
  })

  const onTypeChange = (t: 'RECEIPT' | 'PAYMENT') => {
    setType(t)
    setPartyId('')
    setAllocs({})
  }

  // Preset from an invoice's "Receive/Make Payment" button: party + type +
  // amount + allocation pre-ticked for that invoice.
  useEffect(() => {
    if (!open || !preset) return
    if (preset.paymentType) {
      setType(preset.paymentType)
    }
    if (preset.partyId) {
      setPartyId(preset.partyId)
    }
    if (preset.amount !== undefined) {
      setAmount(String(preset.amount))
    }
    if (preset.allocations?.length) {
      const a: Record<string, string> = {}
      for (const alloc of preset.allocations) a[alloc.invoiceNo] = String(alloc.amount)
      setAllocs(a)
    }
  }, [open, preset])

  const submit = async () => {
    if (!partyId) {
      toast.error('Select a party')
      return
    }
    if (amountN <= 0) {
      toast.error('Amount must be greater than zero')
      return
    }
    if (over || perInvoiceOver) {
      toast.error('Fix allocations first — total cannot exceed the payment amount, single lines cannot exceed outstanding')
      return
    }
    setSaving(true)
    try {
      const res = await apiPost<Payment>('/api/payments', {
        type,
        partyId,
        date,
        amount: amountN,
        mode,
        refNo: refNo.trim() || undefined,
        notes: notes.trim() || undefined,
        allocations: openInvoices
          .filter((inv) => num(allocs[inv.invoiceNo] ?? '') > 0)
          .map((inv) => ({
            invoiceType: type === 'RECEIPT' ? 'SALES' : 'PURCHASE',
            invoiceNo: inv.invoiceNo,
            amount: num(allocs[inv.invoiceNo]),
          })),
      })
      toast.success(`${res.paymentNo} posted`, {
        description: `${type === 'RECEIPT' ? 'Receipt' : 'Payment'} of ₹ ${money(res.amount)} — GL double-entry committed.`,
      })
      onCreated()
      onOpenChange(false)
      setPartyId('')
      setAmount('')
      setRefNo('')
      setNotes('')
      setAllocs({})
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Payment</DialogTitle>
          <DialogDescription>
            Receipts (money in from customers) or payments (money out to suppliers), optionally allocated against
            open invoices.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto erp-scroll-y pr-1">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Payment type">
            <Button
              type="button"
              variant={type === 'RECEIPT' ? 'default' : 'outline'}
              onClick={() => onTypeChange('RECEIPT')}
              className="h-11 gap-2"
            >
              <ArrowDownCircle className="size-4" aria-hidden /> RECEIPT
            </Button>
            <Button
              type="button"
              variant={type === 'PAYMENT' ? 'default' : 'outline'}
              onClick={() => onTypeChange('PAYMENT')}
              className="h-11 gap-2"
            >
              <ArrowUpCircle className="size-4" aria-hidden /> PAYMENT
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{type === 'RECEIPT' ? 'Customer' : 'Supplier'}</Label>
              <Select value={partyId} onValueChange={(v) => { setPartyId(v); setAllocs({}) }}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Select party…" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Date</Label>
              <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount ₹</Label>
              <Input
                id="pay-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="h-11 text-right tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">Reference No</Label>
              <Input id="pay-ref" value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="Cheque / UTR — optional" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-notes">Notes</Label>
              <Input id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="h-11" />
            </div>
          </div>

          {partyId ? (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Allocate against open invoices</p>
                <p className={`text-xs tabular-nums ${over ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                  Allocated ₹ {money(allocated)} / ₹ {money(amountN)}
                </p>
              </div>
              {invoices.loading ? (
                <p className="text-xs text-muted-foreground">Loading open invoices…</p>
              ) : openInvoices.length === 0 ? (
                <p className="text-xs text-muted-foreground">No open invoices for this party.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto erp-scroll-y">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead className="hidden sm:table-cell">Date</TableHead>
                        <TableHead className="hidden text-right sm:table-cell">Outstanding</TableHead>
                        <TableHead className="w-32 text-right">Allocate ₹</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {openInvoices.map((inv) => {
                        const outstanding = inv.grandTotal - inv.paidAmount
                        const a = num(allocs[inv.invoiceNo] ?? '')
                        const bad = a > outstanding + 0.004
                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="font-medium tabular-nums">{inv.invoiceNo}</TableCell>
                            <TableCell className="hidden whitespace-nowrap text-xs sm:table-cell">{dateStr(inv.date)}</TableCell>
                            <TableCell className="hidden text-right tabular-nums sm:table-cell">
                              <Money value={outstanding} plain />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                max={outstanding}
                                step="any"
                                value={allocs[inv.invoiceNo] ?? ''}
                                onChange={(e) => setAllocs((s) => ({ ...s, [inv.invoiceNo]: e.target.value }))}
                                placeholder="0"
                                className={`h-11 text-right tabular-nums ${bad ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                                aria-label={`Allocate to ${inv.invoiceNo}`}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {(over || perInvoiceOver) ? (
                <p className="text-xs font-medium text-destructive">
                  Σ allocations cannot exceed the payment amount, and each line cannot exceed its outstanding.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Select a party to see open invoices for allocation.</p>
          )}
        </div>

        <DialogFooter className="gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || over || perInvoiceOver} className="h-11 gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {saving ? 'Posting…' : 'Post Payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- party ledger ----------

function PartyLedgerTab({ presetPartyId }: { presetPartyId?: string }) {
  const { parties } = useMasters()
  const [partyId, setPartyId] = useState(presetPartyId ?? '')
  const ledger = useApi<PartyLedger | null>(partyId ? `/api/reports?type=party-ledger&partyId=${partyId}` : null)

  const sorted = useMemo(() => [...parties].sort((a, b) => a.name.localeCompare(b.name)), [parties])
  const party: Party | undefined = parties.find((p) => p.id === partyId)
  const data = ledger.data

  const totalDr = data ? data.rows.reduce((s, r) => s + r.debit, 0) : 0
  const totalCr = data ? data.rows.reduce((s, r) => s + r.credit, 0) : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:max-w-md">
        <Label>Party</Label>
        <Select value={partyId} onValueChange={setPartyId}>
          <SelectTrigger className="h-11 w-full">
            <SelectValue placeholder="Select party…" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {sorted.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.code} — {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!partyId ? (
        <EmptyState title="Pick a party" hint="The ledger shows every voucher with a running balance." icon={BookOpen} />
      ) : ledger.loading ? (
        <Card className="p-0"><CardContent className="p-0"><TableSkeleton rows={8} cols={5} /></CardContent></Card>
      ) : !data ? (
        <EmptyState title="No ledger data" hint={ledger.error ?? 'Nothing to show.'} icon={BookOpen} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Opening</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">₹ {money(data.openingBal)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">+ = receivable, − = payable</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Debit</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">₹ {money(totalDr)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Credit</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">₹ {money(totalCr)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Closing</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${data.closing >= 0 ? 'text-primary' : 'text-destructive'}`}>
                ₹ {money(data.closing)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {data.closing >= 0 ? 'receivable' : 'payable'}
              </p>
            </Card>
          </div>

          <Card className="p-0">
            <CardContent className="p-0">
              <div className="max-h-[62dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Voucher</TableHead>
                      <TableHead className="hidden sm:table-cell">Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="bg-muted/40">
                      <TableCell colSpan={5} className="hidden text-sm font-medium sm:table-cell">
                        Opening balance
                      </TableCell>
                      <TableCell colSpan={4} className="text-sm font-medium sm:hidden">
                        Opening balance
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">₹ {money(data.openingBal)}</TableCell>
                    </TableRow>
                    {data.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">{dateStr(r.date)}</TableCell>
                        <TableCell>
                          <span className="block text-xs font-medium">{r.voucherType}</span>
                          <span className="block text-xs tabular-nums text-muted-foreground">{r.voucherNo}</span>
                        </TableCell>
                        <TableCell className="hidden text-sm sm:table-cell">{r.accountName}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.debit > 0 ? money(r.debit) : ''}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.credit > 0 ? money(r.credit) : ''}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">₹ {money(r.balance)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell colSpan={3} className="hidden text-sm sm:table-cell">
                        <span className="inline-flex items-center gap-1.5">
                          <Scale className="size-3.5" aria-hidden /> Closing
                        </span>
                      </TableCell>
                      <TableCell colSpan={2} className="text-sm sm:hidden">
                        <span className="inline-flex items-center gap-1.5">
                          <Scale className="size-3.5" aria-hidden /> Closing
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(totalDr)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(totalCr)}</TableCell>
                      <TableCell className="text-right tabular-nums">₹ {money(data.closing)}</TableCell>
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
