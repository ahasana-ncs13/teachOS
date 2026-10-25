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
import { securityHeaders, rateLimiter } from './middleware/security.js'
import { errorHandler } from './middleware/error.js'
import { platformRouter } from './routes/platform.routes.js'
import { userRouter } from './routes/user.routes.js'
import { listingRouter } from './routes/listing.routes.js'
import { studentRouter } from './routes/student.routes.js'

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
const sampleDashboard = {
  isSample: true,
  attendanceClassId: 'calculus-201',
  classes: [ 
    {
      id: 'calculus-201',
      title: 'Advanced Calculus 201',
      time: '10:00',
      period: 'AM',
      status: 'live',
      location: 'Room 204',
      enrolled: 32,
      students: [
        { id: 'jane-doe', name: 'Jane Doe', status: 'present' },
        { id: 'alex-smith', name: 'Alex Smith', status: null },
        { id: 'emma-jones', name: 'Emma Jones', status: 'absent' },
      ],
    },
    {
      id: 'linear-algebra',
      title: 'Linear Algebra Seminar',
      time: '1:30',
      period: 'PM',
      status: 'upcoming',
      location: 'Online',
      enrolled: 18,
      students: [],
    },
  ],
  earnings: {
    total: 4250,
    pending: 320.5,
    currency: 'BDT',
    nextPayout: 'Oct 31',
    payouts: [{ date: 'Sep 30', amount: 3980 }],
  },
  roster: { totalStudents: 3, activeClasses: 2 },
  createdAt: new Date(),
  updatedAt: new Date(),
}

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
app.use(express.json({ limit: '100kb' }))

