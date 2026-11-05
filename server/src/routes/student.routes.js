import { Router } from 'express'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'
import { createNotifications, notifyAdmins } from '../services/notification.service.js'
import { parseObjectId } from '../utils/validation.js'
import { computeListingPricing } from '../services/listing.service.js'

export const studentRouter = Router()

studentRouter.use('/student', verifyToken, requireRole('student'))

const PAID_MODES = ['demo', 'test', 'bkash']

function billingPeriodKey(date = new Date()) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function getEligibleStudentEnrollments(database, studentUid) {
  const enrollments = await database.collection('studentEnrollments')
    .find({ studentUid, status: 'active' })
    .sort({ createdAt: -1 })
    .toArray()
  if (!enrollments.length) return []

  const listingIds = enrollments.map((enrollment) => enrollment.listingId)
  const [listings, payments] = await Promise.all([
    database.collection('listings').find({ _id: { $in: listingIds } }, { projection: { fee: 1, monthlyTuitionFee: 1, admissionFee: 1 } }).toArray(),
    database.collection('studentPayments').find({
      studentUid,
      listingId: { $in: listingIds },
      status: 'paid',
      mode: { $in: PAID_MODES },
    }, { projection: { listingId: 1, admissionPaid: 1, tuitionPaid: 1 } }).toArray(),
  ])
  const listingsById = new Map(listings.map((listing) => [String(listing._id), listing]))
  const paidListingIds = new Set()
  for (const payment of payments) {
    const listing = listingsById.get(String(payment.listingId))
    const { admissionFee } = computeListingPricing(listing || {})
    if (payment.admissionPaid && payment.tuitionPaid) {
      // New-style initial payment: admission + first month tuition both paid.
      paidListingIds.add(String(payment.listingId))
    } else if (admissionFee === 0 && !payment.admissionPaid && !payment.tuitionPaid) {
      // Legacy record (monthly-only charge) for a free-admission listing.
      paidListingIds.add(String(payment.listingId))
    }
  }

  return enrollments.filter((enrollment) => {
    const currentListing = listingsById.get(String(enrollment.listingId))
    const { initialPaymentTotal } = computeListingPricing(currentListing || { fee: Number(enrollment.fee) || 0 })
    return initialPaymentTotal <= 0 || paidListingIds.has(String(enrollment.listingId))
  })
}

function isPastDue(dueDate) {
  if (!dueDate) return false
  if (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return Date.now() > new Date(`${dueDate}T23:59:59.999Z`).getTime()
  }
  return new Date(dueDate).getTime() < Date.now()
}

