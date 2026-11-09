import { randomUUID } from 'node:crypto'
import { ObjectId } from 'mongodb'

export const DHAKA_TIMEZONE = 'Asia/Dhaka'
export const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000 // UTC+6

/**
 * Returns 'YYYY-MM' for a given date in Asia/Dhaka timezone.
 */
export function getDhakaMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DHAKA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date instanceof Date ? date : new Date(date))
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

/**
 * Returns { year, monthIndex } in Asia/Dhaka (monthIndex 0-11)
 */
export function getDhakaYearAndMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DHAKA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date instanceof Date ? date : new Date(date))
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  return { year, monthIndex: month - 1 }
}

/**
 * Returns the month range [start, end) in Asia/Dhaka for a YYYY-MM string.
 */
export function getDhakaMonthRange(monthValue) {
  const month = monthValue || getDhakaMonth()
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month)
  if (!match) {
    const error = new Error('Month must be in YYYY-MM format.')
    error.status = 400
    error.code = 'INVALID_MONTH'
    throw error
  }

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  return {
    month,
    start: new Date(Date.UTC(year, monthIndex, 1) - DHAKA_OFFSET_MS),
    end: new Date(Date.UTC(year, monthIndex + 1, 1) - DHAKA_OFFSET_MS),
  }
}

/**
 * Returns the previous month string 'YYYY-MM' in Asia/Dhaka.
 */
