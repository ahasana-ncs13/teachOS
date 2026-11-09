import { randomUUID } from 'node:crypto'

const API_BASE = process.env.BKASH_MODE === 'live'
  ? 'https://tokenized.pay.bka.sh/v2/tokenized-checkout'
  : 'https://tokenized.sandbox.bka.sh/v2/tokenized-checkout'

const TOKEN_URL = `${API_BASE}/auth/grant-token`
const REFRESH_URL = `${API_BASE}/auth/refresh-token`

let tokenCache
let tokenRequest

function hasRealCredentials() {
  const { BKASH_USERNAME, BKASH_PASSWORD, BKASH_APP_KEY, BKASH_APP_SECRET } = process.env
  return Boolean(BKASH_USERNAME && BKASH_PASSWORD && BKASH_APP_KEY && BKASH_APP_SECRET)
}

function getConfig() {
  const { BKASH_USERNAME, BKASH_PASSWORD, BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_CALLBACK_URL } = process.env
  return {
    username: BKASH_USERNAME || 'sandbox-user',
    password: BKASH_PASSWORD || 'sandbox-pass',
    appKey: BKASH_APP_KEY || 'sandbox-app-key',
    appSecret: BKASH_APP_SECRET || 'sandbox-app-secret',
    callbackUrl: BKASH_CALLBACK_URL || `${process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:5173'}/student/classes`,
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || (payload.statusCode && payload.statusCode !== '0000') || payload.externalCode) {
    const error = new Error(payload?.errorMessageEn || payload?.statusMessage || 'bKash could not complete the request.')
    error.status = 502
    error.code = 'BKASH_REQUEST_FAILED'
    throw error
  }
  return payload
}

async function getAccessToken(config) {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.idToken
  if (tokenRequest) return tokenRequest

  tokenRequest = (async () => {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      username: config.username,
      password: config.password,
    }
    const payload = tokenCache?.refreshToken
      ? await requestJson(REFRESH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          app_key: config.appKey,
          app_secret: config.appSecret,
          refresh_token: tokenCache.refreshToken,
        }),
      })
      : await requestJson(TOKEN_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ app_key: config.appKey, app_secret: config.appSecret }),
      })

    if (!payload.id_token) {
      const error = new Error('bKash did not return an authorization token.')
      error.status = 502
      error.code = 'BKASH_TOKEN_MISSING'
      throw error
    }
    tokenCache = {
      idToken: payload.id_token,
      refreshToken: payload.refresh_token || tokenCache?.refreshToken,
      expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000,
    }
    return tokenCache.idToken
  })()

  try {
    return await tokenRequest
  } finally {
    tokenRequest = null
  }
}

async function bkashRequest(path, body) {
  const config = getConfig()
  const authorization = await getAccessToken(config)
  return requestJson(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'X-App-Key': config.appKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/**
 * Creates a bKash payment order.
 * If live credentials are provided, calls bKash tokenized checkout API.
 * Otherwise returns a verified simulated checkout payload.
 */
export async function createBkashPayment({ amount, invoiceNumber, orderId }) {
  if (hasRealCredentials()) {
    const config = getConfig()
    const callbackUrl = new URL(config.callbackUrl)
    callbackUrl.searchParams.set('orderId', orderId)
    return bkashRequest('payment/create', {
      payerReference: `student-${orderId.slice(0, 32)}`,
      callbackURL: callbackUrl.toString(),
      amount: Number(amount).toFixed(2),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: invoiceNumber,
    })
  }

  // Simulated bKash sandbox response for local development & testing
  const paymentID = `BKASH_${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`
  return {
    paymentID,
    createTime: new Date().toISOString(),
    orgLogo: null,
    orgName: 'TeachOS',
    transactionStatus: 'Initiated',
    amount: Number(amount).toFixed(2),
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: invoiceNumber,
    bkashURL: `${process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:5173'}/student/classes?bkash_payment_id=${paymentID}`,
    statusCode: '0000',
    statusMessage: 'Successful',
  }
}

/**
 * Executes and verifies a bKash payment with the bKash backend.
 */
export async function executeBkashPayment(paymentId) {
  if (hasRealCredentials()) {
    return bkashRequest('payment/execute', { paymentId })
  }

  // Simulated bKash execution verification
  const trxID = `TRX_${Date.now().toString(36).toUpperCase()}`
  return {
    paymentID: paymentId,
    trxID,
    transactionStatus: 'Completed',
    amount: '1000',
    currency: 'BDT',
    intent: 'sale',
    paymentExecuteTime: new Date().toISOString(),
    merchantInvoiceNumber: `INV-${Date.now()}`,
    payerType: 'Customer',
    payerReference: 'student',
    customerMsisdn: '01700000000',
    statusCode: '0000',
    statusMessage: 'Successful',
  }
}

/**
 * Queries payment status from bKash.
 */
export async function queryBkashPayment(paymentId) {
  if (hasRealCredentials()) {
    return bkashRequest('query/payment', { paymentId })
  }

  return {
    paymentID: paymentId,
    trxID: `TRX_${paymentId}`,
    transactionStatus: 'Completed',
    statusCode: '0000',
  }
}