studentRouter.get('/student/dashboard', async (req, res, next) => {
  try {
    const database = getDatabase()
    const studentUid = req.authUid
    const enrollments = await getEligibleStudentEnrollments(database, studentUid)
    const listingIds = enrollments.map((enrollment) => enrollment.listingId)
    const [listings, assignments, submissions, liveClasses] = await Promise.all([
      listingIds.length
        ? database.collection('listings').find({ _id: { $in: listingIds }, status: 'active' }, {
          projection: { teacherUid: 0, platformId: 0, removedAt: 0, removedBy: 0 },
        }).toArray()
        : [],
      listingIds.length
        ? database.collection('assignments').find({ listingId: { $in: listingIds }, status: 'active' }, {
          projection: { teacherUid: 0 },
        }).sort({ dueDate: 1 }).toArray()
        : [],
      database.collection('assignmentSubmissions').find({ studentUid }).toArray(),
      listingIds.length
        ? database.collection('classes').find({
          listingId: { $in: listingIds.map(String) },
          classType: 'live',
          status: { $in: ['active', 'upcoming'] },
        }, { projection: { uid: 0, students: 0 } }).sort({ classDate: 1, startTime: 1 }).toArray()
        : [],
    ])
    const listingsById = new Map(listings.map((listing) => [String(listing._id), listing]))
    const submissionsByAssignment = new Map(submissions.map((submission) => [String(submission.assignmentId), submission]))
    const enrolledCourses = enrollments.map((enrollment) => ({
      ...enrollment,
      listing: listingsById.get(String(enrollment.listingId)) || {
        _id: enrollment.listingId,
        name: enrollment.name,
        category: enrollment.category,
        teacherName: enrollment.teacherName,
        duration: enrollment.duration,
        location: enrollment.location,
        fee: enrollment.fee,
        image: enrollment.image,
        courseId: enrollment.courseId,
        courseName: enrollment.courseName,
        deliveryMode: enrollment.deliveryMode,
        days: enrollment.days,
        startTime: enrollment.startTime,
        endTime: enrollment.endTime,
        capacity: enrollment.capacity,
        status: 'unavailable',
      },
    }))
    const studentAssignments = assignments.map((assignment) => ({
      ...assignment,
      submission: submissionsByAssignment.get(String(assignment._id)) || null,
    }))

    res.json({
      dashboard: {
        enrollments: enrolledCourses,
        assignments: studentAssignments,
        liveClasses,
        stats: {
          enrolledCourses: enrolledCourses.length,
          pendingAssignments: studentAssignments.filter((assignment) => !assignment.submission).length,
          submittedAssignments: studentAssignments.filter((assignment) => assignment.submission).length,
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

studentRouter.post('/student/enrollments/:listingId', async (req, res, next) => {
  try {
    const listingId = parseObjectId(req.params.listingId, 'listingId')
    const database = getDatabase()
    const listing = await database.collection('listings').findOne({
      _id: listingId,
      status: 'active',
    })
    if (!listing) {
      return res.status(404).json({ message: 'This course is no longer available.', code: 'LISTING_NOT_FOUND' })
    }
    if (listing.status === 'draft' || listing.status === 'completed') {
      return res.status(409).json({ message: 'This listing is not accepting new enrollments.', code: 'LISTING_NOT_OPEN' })
    }

    const enrollments = database.collection('studentEnrollments')
    const existing = await enrollments.findOne({ studentUid: req.authUid, listingId })
    const pricing = computeListingPricing(listing)
    const initialRequired = pricing.initialPaymentTotal > 0
    const paidPayment = initialRequired
      ? await database.collection('studentPayments').findOne({
        studentUid: req.authUid,
        listingId,
        status: 'paid',
        mode: { $in: PAID_MODES },
        admissionPaid: true,
        tuitionPaid: true,
      })
      : null
    if (initialRequired && !paidPayment) {
      return res.status(402).json({
        message: 'Payment is required before enrolling in this course. Complete checkout first.',
        code: 'PAYMENT_REQUIRED',
      })
    }
    if (existing) {
      if (paidPayment) {
        await enrollments.updateOne(
          { _id: existing._id },
          {
            $set: {
              status: 'active',
              paymentStatus: paidPayment.mode === 'bkash' ? 'bkash_paid' : (paidPayment.mode === 'demo' ? 'demo_paid' : 'test_paid'),
              demoPaymentId: paidPayment.demoPaymentId || null,
              stripeCheckoutSessionId: paidPayment.stripeCheckoutSessionId || null,
              bkashPaymentId: paidPayment.bkashPaymentId || null,
              trxID: paidPayment.trxID || null,
              updatedAt: new Date(),
            },
          },
        )
        return res.json({ enrollment: existing, alreadyEnrolled: true })
      }
      if (!initialRequired) return res.json({ enrollment: existing, alreadyEnrolled: true })
      return res.status(402).json({ message: 'This course requires payment before enrollment.', code: 'PAYMENT_REQUIRED' })
    }

    if (Number.isSafeInteger(listing.capacity) && listing.capacity > 0) {
      const enrolledCount = await enrollments.countDocuments({ listingId, status: 'active' })
      if (enrolledCount >= listing.capacity) {
        return res.status(409).json({ message: 'This listing has reached its enrollment capacity.', code: 'LISTING_FULL' })
      }
    }

    const now = new Date()
    const enrollment = {
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
      // Legacy monthly fee mirror for existing readers.
      fee: pricing.monthlyTuitionFee,
      admissionFee: pricing.admissionFee,
      monthlyTuitionFee: pricing.monthlyTuitionFee,
      initialPaymentTotal: pricing.initialPaymentTotal,
      image: listing.image || '',
      status: 'active',
      ...(paidPayment ? {
        paymentStatus: paidPayment.mode === 'bkash' ? 'bkash_paid' : (paidPayment.mode === 'demo' ? 'demo_paid' : 'test_paid'),
        demoPaymentId: paidPayment.demoPaymentId || null,
        stripeCheckoutSessionId: paidPayment.stripeCheckoutSessionId || null,
        bkashPaymentId: paidPayment.bkashPaymentId || null,
        trxID: paidPayment.trxID || null,
      } : {}),
      enrolledAt: now,
      createdAt: now,
      updatedAt: now,
    }
    const result = await enrollments.insertOne(enrollment)
    const notification = {
      type: 'enrollment',
      title: 'New student enrollment',
      message: `${enrollment.studentName} enrolled in ${listing.name}.`,
      relatedId: String(listingId),
    }
    const notificationsSent = (await Promise.all([
      createNotifications(database, [{ uid: listing.teacherUid, role: 'teacher' }], { ...notification, href: '/dashboard/classes' }),
      notifyAdmins(database, { ...notification, href: '/admin/classes' }),
    ])).every(Boolean)
    res.status(201).json({ enrollment: { _id: result.insertedId, ...enrollment }, notificationsSent })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'You are already enrolled in this course.', code: 'ALREADY_ENROLLED' })
    }
    next(error)
  }
})

studentRouter.post('/student/payments/checkout', async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        message: 'Local BDT demo payments are disabled in production.',
        code: 'DEMO_PAYMENTS_DISABLED',
      })
    }

    const listingId = parseObjectId(req.body?.listingId, 'listingId')
    const database = getDatabase()
    const listing = await database.collection('listings').findOne({
      _id: listingId,
      status: { $ne: 'removed' },
    })
    if (!listing) return res.status(404).json({ message: 'This course is no longer available.', code: 'LISTING_NOT_FOUND' })

    const pricing = computeListingPricing(listing)
    const amountBdt = pricing.initialPaymentTotal
    if (amountBdt <= 0) return res.status(400).json({ message: 'Free courses do not require checkout.', code: 'FREE_COURSE' })
    if (!Number.isFinite(amountBdt)) return res.status(400).json({ message: 'This course has an invalid fee.', code: 'INVALID_COURSE_FEE' })

    const enrollments = database.collection('studentEnrollments')
    const existingEnrollment = await enrollments.findOne({ studentUid: req.authUid, listingId, status: 'active' })
    const payments = database.collection('studentPayments')
    let payment = await payments.findOne({
      studentUid: req.authUid,
      listingId,
      status: 'paid',
      mode: 'demo',
      admissionPaid: true,
      tuitionPaid: true,
    })
    const now = new Date()
    const period = billingPeriodKey(now)
    const demoPaymentId = randomUUID()
    const paymentResult = await payments.updateOne(
      { studentUid: req.authUid, listingId, mode: 'demo' },
      {
        $setOnInsert: {
          demoPaymentId,
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
          amount: amountBdt,
          currency: 'BDT',
          status: 'paid',
          mode: 'demo',
          demoOnly: true,
          paidAt: now,
          createdAt: now,
          admissionFee: pricing.admissionFee,
          monthlyTuitionFee: pricing.monthlyTuitionFee,
          initialPaymentTotal: amountBdt,
          admissionPaid: true,
          tuitionPaid: true,
          billingPeriod: period,
          transactionId: demoPaymentId,
          paymentStatus: 'paid',
          paymentHistory: [
            {
              period,
              amount: pricing.monthlyTuitionFee,
              status: 'paid',
              paidAt: now,
              trxID: demoPaymentId,
              paymentID: demoPaymentId,
              type: 'tuition',
            },
          ],
        },
        $set: { updatedAt: now },
      },
      { upsert: true },
    )
    payment = await payments.findOne({ studentUid: req.authUid, listingId, mode: 'demo' })

    if (!payment || payment.status !== 'paid') {
      return res.status(409).json({ message: 'A BDT demo payment could not be confirmed. Please retry.', code: 'DEMO_PAYMENT_NOT_CONFIRMED' })
    }

    if (paymentResult.upsertedCount || payment?.status === 'paid') {
      await enrollments.updateOne(
        { studentUid: req.authUid, listingId },
        {
          $set: {
            studentUid: req.authUid,
            studentName: req.user.fullName || req.user.email,
            studentEmail: req.user.email,
            listingId,
            name: listing.name,
            category: listing.category,
            teacherUid: listing.teacherUid,
            teacherName: listing.teacherName,
            duration: listing.duration,
            location: listing.location,
            fee: pricing.monthlyTuitionFee,
            admissionFee: pricing.admissionFee,
            monthlyTuitionFee: pricing.monthlyTuitionFee,
            initialPaymentTotal: amountBdt,
            image: listing.image || '',
            status: 'active',
            paymentStatus: 'demo_paid',
            admissionPaid: true,
            tuitionPaid: true,
            demoPaymentId: payment.demoPaymentId,
            enrolledAt: existingEnrollment?.enrolledAt || now,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      )
    }

    res.status(paymentResult.upsertedCount ? 201 : 200).json({
      success: true,
      alreadyPaid: paymentResult.upsertedCount === 0,
      payment: {
        id: payment.demoPaymentId,
        courseName: payment.courseName,
        amount: payment.amount,
        currency: payment.currency,
        mode: payment.mode,
        admissionFee: payment.admissionFee,
        monthlyTuitionFee: payment.monthlyTuitionFee,
        initialPaymentTotal: payment.initialPaymentTotal,
        billingPeriod: payment.billingPeriod,
      },
    })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'A demo payment for this course is already being recorded. Refresh your classes and try again.', code: 'PAYMENT_ALREADY_RECORDED' })
    }
    next(error)
  }
})

