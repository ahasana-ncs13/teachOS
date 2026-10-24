import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { FiArrowRight, FiBookOpen, FiCalendar, FiCheckCircle, FiClock, FiCreditCard, FiDownload, FiFileText, FiGrid, FiHelpCircle, FiLogOut, FiMenu, FiSearch, FiSend, FiShield, FiTag, FiUsers, FiX } from 'react-icons/fi'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import '../styles/student-portal.css'

const money = (amount) => `৳${Number(amount || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`
const emptyList = []
const personName = (user) => user?.fullName || user?.displayName || user?.email?.split('@')[0] || 'Student'
const initials = (name) => name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
const dateLabel = (value, options = { dateStyle: 'medium' }) => value ? new Intl.DateTimeFormat(undefined, options).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)) : 'No deadline'
const isPastDue = (assignment) => Boolean(assignment.dueDate && new Date(/^\d{4}-\d{2}-\d{2}$/.test(assignment.dueDate) ? `${assignment.dueDate}T23:59:59` : assignment.dueDate) < new Date())

function StudentLayout({ title, description, children }) {
  const { user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const name = personName(user)
  const links = [
    { to: '/student', label: 'Dashboard', icon: FiGrid, end: true },
    { to: '/student/classes', label: 'My Classes', icon: FiBookOpen },
    { to: '/student/assignments', label: 'Assignments', icon: FiFileText },
    { to: '/student/payments', label: 'Payments', icon: FiCreditCard },
  ]

  return <div className="student-portal">
    <header className="student-mobile-bar">
      <Link className="student-brand" to="/student"><span className="student-brand-mark">T</span>TeachOS</Link>
      <button type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <FiX /> : <FiMenu />}</button>
    </header>
    <aside className={`student-sidebar${menuOpen ? ' is-open' : ''}`}>
      <Link className="student-brand" to="/student"><span className="student-brand-mark">T</span>TeachOS</Link>
      <div className="student-side-profile"><span className="student-avatar">{initials(name)}</span><div><strong>{name}</strong><small>Student Portal</small></div></div>
      <nav className="student-navigation" aria-label="Student navigation">
        {links.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => isActive ? 'student-nav-link active' : 'student-nav-link'}><Icon />{label}</NavLink>)}
      </nav>
      <div className="student-sidebar-bottom">
        <Link className="student-nav-link" to="/#listings"><FiSearch /> Browse courses</Link>
        <a className="student-nav-link" href="mailto:support@teachos.example"><FiHelpCircle /> Help &amp; support</a>
        <button className="student-nav-link" type="button" onClick={signOut}><FiLogOut /> Sign out</button>
      </div>
    </aside>
    {menuOpen && <button className="student-mobile-backdrop" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <main className="student-main">
      <header className="student-topbar">
        <label className="student-global-search"><FiSearch /><input aria-label="Search TeachOS" placeholder="Learn something new..." onKeyDown={(event) => {
          if (event.key === 'Enter' && event.currentTarget.value.trim()) window.location.href = `/?search=${encodeURIComponent(event.currentTarget.value.trim())}#listings`
        }} /></label>
        <div className="student-topbar-user"><span>{dateLabel(new Date(), { weekday: 'long', month: 'short', day: 'numeric' })}</span><span className="student-avatar">{initials(name)}</span></div>
      </header>
      <div className="student-content">
        <header className="student-page-heading"><div><p>Student workspace</p><h1>{title}</h1><span>{description}</span></div></header>
        {children}
      </div>
      <footer className="student-footer"><Link to="/">TeachOS</Link><span>Learning starts here · Payments are displayed in Bangladeshi taka</span></footer>
    </main>
  </div>
}

