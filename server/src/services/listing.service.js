import { ObjectId } from 'mongodb'
import { getDatabase } from '../db.js'
import { parseObjectId } from '../utils/validation.js'
import { writeAuditLog } from './audit.service.js'

const ALLOWED_CATEGORIES = ['Online Course', 'Offline Batch', 'Exam Preparation', 'Skill Course']

/**
 * Service to manage course and batch listings.
 */
export async function createListing(req, data) {
  const database = getDatabase()
  const listings = database.collection('listings')

  // Determine platformId
  let platformId = req.platform?._id
  if (req.user.role === 'superAdmin' && data.platformId) {
    platformId = new ObjectId(data.platformId)
  }

  const now = new Date()
  const newListing = {
    name: data.name.trim(),
    category: data.category,
    fee: Number(data.fee) || 0,
    duration: data.duration.trim(),
    location: data.location.trim(),
    description: data.description.trim(),
    image: data.image?.trim() || 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=85',
    startDate: data.startDate ? new Date(data.startDate) : now,
    // Strict identity attributes pulled from verified token/user record
    teacherUid: req.user.uid,
    email: req.user.email,
    teacherName: req.user.fullName || req.user.displayName || req.user.email,
    platformId: platformId || null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }

  const result = await listings.insertOne(newListing)
  const listingId = result.insertedId

  await writeAuditLog({
    platformId,
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'CREATE_LISTING',
    targetType: 'listing',
    targetId: listingId,
    meta: { name: newListing.name, category: newListing.category, fee: newListing.fee },
  })

  return { _id: listingId, ...newListing }
}

export async function getListings(req, { search, category, page = 1, limit = 20 }) {
  const database = getDatabase()
  const filter = { status: { $ne: 'removed' } }

  // If user is inside an authenticated tenant platform context, scope to platform
  if (req.platform?._id) {
    filter.platformId = req.platform._id
  } else if (req.query?.platformId) {
    filter.platformId = new ObjectId(req.query.platformId)
  }

  if (category && typeof category === 'string' && category !== 'All') {
    // Case-insensitive match for category
    filter.category = { $regex: new RegExp(`^${category.trim()}$`, 'i') }
  }

  if (search && typeof search === 'string' && search.trim()) {
    const safeRegex = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [
      { name: { $regex: safeRegex, $options: 'i' } },
      { description: { $regex: safeRegex, $options: 'i' } },
      { location: { $regex: safeRegex, $options: 'i' } },
      { teacherName: { $regex: safeRegex, $options: 'i' } },
    ]
  }

  const skip = (page - 1) * limit
  const collection = database.collection('listings')

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
    listings: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  }
}

export async function getLatestListings(req, count = 6) {
  const database = getDatabase()
  const filter = { status: { $ne: 'removed' } }

  if (req.platform?._id) {
    filter.platformId = req.platform._id
  }

  const limit = Math.min(Math.max(Number(count) || 6, 1), 20)

  const items = await database
    .collection('listings')
    .find(filter, { projection: { removedAt: 0, removedBy: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()

  return { listings: items }
}

export async function getListingById(id) {
  const objectId = parseObjectId(id, 'listingId')
  const database = getDatabase()
  const listing = await database.collection('listings').findOne(
    { _id: objectId, status: { $ne: 'removed' } },
    { projection: { removedAt: 0, removedBy: 0 } }
  )

  if (!listing) {
    const error = new Error('Listing not found')
    error.status = 404
    error.code = 'LISTING_NOT_FOUND'
    throw error
  }

  return listing
}

export async function getMyListings(req, { page = 1, limit = 20 }) {
  const database = getDatabase()
  const filter = {
    status: { $ne: 'removed' },
    $or: [
      { teacherUid: req.user.uid },
      { email: req.user.email },
    ],
  }

  const skip = (page - 1) * limit
  const collection = database.collection('listings')

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
    listings: items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  }
}

export async function updateListing(req, id, updateData) {
  const objectId = parseObjectId(id, 'listingId')
  const database = getDatabase()
  const existing = await database.collection('listings').findOne({ _id: objectId, status: { $ne: 'removed' } })

  if (!existing) {
    const error = new Error('Listing not found')
    error.status = 404
    error.code = 'LISTING_NOT_FOUND'
    throw error
  }

  // Ownership verification:
  // Teacher can only update their own listings; Admin can update listings on their platform; superAdmin can update any
  const isOwner = existing.teacherUid === req.user.uid || existing.email === req.user.email
  const isAdminForPlatform = req.user.role === 'admin' && String(existing.platformId) === String(req.platform?._id)
  const isSuperAdmin = req.user.role === 'superAdmin'

  if (!isOwner && !isAdminForPlatform && !isSuperAdmin) {
    const error = new Error('You do not have permission to modify this listing')
    error.status = 403
    error.code = 'FORBIDDEN_OWNERSHIP'
    throw error
  }

  const updates = {}
  if (updateData.name !== undefined) updates.name = updateData.name.trim()
  if (updateData.category !== undefined) updates.category = updateData.category
  if (updateData.fee !== undefined) updates.fee = Number(updateData.fee) || 0
  if (updateData.duration !== undefined) updates.duration = updateData.duration.trim()
  if (updateData.location !== undefined) updates.location = updateData.location.trim()
  if (updateData.description !== undefined) updates.description = updateData.description.trim()
  if (updateData.image !== undefined) updates.image = updateData.image.trim()
  if (updateData.startDate !== undefined) updates.startDate = new Date(updateData.startDate)
  updates.updatedAt = new Date()

  const result = await database.collection('listings').findOneAndUpdate(
    { _id: objectId },
    { $set: updates },
    { returnDocument: 'after', projection: { removedAt: 0, removedBy: 0 } }
  )

  await writeAuditLog({
    platformId: existing.platformId,
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'UPDATE_LISTING',
    targetType: 'listing',
    targetId: objectId,
    meta: { updatedFields: Object.keys(updates) },
  })

  return result
}

export async function softDeleteListing(req, id) {
  const objectId = parseObjectId(id, 'listingId')
  const database = getDatabase()
  const existing = await database.collection('listings').findOne({ _id: objectId, status: { $ne: 'removed' } })

  if (!existing) {
    const error = new Error('Listing not found')
    error.status = 404
    error.code = 'LISTING_NOT_FOUND'
    throw error
  }

  const isOwner = existing.teacherUid === req.user.uid || existing.email === req.user.email
  const isAdminForPlatform = req.user.role === 'admin' && String(existing.platformId) === String(req.platform?._id)
  const isSuperAdmin = req.user.role === 'superAdmin'

  if (!isOwner && !isAdminForPlatform && !isSuperAdmin) {
    const error = new Error('You do not have permission to delete this listing')
    error.status = 403
    error.code = 'FORBIDDEN_OWNERSHIP'
    throw error
  }

  const now = new Date()
  await database.collection('listings').updateOne(
    { _id: objectId },
    { $set: { status: 'removed', removedAt: now, removedBy: req.authUid, updatedAt: now } }
  )

  await writeAuditLog({
    platformId: existing.platformId,
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'SOFT_DELETE_LISTING',
    targetType: 'listing',
    targetId: objectId,
    meta: { name: existing.name, category: existing.category },
  })

  return { message: 'Listing successfully removed', id }
}