studentRouter.get('/student/assignments', async (req, res, next) => {
  try {
    const database = getDatabase()
    const enrollments = await getEligibleStudentEnrollments(database, req.authUid)
    const listingIds = enrollments.map((enrollment) => enrollment.listingId)
    if (!listingIds.length) return res.json({ assignments: [] })

    const [assignments, submissions] = await Promise.all([
      database.collection('assignments').find({ listingId: { $in: listingIds }, status: 'active' }, {
        projection: { teacherUid: 0 },
      }).sort({ dueDate: 1 }).toArray(),
      database.collection('assignmentSubmissions').find({ studentUid: req.authUid }).toArray(),
    ])
    const submissionsByAssignment = new Map(submissions.map((submission) => [String(submission.assignmentId), submission]))
    res.json({
      assignments: assignments.map((assignment) => ({
        ...assignment,
        submission: submissionsByAssignment.get(String(assignment._id)) || null,
      })),
    })
  } catch (error) {
    next(error)
  }
})

studentRouter.post('/student/assignments/:assignmentId/submissions', async (req, res, next) => {
  try {
    const assignmentId = parseObjectId(req.params.assignmentId, 'assignmentId')
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
    if (!content || content.length > 5000) {
      return res.status(400).json({ message: 'Submission text is required and must be 5,000 characters or fewer.' })
    }

    const database = getDatabase()
    const assignment = await database.collection('assignments').findOne({ _id: assignmentId, status: 'active' })
    if (!assignment) return res.status(404).json({ message: 'Assignment not found.', code: 'ASSIGNMENT_NOT_FOUND' })
    if (isPastDue(assignment.dueDate)) {
      return res.status(400).json({ message: 'The submission deadline has passed.', code: 'ASSIGNMENT_CLOSED' })
    }

    const enrollment = (await getEligibleStudentEnrollments(database, req.authUid))
      .find((item) => String(item.listingId) === String(assignment.listingId))
    if (!enrollment) return res.status(403).json({ message: 'Enroll in this course before submitting its assignment.' })

    const now = new Date()
    const submission = await database.collection('assignmentSubmissions').findOneAndUpdate(
      { assignmentId, studentUid: req.authUid },
      {
        $set: { content, status: 'submitted', updatedAt: now },
        $setOnInsert: { submittedAt: now, studentName: req.user.fullName || req.user.email },
      },
      { upsert: true, returnDocument: 'after' },
    )
    const notificationsSent = await createNotifications(database, [
      { uid: assignment.teacherUid, role: 'teacher' },
    ], {
      type: 'submission',
      title: 'Assignment submitted',
      message: `${req.user.fullName || req.user.email} submitted ${assignment.title}.`,
      href: '/dashboard/listings',
      relatedId: String(assignmentId),
    })
    res.status(201).json({ submission, notificationsSent })
  } catch (error) {
    next(error)
  }
})

