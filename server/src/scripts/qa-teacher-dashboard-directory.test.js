import test from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'

// In-memory mock database testing helper
function createMockDb() {
  const store = {
    listings: [],
    studentEnrollments: [],
    students: [],
    classes: [],
    attendanceRecords: [],
    sessionAttendance: [],
    studentPayments: [],
    payoutRequests: [],
    lessonSessions: [],
    messages: [],
    officeHours: [],
    resources: [],
    users: [],
    teacherDashboards: [],
  }

  function matchQuery(doc, query) {
    if (!query || Object.keys(query).length === 0) return true
    for (const [key, value] of Object.entries(query)) {
      if (key === '$or' && Array.isArray(value)) {
        const matchesAny = value.some((cond) => matchQuery(doc, cond))
        if (!matchesAny) return false
        continue
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (value.$ne !== undefined && doc[key] === value.$ne) return false
        if (value.$in !== undefined && (!Array.isArray(value.$in) || !value.$in.some((item) => String(item) === String(doc[key])))) return false
        continue
      }
      if (String(doc[key]) !== String(value)) return false
    }
    return true
  }

  function getCollection(name) {
    if (!store[name]) store[name] = []
    const collectionData = store[name]
    return {
      find(query) {
        let results = collectionData.filter((doc) => matchQuery(doc, query))
        return {
          sort() { return this },
          limit(n) { results = results.slice(0, n); return this },
          project() { return this },
          toArray: async () => results,
        }
      },
      findOne: async (query) => collectionData.find((doc) => matchQuery(doc, query)) || null,
      countDocuments: async (query) => collectionData.filter((doc) => matchQuery(doc, query)).length,
      insertOne: async (doc) => {
        const inserted = { _id: doc._id || new ObjectId(), ...doc }
        collectionData.push(inserted)
        return { insertedId: inserted._id }
      },
      updateOne: async (query, update, opts = {}) => {
        const idx = collectionData.findIndex((doc) => matchQuery(doc, query))
        if (idx !== -1) {
          if (update.$set) Object.assign(collectionData[idx], update.$set)
          return { modifiedCount: 1 }
        }
        if (opts.upsert) {
          const newDoc = {
            _id: new ObjectId(),
            ...(update.$setOnInsert || {}),
            ...(update.$set || {}),
          }
          collectionData.push(newDoc)
          return { upsertedCount: 1 }
        }
        return { modifiedCount: 0 }
      },
      bulkWrite: async (ops) => {
        for (const op of ops) {
          if (op.updateOne) {
            const { filter, update, upsert } = op.updateOne
            const idx = collectionData.findIndex((doc) => matchQuery(doc, filter))
            if (idx !== -1) {
              if (update.$set) Object.assign(collectionData[idx], update.$set)
            } else if (upsert) {
              collectionData.push({
                _id: new ObjectId(),
                ...(update.$setOnInsert || {}),
                ...(update.$set || {}),
              })
            }
          }
        }
        return { ok: 1 }
      },
      aggregate: () => ({
        toArray: async () => [],
      }),
    }
  }

  return { store, collection: getCollection }
}

