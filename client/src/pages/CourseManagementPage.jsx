import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FiArrowRight, FiBookOpen, FiCalendar, FiCheck, FiCheckCircle, FiChevronRight, FiClock, FiCopy, FiDownload, FiEdit2, FiEye, FiFileText, FiGlobe, FiGrid, FiHelpCircle, FiLink, FiLogOut, FiMenu, FiMinus, FiMoreHorizontal, FiPlay, FiPlus, FiRefreshCw, FiSearch, FiSettings, FiShare2, FiTrash2, FiUsers, FiVideo, FiX } from 'react-icons/fi'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import '../styles/course-management.css'

const money = (amount) => `৳${Number(amount || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'T'
const dateLabel = (value) => {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })
}
const dateTimeLabel = (value) => {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-BD', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function messageFrom(error, fallback) {
  return error.response?.data?.message || fallback
}

function confirmAction(message) {
  return window.confirm(message)
}

/* ── Sub-components ── */

function StatCard({ icon: Icon, title, value, sub }) {
  return (
    <article className="cm-stat-card">
      <div className="cm-stat-icon"><Icon /></div>
      <div className="cm-stat-body">
        <span className="cm-stat-label">{title}</span>
        <div className="cm-stat-value">{value}</div>
        {sub && <span className="cm-stat-sub">{sub}</span>}
      </div>
    </article>
  )
}

function Badge({ children, variant = 'default' }) {
  return <span className={`cm-badge cm-badge-${variant}`}>{children}</span>
}

function Button({ children, onClick, variant = 'primary', disabled, className, type = 'button', icon }) {
  return (
    <button type={type} className={`cm-btn cm-btn-${variant} ${className || ''}`} onClick={onClick} disabled={disabled}>
      {icon && <span className="cm-btn-icon">{icon}</span>}
      {children}
    </button>
  )
}

function Input({ label, value, onChange, type = 'text', placeholder, required, error, helper, select, options }) {
  return (
    <label className={`cm-field ${error ? 'cm-field-error' : ''}`}>
      <span className="cm-field-label">{label}{required && <b aria-hidden="true"> *</b>}</span>
      {select ? (
        <select className="cm-input cm-select" value={value} onChange={onChange} aria-invalid={Boolean(error)}>
          {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      ) : (
        <input className="cm-input" type={type} value={value} onChange={onChange} placeholder={placeholder} aria-invalid={Boolean(error)} />
      )}
      {error && <small className="cm-field-error-text">{error}</small>}
      {helper && !error && <small className="cm-field-helper">{helper}</small>}
    </label>
  )
}

function Toast({ message, tone, onDismiss }) {
  if (!message) return null
  return (
    <div className={`cm-toast cm-toast-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="cm-toast-icon">{tone === 'error' ? <FiX /> : <FiCheckCircle />}</span>
      <span className="cm-toast-text">{message}</span>
      <button type="button" className="cm-toast-dismiss" aria-label="Dismiss" onClick={onDismiss}><FiX /></button>
    </div>
  )
}

/* ── Main Page ── */

