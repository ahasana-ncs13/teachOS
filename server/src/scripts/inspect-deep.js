import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { connectDatabase, closeDatabase } from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })
dotenv.config()

async function inspectPayments() {
  const db = await connectDatabase()

  console.log('--- STUDENT PAYMENTS (all 22) ---')
  const sps = await db.collection('studentPayments').find({}).toArray()
  for (const p of sps) {
    console.log({
      id: String(p._id),
      paymentId: p.paymentId,
      gateway: p.gateway,
      mode: p.mode,
      status: p.status,
      amount: p.amount,
      providerPaymentId: p.providerPaymentId,
      providerTransactionId: p.providerTransactionId,
      studentUid: p.studentUid,
      courseName: p.courseName,
      createdAt: p.createdAt,
    })
  }

  console.log('\n--- BKASH PAYMENTS (all 12) ---')
  const bps = await db.collection('bkashPayments').find({}).toArray()
  for (const p of bps) {
    console.log({
      id: String(p._id),
      paymentID: p.paymentID,
      trxID: p.trxID,
      amount: p.amount,
      status: p.transactionStatus || p.status,
      studentUid: p.studentUid,
      createdAt: p.createdAt,
    })
  }

  console.log('\n--- STRIPE PAYMENTS (all 9) ---')
  const stps = await db.collection('stripePayments').find({}).toArray()
  for (const p of stps) {
    console.log({
      id: String(p._id),
      sessionId: p.sessionId,
      status: p.status,
      amount: p.amount,
      studentUid: p.studentUid,
      createdAt: p.createdAt,
    })
  }

  console.log('\n--- LISTINGS (teacherUid breakdown) ---')
  const listings = await db.collection('listings').find({}).toArray()
  for (const l of listings) {
    console.log({
      id: String(l._id),
      title: l.title || l.name,
      teacherUid: l.teacherUid,
      status: l.status,
      isSample: l.isSample,
      createdAt: l.createdAt,
    })
  }

  console.log('\n--- USERS (21 users) ---')
  const users = await db.collection('users').find({}, { projection: { uid: 1, email: 1, role: 1, isSample: 1, createdAt: 1 } }).toArray()
  for (const u of users) {
    console.log({
      id: String(u._id),
      uid: u.uid,
      role: u.role,
      isSample: u.isSample,
      createdAt: u.createdAt,
    })
  }

  await closeDatabase()
}

inspectPayments().catch(async (e) => {
  console.error(e)
  try { await closeDatabase() } catch {}
})

