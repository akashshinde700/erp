/**
 * ForgeERP — Hinglish User Manual (Word) generator.
 *
 * Builds a complete, screenshot-driven manual from the live UI:
 *   screenshots  docs/manual-screenshots/*.png  (captured from the running app)
 *   output       deliverables/ForgeERP-User-Manual-Hinglish-2026-11-08.docx
 *
 * Run:  node scripts/generate-user-manual.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { imageSize } from 'image-size'
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, PageBreak, Header, Footer, PageNumber, NumberFormat,
  AlignmentType, HeadingLevel, WidthType, BorderStyle, ShadingType,
  TableLayoutType, SectionType, LevelFormat, TableOfContents, VerticalAlign,
} from 'docx'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'docs', 'manual-screenshots')
const OUT = path.join(ROOT, 'deliverables', 'ForgeERP-User-Manual-Hinglish-2026-11-08.docx')

// ---------------------------------------------------------------- palette
const P = {
  bg: '0E2A24', accent: '0F7B5F', accentSoft: 'E7F3EE',
  titleColor: 'FFFFFF', subtitleColor: 'C7D6D1', metaColor: '9DB0AA',
  body: '1B1B1B', head: '0F5F4B', head2: '123F35', secondary: '5B6B66', mono: '0A4D3C',
  table: { headerBg: '0F5F4B', headerText: 'FFFFFF', innerLine: 'CFE0DA', surface: 'F1F7F5', warn: 'FFF4E5', warnLine: 'E8A33D', ok: 'E9F6F0' },
}
const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: 'Calibri', cs: 'Calibri' }
const FONTH = { ascii: 'Calibri Light', hAnsi: 'Calibri Light', eastAsia: 'Calibri Light', cs: 'Calibri Light' }

const PAGE = { width: 11906, height: 16838 }
const MARGIN = { top: 1200, bottom: 1200, left: 1417, right: 1134 }
const CONTENT_TWIPS = PAGE.width - MARGIN.left - MARGIN.right // 9355
const CONTENT_PX = Math.round((CONTENT_TWIPS / 1440) * 96) // ≈ 624 px

const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const NO_BORDERS = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder }

// ---------------------------------------------------------------- helpers
function t(text, opts = {}) {
  return new TextRun({
    text, font: FONT, size: opts.size ?? 21, color: opts.color ?? P.body,
    bold: opts.bold, italics: opts.italics, break: opts.break,
  })
}
const p = (children, opts = {}) =>
  new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { before: opts.before ?? 0, after: opts.after ?? 150, line: opts.line ?? 300 },
    alignment: opts.align,
    indent: opts.indent,
    keepNext: opts.keepNext,
    pageBreakBefore: opts.pageBreakBefore,
    border: opts.border,
    shading: opts.shading,
  })

const h1 = (text) =>
  new Paragraph({
    children: [new TextRun({ text, font: FONTH, size: 34, bold: true, color: P.head })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 420, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 6 } },
    keepNext: true,
  })
const h2 = (text) =>
  new Paragraph({
    children: [new TextRun({ text, font: FONTH, size: 26, bold: true, color: P.head2 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120 },
    keepNext: true,
  })
const h3 = (text) =>
  new Paragraph({
    children: [new TextRun({ text, font: FONTH, size: 22, bold: true, color: P.accent })],
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 90 },
    keepNext: true,
  })

/** Numbered step paragraph (each step list gets its own reference). */
let stepRef = 0
const stepLists = []
function steps(items) {
  const ref = `steps-${++stepRef}`
  stepLists.push(ref)
  return items.map((item, i) =>
    new Paragraph({
      children: (Array.isArray(item) ? item : [item]).map((x) =>
        typeof x === 'string' ? t(x) : x instanceof TextRun ? x : t(x.text, { bold: x.bold, italics: x.italics }),
      ),
      numbering: { reference: ref, level: 0 },
      spacing: { after: 70, line: 290 },
      keepNext: i < items.length - 1 ? false : undefined,
    }),
  )
}

/** Callout box: info | warn | ok */
function callout(kind, children) {
  const fill = kind === 'warn' ? P.table.warn : kind === 'ok' ? P.table.ok : P.accentSoft
  const line = kind === 'warn' ? P.table.warnLine : kind === 'ok' ? P.accent : '9CC3B7'
  const label = kind === 'warn' ? 'DHYAAN DEIN' : kind === 'ok' ? 'YAAD RAKHEIN' : 'NOTE'
  return new Table({
    width: { size: CONTENT_TWIPS, type: WidthType.DXA },
    columnWidths: [CONTENT_TWIPS],
    borders: {
      top: noBorder, bottom: noBorder, right: noBorder,
      left: { style: BorderStyle.SINGLE, size: 18, color: line },
      insideHorizontal: noBorder, insideVertical: noBorder,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill },
            margins: { top: 130, bottom: 130, left: 170, right: 150 },
            children: [
              new Paragraph({
                spacing: { after: 40 },
                children: [t(label, { bold: true, size: 17, color: P.head })],
              }),
              ...(Array.isArray(children) ? children : [children]),
            ],
          }),
        ],
      }),
    ],
  })
}
const calloutText = (kind, text) =>
  callout(kind, p([t(text, { size: 20 })], { after: 0, line: 285 }))

/** Full-width figure with a numbered caption. */
let figNo = 0
function figure(file, caption, opts = {}) {
  const filePath = path.join(SHOTS, file)
  if (!fs.existsSync(filePath)) {
    console.warn('missing screenshot', file)
    return []
  }
  const buf = fs.readFileSync(filePath)
  const dim = imageSize(buf)
  const width = opts.width ?? CONTENT_PX
  const height = Math.round((dim.height / dim.width) * width)
  const maxH = opts.maxHeight ?? 760
  const scale = height > maxH ? maxH / height : 1
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  figNo += 1
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 140, after: 40 },
      keepNext: true,
      children: [new ImageRun({ type: 'png', data: buf, transformation: { width: w, height: h } })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      children: [
        t(`Chitra ${figNo}  ·  `, { bold: true, size: 17, color: P.accent }),
        t(caption, { size: 17, color: P.secondary, italics: true }),
      ],
    }),
  ]
}

/** Data table: headers + rows, weights in percent. */
function table(headers, rows, weights, opts = {}) {
  const total = weights.reduce((a, b) => a + b, 0)
  const widths = weights.map((w) => Math.round((w / total) * CONTENT_TWIPS))
  const cellBorder = { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine }
  const border = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder, insideHorizontal: cellBorder, insideVertical: cellBorder }
  const mk = (text, i, isHead) =>
    new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: isHead ? P.table.headerBg : 'FFFFFF' },
      margins: { top: 80, bottom: 80, left: 110, right: 100 },
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({
          spacing: { after: 0, line: 260 },
          children: [t(String(text), { size: 18, bold: isHead, color: isHead ? P.table.headerText : P.body })],
        }),
      ],
    })
  return new Table({
    width: { size: CONTENT_TWIPS, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: border,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((x, i) => mk(x, i, true)) }),
      ...rows.map((r, ri) =>
        new TableRow({
          cantSplit: true,
          children: r.map((c, i) => {
            const cell = mk(c, i, false)
            if (ri % 2 === 1) {
              cell.root[0].root[2] = cell.root[0].root[2] // no-op guard (kept simple)
            }
            return cell
          }),
        }),
      ),
    ],
    ...(opts.after ? { spacing: { after: opts.after } } : {}),
  })
}
function tableSpacer() {
  return p([t('', { size: 12 })], { after: 120 })
}

