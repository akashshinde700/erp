/**
 * ForgeERP — audit trail helper.
 * Fire-and-forget wrapper: an audit failure must never break the business
 * mutation that is being logged.
 *
 * Actor attribution: routes pass the acting user's email (from
 * assertMutationAccess / assertCompanyAccess) so the trail answers WHO did
 * it, not just what happened. First-boot/anonymous paths pass 'setup';
 * platform-console mutations pass 'platform-admin'.
 */

import { db } from './db'

export async function logAudit(
  action: string,
  entity: string,
  entityId?: string,
  details?: string,
  actor?: string | null
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entity,
        entityId: entityId ?? null,
        details: details?.slice(0, 500) ?? null,
        actor: actor ? actor.slice(0, 120) : null,
      },
    })
  } catch (e) {
    console.error('[audit] failed to log', action, entity, e)
  }
}
