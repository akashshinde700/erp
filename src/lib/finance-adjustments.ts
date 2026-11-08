import { Prisma } from '@prisma/client'
import { db } from './db'
import { AccountCode, BusinessError, cancelGlForVoucher, postGl } from './accounting'
import { EPS, fyCode, r2 } from './erp'
import { tenantCompany } from './tenant'

type Tx = Prisma.TransactionClient
async function org(tx: Tx) { const row = await tenantCompany(tx); if (!row) throw new BusinessError('Operating company is not configured', 409); return row }
async function nextPaymentNo(tx: Tx, companyId: string, type: 'REFUND' | 'SUPPLIER_REFUND', date: Date) { const prefix = type === 'REFUND' ? 'RFN' : 'SRF'; const display = `${prefix}-${fyCode(date)}`; const row = await tx.counter.upsert({ where: { key: `${companyId}:${display}` }, create: { key: `${companyId}:${display}`, value: 1 }, update: { value: { increment: 1 } } }); return `${display}-${String(row.value).padStart(3, '0')}` }
const advanceStatus = (applied: number, original: number) => (applied <= EPS ? 'OPEN' : applied + EPS >= original ? 'APPLIED' : 'PART_APPLIED')

export async function setPaymentSchedule(input: { salesOrderId: string; rows: { milestone: string; dueDate: Date; amount: number }[] }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const order = await tx.salesOrder.findFirst({ where: { id: input.salesOrderId, companyId: company.id } })
    if (!order) throw new BusinessError('Sales order not found', 404)
    if (!['DRAFT', 'APPROVED'].includes(order.status)) throw new BusinessError('Payment schedule can only change before dispatch')
    if (!input.rows.length) throw new BusinessError('At least one payment milestone is required')
    if (new Set(input.rows.map((row) => row.milestone.trim().toLowerCase())).size !== input.rows.length) throw new BusinessError('Payment milestone names must be unique')
    const total = r2(input.rows.reduce((sum, row) => sum + row.amount, 0))
    if (input.rows.some((row) => !row.milestone.trim() || !(row.amount > 0))) throw new BusinessError('Every milestone needs a name and positive amount')
    if (Math.abs(total - order.grandTotal) > 0.01) throw new BusinessError(`Schedule total ${total} must equal sales order total ${order.grandTotal}`)
    const existingPaid = await tx.paymentSchedule.count({ where: { salesOrderId: order.id, paidAmount: { gt: EPS } } }); if (existingPaid) throw new BusinessError('A schedule with collected amounts cannot be replaced')
    await tx.paymentSchedule.deleteMany({ where: { salesOrderId: order.id } })
    await tx.paymentSchedule.createMany({ data: input.rows.map((row) => ({ companyId: company.id, salesOrderId: order.id, partyId: order.partyId, milestone: row.milestone.trim(), dueDate: row.dueDate, amount: r2(row.amount) })) })
    return tx.paymentSchedule.findMany({ where: { salesOrderId: order.id }, orderBy: { dueDate: 'asc' } })
  })
}

/**
 * Apply an unallocated advance to an invoice. Both balances move through
 * conditional UPDATEs (InnoDB re-reads the latest committed row for an UPDATE),
 * so two concurrent applications can never over-apply the advance or overpay
 * the invoice: the loser matches zero rows and gets a 409.
 */
