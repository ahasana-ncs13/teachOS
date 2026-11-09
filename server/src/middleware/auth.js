import { createRemoteJWKSet, jwtVerify } from 'jose'
import { getDatabase } from '../db.js'
import { getTeacherSubscription } from '../services/teacherSubscription.service.js'

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID
const firebaseJwkSet = firebaseProjectId
  ? createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'))
  : null

/**
 * Middleware: verifyToken
 * Verifies the Firebase identity and loads its canonical role from MongoDB.
 * A missing Firebase profile is not granted an inferred role.
 */
export async function verifyToken(req, res, next) {
  const authHeader = req.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Authentication required. Please provide a Bearer token.',
      code: 'UNAUTHENTICATED',
    })
  }

  const token = authHeader.slice('Bearer '.length).trim()
  let uid = null

  if (!firebaseJwkSet) {
    return res.status(503).json({
      message: 'Authentication service not configured (FIREBASE_PROJECT_ID is missing).',
      code: 'AUTH_NOT_CONFIGURED',
    })
  }

  try {
    const { payload } = await jwtVerify(token, firebaseJwkSet, {
      algorithms: ['RS256'],
      issuer: `https://securetoken.google.com/${firebaseProjectId}`,
      audience: firebaseProjectId,
    })
    uid = payload.sub
  } catch {
    return res.status(401).json({
      message: 'Invalid or expired authentication token. Please sign in again.',
      code: 'INVALID_TOKEN',
    })
  }

  if (!uid) {
    return res.status(401).json({
      message: 'Invalid user token identification.',
      code: 'INVALID_UID',
    })
  }

  try {
    const database = getDatabase()
    const userDoc = await database.collection('users').findOne({ uid })

    if (!userDoc) {
      return res.status(403).json({
        message: 'Your account profile is not set up yet. Please register or contact TeachOS support.',
        code: 'USER_PROFILE_REQUIRED',
      })
    }

    const role = userDoc.role === 'superAdmin' ? 'admin' : userDoc.role
    if (!['admin', 'teacher', 'student'].includes(role)) {
      return res.status(403).json({
        message: 'Your account has an invalid role. Please contact TeachOS support.',
        code: 'INVALID_ACCOUNT_ROLE',
      })
    }

    req.authUid = uid
    req.user = {
      _id: userDoc._id,
      uid: userDoc.uid,
      email: userDoc.email,
      role,
      platformId: userDoc.platformId || null,
      fullName: userDoc.fullName || userDoc.displayName || '',
      status: userDoc.status || 'active',
    }

    if (req.user.status === 'removed') {
      return res.status(403).json({
        message: 'This user account has been deactivated.',
        code: 'ACCOUNT_DEACTIVATED',
      })
    }

    next()
  } catch (error) {
    next(error)
  }
}

/**
 * Middleware: requireRole
 * Enforces role-based access control.
 * Roles: admin, teacher, student. Admin is the global TeachOS owner.
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: 'Authentication required before role verification.',
        code: 'UNAUTHENTICATED',
      })
    }

    if (req.user.role === 'admin' || allowedRoles.includes(req.user.role)) {
      return next()
    }

    return res.status(403).json({
      message: `Access denied. Requires one of: [${allowedRoles.join(', ')}]`,
      code: 'FORBIDDEN',
    })
  }
}

export async function requireTeacherSubscriptionAccess(req, res, next) {
  if (req.user?.role !== 'teacher' || req.method === 'GET') return next()
  try {
    const subscription = await getTeacherSubscription(getDatabase(), req.authUid)
    if (subscription.status === 'past_due' || subscription.status === 'suspended') {
      return res.status(402).json({
        message: subscription.status === 'suspended'
          ? 'Your teacher workspace is suspended after three unpaid platform-fee warnings. Settle the balance to restore access.'
          : 'Your income-based platform fee is due. Settle the balance to continue using teacher tools.',
        code: subscription.status === 'suspended' ? 'TEACHER_ACCOUNT_SUSPENDED' : 'TEACHER_SUBSCRIPTION_PAYMENT_REQUIRED',
        subscription,
      })
    }
    return next()
  } catch (error) {
    return next(error)
  }
}

/**
 * Middleware: requirePlatformActive
 * Non-blocking pass-through in the simplified 3-role model (Admin, Teacher, Student).
 */
export async function requirePlatformActive(_req, _res, next) {
  return next()
}
