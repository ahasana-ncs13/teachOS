import { ObjectId } from 'mongodb'
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getDatabase } from '../db.js'
import { parseObjectId } from '../utils/validation.js'
import { excludeLegacySampleUsers } from '../utils/sampleData.js'
import { writeAuditLog } from './audit.service.js'

function getFirebaseAdminAuth() {
  let app = getApps().find((item) => item.name === 'teachos-admin')
  if (!app) {
    let credential
    if (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
      let serviceAccount
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON)
      } catch {
        const error = new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.')
        error.status = 503
        error.code = 'FIREBASE_ADMIN_CONFIGURATION_INVALID'
        throw error
      }
      credential = cert(serviceAccount)
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credential = applicationDefault()
    } else {
      const error = new Error('Configure Firebase Admin credentials to provision staff accounts.')
      error.status = 503
      error.code = 'FIREBASE_ADMIN_NOT_CONFIGURED'
      throw error
    }
    app = initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID }, 'teachos-admin')
  }
  return getAuth(app)
}

/**
 * Service to manage tenant users under the multi-tenancy model.
 */
export async function createTenantUser(req, { email, role, fullName, platformId }) {
  const database = getDatabase()
  const users = database.collection('users')

  // Only the global TeachOS admin can create or assign admin accounts.
  if (role === 'admin' && req.user.role !== 'admin') {
    const error = new Error('Only the TeachOS admin can create or assign admin accounts')
    error.status = 403
    error.code = 'ADMIN_CREATION_FORBIDDEN'
    throw error
  }

  // Determine target platform
  let targetPlatformId = req.platform?._id
  if (req.user.role === 'admin') {
    targetPlatformId = platformId ? new ObjectId(platformId) : null
  }

  // Tenant users must have platformId
  if (role !== 'admin' && !targetPlatformId) {
    const error = new Error('Platform ID is required for tenant users')
    error.status = 400
    error.code = 'PLATFORM_REQUIRED'
    throw error
  }

  const normalizedEmail = email.trim().toLowerCase()
  const existing = await users.findOne({ email: normalizedEmail, status: { $ne: 'removed' } })
  if (existing) {
    const error = new Error(`User with email '${normalizedEmail}' already exists`)
    error.status = 409
    error.code = 'USER_ALREADY_EXISTS'
    throw error
  }

  const auth = getFirebaseAdminAuth()
  let identity
  try {
    identity = await auth.createUser({
      email: normalizedEmail,
      displayName: fullName.trim(),
      emailVerified: false,
      disabled: false,
    })
    await auth.setCustomUserClaims(identity.uid, { role })
  } catch (error) {
    if (identity?.uid) await auth.deleteUser(identity.uid)
    if (error.code === 'auth/email-already-exists') {
      error.status = 409
      error.code = 'USER_ALREADY_EXISTS'
    }
    throw error
  }

  const now = new Date()
  const newUser = {
    uid: identity.uid,
    email: normalizedEmail,
    fullName: fullName.trim(),
    role,
    platformId: targetPlatformId,
    status: 'active',
    createdBy: req.authUid,
    createdAt: now,
    updatedAt: now,
  }

  let passwordSetupLink
  try {
    await users.insertOne(newUser)
    passwordSetupLink = await auth.generatePasswordResetLink(normalizedEmail)
  } catch (error) {
    await users.deleteOne({ uid: identity.uid })
    await auth.deleteUser(identity.uid)
    throw error
  }

  await writeAuditLog({
    platformId: targetPlatformId,
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'CREATE_TENANT_USER',
    targetType: 'user',
    targetId: result.insertedId,
    meta: { email: normalizedEmail, role },
  })

  const savedUser = await users.findOne({ uid: identity.uid })
  return { user: savedUser, passwordSetupLink }
}

