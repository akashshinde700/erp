'use client'

/**
 * ForgeERP — organization sign-in screen (SaaS entry).
 * Flat white card on a light canvas, matching the platform console look:
 *  - Sign in with your organization login (email + password).
 *  - SUPER_ADMIN credentials open the Platform Admin console directly.
 *  - First boot with no logins → create the owner login (bootstrap).
 *  - Separate, clearly-lowered entry for the Platform Admin console — the
 *    admin is NOT inside the org ERP; it is opened from here only.
 */

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, Building2, Factory, KeyRound, Loader2, LogIn, ShieldAlert, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, apiPut, toastError, type AuthStatus, type SessionInfo } from './api'
import { gstinChecksumValid } from '@/lib/erp'

export function LoginView({
  onLogin,
  onOpenPlatform,
  onPlatformLogin,
}: {
  onLogin: (s: SessionInfo) => void
  onOpenPlatform: () => void
  onPlatformLogin: (s: SessionInfo) => void
}) {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Bootstrap (company exists, no logins yet): create the owner account.
  const [bootName, setBootName] = useState('')
  const [bootEmail, setBootEmail] = useState('')
  const [bootPassword, setBootPassword] = useState('')
  const [bootConfirm, setBootConfirm] = useState('')

  useEffect(() => {
    api<AuthStatus>('/api/auth/status')
      .then(setStatus)
      .catch(() =>
        setStatus({
          companyExists: true,
          companyName: null,
          usersExist: true,
          demoHint: false,
          platformConfigured: false,
        })
      )
  }, [])

  // Owner bootstrap only when a company exists but has no login yet; a blank
  // install shows the plain sign-in (orgs are created from the Platform Admin).
  const bootstrapMode = status ? status.companyExists && !status.usersExist : false

  const submitLogin = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter your email and password')
      return
    }
    setBusy(true)
    setError('')
    try {
      const session = await api<SessionInfo>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      })
      if (session.user.role === 'SUPER_ADMIN') {
        // Platform administrator → straight to the console (never the org ERP).
        toast.success(`Signed in — platform administrator`)
        onPlatformLogin(session)
        return
      }
      toast.success(`Signed in — ${session.company.name}`)
      onLogin(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  const submitBootstrap = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (bootPassword !== bootConfirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    setError('')
    try {
      const session = await api<SessionInfo>('/api/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ name: bootName.trim(), email: bootEmail.trim(), password: bootPassword }),
      })
      toast.success('Owner login created — welcome to ForgeERP')
      onLogin(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the login')
    } finally {
      setBusy(false)
    }
  }

  const fillDemo = () => {
    setEmail('owner@shreeforge.example.com')
    setPassword('forge123')
    setError('')
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="border-b bg-card pb-[max(0px,env(safe-area-inset-top))]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-2" aria-label="ForgeERP">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Factory className="size-4" aria-hidden />
              </span>
              <span className="text-sm font-semibold tracking-tight">ForgeERP</span>
            </span>
            {/* Platform admin is a SEPARATE console — opened from the login
                screen only, via this icon (never from inside an org's ERP). */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onOpenPlatform}
              className="size-8 text-muted-foreground"
              aria-label="Platform admin"
              title="Platform admin"
            >
              <ShieldAlert className="size-4" aria-hidden />
            </Button>
          </div>
          <Badge variant="secondary" className="font-normal">
            SaaS · one workspace per organization
          </Badge>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4 py-10">
        <div className="w-full max-w-md space-y-4">
          <Card className="p-0">
            <CardContent className="p-6 sm:p-8">
              {bootstrapMode ? (
                <form onSubmit={submitBootstrap} className="space-y-5" noValidate>
                  <div className="space-y-1">
                    <h1 className="text-xl font-bold tracking-tight">Create your owner login</h1>
                    <p className="text-sm text-muted-foreground">
                      {status?.companyName ? `${status.companyName}` : 'Your organization'} is set up but has no sign-in yet —
                      create the owner account you will use for this organization.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="boot-name">Your name</Label>
                      <Input
                        id="boot-name"
                        autoComplete="name"
                        className="h-11"
                        value={bootName}
                        onChange={(e) => setBootName(e.target.value)}
                        placeholder="e.g. Anil Deshpande"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="boot-email">Email</Label>
                      <Input
                        id="boot-email"
                        type="email"
                        autoComplete="email"
                        className="h-11"
                        value={bootEmail}
                        onChange={(e) => setBootEmail(e.target.value)}
                        placeholder="you@company.com"
                        required
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="boot-password">Password</Label>
                        <Input
                          id="boot-password"
                          type="password"
                          autoComplete="new-password"
                          className="h-11"
                          value={bootPassword}
                          onChange={(e) => setBootPassword(e.target.value)}
                          minLength={6}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="boot-confirm">Confirm password</Label>
                        <Input
                          id="boot-confirm"
                          type="password"
                          autoComplete="new-password"
                          className="h-11"
                          value={bootConfirm}
                          onChange={(e) => setBootConfirm(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  </div>
                  {error ? (
                    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}
                  <Button type="submit" disabled={busy} className="h-11 w-full gap-2">
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserPlus className="size-4" aria-hidden />}
                    {busy ? 'Creating…' : 'Create owner login'}
                  </Button>
                </form>
              ) : (
                <form onSubmit={submitLogin} className="space-y-5" noValidate>
                  <div className="space-y-1">
                    <h1 className="text-xl font-bold tracking-tight">Sign in to your organization</h1>
                    <p className="text-sm text-muted-foreground">Use the login created for your organization.</p>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        className="h-11"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@company.com"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="login-password">Password</Label>
                      <Input
                        id="login-password"
                        type="password"
                        autoComplete="current-password"
                        className="h-11"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  {error ? (
                    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}
                  <Button type="submit" disabled={busy} className="h-11 w-full gap-2">
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
                    {busy ? 'Signing in…' : 'Sign in'}
                  </Button>
                  {status?.demoHint ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <KeyRound className="size-3.5 shrink-0" aria-hidden />
                        Demo org: <span className="font-mono text-foreground">owner@shreeforge.example.com</span> ·{' '}
                        <span className="font-mono text-foreground">forge123</span>
                      </span>
                      <Button type="button" variant="outline" size="sm" className="h-9 px-3 md:h-7 md:px-2.5" onClick={fillDemo}>
                        Fill
                      </Button>
                    </div>
                  ) : null}
                </form>
              )}
            </CardContent>
          </Card>

        </div>
      </main>

      <footer className="mt-auto border-t bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-1 px-4 py-3 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <span className="font-medium text-foreground">ForgeERP</span>
          <span>Manufacturing · Jobwork · GST · Double-Entry — one secure workspace per organization</span>
        </div>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Manual company setup (first boot, blank install): create the company with
 * the essentials here; the full profile (bank, address, Tally settings) is
 * completed later in Masters → Company. After this, the login screen's
 * "create owner login" step finishes the SaaS setup.
 */
export function ManualSetupView({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [form, setForm] = useState({ name: '', legalName: '', gstin: '', stateCode: '27', city: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const gstinTouched = form.gstin.trim().length > 0
  const gstinOk = gstinChecksumValid(form.gstin.trim().toUpperCase())

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!form.name.trim()) {
      setError('Company name is required')
      return
    }
    if (gstinTouched && !gstinOk) {
      setError('GSTIN checksum failed (format: 27ABCDE1234F1Z5)')
      return
    }
    setBusy(true)
    setError('')
    try {
      await apiPut('/api/masters/company', {
        name: form.name.trim(),
        legalName: form.legalName.trim() || null,
        gstin: gstinTouched ? form.gstin.trim().toUpperCase() : null,
        stateCode: form.stateCode.trim() || '27',
        city: form.city.trim() || null,
        email: form.email.trim() || null,
      })
      toast.success('Company created — create your owner login next')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the company')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="border-b bg-card pb-[max(0px,env(safe-area-inset-top))]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Factory className="size-4" aria-hidden />
            </span>
            <span className="text-sm font-semibold tracking-tight">ForgeERP</span>
          </div>
          <Button variant="ghost" onClick={onBack} className="h-9 gap-2 px-3">
            <ArrowLeft className="size-4" aria-hidden /> Back
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-4 py-10">
        <Card className="w-full max-w-md p-0">
          <CardContent className="p-6 sm:p-8">
            <form onSubmit={submit} className="space-y-5" noValidate>
              <div className="space-y-1">
                <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
                  <Building2 className="size-5 text-muted-foreground" aria-hidden /> Set up your company
                </h1>
                <p className="text-sm text-muted-foreground">
                  The essentials now — bank details, address and Tally settings can be completed in Masters → Company
                  after you sign in.
                </p>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="setup-name">Company name *</Label>
                  <Input id="setup-name" className="h-11" value={form.name} onChange={set('name')} placeholder="e.g. Shree Forge Industries" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="setup-legal">Legal name</Label>
                  <Input id="setup-legal" className="h-11" value={form.legalName} onChange={set('legalName')} placeholder="e.g. Shree Forge Industries Pvt. Ltd." />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="setup-gstin">GSTIN</Label>
                    <Input
                      id="setup-gstin"
                      className="h-11 font-mono uppercase"
                      value={form.gstin}
                      onChange={set('gstin')}
                      placeholder="27ABCDE1234F1Z5"
                      aria-invalid={gstinTouched && !gstinOk}
                      aria-describedby="setup-gstin-hint"
                    />
                    <p id="setup-gstin-hint" className={gstinTouched ? (gstinOk ? 'text-xs font-medium text-primary' : 'text-xs font-medium text-destructive') : 'text-xs text-muted-foreground'}>
                      {gstinTouched ? (gstinOk ? 'Checksum valid' : 'Invalid GSTIN — checksum failed') : 'Optional for B2C / unregistered.'}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="setup-state">State code</Label>
                    <Input id="setup-state" className="h-11" value={form.stateCode} onChange={set('stateCode')} placeholder="27" maxLength={2} />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="setup-city">City</Label>
                    <Input id="setup-city" className="h-11" value={form.city} onChange={set('city')} placeholder="Pune" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="setup-email">Email</Label>
                    <Input id="setup-email" type="email" className="h-11" value={form.email} onChange={set('email')} placeholder="works@company.com" />
                  </div>
                </div>
              </div>
              {error ? (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={busy} className="h-11 w-full gap-2">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Building2 className="size-4" aria-hidden />}
                {busy ? 'Creating…' : 'Create company'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto border-t bg-card pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-1 px-4 py-3 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <span className="font-medium text-foreground">ForgeERP</span>
          <span>Next step: create the owner login for this organization</span>
        </div>
      </footer>
    </div>
  )
}
