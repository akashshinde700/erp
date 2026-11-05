/**
 * ForgeERP — audit trail helper.
 * Fire-and-forget wrapper: an audit failure must never break the business
 * mutation that is being logged.
 */

import { db } from './db'

export async function logAudit(action: string, entity: string, entityId?: string, details?: string): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action,
        entity,
        entityId: entityId ?? null,
        details: details?.slice(0, 500) ?? null,
      },
    })
  } catch (e) {
    console.error('[audit] failed to log', action, entity, e)
  }
}