// ============================================================ COVER
function cover() {
  const meta = [
    ['Document', 'ForgeERP — User Manual (Hinglish)'],
    ['Version', 'Version 3.0 · 08 November 2026'],
    ['Audience', 'Owner, accountant, store keeper, supervisor aur shop-floor staff'],
    ['Language', 'Hinglish (Hindi + English) — UI labels English me hi rahenge'],
    ['Demo organization', 'Shree Forge Industries, Pune (FY 2627) · GSTIN 27AAECS1429B1ZR'],
    ['Demo login', 'owner@shreeforge.example.com / forge123'],
    ['Screenshots', `${fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png')).length} live screenshots (75 figures) — 08 Nov 2026 ko isi app par capture kiye gaye`],
  ]
  return [
    new Paragraph({ spacing: { before: 900, after: 0 }, children: [t('SHREE FORGE INDUSTRIES  ·  FY 2627  ·  MANUFACTURING · JOBWORK · GST', { bold: true, size: 17, color: P.accent })] }),
    new Paragraph({
      spacing: { before: 460, after: 0, line: 900 },
      children: [new TextRun({ text: 'ForgeERP', font: FONTH, size: 96, bold: true, color: P.head })],
    }),
    new Paragraph({
      spacing: { before: 240, after: 260 },
      children: [new TextRun({ text: 'User Manual — Software kaise chalayein', font: FONTH, size: 40, color: P.head2 })],
    }),
    new Paragraph({
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: P.accent, space: 12 } },
      spacing: { after: 520 },
      indent: { left: 220 },
      children: [t('Bilkul shuru se — login, masters, sales invoice, jobwork chain, production, reports, Tally export tak. Har screen ka screenshot aur uske neeche numbered steps.', { size: 22, color: P.secondary, italics: true })],
    }),
    new Table({
      width: { size: CONTENT_TWIPS, type: WidthType.DXA },
      columnWidths: [2100, CONTENT_TWIPS - 2100],
      borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine } },
      rows: meta.map(
        ([k, v], i) =>
          new TableRow({
            cantSplit: true,
            children: [
              new TableCell({
                width: { size: 2100, type: WidthType.DXA },
                margins: { top: 90, bottom: 90, left: 0, right: 120 },
                borders: { top: noBorder, left: noBorder, right: noBorder, bottom: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine } },
                children: [new Paragraph({ children: [t(k, { bold: true, size: 19, color: P.head })] })],
              }),
              new TableCell({
                width: { size: CONTENT_TWIPS - 2100, type: WidthType.DXA },
                margins: { top: 90, bottom: 90, left: 0, right: 0 },
                borders: { top: noBorder, left: noBorder, right: noBorder, bottom: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine } },
                children: [new Paragraph({ children: [t(v, { size: 19 })] })],
              }),
            ],
          }),
      ),
    }),
  ]
}

// ============================================================ CONTENT
const body = []

// ---------------------------------------------------------------- 0. intro
body.push(h1('1. Is manual ko kaise padhein'))
body.push(
  p([
    t('Ye guide zero se expert tak le jaati hai. '),
    t('Order se padhein', { bold: true }),
    t(' — pehle login aur setup, phir ek-ek module. Har section me screenshot hai, aur uske neeche wahi kaam karne ke steps. Steps me jo shabd '),
    t('bold', { bold: true }),
    t(' hain wahi button ya field ka naam hai jo screen par likha milega.'),
  ]),
)
body.push(
  table(
    ['Section', 'Aap kya seekhenge'],
    [
      ['1–2. Shuruat', 'Login, screen layout, navigation, keyboard shortcuts'],
      ['3. Pehla setup', 'Company profile → parties → items → warehouses → opening stock'],
      ['4. Dashboard', 'Roz ka review: KPI cards, trend, low stock'],
      ['5. Sales', 'GST tax invoice banana, print, Tally/e-Invoice, payment receive'],
      ['6. Purchase', 'Supplier bill, input GST, procurement aur returns'],
      ['7. Jobwork', 'Inward → Job Card → Certificate → Invoice (core chain)'],
      ['8. Own manufacturing', 'Projects, BOM, MRP, work orders, capacity, OEE, costing, quality'],
      ['9. Inventory', 'Stock summary, ledger, lots & serials, adjustments'],
      ['10. Accounting', 'Payments, party ledger, journals, chart of accounts'],
      ['11. Reports', 'GSTR-1/3B, trial balance, outstanding, P&L, aging aur baaki'],
      ['12. CRM & Service', 'Leads, salespersons, performance, service calls'],
      ['13. Tally + e-Invoice', 'Masters XML, vouchers, connector, GST portal JSON'],
      ['14. Audit + Docs', 'Har action ka log, in-app technical docs'],
      ['15. Roz / hafte / mahine ka SOP', 'Practical routine checklist'],
      ['16. Troubleshooting', 'Common errors aur unka seedha fix'],
    ],
    [26, 74],
  ),
)
body.push(tableSpacer())
body.push(calloutText('warn', 'Is manual ke saare screenshots demo data (Shree Forge Industries) ke hain. Aapke system me company ka naam, GSTIN, party/item naam aur amounts alag honge — screen, buttons aur flow wahi rahenge.'))

body.push(...figure('02-dashboard.png', 'Poora screenshot lekin pehchaan ek — Dashboard: quick actions, KPI cards, sales vs purchase trend aur low-stock list.'))

// ---------------------------------------------------------------- 2. login
body.push(h1('2. Login aur screen samajhna'))

body.push(h2('2.1 Kaun-kaun login kar sakta hai'))
body.push(
  p([
    t('ForgeERP SaaS style multi-organization software hai. Har organization ka '),
    t('apna login', { bold: true }),
    t(' hota hai — ek organization ka user doosri organization ka data nahi dekh sakta. Login screen par do raste hain:'),
  ]),
)
body.push(
  table(
    ['Login type', 'Email ka pattern', 'Kya milta hai'],
    [
      ['Owner / staff (organization)', 'owner@yourcompany.com', 'Poora ERP workspace — sales, purchase, jobwork, production, reports'],
      ['Platform staff', 'Admin console se', 'Sirf Platform Admin console — plans, organizations, trial/suspend (ERP books nahi)'],
    ],
    [30, 30, 40],
  ),
)
body.push(tableSpacer())

body.push(h2('2.2 Login karne ke steps'))
body.push(...steps([
  'Browser me apni company ka ForgeERP URL kholein (jaise http://localhost:3000 ya aapka domain).',
  [t('Email', { bold: true }), ' field me apna login email daalein.'],
  [t('Password', { bold: true }), ' daalein aur ', t('Sign in', { bold: true }), ' dabayein.'],
  'Sahi login par Dashboard khul jaata hai. Galat password par sirf "Invalid email or password" aata hai — dobara guess karne ke bajaye admin se reset karwayein.',
  'Shared computer par kaam khatam hone par top-right avatar → Sign out zaroor karein.',
]))
body.push(...figure('01-login.png', 'Login screen — demo credentials bhare hue. Production me apna email/password use karein.'))
body.push(calloutText('warn', 'Pehli baar login kar rahe hain aur "Create your owner login" screen aaye? Iska matlab company profile pehle se hai par koi login nahi bana. Ek baar owner login bana lein — uske baad wo screen dobara nahi aayegi.'))

body.push(h2('2.3 Screen ke 5 hisse'))
body.push(
  table(
    ['Hissa', 'Kya hota hai'],
    [
      ['Top bar', 'Global search ("Search or jump to…", Ctrl+K), GSTIN, FY code, aaj ki date, company ka naam, account menu (avatar)'],
      ['Left sidebar', 'Modules — Dashboard, CRM & Service, Sales, Purchase, Customer Jobwork, Own Projects & Mfg, Inventory, Accounting, Reports, Masters, Tally Export, Audit Trail'],
      ['Main area', 'Selected module ki list, tabs, forms aur reports'],
      ['Footer', 'Product line + "see Docs" (technical reference)'],
      ['Mobile (≤390px)', 'Bottom tab bar (Home / Sales / Purchase / Jobwork / Stock) aur top-left menu icon (teen lines) se poora sidebar drawer'],
    ],
    [22, 78],
  ),
)
body.push(tableSpacer())

body.push(h2('2.4 Keyboard shortcuts'))
body.push(
  p([
    t('Har module side bar se khul sakta hai, lekin roz ka kaam tez karne ke liye shortcuts hain. '),
    t('?', { bold: true }),
    t(' dabane par poori list screen par aa jaati hai.'),
  ]),
)
body.push(
  table(
    ['Keys', 'Kya hoga'],
    [
      ['Ctrl / ⌘ + K  (ya  /)', 'Command palette — kahin se bhi kuch bhi search karein ya kholen'],
      ['g  phir  d / c / s / p / j / b / i / a / r / m / t / u / o', 'Dashboard / CRM / Sales / Purchase / Jobwork / Manufacturing / Inventory / Accounting / Reports / Masters / Tally / Audit / Docs'],
      ['Alt + S', 'Kahin se bhi naya Sales Invoice'],
      ['Alt + P', 'Kahin se bhi naya Purchase Invoice'],
      ['?', 'Shortcut help dialog'],
      ['Esc', 'Palette / dialog band karein'],
    ],
    [34, 66],
  ),
)
body.push(tableSpacer())

body.push(...figure('04-shortcuts.png', 'Keyboard shortcuts dialog — "?" dabane par. Ctrl+K palette, g-then-key module jump, Alt+S/Alt+P naya document.'))

