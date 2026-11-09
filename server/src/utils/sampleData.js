export const LEGACY_SAMPLE_USER_UIDS = [
  'admin-teachos',
  'admin-dca',
  'teacher-rahman',
  'student-tanvir',
]

export const LEGACY_SAMPLE_USER_EMAILS = [
  'teachos-admin@teachos.com',
  'admin@teachos.com',
  'teacher@teachos.com',
  'student@teachos.com',
]

export const LEGACY_SAMPLE_LISTING_NAMES = [
  'HSC Physics 2026 Batch A',
  'Next.js & Fullstack React Bootcamp',
  'IELTS Academic Masterclass 8.0+',
  'Class 10 General Math Foundation',
  'Python & AI for Absolute Beginners',
  'Medical Admission Biology Drill',
]

export const LEGACY_SAMPLE_PLATFORM = { slug: 'dca', createdBy: 'system' }

export function excludeLegacySampleUsers(filter = {}) {
  return {
    $and: [
      filter,
      {
        uid: {
          $nin: LEGACY_SAMPLE_USER_UIDS,
          $not: /^demo-/,
        },
        email: {
          $nin: LEGACY_SAMPLE_USER_EMAILS,
          $not: /@demo\.teachos$/i,
        },
      },
    ],
  }
}
