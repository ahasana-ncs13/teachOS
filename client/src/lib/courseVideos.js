import { api } from './api'

export async function uploadCourseVideo(listingId, file, onUploadProgress) {
  const { data } = await api.post(
    `/course-management/${encodeURIComponent(listingId)}/videos`,
    file,
    {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
      },
      onUploadProgress,
    },
  )
  return data.video
}