body.push(h2('2.5 Command palette — sabse tez raasta'))
body.push(...steps([
  [t('Ctrl + K', { bold: true }), ' dabayein (ya top bar ke search box par click karein).'],
  'Type karna shuru karein — jaise party ka naam, item ka code, ya invoice number.',
  'Natija teen tarah ke aate hain: create actions, recent screens, aur live search results (parties, items, invoices, jobwork).',
  'Kisi bhi result par click karein — seedha wahi screen/record khul jaata hai.',
]))
body.push(...figure('03-command-palette.png', 'Command palette — "mahindra" type karne par party, invoices aur jobwork ek saath.'))

body.push(h2('2.6 Mobile / tablet par kaam karna'))
body.push(
  p([
    t('Phone par bhi poora ERP chalta hai — layout apne aap badal jaata hai. 390px se chhoti screen par '),
    t('bottom tab bar', { bold: true }),
    t(' (Home / Sales / Purchase / Jobwork / Stock) aa jaata hai aur poora sidebar '),
    t('menu icon (top-left)', { bold: true }),
    t(' ke peeche chhup jaata hai.'),
  ]),
)
body.push(...steps([
  'Browser me wahi URL kholein — alag app install karne ki zaroorat nahi.',
  [t('Menu icon', { bold: true }), ' (top-left, teen lines) dabayein — poora sidebar drawer me khul jaata hai.'],
  'Bottom bar se roz ke 5 kaam ek tap me — Home, Sales, Purchase, Jobwork, Stock.',
  'Form bharte waqt keyboard khulta hai; number fields me numeric keypad aata hai.',
  'Kaam khatam hone par avatar → Sign out (shared phone par zaroor).',
]))
body.push(...figure('64-mobile-dashboard.png', 'Mobile dashboard — quick actions 2-column grid me, KPI cards neeche, aur bottom tab bar.'))
body.push(...figure('65-mobile-drawer.png', 'Mobile drawer (menu icon) — poora sidebar (Overview, Transactions, Manufacturing, Books, Setup) mobile par.'))

// ---------------------------------------------------------------- 3. setup
body.push(h1('3. Pehla setup — sahi order'))
body.push(
  p([
    t('Naye system par kaam shuru karne se pehle ye order follow karein. '),
    t('Galat order me transaction fail hoga', { bold: true }),
    t(' — jaise party bane bina invoice nahi ban sakti, aur item bane bina stock nahi aa sakta.'),
  ]),
)
body.push(
  table(
    ['#', 'Kya karein', 'Kahan', 'Kyun pehle'],
    [
      ['1', 'Company profile bharein', 'Masters → Company', 'GSTIN, state, bank details invoice par print hote hain'],
      ['2', 'Parties banayein', 'Masters → Parties', 'Har invoice/पेमेंट ko party chahiye'],
      ['3', 'Items banayein', 'Masters → Items', 'HSN, UOM, GST %, rate invoice par jaate hain'],
      ['4', 'Warehouses check karein', 'Masters → Warehouses', 'Stock kis godown me hai — MAIN / JW store'],
      ['5', 'Processes aur party rates', 'Masters → Processes / Party Rates', 'Jobwork rate calculation ke liye'],
      ['6', 'Opening stock daalein', 'Inventory → Opening Stock', 'Aaj ka stock, purchases se pehle'],
      ['7', 'Pehla purchase bill', 'Purchase → New Purchase', 'Stock aur input GST ledger me aata hai'],
    ],
    [6, 24, 26, 44],
  ),
)
body.push(tableSpacer())

body.push(h2('3.1 Company profile'))
body.push(...steps([
  [t('Masters', { bold: true }), ' → ', t('Company', { bold: true }), ' tab kholein.'],
  'Trade name, legal name, GSTIN, state (27-Maharashtra), address, pincode, phone, email bharein.',
  'Bank name, account number, IFSC aur UPI ID daalein — ye invoice ke bank block me print honge.',
  [t('Save', { bold: true }), ' dabayein.'],
]))
body.push(...figure('10-masters-company.png', 'Company profile — GSTIN, address aur bank details invoice par print hote hain.'))
body.push(calloutText('warn', 'GSTIN ka aakhri character checksum hota hai. Galat akshar par app mana kar dega: "Invalid GSTIN — checksum failed". e-Invoice ke liye buyer ka GSTIN aur 6-digit pincode zaroori hai.'))

body.push(h2('3.2 Nayi party (customer / supplier) banayein'))
body.push(...steps([
  [t('Masters', { bold: true }), ' → ', t('Parties', { bold: true }), ' → ', t('New Party', { bold: true }), '.'],
  [t('Code', { bold: true }), ' (jaise CUST-010) aur ', t('Name', { bold: true }), ' bharein — dono zaroori hain.'],
  [t('Types', { bold: true }), ' me tick karein: CUSTOMER (bikri), SUPPLIER (kharid), JOBWORKER — ek saath kai bhi ho sakte hain.'],
  [t('GSTIN', { bold: true }), ' bharein (15 akshar). B2C / unregistered party ke liye khaali chhod dein.'],
  'State, address, city, pincode (6 ank, e-Invoice ke liye), phone, email bharein.',
  [t('Opening Balance', { bold: true }), ' sirf tab bharein jab pehle se udhaar hai: + = receivable (customer), − = payable (supplier).'],
  'Credit limit aur credit days (payment terms) set karein — sales order approval aur aging report inhi se chalti hai.',
  [t('Create party', { bold: true }), ' dabayein.'],
]))
body.push(...figure('05c-masters-new-party.png', 'New Party form — code, name, types, GSTIN, state, pincode aur credit settings.'))
body.push(...figure('05-masters-parties.png', 'Parties list — code, name, types, GSTIN, state, city, opening balance aur status.'))
body.push(calloutText('ok', 'Party par click / eye button dabane se party ka poora view khulta hai — receivables, payables aur voucher history ke saath. Wahan se seedha "New Invoice", "Receive Payment" ya "Party Ledger" bhi khul jaata hai.'))

body.push(...figure('11-masters-party-view.png', 'Party view — profile, receivable/payable, aur ek click me next action (New Invoice / Receive Payment / Party Ledger).'))

body.push(h2('3.3 Items'))
body.push(...steps([
  [t('Masters', { bold: true }), ' → ', t('Items', { bold: true }), ' → ', t('New Item', { bold: true }), '.'],
  [t('Code', { bold: true }), ' (FG-1001 finished goods, RM-2001 raw material — prefix se pehchaan aasan rehti hai) aur naam bharein.'],
  [t('Group', { bold: true }), ': Finished Goods / Raw Material / Services.'],
  [t('HSN', { bold: true }), ' 6 ya 8 ank ka daalein — 4 ank wali HSN e-Invoice me reject hoti hai.'],
  [t('UOM', { bold: true }), ' (PCS, KGS, KG, SET, LTR) aur ', t('GST %', { bold: true }), ' daalein.'],
  [t('Sale rate aur cost rate bharein; '), t('reorder level', { bold: true }), ' daalein — isse neeche stock jate hi low-stock alert aata hai.'],
  [t('Service item hai to '), t('Service', { bold: true }), ' flag on karein (stock track nahi hoga).'],
]))
body.push(...figure('06-masters-items.png', 'Items list — code, group, HSN, UOM, GST %, sale/cost rate, reorder level aur flags.'))

body.push(h2('3.4 Warehouses aur Processes'))
body.push(
  p([
    t('Demo me do warehouse hain: '),
    t('MAIN', { bold: true }),
    t(' (Main Stores) aur '),
    t('JW', { bold: true }),
    t(' (Jobwork Store). Jobwork ka finished material JW store me rehta hai, taaki aapke apne stock se mix na ho.'),
  ]),
)
body.push(...figure('07-masters-warehouses.png', 'Warehouses — MAIN (apna stock) aur JW (customer material / jobwork ka maal).'))
body.push(
  p([
    t('Processes', { bold: true }),
    t(' tab me har jobwork process ka rate hota hai, teen basis par: '),
    t('per KG', { bold: true }),
    t(' (weight), '),
    t('per piece', { bold: true }),
    t(' (qty) aur '),
    t('per lot', { bold: true }),
    t('. Lot charge process ke hisaab se alag judta hai.'),
  ]),
)
body.push(...figure('08-masters-processes.png', 'Processes — Shot Blasting, Heat Treatment, Galvanizing, CNC, QC, Packing aur unke rate + lot charge.'))
body.push(...figure('09-masters-party-rates.png', 'Party Rates — kisi ek party ke liye har process ka rate override (OVERRIDDEN badge changed row dikhata hai).'))

