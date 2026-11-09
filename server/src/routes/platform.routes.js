import { Router } from 'express'
import { requirePlatformActive, requireRole, verifyToken } from '../middleware/auth.js'
import { getDatabase } from '../db.js'
import * as platformService from '../services/platform.service.js'
import { sanitizeInput, validatePagination, validateSchema } from '../utils/validation.js'
import { getAdminListings, getPublicListingFilter, setListingBan } from '../services/listing.service.js'
import {
  applyVerifiedRefund,
  getAdminFinancialOverview,
  getMonthlyCommission,
  settleTeacherWithdrawal,
} from '../services/finance.service.js'
import {
  finalizeMonthlyAdminSettlement,
  runAllScheduledFinancialJobs,
} from '../services/settlementScheduler.service.js'
import { excludeLegacySampleUsers } from '../utils/sampleData.js'
import { writeAuditLog } from '../services/audit.service.js'
import { getAdminAttendanceOverview, exportAdminAttendanceCSV } from '../services/adminAttendance.service.js'

export const platformRouter = Router()

platformRouter.get('/teachers/leaderboard', async (_req, res, next) => {
  try {
    const database = getDatabase()
    const listings = await database.collection('listings').find(
      getPublicListingFilter(),
      { projection: { _id: 1, teacherUid: 1, teacherName: 1, name: 1, category: 1 } },
    ).toArray()
    const listingIds = listings.map((listing) => listing._id)
    if (!listingIds.length) return res.json({ teachers: [], rankingBasis: 'Active student enrollments, recorded attendance, then published course count.' })

    const [enrollmentCounts, attendanceCounts] = await Promise.all([
      database.collection('studentEnrollments').aggregate([
        { $match: { listingId: { $in: listingIds }, status: 'active' } },
        { $group: { _id: '$listingId', count: { $sum: 1 } } },
      ]).toArray(),
      database.collection('sessionAttendance').aggregate([
        { $match: { listingId: { $in: listingIds }, status: { $in: ['present', 'absent'] } } },
        { $group: { _id: { listingId: '$listingId', status: '$status' }, count: { $sum: 1 } } },
      ]).toArray(),
    ])
    const enrollmentsByListing = new Map(enrollmentCounts.map((record) => [String(record._id), record.count]))
    const attendanceByListing = new Map()
    for (const record of attendanceCounts) {
      const listingId = String(record._id.listingId)
      const counts = attendanceByListing.get(listingId) || { present: 0, total: 0 }
      counts.total += record.count
      if (record._id.status === 'present') counts.present += record.count
      attendanceByListing.set(listingId, counts)
    }

    const teachersByUid = new Map()
    for (const listing of listings) {
      if (!listing.teacherUid) continue
      const teacher = teachersByUid.get(listing.teacherUid) || {
        teacherUid: listing.teacherUid,
        name: listing.teacherName || 'TeachOS teacher',
        publishedCourses: [],
        enrolledStudents: 0,
        attendance: { present: 0, total: 0 },
      }
      const listingId = String(listing._id)
      const courseAttendance = attendanceByListing.get(listingId)
      teacher.publishedCourses.push({ name: listing.name, category: listing.category, students: enrollmentsByListing.get(listingId) || 0 })
      teacher.enrolledStudents += enrollmentsByListing.get(listingId) || 0
      if (courseAttendance) {
        teacher.attendance.present += courseAttendance.present
        teacher.attendance.total += courseAttendance.total
      }
      teachersByUid.set(listing.teacherUid, teacher)
    }

    const teachers = [...teachersByUid.values()]
      .map((teacher) => ({
        name: teacher.name,
        courseCount: teacher.publishedCourses.length,
        enrolledStudents: teacher.enrolledStudents,
        topCourse: [...teacher.publishedCourses].sort((a, b) => b.students - a.students)[0]?.name || '—',
        attendancePercentage: teacher.attendance.total
          ? Math.round((teacher.attendance.present / teacher.attendance.total) * 100)
          : null,
        rating: null,
      }))
      .sort((a, b) => b.enrolledStudents - a.enrolledStudents ||
        (b.attendancePercentage ?? -1) - (a.attendancePercentage ?? -1) ||
        b.courseCount - a.courseCount ||
        a.name.localeCompare(b.name))
      .slice(0, 10)
      .map((teacher, index) => ({ rank: index + 1, ...teacher }))

    res.json({
      teachers,
      rankingBasis: 'Active student enrollments, recorded attendance, then published course count. Ratings are not yet collected.',
    })
  } catch (error) {
    next(error)
  }
})

