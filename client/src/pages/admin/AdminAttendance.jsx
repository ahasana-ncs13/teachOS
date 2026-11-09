import { useCallback, useEffect, useState } from 'react'
import {
  FiAlertCircle,
  FiBookOpen,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiDownload,
  FiFilter,
  FiRefreshCw,
  FiSearch,
  FiUsers,
  FiXCircle,
} from 'react-icons/fi'
import { api } from '../../lib/api'
import AdminLayout from './AdminLayout'

export default function AdminAttendance() {
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState({
    summary: {
      totalSessions: 0,
      totalStudents: 0,
      totalRecords: 0,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      attendancePercentage: 0,
    },
    records: [],
    courseReports: [],
    listings: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
  })

  // Filter states
  const [selectedListing, setSelectedListing] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)

  const fetchAttendance = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = {
        page,
        limit: 20,
        ...(selectedListing ? { listingId: selectedListing } : {}),
        ...(selectedStatus ? { status: selectedStatus } : {}),
        ...(studentSearch.trim() ? { studentSearch: studentSearch.trim() } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      }
      const response = await api.get('/admin/attendance', { params })
      setData(response.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load platform attendance records.')
    } finally {
      setLoading(false)
    }
  }, [page, selectedListing, selectedStatus, studentSearch, startDate, endDate])

  useEffect(() => {
    fetchAttendance()
  }, [fetchAttendance])

  const handleExportCSV = async () => {
    setExporting(true)
    try {
      const params = {
        ...(selectedListing ? { listingId: selectedListing } : {}),
        ...(selectedStatus ? { status: selectedStatus } : {}),
        ...(studentSearch.trim() ? { studentSearch: studentSearch.trim() } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      }
      const response = await api.get('/admin/attendance/export', {
        params,
        responseType: 'blob',
      })
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `teachos-attendance-${new Date().toISOString().slice(0, 10)}.csv`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to export CSV report.')
    } finally {
      setExporting(false)
    }
  }

  const { summary, records, courseReports, listings, pagination } = data

  return (
    <AdminLayout title="Attendance Management" subtitle="Platform-wide attendance monitoring, course reports, and student records">
      {error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '12px 16px',
          borderRadius: '8px',
          background: '#fee2e2',
          color: '#991b1b',
          marginBottom: '20px',
          fontSize: '13px',
        }}>
          <FiAlertCircle /> {error}
        </div>
      )}

      {/* Top statistics cards */}
      <div className="admin-stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '24px' }}>
        <div className="admin-stat">
          <div className="admin-stat-top">
            <span className="admin-stat-icon blue"><FiCalendar /></span>
            <small style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>Active Cohorts</small>
          </div>
          <p>Recorded Sessions</p>
          <strong>{summary.totalSessions}</strong>
          <small style={{ color: '#64748b', fontSize: '11px' }}>{summary.totalRecords} student attendances marked</small>
        </div>

        <div className="admin-stat">
          <div className="admin-stat-top">
            <span className="admin-stat-icon green"><FiCheckCircle /></span>
            <small style={{ color: '#16a34a', fontSize: '11px', fontWeight: 700 }}>Overall Rate</small>
          </div>
          <p>Attendance Rate</p>
          <strong style={{ color: '#16a34a' }}>{summary.attendancePercentage}%</strong>
          <small style={{ color: '#64748b', fontSize: '11px' }}>Present + Late over eligible classes</small>
        </div>

        <div className="admin-stat">
          <div className="admin-stat-top">
            <span className="admin-stat-icon green"><FiUsers /></span>
            <small style={{ color: '#16a34a', fontSize: '11px', fontWeight: 600 }}>Present</small>
          </div>
          <p>Present Classes</p>
          <strong>{summary.present}</strong>
          <small style={{ color: '#64748b', fontSize: '11px' }}>+{summary.late} late arrivals recorded</small>
        </div>

        <div className="admin-stat">
          <div className="admin-stat-top">
            <span className="admin-stat-icon orange"><FiXCircle /></span>
            <small style={{ color: '#dc2626', fontSize: '11px', fontWeight: 600 }}>Absences</small>
          </div>
          <p>Absent &amp; Excused</p>
          <strong style={{ color: '#dc2626' }}>{summary.absent}</strong>
          <small style={{ color: '#64748b', fontSize: '11px' }}>{summary.excused} excused absences</small>
        </div>
      </div>

      {/* Course-wise Attendance Report */}
      {courseReports.length > 0 && (
        <section style={{
          background: '#fff',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid #e2e8f0',
          marginBottom: '24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 4px', color: '#1e293b' }}>
                Course-wise Attendance Performance
              </h2>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                Attendance activity across courses with recorded live sessions
              </p>
            </div>
            <span style={{ fontSize: '12px', color: '#64748b', background: '#f1f5f9', padding: '4px 10px', borderRadius: '6px' }}>
              Top {courseReports.length} courses
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Course &amp; Batch</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Teacher</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Sessions</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Marked</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Present</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Absent</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Late</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600 }}>Excused</th>
                  <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>Attendance Rate</th>
                </tr>
              </thead>
              <tbody>
                {courseReports.map((report) => (
                  <tr key={String(report.listingId)} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px' }}>
                      <strong style={{ display: 'block', color: '#1e293b' }}>{report.courseName}</strong>
                      <small style={{ color: '#64748b' }}>{report.batchName}</small>
                    </td>
                    <td style={{ padding: '12px', color: '#334155' }}>{report.teacherName}</td>
                    <td style={{ padding: '12px', color: '#334155' }}>{report.sessionsCount}</td>
                    <td style={{ padding: '12px', color: '#334155' }}>{report.totalRecords}</td>
                    <td style={{ padding: '12px', color: '#16a34a', fontWeight: 600 }}>{report.present}</td>
                    <td style={{ padding: '12px', color: '#dc2626' }}>{report.absent}</td>
                    <td style={{ padding: '12px', color: '#ca8a04' }}>{report.late}</td>
                    <td style={{ padding: '12px', color: '#64748b' }}>{report.excused}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontWeight: 700,
                        fontSize: '12px',
                        background: report.attendancePercentage >= 75 ? '#dcfce7' : '#fee2e2',
                        color: report.attendancePercentage >= 75 ? '#15803d' : '#b91c1c',
                      }}>
                        {report.attendancePercentage}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Filter and search toolbar */}
      <section style={{
        background: '#fff',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #e2e8f0',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
            {/* Search */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
            }}>
              <FiSearch style={{ color: '#94a3b8' }} />
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => { setStudentSearch(e.target.value); setPage(1) }}
                placeholder="Search student name..."
                style={{ border: 0, outline: 0, background: 'transparent', fontSize: '12px', width: '160px' }}
              />
            </div>

            {/* Course Filter */}
            <select
              value={selectedListing}
              onChange={(e) => { setSelectedListing(e.target.value); setPage(1) }}
              style={{
                padding: '6px 10px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '12px',
                background: '#fff',
                color: '#334155',
              }}
            >
              <option value="">All Courses &amp; Batches</option>
              {listings.map((l) => (
                <option key={String(l._id)} value={String(l._id)}>
                  {l.courseName ? `${l.courseName} (${l.name})` : l.name}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => { setSelectedStatus(e.target.value); setPage(1) }}
              style={{
                padding: '6px 10px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '12px',
                background: '#fff',
                color: '#334155',
              }}
            >
              <option value="">All Statuses</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="late">Late</option>
              <option value="excused">Excused</option>
            </select>

            {/* Date Filters */}
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1) }}
              title="Start Date"
              style={{
                padding: '5px 8px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '12px',
                background: '#fff',
              }}
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1) }}
              title="End Date"
              style={{
                padding: '5px 8px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '12px',
                background: '#fff',
              }}
            />

            {(selectedListing || selectedStatus || studentSearch || startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setSelectedListing('')
                  setSelectedStatus('')
                  setStudentSearch('')
                  setStartDate('')
                  setEndDate('')
                  setPage(1)
                }}
                style={{
                  padding: '6px 10px',
                  border: '0',
                  borderRadius: '6px',
                  background: '#f1f5f9',
                  color: '#475569',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Clear Filters
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={fetchAttendance}
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#334155',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <FiRefreshCw className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={exporting || loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                borderRadius: '6px',
                border: 0,
                background: '#2563eb',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <FiDownload /> {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>

        {/* Student attendance history table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Course &amp; Batch</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Teacher</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Session Topic</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Student Name</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                    Loading attendance records...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                    No attendance records match the selected filters.
                  </td>
                </tr>
              ) : (
                records.map((r) => {
                  const statusColors = {
                    present: { bg: '#dcfce7', text: '#15803d' },
                    absent: { bg: '#fee2e2', text: '#b91c1c' },
                    late: { bg: '#fef9c3', text: '#a16207' },
                    excused: { bg: '#ede9fe', text: '#6d28d9' },
                  }
                  const style = statusColors[r.status] || { bg: '#f1f5f9', text: '#475569' }
                  const dateStr = r.joinedAt
                    ? new Date(r.joinedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '—'

                  return (
                    <tr key={String(r._id)} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '12px', whiteSpace: 'nowrap', color: '#475569' }}>{dateStr}</td>
                      <td style={{ padding: '12px' }}>
                        <strong style={{ display: 'block', color: '#1e293b' }}>{r.courseName}</strong>
                        {r.batchName && <small style={{ color: '#64748b' }}>{r.batchName}</small>}
                      </td>
                      <td style={{ padding: '12px', color: '#334155' }}>{r.teacherName}</td>
                      <td style={{ padding: '12px', color: '#334155' }}>{r.sessionTitle}</td>
                      <td style={{ padding: '12px' }}>
                        <strong style={{ color: '#1e293b' }}>{r.studentName}</strong>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontWeight: 700,
                          fontSize: '11px',
                          textTransform: 'capitalize',
                          background: style.bg,
                          color: style.text,
                        }}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px', color: '#64748b' }}>
                        {r.durationMinutes ? `${r.durationMinutes} min` : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: '1px solid #e2e8f0',
            fontSize: '12px',
            color: '#64748b',
          }}>
            <span>Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} records)</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: '5px 10px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  cursor: pagination.page <= 1 ? 'not-allowed' : 'pointer',
                  opacity: pagination.page <= 1 ? 0.5 : 1,
                }}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={{
                  padding: '5px 10px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer',
                  opacity: pagination.page >= pagination.totalPages ? 0.5 : 1,
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </AdminLayout>
  )
}