export function getPreviousDhakaMonth(monthValue) {
  const current = monthValue || getDhakaMonth()
  const [y, m] = current.split('-').map(Number)
  const prevDate = new Date(Date.UTC(y, m - 2, 1))
  return `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Calculate the exact timestamp when a teacher's earnings become available for withdrawal.
 * Final TeachOS Settlement Policy:
 * Teacher earnings remain pending until the END of the calendar month of payment in Asia/Dhaka timezone.
 * They become available on the FIRST DAY of the immediately following calendar month at 00:00:00 Asia/Dhaka.
 *
 * Examples:
 *   November 2026 earnings -> December 1, 2026 00:00:00 +06:00 (2026-11-30T18:00:00.000Z UTC)
 *   December 2026 earnings -> January 1, 2027 00:00:00 +06:00 (2026-12-31T18:00:00.000Z UTC)
 *   January 2027 earnings  -> February 1, 2027 00:00:00 +06:00 (2027-01-31T18:00:00.000Z UTC)
 *   February 2027 earnings -> March 1, 2027 00:00:00 +06:00 (2027-02-28T18:00:00.000Z UTC)
 *
 * Formula:
 * availableAt = Start of the next calendar month after payment month in Asia/Dhaka timezone.
 */
export function calculateAvailableAt(paymentDate) {
  const date = paymentDate instanceof Date ? paymentDate : new Date(paymentDate)
  const { year, monthIndex } = getDhakaYearAndMonth(date)

  // First day of the immediately following calendar month (monthIndex + 1) at 00:00:00 Asia/Dhaka:
  const targetUtcMs = Date.UTC(year, monthIndex + 1, 1) - DHAKA_OFFSET_MS
  return new Date(targetUtcMs)
}

export function toMinorUnits(amount) {
  return Math.round(Number(amount) * 100)
}

export function toMajorUnits(minor) {
  return Math.round(minor) / 100
}

export function platformShare(amount) {
  return calculateRevenueDistribution(amount).platformCommissionAmount
}

/**
 * Revenue Sharing:
 * For every independently verified successful payment:
 * - 5% Platform Commission belongs to TeachOS.
 * - 95% Teacher Earnings belongs to the course instructor.
 * Calculated in integer minor currency units (poisha).
 * Teacher earning = grossMinor - commissionMinor, ensuring sum always equals gross.
 */
export function calculateRevenueDistribution(amount) {
  const grossMinor = toMinorUnits(amount)
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0) {
    throw new TypeError('Verified payment amount must be a non-negative monetary amount.')
  }
  const commissionMinor = Math.round(grossMinor * 0.05)
  const teacherMinor = grossMinor - commissionMinor

  return {
    amount: toMajorUnits(grossMinor),
    platformCommissionAmount: toMajorUnits(commissionMinor),
    teacherNetAmount: toMajorUnits(teacherMinor),
    commissionRate: 0.05,
  }
}

export function calculateRevenueDistributionMinor(amount) {
  const grossMinor = toMinorUnits(amount)
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0) {
    throw new TypeError('Verified payment amount must be a non-negative monetary amount.')
  }
  const commissionMinor = Math.round(grossMinor * 0.05)
  const teacherMinor = grossMinor - commissionMinor

  return {
    amount: toMajorUnits(grossMinor),
    platformCommissionAmount: toMajorUnits(commissionMinor),
    teacherNetAmount: toMajorUnits(teacherMinor),
    grossMinor,
    commissionMinor,
    teacherMinor,
    commissionRate: 0.05,
  }
}

/**
 * Helper to get or create a teacher's wallet in `teacherWallets`.
 */
export async function getOrCreateTeacherWallet(database, teacherUid) {
  const wallets = database.collection('teacherWallets')
  if (typeof wallets?.findOne !== 'function') {
    return {
      teacherUid,
      pendingBalance: 0,
      availableBalance: 0,
      withdrawnAmount: 0,
      lockedInWithdrawal: 0,
      debt: 0,
      lifetimeEarnings: 0,
      pendingBalanceMinor: 0,
      availableBalanceMinor: 0,
      withdrawnAmountMinor: 0,
      debtMinor: 0,
    }
  }
  const existing = await wallets.findOne({ teacherUid })
  if (existing) {
    return {
      ...existing,
      pendingBalance: toMajorUnits(existing.pendingBalanceMinor ?? toMinorUnits(existing.pendingBalance || 0)),
      availableBalance: toMajorUnits(existing.availableBalanceMinor ?? toMinorUnits(existing.availableBalance || 0)),
      withdrawnAmount: toMajorUnits(existing.withdrawnAmountMinor ?? toMinorUnits(existing.withdrawnAmount || 0)),
      lockedInWithdrawal: toMajorUnits(existing.lockedInWithdrawalMinor ?? 0),
      debt: toMajorUnits(existing.debtMinor ?? 0),
      lifetimeEarnings: toMajorUnits(existing.lifetimeEarningsMinor ?? toMinorUnits(existing.lifetimeEarnings || 0)),
    }
  }

  const now = new Date()
  const initial = {
    teacherUid,
    pendingBalanceMinor: 0,
    pendingBalance: 0,
    availableBalanceMinor: 0,
    availableBalance: 0,
    withdrawnAmountMinor: 0,
    withdrawnAmount: 0,
    lockedInWithdrawalMinor: 0,
    lockedInWithdrawal: 0,
    debtMinor: 0,
    debt: 0,
    lifetimeEarningsMinor: 0,
    lifetimeEarnings: 0,
    oneTimeEarnings: 0,
    subscriptionEarnings: 0,
    createdAt: now,
    updatedAt: now,
  }
  if (typeof wallets.updateOne === 'function') {
    await wallets.updateOne(
      { teacherUid },
      { $setOnInsert: initial },
      { upsert: true },
    )
    return (await wallets.findOne({ teacherUid })) || initial
  }
  return initial
}

/**
 * Writes an entry into the appropriate ledger collection.
 */
export async function writeLedgerEntry(database, ledgerName, entry) {
  const collection = database.collection(ledgerName)
  const record = {
    id: randomUUID(),
    createdAt: new Date(),
    ...entry,
  }
  if (typeof collection?.insertOne === 'function') {
    await collection.insertOne(record)
  }
  return record
}

/**
 * Record an independently verified course payment (Stripe or bKash).
 * Generates RevenueTransaction, updates TeacherWallet, AdminCommissionLedger,
 * TeacherPendingLedger, PlatformRevenue, and studentPayments.
 */
export async function recordVerifiedCoursePayment(database, {
  payment,
  verifiedAmount,
  transactionId,
  paymentMethod,
  paidAt = new Date(),
  paymentType,
}) {
  const amountCents = toMinorUnits(verifiedAmount)
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 ||
      amountCents !== toMinorUnits(payment.amount) ||
      !['stripe', 'bkash'].includes(paymentMethod) ||
      !transactionId || typeof transactionId !== 'string') {
    const error = new Error('Verified transaction details do not match the stored course payment.')
    error.code = 'PAYMENT_VERIFICATION_MISMATCH'
    throw error
  }

  const effectivePaidAt = paidAt instanceof Date ? paidAt : new Date(paidAt)
  const distribution = calculateRevenueDistributionMinor(verifiedAmount)

  const normalizedPaymentType = (paymentType === 'MONTHLY_SUBSCRIPTION' || paymentType === 'monthly' || payment.paymentType === 'monthly' || payment.paymentType === 'MONTHLY_SUBSCRIPTION')
    ? 'MONTHLY_SUBSCRIPTION'
    : (paymentType === 'ONE_TIME' || payment.paymentType === 'ONE_TIME' || (!payment.monthlyTuitionFee && !paymentType))
      ? 'ONE_TIME'
      : (payment.monthlyTuitionFee && Number(payment.monthlyTuitionFee) > 0)
        ? 'MONTHLY_SUBSCRIPTION'
        : 'ONE_TIME'

  const paymentMonth = getDhakaMonth(effectivePaidAt)
  const availableAt = calculateAvailableAt(effectivePaidAt)
  const now = new Date()

  // Check if revenueTransaction already exists for this paymentId or transactionId
  const revenueTransactions = database.collection('revenueTransactions')
  const existingTx = typeof revenueTransactions?.findOne === 'function'
    ? await revenueTransactions.findOne({
      $or: [
        { paymentId: payment.paymentId },
        { providerTransactionId: transactionId },
      ],
    })
    : null

  if (existingTx) {
    return { payment: { ...payment, status: 'paid', paidAt: existingTx.createdAt }, recorded: false }
  }

  // Update studentPayments status atomically
  const result = await database.collection('studentPayments').updateOne(
    { _id: payment._id, status: 'pending', gateway: paymentMethod },
    {
      $set: {
        amount: distribution.amount,
        status: 'paid',
        isVerified: true,
        admissionPaid: true,
        tuitionPaid: true,
        paymentMethod,
        providerTransactionId: transactionId,
        revenueTransactionId: transactionId,
        platformCommissionAmount: distribution.platformCommissionAmount,
        teacherNetAmount: distribution.teacherNetAmount,
        commissionRate: distribution.commissionRate,
        paymentType: normalizedPaymentType,
        paymentMonth,
        availableAt,
        paidAt: effectivePaidAt,
        updatedAt: now,
      },
    },
  )

  if (!result.modifiedCount) {
    const current = await database.collection('studentPayments').findOne({ _id: payment._id })
    if (current?.status === 'paid' && current.providerTransactionId === transactionId) {
      return { payment: current, recorded: false }
    }
    const error = new Error('Payment could not be recorded because its state has changed.')
    error.code = 'PAYMENT_STATE_CONFLICT'
    throw error
  }

  // Insert RevenueTransaction
  const revenueTx = {
    studentId: payment.studentUid,
    studentUid: payment.studentUid,
    studentName: payment.studentName || '',
    studentEmail: payment.studentEmail || '',
    teacherId: payment.teacherUid,
    teacherUid: payment.teacherUid,
    teacherName: payment.teacherName || '',
    courseId: payment.listingId,
    listingId: payment.listingId,
    courseName: payment.courseName || '',
    paymentId: payment.paymentId,
    paymentReference: transactionId,
    providerTransactionId: transactionId,
    paymentType: normalizedPaymentType,
    paymentMethod,
    gateway: paymentMethod,
    mode: payment.mode || 'live',
    currency: 'BDT',
    grossAmount: distribution.amount,
    grossMinor: distribution.grossMinor,
    platformCommission: distribution.platformCommissionAmount,
    commissionMinor: distribution.commissionMinor,
    teacherEarning: distribution.teacherNetAmount,
    teacherMinor: distribution.teacherMinor,
    refundedAmount: 0,
    refundedAmountMinor: 0,
    commissionReversedAmount: 0,
    teacherRevenueReversedAmount: 0,
    paymentMonth,
    availableAt,
    earningStatus: 'PENDING',
    commissionSettlementStatus: 'ACCUMULATING',
    refundStatus: 'NONE',
    createdAt: effectivePaidAt,
    releasedAt: null,
    updatedAt: now,
  }

  if (typeof revenueTransactions?.insertOne === 'function') {
    try {
      await revenueTransactions.insertOne(revenueTx)
    } catch (err) {
      if (err.code === 11000) {
        return { payment: { ...payment, status: 'paid' }, recorded: false }
      }
      throw err
    }
  }

  // 1. Update Teacher Wallet: add 95% share to Pending Balance
  const wallets = database.collection('teacherWallets')
  if (typeof wallets?.updateOne === 'function') {
    const walletUpdate = {
      $inc: {
        pendingBalanceMinor: distribution.teacherMinor,
        lifetimeEarningsMinor: distribution.teacherMinor,
        ...(normalizedPaymentType === 'ONE_TIME'
          ? { oneTimeEarnings: distribution.teacherNetAmount }
          : { subscriptionEarnings: distribution.teacherNetAmount }),
      },
      $set: { updatedAt: now },
      $setOnInsert: {
        teacherUid: payment.teacherUid,
        availableBalanceMinor: 0,
        withdrawnAmountMinor: 0,
        lockedInWithdrawalMinor: 0,
        debtMinor: 0,
        createdAt: now,
      },
    }
    await wallets.updateOne({ teacherUid: payment.teacherUid }, walletUpdate, { upsert: true })

    if (typeof wallets.findOne === 'function') {
      const wallet = await wallets.findOne({ teacherUid: payment.teacherUid })
      if (wallet) {
        await wallets.updateOne(
          { _id: wallet._id },
          {
            $set: {
              pendingBalance: toMajorUnits(wallet.pendingBalanceMinor || 0),
              availableBalance: toMajorUnits(wallet.availableBalanceMinor || 0),
              withdrawnAmount: toMajorUnits(wallet.withdrawnAmountMinor || 0),
              lifetimeEarnings: toMajorUnits(wallet.lifetimeEarningsMinor || 0),
            },
          },
        )
      }
    }
  }

  // 2. Teacher Pending Ledger Entry
  await writeLedgerEntry(database, 'teacherPendingLedgers', {
    teacherUid: payment.teacherUid,
    revenueTransactionId: transactionId,
    paymentId: payment.paymentId,
    direction: 'CREDIT',
    amount: distribution.teacherNetAmount,
    amountMinor: distribution.teacherMinor,
    paymentMonth,
    availableAt,
    description: `Pending earnings from ${payment.courseName || 'course'} payment`,
  })

  // 3. Admin Commission Ledger Entry
  await writeLedgerEntry(database, 'adminCommissionLedgers', {
    revenueTransactionId: transactionId,
    paymentId: payment.paymentId,
    teacherUid: payment.teacherUid,
    direction: 'CREDIT',
    amount: distribution.platformCommissionAmount,
    amountMinor: distribution.commissionMinor,
    paymentMonth,
    description: `5% platform commission from ${payment.courseName || 'course'} payment`,
  })

  // 4. Platform Revenue accumulator
  const platformRevenues = database.collection('platformRevenues')
  if (typeof platformRevenues?.updateOne === 'function') {
    await platformRevenues.updateOne(
      { key: 'global' },
      {
        $inc: {
          totalGrossRevenue: distribution.amount,
          totalGrossRevenueMinor: distribution.grossMinor,
          totalPlatformCommission: distribution.platformCommissionAmount,
          totalPlatformCommissionMinor: distribution.commissionMinor,
          totalSuccessfulPayments: 1,
          ...(normalizedPaymentType === 'ONE_TIME'
            ? { oneTimeRevenue: distribution.amount }
            : { subscriptionRevenue: distribution.amount }),
        },
        $set: { updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    )
  }

  return {
    payment: {
      ...payment,
      ...distribution,
      status: 'paid',
      providerTransactionId: transactionId,
      paidAt: effectivePaidAt,
      paymentType: normalizedPaymentType,
      paymentMonth,
      availableAt,
    },
    recorded: true,
  }
}

/**
 * Handle partial and full refunds proportionally.
 * Follows the defined financial reversal policy:
 * - Pending teacher earnings: reverse corresponding pending amount.
 * - Available teacher earnings: reverse available funds where possible.
 * - Already withdrawn earnings: record recoverable debt / adjustment.
 * - Admin commission: reverse proportional commission in accounting records.
 */
export async function applyVerifiedRefund(
  database,
  transactionId,
  cumulativeRefundAmount,
  refundEventId,
  gateway = 'stripe',
) {
  if (typeof transactionId !== 'string' || !transactionId) return false
  const revenueTransactions = database.collection('revenueTransactions')
  const studentPayments = database.collection('studentPayments')

  // Find payment and revenue transaction
  const [payment, tx] = await Promise.all([
    studentPayments.findOne({
      gateway,
      providerTransactionId: transactionId,
      status: { $in: ['paid', 'refunded'] },
    }),
    revenueTransactions.findOne({
      providerTransactionId: transactionId,
    }),
  ])

  if (!payment || !Number.isFinite(Number(cumulativeRefundAmount))) return false

  const originalCents = toMinorUnits(payment.amount)
  const refundCents = toMinorUnits(cumulativeRefundAmount)
  if (refundCents < 0 || refundCents > originalCents) {
    const error = new Error('The recorded refund amount is outside the original payment amount.')
    error.code = 'INVALID_REFUND_AMOUNT'
    throw error
  }

  const currentRefundCents = Number(payment.refundedAmountCents) || 0
  if (refundCents <= currentRefundCents || payment.refundEventIds?.includes(refundEventId)) {
    return false
  }

  const deltaRefundCents = refundCents - currentRefundCents
  const deltaCommissionCents = Math.round(deltaRefundCents * 0.05)
  const deltaTeacherCents = deltaRefundCents - deltaCommissionCents

  const totalRefundedSplit = calculateRevenueDistributionMinor(refundCents / 100)
  const commissionReversedCents = Math.min(
    toMinorUnits(payment.platformCommissionAmount || 0),
    totalRefundedSplit.commissionMinor,
  )
  const teacherRevenueReversedCents = Math.min(
    toMinorUnits(payment.teacherNetAmount || 0),
    refundCents - commissionReversedCents,
  )

  const isFullRefund = refundCents === originalCents
  const now = new Date()

  // Update studentPayments
  await studentPayments.updateOne(
    { _id: payment._id },
    {
      $set: {
        refundedAmountCents: refundCents,
        refundedAmount: toMajorUnits(refundCents),
        commissionReversedAmount: toMajorUnits(commissionReversedCents),
        teacherRevenueReversedAmount: toMajorUnits(teacherRevenueReversedCents),
        status: isFullRefund ? 'refunded' : 'paid',
        refundedAt: now,
        updatedAt: now,
      },
      ...(refundEventId ? { $addToSet: { refundEventIds: refundEventId } } : {}),
    },
  )

  // On full refund, immediately revoke course access in studentEnrollments
  if (isFullRefund && payment.studentUid && payment.listingId) {
    const enrollments = database.collection('studentEnrollments')
    if (typeof enrollments?.updateMany === 'function') {
      await enrollments.updateMany(
        { studentUid: payment.studentUid, listingId: payment.listingId },
        {
          $set: {
            status: 'refunded',
            paymentStatus: 'refunded',
            admissionPaid: false,
            tuitionPaid: false,
            refundedAt: now,
            updatedAt: now,
          },
        },
      )
    }
  }

  // Update RevenueTransaction and Teacher Wallet
  if (tx) {
    const earningStatus = tx.earningStatus
    const wallets = database.collection('teacherWallets')
    const wallet = await getOrCreateTeacherWallet(database, tx.teacherUid)

    if (earningStatus === 'PENDING') {
      // Pending teacher earnings: reverse the pending amount
      await wallets.updateOne(
        { teacherUid: tx.teacherUid },
        {
          $inc: {
            pendingBalanceMinor: -deltaTeacherCents,
            lifetimeEarningsMinor: -deltaTeacherCents,
          },
          $set: { updatedAt: now },
        },
      )
      await writeLedgerEntry(database, 'teacherPendingLedgers', {
        teacherUid: tx.teacherUid,
        revenueTransactionId: transactionId,
        entryType: 'REFUND_REVERSAL',
        direction: 'DEBIT',
        amount: toMajorUnits(deltaTeacherCents),
        amountMinor: deltaTeacherCents,
        refundEventId,
        description: `Reversal of pending earnings due to refund`,
      })
    } else if (earningStatus === 'AVAILABLE') {
      // Available teacher earnings: reverse available funds where possible
      const currentAvailable = wallet.availableBalanceMinor || 0
      if (currentAvailable >= deltaTeacherCents) {
        await wallets.updateOne(
          { teacherUid: tx.teacherUid },
          {
            $inc: {
              availableBalanceMinor: -deltaTeacherCents,
              lifetimeEarningsMinor: -deltaTeacherCents,
            },
            $set: { updatedAt: now },
          },
        )
      } else {
        // Already withdrawn earnings: deduct available down to 0, record shortfall in debt
        const covered = Math.max(0, currentAvailable)
        const shortfall = deltaTeacherCents - covered
        await wallets.updateOne(
          { teacherUid: tx.teacherUid },
          {
            $inc: {
              availableBalanceMinor: -covered,
              debtMinor: shortfall,
              lifetimeEarningsMinor: -deltaTeacherCents,
            },
            $set: { updatedAt: now },
          },
        )
      }
      await writeLedgerEntry(database, 'teacherAvailableLedgers', {
        teacherUid: tx.teacherUid,
        revenueTransactionId: transactionId,
        entryType: 'REFUND_REVERSAL',
        direction: 'DEBIT',
        amount: toMajorUnits(deltaTeacherCents),
        amountMinor: deltaTeacherCents,
        refundEventId,
        description: `Reversal of available earnings due to refund`,
      })
    }

    // Refresh decimal wallet balances
    const updatedWallet = await wallets.findOne({ teacherUid: tx.teacherUid })
    if (updatedWallet) {
      await wallets.updateOne(
        { _id: updatedWallet._id },
        {
          $set: {
            pendingBalance: toMajorUnits(updatedWallet.pendingBalanceMinor || 0),
            availableBalance: toMajorUnits(updatedWallet.availableBalanceMinor || 0),
            debt: toMajorUnits(updatedWallet.debtMinor || 0),
            lifetimeEarnings: toMajorUnits(updatedWallet.lifetimeEarningsMinor || 0),
          },
        },
      )
    }

    // Update RevenueTransaction
    await revenueTransactions.updateOne(
      { _id: tx._id },
      {
        $set: {
          refundedAmount: toMajorUnits(refundCents),
          refundedAmountMinor: refundCents,
          commissionReversedAmount: toMajorUnits(commissionReversedCents),
          teacherRevenueReversedAmount: toMajorUnits(teacherRevenueReversedCents),
          refundStatus: isFullRefund ? 'FULL' : 'PARTIAL',
          earningStatus: isFullRefund ? 'REVERSED' : tx.earningStatus,
          updatedAt: now,
        },
      },
    )

    // Admin Commission Ledger Reversal
    await writeLedgerEntry(database, 'adminCommissionLedgers', {
      revenueTransactionId: transactionId,
      teacherUid: tx.teacherUid,
      entryType: 'REFUND_REVERSAL',
      direction: 'DEBIT',
      amount: toMajorUnits(deltaCommissionCents),
      amountMinor: deltaCommissionCents,
      refundEventId,
      description: `Reversal of 5% platform commission due to refund`,
    })

    // Update Platform Revenue totals
    await database.collection('platformRevenues').updateOne(
      { key: 'global' },
      {
        $inc: {
          totalRefundedGross: toMajorUnits(deltaRefundCents),
          totalRefundedCommission: toMajorUnits(deltaCommissionCents),
        },
        $set: { updatedAt: now },
      },
    )
  }

  return true
}

/**
 * Teacher requests a withdrawal from their available balance.
 * Uses atomic balance check and decrement on `availableBalanceMinor` to prevent
 * concurrent overdrawing.
 */
export async function requestTeacherWithdrawal(database, {
  teacherUid,
  amount,
  method,
  accountLast4 = '',
}) {
  const amountMinor = toMinorUnits(amount)
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    const error = new Error('Withdrawal amount must be greater than zero.')
    error.status = 400
    error.code = 'INVALID_WITHDRAWAL_AMOUNT'
    throw error
  }

  const wallets = database.collection('teacherWallets')
  const wallet = await getOrCreateTeacherWallet(database, teacherUid)

  // Concurrency check: must have enough available balance
  const result = await wallets.updateOne(
    {
      teacherUid,
      availableBalanceMinor: { $gte: amountMinor },
    },
    {
      $inc: {
        availableBalanceMinor: -amountMinor,
        lockedInWithdrawalMinor: amountMinor,
      },
      $set: { updatedAt: new Date() },
    },
  )

  if (!result.modifiedCount) {
    const error = new Error(`Withdrawal amount exceeds your available balance (Available: ৳${wallet.availableBalance.toFixed(2)}).`)
    error.status = 400
    error.code = 'PAYOUT_EXCEEDS_BALANCE'
    throw error
  }

  // Update decimal representation
  const freshWallet = await wallets.findOne({ teacherUid })
  await wallets.updateOne(
    { _id: freshWallet._id },
    {
      $set: {
        availableBalance: toMajorUnits(freshWallet.availableBalanceMinor || 0),
        lockedInWithdrawal: toMajorUnits(freshWallet.lockedInWithdrawalMinor || 0),
      },
    },
  )

  const id = randomUUID()
  const now = new Date()
  const withdrawal = {
    id,
    uid: teacherUid,
    teacherUid,
    amount: toMajorUnits(amountMinor),
    amountMinor,
    currency: 'BDT',
    method,
    accountLast4: accountLast4 || '',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }

  await database.collection('payoutRequests').insertOne(withdrawal)

  await writeLedgerEntry(database, 'teacherAvailableLedgers', {
    teacherUid,
    withdrawalId: id,
    entryType: 'WITHDRAWAL_LOCK',
    direction: 'DEBIT',
    amount: withdrawal.amount,
    amountMinor,
    description: `Locked for withdrawal request ${id}`,
  })

  return withdrawal
}

/**
 * Admin settles or rejects a teacher's withdrawal request.
 */
export async function settleTeacherWithdrawal(database, {
  withdrawalId,
  status,
  externalReference = '',
  reviewNote = '',
  reviewedBy,
}) {
  const collection = database.collection('payoutRequests')
  const existing = await collection.findOne({
    $or: [{ id: withdrawalId }, { _id: ObjectId.isValid(withdrawalId) ? new ObjectId(withdrawalId) : null }],
    status: 'pending',
  })

  if (!existing) {
    const error = new Error('Pending withdrawal request not found.')
    error.status = 404
    error.code = 'PAYOUT_REQUEST_NOT_FOUND'
    throw error
  }

  const teacherUid = existing.uid || existing.teacherUid
  const amountMinor = existing.amountMinor || toMinorUnits(existing.amount)
  const now = new Date()
  const wallets = database.collection('teacherWallets')

  if (status === 'paid') {
    // Approved & settled externally:
    // Move from lockedInWithdrawalMinor to withdrawnAmountMinor
    await wallets.updateOne(
      { teacherUid },
      {
        $inc: {
          lockedInWithdrawalMinor: -amountMinor,
          withdrawnAmountMinor: amountMinor,
        },
        $set: { updatedAt: now },
      },
    )

    await writeLedgerEntry(database, 'teacherAvailableLedgers', {
      teacherUid,
      withdrawalId: existing.id,
      entryType: 'WITHDRAWAL_PAID',
      direction: 'DEBIT',
      amount: existing.amount,
      amountMinor,
      externalReference,
      description: `Settled withdrawal payment (Ref: ${externalReference})`,
    })
  } else if (status === 'rejected') {
    // Rejected:
    // Unlock and restore to availableBalanceMinor
    await wallets.updateOne(
      { teacherUid },
      {
        $inc: {
          lockedInWithdrawalMinor: -amountMinor,
          availableBalanceMinor: amountMinor,
        },
        $set: { updatedAt: now },
      },
    )

    await writeLedgerEntry(database, 'teacherAvailableLedgers', {
      teacherUid,
      withdrawalId: existing.id,
      entryType: 'WITHDRAWAL_REJECTED',
      direction: 'CREDIT',
      amount: existing.amount,
      amountMinor,
      description: `Restored rejected withdrawal back to available balance`,
    })
  }

  // Refresh decimal wallet balances
  const freshWallet = await wallets.findOne({ teacherUid })
  if (freshWallet) {
    await wallets.updateOne(
      { _id: freshWallet._id },
      {
        $set: {
          availableBalance: toMajorUnits(freshWallet.availableBalanceMinor || 0),
          lockedInWithdrawal: toMajorUnits(freshWallet.lockedInWithdrawalMinor || 0),
          withdrawnAmount: toMajorUnits(freshWallet.withdrawnAmountMinor || 0),
        },
      },
    )
  }

  const updateDoc = {
    status,
    reviewedAt: now,
    reviewedBy,
    updatedAt: now,
    ...(status === 'paid' ? {
      externalReference,
      settlementRecordedAt: now,
      settlementRecordedBy: reviewedBy,
    } : {}),
    ...(reviewNote ? { reviewNote } : {}),
  }

  const updated = await collection.findOneAndUpdate(
    { _id: existing._id },
    { $set: updateDoc },
    { returnDocument: 'after' },
  )

  return updated
}

/**
 * Returns Teacher Dashboard financial metrics matching section 6.
 */
export async function getTeacherFinancialSummary(database, teacherUid, monthValue) {
  const currentMonthStr = getDhakaMonth()
  const targetMonth = monthValue || currentMonthStr

  const [wallet, revenueTxs, courseBreakdownRows, payoutRequests, teacher] = await Promise.all([
    getOrCreateTeacherWallet(database, teacherUid),
    database.collection('revenueTransactions').find({
      teacherUid,
    }).sort({ createdAt: -1 }).toArray(),
    database.collection('revenueTransactions').aggregate([
      { $match: { teacherUid } },
      {
        $group: {
          _id: { courseId: '$courseId', courseName: '$courseName' },
          grossAmount: { $sum: '$grossAmount' },
          platformCommission: { $sum: '$platformCommission' },
          teacherEarning: { $sum: '$teacherEarning' },
          refundedAmount: { $sum: '$refundedAmount' },
          paymentCount: { $sum: 1 },
        },
      },
      { $sort: { grossAmount: -1 } },
    ]).toArray(),
    database.collection('payoutRequests').find({
      $or: [{ uid: teacherUid }, { teacherUid }],
      isSample: { $ne: true },
    }).sort({ createdAt: -1 }).limit(100).toArray(),
    database.collection('users').findOne({ uid: teacherUid }, { projection: { payoutSettings: 1 } }),
  ])

  // Find upcoming payout date: earliest availableAt among pending earnings
  const earliestPending = revenueTxs
    .filter((tx) => tx.earningStatus === 'PENDING')
    .sort((a, b) => new Date(a.availableAt) - new Date(b.availableAt))[0]

  const upcomingPayoutDate = earliestPending ? earliestPending.availableAt : null

  // Calculate One-Time vs Monthly Subscription earnings
  let oneTimeEarnings = 0
  let subscriptionEarnings = 0
  let pendingEarnings = 0
  for (const tx of revenueTxs) {
    const net = Math.max(0, (tx.teacherEarning || 0) - (tx.teacherRevenueReversedAmount || 0))
    if (tx.paymentType === 'ONE_TIME') {
      oneTimeEarnings += net
    } else {
      subscriptionEarnings += net
    }
    if (tx.earningStatus === 'PENDING') {
      pendingEarnings += net
    }
  }

  // Monthly breakdown history
  const monthlyMap = new Map()
  for (const tx of revenueTxs) {
    const m = tx.paymentMonth || getDhakaMonth(tx.createdAt)
    const current = monthlyMap.get(m) || {
      month: m,
      grossAmount: 0,
      commissionAmount: 0,
      netAmount: 0,
      refundedAmount: 0,
      paymentCount: 0,
    }
    current.grossAmount += tx.grossAmount || 0
    current.commissionAmount += Math.max(0, (tx.platformCommission || 0) - (tx.commissionReversedAmount || 0))
    current.netAmount += Math.max(0, (tx.teacherEarning || 0) - (tx.teacherRevenueReversedAmount || 0))
    current.refundedAmount += tx.refundedAmount || 0
    current.paymentCount += 1
    monthlyMap.set(m, current)
  }
  const monthlyHistory = [...monthlyMap.values()].sort((a, b) => b.month.localeCompare(a.month))

  const selectedMonthly = monthlyMap.get(targetMonth) || {
    month: targetMonth,
    grossAmount: 0,
    commissionAmount: 0,
    netAmount: 0,
    refundedAmount: 0,
    paymentCount: 0,
  }

  // Summary object
  return {
    month: targetMonth,
    timezone: DHAKA_TIMEZONE,
    currency: 'BDT',
    lifetimeEarnings: Math.round((wallet.lifetimeEarnings || (oneTimeEarnings + subscriptionEarnings)) * 100) / 100,
    pendingEarnings: Math.round(pendingEarnings * 100) / 100,
    availableBalance: Math.max(0, wallet.availableBalance || 0),
    withdrawnAmount: Math.round((wallet.withdrawnAmount || 0) * 100) / 100,
    lockedInWithdrawal: Math.round((wallet.lockedInWithdrawal || 0) * 100) / 100,
    debt: Math.round((wallet.debt || 0) * 100) / 100,
    oneTimeEarnings: Math.round(oneTimeEarnings * 100) / 100,
    subscriptionEarnings: Math.round(subscriptionEarnings * 100) / 100,
    upcomingPayoutDate,
    monthly: selectedMonthly,
    monthlyHistory,
    courseBreakdown: courseBreakdownRows.map((course) => ({
      listingId: course._id.courseId,
      courseName: course._id.courseName || 'Course payment',
      grossAmount: Math.round(course.grossAmount * 100) / 100,
      commissionAmount: Math.round(course.platformCommission * 100) / 100,
      netAmount: Math.round(course.teacherEarning * 100) / 100,
      refundedAmount: Math.round(course.refundedAmount * 100) / 100,
      paymentCount: course.paymentCount,
    })),
    withdrawalHistory: payoutRequests.map((req) => ({
      id: req.id,
      _id: req._id,
      amount: req.amount,
      method: req.method,
      accountLast4: req.accountLast4,
      status: req.status,
      externalReference: req.externalReference || null,
      payoutReference: req.externalReference || req.payoutReference || null,
      createdAt: req.createdAt,
      requestedAt: req.createdAt,
      settledAt: req.reviewedAt || req.settledAt || null,
      reviewedAt: req.reviewedAt || null,
    })),
    payments: revenueTxs.slice(0, 100).map((tx) => ({
      id: tx.paymentId,
      courseName: tx.courseName,
      studentName: tx.studentName,
      grossAmount: tx.grossAmount,
      commission: Math.max(0, (tx.platformCommission || 0) - (tx.commissionReversedAmount || 0)),
      netAmount: Math.max(0, (tx.teacherEarning || 0) - (tx.teacherRevenueReversedAmount || 0)),
      refundedAmount: tx.refundedAmount || 0,
      paymentType: tx.paymentType,
      paymentMethod: tx.paymentMethod,
      gateway: tx.gateway,
      earningStatus: tx.earningStatus,
      availableAt: tx.availableAt,
      releasedAt: tx.releasedAt,
      status: tx.refundStatus === 'FULL' ? 'refunded' : 'paid',
      createdAt: tx.createdAt,
    })),
    payoutRequests,
    payoutSettings: teacher?.payoutSettings || { enabled: false, monthlyAmount: 0, dayOfMonth: 1 },
    // Backwards-compatible aliases
    earnings: Math.round((wallet.lifetimeEarnings || (oneTimeEarnings + subscriptionEarnings)) * 100) / 100,
    grossSales: Math.round(revenueTxs.reduce((sum, t) => sum + (t.grossAmount || 0), 0) * 100) / 100,
    platformCommission: Math.round(revenueTxs.reduce((sum, t) => sum + Math.max(0, (t.platformCommission || 0) - (t.commissionReversedAmount || 0)), 0) * 100) / 100,
    teacherRevenue: Math.round((wallet.lifetimeEarnings || 0) * 100) / 100,
    available: Math.max(0, wallet.availableBalance || 0),
    successfulTransactions: revenueTxs.length,
  }
}

/**
 * Returns Admin Dashboard financial metrics matching section 7.
 * Supports filtering by:
 * - month ('YYYY-MM')
 * - teacher (teacherUid or name search)
 * - course (listingId or course name search)
 * - paymentType ('ONE_TIME' | 'MONTHLY_SUBSCRIPTION')
 * - paymentMethod ('stripe' | 'bkash')
 */
export async function getAdminFinancialOverview(database, monthValue, filters = {}) {
  const currentMonthStr = getDhakaMonth()
  const month = monthValue || currentMonthStr

  const revenueTransactions = database.collection('revenueTransactions')
  const monthlySettlements = database.collection('monthlyAdminSettlements')
  const payoutRequests = database.collection('payoutRequests')
  const wallets = database.collection('teacherWallets')

  // Build filter query for transactions
  const matchFilter = {}
  if (month && month !== 'all') {
    matchFilter.paymentMonth = month
  }
  if (filters.teacher) {
    matchFilter.$or = [
      { teacherUid: filters.teacher },
      { teacherName: { $regex: filters.teacher, $options: 'i' } },
    ]
  }
  if (filters.course) {
    matchFilter.$or = [
      { courseId: ObjectId.isValid(filters.course) ? new ObjectId(filters.course) : filters.course },
      { courseName: { $regex: filters.course, $options: 'i' } },
    ]
  }
  if (filters.paymentType && filters.paymentType !== 'all') {
    matchFilter.paymentType = filters.paymentType
  }
  if (filters.paymentMethod && filters.paymentMethod !== 'all') {
    matchFilter.paymentMethod = filters.paymentMethod
  }

  // 1. Transactions matching filter
  const [
    filteredTransactions,
    allLiveTransactions,
    allSettlements,
    allWallets,
    payoutTotals,
    allPayouts,
  ] = await Promise.all([
    revenueTransactions.find(matchFilter).sort({ createdAt: -1 }).limit(200).toArray(),
    revenueTransactions.find().toArray(),
    monthlySettlements.find().sort({ settlementMonth: -1 }).toArray(),
    wallets.find().toArray(),
    payoutRequests.aggregate([
      { $match: { isSample: { $ne: true } } },
      {
        $group: {
          _id: null,
          requested: { $sum: { $cond: [{ $ne: ['$status', 'rejected'] }, '$amount', 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] } },
          settled: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
        },
      },
    ]).toArray(),
    payoutRequests.find({ isSample: { $ne: true } }).sort({ createdAt: -1 }).limit(100).toArray(),
  ])

  // Overall Platform Totals (All Time)
  let totalGrossCourseRevenue = 0
  let totalPlatformCommission = 0
  let currentMonthAccumulatedCommission = 0
  let oneTimePurchaseRevenue = 0
  let monthlySubscriptionRevenue = 0
  let refundsAndChargebacks = 0
  let totalSuccessfulPayments = allLiveTransactions.length

  for (const tx of allLiveTransactions) {
    const gross = tx.grossAmount || 0
    const comm = Math.max(0, (tx.platformCommission || 0) - (tx.commissionReversedAmount || 0))
    const ref = tx.refundedAmount || 0

    totalGrossCourseRevenue += gross
    totalPlatformCommission += comm
    refundsAndChargebacks += ref

    if (tx.paymentType === 'ONE_TIME') {
      oneTimePurchaseRevenue += gross
    } else {
      monthlySubscriptionRevenue += gross
    }

    if (tx.paymentMonth === currentMonthStr) {
      currentMonthAccumulatedCommission += comm
    }
  }

  // Teacher pending and available aggregates from wallets
  let teacherPendingEarnings = 0
  let teacherAvailableEarnings = 0
  for (const w of allWallets) {
    teacherPendingEarnings += toMajorUnits(w.pendingBalanceMinor || 0)
    teacherAvailableEarnings += toMajorUnits(w.availableBalanceMinor || 0)
  }

  // Finalized Monthly Commission: sum of finalized settlements
  const finalizedMonthlyCommission = allSettlements
    .filter((s) => s.settlementStatus === 'FINALIZED')
    .reduce((sum, s) => sum + (s.totalPlatformCommission || 0), 0)

  // Monthly summary for selected month
  const monthTransactions = allLiveTransactions.filter((tx) => tx.paymentMonth === month)
  let monthGross = 0
  let monthCommission = 0
  let monthTeacherNet = 0
  let monthRefunds = 0
  const teachersMap = new Map()

  for (const tx of monthTransactions) {
    const gross = tx.grossAmount || 0
    const comm = Math.max(0, (tx.platformCommission || 0) - (tx.commissionReversedAmount || 0))
    const net = Math.max(0, (tx.teacherEarning || 0) - (tx.teacherRevenueReversedAmount || 0))
    const ref = tx.refundedAmount || 0

    monthGross += gross
    monthCommission += comm
    monthTeacherNet += net
    monthRefunds += ref

    const t = teachersMap.get(tx.teacherUid) || {
      teacherUid: tx.teacherUid,
      teacherName: tx.teacherName || 'TeachOS teacher',
      grossAmount: 0,
      commissionAmount: 0,
      netAmount: 0,
      paymentCount: 0,
    }
    t.grossAmount += gross
    t.commissionAmount += comm
    t.netAmount += net
    t.paymentCount += 1
    teachersMap.set(tx.teacherUid, t)
  }

  const round = (num) => Math.round(num * 100) / 100

  return {
    summary: {
      totalGrossCourseRevenue: round(totalGrossCourseRevenue),
      totalPlatformCommission: round(totalPlatformCommission),
      currentMonthAccumulatedCommission: round(currentMonthAccumulatedCommission),
      finalizedMonthlyCommission: round(finalizedMonthlyCommission),
      teacherPendingEarnings: round(teacherPendingEarnings),
      teacherAvailableEarnings: round(teacherAvailableEarnings),
      totalSuccessfulPayments,
      oneTimePurchaseRevenue: round(oneTimePurchaseRevenue),
      monthlySubscriptionRevenue: round(monthlySubscriptionRevenue),
      refundsAndChargebacks: round(refundsAndChargebacks),
      // Current selected month view
      month,
      monthlyGross: round(monthGross),
      recordedEarnings: round(monthCommission),
      teacherNet: round(monthTeacherNet),
      monthlyRefunds: round(monthRefunds),
      successfulTransactions: monthTransactions.length,
      requestedPayouts: payoutTotals[0]?.requested || 0,
      pendingPayouts: payoutTotals[0]?.pending || 0,
      settledPayouts: payoutTotals[0]?.settled || 0,
      teacherBreakdown: [...teachersMap.values()].map((t) => ({
        ...t,
        grossAmount: round(t.grossAmount),
        commissionAmount: round(t.commissionAmount),
        netAmount: round(t.netAmount),
      })),
    },
    monthlySettlementHistory: allSettlements.map((s) => ({
      settlementMonth: s.settlementMonth,
      totalGrossRevenue: s.totalGrossRevenue,
      totalPlatformCommission: s.totalPlatformCommission,
      transactionCount: s.transactionCount,
      oneTimeRevenue: s.oneTimeRevenue || 0,
      subscriptionRevenue: s.subscriptionRevenue || 0,
      refundedGross: s.refundedGross || 0,
      refundedCommission: s.refundedCommission || 0,
      settlementStatus: s.settlementStatus,
      finalizedAt: s.finalizedAt,
    })),
    payments: filteredTransactions.map((tx) => ({
      id: tx.paymentId,
      paymentId: tx.paymentId,
      person: tx.teacherName || 'Teacher',
      studentName: tx.studentName || 'Student',
      courseName: tx.courseName || 'Course',
      transactionType: 'Course payment',
      recordType: 'payment',
      amount: tx.grossAmount,
      grossAmount: tx.grossAmount,
      platformCommissionAmount: Math.max(0, (tx.platformCommission || 0) - (tx.commissionReversedAmount || 0)),
      teacherNetAmount: Math.max(0, (tx.teacherEarning || 0) - (tx.teacherRevenueReversedAmount || 0)),
      refundedAmount: tx.refundedAmount || 0,
      paymentType: tx.paymentType,
      paymentMethod: tx.paymentMethod || tx.gateway,
      gateway: tx.gateway,
      status: tx.refundStatus === 'FULL' ? 'refunded' : 'paid',
      earningStatus: tx.earningStatus,
      availableAt: tx.availableAt,
      commissionSettlementStatus: tx.commissionSettlementStatus,
      currency: 'BDT',
      createdAt: tx.createdAt,
    })),
    payouts: allPayouts.map((p) => ({
      ...p,
      person: p.teacherName || p.uid,
      recordType: 'payout',
      transactionType: 'Payout request',
    })),
  }
}

/**
 * Backwards-compatibility alias for platformRouter
 */
export async function getMonthlyCommission(database, monthValue) {
  const overview = await getAdminFinancialOverview(database, monthValue)
  return {
    month: overview.summary.month,
    timezone: DHAKA_TIMEZONE,
    currency: 'BDT',
    commissionRate: 0.05,
    grossAmount: overview.summary.monthlyGross,
    commissionAmount: overview.summary.recordedEarnings,
    teacherNetAmount: overview.summary.teacherNet,
    refundedAmount: overview.summary.monthlyRefunds,
    paymentCount: overview.summary.successfulTransactions,
    teachers: overview.summary.teacherBreakdown,
    transactions: overview.payments,
  }
}

/**
 * Backwards-compatibility alias for teacher payments
 */
export async function getTeacherPaymentSummary(database, teacherUid, monthValue) {
  return getTeacherFinancialSummary(database, teacherUid, monthValue)
}
