'use client'

/**
 * ForgeERP — Docs view ("Reverse-Engineering Intelligence").
 * Static content distilled from /docs — how four authorized open-source ERP
 * repositories were analyzed and where each extracted pattern landed.
 * Nothing is fetched at runtime.
 */

import {
  BadgeCheck,
  BookOpen,
  Brain,
  FileSearch,
  FileText,
  FlaskConical,
  GitCompare,
  Map,
  ShieldCheck,
  Table2,
  Workflow,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SectionHeading } from './bits'

// ---------- documentation set ----------

const DOCS: { title: string; summary: string; icon: typeof FileText }[] = [
  {
    title: 'ERP Workflow Documentation',
    summary:
      'The six implemented user workflows W1–W6: sales invoice, purchase, payment + allocation, opening stock, the jobwork chain, and reports — each traced user action → UI → validation → API → transaction → ledgers.',
    icon: Workflow,
  },
  {
    title: 'Existing Architecture',
    summary:
      'Target-stack decisions (Next.js 16 App Router, Prisma/SQLite, shadcn single-page module registry, {success,data,error} envelope) and the seven core invariants — atomic posting, append-only ledgers, gapless numbering, one shared GST engine.',
    icon: BookOpen,
  },
  {
    title: 'Reverse Engineering Summary',
    summary:
      'Scope contract, repository access ledger and the per-repo intelligence extract with file-path evidence (E-nnn → F-nnn discipline). Records the erpnashilk 404 honestly and the tool-usage disclosure.',
    icon: Brain,
  },
  {
    title: 'Source Repository Comparison',
    summary:
      'Feature-by-feature matrix across ERPNext / Laserp / GST Billing with ADOPT · ADAPT · AVOID verdicts and evidence citations for every row — e.g. reversal-not-delete (ADOPT), FIFO stock queue (ADAPT to weighted average).',
    icon: GitCompare,
  },
  {
    title: 'Feature Gap Analysis',
    summary:
      'Reference features vs the target MVP: what is in (jobwork chain, GST engine, double-entry GL), what is roadmap (auth/RBAC P1, multi-company P3) and what is out of scope — with per-repo coverage columns.',
    icon: FileSearch,
  },
  {
    title: 'Implementation Roadmap',
    summary:
      'P0→P4 plan. P0 (delivered): atomic posting, GL + trial-balance proof, GST engine, jobwork chain, reversal cancels, over-processing guards. P1: auth + RBAC; later: FY close, Postgres/Decimal migration.',
    icon: Map,
  },
  {
    title: 'Database Relationship Analysis',
    summary:
      'Phase-6 schema blueprint: SQLite constraints (string statuses, Float + r2() money), the full entity map (Party→Invoices/Inwards/Payments, ledgers, counters) and the polymorphic payment-allocation design.',
    icon: Table2,
  },
]

// ---------- per-repository intelligence (§3) ----------

const REPOS: {
  name: string
  meta: string
  status: 'analyzed' | 'inaccessible'
  verdict: string
  points: string[]
}[] = [
  {
    name: 'ERPNext (frappe/erpnext)',
    meta: 'GPL-3.0 · 44 MB sparse clone · enterprise patterns',
    status: 'analyzed',
    verdict: 'Lifecycle & ledger spine',
    points: [
      'docstatus Draft/Submitted/Cancelled on every doctype; cancel = reversal entries, never delete (make_reverse_gl_entries).',
      'Stock ledger engine (3,288 lines): signed qty_after_transaction, valuation, FIFO queue, negative threshold 0.0001, Bin cache.',
      'Derived Work Order status recomputed from ledger sums; over-production percentage guard — adopted for jobwork.',
      'Tax engine slope/intercept model; rounding_adjustment = rounded_total − grand_total.',
      'Naming series per doc type + FY (ACC-SINV-.YYYY.-) → our Counter table, atomic in-transaction.',
      'Weaknesses noted: god-controllers, O(n) recount per write, huge backdated reposting machinery.',
    ],
  },
  {
    name: 'Laserp / "ManuFlow ERP" (akashshinde700)',
    meta: 'No license (all rights reserved) · patterns only, zero code copied',
    status: 'analyzed',
    verdict: 'Same-stack UI & guards',
    points: [
      'Single-page module-registry UI on our exact stack (Next.js App Router + Prisma/SQLite + shadcn) — the shell you are using now.',
      'postStock single choke-point inside db.$transaction with moving-average valuation + low-stock notifications.',
      'Server-derived BOM requirements for material issue (client qty untrusted) — mirrored in our over-processing guard.',
      'Bugs found & fixed by design: line items lack FK relations; inter-state check by state names (we use codes); declared stock types never posted; no GL/journal at all.',
      'Auth pattern (scrypt, DB sessions, HMAC cookie, requireWrite) documented for P1 roadmap.',
    ],
  },
  {
    name: 'Free GST Billing Software (IamRamgarhia)',
    meta: 'Pure, unit-tested tax engine (1,077-line test suite)',
    status: 'analyzed',
    verdict: 'GST compliance brain',
    points: [
      'computeInvoiceTotals with verified test cases — inclusive/exclusive solved exactly: taxable = afterDisc / (1 + rate/100).',
      'Place-of-supply beats client state; 5 UT codes → CGST + UTGST; odd-paisa CGST/SGST halving with a 1e-7 nudge so halves re-sum to the tax.',
      'Offline GSTIN mod-36 Luhn checksum + decode — live in every party form here.',
      'GSTR-1 buckets (b2b/b2cs/hsn) and print compliance: HSN summary, amount-in-words, PoS as "27-Maharashtra".',
      'Atomic gapless numbering with peek() (preview without burning) → our in-transaction Counter.',
    ],
  },
  {
    name: 'erpnashilk (akashshinde700)',
    meta: '404 / removed / private — git ls-remote not resolvable',
    status: 'inaccessible',
    verdict: 'Honest disclosure',
    points: [
      'Clone FAILED. No analysis performed, no functionality invented for it, recorded per the mission Phase-1 rule.',
    ],
  },
]

