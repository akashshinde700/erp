'use client'

/**
 * ForgeERP — application shell.
 * Single-page module registry: sidebar (desktop) / drawer (mobile), header,
 * view switch via zustand, sticky footer, first-boot setup screen.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BarChart3,
  Boxes,
  Calculator,
  Database,
  Factory,
  FolderKanban,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  ReceiptText,
  ScrollText,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Truck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { api, apiPost, toastError, useApi, useMounted, type AuthStatus, type Company, type SessionInfo } from './api'
import { CompanyProvider } from './company'
import { LoginView, ManualSetupView } from './login'
import { OrgPortal } from './portal'
import { useErpUi, type ErpView } from './store'
import { GOTO_KEYS, isTypingTarget, pushRecent, setCreatePreset } from './nav'
import { CommandPalette, ShortcutsHelpDialog } from './palette'
import { cn } from '@/lib/utils'
import { fyCode, dateStr } from '@/lib/erp'

// Module views are lazy-loaded: the initial payload carries only the shell +
// dashboard, and each heavy module (masters, jobwork, invoice editor, charts)
// arrives as its own chunk on first navigation. State lives in zustand, so
// lazy mounting cannot lose user data. (Declarations below, after NavList.)

// ---------- navigation registry ----------

interface NavEntry {
  view: ErpView
  label: string
  icon: typeof LayoutDashboard
}

const NAV_GROUPS: { group: string; entries: NavEntry[] }[] = [
  {
    group: 'Overview',
    entries: [{ view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    group: 'Transactions',
    entries: [
      { view: 'sales', label: 'Sales', icon: ReceiptText },
      { view: 'purchase', label: 'Purchase', icon: ShoppingCart },
      { view: 'jobwork', label: 'Jobwork', icon: Factory },
    ],
  },
  {
    group: 'Manufacturing',
    entries: [
      { view: 'manufacturing', label: 'Projects & Mfg', icon: FolderKanban },
    ],
  },
  {
    group: 'Books',
    entries: [
      { view: 'inventory', label: 'Inventory', icon: Boxes },
      { view: 'accounting', label: 'Accounting', icon: Calculator },
      { view: 'reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    group: 'Setup & Platform',
    entries: [
      { view: 'masters', label: 'Masters', icon: Database },
      { view: 'tally', label: 'Tally Export', icon: Truck },
      { view: 'audit', label: 'Audit Trail', icon: ScrollText },
    ],
  },
]

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { view, setView } = useErpUi()
  const isActive = (entryView: ErpView) =>
    view === entryView || view === `${entryView}-detail` || (entryView === 'manufacturing' && view === 'project-detail')
  return (
    <nav aria-label="ERP modules" className="flex flex-col gap-0.5 p-2">
      {NAV_GROUPS.map((g) => (
        <div key={g.group} className="mb-1">
          <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            {g.group}
          </p>
          {g.entries.map((e) => {
            const active = isActive(e.view)
            return (
              <button
                key={e.view}
                type="button"
                onClick={() => {
                  setView(e.view)
                  onNavigate?.()
                }}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                )}
              >
                <e.icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{e.label}</span>
                {active ? <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary" aria-hidden /> : null}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

// ---------- mobile bottom navigation (frequent modules only) ----------

const BOTTOM_NAV: { view: ErpView; label: string; icon: typeof LayoutDashboard }[] = [
  { view: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { view: 'sales', label: 'Sales', icon: ReceiptText },
  { view: 'purchase', label: 'Purchase', icon: ShoppingCart },
  { view: 'jobwork', label: 'Jobwork', icon: Factory },
  { view: 'inventory', label: 'Stock', icon: Boxes },
]

function BottomNav() {
  const { view, setView } = useErpUi()
  return (
    <nav
      aria-label="Frequent modules"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90 md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        {BOTTOM_NAV.map((e) => {
          const active = view === e.view || view === `${e.view}-detail`
          return (
            <button
              key={e.view}
              type="button"
              onClick={() => setView(e.view)}
              aria-current={active ? 'page' : undefined}
              aria-label={e.label}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <e.icon className="size-5 shrink-0" aria-hidden />
              <span className="truncate">{e.label}</span>
              {active ? <span className="sr-only">(current)</span> : null}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

// ---------- lazy module views (code splitting) ----------

const DashboardView = lazy(() => import('./dashboard').then((m) => ({ default: m.DashboardView })))
const SalesView = lazy(() => import('./sales').then((m) => ({ default: m.SalesView })))
const SalesDetailView = lazy(() => import('./sales').then((m) => ({ default: m.SalesDetailView })))
const PurchaseView = lazy(() => import('./purchase').then((m) => ({ default: m.PurchaseView })))
const PurchaseDetailView = lazy(() => import('./purchase').then((m) => ({ default: m.PurchaseDetailView })))
const InventoryView = lazy(() => import('./inventory').then((m) => ({ default: m.InventoryView })))
const JobworkView = lazy(() => import('./jobwork').then((m) => ({ default: m.JobworkView })))
const JobworkDetailView = lazy(() => import('./jobwork').then((m) => ({ default: m.JobworkDetailView })))
const ManufacturingView = lazy(() => import('./manufacturing').then((m) => ({ default: m.ManufacturingView })))
const ProjectDetailView = lazy(() => import('./manufacturing').then((m) => ({ default: m.ProjectDetailView })))
const AccountingView = lazy(() => import('./accounting').then((m) => ({ default: m.AccountingView })))
const ReportsView = lazy(() => import('./reports').then((m) => ({ default: m.ReportsView })))
const MastersView = lazy(() => import('./masters').then((m) => ({ default: m.MastersView })))
const TallyView = lazy(() => import('./tally').then((m) => ({ default: m.TallyView })))
const PlatformView = lazy(() => import('./platform').then((m) => ({ default: m.PlatformView })))
const AuditView = lazy(() => import('./audit').then((m) => ({ default: m.AuditView })))
const DocsView = lazy(() => import('./docs').then((m) => ({ default: m.DocsView })))

function ViewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading module">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}

// ---------- org user menu (header) ----------

function UserMenu({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const initials = (session.user.name.split(/\s+/).map((w) => w[0]).join('') || 'U').slice(0, 2).toUpperCase()
  const role = session.user.role === 'OWNER' ? 'Owner' : session.user.role === 'ACCOUNTANT' ? 'Accountant' : session.user.role
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-full bg-primary text-xs font-bold uppercase text-primary-foreground transition-opacity hover:opacity-90"
          aria-label={`Account — ${session.user.name}`}
          title={session.user.email}
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-3 py-2.5">
          <p className="truncate text-sm font-semibold">{session.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <Badge variant="secondary" className="font-normal">{role}</Badge>
            <span className="truncate text-xs text-muted-foreground">{session.company.name}</span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onLogout()} className="gap-2 text-destructive focus:text-destructive">
          <LogOut className="size-4" aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------- first-boot setup screen ----------

function SetupScreen({ onDone, onManual }: { onDone: () => void; onManual: () => void }) {
  const [seeding, setSeeding] = useState(false)
  const seed = async () => {
    setSeeding(true)
    try {
      // Plain POST: seeds only when no company exists yet (honest no-op
      // otherwise). The destructive ?force=1 wipe is platform-admin-only.
      await apiPost<{ company: string }>('/api/seed', {})
      onDone()
    } catch (e) {
      toastError(e)
      setSeeding(false)
    }
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <Factory className="size-8" aria-hidden />
      </div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Welcome to ForgeERP</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          No company is configured yet. Load the seeded demo data (company &ldquo;Shree Forge Industries&rdquo;
          with parties, items, processes, invoices and a full jobwork chain), or start with a blank company.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={seed} disabled={seeding} size="lg" className="min-w-48">
          {seeding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          {seeding ? 'Seeding demo data…' : 'Load demo data'}
        </Button>
        <Button onClick={onManual} disabled={seeding} variant="outline" size="lg" className="min-w-48">
          Set up company manually
        </Button>
      </div>
    </div>
  )
}

// ---------- app ----------

export function ErpApp() {
  const { view, params, setView } = useErpUi()

  // ---------- organization login (SaaS) ----------
  // undefined = session probe in flight · null = signed out · info = signed in.
  // Platform Admin is a SEPARATE console (platformMode) — never inside the ERP.
  // A SUPER_ADMIN session opens the console directly (like the reference SaaS).
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined)
  const [platformMode, setPlatformMode] = useState(false)

  // Boot routing uses the PUBLIC status probe (no sensitive data): it tells
  // first-boot (no company) apart from signed-out without ever touching the
  // company profile. The full profile (bank details included) is fetched ONLY
  // for a signed-in operating-org session — never anonymously.
  const status = useApi<AuthStatus | null>('/api/auth/status')
  const company = useApi<Company | null>(session === undefined ? null : session ? '/api/masters/company' : null)
  const [manualSetup, setManualSetup] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const mounted = useMounted()

  useEffect(() => {
    let cancelled = false
    api<SessionInfo | null>('/api/auth/session')
      .then((s) => {
        if (!cancelled) setSession(s)
      })
      .catch(() => {
        if (!cancelled) setSession(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const logout = async () => {
    try {
      await apiPost('/api/auth/logout', {})
      toast.success('Signed out')
    } catch {
      toast.error('Could not sign out — try again')
    }
    setSession(null)
    setView('dashboard')
  }

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [view])

  // ---------- global keyboard: palette (Ctrl/⌘+K, /), g+key goto, ? help, Alt+S/Alt+P ----------
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const gotoArmed = useRef(0)

  const openSalesCreate = useCallback(() => {
    setCreatePreset({ type: 'sales-invoice' })
    setView('sales')
  }, [setView])
  const openPurchaseCreate = useCallback(() => {
    setCreatePreset({ type: 'purchase-invoice' })
    setView('purchase')
  }, [setView])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/⌘ + K → palette (always)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (isTypingTarget(e)) return
      // Alt+S / Alt+P → new documents from anywhere
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        openSalesCreate()
        return
      }
      if (e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        openPurchaseCreate()
        return
      }
      // "?" → shortcuts help
      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen(true)
        return
      }
      // "/" → palette
      if (e.key === '/') {
        e.preventDefault()
        setPaletteOpen(true)
        return
      }
      // g + key → module (Gmail style, 1.5 s window)
      if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        gotoArmed.current = Date.now()
        return
      }
      const goto = GOTO_KEYS[e.key.toLowerCase()]
      if (goto && Date.now() - gotoArmed.current < 1500 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        gotoArmed.current = 0
        setView(goto.view)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setView, openSalesCreate, openPurchaseCreate])

  // Track recent views for the palette
  useEffect(() => {
    pushRecent(view)
  }, [view])

  // Boot probe: session + status must both settle before deciding. The
  // company profile loads lazily behind the session.
  if (session === undefined || (status.data === null && !status.error)) {
    return (
      <div className="flex min-h-screen flex-col gap-4 p-6">
        <Skeleton className="h-14 w-full rounded-lg" />
        <div className="flex flex-1 gap-4">
          <Skeleton className="hidden h-96 w-60 rounded-lg md:block" />
          <Skeleton className="h-96 flex-1 rounded-lg" />
        </div>
      </div>
    )
  }

  // Status endpoint unreachable → honest offline/error screen (never a
  // wrong setup wizard).
  if (status.error && status.data === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <ShieldAlert className="size-10 text-destructive" aria-hidden />
        <h1 className="text-lg font-semibold">Cannot reach the server</h1>
        <p className="max-w-md text-sm text-muted-foreground">{status.error}</p>
      </div>
    )
  }

  // First boot, no company yet → demo seed or manual setup wizard.
  if (status.data && !status.data.companyExists) {
    if (manualSetup) {
      return (
        <ManualSetupView
          onDone={() => {
            setManualSetup(false)
            status.reload()
          }}
          onBack={() => setManualSetup(false)}
        />
      )
    }
    return (
      <SetupScreen
        onDone={() => {
          setManualSetup(false)
          status.reload()
        }}
        onManual={() => setManualSetup(true)}
      />
    )
  }

  // Platform Admin — SEPARATE console (own header + pill nav), opened from the
  // login screen or a SUPER_ADMIN sign-in; never inside an organization's ERP.
  // Exiting while a SUPER_ADMIN session is active signs the admin out — the
  // console is their home, not the org ERP.
  const exitPlatform = async () => {
    const wasSuperAdmin = !!session && session.user.role === 'SUPER_ADMIN'
    setPlatformMode(false)
    if (wasSuperAdmin) {
      try {
        await apiPost('/api/auth/logout', {})
      } catch {
        /* best effort — the console may already have logged out */
      }
      setSession(null)
      return
    }
    // Key-mode exit: stay honest about the cookie the console may have swapped.
    api<SessionInfo | null>('/api/auth/session')
      .then((s) => setSession(s))
      .catch(() => setSession(null))
  }

  const platformConsole = platformMode || (!!session && session.user.role === 'SUPER_ADMIN')

  if (platformConsole) {
    return (
      <Suspense
        fallback={
          <div className="flex min-h-dvh items-center justify-center p-6">
            <Skeleton className="h-96 w-full max-w-6xl rounded-xl" />
          </div>
        }
      >
        <PlatformView
          onExit={() => void exitPlatform()}
          onLoginAs={(s) => {
            // Impersonation handover: the console set the session cookie for the
            // target org's owner — hand the browser to their workspace.
            setSession(s)
            setPlatformMode(false)
          }}
        />
      </Suspense>
    )
  }

  // Not signed in → organization login screen (SaaS entry).
  if (!session) {
    return (
      <LoginView
        onLogin={(s) => setSession(s)}
        onOpenPlatform={() => setPlatformMode(true)}
        onPlatformLogin={(s) => {
          setSession(s)
          setPlatformMode(true)
        }}
      />
    )
  }

  // Signed in to an org that is NOT the operating org → honest org portal
  // (real profile/subscription data, never another org's books).
  if (!session.operating) {
    return <OrgPortal session={session} onLogout={() => void logout()} />
  }

  const fy = mounted ? fyCode(new Date()) : '····'
  const today = mounted ? dateStr(new Date()) : ''

  const chip = (children: React.ReactNode) => (
    <span className="hidden items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground lg:inline-flex">
      {children}
    </span>
  )

  let content: React.ReactNode
  switch (view) {
    case 'sales':
      content = <SalesView />
      break
    case 'sales-detail':
      content = <SalesDetailView id={params.id ?? ''} />
      break
    case 'purchase':
      content = <PurchaseView />
      break
    case 'purchase-detail':
      content = <PurchaseDetailView id={params.id ?? ''} />
      break
    case 'jobwork':
      content = <JobworkView />
      break
    case 'jobwork-detail':
      content = <JobworkDetailView id={params.id ?? ''} />
      break
    case 'manufacturing':
      content = <ManufacturingView />
      break
    case 'project-detail':
      content = <ProjectDetailView id={params.id ?? ''} />
      break
    case 'inventory':
      content = <InventoryView />
      break
    case 'accounting':
      content = <AccountingView />
      break
    case 'reports':
      content = <ReportsView />
      break
    case 'masters':
      content = <MastersView />
      break
    case 'tally':
      content = <TallyView />
      break
    case 'audit':
      content = <AuditView />
      break
    case 'docs':
      content = <DocsView />
      break
    default:
      content = <DashboardView />
  }

  const headerChip = (label: string, value: string) => (
    <span className="hidden items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground lg:inline-flex">
      <span className="font-medium text-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  )

  return (
    <CompanyProvider company={company.data ?? null}>
      <div className="flex min-h-screen flex-col bg-background">
        {company.data?.access?.blocked ? (
          <div
            role="alert"
            className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
          >
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            <span className="font-medium">{company.data.access.message}</span>
          </div>
        ) : company.data?.access?.state === 'TRIAL' ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
          >
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            <span>
              Free trial{company.data.trialEndsAt ? ` until ${dateStr(company.data.trialEndsAt)}` : ''} — pick a plan to keep going.
            </span>
          </div>
        ) : null}
        <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <div className="flex h-14 items-center gap-3 px-4">
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="size-11 md:hidden" aria-label="Open navigation">
                  <Menu className="size-5" aria-hidden />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
                <SheetHeader className="border-b border-sidebar-border px-4 py-3">
                  <SheetTitle className="flex items-center gap-2 text-sidebar-foreground">
                    <span className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                      <Factory className="size-4" aria-hidden />
                    </span>
                    ForgeERP
                  </SheetTitle>
                </SheetHeader>
                <div className="overflow-y-auto erp-scroll-y">
                  <NavList onNavigate={() => setDrawerOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>

            <button
              type="button"
              onClick={() => setView('dashboard')}
              className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left"
              aria-label="ForgeERP home"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Factory className="size-4" aria-hidden />
              </span>
              {/* Wordmark hidden on the narrowest phones so the header never
                  overflows 320px viewports (menu button + company + avatar fit). */}
              <span className="hidden text-sm font-semibold tracking-tight sm:inline sm:text-base">ForgeERP</span>
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="hidden h-9 w-56 items-center gap-2 rounded-md border bg-muted/40 px-3 text-left text-xs text-muted-foreground transition-colors hover:bg-accent md:flex"
                aria-label="Open command palette (Ctrl+K)"
              >
                <span className="sr-only">Open command palette</span>
                <svg viewBox="0 0 24 24" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <span className="flex-1 truncate">Search or jump to…</span>
                <kbd className="rounded border bg-background px-1 font-mono text-[10px]">Ctrl K</kbd>
              </button>
              {company.data ? (
                <>
                  {chip(
                    <>
                      <span className="font-medium text-foreground">GSTIN</span>
                      <span className="tabular-nums">{company.data.gstin ?? '—'}</span>
                    </>
                  )}
                  {chip(
                    <>
                      <span className="font-medium text-foreground">FY</span>
                      <span className="tabular-nums">{fy}</span>
                    </>
                  )}
                  {chip(<span className="tabular-nums">{today}</span>)}
                </>
              ) : (
                <span className="hidden rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 sm:inline-flex dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                  Company not set up
                </span>
              )}
              <span className="max-w-36 truncate text-sm font-medium min-[380px]:max-w-40 sm:max-w-40 lg:max-w-none">
                {company.data?.name ?? ''}
              </span>
              <UserMenu session={session} onLogout={() => void logout()} />
            </div>
          </div>
        </header>

        {/* min-h-0 lets this row shrink to the leftover viewport space so the
            footer always sits at the viewport bottom on short pages; the sidebar
            caps at viewport height and scrolls internally when needed. */}
        <div className="flex min-h-0 flex-1">
          <aside className="sticky top-14 hidden h-auto max-h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:block lg:w-64 erp-scroll-y">
            <NavList />
          </aside>

          <main className="min-w-0 flex-1 p-4 sm:p-6">
            <div className="mx-auto w-full max-w-7xl">
              <Suspense fallback={<ViewSkeleton />}>{content}</Suspense>
            </div>
          </main>
        </div>

        <footer className="mt-auto border-t bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1.5 px-4 py-3 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
            <span className="font-medium text-foreground">ForgeERP</span>
            <span>Manufacturing · Jobwork · GST · Double-Entry</span>
            <button
              type="button"
              className="underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setView('docs')}
            >
              Built from repository reverse-engineering — see Docs
            </button>
          </div>
          <div className="mx-auto max-w-7xl px-4 pb-2 text-center text-[10px] text-muted-foreground/70 sm:text-left">
            Append-only ledgers · FY-aware gapless numbering · one shared GST engine (report ≡ print ≡ invoice)
          </div>
        </footer>

        {/* Mobile bottom nav (frequent modules) + spacer so it never covers the
            footer — h-14 + nav border + safe-area inset keeps the last content
            fully visible above the fixed bar at scroll-bottom. */}
        <div aria-hidden className="h-[calc(3.5rem+1px+env(safe-area-inset-bottom))] shrink-0 md:hidden" />
        <BottomNav />

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      </div>
    </CompanyProvider>
  )
}
