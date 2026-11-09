// bKash has been removed. Redirect any legacy bKash return URLs to the student portal.
import { Navigate } from 'react-router-dom'

export default function BkashReturn() {
  return <Navigate to="/student/classes" replace />
}
