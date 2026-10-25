import { useEffect, useState } from 'react'
import { FiAlertTriangle, FiBookOpen, FiCalendar, FiCheck, FiClock, FiDownload, FiFileText, FiGrid, FiHelpCircle, FiLogOut, FiPlus, FiSearch, FiSettings, FiUsers, FiX } from 'react-icons/fi'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import '../styles/workspace-pages.css'

function WorkspaceFrame({ title, description, children, onQuickAction }) {
  const { user, signOut } = useAuth()
  const location = useLocation()
  const name = user?.displayName || user?.email?.split('@')[0] || 'Teacher'
  const navigation = [
    { to: '/dashboard', label: 'Dashboard', icon: FiGrid },
    { to: '/dashboard/classes', label: 'Classes', icon: FiBookOpen },
    { to: '/dashboard/listings', label: 'My listings', icon: FiPlus },
    { to: '/dashboard/attendance', label: 'Attendance', icon: FiCheck },
    { to: '/dashboard/directory', label: 'Directory', icon: FiUsers },
    { to: '/dashboard/payments', label: 'Payments', icon: FiCalendar },
  ]

  return <div className="workspace-shell">
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
      <header className="workspace-topbar"><label><FiSearch /><input placeholder={`Search ${title.toLowerCase()}...`} aria-label={`Search ${title}`} /></label><span>{user?.email}</span></header>
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
  const uid = user?.uid || `demo-${user?.email || 'teacher'}`
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
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const visible = data.items.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()))

  const submitClass = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    data.setError('')
    setNotice('')
    try {
      if (editing) await api.put(`/classes/${encodeURIComponent(data.uid)}/${encodeURIComponent(editing.id)}`, values)
      else await api.post(`/classes/${encodeURIComponent(data.uid)}`, values)
      await data.refresh()
      setShowForm(false)
      setEditing(null)
      setNotice(editing ? 'Class changes saved.' : 'Class saved to MongoDB.')
    } catch (requestError) {
      data.setError(requestError.response?.data?.message || 'Could not save this class.')
    } finally {
      setBusy(false)
    }
  }

  return <WorkspaceFrame title="Active Classes" description="Manage your course roster, schedules, and upcoming sessions." onQuickAction={() => setQuickOpen(true)}>
    <ResultBanner error={data.error} notice={notice} />
    <div className="workspace-toolbar"><label><FiSearch /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search classes..." /></label><button className="workspace-primary" type="button" onClick={() => { setEditing(null); setShowForm((value) => !value) }}><FiPlus /> Create class</button></div>
    {showForm && <form className="workspace-form workspace-class-form" onSubmit={submitClass}>
      <h2>{editing ? 'Edit class' : 'Create a class'}</h2>
      <label>Class name<input name="title" required maxLength="120" defaultValue={editing?.title || ''} /></label>
      <label>Schedule<input name="schedule" required maxLength="120" placeholder="Mon, Wed, Fri" defaultValue={editing?.schedule || ''} /></label>
      <div className="workspace-form-row"><label>Starts at<input name="startTime" required defaultValue={editing?.startTime || ''} placeholder="10:00 AM" /></label><label>Ends at<input name="endTime" required defaultValue={editing?.endTime || ''} placeholder="11:30 AM" /></label></div>
      <label>Location<input name="location" required maxLength="120" defaultValue={editing?.location || ''} placeholder="Room 4B / Hybrid" /></label>
      <label>Department<input name="department" required maxLength="100" defaultValue={editing?.department || ''} placeholder="Sciences" /></label>
      <label>Status<select name="status" defaultValue={editing?.status || 'active'}><option value="active">Active</option><option value="upcoming">Upcoming</option><option value="completed">Completed</option></select></label>
      <div className="workspace-form-actions"><button className="workspace-primary" disabled={busy}>{busy ? 'Saving...' : 'Save class'}</button><button className="workspace-secondary" type="button" onClick={() => { setShowForm(false); setEditing(null) }}>Cancel</button></div>
    </form>}
    {data.loading ? <p className="workspace-empty">Loading classes...</p> : visible.length ? <div className="workspace-class-grid">{visible.map((item) => <article className="workspace-card class-card" key={item.id}>
      <div className="class-card-art"><span className={item.status}>{item.status}</span></div>
      <div className="class-card-body"><h2>{item.title}</h2><p><FiCalendar /> {item.schedule} · {item.startTime}–{item.endTime}</p><p><FiUsers /> {item.enrolled} students enrolled</p><p><FiBookOpen /> {item.location}</p>
        <div className="workspace-card-actions"><button type="button" onClick={() => { setEditing(item); setShowForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Manage class</button><span>{item.isSample ? 'Sample' : 'Saved'}</span></div>
      </div>
    </article>)}</div> : <p className="workspace-empty">No classes found. Create a class to get started.</p>}
    {quickOpen && <QuickActionChooser close={() => setQuickOpen(false)} />}
  </WorkspaceFrame>
}

function TeacherListingsPage() {
  const { user } = useAuth()
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [quickOpen, setQuickOpen] = useState(false)
  const [assignmentListing, setAssignmentListing] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  const [assignmentSaving, setAssignmentSaving] = useState(false)

  useEffect(() => {
    let current = true
    api.get('/listings/my', { params: { page: 1, limit: 100 } }).then(({ data }) => {
      if (current) setListings(data.listings || [])
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load your listings.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [user?.uid, refresh])

  useEffect(() => {
    if (!assignmentListing) return undefined
    let current = true
    api.get(`/listings/${encodeURIComponent(assignmentListing._id)}/assignments`).then(({ data }) => {
      if (current) setAssignments(data.assignments || [])
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load course assignments.')
    }).finally(() => {
      if (current) setAssignmentsLoading(false)
    })
    return () => { current = false }
  }, [assignmentListing])

  const submitListing = async (event) => {
    event.preventDefault()
    const form = Object.fromEntries(new FormData(event.currentTarget))
    form.fee = Number(form.fee || 0)
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await api.post('/listings', form)
      setShowForm(false)
      setNotice('Listing published and available on the TeachOS home page.')
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not publish this listing.')
    } finally {
      setSaving(false)
    }
  }

  const removeListing = async (listing) => {
    if (!window.confirm(`Remove "${listing.name}" from the home page?`)) return
    setError('')
    setNotice('')
    try {
      await api.delete(`/listings/${encodeURIComponent(listing._id)}`)
      setListings((current) => current.filter((item) => item._id !== listing._id))
      setNotice('Listing removed from the home page.')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not remove this listing.')
    }
  }

  const createAssignment = async (event) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = Object.fromEntries(new FormData(event.currentTarget))
    setAssignmentSaving(true)
    setError('')
    setNotice('')
    try {
      const { data } = await api.post(`/listings/${encodeURIComponent(assignmentListing._id)}/assignments`, form)
      setAssignments((current) => [data.assignment, ...current])
      formElement.reset()
      setNotice('Assignment published for students enrolled in this course.')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create this assignment.')
    } finally {
      setAssignmentSaving(false)
    }
  }

  return <WorkspaceFrame title="My Listings" description="Publish and manage course listings shown on the TeachOS home page." onQuickAction={() => setQuickOpen(true)}>
    <ResultBanner error={error} notice={notice} />
    <div className="workspace-toolbar"><span className="workspace-listing-count">{listings.length} published listings</span><button className="workspace-primary" type="button" onClick={() => setShowForm((value) => !value)}><FiPlus /> Create listing</button></div>
    {showForm && <form className="workspace-form workspace-class-form" onSubmit={submitListing}>
      <h2>Publish a course or batch</h2>
      <label>Listing title<input name="name" required minLength="3" maxLength="150" placeholder="e.g. HSC Physics evening batch" /></label>
      <div className="workspace-form-row"><label>Category<select name="category" required defaultValue=""><option value="" disabled>Select category</option><option>Online Course</option><option>Offline Batch</option><option>Exam Preparation</option><option>Skill Course</option></select></label><label>Fee in taka<input name="fee" type="number" min="0" step="0.01" defaultValue="0" /></label></div>
      <div className="workspace-form-row"><label>Duration / schedule<input name="duration" required minLength="2" maxLength="100" placeholder="12 weeks · weekends" /></label><label>Location or delivery mode<input name="location" required minLength="2" maxLength="200" placeholder="Online or Mirpur, Dhaka" /></label></div>
      <label>Description<textarea name="description" required minLength="10" maxLength="5000" rows="4" placeholder="Describe the course, outcomes, and who should join." /></label>
      <div className="workspace-form-row"><label>Start date<input name="startDate" type="date" /></label><label>Cover image URL (optional)<input name="image" type="url" placeholder="https://" /></label></div>
      <div className="workspace-form-actions"><button className="workspace-primary" disabled={saving}>{saving ? 'Publishing...' : 'Publish listing'}</button><button className="workspace-secondary" type="button" onClick={() => setShowForm(false)}>Cancel</button></div>
    </form>}
    {loading ? <p className="workspace-empty">Loading your listings...</p> : listings.length ? <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Course</th><th>Category</th><th>Fee</th><th>Duration</th><th>Published</th><th>Actions</th></tr></thead><tbody>{listings.map((item) => <tr key={item._id}><td><strong>{item.name}</strong><small>{item.location}</small></td><td>{item.category}</td><td>{item.fee ? `৳${Number(item.fee).toLocaleString('en-BD')}` : 'Free'}</td><td>{item.duration}</td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td><div className="workspace-listing-actions"><button className="workspace-listing-assignments" type="button" onClick={() => { setAssignments([]); setAssignmentsLoading(true); setAssignmentListing(item); setNotice(''); setError('') }}><FiFileText /> Assignments</button><button className="workspace-listing-remove" type="button" onClick={() => removeListing(item)}>Remove</button></div></td></tr>)}</tbody></table></div> : <p className="workspace-empty">You have no published listings yet. Create one to show it on the TeachOS home page.</p>}
    {quickOpen && <QuickActionChooser close={() => setQuickOpen(false)} />}
    {assignmentListing && <div className="workspace-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !assignmentSaving) setAssignmentListing(null) }}><section className="workspace-modal workspace-assignment-modal" role="dialog" aria-modal="true" aria-labelledby="course-assignments-title">
      <button className="workspace-modal-close" type="button" aria-label="Close assignments" disabled={assignmentSaving} onClick={() => setAssignmentListing(null)}><FiX /></button>
      <p>Course assignments</p><h2 id="course-assignments-title">{assignmentListing.name}</h2><ResultBanner error={error} notice={notice} />
      <form className="workspace-assignment-form" onSubmit={createAssignment}><label>Assignment title<input name="title" required minLength="3" maxLength="150" placeholder="e.g. Week 1 problem set" /></label><label>Instructions<textarea name="description" maxLength="5000" rows="3" placeholder="What should students complete?" /></label><label>Due date (optional)<input name="dueDate" type="date" /></label><button className="workspace-primary" disabled={assignmentSaving}>{assignmentSaving ? 'Publishing...' : 'Publish assignment'}</button></form>
      <h3>Published assignments</h3>{assignmentsLoading ? <p className="workspace-empty">Loading assignments...</p> : assignments.length ? <div className="workspace-assignment-list">{assignments.map((assignment) => <article key={assignment._id}><div><strong>{assignment.title}</strong><span>{assignment.dueDate ? `Due ${new Date(assignment.dueDate).toLocaleDateString()}` : 'No due date'} · {assignment.submissions?.length || 0} submissions</span>{assignment.description && <p>{assignment.description}</p>}</div>{assignment.submissions?.length > 0 && <details><summary>View student submissions</summary>{assignment.submissions.map((submission) => <blockquote key={submission._id}><strong>{submission.studentName || 'Student'}</strong><p>{submission.content}</p><small>{new Date(submission.submittedAt).toLocaleString()}</small></blockquote>)}</details>}</article>)}</div> : <p className="workspace-empty">No assignments for this course yet. Publish one above to share it with enrolled students.</p>}
    </section></div>}
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
    {data.items.some((student) => student.isSample) && <p className="workspace-info">This directory includes starter sample students. Add real student records to build your own roster.</p>}
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
  const uid = user?.uid || `demo-${user?.email || 'teacher'}`
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
  const data = useWorkspaceData('/payments', 'payments', false)
  const { uid, setError, setItems, setLoading } = data
  const [finance, setFinance] = useState(null)
  const [classes, setClasses] = useState([])
  const [mode, setMode] = useState('')
  const [notice, setNotice] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setError('')
    try {
      const [paymentResponse, classResponse] = await Promise.all([
        api.get(`/payments/${encodeURIComponent(uid)}`),
        api.get(`/classes/${encodeURIComponent(uid)}`),
      ])
      setFinance(paymentResponse.data)
      setClasses(classResponse.data.classes)
      setItems(paymentResponse.data.payments)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load payment data.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    let current = true
    Promise.all([
      api.get(`/payments/${encodeURIComponent(uid)}`),
      api.get(`/classes/${encodeURIComponent(uid)}`),
    ]).then(([paymentResponse, classResponse]) => {
      if (!current) return
      setFinance(paymentResponse.data)
      setClasses(classResponse.data.classes)
      setItems(paymentResponse.data.payments)
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load payment data.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [uid, setError, setItems, setLoading])
  const submitFinance = async (event) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'earning') {
        values.amount = Number(values.amount)
        if (!values.classId) delete values.classId
        await api.post(`/payments/${encodeURIComponent(uid)}`, values)
        setNotice('Payment record saved to MongoDB.')
      } else {
        values.amount = Number(values.amount)
        await api.post(`/payments/${encodeURIComponent(uid)}/payout-requests`, values)
        setNotice('Payout request recorded. It will not transfer money automatically.')
      }
      await refresh()
      setMode('')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save this financial record.')
    } finally {
      setBusy(false)
    }
  }
  const totalPaid = finance?.payoutRequests?.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.amount, 0) || 0

  return <WorkspaceFrame title="Payments & Earnings" description="Review saved financial records and create payout requests." onQuickAction={() => setQuickOpen(true)}>
    <ResultBanner error={data.error} notice={notice} />
    <div className="workspace-finance-actions"><button className="workspace-secondary" type="button" onClick={() => setMode(mode === 'earning' ? '' : 'earning')}><FiPlus /> Record payment</button><button className="workspace-primary" type="button" onClick={() => setMode(mode === 'payout' ? '' : 'payout')}>Request payout</button></div>
    <div className="workspace-metrics workspace-finance-metrics"><article><span>Total recorded earnings</span><strong>{formatMoney(finance?.earnings || 0, finance?.currency || 'BDT')}</strong></article><article><span>Available for payout</span><strong>{formatMoney(finance?.available || 0, finance?.currency || 'BDT')}</strong></article><article><span>Paid out</span><strong>{formatMoney(totalPaid, finance?.currency || 'BDT')}</strong></article></div>
    {finance?.hasSample && <p className="workspace-info">The earnings and payout marked “Sample” are starter data stored for this account. Add your own payment records to replace them.</p>}
    <p className="workspace-info">Payout requests are stored for review only. Connect a payment provider separately before enabling real transfers.</p>
    {mode && <form className="workspace-form workspace-class-form" onSubmit={submitFinance}>
      <h2>{mode === 'earning' ? 'Record a payment' : 'Request a payout'}</h2>
      <label>Amount<input name="amount" type="number" step="0.01" min="0.01" required /></label>
      {mode === 'earning' ? <>
        <label>Description<input name="description" required maxLength="160" placeholder="Tuition payment" /></label>
        <label>Class (optional)<select name="classId"><option value="">Not assigned to a class</option>{classes.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <label>Date<input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label>Currency<input name="currency" defaultValue="BDT" pattern="[A-Z]{3}" maxLength="3" required /></label>
      </> : <>
        <label>Method<select name="method" required><option value="bank">Bank transfer (request only)</option><option value="mobile_wallet">Mobile wallet (request only)</option></select></label>
        <label>Account last 4 digits (optional)<input name="accountLast4" inputMode="numeric" pattern="[0-9]{4}" maxLength="4" /></label>
      </>}
      <div className="workspace-form-actions"><button className="workspace-primary" disabled={busy}>{busy ? 'Saving...' : mode === 'earning' ? 'Save payment' : 'Submit request'}</button><button className="workspace-secondary" type="button" onClick={() => setMode('')}>Cancel</button></div>
    </form>}
    <section className="workspace-card workspace-finance-list"><h2>Recent transactions</h2>{data.loading ? <p className="workspace-empty">Loading transactions...</p> : [...(finance?.payoutRequests || []).map((item) => ({ ...item, type: 'payout' })), ...data.items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((item) => <article key={item.id}><div><strong>{item.description || (item.type === 'payout' ? 'Payout request' : 'Payment')}</strong><small>{item.date || new Date(item.createdAt).toLocaleDateString()} · {item.status}{item.isSample ? ' · Sample' : ''}</small></div><b className={item.type === 'payout' ? 'negative' : ''}>{item.type === 'payout' ? '−' : '+'}{formatMoney(item.amount, item.currency || finance?.currency || 'BDT')}</b></article>)}</section>
    {quickOpen && <QuickActionChooser close={() => setQuickOpen(false)} />}
  </WorkspaceFrame>
}

const actionItems = [
  { id: 'lesson', title: 'Start next lesson', description: 'Record the start of a class session.' },
  { id: 'message', title: 'Message student', description: 'Save a direct message or class announcement.' },
  { id: 'officeHours', title: 'Schedule office hours', description: 'Add availability for your students.' },
  { id: 'resources', title: 'Upload resources', description: 'Store a resource link or file in MongoDB.' },
]

function QuickActionChooser({ close }) {
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
  const uid = user?.uid || `demo-${user?.email || 'teacher'}`

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

export { AttendancePage, ClassesPage, DirectoryPage, PaymentsPage, QuickActionsPage, TeacherListingsPage }
