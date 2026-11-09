import { Router } from 'express'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'
import { createNotifications, notifyAdmins } from '../services/notification.service.js'
import { parseObjectId } from '../utils/validation.js'
import { computeListingPricing, getPublicListingFilter } from '../services/listing.service.js'
import { streamCourseVideo } from '../services/courseManagement.service.js'

export const studentRouter = Router()

studentRouter.use('/student', verifyToken, requireRole('student'))

const PAID_MODES = ['test', 'live']

export async function getEligibleStudentEnrollments(database, studentUid) {
  const enrollments = await database.collection('studentEnrollments')
    .find({ studentUid, status: 'active' })
    .sort({ createdAt: -1 })
    .toArray()

  // Filter out expired subscription enrollments (lifetime courses have billingExpiresAt: null)
  const activeEnrollments = enrollments.filter((enrollment) => {
    if (enrollment.paymentType === 'ONE_TIME' || !enrollment.billingExpiresAt) return true
    return new Date(enrollment.billingExpiresAt).getTime() > Date.now()
  })
  if (!activeEnrollments.length) return []

  const listingIds = activeEnrollments.map((enrollment) => enrollment.listingId)
  const [listings, paidPayments] = await Promise.all([
    database.collection('listings').find(
      { _id: { $in: listingIds } },
      { projection: { fee: 1, monthlyTuitionFee: 1, admissionFee: 1, pricingType: 1 } },
    ).toArray(),
    database.collection('studentPayments').find({
      studentUid,
      listingId: { $in: listingIds },
      status: 'paid',
    }, { projection: { listingId: 1, status: 1 } }).toArray(),
  ])

  const listingsById = new Map(listings.map((listing) => [String(listing._id), listing]))
  const paidListingIds = new Set(paidPayments.map((p) => String(p.listingId)))

  return activeEnrollments.filter((enrollment) => {
    const listingIdStr = String(enrollment.listingId)
    const currentListing = listingsById.get(listingIdStr)
    const pricing = computeListingPricing(currentListing || { fee: Number(enrollment.fee) || 0 })

    // Free course
    if (pricing.initialPaymentTotal <= 0) return true

    // Disallow refunded or revoked enrollments
    if (enrollment.status !== 'active' || enrollment.paymentStatus === 'refunded') return false

    // Paid course: verified if enrollment has paid status or there is a paid payment
    const isPaidInEnrollment = (enrollment.paymentStatus === 'paid' ||
      enrollment.paymentStatus === 'test_paid') &&
      (enrollment.admissionPaid || enrollment.tuitionPaid)
    return isPaidInEnrollment || paidListingIds.has(listingIdStr)
  })
}

function isPastDue(dueDate) {
  if (!dueDate) return false
  if (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return Date.now() > new Date(`${dueDate}T23:59:59.999Z`).getTime()
  }
  return new Date(dueDate).getTime() < Date.now()
}

studentRouter.get('/student/subscriptions', async (req, res, next) => {
  try {
    if (Object.keys(req.query || {}).length) {
      return res.status(400).json({ message: 'No filters are accepted.', code: 'INVALID_SUBSCRIPTION_FILTER' })
    }
    const database = getDatabase()
    const enrollments = await database.collection('studentEnrollments').find(
      { studentUid: req.authUid, monthlyTuitionFee: { $gt: 0 } },
      {
        projection: {
          studentUid: 0, studentEmail: 0, studentName: 0,
          stripeSubscriptionId: 0, stripeCheckoutSessionId: 0,
        },
      },
    ).sort({ updatedAt: -1 }).limit(100).toArray()

    const listingIds = enrollments.map((e) => e.listingId)
    const listings = listingIds.length
      ? await database.collection('listings').find(
          { _id: { $in: listingIds } },
          { projection: { name: 1, image: 1, teacherName: 1, status: 1 } },
        ).toArray()
      : []
    const listingsById = new Map(listings.map((l) => [String(l._id), l]))
    const now = Date.now()

    res.json({
      subscriptions: enrollments.map((enrollment) => {
        const expiresAt = enrollment.billingExpiresAt
          ? new Date(enrollment.billingExpiresAt).getTime() : 0
        const isActive = expiresAt > now && enrollment.status === 'active'
        const isExpired = enrollment.status === 'active' && expiresAt > 0 && expiresAt <= now
        const isCancelled = Boolean(enrollment.renewalCancelledAt)
        // Payment is due when access expires in ≤7 days or is already expired, and not cancelled
        const daysUntilExpiry = expiresAt > 0 ? Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)) : 0
        const paymentDue = !isCancelled && (isExpired || (isActive && daysUntilExpiry <= 7))
        return {
          listingId: String(enrollment.listingId),
          courseName: listingsById.get(String(enrollment.listingId))?.name || enrollment.name || 'Course',
          image: listingsById.get(String(enrollment.listingId))?.image || enrollment.image || '',
          teacherName: listingsById.get(String(enrollment.listingId))?.teacherName || enrollment.teacherName || '',
          amount: Number(enrollment.monthlyTuitionFee) || 0,
          status: isCancelled ? 'cancelled' : isActive ? 'active' : isExpired ? 'expired' : 'inactive',
          billingExpiresAt: enrollment.billingExpiresAt || null,
          nextPaymentDue: enrollment.nextPaymentDue || enrollment.billingExpiresAt || null,
          paymentDue,
          daysUntilExpiry: isActive ? daysUntilExpiry : 0,
          renewalCancelled: isCancelled,
        }
      }),
    })
  } catch (error) {
    next(error)
  }
})

