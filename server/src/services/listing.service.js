import { getDatabase } from '../db.js'
import { parseObjectId } from '../utils/validation.js'
import { tenantQuery, tenantInsert } from '../utils/tenant.js'
import { writeAuditLog } from './audit.service.js'

/**
 * Service to manage course and batch listings.
 */
export async function createListing(req, data) {
  const database = getDatabase()
  const listings = database.collection('listings')

  const now = new Date()
  const newListing = tenantInsert(req, {
    name: data.name.trim(),
    category: data.category,
    fee: Number(data.fee) || 0,
    duration: data.duration.trim(),
    location: data.location.trim(),
    description: data.description.trim(),
    image: data.image?.trim() || 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=85',
    startDate: data.startDate ? new Date(data.startDate) : now,
    email: req.user.email,
    teacherName: req.user.fullName || req.user.displayName || req.user.email,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }, 'teacherUid')

  const result = await listings.insertOne(newListing)
  const listingId = result.insertedId

  await writeAuditLog({
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
  const filter = { status: 'active' }

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
      .find(filter, { projection: { removedAt: 0, removedBy: 0, platformId: 0, teacherUid: 0 } })
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
  const filter = { status: 'active' }

  const limit = Math.min(Math.max(Number(count) || 6, 1), 20)

  const items = await database
    .collection('listings')
    .find(filter, { projection: { removedAt: 0, removedBy: 0, platformId: 0, teacherUid: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()

  return { listings: items }
}

export async function getListingById(id) {
  const objectId = parseObjectId(id, 'listingId')
  const database = getDatabase()
  const listing = await database.collection('listings').findOne(
    { _id: objectId, status: 'active' },
    { projection: { removedAt: 0, removedBy: 0, platformId: 0, teacherUid: 0 } }
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
  const filter = tenantQuery(req, {}, 'teacherUid')

  const skip = (page - 1) * limit
  const collection = database.collection('listings')

  const [items, total] = await Promise.all([
    collection
      .find(filter, { projection: { removedAt: 0, removedBy: 0, platformId: 0, teacherUid: 0 } })
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
  const ownershipFilter = req.user.role === 'admin'
    ? { _id: objectId, status: { $ne: 'removed' } }
    : tenantQuery(req, { _id: objectId }, 'teacherUid')
  const existing = await database.collection('listings').findOne(ownershipFilter)

  if (!existing) {
    const error = new Error('Listing not found')
    error.status = 404
    error.code = 'LISTING_NOT_FOUND'
    throw error
  }

  // Teachers can update their own listings; the global TeachOS admin can update any listing.
  const updates = {}
  if (updateData.name !== undefined) updates.name = updateData.name.trim()
  if (updateData.category !== undefined) updates.category = updateData.category
  if (updateData.fee !== undefined) updates.fee = Number(updateData.fee) || 0
  if (updateData.duration !== undefined) updates.duration = updateData.duration.trim()
  if (updateData.location !== undefined) updates.location = updateData.location.trim()
  if (updateData.description !== undefined) updates.description = updateData.description.trim()
  if (updateData.image !== undefined) updates.image = updateData.image.trim()
  if (updateData.startDate !== undefined) updates.startDate = new Date(updateData.startDate)
  if (updateData.status !== undefined) {
    if (updateData.status === 'active' && existing.status !== 'active') {
      if (!(Number(updateData.fee ?? existing.fee) > 0)) {
        const error = new Error('Add a fee in BDT before publishing this paid course.')
        error.status = 400
        error.code = 'COURSE_FEE_REQUIRED'
        throw error
      }
      if (!(updateData.duration ?? existing.duration)?.trim() || !(updateData.location ?? existing.location)?.trim() ||
          (updateData.description ?? existing.description ?? '').trim().length < 10) {
        const error = new Error('Add the course duration, location or delivery mode, and a description before publishing.')
        error.status = 400
        error.code = 'COURSE_DETAILS_REQUIRED'
        throw error
      }
    }
    updates.status = updateData.status
  }
  updates.updatedAt = new Date()

  const result = await database.collection('listings').findOneAndUpdate(
    { _id: objectId },
    { $set: updates },
    { returnDocument: 'after', projection: { removedAt: 0, removedBy: 0, platformId: 0, teacherUid: 0 } }
  )

  await writeAuditLog({
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
  const ownershipFilter = req.user.role === 'admin'
    ? { _id: objectId, status: { $ne: 'removed' } }
    : tenantQuery(req, { _id: objectId }, 'teacherUid')
  const existing = await database.collection('listings').findOne(ownershipFilter)

  if (!existing) {
    const error = new Error('Listing not found')
    error.status = 404
    error.code = 'LISTING_NOT_FOUND'
    throw error
  }

  const now = new Date()
  await database.collection('listings').updateOne(
    { _id: objectId },
    { $set: { status: 'removed', removedAt: now, removedBy: req.authUid, updatedAt: now } }
  )

  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'SOFT_DELETE_LISTING',
    targetType: 'listing',
    targetId: objectId,
    meta: { name: existing.name, category: existing.category },
  })

  return { message: 'Listing successfully removed', id }
}