test('TEACHER DIRECTORY & DASHBOARD DATA SUITE', async (t) => {
  const teacherUid = 'teacher-rahman-101'
  const listingId = new ObjectId()
  const listingId2 = new ObjectId()
  const student1Uid = 'student-ayesha-01'
  const student2Uid = 'student-karim-02'

  const mockDb = createMockDb()

  // 1. Seed Teacher Listings (Courses / Batches)
  await mockDb.collection('listings').insertOne({
    _id: listingId,
    name: 'Morning Batch (Mon, Wed)',
    courseName: 'Complete Fullstack Web Development',
    category: 'Software Engineering',
    teacherUid,
    status: 'active',
    days: ['Mon', 'Wed'],
    startTime: '10:00 AM',
    endTime: '11:30 AM',
    location: 'Google Meet',
    createdAt: new Date(),
  })

  await mockDb.collection('listings').insertOne({
    _id: listingId2,
    name: 'Weekend Intensive',
    courseName: 'Python for Data Science',
    category: 'Data Science',
    teacherUid,
    status: 'active',
    days: ['Fri', 'Sat'],
    startTime: '03:00 PM',
    endTime: '05:00 PM',
    location: 'Google Meet',
    createdAt: new Date(),
  })

  // 2. Seed Student Enrollments
  await mockDb.collection('studentEnrollments').insertOne({
    studentUid: student1Uid,
    studentName: 'Ayesha Rahman',
    studentEmail: 'ayesha@example.com',
    listingId,
    name: 'Morning Batch (Mon, Wed)',
    category: 'Software Engineering',
    teacherUid,
    status: 'active',
    paymentStatus: 'paid',
    enrolledAt: new Date('2026-03-01T10:00:00Z'),
  })

  // Student 1 also enrolled in second listing
  await mockDb.collection('studentEnrollments').insertOne({
    studentUid: student1Uid,
    studentName: 'Ayesha Rahman',
    studentEmail: 'ayesha@example.com',
    listingId: listingId2,
    name: 'Weekend Intensive',
    category: 'Data Science',
    teacherUid,
    status: 'active',
    paymentStatus: 'paid',
    enrolledAt: new Date('2026-03-05T10:00:00Z'),
  })

  // Student 2 enrolled in second listing
  await mockDb.collection('studentEnrollments').insertOne({
    studentUid: student2Uid,
    studentName: 'Karim Ullah',
    studentEmail: 'karim@example.com',
    listingId: listingId2,
    name: 'Weekend Intensive',
    category: 'Data Science',
    teacherUid,
    status: 'active',
    paymentStatus: 'paid',
    enrolledAt: new Date('2026-03-06T10:00:00Z'),
  })

  // 3. Seed Session Attendance
  await mockDb.collection('sessionAttendance').insertOne({
    listingId,
    studentUid: student1Uid,
    status: 'present',
    joinedAt: new Date('2026-03-02T10:05:00Z'),
  })
  await mockDb.collection('sessionAttendance').insertOne({
    listingId,
    studentUid: student1Uid,
    status: 'late',
    joinedAt: new Date('2026-03-04T10:15:00Z'),
  })
  await mockDb.collection('sessionAttendance').insertOne({
    listingId: listingId2,
    studentUid: student2Uid,
    status: 'absent',
    joinedAt: new Date('2026-03-07T15:00:00Z'),
  })

  await t.test('1. Teacher Directory aggregates enrolled students with multiple courses and attendance %', async () => {
    // Replicate directory logic from server/src/index.js
    const teacherListings = await mockDb.collection('listings')
      .find({ teacherUid, status: { $ne: 'removed' } })
      .toArray()
    const listingIds = teacherListings.map((l) => l._id)

    const [enrollments, legacyStudents, sessionAttendance] = await Promise.all([
      mockDb.collection('studentEnrollments').find({
        $or: [
          { teacherUid },
          ...(listingIds.length ? [{ listingId: { $in: listingIds } }] : []),
        ],
        status: 'active',
      }).toArray(),
      mockDb.collection('students').find({ uid: teacherUid, isSample: { $ne: true } }).toArray(),
      mockDb.collection('sessionAttendance').find({ listingId: { $in: listingIds } }).toArray(),
    ])

    const attendanceStats = new Map()
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
        studentMap.set(key, {
          id: String(enrollment._id),
          studentUid: enrollment.studentUid,
          studentId: enrollment.studentUid?.slice(-8).toUpperCase() || 'STU-ONLINE',
          name: enrollment.studentName,
          email: enrollment.studentEmail,
          department: enrollment.category,
          enrolledClasses: [],
          attendancePercent: 0,
          enrolledAt: enrollment.enrolledAt,
        })
      }
      const entry = studentMap.get(key)
      const classIdStr = String(enrollment.listingId)
      if (!entry.enrolledClasses.some((c) => c.id === classIdStr)) {
        entry.enrolledClasses.push({
          id: classIdStr,
          title: enrollment.name,
        })
      }
    }

    for (const [key, student] of studentMap.entries()) {
      const counts = attendanceStats.get(student.studentUid) || attendanceStats.get(student.id) || attendanceStats.get(key)
      student.attendancePercent = counts?.marked
        ? Math.round((counts.present / counts.marked) * 100)
        : 0
    }

    const students = [...studentMap.values()]

    // Assertions
    assert.equal(students.length, 2, 'Should aggregate 2 distinct students')
    const ayesha = students.find((s) => s.studentUid === student1Uid)
    assert.ok(ayesha, 'Ayesha must be in the directory')
    assert.equal(ayesha.name, 'Ayesha Rahman')
    assert.equal(ayesha.email, 'ayesha@example.com')
    assert.equal(ayesha.enrolledClasses.length, 2, 'Ayesha is enrolled in 2 courses')
    assert.equal(ayesha.attendancePercent, 100, 'Ayesha has 2 marked sessions, both present or late (100%)')

    const karim = students.find((s) => s.studentUid === student2Uid)
    assert.ok(karim, 'Karim must be in the directory')
    assert.equal(karim.enrolledClasses.length, 1)
    assert.equal(karim.attendancePercent, 0, 'Karim was absent for his only session (0%)')
  })

  await t.test('2. Teacher Dashboard combines course listings, student rosters, and quick attendance', async () => {
    const teacherListings = await mockDb.collection('listings')
      .find({ teacherUid, status: { $ne: 'removed' } })
      .toArray()
    const listingIds = teacherListings.map((l) => l._id)

    const enrollments = await mockDb.collection('studentEnrollments').find({
      $or: [
        { teacherUid },
        ...(listingIds.length ? [{ listingId: { $in: listingIds } }] : []),
      ],
      status: 'active',
    }).toArray()

    const enrollmentsByListing = new Map()
    for (const e of enrollments) {
      const k = String(e.listingId)
      if (!enrollmentsByListing.has(k)) enrollmentsByListing.set(k, [])
      enrollmentsByListing.get(k).push(e)
    }

    const mappedListings = teacherListings.map((listing) => {
      const listingKey = String(listing._id)
      const listingStudents = enrollmentsByListing.get(listingKey) || []
      return {
        id: listingKey,
        title: listing.name,
        courseName: listing.courseName || listing.name,
        schedule: listing.days?.join(', ') || 'Weekly',
        enrolled: listingStudents.length,
        students: listingStudents.map((e) => ({
          id: e.studentUid || String(e._id),
          name: e.studentName,
          status: '',
        })),
        isListing: true,
      }
    })

    const uniqueStudentKeys = new Set(enrollments.map((e) => e.studentUid))
    const totalStudents = uniqueStudentKeys.size

    assert.equal(mappedListings.length, 2, 'Dashboard should have both active course listings')
    assert.equal(totalStudents, 2, 'Total unique enrolled students should be 2')

    const webDev = mappedListings.find((l) => l.courseName === 'Complete Fullstack Web Development')
    assert.ok(webDev)
    assert.equal(webDev.enrolled, 1)
    assert.equal(webDev.students[0].name, 'Ayesha Rahman')

    const dataSci = mappedListings.find((l) => l.courseName === 'Python for Data Science')
    assert.ok(dataSci)
    assert.equal(dataSci.enrolled, 2, 'Data science course has 2 enrolled students')
  })

  await t.test('3. Quick Attendance saving on Dashboard for course listing upserts both records', async () => {
    const date = new Date().toISOString().slice(0, 10)
    const submitted = [
      { studentId: student1Uid, status: 'present' },
      { studentId: student2Uid, status: 'late' },
    ]

    // Save into attendanceRecords
    await mockDb.collection('attendanceRecords').updateOne(
      { uid: teacherUid, classId: String(listingId2), date },
      {
        $set: {
          uid: teacherUid,
          classId: String(listingId2),
          listingId: listingId2,
          records: submitted,
          date,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    )

    // Save into sessionAttendance
    await mockDb.collection('sessionAttendance').bulkWrite(
      submitted.map((sub) => ({
        updateOne: {
          filter: { listingId: listingId2, dateStr: date, studentUid: sub.studentId },
          update: {
            $set: { status: sub.status, studentName: 'Test Student' },
            $setOnInsert: { listingId: listingId2, dateStr: date, studentUid: sub.studentId },
          },
          upsert: true,
        },
      })),
    )

    const savedRec = await mockDb.collection('attendanceRecords').findOne({ uid: teacherUid, classId: String(listingId2), date })
    assert.ok(savedRec, 'attendanceRecord must be saved')
    assert.equal(savedRec.records.length, 2)

    const saRecords = await mockDb.collection('sessionAttendance').find({ listingId: listingId2, dateStr: date }).toArray()
    assert.equal(saRecords.length, 2, 'sessionAttendance records must be upserted')
  })
})

