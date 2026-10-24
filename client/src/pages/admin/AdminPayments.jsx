import { useEffect, useMemo, useState } from 'react'
import { FiArrowDownRight, FiArrowUpRight, FiCheck, FiDownload, FiFilter, FiSearch } from 'react-icons/fi'
import { api } from '../../lib/api'
import AdminLayout from './AdminLayout'
import '../../styles/admin-payments.css'

const taka = (amount) => `৳${Number(Math.abs(amount) || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`
const dateLabel = (record) => {
  const value = record.createdAt || record.date
  return value ? new Intl.DateTimeFormat('en-BD', { dateStyle: 'medium' }).format(new Date(value)) : '—'
}
const csvValue = (value) => `"${String(value).replaceAll('"', '""')}"`

export default function AdminPayments() {
  const [transactions, setTransactions] = useState([])
  const [summary, setSummary] = useState(null)
  const [sampleRecords, setSampleRecords] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    api.get('/admin/payments').then(({ data }) => {
      if (!current) return
      const records = [
        ...(data.payments || []).map((item) => ({ ...item, transactionType: item.type || 'Earning', amount: Number(item.amount) || 0 })),
        ...(data.payouts || []).map((item) => ({ ...item, transactionType: 'Payout request', amount: -(Number(item.amount) || 0) })),
      ].sort((first, second) => new Date(second.createdAt || second.date || 0) - new Date(first.createdAt || first.date || 0))
      setTransactions(records)
      setSummary(data.summary)
      setSampleRecords(records.some((item) => item.isSample))
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load financial records.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [])

  const filteredTransactions = useMemo(() => transactions.filter((record) => (
    (!status || (record.status || '').toLowerCase() === status)
    && `${record.id} ${record.person} ${record.transactionType} ${record.status}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [query, status, transactions])

  const generateReport = () => {
    const rows = [
      ['Date', 'Record ID', 'Teacher', 'Type', 'Amount (BDT)', 'Status'],
      ...filteredTransactions.map((item) => [dateLabel(item), item.id || '', item.person, item.transactionType, item.amount.toFixed(2), item.status || 'recorded']),
    ]
    const content = rows.map((row) => row.map(csvValue).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'teachos-financial-records.csv'
    link.click()
    URL.revokeObjectURL(url)
    setNotice('Downloaded the filtered financial records.')
  }

  return <AdminLayout title="Payments" subtitle="Financial records stored in the TeachOS database">
    <div className="admin-payments">
      <header className="payments-heading"><div><h2>Payments &amp; Financials</h2><p>Recorded earnings and payout requests. No transfers are initiated here.</p></div>
        <button className="payments-primary" type="button" onClick={generateReport} disabled={loading}><FiDownload /> Export CSV</button>
      </header>
      {error && <div className="admin-data-error" role="alert">{error}</div>}
      {sampleRecords && <p className="payments-demo-banner" role="note"><FiFilter /> Some database records are marked as sample data.</p>}
      {summary && <section className="payments-overview" aria-label="Financial overview"><div className="payments-metrics">
        <article className="payments-metric revenue"><div className="payments-metric-heading"><span>Recorded earnings</span><FiArrowUpRight /></div><strong>{taka(summary.recordedEarnings)}</strong><small>From stored earning records</small></article>
        <article className="payments-metric payout-total"><div className="payments-metric-heading"><span>Requested payouts</span><FiArrowDownRight /></div><strong>{taka(summary.requestedPayouts)}</strong><small>Non-rejected payout requests</small></article>
        <article className="payments-metric commission"><div className="payments-metric-heading"><span>Pending payouts</span><b>Awaiting review</b></div><strong>{taka(summary.pendingPayouts)}</strong><small>Stored with pending status</small></article>
      </div></section>}
      <section className="transactions-panel" aria-label="Transaction history">
        <header className="transactions-heading"><h3>Financial record history</h3><div className="transaction-controls">
          <label className="transaction-search"><FiSearch /><input aria-label="Search financial records" placeholder="Search records..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="transaction-status-filter"><FiFilter /><select aria-label="Filter records by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="recorded">Recorded</option></select></label>
        </div></header>
        {notice && <div className="payments-notice" role="status"><FiCheck /><span>{notice}</span></div>}
        {loading ? <div className="transactions-empty" role="status">Loading financial records...</div> : filteredTransactions.length ? <>
          <div className="transactions-scroll"><table className="transactions-table"><thead><tr><th>Date</th><th>Record ID</th><th>Teacher</th><th>Type</th><th className="amount-column">Amount (BDT)</th><th className="transaction-status-column">Status</th></tr></thead>
            <tbody>{filteredTransactions.map((item, index) => <tr key={`${item.recordType}-${item._id || item.id}-${index}`}>
              <td>{dateLabel(item)}</td><td><span className="transaction-id">{item.id || item._id}</span></td><td>{item.person}</td><td>{item.transactionType}</td>
              <td className={`transaction-amount ${item.amount < 0 ? 'outgoing' : ''}`}>{item.amount < 0 ? '−' : '+'}{taka(item.amount)}</td>
              <td className="transaction-status-column"><span className={`transaction-status ${(item.status || 'recorded').toLowerCase()}`}>{item.status || 'Recorded'}</span></td>
            </tr>)}</tbody>
          </table></div>
          <footer className="transactions-footer"><span>Showing {filteredTransactions.length} of {transactions.length} stored records</span><span>Amounts in Bangladeshi taka (BDT)</span></footer>
        </> : <div className="transactions-empty"><FiSearch /><strong>{transactions.length ? 'No matching records' : 'No financial records yet'}</strong><span>{transactions.length ? 'Try another search or status filter.' : 'Stored teacher earnings and payout requests will appear here.'}</span></div>}
      </section>
    </div>
  </AdminLayout>
}
