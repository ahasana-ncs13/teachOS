import { useEffect, useState } from 'react'
import { FiBookOpen, FiCalendar, FiPlay, FiPlus, FiUsers, FiVideo } from 'react-icons/fi'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { uploadCourseVideo } from '../lib/courseVideos'
import { WorkspaceFrame } from './WorkspacePages'

export function TeacherClassesPage({ defaultType = 'recorded' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const activeTab = requestedTab === 'live'
    ? 'live'
    : requestedTab === 'recorded' || requestedTab === 'modules' || requestedTab === 'library'
      ? 'recorded'
      : location.pathname.endsWith('/live-classes')
        ? 'live'
        : location.pathname.endsWith('/recorded-classes')
          ? 'recorded'
          : defaultType
  const isLive = activeTab === 'live'
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [meetStatus, setMeetStatus] = useState(null)
  const [meetLoading, setMeetLoading] = useState(false)
  const [meetBusy, setMeetBusy] = useState(false)
  const [meetMessage, setMeetMessage] = useState('')
  const [meetError, setMeetError] = useState('')
  const [recordingFor, setRecordingFor] = useState('')
  const [recordedSaving, setRecordedSaving] = useState(false)
  const [recordedUploadProgress, setRecordedUploadProgress] = useState(0)
  const [recordedError, setRecordedError] = useState('')
  const [recordedMessage, setRecordedMessage] = useState('')
  const [recordedForm, setRecordedForm] = useState({
    title: '',
    source: 'youtube',
    videoUrl: '',
    videoFile: null,
    description: '',
    duration: '',
    published: true,
  })

  useEffect(() => {
    let current = true
    api.get('/listings/my', { params: { page: 1, limit: 100 } })
      .then(({ data }) => {
        if (current) setListings(data.listings || [])
      })
      .catch((requestError) => {
        if (current) setError(requestError.response?.data?.message || 'Could not load your courses.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => { current = false }
  }, [retry])

  useEffect(() => {
    if (!isLive) return undefined
    let current = true
    setMeetLoading(true)
    setMeetError('')
    api.get('/course-management/google-meet/status')
      .then(({ data }) => {
        if (current) setMeetStatus(data)
      })
      .catch((requestError) => {
        if (current) setMeetError(requestError.response?.data?.message || 'Could not check Google Calendar connection.')
      })
      .finally(() => {
        if (current) setMeetLoading(false)
      })
    return () => { current = false }
  }, [isLive])

  useEffect(() => {
    const result = searchParams.get('googleMeet')
    if (!result) return
    setMeetMessage(result === 'connected'
      ? 'Google Calendar connected. You can now create Meet links while scheduling a session.'
      : result === 'cancelled'
        ? 'Google account connection was cancelled.'
        : 'Google connection failed. Check OAuth settings and the authorized redirect URI.')
    setMeetError(result === 'error')
    const next = new URLSearchParams(searchParams)
    next.delete('googleMeet')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const connectGoogleMeet = async () => {
    setMeetBusy(true)
    setMeetError('')
    setMeetMessage('')
    try {
      const { data } = await api.get('/course-management/google-meet/connect')
      window.location.assign(data.authorizationUrl)
    } catch (requestError) {
      setMeetError(requestError.response?.data?.message || 'Could not start Google account connection.')
      setMeetBusy(false)
    }
  }

  const disconnectGoogleMeet = async () => {
    setMeetBusy(true)
    setMeetError('')
    setMeetMessage('')
    try {
      await api.delete('/course-management/google-meet/connection')
      setMeetStatus((current) => ({ ...current, connected: false }))
      setMeetMessage('Google Calendar disconnected.')
    } catch (requestError) {
      setMeetError(requestError.response?.data?.message || 'Could not disconnect Google Calendar.')
    } finally {
      setMeetBusy(false)
    }
  }

  const retryLoad = () => {
    setError('')
    setLoading(true)
    setRetry((value) => value + 1)
  }

  const openRecordedForm = (listingId) => {
    setRecordingFor(listingId)
    setRecordedError('')
    setRecordedMessage('')
  }

  const submitRecordedClass = async (event, listingId) => {
    event.preventDefault()
    setRecordedError('')
    setRecordedMessage('')
    setRecordedSaving(true)
    try {
      const uploadedVideo = recordedForm.videoFile
        ? await uploadCourseVideo(listingId, recordedForm.videoFile, (progress) => {
          if (progress.total) setRecordedUploadProgress(Math.round((progress.loaded / progress.total) * 100))
        })
        : null
      const { data } = await api.post(`/course-management/${encodeURIComponent(listingId)}/lessons`, {
        ...recordedForm,
        videoFile: undefined,
        videoUrl: uploadedVideo ? undefined : recordedForm.videoUrl,
        fileId: uploadedVideo?.fileId,
        source: uploadedVideo ? 'direct' : recordedForm.source,
      })
      setRecordedForm({ title: '', source: 'youtube', videoUrl: '', videoFile: null, description: '', duration: '', published: true })
      setRecordingFor('')
      setRecordedMessage(recordedForm.published
        ? data.lesson?.notificationsSent ? 'Recorded class published. Enrolled students have been notified.' : 'Recorded class published, but student notifications could not be sent.'
        : 'Recorded class saved as a draft.')
    } catch (requestError) {
      setRecordedError(requestError.response?.data?.message || 'Could not save this recorded class.')
    } finally {
      setRecordedSaving(false)
      setRecordedUploadProgress(0)
    }
  }

  const title = 'Classes & lessons'
  const description = 'Manage your recorded lessons and live sessions together, organized by course.'

  const selectTab = (tab) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next)
  }

  return <WorkspaceFrame title={title} description={description} onQuickAction={() => navigate('/dashboard/actions')}>
    <div className="teacher-studio-tabs" role="tablist" aria-label="Class content type">
      <button type="button" role="tab" aria-selected={!isLive} className={!isLive ? 'active' : ''} onClick={() => selectTab('recorded')}>
        <FiPlay aria-hidden="true" /> Recorded lessons
      </button>
      <button type="button" role="tab" aria-selected={isLive} className={isLive ? 'active' : ''} onClick={() => selectTab('live')}>
        <FiVideo aria-hidden="true" /> Live sessions
      </button>
    </div>
    <p className="teacher-studio-description">{isLive
      ? 'Schedule sessions, manage meeting links, and take attendance for each course.'
      : 'Add or edit recorded lessons and browse your published lesson library.'}</p>
    {!isLive && recordedMessage && <p className="teacher-studio-recorded-message" role="status">{recordedMessage}</p>}
    {isLive && <section className="teacher-studio-meet" aria-label="Google Meet connection">
      <div className="teacher-studio-meet-copy">
        <span className={`teacher-studio-meet-icon${meetStatus?.connected ? ' connected' : ''}`}><FiVideo aria-hidden="true" /></span>
        <div>
          <strong>{meetLoading ? 'Checking Google Calendar…' : meetStatus?.connected ? 'Google Calendar connected' : 'Google Meet setup'}</strong>
          <p>{meetStatus?.connected
            ? 'Create a real Google Meet link automatically when you schedule a live session.'
            : meetStatus?.message || 'Connect your Google account to create Meet links from TeachOS.'}</p>
        </div>
      </div>
      {meetStatus?.configured && <button className="workspace-secondary" type="button" disabled={meetLoading || meetBusy} onClick={meetStatus.connected ? disconnectGoogleMeet : connectGoogleMeet}>
        {meetBusy ? 'Please wait…' : meetStatus.connected ? 'Disconnect Google' : 'Connect Google Calendar'}
      </button>}
      {!meetStatus?.configured && <span className="teacher-studio-meet-unavailable">Setup required</span>}
      {!meetStatus?.configured && meetStatus?.redirectUri && <p className="teacher-studio-meet-redirect">Authorized redirect URI: <code>{meetStatus.redirectUri}</code></p>}
      {meetMessage && <p className={`teacher-studio-meet-message${meetError ? ' error' : ''}`} role={meetError ? 'alert' : 'status'}>{meetMessage}</p>}
      {meetError && !meetMessage && <p className="teacher-studio-meet-message error" role="alert">{meetError}</p>}
    </section>}
    {error && <div className="workspace-error" role="alert">{error}<button className="workspace-secondary" type="button" onClick={retryLoad}>Try again</button></div>}
    {loading ? <p className="workspace-empty" role="status">Loading your courses...</p> : listings.length ? (
      <>
        <header className="teacher-studio-list-heading">
          <div><h2>Your courses</h2><p>{listings.length} course{listings.length === 1 ? '' : 's'} available</p></div>
        </header>
        <div className="teacher-studio-grid">
          {listings.map((listing) => {
            const courseHref = `/dashboard/course/${encodeURIComponent(listing._id)}?tab=${isLive ? 'live' : 'modules'}`
            return <article className="teacher-studio-card" key={listing._id}>
              <div className="teacher-studio-card-heading">
                <span className="teacher-studio-card-icon"><FiBookOpen aria-hidden="true" /></span>
                <span className={`teacher-course-status${listing.isBanned ? ' banned' : ''}`}>
                  {listing.isBanned ? 'Banned' : listing.published === false ? 'Unpublished' : 'Published'}
                </span>
              </div>
              <h3>{listing.courseName || listing.name}</h3>
              {listing.courseName && listing.courseName !== listing.name && <p className="teacher-studio-batch">{listing.name}</p>}
              <div className="teacher-studio-meta">
                <span><FiUsers aria-hidden="true" /> {Number(listing.enrolledCount || 0)} students</span>
                <span><FiCalendar aria-hidden="true" /> {listing.duration || listing.category || 'Course'}</span>
              </div>
              {listing.isBanned && <p className="teacher-course-ban-note">This course was hidden from public pages by an administrator.</p>}
              <Link className="workspace-primary teacher-studio-action" to={courseHref}>
                {isLive ? <FiVideo aria-hidden="true" /> : <FiPlay aria-hidden="true" />}
                {isLive ? 'Manage live sessions' : 'Manage recorded lessons'}
              </Link>
              {!isLive && <button className="teacher-studio-add-recorded" type="button" onClick={() => openRecordedForm(listing._id)}>
                <FiPlus aria-hidden="true" /> Add recorded class
              </button>}
              {!isLive && recordingFor === listing._id && <form className="teacher-studio-recorded-form" onSubmit={(event) => submitRecordedClass(event, listing._id)}>
                <h4>Add a recorded class</h4>
                {recordedError && <p className="teacher-studio-recorded-error" role="alert">{recordedError}</p>}
                <label>
                  <span>Class title</span>
                  <input value={recordedForm.title} onChange={(event) => setRecordedForm({ ...recordedForm, title: event.target.value })} minLength={3} maxLength={200} required placeholder="e.g. Introduction to Algebra" />
                </label>
                <label>
                  <span>Video source</span>
                  <select value={recordedForm.source} onChange={(event) => setRecordedForm({ ...recordedForm, source: event.target.value })}>
                    <option value="youtube">YouTube</option>
                    <option value="vimeo">Vimeo</option>
                    <option value="gdrive">Google Drive</option>
                    <option value="direct">Direct video URL</option>
                  </select>
                </label>
                <label>
                  <span>Video URL</span>
                  <input type="url" value={recordedForm.videoUrl} onChange={(event) => setRecordedForm({ ...recordedForm, videoUrl: event.target.value, videoFile: null })} required={!recordedForm.videoFile} placeholder="https://..." />
                </label>
                <label>
                  <span>Or upload a video file</span>
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime,video/x-matroska,video/ogg,.mp4,.webm,.mov,.m4v,.ogv,.mkv,.avi"
                    onChange={(event) => {
                      const videoFile = event.target.files?.[0] || null
                      setRecordedForm({ ...recordedForm, videoFile, ...(videoFile ? { videoUrl: '', source: 'direct' } : {}) })
                    }}
                  />
                  <small>MP4, WebM, MOV, or MKV · up to 200 MB</small>
                </label>
                {recordedSaving && recordedUploadProgress > 0 && <p role="status">Uploading video: {recordedUploadProgress}%</p>}
                <label>
                  <span>Description <small>(optional)</small></span>
                  <textarea value={recordedForm.description} onChange={(event) => setRecordedForm({ ...recordedForm, description: event.target.value })} maxLength={3000} rows={3} placeholder="What will students learn?" />
                </label>
                <label>
                  <span>Duration <small>(optional)</small></span>
                  <input value={recordedForm.duration} onChange={(event) => setRecordedForm({ ...recordedForm, duration: event.target.value })} maxLength={50} placeholder="e.g. 24:30" />
                </label>
                <label className="teacher-studio-publish-toggle">
                  <input type="checkbox" checked={recordedForm.published} onChange={(event) => setRecordedForm({ ...recordedForm, published: event.target.checked })} />
                  Publish for students immediately
                </label>
                <div className="teacher-studio-recorded-actions">
                  <button className="workspace-secondary" type="button" onClick={() => setRecordingFor('')}>Cancel</button>
                  <button className="workspace-primary" type="submit" disabled={recordedSaving}>{recordedSaving ? 'Saving…' : 'Submit recorded class'}</button>
                </div>
              </form>}
              {!isLive && <Link className="teacher-studio-library-link" to={`/dashboard/course/${encodeURIComponent(listing._id)}?tab=library`}>View published lesson library</Link>}
            </article>
          })}
        </div>
      </>
    ) : !error && <div className="teacher-course-empty">
      <FiBookOpen aria-hidden="true" />
      <strong>No courses yet</strong>
      <span>Create a course listing before scheduling live sessions or adding recorded lessons.</span>
      <Link to="/dashboard/listings">Go to My Listings</Link>
    </div>}
  </WorkspaceFrame>
}
