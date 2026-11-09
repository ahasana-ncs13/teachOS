import { getDatabase } from '../db.js'
import { randomUUID } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { GridFSBucket, ObjectId } from 'mongodb'
import { parseObjectId } from '../utils/validation.js'
import { writeAuditLog } from './audit.service.js'
import { createGoogleMeetEvent, deleteGoogleCalendarEvent } from './googleMeet.service.js'
import { notifyListingStudents } from './notification.service.js'

const MODULES_COLLECTION = 'courseModules'
const LESSONS_COLLECTION = 'courseLessons'
const LIVE_SESSIONS_COLLECTION = 'liveSessions'
const SESSION_ATTENDANCE_COLLECTION = 'sessionAttendance'
const COURSE_VIDEOS_BUCKET = 'courseVideos'
const MAX_COURSE_VIDEO_SIZE = 200 * 1024 * 1024

function serviceError(message, status, code) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function courseVideoBucket() {
  return new GridFSBucket(getDatabase(), { bucketName: COURSE_VIDEOS_BUCKET })
}

function listingOwnershipFilter(req, listingId) {
  const objectId = parseObjectId(listingId, 'listingId')
  if (req.user.role === 'admin') return { _id: objectId, status: { $ne: 'removed' } }
  return { _id: objectId, teacherUid: req.user.uid, status: { $ne: 'removed' } }
}

async function requireOwnedListing(req, listingId) {
  const database = getDatabase()
  const listing = await database.collection('listings').findOne(listingOwnershipFilter(req, listingId))
  if (!listing) {
    const error = new Error('Course not found or you do not own it.')
    error.status = 404
    error.code = 'COURSE_NOT_FOUND'
    throw error
  }
  return listing
}

/* ── Modules ── */

export async function listModules({ req, listingId }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const objectId = parseObjectId(listingId, 'listingId')
  return database.collection(MODULES_COLLECTION)
    .find({ listingId: objectId, status: { $ne: 'removed' } })
    .sort({ order: 1, createdAt: 1 })
    .toArray()
}

export async function createModule({ req, listingId, data }) {
  const listing = await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const objectId = parseObjectId(listingId, 'listingId')
  const now = new Date()
  const last = await database.collection(MODULES_COLLECTION)
    .findOne({ listingId: objectId, status: { $ne: 'removed' } }, { sort: { order: -1 } })
  const nextOrder = (last ? last.order : 0) + 1
  const moduleDoc = {
    listingId: objectId,
    teacherUid: req.user.uid,
    name: data.name.trim(),
    description: (data.description || '').trim(),
    order: nextOrder,
    status: data.status || 'active',
    createdAt: now,
    updatedAt: now,
  }
  const result = await database.collection(MODULES_COLLECTION).insertOne(moduleDoc)
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'CREATE_COURSE_MODULE',
    targetType: 'courseModule',
    targetId: result.insertedId,
    meta: { listingId, name: moduleDoc.name },
  })
  return { _id: result.insertedId, ...moduleDoc }
}

export async function updateModule({ req, listingId, moduleId, data }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const moduleObjectId = parseObjectId(moduleId, 'moduleId')
  const existing = await database.collection(MODULES_COLLECTION).findOne({ _id: moduleObjectId, listingId: parseObjectId(listingId, 'listingId') })
  if (!existing) {
    const error = new Error('Module not found.')
    error.status = 404
    error.code = 'MODULE_NOT_FOUND'
    throw error
  }
  const updates = {}
  const now = new Date()
  if (data.name !== undefined) updates.name = data.name.trim()
  if (data.description !== undefined) updates.description = data.description.trim()
  if (data.status !== undefined) updates.status = data.status
  if (data.order !== undefined) updates.order = Number(data.order)
  updates.updatedAt = now
  const result = await database.collection(MODULES_COLLECTION).findOneAndUpdate(
    { _id: moduleObjectId },
    { $set: updates },
    { returnDocument: 'after' },
  )
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'UPDATE_COURSE_MODULE',
    targetType: 'courseModule',
    targetId: moduleObjectId,
    meta: { listingId, updatedFields: Object.keys(updates) },
  })
  return result
}

