/**
 * ForgeERP — Manufacturing demo chain (Project → BOM → Work Order → Tasks →
 * Completion). Split out of seed.ts so an org that was seeded before the
 * manufacturing module shipped can get the same demo without a wipe:
 * seedManufacturingIfEmpty() is additive and refuses to run when any
 * employee or project already exists.
 */
import { db } from './db'
import { postOpeningStock } from './services'
import { postProductionReceipt } from './production-output'
import {
  createEmployee,
  createProject,
  completeProject,
  createBom,
  approveBom,
  createWorkOrder,
  completeWorkOrder,
  createTask,
  assignTask,
  startTask,
  completeTask,
} from './manufacturing'
import { tenantCompany } from './tenant'

const daysAgo = (n: number): Date => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(10, 30, 0, 0)
  return d
}
const daysAhead = (n: number): Date => daysAgo(-n)

type Ref = { id: string }
export interface ManufacturingSeedDeps {
  mahindra: Ref
  gujarat: Ref
  bengal: Ref
  msPlate: Ref
  msPipe: Ref
  weldRod: Ref
  paint: Ref
  bolts: Ref
  main: Ref // finished-goods warehouse
  fgTank: Ref // FG stock item received from the completed tank work order
  fgCanopy: Ref // output item of the canopy BOM
  fgGantry: Ref // output item of the gantry BOM
}

/** Raw materials the BOMs consume — created (with opening stock) when missing. */
const FABRICATION_ITEMS = [
  { key: 'msPlate', code: 'RM-2001', name: 'MS Plate 12mm', groupName: 'Raw Material', hsn: '720890', uom: 'KGS', saleRate: 68, costRate: 52, reorderLevel: 500, openingQty: 5000 },
  { key: 'msPipe', code: 'RM-2003', name: 'MS Pipe SQ 40x40', groupName: 'Raw Material', hsn: '730630', uom: 'KG', saleRate: 72, costRate: 56, reorderLevel: 300, openingQty: 3000 },
  { key: 'weldRod', code: 'RM-2004', name: 'Welding Rod E7018', groupName: 'Consumables', hsn: '831110', uom: 'KG', saleRate: 140, costRate: 110, reorderLevel: 50, openingQty: 500 },
  { key: 'paint', code: 'RM-2005', name: 'Epoxy Paint Zinc Primer', groupName: 'Consumables', hsn: '320990', uom: 'LTR', saleRate: 320, costRate: 240, reorderLevel: 40, openingQty: 200 },
  { key: 'bolts', code: 'RM-2006', name: 'Bolts & Nuts M16 HDG', groupName: 'Consumables', hsn: '731815', uom: 'PCS', saleRate: 45, costRate: 30, reorderLevel: 200, openingQty: 1000 },
  { key: 'fgTank', code: 'FG-2001', name: 'Storage Tank 20KL SS304 (fabricated)', groupName: 'Finished Goods', hsn: '730900', uom: 'KG', saleRate: 120, costRate: 70, reorderLevel: 0, openingQty: 0 },
  { key: 'fgCanopy', code: 'FG-2002', name: 'Canopy Frame — Level 1 (fabricated)', groupName: 'Finished Goods', hsn: '730890', uom: 'SET', saleRate: 850000, costRate: 0, reorderLevel: 0, openingQty: 0 },
  { key: 'fgGantry', code: 'FG-2003', name: 'Gantry Truss Assembly (fabricated)', groupName: 'Finished Goods', hsn: '730890', uom: 'SET', saleRate: 2400000, costRate: 0, reorderLevel: 0, openingQty: 0 },
] as const

