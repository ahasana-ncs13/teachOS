import { Router } from 'express'
import { ObjectId } from 'mongodb'
import { getDatabase } from '../db.js'
import { requireRole, verifyToken } from '../middleware/auth.js'

export const notificationRouter = Router()

notificationRouter.use(verifyToken, requireRole('admin', 'teacher', 'student'))

notificationRouter.get('/', async (req, res, next) => {
  try {
    const database = getDatabase()
    const filter = { uid: req.authUid, role: req.user.role }
    const [notifications, unreadCount] = await Promise.all([
      database.collection('notifications').find(filter).sort({ createdAt: -1 }).limit(30).toArray(),
      database.collection('notifications').countDocuments({ ...filter, readAt: null }),
    ])
    res.json({ notifications, unreadCount, role: req.user.role })
  } catch (error) {
    next(error)
  }
})

notificationRouter.patch('/read-all', async (req, res, next) => {
  try {
    const result = await getDatabase().collection('notifications').updateMany(
      { uid: req.authUid, role: req.user.role, readAt: null },
      { $set: { readAt: new Date() } },
    )
    res.json({ updated: result.modifiedCount })
  } catch (error) {
    next(error)
  }
})

notificationRouter.patch('/:id/read', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'A valid notification ID is required.', code: 'INVALID_NOTIFICATION_ID' })
    }
    const result = await getDatabase().collection('notifications').updateOne(
      { _id: new ObjectId(req.params.id), uid: req.authUid, role: req.user.role },
      { $set: { readAt: new Date() } },
    )
    if (!result.matchedCount) return res.status(404).json({ message: 'Notification not found.', code: 'NOTIFICATION_NOT_FOUND' })
    res.json({ updated: true })
  } catch (error) {
    next(error)
  }
})
