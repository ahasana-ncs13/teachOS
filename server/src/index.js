import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env') })
dotenv.config()
import cors from 'cors'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { GridFSBucket, ObjectId } from 'mongodb'
import { closeDatabase, connectDatabase, getDatabase } from './db.js'
import { requireRole as requireAuthenticatedRole, verifyToken as verifyFirebaseToken } from './middleware/auth.js'
import { securityHeaders, rateLimiter } from './middleware/security.js'
import { errorHandler } from './middleware/error.js'
import { platformRouter } from './routes/platform.routes.js'
import { userRouter } from './routes/user.routes.js'
import { listingRouter } from './routes/listing.routes.js'
import { studentRouter } from './routes/student.routes.js'
import { courseRouter } from './routes/course.routes.js'
import { courseManagementRouter } from './routes/courseManagement.routes.js'
import { teacherSubscriptionRouter } from './routes/teacherSubscription.routes.js'
import { notificationRouter } from './routes/notification.routes.js'
import { paymentRouter, stripeWebhookRouter } from './routes/payment.routes.js'
import { getTeacherSubscription, createInitialTeacherSubscription } from './services/teacherSubscription.service.js'
import { writeAuditLog } from './services/audit.service.js'
import { startSettlementScheduler, stopSettlementScheduler } from './services/settlementScheduler.service.js'

const app = express()
const port = process.env.PORT || 5000
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID
const firebaseJwkSet = firebaseProjectId
  ? createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'))
  : null
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5174')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
let databaseReady = false

app.use(securityHeaders)
app.use(rateLimiter())
app.use(cors({
  origin: (requestOrigin, callback) => {
    if (!requestOrigin || allowedOrigins.includes(requestOrigin)) return callback(null, true)
    // Vite may select another free port (for example 5175) when its usual
    // development ports are already occupied. Keep this allowance local-only.
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(requestOrigin)) {
      return callback(null, true)
    }
    return callback(new Error(`Origin ${requestOrigin} is not allowed by CORS`))
  },
}))
app.use('/api', stripeWebhookRouter)
app.use(express.json({ limit: '100kb' }))

