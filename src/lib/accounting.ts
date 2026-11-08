/**
 * ForgeERP — Chart of accounts + double-entry GL posting.
 * ERPNext `gl_entry` shape (account, party, debit, credit, voucher) with a
 * hard ΣDr == ΣCr assertion before any row is written (trial-balance integrity
 * by construction — docs/DATABASE_RELATIONSHIP_ANALYSIS.md §Posting matrix).
 *
 * Cancel semantics (append-only, ERPNext pattern):
 *  - original rows get isCancelled = true
 *  - mirrored reversal rows are written with isCancelled = true
 *  - effective reports filter isCancelled = false → net zero, full audit trail retained
 */
import { Prisma } from '@prisma/client'
import { fyCode } from './erp'

/**
 * Invoice number from the SHARED legacy series (counter key "PIN-2627", "INV-2627").
 * Direct invoices (services.ts) and controlled ones (GRN-backed purchase invoices,
 * dispatch-backed sales invoices) must draw from one counter: separate counters both
 * start at 001 and collide on the unique invoiceNo as soon as either series exists.
 */
export async function nextSharedInvoiceNo(tx: Prisma.TransactionClient, prefix: 'INV' | 'PIN', date: Date): Promise<string> {
  const key = `${prefix}-${fyCode(date)}`
  const counter = await tx.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } })
  return `${key}-${String(counter.value).padStart(3, '0')}`
}
import { r2 } from './erp'

export const ACCOUNTS = {
  DEBT: { code: 'DEBT', name: 'Sundry Debtors', group: 'Current Assets' },
  CRED: { code: 'CRED', name: 'Sundry Creditors', group: 'Current Liabilities' },
  STKV: { code: 'STKV', name: 'Stock (Inventory) Account', group: 'Current Assets' },
  WIP: { code: 'WIP', name: 'Manufacturing Work in Progress', group: 'Current Assets' },
  LABP: { code: 'LABP', name: 'Labour Cost Payable / Absorbed', group: 'Current Liabilities' },
  MFGV: { code: 'MFGV', name: 'Manufacturing Cost Variance', group: 'Direct Expenses' },
  SALS: { code: 'SALS', name: 'Sales Account', group: 'Direct Income' },
  JWIN: { code: 'JWIN', name: 'Jobwork Income', group: 'Direct Income' },
  PURC: { code: 'PURC', name: 'Purchase Account', group: 'Direct Expenses' },
  CGSTP: { code: 'CGSTP', name: 'Output CGST', group: 'Current Liabilities' },
  SGSTP: { code: 'SGSTP', name: 'Output SGST / UTGST', group: 'Current Liabilities' },
  IGSTP: { code: 'IGSTP', name: 'Output IGST', group: 'Current Liabilities' },
  CGSTI: { code: 'CGSTI', name: 'Input CGST', group: 'Current Assets' },
  SGSTI: { code: 'SGSTI', name: 'Input SGST / UTGST', group: 'Current Assets' },
  IGSTI: { code: 'IGSTI', name: 'Input IGST', group: 'Current Assets' },
  CASH: { code: 'CASH', name: 'Cash Account', group: 'Current Assets' },
  BANK: { code: 'BANK', name: 'Bank Account', group: 'Current Assets' },
  RND: { code: 'RND', name: 'Round Off', group: 'Indirect Income / Expenses' },
  OPEN: { code: 'OPEN', name: 'Opening Balance Equity', group: 'Equity' },
} as const

export type AccountCode = keyof typeof ACCOUNTS

export interface GlRowInput {
  account: AccountCode
  partyId?: string | null
  debit?: number
  credit?: number
  remarks?: string | null
}

export interface GlVoucher {
  date: Date
  voucherType: string
  voucherNo: string
}

export class BusinessError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/** Throws if the entry set does not balance — callers never persist unbalanced GL.
 *  Sums the PERSISTED precision (per-row r2) so what is checked is exactly
 *  what is written: Σ r2(row.debit) must equal Σ r2(row.credit). */
export function assertBalanced(rows: GlRowInput[]): void {
  const dr = r2(rows.reduce((s, r) => s + r2(r.debit ?? 0), 0))
  const cr = r2(rows.reduce((s, r) => s + r2(r.credit ?? 0), 0))
  if (Math.abs(dr - cr) > 0.005) {
    throw new BusinessError(
      `GL entry does not balance (Dr ${dr.toFixed(2)} vs Cr ${cr.toFixed(2)}) — refused to post`
    )
  }
}

/** Write GL rows inside the caller's transaction. Zero rows are skipped. */
export async function postGl(
  tx: Prisma.TransactionClient,
  voucher: GlVoucher,
  rows: GlRowInput[],
  isCancelled = false
): Promise<void> {
  assertBalanced(rows)
  for (const r of rows) {
    const debit = r2(r.debit ?? 0)
    const credit = r2(r.credit ?? 0)
    if (debit === 0 && credit === 0) continue
    const meta = ACCOUNTS[r.account]
    await tx.accountLedger.create({
      data: {
        date: voucher.date,
        account: meta.code,
        accountName: meta.name,
        partyId: r.partyId ?? null,
        debit,
        credit,
        voucherType: voucher.voucherType,
        voucherNo: voucher.voucherNo,
        remarks: r.remarks ?? null,
        isCancelled,
      },
    })
  }
}

/**
 * Cancel path for a voucher: mark its live GL rows cancelled and write
 * mirrored reversal rows (also flagged cancelled). Append-only — nothing deleted.
 */
export async function cancelGlForVoucher(
  tx: Prisma.TransactionClient,
  voucherType: string,
  voucherNo: string,
  reversalDate: Date
): Promise<void> {
  const originals = await tx.accountLedger.findMany({
    where: { voucherType, voucherNo, isCancelled: false },
  })
  if (originals.length === 0) return
  const reversed = originals.map((o) => ({
    account: o.account as AccountCode,
    partyId: o.partyId,
    debit: o.credit,
    credit: o.debit,
    remarks: `Reversal of ${voucherNo}`,
  }))
  await postGl(tx, { date: reversalDate, voucherType, voucherNo }, reversed, true)
  await tx.accountLedger.updateMany({
    where: { voucherType, voucherNo, isCancelled: false },
    data: { isCancelled: true },
  })
}
