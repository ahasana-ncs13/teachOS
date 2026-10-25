export async function createNotifications(database, recipients, notification) {
  const uniqueRecipients = [...new Map(
    recipients
      .filter((recipient) => recipient?.uid && recipient?.role)
      .map((recipient) => [`${recipient.role}:${recipient.uid}`, recipient]),
  ).values()]
  if (!uniqueRecipients.length) return true

  const createdAt = new Date()
  try {
    await database.collection('notifications').insertMany(uniqueRecipients.map(({ uid, role }) => ({
      uid,
      role,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      href: notification.href,
      relatedId: notification.relatedId || null,
      readAt: null,
      createdAt,
    })))
    return true
  } catch (error) {
    console.error('Unable to create role notifications:', error.message)
    return false
  }
}

export async function notifyListingStudents(database, listingId, notification) {
  try {
    const enrollments = await database.collection('studentEnrollments')
      .find({ listingId, status: 'active' }, { projection: { studentUid: 1 } })
      .toArray()
    return createNotifications(
      database,
      enrollments.map(({ studentUid }) => ({ uid: studentUid, role: 'student' })),
      notification,
    )
  } catch (error) {
    console.error('Unable to find enrolled students for notifications:', error.message)
    return false
  }
}

export async function notifyAdmins(database, notification) {
  try {
    const admins = await database.collection('users')
      .find({ role: { $in: ['admin', 'superAdmin'] }, status: { $ne: 'removed' } }, { projection: { uid: 1 } })
      .toArray()
    return createNotifications(
      database,
      admins.map(({ uid }) => ({ uid, role: 'admin' })),
      notification,
    )
  } catch (error) {
    console.error('Unable to find admins for notifications:', error.message)
    return false
  }
}
