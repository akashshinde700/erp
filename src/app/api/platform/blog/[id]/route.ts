import { handleError, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformAdmin } from '@/lib/platform'
import { z } from 'zod'

/**
 * PATCH /api/platform/blog/[id] — update a post (slug re-checked for clashes).
 * DELETE /api/platform/blog/[id] — remove.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin(req)
    const { id } = await params
    const post = await db.platformBlogPost.findUnique({ where: { id } })
    if (!post) return fail('Post not found', 404)
    const schema = z.object({
      title: z.string().min(1).max(160).optional(),
      slug: z.string().max(80).optional(),
      excerpt: z.string().max(300).optional(),
      body: z.string().max(20000).optional(),
      status: z.enum(['draft', 'published']).optional(),
    })
    const body = schema.parse(await req.json())
    if (body.slug && body.slug !== post.slug) {
      const clash = await db.platformBlogPost.findUnique({ where: { slug: body.slug } })
      if (clash) return fail('That slug is already used by another post', 409)
    }
    const updated = await db.platformBlogPost.update({
      where: { id },
      data: {
        ...body,
        ...(body.status === 'published' && !post.publishedAt ? { publishedAt: new Date() } : {}),
      },
    })
    await logAudit('PLATFORM', 'BlogPost', id, `"${updated.title}" updated (${updated.status})`)
    return ok(updated)
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin(req)
    const { id } = await params
    const post = await db.platformBlogPost.findUnique({ where: { id } })
    if (!post) return fail('Post not found', 404)
    await db.platformBlogPost.delete({ where: { id } })
    await logAudit('PLATFORM', 'BlogPost', id, `"${post.title}" deleted`)
    return ok({ deleted: true })
  } catch (e) {
    return handleError(e)
  }
}
