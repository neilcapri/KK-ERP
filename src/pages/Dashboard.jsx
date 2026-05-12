import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

export default function Dashboard() {
  const { profile, isAdmin } = useAuth()
  const [stats, setStats] = useState({ totalFG: 0, lowFG: 0, deficitFG: 0, totalRM: 0, lowRM: 0, outRM: 0, todayDispatches: 0, todayProduction: 0 })
  const [recentActivity, setRecentActivity] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    try {
      const [products, rms, activity, dispatches, productions] = await Promise.all([
        supabase.from('products').select('code,units,min_stock'),
        supabase.from('raw_materials').select('name,stock,min_stock'),
        supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(8),
        supabase.from('dispatches').select('id,created_at').gte('created_at', new Date().toISOString().split('T')[0]),
        supabase.from('productions').select('id,created_at').gte('created_at', new Date().toISOString().split('T')[0]),
      ])

      const fg = products.data || []
      const rm = rms.data || []

      const newAlerts = []
      fg.filter(p => p.units <= 0).forEach(p => newAlerts.push({ type: 'red', msg: `${p.code} is out of stock` }))
      fg.filter(p => p.units > 0 && p.units <= p.min_stock).forEach(p => newAlerts.push({ type: 'amber', msg: `${p.code} is low — ${p.units} units` }))
      rm.filter(r => r.stock <= 0).slice(0, 5).forEach(r => newAlerts.push({ type: 'red', msg: `RM: ${r.name} is out of stock` }))

      setStats({
        totalFG: fg.reduce((s, p) => s + Math.max(0, p.units), 0),
        lowFG: fg.filter(p => p.units > 0 && p.units <= p.min_stock).length,
        deficitFG: fg.filter(p => p.units <= 0).length,
        totalRM: rm.length,
        lowRM: rm.filter(r => r.stock > 0 && r.stock <= r.min_stock).length,
        outRM: rm.filter(r => r.stock <= 0).length,
        todayDispatches: dispatches.data?.length || 0,
        todayProduction: productions.data?.length || 0,
      })
      setRecentActivity(activity.data || [])
      setAlerts(newAlerts.slice(0, 6))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const icons = { dispatch: '📋', production: '🏭', sourcing: '📥', stock: '📦' }
  const today = new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  if (loading) return <div style={{ padding: 24 }}><div className="spinner" style={{ borderTopColor: 'var(--ink)', borderColor: 'var(--border)' }} /></div>

  return (
    <>
      <div className="page-header">
        <div>
          <h2>DASHBOARD</h2>
          <p>{today}</p>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink3)' }}>
          Welcome back, <strong style={{ color: 'var(--ink)' }}>{profile?.name}</strong>
        </div>
      </div>

      <div className="page-body">
        {/* Alerts */}
        {alerts.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            {alerts.slice(0, 3).map((a, i) => (
              <div key={i} className={`alert alert-${a.type}`}>
                {a.type === 'red' ? '🔴' : '⚠️'} {a.msg}
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="grid4" style={{ marginBottom: 20 }}>
          <div className="stat green">
            <div className="stat-label">FG Units</div>
            <div className="stat-value">{stats.totalFG.toLocaleString()}</div>
            <div className="stat-sub">{stats.deficitFG} out · {stats.lowFG} low</div>
          </div>
          <div className="stat amber">
            <div className="stat-label">RM Items</div>
            <div className="stat-value">{stats.totalRM}</div>
            <div className="stat-sub">{stats.outRM} out · {stats.lowRM} low</div>
          </div>
          <div className="stat blue">
            <div className="stat-label">Today Dispatches</div>
            <div className="stat-value">{stats.todayDispatches}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Today Production</div>
            <div className="stat-value">{stats.todayProduction}</div>
          </div>
        </div>

        <div className="grid2">
          {/* Quick Actions */}
          <div className="card">
            <div className="card-title">Quick Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(profile?.role === 'admin' || profile?.role === 'dispatch') && (
                <Link to="/dispatch" className="btn btn-primary btn-full">📋 New Dispatch</Link>
              )}
              {(profile?.role === 'admin' || profile?.role === 'kitchen') && (
                <Link to="/production" className="btn btn-green btn-full">🏭 Log Production</Link>
              )}
              {(profile?.role === 'admin' || profile?.role === 'dispatch') && (
                <Link to="/sourcing" className="btn btn-amber btn-full">📥 Log Sourcing</Link>
              )}
              <Link to="/inventory" className="btn btn-secondary btn-full">📦 View Inventory</Link>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="card">
            <div className="card-title">
              Recent Activity
              <Link to="/activity" style={{ fontSize: 10, color: 'var(--ink3)', textDecoration: 'none' }}>View all →</Link>
            </div>
            {recentActivity.length === 0 ? (
              <div style={{ color: 'var(--ink3)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>No activity yet</div>
            ) : (
              recentActivity.map(a => (
                <div key={a.id} className="activity-item" style={{ padding: '10px 0' }}>
                  <div className={`activity-icon ${a.type}`}>{icons[a.type] || '•'}</div>
                  <div className="activity-body">
                    <div className="activity-title" style={{ fontSize: 12 }}>{a.title}</div>
                    <div className="activity-meta">
                      {a.description} · {new Date(a.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })} · {a.created_by_name}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  )
}
