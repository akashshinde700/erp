import { Prisma } from '@prisma/client'
import { db } from './db'
import { AccountCode, BusinessError, postGl } from './accounting'
import { EPS, fyCode, r2 } from './erp'

type Tx = Prisma.TransactionClient
async function org(tx: Tx) { const row = await tx.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } }); if (!row) throw new BusinessError('Operating company is not configured', 409); return row }
async function nextPaymentNo(tx: Tx, companyId: string, type: 'REFUND' | 'SUPPLIER_REFUND', date: Date) { const prefix = type === 'REFUND' ? 'RFN' : 'SRF'; const display = `${prefix}-${fyCode(date)}`; const row = await tx.counter.upsert({ where: { key: `${companyId}:${display}` }, create: { key: `${companyId}:${display}`, value: 1 }, update: { value: { increment: 1 } } }); return `${display}-${String(row.value).padStart(3, '0')}` }

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

export async function applyAdvance(input: { advanceId: string; invoiceType: 'SALES' | 'PURCHASE'; invoiceNo: string; amount: number }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const advance = await tx.partyAdvance.findFirst({ where: { id: input.advanceId, companyId: company.id, status: { in: ['OPEN', 'PART_APPLIED'] } } })
    if (!advance) throw new BusinessError('Open party advance not found', 404)
    if (!(input.amount > 0) || advance.appliedAmount + input.amount > advance.originalAmount + EPS) throw new BusinessError(`Advance available is ${r2(advance.originalAmount - advance.appliedAmount)}`)
    const expected = advance.advanceType === 'CUSTOMER' ? 'SALES' : 'PURCHASE'; if (input.invoiceType !== expected) throw new BusinessError(`${advance.advanceType.toLowerCase()} advance cannot settle a ${input.invoiceType.toLowerCase()} invoice`)
    const invoice = input.invoiceType === 'SALES' ? await tx.salesInvoice.findUnique({ where: { invoiceNo: input.invoiceNo } }) : await tx.purchaseInvoice.findUnique({ where: { invoiceNo: input.invoiceNo } })
    if (!invoice || invoice.partyId !== advance.partyId || invoice.status !== 'POSTED') throw new BusinessError('Active invoice for this advance party not found', 404)
    const outstanding = r2(invoice.grandTotal - invoice.paidAmount); if (input.amount > outstanding + EPS) throw new BusinessError(`Invoice outstanding is only ${outstanding}`)
    if (input.invoiceType === 'SALES') await tx.salesInvoice.update({ where: { id: invoice.id }, data: { paidAmount: { increment: input.amount } } }); else await tx.purchaseInvoice.update({ where: { id: invoice.id }, data: { paidAmount: { increment: input.amount } } })
    await tx.paymentAllocation.create({ data: { paymentId: advance.paymentId, invoiceType: input.invoiceType, invoiceId: invoice.id, invoiceNo: input.invoiceNo, amount: r2(input.amount) } })
    const applied = r2(advance.appliedAmount + input.amount)
    return tx.partyAdvance.update({ where: { id: advance.id }, data: { appliedAmount: applied, status: applied + EPS >= advance.originalAmount ? 'APPLIED' : 'PART_APPLIED' } })
  })
}

export async function refundReturn(input: { returnDocumentId: string; amount: number; mode: 'CASH' | 'BANK' | 'UPI' | 'CHEQUE'; refNo?: string; notes?: string }) {
  return db.$transaction(async (tx) => {
    const company = await org(tx); const doc = await tx.returnDocument.findFirst({ where: { id: input.returnDocumentId, companyId: company.id, status: 'POSTED' }, include: { refunds: { include: { payment: true } } } })
    if (!doc) throw new BusinessError('Posted return document not found', 404)
    const refunded = r2(doc.refunds.filter((row) => row.payment.status === 'POSTED').reduce((sum, row) => sum + row.amount, 0))
    if (!(input.amount > 0) || refunded + input.amount > doc.grandTotal + EPS) throw new BusinessError(`Refundable amount is ${r2(doc.grandTotal - refunded)}`)
    const date = new Date(), customerRefund = doc.returnType === 'SALES_RETURN', paymentNo = await nextPaymentNo(tx, company.id, customerRefund ? 'REFUND' : 'SUPPLIER_REFUND', date)
    const payment = await tx.payment.create({ data: { paymentNo, date, type: customerRefund ? 'PAYMENT' : 'RECEIPT', partyId: doc.partyId, amount: r2(input.amount), mode: input.mode, refNo: input.refNo, notes: input.notes ?? `${doc.adjustmentNo} refund` } })
    await tx.refundAllocation.create({ data: { companyId: company.id, returnDocumentId: doc.id, paymentId: payment.id, amount: r2(input.amount) } })
    const cash: AccountCode = input.mode === 'CASH' ? 'CASH' : 'BANK'
    const gl: Parameters<typeof postGl>[2] = customerRefund
      ? [{ account: 'DEBT', partyId: doc.partyId, debit: input.amount, remarks: `Refund ${doc.adjustmentNo}` }, { account: cash, credit: input.amount }]
      : [{ account: cash, debit: input.amount }, { account: 'CRED', partyId: doc.partyId, credit: input.amount, remarks: `Supplier refund ${doc.adjustmentNo}` }]
    await postGl(tx, { date, voucherType: 'REFUND', voucherNo: paymentNo }, gl)
    return payment
  })
}

export async function financeAdjustmentsDashboard() {
  const company = await db.company.findFirst({ where: { isPlatform: false }, orderBy: { createdAt: 'asc' } }); if (!company) throw new BusinessError('Operating company is not configured', 409)
  const now = new Date()
  await db.paymentSchedule.updateMany({ where: { companyId: company.id, status: { in: ['PENDING', 'PART_PAID'] }, dueDate: { lt: now } }, data: { status: 'OVERDUE' } })
  const [schedules, advances, refunds] = await Promise.all([
    db.paymentSchedule.findMany({ where: { companyId: company.id }, orderBy: { dueDate: 'asc' }, include: { party: true, salesOrder: true } }),
    db.partyAdvance.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'desc' }, include: { party: true, payment: true } }),
    db.refundAllocation.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'desc' }, include: { returnDocument: true, payment: true } }),
  ])
  return { schedules, advances, refunds }
}