app.use('/api', async (request, response, next) => {
  if (request.path === '/health' || request.path === '/courses' || request.path === '/users/me' || request.path.startsWith('/notifications') || request.path.startsWith('/platforms') || request.path.startsWith('/admin') || request.path.startsWith('/listings') || request.path.startsWith('/student') || request.path.startsWith('/stripe') || request.path.startsWith('/teacher') || request.path.startsWith('/course-management')) return next()
  const segments = request.path.split('/').filter(Boolean)
  let requestedUid
  try {
    requestedUid = segments[0] === 'users'
      ? request.body?.uid
      : segments[0] === 'actions'
        ? decodeURIComponent(segments[2] || '')
        : decodeURIComponent(segments[1] || '')
  } catch {
    return response.status(400).json({ message: 'Invalid user ID' })
  }

  if (!firebaseJwkSet) {
    return response.status(503).json({ message: 'Set FIREBASE_PROJECT_ID in server/.env to enable authenticated API access' })
  }

  const authorization = request.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) return response.status(401).json({ message: 'Sign in to access this data' })
  try {
    const { payload } = await jwtVerify(authorization.slice('Bearer '.length), firebaseJwkSet, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${firebaseProjectId}`,
      audience: firebaseProjectId,
    })
    if (requestedUid && requestedUid !== payload.sub) {
      return response.status(403).json({ message: 'You cannot access another user’s data.', code: 'USER_ID_MISMATCH' })
    }
    request.authUid = payload.sub
    request.authEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null
    request.authEmailVerified = payload.email_verified === true

    const isProfileRegistration = request.method === 'POST' && request.path === '/users'
    const user = await getDatabase().collection('users').findOne({ uid: payload.sub })
    if (!user && !isProfileRegistration) {
      return response.status(403).json({ message: 'Your account profile is not set up yet.', code: 'USER_PROFILE_REQUIRED' })
    }
    const canonicalRole = user?.role === 'superAdmin' ? 'admin' : user?.role
    if (user && !['admin', 'teacher', 'student'].includes(canonicalRole)) {
      return response.status(403).json({ message: 'Your account has an invalid role.', code: 'INVALID_ACCOUNT_ROLE' })
    }
    if (user?.status === 'removed') {
      return response.status(403).json({ message: 'This user account has been deactivated.', code: 'ACCOUNT_DEACTIVATED' })
    }

    if (user) {
      request.user = {
        uid: user.uid,
        email: user.email,
        role: canonicalRole,
        fullName: user.fullName || user.displayName || '',
        status: user.status || 'active',
      }
    }

    if (request.user?.role === 'teacher' && request.method !== 'GET' && request.path !== '/users') {
      const subscription = await getTeacherSubscription(getDatabase(), request.authUid)
      if (subscription.status === 'past_due' || subscription.status === 'suspended') {
        return response.status(402).json({
          message: subscription.status === 'suspended'
            ? 'Your teacher workspace is suspended after three unpaid platform-fee warnings. Settle the balance to restore access.'
            : 'Your income-based platform fee is due. Settle the balance to continue using teacher tools.',
          code: subscription.status === 'suspended' ? 'TEACHER_ACCOUNT_SUSPENDED' : 'TEACHER_SUBSCRIPTION_PAYMENT_REQUIRED',
          subscription,
        })
      }
    }

    if (!isProfileRegistration && canonicalRole !== 'teacher' && canonicalRole !== 'admin') {
      return response.status(403).json({ message: 'This workspace is available to teachers.', code: 'ROLE_FORBIDDEN' })
    }
    return next()
  } catch (error) {
    console.error('Unable to verify Firebase ID token:', error.message)
    return response.status(401).json({ message: 'Your session is invalid or expired. Please sign in again.' })
  }
})

const collections = ['users', 'teacherDashboards', 'classes', 'students', 'attendanceRecords', 'lessonSessions', 'payments', 'payoutRequests', 'messages', 'officeHours', 'resources', 'notifications', 'platforms', 'auditLogs', 'courses', 'listings', 'studentEnrollments', 'assignments', 'assignmentSubmissions', 'studentPayments', 'studentLessonProgress', 'studentCourseCompletions', 'bkashPayments', 'stripePayments', 'courseModules', 'courseLessons', 'liveSessions', 'sessionAttendance', 'teacherSubscriptionInvoices', 'teacherSubscriptionPayments', 'googleMeetOAuthStates', 'revenueTransactions', 'teacherWallets', 'monthlyAdminSettlements', 'adminCommissionLedgers', 'teacherPendingLedgers', 'teacherAvailableLedgers', 'platformRevenues']

async function ensureTeacherData(uid) {
  const database = getDatabase()
  const dashboards = database.collection('teacherDashboards')
  const now = new Date()
  await dashboards.updateOne(
    { uid },
    { $setOnInsert: { uid, createdAt: now, updatedAt: now } },
    { upsert: true },
  )
  const [dashboard, classList] = await Promise.all([
    dashboards.findOne({ uid }),
    database.collection('classes').find({ uid, isSample: { $ne: true } }).sort({ createdAt: -1 }).toArray(),
  ])
  return { dashboard, classList }
}

function validUid(uid) {
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 256
}

async function getTeacherLiveEarnings(database, uid) {
  const [summary] = await database.collection('studentPayments').aggregate([
    { $match: { teacherUid: uid, gateway: { $in: ['stripe', 'bkash'] }, status: { $in: ['paid', 'refunded'] }, currency: 'BDT' } },
    { $group: {
      _id: null,
      gross: { $sum: '$amount' },
      commission: { $sum: { $max: [0, { $subtract: [{ $ifNull: ['$platformCommissionAmount', { $multiply: ['$amount', 0.05] }] }, { $ifNull: ['$commissionReversedAmount', 0] }] }] } },
      net: { $sum: { $max: [0, { $subtract: [{ $ifNull: ['$teacherNetAmount', { $subtract: ['$amount', { $multiply: ['$amount', 0.05] }] }] }, { $ifNull: ['$teacherRevenueReversedAmount', 0] }] }] } },
      refunded: { $sum: { $ifNull: ['$refundedAmount', 0] } },
      transactions: { $sum: 1 },
    } },
  ]).toArray()
  return {
    gross: summary?.gross || 0,
    commission: summary?.commission || 0,
    net: summary?.net || 0,
    refunded: summary?.refunded || 0,
    transactions: summary?.transactions || 0,
  }
}

function nextScheduledPayout(settings) {
  if (!settings?.enabled || !settings.monthlyAmount) return null
  return `Monthly on day ${settings.dayOfMonth}`
}

async function validateClassMeeting(database, uid, values) {
  const classType = values.classType
  if (classType !== 'live') return { error: 'TeachOS supports online live classes only.' }

  const listingId = typeof values.listingId === 'string' ? values.listingId.trim() : ''
  const meetUrl = typeof values.meetUrl === 'string' ? values.meetUrl.trim() : ''
  const classDate = typeof values.classDate === 'string' ? values.classDate.trim() : ''
  if (!ObjectId.isValid(listingId)) return { error: 'Select one of your courses to notify enrolled students.' }
  if (!/^https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?.*)?$/i.test(meetUrl) || meetUrl.length > 2048) {
    return { error: 'Enter a valid Google Meet link (https://meet.google.com/...).' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(classDate) || Number.isNaN(Date.parse(`${classDate}T00:00:00Z`))) {
    return { error: 'Choose a valid date for the live class.' }
  }

  const listing = await database.collection('listings').findOne({
    _id: new ObjectId(listingId),
    teacherUid: uid,
    status: 'active',
  })
  if (!listing) return { error: 'Select a course that belongs to your teacher account.' }
  return { classType, listingId: String(listing._id), meetUrl, classDate, listing }
}

app.post('/api/users', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid, email, displayName, fullName, role, photoURL, provider, emailVerified, metadata } = request.body || {}
  if (typeof uid !== 'string' || !uid || typeof email !== 'string' || email.length > 254 ||
      (displayName !== undefined && typeof displayName !== 'string') ||
      (fullName !== undefined && typeof fullName !== 'string') ||
      (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))) ||
      !role || uid !== request.authUid) {
    return response.status(400).json({ message: 'uid, email, and role are required' })
  }

  try {
    const users = getDatabase().collection('users')
    const existingUser = await users.findOne({ uid })
    const requestedRole = role || 'student'
    if (!['admin', 'teacher', 'student'].includes(requestedRole)) {
      return response.status(400).json({ message: 'Invalid role' })
    }
    if (!existingUser && requestedRole === 'admin') {
      return response.status(403).json({ message: 'Admin accounts must be provisioned by TeachOS.', code: 'ADMIN_PROVISIONING_REQUIRED' })
    }
    const verifiedEmail = request.authEmail
    if (!verifiedEmail || verifiedEmail !== String(email).trim().toLowerCase()) {
      return response.status(403).json({ message: 'The profile email must match the signed-in account.', code: 'EMAIL_MISMATCH' })
    }
    const now = new Date()
    const profile = {
      uid,
      email: existingUser?.email || verifiedEmail,
      displayName: displayName || fullName || '',
      fullName: fullName || displayName || '',
      role: existingUser?.role === 'superAdmin' ? 'admin' : existingUser?.role || requestedRole,
      photoURL: photoURL || null,
      provider: provider || 'password',
      emailVerified: request.authEmailVerified ?? Boolean(emailVerified),
      metadata: metadata || {},
      updatedAt: now,
      ...(!existingUser && requestedRole === 'teacher'
        ? { subscription: createInitialTeacherSubscription(now) }
        : existingUser?.subscription ? { subscription: existingUser.subscription } : {}),
    }
    await users.updateOne(
      { uid },
      { $set: profile, $setOnInsert: { createdAt: now } },
      { upsert: true },
    )
    if (!existingUser && profile.role === 'teacher') await ensureTeacherData(uid)
    const savedUser = await users.findOne({ uid }, { projection: { _id: 0 } })
    response.status(200).json({ user: savedUser })
  } catch (error) {
    console.error('Unable to save user:', error.message)
    response.status(500).json({ message: 'Unable to save user profile' })
  }
})

app.get('/api/dashboard/:uid', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  if (!validUid(uid)) return response.status(400).json({ message: 'A valid user ID is required' })

  try {
    const db = getDatabase()
    const { classList } = await ensureTeacherData(uid)
    const teacherListings = await db.collection('listings')
      .find({ teacherUid: uid, status: { $ne: 'removed' } })
      .sort({ createdAt: -1 })
      .toArray()
    const listingIds = teacherListings.map((l) => l._id)

    const [
      enrollments,
      legacyStudents,
      earnings,
      recentTransactions,
      reservedPayouts,
      pendingPayouts,
      attendanceRecords,
      sessionAttendanceList,
      lessons,
      messages,
      officeHours,
      resources,
      payouts,
      payoutRequestCount,
    ] = await Promise.all([
      db.collection('studentEnrollments').find({
        $or: [
          { teacherUid: uid },
          ...(listingIds.length ? [{ listingId: { $in: listingIds } }] : []),
        ],
        status: 'active',
      }).sort({ enrolledAt: -1, createdAt: -1 }).toArray(),
      db.collection('students').find({ uid, isSample: { $ne: true } }).toArray(),
      getTeacherLiveEarnings(db, uid),
      db.collection('studentPayments').find({
        teacherUid: uid,
        gateway: { $in: ['stripe', 'bkash'] },
        status: { $in: ['paid', 'refunded'] },
        currency: 'BDT',
      }).sort({ paidAt: -1 }).limit(5).toArray(),
      db.collection('payoutRequests').aggregate([
        { $match: { uid, status: { $ne: 'rejected' }, isSample: { $ne: true } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).toArray(),
      db.collection('payoutRequests').aggregate([
        { $match: { uid, status: 'pending', isSample: { $ne: true } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).toArray(),
      db.collection('attendanceRecords').countDocuments({ uid }),
      listingIds.length ? db.collection('sessionAttendance').find({ listingId: { $in: listingIds } }).toArray() : [],
      db.collection('lessonSessions').find({ uid }).sort({ startedAt: -1 }).limit(100).toArray(),
      db.collection('messages').countDocuments({ uid }),
      db.collection('officeHours').countDocuments({ uid }),
      db.collection('resources').countDocuments({ uid }),
      db.collection('payoutRequests').find({ uid, status: 'paid', isSample: { $ne: true } }).sort({ createdAt: -1 }).limit(5).toArray(),
      db.collection('payoutRequests').countDocuments({ uid, isSample: { $ne: true } }),
    ])

    const totalEarnings = earnings.net
    const pendingPayout = pendingPayouts[0]?.total || 0
    const teacher = await db.collection('users').findOne({ uid }, { projection: { payoutSettings: 1 } })

    const enrollmentsByListing = new Map()
    for (const e of enrollments) {
      const k = String(e.listingId)
      if (!enrollmentsByListing.has(k)) enrollmentsByListing.set(k, [])
      enrollmentsByListing.get(k).push(e)
    }

    const todayStr = new Date().toISOString().slice(0, 10)
    const todayAttendanceMap = new Map()
    for (const sa of sessionAttendanceList) {
      const saDate = sa.dateStr || (sa.joinedAt ? new Date(sa.joinedAt).toISOString().slice(0, 10) : '')
      if (saDate === todayStr && sa.studentUid) {
        todayAttendanceMap.set(sa.studentUid, sa.status)
      }
    }

    const mappedListings = teacherListings.map((listing) => {
      const listingKey = String(listing._id)
      const listingStudents = enrollmentsByListing.get(listingKey) || []
      const scheduleDays = Array.isArray(listing.days) && listing.days.length
        ? listing.days.join(', ')
        : (listing.schedule || 'Weekly')
      const startTime = listing.startTime || '10:00 AM'
      const endTime = listing.endTime || '11:00 AM'
      return {
        id: listingKey,
        title: listing.name,
        courseName: listing.courseName || listing.name,
        schedule: scheduleDays,
        startTime,
        endTime,
        time: `${startTime} – ${endTime}`,
        period: scheduleDays,
        location: listing.location || 'Google Meet / Online',
        department: listing.category || 'Online Course',
        status: listing.status === 'active' ? 'active' : (listing.status || 'active'),
        enrolled: listingStudents.length,
        students: listingStudents.map((e) => {
          const studentId = e.studentUid || String(e._id)
          return {
            id: studentId,
            name: e.studentName || 'Student',
            email: e.studentEmail || '',
            status: todayAttendanceMap.get(studentId) || '',
          }
        }),
        isListing: true,
      }
    })

    const legacyClasses = classList.map(({ _id, uid: _uid, createdAt, updatedAt, ...item }) => item)
    const classes = [...mappedListings, ...legacyClasses.filter((c) => !mappedListings.some((m) => m.id === c.id))]

    const uniqueStudentKeys = new Set()
    for (const e of enrollments) {
      if (e.studentUid) uniqueStudentKeys.add(e.studentUid)
      else if (e.studentEmail) uniqueStudentKeys.add(e.studentEmail)
      else uniqueStudentKeys.add(String(e._id))
    }
    for (const s of legacyStudents) {
      if (s.email) uniqueStudentKeys.add(s.email)
      else if (s.studentId) uniqueStudentKeys.add(s.studentId)
      else uniqueStudentKeys.add(s.id || String(s._id))
    }
    const totalStudents = Math.max(uniqueStudentKeys.size, legacyStudents.length, enrollments.length)
    const totalAttendanceRecords = attendanceRecords + sessionAttendanceList.length
    const activeClassesCount = classes.filter((item) => item.status === 'active' || item.status === 'live').length

    response.json({
      dashboard: {
        classes,
        attendanceClassId: classes[0]?.id || null,
        earnings: {
          total: totalEarnings,
          gross: earnings.gross,
          commission: earnings.commission,
          refunded: earnings.refunded,
          transactions: earnings.transactions,
          available: Math.max(0, totalEarnings - (reservedPayouts[0]?.total || 0)),
          pending: pendingPayout,
          currency: 'BDT',
          nextPayout: nextScheduledPayout(teacher?.payoutSettings),
          payouts: payouts.map(({ amount, currency, createdAt }) => ({ amount, currency: currency || 'BDT', date: createdAt })),
          recentTransactions: recentTransactions.map((item) => ({
            paymentId: item.paymentId,
            courseName: item.courseName || 'Course payment',
            grossAmount: item.amount,
            commissionAmount: Math.max(0, (Number(item.platformCommissionAmount) || 0) - (Number(item.commissionReversedAmount) || 0)),
            teacherRevenue: Math.max(0, (Number(item.teacherNetAmount) || 0) - (Number(item.teacherRevenueReversedAmount) || 0)),
            refundedAmount: Number(item.refundedAmount) || 0,
            paymentMethod: item.paymentMethod || item.gateway,
            paidAt: item.paidAt,
          })),
        },
        roster: {
          totalStudents,
          activeClasses: activeClassesCount,
        },
        stats: {
          totalClasses: classes.length,
          totalStudents,
          attendanceRecords: totalAttendanceRecords,
          todaysLessons: activeClassesCount,
          completedLessons: lessons.filter((item) => item.status === 'completed').length,
          payoutRequests: payoutRequestCount,
          messages,
          officeHours,
          resources,
        },
      },
    })
  } catch (error) {
    console.error('Unable to load teacher dashboard:', error.message)
    response.status(500).json({ message: 'Unable to load teacher dashboard' })
  }
})

app.put('/api/dashboard/:uid/attendance', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  const { classId, attendance, date = new Date().toISOString().slice(0, 10) } = request.body || {}
  if (!validUid(uid) || typeof classId !== 'string' || classId.length > 256 || !Array.isArray(attendance) || attendance.length > 100 ||
      typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return response.status(400).json({ message: 'A valid user ID, class ID, date, and attendance list are required' })
  }
  if (attendance.some((record) => !record || typeof record !== 'object' || typeof record.studentId !== 'string' || !['present', 'absent', 'late', 'excused', null].includes(record.status))) {
    return response.status(400).json({ message: 'Each attendance record must have a student ID and a valid status' })
  }

  try {
    const db = getDatabase()
    const updatedAt = new Date()

    let listing = null
    if (ObjectId.isValid(classId)) {
      listing = await db.collection('listings').findOne({
        _id: new ObjectId(classId),
        teacherUid: uid,
        status: { $ne: 'removed' },
      })
    }

    const { classList } = await ensureTeacherData(uid)
    const selectedClass = classList.find((item) => item.id === classId)

    if (!selectedClass && !listing) {
      return response.status(404).json({ message: 'Class or course listing not found' })
    }

    const submitted = new Map(attendance.map(({ studentId, status }) => [studentId, status]))

    if (listing) {
      const enrollments = await db.collection('studentEnrollments').find({
        listingId: listing._id,
        status: 'active',
      }).toArray()

      const attendanceRecords = db.collection('attendanceRecords')
      const existingRecord = await attendanceRecords.findOne({ uid, classId, date }, { sort: { createdAt: -1 } })
      const record = {
        id: existingRecord?.id || randomUUID(),
        uid,
        classId,
        listingId: listing._id,
        records: [...submitted].map(([studentId, status]) => ({ studentId, status })),
        date,
        createdAt: updatedAt,
      }
      if (existingRecord) await attendanceRecords.updateOne({ _id: existingRecord._id }, { $set: record })
      else await attendanceRecords.insertOne(record)

      const bulkOps = []
      for (const [studentUid, status] of submitted) {
        if (!status) continue
        const studentInfo = enrollments.find((e) => (e.studentUid || String(e._id)) === studentUid)
        bulkOps.push({
          updateOne: {
            filter: {
              listingId: listing._id,
              dateStr: date,
              studentUid,
            },
            update: {
              $set: {
                studentName: studentInfo?.studentName || 'Student',
                studentEmail: studentInfo?.studentEmail || '',
                status,
                joinedAt: new Date(`${date}T10:00:00Z`),
                updatedAt,
              },
              $setOnInsert: {
                listingId: listing._id,
                dateStr: date,
                studentUid,
                createdAt: updatedAt,
              },
            },
            upsert: true,
          },
        })
      }
      if (bulkOps.length) {
        await db.collection('sessionAttendance').bulkWrite(bulkOps)
      }

      return response.json({ message: 'Attendance saved', updatedAt })
    }

    if (submitted.size !== attendance.length || [...submitted.keys()].some((studentId) => !selectedClass.students.some((student) => student.id === studentId))) {
      return response.status(400).json({ message: 'Attendance contains duplicate or unknown students' })
    }
    const updatedStudents = selectedClass.students.map((student) => submitted.has(student.id) ? { ...student, status: submitted.get(student.id) } : student)
    if (date === new Date().toISOString().slice(0, 10)) {
      await db.collection('classes').updateOne({ uid, id: classId }, { $set: { students: updatedStudents, updatedAt } })
    }
    const attendanceRecords = db.collection('attendanceRecords')
    const existingRecord = await attendanceRecords.findOne({ uid, classId, date }, { sort: { createdAt: -1 } })
    const record = {
      id: existingRecord?.id || randomUUID(), uid, classId,
      records: [...submitted].map(([studentId, status]) => ({ studentId, status })),
      date, createdAt: updatedAt,
    }
    if (existingRecord) await attendanceRecords.updateOne({ _id: existingRecord._id }, { $set: record })
    else await attendanceRecords.insertOne(record)
    response.json({ message: 'Attendance saved', updatedAt })
  } catch (error) {
    console.error('Unable to save attendance:', error.message)
    response.status(500).json({ message: 'Unable to save attendance' })
  }
})

app.get('/api/attendance/:uid', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  if (!validUid(uid)) return response.status(400).json({ message: 'A valid user ID is required' })
  try {
    const attendanceRecords = await getDatabase().collection('attendanceRecords')
      .find({ uid })
      .sort({ date: -1, createdAt: -1 })
      .limit(500)
      .project({ _id: 0, uid: 0 })
      .toArray()
    response.json({ attendanceRecords })
  } catch (error) {
    console.error('Unable to load attendance records:', error.message)
    response.status(500).json({ message: 'Unable to load attendance records' })
  }
})

app.get('/api/classes/:uid', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  if (!validUid(uid)) return response.status(400).json({ message: 'A valid user ID is required' })
  try {
    const db = getDatabase()
    const { classList } = await ensureTeacherData(uid)
    const teacherListings = await db.collection('listings')
      .find({ teacherUid: uid, status: { $ne: 'removed' } })
      .sort({ createdAt: -1 })
      .toArray()
    const listingIds = teacherListings.map((l) => l._id)
    const enrollments = listingIds.length
      ? await db.collection('studentEnrollments').find({ listingId: { $in: listingIds }, status: 'active' }).toArray()
      : []
    const enrollmentsByListing = new Map()
    for (const e of enrollments) {
      const k = String(e.listingId)
      enrollmentsByListing.set(k, (enrollmentsByListing.get(k) || 0) + 1)
    }
    const mappedListings = teacherListings.map((listing) => ({
      id: String(listing._id),
      title: listing.name,
      courseName: listing.courseName || listing.name,
      schedule: Array.isArray(listing.days) && listing.days.length ? listing.days.join(', ') : (listing.schedule || 'Weekly'),
      startTime: listing.startTime || '10:00 AM',
      endTime: listing.endTime || '11:00 AM',
      location: listing.location || 'Google Meet / Online',
      department: listing.category || 'General',
      enrolled: enrollmentsByListing.get(String(listing._id)) || 0,
      status: listing.status === 'active' ? 'active' : (listing.status || 'active'),
      isListing: true,
    }))
    const legacyClasses = classList.map(({ _id, uid: _uid, ...item }) => item)
    const classes = [...mappedListings, ...legacyClasses.filter((c) => !mappedListings.some((m) => m.id === c.id))]
    response.json({ classes })
  } catch (error) {
    console.error('Unable to load classes:', error.message)
    response.status(500).json({ message: 'Unable to load classes' })
  }
})

app.post('/api/classes/:uid', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  const { title, schedule, startTime, endTime, location, department, status } = request.body || {}
  if (!validUid(uid) || typeof title !== 'string' || !title.trim() || title.trim().length > 120) {
    return response.status(400).json({ message: 'A user ID and class title (up to 120 characters) are required' })
  }
  if ([schedule, startTime, endTime, location, department].some((value) => typeof value !== 'string' || value.trim().length > 120) ||
      !['active', 'upcoming', 'completed'].includes(status || 'active')) {
    return response.status(400).json({ message: 'Provide valid schedule, times, location, department, and status values' })
  }
  try {
    const database = getDatabase()
    const meeting = await validateClassMeeting(database, uid, request.body || {})
    if (meeting.error) return response.status(400).json({ message: meeting.error })
    const now = new Date()
    const record = {
      id: randomUUID(), uid, title: title.trim(), schedule: schedule.trim(), startTime: startTime.trim(),
      endTime: endTime.trim(), time: startTime.trim(), period: '', location: location.trim(),
      department: department.trim(), status: status || 'active', enrolled: 0, students: [],
      classType: meeting.classType, listingId: meeting.listingId, meetUrl: meeting.meetUrl, classDate: meeting.classDate,
      createdAt: now, updatedAt: now,
    }
    await database.collection('classes').insertOne(record)
    const { _id, ...savedClass } = record
    response.status(201).json({ class: savedClass })
  } catch (error) {
    console.error('Unable to create class:', error.message)
    response.status(500).json({ message: 'Unable to create class' })
  }
})

app.put('/api/classes/:uid/:classId', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid, classId } = request.params
  const fields = ['title', 'schedule', 'startTime', 'endTime', 'location', 'department', 'status', 'classType', 'listingId', 'meetUrl', 'classDate']
  const updates = request.body || {}
  if (!validUid(uid) || !classId || classId.length > 256 || !Object.keys(updates).length ||
      Object.keys(updates).some((field) => !fields.includes(field))) {
    return response.status(400).json({ message: 'Provide a class ID and valid fields to update' })
  }
  if (Object.entries(updates).some(([field, value]) => typeof value !== 'string' || (['title', 'schedule', 'startTime', 'endTime', 'location', 'department', 'status'].includes(field) && !value.trim()) || value.length > (field === 'meetUrl' ? 2048 : 120)) ||
      (updates.status && !['active', 'upcoming', 'completed'].includes(updates.status))) {
    return response.status(400).json({ message: 'Class fields must contain valid text and status values' })
  }
  try {
    const database = getDatabase()
    const existing = await database.collection('classes').findOne({ uid, id: classId })
    if (!existing) return response.status(404).json({ message: 'Class not found' })
    const normalized = Object.fromEntries(Object.entries(updates).map(([field, value]) => [field, value.trim()]))
    const merged = { ...existing, ...normalized }
    const meeting = await validateClassMeeting(database, uid, merged)
    if (meeting.error) return response.status(400).json({ message: meeting.error })
    delete meeting.listing
    const updatedAt = new Date()
    const result = await database.collection('classes').findOneAndUpdate(
      { uid, id: classId },
      { $set: { ...normalized, ...meeting, updatedAt } },
      { returnDocument: 'after', projection: { _id: 0, uid: 0 } },
    )
    response.json({ class: result })
  } catch (error) {
    console.error('Unable to update class:', error.message)
    response.status(500).json({ message: 'Unable to update class' })
  }
})

app.get('/api/students/:uid', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  if (!validUid(uid)) return response.status(400).json({ message: 'A valid user ID is required' })
  try {
    await ensureTeacherData(uid)
    const db = getDatabase()

    const teacherListings = await db.collection('listings')
      .find({ teacherUid: uid, status: { $ne: 'removed' } })
      .toArray()
    const listingIds = teacherListings.map((l) => l._id)

    const [enrollments, legacyStudents, sessionAttendance, legacyAttendance] = await Promise.all([
      db.collection('studentEnrollments').find({
        $or: [
          { teacherUid: uid },
          ...(listingIds.length ? [{ listingId: { $in: listingIds } }] : []),
        ],
        status: 'active',
      }).sort({ enrolledAt: -1, createdAt: -1 }).toArray(),
      db.collection('students').find({ uid, isSample: { $ne: true } }).sort({ name: 1 }).toArray(),
      listingIds.length ? db.collection('sessionAttendance').find({ listingId: { $in: listingIds } }).toArray() : [],
      db.collection('attendanceRecords').find({ uid }).toArray(),
    ])

    const attendanceStats = new Map()
    for (const session of legacyAttendance) {
      for (const record of session.records || []) {
        if (!record.studentId) continue
        const counts = attendanceStats.get(record.studentId) || { present: 0, marked: 0 }
        if (record.status) {
          counts.marked += 1
          if (record.status === 'present' || record.status === 'late') counts.present += 1
        }
        attendanceStats.set(record.studentId, counts)
      }
    }
    for (const rec of sessionAttendance) {
      if (!rec.studentUid) continue
      const counts = attendanceStats.get(rec.studentUid) || { present: 0, marked: 0 }
      if (rec.status) {
        counts.marked += 1
        if (rec.status === 'present' || rec.status === 'late') counts.present += 1
      }
      attendanceStats.set(rec.studentUid, counts)
    }

    const studentMap = new Map()

    for (const enrollment of enrollments) {
      const key = enrollment.studentUid || enrollment.studentEmail || String(enrollment._id)
      if (!studentMap.has(key)) {
        const studentIdDisplay = enrollment.studentUid
          ? (enrollment.studentUid.length > 8 ? enrollment.studentUid.slice(-8).toUpperCase() : enrollment.studentUid)
          : 'STU-ONLINE'
        studentMap.set(key, {
          id: String(enrollment._id),
          studentUid: enrollment.studentUid,
          studentId: studentIdDisplay,
          name: enrollment.studentName || 'Student',
          email: enrollment.studentEmail || '',
          phone: enrollment.studentPhone || '',
          department: enrollment.category || 'Online Course',
          enrolledClasses: [],
          attendancePercent: 0,
          enrolledAt: enrollment.enrolledAt || enrollment.createdAt || null,
          paymentStatus: enrollment.paymentStatus || 'paid',
          isOnlineEnrollment: true,
        })
      }
      const entry = studentMap.get(key)
      const classIdStr = String(enrollment.listingId)
      if (!entry.enrolledClasses.some((c) => c.id === classIdStr)) {
        entry.enrolledClasses.push({
          id: classIdStr,
          title: enrollment.name || 'Course Batch',
        })
      }
    }

    for (const [key, student] of studentMap.entries()) {
      const counts = attendanceStats.get(student.studentUid) || attendanceStats.get(student.id) || attendanceStats.get(key)
      student.attendancePercent = counts?.marked
        ? Math.round((counts.present / counts.marked) * 100)
        : 0
    }

    for (const leg of legacyStudents) {
      const legacyKey = leg.email || leg.studentId || leg.id
      let matched = null
      for (const [k, student] of studentMap.entries()) {
        if ((leg.email && student.email && leg.email.toLowerCase() === student.email.toLowerCase()) ||
            (leg.studentId && student.studentId === leg.studentId)) {
          matched = student
          break
        }
      }
      if (matched) {
        if (Array.isArray(leg.enrolledClasses)) {
          for (const ec of leg.enrolledClasses) {
            if (!matched.enrolledClasses.some((c) => c.id === ec.id)) {
              matched.enrolledClasses.push(ec)
            }
          }
        }
      } else {
        const counts = attendanceStats.get(leg.id) || attendanceStats.get(leg.studentId)
        const computedPercent = counts?.marked
          ? Math.round((counts.present / counts.marked) * 100)
          : (leg.attendancePercent || 0)
        const { _id, uid: _uid, ...studentData } = leg
        studentMap.set(legacyKey, {
          ...studentData,
          attendancePercent: computedPercent,
        })
      }
    }

    const students = [...studentMap.values()].sort((a, b) => a.name.localeCompare(b.name))
    response.json({ students })
  } catch (error) {
    console.error('Unable to load students:', error.message)
    response.status(500).json({ message: 'Unable to load students' })
  }
})

app.post('/api/students/:uid', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  const { name, email, studentId, department, classIds = [] } = request.body || {}
  if (!validUid(uid) || typeof name !== 'string' || !name.trim() || name.trim().length > 120 ||
      (email && (typeof email !== 'string' || email.length > 254)) ||
      (studentId && (typeof studentId !== 'string' || studentId.trim().length > 64)) ||
      (department && (typeof department !== 'string' || department.trim().length > 100)) ||
      !Array.isArray(classIds) || classIds.length > 50 || classIds.some((id) => typeof id !== 'string') ||
      new Set(classIds).size !== classIds.length) {
    return response.status(400).json({ message: 'Provide a name, valid contact details, department, and class IDs' })
  }
  try {
    const db = getDatabase()
    const { classList } = await ensureTeacherData(uid)
    const teacherListings = await db.collection('listings').find({ teacherUid: uid, status: { $ne: 'removed' } }).toArray()
    const mappedListings = teacherListings.map((l) => ({ id: String(l._id), title: l.name }))
    const combinedClasses = [...classList, ...mappedListings]
    const enrolledClasses = combinedClasses.filter((item) => classIds.includes(item.id))
    if (enrolledClasses.length !== new Set(classIds).size) return response.status(400).json({ message: 'One or more selected classes do not exist' })
    const now = new Date()
    const record = {
      uid, id: randomUUID(), studentId: studentId?.trim() || `STU-${Date.now().toString().slice(-8)}`,
      name: name.trim(), email: email?.trim().toLowerCase() || '', department: department?.trim() || 'General',
      classIds, enrolledClasses: enrolledClasses.map(({ id, title }) => ({ id, title })),
      attendancePercent: 0, createdAt: now, updatedAt: now,
    }
    await db.collection('students').insertOne(record)
    for (const item of enrolledClasses) {
      await db.collection('classes').updateOne(
        { uid, id: item.id },
        { $push: { students: { id: record.id, name: record.name, status: null } }, $inc: { enrolled: 1 }, $set: { updatedAt: now } },
      )
    }
    const { _id, uid: _uid, ...savedStudent } = record
    response.status(201).json({ student: savedStudent })
  } catch (error) {
    if (error.code === 11000) return response.status(409).json({ message: 'That student ID is already in use' })
    console.error('Unable to create student:', error.message)
    response.status(500).json({ message: 'Unable to create student' })
  }
})

app.get('/api/payments/:uid', verifyFirebaseToken, requireAuthenticatedRole('teacher'), async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  if (request.user.role !== 'admin' && uid !== request.authUid) return response.status(403).json({ message: 'You can only view your own payment records.' })
  if (!validUid(uid)) return response.status(400).json({ message: 'A valid user ID is required' })
  try {
    const db = getDatabase()
    await ensureTeacherData(uid)
    const [payments, payoutRequests, totals, teacher] = await Promise.all([
      db.collection('studentPayments').find({
        teacherUid: uid,
        gateway: { $in: ['stripe', 'bkash'] },
        status: { $in: ['paid', 'refunded'] },
        currency: 'BDT',
      }).sort({ paidAt: -1 }).limit(100).toArray(),
      db.collection('payoutRequests').find({ uid, isSample: { $ne: true } }).sort({ createdAt: -1 }).limit(100).toArray(),
      getTeacherLiveEarnings(db, uid),
      db.collection('users').findOne({ uid }, { projection: { payoutSettings: 1 } }),
    ])
    const paidOut = payoutRequests.filter((item) => item.status !== 'rejected').reduce((total, item) => total + item.amount, 0)
    response.json({
      earnings: totals.net,
      available: Math.max(0, totals.net - paidOut),
      payments: payments.map((item) => ({
        id: item.paymentId,
        description: item.courseName || 'Course payment',
        grossAmount: Number(item.amount) || 0,
        commission: Math.max(0, (Number(item.platformCommissionAmount) || 0) - (Number(item.commissionReversedAmount) || 0)),
        amount: Math.max(0, (Number(item.teacherNetAmount) || 0) - (Number(item.teacherRevenueReversedAmount) || 0)),
        currency: 'BDT',
        paymentMethod: item.paymentMethod || item.gateway,
        refundedAmount: Number(item.refundedAmount) || 0,
        status: 'paid',
        date: item.paidAt || item.createdAt,
        createdAt: item.paidAt || item.createdAt,
      })),
      payoutRequests: payoutRequests.map(({ _id, uid: _uid, ...item }) => item),
      payoutSettings: teacher?.payoutSettings || { enabled: false, monthlyAmount: 0, dayOfMonth: 1 },
      currency: 'BDT',
    })
  } catch (error) {
    console.error('Unable to load payments:', error.message)
    response.status(500).json({ message: 'Unable to load payments' })
  }
})

app.post('/api/payments/:uid', async (request, response) => {
  response.status(410).json({ message: 'Earnings are calculated from Stripe-confirmed live course payments and cannot be entered manually.' })
})

app.put('/api/payments/:uid/payout-settings', verifyFirebaseToken, requireAuthenticatedRole('teacher'), async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  if (request.user.role !== 'teacher') return response.status(403).json({ message: 'Only teachers can update payout settings.' })
  if (request.user.role !== 'admin' && uid !== request.authUid) return response.status(403).json({ message: 'You can only update your own payout settings.' })
  const body = request.body || {}
  const { enabled, monthlyAmount, dayOfMonth } = body
  if (Object.keys(body).some((field) => !['enabled', 'monthlyAmount', 'dayOfMonth'].includes(field)) ||
      !validUid(uid) || typeof enabled !== 'boolean' || !Number.isFinite(monthlyAmount) ||
      monthlyAmount < 0 || monthlyAmount > 10000000 || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28 ||
      (enabled && monthlyAmount <= 0)) {
    return response.status(400).json({ message: 'Provide a valid monthly amount, schedule day (1–28), and enabled status.' })
  }
  try {
    const result = await getDatabase().collection('users').updateOne(
      { uid, role: 'teacher', status: { $ne: 'removed' } },
      { $set: { payoutSettings: { enabled, monthlyAmount, dayOfMonth, updatedAt: new Date() }, updatedAt: new Date() } },
    )
    if (!result.matchedCount) return response.status(404).json({ message: 'Teacher account not found.' })
    await writeAuditLog({
      actorUid: request.authUid,
      actorRole: request.user.role,
      action: 'teacher.payout_settings_updated',
      targetType: 'teacher',
      targetId: uid,
      meta: { enabled, monthlyAmount, dayOfMonth },
    })
    response.json({ payoutSettings: { enabled, monthlyAmount, dayOfMonth } })
  } catch (error) {
    console.error('Unable to update teacher payout settings:', error.message)
    response.status(500).json({ message: 'Unable to update payout schedule.' })
  }
})

app.post('/api/payments/:uid/payout-requests', verifyFirebaseToken, requireAuthenticatedRole('teacher'), async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  if (request.user.role !== 'teacher') return response.status(403).json({ message: 'Only teachers can request a payout.' })
  if (request.user.role !== 'admin' && uid !== request.authUid) return response.status(403).json({ message: 'You can only request a payout for your own account.' })
  const body = request.body || {}
  const { amount, method, accountLast4 = '' } = body
  if (Object.keys(body).some((field) => !['amount', 'method', 'accountLast4'].includes(field)) ||
      !validUid(uid) || !Number.isFinite(amount) || amount <= 0 || amount > 10000000 ||
      typeof method !== 'string' || !['bank', 'mobile_wallet'].includes(method) ||
      (accountLast4 && (typeof accountLast4 !== 'string' || !/^[0-9]{4}$/.test(accountLast4)))) {
    return response.status(400).json({ message: 'Enter a valid payout amount, method, and optional last four account digits' })
  }
  try {
    const db = getDatabase()
    const [earned, requested] = await Promise.all([
      getTeacherLiveEarnings(db, uid),
      db.collection('payoutRequests').aggregate([{ $match: { uid, status: { $ne: 'rejected' }, isSample: { $ne: true } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]).toArray(),
    ])
    const available = earned.net - (requested[0]?.total || 0)
    if (amount > available) return response.status(400).json({ message: 'Payout amount exceeds your recorded available balance' })
    const record = { id: randomUUID(), uid, amount, currency: 'BDT', method, accountLast4, status: 'pending', createdAt: new Date() }
    await db.collection('payoutRequests').insertOne(record)
    await writeAuditLog({
      actorUid: request.authUid,
      actorRole: request.user.role,
      action: 'teacher.payout_requested',
      targetType: 'payout_request',
      targetId: record.id,
      meta: { amount: record.amount, currency: record.currency, method: record.method },
    })
    const { _id, uid: _uid, ...payoutRequest } = record
    response.status(201).json({ payoutRequest })
  } catch (error) {
    console.error('Unable to create payout request:', error.message)
    response.status(500).json({ message: 'Unable to create payout request' })
  }
})

const actionCollections = {
  messages: { collection: 'messages', required: ['subject', 'message'], limits: { subject: 120, message: 5000, recipient: 200 } },
  officeHours: { collection: 'officeHours', required: ['title', 'date', 'startTime', 'endTime'], limits: { title: 120, date: 30, startTime: 20, endTime: 20, location: 200 } },
  resources: { collection: 'resources', required: ['title'], limits: { title: 160, description: 1000, url: 2048 } },
}

function resourceBucket() {
  return new GridFSBucket(getDatabase(), { bucketName: 'resources' })
}

app.post('/api/actions/resources/:uid/file', express.raw({ type: 'application/octet-stream', limit: '10mb' }), async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  let title
  let filename
  let description
  let url
  try {
    title = decodeURIComponent(request.get('X-Resource-Title') || '').trim()
    filename = decodeURIComponent(request.get('X-File-Name') || '').split(/[\\/]/).pop()
    description = decodeURIComponent(request.get('X-Resource-Description') || '').trim()
    url = decodeURIComponent(request.get('X-Resource-Url') || '').trim()
  } catch {
    return response.status(400).json({ message: 'File name or resource title is invalid' })
  }
  if (!validUid(uid) || !Buffer.isBuffer(request.body) || request.body.length === 0 || !title || title.length > 160 || !filename || filename.length > 200 || description.length > 1000 || url.length > 2048) {
    return response.status(400).json({ message: 'Select a file up to 10 MB and provide a resource title' })
  }
  if (url) {
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Unsupported URL protocol')
    } catch {
      return response.status(400).json({ message: 'Resource URL must be a valid HTTP or HTTPS URL' })
    }
  }

  try {
    const now = new Date()
    const bucket = resourceBucket()
    const upload = bucket.openUploadStream(filename, {
      metadata: { uid, title, contentType: request.get('Content-Type') || 'application/octet-stream' },
    })
    const uploadFinished = new Promise((resolve, reject) => {
      upload.once('finish', resolve)
      upload.once('error', reject)
    })
    upload.end(request.body)
    await uploadFinished
    const record = {
      id: randomUUID(), uid, title, filename, description, url, fileId: upload.id.toString(),
      contentType: request.get('Content-Type') || 'application/octet-stream', createdAt: now, updatedAt: now,
    }
    try {
      await getDatabase().collection('resources').insertOne(record)
    } catch (error) {
      await bucket.delete(upload.id)
      throw error
    }
    response.status(201).json({ resource: { ...record, fileId: undefined } })
  } catch (error) {
    console.error('Unable to store resource file:', error.message)
    response.status(500).json({ message: 'Unable to store resource file' })
  }
})

app.get('/api/actions/lessons/:uid', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  if (!validUid(uid)) return response.status(400).json({ message: 'A valid user ID is required' })
  try {
    const sessions = await getDatabase().collection('lessonSessions').find({ uid }).sort({ startedAt: -1 }).limit(100).toArray()
    response.json({ lessons: sessions.map(({ _id, uid: _uid, ...item }) => item) })
  } catch (error) {
    console.error('Unable to load lesson sessions:', error.message)
    response.status(500).json({ message: 'Unable to load lesson sessions' })
  }
})

app.post('/api/actions/lessons/:uid/start', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  const { classId } = request.body || {}
  if (!validUid(uid) || typeof classId !== 'string' || classId.length > 256) {
    return response.status(400).json({ message: 'A valid class ID is required' })
  }
  try {
    const { classList } = await ensureTeacherData(uid)
    const lesson = classList.find((item) => item.id === classId)
    if (!lesson) return response.status(404).json({ message: 'Class not found' })
    const now = new Date()
    const session = {
      id: randomUUID(), uid, classId, classTitle: lesson.title, status: 'started',
      startedAt: now, createdAt: now,
    }
    await getDatabase().collection('lessonSessions').insertOne(session)
    const { _id, uid: _uid, ...savedSession } = session
    response.status(201).json({ lesson: savedSession })
  } catch (error) {
    console.error('Unable to start lesson:', error.message)
    response.status(500).json({ message: 'Unable to start lesson' })
  }
})

app.get('/api/actions/resources/:uid/:id/file', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid, id } = request.params
  if (!validUid(uid) || !id || id.length > 256) return response.status(400).json({ message: 'A valid user ID and resource ID are required' })
  try {
    const resource = await getDatabase().collection('resources').findOne({ uid, id })
    if (!resource?.fileId || !ObjectId.isValid(resource.fileId)) return response.status(404).json({ message: 'Resource file not found' })
    const fileId = new ObjectId(resource.fileId)
    const file = await getDatabase().collection('resources.files').findOne({ _id: fileId, 'metadata.uid': uid })
    if (!file) return response.status(404).json({ message: 'Resource file not found' })
    response.setHeader('Content-Type', file.metadata?.contentType || 'application/octet-stream')
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`)
    resourceBucket().openDownloadStream(fileId).on('error', (error) => {
      console.error('Unable to download resource file:', error.message)
      if (!response.headersSent) response.status(500).json({ message: 'Unable to download resource file' })
    }).pipe(response)
  } catch (error) {
    console.error('Unable to download resource file:', error.message)
    response.status(500).json({ message: 'Unable to download resource file' })
  }
})

