import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { FiArrowLeft, FiBookmark, FiCheck, FiCheckCircle, FiChevronDown, FiChevronRight, FiClock, FiMenu, FiPlay, FiSearch, FiX } from 'react-icons/fi'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import '../styles/student-portal.css'

const nameFor = (user) => user?.fullName || user?.displayName || user?.email?.split('@')[0] || 'Student'
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'S'
let youtubeApiPromise

function loadYoutubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (youtubeApiPromise) return youtubeApiPromise

  youtubeApiPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]')
    const previousCallback = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.()
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('YouTube player API did not initialize.'))
    }

    if (existingScript) return
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => reject(new Error('YouTube player API could not be loaded.'))
    document.head.appendChild(script)
  }).catch((error) => {
    youtubeApiPromise = null
    throw error
  })

  return youtubeApiPromise
}

function videoSource(lesson) {
  const rawUrl = lesson.videoUrl?.trim()
  if (!rawUrl) return null
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, '')
  if (lesson.source === 'youtube' || host === 'youtube.com' || host === 'youtu.be') {
    const videoId = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop()
    return videoId ? {
      kind: 'embed',
      provider: 'youtube',
      url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`,
    } : null
  }
  if (lesson.source === 'vimeo' || host === 'vimeo.com' || host === 'player.vimeo.com') {
    const videoId = url.pathname.split('/').filter(Boolean).pop()
    return /^\d+$/.test(videoId || '') ? { kind: 'embed', provider: 'vimeo', url: `https://player.vimeo.com/video/${videoId}` } : null
  }
  if (lesson.source === 'gdrive' || host === 'drive.google.com') {
    const fileId = url.pathname.match(/\/file\/d\/([^/]+)/)?.[1] || url.searchParams.get('id')
    return fileId ? { kind: 'embed', url: `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview` } : null
  }
  return { kind: 'video', url: rawUrl }
}

function durationLabel(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  return value.trim()
}

