import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { connectDatabase, closeDatabase } from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })
dotenv.config()

async function auditDatabase() {
  console.log('Connecting to MongoDB Atlas (read-only audit)...')
  const db = await connectDatabase()
  console.log(`Connected to database: ${db.databaseName}`)

  const collections = await db.listCollections().toArray()
  const collectionNames = collections.map((c) => c.name).sort()
  console.log(`Found ${collectionNames.length} collections:`, collectionNames)

  const summary = {}
  const recordsReport = {}

  for (const name of collectionNames) {
    const col = db.collection(name)
    const total = await col.countDocuments()
    summary[name] = { total, confirmedTest: 0, confirmedProd: 0, uncertain: 0 }
    recordsReport[name] = []

    if (total === 0) {
      console.log(`[0 docs] ${name}`)
      continue
    }

    // For GridFS binary chunks, avoid transferring heavy binary payloads
    const projection = name === 'courseVideos.chunks'
      ? { _id: 1, files_id: 1, n: 1 }
      : {}

    console.log(`Auditing ${name} (${total} docs)...`)
    const docs = await col.find({}, { projection }).toArray()

    for (const doc of docs) {
      const idStr = String(doc._id)
      let classification = 'UNCERTAIN'
      const reasons = []
      const related = []

      // 1. Explicit sample flag
      if (doc.isSample === true) {
        classification = 'CONFIRMED_TEST'
        reasons.push('Explicit isSample: true flag')
      }

      // 2. Explicit test mode flag
      if (doc.mode === 'test') {
        classification = 'CONFIRMED_TEST'
        reasons.push('Explicit mode: "test" marker')
      }

      // 3. PaymentStatus test markers
      if (doc.paymentStatus && typeof doc.paymentStatus === 'string' && doc.paymentStatus.includes('test')) {
        classification = 'CONFIRMED_TEST'
        reasons.push(`paymentStatus: "${doc.paymentStatus}"`)
      }

      // 4. Stripe test session / payment intent ID
      if (doc.providerPaymentId && typeof doc.providerPaymentId === 'string' && doc.providerPaymentId.startsWith('cs_test_')) {
        classification = 'CONFIRMED_TEST'
        reasons.push(`Stripe test checkout session: ${doc.providerPaymentId}`)
      }
      if (doc.providerTransactionId && typeof doc.providerTransactionId === 'string' && doc.providerTransactionId.includes('test')) {
        classification = 'CONFIRMED_TEST'
        reasons.push(`Stripe/bKash test transaction ID: ${doc.providerTransactionId}`)
      }

      // 5. Test/demo email patterns
      const email = doc.email || doc.studentEmail || ''
      if (typeof email === 'string' && (email.includes('example.com') || email.includes('test@') || email.includes('demo@'))) {
        if (classification !== 'CONFIRMED_TEST') {
          classification = 'CONFIRMED_TEST'
        }
        reasons.push(`Test email domain/format: ${email}`)
      }

      // 6. Test course / listing titles or descriptions
      const title = doc.title || doc.name || doc.courseName || ''
      if (typeof title === 'string' && (title.toLowerCase().startsWith('test ') || title.toLowerCase() === 'test' || title.toLowerCase().includes('sample'))) {
        if (classification !== 'CONFIRMED_TEST') {
          classification = 'UNCERTAIN'
        }
        reasons.push(`Test-like title: "${title}"`)
      }

      // 7. Check if genuine production indicator
      if (classification !== 'CONFIRMED_TEST') {
        if (doc.mode === 'live' || (doc.providerPaymentId && doc.providerPaymentId.startsWith('cs_live_'))) {
          classification = 'CONFIRMED_PRODUCTION'
          reasons.push('Verified live payment / production mode')
        } else if (name === 'platformRevenues' || name === 'monthlyAdminSettlements') {
          // System financial record
          classification = 'CONFIRMED_PRODUCTION'
          reasons.push('System financial ledger record')
        } else if (name === 'users' && email && !email.includes('test') && !email.includes('example')) {
          classification = 'CONFIRMED_PRODUCTION'
          reasons.push('Standard registered user without test markers')
        } else if (name === 'listings' && doc.status === 'published' && doc.teacherUid && !doc.isSample) {
          classification = 'CONFIRMED_PRODUCTION'
          reasons.push('Published teacher course without test markers')
        } else if (name === 'classes' && doc.isSample !== true) {
          classification = 'CONFIRMED_PRODUCTION'
          reasons.push('Live scheduled class without test markers')
        }
      }

      if (classification === 'CONFIRMED_TEST') {
        summary[name].confirmedTest++
      } else if (classification === 'CONFIRMED_PRODUCTION') {
        summary[name].confirmedProd++
      } else {
        summary[name].uncertain++
      }

      // Record relationships
      if (doc.teacherUid) related.push(`teacherUid: ${doc.teacherUid}`)
      if (doc.studentUid) related.push(`studentUid: ${doc.studentUid}`)
      if (doc.listingId) related.push(`listingId: ${doc.listingId}`)
      if (doc.paymentId) related.push(`paymentId: ${doc.paymentId}`)

      recordsReport[name].push({
        id: idStr,
        classification,
        reasons,
        related,
        proposedAction: classification === 'CONFIRMED_TEST'
          ? 'DELETE'
          : classification === 'CONFIRMED_PRODUCTION'
            ? 'PRESERVE'
            : 'HOLD_FOR_MANUAL_REVIEW',
      })
    }
  }

  console.log('\n================ COLLECTION AUDIT SUMMARY ================')
  for (const [name, stats] of Object.entries(summary)) {
    console.log(
      `${name.padEnd(28)} | Total: ${String(stats.total).padStart(4)} | Confirmed Test: ${String(stats.confirmedTest).padStart(4)} | Confirmed Prod: ${String(stats.confirmedProd).padStart(4)} | Uncertain: ${String(stats.uncertain).padStart(4)}`
    )
  }

  // Sample confirmed test records
  console.log('\n================ SAMPLE CONFIRMED TEST RECORDS ================')
  for (const [name, records] of Object.entries(recordsReport)) {
    const testRecords = records.filter((r) => r.classification === 'CONFIRMED_TEST')
    if (testRecords.length > 0) {
      console.log(`\n--- ${name} (${testRecords.length} test records) ---`)
      for (const r of testRecords.slice(0, 10)) {
        console.log(`  [ID: ${r.id}] Reasons: ${r.reasons.join('; ')} | Related: ${r.related.join(', ') || 'none'}`)
      }
      if (testRecords.length > 10) {
        console.log(`  ... and ${testRecords.length - 10} more`)
      }
    }
  }

  // Sample uncertain records
  console.log('\n================ UNCERTAIN RECORDS (MANUAL REVIEW REQUIRED) ================')
  for (const [name, records] of Object.entries(recordsReport)) {
    const uncertainRecords = records.filter((r) => r.classification === 'UNCERTAIN')
    if (uncertainRecords.length > 0) {
      console.log(`\n--- ${name} (${uncertainRecords.length} uncertain records) ---`)
      for (const r of uncertainRecords.slice(0, 10)) {
        console.log(`  [ID: ${r.id}] Reasons: ${r.reasons.join('; ')} | Related: ${r.related.join(', ') || 'none'}`)
      }
      if (uncertainRecords.length > 10) {
        console.log(`  ... and ${uncertainRecords.length - 10} more`)
      }
    }
  }

  await closeDatabase()
  console.log('\nAudit complete. Database closed safely. No modifications were made.')
}

auditDatabase().catch(async (err) => {
  console.error('Audit failed:', err)
  try { await closeDatabase() } catch {}
  process.exit(1)
})
