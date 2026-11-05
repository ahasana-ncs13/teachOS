import { Router } from 'express'
import { getDatabase } from '../db.js'
import { requirePlatformActive, requireRole, verifyToken } from '../middleware/auth.js'
import { notifyListingStudents } from '../services/notification.service.js'
import * as listingService from '../services/listing.service.js'
import { parseObjectId, sanitizeInput, validatePagination, validateSchema } from '../utils/validation.js'

export const listingRouter = Router()

const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

function validateSchedule(body, { required = false } = {}) {
  const scheduleProvided = body.days !== undefined || body.startTime !== undefined || body.endTime !== undefined

  if ((required || scheduleProvided) && !Array.isArray(body.days)) {
    const error = new Error('Choose at least one day for the schedule.')
    error.status = 400
    error.code = 'INVALID_SCHEDULE'
    throw error
  }

  if (body.days !== undefined && (
    !Array.isArray(body.days) ||
    body.days.length === 0 ||
    body.days.some((day) => !daysOfWeek.includes(day)) ||
    new Set(body.days).size !== body.days.length
  )) {
    const error = new Error('Choose one or more valid, unique days.')
    error.status = 400
    error.code = 'INVALID_SCHEDULE'
    throw error
  }

  if (required || scheduleProvided) {
    if (!timePattern.test(body.startTime || '') || !timePattern.test(body.endTime || '') ||
        body.endTime <= body.startTime) {
      const error = new Error('Enter valid start and end times. End time must be later than start time.')
      error.status = 400
      error.code = 'INVALID_SCHEDULE'
      throw error
    }
  }
}

function validateStartDate(body) {
  if (body.startDate === undefined || body.startDate === '') return
  const validDate = typeof body.startDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.startDate) &&
    !Number.isNaN(Date.parse(`${body.startDate}T00:00:00Z`)) &&
    new Date(`${body.startDate}T00:00:00Z`).toISOString().slice(0, 10) === body.startDate
  if (!validDate) {
    const error = new Error('Start date must be a valid calendar date.')
    error.status = 400
    error.code = 'INVALID_START_DATE'
    throw error
  }
}

function validateImageUrl(body) {
  if (body.image === undefined || body.image === '') return
  let valid = false
  try {
    const imageUrl = new URL(body.image)
    valid = ['http:', 'https:'].includes(imageUrl.protocol)
  } catch {
    valid = false
  }
  if (!valid) {
    const error = new Error('Image must be a valid HTTP or HTTPS URL.')
    error.status = 400
    error.code = 'INVALID_IMAGE_URL'
    throw error
  }
}

function validateListingPricing(body, { required = false } = {}) {
  if (required && (typeof body.capacity !== 'number' || !Number.isSafeInteger(body.capacity) || body.capacity <= 0)) {
    const error = new Error('Capacity must be a positive whole number.')
    error.status = 400
    error.code = 'INVALID_CAPACITY'
    throw error
  }
  if (!required && body.capacity !== undefined &&
      (!Number.isSafeInteger(body.capacity) || body.capacity <= 0)) {
    const error = new Error('Capacity must be a positive whole number.')
    error.status = 400
    error.code = 'INVALID_CAPACITY'
    throw error
  }

  if (required && (typeof body.admissionFee !== 'number' || !Number.isFinite(body.admissionFee) || body.admissionFee < 0)) {
    const error = new Error('Admission fee must be a non-negative number.')
    error.status = 400
    error.code = 'INVALID_ADMISSION_FEE'
    throw error
  }
  if (!required && body.admissionFee !== undefined &&
      (typeof body.admissionFee !== 'number' || !Number.isFinite(body.admissionFee) || body.admissionFee < 0)) {
    const error = new Error('Admission fee must be a non-negative number.')
    error.status = 400
    error.code = 'INVALID_ADMISSION_FEE'
    throw error
  }

  if (required && (typeof body.monthlyTuitionFee !== 'number' || !Number.isFinite(body.monthlyTuitionFee) || body.monthlyTuitionFee < 0)) {
    const error = new Error('Monthly tuition fee must be a non-negative number.')
    error.status = 400
    error.code = 'INVALID_TUITION_FEE'
    throw error
  }
  if (!required && body.monthlyTuitionFee !== undefined &&
      (typeof body.monthlyTuitionFee !== 'number' || !Number.isFinite(body.monthlyTuitionFee) || body.monthlyTuitionFee < 0)) {
    const error = new Error('Monthly tuition fee must be a non-negative number.')
    error.status = 400
    error.code = 'INVALID_TUITION_FEE'
    throw error
  }

  validateStartDate(body)
  validateImageUrl(body)
}

