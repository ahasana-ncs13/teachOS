import { useMemo, useState } from 'react'
import { FiFilter, FiMoreVertical, FiPlus, FiSearch, FiStar, FiUserPlus, FiX } from 'react-icons/fi'
import AdminLayout from './AdminLayout'
import '../../styles/admin-directory.css'

const initialDirectory = {
  Teachers: [
    { id: 1, name: 'Dr. Sarah Jenkins', email: 's.jenkins@teachos.edu', department: 'Science', classes: 4, rating: '4.9', status: 'Active', initials: 'SJ' },
    { id: 2, name: 'Mark Roberts', email: 'm.roberts@teachos.edu', department: 'Mathematics', classes: 3, rating: '4.7', status: 'Active', initials: 'MR' },
    { id: 3, name: 'Elena Rodriguez', email: 'e.rodriguez@teachos.edu', department: 'Arts', classes: 5, rating: '4.8', status: 'On Leave', initials: 'ER' },
  ],
  Students: [],
  Staff: [],
}

const tabs = Object.keys(initialDirectory)

export default function AdminDirectory() {
  const [directory, setDirectory] = useState(initialDirectory)
  const [activeTab, setActiveTab] = useState('Teachers')
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState(null)

  const people = directory[activeTab]
  const filteredPeople = useMemo(() => people.filter((person) => (
    (!department || person.department === department)
    && (!status || person.status.toLowerCase() === status)
    && `${person.name} ${person.email} ${person.department}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [department, people, query, status])

  const addTeacher = (event) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const name = values.get('name').trim()
    const createdTeacher = {
      id: Date.now(),
      name,
      email: values.get('email').trim(),
      department: values.get('department'),
      classes: 0,
      rating: '—',
      status: 'Active',
      initials: name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    }
    setDirectory((current) => ({ ...current, Teachers: [createdTeacher, ...current.Teachers] }))
    setActiveTab('Teachers')
    setDepartment('')
    setStatus('')
    setQuery('')
    setShowForm(false)
  }

  return <AdminLayout title="Directory" subtitle="Manage teachers, students, and staff accounts">
    <div className="admin-directory">
      <header className="directory-heading">
        <div>
          <h2>Directory Management</h2>
          <p>Manage teachers, students, and staff accounts.</p>
        </div>
        <div className="directory-heading-actions">
          <label className="directory-search"><FiSearch /><input aria-label="Search directory" placeholder="Search directory..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          {activeTab === 'Teachers' && <button className="directory-primary" type="button" onClick={() => setShowForm(true)}><FiUserPlus /> Add New Teacher</button>}
        </div>
      </header>

      <div className="directory-tabs" role="tablist" aria-label="Directory account type">
        {tabs.map((tab) => <button key={tab} id={`directory-tab-${tab.toLowerCase()}`} type="button" role="tab" aria-selected={activeTab === tab} aria-controls="directory-panel" onClick={() => { setActiveTab(tab); setDepartment(''); setStatus('') }}>{tab}</button>)}
      </div>

      <section className="directory-filters" aria-label="Directory filters">
        <span className="directory-filter-heading"><FiFilter /> Filters:</span>
        <label><span className="sr-only">Filter by department</span>
          <select aria-label="Filter by department" value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="">All Departments</option><option>Mathematics</option><option>Science</option><option>Arts</option>
          </select>
        </label>
        <label><span className="sr-only">Filter by status</span>
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All Statuses</option><option value="active">Active</option><option value="on leave">On Leave</option><option value="inactive">Inactive</option>
          </select>
        </label>
      </section>

      <section className="directory-table-panel" id="directory-panel" role="tabpanel" aria-labelledby={`directory-tab-${activeTab.toLowerCase()}`}>
        {filteredPeople.length ? <>
          <div className="directory-table-scroll">
            <table className="directory-table">
              <thead><tr><th>Name</th><th>Department</th><th>Active Classes</th><th>Rating</th><th>Status</th><th className="directory-actions-heading">Actions</th></tr></thead>
              <tbody>{filteredPeople.map((person) => <tr key={person.id}>
                <td><div className="directory-person"><span className="directory-avatar">{person.initials}</span><span><strong>{person.name}</strong><small>{person.email}</small></span></div></td>
                <td>{person.department}</td>
                <td>{person.classes}</td>
                <td><span className="directory-rating">{person.rating !== '—' && <FiStar />}{person.rating}</span></td>
                <td><span className={`directory-status ${person.status === 'Active' ? 'active' : person.status === 'On Leave' ? 'leave' : 'inactive'}`}>{person.status}</span></td>
                <td className="directory-row-actions"><button type="button" aria-label={`View ${person.name}`} onClick={() => setSelectedPerson(person)}><FiMoreVertical /></button></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="directory-table-footer"><span>Showing {filteredPeople.length} of {people.length} {activeTab.toLowerCase()}</span><span className="directory-demo-note">Directory sample data</span></div>
        </> : <div className="directory-empty">
          <FiSearch /><strong>{people.length ? 'No matching accounts' : `No ${activeTab.toLowerCase()} to show`}</strong>
          <span>{people.length ? 'Try a different search term or filter.' : `There are no ${activeTab.toLowerCase()} accounts in this directory yet.`}</span>
        </div>}
      </section>
    </div>

    {showForm && <div className="directory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false) }}>
      <section className="directory-modal" role="dialog" aria-modal="true" aria-labelledby="add-teacher-title">
        <button className="directory-modal-close" type="button" aria-label="Close" onClick={() => setShowForm(false)}><FiX /></button>
        <p className="directory-modal-kicker">Teacher directory</p><h2 id="add-teacher-title">Add New Teacher</h2>
        <p>Add a teacher to the current directory list.</p>
        <form onSubmit={addTeacher}>
          <label>Full name<input name="name" required maxLength="100" placeholder="Teacher name" /></label>
          <label>Email address<input name="email" type="email" required maxLength="254" placeholder="teacher@example.com" /></label>
          <label>Department<select name="department" required defaultValue=""><option value="" disabled>Select department</option><option>Mathematics</option><option>Science</option><option>Arts</option><option>Humanities</option></select></label>
          <div className="directory-modal-actions"><button className="directory-primary" type="submit"><FiPlus /> Add Teacher</button><button className="directory-cancel" type="button" onClick={() => setShowForm(false)}>Cancel</button></div>
        </form>
        <small className="directory-form-note">New entries are kept in this page for the current session only.</small>
      </section>
    </div>}

    {selectedPerson && <div className="directory-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPerson(null) }}>
      <section className="directory-modal directory-person-modal" role="dialog" aria-modal="true" aria-labelledby="person-details-title">
        <button className="directory-modal-close" type="button" aria-label="Close" onClick={() => setSelectedPerson(null)}><FiX /></button>
        <span className="directory-avatar large">{selectedPerson.initials}</span><h2 id="person-details-title">{selectedPerson.name}</h2>
        <p>{selectedPerson.email}</p><dl><div><dt>Department</dt><dd>{selectedPerson.department}</dd></div><div><dt>Active classes</dt><dd>{selectedPerson.classes}</dd></div><div><dt>Rating</dt><dd>{selectedPerson.rating}</dd></div><div><dt>Status</dt><dd>{selectedPerson.status}</dd></div></dl>
        <button className="directory-primary directory-done" type="button" onClick={() => setSelectedPerson(null)}>Done</button>
      </section>
    </div>}
  </AdminLayout>
}
