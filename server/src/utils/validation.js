import { ObjectId } from 'mongodb'

/**
 * Validate that a string is a valid 24-character hex MongoDB ObjectId.
 */
export function isValidObjectId(id) {
  if (!id || typeof id !== 'string') return false
  return /^[0-9a-fA-F]{24}$/.test(id)
}

/**
 * Parse and return an ObjectId or throw a 400 error.
 */
export function parseObjectId(id, fieldName = 'id') {
  if (!isValidObjectId(id)) {
    const error = new Error(`Invalid ${fieldName}: must be a 24-character hexadecimal ID`)
    error.status = 400
    error.code = 'INVALID_OBJECT_ID'
    throw error
  }
  return new ObjectId(id)
}

/**
 * Prevent NoSQL operator injection by rejecting keys with '$' or '.'
 */
export function assertNoOperatorInjection(obj) {
  if (!obj || typeof obj !== 'object') return
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      const error = new Error(`Invalid property key '${key}': operators are forbidden`)
      error.status = 400
      error.code = 'OPERATOR_INJECTION_REJECTED'
      throw error
    }
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      assertNoOperatorInjection(obj[key])
    }
  }
}

/**
 * Strict object sanitizer:
 * - Checks for operator injection
 * - Rejects any fields not in allowedFields whitelist
 */
export function sanitizeInput(data, allowedFields = []) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const error = new Error('Request body must be a JSON object')
    error.status = 400
    error.code = 'INVALID_BODY'
    throw error
  }

  assertNoOperatorInjection(data)

  const allowedSet = new Set(allowedFields)
  for (const key of Object.keys(data)) {
    if (!allowedSet.has(key)) {
      const error = new Error(`Unknown field: '${key}' is not allowed`)
      error.status = 400
      error.code = 'UNKNOWN_FIELD'
      throw error
    }
  }

  return { ...data }
}

/**
 * Validate pagination parameters with strict bounds.
 * Default limit = 20, Maximum limit = 100.
 */
export function validatePagination(query = {}) {
  assertNoOperatorInjection(query)

  const rawPage = Number.parseInt(query.page, 10)
  const rawLimit = Number.parseInt(query.limit, 10)

  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
  let limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 20
  if (limit > 100) limit = 100

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  }
}

/**
 * Helper to validate field types and required constraints.
 */
export function validateSchema(data, schema) {
  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field]

    if (rules.required && (value === undefined || value === null || value === '')) {
      const error = new Error(`Field '${field}' is required`)
      error.status = 400
      error.code = 'FIELD_REQUIRED'
      throw error
    }

    if (value !== undefined && value !== null) {
      if (rules.type === 'string' && typeof value !== 'string') {
        const error = new Error(`Field '${field}' must be a string`)
        error.status = 400
        error.code = 'INVALID_TYPE'
        throw error
      }
      if (rules.type === 'number' && typeof value !== 'number') {
        const error = new Error(`Field '${field}' must be a number`)
        error.status = 400
        error.code = 'INVALID_TYPE'
        throw error
      }
      if (rules.type === 'boolean' && typeof value !== 'boolean') {
        const error = new Error(`Field '${field}' must be a boolean`)
        error.status = 400
        error.code = 'INVALID_TYPE'
        throw error
      }
      if (rules.enum && !rules.enum.includes(value)) {
        const error = new Error(`Field '${field}' must be one of: ${rules.enum.join(', ')}`)
        error.status = 400
        error.code = 'INVALID_ENUM'
        throw error
      }
      if (rules.min !== undefined && typeof value === 'string' && value.trim().length < rules.min) {
        const error = new Error(`Field '${field}' must have at least ${rules.min} characters`)
        error.status = 400
        error.code = 'MIN_LENGTH'
        throw error
      }
      if (rules.max !== undefined && typeof value === 'string' && value.trim().length > rules.max) {
        const error = new Error(`Field '${field}' cannot exceed ${rules.max} characters`)
        error.status = 400
        error.code = 'MAX_LENGTH'
        throw error
      }
    }
  }
}
