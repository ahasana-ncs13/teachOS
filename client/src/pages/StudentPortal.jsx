import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { FiArrowRight, FiBell, FiBookOpen, FiCalendar, FiCheckCircle, FiClock, FiCreditCard, FiDownload, FiExternalLink, FiFileText, FiGrid, FiHelpCircle, FiLogOut, FiMenu, FiPlay, FiSearch, FiSend, FiShield, FiTag, FiUsers, FiX } from 'react-icons/fi'
import { useAuth } from '../context/useAuth'
import NotificationCenter from '../components/NotificationCenter'
import { api } from '../lib/api'
import StripePaymentFlow from '../components/StripePaymentFlow'
import '../styles/student-portal.css'

const money = (amount) => `৳${Number(amount || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`
const emptyList = []
const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const personName = (user) => user?.fullName || user?.displayName || user?.email?.split('@')[0] || 'Student'
const initials = (name) => name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
const dateLabel = (value, options = { dateStyle: 'medium' }) => value ? new Intl.DateTimeFormat(undefined, options).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)) : 'No deadline'
const isPastDue = (assignment) => Boolean(assignment.dueDate && new Date(/^\d{4}-\d{2}-\d{2}$/.test(assignment.dueDate) ? `${assignment.dueDate}T23:59:59` : assignment.dueDate) < new Date())
const paymentMessages = {
  cancelled: 'Stripe Checkout was cancelled. No payment was recorded.',
}
function StudentLayout({ title, description, children }) {
  const { user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const name = personName(user)
  const links = [
    { to: '/student', label: 'Dashboard', icon: FiGrid, end: true },
    { to: '/student/classes', label: 'My Classes', icon: FiBookOpen },
    { to: '/student/attendance', label: 'Attendance', icon: FiCheckCircle },
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
        <div className="student-topbar-user"><span>{dateLabel(new Date(), { weekday: 'long', month: 'short', day: 'numeric' })}</span><NotificationCenter /><span className="student-avatar">{initials(name)}</span></div>
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
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])
  return { dashboard, loading, error, refresh }
}

function StudentStatus({ error, notice, onRetry }) {
  return <>{error && <div className="student-alert error" role="alert"><span>{error}</span>{onRetry && <button type="button" onClick={onRetry}>Try again</button>}</div>}{notice && <div className="student-alert success" role="status">{notice}</div>}</>
}

function DiscoveryCard({ listing, isEnrolled, enrolling, onEnroll }) {
  const isOneTime = listing.pricingType === 'ONE_TIME' || (!listing.monthlyTuitionFee && Number(listing.fee) > 0 && listing.pricingType !== 'MONTHLY_SUBSCRIPTION')
  const admission = Number(listing.admissionFee || 0)
  const tuition = Number(listing.monthlyTuitionFee ?? listing.fee) || 0
  const initialTotal = isOneTime ? (admission || Number(listing.fee) || 0) : admission + tuition
  const buttonLabel = isEnrolled ? 'Enrolled' : (enrolling === String(listing._id) ? 'Starting...' : (initialTotal > 0 ? 'Pay & enroll' : 'Enroll'))
  return <article className="student-discovery-card">
    {listing.image && <img src={listing.image} alt="" loading="lazy" />}
    <div><span className="student-category">{listing.category}</span><h3>{listing.name}</h3><p>{listing.teacherName || 'TeachOS teacher'} · {listing.duration}</p><div className="student-discovery-foot">
      {isOneTime ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong>{money(initialTotal)}</strong>
          <small style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '1px 5px', borderRadius: '4px', fontSize: '9px', fontWeight: 700 }}>Lifetime Access</span>
            one-time payment
          </small>
        </div>
      ) : initialTotal > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <strong>{money(initialTotal)}</strong>
          <small>to join · then {money(tuition)}/month</small>
        </div>
      ) : <strong>Free</strong>}
      <button type="button" disabled={isEnrolled || enrolling === String(listing._id)} onClick={() => onEnroll(listing)} style={{ flex: 1 }}>{buttonLabel}</button></div></div>
  </article>
}

