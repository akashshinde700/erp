/**
 * ForgeERP — Demo seed. Builds a realistic Maharashtrian manufacturing-jobwork
 * scenario through the REAL posting services (never raw inserts), so invoice ≡
 * stock ledger ≡ GL by construction. Idempotent: skips when a company exists
 * unless force = true (which wipes everything in FK-safe order).
 */
import { db } from './db'
import { makeGstin } from './erp'
import { hashPassword } from './auth'
import { ensurePlatformAdmin, PLATFORM_ADMIN_EMAIL } from './platform'
import {
  postOpeningStock,
  postPurchaseInvoice,
  postSalesInvoice,
  postPayment,
  postJobworkInward,
  postJobCard,
  issueCertificate,
  generateJobworkInvoice,
  syncPartyOpeningBalance,
} from './services'
import { seedManufacturingDemo } from './seed-manufacturing'

const daysAgo = (n: number): Date => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(10, 30, 0, 0)
  return d
}

const daysAhead = (n: number): Date => daysAgo(-n)

export async function seedDatabase(force = false) {
  // Only a customer organization counts as "seeded" (the platform company is
  // the operator's own and never the demo scenario).
  const existing = await db.company.findFirst({ where: { isPlatform: false } })
  if (existing && !force) return { seeded: false, reason: 'Company already exists (platform admin ?force=1 reseeds)' }

  if (force) {
    // FK-safe wipe inside ONE transaction — a crash mid-wipe can never leave
    // a half-deleted database (transaction-safety invariant).
    await db.$transaction(
      async (tx) => {
        await tx.productionTask.deleteMany({})
        await tx.workOrderLine.deleteMany({})
        await tx.workOrder.deleteMany({})
        await tx.bomItem.deleteMany({})
        await tx.bom.deleteMany({})
        await tx.project.deleteMany({})
        await tx.employee.deleteMany({})
        await tx.paymentAllocation.deleteMany({})
        await tx.payment.deleteMany({})
        await tx.jobCardProcess.deleteMany({})
        await tx.jobCard.deleteMany({})
        await tx.jobworkCertificate.deleteMany({})
        await tx.jobworkInwardItem.deleteMany({})
        await tx.jobworkInward.deleteMany({})
        await tx.salesInvoiceItem.deleteMany({})
        await tx.salesInvoice.deleteMany({})
        await tx.purchaseInvoiceItem.deleteMany({})
        await tx.purchaseInvoice.deleteMany({})
        await tx.stockLedger.deleteMany({})
        await tx.accountLedger.deleteMany({})
        await tx.partyProcessRate.deleteMany({})
        await tx.counter.deleteMany({})
        await tx.item.deleteMany({})
        await tx.process.deleteMany({})
        await tx.warehouse.deleteMany({})
        await tx.party.deleteMany({})
        // Platform-console rows have no FKs to business tables but DO have unique
        // keys (blog slug) — a force reseed must wipe them too or the
        // rebuild dies on P2002.
        await tx.platformInquiryFollowUp.deleteMany({})
        await tx.platformInquiry.deleteMany({})
        await tx.platformBlogPost.deleteMany({})
        await tx.orgUser.deleteMany({})
        await tx.company.deleteMany({})
      },
      { timeout: 30_000 }
    )
  }

  // ---------- Company ----------
  const company = await db.company.create({
    data: {
      name: 'Shree Forge Industries',
      legalName: 'Shree Forge Industries Pvt. Ltd.',
      gstin: makeGstin('27', 'AAECS1429B1Z'),
      stateCode: '27',
      address: 'Plot 42, MIDC Bhosari Industrial Estate',
      city: 'Pune',
      pincode: '411026',
      phone: '+91 20 4567 8900',
      email: 'works@shreeforge.example.com',
      bankName: 'HDFC Bank, Bhosari Branch',
      bankAcct: '50200034567891',
      bankIfsc: 'HDFC0000123',
      upiId: 'shreeforge@hdfcbank',
    },
  })

  // ---------- Demo organization login (owner) ----------
  await db.orgUser.create({
    data: {
      name: 'Anil Deshpande',
      email: 'owner@shreeforge.example.com',
      passwordHash: hashPassword('forge123'),
      role: 'OWNER',
      companyId: company.id,
    },
  })

  // ---------- Platform administrator (SUPER_ADMIN) ----------
  // Delegated to ensurePlatformAdmin: env password or a RANDOM one printed
  // once in the server log — never a public repo constant. Created AFTER the
  // operating org so Shree Forge stays the first company.
  await ensurePlatformAdmin()
  // The platform-console gate ADVERTISES the demo admin password
  // (platform123) — make that true for demo installs. This seed only ever
  // runs on a blank install; an explicit PLATFORM_ADMIN_PASSWORD env always
  // wins (operator intent beats the demo default).
  const envPwd = process.env.PLATFORM_ADMIN_PASSWORD
  if (!envPwd || envPwd.length < 8) {
    await db.orgUser.update({
      where: { email: PLATFORM_ADMIN_EMAIL },
      data: { passwordHash: hashPassword('platform123') },
    })
  }

  // ---------- Warehouses ----------
  const main = await db.warehouse.create({ data: { code: 'MAIN', name: 'Main Stores', location: 'Pune Plant 1' } })
  const jw = await db.warehouse.create({ data: { code: 'JW', name: 'Jobwork Store', location: 'Pune Plant 1 — customer material cage' } })

  // ---------- Processes ----------
  const shot = await db.process.create({ data: { code: 'SHOT', name: 'Shot Blasting', seq: 1, basis: 'WEIGHT', rate: 6, lotCharge: 0 } })
  const ht = await db.process.create({ data: { code: 'HT', name: 'Heat Treatment', seq: 2, basis: 'WEIGHT', rate: 9, lotCharge: 150 } })
  const galv = await db.process.create({ data: { code: 'GALV', name: 'Galvanizing', seq: 3, basis: 'WEIGHT', rate: 14, lotCharge: 200 } })
  const mach = await db.process.create({ data: { code: 'MACH', name: 'CNC Machining', seq: 4, basis: 'QTY', rate: 120, lotCharge: 0 } })
  const qc = await db.process.create({ data: { code: 'QC', name: 'Quality Check & NDT', seq: 5, basis: 'QTY', rate: 15, lotCharge: 0 } })
  const pack = await db.process.create({ data: { code: 'PACK', name: 'Packing & Marking', seq: 6, basis: 'QTY', rate: 20, lotCharge: 100 } })

  // ---------- Parties ----------
  const mahindra = await db.party.create({
    data: {
      code: 'CUST-001', name: 'Mahindra Metal Works Pvt. Ltd.',
      types: 'CUSTOMER', gstin: makeGstin('27', 'AABCM5239K1Z'), stateCode: '27',
      address: 'Sector 22, MIDC Chakan', city: 'Pune', pincode: '410501', phone: '+91 20 2760 1122',
      email: 'purchase@mahindrametal.example.com',
    },
  })
  const gujarat = await db.party.create({
    data: {
      code: 'CUST-002', name: 'Gujarat Heavy Castings LLP',
      types: 'CUSTOMER', gstin: makeGstin('24', 'AACFG8821L1Z'), stateCode: '24',
      address: 'GIDC Vatva, Phase II', city: 'Ahmedabad', pincode: '382210', phone: '+91 79 2583 4477',
    },
  })
  const bengal = await db.party.create({
    data: {
      code: 'CUST-003', name: 'Bengal Alloys & Forgings Co.',
      types: 'CUSTOMER', gstin: makeGstin('19', 'AAJCB0417D1Z'), stateCode: '19',
      address: 'Howrah Industrial Zone', city: 'Kolkata', pincode: '711106', phone: '+91 33 2664 7788',
    },
  })
  const steelTrader = await db.party.create({
    data: {
      code: 'SUPP-001', name: 'Pune Steel Traders',
      types: 'SUPPLIER', gstin: makeGstin('27', 'AAKPS6033F1Z'), stateCode: '27',
      address: 'Bhawani Peth Steel Market', city: 'Pune', pincode: '411004', phone: '+91 20 2446 0918',
    },
  })
  const alloysSupply = await db.party.create({
    data: {
      code: 'SUPP-002', name: 'Mumbai Alloys Supply Corp.',
      types: 'SUPPLIER', gstin: makeGstin('27', 'AABCM9955E1Z'), stateCode: '27',
      address: 'Kalamboli Steel Market', city: 'Navi Mumbai', pincode: '410218', phone: '+91 22 2739 5566',
    },
  })
  await db.party.create({
    data: {
      code: 'SUPP-003', name: 'Nagpur Ferro Alloys',
      types: 'SUPPLIER', gstin: makeGstin('27', 'AACCN2210H1Z'), stateCode: '27',
      address: 'MIDC Hingna', city: 'Nagpur', pincode: '440016', phone: '+91 712 226 3344',
      openingBal: -25000, // payable
    },
  })

  // ---------- GL-mirror every seeded opening balance ----------
  const partiesWithOpening = await db.party.findMany({ where: { openingBal: { not: 0 } } })
  for (const p of partiesWithOpening) {
    await syncPartyOpeningBalance(p.id)
  }

  // ---------- Items ----------
  const gearBlank = await db.item.create({
    data: { code: 'FG-1001', name: 'Gear Blank C45', groupName: 'Finished Goods', hsn: '848390', uom: 'PCS', gstRate: 18, saleRate: 850, costRate: 520, reorderLevel: 40 },
  })
  const flange = await db.item.create({
    data: { code: 'FG-1002', name: 'Flange DN50 SS316', groupName: 'Finished Goods', hsn: '730790', uom: 'PCS', gstRate: 18, saleRate: 640, costRate: 380, reorderLevel: 60 },
  })
  const shaft = await db.item.create({
    data: { code: 'FG-1003', name: 'Input Shaft EN24', groupName: 'Finished Goods', hsn: '848330', uom: 'PCS', gstRate: 18, saleRate: 1200, costRate: 750, reorderLevel: 25 },
  })
  const msPlate = await db.item.create({
    data: { code: 'RM-2001', name: 'MS Plate 12mm', groupName: 'Raw Material', hsn: '720890', uom: 'KGS', gstRate: 18, saleRate: 68, costRate: 52, reorderLevel: 500 },
  })
  const brassRod = await db.item.create({
    data: { code: 'RM-2002', name: 'Brass Rod 25mm', groupName: 'Raw Material', hsn: '740721', uom: 'KGS', gstRate: 18, saleRate: 520, costRate: 410, reorderLevel: 200 },
  })
  const jwService = await db.item.create({
    data: { code: 'JW-SERVICE', name: 'Jobwork Services', groupName: 'Services', hsn: '998887', isService: true, isStockItem: false, uom: 'PCS', gstRate: 18, saleRate: 0, costRate: 0 },
  })

  // ---------- Fabrication materials (project BOM lines) ----------
  const msPipe = await db.item.create({
    data: { code: 'RM-2003', name: 'MS Pipe SQ 40x40', groupName: 'Raw Material', hsn: '730630', uom: 'KG', gstRate: 18, saleRate: 72, costRate: 56, reorderLevel: 300 },
  })
  const weldRod = await db.item.create({
    data: { code: 'RM-2004', name: 'Welding Rod E7018', groupName: 'Consumables', hsn: '831110', uom: 'KG', gstRate: 18, saleRate: 140, costRate: 110, reorderLevel: 50 },
  })
  const paint = await db.item.create({
    data: { code: 'RM-2005', name: 'Epoxy Paint Zinc Primer', groupName: 'Consumables', hsn: '320990', uom: 'LTR', gstRate: 18, saleRate: 320, costRate: 240, reorderLevel: 40 },
  })
  const bolts = await db.item.create({
    data: { code: 'RM-2006', name: 'Bolts & Nuts M16 HDG', groupName: 'Consumables', hsn: '731815', uom: 'PCS', gstRate: 18, saleRate: 45, costRate: 30, reorderLevel: 200 },
  })

  // ---------- Party-specific process rates (Mahindra contract) ----------
  await db.partyProcessRate.createMany({
    data: [
      { partyId: mahindra.id, processId: ht.id, rate: 8.5, lotCharge: 120 },
      { partyId: mahindra.id, processId: galv.id, rate: 13, lotCharge: 180 },
    ],
  })

  // ---------- Opening stock ----------
  await postOpeningStock({
    date: daysAgo(75),
    warehouseId: main.id,
    rows: [
      { itemId: msPlate.id, qty: 5000, rate: 52 },
      { itemId: brassRod.id, qty: 800, rate: 410 },
      { itemId: flange.id, qty: 100, rate: 380 },
      { itemId: msPipe.id, qty: 3000, rate: 56 },
      { itemId: weldRod.id, qty: 500, rate: 110 },
      { itemId: paint.id, qty: 200, rate: 240 },
      { itemId: bolts.id, qty: 1000, rate: 30 },
    ],
  })

  // ---------- Purchases ----------
  const pin1 = await postPurchaseInvoice({
    partyId: steelTrader.id,
    date: daysAgo(48),
    poNo: 'PO-2026-014',
    warehouseId: main.id,
    lines: [
      { itemId: msPlate.id, qty: 3000, rate: 54 },
      { itemId: brassRod.id, qty: 200, rate: 415 },
    ],
  })
  const pin2 = await postPurchaseInvoice({
    partyId: alloysSupply.id,
    date: daysAgo(3),
    poNo: 'PO-2026-019',
    warehouseId: main.id,
    lines: [{ itemId: msPlate.id, qty: 1500, rate: 55 }],
  })

  // ---------- Sales ----------
  const inv1 = await postSalesInvoice({
    partyId: mahindra.id,
    date: daysAgo(30),
    poNo: 'MMW/PO/8841',
    lines: [{ itemId: flange.id, qty: 50, rate: 640 }],
  })
  const inv2 = await postSalesInvoice({
    partyId: gujarat.id,
    date: daysAgo(24),
    lines: [{ itemId: brassRod.id, qty: 250, rate: 520 }],
  })
  const inv3 = await postSalesInvoice({
    partyId: bengal.id,
    date: daysAgo(2),
    taxInclusive: true,
    lines: [
      { itemId: flange.id, qty: 40, rate: 640 },
      { itemId: msPlate.id, qty: 200, rate: 68, discPct: 5 },
    ],
  })

  // ---------- Payments ----------
  await postPayment({
    type: 'RECEIPT',
    partyId: mahindra.id,
    date: daysAgo(20),
    amount: 30000,
    mode: 'BANK',
    refNo: 'NEFT-884120',
    allocations: [{ invoiceType: 'SALES', invoiceNo: inv1.invoiceNo, amount: 30000 }],
  })
  await postPayment({
    type: 'PAYMENT',
    partyId: steelTrader.id,
    date: daysAgo(18),
    amount: 100000,
    mode: 'BANK',
    refNo: 'RTGS-552103',
    allocations: [{ invoiceType: 'PURCHASE', invoiceNo: pin1.invoiceNo, amount: 100000 }],
  })
  await postPayment({
    type: 'RECEIPT',
    partyId: gujarat.id,
    date: daysAgo(2),
    amount: 25000,
    mode: 'UPI',
    refNo: 'UPI-7712093',
    allocations: [],
  })

  // ---------- Jobwork chain (core workflow) ----------
  // Inward from Mahindra: gear blanks + shafts for treatment
  const inward = await postJobworkInward({
    partyId: mahindra.id,
    date: daysAgo(22),
    challanNo: 'MMW/CH/2026-118',
    warehouseId: jw.id,
    notes: 'Customer material for heat treatment + machining batch',
    items: [
      { itemId: gearBlank.id, batchNo: 'GB-BATCH-07', qty: 200, weight: 480 },
      { itemId: shaft.id, batchNo: 'SH-BATCH-03', qty: 150, weight: 420 },
    ],
  })

  // Job card 1: gears full chain; shafts partial (100 of 150)
  await postJobCard({
    inwardId: inward.id,
    date: daysAgo(16),
    notes: 'Batch 07 — line 2',
    lines: [
      { inwardItemId: inward.items[0].id, qty: 200, weight: 480, processIds: [shot.id, ht.id, qc.id] },
      { inwardItemId: inward.items[1].id, qty: 100, weight: 280, processIds: [ht.id, mach.id] },
    ],
  })
  // Job card 2: remaining 50 shafts → inward COMPLETED
  await postJobCard({
    inwardId: inward.id,
    date: daysAgo(9),
    notes: 'Shaft balance quantity',
    lines: [{ inwardItemId: inward.items[1].id, qty: 50, weight: 140, processIds: [ht.id, mach.id, qc.id] }],
  })

  // Certificate
  const cert = await issueCertificate(inward.id, daysAgo(6))

  // Jobwork invoice (service lines per process, SAC 998887, income → JWIN)
  const jwInv = await generateJobworkInvoice(inward.id, daysAgo(2))

  // One more open inward to show the pending report
  await postJobworkInward({
    partyId: gujarat.id,
    date: daysAgo(1),
    challanNo: 'GHC/CH/4412',
    warehouseId: jw.id,
    items: [
      { itemId: gearBlank.id, batchNo: 'GB-GUJ-01', qty: 120, weight: 290 },
      { itemId: shaft.id, batchNo: 'SH-GUJ-01', qty: 80, weight: 225 },
    ],
  })

  // Manufacturing chain lives in seed-manufacturing.ts so it can also be added
  // to an already-seeded demo org (POST /api/seed?manufacturing=1).
  const mfg = await seedManufacturingDemo({ mahindra, gujarat, bengal, msPlate, msPipe, weldRod, paint, bolts })

  // Unallocated advance left on Gujarat shows in outstanding; verify trial balance
  const tb = await db.accountLedger.groupBy({ by: ['account'], _sum: { debit: true, credit: true } })
  const dr = tb.reduce((s, r) => s + (r._sum.debit ?? 0), 0)
  const cr = tb.reduce((s, r) => s + (r._sum.credit ?? 0), 0)
  if (Math.abs(dr - cr) > 0.01) {
    throw new Error(`Seed produced unbalanced GL (Dr ${dr} vs Cr ${cr}) — refusing to ship broken demo data`)
  }

  // ---------- Platform demo data (inquiries + blog, for the Platform Admin console) ----------
  const inq1 = await db.platformInquiry.create({
    data: {
      name: 'Kalyani Castings Pvt. Ltd.',
      contactName: 'Anitha V',
      email: 'purchase@kalyanicastings.example.com',
      phone: '8971233080',
      city: 'Bengaluru',
      message: 'Need jobwork billing for heat treatment + galvanizing across 3 plants. ~400 invoices/month.',
      status: 'new',
    },
  })
  await db.platformInquiry.create({
    data: {
      name: 'Shakti Forge & Alloys',
      contactName: 'R. Deshmukh',
      email: 'rdeshmukh@shaktiforge.example.com',
      phone: '9822014567',
      city: 'Pune',
      message: 'Evaluating a switch from Tally-only accounting. Wants GST + jobwork certificates.',
      status: 'contacted',
    },
  })
  await db.platformInquiryFollowUp.create({
    data: { inquiryId: inq1.id, note: 'Sent the feature tour link — waiting for their CA to review GST reports.' },
  })
  await db.platformBlogPost.create({
    data: {
      title: 'Introducing ForgeERP 2.0 — jobwork-first manufacturing ERP',
      slug: 'introducing-forgeerp-2',
      excerpt: 'Inward → Job Card → Certificate → Invoice, one chain, gapless numbering, GST-safe by construction.',
      body: 'Full post body…',
      status: 'published',
      publishedAt: daysAgo(9),
    },
  })
  await db.platformBlogPost.create({
    data: {
      title: 'GST e-Invoice bulk upload, the safe way',
      slug: 'gst-e-invoice-bulk-upload',
      excerpt: 'Pre-validate before the portal ever sees your JSON. Draft post for the launch blog.',
      body: 'Full post body…',
      status: 'draft',
    },
  })

  return {
    seeded: true,
    company: company.name,
    counts: {
      parties: 6, items: 10, processes: 6, warehouses: 2,
      purchaseInvoices: 2, salesInvoices: 4, payments: 3,
      jobworkInwards: 2, jobCards: 2, certificates: 1,
      employees: 6, projects: 3, boms: 3, workOrders: 2, productionTasks: 12,
      inquiries: 2, blogPosts: 2,
    },
    sample: {
      firstSalesInvoice: inv1.invoiceNo,
      jobworkInward: inward.inwardNo,
      jobworkInvoice: jwInv.invoiceNo,
      certificate: cert.certNo,
      runningProject: mfg.projects.running,
      pendingProject: mfg.projects.pending,
      completedProject: mfg.projects.completed,
    },
    trialBalanceDr: Math.round(dr * 100) / 100,
    trialBalanceCr: Math.round(cr * 100) / 100,
  }
}
