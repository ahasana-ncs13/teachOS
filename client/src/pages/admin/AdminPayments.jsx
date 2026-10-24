import { useMemo, useState } from 'react'
import { FiArrowDownRight, FiArrowUpRight, FiCheck, FiClock, FiDownload, FiFilter, FiSearch, FiX } from 'react-icons/fi'
import AdminLayout from './AdminLayout'
import '../../styles/admin-payments.css'

const initialTransactions = [
  { id: 'TRX-8921A', date: '2024-10-24', person: 'Student: Jane Doe', type: 'Tuition Payment', amount: 1500, status: 'Paid' },
  { id: 'TRX-8920B', date: '2024-10-23', person: 'Instructor: Dr. Alan Turing', type: 'Instructor Payout', amount: -4250, status: 'Pending' },
  { id: 'TRX-8919C', date: '2024-10-22', person: 'Platform Fee', type: 'Admin Commission', amount: 75, status: 'Paid' },
  { id: 'TRX-8918D', date: '2024-10-22', person: 'Student: Mark Smith', type: 'Tuition Payment', amount: 1500, status: 'Failed' },
]

const initialPayouts = [
  { id: 'PO-1021', name: 'Dr. Alan Turing', department: 'Computer Science', amount: 4250, initials: 'AT' },
  { id: 'PO-1020', name: 'Prof. Marie Curie', department: 'Advanced Physics', amount: 3800, initials: 'MC' },
  { id: 'PO-1019', name: 'Ernest Hemingway', department: 'Creative Writing', amount: 1150, initials: 'EH' },
]

