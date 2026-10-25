import { randomUUID } from 'node:crypto'
import express, { Router } from 'express'
import { ObjectId } from 'mongodb'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'
import { createNotifications, notifyAdmins } from '../services/notification.service.js'
import {
  assertStripeTestConfigured,
  constructStripeWebhookEvent,
  createStripeCheckoutSession,
  retrieveStripeCheckoutSession,
} from '../services/stripe.service.js'
import { parseObjectId } from '../utils/validation.js'

export const paymentRouter = Router()
export const stripeWebhookRouter = Router()

function clientOriginFor(request) {
  const configuredOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean)
  const requestOrigin = request.get('Origin')
  if (requestOrigin && configuredOrigins.includes(requestOrigin)) return requestOrigin
  if (process.env.NODE_ENV !== 'production' && requestOrigin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(requestOrigin)) {
    return requestOrigin
  }
  return configuredOrigins[0] || 'http://localhost:5173'
}

async function activateEnrollment(database, payment, amount) {
  const listingId = payment.listingId instanceof ObjectId ? payment.listingId : new ObjectId(payment.listingId)
  const now = new Date()
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
        teacherUid: payment.teacherUid,
        teacherName: payment.teacherName,
        fee: amount,
        status: 'active',
        paymentStatus: 'test_paid',
        paymentId: payment.paymentId,
        updatedAt: now,
      },
      $setOnInsert: { enrolledAt: now, createdAt: now },
    },
    { upsert: true },
  )
}

async function confirmPaidSession(database, session) {
  if (session.mode !== 'payment' || session.livemode !== false ||
      session.payment_status !== 'paid' || session.currency !== 'bdt' ||
      !session.metadata?.orderId || session.client_reference_id !== session.metadata.orderId) {
    return false
  }

  const payments = database.collection('studentPayments')
  const payment = await payments.findOne({
    paymentId: session.metadata.orderId,
    gateway: 'stripe',
    mode: 'test',
    providerPaymentId: session.id,
  })
  if (!payment) return false

  const amount = Number(session.amount_total) / 100
  if (!Number.isFinite(amount) || Math.round(amount * 100) !== Math.round(Number(payment.amount) * 100)) {
    await payments.updateOne(
      { _id: payment._id, status: 'pending' },
      { $set: { status: 'verification_failed', updatedAt: new Date() } },
    )
    return false
  }
  if (payment.status === 'paid') {
    await activateEnrollment(database, payment, amount)
    return true
  }
  if (payment.status !== 'pending') return false

  const paidAt = Number.isFinite(session.created) ? new Date(session.created * 1000) : new Date()
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id
  const update = await payments.updateOne(
    { _id: payment._id, status: 'pending' },
    {
      $set: {
        amount,
        status: 'paid',
        providerTransactionId: paymentIntentId || null,
        paidAt,
        platformCommissionAmount: 0,
        teacherNetAmount: 0,
        updatedAt: new Date(),
      },
    },
  )
  if (!update.modifiedCount) {
    const current = await payments.findOne({ _id: payment._id })
    if (current?.status === 'paid') await activateEnrollment(database, payment, amount)
    return current?.status === 'paid'
  }

  await activateEnrollment(database, payment, amount)
  const listingId = payment.listingId instanceof ObjectId ? payment.listingId : new ObjectId(payment.listingId)
  const notification = {
    type: 'enrollment',
    title: 'New Stripe test payment and enrollment',
    message: `${payment.studentName} completed a Stripe test payment for ${payment.courseName}. This test transaction is excluded from teacher income and commission.`,
    relatedId: String(listingId),
  }
  await Promise.all([
    createNotifications(database, [{ uid: payment.teacherUid, role: 'teacher' }], { ...notification, href: '/dashboard/payments' }),
    notifyAdmins(database, { ...notification, href: '/admin/payments' }),
  ])
  return true
}

