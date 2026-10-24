import { useEffect, useMemo, useState } from 'react'
import { FiBookOpen, FiFilter, FiGrid, FiList, FiMapPin, FiSearch, FiTrash2, FiUser } from 'react-icons/fi'
import { api } from '../../lib/api'
import AdminLayout from './AdminLayout'
import '../../styles/admin-classes.css'

const taka = (fee) => fee ? `৳${Number(fee).toLocaleString('en-BD')}` : 'Free'

export default function AdminClasses() {
  const [listings, setListings] = useState([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [view, setView] = useState('grid')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    api.get('/listings', { params: { page: 1, limit: 100 } }).then(({ data }) => {
      if (current) setListings(data.listings || [])
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load course listings.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [])

  const filteredListings = useMemo(() => listings.filter((item) => (
    (!category || item.category === category)
    && `${item.name} ${item.teacherName} ${item.location} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase())
  )), [category, listings, query])

  const removeListing = async (item) => {
    if (!window.confirm(`Remove "${item.name}" from the public TeachOS home page?`)) return
    setError('')
    setNotice('')
    try {
      await api.delete(`/listings/${encodeURIComponent(item._id)}`)
      setListings((current) => current.filter((listing) => listing._id !== item._id))
      setNotice('Listing was removed from the public home page.')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not remove this listing.')
    }
  }

  return <AdminLayout title="Classes & listings" subtitle="Manage published courses and batches">
    <div className="admin-classes">
      <header className="classes-heading"><div><h2>Published listings</h2><p>Changes here are reflected on the public TeachOS home page.</p></div>
        <label className="classes-search"><FiSearch /><input aria-label="Search listings" placeholder="Search listings..." value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </header>
      {error && <div className="admin-data-error" role="alert">{error}</div>}
      {notice && <div className="admin-data-notice" role="status">{notice}</div>}
      <section className="classes-filters" aria-label="Listing filters">
        <div className="classes-filter-label"><FiFilter /><span>Filter category</span></div>
        <label className="classes-select-label"><span className="sr-only">Filter by category</span><select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option><option>Online Course</option><option>Offline Batch</option><option>Exam Preparation</option><option>Skill Course</option>
        </select></label>
        <div className="classes-view-toggle" aria-label="Listing display mode">
          <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><FiGrid /></button>
          <button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><FiList /></button>
        </div>
      </section>
      {loading ? <div className="classes-empty" role="status">Loading listings...</div> : filteredListings.length ? <section className={`classes-cards ${view}`} aria-label="Published listings">
        {filteredListings.map((item) => <article className="class-management-card active" key={item._id}>
          <div className="class-management-top"><div><span className="class-department">{item.category}</span><h3>{item.name}</h3></div><span className="class-status active"><i /> Published</span></div>
          <div className="class-management-meta"><p><FiUser /><span>{item.teacherName || 'TeachOS teacher'}</span></p><p><FiMapPin /><span>{item.location}</span></p><p><FiBookOpen /><span>{item.duration} · {taka(item.fee)}</span></p></div>
          <div className="class-management-foot"><span className="class-archive-label">{item.createdAt ? `Published ${new Date(item.createdAt).toLocaleDateString()}` : 'Published'}</span>
            <button type="button" onClick={() => removeListing(item)}><FiTrash2 /> Remove listing</button></div>
        </article>)}
      </section> : <div className="classes-empty"><FiSearch /><strong>{listings.length ? 'No matching listings' : 'No published listings'}</strong><span>{listings.length ? 'Try changing your search or category filter.' : 'Teacher listings published from their dashboard appear here and on the home page.'}</span></div>}
    </div>
  </AdminLayout>
}
