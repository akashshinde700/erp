'use client'

/**
 * ForgeERP — command palette (Ctrl/⌘+K or /) + keyboard shortcuts help (?).
 * Navigate every module, create the next document from anywhere, and search
 * parties / items / invoices / jobwork inwards live.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Boxes,
  Calculator,
  Database,
  Factory,
  FileText,
  FolderKanban,
  Keyboard,
  LayoutDashboard,
  ReceiptText,
  ScrollText,
  Search,
  ShoppingCart,
  Truck,
  Users,
  Wrench,
} from 'lucide-react'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { setCreatePreset, readRecent, SHORTCUTS_HELP, GOTO_KEYS } from './nav'
import { useErpUi, type ErpView } from './store'
import { money } from '@/lib/erp'
import { useResetOnChange } from '@/hooks/use-reset-on-change'

interface SearchResults {
  parties: { id: string; code: string; name: string; stateCode: string; types: string }[]
  items: { id: string; code: string; name: string; uom: string; hsn: string | null }[]
  salesInvoices: { id: string; invoiceNo: string; grandTotal: number; status: string; party: { name: string } | null }[]
  purchaseInvoices: { id: string; invoiceNo: string; grandTotal: number; status: string; party: { name: string } | null }[]
  inwards: { id: string; inwardNo: string; status: string; party: { name: string } | null }[]
  projects: { id: string; projectNo: string; name: string; status: string; party: { name: string } | null }[]
}

const MODULES: { view: ErpView; label: string; icon: typeof LayoutDashboard; keywords: string }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home kpi overview' },
  { view: 'crm', label: 'CRM & Service', icon: Users, keywords: 'lead enquiry follow-up salesperson target pipeline service call complaint warranty' },
  { view: 'sales', label: 'Sales Invoices', icon: ReceiptText, keywords: 'invoice gst customer billing tax' },
  { view: 'purchase', label: 'Purchase Invoices', icon: ShoppingCart, keywords: 'supplier bill input gst' },
  { view: 'jobwork', label: 'Jobwork', icon: Factory, keywords: 'inward job card certificate process lot' },
  { view: 'projects', label: 'Projects', icon: FolderKanban, keywords: 'project customer contract budget make to order fabrication site' },
  { view: 'manufacturing', label: 'Manufacturing', icon: FolderKanban, keywords: 'bom work order production stock make to stock task fabrication cutting welding assembly employee assign pending completion mrp capacity oee costing' },
  { view: 'inventory', label: 'Inventory', icon: Boxes, keywords: 'stock ledger warehouse balance adjustment write-off damage count' },
  { view: 'accounting', label: 'Accounting', icon: Calculator, keywords: 'payment receipt ledger allocation party journal voucher tds chart of accounts period close lock financial year' },
  { view: 'reports', label: 'Reports', icon: FileText, keywords: 'gstr1 trial balance pnl outstanding' },
  { view: 'masters', label: 'Masters', icon: Database, keywords: 'party item customer supplier process warehouse company rate' },
  { view: 'tally', label: 'Tally Export', icon: Truck, keywords: 'tally xml voucher masters connector bat' },
  { view: 'audit', label: 'Audit Trail', icon: ScrollText, keywords: 'log history changes' },
  { view: 'docs', label: 'Docs', icon: FileText, keywords: 'documentation reference' },
]

const RECENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  sales: 'Sales Invoices',
  'sales-detail': 'Sales invoice detail',
  purchase: 'Purchase Invoices',
  'purchase-detail': 'Purchase invoice detail',
  jobwork: 'Jobwork',
  'jobwork-detail': 'Jobwork inward detail',
  projects: 'Projects',
  manufacturing: 'Manufacturing',
  'project-detail': 'Project detail',
  inventory: 'Inventory',
  accounting: 'Accounting',
  reports: 'Reports',
  crm: 'CRM & Service',
  masters: 'Masters',
  tally: 'Tally Export',
  audit: 'Audit Trail',
  docs: 'Docs',
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { setView } = useErpUi()
  const [query, setQuery] = useState('')
  const [fetched, setResults] = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const recents = useMemo(() => readRecent().filter((v) => RECENT_LABELS[v]), [open])

  // Live search (debounced) for queries of 2+ characters
  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) return
    const t = setTimeout(async () => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setSearching(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        const json = (await res.json()) as { success: boolean; data?: SearchResults }
        if (json.success && json.data) setResults(json.data)
      } catch {
        /* aborted or network error — keep previous results */
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, open])

  // Reset on close
  useResetOnChange(!open, [], () => {
    setQuery('')
    setResults(null)
  })
  // Results only apply to the current query (2+ characters, palette open).
  const results = open && query.trim().length >= 2 ? fetched : null

  const go = (view: ErpView, params?: Record<string, string>) => {
    setView(view, params)
    onOpenChange(false)
  }

  const newSales = () => {
    setCreatePreset({ type: 'sales-invoice' })
    go('sales')
  }
  const newPurchase = () => {
    setCreatePreset({ type: 'purchase-invoice' })
    go('purchase')
  }
  const newReceipt = () => {
    setCreatePreset({ type: 'payment', paymentType: 'RECEIPT' })
    go('accounting')
  }
  const newPayment = () => {
    setCreatePreset({ type: 'payment', paymentType: 'PAYMENT' })
    go('accounting')
  }
  const newInward = () => go('jobwork')

  const hasResults =
    results && (results.parties.length > 0 || results.items.length > 0 || results.salesInvoices.length > 0 || results.purchaseInvoices.length > 0 || results.inwards.length > 0 || results.projects.length > 0)

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="sm:max-w-xl">
      <CommandInput
        placeholder="Search parties, items, invoices, projects — or jump to a module…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="max-h-[70vh]">
        <CommandEmpty>{searching ? 'Searching…' : 'Nothing found.'}</CommandEmpty>

        {hasResults ? (
          <>
            {results.parties.length > 0 ? (
              <CommandGroup heading="Parties">
                {results.parties.map((p) => (
                  <CommandItem key={`p-${p.id}`} value={`${p.code} ${p.name}`} onSelect={() => go('masters')}>
                    <Wrench className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">
                      {p.code} — {p.name}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{p.stateCode}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.salesInvoices.length > 0 ? (
              <CommandGroup heading="Sales Invoices">
                {results.salesInvoices.map((inv) => (
                  <CommandItem key={`s-${inv.id}`} value={`${inv.invoiceNo} ${inv.party?.name ?? ''}`} onSelect={() => go('sales-detail', { id: inv.id })}>
                    <ReceiptText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate tabular-nums">{inv.invoiceNo}</span>
                    <span className="truncate text-xs text-muted-foreground">{inv.party?.name}</span>
                    <span className="ml-auto text-xs tabular-nums">₹ {money(inv.grandTotal)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.purchaseInvoices.length > 0 ? (
              <CommandGroup heading="Purchase Invoices">
                {results.purchaseInvoices.map((inv) => (
                  <CommandItem key={`b-${inv.id}`} value={`${inv.invoiceNo} ${inv.party?.name ?? ''}`} onSelect={() => go('purchase-detail', { id: inv.id })}>
                    <ShoppingCart className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate tabular-nums">{inv.invoiceNo}</span>
                    <span className="truncate text-xs text-muted-foreground">{inv.party?.name}</span>
                    <span className="ml-auto text-xs tabular-nums">₹ {money(inv.grandTotal)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.inwards.length > 0 ? (
              <CommandGroup heading="Jobwork Inwards">
                {results.inwards.map((iw) => (
                  <CommandItem key={`w-${iw.id}`} value={`${iw.inwardNo} ${iw.party?.name ?? ''}`} onSelect={() => go('jobwork-detail', { id: iw.id })}>
                    <Factory className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate tabular-nums">{iw.inwardNo}</span>
                    <span className="truncate text-xs text-muted-foreground">{iw.party?.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{iw.status}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.projects.length > 0 ? (
              <CommandGroup heading="Projects">
                {results.projects.map((pj) => (
                  <CommandItem key={`pj-${pj.id}`} value={`${pj.projectNo} ${pj.name} ${pj.party?.name ?? ''}`} onSelect={() => go('project-detail', { id: pj.id })}>
                    <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate tabular-nums">{pj.projectNo}</span>
                    <span className="truncate text-xs text-muted-foreground">{pj.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{pj.status}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.items.length > 0 ? (
              <CommandGroup heading="Items">
                {results.items.map((it) => (
                  <CommandItem key={`i-${it.id}`} value={`${it.code} ${it.name} ${it.hsn ?? ''}`} onSelect={() => go('inventory')}>
                    <Boxes className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">
                      {it.code} — {it.name}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {it.uom}
                      {it.hsn ? ` · HSN ${it.hsn}` : ''}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
          </>
        ) : null}

        <CommandGroup heading="Create">
          <CommandItem onSelect={newSales} value="new sales invoice create bill">
            <ReceiptText className="size-4 shrink-0" aria-hidden />
            New Sales Invoice
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Alt+S</span>
          </CommandItem>
          <CommandItem onSelect={newPurchase} value="new purchase invoice supplier bill">
            <ShoppingCart className="size-4 shrink-0" aria-hidden />
            New Purchase Invoice
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Alt+P</span>
          </CommandItem>
          <CommandItem onSelect={newReceipt} value="new receipt payment receive money in customer">
            <ArrowDownCircle className="size-4 shrink-0" aria-hidden />
            Receive Payment
          </CommandItem>
          <CommandItem onSelect={newPayment} value="new payment pay money out supplier">
            <ArrowUpCircle className="size-4 shrink-0" aria-hidden />
            Pay Supplier
          </CommandItem>
          <CommandItem onSelect={newInward} value="new jobwork inward challan material">
            <Factory className="size-4 shrink-0" aria-hidden />
            New Jobwork Inward
          </CommandItem>
          <CommandItem onSelect={() => go('projects')} value="new project customer contract">
            <FolderKanban className="size-4 shrink-0" aria-hidden />
            New Project
          </CommandItem>
          <CommandItem onSelect={() => go('manufacturing')} value="new bom work order task stock production">
            <FolderKanban className="size-4 shrink-0" aria-hidden />
            New BOM / Work Order / Task
          </CommandItem>
        </CommandGroup>

        {!query.trim() && recents.length > 0 ? (
          <CommandGroup heading="Recent">
            {recents.map((v) => (
              <CommandItem key={`r-${v}`} value={`recent ${RECENT_LABELS[v] ?? v}`} onSelect={() => go(v)}>
                <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                {RECENT_LABELS[v] ?? v}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandGroup heading="Go to">
          {MODULES.map((m) => (
            <CommandItem key={m.view} value={`go ${m.label} ${m.keywords}`} onSelect={() => go(m.view)}>
              <m.icon className="size-4 shrink-0" aria-hidden />
              {m.label}
              {GOTO_KEYS[Object.keys(GOTO_KEYS).find((k) => GOTO_KEYS[k].view === m.view) ?? ''] ? (
                <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
                  g {Object.keys(GOTO_KEYS).find((k) => GOTO_KEYS[k].view === m.view)}
                </span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

// ---------------------------------------------------------------------------

export function ShortcutsHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-5" aria-hidden /> Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>Move around the ERP without touching the mouse.</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableBody>
              {SHORTCUTS_HELP.map((s) => (
                <TableRow key={s.keys}>
                  <TableCell className="w-36 font-medium">
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.action}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          The <span className="font-medium text-foreground">g</span> prefix works from anywhere outside an input: press{' '}
          <span className="font-mono">g</span>, then the module key.
        </p>
      </DialogContent>
    </Dialog>
  )
}
