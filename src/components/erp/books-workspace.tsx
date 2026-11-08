'use client'

/**
 * Accounting → Journals, Chart of Accounts, TDS, Period Close.
 * Every posting shows its Dr/Cr effect before it is saved; Dr must equal Cr.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BookLock, BookOpen, FilePlus2, Landmark, Lock, Plus, Receipt, Trash2, Unlock } from 'lucide-react'
import { apiPost, toastError, useApi, useMasters, todayISO } from './api'
import { EmptyState, HumanStatus, Money, TableSkeleton } from './bits'
import { ReasonDialog } from './reason-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateStr, money } from '@/lib/erp'

type Account = { id?: string; code: string; name: string; group: string; nature: string; system: boolean; active: boolean; journalisable: boolean; needsParty: boolean }
type JLine = { id: string; account: string; accountName: string; partyId: string | null; debit: number; credit: number; remarks: string | null }
type Journal = { id: string; voucherNo: string; date: string; narration: string; status: string; total: number; cancelReason: string | null; createdBy: string | null; lines: JLine[] }
type TdsSection = { id: string; section: string; description: string; ratePct: number; thresholdSingle: number; thresholdAnnual: number; active: boolean }
type FY = { code: string; start: string; end: string; closed: boolean; partlyLocked: boolean }
export type BooksData = { accounts: Account[]; journals: Journal[]; tdsSections: TdsSection[]; booksLockedUntil: string | null; booksLockedBy: string | null; years: FY[] }

const B = '/api/books'

export function useBooks() { return useApi<BooksData>(B) }

// ---------------------------------------------------------------- journals

export function JournalsTab() {
  const books = useBooks()
  const [open, setOpen] = useState(false)
  const [cancelling, setCancelling] = useState<Journal | null>(null)
  if (books.loading) return <TableSkeleton rows={5} cols={5} />
  const data = books.data
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Button className="h-11 gap-2" onClick={() => setOpen(true)}><FilePlus2 className="size-4" aria-hidden />New journal</Button>
      {data?.booksLockedUntil ? <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Lock className="size-4" aria-hidden />Books locked up to {dateStr(data.booksLockedUntil)}: date journals after it</span> : null}
    </div>
    {!data?.journals.length ? <EmptyState icon={BookOpen} title="No journal vouchers yet" hint="Use a journal for entries no other document covers: expense provisions, depreciation, bank charges, GST set-off, corrections of a closed period." action={<Button variant="outline" className="mt-2 h-11" onClick={() => setOpen(true)}>New journal</Button>} /> :
      <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Voucher</TableHead><TableHead>Entries</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>
        {data.journals.map((j) => <TableRow key={j.id}>
          <TableCell className="align-top font-medium">{j.voucherNo}<p className="text-xs text-muted-foreground">{dateStr(j.date)}</p><p className="max-w-xs text-xs text-muted-foreground">{j.narration}</p></TableCell>
          <TableCell className="align-top text-sm">{j.lines.map((l) => <p key={l.id}>{l.debit > 0 ? 'Dr' : 'Cr'} {l.accountName} <span className="text-muted-foreground">₹ {money(l.debit || l.credit)}</span></p>)}</TableCell>
          <TableCell className="text-right align-top"><Money value={j.total} /></TableCell>
          <TableCell className="align-top"><HumanStatus status={j.status} detail={j.cancelReason ?? undefined} /></TableCell>
          <TableCell className="text-right align-top">{j.status === 'POSTED' ? <Button variant="outline" className="h-11" onClick={() => setCancelling(j)}>Cancel</Button> : null}</TableCell>
        </TableRow>)}
      </TableBody></Table></div></CardContent></Card>}
    {open && data ? <JournalDialog accounts={data.accounts.filter((a) => a.journalisable && a.active)} lockedUntil={data.booksLockedUntil} onClose={() => setOpen(false)} onDone={() => { setOpen(false); books.reload() }} /> : null}
    {cancelling ? <ReasonDialog title={`Cancel ${cancelling.voucherNo}?`} lines={[`posts a mirrored reversal of ₹ ${money(cancelling.total)} dated today`, 'the original stays in the books, marked cancelled', 'refused if the journal is in a closed period']} confirm="Cancel journal"
      onClose={() => setCancelling(null)} onConfirm={async (reason) => { await apiPost(B, { action: 'cancel-journal', id: cancelling.id, reason }); toast.success(`${cancelling.voucherNo} cancelled`); setCancelling(null); books.reload() }} /> : null}
  </div>
}

type Row = { account: string; partyId: string; side: 'Dr' | 'Cr'; amount: string; remarks: string }
const blank = (side: 'Dr' | 'Cr'): Row => ({ account: '', partyId: '', side, amount: '', remarks: '' })

function JournalDialog({ accounts, lockedUntil, onClose, onDone }: { accounts: Account[]; lockedUntil: string | null; onClose: () => void; onDone: () => void }) {
  const { parties } = useMasters()
  const [date, setDate] = useState(todayISO())
  const [narration, setNarration] = useState('')
  const [rows, setRows] = useState<Row[]>([blank('Dr'), blank('Cr')])
  const [saving, setSaving] = useState(false)
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const dr = rows.filter((r) => r.side === 'Dr').reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const cr = rows.filter((r) => r.side === 'Cr').reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const diff = Math.round((dr - cr) * 100) / 100
  const problems = useMemo(() => {
    const p: string[] = []
    if (narration.trim().length < 3) p.push('Write a narration')
    if (lockedUntil && date <= lockedUntil) p.push(`Date must be after the books lock (${dateStr(lockedUntil)})`)
    rows.forEach((r, i) => {
      if (!r.account) p.push(`Line ${i + 1}: choose a ledger`)
      else if (accounts.find((a) => a.code === r.account)?.needsParty && !r.partyId) p.push(`Line ${i + 1}: choose the party`)
      if (!(Number(r.amount) > 0)) p.push(`Line ${i + 1}: enter an amount`)
    })
    if (!rows.some((r) => r.side === 'Dr') || !rows.some((r) => r.side === 'Cr')) p.push('Need at least one debit and one credit')
    if (Math.abs(diff) > 0.004) p.push(`Debits and credits differ by ₹ ${money(Math.abs(diff))}`)
    return p
  }, [narration, rows, diff, date, lockedUntil, accounts])
  const save = async () => {
    setSaving(true)
    try {
      const jv = await apiPost<{ voucherNo: string }>(B, { action: 'post-journal', date, narration, lines: rows.map((r) => ({ account: r.account, partyId: r.partyId || null, remarks: r.remarks || null, ...(r.side === 'Dr' ? { debit: Number(r.amount) } : { credit: Number(r.amount) }) })) })
      toast.success(`${jv.voucherNo} posted`)
      onDone()
    } catch (e) { toastError(e) } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>New journal voucher</DialogTitle><DialogDescription>Debits must equal credits. Stock and WIP ledgers are posted only by stock and production documents.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
      <div className="space-y-1.5"><Label htmlFor="jv-date">Date</Label><Input id="jv-date" type="date" className="h-11" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="jv-narr">Narration</Label><Input id="jv-narr" className="h-11" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Bank charges for October" /></div>
    </div>
    <div className="space-y-2">
      {rows.map((r, i) => {
        const acc = accounts.find((a) => a.code === r.account)
        return <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[5rem_1fr_1fr_8rem_2.75rem]">
          <Select value={r.side} onValueChange={(v) => set(i, { side: v as 'Dr' | 'Cr' })}><SelectTrigger className="h-11 data-[size=default]:h-11" aria-label={`Line ${i + 1} side`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Dr">Dr</SelectItem><SelectItem value="Cr">Cr</SelectItem></SelectContent></Select>
          <Select value={r.account} onValueChange={(v) => set(i, { account: v, partyId: '' })}><SelectTrigger className="h-11 data-[size=default]:h-11" aria-label={`Line ${i + 1} ledger`}><SelectValue placeholder="Ledger" /></SelectTrigger><SelectContent>{accounts.map((a) => <SelectItem key={a.code} value={a.code}>{a.name} ({a.code})</SelectItem>)}</SelectContent></Select>
          {acc?.needsParty ? <Select value={r.partyId} onValueChange={(v) => set(i, { partyId: v })}><SelectTrigger className="h-11 data-[size=default]:h-11" aria-label={`Line ${i + 1} party`}><SelectValue placeholder="Party" /></SelectTrigger><SelectContent>{parties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
            : <Input className="h-11" aria-label={`Line ${i + 1} remarks`} placeholder="Line remarks" value={r.remarks} onChange={(e) => set(i, { remarks: e.target.value })} />}
          <Input className="h-11 text-right" inputMode="decimal" aria-label={`Line ${i + 1} amount`} placeholder="0.00" value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} />
          <Button variant="ghost" className="h-11" aria-label={`Remove line ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}><Trash2 className="size-4" aria-hidden /></Button>
        </div>
      })}
      <Button variant="outline" className="h-11 gap-2" onClick={() => setRows((rs) => [...rs, blank(diff > 0 ? 'Cr' : 'Dr')])}><Plus className="size-4" aria-hidden />Add line</Button>
    </div>
    <div className="flex flex-wrap gap-4 rounded-md bg-muted/50 p-3 text-sm"><span>Debit <strong>₹ {money(dr)}</strong></span><span>Credit <strong>₹ {money(cr)}</strong></span><span className={Math.abs(diff) > 0.004 ? 'font-medium text-destructive' : 'text-emerald-700 dark:text-emerald-400'}>{Math.abs(diff) > 0.004 ? `Out by ₹ ${money(Math.abs(diff))}` : 'Balanced'}</span></div>
    {problems.length ? <ul className="list-disc pl-5 text-sm text-muted-foreground">{problems.slice(0, 4).map((p) => <li key={p}>{p}</li>)}</ul> : null}
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={problems.length > 0 || saving} onClick={() => void save()}>{saving ? 'Posting…' : 'Post journal'}</Button></DialogFooter>
  </DialogContent></Dialog>
}

// ---------------------------------------------------------------- chart of accounts

const NATURES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const

export function LedgersTab() {
  const books = useBooks()
  const [open, setOpen] = useState(false)
  if (books.loading) return <TableSkeleton rows={8} cols={4} />
  const accounts = books.data?.accounts ?? []
  const toggle = async (a: Account) => { try { await apiPost(B, { action: 'set-ledger-active', id: a.id, active: !a.active }); books.reload() } catch (e) { toastError(e) } }
  return <div className="space-y-4">
    <Button className="h-11 gap-2" onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden />New ledger</Button>
    {NATURES.map((n) => {
      const rows = accounts.filter((a) => a.nature === n)
      if (!rows.length) return null
      return <Card key={n} className="p-0"><CardHeader className="pb-0 pt-4"><CardTitle className="text-base capitalize">{n.toLowerCase()}</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Ledger</TableHead><TableHead>Group</TableHead><TableHead /></TableRow></TableHeader><TableBody>
        {rows.map((a) => <TableRow key={a.code}><TableCell className="font-mono text-xs">{a.code}</TableCell><TableCell>{a.name}{a.system ? <Badge variant="outline" className="ml-2">system</Badge> : null}{!a.journalisable && a.system ? <p className="text-xs text-muted-foreground">Posted by stock / production documents only</p> : null}</TableCell><TableCell className="text-sm text-muted-foreground">{a.group}</TableCell>
          <TableCell className="text-right">{a.system ? null : <Button variant="outline" className="h-11" onClick={() => void toggle(a)}>{a.active ? 'Deactivate' : 'Activate'}</Button>}</TableCell></TableRow>)}
      </TableBody></Table></div></CardContent></Card>
    })}
    {open ? <LedgerDialog onClose={() => setOpen(false)} onDone={() => { setOpen(false); books.reload() }} /> : null}
  </div>
}

function LedgerDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: '', name: '', group: 'Indirect Expenses', nature: 'EXPENSE' })
  const [saving, setSaving] = useState(false)
  const ok = /^[A-Za-z0-9][A-Za-z0-9_-]{1,19}$/.test(f.code) && f.name.trim().length >= 2 && f.group.trim().length >= 2
  const save = async () => { setSaving(true); try { await apiPost(B, { action: 'create-ledger', ...f }); toast.success(`Ledger ${f.code.toUpperCase()} created`); onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>New ledger</DialogTitle><DialogDescription>Expense, income, asset or liability heads for journals (rent, salaries, bank charges, depreciation, loans…).</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor="lg-code">Code</Label><Input id="lg-code" className="h-11 uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="RENT" /></div>
      <div className="space-y-1.5"><Label htmlFor="lg-name">Name</Label><Input id="lg-name" className="h-11" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Factory Rent" /></div>
      <div className="space-y-1.5"><Label>Nature</Label><Select value={f.nature} onValueChange={(v) => setF({ ...f, nature: v })}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue /></SelectTrigger><SelectContent>{NATURES.map((n) => <SelectItem key={n} value={n}>{n.toLowerCase()}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor="lg-group">Group</Label><Input id="lg-group" className="h-11" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} /></div>
    </div>
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={!ok || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Create ledger'}</Button></DialogFooter></DialogContent></Dialog>
}

// ---------------------------------------------------------------- TDS

type TdsReport = { rows: { paymentNo: string; date: string; type: string; party: string; section: string; ratePct: number; settled: number; tds: number; net: number }[]; sections: { section: string; payable: number; receivable: number; count: number }[]; totalPayable: number; totalReceivable: number; glPayableBalance: number; glReceivableBalance: number }

export function TdsTab() {
  const books = useBooks()
  const report = useApi<TdsReport>(`${B}?report=tds`)
  const [editing, setEditing] = useState<Partial<TdsSection> | null>(null)
  const seed = async () => { try { await apiPost(B, { action: 'seed-tds-sections' }); toast.success('Common TDS sections added', { description: 'Check the rates against the current Finance Act before use.' }); books.reload() } catch (e) { toastError(e) } }
  if (books.loading) return <TableSkeleton rows={5} cols={4} />
  const sections = books.data?.tdsSections ?? []
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2"><Button className="h-11 gap-2" onClick={() => setEditing({ section: '', description: '', ratePct: 0 })}><Plus className="size-4" aria-hidden />New section</Button>{!sections.length ? <Button variant="outline" className="h-11" onClick={() => void seed()}>Add common sections</Button> : null}</div>
    {!sections.length ? <EmptyState icon={Receipt} title="No TDS sections" hint="Add the sections you deduct under (194C jobwork / contractors, 194J professional fees…). They then appear on supplier payments and customer receipts." /> :
      <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Section</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Single / annual threshold</TableHead><TableHead /></TableRow></TableHeader><TableBody>
        {sections.map((s) => <TableRow key={s.id}><TableCell className="font-medium">{s.section}<p className="text-xs text-muted-foreground">{s.description}{s.active ? '' : ' · inactive'}</p></TableCell><TableCell className="text-right">{s.ratePct}%</TableCell><TableCell className="text-right text-sm">₹ {money(s.thresholdSingle)} / ₹ {money(s.thresholdAnnual)}</TableCell><TableCell className="text-right"><Button variant="outline" className="h-11" onClick={() => setEditing(s)}>Edit</Button></TableCell></TableRow>)}
      </TableBody></Table></div></CardContent></Card>}
    {report.data ? <Card><CardHeader><CardTitle className="text-base">TDS summary</CardTitle></CardHeader><CardContent className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <p className="text-sm">Deducted from suppliers (to deposit): <strong>₹ {money(report.data.totalPayable)}</strong><br /><span className="text-xs text-muted-foreground">TDS Payable ledger balance ₹ {money(report.data.glPayableBalance)}; deposit it with a journal (Dr TDS Payable, Cr Bank).</span></p>
        <p className="text-sm">Deducted by customers (to claim): <strong>₹ {money(report.data.totalReceivable)}</strong><br /><span className="text-xs text-muted-foreground">TDS Receivable ledger balance ₹ {money(report.data.glReceivableBalance)}</span></p>
      </div>
      {report.data.rows.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Voucher</TableHead><TableHead>Party</TableHead><TableHead>Section</TableHead><TableHead className="text-right">Settled</TableHead><TableHead className="text-right">TDS</TableHead></TableRow></TableHeader><TableBody>
        {report.data.rows.map((r) => <TableRow key={r.paymentNo}><TableCell>{r.paymentNo}<p className="text-xs text-muted-foreground">{dateStr(r.date)} · {r.type === 'PAYMENT' ? 'deducted' : 'suffered'}</p></TableCell><TableCell>{r.party}</TableCell><TableCell>{r.section} @ {r.ratePct}%</TableCell><TableCell className="text-right"><Money value={r.settled} /></TableCell><TableCell className="text-right"><Money value={r.tds} /></TableCell></TableRow>)}
      </TableBody></Table></div> : <p className="text-sm text-muted-foreground">No payment or receipt carries TDS yet.</p>}
    </CardContent></Card> : null}
    {editing ? <TdsDialog initial={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); books.reload(); report.reload() }} /> : null}
  </div>
}

function TdsDialog({ initial, onClose, onDone }: { initial: Partial<TdsSection>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ section: initial.section ?? '', description: initial.description ?? '', ratePct: String(initial.ratePct ?? ''), thresholdSingle: String(initial.thresholdSingle ?? 0), thresholdAnnual: String(initial.thresholdAnnual ?? 0), active: initial.active ?? true })
  const [saving, setSaving] = useState(false)
  const rate = Number(f.ratePct)
  const ok = f.section.trim().length >= 3 && f.description.trim().length >= 2 && rate >= 0 && rate <= 40 && f.ratePct !== ''
  const save = async () => { setSaving(true); try { await apiPost(B, { action: 'upsert-tds-section', section: f.section, description: f.description, ratePct: rate, thresholdSingle: Number(f.thresholdSingle) || 0, thresholdAnnual: Number(f.thresholdAnnual) || 0, active: f.active }); toast.success(`TDS ${f.section.toUpperCase()} saved`); onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>{initial.id ? `Edit ${initial.section}` : 'New TDS section'}</DialogTitle><DialogDescription>Rate and thresholds as per the Income-tax Act for the payee type.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor="tds-sec">Section</Label><Input id="tds-sec" className="h-11 uppercase" disabled={!!initial.id} value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} placeholder="194C" /></div>
      <div className="space-y-1.5"><Label htmlFor="tds-rate">Rate %</Label><Input id="tds-rate" className="h-11" inputMode="decimal" value={f.ratePct} onChange={(e) => setF({ ...f, ratePct: e.target.value })} /></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="tds-desc">Description</Label><Input id="tds-desc" className="h-11" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="tds-t1">Single-payment threshold ₹</Label><Input id="tds-t1" className="h-11" inputMode="decimal" value={f.thresholdSingle} onChange={(e) => setF({ ...f, thresholdSingle: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="tds-t2">Annual threshold ₹</Label><Input id="tds-t2" className="h-11" inputMode="decimal" value={f.thresholdAnnual} onChange={(e) => setF({ ...f, thresholdAnnual: e.target.value })} /></div>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active</label>
    </div>
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={!ok || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button></DialogFooter></DialogContent></Dialog>
}

// ---------------------------------------------------------------- period close

export function PeriodCloseTab() {
  const books = useBooks()
  const [lockDate, setLockDate] = useState('')
  const [confirm, setConfirm] = useState<{ kind: 'lock' | 'reopen' | 'fy'; until: string | null; fy?: string } | null>(null)
  if (books.loading) return <TableSkeleton rows={4} cols={3} />
  const d = books.data
  const lock = d?.booksLockedUntil ?? null
  const reopening = !!confirm && !!lock && (confirm.until === null || confirm.until < lock)
  return <div className="space-y-4">
    <Card><CardContent className="flex flex-wrap items-center gap-3 pt-6">
      {lock ? <><BookLock className="size-6 text-amber-600" aria-hidden /><div><p className="font-medium">Books locked up to {dateStr(lock)}</p><p className="text-sm text-muted-foreground">No document dated on or before this can be posted or cancelled{d?.booksLockedBy ? ` · set by ${d.booksLockedBy}` : ''}.</p></div></>
        : <><Unlock className="size-6 text-muted-foreground" aria-hidden /><div><p className="font-medium">No period is closed</p><p className="text-sm text-muted-foreground">Close a month or a financial year once its GST returns are filed and books are reviewed.</p></div></>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Financial years</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Year</TableHead><TableHead>Period</TableHead><TableHead>State</TableHead><TableHead /></TableRow></TableHeader><TableBody>
      {(d?.years ?? []).map((y) => <TableRow key={y.code}><TableCell className="font-medium">FY {y.code.slice(0, 2)}-{y.code.slice(2)}</TableCell><TableCell className="text-sm">{dateStr(y.start)} to {dateStr(y.end)}</TableCell>
        <TableCell><HumanStatus status={y.closed ? 'CLOSED' : 'OPEN'} detail={y.partlyLocked ? `locked up to ${dateStr(lock!)}` : undefined} /></TableCell>
        <TableCell className="text-right">{!y.closed && y.end < todayISO() ? <Button variant="outline" className="h-11 gap-2" onClick={() => setConfirm({ kind: 'fy', until: y.end, fy: y.code })}><Lock className="size-4" aria-hidden />Close year</Button> : null}</TableCell></TableRow>)}
    </TableBody></Table></div></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Lock up to a date</CardTitle></CardHeader><CardContent className="flex flex-wrap items-end gap-2">
      <div className="space-y-1.5"><Label htmlFor="lock-date">Lock date (before today)</Label><Input id="lock-date" type="date" className="h-11" max={todayISO()} value={lockDate} onChange={(e) => setLockDate(e.target.value)} /></div>
      <Button className="h-11 gap-2" disabled={!lockDate || lockDate >= todayISO()} onClick={() => setConfirm({ kind: 'lock', until: lockDate })}><Landmark className="size-4" aria-hidden />Set lock</Button>
      {lock ? <Button variant="outline" className="h-11" onClick={() => setConfirm({ kind: 'reopen', until: null })}>Remove lock (OWNER)</Button> : null}
    </CardContent></Card>
    {confirm ? <ReasonDialog
      title={confirm.kind === 'fy' ? `Close FY ${confirm.fy}?` : reopening ? 'Re-open a closed period?' : `Lock books up to ${dateStr(confirm.until!)}?`}
      lines={reopening ? ['documents in the re-opened dates can be posted and cancelled again', 'only the OWNER can do this; the reason is kept in the audit trail'] : ['no invoice, payment, journal, stock adjustment or other GL document can be posted on or before that date', 'documents in the closed period can no longer be cancelled; correct them with a journal in the open period']}
      confirm={reopening ? 'Re-open' : 'Close period'} optional={!reopening} destructive={reopening} placeholder={reopening ? 'e.g. GST notice: correcting October' : 'e.g. GSTR-3B for October filed'}
      onClose={() => setConfirm(null)}
      onConfirm={async (reason) => {
        if (confirm.kind === 'fy') await apiPost(B, { action: 'close-fy', fy: confirm.fy })
        else await apiPost(B, { action: 'lock-books', until: confirm.until, reason: reason || undefined })
        toast.success(reopening ? 'Period re-opened' : 'Books locked')
        setConfirm(null); books.reload()
      }} /> : null}
  </div>
}