// ---------------------------------------------------------------- 4. dashboard
body.push(h1('4. Dashboard — roz ka cockpit'))
body.push(
  p([
    t('Login karte hi Dashboard khulta hai. Iska kaam sirf ek hai: '),
    t('ek nazar me batao ki aaj kya dhyaan chahiye', { bold: true }),
    t('.'),
  ]),
)
body.push(
  table(
    ['Card / block', 'Matlab', 'Click karne par'],
    [
      ['Month sales / Month purchase', 'Is mahine ke POSTED invoices ka total', 'Sales / Purchase list'],
      ['Receivables', 'Customers se aana baaki (outstanding)', 'Reports → Outstanding'],
      ['Payables', 'Suppliers ko dena baaki', 'Reports → Outstanding'],
      ['Stock value', 'Weighted-average cost par closing stock value', 'Inventory → Stock Summary'],
      ['Open jobwork', 'Complete ho chuke job cards jo abhi invoice nahi hue', 'Customer Jobwork'],
      ['Projects & tasks', 'Running projects / pending tasks', 'Own Projects & Mfg'],
      ['Sales vs purchase chart', 'Last 6 mahine ka trend', '—'],
      ['Low stock list', 'Reorder level se neeche items', 'Inventory'],
      ['Quick actions', 'New Sales Invoice, New Purchase, Jobwork Inward, Record Payment, Stock Snapshot, Tally Export', 'Seedha create form'],
    ],
    [26, 44, 30],
  ),
)
body.push(tableSpacer())
body.push(calloutText('ok', 'Roz subah 2 minute: Dashboard kholen → Receivables dekhein → Low stock dekhein → Action Center (Reports) me overdue tasks dekhein. Bas.'))
body.push(...figure('02-dashboard.png', 'Dashboard — quick actions, 7 KPI cards, 6-mahine ka trend, low stock.'))

// ---------------------------------------------------------------- 5. sales
body.push(h1('5. Sales — GST tax invoice banana'))
body.push(
  p([
    t('Sales module me invoice post karte hi '),
    t('teen cheezein ek saath', { bold: true }),
    t(' banti hain: invoice, stock ledger entry (maal bahar) aur double-entry GL (Dr Debtors / Cr Sales + GST). Teeno ek transaction me — aadha-adhoora record kabhi nahi bachta.'),
  ]),
)
body.push(...figure('12-sales-list.png', 'Sales Invoices list — 5 posted invoices (Σ ₹2,83,630 · outstanding ₹2,43,630), source (MANUAL / JOBWORK) aur status. Filter chip se status ke hisaab se list chhanti hai.'))

body.push(h2('5.1 Naya invoice — step by step'))
body.push(...steps([
  [t('Sales', { bold: true }), ' → ', t('New Invoice', { bold: true }), ' (ya kahin se bhi ', t('Alt + S', { bold: true }), ').'],
  [t('Customer', { bold: true }), ' chunein — Place of Supply party ke state se apne aap set ho jaata hai.'],
  'Date, PO / Challan No check karein.',
  [t('Stock From', { bold: true }), ' warehouse chunein — availability usi warehouse me check hoti hai.'],
  [t('Rates are tax-inclusive', { bold: true }), ' switch on karein agar aapke rate me GST already shamil hai (back-solve ho jaayega).'],
  'Line me Item chunein, Detail likhein, Qty aur Rate daalein. Disc % se trade discount dein.',
  [t('Add line', { bold: true }), ' se aur items jodein — totals neeche live update hote hain.'],
  [t('Post Invoice', { bold: true }), ' dabayein — invoice number apne aap banta hai (FY wise series).'],
]))
body.push(...figure('13-sales-new-invoice.png', 'New Sales Invoice — customer, date, place of supply, lines aur live GST preview (report = print = posted totals).'))
body.push(calloutText('warn', 'Jis item ka stock nahi hai use bech nahi sakte — error aayega "Insufficient stock". Pehle Purchase bill ya Opening Stock se stock andar laayein. Jobwork ka maal JW store me hota hai, MAIN me nahi.'))

body.push(h2('5.2 Invoice detail — aage kya karein'))
body.push(
  p([
    t('List me kisi bhi invoice par click karein. Detail screen par poora GST invoice print-view aur upar action buttons milte hain:'),
  ]),
)
body.push(
  table(
    ['Button', 'Kya karta hai'],
    [
      ['Receive Payment', 'Payment dialog khulta hai — party, balance amount aur is invoice ki allocation pehle se bhare hue'],
      ['Make Payment', 'Purchase invoice par — supplier ko payment'],
      ['Duplicate', 'Wahi invoice copy ban jaati hai (repeat customer ke liye tez)'],
      ['Tally', 'Dropdown — Tally XML / JSON / CSV / .bat / masters / e-Invoice JSON'],
      ['Print', 'A4 print / PDF — IRN/QR wala GST invoice'],
      ['Cancel Invoice', 'Invoice cancel — stock aur GL dono mirror-reverse ho jaate hain (delete nahi)'],
    ],
    [26, 74],
  ),
)
body.push(tableSpacer())
body.push(...figure('14-sales-invoice-detail.png', 'Invoice detail (INV-2627-004, jobwork) — status badge, Receive Payment / Duplicate / Tally / Print / Cancel, poora tax invoice with HSN, amount in words aur bank details.'))
body.push(...figure('14b-sales-invoice-005.png', 'Invoice detail — action buttons, poora tax invoice, HSN summary, amount in words, bank details.'))
body.push(...figure('15-sales-tally-menu.png', 'Tally dropdown — har document se ek click me XML/JSON/CSV, .bat importer, masters aur GST portal ka e-Invoice JSON.'))
body.push(calloutText('ok', 'Invoice post hone ke baad toast par "View" ka action aata hai. Isse seedha naya invoice khul jaata hai — list me wapas jaane ki zaroorat nahi.'))

body.push(h2('5.3 Quote to Cash (quotation → order → delivery → invoice)'))
body.push(
  p([
    t('Bade orders ke liye '),
    t('Quote to Cash', { bold: true }),
    t(' tab use karein. Flow: Sales Quotation → (accept hone par) Sales Order → Delivery Challan (QC ke saath) → Invoice. Har step pichhle step se qty carry karta hai, isliye double entry nahi hoti.'),
  ]),
)
body.push(...figure('16-sales-quote-to-cash.png', 'Quote to Cash — Quotations, Sales Orders aur Delivery & QC ek hi jagah.'))

// ---------------------------------------------------------------- 6. purchase
body.push(h1('6. Purchase — supplier bill aur input GST'))
body.push(
  p([
    t('Purchase invoice post karne par stock andar aata hai (weighted-average cost par) aur input GST ledger me jaata hai: Dr Purchase + Dr Input GST / Cr Supplier.'),
  ]),
)
body.push(...steps([
  [t('Purchase', { bold: true }), ' → ', t('New Purchase', { bold: true }), ' (ya ', t('Alt + P', { bold: true }), ').'],
  'Supplier chunein, uski bill ka number aur date daalein.',
  'Lines me item, qty aur rate bharein — GST rate item se aata hai.',
  [t('Post', { bold: true }), ' karein — PIN-2627-### series ka number ban jaata hai.'],
]))
body.push(...figure('17-purchase-list.png', 'Purchase bills — PIN-2627-001 (₹2,89,100, partial paid) aur PIN-2627-002 (₹97,350).'))
body.push(...figure('18-purchase-new-bill.png', 'New Purchase Invoice dialog — Supplier, Date, Tax split (state se apne aap CGST+SGST ya IGST), PO / Challan No, Stock From warehouse, line items aur neeche live GST preview. "Rates are tax-inclusive" toggle se inclusive rate se back-solve ho jaata hai.'))

body.push(h2('6.1 Procurement & Returns (advanced)'))
body.push(
  table(
    ['Sub-tab', 'Kaam'],
    [
      ['Requisitions', 'Department ki demand — approval ke baad PO banti hai (MRP se bhi auto suggest)'],
      ['RFQ & Comparison', 'Kai suppliers se quote lo, side-by-side compare karke award karo'],
      ['Purchase Orders', 'Supplier ko order — open qty track hoti hai'],
      ['GRN & QC', 'Maal aane par receipt; QC pass hone par hi stock ledger me asli receipt'],
      ['Three-way Match', 'PO ↔ GRN ↔ bill ka reconciliation — mismatch pakda jaata hai'],
      ['Returns & Notes', 'Kharab/short maal ka return, debit note / credit note'],
    ],
    [26, 74],
  ),
)
body.push(tableSpacer())
body.push(...figure('19-purchase-procurement.png', 'Procurement & Returns — requisition se PO, GRN/QC, three-way match aur returns tak ka poora chain.'))
body.push(calloutText('warn', 'GRN ke baad hi stock ledger me maal dikhta hai. Sirf PO banane se stock nahi badhta — ye jaan-boojh kar aisa hai, warna book me aisa maal aa jaata jo godown me nahi hai.'))

