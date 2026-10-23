import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/useAuth'
import Dashboard from './pages/Dashboard'
import { AttendancePage, ClassesPage, DirectoryPage, PaymentsPage, QuickActionsPage } from './pages/WorkspacePages'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'

function App() {
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<Register />} />
    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
    <Route path="/dashboard/attendance" element={<ProtectedRoute><AttendancePage /></ProtectedRoute>} />
    <Route path="/dashboard/classes" element={<ProtectedRoute><ClassesPage /></ProtectedRoute>} />
    <Route path="/dashboard/directory" element={<ProtectedRoute><DirectoryPage /></ProtectedRoute>} />
    <Route path="/dashboard/payments" element={<ProtectedRoute><PaymentsPage /></ProtectedRoute>} />
    <Route path="/dashboard/actions" element={<ProtectedRoute><QuickActionsPage /></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}

function ProtectedRoute({ children }) {
  const { user, authLoading } = useAuth()
  if (authLoading) return <div className="route-loading">Restoring your TeachOS session...</div>
  return user ? children : <Navigate to="/login" replace />
}

export default App
