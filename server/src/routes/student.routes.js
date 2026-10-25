import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'
import { parseObjectId } from '../utils/validation.js'

export const studentRouter = Router()

studentRouter.use('/student', verifyToken, requireRole('student'))

async function getEligibleStudentEnrollments(database, studentUid) {
  const enrollments = await database.collection('studentEnrollments')
    .find({ studentUid, status: 'active' })
    .sort({ createdAt: -1 })
    .toArray()
  if (!enrollments.length) return []

  const listingIds = enrollments.map((enrollment) => enrollment.listingId)
  const [listings, payments] = await Promise.all([
    database.collection('listings').find({ _id: { $in: listingIds } }, { projection: { fee: 1 } }).toArray(),
    database.collection('studentPayments').find({
      studentUid,
      listingId: { $in: listingIds },
      status: 'paid',
      mode: { $in: ['demo', 'test'] },
    }, { projection: { listingId: 1 } }).toArray(),
  ])
  const listingsById = new Map(listings.map((listing) => [String(listing._id), listing]))
  const paidListingIds = new Set(payments.map((payment) => String(payment.listingId)))

  return enrollments.filter((enrollment) => {
    const currentListing = listingsById.get(String(enrollment.listingId))
    const fee = Number(currentListing?.fee ?? enrollment.fee) || 0
    return fee <= 0 || ['paid', 'demo_paid', 'test_paid'].includes(enrollment.paymentStatus) || paidListingIds.has(String(enrollment.listingId))
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
    const [listings, assignments, submissions] = await Promise.all([
      listingIds.length
        ? database.collection('listings').find({ _id: { $in: listingIds }, status: { $ne: 'removed' } }, {
          projection: { teacherUid: 0, platformId: 0, removedAt: 0, removedBy: 0 },
        }).toArray()
        : [],
      listingIds.length
        ? database.collection('assignments').find({ listingId: { $in: listingIds }, status: 'active' }, {
          projection: { teacherUid: 0 },
        }).sort({ dueDate: 1 }).toArray()
        : [],
      database.collection('assignmentSubmissions').find({ studentUid }).toArray(),
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
      status: { $ne: 'removed' },
    })
    if (!listing) {
      return res.status(404).json({ message: 'This course is no longer available.', code: 'LISTING_NOT_FOUND' })
    }

    const enrollments = database.collection('studentEnrollments')
    const existing = await enrollments.findOne({ studentUid: req.authUid, listingId })
    const paidPayment = Number(listing.fee) > 0
      ? await database.collection('studentPayments').findOne({
        studentUid: req.authUid,
        listingId,
        status: 'paid',
        mode: { $in: ['demo', 'test'] },
      })
      : null
    if (Number(listing.fee) > 0 && !paidPayment) {
      return res.status(402).json({
        message: 'Payment is required before enrolling in this course. Complete the BDT demo checkout first.',
        code: 'PAYMENT_REQUIRED',
      })
    }
    if (existing) {
      if (paidPayment) {
        await enrollments.updateOne(
          { _id: existing._id },
          { $set: { status: 'active', paymentStatus: paidPayment.mode === 'demo' ? 'demo_paid' : 'test_paid', demoPaymentId: paidPayment.demoPaymentId || null, stripeCheckoutSessionId: paidPayment.stripeCheckoutSessionId || null, updatedAt: new Date() } },
        )
        return res.json({ enrollment: existing, alreadyEnrolled: true })
      }
      if (Number(listing.fee) <= 0) return res.json({ enrollment: existing, alreadyEnrolled: true })
      return res.status(402).json({ message: 'This course requires payment before enrollment.', code: 'PAYMENT_REQUIRED' })
    }

    const now = new Date()
    const enrollment = {
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
      fee: Number(listing.fee) || 0,
      image: listing.image || '',
      status: 'active',
      ...(paidPayment ? {
        paymentStatus: paidPayment.mode === 'demo' ? 'demo_paid' : 'test_paid',
        demoPaymentId: paidPayment.demoPaymentId || null,
        stripeCheckoutSessionId: paidPayment.stripeCheckoutSessionId || null,
      } : {}),
      enrolledAt: now,
      createdAt: now,
      updatedAt: now,
    }
    const result = await enrollments.insertOne(enrollment)
    res.status(201).json({ enrollment: { _id: result.insertedId, ...enrollment } })
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

    const feeBdt = Number(listing.fee)
    if (feeBdt <= 0) return res.status(400).json({ message: 'Free courses do not require checkout.', code: 'FREE_COURSE' })
    if (!Number.isFinite(feeBdt)) return res.status(400).json({ message: 'This course has an invalid fee.', code: 'INVALID_COURSE_FEE' })

    const enrollments = database.collection('studentEnrollments')
    const existingEnrollment = await enrollments.findOne({ studentUid: req.authUid, listingId, status: 'active' })
    const payments = database.collection('studentPayments')
    let payment = await payments.findOne({
      studentUid: req.authUid,
      listingId,
      status: 'paid',
      mode: 'demo',
    })
    const now = new Date()
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
          amount: feeBdt,
          currency: 'BDT',
          status: 'paid',
          mode: 'demo',
          demoOnly: true,
          paidAt: now,
          createdAt: now,
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
            fee: feeBdt,
            image: listing.image || '',
            status: 'active',
            paymentStatus: 'demo_paid',
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
    res.status(201).json({ submission })
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
        fee: Number(enrollment.fee) || 0,
        enrolledAt: enrollment.enrolledAt,
      })),
      payments,
      paidTotal: payments.filter((payment) => payment.status === 'paid')
        .reduce((total, payment) => total + (Number(payment.amount) || 0), 0),
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