// ---------------------------------------------------------------- 7. jobwork
body.push(h1('7. Customer Jobwork — is software ki sabse khaas chain'))
body.push(
  p([
    t('Foundry / machining ka asli kaam: customer apna kachcha maal deta hai → aap process karte hain → certificate dete hain → service ka GST invoice banate hain. Ye poora chain ek hi jagah chalta hai: '),
    t('Inward → Job Card → Certificate → Invoice', { bold: true }),
    t('. Customer ka maal aapke apne stock se alag (JW store) rehta hai aur aapki stock valuation me nahi ginte.'),
  ]),
)
body.push(
  table(
    ['Step', 'Screen', 'Kya hota hai'],
    [
      ['1. Inward', 'Customer Jobwork → New Inward', 'Customer ka maal, qty/weight aur batch record hota hai (value-neutral)'],
      ['2. Job Card', 'Inward kholen → New Job Card', 'Kis item par kaun-kaun se process, kitni qty/weight — cost estimate dikhta hai'],
      ['3. Certificate', 'Inward kholen → Issue Certificate', 'Kaam ka proof — process-wise detail ke saath'],
      ['4. Invoice', 'Inward kholen → Generate Invoice', 'Jobwork service ka GST invoice (SAC 998887) apne aap ban jaata hai'],
    ],
    [16, 30, 54],
  ),
)
body.push(tableSpacer())
body.push(...figure('20-jobwork-inwards.png', 'Inwards list — JWI number, party, items, progress bar (processed / total), card value aur status.'))
body.push(...figure('21-jobwork-pending.png', 'Pending tab — har item ka received / processed / remaining qty aur pending processes ek nazar me.'))

body.push(...figure('22-jobwork-open-inward.png', 'Naya inward (JWI-2627-002, OPEN) — 0 / 200 pcs processed, items + batch, Job Cards (0) aur "No job cards yet". Yahin se New Job Card shuru hota hai.'))
body.push(...figure('23-jobwork-inward-detail.png', 'Poora ho chuka inward (JWI-2627-001, INVOICED) — 350 / 350 pcs, do completed job cards (JC-2627-001 / -002) aur issued certificate CERT-2627-001. Yeh hai "khatam" ki tasveer.'))

body.push(h2('7.1 Naya job card banayein'))
body.push(...steps([
  'Jis inward par kaam karna hai use kholen (jaise JWI-2627-002).',
  [t('New Job Card', { bold: true }), ' dabayein.'],
  'Date aur notes bharein; jo items process karne hain unko tick karein — Qty aur Weight badal sakte hain (partial processing allowed, remaining qty dikhti rehti hai).',
  'Processes tick karein (Shot Blasting, Heat Treatment, CNC, QC, Packing…). Rate party rate se aayega, warna process default se — neeche live estimate dikh jaata hai.',
  [t('Post Job Card', { bold: true }), ' dabayein. Card number JC-2627-### ban jaata hai.'],
]))
body.push(...figure('24-jobwork-new-job-card.png', 'New Job Card dialog — items (remaining qty ke saath), qty/weight aur process selection.'))
body.push(...figure('24b-jobwork-job-card-filled.png', 'New Job Card dialog bhara hua — items tick, qty + weight, do process (Shot Blasting per KG, CNC per piece), aur neeche live ESTIMATE: ₹27,090.00. Server party-specific rate lagata hai aur 5% tolerance se over-processing rokta hai.'))
body.push(calloutText('ok', 'Ek inward par kai job cards ban sakte hain (partial processing). Har card alag se track hota hai — kisi ek card me galti ho to sirf wahi card cancel karein.'))

body.push(h2('7.2 Certificate aur invoice'))
body.push(...steps([
  [t('Poora kaam ho jane par '), t('Issue Certificate', { bold: true }), ' dabayein — CERT-2627-### ban jaata hai.'],
  [t('Ab '), t('Generate Invoice', { bold: true }), ' active ho jaata hai — dabayein.'],
  'Invoice me jobwork services line-wise aati hain (process ke hisaab se), GST 18% aur SAC 998887 ke saath.',
  [t('Banane ke baad invoice Sales list me '), t('JOBWORK', { bold: true }), ' source ke saath dikhti hai.'],
]))
body.push(...figure('24c-jobwork-after-job-card.png', 'Job card post hone ke baad — quantity 200/200 pcs aur weight 515/515 kg 100%, job card value ₹27,090.00. Ab Issue Certificate dabayein.'))
body.push(...figure('24d-jobwork-certificate.png', 'Certificate issue hone ke baad — badge COMPLETED, card ke neeche "1 completed card · certificate issued", aur Generate Invoice ab dabaya ja sakta hai.'))
body.push(...figure('24e-jobwork-generate-invoice.png', 'Invoice ban jaane ke baad — status INVOICED. Ab is inward par naye job cards band; customer ka naya kaam aaye to naya inward banayein.'))
body.push(...figure('24f-jobwork-invoice-created.png', 'Jobwork invoice ban jaane ke baad Sales list — INV-2627-006 (JOBWORK source) apne aap add ho jaati hai.'))
body.push(calloutText('warn', 'Invoice banne ke baad us inward par naye job cards band ho jaate hain (INVOICED). Agar customer aur kaam de, to naya inward banayein — purane record ko chhedne ki zaroorat nahi.'))

// ---------------------------------------------------------------- 8. manufacturing
body.push(new Paragraph({ children: [new PageBreak()] }))
body.push(h1('8. Own Projects & Manufacturing'))
body.push(
  p([
    t('Yahan '),
    t('aapke apne maal', { bold: true }),
    t(' ka production hota hai — customer ka nahi (wo Customer Jobwork me hai). Flow: '),
    t('Project → BOM → Work Order → Operation Tasks → FG Receipt', { bold: true }),
    t('. Sidebar me module ke neeche groups khud khul jaate hain: Plan, Shop floor, Setup, Analyse.'),
  ]),
)
body.push(...figure('25-mfg-projects.png', 'Own Projects & Mfg — KPI cards (running / open WO / unassigned / WIP / completed) aur projects list.'))
body.push(...figure('30-mfg-work-orders.png', 'Work Orders — WO number, project, priority, schedule, lines, task progress aur cost.'))

body.push(h2('8.1 BOM (Bill of Material)'))
body.push(...steps([
  ['Plan → ', t('BOMs', { bold: true }), ' → ', t('New BOM', { bold: true }), '.'],
  'Output item chunein (jo banega) aur project link karein.',
  'Lines me raw material aur uski qty-per-unit (wastage ke saath) daalein.',
  'Labour cost aur standard minutes bharein — costing isi par chalegi.',
  [t('Approve', { bold: true }), ' karein — approved revision ' , t('immutable', { bold: true }), ' ho jaata hai. Design badalna ho to ', t('Revise', { bold: true }), ' karein (naya revision banega, purana supersede hoga).'],
]))
body.push(...figure('26-mfg-boms.png', 'BOMs — output item, project, lines, estimated cost, stock check aur status (DRAFT / APPROVED).'))
body.push(calloutText('warn', 'Approved BOM ko edit nahi kiya jaa sakta — ye jaan-boojh kar hai, taaki jo maal us BOM se bana hai uski cost baad me badal na jaaye. Change chahiye to Revise dabayein.'))

body.push(h2('8.2 MRP — kitna kharidna, kitna banana'))
body.push(
  p([
    t('MRP approved sales orders aur released work orders se demand nikaal kar BOM ke through explode karta hai, phir supply se net karta hai: apna stock → open work orders → approved PO → approved requisition. Result '),
    t('suggestion', { bold: true }),
    t(' hota hai — jab tak aap select karke approve nahi karte, kuch bhi purchase ya produce nahi hota.'),
  ]),
)
body.push(...steps([
  ['Plan → ', t('MRP', { bold: true }), '.'],
  [t('As-of date aur '), t('Horizon (days)', { bold: true }), ' daalein (jaise 30 / 60 din).'],
  [t('Run MRP', { bold: true }), ' dabayein.'],
  'Lines dekhein: kitna chahiye, kitna available, kitna short — aur suggestion BUY hai ya MAKE.',
  'Jo suggestions sahi lagein unko select karke approve karein — requisition / draft work order ban jaate hain.',
]))
body.push(...figure('27-mfg-mrp.png', 'MRP tab pehli baar khulta hua — As of date + Horizon (30 din) bharein aur Run MRP dabayein. Pehli baar "No MRP run yet" dikhta hai; run karne ke baad yahin demand, supply netting aur BUY/MAKE suggestion list aati hai. Kuch bhi apne aap purchase nahi hota.'))
body.push(...figure('28-mfg-material-plan.png', 'Material Plan — active production demand vs stock, PO supply aur shortage / projected shortage.'))
body.push(calloutText('warn', 'MRP reservation nahi karta — sirf planning supply ghatata hai. Do plan ek hi quantity suggest kar sakte hain. Isliye approve karne se pehle "Material Plan" jaroor dekh lein.'))

