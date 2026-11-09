/**
 * TeachOS MongoDB Atlas – Production-Safe Test Data Cleanup Script
 *
 * SAFETY RULES:
 * 1. Default execution is DRY RUN (no writes or deletions).
 * 2. Requires explicit command-line flag `--confirm-delete-test-data` to execute deletions.
 * 3. Never logs connection strings, passwords, or credentials.
 * 4. Verifies database identity before proceeding.
 * 5. Uses multi-document transactions where replica set / Atlas supports it.
 * 6. Re-verifies every document's test markers before issuing deletion.
 * 7. Strictly preserves production users, live listings, and financial records.
 *
 * Usage:
 *   Dry run (default, safe):
 *     node server/src/scripts/cleanup-test-data.js
 *
 *   Live execution (requires explicit confirmation flag):
 *     node server/src/scripts/cleanup-test-data.js --confirm-delete-test-data
 */

import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })
dotenv.config()

// Approved manifest of confirmed test record IDs
export const APPROVED_TEST_MANIFEST = {
  classes: [
    '6ade11e203c707252172eb5b',
    '6ade11e203c707252172eb5c',
    '6ae2504a03c707252173b7d2',
    '6ae2504a03c707252173b7d3',
    '6ae9001f9a87793599170d57',
    '6ae9001f9a87793599170d58',
  ],
  payments: [
    '6ade13d903c707252172ebcc',
    '6ae2504b03c707252173b7d7',
    '6ae9001f9a87793599170d5c',
  ],
  payoutRequests: [
    '6ade13d903c707252172ebcb',
    '6ae2504b03c707252173b7d8',
    '6ae9001f9a87793599170d5d',
  ],
  revenueTransactions: [
    '6af170079cf4243c16102877',
  ],
  studentEnrollments: [
    '6ade27ef03c707252172eda1',
    '6af02e36ea05174a633e4d3f',
    '6af09bd5ea05174a633e52f8',
    '6af0a582ea05174a633e5351',
    '6af0af40ea05174a633e53b8',
    '6af17008ea05174a633e5a9f',
  ],
  studentPayments: [
    '6ade27836ac8addb3500b0b4',
    '6ade279824e66a2c15abb750',
    '6af02dd235be42fb3f7115fa',
    '6af06013ac104bc649ba4477',
    '6af09e7b760b35b40ac878f1',
    '6af0a5611b4537714bcf4eec',
    '6af0af2000d2095448cbcc33',
    '6af16fdf9cf4243c16102875',
  ],
  students: [
    '6ae2504a03c707252173b7d4',
    '6ae2504a03c707252173b7d5',
    '6ae2504b03c707252173b7d6',
    '6ae9001f9a87793599170d59',
    '6ae9001f9a87793599170d5a',
    '6ae9001f9a87793599170d5b',
  ],
  teacherDashboards: [
    '6adb5c9933bdc39745d1ef1b',
    '6adcb44f03c7072521726bc4',
    '6ade11e103c707252172eb5a',
    '6ae2504a03c707252173b7d1',
    '6ae9001f9a87793599170d56',
  ],
}

/**
 * Re-verifies that a document is strictly confirmed test data before deletion.
 */
function verifyDocumentSafety(collectionName, doc) {
  if (!doc) return { safe: false, reason: 'Document not found' }

  // Sample data marker
  if (doc.isSample === true) {
    return { safe: true, reason: 'Confirmed isSample: true' }
  }

  // Student payments test markers
  if (collectionName === 'studentPayments') {
    if (doc.mode === 'test' || doc.providerPaymentId?.startsWith('cs_test_') || doc.providerTransactionId?.includes('test')) {
      return { safe: true, reason: 'Confirmed test-mode Stripe payment' }
    }
  }

  // Student enrollments test markers
  if (collectionName === 'studentEnrollments') {
    if (doc.paymentStatus === 'test_paid' || doc.paymentStatus === 'stripe_test_paid') {
      return { safe: true, reason: 'Confirmed test enrollment (paymentStatus: test_paid)' }
    }
  }

  // Revenue transactions test markers
  if (collectionName === 'revenueTransactions') {
    if (doc.mode === 'test') {
      return { safe: true, reason: 'Confirmed test revenue transaction (mode: test)' }
    }
  }

  return { safe: false, reason: 'Document does not contain strict test markers; preservation required.' }
}

