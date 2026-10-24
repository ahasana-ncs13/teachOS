import { useMemo, useState } from 'react'
import { FiAlertCircle, FiFilter, FiSearch } from 'react-icons/fi'
import AdminLayout from './AdminLayout'
import { COMMISSION_RATE, formatTaka, getInitials, teacherEarningRecords } from './adminRecords.data'
import '../../styles/admin-records.css'

const avatarClasses = ['avatar-a', 'avatar-b', 'avatar-c', 'avatar-d', 'avatar-a']

export default function AdminRecords() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const filteredRecords = useMemo(() => teacherEarningRecords.filter((record) => (
    (status === 'all' || record.status === status)
    && `${record.name} ${record.department} ${record.status}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [query, status])

  return <AdminLayout title="Teacher records" subtitle="Full teacher earnings breakdown">
    <section className="admin-records-page">
      <header className="records-heading">
        <div><span className="admin-kicker">Earnings ledger</span><h2>All teacher records</h2><p>Review every teacher earning row and its calculated 5% platform commission.</p></div>
        <label className="records-filter"><FiFilter /><select aria-label="Filter records by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="paid">Paid</option><option value="processing">Processing</option><option value="failed">Failed</option></select></label>
      </header>

      <div className="records-demo-note" role="note"><FiAlertCircle /><span>These are sample dashboard records for display only. Payment and payout records are not connected to the database yet.</span></div>

      <label className="records-search"><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teacher or department..." aria-label="Search teacher records" /></label>

      <section className="admin-panel records-table-panel" aria-label="Teacher earnings records">
        <div className="admin-panel-head records-table-title"><div><h2>Teacher earnings</h2><p>{filteredRecords.length} of {teacherEarningRecords.length} sample records</p></div></div>
        {filteredRecords.length ? <div className="admin-table-wrap">
          <table className="admin-table records-table">
            <thead><tr><th>Teacher name</th><th>Department</th><th className="num">Total earned</th><th className="num">Admin commission (5%)</th><th>Status</th></tr></thead>
            <tbody>{filteredRecords.map((record) => <tr key={record.id}>
              <td><div className="admin-teacher"><span className={avatarClasses[(record.id - 1) % avatarClasses.length]}>{getInitials(record.name)}</span>{record.name}</div></td>
              <td>{record.department}</td>
              <td className="num strong">{formatTaka(record.earned)}</td>
              <td className="num comm">{formatTaka(record.earned * COMMISSION_RATE)}</td>
              <td><span className={`status ${record.status}`}>{record.status}</span></td>
            </tr>)}</tbody>
          </table>
        </div> : <div className="records-empty"><FiSearch /><strong>No records found</strong><span>Try a different search or status filter.</span></div>}
      </section>
    </section>
  </AdminLayout>
}