body.push(h2('8.3 Capacity aur OEE'))
body.push(
  p([
    t('Capacity', { bold: true }),
    t(' tab har work centre ke shift calendar, parallel capacity aur route sequence ke hisaab se batata hai ki kaam kab tak hoga. Ye sirf '),
    t('report', { bold: true }),
    t(' karta hai — apne aap shop floor ka sequence nahi badalta. Utilisation 100% se zyada ho to matlab horizon me kaam fit nahi ho raha.'),
  ]),
)
body.push(...figure('29-mfg-capacity.png', 'Capacity — work-centre-wise load vs capacity aur operation schedule (late work orders bhi).'))
body.push(
  p([
    t('OEE', { bold: true }),
    t(' = Availability × Performance × Quality. Availability machine ke planned vs actual time se, Performance routed cycle time se, Quality produced vs good qty se aata hai.'),
  ]),
)
body.push(...figure('34-mfg-oee.png', 'OEE — overall number, availability / performance / quality split aur work-centre-wise sabse badi loss.'))
body.push(calloutText('warn', '0% OEE ka matlab ye nahi ki machine kharab hai — agar us hafte koi operation complete nahi hua to performance aur quality 0 aate hain. Number dekhne se pehle "Read this before trusting the numbers" box padhein.'))

body.push(h2('8.4 Costing — standard vs actual'))
body.push(
  p([
    t('Har work order par teen paise ke bucket alag rehte hain: '),
    t('material', { bold: true }),
    t(' (issue cost par), '),
    t('labour', { bold: true }),
    t(' (worker ke rate par) aur '),
    t('overhead', { bold: true }),
    t(' (company ke overhead % par prime cost ka). Standard BOM approval ke time freeze hota hai, actual floor se aata hai.'),
  ]),
)
body.push(...figure('35-mfg-costing.png', 'Costing — standard vs actual vs variance, overhead absorbed, aur work-order-wise breakdown.'))
body.push(...figure('36-mfg-overhead.png', 'Overhead — absorption rate aur uske calculation ka audit trail.'))
body.push(calloutText('warn', 'Overhead absorption ek policy switch hai (Company me set hota hai). Jab tak accountant se confirm na ho, isko 0 rakhein — warna WIP aur FG receipt ki value badal jaayegi.'))

body.push(h2('8.5 Shop floor ke baaki screens'))
body.push(...figure('31-mfg-tasks.png', 'Tasks — operation tasks, worker assignment, status aur overdue flags.'))
body.push(...figure('31b-mfg-pending.png', 'Pending — kya pending hai, kis par, aur kitna time late.'))
body.push(...figure('32-mfg-fg-receipts.png', 'FG Receipts — production se finished goods receipt (serial / lot capture ke saath).'))
body.push(...figure('33-mfg-work-centers.png', 'Work Centers — machine / bench, parallel capacity aur cost per hour.'))
body.push(...figure('33b-mfg-employees.png', 'Employees — worker, skill aur rate (labour costing isi rate par hoti hai).'))
body.push(...figure('37-mfg-quality.png', 'Quality — inspection template, measurements aur pass/fail.'))
body.push(calloutText('ok', 'Manufacturing module ka rule: customer ka maal Customer Jobwork me, apna maal Own Projects & Mfg me. Do jagah ka data kabhi mix nahi hota — reports aur stock valuation dono saaf rehte hain.'))

// ---------------------------------------------------------------- 9. inventory
body.push(h1('9. Inventory — stock ka poora sach'))
body.push(
  p([
    t('Stock ledger niyam par chalta hai: '),
    t('koi bhi column seedha edit nahi hota', { bold: true }),
    t('. Har entry kisi voucher se aati hai (purchase, sales, jobwork, adjustment) aur cancel hone par mirror-reverse hoti hai. Valuation weighted-average cost par.'),
  ]),
)
body.push(
  table(
    ['Tab', 'Kya dikhta hai'],
    [
      ['Stock Summary', 'Item-wise in / out / closing qty, average cost, closing value, aur low-stock flag'],
      ['Stock Ledger', 'Har movement — OPENING, PURCHASE, SALES, JOBWORK_IN, adjustment, reversal — running balance ke saath'],
      ['Opening Stock', 'Aaj ka shuruaati stock daalne ki jagah (GL bhi banta hai)'],
      ['Lots & Serials', 'Batch-wise stock, serial numbers aur genealogy (kis lot se kya bana)'],
      ['Adjustments', 'Physical count ka farak, damage / scrap ka write-off — reason ke saath'],
    ],
    [24, 76],
  ),
)
body.push(tableSpacer())
body.push(...figure('38-inventory-summary.png', 'Stock Summary — in/out/closing, average cost, closing value aur stock health. Total dashboard ke stock value se match karta hai.'))
body.push(...figure('39-inventory-ledger.png', 'Stock Ledger — har movement ka record, running balance aur value ke saath.'))
body.push(...figure('40-inventory-lots.png', 'Lots & Serials — batch-wise stock aur serial tracking.'))
body.push(...figure('41-inventory-adjustments.png', 'Adjustments — physical count ka farak reason ke saath post karein (history bani rehti hai).'))

// ---------------------------------------------------------------- 10. accounting
body.push(h1('10. Accounting — paisa aaya/gaya'))
body.push(
  p([
    t('Payments', { bold: true }),
    t(' tab me har receipt aur payment voucher hota hai. Allocation se pata chalta hai kis invoice ka paisa hai — isliye "kitna baaki hai" ka jawab hamesha sahi rehta hai.'),
  ]),
)
body.push(...steps([
  [t('Accounting', { bold: true }), ' → ', t('New Payment', { bold: true }), ' (ya invoice detail se ', t('Receive Payment', { bold: true }), ').'],
  [t('Type', { bold: true }), ' chunein — RECEIPT (customer se paisa aaya) ya PAYMENT (supplier ko diya).'],
  'Party chunein; amount bharein; mode (CASH / BANK / UPI / CHEQUE) aur reference daalein.',
  [t('Allocation', { bold: true }), ' me jo invoices settle karni hain unke aage amount daalein. Total allocation amount se zyada nahi ho sakta.'],
  'Bacha hua amount (agar koi) advance ban jaata hai — baad me kisi bhi invoice par use kar sakte hain.',
  [t('Post', { bold: true }), ' dabayein — GL me Dr Cash/Bank + Cr Debtors (ya ulta) ho jaata hai.'],
]))
body.push(...figure('42-accounting-new-payment.png', 'New Payment — type, party, amount, mode aur invoice-wise allocation.'))
body.push(...figure('43b-accounting-party-ledger-filled.png', 'Party Ledger bhara hua (CUST-001 Mahindra Metal Works) — Opening ₹0 · Total Debit ₹76,134 · Total Credit ₹30,000 · Closing ₹46,134 receivable. Neeche har voucher (SALES_INVOICE / PAYMENT), account aur running balance.'))
body.push(...figure('44b-accounting-new-journal.png', 'New journal voucher dialog — Dr / Cr ledger + amount lines, narration, aur neeche "Debit = Credit" validator. Balanced na ho to Post button band rehta hai.'))
body.push(...figure('45-accounting-coa.png', 'Chart of Accounts — 15 account ka structure (Debtors, Creditors, Sales, Purchase, GST, WIP, OVHA…).'))
body.push(...figure('46-accounting-advances.png', 'Advances & Refunds — customer/supplier advance aur refund ka record.'))
body.push(calloutText('ok', 'Kisi bhi invoice ka balance dekhna hai? Party view (Masters → Parties → party) me receivable/payable aur voucher history ek saath mil jaati hai.'))

