import { Router } from 'express'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'
import { writeAuditLog } from '../services/audit.service.js'
import { tenantInsert, tenantQuery } from '../utils/tenant.js'
import { sanitizeInput, validateSchema } from '../utils/validation.js'

export const courseRouter = Router()

courseRouter.get('/courses', verifyToken, requireRole('teacher'), async (req, res, next) => {
  try {
    if (Object.keys(req.query).length) {
      const error = new Error('The course catalog does not accept query parameters.')
      error.status = 400
      error.code = 'UNKNOWN_QUERY_PARAMETER'
      throw error
    }

    const courses = await getDatabase().collection('courses')
      .find(
        tenantQuery(req, {}, 'teacherUid'),
        { projection: { teacherUid: 0, removedAt: 0, removedBy: 0 } },
      )
      .sort({ name: 1, createdAt: -1 })
      .toArray()

    res.json({ courses })
  } catch (error) {
    next(error)
  }
})

courseRouter.post('/courses', verifyToken, requireRole('teacher'), async (req, res, next) => {
  try {
    if (Object.keys(req.query).length) {
      const error = new Error('The course catalog does not accept query parameters.')
      error.status = 400
      error.code = 'UNKNOWN_QUERY_PARAMETER'
      throw error
    }

    const body = sanitizeInput(req.body, ['name', 'deliveryMode', 'description'])
    validateSchema(body, {
      name: { required: true, type: 'string', min: 3, max: 150 },
      deliveryMode: { required: true, type: 'string', enum: ['live', 'recorded'] },
      description: { required: false, type: 'string', max: 1000 },
    })

    const database = getDatabase()
    const course = tenantInsert(req, {
      name: body.name.trim(),
      category: 'Online',
      deliveryMode: body.deliveryMode,
      description: body.description?.trim() || '',
      teacherName: req.user.fullName || req.user.email,
      email: req.user.email,
    }, 'teacherUid')
    const existingCourse = await database.collection('courses').findOne(
      { teacherUid: req.authUid, name: course.name },
      { collation: { locale: 'en', strength: 2 } },
    )
    if (existingCourse) {
      return res.status(409).json({
        message: 'A course with this name already exists in your catalog.',
        code: 'COURSE_ALREADY_EXISTS',
      })
    }

    const result = await database.collection('courses').insertOne(course)
    const createdCourse = { _id: result.insertedId, ...course }

    await writeAuditLog({
      actorUid: req.authUid,
      actorRole: req.user.role,
      action: 'CREATE_COURSE',
      targetType: 'course',
      targetId: result.insertedId,
      meta: { name: course.name, category: course.category, deliveryMode: course.deliveryMode },
    })

    res.status(201).json({ course: createdCourse, message: 'Course created successfully' })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: 'A course with this name already exists in your catalog.',
        code: 'COURSE_ALREADY_EXISTS',
      })
    }
    next(error)
  }
})
