'use client'

/**
 * CRM & Service: leads (enquiry → follow-ups → customer → quotation → won/lost),
 * salespersons and their monthly performance, after-sales service calls.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlarmClock, CalendarClock, CheckCircle2, Headset, Plus, Receipt, Target, UserPlus, Users, Wrench } from 'lucide-react'
import { apiPost, currentMonth, toastError, useApi, useMasters, type Employee } from './api'
import { EmptyState, HumanStatus, KpiCard, Money, SectionHeading, TableSkeleton } from './bits'
import { ReasonDialog } from './reason-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { dateStr, money } from '@/lib/erp'

type Salesperson = { id: string; code: string; name: string; phone: string | null; email: string | null; monthlyTarget: number; active: boolean }
type Activity = { id: string; type: string; notes: string; dueAt: string | null; doneAt: string | null; createdBy: string | null; createdAt: string }
type Lead = {
  id: string; leadNo: string; date: string; contactName: string; organisation: string | null; phone: string | null; email: string | null; city: string | null; source: string; status: string
  requirement: string | null; expectedValue: number; probability: number; expectedCloseDate: string | null; nextFollowUpAt: string | null; lostReason: string | null
  salesperson: { id: string; name: string } | null; party: { id: string; code: string; name: string } | null; activities: Activity[]
}
type CrmData = { leads: Lead[]; salespersons: Salesperson[]; pipeline: { status: string; count: number; value: number; weighted: number }[]; overdueFollowUps: number; noFollowUp: number; winRate: number | null; lostReasons: { reason: string; count: number }[] }
const C = '/api/crm'
const SOURCES = ['WEBSITE', 'REFERRAL', 'EXHIBITION', 'COLD_CALL', 'MARKETPLACE', 'EXISTING_CUSTOMER', 'OTHER']
const NEXT: Record<string, string[]> = { NEW: ['CONTACTED', 'QUALIFIED', 'LOST'], CONTACTED: ['QUALIFIED', 'PROPOSAL', 'LOST'], QUALIFIED: ['PROPOSAL', 'WON', 'LOST'], PROPOSAL: ['WON', 'LOST', 'QUALIFIED'], WON: [], LOST: ['CONTACTED'] }
const label = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())
const today = () => new Date().toISOString().slice(0, 10)

export function CrmView() {
  const [tab, setTab] = useState('leads')
  return <div className="space-y-4">
    <SectionHeading title="CRM & Service" description="Enquiries to orders with a follow-up for every lead, salesperson targets, and after-sales service calls." />
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList className="h-11 w-full justify-start overflow-x-auto sm:w-auto">
        <TabsTrigger value="leads" className="h-11 sm:h-9">Leads</TabsTrigger>
        <TabsTrigger value="salespersons" className="h-11 sm:h-9">Salespersons</TabsTrigger>
        <TabsTrigger value="performance" className="h-11 sm:h-9">Performance</TabsTrigger>
        <TabsTrigger value="service" className="h-11 sm:h-9">Service Calls</TabsTrigger>
      </TabsList>
      <TabsContent value="leads" className="mt-4">{tab === 'leads' ? <LeadsTab /> : null}</TabsContent>
      <TabsContent value="salespersons" className="mt-4">{tab === 'salespersons' ? <SalespersonsTab /> : null}</TabsContent>
      <TabsContent value="performance" className="mt-4">{tab === 'performance' ? <PerformanceTab /> : null}</TabsContent>
      <TabsContent value="service" className="mt-4">{tab === 'service' ? <ServiceCallsTab /> : null}</TabsContent>
    </Tabs>
  </div>
}

// ---------------------------------------------------------------- leads

function LeadsTab() {
  const crm = useApi<CrmData>(C)
  const [filter, setFilter] = useState('OPEN')
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  if (crm.loading) return <TableSkeleton rows={6} cols={5} />
  const d = crm.data
  if (!d) return null
  const now = new Date()
  const rows = d.leads.filter((l) => (filter === 'OPEN' ? !['WON', 'LOST'].includes(l.status) : filter === 'ALL' ? true : l.status === filter))
  const selected = d.leads.find((l) => l.id === selectedId) ?? null
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard title="Open pipeline (weighted)" value={`₹ ${money(d.pipeline.filter((p) => !['WON', 'LOST'].includes(p.status)).reduce((s, p) => s + p.weighted, 0))}`} icon={Target} hint="expected value × probability" />
      <KpiCard title="Follow-ups overdue" value={String(d.overdueFollowUps)} icon={AlarmClock} tone={d.overdueFollowUps ? 'negative' : 'default'} onClick={() => setFilter('OPEN')} />
      <KpiCard title="Open leads without a follow-up" value={String(d.noFollowUp)} icon={CalendarClock} tone={d.noFollowUp ? 'warning' : 'default'} />
      <KpiCard title="Win rate (closed leads)" value={d.winRate === null ? '—' : `${d.winRate}%`} icon={CheckCircle2} />
    </div>
    <div className="flex flex-wrap gap-2">
      <Button className="h-11 gap-2" onClick={() => setCreating(true)}><UserPlus className="size-4" aria-hidden />New lead</Button>
      <Select value={filter} onValueChange={setFilter}><SelectTrigger className="h-11 data-[size=default]:h-11 w-48" aria-label="Filter leads"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="OPEN">Open leads</SelectItem><SelectItem value="ALL">All leads</SelectItem>{d.pipeline.map((p) => <SelectItem key={p.status} value={p.status}>{label(p.status)} ({p.count})</SelectItem>)}
      </SelectContent></Select>
    </div>
    <div className="flex flex-wrap gap-2 text-xs">{d.pipeline.map((p) => <Badge key={p.status} variant="outline" className="h-8 px-2">{label(p.status)}: {p.count} · ₹ {money(p.value)}</Badge>)}</div>
    {!rows.length ? <EmptyState icon={Users} title={d.leads.length ? 'No leads in this view' : 'No leads yet'} hint="Add every enquiry (phone, exhibition, website, referral) as a lead and plan its next follow-up, so none is forgotten." action={<Button variant="outline" className="mt-2 h-11" onClick={() => setCreating(true)}>New lead</Button>} /> :
      <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Requirement</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Next follow-up</TableHead><TableHead>Stage</TableHead></TableRow></TableHeader><TableBody>
        {rows.map((l) => {
          const overdue = l.nextFollowUpAt && new Date(l.nextFollowUpAt) < now
          return <TableRow key={l.id} className={selected?.id === l.id ? 'bg-muted/50' : 'cursor-pointer'} onClick={() => setSelectedId(l.id)}>
            <TableCell className="font-medium"><button type="button" className="min-h-11 min-w-11 text-left underline-offset-2 hover:underline" onClick={() => setSelectedId(l.id)}>{l.organisation || l.contactName}</button><p className="text-xs text-muted-foreground">{l.leadNo} · {l.contactName}{l.phone ? ` · ${l.phone}` : ''}</p><p className="text-xs text-muted-foreground">{label(l.source)}{l.salesperson ? ` · ${l.salesperson.name}` : ' · unassigned'}</p></TableCell>
            <TableCell className="max-w-xs text-sm">{l.requirement ?? '—'}</TableCell>
            <TableCell className="text-right"><Money value={l.expectedValue} /><p className="text-xs text-muted-foreground">{l.probability}%</p></TableCell>
            <TableCell className="text-sm">{l.nextFollowUpAt ? <span className={overdue ? 'font-medium text-destructive' : ''}>{dateStr(l.nextFollowUpAt)}{overdue ? ' (overdue)' : ''}</span> : ['WON', 'LOST'].includes(l.status) ? '—' : <span className="text-amber-700 dark:text-amber-400">not planned</span>}</TableCell>
            <TableCell><HumanStatus status={l.status} detail={l.party ? `customer ${l.party.code}` : l.lostReason ?? undefined} /></TableCell>
          </TableRow>
        })}
      </TableBody></Table></div></CardContent></Card>}
    {selected ? <LeadDetail lead={selected} onChanged={() => crm.reload()} /> : null}
    {creating ? <LeadDialog salespersons={d.salespersons.filter((s) => s.active)} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); crm.reload(); setSelectedId(id) }} /> : null}
  </div>
}

function LeadDetail({ lead, onChanged }: { lead: Lead; onChanged: () => void }) {
  const [moving, setMoving] = useState<string | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [converting, setConverting] = useState(false)
  const done = async (a: Activity) => { try { await apiPost(C, { action: 'complete-activity', id: a.id }); toast.success('Follow-up done'); onChanged() } catch (e) { toastError(e) } }
  const moves = NEXT[lead.status] ?? []
  return <Card><CardHeader><CardTitle className="text-base">{lead.leadNo}: {lead.organisation || lead.contactName}</CardTitle></CardHeader><CardContent className="space-y-4">
    <div className="grid gap-2 text-sm sm:grid-cols-3">
      <p>Contact: <strong>{lead.contactName}</strong>{lead.phone ? ` · ${lead.phone}` : ''}{lead.email ? ` · ${lead.email}` : ''}</p>
      <p>Expected close: {lead.expectedCloseDate ? dateStr(lead.expectedCloseDate) : '—'}</p>
      <p>Customer: {lead.party ? `${lead.party.name} (${lead.party.code})` : 'not converted'}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button className="h-11 gap-2" onClick={() => setActivityOpen(true)}><Plus className="size-4" aria-hidden />Log / plan follow-up</Button>
      {!lead.party && lead.status !== 'LOST' ? <Button variant="outline" className="h-11 gap-2" onClick={() => setConverting(true)}><UserPlus className="size-4" aria-hidden />Convert to customer</Button> : null}
      {moves.map((m) => <Button key={m} variant={m === 'LOST' ? 'ghost' : 'outline'} className="h-11" disabled={m === 'WON' && !lead.party} title={m === 'WON' && !lead.party ? 'Convert to a customer first' : undefined} onClick={() => setMoving(m)}>{m === 'CONTACTED' && lead.status === 'LOST' ? 'Re-open' : `Mark ${label(m).toLowerCase()}`}</Button>)}
    </div>
    {lead.party ? <p className="text-sm text-muted-foreground">Raise the quotation for {lead.party.name} under Sales → Quotations; mark the lead won when the order comes.</p> : null}
    <div className="space-y-2">{lead.activities.length ? lead.activities.map((a) => <div key={a.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-2 text-sm">
      <div><p><Badge variant="outline" className="mr-2">{label(a.type)}</Badge>{a.notes}</p><p className="text-xs text-muted-foreground">{a.doneAt ? `done ${dateStr(a.doneAt)}` : a.dueAt ? `due ${dateStr(a.dueAt)}` : ''}{a.createdBy ? ` · ${a.createdBy}` : ''}</p></div>
      {!a.doneAt ? <Button variant="outline" className="h-11" onClick={() => void done(a)}>Mark done</Button> : null}
    </div>) : <p className="text-sm text-muted-foreground">No follow-ups yet. Plan the first call.</p>}</div>
    {moving ? <ReasonDialog title={`Move ${lead.leadNo} to ${label(moving).toLowerCase()}?`} lines={moving === 'LOST' ? ['closes the lead and clears its follow-up', 'only the OWNER can re-open it'] : moving === 'WON' ? ['closes the lead as won (customer ' + (lead.party?.code ?? '') + ')'] : [`stage ${label(lead.status)} → ${label(moving)}`]}
      confirm={`Mark ${label(moving).toLowerCase()}`} optional={moving !== 'LOST'} destructive={moving === 'LOST'} placeholder={moving === 'LOST' ? 'e.g. price too high, bought from competitor' : 'Note (optional)'}
      onClose={() => setMoving(null)} onConfirm={async (reason) => { await apiPost(C, { action: 'move-lead', id: lead.id, status: moving, reason: reason || undefined }); toast.success(`${lead.leadNo} → ${label(moving)}`); setMoving(null); onChanged() }} /> : null}
    {activityOpen ? <ActivityDialog lead={lead} onClose={() => setActivityOpen(false)} onDone={() => { setActivityOpen(false); onChanged() }} /> : null}
    {converting ? <ConvertDialog lead={lead} onClose={() => setConverting(false)} onDone={() => { setConverting(false); onChanged() }} /> : null}
  </CardContent></Card>
}

function LeadDialog({ salespersons, onClose, onDone }: { salespersons: Salesperson[]; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ contactName: '', organisation: '', phone: '', email: '', city: '', source: 'OTHER', requirement: '', expectedValue: '', expectedCloseDate: '', nextFollowUpAt: today(), salespersonId: '' })
  const [saving, setSaving] = useState(false)
  const problems = [f.contactName.trim().length < 2 ? 'Contact name' : '', !f.phone.trim() && !f.email.trim() ? 'A phone or an email' : ''].filter(Boolean)
  const save = async () => {
    setSaving(true)
    try {
      const lead = await apiPost<{ id: string; leadNo: string }>(C, { action: 'create-lead', contactName: f.contactName, organisation: f.organisation || null, phone: f.phone || null, email: f.email || null, city: f.city || null, source: f.source, requirement: f.requirement || null, expectedValue: Number(f.expectedValue) || 0, expectedCloseDate: f.expectedCloseDate || null, nextFollowUpAt: f.nextFollowUpAt || null, salespersonId: f.salespersonId || null })
      toast.success(`${lead.leadNo} created`); onDone(lead.id)
    } catch (e) { toastError(e) } finally { setSaving(false) }
  }
  const field = (k: keyof typeof f, l: string, props: Record<string, unknown> = {}) => <div className="space-y-1.5"><Label htmlFor={`ld-${k}`}>{l}</Label><Input id={`ld-${k}`} className="h-11" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></div>
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>New lead</DialogTitle><DialogDescription>An enquiry from a prospect. Plan the first follow-up now.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2">
      {field('contactName', 'Contact person')}{field('organisation', 'Company')}{field('phone', 'Phone', { inputMode: 'tel' })}{field('email', 'Email', { type: 'email' })}{field('city', 'City')}
      <div className="space-y-1.5"><Label>Source</Label><Select value={f.source} onValueChange={(v) => setF({ ...f, source: v })}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue /></SelectTrigger><SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{label(s)}</SelectItem>)}</SelectContent></Select></div>
      {field('expectedValue', 'Expected value ₹', { inputMode: 'decimal' })}{field('expectedCloseDate', 'Expected close', { type: 'date' })}{field('nextFollowUpAt', 'First follow-up', { type: 'date' })}
      <div className="space-y-1.5"><Label>Salesperson</Label><Select value={f.salespersonId || 'none'} onValueChange={(v) => setF({ ...f, salespersonId: v === 'none' ? '' : v })}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{salespersons.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ld-req">Requirement</Label><Textarea id="ld-req" value={f.requirement} onChange={(e) => setF({ ...f, requirement: e.target.value })} placeholder="e.g. 500 MS brackets per month, drawing to follow" /></div>
    </div>
    {problems.length ? <p className="text-sm text-muted-foreground">Needed: {problems.join(', ')}</p> : null}
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={problems.length > 0 || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Create lead'}</Button></DialogFooter></DialogContent></Dialog>
}

function ActivityDialog({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState('CALL'); const [notes, setNotes] = useState(''); const [planned, setPlanned] = useState(false); const [dueAt, setDueAt] = useState(today())
  const [saving, setSaving] = useState(false)
  const save = async () => { setSaving(true); try { await apiPost(C, { action: 'add-activity', leadId: lead.id, type, notes, done: !planned, dueAt: planned ? dueAt : null }); toast.success(planned ? 'Follow-up planned' : 'Activity logged'); onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>{lead.leadNo}: follow-up</DialogTitle><DialogDescription>Log what happened, or plan the next step with a date.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label>Type</Label><Select value={type} onValueChange={setType}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue /></SelectTrigger><SelectContent>{['CALL', 'MEETING', 'EMAIL', 'VISIT', 'NOTE'].map((t) => <SelectItem key={t} value={t}>{label(t)}</SelectItem>)}</SelectContent></Select></div>
      <label className="flex min-h-11 items-end gap-2 pb-2 text-sm"><input type="checkbox" className="size-5" checked={planned} onChange={(e) => setPlanned(e.target.checked)} />Plan for later</label>
      {planned ? <div className="space-y-1.5"><Label htmlFor="act-due">Due</Label><Input id="act-due" type="date" className="h-11" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div> : null}
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="act-notes">{planned ? 'What to do' : 'What happened'}</Label><Textarea id="act-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
    </div>
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={notes.trim().length < 2 || (planned && !dueAt) || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button></DialogFooter></DialogContent></Dialog>
}

function ConvertDialog({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: () => void }) {
  const { parties } = useMasters()
  const customers = parties.filter((p) => p.active)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [code, setCode] = useState((lead.organisation || lead.contactName).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase())
  const [partyId, setPartyId] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async () => { setSaving(true); try { await apiPost(C, { action: 'convert-lead', id: lead.id, ...(mode === 'new' ? { code } : { partyId }) }); toast.success('Lead converted to customer'); onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>Convert {lead.leadNo} to a customer</DialogTitle><DialogDescription>Creates the customer from the lead details (name, phone, email, GSTIN), or links an existing party.</DialogDescription></DialogHeader>
    <div className="flex gap-2"><Button variant={mode === 'new' ? 'default' : 'outline'} className="h-11" onClick={() => setMode('new')}>New customer</Button><Button variant={mode === 'existing' ? 'default' : 'outline'} className="h-11" onClick={() => setMode('existing')}>Existing party</Button></div>
    {mode === 'new' ? <div className="space-y-1.5"><Label htmlFor="cv-code">Customer code</Label><Input id="cv-code" className="h-11 uppercase" value={code} onChange={(e) => setCode(e.target.value)} /><p className="text-xs text-muted-foreground">Name: {lead.organisation || lead.contactName}. Complete the address and GSTIN later in Masters.</p></div>
      : <Select value={partyId} onValueChange={setPartyId}><SelectTrigger className="h-11 data-[size=default]:h-11" aria-label="Party"><SelectValue placeholder="Choose party" /></SelectTrigger><SelectContent>{customers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>)}</SelectContent></Select>}
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={saving || (mode === 'new' ? code.trim().length < 2 : !partyId)} onClick={() => void save()}>{saving ? 'Converting…' : 'Convert'}</Button></DialogFooter></DialogContent></Dialog>
}

// ---------------------------------------------------------------- salespersons

function SalespersonsTab() {
  const crm = useApi<CrmData>(C)
  const [editing, setEditing] = useState<Partial<Salesperson> | null>(null)
  if (crm.loading) return <TableSkeleton rows={4} cols={4} />
  const list = crm.data?.salespersons ?? []
  return <div className="space-y-4">
    <Button className="h-11 gap-2" onClick={() => setEditing({ active: true })}><Plus className="size-4" aria-hidden />New salesperson</Button>
    {!list.length ? <EmptyState icon={Users} title="No salespersons" hint="Add your sales team with a monthly target; leads, quotations and invoices can then be credited to them." /> :
      <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead className="text-right">Monthly target</TableHead><TableHead /></TableRow></TableHeader><TableBody>
        {list.map((s) => <TableRow key={s.id}><TableCell className="font-medium">{s.name}<p className="text-xs text-muted-foreground">{s.code}{s.active ? '' : ' · inactive'}</p></TableCell><TableCell className="text-sm">{[s.phone, s.email].filter(Boolean).join(' · ') || '—'}</TableCell><TableCell className="text-right"><Money value={s.monthlyTarget} /></TableCell><TableCell className="text-right"><Button variant="outline" className="h-11" onClick={() => setEditing(s)}>Edit</Button></TableCell></TableRow>)}
      </TableBody></Table></div></CardContent></Card>}
    {editing ? <SalespersonDialog initial={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); crm.reload() }} /> : null}
  </div>
}

function SalespersonDialog({ initial, onClose, onDone }: { initial: Partial<Salesperson>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ code: initial.code ?? '', name: initial.name ?? '', phone: initial.phone ?? '', email: initial.email ?? '', monthlyTarget: String(initial.monthlyTarget ?? ''), active: initial.active ?? true })
  const [saving, setSaving] = useState(false)
  const save = async () => { setSaving(true); try { await apiPost(C, { action: 'save-salesperson', id: initial.id, code: f.code, name: f.name, phone: f.phone || null, email: f.email || null, monthlyTarget: Number(f.monthlyTarget) || 0, active: f.active }); toast.success('Salesperson saved'); onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>{initial.id ? `Edit ${initial.name}` : 'New salesperson'}</DialogTitle><DialogDescription>Target is the taxable invoice value expected per month.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor="sp-code">Code</Label><Input id="sp-code" className="h-11 uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="sp-name">Name</Label><Input id="sp-name" className="h-11" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="sp-phone">Phone</Label><Input id="sp-phone" className="h-11" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="sp-email">Email</Label><Input id="sp-email" className="h-11" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="sp-target">Monthly target ₹</Label><Input id="sp-target" className="h-11" inputMode="decimal" value={f.monthlyTarget} onChange={(e) => setF({ ...f, monthlyTarget: e.target.value })} /></div>
      <label className="flex min-h-11 items-end gap-2 pb-2 text-sm"><input type="checkbox" className="size-5" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active</label>
    </div>
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={f.code.trim().length < 2 || f.name.trim().length < 2 || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button></DialogFooter></DialogContent></Dialog>
}

type Perf = { month: string; rows: { id: string; name: string; code: string; target: number; invoiced: number; invoices: number; achievementPct: number | null; quoted: number; openLeads: number; pipelineWeighted: number; wonInMonth: number }[]; unassignedInvoiced: number; unassignedInvoices: number }

function PerformanceTab() {
  const [month, setMonth] = useState(currentMonth())
  const perf = useApi<Perf>(`${C}?report=salesperson&month=${month}`)
  return <div className="space-y-4">
    <div className="space-y-1.5"><Label htmlFor="perf-month">Month</Label><Input id="perf-month" type="month" className="h-11 w-48" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
    {perf.loading ? <TableSkeleton rows={4} cols={6} /> : !perf.data?.rows.length ? <EmptyState icon={Target} title="No salespersons" hint="Add salespersons first, then pick them on quotations and invoices." /> :
      <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Salesperson</TableHead><TableHead className="text-right">Target</TableHead><TableHead className="text-right">Invoiced (taxable)</TableHead><TableHead className="text-right">Achieved</TableHead><TableHead className="text-right">Quoted</TableHead><TableHead className="text-right">Open pipeline</TableHead><TableHead className="text-right">Won</TableHead></TableRow></TableHeader><TableBody>
        {perf.data.rows.map((r) => <TableRow key={r.id}><TableCell className="font-medium">{r.name}<p className="text-xs text-muted-foreground">{r.invoices} invoice(s)</p></TableCell><TableCell className="text-right"><Money value={r.target} /></TableCell><TableCell className="text-right"><Money value={r.invoiced} /></TableCell>
          <TableCell className="text-right">{r.achievementPct === null ? '—' : <span className={r.achievementPct >= 100 ? 'font-medium text-emerald-700 dark:text-emerald-400' : r.achievementPct < 50 ? 'text-destructive' : ''}>{r.achievementPct}%</span>}</TableCell>
          <TableCell className="text-right"><Money value={r.quoted} /></TableCell><TableCell className="text-right"><Money value={r.pipelineWeighted} /><p className="text-xs text-muted-foreground">{r.openLeads} lead(s)</p></TableCell><TableCell className="text-right">{r.wonInMonth}</TableCell></TableRow>)}
      </TableBody></Table></div></CardContent></Card>}
    {perf.data && perf.data.unassignedInvoices > 0 ? <p className="text-sm text-muted-foreground">{perf.data.unassignedInvoices} invoice(s) worth ₹ {money(perf.data.unassignedInvoiced)} have no salesperson.</p> : null}
  </div>
}

// ---------------------------------------------------------------- service calls

type Call = {
  id: string; callNo: string; date: string; serialNo: string | null; complaint: string; priority: string; status: string; underWarranty: boolean; dueAt: string | null; resolution: string | null; serviceCharge: number; cancelReason: string | null
  party: { code: string; name: string }; item: { code: string; name: string } | null; assignedTo: { id: string; name: string } | null; invoice: { invoiceNo: string; grandTotal: number; status: string } | null; overdue: boolean; resolutionHours: number | null
}
type ServiceData = { calls: Call[]; open: number; overdue: number; toInvoice: number; avgResolutionHours: number | null }
const S = '/api/service-calls'

function ServiceCallsTab() {
  const svc = useApi<ServiceData>(S)
  const employees = useApi<Employee[]>('/api/manufacturing/employees')
  const { items } = useMasters()
  const [creating, setCreating] = useState(false)
  const [action, setAction] = useState<{ call: Call; kind: 'assign' | 'resolve' | 'invoice' | 'cancel' | 'close' } | null>(null)
  if (svc.loading) return <TableSkeleton rows={5} cols={5} />
  const d = svc.data
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard title="Open calls" value={String(d?.open ?? 0)} icon={Headset} />
      <KpiCard title="Past response target" value={String(d?.overdue ?? 0)} icon={AlarmClock} tone={d?.overdue ? 'negative' : 'default'} />
      <KpiCard title="Resolved, not invoiced" value={String(d?.toInvoice ?? 0)} icon={Receipt} tone={d?.toInvoice ? 'warning' : 'default'} />
      <KpiCard title="Average resolution" value={d?.avgResolutionHours === null || d?.avgResolutionHours === undefined ? '—' : `${d.avgResolutionHours} h`} icon={Wrench} />
    </div>
    <Button className="h-11 gap-2" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />New service call</Button>
    {!d?.calls.length ? <EmptyState icon={Headset} title="No service calls" hint="Log customer complaints and breakdowns, assign an engineer, record the fix and invoice chargeable visits." /> :
      <Card className="p-0"><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Call</TableHead><TableHead>Complaint</TableHead><TableHead>Engineer</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>
        {d.calls.map((c) => <TableRow key={c.id}>
          <TableCell className="align-top font-medium">{c.callNo}<p className="text-xs text-muted-foreground">{dateStr(c.date)} · {c.party.name}</p><p className="text-xs"><Badge variant="outline">{label(c.priority)}</Badge>{c.underWarranty ? <Badge variant="outline" className="ml-1">warranty</Badge> : null}</p></TableCell>
          <TableCell className="max-w-xs align-top text-sm">{c.item ? <p className="text-xs text-muted-foreground">{c.item.code} {c.item.name}{c.serialNo ? ` · S/N ${c.serialNo}` : ''}</p> : null}{c.complaint}{c.resolution ? <p className="text-xs text-emerald-700 dark:text-emerald-400">Fix: {c.resolution}</p> : null}</TableCell>
          <TableCell className="align-top text-sm">{c.assignedTo?.name ?? '—'}</TableCell>
          <TableCell className="align-top"><HumanStatus status={c.overdue ? 'OVERDUE' : c.status} detail={c.invoice ? `${c.invoice.invoiceNo} ₹ ${money(c.invoice.grandTotal)}` : c.serviceCharge > 0 ? `charge ₹ ${money(c.serviceCharge)}` : c.dueAt && ['OPEN', 'ASSIGNED'].includes(c.status) ? `respond by ${dateStr(c.dueAt)}` : c.cancelReason ?? undefined} /></TableCell>
          <TableCell className="space-x-2 whitespace-nowrap text-right align-top">
            {['OPEN', 'ASSIGNED'].includes(c.status) ? <Button variant="outline" className="h-11" onClick={() => setAction({ call: c, kind: 'assign' })}>{c.assignedTo ? 'Reassign' : 'Assign'}</Button> : null}
            {c.status === 'ASSIGNED' ? <Button className="h-11" onClick={() => setAction({ call: c, kind: 'resolve' })}>Resolve</Button> : null}
            {(c.status === 'RESOLVED' || c.status === 'CLOSED') && c.serviceCharge > 0 && (!c.invoice || c.invoice.status === 'CANCELLED') ? <Button className="h-11" onClick={() => setAction({ call: c, kind: 'invoice' })}>Invoice</Button> : null}
            {c.status === 'RESOLVED' && (c.serviceCharge === 0 || c.invoice) ? <Button variant="outline" className="h-11" onClick={() => setAction({ call: c, kind: 'close' })}>Close</Button> : null}
            {['OPEN', 'ASSIGNED'].includes(c.status) ? <Button variant="ghost" className="h-11" onClick={() => setAction({ call: c, kind: 'cancel' })}>Cancel</Button> : null}
          </TableCell>
        </TableRow>)}
      </TableBody></Table></div></CardContent></Card>}
    {creating ? <NewCallDialog onClose={() => setCreating(false)} onDone={() => { setCreating(false); svc.reload() }} /> : null}
    {action ? <CallActionDialog call={action.call} kind={action.kind} employees={(employees.data ?? []).filter((e) => e.active)} serviceItems={items.filter((i) => i.isService && i.active)} onClose={() => setAction(null)} onDone={() => { setAction(null); svc.reload() }} /> : null}
  </div>
}

function NewCallDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { parties, items } = useMasters()
  const customers = parties.filter((p) => p.active && p.types.split(',').includes('CUSTOMER'))
  const [f, setF] = useState({ partyId: '', itemId: '', serialNo: '', complaint: '', priority: 'MEDIUM', underWarranty: false })
  const [saving, setSaving] = useState(false)
  const save = async () => { setSaving(true); try { const c = await apiPost<{ callNo: string }>(S, { action: 'create', partyId: f.partyId, itemId: f.itemId || null, serialNo: f.serialNo || null, complaint: f.complaint, priority: f.priority, underWarranty: f.underWarranty }); toast.success(`${c.callNo} logged`); onDone() } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>New service call</DialogTitle><DialogDescription>Response target: critical 8 h, high 24 h, medium 48 h, low 5 days.</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2"><Label>Customer</Label><Select value={f.partyId} onValueChange={(v) => setF({ ...f, partyId: v })}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue placeholder="Choose customer" /></SelectTrigger><SelectContent>{customers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Product (optional)</Label><Select value={f.itemId || 'none'} onValueChange={(v) => setF({ ...f, itemId: v === 'none' ? '' : v })}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not specified</SelectItem>{items.filter((i) => !i.isService).map((i) => <SelectItem key={i.id} value={i.id}>{i.code} {i.name}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor="sc-serial">Serial no. (optional)</Label><Input id="sc-serial" className="h-11" value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} /></div>
      <div className="space-y-1.5"><Label>Priority</Label><Select value={f.priority} onValueChange={(v) => setF({ ...f, priority: v })}><SelectTrigger className="h-11 data-[size=default]:h-11"><SelectValue /></SelectTrigger><SelectContent>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => <SelectItem key={p} value={p}>{label(p)}</SelectItem>)}</SelectContent></Select></div>
      <label className="flex min-h-11 items-end gap-2 pb-2 text-sm"><input type="checkbox" className="size-5" checked={f.underWarranty} onChange={(e) => setF({ ...f, underWarranty: e.target.checked })} />Under warranty (no charge)</label>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="sc-complaint">Complaint</Label><Textarea id="sc-complaint" value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} placeholder="e.g. Pump not building pressure after 2 hours" /></div>
    </div>
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={!f.partyId || f.complaint.trim().length < 5 || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Log call'}</Button></DialogFooter></DialogContent></Dialog>
}

function CallActionDialog({ call, kind, employees, serviceItems, onClose, onDone }: { call: Call; kind: 'assign' | 'resolve' | 'invoice' | 'cancel' | 'close'; employees: Employee[]; serviceItems: { id: string; code: string; name: string; gstRate: number }[]; onClose: () => void; onDone: () => void }) {
  const [employeeId, setEmployeeId] = useState(call.assignedTo?.id ?? '')
  const [resolution, setResolution] = useState('')
  const [charge, setCharge] = useState('')
  const [itemId, setItemId] = useState(serviceItems[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const item = useMemo(() => serviceItems.find((i) => i.id === itemId), [serviceItems, itemId])
  if (kind === 'cancel') return <ReasonDialog title={`Cancel ${call.callNo}?`} lines={['closes the call without a resolution']} confirm="Cancel call" onClose={onClose} onConfirm={async (reason) => { await apiPost(S, { action: 'cancel', id: call.id, reason }); toast.success(`${call.callNo} cancelled`); onDone() }} />
  if (kind === 'close') return <ReasonDialog title={`Close ${call.callNo}?`} lines={['the customer confirmed the fix; the call is complete']} confirm="Close call" optional destructive={false} onClose={onClose} onConfirm={async () => { await apiPost(S, { action: 'close', id: call.id }); toast.success(`${call.callNo} closed`); onDone() }} />
  const run = async () => {
    setSaving(true)
    try {
      if (kind === 'assign') await apiPost(S, { action: 'assign', id: call.id, employeeId })
      if (kind === 'resolve') await apiPost(S, { action: 'resolve', id: call.id, resolution, serviceCharge: Number(charge) || 0 })
      if (kind === 'invoice') { const inv = await apiPost<{ invoiceNo: string }>(S, { action: 'invoice', id: call.id, serviceItemId: itemId }); toast.success(`${inv.invoiceNo} raised`) } else toast.success('Saved')
      onDone()
    } catch (e) { toastError(e) } finally { setSaving(false) }
  }
  const valid = kind === 'assign' ? !!employeeId : kind === 'resolve' ? resolution.trim().length >= 3 && !(call.underWarranty && Number(charge) > 0) : !!itemId
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>{kind === 'assign' ? 'Assign engineer' : kind === 'resolve' ? 'Resolve call' : 'Invoice service charge'}: {call.callNo}</DialogTitle><DialogDescription>{call.party.name}: {call.complaint.slice(0, 120)}</DialogDescription></DialogHeader>
    {kind === 'assign' ? (employees.length ? <Select value={employeeId} onValueChange={setEmployeeId}><SelectTrigger className="h-11 data-[size=default]:h-11" aria-label="Engineer"><SelectValue placeholder="Choose engineer" /></SelectTrigger><SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}{e.skill ? ` (${e.skill})` : ''}</SelectItem>)}</SelectContent></Select> : <p className="text-sm text-muted-foreground">Add engineers under Manufacturing → Employees first.</p>) : null}
    {kind === 'resolve' ? <div className="space-y-3">
      <div className="space-y-1.5"><Label htmlFor="res-text">What was done</Label><Textarea id="res-text" value={resolution} onChange={(e) => setResolution(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="res-charge">Service charge ₹ (before GST)</Label><Input id="res-charge" className="h-11" inputMode="decimal" disabled={call.underWarranty} value={call.underWarranty ? '0' : charge} onChange={(e) => setCharge(e.target.value)} />{call.underWarranty ? <p className="text-xs text-muted-foreground">Under warranty: no charge.</p> : null}</div>
    </div> : null}
    {kind === 'invoice' ? (serviceItems.length ? <div className="space-y-2">
      <Select value={itemId} onValueChange={setItemId}><SelectTrigger className="h-11 data-[size=default]:h-11" aria-label="Service item"><SelectValue /></SelectTrigger><SelectContent>{serviceItems.map((i) => <SelectItem key={i.id} value={i.id}>{i.code} {i.name}</SelectItem>)}</SelectContent></Select>
      <p className="text-sm">Posts sales invoice: ₹ {money(call.serviceCharge)} + GST {item?.gstRate ?? 0}% to {call.party.name}; Dr Debtors, Cr Sales and output GST. No stock moves.</p>
    </div> : <p className="text-sm text-muted-foreground">Create a service item (with its SAC code) in Masters → Items first.</p>) : null}
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Close</Button><Button className="h-11" disabled={!valid || saving} onClick={() => void run()}>{saving ? 'Saving…' : kind === 'invoice' ? 'Post invoice' : 'Save'}</Button></DialogFooter></DialogContent></Dialog>
}
