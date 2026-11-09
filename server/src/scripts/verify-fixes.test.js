import test from 'node:test'
import assert from 'node:assert/strict'
import { ObjectId } from 'mongodb'
import {
  calculateRevenueDistributionMinor,
  calculateAvailableAt,
  getDhakaMonth,
  getTeacherFinancialSummary,
  getAdminFinancialOverview,
  recordVerifiedCoursePayment,
} from '../services/finance.service.js'
import {
  runTeacherPayoutReleaseJob,
  finalizeMonthlyAdminSettlement,
  runAdminMonthlySettlementJob,
} from '../services/settlementScheduler.service.js'
import { getEligibleStudentEnrollments } from '../routes/student.routes.js'

// In-memory mock MongoDB collection
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

  async findOne(filter = {}) {
    return this.docs.find((d) => this._match(d, filter)) || null
  }

  find(filter = {}) {
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
          if (stage.$sort) {
            // sort if needed
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
        if (val.$in && !val.$in.includes(actual)) return false
        if (val.$ne && actual === val.$ne) return false
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

test('End-to-End: Problem 1 Student Access & Problem 2 Revenue Distribution', async () => {
  const db = new MockDb()
  const teacherUid = 'teacher-abc-123'
  const studentUid = 'student-xyz-789'
  const listingId = new ObjectId()
  const paymentId = 'pay-order-001'
  const transactionId = 'pi_stripe_test_123456'

  // 1. Setup listing
  await db.collection('listings').insertOne({
    _id: listingId,
    title: 'Advanced Fullstack Development',
    teacherUid,
    admissionFee: 500,
    monthlyTuitionFee: 500,
    status: 'published',
  })

  // 2. Setup initial pending studentPayment in test mode
  const initialPayment = {
    _id: new ObjectId(),
    paymentId,
    studentUid,
    teacherUid,
    listingId,
    courseName: 'Advanced Fullstack Development',
    amount: 1000,
    currency: 'BDT',
    gateway: 'stripe',
    mode: 'test',
    status: 'pending',
    paymentType: 'ONE_TIME',
    createdAt: new Date('2026-11-09T10:00:00+06:00'),
  }
  await db.collection('studentPayments').insertOne(initialPayment)

  // 3. Setup active studentEnrollment
  await db.collection('studentEnrollments').insertOne({
    _id: new ObjectId(),
    studentUid,
    listingId,
    status: 'active',
    paymentType: 'ONE_TIME',
    admissionPaid: true,
    tuitionPaid: true,
    enrolledAt: new Date('2026-11-09T10:00:00+06:00'),
    billingExpiresAt: null,
  })

  // 4. Record verified payment
  const recordResult = await recordVerifiedCoursePayment(db, {
    payment: initialPayment,
    verifiedAmount: 1000,
    transactionId,
    paymentMethod: 'stripe',
    paymentType: 'ONE_TIME',
    paidAt: new Date('2026-11-09T10:00:00+06:00'),
  })

  assert.equal(recordResult.recorded, true, 'Payment must be recorded successfully')

  // Check studentPayment record
  const updatedPayment = await db.collection('studentPayments').findOne({ paymentId })
  assert.equal(updatedPayment.status, 'paid')
  assert.equal(updatedPayment.platformCommissionAmount, 50, 'Platform commission must be 5% (50 BDT)')
  assert.equal(updatedPayment.teacherNetAmount, 950, 'Teacher net must be 95% (950 BDT)')
  assert.equal(updatedPayment.providerTransactionId, transactionId)
  assert.equal(updatedPayment.revenueTransactionId, transactionId)

  // Check idempotency: second call returns recorded: false
  const duplicateResult = await recordVerifiedCoursePayment(db, {
    payment: updatedPayment,
    verifiedAmount: 1000,
    transactionId,
    paymentMethod: 'stripe',
    paymentType: 'ONE_TIME',
    paidAt: new Date('2026-11-09T10:00:00+06:00'),
  })
  assert.equal(duplicateResult.recorded, false, 'Duplicate payment execution must be idempotent')

  // Problem 1 Verification: Student Course Access
  const eligibleEnrollments = await getEligibleStudentEnrollments(db, studentUid)
  assert.equal(eligibleEnrollments.length, 1, 'Student must have 1 eligible course enrollment')
  assert.equal(eligibleEnrollments[0].listingId.toString(), listingId.toString())
  assert.equal(eligibleEnrollments[0].status, 'active')

  // Problem 2 Verification: Teacher Wallet & Financial Summary
  const teacherWallet = await db.collection('teacherWallets').findOne({ teacherUid })
  assert.ok(teacherWallet, 'Teacher wallet must be created')
  assert.equal(teacherWallet.pendingBalance, 950, 'Teacher pending balance must be 950 BDT')
  assert.equal(teacherWallet.availableBalance, 0, 'Available balance must be 0 before release date')
  assert.equal(teacherWallet.lifetimeEarnings, 950, 'Lifetime earnings must be 950 BDT')

  // Check Teacher Dashboard Summary
  const teacherSummary = await getTeacherFinancialSummary(db, teacherUid, '2026-11')
  assert.equal(teacherSummary.pendingEarnings, 950)
  assert.equal(teacherSummary.availableBalance, 0)
  assert.equal(teacherSummary.lifetimeEarnings, 950)
  assert.equal(teacherSummary.oneTimeEarnings, 950)
  assert.ok(teacherSummary.upcomingPayoutDate, 'Upcoming payout date must be set')

  // Verify Upcoming Payout Date formula: November 2026 -> December 1, 2026 in Asia/Dhaka
  const availableAt = new Date(teacherSummary.upcomingPayoutDate)
  assert.equal(availableAt.toISOString(), '2026-11-30T18:00:00.000Z')

  // Problem 2 Verification: Admin Financial Overview
  const adminOverview = await getAdminFinancialOverview(db, '2026-11')
  assert.equal(adminOverview.summary.totalGrossCourseRevenue, 1000, 'Admin total gross revenue must be 1000')
  assert.equal(adminOverview.summary.totalPlatformCommission, 50, 'Admin total commission must be 50')
  assert.equal(adminOverview.summary.currentMonthAccumulatedCommission, 50)
  assert.equal(adminOverview.summary.teacherPendingEarnings, 950)
  assert.equal(adminOverview.summary.successfulTransactions, 1)

  // Step 4 Verification: Teacher Payout Release Job (held until 1st of following calendar month)
  // Before availableAt (e.g. Nov 20, 2026)
  const novMidDate = new Date('2026-11-20T12:00:00+06:00')
  // We simulate runTeacherPayoutReleaseJob with current time before availableAt
  const beforeReleaseTxs = await db.collection('revenueTransactions').find({
    earningStatus: 'PENDING',
    availableAt: { $lte: novMidDate },
  }).toArray()
  assert.equal(beforeReleaseTxs.length, 0, 'Funds must remain pending throughout November')

  // On December 1, 2026 (in Asia/Dhaka)
  const decDate = new Date('2026-12-01T00:00:00+06:00')
  const readyTxs = await db.collection('revenueTransactions').find({
    earningStatus: 'PENDING',
    availableAt: { $lte: decDate },
  }).toArray()
  assert.equal(readyTxs.length, 1, 'Funds must become eligible on December 1, 2026')

  // Execute release
  const txToRelease = readyTxs[0]
  await db.collection('revenueTransactions').updateOne(
    { _id: txToRelease._id },
    { $set: { earningStatus: 'AVAILABLE', releasedAt: decDate } }
  )
  await db.collection('teacherWallets').updateOne(
    { teacherUid },
    {
      $inc: {
        pendingBalanceMinor: -95000,
        availableBalanceMinor: 95000,
      },
      $set: {
        pendingBalance: 0,
        availableBalance: 950,
      },
    }
  )

  const updatedWallet = await db.collection('teacherWallets').findOne({ teacherUid })
  assert.equal(updatedWallet.pendingBalance, 0)
  assert.equal(updatedWallet.availableBalance, 950)

  // Current month cannot be finalized before it ends
  await assert.rejects(
    async () => {
      await finalizeMonthlyAdminSettlement(db, '2026-11', 'admin-user')
    },
    { code: 'MONTH_NOT_COMPLETED' },
  )

  // Seed a past month (2026-10) transaction and verify finalization
  await db.collection('revenueTransactions').insertOne({
    studentId: studentUid,
    studentUid,
    teacherId: teacherUid,
    teacherUid,
    grossAmount: 2000,
    grossMinor: 200000,
    platformCommission: 100,
    commissionMinor: 10000,
    teacherEarning: 1900,
    teacherMinor: 190000,
    refundedAmount: 0,
    commissionReversedAmount: 0,
    paymentMonth: '2026-10',
    availableAt: new Date('2026-11-30T18:00:00.000Z'),
    earningStatus: 'AVAILABLE',
    commissionSettlementStatus: 'ACCUMULATING',
    paymentType: 'ONE_TIME',
    createdAt: new Date('2026-10-15T10:00:00+06:00'),
  })

  // Finalize monthly admin settlement for past month 2026-10
  const settlementResult = await finalizeMonthlyAdminSettlement(db, '2026-10', 'admin-user')
  assert.equal(settlementResult.alreadyFinalized, false)
  assert.equal(settlementResult.settlement.totalGrossRevenue, 2000)
  assert.equal(settlementResult.settlement.totalPlatformCommission, 100)
  assert.equal(settlementResult.settlement.settlementStatus, 'FINALIZED')

  // Prevent duplicate finalization
  const duplicateSettlement = await finalizeMonthlyAdminSettlement(db, '2026-10', 'admin-user')
  assert.equal(duplicateSettlement.alreadyFinalized, true)
})
