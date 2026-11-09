import { useEffect, useRef, useState } from 'react'
import { FiBookOpen, FiCalendar, FiCheckCircle, FiClock, FiEdit2, FiEye, FiFileText, FiMapPin, FiPlus, FiSearch, FiTrash2, FiUsers, FiX } from 'react-icons/fi'
import { useAuth } from '../context/useAuth'
import { api } from '../lib/api'
import { QuickActionChooser, WorkspaceFrame } from './WorkspacePages'
import CreateListingModal from './CreateListingModal'
import '../styles/teacher-listings.css'

const pageSize = 9

function messageFrom(error, fallback) {
  return error.response?.data?.message || fallback
}

function money(amount) {
  return `৳${Number(amount || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`
}

function dateLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ListingStats({ stats, loading }) {
  const cards = [
    { title: 'Total Listings', value: stats.totalListings || 0, icon: FiBookOpen, tone: 'violet' },
    { title: 'Active Listings', value: stats.activeListings || 0, icon: FiCheckCircle, tone: 'green' },
    { title: 'Enrolled Students', value: stats.totalEnrolledStudents || 0, icon: FiUsers, tone: 'blue' },
    { title: 'Available Seats', value: stats.availableSeats || 0, icon: FiCalendar, tone: 'orange' },
  ]

  return <section className="listing-stats" aria-label="Listing statistics">
    {cards.map(({ title, value, icon: Icon, tone }) => <article className={`listing-stat-card ${tone}`} key={title}>
      <span className="listing-stat-icon"><Icon /></span>
      <div><span>{title}</span>{loading ? <i className="listing-stat-skeleton" /> : <strong>{Number(value).toLocaleString('en-BD')}</strong>}</div>
    </article>)}
  </section>
}

function ListingSkeletons() {
  return <div className="listing-grid" aria-label="Loading listings">
    {Array.from({ length: 3 }, (_, index) => <div className="listing-skeleton-card" key={index}>
      <i /><i /><i /><i /><i />
    </div>)}
  </div>
}

function ListingCard({ listing, onView, onEdit, onStudents, onAssignments, onDelete, onStatusChange, onPublicationChange, busy }) {
  const days = Array.isArray(listing.days) && listing.days.length ? listing.days.join(', ') : 'Schedule not set'
  const isPublished = listing.published ?? listing.status === 'active'
  const isOneTime = listing.pricingType === 'ONE_TIME' || (!listing.monthlyTuitionFee && Number(listing.fee) > 0 && listing.pricingType !== 'MONTHLY_SUBSCRIPTION')
  return <article className="teacher-listing-card">
    <header className="teacher-listing-card-header">
      <span className={`listing-status-pill ${listing.status || 'active'}`}>{listing.status || 'active'}</span>
      <span className="listing-category-tag">{listing.category || 'Online'}</span>
      <span style={{
        marginLeft: 'auto',
        fontSize: '10px',
        fontWeight: 700,
        padding: '2px 6px',
        borderRadius: '4px',
        background: isOneTime ? '#ede9fe' : '#e0f2fe',
        color: isOneTime ? '#6d28d9' : '#0369a1',
      }}>
        {isOneTime ? 'Lifetime' : 'Subscription'}
      </span>
    </header>
    <h2 className="listing-batch-name">{listing.name}</h2>
    <p className="listing-course-name"><FiBookOpen /> {listing.courseName || listing.course?.name || 'Course not linked'}</p>
    <div className="listing-card-details">
      <p><FiCalendar /><span>{days}</span></p>
      <p><FiClock /><span>{listing.startTime && listing.endTime ? `${listing.startTime}–${listing.endTime}` : listing.duration || 'Time not set'}</span></p>
      <p><FiMapPin /><span>{listing.location || 'Online classroom'}</span></p>
      <p><FiCheckCircle /><span>Online · {listing.deliveryMode === 'recorded' ? 'Recorded' : 'Live'}</span></p>
      <p><FiUsers /><span>{Number(listing.enrolledCount || 0)} / {Number(listing.capacity || 0)} students</span></p>
    </div>
    <div className="listing-publish-row">
      <span>Publish</span>
      <strong className={isPublished ? 'published' : 'unpublished'}>{isPublished ? 'Published' : 'Unpublished'}</strong>
      <button type="button" disabled={busy} onClick={() => onPublicationChange(listing, !isPublished)}>
        {busy ? 'Saving...' : isPublished ? 'Unpublish' : 'Publish'}
      </button>
    </div>
    <footer className="teacher-listing-card-footer">
      {isOneTime ? (
        <div><strong>{money(listing.admissionFee || listing.fee || 0)}</strong><span>one-time fee</span></div>
      ) : (
        <>
          <div><strong>{money(listing.admissionFee || 0)}</strong><span>admission</span></div>
          <div><strong>{money((listing.monthlyTuitionFee ?? listing.fee) || 0)}</strong><span>tuition/month</span></div>
        </>
      )}
      <small>Created {dateLabel(listing.createdAt)}</small>
    </footer>
    <div className="teacher-listing-actions">
      <button type="button" onClick={() => onView(listing)} aria-label={`View ${listing.name}`}><FiEye /> View</button>
      <button type="button" onClick={() => onEdit(listing)} aria-label={`Edit ${listing.name}`}><FiEdit2 /> Edit</button>
      <button type="button" onClick={() => onStudents(listing)} aria-label={`Manage students in ${listing.name}`}><FiUsers /> Students</button>
      <button type="button" onClick={() => onAssignments(listing)} aria-label={`Manage assignments for ${listing.name}`}><FiFileText /> Tasks</button>
      <label className="listing-status-control">
        <span className="visually-hidden">Change status for {listing.name}</span>
        <select value={listing.status || 'active'} disabled={busy} onChange={(event) => onStatusChange(listing, event.target.value)}>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="completed">Completed</option>
        </select>
      </label>
      <button type="button" className="listing-delete-action" onClick={() => onDelete(listing)} aria-label={`Delete ${listing.name}`}><FiTrash2 /></button>
    </div>
  </article>
}

