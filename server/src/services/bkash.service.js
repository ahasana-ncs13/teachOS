/**
 * bKash Payment Service — swap-friendly architecture.
 *
 * BKASH_MODE=demo   → returns mock data, no network calls.
 * BKASH_MODE=sandbox → uses real bKash Tokenized Checkout Sandbox API.
 * BKASH_MODE=live    → uses real bKash production API.
 *
 * Only this file needs to change when moving to real bKash.
 * Route/controller layer is identical across all modes.
 */

import { randomUUID } from 'node:crypto'
import { getDatabase } from '../db.js'

// ─── Demo config constants ────────────────────────────────────────────────────
const DEMO_OTP = '123456'       // Any 6-digit code is accepted in demo; this is the "cheat code"
const DEMO_PIN = '12345'        // Any 5-digit PIN is accepted in demo; this is the "cheat code"

// ─── bKash API config (sandbox / live) ───────────────────────────────────────
// These are read from .env only in sandbox/live mode.
const BKASH_BASE_URL = {
  sandbox: 'https://tokenized.sandbox.bka.sh/v1.2.0-beta',
  live: 'https://tokenized.pay.bka.sh/v1.2.0-beta',
}

function getBkashConfig() {
  return {
    appKey: process.env.BKASH_APP_KEY,
    appSecret: process.env.BKASH_APP_SECRET,
    username: process.env.BKASH_USERNAME,
    password: process.env.BKASH_PASSWORD,
    baseUrl: BKASH_BASE_URL[process.env.BKASH_MODE] || BKASH_BASE_URL.sandbox,
  }
}

/** Generate a fake bKash-style payment ID, e.g. "TR0011XbGVbM1748" */
function fakeTrxID() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  let id = 'BK'
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

function maskMsisdn(msisdn) {
  if (typeof msisdn !== 'string' || msisdn.length < 6) return '***'
  return msisdn.slice(0, 3) + '****' + msisdn.slice(-4)
}

// ─── DEMO SERVICE IMPLEMENTATION ─────────────────────────────────────────────

async function demoCreatePayment({ amount, invoiceNumber, orderId, studentUid, studentName }) {
  const db = getDatabase()
  const paymentID = `DEMO-${randomUUID().toUpperCase().replace(/-/g, '').slice(0, 16)}`
  const now = new Date()
  const doc = {
    paymentID,
    orderId: orderId || null,
    invoiceNumber: invoiceNumber || null,
    amount: Number(amount),
    currency: 'BDT',
    customerMsisdn: null,
    status: 'initiated',
    mode: 'demo',
    trxID: null,
    studentUid: studentUid || null,
    studentName: studentName || null,
    otpVerified: false,
    pinVerified: false,
    createdAt: now,
    updatedAt: now,
  }
  await db.collection('bkashPayments').insertOne(doc)
  return {
    paymentID,
    bkashURL: null,   // In real mode this would be the bKash checkout URL
    amount: doc.amount,
    currency: 'BDT',
    merchantInvoiceNumber: invoiceNumber || null,
    mode: 'demo',
  }
}

async function demoVerifyOtp({ paymentID, otp }) {
  const db = getDatabase()
  const payment = await db.collection('bkashPayments').findOne({ paymentID })
  if (!payment) return { success: false, reason: 'Payment not found.' }
  if (payment.status !== 'otp_pending' && payment.status !== 'initiated') {
    return { success: false, reason: 'Payment is not awaiting OTP verification.' }
  }
  // Demo: accept any 6-digit code
  const valid = typeof otp === 'string' && /^\d{6}$/.test(otp)
  if (!valid) return { success: false, reason: 'Invalid OTP. Please enter a 6-digit code.' }
  await db.collection('bkashPayments').updateOne(
    { paymentID },
    { $set: { status: 'pin_pending', otpVerified: true, updatedAt: new Date() } },
  )
  return { success: true }
}

async function demoExecutePayment({ paymentID, pin, mobileNumber }) {
  const db = getDatabase()
  const payment = await db.collection('bkashPayments').findOne({ paymentID })
  if (!payment) return { success: false, reason: 'Payment not found.' }
  if (payment.status === 'completed') {
    return { success: true, trxID: payment.trxID, alreadyCompleted: true }
  }

  // Demo: accept any 5-digit PIN
  const valid = typeof pin === 'string' && /^\d{5}$/.test(pin)
  if (!valid) return { success: false, reason: 'Incorrect PIN. Please try again.' }

  const trxID = fakeTrxID()
  const now = new Date()
  const masked = mobileNumber ? maskMsisdn(mobileNumber) : payment.customerMsisdn

  await db.collection('bkashPayments').updateOne(
    { paymentID },
    {
      $set: {
        status: 'completed',
        trxID,
        pinVerified: true,
        customerMsisdn: masked,
        completedAt: now,
        updatedAt: now,
      },
    },
  )
  return {
    success: true,
    trxID,
    amount: payment.amount,
    currency: 'BDT',
    merchantInvoiceNumber: payment.invoiceNumber,
    customerMsisdn: masked,
    paymentID,
  }
}

