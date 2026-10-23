import axios from 'axios'

let authTokenProvider

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
})

export function setAuthTokenProvider(provider) {
  authTokenProvider = provider
}

api.interceptors.request.use(async (config) => {
  const token = await authTokenProvider?.()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})