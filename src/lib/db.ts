import { Prisma, PrismaClient } from '@prisma/client'
import { resolveTenantId } from './tenant'

/**
 * Row-level tenant isolation, enforced for every query.
 *
 * ROOT models carry `companyId`: reads, updates and deletes get
 * `companyId = <tenant>` added to their filter; creates get it filled in.
 * CHILD models (invoice lines, order lines, allocations, ...) have no column of
 * their own and are filtered through their required relation to a root model.
 * Both sets are derived from the Prisma schema at start-up, so a new model is
 * covered as soon as it has a companyId or a required parent relation.
 * Company, OrgUser and the platform tables are deliberately not scoped.
 */
const UNSCOPED = new Set(['Company', 'OrgUser', 'Plan', 'PlatformInquiry', 'PlatformInquiryFollowUp', 'PlatformBlogPost', 'Counter', 'IdempotencyKey'])
const models = Prisma.dmmf.datamodel.models
export const ROOT_MODELS = new Set(models.filter((m) => !UNSCOPED.has(m.name) && m.fields.some((f) => f.name === 'companyId')).map((m) => m.name))
export const CHILD_MODELS = new Map<string, string>()
for (const m of models) {
  if (UNSCOPED.has(m.name) || ROOT_MODELS.has(m.name)) continue
  const parent = m.fields.find((f) => f.kind === 'object' && f.isRequired && !f.isList && f.relationFromFields?.length && ROOT_MODELS.has(f.type))
  if (parent) CHILD_MODELS.set(m.name, parent.name)
}

const FILTERED = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'])

type Where = Record<string, unknown> & { AND?: unknown }
function withFilter(where: Where | undefined, filter: Record<string, unknown>): Where {
  if (!where) return filter
  const and = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND]
  // Unique fields stay at the top level (required by findUnique/update/upsert).
  return { ...where, AND: [...and, filter] }
}
function withCompany<T>(data: T, companyId: string): T {
  if (!data || typeof data !== 'object') return data
  const row = data as Record<string, unknown>
  if (row.companyId !== undefined || row.company !== undefined) return data
  return { ...row, companyId } as T
}

function makeClient() {
  const base = new PrismaClient()
  return base.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const parentRelation = CHILD_MODELS.get(model)
          const isRoot = ROOT_MODELS.has(model)
          if (!isRoot && !parentRelation) return query(args)
          const tenant = await resolveTenantId(base)
          if (!tenant) return query(args)
          const a = { ...(args as Record<string, unknown>) }
          const filter = isRoot ? { companyId: tenant } : { [parentRelation!]: { companyId: tenant } }
          if (FILTERED.has(operation)) a.where = withFilter(a.where as Where | undefined, filter)
          if (isRoot) {
            if (operation === 'create') a.data = withCompany(a.data, tenant)
            if (operation === 'createMany') a.data = Array.isArray(a.data) ? a.data.map((row) => withCompany(row, tenant)) : withCompany(a.data, tenant)
            if (operation === 'upsert') a.create = withCompany(a.create, tenant)
          }
          return query(a as typeof args)
        },
      },
    },
  })
}

// A query-only extension does not change any model's types, so the client is
// exposed with the plain PrismaClient type (keeps Prisma.TransactionClient
// usable throughout the services).
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

export const db: PrismaClient = globalForPrisma.prisma ?? (makeClient() as unknown as PrismaClient)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