async function demoQueryPayment({ paymentID }) {
  const db = getDatabase()
  const payment = await db.collection('bkashPayments').findOne({ paymentID })
  if (!payment) return { found: false }
  return {
    found: true,
    paymentID: payment.paymentID,
    trxID: payment.trxID,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    customerMsisdn: payment.customerMsisdn,
    createdAt: payment.createdAt,
    completedAt: payment.completedAt || null,
  }
}

async function demoSetMobileNumber({ paymentID, mobileNumber }) {
  const db = getDatabase()
  const masked = maskMsisdn(mobileNumber)
  await db.collection('bkashPayments').updateOne(
    { paymentID },
    { $set: { customerMsisdn: masked, status: 'otp_pending', updatedAt: new Date() } },
  )
  return { success: true, maskedMsisdn: masked }
}

// ─── SANDBOX / LIVE STUBS ────────────────────────────────────────────────────
// TODO: Replace each stub below with real bKash Tokenized Checkout API calls.
// Reference: https://developer.bka.sh/docs/tokenized-checkout-process-overview

async function _grantToken() {
  // TODO: POST {baseUrl}/tokenized/checkout/token/grant
  // Headers: username, password, Content-Type: application/json
  // Body: { app_key, app_secret }
  // Returns: { id_token, refresh_token, token_type, expires_in }
  const { appKey, appSecret, username, password, baseUrl } = getBkashConfig()
  void appKey; void appSecret; void username; void password; void baseUrl
  throw new Error('TODO: implement bKash token grant for sandbox/live mode')
}

async function sandboxCreatePayment({ amount, invoiceNumber, orderId, studentUid, studentName }) {
  // TODO: call _grantToken(), then POST {baseUrl}/tokenized/checkout/create
  // Body: { mode: '0011', payerReference, callbackURL, amount, currency, intent, merchantInvoiceNumber }
  void amount; void invoiceNumber; void orderId; void studentUid; void studentName
  void _grantToken
  throw new Error('TODO: implement bKash createPayment for sandbox/live mode')
}

async function sandboxVerifyOtp({ paymentID, otp }) {
  // TODO: bKash OTP verification is handled on the bKash-hosted page (redirect flow).
  // In Tokenized Checkout the merchant does not handle OTP directly.
  void paymentID; void otp
  throw new Error('TODO: OTP is handled by bKash in redirect mode. Use the callback URL flow.')
}

async function sandboxExecutePayment({ paymentID, pin }) {
  // TODO: POST {baseUrl}/tokenized/checkout/execute
  // Body: { paymentID }   (PIN is handled by bKash)
  void pin
  const { baseUrl } = getBkashConfig()
  void baseUrl; void paymentID
  throw new Error('TODO: implement bKash executePayment for sandbox/live mode')
}

async function sandboxQueryPayment({ paymentID }) {
  // TODO: GET {baseUrl}/tokenized/checkout/payment/status?paymentID={paymentID}
  const { baseUrl } = getBkashConfig()
  void baseUrl; void paymentID
  throw new Error('TODO: implement bKash queryPayment for sandbox/live mode')
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

const mode = (process.env.BKASH_MODE || 'demo').toLowerCase()

export async function createPayment(params) {
  return mode === 'demo' ? demoCreatePayment(params) : sandboxCreatePayment(params)
}

export async function setMobileNumber(params) {
  if (mode !== 'demo') throw new Error('setMobileNumber is only used in demo mode.')
  return demoSetMobileNumber(params)
}

export async function verifyOtp(params) {
  return mode === 'demo' ? demoVerifyOtp(params) : sandboxVerifyOtp(params)
}

export async function executePayment(params) {
  return mode === 'demo' ? demoExecutePayment(params) : sandboxExecutePayment(params)
}

export async function queryPayment(params) {
  return mode === 'demo' ? demoQueryPayment(params) : sandboxQueryPayment(params)
}

export { DEMO_OTP, DEMO_PIN, maskMsisdn }
