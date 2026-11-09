import { Router } from 'express'
import { getDatabase } from '../db.js'
import { requireRole, requireTeacherSubscriptionAccess, verifyToken } from '../middleware/auth.js'
import { parseObjectId, sanitizeInput, validateSchema } from '../utils/validation.js'
import * as courseManagementService from '../services/courseManagement.service.js'
import {
  completeGoogleAuthorization,
  createGoogleAuthorizationUrl,
  disconnectGoogleAccount,
  getGoogleMeetConfiguration,
} from '../services/googleMeet.service.js'

export const courseManagementRouter = Router()

courseManagementRouter.get('/google-meet/callback', async (req, res) => {
  try {
    const redirectUrl = await completeGoogleAuthorization({
      code: req.query.code,
      state: req.query.state,
      oauthError: req.query.error,
    })
    res.redirect(redirectUrl)
  } catch (error) {
    const frontendOrigin = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim()
    const destination = new URL('/dashboard/teaching-studio', frontendOrigin)
    destination.searchParams.set('tab', 'live')
    destination.searchParams.set('googleMeet', 'error')
    console.error('Google Meet OAuth callback failed:', error.message)
    res.redirect(destination.toString())
  }
})

courseManagementRouter.use(verifyToken, requireRole('teacher'), requireTeacherSubscriptionAccess)

courseManagementRouter.get('/google-meet/status', async (req, res) => {
  const configuration = getGoogleMeetConfiguration()
  const user = await getDatabase().collection('users').findOne(
    { uid: req.user.uid },
    { projection: { 'googleMeet.connectedAt': 1 } },
  )
  res.json({
    ...configuration,
    connected: Boolean(user?.googleMeet?.connectedAt),
  })
})

courseManagementRouter.get('/google-meet/connect', async (req, res, next) => {
  try {
    if (Object.keys(req.query).some((key) => key !== 'listingId') ||
        (req.query.listingId !== undefined && typeof req.query.listingId !== 'string')) {
      const error = new Error('Only a valid listingId query parameter is allowed.')
      error.status = 400
      error.code = 'INVALID_GOOGLE_OAUTH_QUERY'
      throw error
    }
    const listingId = req.query.listingId ? String(parseObjectId(req.query.listingId, 'listingId')) : ''
    const authorizationUrl = await createGoogleAuthorizationUrl({ uid: req.user.uid, role: req.user.role, listingId })
    res.json({ authorizationUrl })
  } catch (error) { next(error) }
})

courseManagementRouter.delete('/google-meet/connection', async (req, res, next) => {
  try {
    await disconnectGoogleAccount({ uid: req.user.uid, role: req.user.role })
    res.json({ connected: false })
  } catch (error) { next(error) }
})

const ALLOWED_SOURCES = ['youtube', 'vimeo', 'gdrive', 'direct']
const MAX_COURSE_VIDEO_SIZE = 200 * 1024 * 1024

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

courseManagementRouter.post('/:listingId/videos', async (req, res, next) => {
  try {
    const rawFileName = req.get('X-File-Name')
    let fileName
    try {
      fileName = decodeURIComponent(rawFileName || '').split(/[\\/]/).pop()
    } catch {
      const error = new Error('Video file name is invalid.')
      error.status = 400
      error.code = 'INVALID_VIDEO_FILE'
      throw error
    }
    const contentType = req.get('Content-Type') || 'application/octet-stream'
    const declaredSize = Number(req.get('Content-Length'))
    if (!fileName || fileName.length > 200 ||
        (Number.isFinite(declaredSize) && declaredSize > MAX_COURSE_VIDEO_SIZE)) {
      const error = new Error('Choose a video file up to 200 MB.')
      error.status = declaredSize > MAX_COURSE_VIDEO_SIZE ? 413 : 400
      error.code = declaredSize > MAX_COURSE_VIDEO_SIZE ? 'VIDEO_TOO_LARGE' : 'INVALID_VIDEO_FILE'
      throw error
    }
    const video = await courseManagementService.uploadCourseVideo({
      req,
      listingId: req.params.listingId,
      fileName,
      contentType,
    })
    res.status(201).json({ video })
  } catch (error) { next(error) }
})

courseManagementRouter.get('/:listingId/videos/:videoId', async (req, res, next) => {
  try {
    await courseManagementService.listLessons({ req, listingId: req.params.listingId })
    await courseManagementService.streamCourseVideo({
      res,
      listingId: String(parseObjectId(req.params.listingId, 'listingId')),
      videoId: req.params.videoId,
    })
  } catch (error) { next(error) }
})

