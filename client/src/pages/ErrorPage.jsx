import { FiArrowLeft, FiArrowRight, FiBookOpen, FiHome, FiLifeBuoy, FiRefreshCw } from 'react-icons/fi'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import '../styles/error-page.css'

export default function ErrorPage({ code = 404, onRetry }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isNotFound = code === 404
  const issuePath = `${location.pathname}${location.search}`
  const supportSubject = encodeURIComponent(`TeachOS ${code} error`)
  const supportBody = encodeURIComponent(`I encountered error ${code} at: ${window.location.origin}${issuePath}`)

  return <main className="error-page">
    <div className="error-shell">
      <header className="error-topbar">
        <Link className="error-brand" to="/" aria-label="TeachOS home">
          <span className="error-brand-mark">T</span><strong>Teach<span>OS</span></strong>
        </Link>
        <span className="error-status"><i /> TeachOS learning platform</span>
      </header>

      <section className="error-card" aria-labelledby="error-title">
        <div className="error-art" aria-hidden="true">
          <div className="error-art-orbit orbit-one" />
          <div className="error-art-orbit orbit-two" />
          <div className="error-art-book"><FiBookOpen /></div>
          <span className="error-art-dot dot-one" /><span className="error-art-dot dot-two" />
          <span className="error-art-spark">*</span>
          <span className="error-code">{code}</span>
        </div>

        <div className="error-copy">
          <span className="error-eyebrow"><span />{isNotFound ? '404 - Page not found' : `${code} - Unexpected error`}</span>
          <h1 id="error-title">{isNotFound ? 'Looks like this lesson is missing.' : 'We hit a small bump.'}</h1>
          <p>{isNotFound
            ? "The page may have moved, or the address might have a typo. Let's get you back to learning."
            : 'This page could not load correctly. You can retry, or head back to a safe place.'}</p>
        </div>

        <div className="error-path" aria-label="Requested page">
          <span className="error-path-label">Requested page</span>
          <code title={issuePath}>{issuePath || '/'}</code>
          <span className="error-path-code">ERR_{code}</span>
        </div>

        <div className="error-actions">
          {onRetry
            ? <button className="error-primary" type="button" onClick={onRetry}><FiRefreshCw /> Try again</button>
            : <button className="error-primary" type="button" onClick={() => navigate(-1)}><FiArrowLeft /> Go back</button>}
          <Link className="error-secondary" to="/"><FiHome /> Go to home <FiArrowRight /></Link>
        </div>

        <div className="error-help">
          <div className="error-help-icon"><FiLifeBuoy /></div>
          <div><strong>Still need a hand?</strong><span>Let us know what happened and we'll help you find your way.</span></div>
          <a href={`mailto:support@teachos.example?subject=${supportSubject}&body=${supportBody}`}>Contact support <FiArrowRight /></a>
        </div>
      </section>

      <footer className="error-footer"><span>&copy; {new Date().getFullYear()} TeachOS</span><Link to="/#listings">Explore courses <FiArrowRight /></Link></footer>
    </div>
  </main>
}
