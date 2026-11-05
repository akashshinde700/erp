'use client'

/**
 * ForgeERP — SaaS Platform Admin console (standalone fullscreen module, key-gated).
 *
 * Layout modeled on the reference SaaS console: flat white header with the
 * admin identity, pill tab navigation, light-gray content canvas — no ERP
 * sidebar. Tabs: Organizations · Plans · Inquiries · Blog · Logout.
 *
 * Honest scope: the ERP runtime always operates the FIRST organization;
 * orgs created here are real Company rows the platform manages. Full
 * per-request tenant scoping is a roadmap item. Plan feature pills map to
 * REAL enforcement (assertFeature) — only catalogued features are shown.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  DatabaseBackup,
  KeyRound,
  Loader2,
  LogOut,
  MoreVertical,
  Pencil,
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
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { dateStr, money } from '@/lib/erp'
import {
  api,
  downloadUrl,
  platformApi,
  toastError,
  type BlogPost,
  type InquiriesResponse,
  type InquiryRow,
  type OrgRow,
  type OrgsResponse,
  type Plan,
  PLAN_FEATURE_CATALOG,
} from './api'
import { CardSkeleton, EmptyState, TableSkeleton } from './bits'

const KEY_STORE = 'forge_platform_key'

type ConsoleTab = 'orgs' | 'plans' | 'inquiries' | 'blog'

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80)

const dt = (s: string) =>
  new Date(s).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  } catch {
    toast.error('Copy failed — select the text manually')
  }
}

// ---------------------------------------------------------------------------
// Entry: key gate → console
// ---------------------------------------------------------------------------

export function PlatformView({ onExit }: { onExit: () => void }) {
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
      <div className="flex min-h-dvh flex-col items-center justify-center bg-muted/30 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-3 text-center">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <KeyRound className="size-7" aria-hidden />
            </span>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">Platform Admin</h1>
              <p className="text-sm text-muted-foreground">Plans, organizations, subscriptions, inquiries — the control plane.</p>
            </div>
          </div>
          <Card className="p-0">
            <CardContent className="space-y-4 p-6">
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
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Default is <span className="font-mono">forge-admin</span> — change it with the{' '}
                  <span className="font-mono">PLATFORM_ADMIN_KEY</span> environment variable.
                </p>
              </div>
              <Button onClick={() => void verify(key)} disabled={!key || checking} className="h-11 w-full gap-2">
                {checking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
                Unlock console
              </Button>
            </CardContent>
          </Card>
          <Button variant="outline" onClick={onExit} className="h-11 w-full gap-2">
            <ArrowLeft className="size-4" aria-hidden /> Back to login
          </Button>
        </div>
      </div>
    )
  }

  return <Console key={key} apiKey={key} onAuthLost={() => setAuthed(false)} onExit={onExit} />
}

// ---------------------------------------------------------------------------
// Console shell: header (title + identity + pill nav) · tab body · footer
// ---------------------------------------------------------------------------

function Console({ apiKey, onAuthLost, onExit }: { apiKey: string; onAuthLost: () => void; onExit: () => void }) {
  const [tab, setTab] = useState<ConsoleTab>('orgs')
  const [data, setData] = useState<OrgsResponse | null>(null)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [inquiries, setInquiries] = useState<InquiriesResponse | null>(null)
  const [posts, setPosts] = useState<BlogPost[] | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [orgs, pl, inq, blog] = await Promise.all([
        platformApi<OrgsResponse>('/api/platform/orgs', undefined, apiKey),
        platformApi<Plan[]>('/api/platform/plans', undefined, apiKey),
        platformApi<InquiriesResponse>('/api/platform/inquiries', undefined, apiKey),
        platformApi<{ posts: BlogPost[] }>('/api/platform/blog', undefined, apiKey),
      ])
      setData(orgs)
      setPlans(pl)
      setInquiries(inq)
      setPosts(blog.posts)
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

  const logout = () => {
    sessionStorage.removeItem(KEY_STORE)
    onAuthLost()
  }

  const pill = (t: ConsoleTab, label: React.ReactNode, count?: number) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      aria-current={tab === t ? 'page' : undefined}
      className={cn(
        'inline-flex h-10 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors',
        tab === t
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground hover:bg-accent'
      )}
    >
      {label}
      {typeof count === 'number' ? <span className="tabular-nums opacity-70">({count})</span> : null}
    </button>
  )

  const newCount = inquiries?.newCount ?? 0

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 pb-[max(1rem,env(safe-area-inset-top))] sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <h1 className="truncate text-xl font-bold tracking-tight">Platform Admin</h1>
            <p className="truncate text-sm text-muted-foreground">
              <span className="font-mono">{apiKey}</span> · ForgeERP control plane
            </p>
          </div>
          <nav aria-label="Platform Admin sections" className="flex flex-wrap items-center gap-2">
            {pill('orgs', 'Organizations', data?.orgs.length)}
            {pill('plans', 'Plans', plans?.length)}
            {pill('inquiries', 'Inquiries', newCount > 0 ? newCount : undefined)}
            {pill('blog', 'Blog', posts?.length)}
            <span className="mx-0.5 hidden h-6 w-px bg-border sm:block" aria-hidden />
            <Button variant="outline" onClick={onExit} className="h-10 gap-2 rounded-full px-4">
              <ArrowLeft className="size-4" aria-hidden /> Back to login
            </Button>
            <Button variant="outline" onClick={logout} className="h-10 gap-2 rounded-full px-4 text-destructive hover:text-destructive">
              <LogOut className="size-4" aria-hidden /> Logout
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {loading && !data ? (
          <TableSkeleton rows={5} cols={5} />
        ) : tab === 'orgs' ? (
          <OrgsTab data={data} plans={plans ?? []} apiKey={apiKey} onAction={orgAction} reload={reload} />
        ) : tab === 'plans' ? (
          <PlansTab plans={plans ?? []} apiKey={apiKey} reload={reload} />
        ) : tab === 'inquiries' ? (
          <InquiriesTab inquiries={inquiries} apiKey={apiKey} reload={reload} />
        ) : (
          <BlogTab posts={posts ?? []} apiKey={apiKey} reload={reload} />
        )}
      </main>

      <footer className="mt-auto border-t bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-1 px-4 py-3 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <span>
            <span className="font-medium text-foreground">ForgeERP</span> Platform — plans, subscriptions &amp; enforcement
          </span>
          <span>Org logins gate the books · the ERP workspace is the first organization</span>
        </div>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Organizations tab
// ---------------------------------------------------------------------------

function OrgStatusBadge({ o }: { o: OrgRow }) {
  const now = Date.now()
  const paidOk = o.paidUntil ? new Date(o.paidUntil).getTime() > now : false
  const trialOk = o.trialEndsAt ? new Date(o.trialEndsAt).getTime() > now : false
  if (o.saasStatus === 'SUSPENDED')
    return (
      <Badge variant="destructive" className="font-normal">
        suspended
      </Badge>
    )
  if (paidOk)
    return (
      <Badge className="border-transparent bg-emerald-100 font-normal text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
        active
      </Badge>
    )
  if (trialOk)
    return (
      <Badge className="border-transparent bg-amber-100 font-normal text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
        trial
      </Badge>
    )
  if (o.paidUntil || o.trialEndsAt)
    return (
      <Badge variant="destructive" className="font-normal">
        expired
      </Badge>
    )
  return (
    <Badge variant="secondary" className="font-normal">
      free · unlimited
    </Badge>
  )
}

function OrgsTab({
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
  const [form, setForm] = useState({
    name: '',
    email: '',
    gstin: '',
    city: '',
    planId: 'none',
    trialDays: '14',
    ownerName: '',
    ownerEmail: '',
    ownerPassword: '',
  })
  const [creating, setCreating] = useState(false)
  const [customizing, setCustomizing] = useState<OrgRow | null>(null)
  const [custom, setCustom] = useState({ items: '', warehouses: '', parties: '' })
  const [savingCustom, setSavingCustom] = useState(false)
  const [resetting, setResetting] = useState<OrgRow | null>(null)
  const [resetPwd, setResetPwd] = useState('')
  const [resettingBusy, setResettingBusy] = useState(false)

  const create = async () => {
    setCreating(true)
    try {
      await platformApi(
        '/api/platform/orgs',
        {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            gstin: form.gstin || undefined,
            city: form.city || undefined,
            email: form.email || undefined,
            planId: form.planId === 'none' ? null : form.planId,
            trialDays: Number(form.trialDays) || 0,
            ownerName: form.ownerName.trim() || undefined,
            ownerEmail: form.ownerEmail.trim() || undefined,
            ownerPassword: form.ownerPassword || undefined,
          }),
        },
        apiKey
      )
      toast.success(
        form.ownerEmail.trim()
          ? `Organization "${form.name}" created with owner login ${form.ownerEmail.trim()}`
          : `Organization "${form.name}" created`
      )
      setCreateOpen(false)
      setForm({ name: '', email: '', gstin: '', city: '', planId: 'none', trialDays: '14', ownerName: '', ownerEmail: '', ownerPassword: '' })
      void reload()
    } catch (e) {
      toastError(e)
    } finally {
      setCreating(false)
    }
  }

  const resetLogin = async () => {
    if (!resetting) return
    if (!resetPwd || resetPwd.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    setResettingBusy(true)
    try {
      const email = resetting.ownerEmail ?? `${slugify(resetting.name).slice(0, 20)}@example.com`
      await platformApi(
        `/api/platform/orgs/${resetting.id}`,
        { method: 'PATCH', body: JSON.stringify({ action: 'resetLogin', email, password: resetPwd }) },
        apiKey
      )
      toast.success(`Login ${email} saved — ${resetting.name} can sign in with the new password`)
      setResetting(null)
      setResetPwd('')
      void reload()
    } catch (e) {
      toastError(e)
    } finally {
      setResettingBusy(false)
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

  const openCustomize = (o: OrgRow) => {
    setCustomizing(o)
    setCustom({
      items: o.limits.items && o.customized ? String(o.limits.items) : '',
      warehouses: o.limits.warehouses && o.customized ? String(o.limits.warehouses) : '',
      parties: o.limits.parties && o.customized ? String(o.limits.parties) : '',
    })
  }

  const saveCustom = async () => {
    if (!customizing) return
    setSavingCustom(true)
    try {
      await platformApi(
        `/api/platform/orgs/${customizing.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'customize',
            maxItems: custom.items === '' ? null : Math.max(0, Math.trunc(Number(custom.items) || 0)),
            maxWarehouses: custom.warehouses === '' ? null : Math.max(0, Math.trunc(Number(custom.warehouses) || 0)),
            maxParties: custom.parties === '' ? null : Math.max(0, Math.trunc(Number(custom.parties) || 0)),
          }),
        },
        apiKey
      )
      toast.success(`Custom limits saved for ${customizing.name}`)
      setCustomizing(null)
      void reload()
    } catch (e) {
      toastError(e)
    } finally {
      setSavingCustom(false)
    }
  }

  const stats = data?.stats
  const orgs = data?.orgs ?? []

  /** Stacked management actions (desktop cell / shared logic). */
  const actionButtons = (o: OrgRow, compact: boolean) => {
    const pillCls = compact
      ? 'h-8 rounded-full px-3 text-xs'
      : 'h-9 rounded-full px-4 text-sm'
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          className={pillCls}
          title="Extends the paid period by one billing cycle (+1 month / +1 year)"
          onClick={() =>
            void onAction(
              o.id,
              { action: 'markPaid', cycle: o.billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY' },
              `Marked paid until the next ${o.billingCycle === 'YEARLY' ? 'year' : 'month'}`
            )
          }
        >
          Mark paid
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={pillCls}
          onClick={() => void onAction(o.id, { action: 'extendTrial', days: 7 }, 'Trial extended +7 days')}
        >
          +7d trial
        </Button>
        {o.saasStatus === 'SUSPENDED' ? (
          <Button
            size="sm"
            className={cn(pillCls, 'gap-1')}
            onClick={() => void onAction(o.id, { action: 'activate' }, 'Organization activated')}
          >
            <CheckCircle2 className="size-3.5" aria-hidden /> Activate
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className={cn(pillCls, 'gap-1')}
            onClick={() => void onAction(o.id, { action: 'suspend' }, 'Organization suspended — business mutations now blocked')}
          >
            <ShieldAlert className="size-3.5" aria-hidden /> Suspend
          </Button>
        )}
        <Button size="sm" variant="outline" className={pillCls} onClick={() => openCustomize(o)}>
          Customize plan
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={pillCls}
          title="Set or replace the owner login this organization signs in with"
          onClick={() => {
            setResetting(o)
            setResetPwd('')
          }}
        >
          <KeyRound className="size-3.5" aria-hidden /> {o.ownerEmail ? 'Reset login' : 'Set login'}
        </Button>
      </>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Organizations ({orgs.length})</h2>
          {stats ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {stats.active} active · {stats.suspended} suspended · MRR ₹{money(stats.mrr)}
            </p>
          ) : null}
        </div>
        <Button onClick={() => setCreateOpen(true)} className="h-10 gap-2">
          <Plus className="size-4" aria-hidden /> Create organization
        </Button>
      </div>

      {orgs.length === 0 ? (
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
      ) : (
        <Card className="p-0">
          <CardContent className="p-0">
            <div className="max-h-[64dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead className="hidden lg:table-cell">Contact</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Usage</TableHead>
                    <TableHead className="hidden md:table-cell">Period / Trial</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgs.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <span className="block font-medium">{o.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {slugify(o.name)}
                          {o.city ? ` · ${o.city}` : ''}
                          {o.operating ? ' · operating (opens in the ERP)' : ''}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="block text-sm">{o.email ?? <span className="text-muted-foreground">no email</span>}</span>
                        {o.gstin ? (
                          <button
                            type="button"
                            onClick={() => void copyText(o.gstin ?? '')}
                            className="mt-1 inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent"
                            title="Copy GSTIN"
                          >
                            {o.gstin}
                            <Copy className="size-3" aria-hidden />
                            <span className="sr-only">Copy GSTIN {o.gstin}</span>
                          </button>
                        ) : null}
                        <span
                          className={`mt-1 flex items-center gap-1 text-[11px] ${o.ownerEmail ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}
                          title={o.ownerEmail ? `Owner login for ${o.name}` : 'No owner login yet — set one from Actions'}
                        >
                          <KeyRound className="size-3 shrink-0" aria-hidden />
                          {o.ownerEmail ?? 'no login'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={o.plan?.id ?? 'none'}
                          onValueChange={(v) => void onAction(o.id, { action: 'setPlan', planId: v === 'none' ? null : v }, 'Plan updated')}
                        >
                          <SelectTrigger className="h-9 w-36" aria-label={`Plan for ${o.name}`}>
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
                      <TableCell>
                        <OrgStatusBadge o={o} />
                      </TableCell>
                      <TableCell className="hidden text-xs tabular-nums lg:table-cell">
                        {o.operating ? (
                          <>
                            {o.usage.parties}/{o.limits.parties || '∞'} parties · {o.usage.items}/{o.limits.items || '∞'} items ·{' '}
                            {o.usage.warehouses}/{o.limits.warehouses || '∞'} wh · {o.usage.salesInvoices} inv
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-xs tabular-nums md:table-cell">
                        {o.paidUntil ? (
                          <span className="block">
                            Paid until {dateStr(o.paidUntil)}
                            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {o.billingCycle}
                            </span>
                          </span>
                        ) : null}
                        {!o.paidUntil && o.trialEndsAt ? <span className="block">Trial until {dateStr(o.trialEndsAt)}</span> : null}
                        {!o.paidUntil && !o.trialEndsAt ? <span className="text-muted-foreground">No expiry</span> : null}
                      </TableCell>
                      <TableCell>
                        {/* Desktop: stacked management pills (reference style) */}
                        <div className="hidden flex-col items-end gap-1.5 md:flex">
                          {actionButtons(o, false)}
                          {o.customized ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 rounded-full px-3 text-xs text-muted-foreground"
                              onClick={() => void onAction(o.id, { action: 'resetCustom' }, 'Custom limits removed — plan defaults apply')}
                            >
                              Reset custom
                            </Button>
                          ) : null}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-full border-destructive/40 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`Delete ${o.name}`}
                              >
                                Delete
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
                        {/* Mobile: one overflow menu + guarded delete */}
                        <div className="flex items-center justify-end gap-1.5 md:hidden">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-10" aria-label={`More actions for ${o.name}`}>
                                <MoreVertical className="size-4" aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  void onAction(
                                    o.id,
                                    { action: 'markPaid', cycle: o.billingCycle === 'YEARLY' ? 'YEARLY' : 'MONTHLY' },
                                    'Marked paid'
                                  )
                                }
                              >
                                Mark paid (+{o.billingCycle === 'YEARLY' ? '1 year' : '1 month'})
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void onAction(o.id, { action: 'extendTrial', days: 7 }, 'Trial extended +7 days')}>
                                Extend trial +7 days
                              </DropdownMenuItem>
                              {o.saasStatus === 'SUSPENDED' ? (
                                <DropdownMenuItem onClick={() => void onAction(o.id, { action: 'activate' }, 'Organization activated')}>
                                  <CheckCircle2 className="size-4" aria-hidden /> Activate
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => void onAction(o.id, { action: 'suspend' }, 'Organization suspended')}>
                                  <ShieldAlert className="size-4" aria-hidden /> Suspend
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => openCustomize(o)}>Customize plan limits…</DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setResetting(o)
                                  setResetPwd('')
                                }}
                              >
                                <KeyRound className="size-4" aria-hidden /> {o.ownerEmail ? 'Reset login' : 'Set login'}
                              </DropdownMenuItem>
                              {o.customized ? (
                                <DropdownMenuItem
                                  onClick={() => void onAction(o.id, { action: 'resetCustom' }, 'Custom limits removed')}
                                >
                                  Reset custom limits
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-10 text-destructive hover:text-destructive"
                                aria-label={`Delete ${o.name}`}
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete {o.name}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {o.operating
                                    ? 'This is the OPERATING organization — deleting it wipes ALL business data. Type the exact name to confirm.'
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
      )}

      <BackupCard apiKey={apiKey} />

      {/* Create organization dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>
              Creates a real Company row with a plan and trial. Add an owner login so that organization can sign in on the
              login screen — their session lands on the org portal (books stay with the operating org).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Name</Label>
              <Input
                id="org-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-11"
                placeholder="Acme Industries"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="org-email">Email (optional)</Label>
                <Input
                  id="org-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="h-11"
                  placeholder="works@acme.example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-city">City (optional)</Label>
                <Input
                  id="org-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="h-11"
                  placeholder="Pune"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-gstin">GSTIN (optional)</Label>
              <Input
                id="org-gstin"
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                className="h-11 font-mono"
                maxLength={15}
                placeholder="27ABCDE1234F1Z5"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Plan</Label>
                <Select value={form.planId} onValueChange={(v) => setForm({ ...form, planId: v })}>
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
                <Input
                  id="org-trial"
                  type="number"
                  min={0}
                  max={365}
                  value={form.trialDays}
                  onChange={(e) => setForm({ ...form, trialDays: e.target.value })}
                  className="h-11"
                />
              </div>
            </div>
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <KeyRound className="size-3.5" aria-hidden /> Owner login (optional — enables org sign-in)
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-owner-name" className="text-xs">Owner name</Label>
                <Input
                  id="org-owner-name"
                  value={form.ownerName}
                  onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                  className="h-10"
                  placeholder="e.g. Priya Sharma"
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="org-owner-email" className="text-xs">Login email</Label>
                  <Input
                    id="org-owner-email"
                    type="email"
                    value={form.ownerEmail}
                    onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                    className="h-10"
                    placeholder="priya@acme.example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="org-owner-password" className="text-xs">Password</Label>
                  <Input
                    id="org-owner-password"
                    type="password"
                    value={form.ownerPassword}
                    onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
                    className="h-10"
                    minLength={6}
                    placeholder="min 6 characters"
                  />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating} className="h-11">
              Cancel
            </Button>
            <Button onClick={create} disabled={!form.name.trim() || creating} className="h-11 gap-2">
              {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset / set owner login dialog */}
      <Dialog open={!!resetting} onOpenChange={(o) => !o && setResetting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{resetting?.ownerEmail ? 'Reset owner login' : 'Set owner login'}</DialogTitle>
            <DialogDescription>
              {resetting ? (
                resetting.ownerEmail ? (
                  <>Sets a new password for <span className="font-mono">{resetting.ownerEmail}</span> — the organization signs in on the login screen with it.</>
                ) : (
                  <>Creates an owner login for <span className="font-medium">{resetting.name}</span> (email <span className="font-mono">{slugify(resetting.name).slice(0, 20)}@example.com</span>).</>
                )
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">New password</Label>
              <Input
                id="reset-password"
                type="password"
                value={resetPwd}
                onChange={(e) => setResetPwd(e.target.value)}
                className="h-11"
                minLength={6}
                placeholder="min 6 characters"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResetting(null)} disabled={resettingBusy} className="h-11">
              Cancel
            </Button>
            <Button onClick={() => void resetLogin()} disabled={resetPwd.length < 6 || resettingBusy} className="h-11 gap-2">
              {resettingBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
              {resettingBusy ? 'Saving…' : 'Save login'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customize plan limits dialog */}
      <Dialog open={!!customizing} onOpenChange={(o) => !o && setCustomizing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Customize plan — {customizing?.name}</DialogTitle>
            <DialogDescription>
              Per-organization overrides. Blank = plan default · 0 = unlimited.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-items">Items</Label>
              <Input
                id="c-items"
                type="number"
                min={0}
                value={custom.items}
                onChange={(e) => setCustom({ ...custom, items: e.target.value })}
                className="h-11"
                placeholder={customizing ? String(customizing.plan?.name ?? 'unlimited') : '0'}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-wh">Warehouses</Label>
              <Input
                id="c-wh"
                type="number"
                min={0}
                value={custom.warehouses}
                onChange={(e) => setCustom({ ...custom, warehouses: e.target.value })}
                className="h-11"
                placeholder="plan"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-parties">Parties</Label>
              <Input
                id="c-parties"
                type="number"
                min={0}
                value={custom.parties}
                onChange={(e) => setCustom({ ...custom, parties: e.target.value })}
                className="h-11"
                placeholder="plan"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCustomizing(null)} disabled={savingCustom} className="h-11">
              Cancel
            </Button>
            <Button onClick={saveCustom} disabled={savingCustom} className="h-11 gap-2">
              {savingCustom ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} Save limits
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
// Plans tab — pricing cards (reference style) with limits + feature pills
// ---------------------------------------------------------------------------

function PlansTab({ plans, apiKey, reload }: { plans: Plan[]; apiKey: string; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Plan | null>(null)
  const [form, setForm] = useState({
    name: '',
    priceMonthly: '0',
    priceYearly: '0',
    maxItems: '0',
    maxWarehouses: '0',
    maxParties: '0',
  })
  const [features, setFeatures] = useState<string[]>(PLAN_FEATURE_CATALOG.map((f) => f.key))
  const [saving, setSaving] = useState(false)

  const openNew = () => {
    setEditing(null)
    setForm({ name: '', priceMonthly: '0', priceYearly: '0', maxItems: '0', maxWarehouses: '0', maxParties: '0' })
    setFeatures(PLAN_FEATURE_CATALOG.map((f) => f.key))
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
    setFeatures(p.features ?? [])
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
        features,
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

  const limitRow = (value: number, label: string) => (
    <li className="flex items-center gap-2 text-sm">
      <Check className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="tabular-nums">{value === 0 ? 'Unlimited' : value}</span> {label}
    </li>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Plans ({plans.length})</h2>
        <Button onClick={openNew} className="h-10 gap-2">
          <Plus className="size-4" aria-hidden /> Add plan
        </Button>
      </div>

      {plans.length === 0 ? (
        <Card className="p-0">
          <CardContent className="p-6">
            <EmptyState
              title="No plans yet"
              hint="Plans carry pricing, master limits and feature toggles — enforced for the operating organization."
              action={
                <Button onClick={openNew} className="mt-2 h-11 gap-2">
                  <Plus className="size-4" aria-hidden /> Add plan
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Standard plans</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => (
              <Card key={p.id} className="p-0">
                <CardContent className="flex h-full flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold tracking-tight">{p.name}</p>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {slugify(p.name).toUpperCase()}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" variant="outline" className="h-8 rounded-full px-3 text-xs" onClick={() => openEdit(p)}>
                        <Pencil className="size-3.5" aria-hidden /> Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-full border-destructive/40 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={(p._count?.companies ?? 0) > 0}
                            title={(p._count?.companies ?? 0) > 0 ? 'Plans in use by organizations cannot be deleted' : `Delete ${p.name}`}
                          >
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete plan {p.name}?</AlertDialogTitle>
                            <AlertDialogDescription>Plans in use by organizations cannot be deleted.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => void del(p)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  <div>
                    <p className="text-2xl font-bold tabular-nums text-primary">
                      ₹{money(p.priceMonthly)}
                      <span className="text-sm font-normal text-muted-foreground">/month</span>
                    </p>
                    <p className="text-sm tabular-nums text-muted-foreground">₹{money(p.priceYearly)}/year</p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Limits</p>
                    <ul className="space-y-1.5">
                      {limitRow(p.maxItems, 'items')}
                      {limitRow(p.maxWarehouses, 'warehouses')}
                      {limitRow(p.maxParties, 'parties')}
                      <li className="flex items-center gap-2 text-sm">
                        <Check className="size-4 shrink-0 text-primary" aria-hidden />
                        <span className="tabular-nums">{p._count?.companies ?? 0}</span> organizations
                      </li>
                    </ul>
                  </div>

                  <div className="mt-auto space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Features</p>
                    <div className="flex flex-wrap gap-1.5">
                      {PLAN_FEATURE_CATALOG.map((f) => {
                        const on = (p.features ?? []).includes(f.key)
                        return (
                          <span
                            key={f.key}
                            title={on ? `${f.label} — included & enforced` : `${f.label} — not included`}
                            className={cn(
                              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
                              on
                                ? 'border-primary/30 bg-primary/10 text-primary'
                                : 'border-border bg-muted text-muted-foreground line-through'
                            )}
                          >
                            {f.label}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit plan — ${editing.name}` : 'New plan'}</DialogTitle>
            <DialogDescription>Limits of 0 mean unlimited. Prices are in ₹ (0 = free). Features toggle real enforcement.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-name">Name</Label>
              <Input
                id="plan-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-11"
                placeholder="Growth"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-m">₹ / month</Label>
              <Input
                id="plan-m"
                type="number"
                min={0}
                value={form.priceMonthly}
                onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-y">₹ / year</Label>
              <Input
                id="plan-y"
                type="number"
                min={0}
                value={form.priceYearly}
                onChange={(e) => setForm({ ...form, priceYearly: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-i">Max items</Label>
              <Input
                id="plan-i"
                type="number"
                min={0}
                value={form.maxItems}
                onChange={(e) => setForm({ ...form, maxItems: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-w">Max warehouses</Label>
              <Input
                id="plan-w"
                type="number"
                min={0}
                value={form.maxWarehouses}
                onChange={(e) => setForm({ ...form, maxWarehouses: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="plan-p">Max parties</Label>
              <Input
                id="plan-p"
                type="number"
                min={0}
                value={form.maxParties}
                onChange={(e) => setForm({ ...form, maxParties: e.target.value })}
                className="h-11"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Features</Label>
              <div className="space-y-2 rounded-lg border p-3">
                {PLAN_FEATURE_CATALOG.map((f) => (
                  <label key={f.key} className="flex cursor-pointer items-start gap-2.5 text-sm">
                    <Checkbox
                      checked={features.includes(f.key)}
                      onCheckedChange={(c) =>
                        setFeatures((prev) => (c ? [...prev, f.key] : prev.filter((k) => k !== f.key)))
                      }
                    />
                    <span>
                      {f.label}
                      <span className="block text-xs text-muted-foreground">
                        {f.key === 'exportData' ? 'Tally XML & e-Invoice JSON downloads' : 'GST returns, trial balance, P&L'}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
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
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inquiries tab — lead cards with status + follow-ups
// ---------------------------------------------------------------------------

function InquiryStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'new':
      return (
        <Badge className="border-transparent bg-primary/10 font-normal text-primary">new</Badge>
      )
    case 'contacted':
      return (
        <Badge className="border-transparent bg-amber-100 font-normal text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
          contacted
        </Badge>
      )
    case 'converted':
      return (
        <Badge className="border-transparent bg-emerald-100 font-normal text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
          converted
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="font-normal text-muted-foreground">
          closed
        </Badge>
      )
  }
}

function InquiriesTab({
  inquiries,
  apiKey,
  reload,
}: {
  inquiries: InquiriesResponse | null
  apiKey: string
  reload: () => Promise<void>
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', contactName: '', email: '', phone: '', city: '', message: '' })
  const [creating, setCreating] = useState(false)
  const [followUpFor, setFollowUpFor] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [deleting, setDeleting] = useState<InquiryRow | null>(null)

  const create = async () => {
    setCreating(true)
    try {
      await platformApi(
        '/api/platform/inquiries',
        {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            contactName: form.contactName || undefined,
            email: form.email || undefined,
            phone: form.phone || undefined,
            city: form.city || undefined,
            message: form.message || undefined,
          }),
        },
        apiKey
      )
      toast.success(`Inquiry "${form.name}" logged`)
      setCreateOpen(false)
      setForm({ name: '', contactName: '', email: '', phone: '', city: '', message: '' })
      void reload()
    } catch (e) {
      toastError(e)
    } finally {
      setCreating(false)
    }
  }

  const setStatus = async (id: string, status: string) => {
    try {
      await platformApi(`/api/platform/inquiries/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }, apiKey)
      toast.success(`Status set to ${status}`)
      void reload()
    } catch (e) {
      toastError(e)
    }
  }

  const del = async (inq: InquiryRow) => {
    try {
      await platformApi(`/api/platform/inquiries/${inq.id}`, { method: 'DELETE' }, apiKey)
      toast.success(`${inq.name} deleted`)
      setDeleting(null)
      void reload()
    } catch (e) {
      toastError(e)
    }
  }

  const addFollowUp = async (id: string) => {
    if (!note.trim()) return
    setSavingNote(true)
    try {
      await platformApi(`/api/platform/inquiries/${id}/follow-ups`, { method: 'POST', body: JSON.stringify({ note }) }, apiKey)
      toast.success('Follow-up logged')
      setNote('')
      setFollowUpFor(null)
      void reload()
    } catch (e) {
      toastError(e)
    } finally {
      setSavingNote(false)
    }
  }

  const list = inquiries?.inquiries ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Inquiries ({list.length})</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void reload()} className="h-10 gap-2 rounded-full">
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="h-10 gap-2">
            <Plus className="size-4" aria-hidden /> Log inquiry
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        inquiries ? (
          <Card className="p-0">
            <CardContent className="p-6">
              <EmptyState
                title="No inquiries"
                hint="Sales leads land here. Log one manually or pull Refresh to check for new ones."
              />
            </CardContent>
          </Card>
        ) : (
          <CardSkeleton className="h-40" />
        )
      ) : (
        <div className="space-y-4">
          {list.map((inq) => {
            const contact = [inq.contactName, inq.email, inq.phone, inq.city].filter(Boolean).join(' · ')
            return (
              <Card key={inq.id} className="p-0">
                <CardContent className="p-0">
                  <div className="space-y-2 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-semibold tracking-tight">{inq.name}</p>
                          <InquiryStatusBadge status={inq.status} />
                        </div>
                        {contact ? <p className="text-sm text-muted-foreground">{contact}</p> : null}
                        {inq.message ? <p className="max-w-2xl text-sm text-muted-foreground">{inq.message}</p> : null}
                        <p className="text-xs text-muted-foreground/80">Received {dt(inq.createdAt)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Select value={inq.status} onValueChange={(v) => void setStatus(inq.id, v)}>
                          <SelectTrigger className="h-9 w-32" aria-label={`Status for ${inq.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="new">new</SelectItem>
                            <SelectItem value="contacted">contacted</SelectItem>
                            <SelectItem value="converted">converted</SelectItem>
                            <SelectItem value="closed">closed</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 rounded-full border-destructive/40 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleting(inq)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-3 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Follow-ups ({inq.followUps.length})
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-full px-3 text-xs"
                        onClick={() => {
                          setFollowUpFor(followUpFor === inq.id ? null : inq.id)
                          setNote('')
                        }}
                      >
                        <Plus className="size-3.5" aria-hidden /> Add follow-up
                      </Button>
                    </div>
                    {followUpFor === inq.id ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && note.trim()) void addFollowUp(inq.id)
                          }}
                          placeholder="Called the buyer — they want a demo next Tuesday…"
                          className="h-10 flex-1"
                          maxLength={500}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void addFollowUp(inq.id)}
                            disabled={!note.trim() || savingNote}
                            className="h-10 gap-2"
                          >
                            {savingNote ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setFollowUpFor(null)}
                            className="h-10"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {inq.followUps.length > 0 ? (
                      <ul className="max-h-44 space-y-2 overflow-y-auto erp-scroll-y pr-1">
                        {inq.followUps.map((f) => (
                          <li key={f.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                            <span className="min-w-0 flex-1 text-sm">{f.note}</span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">{dt(f.createdAt)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Log inquiry dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log inquiry</DialogTitle>
            <DialogDescription>A sales lead from a prospective customer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="inq-name">Organization name</Label>
              <Input
                id="inq-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-11"
                placeholder="Kalyani Castings Pvt. Ltd."
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="inq-contact">Contact person</Label>
                <Input
                  id="inq-contact"
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  className="h-11"
                  placeholder="Anitha V"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inq-city">City</Label>
                <Input
                  id="inq-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="h-11"
                  placeholder="Bengaluru"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inq-email">Email</Label>
                <Input
                  id="inq-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="h-11"
                  placeholder="purchase@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inq-phone">Phone</Label>
                <Input
                  id="inq-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="h-11"
                  placeholder="8971233080"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inq-msg">What they asked (optional)</Label>
              <Textarea
                id="inq-msg"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                rows={3}
                maxLength={2000}
                placeholder="Need jobwork billing for heat treatment + galvanizing…"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating} className="h-11">
              Cancel
            </Button>
            <Button onClick={create} disabled={!form.name.trim() || creating} className="h-11 gap-2">
              {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null} Log inquiry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete inquiry confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the inquiry and its {deleting?.followUps.length ?? 0} follow-up(s). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && void del(deleting)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Blog tab — post list + editor
// ---------------------------------------------------------------------------

function BlogTab({ posts, apiKey, reload }: { posts: BlogPost[]; apiKey: string; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<BlogPost | null>(null)
  const [form, setForm] = useState({ title: '', slug: '', excerpt: '', body: '', status: 'draft' })
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)

  const openNew = () => {
    setEditing(null)
    setForm({ title: '', slug: '', excerpt: '', body: '', status: 'draft' })
    setSlugTouched(false)
    setOpen(true)
  }

  const openEdit = (p: BlogPost) => {
    setEditing(p)
    setForm({
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt ?? '',
      body: p.body ?? '',
      status: p.status === 'published' ? 'published' : 'draft',
    })
    setSlugTouched(true)
    setOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const body = {
        title: form.title.trim(),
        slug: form.slug.trim() ? slugify(form.slug) : undefined,
        excerpt: form.excerpt.trim() || undefined,
        body: form.body.trim() || undefined,
        status: form.status,
      }
      if (editing) await platformApi(`/api/platform/blog/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) }, apiKey)
      else await platformApi('/api/platform/blog', { method: 'POST', body: JSON.stringify(body) }, apiKey)
      toast.success(editing ? 'Post updated' : 'Post created')
      setOpen(false)
      void reload()
    } catch (e) {
      toastError(e)
    } finally {
      setSaving(false)
    }
  }

  const del = async (p: BlogPost) => {
    try {
      await platformApi(`/api/platform/blog/${p.id}`, { method: 'DELETE' }, apiKey)
      toast.success(`"${p.title}" deleted`)
      void reload()
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Blog ({posts.length})</h2>
        <Button onClick={openNew} className="h-10 gap-2">
          <Plus className="size-4" aria-hidden /> New post
        </Button>
      </div>

      {posts.length === 0 ? (
        <Card className="p-0">
          <CardContent className="p-6">
            <EmptyState
              title="No posts yet"
              hint="Announcements, release notes and launch posts live here."
              action={
                <Button onClick={openNew} className="mt-2 h-11 gap-2">
                  <Plus className="size-4" aria-hidden /> New post
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <Card key={p.id} className="p-0">
              <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold tracking-tight">{p.title}</p>
                    {p.status === 'published' ? (
                      <Badge className="border-transparent bg-emerald-100 font-normal text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                        published
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="font-normal">
                        draft
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">/{p.slug}</p>
                  {p.excerpt ? <p className="max-w-2xl text-sm text-muted-foreground">{p.excerpt}</p> : null}
                  <p className="text-xs text-muted-foreground/80">
                    {p.publishedAt ? `Published ${dt(p.publishedAt)}` : `Created ${dt(p.createdAt)}`} · Updated {dt(p.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="outline" className="h-9 rounded-full px-3 text-xs" onClick={() => openEdit(p)}>
                    <Pencil className="size-3.5" aria-hidden /> Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-full border-destructive/40 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete &ldquo;{p.title}&rdquo;?</AlertDialogTitle>
                        <AlertDialogDescription>The post is removed permanently.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => void del(p)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit post' : 'New post'}</DialogTitle>
            <DialogDescription>
              {editing ? `/${editing.slug}` : 'Slug is generated from the title unless you set one.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bp-title">Title</Label>
              <Input
                id="bp-title"
                value={form.title}
                onChange={(e) =>
                  setForm({
                    ...form,
                    title: e.target.value,
                    ...(slugTouched || editing ? {} : { slug: slugify(e.target.value) }),
                  })
                }
                className="h-11"
                placeholder="Introducing ForgeERP 2.0"
                maxLength={160}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <div className="space-y-1.5">
                <Label htmlFor="bp-slug">Slug</Label>
                <Input
                  id="bp-slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setForm({ ...form, slug: e.target.value })
                  }}
                  className="h-11 font-mono"
                  placeholder={slugify(form.title) || 'auto-from-title'}
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">draft</SelectItem>
                    <SelectItem value="published">published</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-excerpt">Excerpt</Label>
              <Input
                id="bp-excerpt"
                value={form.excerpt}
                onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                placeholder="One-line summary shown in lists"
                maxLength={300}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-body">Body</Label>
              <Textarea
                id="bp-body"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                rows={6}
                maxLength={20000}
                placeholder="Write the post…"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving} className="h-11">
              Cancel
            </Button>
            <Button onClick={save} disabled={!form.title.trim() || saving} className="h-11 gap-2">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} Save post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data & backup (kept from the original console — a real, useful tool)
// ---------------------------------------------------------------------------

function BackupCard({ apiKey }: { apiKey: string }) {
  const [restoring, setRestoring] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const restore = async (file: File) => {
    setRestoring(true)
    try {
      const snapshot = JSON.parse(await file.text())
      const res = await platformApi<{ restored: boolean }>(
        '/api/backup/restore',
        {
          method: 'POST',
          body: JSON.stringify({ confirm: 'RESTORE', snapshot }),
        },
        apiKey
      )
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
            <p className="text-sm font-semibold">Data &amp; backup</p>
            <p className="text-xs text-muted-foreground">
              Full JSON snapshot of every table. Restore is destructive and transactional — everything is replaced inside one
              transaction.
            </p>
          </div>
          <Button
            variant="outline"
            className="h-10 gap-2 rounded-full"
            onClick={() => downloadUrl(`/api/backup?platformKey=${encodeURIComponent(apiKey)}`)}
          >
            <DatabaseBackup className="size-4" aria-hidden /> Download backup
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed p-3">
          <div className="min-w-44 flex-1 space-y-1.5">
            <Label htmlFor="restore-confirm">Restore — type RESTORE to enable</Label>
            <Input
              id="restore-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
              placeholder="RESTORE"
              className="h-11"
            />
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