function validateListingQuery(query) {
  const allowedFields = new Set(['page', 'limit', 'search', 'status', 'courseId', 'category', 'sort'])
  for (const key of Object.keys(query)) {
    if (!allowedFields.has(key)) {
      const error = new Error(`Unknown query parameter: '${key}'`)
      error.status = 400
      error.code = 'UNKNOWN_QUERY_PARAMETER'
      throw error
    }
  }
  for (const key of ['page', 'limit', 'search', 'status', 'courseId', 'category', 'sort']) {
    if (query[key] !== undefined && typeof query[key] !== 'string') {
      const error = new Error(`Query parameter '${key}' must be a string.`)
      error.status = 400
      error.code = 'INVALID_QUERY_PARAMETER'
      throw error
    }
  }
  for (const key of ['page', 'limit']) {
    if (query[key] !== undefined && (!/^\d+$/.test(query[key]) || Number(query[key]) < 1)) {
      const error = new Error(`Query parameter '${key}' must be a positive integer.`)
      error.status = 400
      error.code = 'INVALID_QUERY_PARAMETER'
      throw error
    }
  }
  if (query.search && query.search.length > 150) {
    const error = new Error('Search cannot exceed 150 characters.')
    error.status = 400
    error.code = 'INVALID_QUERY_PARAMETER'
    throw error
  }
  if (query.status && !['All', 'active', 'draft', 'completed'].includes(query.status)) {
    const error = new Error('Status must be All, active, draft, or completed.')
    error.status = 400
    error.code = 'INVALID_QUERY_PARAMETER'
    throw error
  }
  if (query.category && query.category !== 'All' && query.category !== 'Online') {
    const error = new Error('Category must be All or Online.')
    error.status = 400
    error.code = 'INVALID_QUERY_PARAMETER'
    throw error
  }
  if (query.sort && !['newest', 'oldest', 'students'].includes(query.sort)) {
    const error = new Error('Sort must be newest, oldest, or students.')
    error.status = 400
    error.code = 'INVALID_QUERY_PARAMETER'
    throw error
  }
}

function validatePublicListingQuery(query) {
  const allowedFields = new Set(['page', 'limit', 'search', 'category'])
  for (const key of Object.keys(query)) {
    if (!allowedFields.has(key)) {
      const error = new Error(`Unknown query parameter: '${key}'`)
      error.status = 400
      error.code = 'UNKNOWN_QUERY_PARAMETER'
      throw error
    }
  }
  for (const key of Object.keys(query)) {
    if (typeof query[key] !== 'string') {
      const error = new Error(`Query parameter '${key}' must be a string.`)
      error.status = 400
      error.code = 'INVALID_QUERY_PARAMETER'
      throw error
    }
  }
  for (const key of ['page', 'limit']) {
    if (query[key] !== undefined && (!/^\d+$/.test(query[key]) || Number(query[key]) < 1)) {
      const error = new Error(`Query parameter '${key}' must be a positive integer.`)
      error.status = 400
      error.code = 'INVALID_QUERY_PARAMETER'
      throw error
    }
  }
  if (query.search && query.search.length > 150) {
    const error = new Error('Search cannot exceed 150 characters.')
    error.status = 400
    error.code = 'INVALID_QUERY_PARAMETER'
    throw error
  }
  if (query.category && query.category.length > 100) {
    const error = new Error('Category cannot exceed 100 characters.')
    error.status = 400
    error.code = 'INVALID_QUERY_PARAMETER'
    throw error
  }
}

