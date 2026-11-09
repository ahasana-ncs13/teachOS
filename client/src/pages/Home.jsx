import { useEffect, useMemo, useRef, useState } from 'react'
import { FiArrowRight, FiBell, FiBookOpen, FiBriefcase, FiCheck, FiChevronDown, FiChevronLeft, FiChevronRight, FiCode, FiGlobe, FiGrid, FiLogOut, FiMapPin, FiMenu, FiMonitor, FiPlus, FiSearch, FiShield, FiStar, FiTag, FiUser, FiUsers, FiX } from 'react-icons/fi'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import StripePaymentFlow from '../components/StripePaymentFlow'
import '../styles/home.css'

const slides = [
  { eyebrow: 'Enrollment open · 2026', title: <>Learn from the best teachers, <span>wherever you are.</span></>, copy: 'Discover focused online courses and verified mentors. Find a live learning path that works for your goals.', cta: 'Explore online courses', image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=85', label: 'Live online classes and direct mentorship' },
  { eyebrow: 'One connected learning space', title: <>One platform for every <span>online course.</span></>, copy: 'From board examinations to tech bootcamps, find online courses and live cohorts in one learning workspace.', cta: 'Browse all courses', image: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=900&q=85', label: 'Online learning, wherever you are' },
  { eyebrow: 'Quality-first learning', title: <>Every student deserves <span>the right teacher.</span></>, copy: 'Compare schedules, fees, and verified instructors to choose learning that works for you.', cta: 'Find your teacher', image: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=900&q=85', label: 'One-to-one & small group batches' },
]

const categories = [
  ['Online course', 'Live interactive classes, whiteboard recordings, and synchronized batch discussions.', <FiMonitor key="online" />, 'Explore listings'],
  ['Theory Course', 'University-level theory subjects taught by TeachOS instructors.', <FiGrid key="theory" />, 'Explore listings'],
  ['Exam preparation', 'Targeted drills for HSC, BCS, IELTS, SAT, and admission exams.', <FiCheck key="exam" />, 'Explore listings'],
  ['Skill course', 'Practical capabilities in web development, data science, English, and design.', <FiCode key="skill" />, 'Explore listings'],
]

function Home() {
  const [searchParams] = useSearchParams()
  const [slide, setSlide] = useState(0)
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('search') || '')
  const [category, setCategory] = useState('')
  const [location, setLocation] = useState('')
  const [listings, setListings] = useState([])
  const [listingsLoading, setListingsLoading] = useState(true)
  const [listingsLoadingMore, setListingsLoadingMore] = useState(false)
  const [listingsError, setListingsError] = useState('')
  const [listingsReload, setListingsReload] = useState(0)
  const [listingPage, setListingPage] = useState(1)
  const [listingPagination, setListingPagination] = useState(null)
  const [selectedListing, setSelectedListing] = useState(null)
  const [infoModal, setInfoModal] = useState('')
  const [stripeListing, setStripeListing] = useState(null)
  const [enrollNotice, setEnrollNotice] = useState('')
  const [teacherLeaderboard, setTeacherLeaderboard] = useState([])
  const [leaderboardBasis, setLeaderboardBasis] = useState('')
  const [leaderboardLoading, setLeaderboardLoading] = useState(true)
  const [leaderboardError, setLeaderboardError] = useState('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef(null)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const current = slides[slide]
  const isTeacher = user?.role === 'teacher'
  const visibleListings = useMemo(() => listings.filter((item) => {
    const searchableLocation = `${item.category} ${item.location}`.toLowerCase()
    const onlineOnly = !/offline|in.person|hybrid/.test(searchableLocation) &&
      (!item.deliveryMode || ['live', 'recorded'].includes(item.deliveryMode))
    return onlineOnly && (!location ||
      (location === 'online' && (item.deliveryMode === 'live' || item.deliveryMode === 'recorded' || searchableLocation.includes('online'))) ||
      (location === 'dhaka' && searchableLocation.includes('dhaka')))
  }), [listings, location])
  useEffect(() => {
    const timer = setInterval(() => setSlide((value) => (value + 1) % slides.length), 8000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(async () => {
      if (listingPage === 1) setListingsLoading(true)
      else setListingsLoadingMore(true)
      setListingsError('')
      try {
        const { data } = await api.get('/listings', {
          params: { search: searchTerm.trim(), category: category || undefined, page: listingPage, limit: 30 },
        })
        if (current) {
          setListings((existing) => listingPage === 1 ? data.listings || [] : [...existing, ...(data.listings || [])])
          setListingPagination(data.pagination || null)
        }
      } catch (requestError) {
        if (current) setListingsError(requestError.response?.data?.message || 'Could not load course listings. Check that the API and database are available.')
      } finally {
        if (current) {
          setListingsLoading(false)
          setListingsLoadingMore(false)
        }
      }
    }, 180)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [searchTerm, category, listingsReload, listingPage])

  useEffect(() => {
    let current = true
    api.get('/teachers/leaderboard').then(({ data }) => {
      if (current) {
        setTeacherLeaderboard(data.teachers || [])
        setLeaderboardBasis(data.rankingBasis || '')
      }
    }).catch((requestError) => {
      if (current) setLeaderboardError(requestError.response?.data?.message || 'Teacher rankings could not be loaded.')
    }).finally(() => {
      if (current) setLeaderboardLoading(false)
    })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedListing(null)
        setInfoModal('')
        setProfileMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const moveSlide = (direction) => setSlide((value) => (value + direction + slides.length) % slides.length)
  const scrollToListings = () => document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' })
  const applyCategory = (value) => {
    setListingPage(1)
    setCategory((currentCategory) => value === currentCategory ? '' : value)
    window.setTimeout(scrollToListings, 0)
  }
  const updateSearchTerm = (value) => {
    setListingPage(1)
    setSearchTerm(value)
  }
  const updateCategory = (value) => {
    setListingPage(1)
    setCategory(value)
  }
  const submitSearch = (event) => {
    event.preventDefault()
    scrollToListings()
  }
  const createListing = () => navigate(isTeacher ? '/dashboard/listings' : user ? '/' : '/register')
  const handleCreateListing = () => {
    if (user && !isTeacher) {
      setToast('Batch listings are available to teacher accounts.')
      return
    }
    createListing()
  }
  const dashboardPath = user?.role === 'admin' ? '/admin' : user?.role === 'teacher' ? '/dashboard' : user?.role === 'student' ? '/student' : null
  const profileName = user?.displayName || user?.fullName || user?.email?.split('@')[0] || 'TeachOS user'
  const profileRole = user?.role ? `${user.role[0].toUpperCase()}${user.role.slice(1)}` : 'Member'

  // Called from ListingModal "Pay & Enroll" / "Enroll" button
  const handleEnroll = async (listing) => {
    if (!user) { navigate('/login'); return }
    if (user.role !== 'student') {
      setToast('Switch to a student account to enroll in courses.')
      return
    }
    const initialTotal = Number(listing.admissionFee || 0) + Number(listing.monthlyTuitionFee ?? listing.fee ?? 0)
    if (initialTotal > 0) {
      setSelectedListing(null)
      setStripeListing(listing)
    } else {
      // Free course — enroll directly
      try {
        await api.post(`/student/enrollments/${encodeURIComponent(listing._id)}`)
        setSelectedListing(null)
        setEnrollNotice(`You are enrolled in ${listing.name}!`)
        setTimeout(() => setEnrollNotice(''), 5000)
      } catch (err) {
        setToast(err.response?.data?.message || 'Could not enroll. Please try again.')
      }
    }
  }

  useEffect(() => {
    if (!profileMenuOpen) return undefined
    const closeOnOutsideClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [profileMenuOpen])

  return <div className="home-page">
    <header className="home-header">
      <div className="home-header-inner">
        <Link className="home-logo" to="/"><span className="home-logo-mark">T</span><strong>Teach<span>OS</span></strong><small>Academic OS</small></Link>
        <nav className={mobileNav ? 'home-nav open' : 'home-nav'} aria-label="Main navigation">
          <Link className="active" to="/" onClick={() => setMobileNav(false)}>Home</Link>
          <a href="#listings" onClick={() => setMobileNav(false)}>Courses &amp; batches</a>
          <a href="#instructor" onClick={() => setMobileNav(false)}>Teach on TeachOS</a>
          <Link to={isTeacher ? '/dashboard/listings' : user?.role === 'admin' ? '/admin/classes' : user?.role === 'student' ? '/student/classes' : user ? '/login' : '/register'} onClick={() => setMobileNav(false)}>{user?.role === 'student' ? 'My classes' : 'My listings'}</Link>
          <Link to={user?.role === 'student' ? '/student/classes' : user ? '#listings' : '/login'} onClick={() => { setMobileNav(false); if (user && user.role !== 'student') setToast('Choose a course to view enrollment options.') }}>My enrollments</Link>
        </nav>
        <div className="home-tools">
          <form className="home-search" onSubmit={submitSearch}><FiSearch /><input aria-label="Search courses" placeholder="Search courses, batches..." value={searchTerm} onChange={(event) => updateSearchTerm(event.target.value)} /></form>
          <button className="header-icon" type="button" aria-label="Notifications" onClick={() => { setToast('You’re all caught up. Browse the latest courses below.'); scrollToListings() }}><FiBell /><i /></button>
          {user ? <div className="profile-menu-wrap" ref={profileMenuRef}>
            <button className="profile-chip" type="button" onClick={() => setProfileMenuOpen((open) => !open)} aria-haspopup="menu" aria-expanded={profileMenuOpen} aria-label={`Open ${profileName} profile menu`}>
              <span>{profileName[0]?.toUpperCase() || 'U'}</span><b>{profileName}</b><FiChevronDown className={profileMenuOpen ? 'profile-chevron is-open' : 'profile-chevron'} />
            </button>
            {profileMenuOpen && <div className="profile-menu" role="menu">
              <div className="profile-menu-heading"><span className="profile-menu-avatar">{profileName[0]?.toUpperCase() || 'U'}</span><div><strong>{profileName}</strong><small>{user.email}</small></div></div>
              <div className="profile-role"><FiUser /><span>Account role</span><b>{profileRole}</b></div>
              {dashboardPath ? <Link role="menuitem" to={dashboardPath} onClick={() => setProfileMenuOpen(false)}><FiGrid /> Go to {profileRole} dashboard</Link> : <button role="menuitem" type="button" onClick={() => { setProfileMenuOpen(false); scrollToListings() }}><FiBookOpen /> Browse courses</button>}
              <button className="profile-menu-signout" role="menuitem" type="button" onClick={() => { setProfileMenuOpen(false); signOut() }}><FiLogOut /> Sign out</button>
            </div>}
          </div> : <Link className="header-login" to="/login">Sign in</Link>}
          <button className="mobile-toggle" type="button" onClick={() => setMobileNav((open) => !open)} aria-label="Toggle navigation" aria-expanded={mobileNav}>{mobileNav ? <FiX /> : <FiMenu />}</button>
        </div>
      </div>
      <div className="announcement"><div><FiTag /><b>Enrollment is open:</b><span>Explore courses and coaching batches for 2026.</span><a href="#listings">View courses</a></div><small><i /> Learn directly from verified educators</small></div>
    </header>

    <main className="home-main">
      <section className="home-hero">
        <div className="hero-panel">
          <div className="hero-copy"><span className="home-kicker"><i /> {current.eyebrow}</span><h1>{current.title}</h1><p>{current.copy}</p><div className="hero-actions"><a className="home-primary" href="#listings">{current.cta} <FiArrowRight /></a><Link className="home-secondary" to="/register"><FiBriefcase /> Become a teacher</Link></div></div>
          <div className="hero-image"><img src={current.image} alt="Students learning together in a focused academic setting" /><div><span><FiCheck /> {current.label}</span><b>TeachOS verified faculty system</b></div></div>
          <div className="hero-controls"><div className="dots">{slides.map((item, index) => <button type="button" key={item.eyebrow} className={index === slide ? 'selected' : ''} onClick={() => setSlide(index)} aria-label={`Go to slide ${index + 1}`} aria-pressed={index === slide} />)}</div><button type="button" onClick={() => moveSlide(-1)} aria-label="Previous slide"><FiChevronLeft /></button><button type="button" onClick={() => moveSlide(1)} aria-label="Next slide"><FiChevronRight /></button></div>
        </div>
        <SearchPanel searchTerm={searchTerm} setSearchTerm={updateSearchTerm} category={category} setCategory={updateCategory} location={location} setLocation={setLocation} submitSearch={submitSearch} />
      </section>

      <section className="stat-strip" aria-label="TeachOS features">{[['Public listings', 'Browse published courses', <FiBookOpen key="courses" />], ['Teacher workspace', 'Classes and attendance', <FiShield key="teachers" />], ['Transparent pricing', 'Course fees shown in taka', <FiTag key="pricing" />], ['Online classes', 'Learn from anywhere', <FiGlobe key="modes" />]].map(([value, label, icon]) => <div key={label}><span>{icon}</span><div><b>{value}</b><small>{label}</small></div></div>)}</section>
      <CategorySection selected={category} onSelect={applyCategory} />
      <section className="home-section" id="listings">
        <SectionIntro eyebrow="Live from TeachOS" title="Featured courses & batches" copy="Browse published online courses from TeachOS teachers. Course search matches course and teacher information." link="Clear filters" onLink={() => { setListingPage(1); setCategory(''); setLocation(''); setSearchTerm('') }} />
        <div className="active-filters">
          {category && <button type="button" onClick={() => updateCategory('')}>{category} <FiX /></button>}
          {location && <button type="button" onClick={() => setLocation('')}>{location === 'dhaka' ? 'Dhaka teachers' : 'Online'} <FiX /></button>}
          {searchTerm && <button type="button" onClick={() => updateSearchTerm('')}>“{searchTerm}” <FiX /></button>}
        </div>
        {listingsLoading ? <div className="home-no-results" role="status">Loading published courses from TeachOS...</div>
          : listingsError ? <div className="home-no-results" role="alert"><FiX /><h3>Listings are temporarily unavailable</h3><p>{listingsError}</p><button className="home-secondary" type="button" onClick={() => { setListingPage(1); setListingsReload((value) => value + 1) }}>Try again</button></div>
            : <><div className="listing-grid">{visibleListings.map((listing) => <ListingCard key={listing._id} data={listing} onDetails={() => setSelectedListing(listing)} />)}</div>
              {!visibleListings.length && <div className="home-no-results"><FiSearch /><h3>No matching courses yet</h3><p>Try changing your search or clearing the filters.</p><button className="home-secondary" type="button" onClick={() => { setListingPage(1); setCategory(''); setLocation(''); setSearchTerm('') }}>Clear filters</button></div>}
              {listingPagination?.page < listingPagination?.totalPages && <button className="home-secondary listing-load-more" type="button" disabled={listingsLoadingMore} onClick={() => setListingPage((page) => page + 1)}>{listingsLoadingMore ? 'Loading more courses...' : 'Load more courses'}</button>}
            </>}
      </section>
      <WhySection />
      <FacultySection teachers={teacherLeaderboard} rankingBasis={leaderboardBasis} loading={leaderboardLoading} error={leaderboardError} />
      <section className="instructor-cta" id="instructor"><div><span className="home-kicker">Instructor partner program</span><h2>Are you an educator? Run your batches with TeachOS.</h2><p>Publish your batch timings, manage student enrollments, take attendance, and track payments in one workspace.</p><div className="cta-perks"><span><FiCheck /> Easy class setup</span><span><FiCheck /> Direct enrollments</span><span><FiCheck /> Attendance tools</span></div></div><div><button className="cta-light" type="button" onClick={handleCreateListing}><FiPlus /> {isTeacher ? 'Manage your classes' : 'Create a teacher account'}</button><a className="cta-dark" href="mailto:support@teachos.example?subject=TeachOS%20teacher%20onboarding">Request onboarding</a></div></section>
    </main>
    <Footer openInfo={setInfoModal} isTeacher={isTeacher} />
    {toast && <div className="home-toast" role="status"><FiCheck /><span>{toast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}><FiX /></button></div>}
    {enrollNotice && <div className="home-toast home-toast-success" role="status"><FiCheck /><span>{enrollNotice}</span><button type="button" aria-label="Dismiss" onClick={() => setEnrollNotice('')}><FiX /></button></div>}
    {selectedListing && <ListingModal listing={selectedListing} user={user} close={() => setSelectedListing(null)} onEnroll={handleEnroll} />}
    {infoModal && <InfoModal title={infoModal} close={() => setInfoModal('')} />}
    {stripeListing && <StripePaymentFlow
      listing={stripeListing}
      onClose={() => setStripeListing(null)}
      onAlreadyEnrolled={(msg) => { setStripeListing(null); setEnrollNotice(msg) }}
    />}
  </div>
}

function SearchPanel({ searchTerm, setSearchTerm, category, setCategory, location, setLocation, submitSearch }) {
  return <form className="search-panel" onSubmit={submitSearch}>
    <div><label htmlFor="course-category"><FiBookOpen /> Program category</label><select id="course-category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All academic categories</option>{categories.map(([name]) => <option key={name}>{name}</option>)}</select></div>
    <div><label htmlFor="course-location"><FiMapPin /> Learning mode</label><select id="course-location" value={location} onChange={(event) => setLocation(event.target.value)}><option value="">All online courses</option><option value="online">Live or recorded</option><option value="dhaka">Dhaka-based teachers</option></select></div>
    <div><label htmlFor="course-keyword"><FiSearch /> Keyword or teacher</label><input id="course-keyword" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="e.g. HSC Physics, IELTS, Python..." /></div>
    <button className="home-primary" type="submit"><FiSearch /> Search</button>
  </form>
}

function SectionIntro({ eyebrow, title, copy, link, onLink }) {
  return <div className="section-intro"><div><span className="section-kicker">{eyebrow}</span><h2>{title}</h2><p>{copy}</p></div>{link && <button type="button" onClick={onLink}>{link} <FiArrowRight /></button>}</div>
}

function CategorySection({ selected, onSelect }) {
  return   <section className="home-section" id="categories"><SectionIntro eyebrow="Explore academic pathways" title="Find a learning path that fits" copy="Browse live online cohorts, exam preparation, and practical skill courses." link="View courses" onLink={() => document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' })} /><div className="category-grid">{categories.map(([title, copy, icon, count]) => <button type="button" className={`category-card${selected === title ? ' selected' : ''}`} onClick={() => onSelect(title)} key={title}><div className="category-icon">{icon}</div><span>{count}</span><h3>{title}</h3><p>{copy}</p><b>Explore pathway <FiArrowRight /></b></button>)}</div></section>
}

function ListingCard({ data, onDetails }) {
  const teacherName = data.teacherName || 'TeachOS teacher'
  const categoryClass = data.category?.toLowerCase().includes('exam') ? 'tertiary' : 'primary'
  const startDate = data.startDate ? new Date(data.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Flexible start'
  const isOneTime = data.pricingType === 'ONE_TIME' || (!data.monthlyTuitionFee && Number(data.fee) > 0 && data.pricingType !== 'MONTHLY_SUBSCRIPTION')
  const admission = Number(data.admissionFee || 0)
  const tuition = Number(data.monthlyTuitionFee ?? data.fee) || 0
  const total = isOneTime ? (admission || Number(data.fee) || 0) : admission + tuition
  return (
    <article className="listing-card">
      {data.image && <img className="listing-image" src={data.image} alt="" loading="lazy" />}
      <div className="listing-top">
        <span className={`listing-type ${categoryClass}`}>{data.category}</span>
        <span className="listing-badge">{data.duration}</span>
      </div>
      {data.courseName && (
        <p className="listing-course-label">
          <FiBookOpen /> {data.courseName}
        </p>
      )}
      <h3 className="listing-batch-name">{data.name}</h3>
      <p className="listing-location"><FiMapPin /> {data.location || 'Online'}</p>
      <div className="teacher">
        <span>{teacherName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>
        <div><b>{teacherName} <FiCheck /></b><small>{data.email || 'TeachOS educator'}</small></div>
      </div>
      <div className="listing-meta">
        <span><FiBookOpen /> Starts: {startDate}</span>
      </div>
      <div className="course-listing-metrics">
        <span><FiUsers /> {data.enrolledCount} enrolled</span>
        <span>{data.attendancePercentage === null ? 'Attendance: no records' : `Attendance: ${data.attendancePercentage}%`}</span>
        <span>{data.rating === null ? 'Not rated' : `${data.rating} / 5`}</span>
      </div>
      <div className="listing-footer">
        <div>
          <small>{isOneTime ? 'Lifetime access · one-time' : 'Due now · then monthly tuition'}</small>
          <strong>{total ? `৳${total.toLocaleString('en-BD')}` : 'Free'}</strong>
        </div>
        <button type="button" onClick={onDetails}>See details</button>
      </div>
    </article>
  )
}

function ListingModal({ listing, user, close, onEnroll }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])
  const isOneTime = listing.pricingType === 'ONE_TIME' || (!listing.monthlyTuitionFee && Number(listing.fee) > 0 && listing.pricingType !== 'MONTHLY_SUBSCRIPTION')
  const admission = Number(listing.admissionFee || 0)
  const tuition = Number(listing.monthlyTuitionFee ?? listing.fee) || 0
  const initialTotal = isOneTime ? (admission || Number(listing.fee) || 0) : admission + tuition
  const isFree = initialTotal <= 0
  const isStudent = user?.role === 'student'
  const enrollLabel = !user
    ? 'Sign in to enroll'
    : !isStudent
      ? 'Student account required'
      : isFree
        ? 'Enroll for free'
        : `Pay & Enroll · ৳${initialTotal.toLocaleString('en-BD')}`
  return <div className="home-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-labelledby="listing-modal-title"><button className="home-modal-close" type="button" onClick={close} aria-label="Close course details"><FiX /></button><span className="listing-type">{listing.category}</span><h2 id="listing-modal-title">{listing.name}</h2><p>{listing.duration} · Starts {listing.startDate ? new Date(listing.startDate).toLocaleDateString() : 'flexibly'}</p><div className="home-modal-facts"><span><FiMapPin /> {listing.location || 'Online'}</span><span><FiBriefcase /> {listing.teacherName || 'TeachOS teacher'}</span>{isOneTime ? <span style={{ background: '#ede9fe', color: '#6d28d9', fontWeight: 700 }}><FiTag /> Lifetime Course Fee: {initialTotal ? `৳${initialTotal.toLocaleString('en-BD')}` : 'Free'}</span> : <><span><FiTag /> Admission {admission ? `৳${admission.toLocaleString('en-BD')}` : 'Free'}</span><span><FiTag /> Tuition {tuition ? `৳${tuition.toLocaleString('en-BD')}/month` : 'Free'}</span></>}<span><FiUsers /> {listing.enrolledCount || 0} enrolled</span><span>{listing.attendancePercentage === null ? 'No attendance records' : `${listing.attendancePercentage}% attendance`}</span><span>{listing.rating === null ? 'Not rated yet' : `${listing.rating} / 5`}</span></div><p className="home-modal-note">{listing.description}</p><div className="home-modal-actions"><button className="home-primary" type="button" onClick={() => onEnroll(listing)}>{enrollLabel} <FiArrowRight /></button><button className="home-secondary" type="button" onClick={close}>Keep browsing</button></div></section></div>
}

function WhySection() {
  const reasons = [['Direct teacher connection', 'Connect with verified mentors and see course fees before you enroll.', <FiTag key="markup" />], ['Verified credentials', 'Learn from educators whose experience and qualifications are reviewed.', <FiShield key="credentials" />], ['Online learning', 'Join live classes and access course resources from wherever you are.', <FiGlobe key="nearby" />], ['Student-first choices', 'Browse clear course details and select the learning path that works for you.', <FiStar key="reviews" />]]
  return <section className="why-section" id="standards"><SectionIntro eyebrow="The TeachOS advantage" title="A clearer way to find your next class" copy="Bring course discovery, teacher information, and classroom tools together in one learning workspace." /><div className="reason-grid">{reasons.map(([title, copy, icon]) => <article key={title}><span>{icon}</span><h3>{title}</h3><p>{copy}</p><b>TeachOS standard</b></article>)}</div><div className="trust-strip"><FiShield /><b>Learning built on clarity and trust</b><span>Verified educators · Transparent details · Student-first tools</span></div></section>
}

function FacultySection({ teachers, rankingBasis, loading, error }) {
  return <section className="home-section" id="faculty">
    <SectionIntro eyebrow="Academic mentorship" title="Top 10 teachers" copy="Rankings use active enrollment, recorded attendance, and published course counts. Ratings appear only when TeachOS has rating records." />
    {loading ? <div className="home-no-results" role="status">Loading teacher rankings...</div>
      : error ? <div className="home-no-results" role="alert">{error}</div>
        : teachers.length ? <div className="teacher-ranking-scroll"><table className="teacher-ranking-table">
          <thead><tr><th>Rank</th><th>Teacher</th><th>Top course</th><th>Courses</th><th>Students</th><th>Attendance</th><th>Rating</th></tr></thead>
          <tbody>{teachers.map((teacher) => <tr key={teacher.rank}><td><strong>#{teacher.rank}</strong></td><td>{teacher.name}</td><td>{teacher.topCourse}</td><td>{teacher.courseCount}</td><td>{teacher.enrolledStudents}</td><td>{teacher.attendancePercentage === null ? '—' : `${teacher.attendancePercentage}%`}</td><td>{teacher.rating === null ? 'Not rated' : `${teacher.rating} / 5`}</td></tr>)}</tbody>
        </table></div>
          : <div className="home-no-results"><FiUsers /><h3>No teacher rankings yet</h3><p>Teachers appear after publishing courses with real student activity.</p></div>}
    {rankingBasis && <p className="teacher-ranking-basis">{rankingBasis}</p>}
  </section>
}

function InfoModal({ title, close }) {
  return <div className="home-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-labelledby="info-modal-title"><button className="home-modal-close" type="button" onClick={close} aria-label="Close information"><FiX /></button><span className="section-kicker">TeachOS information</span><h2 id="info-modal-title">{title}</h2><p>TeachOS helps students discover educators and learning programs, and gives teachers workspace tools to manage classes and attendance.</p><div className="home-modal-actions"><a className="home-primary" href="mailto:support@teachos.example">Contact support <FiArrowRight /></a><button className="home-secondary" type="button" onClick={close}>Close</button></div></section></div>
}

function Footer({ openInfo, isTeacher }) {
  return <footer className="home-footer"><div className="footer-grid"><div><Link className="home-logo" to="/"><span className="home-logo-mark">T</span><strong>Teach<span>OS</span></strong></Link><p>Find courses and teachers, or manage your teaching workspace with TeachOS.</p></div><div><b>Platform</b><a href="#listings">Courses &amp; batches</a><a href="#categories">Explore categories</a><a href="#instructor">Teach on TeachOS</a></div><div><b>Organization</b><button type="button" onClick={() => openInfo('About TeachOS')}>About TeachOS</button><a href="mailto:support@teachos.example">Contact support</a><Link to={isTeacher ? '/dashboard' : '/login'}>Teacher portal</Link></div><div><b>Academic standards</b><button type="button" onClick={() => openInfo('Terms of service')}>Terms of service</button><button type="button" onClick={() => openInfo('Privacy policy')}>Privacy policy</button><a href="#standards">Learning standards</a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} TeachOS · Learning starts here.</span><span><i /> TeachOS learning workspace</span></div></footer>
}

export default Home