export async function deleteModule({ req, listingId, moduleId }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const moduleObjectId = parseObjectId(moduleId, 'moduleId')
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const existing = await database.collection(MODULES_COLLECTION).findOne({ _id: moduleObjectId, listingId: listingObjectId })
  if (!existing) {
    const error = new Error('Module not found.')
    error.status = 404
    error.code = 'MODULE_NOT_FOUND'
    throw error
  }
  const now = new Date()
  await database.collection(MODULES_COLLECTION).updateOne({ _id: moduleObjectId }, { $set: { status: 'removed', removedAt: now, removedBy: req.authUid, updatedAt: now } })
  await database.collection(LESSONS_COLLECTION).updateMany(
    { moduleId: moduleObjectId },
    { $set: { status: 'removed', removedAt: now, removedBy: req.authUid, updatedAt: now } },
  )
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'DELETE_COURSE_MODULE',
    targetType: 'courseModule',
    targetId: moduleObjectId,
    meta: { listingId, name: existing.name },
  })
  return { message: 'Module and its lessons removed.', id: moduleId }
}

/* ── Lessons ── */

export async function uploadCourseVideo({ req, listingId, fileName, contentType }) {
  await requireOwnedListing(req, listingId)
  const extension = fileName.toLowerCase().split('.').pop()
  const supportedExtensions = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi', 'mpeg', 'mpg', '3gp'])
  if (!supportedExtensions.has(extension) ||
      (contentType !== 'application/octet-stream' && !contentType.startsWith('video/'))) {
    throw serviceError('Choose a supported video file such as MP4, WebM, MOV, or MKV.', 400, 'INVALID_VIDEO_FILE')
  }

  const listingObjectId = parseObjectId(listingId, 'listingId')
  const bucket = courseVideoBucket()
  const upload = bucket.openUploadStream(fileName, {
    metadata: {
      listingId: String(listingObjectId),
      teacherUid: req.authUid,
      contentType,
    },
  })
  let size = 0
  const sizeLimit = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      if (size > MAX_COURSE_VIDEO_SIZE) {
        callback(serviceError('Video file exceeds the 200 MB upload limit.', 413, 'VIDEO_TOO_LARGE'))
        return
      }
      callback(null, chunk)
    },
  })

  try {
    await pipeline(req, sizeLimit, upload)
  } catch (error) {
    if (upload.id) {
      try {
        await bucket.delete(upload.id)
      } catch (cleanupError) {
        console.error('Unable to remove incomplete course video upload:', cleanupError.message)
      }
    }
    throw error
  }
  if (!size) {
    await bucket.delete(upload.id)
    throw serviceError('The selected video file is empty.', 400, 'EMPTY_VIDEO_FILE')
  }

  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'UPLOAD_COURSE_VIDEO',
    targetType: 'courseVideo',
    targetId: upload.id,
    meta: { listingId, fileName, size, contentType },
  })
  return { fileId: String(upload.id), fileName, size, contentType }
}

export async function streamCourseVideo({ res, listingId, videoId }) {
  if (!ObjectId.isValid(videoId)) {
    throw serviceError('Video file not found.', 404, 'VIDEO_NOT_FOUND')
  }
  const fileId = new ObjectId(videoId)
  const database = getDatabase()
  const file = await database.collection(`${COURSE_VIDEOS_BUCKET}.files`).findOne({
    _id: fileId,
    'metadata.listingId': listingId,
  })
  if (!file) throw serviceError('Video file not found.', 404, 'VIDEO_NOT_FOUND')

  res.setHeader('Content-Type', file.metadata?.contentType || 'application/octet-stream')
  res.setHeader('Content-Length', file.length)
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
  res.setHeader('Cache-Control', 'private, no-store')
  courseVideoBucket().openDownloadStream(fileId)
    .on('error', (error) => {
      console.error('Unable to stream course video:', error.message)
      if (!res.headersSent) res.status(500).json({ message: 'Unable to load this video.', code: 'VIDEO_STREAM_FAILED' })
      else res.destroy(error)
    })
    .pipe(res)
}

export async function listLessons({ req, listingId, moduleId }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const filter = { listingId: listingObjectId, status: { $ne: 'removed' } }
  if (moduleId) filter.moduleId = parseObjectId(moduleId, 'moduleId')
  return database.collection(LESSONS_COLLECTION)
    .find(filter)
    .sort({ lessonNumber: 1, createdAt: 1 })
    .toArray()
}

