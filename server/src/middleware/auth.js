import { createRemoteJWKSet, jwtVerify } from 'jose'
import { ObjectId } from 'mongodb'
import { getDatabase } from '../db.js'

const firebaseProjectId = process.env.FIREBASE_PROJECT_ID
const firebaseJwkSet = firebaseProjectId
  ? createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'))
  : null

/**
 * Middleware: verifyToken
 * 1. Verifies Bearer token with Firebase JWKS (or demo token in non-production).
 * 2. Fetches user from MongoDB `users` collection.
 * 3. Never trusts role, platformId, or uid from client request body/headers.
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

  // Support local demo tokens in development
  if (process.env.NODE_ENV !== 'production' && token.startsWith('demo-')) {
    uid = token
  } else {
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
    } catch (error) {
      return res.status(401).json({
        message: 'Invalid or expired authentication token. Please sign in again.',
        code: 'INVALID_TOKEN',
      })
    }
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
      // In demo mode or newly registered account that has not synced profile yet
      const role = uid.toLowerCase().includes('superadmin')
        ? 'superAdmin'
        : uid.toLowerCase().includes('teacher')
          ? 'teacher'
          : uid.toLowerCase().includes('admin')
            ? 'admin'
            : 'student'

      req.authUid = uid
      req.user = {
        uid,
        email: `${uid}@example.com`,
        role,
        platformId: null,
      }
      return next()
    }

    req.authUid = uid
    req.user = {
      _id: userDoc._id,
      uid: userDoc.uid,
      email: userDoc.email,
      role: userDoc.role || 'student',
      platformId: userDoc.platformId ? new ObjectId(userDoc.platformId) : null,
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
 * Roles: superAdmin, admin, teacher, student
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: 'Authentication required before role verification.',
        code: 'UNAUTHENTICATED',
      })
    }

    if (req.user.role === 'superAdmin' || allowedRoles.includes(req.user.role)) {
      return next()
    }

    return res.status(403).json({
      message: `Access denied. Requires one of: [${allowedRoles.join(', ')}]`,
      code: 'FORBIDDEN',
    })
  }
}

/**
 * Middleware: requirePlatformActive
 * Checks tenant platform status and renewal dates.
 * - superAdmin is never blocked.
 * - Suspended or expired platforms are blocked with 403 code PLATFORM_SUSPENDED.
 * - Admin can still access /api/admin/billing to view why they are blocked.
 */
export async function requirePlatformActive(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      message: 'Authentication required.',
      code: 'UNAUTHENTICATED',
    })
  }

  // superAdmin is NEVER blocked by tenant status
  if (req.user.role === 'superAdmin') {
    req.platform = null
    return next()
  }

  if (!req.user.platformId) {
    if (process.env.NODE_ENV !== 'production' && req.authUid?.startsWith('demo-')) {
      req.platform = { _id: 'demo-platform-id', name: 'Demo Platform', status: 'active' }
      return next()
    }
    return res.status(403).json({
      message: 'Your account is not linked to any tenant platform.',
      code: 'NO_PLATFORM_ASSOCIATED',
    })
  }

  try {
    const database = getDatabase()
    const platform = await database.collection('platforms').findOne({
      _id: req.user.platformId,
      status: { $ne: 'removed' },
    })

    if (!platform) {
      return res.status(404).json({
        message: 'Platform not found or has been removed.',
        code: 'PLATFORM_NOT_FOUND',
      })
    }

    // Check suspension & expiration
    const isSuspended = platform.status === 'suspended'
    const renewalDate = platform.renewalDate ? new Date(platform.renewalDate) : null
    const graceDays = typeof platform.gracePeriodDays === 'number' ? platform.gracePeriodDays : 7
    const isExpired = renewalDate
      ? Date.now() > (renewalDate.getTime() + graceDays * 86400000)
      : false

    if (isSuspended || isExpired) {
      // Admin is permitted to access GET /api/admin/billing to review account suspension
      const isBillingRoute = req.originalUrl.includes('/admin/billing') || req.path.includes('/billing')
      if (req.user.role === 'admin' && req.method === 'GET' && isBillingRoute) {
        req.platform = platform
        return next()
      }

      return res.status(403).json({
        message: isSuspended
          ? 'Platform access suspended by administration.'
          : 'Platform subscription renewal grace period has expired.',
        code: 'PLATFORM_SUSPENDED',
      })
    }

    req.platform = platform
    next()
  } catch (error) {
    next(error)
  }
}
