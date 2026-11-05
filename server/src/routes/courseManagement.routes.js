import { Router } from 'express'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'
import { parseObjectId, sanitizeInput, validateSchema } from '../utils/validation.js'
import * as courseManagementService from '../services/courseManagement.service.js'

export const courseManagementRouter = Router()

courseManagementRouter.use('/course-management', verifyToken, requireRole('teacher'))

const ALLOWED_SOURCES = ['youtube', 'vimeo', 'gdrive', 'direct']

function isValidUrl(value) {
  if (!value || typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

function validateModuleBody(body) {
  validateSchema(body, {
    name: { required: true, type: 'string', min: 3, max: 150 },
    description: { required: false, type: 'string', max: 1000 },
    status: { required: false, type: 'string', enum: ['active', 'draft', 'completed'] },
    order: { required: false, type: 'number' },
  })
}

function validateLessonBody(body) {
  validateSchema(body, {
    moduleId: { required: false, type: 'string', min: 24, max: 24 },
    title: { required: true, type: 'string', min: 3, max: 200 },
    description: { required: false, type: 'string', max: 3000 },
    source: { required: false, type: 'string', enum: ALLOWED_SOURCES },
    videoUrl: { required: false, type: 'string', max: 2048 },
    fileId: { required: false, type: 'string', max: 128 },
    thumbnailUrl: { required: false, type: 'string', max: 2048 },
    duration: { required: false, type: 'string', max: 50 },
    lessonNumber: { required: false, type: 'number' },
    isFreePreview: { required: false, type: 'boolean' },
    isLockedAfterCompletion: { required: false, type: 'boolean' },
    lectureNotesUrl: { required: false, type: 'string', max: 2048 },
    published: { required: false, type: 'boolean' },
  })
  if (body.videoUrl !== undefined && body.videoUrl !== null && body.videoUrl !== '' && !isValidUrl(body.videoUrl)) {
    const error = new Error('Video URL must be a valid HTTP or HTTPS URL.')
    error.status = 400
    error.code = 'INVALID_VIDEO_URL'
    throw error
  }
  if (body.thumbnailUrl !== undefined && body.thumbnailUrl !== null && body.thumbnailUrl !== '' && !isValidUrl(body.thumbnailUrl)) {
    const error = new Error('Thumbnail URL must be a valid HTTP or HTTPS URL.')
    error.status = 400
    error.code = 'INVALID_THUMBNAIL_URL'
    throw error
  }
  if (body.lectureNotesUrl !== undefined && body.lectureNotesUrl !== null && body.lectureNotesUrl !== '' && !isValidUrl(body.lectureNotesUrl)) {
    const error = new Error('Lecture notes URL must be a valid HTTP or HTTPS URL.')
    error.status = 400
    error.code = 'INVALID_LECTURE_NOTES_URL'
    throw error
  }
}

function validateLiveSessionBody(body) {
  validateSchema(body, {
    title: { required: true, type: 'string', min: 3, max: 200 },
    meetLink: { required: false, type: 'string', max: 2048 },
    meetId: { required: false, type: 'string', max: 128 },
    status: { required: false, type: 'string', enum: ['scheduled', 'live', 'completed', 'cancelled'] },
    scheduledAt: { required: false, type: 'string' },
    startedAt: { required: false, type: 'string' },
    endedAt: { required: false, type: 'string' },
    targetBatch: { required: false, type: 'string', max: 200 },
    autoAttendance: { required: false, type: 'boolean' },
    autoRecording: { required: false, type: 'boolean' },
    notifyStudents: { required: false, type: 'boolean' },
    rtmpRelay: { required: false, type: 'boolean' },
  })
  for (const field of ['scheduledAt', 'startedAt', 'endedAt']) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
      const valid = typeof body[field] === 'string' && !Number.isNaN(Date.parse(body[field]))
      if (!valid) {
        const error = new Error(`Field '${field}' must be a valid date/time.`)
        error.status = 400
        error.code = 'INVALID_DATETIME'
        throw error
      }
    }
  }
}

