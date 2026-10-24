import { useEffect, useMemo, useRef, useState } from 'react'
import { FiArrowRight, FiBell, FiBookOpen, FiBriefcase, FiCheck, FiChevronDown, FiChevronLeft, FiChevronRight, FiCode, FiGlobe, FiGrid, FiLogOut, FiMapPin, FiMenu, FiMonitor, FiPlus, FiSearch, FiShield, FiStar, FiTag, FiUser, FiUsers, FiX } from 'react-icons/fi'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import '../styles/home.css'

const slides = [
  { eyebrow: 'Enrollment open · 2026', title: <>Learn from the best teachers, <span>online or offline.</span></>, copy: 'Discover accredited masterclasses, focused coaching centers, and verified local mentors. Find the right learning path for your goals.', cta: 'Explore courses & batches', image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=85', label: 'Structured coaching & direct mentorship' },
  { eyebrow: 'One connected learning space', title: <>One platform for every <span>course and batch.</span></>, copy: 'From board examinations to tech bootcamps, find physical classrooms and live online cohorts in one place.', cta: 'Browse all categories', image: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=900&q=85', label: 'Physical & hybrid learning modes' },
  { eyebrow: 'Quality-first learning', title: <>Every student deserves <span>the right teacher.</span></>, copy: 'Compare schedules, fees, and verified instructors to choose learning that works for you.', cta: 'Find your teacher', image: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=900&q=85', label: 'One-to-one & small group batches' },
]

const listings = [
  ['Offline batch', 'Free trial available', 'HSC Physics 2026 Batch A', 'Savar, Dhaka (Near City Center)', 'Dr. K. Rahman', 'Ph.D. BUET · 14y Exp', '1,500 BDT', 'Monthly fee', '4.95', 'secondary', '10 Nov'],
  ['Online course', 'Cohort #12', 'Next.js & Fullstack React Bootcamp', '100% Online (Live Interactive)', 'Eng. Anisul Haque', 'Principal Dev · Ex-Grab', '3,200 BDT', 'One-time tuition', '4.98', 'primary', '15 Nov'],
  ['Exam preparation', '4 seats left', 'IELTS Academic Masterclass 8.0+', 'Dhanmondi, Dhaka & Online Hybrid', 'Sarah Jenkins, CELTA', 'Band 9.0 · British Council Trainer', '4,500 BDT', 'Complete course', '4.91', 'tertiary', '08 Nov'],
  ['Offline batch', 'Evening slot', 'Class 10 General Math Foundation', 'Mirpur-10, Dhaka (Metro Station Gate)', 'Master M. Hossain', 'M.Sc Applied Math · 18y Exp', '1,200 BDT', 'Monthly fee', '4.89', 'secondary', '12 Nov'],
  ['Skill course', 'Free trial available', 'Python & AI for Absolute Beginners', 'Online Zoom Batches (Weekend)', 'Tanvir Ahmed', 'ML Engineer · AI Researcher', 'Free access', 'Trial class first', '4.97', 'primary', '20 Nov'],
  ['Exam preparation', 'Intensive question bank', 'Medical Admission Biology Drill', 'Farmgate, Dhaka (Science Academic Point)', 'Dr. Nusrat Jahan', 'MBBS (DMC) · Biology Specialist', '2,800 BDT', 'Course bundle', '4.94', 'tertiary', '05 Nov'],
]

const faculty = [
  ['Prof. Tanvir Morshed', 'Physics & advanced mechanics', '3,400+', '4.96'],
  ['Dr. Sabina Yasmin', 'Higher math & calculus', '4,120+', '4.98'],
  ['Mahmudul Hasan', 'Software engineering', '2,850+', '4.94'],
  ['Ayesha Siddiqa', 'Medical biology & genetics', '5,200+', '4.99'],
]

const categories = [
  ['Online course', 'Live interactive classes, whiteboard recordings, and synchronized batch discussions.', <FiMonitor key="online" />, '340+ live'],
  ['Offline batch', 'Physical classroom seating, neighborhood coaching centers, and laboratory drills.', <FiBookOpen key="offline" />, '210+ batches'],
  ['Exam preparation', 'Targeted drills for HSC, BCS, IELTS, SAT, and admission exams.', <FiCheck key="exam" />, '180+ programs'],
  ['Skill course', 'Practical capabilities in web development, data science, English, and design.', <FiCode key="skill" />, '120+ tracks'],
]

function Home() {
  const [slide, setSlide] = useState(0)
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [category, setCategory] = useState('')
  const [location, setLocation] = useState('')
  const [selectedListing, setSelectedListing] = useState(null)
  const [selectedFaculty, setSelectedFaculty] = useState(null)
  const [infoModal, setInfoModal] = useState('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef(null)
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const current = slides[slide]
  const isTeacher = user?.role === 'teacher'
  const visibleListings = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return listings.filter((item) => {
      const matchesQuery = !query || item.slice(0, 8).join(' ').toLowerCase().includes(query)
      const matchesCategory = !category || item[0] === category
      const searchableLocation = `${item[0]} ${item[3]}`.toLowerCase()
      const matchesLocation = !location ||
        (location === 'online' && searchableLocation.includes('online')) ||
        (location === 'dhaka' && searchableLocation.includes('dhaka')) ||
        (location === 'offline' && item[0] === 'Offline batch')
      return matchesQuery && matchesCategory && matchesLocation
    })
  }, [searchTerm, category, location])

  useEffect(() => {
    const timer = setInterval(() => setSlide((value) => (value + 1) % slides.length), 8000)
    return () => clearInterval(timer)
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
    setCategory(value === category ? '' : value)
    window.setTimeout(scrollToListings, 0)
  }
  const submitSearch = (event) => {
    event.preventDefault()
    scrollToListings()
  }
  const createListing = () => navigate(isTeacher ? '/dashboard/classes' : user ? '/' : '/register')
  const handleCreateListing = () => {
    if (user && !isTeacher) {
      setToast('Batch listings are available to teacher accounts.')
      return
    }
    createListing()
  }
  const dashboardPath = user?.role === 'admin' ? '/admin' : user?.role === 'teacher' ? '/dashboard' : null
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
          <Link to={isTeacher ? '/dashboard/classes' : user ? '/login' : '/register'} onClick={() => setMobileNav(false)}>My listings</Link>
          <a href="#listings" onClick={() => { setMobileNav(false); setToast(user ? 'Choose a course to view enrollment options.' : 'Sign in or create an account to get started.') }}>My enrollments</a>
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

      <section className="stat-strip" aria-label="TeachOS at a glance">{[['12,500+', 'Active students', <FiUsers key="students" />], ['850+', 'Verified teachers', <FiShield key="teachers" />], ['4.9 / 5', 'Average rating', <FiStar key="rating" />], ['100% direct', 'No middlemen', <FiBriefcase key="direct" />]].map(([value, label, icon]) => <div key={label}><span>{icon}</span><div><b>{value}</b><small>{label}</small></div></div>)}</section>
      <CategorySection selected={category} onSelect={applyCategory} />
      <section className="home-section" id="listings"><SectionIntro eyebrow="Browse available learning" title="Featured courses & batches" copy="Explore the current course collection. Choose a listing to see its schedule, instructor, and enrollment details." link="Clear filters" onLink={() => { setCategory(''); setLocation(''); setSearchTerm('') }} /><div className="active-filters">{category && <button type="button" onClick={() => setCategory('')}>{category} <FiX /></button>}{location && <button type="button" onClick={() => setLocation('')}>{location === 'dhaka' ? 'Dhaka' : location === 'online' ? 'Online' : 'Offline'} <FiX /></button>}{searchTerm && <button type="button" onClick={() => setSearchTerm('')}>“{searchTerm}” <FiX /></button>}</div><div className="listing-grid">{visibleListings.map((listing) => <ListingCard key={listing[2]} data={listing} onDetails={() => setSelectedListing(listing)} />)}</div>{!visibleListings.length && <div className="home-no-results"><FiSearch /><h3>No matching courses yet</h3><p>Try changing your search or clearing the filters.</p><button className="home-secondary" type="button" onClick={() => { setCategory(''); setLocation(''); setSearchTerm('') }}>Clear filters</button></div>}</section>
      <WhySection />
      <FacultySection onSelect={setSelectedFaculty} />
      <section className="instructor-cta" id="instructor"><div><span className="home-kicker">Instructor partner program</span><h2>Are you an educator? Run your batches with TeachOS.</h2><p>Publish your batch timings, manage student enrollments, take attendance, and track payments in one workspace.</p><div className="cta-perks"><span><FiCheck /> Easy class setup</span><span><FiCheck /> Direct enrollments</span><span><FiCheck /> Attendance tools</span></div></div><div><button className="cta-light" type="button" onClick={handleCreateListing}><FiPlus /> {isTeacher ? 'Manage your classes' : 'Create a teacher account'}</button><a className="cta-dark" href="mailto:support@teachos.example?subject=TeachOS%20teacher%20onboarding">Request onboarding</a></div></section>
    </main>
    <Footer openInfo={setInfoModal} isTeacher={isTeacher} />
    {toast && <div className="home-toast" role="status"><FiCheck /><span>{toast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}><FiX /></button></div>}
    {selectedListing && <ListingModal listing={selectedListing} close={() => setSelectedListing(null)} />}
    {selectedFaculty && <FacultyModal teacher={selectedFaculty} close={() => setSelectedFaculty(null)} />}
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
  return <article className="listing-card"><div className="listing-top"><span className={`listing-type ${data[9]}`}>{data[0]}</span><span className="listing-badge">{data[1]}</span></div><h3>{data[2]}</h3><p className="listing-location"><FiMapPin /> {data[3]}</p><div className="teacher"><span>{data[4].split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><div><b>{data[4]} <FiCheck /></b><small>{data[5]}</small></div></div><div className="listing-meta"><span><FiBookOpen /> Starts: {data[10]}</span><span><FiStar /> {data[8]}</span></div><div className="listing-footer"><div><small>{data[7]}</small><strong>{data[6]}</strong></div><button type="button" onClick={onDetails}>See details</button></div></article>
}

function ListingModal({ listing, close }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])
  return <div className="home-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-labelledby="listing-modal-title"><button className="home-modal-close" type="button" onClick={close} aria-label="Close course details"><FiX /></button><span className={`listing-type ${listing[9]}`}>{listing[0]}</span><h2 id="listing-modal-title">{listing[2]}</h2><p>{listing[1]} · Starts {listing[10]}</p><div className="home-modal-facts"><span><FiMapPin /> {listing[3]}</span><span><FiBriefcase /> {listing[4]} · {listing[5]}</span><span><FiStar /> {listing[8]} student rating</span><span><FiTag /> {listing[6]} · {listing[7]}</span></div><p className="home-modal-note">Create an account to contact the instructor and continue with enrollment.</p><div className="home-modal-actions"><Link className="home-primary" to="/register">Continue to enrollment <FiArrowRight /></Link><button className="home-secondary" type="button" onClick={close}>Keep browsing</button></div></section></div>
}

function WhySection() {
  const reasons = [['Direct teacher connection', 'Connect with verified mentors and see course fees before you enroll.', <FiTag key="markup" />], ['Verified credentials', 'Learn from educators whose experience and qualifications are reviewed.', <FiShield key="credentials" />], ['Flexible learning modes', 'Compare online classes and nearby in-person learning options.', <FiGlobe key="nearby" />], ['Student-first choices', 'Browse clear course details and select the learning path that works for you.', <FiStar key="reviews" />]]
  return <section className="why-section" id="standards"><SectionIntro eyebrow="The TeachOS advantage" title="A clearer way to find your next class" copy="Bring course discovery, teacher information, and classroom tools together in one learning workspace." /><div className="reason-grid">{reasons.map(([title, copy, icon]) => <article key={title}><span>{icon}</span><h3>{title}</h3><p>{copy}</p><b>TeachOS standard</b></article>)}</div><div className="trust-strip"><FiShield /><b>Learning built on clarity and trust</b><span>Verified educators · Transparent details · Student-first tools</span></div></section>
}

function FacultySection({ onSelect }) {
  return <section className="home-section" id="faculty"><SectionIntro eyebrow="Academic mentorship" title="Meet featured educators" copy="Explore instructors across sciences, mathematics, software, and medicine." link="Browse courses" onLink={() => document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' })} /><div className="faculty-grid">{faculty.map((teacher, index) => <article className="faculty-card" key={teacher[0]}><div className={`faculty-avatar avatar-${index}`}>{teacher[0].split(' ').map((part) => part[0]).join('').slice(0, 2)}</div><h3>{teacher[0]}</h3><b>{teacher[1]}</b><p>Featured educator · {index + 9}+ yrs experience</p><div><span><strong>{teacher[2]}</strong>Students</span><span><strong>{teacher[3]}</strong>Rating</span></div><button type="button" onClick={() => onSelect(teacher)}>View profile &amp; courses</button></article>)}</div></section>
}

function FacultyModal({ teacher, close }) {
  return <div className="home-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-labelledby="faculty-modal-title"><button className="home-modal-close" type="button" onClick={close} aria-label="Close educator profile"><FiX /></button><span className="section-kicker">Featured educator</span><h2 id="faculty-modal-title">{teacher[0]}</h2><p>{teacher[1]}</p><div className="home-modal-facts"><span><FiUsers /> {teacher[2]} students reached</span><span><FiStar /> {teacher[3]} average rating</span><span><FiCheck /> TeachOS featured educator</span></div><div className="home-modal-actions"><Link className="home-primary" to="/register">Explore learning on TeachOS <FiArrowRight /></Link><button className="home-secondary" type="button" onClick={close}>Close profile</button></div></section></div>
}

function InfoModal({ title, close }) {
  return <div className="home-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className="home-detail-modal" role="dialog" aria-modal="true" aria-labelledby="info-modal-title"><button className="home-modal-close" type="button" onClick={close} aria-label="Close information"><FiX /></button><span className="section-kicker">TeachOS information</span><h2 id="info-modal-title">{title}</h2><p>TeachOS helps students discover educators and learning programs, and gives teachers workspace tools to manage classes and attendance.</p><div className="home-modal-actions"><a className="home-primary" href="mailto:support@teachos.example">Contact support <FiArrowRight /></a><button className="home-secondary" type="button" onClick={close}>Close</button></div></section></div>
}

function Footer({ openInfo, isTeacher }) {
  return <footer className="home-footer"><div className="footer-grid"><div><Link className="home-logo" to="/"><span className="home-logo-mark">T</span><strong>Teach<span>OS</span></strong></Link><p>Find courses and teachers, or manage your teaching workspace with TeachOS.</p></div><div><b>Platform</b><a href="#listings">Courses &amp; batches</a><a href="#categories">Explore categories</a><a href="#instructor">Teach on TeachOS</a></div><div><b>Organization</b><button type="button" onClick={() => openInfo('About TeachOS')}>About TeachOS</button><a href="mailto:support@teachos.example">Contact support</a><Link to={isTeacher ? '/dashboard' : '/login'}>Teacher portal</Link></div><div><b>Academic standards</b><button type="button" onClick={() => openInfo('Terms of service')}>Terms of service</button><button type="button" onClick={() => openInfo('Privacy policy')}>Privacy policy</button><a href="#standards">Learning standards</a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} TeachOS · Learning starts here.</span><span><i /> TeachOS learning workspace</span></div></footer>
}

export default Home
