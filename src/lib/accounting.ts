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
  const display = `${prefix}-${fyCode(date)}`
  const company = await tenantCompany(tx)
  if (!company) throw new BusinessError('Company profile is not set up yet', 409)
  const key = `${company.id}:${display}` // one series per organisation, shared by direct and controlled invoices
  const counter = await tx.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } })
  return `${display}-${String(counter.value).padStart(3, '0')}`
}
import { r2 } from './erp'
import { tenantCompany } from './tenant'

export const ACCOUNTS = {
  DEBT: { code: 'DEBT', name: 'Sundry Debtors', group: 'Current Assets' },
  CRED: { code: 'CRED', name: 'Sundry Creditors', group: 'Current Liabilities' },
  STKV: { code: 'STKV', name: 'Stock (Inventory) Account', group: 'Current Assets' },
  WIP: { code: 'WIP', name: 'Manufacturing Work in Progress', group: 'Current Assets' },
  LABP: { code: 'LABP', name: 'Labour Cost Payable / Absorbed', group: 'Current Liabilities' },
  MFGV: { code: 'MFGV', name: 'Manufacturing Cost Variance', group: 'Direct Expenses' },
  // Absorbed factory overhead. A liability because it is an ACCRUAL: WIP is
  // debited and this account credited when an operation completes, and the
  // credit is reversed (contram) once an accountant books the real overhead
  // spend. Nothing is ever paid from it, so it must not be treated as cash.
  OVHA: { code: 'OVHA', name: 'Factory Overhead Absorbed', group: 'Current Liabilities' },
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
  TDSP: { code: 'TDSP', name: 'TDS Payable', group: 'Duties & Taxes' },
  TDSR: { code: 'TDSR', name: 'TDS Receivable', group: 'Current Assets' },
  STADJ: { code: 'STADJ', name: 'Stock Adjustment (Shortage / Excess)', group: 'Indirect Income / Expenses' },
} as const

export type AccountCode = keyof typeof ACCOUNTS

export interface GlRowInput {
  /** A system account code, or an organisation ledger code (LedgerAccount) together with its accountName. */
  account: AccountCode | (string & {})
  accountName?: string
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
  await assertPeriodOpen(tx, voucher.date)
  for (const r of rows) {
    const debit = r2(r.debit ?? 0)
    const credit = r2(r.credit ?? 0)
    if (debit === 0 && credit === 0) continue
    const meta = (ACCOUNTS as Record<string, { code: string; name: string }>)[r.account]
    const accountName = meta?.name ?? r.accountName
    if (!accountName) throw new BusinessError(`Unknown ledger account ${r.account}`)
    await tx.accountLedger.create({
      data: {
        date: voucher.date,
        account: meta?.code ?? r.account,
        accountName,
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
  const lock = await booksLock(tx)
  const earliest = originals.reduce((d, o) => (o.date < d ? o.date : d), originals[0].date)
  if (lock && earliest <= lock) {
    throw new BusinessError(`Books are locked up to ${lock.toISOString().slice(0, 10)}: ${voucherNo} is in a closed period and cannot be cancelled. Post a correcting journal in the open period instead.`, 409)
  }
  const reversed = originals.map((o) => ({
    account: o.account,
    accountName: o.accountName,
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

/** The organisation's books-lock date (end of the last closed period), or null. */
export async function booksLock(tx: Prisma.TransactionClient): Promise<Date | null> {
  const company = await tenantCompany(tx)
  return company?.booksLockedUntil ?? null
}

/** Refuse any posting dated on or before the books-lock date. */
export async function assertPeriodOpen(tx: Prisma.TransactionClient, date: Date): Promise<void> {
  const lock = await booksLock(tx)
  if (lock && date <= lock) {
    throw new BusinessError(`Books are locked up to ${lock.toISOString().slice(0, 10)}: post this in the open period (after the lock date)`, 409)
  }
}
