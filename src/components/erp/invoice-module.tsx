'use client'

/**
 * ForgeERP — shared invoice module (sales & purchase mirrors).
 * List + filters, create dialog with live GST preview via the shared pure
 * engine (`computeInvoiceTotals` from `@/lib/erp`), detail view with the
 * GST print layout and cancel (reversal) flow.
 */

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Braces,
  Copy,
  Eye,
  FileCode2,
  FileDown,
  FileSpreadsheet,
  HandCoins,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  ScrollText,
  Search,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  apiDelete,
  apiGet,
  apiPost,
  downloadCsv,
  downloadUrl,
  num,
  partyTypes,
  toastError,
  todayISO,
  useApi,
  useMasters,
  type Item,
  type Party,
  type PurchaseInvoice,
  type SalesInvoice,
} from './api'
import { useCompany } from './company'
import { EmptyState, Money, SectionHeading, SourceBadge, StatusBadge, TableSkeleton } from './bits'
import { useErpUi } from './store'
import { onPreset, setCreatePreset, takeCreatePreset } from './nav'
import { computeInvoiceTotals, dateStr, INDIAN_STATES, money, r2, stateName } from '@/lib/erp'
import { InvoicePrint } from './invoice-print'
import { exportEInvoiceJson, exportTallyVoucher, markTallySent, queueForConnector } from './tally'

export type InvoiceKind = 'SALES' | 'PURCHASE'

type AnyInvoice = SalesInvoice | PurchaseInvoice

let lineSeq = 0
const newKey = (): string => `line-${++lineSeq}`

interface LineDraft {
  key: string
  itemId: string
  detail: string
  qty: string
  rate: string
  discPct: string
}

const emptyLine = (): LineDraft => ({ key: newKey(), itemId: '', detail: '', qty: '', rate: '', discPct: '' })

// ===========================================================================
// List view
// ===========================================================================

