import { api } from './api.js'

export const bkashApi = {
  create: (listingId) => api.post('/bkash/create', { listingId }),
  mobile: (paymentID, mobileNumber) => api.post('/bkash/mobile', { paymentID, mobileNumber }),
  otp: (paymentID, otp) => api.post('/bkash/otp', { paymentID, otp }),
  execute: (paymentID, pin, mobileNumber) => api.post('/bkash/execute', { paymentID, pin, mobileNumber }),
  query: (paymentID) => api.get(`/bkash/query/${paymentID}`),
}
