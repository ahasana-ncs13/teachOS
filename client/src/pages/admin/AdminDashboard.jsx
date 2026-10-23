import { useState } from 'react'
import { FiAward, FiArrowRight, FiArrowUp, FiBriefcase, FiCheck, FiChevronRight, FiCreditCard, FiFileText, FiFilter, FiInfo, FiPieChart, FiTrendingUp, FiUserPlus, FiUsers, FiX } from 'react-icons/fi'
import AdminLayout from './AdminLayout'

const COMMISSION_RATE = 0.05

// Sample data. Replace with API data once the backend is ready.
const teachers = [
  { id: 1, name: 'Dr. K. Rahman', department: 'Physics', earned: 42000, status: 'paid' },
  { id: 2, name: 'Eng. Anisul Haque', department: 'Computer Science', earned: 58500, status: 'processing' },
  { id: 3, name: 'Sarah Jenkins', department: 'English (IELTS)', earned: 31500, status: 'paid' },
  { id: 4, name: 'Master M. Hossain', department: 'Mathematics', earned: 49000, status: 'failed' },
  { id: 5, name: 'Dr. Nusrat Jahan', department: 'Biology', earned: 24000, status: 'paid' },
]

const avatarClasses = ['avatar-a', 'avatar-b', 'avatar-c', 'avatar-d', 'avatar-a']
const taka = (n) => `৳${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const initials = (name) => name.replace(/^(Dr\.|Eng\.|Prof\.)\s*/, '').split(' ').map((part) => part[0]).join('').slice(0, 2)

export default function AdminDashboard() {
  const [filter, setFilter] = useState('all')
  const [toast, setToast] = useState('')
  const rows = filter === 'all' ? teachers : teachers.filter((teacher) => teacher.status === filter)

  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 4200) }

  const actions = [
    { label: 'Process payouts', icon: FiCreditCard, message: 'Payouts will be available once payments are connected.' },
    { label: 'Onboard teacher', icon: FiUserPlus, message: 'Teacher onboarding will be available once accounts are connected.' },
    { label: 'Generate tax report', icon: FiFileText, message: 'Reports will be available once earnings are saved in the database.' },
  ]
 
  return <AdminLayout
   title="Overview" subtitle="Platform performance & financials">
    <section className="admin-stats">
      <div className="admin-stat">
        <div className="admin-stat-top"><span className="admin-stat-icon blue"><FiBriefcase /></span><span className="admin-badge">YTD</span></div>
        <p>Total platform earnings</p><strong>৳1.2M</strong>
        <small><FiTrendingUp /> +12.5% vs last month</small>
      </div>
      <div className="admin-stat dark">
        <div className="admin-stat-top"><span className="admin-stat-icon glass"><FiPieChart /></span><span className="admin-badge">5% comm.</span></div>
        <p>Admin profit</p><strong>৳60,000</strong>
        <small><FiArrowUp /> +৳4,500 this week</small>
      </div>
      <div className="admin-stat">
        <div className="admin-stat-top"><span className="admin-stat-icon green"><FiAward /></span></div>
        <p>Active teachers</p><strong>342</strong>
        <small>Across 12 departments</small>
      </div>
      <div className="admin-stat">
        <div className="admin-stat-top"><span className="admin-stat-icon orange"><FiUsers /></span></div>
        <p>Total students</p><strong>8,405</strong>
        <small><FiTrendingUp /> +5% growth</small>
      </div>
    </section>

    <section className="admin-grid">
      <div className="admin-panel">
        <div className="admin-panel-head">
          <div><span className="admin-kicker">Payout cycle</span><h2>Teacher earnings breakdown</h2><p>Recent payouts and commission calculations.</p></div>
          <label className="admin-filter"><FiFilter /><select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status"><option value="all">All statuses</option><option value="paid">Paid</option><option value="processing">Processing</option><option value="failed">Failed</option></select></label>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Teacher name</th><th>Department</th><th className="num">Total earned</th><th className="num">Admin comm. (5%)</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((teacher, index) => <tr key={teacher.id}>
                <td><div className="admin-teacher"><span className={avatarClasses[index % avatarClasses.length]}>{initials(teacher.name)}</span>{teacher.name}</div></td>
                <td>{teacher.department}</td>
                <td className="num strong">{taka(teacher.earned)}</td>
                <td className="num comm">{taka(teacher.earned * COMMISSION_RATE)}</td>
                <td><span className={`status ${teacher.status}`}>{teacher.status}</span></td>
              </tr>)}
              {rows.length === 0 && <tr><td className="admin-empty" colSpan={5}>No teachers have this status. Choose another filter.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="admin-panel-foot"><button className="admin-link-btn" onClick={() => notify('The full records page is not built yet.')}>View all records <FiArrowRight /></button></div>
      </div>

      <aside className="admin-side">
        <div className="admin-side-card">
          <h2>Quick actions</h2>
          <div className="admin-actions">
            {actions.map(({ label, icon: Icon, message }) => <button key={label} className="admin-action" onClick={() => notify(message)}><span><Icon /> {label}</span><FiChevronRight /></button>)}
          </div>
        </div>
        <div className="admin-notice"><FiInfo /><div><b>System update scheduled</b><p>The payment gateway will be under maintenance on Sunday at 2 AM. Expect minor delays in payouts.</p></div></div>
      </aside>
    </section>

    {toast && <div className="admin-toast"><FiCheck /><span>{toast}</span><button onClick={() => setToast('')} aria-label="Close"><FiX /></button></div>}
  </AdminLayout>
}