export default function StudentLearningPage() {
  const { listingId } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const videoRef = useRef(null)
  const youtubePlayerContainerRef = useRef(null)
  const saveTimer = useRef(null)
  const lastSavedPosition = useRef(0)
  const [course, setCourse] = useState(null)
  const [modules, setModules] = useState([])
  const [lessons, setLessons] = useState([])
  const [progress, setProgress] = useState({})
  const [completion, setCompletion] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [expandedModules, setExpandedModules] = useState({})
  const [query, setQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(searchParams.get('outline') === '1')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingError, setSavingError] = useState('')
  const [fileVideoUrl, setFileVideoUrl] = useState('')
  const [fileVideoId, setFileVideoId] = useState('')
  const [fileVideoError, setFileVideoError] = useState(null)
  const [fileVideoRetry, setFileVideoRetry] = useState(0)

  useEffect(() => {
    let current = true
    api.get(`/student/courses/${encodeURIComponent(listingId)}/learning`).then(({ data }) => {
      if (!current) return
      const lessonProgress = Object.fromEntries((data.progress || []).map((record) => [String(record.lessonId), record]))
      setCourse(data.course)
      setModules(data.modules || [])
      setLessons(data.lessons || [])
      setProgress(lessonProgress)
      setCompletion(data.completion || null)
      const lastViewed = [...(data.progress || [])]
        .filter((record) => record.lastViewedAt)
        .sort((first, second) => new Date(second.lastViewedAt) - new Date(first.lastViewedAt))[0]
      const lastViewedLesson = (data.lessons || []).find((lesson) => String(lesson._id) === String(lastViewed?.lessonId))
      const currentLesson = (lastViewedLesson && !lessonProgress[String(lastViewedLesson._id)]?.completed
        ? lastViewedLesson
        : data.lessons?.find((lesson) => !lessonProgress[String(lesson._id)]?.completed)) || lastViewedLesson || data.lessons?.[0]
      setSelectedId((previous) => previous && data.lessons?.some((lesson) => String(lesson._id) === previous) ? previous : String(currentLesson?._id || ''))
      if (currentLesson?.moduleId) setExpandedModules({ [String(currentLesson.moduleId)]: true })
      setError('')
    }).catch((requestError) => {
      if (!current) return
      setError(requestError.response?.data?.message || 'Course lessons could not be loaded.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => {
      current = false
      clearTimeout(saveTimer.current)
    }
  }, [listingId])

  const selectedLesson = lessons.find((lesson) => String(lesson._id) === selectedId)
  const filteredLessons = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalized
      ? lessons.filter((lesson) => `${lesson.title} ${lesson.description || ''}`.toLowerCase().includes(normalized))
      : lessons
  }, [lessons, query])
  const lessonsByModule = useMemo(() => {
    const grouped = new Map()
    for (const lesson of filteredLessons) {
      const key = String(lesson.moduleId || '')
      grouped.set(key, [...(grouped.get(key) || []), lesson])
    }
    return grouped
  }, [filteredLessons])
  const completedCount = lessons.filter((lesson) => progress[String(lesson._id)]?.completed).length
  const percent = lessons.length ? Math.round((completedCount / lessons.length) * 100) : 0
  const selectedIndex = lessons.findIndex((lesson) => String(lesson._id) === selectedId)
  const video = useMemo(() => selectedLesson?.fileId
    ? fileVideoId === selectedLesson.fileId && fileVideoUrl ? { kind: 'video', url: fileVideoUrl } : null
    : selectedLesson ? videoSource(selectedLesson) : null, [fileVideoId, fileVideoUrl, selectedLesson])
  const selectedFileError = selectedLesson?.fileId && fileVideoError?.fileId === selectedLesson.fileId
    ? fileVideoError.message
    : ''
  const fileVideoLoading = Boolean(selectedLesson?.fileId &&
    fileVideoId !== selectedLesson.fileId &&
    fileVideoError?.fileId !== selectedLesson.fileId)
  const profileName = nameFor(user)

  useEffect(() => {
    if (!selectedLesson?.fileId) return undefined

    let current = true
    let objectUrl = ''
    api.get(
      `/student/courses/${encodeURIComponent(listingId)}/videos/${encodeURIComponent(selectedLesson.fileId)}`,
      { responseType: 'blob' },
    ).then(({ data }) => {
      if (!current) return
      objectUrl = URL.createObjectURL(data)
      setFileVideoUrl(objectUrl)
      setFileVideoId(selectedLesson.fileId)
    }).catch((requestError) => {
      if (current) setFileVideoError({
        fileId: selectedLesson.fileId,
        message: requestError.response?.data?.message || 'This video could not be loaded.',
      })
    })
    return () => {
      current = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileVideoRetry, listingId, selectedLesson?.fileId])

  const retryFileVideo = () => {
    setFileVideoError(null)
    setFileVideoId('')
    setFileVideoUrl('')
    setFileVideoRetry((value) => value + 1)
  }

  const saveProgress = useCallback(async (lesson, updates) => {
    if (!lesson) return
    setSavingError('')
    try {
      const { data } = await api.patch(
        `/student/courses/${encodeURIComponent(listingId)}/lessons/${encodeURIComponent(lesson._id)}/progress`,
        updates,
      )
      setProgress((current) => ({ ...current, [String(lesson._id)]: data.progress }))
      return data.progress
    } catch (requestError) {
      setSavingError(requestError.response?.data?.message || 'Lesson progress could not be saved.')
      return null
    }
  }, [listingId])

  const completeLesson = useCallback((lesson) => {
    if (lesson) saveProgress(lesson, { completed: true })
  }, [saveProgress])

  const chooseLesson = (lesson) => {
    clearTimeout(saveTimer.current)
    if (selectedLesson && videoRef.current && Number.isFinite(videoRef.current.currentTime)) {
      saveProgress(selectedLesson, { positionSeconds: Math.floor(videoRef.current.currentTime) })
    }
    setSelectedId(String(lesson._id))
    if (lesson.fileId !== fileVideoId) {
      setFileVideoId('')
      setFileVideoUrl('')
    }
    lastSavedPosition.current = progress[String(lesson._id)]?.positionSeconds || 0
    if (lesson.moduleId) setExpandedModules((current) => ({ ...current, [String(lesson.moduleId)]: true }))
    saveProgress(lesson, { positionSeconds: progress[String(lesson._id)]?.positionSeconds || 0 })
    setSidebarOpen(false)
  }

  const toggleCompleted = async () => {
    if (!selectedLesson) return
    const nextCompleted = !progress[selectedId]?.completed
    const saved = await saveProgress(selectedLesson, { completed: nextCompleted })
    if (saved && nextCompleted && selectedIndex < lessons.length - 1) {
      chooseLesson(lessons[selectedIndex + 1])
    }
  }

  const toggleBookmark = () => {
    if (!selectedLesson) return
    saveProgress(selectedLesson, { bookmarked: !progress[selectedId]?.bookmarked })
  }

  const navigateLesson = (direction) => {
    const next = lessons[selectedIndex + direction]
    if (next) chooseLesson(next)
  }

  const finishCourse = async () => {
    setSavingError('')
    try {
      const { data } = await api.post(`/student/courses/${encodeURIComponent(listingId)}/complete`)
      setCompletion({ completedAt: data.completedAt })
    } catch (requestError) {
      setSavingError(requestError.response?.data?.message || 'Course completion could not be saved.')
    }
  }

  const updatePosition = (event) => {
    const positionSeconds = Math.floor(event.currentTarget.currentTime)
    if (positionSeconds > 0 && positionSeconds - lastSavedPosition.current >= 15) {
      lastSavedPosition.current = positionSeconds
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => saveProgress(selectedLesson, { positionSeconds }), 600)
    }
  }

  useEffect(() => {
    if (!selectedLesson || video?.provider !== 'youtube' || !youtubePlayerContainerRef.current) return undefined

    let player
    let active = true
    loadYoutubeIframeApi().then((youtube) => {
      if (!active || !youtubePlayerContainerRef.current) return
      player = new youtube.Player(youtubePlayerContainerRef.current, {
        events: {
          onStateChange: (event) => {
            if (event.data === youtube.PlayerState.ENDED) completeLesson(selectedLesson)
          },
        },
      })
    }).catch((error) => {
      if (active) setSavingError(error.message || 'YouTube completion tracking could not be started.')
    })

    return () => {
      active = false
      player?.destroy()
    }
  }, [completeLesson, selectedLesson, video])

  useEffect(() => {
    if (!selectedLesson || !videoRef.current || !video || video.kind !== 'video') return
    const position = progress[selectedId]?.positionSeconds || 0
    if (position > 0) {
      const player = videoRef.current
      const restore = () => {
        if (Number.isFinite(player.duration) && position < player.duration) player.currentTime = position
        player.removeEventListener('loadedmetadata', restore)
      }
      player.addEventListener('loadedmetadata', restore)
      return () => player.removeEventListener('loadedmetadata', restore)
    }
  }, [selectedId, selectedLesson, video, progress])

  if (loading) return <div className="student-learning-state" role="status">Loading your course...</div>
  if (error) return <main className="student-learning-error"><p role="alert">{error}</p><Link to="/student">Back to dashboard</Link></main>
  if (course && String(course._id) !== String(listingId)) return <div className="student-learning-state" role="status">Loading your course...</div>

  return <main className="student-learning-page">
    <header className="student-learning-header">
      <Link className="student-brand" to="/student"><span className="student-brand-mark">T</span>TeachOS</Link>
      <nav aria-label="Course navigation"><Link to="/student"><FiArrowLeft /> Dashboard</Link><span title={profileName} className="student-avatar">{initials(profileName)}</span></nav>
    </header>
    <div className="student-learning-heading">
      <Link to="/student/classes"><FiArrowLeft /> My classes</Link>
      <p>{course?.category || 'Online course'}</p>
      <h1>{course?.courseName || course?.name || 'Course'}</h1>
    </div>
    <div className="student-learning-workspace">
      <section className="student-video-column">
        <div className="student-video-stage">
          {selectedLesson?.fileId && fileVideoLoading ? <div className="student-video-unavailable"><FiPlay /><strong>Loading video…</strong><span>Securely loading this course video.</span></div>
            : selectedLesson?.fileId && selectedFileError ? <div className="student-video-unavailable" role="alert"><FiPlay /><strong>Video unavailable</strong><span>{selectedFileError}</span><button type="button" onClick={retryFileVideo}>Try again</button></div>
              : video?.kind === 'video' ? <video
            ref={videoRef}
            key={selectedId}
            src={video.url}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={updatePosition}
            onPause={(event) => saveProgress(selectedLesson, { positionSeconds: Math.floor(event.currentTarget.currentTime) })}
            onEnded={() => completeLesson(selectedLesson)}
            aria-label={selectedLesson?.title || 'Course lesson video'}
          /> : video?.provider === 'youtube' ? <iframe
            key={selectedId}
            id="student-youtube-player"
            className="student-youtube-player"
            ref={youtubePlayerContainerRef}
            src={video.url}
            title={selectedLesson?.title || 'Course lesson video'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          /> : video?.kind === 'embed' ? <iframe
            key={selectedId}
            src={video.url}
            title={selectedLesson?.title || 'Course lesson video'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          /> : <div className="student-video-unavailable"><FiPlay /><strong>{selectedLesson?.title || 'No lesson selected'}</strong><span>{selectedLesson ? 'A playable video has not been added to this lesson yet.' : 'This course does not have published lessons yet.'}</span></div>}
        </div>
        <div className="student-video-controls">
          <div><span>Lesson {Math.max(selectedIndex + 1, 0)} of {lessons.length}</span><strong>{selectedLesson?.title || 'Course content'}</strong></div>
          <button type="button" className={progress[selectedId]?.bookmarked ? 'is-bookmarked' : ''} disabled={!selectedLesson} onClick={toggleBookmark}><FiBookmark /> {progress[selectedId]?.bookmarked ? 'Bookmarked' : 'Bookmark'}</button>
        </div>
        {savingError && <p className="student-learning-error-message" role="alert">{savingError}</p>}
        <div className="student-lesson-navigation">
          <button type="button" disabled={selectedIndex <= 0} onClick={() => navigateLesson(-1)}><FiArrowLeft /> Previous lesson</button>
          <button type="button" disabled={!selectedLesson || Boolean(progress[selectedId]?.completed)} onClick={toggleCompleted}><FiCheckCircle /> {progress[selectedId]?.completed ? 'Lesson completed' : 'Mark lesson complete'}</button>
          <button type="button" disabled={selectedIndex < 0 || selectedIndex >= lessons.length - 1} onClick={() => navigateLesson(1)}>Next lesson <FiChevronRight /></button>
        </div>
      </section>
      <aside className={`student-course-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Course content">
        <header><div><h2>Course Content</h2><button className="student-sidebar-close" type="button" aria-label="Close course content" onClick={() => setSidebarOpen(false)}><FiX /></button></div>
          <span>{completedCount} of {lessons.length} lessons complete</span>
          <div className="student-learning-progress"><span style={{ width: `${percent}%` }} /></div>
          <strong>{percent}% completed</strong>
        </header>
        <label className="student-lesson-search"><FiSearch /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lessons" aria-label="Search lessons" /></label>
        <div className="student-module-list">
          {(lessonsByModule.get('') || []).length > 0 && <section className="student-module">
            <div className="student-module-heading">
              <span><FiPlay /></span>
              <span><strong>Course lessons</strong><small>{lessonsByModule.get('').length} lessons</small></span>
            </div>
            <div className="student-module-lessons">{lessonsByModule.get('').map((lesson) => {
              const lessonId = String(lesson._id)
              return <button type="button" key={lessonId} className={`student-lesson-item${selectedId === lessonId ? ' is-active' : ''}`} onClick={() => chooseLesson(lesson)}>
                <span className={`student-lesson-status${progress[lessonId]?.completed ? ' is-completed' : ''}`}>{progress[lessonId]?.completed ? <FiCheckCircle /> : <FiPlay />}</span>
                <span><strong>{lesson.title}</strong><small><FiClock /> {durationLabel(lesson.duration) || 'Lesson'}</small></span>
                {progress[lessonId]?.bookmarked && <FiBookmark className="student-lesson-bookmark" aria-label="Bookmarked" />}
              </button>
            })}</div>
          </section>}
          {modules.map((module, index) => {
            const moduleId = String(module._id)
            const moduleLessons = lessonsByModule.get(moduleId) || []
            const expanded = Boolean(expandedModules[moduleId] || query)
            const moduleDuration = moduleLessons.map((lesson) => durationLabel(lesson.duration)).filter(Boolean).join(' · ')
            return <section className="student-module" key={moduleId}>
              <button type="button" className="student-module-heading" aria-expanded={expanded} onClick={() => setExpandedModules((current) => ({ ...current, [moduleId]: !current[moduleId] }))}>
                <span>{expanded ? <FiChevronDown /> : <FiChevronRight />}</span>
                <span><strong>{module.name || `Module ${index + 1}`}</strong><small>{moduleLessons.length} lessons{moduleDuration ? ` · ${moduleDuration}` : ''}</small></span>
              </button>
              {expanded && <div className="student-module-lessons">{moduleLessons.map((lesson) => {
                const lessonId = String(lesson._id)
                return <button type="button" key={lessonId} className={`student-lesson-item${selectedId === lessonId ? ' is-active' : ''}`} onClick={() => chooseLesson(lesson)}>
                  <span className={`student-lesson-status${progress[lessonId]?.completed ? ' is-completed' : ''}`}>{progress[lessonId]?.completed ? <FiCheckCircle /> : <FiPlay />}</span>
                  <span><strong>{lesson.title}</strong><small><FiClock /> {durationLabel(lesson.duration) || 'Lesson'}</small></span>
                  {progress[lessonId]?.bookmarked && <FiBookmark className="student-lesson-bookmark" aria-label="Bookmarked" />}
                </button>
              })}{!moduleLessons.length && <p className="student-no-lessons">{query ? 'No lessons match your search.' : 'No published lessons in this module.'}</p>}</div>}
            </section>
          })}
          {!modules.length && <div className="student-no-lessons">{query ? 'No lessons match your search.' : lessons.length ? 'Course modules are not available.' : 'No published lessons are available yet.'}</div>}
        </div>
        <footer>
          <div><span>{completion ? <FiCheck /> : <FiCheckCircle />}</span><strong>{completion ? 'Course completed' : 'Course completion'}</strong></div>
          <button type="button" disabled={!lessons.length || completedCount !== lessons.length || Boolean(completion)} onClick={finishCourse}>{completion ? 'Completed' : 'Complete Course'}</button>
        </footer>
      </aside>
      <button className="student-course-sidebar-backdrop" type="button" aria-label="Close course content" onClick={() => setSidebarOpen(false)} />
    </div>
    <button className="student-course-content-toggle" type="button" onClick={() => setSidebarOpen(true)}><FiMenu /> Course content</button>
  </main>
}
