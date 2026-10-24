import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/useAuth'
import Dashboard from './pages/Dashboard'
import { AttendancePage, ClassesPage, DirectoryPage, PaymentsPage, QuickActionsPage } from './pages/WorkspacePages'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import './App.css'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminClasses from './pages/admin/AdminClasses'
import AdminDirectory from './pages/admin/AdminDirectory'
import AdminPayments from './pages/admin/AdminPayments'
import AdminSettings from './pages/admin/AdminSettings'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/dashboard" element={<ProtectedRoute role="teacher"><Dashboard /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/classes" element={<ProtectedRoute role="admin"><AdminClasses /></ProtectedRoute>} />
      <Route path="/admin/directory" element={<ProtectedRoute role="admin"><AdminDirectory /></ProtectedRoute>} />
      <Route path="/admin/payments" element={<ProtectedRoute role="admin"><AdminPayments /></ProtectedRoute>} />
      <Route path="/admin/settings" element={<ProtectedRoute role="admin"><AdminSettings /></ProtectedRoute>} />
      <Route path="/dashboard/attendance" element={<ProtectedRoute role="teacher"><AttendancePage /></ProtectedRoute>} />
      <Route path="/dashboard/classes" element={<ProtectedRoute role="teacher"><ClassesPage /></ProtectedRoute>} />
      <Route path="/dashboard/directory" element={<ProtectedRoute role="teacher"><DirectoryPage /></ProtectedRoute>} />
      <Route path="/dashboard/payments" element={<ProtectedRoute role="teacher"><PaymentsPage /></ProtectedRoute>} />
      <Route path="/dashboard/actions" element={<ProtectedRoute role="teacher"><QuickActionsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function ProtectedRoute({ children, role }) {
  const { user, authLoading } = useAuth()
  if (authLoading) return <div className="route-loading">Restoring your TeachOS session...</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.role === role) return children
  if (user.role === 'admin') return <Navigate to="/admin" replace />
  if (user.role === 'teacher') return <Navigate to="/dashboard" replace />
  return <Navigate to="/" replace />
}

export default App