export async function createLesson({ req, listingId, data }) {
  const listing = await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const now = new Date()
  const moduleObjectId = data.moduleId ? parseObjectId(data.moduleId, 'moduleId') : null
  if (data.fileId) {
    const videoFile = ObjectId.isValid(data.fileId) && await database.collection(`${COURSE_VIDEOS_BUCKET}.files`).findOne({
      _id: new ObjectId(data.fileId),
      'metadata.listingId': String(listingObjectId),
      'metadata.teacherUid': req.authUid,
    }, { projection: { _id: 1 } })
    if (!videoFile) throw serviceError('Uploaded video does not belong to this course.', 400, 'INVALID_COURSE_VIDEO')
  }
  if (moduleObjectId) {
    const module = await database.collection(MODULES_COLLECTION).findOne({
      _id: moduleObjectId,
      listingId: listingObjectId,
      status: { $ne: 'removed' },
    })
    if (!module) {
      const error = new Error('Select a module that belongs to this course.')
      error.status = 400
      error.code = 'INVALID_LESSON_MODULE'
      throw error
    }
  }
  const last = await database.collection(LESSONS_COLLECTION)
    .findOne({ listingId: listingObjectId, status: { $ne: 'removed' } }, { sort: { lessonNumber: -1 } })
  const nextNumber = (last ? last.lessonNumber : 0) + 1
  const lessonDoc = {
    listingId: listingObjectId,
    moduleId: moduleObjectId,
    teacherUid: req.user.uid,
    title: data.title.trim(),
    description: (data.description || '').trim(),
    source: data.source || 'direct',
    videoUrl: (data.videoUrl || '').trim() || null,
    fileId: data.fileId || null,
    thumbnailUrl: (data.thumbnailUrl || '').trim() || null,
    duration: (data.duration || '').trim() || null,
    lessonNumber: data.lessonNumber !== undefined ? Number(data.lessonNumber) : nextNumber,
    isFreePreview: Boolean(data.isFreePreview),
    isLockedAfterCompletion: Boolean(data.isLockedAfterCompletion),
    lectureNotesUrl: (data.lectureNotesUrl || '').trim() || null,
    views: 0,
    published: Boolean(data.published),
    publishedAt: data.published ? now : null,
    createdAt: now,
    updatedAt: now,
  }
  const result = await database.collection(LESSONS_COLLECTION).insertOne(lessonDoc)
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'CREATE_COURSE_LESSON',
    targetType: 'courseLesson',
    targetId: result.insertedId,
    meta: { listingId, moduleId: data.moduleId, title: lessonDoc.title },
  })
  const notificationsSent = lessonDoc.published
    ? await notifyListingStudents(database, listingObjectId, {
      type: 'lesson',
      title: 'New recorded lesson',
      message: `${lessonDoc.title} is now available in ${listing.courseName || listing.name}.`,
      href: `/student/course/${listingId}/learn`,
      relatedId: String(result.insertedId),
    })
    : null
  return { _id: result.insertedId, ...lessonDoc, notificationsSent }
}

