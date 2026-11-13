'use client'

/**
 * ForgeERP — shared row actions & Excel export UI.
 *
 * RowActions: the one place every list row gets View / Print / Edit / Delete /
 * custom actions — consistent icons, tooltips, aria-labels, mobile sizes.
 *
 * ExportButton: turns any loaded list into a real Excel workbook (.xls,
 * multi-sheet, numeric cells) with one click — or from anywhere with Alt+E
 * (the current view's primary export listens on EXPORT_EVENT).
 */

import { useEffect, useState, type ReactNode } from 'react'
import { Eye, FileDown, Loader2, MoreVertical, Pencil, Printer, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { exportExcel, type ExcelSheet } from '@/lib/export-xls'
import { toastError } from './api'

/** Broadcast by the global Alt+E shortcut; the visible ExportButton (listenGlobal) answers. */
export const EXPORT_EVENT = 'erp:export'

// ---------- row actions ----------

export interface RowAction {
  label: string
  icon?: LucideIcon
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}

export function RowActions({
  onView, onEdit, onPrint, onDelete, extra, printTitle = 'View & print', disabled,
}: {
  onView?: () => void
  onEdit?: () => void
  onPrint?: () => void
  onDelete?: () => void
  /** Module-specific entries appended to the ⋯ menu. */
  extra?: RowAction[]
  printTitle?: string
  disabled?: boolean
}): ReactNode {
  const menuItems = [
    ...(onEdit ? [{ label: 'Edit', icon: Pencil, onClick: onEdit }] : []),
    ...(extra ?? []),
    ...(onDelete ? [{ label: 'Delete', icon: Trash2, onClick: onDelete, destructive: true }] : []),
  ]
  return (
    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {onView ? (
        <Button variant="ghost" size="icon" disabled={disabled} className="size-11 text-muted-foreground hover:text-foreground md:size-8" onClick={onView} aria-label="View" title="View detail">
          <Eye className="size-4" aria-hidden />
        </Button>
      ) : null}
      {onPrint ? (
        <Button variant="ghost" size="icon" disabled={disabled} className="size-11 text-muted-foreground hover:text-foreground md:size-8" onClick={onPrint} aria-label="Print" title={printTitle}>
          <Printer className="size-4" aria-hidden />
        </Button>
      ) : null}
      {menuItems.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={disabled} className="size-11 text-muted-foreground hover:text-foreground md:size-8" aria-label="More actions" title="More actions (edit / delete / …)">
              <MoreVertical className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menuItems.map((item, i) => (
              <DropdownMenuItem
                key={`${item.label}-${i}`}
                onClick={item.onClick}
                disabled={item.disabled}
                className={item.destructive ? 'text-destructive focus:text-destructive' : undefined}
              >
                {item.icon ? <item.icon className="size-4" aria-hidden /> : null}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

// ---------- Excel export ----------

export function ExportButton({
  filename, sheets, label = 'Excel', listenGlobal = false, disabled, className,
}: {
  filename: string
  /** Built lazily on click so exports reflect the current filters; may be async (extra fetch). */
  sheets: () => ExcelSheet[] | Promise<ExcelSheet[]>
  label?: string
  /** Answer the global Alt+E shortcut (set on the primary export of the visible view). */
  listenGlobal?: boolean
  disabled?: boolean
  className?: string
}): ReactNode {
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const data = await sheets()
      if (!data.length || data.every((s) => s.rows.length === 0)) {
        toast.info('Nothing to export with the current filters')
        return
      }
      exportExcel(filename, data)
      toast.success(`${filename} downloaded`, { description: `${data.reduce((n, s) => n + s.rows.length, 0)} rows · ${data.length} sheet${data.length > 1 ? 's' : ''}` })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!listenGlobal) return
    const fn = () => void run()
    window.addEventListener(EXPORT_EVENT, fn)
    return () => window.removeEventListener(EXPORT_EVENT, fn)
  })

  return (
    <Button variant="outline" onClick={() => void run()} disabled={disabled || busy} className={className ? `${className} h-11 gap-2` : 'h-11 gap-2'}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />}
      {label}
    </Button>
  )
}
