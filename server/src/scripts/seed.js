import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../../.env') })
dotenv.config()

import { MongoClient, ObjectId } from 'mongodb'

const uri = process.env.MONGODB_URI
const databaseName = process.env.MONGODB_DB_NAME || 'teachOSDB'

if (!uri) {
  console.error('Error: MONGODB_URI is not set in server/.env')
  process.exit(1)
}

async function seed() {
  const client = new MongoClient(uri)
  try {
    await client.connect()
    console.log('Connected to MongoDB for seeding...')
    const db = client.db(databaseName)

    // 1. Seed or find Platform
    const platforms = db.collection('platforms')
    let platform = await platforms.findOne({ slug: 'dca', status: { $ne: 'removed' } })
    const now = new Date()

    if (!platform) {
      const platformDoc = {
        name: 'Dhaka Central Academy',
        slug: 'dca',
        plan: 'premium',
        status: 'active',
        renewalDate: new Date(now.getTime() + 60 * 86400000), // 60 days renewal
        gracePeriodDays: 7,
        createdBy: 'system',
        createdAt: now,
        updatedAt: now,
      }
      const res = await platforms.insertOne(platformDoc)
      platform = { _id: res.insertedId, ...platformDoc }
      console.log('Created tenant platform:', platform.name, `(${platform._id})`)
    } else {
      console.log('Using existing tenant platform:', platform.name, `(${platform._id})`)
    }

    const platformId = platform._id

    // 2. Seed Users
    const users = db.collection('users')
    const seedUsers = [
      {
        uid: 'superadmin-teachos',
        email: 'superadmin@teachos.com',
        fullName: 'TeachOS Super Admin',
        role: 'superAdmin',
        platformId: null,
      },
      {
        uid: 'admin-dca',
        email: 'admin@teachos.com',
        fullName: 'DCA Academy Admin',
        role: 'admin',
        platformId,
      },
      {
        uid: 'teacher-rahman',
        email: 'teacher@teachos.com',
        fullName: 'Dr. K. Rahman',
        role: 'teacher',
        platformId,
      },
      {
        uid: 'student-tanvir',
        email: 'student@teachos.com',
        fullName: 'Tanvir Ahmed',
        role: 'student',
        platformId,
      },
    ]

    for (const u of seedUsers) {
      await users.updateOne(
        { email: u.email },
        {
          $set: {
            ...u,
            status: 'active',
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true }
      )
      console.log(`Upserted user: ${u.email} [${u.role}]`)
    }

    // 3. Seed Course/Batch Listings
    const listings = db.collection('listings')
    const seedListings = [
      {
        name: 'HSC Physics 2026 Batch A',
        category: 'Offline Batch',
        fee: 1500,
        duration: '6 Months',
        location: 'Savar, Dhaka (Near City Center)',
        description: 'HSC Physics comprehensive preparation batch covering the full syllabus with weekly exams, concept drills, and hands-on numerical problem solving.',
        image: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?auto=format&fit=crop&w=900&q=85',
        startDate: new Date('2026-11-10'),
      },
      {
        name: 'Next.js & Fullstack React Bootcamp',
        category: 'Online Course',
        fee: 3200,
        duration: '12 Weeks',
        location: '100% Online (Live Interactive)',
        description: 'Master modern fullstack development with React 19, Next.js App Router, MongoDB, Tailwind CSS, authentication, and cloud deployment pipelines.',
        image: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=900&q=85',
        startDate: new Date('2026-11-15'),
      },
      {
        name: 'IELTS Academic Masterclass 8.0+',
        category: 'Exam Preparation',
        fee: 4500,
        duration: '8 Weeks',
        location: 'Dhanmondi, Dhaka & Online Hybrid',
        description: 'Intensive IELTS preparation focusing on Band 8.0+ writing task 2 structures, speaking fluency, mock test simulations, and personalized examiner feedback.',
        image: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=900&q=85',
        startDate: new Date('2026-11-08'),
      },
      {
        name: 'Class 10 General Math Foundation',
        category: 'Offline Batch',
        fee: 1200,
        duration: '4 Months',
        location: 'Mirpur-10, Dhaka (Metro Station Gate)',
        description: 'Board exam preparation focusing on algebra, trigonometry, geometry theorems, and previous year board questions with weekly practice tests.',
        image: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=900&q=85',
        startDate: new Date('2026-11-12'),
      },
      {
        name: 'Python & AI for Absolute Beginners',
        category: 'Skill Course',
        fee: 0,
        duration: '6 Weeks',
        location: 'Online Zoom Batches (Weekend)',
        description: 'Learn programming fundamentals from scratch using Python. Covers data types, loops, functions, automation, data science libraries, and basic machine learning.',
        image: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=900&q=85',
        startDate: new Date('2026-11-20'),
      },
      {
        name: 'Medical Admission Biology Drill',
        category: 'Exam Preparation',
        fee: 2800,
        duration: '3 Months',
        location: 'Farmgate, Dhaka (Science Point)',
        description: 'High-yield biology revision for medical college admission test. Includes 10,000+ MCQs, quick memory mnemonics, and daily negative marking practice tests.',
        image: 'https://images.unsplash.com/photo-1576086213369-97a306d36557?auto=format&fit=crop&w=900&q=85',
        startDate: new Date('2026-11-05'),
      },
    ]

    for (const item of seedListings) {
      await listings.updateOne(
        { name: item.name },
        {
          $set: {
            ...item,
            teacherUid: 'teacher-rahman',
            email: 'teacher@teachos.com',
            teacherName: 'Dr. K. Rahman',
            platformId,
            status: 'active',
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true }
      )
      console.log(`Upserted listing: ${item.name} (${item.category})`)
    }

    console.log('\n✅ Database seeding successfully completed!')
    console.log('\n--- DEMO CREDENTIALS ---')
    console.log('Super Admin:  superadmin@teachos.com (Password: Super@123)')
    console.log('Platform Admin: admin@teachos.com     (Password: Admin@123)')
    console.log('Teacher:       teacher@teachos.com    (Password: Teach@123)')
    console.log('Student:       student@teachos.com    (Password: Study@123)')
    console.log('------------------------\n')
  } catch (error) {
    console.error('Seeding failed:', error)
  } finally {
    await client.close()
  }
}

seed()