export async function seedManufacturingDemo(deps: ManufacturingSeedDeps) {
  const { mahindra, gujarat, bengal, msPlate, msPipe, weldRod, paint, bolts, main, fgTank, fgCanopy, fgGantry } = deps
  // =========================================================================
  // Manufacturing chain (Project → BOM → Work Order → Tasks → Completion)
  // Everything below runs through the REAL manufacturing services, so
  // numbering, guards, progress stats and the stock ledger are honest.
  // =========================================================================

  // ---------- Employees (fabrication floor) ----------
  const ravi = await createEmployee({ code: 'EMP001', name: 'Ravi Kulkarni', role: 'SUPERVISOR', skill: 'Fitter', shift: 'GENERAL', hourlyRate: 180, phone: '+91 98220 11001' })
  const sandeep = await createEmployee({ code: 'EMP002', name: 'Sandeep Patil', role: 'WORKER', skill: 'Welder', machineNo: 'WLD-02', shift: 'DAY', hourlyRate: 120 })
  const imran = await createEmployee({ code: 'EMP003', name: 'Imran Shaikh', role: 'WORKER', skill: 'CNC Operator', machineNo: 'CNC-01', shift: 'DAY', hourlyRate: 150 })
  const prakash = await createEmployee({ code: 'EMP004', name: 'Prakash Jadhav', role: 'WORKER', skill: 'Fitter', machineNo: 'GRD-01', shift: 'GENERAL', hourlyRate: 110 })
  const anita = await createEmployee({ code: 'EMP005', name: 'Anita Deshmukh', role: 'WORKER', skill: 'Painter', machineNo: 'PNT-01', shift: 'GENERAL', hourlyRate: 100 })
  const vilas = await createEmployee({ code: 'EMP006', name: 'Vilas Shinde', role: 'WORKER', skill: 'Helper', shift: 'NIGHT', hourlyRate: 80 })

  // ---------- PRJ-0001 · RUNNING — canopy, tasks in every state ----------
  const canopy = await createProject({
    name: 'Steel Structure Fabrication — Canopy',
    partyId: mahindra.id,
    manager: 'Anil Deshpande',
    location: 'Chakan Plant 2',
    startDate: daysAgo(40),
    endDate: daysAhead(10),
    budget: 850000,
    documents: 'DWG-2025-117 canopy frame\nGA-0042 general arrangement\nWPS-D1.1 welding procedure',
    notes: 'Hot-dip galvanised canopy over the dispatch bay. 12 columns + trusses.',
  })
  const canopyBom = await createBom({
    projectId: canopy.id,
    itemId: fgCanopy.id,
    productName: 'Canopy Frame — Level 1',
    drawingRef: 'DWG-2025-117',
    notes: 'Net quantities; wastage per shop practice.',
    lines: [
      { itemId: msPlate.id, grade: 'IS2062 E250', thickness: 12, qty: 500, uom: 'KG', wastagePct: 5, rate: 54 },
      { itemId: msPipe.id, grade: 'IS2062', qty: 200, uom: 'KG', wastagePct: 8, rate: 56 },
      { itemId: weldRod.id, qty: 25, uom: 'KG', wastagePct: 2, rate: 110 },
      { itemId: paint.id, qty: 40, uom: 'LTR', wastagePct: 5, rate: 240 },
      { itemId: bolts.id, qty: 100, uom: 'PCS', wastagePct: 3, rate: 30 },
    ],
  })
  await approveBom(canopyBom.id)
  // WO-1 pulls grossed lines from the approved BOM; project auto-starts (RUNNING)
  const canopyWo = await createWorkOrder({
    projectId: canopy.id,
    bomId: canopyBom.id,
    priority: 'HIGH',
    startDate: daysAgo(38),
    endDate: daysAhead(6),
    notes: 'Single batch — full frame in one WO.',
  })

  // Operation tasks (job cards). Completed ones consume real stock.
  const cut = await createTask({ workOrderId: canopyWo.id, operation: 'CUTTING', seq: 1, plannedQty: 525 })
  await assignTask(cut.id, { employeeId: prakash.id, dueDate: daysAgo(30) })
  await startTask(cut.id) // lifecycle guard: ASSIGNED -> IN_PROGRESS -> COMPLETED
  await completeTask(cut.id, { actualQty: 515, rejectionQty: 10, hours: 16, materialItemId: msPlate.id, materialQty: 520, completedAt: daysAgo(31) })

  const laser = await createTask({ workOrderId: canopyWo.id, operation: 'CNC_LASER', seq: 2, plannedQty: 100 })
  await assignTask(laser.id, { employeeId: imran.id, dueDate: daysAgo(26) })
  await startTask(laser.id) // lifecycle guard: ASSIGNED -> IN_PROGRESS -> COMPLETED
  await completeTask(laser.id, { actualQty: 100, hours: 8, completedAt: daysAgo(26) })

  const bend = await createTask({ workOrderId: canopyWo.id, operation: 'BENDING', seq: 3, plannedQty: 100 })
  await assignTask(bend.id, { employeeId: prakash.id, dueDate: daysAgo(22) })
  await startTask(bend.id) // lifecycle guard: ASSIGNED -> IN_PROGRESS -> COMPLETED
  await completeTask(bend.id, { actualQty: 100, hours: 6, materialItemId: msPipe.id, materialQty: 216, completedAt: daysAgo(22) })

  const weld = await createTask({ workOrderId: canopyWo.id, operation: 'WELDING', seq: 4, plannedQty: 100 })
  await assignTask(weld.id, { employeeId: sandeep.id, dueDate: daysAgo(15) })
  await startTask(weld.id) // lifecycle guard: ASSIGNED -> IN_PROGRESS -> COMPLETED
  await completeTask(weld.id, { actualQty: 100, rejectionQty: 2, hours: 24, materialItemId: weldRod.id, materialQty: 25, completedAt: daysAgo(14) })

  const asm = await createTask({ workOrderId: canopyWo.id, operation: 'ASSEMBLY', seq: 5, plannedQty: 100 })
  await assignTask(asm.id, { employeeId: ravi.id, dueDate: daysAgo(8) })
  await startTask(asm.id) // lifecycle guard: ASSIGNED -> IN_PROGRESS -> COMPLETED
  await completeTask(asm.id, { actualQty: 98, hours: 12, materialItemId: bolts.id, materialQty: 100, completedAt: daysAgo(7) })

  // Painting on the floor right now; finishing unassigned + OVERDUE (pending board demo)
  const pnt = await createTask({ workOrderId: canopyWo.id, operation: 'PAINTING', seq: 6, plannedQty: 98 })
  await assignTask(pnt.id, { employeeId: anita.id, dueDate: daysAhead(2) })
  await startTask(pnt.id)

  const fin = await createTask({ workOrderId: canopyWo.id, operation: 'FINISHING', seq: 7, plannedQty: 98 })
  await assignTask(fin.id, { employeeId: vilas.id, dueDate: daysAgo(2) }) // overdue

  const qcTask = await createTask({ workOrderId: canopyWo.id, operation: 'OTHER', seq: 8, plannedQty: 98, notes: 'Dimensional QC + dispatch docs' })

  // ---------- PRJ-0002 · PENDING — gantry, draft BOM ----------
  const gantry = await createProject({
    name: 'Conveyor Gantry Line — Phase 2',
    partyId: gujarat.id,
    manager: 'Sunil Rao',
    location: 'Vatva Site',
    startDate: daysAgo(5),
    endDate: daysAhead(55),
    budget: 2400000,
    documents: 'GA-GANTRY-2026-08',
  })
  await createBom({
    projectId: gantry.id,
    itemId: fgGantry.id,
    productName: 'Gantry Truss Assembly',
    drawingRef: 'GA-GANTRY-2026-08',
    lines: [
      { itemId: msPlate.id, grade: 'IS2062 E350', thickness: 10, qty: 1200, uom: 'KG', wastagePct: 6, rate: 54 },
      { itemId: msPipe.id, qty: 800, uom: 'KG', wastagePct: 8, rate: 56 },
      { itemId: bolts.id, qty: 400, uom: 'PCS', wastagePct: 3, rate: 30 },
    ],
  })

  // ---------- PRJ-0003 · COMPLETED — the full happy path ----------
  const tank = await createProject({
    name: 'Storage Tank 20KL — SS304',
    partyId: bengal.id,
    manager: 'Vikram Joshi',
    location: 'Howrah Yard',
    startDate: daysAgo(90),
    endDate: daysAgo(10),
    budget: 1250000,
    documents: 'TK-20KL-DWG-01 shell\nTK-20KL-DWG-02 dome',
  })
  const tankBom = await createBom({
    projectId: tank.id,
    itemId: fgTank.id,
    productName: 'Tank Shell + Dome Assembly',
    drawingRef: 'TK-20KL-DWG-01',
    lines: [
      { itemId: msPlate.id, grade: 'IS2062', thickness: 8, qty: 2200, uom: 'KG', wastagePct: 4, rate: 54 },
      { itemId: weldRod.id, qty: 45, uom: 'KG', wastagePct: 2, rate: 110 },
      { itemId: paint.id, qty: 60, uom: 'LTR', wastagePct: 5, rate: 240 },
      { itemId: bolts.id, qty: 250, uom: 'PCS', wastagePct: 3, rate: 30 },
    ],
  })
  await approveBom(tankBom.id)
  const tankWo = await createWorkOrder({
    projectId: tank.id,
    bomId: tankBom.id,
    priority: 'NORMAL',
    startDate: daysAgo(85),
    endDate: daysAgo(12),
  })
  const tCut = await createTask({ workOrderId: tankWo.id, operation: 'CUTTING', seq: 1, plannedQty: 2288 })
  await assignTask(tCut.id, { employeeId: prakash.id, dueDate: daysAgo(75) })
  await startTask(tCut.id) // lifecycle guard: ASSIGNED -> IN_PROGRESS -> COMPLETED
  await completeTask(tCut.id, { actualQty: 2280, rejectionQty: 8, hours: 40, materialItemId: msPlate.id, materialQty: 2200, completedAt: daysAgo(74) })
  const tWeld = await createTask({ workOrderId: tankWo.id, operation: 'WELDING', seq: 2, plannedQty: 100 })
  await assignTask(tWeld.id, { employeeId: sandeep.id, dueDate: daysAgo(60) })
  await startTask(tWeld.id) // lifecycle guard: ASSIGNED -> IN_PROGRESS -> COMPLETED
  await completeTask(tWeld.id, { actualQty: 100, rejectionQty: 1, hours: 55, materialItemId: weldRod.id, materialQty: 45, completedAt: daysAgo(58) })
  const tPaint = await createTask({ workOrderId: tankWo.id, operation: 'PAINTING', seq: 3, plannedQty: 100 })
  await assignTask(tPaint.id, { employeeId: anita.id, dueDate: daysAgo(45) })
  await startTask(tPaint.id) // lifecycle guard: ASSIGNED -> IN_PROGRESS -> COMPLETED
  await completeTask(tPaint.id, { actualQty: 100, hours: 18, materialItemId: paint.id, materialQty: 55, completedAt: daysAgo(44) })
  const tFin = await createTask({ workOrderId: tankWo.id, operation: 'FINISHING', seq: 4, plannedQty: 100 })
  await assignTask(tFin.id, { employeeId: vilas.id, dueDate: daysAgo(20) })
  await startTask(tFin.id) // lifecycle guard: ASSIGNED -> IN_PROGRESS -> COMPLETED
  await completeTask(tFin.id, { actualQty: 100, hours: 10, completedAt: daysAgo(19) })
  // WO closure needs QC-accepted finished goods that settle the WIP (planned output
  // = max task plannedQty); the receipt posts MFG_RECEIPT stock + WIP settlement GL.
  await postProductionReceipt({
    workOrderId: tankWo.id, outputItemId: fgTank.id, warehouseId: main.id, date: daysAgo(12),
    batchNo: 'TK-20KL-001', manufacturedAt: daysAgo(14), producedQty: 2288, acceptedQty: 2288,
  })
  await completeWorkOrder(tankWo.id)
  await completeProject(tank.id)

  return {
    counts: { employees: 6, projects: 3, boms: 3, workOrders: 2, productionTasks: 12 },
    projects: { running: canopy.projectNo, pending: gantry.projectNo, completed: tank.projectNo },
  }
}