export async function applyAdvance(input: { advanceId: string; invoiceType: 'SALES' | 'PURCHASE'; invoiceNo: string; amount: number }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const advance = await tx.partyAdvance.findFirst({ where: { id: input.advanceId, companyId: company.id, status: { in: ['OPEN', 'PART_APPLIED'] } } })
    if (!advance) throw new BusinessError('Open party advance not found', 404)
    const amount = r2(input.amount)
    if (!(amount > 0) || advance.appliedAmount + amount > advance.originalAmount + EPS) throw new BusinessError(`Advance available is ${r2(advance.originalAmount - advance.appliedAmount)}`)
    const expected = advance.advanceType === 'CUSTOMER' ? 'SALES' : 'PURCHASE'; if (input.invoiceType !== expected) throw new BusinessError(`${advance.advanceType.toLowerCase()} advance cannot settle a ${input.invoiceType.toLowerCase()} invoice`)
    const invoice = input.invoiceType === 'SALES' ? await tx.salesInvoice.findFirst({ where: { invoiceNo: input.invoiceNo } }) : await tx.purchaseInvoice.findFirst({ where: { invoiceNo: input.invoiceNo } })
    if (!invoice || invoice.partyId !== advance.partyId || invoice.status !== 'POSTED') throw new BusinessError('Active invoice for this advance party not found', 404)
    const outstanding = r2(invoice.grandTotal - invoice.paidAmount); if (amount > outstanding + EPS) throw new BusinessError(`Invoice outstanding is only ${outstanding}`)
    const advanceRows = await tx.partyAdvance.updateMany({
      where: { id: advance.id, status: { in: ['OPEN', 'PART_APPLIED'] }, appliedAmount: { lte: r2(advance.originalAmount - amount) + EPS } },
      data: { appliedAmount: { increment: amount } },
    })
    if (advanceRows.count !== 1) throw new BusinessError('This advance was applied by another user at the same time — refresh and retry', 409)
    const invoiceWhere = { id: invoice.id, status: 'POSTED', paidAmount: { lte: r2(invoice.grandTotal - amount) + EPS } }
    const invoiceRows = input.invoiceType === 'SALES'
      ? await tx.salesInvoice.updateMany({ where: invoiceWhere, data: { paidAmount: { increment: amount } } })
      : await tx.purchaseInvoice.updateMany({ where: invoiceWhere, data: { paidAmount: { increment: amount } } })
    if (invoiceRows.count !== 1) throw new BusinessError('The invoice was paid by another user at the same time — refresh and retry', 409)
    await tx.paymentAllocation.create({ data: { paymentId: advance.paymentId, invoiceType: input.invoiceType, invoiceId: invoice.id, invoiceNo: input.invoiceNo, amount, kind: 'ADVANCE_APPLICATION' } })
    const fresh = await tx.partyAdvance.findUniqueOrThrow({ where: { id: advance.id } })
    return tx.partyAdvance.update({ where: { id: advance.id }, data: { status: advanceStatus(fresh.appliedAmount, fresh.originalAmount) } })
  })
}

/**
 * Undo one advance application (append-only: the allocation row stays, marked
 * reversed with who/why). Restores the invoice outstanding and the available
 * advance. Only applications made through applyAdvance can be reversed.
 */
export async function reverseAdvanceApplication(input: { allocationId: string; reason: string }) {
  if (!input.reason?.trim()) throw new BusinessError('A reason is required to reverse an advance application')
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const allocation = await tx.paymentAllocation.findUnique({ where: { id: input.allocationId }, include: { payment: { include: { advances: true } } } })
    const advance = allocation?.payment.advances.find((row) => row.companyId === company.id)
    if (!allocation || allocation.kind !== 'ADVANCE_APPLICATION' || !advance) throw new BusinessError('Advance application not found', 404)
    if (allocation.reversedAt) throw new BusinessError('This advance application is already reversed', 409)
    if (allocation.payment.status !== 'POSTED') throw new BusinessError('The advance payment is cancelled', 409)
    const marked = await tx.paymentAllocation.updateMany({ where: { id: allocation.id, reversedAt: null }, data: { reversedAt: new Date(), reversalReason: input.reason.trim() } })
    if (marked.count !== 1) throw new BusinessError('This advance application is already reversed', 409)
    const invoiceWhere = { invoiceNo: allocation.invoiceNo, paidAmount: { gte: r2(allocation.amount) - EPS } }
    const invoiceRows = allocation.invoiceType === 'SALES'
      ? await tx.salesInvoice.updateMany({ where: invoiceWhere, data: { paidAmount: { decrement: allocation.amount } } })
      : await tx.purchaseInvoice.updateMany({ where: invoiceWhere, data: { paidAmount: { decrement: allocation.amount } } })
    if (invoiceRows.count !== 1) throw new BusinessError('Invoice paid amount is inconsistent with this application — reversal stopped', 409)
    const updated = await tx.partyAdvance.update({ where: { id: advance.id }, data: { appliedAmount: { decrement: allocation.amount } } })
    if (updated.appliedAmount < -EPS) throw new BusinessError('Advance applied amount would become negative — reversal stopped', 409)
    await tx.partyAdvance.update({ where: { id: advance.id }, data: { status: advanceStatus(updated.appliedAmount, updated.originalAmount) } })
    await tx.auditLog.create({ data: { action: 'REVERSE', entity: 'PaymentAllocation', entityId: allocation.id, details: `Advance ${allocation.payment.paymentNo} application of ${allocation.amount} to ${allocation.invoiceNo} reversed: ${input.reason.trim()}` } })
    return { allocationId: allocation.id, invoiceNo: allocation.invoiceNo, amount: allocation.amount, advanceAvailable: r2(updated.originalAmount - updated.appliedAmount) }
  })
}

/**
 * Refund a posted credit/debit note. ReturnDocument.refundedAmount is raised by a
 * conditional UPDATE, so concurrent refunds can never exceed the note value.
 */
