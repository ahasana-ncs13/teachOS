import { useEffect, useMemo, useState } from 'react'
import { FiBookOpen, FiClock, FiMapPin, FiUser, FiX } from 'react-icons/fi'

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function listingValues(listing) {
  const startDate = listing?.startDate ? new Date(listing.startDate) : null
  return {
    name: listing?.name || '',
    courseId: listing?.courseId ? String(listing.courseId) : '',
    deliveryMode: listing?.deliveryMode || 'live',
    location: listing?.location || '',
    days: Array.isArray(listing?.days) ? listing.days : [],
    startTime: listing?.startTime || '',
    endTime: listing?.endTime || '',
    capacity: listing?.capacity ? String(listing.capacity) : '',
    admissionFee: listing?.admissionFee === undefined || listing?.admissionFee === null ? '' : String(listing.admissionFee),
    monthlyTuitionFee: listing?.monthlyTuitionFee === undefined || listing?.monthlyTuitionFee === null ? '' : String(listing.monthlyTuitionFee),
    description: listing?.description || '',
    startDate: startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString().slice(0, 10) : '',
    image: listing?.image || '',
  }
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'T'
}

function validate(values) {
  const errors = {}
  if (values.name.trim().length < 3) errors.name = 'Enter a listing name with at least 3 characters.'
  if (!values.courseId) errors.courseId = 'Select a course.'
  if (!['live', 'recorded'].includes(values.deliveryMode)) errors.deliveryMode = 'Choose a delivery mode.'
  if (!values.startTime || !values.endTime) errors.time = 'Choose a start and end time.'
  else if (values.endTime <= values.startTime) errors.time = 'End time must be later than start time.'
  if (!values.days.length) errors.days = 'Select at least one day.'

  const capacity = Number(values.capacity)
  if (!/^\d+$/.test(values.capacity) || !Number.isSafeInteger(capacity) || capacity <= 0) {
    errors.capacity = 'Capacity must be a positive whole number.'
  }
  const admissionFee = Number(values.admissionFee)
  if (values.admissionFee === '' || !Number.isFinite(admissionFee) || admissionFee < 0) {
    errors.admissionFee = 'Enter a valid non-negative admission fee.'
  }
  const monthlyTuitionFee = Number(values.monthlyTuitionFee)
  if (values.monthlyTuitionFee === '' || !Number.isFinite(monthlyTuitionFee) || monthlyTuitionFee < 0) {
    errors.monthlyTuitionFee = 'Enter a valid non-negative monthly tuition fee.'
  }
  if (values.image) {
    try {
      const imageUrl = new URL(values.image)
      if (!['http:', 'https:'].includes(imageUrl.protocol)) errors.image = 'Use a valid HTTPS or HTTP image URL.'
    } catch {
      errors.image = 'Enter a valid image URL.'
    }
  }
  return errors
}

