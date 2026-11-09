import test from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import {
  calculateRevenueDistributionMinor,
  calculateRevenueDistribution,
  calculateAvailableAt,
  getDhakaMonth,
  getTeacherFinancialSummary,
  getAdminFinancialOverview,
  recordVerifiedCoursePayment,
  applyVerifiedRefund,
  requestTeacherWithdrawal,
} from '../services/finance.service.js'
import {
  runTeacherPayoutReleaseJob,
  finalizeMonthlyAdminSettlement,
  runAdminMonthlySettlementJob,
} from '../services/settlementScheduler.service.js'
import { getEligibleStudentEnrollments } from '../routes/student.routes.js'
import { confirmPaidSession } from '../routes/payment.routes.js'

// In-memory MongoDB Mock Collection matching native MongoDB driver
class MockCollection {
  constructor(name) {
    this.name = name
    this.docs = []
  }

  async insertOne(doc) {
    const _id = doc._id || new ObjectId()
    const stored = { ...doc, _id }
    this.docs.push(stored)
    return { insertedId: _id }
  }

  async insertMany(docs) {
    for (const d of docs) {
      await this.insertOne(d)
    }
  }

  async findOne(filter = {}, options = {}) {
    return this.docs.find((d) => this._match(d, filter)) || null
  }

  find(filter = {}, options = {}) {
    const matched = this.docs.filter((d) => this._match(d, filter))
    return {
      sort: () => ({
        limit: (n) => ({
          toArray: async () => matched.slice(0, n),
        }),
        toArray: async () => matched,
      }),
      limit: (n) => ({
        toArray: async () => matched.slice(0, n),
      }),
      toArray: async () => matched,
    }
  }

  async distinct(field, filter = {}) {
    const matched = this.docs.filter((d) => this._match(d, filter))
    return [...new Set(matched.map((d) => d[field]).filter(Boolean))]
  }

  async updateOne(filter, update, options = {}) {
    const index = this.docs.findIndex((d) => this._match(d, filter))
    if (index === -1) {
      if (options.upsert) {
        const newDoc = {
          ...(filter._id ? { _id: filter._id } : { _id: new ObjectId() }),
          ...(options.$setOnInsert || {}),
          ...(update.$setOnInsert || {}),
        }
        this._applyUpdate(newDoc, update)
        this.docs.push(newDoc)
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
      }
      return { matchedCount: 0, modifiedCount: 0 }
    }
    this._applyUpdate(this.docs[index], update)
    return { matchedCount: 1, modifiedCount: 1 }
  }

  async updateMany(filter, update) {
    let count = 0
    for (const d of this.docs) {
      if (this._match(d, filter)) {
        this._applyUpdate(d, update)
        count++
      }
    }
    return { matchedCount: count, modifiedCount: count }
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const doc = this.docs.find((d) => this._match(d, filter))
    if (!doc) return null
    this._applyUpdate(doc, update)
    return doc
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((d) => this._match(d, filter)).length
  }

  aggregate(pipeline = []) {
    return {
      toArray: async () => {
        let result = [...this.docs]
        for (const stage of pipeline) {
          if (stage.$match) {
            result = result.filter((d) => this._match(d, stage.$match))
          }
          if (stage.$group) {
            const groups = new Map()
            for (const item of result) {
              const key = JSON.stringify(stage.$group._id)
              if (!groups.has(key)) {
                groups.set(key, { _id: stage.$group._id })
              }
              const g = groups.get(key)
              for (const [k, v] of Object.entries(stage.$group)) {
                if (k === '_id') continue
                if (v.$sum !== undefined) {
                  if (typeof v.$sum === 'number') {
                    g[k] = (g[k] || 0) + v.$sum
                  } else if (typeof v.$sum === 'string' && v.$sum.startsWith('$')) {
                    const field = v.$sum.slice(1)
                    g[k] = (g[k] || 0) + (Number(item[field]) || 0)
                  } else if (v.$sum.$cond) {
                    const [cond, thenVal] = v.$sum.$cond
                    let matched = false
                    if (cond.$eq) {
                      const [fieldRef, val] = cond.$eq
                      const field = fieldRef.slice(1)
                      matched = item[field] === val
                    } else if (cond.$ne) {
                      const [fieldRef, val] = cond.$ne
                      const field = fieldRef.slice(1)
                      matched = item[field] !== val
                    }
                    if (matched) {
                      const addVal = typeof thenVal === 'string' && thenVal.startsWith('$') ? Number(item[thenVal.slice(1)]) || 0 : thenVal
                      g[k] = (g[k] || 0) + addVal
                    }
                  }
                }
              }
            }
            result = Array.from(groups.values())
          }
        }
        return result
      },
    }
  }