app.use('/api', async (request, response, next) => {
  if (request.path === '/health' || request.path === '/courses' || request.path === '/users/me' || request.path.startsWith('/platforms') || request.path.startsWith('/admin') || request.path.startsWith('/listings') || request.path.startsWith('/student')) return next()
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
    if (process.env.NODE_ENV !== 'production' && requestedUid?.startsWith('demo-')) return next()
    return response.status(503).json({ message: 'Set FIREBASE_PROJECT_ID in server/.env to enable authenticated API access' })
  }

  const authorization = request.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) return response.status(401).json({ message: 'Sign in to access this data' })
  try {
    const { payload } = await jwtVerify(authorization.slice('Bearer '.length), firebaseJwkSet, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${firebaseProjectId}`,
      audience: firebaseProjectId,
      subject: requestedUid,
    })
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

    if (!isProfileRegistration && canonicalRole !== 'teacher' && canonicalRole !== 'admin') {
      return response.status(403).json({ message: 'This workspace is available to teachers.', code: 'ROLE_FORBIDDEN' })
    }
    return next()
  } catch (error) {
    console.error('Unable to verify Firebase ID token:', error.message)
    return response.status(401).json({ message: 'Your session is invalid or expired. Please sign in again.' })
  }
})

const collections = ['users', 'teacherDashboards', 'classes', 'students', 'attendanceRecords', 'lessonSessions', 'payments', 'payoutRequests', 'messages', 'officeHours', 'resources', 'platforms', 'auditLogs', 'listings', 'studentEnrollments', 'assignments', 'assignmentSubmissions', 'studentPayments']

async function ensureTeacherData(uid) {
  const database = getDatabase()
  const dashboards = database.collection('teacherDashboards')
  try {
    await dashboards.updateOne({ uid }, { $setOnInsert: { ...sampleDashboard, uid } }, { upsert: true })
  } catch (error) {
    if (error.code !== 11000) throw error
  }
  const dashboard = await dashboards.findOne({ uid })
  const classes = database.collection('classes')

  if (await classes.countDocuments({ uid }) === 0 && dashboard.classes?.length) {
    const timestamp = new Date()
    await Promise.all(dashboard.classes.map((item) => classes.updateOne(
      { uid, id: item.id },
      { $setOnInsert: {
        ...item,
        uid,
        isSample: true,
        schedule: item.id === 'calculus-201' ? 'Mon, Wed, Fri' : 'Tue, Thu',
        startTime: item.time,
        endTime: item.id === 'calculus-201' ? '11:30 AM' : '2:30 PM',
        department: item.id === 'calculus-201' ? 'Sciences' : 'Mathematics',
        createdAt: timestamp,
        updatedAt: timestamp,
      } },
      { upsert: true },
    )))
  }

  const students = database.collection('students')
  const classList = await classes.find({ uid }).toArray()
  for (const classRecord of classList) {
    for (const student of classRecord.students || []) {
      await students.updateOne(
        { uid, id: student.id },
        { $setOnInsert: {
          uid,
          id: student.id,
          studentId: student.id.toUpperCase(),
          name: student.name,
          email: '',
          department: classRecord.department || 'General',
          attendancePercent: 0,
          isSample: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        } },
        { upsert: true },
      )
      await students.updateOne(
        { uid, id: student.id },
        { $addToSet: {
          classIds: classRecord.id,
          enrolledClasses: { id: classRecord.id, title: classRecord.title },
        } },
      )
    }
  }

  if (dashboard.isSample && await database.collection('payments').countDocuments({ uid }) === 0) {
    const now = new Date()
    await Promise.all([
      database.collection('payments').updateOne(
        { uid, id: 'sample-earnings' },
        { $setOnInsert: {
          id: 'sample-earnings', uid, description: 'Starter sample earnings', amount: dashboard.earnings.total,
          currency: dashboard.earnings.currency, date: now.toISOString().slice(0, 10), type: 'earning',
          status: 'recorded', isSample: true, createdAt: now,
        } },
        { upsert: true },
      ),
      database.collection('payoutRequests').updateOne(
        { uid, id: 'sample-payout' },
        { $setOnInsert: {
          id: 'sample-payout', uid, amount: dashboard.earnings.payouts[0]?.amount || 0,
          method: 'bank', accountLast4: '4921', status: 'paid', isSample: true, createdAt: now,
        } },
        { upsert: true },
      ),
    ])
  }
  return { dashboard, classList }
}

function validUid(uid) {
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 256
}

app.post('/api/users', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid, email, displayName, fullName, role, photoURL, provider, emailVerified, metadata } = request.body || {}
  const localDemo = !firebaseJwkSet && process.env.NODE_ENV !== 'production' && typeof uid === 'string' && uid.startsWith('demo-')
  if (typeof uid !== 'string' || !uid || typeof email !== 'string' || email.length > 254 ||
      (displayName !== undefined && typeof displayName !== 'string') ||
      (fullName !== undefined && typeof fullName !== 'string') ||
      (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))) ||
      !role || (request.authUid && uid !== request.authUid) || (!request.authUid && !localDemo)) {
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
    const verifiedEmail = request.authEmail || (localDemo ? String(email).trim().toLowerCase() : null)
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
      emailVerified: request.authEmailVerified ?? (localDemo ? true : Boolean(emailVerified)),
      metadata: metadata || {},
      updatedAt: now,
    }
    await users.updateOne(
      { uid },
      { $set: profile, $setOnInsert: { createdAt: now } },
      { upsert: true },
    )
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
    const { dashboard, classList } = await ensureTeacherData(uid)
    const classes = classList.map(({ _id, uid: _uid, createdAt, updatedAt, ...item }) => item)
    const db = getDatabase()
    const [studentCount, earnings, pendingPayouts] = await Promise.all([
      db.collection('students').countDocuments({ uid }),
      db.collection('payments').aggregate([
        { $match: { uid, type: 'earning' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).toArray(),
      db.collection('payoutRequests').aggregate([
        { $match: { uid, status: 'pending' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).toArray(),
    ])
    const { _id, uid: _uid, ...dashboardData } = dashboard
    response.json({
      dashboard: {
        ...dashboardData,
        classes,
        earnings: {
          ...dashboardData.earnings,
          total: earnings[0]?.total || 0,
          pending: pendingPayouts[0]?.total || 0,
        },
        roster: {
          totalStudents: studentCount,
          activeClasses: classList.filter((item) => item.status === 'active' || item.status === 'live').length,
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
  if (attendance.some((record) => !record || typeof record !== 'object' || typeof record.studentId !== 'string' || !['present', 'absent', 'late', null].includes(record.status))) {
    return response.status(400).json({ message: 'Each attendance record must have a student ID and a valid status' })
  }

  try {
      const { classList } = await ensureTeacherData(uid)
      const selectedClass = classList.find((item) => item.id === classId)
      if (!selectedClass) return response.status(404).json({ message: 'Class not found' })

    const submitted = new Map(attendance.map(({ studentId, status }) => [studentId, status]))
    if (submitted.size !== attendance.length || [...submitted.keys()].some((studentId) => !selectedClass.students.some((student) => student.id === studentId))) {
      return response.status(400).json({ message: 'Attendance contains duplicate or unknown students' })
    }
    const updatedAt = new Date()
    const updatedStudents = selectedClass.students.map((student) => submitted.has(student.id) ? { ...student, status: submitted.get(student.id) } : student)
    const database = getDatabase()
    if (date === new Date().toISOString().slice(0, 10)) {
      await database.collection('classes').updateOne({ uid, id: classId }, { $set: { students: updatedStudents, updatedAt } })
    }
    const attendanceRecords = database.collection('attendanceRecords')
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
    const { classList } = await ensureTeacherData(uid)
    response.json({ classes: classList.map(({ _id, uid: _uid, ...item }) => item) })
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
    const now = new Date()
    const record = {
      id: randomUUID(), uid, title: title.trim(), schedule: schedule.trim(), startTime: startTime.trim(),
      endTime: endTime.trim(), time: startTime.trim(), period: '', location: location.trim(),
      department: department.trim(), status: status || 'active', enrolled: 0, students: [],
      isSample: false, createdAt: now, updatedAt: now,
    }
    await getDatabase().collection('classes').insertOne(record)
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
  const fields = ['title', 'schedule', 'startTime', 'endTime', 'location', 'department', 'status']
  const updates = request.body || {}
  if (!validUid(uid) || !classId || classId.length > 256 || !Object.keys(updates).length ||
      Object.keys(updates).some((field) => !fields.includes(field))) {
    return response.status(400).json({ message: 'Provide a class ID and valid fields to update' })
  }
  if (Object.entries(updates).some(([, value]) => typeof value !== 'string' || !value.trim() || value.length > 120) ||
      (updates.status && !['active', 'upcoming', 'completed'].includes(updates.status))) {
    return response.status(400).json({ message: 'Class fields must contain valid text and status values' })
  }
  try {
    const normalized = Object.fromEntries(Object.entries(updates).map(([field, value]) => [field, value.trim()]))
    const result = await getDatabase().collection('classes').findOneAndUpdate(
      { uid, id: classId },
      { $set: { ...normalized, updatedAt: new Date() } },
      { returnDocument: 'after', projection: { _id: 0, uid: 0 } },
    )
    if (!result) return response.status(404).json({ message: 'Class not found' })
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
    const [students, attendance] = await Promise.all([
      db.collection('students').find({ uid }).sort({ name: 1 }).toArray(),
      db.collection('attendanceRecords').find({ uid }).toArray(),
    ])
    const attendanceByStudent = new Map()
    for (const session of attendance) {
      for (const record of session.records) {
        const counts = attendanceByStudent.get(record.studentId) || { present: 0, marked: 0 }
        if (record.status) {
          counts.marked += 1
          if (record.status === 'present' || record.status === 'late') counts.present += 1
        }
        attendanceByStudent.set(record.studentId, counts)
      }
    }
    response.json({ students: students.map(({ _id, uid: _uid, ...student }) => {
      const counts = attendanceByStudent.get(student.id)
      return { ...student, attendancePercent: counts?.marked ? Math.round((counts.present / counts.marked) * 100) : student.attendancePercent || 0 }
    }) })
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
    const { classList } = await ensureTeacherData(uid)
    const enrolledClasses = classList.filter((item) => classIds.includes(item.id))
    if (enrolledClasses.length !== new Set(classIds).size) return response.status(400).json({ message: 'One or more selected classes do not exist' })
    const now = new Date()
    const record = {
      uid, id: randomUUID(), studentId: studentId?.trim() || `STU-${Date.now().toString().slice(-8)}`,
      name: name.trim(), email: email?.trim().toLowerCase() || '', department: department?.trim() || 'General',
      classIds, enrolledClasses: enrolledClasses.map(({ id, title }) => ({ id, title })),
      attendancePercent: 0, isSample: false, createdAt: now, updatedAt: now,
    }
    await getDatabase().collection('students').insertOne(record)
    for (const item of enrolledClasses) {
      await getDatabase().collection('classes').updateOne(
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

app.get('/api/payments/:uid', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  if (!validUid(uid)) return response.status(400).json({ message: 'A valid user ID is required' })
  try {
    const db = getDatabase()
    await ensureTeacherData(uid)
    const [payments, payoutRequests] = await Promise.all([
      db.collection('payments').find({ uid }).sort({ createdAt: -1 }).limit(100).toArray(),
      db.collection('payoutRequests').find({ uid }).sort({ createdAt: -1 }).limit(100).toArray(),
    ])
    const earnings = payments.filter((item) => item.type === 'earning').reduce((total, item) => total + item.amount, 0)
    const paidOut = payoutRequests.filter((item) => item.status !== 'rejected').reduce((total, item) => total + item.amount, 0)
    response.json({
      earnings, available: Math.max(0, earnings - paidOut),
      payments: payments.map(({ _id, uid: _uid, ...item }) => item),
      payoutRequests: payoutRequests.map(({ _id, uid: _uid, ...item }) => item),
      currency: payments[0]?.currency || 'BDT',
      hasSample: payments.some((item) => item.isSample) || payoutRequests.some((item) => item.isSample),
    })
  } catch (error) {
    console.error('Unable to load payments:', error.message)
    response.status(500).json({ message: 'Unable to load payments' })
  }
})

app.post('/api/payments/:uid', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  const { description, amount, classId, date, currency = 'BDT' } = request.body || {}
  if (!validUid(uid) || typeof description !== 'string' || !description.trim() || description.trim().length > 160 ||
      !Number.isFinite(amount) || amount <= 0 || amount > 10000000 ||
      (classId !== undefined && (typeof classId !== 'string' || classId.length > 256)) ||
      (date !== undefined && (typeof date !== 'string' || Number.isNaN(Date.parse(date)))) ||
      typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    return response.status(400).json({ message: 'Provide a description, positive amount, valid date, and three-letter currency code' })
  }
  try {
    if (classId) {
      const { classList } = await ensureTeacherData(uid)
      if (!classList.some((item) => item.id === classId)) return response.status(404).json({ message: 'Class not found' })
    }
    const now = new Date()
    const payments = getDatabase().collection('payments')
    const conflictingCurrency = await payments.findOne({ uid, currency: { $ne: currency } })
    if (conflictingCurrency) return response.status(400).json({ message: `Use ${conflictingCurrency.currency} for all payment records in this account` })
    const record = { id: randomUUID(), uid, description: description.trim(), amount, classId: classId || null, date: date || now.toISOString().slice(0, 10), currency, type: 'earning', status: 'recorded', isSample: false, createdAt: now }
    await payments.insertOne(record)
    const { _id, uid: _uid, ...savedPayment } = record
    response.status(201).json({ payment: savedPayment })
  } catch (error) {
    console.error('Unable to save payment:', error.message)
    response.status(500).json({ message: 'Unable to save payment' })
  }
})

app.post('/api/payments/:uid/payout-requests', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid } = request.params
  const { amount, method, accountLast4 = '' } = request.body || {}
  if (!validUid(uid) || !Number.isFinite(amount) || amount <= 0 || amount > 10000000 ||
      typeof method !== 'string' || !['bank', 'mobile_wallet'].includes(method) ||
      (accountLast4 && (typeof accountLast4 !== 'string' || !/^[0-9]{4}$/.test(accountLast4)))) {
    return response.status(400).json({ message: 'Enter a valid payout amount, method, and optional last four account digits' })
  }
  try {
    const db = getDatabase()
    const [earned, requested] = await Promise.all([
      db.collection('payments').aggregate([{ $match: { uid, type: 'earning' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]).toArray(),
      db.collection('payoutRequests').aggregate([{ $match: { uid, status: { $ne: 'rejected' } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]).toArray(),
    ])
    const available = (earned[0]?.total || 0) - (requested[0]?.total || 0)
    if (amount > available) return response.status(400).json({ message: 'Payout amount exceeds your recorded available balance' })
    const latestPayment = await db.collection('payments').findOne({ uid, type: 'earning' }, { sort: { createdAt: -1 } })
    const record = { id: randomUUID(), uid, amount, currency: latestPayment?.currency || 'BDT', method, accountLast4, status: 'pending', createdAt: new Date() }
    await db.collection('payoutRequests').insertOne(record)
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

app.get('/api/courses', (_request, response) => {
  response.json({ courses: [] })
})

app.use('/api', listingRouter)
app.use('/api', studentRouter)
app.use('/api', platformRouter)
app.use('/api', userRouter)

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
     database.collection('listings').createIndex({ category: 1, createdAt: -1 }),
     database.collection('listings').createIndex({ teacherUid: 1, createdAt: -1 }),
     database.collection('studentEnrollments').createIndex({ studentUid: 1, listingId: 1 }, { unique: true }),
     database.collection('studentEnrollments').createIndex({ studentUid: 1, createdAt: -1 }),
     database.collection('assignments').createIndex({ listingId: 1, dueDate: 1 }),
     database.collection('assignmentSubmissions').createIndex({ assignmentId: 1, studentUid: 1 }, { unique: true }),
     database.collection('studentPayments').createIndex({ studentUid: 1, createdAt: -1 }),
     database.collection('studentPayments').createIndex(
       { studentUid: 1, listingId: 1, mode: 1 },
       { unique: true, partialFilterExpression: { mode: 'demo' } },
     ),
     ...['messages', 'officeHours', 'resources'].map((name) => database.collection(name).createIndex({ uid: 1, createdAt: -1 })),
   ])
   databaseReady = true
 })
 .catch((error) => console.error('TeachOS API could not connect to MongoDB:', error.message))

process.on('SIGINT', async () => {
  server.close()
  await closeDatabase()
  process.exit(0)
})