paymentRouter.post('/student/payments/checkout', verifyToken, requireRole('student'), async (req, res, next) => {
  let orderId
  try {
    assertStripeTestConfigured()
    const listingId = parseObjectId(req.body?.listingId, 'listingId')
    const database = getDatabase()
    const listing = await database.collection('listings').findOne({ _id: listingId, status: 'active' })
    if (!listing) return res.status(404).json({ message: 'This course is no longer available.', code: 'LISTING_NOT_FOUND' })

    const amount = Number(listing.fee)
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'This course does not have a valid paid fee.', code: 'INVALID_COURSE_FEE' })
    }
    if (!Number.isSafeInteger(Math.round(amount * 100)) || Math.round(amount * 100) < 1) {
      return res.status(400).json({ message: "This course fee is outside Stripe's supported BDT amount range.", code: 'INVALID_STRIPE_AMOUNT' })
    }

    const payments = database.collection('studentPayments')
    const alreadyPaid = await payments.findOne({
      studentUid: req.authUid,
      listingId,
      gateway: { $in: ['stripe', 'bkash'] },
      mode: { $in: ['test', 'sandbox', 'live'] },
      status: 'paid',
    })
    if (alreadyPaid) return res.status(409).json({ message: 'This course has already been paid for.', code: 'ALREADY_PAID' })

    const now = new Date()
    orderId = randomUUID()
    const payment = {
      paymentId: orderId,
      studentUid: req.authUid,
      studentName: req.user.fullName || req.user.email,
      studentEmail: req.user.email,
      listingId,
      courseName: listing.name,
      category: listing.category,
      teacherUid: listing.teacherUid,
      teacherName: listing.teacherName,
      amount,
      currency: 'BDT',
      gateway: 'stripe',
      mode: 'test',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    await payments.insertOne(payment)

    try {
      const checkout = await createStripeCheckoutSession({
        amount,
        orderId,
        courseName: listing.name,
        studentEmail: req.user.email,
        clientOrigin: clientOriginFor(req),
      })
      const checkoutUrl = new URL(checkout.url)
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com' || !checkout.id?.startsWith('cs_test_')) {
        throw new Error('Stripe returned an invalid test checkout session.')
      }

      const storedSession = await payments.updateOne(
        { paymentId: orderId, status: 'pending' },
        { $set: { providerPaymentId: checkout.id, updatedAt: new Date() } },
      )
      if (!storedSession.matchedCount) throw new Error('The Stripe checkout session could not be linked to its payment order.')
      return res.status(201).json({
        payment: { id: orderId, amount, currency: 'BDT', mode: 'test', status: 'pending' },
        redirectUrl: checkoutUrl.toString(),
      })
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

paymentRouter.get('/student/payments/checkout/confirm', verifyToken, requireRole('student'), async (req, res, next) => {
  try {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : ''
    if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) {
      return res.status(400).json({ message: 'Invalid Stripe test checkout session.', code: 'INVALID_CHECKOUT_SESSION' })
    }

    const database = getDatabase()
    const payment = await database.collection('studentPayments').findOne({
      gateway: 'stripe',
      mode: 'test',
      providerPaymentId: sessionId,
      studentUid: req.authUid,
    })
    if (!payment) return res.status(404).json({ message: 'Payment order was not found.', code: 'PAYMENT_ORDER_NOT_FOUND' })

    const session = await retrieveStripeCheckoutSession(sessionId)
    const confirmed = await confirmPaidSession(database, session)
    const current = await database.collection('studentPayments').findOne({ _id: payment._id }, { projection: { status: 1 } })
    if (confirmed || current?.status === 'paid') return res.json({ status: 'paid' })
    return res.status(202).json({ status: current?.status === 'verification_failed' ? 'verification_failed' : 'pending' })
  } catch (error) {
    next(error)
  }
})

stripeWebhookRouter.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const signature = req.get('stripe-signature')
    if (!signature || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ message: 'Stripe webhook signature or raw request body is missing.', code: 'INVALID_STRIPE_WEBHOOK' })
    }
    const event = constructStripeWebhookEvent(req.body, signature)
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await confirmPaidSession(getDatabase(), event.data.object)
    }
    return res.json({ received: true })
  } catch (error) {
    if (error.type === 'StripeSignatureVerificationError') {
      return res.status(400).json({ message: 'Stripe webhook signature could not be verified.', code: 'INVALID_STRIPE_SIGNATURE' })
    }
    return next(error)
  }
})
