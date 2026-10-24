import { FiArrowLeft, FiArrowRight, FiHome, FiRefreshCw } from 'react-icons/fi'
import { Link, useNavigate } from 'react-router-dom'
import '../styles/error-page.css'

export default function ErrorPage({ code = 404, onRetry }) {
  const navigate = useNavigate()
  const isNotFound = code === 404

  return <main className="error-page">
    <section className="error-card" aria-labelledby="error-title">
      <Link className="error-brand" to="/"><span className="error-brand-mark">T</span><strong>Teach<span>OS</span></strong></Link>
      <div className="error-code" aria-hidden="true">{code}</div>
      <span className="error-eyebrow">{isNotFound ? 'Page not found' : 'Something went wrong'}</span>
      <h1 id="error-title">{isNotFound ? 'We can’t find that page.' : 'This page ran into a problem.'}</h1>
      <p>{isNotFound
        ? 'The link may be outdated, or the page may have moved. Check the address and try again.'
        : 'Try loading the page again. If the problem continues, return to the TeachOS home page.'}</p>
      <div className="error-actions">
        {onRetry
          ? <button className="error-primary" type="button" onClick={onRetry}><FiRefreshCw /> Try again</button>
          : <button className="error-secondary" type="button" onClick={() => navigate(-1)}><FiArrowLeft /> Go back</button>}
        <Link className={onRetry ? 'error-secondary' : 'error-primary'} to="/"><FiHome /> Go to home <FiArrowRight /></Link>
      </div>
      <span className="error-reference">Error {code} · TeachOS</span>
    </section>
  </main>
}
