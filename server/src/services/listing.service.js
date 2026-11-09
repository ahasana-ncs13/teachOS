import { getDatabase } from '../db.js'
import { parseObjectId } from '../utils/validation.js'
import { tenantQuery, tenantInsert } from '../utils/tenant.js'
import { LEGACY_SAMPLE_LISTING_NAMES, LEGACY_SAMPLE_USER_UIDS } from '../utils/sampleData.js'
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
  const isOneTime = listing.pricingType === 'ONE_TIME' || (!listing.monthlyTuitionFee && Number(listing.fee) > 0 && listing.pricingType !== 'MONTHLY_SUBSCRIPTION')
  if (isOneTime) {
    const fee = Number(listing.fee ?? listing.price ?? listing.oneTimeFee ?? 0) || 0
    return {
      pricingType: 'ONE_TIME',
      admissionFee: 0,
      monthlyTuitionFee: 0,
      initialPaymentTotal: fee,
      isOneTime: true,
    }
  }
  const monthlyTuitionFee = Number(listing.monthlyTuitionFee ?? listing.fee ?? 0) || 0
  const admissionFee = Number(listing.admissionFee ?? 0) || 0
  const initialPaymentTotal = admissionFee + monthlyTuitionFee
  return {
    pricingType: 'MONTHLY_SUBSCRIPTION',
    admissionFee,
    monthlyTuitionFee,
    initialPaymentTotal,
    isOneTime: false,
  }
}

export function getPublicListingFilter() {
  return {
    status: 'active',
    isBanned: { $ne: true },
    teacherUid: {
      $nin: LEGACY_SAMPLE_USER_UIDS,
      $not: /^demo-/,
    },
    name: { $nin: LEGACY_SAMPLE_LISTING_NAMES },
    $or: [
      { published: true },
      { published: { $exists: false } },
    ],
    $nor: [
      { category: /offline/i },
      { deliveryMode: { $in: ['in_person', 'hybrid'] } },
      { location: /offline|in.person|hybrid/i },
    ],
  }
}

export async function getAdminListings({ page = 1, limit = 100, search = '', category = '' }) {
  const database = getDatabase()
  const filter = {
    status: { $ne: 'removed' },
    teacherUid: {
      $nin: LEGACY_SAMPLE_USER_UIDS,
      $not: /^demo-/,
    },
    name: { $nin: LEGACY_SAMPLE_LISTING_NAMES },
  }
  if (search) {
    const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [
      { name: { $regex: safeSearch, $options: 'i' } },
      { teacherName: { $regex: safeSearch, $options: 'i' } },
      { location: { $regex: safeSearch, $options: 'i' } },
      { category: { $regex: safeSearch, $options: 'i' } },
    ]
  }
  if (category) filter.category = category

  const collection = database.collection('listings')
  const [listings, total] = await Promise.all([
    collection
      .find(filter, { projection: { removedAt: 0, removedBy: 0, platformId: 0 } })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    collection.countDocuments(filter),
  ])
  return {
    listings,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  }
}

export async function setListingBan(id, { banned, reason = '', actorUid }) {
  const objectId = parseObjectId(id, 'listingId')
  const database = getDatabase()
  const collection = database.collection('listings')
  const existing = await collection.findOne({ _id: objectId, status: { $ne: 'removed' } })
  if (!existing) {
    const error = new Error('Course listing not found.')
    error.status = 404
    error.code = 'LISTING_NOT_FOUND'
    throw error
  }

  const now = new Date()
  const update = banned
    ? {
        $set: {
          isBanned: true,
          banReason: reason.trim() || 'Administrative moderation',
          bannedAt: now,
          bannedBy: actorUid,
          updatedAt: now,
        },
      }
    : {
        $unset: { isBanned: '', banReason: '', bannedAt: '', bannedBy: '' },
        $set: { updatedAt: now },
      }
  const result = await collection.updateOne({ _id: objectId, status: { $ne: 'removed' } }, update)
  if (!result.matchedCount) {
    const error = new Error('Course listing not found.')
    error.status = 404
    error.code = 'LISTING_NOT_FOUND'
    throw error
  }
  const listing = await collection.findOne(
    { _id: objectId },
    { projection: { removedAt: 0, removedBy: 0, platformId: 0 } },
  )

  await writeAuditLog({
    actorUid,
    actorRole: 'admin',
    action: banned ? 'BAN_LISTING' : 'UNBAN_LISTING',
    targetType: 'listing',
    targetId: objectId,
    meta: { name: existing.name, reason: banned ? (reason.trim() || 'Administrative moderation') : undefined },
  })

  return listing
}

