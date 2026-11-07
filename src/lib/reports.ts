/**
 * ForgeERP — Report computations (W6).
 * All reports derive from the append-only ledgers with isCancelled = false,
 * so report ≡ print ≡ invoice by construction (shared engine totals).
 */
import { db } from './db'
import { r2 } from './erp'

// ---------- shared UTC day-range helper ----------

/** Voucher dates arrive as date-only strings and are STORED at UTC midnight
 *  (`new Date('YYYY-MM-DD')`). Every report filter therefore must use UTC day
 *  boundaries too — local-time bounds (T23:59:59 without Z) shift by the
 *  server's offset and include/exclude wrong days on non-UTC hosts. */
const utcDayStart = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`)
const utcDayEnd = (ymd: string): Date => new Date(`${ymd}T23:59:59.999Z`)

// ---------- Stock ledger with running balance ----------

export async function stockLedgerReport(filter: {
  itemId?: string
  warehouseId?: string
  from?: string
  to?: string
}) {
  const where: any = { isCancelled: false }
  if (filter.itemId) where.itemId = filter.itemId
  if (filter.warehouseId) where.warehouseId = filter.warehouseId
  if (filter.from || filter.to) {
    where.postingDate = {}
    if (filter.from) where.postingDate.gte = utcDayStart(filter.from)
    if (filter.to) where.postingDate.lte = utcDayEnd(filter.to)
  }
  const rows = await db.stockLedger.findMany({
    where,
    orderBy: [{ postingDate: 'asc' }, { createdAt: 'asc' }],
    include: { item: true, warehouse: true },
  })
  let bal = 0
  let value = 0
  const out = rows.map((r) => {
    bal = r2(bal + r.qtyIn - r.qtyOut)
    const avg = bal > 0 ? r2(r.rate) : 0
    value = r2(value + (r.qtyIn - r.qtyOut) * r.rate)
    return { ...r, balance: bal, value: r2(Math.max(0, value)) , avgCost: avg }
  })
  return out
}

// ---------- Stock summary ----------

export async function stockSummaryReport() {
  const items = await db.item.findMany({ where: { isStockItem: true }, orderBy: { code: 'asc' } })
  const warehouses = await db.warehouse.findMany({ orderBy: { code: 'asc' } })
  const whCode = new Map(warehouses.map((w) => [w.id, w.code]))
  // OWN stock only: JOBWORK_IN rows carry customer-owned material at rate 0.
  // Including them (a) inflates closing quantities with stock we do not own,
  // (b) dilutes avgCost toward 0 and distorts closingValue/lowStock. JW
  // movements remain fully visible in the stock LEDGER report.
  const led = await db.stockLedger.findMany({
    where: { isCancelled: false, voucherType: { not: 'JOBWORK_IN' } },
  })
  const byItem = new Map<
    string,
    { inQty: number; outQty: number; inValue: number; byWh: Map<string, number> }
  >()
  for (const l of led) {
    const prev = byItem.get(l.itemId) ?? { inQty: 0, outQty: 0, inValue: 0, byWh: new Map<string, number>() }
    byItem.set(l.itemId, {
      inQty: r2(prev.inQty + l.qtyIn),
      outQty: r2(prev.outQty + l.qtyOut),
      inValue: r2(prev.inValue + l.qtyIn * l.rate),
      byWh: prev.byWh.set(l.warehouseId, r2((prev.byWh.get(l.warehouseId) ?? 0) + l.qtyIn - l.qtyOut)),
    })
  }
  return items.map((it) => {
    const s = byItem.get(it.id) ?? { inQty: 0, outQty: 0, inValue: 0, byWh: new Map<string, number>() }
    const closing = r2(s.inQty - s.outQty)
    const avgCost = s.inQty > 0 ? r2(s.inValue / s.inQty) : 0
    return {
      item: { id: it.id, code: it.code, name: it.name, uom: it.uom, reorderLevel: it.reorderLevel, hsn: it.hsn },
      inQty: s.inQty,
      outQty: s.outQty,
      closing,
      avgCost,
      closingValue: r2(closing * avgCost),
      lowStock: it.reorderLevel > 0 && closing < it.reorderLevel,
      // Per-warehouse closing split — sales guards check the chosen warehouse,
      // so the summary must show where stock actually lives (JW material is
      // customer-owned and not sellable from MAIN).
      warehouses: [...s.byWh.entries()]
        .map(([id, qty]) => ({ code: whCode.get(id) ?? id, closing: qty }))
        .filter((w) => Math.abs(w.closing) > 0.0001)
        .sort((a, b) => a.code.localeCompare(b.code)),
    }
  })
}

// ---------- Inventory planning: ageing + reorder suggestions ----------

/**
 * Practical stores/planning view from Absolute ERP + Vyapar research.
 * Company-owned stock only: customer JOBWORK_IN material must never satisfy a
 * reorder requirement. Suggestions are advisory (reorder level − closing),
 * not dummy purchase orders and do not mutate stock or books.
 */
export async function inventoryPlanningReport(asOf = new Date()) {
  const [summary, movements] = await Promise.all([
    stockSummaryReport(),
    db.stockLedger.findMany({
      where: { isCancelled: false, voucherType: { not: 'JOBWORK_IN' } },
      orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }],
      select: { itemId: true, postingDate: true, voucherType: true, voucherNo: true },
    }),
  ])
  const latest = new Map<string, { date: Date; voucherType: string; voucherNo: string }>()
  for (const movement of movements) {
    if (!latest.has(movement.itemId)) {
      latest.set(movement.itemId, { date: movement.postingDate, voucherType: movement.voucherType, voucherNo: movement.voucherNo })
    }
  }
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())
  const rows = summary.map((row) => {
    const last = latest.get(row.item.id)
    const lastDay = last ? Date.UTC(last.date.getUTCFullYear(), last.date.getUTCMonth(), last.date.getUTCDate()) : null
    const inactiveDays = lastDay === null ? null : Math.max(0, Math.floor((asOfDay - lastDay) / 86_400_000))
    const ageingClass = inactiveDays === null ? 'NO_MOVEMENT' : inactiveDays > 180 ? 'DEAD' : inactiveDays > 90 ? 'SLOW' : 'ACTIVE'
    const suggestedOrderQty = row.item.reorderLevel > 0
      ? r2(Math.max(0, row.item.reorderLevel - row.closing))
      : 0
    return {
      ...row,
      lastMovementAt: last?.date ?? null,
      lastVoucherType: last?.voucherType ?? null,
      lastVoucherNo: last?.voucherNo ?? null,
      inactiveDays,
      ageingClass,
      suggestedOrderQty,
    }
  })
  rows.sort((a, b) =>
    (b.suggestedOrderQty - a.suggestedOrderQty) ||
    ((b.inactiveDays ?? Number.MAX_SAFE_INTEGER) - (a.inactiveDays ?? Number.MAX_SAFE_INTEGER)) ||
    a.item.code.localeCompare(b.item.code)
  )
  return {
    asOf,
    rows,
    summary: {
      itemCount: rows.length,
      reorderItems: rows.filter((r) => r.suggestedOrderQty > 0).length,
      deadItems: rows.filter((r) => r.ageingClass === 'DEAD' || r.ageingClass === 'NO_MOVEMENT').length,
      slowItems: rows.filter((r) => r.ageingClass === 'SLOW').length,
      stockValue: r2(rows.reduce((sum, r) => sum + r.closingValue, 0)),
    },
  }
}

// ---------- Supplier purchase performance ----------

/**
 * Vendor analysis from posted/cancelled purchase documents. This deliberately
 * does not invent on-time/QC scores: those require the future PO→GRN→QC chain.
 * Current metrics remain fully auditable to purchase invoices and payments.
 */
export async function supplierPerformanceReport() {
  const [suppliers, invoices] = await Promise.all([
    db.party.findMany({ where: { types: { contains: 'SUPPLIER' } }, orderBy: { name: 'asc' } }),
    db.purchaseInvoice.findMany({
      include: { items: { include: { item: { select: { id: true, code: true, name: true, uom: true } } } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
  ])
  const rows = suppliers.map((supplier) => {
    const all = invoices.filter((invoice) => invoice.partyId === supplier.id)
    const posted = all.filter((invoice) => invoice.status === 'POSTED')
    const cancelled = all.filter((invoice) => invoice.status === 'CANCELLED')
    const purchaseValue = r2(posted.reduce((sum, invoice) => sum + invoice.grandTotal, 0))
    const paidValue = r2(posted.reduce((sum, invoice) => sum + invoice.paidAmount, 0))
    const outstanding = r2(Math.max(0, purchaseValue - paidValue))
    const itemMap = new Map<string, { item: { id: string; code: string; name: string; uom: string }; qty: number; taxableValue: number }>()
    for (const invoice of posted) {
      for (const line of invoice.items) {
        const prev = itemMap.get(line.itemId) ?? { item: line.item, qty: 0, taxableValue: 0 }
        prev.qty = r2(prev.qty + line.qty)
        prev.taxableValue = r2(prev.taxableValue + line.taxable)
        itemMap.set(line.itemId, prev)
      }
    }
    const topItems = [...itemMap.values()]
      .map((line) => ({ ...line, avgRate: line.qty > 0 ? r2(line.taxableValue / line.qty) : 0 }))
      .sort((a, b) => b.taxableValue - a.taxableValue)
      .slice(0, 5)
    return {
      supplier: { id: supplier.id, code: supplier.code, name: supplier.name, city: supplier.city, gstin: supplier.gstin, active: supplier.active },
      invoiceCount: posted.length,
      cancelledCount: cancelled.length,
      purchaseValue,
      paidValue,
      outstanding,
      paymentPct: purchaseValue > 0 ? r2((paidValue / purchaseValue) * 100) : 0,
      avgInvoiceValue: posted.length > 0 ? r2(purchaseValue / posted.length) : 0,
      lastPurchaseAt: posted[0]?.date ?? null,
      topItems,
    }
  })
  rows.sort((a, b) => (b.purchaseValue - a.purchaseValue) || a.supplier.name.localeCompare(b.supplier.name))
  return {
    rows,
    summary: {
      supplierCount: rows.length,
      activeSuppliers: rows.filter((row) => row.supplier.active).length,
      suppliersUsed: rows.filter((row) => row.invoiceCount > 0).length,
      totalPurchases: r2(rows.reduce((sum, row) => sum + row.purchaseValue, 0)),
      totalPaid: r2(rows.reduce((sum, row) => sum + row.paidValue, 0)),
      totalOutstanding: r2(rows.reduce((sum, row) => sum + row.outstanding, 0)),
    },
    unavailableUntilProcurementWorkflow: ['onTimeDeliveryPct', 'acceptedQtyPct', 'rejectedQty', 'threeWayMatchStatus'],
  }
}

// ---------- Customer sales performance ----------

/**
 * Customer history and value analysis from posted sales documents. Invoice
 * outstanding is intentionally document-scoped here; the Outstanding report
 * remains the control view that also includes opening balances and advances.
 */
export async function customerPerformanceReport() {
  const [customers, invoices] = await Promise.all([
    db.party.findMany({ where: { types: { contains: 'CUSTOMER' } }, orderBy: { name: 'asc' } }),
    db.salesInvoice.findMany({
      include: { items: { include: { item: { select: { id: true, code: true, name: true, uom: true } } } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }),
  ])
  const rows = customers.map((customer) => {
    const all = invoices.filter((invoice) => invoice.partyId === customer.id)
    const posted = all.filter((invoice) => invoice.status === 'POSTED')
    const cancelled = all.filter((invoice) => invoice.status === 'CANCELLED')
    const salesValue = r2(posted.reduce((sum, invoice) => sum + invoice.grandTotal, 0))
    const receivedValue = r2(posted.reduce((sum, invoice) => sum + invoice.paidAmount, 0))
    const invoiceOutstanding = r2(Math.max(0, salesValue - receivedValue))
    const jobworkValue = r2(posted.filter((invoice) => invoice.source === 'JOBWORK').reduce((sum, invoice) => sum + invoice.grandTotal, 0))
    const itemMap = new Map<string, { item: { id: string; code: string; name: string; uom: string }; qty: number; taxableValue: number }>()
    for (const invoice of posted) {
      for (const line of invoice.items) {
        const prev = itemMap.get(line.itemId) ?? { item: line.item, qty: 0, taxableValue: 0 }
        prev.qty = r2(prev.qty + line.qty)
        prev.taxableValue = r2(prev.taxableValue + line.taxable)
        itemMap.set(line.itemId, prev)
      }
    }
    const topItems = [...itemMap.values()]
      .map((line) => ({ ...line, avgRate: line.qty > 0 ? r2(line.taxableValue / line.qty) : 0 }))
      .sort((a, b) => b.taxableValue - a.taxableValue)
      .slice(0, 5)
    return {
      customer: { id: customer.id, code: customer.code, name: customer.name, city: customer.city, gstin: customer.gstin, active: customer.active },
      invoiceCount: posted.length,
      cancelledCount: cancelled.length,
      salesValue,
      receivedValue,
      invoiceOutstanding,
      collectionPct: salesValue > 0 ? r2((receivedValue / salesValue) * 100) : 0,
      avgInvoiceValue: posted.length > 0 ? r2(salesValue / posted.length) : 0,
      jobworkValue,
      jobworkSharePct: salesValue > 0 ? r2((jobworkValue / salesValue) * 100) : 0,
      lastSaleAt: posted[0]?.date ?? null,
      topItems,
    }
  })
  rows.sort((a, b) => (b.salesValue - a.salesValue) || a.customer.name.localeCompare(b.customer.name))
  return {
    rows,
    summary: {
      customerCount: rows.length,
      activeCustomers: rows.filter((row) => row.customer.active).length,
      customersServed: rows.filter((row) => row.invoiceCount > 0).length,
      totalSales: r2(rows.reduce((sum, row) => sum + row.salesValue, 0)),
      totalReceived: r2(rows.reduce((sum, row) => sum + row.receivedValue, 0)),
      invoiceOutstanding: r2(rows.reduce((sum, row) => sum + row.invoiceOutstanding, 0)),
      jobworkSales: r2(rows.reduce((sum, row) => sum + row.jobworkValue, 0)),
    },
    note: 'Invoice outstanding excludes opening balances and unallocated advances; use Outstanding for the party control balance.',
  }
}

// ---------- Production cost, variance and project profitability ----------

/**
 * Expected-vs-actual manufacturing analysis from approved BOM estimates and
 * completed/active production-task postings. No synthetic overhead is added:
 * actual cost is the labour + material cost already frozen on each task.
 */
export async function productionCostVarianceReport() {
  const projects = await db.project.findMany({
    where: { status: { not: 'CANCELLED' } },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      party: { select: { id: true, code: true, name: true } },
      boms: { where: { status: 'APPROVED' }, include: { items: { select: { estCost: true } } } },
      workOrders: {
        where: { status: { not: 'CANCELLED' } },
        include: {
          bom: { select: { id: true, bomNo: true, productName: true, items: { select: { estCost: true } } } },
          tasks: { where: { status: { not: 'CANCELLED' } }, select: { status: true, plannedQty: true, actualQty: true, rejectionQty: true, labourCost: true, materialCost: true, hours: true } },
        },
      },
    },
  })
  const rows = projects.map((project) => {
    const tasks = project.workOrders.flatMap((wo) => wo.tasks)
    const labourCost = r2(tasks.reduce((sum, task) => sum + task.labourCost, 0))
    const materialCost = r2(tasks.reduce((sum, task) => sum + task.materialCost, 0))
    const actualCost = r2(labourCost + materialCost)
    const expectedCost = r2(project.boms.reduce((sum, bom) => sum + bom.items.reduce((lineSum, item) => lineSum + item.estCost, 0), 0))
    const costVariance = r2(actualCost - expectedCost)
    const actualQty = r2(tasks.reduce((sum, task) => sum + task.actualQty, 0))
    const rejectionQty = r2(tasks.reduce((sum, task) => sum + task.rejectionQty, 0))
    const processedQty = r2(actualQty + rejectionQty)
    const workOrders = project.workOrders.map((wo) => {
      const woLabour = r2(wo.tasks.reduce((sum, task) => sum + task.labourCost, 0))
      const woMaterial = r2(wo.tasks.reduce((sum, task) => sum + task.materialCost, 0))
      const woExpected = r2(wo.bom?.items.reduce((sum, item) => sum + item.estCost, 0) ?? 0)
      return {
        id: wo.id,
        woNo: wo.woNo,
        status: wo.status,
        bomNo: wo.bom?.bomNo ?? null,
        productName: wo.bom?.productName ?? null,
        expectedCost: woExpected,
        labourCost: woLabour,
        materialCost: woMaterial,
        actualCost: r2(woLabour + woMaterial),
        variance: r2(woLabour + woMaterial - woExpected),
        taskTotal: wo.tasks.length,
        taskDone: wo.tasks.filter((task) => task.status === 'COMPLETED').length,
      }
    })
    return {
      project: { id: project.id, projectNo: project.projectNo, name: project.name, status: project.status, party: project.party },
      budget: project.budget,
      expectedCost,
      labourCost,
      materialCost,
      actualCost,
      costVariance,
      variancePct: expectedCost > 0 ? r2((costVariance / expectedCost) * 100) : null,
      projectedMargin: r2(project.budget - actualCost),
      projectedMarginPct: project.budget > 0 ? r2(((project.budget - actualCost) / project.budget) * 100) : null,
      productionHours: r2(tasks.reduce((sum, task) => sum + task.hours, 0)),
      rejectionQty,
      rejectionPct: processedQty > 0 ? r2((rejectionQty / processedQty) * 100) : 0,
      taskTotal: tasks.length,
      taskDone: tasks.filter((task) => task.status === 'COMPLETED').length,
      workOrders,
    }
  })
  const expectedCost = r2(rows.reduce((sum, row) => sum + row.expectedCost, 0))
  const actualCost = r2(rows.reduce((sum, row) => sum + row.actualCost, 0))
  const totalBudget = r2(rows.reduce((sum, row) => sum + row.budget, 0))
  return {
    rows,
    summary: {
      projectCount: rows.length,
      runningProjects: rows.filter((row) => row.project.status === 'RUNNING').length,
      totalBudget,
      expectedCost,
      labourCost: r2(rows.reduce((sum, row) => sum + row.labourCost, 0)),
      materialCost: r2(rows.reduce((sum, row) => sum + row.materialCost, 0)),
      actualCost,
      costVariance: r2(actualCost - expectedCost),
      projectedMargin: r2(totalBudget - actualCost),
    },
    note: 'Actual cost includes task material and labour only; WIP/overhead settlement remains a documented gap.',
  }
}

// ---------- Production efficiency: operation / machine / operator ----------

/**
 * Shop-floor efficiency from real production tasks. This is not labelled OEE:
 * availability/downtime loss reasons are not captured yet. It reports only
 * auditable throughput, yield, hours and cost dimensions already posted.
 */
export async function productionEfficiencyReport() {
  const tasks = await db.productionTask.findMany({
    where: { status: { not: 'CANCELLED' } },
    include: {
      employee: { select: { id: true, code: true, name: true } },
      workOrder: { select: { id: true, woNo: true, project: { select: { projectNo: true, name: true } } } },
    },
    orderBy: [{ createdAt: 'desc' }],
  })
  type Bucket = { taskTotal: number; taskDone: number; plannedQty: number; actualQty: number; rejectionQty: number; hours: number; labourCost: number; materialCost: number }
  const empty = (): Bucket => ({ taskTotal: 0, taskDone: 0, plannedQty: 0, actualQty: 0, rejectionQty: 0, hours: 0, labourCost: 0, materialCost: 0 })
  const add = (bucket: Bucket, task: typeof tasks[number]) => {
    bucket.taskTotal += 1
    if (task.status === 'COMPLETED') {
      bucket.taskDone += 1
      bucket.plannedQty = r2(bucket.plannedQty + task.plannedQty)
      bucket.actualQty = r2(bucket.actualQty + task.actualQty)
      bucket.rejectionQty = r2(bucket.rejectionQty + task.rejectionQty)
      bucket.hours = r2(bucket.hours + task.hours)
      bucket.labourCost = r2(bucket.labourCost + task.labourCost)
      bucket.materialCost = r2(bucket.materialCost + task.materialCost)
    }
  }
  const finish = <T extends object>(identity: T, bucket: Bucket) => {
    const processed = r2(bucket.actualQty + bucket.rejectionQty)
    return {
      ...identity,
      ...bucket,
      yieldPct: processed > 0 ? r2((bucket.actualQty / processed) * 100) : 0,
      attainmentPct: bucket.plannedQty > 0 ? r2((bucket.actualQty / bucket.plannedQty) * 100) : 0,
      outputPerHour: bucket.hours > 0 ? r2(bucket.actualQty / bucket.hours) : 0,
      totalCost: r2(bucket.labourCost + bucket.materialCost),
    }
  }

  const operationMap = new Map<string, Bucket>()
  const machineMap = new Map<string, Bucket>()
  const operatorMap = new Map<string, { employee: { id: string; code: string; name: string }; bucket: Bucket }>()
  for (const task of tasks) {
    const operation = operationMap.get(task.operation) ?? empty()
    add(operation, task)
    operationMap.set(task.operation, operation)
    if (task.machineNo) {
      const machine = machineMap.get(task.machineNo) ?? empty()
      add(machine, task)
      machineMap.set(task.machineNo, machine)
    }
    if (task.employee) {
      const operator = operatorMap.get(task.employee.id) ?? { employee: task.employee, bucket: empty() }
      add(operator.bucket, task)
      operatorMap.set(task.employee.id, operator)
    }
  }
  const operations = [...operationMap.entries()].map(([operation, bucket]) => finish({ operation }, bucket)).sort((a, b) => b.hours - a.hours)
  const machines = [...machineMap.entries()].map(([machineNo, bucket]) => finish({ machineNo }, bucket)).sort((a, b) => b.hours - a.hours)
  const operators = [...operatorMap.values()].map(({ employee, bucket }) => finish({ employee }, bucket)).sort((a, b) => b.hours - a.hours)
  const totals = empty()
  for (const task of tasks) add(totals, task)
  return {
    operations,
    machines,
    operators,
    summary: finish({}, totals),
    openTasks: tasks.filter((task) => task.status !== 'COMPLETED').map((task) => ({
      id: task.id,
      taskNo: task.taskNo,
      operation: task.operation,
      status: task.status,
      machineNo: task.machineNo,
      employee: task.employee,
      woNo: task.workOrder.woNo,
      projectNo: task.workOrder.project.projectNo,
      projectName: task.workOrder.project.name,
      dueDate: task.dueDate,
    })),
    note: 'OEE availability and downtime losses require work-center calendars and loss-reason capture; this report does not fabricate them.',
  }
}

// ---------- Cross-module workflow action center ----------

/**
 * Read-only operational action queue. Every item links to an existing source
 * document/state; it does not create fake notifications or duplicate status.
 */
export async function workflowActionCenterReport() {
  const nowDay = new Date().toISOString().slice(0, 10)
  const [inventory, outstanding, tasks, jobwork] = await Promise.all([
    inventoryPlanningReport(),
    outstandingReport(),
    db.productionTask.findMany({
      where: { status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] } },
      include: {
        employee: { select: { id: true, code: true, name: true } },
        workOrder: { select: { woNo: true, project: { select: { projectNo: true, name: true } } } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    }),
    db.jobworkInward.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] } },
      include: {
        party: { select: { name: true } },
        items: { select: { qty: true, processedQty: true } },
        jobCards: { where: { status: 'COMPLETED' }, select: { totalAmount: true } },
        certificates: { where: { status: 'ISSUED' }, select: { certNo: true } },
      },
      orderBy: { date: 'asc' },
    }),
  ])
  const taskActions = tasks.map((task) => {
    const dueDay = task.dueDate?.toISOString().slice(0, 10) ?? null
    const overdue = dueDay !== null && dueDay < nowDay
    return {
      id: task.id,
      taskNo: task.taskNo,
      operation: task.operation,
      status: task.status,
      priority: overdue ? 'CRITICAL' : !task.employee ? 'HIGH' : 'NORMAL',
      reason: overdue ? `Overdue since ${dueDay}` : !task.employee ? 'Worker not assigned' : 'Production task pending',
      dueDate: task.dueDate,
      employee: task.employee,
      woNo: task.workOrder.woNo,
      projectNo: task.workOrder.project.projectNo,
      projectName: task.workOrder.project.name,
    }
  })
  const jobworkActions = jobwork.map((inward) => {
    const received = r2(inward.items.reduce((sum, item) => sum + item.qty, 0))
    const processed = r2(inward.items.reduce((sum, item) => sum + item.processedQty, 0))
    const hasCertificate = inward.certificates.length > 0
    const cardValue = r2(inward.jobCards.reduce((sum, card) => sum + card.totalAmount, 0))
    const action = inward.status === 'COMPLETED' && !hasCertificate
      ? 'ISSUE_CERTIFICATE'
      : inward.status === 'COMPLETED' && hasCertificate
        ? 'GENERATE_INVOICE'
        : 'COMPLETE_PROCESSING'
    return {
      id: inward.id,
      inwardNo: inward.inwardNo,
      party: inward.party.name,
      status: inward.status,
      action,
      priority: action === 'GENERATE_INVOICE' ? 'HIGH' : action === 'ISSUE_CERTIFICATE' ? 'HIGH' : 'NORMAL',
      receivedQty: received,
      processedQty: processed,
      remainingQty: r2(Math.max(0, received - processed)),
      cardValue,
      certificateNo: inward.certificates[0]?.certNo ?? null,
    }
  })
  const stockActions = inventory.rows.filter((row) => row.suggestedOrderQty > 0).map((row) => ({
    item: row.item,
    closing: row.closing,
    suggestedOrderQty: row.suggestedOrderQty,
    priority: row.closing <= 0 ? 'CRITICAL' : 'HIGH',
  }))
  return {
    generatedAt: new Date(),
    summary: {
      critical: taskActions.filter((row) => row.priority === 'CRITICAL').length + stockActions.filter((row) => row.priority === 'CRITICAL').length,
      high: taskActions.filter((row) => row.priority === 'HIGH').length + stockActions.filter((row) => row.priority === 'HIGH').length + jobworkActions.filter((row) => row.priority === 'HIGH').length,
      overdueTasks: taskActions.filter((row) => row.priority === 'CRITICAL').length,
      unassignedTasks: taskActions.filter((row) => !row.employee).length,
      reorderItems: stockActions.length,
      jobworkActions: jobworkActions.length,
      receivables: outstanding.totalReceivable,
      payables: outstanding.totalPayable,
    },
    tasks: taskActions,
    stock: stockActions,
    jobwork: jobworkActions,
    receivables: outstanding.customers.slice().sort((a, b) => b.amount - a.amount).slice(0, 10),
    payables: outstanding.suppliers.slice().sort((a, b) => b.amount - a.amount).slice(0, 10),
  }
}

// ---------- GST monthly period helper ----------

function utcMonthRange(month: string) {
  const from = new Date(`${month}-01T00:00:00.000Z`)
  const nextMonth = month.endsWith('-12')
    ? `${Number(month.slice(0, 4)) + 1}-01`
    : `${month.slice(0, 5)}${String(Number(month.slice(5)) + 1).padStart(2, '0')}`
  return { from, to: new Date(new Date(`${nextMonth}T00:00:00.000Z`).getTime() - 1) }
}

// ---------- GSTR-1 summary (B2B / B2C, rate-wise) ----------

export async function gstr1Report(month: string) {
  // month = 'YYYY-MM' — invoice dates are stored at UTC midnight, so the
  // month window must be UTC-bounded (local bounds drop day-1 / pick up
  // next-month rows on non-UTC servers).
  const { from, to } = utcMonthRange(month)
  const invoices = await db.salesInvoice.findMany({
    where: { date: { gte: from, lte: to }, status: 'POSTED' },
    include: { items: true, party: true },
  })
  type Bucket = { count: number; taxable: number; cgst: number; sgst: number; igst: number }
  const b2b = new Map<number, Bucket>()
  const b2c = new Map<number, Bucket>()
  const push = (m: Map<number, Bucket>, rate: number, tax: { taxable: number; cgst: number; sgst: number; igst: number }) => {
    const b = m.get(rate) ?? { count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
    m.set(rate, {
      count: b.count + 1,
      taxable: r2(b.taxable + tax.taxable),
      cgst: r2(b.cgst + tax.cgst),
      sgst: r2(b.sgst + tax.sgst),
      igst: r2(b.igst + tax.igst),
    })
  }
  let b2bCount = 0
  let b2cCount = 0
  for (const inv of invoices) {
    const isB2b = !!inv.party.gstin
    if (isB2b) b2bCount++
    else b2cCount++
    // group invoice lines by rate — each rate bucket gets only its own lines
    const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>()
    for (const line of inv.items) {
      const b = byRate.get(line.gstRate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
      byRate.set(line.gstRate, {
        taxable: r2(b.taxable + line.taxable),
        cgst: r2(b.cgst + line.cgst),
        sgst: r2(b.sgst + line.sgst),
        igst: r2(b.igst + line.igst),
      })
    }
    for (const [rate, tax] of byRate) {
      push(isB2b ? b2b : b2c, rate, tax)
    }
  }
  const total = (m: Map<number, Bucket>) => {
    let taxable = 0, cgst = 0, sgst = 0, igst = 0, count = 0
    for (const b of m.values()) {
      taxable = r2(taxable + b.taxable); cgst = r2(cgst + b.cgst)
      sgst = r2(sgst + b.sgst); igst = r2(igst + b.igst); count += b.count
    }
    return { count, taxable, cgst, sgst, igst }
  }
  return {
    month,
    invoiceCount: invoices.length,
    b2bCount,
    b2cCount,
    b2b: [...b2b.entries()].map(([rate, b]) => ({ rate, ...b })).sort((a, b) => a.rate - b.rate),
    b2c: [...b2c.entries()].map(([rate, b]) => ({ rate, ...b })).sort((a, b) => a.rate - b.rate),
    b2bTotal: total(b2b),
    b2cTotal: total(b2c),
  }
}

// ---------- GSTR-3B internal liability / ITC summary ----------

/**
 * Books-based GSTR-3B working summary. It is intentionally not labelled a
 * portal-ready return: reverse charge, exempt/nil/non-GST supplies and blocked
 * ITC are not represented by the current invoice schema.
 */
export async function gstr3bReport(month: string) {
  const { from, to } = utcMonthRange(month)
  const [sales, purchases] = await Promise.all([
    db.salesInvoice.findMany({ where: { status: 'POSTED', date: { gte: from, lte: to } }, select: { taxable: true, cgst: true, sgst: true, igst: true, grandTotal: true } }),
    db.purchaseInvoice.findMany({ where: { status: 'POSTED', date: { gte: from, lte: to } }, select: { taxable: true, cgst: true, sgst: true, igst: true, grandTotal: true } }),
  ])
  const total = (rows: { taxable: number; cgst: number; sgst: number; igst: number; grandTotal: number }[]) => ({
    taxable: r2(rows.reduce((sum, row) => sum + row.taxable, 0)),
    cgst: r2(rows.reduce((sum, row) => sum + row.cgst, 0)),
    sgst: r2(rows.reduce((sum, row) => sum + row.sgst, 0)),
    igst: r2(rows.reduce((sum, row) => sum + row.igst, 0)),
    grandTotal: r2(rows.reduce((sum, row) => sum + row.grandTotal, 0)),
  })
  const outward = total(sales)
  const inward = total(purchases)
  const net = {
    cgst: r2(Math.max(0, outward.cgst - inward.cgst)),
    sgst: r2(Math.max(0, outward.sgst - inward.sgst)),
    igst: r2(Math.max(0, outward.igst - inward.igst)),
  }
  const excessItc = {
    cgst: r2(Math.max(0, inward.cgst - outward.cgst)),
    sgst: r2(Math.max(0, inward.sgst - outward.sgst)),
    igst: r2(Math.max(0, inward.igst - outward.igst)),
  }
  return {
    month,
    salesInvoiceCount: sales.length,
    purchaseInvoiceCount: purchases.length,
    outward,
    eligibleItcFromBooks: inward,
    netTaxBeforeCrossUtilisation: { ...net, total: r2(net.cgst + net.sgst + net.igst) },
    excessItcBeforeCrossUtilisation: { ...excessItc, total: r2(excessItc.cgst + excessItc.sgst + excessItc.igst) },
    limitations: [
      'Books summary only — not a filed GSTR-3B or portal acknowledgement',
      'No reverse-charge, exempt/nil/non-GST or blocked-ITC classification in the current schema',
      'Cross-utilisation of CGST/SGST/IGST credit is not applied',
    ],
  }
}

// ---------- Trial balance ----------

export async function trialBalanceReport(from?: string, to?: string) {
  const where: any = { isCancelled: false }
  if (from || to) {
    where.date = {}
    if (from) where.date.gte = utcDayStart(from)
    if (to) where.date.lte = utcDayEnd(to)
  }
  const rows = await db.accountLedger.findMany({ where })
  const byAcc = new Map<string, { account: string; accountName: string; debit: number; credit: number }>()
  for (const r of rows) {
    const prev = byAcc.get(r.account) ?? { account: r.account, accountName: r.accountName, debit: 0, credit: 0 }
    byAcc.set(r.account, {
      ...prev,
      debit: r2(prev.debit + r.debit),
      credit: r2(prev.credit + r.credit),
    })
  }
  const accounts = [...byAcc.values()]
    .map((a) => ({ ...a, closing: r2(a.debit - a.credit) }))
    .sort((a, b) => a.account.localeCompare(b.account))
  const totalDr = r2(accounts.reduce((s, a) => s + a.debit, 0))
  const totalCr = r2(accounts.reduce((s, a) => s + a.credit, 0))
  return {
    accounts,
    totalDr,
    totalCr,
    balanced: Math.abs(totalDr - totalCr) <= 0.005,
  }
}

// ---------- helpers: GL-backed opening balances ----------

/** Opening amount already posted to the GL for a party (voucherType OPENING).
 *  When non-zero the GL rows already carry the opening balance, so reports
 *  must NOT also add Party.openingBal (double count). Zero → legacy party
 *  whose opening was never GL-posted; fall back to the column value. */
async function glOpeningForParties(): Promise<Map<string, number>> {
  const rows = await db.accountLedger.findMany({
    where: { voucherType: 'OPENING', isCancelled: false, partyId: { not: null } },
    select: { partyId: true, debit: true, credit: true },
  })
  const map = new Map<string, number>()
  for (const r of rows) {
    if (!r.partyId) continue
    map.set(r.partyId, r2((map.get(r.partyId) ?? 0) + r.debit - r.credit))
  }
  return map
}

// ---------- Outstanding (receivables / payables) ----------

export async function outstandingReport() {
  const parties = await db.party.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
  const sales = await db.salesInvoice.findMany({ where: { status: 'POSTED' } })
  const purchases = await db.purchaseInvoice.findMany({ where: { status: 'POSTED' } })
  const glOpening = await glOpeningForParties()
  const bySales = new Map<string, number>()
  for (const s of sales) bySales.set(s.partyId, r2((bySales.get(s.partyId) ?? 0) + s.grandTotal - s.paidAmount))
  const byPurch = new Map<string, number>()
  for (const p of purchases) byPurch.set(p.partyId, r2((byPurch.get(p.partyId) ?? 0) + p.grandTotal - p.paidAmount))
  // Unallocated payments (advances / on-account): a RECEIPT posts Cr DEBT and
  // a PAYMENT posts Dr CRED in the GL whether or not it settles a specific
  // invoice, so the party sub-ledger nets them immediately. The outstanding
  // report must do the same or it drifts from the GL control accounts — an
  // unallocated advance reduces what the party overall owes, exactly like its
  // GL mirror does (party-ledger ≡ outstanding invariant).
  const payments = await db.payment.findMany({
    where: { status: 'POSTED' },
    include: { allocations: { select: { amount: true } } },
  })
  const advanceByParty = new Map<string, number>() // + = customer advance (RECEIPT), − = supplier advance (PAYMENT)
  for (const p of payments) {
    const allocated = r2(p.allocations.reduce((s, a) => s + a.amount, 0))
    const unallocated = r2(p.amount - allocated)
    if (Math.abs(unallocated) < 0.004) continue
    const sign = p.type === 'RECEIPT' ? 1 : -1
    advanceByParty.set(p.partyId, r2((advanceByParty.get(p.partyId) ?? 0) + sign * unallocated))
  }
  // Opening contribution — counted exactly ONCE: the GL-posted amount when
  // it exists, else the legacy column value. (The voucher sums above are
  // computed from invoice/payment tables and never include GL opening rows.)
  const openingFor = (p: { id: string; openingBal: number }): number => {
    const gl = glOpening.get(p.id)
    if (gl !== undefined && Math.abs(gl) > 0.004) return gl
    return p.openingBal
  }
  const customers = parties
    .filter((p) => p.types.includes('CUSTOMER'))
    .map((p) => ({
      party: { id: p.id, code: p.code, name: p.name, stateCode: p.stateCode, openingBal: p.openingBal },
      advance: r2(Math.max(0, advanceByParty.get(p.id) ?? 0)),
      amount: r2((bySales.get(p.id) ?? 0) + Math.max(0, openingFor(p)) - Math.max(0, advanceByParty.get(p.id) ?? 0)),
    }))
    .filter((r) => r.amount > 0.004 || r.advance > 0.004)
  const suppliers = parties
    .filter((p) => p.types.includes('SUPPLIER'))
    .map((p) => ({
      party: { id: p.id, code: p.code, name: p.name, stateCode: p.stateCode, openingBal: p.openingBal },
      advance: r2(Math.max(0, -(advanceByParty.get(p.id) ?? 0))),
      amount: r2((byPurch.get(p.id) ?? 0) + Math.max(0, -openingFor(p)) - Math.max(0, -(advanceByParty.get(p.id) ?? 0))),
    }))
    .filter((r) => r.amount > 0.004 || r.advance > 0.004)
  return {
    customers,
    suppliers,
    totalReceivable: r2(customers.reduce((s, r) => s + r.amount, 0)),
    totalPayable: r2(suppliers.reduce((s, r) => s + r.amount, 0)),
  }
}

// ---------- Cash & bank book ----------

/**
 * Ledger-backed cash/bank book. Opening is every live entry before `from`;
 * period movements and closing are derived from the same append-only GL, so
 * the report cannot drift from payments or cancellation reversals.
 */
export async function cashBankBookReport(from: string, to: string) {
  const fromDate = utcDayStart(from)
  const toDate = utcDayEnd(to)
  const accounts = ['CASH', 'BANK']
  const [openingRows, periodRows] = await Promise.all([
    db.accountLedger.findMany({
      where: { isCancelled: false, account: { in: accounts }, date: { lt: fromDate } },
      select: { account: true, debit: true, credit: true },
    }),
    db.accountLedger.findMany({
      where: { isCancelled: false, account: { in: accounts }, date: { gte: fromDate, lte: toDate } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { party: { select: { id: true, code: true, name: true } } },
    }),
  ])
  const opening = { CASH: 0, BANK: 0 }
  for (const row of openingRows) opening[row.account as 'CASH' | 'BANK'] = r2(opening[row.account as 'CASH' | 'BANK'] + row.debit - row.credit)
  const running = { ...opening }
  const rows = periodRows.map((row) => {
    const account = row.account as 'CASH' | 'BANK'
    running[account] = r2(running[account] + row.debit - row.credit)
    return { ...row, movement: r2(row.debit - row.credit), balance: running[account] }
  })
  const accountSummary = accounts.map((account) => {
    const entries = periodRows.filter((row) => row.account === account)
    const receipts = r2(entries.reduce((sum, row) => sum + row.debit, 0))
    const payments = r2(entries.reduce((sum, row) => sum + row.credit, 0))
    return {
      account,
      accountName: account === 'CASH' ? 'Cash Account' : 'Bank Account',
      opening: opening[account as 'CASH' | 'BANK'],
      receipts,
      payments,
      closing: running[account as 'CASH' | 'BANK'],
    }
  })
  return {
    from,
    to,
    rows,
    accounts: accountSummary,
    totalOpening: r2(accountSummary.reduce((sum, row) => sum + row.opening, 0)),
    totalReceipts: r2(accountSummary.reduce((sum, row) => sum + row.receipts, 0)),
    totalPayments: r2(accountSummary.reduce((sum, row) => sum + row.payments, 0)),
    totalClosing: r2(accountSummary.reduce((sum, row) => sum + row.closing, 0)),
  }
}

// ---------- P&L (period) ----------

export async function pnlReport(from: string, to: string) {
  const fromDate = utcDayStart(from)
  const toDate = utcDayEnd(to)
  const led = await db.accountLedger.findMany({
    where: { isCancelled: false, date: { gte: fromDate, lte: toDate } },
  })
  const net = (code: string) => {
    const rows = led.filter((l) => l.account === code)
    const dr = r2(rows.reduce((s, l) => s + l.debit, 0))
    const cr = r2(rows.reduce((s, l) => s + l.credit, 0))
    return r2(cr - dr) // positive = income-side
  }
  const sales = net('SALS')
  const jobworkIncome = net('JWIN')
  const purchases = -net('PURC') // positive = expense
  const roundOff = net('RND')
  const revenue = r2(sales + jobworkIncome)
  const grossProfit = r2(revenue - purchases)
  return {
    from,
    to,
    sales,
    jobworkIncome,
    purchases,
    roundOff,
    revenue,
    grossProfit,
    netProfit: r2(grossProfit + roundOff),
  }
}

// ---------- Party ledger ----------

export async function partyLedgerReport(partyId: string) {
  const party = await db.party.findUnique({ where: { id: partyId } })
  if (!party) return null
  const rows = await db.accountLedger.findMany({
    where: { partyId, isCancelled: false },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })
  // Opening balance: when it has been GL-posted (OPENING rows with this
  // partyId) it is already inside `rows` — start from zero so it is not
  // counted twice. Legacy parties (never GL-posted) keep the column value.
  const glOpening = r2(
    rows
      .filter((r) => r.voucherType === 'OPENING')
      .reduce((s, r) => s + r.debit - r.credit, 0)
  )
  const glPosted = Math.abs(glOpening) > 0.004
  let bal = glPosted ? 0 : party.openingBal // + receivable
  const out = rows.map((r) => {
    bal = r2(bal + r.debit - r.credit)
    return { ...r, balance: bal }
  })
  return { party, openingBal: party.openingBal, rows, closing: bal }
}

// ---------- Jobwork pending ----------

export async function jobworkPendingReport() {
  const inwards = await db.jobworkInward.findMany({
    where: { status: { in: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] } },
    include: {
      party: true,
      items: { include: { item: true } },
      jobCards: {
        where: { status: 'COMPLETED' },
        include: { processes: { include: { process: true } } },
      },
    },
    orderBy: { date: 'desc' },
  })
  const processes = await db.process.findMany({ where: { active: true }, orderBy: { seq: 'asc' } })
  return inwards.map((iw) => ({
    inward: { id: iw.id, inwardNo: iw.inwardNo, date: iw.date, status: iw.status, party: { name: iw.party.name, code: iw.party.code } },
    items: iw.items.map((it) => {
      const doneProcessIds = new Set(
        iw.jobCards.flatMap((c) => c.processes.filter((p) => p.inwardItemId === it.id).map((p) => p.processId))
      )
      return {
        item: { id: it.item.id, code: it.item.code, name: it.item.name, uom: it.item.uom },
        batchNo: it.batchNo,
        receivedQty: it.qty,
        processedQty: it.processedQty,
        remainingQty: r2(it.qty - it.processedQty),
        receivedWeight: it.weight,
        processedWeight: it.processedWeight,
        remainingWeight: r2(it.weight - it.processedWeight),
        pendingProcesses: processes
          .filter((p) => !doneProcessIds.has(p.id))
          .map((p) => ({ id: p.id, code: p.code, name: p.name })),
      }
    }),
    cardValue: r2(iw.jobCards.reduce((s, c) => s + c.totalAmount, 0)),
  }))
}

// ---------- Dashboard ----------

export async function dashboardData() {
  const now = new Date()
  // Invoice dates are stored at UTC midnight, so month bucketing uses UTC
  // month keys/starts (local keys mis-bucket month-1st rows on non-UTC hosts).
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

  const [salesMonth, purchaseMonth, salesAll, purchaseAll, parties, stockSummary, jobwork, recent, projAgg, taskAgg] =
    await Promise.all([
      db.salesInvoice.aggregate({ where: { status: 'POSTED', date: { gte: monthStart } }, _sum: { grandTotal: true } }),
      db.purchaseInvoice.aggregate({ where: { status: 'POSTED', date: { gte: monthStart } }, _sum: { grandTotal: true } }),
      db.salesInvoice.findMany({ where: { status: 'POSTED' }, select: { date: true, grandTotal: true, paidAmount: true, partyId: true } }),
      db.purchaseInvoice.findMany({ where: { status: 'POSTED' }, select: { date: true, grandTotal: true, paidAmount: true, partyId: true } }),
      db.party.findMany({ where: { active: true } }),
      stockSummaryReport(),
      db.jobworkInward.findMany({
        where: { status: { in: ['OPEN', 'IN_PROGRESS', 'COMPLETED'] } },
        include: { jobCards: { where: { status: 'COMPLETED' } } },
      }),
      db.salesInvoice.findMany({
        where: { status: 'POSTED' },
        orderBy: { date: 'desc' },
        take: 8,
        include: { party: { select: { name: true } } },
      }),
      db.project.groupBy({ by: ['status'], _count: true }),
      db.productionTask.groupBy({ by: ['status'], _count: true }),
    ])

  // Outstanding — computed with the SAME semantics as outstandingReport()
  // (GL-backed opening counted once + unallocated advances netted) so the
  // dashboard KPIs can never contradict the receivables/payables report.
  const [paymentsAll, glOpening] = await Promise.all([
    db.payment.findMany({ where: { status: 'POSTED' }, include: { allocations: { select: { amount: true } } } }),
    glOpeningForParties(),
  ])
  const salesDueByParty = new Map<string, number>()
  const salesPaidByParty = new Map<string, number>()
  for (const s of salesAll) salesDueByParty.set(s.partyId, r2((salesDueByParty.get(s.partyId) ?? 0) + s.grandTotal))
  for (const s of salesAll) if (s.paidAmount > 0) salesPaidByParty.set(s.partyId, r2((salesPaidByParty.get(s.partyId) ?? 0) + s.paidAmount))
  const purchDueByParty = new Map<string, number>()
  const purchPaidByParty = new Map<string, number>()
  for (const p of purchaseAll) purchDueByParty.set(p.partyId, r2((purchDueByParty.get(p.partyId) ?? 0) + p.grandTotal))
  for (const p of purchaseAll) if (p.paidAmount > 0) purchPaidByParty.set(p.partyId, r2((purchPaidByParty.get(p.partyId) ?? 0) + p.paidAmount))
  const advanceByParty = new Map<string, number>() // + = customer advance (RECEIPT), − = supplier advance (PAYMENT)
  for (const p of paymentsAll) {
    const allocated = r2(p.allocations.reduce((s, a) => s + a.amount, 0))
    const unallocated = r2(p.amount - allocated)
    if (Math.abs(unallocated) < 0.004) continue
    const sign = p.type === 'RECEIPT' ? 1 : -1
    advanceByParty.set(p.partyId, r2((advanceByParty.get(p.partyId) ?? 0) + sign * unallocated))
  }
  const openingFor = (p: { id: string; openingBal: number }): number => {
    const gl = glOpening.get(p.id)
    if (gl !== undefined && Math.abs(gl) > 0.004) return gl
    return p.openingBal
  }
  const receivables = r2(
    parties
      .filter((p) => p.types.includes('CUSTOMER'))
      .reduce(
        (s, p) =>
          s +
          Math.max(
            0,
            r2(
              (salesDueByParty.get(p.id) ?? 0) - (salesPaidByParty.get(p.id) ?? 0) +
                Math.max(0, openingFor(p)) -
                Math.max(0, advanceByParty.get(p.id) ?? 0)
            )
          ),
        0
      )
  )
  const payables = r2(
    parties
      .filter((p) => p.types.includes('SUPPLIER'))
      .reduce(
        (s, p) =>
          s +
          Math.max(
            0,
            r2(
              (purchDueByParty.get(p.id) ?? 0) - (purchPaidByParty.get(p.id) ?? 0) +
                Math.max(0, -openingFor(p)) -
                Math.max(0, -(advanceByParty.get(p.id) ?? 0))
            )
          ),
        0
      )
  )

  // 6-month trend
  const trend: { month: string; label: string; sales: number; purchase: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = monthKey(d)
    trend.push({
      month: key,
      label: d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }),
      sales: r2(salesAll.filter((s) => monthKey(new Date(s.date)) === key).reduce((s, x) => s + x.grandTotal, 0)),
      purchase: r2(purchaseAll.filter((p) => monthKey(new Date(p.date)) === key).reduce((s, x) => s + x.grandTotal, 0)),
    })
  }

  const stockValue = r2(stockSummary.reduce((s, i) => s + i.closingValue, 0))
  const openJobworkValue = r2(
    jobwork.reduce((s, iw) => s + iw.jobCards.reduce((x, c) => x + c.totalAmount, 0), 0)
  )
  const lowStock = stockSummary.filter((i) => i.lowStock)
  const cnt = (rows: { status: string; _count: number }[], s: string) => rows.find((r) => r.status === s)?._count ?? 0
  const runningProjects = cnt(projAgg, 'RUNNING') + cnt(projAgg, 'PENDING')
  const pendingTasks = cnt(taskAgg, 'PENDING') + cnt(taskAgg, 'ASSIGNED') + cnt(taskAgg, 'IN_PROGRESS')

  return {
    monthSales: r2(salesMonth._sum.grandTotal ?? 0),
    monthPurchase: r2(purchaseMonth._sum.grandTotal ?? 0),
    receivables,
    payables,
    stockValue,
    openJobworkValue,
    runningProjects,
    pendingTasks,
    trend,
    recentInvoices: recent.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      date: i.date,
      party: i.party.name,
      grandTotal: i.grandTotal,
      paidAmount: i.paidAmount,
      source: i.source,
    })),
    lowStock: lowStock.map((i) => ({
      code: i.item.code,
      name: i.item.name,
      closing: i.closing,
      reorderLevel: i.item.reorderLevel,
      uom: i.item.uom,
    })),
  }
}