function rejectQueryParameters(query) {
  if (Object.keys(query).length) {
    const error = new Error('This endpoint does not accept query parameters.')
    error.status = 400
    error.code = 'UNKNOWN_QUERY_PARAMETER'
    throw error
  }
}

/**
 * Public routes:
 * - GET /api/listings/latest (for Home page recent listings)
 * - GET /api/listings (for Courses & Batches browsing with filters)
 * - GET /api/listings/:id (for Listing Details)
 */
listingRouter.get('/listings/latest', async (req, res, next) => {
  try {
    if (Object.keys(req.query).some((key) => key !== 'count') ||
        (req.query.count !== undefined && (!/^\d+$/.test(req.query.count) || Number(req.query.count) < 1))) {
      const error = new Error('Count must be a positive integer.')
      error.status = 400
      error.code = 'INVALID_QUERY_PARAMETER'
      throw error
    }
    const count = req.query.count ? Number(req.query.count) : 6
    const result = await listingService.getLatestListings(req, count)
    res.json(result)
  } catch (error) {
    next(error)
  }
})

listingRouter.get('/listings', async (req, res, next) => {
  try {
    validatePublicListingQuery(req.query)
    const pagination = validatePagination(req.query)
    const { search, category } = req.query
    const result = await listingService.getListings(req, {
      ...pagination,
      search,
      category,
    })
    res.json(result)
  } catch (error) {
    next(error)
  }
})

/**
 * Private: GET /api/listings/my
 * Must come before /listings/:id so "my" is not captured as an id param.
 */
listingRouter.get('/listings/my', verifyToken, requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    validateListingQuery(req.query)
    const pagination = validatePagination(req.query)
    const result = await listingService.getMyListings(req, {
      ...pagination,
      search: req.query.search || '',
      status: req.query.status || 'All',
      courseId: req.query.courseId,
      category: req.query.category || 'All',
      sort: req.query.sort || 'newest',
    })
    res.json(result)
  } catch (error) {
    next(error)
  }
})

listingRouter.get('/listings/:id/students', verifyToken, requireRole('teacher'), async (req, res, next) => {
  try {
    rejectQueryParameters(req.query)
    const listingId = parseObjectId(req.params.id, 'listingId')
    const database = getDatabase()
    const listingFilter = req.user.role === 'admin'
      ? { _id: listingId, status: { $ne: 'removed' } }
      : { _id: listingId, teacherUid: req.authUid, status: { $ne: 'removed' } }
    const listing = await database.collection('listings').findOne(
      listingFilter,
      { projection: { name: 1, capacity: 1 } },
    )
    if (!listing) return res.status(404).json({ message: 'Listing not found.', code: 'LISTING_NOT_FOUND' })

    const students = await database.collection('studentEnrollments')
      .find(
        { listingId, status: 'active' },
        { projection: { studentUid: 0, listingId: 0, teacherUid: 0 } },
      )
      .sort({ enrolledAt: -1 })
      .toArray()

    res.json({
      listing: { _id: listing._id, name: listing.name, capacity: listing.capacity || 0 },
      students,
      total: students.length,
    })
  } catch (error) {
    next(error)
  }
})

