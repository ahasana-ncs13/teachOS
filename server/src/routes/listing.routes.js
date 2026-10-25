import { Router } from 'express'
import { getDatabase } from '../db.js'
import { requirePlatformActive, requireRole, verifyToken } from '../middleware/auth.js'
import { notifyListingStudents } from '../services/notification.service.js'
import * as listingService from '../services/listing.service.js'
import { sanitizeInput, validatePagination, validateSchema } from '../utils/validation.js'

export const listingRouter = Router()

/**
 * Public routes:
 * - GET /api/listings/latest (for Home page recent listings)
 * - GET /api/listings (for Courses & Batches browsing with filters)
 * - GET /api/listings/:id (for Listing Details)
 */
listingRouter.get('/listings/latest', async (req, res, next) => {
  try {
    const count = req.query.count ? Number(req.query.count) : 6
    const result = await listingService.getLatestListings(req, count)
    res.json(result)
  } catch (error) {
    next(error)
  }
})

listingRouter.get('/listings', async (req, res, next) => {
  try {
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
    const pagination = validatePagination(req.query)
    const result = await listingService.getMyListings(req, pagination)
    res.json(result)
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
listingRouter.post('/listings', verifyToken, requireRole('teacher'), async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, [
      'name',
      'category',
      'fee',
      'duration',
      'location',
      'description',
      'image',
      'startDate',
    ])

    validateSchema(body, {
      name: { required: true, type: 'string', min: 3, max: 150 },
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
      startDate: { required: false, type: 'string' },
    })

    const listing = await listingService.createListing(req, body)
    res.status(201).json({ listing, message: 'Listing created successfully' })
  } catch (error) {
    next(error)
  }
})

listingRouter.put('/listings/:id', verifyToken, requireRole('teacher', 'admin'), requirePlatformActive, async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, [
      'name',
      'category',
      'fee',
      'duration',
      'location',
      'description',
      'image',
      'startDate',
      'status',
    ])

    validateSchema(body, {
      name: { required: false, type: 'string', min: 3, max: 150 },
      category: {
        required: false,
        type: 'string',
        enum: ['Online Course', 'Offline Batch', 'Exam Preparation', 'Skill Course', 'Theory Course'],
      },
      fee: { required: false, type: 'number' },
      status: { required: false, type: 'string', enum: ['active', 'draft'] },
      duration: { required: false, type: 'string', min: 2, max: 100 },
      location: { required: false, type: 'string', min: 2, max: 200 },
      description: { required: false, type: 'string', min: 10, max: 5000 },
      image: { required: false, type: 'string' },
      startDate: { required: false, type: 'string' },
    })

    const listing = await listingService.updateListing(req, req.params.id, body)
    res.json({ listing, message: 'Listing updated successfully' })
  } catch (error) {
    next(error)
  }
})

listingRouter.delete('/listings/:id', verifyToken, requireRole('teacher', 'admin'), requirePlatformActive, async (req, res, next) => {
  try {
    const result = await listingService.softDeleteListing(req, req.params.id)
    res.json(result)
  } catch (error) {
    next(error)
  }
})