export function InvoiceModule({ kind }: { kind: InvoiceKind }) {
  const setView = useErpUi((s) => s.setView)
  const isSales = kind === 'SALES'
  const path = isSales ? '/api/sales-invoices' : '/api/purchase-invoices'
  const list = useApi<AnyInvoice[]>(path)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'POSTED' | 'CANCELLED'>('ALL')
  const [createOpen, setCreateOpen] = useState(false)
  const [presetPartyId, setPresetPartyId] = useState('')
  const [prefill, setPrefill] = useState<AnyInvoice | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Cross-module create preset (dashboard / palette / party view / Alt+S) —
  // opens the create dialog prefilled with the party.
  useEffect(() => {
    const apply = (p: { type?: string; partyId?: string }) => {
      if (p.type !== (isSales ? 'sales-invoice' : 'purchase-invoice')) return
      setPrefill(null)
      setPresetPartyId(p.partyId ?? '')
      setCreateOpen(true)
    }
    // Preset may have been written a moment before mount (sessionStorage).
    const pending = takeCreatePreset()
    if (pending) apply(pending)
    return onPreset(apply)
  }, [])

  const invoices = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (list.data ?? []).filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false
      if (!q) return true
      return (
        inv.invoiceNo.toLowerCase().includes(q) ||
        (inv.party?.name ?? '').toLowerCase().includes(q) ||
        (inv.party?.code ?? '').toLowerCase().includes(q)
      )
    })
  }, [list.data, search, statusFilter])

  const totals = useMemo(() => {
    const posted = invoices.filter((i) => i.status === 'POSTED')
    const grand = posted.reduce((s, i) => s + i.grandTotal, 0)
    const paid = posted.reduce((s, i) => s + i.paidAmount, 0)
    return { count: posted.length, grand, paid, outstanding: grand - paid }
  }, [invoices])

  const duplicate = async (inv: AnyInvoice) => {
    try {
      const full = await apiGet<AnyInvoice>(isSales ? `/api/sales-invoices/${inv.id}` : `/api/purchase-invoices/${inv.id}`)
      setPrefill(full)
      setCreateOpen(true)
    } catch (e) {
      toastError(e)
    }
  }

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      ['Invoice No', 'Date', 'Party', 'Taxable', 'CGST', 'SGST', 'IGST', 'Grand Total', 'Paid', 'Status', 'Source'],
      ...invoices.map((i) => [
        i.invoiceNo,
        dateStr(i.date),
        i.party?.name ?? '',
        i.taxable,
        i.cgst,
        i.sgst,
        i.igst,
        i.grandTotal,
        i.paidAmount,
        i.status,
        isSales ? (i as SalesInvoice).source : '',
      ]),
    ]
    downloadCsv(`${isSales ? 'sales' : 'purchase'}-invoices-${todayISO()}.csv`, rows)
  }

  return (
    <div className="space-y-4">
      <SectionHeading
        title={isSales ? 'Sales Invoices' : 'Purchase Invoices'}
        description={
          isSales
            ? 'GST tax invoices — posted atomically with stock ledger and double-entry GL.'
            : 'Supplier purchase invoices — input GST, stock inward @ cost, GL in one transaction.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => list.reload()} className="h-11 gap-2">
              <RefreshCw className="size-4" aria-hidden /> Refresh
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={invoices.length === 0} className="h-11 gap-2">
              <FileDown className="size-4" aria-hidden /> CSV
            </Button>
            <Button onClick={() => { setPrefill(null); setCreateOpen(true) }} className="h-11 gap-2">
              <Plus className="size-4" aria-hidden />
              New {isSales ? 'Invoice' : 'Purchase'}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice no / party…"
            className="h-11 pl-8"
            aria-label="Search invoices"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="h-11 w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="POSTED">Posted</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="tabular-nums">{totals.count} posted</Badge>
          <span className="tabular-nums">Σ ₹ {money(totals.grand)}</span>
          <span className="tabular-nums">outstanding ₹ {money(totals.outstanding)}</span>
        </div>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {list.loading ? (
            <TableSkeleton rows={6} cols={7} />
          ) : invoices.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No invoices found"
                hint={isSales ? 'Post your first sales invoice to see it here.' : 'Record your first purchase invoice.'}
                action={
                  <Button variant="outline" onClick={() => setCreateOpen(true)} className="mt-2 h-11 gap-2">
                    <Plus className="size-4" aria-hidden /> New {isSales ? 'Invoice' : 'Purchase'}
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Invoice No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Taxable</TableHead>
                    <TableHead className="hidden text-right md:table-cell">GST</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Paid</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Balance</TableHead>
                    {isSales ? <TableHead className="hidden lg:table-cell">Source</TableHead> : null}
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow
                      key={inv.id}
                      className="cursor-pointer"
                      onClick={() => setView(isSales ? 'sales-detail' : 'purchase-detail', { id: inv.id })}
                    >
                      <TableCell className="font-medium tabular-nums">{inv.invoiceNo}</TableCell>
                      <TableCell className="whitespace-nowrap">{dateStr(inv.date)}</TableCell>
                      <TableCell className="max-w-44 truncate">
                        <span className="block truncate">{inv.party?.name ?? '—'}</span>
                        <span className="block text-xs text-muted-foreground">{inv.party?.code}</span>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        <Money value={inv.taxable} plain />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        <Money value={inv.cgst + inv.sgst + inv.igst} plain />
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        <Money value={inv.grandTotal} plain />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        <Money value={inv.paidAmount} plain />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        <Money value={inv.grandTotal - inv.paidAmount} plain />
                      </TableCell>
                      {isSales ? (
                        <TableCell className="hidden lg:table-cell">
                          <SourceBadge source={(inv as SalesInvoice).source} />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <StatusBadge status={inv.status} />
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex items-center justify-end gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hidden size-9 text-muted-foreground hover:text-foreground md:inline-flex md:size-8"
                            onClick={() => setView(isSales ? 'sales-detail' : 'purchase-detail', { id: inv.id })}
                            aria-label={`View ${inv.invoiceNo}`}
                            title="View detail"
                          >
                            <Eye className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-9 text-muted-foreground hover:text-foreground md:size-8"
                            onClick={() => void duplicate(inv)}
                            disabled={inv.status === 'CANCELLED'}
                            aria-label={`Duplicate ${inv.invoiceNo}`}
                            title="Duplicate as new draft"
                          >
                            <Copy className="size-4" aria-hidden />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-9 text-muted-foreground hover:text-foreground md:size-8"
                                disabled={inv.status === 'CANCELLED'}
                                aria-label={`Tally export ${inv.invoiceNo}`}
                                title="Tally export"
                              >
                                <FileDown className="size-4" aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => void exportTallyVoucher(isSales ? 'SALES' : 'PURCHASE', inv.id, 'xml')}>
                                <FileCode2 className="size-4" aria-hidden /> Tally XML (import file)
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void exportTallyVoucher(isSales ? 'SALES' : 'PURCHASE', inv.id, 'json')}>
                                <Braces className="size-4" aria-hidden /> Tally JSON
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void exportTallyVoucher(isSales ? 'SALES' : 'PURCHASE', inv.id, 'csv')}>
                                <FileSpreadsheet className="size-4" aria-hidden /> Tally Excel (CSV)
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => downloadUrl('/downloads/tally/Tally-Import.bat')}>
                                <Terminal className="size-4" aria-hidden /> Tally importer (.bat)
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => downloadUrl('/api/tally/masters?parties=1')}>
                                <FileDown className="size-4" aria-hidden /> Tally masters (XML)
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => void queueForConnector(isSales ? 'SALES' : 'PURCHASE', inv.id)}>
                                Queue for Tally connector
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void markTallySent(isSales ? 'SALES' : 'PURCHASE', inv.id, true)}>
                                Mark as sent to Tally
                              </DropdownMenuItem>
                              {isSales ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => void exportEInvoiceJson(inv.id)}>
                                    <ScrollText className="size-4" aria-hidden /> e-Invoice JSON (GST portal)
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      <CreateInvoiceDialog
        kind={kind}
        open={createOpen}
        prefill={prefill}
        presetPartyId={presetPartyId}
        onOpenChange={(o) => {
          setCreateOpen(o)
          if (!o) {
            setPrefill(null)
            setPresetPartyId('')
            setReloadTick((t) => t + 1)
          }
        }}
        onCreated={() => {
          list.reload()
        }}
        key={`create-${reloadTick}`}
      />
    </div>
  )
}