export async function updateLesson({ req, listingId, lessonId, data }) {
  const listing = await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const lessonObjectId = parseObjectId(lessonId, 'lessonId')
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const existing = await database.collection(LESSONS_COLLECTION).findOne({ _id: lessonObjectId, listingId: listingObjectId })
  if (!existing) {
    const error = new Error('Lesson not found.')
    error.status = 404
    error.code = 'LESSON_NOT_FOUND'
    throw error
  }
  const updates = {}
  const now = new Date()
  if (data.title !== undefined) updates.title = data.title.trim()
  if (data.description !== undefined) updates.description = data.description.trim()
  if (data.source !== undefined) updates.source = data.source
  if (data.videoUrl !== undefined) updates.videoUrl = data.videoUrl ? data.videoUrl.trim() : null
  if (data.fileId !== undefined) {
    if (data.fileId) {
      const videoFile = ObjectId.isValid(data.fileId) && await database.collection(`${COURSE_VIDEOS_BUCKET}.files`).findOne({
        _id: new ObjectId(data.fileId),
        'metadata.listingId': String(listingObjectId),
        'metadata.teacherUid': req.authUid,
      }, { projection: { _id: 1 } })
      if (!videoFile) throw serviceError('Uploaded video does not belong to this course.', 400, 'INVALID_COURSE_VIDEO')
    }
    updates.fileId = data.fileId || null
  }
  if (data.thumbnailUrl !== undefined) updates.thumbnailUrl = data.thumbnailUrl ? data.thumbnailUrl.trim() : null
  if (data.duration !== undefined) updates.duration = data.duration ? data.duration.trim() : null
  if (data.lessonNumber !== undefined) updates.lessonNumber = Number(data.lessonNumber)
  if (data.isFreePreview !== undefined) updates.isFreePreview = Boolean(data.isFreePreview)
  if (data.isLockedAfterCompletion !== undefined) updates.isLockedAfterCompletion = Boolean(data.isLockedAfterCompletion)
  if (data.lectureNotesUrl !== undefined) updates.lectureNotesUrl = data.lectureNotesUrl ? data.lectureNotesUrl.trim() : null
  if (data.moduleId !== undefined) {
    const moduleObjectId = data.moduleId ? parseObjectId(data.moduleId, 'moduleId') : null
    if (moduleObjectId) {
      const module = await database.collection(MODULES_COLLECTION).findOne({
        _id: moduleObjectId,
        listingId: listingObjectId,
        status: { $ne: 'removed' },
      })
      if (!module) {
        const error = new Error('Select a module that belongs to this course.')
        error.status = 400
        error.code = 'INVALID_LESSON_MODULE'
        throw error
      }
    }
    updates.moduleId = moduleObjectId
  }
  if (data.published !== undefined) {
    updates.published = Boolean(data.published)
    updates.publishedAt = data.published && !existing.published ? now : (data.published ? existing.publishedAt : null)
  }
  updates.updatedAt = now
  const result = await database.collection(LESSONS_COLLECTION).findOneAndUpdate(
    { _id: lessonObjectId },
    { $set: updates },
    { returnDocument: 'after' },
  )
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'UPDATE_COURSE_LESSON',
    targetType: 'courseLesson',
    targetId: lessonObjectId,
    meta: { listingId, updatedFields: Object.keys(updates) },
  })
  const notificationsSent = data.published === true && !existing.published
    ? await notifyListingStudents(database, listingObjectId, {
      type: 'lesson',
      title: 'New recorded lesson',
      message: `${result.title} is now available in ${listing.courseName || listing.name}.`,
      href: `/student/course/${listingId}/learn`,
      relatedId: String(lessonObjectId),
    })
    : null
  return { ...result, notificationsSent }
}

export async function deleteLesson({ req, listingId, lessonId }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const lessonObjectId = parseObjectId(lessonId, 'lessonId')
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const existing = await database.collection(LESSONS_COLLECTION).findOne({ _id: lessonObjectId, listingId: listingObjectId })
  if (!existing) {
    const error = new Error('Lesson not found.')
    error.status = 404
    error.code = 'LESSON_NOT_FOUND'
    throw error
  }
  const now = new Date()
  await database.collection(LESSONS_COLLECTION).updateOne({ _id: lessonObjectId }, { $set: { status: 'removed', removedAt: now, removedBy: req.authUid, updatedAt: now } })
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'DELETE_COURSE_LESSON',
    targetType: 'courseLesson',
    targetId: lessonObjectId,
    meta: { listingId, title: existing.title },
  })
  return { message: 'Lesson removed.', id: lessonId }
}

/* ── Live Sessions ── */

export async function listLiveSessions({ req, listingId }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const listingObjectId = parseObjectId(listingId, 'listingId')
  return database.collection(LIVE_SESSIONS_COLLECTION)
    .find({ listingId: listingObjectId, status: { $ne: 'removed' } })
    .sort({ scheduledAt: 1, createdAt: -1 })
    .toArray()
}

