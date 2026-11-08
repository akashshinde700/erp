/**
 * ForgeERP — after-sales service calls.
 *
 * OPEN -> ASSIGNED -> RESOLVED -> CLOSED (CANCELLED from OPEN/ASSIGNED).
 * A chargeable call (not under warranty, service charge > 0) is invoiced
 * once, through the normal sales-invoice posting with a service item (no
 * stock movement), and only after it is resolved. A call under warranty can
 * never be invoiced. A warranty claim is checked against a known serial
 * number when one is given.
 */
import { db } from './db'
import { BusinessError } from './accounting'
import { fyCode, r2 } from './erp'
import { tenantCompany } from './tenant'
import { postSalesInvoiceTx } from './services'

export const SERVICE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
/** Response targets (hours) by priority, used for the due time and the overdue flag. */
const SLA_HOURS: Record<(typeof SERVICE_PRIORITIES)[number], number> = { LOW: 120, MEDIUM: 48, HIGH: 24, CRITICAL: 8 }

export interface ServiceCallInput {
  partyId: string
  itemId?: string | null
  serialNo?: string | null
  complaint: string
  priority?: (typeof SERVICE_PRIORITIES)[number]
  underWarranty?: boolean
  createdBy?: string
}

export async function createServiceCall(input: ServiceCallInput) {
  return db.$transaction(async (tx) => {
    const company = await tenantCompany(tx)
    if (!company) throw new BusinessError('Operating company is not configured', 409)
    const party = await tx.party.findFirst({ where: { id: input.partyId, active: true } })
    if (!party || !party.types.split(',').includes('CUSTOMER')) throw new BusinessError('Active customer not found', 404)
    if (input.itemId && !(await tx.item.findFirst({ where: { id: input.itemId } }))) throw new BusinessError('Product not found', 404)
    const serialNo = input.serialNo?.trim() || null
    if (serialNo) {
      const serial = await tx.serialNumber.findFirst({ where: { serialNo, ...(input.itemId ? { itemId: input.itemId } : {}) } })
      if (input.underWarranty && !serial) throw new BusinessError(`Serial ${serialNo} is not one we supplied; a warranty claim needs a known serial number`, 404)
    }
    const date = new Date()
    const priority = input.priority ?? 'MEDIUM'
    const display = `SC-${fyCode(date)}`
    const key = `${company.id}:${display}`
    const counter = await tx.counter.upsert({ where: { key }, create: { key, value: 1 }, update: { value: { increment: 1 } } })
    return tx.serviceCall.create({
      data: {
        companyId: company.id, callNo: `${display}-${String(counter.value).padStart(3, '0')}`, date, partyId: party.id, itemId: input.itemId ?? null, serialNo,
        complaint: input.complaint.trim(), priority, underWarranty: !!input.underWarranty, dueAt: new Date(date.getTime() + SLA_HOURS[priority] * 3600_000), createdBy: input.createdBy,
      },
    })
  })
}

async function load(id: string) {
  const call = await db.serviceCall.findFirst({ where: { id } })
  if (!call) throw new BusinessError('Service call not found', 404)
  return call
}

async function move(id: string, from: string[], data: Record<string, unknown>) {
  const upd = await db.serviceCall.updateMany({ where: { id, status: { in: from } }, data })
  if (upd.count !== 1) {
    const call = await load(id)
    throw new BusinessError(`Service call is ${call.status.toLowerCase()}`, 409)
  }
  return db.serviceCall.findFirst({ where: { id }, include: { assignedTo: { select: { name: true } } } })
}

export async function assignServiceCall(input: { id: string; employeeId: string }) {
  await load(input.id)
  const emp = await db.employee.findFirst({ where: { id: input.employeeId, active: true } })
  if (!emp) throw new BusinessError('Engineer not found or inactive', 404)
  return move(input.id, ['OPEN', 'ASSIGNED'], { status: 'ASSIGNED', assignedToId: emp.id })
}

export async function resolveServiceCall(input: { id: string; resolution: string; serviceCharge?: number }) {
  const call = await load(input.id)
  const charge = r2(input.serviceCharge ?? 0)
  if (charge < 0) throw new BusinessError('Service charge cannot be negative')
  if (call.underWarranty && charge > 0) throw new BusinessError('A call under warranty cannot carry a service charge')
  if (!call.assignedToId) throw new BusinessError('Assign an engineer before resolving the call', 409)
  return move(input.id, ['ASSIGNED'], { status: 'RESOLVED', resolution: input.resolution.trim(), resolvedAt: new Date(), serviceCharge: charge })
}