// ---------- tools (§4) ----------

const TOOLS: { name: string; detail: string }[] = [
  {
    name: 'reverse-skill (MIT)',
    detail:
      'Inspected read-only as a methodology pack. Adopted by hand: scope-contract, Evidence→Finding→Path discipline, append-only timeline, anti-hallucination tagging. Its scripts/bootstrap were never executed.',
  },
  {
    name: 'rea / rea-agents (MIT)',
    detail:
      'An agent-assisted RE CLI for binaries without source (Ghidra/IDA/APK). Verdict: not applicable to authorized static analysis of TypeScript repos. Not executed; none of its toolchains installed.',
  },
]

// ---------- implementation mapping (§5) ----------

const MAPPING: { idea: string; lands: string }[] = [
  { idea: 'docstatus draft/submitted/cancelled + reversal-not-delete', lands: 'All transaction services (src/lib/services.ts)' },
  { idea: 'Append-only StockLedger / AccountLedger with isCancelled reversals', lands: 'Prisma models + cancel flows' },
  { idea: 'Naming series per doc type + FY', lands: 'Counter table, atomic in-transaction increment' },
  { idea: 'Inclusive/exclusive GST + PoS split + UTGST + odd-paisa nudge', lands: 'src/lib/erp.ts pure engine (client + server shared)' },
  { idea: 'GSTR-1 B2B/B2C rate-wise summary', lands: '/api/reports?type=gstr1' },
  { idea: 'Jobwork chain Inward → JobCard → Certificate → Invoice', lands: 'Dedicated module set (the Jobwork screen)' },
  { idea: 'Double-entry GL on every voucher (stronger than laserp)', lands: 'src/lib/accounting.ts + trial-balance integrity check' },
  { idea: 'Single-page module registry UI', lands: 'src/components/erp/* — this shell' },
  { idea: 'GSTIN checksum validation at data entry', lands: 'Party & company forms + API' },
  { idea: 'Amount-in-words (Indian crore/lakh) on print', lands: 'erp.ts::numberToWords on the invoice print' },
]

export function DocsView() {
  return (
    <div className="space-y-6">
      <SectionHeading
        title="Reverse-Engineering Intelligence"
        description="How ForgeERP was designed: static analysis of four authorized open-source ERP repositories, evidence-disciplined, distilled into the modules you are using."
      />

      {/* hero */}
      <Card className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Brain className="size-6" aria-hidden />
          </span>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Every pattern in this ERP is traceable to evidence from a local read-only clone — file paths, line
              numbers, test suites. The methodology (scope contract, Evidence→Finding→Path, append-only timeline)
              was adopted by hand; no external analysis scripts were executed.
            </p>
            <p>
              One repository (<span className="font-medium text-foreground">erpnashilk</span>) was inaccessible
              (404) — it is recorded as such and nothing was invented for it. The result:{' '}
              <span className="font-medium text-foreground">
                report ≡ print ≡ invoice by construction
              </span>
              , because the UI preview and the server posting share one pure GST engine.
            </p>
          </div>
        </div>
      </Card>

      {/* per-repo intelligence */}
      <div className="grid gap-4 lg:grid-cols-2">
        {REPOS.map((r) => (
          <Card key={r.name} className="p-0">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b py-3">
              <div>
                <CardTitle className="text-sm font-semibold">{r.name}</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">{r.meta}</p>
              </div>
              {r.status === 'analyzed' ? (
                <Badge className="gap-1">
                  <BadgeCheck className="size-3" aria-hidden /> {r.verdict}
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="size-3" aria-hidden /> {r.verdict}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="p-4">
              <ScrollArea className="max-h-64">
                <ul className="space-y-1.5 pr-2 text-sm">
                  {r.points.map((p) => (
                    <li key={p.slice(0, 40)} className="flex gap-2 text-muted-foreground">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </CardContent>
          </Card>
        ))}

        {/* tool disclosure */}
        <Card className="p-0 lg:col-span-2">
          <CardHeader className="border-b py-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              Tool Usage Disclosure
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            {TOOLS.map((t) => (
              <div key={t.name} className="rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.detail}</p>
              </div>
            ))}
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Mission rule honoured: never claim usage that didn&rsquo;t happen.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* mapping table */}
      <Card className="p-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="size-4 text-primary" aria-hidden />
            Consolidated → Implementation Mapping
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-64">Reference idea (evidence-cited)</TableHead>
                  <TableHead className="min-w-64">Where it lands in ForgeERP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MAPPING.map((m) => (
                  <TableRow key={m.idea}>
                    <TableCell className="text-sm">{m.idea}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{m.lands}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* documentation set */}
      <div>
        <h3 className="mb-3 text-base font-semibold">Documentation set</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {DOCS.map((d) => (
            <Card key={d.title} className="p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <d.icon className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold leading-snug">{d.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{d.summary}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
        <Separator className="my-4" />
        <p className="text-xs text-muted-foreground">
          Full documents live in <span className="font-mono">/docs</span> of the project workspace — this page is
          the distilled index (no runtime fetching).
        </p>
      </div>
    </div>
  )
}
