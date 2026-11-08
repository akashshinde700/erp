import { db } from '@/lib/db'
import { accessState } from '@/lib/platform'

/**
 * Shared session payload builder for /api/auth/* routes.
 * The ERP workspace = the FIRST company (operating org); sessions for other
 * orgs are flagged so the client can route them to the org portal instead of
 * the books (honest single-workspace runtime).
 */

export interface SessionInfo {
  user: { id: string; name: string; email: string; role: string }
  company: { id: string; name: string; gstin: string | null; city: string | null; email: string | null }
  operating: boolean
  operatingOrg: { id: string; name: string } | null // set when the user's org is NOT the operating org
  plan: string | null
  access: { state: string; blocked: boolean; message: string }
  paidUntil: string | null
  trialEndsAt: string | null
}

export async function buildSessionInfo(user: {
  id: string
  name: string
  email: string
  role: string
  companyId: string
  company: {
    id: string
    name: string
    gstin: string | null
    city: string | null
    email: string | null
    isPlatform: boolean
    saasStatus: string
    paidUntil: Date | null
    trialEndsAt: Date | null
    plan: { name: string } | null
  }
}): Promise<SessionInfo> {
  // Every organisation has its own isolated workspace; only the platform
  // operator's company has none (it uses the Platform Admin console).
  const st = accessState(user.company)
  const operating = !user.company.isPlatform
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    company: {
      id: user.company.id,
      name: user.company.name,
      gstin: user.company.gstin,
      city: user.company.city,
      email: user.company.email,
    },
    operating,
    operatingOrg: null,
    plan: user.company.plan?.name ?? null,
    access: { state: st.state, blocked: st.blocked, message: st.message },
    paidUntil: user.company.paidUntil?.toISOString() ?? null,
    trialEndsAt: user.company.trialEndsAt?.toISOString() ?? null,
  }
}
