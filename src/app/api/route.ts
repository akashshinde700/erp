import { ok } from '@/lib/api'
import { db } from '@/lib/db'

export async function GET() {
  const company = await db.company.findFirst({ select: { name: true, gstin: true } })
  return ok({
    app: 'ForgeERP',
    status: 'running',
    company: company?.name ?? null,
    modules: ['dashboard', 'sales', 'purchase', 'inventory', 'jobwork', 'accounting', 'reports', 'masters', 'docs'],
  })
}
