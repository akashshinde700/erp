'use client'

/**
 * ForgeERP — attachments panel.
 *
 * Attach / list / download / remove files on any document. Wired into the
 * invoice detail views; reusable on every entity type the backend whitelists
 * (PO, GRN, payment, party, work order, ...).
 */

import { useRef, useState } from 'react'
import { Download, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { apiDelete, toastError, useApi } from './api'

export interface AttachmentRow {
  id: string
  fileName: string
  mimeType: string
  size: number
  note: string | null
  uploadedBy: string | null
  createdAt: string
}

function sizeFmt(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function AttachmentsPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const list = useApi<AttachmentRow[]>(`/api/attachments?entityType=${entityType}&entityId=${entityId}`)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('entityType', entityType)
      body.set('entityId', entityId)
      const res = await fetch('/api/attachments', { method: 'POST', body })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (!res.ok || !json.success) throw new Error(json.error ?? `Upload failed (${res.status})`)
      toast.success(`${file.name} attached`)
      list.reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (row: AttachmentRow) => {
    setBusy(true)
    try {
      await apiDelete(`/api/attachments/${row.id}`)
      toast.success(`${row.fileName} removed`)
      list.reload()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const rows = list.data ?? []

  return (
    <Card className="print-hide p-0">
      <CardContent className="p-0">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Paperclip className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Attachments</p>
          <span className="text-xs text-muted-foreground">{rows.length ? `${rows.length} file${rows.length > 1 ? 's' : ''}` : ''}</span>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            aria-label="Attach a file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
            }}
          />
          <Button variant="outline" size="sm" className="ml-auto gap-2" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            Attach file
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No files attached. PDF, images, Office documents, CSV, ZIP — up to 10 MB each.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/attachments/${row.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-medium hover:underline"
                    title={row.fileName}
                  >
                    {row.fileName}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {sizeFmt(row.size)}
                    {row.uploadedBy ? ` · ${row.uploadedBy}` : ''}
                    {row.createdAt ? ` · ${new Date(row.createdAt).toLocaleDateString()}` : ''}
                  </p>
                  {row.note ? <p className="truncate text-xs text-muted-foreground">{row.note}</p> : null}
                </div>
                <a
                  href={`/api/attachments/${row.id}?download=1`}
                  className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  aria-label={`Download ${row.fileName}`}
                  title="Download"
                >
                  <Download className="size-4" aria-hidden />
                </a>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => void remove(row)}
                  aria-label={`Remove ${row.fileName}`}
                  title="Remove"
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
