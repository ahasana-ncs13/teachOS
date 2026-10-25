import { useEffect, useMemo, useRef, useState } from 'react'
import { FiArrowRight, FiBell, FiBookOpen, FiBriefcase, FiCheck, FiChevronDown, FiChevronLeft, FiChevronRight, FiCode, FiGlobe, FiGrid, FiLogOut, FiMapPin, FiMenu, FiMonitor, FiPlus, FiSearch, FiShield, FiStar, FiTag, FiUser, FiUsers, FiX } from 'react-icons/fi'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import '../styles/home.css'

const slides = [
  { eyebrow: 'Enrollment open · 2026', title: <>Learn from the best teachers, <span>online or offline.</span></>, copy: 'Discover accredited masterclasses, focused coaching centers, and verified local mentors. Find the right learning path for your goals.', cta: 'Explore courses & batches', image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=85', label: 'Structured coaching & direct mentorship' },
  { eyebrow: 'One connected learning space', title: <>One platform for every <span>course and batch.</span></>, copy: 'From board examinations to tech bootcamps, find physical classrooms and live online cohorts in one place.', cta: 'Browse all categories', image: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=900&q=85', label: 'Physical & hybrid learning modes' },
  { eyebrow: 'Quality-first learning', title: <>Every student deserves <span>the right teacher.</span></>, copy: 'Compare schedules, fees, and verified instructors to choose learning that works for you.', cta: 'Find your teacher', image: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=900&q=85', label: 'One-to-one & small group batches' },
]

const categories = [
  ['Online course', 'Live interactive classes, whiteboard recordings, and synchronized batch discussions.', <FiMonitor key="online" />, 'Explore listings'],
  ['Offline batch', 'Physical classroom seating, neighborhood coaching centers, and laboratory drills.', <FiBookOpen key="offline" />, 'Explore listings'],
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
  const [listingsError, setListingsError] = useState('')
  const [listingsReload, setListingsReload] = useState(0)
  const [selectedListing, setSelectedListing] = useState(null)
  const [selectedFaculty, setSelectedFaculty] = useState(null)
  const [infoModal, setInfoModal] = useState('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef(null)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const current = slides[slide]
  const isTeacher = user?.role === 'teacher'
  const visibleListings = useMemo(() => listings.filter((item) => {
    const searchableLocation = `${item.category} ${item.location}`.toLowerCase()
    return !location ||
      (location === 'online' && searchableLocation.includes('online')) ||
      (location === 'dhaka' && searchableLocation.includes('dhaka')) ||
      (location === 'offline' && item.category.toLowerCase() === 'offline batch')
  }), [listings, location])
  const featuredFaculty = useMemo(() => {
    const teachers = new Map()
    for (const listing of listings) {
      const name = listing.teacherName || 'TeachOS teacher'
      const teacher = teachers.get(name) || { name, listings: [] }
      teacher.listings.push(listing)
      teachers.set(name, teacher)
    }
    return [...teachers.values()].slice(0, 4)
  }, [listings])

  useEffect(() => {
    const timer = setInterval(() => setSlide((value) => (value + 1) % slides.length), 8000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(async () => {
      setListingsLoading(true)
      setListingsError('')
      try {
        const hasFilters = searchTerm.trim() || category
        const { data } = hasFilters
          ? await api.get('/listings', { params: { search: searchTerm.trim(), category: category || undefined, page: 1, limit: 20 } })
          : await api.get('/listings/latest', { params: { count: 6 } })
        if (current) setListings(data.listings || [])
      } catch (requestError) {
        if (current) setListingsError(requestError.response?.data?.message || 'Could not load course listings. Check that the API and database are available.')
      } finally {
        if (current) setListingsLoading(false)
      }
    }, 180)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [searchTerm, category, listingsReload])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedListing(null)
        setSelectedFaculty(null)
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
    setCategory((currentCategory) => value === currentCategory ? '' : value)
    window.setTimeout(scrollToListings, 0)
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
          <form className="home-search" onSubmit={submitSearch}><FiSearch /><input aria-label="Search courses" placeholder="Search courses, batches..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /></form>
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
        <SearchPanel searchTerm={searchTerm} setSearchTerm={setSearchTerm} category={category} setCategory={setCategory} location={location} setLocation={setLocation} submitSearch={submitSearch} />
      </section>

      <section className="stat-strip" aria-label="TeachOS features">{[['Public listings', 'Browse published courses', <FiBookOpen key="courses" />], ['Teacher workspace', 'Classes and attendance', <FiShield key="teachers" />], ['Transparent pricing', 'Course fees shown in taka', <FiTag key="pricing" />], ['Learning modes', 'Online and in-person', <FiGlobe key="modes" />]].map(([value, label, icon]) => <div key={label}><span>{icon}</span><div><b>{value}</b><small>{label}</small></div></div>)}</section>
      <CategorySection selected={category} onSelect={applyCategory} />
      <section className="home-section" id="listings"><SectionIntro eyebrow="Live from TeachOS" title="Featured courses & batches" copy="Browse the latest courses published by TeachOS teachers. Select a listing to see its details." link="Clear filters" onLink={() => { setCategory(''); setLocation(''); setSearchTerm('') }} /><div className="active-filters">{category && <button type="button" onClick={() => setCategory('')}>{category} <FiX /></button>}{location && <button type="button" onClick={() => setLocation('')}>{location === 'dhaka' ? 'Dhaka' : location === 'online' ? 'Online' : 'Offline'} <FiX /></button>}{searchTerm && <button type="button" onClick={() => setSearchTerm('')}>“{searchTerm}” <FiX /></button>}</div>{listingsLoading ? <div className="home-no-results" role="status">Loading the latest courses from TeachOS...</div> : listingsError ? <div className="home-no-results" role="alert"><FiX /><h3>Listings are temporarily unavailable</h3><p>{listingsError}</p><button className="home-secondary" type="button" onClick={() => setListingsReload((value) => value + 1)}>Try again</button></div> : <><div className="listing-grid">{visibleListings.map((listing) => <ListingCard key={listing._id} data={listing} onDetails={() => setSelectedListing(listing)} />)}</div>{!visibleListings.length && <div className="home-no-results"><FiSearch /><h3>No matching courses yet</h3><p>Try changing your search or clearing the filters.</p><button className="home-secondary" type="button" onClick={() => { setCategory(''); setLocation(''); setSearchTerm('') }}>Clear filters</button></div>}</>}</section>
      <WhySection />
      <FacultySection teachers={featuredFaculty} onSelect={setSelectedFaculty} />
      <section className="instructor-cta" id="instructor"><div><span className="home-kicker">Instructor partner program</span><h2>Are you an educator? Run your batches with TeachOS.</h2><p>Publish your batch timings, manage student enrollments, take attendance, and track payments in one workspace.</p><div className="cta-perks"><span><FiCheck /> Easy class setup</span><span><FiCheck /> Direct enrollments</span><span><FiCheck /> Attendance tools</span></div></div><div><button className="cta-light" type="button" onClick={handleCreateListing}><FiPlus /> {isTeacher ? 'Manage your classes' : 'Create a teacher account'}</button><a className="cta-dark" href="mailto:support@teachos.example?subject=TeachOS%20teacher%20onboarding">Request onboarding</a></div></section>
    </main>
    <Footer openInfo={setInfoModal} isTeacher={isTeacher} />
    {toast && <div className="home-toast" role="status"><FiCheck /><span>{toast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}><FiX /></button></div>}
    {selectedListing && <ListingModal listing={selectedListing} close={() => setSelectedListing(null)} />}
    {selectedFaculty && <FacultyModal teacher={selectedFaculty} close={() => setSelectedFaculty(null)} onSelectListing={(listing) => { setSelectedFaculty(null); setSelectedListing(listing) }} />}
    {infoModal && <InfoModal title={infoModal} close={() => setInfoModal('')} />}
  </div>
}

function SearchPanel({ searchTerm, setSearchTerm, category, setCategory, location, setLocation, submitSearch }) {
  return <form className="search-panel" onSubmit={submitSearch}>
    <div><label htmlFor="course-category"><FiBookOpen /> Program category</label><select id="course-category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All academic categories</option>{categories.map(([name]) => <option key={name}>{name}</option>)}</select></div>
    <div><label htmlFor="course-location"><FiMapPin /> Location / mode</label><select id="course-location" value={location} onChange={(event) => setLocation(event.target.value)}><option value="">Online &amp; all locations</option><option value="online">Online</option><option value="offline">Offline batches</option><option value="dhaka">Dhaka</option></select></div>
    <div><label htmlFor="course-keyword"><FiSearch /> Keyword or teacher</label><input id="course-keyword" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="e.g. HSC Physics, IELTS, Python..." /></div>
    <button className="home-primary" type="submit"><FiSearch /> Search</button>
  </form>
}

function SectionIntro({ eyebrow, title, copy, link, onLink }) {
  return <div className="section-intro"><div><span className="section-kicker">{eyebrow}</span><h2>{title}</h2><p>{copy}</p></div>{link && <button type="button" onClick={onLink}>{link} <FiArrowRight /></button>}</div>
}

function CategorySection({ selected, onSelect }) {
  return <section className="home-section" id="categories"><SectionIntro eyebrow="Explore academic pathways" title="Find a learning path that fits" copy="Browse live cohorts, local coaching, exam preparation, and practical skill courses." link="View courses" onLink={() => document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' })} /><div className="category-grid">{categories.map(([title, copy, icon, count]) => <button type="button" className={`category-card${selected === title ? ' selected' : ''}`} onClick={() => onSelect(title)} key={title}><div className="category-icon">{icon}</div><span>{count}</span><h3>{title}</h3><p>{copy}</p><b>Explore pathway <FiArrowRight /></b></button>)}</div></section>
}

function ListingCard({ data, onDetails }) {
  const teacherName = data.teacherName || 'TeachOS teacher'
  const categoryClass = data.category?.toLowerCase().includes('exam') ? 'tertiary' : data.category?.toLowerCase().includes('offline') ? 'secondary' : 'primary'
  const startDate = data.startDate ? new Date(data.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Flexible start'
  return <article className="listing-card">{data.image && <img className="listing-image" src={data.image} alt="" loading="lazy" />}<div className="listing-top"><span className={`listing-type ${categoryClass}`}>{data.category}</span><span className="listing-badge">{data.duration}</span></div><h3>{data.name}</h3><p className="listing-location"><FiMapPin /> {data.location}</p><div className="teacher"><span>{teacherName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span><div><b>{teacherName} <FiCheck /></b><small>{data.email || 'Verified TeachOS educator'}</small></div></div><div className="listing-meta"><span><FiBookOpen /> Starts: {startDate}</span></div><div className="listing-footer"><div><small>Course fee</small><strong>{data.fee ? `৳${Number(data.fee).toLocaleString('en-BD')}` : 'Free'}</strong></div><button type="button" onClick={onDetails}>See details</button></div></article>
}

function ListingModal({ listing, close }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])
  return <div className="home-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-labelledby="listing-modal-title"><button className="home-modal-close" type="button" onClick={close} aria-label="Close course details"><FiX /></button><span className="listing-type">{listing.category}</span><h2 id="listing-modal-title">{listing.name}</h2><p>{listing.duration} · Starts {listing.startDate ? new Date(listing.startDate).toLocaleDateString() : 'flexibly'}</p><div className="home-modal-facts"><span><FiMapPin /> {listing.location}</span><span><FiBriefcase /> {listing.teacherName || 'TeachOS teacher'}</span><span><FiTag /> {listing.fee ? `৳${Number(listing.fee).toLocaleString('en-BD')}` : 'Free course'}</span></div><p className="home-modal-note">{listing.description}</p><div className="home-modal-actions"><Link className="home-primary" to="/register">Continue to enrollment <FiArrowRight /></Link><button className="home-secondary" type="button" onClick={close}>Keep browsing</button></div></section></div>
}

function WhySection() {
  const reasons = [['Direct teacher connection', 'Connect with verified mentors and see course fees before you enroll.', <FiTag key="markup" />], ['Verified credentials', 'Learn from educators whose experience and qualifications are reviewed.', <FiShield key="credentials" />], ['Flexible learning modes', 'Compare online classes and nearby in-person learning options.', <FiGlobe key="nearby" />], ['Student-first choices', 'Browse clear course details and select the learning path that works for you.', <FiStar key="reviews" />]]
  return <section className="why-section" id="standards"><SectionIntro eyebrow="The TeachOS advantage" title="A clearer way to find your next class" copy="Bring course discovery, teacher information, and classroom tools together in one learning workspace." /><div className="reason-grid">{reasons.map(([title, copy, icon]) => <article key={title}><span>{icon}</span><h3>{title}</h3><p>{copy}</p><b>TeachOS standard</b></article>)}</div><div className="trust-strip"><FiShield /><b>Learning built on clarity and trust</b><span>Verified educators · Transparent details · Student-first tools</span></div></section>
}

function FacultySection({ teachers, onSelect }) {
  return <section className="home-section" id="faculty"><SectionIntro eyebrow="Academic mentorship" title="Teachers behind published courses" copy="Browse educators who have published courses or batches on TeachOS." link="Browse courses" onLink={() => document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' })} />{teachers.length ? <div className="faculty-grid">{teachers.map((teacher, index) => {
    const categoriesForTeacher = [...new Set(teacher.listings.map((item) => item.category))]
    return <article className="faculty-card" key={teacher.name}><div className={`faculty-avatar avatar-${index}`}>{teacher.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><h3>{teacher.name}</h3><b>{categoriesForTeacher.join(' · ')}</b><p>TeachOS published listings</p><div><span><strong>{teacher.listings.length}</strong>{teacher.listings.length === 1 ? 'Listing' : 'Listings'}</span><span><strong>{categoriesForTeacher.length}</strong>{categoriesForTeacher.length === 1 ? 'Category' : 'Categories'}</span></div><button type="button" onClick={() => onSelect(teacher)}>View courses</button></article>
  })}</div> : <div className="home-no-results"><FiUsers /><h3>No teacher listings to show yet</h3><p>Teacher profiles appear here when their courses are published.</p></div>}</section>
}

function FacultyModal({ teacher, close, onSelectListing }) {
  return <div className="home-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-labelledby="faculty-modal-title"><button className="home-modal-close" type="button" onClick={close} aria-label="Close educator profile"><FiX /></button><span className="section-kicker">TeachOS teacher</span><h2 id="faculty-modal-title">{teacher.name}</h2><p>{[...new Set(teacher.listings.map((item) => item.category))].join(' · ')}</p><div className="home-modal-facts"><span><FiBookOpen /> {teacher.listings.length} published {teacher.listings.length === 1 ? 'listing' : 'listings'}</span>{teacher.listings.map((listing) => <span key={listing._id}><FiTag /> {listing.name}</span>)}</div><div className="home-modal-actions"><button className="home-primary" type="button" onClick={() => onSelectListing(teacher.listings[0])}>View course details <FiArrowRight /></button><button className="home-secondary" type="button" onClick={close}>Close profile</button></div></section></div>
}

function InfoModal({ title, close }) {
  return <div className="home-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-labelledby="info-modal-title"><button className="home-modal-close" type="button" onClick={close} aria-label="Close information"><FiX /></button><span className="section-kicker">TeachOS information</span><h2 id="info-modal-title">{title}</h2><p>TeachOS helps students discover educators and learning programs, and gives teachers workspace tools to manage classes and attendance.</p><div className="home-modal-actions"><a className="home-primary" href="mailto:support@teachos.example">Contact support <FiArrowRight /></a><button className="home-secondary" type="button" onClick={close}>Close</button></div></section></div>
}

function Footer({ openInfo, isTeacher }) {
  return <footer className="home-footer"><div className="footer-grid"><div><Link className="home-logo" to="/"><span className="home-logo-mark">T</span><strong>Teach<span>OS</span></strong></Link><p>Find courses and teachers, or manage your teaching workspace with TeachOS.</p></div><div><b>Platform</b><a href="#listings">Courses &amp; batches</a><a href="#categories">Explore categories</a><a href="#instructor">Teach on TeachOS</a></div><div><b>Organization</b><button type="button" onClick={() => openInfo('About TeachOS')}>About TeachOS</button><a href="mailto:support@teachos.example">Contact support</a><Link to={isTeacher ? '/dashboard' : '/login'}>Teacher portal</Link></div><div><b>Academic standards</b><button type="button" onClick={() => openInfo('Terms of service')}>Terms of service</button><button type="button" onClick={() => openInfo('Privacy policy')}>Privacy policy</button><a href="#standards">Learning standards</a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} TeachOS · Learning starts here.</span><span><i /> TeachOS learning workspace</span></div></footer>
}

export default Home