export default function CourseManagementPage() {
  const { user, signOut } = useAuth()
  const { listingId } = useParams()
  const uid = user?.uid || `demo-${user?.email || 'teacher'}`

  const [course, setCourse] = useState(null)
  const [courseLoading, setCourseLoading] = useState(true)
  const [courseError, setCourseError] = useState('')

  const [modules, setModules] = useState([])
  const [lessons, setLessons] = useState([])
  const [liveSessions, setLiveSessions] = useState([])
  const [attendanceRecords, setAttendanceRecords] = useState([])

  const [modulesLoading, setModulesLoading] = useState(false)
  const [lessonsLoading, setLessonsLoading] = useState(false)
  const [, setLiveSessionsLoading] = useState(false)
  const [, setAttendanceLoading] = useState(false)

  const [activeTab, setActiveTab] = useState('overview')
  const [toast, setToast] = useState('')
  const [toastTone, setToastTone] = useState('success')

  const [meetStatus, setMeetStatus] = useState(null)
  const [meetLoading, setMeetLoading] = useState(false)

  const [lessonFormOpen, setLessonFormOpen] = useState(false)
  const [editingLesson, setEditingLesson] = useState(null)
  const [lessonForm, setLessonForm] = useState({
    moduleId: '', title: '', description: '', source: 'direct', videoUrl: '', fileId: '',
    thumbnailUrl: '', duration: '', lessonNumber: '', isFreePreview: false, isLockedAfterCompletion: false,
    lectureNotesUrl: '', published: false,
  })
  const [lessonFormErrors, setLessonFormErrors] = useState({})
  const [lessonSaving, setLessonSaving] = useState(false)

  const [moduleFormOpen, setModuleFormOpen] = useState(false)
  const [editingModule, setEditingModule] = useState(null)
  const [moduleForm, setModuleForm] = useState({ name: '', description: '', status: 'active', order: '' })
  const [moduleFormErrors, setModuleFormErrors] = useState({})
  const [moduleSaving, setModuleSaving] = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [publishConfirm, setPublishConfirm] = useState(false)

  const [liveSessionFormOpen, setLiveSessionFormOpen] = useState(false)
  const [editingLiveSession, setEditingLiveSession] = useState(null)
  const [liveSessionForm, setLiveSessionForm] = useState({
    title: '', meetLink: '', meetId: '', status: 'scheduled', scheduledAt: '', targetBatch: '',
    autoAttendance: false, autoRecording: false, notifyStudents: false, rtmpRelay: false,
  })
  const [liveSessionFormErrors, setLiveSessionFormErrors] = useState({})
  const [liveSessionSaving, setLiveSessionSaving] = useState(false)

  const [attendanceSessionId, setAttendanceSessionId] = useState('')
  const [attendanceDraft, setAttendanceDraft] = useState([])
  const [attendanceSaving, setAttendanceSaving] = useState(false)

  const notify = (message, tone = 'success') => {
    setToastTone(tone)
    setToast(message)
    setTimeout(() => setToast(''), 3500)
  }

  const refresh = useCallback(async () => {
    setCourseLoading(true)
    setCourseError('')
    try {
      const { data } = await api.get(`/listings/${encodeURIComponent(listingId)}`)
      setCourse(data.listing || null)
    } catch (err) {
      setCourseError(messageFrom(err, 'Could not load course details.'))
    } finally {
      setCourseLoading(false)
    }
  }, [listingId])

  useEffect(() => {
    if (!listingId) return
    refresh()
  }, [listingId, refresh])

  useEffect(() => {
    if (!course?._id) return
    setModulesLoading(true)
    setLessonsLoading(true)
    Promise.all([
      api.get(`/course-management/${encodeURIComponent(listingId)}/modules`).then(({ data }) => setModules(data.modules || [])),
      api.get(`/course-management/${encodeURIComponent(listingId)}/lessons`).then(({ data }) => setLessons(data.lessons || [])),
      api.get(`/course-management/${encodeURIComponent(listingId)}/live-sessions`).then(({ data }) => setLiveSessions(data.sessions || [])),
    ]).catch((err) => {
      setCourseError(messageFrom(err, 'Could not load course content.'))
    }).finally(() => {
      setModulesLoading(false)
      setLessonsLoading(false)
    })
  }, [course, listingId])

  useEffect(() => {
    if (!listingId) return
    setMeetLoading(true)
    api.get('/course-management/google-meet/status')
      .then(({ data }) => setMeetStatus(data))
      .catch(() => setMeetStatus({ connected: false, configured: false, message: 'Unable to check Google Meet status.' }))
      .finally(() => setMeetLoading(false))
  }, [listingId])

  const loadAttendance = useCallback(async (sessionId) => {
    setAttendanceSessionId(sessionId)
    setAttendanceLoading(true)
    try {
      const { data } = await api.get(`/course-management/${encodeURIComponent(listingId)}/attendance`, {
        params: sessionId ? { sessionId } : undefined,
      })
      const records = data.records || []
      setAttendanceRecords(records)
      if (sessionId) {
        setAttendanceDraft(records.map((r) => ({
          studentUid: r.studentUid,
          studentName: r.studentName,
          status: r.status || null,
        })))
      } else {
        setAttendanceDraft([])
      }
    } catch (err) {
      setCourseError(messageFrom(err, 'Could not load attendance records.'))
    } finally {
      setAttendanceLoading(false)
    }
  }, [listingId])

  /* ── Actions ── */

  const saveModule = async (event) => {
    event.preventDefault()
    setModuleFormErrors({})
    setModuleSaving(true)
    try {
      const body = {
        name: moduleForm.name,
        description: moduleForm.description,
        status: moduleForm.status,
        order: moduleForm.order ? Number(moduleForm.order) : undefined,
      }
      if (editingModule) {
        await api.put(`/course-management/${encodeURIComponent(listingId)}/modules/${encodeURIComponent(editingModule._id)}`, body)
        notify('Module updated.')
      } else {
        await api.post(`/course-management/${encodeURIComponent(listingId)}/modules`, body)
        notify('Module created.')
      }
      setModuleFormOpen(false)
      setEditingModule(null)
      setModuleForm({ name: '', description: '', status: 'active', order: '' })
      await refresh()
    } catch (err) {
      setModuleFormErrors({ _form: messageFrom(err, 'Could not save module.') })
    } finally {
      setModuleSaving(false)
    }
  }

  const saveLesson = async (event) => {
    event.preventDefault()
    setLessonFormErrors({})
    setLessonSaving(true)
    try {
      const body = {
        moduleId: lessonForm.moduleId || undefined,
        title: lessonForm.title,
        description: lessonForm.description,
        source: lessonForm.source,
        videoUrl: lessonForm.videoUrl || undefined,
        thumbnailUrl: lessonForm.thumbnailUrl || undefined,
        duration: lessonForm.duration || undefined,
        lessonNumber: lessonForm.lessonNumber ? Number(lessonForm.lessonNumber) : undefined,
        isFreePreview: lessonForm.isFreePreview,
        isLockedAfterCompletion: lessonForm.isLockedAfterCompletion,
        lectureNotesUrl: lessonForm.lectureNotesUrl || undefined,
        published: lessonForm.published,
      }
      if (editingLesson) {
        await api.put(`/course-management/${encodeURIComponent(listingId)}/lessons/${encodeURIComponent(editingLesson._id)}`, body)
        notify('Lesson updated.')
      } else {
        await api.post(`/course-management/${encodeURIComponent(listingId)}/modules/${encodeURIComponent(lessonForm.moduleId)}/lessons`, body)
        notify('Lesson added to module.')
      }
      setLessonFormOpen(false)
      setEditingLesson(null)
      setLessonForm({
        moduleId: '', title: '', description: '', source: 'direct', videoUrl: '', fileId: '',
        thumbnailUrl: '', duration: '', lessonNumber: '', isFreePreview: false, isLockedAfterCompletion: false,
        lectureNotesUrl: '', published: false,
      })
    } catch (err) {
      setLessonFormErrors({ _form: messageFrom(err, 'Could not save lesson.') })
    } finally {
      setLessonSaving(false)
    }
  }

  const deleteModule = async (module) => {
    if (!confirmAction(`Delete module "${module.name}"? Its lessons will also be removed.`)) return
    try {
      await api.delete(`/course-management/${encodeURIComponent(listingId)}/modules/${encodeURIComponent(module._id)}`)
      notify('Module removed.')
      await refresh()
    } catch (err) {
      setCourseError(messageFrom(err, 'Could not delete module.'))
    }
  }

  const deleteLesson = async (lesson) => {
    if (!confirmAction(`Delete lesson "${lesson.title}"?`)) return
    try {
      await api.delete(`/course-management/${encodeURIComponent(listingId)}/lessons/${encodeURIComponent(lesson._id)}`)
      notify('Lesson removed.')
    } catch (err) {
      setCourseError(messageFrom(err, 'Could not delete lesson.'))
    }
  }

  const saveLiveSession = async (event) => {
    event.preventDefault()
    setLiveSessionFormErrors({})
    setLiveSessionSaving(true)
    try {
      const body = {
        title: liveSessionForm.title,
        meetLink: liveSessionForm.meetLink || undefined,
        meetId: liveSessionForm.meetId || undefined,
        status: liveSessionForm.status,
        scheduledAt: liveSessionForm.scheduledAt || undefined,
        targetBatch: liveSessionForm.targetBatch || undefined,
        autoAttendance: liveSessionForm.autoAttendance,
        autoRecording: liveSessionForm.autoRecording,
        notifyStudents: liveSessionForm.notifyStudents,
        rtmpRelay: liveSessionForm.rtmpRelay,
      }
      if (editingLiveSession) {
        await api.put(`/course-management/${encodeURIComponent(listingId)}/live-sessions/${encodeURIComponent(editingLiveSession._id)}`, body)
        notify('Live session updated.')
      } else {
        await api.post(`/course-management/${encodeURIComponent(listingId)}/live-sessions`, body)
        notify('Live session scheduled.')
      }
      setLiveSessionFormOpen(false)
      setEditingLiveSession(null)
      setLiveSessionForm({ title: '', meetLink: '', meetId: '', status: 'scheduled', scheduledAt: '', targetBatch: '', autoAttendance: false, autoRecording: false, notifyStudents: false, rtmpRelay: false })
    } catch (err) {
      setLiveSessionFormErrors({ _form: messageFrom(err, 'Could not save live session.') })
    } finally {
      setLiveSessionSaving(false)
    }
  }

  const deleteLiveSession = async (session) => {
    if (!confirmAction(`Cancel live session "${session.title}"?`)) return
    try {
      await api.delete(`/course-management/${encodeURIComponent(listingId)}/live-sessions/${encodeURIComponent(session._id)}`)
      notify('Live session cancelled.')
    } catch (err) {
      setCourseError(messageFrom(err, 'Could not cancel live session.'))
    }
  }

  const saveAttendance = async () => {
    if (!attendanceSessionId) return
    setAttendanceSaving(true)
    setCourseError('')
    try {
      await api.post(`/course-management/${encodeURIComponent(listingId)}/attendance`, {
        sessionId: attendanceSessionId,
        records: attendanceDraft,
      })
      notify('Attendance recorded.')
      await loadAttendance(attendanceSessionId)
    } catch (err) {
      setCourseError(messageFrom(err, 'Could not save attendance.'))
    } finally {
      setAttendanceSaving(false)
    }
  }

  const exportAttendanceCsv = async () => {
    if (!attendanceSessionId) return
    try {
      const { data } = await api.get(`/course-management/${encodeURIComponent(listingId)}/attendance/export`, {
        params: { sessionId: attendanceSessionId },
        responseType: 'blob',
      })
      const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(await data.arrayBuffer())], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `teachos-attendance-${listingId}-${attendanceSessionId}.csv`
      link.click()
      URL.revokeObjectURL(url)
      notify('Attendance CSV exported.')
    } catch (err) {
      setCourseError(messageFrom(err, 'Could not export attendance.'))
    }
  }

  const publishCourse = async () => {
    if (!confirmAction('Publishing will make this course visible to enrolled students and send notifications. Continue?')) return
    setPublishConfirm(true)
    try {
      await api.post(`/course-management/${encodeURIComponent(listingId)}/publish`)
      notify('Course published and students notified.')
      setPublishConfirm(false)
      await refresh()
    } catch (err) {
      setPublishConfirm(false)
      setCourseError(messageFrom(err, 'Could not publish course.'))
    }
  }

  /* ── Derived data ── */

  const stats = useMemo(() => {
    const enrolled = course?.enrolledCount || 0
    const activeModules = modules.filter((m) => m.status === 'active').length
    const publishedLessons = lessons.filter((l) => l.published && l.status !== 'removed').length
    const totalDuration = lessons.reduce((sum, l) => {
      const match = (l.duration || '').match(/(\d+)\s*(?:min|mins|minute|minutes)/i)
      return sum + (match ? Number(match[1]) : 0)
    }, 0)
    const upcoming = liveSessions.filter((s) => s.status === 'scheduled' && new Date(s.scheduledAt || 0) > new Date())
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0]
    return { enrolled, activeModules, publishedLessons, totalDuration, upcoming }
  }, [course, modules, lessons, liveSessions])

  const attendanceSummary = useMemo(() => {
    const total = attendanceRecords.length
    const present = attendanceRecords.filter((r) => r.status === 'present').length
    const absent = attendanceRecords.filter((r) => r.status === 'absent').length
    const rate = total ? Math.round((present / total) * 100) : 0
    return { total, present, absent, rate }
  }, [attendanceRecords])

  /* ── Render helpers ── */

  const renderOverview = () => (
    <section className="cm-section cm-overview">
      <div className="cm-page-header">
        <nav className="cm-breadcrumb">
          <Link to="/dashboard">Courses</Link>
          <span className="cm-breadcrumb-separator">/</span>
          <span className="cm-breadcrumb-current">{course?.name || 'Course'}</span>
        </nav>
        <div className="cm-header-actions">
          <h1>{course?.name || 'Untitled Course'}</h1>
          <div className="cm-course-meta">
            <Badge variant={course?.status === 'active' ? 'success' : course?.status === 'draft' ? 'warning' : 'default'}>
              {course?.status || 'draft'}
            </Badge>
            <span className="cm-course-id">ID: {course?._id ? String(course._id).slice(-8).toUpperCase() : '—'}</span>
          </div>
        </div>
        <div className="cm-header-buttons">
          <Button variant="secondary" onClick={() => window.location.href = `/student#listings?preview=${encodeURIComponent(listingId)}`} icon={<FiEye />}>
            Preview as Student
          </Button>
          <Button onClick={() => setPublishConfirm(true)} disabled={publishConfirm} icon={<FiShare2 />}>
            {publishConfirm ? 'Publishing...' : 'Publish & Notify Students'}
          </Button>
        </div>
      </div>

      <div className="cm-stats-grid">
        <StatCard icon={FiUsers} title="Enrolled Students" value={stats.enrolled} sub={course?.capacity ? `${course.enrolledCount || 0} of ${course.capacity}` : 'no cap'} />
        <StatCard icon={FiBookOpen} title="Active Modules" value={stats.activeModules} sub={`${modules.length} total`} />
        <StatCard icon={FiPlay} title="Recorded Lessons" value={stats.publishedLessons} sub={`${stats.totalDuration} min total`} />
        <StatCard icon={FiCalendar} title="Next Scheduled Live" value={stats.upcoming ? dateTimeLabel(stats.upcoming.scheduledAt) : '—'} sub={stats.upcoming ? stats.upcoming.targetBatch || 'All batches' : 'No upcoming sessions'} />
      </div>

      {course?.description && (
        <div className="cm-course-description">
          <h3>Course Overview</h3>
          <p>{course.description}</p>
        </div>
      )}
    </section>
  )

  const renderLiveClass = () => (
    <section className="cm-section cm-live-class">
      <div className="cm-section-header">
        <h2>Live Class Sessions <span className="cm-section-sub">Google Meet</span></h2>
        <div className="cm-section-actions">
          <Button variant="secondary" onClick={() => setLiveSessionFormOpen(true)} disabled={!meetStatus?.configured} icon={<FiPlus />}>
            Schedule Upcoming Class
          </Button>
          <Button onClick={() => setLiveSessionFormOpen(true)} icon={<FiVideo />}>
            Start Instant Live Class
          </Button>
        </div>
      </div>

      <div className="cm-meet-status">
        <div className="cm-meet-indicator">
          <span className={`cm-meet-dot ${meetStatus?.connected ? 'cm-meet-connected' : 'cm-meet-disconnected'}`}></span>
          <span className="cm-meet-text">{meetStatus?.connected ? 'Google Meet connected' : meetStatus?.configured ? 'Google Meet configured — connect your account' : 'Google Meet not configured'}</span>
        </div>
        <span className="cm-meet-detail">{meetStatus?.message}</span>
        {!meetStatus?.configured && (
          <p className="cm-meet-hint">Set GOOGLE_MEET_CLIENT_ID and GOOGLE_MEET_CLIENT_SECRET in server/.env to enable Google Meet integration.</p>
        )}
      </div>

      <div className="cm-session-launcher">
        <h3>Session Launcher</h3>
        <div className="cm-launcher-grid">
          <Input label="Session Topic" value={liveSessionForm.title} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, title: e.target.value })} placeholder="e.g., Faraday's Law Masterclass" error={liveSessionFormErrors.title} />
          <Input label="Target Batch" value={liveSessionForm.targetBatch} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, targetBatch: e.target.value })} placeholder="e.g., Morning Batch A &amp; B" />
          <Input label="Scheduled At" type="datetime-local" value={liveSessionForm.scheduledAt} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, scheduledAt: e.target.value })} />
          <div className="cm-launcher-actions">
            <Button variant="secondary" onClick={() => setLiveSessionFormOpen(false)}>Cancel</Button>
            <Button onClick={saveLiveSession} disabled={liveSessionSaving} icon={<FiPlay />}>
              {liveSessionSaving ? 'Creating...' : 'Create Session'}
            </Button>
          </div>
        </div>
      </div>

      <div className="cm-session-settings">
        <h3>Session Settings</h3>
        <div className="cm-setting-row">
          <label className="cm-toggle">
            <input type="checkbox" checked={liveSessionForm.autoAttendance} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, autoAttendance: e.target.checked })} />
            <span className="cm-toggle-slider"></span>
            Auto Attendance
          </label>
          <label className="cm-toggle">
            <input type="checkbox" checked={liveSessionForm.autoRecording} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, autoRecording: e.target.checked })} />
            <span className="cm-toggle-slider"></span>
            Auto Record to Cloud
          </label>
          <label className="cm-toggle">
            <input type="checkbox" checked={liveSessionForm.notifyStudents} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, notifyStudents: e.target.checked })} />
            <span className="cm-toggle-slider"></span>
            Notify Students
          </label>
          <label className="cm-toggle">
            <input type="checkbox" checked={liveSessionForm.rtmpRelay} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, rtmpRelay: e.target.checked })} />
            <span className="cm-toggle-slider"></span>
            In-App RTMP Relay
          </label>
        </div>
        <p className="cm-settings-note">Google Meet session creation requires an authenticated Google Meet connection. Until configured, sessions are scheduled locally in TeachOS.</p>
      </div>

      <div className="cm-upcoming-schedule">
        <div className="cm-schedule-header">
          <h3>Upcoming Live Schedule</h3>
          <Button variant="secondary" onClick={() => setLiveSessionFormOpen(true)} icon={<FiPlus />}>Add Slot</Button>
        </div>
        <div className="cm-session-list">
          {liveSessions.length ? liveSessions.map((session) => (
            <article key={session._id} className={`cm-session-item ${session.status === 'live' ? 'cm-session-live' : ''}`}>
              <div className="cm-session-info">
                <div className="cm-session-date">
                  <span className="cm-session-day">{new Date(session.scheduledAt || 0).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span>
                  <span className="cm-session-day-num">{new Date(session.scheduledAt || 0).getDate()}</span>
                </div>
                <div className="cm-session-details">
                  <h4>{session.title}</h4>
                  <p>{dateTimeLabel(session.scheduledAt)} • {session.targetBatch || 'All batches'}</p>
                </div>
              </div>
              <div className="cm-session-status">
                <Badge variant={session.status === 'live' ? 'error' : session.status === 'completed' ? 'default' : 'info'}>{session.status}</Badge>
              </div>
              <div className="cm-session-actions">
                <Button variant="secondary" size="small" onClick={() => {
                  setEditingLiveSession(session)
                  setLiveSessionForm({
                    title: session.title, meetLink: session.meetLink || '', meetId: session.meetId || '',
                    status: session.status, scheduledAt: session.scheduledAt ? new Date(session.scheduledAt).toISOString().slice(0, 16) : '',
                    targetBatch: session.targetBatch || '', autoAttendance: session.autoAttendance, autoRecording: session.autoRecording,
                    notifyStudents: session.notifyStudents, rtmpRelay: session.rtmpRelay,
                  })
                  setLiveSessionFormOpen(true)
                }} icon={<FiEdit2 />}>Edit</Button>
                <Button variant="secondary" size="small" onClick={() => {
                  if (session.notifyStudents) notify('Students notified.')
                  else notify('Notify students action not available until Google Meet is connected.')
                }} icon={<FiShare2 />}>Notify</Button>
                <Button variant="secondary" size="small" className="cm-session-delete" onClick={() => deleteLiveSession(session)} icon={<FiTrash2 />}>Cancel</Button>
              </div>
            </article>
          )) : (
            <p className="cm-empty">No upcoming live sessions scheduled.</p>
          )}
        </div>
      </div>
    </section>
  )

  const renderAttendance = () => (
    <section className="cm-section cm-attendance">
      <div className="cm-section-header">
        <h2>Attendance & Engagement</h2>
        <Button onClick={() => setActiveTab('live')}>Back to Live Sessions</Button>
      </div>

      <div className="cm-attendance-metrics">
        <StatCard icon={FiCheckCircle} title="Attendance Rate" value={`${attendanceSummary.rate}%`} sub={`${attendanceSummary.present} of ${attendanceSummary.total} marked`} />
        <StatCard icon={FiUsers} title="Attended" value={attendanceSummary.present} sub="Present" />
        <StatCard icon={FiX} title="Missed" value={attendanceSummary.absent} sub="Absent" />
      </div>

      <div className="cm-attendance-toolbar">
        <label className="cm-field">
          <span>Session</span>
          <select className="cm-input cm-select" value={attendanceSessionId} onChange={(e) => loadAttendance(e.target.value || undefined)}>
            <option value="">All sessions</option>
            {liveSessions.map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
          </select>
        </label>
        {attendanceSessionId && (
          <>
            <Button variant="secondary" onClick={exportAttendanceCsv} icon={<FiDownload />}>Export CSV</Button>
            <div className="cm-attendance-records">
              <h3>Attendance Records</h3>
              {attendanceRecords.length ? (
                <table className="cm-table">
                  <thead>
                    <tr><th>Student</th><th>Status</th><th>Joined</th><th>Left</th><th>Duration</th></tr>
                  </thead>
                  <tbody>
                    {attendanceRecords.map((record) => (
                      <tr key={`${record.sessionId}-${record.studentUid}`}>
                        <td><span className="cm-student-avatar">{initials(record.studentName)}</span> {record.studentName}</td>
                        <td><span className={`cm-status-pill ${record.status}`}>{record.status}</span></td>
                        <td>{dateTimeLabel(record.joinedAt)}</td>
                        <td>{dateTimeLabel(record.leftAt) || '—'}</td>
                        <td>{record.durationMinutes || 0} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="cm-empty">No attendance records for this session.</p>
              )}
            </div>
            <div className="cm-attendance-entry">
              <h3>Mark Attendance</h3>
              <p className="cm-attendance-hint">TeachOS does not auto-verify Google Meet attendance. Mark students manually below.</p>
              <div className="cm-attendance-grid">
                {attendanceDraft.map((record, index) => (
                  <div key={index} className="cm-attendance-row">
                    <span className="cm-attendance-student">{record.studentName}</span>
                    <div className="cm-attendance-controls">
                      {['present', 'absent', 'late'].map((status) => (
                        <button key={status} type="button" className={`cm-attendance-btn ${attendanceDraft[index]?.status === status ? 'cm-attendance-selected' : ''}`} onClick={() => {
                          const next = attendanceDraft.map((r, i) => i === index ? { ...r, status } : r)
                          setAttendanceDraft(next)
                        }}>{status}</button>
                      ))}
                    </div>
                  </div>
                ))}
                {attendanceDraft.length === 0 && <p className="cm-empty">Select a session above to mark attendance.</p>}
              </div>
              {attendanceDraft.length > 0 && (
                <div className="cm-attendance-footer">
                  <Button variant="secondary" onClick={() => setAttendanceDraft(attendanceDraft.map((r) => ({ ...r, status: 'present' })))}>Mark All Present</Button>
                  <Button onClick={saveAttendance} disabled={attendanceSaving} icon={<FiCheck />}>
                    {attendanceSaving ? 'Saving...' : 'Save Attendance'}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )

  const renderModulesLessons = () => (
    <section className="cm-section cm-modules-lessons">
      <div className="cm-section-header">
        <h2>Course Modules &amp; Recorded Videos</h2>
        <div className="cm-section-actions">
          <Button variant="secondary" onClick={() => setModuleFormOpen(true)} icon={<FiPlus />}>Add Module</Button>
          <Button onClick={() => setLessonFormOpen(true)} icon={<FiVideo />}>Add Video Lesson</Button>
        </div>
      </div>

      <div className="cm-modules-grid">
        {modules.length ? modules.map((module) => {
          const moduleLessons = lessons.filter((l) => String(l.moduleId) === String(module._id) && l.status !== 'removed')
          const publishedCount = moduleLessons.filter((l) => l.published).length
          return (
            <article key={module._id} className="cm-module-card">
              <header className="cm-module-header">
                <div className="cm-module-title">
                  <h3>{module.name}</h3>
                  <Badge variant={module.status === 'active' ? 'success' : 'default'}>{module.status}</Badge>
                </div>
                <div className="cm-module-actions">
                  <Button variant="secondary" size="small" onClick={() => {
                    setEditingModule(module)
                    setModuleForm({ name: module.name, description: module.description || '', status: module.status, order: module.order?.toString() || '' })
                    setModuleFormOpen(true)
                  }} icon={<FiEdit2 />}>Edit</Button>
                  <Button variant="secondary" size="small" className="cm-delete" onClick={() => deleteModule(module)} icon={<FiTrash2 />}>Delete</Button>
                </div>
              </header>
              <div className="cm-module-body">
                <p className="cm-module-desc">{module.description || 'No description'}</p>
                <div className="cm-module-progress">
                  <span>{publishedCount} of {moduleLessons.length} lessons published</span>
                  <div className="cm-progress-bar"><div className="cm-progress-fill" style={{ width: moduleLessons.length ? Math.round((publishedCount / moduleLessons.length) * 100) : 0 }} /></div>
                </div>
                <div className="cm-module-lessons">
                  {moduleLessons.length ? moduleLessons.map((lesson) => (
                    <article key={lesson._id} className="cm-lesson-row">
                      <div className="cm-lesson-info">
                        <span className="cm-lesson-number">Lesson {lesson.lessonNumber}</span>
                        <h4>{lesson.title}</h4>
                        <span className={`cm-lesson-badge ${lesson.published ? 'cm-lesson-published' : 'cm-lesson-draft'}`}>{lesson.published ? 'Published' : 'Draft'}</span>
                        <span className="cm-lesson-source">{lesson.source}</span>
                        <span className="cm-lesson-duration">{lesson.duration || '—'}</span>
                      </div>
                      <div className="cm-lesson-actions">
                        <Button variant="secondary" size="small" onClick={() => {
                          setEditingLesson(lesson)
                          setLessonForm({
                            moduleId: String(lesson.moduleId || ''), title: lesson.title, description: lesson.description || '',
                            source: lesson.source, videoUrl: lesson.videoUrl || '', thumbnailUrl: lesson.thumbnailUrl || '',
                            duration: lesson.duration || '', lessonNumber: lesson.lessonNumber?.toString() || '',
                            isFreePreview: lesson.isFreePreview, isLockedAfterCompletion: lesson.isLockedAfterCompletion,
                            lectureNotesUrl: lesson.lectureNotesUrl || '', published: lesson.published,
                          })
                          setLessonFormOpen(true)
                        }} icon={<FiEdit2 />}>Edit</Button>
                        <Button variant="secondary" size="small" className="cm-delete" onClick={() => deleteLesson(lesson)} icon={<FiTrash2 />}>Delete</Button>
                      </div>
                    </article>
                  )) : <p className="cm-empty">No lessons in this module yet.</p>}
                </div>
              </div>
            </article>
          )
        }) : (
          <div className="cm-empty-state">
            <FiBookOpen size={32} />
            <h3>No modules yet</h3>
            <p>Create your first module to start building your course.</p>
            <Button onClick={() => setModuleFormOpen(true)} icon={<FiPlus />}>Create Module</Button>
          </div>
        )}
      </div>
    </section>
  )

  const renderLessonLibrary = () => {
    const publishedLessons = lessons.filter((l) => l.published && l.status !== 'removed')
    return (
      <section className="cm-section cm-lesson-library">
        <div className="cm-section-header">
          <h2>Published Lesson Library</h2>
          <div className="cm-library-toolbar">
            <Input label="Search lessons" value="" onChange={() => {}} placeholder="Search by title..." />
            <Button variant="secondary" size="small">Filter by Module</Button>
            <Button variant="secondary" size="small">Filter by Status</Button>
          </div>
        </div>
        <div className="cm-lesson-library-list">
          {publishedLessons.length ? publishedLessons.map((lesson) => (
            <article key={lesson._id} className="cm-library-item">
              <div className="cm-library-thumb">
                <img src={lesson.thumbnailUrl || 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=400&q=85'} alt={lesson.title} />
                <span className="cm-library-duration">{lesson.duration || '—'}</span>
                <Badge variant={lesson.isFreePreview ? 'success' : 'default'}>{lesson.isFreePreview ? 'Free Preview' : 'Locked'}</Badge>
              </div>
              <div className="cm-library-info">
                <span className="cm-library-number">Lesson {lesson.lessonNumber}</span>
                <h4>{lesson.title}</h4>
                <p className="cm-library-meta">{lesson.source} • {dateLabel(lesson.publishedAt || lesson.createdAt)}</p>
              </div>
              <div className="cm-library-actions">
                <Button variant="secondary" size="small" icon={<FiEye />}>Preview</Button>
                <Button variant="secondary" size="small" icon={<FiCopy />}>Duplicate</Button>
                <Button variant="secondary" size="small" className="cm-delete" onClick={() => deleteLesson(lesson)} icon={<FiTrash2 />}>Delete</Button>
              </div>
            </article>
          )) : (
            <div className="cm-empty-state">
              <FiPlay size={32} />
              <h3>No published lessons</h3>
              <p>Publish lessons from the module builder to add them to the library.</p>
            </div>
          )}
        </div>
      </section>
    )
  }

  /* ── Modals ── */

  const renderModuleModal = () => {
    if (!moduleFormOpen) return null
    return (
      <div className="cm-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setModuleFormOpen(false) }}>
        <section className="cm-modal" role="dialog" aria-modal="true" aria-label="Module">
          <header className="cm-modal-header">
            <div>
              <p className="cm-modal-eyebrow">{editingModule ? 'Edit Module' : 'Add Module'}</p>
              <h2>{editingModule ? 'Edit Module' : 'Add New Module'}</h2>
            </div>
            <button type="button" className="cm-modal-close" aria-label="Close" onClick={() => setModuleFormOpen(false)}><FiX /></button>
          </header>
          <form className="cm-modal-form" onSubmit={saveModule} noValidate>
            {moduleFormErrors._form && <p className="cm-modal-error">{moduleFormErrors._form}</p>}
            <Input label="Module Name" value={moduleForm.name} onChange={(e) => setModuleForm({ ...moduleForm, name: e.target.value })} placeholder="e.g., Module 1: Introduction" required error={moduleFormErrors.name} />
            <Input label="Description" value={moduleForm.description} onChange={(e) => setModuleForm({ ...moduleForm, description: e.target.value })} placeholder="What will students learn in this module?" />
            <div className="cm-modal-form-row">
              <Input label="Status" select value={moduleForm.status} onChange={(e) => setModuleForm({ ...moduleForm, status: e.target.value })} options={[{ value: 'active', label: 'Active' }, { value: 'draft', label: 'Draft' }, { value: 'completed', label: 'Completed' }]} />
              <Input label="Order" type="number" value={moduleForm.order} onChange={(e) => setModuleForm({ ...moduleForm, order: e.target.value })} placeholder="1" />
            </div>
            <div className="cm-modal-footer">
              <Button variant="secondary" type="button" onClick={() => setModuleFormOpen(false)}>Cancel</Button>
              <Button onClick={saveModule} disabled={moduleSaving}>{moduleSaving ? 'Saving...' : (editingModule ? 'Save Changes' : 'Create Module')}</Button>
            </div>
          </form>
        </section>
      </div>
    )
  }

  const renderLessonModal = () => {
    if (!lessonFormOpen) return null
    return (
      <div className="cm-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setLessonFormOpen(false) }}>
        <section className="cm-modal cm-modal-wide" role="dialog" aria-modal="true" aria-label="Video Lesson">
          <header className="cm-modal-header">
            <div>
              <p className="cm-modal-eyebrow">{editingLesson ? 'Edit Lesson' : 'Add Video Lesson'}</p>
              <h2>{editingLesson ? 'Edit Video Lesson' : 'Add New Video Lesson'}</h2>
            </div>
            <button type="button" className="cm-modal-close" aria-label="Close" onClick={() => setLessonFormOpen(false)}><FiX /></button>
          </header>
          <form className="cm-modal-form" onSubmit={saveLesson} noValidate>
            {lessonFormErrors._form && <p className="cm-modal-error">{lessonFormErrors._form}</p>}
            <div className="cm-lesson-sources">
              <span className="cm-source-label">Video Source</span>
              <div className="cm-source-tabs">
                {['youtube', 'vimeo', 'gdrive', 'direct'].map((source) => (
                  <button key={source} type="button" className={`cm-source-tab ${lessonForm.source === source ? 'cm-source-active' : ''}`} onClick={() => setLessonForm({ ...lessonForm, source })}>
                    {source === 'youtube' ? <FiGlobe size={16} /> : source === 'vimeo' ? <FiGlobe size={16} /> : source === 'gdrive' ? <FiGlobe size={16} /> : <FiVideo size={16} />}
                    {source}
                  </button>
                ))}
              </div>
            </div>
            <Input label="Module" select value={lessonForm.moduleId} onChange={(e) => setLessonForm({ ...lessonForm, moduleId: e.target.value })} options={modules.map((m) => ({ value: String(m._id), label: m.name }))} required error={lessonFormErrors.moduleId} />
            <Input label="Lesson Title" value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} placeholder="e.g., Lesson 25: Self-Inductance" required error={lessonFormErrors.title} />
            <Input label="Video URL / Embed Link" value={lessonForm.videoUrl} onChange={(e) => setLessonForm({ ...lessonForm, videoUrl: e.target.value })} placeholder={lessonForm.source === 'youtube' ? 'https://youtu.be/...' : lessonForm.source === 'vimeo' ? 'https://vimeo.com/...' : lessonForm.source === 'gdrive' ? 'https://drive.google.com/file/d/...' : 'Direct MP4 URL'} error={lessonFormErrors.videoUrl} helper={lessonForm.source === 'direct' ? 'Direct MP4 uploads use the existing TeachOS media storage.' : undefined} />
            <div className="cm-modal-form-row">
              <Input label="Lesson Number" type="number" value={lessonForm.lessonNumber} onChange={(e) => setLessonForm({ ...lessonForm, lessonNumber: e.target.value })} placeholder="25" />
              <Input label="Duration" value={lessonForm.duration} onChange={(e) => setLessonForm({ ...lessonForm, duration: e.target.value })} placeholder="48:15" />
            </div>
            <Input label="Description" value={lessonForm.description} onChange={(e) => setLessonForm({ ...lessonForm, description: e.target.value })} rows={2} placeholder="What will students learn?" />
            <Input label="Thumbnail URL" value={lessonForm.thumbnailUrl} onChange={(e) => setLessonForm({ ...lessonForm, thumbnailUrl: e.target.value })} placeholder="https://..." helper="Optional cover image for the lesson library." />
            <Input label="Lecture Notes (PDF URL)" value={lessonForm.lectureNotesUrl} onChange={(e) => setLessonForm({ ...lessonForm, lectureNotesUrl: e.target.value })} placeholder="https://..." helper="Optional PDF attachment." />
            <div className="cm-lesson-options">
              <label className="cm-toggle">
                <input type="checkbox" checked={lessonForm.isFreePreview} onChange={(e) => setLessonForm({ ...lessonForm, isFreePreview: e.target.checked })} />
                <span className="cm-toggle-slider"></span>
                Free Preview for unregistered visitors
              </label>
              <label className="cm-toggle">
                <input type="checkbox" checked={lessonForm.isLockedAfterCompletion} onChange={(e) => setLessonForm({ ...lessonForm, isLockedAfterCompletion: e.target.checked })} />
                <span className="cm-toggle-slider"></span>
                Lock content after batch completion
              </label>
              <label className="cm-toggle">
                <input type="checkbox" checked={lessonForm.published} onChange={(e) => setLessonForm({ ...lessonForm, published: e.target.checked })} />
                <span className="cm-toggle-slider"></span>
                Publish immediately
              </label>
            </div>
            <div className="cm-modal-footer">
              <Button variant="secondary" type="button" onClick={() => setLessonFormOpen(false)}>Cancel</Button>
              <Button onClick={saveLesson} disabled={lessonSaving} icon={<FiVideo />}>
                {lessonSaving ? 'Saving...' : (editingLesson ? 'Save Changes' : 'Save & Add to Module')}
              </Button>
            </div>
          </form>
        </section>
      </div>
    )
  }

  const renderLiveSessionModal = () => {
    if (!liveSessionFormOpen) return null
    return (
      <div className="cm-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setLiveSessionFormOpen(false) }}>
        <section className="cm-modal" role="dialog" aria-modal="true" aria-label="Live Session">
          <header className="cm-modal-header">
            <div>
              <p className="cm-modal-eyebrow">{editingLiveSession ? 'Edit Live Session' : 'Schedule Live Session'}</p>
              <h2>{editingLiveSession ? 'Edit Live Session' : 'Schedule New Live Session'}</h2>
            </div>
            <button type="button" className="cm-modal-close" aria-label="Close" onClick={() => setLiveSessionFormOpen(false)}><FiX /></button>
          </header>
          <form className="cm-modal-form" onSubmit={saveLiveSession} noValidate>
            {liveSessionFormErrors._form && <p className="cm-modal-error">{liveSessionFormErrors._form}</p>}
            <Input label="Session Topic" value={liveSessionForm.title} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, title: e.target.value })} placeholder="e.g., Faraday's Law Masterclass" required error={liveSessionFormErrors.title} />
            <Input label="Google Meet Link" value={liveSessionForm.meetLink} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, meetLink: e.target.value })} placeholder="https://meet.google.com/..." helper="Create the meeting in Google Meet, then paste the link here." error={liveSessionFormErrors.meetLink} />
            <Input label="Target Batch" value={liveSessionForm.targetBatch} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, targetBatch: e.target.value })} placeholder="e.g., All Enrolled Students" />
            <Input label="Scheduled At" type="datetime-local" value={liveSessionForm.scheduledAt} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, scheduledAt: e.target.value })} />
            <div className="cm-lesson-options">
              <label className="cm-toggle">
                <input type="checkbox" checked={liveSessionForm.autoAttendance} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, autoAttendance: e.target.checked })} />
                <span className="cm-toggle-slider"></span>
                Auto Attendance
              </label>
              <label className="cm-toggle">
                <input type="checkbox" checked={liveSessionForm.autoRecording} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, autoRecording: e.target.checked })} />
                <span className="cm-toggle-slider"></span>
                Auto Recording
              </label>
              <label className="cm-toggle">
                <input type="checkbox" checked={liveSessionForm.notifyStudents} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, notifyStudents: e.target.checked })} />
                <span className="cm-toggle-slider"></span>
                Student Notifications
              </label>
              <label className="cm-toggle">
                <input type="checkbox" checked={liveSessionForm.rtmpRelay} onChange={(e) => setLiveSessionForm({ ...liveSessionForm, rtmpRelay: e.target.checked })} />
                <span className="cm-toggle-slider"></span>
                In-App Streaming / RTMP Relay
              </label>
            </div>
            <div className="cm-modal-footer">
              <Button variant="secondary" type="button" onClick={() => setLiveSessionFormOpen(false)}>Cancel</Button>
              <Button onClick={saveLiveSession} disabled={liveSessionSaving} icon={<FiCalendar />}>
                {liveSessionSaving ? 'Creating...' : (editingLiveSession ? 'Save Session' : 'Schedule Session')}
              </Button>
            </div>
          </form>
        </section>
      </div>
    )
  }

  if (courseError && !course) {
    return (
      <div className="cm-error-state">
        <FiAlertTriangle size={48} />
        <h2>Course Not Found</h2>
        <p>{courseError}</p>
        <Button onClick={() => window.location.href = '/dashboard/listings'}>Back to My Listings</Button>
      </div>
    )
  }

  if (courseLoading && !course) {
    return <div className="cm-loading">Loading course management page...</div>
  }

  return (
    <div className="cm-page">
      <aside className="cm-sidebar">
        <Link className="cm-brand" to="/dashboard">TeachOS</Link>
        <div className="cm-user">
          <span className="cm-avatar">{initials(user?.fullName || user?.email || 'Teacher')}</span>
          <div>
            <strong>{user?.fullName || user?.email?.split('@')[0] || 'Teacher'}</strong>
            <span>Teacher workspace</span>
          </div>
        </div>
        <nav className="cm-nav">
          <Link to="/dashboard" className="cm-nav-item"><FiGrid /> Dashboard</Link>
          <Link to="/dashboard/listings" className="cm-nav-item"><FiBookOpen /> My Listings</Link>
          <a className="cm-nav-item active" href="#"><FiVideo /> Course Management</a>
          <Link to="/dashboard/attendance" className="cm-nav-item"><FiCheck /> Attendance</Link>
          <Link to="/dashboard/directory" className="cm-nav-item"><FiUsers /> Directory</Link>
          <Link to="/dashboard/payments" className="cm-nav-item"><FiCalendar /> Payments</Link>
        </nav>
        <div className="cm-nav-footer">
          <a href="mailto:support@teachos.example"><FiHelpCircle /> Support</a>
          <button type="button" onClick={signOut}><FiLogOut /> Sign out</button>
        </div>
      </aside>
      <main className="cm-main">
        <header className="cm-topbar">
          <label className="cm-search"><FiSearch /><input placeholder={`Search ${course?.name}...`} aria-label="Search course" /></label>
          <div className="cm-topbar-user">{user?.email}</div>
        </header>
        <div className="cm-content">
          <header className="cm-page-heading">
            <div>
              <p className="cm-eyebrow">Teacher workspace</p>
              <h1>Course Management</h1>
              <span>{course?.name}</span>
            </div>
          </header>
          {toast && <Toast message={toast} tone={toastTone} onDismiss={() => setToast('')} />}
          {courseError && <div className="cm-error-banner" role="alert">{courseError}<button type="button" onClick={() => { setCourseError(''); refresh() }}>Retry</button></div>}
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'live' && renderLiveClass()}
          {activeTab === 'attendance' && renderAttendance()}
          {activeTab === 'modules' && renderModulesLessons()}
          {activeTab === 'library' && renderLessonLibrary()}
          <nav className="cm-tab-nav" aria-label="Course management sections">
            <button className={`cm-tab ${activeTab === 'overview' ? 'cm-tab-active' : ''}`} onClick={() => setActiveTab('overview')}>
              <FiGrid size={18} /> Overview
            </button>
            <button className={`cm-tab ${activeTab === 'live' ? 'cm-tab-active' : ''}`} onClick={() => setActiveTab('live')}>
              <FiVideo size={18} /> Live Classes
            </button>
            <button className={`cm-tab ${activeTab === 'attendance' ? 'cm-tab-active' : ''}`} onClick={() => setActiveTab('attendance')}>
              <FiCheck size={18} /> Attendance
            </button>
            <button className={`cm-tab ${activeTab === 'modules' ? 'cm-tab-active' : ''}`} onClick={() => setActiveTab('modules')}>
              <FiBookOpen size={18} /> Modules &amp; Videos
            </button>
            <button className={`cm-tab ${activeTab === 'library' ? 'cm-tab-active' : ''}`} onClick={() => setActiveTab('library')}>
              <FiFileText size={18} /> Lesson Library
            </button>
          </nav>
        </div>
        <footer className="cm-footer"><Link to="/dashboard">TeachOS</Link><span>Course data is stored in MongoDB.</span></footer>
      </main>
      {renderModuleModal()}
      {renderLessonModal()}
      {renderLiveSessionModal()}
    </div>
  )
}
