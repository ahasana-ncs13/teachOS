import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MongoClient } from 'mongodb'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })
dotenv.config()

const uri = process.env.MONGODB_URI
const databaseName = process.env.MONGODB_DB_NAME || 'teachOSDB'
const applyChanges = process.argv.includes('--apply')

if (!uri) {
  console.error('MONGODB_URI is missing from server/.env')
  process.exit(1)
}

async function migrateListingOwners() {
  const client = new MongoClient(uri)
  try {
    await client.connect()
    const database = client.db(databaseName)
    const users = await database.collection('users').find(
      { role: 'teacher', status: { $ne: 'removed' }, uid: { $type: 'string' }, email: { $type: 'string' } },
      { projection: { uid: 1, email: 1 } },
    ).toArray()

    const ownersByEmail = new Map()
    const ambiguousEmails = new Set()
    for (const user of users) {
      const email = user.email.trim().toLowerCase()
      if (!email) continue
      if (ownersByEmail.has(email) && ownersByEmail.get(email) !== user.uid) {
        ambiguousEmails.add(email)
      } else {
        ownersByEmail.set(email, user.uid)
      }
    }

    const listings = await database.collection('listings').find(
      {},
      { projection: { teacherUid: 1, email: 1, platformId: 1 } },
    ).toArray()

    let alreadyOwned = 0
    let matchedByEmail = 0
    let ambiguous = 0
    let unmatched = 0
    let legacyPlatformFields = 0
    const operations = []

    for (const listing of listings) {
      const hasPlatformId = Object.hasOwn(listing, 'platformId')
      if (hasPlatformId) legacyPlatformFields += 1

      if (typeof listing.teacherUid === 'string' && listing.teacherUid.trim()) {
        alreadyOwned += 1
        if (hasPlatformId) {
          operations.push({ updateOne: { filter: { _id: listing._id }, update: { $unset: { platformId: '' } } } })
        }
        continue
      }

      const email = typeof listing.email === 'string' ? listing.email.trim().toLowerCase() : ''
      if (email && ambiguousEmails.has(email)) {
        ambiguous += 1
        continue
      }
      const teacherUid = email ? ownersByEmail.get(email) : null
      if (!teacherUid) {
        unmatched += 1
        continue
      }

      matchedByEmail += 1
      operations.push({
        updateOne: {
          filter: { _id: listing._id, $or: [{ teacherUid: { $exists: false } }, { teacherUid: null }, { teacherUid: '' }] },
          update: { $set: { teacherUid }, $unset: { platformId: '' } },
        },
      })
    }

    console.log(`Listings scanned: ${listings.length}`)
    console.log(`Already have a teacher UID: ${alreadyOwned}`)
    console.log(`Can be assigned from a matching teacher email: ${matchedByEmail}`)
    console.log(`Ambiguous teacher email matches: ${ambiguous}`)
    console.log(`No matching teacher profile: ${unmatched}`)
    console.log(`Listings with legacy platformId: ${legacyPlatformFields}`)

    if (!applyChanges) {
      console.log('\nDry run only. Review the counts, then use --apply to write the ownership migration.')
      return
    }

    if (operations.length) {
      const result = await database.collection('listings').bulkWrite(operations, { ordered: false })
      console.log(`\nOwnership migration applied. Matched records updated: ${result.modifiedCount}`)
    } else {
      console.log('\nNo listing records need updates.')
    }
    if (ambiguous || unmatched) {
      console.log('Some records were skipped. Resolve their teacher ownership manually before removing migration compatibility.')
    }
  } finally {
    await client.close()
  }
}

migrateListingOwners().catch((error) => {
  console.error('Listing ownership migration failed:', error.message)
  process.exitCode = 1
})
