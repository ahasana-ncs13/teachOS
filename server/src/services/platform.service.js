import { getDatabase } from '../db.js'
import { parseObjectId } from '../utils/validation.js'
import { writeAuditLog } from './audit.service.js'

/**
 * Service to manage tenant platforms.
 */
export async function createPlatform({ name, slug, plan = 'standard', renewalDate, gracePeriodDays = 7, actorUid }) {
  const database = getDatabase()
  const platforms = database.collection('platforms')

  // Check unique slug among non-removed platforms
  const existing = await platforms.findOne({ slug, status: { $ne: 'removed' } })
  if (existing) {
    const error = new Error(`Platform with slug '${slug}' already exists`)
    error.status = 409
    error.code = 'SLUG_ALREADY_EXISTS'
    throw error
  }

  const now = new Date()
  const calculatedRenewal = renewalDate ? new Date(renewalDate) : new Date(now.getTime() + 30 * 86400000)

  const newPlatform = {
    name,
    slug,
    plan,
    status: 'active',
    renewalDate: calculatedRenewal,
    gracePeriodDays: Number(gracePeriodDays) || 7,
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
  }

  const result = await platforms.insertOne(newPlatform)
  const platformId = result.insertedId

  await writeAuditLog({
    platformId,
    actorUid,
    actorRole: 'admin',
    action: 'CREATE_PLATFORM',
    targetType: 'platform',
    targetId: platformId,
    meta: { name, slug, plan },
  })

  return { _id: platformId, ...newPlatform }
}

export async function listPlatforms({ page = 1, limit = 20, status, search }) {
  const database = getDatabase()
  const filter = { status: { $ne: 'removed' } }

  if (status && ['active', 'suspended'].includes(status)) {
    filter.status = status
  }

  if (search && typeof search === 'string') {
    filter.name = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
  }

  const skip = (page - 1) * limit
  const collection = database.collection('platforms')

  const [items, total] = await Promise.all([
    collection
      .find(filter, { projection: { removedAt: 0, removedBy: 0 } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    collection.countDocuments(filter),
  ])

  return {
    platforms: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  }
}

export async function getPlatformById(id) {
  const objectId = parseObjectId(id, 'platformId')
  const database = getDatabase()
  const platform = await database.collection('platforms').findOne(
    { _id: objectId, status: { $ne: 'removed' } },
    { projection: { removedAt: 0, removedBy: 0 } }
  )

  if (!platform) {
    const error = new Error('Platform not found')
    error.status = 404
    error.code = 'PLATFORM_NOT_FOUND'
    throw error
  }

  return platform
}

export async function suspendPlatform(id, { reason = '', actorUid }) {
  const objectId = parseObjectId(id, 'platformId')
  const database = getDatabase()
  const now = new Date()

  const result = await database.collection('platforms').findOneAndUpdate(
    { _id: objectId, status: { $ne: 'removed' } },
    { $set: { status: 'suspended', suspensionReason: reason, updatedAt: now } },
    { returnDocument: 'after', projection: { removedAt: 0, removedBy: 0 } }
  )

  if (!result) {
    const error = new Error('Platform not found')
    error.status = 404
    error.code = 'PLATFORM_NOT_FOUND'
    throw error
  }

  await writeAuditLog({
    platformId: objectId,
    actorUid,
    actorRole: 'admin',
    action: 'SUSPEND_PLATFORM',
    targetType: 'platform',
    targetId: objectId,
    meta: { reason },
  })

  return result
}

export async function reactivatePlatform(id, { actorUid }) {
  const objectId = parseObjectId(id, 'platformId')
  const database = getDatabase()
  const now = new Date()

  const result = await database.collection('platforms').findOneAndUpdate(
    { _id: objectId, status: { $ne: 'removed' } },
    { $set: { status: 'active', suspensionReason: null, updatedAt: now } },
    { returnDocument: 'after', projection: { removedAt: 0, removedBy: 0 } }
  )

  if (!result) {
    const error = new Error('Platform not found')
    error.status = 404
    error.code = 'PLATFORM_NOT_FOUND'
    throw error
  }

  await writeAuditLog({
    platformId: objectId,
    actorUid,
    actorRole: 'admin',
    action: 'REACTIVATE_PLATFORM',
    targetType: 'platform',
    targetId: objectId,
  })

  return result
}

export async function extendPlatformRenewal(id, { days = 30, actorUid }) {
  const objectId = parseObjectId(id, 'platformId')
  const database = getDatabase()
  const platform = await getPlatformById(id)

  const currentRenewal = new Date(platform.renewalDate || Date.now())
  const baseDate = currentRenewal.getTime() > Date.now() ? currentRenewal : new Date()
  const newRenewalDate = new Date(baseDate.getTime() + Number(days) * 86400000)
  const now = new Date()

  const result = await database.collection('platforms').findOneAndUpdate(
    { _id: objectId, status: { $ne: 'removed' } },
    { $set: { renewalDate: newRenewalDate, updatedAt: now } },
    { returnDocument: 'after', projection: { removedAt: 0, removedBy: 0 } }
  )

  await writeAuditLog({
    platformId: objectId,
    actorUid,
    actorRole: 'admin',
    action: 'EXTEND_PLATFORM_RENEWAL',
    targetType: 'platform',
    targetId: objectId,
    meta: { addedDays: days, newRenewalDate },
  })

  return result
}

export async function softDeletePlatform(id, { actorUid }) {
  const objectId = parseObjectId(id, 'platformId')
  const database = getDatabase()
  const now = new Date()

  const result = await database.collection('platforms').findOneAndUpdate(
    { _id: objectId, status: { $ne: 'removed' } },
    { $set: { status: 'removed', removedAt: now, removedBy: actorUid, updatedAt: now } },
    { returnDocument: 'after' }
  )

  if (!result) {
    const error = new Error('Platform not found')
    error.status = 404
    error.code = 'PLATFORM_NOT_FOUND'
    throw error
  }

  await writeAuditLog({
    platformId: objectId,
    actorUid,
    actorRole: 'admin',
    action: 'SOFT_DELETE_PLATFORM',
    targetType: 'platform',
    targetId: objectId,
  })

  return { message: 'Platform successfully soft-deleted', id }
}

export async function getPlatformBillingSummary(platformId) {
  const objectId = parseObjectId(String(platformId), 'platformId')
  const database = getDatabase()
  const platform = await database.collection('platforms').findOne(
    { _id: objectId, status: { $ne: 'removed' } },
    { projection: { name: 1, slug: 1, plan: 1, status: 1, renewalDate: 1, gracePeriodDays: 1, suspensionReason: 1 } }
  )

  if (!platform) {
    const error = new Error('Platform not found')
    error.status = 404
    error.code = 'PLATFORM_NOT_FOUND'
    throw error
  }

  const renewalDate = platform.renewalDate ? new Date(platform.renewalDate) : null
  const graceDays = platform.gracePeriodDays ?? 7
  const deadline = renewalDate ? new Date(renewalDate.getTime() + graceDays * 86400000) : null
  const isGracePeriodActive = renewalDate && deadline ? Date.now() > renewalDate.getTime() && Date.now() <= deadline.getTime() : false
  const isExpired = deadline ? Date.now() > deadline.getTime() : false

  return {
    platformId: platform._id,
    name: platform.name,
    plan: platform.plan,
    status: platform.status,
    renewalDate: platform.renewalDate,
    gracePeriodDays: graceDays,
    gracePeriodDeadline: deadline,
    isGracePeriodActive,
    isExpired,
    isBlocked: platform.status === 'suspended' || isExpired,
    suspensionReason: platform.suspensionReason || null,
  }
}
