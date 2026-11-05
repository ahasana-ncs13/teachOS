import axios from 'axios'

let authTokenProvider
let forceRefreshTokenProvider

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
})

export function setAuthTokenProvider(provider, forceRefreshProvider) {
  authTokenProvider = provider
  forceRefreshTokenProvider = forceRefreshProvider
}

// Attach token to every request
api.interceptors.request.use(async (config) => {
  const token = await authTokenProvider?.()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401, retry once with a force-refreshed token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    if (
      error.response?.status === 401 &&
      !original._retried &&
      forceRefreshTokenProvider
    ) {
      original._retried = true
      try {
        const freshToken = await forceRefreshTokenProvider()
        if (freshToken) {
          original.headers.Authorization = `Bearer ${freshToken}`
          return api(original)
        }
      } catch {
        // force-refresh failed — fall through to original error
      }
    }
    return Promise.reject(error)
  },
)
