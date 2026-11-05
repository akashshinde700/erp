'use client'

/**
 * ForgeERP — organization portal (non-operating org session).
 *
 * Honest scope: this deployment's ERP workspace (books, ledgers, GST
 * documents) is attached to the FIRST company. Logins for other orgs created
 * in Platform Admin land HERE — a real, data-backed portal for THEIR org
 * (profile, plan, subscription state) — never inside another org's books.
 * Separate data arrives with the multi-tenant roadmap.
 */

import { Building2, Clock, LogOut, Mail, MapPin, ReceiptText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { dateStr } from '@/lib/erp'
import type { SessionInfo } from './api'

function StatusBadge({ session }: { session: SessionInfo }) {
  if (session.access.state === 'SUSPENDED')
    return (
      <Badge variant="destructive" className="font-normal">
        suspended
      </Badge>
    )
  if (session.access.state === 'TRIAL')
    return (
      <Badge className="border-transparent bg-amber-100 font-normal text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
        free trial
      </Badge>
    )
  if (session.access.state === 'EXPIRED')
    return (
      <Badge variant="destructive" className="font-normal">
        expired
      </Badge>
    )
  return (
    <Badge className="border-transparent bg-emerald-100 font-normal text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
      active
    </Badge>
  )
}

export function OrgPortal({ session, onLogout }: { session: SessionInfo; onLogout: () => void }) {
  const row = (icon: React.ReactNode, label: string, value: string) => (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
      <span className="text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <span className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-medium" title={value}>
        {value}
      </span>
    </div>
  )

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="border-b bg-card pb-[max(0px,env(safe-area-inset-top))]">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Building2 className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{session.company.name}</p>
              <p className="truncate text-xs text-muted-foreground">{session.user.name}</p>
            </div>
          </div>
          <Button variant="outline" onClick={onLogout} className="h-11 md:h-9 shrink-0 gap-2 rounded-full px-4 text-destructive hover:text-destructive">
            <LogOut className="size-4" aria-hidden /> Logout
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-4 py-10">
        <Card className="p-0">
          <CardContent className="space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-lg font-bold tracking-tight">Your organization</h1>
              <StatusBadge session={session} />
            </div>
            <div className="grid gap-2">
              {row(<ReceiptText className="size-4" />, 'GSTIN', session.company.gstin ?? '—')}
              {row(<Mail className="size-4" />, 'Email', session.company.email ?? '—')}
              {row(<MapPin className="size-4" />, 'City', session.company.city ?? '—')}
              {row(<Clock className="size-4" />, 'Plan', session.plan ?? 'No plan (unlimited)')}
              {row(
                <Clock className="size-4" />,
                'Trial ends',
                session.trialEndsAt ? dateStr(session.trialEndsAt) : '—'
              )}
            </div>
            {session.access.blocked ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {session.access.message}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="rounded-xl border bg-card p-5 text-sm leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Where are the books?</p>
          <p className="mt-1">
            This deployment&rsquo;s ERP workspace — invoices, ledgers, GST filings, jobwork — is attached to{' '}
            <span className="font-medium text-foreground">{session.operatingOrg?.name ?? 'the operating organization'}</span>.
            Your login, plan and subscription are live and managed by the platform administrator; separate book-keeping
            per organization arrives with the multi-tenant roadmap. Until then this portal never shows another
            organization&rsquo;s data.
          </p>
        </div>
      </main>

      <footer className="mt-auto border-t bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-1 px-4 py-3 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <span className="font-medium text-foreground">ForgeERP Platform</span>
          <span>Organization portal · sign out any time</span>
        </div>
      </footer>
    </div>
  )
}
