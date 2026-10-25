import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MongoClient } from 'mongodb'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })
dotenv.config()

const uri = process.env.MONGODB_URI
const databaseName = process.env.MONGODB_DB_NAME || 'teachOSDB'

if (!uri) {
  console.error('Error: MONGODB_URI is not set in server/.env')
  process.exit(1)
}

const teachers = [
  {
    name: 'Ahasana',
    subjects: [
      'Design and Analysis of Algorithms - 1',
      'Database Management Systems-1',
      'Data and Telecommunication',
      'Computer Architecture and Organization',
      'Introduction to Mechatronics',
    ],
  },
  {
    name: 'Shifa',
    subjects: [
      'Data Structures and Algorithms',
      'Object Oriented Programming',
      'Electronic Devices and Circuits',
      'Bangladesh Studies',
      'Linear Algebra',
    ],
  },
]

async function seedTeacherSubjects() {
  const client = new MongoClient(uri)
  try {
    await client.connect()
    const database = client.db(databaseName)
    const users = database.collection('users')
    const listings = database.collection('listings')
    const now = new Date()
    let inserted = 0

    for (const teacher of teachers) {
      const account = await users.findOne({ role: 'teacher', fullName: teacher.name, status: { $ne: 'removed' } })
      if (!account) throw new Error(`Teacher account not found for ${teacher.name}; create the teacher account before seeding subjects.`)

      for (const name of teacher.subjects) {
        const subjectKey = `${account.uid}:${name.toLowerCase()}`
        const result = await listings.updateOne(
          { teacherUid: account.uid, subjectKey },
          {
            $setOnInsert: {
              teacherUid: account.uid,
              teacherName: account.fullName || account.displayName || teacher.name,
              email: account.email,
              subjectKey,
              name,
              category: 'Theory Course',
              fee: null,
              duration: '',
              location: '',
              description: '',
              status: 'draft',
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true },
        )
        if (result.upsertedCount) inserted += 1
        console.log(`${result.upsertedCount ? 'Added draft' : 'Already exists'}: ${name} — ${teacher.name}`)
      }
    }

    console.log(`Finished: ${inserted} new draft subjects added.`)
  } finally {
    await client.close()
  }
}

seedTeacherSubjects().catch((error) => {
  console.error('Unable to seed teacher subjects:', error.message)
  process.exitCode = 1
})