/**
 * Additive variant for an org seeded before the manufacturing module existed.
 * Runs only when the org has NO employees and NO projects; never deletes or
 * rewrites anything. Missing fabrication items get created with their demo
 * opening stock (posted through the real service, so the ledger stays honest).
 */
export async function seedManufacturingIfEmpty() {
  const company = await tenantCompany(db)
  if (!company) return { seeded: false, reason: 'No company yet — run the full demo seed first' }
  const [employees, projects] = await Promise.all([db.employee.count(), db.project.count()])
  if (employees > 0 || projects > 0) {
    return { seeded: false, reason: `Manufacturing data already present (${employees} employees, ${projects} projects)` }
  }
  const parties = await db.party.findMany({ where: { code: { in: ['CUST-001', 'CUST-002', 'CUST-003'] } } })
  const byCode = new Map(parties.map((p) => [p.code, p]))
  const mahindra = byCode.get('CUST-001')
  const gujarat = byCode.get('CUST-002')
  const bengal = byCode.get('CUST-003')
  if (!mahindra || !gujarat || !bengal) {
    return { seeded: false, reason: 'Demo customers CUST-001..003 not found — this is not the demo org' }
  }

  const main = (await db.warehouse.findFirst({ where: { code: 'MAIN' } })) ?? (await db.warehouse.findFirst())
  if (!main) return { seeded: false, reason: 'No warehouse found' }

  const items: Record<string, Ref> = {}
  const created: { itemId: string; qty: number; rate: number }[] = []
  for (const def of FABRICATION_ITEMS) {
    let item = await db.item.findFirst({ where: { code: def.code } })
    if (!item) {
      item = await db.item.create({
        data: { code: def.code, name: def.name, groupName: def.groupName, hsn: def.hsn, uom: def.uom, gstRate: 18, saleRate: def.saleRate, costRate: def.costRate, reorderLevel: def.reorderLevel },
      })
      if (def.openingQty > 0) created.push({ itemId: item.id, qty: def.openingQty, rate: def.costRate })
    }
    items[def.key] = item
  }
  if (created.length) {
    await postOpeningStock({ date: daysAgo(75), warehouseId: main.id, rows: created })
  }

  const mfg = await seedManufacturingDemo({
    mahindra, gujarat, bengal,
    msPlate: items.msPlate, msPipe: items.msPipe, weldRod: items.weldRod, paint: items.paint, bolts: items.bolts,
    main, fgTank: items.fgTank, fgCanopy: items.fgCanopy, fgGantry: items.fgGantry,
  })
  return { seeded: true, company: company.name, itemsCreated: created.length, ...mfg }
}