// ---------------------------------------------------------------- 11. reports
body.push(h1('11. Reports — compliance aur control'))
body.push(
  p([
    t('Saari reports '),
    t('append-only ledger se derive', { bold: true }),
    t(' hoti hain — koi report apna alag number nahi rakhti. Isliye trial balance hamesha balanced aata hai.'),
  ]),
)
body.push(...figure('47-reports-action-center.png', 'Action Center — overdue receivables, pending tasks, low stock aur unbilled jobwork ek jagah.'))
body.push(
  table(
    ['Report', 'Kaam', 'Dhyaan dein'],
    [
      ['GSTR-1', 'Month-wise B2B / B2C rate-wise summary', 'Sirf POSTED sales; B2B = party ke paas GSTIN hai'],
      ['GSTR-3B', 'Monthly summary return ka draft', 'Output tax minus input credit — CA se verify karein'],
      ['HSN Summary', 'HSN-wise qty, taxable aur tax', 'HSN 4-ank wala e-Invoice me reject hota hai'],
      ['Trial Balance', 'Account-wise Dr / Cr aur closing', 'Σ Dr = Σ Cr green banner = books theek hain'],
      ['Outstanding', 'Customer receivables aur supplier payables', 'Invoice-level breakup + opening balance'],
      ['Cash & Bank', 'Cash / bank book', 'Daily cash tally ke liye'],
      ['Aging', 'Kitna paisa kitne din se baaki', 'Follow-up priority tay karne ke liye'],
      ['P&L', 'Revenue − cost = profit (period)', 'Management snapshot — statutory accounts nahi'],
      ['Inventory Planning', 'Reorder suggestions', 'Low stock + consumption ke hisaab se'],
      ['Production Cost', 'Work-order-wise cost', 'Standard vs actual'],
      ['Efficiency', 'Task / operation ka output', ''],
      ['Customers / Suppliers', 'Party-wise business summary', ''],
      ['Back Orders', 'Order hai par maal nahi', ''],
      ['Sales Analysis', 'Item / party / period analysis', ''],
      ['Purchase by Supplier', 'Supplier-wise kharid', ''],
      ['Project Profitability', 'Project-wise revenue vs cost', ''],
    ],
    [22, 44, 34],
  ),
)
body.push(tableSpacer())
body.push(...figure('49-report-gstr3b.png', 'GSTR-3B (books summary) — Outward Taxable, Purchase Taxable, Net Before Utilisation aur Excess ITC, tax-head wise CGST / SGST / IGST. Neeche saaf likha hai: ye filed return nahi, books working hai.'))
body.push(...figure('56-report-customers.png', 'Customers — Active Customers, Total Sales, Received, Invoice Outstanding aur party-wise last sale + top items (jobwork ka hissa alag dikhta hai).'))
body.push(...figure('55-report-production-cost.png', 'Production Cost — Project Budget vs Expected BOM cost vs Actual cost, projected margin aur cost variance per project.'))
body.push(...figure('48-report-gstr1.png', 'GSTR-1 — month chunein, Run report; B2B rate-wise summary aur B2C split.'))
body.push(...figure('50-report-trial-balance.png', 'Trial Balance — account-wise closing; Dr = Cr integrity banner.'))
body.push(...figure('51-report-outstanding.png', 'Outstanding — customer-wise receivables aur supplier-wise payables.'))
body.push(...figure('53-report-pl.png', 'P&L — Revenue (Sales + Jobwork income), cost (Purchases), round-off aur net profit/loss.'))
body.push(...figure('52-report-aging.png', 'Aging — paisa kitne din se baaki hai, bucket-wise.'))
body.push(...figure('54-report-inventory-planning.png', 'Inventory Planning — kya kharidna chahiye aur kitna.'))
body.push(...figure('57-report-back-orders.png', 'Back Orders — customer ka order hai par stock nahi.'))
body.push(calloutText('warn', 'GST reports aur e-Invoice JSON statutory filing ka substitute nahi hain. Portal par upload karne se pehle apne CA / GST practitioner se verify karein.'))

// ---------------------------------------------------------------- 12. crm
body.push(h1('12. CRM & Service — enquiry se order tak'))
body.push(
  table(
    ['Tab', 'Kaam'],
    [
      ['Leads', 'Har enquiry (phone, exhibition, website, referral) ko lead banayein — stage, expected value, probability aur next follow-up date ke saath'],
      ['Salespersons', 'Team member aur target'],
      ['Performance', 'Kaun kitna kar raha hai — target vs actual'],
      ['Service Calls', 'After-sales complaint / service visit ka record'],
    ],
    [24, 76],
  ),
)
body.push(tableSpacer())
body.push(...figure('58-crm-leads.png', 'CRM Leads — pipeline (New → Contacted → Qualified → Proposal → Won/Lost), expected value aur follow-up date.'))
body.push(...figure('59-crm-salespersons.png', 'Salespersons — team aur unke targets.'))
body.push(...figure('60-crm-service-calls.png', 'Service Calls — after-sales service ka record.'))
body.push(calloutText('ok', 'Lead ka follow-up date miss na ho — Dashboard par follow-up overdue count dikhta hai, aur Action Center me bhi list aati hai.'))

// ---------------------------------------------------------------- 13. tally
body.push(h1('13. Tally Export aur e-Invoice (GST portal)'))
body.push(
  p([
    t('Aapke books Tally me hain? ForgeERP unhe wahin bhej deta hai. Rule ek hi hai: '),
    t('pehle masters, phir vouchers', { bold: true }),
    t('. Har voucher par REMOTEID hota hai — isliye wahi file dobara import karne par duplicate nahi banta, update hota hai.'),
  ]),
)
body.push(...figure('61-tally-export.png', 'Tally Export — Step 1 masters XML, Step 2 voucher export, Step 3 safe re-import, e-Invoice JSON, connector aur ledger-name mapping.'))
body.push(
  table(
    ['Kaam', 'Kaise'],
    [
      ['Masters import (ek baar)', 'Tally Export → "Download masters XML" → Tally me import. Iske bina "Ledger not found" aata hai.'],
      ['Ek document ka voucher', 'Invoice list/detail → Tally dropdown → Tally XML / JSON / CSV'],
      ['Poore range ka voucher', 'Tally Export → Bulk voucher export → From / To → Download bulk XML'],
      ['Manual import (.bat)', 'Tally dropdown → "Tally importer (.bat)" → Windows par chalao, folder ki saari XML ek saath jaati hain'],
      ['Automatic import', 'Tally Export → Connector → "Generate pairing code" → Tally machine par script chalao'],
      ['e-Invoice JSON', 'Invoice → Tally → "e-Invoice JSON (GST portal)" — JSON download + portal ka Bulk Upload page khul jaata hai'],
      ['Bulk e-Invoice', 'Tally Export → e-Invoice JSON → range → Download bulk IRP JSON'],
    ],
    [26, 74],
  ),
)
body.push(tableSpacer())
body.push(calloutText('warn', 'e-Invoice JSON banne se pehle validation chalti hai: buyer GSTIN, 6-digit pincode, 6/8-digit HSN aur total ka arithmetic. Jo document fail hota hai wo portal tak jaata hi nahi — reason toast me dikhta hai.'))
body.push(calloutText('warn', 'Connector sirf TallyPrime wali machine par chalta hai. Ledger naam ForgeERP aur Tally me bilkul same hone chahiye — mismatch #1 import error hai.'))

// ---------------------------------------------------------------- 14. audit + docs
body.push(h1('14. Audit Trail aur in-app Docs'))
body.push(
  p([
    t('Audit Trail', { bold: true }),
    t(' append-only hai: kisne, kab, kya banaya / badla / cancel kiya / export kiya — sab likha jaata hai. Purani entry kabhi delete ya edit nahi hoti.'),
  ]),
)
body.push(...figure('62-audit-trail.png', 'Audit Trail — timestamp, action, entity, details aur actor; filter + CSV export ke saath.'))
body.push(
  p([
    t('Footer me "see Docs" par click karne se '),
    t('Docs', { bold: true }),
    t(' page khulta hai — ye technical reference hai (design kahan se aaya, kaunsa pattern kyun chuna). Roz ke kaam ke liye zaroori nahi, lekin auditor / developer ke liye kaam ka hai.'),
  ]),
)
body.push(...figure('63-docs.png', 'Docs — reverse-engineering intelligence: har pattern ka evidence aur implementation note.'))

