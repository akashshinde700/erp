'use client'

/**
 * Overhead advisor — measures the factory-overhead absorption rate from the
 * books instead of guessing it: actual, trend (recent months weighted more)
 * and budget rates, a recommendation with confidence, the absorbed-vs-incurred
 * tracker, a what-if on open orders, the overhead ledger pool and the
 * period-end clearing. Applying a rate is an OWNER action with a reason.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Gauge, Lightbulb, Scale, Sparkles, TrendingUp } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiPost, toastError, useApi } from './api'
import { ErrorState, Money, TableSkeleton } from './bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { money } from '@/lib/erp'

interface Advisor {
  window: { from: string; to: string; months: number }
  current: { ratePct: number; setAt: string | null; setBy: string | null; reason: string | null }
  budget: { overheadAnnual: number | null; primeCostAnnual: number | null }
  rates: { actualRatePct: number | null; trendRatePct: number | null; budgetRatePct: number | null; labourHourRate: number | null }
  recommendation: { ratePct: number | null; source: 'BUDGET' | 'TREND' | null; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'; reasons: string[]; gapPct: number | null }
  totals: { incurred: number; primeCost: number; absorbed: number; overUnder: number; tasks: number; hours: number }
  ovha: { balance: number; lastClose: { date: string; voucherNo: string } | null }
  ledgers: { id: string; code: string; name: string; group: string; active: boolean; isFactoryOverhead: boolean; incurred: number }[]
  series: { month: string; incurred: number; primeCost: number; absorbed: number; overUnder: number; actualRatePct: number | null; tasks: number }[]
  whatIf: {
    ratePct: number
    openOrders: number
    openOrderTrueUp: number
    orders: { woNo: string; current: number; atRate: number; delta: number }[]
    projectedMonthlyAbsorption: number
    projectedMonthlyIncurred: number
    projectedMonthlyOverUnder: number
  } | null
}

const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)
const CONF_TONE: Record<string, string> = {
  HIGH: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  MEDIUM: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  LOW: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  NONE: 'bg-muted text-muted-foreground',
}
const todayIso = () => new Date().toISOString().slice(0, 10)

export function OverheadAdvisorTab() {
  const [months, setMonths] = useState(12)
  const [whatIf, setWhatIf] = useState('')
  const q = whatIf.trim() !== '' && Number.isFinite(Number(whatIf)) ? `&whatIf=${Number(whatIf)}` : ''
  const res = useApi<Advisor>(`/api/manufacturing/overhead?months=${months}${q}`)
  const d = res.data
  const [applyOpen, setApplyOpen] = useState(false)
  const [rate, setRate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [budgetOh, setBudgetOh] = useState<string | null>(null)
  const [budgetPrime, setBudgetPrime] = useState<string | null>(null)
  const [closeDate, setCloseDate] = useState(todayIso())

  const chart = useMemo(() => (d?.series ?? []).map((m) => ({ month: m.month.slice(2), Incurred: m.incurred, Absorbed: m.absorbed })), [d])

  if (res.error) return <ErrorState error={res.error} onRetry={() => res.reload()} entity="overhead advisor" />
  if (!d) return <TableSkeleton rows={6} cols={4} />

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true)
    try {
      await apiPost('/api/manufacturing/overhead', body)
      toast.success(success)
      res.reload()
      return true
    } catch (e) {
      toastError(e)
      return false
    } finally {
      setBusy(false)
    }
  }
  const rec = d.recommendation
  const ou = d.totals.overUnder
  const ohValue = budgetOh ?? (d.budget.overheadAnnual != null ? String(d.budget.overheadAnnual) : '')
  const primeValue = budgetPrime ?? (d.budget.primeCostAnnual != null ? String(d.budget.primeCostAnnual) : '')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Overhead advisor</h2>
          <p className="text-sm text-muted-foreground">
            Measures the absorption rate from your books ({d.window.from} → {d.window.to}) instead of guessing it, and keeps measuring.
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Window">
          {[6, 12, 24].map((m) => (
            <Button key={m} variant={months === m ? 'default' : 'outline'} className="h-11" onClick={() => setMonths(m)}>
              {m} months
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Gauge className="size-3.5" aria-hidden />Rate in force</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{d.current.ratePct}%</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {d.current.setAt ? `Set ${new Date(d.current.setAt).toLocaleDateString('en-IN')} by ${d.current.setBy ?? '—'}` : 'Never set through the advisor'}
            {d.current.reason ? ` — “${d.current.reason}”` : ''}
          </p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles className="size-3.5" aria-hidden />Recommended</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{fmtPct(rec.ratePct)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-medium ${CONF_TONE[rec.confidence]}`}>{rec.confidence === 'NONE' ? 'No data yet' : `${rec.confidence} confidence`}</span>
            {rec.source ? <span className="text-muted-foreground">from {rec.source === 'BUDGET' ? 'your budget' : 'measured trend'}</span> : null}
            {rec.gapPct != null && Math.abs(rec.gapPct) >= 0.5 ? <span className="text-muted-foreground">({rec.gapPct > 0 ? '+' : ''}{rec.gapPct} pts vs now)</span> : null}
          </div>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><TrendingUp className="size-3.5" aria-hidden />Measured rates</p>
          <dl className="mt-1 grid grid-cols-3 gap-1 text-sm tabular-nums">
            <div><dt className="text-xs text-muted-foreground">Actual</dt><dd className="font-semibold">{fmtPct(d.rates.actualRatePct)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Trend</dt><dd className="font-semibold">{fmtPct(d.rates.trendRatePct)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Budget</dt><dd className="font-semibold">{fmtPct(d.rates.budgetRatePct)}</dd></div>
          </dl>
          <p className="mt-1 text-xs text-muted-foreground">{d.rates.labourHourRate != null ? `≈ ₹${money(d.rates.labourHourRate)} per labour hour` : 'Labour-hour rate: no hours booked'}</p>
        </Card>
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Scale className="size-3.5" aria-hidden />Absorbed vs incurred</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${ou < 0 ? 'text-destructive' : ''}`}>₹ {money(Math.abs(ou))}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {Math.abs(ou) < 0.01 ? 'In balance' : ou < 0 ? 'Under-absorbed: products carry less overhead than you spent' : 'Over-absorbed: products carry more overhead than you spent'} · parked in OVHA ₹ {money(d.ovha.balance)}
          </p>
        </Card>
      </div>

      {rec.reasons.length ? (
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium"><Lightbulb className="size-4" aria-hidden />Why this confidence</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {rec.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="min-w-0 p-4 lg:col-span-3">
          <p className="text-sm font-medium">Incurred vs absorbed, by month</p>
          <div className="mt-2 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => (v >= 100000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip formatter={(v) => `₹ ${money(Number(v))}`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Incurred" fill="var(--chart-2)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Absorbed" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Prime cost in window ₹ {money(d.totals.primeCost)} across {d.totals.tasks} completed operations.</p>
        </Card>

        <Card className="min-w-0 p-4 lg:col-span-2">
          <p className="text-sm font-medium">What if the rate were…</p>
          <div className="mt-2 flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="oh-whatif">Rate %</Label>
              <Input id="oh-whatif" type="number" inputMode="decimal" min={0} max={100} step={0.5} className="h-11 tabular-nums" placeholder={rec.ratePct != null ? String(rec.ratePct) : 'e.g. 18'} value={whatIf} onChange={(e) => setWhatIf(e.target.value)} />
            </div>
            <Button className="h-11" disabled={!d.whatIf} onClick={() => { setRate(String(d.whatIf?.ratePct ?? '')); setReason(''); setApplyOpen(true) }}>
              Apply…
            </Button>
          </div>
          {d.whatIf ? (
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Open orders affected</dt><dd className="tabular-nums">{d.whatIf.openOrders}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">True-up they would post</dt><dd className="tabular-nums"><Money value={d.whatIf.openOrderTrueUp} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Absorbed per month</dt><dd className="tabular-nums"><Money value={d.whatIf.projectedMonthlyAbsorption} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Spent per month (recent)</dt><dd className="tabular-nums"><Money value={d.whatIf.projectedMonthlyIncurred} /></dd></div>
              <div className="flex justify-between gap-2 font-medium">
                <dt>{d.whatIf.projectedMonthlyOverUnder < 0 ? 'Under-absorbed / month' : 'Over-absorbed / month'}</dt>
                <dd className={`tabular-nums ${d.whatIf.projectedMonthlyOverUnder < 0 ? 'text-destructive' : ''}`}>₹ {money(Math.abs(d.whatIf.projectedMonthlyOverUnder))}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Type a rate to see its effect — there is no recommendation to preview yet.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0 p-4">
          <p className="text-sm font-medium">Factory overhead pool</p>
          <p className="text-xs text-muted-foreground">Tag the expense ledgers that are factory overhead. Create ledgers in Accounting → Chart of Accounts.</p>
          {d.ledgers.length ? (
            <div className="mt-2 overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Ledger</TableHead><TableHead className="text-right">Spent in window</TableHead><TableHead className="text-right">Overhead</TableHead></TableRow></TableHeader>
                <TableBody>
                  {d.ledgers.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell><span className="font-medium">{l.name}</span><span className="block text-xs text-muted-foreground">{l.code} · {l.group}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{l.isFactoryOverhead ? money(l.incurred) : '—'}</TableCell>
                      <TableCell className="text-right">
                        <Switch checked={l.isFactoryOverhead} disabled={busy} aria-label={`${l.name} is factory overhead`} onCheckedChange={(v) => void act({ action: 'tag-ledger', ledgerId: l.id, isFactoryOverhead: v }, `${l.code} ${v ? 'added to' : 'removed from'} the overhead pool`)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No expense ledgers yet.</p>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="p-4">
            <p className="text-sm font-medium">Budget (predetermined rate)</p>
            <p className="text-xs text-muted-foreground">Optional. With a budget the recommendation uses budgeted overhead ÷ budgeted prime cost — the standard method; the measured trend stays visible for comparison.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="oh-b1">Annual factory overhead (₹)</Label><Input id="oh-b1" type="number" inputMode="decimal" min={0} className="h-11 tabular-nums" value={ohValue} onChange={(e) => setBudgetOh(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="oh-b2">Annual prime cost (₹)</Label><Input id="oh-b2" type="number" inputMode="decimal" min={0} className="h-11 tabular-nums" value={primeValue} onChange={(e) => setBudgetPrime(e.target.value)} /></div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button className="h-11" disabled={busy} onClick={async () => { if (await act({ action: 'set-budget', overheadAnnual: ohValue === '' ? null : Number(ohValue), primeCostAnnual: primeValue === '' ? null : Number(primeValue) }, 'Budget saved')) { setBudgetOh(null); setBudgetPrime(null) } }}>Save budget</Button>
              {d.budget.overheadAnnual != null ? <Button variant="outline" className="h-11" disabled={busy} onClick={async () => { if (await act({ action: 'set-budget', overheadAnnual: null, primeCostAnnual: null }, 'Budget cleared')) { setBudgetOh(null); setBudgetPrime(null) } }}>Clear</Button> : null}
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-medium">Period-end: clear absorbed overhead</p>
            <p className="text-xs text-muted-foreground">
              Posts Dr Factory Overhead Absorbed / Cr Factory Overhead Recovered for the parked balance (₹ {money(d.ovha.balance)}), so P&amp;L shows the real under/over-absorption.
              {d.ovha.lastClose ? ` Last cleared ${d.ovha.lastClose.date} (${d.ovha.lastClose.voucherNo}).` : ' Never cleared yet.'}
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="space-y-1.5"><Label htmlFor="oh-close">Up to</Label><Input id="oh-close" type="date" className="h-11" max={todayIso()} value={closeDate} onChange={(e) => setCloseDate(e.target.value)} /></div>
              <Button variant="outline" className="h-11" disabled={busy || d.ovha.balance <= 0.004} onClick={() => void act({ action: 'close', upTo: closeDate }, `Absorbed overhead cleared up to ${closeDate}`)}>Clear absorbed overhead</Button>
            </div>
          </Card>
        </div>
      </div>

      {d.whatIf?.orders.length ? (
        <Card className="min-w-0 p-4">
          <p className="text-sm font-medium">Open orders at {d.whatIf.ratePct}%</p>
          <div className="mt-2 overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Work order</TableHead><TableHead className="text-right">Absorbed now</TableHead><TableHead className="text-right">At this rate</TableHead><TableHead className="text-right">True-up</TableHead></TableRow></TableHeader>
              <TableBody>
                {d.whatIf.orders.map((o) => (
                  <TableRow key={o.woNo}><TableCell className="font-medium">{o.woNo}</TableCell><TableCell className="text-right tabular-nums">{money(o.current)}</TableCell><TableCell className="text-right tabular-nums">{money(o.atRate)}</TableCell><TableCell className="text-right tabular-nums">{money(o.delta)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ) : null}

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply an absorption rate</DialogTitle>
            <DialogDescription>
              From now on every completed operation absorbs this percentage of its material + labour into WIP. Past postings are not rewritten — use the costing true-up for open orders. OWNER only; the reason is kept with the rate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="oh-rate">Rate %</Label><Input id="oh-rate" type="number" inputMode="decimal" min={0} max={100} step={0.5} className="h-11 tabular-nums" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="oh-reason">Reason</Label><Input id="oh-reason" className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. FY27 budget approved by the CA" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setApplyOpen(false)}>Cancel</Button>
            <Button className="h-11" disabled={busy || rate === '' || reason.trim().length < 10} onClick={async () => { if (await act({ action: 'set-rate', ratePct: Number(rate), reason: reason.trim() }, `Absorption rate set to ${Number(rate)}%`)) setApplyOpen(false) }}>
              Apply {rate === '' ? '' : `${Number(rate)}%`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