function validateLiveSessionBody(body) {
  validateSchema(body, {
    title: { required: true, type: 'string', min: 3, max: 200 },
    curriculumLessonId: { required: false, type: 'string', min: 24, max: 24 },
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
    createMeet: { required: false, type: 'boolean' },
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
  if (body.createMeet && !body.scheduledAt) {
    const error = new Error('Choose a scheduled date and time before creating a Google Meet.')
    error.status = 400
    error.code = 'MEET_SCHEDULE_REQUIRED'
    throw error
  }
}

function validateCurriculumScheduleBody(body) {
  validateSchema(body, {
    startDate: { required: true, type: 'string', min: 10, max: 10 },
    startTime: { required: true, type: 'string', min: 5, max: 5 },
    meetLink: { required: false, type: 'string', max: 2048 },
    targetBatch: { required: false, type: 'string', max: 200 },
    autoAttendance: { required: false, type: 'boolean' },
    autoRecording: { required: false, type: 'boolean' },
    notifyStudents: { required: false, type: 'boolean' },
  })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.startDate) ||
      Number.isNaN(Date.parse(`${body.startDate}T00:00:00Z`)) ||
      new Date(`${body.startDate}T00:00:00Z`).toISOString().slice(0, 10) !== body.startDate) {
    const error = new Error('Start date must be a valid calendar date.')
    error.status = 400
    error.code = 'INVALID_START_DATE'
    throw error
  }
  const todayInDhaka = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())
  if (body.startDate < todayInDhaka) {
    const error = new Error('First class date must be today or later in Dhaka time.')
    error.status = 400
    error.code = 'START_DATE_IN_PAST'
    throw error
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(body.startTime)) {
    const error = new Error('Start time must use 24-hour HH:mm format.')
    error.status = 400
    error.code = 'INVALID_START_TIME'
    throw error
  }
  if (!Array.isArray(body.daysOfWeek) || !body.daysOfWeek.length ||
      body.daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
      new Set(body.daysOfWeek).size !== body.daysOfWeek.length) {
    const error = new Error('Select one or more distinct weekdays for the schedule.')
    error.status = 400
    error.code = 'INVALID_SCHEDULE_DAYS'
    throw error
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

courseManagementRouter.post('/:listingId/lessons', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['moduleId', 'title', 'description', 'source', 'videoUrl', 'fileId', 'thumbnailUrl', 'duration', 'lessonNumber', 'isFreePreview', 'isLockedAfterCompletion', 'lectureNotesUrl', 'published'])
    validateLessonBody(body)
    if (!body.videoUrl && !body.fileId) {
      const error = new Error('Add a recorded video URL before submitting the lesson.')
      error.status = 400
      error.code = 'LESSON_VIDEO_REQUIRED'
      throw error
    }
    const lesson = await courseManagementService.createLesson({ req, listingId: req.params.listingId, data: body })
    res.status(201).json({ lesson })
  } catch (error) { next(error) }
})

courseManagementRouter.post('/:listingId/modules/:moduleId/lessons', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['moduleId', 'title', 'description', 'source', 'videoUrl', 'fileId', 'thumbnailUrl', 'duration', 'lessonNumber', 'isFreePreview', 'isLockedAfterCompletion', 'lectureNotesUrl', 'published'])
    body.moduleId = body.moduleId || req.params.moduleId
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
    const body = sanitizeInput(req.body, ['title', 'curriculumLessonId', 'meetLink', 'meetId', 'status', 'scheduledAt', 'startedAt', 'endedAt', 'targetBatch', 'autoAttendance', 'autoRecording', 'notifyStudents', 'rtmpRelay', 'createMeet'])
    validateLiveSessionBody(body)
    const session = await courseManagementService.createLiveSession({ req, listingId: req.params.listingId, data: body })
    res.status(201).json({ session })
  } catch (error) { next(error) }
})

courseManagementRouter.post('/:listingId/live-sessions/curriculum', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['startDate', 'startTime', 'daysOfWeek', 'meetLink', 'targetBatch', 'autoAttendance', 'autoRecording', 'notifyStudents'])
    validateCurriculumScheduleBody(body)
    const result = await courseManagementService.createCurriculumLiveSessions({ req, listingId: req.params.listingId, data: body })
    res.status(201).json(result)
  } catch (error) { next(error) }
})

courseManagementRouter.put('/:listingId/live-sessions/:sessionId', async (req, res, next) => {
  try {
    const body = sanitizeInput(req.body, ['title', 'curriculumLessonId', 'meetLink', 'meetId', 'status', 'scheduledAt', 'startedAt', 'endedAt', 'targetBatch', 'autoAttendance', 'autoRecording', 'notifyStudents', 'rtmpRelay', 'createMeet'])
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

/* ── Course Publishing ── */

courseManagementRouter.post('/:listingId/publish', async (req, res, next) => {
  try {
    const result = await courseManagementService.publishCourse({ req, listingId: req.params.listingId })
    res.json(result)
  } catch (error) { next(error) }
})

courseManagementRouter.post('/:listingId/unpublish', async (req, res, next) => {
  try {
    const result = await courseManagementService.unpublishCourse({ req, listingId: req.params.listingId })
    res.json(result)
  } catch (error) { next(error) }
})
