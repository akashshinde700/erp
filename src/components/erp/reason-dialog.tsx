'use client'

import { useState } from 'react'
import { toastError } from './api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Confirm an irreversible / reversing action: show its effect, require a reason. */
export function ReasonDialog({ title, lines, confirm, placeholder, optional, destructive = true, onClose, onConfirm }: {
  title: string
  lines: string[]
  confirm: string
  placeholder?: string
  optional?: boolean
  destructive?: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const run = async () => { setSaving(true); try { await onConfirm(reason.trim()) } catch (e) { toastError(e) } finally { setSaving(false) } }
  return <Dialog open onOpenChange={(o) => { if (!o) onClose() }}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>What this does:</DialogDescription></DialogHeader>
    <ul className="list-disc space-y-1 pl-5 text-sm">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    <div className="space-y-1.5"><Label htmlFor="reason-input">{optional ? 'Note (optional)' : 'Reason (required)'}</Label><Input id="reason-input" className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder ?? 'Why?'} /></div>
    <DialogFooter><Button variant="outline" className="h-11" onClick={onClose}>Keep</Button><Button variant={destructive ? 'destructive' : 'default'} className="h-11" disabled={(!optional && !reason.trim()) || saving} onClick={() => void run()}>{saving ? 'Working…' : confirm}</Button></DialogFooter></DialogContent></Dialog>
}
