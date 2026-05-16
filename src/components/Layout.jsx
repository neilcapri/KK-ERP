import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ChatWidget from './ChatWidget'

const navItems = [
  { to: '/', icon: '⚡', label: 'Dashboard', roles: ['admin','kitchen','analyst','dispatch'] },
  { to: '/inventory', icon: '📦', label: 'Inventory', roles: ['admin','kitchen','analyst','dispatch'] },
  { to: '/production', icon: '🏭', label: 'Production', roles: ['admin','analyst','kitchen'] },
  { to: '/dispatch', icon: '📋', label: 'Dispatch', roles: ['admin','kitchen','analyst','dispatch'] },
  { to: '/sourcing', icon: '📥', label: 'Sourcing', roles: ['admin','kitchen','analyst','dispatch'] },
  { to: '/activity', icon: '🕐', label: 'Activity', roles: ['admin','kitchen','analyst','dispatch'] },
  { to: '/reports', icon: '📊', label: 'Reports', roles: ['admin','analyst'] },
  { to: '/time-tracking', icon: '⏱', label: 'Time Tracking', roles: ['admin','kitchen','staff'] },
  { to: '/orders', icon: '🛒', label: 'Orders', roles: ['admin'] },
]

export default function Layout() {
  const { profile, signOut, isAdmin } = useAuth()
  const navigate = useNavigate()
  const visibleItems = navItems.filter(item => item.roles.includes(profile?.role))

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="app-layout">
      {/* Desktop Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>KK ERP</h1>
          <p>Konscious Kitchen</p>
        </div>
        <nav className="sidebar-nav">
          {visibleItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <strong>{profile?.name || 'User'}</strong>
            {profile?.role?.toUpperCase()}
          </div>
          <button className="btn btn-secondary btn-sm btn-full" onClick={handleSignOut}>Sign Out</button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="main-content">
        <Outlet />
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="bottom-nav">
        {visibleItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `bnav-item ${isActive ? 'active' : ''}`}
          >
            <span className="bi">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
        <button className="bnav-item" onClick={handleSignOut} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <span className="bi">🚪</span>
          Sign Out
        </button>
      </nav>

      {/* AI Chat Widget */}
      <ChatWidget />
    </div>
  )
}