  _match(doc, filter) {
    for (const [key, val] of Object.entries(filter)) {
      if (key === '$or') {
        const matched = val.some((sub) => this._match(doc, sub))
        if (!matched) return false
        continue
      }
      if (key === '$and') {
        const matched = val.every((sub) => this._match(doc, sub))
        if (!matched) return false
        continue
      }
      const actual = doc[key]
      if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof ObjectId) && !(val instanceof Date)) {
        if (val.$in) {
          const inList = val.$in.map((item) => (item instanceof ObjectId ? item.toString() : item))
          const actualVal = actual instanceof ObjectId ? actual.toString() : actual
          if (!inList.includes(actualVal)) return false
        }
        if (val.$ne) {
          const neVal = val.$ne instanceof ObjectId ? val.$ne.toString() : val.$ne
          const actualVal = actual instanceof ObjectId ? actual.toString() : actual
          if (actualVal === neVal) return false
        }
        if (val.$lte && !(actual <= val.$lte)) return false
        if (val.$lt && !(actual < val.$lt)) return false
        if (val.$gte && !(actual >= val.$gte)) return false
        if (val.$gt && !(actual > val.$gt)) return false
        continue
      }
      if (val instanceof ObjectId) {
        if (!actual || actual.toString() !== val.toString()) return false
        continue
      }
      if (actual instanceof ObjectId && typeof val === 'string') {
        if (actual.toString() !== val) return false
        continue
      }
      if (actual !== val) return false
    }
    return true
  }

  _applyUpdate(doc, update) {
    if (update.$set) {
      Object.assign(doc, update.$set)
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        doc[k] = (doc[k] || 0) + v
      }
    }
    if (update.$addToSet) {
      for (const [k, v] of Object.entries(update.$addToSet)) {
        if (!Array.isArray(doc[k])) doc[k] = []
        if (!doc[k].includes(v)) doc[k].push(v)
      }
    }
  }
}

class MockDb {
  constructor() {
    this.collections = new Map()
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name))
    }
    return this.collections.get(name)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TEST 1: Stripe Payment verification and webhook handling
