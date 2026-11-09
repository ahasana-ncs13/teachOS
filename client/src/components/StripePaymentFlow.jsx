/**
 * StripePaymentFlow
 *
 * Handles both initial enrollment and manual monthly renewal payments.
 *
 * Props:
 *   listing          — { _id, name, admissionFee, monthlyTuitionFee, fee }
 *   paymentType      — 'initial' | 'monthly'  (default: 'initial')
 *   billingPeriod    — e.g. '2026-11' (shown in UI for monthly)
 *   onClose          — called when user dismisses the modal
 *   onAlreadyEnrolled— called with message when server returns ALREADY_ENROLLED / ALREADY_PAID
 *   onSuccess        — called after successful redirect setup (before Stripe page)
 */
import { useEffect, useRef, useState } from 'react'
import { FiArrowRight, FiCreditCard, FiX } from 'react-icons/fi'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import '../styles/stripe-payment.css'

const money = (amount) =>
  `৳${Number(amount || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`

export default function StripePaymentFlow({
  listing,
  paymentType = 'initial',
  billingPeriod,
  onClose,
  onAlreadyEnrolled,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const started = useRef(false)

  const isMonthly = paymentType === 'monthly'
  const isOneTime = listing.pricingType === 'ONE_TIME' || (!listing.monthlyTuitionFee && Number(listing.fee) > 0 && listing.pricingType !== 'MONTHLY_SUBSCRIPTION')
  const admission = Number(listing.admissionFee || 0)
  const tuition = Number(listing.monthlyTuitionFee ?? listing.fee) || 0
  const amount = isMonthly ? tuition : (isOneTime ? (admission || Number(listing.fee) || 0) : admission + tuition)

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', handleKey)
    }
  }, [busy, onClose])

  const startCheckout = async () => {
    if (started.current) return
    started.current = true
    setBusy(true)
    setError('')
    setErrorCode('')
    try {
      const endpoint = isMonthly
        ? '/student/payments/monthly-checkout'
        : '/student/payments/checkout'
      const { data } = await api.post(endpoint, { listingId: listing._id })
      if (!data.redirectUrl) throw new Error('Stripe did not provide a checkout URL.')
      window.location.assign(data.redirectUrl)
    } catch (err) {
      const code = err.response?.data?.code
      const message = err.response?.data?.message || err.message || 'Could not start Stripe Checkout.'
      if (code === 'ALREADY_ENROLLED' || code === 'ALREADY_PAID' || code === 'PAYMENT_PROCESSING') {
        onAlreadyEnrolled?.(message)
        return
      }
      setError(message)
      setErrorCode(code || '')
      started.current = false
      setBusy(false)
    }
  }

  return (
    <div
      className="st-backdrop"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <section className="st-modal" role="dialog" aria-modal="true" aria-labelledby="st-title">
        <header className="st-header">
          <div className="st-brand-plaque">
            <FiCreditCard className="st-logo" />
            <span className="st-wordmark">Stripe</span>
            <span className="st-payment-label">Checkout</span>
          </div>
          <button className="st-btn-icon" type="button" aria-label="Close checkout" onClick={onClose} disabled={busy}>
            <FiX />
          </button>
        </header>

        <div className="st-merchant-banner">
          <div>
            <span className="st-merchant-label">Course</span>
            <span className="st-merchant-name">{listing.name}</span>
          </div>
          <div className="st-merchant-right">
            <span className="st-invoice-label">{isMonthly ? 'Monthly tuition' : isOneTime ? 'One-Time Payment' : 'Enrollment'}</span>
            <span className="st-invoice-no">BDT</span>
          </div>
        </div>

        <div className="st-body">
          <div className="st-inner-card">
            <h2 id="st-title" className="st-merchant-course">
              {isMonthly ? 'Pay monthly tuition' : isOneTime ? 'Confirm your one-time payment' : 'Review your enrollment payment'}
            </h2>

            {isMonthly ? (
              <div className="st-amount-row">
                <span>Monthly tuition{billingPeriod ? ` · ${billingPeriod}` : ''}</span>
                <strong>{money(tuition)}</strong>
              </div>
            ) : isOneTime ? (
              <div className="st-amount-row">
                <span>Course fee <span style={{ background: '#ede9fe', color: '#6d28d9', padding: '1px 5px', borderRadius: '4px', fontSize: '9px', fontWeight: 700, marginLeft: 4 }}>Lifetime Access</span></span>
                <strong>{money(amount)}</strong>
              </div>
            ) : (
              <>
                <div className="st-amount-row"><span>Admission fee</span><strong>{money(admission)}</strong></div>
                <div className="st-amount-row"><span>First month tuition</span><strong>{money(tuition)}</strong></div>
              </>
            )}
            <div className="st-amount-row st-breakdown">
              <span>Total payable</span>
              <strong>{money(amount)}</strong>
            </div>

            <p className="st-mode-live">
              {isMonthly
                ? 'This payment covers one month of access. You will need to pay again next month to continue.'
                : isOneTime
                ? 'This is a one-time payment for lifetime course access. No recurring charges will be made.'
                : 'Your first payment covers the admission fee and first month of access. You will pay manually each subsequent month.'}
              {' '}Your payment details are entered securely on Stripe; TeachOS does not collect card details.
            </p>

            {error && (
              <p className="st-error" role="alert">
                {error}
                {(errorCode === 'SUBSCRIPTION_EXISTS' || errorCode === 'TUITION_ALREADY_PAID') && (
                  <> <Link to="/student/classes" onClick={onClose} className="st-error-link">
                    Go to My Classes <FiArrowRight />
                  </Link></>
                )}
              </p>
            )}

            <div className="st-actions">
              <button
                className="st-btn-proceed"
                type="button"
                onClick={startCheckout}
                disabled={busy || amount <= 0}
              >
                {busy ? 'Opening Stripe Checkout…' : 'Continue to Stripe'}
              </button>
              <button className="st-btn-cancel" type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