listingRouter.get('/listings/:id/assignments', verifyToken, requireRole('teacher'), async (req, res, next) => {
  try {
    const listingId = parseObjectId(req.params.id, 'listingId')
    const database = getDatabase()
    const listing = await database.collection('listings').findOne({
      _id: listingId,
      teacherUid: req.authUid,
      status: 'active',
    })
    if (!listing) return res.status(404).json({ message: 'Listing not found.', code: 'LISTING_NOT_FOUND' })

    const assignments = await database.collection('assignments').find({ listingId }).sort({ createdAt: -1 }).toArray()
    const assignmentIds = assignments.map((assignment) => assignment._id)
    const submissions = assignmentIds.length
      ? await database.collection('assignmentSubmissions').find({ assignmentId: { $in: assignmentIds } }).sort({ submittedAt: -1 }).toArray()
      : []
    const submissionsByAssignment = new Map()
    for (const submission of submissions) {
      const key = String(submission.assignmentId)
      const records = submissionsByAssignment.get(key) || []
      records.push(submission)
      submissionsByAssignment.set(key, records)
    }
    res.json({
      assignments: assignments.map((assignment) => ({
        ...assignment,
        submissions: submissionsByAssignment.get(String(assignment._id)) || [],
      })),
    })
  } catch (error) {
    next(error)
  }
})

listingRouter.post('/listings/:id/assignments', verifyToken, requireRole('teacher'), async (req, res, next) => {
  try {
    const listingId = parseObjectId(req.params.id, 'listingId')
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : ''
    const dueDateValue = req.body?.dueDate
    const validDueDate = !dueDateValue || (
      typeof dueDateValue === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(dueDateValue) &&
      !Number.isNaN(Date.parse(`${dueDateValue}T00:00:00Z`)) &&
      new Date(`${dueDateValue}T00:00:00Z`).toISOString().slice(0, 10) === dueDateValue
    )
    if (title.length < 3 || title.length > 150 || description.length > 5000 ||
        !validDueDate) {
      return res.status(400).json({ message: 'Provide a title, description (up to 5,000 characters), and valid due date.' })
    }

    const database = getDatabase()
    const listing = await database.collection('listings').findOne({
      _id: listingId,
      teacherUid: req.authUid,
      status: 'active',
    })
    if (!listing) return res.status(404).json({ message: 'Listing not found.', code: 'LISTING_NOT_FOUND' })

    const now = new Date()
    const assignment = {
      listingId,
      teacherUid: req.authUid,
      teacherName: req.user.fullName || req.user.email,
      listingName: listing.name,
      title,
      description,
      dueDate: dueDateValue || null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }

    const result = await database.collection('assignments').insertOne(assignment)
    const notificationsSent = await notifyListingStudents(database, listingId, {
      type: 'assignment',
      title: 'New assignment',
      message: `${title} was added to ${listing.name}${dueDateValue ? ` · due ${dueDateValue}` : ''}.`,
      href: '/student/assignments',
      relatedId: String(result.insertedId),
    })
    res.status(201).json({ assignment: { _id: result.insertedId, ...assignment }, notificationsSent })
  } catch (error) {
    next(error)
  }
})

listingRouter.get('/listings/:id', async (req, res, next) => {
  try {
    const listing = await listingService.getListingById(req.params.id)
    res.json({ listing })
  } catch (error) {
    next(error)
  }
})

/**
 * Private / Protected Mutation routes:
 * - POST /api/listings
 * - PUT /api/listings/:id
 * - DELETE /api/listings/:id
 */