// Platform routes require token verification
platformRouter.use(['/platforms', '/admin/billing'], verifyToken)

platformRouter.get('/admin/overview', verifyToken, requireRole('admin'), async (_req, res, next) => {
  try {
    const database = getDatabase()
    const [teachers, students, listings, classes, adminOverview, latestListings] = await Promise.all([
      database.collection('users').countDocuments(excludeLegacySampleUsers({ role: 'teacher', status: { $ne: 'removed' } })),
      database.collection('users').countDocuments(excludeLegacySampleUsers({ role: 'student', status: { $ne: 'removed' } })),
      database.collection('listings').countDocuments(getPublicListingFilter()),
      database.collection('classes').countDocuments({ classType: 'live', isSample: { $ne: true } }),
      getAdminFinancialOverview(database),
      database.collection('listings').find(
        getPublicListingFilter(),
        { projection: { teacherUid: 0, platformId: 0, removedAt: 0, removedBy: 0 } },
      ).sort({ createdAt: -1 }).limit(6).toArray(),
    ])

    res.json({
      overview: {
        teachers,
        students,
        listings,
        classes,
        monthlyCommission: {
          month: adminOverview.summary.month,
          grossAmount: adminOverview.summary.monthlyGross,
          commissionAmount: adminOverview.summary.recordedEarnings,
          teacherNetAmount: adminOverview.summary.teacherNet,
          refundedAmount: adminOverview.summary.monthlyRefunds,
          paymentCount: adminOverview.summary.successfulTransactions,
          teachers: adminOverview.summary.teacherBreakdown,
        },
        financialSummary: adminOverview.summary,
        recordedEarnings: adminOverview.summary.recordedEarnings,
        payoutRequests: adminOverview.summary.requestedPayouts || 0,
        pendingPayouts: adminOverview.summary.pendingPayouts || 0,
        totalGrossCourseRevenue: adminOverview.summary.totalGrossCourseRevenue,
        totalPlatformCommission: adminOverview.summary.totalPlatformCommission,
        currentMonthAccumulatedCommission: adminOverview.summary.currentMonthAccumulatedCommission,
        finalizedMonthlyCommission: adminOverview.summary.finalizedMonthlyCommission,
        teacherPendingEarnings: adminOverview.summary.teacherPendingEarnings,
        teacherAvailableEarnings: adminOverview.summary.teacherAvailableEarnings,
        latestListings,
      },
    })
  } catch (error) {
    next(error)
  }
})

platformRouter.get('/admin/listings', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const allowedQuery = new Set(['page', 'limit', 'search', 'category'])
    if (Object.keys(req.query).some((key) => !allowedQuery.has(key)) ||
        (req.query.search !== undefined && (typeof req.query.search !== 'string' || req.query.search.length > 150)) ||
        (req.query.category !== undefined && (typeof req.query.category !== 'string' || req.query.category.length > 80))) {
      const error = new Error('Invalid course listing filters.')
      error.status = 400
      error.code = 'INVALID_LISTING_FILTER'
      throw error
    }
    const pagination = validatePagination(req.query)
    const result = await getAdminListings({
      ...pagination,
      search: req.query.search || '',
      category: req.query.category || '',
    })
    res.json(result)
  } catch (error) {
    next(error)
  }
})

platformRouter.patch('/admin/listings/:id/moderation', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['banned', 'reason'])
    validateSchema(body, {
      banned: { required: true, type: 'boolean' },
      reason: { required: false, type: 'string', max: 500 },
    })
    const listing = await setListingBan(req.params.id, {
      banned: body.banned,
      reason: body.reason || '',
      actorUid: req.authUid,
    })
    res.json({
      listing,
      message: body.banned
        ? 'Course manually banned. It is hidden from public course pages; payment status is unchanged.'
        : 'Course unbanned. Its previous publication status is restored; payment status is unchanged.',
    })
  } catch (error) {
    next(error)
  }
})

