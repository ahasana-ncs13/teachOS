import Stripe from 'stripe'

let stripeClient
let stripeClientKey

function configurationError(message) {
  const error = new Error(message)
  error.status = 503
  error.code = 'STRIPE_NOT_CONFIGURED'
  return error
}

function expectedStripeKey(mode) {
  if (!['test', 'live'].includes(mode)) {
    throw configurationError('STRIPE_MODE must be set to test or live.')
  }
  const secretKey = process.env.STRIPE_SECRET_KEY
  const prefix = mode === 'test' ? 'sk_test_' : 'sk_live_'
  if (!secretKey || !secretKey.startsWith(prefix)) {
    throw configurationError(`Configure a ${mode}-mode Stripe secret key in STRIPE_SECRET_KEY.`)
  }
  return secretKey
}

function getStripe() {
  const secretKey = expectedStripeKey(getStripeMode())
  if (!stripeClient || stripeClientKey !== secretKey) {
    stripeClient = new Stripe(secretKey)
    stripeClientKey = secretKey
  }
  return stripeClient
}

export function getStripeMode() {
  return (process.env.STRIPE_MODE || 'test').trim().toLowerCase()
}

export function assertStripeConfigured() {
  expectedStripeKey(getStripeMode())
}

/**
 * Create a one-time Stripe Checkout session (mode: 'payment').
 * All monthly course payments — initial or renewal — go through individual
 * one-time sessions. No automatic recurring subscriptions are created.
 */
export async function createStripeCheckoutSession({
  amount,
  orderId,
  productName,
  customerEmail,
  clientOrigin,
  successUrl,
  cancelUrl,
  metadata = {},
}) {
  const stripe = getStripe()
  const amountInMinorUnits = Math.round(Number(amount) * 100)
  if (!Number.isSafeInteger(amountInMinorUnits) || amountInMinorUnits < 1) {
    const error = new Error('Stripe checkout amount must be a positive monetary value.')
    error.status = 400
    error.code = 'INVALID_STRIPE_AMOUNT'
    throw error
  }

  const origin = clientOrigin || (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim()
  const sessionMetadata = { ...(orderId ? { orderId } : {}), ...metadata }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'bdt',
        product_data: { name: productName || 'TeachOS course payment' },
        unit_amount: amountInMinorUnits,
      },
      quantity: 1,
    }],
    success_url: successUrl || `${origin}/student/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${origin}/student/payment/cancel`,
    ...(customerEmail ? { customer_email: customerEmail } : {}),
    ...(orderId ? { client_reference_id: orderId } : {}),
    metadata: sessionMetadata,
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
  })
  return session
}

export async function retrieveStripeCheckoutSession(sessionId) {
  return getStripe().checkout.sessions.retrieve(sessionId)
}

export function constructStripeWebhookEvent(rawBody, signature) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    throw configurationError('Configure STRIPE_WEBHOOK_SECRET to verify Stripe webhook events.')
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret)
}

export async function retrieveSession(sessionId) {
  const session = await retrieveStripeCheckoutSession(sessionId)
  return {
    found: true,
    id: session.id,
    status: session.status,
    payment_status: session.payment_status,
    amount: session.amount_total ? session.amount_total / 100 : 0,
    currency: session.currency?.toUpperCase() || 'BDT',
    mode: session.livemode ? 'live' : 'test',
    metadata: session.metadata || {},
    listingId: session.metadata?.listingId || null,
    studentUid: session.metadata?.studentUid || null,
    customerDetails: session.customer_details || null,
  }
}
