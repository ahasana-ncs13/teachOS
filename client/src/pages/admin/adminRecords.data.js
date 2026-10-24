export const COMMISSION_RATE = 0.05

export const teacherEarningRecords = [
  { id: 1, name: 'Dr. K. Rahman', department: 'Physics', earned: 42000, status: 'paid' },
  { id: 2, name: 'Eng. Anisul Haque', department: 'Computer Science', earned: 58500, status: 'processing' },
  { id: 3, name: 'Sarah Jenkins', department: 'English (IELTS)', earned: 31500, status: 'paid' },
  { id: 4, name: 'Master M. Hossain', department: 'Mathematics', earned: 49000, status: 'failed' },
  { id: 5, name: 'Dr. Nusrat Jahan', department: 'Biology', earned: 24000, status: 'paid' },
]

export const formatTaka = (amount) => `৳${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
export const getInitials = (name) => name.replace(/^(Dr\.|Eng\.|Prof\.)\s*/, '').split(' ').map((part) => part[0]).join('').slice(0, 2)
