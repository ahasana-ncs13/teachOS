import { ObjectId } from 'mongodb'
import { getDatabase } from '../db.js'
import { parseObjectId } from '../utils/validation.js'
import { writeAuditLog } from './audit.service.js'

/**
 * Service to manage tenant users under the multi-tenancy model.
 */
export async function createTenantUser(req, { email, role, fullName, platformId }) {
  const database = getDatabase()
  const users = database.collection('users')

  // Rule 5: Only superAdmin can create or assign admins
  if (role === 'admin' && req.user.role !== 'superAdmin') {
    const error = new Error('Only superAdmin can create or assign admin accounts')
    error.status = 403
    error.code = 'ADMIN_CREATION_FORBIDDEN'
    throw error
  }

  // Determine target platform
  let targetPlatformId = req.platform?._id
  if (req.user.role === 'superAdmin') {
    targetPlatformId = platformId ? new ObjectId(platformId) : null
  }

  // Tenant users must have platformId
  if (role !== 'superAdmin' && !targetPlatformId) {
    const error = new Error('Platform ID is required for tenant users')
    error.status = 400
    error.code = 'PLATFORM_REQUIRED'
    throw error
  }

  const normalizedEmail = email.trim().toLowerCase()
  const existing = await users.findOne({ email: normalizedEmail, status: { $ne: 'removed' } })
  if (existing) {
    const error = new Error(`User with email '${normalizedEmail}' already exists`)
    error.status = 409
    error.code = 'USER_ALREADY_EXISTS'
    throw error
  }

  const now = new Date()
  const newUser = {
    uid: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    email: normalizedEmail,
    fullName: fullName.trim(),
    role,
    platformId: targetPlatformId,
    status: 'active',
    createdBy: req.authUid,
    createdAt: now,
    updatedAt: now,
  }

  const result = await users.insertOne(newUser)

  await writeAuditLog({
    platformId: targetPlatformId,
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'CREATE_TENANT_USER',
    targetType: 'user',
    targetId: result.insertedId,
    meta: { email: normalizedEmail, role },
  })

  return { _id: result.insertedId, ...newUser }
}

export async function listTenantUsers(req, { page = 1, limit = 20, role, search }) {
  const database = getDatabase()
  const filter = { status: { $ne: 'removed' } }

  if (req.user.role !== 'superAdmin') {
    filter.platformId = req.platform._id
  } else if (req.query.platformId) {
    filter.platformId = new ObjectId(req.query.platformId)
  }

  if (role && ['admin', 'teacher', 'student'].includes(role)) {
    filter.role = role
  }

  if (search && typeof search === 'string') {
    const safeRegex = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [
      { fullName: { $regex: safeRegex, $options: 'i' } },
      { email: { $regex: safeRegex, $options: 'i' } },
    ]
  }

  const skip = (page - 1) * limit
  const collection = database.collection('users')

  const [users, total] = await Promise.all([
    collection
      .find(filter, { projection: { removedAt: 0, removedBy: 0 } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    collection.countDocuments(filter),
  ])

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  }
}

export async function softDeleteTenantUser(req, userId) {
  const targetId = parseObjectId(userId, 'userId')
  const database = getDatabase()
  const targetUser = await database.collection('users').findOne({ _id: targetId, status: { $ne: 'removed' } })

  if (!targetUser) {
    const error = new Error('User not found')
    error.status = 404
    error.code = 'USER_NOT_FOUND'
    throw error
  }

  // Rule 5: Admin cannot modify admins or themselves. Only superAdmin can remove admins.
  if (req.user.role === 'admin') {
    if (String(targetUser._id) === String(req.user._id) || targetUser.uid === req.user.uid) {
      const error = new Error('Admins cannot delete their own account')
      error.status = 403
      error.code = 'SELF_DELETION_FORBIDDEN'
      throw error
    }
    if (targetUser.role === 'admin' || targetUser.role === 'superAdmin') {
      const error = new Error('Admins cannot remove other administrators. Only superAdmin can perform this.')
      error.status = 403
      error.code = 'ADMIN_DELETION_FORBIDDEN'
      throw error
    }
    // Verify tenant boundary
    if (String(targetUser.platformId) !== String(req.platform._id)) {
      const error = new Error('User belongs to another tenant platform')
      error.status = 403
      error.code = 'TENANT_BOUNDARY_VIOLATION'
      throw error
    }
  }

  const now = new Date()
  await database.collection('users').updateOne(
    { _id: targetId },
    { $set: { status: 'removed', removedAt: now, removedBy: req.authUid, updatedAt: now } }
  )

  await writeAuditLog({
    platformId: targetUser.platformId,
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'SOFT_DELETE_USER',
    targetType: 'user',
    targetId,
    meta: { targetRole: targetUser.role, targetEmail: targetUser.email },
  })

  return { message: 'User successfully deactivated', id: userId }
}
