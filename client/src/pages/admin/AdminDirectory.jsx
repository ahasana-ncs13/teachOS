import { useEffect, useMemo, useState } from 'react'
import { FiFilter, FiMoreVertical, FiSearch, FiTrash2 } from 'react-icons/fi'
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

  return <AdminLayout title="Directory" subtitle="Manage teacher, student, and staff accounts">
    <div className="admin-directory">
      <header className="directory-heading"><div><h2>Account directory</h2><p>Accounts and status are loaded from the TeachOS database.</p></div>
        <label className="directory-search"><FiSearch /><input aria-label="Search directory" placeholder="Search name or email..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </header>
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
                <td className="directory-row-actions"><button type="button" aria-label={`View ${name}`} onClick={() => setSelectedPerson(person)}><FiMoreVertical /></button>{accountStatus !== 'removed' && <button type="button" aria-label={`Deactivate ${name}`} onClick={() => removePerson(person)}><FiTrash2 /></button>}</td>
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
        <button className="directory-primary directory-done" type="button" onClick={() => setSelectedPerson(null)}>Done</button>
      </section>
    </div>}
  </AdminLayout>
}
