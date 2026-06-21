import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Production from './pages/Production'
import Dispatch from './pages/Dispatch'
import { Sourcing, Activity, Reports } from './pages/Sourcing'
import TimeTracking from './pages/TimeTracking'
import Orders from './pages/Orders'
import Expenses from './pages/Expenses'
import Costing from './pages/Costing'

function ProtectedRoute({ children, roles }) {
  const { user, profile, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && profile && !roles.includes(profile.role)) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  const { user, profile } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/" replace />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="production" element={<ProtectedRoute roles={['admin','kitchen']}><Production /></ProtectedRoute>} />
        <Route path="dispatch" element={<ProtectedRoute roles={['admin','kitchen']}><Dispatch /></ProtectedRoute>} />
        <Route path="sourcing" element={<ProtectedRoute roles={['admin','kitchen']}><Sourcing /></ProtectedRoute>} />
        <Route path="activity" element={<Activity />} />
        <Route path="reports" element={<ProtectedRoute roles={['admin','analyst']}><Reports /></ProtectedRoute>} />
        <Route path="time-tracking" element={<ProtectedRoute><TimeTracking user={user} employee={profile} /></ProtectedRoute>} />
        <Route path="orders" element={<ProtectedRoute roles={['admin','kitchen']}><Orders /></ProtectedRoute>} />
        <Route path="expenses" element={<ProtectedRoute roles={['admin']}><Expenses /></ProtectedRoute>} />
        <Route path="costing" element={<ProtectedRoute roles={['admin']}><Costing /></ProtectedRoute>} />
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
