/**
 * BkashPaymentFlow.jsx
 *
 * Full 3-step demo bKash payment modal:
 *   Step 1 — Phone number entry  (POST /api/bkash/create → /api/bkash/mobile)
 *   Step 2 — OTP verification    (POST /api/bkash/otp)
 *   Step 3 — PIN entry           (POST /api/bkash/execute)
 *   Step 4 — Success receipt     (auto-enroll complete, data saved)
 *
 * Props:
 *   listing   — { _id, name, fee, category, teacherName }
 *   onClose   — called when user closes / cancels at any step
 *   onSuccess — called after successful execute with { trxID, amount }
 */

import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import '../styles/bkash-payment.css'

// ─── helpers ─────────────────────────────────────────────────────────────────
const money = (amount) =>
  `৳${Number(amount || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`

function genTrxDisplay(trxID) {
  if (trxID) return trxID
  // fallback visual id for receipt
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  let id = 'BK'
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BkashHeader() {
  return (
    <div className="bk-header">
      <div className="bk-brand-plaque">
        {/* bKash origami bird SVG */}
        <svg className="bk-bird" viewBox="0 0 64 64" fill="none">
          <polygon fill="#e2136e" points="12,18 36,4 42,28" />
          <polygon fill="#c60055" points="36,4 58,16 42,28" />
          <polygon fill="#a00045" points="42,28 58,16 62,24 48,34" />
          <polygon fill="#d91266" points="12,18 42,28 26,44" />
          <polygon fill="#b80c55" points="26,44 42,28 32,56" />
          <polygon fill="#8f0040" points="26,44 14,58 32,56" />
          <polygon fill="#f0247b" points="12,18 2,24 26,44" />
        </svg>
        <span className="bk-wordmark">b<span>K</span>ash</span>
        <span className="bk-payment-label">Payment</span>
      </div>
    </div>
  )
}

function BkashMerchantBanner({ listing, invoiceNo }) {
  return (
    <div className="bk-merchant-banner">
      <div>
        <span className="bk-merchant-label">Merchant</span>
        <span className="bk-merchant-name">TeachOS Academy</span>
      </div>
      <div className="bk-merchant-right">
        <span className="bk-invoice-label">Invoice</span>
        <span className="bk-invoice-no">{invoiceNo || '—'}</span>
      </div>
    </div>
  )
}

function BkashStepBar({ step }) {
  const steps = ['Account', 'OTP', 'PIN', 'Done']
  return (
    <div className="bk-stepbar">
      <div className="bk-stepbar-track">
        {steps.map((label, i) => (
          <div key={label} className={`bk-step ${i < step ? 'done' : ''} ${i === step - 1 ? 'active' : ''}`}>
            <div className="bk-step-dot">{i < step - 1 ? '✓' : i + 1}</div>
            <span>{label}</span>
          </div>
        ))}
        <div className="bk-step-line" style={{ width: `${((step - 1) / (steps.length - 1)) * 100}%` }} />
      </div>
    </div>
  )
}

// ─── Step 1: Phone ────────────────────────────────────────────────────────────
function StepPhone({ listing, onNext, onClose }) {
  const [phone, setPhone] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const proceed = async () => {
    setError('')
    if (!agreed) { setError('Please agree to the terms and conditions.'); return }
    if (!/^01[3-9]\d{8}$/.test(phone)) { setError('Enter a valid 11-digit Bangladeshi mobile number.'); return }
    setBusy(true)
    try {
      // 1. Create payment intent
      const { data: createData } = await api.post('/bkash/create', { listingId: listing._id })
      // 2. Set mobile → triggers OTP step
      await api.post('/bkash/mobile', { paymentID: createData.paymentID, mobileNumber: phone })
      onNext({
        paymentID: createData.paymentID,
        invoiceNo: createData.merchantInvoiceNumber,
        maskedPhone: phone.slice(0, 3) + '****' + phone.slice(-4),
        amount: createData.amount,
      })
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start payment. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bk-body">
      <div className="bk-inner-card">
        <p className="bk-merchant-course">{listing.name}</p>
        <div className="bk-amount-row">
          <span>Amount</span>
          <strong>{money(listing.initialPaymentTotal ?? listing.fee)}</strong>
        </div>
        <div className="bk-amount-row bk-breakdown">
          <span>Breakdown</span>
          <strong>{money(listing.admissionFee || 0)} admission + {money((listing.monthlyTuitionFee ?? listing.fee) || 0)} first month</strong>
        </div>
      </div>

      <label className="bk-field-label" htmlFor="bk-phone">Your bKash account number</label>
      <div className="bk-input-wrap">
        <input
          ref={inputRef}
          id="bk-phone"
          className="bk-input"
          type="tel"
          inputMode="numeric"
          maxLength={11}
          placeholder="e.g. 01XXXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && proceed()}
        />
      </div>

      <label className="bk-checkbox-label">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I agree to the <a href="/terms-of-service" target="_blank" rel="noopener noreferrer">terms and conditions</a></span>
      </label>

      {error && <p className="bk-error">{error}</p>}

      <div className="bk-actions">
        <button className="bk-btn-proceed" onClick={proceed} disabled={busy}>
          {busy ? 'Starting...' : 'PROCEED'}
        </button>
        <button className="bk-btn-close" onClick={onClose} disabled={busy}>CLOSE</button>
      </div>

      <div className="bk-hotline"><span>📞</span><strong>16247</strong></div>
    </div>
  )
}

// ─── Step 2: OTP ──────────────────────────────────────────────────────────────
function StepOTP({ paymentID, maskedPhone, onNext, onClose }) {
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(45)
  const refs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()]

  useEffect(() => { refs[0].current?.focus() }, [])

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [secondsLeft])

  const handleOtpChange = (index, value) => {
    if (!/^\d?$/.test(value)) return
    const next = [...otp]
    next[index] = value
    setOtp(next)
    if (value && index < 5) refs[index + 1].current?.focus()
  }

  const handleOtpKey = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) refs[index - 1].current?.focus()
  }

  const confirm = async () => {
    const code = otp.join('')
    setError('')
    if (code.length < 6) { setError('Enter the 6-digit verification code.'); return }
    setBusy(true)
    try {
      await api.post('/bkash/otp', { paymentID, otp: code })
      onNext()
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid OTP. Please try again.')
      setOtp(['', '', '', '', '', ''])
      refs[0].current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setSecondsLeft(45)
    setOtp(['', '', '', '', '', ''])
    refs[0].current?.focus()
  }

  return (
    <div className="bk-body">
      <label className="bk-field-label">Enter Verification Code (OTP)</label>
      <p className="bk-sub-label">
        Verification code sent to <strong>{maskedPhone}</strong>
      </p>

      <div className="bk-otp-row">
        {otp.map((digit, i) => (
          <input
            key={i}
            ref={refs[i]}
            className="bk-otp-box"
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleOtpChange(i, e.target.value)}
            onKeyDown={(e) => handleOtpKey(i, e)}
          />
        ))}
      </div>

      <div className="bk-resend-row">
        <span>Resend code in</span>
        <span className="bk-timer">{String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}</span>
        <button
          className="bk-resend-btn"
          disabled={secondsLeft > 0}
          onClick={resend}
        >
          Resend
        </button>
      </div>

      {error && <p className="bk-error">{error}</p>}

      <div className="bk-actions">
        <button className="bk-btn-proceed" onClick={confirm} disabled={busy}>
          {busy ? 'VERIFYING...' : 'CONFIRM'}
          {busy && <span className="bk-spinner" />}
        </button>
        <button className="bk-btn-close" onClick={onClose} disabled={busy}>CLOSE</button>
      </div>

      <div className="bk-hotline"><span>📞</span><strong>16247</strong></div>
    </div>
  )
}

