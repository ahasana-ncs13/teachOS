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
  const [subscription, setSubscription] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [search, setSearch] = useState('')
  const [selectedClassId, setSelectedClassId] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [subscriptionError, setSubscriptionError] = useState('')
  const [subscriptionCheckoutBusy, setSubscriptionCheckoutBusy] = useState(false)
  const uid = user.uid

  const fetchDashboard = useCallback(async () => {
    const { data } = await api.get(`/dashboard/${encodeURIComponent(uid)}`)
    return data.dashboard
  }, [uid])

  const currentClass = useMemo(() => {
    if (!dashboard?.classes?.length) return null
    return dashboard.classes.find((item) => item.id === (selectedClassId || dashboard.attendanceClassId)) || dashboard.classes[0]
  }, [dashboard, selectedClassId])

  useEffect(() => {
    let isCurrent = true
    fetchDashboard().then((data) => {
      if (!isCurrent) return
      setDashboard(data)
    }).catch(() => {
      if (isCurrent) setError('We could not load your dashboard. Check that the TeachOS server and MongoDB are running.')
    }).finally(() => {
      if (isCurrent) setLoading(false)
    })
    return () => { isCurrent = false }
  }, [fetchDashboard])

  useEffect(() => {
    if (currentClass?.students) {
      setAttendance(currentClass.students.map(({ id, status }) => ({ studentId: id, status: status || '' })))
    } else {
      setAttendance([])
    }
  }, [currentClass])

  useEffect(() => {
    let isCurrent = true
    const sessionId = new URLSearchParams(window.location.search).get('subscription_session_id')
    const loadSubscription = sessionId
      ? api.get('/teacher/subscription/confirm', { params: { sessionId } }).then(({ data }) => (
        data.status === 'paid' ? { data: { subscription: data.subscription } } : api.get('/teacher/subscription')
      ))
      : api.get('/teacher/subscription')
    loadSubscription.then(({ data }) => {
      if (!isCurrent) return
      setSubscription(data.subscription)
      if (sessionId) window.history.replaceState({}, '', window.location.pathname)
    }).catch((requestError) => {
      if (isCurrent) setSubscriptionError(requestError.response?.data?.message || 'Subscription status could not be loaded.')
    })
    return () => { isCurrent = false }
  }, [])

  const paySubscriptionBalance = async () => {
    setSubscriptionCheckoutBusy(true)
    setSubscriptionError('')
    try {
      const { data } = await api.post('/teacher/subscription/checkout')
      window.location.assign(data.redirectUrl)
    } catch (requestError) {
      setSubscriptionError(requestError.response?.data?.message || 'Could not start Stripe checkout.')
      setSubscriptionCheckoutBusy(false)
    }
  }

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
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'
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
          <Link to="/dashboard/teaching-studio" onClick={() => setMenuOpen(false)}><FiBookOpen /> Classes &amp; lessons</Link>
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
            <div><p className="dashboard-eyebrow">Teacher workspace</p><h1>{greeting}, {teacherName}</h1><p>Here is your overview for today, {today}.</p></div>
            <a className="dashboard-secondary-button" href="#today-lessons"><FiCalendar /> Schedule</a>
          </div>

          {error && <div className="dashboard-error" role="alert">{error}<button type="button" onClick={retryLoad}>Try again</button></div>}
          {notice && <div className="dashboard-success" role="status">{notice}</div>}
          {subscriptionError && <div className="dashboard-error" role="alert">{subscriptionError}</div>}
          {subscription && <section className={`teacher-subscription-card ${subscription.status}`} aria-label="Teacher subscription status">
            <div>
              <span className="dashboard-eyebrow">Platform access</span>
              <h2>{subscription.status === 'trialing' ? 'One-month free trial' : subscription.status === 'suspended' ? 'Teacher workspace suspended' : subscription.amountDue ? 'Platform fee payment required' : 'Teacher workspace active'}</h2>
              <p>{subscription.status === 'trialing'
                ? `Full access through ${new Date(subscription.trialEndsAt).toLocaleDateString()}.`
                : 'After the trial, TeachOS uses the existing 5% share of confirmed income as the platform fee; this does not add another commission.'}</p>
              {subscription.warning && <strong role="alert">{subscription.warning}</strong>}
              {subscription.status === 'suspended' && <strong role="alert">Your account is suspended after {subscription.maxWarnings} unpaid warnings. Pay the outstanding balance to restore access.</strong>}
            </div>
            <div className="teacher-subscription-balance">
              <span>{subscription.status === 'trialing' ? 'Trial ends' : 'Outstanding balance'}</span>
              <strong>{subscription.status === 'trialing' ? new Date(subscription.trialEndsAt).toLocaleDateString() : formatMoney(subscription.amountDue, subscription.currency)}</strong>
              {subscription.amountDue > 0 && <button type="button" className="dashboard-primary-button" disabled={subscriptionCheckoutBusy} onClick={paySubscriptionBalance}>{subscriptionCheckoutBusy ? 'Opening checkout...' : 'Pay with Stripe'}</button>}
            </div>
          </section>}
          <section className="dashboard-studio-grid" aria-label="Teaching studio shortcuts">
            <Link className="dashboard-studio-card recorded" to="/dashboard/teaching-studio">
              <span className="dashboard-studio-icon"><FiBookOpen aria-hidden="true" /></span>
              <span><strong>Classes &amp; lessons</strong><small>Manage recorded lessons and live sessions in one place</small></span>
              <FiChevronRight aria-hidden="true" />
            </Link>
            <Link className="dashboard-studio-card listings" to="/dashboard/listings">
              <span className="dashboard-studio-icon"><FiBookOpen aria-hidden="true" /></span>
              <span><strong>Course listings</strong><small>Manage your published courses and batches</small></span>
              <FiChevronRight aria-hidden="true" />
            </Link>
          </section>
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
                          <div className="lesson-title-row">
                            {lesson.status === 'live' && <span className="live-badge"><i /> Live now</span>}
                            <h3>
                              {lesson.courseName && lesson.courseName !== lesson.title ? (
                                <>
                                  <span style={{ color: '#4338ca', fontWeight: 800 }}>{lesson.courseName}</span>
                                  <span style={{ color: '#94a3b8', margin: '0 6px' }}>—</span>
                                  <span>{lesson.title}</span>
                                </>
                              ) : (
                                lesson.title
                              )}
                            </h3>
                          </div>
                          <p><FiUsers /> {lesson.enrolled} {lesson.enrolled === 1 ? 'student' : 'students'} enrolled</p>
                        </div>
                        <span className="lesson-location">{lesson.location}</span>
                      </article>
                    )) : <p className="dashboard-empty">No classes match “{search}”.</p>}
                  </div>
                </section>

                <section className="dashboard-panel attendance-panel" id="attendance">
                  <div className="dashboard-panel-heading attendance-heading">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h2><FiCheck /> Quick Attendance</h2>
                      <p style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {currentClass?.courseName ? <strong>{currentClass.courseName} · </strong> : null}
                        {currentClass?.title || 'No class selected'} · Current session
                      </p>
                    </div>
                    {dashboard.classes.length > 1 && (
                      <select
                        value={currentClass?.id || ''}
                        onChange={(e) => setSelectedClassId(e.target.value)}
                        style={{
                          padding: '5px 9px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: '#fff',
                          color: '#1e293b',
                          cursor: 'pointer',
                          maxWidth: '180px',
                        }}
                        aria-label="Select course or class for attendance"
                      >
                        {dashboard.classes.map((cls) => (
                          <option key={cls.id} value={cls.id}>
                            {cls.courseName && cls.courseName !== cls.title ? `${cls.courseName} (${cls.title})` : cls.title}
                          </option>
                        ))}
                      </select>
                    )}
                    <a href="#roster">View roster <FiChevronRight /></a>
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
                  <div className="dashboard-panel-heading"><h2><FiBookOpen /> Earnings</h2><span className="dashboard-overview-label">Overview</span></div>
                  <div className="earnings-total"><span>Teacher earnings (95%)</span><strong>{formatMoney(dashboard.earnings.total, dashboard.earnings.currency)}</strong></div>
                  <div className="earnings-detail"><span>Total course sales</span><strong>{formatMoney(dashboard.earnings.gross, dashboard.earnings.currency)}</strong></div>
                  <div className="earnings-detail"><span>TeachOS commission (5%)</span><strong>{formatMoney(dashboard.earnings.commission, dashboard.earnings.currency)}</strong></div>
                  <div className="earnings-detail"><span>Refunded</span><strong>{formatMoney(dashboard.earnings.refunded, dashboard.earnings.currency)}</strong></div>
                  <div className="earnings-detail"><span>Pending payout requests</span><strong>{formatMoney(dashboard.earnings.pending, dashboard.earnings.currency)}</strong></div>
                  <div className="earnings-detail"><span>Next payout</span><strong>{dashboard.earnings.nextPayout || 'Not scheduled'}</strong></div>
                  <h3 className="dashboard-subheading">Recent verified course payments</h3>
                  {dashboard.earnings.recentTransactions?.length ? dashboard.earnings.recentTransactions.map((transaction) => <div className="payout-row" key={transaction.paymentId}><span>{transaction.courseName}</span><strong>{formatMoney(transaction.teacherRevenue, dashboard.earnings.currency)}</strong></div>) : <p className="dashboard-empty">No verified course payments yet.</p>}
                  <h3 className="dashboard-subheading">Recent payouts</h3>
                  {dashboard.earnings.payouts.length ? dashboard.earnings.payouts.map((payout) => <div className="payout-row" key={`${payout.date}-${payout.amount}`}><span><FiCheck /> {payout.date}</span><strong>{formatMoney(payout.amount, dashboard.earnings.currency)}</strong></div>) : <p className="dashboard-empty">No payouts recorded yet.</p>}
                </section>

                <section className="dashboard-panel roster-panel" id="roster">
                  <div className="dashboard-panel-heading"><h2><FiUsers /> Roster Summary</h2></div>
                  <div className="roster-metrics"><div><strong>{dashboard.roster.totalStudents}</strong><span>Total students</span></div><div><strong>{dashboard.roster.activeClasses}</strong><span>Active classes</span></div></div>
                  <div className="roster-course-list">{dashboard.classes.map((lesson) => <div className="roster-course" key={lesson.id}><span><i />{lesson.courseName && lesson.courseName !== lesson.title ? <strong style={{ color: '#4338ca', marginRight: '4px' }}>{lesson.courseName}:</strong> : null}{lesson.title}</span><small>{lesson.enrolled} enrolled</small></div>)}</div>
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
