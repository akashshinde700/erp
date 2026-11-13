import { handleError, ok } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { assertCompanyAccess, assertMutationAccess } from '@/lib/platform'
import { deleteAttachment, readAttachmentBytes } from '@/lib/attachments'
import { BusinessError } from '@/lib/accounting'

/** Download / inline-view one attachment. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCompanyAccess()
    const { id } = await params
    const { row, bytes } = await readAttachmentBytes(id)
    const download = new URL(req.url).searchParams.get('download') === '1'
    // Non-ASCII names arrive safely via filename*; ASCII gets the plain param.
    const ascii = /^[\x20-\x7E]+$/.test(row.fileName) ? row.fileName : 'attachment'
    const encoded = encodeURIComponent(row.fileName)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': row.mimeType,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${ascii.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`,
        // We serve from our own origin — keep others from framing/embedding user files.
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof BusinessError && error.status === 404) {
      return new Response(JSON.stringify({ success: false, error: error.message }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }
    return handleError(error)
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const actor = await assertMutationAccess()
    const res = await deleteAttachment(id)
    await logAudit('DELETE', 'Attachment', id, `${res.fileName} removed`, actor?.email)
    return ok(res)
  } catch (error) {
    return handleError(error)
  }
}
