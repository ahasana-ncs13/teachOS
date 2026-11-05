/**
 * bKash Payment Routes — /api/bkash/*
 *
 * All routes call the bkash.service.js layer.
 * Swap to real bKash by changing BKASH_MODE in .env — routes stay the same.
 *
 * Endpoints:
 *   POST /api/bkash/create          — create a payment intent
 *   POST /api/bkash/mobile          — (demo only) set the mobile number + trigger OTP step
 *   POST /api/bkash/otp             — (demo only) verify the OTP
 *   POST /api/bkash/execute         — verify PIN and complete the payment
 *   POST /api/bkash/enroll/:id      — after success, enroll the student + record payment
 *   GET  /api/bkash/query/:paymentID — query payment status
 *   POST /api/bkash/refund          — (stub) initiate refund
 */

import { Router } from 'express'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'
import { parseObjectId } from '../utils/validation.js'
import * as bkashService from '../services/bkash.service.js'
import { writeAuditLog } from '../services/audit.service.js'
import { computeListingPricing } from '../services/listing.service.js'

export const bkashRouter = Router()

// All bKash routes require an authenticated student
bkashRouter.use('/bkash', verifyToken, requireRole('student'))

function currentBillingPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * POST /api/bkash/create
 * Creates a payment intent for a listing.
 * Body: { listingId, type?, billingPeriod? }
 *   type: 'initial' (admission + first month tuition) or 'monthly' (tuition only)
 */