export default function CreateListingModal({
  user,
  courses,
  coursesLoading,
  courseSaving,
  onCreateCourse,
  onClose,
  onSubmit,
  submitting,
  editing,
  submitError,
  onClearSubmitError,
}) {
  const startingValues = useMemo(() => listingValues(editing), [editing])
  const [values, setValues] = useState(startingValues)
  const [errors, setErrors] = useState({})
  const [courseFormVisibility, setCourseFormVisibility] = useState(null)
  const [courseDraft, setCourseDraft] = useState({ name: '', deliveryMode: 'live', description: '' })
  const [courseError, setCourseError] = useState('')
  const courseFormOpen = courseFormVisibility ?? (!coursesLoading && courses.length === 0)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !submitting && !courseSaving) requestClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [])

  const teacherName = user?.fullName || user?.displayName || user?.email?.split('@')[0] || 'Teacher'
  const selectedCourse = courses.find((course) => String(course._id) === values.courseId)
  const hasUnsavedChanges = JSON.stringify(values) !== JSON.stringify(startingValues) ||
    courseDraft.name !== '' || courseDraft.description !== '' || courseDraft.deliveryMode !== 'live'

  const money = (amount) => `৳${Number(amount || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`
  const admissionFee = Number(values.admissionFee) || 0
  const monthlyTuitionFee = Number(values.monthlyTuitionFee) || 0
  const initialPayment = admissionFee + monthlyTuitionFee

  function requestClose() {
    if (submitting || courseSaving) return
    if (hasUnsavedChanges && !window.confirm('Discard your unsaved changes?')) return
    onClose()
  }

  function updateField(field, value) {
    onClearSubmitError()
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function selectCourse(courseId) {
    const course = courses.find((item) => String(item._id) === courseId)
    onClearSubmitError()
    setValues((current) => ({
      ...current,
      courseId,
      deliveryMode: course?.deliveryMode || current.deliveryMode,
    }))
    setErrors((current) => ({ ...current, courseId: undefined, deliveryMode: undefined }))
  }

  async function createCourse() {
    setCourseError('')
    if (courseDraft.name.trim().length < 3) {
      setCourseError('Course name must be at least 3 characters.')
      return
    }
    try {
      const course = await onCreateCourse({
        ...courseDraft,
        name: courseDraft.name.trim(),
        description: courseDraft.description.trim(),
      })
      if (course) {
        selectCourse(String(course._id))
        setCourseDraft({ name: '', deliveryMode: 'live', description: '' })
        setCourseFormVisibility(false)
      }
    } catch (error) {
      setCourseError(error.message || 'Could not create this course.')
    }
  }

  function submitForm(event) {
    event.preventDefault()
    const nextErrors = validate(values)
    if (coursesLoading) nextErrors.courseId = 'Courses are still loading.'
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) return

    const status = editing ? undefined : event.nativeEvent.submitter?.value || 'active'
    onSubmit({
      ...values,
      capacity: Number(values.capacity),
      admissionFee: Number(values.admissionFee),
      monthlyTuitionFee: Number(values.monthlyTuitionFee),
      status,
    })
  }

  return <div
    className="listing-modal-backdrop"
    role="presentation"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose()
    }}
  >
    <section className="listing-modal" role="dialog" aria-modal="true" aria-labelledby="listing-modal-title">
      <header className="listing-modal-header">
        <div>
          <p className="listing-modal-eyebrow">{editing ? 'Update your programme' : 'Teacher workspace'}</p>
          <h2 id="listing-modal-title">{editing ? 'Edit Listing' : 'Create New Listing'}</h2>
        </div>
        <button className="listing-modal-close" type="button" aria-label="Close listing form" onClick={requestClose}>
          <FiX />
        </button>
      </header>

      <form className="listing-form" onSubmit={submitForm} noValidate>
        <div className="listing-modal-body">
          {submitError && <p className="listing-modal-error" role="alert">{submitError}</p>}
          <div className="listing-form-grid">
            <label className="listing-field listing-field-wide">
              <span>Batch Name <b aria-hidden="true">*</b></span>
              <input
                autoFocus
                value={values.name}
                onChange={(event) => updateField('name', event.target.value)}
                maxLength={150}
                placeholder="e.g., HSC Physics Crash Course"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'listing-name-error' : undefined}
              />
              {errors.name && <small id="listing-name-error" className="listing-field-error">{errors.name}</small>}
            </label>

            <label className="listing-field">
              <span>Course <b aria-hidden="true">*</b></span>
              <select
                value={values.courseId}
                onChange={(event) => selectCourse(event.target.value)}
                disabled={coursesLoading}
                aria-invalid={Boolean(errors.courseId)}
                aria-describedby={errors.courseId ? 'listing-course-error' : undefined}
              >
                <option value="">{coursesLoading ? 'Loading your courses...' : 'Select a course'}</option>
                {courses.map((course) => (
                  <option value={course._id} key={course._id}>
                    {course.name} · {course.deliveryMode === 'recorded' ? 'Recorded' : 'Live'}
                  </option>
                ))}
              </select>
              {errors.courseId && <small id="listing-course-error" className="listing-field-error">{errors.courseId}</small>}
            </label>

            <div className="listing-field listing-course-add">
              <span>Course catalog</span>
              <button type="button" className="listing-text-action" onClick={() => setCourseFormVisibility(!courseFormOpen)}>
                <FiBookOpen /> {courseFormOpen ? 'Close course form' : 'Add a course'}
              </button>
            </div>

            {selectedCourse && <div className="listing-delivery-summary">
              <span>Online course</span>
              <strong>{values.deliveryMode === 'recorded' ? 'Recorded' : 'Live'} delivery</strong>
            </div>}

            <label className="listing-field">
              <span>Delivery Mode <b aria-hidden="true">*</b></span>
              <select value={values.deliveryMode} onChange={(event) => updateField('deliveryMode', event.target.value)} aria-invalid={Boolean(errors.deliveryMode)}>
                <option value="live">Live</option>
                <option value="recorded">Recorded</option>
              </select>
              {errors.deliveryMode && <small className="listing-field-error">{errors.deliveryMode}</small>}
            </label>

            {courseFormOpen && <div className="listing-course-form listing-field-wide">
              <div className="listing-course-form-heading">
                <div><strong>Add a course</strong><small>Courses are saved to your TeachOS course catalog.</small></div>
                <FiBookOpen />
              </div>
              <label className="listing-field">
                <span>Course name <b aria-hidden="true">*</b></span>
                <input
                  value={courseDraft.name}
                  onChange={(event) => setCourseDraft((current) => ({ ...current, name: event.target.value }))}
                  maxLength={150}
                  placeholder="e.g., Higher Secondary Physics"
                />
              </label>
              <div className="listing-course-form-row">
                <label className="listing-field">
                  <span>Category</span>
                  <input value="Online" readOnly />
                </label>
                <label className="listing-field">
                  <span>Delivery mode</span>
                  <select
                    value={courseDraft.deliveryMode}
                    onChange={(event) => setCourseDraft((current) => ({ ...current, deliveryMode: event.target.value }))}
                  >
                    <option value="live">Live</option>
                    <option value="recorded">Recorded</option>
                  </select>
                </label>
              </div>
              <label className="listing-field">
                <span>Description <small>(optional)</small></span>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={courseDraft.description}
                  onChange={(event) => setCourseDraft((current) => ({ ...current, description: event.target.value }))}
                  placeholder="A short overview of this course"
                />
              </label>
              {courseError && <p className="listing-field-error" role="alert">{courseError}</p>}
              <button type="button" className="listing-course-save" disabled={courseSaving} onClick={createCourse}>
                {courseSaving ? 'Saving course...' : 'Save course and select'}
              </button>
            </div>}

            <div className="listing-teacher-profile listing-field-wide">
              <span className="listing-teacher-avatar">
                {user?.photoURL
                  ? <img src={user.photoURL} alt="" />
                  : initials(teacherName)}
              </span>
              <div><small>Assigned teacher</small><strong>{teacherName}</strong><span>{user?.email || 'Authenticated teacher'}</span></div>
              <FiUser aria-hidden="true" />
            </div>

            <label className="listing-field listing-field-wide">
              <span>Room / Class Location <small>(optional)</small></span>
              <span className="listing-input-icon"><FiMapPin aria-hidden="true" /><input value={values.location} onChange={(event) => updateField('location', event.target.value)} maxLength={200} placeholder="e.g., Room 101, Online Classroom" /></span>
            </label>

            <fieldset className="listing-field listing-field-wide listing-day-field">
              <legend>Days of the Week <b aria-hidden="true">*</b></legend>
              <div className="listing-day-selector">
                {weekDays.map((day) => {
                  const selected = values.days.includes(day)
                  return <button
                    type="button"
                    key={day}
                    aria-pressed={selected}
                    className={selected ? 'selected' : ''}
                    onClick={() => updateField('days', selected ? values.days.filter((item) => item !== day) : [...values.days, day])}
                  >{day}</button>
                })}
              </div>
              {errors.days && <small className="listing-field-error">{errors.days}</small>}
            </fieldset>

            <label className="listing-field">
              <span>Start Time <b aria-hidden="true">*</b></span>
              <span className="listing-input-icon"><FiClock aria-hidden="true" /><input type="time" value={values.startTime} onChange={(event) => updateField('startTime', event.target.value)} /></span>
            </label>
            <label className="listing-field">
              <span>End Time <b aria-hidden="true">*</b></span>
              <span className="listing-input-icon"><FiClock aria-hidden="true" /><input type="time" value={values.endTime} onChange={(event) => updateField('endTime', event.target.value)} /></span>
            </label>
            {errors.time && <small className="listing-field-error listing-field-wide">{errors.time}</small>}

            <label className="listing-field">
              <span>Capacity <b aria-hidden="true">*</b></span>
              <input type="number" min="1" step="1" value={values.capacity} onChange={(event) => updateField('capacity', event.target.value)} placeholder="e.g., 50" />
              {errors.capacity && <small className="listing-field-error">{errors.capacity}</small>}
            </label>

            <div className="listing-field listing-field-wide listing-pricing-section">
              <legend>Payment &amp; Pricing</legend>
              <p className="listing-pricing-note">Student charges for joining and attending this course. All amounts are in Bangladeshi taka (৳).</p>
              <div className="listing-pricing-grid">
                <label className="listing-field">
                  <span>Admission Fee <b aria-hidden="true">*</b></span>
                  <span className="listing-fee-badge one-time">One-time</span>
                  <span className="listing-currency-input"><b>৳</b><input type="number" min="0" step="0.01" value={values.admissionFee} onChange={(event) => updateField('admissionFee', event.target.value)} placeholder="e.g., 1000" aria-invalid={Boolean(errors.admissionFee)} /></span>
                  <small className="listing-helper-text">One-time admission charge payable when a student joins this course.</small>
                  {errors.admissionFee && <small id="listing-admission-error" className="listing-field-error">{errors.admissionFee}</small>}
                </label>
                <label className="listing-field">
                  <span>Monthly Tuition Fee <b aria-hidden="true">*</b></span>
                  <span className="listing-fee-badge recurring">Recurring monthly</span>
                  <span className="listing-currency-input"><b>৳</b><input type="number" min="0" step="0.01" value={values.monthlyTuitionFee} onChange={(event) => updateField('monthlyTuitionFee', event.target.value)} placeholder="e.g., 1500" aria-invalid={Boolean(errors.monthlyTuitionFee)} /></span>
                  <small className="listing-helper-text">Recurring monthly tuition fee payable by each enrolled student.</small>
                  {errors.monthlyTuitionFee && <small id="listing-tuition-error" className="listing-field-error">{errors.monthlyTuitionFee}</small>}
                </label>
              </div>
              <div className="listing-pricing-preview">
                <strong>Payment breakdown</strong>
                <div className="listing-pricing-row"><span>First payment (admission + first month tuition)</span><strong>{money(initialPayment)}</strong></div>
                <div className="listing-pricing-row"><span>From next month</span><strong>{money(monthlyTuitionFee)}/month</strong></div>
              </div>
            </div>

            <label className="listing-field listing-field-wide">
              <span>Description <small>(optional)</small></span>
              <textarea rows={3} maxLength={5000} value={values.description} onChange={(event) => updateField('description', event.target.value)} placeholder="Share what students will learn in this programme." />
            </label>

            <label className="listing-field">
              <span>Start Date <small>(optional)</small></span>
              <input type="date" value={values.startDate} onChange={(event) => updateField('startDate', event.target.value)} />
            </label>
            <label className="listing-field">
              <span>Cover Image URL <small>(optional)</small></span>
              <input type="url" maxLength={2048} value={values.image} onChange={(event) => updateField('image', event.target.value)} placeholder="https://..." aria-invalid={Boolean(errors.image)} />
              {errors.image && <small className="listing-field-error">{errors.image}</small>}
            </label>
          </div>
        </div>

        <footer className="listing-modal-footer">
          <button type="button" className="listing-cancel-button" disabled={submitting || courseSaving} onClick={requestClose}>Cancel</button>
          {editing
            ? <button type="submit" className="listing-submit-button" disabled={submitting || coursesLoading}>{submitting ? 'Saving changes...' : 'Save Changes'}</button>
            : <>
              <button type="submit" className="listing-draft-button" name="status" value="draft" disabled={submitting || coursesLoading}>Save as Draft</button>
              <button type="submit" className="listing-submit-button" name="status" value="active" disabled={submitting || coursesLoading}>
                {submitting ? 'Creating listing...' : 'Create Listing'}
              </button>
            </>}
        </footer>
      </form>
    </section>
  </div>
}
