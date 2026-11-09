/**
 * Payment Routes — Stripe one-time checkout only.
 *
 * Every monthly course payment (initial enrollment or monthly renewal) uses an
 * individual Stripe Checkout session in `mode: 'payment'`.  No automatic
 * recurring subscriptions are created.
 *
 * Endpoints:
 *   POST /api/student/payments/checkout            — initial enrollment payment
 *   POST /api/student/payments/monthly-checkout    — manual monthly renewal
 *   GET  /api/student/payments/checkout/confirm    — verify session after redirect
 *   GET  /api/student/subscriptions                — (kept in student.routes.js)
 *   POST /api/student/courses/:id/cancel           — cancel future renewals
 *   GET  /api/student/payments                     — (kept in student.routes.js)
 *   GET  /api/teacher/payments                     — teacher earnings
 *   PUT  /api/teacher/payments/payout-settings     — payout config
 *   POST /api/teacher/payments/payout-requests     — request payout
 *   POST /api/stripe/webhook                       — Stripe webhook handler
 *   GET  /api/admin/students/:uid/payments/debug   — admin diagnostic
 *   POST /api/admin/students/:uid/payments/repair-enrollment — admin repair
 */

import { randomUUID } from 'node:crypto'
import express, { Router } from 'express'
import { ObjectId } from 'mongodb'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'
import { createNotifications, notifyAdmins } from '../services/notification.service.js'
import {
  assertStripeConfigured,
  constructStripeWebhookEvent,
  createStripeCheckoutSession,
  getStripeMode,
  retrieveStripeCheckoutSession,
} from '../services/stripe.service.js'
import { confirmTeacherSubscriptionPayment } from '../services/teacherSubscription.service.js'
import { computeListingPricing, getPublicListingFilter } from '../services/listing.service.js'
import {
  applyVerifiedRefund,
  getTeacherFinancialSummary,
  getTeacherPaymentSummary,
  recordVerifiedCoursePayment,
  requestTeacherWithdrawal,
  platformShare,
} from '../services/finance.service.js'
import {
  createBkashPayment,
  executeBkashPayment,
  queryBkashPayment,
} from '../services/bkash.service.js'
import { writeAuditLog } from '../services/audit.service.js'
import { parseObjectId } from '../utils/validation.js'

