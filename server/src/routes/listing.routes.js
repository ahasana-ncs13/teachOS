import { Router } from 'express'
import { requirePlatformActive, requireRole, verifyToken } from '../middleware/auth.js'
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
        enum: ['Online Course', 'Offline Batch', 'Exam Preparation', 'Skill Course'],
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
    ])

    validateSchema(body, {
      name: { required: false, type: 'string', min: 3, max: 150 },
      category: {
        required: false,
        type: 'string',
        enum: ['Online Course', 'Offline Batch', 'Exam Preparation', 'Skill Course'],
      },
      fee: { required: false, type: 'number' },
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
