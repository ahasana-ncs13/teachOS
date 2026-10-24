/**
 * Security headers middleware (Native lightweight Helmet equivalent).
 */
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('X-XSS-Protection', '0')
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
}

/**
 * Lightweight in-memory rate limiter.
 * Applies stricter limits on write mutations (POST, PUT, PATCH, DELETE) vs read requests (GET).
 */
const rateLimitMap = new Map()

// Cleanup old entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now()
  for (const [key, record] of rateLimitMap.entries()) {
    if (now - record.startTime > 60000) {
      rateLimitMap.delete(key)
    }
  }
}, 300000)

export function rateLimiter(options = {}) {
  const windowMs = options.windowMs || 60000 // 1 minute
  const maxRead = options.maxRead || 150     // 150 reads / minute
  const maxWrite = options.maxWrite || 40    // 40 writes / minute

  return (req, res, next) => {
    // Skip health check from rate limiting
    if (req.path === '/health') return next()

    const ip = req.ip || req.connection.remoteAddress || 'unknown-ip'
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    const key = `${ip}:${isWrite ? 'write' : 'read'}`
    const limit = isWrite ? maxWrite : maxRead
    const now = Date.now()

    let record = rateLimitMap.get(key)
    if (!record || now - record.startTime > windowMs) {
      record = { startTime: now, count: 1 }
      rateLimitMap.set(key, record)
      return next()
    }

    record.count += 1
    if (record.count > limit) {
      res.setHeader('Retry-After', Math.ceil((windowMs - (now - record.startTime)) / 1000))
      return res.status(429).json({
        message: 'Too many requests. Please slow down.',
        code: 'RATE_LIMIT_EXCEEDED',
      })
    }

    next()
  }
}
