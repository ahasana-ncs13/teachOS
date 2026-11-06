/**
 * Stripe Payment Routes — /api/stripe/*
 *
 * STRIPE_MODE=demo   → simulated checkout, no real Stripe calls.
 * STRIPE_MODE=live   → real Stripe Checkout sessions.
 *
 * Endpoints:
 *   POST /api/stripe/create-checkout  — create a Stripe Checkout session
 *   GET  /api/stripe/session/:sessionId — verify a checkout session's payment status
 *   POST /api/stripe/enroll           — after successful payment, record + auto-enroll
 */

import { Router } from 'express'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'
import { parseObjectId } from '../utils/validation.js'
import * as stripeService from '../services/stripe.service.js'
import { writeAuditLog } from '../services/audit.service.js'
import { computeListingPricing } from '../services/listing.service.js'

export const stripeRouter = Router()

// All Stripe routes require an authenticated student
stripeRouter.use('/stripe', verifyToken, requireRole('student'))

function currentBillingPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * POST /api/stripe/create-checkout
 * Creates a Stripe Checkout session for a listing.
 * Body: { listingId, successUrl?, cancelUrl? }
 */
stripeRouter.post('/stripe/create-checkout', async (req, res, next) => {
  try {
    const listingId = parseObjectId(req.body?.listingId, 'listingId')
    const { successUrl, cancelUrl } = req.body || {}
    const db = getDatabase()
    const listing = await db.collection('listings').findOne({
      _id: listingId,
      status: { $ne: 'removed' },
    })
    if (!listing) {
      return res.status(404).json({ message: 'Course not found.', code: 'LISTING_NOT_FOUND' })
    }

    const pricing = computeListingPricing(listing)
    const amount = pricing.initialPaymentTotal
    if (amount <= 0) {
      return res.status(400).json({ message: 'This course is free — no payment needed.', code: 'FREE_COURSE' })
    }

    const defaultSuccess = `${process.env.CLIENT_URL || 'http://localhost:5173'}/student/payment/success`
    const defaultCancel = `${process.env.CLIENT_URL || 'http://localhost:5173'}/student/payment/cancel`

    const result = await stripeService.createCheckoutSession({
      amount,
      currency: 'bdt',
      listingId: String(listingId),
      studentUid: req.authUid,
      studentName: req.user.fullName || req.user.email,
      studentEmail: req.user.email,
      successUrl: successUrl || defaultSuccess,
      cancelUrl: cancelUrl || defaultCancel,
      metadata: {
        listingId: String(listingId),
        studentUid: req.authUid,
        studentName: req.user.fullName || req.user.email,
        teacherUid: listing.teacherUid || '',
      },
    })

    res.status(201).json({
      ...result,
      listingId: String(listingId),
      listingName: listing.name,
      amount,
      admissionFee: pricing.admissionFee,
      monthlyTuitionFee: pricing.monthlyTuitionFee,
      initialPaymentTotal: pricing.initialPaymentTotal,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/stripe/session/:sessionId
 * Verify the current status of a Stripe Checkout session.
 */
stripeRouter.get('/stripe/session/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ message: 'sessionId is required.', code: 'MISSING_SESSION_ID' })
    }
    const result = await stripeService.retrieveSession(sessionId)
    if (!result.found) {
      return res.status(404).json({ message: 'Checkout session not found.', code: 'SESSION_NOT_FOUND' })
    }
    // Verify this session belongs to the requesting student
    if (result.studentUid && result.studentUid !== req.authUid) {
      return res.status(403).json({ message: 'This checkout session does not belong to your account.', code: 'SESSION_NOT_YOURS' })
    }
    res.json(result)
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/stripe/enroll
 * After successful payment, record in studentPayments and auto-enroll.
 * Body: { sessionId }
 */
stripeRouter.post('/stripe/enroll', async (req, res, next) => {
  try {
    const { sessionId } = req.body || {}
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ message: 'sessionId is required.', code: 'MISSING_SESSION_ID' })
    }

    const db = getDatabase()
    const session = await stripeService.retrieveSession(sessionId)
    if (!session.found) {
      return res.status(404).json({ message: 'Checkout session not found.', code: 'SESSION_NOT_FOUND' })
    }
    if (session.studentUid && session.studentUid !== req.authUid) {
      return res.status(403).json({ message: 'This checkout session does not belong to your account.', code: 'SESSION_NOT_YOURS' })
    }
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ message: 'Payment has not been completed.', code: 'PAYMENT_NOT_COMPLETED' })
    }

    const rawListingId = session.listingId
    let listingId = null
    if (rawListingId) {
      listingId = typeof rawListingId === 'string' ? parseObjectId(rawListingId, 'listingId') : rawListingId
    }
    const listing = listingId ? await db.collection('listings').findOne({ _id: listingId }) : null
    const now = new Date()
    const period = currentBillingPeriod()
    const pricing = listing ? computeListingPricing(listing) : { admissionFee: 0, monthlyTuitionFee: 0, initialPaymentTotal: 0 }

    if (listing) {
      // Idempotent: if a paid Stripe payment already exists, just enroll and return success.
      const existingPayment = await db.collection('studentPayments').findOne({
        studentUid: req.authUid,
        listingId,
        mode: 'stripe',
      })
      if (existingPayment?.status === 'paid') {
        const enrollments = db.collection('studentEnrollments')
        await enrollments.updateOne(
          { studentUid: req.authUid, listingId },
          {
            $set: {
              studentUid: req.authUid,
              studentName: req.user.fullName || req.user.email,
              studentEmail: req.user.email,
              listingId,
              courseId: listing.courseId || null,
              courseName: listing.courseName || '',
              name: listing.name,
              category: listing.category,
              deliveryMode: listing.deliveryMode || 'live',
              days: listing.days || [],
              startTime: listing.startTime || '',
              endTime: listing.endTime || '',
              capacity: listing.capacity || null,
              teacherUid: listing.teacherUid,
              teacherName: listing.teacherName,
              duration: listing.duration,
              location: listing.location,
              fee: pricing.monthlyTuitionFee,
              admissionFee: pricing.admissionFee,
              monthlyTuitionFee: pricing.monthlyTuitionFee,
              initialPaymentTotal: pricing.initialPaymentTotal,
              image: listing.image || '',
              status: 'active',
              paymentStatus: 'stripe_paid',
              admissionPaid: true,
              tuitionPaid: true,
              stripeCheckoutSessionId: sessionId,
              trxID: sessionId,
              enrolledAt: now,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true },
        )

        await writeAuditLog({
          actorUid: req.authUid,
          actorRole: 'student',
          action: 'stripe_payment_already_paid_enroll',
          targetType: 'listing',
          targetId: String(listingId),
          meta: { sessionId, amount: pricing.initialPaymentTotal },
        })

        return res.json({
          success: true,
          sessionId,
          amount: session.amount,
          currency: session.currency,
          mode: session.mode,
          enrolledListingId: listingId ? String(listingId) : null,
          paymentStatus: 'paid',
          alreadyPaid: true,
        })
      }

      const studentPaymentDoc = {
        studentUid: req.authUid,
        studentName: req.user.fullName || req.user.email,
        studentEmail: req.user.email,
        listingId,
        courseName: listing.name,
        category: listing.category,
        teacherUid: listing.teacherUid,
        teacherName: listing.teacherName,
        duration: listing.duration,
        location: listing.location,
        image: listing.image || '',
        amount: pricing.initialPaymentTotal,
        currency: 'BDT',
        mode: 'stripe',
        reference: sessionId,
        trxID: sessionId,
        paymentID: sessionId,
        stripeCheckoutSessionId: sessionId,
        createdAt: now,
        admissionFee: pricing.admissionFee,
        monthlyTuitionFee: pricing.monthlyTuitionFee,
        initialPaymentTotal: pricing.initialPaymentTotal,
        billingPeriod: period,
        transactionId: sessionId,
        paymentStatus: 'paid',
        paymentHistory: [
          {
            period,
            amount: pricing.monthlyTuitionFee,
            status: 'paid',
            paidAt: now,
            trxID: sessionId,
            paymentID: sessionId,
            type: 'tuition',
          },
        ],
      }

      await db.collection('studentPayments').updateOne(
        { studentUid: req.authUid, listingId, mode: 'stripe' },
        {
          $setOnInsert: studentPaymentDoc,
          $set: { updatedAt: now, status: 'paid', paidAt: now, admissionPaid: true, tuitionPaid: true },
        },
        { upsert: true },
      )

      // Auto-enroll the student
      const enrollments = db.collection('studentEnrollments')
      await enrollments.updateOne(
        { studentUid: req.authUid, listingId },
        {
          $set: {
            studentUid: req.authUid,
            studentName: req.user.fullName || req.user.email,
            studentEmail: req.user.email,
            listingId,
            courseId: listing.courseId || null,
            courseName: listing.courseName || '',
            name: listing.name,
            category: listing.category,
            deliveryMode: listing.deliveryMode || 'live',
            days: listing.days || [],
            startTime: listing.startTime || '',
            endTime: listing.endTime || '',
            capacity: listing.capacity || null,
            teacherUid: listing.teacherUid,
            teacherName: listing.teacherName,
            duration: listing.duration,
            location: listing.location,
            fee: pricing.monthlyTuitionFee,
            admissionFee: pricing.admissionFee,
            monthlyTuitionFee: pricing.monthlyTuitionFee,
            initialPaymentTotal: pricing.initialPaymentTotal,
            image: listing.image || '',
            status: 'active',
            paymentStatus: 'stripe_paid',
            admissionPaid: true,
            tuitionPaid: true,
            stripeCheckoutSessionId: sessionId,
            trxID: sessionId,
            enrolledAt: now,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      )

      await writeAuditLog({
        actorUid: req.authUid,
        actorRole: 'student',
        action: 'stripe_payment_completed',
        targetType: 'listing',
        targetId: String(listingId),
        meta: { sessionId, amount: pricing.initialPaymentTotal, admissionFee: pricing.admissionFee, monthlyTuitionFee: pricing.monthlyTuitionFee },
      })
    }

    res.json({
      success: true,
      sessionId,
      amount: session.amount,
      currency: session.currency,
      mode: session.mode,
      enrolledListingId: listingId ? String(listingId) : null,
      paymentStatus: session.payment_status,
    })
  } catch (error) {
    next(error)
  }
})