studentRouter.get('/student/payments', async (req, res, next) => {
  try {
    const database = getDatabase()
    const [enrollments, payments] = await Promise.all([
      getEligibleStudentEnrollments(database, req.authUid),
      database.collection('studentPayments').find({ studentUid: req.authUid }).sort({ createdAt: -1 }).limit(100).toArray(),
    ])
    res.json({
      courseFees: enrollments.map((enrollment) => ({
        listingId: enrollment.listingId,
        name: enrollment.name,
        teacherName: enrollment.teacherName,
        fee: Number(enrollment.monthlyTuitionFee ?? enrollment.fee) || 0,
        admissionFee: Number(enrollment.admissionFee) || 0,
        monthlyTuitionFee: Number(enrollment.monthlyTuitionFee ?? enrollment.fee) || 0,
        initialPaymentTotal: Number(enrollment.initialPaymentTotal) || 0,
        admissionPaid: Boolean(enrollment.admissionPaid),
        tuitionPaid: Boolean(enrollment.tuitionPaid),
        enrolledAt: enrollment.enrolledAt,
      })),
      payments,
      currency: 'BDT',
    })
  } catch (error) {
    next(error)
  }
})

studentRouter.get('/student/profile', async (req, res) => {
  const { uid, email, fullName } = req.user
  res.json({ profile: { uid, email, fullName } })
})
