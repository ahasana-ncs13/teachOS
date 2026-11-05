import { getDatabase } from '../db.js'
import { parseObjectId } from '../utils/validation.js'
import { tenantQuery, tenantInsert } from '../utils/tenant.js'
import { writeAuditLog } from './audit.service.js'

async function getOwnedCourse(req, courseId) {
  const parsedCourseId = parseObjectId(courseId, 'courseId')
  const courseFilter = req.user.role === 'admin'
    ? { _id: parsedCourseId, status: { $ne: 'removed' } }
    : { _id: parsedCourseId, teacherUid: req.authUid, status: { $ne: 'removed' } }
  const course = await getDatabase().collection('courses').findOne(courseFilter)

  if (!course) {
    const error = new Error('Select one of your active courses.')
    error.status = 400
    error.code = 'COURSE_NOT_FOUND'
    throw error
  }

  return course
}

function getEnrollmentLookup() {
  return [
    {
      $lookup: {
        from: 'studentEnrollments',
        let: { listingId: '$_id' },
        pipeline: [
          { $match: { status: 'active', $expr: { $eq: ['$listingId', '$$listingId'] } } },
          { $count: 'count' },
        ],
        as: 'enrollmentStats',
      },
    },
    {
      $addFields: {
        enrolledCount: { $ifNull: [{ $arrayElemAt: ['$enrollmentStats.count', 0] }, 0] },
      },
    },
  ]
}

/**
 * Compute the student-facing payment breakdown for a listing.
 * Legacy listings that only carry `fee` are treated as monthly tuition with
 * zero admission fee. New listings carry `admissionFee` and `monthlyTuitionFee`.
 */
export function computeListingPricing(listing) {
  const monthlyTuitionFee = Number(listing.monthlyTuitionFee ?? listing.fee ?? 0) || 0
  const admissionFee = Number(listing.admissionFee ?? 0) || 0
  const initialPaymentTotal = admissionFee + monthlyTuitionFee
  return {
    admissionFee,
    monthlyTuitionFee,
    initialPaymentTotal,
  }
}

/**
 * Service to manage course and batch listings.
 */
export async function createListing(req, data) {
  const database = getDatabase()
  const listings = database.collection('listings')
  const course = await getOwnedCourse(req, data.courseId)

  const now = new Date()
  const newListing = tenantInsert(req, {
    name: data.name.trim(),
    category: 'Online',
    courseId: course._id,
    courseName: course.name,
    deliveryMode: data.deliveryMode || course.deliveryMode,
    days: data.days,
    startTime: data.startTime,
    endTime: data.endTime,
    capacity: data.capacity,
    admissionFee: data.admissionFee,
    monthlyTuitionFee: data.monthlyTuitionFee,
    // `fee` is retained for backward compatibility with legacy readers that
    // expect the monthly tuition amount on the listing document.
    fee: data.monthlyTuitionFee,
    duration: `${data.days.join(', ')} · ${data.startTime}–${data.endTime}`,
    location: data.location?.trim() || '',
    description: data.description?.trim() || '',
    image: data.image?.trim() || 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=85',
    startDate: data.startDate ? new Date(data.startDate) : now,
    email: req.user.email,
    teacherName: req.user.fullName || req.user.displayName || req.user.email,
    status: data.status || 'active',
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
    meta: { name: newListing.name, courseId: course._id, category: newListing.category, admissionFee: newListing.admissionFee, monthlyTuitionFee: newListing.monthlyTuitionFee },
  })

  return { _id: listingId, ...newListing }
}

