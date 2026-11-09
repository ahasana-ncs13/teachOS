import { ObjectId } from 'mongodb'
import { getDatabase } from '../db.js'
import { isValidObjectId } from '../utils/validation.js'

export async function getAdminAttendanceOverview({
  listingId,
  teacherUid,
  status,
  studentSearch,
  startDate,
  endDate,
  page = 1,
  limit = 20,
}) {
  const database = getDatabase()
  const match = {}

  if (listingId && isValidObjectId(listingId)) {
    match.listingId = new ObjectId(listingId)
  }

  if (status && ['present', 'absent', 'late', 'excused'].includes(status)) {
    match.status = status
  }

  if (studentSearch && typeof studentSearch === 'string' && studentSearch.trim()) {
    const safeRegex = studentSearch.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    match.studentName = { $regex: safeRegex, $options: 'i' }
  }

  if (startDate || endDate) {
    match.joinedAt = {}
    if (startDate) match.joinedAt.$gte = new Date(`${startDate}T00:00:00.000Z`)
    if (endDate) match.joinedAt.$lte = new Date(`${endDate}T23:59:59.999Z`)
  }

  if (teacherUid && typeof teacherUid === 'string' && teacherUid.trim()) {
    const teacherListings = await database.collection('listings')
      .find({ teacherUid: teacherUid.trim() }, { projection: { _id: 1 } })
      .toArray()
    const listingIds = teacherListings.map((l) => l._id)
    if (match.listingId) {
      if (!listingIds.some((id) => id.equals(match.listingId))) {
        match.listingId = new ObjectId('000000000000000000000000')
      }
    } else {
      match.listingId = { $in: listingIds }
    }
  }

  // 1. Overall stats
  const [stats] = await database.collection('sessionAttendance').aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRecords: { $sum: 1 },
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
        excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
        uniqueSessions: { $addToSet: '$sessionId' },
        uniqueStudents: { $addToSet: '$studentUid' },
      },
    },
  ]).toArray()

  const totalRecords = stats?.totalRecords || 0
  const present = stats?.present || 0
  const absent = stats?.absent || 0
  const late = stats?.late || 0
  const excused = stats?.excused || 0
  const eligible = totalRecords - excused
  const attendancePercentage = eligible > 0
    ? Math.round(((present + late) / eligible) * 100)
    : 0

  const summary = {
    totalSessions: stats?.uniqueSessions?.length || 0,
    totalStudents: stats?.uniqueStudents?.length || 0,
    totalRecords,
    present,
    absent,
    late,
    excused,
    eligible,
    attendancePercentage,
  }

  // 2. Paginated Attendance Records
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1)
  const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20))
  const skip = (pageNum - 1) * limitNum

  const [records, totalCount] = await Promise.all([
    database.collection('sessionAttendance')
      .find(match)
      .sort({ joinedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray(),
    database.collection('sessionAttendance').countDocuments(match),
  ])

  // Lookup listing and session details
  const listingObjectIds = [...new Set(records.map((r) => String(r.listingId)))].map((id) => new ObjectId(id))
  const sessionObjectIds = [...new Set(records.map((r) => String(r.sessionId)))].filter(Boolean).map((id) => new ObjectId(id))

  const [listings, sessions] = await Promise.all([
    listingObjectIds.length
      ? database.collection('listings').find(
          { _id: { $in: listingObjectIds } },
          { projection: { name: 1, courseName: 1, teacherName: 1, teacherUid: 1 } },
        ).toArray()
      : [],
    sessionObjectIds.length
      ? database.collection('liveSessions').find(
          { _id: { $in: sessionObjectIds } },
          { projection: { title: 1, scheduledAt: 1 } },
        ).toArray()
      : [],
  ])

  const listingsMap = new Map(listings.map((l) => [String(l._id), l]))
  const sessionsMap = new Map(sessions.map((s) => [String(s._id), s]))

  const enrichedRecords = records.map((record) => {
    const listing = listingsMap.get(String(record.listingId))
    const session = sessionsMap.get(String(record.sessionId))
    return {
      _id: record._id,
      listingId: record.listingId,
      sessionId: record.sessionId,
      courseName: listing?.courseName || listing?.name || 'Unknown Course',
      batchName: listing?.name || '',
      teacherName: listing?.teacherName || 'Teacher',
      teacherUid: listing?.teacherUid || '',
      sessionTitle: session?.title || 'Live Session',
      studentName: record.studentName || 'Student',
      studentUid: record.studentUid,
      status: record.status,
      durationMinutes: record.durationMinutes || 0,
      joinedAt: record.joinedAt || record.createdAt,
      createdAt: record.createdAt,
    }
  })

  // 3. Course-wise summary reports
  const courseSummaryAgg = await database.collection('sessionAttendance').aggregate([
    {
      $group: {
        _id: '$listingId',
        total: { $sum: 1 },
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
        excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
        sessionsCount: { $addToSet: '$sessionId' },
      },
    },
    { $sort: { total: -1 } },
    { $limit: 15 },
  ]).toArray()

  const allCourseIds = courseSummaryAgg.map((c) => c._id)
  const courseListings = allCourseIds.length
    ? await database.collection('listings').find(
        { _id: { $in: allCourseIds } },
        { projection: { name: 1, courseName: 1, teacherName: 1 } },
      ).toArray()
    : []
  const courseListingsMap = new Map(courseListings.map((l) => [String(l._id), l]))

  const courseReports = courseSummaryAgg.map((item) => {
    const listing = courseListingsMap.get(String(item._id))
    const eligibleCount = item.total - item.excused
    return {
      listingId: item._id,
      courseName: listing?.courseName || listing?.name || 'Course',
      batchName: listing?.name || '',
      teacherName: listing?.teacherName || 'Teacher',
      totalRecords: item.total,
      sessionsCount: item.sessionsCount?.length || 0,
      present: item.present,
      absent: item.absent,
      late: item.late,
      excused: item.excused,
      attendancePercentage: eligibleCount > 0 ? Math.round(((item.present + item.late) / eligibleCount) * 100) : 0,
    }
  })

  // 4. Listing options for filter dropdown
  const filterListings = await database.collection('listings').find(
    { status: { $ne: 'removed' } },
    { projection: { _id: 1, name: 1, courseName: 1, teacherName: 1 } },
  ).sort({ name: 1 }).limit(100).toArray()

  return {
    summary,
    records: enrichedRecords,
    courseReports,
    listings: filterListings,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limitNum) || 1,
    },
  }
}