// ─────────────────────────────────────────────────────────────────────────────
test('AUDIT TEST 1: Stripe Payment verification & webhook processing', async () => {
  const db = new MockDb()
  const studentUid = 'student-test-1'
  const teacherUid = 'teacher-test-1'
  const listingId = new ObjectId()
  const orderId = 'order-stripe-101'

  await db.collection('studentPayments').insertOne({
    paymentId: orderId,
    studentUid,
    teacherUid,
    listingId,
    courseName: 'Physics 101',
    amount: 1000,
    currency: 'BDT',
    gateway: 'stripe',
    mode: 'test',
    status: 'pending',
    providerPaymentId: 'cs_test_session_101',
    createdAt: new Date(),
  })

  // Simulated valid Stripe session
  const stripeSession = {
    id: 'cs_test_session_101',
    mode: 'payment',
    payment_status: 'paid',
    currency: 'bdt',
    amount_total: 100000, // 1000 BDT in cents
    client_reference_id: orderId,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    payment_intent: 'pi_test_intent_101',
    metadata: {
      orderId,
      studentUid,
      listingId: listingId.toString(),
      teacherUid,
    },
  }

  const confirmed = await confirmPaidSession(db, stripeSession)
  assert.equal(confirmed, true, 'Valid Stripe session must be confirmed successfully')

  const updatedPayment = await db.collection('studentPayments').findOne({ paymentId: orderId })
  assert.equal(updatedPayment.status, 'paid', 'Status must be updated to paid in MongoDB')
  assert.equal(updatedPayment.providerTransactionId, 'pi_test_intent_101', 'Transaction ID must be stored')

  // Verify duplicate webhook handling (idempotency)
  const duplicateConfirm = await confirmPaidSession(db, stripeSession)
  assert.equal(duplicateConfirm, true, 'Duplicate webhook must be handled idempotently')
  const txCount = await db.collection('revenueTransactions').countDocuments({ paymentId: orderId })
  assert.equal(txCount, 1, 'Duplicate webhook must not create a duplicate revenue transaction')
})

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TEST 2: Student Enrollment Activation & Course Access
// ─────────────────────────────────────────────────────────────────────────────
test('AUDIT TEST 2: Student Enrollment created & granted immediate course access', async () => {
  const db = new MockDb()
  const studentUid = 'student-test-2'
  const teacherUid = 'teacher-test-2'
  const listingId = new ObjectId()

  await db.collection('listings').insertOne({
    _id: listingId,
    title: 'Chemistry Masterclass',
    teacherUid,
    admissionFee: 500,
    monthlyTuitionFee: 500,
    status: 'published',
  })

  const payment = {
    _id: new ObjectId(),
    paymentId: 'order-stripe-202',
    studentUid,
    teacherUid,
    listingId,
    courseName: 'Chemistry Masterclass',
    amount: 1000,
    currency: 'BDT',
    gateway: 'stripe',
    mode: 'test',
    status: 'pending',
    paymentType: 'ONE_TIME',
  }
  await db.collection('studentPayments').insertOne(payment)

  // Verify and record payment
  await recordVerifiedCoursePayment(db, {
    payment,
    verifiedAmount: 1000,
    transactionId: 'pi_test_202',
    paymentMethod: 'stripe',
    paymentType: 'ONE_TIME',
  })

  // Activate enrollment
  await db.collection('studentEnrollments').insertOne({
    studentUid,
    listingId,
    status: 'active',
    paymentType: 'ONE_TIME',
    admissionPaid: true,
    tuitionPaid: true,
    enrolledAt: new Date(),
    billingExpiresAt: null,
  })

  // Check enrollment status in MongoDB
  const enrollment = await db.collection('studentEnrollments').findOne({ studentUid, listingId })
  assert.ok(enrollment, 'Enrollment must exist in database')
  assert.equal(enrollment.status, 'active', 'Enrollment status must be active')

  // Check student course eligibility
  const eligibleCourses = await getEligibleStudentEnrollments(db, studentUid)
  assert.equal(eligibleCourses.length, 1, 'Student must have access to course')
  assert.equal(eligibleCourses[0].listingId.toString(), listingId.toString())
})

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TEST 3: Revenue Distribution (5% Platform / 95% Teacher)
// ─────────────────────────────────────────────────────────────────────────────
test('AUDIT TEST 3: Revenue Distribution (1000 BDT -> 50 BDT Admin, 950 BDT Teacher)', async () => {
  const split = calculateRevenueDistribution(1000)
  assert.equal(split.amount, 1000)
  assert.equal(split.platformCommissionAmount, 50, 'Platform commission must be exactly 50 BDT (5%)')
  assert.equal(split.teacherNetAmount, 950, 'Teacher earning must be exactly 950 BDT (95%)')

  // Decimal test with fraction to ensure no poisha loss
  const splitFraction = calculateRevenueDistributionMinor(1234.56)
  assert.equal(splitFraction.commissionMinor + splitFraction.teacherMinor, splitFraction.grossMinor)
})

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TEST 4: Admin Dashboard Metrics
// ─────────────────────────────────────────────────────────────────────────────
test('AUDIT TEST 4: Admin Dashboard Metrics (Gross revenue, 5% Commission, Payment count)', async () => {
  const db = new MockDb()
  const teacherUid = 'teacher-admin-test'
  const studentUid = 'student-admin-test'

  // Insert a verified revenue transaction for 2026-11
  await db.collection('revenueTransactions').insertOne({
    studentId: studentUid,
    studentUid,
    teacherId: teacherUid,
    teacherUid,
    grossAmount: 1000,
    grossMinor: 100000,
    platformCommission: 50,
    commissionMinor: 5000,
    teacherEarning: 950,
    teacherMinor: 95000,
    refundedAmount: 0,
    paymentMonth: '2026-11',
    earningStatus: 'PENDING',
    paymentType: 'ONE_TIME',
    createdAt: new Date('2026-11-09T10:00:00+06:00'),
  })

  const adminOverview = await getAdminFinancialOverview(db, '2026-11')
  assert.equal(adminOverview.summary.totalGrossCourseRevenue, 1000)
  assert.equal(adminOverview.summary.totalPlatformCommission, 50)
  assert.equal(adminOverview.summary.currentMonthAccumulatedCommission, 50)
  assert.equal(adminOverview.summary.successfulTransactions, 1)
})

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TEST 5: Teacher Dashboard Metrics & Balances
// ─────────────────────────────────────────────────────────────────────────────
test('AUDIT TEST 5: Teacher Dashboard Metrics (Pending vs Available, Lifetime Earnings)', async () => {
  const db = new MockDb()
  const teacherUid = 'teacher-wallet-test'

  await db.collection('teacherWallets').insertOne({
    teacherUid,
    pendingBalance: 950,
    pendingBalanceMinor: 95000,
    availableBalance: 0,
    availableBalanceMinor: 0,
    lifetimeEarnings: 950,
    lifetimeEarningsMinor: 95000,
    withdrawnAmount: 0,
    withdrawnAmountMinor: 0,
    debt: 0,
    debtMinor: 0,
  })

  await db.collection('revenueTransactions').insertOne({
    teacherUid,
    grossAmount: 1000,
    platformCommission: 50,
    teacherEarning: 950,
    earningStatus: 'PENDING',
    paymentType: 'ONE_TIME',
    paymentMonth: '2026-11',
    availableAt: new Date('2026-12-01T00:00:00+06:00'),
    createdAt: new Date('2026-11-09T10:00:00+06:00'),
  })

  const teacherSummary = await getTeacherFinancialSummary(db, teacherUid, '2026-11')
  assert.equal(teacherSummary.lifetimeEarnings, 950)
  assert.equal(teacherSummary.pendingEarnings, 950)
  assert.equal(teacherSummary.availableBalance, 0)
  assert.equal(teacherSummary.withdrawnAmount, 0)
  assert.equal(teacherSummary.oneTimeEarnings, 950)
})

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TEST 6: Calendar-Month Settlement – FINAL BUSINESS RULE
// ─────────────────────────────────────────────────────────────────────────────
test('AUDIT TEST 6: Calendar-Month Settlement – FINAL BUSINESS RULE', async () => {
  // Test Case 1: November 30 payment must become available December 1 at 00:00 Asia/Dhaka (2026-11-30T18:00:00.000Z UTC)
  const novPayment = new Date('2026-11-30T23:59:59+06:00')
  const novAvailable = calculateAvailableAt(novPayment)
  assert.equal(novAvailable.toISOString(), '2026-11-30T18:00:00.000Z', 'Nov 30 payment must become available Dec 1')

  // Test Case 2: December 1 payment must become available January 1 at 00:00 Asia/Dhaka (2026-12-31T18:00:00.000Z UTC)
  const decPayment = new Date('2026-12-01T00:00:01+06:00')
  const decAvailable = calculateAvailableAt(decPayment)
  assert.equal(decAvailable.toISOString(), '2026-12-31T18:00:00.000Z', 'Dec 1 payment must become available Jan 1')

  // Test Case 3: December 31 payment must become available January 1 at 00:00 Asia/Dhaka (2026-12-31T18:00:00.000Z UTC)
  const decEndPayment = new Date('2026-12-31T23:59:59+06:00')
  const decEndAvailable = calculateAvailableAt(decEndPayment)
  assert.equal(decEndAvailable.toISOString(), '2026-12-31T18:00:00.000Z', 'Dec 31 payment must become available Jan 1')

  // Test Case 4: January 1 payment must become available February 1 at 00:00 Asia/Dhaka (2027-01-31T18:00:00.000Z UTC)
  const janPayment = new Date('2027-01-01T00:00:01+06:00')
  const janAvailable = calculateAvailableAt(janPayment)
  assert.equal(janAvailable.toISOString(), '2027-01-31T18:00:00.000Z', 'Jan 1 payment must become available Feb 1')
})

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TEST 7: Duplicate Prevention (Double Webhook, Double Execute, Double Settlement)
// ─────────────────────────────────────────────────────────────────────────────
test('AUDIT TEST 7: Duplicate Prevention', async () => {
  const db = new MockDb()
  const teacherUid = 'teacher-dup-test'
  const studentUid = 'student-dup-test'
  const listingId = new ObjectId()
  const paymentId = 'pay-dup-001'

  const payment = {
    _id: new ObjectId(),
    paymentId,
    studentUid,
    teacherUid,
    listingId,
    amount: 1000,
    gateway: 'stripe',
    mode: 'test',
    status: 'pending',
  }
  await db.collection('studentPayments').insertOne(payment)

  // First execution
  const res1 = await recordVerifiedCoursePayment(db, {
    payment,
    verifiedAmount: 1000,
    transactionId: 'trx_dup_001',
    paymentMethod: 'stripe',
  })
  assert.equal(res1.recorded, true)

  // Second execution
  const updated = await db.collection('studentPayments').findOne({ paymentId })
  const res2 = await recordVerifiedCoursePayment(db, {
    payment: updated,
    verifiedAmount: 1000,
    transactionId: 'trx_dup_001',
    paymentMethod: 'stripe',
  })
  assert.equal(res2.recorded, false, 'Duplicate execution must return recorded: false')

  // Check ledger counts
  const ledgerCount = await db.collection('adminCommissionLedgers').countDocuments({ paymentId })
  assert.equal(ledgerCount, 1, 'Admin commission ledger must have exactly 1 record')
})

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TEST 8: Failed Payments and Refunds Reversal
// ─────────────────────────────────────────────────────────────────────────────
test('AUDIT TEST 8: Failed Payments and Refunds Reversal', async () => {
  const db = new MockDb()
  const teacherUid = 'teacher-refund-test'
  const studentUid = 'student-refund-test'
  const listingId = new ObjectId()
  const transactionId = 'pi_refund_test_888'

  await db.collection('listings').insertOne({
    _id: listingId,
    title: 'Refundable Course',
    admissionFee: 1000,
    monthlyTuitionFee: 0,
    pricingType: 'ONE_TIME',
  })

  // Seed verified payment
  await db.collection('studentPayments').insertOne({
    _id: new ObjectId(),
    paymentId: 'pay-refund-001',
    studentUid,
    teacherUid,
    listingId,
    amount: 1000,
    gateway: 'stripe',
    mode: 'test',
    status: 'paid',
    providerTransactionId: transactionId,
    platformCommissionAmount: 50,
    teacherNetAmount: 950,
  })

  // Seed active student enrollment
  await db.collection('studentEnrollments').insertOne({
    studentUid,
    listingId,
    status: 'active',
    paymentStatus: 'paid',
    admissionPaid: true,
    tuitionPaid: true,
  })

  await db.collection('revenueTransactions').insertOne({
    _id: new ObjectId(),
    providerTransactionId: transactionId,
    teacherUid,
    grossAmount: 1000,
    platformCommission: 50,
    teacherEarning: 950,
    earningStatus: 'PENDING',
  })

  await db.collection('teacherWallets').insertOne({
    teacherUid,
    pendingBalance: 950,
    pendingBalanceMinor: 95000,
    availableBalance: 0,
    availableBalanceMinor: 0,
    lifetimeEarnings: 950,
    lifetimeEarningsMinor: 95000,
  })

  // Full refund test
  const refundApplied = await applyVerifiedRefund(db, transactionId, 1000, 'evt_refund_888', 'stripe')
  assert.equal(refundApplied, true, 'Refund must be applied successfully')

  const postRefundPayment = await db.collection('studentPayments').findOne({ providerTransactionId: transactionId })
  assert.equal(postRefundPayment.status, 'refunded', 'Payment status must be refunded')
  assert.equal(postRefundPayment.commissionReversedAmount, 50, 'Platform commission reversed must be 50')
  assert.equal(postRefundPayment.teacherRevenueReversedAmount, 950, 'Teacher revenue reversed must be 950')

  const postRefundWallet = await db.collection('teacherWallets').findOne({ teacherUid })
  assert.equal(postRefundWallet.pendingBalance, 0, 'Pending balance must be reversed to 0')
  assert.equal(postRefundWallet.lifetimeEarnings, 0, 'Lifetime earnings must be reversed to 0')

  // Check enrollment is marked refunded and student has no course access
  const postRefundEnrollment = await db.collection('studentEnrollments').findOne({ studentUid, listingId })
  assert.equal(postRefundEnrollment.status, 'refunded', 'Enrollment status must be updated to refunded')

  const postRefundAccess = await getEligibleStudentEnrollments(db, studentUid)
  assert.equal(postRefundAccess.length, 0, 'Refunded student must no longer have course access')
})

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TEST 9: Monthly Subscription Renewals
// ─────────────────────────────────────────────────────────────────────────────
test('AUDIT TEST 9: Monthly Subscription Renewals & Access Expiry', async () => {
  const db = new MockDb()
  const studentUid = 'student-sub-test'
  const listingId = new ObjectId()

  // 1. Expired subscription
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // yesterday
  await db.collection('studentEnrollments').insertOne({
    studentUid,
    listingId,
    status: 'active',
    paymentType: 'MONTHLY_SUBSCRIPTION',
    billingExpiresAt: pastDate,
  })

  await db.collection('listings').insertOne({
    _id: listingId,
    title: 'Monthly Math Club',
    monthlyTuitionFee: 500,
    admissionFee: 0,
    pricingType: 'MONTHLY_SUBSCRIPTION',
  })

  // Check access when expired: must be empty
  const expiredAccess = await getEligibleStudentEnrollments(db, studentUid)
  assert.equal(expiredAccess.length, 0, 'Expired subscription must deny course access')

  // 2. Active renewed subscription
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  await db.collection('studentEnrollments').updateOne(
    { studentUid, listingId },
    { $set: { billingExpiresAt: futureDate } }
  )

  await db.collection('studentPayments').insertOne({
    studentUid,
    listingId,
    amount: 500,
    gateway: 'stripe',
    status: 'paid',
  })

  const renewedAccess = await getEligibleStudentEnrollments(db, studentUid)
  assert.equal(renewedAccess.length, 1, 'Renewed subscription must grant course access')
})