export async function listTenantUsers(req, { page = 1, limit = 20, role, search }) {
  const database = getDatabase()
  const filter = { status: { $ne: 'removed' } }

  if (req.user.role !== 'admin') {
    filter.platformId = req.platform._id
  } else if (req.query.platformId) {
    filter.platformId = new ObjectId(req.query.platformId)
  }

  if (role && ['admin', 'teacher', 'student'].includes(role)) {
    filter.role = role
  }

  if (search && typeof search === 'string') {
    const safeRegex = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    filter.$or = [
      { fullName: { $regex: safeRegex, $options: 'i' } },
      { email: { $regex: safeRegex, $options: 'i' } },
    ]
  }

  const skip = (page - 1) * limit
  const collection = database.collection('users')
  const visibleFilter = excludeLegacySampleUsers(filter)

  const [users, total] = await Promise.all([
    collection
      .find(visibleFilter, { projection: { removedAt: 0, removedBy: 0 } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    collection.countDocuments(visibleFilter),
  ])

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  }
}

export async function listTeacherCourses(teacherId) {
  const database = getDatabase()
  const targetId = parseObjectId(teacherId, 'teacherId')
  const teacher = await database.collection('users').findOne(
    excludeLegacySampleUsers({ _id: targetId, role: 'teacher', status: { $ne: 'removed' } }),
    { projection: { uid: 1 } },
  )
  if (!teacher) {
    const error = new Error('Teacher not found')
    error.status = 404
    error.code = 'TEACHER_NOT_FOUND'
    throw error
  }
  const listings = await database.collection('listings').find(
    { teacherUid: teacher.uid, status: { $ne: 'removed' } },
    { projection: { teacherUid: 0, platformId: 0, removedAt: 0, removedBy: 0 } },
  ).sort({ createdAt: -1 }).toArray()
  const listingIds = listings.map((listing) => listing._id)
  const enrollments = listingIds.length
    ? await database.collection('studentEnrollments').aggregate([
      { $match: { listingId: { $in: listingIds }, status: 'active' } },
      { $group: { _id: { listingId: '$listingId', studentUid: '$studentUid' } } },
    ]).toArray()
    : []
  const countsByListing = new Map()
  const teacherStudentUids = new Set()
  for (const enrollment of enrollments) {
    const listingKey = String(enrollment._id.listingId)
    countsByListing.set(listingKey, (countsByListing.get(listingKey) || 0) + 1)
    if (enrollment._id.studentUid) teacherStudentUids.add(enrollment._id.studentUid)
  }
  const courses = listings.map((listing) => ({
    ...listing,
    enrolledStudents: countsByListing.get(String(listing._id)) || 0,
  }))
  return {
    courses,
    totalStudents: teacherStudentUids.size,
    totalEnrollments: courses.reduce((total, course) => total + course.enrolledStudents, 0),
  }
}

export async function listCourseStudents(teacherId, listingId) {
  const database = getDatabase()
  const targetId = parseObjectId(teacherId, 'teacherId')
  const courseId = parseObjectId(listingId, 'listingId')
  const teacher = await database.collection('users').findOne(
    excludeLegacySampleUsers({ _id: targetId, role: 'teacher', status: { $ne: 'removed' } }),
    { projection: { uid: 1 } },
  )
  if (!teacher) {
    const error = new Error('Teacher not found')
    error.status = 404
    error.code = 'TEACHER_NOT_FOUND'
    throw error
  }
  const listing = await database.collection('listings').findOne(
    { _id: courseId, teacherUid: teacher.uid, status: { $ne: 'removed' } },
    { projection: { _id: 1, name: 1 } },
  )
  if (!listing) {
    const error = new Error('Course not found for this teacher')
    error.status = 404
    error.code = 'COURSE_NOT_FOUND'
    throw error
  }
  const enrollmentRecords = await database.collection('studentEnrollments').find(
    { listingId: courseId, status: 'active' },
    { projection: { studentUid: 1, studentName: 1, studentEmail: 1, enrolledAt: 1, paymentStatus: 1 } },
  ).sort({ enrolledAt: -1 }).toArray()
  const studentsByUid = new Map()
  for (const enrollment of enrollmentRecords) {
    if (enrollment.studentUid && !studentsByUid.has(enrollment.studentUid)) {
      studentsByUid.set(enrollment.studentUid, enrollment)
    }
  }
  const students = [...studentsByUid.values()]
  return { listing, students, studentCount: students.length }
}

export async function softDeleteTenantUser(req, userId) {
  const targetId = parseObjectId(userId, 'userId')
  const database = getDatabase()
  const targetUser = await database.collection('users').findOne({ _id: targetId, status: { $ne: 'removed' } })

  if (!targetUser) {
    const error = new Error('User not found')
    error.status = 404
    error.code = 'USER_NOT_FOUND'
    throw error
  }

  // Admin cannot remove their own account or another admin account.
  if (req.user.role === 'admin') {
    if (String(targetUser._id) === String(req.user._id) || targetUser.uid === req.user.uid) {
      const error = new Error('Admins cannot delete their own account')
      error.status = 403
      error.code = 'SELF_DELETION_FORBIDDEN'
      throw error
    }
    if (targetUser.role === 'admin' || targetUser.role === 'superAdmin') {
      const error = new Error('The TeachOS admin cannot remove another admin account.')
      error.status = 403
      error.code = 'ADMIN_DELETION_FORBIDDEN'
      throw error
    }
  }

  const now = new Date()
  await database.collection('users').updateOne(
    { _id: targetId },
    { $set: { status: 'removed', removedAt: now, removedBy: req.authUid, updatedAt: now } }
  )

  await writeAuditLog({
    platformId: targetUser.platformId,
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'SOFT_DELETE_USER',
    targetType: 'user',
    targetId,
    meta: { targetRole: targetUser.role, targetEmail: targetUser.email },
  })

  return { message: 'User successfully deactivated', id: userId }
}