platformRouter.get('/admin/payments', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const allowed = new Set(['month', 'teacher', 'course', 'paymentType', 'paymentMethod'])
    for (const key of Object.keys(req.query || {})) {
      if (!allowed.has(key)) {
        return res.status(400).json({ message: `Unknown filter: ${key}`, code: 'INVALID_PAYMENT_FILTER' })
      }
    }
    const database = getDatabase()
    const { month, teacher, course, paymentType, paymentMethod } = req.query
    const result = await getAdminFinancialOverview(database, month, { teacher, course, paymentType, paymentMethod })

    // Resolve user names for any unpopulated UIDs
    const userUids = [...new Set([
      ...result.payments.map((record) => record.teacherUid),
      ...result.payouts.map((record) => record.uid || record.teacherUid),
    ].filter(Boolean))]

    if (userUids.length) {
      const users = await database.collection('users').find(
        { uid: { $in: userUids } },
        { projection: { uid: 1, fullName: 1, displayName: 1, email: 1 } },
      ).toArray()
      const usersByUid = new Map(users.map((user) => [user.uid, user.fullName || user.displayName || user.email || 'TeachOS user']))

      for (const p of result.payments) {
        if (p.teacherUid && usersByUid.has(p.teacherUid)) {
          p.person = usersByUid.get(p.teacherUid)
        }
      }
      for (const p of result.payouts) {
        const uid = p.uid || p.teacherUid
        if (uid && usersByUid.has(uid)) {
          p.person = usersByUid.get(uid)
        }
      }
    }

    res.json(result)
  } catch (error) {
    next(error)
  }
})

platformRouter.post('/admin/payments/:paymentId/refunds', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body || {}
    const allowedFields = new Set(['amount', 'externalReference'])
    if (Object.keys(body).some((field) => !allowedFields.has(field)) ||
        !Number.isFinite(body.amount) || body.amount <= 0 || body.amount > 10000000 ||
        typeof body.externalReference !== 'string' ||
        !/^[A-Za-z0-9._:/-]{1,120}$/.test(body.externalReference.trim()) ||
        typeof req.params.paymentId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(req.params.paymentId)) {
      return res.status(400).json({ message: 'Provide a valid refund amount and external bKash refund reference.', code: 'INVALID_REFUND_RECORD' })
    }

    const database = getDatabase()
    const payment = await database.collection('studentPayments').findOne({
      paymentId: req.params.paymentId,
      gateway: 'bkash',
      mode: 'live',
      currency: 'BDT',
      status: { $in: ['paid', 'refunded'] },
    })
    if (!payment || !payment.isVerified || !payment.providerTransactionId) {
      return res.status(404).json({ message: 'Verified live bKash payment was not found.', code: 'PAYMENT_NOT_FOUND' })
    }

    const externalReference = body.externalReference.trim()
    const refundEventId = `admin-refund:${externalReference}`
    if (payment.refundEventIds?.includes(refundEventId)) {
      return res.status(409).json({ message: 'This external refund reference has already been recorded.', code: 'REFUND_ALREADY_RECORDED' })
    }
    const currentRefund = Number(payment.refundedAmount) || 0
    const nextRefund = Math.round((currentRefund + body.amount) * 100) / 100
    if (nextRefund > Math.round(Number(payment.amount) * 100) / 100) {
      return res.status(400).json({ message: 'The refund exceeds the remaining amount paid.', code: 'REFUND_EXCEEDS_PAYMENT' })
    }

    const applied = await applyVerifiedRefund(
      database,
      payment.providerTransactionId,
      nextRefund,
      refundEventId,
      'bkash',
    )
    if (!applied) {
      return res.status(409).json({ message: 'This refund was already recorded or the payment changed. Refresh and retry if needed.', code: 'REFUND_ALREADY_RECORDED' })
    }
    const updated = await database.collection('studentPayments').findOne({ _id: payment._id })
    if (updated.status === 'refunded' && updated.recurringTuition && updated.billingExpiresAt) {
      await database.collection('studentEnrollments').updateOne(
        {
          studentUid: updated.studentUid,
          listingId: updated.listingId,
          billingExpiresAt: { $lte: updated.billingExpiresAt },
        },
        {
          $set: {
            billingExpiresAt: new Date(),
            autoRenew: false,
            renewalCancelledAt: new Date(),
            updatedAt: new Date(),
          },
        },
      )
    }
    await database.collection('bkashPayments').updateOne(
      { paymentID: payment.paymentId },
      {
        $set: {
          refundStatus: updated.status === 'refunded' ? 'refunded' : 'partially_refunded',
          refundRecordedAt: new Date(),
          updatedAt: new Date(),
        },
        $addToSet: { externalRefundReferences: externalReference },
      },
    )
    await writeAuditLog({
      actorUid: req.authUid,
      actorRole: req.user.role,
      action: 'course_payment_external_refund_recorded',
      targetType: 'student_payment',
      targetId: payment.paymentId,
      meta: {
        paymentMethod: 'bkash',
        transactionId: payment.providerTransactionId,
        refundAmount: body.amount,
        cumulativeRefundAmount: nextRefund,
        externalReference,
      },
    })
    res.json({
      paymentId: payment.paymentId,
      refundedAmount: updated.refundedAmount,
      platformCommissionReversed: updated.commissionReversedAmount,
      teacherRevenueReversed: updated.teacherRevenueReversedAmount,
      status: updated.status,
    })
  } catch (error) {
    next(error)
  }
})