export async function createLiveSession({ req, listingId, data }) {
  const listing = await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const now = new Date()
  const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null
  const curriculumLessonId = data.curriculumLessonId ? parseObjectId(data.curriculumLessonId, 'curriculumLessonId') : null
  if (curriculumLessonId) {
    const lesson = await database.collection(LESSONS_COLLECTION).findOne({
      _id: curriculumLessonId,
      listingId: listingObjectId,
      status: { $ne: 'removed' },
    })
    if (!lesson) {
      const error = new Error('Curriculum topic not found in this course.')
      error.status = 400
      error.code = 'INVALID_CURRICULUM_TOPIC'
      throw error
    }
  }
  const googleEvent = data.createMeet
    ? await createGoogleMeetEvent({ uid: req.user.uid, title: data.title.trim(), scheduledAt })
    : null
  const sessionDoc = {
    listingId: listingObjectId,
    teacherUid: req.user.uid,
    curriculumLessonId,
    title: data.title.trim(),
    meetLink: googleEvent?.meetLink || (data.meetLink || '').trim() || null,
    meetId: googleEvent?.eventId || (data.meetId || '').trim() || null,
    googleCalendarEventId: googleEvent?.eventId || null,
    status: data.status || 'scheduled',
    scheduledAt,
    startedAt: data.startedAt ? new Date(data.startedAt) : null,
    endedAt: data.endedAt ? new Date(data.endedAt) : null,
    targetBatch: (data.targetBatch || '').trim() || null,
    autoAttendance: Boolean(data.autoAttendance),
    autoRecording: Boolean(data.autoRecording),
    notifyStudents: Boolean(data.notifyStudents),
    rtmpRelay: Boolean(data.rtmpRelay),
    createdAt: now,
    updatedAt: now,
  }
  let result
  try {
    result = await database.collection(LIVE_SESSIONS_COLLECTION).insertOne(sessionDoc)
  } catch (error) {
    if (googleEvent) {
      try {
        await deleteGoogleCalendarEvent({ uid: req.user.uid, eventId: googleEvent.eventId })
      } catch (cleanupError) {
        console.error('Could not remove Google Calendar event after session save failed:', cleanupError.message)
      }
    }
    throw error
  }
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'CREATE_LIVE_SESSION',
    targetType: 'liveSession',
    targetId: result.insertedId,
    meta: { listingId, title: sessionDoc.title, status: sessionDoc.status, googleMeetCreated: Boolean(googleEvent) },
  })
  return { _id: result.insertedId, ...sessionDoc }
}

export async function createCurriculumLiveSessions({ req, listingId, data }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const lessons = await database.collection(LESSONS_COLLECTION)
    .find({ listingId: listingObjectId, status: { $ne: 'removed' } })
    .sort({ lessonNumber: 1, createdAt: 1 })
    .limit(61)
    .toArray()
  if (!lessons.length) {
    const error = new Error('Add course topics to the curriculum before scheduling a class series.')
    error.status = 400
    error.code = 'CURRICULUM_REQUIRED'
    throw error
  }
  if (lessons.length > 60) {
    const error = new Error('A weekly schedule can contain at most 60 curriculum topics.')
    error.status = 400
    error.code = 'TOO_MANY_CURRICULUM_TOPICS'
    throw error
  }

  const selectedDays = new Set(data.daysOfWeek)
  const cursor = new Date(`${data.startDate}T00:00:00Z`)
  const sessionDocs = []
  const now = new Date()
  const recurrenceGroupId = randomUUID()
  while (sessionDocs.length < lessons.length) {
    if (selectedDays.has(cursor.getUTCDay())) {
      const date = cursor.toISOString().slice(0, 10)
      sessionDocs.push({
        listingId: listingObjectId,
        teacherUid: req.user.uid,
        curriculumLessonId: lessons[sessionDocs.length]._id,
        recurrenceGroupId,
        title: lessons[sessionDocs.length].title,
        meetLink: (data.meetLink || '').trim() || null,
        meetId: null,
        status: 'scheduled',
        scheduledAt: new Date(`${date}T${data.startTime}:00+06:00`),
        startedAt: null,
        endedAt: null,
        targetBatch: (data.targetBatch || '').trim() || null,
        autoAttendance: Boolean(data.autoAttendance),
        autoRecording: Boolean(data.autoRecording),
        notifyStudents: Boolean(data.notifyStudents),
        rtmpRelay: false,
        createdAt: now,
        updatedAt: now,
      })
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  const result = await database.collection(LIVE_SESSIONS_COLLECTION).insertMany(sessionDocs)
  const sessions = sessionDocs.map((session, index) => ({ _id: result.insertedIds[index], ...session }))
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'CREATE_LIVE_SESSION_SERIES',
    targetType: 'liveSession',
    targetId: result.insertedIds[0],
    meta: { listingId, recurrenceGroupId, sessionCount: sessions.length },
  })
  return { recurrenceGroupId, sessions, count: sessions.length }
}

