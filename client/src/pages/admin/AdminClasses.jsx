import { useMemo, useState } from 'react'
import { FiArrowRight, FiBookOpen, FiCalendar, FiClock, FiFileText, FiFilter, FiGrid, FiList, FiPlus, FiSearch, FiUser, FiUsers, FiX } from 'react-icons/fi'
import AdminLayout from './AdminLayout'
import '../../styles/admin-classes.css'

const startingClasses = [
  { id: 1, department: 'Mathematics', title: 'Advanced Calculus', teacher: 'Prof. Sarah Jenkins', schedule: 'Mon/Wed/Fri 10:00 AM', enrolled: 24, capacity: 30, status: 'Active' },
  { id: 2, department: 'Sciences', title: 'Intro to Physics', teacher: 'Dr. Alan Vance', schedule: 'Tue/Thu 1:00 PM', enrolled: 45, capacity: 50, status: 'Upcoming' },
  { id: 3, department: 'Humanities', title: 'Modern World History', teacher: 'Prof. Elena Rostova', schedule: 'Term Ended Fall 2023', enrolled: 32, capacity: 32, status: 'Completed' },
]

const statusClass = (status) => status.toLowerCase()

export default function AdminClasses() {
  const [classes, setClasses] = useState(startingClasses)
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState('')
  const [view, setView] = useState('grid')
  const [showForm, setShowForm] = useState(false)
  const [selectedClass, setSelectedClass] = useState(null)

  const filteredClasses = useMemo(() => classes.filter((item) => (
    (!department || item.department === department)
    && (!status || item.status.toLowerCase() === status)
    && `${item.title} ${item.teacher} ${item.department}`.toLowerCase().includes(query.toLowerCase())
  )), [classes, department, query, status])

  const createClass = (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const created = {
      id: Date.now(),
      title: form.get('title').trim(),
      department: form.get('department'),
      teacher: form.get('teacher').trim(),
      schedule: form.get('schedule').trim(),
      enrolled: 0,
      capacity: Number(form.get('capacity')),
      status: 'Upcoming',
    }
    setClasses((items) => [created, ...items])
    setShowForm(false)
  }

  return <AdminLayout title="Classes" subtitle="Manage course offerings and enrollment">
    <div className="admin-classes">
      <header className="classes-heading">
        <div>
          <h2>Classes Management</h2>
          <p>Overview and management of all active course offerings.</p>
        </div>
        <div className="classes-heading-actions">
          <label className="classes-search"><FiSearch /><input aria-label="Search classes" placeholder="Search classes..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <button className="classes-create" type="button" onClick={() => setShowForm(true)}><FiPlus /> Create New Class</button>
        </div>
      </header>

      <section className="classes-filters" aria-label="Class filters">
        <div className="classes-filter-label"><FiFilter /><span>Filters</span></div>
        <label className="classes-select-label"><span className="sr-only">Filter by department</span>
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="">All Departments</option>
            <option>Mathematics</option><option>Sciences</option><option>Humanities</option><option>Arts</option>
          </select>
        </label>
        <label className="classes-select-label"><span className="sr-only">Filter by status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All Statuses</option>
            <option value="active">Active</option><option value="upcoming">Upcoming</option><option value="completed">Completed</option>
          </select>
        </label>
        <div className="classes-view-toggle" aria-label="Class display mode">
          <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><FiGrid /></button>
          <button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><FiList /></button>
        </div>
      </section>

      {filteredClasses.length ? <section className={`classes-cards ${view}`} aria-label="Classes">
        {filteredClasses.map((item) => {
          const progress = item.capacity ? Math.min((item.enrolled / item.capacity) * 100, 100) : 0
          return <article className={`class-management-card ${statusClass(item.status)}`} key={item.id}>
            <div className="class-management-top">
              <div><span className={`class-department ${item.department.toLowerCase()}`}>{item.department}</span><h3>{item.title}</h3></div>
              <span className={`class-status ${statusClass(item.status)}`}><i />{item.status}</span>
            </div>
            <div className="class-management-meta">
              <p><FiUser /><span>{item.teacher}</span></p>
              <p><FiClock /><span>{item.schedule}</span></p>
              <p><FiUsers /><span>{item.status === 'Completed' ? `${item.enrolled} Students Completed` : `${item.enrolled} / ${item.capacity} Students Enrolled`}</span></p>
            </div>
            <div className="class-management-foot">
              {item.status === 'Completed'
                ? <span className="class-archive-label">Archived Record</span>
                : <div className="class-enrollment-progress" role="progressbar" aria-label={`${item.title} enrollment`} aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${progress}%` }} /></div>}
              <button type="button" onClick={() => setSelectedClass(item)}>{item.status === 'Completed' ? 'View Report' : 'Manage'} {item.status === 'Completed' ? <FiFileText /> : <FiArrowRight />}</button>
            </div>
          </article>
        })}
        <button className="class-create-tile" type="button" onClick={() => setShowForm(true)}>
          <span className="class-create-icon"><FiPlus /></span><strong>Create New Class</strong>
          <span>Set up a new course, assign teachers, and open enrollment.</span>
        </button>
      </section> : <div className="classes-empty"><FiBookOpen /><strong>No classes found</strong><span>Try changing your search or filters.</span></div>}
    </div>

    {showForm && <div className="classes-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false) }}>
      <section className="classes-modal" role="dialog" aria-modal="true" aria-labelledby="new-class-title">
        <button className="classes-modal-close" type="button" aria-label="Close" onClick={() => setShowForm(false)}><FiX /></button>
        <p className="classes-modal-kicker">Class setup</p><h2 id="new-class-title">Create New Class</h2><p>Enter the course details to add it to the class list.</p>
        <form onSubmit={createClass}>
          <label>Class name<input name="title" required maxLength="100" placeholder="e.g. Introduction to Biology" /></label>
          <label>Department<select name="department" required defaultValue=""><option value="" disabled>Select department</option><option>Mathematics</option><option>Sciences</option><option>Humanities</option><option>Arts</option></select></label>
          <label>Teacher<input name="teacher" required maxLength="100" placeholder="Teacher name" /></label>
          <div className="classes-modal-row"><label>Schedule<input name="schedule" required maxLength="100" placeholder="Mon/Wed 10:00 AM" /></label><label>Capacity<input name="capacity" type="number" min="1" max="500" required placeholder="30" /></label></div>
          <div className="classes-modal-actions"><button className="classes-create" type="submit"><FiPlus /> Create Class</button><button className="classes-cancel" type="button" onClick={() => setShowForm(false)}>Cancel</button></div>
        </form>
      </section>
    </div>}

    {selectedClass && <div className="classes-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedClass(null) }}>
      <section className="classes-modal class-details-modal" role="dialog" aria-modal="true" aria-labelledby="class-details-title">
        <button className="classes-modal-close" type="button" aria-label="Close" onClick={() => setSelectedClass(null)}><FiX /></button>
        <p className="classes-modal-kicker">{selectedClass.department} · {selectedClass.status}</p><h2 id="class-details-title">{selectedClass.title}</h2>
        <div className="class-details-list"><p><FiUser />{selectedClass.teacher}</p><p><FiCalendar />{selectedClass.schedule}</p><p><FiUsers />{selectedClass.enrolled} of {selectedClass.capacity} students</p></div>
        <button className="classes-create" type="button" onClick={() => setSelectedClass(null)}>Done</button>
      </section>
    </div>}
  </AdminLayout>
}