function useStudentDashboard() {
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    let current = true
    api.get('/student/dashboard').then(({ data }) => {
      if (current) setDashboard(data.dashboard)
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load your student dashboard.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [refreshKey])
  return { dashboard, loading, error, refresh: () => setRefreshKey((value) => value + 1) }
}

function StudentStatus({ error, notice, onRetry }) {
  return <>{error && <div className="student-alert error" role="alert"><span>{error}</span>{onRetry && <button type="button" onClick={onRetry}>Try again</button>}</div>}{notice && <div className="student-alert success" role="status">{notice}</div>}</>
}

export function StudentDashboard() {
  const { user } = useAuth()
  const { dashboard, loading, error, refresh } = useStudentDashboard()
  const [listings, setListings] = useState([])
  const [notice, setNotice] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [actionError, setActionError] = useState('')
  const [enrolling, setEnrolling] = useState('')
  const [demoPaymentListing, setDemoPaymentListing] = useState(null)
  useEffect(() => {
    let current = true
    api.get('/listings/latest', { params: { count: 4 } }).then(({ data }) => {
      if (current) setListings(data.listings || [])
    }).catch((requestError) => {
      if (current) setCatalogError(requestError.response?.data?.message || 'Course recommendations could not be loaded.')
    })
    return () => { current = false }
  }, [])
  const enrollments = dashboard?.enrollments || []
  const assignments = dashboard?.assignments ?? emptyList
  const enrolledIds = new Set(enrollments.map((item) => String(item.listingId)))
  const upcomingAssignments = assignments
    .filter((item) => !item.submission && !isPastDue(item))
    .sort((first, second) => new Date(first.dueDate || '9999-12-31') - new Date(second.dueDate || '9999-12-31'))
    .slice(0, 3)
  const name = personName(user)

  const enroll = async (listing) => {
    if (Number(listing.fee) > 0) {
      setActionError('')
      setDemoPaymentListing(listing)
      return
    }
    setEnrolling(String(listing._id))
    setNotice('')
    setActionError('')
    try {
      const { data } = await api.post(`/student/enrollments/${encodeURIComponent(listing._id)}`)
      setNotice(data.alreadyEnrolled ? 'You are already enrolled in this course.' : `You are enrolled in ${listing.name}.`)
      refresh()
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Could not enroll in this course.')
    } finally {
      setEnrolling('')
    }
  }

  const confirmDemoPayment = async () => {
    if (!demoPaymentListing) return
    setEnrolling(String(demoPaymentListing._id))
    setActionError('')
    try {
      const { data } = await api.post('/student/payments/checkout', { listingId: demoPaymentListing._id })
      setNotice(data.alreadyPaid
        ? `${demoPaymentListing.name} was already paid in the demo.`
        : `Demo payment of ${money(data.payment.amount)} recorded for ${demoPaymentListing.name}.`)
      setDemoPaymentListing(null)
      refresh()
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Could not record the BDT demo payment.')
    } finally {
      setEnrolling('')
    }
  }

  return <StudentLayout title={`Welcome back, ${name}`} description="Here is what is happening with your learning today.">
    <StudentStatus error={error || catalogError || actionError} notice={notice} onRetry={refresh} />
    {loading ? <div className="student-state" role="status">Loading your learning dashboard...</div> : <>
      <section className="student-stat-grid" aria-label="Learning overview">
        <article><span className="student-stat-icon purple"><FiBookOpen /></span><div><small>My classes</small><strong>{dashboard?.stats.enrolledCourses || 0}</strong><span>Active enrollments</span></div></article>
        <article><span className="student-stat-icon mint"><FiFileText /></span><div><small>To do</small><strong>{dashboard?.stats.pendingAssignments || 0}</strong><span>Assignments to submit</span></div></article>
        <article><span className="student-stat-icon blue"><FiCheckCircle /></span><div><small>Submitted</small><strong>{dashboard?.stats.submittedAssignments || 0}</strong><span>Work turned in</span></div></article>
        <article><span className="student-stat-icon peach"><FiShield /></span><div><small>Course fees</small><strong>{money(enrollments.reduce((sum, item) => sum + (Number(item.fee) || 0), 0))}</strong><span>Fees for enrolled courses</span></div></article>
      </section>
      <div className="student-dashboard-columns">
        <section className="student-panel">
          <div className="student-panel-heading"><div><span className="student-eyebrow">Your learning</span><h2>My Classes</h2></div><Link to="/student/classes">View all <FiArrowRight /></Link></div>
          {enrollments.length ? <div className="student-course-list">{enrollments.slice(0, 3).map((enrollment) => <CourseRow key={enrollment._id} enrollment={enrollment} />)}</div> : <EmptyState icon={FiBookOpen} title="Your class list is empty" copy="Browse published courses and enroll to start building your learning plan." link="/student/classes" label="Find a class" />}
        </section>
        <section className="student-panel student-assignment-summary">
          <div className="student-panel-heading"><div><span className="student-eyebrow">Stay on track</span><h2>Upcoming assignments</h2></div><Link to="/student/assignments">View all <FiArrowRight /></Link></div>
          {upcomingAssignments.length ? <div className="student-assignment-list">{upcomingAssignments.map((assignment) => <AssignmentRow key={assignment._id} assignment={assignment} />)}</div> : <div className="student-empty-inline"><FiCalendar /><strong>No tasks due</strong><span>New assignments from your teachers will show up here.</span></div>}
        </section>
      </div>
      <section className="student-panel student-recommendations">
        <div className="student-panel-heading"><div><span className="student-eyebrow">Keep exploring</span><h2>Courses you can join</h2></div><Link to="/student/classes">Browse all <FiArrowRight /></Link></div>
        {listings.length ? <div className="student-discovery-grid">{listings.map((listing) => <article className="student-discovery-card" key={listing._id}>
          {listing.image && <img src={listing.image} alt="" loading="lazy" />}
          <div><span className="student-category">{listing.category}</span><h3>{listing.name}</h3><p>{listing.teacherName || 'TeachOS teacher'} · {listing.duration}</p><div className="student-discovery-foot"><strong>{listing.fee ? money(listing.fee) : 'Free'}</strong><button type="button" disabled={enrolledIds.has(String(listing._id)) || enrolling === String(listing._id)} onClick={() => enroll(listing)}>{enrolledIds.has(String(listing._id)) ? 'Enrolled' : enrolling === String(listing._id) ? 'Starting...' : Number(listing.fee) > 0 ? 'Pay & enroll' : 'Enroll'}</button></div></div>
        </article>)}</div> : <div className="student-empty-inline"><FiSearch /><strong>No published courses yet</strong><span>Check back soon for newly published classes.</span></div>}
      </section>
    </>}
    {demoPaymentListing && <DemoPaymentDialog listing={demoPaymentListing} busy={Boolean(enrolling)} onCancel={() => setDemoPaymentListing(null)} onConfirm={confirmDemoPayment} />}
  </StudentLayout>
}

export function StudentClasses() {
  const { dashboard, loading, error, refresh } = useStudentDashboard()
  const [listings, setListings] = useState([])
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('enrolled')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [actionError, setActionError] = useState('')
  const [demoPaymentListing, setDemoPaymentListing] = useState(null)
  useEffect(() => {
    let current = true
    api.get('/listings', { params: { page: 1, limit: 100 } }).then(({ data }) => {
      if (current) setListings(data.listings || [])
    }).catch((requestError) => {
      if (current) setCatalogError(requestError.response?.data?.message || 'Course catalog could not be loaded.')
    })
    return () => { current = false }
  }, [])
  const enrollments = dashboard?.enrollments || []
  const enrolledIds = new Set(enrollments.map((item) => String(item.listingId)))
  const items = mode === 'enrolled'
    ? enrollments.map((item) => ({ ...item.listing, _enrollment: item }))
    : listings.filter((item) => !enrolledIds.has(String(item._id)))
  const filtered = items.filter((item) => `${item.name} ${item.category} ${item.teacherName} ${item.location}`.toLowerCase().includes(query.trim().toLowerCase()))

  const enroll = async (listing) => {
    if (Number(listing.fee) > 0) {
      setActionError('')
      setDemoPaymentListing(listing)
      return
    }
    setBusy(String(listing._id))
    setNotice('')
    setActionError('')
    try {
      await api.post(`/student/enrollments/${encodeURIComponent(listing._id)}`)
      setNotice(`You are enrolled in ${listing.name}.`)
      refresh()
      setMode('enrolled')
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Could not enroll in this course.')
    } finally {
      setBusy('')
    }
  }

  const confirmDemoPayment = async () => {
    if (!demoPaymentListing) return
    setBusy(String(demoPaymentListing._id))
    setActionError('')
    try {
      const { data } = await api.post('/student/payments/checkout', { listingId: demoPaymentListing._id })
      setNotice(data.alreadyPaid
        ? `${demoPaymentListing.name} was already paid in the demo.`
        : `Demo payment of ${money(data.payment.amount)} recorded for ${demoPaymentListing.name}.`)
      setDemoPaymentListing(null)
      refresh()
      setMode('enrolled')
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Could not record the BDT demo payment.')
    } finally {
      setBusy('')
    }
  }

  return <StudentLayout title="My Classes" description="Keep your enrolled courses and discover new learning opportunities.">
    <StudentStatus error={error || catalogError || actionError} notice={notice} onRetry={refresh} />
    <div className="student-toolbar"><div className="student-tabs" role="tablist" aria-label="Classes view">
      <button type="button" role="tab" aria-selected={mode === 'enrolled'} onClick={() => setMode('enrolled')}>Enrolled ({enrollments.length})</button>
      <button type="button" role="tab" aria-selected={mode === 'discover'} onClick={() => setMode('discover')}>Discover courses</button>
    </div><label className="student-search"><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search classes" placeholder="Search courses..." /></label></div>
    {loading ? <div className="student-state" role="status">Loading classes...</div> : filtered.length ? <div className="student-class-grid">{filtered.map((listing) => {
      const enrollment = listing._enrollment
      return <article className="student-class-card" key={listing._id}>
        {listing.image && <img className="student-class-cover" src={listing.image} alt="" loading="lazy" />}
        <div className="student-class-card-body"><span className="student-category">{listing.category}</span><h2>{listing.name}</h2><p className="student-teacher-name"><FiUsers /> {listing.teacherName || 'TeachOS teacher'}</p>
          <div className="student-class-details"><span><FiClock /> {listing.duration}</span><span><FiTag /> {listing.location}</span><span><FiCalendar /> Starts {dateLabel(listing.startDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
          <div className="student-card-footer">{enrollment ? <><span className="student-enrolled-badge"><FiCheckCircle /> Enrolled {dateLabel(enrollment.enrolledAt, { month: 'short', day: 'numeric' })}</span><strong>{listing.fee ? money(listing.fee) : 'Free'}</strong></> : <><strong>{listing.fee ? money(listing.fee) : 'Free'}</strong><button type="button" disabled={busy === String(listing._id)} onClick={() => enroll(listing)}>{busy === String(listing._id) ? 'Starting...' : Number(listing.fee) > 0 ? 'Pay & enroll' : 'Enroll now'} <FiArrowRight /></button></>}</div>
        </div>
      </article>
    })}</div> : <EmptyState icon={mode === 'enrolled' ? FiBookOpen : FiSearch} title={mode === 'enrolled' ? 'No enrolled classes yet' : 'No matching courses'} copy={mode === 'enrolled' ? 'Browse the catalog and enroll in a course to see it here.' : 'Try a different search or check back for new courses.'} link={mode === 'enrolled' ? undefined : '/student/classes'} label={mode === 'enrolled' ? undefined : 'Clear search'} onClick={mode === 'discover' ? () => setQuery('') : undefined} />}
    {demoPaymentListing && <DemoPaymentDialog listing={demoPaymentListing} busy={Boolean(busy)} onCancel={() => setDemoPaymentListing(null)} onConfirm={confirmDemoPayment} />}
  </StudentLayout>
}

export function StudentAssignments() {
  const { dashboard, loading, error, refresh } = useStudentDashboard()
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const assignments = dashboard?.assignments ?? emptyList
  const filtered = useMemo(() => assignments.filter((assignment) => filter === 'all' || (filter === 'submitted' ? Boolean(assignment.submission) : !assignment.submission)), [assignments, filter])

  const submit = async (event) => {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setNotice('')
    setActionError('')
    try {
      await api.post(`/student/assignments/${encodeURIComponent(selected._id)}/submissions`, { content })
      setSelected(null)
      setContent('')
      setNotice('Your assignment has been submitted.')
      refresh()
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Could not submit your assignment.')
    } finally {
      setBusy(false)
    }
  }

  return <StudentLayout title="Assignments" description="Review your coursework, deadlines, and submissions.">
    <StudentStatus error={error || actionError} notice={notice} onRetry={refresh} />
    <div className="student-assignment-overview"><div><span className="student-eyebrow">Your workload</span><h2>{assignments.filter((item) => !item.submission).length} assignment{assignments.filter((item) => !item.submission).length === 1 ? '' : 's'} to do</h2><p>Assignments are shared by teachers for courses you are enrolled in.</p></div><div className="student-assignment-progress"><FiCheckCircle /><span>{assignments.filter((item) => item.submission).length} submitted of {assignments.length}</span></div></div>
    <div className="student-toolbar"><div className="student-tabs" role="tablist" aria-label="Filter assignments">
      {[['all', 'All'], ['todo', 'To do'], ['submitted', 'Submitted']].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
    </div></div>
    {loading ? <div className="student-state" role="status">Loading assignments...</div> : filtered.length ? <div className="student-assignment-page-grid"><div className="student-assignment-list">{filtered.map((assignment) => <article className={`student-assignment-card${assignment.submission ? ' is-submitted' : ''}`} key={assignment._id}>
      <span className="student-assignment-marker">{assignment.submission ? <FiCheckCircle /> : <FiFileText />}</span>
      <div className="student-assignment-main"><h2>{assignment.title}</h2><p>{assignment.listingName}</p><div className="student-assignment-meta"><span><FiCalendar /> Due {dateLabel(assignment.dueDate)}</span><span>{assignment.submission ? `Submitted ${dateLabel(assignment.submission.submittedAt)}` : 'To do'}</span></div>{assignment.description && <p className="student-assignment-description">{assignment.description}</p>}</div>
      {assignment.submission ? <button className="student-outline-button" type="button" onClick={() => { setSelected(assignment); setContent(assignment.submission.content || '') }}>{isPastDue(assignment) ? 'View submission' : 'View / edit submission'}</button> : isPastDue(assignment) ? <span className="student-overdue-badge">Deadline passed</span> : <button className="student-primary-button" type="button" onClick={() => { setSelected(assignment); setContent('') }}><FiSend /> Submit work</button>}
    </article>)}</div><aside className="student-week-card"><span className="student-eyebrow">Progress</span><h2>This term</h2><strong>{assignments.length ? Math.round((assignments.filter((item) => item.submission).length / assignments.length) * 100) : 0}%</strong><div className="student-progress-track"><span style={{ width: `${assignments.length ? Math.round((assignments.filter((item) => item.submission).length / assignments.length) * 100) : 0}%` }} /></div><p>{assignments.filter((item) => item.submission).length} of {assignments.length} assignments submitted</p><Link to="/student/classes">Go to my classes <FiArrowRight /></Link></aside></div> : <EmptyState icon={FiFileText} title={filter === 'submitted' ? 'No submissions yet' : 'No assignments yet'} copy={filter === 'submitted' ? 'Your submitted work will be listed here.' : 'When teachers publish work for your enrolled classes, it will appear here.'} />}
    {selected && <div className="student-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setSelected(null) }}><section className="student-modal" role="dialog" aria-modal="true" aria-labelledby="student-submit-title">
      <button className="student-modal-close" type="button" aria-label="Close" disabled={busy} onClick={() => setSelected(null)}><FiX /></button><span className="student-eyebrow">{selected.listingName}</span><h2 id="student-submit-title">{selected.title}</h2><p>{selected.description || 'Write your response below. You can update your submission before the deadline.'}</p><p className="student-deadline"><FiCalendar /> Due {dateLabel(selected.dueDate)}</p>
      <form onSubmit={submit}><label htmlFor="student-assignment-content">Your work</label><textarea id="student-assignment-content" value={content} onChange={(event) => setContent(event.target.value)} maxLength={5000} required rows={8} readOnly={isPastDue(selected)} placeholder="Write your assignment response..." /><small>{content.length}/5,000 characters</small>{isPastDue(selected) && <p className="student-modal-closed-note">The deadline has passed. Submissions can no longer be changed.</p>}<div className="student-modal-actions">{!isPastDue(selected) && <button className="student-primary-button" disabled={busy || !content.trim()}>{busy ? 'Submitting...' : 'Submit assignment'} <FiSend /></button>}<button className="student-outline-button" type="button" disabled={busy} onClick={() => setSelected(null)}>{isPastDue(selected) ? 'Close' : 'Cancel'}</button></div></form>
    </section></div>}
  </StudentLayout>
}

export function StudentPayments() {
  const [billing, setBilling] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    api.get('/student/payments').then(({ data }) => {
      if (current) setBilling(data)
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load your billing records.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [])
  const fees = billing?.courseFees || []
  const payments = billing?.payments || []
  const amountInCourseFees = fees.reduce((total, item) => total + (Number(item.fee) || 0), 0)

  const downloadStatement = () => {
    const rows = [
      ['Date', 'Course / record', 'Teacher', 'Amount (BDT)', 'Status'],
      ...fees.map((item) => [dateLabel(item.enrolledAt), item.name, item.teacherName, Number(item.fee || 0).toFixed(2), 'Course fee']),
      ...payments.map((item) => [dateLabel(item.createdAt), item.courseName || item.description || 'Payment', item.mode === 'demo' ? 'Local BDT demo' : item.reference || '', Number(item.amount || 0).toFixed(2), item.mode === 'demo' ? 'Demo paid' : item.status || 'Recorded']),
    ]
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'teachos-student-statement.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return <StudentLayout title="Payments & billing" description="Review course fees and payment records associated with your account.">
    <StudentStatus error={error} />
    {loading ? <div className="student-state" role="status">Loading your billing records...</div> : <>
      <section className="student-billing-summary"><article><span>Enrolled course fees</span><strong>{money(amountInCourseFees)}</strong><small>Fees listed by your teachers at enrollment</small></article><article><span>Payments recorded</span><strong>{money(billing?.paidTotal)}</strong><small>Payments explicitly recorded to your account</small></article><article><span>Billing currency</span><strong>BDT</strong><small>Bangladeshi taka</small></article></section>
      <div className="student-billing-note"><FiShield /><p><strong>Local BDT demo only:</strong> payments are simulated in taka for demonstration. No money is collected, no Stripe transaction occurs, and no funds are transferred to teachers. Demo payments unlock course enrollment only in this application.</p></div>
      <section className="student-panel student-fee-panel"><div className="student-panel-heading"><div><span className="student-eyebrow">Enrollment records</span><h2>Course fees</h2></div></div>
        {fees.length ? <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Course</th><th>Teacher</th><th>Enrolled</th><th>Fee (BDT)</th></tr></thead><tbody>{fees.map((item) => <tr key={String(item.listingId)}><td><strong>{item.name}</strong></td><td>{item.teacherName || 'TeachOS teacher'}</td><td>{dateLabel(item.enrolledAt)}</td><td>{item.fee ? money(item.fee) : 'Free'}</td></tr>)}</tbody></table></div> : <div className="student-empty-inline"><FiCreditCard /><strong>No course fees yet</strong><span>Enroll in a course to see its listed fee here.</span><Link to="/student/classes">Browse courses <FiArrowRight /></Link></div>}
      </section>
      <section className="student-panel student-fee-panel"><div className="student-panel-heading"><div><span className="student-eyebrow">Account activity</span><h2>Payment history</h2></div><button className="student-outline-button" type="button" onClick={downloadStatement}><FiDownload /> Download statement</button></div>
        {payments.length ? <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Date</th><th>Course</th><th>Payment type</th><th>Amount (BDT)</th><th>Status</th></tr></thead><tbody>{payments.map((item) => <tr key={item._id}><td>{dateLabel(item.createdAt)}</td><td>{item.courseName || item.description || 'Student payment'}</td><td>{item.mode === 'demo' ? 'Local demo' : item.reference || '—'}</td><td>{money(item.amount)}</td><td><span className={`student-payment-status ${item.status || 'recorded'}`}>{item.mode === 'demo' ? 'Demo paid' : item.status || 'recorded'}</span></td></tr>)}</tbody></table></div> : <div className="student-empty-inline"><FiCreditCard /><strong>No payment records</strong><span>When a payment is recorded for your account, it will appear here.</span></div>}
      </section>
    </>}
  </StudentLayout>
}

function DemoPaymentDialog({ listing, busy, onCancel, onConfirm }) {
  return <div className="student-modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onCancel()
  }}>
    <section className="student-modal" role="dialog" aria-modal="true" aria-labelledby="student-demo-payment-title">
      <button className="student-modal-close" type="button" aria-label="Close" disabled={busy} onClick={onCancel}><FiX /></button>
      <span className="student-eyebrow">Demo payment · BDT</span>
      <h2 id="student-demo-payment-title">Confirm course payment</h2>
      <p>{listing.name}</p>
      <div className="student-demo-payment-amount"><span>Demo amount</span><strong>{money(listing.fee)}</strong></div>
      <div className="student-billing-note"><FiShield /><p>This is a local demo only. No money will be charged and no payment provider is involved.</p></div>
      <div className="student-modal-actions">
        <button className="student-primary-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Recording demo...' : `Simulate payment · ${money(listing.fee)}`} <FiCreditCard /></button>
        <button className="student-outline-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  </div>
}

function CourseRow({ enrollment }) {
  const listing = enrollment.listing || {}
  return <article className="student-course-row"><div className="student-course-icon"><FiBookOpen /></div><div className="student-course-info"><h3>{listing.name || enrollment.name}</h3><p>{listing.category || enrollment.category} · {listing.teacherName || enrollment.teacherName}</p></div><span className="student-course-location">{listing.location || enrollment.location}</span><Link to="/student/classes" aria-label={`Open ${listing.name || enrollment.name}`}><FiArrowRight /></Link></article>
}

function AssignmentRow({ assignment }) {
  return <article className="student-assignment-row"><span><FiFileText /></span><div><strong>{assignment.title}</strong><small>{assignment.listingName}</small></div><time>{dateLabel(assignment.dueDate, { month: 'short', day: 'numeric' })}</time></article>
}

function EmptyState({ icon: Icon, title, copy, link, label, onClick }) {
  return <div className="student-empty-state"><span><Icon /></span><h2>{title}</h2><p>{copy}</p>{link && <Link to={link} onClick={onClick}>{label || 'Explore TeachOS'} <FiArrowRight /></Link>}{!link && onClick && <button type="button" onClick={onClick}>{label} <FiArrowRight /></button>}</div>
}