export async function updateLiveSession({ req, listingId, sessionId, data }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const sessionObjectId = parseObjectId(sessionId, 'sessionId')
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const existing = await database.collection(LIVE_SESSIONS_COLLECTION).findOne({ _id: sessionObjectId, listingId: listingObjectId })
  if (!existing) {
    const error = new Error('Live session not found.')
    error.status = 404
    error.code = 'LIVE_SESSION_NOT_FOUND'
    throw error
  }
  const updates = {}
  const now = new Date()
  if (data.title !== undefined) updates.title = data.title.trim()
  if (data.curriculumLessonId !== undefined) {
    const curriculumLessonId = data.curriculumLessonId ? parseObjectId(data.curriculumLessonId, 'curriculumLessonId') : null
    if (curriculumLessonId) {
      const lesson = await database.collection(LESSONS_COLLECTION).findOne({
        _id: curriculumLessonId,
        listingId: listingObjectId,
        status: { $ne: 'removed' },
      })
      if (!lesson) {
        const error = new Error('Curriculum topic not found in this course.')
        error.status = 400
        error.code = 'INVALID_CURRICULUM_TOPIC'
        throw error
      }
    }
    updates.curriculumLessonId = curriculumLessonId
  }
  if (data.meetLink !== undefined) updates.meetLink = data.meetLink ? data.meetLink.trim() : null
  if (data.meetId !== undefined) updates.meetId = data.meetId ? data.meetId.trim() : null
  if (data.status !== undefined) updates.status = data.status
  if (data.scheduledAt !== undefined) updates.scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null
  if (data.startedAt !== undefined) updates.startedAt = data.startedAt ? new Date(data.startedAt) : null
  if (data.endedAt !== undefined) updates.endedAt = data.endedAt ? new Date(data.endedAt) : null
  if (data.targetBatch !== undefined) updates.targetBatch = data.targetBatch ? data.targetBatch.trim() : null
  if (data.autoAttendance !== undefined) updates.autoAttendance = Boolean(data.autoAttendance)
  if (data.autoRecording !== undefined) updates.autoRecording = Boolean(data.autoRecording)
  if (data.notifyStudents !== undefined) updates.notifyStudents = Boolean(data.notifyStudents)
  if (data.rtmpRelay !== undefined) updates.rtmpRelay = Boolean(data.rtmpRelay)
  updates.updatedAt = now
  const result = await database.collection(LIVE_SESSIONS_COLLECTION).findOneAndUpdate(
    { _id: sessionObjectId },
    { $set: updates },
    { returnDocument: 'after' },
  )
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'UPDATE_LIVE_SESSION',
    targetType: 'liveSession',
    targetId: sessionObjectId,
    meta: { listingId, updatedFields: Object.keys(updates) },
  })
  return result
}

export async function deleteLiveSession({ req, listingId, sessionId }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const sessionObjectId = parseObjectId(sessionId, 'sessionId')
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const existing = await database.collection(LIVE_SESSIONS_COLLECTION).findOne({ _id: sessionObjectId, listingId: listingObjectId })
  if (!existing) {
    const error = new Error('Live session not found.')
    error.status = 404
    error.code = 'LIVE_SESSION_NOT_FOUND'
    throw error
  }
  const now = new Date()
  await database.collection(LIVE_SESSIONS_COLLECTION).updateOne({ _id: sessionObjectId }, { $set: { status: 'removed', removedAt: now, removedBy: req.authUid, updatedAt: now } })
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'DELETE_LIVE_SESSION',
    targetType: 'liveSession',
    targetId: sessionObjectId,
    meta: { listingId, title: existing.title },
  })
  return { message: 'Live session removed.', id: sessionId }
}

/* ── Session Attendance ── */

export async function listSessionAttendance({ req, listingId, sessionId }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const filter = { listingId: listingObjectId }
  if (sessionId) filter.sessionId = parseObjectId(sessionId, 'sessionId')
  return database.collection(SESSION_ATTENDANCE_COLLECTION)
    .find(filter)
    .sort({ joinedAt: -1 })
    .toArray()
}

