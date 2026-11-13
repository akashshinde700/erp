'use client'

/**
 * ForgeERP — GST invoice print layout (sales & purchase).
 * Wrapped in `.print-area` — the only visible subtree when printing
 * (see @media print rules in globals.css). `window.print()` is triggered
 * by the parent view's Print button.
 */

import type { Company, InvoiceItem, Item, PartyMini, PurchaseInvoice, SalesInvoice } from './api'
import { useCompany } from './company'
import { amountInWords, dateStr, money, qty as qtyFmt, stateName } from '@/lib/erp'

export interface InvoicePrintProps {
  kind: 'SALES' | 'PURCHASE'
  invoice: (SalesInvoice | PurchaseInvoice) & { party?: PartyMini; items?: InvoiceItem[] }
  items: Item[]
  /** Override the document title (e.g. 'PROFORMA INVOICE'); also hides the paid / balance block. */
  title?: string
}

interface RateGroup {
  rate: number
  taxable: number
  cgst: number
  sgst: number
  igst: number
}

interface HsnGroup {
  hsn: string
  qty: number
  taxable: number
  gstRate: number
  cgst: number
  sgst: number
  igst: number
}

function groupByRate(lines: InvoiceItem[]): RateGroup[] {
  const m = new Map<number, RateGroup>()
  for (const l of lines) {
    const g = m.get(l.gstRate) ?? { rate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
    g.taxable += l.taxable
    g.cgst += l.cgst
    g.sgst += l.sgst
    g.igst += l.igst
    m.set(l.gstRate, g)
  }
  return [...m.values()].sort((a, b) => a.rate - b.rate)
}

function groupByHsn(lines: InvoiceItem[], nameOf: (id: string) => Item | undefined): HsnGroup[] {
  const m = new Map<string, HsnGroup>()
  for (const l of lines) {
    const hsn = l.hsn ?? nameOf(l.itemId)?.hsn ?? '—'
    const g = m.get(hsn) ?? { hsn, qty: 0, taxable: 0, gstRate: l.gstRate, cgst: 0, sgst: 0, igst: 0 }
    g.qty += l.qty
    g.taxable += l.taxable
    g.cgst += l.cgst
    g.sgst += l.sgst
    g.igst += l.igst
    m.set(hsn, g)
  }
  return [...m.values()].sort((a, b) => a.hsn.localeCompare(b.hsn))
}

const td = 'border px-1.5 py-1 tabular-nums'
const th = 'border bg-muted/60 px-1.5 py-1 text-left font-semibold'

export function InvoicePrint({ kind, invoice, items, title: titleOverride }: InvoicePrintProps) {
  const company: Company | null = useCompany()
  const itemMap = new Map(items.map((i) => [i.id, i]))
  const nameOf = (id: string): Item | undefined => itemMap.get(id)
  const lines = invoice.items ?? []
  const rateGroups = groupByRate(lines)
  const hsnGroups = groupByHsn(lines, nameOf)
  const isSales = kind === 'SALES'
  const title = titleOverride ?? (isSales ? 'TAX INVOICE' : 'PURCHASE INVOICE')
  const inv = invoice as SalesInvoice

  return (
    <div className="print-area mx-auto w-full max-w-4xl rounded-lg border bg-card p-4 text-foreground shadow-sm sm:p-6">
      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-0.5 text-sm">
          <p className="text-base font-bold uppercase tracking-wide">{company?.name ?? 'Your Company'}</p>
          {company?.legalName ? <p className="text-xs text-muted-foreground">{company.legalName}</p> : null}
          {company?.address ? <p>{company.address}</p> : null}
          {company?.city ? (
            <p>
              {company.city}
              {company.pincode ? ` — ${company.pincode}` : ''}
            </p>
          ) : null}
          <p>
            <span className="font-medium">GSTIN:</span>{' '}
            <span className="tabular-nums">{company?.gstin ?? '—'}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {company?.phone ? `Ph: ${company.phone}` : ''}
            {company?.email ? `${company.phone ? ' · ' : ''}${company.email}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="inline-block rounded-md border-2 border-primary px-4 py-1.5 text-lg font-bold tracking-widest text-primary">
            {title}
          </p>
          {isSales && inv.source === 'JOBWORK' ? (
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Jobwork services · SAC 998887
            </p>
          ) : null}
        </div>
      </div>

      {/* ---------- meta + party ---------- */}
      <div className="grid gap-4 border-b py-4 sm:grid-cols-2">
        <div className="space-y-0.5 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isSales ? 'Bill To' : 'Supplier'}
          </p>
          <p className="font-semibold">{invoice.party?.name ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{invoice.party?.code}</p>
          <p>
            <span className="font-medium">GSTIN:</span>{' '}
            <span className="tabular-nums">{invoice.party?.gstin ?? 'Unregistered'}</span>
          </p>
          {invoice.party?.stateCode ? (
            <p>
              <span className="font-medium">State:</span> {stateName(invoice.party.stateCode)}
            </p>
          ) : null}
        </div>
        <div className="space-y-0.5 text-sm sm:justify-self-end sm:text-right">
          <p>
            <span className="font-medium">Invoice No:</span>{' '}
            <span className="font-semibold tabular-nums">{invoice.invoiceNo}</span>
          </p>
          <p>
            <span className="font-medium">Date:</span> {dateStr(invoice.date)}
          </p>
          {isSales ? (
            <p>
              <span className="font-medium">Place of Supply:</span> {inv.pos}-{stateName(inv.pos)}
            </p>
          ) : (
            <p>
              <span className="font-medium">Supply:</span>{' '}
              {invoice.interState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}
            </p>
          )}
          {invoice.poNo ? (
            <p>
              <span className="font-medium">PO No:</span> {invoice.poNo}
            </p>
          ) : null}
          {invoice.taxInclusive ? <p className="text-xs italic text-muted-foreground">Tax-inclusive rates</p> : null}
          {invoice.remarks ? <p className="text-xs text-muted-foreground">{invoice.remarks}</p> : null}
        </div>
      </div>

      {/* ---------- items ---------- */}
      <div className="overflow-x-auto py-4">
        <table className="w-full min-w-[720px] border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>#</th>
              <th className={th}>Item / Description</th>
              <th className={th}>HSN</th>
              <th className={th}>UOM</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Rate</th>
              <th className={`${th} text-right`}>Disc %</th>
              <th className={`${th} text-right`}>Taxable</th>
              <th className={`${th} text-right`}>GST %</th>
              <th className={`${th} text-right`}>CGST</th>
              <th className={`${th} text-right`}>SGST</th>
              <th className={`${th} text-right`}>IGST</th>
              <th className={`${th} text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const it = nameOf(l.itemId)
              return (
                <tr key={l.id} className="align-top">
                  <td className={`${td} text-center`}>{idx + 1}</td>
                  <td className={td}>
                    <span className="font-medium">{it?.name ?? l.itemId}</span>
                    {l.detail ? <span className="block text-[10px] text-muted-foreground">{l.detail}</span> : null}
                  </td>
                  <td className={`${td} tabular-nums`}>{l.hsn ?? it?.hsn ?? '—'}</td>
                  <td className={td}>{l.uom}</td>
                  <td className={`${td} text-right`}>{qtyFmt(l.qty)}</td>
                  <td className={`${td} text-right`}>{money(l.rate)}</td>
                  <td className={`${td} text-right`}>{l.discPct ? `${l.discPct}%` : '—'}</td>
                  <td className={`${td} text-right`}>{money(l.taxable)}</td>
                  <td className={`${td} text-right`}>{l.gstRate}%</td>
                  <td className={`${td} text-right`}>{money(l.cgst)}</td>
                  <td className={`${td} text-right`}>{money(l.sgst)}</td>
                  <td className={`${td} text-right`}>{money(l.igst)}</td>
                  <td className={`${td} text-right font-semibold`}>{money(l.total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ---------- totals + words ---------- */}
      <div className="grid gap-4 border-t pt-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Amount in Words
            </p>
            <p className="font-medium">{amountInWords(invoice.grandTotal)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tax Summary (by rate)
            </p>
            <table className="mt-1 w-full min-w-0 border-collapse text-xs sm:min-w-72">
              <thead>
                <tr>
                  <th className={th}>Rate</th>
                  <th className={`${th} text-right`}>Taxable</th>
                  <th className={`${th} text-right`}>CGST</th>
                  <th className={`${th} text-right`}>SGST</th>
                  <th className={`${th} text-right`}>IGST</th>
                </tr>
              </thead>
              <tbody>
                {rateGroups.map((g) => (
                  <tr key={g.rate}>
                    <td className={td}>{g.rate}%</td>
                    <td className={`${td} text-right`}>{money(g.taxable)}</td>
                    <td className={`${td} text-right`}>{money(g.cgst)}</td>
                    <td className={`${td} text-right`}>{money(g.sgst)}</td>
                    <td className={`${td} text-right`}>{money(g.igst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              HSN Summary
            </p>
            <table className="mt-1 w-full min-w-0 border-collapse text-xs sm:min-w-72">
              <thead>
                <tr>
                  <th className={th}>HSN</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className={`${th} text-right`}>Taxable</th>
                  <th className={`${th} text-right`}>Rate</th>
                  <th className={`${th} text-right`}>Tax</th>
                </tr>
              </thead>
              <tbody>
                {hsnGroups.map((h) => (
                  <tr key={h.hsn}>
                    <td className={td}>{h.hsn}</td>
                    <td className={`${td} text-right`}>{qtyFmt(h.qty)}</td>
                    <td className={`${td} text-right`}>{money(h.taxable)}</td>
                    <td className={`${td} text-right`}>{h.gstRate}%</td>
                    <td className={`${td} text-right`}>{money(h.cgst + h.sgst + h.igst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <table className="w-full min-w-56 border-collapse text-sm">
            <tbody>
              <tr>
                <td className={`${td} text-right`}>Taxable Value</td>
                <td className={`${td} text-right`}>{money(invoice.taxable)}</td>
              </tr>
              {invoice.discount > 0 ? (
                <tr>
                  <td className={`${td} text-right`}>Discount</td>
                  <td className={`${td} text-right`}>− {money(invoice.discount)}</td>
                </tr>
              ) : null}
              <tr>
                <td className={`${td} text-right`}>CGST</td>
                <td className={`${td} text-right`}>{money(invoice.cgst)}</td>
              </tr>
              <tr>
                <td className={`${td} text-right`}>SGST / UTGST</td>
                <td className={`${td} text-right`}>{money(invoice.sgst)}</td>
              </tr>
              <tr>
                <td className={`${td} text-right`}>IGST</td>
                <td className={`${td} text-right`}>{money(invoice.igst)}</td>
              </tr>
              <tr>
                <td className={`${td} text-right`}>Round Off</td>
                <td className={`${td} text-right`}>
                  {invoice.roundOff >= 0 ? '+ ' : '− '}
                  {money(Math.abs(invoice.roundOff))}
                </td>
              </tr>
              <tr className="bg-muted/60">
                <td className={`${td} text-right text-base font-bold`}>GRAND TOTAL</td>
                <td className={`${td} text-right text-base font-bold`}>₹ {money(invoice.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
          <div className={`text-xs ${titleOverride ? 'hidden' : ''}`}>
            <p>
              <span className="font-medium">Paid:</span> ₹ {money(invoice.paidAmount)}
            </p>
            <p>
              <span className="font-medium">Balance Due:</span> ₹{' '}
              {money(invoice.grandTotal - invoice.paidAmount)}
            </p>
          </div>
        </div>
      </div>

      {/* ---------- bank + declaration ---------- */}
      <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
        <div className="space-y-0.5 text-xs">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Bank Details
          </p>
          {company?.bankName ? <p>Bank: {company.bankName}</p> : null}
          {company?.bankAcct ? <p>A/c No: {company.bankAcct}</p> : null}
          {company?.bankIfsc ? <p>IFSC: {company.bankIfsc}</p> : null}
          {company?.upiId ? <p>UPI: {company.upiId}</p> : null}
          {!company?.bankName && !company?.upiId ? <p className="text-muted-foreground">—</p> : null}
        </div>
        <div className="space-y-0.5 text-xs sm:text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Declaration</p>
          <p className="text-muted-foreground">
            We declare that this invoice shows the actual price of the goods/services described and that all
            particulars are true and correct.
          </p>
        </div>
      </div>

      <div className="flex items-end justify-between border-t pt-4 text-xs">
        <p className="text-muted-foreground">This is a computer-generated invoice.</p>
        <div className="text-right">
          <p className="font-medium">For {company?.name ?? 'Your Company'}</p>
          <div className="h-10" />
          <p className="border-t pt-1 text-muted-foreground">Authorised Signatory</p>
        </div>
      </div>
    </div>
  )
}
