import { getDhakaMonthRange, platformShare } from './finance.service.js'

const TRIAL_MONTHS = 1
const WARNING_INTERVAL_DAYS = 7
const MAX_PAYMENT_WARNINGS = 3

function addCalendarMonth(date) {
  const result = new Date(date)
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCMonth(result.getUTCMonth() + TRIAL_MONTHS)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

function dhakaMonth(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

export function createInitialTeacherSubscription(startedAt = new Date()) {
  const trialStartedAt = new Date(startedAt)
  return {
    trialStartedAt,
    trialEndsAt: addCalendarMonth(trialStartedAt),
    status: 'trialing',
    warningCount: 0,
    updatedAt: new Date(),
  }
}

async function ensureTrial(database, teacherUid, now) {
  const users = database.collection('users')
  const user = await users.findOne({ uid: teacherUid, role: 'teacher' })
  if (!user) {
    const error = new Error('Teacher account not found.')
    error.status = 404
    error.code = 'TEACHER_NOT_FOUND'
    throw error
  }

  if (user.subscription?.trialEndsAt) return user

  const subscription = createInitialTeacherSubscription(user.createdAt ? new Date(user.createdAt) : now)
  subscription.updatedAt = now
  await users.updateOne({ _id: user._id }, { $set: { subscription } })
  return { ...user, subscription }
}

async function refreshMonthlyInvoices(database, teacherUid, trialEndsAt, now) {
  const payments = await database.collection('studentPayments').find({
    teacherUid,
    gateway: { $in: ['stripe', 'bkash'] },
    mode: 'live',
    status: { $in: ['paid', 'refunded'] },
    currency: 'BDT',
    paidAt: { $gte: trialEndsAt, $lt: now },
  }, {
    projection: { amount: 1, platformCommissionAmount: 1, commissionReversedAmount: 1, refundedAmount: 1, paidAt: 1 },
  }).toArray()

  const monthlyPayments = new Map()
  for (const payment of payments) {
    if (!payment.paidAt) continue
    const month = dhakaMonth(new Date(payment.paidAt))
    const totals = monthlyPayments.get(month) || { grossAmount: 0, collectedCommission: 0 }
    const amount = Math.max(0, (Number(payment.amount) || 0) - (Number(payment.refundedAmount) || 0))
    totals.grossAmount += amount
    totals.collectedCommission += Math.max(0, (Number(payment.platformCommissionAmount) || 0) - (Number(payment.commissionReversedAmount) || 0))
    monthlyPayments.set(month, totals)
  }

  const invoices = database.collection('teacherSubscriptionInvoices')
  for (const [month, totals] of monthlyPayments) {
    const existing = await invoices.findOne({ teacherUid, month })
    const expectedCommission = roundMoney(platformShare(totals.grossAmount))
    const previouslyPaid = Number(existing?.paidAmount) || 0
    const dueAmount = roundMoney(Math.max(
      0,
      expectedCommission - totals.collectedCommission - previouslyPaid,
    ))

    await invoices.updateOne(
      { teacherUid, month },
      {
        $set: {
          teacherUid,
          month,
          currency: 'BDT',
          grossAmount: roundMoney(totals.grossAmount),
          expectedCommission,
          collectedCommission: roundMoney(totals.collectedCommission),
          dueAmount,
          status: dueAmount > 0 ? 'due' : 'paid',
          updatedAt: now,
        },
        $setOnInsert: { paidAmount: 0, createdAt: now },
      },
      { upsert: true },
    )
  }
}

export async function getTeacherSubscription(database, teacherUid, now = new Date()) {
  const user = await ensureTrial(database, teacherUid, now)
  const subscription = user.subscription
  const trialEndsAt = new Date(subscription.trialEndsAt)
  const isTrialing = now < trialEndsAt

  if (!isTrialing) {
    await refreshMonthlyInvoices(database, teacherUid, trialEndsAt, now)
  }

  const invoices = isTrialing
    ? []
    : await database.collection('teacherSubscriptionInvoices')
      .find({ teacherUid, dueAmount: { $gt: 0 } })
      .sort({ month: 1 })
      .toArray()
  const amountDue = roundMoney(invoices.reduce((total, invoice) => total + (Number(invoice.dueAmount) || 0), 0))
  let warningCount = Number(subscription.warningCount) || 0
  let nextWarningAt = subscription.nextWarningAt ? new Date(subscription.nextWarningAt) : null
  let lastWarningAt = subscription.lastWarningAt ? new Date(subscription.lastWarningAt) : null
  let status = isTrialing ? 'trialing' : (amountDue > 0 ? 'past_due' : 'active')
  let warning = null

  if (amountDue > 0) {
    if (!nextWarningAt || nextWarningAt <= now) {
      if (warningCount < MAX_PAYMENT_WARNINGS) {
        warningCount += 1
        lastWarningAt = now
        nextWarningAt = new Date(now.getTime() + WARNING_INTERVAL_DAYS * 24 * 60 * 60 * 1000)
        warning = `Payment warning ${warningCount} of ${MAX_PAYMENT_WARNINGS}: settle ${amountDue.toFixed(2)} BDT to keep your teacher workspace active.`
      }
    }
    if (warningCount >= MAX_PAYMENT_WARNINGS) status = 'suspended'
  } else {
    warningCount = 0
    nextWarningAt = null
    lastWarningAt = null
  }

  const updatedSubscription = {
    ...subscription,
    status,
    warningCount,
    nextWarningAt,
    lastWarningAt,
    amountDue,
    currency: 'BDT',
    commissionRate: 0.05,
    updatedAt: now,
  }
  const update = { subscription: updatedSubscription }
  if (status === 'suspended') {
    update.status = 'suspended'
    update.suspensionReason = 'subscription_nonpayment'
    update.suspendedAt = user.suspendedAt || now
  } else if (user.suspensionReason === 'subscription_nonpayment') {
    update.status = 'active'
    update.suspensionReason = null
    update.suspendedAt = null
  }
  await database.collection('users').updateOne({ _id: user._id }, { $set: update })

  return {
    status,
    trialStartedAt: updatedSubscription.trialStartedAt,
    trialEndsAt,
    warningCount,
    maxWarnings: MAX_PAYMENT_WARNINGS,
    nextWarningAt,
    warning,
    amountDue,
    currency: 'BDT',
    commissionRate: 0.05,
    invoices,
    isTrialing,
  }
}

export async function confirmTeacherSubscriptionPayment(database, session, teacherUid) {
  const metadata = session.metadata || {}
  if (
    metadata.kind !== 'teacher_subscription'
    || !metadata.orderId
    || metadata.teacherUid !== teacherUid
    || session.mode !== 'payment'
    || session.payment_status !== 'paid'
    || session.currency !== 'bdt'
  ) return false

  const payments = database.collection('teacherSubscriptionPayments')
  const payment = await payments.findOne({
    paymentId: metadata.orderId,
    teacherUid,
    providerPaymentId: session.id,
    status: { $in: ['pending', 'paid'] },
  })
  if (
    !payment
    || metadata.invoiceId !== String(payment.invoiceId)
    || Math.round(Number(session.amount_total) || 0) !== Math.round(Number(payment.amount) * 100)
  ) {
    return false
  }
  if (payment.status === 'paid') return true

  const mode = session.livemode ? 'live' : 'test'
  if (payment.mode !== mode) return false
  const now = new Date()
  const updated = await payments.updateOne(
    { _id: payment._id, status: 'pending' },
    {
      $set: {
        status: 'paid',
        providerTransactionId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        paidAt: Number.isFinite(session.created) ? new Date(session.created * 1000) : now,
        updatedAt: now,
      },
    },
  )
  if (!updated.modifiedCount) return (await payments.findOne({ _id: payment._id }))?.status === 'paid'

  await database.collection('teacherSubscriptionInvoices').updateOne(
    { _id: payment.invoiceId, teacherUid: payment.teacherUid },
    {
      $inc: { paidAmount: payment.amount },
      $set: { updatedAt: now },
    },
  )
  await getTeacherSubscription(database, teacherUid, now)
  return true
}

export { MAX_PAYMENT_WARNINGS }
