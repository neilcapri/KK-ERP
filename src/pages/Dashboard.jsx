import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'

const ZONE_COLORS = {
  North:  { bg: '#E1F5EE', color: '#085041', label: 'North — Wed' },
  East:   { bg: '#E6F1FB', color: '#0C447C', label: 'East — Wed' },
  West:   { bg: '#FAEEDA', color: '#633806', label: 'West — Thu' },
  City:   { bg: '#EEEDFE', color: '#3C3489', label: 'City — Fri' },
  ONFC:   { bg: '#FCEBEB', color: '#791F1F', label: 'ONFC — Mon' },
  Float:  { bg: '#F1EFE8', color: '#444441', label: 'Float' },
}

function getWeekBounds() {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { monday, sunday }
}

function getTomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

export default function Dashboard() {
  const { profile, isAdmin, isKitchen } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  // Stats
  const [stats, setStats] = useState({ lowFG: 0, outFG: 0, lowRM: 0, outRM: 0, weekOrders: 0, packToday: 0 })

  // Overview data
  const [packList, setPackList] = useState([])
  const [alerts, setAlerts] = useState({ fgOut: [], fgLow: [], rmOut: [], rmLow: [] })
  const [activity, setActivity] = useState([])

  // Admin data
  const [weeklyRevenue, setWeeklyRevenue] = useState([])
  const [topSKUs, setTopSKUs] = useState([])
  const [topCustomers, setTopCustomers] = useState([])

  // Schedule tab
  const [schedule, setSchedule] = useState({ Monday: [], Wednesday: [], Thursday: [], Friday: [], Flexible: [] })

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    setLoading(true)
    try {
      const tomorrow = getTomorrow()
      const { monday, sunday } = getWeekBounds()
      const weekStart = monday.toISOString().split('T')[0]
      const weekEnd = sunday.toISOString().split('T')[0]
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]

      const [
        fgRes, rmRes, actRes,
        packRes, weekOrdersRes,
        custRes,
      ] = await Promise.all([
        supabase.from('products').select('code,name,units,min_stock'),
        supabase.from('raw_materials').select('name,stock,min_stock').not('category','eq','Packaging').not('category','eq','WIP'),
        supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(6),
        supabase.from('orders').select('id,customer_name,dispatch_date,order_items(id)').eq('dispatch_date', tomorrow).neq('status','archived'),
        supabase.from('orders').select('id,dispatch_date,total_value,customer_name,order_items(id,quantity,packs,cases,packs_per_case,price_per_pack)').gte('dispatch_date', weekStart).lte('dispatch_date', weekEnd).neq('status','archived'),
        supabase.from('customers').select('name,zone,dispatch_day').not('zone','is',null),
      ])

      const fg = fgRes.data || []
      const rm = rmRes.data || []

      // Stats
      const fgOut = fg.filter(p => p.units <= 0)
      const fgLow = fg.filter(p => p.units > 0 && p.units <= p.min_stock)
      const rmOut = rm.filter(r => r.stock <= 0)
      const rmLow = rm.filter(r => r.stock > 0 && r.stock <= r.min_stock)
      const weekOrders = (weekOrdersRes.data || [])
      const packToday = (packRes.data || []).length

      setStats({
        outFG: fgOut.length, lowFG: fgLow.length,
        outRM: rmOut.length, lowRM: rmLow.length,
        weekOrders: weekOrders.length, packToday,
      })

      setAlerts({ fgOut, fgLow, rmOut: rmOut.slice(0,6), rmLow: rmLow.slice(0,6) })
      setPackList(packRes.data || [])
      setActivity(actRes.data || [])

      // Schedule — group customers by dispatch_day
      const sched = { Monday: [], Wednesday: [], Thursday: [], Friday: [], Flexible: [] }
      ;(custRes.data || []).forEach(c => {
        const day = c.dispatch_day || 'Flexible'
        if (sched[day]) sched[day].push(c)
        else sched['Flexible'].push(c)
      })
      setSchedule(sched)

      // Admin only — revenue + top SKUs + top customers
      if (isAdmin) {
        // Weekly revenue — last 5 weeks
        const weeks = []
        for (let i = 4; i >= 0; i--) {
          const wStart = new Date(monday); wStart.setDate(monday.getDate() - i * 7)
          const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 6)
          weeks.push({
            label: i === 0 ? 'This wk' : 'Wk -' + i,
            start: wStart.toISOString().split('T')[0],
            end: wEnd.toISOString().split('T')[0],
          })
        }

        const revenueData = await Promise.all(weeks.map(w =>
          supabase.from('orders')
            .select('order_items(packs,cases,packs_per_case,price_per_pack,quantity,units_per_pack)')
            .gte('dispatch_date', w.start)
            .lte('dispatch_date', w.end)
            .neq('status', 'archived')
        ))

        const wRevenue = weeks.map((w, i) => {
          const orders = revenueData[i].data || []
          let rev = 0
          orders.forEach(o => {
            ;(o.order_items || []).forEach(item => {
              const packs = item.packs || (item.cases ? item.cases * (item.packs_per_case || 6) : (item.quantity / (item.units_per_pack || 1)))
              rev += packs * (item.price_per_pack || 0)
            })
          })
          return { label: w.label, revenue: Math.round(rev) }
        })
        setWeeklyRevenue(wRevenue)

        // Top SKUs this month — from dispatch_items
        const { data: dispItems } = await supabase
          .from('dispatch_items')
          .select('product_code,product_name,units_dispatched,dispatches(date)')
          .gte('dispatches.date', monthStart)

        const skuMap = {}
        ;(dispItems || []).forEach(item => {
          if (!item.dispatches?.date) return
          const code = item.product_code || 'OTHER'
          if (!skuMap[code]) skuMap[code] = { code, name: item.product_name || code, units: 0 }
          skuMap[code].units += item.units_dispatched || 0
        })
        const topSKUList = Object.values(skuMap).sort((a, b) => b.units - a.units).slice(0, 5)
        setTopSKUs(topSKUList)

        // Top customers this month — from orders
        const { data: monthOrders } = await supabase
          .from('orders')
          .select('customer_name,order_items(packs,cases,packs_per_case,price_per_pack,quantity,units_per_pack)')
          .gte('dispatch_date', monthStart)
          .neq('status', 'archived')

        const custMap = {}
        ;(monthOrders || []).forEach(o => {
          if (!custMap[o.customer_name]) custMap[o.customer_name] = { name: o.customer_name, revenue: 0, orders: 0 }
          custMap[o.customer_name].orders++
          ;(o.order_items || []).forEach(item => {
            const packs = item.packs || (item.cases ? item.cases * (item.packs_per_case || 6) : (item.quantity / (item.units_per_pack || 1)))
            custMap[o.customer_name].revenue += packs * (item.price_per_pack || 0)
          })
        })
        const topCustList = Object.values(custMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10)
        setTopCustomers(topCustList)
      }

    } catch(e) { console.error(e) }
    setLoading(false)
  }

  const today = new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const icons = { dispatch: '📋', production: '🏭', sourcing: '📥', stock: '📦', order: '🛒' }

  const maxRevenue = Math.max(...weeklyRevenue.map(w => w.revenue), 1)
  const maxSKU = topSKUs[0]?.units || 1
  const maxCust = topCustomers[0]?.revenue || 1

  const tabStyle = (key) => ({
    padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
    fontFamily: 'var(--display)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase',
    color: activeTab === key ? 'var(--ink)' : 'var(--ink3)',
    borderBottom: activeTab === key ? '2px solid var(--kk-green)' : '2px solid transparent',
    marginBottom: -1,
  })

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
      <div className="spinner" style={{ borderTopColor: 'var(--kk-green)', borderColor: 'var(--border)' }} />
    </div>
  )

  return (
    <>
      <div className="page-header">
        <div><h2>DASHBOARD</h2><p>{today}</p></div>
        <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink3)' }}>
          Welcome back, <strong style={{ color: 'var(--ink)' }}>{profile?.name}</strong>
        </div>
      </div>

      <div className="page-body">

        {/* ── Stat cards ── */}
        <div className="grid4" style={{ marginBottom: 16 }}>
          <div className="stat amber" style={{ cursor: 'pointer' }} onClick={() => navigate('/inventory')}>
            <div className="stat-label">FG Stock Alerts</div>
            <div className="stat-value" style={{ color: stats.outFG > 0 ? 'var(--red)' : 'var(--amber)' }}>
              {stats.outFG + stats.lowFG}
            </div>
            <div className="stat-sub">{stats.outFG} out · {stats.lowFG} low · tap to view</div>
          </div>
          <div className="stat amber" style={{ cursor: 'pointer' }} onClick={() => navigate('/inventory')}>
            <div className="stat-label">RM Stock Alerts</div>
            <div className="stat-value" style={{ color: stats.outRM > 0 ? 'var(--red)' : 'var(--amber)' }}>
              {stats.outRM + stats.lowRM}
            </div>
            <div className="stat-sub">{stats.outRM} out · {stats.lowRM} low · tap to view</div>
          </div>
          <div className="stat blue">
            <div className="stat-label">Orders This Week</div>
            <div className="stat-value">{stats.weekOrders}</div>
            <div className="stat-sub">active orders</div>
          </div>
          <div className="stat green" style={{ cursor: 'pointer' }} onClick={() => navigate('/orders')}>
            <div className="stat-label">Pack Today</div>
            <div className="stat-value" style={{ color: stats.packToday > 0 ? 'var(--kk-green)' : 'var(--ink3)' }}>
              {stats.packToday}
            </div>
            <div className="stat-sub">dispatch tomorrow</div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
          <button style={tabStyle('overview')} onClick={() => setActiveTab('overview')}>Overview</button>
          <button style={tabStyle('schedule')} onClick={() => setActiveTab('schedule')}>Delivery Schedule</button>
          {isAdmin && <button style={tabStyle('performance')} onClick={() => setActiveTab('performance')}>Performance</button>}
        </div>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="grid2">
            {/* Pack today */}
            <div className="card">
              <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                Pack today — dispatch tomorrow
                <span style={{ fontSize: 10, background: 'var(--blue-l)', color: 'var(--blue)', padding: '2px 8px', borderRadius: 4 }}>
                  {packList.length} orders
                </span>
              </div>
              {packList.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', padding: '20px 0' }}>No orders to pack tomorrow</div>
              ) : packList.map(o => (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                  <span style={{ fontSize: 14 }}>📦</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{o.customer_name}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{o.order_items?.length || 0} items</span>
                </div>
              ))}
              {packList.length > 0 && (
                <Link to="/orders" style={{ display: 'block', marginTop: 10, fontSize: 11, color: 'var(--kk-green)', textDecoration: 'none', textAlign: 'center' }}>
                  View all orders →
                </Link>
              )}
            </div>

            {/* Stock alerts + Activity */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card">
                <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  Stock alerts
                  <Link to="/inventory" style={{ fontSize: 10, color: 'var(--ink3)', textDecoration: 'none' }}>View inventory →</Link>
                </div>
                {alerts.fgOut.length > 0 && (
                  <div style={{ background: 'var(--red-l)', padding: '7px 10px', borderRadius: 6, marginBottom: 6, fontSize: 12, color: 'var(--red)' }}>
                    🔴 <strong>FG out:</strong> {alerts.fgOut.map(p => p.code).join(', ')}
                  </div>
                )}
                {alerts.fgLow.length > 0 && (
                  <div style={{ background: 'var(--amber-l)', padding: '7px 10px', borderRadius: 6, marginBottom: 6, fontSize: 12, color: 'var(--amber)' }}>
                    ⚠️ <strong>FG low:</strong> {alerts.fgLow.map(p => p.code).join(', ')}
                  </div>
                )}
                {alerts.rmOut.length > 0 && (
                  <div style={{ background: 'var(--red-l)', padding: '7px 10px', borderRadius: 6, marginBottom: 6, fontSize: 12, color: 'var(--red)' }}>
                    🌿 <strong>RM out:</strong> {alerts.rmOut.map(r => r.name).join(', ')}
                  </div>
                )}
                {alerts.rmLow.length > 0 && (
                  <div style={{ background: 'var(--amber-l)', padding: '7px 10px', borderRadius: 6, fontSize: 12, color: 'var(--amber)' }}>
                    🌿 <strong>RM low:</strong> {alerts.rmLow.map(r => r.name).join(', ')}
                  </div>
                )}
                {!alerts.fgOut.length && !alerts.fgLow.length && !alerts.rmOut.length && !alerts.rmLow.length && (
                  <div style={{ fontSize: 12, color: 'var(--green)', textAlign: 'center', padding: '12px 0' }}>✅ All stock levels healthy</div>
                )}
              </div>

              <div className="card">
                <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  Recent activity
                  <Link to="/activity" style={{ fontSize: 10, color: 'var(--ink3)', textDecoration: 'none' }}>View all →</Link>
                </div>
                {activity.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', padding: '16px 0' }}>No activity yet</div>
                ) : activity.map(a => (
                  <div key={a.id} className="activity-item" style={{ padding: '8px 0' }}>
                    <div className={'activity-icon ' + a.type}>{icons[a.type] || '•'}</div>
                    <div className="activity-body">
                      <div className="activity-title" style={{ fontSize: 12 }}>{a.title}</div>
                      <div className="activity-meta">
                        {a.description} · {new Date(a.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })} · {a.created_by_name}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── DELIVERY SCHEDULE TAB ── */}
        {activeTab === 'schedule' && (
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 16 }}>
              Customers grouped by delivery route and dispatch day.
            </div>
            <div className="grid2">
              {[
                { day: 'Monday', zones: ['ONFC'] },
                { day: 'Wednesday', zones: ['North', 'East'] },
                { day: 'Thursday', zones: ['West'] },
                { day: 'Friday', zones: ['City'] },
              ].map(({ day, zones }) => {
                const dayCustomers = schedule[day] || []
                return (
                  <div key={day} className="card">
                    <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      {day}
                      <span style={{ fontSize: 10, background: 'var(--surface2)', padding: '2px 8px', borderRadius: 4, color: 'var(--ink3)' }}>
                        {dayCustomers.length} customers
                      </span>
                    </div>
                    {zones.map(zone => {
                      const zoneCusts = dayCustomers.filter(c => c.zone === zone)
                      if (!zoneCusts.length) return null
                      const zc = ZONE_COLORS[zone] || ZONE_COLORS.Float
                      return (
                        <div key={zone} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 10, fontFamily: 'var(--display)', letterSpacing: 2, textTransform: 'uppercase', color: zc.color, background: zc.bg, padding: '3px 8px', borderRadius: 4, display: 'inline-block', marginBottom: 6 }}>
                            {zone}
                          </div>
                          {zoneCusts.map(c => (
                            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                              <span style={{ flex: 1, color: 'var(--ink)' }}>{c.name}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                    {dayCustomers.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', padding: '12px 0' }}>No customers assigned</div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Float */}
            {(schedule['Flexible'] || []).length > 0 && (
              <div className="card" style={{ marginTop: 16 }}>
                <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  Float — Flexible dispatch
                  <span style={{ fontSize: 10, background: 'var(--surface2)', padding: '2px 8px', borderRadius: 4, color: 'var(--ink3)' }}>
                    {(schedule['Flexible'] || []).length} customers
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2px 12px' }}>
                  {(schedule['Flexible'] || []).map(c => (
                    <div key={c.name} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)', color: 'var(--ink2)' }}>
                      {c.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PERFORMANCE TAB (admin only) ── */}
        {activeTab === 'performance' && isAdmin && (
          <div>
            <div className="grid2" style={{ marginBottom: 16 }}>
              {/* Weekly revenue */}
              <div className="card">
                <div className="card-title">Weekly revenue — last 5 weeks</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120, paddingTop: 8 }}>
                  {weeklyRevenue.map((w, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: 10, color: 'var(--ink3)', fontFamily: 'var(--mono)' }}>
                        ${w.revenue >= 1000 ? (w.revenue / 1000).toFixed(1) + 'k' : w.revenue}
                      </div>
                      <div style={{
                        width: '100%',
                        height: Math.max(4, Math.round((w.revenue / maxRevenue) * 90)) + 'px',
                        background: i === weeklyRevenue.length - 1 ? 'var(--kk-green)' : 'var(--green-l)',
                        borderRadius: '3px 3px 0 0',
                        transition: 'height 0.3s',
                      }} />
                      <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{w.label}</div>
                    </div>
                  ))}
                </div>
                {weeklyRevenue.length >= 2 && (() => {
                  const curr = weeklyRevenue[weeklyRevenue.length - 1]?.revenue || 0
                  const prev = weeklyRevenue[weeklyRevenue.length - 2]?.revenue || 1
                  const pct = Math.round(((curr - prev) / prev) * 100)
                  return (
                    <div style={{ marginTop: 8, fontSize: 11, color: pct >= 0 ? 'var(--green)' : 'var(--red)', textAlign: 'right' }}>
                      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% vs last week
                    </div>
                  )
                })()}
              </div>

              {/* Top SKUs */}
              <div className="card">
                <div className="card-title">Top SKUs — this month <span style={{ fontSize: 10, color: 'var(--ink3)', fontWeight: 400 }}>by units dispatched</span></div>
                {topSKUs.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', padding: '20px 0' }}>No dispatch data this month</div>
                ) : topSKUs.map((p, i) => (
                  <div key={p.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                    <span style={{ fontSize: 11, color: 'var(--ink3)', width: 14 }}>{i + 1}</span>
                    <span style={{ fontSize: 10, fontFamily: 'var(--mono)', background: 'var(--surface2)', padding: '2px 5px', borderRadius: 3, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{p.code}</span>
                    <span style={{ flex: 1, color: 'var(--ink)' }}>{p.name}</span>
                    <div style={{ width: 60, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: Math.round((p.units / maxSKU) * 100) + '%', background: 'var(--kk-green)', borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, minWidth: 32, textAlign: 'right' }}>{p.units}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top customers */}
            <div className="card">
              <div className="card-title">Top customers — this month <span style={{ fontSize: 10, color: 'var(--ink3)', fontWeight: 400 }}>by revenue</span></div>
              {topCustomers.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', padding: '20px 0' }}>No order data this month</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 24 }}>#</th>
                        <th>Customer</th>
                        <th>Orders</th>
                        <th>Revenue</th>
                        <th>% of Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topCustomers.map((c, i) => {
                        const totalRev = topCustomers.reduce((s, x) => s + x.revenue, 0)
                        const pct = totalRev > 0 ? (c.revenue / totalRev * 100) : 0
                        return (
                          <tr key={c.name}>
                            <td style={{ fontSize: 11, color: 'var(--ink3)' }}>{i + 1}</td>
                            <td style={{ fontWeight: 500 }}>{c.name}</td>
                            <td style={{ fontSize: 12 }}>{c.orders}</td>
                            <td style={{ fontFamily: 'var(--display)', color: 'var(--kk-green)', fontSize: 14 }}>
                              ${Math.round(c.revenue).toLocaleString()}
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 80, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: Math.round((c.revenue / maxCust) * 100) + '%', background: 'var(--kk-peach)', borderRadius: 2 }} />
                                </div>
                                <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{pct.toFixed(1)}%</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </>
  )
}
