import { Router } from 'express'
import { requirePlatformActive, requireRole, verifyToken } from '../middleware/auth.js'
import { getDatabase } from '../db.js'
import * as platformService from '../services/platform.service.js'
import { getMonthlyCommission } from '../services/finance.service.js'
import { sanitizeInput, validatePagination, validateSchema } from '../utils/validation.js'

export const platformRouter = Router()

// Platform routes require token verification
platformRouter.use(['/platforms', '/admin/billing'], verifyToken)

platformRouter.get('/admin/overview', verifyToken, requireRole('admin'), async (_req, res, next) => {
  try {
    const database = getDatabase()
    const [teachers, students, listings, classes, commission, payouts, latestListings] = await Promise.all([
      database.collection('users').countDocuments({ role: 'teacher', status: { $ne: 'removed' } }),
      database.collection('users').countDocuments({ role: 'student', status: { $ne: 'removed' } }),
      database.collection('listings').countDocuments({ status: 'active' }),
      database.collection('classes').countDocuments(),
      getMonthlyCommission(database),
      database.collection('payoutRequests').aggregate([
        { $match: { isSample: { $ne: true } } },
        { $group: { _id: null, total: { $sum: '$amount' }, pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } } } },
      ]).toArray(),
      database.collection('listings').find(
        { status: 'active' },
        { projection: { teacherUid: 0, platformId: 0, removedAt: 0, removedBy: 0 } },
      ).sort({ createdAt: -1 }).limit(6).toArray(),
    ])

    res.json({
      overview: {
        teachers,
        students,
        listings,
        classes,
        recordedEarnings: commission.commissionAmount,
        monthlyCommission: commission,
        payoutRequests: payouts[0]?.total || 0,
        pendingPayouts: payouts[0]?.pending || 0,
        latestListings,
      },
    })
  } catch (error) {
    next(error)
  }
})

platformRouter.get('/admin/payments', verifyToken, requireRole('admin'), async (_req, res, next) => {
  try {
    const database = getDatabase()
    const month = typeof _req.query?.month === 'string' ? _req.query.month : undefined
    const [paymentRecords, payoutRecords, users, commission] = await Promise.all([
      database.collection('studentPayments').find({ gateway: { $in: ['stripe', 'bkash'] } }).sort({ createdAt: -1 }).limit(100).toArray(),
      database.collection('payoutRequests').find({ isSample: { $ne: true } }).sort({ createdAt: -1 }).limit(100).toArray(),
      database.collection('users').find({}, { projection: { uid: 1, fullName: 1, displayName: 1, email: 1 } }).toArray(),
      getMonthlyCommission(database, month),
    ])
    const usersByUid = new Map(users.map((user) => [user.uid, user.fullName || user.displayName || user.email || 'TeachOS user']))
    const payments = paymentRecords.map((record) => ({
      ...record,
      person: record.teacherName || usersByUid.get(record.teacherUid) || 'TeachOS teacher',
      recordType: 'earning',
      transactionType: record.gateway === 'stripe' ? `Stripe ${record.mode} payment` : `bKash ${record.mode} payment`,
    }))
    const payouts = payoutRecords.map((record) => ({
      ...record,
      person: usersByUid.get(record.uid) || 'TeachOS user',
      recordType: 'payout',
    }))
    const requestedPayouts = payoutRecords.filter((record) => record.status !== 'rejected')
      .reduce((total, record) => total + (Number(record.amount) || 0), 0)

    res.json({
      payments,
      payouts,
      summary: {
        month: commission.month,
        timezone: commission.timezone,
        currency: commission.currency,
        commissionRate: commission.commissionRate,
        monthlyGross: commission.grossAmount,
        recordedEarnings: commission.commissionAmount,
        teacherNet: commission.teacherNetAmount,
        teacherBreakdown: commission.teachers,
        requestedPayouts,
        pendingPayouts: payoutRecords.filter((record) => record.status === 'pending')
          .reduce((total, record) => total + (Number(record.amount) || 0), 0),
      },
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/admin/billing
 * Global TeachOS admin can inspect platform billing records.
 */
platformRouter.get('/admin/billing', requireRole('admin'), requirePlatformActive, async (req, res, next) => {
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
platformRouter.post('/platforms', requireRole('admin'), async (req, res, next) => {
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

platformRouter.get('/platforms', requireRole('admin'), async (req, res, next) => {
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

platformRouter.get('/platforms/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const platform = await platformService.getPlatformById(req.params.id)
    res.json({ platform })
  } catch (error) {
    next(error)
  }
})

platformRouter.patch('/platforms/:id/suspend', requireRole('admin'), async (req, res, next) => {
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

platformRouter.patch('/platforms/:id/reactivate', requireRole('admin'), async (req, res, next) => {
  try {
    const platform = await platformService.reactivatePlatform(req.params.id, {
      actorUid: req.authUid,
    })
    res.json({ platform, message: 'Platform successfully reactivated' })
  } catch (error) {
    next(error)
  }
})

platformRouter.patch('/platforms/:id/extend', requireRole('admin'), async (req, res, next) => {
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

platformRouter.delete('/platforms/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await platformService.softDeletePlatform(req.params.id, {
      actorUid: req.authUid,
    })
    res.json(result)
  } catch (error) {
    next(error)
  }
})