export async function exportAdminAttendanceCSV({
  listingId,
  teacherUid,
  status,
  studentSearch,
  startDate,
  endDate,
}) {
  const database = getDatabase()
  const match = {}

  if (listingId && isValidObjectId(listingId)) {
    match.listingId = new ObjectId(listingId)
  }

  if (status && ['present', 'absent', 'late', 'excused'].includes(status)) {
    match.status = status
  }

  if (studentSearch && typeof studentSearch === 'string' && studentSearch.trim()) {
    const safeRegex = studentSearch.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    match.studentName = { $regex: safeRegex, $options: 'i' }
  }

  if (startDate || endDate) {
    match.joinedAt = {}
    if (startDate) match.joinedAt.$gte = new Date(`${startDate}T00:00:00.000Z`)
    if (endDate) match.joinedAt.$lte = new Date(`${endDate}T23:59:59.999Z`)
  }

  if (teacherUid && typeof teacherUid === 'string' && teacherUid.trim()) {
    const teacherListings = await database.collection('listings')
      .find({ teacherUid: teacherUid.trim() }, { projection: { _id: 1 } })
      .toArray()
    const listingIds = teacherListings.map((l) => l._id)
    if (match.listingId) {
      if (!listingIds.some((id) => id.equals(match.listingId))) {
        match.listingId = new ObjectId('000000000000000000000000')
      }
    } else {
      match.listingId = { $in: listingIds }
    }
  }

  const records = await database.collection('sessionAttendance')
    .find(match)
    .sort({ joinedAt: -1 })
    .limit(5000)
    .toArray()

  const listingObjectIds = [...new Set(records.map((r) => String(r.listingId)))].map((id) => new ObjectId(id))
  const sessionObjectIds = [...new Set(records.map((r) => String(r.sessionId)))].filter(Boolean).map((id) => new ObjectId(id))

  const [listings, sessions] = await Promise.all([
    listingObjectIds.length
      ? database.collection('listings').find(
          { _id: { $in: listingObjectIds } },
          { projection: { name: 1, courseName: 1, teacherName: 1 } },
        ).toArray()
      : [],
    sessionObjectIds.length
      ? database.collection('liveSessions').find(
          { _id: { $in: sessionObjectIds } },
          { projection: { title: 1 } },
        ).toArray()
      : [],
  ])

  const listingsMap = new Map(listings.map((l) => [String(l._id), l]))
  const sessionsMap = new Map(sessions.map((s) => [String(s._id), s]))

  const headers = ['Date', 'Course Name', 'Batch', 'Teacher Name', 'Session Title', 'Student Name', 'Student UID', 'Status', 'Duration (min)']
  const rows = records.map((r) => {
    const listing = listingsMap.get(String(r.listingId))
    const session = sessionsMap.get(String(r.sessionId))
    const dateStr = r.joinedAt ? new Date(r.joinedAt).toISOString().slice(0, 10) : ''
    return [
      dateStr,
      listing?.courseName || listing?.name || 'Course',
      listing?.name || '',
      listing?.teacherName || 'Teacher',
      session?.title || 'Live Session',
      r.studentName || '',
      r.studentUid || '',
      r.status || '',
      r.durationMinutes || 0,
    ]
  })

  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  return csv
}