listingRouter.post('/listings', verifyToken, requireRole('teacher'), requirePlatformActive, async (req, res, next) => {
  try {
    rejectQueryParameters(req.query)
    const body = sanitizeInput(req.body, [
      'name',
      'courseId',
      'deliveryMode',
      'days',
      'startTime',
      'endTime',
      'capacity',
      'admissionFee',
      'monthlyTuitionFee',
      'location',
      'description',
      'image',
      'startDate',
      'status',
    ])

    validateSchema(body, {
      name: { required: true, type: 'string', min: 3, max: 150 },
<<<<<<< HEAD
      category: {
        required: true,
        type: 'string',
        enum: ['Online Course', 'Offline Batch', 'Exam Preparation', 'Skill Course', 'Theory Course'],
      },
      fee: { required: false, type: 'number' },
      duration: { required: true, type: 'string', min: 2, max: 100 },
      location: { required: true, type: 'string', min: 2, max: 200 },
      description: { required: true, type: 'string', min: 10, max: 5000 },
      image: { required: false, type: 'string' },
=======
      courseId: { required: true, type: 'string', min: 24, max: 24 },
      deliveryMode: { required: true, type: 'string', enum: ['live', 'recorded'] },
      days: { required: true },
      startTime: { required: true, type: 'string' },
      endTime: { required: true, type: 'string' },
      capacity: { required: true, type: 'number' },
      admissionFee: { required: true, type: 'number' },
      monthlyTuitionFee: { required: true, type: 'number' },
      location: { required: false, type: 'string', max: 200 },
      description: { required: false, type: 'string', max: 5000 },
      image: { required: false, type: 'string', max: 2048 },
>>>>>>> fbaf0e5 (done Z)
      startDate: { required: false, type: 'string' },
      status: { required: false, type: 'string', enum: ['active', 'draft'] },
    })
    validateSchedule(body, { required: true })
    validateListingPricing(body, { required: true })

    const listing = await listingService.createListing(req, body)
    res.status(201).json({ listing, message: 'Listing created successfully' })
  } catch (error) {
    next(error)
  }
})

listingRouter.put('/listings/:id', verifyToken, requireRole('teacher', 'admin'), requirePlatformActive, async (req, res, next) => {
  try {
    rejectQueryParameters(req.query)
    const body = sanitizeInput(req.body, [
      'name',
      'courseId',
      'deliveryMode',
      'category',
      'admissionFee',
      'monthlyTuitionFee',
      'duration',
      'location',
      'description',
      'image',
      'startDate',
<<<<<<< HEAD
=======
      'days',
      'startTime',
      'endTime',
      'capacity',
>>>>>>> fbaf0e5 (done Z)
      'status',
    ])
    if (!Object.keys(body).length) {
      const error = new Error('Provide at least one listing field to update.')
      error.status = 400
      error.code = 'EMPTY_UPDATE'
      throw error
    }

    validateSchema(body, {
      name: { required: false, type: 'string', min: 3, max: 150 },
      category: {
        required: false,
        type: 'string',
<<<<<<< HEAD
        enum: ['Online Course', 'Offline Batch', 'Exam Preparation', 'Skill Course', 'Theory Course'],
      },
      fee: { required: false, type: 'number' },
      status: { required: false, type: 'string', enum: ['active', 'draft'] },
=======
        enum: ['Online'],
      },
      admissionFee: { required: false, type: 'number' },
      monthlyTuitionFee: { required: false, type: 'number' },
>>>>>>> fbaf0e5 (done Z)
      duration: { required: false, type: 'string', min: 2, max: 100 },
      location: { required: false, type: 'string', max: 200 },
      description: { required: false, type: 'string', max: 5000 },
      image: { required: false, type: 'string', max: 2048 },
      startDate: { required: false, type: 'string' },
      courseId: { required: false, type: 'string', min: 24, max: 24 },
      deliveryMode: { required: false, type: 'string', enum: ['live', 'recorded'] },
      startTime: { required: false, type: 'string' },
      endTime: { required: false, type: 'string' },
      capacity: { required: false, type: 'number' },
      status: { required: false, type: 'string', enum: ['active', 'draft', 'completed'] },
    })
    validateSchedule(body)
    validateListingPricing(body)

    const listing = await listingService.updateListing(req, req.params.id, body)
    res.json({ listing, message: 'Listing updated successfully' })
  } catch (error) {
    next(error)
  }
})

listingRouter.delete('/listings/:id', verifyToken, requireRole('teacher', 'admin'), requirePlatformActive, async (req, res, next) => {
  try {
    rejectQueryParameters(req.query)
    const result = await listingService.softDeleteListing(req, req.params.id)
    res.json(result)
  } catch (error) {
    next(error)
  }
})
