import { MongoClient, ServerApiVersion } from 'mongodb'

const uri = process.env.MONGODB_URI
const databaseName = process.env.MONGODB_DB_NAME || 'teachOSDB'
let client
let database

export async function connectDatabase() {
  if (!uri) throw new Error('MONGODB_URI is missing from server/.env')
  if (database) return database

  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  })

  await client.connect()
  await client.db('admin').command({ ping: 1 })
  database = client.db(databaseName)
  await database.collection('users').createIndex({ uid: 1 }, { unique: true })
  console.log(`MongoDB connected: ${databaseName}`)
  return database
}

export function getDatabase() {
  if (!database) throw new Error('MongoDB has not been connected')
  return database
}

export async function closeDatabase() {
  if (client) await client.close()
  client = undefined
  database = undefined
}