// ─── Step 3: PIN ──────────────────────────────────────────────────────────────
function StepPIN({ paymentID, maskedPhone, amount, listing, onNext, onClose }) {
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const confirm = async () => {
    setError('')
    if (!/^\d{5}$/.test(pin)) { setError('Enter your 5-digit bKash account PIN.'); return }
    setBusy(true)
    try {
      const { data } = await api.post('/bkash/execute', { paymentID, pin, mobileNumber: maskedPhone })
      onNext({ trxID: data.trxID, amount: data.amount ?? amount })
    } catch (err) {
      setError(err.response?.data?.message || 'Incorrect PIN. Please try again.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bk-body">
      <div className="bk-inner-card bk-pin-card">
        <p className="bk-merchant-course">{listing.name}</p>
        <div className="bk-amount-row">
          <span>Amount</span>
          <strong>{money(amount)}</strong>
        </div>
        <div className="bk-amount-row bk-breakdown">
          <span>Breakdown</span>
          <strong>{money(listing.admissionFee || 0)} admission + {money((listing.monthlyTuitionFee ?? listing.fee) || 0)} first month</strong>
        </div>
      </div>

      <label className="bk-field-label" htmlFor="bk-pin">Enter PIN</label>
      <p className="bk-sub-label">Enter your 5-digit bKash account PIN</p>

      <div className="bk-input-wrap bk-pin-wrap">
        <input
          ref={inputRef}
          id="bk-pin"
          className="bk-input bk-input-pin"
          type={showPin ? 'text' : 'password'}
          inputMode="numeric"
          maxLength={5}
          placeholder="•••••"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && confirm()}
          autoComplete="off"
        />
        <button
          type="button"
          className="bk-pin-toggle"
          onClick={() => setShowPin((v) => !v)}
          aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
        >
          {showPin ? '🔒' : '🔢'}
        </button>
      </div>

      <div className="bk-pin-utils">
        <span className="bk-anti-keylogger">🛡 Anti-Keylogger</span>
        <button type="button" className="bk-clear-btn" onClick={() => { setPin(''); inputRef.current?.focus() }}>
          Clear PIN
        </button>
      </div>

      {error && <p className="bk-error">{error}</p>}

      <div className="bk-security-note">
        <span>🔐</span>
        <p><strong>Security Warning:</strong> Never share your bKash PIN or OTP with anyone.</p>
      </div>

      <div className="bk-actions">
        <button className="bk-btn-proceed" onClick={confirm} disabled={busy}>
          {busy ? (
            <>
              <span>VERIFYING...</span>
              <span className="bk-spinner" />
            </>
          ) : (
            <>CONFIRM <span className="bk-arrow">→</span></>
          )}
        </button>
        <button className="bk-btn-close" onClick={onClose} disabled={busy}>CLOSE</button>
      </div>

      <div className="bk-hotline"><span>📞</span><strong>16247</strong></div>
    </div>
  )
}

// ─── Step 4: Success receipt ──────────────────────────────────────────────────
function StepSuccess({ trxID, amount, listing, onClose }) {
  const [copied, setCopied] = useState(false)
  const [balanceVisible, setBalanceVisible] = useState(false)
  const displayTrx = genTrxDisplay(trxID)
  const now = new Date()
  const timeLabel = now.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })
  const dateLabel = now.toLocaleDateString('en-BD', { day: '2-digit', month: '2-digit', year: '2-digit' })

  const copyTrx = async () => {
    try { await navigator.clipboard.writeText(displayTrx) } catch { /* fallback silent */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 2200)
  }

  return (
    <div className="bk-success-wrap">
      {/* Success header */}
      <div className="bk-success-header">
        <div className="bk-success-text">
          <h2><span className="bk-success-pink">আপনার পে বিল</span> <span className="bk-success-green">সফল হয়েছে</span></h2>
          <p className="bk-success-sub">
            <span className="bk-green-dot" /> বিল সফলভাবে পরিশোধিত হয়েছে
          </p>
        </div>
        <div className="bk-check-circle">
          <span className="bk-check-icon">✓</span>
        </div>
      </div>

      {/* Merchant banner */}
      <div className="bk-success-merchant">
        <div className="bk-success-merchant-icon">
          <svg viewBox="0 0 40 40" fill="none" width="32" height="32">
            <path d="M6 30C10 24 16 20 25 18C28 17.5 32 17.2 35 17C31 22 24 27 18 30C13 32 9 31.5 6 30Z" fill="#107c41" opacity="0.85" />
            <path d="M12 12C18 10 25 12 32 20C28 22 22 22 17 20C13 18 12 15 12 12Z" fill="#8127cf" />
            <circle cx="28" cy="11" r="3" fill="#2170e4" />
          </svg>
        </div>
        <div>
          <strong>TeachOS Academy</strong>
          <p>{listing.name}</p>
        </div>
      </div>

      {/* Receipt grid */}
      <div className="bk-receipt-grid">
        <div className="bk-receipt-cell">
          <span>সময়</span>
          <strong>{timeLabel} {dateLabel}</strong>
        </div>
        <div className="bk-receipt-cell">
          <span>ট্রানজেকশন আইডি</span>
          <div className="bk-trx-row">
            <strong id="bk-trx-id">{displayTrx}</strong>
            <button className="bk-copy-btn" onClick={copyTrx} aria-label="Copy transaction ID">
              {copied ? '✓' : '⎘'}
            </button>
          </div>
        </div>
        <div className="bk-receipt-cell">
          <span>সর্বমোট</span>
          <strong className="bk-amount-large">{money(amount || listing.fee)}</strong>
          <small>চার্জ প্রযোজ্য নয়</small>
        </div>
        <div className="bk-receipt-cell">
          <span>নতুন ব্যালেন্স</span>
          <div className="bk-trx-row">
            <strong>{balanceVisible ? '৳ ৩,৪৫০.৫০' : '••••••••••'}</strong>
            <button className="bk-copy-btn" onClick={() => setBalanceVisible((v) => !v)} aria-label="Toggle balance">
              {balanceVisible ? '🙈' : '👁'}
            </button>
          </div>
        </div>
        <div className="bk-receipt-cell bk-receipt-full">
          <span>কোর্স</span>
          <strong>{listing.name}</strong>
        </div>
      </div>

      {/* Reward points */}
      <div className="bk-reward-strip">
        <div className="bk-reward-icon">⭐</div>
        <div>
          <strong>বিকাশ রিওয়ার্ড পয়েন্ট</strong>
          <p>আপনি +৫০ পয়েন্ট অর্জন করেছেন · মোট: ১,৪২০</p>
        </div>
      </div>

      {/* Actions */}
      <div className="bk-success-actions">
        <button className="bk-btn-done" onClick={onClose}>
          হোমে ফিরে যান
        </button>
      </div>

      {/* Copy toast */}
      {copied && (
        <div className="bk-copy-toast">
          ✓ ট্রানজেকশন আইডি কপি করা হয়েছে
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BkashPaymentFlow({ listing, onClose, onSuccess }) {
  const [step, setStep] = useState(1)
  const [paymentCtx, setPaymentCtx] = useState(null) // { paymentID, invoiceNo, maskedPhone, amount }
  const [result, setResult] = useState(null)          // { trxID, amount }
  const backdropRef = useRef(null)

  // Close on backdrop click
  const handleBackdropClick = (e) => {
    if (e.target === backdropRef.current) onClose()
  }

  // Keyboard: Esc to close
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handlePhoneNext = (ctx) => {
    setPaymentCtx(ctx)
    setStep(2)
  }

  const handleOtpNext = () => setStep(3)

  const handlePinNext = (res) => {
    setResult(res)
    setStep(4)
    onSuccess?.(res)
  }

  const handleSuccessClose = () => {
    onClose()
  }

  return (
    <div className="bk-backdrop" ref={backdropRef} onClick={handleBackdropClick} role="presentation">
      <div
        className={`bk-modal${step === 4 ? ' bk-modal-success' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="bKash payment"
      >
        {step < 4 && (
          <>
            <BkashHeader />
            <BkashMerchantBanner
              listing={listing}
              invoiceNo={paymentCtx?.invoiceNo}
            />
            <BkashStepBar step={step} />
          </>
        )}

        {step === 1 && (
          <StepPhone listing={listing} onNext={handlePhoneNext} onClose={onClose} />
        )}
        {step === 2 && (
          <StepOTP
            paymentID={paymentCtx.paymentID}
            maskedPhone={paymentCtx.maskedPhone}
            onNext={handleOtpNext}
            onClose={onClose}
          />
        )}
        {step === 3 && (
          <StepPIN
            paymentID={paymentCtx.paymentID}
            maskedPhone={paymentCtx.maskedPhone}
            amount={paymentCtx.amount}
            listing={listing}
            onNext={handlePinNext}
            onClose={onClose}
          />
        )}
        {step === 4 && (
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
