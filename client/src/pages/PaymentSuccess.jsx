import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import '../styles/stripe-payment.css'

export function PaymentSuccess() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id') || ''
  const [status, setStatus] = useState(sessionId ? 'checking' : 'error')
  const [message, setMessage] = useState(sessionId ? '' : 'No payment session found.')

  useEffect(() => {
    let current = true
    let redirectTimer
    let retryTimer
    if (!sessionId) return undefined
    const verifyAndEnroll = async () => {
      try {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const { data } = await api.get('/student/payments/checkout/confirm', { params: { sessionId } })
          if (!current) return
          if (data.status === 'paid') {
            setStatus('success')
            const typeLabel = data.paymentType === 'monthly' ? 'Monthly tuition' : 'Enrollment'
            setMessage(`${typeLabel} payment confirmed. Your course access has been updated.`)
            redirectTimer = window.setTimeout(() => navigate('/student/classes'), 2500)
            return
          }
          if (data.status === 'verification_failed') {
            setStatus('error')
            setMessage('The provider payment did not match the course order. Contact support before trying again.')
            return
          }
          if (attempt < 9) await new Promise((resolve) => {
            retryTimer = window.setTimeout(resolve, 1200)
          })
        }
        if (current) {
          setStatus('pending')
          setMessage('Stripe received your payment. Enrollment is still being activated; check your classes shortly. Do not pay again.')
        }
      } catch (err) {
        if (current) {
          setStatus('error')
          setMessage(err.response?.data?.message || 'Payment verification failed.')
        }
      }
    }
    verifyAndEnroll()
    return () => {
      current = false
      window.clearTimeout(redirectTimer)
      window.clearTimeout(retryTimer)
    }
  }, [sessionId, navigate])

  return (
    <div className="student-portal">
      <div className="student-main">
        <div className="student-content">
          <header className="student-page-heading"><div><p>Payment status</p><h1>{status === 'success' ? 'Payment successful' : status === 'error' ? 'Payment failed' : status === 'pending' ? 'Payment processing' : 'Verifying payment...'}</h1></div></header>
          <div className="student-state" role={status === 'error' ? 'alert' : 'status'}>
            {message}
          </div>
          {status === 'success' && <p className="student-hint">Redirecting to your classes in a few seconds...</p>}
          {(status === 'error' || status === 'pending') && <button className="student-primary-button" type="button" onClick={() => navigate('/student/classes')}>Back to classes</button>}
        </div>
      </div>
    </div>
  )
}