export async function refundReturn(input: { returnDocumentId: string; amount: number; mode: 'CASH' | 'BANK' | 'UPI' | 'CHEQUE'; refNo?: string; notes?: string }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const doc = await tx.returnDocument.findFirst({ where: { id: input.returnDocumentId, companyId: company.id, status: 'POSTED' } })
    if (!doc) throw new BusinessError('Posted return document not found', 404)
    const amount = r2(input.amount)
    if (!(amount > 0) || doc.refundedAmount + amount > doc.grandTotal + EPS) throw new BusinessError(`Refundable amount is ${r2(doc.grandTotal - doc.refundedAmount)}`)
    const reserved = await tx.returnDocument.updateMany({ where: { id: doc.id, status: 'POSTED', refundedAmount: { lte: r2(doc.grandTotal - amount) + EPS } }, data: { refundedAmount: { increment: amount } } })
    if (reserved.count !== 1) {
      const fresh = await tx.returnDocument.findUnique({ where: { id: doc.id } })
      throw new BusinessError(`Refundable amount is ${r2((fresh?.grandTotal ?? 0) - (fresh?.refundedAmount ?? 0))} (another refund was just posted)`, 409)
    }
    const date = new Date(), customerRefund = doc.returnType === 'SALES_RETURN', paymentNo = await nextPaymentNo(tx, company.id, customerRefund ? 'REFUND' : 'SUPPLIER_REFUND', date)
    const payment = await tx.payment.create({ data: { paymentNo, date, type: customerRefund ? 'PAYMENT' : 'RECEIPT', partyId: doc.partyId, amount, mode: input.mode, refNo: input.refNo, notes: input.notes ?? `${doc.adjustmentNo} refund` } })
    await tx.refundAllocation.create({ data: { companyId: company.id, returnDocumentId: doc.id, paymentId: payment.id, amount } })
    const cash: AccountCode = input.mode === 'CASH' ? 'CASH' : 'BANK'
    const gl: Parameters<typeof postGl>[2] = customerRefund
      ? [{ account: 'DEBT', partyId: doc.partyId, debit: amount, remarks: `Refund ${doc.adjustmentNo}` }, { account: cash, credit: amount }]
      : [{ account: cash, debit: amount }, { account: 'CRED', partyId: doc.partyId, credit: amount, remarks: `Supplier refund ${doc.adjustmentNo}` }]
    await postGl(tx, { date, voucherType: 'REFUND', voucherNo: paymentNo }, gl)
    return payment
  })
}

/** Cancel a refund payment: mirrored GL reversal, refundable balance restored. */
export async function cancelRefund(input: { paymentId: string; reason: string }) {
  if (!input.reason?.trim()) throw new BusinessError('A reason is required to cancel a refund')
  return db.$transaction(async (tx) => {
    const company = await org(tx)
    const refund = await tx.refundAllocation.findFirst({ where: { paymentId: input.paymentId, companyId: company.id }, include: { payment: true, returnDocument: true } })
    if (!refund) throw new BusinessError('Refund not found', 404)
    const marked = await tx.payment.updateMany({ where: { id: refund.paymentId, status: 'POSTED' }, data: { status: 'CANCELLED' } })
    if (marked.count !== 1) throw new BusinessError('This refund is already cancelled', 409)
    const released = await tx.returnDocument.updateMany({ where: { id: refund.returnDocumentId, refundedAmount: { gte: r2(refund.amount) - EPS } }, data: { refundedAmount: { decrement: refund.amount } } })
    if (released.count !== 1) throw new BusinessError('Refund balance on the return document is inconsistent — cancellation stopped', 409)
    await cancelGlForVoucher(tx, 'REFUND', refund.payment.paymentNo, new Date())
    await tx.auditLog.create({ data: { action: 'CANCEL', entity: 'Refund', entityId: refund.paymentId, details: `${refund.payment.paymentNo} (${refund.amount}) against ${refund.returnDocument.adjustmentNo} cancelled: ${input.reason.trim()}` } })
    return { paymentNo: refund.payment.paymentNo, amount: refund.amount, adjustmentNo: refund.returnDocument.adjustmentNo }
  })
}

export async function financeAdjustmentsDashboard() {
  const company = await tenantCompany(db); if (!company) throw new BusinessError('Operating company is not configured', 409)
  const now = new Date()
  await db.paymentSchedule.updateMany({ where: { companyId: company.id, status: { in: ['PENDING', 'PART_PAID'] }, dueDate: { lt: now } }, data: { status: 'OVERDUE' } })
  const [schedules, advances, refunds] = await Promise.all([
    db.paymentSchedule.findMany({ where: { companyId: company.id }, orderBy: { dueDate: 'asc' }, include: { party: true, salesOrder: true } }),
    db.partyAdvance.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'desc' }, include: { party: true, payment: { include: { allocations: { where: { kind: 'ADVANCE_APPLICATION' } } } } } }),
    db.refundAllocation.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'desc' }, include: { returnDocument: true, payment: true } }),
  ])
  return { schedules, advances, refunds }
}
