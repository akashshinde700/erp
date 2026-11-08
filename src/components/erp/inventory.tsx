'use client'

/**
 * ForgeERP — Inventory view.
 * Tabs: Stock Summary (with low-stock flags), Stock Ledger (filters + running
 * balance), Opening Stock (bulk voucher).
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Boxes, Loader2, Plus, RefreshCw, Search, Trash2, TrendingDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  apiPost,
  num,
  toastError,
  todayISO,
  useApi,
  useMasters,
  type StockLedgerRow,
  type StockSummaryRow,
} from './api'
import { EmptyState, Money, SectionHeading, TableSkeleton, VoucherBadge } from './bits'
import { dateStr, money, qty as qtyFmt, DEFAULT_WAREHOUSE_CODE } from '@/lib/erp'

export function InventoryView() {
  return (
    <div className="space-y-4">
      <SectionHeading
        title="Inventory"
        description="Perpetual stock ledger with weighted-average valuation — every voucher posts atomically."
      />
      <Tabs defaultValue="summary">
        <TabsList className="h-11 w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="summary" className="h-11 sm:h-9">Stock Summary</TabsTrigger>
          <TabsTrigger value="ledger" className="h-11 sm:h-9">Stock Ledger</TabsTrigger>
          <TabsTrigger value="opening" className="h-11 sm:h-9">Opening Stock</TabsTrigger>
          <TabsTrigger value="traceability" className="h-11 sm:h-9">Lots & Serials</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" className="mt-4">
          <StockSummaryTab />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4">
          <StockLedgerTab />
        </TabsContent>
        <TabsContent value="opening" className="mt-4">
          <OpeningStockTab />
        </TabsContent>
        <TabsContent value="traceability" className="mt-4">
          <TraceabilityTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

type TraceLot = { id: string; lotNo: string; status: string; manufactureDate: string | null; expiryDate: string | null; sourceType: string; sourceId: string; balance: number; expired: boolean; availableSerials: number; item: { code: string; name: string; uom: string }; warehouse: { code: string; name: string }; parentLinks: { parentLot: { lotNo: string }; consumedQty: number }[]; childLinks: { childLot: { lotNo: string }; consumedQty: number }[] }

function TraceabilityTab() {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  // Newest 300 lots; older ones are found by searching (server-side).
  const lots = useApi<TraceLot[]>(query ? `/api/traceability?q=${encodeURIComponent(query)}` : '/api/traceability')
  const [busy, setBusy] = useState('')
  const recall = async (lot: TraceLot) => {
    const reason = window.prompt(`Recall ${lot.lotNo} and every descendant lot. Enter mandatory reason:`)
    if (!reason?.trim()) return
    setBusy(lot.id)
    try { const result = await apiPost<{ affectedLots: number }>('/api/traceability', { action: 'recall', id: lot.id, reason: reason.trim() }); toast.success(`${lot.lotNo} recalled`, { description: `${result.affectedLots} lot(s) affected` }); await lots.reload() }
    catch (error) { toastError(error) } finally { setBusy('') }
  }
  const searchBox = <div className="relative mb-3 max-w-sm"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search lot / item…" className="h-11 pl-8" aria-label="Search lots" /></div>
  if (lots.loading) return <>{searchBox}<TableSkeleton rows={8} cols={9} /></>
  if (!lots.data?.length) return <>{searchBox}<EmptyState title={query ? 'No matching lots' : 'No tracked lots'} hint={query ? 'Try another lot number or item code.' : 'QC-accepted GRNs and production receipts with a batch number create traceable lots.'} icon={Boxes} /></>
  return <>{searchBox}<Card className="p-0"><CardContent className="p-0"><div className="flex items-center border-b px-4 py-3"><p className="text-sm font-medium">Batch, serial and genealogy balances</p><Button variant="ghost" size="sm" className="ml-auto gap-2" onClick={() => void lots.reload()}><RefreshCw className="size-4" />Refresh</Button></div><div className="overflow-auto"><Table><TableHeader><TableRow><TableHead>Lot / Item</TableHead><TableHead>Warehouse</TableHead><TableHead>Dates</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Available Serials</TableHead><TableHead>Source</TableHead><TableHead>Parents</TableHead><TableHead>Children</TableHead><TableHead className="text-right">Status / Action</TableHead></TableRow></TableHeader><TableBody>{lots.data.map((lot) => <TableRow key={lot.id}><TableCell className="font-medium">{lot.lotNo}<p className="text-xs text-muted-foreground">{lot.item.code} · {lot.item.name}</p></TableCell><TableCell>{lot.warehouse.code}</TableCell><TableCell className="text-xs">Mfg: {lot.manufactureDate ? dateStr(lot.manufactureDate) : '—'}<br />Exp: {lot.expiryDate ? dateStr(lot.expiryDate) : '—'}</TableCell><TableCell className="text-right tabular-nums">{qtyFmt(lot.balance)} {lot.item.uom}</TableCell><TableCell className="text-right">{lot.availableSerials}</TableCell><TableCell className="text-xs">{lot.sourceType}<br /><span className="text-muted-foreground">{lot.sourceId.slice(0, 10)}</span></TableCell><TableCell className="text-xs">{lot.parentLinks.map((link) => `${link.parentLot.lotNo} (${link.consumedQty})`).join(', ') || '—'}</TableCell><TableCell className="text-xs">{lot.childLinks.map((link) => link.childLot.lotNo).join(', ') || '—'}</TableCell><TableCell className="text-right"><Badge variant={lot.status === 'RECALLED' || lot.expired ? 'destructive' : lot.status === 'AVAILABLE' ? 'default' : 'secondary'}>{lot.expired ? 'EXPIRED' : lot.status}</Badge>{lot.status !== 'RECALLED' ? <Button size="sm" variant="destructive" className="ml-2" disabled={busy === lot.id} onClick={() => void recall(lot)}>Recall</Button> : null}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card></>
}

// ---------- stock summary ----------

function StockSummaryTab() {
  const { data, loading } = useApi<StockSummaryRow[]>('/api/reports?type=stock-summary')
  const rows = data ?? []
  const totalValue = rows.reduce((s, r) => s + r.closingValue, 0)
  const lowCount = rows.filter((r) => r.lowStock).length

  if (loading) return <Card className="p-0"><CardContent className="p-0"><TableSkeleton rows={8} cols={6} /></CardContent></Card>

  if (rows.length === 0) {
    return <EmptyState title="No stock items" hint="Create stock items in Masters, then post opening stock." icon={Boxes} />
  }

  return (
    <Card className="p-0">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{rows.length} items</span>
          {lowCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              <TrendingDown className="size-3" aria-hidden /> {lowCount} below reorder level
            </span>
          ) : null}
          <span className="ml-auto tabular-nums">Closing value ₹ {money(totalValue)}</span>
        </div>
        <div className="max-h-[62dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="hidden sm:table-cell">HSN</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Closing</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Avg Cost</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Closing Value</TableHead>
                <TableHead>Stock Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.item.id}>
                  <TableCell>
                    <span className="block max-w-40 truncate font-medium">{r.item.name}</span>
                    <span className="block text-xs text-muted-foreground">{r.item.code}</span>
                    {r.warehouses &&
                    r.warehouses.length > 0 &&
                    (r.warehouses.length > 1 || r.warehouses[0].code !== DEFAULT_WAREHOUSE_CODE) ? (
                      <span className="block text-[11px] text-muted-foreground/80">
                        {r.warehouses.map((w) => `${w.code}: ${qtyFmt(w.closing)}`).join(' · ')}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">{r.item.hsn ?? '—'}</TableCell>
                  <TableCell>{r.item.uom}</TableCell>
                  <TableCell className="text-right tabular-nums">{qtyFmt(r.inQty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{qtyFmt(r.outQty)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{qtyFmt(r.closing)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    <Money value={r.avgCost} plain />
                  </TableCell>
                  <TableCell className="hidden text-right font-semibold tabular-nums sm:table-cell">
                    <Money value={r.closingValue} plain />
                  </TableCell>
                  <TableCell>
                    {r.lowStock ? (
                      <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        Low · reorder @ {qtyFmt(r.item.reorderLevel)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">OK</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={7} className="hidden text-right sm:table-cell">Total closing value</TableCell>
                <TableCell colSpan={5} className="text-right sm:hidden">Total closing value</TableCell>
                <TableCell className="text-right tabular-nums">₹ {money(totalValue)}</TableCell>
                <TableCell className="hidden sm:table-cell" />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- stock ledger ----------

function StockLedgerTab() {
  const { items, warehouses } = useMasters()
  const [itemId, setItemId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [applied, setApplied] = useState<{ itemId: string; warehouseId: string; from: string; to: string }>({
    itemId: '',
    warehouseId: '',
    from: '',
    to: '',
  })

  const qs = new URLSearchParams({ type: 'stock-ledger' })
  if (applied.itemId) qs.set('itemId', applied.itemId)
  if (applied.warehouseId) qs.set('warehouseId', applied.warehouseId)
  if (applied.from) qs.set('from', applied.from)
  if (applied.to) qs.set('to', applied.to)
  const { data, loading } = useApi<StockLedgerRow[]>(`/api/reports?${qs.toString()}`)
  const rows = data ?? []

  const apply = () => setApplied({ itemId, warehouseId, from, to })
  const reset = () => {
    setItemId('')
    setWarehouseId('')
    setFrom('')
    setTo('')
    setApplied({ itemId: '', warehouseId: '', from: '', to: '' })
  }

  const filter = (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <div className="space-y-1">
        <Label className="text-xs">Item</Label>
        <Select value={itemId || 'ALL'} onValueChange={(v) => setItemId(v === 'ALL' ? '' : v)}>
          <SelectTrigger className="h-11 data-[size=default]:h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            <SelectItem value="ALL">All items</SelectItem>
            {items.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.code} — {i.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Warehouse</Label>
        <Select value={warehouseId || 'ALL'} onValueChange={(v) => setWarehouseId(v === 'ALL' ? '' : v)}>
          <SelectTrigger className="h-11 data-[size=default]:h-11 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All warehouses</SelectItem>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.code} — {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">From</Label>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">To</Label>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11" />
      </div>
      <div className="flex gap-2">
        <Button onClick={apply} className="h-11 flex-1">Apply</Button>
        <Button variant="outline" onClick={reset} className="h-11">Reset</Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {filter}
      <Card className="p-0">
        <CardContent className="p-0">
          {loading ? (
            <TableSkeleton rows={8} cols={7} />
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No ledger entries" hint="No stock movements match the current filters." icon={Boxes} />
            </div>
          ) : (
            <div className="max-h-[62dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Voucher</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="hidden sm:table-cell">Warehouse</TableHead>
                    <TableHead className="text-right">Qty In</TableHead>
                    <TableHead className="text-right">Qty Out</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Rate</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Value</TableHead>
                    <TableHead className="hidden sm:table-cell">Remarks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{dateStr(r.postingDate)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <VoucherBadge type={r.voucherType} />
                          <span className="text-xs tabular-nums text-muted-foreground">{r.voucherNo}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-40 truncate font-medium">{r.item?.name ?? '—'}</span>
                        <span className="block text-xs text-muted-foreground">{r.item?.code}</span>
                      </TableCell>
                      <TableCell className="hidden text-xs sm:table-cell">{r.warehouse?.code ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.qtyIn > 0 ? qtyFmt(r.qtyIn) : ''}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.qtyOut > 0 ? qtyFmt(r.qtyOut) : ''}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(r.rate)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{qtyFmt(r.balance)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        <Money value={r.value} plain />
                      </TableCell>
                      <TableCell className="hidden max-w-40 truncate text-xs text-muted-foreground sm:table-cell">{r.remarks ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- opening stock ----------

interface OpeningRow {
  key: number
  itemId: string
  qty: string
  rate: string
}

function OpeningStockTab() {
  const { items, warehouses } = useMasters()
  const [date, setDate] = useState(todayISO())
  const [warehouseId, setWarehouseId] = useState('')
  const [rows, setRows] = useState<OpeningRow[]>([{ key: 1, itemId: '', qty: '', rate: '' }])
  const [saving, setSaving] = useState(false)
  const seq = rows.length ? Math.max(...rows.map((r) => r.key)) : 0

  const stockItems = items.filter((i) => i.active && i.isStockItem)

  const setRow = (key: number, patch: Partial<OpeningRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const onItemPick = (key: number, itemId: string) => {
    const it = items.find((i) => i.id === itemId)
    setRow(key, { itemId, rate: it ? String(it.costRate || it.saleRate || 0) : '' })
  }

  const validRows = rows.filter((r) => r.itemId && num(r.qty) > 0)

  const totalValue = validRows.reduce((s, r) => s + num(r.qty) * num(r.rate), 0)

  const submit = async () => {
    if (!warehouseId) {
      toast.error('Select a warehouse')
      return
    }
    if (validRows.length === 0) {
      toast.error('Add at least one row with item and quantity > 0')
      return
    }
    setSaving(true)
    try {
      const res = await apiPost<{ voucherNo: string; rows: unknown[] }>('/api/inventory/opening', {
        date,
        warehouseId,
        rows: validRows.map((r) => ({ itemId: r.itemId, qty: num(r.qty), rate: num(r.rate) })),
      })
      toast.success(`Opening stock posted — ${res.voucherNo}`, {
        description: `${res.rows.length} row(s) written to the stock ledger. Re-submitting the same items replaces the old rows.`,
      })
      setRows([{ key: seq + 1, itemId: '', qty: '', rate: '' }])
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
        </div>
        <div className="space-y-1">
          <Label>Warehouse</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger className="h-11 data-[size=default]:h-11 w-full">
              <SelectValue placeholder="Select warehouse…" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <p className="text-xs text-muted-foreground">
            Opening voucher <span className="font-mono">OPENING</span> — qty in @ rate; re-submitting same
            item+warehouse replaces previous rows.
          </p>
        </div>
      </div>

      {/* Mobile (below sm): stacked cards per row — same state wiring as the table. */}
      <div className="space-y-3 sm:hidden">
        {rows.map((r) => (
          <div key={r.key} className="space-y-3 rounded-md border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Select value={r.itemId} onValueChange={(v) => onItemPick(r.key, v)}>
                  <SelectTrigger className="h-11 data-[size=default]:h-11 w-full" aria-label={`Item for row ${r.key}`}>
                    <SelectValue placeholder="Pick stock item…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {stockItems.map((i) => (
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
              <div className="space-y-1">
                <Label htmlFor={`os-mqty-${r.key}`} className="text-xs text-muted-foreground">Qty</Label>
                <Input
                  id={`os-mqty-${r.key}`}
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
                <Label htmlFor={`os-mrate-${r.key}`} className="text-xs text-muted-foreground">Rate ₹</Label>
                <Input
                  id={`os-mrate-${r.key}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={r.rate}
                  onChange={(e) => setRow(r.key, { rate: e.target.value })}
                  placeholder="0"
                  className="h-11 text-right tabular-nums"
                  aria-label="Rate"
                />
              </div>
            </div>
            <p className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
              <span>Value</span>
              <span className="font-medium tabular-nums text-foreground">₹ {money(num(r.qty) * num(r.rate))}</span>
            </p>
          </div>
        ))}
      </div>
      {/* Desktop (sm+): classic row editor */}
      <div className="hidden overflow-x-auto rounded-md border sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-48">Item</TableHead>
              <TableHead className="w-24 text-right">Qty</TableHead>
              <TableHead className="w-28 text-right">Rate ₹</TableHead>
              <TableHead className="w-28 text-right">Value</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>
                  <Select value={r.itemId} onValueChange={(v) => onItemPick(r.key, v)}>
                    <SelectTrigger className="h-11 data-[size=default]:h-11 w-full min-w-40">
                      <SelectValue placeholder="Pick stock item…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {stockItems.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.code} — {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    value={r.rate}
                    onChange={(e) => setRow(r.key, { rate: e.target.value })}
                    placeholder="0"
                    className="h-11 text-right tabular-nums"
                    aria-label="Rate"
                  />
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {money(num(r.qty) * num(r.rate))}
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

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <Button variant="outline" onClick={() => setRows((rs) => [...rs, { key: seq + 1, itemId: '', qty: '', rate: '' }])} className="h-11 gap-2 sm:w-auto">
          <Plus className="size-4" aria-hidden /> Add row
        </Button>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm text-muted-foreground">
            Total: <span className="font-semibold tabular-nums text-foreground">₹ {money(totalValue)}</span>
          </span>
          <Button onClick={submit} disabled={saving} className="h-11 gap-2 sm:w-auto">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {saving ? 'Posting…' : 'Post Opening Stock'}
          </Button>
        </div>
      </div>
    </div>
  )
}
