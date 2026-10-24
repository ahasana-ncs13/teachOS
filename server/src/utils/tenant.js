function getOwnerField(req, requestedField) {
  if (requestedField) return requestedField
  if (req.user?.role === 'admin') return null
  if (req.user?.role === 'teacher') return 'teacherUid'
  if (req.user?.role === 'student') return 'studentUid'

  const error = new Error('A recognized user role is required to access owned records')
  error.status = 403
  error.code = 'OWNERSHIP_CONTEXT_REQUIRED'
  throw error
}

/** Scope tenant records by the authenticated owner's Firebase UID. */
export function tenantQuery(req, extraFilter = {}, requestedField) {
  const filter = { ...extraFilter, status: { $ne: 'removed' } }
  if (req.user?.role === 'admin') return filter
  const ownerField = getOwnerField(req, requestedField)
  if (ownerField) filter[ownerField] = req.user.uid
  return filter
}

/** Attach a trusted owner UID and server timestamps to an owned record. */
export function tenantInsert(req, document, requestedField) {
  const ownerField = getOwnerField(req, requestedField)
  const now = new Date()
  const record = { ...document }

  if (ownerField) {
    const ownerUid = req.user?.role === 'admin' ? record[ownerField] : req.user.uid
    if (typeof ownerUid !== 'string' || !ownerUid) {
      const error = new Error(`A valid ${ownerField} is required to create this record`)
      error.status = 400
      error.code = 'OWNER_UID_REQUIRED'
      throw error
    }
    record[ownerField] = ownerUid
  } else if (req.user?.role !== 'admin') {
    const error = new Error('A recognized user role is required to create this record')
    error.status = 403
    error.code = 'OWNERSHIP_CONTEXT_REQUIRED'
    throw error
  }

  return {
    ...record,
    status: record.status || 'active',
    createdAt: now,
    updatedAt: now,
  }
}