function ListingDetailsModal({ listing, close }) {
  if (!listing) return null
  const isOneTime = listing.pricingType === 'ONE_TIME' || (!listing.monthlyTuitionFee && Number(listing.fee) > 0 && listing.pricingType !== 'MONTHLY_SUBSCRIPTION')
  return <div className="listing-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="listing-detail-modal" role="dialog" aria-modal="true" aria-labelledby="listing-details-title">
      <header><div><span>Listing details</span><h2 id="listing-details-title">{listing.name}</h2></div><button type="button" aria-label="Close listing details" onClick={close}><FiX /></button></header>
      <dl>
        <div><dt>Course</dt><dd>{listing.courseName || 'Course not linked'}</dd></div>
        <div><dt>Category</dt><dd>{listing.category || 'Online'}</dd></div>
        <div><dt>Delivery</dt><dd>{listing.deliveryMode === 'recorded' ? 'Recorded' : 'Live'}</dd></div>
        <div><dt>Schedule</dt><dd>{listing.days?.length ? listing.days.join(', ') : listing.duration || 'Not set'}{listing.startTime && listing.endTime ? ` · ${listing.startTime}–${listing.endTime}` : ''}</dd></div>
        <div><dt>Location</dt><dd>{listing.location || 'Online classroom'}</dd></div>
        <div><dt>Capacity</dt><dd>{listing.enrolledCount || 0} enrolled of {listing.capacity || 0}</dd></div>
        <div><dt>Pricing Type</dt><dd><span style={{ background: isOneTime ? '#ede9fe' : '#e0f2fe', color: isOneTime ? '#6d28d9' : '#0369a1', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>{isOneTime ? 'One-Time Payment (Lifetime)' : 'Monthly Subscription'}</span></dd></div>
        {isOneTime ? (
          <div><dt>Course Fee</dt><dd><strong>{money(listing.admissionFee || listing.fee || 0)}</strong> (Lifetime access)</dd></div>
        ) : (
          <>
            <div><dt>Admission fee (one-time)</dt><dd>{money(listing.admissionFee || 0)}</dd></div>
            <div><dt>Monthly tuition fee</dt><dd>{money((listing.monthlyTuitionFee ?? listing.fee) || 0)}</dd></div>
            <div><dt>First payment</dt><dd>{money((listing.admissionFee || 0) + ((listing.monthlyTuitionFee ?? listing.fee) || 0))}</dd></div>
            <div><dt>From next month</dt><dd>{money((listing.monthlyTuitionFee ?? listing.fee) || 0)}/month</dd></div>
          </>
        )}
        <div><dt>Status</dt><dd><span className={`listing-status-pill ${listing.status || 'active'}`}>{listing.status || 'active'}</span></dd></div>
        <div><dt>Created</dt><dd>{dateLabel(listing.createdAt)}</dd></div>
      </dl>
      {listing.description && <p className="listing-detail-description">{listing.description}</p>}
    </section>
  </div>
}

function StudentsModal({ listing, students, loading, error, close }) {
  if (!listing) return null
  return <div className="listing-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section className="listing-detail-modal listing-students-modal" role="dialog" aria-modal="true" aria-labelledby="listing-students-title">
      <header><div><span>Manage students · {students.length} enrolled</span><h2 id="listing-students-title">{listing.name}</h2></div><button type="button" aria-label="Close student list" onClick={close}><FiX /></button></header>
      {loading ? <p className="listing-modal-message">Loading enrolled students…</p>
        : error ? <p className="listing-modal-error" role="alert">{error}</p>
          : students.length ? <ul className="listing-student-list">{students.map((student) => <li key={student._id}>
            <span>{(student.studentName || student.studentEmail || 'S').trim().slice(0, 1).toUpperCase()}</span>
            <div><strong>{student.studentName || 'TeachOS student'}</strong><small>{student.studentEmail || 'Email not provided'}</small></div>
            <div className="listing-student-payments">
              <span className={`listing-payment-pill ${student.admissionPaid ? 'paid' : 'due'}`}>{student.admissionPaid ? 'Admission paid' : 'Admission due'}</span>
              <span className={`listing-payment-pill ${student.tuitionPaid ? 'paid' : 'due'}`}>{student.tuitionPaid ? 'Tuition paid' : 'Tuition due'}</span>
            </div>
            <time>{dateLabel(student.enrolledAt || student.createdAt)}</time>
          </li>)}</ul>
            : <p className="listing-modal-message">No students are enrolled in this listing yet.</p>}
    </section>
  </div>
}

function AssignmentsModal({ listing, assignments, loading, saving, error, onCreate, close }) {
  if (!listing) return null
  return <div className="listing-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) close() }}>
    <section className="listing-detail-modal listing-assignments-modal" role="dialog" aria-modal="true" aria-labelledby="listing-assignments-title">
      <header><div><span>Course assignments</span><h2 id="listing-assignments-title">{listing.name}</h2></div><button type="button" aria-label="Close assignments" disabled={saving} onClick={close}><FiX /></button></header>
      {error && <p className="listing-modal-error" role="alert">{error}</p>}
      <form className="listing-assignment-form" onSubmit={onCreate}>
        <label>Assignment title<input name="title" required minLength={3} maxLength={150} placeholder="e.g., Week 1 problem set" /></label>
        <label>Instructions<textarea name="description" maxLength={5000} rows={3} placeholder="What should students complete?" /></label>
        <label>Due date (optional)<input name="dueDate" type="date" /></label>
        <button type="submit" className="listing-submit-button" disabled={saving}>{saving ? 'Publishing...' : 'Publish assignment'}</button>
      </form>
      <h3 className="listing-assignments-subheading">Published assignments</h3>
      {loading ? <p className="listing-modal-message">Loading assignments…</p>
        : assignments.length ? <div className="listing-assignment-list">{assignments.map((assignment) => <article key={assignment._id}>
          <div><strong>{assignment.title}</strong><span>{assignment.dueDate ? `Due ${dateLabel(assignment.dueDate)}` : 'No due date'} · {assignment.submissions?.length || 0} submissions</span>{assignment.description && <p>{assignment.description}</p>}</div>
          {assignment.submissions?.length > 0 && <details><summary>View student submissions</summary>{assignment.submissions.map((submission) => <blockquote key={submission._id}><strong>{submission.studentName || 'Student'}</strong><p>{submission.content}</p><small>{new Date(submission.submittedAt).toLocaleString()}</small></blockquote>)}</details>}
        </article>)}</div>
          : <p className="listing-modal-message">No assignments for this course yet.</p>}
    </section>
  </div>
}

export default function TeacherListingsPage() {
  const { user } = useAuth()
  const [listings, setListings] = useState([])
  const [courses, setCourses] = useState([])
  const [stats, setStats] = useState({ totalListings: 0, activeListings: 0, totalEnrolledStudents: 0, availableSeats: 0 })
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 })
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('All')
  const [courseId, setCourseId] = useState('All')
  const [category, setCategory] = useState('All')
  const [sort, setSort] = useState('newest')
  const [loading, setLoading] = useState(true)
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [courseSaving, setCourseSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [toast, setToast] = useState('')
  const [toastTone, setToastTone] = useState('success')
  const [refresh, setRefresh] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [detailsListing, setDetailsListing] = useState(null)
  const [studentsListing, setStudentsListing] = useState(null)
  const [students, setStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [studentsError, setStudentsError] = useState('')
  const [statusSavingId, setStatusSavingId] = useState('')
  const [assignmentListing, setAssignmentListing] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  const [assignmentError, setAssignmentError] = useState('')
  const submittingRef = useRef(false)

  const notify = (message, tone = 'success') => {
    setToastTone(tone)
    setToast(message)
  }

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(() => {
      setError('')
      api.get('/listings/my', {
        params: {
          page,
          limit: pageSize,
          search,
          status,
          courseId: courseId === 'All' ? undefined : courseId,
          category,
          sort,
        },
      }).then(({ data }) => {
        if (!current) return
        setListings(data.listings || [])
        setStats(data.stats || { totalListings: 0, activeListings: 0, totalEnrolledStudents: 0, availableSeats: 0 })
        setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 })
      }).catch((requestError) => {
        if (current) setError(messageFrom(requestError, 'Could not load your listings.'))
      }).finally(() => {
        if (current) setLoading(false)
      })
    }, 250)

    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [category, courseId, page, refresh, search, sort, status, user?.uid])

  useEffect(() => {
    let current = true
    api.get('/courses').then(({ data }) => {
      if (current) setCourses(data.courses || [])
    }).catch((requestError) => {
      if (current) setError(messageFrom(requestError, 'Could not load your course catalog.'))
    }).finally(() => {
      if (current) setCoursesLoading(false)
    })
    return () => { current = false }
  }, [user?.uid])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const createCourse = async (courseData) => {
    setCourseSaving(true)
    try {
      const { data } = await api.post('/courses', courseData)
      setCourses((current) => [...current, data.course].sort((a, b) => a.name.localeCompare(b.name)))
      notify('Course added to your catalog.')
      return data.course
    } catch (requestError) {
      const message = messageFrom(requestError, 'Could not create this course.')
      notify(message, 'error')
      throw new Error(message)
    } finally {
      setCourseSaving(false)
    }
  }

  const saveListing = async (values) => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError('')
    try {
      if (editing) {
        const { status: _status, ...updates } = values
        await api.put(`/listings/${encodeURIComponent(editing._id)}`, updates)
        notify('Listing changes saved.')
      } else {
        await api.post('/listings', values)
        notify(values.status === 'draft' ? 'Listing saved as a draft.' : 'Listing created. Publish it when it is ready for students.')
      }
      setModalOpen(false)
      setEditing(null)
      setPage(1)
      setLoading(true)
      setRefresh((value) => value + 1)
    } catch (requestError) {
      const message = messageFrom(requestError, 'Could not save this listing.')
      setSubmitError(message)
      notify(message, 'error')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const openView = (listing) => {
    window.location.href = `/dashboard/course/${encodeURIComponent(listing._id)}`
  }

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
    setError('')
  }

  const openEdit = (listing) => {
    setEditing(listing)
    setModalOpen(true)
    setError('')
  }

  const changeStatus = async (listing, nextStatus) => {
    setStatusSavingId(String(listing._id))
    setError('')
    try {
      await api.put(`/listings/${encodeURIComponent(listing._id)}`, { status: nextStatus })
      notify(`Listing marked ${nextStatus}.`)
      setLoading(true)
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(messageFrom(requestError, 'Could not change listing status.'))
    } finally {
      setStatusSavingId('')
    }
  }

  const changePublication = async (listing, published) => {
    setStatusSavingId(String(listing._id))
    setError('')
    try {
      await api.put(`/listings/${encodeURIComponent(listing._id)}`, { published })
      notify(published ? 'Listing published and visible to students.' : 'Listing unpublished and hidden from public course pages.')
      setLoading(true)
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(messageFrom(requestError, 'Could not change listing publication.'))
    } finally {
      setStatusSavingId('')
    }
  }

  const deleteListing = async (listing) => {
    if (!window.confirm(`Delete "${listing.name}"? This listing will be removed from public browsing.`)) return
    setError('')
    try {
      await api.delete(`/listings/${encodeURIComponent(listing._id)}`)
      notify('Listing removed.')
      setPage(1)
      setLoading(true)
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(messageFrom(requestError, 'Could not delete this listing.'))
    }
  }

  const openStudents = async (listing) => {
    setStudentsListing(listing)
    setStudents([])
    setStudentsError('')
    setStudentsLoading(true)
    try {
      const { data } = await api.get(`/listings/${encodeURIComponent(listing._id)}/students`)
      setStudents(data.students || [])
    } catch (requestError) {
      setStudentsError(messageFrom(requestError, 'Could not load enrolled students.'))
    } finally {
      setStudentsLoading(false)
    }
  }

  const openAssignments = async (listing) => {
    setAssignmentListing(listing)
    setAssignments([])
    setAssignmentError('')
    setAssignmentsLoading(true)
    try {
      const { data } = await api.get(`/listings/${encodeURIComponent(listing._id)}/assignments`)
      setAssignments(data.assignments || [])
    } catch (requestError) {
      setAssignmentError(messageFrom(requestError, 'Could not load course assignments.'))
    } finally {
      setAssignmentsLoading(false)
    }
  }

  const createAssignment = async (event) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = Object.fromEntries(new FormData(formElement))
    setAssignmentSaving(true)
    setAssignmentError('')
    try {
      const { data } = await api.post(`/listings/${encodeURIComponent(assignmentListing._id)}/assignments`, form)
      setAssignments((current) => [data.assignment, ...current])
      formElement.reset()
      notify('Assignment published for enrolled students.')
    } catch (requestError) {
      setAssignmentError(messageFrom(requestError, 'Could not create this assignment.'))
    } finally {
      setAssignmentSaving(false)
    }
  }

  const updateFilter = (setter) => (event) => {
    setLoading(true)
    setter(event.target.value)
    setPage(1)
  }

  const changePage = (nextPage) => {
    setLoading(true)
    setPage(nextPage)
  }

  return <WorkspaceFrame
    title="My Listings"
    description="Manage your courses, coaching batches and learning programmes."
    onQuickAction={() => setQuickOpen(true)}
  >
    <div className="listings-page-heading">
      <div><p>Your teaching programmes</p><h2>Overview</h2></div>
      <button className="listings-create-button" type="button" onClick={openCreate}><FiPlus /> Create New Listing</button>
    </div>
    {error && <div className="listings-page-error" role="alert">{error}<button type="button" onClick={() => { setLoading(true); setError(''); setRefresh((value) => value + 1) }}>Retry</button></div>}

    <ListingStats stats={stats} loading={loading && !stats.totalListings} />

    <section className="listing-filters" aria-label="Filter listings">
      <label className="listing-search-field"><FiSearch /><input value={search} onChange={updateFilter(setSearch)} placeholder="Search listings or batches..." aria-label="Search listings or batches" /></label>
      <label><span className="visually-hidden">Filter by status</span><select value={status} onChange={updateFilter(setStatus)}><option value="All">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="completed">Completed</option></select></label>
      <label><span className="visually-hidden">Filter by course</span><select value={courseId} onChange={updateFilter(setCourseId)}><option value="All">All courses</option>{courses.map((course) => <option value={course._id} key={course._id}>{course.name}</option>)}</select></label>
      <label><span className="visually-hidden">Filter by category</span><select value={category} onChange={updateFilter(setCategory)}><option value="All">All categories</option><option value="Online">Online</option></select></label>
      <label><span className="visually-hidden">Sort listings</span><select value={sort} onChange={updateFilter(setSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="students">Most students</option></select></label>
    </section>

    {loading ? <ListingSkeletons />
      : error && listings.length === 0 ? <section className="listing-empty-state listing-load-error">
        <span><FiBookOpen /></span><h2>Could not load your listings</h2><p>{error}</p>
        <button className="listing-secondary-button" type="button" onClick={() => { setLoading(true); setError(''); setRefresh((value) => value + 1) }}>Try again</button>
      </section>
      : listings.length ? <>
        <div className="listing-results-heading"><span>{pagination.total} {pagination.total === 1 ? 'listing' : 'listings'}</span><span>Page {pagination.page} of {pagination.totalPages}</span></div>
        <section className="listing-grid" aria-label="Your listings">
          {listings.map((listing) => <ListingCard
            key={listing._id}
            listing={listing}
            onView={openView}
            onEdit={openEdit}
            onStudents={openStudents}
            onAssignments={openAssignments}
            onDelete={deleteListing}
            onStatusChange={changeStatus}
            onPublicationChange={changePublication}
            busy={statusSavingId === String(listing._id)}
          />)}
        </section>
        {pagination.totalPages > 1 && <nav className="listing-pagination" aria-label="Listings pages">
          <button type="button" disabled={page <= 1} onClick={() => changePage(Math.max(1, page - 1))}>Previous</button>
          <span>{page} / {pagination.totalPages}</span>
          <button type="button" disabled={page >= pagination.totalPages} onClick={() => changePage(Math.min(pagination.totalPages, page + 1))}>Next</button>
        </nav>}
      </> : <section className="listing-empty-state">
        <span><FiBookOpen /></span>
        <h2>{search || status !== 'All' || courseId !== 'All' || category !== 'All' ? 'No matching listings' : 'Your next class starts here'}</h2>
        <p>{search || status !== 'All' || courseId !== 'All' || category !== 'All'
          ? 'Try adjusting your search or filters.'
          : 'Create a listing to share your online programme with TeachOS learners.'}</p>
        {search || status !== 'All' || courseId !== 'All' || category !== 'All'
          ? <button className="listing-secondary-button" type="button" onClick={() => { setLoading(true); setSearch(''); setStatus('All'); setCourseId('All'); setCategory('All'); setPage(1) }}>Clear filters</button>
          : <button className="listings-create-button" type="button" onClick={openCreate}><FiPlus /> Create New Listing</button>}
      </section>}

    {modalOpen && <CreateListingModal
      key={editing?._id || 'new-listing'}
      user={user}
      courses={courses}
      coursesLoading={coursesLoading}
      courseSaving={courseSaving}
      onCreateCourse={createCourse}
      onClose={() => { setModalOpen(false); setEditing(null) }}
      onSubmit={saveListing}
      submitting={submitting}
      editing={editing}
      submitError={submitError}
      onClearSubmitError={() => setSubmitError('')}
    />}
    <ListingDetailsModal listing={detailsListing} close={() => setDetailsListing(null)} />
    <StudentsModal listing={studentsListing} students={students} loading={studentsLoading} error={studentsError} close={() => setStudentsListing(null)} />
    <AssignmentsModal
      listing={assignmentListing}
      assignments={assignments}
      loading={assignmentsLoading}
      saving={assignmentSaving}
      error={assignmentError}
      onCreate={createAssignment}
      close={() => setAssignmentListing(null)}
    />
    {quickOpen && <QuickActionChooser close={() => setQuickOpen(false)} />}
    {toast && <div className={`listing-toast ${toastTone}`} role={toastTone === 'error' ? 'alert' : 'status'}>{toast}<button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}><FiX /></button></div>}
  </WorkspaceFrame>
}
