'use client'

/**
 * ForgeERP — SaaS Platform Admin console (single-page module, key-gated).
 * Plans CRUD · organizations (plan/billing/suspension — with REAL enforcement)
 * · usage vs limits · backup & restore.
 *
 * Honest scope: the ERP runtime always operates the FIRST organization;
 * orgs created here are real Company rows the platform manages. Full
 * per-request tenant scoping is a roadmap item.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Building2,
  CheckCircle2,
  DatabaseBackup,
  IndianRupee,
  KeyRound,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateStr, money } from '@/lib/erp'
import {
  api,
  downloadUrl,
  platformApi,
  toastError,
  type OrgsResponse,
  type Plan,
} from './api'
import { EmptyState, KpiCard, SectionHeading, TableSkeleton } from './bits'

const KEY_STORE = 'forge_platform_key'

export function PlatformView() {
  const [key, setKey] = useState('')
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const saved = sessionStorage.getItem(KEY_STORE)
    if (saved) {
      setKey(saved)
      void verify(saved)
    }
  }, [])

  const verify = async (k: string) => {
    setChecking(true)
    try {
      await api('/api/platform/auth', { method: 'POST', body: JSON.stringify({ key: k }) })
      sessionStorage.setItem(KEY_STORE, k)
      setAuthed(true)
    } catch (e) {
      sessionStorage.removeItem(KEY_STORE)
      toastError(e)
    } finally {
      setChecking(false)
    }
  }

  if (!authed) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-10">
        <SectionHeading title="Platform Admin" description="SaaS control plane — plans, organizations, subscriptions, backups." />
        <Card className="p-0">
          <CardContent className="space-y-4 p-6">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <KeyRound className="size-6" aria-hidden />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="platform-key">Platform admin key</Label>
              <Input
                id="platform-key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && key) void verify(key)
                }}
                placeholder="forge-admin"
                className="h-11"
              />
              <p className="text-xs text-muted-foreground">
                Default is <span className="font-mono">forge-admin</span> — change it with the <span className="font-mono">PLATFORM_ADMIN_KEY</span> environment variable.
              </p>
            </div>
            <Button onClick={() => void verify(key)} disabled={!key || checking} className="h-11 w-full gap-2">
              {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
              Unlock console
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <Console key={key} apiKey={key} onAuthLost={() => setAuthed(false)} />
}

// ---------------------------------------------------------------------------

function Console({ apiKey, onAuthLost }: { apiKey: string; onAuthLost: () => void }) {
  const [tab, setTab] = useState<'orgs' | 'plans'>('orgs')
  const [data, setData] = useState<OrgsResponse | null>(null)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [orgs, pl] = await Promise.all([
        platformApi<OrgsResponse>('/api/platform/orgs', undefined, apiKey),
        platformApi<Plan[]>('/api/platform/plans', undefined, apiKey),
      ])
      setData(orgs)
      setPlans(pl)
    } catch (e) {
      toastError(e)
      onAuthLost()
    } finally {
      setLoading(false)
    }
  }, [apiKey, onAuthLost])

  useEffect(() => {
    void reload()
  }, [reload])

  const orgAction = async (id: string, body: Record<string, unknown>, okMsg: string) => {
    try {
      await platformApi(`/api/platform/orgs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, apiKey)
      toast.success(okMsg)
      void reload()
    } catch (e) {
      toastError(e)
    }
  }

  const stats = data?.stats

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Platform Admin"
        description="Plans, organizations, subscriptions, backups. The ERP operates the first organization; suspension/expiry blocks its business mutations for real."
        actions={
          <Button variant="outline" onClick={() => void reload()} className="h-11 gap-2">
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
        }
      />

      {loading && !data ? (
        <TableSkeleton rows={4} cols={4} />
      ) : stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Organizations" value={String(stats.total)} icon={Building2} hint={`${stats.active} active · ${stats.suspended} suspended`} />
          <KpiCard title="MRR" value={`₹ ${money(stats.mrr)}`} icon={IndianRupee} tone="positive" hint="Active orgs × monthly plan price" />
          <KpiCard title="Documents" value={String(stats.salesInvoices)} icon={DatabaseBackup} hint={`${stats.parties} parties · ${stats.items} items`} />
          <KpiCard title="Warehouses" value={String(stats.warehouses)} icon={Building2} hint="Across the operating org" />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant={tab === 'orgs' ? 'default' : 'outline'} onClick={() => setTab('orgs')} className="h-11">
          Organizations ({data?.orgs.length ?? 0})
        </Button>
        <Button variant={tab === 'plans' ? 'default' : 'outline'} onClick={() => setTab('plans')} className="h-11">
          Plans ({plans?.length ?? 0})
        </Button>
      </div>

      {tab === 'orgs' ? <OrgsTable data={data} plans={plans ?? []} apiKey={apiKey} onAction={orgAction} reload={reload} /> : null}
      {tab === 'plans' ? <PlansTable plans={plans ?? []} apiKey={apiKey} reload={reload} /> : null}

      <BackupCard />
    </div>
  )
}

// ---------------------------------------------------------------------------

function OrgsTable({
  data,
  plans,
  apiKey,
  onAction,
  reload,
}: {
  data: OrgsResponse | null
  plans: Plan[]
  apiKey: string
  onAction: (id: string, body: Record<string, unknown>, okMsg: string) => Promise<void>
  reload: () => Promise<void>
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [gstin, setGstin] = useState('')
  const [planId, setPlanId] = useState('none')
  const [trialDays, setTrialDays] = useState('14')
  const [creating, setCreating] = useState(false)

  const create = async () => {
    setCreating(true)
    try {
      await platformApi(
        '/api/platform/orgs',
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            gstin: gstin || undefined,
            planId: planId === 'none' ? null : planId,
            trialDays: Number(trialDays) || 0,
          }),
        },
        apiKey
      )
      toast.success(`Organization "${name}" created`)
      setCreateOpen(false)
      setName('')
      setGstin('')
      void reload()
    } catch (e) {
      toastError(e)
    } finally {
      setCreating(false)
    }
  }

  const del = async (id: string, orgName: string) => {
    try {
      await platformApi(`/api/platform/orgs/${id}?confirmName=${encodeURIComponent(orgName)}`, { method: 'DELETE' }, apiKey)
      toast.success(`${orgName} deleted`)
      void reload()
    } catch (e) {
      toastError(e)
    }
  }

  if (!data || data.orgs.length === 0) {
    return (
      <Card className="p-0">
        <CardContent className="p-6">
          <EmptyState
            title="No organizations"
            hint="Create the first organization — it becomes a real Company row you can manage here."
            action={
              <Button onClick={() => setCreateOpen(true)} className="mt-2 h-11 gap-2">
                <Plus className="size-4" aria-hidden /> New organization
              </Button>
            }
          />
        </CardContent>
      </Card>
    )
  }

  const stateBadge = (o: OrgsResponse['orgs'][number]) => {
    const now = Date.now()
    const paidOk = o.paidUntil ? new Date(o.paidUntil).getTime() > now : false
    const trialOk = o.trialEndsAt ? new Date(o.trialEndsAt).getTime() > now : false
    if (o.saasStatus === 'SUSPENDED') return <Badge variant="destructive">Suspended</Badge>
    if (paidOk) return <Badge variant="default">Paid</Badge>
    if (trialOk) return <Badge variant="outline" className="border-amber-400 text-amber-600 dark:text-amber-400">Trial</Badge>
    if (o.paidUntil || o.trialEndsAt) return <Badge variant="destructive">Expired</Badge>
    return <Badge variant="secondary">Free / unlimited</Badge>
  }

  return (
    <>
      <Card className="p-0">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 p-4">
            <p className="text-sm font-semibold">Organizations</p>
            <Button size="sm" className="h-10 gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden /> New organization
            </Button>
          </div>
          <div className="max-h-[62dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Usage (operating org)</TableHead>
                  <TableHead className="hidden md:table-cell">Paid until / Trial until</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.orgs.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <span className="block font-medium">{o.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {o.gstin ?? 'No GSTIN'}
                        {o.operating ? ' · operating (opens in the ERP)' : ''}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={o.plan?.id ?? 'none'}
                        onValueChange={(v) => void onAction(o.id, { action: 'setPlan', planId: v === 'none' ? null : v }, 'Plan updated')}
                      >
                        <SelectTrigger className="h-10 w-40" aria-label={`Plan for ${o.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No plan (unlimited)</SelectItem>
                          {plans.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {o.customized ? <span className="mt-1 block text-[11px] text-muted-foreground">custom limits</span> : null}
                    </TableCell>
                    <TableCell>{stateBadge(o)}</TableCell>
                    <TableCell className="hidden text-xs tabular-nums md:table-cell">
                      {o.operating ? (
                        <>
                          {o.usage.parties}/{o.limits.parties || '∞'} parties · {o.usage.items}/{o.limits.items || '∞'} items ·{' '}
                          {o.usage.warehouses}/{o.limits.warehouses || '∞'} wh
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-xs tabular-nums md:table-cell">
                      {o.paidUntil ? <span>Paid: {dateStr(o.paidUntil)}</span> : null}
                      {o.trialEndsAt ? (
                        <span className={o.paidUntil ? ' block' : ''}>Trial: {dateStr(o.trialEndsAt)}</span>
                      ) : null}
                      {!o.paidUntil && !o.trialEndsAt ? <span className="text-muted-foreground">No expiry</span> : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Mobile: billing actions in one overflow menu (40px trigger) */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-10 md:hidden"
                              aria-label={`More actions for ${o.name}`}
                            >
                              <MoreVertical className="size-4" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => void onAction(o.id, { action: 'markPaid', cycle: 'MONTHLY' }, 'Marked paid +1 month')}>
                              Mark paid +1 month
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void onAction(o.id, { action: 'markPaid', cycle: 'YEARLY' }, 'Marked paid +1 year')}>
                              Mark paid +1 year
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void onAction(o.id, { action: 'extendTrial', days: 7 }, 'Trial extended +7 days')}>
                              Extend trial +7 days
                            </DropdownMenuItem>
                            {o.saasStatus === 'SUSPENDED' ? (
                              <DropdownMenuItem onClick={() => void onAction(o.id, { action: 'activate' }, 'Organization activated')}>
                                <CheckCircle2 className="size-4" aria-hidden /> Activate
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => void onAction(o.id, { action: 'suspend' }, 'Organization suspended — mutations now blocked')}>
                                <ShieldAlert className="size-4" aria-hidden /> Suspend
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {/* Desktop: inline quick actions */}
                        <div className="hidden items-center gap-1.5 md:flex">
                          <Button size="sm" variant="outline" className="h-8" onClick={() => void onAction(o.id, { action: 'markPaid', cycle: 'MONTHLY' }, 'Marked paid +1 month')}>
                            +1 mo
                          </Button>
                          <Button size="sm" variant="outline" className="h-8" onClick={() => void onAction(o.id, { action: 'markPaid', cycle: 'YEARLY' }, 'Marked paid +1 year')}>
                            +1 yr
                          </Button>
                          <Button size="sm" variant="outline" className="h-8" onClick={() => void onAction(o.id, { action: 'extendTrial', days: 7 }, 'Trial extended +7 days')}>
                            +7d trial
                          </Button>
                          {o.saasStatus === 'SUSPENDED' ? (
                            <Button size="sm" className="h-8 gap-1" onClick={() => void onAction(o.id, { action: 'activate' }, 'Organization activated')}>
                              <CheckCircle2 className="size-3.5" aria-hidden /> Activate
                            </Button>
                          ) : (
                            <Button size="sm" variant="destructive" className="h-8 gap-1" onClick={() => void onAction(o.id, { action: 'suspend' }, 'Organization suspended — mutations now blocked')}>
                              <ShieldAlert className="size-3.5" aria-hidden /> Suspend
                            </Button>
                          )}
                        </div>
                        {/* Delete stays a guarded 40px button on every size */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-10 text-destructive hover:text-destructive md:h-8" aria-label={`Delete ${o.name}`}>
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {o.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {o.operating
                                  ? 'This is the OPERATING organization — deleting it wipes ALL business data (invoices, ledgers, jobwork, masters). Type the exact name to confirm.'
                                  : 'Type the exact organization name to confirm.'}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <DeleteConfirm name={o.name} onConfirm={() => void del(o.id, o.name)} />
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New organization</DialogTitle>
            <DialogDescription>Creates a real Company row with a plan and trial. The ERP keeps operating the first org.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Name</Label>
              <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11" placeholder="Acme Industries" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-gstin">GSTIN (optional)</Label>
              <Input id="org-gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} className="h-11 font-mono" maxLength={15} placeholder="27ABCDE1234F1Z5" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={planId} onValueChange={setPlanId}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No plan (unlimited)</SelectItem>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-trial">Trial days</Label>
                <Input id="org-trial" type="number" min={0} max={365} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} className="h-11" />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating} className="h-11">
              Cancel
            </Button>
            <Button onClick={create} disabled={!name.trim() || creating} className="h-11 gap-2">
              {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function DeleteConfirm({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  const [typed, setTyped] = useState('')
  return (
    <div className="space-y-3">
      <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Type "${name}" to confirm`} className="h-11" />
      <AlertDialogFooter>
        <AlertDialogCancel>Keep</AlertDialogCancel>
        <AlertDialogAction
          disabled={typed !== name}
          onClick={onConfirm}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          Delete permanently
        </AlertDialogAction>
      </AlertDialogFooter>
    </div>
  )
}

// ---------------------------------------------------------------------------

function PlansTable({ plans, apiKey, reload }: { plans: Plan[]; apiKey: string; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Plan | null>(null)
  const [form, setForm] = useState({ name: '', priceMonthly: '0', priceYearly: '0', maxItems: '0', maxWarehouses: '0', maxParties: '0' })
  const [saving, setSaving] = useState(false)

  const openNew = () => {
    setEditing(null)
    setForm({ name: '', priceMonthly: '0', priceYearly: '0', maxItems: '0', maxWarehouses: '0', maxParties: '0' })
    setOpen(true)
  }
  const openEdit = (p: Plan) => {
    setEditing(p)
    setForm({
      name: p.name,
      priceMonthly: String(p.priceMonthly),
      priceYearly: String(p.priceYearly),
      maxItems: String(p.maxItems),
      maxWarehouses: String(p.maxWarehouses),
      maxParties: String(p.maxParties),
    })
    setOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        priceMonthly: Number(form.priceMonthly) || 0,
        priceYearly: Number(form.priceYearly) || 0,
        maxItems: Math.max(0, Math.trunc(Number(form.maxItems) || 0)),
        maxWarehouses: Math.max(0, Math.trunc(Number(form.maxWarehouses) || 0)),
        maxParties: Math.max(0, Math.trunc(Number(form.maxParties) || 0)),
      }
      if (editing) await platformApi(`/api/platform/plans/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) }, apiKey)
      else await platformApi('/api/platform/plans', { method: 'POST', body: JSON.stringify(body) }, apiKey)
      toast.success(editing ? 'Plan updated' : 'Plan created')
      setOpen(false)
      void reload()
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  const del = async (p: Plan) => {
    try {
      await platformApi(`/api/platform/plans?id=${p.id}`, { method: 'DELETE' }, apiKey)
      toast.success(`${p.name} deleted`)
      void reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <>
      <Card className="p-0">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 p-4">
            <p className="text-sm font-semibold">Plans (0 = unlimited)</p>
            <Button size="sm" className="h-10 gap-2" onClick={openNew}>
              <Plus className="size-4" aria-hidden /> New plan
            </Button>
          </div>
          <div className="overflow-auto erp-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">₹ / month</TableHead>
                  <TableHead className="text-right">₹ / year</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Warehouses</TableHead>
                  <TableHead className="text-right">Parties</TableHead>
                  <TableHead className="text-right">Orgs</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(p.priceMonthly)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(p.priceYearly)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.maxItems || '∞'}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.maxWarehouses || '∞'}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.maxParties || '∞'}</TableCell>
                    <TableCell className="text-right tabular-nums">{p._count?.companies ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-10 md:h-8" onClick={() => openEdit(p)}>
                          Edit
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-10 text-destructive hover:text-destructive md:h-8" disabled={(p._count?.companies ?? 0) > 0}>
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete plan {p.name}?</AlertDialogTitle>
                              <AlertDialogDescription>Plans in use by organizations cannot be deleted.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Keep</AlertDialogCancel>
                              <AlertDialogAction onClick={() => void del(p)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit plan — ${editing.name}` : 'New plan'}</DialogTitle>
            <DialogDescription>Limits of 0 mean unlimited. Prices are in ₹ (0 = free).</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-name">Name</Label>
              <Input id="plan-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11" placeholder="Growth" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-m">₹ / month</Label>
              <Input id="plan-m" type="number" min={0} value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-y">₹ / year</Label>
              <Input id="plan-y" type="number" min={0} value={form.priceYearly} onChange={(e) => setForm({ ...form, priceYearly: e.target.value })} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-i">Max items</Label>
              <Input id="plan-i" type="number" min={0} value={form.maxItems} onChange={(e) => setForm({ ...form, maxItems: e.target.value })} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-w">Max warehouses</Label>
              <Input id="plan-w" type="number" min={0} value={form.maxWarehouses} onChange={(e) => setForm({ ...form, maxWarehouses: e.target.value })} className="h-11" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-p">Max parties</Label>
              <Input id="plan-p" type="number" min={0} value={form.maxParties} onChange={(e) => setForm({ ...form, maxParties: e.target.value })} className="h-11" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving} className="h-11">
              Cancel
            </Button>
            <Button onClick={save} disabled={!form.name.trim() || saving} className="h-11 gap-2">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} Save plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------

function BackupCard() {
  const [restoring, setRestoring] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const restore = async (file: File) => {
    setRestoring(true)
    try {
      const snapshot = JSON.parse(await file.text())
      const res = await api<{ restored: boolean }>('/api/backup/restore', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'RESTORE', snapshot }),
      })
      if (res.restored) {
        toast.success('Snapshot restored', { description: 'Reload the page to see the restored data.' })
      }
    } catch (e) {
      toastError(e)
    } finally {
      setRestoring(false)
      setConfirmText('')
    }
  }

  return (
    <Card className="p-0">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Data & backup</p>
            <p className="text-xs text-muted-foreground">
              Full JSON snapshot of every table. Restore is destructive and transactional — everything is replaced inside one transaction.
            </p>
          </div>
          <Button variant="outline" className="h-10 gap-2" onClick={() => downloadUrl('/api/backup')}>
            <DatabaseBackup className="size-4" aria-hidden /> Download backup
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed p-3">
          <div className="min-w-44 flex-1 space-y-1.5">
            <Label htmlFor="restore-confirm">Restore — type RESTORE to enable</Label>
            <Input id="restore-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value.toUpperCase())} placeholder="RESTORE" className="h-11" />
          </div>
          <Label
            className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border px-4 text-sm font-medium ${
              confirmText === 'RESTORE' ? 'border-destructive text-destructive hover:bg-destructive/10' : 'pointer-events-none opacity-50'
            }`}
          >
            {restoring ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <DatabaseBackup className="size-4" aria-hidden />}
            {restoring ? 'Restoring…' : 'Pick snapshot file…'}
            <input
              type="file"
              accept="application/json"
              className="sr-only"
              disabled={confirmText !== 'RESTORE' || restoring}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void restore(f)
                e.target.value = ''
              }}
            />
          </Label>
        </div>
      </CardContent>
    </Card>
  )
}
