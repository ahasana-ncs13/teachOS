import { useState } from 'react'
import { FiArrowLeft, FiBook, FiCreditCard, FiFileText, FiGrid, FiHelpCircle, FiMenu, FiSearch, FiSettings, FiUsers, FiX } from 'react-icons/fi'
import { Link, NavLink } from 'react-router-dom'
import NotificationCenter from '../../components/NotificationCenter'
import '../../styles/admin.css'

const navItems = [
  { label: 'Dashboard', to: '/admin', icon: FiGrid },
  { label: 'Classes', to: '/admin/classes', icon: FiBook },
  { label: 'Directory', to: '/admin/directory', icon: FiUsers },
  { label: 'Records', to: '/admin/records', icon: FiFileText },
  { label: 'Payments', to: '/admin/payments', icon: FiCreditCard },
]

export default function AdminLayout({ title, subtitle, children }) {
  const [open, setOpen] = useState(false)

  return <div className="admin-shell">
    <aside className={open ? 'admin-sidebar open' : 'admin-sidebar'}>
      <Link className="admin-logo" to="/"><span className="admin-logo-mark">T</span><strong>Teach<span>OS</span></strong><small>Admin</small></Link>

      <nav className="admin-nav" aria-label="Admin navigation">
        {navItems.map(({ label, to, icon: Icon, built = true }) => built
          ? <NavLink key={label} to={to} end className={({ isActive }) => isActive ? 'admin-nav-item active' : 'admin-nav-item'} onClick={() => setOpen(false)}><Icon /> {label}</NavLink>
          : <button key={label} className="admin-nav-item" disabled title="Coming soon"><Icon /> {label}<em>Soon</em></button>)}
      </nav>

      <div className="admin-sidebar-foot">
        <div className="admin-sidebar-actions">
          <NavLink className={({ isActive }) => isActive ? 'admin-nav-item active' : 'admin-nav-item'} to="/admin/settings" onClick={() => setOpen(false)}><FiSettings /> Settings</NavLink>
          <button className="admin-nav-item" disabled><FiHelpCircle /> Support<em>Soon</em></button>
        </div>
        <div className="admin-term"><b>Admin portal</b>Academic term 2026-27</div>
        <Link className="admin-site-link" to="/"><FiArrowLeft /> Back to TeachOS</Link>
      </div>
    </aside>
    <div className={open ? 'admin-backdrop open' : 'admin-backdrop'} onClick={() => setOpen(false)} />

    <div className="admin-main">
      <header className="admin-topbar">
        <div className="admin-title">
          <button className="admin-icon-btn admin-menu-btn" onClick={() => setOpen(!open)} aria-label="Toggle navigation">{open ? <FiX /> : <FiMenu />}</button>
          <div><h1>{title}</h1><p>{subtitle}</p></div>
        </div>
        <div className="admin-tools">
          <div className="admin-search"><FiSearch /><input aria-label="Search" placeholder="Search teachers, batches..." /></div>
          <NotificationCenter />
          <span className="admin-avatar">A</span>
        </div>
      </header>
      <main className="admin-content">{children}</main>
    </div>
  </div>
}