bkashRouter.post('/bkash/create', async (req, res, next) => {
  try {
    const listingId = parseObjectId(req.body?.listingId, 'listingId')
    const { type = 'initial', billingPeriod } = req.body || {}
    if (!['initial', 'monthly'].includes(type)) {
      return res.status(400).json({ message: 'Invalid payment type.', code: 'INVALID_PAYMENT_TYPE' })
    }
    const db = getDatabase()
    const listing = await db.collection('listings').findOne({
      _id: listingId,
      status: { $ne: 'removed' },
    })
    if (!listing) {
      return res.status(404).json({ message: 'Course not found.', code: 'LISTING_NOT_FOUND' })
    }

    // Payment totals are calculated on the backend; never trust the client.
    const pricing = computeListingPricing(listing)
    let amount
    if (type === 'initial') {
      amount = pricing.initialPaymentTotal
      if (amount <= 0) {
        return res.status(400).json({ message: 'This course is free — no payment needed.', code: 'FREE_COURSE' })
      }
    } else {
      amount = pricing.monthlyTuitionFee
      if (!amount || amount <= 0) {
        return res.status(400).json({ message: 'This course has no monthly tuition fee.', code: 'NO_TUITION_FEE' })
      }
    }

    const invoiceNumber = `INV-${String(listing._id).slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`
    const result = await bkashService.createPayment({
      amount,
      invoiceNumber,
      orderId: String(listingId),
      studentUid: req.authUid,
      studentName: req.user.fullName || req.user.email,
    })

    // Store listingId + payment context on the payment doc so execute can find it
    await db.collection('bkashPayments').updateOne(
      { paymentID: result.paymentID },
      {
        $set: {
          listingId,
          merchantName: listing.teacherName || 'TeachOS Teacher',
          paymentType: type,
          billingPeriod: billingPeriod || currentBillingPeriod(),
          admissionFee: pricing.admissionFee,
          monthlyTuitionFee: pricing.monthlyTuitionFee,
          initialPaymentTotal: pricing.initialPaymentTotal,
        },
      },
    )

    res.status(201).json({
      ...result,
      listingId: String(listingId),
      listingName: listing.name,
      merchantName: listing.teacherName || 'TeachOS Teacher',
      paymentType: type,
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
 * POST /api/bkash/mobile
 * (Demo mode only) Set the customer mobile number and transition to otp_pending.
 * Body: { paymentID, mobileNumber }
 */
bkashRouter.post('/bkash/mobile', async (req, res, next) => {
  try {
    const { paymentID, mobileNumber } = req.body || {}
    if (!paymentID || typeof paymentID !== 'string') {
      return res.status(400).json({ message: 'paymentID is required.', code: 'MISSING_PAYMENT_ID' })
    }
    if (typeof mobileNumber !== 'string' || !/^01[3-9]\d{8}$/.test(mobileNumber)) {
      return res.status(400).json({ message: 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).', code: 'INVALID_MOBILE' })
    }

    // Verify this payment belongs to the requesting student
    const db = getDatabase()
    const payment = await db.collection('bkashPayments').findOne({ paymentID, studentUid: req.authUid })
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found.', code: 'PAYMENT_NOT_FOUND' })
    }

    const result = await bkashService.setMobileNumber({ paymentID, mobileNumber })
    res.json(result)
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/bkash/otp
 * (Demo mode) Verify the OTP sent to the customer's mobile.
 * Body: { paymentID, otp }
 */
bkashRouter.post('/bkash/otp', async (req, res, next) => {
  try {
    const { paymentID, otp } = req.body || {}
    if (!paymentID || typeof paymentID !== 'string') {
      return res.status(400).json({ message: 'paymentID is required.', code: 'MISSING_PAYMENT_ID' })
    }
    if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Enter a valid 6-digit OTP.', code: 'INVALID_OTP_FORMAT' })
    }

    const db = getDatabase()
    const payment = await db.collection('bkashPayments').findOne({ paymentID, studentUid: req.authUid })
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found.', code: 'PAYMENT_NOT_FOUND' })
    }

    const result = await bkashService.verifyOtp({ paymentID, otp })
    if (!result.success) {
      return res.status(400).json({ message: result.reason || 'Invalid OTP.', code: 'INVALID_OTP' })
    }
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/bkash/execute
 * Verify PIN and complete the payment. On success, record studentPayment and enroll student.
 * Body: { paymentID, pin, mobileNumber }
 */
bkashRouter.post('/bkash/execute', async (req, res, next) => {
  try {
    const { paymentID, pin, mobileNumber } = req.body || {}
    if (!paymentID || typeof paymentID !== 'string') {
      return res.status(400).json({ message: 'paymentID is required.', code: 'MISSING_PAYMENT_ID' })
    }
    if (typeof pin !== 'string' || !/^\d{5}$/.test(pin)) {
      return res.status(400).json({ message: 'Enter a valid 5-digit bKash PIN.', code: 'INVALID_PIN_FORMAT' })
    }

    const db = getDatabase()
    const payment = await db.collection('bkashPayments').findOne({ paymentID, studentUid: req.authUid })
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found.', code: 'PAYMENT_NOT_FOUND' })
    }
    let result
    if (payment.status === 'completed') {
      result = { success: true, trxID: payment.trxID, amount: payment.amount, alreadyCompleted: true }
    } else {
      result = await bkashService.executePayment({ paymentID, pin, mobileNumber })
      if (!result.success) {
        return res.status(400).json({ message: result.reason || 'Payment failed.', code: 'PAYMENT_FAILED' })
      }
    }

    // Record in studentPayments + auto-enroll
    const rawListingId = payment.listingId
    let listingId = null
    if (rawListingId) {
      listingId = typeof rawListingId === 'string' ? parseObjectId(rawListingId, 'listingId') : rawListingId
    }
    const listing = listingId ? await db.collection('listings').findOne({ _id: listingId }) : null
    const now = new Date()
    const period = payment.billingPeriod || currentBillingPeriod()
    const pricing = listing ? computeListingPricing(listing) : { admissionFee: 0, monthlyTuitionFee: 0, initialPaymentTotal: 0 }

    if (listing) {
      const isMonthly = payment.paymentType === 'monthly'

      // Prevent duplicate charges for the same billing period.
      const existingPayment = await db.collection('studentPayments').findOne({
        studentUid: req.authUid,
        listingId,
        mode: 'bkash',
      })

      if (isMonthly) {
        // Monthly tuition: only append a new history entry when this period is unpaid.
        const alreadyPaidPeriod = existingPayment?.paymentHistory?.some(
          (entry) => entry.period === period && entry.status === 'paid',
        )
        if (alreadyPaidPeriod) {
          return res.status(409).json({
            message: 'Monthly tuition for this billing period has already been paid.',
            code: 'TUITION_ALREADY_PAID',
          })
        }
        // Guard: monthly payments require a completed initial enrollment payment.
        const initialPaid = Boolean(existingPayment?.admissionPaid && existingPayment?.tuitionPaid)
        if (!initialPaid) {
          return res.status(403).json({
            message: 'Initial enrollment payment must be completed before monthly tuition.',
            code: 'INITIAL_PAYMENT_REQUIRED',
          })
        }

        const historyEntry = {
          period,
          amount: pricing.monthlyTuitionFee,
          status: 'paid',
          paidAt: now,
          trxID: result.trxID,
          paymentID,
          type: 'tuition',
        }
        const updatedHistory = [...(existingPayment?.paymentHistory || []), historyEntry]

        await db.collection('studentPayments').updateOne(
          { studentUid: req.authUid, listingId, mode: 'bkash' },
          {
            $set: {
              amount: pricing.monthlyTuitionFee,
              status: 'paid',
              paidAt: now,
              updatedAt: now,
              tuitionPaid: true,
              billingPeriod: period,
              paymentHistory: updatedHistory,
            },
          },
        )

        await writeAuditLog({
          actorUid: req.authUid,
          actorRole: 'student',
          action: 'bkash_monthly_tuition_paid',
          targetType: 'listing',
          targetId: String(listingId),
          meta: { trxID: result.trxID, amount: pricing.monthlyTuitionFee, period, paymentID },
        })

        return res.json({
          success: true,
          trxID: result.trxID,
          amount: result.amount,
          currency: 'BDT',
          paymentID,
          paymentType: 'monthly',
          billingPeriod: period,
          message: 'Monthly tuition recorded.',
        })
      }

      // Initial enrollment payment: admission fee + first month tuition.
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
        mode: 'bkash',
        reference: result.trxID,
        trxID: result.trxID,
        paymentID,
        bkashPaymentId: paymentID,
        createdAt: now,
        // Admission + monthly tuition tracking
        admissionFee: pricing.admissionFee,
        monthlyTuitionFee: pricing.monthlyTuitionFee,
        initialPaymentTotal: pricing.initialPaymentTotal,
        billingPeriod: period,
        transactionId: result.trxID,
        paymentStatus: 'paid',
        paymentHistory: [
          {
            period,
            amount: pricing.monthlyTuitionFee,
            status: 'paid',
            paidAt: now,
            trxID: result.trxID,
            paymentID,
            type: 'tuition',
          },
        ],
      }

      await db.collection('studentPayments').updateOne(
        { studentUid: req.authUid, listingId, mode: 'bkash' },
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
            paymentStatus: 'bkash_paid',
            admissionPaid: true,
            tuitionPaid: true,
            bkashPaymentId: paymentID,
            trxID: result.trxID,
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
        action: 'bkash_payment_completed',
        targetType: 'listing',
        targetId: String(listingId),
        meta: { trxID: result.trxID, amount: pricing.initialPaymentTotal, paymentID, admissionFee: pricing.admissionFee, monthlyTuitionFee: pricing.monthlyTuitionFee },
      })
    }

    res.json({
      success: true,
      trxID: result.trxID,
      amount: result.amount,
      currency: 'BDT',
      paymentID,
      paymentType: payment.paymentType || 'initial',
      billingPeriod: period,
      enrolledListingId: listingId ? String(listingId) : null,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * GET /api/bkash/query/:paymentID
 * Query the current status of a payment.
 */
bkashRouter.get('/bkash/query/:paymentID', async (req, res, next) => {
  try {
    const { paymentID } = req.params
    if (!paymentID || typeof paymentID !== 'string') {
      return res.status(400).json({ message: 'paymentID is required.', code: 'MISSING_PAYMENT_ID' })
    }
    const result = await bkashService.queryPayment({ paymentID })
    if (!result.found) {
      return res.status(404).json({ message: 'Payment not found.', code: 'PAYMENT_NOT_FOUND' })
    }
    res.json(result)
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/bkash/refund  (stub — records only)
 * Body: { paymentID, amount, reason }
 */
bkashRouter.post('/bkash/refund', async (req, res, next) => {
  try {
    // TODO: In sandbox/live mode: POST {baseUrl}/tokenized/checkout/payment/refund
    const { paymentID, reason } = req.body || {}
    if (!paymentID) {
      return res.status(400).json({ message: 'paymentID is required.', code: 'MISSING_PAYMENT_ID' })
    }
    const db = getDatabase()
    const payment = await db.collection('bkashPayments').findOne({ paymentID, studentUid: req.authUid })
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found.', code: 'PAYMENT_NOT_FOUND' })
    }
    const now = new Date()
    await db.collection('bkashPayments').updateOne(
      { paymentID },
      { $set: { status: 'refund_requested', refundReason: reason || '', refundRequestedAt: now, updatedAt: now } },
    )
    await writeAuditLog({
      actorUid: req.authUid,
      actorRole: 'student',
      action: 'bkash_refund_requested',
      targetType: 'bkashPayment',
      targetId: paymentID,
      meta: { reason },
    })
    res.json({ success: true, message: 'Refund request recorded. An admin will process it.' })
  } catch (error) {
    next(error)
  }
})