for (const [type, config] of Object.entries(actionCollections)) {
  app.get(`/api/actions/${type}/:uid`, async (request, response) => {
    if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
    const { uid } = request.params
    if (!validUid(uid)) return response.status(400).json({ message: 'A valid user ID is required' })
    try {
      const records = await getDatabase().collection(config.collection).find({ uid }).sort({ createdAt: -1 }).limit(100).toArray()
      response.json({ [type]: records.map(({ _id, uid: _uid, ...item }) => item) })
    } catch (error) {
      console.error(`Unable to load ${type}:`, error.message)
      response.status(500).json({ message: `Unable to load ${type}` })
    }
  })
  app.post(`/api/actions/${type}/:uid`, async (request, response) => {
    if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
    const { uid } = request.params
    const body = request.body || {}
    if (!validUid(uid) || config.required.some((field) => typeof body[field] !== 'string' || !body[field].trim() || body[field].length > config.limits[field])) {
      return response.status(400).json({ message: `Provide valid required fields: ${config.required.join(', ')}` })
    }
    if (Object.entries(config.limits).some(([field, limit]) => body[field] !== undefined && (typeof body[field] !== 'string' || body[field].length > limit))) {
      return response.status(400).json({ message: 'One or more fields exceed the allowed length' })
    }
    if (type === 'resources' && body.url) {
      try {
        const parsedUrl = new URL(body.url)
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Unsupported URL protocol')
      } catch {
        return response.status(400).json({ message: 'Resource URL must be a valid HTTP or HTTPS URL' })
      }
    }
    if (type === 'officeHours' && (Number.isNaN(Date.parse(body.date)) || body.startTime >= body.endTime)) {
      return response.status(400).json({ message: 'Enter a valid date and an end time after the start time' })
    }
    try {
      const now = new Date()
      const record = { id: randomUUID(), uid, ...Object.fromEntries(Object.keys(config.limits).filter((field) => body[field] !== undefined).map((field) => [field, body[field].trim()])), createdAt: now, updatedAt: now }
      if (type === 'messages') record.status = 'saved'
      await getDatabase().collection(config.collection).insertOne(record)
      const { _id, uid: _uid, ...savedRecord } = record
      response.status(201).json({ [type.slice(0, -1)]: savedRecord })
    } catch (error) {
      console.error(`Unable to save ${type}:`, error.message)
      response.status(500).json({ message: `Unable to save ${type}` })
    }
  })
}

