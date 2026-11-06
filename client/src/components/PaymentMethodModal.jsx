/**
 * PaymentMethodModal.jsx
 *
 * Payment method selection modal shown when a student clicks "Pay & enroll".
 * Shows two cards: Stripe (Credit/Debit Card) and bKash (Mobile Banking).
 * After the user picks a method and clicks Continue, the corresponding payment flow opens.
 *
 * Props:
 *   listing    — { _id, name, fee, category, teacherName, admissionFee, monthlyTuitionFee, initialPaymentTotal }
 *   onClose    — called when user closes / cancels
 *   onMethod   — called with the selected method ('stripe' | 'bkash') after user clicks Continue
 */

import { useState } from 'react'
import { FiCreditCard, FiX } from 'react-icons/fi'
import '../styles/student-portal.css'

const money = (amount) =>
  `৳${Number(amount || 0).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`

export default function PaymentMethodModal({ listing, onClose, onMethod }) {
  const [method, setMethod] = useState('stripe')

  const admission = Number(listing.admissionFee || 0)
  const tuition = Number(listing.monthlyTuitionFee ?? listing.fee) || 0
  const initialTotal = admission + tuition

  const handleContinue = () => {
    onMethod?.(method)
  }

  const isStripe = method === 'stripe'

  return (
    <div className="pm-backdrop" onClick={onClose} role="presentation">
      <div className="pm-modal" role="dialog" aria-modal="true" aria-label="Choose payment method" onClick={(e) => e.stopPropagation()}>
        <div className="pm-header">
          <div>
            <h2 className="pm-title">Choose Payment Method</h2>
            <p className="pm-subtitle">Select your preferred payment method to continue with enrollment.</p>
          </div>
          <button className="pm-close" type="button" aria-label="Close modal" onClick={onClose}>
            <FiX />
          </button>
        </div>

        {/* Course summary */}
        <div className="pm-summary">
          <div className="pm-summary-left">
            <div className="pm-summary-icon">{listing.category[0]}</div>
            <div className="pm-summary-info">
              <h3 className="pm-course-name">{listing.name}</h3>
              <p className="pm-course-meta">{listing.teacherName || 'TeachOS teacher'} · {listing.category}</p>
            </div>
          </div>
          <div className="pm-summary-right">
            <div className="pm-price-label">Tuition</div>
            <div className="pm-price-value">{money(initialTotal)}</div>
          </div>
        </div>

        {/* Payment method options */}
        <div className="pm-options">
          <fieldset className="pm-fieldset">
            <legend className="pm-legend">Available Gateways</legend>
            <div className="pm-grid">
              {/* Stripe card */}
              <label
                className={`pm-card ${isStripe ? 'pm-card-selected' : ''}`}
                onClick={() => setMethod('stripe')}
              >
                <input type="radio" name="payment_gateway" value="stripe" checked={isStripe} readOnly className="pm-radio" />
                <div className="pm-card-top">
                  <div className="pm-card-badge">
                    <FiCreditCard className="pm-badge-icon" />
                    <span className="pm-badge-label">Credit / Debit Card</span>
                  </div>
                  <span className="pm-card-gateway">Stripe Gateway</span>
                </div>
                <div className="pm-card-details">
                  <p className="pm-card-description">
                    Visa, Mastercard, Amex, Apple Pay &amp; global cards.
                  </p>
                  <div className="pm-card-footer">
                    <span className="pm-card-perk">Instant Enroll</span>
                    <span className="pm-card-currency">USD / BDT</span>
                  </div>
                </div>
              </label>

              {/* bKash card */}
              <label
                className={`pm-card ${!isStripe ? 'pm-card-selected' : ''}`}
                onClick={() => setMethod('bkash')}
              >
                <input type="radio" name="payment_gateway" value="bkash" checked={!isStripe} readOnly className="pm-radio" />
                <div className="pm-card-top">
                  <div className="pm-card-badge pm-badge-bkash">
                    <span className="pm-badge-symbol">৳</span>
                    <span className="pm-badge-label">bKash Checkout</span>
                  </div>
                  <span className="pm-card-gateway">Mobile Banking (MFS)</span>
                </div>
                <div className="pm-card-details">
                  <p className="pm-card-description">
                    Pay directly via OTP &amp; PIN checkout modal (Bangladesh).
                  </p>
                  <div className="pm-card-footer">
                    <span className="pm-card-perk">0% Extra Charge</span>
                    <span className="pm-card-currency">BDT Only</span>
                  </div>
                </div>
              </label>
            </div>
          </fieldset>
        </div>

        {/* Pricing breakdown */}
        <div className="pm-breakdown">
          <div className="pm-row">
            <span>Course Tuition</span>
            <span>{money(initialTotal)}</span>
          </div>
          {admission > 0 && tuition > 0 && (
            <div className="pm-row pm-row-small">
              <span>Admission Fee</span>
              <span>{money(admission)}</span>
            </div>
          )}
          <div className="pm-row pm-row-small">
            <span>First Month Tuition</span>
            <span>{money(tuition)}</span>
          </div>
          <div className="pm-row pm-total">
            <span>Total Payable</span>
            <span>{money(initialTotal)}</span>
          </div>
          <div className="pm-note">
            <span>256-bit SSL encrypted · Instant batch unlock upon payment confirmation.</span>
          </div>
        </div>

        {/* Footer actions */}
        <div className="pm-footer">
          <button className="pm-btn-cancel" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="pm-btn-continue" type="button" onClick={handleContinue}>
            <span className="pm-btn-text">
              {isStripe ? 'Continue with Stripe →' : 'Continue with bKash →'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
