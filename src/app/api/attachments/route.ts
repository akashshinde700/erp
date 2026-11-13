import { fail, handleError, ok } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { listAttachments, saveAttachment } from '@/lib/attachments'

/** List attachments for one document: ?entityType=&entityId= */
export async function GET(req: Request) {
  try {
    await assertCompanyAccess()
    const sp = new URL(req.url).searchParams
    const entityType = sp.get('entityType')
    const entityId = sp.get('entityId')
    if (!entityType || !entityId) return fail('entityType and entityId are required')
    return ok(await listAttachments(entityType, entityId))
  } catch (error) {
    return handleError(error)
  }
}

/** Upload one file (multipart/form-data: file, entityType, entityId, note?). */
export async function POST(req: Request) {
  try {
    const actor = await assertMutationAccess()
    const form = await req.formData().catch(() => null)
    if (!form) return fail('Expected multipart/form-data with a file field')
    const file = form.get('file')
    if (!(file instanceof File)) return fail('A file is required')
    const entityType = form.get('entityType')
    const entityId = form.get('entityId')
    const note = form.get('note')
    const row = await saveAttachment({
      file,
      entityType,
      entityId,
      note: typeof note === 'string' ? note : undefined,
      uploadedBy: actor?.email ?? null,
    })
    await logAudit('POST', 'Attachment', row.id, `${row.fileName} (${row.size} B) on ${row.entityType}`, actor?.email)
    return ok(row, 201)
  } catch (error) {
    return handleError(error)
  }
}
