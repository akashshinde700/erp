'use client'

/**
 * ForgeERP — Tally export & connector console.
 *  1. Ledger-name settings (Company fields; blank = engine defaults)
 *  2. Masters XML download (import FIRST — kills "Ledger not found")
 *  3. Bulk voucher export (date range → one combined XML)
 *  4. Connector (PoC): pairing code → local script polls → imports into Tally
 *  5. Tally-Import.bat — the manual, human-approved importer
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Download,
  FileCode2,
  Link2,
  Loader2,
  Plug,
  RefreshCw,
  Save,
  Terminal,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  api,
  apiGet,
  apiPost,
  downloadUrl,
  toastError,
  todayISO,
  type Company,
  type TallyConnectorStatus,
  type TallyVoucherPreview,
} from './api'
import { useCompany } from './company'
import { SectionHeading } from './bits'

const LEDGER_FIELDS: { key: keyof Company; label: string; placeholder: string }[] = [
  { key: 'tallyCompanyName', label: 'Tally company name (SVCURRENTCOMPANY)', placeholder: 'Shree Forge Industries' },
  { key: 'tallySalesLedger', label: 'Sales ledger', placeholder: 'Sales' },
  { key: 'tallyPurchaseLedger', label: 'Purchase ledger', placeholder: 'Purchase' },
  { key: 'tallyCgstLedger', label: 'CGST ledger', placeholder: 'Central Tax on Sales @ 9%' },
  { key: 'tallySgstLedger', label: 'SGST ledger', placeholder: 'State Tax on Sales @ 9%' },
  { key: 'tallyIgstLedger', label: 'IGST ledger', placeholder: 'Integrated Tax on Sales @ 18%' },
  { key: 'tallyRoundOffLedger', label: 'Round-off ledger', placeholder: 'Round Off' },
]

export function TallyView() {
  return (
    <div className="space-y-6">
      <SectionHeading
        title="Tally Export & Connector"
        description="Books live in Tally — ForgeERP pushes vouchers there. Masters first, then vouchers; REMOTEID makes re-import update instead of duplicate."
      />
      <TallyHowItWorks />
      <MastersCard />
      <BulkExportCard />
      <ConnectorCard />
      <BatCard />
      <LedgerSettingsCard />
    </div>
  )
}

// ---------------------------------------------------------------------------

function TallyHowItWorks() {
  return (
    <Card className="p-0">
      <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
        {[
          {
            n: '1',
            title: 'Import masters once',
            body: 'Download the All-Masters XML (units, ledger roles, party ledgers) and import it in Tally — vouchers then never hit "Ledger not found".',
          },
          {
            n: '2',
            title: 'Export vouchers',
            body: 'Per-document or bulk XML from the invoice lists or this page. Import manually with the .bat, or automatically via the connector.',
          },
          {
            n: '3',
            title: 'Re-import is safe',
            body: 'Every voucher carries REMOTEID = FORGEERP-…-<id>. Importing the same file twice updates instead of duplicating.',
          },
        ].map((s) => (
          <div key={s.n} className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Step {s.n}</p>
            <p className="mt-1 text-sm font-medium">{s.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function MastersCard() {
  const [withParties, setWithParties] = useState(true)
  return (
    <Card className="p-0">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold">Tally masters (XML)</p>
          <p className="text-xs text-muted-foreground">
            Units, Sales/Purchase/tax/round-off ledgers{withParties ? ', and every party as Sundry Debtors/Creditors' : ''}. Import this first.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-10 gap-2" onClick={() => setWithParties(!withParties)}>
            {withParties ? 'Including parties' : 'Ledgers only'}
          </Button>
          <Button size="sm" className="h-10 gap-2" onClick={() => downloadUrl(`/api/tally/masters?parties=${withParties ? 1 : 0}`)}>
            <Download className="size-4" aria-hidden /> Download masters XML
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function BulkExportCard() {
  const monthStart = `${todayISO().slice(0, 7)}-01`
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(todayISO())
  const [sales, setSales] = useState(true)
  const [purchase, setPurchase] = useState(true)
  const [payments, setPayments] = useState(true)
  const [busy, setBusy] = useState(false)

  const go = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/tally/bulk?from=${from}&to=${to}&sales=${sales ? 1 : 0}&purchase=${purchase ? 1 : 0}&payments=${payments ? 1 : 0}`)
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(j?.error ?? 'Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `forge-tally-bulk-${from}_${to}.xml`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Bulk voucher XML downloaded', { description: 'Import it with the .bat importer or drop it on Tally (Gateway → Import → Vouchers).' })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (v: boolean, set: (b: boolean) => void, label: string) => (
    <Button variant={v ? 'default' : 'outline'} size="sm" className="h-10" onClick={() => set(!v)}>
      {label}
    </Button>
  )

  return (
    <Card className="p-0">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Bulk voucher export</p>
            <p className="text-xs text-muted-foreground">One combined XML with every non-cancelled document in the range.</p>
          </div>
          <Button onClick={go} disabled={busy} className="h-10 gap-2">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileCode2 className="size-4" aria-hidden />}
            {busy ? 'Building…' : 'Download bulk XML'}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="tally-from">From</Label>
            <Input id="tally-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tally-to">To</Label>
            <Input id="tally-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11" />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 sm:content-end">
            {toggle(sales, setSales, 'Sales')}
            {toggle(purchase, setPurchase, 'Purchase')}
            {toggle(payments, setPayments, 'Payments')}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------

function ConnectorCard() {
  const [status, setStatus] = useState<TallyConnectorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [origin, setOrigin] = useState('')

  const reload = useCallback(async () => {
    try {
      setStatus(await apiGet<TallyConnectorStatus>('/api/tally/connector'))
    } catch (e) {
      toastError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setOrigin(window.location.origin)
    void reload()
    const t = setInterval(() => void reload(), 10000)
    return () => clearInterval(t)
  }, [reload])

  const newCode = async () => {
    try {
      setCode(await apiPost<{ code: string; expiresAt: string }>('/api/tally/connector', { action: 'new-code' }))
      void reload()
    } catch (e) {
      toastError(e)
    }
  }

  const revoke = async () => {
    try {
      await api('/api/tally/connector', { method: 'DELETE' })
      setCode(null)
      toast.success('Connector revoked')
      void reload()
    } catch (e) {
      toastError(e)
    }
  }

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'))
  }

  return (
    <Card className="p-0">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Tally connector (PoC)</p>
            <p className="text-xs text-muted-foreground">
              Run a tiny script on the Tally machine; it polls ForgeERP and imports queued vouchers automatically. In-memory state — restart resets pairing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status?.paired ? (
              <Badge variant={status.online ? 'default' : 'secondary'} className="gap-1">
                <Plug className="size-3" aria-hidden /> {status.online ? 'Online' : 'Paired, offline'}
              </Badge>
            ) : (
              <Badge variant="outline">Not paired</Badge>
            )}
            <Button variant="outline" size="icon" className="size-10" onClick={() => void reload()} aria-label="Refresh connector status">
              <RefreshCw className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-10 gap-2" onClick={newCode}>
            <Link2 className="size-4" aria-hidden /> Generate pairing code
          </Button>
          {status?.paired ? (
            <Button size="sm" variant="destructive" className="h-10" onClick={revoke}>
              Revoke connector
            </Button>
          ) : null}
          {status?.pending ? <Badge variant="secondary">{status.pending} job(s) queued</Badge> : null}
        </div>

        {code ? (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-xs">
            <p className="font-medium">
              Pairing code (single-use, expires {new Date(code.expiresAt).toLocaleTimeString()}):{' '}
              <button type="button" className="rounded bg-background px-2 py-0.5 font-mono text-sm tracking-widest underline-offset-2 hover:underline" onClick={() => copy(code.code)}>
                {code.code}
              </button>
            </p>
            <p className="text-muted-foreground">On the Tally machine (Node 18+):</p>
            <ol className="ml-4 list-decimal space-y-1 font-mono text-[11px] leading-relaxed">
              <li>
                <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => copy(`node forge-tally-connector.mjs pair --server ${origin} --code ${code.code}`)}>
                  node forge-tally-connector.mjs pair --server {origin} --code {code.code}
                </button>
              </li>
              <li>node forge-tally-connector.mjs run</li>
            </ol>
            <p className="text-muted-foreground">
              Download the script below, keep TallyPrime open (port 9000, &ldquo;TallyPrime acts as: Both&rdquo;), then queue invoices via the Tally button in the invoice lists.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <a
            href="/downloads/tally/forge-tally-connector.mjs"
            download
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 font-medium hover:bg-accent"
          >
            <Download className="size-3.5" aria-hidden /> forge-tally-connector.mjs
          </a>
          {status?.lastSeenAt ? <span>Last check-in: {new Date(status.lastSeenAt).toLocaleTimeString()}</span> : null}
          {status?.connectorVersion ? <span>v{status.connectorVersion}</span> : null}
        </div>

        {status?.recent?.length ? (
          <div className="max-h-44 overflow-auto rounded-lg border erp-scroll">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Created / Altered</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.recent.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium tabular-nums">{r.docNo}</TableCell>
                    <TableCell>
                      <Badge variant={r.ok && r.errors === 0 ? 'default' : 'destructive'}>{r.ok && r.errors === 0 ? 'Imported' : 'Failed'}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.created} / {r.altered}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground">{r.errorText || (r.errors ? `${r.errors} Tally error(s)` : 'OK')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function BatCard() {
  return (
    <Card className="p-0">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold">Tally-Import.bat — manual importer</p>
          <p className="max-w-xl text-xs text-muted-foreground">
            The human-approved write path. Download it once. Drop an exported <span className="font-mono">*_tally.xml</span> on it (or double-click — it picks
            the newest one in Downloads), and it POSTs to TallyPrime on port 9000 with curl (PowerShell fallback), shows{' '}
            <span className="font-mono">CREATED / ALTERED / ERRORS</span> and a cheat-sheet for every common LINEERROR.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/downloads/tally/Tally-Import.bat"
            download
            className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Terminal className="size-4" aria-hidden /> Download .bat
          </a>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------

function LedgerSettingsCard() {
  const company = useCompany()
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loadedFor, setLoadedFor] = useState('')

  useEffect(() => {
    if (!company || loadedFor === company.id) return
    setLoadedFor(company.id)
    const v: Record<string, string> = {}
    for (const f of LEDGER_FIELDS) v[f.key] = (company[f.key] as string | null) ?? ''
    setValues(v)
  }, [company, loadedFor])

  if (!company) return null

  const save = async () => {
    setSaving(true)
    try {
      await api('/api/masters/company', {
        method: 'PUT',
        body: JSON.stringify({
          name: company.name,
          legalName: company.legalName,
          gstin: company.gstin,
          stateCode: company.stateCode,
          address: company.address,
          city: company.city,
          pincode: company.pincode,
          phone: company.phone,
          email: company.email,
          bankName: company.bankName,
          bankAcct: company.bankAcct,
          bankIfsc: company.bankIfsc,
          upiId: company.upiId,
          ...Object.fromEntries(LEDGER_FIELDS.map((f) => [f.key, values[f.key]?.trim() || null])),
        }),
      })
      toast.success('Tally ledger names saved', { description: 'New exports will use these names; blank fields keep the engine defaults.' })
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-0">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Ledger names in Tally</p>
            <p className="text-xs text-muted-foreground">
              Map ForgeERP to your real Tally chart. Identical names are mandatory — a mismatched ledger name is the #1 import error.
            </p>
          </div>
          <Button onClick={save} disabled={saving} className="h-10 gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} Save
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LEDGER_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`tally-${f.key}`}>{f.label}</Label>
              <Input
                id={`tally-${f.key}`}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="h-11"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Shared: per-document export button used by invoice lists / detail view.

export async function exportTallyVoucher(doc: 'SALES' | 'PURCHASE' | 'PAYMENT', id: string, format: 'xml' | 'json' | 'csv'): Promise<void> {
  try {
    const preview = await apiGet<TallyVoucherPreview>(`/api/tally/voucher?doc=${doc}&id=${id}&preview=1`)
    if (preview.warnings.length > 0) {
      toast.warning(`${preview.warnings.length} thing(s) to check in Tally`, {
        description: preview.warnings.slice(0, 3).join(' · '),
      })
    }
    downloadUrl(`/api/tally/voucher?doc=${doc}&id=${id}&format=${format}`)
  } catch (e) {
    toastError(e)
  }
}

export async function queueForConnector(doc: 'SALES' | 'PURCHASE' | 'PAYMENT', id: string): Promise<void> {
  try {
    const res = await apiPost<{ jobId?: string; duplicate?: boolean; docNo?: string }>('/api/tally/connector', { action: 'queue', doc, id })
    if (res.duplicate) toast.info('Already queued for the connector')
    else toast.success(`${res.docNo} queued for the Tally connector`, { description: 'It imports automatically the next time the connector polls.' })
  } catch (e) {
    toastError(e)
  }
}

export async function markTallySent(doc: 'SALES' | 'PURCHASE', id: string, sent: boolean): Promise<void> {
  try {
    await apiPost('/api/tally/voucher', { doc, id, action: sent ? 'mark-sent' : 'unmark' })
    toast.success(sent ? 'Marked as sent to Tally' : 'Tally sent mark cleared')
  } catch (e) {
    toastError(e)
  }
}
