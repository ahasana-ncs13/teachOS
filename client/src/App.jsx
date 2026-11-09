import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/useAuth'
import Dashboard from './pages/Dashboard'
import { AttendancePage, ClassesPage, DirectoryPage, PaymentsPage, QuickActionsPage } from './pages/WorkspacePages'
import TeacherListingsPage from './pages/TeacherListingsPage'
import CourseManagementPage from './pages/CourseManagementPage'
import Home from './pages/Home'
import LegalPage from './pages/LegalPage'
import Login from './pages/Login'
import Register from './pages/Register'
import './App.css'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminClasses from './pages/admin/AdminClasses'
import AdminDirectory from './pages/admin/AdminDirectory'
import AdminPayments from './pages/admin/AdminPayments'
import AdminAttendance from './pages/admin/AdminAttendance'
import AdminSettings from './pages/admin/AdminSettings'
import ErrorPage from './pages/ErrorPage'
import ErrorBoundary from './components/ErrorBoundary'
import { StudentAssignments, StudentAttendance, StudentClasses, StudentDashboard, StudentPayments } from './pages/StudentPortal'
import StudentLearningPage from './pages/StudentLearningPage'
import { PaymentSuccess } from './pages/PaymentSuccess'
import BkashReturn from './pages/BkashReturn'
import { TeacherClassesPage } from './pages/TeacherStudioPages'

function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/terms-of-service" element={<LegalPage document="terms" />} />
        <Route path="/privacy-policy" element={<LegalPage document="privacy" />} />
        <Route path="/dashboard" element={<ProtectedRoute role="teacher"><Dashboard /></ProtectedRoute>} />
        <Route path="/student" element={<ProtectedRoute role="student"><StudentDashboard /></ProtectedRoute>} />
        <Route path="/student/course/:listingId/learn" element={<ProtectedRoute role="student"><StudentLearningPage /></ProtectedRoute>} />
        <Route path="/student/classes" element={<ProtectedRoute role="student"><StudentClasses /></ProtectedRoute>} />
        <Route path="/student/attendance" element={<ProtectedRoute role="student"><StudentAttendance /></ProtectedRoute>} />
        <Route path="/student/assignments" element={<ProtectedRoute role="student"><StudentAssignments /></ProtectedRoute>} />
        <Route path="/student/payments" element={<ProtectedRoute role="student"><StudentPayments /></ProtectedRoute>} />
        <Route path="/student/payment/success" element={<ProtectedRoute role="student"><PaymentSuccess /></ProtectedRoute>} />
        <Route path="/student/payment/bkash-return" element={<ProtectedRoute role="student"><BkashReturn /></ProtectedRoute>} />
        <Route path="/student/payment/cancel" element={<ProtectedRoute role="student"><Navigate to="/student/classes?payment=cancelled" replace /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
        <Route path="/admin/classes" element={<ProtectedRoute role="admin"><AdminClasses /></ProtectedRoute>} />
        <Route path="/admin/directory" element={<ProtectedRoute role="admin"><AdminDirectory /></ProtectedRoute>} />
        <Route path="/admin/payments" element={<ProtectedRoute role="admin"><AdminPayments /></ProtectedRoute>} />
        <Route path="/admin/attendance" element={<ProtectedRoute role="admin"><AdminAttendance /></ProtectedRoute>} />
        <Route path="/admin/records" element={<ProtectedRoute role="admin"><Navigate to="/admin/payments" replace /></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute role="admin"><AdminSettings /></ProtectedRoute>} />
        <Route path="/dashboard/attendance" element={<ProtectedRoute role="teacher"><AttendancePage /></ProtectedRoute>} />
        <Route path="/dashboard/listings" element={<ProtectedRoute role="teacher"><TeacherListingsPage /></ProtectedRoute>} />
<Route path="/dashboard/course/:listingId" element={<ProtectedRoute role="teacher"><CourseManagementPage /></ProtectedRoute>} />
        <Route path="/dashboard/classes" element={<ProtectedRoute role="teacher"><ClassesPage /></ProtectedRoute>} />
        <Route path="/dashboard/teaching-studio" element={<ProtectedRoute role="teacher"><TeacherClassesPage /></ProtectedRoute>} />
        <Route path="/dashboard/recorded-classes" element={<ProtectedRoute role="teacher"><TeacherClassesPage defaultType="recorded" /></ProtectedRoute>} />
        <Route path="/dashboard/live-classes" element={<ProtectedRoute role="teacher"><TeacherClassesPage defaultType="live" /></ProtectedRoute>} />
        <Route path="/dashboard/directory" element={<ProtectedRoute role="teacher"><DirectoryPage /></ProtectedRoute>} />
        <Route path="/dashboard/payments" element={<ProtectedRoute role="teacher"><PaymentsPage /></ProtectedRoute>} />
        <Route path="/dashboard/actions" element={<ProtectedRoute role="teacher"><QuickActionsPage /></ProtectedRoute>} />
        <Route path="*" element={<ErrorPage />} />
      </Routes>
    </ErrorBoundary>
  )
}

function ProtectedRoute({ children, role }) {
  const { user, authLoading } = useAuth()
  if (authLoading) return <div className="route-loading">Restoring your TeachOS session...</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.role === role) return children
  if (user.role === 'admin') return <Navigate to="/admin" replace />
  if (user.role === 'teacher') return <Navigate to="/dashboard" replace />
  if (user.role === 'student') return <Navigate to="/student" replace />
  return <Navigate to="/" replace />
}

export default App
