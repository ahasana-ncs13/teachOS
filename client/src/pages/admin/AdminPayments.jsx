import { useEffect, useMemo, useState } from 'react'
import { FiArrowDownRight, FiArrowUpRight, FiCheck, FiDownload, FiFilter, FiPlay, FiSearch, FiZap } from 'react-icons/fi'
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
  const [monthlySettlements, setMonthlySettlements] = useState([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [filterTeacher, setFilterTeacher] = useState('')
  const [filterCourse, setFilterCourse] = useState('')
  const [filterPaymentType, setFilterPaymentType] = useState('')
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [month, setMonth] = useState(currentMonth)
  const [reloadKey, setReloadKey] = useState(0)
  const [settlementReferences, setSettlementReferences] = useState({})
  const [refundAmounts, setRefundAmounts] = useState({})
  const [refundReferences, setRefundReferences] = useState({})
  const [actionBusy, setActionBusy] = useState('')
  const [jobBusy, setJobBusy] = useState(false)
  const [finalizeBusy, setFinalizeBusy] = useState('')

  useEffect(() => {
    let current = true
    const params = { month }
    if (filterTeacher.trim()) params.teacher = filterTeacher.trim()
    if (filterCourse.trim()) params.course = filterCourse.trim()
    if (filterPaymentType) params.paymentType = filterPaymentType
    if (filterPaymentMethod) params.paymentMethod = filterPaymentMethod

    api.get('/admin/payments', { params }).then(({ data }) => {
      if (!current) return
      const records = [
        ...(data.payments || []).map((item) => ({ ...item, recordType: 'payment', transactionType: item.transactionType || (item.paymentType === 'ONE_TIME' ? 'One-Time Payment' : 'Monthly Subscription'), amount: Number(item.amount) || 0 })),
        ...(data.payouts || []).map((item) => ({ ...item, recordType: 'payout', transactionType: 'Payout request', amount: -(Number(item.amount) || 0) })),
      ].sort((first, second) => new Date(second.createdAt || second.date || 0) - new Date(first.createdAt || first.date || 0))
      setTransactions(records)
      setSummary(data.summary)
      setMonthlySettlements(data.monthlySettlements || data.monthlySettlementHistory || data.summary?.monthlySettlementHistory || [])
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load financial records.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [month, reloadKey, filterTeacher, filterCourse, filterPaymentType, filterPaymentMethod])

  const reviewPayout = async (item, newStatus) => {
    const id = item.id || item._id
    setActionBusy(id)
    setError('')
    setNotice('')
    try {
      await api.patch(`/admin/payments/payout-requests/${encodeURIComponent(id)}/settlement`, {
        status: newStatus,
        ...(newStatus === 'paid' ? { externalReference: settlementReferences[id] || '' } : {}),
      })
      setNotice(newStatus === 'paid'
        ? 'External settlement recorded. No transfer was initiated by TeachOS.'
        : 'Payout request rejected and recorded.')
      setReloadKey((value) => value + 1)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update this payout record.')
    } finally {
      setActionBusy('')
    }
  }

  const recordBkashRefund = async (item) => {
    const id = item.paymentId
    setActionBusy(id)
    setError('')
    setNotice('')
    try {
      const { data } = await api.post(`/admin/payments/${encodeURIComponent(id)}/refunds`, {
        amount: Number(refundAmounts[id]),
        externalReference: refundReferences[id]?.trim(),
      })
      setNotice(`External refund recorded. Commission reversal: ${taka(data.platformCommissionReversed)}; teacher revenue reversal: ${taka(data.teacherRevenueReversed)}. TeachOS did not transfer funds.`)
      setReloadKey((value) => value + 1)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not record this external refund.')
    } finally {
      setActionBusy('')
    }
  }

  const finalizeMonth = async (settlementMonth) => {
    setFinalizeBusy(settlementMonth)
    setError('')
    setNotice('')
    try {
      const { data } = await api.post(`/admin/settlements/${encodeURIComponent(settlementMonth)}/finalize`)
      setNotice(data.message || `Settlement for ${settlementMonth} finalized successfully.`)
      setReloadKey((value) => value + 1)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not finalize this settlement.')
    } finally {
      setFinalizeBusy('')
    }
  }

  const runJobs = async () => {
    setJobBusy(true)
    setError('')
    setNotice('')
    try {
      const { data } = await api.post('/admin/settlements/run-jobs')
      setNotice(data.message || 'Scheduled jobs executed successfully.')
      setReloadKey((value) => value + 1)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not run scheduled jobs.')
    } finally {
      setJobBusy(false)
    }
  }

  const filteredTransactions = useMemo(() => transactions.filter((record) => (
    (!status || (record.status || '').toLowerCase() === status)
    && `${record.id} ${record.person} ${record.transactionType} ${record.status} ${record.paymentType || ''} ${record.paymentMethod || ''}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [query, status, transactions])

  const generateReport = () => {
    const rows = [
      ['Date', 'Record ID', 'Teacher', 'Type', 'Payment Type', 'Method', 'Amount (BDT)', 'Refunded (BDT)', 'Status'],
      ...filteredTransactions.map((item) => [dateLabel(item), item.paymentId || item.id || item._id || '', item.person, item.transactionType, item.paymentType || '', item.paymentMethod || item.gateway || '', item.amount.toFixed(2), (Number(item.refundedAmount) || 0).toFixed(2), item.status || 'recorded']),
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

  const prevMonth = (() => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })()

  return <AdminLayout title="Payments" subtitle="Verified BDT course sales, commission, and teacher revenue">
    <div className="admin-payments">
      <header className="payments-heading">
        <div>
          <h2>Payments &amp; Financials</h2>
          <p>Only provider-verified live Stripe and bKash transactions count toward revenue. Test, sandbox, demo, pending, and failed payments are excluded. Payouts are records only; TeachOS does not transfer money.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="transaction-status-filter">Month<input aria-label="Commission month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
          <button className="payments-primary" type="button" style={{ background: '#059669' }} onClick={runJobs} disabled={jobBusy || loading}>
            <FiZap />{jobBusy ? 'Running...' : 'Run Jobs'}
          </button>
          <button className="payments-primary" type="button" onClick={generateReport} disabled={loading}><FiDownload /> Export CSV</button>
        </div>
      </header>

      {error && <div className="admin-data-error" role="alert">{error}</div>}
      {notice && <div className="payments-notice" role="status"><FiCheck /><span>{notice}</span></div>}

      {/* ── Financial Overview Metrics ── */}
      {summary && <section className="payments-overview" aria-label="Financial overview">
        <div className="payments-metrics" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
          <article className="payments-metric revenue">
            <div className="payments-metric-heading"><span>Total Gross Revenue</span><FiArrowUpRight /></div>
            <strong>{taka(summary.totalGrossCourseRevenue ?? summary.monthlyGross)}</strong>
            <small>All verified payments</small>
          </article>
          <article className="payments-metric commission">
            <div className="payments-metric-heading"><span>Total Platform Commission</span><FiArrowDownRight /></div>
            <strong>{taka(summary.totalPlatformCommission ?? summary.recordedEarnings)}</strong>
            <small>5% TeachOS share · all time</small>
          </article>
          <article className="payments-metric commission">
            <div className="payments-metric-heading"><span>Current Month Commission</span><b>{summary.month || month}</b></div>
            <strong>{taka(summary.currentMonthAccumulatedCommission ?? summary.monthlyCommission)}</strong>
            <small>Accumulated this month</small>
          </article>
          <article className="payments-metric payout-total">
            <div className="payments-metric-heading"><span>Finalized Commission</span><b>Settled</b></div>
            <strong>{taka(summary.finalizedMonthlyCommission ?? 0)}</strong>
            <small>From finalized past months</small>
          </article>
          <article className="payments-metric commission">
            <div className="payments-metric-heading"><span>Teacher Pending Earnings</span><b>🕐 Held</b></div>
            <strong style={{ color: '#d97706' }}>{taka(summary.teacherPendingEarnings ?? 0)}</strong>
            <small>Awaiting calendar-month release</small>
          </article>
          <article className="payments-metric payout-total">
            <div className="payments-metric-heading"><span>Teacher Available Earnings</span><b>✓ Ready</b></div>
            <strong style={{ color: '#059669' }}>{taka(summary.teacherAvailableEarnings ?? 0)}</strong>
            <small>Released, withdrawable by teachers</small>
          </article>
          <article className="payments-metric commission">
            <div className="payments-metric-heading"><span>Successful Payments</span><b>{summary.month || month}</b></div>
            <strong>{Number(summary.totalSuccessfulPayments ?? summary.successfulTransactions) || 0}</strong>
            <small>Verified course payments</small>
          </article>
          <article className="payments-metric revenue">
            <div className="payments-metric-heading"><span>One-Time Revenue</span><b>Lifetime</b></div>
            <strong>{taka(summary.oneTimePurchaseRevenue ?? 0)}</strong>
            <small>Single-payment courses</small>
          </article>
          <article className="payments-metric commission">
            <div className="payments-metric-heading"><span>Subscription Revenue</span><b>Monthly</b></div>
            <strong>{taka(summary.monthlySubscriptionRevenue ?? 0)}</strong>
            <small>Recurring tuition revenue</small>
          </article>
          <article className="payments-metric payout-total">
            <div className="payments-metric-heading"><span>Refunds &amp; Chargebacks</span><b>Reversed</b></div>
            <strong style={{ color: '#dc2626' }}>{taka(summary.refundsAndChargebacks ?? summary.monthlyRefunds ?? 0)}</strong>
            <small>Commission and earnings reversed</small>
          </article>
          <article className="payments-metric commission">
            <div className="payments-metric-heading"><span>Pending Payout Requests</span><b>Awaiting review</b></div>
            <strong>{taka(summary.pendingPayouts)}</strong>
            <small>Stored requests; no transfers initiated</small>
          </article>
        </div>
      </section>}

      {/* ── Teacher Revenue Breakdown ── */}
      {summary && <section className="transactions-panel" style={{ marginBottom: '16px' }} aria-label="Teacher monthly commission">
        <header className="transactions-heading"><h3>Teacher revenue breakdown · {summary.month || month}</h3></header>
        {summary.teacherBreakdown?.length ? <div className="transactions-scroll"><table className="transactions-table"><thead><tr><th>Teacher</th><th>Payments</th><th className="amount-column">Gross (BDT)</th><th className="amount-column">Commission 5%</th><th className="amount-column">Teacher 95%</th><th className="amount-column">Pending</th><th className="amount-column">Available</th></tr></thead><tbody>{summary.teacherBreakdown.map((teacher) => <tr key={teacher.teacherUid}><td>{teacher.teacherName}</td><td>{teacher.paymentCount}</td><td className="transaction-amount">{taka(teacher.grossAmount)}</td><td className="transaction-amount">{taka(teacher.commissionAmount)}</td><td className="transaction-amount">{taka(teacher.netAmount)}</td><td className="transaction-amount" style={{ color: '#d97706' }}>{taka(teacher.pendingAmount ?? 0)}</td><td className="transaction-amount" style={{ color: '#059669' }}>{taka(teacher.availableAmount ?? 0)}</td></tr>)}</tbody></table></div> : <div className="transactions-empty"><strong>No verified live payments in {summary.month || month}</strong><span>Commission remains ৳0 until Stripe or bKash verifies live transactions.</span></div>}
      </section>}

      {/* ── Monthly Settlement History ── */}
      <section className="transactions-panel" style={{ marginBottom: '16px' }} aria-label="Monthly settlement history">
        <header className="transactions-heading">
          <h3>Monthly Admin Settlement History</h3>
          <button
            className="payments-primary"
            type="button"
            style={{ background: '#7c3aed', fontSize: '11px', gap: '5px' }}
            onClick={() => finalizeMonth(prevMonth)}
            disabled={!!finalizeBusy || loading}
          >
            <FiPlay />{finalizeBusy === prevMonth ? 'Finalizing...' : `Finalize ${prevMonth}`}
          </button>
        </header>
        {monthlySettlements.length ? (
          <div className="transactions-scroll">
            <table className="transactions-table">
              <thead><tr><th>Month</th><th className="amount-column">Gross Revenue</th><th className="amount-column">Platform Commission (5%)</th><th>Transactions</th><th>Status</th><th>Finalized At</th></tr></thead>
              <tbody>
                {monthlySettlements.map((item) => (
                  <tr key={item.settlementMonth}>
                    <td><strong>{item.settlementMonth}</strong></td>
                    <td className="transaction-amount">{taka(item.totalGrossRevenue)}</td>
                    <td className="transaction-amount">{taka(item.totalPlatformCommission)}</td>
                    <td>{item.transactionCount}</td>
                    <td>
                      <span className={`transaction-status ${item.settlementStatus === 'FINALIZED' ? 'paid' : 'pending'}`}>
                        {item.settlementStatus || 'PENDING'}
                      </span>
                    </td>
                    <td>{item.finalizedAt ? new Date(item.finalizedAt).toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="transactions-empty"><strong>No monthly settlements finalized yet</strong><span>Use "Finalize [month]" to generate monthly commission settlement records.</span></div>
        )}
      </section>

      {/* ── Filter Bar ── */}
      <section className="transactions-panel" aria-label="Transaction history">
        <header className="transactions-heading">
          <h3>Financial record history</h3>
          <div className="transaction-controls" style={{ flexWrap: 'wrap' }}>
            <label className="transaction-search"><FiSearch /><input aria-label="Search financial records" placeholder="Search records..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <label className="transaction-status-filter"><FiFilter /><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="paid">Paid</option><option value="refunded">Refunded</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="recorded">Recorded</option></select></label>
            <label className="transaction-status-filter">
              <select aria-label="Filter by payment type" value={filterPaymentType} onChange={(event) => setFilterPaymentType(event.target.value)}>
                <option value="">All types</option>
                <option value="ONE_TIME">One-Time</option>
                <option value="MONTHLY_SUBSCRIPTION">Monthly Sub</option>
              </select>
            </label>
            <label className="transaction-status-filter">
              <select aria-label="Filter by payment method" value={filterPaymentMethod} onChange={(event) => setFilterPaymentMethod(event.target.value)}>
                <option value="">All methods</option>
                <option value="stripe">Stripe</option>
                <option value="bkash">bKash</option>
              </select>
            </label>
            <label className="transaction-search" style={{ width: '130px' }}>
              <FiSearch />
              <input aria-label="Filter by teacher" placeholder="Teacher..." value={filterTeacher} onChange={(event) => setFilterTeacher(event.target.value)} />
            </label>
            <label className="transaction-search" style={{ width: '130px' }}>
              <FiSearch />
              <input aria-label="Filter by course" placeholder="Course..." value={filterCourse} onChange={(event) => setFilterCourse(event.target.value)} />
            </label>
          </div>
        </header>

        {loading ? <div className="transactions-empty" role="status">Loading financial records...</div> : filteredTransactions.length ? <>
          <div className="transactions-scroll"><table className="transactions-table"><thead><tr><th>Date</th><th>Record ID</th><th>Teacher</th><th>Type</th><th>Payment Type</th><th>Method</th><th className="amount-column">Gross (BDT)</th><th className="amount-column">Teacher 95%</th><th className="amount-column">Refunded (BDT)</th><th>Earning Status</th><th className="transaction-status-column">Status</th><th>Review / settlement</th></tr></thead>
            <tbody>{filteredTransactions.map((item, index) => <tr key={`${item.recordType}-${item._id || item.id}-${index}`}>
              <td>{dateLabel(item)}</td>
              <td><span className="transaction-id">{item.paymentId || item.id || item._id}</span></td>
              <td>{item.person}</td>
              <td>{item.transactionType}{item.paymentMethod || item.gateway ? ` · ${item.paymentMethod || item.gateway}` : ''}{['test', 'sandbox', 'demo'].includes(item.mode) ? ' · excluded' : ''}</td>
              <td>
                <span style={{
                  display: 'inline-flex',
                  padding: '3px 7px',
                  borderRadius: '999px',
                  fontSize: '8px',
                  fontWeight: 700,
                  background: item.paymentType === 'ONE_TIME' ? '#ede9fe' : '#e0f2fe',
                  color: item.paymentType === 'ONE_TIME' ? '#6d28d9' : '#0369a1',
                }}>
                  {item.paymentType === 'ONE_TIME' ? 'One-Time' : item.paymentType === 'MONTHLY_SUBSCRIPTION' ? 'Monthly' : '—'}
                </span>
              </td>
              <td style={{ textTransform: 'capitalize' }}>{item.paymentMethod || item.gateway || '—'}</td>
              <td className={`transaction-amount ${item.amount < 0 ? 'outgoing' : ''}`}>{item.amount < 0 ? '−' : '+'}{taka(item.amount)}</td>
              <td className="transaction-amount" style={{ color: '#059669' }}>{taka(item.teacherNet ?? item.teacherEarning ?? 0)}</td>
              <td className="transaction-amount">{taka(item.refundedAmount)}</td>
              <td>
                {item.recordType === 'payment' && (
                  <span style={{
                    display: 'inline-flex',
                    padding: '3px 7px',
                    borderRadius: '999px',
                    fontSize: '8px',
                    fontWeight: 700,
                    background: item.earningStatus === 'AVAILABLE' ? '#dcfce7' : item.earningStatus === 'WITHDRAWN' ? '#e0e7ff' : '#fef3c7',
                    color: item.earningStatus === 'AVAILABLE' ? '#166534' : item.earningStatus === 'WITHDRAWN' ? '#3730a3' : '#92400e',
                  }}>
                    {item.earningStatus || 'PENDING'}
                    {item.availableAt && item.earningStatus === 'PENDING' && ` · ${new Date(item.availableAt).toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', month: 'short', day: 'numeric' })}`}
                  </span>
                )}
              </td>
              <td className="transaction-status-column"><span className={`transaction-status ${(item.status || 'recorded').toLowerCase()}`}>{item.status || 'Recorded'}</span></td>
              <td className="payout-review-column">{item.recordType === 'payout' && item.status === 'pending' ? <div className="payout-review-actions">
                <input aria-label={`External settlement reference for payout ${item.id}`} value={settlementReferences[item.id] || ''} onChange={(event) => setSettlementReferences((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="External reference" maxLength={120} />
                <button type="button" disabled={actionBusy === item.id || !settlementReferences[item.id]?.trim()} onClick={() => reviewPayout(item, 'paid')}>{actionBusy === item.id ? 'Saving...' : 'Record settled'}</button>
                <button className="reject-payout" type="button" disabled={actionBusy === item.id} onClick={() => reviewPayout(item, 'rejected')}>Reject</button>
              </div> : item.recordType === 'payout' && item.externalReference ? <span className="transaction-id">External: {item.externalReference}</span> : item.recordType === 'payment' && item.gateway === 'bkash' && item.mode === 'live' && ['paid', 'refunded'].includes(item.status) && Number(item.refundedAmount) < Number(item.amount) ? <div className="payout-review-actions">
                {item.refundRequest && <small>Student requested refund: {item.refundRequest.reason || 'No reason provided'}</small>}
                <input aria-label={`Externally processed refund amount for ${item.paymentId}`} type="number" min="0.01" max={(Number(item.amount) || 0) - (Number(item.refundedAmount) || 0)} step="0.01" placeholder="Refund amount" value={refundAmounts[item.paymentId] || ''} onChange={(event) => setRefundAmounts((current) => ({ ...current, [item.paymentId]: event.target.value }))} />
                <input aria-label={`bKash refund reference for ${item.paymentId}`} value={refundReferences[item.paymentId] || ''} onChange={(event) => setRefundReferences((current) => ({ ...current, [item.paymentId]: event.target.value }))} placeholder="External bKash reference" maxLength={120} />
                <button type="button" disabled={actionBusy === item.paymentId || !refundAmounts[item.paymentId] || !refundReferences[item.paymentId]?.trim()} onClick={() => recordBkashRefund(item)}>{actionBusy === item.paymentId ? 'Saving...' : 'Record external refund'}</button>
              </div> : '—'}</td>
            </tr>)}</tbody>
          </table></div>
          <footer className="transactions-footer"><span>Showing {filteredTransactions.length} of {transactions.length} payment and payout records</span><span>Amounts in Bangladeshi taka (BDT)</span></footer>
        </> : <div className="transactions-empty"><FiSearch /><strong>{transactions.length ? 'No matching records' : 'No payment records yet'}</strong><span>{transactions.length ? 'Try another search or status filter.' : 'Stripe payment attempts and teacher payout requests appear here.'}</span></div>}
      </section>
    </div>
  </AdminLayout>
}
