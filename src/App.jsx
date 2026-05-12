import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Production from './pages/Production'
import Dispatch from './pages/Dispatch'
import { Sourcing, Activity, Reports } from './pages/Sourcing'

function ProtectedRoute({ children, roles }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && profile && !roles.includes(profile.role)) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/" replace />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="production" element={<ProtectedRoute roles={['admin','kitchen']}><Production /></ProtectedRoute>} />
        <Route path="dispatch" element={<ProtectedRoute roles={['admin','dispatch']}><Dispatch /></ProtectedRoute>} />
        <Route path="sourcing" element={<ProtectedRoute roles={['admin','dispatch']}><Sourcing /></ProtectedRoute>} />
        <Route path="activity" element={<Activity />} />
        <Route path="reports" element={<ProtectedRoute roles={['admin']}><Reports /></ProtectedRoute>} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
