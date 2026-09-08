import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { closeDatabase, connectDatabase, getDatabase } from './db.js'

const app = express()
const port = process.env.PORT || 5000
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5174')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
let databaseReady = false

app.use(cors({
  origin: (requestOrigin, callback) => {
    if (!requestOrigin || allowedOrigins.includes(requestOrigin)) return callback(null, true)
    return callback(new Error(`Origin ${requestOrigin} is not allowed by CORS`))
  },
}))
app.use(express.json())

app.post('/api/users', async (request, response) => {
  if (!databaseReady) return response.status(503).json({ message: 'Database is still starting. Please try again in a moment.' })
  const { uid, email, displayName, fullName, role, photoURL, provider, emailVerified, metadata } = request.body
  if (!uid || !email || !role) return response.status(400).json({ message: 'uid, email, and role are required' })

  const allowedRoles = ['admin', 'teacher', 'student']
  if (!allowedRoles.includes(role)) return response.status(400).json({ message: 'Invalid role' })

  try {
    const users = getDatabase().collection('users')
    const now = new Date()
    const profile = {
      uid,
      email: String(email).trim().toLowerCase(),
      displayName: displayName || fullName || '',
      fullName: fullName || displayName || '',
      role,
      photoURL: photoURL || null,
      provider: provider || 'password',
      emailVerified: Boolean(emailVerified),
      metadata: metadata || {},
      updatedAt: now,
    }
    await users.updateOne({ uid }, { $set: profile, $setOnInsert: { createdAt: now } }, { upsert: true })
    const savedUser = await users.findOne({ uid }, { projection: { _id: 0 } })
    response.status(200).json({ user: savedUser })
  } catch (error) {
    console.error('Unable to save user:', error.message)
    response.status(500).json({ message: 'Unable to save user profile' })
  }
})

app.get('/api/health', (_request, response) => {
  response.status(databaseReady ? 200 : 503).json({ status: databaseReady ? 'ok' : 'starting', service: 'teachos-api', database: databaseReady ? 'connected' : 'connecting', timestamp: new Date().toISOString() })
})

app.get('/api/courses', (_request, response) => {
  response.json({ courses: [] })
})

connectDatabase()
const server = app.listen(port, () => console.log(`TeachOS API listening on http://localhost:${port}`))

connectDatabase()
  .then(() => { databaseReady = true })
  .catch((error) => console.error('TeachOS API could not connect to MongoDB:', error.message))

process.on('SIGINT', async () => {
  server.close()
  await closeDatabase()
  process.exit(0)
})