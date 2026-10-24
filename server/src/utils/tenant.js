import { ObjectId } from 'mongodb'

/**
 * Build a tenant-scoped MongoDB filter.
 * Guarantees that every query on tenant data includes { platformId: req.platform._id }
 * and excludes soft-deleted items { status: { $ne: 'removed' } }.
 */
export function tenantQuery(req, extraFilter = {}) {
  // superAdmin can see all platform data, or optionally scope to a specific platform
  if (req.user?.role === 'superAdmin') {
    const filter = { status: { $ne: 'removed' }, ...extraFilter }
    if (req.query?.platformId) {
      filter.platformId = typeof req.query.platformId === 'string'
        ? new ObjectId(req.query.platformId)
        : req.query.platformId
    }
    return filter
  }

  // Tenant-specific roles (admin, teacher, student) MUST have a valid platform attached
  if (!req.platform?._id) {
    const error = new Error('Tenant context missing: access denied')
    error.status = 403
    error.code = 'TENANT_CONTEXT_MISSING'
    throw error
  }

  return {
    platformId: req.platform._id,
    status: { $ne: 'removed' },
    ...extraFilter,
  }
}

/**
 * Prepares a document for tenant insertion by attaching the validated platformId and audit timestamps.
 */
export function tenantInsert(req, document) {
  let targetPlatformId = req.platform?._id

  if (req.user?.role === 'superAdmin') {
    if (document.platformId) {
      targetPlatformId = typeof document.platformId === 'string'
        ? new ObjectId(document.platformId)
        : document.platformId
    } else if (req.query?.platformId) {
      targetPlatformId = new ObjectId(req.query.platformId)
    }
  }

  if (!targetPlatformId) {
    const error = new Error('Platform ID is required for tenant-owned data')
    error.status = 400
    error.code = 'PLATFORM_ID_REQUIRED'
    throw error
  }

  const now = new Date()
  return {
    ...document,
    platformId: targetPlatformId,
    status: document.status || 'active',
    createdAt: now,
    updatedAt: now,
  }
}
