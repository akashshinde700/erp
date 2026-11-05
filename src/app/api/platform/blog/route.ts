import { handleError, ok } from '@/lib/api'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requirePlatformAdmin } from '@/lib/platform'
import { z } from 'zod'

/** GET /api/platform/blog — all posts, newest first. */
export async function GET(req: Request) {
  try {
    await requirePlatformAdmin(req)
    const posts = await db.platformBlogPost.findMany({ orderBy: { createdAt: 'desc' } })
    return ok({ posts })
  } catch (e) {
    return handleError(e)
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80)
}

const postSchema = z.object({
  title: z.string().min(1, 'Title is required').max(160),
  slug: z.string().max(80).optional(),
  excerpt: z.string().max(300).optional(),
  body: z.string().max(20000).optional(),
  status: z.enum(['draft', 'published']).default('draft'),
})

/** POST /api/platform/blog — create a post (slug auto-generated + de-duplicated). */
export async function POST(req: Request) {
  try {
    await requirePlatformAdmin(req)
    const body = postSchema.parse(await req.json())
    const base = slugify(body.slug || body.title) || `post-${Date.now()}`
    let slug = base
    for (let i = 2; i <= 99; i++) {
      const clash = await db.platformBlogPost.findUnique({ where: { slug } })
      if (!clash) break
      slug = `${base}-${i}`
    }
    const post = await db.platformBlogPost.create({
      data: {
        title: body.title,
        slug,
        excerpt: body.excerpt || null,
        body: body.body || null,
        status: body.status,
        publishedAt: body.status === 'published' ? new Date() : null,
      },
    })
    await logAudit('PLATFORM', 'BlogPost', post.id, `"${post.title}" created (${post.status})`)
    return ok(post)
  } catch (e) {
    return handleError(e)
  }
}
