/**
 * ForgeERP — document attachments.
 *
 * Any business document (sales/purchase invoice, PO, GRN, payment, party,
 * work order, ...) can carry files: supplier PDFs, signed POs, QC photos,
 * e-way bill copies. Only metadata lives in MySQL; file bytes go to
 * upload/attachments/<companyId>/<random>.<ext> (never a client-controlled
 * path — the original name is metadata, the stored name is random).
 *
 * Guardrails: whitelisted entity types + MIME types, 10 MB per file,
 * 20 files per document, tenant-scoped through the shared prisma client.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BusinessError } from './accounting'
import { db } from './db'

const ROOT = join(process.cwd(), 'upload', 'attachments')

export const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB
export const MAX_FILES_PER_DOC = 20
const MAX_NOTE = 300

/** Document types that may carry attachments (loose link by entityType+entityId). */
export const ENTITY_TYPES = new Set([
  'SALES_INVOICE', 'PURCHASE_INVOICE', 'PROFORMA_INVOICE', 'DELIVERY_CHALLAN',
  'SALES_ORDER', 'SALES_QUOTATION', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION',
  'GOODS_RECEIPT', 'PRODUCTION_RECEIPT', 'WORK_ORDER', 'PROJECT', 'BOM',
  'PAYMENT', 'RETURN_DOCUMENT', 'RFQ', 'PARTY', 'ITEM', 'STOCK_ADJUSTMENT',
  'SERVICE_CALL', 'LEAD', 'JOBWORK_INWARD', 'JOB_CARD',
])

/** Types safe to store and serve back from our own origin. */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/tiff', 'image/heic', 'image/heif',
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-zip-compressed',
  'application/json',
])

/** Extension fallback when the browser sends a generic mime type (e.g. application/octet-stream). */
const ALLOWED_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'heic', 'heif', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'json'])

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/tiff': 'tiff', 'image/heic': 'heic', 'image/heif': 'heif',
  'text/plain': 'txt', 'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
  'application/json': 'json',
}

export interface AttachmentDto {
  id: string
  entityType: string
  entityId: string
  fileName: string
  mimeType: string
  size: number
  note: string | null
  uploadedBy: string | null
  createdAt: Date
}

export function assertEntityType(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!ENTITY_TYPES.has(s)) throw new BusinessError(`Unsupported document type for attachments: ${s || '(empty)'}`, 400)
  return s
}

function assertEntityId(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s || s.length > 64) throw new BusinessError('A valid document id is required', 400)
  return s
}

function extOf(fileName: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName)
  return m ? m[1].toLowerCase() : ''
}

function validateUpload(file: File): { ext: string } {
  if (!file.size) throw new BusinessError('The selected file is empty', 400)
  if (file.size > MAX_FILE_BYTES) throw new BusinessError(`"${file.name}" is larger than 2 MB`, 400)
  const name = file.name.slice(0, 255)
  const ext = extOf(name)
  const okMime = ALLOWED_MIME.has(file.type)
  const okExt = ALLOWED_EXT.has(ext)
  if (!okMime && !okExt) {
    throw new BusinessError(`File type not allowed: "${file.name}". PDF, images, Office documents, CSV/TXT, ZIP and JSON are supported.`, 400)
  }
  // Trust the extension over an octet-stream mime; otherwise derive from the mime.
  return { ext: okExt ? ext : (EXT_BY_MIME[file.type] ?? ext) }
}

export async function listAttachments(entityType: unknown, entityId: unknown): Promise<AttachmentDto[]> {
  const type = assertEntityType(entityType)
  const id = assertEntityId(entityId)
  return db.attachment.findMany({
    where: { entityType: type, entityId: id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, entityType: true, entityId: true, fileName: true, mimeType: true, size: true, note: true, uploadedBy: true, createdAt: true },
  })
}

export async function saveAttachment(input: {
  file: File
  entityType: unknown
  entityId: unknown
  note?: unknown
  uploadedBy?: string | null
}): Promise<AttachmentDto> {
  const type = assertEntityType(input.entityType)
  const docId = assertEntityId(input.entityId)
  const note = String(input.note ?? '').trim().slice(0, MAX_NOTE) || null

  const count = await db.attachment.count({ where: { entityType: type, entityId: docId } })
  if (count >= MAX_FILES_PER_DOC) throw new BusinessError(`This document already has ${MAX_FILES_PER_DOC} attachments (limit)`, 400)

  const { ext } = validateUpload(input.file)
  const company = await db.company.findFirst({ select: { id: true } })
  if (!company) throw new BusinessError('No company configured', 400)

  const storageKey = `${Date.now().toString(36)}-${randomBytes(8).toString('hex')}${ext ? `.${ext}` : ''}`
  const dir = join(ROOT, company.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, storageKey), Buffer.from(await input.file.arrayBuffer()))

  return db.attachment.create({
    data: {
      companyId: company.id, entityType: type, entityId: docId,
      fileName: input.file.name.slice(0, 255), mimeType: input.file.type || 'application/octet-stream',
      size: input.file.size, storageKey, note, uploadedBy: input.uploadedBy ?? null,
    },
    select: { id: true, entityType: true, entityId: true, fileName: true, mimeType: true, size: true, note: true, uploadedBy: true, createdAt: true },
  })
}

/** Read the stored bytes for a metadata row. Tenant scope already applied by the scoped client. */
export async function readAttachmentBytes(id: string): Promise<{ row: { id: string; fileName: string; mimeType: string }; bytes: Buffer }> {
  const row = await db.attachment.findUnique({ where: { id }, select: { id: true, companyId: true, storageKey: true, fileName: true, mimeType: true } })
  if (!row) throw new BusinessError('Attachment not found', 404)
  let bytes: Buffer
  try {
    bytes = await readFile(join(ROOT, row.companyId, row.storageKey))
  } catch {
    // Metadata without bytes (restored backup without the files dir): say so honestly.
    throw new BusinessError('The attachment record exists but its file is missing on the server (upload/attachments was not restored with the database backup)', 410)
  }
  return { row: { id: row.id, fileName: row.fileName, mimeType: row.mimeType }, bytes }
}

export async function deleteAttachment(id: string): Promise<{ id: string; fileName: string }> {
  const row = await db.attachment.findUnique({ where: { id }, select: { id: true, fileName: true, companyId: true, storageKey: true } })
  if (!row) throw new BusinessError('Attachment not found', 404)
  await db.attachment.delete({ where: { id } })
  // Best-effort unlink — a leftover orphan file never breaks the app.
  await rm(join(ROOT, row.companyId, row.storageKey), { force: true }).catch(() => {})
  return { id: row.id, fileName: row.fileName }
}
