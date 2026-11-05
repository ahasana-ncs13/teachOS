/**
 * StripePaymentFlow.jsx
 *
 * Stripe Checkout payment modal:
 *   Step 1 — Card entry form (simulated fields for demo; real Stripe redirect for live mode)
 *   Step 2 — Processing / redirect to Stripe Checkout
 *   Step 3 — Success receipt (demo mode verifies + enrolls internally; live mode handled by PaymentSuccess page)
 *
 * Props:
 *   listing   — { _id, name, fee, category, teacherName, admissionFee, monthlyTuitionFee, initialPaymentTotal }
 *   onClose   — called when user closes / cancels
 *   onSuccess — called after successful payment + enrollment with { sessionId, amount }
 *
 * Endpoints:
 *   POST /api/stripe/create-checkout  — create a Stripe Checkout session
 *   GET  /api/stripe/session/:sessionId — verify payment status
 *   POST /api/stripe/enroll           — record payment + auto-enroll
 */

import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import '../styles/stripe-payment.css'

const money = (amount) =>
  `৳${Number(amount || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`

function genSessionDisplay(sessionId) {
  if (sessionId) return sessionId
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  let id = 'cs_'
  for (let i = 0; i < 24; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StripeHeader() {
  return (
    <div className="st-header">
      <div className="st-brand-plaque">
        <svg className="st-logo" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 16c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z" fill="#635bff" />
          <path d="M12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" fill="#635bff" />
        </svg>
        <span className="st-wordmark">Stripe</span>
        <span className="st-payment-label">Checkout</span>
      </div>
    </div>
  )
}

function StripeMerchantBanner({ listing, invoiceNo }) {
  return (
    <div className="st-merchant-banner">
      <div>
        <span className="st-merchant-label">Merchant</span>
        <span className="st-merchant-name">TeachOS Academy</span>
      </div>
      <div className="st-merchant-right">
        <span className="st-invoice-label">Session</span>
        <span className="st-invoice-no">{invoiceNo || '—'}</span>
      </div>
    </div>
  )
}

function StripeStepBar({ step }) {
  const steps = ['Card', 'Processing', 'Done']
  return (
    <div className="st-stepbar">
      <div className="st-stepbar-track">
        {steps.map((label, i) => (
          <div key={label} className={`st-step ${i < step ? 'done' : ''} ${i === step - 1 ? 'active' : ''}`}>
            <div className="st-step-dot">{i < step - 1 ? '✓' : i + 1}</div>
            <span>{label}</span>
          </div>
        ))}
        <div className="st-step-line" style={{ width: `${((step - 1) / (steps.length - 1)) * 100}%` }} />
      </div>
    </div>
  )
}

// ─── Step 1: Card ─────────────────────────────────────────────────────────────
function StepCard({ listing, onNext, onClose }) {
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [demoMode, setDemoMode] = useState(null)

  useEffect(() => {
    setDemoMode(!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY.includes('...'))
  }, [])

  const proceed = async () => {
    setError('')
    if (!/^\d{13,19}$/.test(cardNumber.replace(/\s/g, ''))) { setError('Enter a valid card number.'); return }
    if (!/^\d{2}\/\d{2}$/.test(expiry)) { setError('Enter a valid expiry date (MM/YY).'); return }
    if (!/^\d{3,4}$/.test(cvc)) { setError('Enter a valid CVC/CVV.'); return }
    if (!name.trim()) { setError('Enter the name on the card.'); return }
    setBusy(true)
    try {
      const { data } = await api.post('/stripe/create-checkout', {
        listingId: listing._id,
        successUrl: `${window.location.origin}/student/payment/success`,
        cancelUrl: `${window.location.origin}/student/payment/cancel`,
      })
      if (demoMode) {
        // Demo mode: simulate Stripe redirect, then verify + enroll internally
        onNext({ sessionId: data.id, amount: data.amount, invoiceNo: data.id })
      } else {
        // Live mode: redirect to Stripe Checkout
        window.location.href = data.url
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start checkout. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="st-body">
      <div className="st-inner-card">
        <p className="st-merchant-course">{listing.name}</p>
        <div className="st-amount-row">
          <span>Amount</span>
          <strong>{money(listing.initialPaymentTotal ?? listing.fee)}</strong>
        </div>
        <div className="st-amount-row st-breakdown">
          <span>Breakdown</span>
          <strong>{money(listing.admissionFee || 0)} admission + {money((listing.monthlyTuitionFee ?? listing.fee) || 0)} first month</strong>
        </div>
        {demoMode === null && <div className="st-mode-hint">Detecting payment mode...</div>}
        {demoMode === false && <div className="st-mode-live">Live mode: you will be redirected to Stripe Checkout.</div>}
        {demoMode === true && <div className="st-mode-demo">Demo mode: simulated Stripe checkout. No real card is charged.</div>}

        <label className="st-field-label" htmlFor="st-card-number">Card number</label>
        <div className="st-input-wrap">
          <input
            id="st-card-number"
            className="st-input"
            type="text"
            inputMode="numeric"
            maxLength={19}
            placeholder="•••• •••• •••• ••••"
            value={cardNumber}
            onChange={(e) => {
              let v = e.target.value.replace(/\D/g, '')
              if (v.length > 4) v = v.match(/.{1,4}/g).join(' ')
              setCardNumber(v)
            }}
            onKeyDown={(e) => e.key === 'Enter' && proceed()}
          />
        </div>

        <div className="st-expiry-cvc">
          <div className="st-half">
            <label className="st-field-label" htmlFor="st-expiry">Expiry date</label>
            <input
              id="st-expiry"
              className="st-input"
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="MM/YY"
              value={expiry}
              onChange={(e) => {
                let v = e.target.value.replace(/\D/g, '')
                if (v.length >= 2) v = v.slice(0, 2) + '/' + v.slice(2, 4)
                setExpiry(v)
              }}
            />
          </div>
          <div className="st-half">
            <label className="st-field-label" htmlFor="st-cvc">CVC</label>
            <input
              id="st-cvc"
              className="st-input"
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="•••"
              value={cvc}
              onChange={(e) => setCvc(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        </div>

        <label className="st-field-label" htmlFor="st-card-name">Name on card</label>
        <input
          id="st-card-name"
          className="st-input"
          type="text"
          placeholder="e.g. Jane Doe"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {error && <p className="st-error">{error}</p>}

        <div className="st-actions">
          <button className="st-btn-proceed" onClick={proceed} disabled={busy}>
            {busy ? 'Starting checkout...' : 'PAY WITH CARD'}
          </button>
          <button className="st-btn-close" onClick={onClose} disabled={busy}>CANCEL</button>
        </div>

        <div className="st-hotline"><span>💳</span><strong>Stripe Secure Checkout</strong></div>
      </div>
    </div>
  )
}

// ─── Step 2: Processing ───────────────────────────────────────────────────────
function StepProcessing({ sessionId, amount, listing, onNext, onClose }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let current = true
    const verifyAndEnroll = async () => {
      try {
        // 1. Verify session status
        const { data: session } = await api.get(`/stripe/session/${encodeURIComponent(sessionId)}`)
        if (session.payment_status !== 'paid') {
          throw new Error('Payment has not been completed.')
        }
        // 2. Enroll + record payment
        const { data: enrollData } = await api.post('/stripe/enroll', { sessionId })
        if (current) {
          setBusy(false)
          onNext({ trxID: enrollData.sessionId || sessionId, amount: enrollData.amount ?? amount })
        }
      } catch (err) {
        if (current) {
          setBusy(false)
          setError(err.response?.data?.message || 'Payment verification failed. Please contact support.')
        }
      }
    }
    verifyAndEnroll()
    return () => { current = false }
  }, [sessionId, amount])

  return (
    <div className="st-body">
      <div className="st-inner-card">
        <p className="st-merchant-course">{listing.name}</p>
        <div className="st-amount-row">
          <span>Amount</span>
          <strong>{money(amount)}</strong>
        </div>
      </div>

      <div className="st-processing">
        <div className="st-spinner" />
        <p className="st-processing-label">Verifying your payment...</p>
        <p className="st-processing-sub">Please do not close this window.</p>
      </div>

      {error && <p className="st-error">{error}</p>}

      <div className="st-actions">
        <button className="st-btn-close" onClick={onClose} disabled={busy}>CLOSE</button>
      </div>
    </div>
  )
}

// ─── Step 3: Success ──────────────────────────────────────────────────────────
function StepSuccess({ trxID, amount, listing, onClose }) {
  const [copied, setCopied] = useState(false)
  const now = new Date()
  const timeLabel = now.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })
  const dateLabel = now.toLocaleDateString('en-BD', { day: '2-digit', month: '2-digit', year: '2-digit' })
  const displayTrx = genSessionDisplay(trxID)

  const copyTrx = async () => {
    try { await navigator.clipboard.writeText(displayTrx) } catch { /* silent */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

  return (
    <div className="st-success-wrap">
      <div className="st-success-header">
        <div className="st-success-text">
          <h2>Payment <span className="st-success-green">successful</span></h2>
          <p className="st-success-sub">Your course enrollment payment has been confirmed.</p>
        </div>
        <div className="st-check-circle">
          <span className="st-check-icon">✓</span>
        </div>
      </div>

      <div className="st-success-merchant">
        <div className="st-success-merchant-icon">
          <svg viewBox="0 0 40 40" fill="none" width="32" height="32">
            <path d="M6 30C10 24 16 20 25 18C28 17.5 32 17.2 35 17C31 22 24 27 18 30C13 32 9 31.5 6 30Z" fill="#107c41" opacity="0.85" />
            <path d="M12 12C18 10 25 12 32 20C28 22 22 22 17 20C13 18 12 15 12 12Z" fill="#635bff" />
            <circle cx="28" cy="11" r="3" fill="#2170e4" />
          </svg>
        </div>
        <div>
          <strong>TeachOS Academy</strong>
          <p>{listing.name}</p>
        </div>
      </div>

      <div className="st-receipt-grid">
        <div className="st-receipt-cell">
          <span>Time</span>
          <strong>{timeLabel} {dateLabel}</strong>
        </div>
        <div className="st-receipt-cell">
          <span>Session ID</span>
          <div className="st-trx-row">
            <strong id="st-session-id">{displayTrx}</strong>
            <button className="st-copy-btn" onClick={copyTrx} aria-label="Copy session ID">
              {copied ? '✓' : '⎘'}
            </button>
          </div>
        </div>
        <div className="st-receipt-cell">
          <span>Total</span>
          <strong className="st-amount-large">{money(amount || listing.fee)}</strong>
          <small>BDT · Stripe</small>
        </div>
        <div className="st-receipt-cell st-receipt-full">
          <span>Course</span>
          <strong>{listing.name}</strong>
        </div>
      </div>

      <div className="st-success-actions">
        <button className="st-btn-done" onClick={onClose}>
          Back to classes
        </button>
      </div>

      {copied && (
        <div className="st-copy-toast">✓ Session ID copied</div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function StripePaymentFlow({ listing, onClose, onSuccess }) {
  const [step, setStep] = useState(1)
  const [paymentCtx, setPaymentCtx] = useState(null) // { sessionId, amount, invoiceNo }
  const [result, setResult] = useState(null)          // { trxID, amount }
  const backdropRef = useRef(null)

  const handleBackdropClick = (e) => {
    if (e.target === backdropRef.current) onClose()
  }

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleCardNext = (ctx) => {
    setPaymentCtx(ctx)
    setStep(2)
  }

  const handleVerifyNext = (res) => {
    setResult(res)
    setStep(3)
    onSuccess?.(res)
  }

  const handleSuccessClose = () => {
    onClose()
  }

  return (
    <div className="st-backdrop" ref={backdropRef} onClick={handleBackdropClick} role="presentation">
      <div
        className={`st-modal${step === 3 ? ' st-modal-success' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Stripe Checkout"
      >
        {step < 3 && (
          <>
            <StripeHeader />
            <StripeMerchantBanner
              listing={listing}
              invoiceNo={paymentCtx?.invoiceNo}
            />
            <StripeStepBar step={step} />
          </>
        )}

        {step === 1 && (
          <StepCard listing={listing} onNext={handleCardNext} onClose={onClose} />
        )}
        {step === 2 && (
          <StepProcessing
            sessionId={paymentCtx?.sessionId}
            amount={paymentCtx?.amount}
            listing={listing}
            onNext={handleVerifyNext}
            onClose={onClose}
          />
        )}
        {step === 3 && (
          <StepSuccess
            trxID={result?.trxID}
            amount={result?.amount}
            listing={listing}
            onClose={handleSuccessClose}
          />
        )}
      </div>
    </div>
  )
}