const usd = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount))
const dateLabel = (date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
const csvValue = (value) => `"${String(value).replaceAll('"', '""')}"`

export default function AdminPayments() {
  const [transactions] = useState(initialTransactions)
  const [payouts] = useState(initialPayouts)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [selectedPayout, setSelectedPayout] = useState(null)
  const [showPayoutNotice, setShowPayoutNotice] = useState(false)
  const [notice, setNotice] = useState('')

  const filteredTransactions = useMemo(() => transactions.filter((transaction) => (
    (!status || transaction.status.toLowerCase() === status)
    && `${transaction.id} ${transaction.person} ${transaction.type} ${transaction.status}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [query, status, transactions])

  const generateReport = () => {
    const rows = [
      ['Date', 'Transaction ID', 'Payer / Payee', 'Type', 'Amount (USD)', 'Status'],
      ...filteredTransactions.map((item) => [dateLabel(item.date), item.id, item.person, item.type, item.amount.toFixed(2), item.status]),
    ]
    const content = rows.map((row) => row.map(csvValue).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'teachos-sample-financial-report.csv'
    link.click()
    URL.revokeObjectURL(url)
    setNotice('Downloaded the sample transaction report.')
  }

  return <AdminLayout title="Payments" subtitle="Platform revenue overview and transaction management">
    <div className="admin-payments">
      <header className="payments-heading">
        <div><h2>Payments &amp; Financials</h2><p>Platform Revenue Overview &amp; Transaction Management</p></div>
        <button className="payments-primary" type="button" onClick={generateReport}><FiDownload /> Generate Financial Report</button>
      </header>

      <p className="payments-demo-banner" role="note"><FiFilter /> Sample financial data for display only. Payout controls do not transfer money.</p>

      <section className="payments-overview" aria-label="Financial overview">
        <div className="payments-metrics">
          <article className="payments-metric revenue">
            <div className="payments-metric-heading"><span>Total Revenue</span><FiArrowUpRight /></div>
            <strong>$1.2M</strong><small><FiArrowUpRight /> 12.5% vs last month</small>
            <span className="payments-metric-art" aria-hidden="true">$</span>
          </article>
          <article className="payments-metric payout-total">
            <div className="payments-metric-heading"><span>Total Payouts</span><FiArrowDownRight /></div>
            <strong>$940K</strong><small>To instructors</small>
            <span className="payments-metric-art" aria-hidden="true">↗</span>
          </article>
          <article className="payments-metric commission">
            <div className="payments-metric-heading"><span>Admin Commission</span><b>5% Rate</b></div>
            <strong>$60K</strong><small>Platform earnings</small>
            <span className="payments-metric-art" aria-hidden="true">%</span>
          </article>
        </div>

        <aside className="payments-pending">
          <header><h3><FiClock /> Pending Payouts</h3><span>{payouts.length} pending</span></header>
          <div className="pending-payout-list">
            {payouts.map((payout) => <article className="pending-payout" key={payout.id}>
              <span className="payout-avatar">{payout.initials}</span>
              <div className="payout-person"><strong>{payout.name}</strong><small>{payout.department}</small></div>
              <div className="payout-amount"><strong>{usd(payout.amount)}</strong><button type="button" onClick={() => setSelectedPayout(payout)}>Review</button></div>
            </article>)}
          </div>
          <button className="payments-secondary pending-review-all" type="button" onClick={() => setShowPayoutNotice(true)}>Review All Pending</button>
        </aside>
      </section>

      <section className="transactions-panel" aria-label="Transaction history">
        <header className="transactions-heading">
          <h3>Transaction History</h3>
          <div className="transaction-controls">
            <label className="transaction-search"><FiSearch /><input aria-label="Search transactions" placeholder="Search transactions..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <label className="transaction-status-filter"><FiFilter /><select aria-label="Filter transactions by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="failed">Failed</option></select></label>
          </div>
        </header>
        {notice && <div className="payments-notice" role="status"><FiCheck /><span>{notice}</span><button type="button" aria-label="Dismiss notice" onClick={() => setNotice('')}><FiX /></button></div>}
        {filteredTransactions.length ? <>
          <div className="transactions-scroll">
            <table className="transactions-table">
              <thead><tr><th>Date</th><th>Transaction ID</th><th>Payer / Payee</th><th>Type</th><th className="amount-column">Amount</th><th className="transaction-status-column">Status</th></tr></thead>
              <tbody>{filteredTransactions.map((item) => <tr key={item.id}>
                <td>{dateLabel(item.date)}</td><td><span className="transaction-id">#{item.id}</span></td><td>{item.person}</td><td>{item.type}</td>
                <td className={`transaction-amount ${item.amount < 0 ? 'outgoing' : ''}`}>{item.amount > 0 ? '+' : '−'}{usd(item.amount)}</td>
                <td className="transaction-status-column"><span className={`transaction-status ${item.status.toLowerCase()}`}>{item.status}</span></td>
              </tr>)}</tbody>
            </table>
          </div>
          <footer className="transactions-footer"><span>Showing {filteredTransactions.length} of {transactions.length} sample transactions</span><span>All amounts shown in USD</span></footer>
        </> : <div className="transactions-empty"><FiSearch /><strong>No transactions found</strong><span>Try another search or status filter.</span></div>}
      </section>
    </div>

    {(selectedPayout || showPayoutNotice) && <div className="payments-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setSelectedPayout(null); setShowPayoutNotice(false) } }}>
      <section className="payments-modal" role="dialog" aria-modal="true" aria-labelledby="payout-dialog-title">
        <button className="payments-modal-close" type="button" aria-label="Close" onClick={() => { setSelectedPayout(null); setShowPayoutNotice(false) }}><FiX /></button>
        <p className="payments-modal-kicker">Payout review · Sample data</p>
        <h2 id="payout-dialog-title">{selectedPayout ? selectedPayout.name : 'Pending payouts'}</h2>
        {selectedPayout ? <div className="payout-review-details"><p>{selectedPayout.department}</p><strong>{usd(selectedPayout.amount)}</strong><span>Request ID: {selectedPayout.id}</span></div> : <p className="payout-review-summary">{payouts.length} sample payout requests are awaiting review.</p>}
        <div className="payout-review-warning"><FiFilter /><span>This demo does not connect to a payment provider. Reviewing a payout here will not approve or transfer funds.</span></div>
        <button className="payments-primary payout-dialog-done" type="button" onClick={() => { setSelectedPayout(null); setShowPayoutNotice(false) }}>Close</button>
      </section>
    </div>}
  </AdminLayout>
}
