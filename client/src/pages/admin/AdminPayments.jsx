import { useEffect, useMemo, useState } from 'react'
import { FiArrowDownRight, FiArrowUpRight, FiCheck, FiDownload, FiFilter, FiSearch } from 'react-icons/fi'
import { api } from '../../lib/api'
import AdminLayout from './AdminLayout'
import '../../styles/admin-payments.css'

const taka = (amount) => `৳${Number(Math.abs(amount) || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`
const dateLabel = (record) => {
  const value = record.paidAt || record.createdAt || record.date
  return value ? new Intl.DateTimeFormat('en-BD', { dateStyle: 'medium' }).format(new Date(value)) : '—'
}
const csvValue = (value) => `"${String(value).replaceAll('"', '""')}"`
const currentMonth = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`
}

export default function AdminPayments() {
  const [transactions, setTransactions] = useState([])
  const [summary, setSummary] = useState(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [month, setMonth] = useState(currentMonth)

  useEffect(() => {
    let current = true
    api.get('/admin/payments', { params: { month } }).then(({ data }) => {
      if (!current) return
      const records = [
        ...(data.payments || []).map((item) => ({ ...item, transactionType: item.transactionType || 'Course payment', amount: Number(item.amount) || 0 })),
        ...(data.payouts || []).map((item) => ({ ...item, transactionType: 'Payout request', amount: -(Number(item.amount) || 0) })),
      ].sort((first, second) => new Date(second.createdAt || second.date || 0) - new Date(first.createdAt || first.date || 0))
      setTransactions(records)
      setSummary(data.summary)
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load financial records.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [month])

  const filteredTransactions = useMemo(() => transactions.filter((record) => (
    (!status || (record.status || '').toLowerCase() === status)
    && `${record.id} ${record.person} ${record.transactionType} ${record.status}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [query, status, transactions])

  const generateReport = () => {
    const rows = [
      ['Date', 'Record ID', 'Teacher', 'Type', 'Amount (BDT)', 'Status'],
      ...filteredTransactions.map((item) => [dateLabel(item), item.paymentId || item.id || item._id || '', item.person, item.transactionType, item.amount.toFixed(2), item.status || 'recorded']),
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

  return <AdminLayout title="Payments" subtitle="Confirmed BDT payment records and monthly platform commission">
    <div className="admin-payments">
      <header className="payments-heading"><div><h2>Payments &amp; Financials</h2><p>Only Stripe-confirmed live transactions count toward earnings. Stripe test transactions are shown separately and excluded from commission.</p></div>
        <label className="transaction-status-filter">Commission month<input aria-label="Commission month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <button className="payments-primary" type="button" onClick={generateReport} disabled={loading}><FiDownload /> Export CSV</button>
      </header>
      {error && <div className="admin-data-error" role="alert">{error}</div>}
      {summary && <section className="payments-overview" aria-label="Financial overview"><div className="payments-metrics">
        <article className="payments-metric revenue"><div className="payments-metric-heading"><span>Monthly gross payments</span><FiArrowUpRight /></div><strong>{taka(summary.monthlyGross)}</strong><small>{summary.month} · Asia/Dhaka · live payments only</small></article>
        <article className="payments-metric commission"><div className="payments-metric-heading"><span>TeachOS commission (5%)</span><FiArrowDownRight /></div><strong>{taka(summary.recordedEarnings)}</strong><small>Realized from confirmed live transactions</small></article>
        <article className="payments-metric payout-total"><div className="payments-metric-heading"><span>Teacher net (95%)</span><b>Before payouts</b></div><strong>{taka(summary.teacherNet)}</strong><small>Distributed across teachers below</small></article>
        <article className="payments-metric commission"><div className="payments-metric-heading"><span>Pending payout requests</span><b>Awaiting review</b></div><strong>{taka(summary.pendingPayouts)}</strong><small>Stored requests; no transfers initiated</small></article>
      </div></section>}
      {summary && <section className="transactions-panel" aria-label="Teacher monthly commission"><header className="transactions-heading"><h3>Teacher revenue breakdown · {summary.month}</h3></header>
        {summary.teacherBreakdown?.length ? <div className="transactions-scroll"><table className="transactions-table"><thead><tr><th>Teacher</th><th>Payments</th><th className="amount-column">Gross (BDT)</th><th className="amount-column">Commission 5%</th><th className="amount-column">Teacher net 95%</th></tr></thead><tbody>{summary.teacherBreakdown.map((teacher) => <tr key={teacher.teacherUid}><td>{teacher.teacherName}</td><td>{teacher.paymentCount}</td><td className="transaction-amount">{taka(teacher.grossAmount)}</td><td className="transaction-amount">{taka(teacher.commissionAmount)}</td><td className="transaction-amount">{taka(teacher.netAmount)}</td></tr>)}</tbody></table></div> : <div className="transactions-empty"><strong>No confirmed live payments in {summary.month}</strong><span>Commission remains ৳0 until Stripe confirms live payments.</span></div>}
      </section>}
      <section className="transactions-panel" aria-label="Transaction history">
        <header className="transactions-heading"><h3>Financial record history</h3><div className="transaction-controls">
          <label className="transaction-search"><FiSearch /><input aria-label="Search financial records" placeholder="Search records..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="transaction-status-filter"><FiFilter /><select aria-label="Filter records by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="recorded">Recorded</option></select></label>
        </div></header>
        {notice && <div className="payments-notice" role="status"><FiCheck /><span>{notice}</span></div>}
        {loading ? <div className="transactions-empty" role="status">Loading financial records...</div> : filteredTransactions.length ? <>
          <div className="transactions-scroll"><table className="transactions-table"><thead><tr><th>Date</th><th>Record ID</th><th>Teacher</th><th>Type</th><th className="amount-column">Amount (BDT)</th><th className="transaction-status-column">Status</th></tr></thead>
            <tbody>{filteredTransactions.map((item, index) => <tr key={`${item.recordType}-${item._id || item.id}-${index}`}>
              <td>{dateLabel(item)}</td><td><span className="transaction-id">{item.paymentId || item.id || item._id}</span></td><td>{item.person}</td><td>{item.transactionType}{['test', 'sandbox'].includes(item.mode) ? ' · excluded from commission' : ''}</td>
              <td className={`transaction-amount ${item.amount < 0 ? 'outgoing' : ''}`}>{item.amount < 0 ? '−' : '+'}{taka(item.amount)}</td>
              <td className="transaction-status-column"><span className={`transaction-status ${(item.status || 'recorded').toLowerCase()}`}>{item.status || 'Recorded'}</span></td>
            </tr>)}</tbody>
          </table></div>
          <footer className="transactions-footer"><span>Showing {filteredTransactions.length} of {transactions.length} payment and payout records</span><span>Amounts in Bangladeshi taka (BDT)</span></footer>
        </> : <div className="transactions-empty"><FiSearch /><strong>{transactions.length ? 'No matching records' : 'No payment records yet'}</strong><span>{transactions.length ? 'Try another search or status filter.' : 'Stripe payment attempts and teacher payout requests appear here; no placeholder records are shown.'}</span></div>}
      </section>
    </div>
  </AdminLayout>
}