export async function recordSessionAttendance({ req, listingId, sessionId, data }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const sessionObjectId = parseObjectId(sessionId, 'sessionId')
  const now = new Date()

  // Verify that the session belongs to this course listing
  const session = await database.collection(LIVE_SESSIONS_COLLECTION).findOne({
    _id: sessionObjectId,
    listingId: listingObjectId,
  })
  if (!session) {
    const error = new Error('Session not found for this course listing.')
    error.status = 404
    error.code = 'SESSION_NOT_FOUND'
    throw error
  }

  const bulkOps = data.records.map((item) => {
    const joinedAt = item.joinedAt ? new Date(item.joinedAt) : (session.scheduledAt ? new Date(session.scheduledAt) : now)
    return {
      updateOne: {
        filter: {
          listingId: listingObjectId,
          sessionId: sessionObjectId,
          studentUid: item.studentUid,
        },
        update: {
          $set: {
            studentName: item.studentName,
            status: item.status,
            joinedAt,
            leftAt: item.leftAt ? new Date(item.leftAt) : null,
            durationMinutes: item.durationMinutes || 0,
            updatedAt: now,
          },
          $setOnInsert: {
            listingId: listingObjectId,
            sessionId: sessionObjectId,
            studentUid: item.studentUid,
            createdAt: now,
          },
        },
        upsert: true,
      },
    }
  })

  if (bulkOps.length) {
    await database.collection(SESSION_ATTENDANCE_COLLECTION).bulkWrite(bulkOps)
  }

  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'RECORD_SESSION_ATTENDANCE',
    targetType: 'liveSession',
    targetId: sessionObjectId,
    meta: { listingId, recordCount: data.records.length },
  })
  return { message: 'Attendance recorded successfully.', count: data.records.length }
}

export async function exportSessionAttendanceCSV({ req, listingId, sessionId }) {
  await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const filter = { listingId: listingObjectId }
  if (sessionId) filter.sessionId = parseObjectId(sessionId, 'sessionId')
  const records = await database.collection(SESSION_ATTENDANCE_COLLECTION)
    .find(filter)
    .sort({ joinedAt: -1 })
    .toArray()
  const headers = ['Student UID', 'Student Name', 'Status', 'Joined At', 'Left At', 'Duration (min)', 'Recorded At']
  const rows = records.map((r) => [
    r.studentUid,
    r.studentName,
    r.status,
    r.joinedAt ? r.joinedAt.toISOString() : '',
    r.leftAt ? r.leftAt.toISOString() : '',
    r.durationMinutes || 0,
    r.createdAt ? r.createdAt.toISOString() : '',
  ])
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  return csv
}

/* ── Course Publishing ── */

export async function publishCourse({ req, listingId }) {
  const listing = await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const [modules, lessons] = await Promise.all([
    database.collection(MODULES_COLLECTION).find({ listingId: listingObjectId, status: { $ne: 'removed' } }).toArray(),
    database.collection(LESSONS_COLLECTION).find({ listingId: listingObjectId, status: { $ne: 'removed' } }).toArray(),
  ])
  if (!listing.name || listing.name.trim().length < 3) {
    const error = new Error('Course name is required.')
    error.status = 400
    error.code = 'INVALID_COURSE'
    throw error
  }
  if (!modules.length) {
    const error = new Error('Add at least one module before publishing.')
    error.status = 400
    error.code = 'NO_MODULES'
    throw error
  }
  if (!lessons.length) {
    const error = new Error('Add at least one lesson before publishing.')
    error.status = 400
    error.code = 'NO_LESSONS'
    throw error
  }
  const now = new Date()
  await database.collection('listings').updateOne(
    { _id: listingObjectId },
    { $set: { status: 'active', published: true, publishedAt: now, updatedAt: now } },
  )
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'PUBLISH_COURSE',
    targetType: 'listing',
    targetId: listingObjectId,
    meta: { name: listing.name, moduleCount: modules.length, lessonCount: lessons.length },
  })
  return { message: 'Course published successfully.', listingId, status: 'active', published: true }
}

export async function unpublishCourse({ req, listingId }) {
  const listing = await requireOwnedListing(req, listingId)
  const database = getDatabase()
  const listingObjectId = parseObjectId(listingId, 'listingId')
  const now = new Date()
  await database.collection('listings').updateOne(
    { _id: listingObjectId },
    { $set: { published: false, updatedAt: now } },
  )
  await writeAuditLog({
    actorUid: req.authUid,
    actorRole: req.user.role,
    action: 'UNPUBLISH_COURSE',
    targetType: 'listing',
    targetId: listingObjectId,
    meta: { name: listing.name },
  })
  return { message: 'Course unpublished successfully.', listingId, published: false }
}

export { MODULES_COLLECTION, LESSONS_COLLECTION, LIVE_SESSIONS_COLLECTION, SESSION_ATTENDANCE_COLLECTION }
