'use client'

/**
 * Email UI: SMTP status + test message + recent log (Masters → Company),
 * "Email invoice" dialog (sales invoices) and payment-reminder buttons (aging).
 * SMTP credentials are never shown — the server only reports host/port/from.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { Mail, MailCheck, MailWarning, Send } from 'lucide-react'
import { apiPost, toastError, useApi } from './api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface SmtpStatus {
  configured: boolean
  host: string | null
  port: number | null
  secure: boolean
  from: string | null
  authenticated: boolean
  reason: string | null
}
interface EmailLogRow {
  id: string
  kind: string
  toAddress: string
  subject: string
  status: string
  error: string | null
  createdBy: string | null
  createdAt: string
}

export function EmailSettingsCard() {
  const res = useApi<{ smtp: SmtpStatus; recent: EmailLogRow[] }>('/api/notifications')
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const smtp = res.data?.smtp
  const send = async () => {
    if (!to.trim()) return toast.error('Type the address to send the test to')
    setSending(true)
    try {
      await apiPost('/api/notifications', { action: 'test', to: to.trim() })
      toast.success(`Test email sent to ${to.trim()}`)
      res.reload()
    } catch (e) {
      toastError(e)
      res.reload()
    } finally {
      setSending(false)
    }
  }
  return (
    <Card className="mt-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail className="size-4" aria-hidden />
          <h3 className="text-base font-semibold">Email (SMTP)</h3>
        </div>
        {smtp ? (
          smtp.configured ? (
            <Badge variant="secondary" className="gap-1"><MailCheck className="size-3.5" aria-hidden />Configured</Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-amber-700 dark:text-amber-300"><MailWarning className="size-3.5" aria-hidden />Not configured</Badge>
          )
        ) : null}
      </div>
      {smtp ? (
        smtp.configured ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Sending as <span className="font-medium text-foreground">{smtp.from}</span> via {smtp.host}:{smtp.port}
            {smtp.secure ? ' (TLS)' : ' (STARTTLS)'}{smtp.authenticated ? ', authenticated' : ''}. Credentials stay on the server.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Email is off: {smtp.reason}. The administrator sets <span className="font-mono">SMTP_HOST</span>, <span className="font-mono">SMTP_PORT</span>,{' '}
            <span className="font-mono">SMTP_USER</span>, <span className="font-mono">SMTP_PASS</span> and <span className="font-mono">SMTP_FROM</span> in the server
            environment and restarts the app.
          </p>
        )
      ) : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="smtp-test-to">Send a test email to</Label>
          <Input id="smtp-test-to" type="email" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@company.in" className="h-11" />
        </div>
        <Button onClick={send} disabled={sending || !smtp?.configured} className="h-11 gap-2">
          <Send className="size-4" aria-hidden />
          {sending ? 'Sending…' : 'Send test'}
        </Button>
      </div>
      {res.data?.recent.length ? (
        <div className="mt-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {res.data.recent.slice(0, 10).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(r.createdAt).toLocaleString('en-IN')}</TableCell>
                  <TableCell className="text-xs">{r.kind}</TableCell>
                  <TableCell className="text-xs">{r.toAddress}</TableCell>
                  <TableCell className="text-xs">
                    {r.status === 'SENT' ? <Badge variant="secondary">Sent</Badge> : <span className="text-destructive" title={r.error ?? ''}>Failed{r.error ? ` — ${r.error.slice(0, 60)}` : ''}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </Card>
  )
}

export function EmailInvoiceDialog({
  invoice,
  onOpenChange,
}: {
  invoice: { id: string; invoiceNo: string; partyName: string } | null
  onOpenChange: (open: boolean) => void
}) {
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (!invoice) return
    setSending(true)
    try {
      const r = await apiPost<{ to: string; invoiceNo: string }>('/api/notifications', { action: 'invoice', id: invoice.id, to: to.trim() || undefined })
      toast.success(`${r.invoiceNo} emailed to ${r.to}`)
      setTo('')
      onOpenChange(false)
    } catch (e) {
      toastError(e)
    } finally {
      setSending(false)
    }
  }
  return (
    <Dialog open={!!invoice} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Email {invoice?.invoiceNo}</DialogTitle>
          <DialogDescription>Sends the invoice details, total and due date to {invoice?.partyName}. Leave the address empty to use the customer&apos;s email on file.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="inv-email-to">Send to</Label>
          <Input id="inv-email-to" type="email" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Customer's email on file" className="h-11" />
        </div>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-11 gap-2" onClick={send} disabled={sending}><Send className="size-4" aria-hidden />{sending ? 'Sending…' : 'Send email'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ReminderButton({ partyId, partyName }: { partyId: string; partyName: string }) {
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      const r = await apiPost<{ to: string; invoices: number }>('/api/notifications', { action: 'reminder', partyId })
      toast.success(`Reminder sent to ${partyName}`, { description: `${r.invoices} overdue invoice(s) → ${r.to}` })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" size="sm" className="h-10 gap-1.5" onClick={send} disabled={busy} aria-label={`Send payment reminder to ${partyName}`}>
      <Mail className="size-3.5" aria-hidden />
      {busy ? 'Sending…' : 'Remind'}
    </Button>
  )
}

export function RemindAllButton() {
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      const r = await apiPost<{ customersOverdue: number; sent: unknown[]; skipped: { reason: string }[] }>('/api/notifications', { action: 'reminders-all' })
      toast.success(`Reminders: ${r.sent.length} sent, ${r.skipped.length} skipped`, {
        description: r.skipped.length ? r.skipped.slice(0, 3).map((s) => s.reason).join(' · ') : `${r.customersOverdue} customer(s) with overdue invoices`,
      })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outline" className="h-11 gap-2" onClick={send} disabled={busy}>
      <Mail className="size-4" aria-hidden />
      {busy ? 'Sending…' : 'Remind all overdue'}
    </Button>
  )
}