app.get('/api/health', (_request, response) => {
  response.status(databaseReady ? 200 : 503).json({ status: databaseReady ? 'ok' : 'starting', service: 'teachos-api', database: databaseReady ? 'connected' : 'connecting', timestamp: new Date().toISOString() })
})

// Guard all /api routes (except /health) until MongoDB is fully connected.
// Returns 503 Service Unavailable during cold-start so clients get a clear
// signal rather than a 500 "MongoDB has not been connected" crash.
app.use('/api', (request, response, next) => {
  if (databaseReady) return next()
  if (request.path === '/health') return next()
  return response.status(503).json({
    message: 'The server is still starting up. Please try again in a moment.',
    code: 'DATABASE_INITIALIZING',
  })
})

app.use('/api', courseRouter)
app.use('/api', listingRouter)
app.use('/api', studentRouter)
app.use('/api', platformRouter)
app.use('/api', userRouter)
app.use('/api/course-management', courseManagementRouter)
app.use('/api', teacherSubscriptionRouter)
app.use('/api/notifications', notificationRouter)
app.use('/api', paymentRouter)

app.use(errorHandler)

const server = app.listen(port, () => console.log(`TeachOS API listening on http://localhost:${port}`))

connectDatabase()
 .then(async () => {
   const database = getDatabase()
   const existing = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name))
   for (const name of collections) {
     if (!existing.has(name)) await database.createCollection(name)
   }
   await Promise.all([
     database.collection('users').createIndex({ uid: 1 }, { unique: true }),
     database.collection('teacherDashboards').createIndex({ uid: 1 }, { unique: true }),
     database.collection('classes').createIndex({ uid: 1, id: 1 }, { unique: true }),
     database.collection('students').createIndex({ uid: 1, id: 1 }, { unique: true }),
     database.collection('students').createIndex({ uid: 1, studentId: 1 }, { unique: true }),
     database.collection('attendanceRecords').createIndex({ uid: 1, classId: 1, date: -1 }),
     database.collection('lessonSessions').createIndex({ uid: 1, startedAt: -1 }),
     database.collection('payments').createIndex({ uid: 1, createdAt: -1 }),
     database.collection('payments').createIndex({ uid: 1, id: 1 }, { unique: true }),
     database.collection('payoutRequests').createIndex({ uid: 1, createdAt: -1 }),
     database.collection('payoutRequests').createIndex({ uid: 1, id: 1 }, { unique: true }),
     database.collection('platforms').createIndex({ slug: 1 }, { unique: true }),
     database.collection('platforms').createIndex({ status: 1 }),
     database.collection('auditLogs').createIndex({ platformId: 1, createdAt: -1 }),
     database.collection('auditLogs').createIndex({ actorUid: 1, createdAt: -1 }),
     database.collection('courses').createIndex(
       { teacherUid: 1, name: 1 },
       { unique: true, collation: { locale: 'en', strength: 2 } },
     ),
     database.collection('listings').createIndex({ category: 1, createdAt: -1 }),
     database.collection('listings').createIndex({ teacherUid: 1, createdAt: -1 }),
     database.collection('studentEnrollments').createIndex({ listingId: 1, status: 1 }),
     database.collection('studentEnrollments').createIndex({ studentUid: 1, listingId: 1 }, { unique: true }),
     database.collection('studentEnrollments').createIndex({ studentUid: 1, createdAt: -1 }),
     database.collection('assignments').createIndex({ listingId: 1, dueDate: 1 }),
     database.collection('assignmentSubmissions').createIndex({ assignmentId: 1, studentUid: 1 }, { unique: true }),
     database.collection('studentPayments').createIndex({ studentUid: 1, createdAt: -1 }),
     database.collection('studentPayments').createIndex({ teacherUid: 1, mode: 1, status: 1, paidAt: -1 }),
     database.collection('studentPayments').createIndex({ gateway: 1, mode: 1, status: 1, paidAt: -1 }),
     database.collection('studentPayments').createIndex(
       { revenueTransactionId: 1 },
       { unique: true, partialFilterExpression: { revenueTransactionId: { $type: 'string' } } },
     ),
     database.collection('studentPayments').createIndex(
       { providerInvoiceId: 1 },
       { unique: true, partialFilterExpression: { providerInvoiceId: { $type: 'string' } } },
     ),
     database.collection('studentLessonProgress').createIndex(
       { studentUid: 1, listingId: 1, lessonId: 1 },
       { unique: true },
     ),
     database.collection('studentLessonProgress').createIndex({ studentUid: 1, lastViewedAt: -1 }),
     database.collection('studentCourseCompletions').createIndex(
       { studentUid: 1, listingId: 1 },
       { unique: true },
     ),
     database.collection('teacherSubscriptionInvoices').createIndex({ teacherUid: 1, month: 1 }, { unique: true }),
     database.collection('teacherSubscriptionPayments').createIndex({ paymentId: 1 }, { unique: true }),
     database.collection('teacherSubscriptionPayments').createIndex({ providerPaymentId: 1 }, { sparse: true, unique: true }),
     database.collection('googleMeetOAuthStates').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
     database.collection('studentPayments').createIndex(
       { studentUid: 1, listingId: 1, mode: 1 },
       { unique: true, partialFilterExpression: { mode: 'demo' } },
     ),
     database.collection('studentPayments').createIndex({ studentUid: 1, listingId: 1, billingPeriod: 1 }),
     database.collection('bkashPayments').createIndex({ paymentID: 1 }, { unique: true }),
     database.collection('bkashPayments').createIndex({ studentUid: 1, createdAt: -1 }),
     database.collection('stripePayments').createIndex({ sessionId: 1 }, { unique: true }),
     database.collection('stripePayments').createIndex({ studentUid: 1, createdAt: -1 }),
     database.collection('stripePayments').createIndex({ studentUid: 1, listingId: 1, mode: 1 }),
     database.collection('courseModules').createIndex({ listingId: 1, order: 1 }),
     database.collection('courseModules').createIndex({ teacherUid: 1, createdAt: -1 }),
     database.collection('courseLessons').createIndex({ listingId: 1, lessonNumber: 1 }),
     database.collection('courseLessons').createIndex({ moduleId: 1, lessonNumber: 1 }),
     database.collection('courseLessons').createIndex({ teacherUid: 1, createdAt: -1 }),
     database.collection('liveSessions').createIndex({ listingId: 1, scheduledAt: 1 }),
     database.collection('liveSessions').createIndex({ teacherUid: 1, createdAt: -1 }),
     database.collection('sessionAttendance').createIndex({ listingId: 1, sessionId: 1 }),
     database.collection('sessionAttendance').createIndex({ studentUid: 1, createdAt: -1 }),
     database.collection('revenueTransactions').createIndex({ paymentId: 1 }, { unique: true }),
     database.collection('revenueTransactions').createIndex(
       { providerTransactionId: 1 },
       { unique: true, partialFilterExpression: { providerTransactionId: { $type: 'string' } } },
     ),
     database.collection('revenueTransactions').createIndex({ teacherUid: 1, earningStatus: 1, availableAt: 1 }),
     database.collection('revenueTransactions').createIndex({ paymentMonth: 1, commissionSettlementStatus: 1 }),
     database.collection('revenueTransactions').createIndex({ teacherUid: 1, createdAt: -1 }),
     database.collection('teacherWallets').createIndex({ teacherUid: 1 }, { unique: true }),
     database.collection('monthlyAdminSettlements').createIndex({ settlementMonth: 1 }, { unique: true }),
     database.collection('adminCommissionLedgers').createIndex({ paymentMonth: 1, createdAt: -1 }),
     database.collection('adminCommissionLedgers').createIndex({ revenueTransactionId: 1 }),
     database.collection('teacherPendingLedgers').createIndex({ teacherUid: 1, createdAt: -1 }),
     database.collection('teacherPendingLedgers').createIndex({ revenueTransactionId: 1 }),
     database.collection('teacherAvailableLedgers').createIndex({ teacherUid: 1, createdAt: -1 }),
     database.collection('teacherAvailableLedgers').createIndex({ revenueTransactionId: 1 }),
     ...['messages', 'officeHours', 'resources'].map((name) => database.collection(name).createIndex({ uid: 1, createdAt: -1 })),
   ])
   databaseReady = true
   startSettlementScheduler(database)
 })
 .catch((error) => console.error('TeachOS API could not connect to MongoDB:', error.message))

process.on('SIGINT', async () => {
  stopSettlementScheduler()
  server.close()
  await closeDatabase()
  process.exit(0)
})
