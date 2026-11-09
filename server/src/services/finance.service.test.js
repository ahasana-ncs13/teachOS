import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyVerifiedRefund,
  calculateRevenueDistribution,
  recordVerifiedCoursePayment,
} from './finance.service.js'

function paymentDatabase(payment) {
  return {
    collection() {
      return {
        async updateOne(filter, update) {
          if (payment._id !== filter._id || payment.status !== filter.status ||
              (filter.gateway && payment.gateway !== filter.gateway)) {
            return { modifiedCount: 0 }
          }
          Object.assign(payment, update.$set)
          return { modifiedCount: 1 }
        },
        async findOne(filter) {
          return payment._id === filter._id ? payment : null
        },
      }
    },
  }
}

test('splits verified BDT amounts in minor units and preserves the total', () => {
  assert.deepEqual(calculateRevenueDistribution(1000), {
    amount: 1000,
    platformCommissionAmount: 50,
    teacherNetAmount: 950,
    commissionRate: 0.05,
  })

  const rounded = calculateRevenueDistribution(0.11)
  assert.equal(rounded.platformCommissionAmount + rounded.teacherNetAmount, rounded.amount)
})

for (const paymentMethod of ['stripe', 'bkash']) {
  test(`records a verified live ${paymentMethod} transaction once`, async () => {
    const payment = { _id: 'payment-1', amount: 1000, gateway: paymentMethod, mode: 'live', status: 'pending' }
    const database = paymentDatabase(payment)
    const first = await recordVerifiedCoursePayment(database, {
      payment,
      verifiedAmount: 1000,
      transactionId: `${paymentMethod}-transaction-1`,
      paymentMethod,
    })
    const duplicate = await recordVerifiedCoursePayment(database, {
      payment,
      verifiedAmount: 1000,
      transactionId: `${paymentMethod}-transaction-1`,
      paymentMethod,
    })

    assert.equal(first.recorded, true)
    assert.equal(duplicate.recorded, false)
    assert.equal(payment.platformCommissionAmount, 50)
    assert.equal(payment.teacherNetAmount, 950)
    assert.equal(payment.revenueTransactionId, `${paymentMethod}-transaction-1`)
  })
}

test('failed or mismatched payments cannot receive a revenue split', async () => {
  const failedPayment = { _id: 'failed-payment', amount: 1000, gateway: 'stripe', status: 'failed' }
  await assert.rejects(
    async () => {
      await recordVerifiedCoursePayment(paymentDatabase(failedPayment), {
        payment: failedPayment,
        verifiedAmount: 1000,
        transactionId: 'stripe-test-transaction',
        paymentMethod: 'stripe',
      })
    },
    { code: 'PAYMENT_STATE_CONFLICT' },
  )

  const mismatchedPayment = { _id: 'mismatched-payment', amount: 1000, gateway: 'stripe', status: 'pending' }
  await assert.rejects(
    async () => {
      await recordVerifiedCoursePayment(paymentDatabase(mismatchedPayment), {
        payment: mismatchedPayment,
        verifiedAmount: 500, // mismatch
        transactionId: 'stripe-test-transaction',
        paymentMethod: 'stripe',
      })
    },
    { code: 'PAYMENT_VERIFICATION_MISMATCH' },
  )
})

test('verified payments in any environment mode receive the 5% platform and 95% teacher split', async () => {
  const payment = { _id: 'verified-test-payment', amount: 1000, gateway: 'stripe', mode: 'test', status: 'pending' }
  const result = await recordVerifiedCoursePayment(paymentDatabase(payment), {
    payment,
    verifiedAmount: 1000,
    transactionId: 'stripe-test-tx-999',
    paymentMethod: 'stripe',
  })
  assert.equal(result.recorded, true)
  assert.equal(payment.platformCommissionAmount, 50)
  assert.equal(payment.teacherNetAmount, 950)
  assert.equal(payment.revenueTransactionId, 'stripe-test-tx-999')
})

