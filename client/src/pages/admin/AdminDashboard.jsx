import { useEffect, useState } from 'react'
import { FiAward, FiBookOpen, FiBriefcase, FiCreditCard, FiInfo, FiUsers } from 'react-icons/fi'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import AdminLayout from './AdminLayout'

const taka = (value) => `৳${Number(value || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    api.get('/admin/overview').then(({ data }) => {
      if (current) setOverview(data.overview)
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load platform data.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [])

  const stats = overview ? [
    { label: 'Platform commission this month', value: taka(overview.monthlyCommission?.commissionAmount), detail: `${overview.monthlyCommission?.month || 'Current month'} · 5% of confirmed live BDT payments`, icon: FiBriefcase },
    { label: 'Pending payouts', value: taka(overview.pendingPayouts), detail: 'Awaiting review', icon: FiCreditCard },
    { label: 'Active teachers', value: overview.teachers.toLocaleString(), detail: 'Registered teacher accounts', icon: FiAward },
    { label: 'Students', value: overview.students.toLocaleString(), detail: 'Registered student accounts', icon: FiUsers },
  ] : []

  return <AdminLayout title="Overview" subtitle="Platform data from TeachOS database">
    {error && <div className="admin-data-error" role="alert">{error}</div>}
    {loading ? <p className="admin-data-state" role="status">Loading platform data...</p> : overview && <>
      <section className="admin-stats">
        {stats.map(({ label, value, detail, icon: Icon }) => <article className="admin-stat" key={label}>
          <div className="admin-stat-top"><span className="admin-stat-icon blue"><Icon /></span></div>
          <p>{label}</p><strong>{value}</strong><small>{detail}</small>
        </article>)}
      </section>

      <section className="admin-grid">
        <div className="admin-panel">
          <div className="admin-panel-head"><div><span className="admin-kicker">TeachOS database</span><h2>Recently published listings</h2><p>{overview.listings} active listings · {overview.classes} teacher classes</p></div></div>
          {overview.latestListings.length ? <div className="admin-table-wrap"><table className="admin-table">
            <thead><tr><th>Course / batch</th><th>Teacher</th><th>Category</th><th className="num">Fee</th></tr></thead>
            <tbody>{overview.latestListings.map((item) => <tr key={item._id}>
              <td className="strong">{item.name}</td><td>{item.teacherName || 'TeachOS teacher'}</td><td>{item.category}</td><td className="num strong">{item.fee ? taka(item.fee) : 'Free'}</td>
            </tr>)}</tbody>
          </table></div> : <p className="admin-data-state">No published listings yet.</p>}
          <div className="admin-panel-foot"><Link className="admin-link-btn" to="/admin/classes">Manage listings</Link></div>
        </div>

        <aside className="admin-side">
          <div className="admin-side-card"><h2>Platform records</h2><div className="admin-actions">
            <Link className="admin-action" to="/admin/directory"><span><FiUsers /> Manage accounts</span></Link>
            <Link className="admin-action" to="/admin/payments"><span><FiCreditCard /> Review financial records</span></Link>
            <Link className="admin-action" to="/admin/classes"><span><FiBookOpen /> Review course listings</span></Link>
          </div></div>
          <div className="admin-notice"><FiInfo /><div><b>Financial records</b><p>Totals reflect records stored in TeachOS; they do not represent a payment-provider balance or transfer.</p></div></div>
        </aside>
      </section>
    </>}
  </AdminLayout>
}
