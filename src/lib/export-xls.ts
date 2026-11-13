/**
 * ForgeERP — zero-dependency Excel export.
 *
 * Generates SpreadsheetML 2003 (.xls XML): real workbooks with named sheets,
 * bold frozen-style headers and true numeric cells, opened natively by Excel,
 * WPS Office, LibreOffice and Google Sheets. No external library, no server
 * round-trip — the file is built from data the browser already has.
 *
 * Cell rules: numbers stay numbers (right-aligned, summable), strings are
 * XML-escaped, null/undefined become empty cells, booleans become Yes/No.
 */

export interface ExcelSheet {
  name: string
  header: string[]
  rows: (string | number | boolean | null | undefined)[][]
}

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function cell(value: string | number | boolean | null | undefined, styleId?: string): string {
  const style = styleId ? ` ss:StyleID="${styleId}"` : ''
  if (value === null || value === undefined || value === '') return `<Cell${style}/>`
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<Cell${style}><Data ss:Type="Number">${value}</Data></Cell>`
  }
  if (typeof value === 'boolean') {
    return `<Cell${style}><Data ss:Type="String">${value ? 'Yes' : 'No'}</Data></Cell>`
  }
  return `<Cell${style}><Data ss:Type="String">${esc(String(value))}</Data></Cell>`
}

function sheetXml(sheet: ExcelSheet): string {
  const name = esc(sheet.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet')
  const cols = sheet.header.length
  const head = `<Row>${sheet.header.map((h) => cell(h, 'hdr')).join('')}</Row>`
  const body = sheet.rows
    .map((r) => `<Row>${r.slice(0, cols).map((c) => cell(c)).join('')}</Row>`)
    .join('')
  return `<Worksheet ss:Name="${name}"><Table>${head}${body}</Table></Worksheet>`
}

/** Build and download a multi-sheet .xls workbook. */
export function exportExcel(filename: string, sheets: ExcelSheet[]): void {
  if (!sheets.length) return
  const doc =
    `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
    `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Styles><Style ss:ID="hdr"><Font ss:Bold="1"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/></Style></Styles>` +
    sheets.map(sheetXml).join('') +
    `</Workbook>`
  const blob = new Blob(['\ufeff', doc], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xls') ? filename : `${filename}.xls`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
