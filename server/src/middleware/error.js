/**
 * Centralized error handling middleware.
 * Ensures all errors conform to the structure: { message: string, code: string }
 * Suppresses stack traces in client responses to protect internals.
 */
export function errorHandler(err, _req, res, _next) {
  const status = typeof err.status === 'number' && err.status >= 400 && err.status < 600
    ? err.status
    : typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
      ? err.statusCode
      : 500

  const code = err.code || (status === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST')
  const message = err.message || 'An unexpected error occurred'

  if (status >= 500) {
    console.error(`[Internal Error] ${code}:`, err)
  }

  res.status(status).json({
    message,
    code,
  })
}

/**
 * 404 handler for API routes.
 */
export function notFoundHandler(_req, res) {
  res.status(404).json({
    message: 'The requested API endpoint does not exist',
    code: 'ROUTE_NOT_FOUND',
  })
}