export function StudentDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { dashboard, loading, error, refresh } = useStudentDashboard()
  const [listings, setListings] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [announcementsError, setAnnouncementsError] = useState('')
  const [showAllAnnouncements, setShowAllAnnouncements] = useState(false)
  const [notice, setNotice] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [actionError, setActionError] = useState('')
  const [enrolling, setEnrolling] = useState('')
  const [stripeListing, setStripeListing] = useState(null)
  const [stripePaymentType, setStripePaymentType] = useState('initial')
  const [cancellingSubscription, setCancellingSubscription] = useState('')
  useEffect(() => {
    let current = true
    api.get('/listings/latest', { params: { count: 4 } }).then(({ data }) => {
      if (current) setListings(data.listings || [])
    }).catch((requestError) => {
      if (current) setCatalogError(requestError.response?.data?.message || 'Course recommendations could not be loaded.')
    })
    api.get('/notifications').then(({ data }) => {
      if (current) setAnnouncements(data.notifications || [])
    }).catch((requestError) => {
      if (current) setAnnouncementsError(requestError.response?.data?.message || 'Announcements could not be loaded.')
    })
    api.get('/student/subscriptions').then(({ data }) => {
      if (current) setSubscriptions(data.subscriptions || [])
    }).catch((requestError) => {
      if (current) setActionError(requestError.response?.data?.message || 'Monthly tuition details could not be loaded.')
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
  const learningProgress = dashboard?.learningProgress ?? emptyList
  const progressByListing = new Map(learningProgress.map((item) => [String(item.listingId), item]))
  const featuredEnrollment = enrollments[0]
  const featuredCourse = featuredEnrollment?.listing
  const featuredProgress = featuredEnrollment ? progressByListing.get(String(featuredEnrollment.listingId)) : null
  const supportByDay = new Map((dashboard?.supportSessions ?? emptyList).reduce((days, session) => {
    const weekday = new Date(`${session.date}T12:00:00`).getDay()
    const sessions = days.get(weekday) || []
    sessions.push(session)
    days.set(weekday, sessions)
    return days
  }, new Map()))
  const todayWeekday = new Date().getDay()

  const openAnnouncement = async (announcement) => {
    if (!announcement.readAt) {
      try {
        await api.patch(`/notifications/${encodeURIComponent(announcement._id)}/read`)
        setAnnouncements((items) => items.map((item) => item._id === announcement._id ? { ...item, readAt: new Date().toISOString() } : item))
      } catch (requestError) {
        setAnnouncementsError(requestError.response?.data?.message || 'This announcement could not be opened.')
        return
      }
    }
    if (typeof announcement.href === 'string' && announcement.href.startsWith('/')) navigate(announcement.href)
  }

  const enroll = async (listing) => {
    const initialTotal = Number(listing.admissionFee || 0) + Number((listing.monthlyTuitionFee ?? listing.fee) || 0)
    if (initialTotal > 0) {
      setActionError('')
      setStripePaymentType('initial')
      setStripeListing(listing)
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

  const startMonthlyPayment = (subscription) => {
    setStripePaymentType('monthly')
    setStripeListing({
      _id: subscription.listingId,
      name: subscription.courseName,
      monthlyTuitionFee: subscription.amount,
      fee: subscription.amount,
      admissionFee: 0,
    })
  }

  const cancelMonthlyTuition = async (subscription) => {
    setCancellingSubscription(subscription.listingId)
    setActionError('')
    try {
      await api.post(`/student/courses/${encodeURIComponent(subscription.listingId)}/cancel`)
      setSubscriptions((items) => items.map((item) =>
        item.listingId === subscription.listingId ? { ...item, status: 'cancelled', renewalCancelled: true } : item,
      ))
      setNotice(`Renewal cancelled for ${subscription.courseName}. Access continues until the current paid period ends.`)
    } catch (requestError) {
      setActionError(requestError.response?.data?.message || 'Could not cancel monthly tuition.')
    } finally {
      setCancellingSubscription('')
    }
  }

  return <StudentLayout title={`Welcome back, ${name}`} description="Continue your courses and stay up to date with your teachers.">
    <StudentStatus error={error || catalogError || actionError || announcementsError} notice={notice} onRetry={refresh} />
    {loading ? <div className="student-state" role="status">Loading your learning dashboard...</div> : <>
      <div className="student-learning-dashboard">
        <div className="student-learning-main">
          <section className="student-featured-course" aria-label="Continue your course">
            {featuredCourse ? <>
              <Link className="student-featured-image" to={`/student/course/${encodeURIComponent(featuredEnrollment.listingId)}/learn`} aria-label={`Continue ${featuredCourse.name}`}>
                {featuredCourse.image ? <img src={featuredCourse.image} alt="" /> : <FiBookOpen />}
              </Link>
              <div className="student-featured-copy">
                <span className="student-featured-batch">{featuredCourse.courseName || featuredCourse.category || 'Enrolled course'}</span>
                <h2>{featuredCourse.name}</h2>
                <div className="student-course-progress-label"><span>Progress</span><div className="student-course-progress"><span style={{ width: `${featuredProgress?.progressPercent || 0}%` }} /></div><strong>{featuredProgress?.progressPercent || 0}%</strong></div>
                <p className="student-current-lesson">{featuredProgress?.currentLesson ? <><FiPlay /> {featuredProgress.currentLesson.title}</> : 'Course lessons are not available yet.'}</p>
                <div className="student-featured-actions"><Link className="student-primary-button" to={`/student/course/${encodeURIComponent(featuredEnrollment.listingId)}/learn`}>Continue Course</Link><Link className="student-outline-button" to={`/student/course/${encodeURIComponent(featuredEnrollment.listingId)}/learn?outline=1`}>Course Outline</Link></div>
              </div>
            </> : <div className="student-featured-empty"><FiBookOpen /><div><h2>Start learning online</h2><p>Enroll in a course to see your progress and continue lessons here.</p><Link to="/student/classes">Browse courses <FiArrowRight /></Link></div></div>}
          </section>
          <section className="student-all-courses" aria-labelledby="student-all-courses-title">
            <header><div><h2 id="student-all-courses-title">All Courses</h2><p>Your enrolled courses and learning progress.</p></div><Link to="/student/classes">Manage classes <FiArrowRight /></Link></header>
            {enrollments.length ? <div className="student-learning-course-grid">{enrollments.map((enrollment) => {
              const course = enrollment.listing
              const progress = progressByListing.get(String(enrollment.listingId))
              const learningUrl = `/student/course/${encodeURIComponent(enrollment.listingId)}/learn`
              return <article className="student-learning-course-card" key={enrollment._id}>
                <Link className="student-learning-course-cover" to={learningUrl}>
                  {course?.image ? <img src={course.image} alt="" loading="lazy" /> : <FiBookOpen />}
                  <span>{course?.category || 'Online course'}</span>
                </Link>
                <div className="student-learning-course-body"><h3>{course?.courseName || course?.name || enrollment.name}</h3>
                  {course?.courseName && course.courseName !== course.name && <p>{course.name}</p>}
                  <div className="student-course-card-progress"><span><i style={{ width: `${progress?.progressPercent || 0}%` }} /></span><strong>{progress?.progressPercent || 0}%</strong></div>
                  <Link className="student-learning-continue" to={learningUrl}>Continue Course <FiArrowRight /></Link>
                </div>
              </article>
            })}</div> : <div className="student-empty-inline"><FiBookOpen /><strong>No enrolled courses yet</strong><span>Enroll in a published course to see it here.</span><Link to="/student/classes">Browse courses <FiArrowRight /></Link></div>}
          </section>
        </div>
        <aside className="student-learning-aside">
          <section className="student-announcements" aria-labelledby="student-announcements-title">
            <header><h2 id="student-announcements-title">Announcements</h2></header>
            {announcementsError ? <div className="student-announcement-empty" role="alert"><FiBell /><strong>Announcements unavailable</strong><span>{announcementsError}</span></div> : announcements.length ? <>
              <div className="student-announcement-list">{(showAllAnnouncements ? announcements : announcements.slice(0, 1)).map((announcement) => <article className="student-announcement" key={announcement._id}>
                <div className="student-announcement-top"><span className="student-announcement-icon"><FiBell /></span><div><small>{dateLabel(announcement.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small><h3>{announcement.title}</h3></div></div>
                <p>{announcement.message}</p><button type="button" onClick={() => openAnnouncement(announcement)}>View Details <FiArrowRight /></button>
              </article>)}</div>
              <button className="student-announcements-all" type="button" onClick={() => setShowAllAnnouncements((value) => !value)}>{showAllAnnouncements ? 'Show Latest' : 'See All Announcements'}</button>
            </> : <div className="student-announcement-empty"><FiBell /><strong>No announcements yet</strong><span>Course and teacher updates will appear here.</span></div>}
          </section>
          <section className="student-support-schedule" aria-labelledby="student-support-title">
            <header><h2 id="student-support-title">Support Sessions</h2><p>Availability shared by your course teachers.</p></header>
            <div className="student-support-days">{weekDays.map((day, index) => {
              const sessions = supportByDay.get(index) || []
              return <article className={index === todayWeekday ? 'today' : ''} key={day}>
                <strong>{day.slice(0, 3)}</strong>
                {sessions.length ? <div>{sessions.map((session) => <span key={session._id}>{session.startTime}–{session.endTime}<small>{session.teacherName} · {session.title}</small></span>)}</div> : <span className="student-support-none">No session scheduled</span>}
              </article>
            })}</div>
          </section>
        </aside>
      </div>
      {subscriptions.length > 0 && <section className="student-panel student-billing-panel" aria-label="Monthly course tuition">
        <div className="student-panel-heading"><div><span className="student-eyebrow">Monthly billing</span><h2>Course tuition</h2></div></div>
        <div className="student-billing-list">{subscriptions.map((subscription) => {
          const isOverdue = subscription.status === 'expired'
          const isDueSoon = subscription.paymentDue && subscription.status === 'active'
          return <article className={`student-billing-row${isOverdue ? ' is-overdue' : isDueSoon ? ' is-due-soon' : ''}`} key={subscription.listingId}>
            <div>
              <strong>{subscription.courseName}</strong>
              <span>{money(subscription.amount)} / month · Stripe manual renewal</span>
              <small>
                {subscription.billingExpiresAt ? `Access through ${dateLabel(subscription.billingExpiresAt)}` : 'No billing record'} ·{' '}
                <span className={`student-billing-status ${subscription.status}`}>{subscription.status}</span>
              </small>
              {isDueSoon && subscription.daysUntilExpiry <= 7 && (
                <small className="student-billing-reminder">
                  {subscription.daysUntilExpiry <= 0 ? 'Access expired — pay to restore access.' : `Access expires in ${subscription.daysUntilExpiry} day${subscription.daysUntilExpiry === 1 ? '' : 's'} — pay now to continue.`}
                </small>
              )}
            </div>
            <div className="student-billing-actions">
              {subscription.paymentDue && !subscription.renewalCancelled && (
                <button type="button" className="student-billing-pay" onClick={() => startMonthlyPayment(subscription)}>
                  Pay monthly fee
                </button>
              )}
              {!subscription.renewalCancelled && subscription.status !== 'expired' && (
                <button type="button" className="student-billing-cancel" disabled={cancellingSubscription === subscription.listingId} onClick={() => cancelMonthlyTuition(subscription)}>
                  {cancellingSubscription === subscription.listingId ? 'Cancelling...' : 'Cancel renewal'}
                </button>
              )}
            </div>
          </article>
        })}</div>
        <p className="student-billing-note">Each month you must manually pay your tuition to maintain course access. Cancelling stops future payment reminders; access lasts through the current paid period.</p>
      </section>}
      <section className="student-stat-grid student-dashboard-summary" aria-label="Learning overview">
        <article><span className="student-stat-icon purple"><FiBookOpen /></span><div><small>My courses</small><strong>{dashboard?.stats.enrolledCourses || 0}</strong><span>Active enrollments</span></div></article>
        <article><span className="student-stat-icon mint"><FiFileText /></span><div><small>To do</small><strong>{dashboard?.stats.pendingAssignments || 0}</strong><span>Assignments to submit</span></div></article>
        <article><span className="student-stat-icon blue"><FiCheckCircle /></span><div><small>Submitted</small><strong>{dashboard?.stats.submittedAssignments || 0}</strong><span>Work turned in</span></div></article>
        <article><span className="student-stat-icon peach"><FiCalendar /></span><div><small>Upcoming classes</small><strong>{(dashboard?.liveClasses || []).filter((item) => item.status === 'upcoming').length}</strong><span>Scheduled online sessions</span></div></article>
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
        {listings.length ? <div className="student-discovery-grid">{listings.map((listing) => <DiscoveryCard key={listing._id} listing={listing} isEnrolled={enrolledIds.has(String(listing._id))} enrolling={enrolling} onEnroll={enroll} />)}</div> : <div className="student-empty-inline"><FiSearch /><strong>No published courses yet</strong><span>Check back soon for newly published classes.</span></div>}
      </section>
    </>}
    {stripeListing && (
      <StripePaymentFlow
        listing={stripeListing}
        paymentType={stripePaymentType}
        onClose={() => { setStripeListing(null) }}
        onAlreadyEnrolled={(msg) => { setStripeListing(null); setNotice(msg); refresh() }}
      />
    )}
  </StudentLayout>
}

export function StudentClasses() {
  const [searchParams] = useSearchParams()
  const { dashboard, loading, error, refresh } = useStudentDashboard()
  const [listings, setListings] = useState([])
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('enrolled')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(() => paymentMessages[searchParams.get('payment')] || '')
  const [catalogError, setCatalogError] = useState('')
  const [actionError, setActionError] = useState('')
  const [stripeListing, setStripeListing] = useState(null)
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
  const liveClasses = dashboard?.liveClasses ?? emptyList
  const learningProgress = dashboard?.learningProgress ?? emptyList
  const progressByListing = new Map(learningProgress.map((item) => [String(item.listingId), item]))
  const courseNames = new Map(enrollments.map((enrollment) => [
    String(enrollment.listingId),
    enrollment.listing?.name || enrollment.name || 'Course',
  ]))
  const enrolledIds = new Set(enrollments.map((item) => String(item.listingId)))
  const items = mode === 'enrolled'
    ? enrollments.map((item) => ({ ...item.listing, _enrollment: item }))
    : listings.filter((item) => !enrolledIds.has(String(item._id)))
  const filtered = items.filter((item) => `${item.name} ${item.category} ${item.teacherName} ${item.location}`.toLowerCase().includes(query.trim().toLowerCase()))

  const enroll = async (listing) => {
    const initialTotal = Number(listing.admissionFee || 0) + Number((listing.monthlyTuitionFee ?? listing.fee) || 0)
    if (initialTotal > 0) {
      setActionError('')
      setStripeListing(listing)
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

  const handleCloseStripe = () => { setStripeListing(null) }

  const handlePaymentMethodSelect = (method) => {
    setPaymentMethodModalOpen(false)
    if (method === 'bkash') setBkashListing(selectedListing)
    else setStripeListing(selectedListing)
    setSelectedListing(null)
  }

  const handlePaymentMethodClose = () => {
    setPaymentMethodModalOpen(false)
    setSelectedListing(null)
  }

  return <StudentLayout title="My Classes" description="Keep your enrolled courses and discover new learning opportunities.">
    <StudentStatus error={error || catalogError || actionError} notice={notice} onRetry={refresh} />
    <div className="student-toolbar"><div className="student-tabs" role="tablist" aria-label="Classes view">
      <button type="button" role="tab" aria-selected={mode === 'enrolled'} onClick={() => setMode('enrolled')}>Enrolled ({enrollments.length})</button>
      <button type="button" role="tab" aria-selected={mode === 'discover'} onClick={() => setMode('discover')}>Discover courses</button>
    </div><label className="student-search"><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search classes" placeholder="Search courses..." /></label></div>
    {mode === 'enrolled' && !loading && <section className="student-panel">
      <div className="student-panel-heading"><div><span className="student-eyebrow">Online learning schedule</span><h2>Upcoming and past classes</h2></div></div>
      {liveClasses.length ? <div className="student-session-list">{liveClasses.map((session) => <article className="student-session-row" key={`${session.source || 'session'}-${session._id}`}>
        <div><strong>{session.topic || session.title || 'Online class'}</strong><span>{courseNames.get(String(session.listingId)) || 'Enrolled course'}</span><small>{dateLabel(session.classDate, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}{session.startTime ? ` · ${session.startTime}` : ''}</small></div>
        <span className={`student-session-status ${session.status}`}>{session.status}</span>
        {session.meetUrl ? <a href={session.meetUrl} target="_blank" rel="noreferrer"><FiExternalLink /> Join class</a> : <span className="student-muted">Meeting link not added</span>}
      </article>)}</div> : <div className="student-empty-inline"><FiCalendar /><strong>No scheduled online classes</strong><span>Your teachers' upcoming class schedule and meeting links will appear here.</span></div>}
    </section>}
    {loading ? <div className="student-state" role="status">Loading classes...</div> : filtered.length ? <div className="student-class-grid">{filtered.map((listing) => {
      const enrollment = listing._enrollment
      const progress = enrollment ? progressByListing.get(String(enrollment.listingId)) : null
      const recordedCount = progress?.totalLessons || 0
      return <article className="student-class-card" key={listing._id}>
        {listing.image && <img className="student-class-cover" src={listing.image} alt="" loading="lazy" />}
        <div className="student-class-card-body"><span className="student-category">{listing.category}</span><h2>{listing.name}</h2><p className="student-teacher-name"><FiUsers /> {listing.teacherName || 'TeachOS teacher'}</p>
          <div className="student-class-details"><span><FiClock /> {listing.duration}</span><span><FiTag /> {listing.location}</span><span><FiCalendar /> Starts {dateLabel(listing.startDate, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
          {enrollment && <><p className="student-recorded-count">{recordedCount ? `${recordedCount} published recorded ${recordedCount === 1 ? 'class' : 'classes'}` : 'No published recorded classes yet'}</p><Link className="student-primary-button student-class-continue" to={`/student/course/${encodeURIComponent(listing._id)}/learn`}><FiPlay /> {recordedCount ? 'View recorded classes' : 'Open course materials'}</Link></>}
          <div className="student-card-footer">{enrollment ? <><span className="student-enrolled-badge"><FiCheckCircle /> Enrolled {dateLabel(enrollment.enrolledAt, { month: 'short', day: 'numeric' })}</span><div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{(listing.pricingType === 'ONE_TIME' || (!listing.monthlyTuitionFee && Number(listing.fee) > 0 && listing.pricingType !== 'MONTHLY_SUBSCRIPTION')) ? <><strong>{money(Number(listing.fee || listing.admissionFee || 0))}</strong><small style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ background: '#ede9fe', color: '#6d28d9', padding: '1px 5px', borderRadius: '4px', fontSize: '9px', fontWeight: 700 }}>Lifetime Access</span>one-time</small></> : <><strong>{money(Number((listing.monthlyTuitionFee ?? listing.fee) || 0))}/month</strong><small>{Number(listing.admissionFee || 0) > 0 ? `Admission ${money(listing.admissionFee || 0)} paid once` : 'No admission fee'}</small></>}</div></> : <><div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{(listing.pricingType === 'ONE_TIME' || (!listing.monthlyTuitionFee && Number(listing.fee) > 0 && listing.pricingType !== 'MONTHLY_SUBSCRIPTION')) ? <><strong>{money(Number(listing.fee || listing.admissionFee || 0))}</strong><small style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ background: '#ede9fe', color: '#6d28d9', padding: '1px 5px', borderRadius: '4px', fontSize: '9px', fontWeight: 700 }}>Lifetime Access</span>one-time</small></> : <><strong>{money(Number(listing.admissionFee || 0) + Number((listing.monthlyTuitionFee ?? listing.fee) || 0))}</strong><small>to join · then {money(Number((listing.monthlyTuitionFee ?? listing.fee) || 0))}/month</small></>}</div><button type="button" disabled={busy === String(listing._id)} onClick={() => enroll(listing)}>{busy === String(listing._id) ? 'Starting...' : Number(listing.admissionFee || 0) + Number((listing.monthlyTuitionFee ?? listing.fee) || 0) > 0 ? 'Pay & enroll' : 'Enroll now'}</button></>}</div>
        </div>
      </article>
    })}</div> : <EmptyState icon={mode === 'enrolled' ? FiBookOpen : FiSearch} title={mode === 'enrolled' ? 'No enrolled classes yet' : 'No matching courses'} copy={mode === 'enrolled' ? 'Browse the catalog and enroll in a course to see it here.' : 'Try a different search or check back for new courses.'} link={mode === 'enrolled' ? undefined : '/student/classes'} label={mode === 'enrolled' ? undefined : 'Clear search'} onClick={mode === 'discover' ? () => setQuery('') : undefined} />}
    {stripeListing && (
      <StripePaymentFlow
        listing={stripeListing}
        onClose={handleCloseStripe}
        onAlreadyEnrolled={(msg) => { setStripeListing(null); setNotice(msg); refresh(); setMode('enrolled') }}
      />
    )}
  </StudentLayout>
}

export function StudentAttendance() {
  const { dashboard, loading, error, refresh } = useStudentDashboard()
  const [courseFilter, setCourseFilter] = useState('all')
  const attendance = dashboard?.attendance
  const courses = attendance?.courses ?? emptyList
  const history = attendance?.history ?? emptyList
  const filteredHistory = courseFilter === 'all'
    ? history
    : history.filter((item) => String(item.listingId) === courseFilter)

  return <StudentLayout title="Attendance" description="Review your course attendance from recorded online class sessions.">
    <StudentStatus error={error} onRetry={refresh} />
    {loading ? <div className="student-state" role="status">Loading your attendance records...</div> : <>
      <section className="student-stat-grid" aria-label="Attendance summary" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <article><span className="student-stat-icon purple"><FiCalendar /></span><div><small>Total classes</small><strong>{attendance?.totalClasses || 0}</strong><span>Recorded sessions</span></div></article>
        <article><span className="student-stat-icon mint"><FiCheckCircle /></span><div><small>Attended</small><strong>{attendance?.attendedClasses || 0}</strong><span>Marked present</span></div></article>
        <article><span className="student-stat-icon peach"><FiClock /></span><div><small>Absent</small><strong>{attendance?.absentClasses || 0}</strong><span>Marked absent</span></div></article>
        <article><span className="student-stat-icon purple" style={{ background: '#fef3c7', color: '#b45309' }}><FiClock /></span><div><small>Late</small><strong style={{ color: '#b45309' }}>{attendance?.lateClasses || 0}</strong><span>Late arrivals</span></div></article>
        <article><span className="student-stat-icon mint" style={{ background: '#ede9fe', color: '#6d28d9' }}><FiCheckCircle /></span><div><small>Excused</small><strong style={{ color: '#6d28d9' }}>{attendance?.excusedClasses || 0}</strong><span>Not penalized</span></div></article>
      </section>

      <section className="student-panel student-fee-panel">
        <div className="student-panel-heading"><div><span className="student-eyebrow">Course summary</span><h2>Attendance by course</h2></div></div>
        {courses.length ? <div className="student-table-wrap"><table className="student-table">
          <thead>
            <tr>
              <th>Course</th>
              <th>Total classes</th>
              <th>Attended</th>
              <th>Absent</th>
              <th>Late</th>
              <th>Excused</th>
              <th>Attendance</th>
            </tr>
          </thead>
          <tbody>
            {courses.map((course) => (
              <tr key={course.listingId}>
                <td><strong>{course.courseName}</strong></td>
                <td>{course.totalClasses}</td>
                <td style={{ color: '#15803d', fontWeight: 600 }}>{course.attendedClasses}</td>
                <td style={{ color: '#b91c1c' }}>{course.absentClasses}</td>
                <td style={{ color: '#b45309' }}>{course.lateClasses || 0}</td>
                <td style={{ color: '#6d28d9' }}>{course.excusedClasses || 0}</td>
                <td>
                  <span style={{
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '5px',
                    background: course.attendancePercentage >= 75 ? '#dcfce7' : '#fee2e2',
                    color: course.attendancePercentage >= 75 ? '#15803d' : '#b91c1c',
                  }}>
                    {course.attendancePercentage}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div> : <div className="student-empty-inline"><FiCheckCircle /><strong>No attendance records yet</strong><span>Your attendance summary will appear after your teacher records a class session.</span></div>}
      </section>

      <section className="student-panel student-fee-panel">
        <div className="student-panel-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div><span className="student-eyebrow">Session records</span><h2>Attendance history</h2></div>
          {courses.length > 1 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b' }}>
              <span>Filter course:</span>
              <select
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                style={{ padding: '5px 9px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px' }}
              >
                <option value="all">All courses</option>
                {courses.map((c) => (
                  <option key={c.listingId} value={c.listingId}>{c.courseName}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {filteredHistory.length ? <div className="student-table-wrap"><table className="student-table">
          <thead>
            <tr><th>Date</th><th>Course</th><th>Topic</th><th>Status</th><th>Duration</th></tr>
          </thead>
          <tbody>
            {filteredHistory.map((record) => (
              <tr key={`${record.listingId}-${record.sessionId}`}>
                <td>{dateLabel(record.date, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td>{record.courseName}</td>
                <td>{record.topic}</td>
                <td>
                  <span className={`student-payment-status ${record.status}`} style={{ textTransform: 'capitalize' }}>
                    {record.status}
                  </span>
                </td>
                <td>{record.durationMinutes ? `${record.durationMinutes} min` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div> : <div className="student-empty-inline"><FiCalendar /><strong>Attendance history is empty</strong><span>Only records saved by your teacher are included; unrecorded classes are not assumed absent.</span></div>}
      </section>
    </>}
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
      ...payments.map((item) => [
        dateLabel(item.paidAt || item.createdAt),
        item.courseName || item.description || 'Payment',
        fees.find((fee) => String(fee.listingId) === String(item.listingId))?.teacherName || item.teacherName || '',
        Number(item.amount || 0).toFixed(2),
        item.status || 'Recorded',
      ]),
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
      <section className="student-billing-summary"><article><span>Enrolled course fees</span><strong>{money(amountInCourseFees)}</strong><small>Fees listed by your teachers at enrollment</small></article><article><span>Live payments</span><strong>{money(billing?.paidTotal)}</strong><small>Confirmed live BDT transactions only</small></article><article><span>Test &amp; sandbox payments</span><strong>{money(billing?.testTotal)}</strong><small>Excluded from earnings and commission</small></article></section>
      <div className="student-billing-note"><FiShield /><p><strong>Records only:</strong> this ledger displays course fees and payment records. Test payments can unlock enrollment in test mode but are excluded from teacher income and TeachOS commission.</p></div>
      <section className="student-panel student-fee-panel"><div className="student-panel-heading"><div><span className="student-eyebrow">Enrollment records</span><h2>Course fees</h2></div></div>
        {fees.length ? <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Course</th><th>Teacher</th><th>Admission (BDT)</th><th>Monthly Tuition (BDT)</th><th>Initial Payment (BDT)</th><th>Enrolled</th><th>Status</th></tr></thead><tbody>{fees.map((item) => <tr key={String(item.listingId)}><td><Link className="student-ledger-course-link" to={`/student/course/${encodeURIComponent(String(item.listingId))}/learn`}>{item.name}</Link></td><td>{item.teacherName || 'TeachOS teacher'}</td><td>{money(item.admissionFee || 0)}</td><td>{money(item.monthlyTuitionFee || 0)}</td><td>{money(item.initialPaymentTotal || 0)}</td><td>{dateLabel(item.enrolledAt)}</td><td><span className={`student-payment-status ${item.admissionPaid && item.tuitionPaid ? 'paid' : 'pending'}`}>{item.admissionPaid && item.tuitionPaid ? 'Initial paid' : 'Initial due'}</span></td></tr>)}</tbody></table></div> : <div className="student-empty-inline"><FiCreditCard /><strong>No course fees yet</strong><span>Enroll in a course to see its fee breakdown here.</span><Link to="/student/classes">Browse courses <FiArrowRight /></Link></div>}
      </section>
      <section className="student-panel student-fee-panel"><div className="student-panel-heading"><div><span className="student-eyebrow">Account activity</span><h2>Payment history</h2></div><button className="student-outline-button" type="button" onClick={downloadStatement}><FiDownload /> Download statement</button></div>
        {payments.length ? <div className="student-table-wrap"><table className="student-table"><thead><tr><th>Date</th><th>Course</th><th>Teacher</th><th>Billing period</th><th>Payment type</th><th>Amount (BDT)</th><th>Status</th></tr></thead><tbody>{payments.map((item) => {
          const course = fees.find((fee) => String(fee.listingId) === String(item.listingId))
          return <tr key={item._id}><td>{dateLabel(item.paidAt || item.createdAt)}</td><td>{item.listingId ? <Link className="student-ledger-course-link" to={`/student/course/${encodeURIComponent(String(item.listingId))}/learn`}>{item.courseName || course?.name || 'Course payment'}</Link> : item.courseName || item.description || 'Student payment'}</td><td>{course?.teacherName || item.teacherName || '—'}</td><td>{item.billingPeriod || '—'}</td><td>{item.paymentType === 'initial' ? 'Admission + 1st month tuition' : item.paymentType === 'monthly' ? 'Monthly tuition' : item.paymentMethod || item.gateway || '—'}</td><td>{money(item.amount)}{Number(item.refundedAmount) > 0 ? ` · refunded ${money(item.refundedAmount)}` : ''}</td><td><span className={`student-payment-status ${item.status || 'recorded'}`}>{item.status || 'recorded'}</span></td></tr>
        })}</tbody></table></div> : <div className="student-empty-inline"><FiCreditCard /><strong>No payment records</strong><span>When a payment is recorded for your account, it will appear here.</span></div>}
      </section>
    </>}
  </StudentLayout>
}

function CourseRow({ enrollment }) {
  const listing = enrollment.listing || {}
  return <article className="student-course-row"><div className="student-course-icon"><FiBookOpen /></div><div className="student-course-info"><h3>{listing.name || enrollment.name}</h3><p>{listing.category || enrollment.category} · {listing.teacherName || enrollment.teacherName}</p></div><span className="student-course-location">{listing.location || enrollment.location}</span><Link to={`/student/course/${encodeURIComponent(enrollment.listingId)}/learn`} aria-label={`Continue ${listing.name || enrollment.name}`}><FiArrowRight /></Link></article>
}

function AssignmentRow({ assignment }) {
  return <article className="student-assignment-row"><span><FiFileText /></span><div><strong>{assignment.title}</strong><small>{assignment.listingName}</small></div><time>{dateLabel(assignment.dueDate, { month: 'short', day: 'numeric' })}</time></article>
}

function EmptyState({ icon: Icon, title, copy, link, label, onClick }) {
  return <div className="student-empty-state"><span><Icon /></span><h2>{title}</h2><p>{copy}</p>{link && <Link to={link} onClick={onClick}>{label || 'Explore TeachOS'} <FiArrowRight /></Link>}{!link && onClick && <button type="button" onClick={onClick}>{label} <FiArrowRight /></button>}</div>
}