test('applies cumulative refunds once and reverses the complete split', async () => {
  const payment = {
    _id: 'refund-payment',
    amount: 1000,
    gateway: 'stripe',
    mode: 'live',
    status: 'paid',
    providerTransactionId: 'stripe-refund-transaction',
    platformCommissionAmount: 50,
    teacherNetAmount: 950,
    refundedAmountCents: 0,
  }
  const collection = {
    async findOne(filter) {
      return filter.providerTransactionId === payment.providerTransactionId ? payment : null
    },
    async updateOne(filter, update) {
      const expected = filter.refundedAmountCents
      if (expected?.$in && !expected.$in.includes(payment.refundedAmountCents ?? null)) return { modifiedCount: 0 }
      if (Number.isInteger(expected) && expected !== payment.refundedAmountCents) return { modifiedCount: 0 }
      Object.assign(payment, update.$set)
      return { modifiedCount: 1 }
    },
    async updateMany() {
      return { modifiedCount: 1 }
    },
  }
  const database = { collection: () => collection }

  assert.equal(await applyVerifiedRefund(database, 'stripe-refund-transaction', 400, 'evt_partial'), true)
  assert.equal(await applyVerifiedRefund(database, 'stripe-refund-transaction', 400, 'evt_partial'), false)
  assert.equal(await applyVerifiedRefund(database, 'stripe-refund-transaction', 1000, 'evt_full'), true)
  assert.equal(payment.status, 'refunded')
  assert.equal(payment.commissionReversedAmount, 50)
  assert.equal(payment.teacherRevenueReversedAmount, 950)
})

test('calculates availableAt for calendar-month teacher payouts in Asia/Dhaka', async () => {
  const { calculateAvailableAt, getDhakaMonth } = await import('./finance.service.js')

  // Example 1: November 2026 earnings become available December 1, 2026
  const novPayment = new Date('2026-11-09T11:14:08+06:00')
  assert.equal(getDhakaMonth(novPayment), '2026-11')
  const novAvailable = calculateAvailableAt(novPayment)
  // UTC ms for 2026-12-01 00:00:00 +06:00 is Date.UTC(2026, 11, 1) - 6 hrs = 2026-11-30T18:00:00.000Z
  assert.equal(novAvailable.toISOString(), '2026-11-30T18:00:00.000Z')

  // Example 2: December 2026 earnings become available January 1, 2027
  const decPayment = new Date('2026-12-15T23:59:59+06:00')
  assert.equal(getDhakaMonth(decPayment), '2026-12')
  const decAvailable = calculateAvailableAt(decPayment)
  assert.equal(decAvailable.toISOString(), '2026-12-31T18:00:00.000Z')

  // Example 3: January 2027 earnings become available February 1, 2027
  const janPayment = new Date('2027-01-01T00:00:01+06:00')
  assert.equal(getDhakaMonth(janPayment), '2027-01')
  const janAvailable = calculateAvailableAt(janPayment)
  assert.equal(janAvailable.toISOString(), '2027-01-31T18:00:00.000Z')

  // Example 4: February 2027 earnings become available March 1, 2027
  const febPayment = new Date('2027-02-10T12:00:00+06:00')
  assert.equal(getDhakaMonth(febPayment), '2027-02')
  const febAvailable = calculateAvailableAt(febPayment)
  assert.equal(febAvailable.toISOString(), '2027-02-28T18:00:00.000Z')
})

test('minor currency integer calculations prevent fraction loss', async () => {
  const { calculateRevenueDistributionMinor } = await import('./finance.service.js')

  const testAmounts = [1000, 500, 100, 49.99, 123.45, 1.01]
  for (const amt of testAmounts) {
    const res = calculateRevenueDistributionMinor(amt)
    assert.equal(res.commissionMinor + res.teacherMinor, res.grossMinor)
    assert.equal(Math.round((res.platformCommissionAmount + res.teacherNetAmount) * 100), Math.round(res.amount * 100))
  }
})

