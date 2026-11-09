import { useCallback, useEffect, useState } from 'react'
import { FiAlertTriangle, FiBookOpen, FiCalendar, FiCheck, FiClock, FiDownload, FiExternalLink, FiGrid, FiHelpCircle, FiLogOut, FiPlay, FiPlus, FiSearch, FiSettings, FiUsers, FiX } from 'react-icons/fi'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import NotificationCenter from '../components/NotificationCenter'
import '../styles/workspace-pages.css'

export function WorkspaceFrame({ title, description, children, onQuickAction }) {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const name = user?.displayName || user?.email?.split('@')[0] || 'Teacher'
  const navigation = [
    { to: '/dashboard', label: 'Dashboard', icon: FiGrid },
    { to: '/dashboard/teaching-studio', label: 'Classes & lessons', icon: FiBookOpen },
    { to: '/dashboard/listings', label: 'My listings', icon: FiPlus },
    { to: '/dashboard/attendance', label: 'Attendance', icon: FiCheck },
    { to: '/dashboard/directory', label: 'Directory', icon: FiUsers },
    { to: '/dashboard/payments', label: 'Payments', icon: FiCalendar },
  ]

  return <div className={title === 'My Listings' ? 'workspace-shell teacher-listings-workspace' : 'workspace-shell'}>
    <aside className="workspace-sidebar">
      <Link className="workspace-brand" to="/dashboard">TeachOS</Link>
      <div className="workspace-user"><span>{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>Teacher workspace</small></div></div>
      <button className="workspace-quick-button" type="button" onClick={onQuickAction}><FiPlus /> Quick Actions</button>
      <nav aria-label="Workspace navigation">
        {navigation.map(({ to, label, icon: Icon }) => <Link className={location.pathname === to ? 'active' : ''} key={to} to={to}><Icon />{label}</Link>)}
      </nav>
      <div className="workspace-sidebar-footer">
        <Link to="/dashboard/actions"><FiSettings /> Office hours &amp; resources</Link>
        <a href="mailto:support@teachos.example"><FiHelpCircle /> Support</a>
        <button type="button" onClick={signOut}><FiLogOut /> Sign out</button>
      </div>
    </aside>
    <main className="workspace-main">
      <header className="workspace-topbar"><label><FiSearch /><input placeholder={`Search ${title.toLowerCase()}...`} aria-label={`Search ${title}`} /></label><div className="workspace-header-tools"><NotificationCenter /><span>{user?.email}</span></div></header>
      <div className="workspace-content">
        <header className="workspace-page-heading"><div><p>Teacher workspace</p><h1>{title}</h1><span>{description}</span></div></header>
        {children}
      </div>
      <footer className="workspace-footer"><Link to="/dashboard">TeachOS</Link><span>Information you add here is saved to MongoDB.</span></footer>
    </main>
  </div>
}

function useWorkspaceData(path, property, enabled = true) {
  const { user } = useAuth()
  const uid = user.uid
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = async () => {
    setError('')
    try {
      const { data } = await api.get(`${path}/${encodeURIComponent(uid)}`)
      setItems(data[property] || [])
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load data. Check that the API and MongoDB are running.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (!enabled) return undefined
    let current = true
    api.get(`${path}/${encodeURIComponent(uid)}`).then(({ data }) => {
      if (current) setItems(data[property] || [])
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load data. Check that the API and MongoDB are running.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [enabled, path, property, uid, setError, setItems, setLoading])
  return { uid, items, setItems, loading, setLoading, error, setError, refresh }
}

function ResultBanner({ error, notice }) {
  return <>{error && <p className="workspace-error" role="alert">{error}</p>}{notice && <p className="workspace-notice" role="status">{notice}</p>}</>
}

function ClassesPage() {
  const data = useWorkspaceData('/classes', 'classes')
  const setDataError = data.setError
  const [teacherListings, setTeacherListings] = useState([])
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const visible = data.items.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()))
  const visibleListings = teacherListings.filter((listing) => (
    `${listing.name} ${listing.courseName || ''} ${listing.category || ''}`.toLowerCase().includes(search.trim().toLowerCase())
  ))

  useEffect(() => {
    let current = true
    api.get('/listings/my', { params: { page: 1, limit: 100 } }).then(({ data: result }) => {
      if (current) setTeacherListings(result.listings || [])
    }).catch((requestError) => {
      if (current) setDataError(requestError.response?.data?.message || 'Could not load your courses for live-class scheduling.')
    })
    return () => { current = false }
  }, [setDataError])

  const submitClass = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    data.setError('')
    setNotice('')
    try {
      const response = editing
        ? await api.put(`/classes/${encodeURIComponent(data.uid)}/${encodeURIComponent(editing.id)}`, values)
        : await api.post(`/classes/${encodeURIComponent(data.uid)}`, values)
      await data.refresh()
      setShowForm(false)
      setEditing(null)
      setNotice(response.data.notificationsSent === false
        ? 'Class saved, but some role notifications could not be delivered.'
        : editing ? 'Class changes saved and relevant users notified.' : 'Class saved and relevant users notified.')
    } catch (requestError) {
      data.setError(requestError.response?.data?.message || 'Could not save this class.')
    } finally {
      setBusy(false)
    }
  }

  return <WorkspaceFrame title="My Classes" description="Open your course content, manage online classes, and view enrolled students." onQuickAction={() => setQuickOpen(true)}>
    <ResultBanner error={data.error} notice={notice} />
    <div className="workspace-toolbar"><label><FiSearch /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search online classes..." /></label><button className="workspace-primary" type="button" onClick={() => { setEditing(null); setShowForm((value) => !value) }}><FiPlus /> Schedule online class</button></div>
    <section className="teacher-course-section" aria-labelledby="teacher-courses-title">
      <header className="teacher-course-section-heading"><div><h2 id="teacher-courses-title">Your Courses</h2><p>Continue building course content or open a course outline.</p></div><Link to="/dashboard/listings">Manage listings</Link></header>
      {visibleListings.length ? <div className="teacher-course-grid">{visibleListings.map((listing) => {
        const courseHref = `/dashboard/course/${encodeURIComponent(listing._id)}`
        return <article className="teacher-course-card" key={listing._id}>
          <div className="teacher-course-cover">
            {listing.image ? <img src={listing.image} alt="" loading="lazy" /> : <FiBookOpen aria-hidden="true" />}
            <span className={`teacher-course-status${listing.isBanned ? ' banned' : ''}`}>{listing.isBanned ? 'Banned' : listing.published === false ? 'Unpublished' : 'Published'}</span>
          </div>
          <div className="teacher-course-card-body">
            <span className="teacher-course-category">{listing.category || 'Online course'}</span>
            <h3>{listing.courseName || listing.name}</h3>
            {listing.courseName && listing.courseName !== listing.name && <p className="teacher-course-batch">{listing.name}</p>}
            <div className="teacher-course-details">
              <span><FiUsers /> {Number(listing.enrolledCount || 0)} students</span>
              <span><FiCalendar /> {Array.isArray(listing.days) && listing.days.length ? listing.days.join(', ') : listing.duration || 'Schedule not set'}</span>
            </div>
            {listing.isBanned && <p className="teacher-course-ban-note">This course was hidden from public pages by an administrator.</p>}
            <div className="teacher-course-actions">
              <Link className="teacher-course-continue" to={courseHref}><FiPlay /> Continue Course</Link>
              <Link className="teacher-course-outline" to={`${courseHref}?tab=modules`}>Course Outline</Link>
            </div>
          </div>
        </article>
      })}</div> : <div className="teacher-course-empty"><FiBookOpen /><strong>{teacherListings.length ? 'No matching courses' : 'No courses yet'}</strong><span>{teacherListings.length ? 'Try another search.' : 'Create and publish a course listing to manage its online content here.'}</span>{!teacherListings.length && <Link to="/dashboard/listings">Go to My Listings</Link>}</div>}
    </section>
    <section className="teacher-scheduled-classes" aria-labelledby="teacher-scheduled-title">
      <header className="teacher-course-section-heading"><div><h2 id="teacher-scheduled-title">Scheduled Online Classes</h2><p>Manage your live sessions and meeting links.</p></div></header>
    {showForm && <form className="workspace-form workspace-class-form" onSubmit={submitClass}>
      <h2>{editing ? 'Edit online class' : 'Schedule an online class'}</h2>
      <input type="hidden" name="classType" value="live" />
      <label>Class name<input name="title" required maxLength="120" defaultValue={editing?.title || ''} /></label>
      <label>Schedule<input name="schedule" required maxLength="120" placeholder="Mon, Wed, Fri" defaultValue={editing?.schedule || ''} /></label>
      <div className="workspace-form-row"><label>Starts at<input name="startTime" required defaultValue={editing?.startTime || ''} placeholder="10:00 AM" /></label><label>Ends at<input name="endTime" required defaultValue={editing?.endTime || ''} placeholder="11:30 AM" /></label></div>
      <div className="workspace-live-fields">
        <label>Course for enrolled students<select name="listingId" required defaultValue={editing?.listingId || ''}><option value="" disabled>Select your course</option>{teacherListings.filter((listing) => listing.status === 'active').map((listing) => <option key={listing._id} value={listing._id}>{listing.name}</option>)}</select><small>Only students enrolled in this published course will receive the Meet link and live-class notification.</small></label>
        <div className="workspace-form-row"><label>Live class date<input name="classDate" type="date" required defaultValue={editing?.classDate || ''} /></label><div className="workspace-meet-create"><span>Google Meet link</span><a href="https://meet.google.com/new" target="_blank" rel="noreferrer"><FiExternalLink /> Create a Meet link</a><small>Open Meet, create a meeting, then paste its link below.</small></div></div>
        <label>Meet URL<input name="meetUrl" type="url" required maxLength="2048" defaultValue={editing?.meetUrl || ''} placeholder="https://meet.google.com/abc-defg-hij" /></label>
      </div>
      <input type="hidden" name="location" value="Online" />
      <label>Subject area<input name="department" required maxLength="100" defaultValue={editing?.department || ''} placeholder="Sciences" /></label>
      <label>Status<select name="status" defaultValue={editing?.status || 'active'}><option value="active">Active</option><option value="upcoming">Upcoming</option><option value="completed">Completed</option></select></label>
      <div className="workspace-form-actions"><button className="workspace-primary" disabled={busy}>{busy ? 'Saving...' : 'Save online class'}</button><button className="workspace-secondary" type="button" onClick={() => { setShowForm(false); setEditing(null) }}>Cancel</button></div>
    </form>}
    {data.loading ? <p className="workspace-empty">Loading classes...</p> : visible.length ? <div className="workspace-class-grid">{visible.map((item) => <article className="workspace-card class-card" key={item.id}>
      <div className="class-card-art"><span className={item.status}>{item.status}</span></div>
      <div className="class-card-body"><h2>{item.title}</h2><p><FiCalendar /> {item.schedule} · {item.startTime}–{item.endTime}</p><p><FiUsers /> {item.enrolled} students enrolled</p><p><FiBookOpen /> Online · {item.department}</p>
        {item.meetUrl && <a className="workspace-online-class-link" href={item.meetUrl} target="_blank" rel="noreferrer"><FiExternalLink /> Open online class</a>}
        <div className="workspace-card-actions"><button type="button" onClick={() => { setEditing(item); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Manage class</button><span>Saved</span></div>
      </div>
    </article>)}</div> : <p className="workspace-empty">No scheduled classes found. Schedule an online class to get started.</p>}
    </section>
    {quickOpen && <QuickActionChooser close={() => setQuickOpen(false)} />}
  </WorkspaceFrame>
}

function DirectoryPage() {
  const data = useWorkspaceData('/students', 'students')
  const classes = useWorkspaceData('/classes', 'classes')
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const filtered = data.items.filter((student) => `${student.name} ${student.studentId} ${student.department} ${student.enrolledClasses?.map((item) => item.title).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const exportCsv = () => {
    const rows = [['Name', 'Student ID', 'Email', 'Department', 'Classes', 'Attendance'], ...filtered.map((student) => [student.name, student.studentId, student.email, student.department, student.enrolledClasses?.map((item) => item.title).join('; ') || '', `${student.attendancePercent || 0}%`])]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.download = 'teachos-students.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }
  const submitStudent = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(form)
    values.classIds = form.getAll('classIds')
    setBusy(true)
    data.setError('')
    setNotice('')
    try {
      await api.post(`/students/${encodeURIComponent(data.uid)}`, values)
      await data.refresh()
      setShowForm(false)
      setNotice('Student saved to MongoDB.')
    } catch (requestError) {
      data.setError(requestError.response?.data?.message || 'Could not save this student.')
    } finally {
      setBusy(false)
    }
  }

  return <WorkspaceFrame title="Student Directory" description="Manage your enrolled students across all classes." onQuickAction={() => setQuickOpen(true)}>
    <ResultBanner error={data.error || classes.error} notice={notice} />
    <div className="workspace-toolbar"><label><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID, department, or class..." /></label><div className="workspace-toolbar-actions"><button className="workspace-secondary" type="button" onClick={exportCsv}><FiDownload /> Export CSV</button><button className="workspace-primary" type="button" onClick={() => setShowForm((value) => !value)}><FiPlus /> Add student</button></div></div>
    <div className="workspace-metrics"><article><span>Total enrolled</span><strong>{data.items.length}</strong></article><article><span>Average attendance</span><strong>{data.items.length ? `${(data.items.reduce((sum, student) => sum + (student.attendancePercent || 0), 0) / data.items.length).toFixed(1)}%` : '—'}</strong></article><article><span>Active departments</span><strong>{new Set(data.items.map((student) => student.department)).size}</strong></article></div>
    {showForm && <form className="workspace-form workspace-class-form" onSubmit={submitStudent}>
      <h2>Add a student</h2><label>Full name<input name="name" required maxLength="120" /></label>
      <div className="workspace-form-row"><label>Student ID (optional)<input name="studentId" maxLength="64" /></label><label>Email<input name="email" type="email" maxLength="254" /></label></div>
      <label>Department<input name="department" maxLength="100" placeholder="Sciences" /></label>
      <label>Enroll in classes<select name="classIds" multiple size={Math.min(Math.max(classes.items.length, 2), 5)}>{classes.items.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select><small>Hold Ctrl (Windows) or Command (Mac) to select multiple classes.</small></label>
      <div className="workspace-form-actions"><button className="workspace-primary" disabled={busy}>{busy ? 'Saving...' : 'Save student'}</button><button className="workspace-secondary" type="button" onClick={() => setShowForm(false)}>Cancel</button></div>
    </form>}
    {data.loading ? <p className="workspace-empty">Loading students...</p> : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Student</th><th>Student ID</th><th>Department</th><th>Enrolled classes</th><th>Attendance</th></tr></thead><tbody>{filtered.map((student) => <tr key={student.id}><td><strong>{student.name}</strong><small>{student.email || 'No email added'}</small></td><td>{student.studentId}</td><td>{student.department}</td><td>{student.enrolledClasses?.map((item) => <span className="workspace-tag" key={item.id}>{item.title}</span>) || '—'}</td><td>{student.attendancePercent || 0}%</td></tr>)}</tbody></table>{!filtered.length && <p className="workspace-empty">No students found.</p>}</div>}
    {quickOpen && <QuickActionChooser close={() => setQuickOpen(false)} />}
  </WorkspaceFrame>
}

function AttendancePage() {
  const { user } = useAuth()
  const uid = user.uid
  const [classes, setClasses] = useState([])
  const [records, setRecords] = useState([])
  const [classId, setClassId] = useState('')
  const [date, setDate] = useState(() => localDateValue(new Date()))
  const [attendanceDraft, setAttendanceDraft] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const selectedClass = classes.find((item) => item.id === classId)
  const selectedDateRecord = records.find((record) => record.classId === classId && record.date === date)
  const classHistory = []
  const recordedDates = new Set()
  for (const record of records) {
    if (record.classId === classId && !recordedDates.has(record.date)) {
      classHistory.push(record)
      recordedDates.add(record.date)
    }
  }
  const attendance = attendanceDraft?.classId === classId && attendanceDraft.date === date
    ? attendanceDraft.records
    : (selectedClass?.students || []).map((student) => ({
      studentId: student.id,
      status: selectedDateRecord?.records?.find((item) => item.studentId === student.id)?.status || null,
    }))
  const statuses = new Map(attendance.map((item) => [item.studentId, item.status]))
  const searchText = search.trim().toLowerCase()
  const visibleStudents = (selectedClass?.students || []).filter((student) => student.name.toLowerCase().includes(searchText))
  const statusCounts = attendance.reduce((counts, item) => {
    if (item.status === 'present') counts.present += 1
    if (item.status === 'absent') counts.absent += 1
    if (item.status === 'late') counts.late += 1
    return counts
  }, { present: 0, absent: 0, late: 0 })
  const studentStats = new Map()
  for (const record of classHistory) {
    for (const item of record.records || []) {
      if (!item.status) continue
      const stats = studentStats.get(item.studentId) || { attended: 0, marked: 0, absences: 0 }
      stats.marked += 1
      if (item.status === 'present' || item.status === 'late') stats.attended += 1
      if (item.status === 'absent') stats.absences += 1
      studentStats.set(item.studentId, stats)
    }
  }
  const percentages = (selectedClass?.students || []).flatMap((student) => {
    const stats = studentStats.get(student.id)
    return stats?.marked ? [Math.round((stats.attended / stats.marked) * 100)] : []
  })
  const average = percentages.length ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length) : null
  const atRiskStudents = (selectedClass?.students || []).flatMap((student) => {
    const stats = studentStats.get(student.id)
    if (!stats?.marked) return []
    const percent = Math.round((stats.attended / stats.marked) * 100)
    return percent < 85 ? [{ ...student, percent, absences: stats.absences }] : []
  }).sort((first, second) => first.percent - second.percent)

  useEffect(() => {
    let current = true
    Promise.all([
      api.get(`/classes/${encodeURIComponent(uid)}`),
      api.get(`/attendance/${encodeURIComponent(uid)}`),
    ]).then(([classResponse, attendanceResponse]) => {
      if (!current) return
      const nextClasses = classResponse.data.classes
      setClasses(nextClasses)
      setRecords(attendanceResponse.data.attendanceRecords)
      setClassId((selectedId) => selectedId && nextClasses.some((item) => item.id === selectedId) ? selectedId : nextClasses[0]?.id || '')
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load attendance data.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [uid])

  const setStatus = (studentId, status) => {
    setAttendanceDraft({
      classId,
      date,
      records: attendance.map((item) => item.studentId === studentId ? { ...item, status } : item),
    })
    setNotice('')
  }

  const saveAttendance = async () => {
    if (!selectedClass) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.put(`/dashboard/${encodeURIComponent(uid)}/attendance`, { classId, date, attendance })
      setRecords((current) => [
        { classId, date, records: attendance, createdAt: new Date().toISOString() },
        ...current.filter((record) => record.classId !== classId || record.date !== date),
      ])
      setAttendanceDraft(null)
      setNotice('Attendance record saved.')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save attendance.')
    } finally {
      setSaving(false)
    }
  }

  return <WorkspaceFrame title="Attendance Dashboard" description="Take attendance, review class trends, and identify students who may need support." onQuickAction={() => setQuickOpen(true)}>
    <ResultBanner error={error} notice={notice} />
    <div className="attendance-toolbar">
      <label><span>Class</span><select value={classId} onChange={(event) => setClassId(event.target.value)} disabled={!classes.length || saving}>{classes.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
      <label><span>Attendance date</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setAttendanceDraft(null) }} disabled={saving} /></label>
      <button className="workspace-primary" type="button" onClick={saveAttendance} disabled={saving || loading || !selectedClass}>{saving ? 'Saving...' : 'Save attendance'}</button>
    </div>
    {loading ? <p className="workspace-empty">Loading attendance dashboard...</p> : !selectedClass ? <p className="workspace-empty">Create a class and enroll students to start taking attendance.</p> : <>
      <div className="attendance-date-heading"><div><span>Daily attendance</span><h2>{selectedClass.title}</h2><p>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p></div><span className="attendance-session-tag">{selectedDateRecord ? 'Record saved' : 'Not submitted'}</span></div>
      <div className="attendance-dashboard-grid">
        <section className="workspace-card attendance-roster-card">
          <header className="attendance-card-heading"><div><h2>Class roster</h2><span>{selectedClass.students?.length || 0} students</span></div><label className="attendance-search"><FiSearch /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a student" aria-label="Find a student" /></label></header>
          <div className="attendance-roster-scroll"><table className="attendance-roster"><thead><tr><th>Student</th><th>Attendance status</th></tr></thead><tbody>
            {visibleStudents.map((student) => {
              const status = statuses.get(student.id)
              const stat = studentStats.get(student.id)
              const initials = student.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
              return <tr key={student.id} className={status === 'absent' ? 'is-absent' : ''}>
                <td><div className="attendance-student-name"><span>{initials}</span><div><strong>{student.name}</strong><small>{stat?.absences ? `${stat.absences} absence${stat.absences === 1 ? '' : 's'} this term` : student.id}</small></div></div></td>
                <td><div className="attendance-status-controls" role="group" aria-label={`Attendance status for ${student.name}`}>
                  {['present', 'absent', 'late'].map((value) => <button type="button" key={value} className={`${value}${status === value ? ' selected' : ''}`} aria-pressed={status === value} onClick={() => setStatus(student.id, value)} disabled={saving}>{value === 'present' ? <FiCheck /> : value === 'late' ? <FiClock /> : <FiX />}{value}</button>)}
                </div></td>
              </tr>
            })}
          </tbody></table>{!visibleStudents.length && <p className="workspace-empty">{selectedClass.students?.length ? 'No students match your search.' : 'No students are enrolled in this class.'}</p>}</div>
          <footer className="attendance-roster-footer"><span>{statusCounts.present + statusCounts.absent + statusCounts.late}/{attendance.length} marked · {statusCounts.present} present · {statusCounts.absent} absent · {statusCounts.late} late</span><button className="workspace-secondary" type="button" onClick={() => { setAttendanceDraft({ classId, date, records: attendance.map((item) => ({ ...item, status: 'present' })) }); setNotice('') }} disabled={saving}>Mark all present</button></footer>
        </section>
        <section className="workspace-card attendance-overview-card">
          <header><div><h2>Class overview</h2><p>Average attendance across saved sessions</p></div><FiCalendar /></header>
          <div className="attendance-average" style={{ '--attendance-value': `${average ?? 0}%` }}><div><strong>{average === null ? '—' : `${average}%`}</strong><span>Average</span></div></div>
          <div className="attendance-today-stats"><article><span>Present today</span><strong>{statusCounts.present}</strong></article><article><span>Absent today</span><strong>{statusCounts.absent}</strong></article></div>
        </section>
        <section className="workspace-card attendance-risk-card">
          <header><div><h2><FiAlertTriangle /> At-risk students</h2><p>Below 85% attendance this term</p></div><span>{atRiskStudents.length}</span></header>
          {atRiskStudents.length ? <ul>{atRiskStudents.map((student) => <li key={student.id}><div><strong>{student.name}</strong><small>{student.absences} absence{student.absences === 1 ? '' : 's'}</small></div><span>{student.percent}%</span></li>)}</ul> : <p className="attendance-risk-empty">{records.some((record) => record.classId === classId) ? 'No students are currently below the attendance threshold.' : 'Save attendance sessions to see students who may need support.'}</p>}
        </section>
      </div>
    </>}
    {quickOpen && <QuickActionChooser close={() => setQuickOpen(false)} />}
  </WorkspaceFrame>
}

function localDateValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function PaymentsPage() {
  const { user } = useAuth()
  const [finance, setFinance] = useState(null)
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7))
  const [mode, setMode] = useState('')
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleBusy, setScheduleBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    if (!user?.uid) return
    setLoading(true)
    setError('')
    try {
      const { data: paymentData } = await api.get('/teacher/payments', { params: { month } })
      setFinance(paymentData)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load payment data.')
    } finally {
      setLoading(false)
    }
  }, [user?.uid, month])
  useEffect(() => {
    if (!user?.uid) return undefined
    let current = true
    api.get('/teacher/payments', { params: { month } }).then(({ data: paymentData }) => {
      if (current) setFinance(paymentData)
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load payment data.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [user?.uid, month])
  const payments = finance?.payments || []
  const payoutRequests = finance?.payoutRequests || []
  const paidOut = payoutRequests.filter((item) => item.status === 'paid').reduce((total, item) => total + (Number(item.amount) || 0), 0)
  const submitFinance = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    setError('')
    setNotice('')
    try {
      values.amount = Number(values.amount)
      await api.post('/teacher/payments/payout-requests', values)
      setNotice('Payout request saved for admin review. No transfer is initiated automatically.')
      await refresh()
      setMode('')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save this financial record.')
    } finally {
      setBusy(false)
    }
  }
  const savePayoutSchedule = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const settings = {
      enabled: Boolean(form.elements.enabled.checked),
      monthlyAmount: Number(values.monthlyAmount),
      dayOfMonth: Number(values.dayOfMonth),
    }
    setScheduleBusy(true)
    setError('')
    setNotice('')
    try {
      const { data: result } = await api.put('/teacher/payments/payout-settings', settings)
      setFinance((current) => ({ ...current, payoutSettings: result.payoutSettings }))
      setNotice('Monthly payout schedule saved. Transfers are not initiated automatically.')
      setScheduleOpen(false)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save your monthly payout schedule.')
    } finally {
      setScheduleBusy(false)
    }
  }
  const transactions = [
    ...payoutRequests.map((item) => ({ ...item, type: 'payout', amount: Number(item.amount) || 0 })),
    ...payments.map((item) => ({ ...item, type: 'payment', amount: Number(item.netAmount) || 0 })),
  ].sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0))
  return <WorkspaceFrame title="Payments & Earnings" description="Review course income, learner payments, and payout requests." onQuickAction={() => setQuickOpen(true)}>
    <ResultBanner error={error} notice={notice} />
    <div className="workspace-finance-actions">
      <label>Report month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      <button className="workspace-secondary" type="button" onClick={() => setScheduleOpen((open) => !open)}>Monthly payout schedule</button>
      <button className="workspace-primary" type="button" onClick={() => setMode(mode === 'payout' ? '' : 'payout')}>Request withdrawal</button>
    </div>
    <div className="workspace-metrics workspace-finance-metrics" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      <article>
        <span>Lifetime Earnings</span>
        <strong>{formatMoney(finance?.lifetimeEarnings ?? finance?.teacherRevenue ?? 0)}</strong>
        <small style={{ color: '#6b7280', fontSize: '11px' }}>Total 95% earned</small>
      </article>
      <article style={{ borderLeft: '3px solid #f59e0b' }}>
        <span>Pending Earnings</span>
        <strong style={{ color: '#d97706' }}>{formatMoney(finance?.pendingEarnings ?? 0)}</strong>
        <small style={{ color: '#6b7280', fontSize: '11px' }}>Held until 1st of following month</small>
      </article>
      <article style={{ borderLeft: '3px solid #10b981' }}>
        <span>Available Balance</span>
        <strong style={{ color: '#059669' }}>{formatMoney(finance?.availableBalance ?? finance?.available ?? 0)}</strong>
        <small style={{ color: '#6b7280', fontSize: '11px' }}>Eligible for withdrawal</small>
      </article>
      <article>
        <span>Withdrawn Amount</span>
        <strong style={{ formatMoney: '#6b7280' }}>{formatMoney(finance?.withdrawnAmount ?? paidOut ?? 0)}</strong>
        <small style={{ color: '#6b7280', fontSize: '11px' }}>Paid out to date</small>
      </article>
      <article>
        <span>One-Time Course Earnings</span>
        <strong>{formatMoney(finance?.oneTimeEarnings ?? 0)}</strong>
        <small style={{ color: '#6b7280', fontSize: '11px' }}>Lifetime access fees</small>
      </article>
      <article>
        <span>Monthly Subscription Earnings</span>
        <strong>{formatMoney(finance?.subscriptionEarnings ?? 0)}</strong>
        <small style={{ color: '#6b7280', fontSize: '11px' }}>Recurring tuition fees</small>
      </article>
      <article>
        <span>Upcoming Payout Date</span>
        <strong style={{ fontSize: '15px' }}>
          {finance?.upcomingPayoutDate
            ? new Date(finance.upcomingPayoutDate).toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: 'short', day: 'numeric' })
            : 'None pending'}
        </strong>
        <small style={{ color: '#6b7280', fontSize: '11px' }}>Asia/Dhaka schedule</small>
      </article>
    </div>
    <p className="workspace-info">Income includes provider-verified live Stripe and bKash course payments (95% teacher share). Following calendar-month settlement rules, earnings remain pending until the end of the payment month, becoming available on the 1st of the following calendar month in Asia/Dhaka time. Only Available Balance can be withdrawn. Payouts are records only; TeachOS does not transfer money.</p>
    {scheduleOpen && <form className="workspace-form workspace-class-form" onSubmit={savePayoutSchedule}>
      <h2>Configure a monthly payout plan</h2>
      <label>Monthly amount (BDT)<input name="monthlyAmount" type="number" step="0.01" min="0" max="10000000" defaultValue={finance?.payoutSettings?.monthlyAmount || ''} required /></label>
      <label>Payout day of month<input name="dayOfMonth" type="number" min="1" max="28" defaultValue={finance?.payoutSettings?.dayOfMonth || 1} required /></label>
      <label className="workspace-checkbox"><input type="checkbox" name="enabled" defaultChecked={Boolean(finance?.payoutSettings?.enabled)} /> Enable this monthly schedule</label>
      <div className="workspace-form-actions"><button className="workspace-primary" disabled={scheduleBusy}>{scheduleBusy ? 'Saving...' : 'Save schedule'}</button><button className="workspace-secondary" type="button" onClick={() => setScheduleOpen(false)}>Cancel</button></div>
    </form>}
    {mode && <form className="workspace-form workspace-class-form" onSubmit={submitFinance}>
      <h2>Request a withdrawal</h2>
      <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#4b5563' }}>
        Available for withdrawal: <strong>{formatMoney(finance?.availableBalance ?? finance?.available ?? 0)}</strong>
        {(finance?.lockedInWithdrawal > 0) && <span> ({formatMoney(finance.lockedInWithdrawal)} currently locked in pending requests)</span>}
      </p>
      <label>Amount (BDT)
        <input
          name="amount"
          type="number"
          step="0.01"
          min="1"
          max={finance?.availableBalance ?? finance?.available ?? 0}
          required
          disabled={(finance?.availableBalance ?? finance?.available ?? 0) <= 0}
          placeholder={`Up to ${finance?.availableBalance ?? finance?.available ?? 0}`}
        />
      </label>
      <label>Method
        <select name="method" required>
          <option value="bank">Bank transfer (request only)</option>
          <option value="bkash">bKash (request only)</option>
          <option value="mobile_wallet">Mobile wallet (request only)</option>
        </select>
      </label>
      <label>Account Number / Reference (or last 4 digits)
        <input name="accountLast4" placeholder="e.g. 017XXXXXXXX or bank account number" required />
      </label>
      <div className="workspace-form-actions">
        <button className="workspace-primary" disabled={busy || (finance?.availableBalance ?? finance?.available ?? 0) <= 0}>
          {busy ? 'Saving...' : 'Submit request'}
        </button>
        <button className="workspace-secondary" type="button" onClick={() => setMode('')}>Cancel</button>
      </div>
    </form>}
    <section className="workspace-card workspace-finance-list">
      <h2>Monthly Earnings History</h2>
      {finance?.monthlyHistory?.length ? (
        finance.monthlyHistory.map((item) => (
          <article key={item.month}>
            <div>
              <strong>{item.month}</strong>
              <small>{item.paymentCount} payments · Gross {formatMoney(item.grossAmount)} · Commission {formatMoney(item.commissionAmount)}</small>
              <small style={{ color: item.pendingAmount > 0 ? '#d97706' : '#059669' }}>
                {item.pendingAmount > 0 ? `Pending: ${formatMoney(item.pendingAmount)}` : 'Fully Released'}
                {item.availableAmount > 0 ? ` · Released: ${formatMoney(item.availableAmount)}` : ''}
              </small>
            </div>
            <div style={{ textAlign: 'right' }}>
              <b style={{ color: '#10b981' }}>{formatMoney(item.netAmount)}</b>
              <span style={{ display: 'block', fontSize: '10px', color: '#6b7280' }}>Teacher 95%</span>
            </div>
          </article>
        ))
      ) : (
        <p className="workspace-empty">No monthly earnings history yet.</p>
      )}
    </section>
    <section className="workspace-card workspace-finance-list">
      <h2>Course-wise revenue</h2>
      {finance?.courseBreakdown?.length ? (
        finance.courseBreakdown.map((course) => (
          <article key={String(course.listingId || course.courseName)}>
            <div>
              <strong>{course.courseName}</strong>
              <small>{course.paymentCount} verified payments · Gross {formatMoney(course.grossAmount)} · Commission {formatMoney(course.commissionAmount)}</small>
            </div>
            <b>{formatMoney(course.netAmount)}</b>
          </article>
        ))
      ) : (
        <p className="workspace-empty">No verified course revenue for this teacher yet.</p>
      )}
    </section>
    <section className="workspace-card workspace-finance-list">
      <h2>Withdrawal History</h2>
      {(finance?.withdrawalHistory || payoutRequests).length ? (
        (finance?.withdrawalHistory || payoutRequests).map((item) => (
          <article key={String(item._id || item.id)}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <strong>Withdrawal Request</strong>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: item.status === 'paid' ? '#dcfce7' : item.status === 'rejected' ? '#fee2e2' : '#fef3c7',
                  color: item.status === 'paid' ? '#166534' : item.status === 'rejected' ? '#991b1b' : '#92400e',
                }}>
                  {item.status}
                </span>
              </div>
              <small>{item.method || 'Transfer'} · {item.accountLast4 ? `Account/Ref: ${item.accountLast4}` : ''}</small>
              <small>
                Requested: {item.requestedAt ? new Date(item.requestedAt).toLocaleDateString() : (item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '')}
                {item.settledAt && ` · Settled: ${new Date(item.settledAt).toLocaleDateString()}`}
                {item.payoutReference && ` · Ref: ${item.payoutReference}`}
              </small>
            </div>
            <b className="negative">−{formatMoney(item.amount)}</b>
          </article>
        ))
      ) : (
        <p className="workspace-empty">No withdrawal requests recorded yet.</p>
      )}
    </section>
    <section className="workspace-card workspace-finance-list">
      <h2>Recent Verified Payments</h2>
      {loading ? (
        <p className="workspace-empty">Loading financial records...</p>
      ) : payments.length ? (
        payments.map((item) => (
          <article key={String(item.id || item._id)}>
            <div>
              <strong>{item.courseName}</strong>
              <small>{item.studentName} · {item.paymentType || 'Course Payment'} · {item.paymentMethod || 'Online'}</small>
              <small>
                {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''} · Gross {formatMoney(item.grossAmount)} · Commission (5%) {formatMoney(item.commission)}
                {item.refundedAmount > 0 && ` · Refunded ${formatMoney(item.refundedAmount)}`}
              </small>
              <small style={{ color: item.earningStatus === 'AVAILABLE' ? '#059669' : '#d97706' }}>
                Status: {item.earningStatus || 'PENDING'}
                {item.availableAt && ` · Available: ${new Date(item.availableAt).toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: 'short', day: 'numeric' })}`}
              </small>
            </div>
            <b style={{ color: '#059669' }}>+{formatMoney(item.netAmount || item.teacherEarning)}</b>
          </article>
        ))
      ) : (
        <p className="workspace-empty">No verified payments recorded yet.</p>
      )}
    </section>
    {quickOpen && <QuickActionChooser close={() => setQuickOpen(false)} />}
  </WorkspaceFrame>
}

const actionItems = [
  { id: 'lesson', title: 'Start next lesson', description: 'Record the start of a class session.' },
  { id: 'message', title: 'Message student', description: 'Save a direct message or class announcement.' },
  { id: 'officeHours', title: 'Schedule office hours', description: 'Add availability for your students.' },
  { id: 'resources', title: 'Upload resources', description: 'Store a resource link or file in MongoDB.' },
]

export function QuickActionChooser({ close }) {
  return <div className="workspace-modal-backdrop" onClick={close}><section className="workspace-quick-modal" onClick={(event) => event.stopPropagation()}><header><div><p>TeachOS</p><h2>Quick actions</h2><span>Choose a task to continue.</span></div><button aria-label="Close quick actions" onClick={close}><FiX /></button></header><div>{actionItems.map((item) => <Link to="/dashboard/actions" key={item.id} onClick={() => { sessionStorage.setItem('teachos-action', item.id); close() }}><strong>{item.title}</strong><span>{item.description}</span></Link>)}<Link to="/dashboard/classes" onClick={close}><strong>Create a class</strong><span>Set a schedule and roster.</span></Link><Link to="/dashboard/directory" onClick={close}><strong>Add a student</strong><span>Save student and enrollment details.</span></Link><Link to="/dashboard" onClick={close}><strong>Mark attendance</strong><span>Open your class attendance list.</span></Link></div></section></div>
}

function QuickActionsPage() {
  const data = useWorkspaceData('/actions/resources', 'resources', false)
  const { user } = useAuth()
  const { setError, setItems, setLoading } = data
  const [messages, setMessages] = useState([])
  const [officeHours, setOfficeHours] = useState([])
  const [lessons, setLessons] = useState([])
  const [classes, setClasses] = useState([])
  const [selected, setSelected] = useState(() => {
    const action = sessionStorage.getItem('teachos-action') || ''
    sessionStorage.removeItem('teachos-action')
    return action
  })
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const uid = user.uid

  const refreshActions = async () => {
    try {
      const [messageResponse, hoursResponse, resourceResponse, lessonResponse, classResponse] = await Promise.all([
        api.get(`/actions/messages/${encodeURIComponent(uid)}`),
        api.get(`/actions/officeHours/${encodeURIComponent(uid)}`),
        api.get(`/actions/resources/${encodeURIComponent(uid)}`),
        api.get(`/actions/lessons/${encodeURIComponent(uid)}`),
        api.get(`/classes/${encodeURIComponent(uid)}`),
      ])
      setMessages(messageResponse.data.messages)
      setOfficeHours(hoursResponse.data.officeHours)
      setItems(resourceResponse.data.resources)
      setLessons(lessonResponse.data.lessons)
      setClasses(classResponse.data.classes)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load saved actions.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    let current = true
    Promise.all([
      api.get(`/actions/messages/${encodeURIComponent(uid)}`),
      api.get(`/actions/officeHours/${encodeURIComponent(uid)}`),
      api.get(`/actions/resources/${encodeURIComponent(uid)}`),
      api.get(`/actions/lessons/${encodeURIComponent(uid)}`),
      api.get(`/classes/${encodeURIComponent(uid)}`),
    ]).then(([messageResponse, hoursResponse, resourceResponse, lessonResponse, classResponse]) => {
      if (!current) return
      setMessages(messageResponse.data.messages)
      setOfficeHours(hoursResponse.data.officeHours)
      setItems(resourceResponse.data.resources)
      setLessons(lessonResponse.data.lessons)
      setClasses(classResponse.data.classes)
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load saved actions.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [uid, setError, setItems, setLoading])

  const submitAction = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (selected === 'lesson') {
        await api.post(`/actions/lessons/${encodeURIComponent(uid)}/start`, { classId: values.classId })
      } else if (selected === 'resources' && form.elements.file.files[0]) {
        const file = form.elements.file.files[0]
        if (file.size > 10 * 1024 * 1024) throw new Error('Files must be no larger than 10 MB.')
        await api.post(`/actions/resources/${encodeURIComponent(uid)}/file`, await file.arrayBuffer(), {
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Resource-Title': encodeURIComponent(values.title),
            'X-Resource-Description': encodeURIComponent(values.description || ''),
            'X-Resource-Url': encodeURIComponent(values.url || ''),
            'X-File-Name': encodeURIComponent(file.name),
          },
        })
      } else {
        if (selected === 'officeHours') {
          values.location ||= ''
        }
        await api.post(`/actions/${selected}/${encodeURIComponent(uid)}`, values)
      }
      await refreshActions()
      form.reset()
      setNotice('Information saved to MongoDB.')
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Could not save this information.')
    } finally {
      setBusy(false)
    }
  }

  return <WorkspaceFrame title="Quick Actions" description="Send messages, schedule office hours, and store teaching resources." onQuickAction={() => setSelected('')}>
    <ResultBanner error={data.error} notice={notice} />
    <div className="workspace-action-grid">{actionItems.map((item) => <button className={selected === item.id ? 'selected' : ''} key={item.id} onClick={() => setSelected(item.id)}><strong>{item.title}</strong><span>{item.description}</span></button>)}</div>
    {selected && <form className="workspace-form workspace-class-form" onSubmit={submitAction}>
      <h2>{actionItems.find((item) => item.id === selected)?.title}</h2>
      {selected === 'message' && <><label>Recipient or class<input name="recipient" maxLength="200" placeholder="Student name, email, or all students" /></label><label>Subject<input name="subject" required maxLength="120" /></label><label>Message<textarea name="message" required maxLength="5000" rows="5" /></label></>}
      {selected === 'lesson' && <label>Class<select name="classId" required>{classes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      {selected === 'officeHours' && <><label>Title<input name="title" required maxLength="120" /></label><div className="workspace-form-row"><label>Date<input name="date" type="date" required /></label><label>Location<input name="location" maxLength="200" placeholder="Room or video link" /></label></div><div className="workspace-form-row"><label>Starts at<input name="startTime" type="time" required /></label><label>Ends at<input name="endTime" type="time" required /></label></div></>}
      {selected === 'resources' && <><label>Resource title<input name="title" required maxLength="160" /></label><label>Description<input name="description" maxLength="1000" /></label><label>Resource URL (optional)<input name="url" type="url" maxLength="2048" placeholder="https://" /></label><label>Or upload a file (up to 10 MB)<input name="file" type="file" /></label></>}
      <div className="workspace-form-actions"><button className="workspace-primary" disabled={busy}>{busy ? 'Saving...' : 'Save to database'}</button><button className="workspace-secondary" type="button" onClick={() => setSelected('')}>Cancel</button></div>
    </form>}
    <div className="workspace-saved-actions">
      <section className="workspace-card"><h2>Saved office hours</h2>{officeHours.map((item) => <article key={item.id}><strong>{item.title}</strong><span>{item.date} · {item.startTime}–{item.endTime} · {item.location || 'Location not set'}</span></article>)}{!officeHours.length && <p className="workspace-empty">No office hours saved.</p>}</section>
      <section className="workspace-card"><h2>Saved messages</h2>{messages.map((item) => <article key={item.id}><strong>{item.subject}</strong><span>{item.recipient || 'Class announcement'} · {new Date(item.createdAt).toLocaleDateString()}</span></article>)}{!messages.length && <p className="workspace-empty">No messages saved.</p>}</section>
      <section className="workspace-card"><h2>Teaching resources</h2>{data.items.map((item) => <article key={item.id}><strong>{item.title}</strong><span>{item.description || item.filename || item.url || 'Resource saved'}</span>{item.fileId && <a href={`${api.defaults.baseURL}/actions/resources/${encodeURIComponent(uid)}/${encodeURIComponent(item.id)}/file`}>Download file</a>}{item.url && <a href={item.url} target="_blank" rel="noreferrer">Open link</a>}</article>)}{!data.items.length && <p className="workspace-empty">No resources saved.</p>}</section>
      <section className="workspace-card"><h2>Started lessons</h2>{lessons.map((item) => <article key={item.id}><strong>{item.classTitle}</strong><span>{new Date(item.startedAt).toLocaleString()} · {item.status}</span></article>)}{!lessons.length && <p className="workspace-empty">No lesson sessions started.</p>}</section>
    </div>
    {data.loading && <p className="workspace-empty">Loading saved actions...</p>}
  </WorkspaceFrame>
}

function formatMoney(amount) {
  const formattedAmount = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)
  return `৳${formattedAmount}`
}

export { AttendancePage, ClassesPage, DirectoryPage, PaymentsPage, QuickActionsPage }