platformRouter.patch('/admin/payments/payout-requests/:id/settlement', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body || {}
    const allowedFields = new Set(['status', 'externalReference', 'reviewNote'])
    if (Object.keys(body).some((field) => !allowedFields.has(field)) ||
        !['paid', 'rejected'].includes(body.status) ||
        (body.externalReference !== undefined && (typeof body.externalReference !== 'string' || body.externalReference.trim().length > 120)) ||
        (body.reviewNote !== undefined && (typeof body.reviewNote !== 'string' || body.reviewNote.trim().length > 500))) {
      return res.status(400).json({ message: 'Provide a valid payout review status and optional settlement details.', code: 'INVALID_PAYOUT_REVIEW' })
    }
    const externalReference = body.externalReference?.trim() || ''
    const reviewNote = body.reviewNote?.trim() || ''
    if (body.status === 'paid' && !externalReference) {
      return res.status(400).json({ message: 'An external settlement reference is required to record a payout as paid.', code: 'SETTLEMENT_REFERENCE_REQUIRED' })
    }

    const database = getDatabase()
    const result = await settleTeacherWithdrawal(database, {
      withdrawalId: req.params.id,
      status: body.status,
      externalReference,
      reviewNote,
      reviewedBy: req.authUid,
    })

    await writeAuditLog({
      actorUid: req.authUid,
      actorRole: req.user.role,
      action: body.status === 'paid' ? 'admin.payout_externally_settled' : 'admin.payout_rejected',
      targetType: 'payout_request',
      targetId: req.params.id,
      meta: {
        amount: result.amount,
        currency: result.currency || 'BDT',
        status: result.status,
        ...(externalReference ? { externalReference } : {}),
        ...(reviewNote ? { reviewNote } : {}),
      },
    })
    res.json({ payoutRequest: result, transferInitiated: false })
  } catch (error) {
    next(error)
  }
})

platformRouter.post('/admin/settlements/:month/finalize', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { month } = req.params
    const database = getDatabase()
    const result = await finalizeMonthlyAdminSettlement(database, month, req.authUid)
    res.json(result)
  } catch (error) {
    next(error)
  }
})

platformRouter.post('/admin/settlements/run-jobs', verifyToken, requireRole('admin'), async (_req, res, next) => {
  try {
    const database = getDatabase()
    const result = await runAllScheduledFinancialJobs(database)
    res.json({ success: true, result })
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

platformRouter.get('/admin/attendance', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { listingId, teacherUid, status, studentSearch, startDate, endDate, page, limit } = req.query
    const result = await getAdminAttendanceOverview({
      listingId,
      teacherUid,
      status,
      studentSearch,
      startDate,
      endDate,
      page,
      limit,
    })
    res.json(result)
  } catch (error) {
    next(error)
  }
})

platformRouter.get('/admin/attendance/export', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { listingId, teacherUid, status, studentSearch, startDate, endDate } = req.query
    const csv = await exportAdminAttendanceCSV({
      listingId,
      teacherUid,
      status,
      studentSearch,
      startDate,
      endDate,
    })
    res.setHeader('Content-Type', 'text/csv;charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="teachos-admin-attendance.csv"')
    res.send(csv)
  } catch (error) {
    next(error)
  }
})
