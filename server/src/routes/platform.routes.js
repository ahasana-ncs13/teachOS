import { Router } from 'express'
import { requirePlatformActive, requireRole, verifyToken } from '../middleware/auth.js'
import * as platformService from '../services/platform.service.js'
import { sanitizeInput, validatePagination, validateSchema } from '../utils/validation.js'

export const platformRouter = Router()

// Platform routes require token verification
platformRouter.use(['/platforms', '/admin/billing'], verifyToken)

/**
 * GET /api/admin/billing
 * Accessible by tenant admin (and superAdmin) even when platform is suspended or expired.
 */
platformRouter.get('/admin/billing', requireRole('admin', 'superAdmin'), requirePlatformActive, async (req, res, next) => {
  try {
    const targetPlatformId = req.platform?._id || req.query.platformId
    if (!targetPlatformId) {
      return res.status(400).json({ message: 'Platform ID required', code: 'PLATFORM_ID_REQUIRED' })
    }
    const billing = await platformService.getPlatformBillingSummary(targetPlatformId)
    res.json({ billing })
  } catch (error) {
    next(error)
  }
})

/**
 * SuperAdmin platform management routes
 */
platformRouter.post('/platforms', requireRole('superAdmin'), async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['name', 'slug', 'plan', 'renewalDate', 'gracePeriodDays'])
    validateSchema(body, {
      name: { required: true, type: 'string', min: 2, max: 100 },
      slug: { required: true, type: 'string', min: 2, max: 50 },
      plan: { required: false, type: 'string', enum: ['starter', 'standard', 'premium', 'enterprise'] },
      gracePeriodDays: { required: false, type: 'number' },
    })

    const platform = await platformService.createPlatform({
      ...body,
      actorUid: req.authUid,
    })
    res.status(201).json({ platform })
  } catch (error) {
    next(error)
  }
})

platformRouter.get('/platforms', requireRole('superAdmin'), async (req, res, next) => {
  try {
    const pagination = validatePagination(req.query)
    const { status, search } = req.query
    const result = await platformService.listPlatforms({
      ...pagination,
      status,
      search,
    })
    res.json(result)
  } catch (error) {
    next(error)
  }
})

platformRouter.get('/platforms/:id', requireRole('superAdmin'), async (req, res, next) => {
  try {
    const platform = await platformService.getPlatformById(req.params.id)
    res.json({ platform })
  } catch (error) {
    next(error)
  }
})

platformRouter.patch('/platforms/:id/suspend', requireRole('superAdmin'), async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['reason'])
    validateSchema(body, {
      reason: { required: false, type: 'string', max: 500 },
    })
    const platform = await platformService.suspendPlatform(req.params.id, {
      reason: body.reason || 'Administrative action',
      actorUid: req.authUid,
    })
    res.json({ platform, message: 'Platform successfully suspended' })
  } catch (error) {
    next(error)
  }
})

platformRouter.patch('/platforms/:id/reactivate', requireRole('superAdmin'), async (req, res, next) => {
  try {
    const platform = await platformService.reactivatePlatform(req.params.id, {
      actorUid: req.authUid,
    })
    res.json({ platform, message: 'Platform successfully reactivated' })
  } catch (error) {
    next(error)
  }
})

platformRouter.patch('/platforms/:id/extend', requireRole('superAdmin'), async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['days'])
    validateSchema(body, {
      days: { required: true, type: 'number' },
    })
    const platform = await platformService.extendPlatformRenewal(req.params.id, {
      days: body.days,
      actorUid: req.authUid,
    })
    res.json({ platform, message: 'Platform renewal date successfully extended' })
  } catch (error) {
    next(error)
  }
})

platformRouter.delete('/platforms/:id', requireRole('superAdmin'), async (req, res, next) => {
  try {
    const result = await platformService.softDeletePlatform(req.params.id, {
      actorUid: req.authUid,
    })
    res.json(result)
  } catch (error) {
    next(error)
  }
})