// ===========================================================================
// Create dialog with live GST preview
// ===========================================================================

function CreateInvoiceDialog({
  kind,
  open,
  prefill,
  presetPartyId,
  onOpenChange,
  onCreated,
}: {
  kind: InvoiceKind
  open: boolean
  prefill: AnyInvoice | null
  presetPartyId?: string
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const isSales = kind === 'SALES'
  const setView = useErpUi((s) => s.setView)
  const { parties, items, warehouses } = useMasters()
  const company = useCompany()
  const itemMap = useMemo(() => new Map<string, Item>(items.map((i) => [i.id, i])), [items])

  const eligibleParties = parties.filter(
    (p) => p.active && partyTypes(p).includes(isSales ? 'CUSTOMER' : 'SUPPLIER')
  )

  const [partyId, setPartyId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [pos, setPos] = useState('')
  const [taxInclusive, setTaxInclusive] = useState(false)
  const [poNo, setPoNo] = useState('')
  const [remarks, setRemarks] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [saving, setSaving] = useState(false)

  // Duplicate prefill: populate from an existing invoice (new number is assigned server-side).
  useEffect(() => {
    if (!open || !prefill) return
    setPartyId(prefill.partyId)
    setDate(String(prefill.date).slice(0, 10))
    setPoNo(prefill.poNo ?? '')
    setRemarks(prefill.remarks ?? '')
    setTaxInclusive(prefill.taxInclusive)
    if (isSales) setPos((prefill as SalesInvoice).pos ?? '')
    const items = prefill.items ?? []
    if (items.length > 0) {
      setLines(
        items.map((l) => ({
          key: newKey(),
          itemId: l.itemId,
          detail: l.detail ?? '',
          qty: String(l.qty),
          rate: String(l.rate),
          discPct: String(l.discPct ?? ''),
        }))
      )
    }
  }, [open, prefill, isSales])

  // Cross-module preset: just the party (e.g. "New invoice for this customer").
  useEffect(() => {
    if (!open) return
    if (presetPartyId) {
      setPartyId(presetPartyId)
      const p = parties.find((x) => x.id === presetPartyId)
      if (isSales && p) setPos(p.stateCode)
    }
  }, [open, presetPartyId, parties, isSales])

  const party: Party | undefined = parties.find((p) => p.id === partyId)
  const companyState = company?.stateCode ?? '27'

  const onPartyChange = (id: string) => {
    setPartyId(id)
    const p = parties.find((x) => x.id === id)
    if (isSales && p) setPos(p.stateCode) // PoS defaults to the party's state
  }

  const interState = isSales
    ? pos !== '' && pos !== companyState
    : !!party && party.stateCode !== companyState

  const validLines = lines.filter((l) => l.itemId && num(l.qty) > 0)

  const taxLines = validLines.map((l) => ({
    qty: num(l.qty),
    rate: num(l.rate),
    discPct: num(l.discPct) || 0,
    gstRate: itemMap.get(l.itemId)?.gstRate ?? 0,
  }))

  // Live preview — same pure engine as the server (cheap, no memo needed)
  const totals = computeInvoiceTotals(taxLines, { taxInclusive, interState })

  const setLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const onItemPick = (key: string, itemId: string) => {
    const it = itemMap.get(itemId)
    setLine(key, {
      itemId,
      rate: it ? String(isSales ? it.saleRate : it.costRate) : '',
    })
  }

  const linePreview = (l: LineDraft): { taxable: number; total: number } => {
    if (!l.itemId || num(l.qty) <= 0) return { taxable: 0, total: 0 }
    const t = computeInvoiceTotals(
      [{ qty: num(l.qty), rate: num(l.rate), discPct: num(l.discPct) || 0, gstRate: itemMap.get(l.itemId)?.gstRate ?? 0 }],
      { taxInclusive, interState }
    )
    return { taxable: t.lines[0].taxable, total: t.lines[0].total }
  }

  const submit = async () => {
    if (!partyId) {
      toast.error('Select a party first')
      return
    }
    if (validLines.length === 0) {
      toast.error('Add at least one line item with quantity > 0')
      return
    }
    if (validLines.some((l) => num(l.rate) < 0)) {
      toast.error('Rate cannot be negative')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        partyId,
        date,
        taxInclusive,
        poNo: poNo.trim() || undefined,
        remarks: remarks.trim() || undefined,
        warehouseId: warehouseId || undefined,
        lines: validLines.map((l) => ({
          itemId: l.itemId,
          detail: l.detail.trim() || undefined,
          qty: num(l.qty),
          rate: num(l.rate),
          discPct: num(l.discPct) || undefined,
        })),
      }
      if (isSales) payload.pos = pos || party?.stateCode || companyState
      const res = await apiPost<AnyInvoice>(isSales ? '/api/sales-invoices' : '/api/purchase-invoices', payload)
      toast.success(`${res.invoiceNo} posted`, {
        description: `Grand total ₹ ${money(res.grandTotal)} — stock ledger + GL entries committed atomically.`,
        action: {
          label: 'View',
          onClick: () => setView(isSales ? 'sales-detail' : 'purchase-detail', { id: res.id }),
        },
      })
      onCreated()
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  const partyInfo = party ? (
    <p className="text-xs text-muted-foreground">
      {party.gstin ? `${party.gstin} · ` : 'Unregistered · '}
      {stateName(party.stateCode)}
      {party.stateCode !== companyState ? ' (inter-state)' : ' (intra-state)'}
    </p>
  ) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-4xl lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{prefill ? `Duplicate ${prefill.invoiceNo} as new ${isSales ? 'invoice' : 'purchase'}` : `New ${isSales ? 'Sales Invoice' : 'Purchase Invoice'}`}</DialogTitle>
          <DialogDescription>
            {prefill
              ? 'Copied from the original — a fresh gapless number is assigned when you post.'
              : isSales
                ? 'Totals preview live via the shared GST engine — identical to what the server will post.'
                : 'Inter-state (IGST) is derived automatically from the supplier state vs company state.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto erp-scroll-y pr-1">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="inv-party">{isSales ? 'Customer' : 'Supplier'}</Label>
              <Select value={partyId} onValueChange={onPartyChange}>
                <SelectTrigger id="inv-party" className="h-11 w-full">
                  <SelectValue placeholder="Select party…" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleParties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {partyInfo}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-date">Date</Label>
              <Input id="inv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
            </div>
            {isSales ? (
              <div className="space-y-1.5">
                <Label htmlFor="inv-pos">Place of Supply</Label>
                <Select value={pos || undefined} onValueChange={setPos}>
                  <SelectTrigger id="inv-pos" className="h-11 w-full">
                    <SelectValue placeholder="Select state…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {INDIAN_STATES.map((s) => (
                      <SelectItem key={s.code} value={s.code}>
                        {s.code}-{s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {pos ? (interState ? 'Inter-state → IGST' : 'Intra-state → CGST + SGST') : 'Defaults to party state'}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Tax split</Label>
                <div className="flex h-11 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                  {interState ? 'IGST (inter-state, auto)' : 'CGST + SGST (intra-state, auto)'}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="inv-po">PO / Challan No</Label>
              <Input id="inv-po" value={poNo} onChange={(e) => setPoNo(e.target.value)} placeholder="Optional" className="h-11" />
              <div className="flex items-center gap-2 pt-1">
                <Switch id="inv-taxinc" checked={taxInclusive} onCheckedChange={setTaxInclusive} aria-label="Tax inclusive" />
                <Label htmlFor="inv-taxinc" className="text-xs font-normal text-muted-foreground">
                  Rates are tax-inclusive
                </Label>
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
              <Label>Stock From</Label>
              <Select value={warehouseId || 'DEFAULT'} onValueChange={(v) => setWarehouseId(v === 'DEFAULT' ? '' : v)}>
                <SelectTrigger className="h-11 w-full sm:max-w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEFAULT">Default warehouse (MAIN)</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Availability is checked per warehouse — finished goods from jobwork sit in the JW store.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            <Label>Line Items</Label>
            {/* Mobile (below sm): stacked cards — every field full-width, no nested
                horizontal scroller inside the dialog. Same handlers as the table. */}
            <div className="space-y-3 sm:hidden">
              {lines.map((l) => {
                const it = itemMap.get(l.itemId)
                const pv = linePreview(l)
                return (
                  <div key={l.key} className="space-y-3 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <Select value={l.itemId || undefined} onValueChange={(v) => onItemPick(l.key, v)}>
                          <SelectTrigger className="h-11 w-full" aria-label={`Item for line ${l.key}`}>
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
                        {it ? (
                          <p className="text-xs text-muted-foreground">
                            {it.uom} · {it.hsn ?? 'no HSN'} · GST {it.gstRate}%
                          </p>
                        ) : null}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                        disabled={lines.length === 1}
                        aria-label={`Remove line ${l.key}`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`mline-qty-${l.key}`} className="text-xs text-muted-foreground">Qty</Label>
                        <Input
                          id={`mline-qty-${l.key}`}
                          type="number"
                          min="0"
                          step="any"
                          value={l.qty}
                          onChange={(e) => setLine(l.key, { qty: e.target.value })}
                          placeholder="0"
                          className="h-11 text-right tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`mline-rate-${l.key}`} className="text-xs text-muted-foreground">Rate ₹</Label>
                        <Input
                          id={`mline-rate-${l.key}`}
                          type="number"
                          min="0"
                          step="any"
                          value={l.rate}
                          onChange={(e) => setLine(l.key, { rate: e.target.value })}
                          placeholder="0"
                          className="h-11 text-right tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`mline-disc-${l.key}`} className="text-xs text-muted-foreground">Disc %</Label>
                        <Input
                          id={`mline-disc-${l.key}`}
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          value={l.discPct}
                          onChange={(e) => setLine(l.key, { discPct: e.target.value })}
                          placeholder="0"
                          className="h-11 text-right tabular-nums"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`mline-detail-${l.key}`} className="text-xs text-muted-foreground">Detail</Label>
                        <Input
                          id={`mline-detail-${l.key}`}
                          value={l.detail}
                          onChange={(e) => setLine(l.key, { detail: e.target.value })}
                          placeholder="Optional"
                          className="h-11"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
                      <span className="tabular-nums">Taxable ₹ {money(pv.taxable)}</span>
                      <span className="font-medium tabular-nums text-foreground">Total ₹ {money(pv.total)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            {/* Desktop (sm+): classic row editor */}
            <div className="hidden overflow-x-auto rounded-md border sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-44">Item</TableHead>
                    <TableHead className="min-w-32">Detail</TableHead>
                    <TableHead className="w-20 text-right">Qty</TableHead>
                    <TableHead className="w-24 text-right">Rate ₹</TableHead>
                    <TableHead className="w-20 text-right">Disc %</TableHead>
                    <TableHead className="w-24 text-right">Taxable</TableHead>
                    <TableHead className="w-24 text-right">Total</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => {
                    const it = itemMap.get(l.itemId)
                    const pv = linePreview(l)
                    return (
                      <TableRow key={l.key}>
                        <TableCell>
                          <Select value={l.itemId || undefined} onValueChange={(v) => onItemPick(l.key, v)}>
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
                          {it ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {it.uom} · {it.hsn ?? 'no HSN'} · GST {it.gstRate}%
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Input
                            value={l.detail}
                            onChange={(e) => setLine(l.key, { detail: e.target.value })}
                            placeholder="Optional"
                            className="h-11"
                            aria-label="Line detail"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={l.qty}
                            onChange={(e) => setLine(l.key, { qty: e.target.value })}
                            placeholder="0"
                            className="h-11 text-right tabular-nums"
                            aria-label="Quantity"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={l.rate}
                            onChange={(e) => setLine(l.key, { rate: e.target.value })}
                            placeholder="0"
                            className="h-11 text-right tabular-nums"
                            aria-label="Rate"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="any"
                            value={l.discPct}
                            onChange={(e) => setLine(l.key, { discPct: e.target.value })}
                            placeholder="0"
                            className="h-11 text-right tabular-nums"
                            aria-label="Discount percent"
                          />
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {money(pv.taxable)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium tabular-nums">
                          {money(pv.total)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 text-muted-foreground hover:text-destructive md:size-9"
                            onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
                            disabled={lines.length === 1}
                            aria-label={`Remove line ${l.key}`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <Button
              variant="outline"
              onClick={() => setLines((ls) => [...ls, emptyLine()])}
              className="h-11 gap-2"
            >
              <Plus className="size-4" aria-hidden /> Add line
            </Button>
          </div>

          <div className="mt-4">
            <Label htmlFor="inv-remarks">Remarks</Label>
            <Input
              id="inv-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional notes printed on the invoice"
              className="mt-1.5 h-11"
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Live GST preview</p>
              <p className="mt-1">
                Computed client-side by <span className="font-mono">computeInvoiceTotals</span> — the same pure
                engine the server uses, so preview ≡ posted totals.
                {taxInclusive ? ' Tax-inclusive: taxable back-solved from gross.' : ''}
              </p>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Taxable</dt>
                  <dd className="tabular-nums">₹ {money(totals.taxable)}</dd>
                </div>
                {totals.discount > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Discount</dt>
                    <dd className="tabular-nums">− ₹ {money(totals.discount)}</dd>
                  </div>
                ) : null}
                {interState ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">IGST</dt>
                    <dd className="tabular-nums">₹ {money(totals.igst)}</dd>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">CGST</dt>
                      <dd className="tabular-nums">₹ {money(totals.cgst)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">SGST</dt>
                      <dd className="tabular-nums">₹ {money(totals.sgst)}</dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Round off</dt>
                  <dd className="tabular-nums">
                    {totals.roundOff >= 0 ? '+ ' : '− '}
                    ₹ {money(Math.abs(totals.roundOff))}
                  </dd>
                </div>
                <div className="flex justify-between border-t pt-1 text-base font-bold">
                  <dt>Grand Total</dt>
                  <dd className="tabular-nums">₹ {money(totals.grandTotal)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11">
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving} className="h-11 gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {saving ? 'Posting…' : `Post ${isSales ? 'Invoice' : 'Purchase'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// Detail view (print + cancel)
// ===========================================================================

export function InvoiceDetail({ kind, id }: { kind: InvoiceKind; id: string }) {
  const setView = useErpUi((s) => s.setView)
  const isSales = kind === 'SALES'
  const inv = useApi<AnyInvoice | null>(isSales ? `/api/sales-invoices/${id}` : `/api/purchase-invoices/${id}`)
  const { items } = useMasters()
  const [cancelling, setCancelling] = useState(false)
  const [prefill, setPrefill] = useState<AnyInvoice | null>(null)
  const [dupOpen, setDupOpen] = useState(false)

  if (inv.loading) {
    return (
      <div className="space-y-4">
        <TableSkeleton rows={8} cols={6} />
      </div>
    )
  }
  if (inv.error || !inv.data) {
    return <EmptyState title="Invoice not found" hint={inv.error ?? 'Unknown invoice.'} icon={XCircle} />
  }
  const invoice = inv.data
  const cancelled = invoice.status === 'CANCELLED'

  const cancel = async () => {
    setCancelling(true)
    try {
      await apiDelete(isSales ? `/api/sales-invoices/${id}` : `/api/purchase-invoices/${id}`)
      toast.success(`${invoice.invoiceNo} cancelled`, {
        description: 'Stock and GL reversal entries posted — the number stays reserved (gapless audit trail).',
      })
      inv.reload()
    } catch (e) {
      toastError(e)
    } finally {
      setCancelling(false)
    }
  }

  // One button, the whole next step: open the payment dialog on the Accounting
  // module, prefilled with this party and the balance allocated to THIS invoice.
  const payNow = () => {
    const balance = Math.max(0, r2(invoice.grandTotal - invoice.paidAmount))
    if (balance <= 0) {
      toast.info('This invoice is fully paid')
      return
    }
    setCreatePreset({
      type: 'payment',
      partyId: invoice.partyId,
      paymentType: isSales ? 'RECEIPT' : 'PAYMENT',
      amount: balance,
      allocations: [{ invoiceNo: invoice.invoiceNo, amount: balance }],
    })
    setView('accounting')
  }

  return (
    <div className="space-y-4">
      <div className="print-hide flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="size-11" onClick={() => setView(isSales ? 'sales' : 'purchase')} aria-label="Back to list">
            <ArrowLeft className="size-5" aria-hidden />
          </Button>
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="Breadcrumb">
              <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setView(isSales ? 'sales' : 'purchase')}>
                {isSales ? 'Sales' : 'Purchase'}
              </button>
              <span aria-hidden>/</span>
              <span className="tabular-nums">{invoice.invoiceNo}</span>
            </p>
            <h2 className="text-lg font-semibold tabular-nums">{invoice.invoiceNo}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <StatusBadge status={invoice.status} />
              {isSales ? <SourceBadge source={(invoice as SalesInvoice).source} /> : null}
              {(invoice as SalesInvoice).tallySentAt ? (
                <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                  <FileDown className="size-3" aria-hidden /> In Tally
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {invoice.party?.name} · {dateStr(invoice.date)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={payNow}
            disabled={cancelled || invoice.paidAmount >= invoice.grandTotal - 0.004}
            className="h-11 gap-2"
          >
            <HandCoins className="size-4" aria-hidden />
            {isSales ? 'Receive Payment' : 'Make Payment'}
            {!cancelled && invoice.grandTotal - invoice.paidAmount > 0.004 ? (
              <span className="rounded bg-primary-foreground/15 px-1.5 py-0.5 text-xs tabular-nums">
                ₹ {money(invoice.grandTotal - invoice.paidAmount)}
              </span>
            ) : null}
          </Button>
          <Button variant="outline" onClick={() => { setPrefill(invoice); setDupOpen(true) }} disabled={cancelled} className="h-11 gap-2">
            <Copy className="size-4" aria-hidden /> Duplicate
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={cancelled} className="h-11 gap-2">
                <FileDown className="size-4" aria-hidden /> Tally
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void exportTallyVoucher(isSales ? 'SALES' : 'PURCHASE', id, 'xml')}>
                <FileCode2 className="size-4" aria-hidden /> Tally XML (import file)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportTallyVoucher(isSales ? 'SALES' : 'PURCHASE', id, 'json')}>
                <Braces className="size-4" aria-hidden /> Tally JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportTallyVoucher(isSales ? 'SALES' : 'PURCHASE', id, 'csv')}>
                <FileSpreadsheet className="size-4" aria-hidden /> Tally Excel (CSV)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => downloadUrl('/downloads/tally/Tally-Import.bat')}>
                <Terminal className="size-4" aria-hidden /> Tally importer (.bat)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadUrl('/api/tally/masters?parties=1')}>
                <FileDown className="size-4" aria-hidden /> Tally masters (XML)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void queueForConnector(isSales ? 'SALES' : 'PURCHASE', id)}>
                Queue for Tally connector
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  void markTallySent(isSales ? 'SALES' : 'PURCHASE', id, !(invoice as SalesInvoice).tallySentAt).then(() => inv.reload())
                }
              >
                {(invoice as SalesInvoice).tallySentAt ? 'Clear "sent to Tally"' : 'Mark as sent to Tally'}
              </DropdownMenuItem>
              {isSales ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void exportEInvoiceJson(id)}>
                    <ScrollText className="size-4" aria-hidden /> e-Invoice JSON (GST portal)
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => window.print()} className="h-11 gap-2">
            <Printer className="size-4" aria-hidden /> Print
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={cancelled || cancelling} className="h-11 gap-2">
                {cancelling ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
                Cancel invoice
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel {invoice.invoiceNo}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Cancellation posts reversal entries to the stock ledger and general ledger — the document is
                  never deleted. Blocked if payments were allocated against this invoice.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="h-11">Keep invoice</AlertDialogCancel>
                <AlertDialogAction onClick={cancel} className="h-11" disabled={cancelling}>
                  {cancelling ? 'Cancelling…' : 'Cancel invoice'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {cancelled ? (
        <div className="print-hide rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          This invoice is cancelled — reversal entries have been posted. Shown for audit only.
        </div>
      ) : null}

      <InvoicePrint kind={kind} invoice={invoice} items={items} />

      {/* Duplicate dialog — prefilled from this invoice */}
      <CreateInvoiceDialog
        kind={kind}
        open={dupOpen}
        prefill={prefill}
        onOpenChange={(o) => {
          setDupOpen(o)
          if (!o) setPrefill(null)
        }}
        onCreated={() => {
          toast.info('Duplicated invoice posted — find it in the list')
          setView(isSales ? 'sales' : 'purchase')
        }}
        key={`dup-${invoice.id}`}
      />
    </div>
  )
}