export const paymentRouter = Router()
export const stripeWebhookRouter = Router()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clientOriginFor(request) {
  const configured = (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',').map((o) => o.trim()).filter(Boolean)
  const origin = request.get('Origin')
  if (origin && configured.includes(origin)) return origin
  if (process.env.NODE_ENV !== 'production' && origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return origin
  return configured[0] || 'http://localhost:5173'
}

function currentBillingPeriod() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date())
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`
}

function addOneMonth(date) {
  const d = new Date(date)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + 1)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return d
}

/**
 * Upsert a studentEnrollments record, extending billingExpiresAt by one month
 * from the later of (now, current expiry) for monthly payments, or null for ONE_TIME lifetime access.
 */
async function activateEnrollment(database, payment, amount, opts = {}) {
  const listingId = payment.listingId instanceof ObjectId
    ? payment.listingId
    : new ObjectId(payment.listingId)
  const now = new Date()

  const isOneTime = payment.paymentType === 'ONE_TIME' || opts.isOneTime
  let billingExpiresAt = null
  let nextPaymentDue = null

  if (!isOneTime) {
    if (opts.billingExpiresAt) {
      billingExpiresAt = opts.billingExpiresAt
    } else {
      const existing = await database.collection('studentEnrollments').findOne(
        { studentUid: payment.studentUid, listingId },
        { projection: { billingExpiresAt: 1 } },
      )
      const base = existing?.billingExpiresAt && new Date(existing.billingExpiresAt) > now
        ? new Date(existing.billingExpiresAt)
        : now
      billingExpiresAt = addOneMonth(base)
    }
    nextPaymentDue = billingExpiresAt
  }

  await database.collection('studentEnrollments').updateOne(
    { studentUid: payment.studentUid, listingId },
    {
      $set: {
        studentUid: payment.studentUid,
        studentName: payment.studentName,
        studentEmail: payment.studentEmail,
        listingId,
        name: payment.courseName,
        category: payment.category,
        courseId: payment.courseId,
        teacherUid: payment.teacherUid,
        teacherName: payment.teacherName,
        fee: Number(payment.monthlyTuitionFee) || amount,
        admissionFee: payment.admissionFee,
        monthlyTuitionFee: payment.monthlyTuitionFee,
        initialPaymentTotal: Number(payment.initialPaymentTotal) || amount,
        paymentType: isOneTime ? 'ONE_TIME' : 'MONTHLY_SUBSCRIPTION',
        image: payment.image || '',
        days: payment.days || [],
        startTime: payment.startTime || '',
        endTime: payment.endTime || '',
        duration: payment.duration || '',
        location: payment.location || '',
        status: 'active',
        paymentStatus: payment.mode === 'live' ? 'paid' : 'test_paid',
        paymentId: payment.paymentId,
        billingGateway: payment.gateway || 'stripe',
        billingExpiresAt,
        nextPaymentDue,
        admissionPaid: true,
        tuitionPaid: true,
        updatedAt: now,
      },
      $setOnInsert: { enrolledAt: now, createdAt: now },
    },
    { upsert: true },
  )
}

/**
 * Verify a completed Stripe Checkout session and record the payment.
 * Works for both initial enrollment and monthly renewal sessions.
 * Returns true when successfully processed (idempotent on duplicate webhook).
 */
export async function confirmPaidSession(database, session) {
  // Teacher platform-fee payment — delegate to its own handler
  if (session.metadata?.kind === 'teacher_subscription') {
    return confirmTeacherSubscriptionPayment(database, session, session.metadata.teacherUid)
  }

  if (session.mode !== 'payment' ||
      session.payment_status !== 'paid' ||
      session.currency !== 'bdt' ||
      !session.metadata?.orderId ||
      session.client_reference_id !== session.metadata.orderId) {
    return false
  }

  const mode = session.livemode ? 'live' : 'test'
  const payments = database.collection('studentPayments')
  const payment = await payments.findOne({
    paymentId: session.metadata.orderId,
    gateway: 'stripe',
    mode,
    providerPaymentId: session.id,
  })
  if (!payment) return false

  const amount = Number(session.amount_total) / 100
  if (!Number.isFinite(amount) || Math.round(amount * 100) !== Math.round(Number(payment.amount) * 100)) {
    await payments.updateOne(
      { _id: payment._id, status: 'pending' },
      { $set: { status: 'verification_failed', updatedAt: new Date() } },
    )
    await writeAuditLog({
      actorUid: 'stripe-webhook', actorRole: 'system',
      action: 'course_payment_verification_failed',
      targetType: 'student_payment', targetId: payment.paymentId,
      meta: { paymentMethod: 'stripe', expectedAmount: payment.amount, verifiedAmount: amount, currency: 'BDT' },
    })
    return false
  }

  // Idempotent — already processed
  if (payment.status === 'paid') {
    await activateEnrollment(database, payment, amount)
    return true
  }
  if (payment.status !== 'pending') return false

  const paidAt = Number.isFinite(session.created) ? new Date(session.created * 1000) : new Date()
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent : session.payment_intent?.id
  const transactionId = paymentIntentId || session.id

  const recordedPayment = await recordVerifiedCoursePayment(database, {
    payment, verifiedAmount: amount, transactionId, paymentMethod: 'stripe', paidAt, paymentType: payment.paymentType,
  })

  const billingPeriod = payment.billingPeriod || currentBillingPeriod()
  await payments.updateOne(
    { _id: payment._id, status: 'paid' },
    { $set: { billingPeriod, updatedAt: new Date() } },
  )

  await activateEnrollment(database, payment, amount)

  if (!recordedPayment.recorded) return true

  const listingId = payment.listingId instanceof ObjectId ? payment.listingId : new ObjectId(payment.listingId)
  await writeAuditLog({
    actorUid: 'stripe-webhook', actorRole: 'system',
    action: payment.paymentType === 'monthly' ? 'course_monthly_tuition_paid' : 'course_payment_verified',
    targetType: 'student_payment', targetId: payment.paymentId,
    meta: {
      paymentMethod: 'stripe', transactionId, verifiedAmount: amount, currency: 'BDT', mode,
      paymentType: payment.paymentType,
      platformCommissionAmount: mode === 'live'
        ? (await payments.findOne({ _id: payment._id }))?.platformCommissionAmount || 0 : 0,
    },
  })

  const isMonthly = payment.paymentType === 'monthly'
  const notification = {
    type: 'enrollment',
    title: isMonthly ? `Monthly tuition received` : `New Stripe ${mode} payment`,
    message: mode === 'test'
      ? `${payment.studentName} completed a Stripe test payment for ${payment.courseName}.`
      : isMonthly
        ? `${payment.studentName} paid monthly tuition for ${payment.courseName}.`
        : `${payment.studentName} enrolled in ${payment.courseName}.`,
    relatedId: String(listingId),
  }
  await Promise.all([
    createNotifications(database, [{ uid: payment.teacherUid, role: 'teacher' }],
      { ...notification, href: '/dashboard/payments' }),
    notifyAdmins(database, { ...notification, href: '/admin/payments' }),
  ])
  return true
}

// ─── Initial enrollment checkout ──────────────────────────────────────────────

paymentRouter.post('/student/payments/checkout', verifyToken, requireRole('student'), async (req, res, next) => {
  let orderId
  try {
    if (Object.keys(req.body || {}).some((k) => k !== 'listingId')) {
      return res.status(400).json({ message: 'Only listingId is accepted.', code: 'INVALID_CHECKOUT_REQUEST' })
    }
    assertStripeConfigured()
    const listingId = parseObjectId(req.body?.listingId, 'listingId')
    const database = getDatabase()

    const listing = await database.collection('listings').findOne({
      _id: listingId, ...getPublicListingFilter(),
    })
    if (!listing) return res.status(404).json({ message: 'This course is no longer available.', code: 'LISTING_NOT_FOUND' })

    const pricing = computeListingPricing(listing)
    const isOneTime = pricing.isOneTime || listing.pricingType === 'ONE_TIME'
    const paymentType = isOneTime ? 'ONE_TIME' : 'MONTHLY_SUBSCRIPTION'
    const amount = pricing.initialPaymentTotal
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'This course does not have a valid paid fee.', code: 'INVALID_COURSE_FEE' })
    }
    if (!Number.isSafeInteger(Math.round(amount * 100)) || Math.round(amount * 100) < 1) {
      return res.status(400).json({ message: "This course fee is outside Stripe's supported BDT amount range.", code: 'INVALID_STRIPE_AMOUNT' })
    }

    const payments = database.collection('studentPayments')

    // Guard 1: confirmed initial payment already exists
    const alreadyPaid = await payments.findOne({
      studentUid: req.authUid, listingId,
      gateway: 'stripe',
      mode: { $in: ['test', 'live'] },
      status: 'paid',
    })
    if (alreadyPaid) {
      console.log('[checkout] BLOCKED by Guard 1 (ALREADY_PAID) paymentId:', alreadyPaid.paymentId)
      return res.status(409).json({
        message: isOneTime
          ? 'You have already paid for lifetime access to this course.'
          : 'This course already has a paid enrollment. Manage its monthly tuition from your courses.',
        code: 'ALREADY_PAID',
      })
    }

    // Guard 2: enrollment already active (e.g. recovered from a prior session)
    const activeEnrollment = await database.collection('studentEnrollments').findOne({
      studentUid: req.authUid, listingId, status: 'active',
    })
    if (activeEnrollment) {
      return res.status(409).json({
        message: 'You are already enrolled in this course. Visit My Classes to continue learning.',
        code: 'ALREADY_ENROLLED',
      })
    }

    // Guard 3: expire stale pending records older than 31 min so the student can retry
    await payments.updateMany(
      {
        studentUid: req.authUid, listingId,
        gateway: 'stripe', mode: getStripeMode(),
        paymentType: 'initial', status: 'pending',
        createdAt: { $lt: new Date(Date.now() - 31 * 60 * 1000) },
      },
      { $set: { status: 'expired', updatedAt: new Date() } },
    )

    // Guard 4: re-use a valid open session created in the last 31 min
    const recentCheckout = await payments.findOne({
      studentUid: req.authUid, listingId,
      gateway: 'stripe', mode: getStripeMode(),
      paymentType: 'initial', status: 'pending',
      createdAt: { $gte: new Date(Date.now() - 31 * 60 * 1000) },
    }, { sort: { createdAt: -1 } })

    if (recentCheckout?.providerPaymentId) {
      const existing = await retrieveStripeCheckoutSession(recentCheckout.providerPaymentId)
      const expectedPrefix = getStripeMode() === 'test' ? 'cs_test_' : 'cs_live_'
      const existingUrl = existing.url ? new URL(existing.url) : null
      if (existing.status === 'open' &&
          existingUrl?.protocol === 'https:' &&
          existingUrl.hostname === 'checkout.stripe.com' &&
          existing.id?.startsWith(expectedPrefix)) {
        return res.json({ redirectUrl: existingUrl.toString() })
      }
      if (existing.status === 'complete') {
        await payments.updateOne(
          { _id: recentCheckout._id, status: 'pending' },
          { $set: { status: 'processing', updatedAt: new Date() } },
        )
        return res.status(409).json({
          message: 'This checkout was already submitted. Check your courses while payment confirmation finishes.',
          code: 'PAYMENT_PROCESSING',
        })
      }
      // expired / cancelled — mark and fall through to create a new session
      await payments.updateOne(
        { _id: recentCheckout._id, status: 'pending' },
        { $set: { status: 'expired', updatedAt: new Date() } },
      )
    } else if (recentCheckout) {
      // Pending record with no session ID yet — expire it and retry
      await payments.updateOne(
        { _id: recentCheckout._id, status: 'pending' },
        { $set: { status: 'expired', updatedAt: new Date() } },
      )
    }

    const now = new Date()
    orderId = randomUUID()
    const billingPeriod = currentBillingPeriod()
    const payment = {
      paymentId: orderId,
      studentUid: req.authUid,
      studentName: req.user.fullName || req.user.email,
      studentEmail: req.user.email,
      listingId,
      courseId: listing.courseId || null,
      courseName: listing.name,
      category: listing.category,
      teacherUid: listing.teacherUid,
      teacherName: listing.teacherName,
      admissionFee: pricing.admissionFee,
      monthlyTuitionFee: pricing.monthlyTuitionFee,
      initialPaymentTotal: amount,
      duration: listing.duration || '',
      location: listing.location || '',
      image: listing.image || '',
      days: listing.days || [],
      startTime: listing.startTime || '',
      endTime: listing.endTime || '',
      amount,
      currency: 'BDT',
      gateway: 'stripe',
      mode: getStripeMode(),
      status: 'pending',
      paymentType,
      billingPeriod,
      createdAt: now,
      updatedAt: now,
    }
    await payments.insertOne(payment)
    await writeAuditLog({
      actorUid: req.authUid, actorRole: req.user.role,
      action: 'course_payment_checkout_created',
      targetType: 'student_payment', targetId: orderId,
      meta: { paymentMethod: 'stripe', courseId: String(listingId), amount, currency: 'BDT', mode: payment.mode, paymentType },
    })

    try {
      const origin = clientOriginFor(req)
      const checkout = await createStripeCheckoutSession({
        amount,
        orderId,
        productName: `${listing.name} — ${isOneTime ? 'lifetime access' : `enrollment (${billingPeriod})`}`,
        customerEmail: req.user.email,
        clientOrigin: origin,
        successUrl: `${origin}/student/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/student/payment/cancel`,
        metadata: {
          kind: 'student_course',
          studentUid: req.authUid,
          listingId: String(listingId),
          teacherUid: listing.teacherUid || '',
          paymentType,
        },
      })
      const checkoutUrl = new URL(checkout.url)
      const expectedPrefix = getStripeMode() === 'test' ? 'cs_test_' : 'cs_live_'
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com' || !checkout.id?.startsWith(expectedPrefix)) {
        throw new Error('Stripe returned an invalid checkout session.')
      }
      await payments.updateOne(
        { paymentId: orderId, status: 'pending' },
        { $set: { providerPaymentId: checkout.id, updatedAt: new Date() } },
      )
      return res.status(201).json({ redirectUrl: checkoutUrl.toString() })
    } catch (error) {
      await payments.updateOne(
        { paymentId: orderId, status: 'pending' },
        { $set: { status: 'failed_to_initialize', updatedAt: new Date() } },
      )
      throw error
    }
  } catch (error) {
    next(error)
  }
})

// ─── Manual monthly renewal checkout ──────────────────────────────────────────

paymentRouter.post('/student/payments/monthly-checkout', verifyToken, requireRole('student'), async (req, res, next) => {
  let orderId
  try {
    if (Object.keys(req.body || {}).some((k) => k !== 'listingId')) {
      return res.status(400).json({ message: 'Only listingId is accepted.', code: 'INVALID_CHECKOUT_REQUEST' })
    }
    assertStripeConfigured()
    const listingId = parseObjectId(req.body?.listingId, 'listingId')
    const database = getDatabase()

    // Must have an active enrollment from initial payment
    const enrollment = await database.collection('studentEnrollments').findOne({
      studentUid: req.authUid, listingId, status: 'active',
    })
    if (!enrollment) {
      return res.status(403).json({
        message: 'Complete the initial course payment before paying monthly tuition.',
        code: 'INITIAL_PAYMENT_REQUIRED',
      })
    }

    const listing = await database.collection('listings').findOne({
      _id: listingId, ...getPublicListingFilter(),
    })
    if (!listing) return res.status(404).json({ message: 'This course is no longer available.', code: 'LISTING_NOT_FOUND' })

    const pricing = computeListingPricing(listing)
    if (pricing.isOneTime || listing.pricingType === 'ONE_TIME') {
      return res.status(400).json({ message: 'This course is a one-time lifetime payment course; monthly renewal is not required.', code: 'ONE_TIME_COURSE' })
    }
    const amount = pricing.monthlyTuitionFee
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'This course has no monthly tuition fee.', code: 'NO_TUITION_FEE' })
    }

    const billingPeriod = currentBillingPeriod()
    const payments = database.collection('studentPayments')

    // Guard: already paid this month
    const monthPaid = await payments.findOne({
      studentUid: req.authUid, listingId,
      paymentType: 'monthly',
      billingPeriod,
      gateway: 'stripe',
      mode: { $in: ['test', 'live'] },
      status: 'paid',
    })
    if (monthPaid) {
      return res.status(409).json({
        message: 'Monthly tuition for this billing period has already been paid.',
        code: 'TUITION_ALREADY_PAID',
      })
    }

    // Guard: expire stale pending monthly sessions
    await payments.updateMany(
      {
        studentUid: req.authUid, listingId,
        paymentType: 'monthly', billingPeriod,
        gateway: 'stripe', mode: getStripeMode(),
        status: 'pending',
        createdAt: { $lt: new Date(Date.now() - 31 * 60 * 1000) },
      },
      { $set: { status: 'expired', updatedAt: new Date() } },
    )

    // Guard: re-use a valid open session for this month
    const recentCheckout = await payments.findOne({
      studentUid: req.authUid, listingId,
      paymentType: 'monthly', billingPeriod,
      gateway: 'stripe', mode: getStripeMode(),
      status: 'pending',
      createdAt: { $gte: new Date(Date.now() - 31 * 60 * 1000) },
    }, { sort: { createdAt: -1 } })

    if (recentCheckout?.providerPaymentId) {
      const existing = await retrieveStripeCheckoutSession(recentCheckout.providerPaymentId)
      const expectedPrefix = getStripeMode() === 'test' ? 'cs_test_' : 'cs_live_'
      const existingUrl = existing.url ? new URL(existing.url) : null
      if (existing.status === 'open' &&
          existingUrl?.protocol === 'https:' &&
          existingUrl.hostname === 'checkout.stripe.com' &&
          existing.id?.startsWith(expectedPrefix)) {
        return res.json({ redirectUrl: existingUrl.toString() })
      }
      if (existing.status === 'complete') {
        await payments.updateOne(
          { _id: recentCheckout._id, status: 'pending' },
          { $set: { status: 'processing', updatedAt: new Date() } },
        )
        return res.status(409).json({
          message: 'This checkout was already submitted. Check your courses while payment confirmation finishes.',
          code: 'PAYMENT_PROCESSING',
        })
      }
      await payments.updateOne(
        { _id: recentCheckout._id, status: 'pending' },
        { $set: { status: 'expired', updatedAt: new Date() } },
      )
    } else if (recentCheckout) {
      await payments.updateOne(
        { _id: recentCheckout._id, status: 'pending' },
        { $set: { status: 'expired', updatedAt: new Date() } },
      )
    }

    const now = new Date()
    orderId = randomUUID()
    const payment = {
      paymentId: orderId,
      studentUid: req.authUid,
      studentName: req.user.fullName || req.user.email,
      studentEmail: req.user.email,
      listingId,
      courseId: listing.courseId || null,
      courseName: listing.name,
      category: listing.category,
      teacherUid: listing.teacherUid,
      teacherName: listing.teacherName,
      admissionFee: 0,
      monthlyTuitionFee: pricing.monthlyTuitionFee,
      initialPaymentTotal: 0,
      duration: listing.duration || '',
      location: listing.location || '',
      image: listing.image || '',
      days: listing.days || [],
      startTime: listing.startTime || '',
      endTime: listing.endTime || '',
      amount,
      currency: 'BDT',
      gateway: 'stripe',
      mode: getStripeMode(),
      status: 'pending',
      paymentType: 'monthly',
      billingPeriod,
      createdAt: now,
      updatedAt: now,
    }
    await payments.insertOne(payment)
    await writeAuditLog({
      actorUid: req.authUid, actorRole: req.user.role,
      action: 'course_payment_checkout_created',
      targetType: 'student_payment', targetId: orderId,
      meta: { paymentMethod: 'stripe', courseId: String(listingId), amount, currency: 'BDT', mode: payment.mode, paymentType: 'monthly', billingPeriod },
    })

    try {
      const origin = clientOriginFor(req)
      const checkout = await createStripeCheckoutSession({
        amount,
        orderId,
        productName: `${listing.name} — monthly tuition (${billingPeriod})`,
        customerEmail: req.user.email,
        clientOrigin: origin,
        successUrl: `${origin}/student/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/student/payment/cancel`,
        metadata: {
          kind: 'student_course',
          studentUid: req.authUid,
          listingId: String(listingId),
          teacherUid: listing.teacherUid || '',
          paymentType: 'monthly',
          billingPeriod,
        },
      })
      const checkoutUrl = new URL(checkout.url)
      const expectedPrefix = getStripeMode() === 'test' ? 'cs_test_' : 'cs_live_'
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com' || !checkout.id?.startsWith(expectedPrefix)) {
        throw new Error('Stripe returned an invalid checkout session.')
      }
      await payments.updateOne(
        { paymentId: orderId, status: 'pending' },
        { $set: { providerPaymentId: checkout.id, updatedAt: new Date() } },
      )
      return res.status(201).json({ redirectUrl: checkoutUrl.toString() })
    } catch (error) {
      await payments.updateOne(
        { paymentId: orderId, status: 'pending' },
        { $set: { status: 'failed_to_initialize', updatedAt: new Date() } },
      )
      throw error
    }
  } catch (error) {
    next(error)
  }
})

// ─── Confirm session after Stripe redirect ────────────────────────────────────

paymentRouter.get('/student/payments/checkout/confirm', verifyToken, requireRole('student'), async (req, res, next) => {
  try {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : ''
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      return res.status(400).json({ message: 'Invalid Stripe checkout session.', code: 'INVALID_CHECKOUT_SESSION' })
    }
    const database = getDatabase()
    const payment = await database.collection('studentPayments').findOne({
      gateway: 'stripe',
      mode: sessionId.startsWith('cs_live_') ? 'live' : 'test',
      providerPaymentId: sessionId,
      studentUid: req.authUid,
    })
    if (!payment) return res.status(404).json({ message: 'Payment order was not found.', code: 'PAYMENT_ORDER_NOT_FOUND' })

    const session = await retrieveStripeCheckoutSession(sessionId)
    await confirmPaidSession(database, session)

    const current = await database.collection('studentPayments').findOne(
      { _id: payment._id }, { projection: { status: 1, paymentType: 1 } },
    )
    if (current?.status === 'paid') {
      return res.json({ status: 'paid', paymentType: current.paymentType })
    }
    if (session.payment_status === 'paid') {
      return res.json({ status: 'processing', paymentType: payment.paymentType })
    }
    res.json({ status: session.status, paymentType: payment.paymentType })
  } catch (error) {
    next(error)
  }
})

// ─── Cancel future renewals ───────────────────────────────────────────────────

paymentRouter.post('/student/courses/:listingId/cancel', verifyToken, requireRole('student'), async (req, res, next) => {
  try {
    const listingId = parseObjectId(req.params.listingId, 'listingId')
    const database = getDatabase()
    const enrollments = database.collection('studentEnrollments')

    const enrollment = await enrollments.findOne({ studentUid: req.authUid, listingId })
    if (!enrollment || !(Number(enrollment.monthlyTuitionFee) > 0)) {
      return res.status(404).json({ message: 'Monthly tuition enrollment was not found.', code: 'SUBSCRIPTION_NOT_FOUND' })
    }
    if (enrollment.renewalCancelledAt) {
      return res.json({ cancelled: true, billingExpiresAt: enrollment.billingExpiresAt || null })
    }

    const now = new Date()
    await enrollments.updateOne(
      { _id: enrollment._id, studentUid: req.authUid },
      { $set: { autoRenew: false, renewalCancelledAt: now, updatedAt: now } },
    )
    await writeAuditLog({
      actorUid: req.authUid, actorRole: 'student',
      action: 'course_monthly_tuition_cancelled',
      targetType: 'student_enrollment', targetId: String(listingId),
      meta: { billingExpiresAt: enrollment.billingExpiresAt || null },
    })
    return res.json({ cancelled: true, billingExpiresAt: enrollment.billingExpiresAt || null })
  } catch (error) {
    next(error)
  }
})

// ─── bKash Checkout & Verification ──────────────────────────────────────────

paymentRouter.post('/student/payments/bkash/create', verifyToken, requireRole('student'), async (req, res, next) => {
  let orderId
  try {
    if (Object.keys(req.body || {}).some((k) => k !== 'listingId')) {
      return res.status(400).json({ message: 'Only listingId is accepted.', code: 'INVALID_CHECKOUT_REQUEST' })
    }
    const listingId = parseObjectId(req.body?.listingId, 'listingId')
    const database = getDatabase()

    const listing = await database.collection('listings').findOne({
      _id: listingId, ...getPublicListingFilter(),
    })
    if (!listing) return res.status(404).json({ message: 'This course is no longer available.', code: 'LISTING_NOT_FOUND' })

    const pricing = computeListingPricing(listing)
    const isOneTime = pricing.isOneTime || listing.pricingType === 'ONE_TIME'
    const paymentType = isOneTime ? 'ONE_TIME' : 'MONTHLY_SUBSCRIPTION'
    const amount = pricing.initialPaymentTotal
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'This course does not have a valid paid fee.', code: 'INVALID_COURSE_FEE' })
    }

    const payments = database.collection('studentPayments')
    const alreadyPaid = await payments.findOne({
      studentUid: req.authUid, listingId,
      gateway: 'bkash',
      status: 'paid',
    })
    if (alreadyPaid) {
      return res.status(409).json({
        message: isOneTime
          ? 'You have already paid for lifetime access to this course.'
          : 'This course already has a paid enrollment.',
        code: 'ALREADY_PAID',
      })
    }

    orderId = randomUUID()
    const now = new Date()
    const billingPeriod = currentBillingPeriod()

    const payment = {
      paymentId: orderId,
      studentUid: req.authUid,
      studentName: req.user.fullName || req.user.email,
      studentEmail: req.user.email,
      listingId,
      courseId: listing.courseId || null,
      courseName: listing.name,
      category: listing.category,
      teacherUid: listing.teacherUid,
      teacherName: listing.teacherName,
      admissionFee: pricing.admissionFee,
      monthlyTuitionFee: pricing.monthlyTuitionFee,
      initialPaymentTotal: amount,
      duration: listing.duration || '',
      location: listing.location || '',
      image: listing.image || '',
      days: listing.days || [],
      startTime: listing.startTime || '',
      endTime: listing.endTime || '',
      amount,
      currency: 'BDT',
      gateway: 'bkash',
      mode: process.env.BKASH_MODE === 'live' ? 'live' : 'test',
      status: 'pending',
      paymentType,
      billingPeriod,
      createdAt: now,
      updatedAt: now,
    }

    await payments.insertOne(payment)

    const bkashRes = await createBkashPayment({
      amount,
      invoiceNumber: orderId,
      orderId,
    })

    await payments.updateOne(
      { paymentId: orderId },
      { $set: { providerPaymentId: bkashRes.paymentID, updatedAt: new Date() } },
    )

    await writeAuditLog({
      actorUid: req.authUid, actorRole: req.user.role,
      action: 'bkash_checkout_created',
      targetType: 'student_payment', targetId: orderId,
      meta: { paymentMethod: 'bkash', courseId: String(listingId), amount, paymentType },
    })

    res.status(201).json({
      paymentId: orderId,
      paymentID: bkashRes.paymentID,
      redirectUrl: bkashRes.bkashURL,
    })
  } catch (error) {
    next(error)
  }
})

paymentRouter.post('/student/payments/bkash/execute', verifyToken, requireRole('student'), async (req, res, next) => {
  try {
    const { paymentID } = req.body || {}
    if (!paymentID || typeof paymentID !== 'string') {
      return res.status(400).json({ message: 'paymentID is required.', code: 'INVALID_PARAM' })
    }

    const database = getDatabase()
    const payments = database.collection('studentPayments')
    const payment = await payments.findOne({
      gateway: 'bkash',
      providerPaymentId: paymentID,
      studentUid: req.authUid,
    })

    if (!payment) {
      return res.status(404).json({ message: 'bKash payment order not found.', code: 'PAYMENT_NOT_FOUND' })
    }

    if (payment.status === 'paid') {
      await activateEnrollment(database, payment, payment.amount)
      return res.json({ status: 'paid', paymentType: payment.paymentType })
    }

    // Backend verification with bKash
    const execResult = await executeBkashPayment(paymentID)
    if (execResult.statusCode !== '0000') {
      await payments.updateOne(
        { _id: payment._id },
        { $set: { status: 'failed', updatedAt: new Date() } },
      )
      return res.status(400).json({ message: execResult.statusMessage || 'bKash payment execution failed.', code: 'BKASH_EXECUTE_FAILED' })
    }

    const trxID = execResult.trxID || paymentID
    const paidAt = new Date()

    await recordVerifiedCoursePayment(database, {
      payment,
      verifiedAmount: payment.amount,
      transactionId: trxID,
      paymentMethod: 'bkash',
      paidAt,
      paymentType: payment.paymentType,
    })

    await activateEnrollment(database, payment, payment.amount)

    await writeAuditLog({
      actorUid: req.authUid, actorRole: req.user.role,
      action: 'bkash_payment_verified',
      targetType: 'student_payment', targetId: payment.paymentId,
      meta: { paymentMethod: 'bkash', trxID, amount: payment.amount, paymentType: payment.paymentType },
    })

    res.json({
      status: 'paid',
      trxID,
      paymentType: payment.paymentType,
    })
  } catch (error) {
    next(error)
  }
})

// ─── Teacher payment routes ───────────────────────────────────────────────────

paymentRouter.get('/teacher/payments', verifyToken, requireRole('teacher'), async (req, res, next) => {
  try {
    if (Object.keys(req.query || {}).some((k) => k !== 'month')) {
      return res.status(400).json({ message: 'Only the month filter is supported.', code: 'INVALID_PAYMENT_FILTER' })
    }
    const database = getDatabase()
    const summary = await getTeacherFinancialSummary(database, req.authUid, req.query.month)
    res.json(summary)
  } catch (error) {
    next(error)
  }
})

paymentRouter.put('/teacher/payments/payout-settings', verifyToken, requireRole('teacher'), async (req, res, next) => {
  try {
    const body = req.body || {}
    const allowed = new Set(['enabled', 'monthlyAmount', 'dayOfMonth'])
    if (Object.keys(body).some((f) => !allowed.has(f)) ||
        typeof body.enabled !== 'boolean' || !Number.isFinite(body.monthlyAmount) ||
        body.monthlyAmount < 0 || body.monthlyAmount > 10000000 ||
        !Number.isInteger(body.dayOfMonth) || body.dayOfMonth < 1 || body.dayOfMonth > 28 ||
        (body.enabled && body.monthlyAmount <= 0)) {
      return res.status(400).json({ message: 'Provide a valid monthly amount, schedule day (1–28), and enabled status.', code: 'INVALID_PAYOUT_SETTINGS' })
    }
    const database = getDatabase()
    const payoutSettings = { enabled: body.enabled, monthlyAmount: body.monthlyAmount, dayOfMonth: body.dayOfMonth, updatedAt: new Date() }
    const result = await database.collection('users').updateOne(
      { uid: req.authUid, role: 'teacher', status: { $ne: 'removed' } },
      { $set: { payoutSettings, updatedAt: new Date() } },
    )
    if (!result.matchedCount) return res.status(404).json({ message: 'Teacher account not found.', code: 'TEACHER_NOT_FOUND' })
    await writeAuditLog({
      actorUid: req.authUid, actorRole: req.user.role,
      action: 'teacher.payout_settings_updated',
      targetType: 'teacher', targetId: req.authUid,
      meta: { enabled: payoutSettings.enabled, monthlyAmount: payoutSettings.monthlyAmount, dayOfMonth: payoutSettings.dayOfMonth },
    })
    res.json({ payoutSettings })
  } catch (error) {
    next(error)
  }
})

paymentRouter.post('/teacher/payments/payout-requests', verifyToken, requireRole('teacher'), async (req, res, next) => {
  try {
    const body = req.body || {}
    const allowed = new Set(['amount', 'method', 'accountLast4'])
    if (Object.keys(body).some((f) => !allowed.has(f)) ||
        !Number.isFinite(body.amount) || body.amount <= 0 || body.amount > 10000000 ||
        typeof body.method !== 'string' || !['bank', 'mobile_wallet', 'bkash'].includes(body.method) ||
        (body.accountLast4 !== undefined && body.accountLast4 !== '' &&
          (typeof body.accountLast4 !== 'string' || body.accountLast4.trim().length > 50))) {
      return res.status(400).json({ message: 'Enter a valid payout amount, method, and account details.', code: 'INVALID_PAYOUT_REQUEST' })
    }
    const database = getDatabase()
    const payoutRequest = await requestTeacherWithdrawal(database, {
      teacherUid: req.authUid,
      amount: body.amount,
      method: body.method,
      accountLast4: (body.accountLast4 || '').trim(),
    })
    await writeAuditLog({
      actorUid: req.authUid, actorRole: req.user.role,
      action: 'teacher.payout_requested',
      targetType: 'payout_request', targetId: payoutRequest.id,
      meta: { amount: payoutRequest.amount, currency: payoutRequest.currency, method: payoutRequest.method },
    })
    res.status(201).json({ payoutRequest })
  } catch (error) {
    next(error)
  }
})

// ─── Admin diagnostic + repair ────────────────────────────────────────────────

paymentRouter.get('/admin/students/:studentUid/payments/debug', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { studentUid } = req.params
    if (!studentUid || typeof studentUid !== 'string' || studentUid.length > 128) {
      return res.status(400).json({ message: 'Invalid studentUid.', code: 'INVALID_PARAM' })
    }
    const listingId = parseObjectId(req.query?.listingId, 'listingId')
    const database = getDatabase()
    const [payments, enrollment] = await Promise.all([
      database.collection('studentPayments').find(
        { studentUid, listingId },
        { projection: { studentEmail: 0, studentName: 0 } },
      ).sort({ createdAt: -1 }).toArray(),
      database.collection('studentEnrollments').findOne(
        { studentUid, listingId },
        { projection: { studentEmail: 0, studentName: 0 } },
      ),
    ])
    res.json({ studentUid, listingId, payments, enrollment })
  } catch (error) {
    next(error)
  }
})

paymentRouter.post('/admin/students/:studentUid/payments/repair-enrollment', verifyToken, requireRole('admin'), async (req, res, next) => {
  try {
    const { studentUid } = req.params
    if (!studentUid || typeof studentUid !== 'string' || studentUid.length > 128) {
      return res.status(400).json({ message: 'Invalid studentUid.', code: 'INVALID_PARAM' })
    }
    if (Object.keys(req.body || {}).some((k) => k !== 'listingId')) {
      return res.status(400).json({ message: 'Only listingId is accepted.', code: 'INVALID_REQUEST' })
    }
    const listingId = parseObjectId(req.body?.listingId, 'listingId')
    const database = getDatabase()
    const payment = await database.collection('studentPayments').findOne(
      { studentUid, listingId, status: 'paid' },
      { sort: { createdAt: -1 } },
    )
    if (!payment) {
      return res.status(404).json({ message: 'No paid payment record found for this student and course.', code: 'PAYMENT_NOT_FOUND' })
    }
    await activateEnrollment(database, payment, payment.amount)
    await writeAuditLog({
      actorUid: req.authUid, actorRole: 'admin',
      action: 'admin.enrollment_repaired',
      targetType: 'student_enrollment', targetId: String(listingId),
      meta: { studentUid, paymentId: payment.paymentId, repaired: true },
    })
    const enrollment = await database.collection('studentEnrollments').findOne({ studentUid, listingId })
    res.json({ repaired: true, enrollment })
  } catch (error) {
    next(error)
  }
})

// ─── Stripe webhook ───────────────────────────────────────────────────────────

stripeWebhookRouter.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const signature = req.get('stripe-signature')
    if (!signature || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ message: 'Stripe webhook signature or raw body is missing.', code: 'INVALID_STRIPE_WEBHOOK' })
    }
    const event = constructStripeWebhookEvent(req.body, signature)

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await confirmPaidSession(getDatabase(), event.data.object)
    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object
      const transactionId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent : charge.payment_intent?.id
      if (transactionId && charge.currency === 'bdt' && Number.isFinite(charge.amount_refunded)) {
        const refunded = await applyVerifiedRefund(
          getDatabase(), transactionId, charge.amount_refunded / 100, event.id,
        )
        if (refunded) {
          await writeAuditLog({
            actorUid: 'stripe-webhook', actorRole: 'system',
            action: 'course_payment_refund_verified',
            targetType: 'student_payment', targetId: transactionId,
            meta: { transactionId, refundedAmount: charge.amount_refunded / 100, eventId: event.id },
          })
        }
      }
    }
    // All other event types (subscription events) are no-ops — we don't use subscriptions.
    return res.json({ received: true })
  } catch (error) {
    if (error.type === 'StripeSignatureVerificationError') {
      return res.status(400).json({ message: 'Stripe webhook signature could not be verified.', code: 'INVALID_STRIPE_SIGNATURE' })
    }
    return next(error)
  }
})
