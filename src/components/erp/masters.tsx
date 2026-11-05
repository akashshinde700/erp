'use client'

/**
 * ForgeERP — Masters view.
 * Parties (GSTIN live checksum), Items, Warehouses, Processes (WEIGHT/QTY
 * basis), Party Rates grid (full-list replace), Company profile.
 */

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  BookOpen,
  Building2,
  CheckCircle2,
  Database,
  Eye,
  HandCoins,
  ListChecks,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  ShoppingCart,
  Store,
  Wrench,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import {
  apiDelete,
  apiPost,
  apiPut,
  num,
  toastError,
  useApi,
  type Company,
  type Item,
  type Party,
  type PartyRateGrid,
  type PartyRateRow,
  type Process,
  type Warehouse,
} from './api'
import { EmptyState, Money, SectionHeading, TableSkeleton } from './bits'
import { useErpUi } from './store'
import { setCreatePreset } from './nav'
import { INDIAN_STATES, stateName, gstinChecksumValid, dateStr, money, PARTY_TYPES, UOMS } from '@/lib/erp'

const GST_RATES = [0, 5, 12, 18, 28]

export function MastersView() {
  return (
    <div className="space-y-4">
      <SectionHeading
        title="Masters"
        description="Parties, items, warehouses, process rates and the company profile — the reference data every transaction validates against."
      />
      <Tabs defaultValue="parties">
        <TabsList className="h-11 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="parties" className="h-9">Parties</TabsTrigger>
          <TabsTrigger value="items" className="h-9">Items</TabsTrigger>
          <TabsTrigger value="warehouses" className="h-9">Warehouses</TabsTrigger>
          <TabsTrigger value="processes" className="h-9">Processes</TabsTrigger>
          <TabsTrigger value="party-rates" className="h-9">Party Rates</TabsTrigger>
          <TabsTrigger value="company" className="h-9">Company</TabsTrigger>
        </TabsList>
        <TabsContent value="parties" className="mt-4"><PartiesTab /></TabsContent>
        <TabsContent value="items" className="mt-4"><ItemsTab /></TabsContent>
        <TabsContent value="warehouses" className="mt-4"><WarehousesTab /></TabsContent>
        <TabsContent value="processes" className="mt-4"><ProcessesTab /></TabsContent>
        <TabsContent value="party-rates" className="mt-4"><PartyRatesTab /></TabsContent>
        <TabsContent value="company" className="mt-4"><CompanyTab /></TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- shared bits ----------

function GstinHint({ value }: { value: string }) {
  if (!value.trim()) return <p className="text-xs text-muted-foreground">Optional for B2C / unregistered.</p>
  const ok = gstinChecksumValid(value)
  return (
    <p className={`flex items-center gap-1 text-xs font-medium ${ok ? 'text-primary' : 'text-destructive'}`}>
      {ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />}
      {ok ? 'Checksum valid' : 'Invalid GSTIN — checksum failed (format: 27ABCDE1234F1Z5)'}
    </p>
  )
}

function ActiveToggle({
  active,
  onToggle,
  label,
}: {
  active: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <Button
      variant={active ? 'ghost' : 'outline'}
      size="sm"
      onClick={onToggle}
      className={`h-11 md:h-9 ${active ? 'text-muted-foreground hover:text-destructive' : 'text-primary'}`}
    >
      {active ? 'Deactivate' : 'Reactivate'}
      <span className="sr-only"> — {label}</span>
    </Button>
  )
}

// ===========================================================================
// Parties
// ===========================================================================

function PartiesTab() {
  const list = useApi<Party[]>('/api/masters/parties')
  const setView = useErpUi((s) => s.setView)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Party | null>(null)
  const [viewing, setViewing] = useState<Party | null>(null)

  const parties = (list.data ?? []).filter((p) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.gstin ?? '').toLowerCase().includes(q)
  })

  const toggleActive = async (p: Party) => {
    try {
      await apiDelete(`/api/masters/parties/${p.id}${p.active ? '' : '?activate=1'}`)
      toast.success(`${p.code} ${p.active ? 'deactivated' : 'reactivated'}`)
      list.reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / code / GSTIN…"
            className="h-11 pl-8"
            aria-label="Search parties"
          />
        </div>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          className="h-11 gap-2"
        >
          <Plus className="size-4" aria-hidden /> New Party
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={8} cols={6} />
          ) : parties.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No parties" hint="Create customers, suppliers and jobworkers here." icon={Building2} />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Types</TableHead>
                    <TableHead>GSTIN</TableHead>
                    <TableHead className="hidden sm:table-cell">State</TableHead>
                    <TableHead className="hidden sm:table-cell">City</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Opening Bal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parties.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => setViewing(p)}>
                      <TableCell className="font-mono text-xs font-medium">{p.code}</TableCell>
                      <TableCell className="max-w-44 truncate font-medium">{p.name}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {p.types.split(',').filter(Boolean).map((t) => (
                            <Badge key={t} variant={t === 'CUSTOMER' ? 'default' : t === 'SUPPLIER' ? 'secondary' : 'outline'} className="text-[10px]">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{p.gstin ?? '—'}</TableCell>
                      <TableCell className="hidden text-xs sm:table-cell">{stateName(p.stateCode)}</TableCell>
                      <TableCell className="hidden text-xs sm:table-cell">{p.city ?? '—'}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        <Money value={p.openingBal} plain />
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.active ? 'default' : 'destructive'} className="text-[10px]">
                          {p.active ? 'ACTIVE' : 'INACTIVE'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 md:size-9"
                            onClick={() => setViewing(p)}
                            aria-label={`View ${p.code}`}
                            title="View profile & activity"
                          >
                            <Eye className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 md:size-9"
                            onClick={() => {
                              setEditing(p)
                              setDialogOpen(true)
                            }}
                            aria-label={`Edit ${p.code}`}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          <ActiveToggle active={p.active} onToggle={() => toggleActive(p)} label={p.code} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PartyDialog
        party={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => list.reload()}
      />

      <PartyViewDialog party={viewing} onOpenChange={(o) => !o && setViewing(null)} onNavigate={setView} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Party detail: profile + activity tabs + one-click next actions.
// ---------------------------------------------------------------------------

function PartyViewDialog({
  party,
  onOpenChange,
  onNavigate,
}: {
  party: Party | null
  onOpenChange: (o: boolean) => void
  onNavigate: (view: import('./store').ErpView) => void
}) {
  const open = !!party
  const types = party?.types.split(',').filter(Boolean) ?? []
  const isCustomer = types.includes('CUSTOMER')
  const isSupplier = types.includes('SUPPLIER')

  const sales = useApi<{ id: string; invoiceNo: string; date: string; grandTotal: number; paidAmount: number; status: string }[] | null>(
    party && isCustomer ? `/api/sales-invoices?partyId=${party.id}` : null
  )
  const purchases = useApi<{ id: string; invoiceNo: string; date: string; grandTotal: number; paidAmount: number; status: string }[] | null>(
    party && isSupplier ? `/api/purchase-invoices?partyId=${party.id}` : null
  )
  const payments = useApi<{ id: string; paymentNo: string; date: string; type: string; amount: number; mode: string | null; status: string }[] | null>(
    party ? `/api/payments?partyId=${party.id}` : null
  )

  if (!party) return null

  const close = () => onOpenChange(false)

  const newInvoice = () => {
    setCreatePreset({ type: 'sales-invoice', partyId: party.id })
    close()
    onNavigate('sales')
  }
  const newPurchase = () => {
    setCreatePreset({ type: 'purchase-invoice', partyId: party.id })
    close()
    onNavigate('purchase')
  }
  const receivePayment = () => {
    setCreatePreset({ type: 'payment', partyId: party.id, paymentType: 'RECEIPT' })
    close()
    onNavigate('accounting')
  }
  const makePayment = () => {
    setCreatePreset({ type: 'payment', partyId: party.id, paymentType: 'PAYMENT' })
    close()
    onNavigate('accounting')
  }
  const openLedger = () => {
    setCreatePreset({ type: 'party-ledger', partyId: party.id })
    close()
    onNavigate('accounting')
  }

  const salesRows = sales.data ?? []
  const purchaseRows = purchases.data ?? []
  const paymentRows = payments.data ?? []
  const receivable = salesRows
    .filter((i) => i.status === 'POSTED')
    .reduce((s, i) => s + i.grandTotal - i.paidAmount, 0)
  const payable = purchaseRows
    .filter((i) => i.status === 'POSTED')
    .reduce((s, i) => s + i.grandTotal - i.paidAmount, 0)

  const invLine = (i: { id: string; invoiceNo: string; date: string; grandTotal: number; paidAmount: number; status: string }) => (
    <TableRow key={i.id}>
      <TableCell className="font-medium tabular-nums">{i.invoiceNo}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">{dateStr(i.date)}</TableCell>
      <TableCell className="text-right tabular-nums">₹ {money(i.grandTotal)}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">₹ {money(i.paidAmount)}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">₹ {money(i.grandTotal - i.paidAmount)}</TableCell>
      <TableCell>
        <Badge variant={i.status === 'POSTED' ? 'default' : 'destructive'} className="text-[10px]">
          {i.status}
        </Badge>
      </TableCell>
    </TableRow>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {party.name}
            <span className="font-mono text-xs font-normal text-muted-foreground">{party.code}</span>
            {types.map((t) => (
              <Badge key={t} variant={t === 'CUSTOMER' ? 'default' : t === 'SUPPLIER' ? 'secondary' : 'outline'} className="text-[10px]">
                {t}
              </Badge>
            ))}
          </DialogTitle>
          <DialogDescription>
            {party.gstin ? `${party.gstin} · ` : 'Unregistered · '}
            {stateName(party.stateCode)}
            {party.city ? ` · ${party.city}` : ''}
            {party.pincode ? ` ${party.pincode}` : ''}
            {party.phone ? ` · ${party.phone}` : ''}
          </DialogDescription>
        </DialogHeader>

        {/* One-click next actions — the Mapsoft-style flow buttons */}
        <div className="flex flex-wrap gap-2">
          {isCustomer ? (
            <Button size="sm" className="h-10 gap-2" onClick={newInvoice}>
              <ReceiptText className="size-4" aria-hidden /> New Invoice
            </Button>
          ) : null}
          {isSupplier ? (
            <Button size="sm" variant="outline" className="h-10 gap-2" onClick={newPurchase}>
              <ShoppingCart className="size-4" aria-hidden /> New Purchase
            </Button>
          ) : null}
          {isCustomer ? (
            <Button size="sm" variant="outline" className="h-10 gap-2" onClick={receivePayment}>
              <HandCoins className="size-4" aria-hidden /> Receive Payment
            </Button>
          ) : null}
          {isSupplier ? (
            <Button size="sm" variant="outline" className="h-10 gap-2" onClick={makePayment}>
              <HandCoins className="size-4" aria-hidden /> Pay Supplier
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="h-10 gap-2" onClick={openLedger}>
            <BookOpen className="size-4" aria-hidden /> Party Ledger
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="min-w-0 rounded-md border bg-muted/30 p-2.5 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Receivable</p>
            <p className="truncate text-sm font-semibold tabular-nums text-primary" title={`₹ ${money(Math.max(0, receivable))}`}>₹ {money(Math.max(0, receivable))}</p>
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 p-2.5 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Payable</p>
            <p className="truncate text-sm font-semibold tabular-nums text-destructive" title={`₹ ${money(Math.max(0, payable))}`}>₹ {money(Math.max(0, payable))}</p>
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 p-2.5 text-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Vouchers</p>
            <p className="text-sm font-semibold tabular-nums">{salesRows.length + purchaseRows.length + paymentRows.length}</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <Tabs defaultValue={isCustomer ? 'sales' : 'purchases'}>
            <TabsList className="h-11 w-full justify-start overflow-x-auto sm:w-auto">
              {isCustomer ? <TabsTrigger value="sales" className="h-9 text-xs">Sales ({salesRows.length})</TabsTrigger> : null}
              {isSupplier ? <TabsTrigger value="purchases" className="h-9 text-xs">Purchases ({purchaseRows.length})</TabsTrigger> : null}
              <TabsTrigger value="payments" className="h-9 text-xs">Payments ({paymentRows.length})</TabsTrigger>
            </TabsList>
            {isCustomer ? (
              <TabsContent value="sales" className="mt-2">
                {salesRows.length === 0 ? (
                  <EmptyState title="No invoices yet" hint="Create the first invoice with the button above." />
                ) : (
                  <div className="max-h-64 overflow-auto rounded-md border erp-scroll">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>{salesRows.map((i) => invLine(i))}</TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            ) : null}
            {isSupplier ? (
              <TabsContent value="purchases" className="mt-2">
                {purchaseRows.length === 0 ? (
                  <EmptyState title="No purchases yet" hint="Record the first purchase invoice with the button above." />
                ) : (
                  <div className="max-h-64 overflow-auto rounded-md border erp-scroll">
                    <Table>
                      <TableHeader className="sticky top-0 bg-card">
                        <TableRow>
                          <TableHead>Invoice</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>{purchaseRows.map((i) => invLine(i))}</TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            ) : null}
            <TabsContent value="payments" className="mt-2">
              {paymentRows.length === 0 ? (
                <EmptyState title="No payments yet" hint="Receipts and payments for this party appear here." />
              ) : (
                <div className="max-h-64 overflow-auto rounded-md border erp-scroll">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>Voucher</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentRows.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium tabular-nums">{p.paymentNo}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{dateStr(p.date)}</TableCell>
                          <TableCell>
                            <Badge variant={p.type === 'RECEIPT' ? 'default' : 'secondary'} className="text-[10px]">
                              {p.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">₹ {money(p.amount)}</TableCell>
                          <TableCell className="text-xs">{p.mode ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant={p.status === 'POSTED' ? 'default' : 'destructive'} className="text-[10px]">
                              {p.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PartyDialog({
  party,
  open,
  onOpenChange,
  onSaved,
}: {
  party: Party | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [types, setTypes] = useState<Record<string, boolean>>({ CUSTOMER: true })
  const [gstin, setGstin] = useState('')
  const [stateCode, setStateCode] = useState('27')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [openingBal, setOpeningBal] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setCode(party?.code ?? '')
    setName(party?.name ?? '')
    const t: Record<string, boolean> = {}
    for (const ty of (party?.types ?? 'CUSTOMER').split(',').filter(Boolean)) t[ty] = true
    setTypes(t)
    setGstin(party?.gstin ?? '')
    setStateCode(party?.stateCode ?? '27')
    setAddress(party?.address ?? '')
    setCity(party?.city ?? '')
    setPincode(party?.pincode ?? '')
    setPhone(party?.phone ?? '')
    setEmail(party?.email ?? '')
    setOpeningBal(party ? String(party.openingBal) : '')
  }, [open, party])

  const chosenTypes = PARTY_TYPES.filter((t) => types[t])

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error('Code and name are required')
      return
    }
    if (chosenTypes.length === 0) {
      toast.error('Pick at least one party type')
      return
    }
    if (gstin.trim() && !gstinChecksumValid(gstin)) {
      toast.error('GSTIN checksum failed — fix or clear the field')
      return
    }
    if (pincode.trim() && !/^\d{6}$/.test(pincode.trim())) {
      toast.error('Pincode must be 6 digits — required for e-Invoice')
      return
    }
    setSaving(true)
    try {
      const body = {
        code: code.trim(),
        name: name.trim(),
        types: chosenTypes,
        gstin: gstin.trim() || null,
        stateCode,
        address: address.trim() || null,
        city: city.trim() || null,
        pincode: pincode.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        openingBal: num(openingBal),
      }
      const res = party
        ? await apiPut<Party>(`/api/masters/parties/${party.id}`, body)
        : await apiPost<Party>('/api/masters/parties', body)
      toast.success(`${res.code} saved`, { description: `${res.name} — ${chosenTypes.join(', ')}` })
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto erp-scroll-y sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{party ? `Edit ${party.code}` : 'New Party'}</DialogTitle>
          <DialogDescription>Customers, suppliers and jobworkers — GSTIN is checksum-validated live.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-code">Code *</Label>
            <Input id="p-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CUST-004" className="h-11" maxLength={20} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Name *</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Party legal name" className="h-11" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Types *</Label>
            <div className="flex flex-wrap gap-4 pt-1">
              {PARTY_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!types[t]}
                    onCheckedChange={(v) => setTypes((s) => ({ ...s, [t]: v === true }))}
                    aria-label={t}
                    className="size-5"
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-gstin">GSTIN</Label>
            <Input
              id="p-gstin"
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              placeholder="27ABCDE1234F1Z5"
              className="h-11 font-mono"
              maxLength={15}
            />
            <GstinHint value={gstin} />
          </div>
          <div className="space-y-1.5">
            <Label>State</Label>
            <Select value={stateCode} onValueChange={setStateCode}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {INDIAN_STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.code}-{s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-address">Address</Label>
            <Input id="p-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street / area" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-city">City</Label>
            <Input id="p-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-pin">Pincode</Label>
            <Input
              id="p-pin"
              value={pincode}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="411026"
              className="h-11"
              inputMode="numeric"
              pattern="[0-9]{6}"
            />
            <p className="text-xs text-muted-foreground">Needed for e-Invoice BuyerDtls (IRP).</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-phone">Phone</Label>
            <Input id="p-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-email">Email</Label>
            <Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.in" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-bal">Opening Balance ₹</Label>
            <Input
              id="p-bal"
              type="number"
              step="any"
              value={openingBal}
              onChange={(e) => setOpeningBal(e.target.value)}
              placeholder="0"
              className="h-11 text-right tabular-nums"
            />
            <p className="text-xs text-muted-foreground">+ = receivable (customer), − = payable (supplier)</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="h-11">
            {saving ? 'Saving…' : party ? 'Save changes' : 'Create party'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Items
// ===========================================================================

function ItemsTab() {
  const list = useApi<Item[]>('/api/masters/items')
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)

  const items = (list.data ?? []).filter((i) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || (i.hsn ?? '').includes(q)
  })

  const toggleActive = async (it: Item) => {
    try {
      await apiDelete(`/api/masters/items/${it.id}${it.active ? '' : '?activate=1'}`)
      toast.success(`${it.code} ${it.active ? 'deactivated' : 'reactivated'}`)
      list.reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code / name / HSN…"
            className="h-11 pl-8"
            aria-label="Search items"
          />
        </div>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          className="h-11 gap-2"
        >
          <Plus className="size-4" aria-hidden /> New Item
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={8} cols={7} />
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No items" hint="Create finished goods, raw materials and services." icon={Package} />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Group</TableHead>
                    <TableHead className="hidden sm:table-cell">HSN</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">GST %</TableHead>
                    <TableHead className="text-right">Sale Rate</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Cost Rate</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Reorder</TableHead>
                    <TableHead className="hidden sm:table-cell">Flags</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-mono text-xs font-medium">{it.code}</TableCell>
                      <TableCell className="max-w-44 truncate font-medium">{it.name}</TableCell>
                      <TableCell className="hidden text-xs sm:table-cell">{it.groupName}</TableCell>
                      <TableCell className="hidden font-mono text-xs tabular-nums sm:table-cell">{it.hsn ?? '—'}</TableCell>
                      <TableCell className="text-xs">{it.uom}</TableCell>
                      <TableCell className="text-right tabular-nums">{it.gstRate}%</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Money value={it.saleRate} plain />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        <Money value={it.costRate} plain />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{it.reorderLevel}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {it.isService ? <Badge variant="outline" className="text-[10px]">SERVICE</Badge> : null}
                          {it.isStockItem ? <Badge variant="secondary" className="text-[10px]">STOCK</Badge> : null}
                          {!it.active ? <Badge variant="destructive" className="text-[10px]">INACTIVE</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 md:size-9"
                            onClick={() => {
                              setEditing(it)
                              setDialogOpen(true)
                            }}
                            aria-label={`Edit ${it.code}`}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          <ActiveToggle active={it.active} onToggle={() => toggleActive(it)} label={it.code} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ItemDialog item={editing} open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => list.reload()} />
    </div>
  )
}

function ItemDialog({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item: Item | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [hsn, setHsn] = useState('')
  const [isService, setIsService] = useState(false)
  const [isStockItem, setIsStockItem] = useState(true)
  const [uom, setUom] = useState<string>('PCS')
  const [gstRate, setGstRate] = useState('18')
  const [saleRate, setSaleRate] = useState('')
  const [costRate, setCostRate] = useState('')
  const [reorderLevel, setReorderLevel] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setCode(item?.code ?? '')
    setName(item?.name ?? '')
    setGroupName(item?.groupName ?? '')
    setHsn(item?.hsn ?? '')
    setIsService(item?.isService ?? false)
    setIsStockItem(item?.isStockItem ?? true)
    setUom(item?.uom ?? 'PCS')
    setGstRate(item ? String(item.gstRate) : '18')
    setSaleRate(item ? String(item.saleRate) : '')
    setCostRate(item ? String(item.costRate) : '')
    setReorderLevel(item ? String(item.reorderLevel) : '')
  }, [open, item])

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error('Code and name are required')
      return
    }
    setSaving(true)
    try {
      const body = {
        code: code.trim(),
        name: name.trim(),
        groupName: groupName.trim() || undefined,
        hsn: hsn.trim() || undefined,
        isService,
        isStockItem: isService ? false : isStockItem,
        uom,
        gstRate: num(gstRate),
        saleRate: num(saleRate),
        costRate: num(costRate),
        reorderLevel: num(reorderLevel),
      }
      const res = item
        ? await apiPut<Item>(`/api/masters/items/${item.id}`, body)
        : await apiPost<Item>('/api/masters/items', body)
      toast.success(`${res.code} saved`, { description: `${res.name} · ${res.uom} · GST ${res.gstRate}%` })
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto erp-scroll-y sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? `Edit ${item.code}` : 'New Item'}</DialogTitle>
          <DialogDescription>Finished goods, raw material or service — services skip the stock ledger.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="i-code">Code *</Label>
            <Input id="i-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="FG-1004" className="h-11" maxLength={30} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-name">Name *</Label>
            <Input id="i-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-group">Group</Label>
            <Input id="i-group" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Finished Goods" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-hsn">HSN / SAC</Label>
            <Input id="i-hsn" value={hsn} onChange={(e) => setHsn(e.target.value)} placeholder="8483" className="h-11 font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label>UOM</Label>
            <Select value={uom} onValueChange={setUom}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UOMS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>GST Rate</Label>
            <Select value={gstRate} onValueChange={setGstRate}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GST_RATES.map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {r}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-sale">Sale Rate ₹</Label>
            <Input id="i-sale" type="number" min="0" step="any" value={saleRate} onChange={(e) => setSaleRate(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-cost">Cost Rate ₹</Label>
            <Input id="i-cost" type="number" min="0" step="any" value={costRate} onChange={(e) => setCostRate(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="i-reorder">Reorder Level</Label>
            <Input id="i-reorder" type="number" min="0" step="any" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
          </div>
          <div className="flex items-center gap-6 pt-4">
            <div className="flex items-center gap-2">
              <Switch
                id="i-service"
                checked={isService}
                onCheckedChange={(v) => {
                  setIsService(v)
                  if (v) setIsStockItem(false)
                }}
                aria-label="Service item"
              />
              <Label htmlFor="i-service" className="text-sm font-normal text-muted-foreground">Service</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="i-stock"
                checked={isStockItem && !isService}
                disabled={isService}
                onCheckedChange={setIsStockItem}
                aria-label="Stock item"
              />
              <Label htmlFor="i-stock" className="text-sm font-normal text-muted-foreground">Stock item</Label>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="h-11">
            {saving ? 'Saving…' : item ? 'Save changes' : 'Create item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Warehouses
// ===========================================================================

function WarehousesTab() {
  const list = useApi<Warehouse[]>('/api/masters/warehouses')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Warehouse | null>(null)

  const toggleActive = async (w: Warehouse) => {
    try {
      await apiDelete(`/api/masters/warehouses/${w.id}${w.active ? '' : '?activate=1'}`)
      toast.success(`${w.code} ${w.active ? 'deactivated' : 'reactivated'}`)
      list.reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">Stock locations — every ledger row carries a warehouse.</p>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          className="h-11 gap-2"
        >
          <Plus className="size-4" aria-hidden /> New Warehouse
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={4} cols={4} />
          ) : (list.data ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState title="No warehouses" hint="Create at least one stores location." icon={Store} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(list.data ?? []).map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-mono text-xs font-medium">{w.code}</TableCell>
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{w.location ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={w.active ? 'default' : 'destructive'} className="text-[10px]">
                          {w.active ? 'ACTIVE' : 'INACTIVE'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 md:size-9"
                            onClick={() => {
                              setEditing(w)
                              setDialogOpen(true)
                            }}
                            aria-label={`Edit ${w.code}`}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          <ActiveToggle active={w.active} onToggle={() => toggleActive(w)} label={w.code} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <WarehouseDialog warehouse={editing} open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => list.reload()} />
    </div>
  )
}

function WarehouseDialog({
  warehouse,
  open,
  onOpenChange,
  onSaved,
}: {
  warehouse: Warehouse | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setCode(warehouse?.code ?? '')
    setName(warehouse?.name ?? '')
    setLocation(warehouse?.location ?? '')
  }, [open, warehouse])

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error('Code and name are required')
      return
    }
    setSaving(true)
    try {
      const body = { code: code.trim(), name: name.trim(), location: location.trim() || undefined }
      const res = warehouse
        ? await apiPut<Warehouse>(`/api/masters/warehouses/${warehouse.id}`, body)
        : await apiPost<Warehouse>('/api/masters/warehouses', body)
      toast.success(`${res.code} saved`)
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{warehouse ? `Edit ${warehouse.code}` : 'New Warehouse'}</DialogTitle>
          <DialogDescription>A physical stock location.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="w-code">Code *</Label>
            <Input id="w-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MAIN" className="h-11" maxLength={20} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-name">Name *</Label>
            <Input id="w-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Main Stores" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-loc">Location</Label>
            <Input id="w-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Plant / city" className="h-11" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="h-11">
            {saving ? 'Saving…' : warehouse ? 'Save changes' : 'Create warehouse'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Processes
// ===========================================================================

function ProcessesTab() {
  const list = useApi<Process[]>('/api/masters/processes')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Process | null>(null)

  const toggleActive = async (p: Process) => {
    try {
      await apiDelete(`/api/masters/processes/${p.id}${p.active ? '' : '?activate=1'}`)
      toast.success(`${p.code} ${p.active ? 'deactivated' : 'reactivated'}`)
      list.reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">Jobwork routing — rate per KG (WEIGHT) or per piece (QTY).</p>
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
          className="h-11 gap-2"
        >
          <Plus className="size-4" aria-hidden /> New Process
        </Button>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={5} cols={5} />
          ) : (list.data ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState title="No processes" hint="Define the treatment steps used on job cards." icon={Wrench} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">Seq</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Basis</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Lot Charge</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-36" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(list.data ?? [])
                    .slice()
                    .sort((a, b) => a.seq - b.seq)
                    .map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-right tabular-nums">{p.seq}</TableCell>
                        <TableCell className="font-mono text-xs font-medium">{p.code}</TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">
                            {p.basis === 'WEIGHT' ? '₹ per KG' : '₹ per piece'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">₹ {money(p.rate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.lotCharge > 0 ? `₹ ${money(p.lotCharge)}` : '—'}</TableCell>
                        <TableCell>
                          <Badge variant={p.active ? 'default' : 'destructive'} className="text-[10px]">
                            {p.active ? 'ACTIVE' : 'INACTIVE'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-11 md:size-9"
                              onClick={() => {
                                setEditing(p)
                                setDialogOpen(true)
                              }}
                              aria-label={`Edit ${p.code}`}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                            <ActiveToggle active={p.active} onToggle={() => toggleActive(p)} label={p.code} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProcessDialog process={editing} open={dialogOpen} onOpenChange={setDialogOpen} onSaved={() => list.reload()} />
    </div>
  )
}

function ProcessDialog({
  process,
  open,
  onOpenChange,
  onSaved,
}: {
  process: Process | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [seq, setSeq] = useState('')
  const [basis, setBasis] = useState<'WEIGHT' | 'QTY'>('WEIGHT')
  const [rate, setRate] = useState('')
  const [lotCharge, setLotCharge] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setCode(process?.code ?? '')
    setName(process?.name ?? '')
    setSeq(process ? String(process.seq) : '')
    setBasis((process?.basis as 'WEIGHT' | 'QTY') ?? 'WEIGHT')
    setRate(process ? String(process.rate) : '')
    setLotCharge(process ? String(process.lotCharge) : '')
  }, [open, process])

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error('Code and name are required')
      return
    }
    setSaving(true)
    try {
      const body = {
        code: code.trim(),
        name: name.trim(),
        seq: num(seq),
        basis,
        rate: num(rate),
        lotCharge: num(lotCharge),
      }
      const res = process
        ? await apiPut<Process>(`/api/masters/processes/${process.id}`, body)
        : await apiPost<Process>('/api/masters/processes', body)
      toast.success(`${res.code} saved`, { description: `${res.name} · ₹ ${money(res.rate)} ${res.basis === 'WEIGHT' ? 'per KG' : 'per piece'}` })
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{process ? `Edit ${process.code}` : 'New Process'}</DialogTitle>
          <DialogDescription>A jobwork treatment step with its default rate.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pr-code">Code *</Label>
              <Input id="pr-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="HT" className="h-11" maxLength={20} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-seq">Sequence</Label>
              <Input id="pr-seq" type="number" value={seq} onChange={(e) => setSeq(e.target.value)} placeholder="1" className="h-11 text-right tabular-nums" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pr-name">Name *</Label>
            <Input id="pr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Heat Treatment" className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label>Basis</Label>
            <Select value={basis} onValueChange={(v) => setBasis(v as 'WEIGHT' | 'QTY')}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WEIGHT">WEIGHT — ₹ per KG</SelectItem>
                <SelectItem value="QTY">QTY — ₹ per piece</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {basis === 'WEIGHT' ? 'Charged on the processed weight (kg)' : 'Charged on the processed quantity (pieces)'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pr-rate">Rate ₹</Label>
              <Input id="pr-rate" type="number" min="0" step="any" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-lot">Lot Charge ₹</Label>
              <Input id="pr-lot" type="number" min="0" step="any" value={lotCharge} onChange={(e) => setLotCharge(e.target.value)} placeholder="0" className="h-11 text-right tabular-nums" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="h-11">
            {saving ? 'Saving…' : process ? 'Save changes' : 'Create process'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Party rates
// ===========================================================================

function PartyRatesTab() {
  const partiesApi = useApi<Party[]>('/api/masters/parties')
  const parties = partiesApi.data ?? []
  const [partyId, setPartyId] = useState('')
  const grid = useApi<PartyRateGrid | null>(partyId ? `/api/masters/party-rates?partyId=${partyId}` : null)
  const [rows, setRows] = useState<PartyRateRow[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRows((grid.data?.rows ?? []).map((r) => ({ ...r })))
  }, [grid.data])

  const sortedParties = useMemo(() => [...parties].sort((a, b) => a.name.localeCompare(b.name)), [parties])

  const changedCount = rows.filter((r) => r.rate !== r.defaultRate || r.lotCharge !== r.defaultLot).length

  const setRow = (processId: string, patch: Partial<PartyRateRow>) =>
    setRows((rs) => rs.map((r) => (r.processId === processId ? { ...r, ...patch } : r)))

  const save = async () => {
    if (!partyId) return
    setSaving(true)
    try {
      // full-list replace — send only rows that differ from the process defaults
      const rates = rows
        .filter((r) => r.rate !== r.defaultRate || r.lotCharge !== r.defaultLot)
        .map((r) => ({ processId: r.processId, rate: r.rate, lotCharge: r.lotCharge }))
      const res = await apiPut<{ partyId: string; count: number }>('/api/masters/party-rates', { partyId, rates })
      toast.success('Party rates saved', {
        description: `${res.count} overridden rate${res.count === 1 ? '' : 's'} stored — job cards for this party now bill at these rates.`,
      })
      grid.reload()
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:max-w-md">
        <Label>Party</Label>
        <Select value={partyId || undefined} onValueChange={setPartyId}>
          <SelectTrigger className="h-11 w-full">
            <SelectValue placeholder="Select party…" />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {sortedParties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.code} — {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!partyId ? (
        <EmptyState
          title="Pick a party"
          hint="Override the default process rates for a specific customer — job cards resolve these automatically."
          icon={ListChecks}
        />
      ) : grid.loading ? (
        <TableSkeleton rows={6} cols={4} />
      ) : rows.length === 0 ? (
        <EmptyState title="No processes" hint="Define processes first (Processes tab)." icon={Wrench} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {rows.length} processes ·{' '}
              <span className="font-medium text-foreground">{changedCount}</span> changed from defaults
            </p>
            <Button onClick={save} disabled={saving} className="h-11 gap-2">
              {saving ? 'Saving…' : 'Save rates'}
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Process</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead className="text-right">Default Rate</TableHead>
                  <TableHead className="text-right">Default Lot</TableHead>
                  <TableHead className="w-32 text-right">Rate ₹</TableHead>
                  <TableHead className="w-32 text-right">Lot ₹</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const overridden = r.rate !== r.defaultRate || r.lotCharge !== r.defaultLot
                  return (
                    <TableRow key={r.processId}>
                      <TableCell>
                        <span className="block font-medium">{r.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{r.code}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">
                          {r.basis === 'WEIGHT' ? 'per KG' : 'per piece'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">₹ {money(r.defaultRate)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">₹ {money(r.defaultLot)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={r.rate}
                          onChange={(e) => setRow(r.processId, { rate: num(e.target.value) })}
                          className="h-11 text-right tabular-nums"
                          aria-label={`Rate for ${r.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={r.lotCharge}
                          onChange={(e) => setRow(r.processId, { lotCharge: num(e.target.value) })}
                          className="h-11 text-right tabular-nums"
                          aria-label={`Lot charge for ${r.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        {overridden ? (
                          <Badge className="gap-1 text-[10px]">
                            <ListChecks className="size-3" aria-hidden /> OVERRIDDEN
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">default</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Saving stores only the rows that differ from the process defaults (full-list replace) — clearing both
            fields back to defaults removes the override.
          </p>
        </>
      )}
    </div>
  )
}

// ===========================================================================
// Company
// ===========================================================================

function CompanyTab() {
  const comp = useApi<Company | null>('/api/masters/company')
  const [name, setName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [gstin, setGstin] = useState('')
  const [stateCode, setStateCode] = useState('27')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankAcct, setBankAcct] = useState('')
  const [bankIfsc, setBankIfsc] = useState('')
  const [upiId, setUpiId] = useState('')
  const [saving, setSaving] = useState(false)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (!initialized && !comp.loading) {
      const c = comp.data
      setName(c?.name ?? '')
      setLegalName(c?.legalName ?? '')
      setGstin(c?.gstin ?? '')
      setStateCode(c?.stateCode ?? '27')
      setAddress(c?.address ?? '')
      setCity(c?.city ?? '')
      setPincode(c?.pincode ?? '')
      setPhone(c?.phone ?? '')
      setEmail(c?.email ?? '')
      setBankName(c?.bankName ?? '')
      setBankAcct(c?.bankAcct ?? '')
      setBankIfsc(c?.bankIfsc ?? '')
      setUpiId(c?.upiId ?? '')
      setInitialized(true)
    }
  }, [comp.data, comp.loading, initialized])

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Company name is required')
      return
    }
    if (gstin.trim() && !gstinChecksumValid(gstin)) {
      toast.error('GSTIN checksum failed — fix or clear the field')
      return
    }
    setSaving(true)
    try {
      const res = await apiPut<Company>('/api/masters/company', {
        name: name.trim(),
        legalName: legalName.trim() || null,
        gstin: gstin.trim() || null,
        stateCode,
        address: address.trim() || null,
        city: city.trim() || null,
        pincode: pincode.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        bankName: bankName.trim() || null,
        bankAcct: bankAcct.trim() || null,
        bankIfsc: bankIfsc.trim() || null,
        upiId: upiId.trim() || null,
      })
      toast.success(`${res.name} saved`, { description: 'Used on invoice prints and for the inter-state GST split.' })
      comp.reload()
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  if (comp.loading) return <TableSkeleton rows={6} cols={2} />

  return (
    <Card className="mx-auto w-full max-w-3xl p-6">
      <div className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Database className="size-4" aria-hidden />
        </span>
        <div>
          <p className="font-semibold">Company Profile</p>
          <p className="text-xs text-muted-foreground">Printed on invoices; the state code drives IGST vs CGST+SGST.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="c-name">Trade Name *</Label>
          <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shree Forge Industries" className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-legal">Legal Name</Label>
          <Input id="c-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Shree Forge Industries Pvt. Ltd." className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-gstin">GSTIN</Label>
          <Input
            id="c-gstin"
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
            placeholder="27ABCDE1234F1Z5"
            className="h-11 font-mono"
            maxLength={15}
          />
          <GstinHint value={gstin} />
        </div>
        <div className="space-y-1.5">
          <Label>State (Place of Business)</Label>
          <Select value={stateCode} onValueChange={setStateCode}>
            <SelectTrigger className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {INDIAN_STATES.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {s.code}-{s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-pin">Pincode</Label>
          <Input id="c-pin" value={pincode} onChange={(e) => setPincode(e.target.value.replace(/[^0-9]/g, ''))} placeholder="411026" className="h-11" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="c-addr">Address</Label>
          <Input id="c-addr" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Plot 21, MIDC Bhosari…" className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-city">City</Label>
          <Input id="c-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Pune" className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-phone">Phone</Label>
          <Input id="c-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" className="h-11" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="c-email">Email</Label>
          <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="accounts@shreeforge.in" className="h-11" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="c-bank">Bank Name</Label>
          <Input id="c-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="HDFC Bank" className="h-11" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-acct">Bank A/c No</Label>
          <Input id="c-acct" value={bankAcct} onChange={(e) => setBankAcct(e.target.value)} placeholder="50200012345678" className="h-11 font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-ifsc">IFSC</Label>
          <Input id="c-ifsc" value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} placeholder="HDFC0000123" className="h-11 font-mono" maxLength={11} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-upi">UPI ID</Label>
          <Input id="c-upi" value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="shreeforge@upi" className="h-11" />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={submit} disabled={saving} className="h-11 w-full sm:w-auto">
          {saving ? 'Saving…' : 'Save company profile'}
        </Button>
      </div>
    </Card>
  )
}
