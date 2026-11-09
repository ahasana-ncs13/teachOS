/**
 * Debug script: inspect all studentPayments + studentEnrollments for a
 * given student UID and optional listing ID.
 *
 * Usage (from repo root):
 *   node server/src/scripts/debug-payment.js <studentUid> [listingId]
 *
 * Example:
 *   node server/src/scripts/debug-payment.js abc123uid 64f1a2b3c4d5e6f7a8b9c0d1
 */

import { connectDatabase, closeDatabase, getDatabase } from '../db.js'
import { ObjectId } from 'mongodb'

const [, , studentUid, rawListingId] = process.argv
if (!studentUid) {
  console.error('Usage: node debug-payment.js <studentUid> [listingId]')
  process.exit(1)
}

await connectDatabase()
const db = getDatabase()

const paymentQuery = { studentUid }
if (rawListingId && ObjectId.isValid(rawListingId)) {
  paymentQuery.listingId = new ObjectId(rawListingId)
}

const [payments, enrollments] = await Promise.all([
  db.collection('studentPayments').find(paymentQuery).sort({ createdAt: -1 }).toArray(),
  db.collection('studentEnrollments').find(paymentQuery).sort({ createdAt: -1 }).toArray(),
])

console.log('\n=== studentPayments ===')
for (const p of payments) {
  console.log({
    _id: String(p._id),
    paymentId: p.paymentId,
    listingId: String(p.listingId),
    courseName: p.courseName,
    status: p.status,
    paymentType: p.paymentType,
    recurringTuition: p.recurringTuition,
    subscriptionStatus: p.subscriptionStatus,
    providerSubscriptionId: p.providerSubscriptionId,
    providerPaymentId: p.providerPaymentId,
    gateway: p.gateway,
    mode: p.mode,
    amount: p.amount,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  })
}
console.log(`Total: ${payments.length}`)

console.log('\n=== studentEnrollments ===')
for (const e of enrollments) {
  console.log({
    _id: String(e._id),
    listingId: String(e.listingId),
    name: e.name,
    status: e.status,
    paymentStatus: e.paymentStatus,
    stripeSubscriptionId: e.stripeSubscriptionId,
    subscriptionStatus: e.subscriptionStatus,
    autoRenew: e.autoRenew,
    billingExpiresAt: e.billingExpiresAt,
    enrolledAt: e.enrolledAt,
  })
}
console.log(`Total: ${enrollments.length}`)

await closeDatabase()
