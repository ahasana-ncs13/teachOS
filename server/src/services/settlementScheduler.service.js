import { writeAuditLog } from './audit.service.js'
import {
  getDhakaMonth,
  getDhakaMonthRange,
  getPreviousDhakaMonth,
  toMajorUnits,
  toMinorUnits,
  writeLedgerEntry,
} from './finance.service.js'

let schedulerInterval = null

/**
 * Release teacher pending earnings whose availableAt has arrived.
 * Atomic update guarantees each earning is released exactly once.
 */
export async function runTeacherPayoutReleaseJob(database) {
  const now = new Date()
  const revenueTransactions = database.collection('revenueTransactions')
  const wallets = database.collection('teacherWallets')

  // Find all pending earnings whose availableAt has been reached
  const eligibleTxs = await revenueTransactions.find({
    earningStatus: 'PENDING',
    availableAt: { $lte: now },
  }).toArray()

  let releasedCount = 0
  let totalReleasedAmount = 0

  for (const tx of eligibleTxs) {
    // Atomic transition from PENDING to AVAILABLE
    const result = await revenueTransactions.findOneAndUpdate(
      {
        _id: tx._id,
        earningStatus: 'PENDING',
      },
      {
        $set: {
          earningStatus: 'AVAILABLE',
          releasedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    )

    if (!result) continue // already released concurrently

    releasedCount += 1
    const teacherEarning = (result.teacherEarning || 0) - (result.teacherRevenueReversedAmount || 0)
    const teacherMinor = toMinorUnits(teacherEarning)
    totalReleasedAmount += teacherEarning

    // Move from pendingBalanceMinor to availableBalanceMinor in TeacherWallet
    await wallets.updateOne(
      { teacherUid: result.teacherUid },
      {
        $inc: {
          pendingBalanceMinor: -teacherMinor,
          availableBalanceMinor: teacherMinor,
        },
        $set: { updatedAt: now },
      },
    )

    // Check if teacher has outstanding debt (from a refund after funds were withdrawn)
    const wallet = await wallets.findOne({ teacherUid: result.teacherUid })
    if (wallet && (wallet.debtMinor || 0) > 0) {
      const debtToClear = Math.min(wallet.debtMinor, wallet.availableBalanceMinor)
      if (debtToClear > 0) {
        await wallets.updateOne(
          { _id: wallet._id },
          {
            $inc: {
              debtMinor: -debtToClear,
              availableBalanceMinor: -debtToClear,
            },
            $set: { updatedAt: now },
          },
        )
      }
    }

    // Refresh decimal wallet balances
    const freshWallet = await wallets.findOne({ teacherUid: result.teacherUid })
    if (freshWallet) {
      await wallets.updateOne(
        { _id: freshWallet._id },
        {
          $set: {
            pendingBalance: toMajorUnits(freshWallet.pendingBalanceMinor || 0),
            availableBalance: toMajorUnits(freshWallet.availableBalanceMinor || 0),
            debt: toMajorUnits(freshWallet.debtMinor || 0),
          },
        },
      )
    }

    // Ledger entry in TeacherAvailableLedger
    await writeLedgerEntry(database, 'teacherAvailableLedgers', {
      teacherUid: result.teacherUid,
      revenueTransactionId: result.providerTransactionId || result.paymentReference,
      paymentId: result.paymentId,
      entryType: 'TEACHER_AVAILABLE',
      direction: 'CREDIT',
      amount: toMajorUnits(teacherMinor),
      amountMinor: teacherMinor,
      releasedAt: now,
      description: `Earning released to available balance following holding period (Month: ${result.paymentMonth})`,
    })

    await writeAuditLog({
      actorUid: 'scheduler',
      actorRole: 'system',
      action: 'finance.teacher_earning_released',
      targetType: 'revenue_transaction',
      targetId: result.paymentId,
      meta: {
        teacherUid: result.teacherUid,
        amount: teacherEarning,
        paymentMonth: result.paymentMonth,
        availableAt: result.availableAt,
        releasedAt: now,
      },
    })
  }

  return { releasedCount, totalReleasedAmount }
}

/**
 * Finalize monthly admin platform commission settlement for a given month or past completed months.
 * Prevents duplicate settlements with unique database index.
 */
export async function finalizeMonthlyAdminSettlement(database, targetMonth, finalizedBy = 'scheduler') {
  const currentDhakaMonth = getDhakaMonth()
  const settlements = database.collection('monthlyAdminSettlements')
  const revenueTransactions = database.collection('revenueTransactions')

  // Cannot finalize the currently active month before it ends!
  if (targetMonth >= currentDhakaMonth) {
    const error = new Error(`Cannot finalize month ${targetMonth} before the calendar month ends in Asia/Dhaka.`)
    error.status = 400
    error.code = 'MONTH_NOT_COMPLETED'
    throw error
  }

  // Check if already finalized
  const existing = await settlements.findOne({ settlementMonth: targetMonth })
  if (existing) {
    return { settlement: existing, alreadyFinalized: true }
  }

  // Aggregate all verified revenue transactions for targetMonth
  const transactions = await revenueTransactions.find({
    paymentMonth: targetMonth,
  }).toArray()

  let totalGrossRevenue = 0
  let totalPlatformCommission = 0
  let oneTimeRevenue = 0
  let subscriptionRevenue = 0
  let refundedGross = 0
  let refundedCommission = 0

  for (const tx of transactions) {
    const gross = tx.grossAmount || 0
    const comm = Math.max(0, (tx.platformCommission || 0) - (tx.commissionReversedAmount || 0))
    const ref = tx.refundedAmount || 0
    const commRev = tx.commissionReversedAmount || 0

    totalGrossRevenue += gross
    totalPlatformCommission += comm
    refundedGross += ref
    refundedCommission += commRev

    if (tx.paymentType === 'ONE_TIME') {
      oneTimeRevenue += gross
    } else {
      subscriptionRevenue += gross
    }
  }

  const now = new Date()
  const round = (val) => Math.round(val * 100) / 100

  const settlementRecord = {
    settlementMonth: targetMonth,
    totalGrossRevenue: round(totalGrossRevenue),
    totalPlatformCommission: round(totalPlatformCommission),
    transactionCount: transactions.length,
    oneTimeRevenue: round(oneTimeRevenue),
    subscriptionRevenue: round(subscriptionRevenue),
    refundedGross: round(refundedGross),
    refundedCommission: round(refundedCommission),
    settlementStatus: 'FINALIZED',
    finalizedAt: now,
    finalizedBy,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await settlements.insertOne(settlementRecord)
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate prevented by unique index
      const duplicate = await settlements.findOne({ settlementMonth: targetMonth })
      return { settlement: duplicate, alreadyFinalized: true }
    }
    throw err
  }

  // Update revenue transactions in targetMonth to commissionSettlementStatus: 'FINALIZED'
  await revenueTransactions.updateMany(
    { paymentMonth: targetMonth },
    { $set: { commissionSettlementStatus: 'FINALIZED', updatedAt: now } },
  )

  await writeAuditLog({
    actorUid: finalizedBy,
    actorRole: finalizedBy === 'scheduler' ? 'system' : 'admin',
    action: 'finance.admin_monthly_settlement_finalized',
    targetType: 'monthly_admin_settlement',
    targetId: targetMonth,
    meta: {
      settlementMonth: targetMonth,
      totalGrossRevenue: settlementRecord.totalGrossRevenue,
      totalPlatformCommission: settlementRecord.totalPlatformCommission,
      transactionCount: settlementRecord.transactionCount,
    },
  })

  return { settlement: settlementRecord, alreadyFinalized: false }
}

/**
 * Monthly Admin Job: scans for all completed past months that haven't been finalized yet.
 */
export async function runAdminMonthlySettlementJob(database) {
  const currentDhakaMonth = getDhakaMonth()
  const revenueTransactions = database.collection('revenueTransactions')
  const settlements = database.collection('monthlyAdminSettlements')

  // Find all distinct past months with transactions
  const monthsWithTxs = await revenueTransactions.distinct('paymentMonth', {
    paymentMonth: { $lt: currentDhakaMonth },
  })

  // Also include the immediate previous month even if 0 transactions
  const prevMonth = getPreviousDhakaMonth(currentDhakaMonth)
  const candidateMonths = [...new Set([...monthsWithTxs, prevMonth])].sort()

  const finalizedResults = []
  for (const m of candidateMonths) {
    if (m >= currentDhakaMonth) continue
    const already = await settlements.findOne({ settlementMonth: m })
    if (!already) {
      try {
        const res = await finalizeMonthlyAdminSettlement(database, m, 'scheduler')
        finalizedResults.push(res)
      } catch (err) {
        console.error(`Failed to finalize settlement for ${m}:`, err.message)
      }
    }
  }

  return finalizedResults
}

/**
 * Combined runner for background scheduler.
 */
export async function runAllScheduledFinancialJobs(database) {
  try {
    const payoutResult = await runTeacherPayoutReleaseJob(database)
    const settlementResult = await runAdminMonthlySettlementJob(database)
    return { payoutResult, settlementResult }
  } catch (error) {
    console.error('Error running scheduled financial jobs:', error.message)
    return { error: error.message }
  }
}

/**
 * Starts the background settlement scheduler.
 * Runs on boot and on regular interval (every 5 minutes).
 */
export function startSettlementScheduler(database, intervalMs = 5 * 60 * 1000) {
  if (schedulerInterval) return

  // Run on startup
  runAllScheduledFinancialJobs(database).catch((err) => {
    console.error('Startup settlement scheduler error:', err.message)
  })

  schedulerInterval = setInterval(() => {
    runAllScheduledFinancialJobs(database).catch((err) => {
      console.error('Interval settlement scheduler error:', err.message)
    })
  }, intervalMs)
}

export function stopSettlementScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
}

