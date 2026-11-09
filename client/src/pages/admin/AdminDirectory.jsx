import { useEffect, useMemo, useState } from 'react'
import { FiFilter, FiMoreVertical, FiPlus, FiSearch, FiTrash2 } from 'react-icons/fi'
import { api } from '../../lib/api'
import AdminLayout from './AdminLayout'
import '../../styles/admin-directory.css'

const tabs = [
  { label: 'Teachers', role: 'teacher' },
  { label: 'Students', role: 'student' },
  { label: 'Staff', role: 'admin' },
]
const initials = (name) => (name || 'TU').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()

export default function AdminDirectory() {
  const [activeTab, setActiveTab] = useState('Teachers')
  const [people, setPeople] = useState([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [teacherCourses, setTeacherCourses] = useState([])
  const [teacherStudentSummary, setTeacherStudentSummary] = useState({ totalStudents: 0, totalEnrollments: 0 })
  const [teacherCoursesLoading, setTeacherCoursesLoading] = useState(false)
  const [teacherCoursesError, setTeacherCoursesError] = useState('')
  const [selectedCourse, setSelectedCourse] = useState(null)
  const [courseStudents, setCourseStudents] = useState([])
  const [courseStudentsLoading, setCourseStudentsLoading] = useState(false)
  const [courseStudentsError, setCourseStudentsError] = useState('')
  const [staffFormOpen, setStaffFormOpen] = useState(false)
  const [staffSaving, setStaffSaving] = useState(false)
  const [staffSetupLink, setStaffSetupLink] = useState('')
  const [staffError, setStaffError] = useState('')
  const role = tabs.find((tab) => tab.label === activeTab)?.role

  useEffect(() => {
    let current = true
    api.get('/admin/users', { params: { page: 1, limit: 100, role } }).then(({ data }) => {
      if (current) setPeople(data.users || [])
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load user accounts.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [role])

  const filteredPeople = useMemo(() => people.filter((person) => (
    (!status || (person.status || 'active').toLowerCase() === status)
    && `${person.fullName || person.displayName || ''} ${person.email || ''}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [people, query, status])

  const removePerson = async (person) => {
    if (!window.confirm(`Deactivate ${person.fullName || person.email}'s account?`)) return
    setError('')
    try {
      await api.delete(`/admin/users/${encodeURIComponent(person._id)}`)
      setPeople((current) => current.filter((item) => item._id !== person._id))
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not deactivate this account.')
    }
  }

  const openPerson = async (person) => {
    setSelectedPerson(person)
    setTeacherCourses([])
    setTeacherStudentSummary({ totalStudents: 0, totalEnrollments: 0 })
    setTeacherCoursesError('')
    setSelectedCourse(null)
    setCourseStudents([])
    if (person.role !== 'teacher') return
    setTeacherCoursesLoading(true)
    try {
      const { data } = await api.get(`/admin/users/${encodeURIComponent(person._id)}/courses`)
      setTeacherCourses(data.courses || [])
      setTeacherStudentSummary({
        totalStudents: data.totalStudents || 0,
        totalEnrollments: data.totalEnrollments || 0,
      })
    } catch (requestError) {
      setTeacherCoursesError(requestError.response?.data?.message || 'Could not load this teacher’s courses.')
    } finally {
      setTeacherCoursesLoading(false)
    }
  }

  const openCourseStudents = async (course) => {
    setSelectedCourse(course)
    setCourseStudents([])
    setCourseStudentsError('')
    setCourseStudentsLoading(true)
    try {
      const { data } = await api.get(`/admin/users/${encodeURIComponent(selectedPerson._id)}/courses/${encodeURIComponent(course._id)}/students`)
      setCourseStudents(data.students || [])
    } catch (requestError) {
      setCourseStudentsError(requestError.response?.data?.message || 'Could not load students in this course.')
    } finally {
      setCourseStudentsLoading(false)
    }
  }

  const createStaffAccount = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    setStaffSaving(true)
    setStaffError('')
    setStaffSetupLink('')
    try {
      const { data } = await api.post('/admin/users', { ...values, role: 'admin' })
      setPeople((current) => [data.user, ...current])
      setStaffSetupLink(data.passwordSetupLink || '')
      form.reset()
      setStaffFormOpen(false)
    } catch (requestError) {
      setStaffError(requestError.response?.data?.message || 'Could not create this staff account.')
    } finally {
      setStaffSaving(false)
    }
  }

  return <AdminLayout title="Directory" subtitle="Manage teacher, student, and staff accounts">
    <div className="admin-directory">
      <header className="directory-heading"><div><h2>Account directory</h2><p>Accounts and status are loaded from the TeachOS database.</p></div>
        {activeTab === 'Staff' && <button className="directory-primary" type="button" onClick={() => { setStaffFormOpen((open) => !open); setStaffError(''); setStaffSetupLink('') }}><FiPlus /> Create staff account</button>}
        <label className="directory-search"><FiSearch /><input aria-label="Search directory" placeholder="Search name or email..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </header>
      {staffFormOpen && activeTab === 'Staff' && <form className="directory-staff-form" onSubmit={createStaffAccount}>
        <label>Full name<input name="fullName" minLength="2" maxLength="100" required /></label>
        <label>Work email<input name="email" type="email" maxLength="100" required /></label>
        <p>New staff receive admin permissions and must set their password through the secure setup link.</p>
        <button className="directory-primary" type="submit" disabled={staffSaving}>{staffSaving ? 'Creating account...' : 'Create staff account'}</button>
      </form>}
      {staffError && <div className="admin-data-error" role="alert">{staffError}</div>}
      {staffSetupLink && <div className="directory-setup-link" role="status"><strong>Account created. Send this password setup link to the staff member:</strong><a href={staffSetupLink} target="_blank" rel="noreferrer">{staffSetupLink}</a></div>}
      <div className="directory-tabs" role="tablist" aria-label="Directory account type">
        {tabs.map((tab) => <button key={tab.label} id={`directory-tab-${tab.label.toLowerCase()}`} type="button" role="tab" aria-selected={activeTab === tab.label} aria-controls="directory-panel" onClick={() => { setActiveTab(tab.label); setStatus(''); setLoading(true); setError('') }}>{tab.label}</button>)}
      </div>
      <section className="directory-filters" aria-label="Directory filters"><span className="directory-filter-heading"><FiFilter /> Filters:</span>
        <label><span className="sr-only">Filter by status</span><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option><option value="active">Active</option>
        </select></label>
      </section>
      {error && <div className="admin-data-error" role="alert">{error}</div>}
      <section className="directory-table-panel" id="directory-panel" role="tabpanel" aria-labelledby={`directory-tab-${activeTab.toLowerCase()}`}>
        {loading ? <div className="directory-empty" role="status">Loading accounts...</div> : filteredPeople.length ? <>
          <div className="directory-table-scroll"><table className="directory-table">
            <thead><tr><th>Name</th><th>Email</th><th>Account role</th><th>Status</th><th className="directory-actions-heading">Actions</th></tr></thead>
            <tbody>{filteredPeople.map((person) => {
              const name = person.fullName || person.displayName || 'TeachOS user'
              const accountStatus = person.status || 'active'
              return <tr key={person._id}>
                <td><div className="directory-person"><span className="directory-avatar">{initials(name)}</span><span><strong>{name}</strong><small>{person.createdAt ? new Date(person.createdAt).toLocaleDateString() : '—'}</small></span></div></td>
                <td>{person.email}</td><td>{person.role === 'superAdmin' ? 'admin' : person.role}</td>
                <td><span className={`directory-status ${accountStatus === 'active' ? 'active' : 'inactive'}`}>{accountStatus}</span></td>
                <td className="directory-row-actions"><button type="button" aria-label={`View ${name}`} onClick={() => openPerson(person)}><FiMoreVertical /></button>{accountStatus !== 'removed' && <button type="button" aria-label={`Deactivate ${name}`} onClick={() => removePerson(person)}><FiTrash2 /></button>}</td>
              </tr>
            })}</tbody>
          </table></div>
          <div className="directory-table-footer"><span>Showing {filteredPeople.length} of {people.length} database accounts</span><span>TeachOS database</span></div>
        </> : <div className="directory-empty"><FiSearch /><strong>{people.length ? 'No matching accounts' : `No ${activeTab.toLowerCase()} to show`}</strong><span>{people.length ? 'Try a different search term or status filter.' : `There are no ${activeTab.toLowerCase()} accounts in the database yet.`}</span></div>}
      </section>
    </div>
    {selectedPerson && <div className="directory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPerson(null) }}>
      <section className="directory-modal directory-person-modal" role="dialog" aria-modal="true" aria-labelledby="person-details-title">
        <button className="directory-modal-close" type="button" aria-label="Close" onClick={() => setSelectedPerson(null)}>×</button>
        <span className="directory-avatar large">{initials(selectedPerson.fullName || selectedPerson.displayName)}</span><h2 id="person-details-title">{selectedPerson.fullName || selectedPerson.displayName || 'TeachOS user'}</h2>
        <p>{selectedPerson.email}</p><dl><div><dt>Role</dt><dd>{selectedPerson.role === 'superAdmin' ? 'admin' : selectedPerson.role}</dd></div><div><dt>Status</dt><dd>{selectedPerson.status || 'active'}</dd></div><div><dt>Joined</dt><dd>{selectedPerson.createdAt ? new Date(selectedPerson.createdAt).toLocaleDateString() : '—'}</dd></div></dl>
        {selectedPerson.role === 'teacher' && <div className="directory-teacher-courses">
          <h3>Courses &amp; active students</h3>
          {teacherCoursesLoading ? <p role="status">Loading teacher courses...</p>
            : teacherCoursesError ? <p role="alert">{teacherCoursesError}</p>
              : teacherCourses.length ? <>
                <p className="directory-enrollment-summary">
                  {teacherStudentSummary.totalStudents} unique active students across {teacherCourses.length} courses · {teacherStudentSummary.totalEnrollments} total course enrollments
                </p>
                <p className="directory-batch-note">Each course listing represents a course or batch. Counts include active students only.</p>
                <ul>{teacherCourses.map((course) => <li key={course._id}>
                  <button type="button" onClick={() => openCourseStudents(course)}>
                    <strong>{course.name || 'Untitled course / batch'}</strong>
                    <span>{course.enrolledStudents} active {course.enrolledStudents === 1 ? 'student' : 'students'} · {course.published ? 'Published' : 'Unpublished'}</span>
                  </button>
                </li>)}</ul>
              </> : <p>No courses or batches listed for this teacher.</p>}
          {selectedCourse && <section className="directory-course-students">
            <h4>Students · {selectedCourse.name || 'Untitled course / batch'} ({courseStudents.length} active)</h4>
            {courseStudentsLoading ? <p role="status">Loading enrolled students...</p>
              : courseStudentsError ? <p role="alert">{courseStudentsError}</p>
                : courseStudents.length ? <ul>{courseStudents.map((student) => <li key={student._id}><strong>{student.studentName || 'TeachOS student'}</strong><span>{student.studentEmail || 'Email unavailable'} · {student.paymentStatus || 'Enrolled'}</span></li>)}</ul>
                  : <p>No active students are enrolled in this course.</p>}
          </section>}
        </div>}
        <button className="directory-primary directory-done" type="button" onClick={() => setSelectedPerson(null)}>Done</button>
      </section>
    </div>}
  </AdminLayout>
}
