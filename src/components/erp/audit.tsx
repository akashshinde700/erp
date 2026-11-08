'use client'

/**
 * ForgeERP — audit trail viewer.
 * Every mutation (create/update/cancel/export/platform/backup/seed) is logged
 * server-side; this screen browses it with entity/action filters + CSV export.
 */

import { useMemo, useState } from 'react'
import { Download, RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dateStr } from '@/lib/erp'
import { apiGet, downloadCsv, toastError, useApi, type AuditRow } from './api'
import { EmptyState, SectionHeading, TableSkeleton } from './bits'

const ACTION_TONE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  POST: 'default',
  CREATE: 'default',
  UPDATE: 'secondary',
  CANCEL: 'destructive',
  DELETE: 'destructive',
  EXPORT: 'outline',
  PLATFORM: 'outline',
  BACKUP: 'secondary',
  SEED: 'secondary',
}

export function AuditView() {
  const [entity, setEntity] = useState('ALL')
  const [action, setAction] = useState('ALL')
  const [search, setSearch] = useState('')
  const query = useMemo(() => {
    const sp = new URLSearchParams()
    if (entity !== 'ALL') sp.set('entity', entity)
    if (action !== 'ALL') sp.set('action', action)
    return `/api/audit?${sp.toString()}`
  }, [entity, action])
  const audit = useApi<{ rows: AuditRow[]; entities: { entity: string; count: number }[] }>(query)

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return audit.data?.rows ?? []
    return (audit.data?.rows ?? []).filter(
      (r) =>
        r.entity.toLowerCase().includes(q) ||
        (r.details ?? '').toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q)
    )
  }, [audit.data, search])

  const entities = audit.data?.entities ?? []
  const actions = useMemo(() => Array.from(new Set((audit.data?.rows ?? []).map((r) => r.action))).sort(), [audit.data])

  const exportCsv = () => {
    downloadCsv(`forge-audit-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Timestamp', 'Action', 'Entity', 'Entity ID', 'Details'],
      ...rows.map((r) => [new Date(r.createdAt).toLocaleString(), r.action, r.entity, r.entityId ?? '', r.details ?? '']),
    ])
  }

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Audit Trail"
        description="Append-only log of every mutation — postings, cancellations, exports, platform actions, backups."
        actions={
          <>
            <Button variant="outline" onClick={() => audit.reload()} className="h-11 gap-2">
              <RefreshCw className="size-4" aria-hidden /> Refresh
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0} className="h-11 gap-2">
              <Download className="size-4" aria-hidden /> Export CSV
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entity / details…" className="h-11 pl-8" aria-label="Search audit log" />
        </div>
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="h-11 data-[size=default]:h-11 w-full sm:w-44" aria-label="Filter by entity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All entities</SelectItem>
            {entities.map((e) => (
              <SelectItem key={e.entity} value={e.entity}>
                {e.entity} ({e.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="h-11 data-[size=default]:h-11 w-full sm:w-40" aria-label="Filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All actions</SelectItem>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="tabular-nums">{rows.length} entries</Badge>
      </div>

      <Card className="p-0">
        <CardContent className="p-0">
          {audit.loading ? (
            <TableSkeleton rows={8} cols={5} />
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No audit entries" hint="Post an invoice or edit a master — every mutation lands here." />
            </div>
          ) : (
            <div className="max-h-[68dvh] overflow-auto erp-scroll [&_[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        {dateStr(r.createdAt)}
                        <span className="block text-muted-foreground">
                          {new Date(r.createdAt).toLocaleTimeString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ACTION_TONE[r.action] ?? 'secondary'}>{r.action}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{r.entity}</TableCell>
                      <TableCell className="max-w-56 truncate text-xs text-muted-foreground sm:max-w-96" title={r.details ?? undefined}>{r.details ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
