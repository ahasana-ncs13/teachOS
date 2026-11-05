import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import '../styles/stripe-payment.css'

export function PaymentSuccess() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('checking')
  const [message, setMessage] = useState('')
  const [sessionId, setSessionId] = useState(searchParams.get('session_id') || '')

  useEffect(() => {
    let current = true
    if (!sessionId) {
      setStatus('error')
      setMessage('No payment session found.')
      return
    }
    const verifyAndEnroll = async () => {
      try {
        const { data: session } = await api.get(`/stripe/session/${encodeURIComponent(sessionId)}`)
        if (session.payment_status !== 'paid') {
          setStatus('error')
          setMessage('Payment has not been completed.')
          return
        }
        const { data } = await api.post('/stripe/enroll', { sessionId })
        if (current) {
          setStatus('success')
          setMessage(`Payment confirmed. You are enrolled. Session: ${data.sessionId || sessionId}`)
          setTimeout(() => navigate('/student/classes'), 2500)
        }
      } catch (err) {
        if (current) {
          setStatus('error')
          setMessage(err.response?.data?.message || 'Payment verification failed.')
        }
      }
    }
    verifyAndEnroll()
    return () => { current = false }
  }, [sessionId, navigate])

  return (
    <div className="student-portal">
      <div className="student-main">
        <div className="student-content">
          <header className="student-page-heading"><div><p>Payment status</p><h1>{status === 'success' ? 'Payment successful' : status === 'error' ? 'Payment failed' : 'Verifying payment...'}</h1></div></header>
          <div className="student-state" role={status === 'success' ? 'status' : 'alert'}>
            {message}
          </div>
          {status === 'success' && <p className="student-hint">Redirecting to your classes in a few seconds...</p>}
          {status === 'error' && <button className="student-primary-button" type="button" onClick={() => navigate('/student/classes')}>Back to classes</button>}
        </div>
      </div>
    </div>
  )
}