async function addPublicListingMetrics(database, listings) {
  if (!listings.length) return listings
  const listingIds = listings.map((listing) => listing._id)
  const [enrollments, attendance] = await Promise.all([
    database.collection('studentEnrollments').aggregate([
      { $match: { listingId: { $in: listingIds }, status: 'active' } },
      { $group: { _id: '$listingId', count: { $sum: 1 } } },
    ]).toArray(),
    database.collection('sessionAttendance').aggregate([
      { $match: { listingId: { $in: listingIds }, status: { $in: ['present', 'absent'] } } },
      { $group: { _id: { listingId: '$listingId', status: '$status' }, count: { $sum: 1 } } },
    ]).toArray(),
  ])
  const enrollmentCounts = new Map(enrollments.map((record) => [String(record._id), record.count]))
  const attendanceCounts = new Map()
  for (const record of attendance) {
    const listingId = String(record._id.listingId)
    const counts = attendanceCounts.get(listingId) || { attended: 0, total: 0 }
    counts.total += record.count
    if (record._id.status === 'present') counts.attended += record.count
    attendanceCounts.set(listingId, counts)
  }
  return listings.map((listing) => {
    const counts = attendanceCounts.get(String(listing._id))
    return {
      ...listing,
      enrolledCount: enrollmentCounts.get(String(listing._id)) || 0,
      attendancePercentage: counts?.total ? Math.round((counts.attended / counts.total) * 100) : null,
      rating: null,
    }
  })
}

/**
 * Service to manage course and batch listings.
 */
export async function createListing(req, data) {
  const database = getDatabase()
  const listings = database.collection('listings')
  const course = await getOwnedCourse(req, data.courseId)

  const now = new Date()
  const pricingType = data.pricingType || (Number(data.monthlyTuitionFee) > 0 ? 'MONTHLY_SUBSCRIPTION' : 'ONE_TIME')
  const newListing = tenantInsert(req, {
    name: data.name.trim(),
    category: 'Online',
    courseId: course._id,
    courseName: course.name,
    pricingType,
    deliveryMode: data.deliveryMode || course.deliveryMode,
    days: data.days,
    startTime: data.startTime,
    endTime: data.endTime,
    capacity: data.capacity,
    admissionFee: data.admissionFee,
    monthlyTuitionFee: data.monthlyTuitionFee,
    // `fee` is retained for backward compatibility with legacy readers that
    // expect the course fee / tuition amount on the listing document.
    fee: pricingType === 'ONE_TIME' ? (data.admissionFee || data.monthlyTuitionFee || data.fee) : data.monthlyTuitionFee,
    duration: `${data.days.join(', ')} · ${data.startTime}–${data.endTime}`,
    location: data.location?.trim() || '',
    description: data.description?.trim() || '',
    image: data.image?.trim() || 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=85',
    startDate: data.startDate ? new Date(data.startDate) : now,
    email: req.user.email,
    teacherName: req.user.fullName || req.user.displayName || req.user.email,
    status: data.status || 'active',
    published: false,
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
  const filter = getPublicListingFilter()
  const conditions = []

  if (category && typeof category === 'string' && category !== 'All') {
    const normalizedCategory = category.trim()
    const categoryPattern = new RegExp(normalizedCategory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    conditions.push({
      $or: [
        { category: categoryPattern },
        { courseName: categoryPattern },
        { name: categoryPattern },
        { description: categoryPattern },
      ],
    })
  }

  if (search && typeof search === 'string' && search.trim()) {
    const safeRegex = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    conditions.push({
      $or: [
        { name: { $regex: safeRegex, $options: 'i' } },
        { courseName: { $regex: safeRegex, $options: 'i' } },
        { description: { $regex: safeRegex, $options: 'i' } },
        { location: { $regex: safeRegex, $options: 'i' } },
        { teacherName: { $regex: safeRegex, $options: 'i' } },
      ],
    })
  }
  if (conditions.length) filter.$and = conditions

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
    listings: await addPublicListingMetrics(database, items),
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
  const filter = getPublicListingFilter()

  const limit = Math.min(Math.max(Number(count) || 6, 1), 20)

  const items = await database
    .collection('listings')
    .find(filter, { projection: { removedAt: 0, removedBy: 0, platformId: 0, teacherUid: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()

  return { listings: await addPublicListingMetrics(database, items) }
}

export async function getListingById(id) {
  const objectId = parseObjectId(id, 'listingId')
  const database = getDatabase()
  const listing = await database.collection('listings').findOne(
    {
      _id: objectId,
      ...getPublicListingFilter(),
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
  const ownerFilter = tenantQuery(req, {}, 'teacherUid')
  if (req.user.role === 'admin') {
    ownerFilter.teacherUid = { $nin: LEGACY_SAMPLE_USER_UIDS, $not: /^demo-/ }
    ownerFilter.name = { $nin: LEGACY_SAMPLE_LISTING_NAMES }
  }
  const filter = { ...ownerFilter }
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
    { $match: ownerFilter },
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
  if (updateData.pricingType !== undefined) updates.pricingType = updateData.pricingType
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
  if (updateData.published !== undefined) {
    updates.published = updateData.published
    updates.publishedAt = updateData.published ? (existing.publishedAt || new Date()) : null
    if (updateData.published && existing.status === 'draft') updates.status = 'active'
  }
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