studentRouter.get('/student/dashboard', async (req, res, next) => {
  try {
    const database = getDatabase()
    const studentUid = req.authUid
    const enrollments = await getEligibleStudentEnrollments(database, studentUid)
    const listingIds = enrollments.map((enrollment) => enrollment.listingId)
    const [listings, assignments, submissions, scheduledSessions, legacyClasses, attendanceRecords, publishedLessons, lessonProgress, supportSessions] = await Promise.all([
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
        ? database.collection('liveSessions').find({
          listingId: { $in: listingIds },
          status: { $nin: ['cancelled', 'removed'] },
        }).sort({ scheduledAt: 1 }).toArray()
        : [],
      listingIds.length
        ? database.collection('classes').find({
          listingId: { $in: listingIds.map(String) },
          classType: 'live',
          status: { $in: ['active', 'upcoming', 'live', 'completed'] },
        }, { projection: { uid: 0, students: 0 } }).sort({ classDate: 1, startTime: 1 }).toArray()
        : [],
      listingIds.length
        ? database.collection('sessionAttendance').find({
          studentUid,
          listingId: { $in: listingIds },
        }).sort({ joinedAt: -1 }).toArray()
        : [],
      listingIds.length
        ? database.collection('courseLessons').find({
          listingId: { $in: listingIds },
          published: true,
          status: { $ne: 'removed' },
        }, { projection: { listingId: 1, title: 1, lessonNumber: 1 } }).sort({ lessonNumber: 1 }).toArray()
        : [],
      listingIds.length
        ? database.collection('studentLessonProgress').find({
          studentUid,
          listingId: { $in: listingIds },
        }).sort({ lastViewedAt: -1 }).toArray()
        : [],
      (() => {
        const teacherUids = [...new Set(enrollments.map((enrollment) => enrollment.teacherUid).filter(Boolean))]
        if (!teacherUids.length) return []
        const today = new Date()
        const endOfWeek = new Date(today)
        endOfWeek.setDate(today.getDate() + 6)
        const dateString = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(date)
        return database.collection('officeHours').find({
          uid: { $in: teacherUids },
          date: { $gte: dateString(today), $lte: dateString(endOfWeek) },
        }).sort({ date: 1, startTime: 1 }).limit(50).toArray()
      })(),
    ])
    const liveClasses = [
      ...scheduledSessions.map((session) => {
        const scheduledAt = session.scheduledAt ? new Date(session.scheduledAt) : null
        const classStatus = session.status === 'completed' || (session.endedAt && new Date(session.endedAt) <= new Date())
          ? 'completed'
          : session.status === 'live' || (session.startedAt && !session.endedAt)
            ? 'ongoing'
            : 'upcoming'
        return {
          _id: session._id,
          listingId: String(session.listingId),
          title: session.title,
          topic: session.title,
          classDate: scheduledAt,
          startTime: scheduledAt ? scheduledAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' }) : '',
          meetUrl: session.meetLink || '',
          status: classStatus,
          source: 'liveSession',
        }
      }),
      ...legacyClasses.map((classItem) => ({
        ...classItem,
        status: classItem.status === 'completed' ? 'completed' : classItem.status === 'live' ? 'ongoing' : 'upcoming',
        source: 'class',
      })),
    ].sort((first, second) => new Date(first.classDate || 0) - new Date(second.classDate || 0))
    const listingsById = new Map(listings.map((listing) => [String(listing._id), listing]))
    const submissionsByAssignment = new Map(submissions.map((submission) => [String(submission.assignmentId), submission]))
    const progressByLesson = new Map(lessonProgress.map((record) => [String(record.lessonId), record]))
    const learningProgress = enrolledCoursesProgress(enrollments, publishedLessons, lessonProgress)
    const teachersByUid = new Map(enrollments.map((enrollment) => [
      enrollment.teacherUid,
      enrollment.teacherName || 'Course teacher',
    ]))
    const supportSchedule = supportSessions.map(({ _id, uid, title, date, startTime, endTime, location }) => ({
      _id,
      title,
      date,
      startTime,
      endTime,
      location: location || '',
      teacherName: teachersByUid.get(uid) || 'Course teacher',
    }))
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
    const sessionsById = new Map(scheduledSessions.map((session) => [String(session._id), session]))
    const latestAttendanceBySession = new Map()
    for (const record of attendanceRecords) {
      const sessionKey = String(record.sessionId)
      if (!latestAttendanceBySession.has(sessionKey)) latestAttendanceBySession.set(sessionKey, record)
    }
    const attendanceHistory = [...latestAttendanceBySession.values()].map((record) => {
      const session = sessionsById.get(String(record.sessionId))
      return {
        listingId: String(record.listingId),
        sessionId: String(record.sessionId),
        courseName: listingsById.get(String(record.listingId))?.name || 'Course',
        topic: session?.title || 'Online class',
        date: session?.scheduledAt || record.joinedAt || record.createdAt,
        status: record.status,
        durationMinutes: Number(record.durationMinutes) || 0,
      }
    })
    const attendanceByListing = new Map()
    for (const record of attendanceHistory) {
      const summary = attendanceByListing.get(record.listingId) || { totalClasses: 0, attendedClasses: 0, absentClasses: 0 }
      summary.totalClasses += 1
      if (record.status === 'present') summary.attendedClasses += 1
      if (record.status === 'absent') summary.absentClasses += 1
      attendanceByListing.set(record.listingId, summary)
    }
    const courseAttendance = enrollments.map((enrollment) => {
      const summary = attendanceByListing.get(String(enrollment.listingId)) || { totalClasses: 0, attendedClasses: 0, absentClasses: 0 }
      return {
        listingId: String(enrollment.listingId),
        courseName: listingsById.get(String(enrollment.listingId))?.name || enrollment.name,
        ...summary,
        attendancePercentage: summary.totalClasses
          ? Math.round((summary.attendedClasses / summary.totalClasses) * 100)
          : 0,
      }
    })

    res.json({
      dashboard: {
        enrollments: enrolledCourses,
        assignments: studentAssignments,
        liveClasses,
        learningProgress,
        supportSessions: supportSchedule,
        attendance: {
          courses: courseAttendance,
          history: attendanceHistory,
          totalClasses: courseAttendance.reduce((total, item) => total + item.totalClasses, 0),
          attendedClasses: courseAttendance.reduce((total, item) => total + item.attendedClasses, 0),
          absentClasses: courseAttendance.reduce((total, item) => total + item.absentClasses, 0),
        },
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

function enrolledCoursesProgress(enrollments, lessons, progressRecords) {
  const progressByLesson = new Map(progressRecords.map((record) => [String(record.lessonId), record]))
  const lessonsByListing = new Map()
  for (const lesson of lessons) {
    const key = String(lesson.listingId)
    const courseLessons = lessonsByListing.get(key) || []
    courseLessons.push(lesson)
    lessonsByListing.set(key, courseLessons)
  }
  const progressByListing = new Map()
  for (const record of progressRecords) {
    const key = String(record.listingId)
    const records = progressByListing.get(key) || []
    records.push(record)
    progressByListing.set(key, records)
  }

  return enrollments.map((enrollment) => {
    const listingId = String(enrollment.listingId)
    const courseLessons = lessonsByListing.get(listingId) || []
    const completedLessons = courseLessons.filter((lesson) => progressByLesson.get(String(lesson._id))?.completed).length
    const lastProgress = (progressByListing.get(listingId) || [])
      .filter((record) => record.lastViewedAt)
      .sort((first, second) => new Date(second.lastViewedAt) - new Date(first.lastViewedAt))[0]
    const lastViewedLesson = lastProgress
      ? courseLessons.find((lesson) => String(lesson._id) === String(lastProgress.lessonId))
      : null
    const currentLesson = (lastViewedLesson && !progressByLesson.get(String(lastViewedLesson._id))?.completed
      ? lastViewedLesson
      : courseLessons.find((lesson) => !progressByLesson.get(String(lesson._id))?.completed)) || lastViewedLesson || courseLessons[0]
    return {
      listingId,
      totalLessons: courseLessons.length,
      completedLessons,
      progressPercent: courseLessons.length ? Math.round((completedLessons / courseLessons.length) * 100) : 0,
      currentLesson: currentLesson ? { _id: currentLesson._id, title: currentLesson.title } : null,
    }
  })
}

async function getEnrolledLearningCourse(database, studentUid, listingId) {
  const eligibleEnrollments = await getEligibleStudentEnrollments(database, studentUid)
  const enrollment = eligibleEnrollments.find((item) => String(item.listingId) === String(listingId))
  if (!enrollment) {
    const error = new Error('You must be enrolled in this course to access its lessons.')
    error.status = 403
    error.code = 'COURSE_ENROLLMENT_REQUIRED'
    throw error
  }

  const listing = await database.collection('listings').findOne({
    _id: listingId,
    status: { $ne: 'removed' },
    isBanned: { $ne: true },
  }, {
    projection: { teacherUid: 0, platformId: 0, removedAt: 0, removedBy: 0 },
  })
  if (!listing) {
    const error = new Error('This course is not currently available.')
    error.status = 404
    error.code = 'COURSE_UNAVAILABLE'
    throw error
  }
  return { listing, enrollment }
}

studentRouter.get('/student/courses/:listingId/learning', async (req, res, next) => {
  try {
    const listingId = parseObjectId(req.params.listingId, 'listingId')
    const database = getDatabase()
    const { listing } = await getEnrolledLearningCourse(database, req.authUid, listingId)
    const [modules, lessons, progress, completion] = await Promise.all([
      database.collection('courseModules').find({ listingId, status: { $ne: 'removed' } }, {
        projection: { teacherUid: 0, removedAt: 0, removedBy: 0 },
      }).sort({ order: 1, createdAt: 1 }).toArray(),
      database.collection('courseLessons').find({
        listingId,
        published: true,
        status: { $ne: 'removed' },
      }, {
        projection: { teacherUid: 0, views: 0, removedAt: 0, removedBy: 0 },
      }).sort({ lessonNumber: 1, createdAt: 1 }).toArray(),
      database.collection('studentLessonProgress').find({ studentUid: req.authUid, listingId }).toArray(),
      database.collection('studentCourseCompletions').findOne({ studentUid: req.authUid, listingId }),
    ])
    const lessonIds = new Set(lessons.map((lesson) => String(lesson._id)))
    const safeProgress = progress.filter((record) => lessonIds.has(String(record.lessonId)))
    const completedCount = safeProgress.filter((record) => record.completed).length
    res.json({
      course: listing,
      modules,
      lessons,
      progress: safeProgress,
      completion,
      summary: {
        totalLessons: lessons.length,
        completedLessons: completedCount,
        progressPercent: lessons.length ? Math.round((completedCount / lessons.length) * 100) : 0,
      },
    })
  } catch (error) {
    next(error)
  }
})

studentRouter.get('/student/courses/:listingId/videos/:videoId', async (req, res, next) => {
  try {
    const listingId = parseObjectId(req.params.listingId, 'listingId')
    const database = getDatabase()
    await getEnrolledLearningCourse(database, req.authUid, listingId)
    const lesson = await database.collection('courseLessons').findOne({
      listingId,
      fileId: req.params.videoId,
      published: true,
      status: { $ne: 'removed' },
    }, { projection: { _id: 1 } })
    if (!lesson) return res.status(404).json({ message: 'Published course video not found.', code: 'VIDEO_NOT_FOUND' })
    await streamCourseVideo({
      res,
      listingId: String(listingId),
      videoId: req.params.videoId,
    })
  } catch (error) {
    next(error)
  }
})

studentRouter.patch('/student/courses/:listingId/lessons/:lessonId/progress', async (req, res, next) => {
  try {
    const listingId = parseObjectId(req.params.listingId, 'listingId')
    const lessonId = parseObjectId(req.params.lessonId, 'lessonId')
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some((key) => !['completed', 'bookmarked', 'positionSeconds'].includes(key)) ||
        !Object.keys(body).length ||
        (body.completed !== undefined && typeof body.completed !== 'boolean') ||
        (body.bookmarked !== undefined && typeof body.bookmarked !== 'boolean') ||
        (body.positionSeconds !== undefined && (!Number.isFinite(body.positionSeconds) || body.positionSeconds < 0 || body.positionSeconds > 86400))) {
      return res.status(400).json({ message: 'Provide valid lesson progress fields.', code: 'INVALID_LESSON_PROGRESS' })
    }
    const database = getDatabase()
    await getEnrolledLearningCourse(database, req.authUid, listingId)
    const lesson = await database.collection('courseLessons').findOne({
      _id: lessonId,
      listingId,
      published: true,
      status: { $ne: 'removed' },
    }, { projection: { _id: 1 } })
    if (!lesson) return res.status(404).json({ message: 'Published lesson not found.', code: 'LESSON_NOT_FOUND' })

    const now = new Date()
    const updates = { updatedAt: now, lastViewedAt: now }
    if (body.completed !== undefined) updates.completed = body.completed
    if (body.bookmarked !== undefined) updates.bookmarked = body.bookmarked
    if (body.positionSeconds !== undefined) updates.positionSeconds = body.positionSeconds
    await database.collection('studentLessonProgress').updateOne(
      { studentUid: req.authUid, listingId, lessonId },
      {
        $set: updates,
        $setOnInsert: { studentUid: req.authUid, listingId, lessonId, createdAt: now },
      },
      { upsert: true },
    )
    res.json({ progress: await database.collection('studentLessonProgress').findOne({ studentUid: req.authUid, listingId, lessonId }) })
  } catch (error) {
    next(error)
  }
})

studentRouter.post('/student/courses/:listingId/complete', async (req, res, next) => {
  try {
    const listingId = parseObjectId(req.params.listingId, 'listingId')
    const database = getDatabase()
    await getEnrolledLearningCourse(database, req.authUid, listingId)
    const lessons = await database.collection('courseLessons').find({
      listingId,
      published: true,
      status: { $ne: 'removed' },
    }, { projection: { _id: 1 } }).toArray()
    const completedCount = lessons.length
      ? await database.collection('studentLessonProgress').countDocuments({
        studentUid: req.authUid,
        listingId,
        lessonId: { $in: lessons.map((lesson) => lesson._id) },
        completed: true,
      })
      : 0
    if (!lessons.length || completedCount !== lessons.length) {
      return res.status(409).json({
        message: 'Complete every published lesson before marking this course complete.',
        code: 'COURSE_LESSONS_INCOMPLETE',
      })
    }
    const now = new Date()
    await database.collection('studentCourseCompletions').updateOne(
      { studentUid: req.authUid, listingId },
      { $set: { completedAt: now }, $setOnInsert: { studentUid: req.authUid, listingId, createdAt: now } },
      { upsert: true },
    )
    res.json({ completed: true, completedAt: now })
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
      ...getPublicListingFilter(),
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
        $or: [
          { recurringTuition: { $ne: true } },
          { billingExpiresAt: { $gt: new Date() } },
        ],
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
              paymentStatus: paidPayment.mode === 'live' ? 'stripe_paid' : 'stripe_test_paid',
              stripeCheckoutSessionId: paidPayment.stripeCheckoutSessionId || null,
              stripePaymentId: paidPayment.providerTransactionId || paidPayment.providerPaymentId || null,
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
        paymentStatus: paidPayment.mode === 'live' ? 'stripe_paid' : 'stripe_test_paid',
        stripeCheckoutSessionId: paidPayment.stripeCheckoutSessionId || null,
        stripePaymentId: paidPayment.providerTransactionId || paidPayment.providerPaymentId || null,
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
    const [enrollments, payments, paymentTotals] = await Promise.all([
      getEligibleStudentEnrollments(database, req.authUid),
      database.collection('studentPayments').find({
        studentUid: req.authUid,
        gateway: 'stripe',
        mode: { $in: ['test', 'live'] },
        isSample: { $ne: true },
      }, {
        projection: {
          amount: 1, listingId: 1, courseName: 1, teacherName: 1,
          billingPeriod: 1, initialPaymentTotal: 1, mode: 1, gateway: 1,
          status: 1, currency: 1, createdAt: 1, paidAt: 1,
          refundedAmount: 1, paymentMethod: 1, paymentType: 1,
        },
      }).sort({ createdAt: -1 }).limit(100).toArray(),
      database.collection('studentPayments').aggregate([
        { $match: { studentUid: req.authUid, gateway: 'stripe', mode: { $in: ['test', 'live'] }, isSample: { $ne: true } } },
        { $group: {
          _id: null,
          paidTotal: {
            $sum: {
              $cond: [
                { $and: [{ $in: ['$status', ['paid', 'refunded']] }, { $eq: ['$mode', 'live'] }, { $eq: ['$currency', 'BDT'] }] },
                { $subtract: ['$amount', { $ifNull: ['$refundedAmount', 0] }] },
                0,
              ],
            },
          },
          testTotal: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$status', 'paid'] }, { $eq: ['$mode', 'test'] }] },
                '$amount',
                0,
              ],
            },
          },
        } },
      ]).toArray(),
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
      paidTotal: Number(paymentTotals[0]?.paidTotal) || 0,
      testTotal: Number(paymentTotals[0]?.testTotal) || 0,
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
