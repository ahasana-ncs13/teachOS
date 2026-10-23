import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { FiArrowUpRight, FiBookOpen, FiCheckCircle, FiClock, FiGrid, FiLogOut, FiMenu, FiPlus, FiSearch, FiUsers, FiX } from 'react-icons/fi'
import { Navigate, Route, Routes, Link } from 'react-router-dom'
import { useAuth } from './context/useAuth'
import { api } from './lib/api'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import './App.css'
import AdminDashboard from './pages/admin/AdminDashboard'
function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function ProtectedRoute({ children }) {
  const { user, authLoading } = useAuth()
  if (authLoading) return <div className="route-loading">Restoring your TeachOS session...</div>
  return user ? children : <Navigate to="/login" replace />
}

function Dashboard() {
  const [showMenu, setShowMenu] = useState(false)
  const [showSignIn, setShowSignIn] = useState(false)
  const { user, signIn, signOut, isConfigured } = useAuth()
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm()

  useEffect(() => {
    api.get('/health').catch(() => undefined)
  }, [])

  const onSignIn = async (values) => {
    await signIn(values.email, values.password)
    reset()
    setShowSignIn(false)
  }

  return (
    <div className="app-shell">
      <aside className={showMenu ? 'sidebar is-open' : 'sidebar'}>
        <div className="brand"><span className="brand-mark">T</span><span>teach<span>OS</span></span></div>
        <nav className="main-nav">
          <Link className="nav-item active" to="/dashboard"><FiGrid /> Overview</Link>
          <a className="nav-item" href="#courses"><FiBookOpen /> My courses</a>
          <a className="nav-item" href="#students"><FiUsers /> Students</a>
        </nav>
        <div className="sidebar-footer"><span className="eyebrow">Workspace</span><p>Spring cohort<br /><strong>12 active learners</strong></p></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setShowMenu(!showMenu)}>{showMenu ? <FiX /> : <FiMenu />}</button>
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Overview</strong></div>
          <div className="topbar-actions"><button className="icon-button" aria-label="Search"><FiSearch /></button><div className="avatar">{user?.email?.[0]?.toUpperCase() || 'A'}</div></div>
        </header>

        <section className="content" id="overview">
          <div className="welcome-row"><div><p className="eyebrow">Monday, September 7, 2026</p><h1>Good morning, Alex<span className="accent">.</span></h1><p className="lede">Your classroom is ready when you are.</p></div><button className="primary-button"><FiPlus /> Create course</button></div>
          {!isConfigured && <div className="config-note">Firebase is in demo mode. Add your `VITE_FIREBASE_*` values to enable real authentication.</div>}

          <div className="metric-grid"><Metric icon={<FiBookOpen />} label="Active courses" value="06" trend="+2 this month" /><Metric icon={<FiCheckCircle />} label="Avg. completion" value="78%" trend="+8.4% from last month" /><Metric icon={<FiUsers />} label="Total students" value="128" trend="+14 this month" /><Metric icon={<FiClock />} label="Teaching hours" value="24.5" trend="This week" /></div>

          <div className="section-heading" id="courses"><div><p className="eyebrow">Keep the momentum</p><h2>Continue teaching</h2></div><a href="#courses">View all <FiArrowUpRight /></a></div>
          <div className="course-grid"><CourseCard title="Modern JavaScript" tag="DEVELOPMENT" progress="72%" color="coral" lessons="12 / 16 lessons" /><CourseCard title="Design fundamentals" tag="DESIGN" progress="48%" color="mint" lessons="8 / 18 lessons" /><CourseCard title="Product thinking 101" tag="BUSINESS" progress="31%" color="yellow" lessons="5 / 16 lessons" /></div>

          <div className="bottom-grid"><section className="activity-panel"><div className="section-heading compact"><div><p className="eyebrow">Recent activity</p><h2>Classroom pulse</h2></div><button className="text-button">See activity <FiArrowUpRight /></button></div><Activity name="Jamie Rodriguez" action="completed Modern JavaScript" time="12 min ago" /><Activity name="Morgan Lee" action="joined your Design fundamentals course" time="1 hr ago" /><Activity name="Taylor Kim" action="left a note on Product thinking 101" time="3 hrs ago" /></section><section className="focus-panel"><p className="eyebrow">Your focus</p><h2>Make space<br />for great work.</h2><p>Small, consistent progress compounds into remarkable learning.</p><div className="focus-line"><span style={{ width: '68%' }} /></div><small>68% of weekly goal</small></section></div>
          <button className="auth-button" onClick={() => signOut()}><FiLogOut /> Sign out</button>
        </section>
      </main>

      {showSignIn && <div className="modal-backdrop" onClick={() => setShowSignIn(false)}><div className="auth-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" aria-label="Close sign in" onClick={() => setShowSignIn(false)}><FiX /></button><p className="eyebrow">Welcome back</p><h2>Sign in to teachOS</h2><p className="modal-copy">Pick up where your classroom left off.</p><form onSubmit={handleSubmit(onSignIn)}><label>Email<input type="email" placeholder="you@example.com" {...register('email', { required: 'Email is required' })} />{errors.email && <span className="error">{errors.email.message}</span>}</label><label>Password<input type="password" placeholder="Your password" {...register('password', { required: 'Password is required' })} />{errors.password && <span className="error">{errors.password.message}</span>}</label><button className="primary-button full" disabled={isSubmitting}>{isSubmitting ? 'Signing in...' : 'Continue'}</button></form></div></div>}
    </div>
  )
}

function Metric({ icon, label, value, trend }) { return <article className="metric"><div className="metric-icon">{icon}</div><p>{label}</p><strong>{value}</strong><small>{trend}</small></article> }
function CourseCard({ title, tag, progress, color, lessons }) { return <article className={`course-card ${color}`}><div className="course-art"><span>{tag}</span><FiArrowUpRight /></div><div className="course-body"><h3>{title}</h3><p>{lessons}</p><div className="progress-row"><div className="progress"><span style={{ width: progress }} /></div><strong>{progress}</strong></div></div></article> }
function Activity({ name, action, time }) { return <div className="activity"><div className="mini-avatar">{name.split(' ').map((part) => part[0]).join('')}</div><p><strong>{name}</strong> {action}<small>{time}</small></p><FiArrowUpRight /></div> }

export default App