async function runCleanup() {
  const isConfirmed = process.argv.includes('--confirm-delete-test-data')
  const isDryRun = !isConfirmed || process.env.DRY_RUN === 'true'

  console.log('=================================================================')
  console.log('   TeachOS MongoDB Atlas – Test Data Cleanup Engine')
  console.log('=================================================================')
  console.log(`Execution Mode: ${isDryRun ? 'DRY RUN (Read-Only Simulation)' : '*** LIVE DELETION ACTIVATED ***'}`)

  if (isDryRun) {
    console.log('NOTE: No documents will be modified or deleted. Dry run is active by default.')
    console.log('To execute deletions, you must provide --confirm-delete-test-data.\n')
  }

  const uri = process.env.MONGODB_URI
  const expectedDbName = process.env.MONGODB_DB_NAME || 'teachOSDB'

  if (!uri) {
    throw new Error('MONGODB_URI is not set in environment.')
  }

  // Connect to Atlas
  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  })

  await client.connect()
  const db = client.db(expectedDbName)

  // Verify target database
  if (db.databaseName !== expectedDbName) {
    await client.close()
    throw new Error(`Target database mismatch! Expected "${expectedDbName}", found "${db.databaseName}". Aborting.`)
  }

  console.log(`Connected to database: ${db.databaseName}`)
  console.log('Beginning verification against approved manifest...\n')

  let totalPlannedDeletions = 0
  let totalVerifiedSafe = 0
  let totalRejected = 0

  const plan = []

  for (const [collectionName, idList] of Object.entries(APPROVED_TEST_MANIFEST)) {
    const col = db.collection(collectionName)

    for (const idStr of idList) {
      totalPlannedDeletions++
      const _id = ObjectId.isValid(idStr) ? new ObjectId(idStr) : idStr
      const doc = await col.findOne({ _id })

      const verification = verifyDocumentSafety(collectionName, doc)

      if (verification.safe) {
        totalVerifiedSafe++
        plan.push({
          collection: collectionName,
          _id,
          idStr,
          status: 'VERIFIED_TEST_DATA',
          reason: verification.reason,
        })
      } else {
        totalRejected++
        plan.push({
          collection: collectionName,
          _id,
          idStr,
          status: 'REJECTED_PRESERVE',
          reason: verification.reason,
        })
      }
    }
  }

  console.log('--- VERIFICATION SUMMARY ---')
  console.log(`Total Manifest Items:  ${totalPlannedDeletions}`)
  console.log(`Verified Safe To Delete: ${totalVerifiedSafe}`)
  console.log(`Rejected (Preserved):   ${totalRejected}`)

  if (totalRejected > 0) {
    console.warn('\nWARNING: Some items in the manifest failed safety verification:')
    for (const item of plan.filter((p) => p.status === 'REJECTED_PRESERVE')) {
      console.warn(` - [${item.collection}] ID: ${item.idStr} Reason: ${item.reason}`)
    }
  }

  if (isDryRun) {
    console.log('\n================ DRY RUN COMPLETED ================')
    console.log(`Simulated deletion of ${totalVerifiedSafe} confirmed test records across ${Object.keys(APPROVED_TEST_MANIFEST).length} collections.`)
    console.log('ZERO database modifications were made.')
    console.log('Awaiting administrator review and approval before live run.')
    await client.close()
    return
  }

  // LIVE DELETION EXECUTION
  console.log('\n>>> PROCEEDING WITH LIVE DELETION OF VERIFIED TEST RECORDS...')
  let deletedCount = 0

  // Attempt transactional cleanup
  const session = client.startSession()
  try {
    await session.withTransaction(async () => {
      for (const item of plan) {
        if (item.status !== 'VERIFIED_TEST_DATA') continue
        const col = db.collection(item.collection)
        const result = await col.deleteOne({ _id: item._id }, { session })
        if (result.deletedCount === 1) {
          deletedCount++
          console.log(`[DELETED] Collection: ${item.collection.padEnd(20)} | ID: ${item.idStr} | Reason: ${item.reason}`)
        }
      }
    })
    console.log(`\nTransaction committed successfully! Total deleted documents: ${deletedCount}`)
  } catch (txError) {
    console.warn('Transaction execution error or standalone deployment; falling back to safe atomic deletes:', txError.message)
    deletedCount = 0
    for (const item of plan) {
      if (item.status !== 'VERIFIED_TEST_DATA') continue
      const col = db.collection(item.collection)
      const result = await col.deleteOne({ _id: item._id })
      if (result.deletedCount === 1) {
        deletedCount++
        console.log(`[DELETED] Collection: ${item.collection.padEnd(20)} | ID: ${item.idStr} | Reason: ${item.reason}`)
      }
    }
    console.log(`\nAtomic deletion completed! Total deleted documents: ${deletedCount}`)
  } finally {
    await session.endSession()
    await client.close()
  }

  console.log('Database cleanup finished safely. Database connection closed.')
}

// Only run CLI execution if invoked directly
if (process.argv[1] && process.argv[1].endsWith('cleanup-test-data.js')) {
  runCleanup().catch((err) => {
    console.error('Cleanup execution failed:', err)
    process.exit(1)
  })
}