function validateAttendanceRecords(body) {
  validateSchema(body, {
    records: { required: true },
  })
  if (!Array.isArray(body.records) || body.records.length === 0) {
    const error = new Error('Records must be a non-empty array.')
    error.status = 400
    error.code = 'INVALID_RECORDS'
    throw error
  }
  if (body.records.length > 500) {
    const error = new Error('Cannot record more than 500 attendance records at once.')
    error.status = 400
    error.code = 'TOO_MANY_RECORDS'
    throw error
  }
  for (const record of body.records) {
    if (!record || typeof record !== 'object') {
      const error = new Error('Each record must be an object.')
      error.status = 400
      error.code = 'INVALID_RECORD'
      throw error
    }
    if (!record.studentUid || typeof record.studentUid !== 'string') {
      const error = new Error('Each record must have a studentUid.')
      error.status = 400
      error.code = 'INVALID_RECORD'
      throw error
    }
    if (!record.studentName || typeof record.studentName !== 'string') {
      const error = new Error('Each record must have a studentName.')
      error.status = 400
      error.code = 'INVALID_RECORD'
      throw error
    }
    if (!['present', 'absent', 'late'].includes(record.status)) {
      const error = new Error('Each record must have a valid status: present, absent, or late.')
      error.status = 400
      error.code = 'INVALID_RECORD'
      throw error
    }
  }
}

/* ── Modules ── */

courseManagementRouter.get('/:listingId/modules', async (req, res, next) => {
  try {
    const modules = await courseManagementService.listModules({ req, listingId: req.params.listingId })
    res.json({ modules })
  } catch (error) { next(error) }
})

courseManagementRouter.post('/:listingId/modules', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['name', 'description', 'status', 'order'])
    validateModuleBody(body)
    const moduleDoc = await courseManagementService.createModule({ req, listingId: req.params.listingId, data: body })
    res.status(201).json({ module: moduleDoc })
  } catch (error) { next(error) }
})

courseManagementRouter.put('/:listingId/modules/:moduleId', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['name', 'description', 'status', 'order'])
    validateModuleBody(body)
    const moduleDoc = await courseManagementService.updateModule({ req, listingId: req.params.listingId, moduleId: req.params.moduleId, data: body })
    res.json({ module: moduleDoc })
  } catch (error) { next(error) }
})

courseManagementRouter.delete('/:listingId/modules/:moduleId', async (req, res, next) => {
  try {
    const result = await courseManagementService.deleteModule({ req, listingId: req.params.listingId, moduleId: req.params.moduleId })
    res.json(result)
  } catch (error) { next(error) }
})

/* ── Lessons ── */

courseManagementRouter.get('/:listingId/modules/:moduleId/lessons', async (req, res, next) => {
  try {
    const lessons = await courseManagementService.listLessons({ req, listingId: req.params.listingId, moduleId: req.params.moduleId })
    res.json({ lessons })
  } catch (error) { next(error) }
})

courseManagementRouter.get('/:listingId/lessons', async (req, res, next) => {
  try {
    const lessons = await courseManagementService.listLessons({ req, listingId: req.params.listingId })
    res.json({ lessons })
  } catch (error) { next(error) }
})

courseManagementRouter.post('/:listingId/modules/:moduleId/lessons', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['moduleId', 'title', 'description', 'source', 'videoUrl', 'fileId', 'thumbnailUrl', 'duration', 'lessonNumber', 'isFreePreview', 'isLockedAfterCompletion', 'lectureNotesUrl', 'published'])
    validateLessonBody(body)
    const lesson = await courseManagementService.createLesson({ req, listingId: req.params.listingId, data: body })
    res.status(201).json({ lesson })
  } catch (error) { next(error) }
})

courseManagementRouter.put('/:listingId/lessons/:lessonId', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['moduleId', 'title', 'description', 'source', 'videoUrl', 'fileId', 'thumbnailUrl', 'duration', 'lessonNumber', 'isFreePreview', 'isLockedAfterCompletion', 'lectureNotesUrl', 'published'])
    validateLessonBody(body)
    const lesson = await courseManagementService.updateLesson({ req, listingId: req.params.listingId, lessonId: req.params.lessonId, data: body })
    res.json({ lesson })
  } catch (error) { next(error) }
})