export async function getListings(req, { search, category, page = 1, limit = 20 }) {
  const database = getDatabase()
  const filter = {
    $and: [
      { status: { $ne: 'removed' } },
      { status: { $ne: 'draft' } },
      { status: { $ne: 'completed' } },
    ],
  }

  if (category && typeof category === 'string' && category !== 'All') {
    const normalizedCategory = category.trim()
    filter.category = /^online(?: course)?$/i.test(normalizedCategory)
      ? { $in: [/^online$/i, /^online course$/i] }
      : { $regex: new RegExp(`^${normalizedCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
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
  const filter = {
    $and: [
      { status: { $ne: 'removed' } },
      { status: { $ne: 'draft' } },
      { status: { $ne: 'completed' } },
    ],
  }

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
    {
      _id: objectId,
      $and: [
        { status: { $ne: 'removed' } },
        { status: { $ne: 'draft' } },
        { status: { $ne: 'completed' } },
      ],
    },
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

export async function getMyListings(req, { page = 1, limit = 20, search = '', status = 'All', courseId, category = 'All', sort = 'newest' }) {
  const database = getDatabase()
  const filter = tenantQuery(req, {}, 'teacherUid')
  const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (safeSearch) {
    filter.$or = [
      { name: { $regex: safeSearch, $options: 'i' } },
      { courseName: { $regex: safeSearch, $options: 'i' } },
      { location: { $regex: safeSearch, $options: 'i' } },
    ]
  }
  if (status !== 'All') filter.status = status
  if (courseId) filter.courseId = parseObjectId(courseId, 'courseId')
  if (category !== 'All') filter.category = category

  const skip = (page - 1) * limit
  const collection = database.collection('listings')
  const sortBy = sort === 'oldest'
    ? { createdAt: 1 }
    : sort === 'students'
      ? { enrolledCount: -1, createdAt: -1 }
      : { createdAt: -1 }
  const enrollmentLookup = getEnrollmentLookup()

  const [items, total] = await Promise.all([
    collection.aggregate([
      { $match: filter },
      ...enrollmentLookup,
      { $sort: sortBy },
      { $skip: skip },
      { $limit: limit },
      { $project: { removedAt: 0, removedBy: 0, platformId: 0, teacherUid: 0, enrollmentStats: 0 } },
    ]).toArray(),
    collection.countDocuments(filter),
  ])

  const [stats] = await collection.aggregate([
    { $match: tenantQuery(req, {}, 'teacherUid') },
    ...enrollmentLookup,
    {
      $group: {
        _id: null,
        totalListings: { $sum: 1 },
        activeListings: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        totalEnrolledStudents: { $sum: '$enrolledCount' },
        availableSeats: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'active'] },
              { $max: [{ $subtract: [{ $ifNull: ['$capacity', 0] }, '$enrolledCount'] }, 0] },
              0,
            ],
          },
        },
      },
    },
  ]).toArray()

  return {
    listings: items,
    stats: stats || { totalListings: 0, activeListings: 0, totalEnrolledStudents: 0, availableSeats: 0 },
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

  if (updateData.capacity !== undefined) {
    const enrolledCount = await database.collection('studentEnrollments').countDocuments({
      listingId: objectId,
      status: 'active',
    })
    if (updateData.capacity < enrolledCount) {
      const error = new Error(`Capacity cannot be lower than the ${enrolledCount} currently enrolled students.`)
      error.status = 409
      error.code = 'CAPACITY_BELOW_ENROLLMENT'
      throw error
    }
  }

  // Teachers can update their own listings; the global TeachOS admin can update any listing.
  const updates = {}
  if (updateData.name !== undefined) updates.name = updateData.name.trim()
  if (updateData.category !== undefined) updates.category = updateData.category
  if (updateData.admissionFee !== undefined) updates.admissionFee = updateData.admissionFee
  if (updateData.monthlyTuitionFee !== undefined) {
    updates.monthlyTuitionFee = updateData.monthlyTuitionFee
    updates.fee = updateData.monthlyTuitionFee
  }
  if (updateData.duration !== undefined) updates.duration = updateData.duration.trim()
  if (updateData.location !== undefined) updates.location = updateData.location.trim()
  if (updateData.description !== undefined) updates.description = updateData.description.trim()
  if (updateData.image !== undefined) updates.image = updateData.image.trim()
  if (updateData.startDate !== undefined) updates.startDate = new Date(updateData.startDate)
  if (updateData.days !== undefined) updates.days = updateData.days
  if (updateData.startTime !== undefined) updates.startTime = updateData.startTime
  if (updateData.endTime !== undefined) updates.endTime = updateData.endTime
  if (updateData.capacity !== undefined) updates.capacity = updateData.capacity
  if (updateData.status !== undefined) updates.status = updateData.status
  if (updateData.courseId !== undefined) {
    const course = await getOwnedCourse(req, updateData.courseId)
    updates.courseId = course._id
    updates.courseName = course.name
    updates.category = course.category
    if (updateData.deliveryMode === undefined) updates.deliveryMode = course.deliveryMode
  }
  if (updateData.deliveryMode !== undefined) updates.deliveryMode = updateData.deliveryMode
  if (updateData.days !== undefined || updateData.startTime !== undefined || updateData.endTime !== undefined) {
    const days = updates.days || existing.days || []
    const startTime = updates.startTime || existing.startTime
    const endTime = updates.endTime || existing.endTime
    updates.duration = `${days.join(', ')} · ${startTime}–${endTime}`
  }
  updates.updatedAt = new Date()

  const result = await database.collection('listings').findOneAndUpdate(
    ownershipFilter,
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
