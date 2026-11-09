import { useEffect, useState } from 'react'
import { FiBookOpen, FiCheckCircle, FiFilter, FiGrid, FiList, FiMapPin, FiSearch, FiSlash, FiTrash2, FiUser } from 'react-icons/fi'
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
  const [moderatingId, setModeratingId] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  useEffect(() => {
    let current = true
    api.get('/admin/listings', { params: { page, limit: 100, search: query, category } }).then(({ data }) => {
      if (!current) return
      setListings(data.listings || [])
      setTotalPages(data.pagination?.totalPages || 1)
      setError('')
    }).catch((requestError) => {
      if (current) setError(requestError.response?.data?.message || 'Could not load course listings.')
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [category, page, query])

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

  const toggleBan = async (item) => {
    const banned = item.isBanned !== true
    if (!window.confirm(banned
      ? `Manually ban "${item.name}"? This hides it from public course pages and does not change payment status.`
      : `Unban "${item.name}"? Its previous publication status will be restored.`)) return
    const reason = banned ? window.prompt('Optional moderation reason (max 500 characters):', '') : ''
    if (reason === null) return
    setModeratingId(item._id)
    setError('')
    setNotice('')
    try {
      const { data } = await api.patch(`/admin/listings/${encodeURIComponent(item._id)}/moderation`, { banned, reason })
      setListings((current) => current.map((listing) => listing._id === item._id ? data.listing : listing))
      setNotice(data.message)
    } catch (requestError) {
      setError(requestError.response?.data?.message || `Could not ${banned ? 'ban' : 'unban'} this course.`)
    } finally {
      setModeratingId('')
    }
  }

  return <AdminLayout title="Classes & listings" subtitle="Manage published courses and batches">
    <div className="admin-classes">
      <header className="classes-heading"><div><h2>Courses &amp; listings</h2><p>Manually ban or unban courses here. Banning hides a course from public pages and is independent of payment status.</p></div>
        <label className="classes-search"><FiSearch /><input aria-label="Search listings" placeholder="Search listings..." value={query} onChange={(event) => { setLoading(true); setQuery(event.target.value); setPage(1) }} /></label>
      </header>
      {error && <div className="admin-data-error" role="alert">{error}</div>}
      {notice && <div className="admin-data-notice" role="status">{notice}</div>}
      <section className="classes-filters" aria-label="Listing filters">
        <div className="classes-filter-label"><FiFilter /><span>Filter category</span></div>
        <label className="classes-select-label"><span className="sr-only">Filter by category</span><select value={category} onChange={(event) => { setLoading(true); setCategory(event.target.value); setPage(1) }}>
          <option value="">All categories</option><option>Online Course</option><option>Offline Batch</option><option>Exam Preparation</option><option>Skill Course</option><option>Theory Course</option>
        </select></label>
        <div className="classes-view-toggle" aria-label="Listing display mode">
          <button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><FiGrid /></button>
          <button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><FiList /></button>
        </div>
      </section>
      {loading ? <div className="classes-empty" role="status">Loading listings...</div> : listings.length ? <section className={`classes-cards ${view}`} aria-label="Course listings">
        {listings.map((item) => <article className={`class-management-card ${item.isBanned ? 'banned' : 'active'}`} key={item._id}>
          <div className="class-management-top"><div><span className="class-department">{item.category}</span><h3>{item.name}</h3></div><span className={`class-status ${item.isBanned ? 'banned' : 'active'}`}><i /> {item.isBanned ? 'Banned' : item.published === false ? 'Unpublished' : 'Published'}</span></div>
          <div className="class-management-meta"><p><FiUser /><span>{item.teacherName || 'TeachOS teacher'}</span></p><p><FiMapPin /><span>{item.location}</span></p><p><FiBookOpen /><span>{item.duration} · {taka(item.fee)}</span></p></div>
          {item.isBanned && item.banReason && <p className="class-ban-reason">Moderation reason: {item.banReason}</p>}
          <div className="class-management-foot"><span className="class-archive-label">{item.createdAt ? `Created ${new Date(item.createdAt).toLocaleDateString()}` : 'Course listing'}</span>
            <button type="button" className={item.isBanned ? 'class-ban-button unban' : 'class-ban-button'} disabled={moderatingId === item._id} onClick={() => toggleBan(item)}>{item.isBanned ? <FiCheckCircle /> : <FiSlash />}{moderatingId === item._id ? 'Saving...' : item.isBanned ? 'Unban course' : 'Ban course'}</button>
            <button type="button" onClick={() => removeListing(item)}><FiTrash2 /> Remove listing</button></div>
        </article>)}
      </section> : <div className="classes-empty"><FiSearch /><strong>No course listings</strong><span>{query || category ? 'No listings match the selected search and category.' : 'Course listings created by teachers will appear here for administrative moderation.'}</span></div>}
      {!loading && totalPages > 1 && <nav className="classes-pagination" aria-label="Course listing pages">
        <button type="button" disabled={page <= 1} onClick={() => { setLoading(true); setPage((current) => current - 1) }}>Previous</button>
        <span>Page {page} of {totalPages}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => { setLoading(true); setPage((current) => current + 1) }}>Next</button>
      </nav>}
    </div>
  </AdminLayout>
}