courseManagementRouter.delete('/:listingId/lessons/:lessonId', async (req, res, next) => {
  try {
    const result = await courseManagementService.deleteLesson({ req, listingId: req.params.listingId, lessonId: req.params.lessonId })
    res.json(result)
  } catch (error) { next(error) }
})

/* ── Live Sessions ── */

courseManagementRouter.get('/:listingId/live-sessions', async (req, res, next) => {
  try {
    const sessions = await courseManagementService.listLiveSessions({ req, listingId: req.params.listingId })
    res.json({ sessions })
  } catch (error) { next(error) }
})

courseManagementRouter.post('/:listingId/live-sessions', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['title', 'meetLink', 'meetId', 'status', 'scheduledAt', 'startedAt', 'endedAt', 'targetBatch', 'autoAttendance', 'autoRecording', 'notifyStudents', 'rtmpRelay'])
    validateLiveSessionBody(body)
    const session = await courseManagementService.createLiveSession({ req, listingId: req.params.listingId, data: body })
    res.status(201).json({ session })
  } catch (error) { next(error) }
})

courseManagementRouter.put('/:listingId/live-sessions/:sessionId', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['title', 'meetLink', 'meetId', 'status', 'scheduledAt', 'startedAt', 'endedAt', 'targetBatch', 'autoAttendance', 'autoRecording', 'notifyStudents', 'rtmpRelay'])
    validateLiveSessionBody(body)
    const session = await courseManagementService.updateLiveSession({ req, listingId: req.params.listingId, sessionId: req.params.sessionId, data: body })
    res.json({ session })
  } catch (error) { next(error) }
})

courseManagementRouter.delete('/:listingId/live-sessions/:sessionId', async (req, res, next) => {
  try {
    const result = await courseManagementService.deleteLiveSession({ req, listingId: req.params.listingId, sessionId: req.params.sessionId })
    res.json(result)
  } catch (error) { next(error) }
})

/* ── Session Attendance ── */

courseManagementRouter.get('/:listingId/attendance', async (req, res, next) => {
  try {
    const records = await courseManagementService.listSessionAttendance({ req, listingId: req.params.listingId, sessionId: req.query.sessionId })
    res.json({ records })
  } catch (error) { next(error) }
})

courseManagementRouter.post('/:listingId/attendance', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['records'])
    validateAttendanceRecords(body)
    const result = await courseManagementService.recordSessionAttendance({ req, listingId: req.params.listingId, sessionId: req.body.sessionId, data: body })
    res.status(201).json(result)
  } catch (error) { next(error) }
})

courseManagementRouter.get('/:listingId/attendance/export', async (req, res, next) => {
  try {
    const csv = await courseManagementService.exportSessionAttendanceCSV({ req, listingId: req.params.listingId, sessionId: req.query.sessionId })
    res.setHeader('Content-Type', 'text/csv;charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="teachos-attendance-${req.params.listingId}.csv"`)
    res.send(csv)
  } catch (error) { next(error) }
})

/* ── Google Meet Status ── */

courseManagementRouter.get('/google-meet/status', async (_req, res) => {
  const configured = Boolean(process.env.GOOGLE_MEET_CLIENT_ID && process.env.GOOGLE_MEET_CLIENT_SECRET)
  res.json({
    connected: false,
    configured,
    message: configured
      ? 'Google Meet OAuth is configured. Connect your Google account to create Meet sessions.'
      : 'Google Meet is not configured. Set GOOGLE_MEET_CLIENT_ID and GOOGLE_MEET_CLIENT_SECRET in server/.env.',
  })
})

/* ── Course Publishing ── */

courseManagementRouter.post('/:listingId/publish', async (req, res, next) => {
  try {
    const result = await courseManagementService.publishCourse({ req, listingId: req.params.listingId })
    res.json(result)
  } catch (error) { next(error) }
})
