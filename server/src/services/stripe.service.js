<<<<<<< HEAD
import Stripe from 'stripe'

let stripeClient
let configuredSecret

function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (process.env.STRIPE_MODE !== 'test' || !secretKey?.startsWith('sk_test_')) {
    const error = new Error('Stripe test payments are not configured. Set STRIPE_MODE=test and a test-mode secret key (sk_test_...) in server/.env.')
    error.status = 503
    error.code = 'STRIPE_TEST_NOT_CONFIGURED'
    throw error
  }

  if (!stripeClient || configuredSecret !== secretKey) {
    stripeClient = new Stripe(secretKey)
    configuredSecret = secretKey
  }
  return stripeClient
}

export function assertStripeTestConfigured() {
  getStripe()
}

export async function createStripeCheckoutSession({ amount, orderId, courseName, studentEmail, clientOrigin }) {
  const successUrl = `${new URL('/student/classes', clientOrigin).toString()}?paymentStatus=success&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = new URL('/student/classes?paymentStatus=cancelled', clientOrigin).toString()
  return getStripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'bdt',
        product_data: { name: courseName },
        unit_amount: Math.round(Number(amount) * 100),
      },
      quantity: 1,
    }],
    customer_email: studentEmail || undefined,
    client_reference_id: orderId,
    metadata: { orderId },
    payment_intent_data: { metadata: { orderId } },
    success_url: successUrl,
    cancel_url: cancelUrl,
  }, { idempotencyKey: orderId })
}

export async function retrieveStripeCheckoutSession(sessionId) {
  return getStripe().checkout.sessions.retrieve(sessionId)
}

export function constructStripeWebhookEvent(payload, signature) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    const error = new Error('Stripe webhook verification is not configured. Set STRIPE_WEBHOOK_SECRET in server/.env.')
    error.status = 503
    error.code = 'STRIPE_WEBHOOK_NOT_CONFIGURED'
    throw error
  }
  return getStripe().webhooks.constructEvent(payload, signature, webhookSecret)
}
=======
/**
 * Stripe Payment Service — swap-friendly architecture.
 *
 * STRIPE_MODE=demo   → returns mock data, no network calls to Stripe.
 * STRIPE_MODE=live   → uses real Stripe Checkout API (requires STRIPE_SECRET_KEY).
 *
 * Only this file needs to change when moving to real Stripe.
 * Route/controller layer is identical across all modes.
 */

import { randomUUID } from 'node:crypto'
import { getDatabase } from '../db.js'

// ─── Demo config constants ────────────────────────────────────────────────────
const DEMO_SUCCESS_URL_PATH = '/student/payment/success'
const DEMO_CANCEL_URL_PATH = '/student/payment/cancel'

// ─── Stripe API config (live mode) ────────────────────────────────────────────
function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) return null
  const stripe = require('stripe')(secretKey)
  return stripe
}

function getStripeMode() {
  return (process.env.STRIPE_MODE || 'demo').toLowerCase()
}

// ─── DEMO SERVICE IMPLEMENTATION ─────────────────────────────────────────────

function fakeSessionId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  let id = 'cs_'
  for (let i = 0; i < 24; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

async function demoCreateCheckoutSession({
  amount, currency = 'bdt', listingId, studentUid, studentName, studentEmail,
  successUrl, cancelUrl, metadata = {},
}) {
  const db = getDatabase()
  const sessionId = fakeSessionId()
  const now = new Date()
  const doc = {
    sessionId,
    paymentIntentId: null,
    status: 'complete',
    mode: 'demo',
    amount: Number(amount),
    currency: currency.toUpperCase(),
    listingId: listingId || null,
    studentUid: studentUid || null,
    studentName: studentName || null,
    studentEmail: studentEmail || null,
    successUrl,
    cancelUrl,
    metadata,
    paymentStatus: 'paid',
    createdAt: now,
    updatedAt: now,
  }
  await db.collection('stripePayments').insertOne(doc)

  // In demo mode, we simulate Stripe redirecting back to the success URL.
  const demoSuccessUrl = successUrl || `${DEMO_SUCCESS_URL_PATH}?session_id=${sessionId}`
  return {
    id: sessionId,
    url: demoSuccessUrl,
    status: 'complete',
    amount: doc.amount,
    currency: doc.currency,
    mode: 'demo',
  }
}

async function demoRetrieveSession(sessionId) {
  const db = getDatabase()
  const payment = await db.collection('stripePayments').findOne({ sessionId })
  if (!payment) return { found: false }
  return {
    found: true,
    id: payment.sessionId,
    status: payment.status,
    payment_status: payment.paymentStatus,
    amount: payment.amount,
    currency: payment.currency,
    mode: payment.mode,
    metadata: payment.metadata,
    listingId: payment.listingId,
    studentUid: payment.studentUid,
    customerDetails: payment.studentEmail ? { email: payment.studentEmail } : null,
  }
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

const mode = getStripeMode()

export async function createCheckoutSession(params) {
  if (mode === 'demo') return demoCreateCheckoutSession(params)
  const stripe = getStripe()
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY is not configured. Set STRIPE_MODE=demo or provide STRIPE_SECRET_KEY.')
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    currency: params.currency || 'bdt',
    line_items: [
      {
        price_data: {
          currency: params.currency || 'bdt',
          product_data: {
            name: params.productName || 'Course enrollment',
            ...(params.description ? { description: params.description } : {}),
          },
          unit_amount: Math.round(Number(params.amount) * 100), // Stripe uses cents
        },
        quantity: 1,
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: params.metadata || {},
    customer_email: params.studentEmail || undefined,
  })
  return {
    id: session.id,
    url: session.url,
    status: session.status,
    amount: params.amount,
    currency: params.currency,
    mode: 'live',
  }
}

export async function retrieveSession(sessionId) {
  if (mode === 'demo') return demoRetrieveSession(sessionId)
  const stripe = getStripe()
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY is not configured.')
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  return {
    found: true,
    id: session.id,
    status: session.status,
    payment_status: session.payment_status,
    amount: session.amount_total ? session.amount_total / 100 : 0,
    currency: session.currency,
    mode: 'live',
    metadata: session.metadata || {},
    customerDetails: session.customer_details || null,
  }
}

export { getStripeMode, fakeSessionId }
>>>>>>> fbaf0e5 (done Z)
