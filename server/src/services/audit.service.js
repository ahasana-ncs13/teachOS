import { getDatabase } from '../db.js'

/**
 * Record a mutation in the auditLogs collection.
 * Schema: { platformId, actorUid, actorRole, action, targetType, targetId, meta, createdAt }
 */
export async function writeAuditLog({
  platformId = null,
  actorUid,
  actorRole,
  action,
  targetType,
  targetId = null,
  meta = {},
}) {
  try {
    const database = getDatabase()
    const logEntry = {
      platformId: platformId || null,
      actorUid: actorUid || 'system',
      actorRole: actorRole || 'unknown',
      action,
      targetType,
      targetId: targetId ? String(targetId) : null,
      meta,
      createdAt: new Date(),
    }
    await database.collection('auditLogs').insertOne(logEntry)
  } catch (error) {
    console.error('Failed to write audit log:', error.message)
    // Non-blocking so customer mutation is not failed solely due to audit log write failure
  }
}