// ---------------------------------------------------------------- 15. SOP
body.push(h1('15. Roz / hafte / mahine ka routine'))
body.push(h2('15.1 Roz subah (5 minute)'))
body.push(...steps([
  'Dashboard kholen — receivables aur payables dekhein.',
  'Low stock list dekhein; jo item khatam ho raha hai uska purchase plan banayein.',
  'Reports → Action Center — overdue tasks, pending jobwork aur unbilled cards dekhein.',
]))
body.push(h2('15.2 Roz shaam (10 minute)'))
body.push(...steps([
  'Aaj ke saare sales / purchase invoices post karein (kal par na chhodein).',
  'Customer se aaya paisa turant Receive Payment me daalein, allocation ke saath.',
  'Jobwork me jo kaam hua uske job cards post karein.',
  'Cash / bank ka physical tally karein (Reports → Cash & Bank).',
]))
body.push(h2('15.3 Hafte me ek baar'))
body.push(...steps([
  'Outstanding aur Aging dekh kar purane balance par follow-up karein.',
  'Jobwork ke jo kaam poore ho gaye — certificate issue karein aur invoice bana lein (unbilled value zero karein).',
  'Pending production tasks ko worker assign karein ya reschedule karein.',
]))
body.push(h2('15.4 Mahine ke end me'))
body.push(...steps([
  'GSTR-1 aur GSTR-3B run karein, CA ko bhejein.',
  'Trial Balance kholen — Dr = Cr banner green hona chahiye.',
  'P&L dekhein aur pichhle mahine se compare karein.',
  'Saare invoices Tally me export karein (bulk) aur e-Invoice JSON portal par upload karein.',
  'Audit Trail se mahine ka CSV export karke archive karein.',
  'Physical stock count karein aur farak ho to Inventory → Adjustments me reason ke saath post karein.',
]))

// ---------------------------------------------------------------- 16. troubleshooting
body.push(h1('16. Troubleshooting — common error aur seedha fix'))
body.push(
  table(
    ['Screen par error / dikkat', 'Kyun aata hai', 'Kya karein'],
    [
      ['Invalid email or password', 'Galat email / password', 'Credential check karein; admin se reset karwayein. Bar-bar guess na karein.'],
      ['Invalid GSTIN — checksum failed', 'GSTIN ka 15va akshar galat', 'Poora GSTIN dobara verify karein (last character checksum hota hai)'],
      ['Insufficient stock for item', 'Us warehouse me stock nahi', 'Purchase bill ya Opening Stock se stock laayein; ya sahi warehouse chunein'],
      ['Invoice is not active', 'Invoice cancel ho chuki hai', 'Nayi invoice banayein'],
      ['Invoice outstanding is only ₹X', 'Allocation invoice ke balance se zyada', 'Allocation kam karein; bacha amount advance ban jaayega'],
      ['e-Invoice JSON nahi ban raha', 'Buyer GSTIN / pincode / HSN missing', 'Masters me party ka GSTIN + 6-digit pincode, item ka 6/8-digit HSN theek karein'],
      ['Tally me "Ledger not found"', 'Masters import nahi hue ya naam mismatch', 'Pehle masters XML import karein; ledger naam bilkul same rakhein'],
      ['GST portal tab nahi khula', 'Browser ne popup block kiya', 'Popup allow karein — JSON to download ho hi chuka hota hai'],
      ['Ek hi voucher do baar Tally me', 'Aisa nahi hota', 'REMOTEID ki wajah se dobara import update karta hai, duplicate nahi'],
      ['Empowered committee / RCM wali entry', 'RCM poora support nahi hai', 'CA se salah lein; manual journal se record karein'],
      ['Amount ka 1 rupaya farak', 'Round-off', 'Invoice par round-off line hoti hai — ye normal hai, ignore karein'],
      ['Login ke baad Org Portal dikh raha hai', 'Is organization ka ERP workspace nahi hai', 'Workspace wali organization ke login se sign in karein'],
    ],
    [30, 26, 44],
  ),
)
body.push(tableSpacer())

body.push(h2('16.1 Shabdon ka matlab (glossary)'))
body.push(
  table(
    ['Shabd', 'Matlab'],
    [
      ['GSTIN', 'GST registration number — 15 akshar, state code se shuru'],
      ['HSN / SAC', 'Goods / Service classification code (tax rate isi se tay hota hai)'],
      ['POS (Place of Supply)', 'Maal kahan ja raha hai — isi se CGST+SGST ya IGST tay hota hai'],
      ['Taxable value', 'GST se pehle ki value (discount ke baad)'],
      ['Round-off', 'Total ko rupaye me poora karne ka adjustment (paise ka farak)'],
      ['Dr / Cr', 'Debit / Credit — double-entry bookkeeping ki bhasha'],
      ['WIP', 'Work In Progress — adhoora kaam jisme paisa laga hai'],
      ['FG / RM', 'Finished Goods / Raw Material'],
      ['BOM', 'Bill of Material — kya banane me kya-kitna lagega'],
      ['MRP', 'Material Requirement Planning — kitna kharidna / banana'],
      ['OEE', 'Overall Equipment Effectiveness — machine kitni kaam ki'],
      ['Lot / Batch', 'Ek saath banaya / aaya hua maal ka group'],
      ['IRN', 'Invoice Reference Number — GST portal par e-Invoice register hone par milta hai'],
      ['Allocation', 'Payment ko invoice ke saath jodna'],
      ['Advance', 'Invoice se pehle mila / diya paisa'],
      ['Append-only', 'Purani entry delete nahi hoti, sirf nayi reverse entry banti hai'],
    ],
    [26, 74],
  ),
)
body.push(tableSpacer())

body.push(h1('17. Zaroori disclaimer'))
body.push(
  p([
    t('Ye manual software chalane ke liye hai. '),
    t('Tax filing, statutory audit aur legal compliance ke liye apne CA / GST practitioner se verify zaroor karein.', { bold: true }),
    t(' Software sahi numbers nikaalta hai, lekin compliance ki zimmedari business owner ki hai.'),
  ]),
)
body.push(
  p([
    t('Screenshots demo organization (Shree Forge Industries) ke data se liye gaye hain, 08 November 2026 ko, isi build par. Aapke deployment me naam, GSTIN, amounts aur dates alag honge.'),
  ]),
)

// ============================================================ DOCUMENT
const numberingConfig = [...new Set(stepLists)].map((ref) => ({
  reference: ref,
  levels: [
    {
      level: 0,
      format: LevelFormat.DECIMAL,
      text: '%1.',
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 425, hanging: 340 } } },
    },
  ],
}))

function pageFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.table.innerLine, space: 6 } },
        children: [
          new TextRun({ text: 'ForgeERP User Manual  ·  ', size: 15, color: '8A9A95', font: FONT }),
          new TextRun({ children: [PageNumber.CURRENT], size: 15, color: '8A9A95', font: FONT }),
          new TextRun({ text: ' / ', size: 15, color: '8A9A95', font: FONT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: '8A9A95', font: FONT }),
        ],
      }),
    ],
  })
}
function docHeader() {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E2EAE7', space: 4 } },
        children: [new TextRun({ text: 'ForgeERP  ·  Manufacturing · Jobwork · GST  ·  User Manual v3.0', size: 14, color: '9AA9A4', font: FONT })],
      }),
    ],
  })
}

const doc = new Document({
  creator: 'ForgeERP',
  features: { updateFields: true },
  title: 'ForgeERP User Manual (Hinglish) v3.0',
  description: 'Complete screenshot-driven user manual for ForgeERP',
  styles: {
    default: {
      document: { run: { font: FONT, size: 21, color: P.body }, paragraph: { spacing: { line: 300 } } },
      heading1: { run: { font: FONTH, size: 34, bold: true, color: P.head } },
      heading2: { run: { font: FONTH, size: 26, bold: true, color: P.head2 } },
      heading3: { run: { font: FONTH, size: 22, bold: true, color: P.accent } },
    },
  },
  numbering: { config: numberingConfig },
  sections: [
    {
      properties: { page: { size: PAGE, margin: MARGIN } },
      headers: { default: docHeader() },
      footers: { default: pageFooter() },
      children: cover(),
    },
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: PAGE, margin: MARGIN, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      headers: { default: docHeader() },
      footers: { default: pageFooter() },
      children: [
        new Paragraph({
          spacing: { before: 200, after: 260 },
          children: [new TextRun({ text: 'Vishay-suchi (Contents)', font: FONTH, size: 34, bold: true, color: P.head })],
        }),
        new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
        p([t('Note: ye list Word ke field se banti hai. Pehli baar kholne par page numbers khaali lag sakte hain — uspar right-click → "Update Field" karein.', { size: 17, italics: true, color: '8A9A95' })], { before: 260 }),
      ],
    },
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: PAGE, margin: MARGIN, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: docHeader() },
      footers: { default: pageFooter() },
      children: body,
    },
  ],
})

const buf = await Packer.toBuffer(doc)
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, buf)
console.log('WROTE', OUT)
console.log('size', (buf.length / 1024 / 1024).toFixed(2), 'MB ·', figNo, 'figures ·', stepRef, 'step lists')