export async function closeServiceCall(id: string) {
  const call = await load(id)
  if (call.serviceCharge > 0 && !call.salesInvoiceId) throw new BusinessError('Invoice the service charge before closing the call', 409)
  return move(id, ['RESOLVED'], { status: 'CLOSED', closedAt: new Date() })
}

export async function cancelServiceCall(input: { id: string; reason: string }) {
  return move(input.id, ['OPEN', 'ASSIGNED'], { status: 'CANCELLED', cancelReason: input.reason.trim() })
}

/** Raise the sales invoice for a resolved chargeable call (exactly once). */
export async function invoiceServiceCall(input: { id: string; serviceItemId: string }) {
  return db.$transaction(async (tx) => {
    const call = await tx.serviceCall.findFirst({ where: { id: input.id } })
    if (!call) throw new BusinessError('Service call not found', 404)
    if (call.status !== 'RESOLVED' && call.status !== 'CLOSED') throw new BusinessError('Resolve the call before invoicing it', 409)
    if (call.underWarranty) throw new BusinessError('A call under warranty is not invoiced', 409)
    if (!(call.serviceCharge > 0)) throw new BusinessError('This call has no service charge', 409)
    const item = await tx.item.findFirst({ where: { id: input.serviceItemId, active: true } })
    if (!item || !item.isService) throw new BusinessError('Choose an active service item (with its SAC code) for the invoice line', 404)
    // a cancelled invoice frees the call for a corrected one
    if (call.salesInvoiceId) {
      const prev = await tx.salesInvoice.findFirst({ where: { id: call.salesInvoiceId }, select: { status: true, invoiceNo: true } })
      if (prev && prev.status !== 'CANCELLED') throw new BusinessError(`This call is already invoiced (${prev.invoiceNo})`, 409)
    }
    // claim the call first: a second concurrent invoice attempt fails here
    const claim = await tx.serviceCall.updateMany({ where: { id: call.id, salesInvoiceId: call.salesInvoiceId }, data: { salesInvoiceId: 'PENDING' } })
    if (claim.count !== 1) throw new BusinessError('This call is already invoiced', 409)
    const invoice = await postSalesInvoiceTx(tx, {
      partyId: call.partyId, source: 'SERVICE', remarks: `Service call ${call.callNo}`,
      lines: [{ itemId: item.id, detail: `${call.callNo}: ${(call.resolution ?? call.complaint).slice(0, 120)}`, qty: 1, rate: call.serviceCharge }],
    })
    await tx.serviceCall.update({ where: { id: call.id }, data: { salesInvoiceId: invoice.id } })
    return invoice
  })
}

export async function serviceDashboard() {
  const calls = await db.serviceCall.findMany({
    orderBy: [{ date: 'desc' }], take: 500,
    include: { party: { select: { code: true, name: true } }, item: { select: { code: true, name: true } }, assignedTo: { select: { id: true, name: true } } },
  })
  const invoiceIds = calls.map((c) => c.salesInvoiceId).filter((v): v is string => !!v && v !== 'PENDING')
  const invoices = invoiceIds.length ? await db.salesInvoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, invoiceNo: true, grandTotal: true, status: true } }) : []
  const now = new Date()
  const rows = calls.map((c) => ({
    ...c,
    invoice: invoices.find((i) => i.id === c.salesInvoiceId) ?? null,
    overdue: ['OPEN', 'ASSIGNED'].includes(c.status) && !!c.dueAt && c.dueAt < now,
    resolutionHours: c.resolvedAt ? r2((c.resolvedAt.getTime() - c.date.getTime()) / 3600_000) : null,
  }))
  const resolved = rows.filter((r) => r.resolutionHours !== null)
  return {
    calls: rows,
    open: rows.filter((r) => r.status === 'OPEN' || r.status === 'ASSIGNED').length,
    overdue: rows.filter((r) => r.overdue).length,
    toInvoice: rows.filter((r) => (r.status === 'RESOLVED' || r.status === 'CLOSED') && r.serviceCharge > 0 && !r.salesInvoiceId).length,
    avgResolutionHours: resolved.length ? r2(resolved.reduce((s, r) => s + (r.resolutionHours ?? 0), 0) / resolved.length) : null,
  }
}
