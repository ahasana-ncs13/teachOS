const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000

function currentDhakaMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

export function getDhakaMonthRange(monthValue) {
  const month = monthValue || currentDhakaMonth()
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

export function platformShare(amount) {
  return Math.round((Math.round(Number(amount) * 100) * 5) / 100) / 100
}

export async function getMonthlyCommission(database, monthValue) {
  const { month, start, end } = getDhakaMonthRange(monthValue)
  const transactions = await database.collection('studentPayments').find({
    gateway: 'stripe',
    mode: 'live',
    status: 'paid',
    currency: 'BDT',
    paidAt: { $gte: start, $lt: end },
  }, {
    projection: {
      _id: 0,
      paymentId: 1,
      providerTransactionId: 1,
      teacherUid: 1,
      teacherName: 1,
      courseName: 1,
      amount: 1,
      platformCommissionAmount: 1,
      teacherNetAmount: 1,
      paidAt: 1,
    },
  }).sort({ paidAt: -1 }).toArray()

  const teachersByUid = new Map()
  let grossAmount = 0
  let commissionAmount = 0
  let teacherNetAmount = 0
  for (const payment of transactions) {
    const amount = Number(payment.amount) || 0
    const commission = Number.isFinite(payment.platformCommissionAmount)
      ? payment.platformCommissionAmount
      : platformShare(amount)
    const net = Number.isFinite(payment.teacherNetAmount) ? payment.teacherNetAmount : amount - commission
    grossAmount += amount
    commissionAmount += commission
    teacherNetAmount += net

    const teacher = teachersByUid.get(payment.teacherUid) || {
      teacherUid: payment.teacherUid,
      teacherName: payment.teacherName || 'TeachOS teacher',
      grossAmount: 0,
      commissionAmount: 0,
      netAmount: 0,
      paymentCount: 0,
    }
    teacher.grossAmount += amount
    teacher.commissionAmount += commission
    teacher.netAmount += net
    teacher.paymentCount += 1
    teachersByUid.set(payment.teacherUid, teacher)
  }

  const round = (value) => Math.round(value * 100) / 100
  const roundRows = (rows) => rows.map((row) => ({
    ...row,
    grossAmount: round(row.grossAmount),
    commissionAmount: round(row.commissionAmount),
    netAmount: round(row.netAmount),
  }))

  return {
    month,
    timezone: 'Asia/Dhaka',
    currency: 'BDT',
    commissionRate: 0.05,
    grossAmount: round(grossAmount),
    commissionAmount: round(commissionAmount),
    teacherNetAmount: round(teacherNetAmount),
    paymentCount: transactions.length,
    teachers: roundRows([...teachersByUid.values()].sort((first, second) => second.grossAmount - first.grossAmount)),
    transactions,
  }
}

export async function getTeacherPaymentSummary(database, teacherUid, monthValue) {
  const [monthly, payments, allTime] = await Promise.all([
    getMonthlyCommission(database, monthValue),
    database.collection('studentPayments').find({ teacherUid, gateway: { $in: ['stripe', 'bkash'] } }, {
      projection: {
        paymentId: 1,
        courseName: 1,
        amount: 1,
        currency: 1,
        gateway: 1,
        mode: 1,
        status: 1,
        createdAt: 1,
        paidAt: 1,
        platformCommissionAmount: 1,
        teacherNetAmount: 1,
      },
    }).sort({ createdAt: -1 }).limit(100).toArray(),
    database.collection('studentPayments').aggregate([
      { $match: { teacherUid, gateway: 'stripe', mode: 'live', status: 'paid', currency: 'BDT' } },
      { $group: { _id: null, total: { $sum: '$teacherNetAmount' } } },
    ]).toArray(),
  ])
  const teacher = monthly.teachers.find((item) => item.teacherUid === teacherUid)
  return {
    month: monthly.month,
    timezone: monthly.timezone,
    currency: monthly.currency,
    commissionRate: monthly.commissionRate,
    monthly: teacher || {
      teacherUid,
      grossAmount: 0,
      commissionAmount: 0,
      netAmount: 0,
      paymentCount: 0,
    },
    allTimeNetAmount: Math.round((allTime[0]?.total || 0) * 100) / 100,
    payments,
  }
}
