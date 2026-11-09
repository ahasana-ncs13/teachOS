import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'
import {
  confirmTeacherSubscriptionPayment,
  getTeacherSubscription,
} from '../services/teacherSubscription.service.js'
import {
  createStripeCheckoutSession,
  getStripeMode,
  retrieveStripeCheckoutSession,
} from '../services/stripe.service.js'

export const teacherSubscriptionRouter = Router()

function clientOriginFor(request) {
  const configuredOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((origin) => origin.trim()).filter(Boolean)
  const requestOrigin = request.get('Origin')
  if (requestOrigin && configuredOrigins.includes(requestOrigin)) return requestOrigin
  if (process.env.NODE_ENV !== 'production' && requestOrigin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(requestOrigin)) {
    return requestOrigin
  }
  return configuredOrigins[0] || 'http://localhost:5173'
}

teacherSubscriptionRouter.use('/teacher/subscription', verifyToken, requireRole('teacher'), (req, res, next) => {
  if (req.user.role !== 'teacher') {
    return res.status(403).json({ message: 'Teacher subscription billing is only available to teachers.', code: 'TEACHER_ONLY' })
  }
  next()
})

teacherSubscriptionRouter.get('/teacher/subscription', async (req, res, next) => {
  try {
    const subscription = await getTeacherSubscription(getDatabase(), req.authUid)
    res.json({ subscription })
  } catch (error) {
    next(error)
  }
})

teacherSubscriptionRouter.post('/teacher/subscription/checkout', async (req, res, next) => {
  const database = getDatabase()
  let paymentId
  try {
    const subscription = await getTeacherSubscription(database, req.authUid)
    const invoice = subscription.invoices.find((item) => Number(item.dueAmount) > 0)
    if (!invoice) {
      return res.status(409).json({
        message: 'There is no outstanding income-based platform fee to pay.',
        code: 'NO_SUBSCRIPTION_BALANCE',
      })
    }

    paymentId = randomUUID()
    const mode = getStripeMode()
    const now = new Date()
    const payment = {
      paymentId,
      invoiceId: invoice._id,
      teacherUid: req.authUid,
      amount: Number(invoice.dueAmount),
      currency: 'BDT',
      gateway: 'stripe',
      mode,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    await database.collection('teacherSubscriptionPayments').insertOne(payment)

    const origin = clientOriginFor(req)
    const session = await createStripeCheckoutSession({
      amount: payment.amount,
      orderId: paymentId,
      productName: `TeachOS platform fee · ${invoice.month}`,
      customerEmail: req.user.email,
      clientOrigin: origin,
      successUrl: `${origin}/dashboard?subscription_session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/dashboard?subscription_checkout=cancelled`,
      metadata: {
        kind: 'teacher_subscription',
        orderId: paymentId,
        invoiceId: String(invoice._id),
        teacherUid: req.authUid,
      },
    })
    const checkoutUrl = new URL(session.url)
    if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
      throw new Error('Stripe returned an invalid checkout URL.')
    }
    await database.collection('teacherSubscriptionPayments').updateOne(
      { paymentId, status: 'pending' },
      { $set: { providerPaymentId: session.id, updatedAt: new Date() } },
    )
    res.status(201).json({
      payment: { id: paymentId, amount: payment.amount, currency: payment.currency, mode, status: 'pending' },
      redirectUrl: checkoutUrl.toString(),
    })
  } catch (error) {
    if (paymentId) {
      await database.collection('teacherSubscriptionPayments').updateOne(
        { paymentId, status: 'pending' },
        { $set: { status: 'failed_to_initialize', updatedAt: new Date() } },
      )
    }
    next(error)
  }
})

teacherSubscriptionRouter.get('/teacher/subscription/confirm', async (req, res, next) => {
  try {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : ''
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      return res.status(400).json({ message: 'Invalid Stripe checkout session.', code: 'INVALID_CHECKOUT_SESSION' })
    }
    const session = await retrieveStripeCheckoutSession(sessionId)
    const confirmed = await confirmTeacherSubscriptionPayment(getDatabase(), session, req.authUid)
    if (confirmed) {
      const subscription = await getTeacherSubscription(getDatabase(), req.authUid)
      return res.json({ status: 'paid', subscription })
    }
    res.status(202).json({ status: 'pending' })
  } catch (error) {
    next(error)
  }
})
