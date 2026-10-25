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
