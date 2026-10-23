import { useCallback, useEffect, useMemo, useState } from 'react'
import { FiBookOpen, FiCalendar, FiCheck, FiChevronRight, FiGrid, FiHelpCircle, FiLogOut, FiMenu, FiSearch, FiSettings, FiUsers, FiX } from 'react-icons/fi'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import '../styles/dashboard.css'

const initials = (name) => name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()

function Dashboard() {
  const { user, signOut } = useAuth()
  const [dashboard, setDashboard] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const uid = user?.uid || `demo-${user?.email || 'teacher'}`
  const currentClass = dashboard?.classes?.find((item) => item.id === dashboard.attendanceClassId) || dashboard?.classes?.[0]

  const fetchDashboard = useCallback(async () => {
    const { data } = await api.get(`/dashboard/${encodeURIComponent(uid)}`)
    return data.dashboard
  }, [uid])

  useEffect(() => {
    let isCurrent = true
    fetchDashboard().then((data) => {
      if (!isCurrent) return
      setDashboard(data)
      const activeClass = data.classes.find((item) => item.id === data.attendanceClassId) || data.classes[0]
      setAttendance(activeClass?.students?.map(({ id, status }) => ({ studentId: id, status })) || [])
    }).catch(() => {
      if (isCurrent) setError('We could not load your dashboard. Check that the TeachOS server and MongoDB are running.')
    }).finally(() => {
      if (isCurrent) setLoading(false)
    })
    return () => { isCurrent = false }
  }, [fetchDashboard])

  const retryLoad = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchDashboard()
      setDashboard(data)
      const activeClass = data.classes.find((item) => item.id === data.attendanceClassId) || data.classes[0]
      setAttendance(activeClass?.students?.map(({ id, status }) => ({ studentId: id, status })) || [])
    } catch {
      setError('We could not load your dashboard. Check that the TeachOS server and MongoDB are running.')
    } finally {
      setLoading(false)
    }
  }

  const filteredClasses = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return dashboard?.classes || []
    return (dashboard?.classes || []).filter((item) => item.title.toLowerCase().includes(query))
  }, [dashboard, search])

  const setStudentStatus = (studentId, status) => {
    setAttendance((current) => current.map((item) => item.studentId === studentId ? { ...item, status } : item))
  }

  const markAllPresent = () => setAttendance((current) => current.map((item) => ({ ...item, status: 'present' })))

  const saveAttendance = async () => {
    if (!currentClass) return
    setSaving(true)
    setNotice('')
    setError('')
    try {
      await api.put(`/dashboard/${encodeURIComponent(uid)}/attendance`, {
        classId: currentClass.id,
        attendance,
      })
      setNotice('Attendance saved.')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Attendance could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
  const teacherName = user?.displayName || user?.email?.split('@')[0] || 'Professor'
  const attendedCount = attendance.filter((item) => item.status).length

  return (
    <div className="teacher-dashboard">
      <header className="dashboard-mobile-header">
        <Link className="dashboard-brand" to="/"><span>TeachOS</span></Link>
        <button className="dashboard-icon-button" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onClick={() => setMenuOpen((open) => !open)}>
          {menuOpen ? <FiX /> : <FiMenu />}
        </button>
      </header>

      <aside className={`dashboard-sidebar${menuOpen ? ' is-open' : ''}`}>
        <Link className="dashboard-brand" to="/"><span>TeachOS</span></Link>
        <div className="dashboard-profile">
          <div className="dashboard-profile-avatar">{initials(teacherName)}</div>
          <div><strong>{teacherName}</strong><span>Teacher workspace</span></div>
        </div>
        <button className="dashboard-quick-action" type="button" onClick={() => document.getElementById('today-lessons')?.scrollIntoView({ behavior: 'smooth' })}>
          <FiCalendar /> View today&apos;s schedule
        </button>
        <nav className="dashboard-nav" aria-label="Dashboard navigation">
          <a className="selected" href="#overview" onClick={() => setMenuOpen(false)}><FiGrid /> Dashboard</a>
          <Link to="/dashboard/classes" onClick={() => setMenuOpen(false)}><FiBookOpen /> Classes</Link>
          <Link to="/dashboard/attendance" onClick={() => setMenuOpen(false)}><FiCheck /> Attendance</Link>
          <Link to="/dashboard/directory" onClick={() => setMenuOpen(false)}><FiUsers /> Directory</Link>
          <Link to="/dashboard/payments" onClick={() => setMenuOpen(false)}><FiBookOpen /> Payments</Link>
        </nav>
        <Link className="dashboard-quick-action" to="/dashboard/actions"><FiCalendar /> Quick actions</Link>
        <div className="dashboard-nav-bottom">
          <Link to="/dashboard/actions"><FiSettings /> Office hours &amp; resources</Link>
          <a href="mailto:support@teachos.example"><FiHelpCircle /> Support</a>
          <button type="button" onClick={() => signOut()}><FiLogOut /> Sign out</button>
        </div>
      </aside>

      <main className="dashboard-main" id="overview">
        <header className="dashboard-topbar">
          <label className="dashboard-search">
            <FiSearch aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your classes..." aria-label="Search classes" />
          </label>
          <div className="dashboard-topbar-user"><span>{today}</span><div className="dashboard-profile-avatar">{initials(teacherName)}</div></div>
        </header>
        <div className="dashboard-content">
          <div className="dashboard-page-heading">
            <div><p className="dashboard-eyebrow">Teacher workspace</p><h1>Good morning, {teacherName}</h1><p>Here is your overview for today, {today}.</p></div>
            <a className="dashboard-secondary-button" href="#today-lessons"><FiCalendar /> Schedule</a>
          </div>
          {dashboard?.isSample && <div className="dashboard-sample-note" role="status">You&apos;re viewing starter sample data. Attendance changes are saved to MongoDB; replace the sample class and finance records with your own data.</div>}
          {error && <div className="dashboard-error" role="alert">{error}<button type="button" onClick={retryLoad}>Try again</button></div>}
          {notice && <div className="dashboard-success" role="status">{notice}</div>}
          {loading ? <div className="dashboard-loading" role="status">Loading your dashboard...</div> : dashboard && (
            <div className="dashboard-grid">
              <div className="dashboard-primary-column">
                <section className="dashboard-panel lesson-panel" id="today-lessons">
                  <div className="dashboard-panel-heading">
                    <h2><FiBookOpen /> Today&apos;s Lessons</h2>
                    <span className="dashboard-count-pill">{dashboard.classes.filter((item) => item.status !== 'completed').length} Classes Remaining</span>
                  </div>
                  <div className="lesson-list">
                    {filteredClasses.length ? filteredClasses.map((lesson) => (
                      <article className={`lesson-row${lesson.status === 'live' ? ' is-live' : ''}`} key={lesson.id}>
                        <div className="lesson-time"><strong>{lesson.time}</strong><span>{lesson.period}</span></div>
                        <div className="lesson-details">
                          <div className="lesson-title-row">{lesson.status === 'live' && <span className="live-badge"><i /> Live now</span>}<h3>{lesson.title}</h3></div>
                          <p><FiUsers /> {lesson.enrolled} students enrolled</p>
                        </div>
                        <span className="lesson-location">{lesson.location}</span>
                      </article>
                    )) : <p className="dashboard-empty">No classes match “{search}”.</p>}
                  </div>
                </section>

                <section className="dashboard-panel attendance-panel" id="attendance">
                  <div className="dashboard-panel-heading attendance-heading">
                    <div><h2><FiCheck /> Quick Attendance</h2><p>{currentClass?.title || 'No class selected'} · Current session</p></div>
                    <a href="#roster">View full roster <FiChevronRight /></a>
                  </div>
                  {currentClass?.students?.length ? <>
                    <div className="attendance-list">
                      {currentClass.students.map((student) => {
                        const status = attendance.find((item) => item.studentId === student.id)?.status
                        return <div className="attendance-student" key={student.id}>
                          <span className="student-avatar">{initials(student.name)}</span><strong>{student.name}</strong>
                          <div className="attendance-controls" role="group" aria-label={`Attendance for ${student.name}`}>
                            <button className={status === 'present' ? 'present selected' : 'present'} type="button" aria-label={`Mark ${student.name} present`} aria-pressed={status === 'present'} onClick={() => setStudentStatus(student.id, 'present')}><FiCheck /></button>
                            <button className={status === 'absent' ? 'absent selected' : 'absent'} type="button" aria-label={`Mark ${student.name} absent`} aria-pressed={status === 'absent'} onClick={() => setStudentStatus(student.id, 'absent')}><FiX /></button>
                          </div>
                        </div>
                      })}
                    </div>
                    <div className="attendance-footer"><span>{attendedCount}/{attendance.length} marked</span><button className="dashboard-secondary-button" type="button" onClick={markAllPresent}>Mark all present</button><button className="dashboard-primary-button" type="button" onClick={saveAttendance} disabled={saving}>{saving ? 'Saving...' : 'Save attendance'}</button></div>
                  </> : <p className="dashboard-empty">No students are enrolled in this class yet.</p>}
                </section>
              </div>

              <div className="dashboard-secondary-column">
                <section className="dashboard-panel earnings-panel" id="earnings">
                  <div className="dashboard-panel-heading"><h2><FiBookOpen /> Earnings</h2><span className="sample-label">{dashboard.isSample ? 'Sample' : 'Overview'}</span></div>
                  <div className="earnings-total"><span>Total earned this month</span><strong>{formatMoney(dashboard.earnings.total, dashboard.earnings.currency)}</strong></div>
                  <div className="earnings-detail"><span>Pending commission</span><strong>{formatMoney(dashboard.earnings.pending, dashboard.earnings.currency)}</strong></div>
                  <div className="earnings-detail"><span>Next payout</span><strong>{dashboard.earnings.nextPayout || 'Not scheduled'}</strong></div>
                  <h3 className="dashboard-subheading">Recent payouts</h3>
                  {dashboard.earnings.payouts.length ? dashboard.earnings.payouts.map((payout) => <div className="payout-row" key={`${payout.date}-${payout.amount}`}><span><FiCheck /> {payout.date}</span><strong>{formatMoney(payout.amount, dashboard.earnings.currency)}</strong></div>) : <p className="dashboard-empty">No payouts recorded yet.</p>}
                </section>

                <section className="dashboard-panel roster-panel" id="roster">
                  <div className="dashboard-panel-heading"><h2><FiUsers /> Roster Summary</h2></div>
                  <div className="roster-metrics"><div><strong>{dashboard.roster.totalStudents}</strong><span>Total students</span></div><div><strong>{dashboard.roster.activeClasses}</strong><span>Active classes</span></div></div>
                  <div className="roster-course-list">{dashboard.classes.map((lesson) => <div className="roster-course" key={lesson.id}><span><i />{lesson.title}</span><small>{lesson.enrolled} enrolled</small></div>)}</div>
                </section>
              </div>
            </div>
          )}
        </div>
        <footer className="dashboard-footer" id="footer"><Link to="/">TeachOS</Link><span>Teacher workspace</span><span>Dashboard data is stored in MongoDB.</span></footer>
      </main>
    </div>
  )
}

function formatMoney(amount) {
  const formattedAmount = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)
  return `৳${formattedAmount}`
}

export default Dashboard
