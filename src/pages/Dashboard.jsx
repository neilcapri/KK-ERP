import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Link, useNavigate } from 'react-router-dom'

const ZONE_COLORS = {
  North:  { bg: '#E1F5EE', color: '#085041' },
  East:   { bg: '#E6F1FB', color: '#0C447C' },
  West:   { bg: '#FAEEDA', color: '#633806' },
  City:   { bg: '#EEEDFE', color: '#3C3489' },
  ONFC:   { bg: '#FCEBEB', color: '#791F1F' },
  Float:  { bg: '#F1EFE8', color: '#444441' },
}

const DISPATCH_DAYS = ['Monday','Wednesday','Thursday','Friday']
const DAY_ZONES = {
  Monday:    ['ONFC'],
  Wednesday: ['North','East'],
  Thursday:  ['West'],
  Friday:    ['City'],
}

function getTomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

function getWeekBounds() {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0,0,0,0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23,59,59,999)
  return { monday, sunday }
}

export default function Dashboard() {
  const { profile, isAdmin, isKitchen } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('performance')

  const [stats, setStats]           = useState({ outFG:0, lowFG:0, outRM:0, lowRM:0, weekOrders:0, packToday:0 })
  const [packList, setPackList]     = useState([])
  const [alerts, setAlerts]         = useState({ fgOut:[], fgLow:[], rmOut:[], rmLow:[] })
  const [activity, setActivity]     = useState([])
  const [schedule, setSchedule]     = useState({})
  const [topSKUs, setTopSKUs]       = useState([])
  const [topCustomers, setTopCustomers] = useState([])
  const [weeklyRevenue, setWeeklyRevenue] = useState([])
  const [mapUnits, setMapUnits] = useState({ City:0, West:0, North:0, East:0, ONFC:0 })

  useEffect(() => { loadDashboard() }, [])

  async function loadDashboard() {
    setLoading(true)
    try {
      const tomorrow = getTomorrow()
      const { monday, sunday } = getWeekBounds()
      const weekStart = monday.toISOString().split('T')[0]
      const weekEnd   = sunday.toISOString().split('T')[0]
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]

      const [fgRes, rmRes, actRes, packRes, weekRes, custRes] = await Promise.all([
        supabase.from('products').select('code,name,units,min_stock'),
        supabase.from('raw_materials').select('name,stock,min_stock')
          .not('category','eq','Packaging').not('category','eq','WIP'),
        supabase.from('activity').select('*').order('created_at',{ ascending:false }).limit(6),
        supabase.from('orders').select('id,customer_name,dispatch_date,order_items(id)')
          .eq('dispatch_date', tomorrow).neq('status','archived'),
        supabase.from('orders').select('id,dispatch_date')
          .gte('dispatch_date', weekStart).lte('dispatch_date', weekEnd).neq('status','archived'),
        supabase.from('customers').select('name,zone,dispatch_day').not('zone','is',null),
      ])

      const fg = fgRes.data || []
      const rm = rmRes.data || []
      const fgOut = fg.filter(p => p.units <= 0)
      const fgLow = fg.filter(p => p.units > 0 && p.units <= p.min_stock)
      const rmOut = rm.filter(r => r.stock <= 0)
      const rmLow = rm.filter(r => r.stock > 0 && r.stock <= r.min_stock)

      setStats({
        outFG: fgOut.length, lowFG: fgLow.length,
        outRM: rmOut.length, lowRM: rmLow.length,
        weekOrders: (weekRes.data || []).length,
        packToday: (packRes.data || []).length,
      })
      setAlerts({ fgOut, fgLow, rmOut: rmOut.slice(0,8), rmLow: rmLow.slice(0,6) })
      setPackList(packRes.data || [])
      setActivity(actRes.data || [])

      // Schedule
      const sched = { Monday:[], Wednesday:[], Thursday:[], Friday:[], Flexible:[] }
      ;(custRes.data || []).forEach(c => {
        const day = c.dispatch_day || 'Flexible'
        if (sched[day]) sched[day].push(c)
        else sched.Flexible.push(c)
      })
      setSchedule(sched)

      // Top SKUs — from dispatch_items this month
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
      setTopSKUs(Object.values(skuMap).sort((a,b) => b.units - a.units).slice(0,8))

      // Top customers — orders this month
      const { data: monthOrders } = await supabase
        .from('orders')
        .select('customer_name,order_items(packs,cases,packs_per_case,price_per_pack,quantity,units_per_pack)')
        .gte('dispatch_date', monthStart)
        .neq('status','archived')

      const custMap = {}
      ;(monthOrders || []).forEach(o => {
        if (!custMap[o.customer_name]) custMap[o.customer_name] = { name: o.customer_name, revenue: 0, orders: 0 }
        custMap[o.customer_name].orders++
        ;(o.order_items || []).forEach(item => {
          const packs = item.packs || (item.cases ? item.cases * (item.packs_per_case || 6) : (item.quantity / (item.units_per_pack || 1)))
          custMap[o.customer_name].revenue += packs * (item.price_per_pack || 0)
        })
      })
      setTopCustomers(Object.values(custMap).sort((a,b) => b.orders - a.orders).slice(0,10))

      // Weekly revenue — admin only
      if (isAdmin) {
        const weeks = []
        for (let i = 4; i >= 0; i--) {
          const wStart = new Date(monday); wStart.setDate(monday.getDate() - i*7)
          const wEnd   = new Date(wStart); wEnd.setDate(wStart.getDate() + 6)
          weeks.push({ label: i === 0 ? 'This wk' : 'Wk -'+i, start: wStart.toISOString().split('T')[0], end: wEnd.toISOString().split('T')[0] })
        }
        const revData = await Promise.all(weeks.map(w =>
          supabase.from('orders')
            .select('order_items(packs,cases,packs_per_case,price_per_pack,quantity,units_per_pack)')
            .gte('dispatch_date', w.start).lte('dispatch_date', w.end).neq('status','archived')
        ))
        setWeeklyRevenue(weeks.map((w,i) => {
          let rev = 0
          ;(revData[i].data || []).forEach(o => {
            ;(o.order_items || []).forEach(item => {
              const packs = item.packs || (item.cases ? item.cases*(item.packs_per_case||6) : (item.quantity/(item.units_per_pack||1)))
              rev += packs * (item.price_per_pack || 0)
            })
          })
          return { label: w.label, revenue: Math.round(rev) }
        }))
      }

      // Zone units from dispatch_items this month
      const zoneMap = { City:0, West:0, North:0, East:0, ONFC:0 }
      const custZoneMap = {}
      ;(custRes.data || []).forEach(c => { if (c.zone) custZoneMap[c.name] = c.zone })

      const { data: zoneDisp } = await supabase
        .from('dispatch_items')
        .select('units_dispatched,dispatches(date,customer_name)')
        .gte('dispatches.date', monthStart)

      ;(zoneDisp || []).forEach(item => {
        const cname = item.dispatches?.customer_name
        const zone = custZoneMap[cname]
        if (zone && zoneMap[zone] !== undefined) zoneMap[zone] += item.units_dispatched || 0
        else if (cname?.toLowerCase().includes('ontario natural food')) zoneMap['ONFC'] += item.units_dispatched || 0
      })
      setMapUnits(zoneMap)

    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
  }, [])

  const today = new Date().toLocaleDateString('en-CA', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  const icons = { dispatch:'📋', production:'🏭', sourcing:'📥', stock:'📦', order:'🛒' }
  const maxSKU  = topSKUs[0]?.units || 1
  const maxCust = Math.max(...topCustomers.map(c => isAdmin ? c.revenue : c.orders), 1)
  const maxRev  = Math.max(...weeklyRevenue.map(w => w.revenue), 1)

  const tabStyle = (key) => ({
    padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
    fontFamily: 'var(--display)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase',
    color: activeTab === key ? 'var(--ink)' : 'var(--ink3)',
    borderBottom: activeTab === key ? '2px solid var(--kk-green)' : '2px solid transparent',
    marginBottom: -1,
  })

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:300 }}>
      <div className="spinner" style={{ borderTopColor:'var(--kk-green)', borderColor:'var(--border)' }} />
    </div>
  )

  return (
    <>
      <div className="page-header">
        <div><h2>DASHBOARD</h2><p>{today}</p></div>
        <div style={{ textAlign:'right', fontSize:11, color:'var(--ink3)' }}>
          Welcome back, <strong style={{ color:'var(--ink)' }}>{profile?.name}</strong>
        </div>
      </div>

      <div className="page-body">

        {/* ── Stat cards ── */}
        <div className="grid4" style={{ marginBottom:16 }}>
          <div className="stat" style={{ borderTop:'3px solid var(--red)', cursor:'pointer' }} onClick={() => navigate('/inventory')}>
            <div className="stat-label">FG Stock Alerts</div>
            <div className="stat-value" style={{ color: stats.outFG > 0 ? 'var(--red)' : 'var(--amber)' }}>{stats.outFG + stats.lowFG}</div>
            <div className="stat-sub">{stats.outFG} out · {stats.lowFG} low · tap to view</div>
          </div>
          <div className="stat" style={{ borderTop:'3px solid var(--amber)', cursor:'pointer' }} onClick={() => navigate('/inventory')}>
            <div className="stat-label">RM Stock Alerts</div>
            <div className="stat-value" style={{ color: stats.outRM > 0 ? 'var(--red)' : 'var(--amber)' }}>{stats.outRM + stats.lowRM}</div>
            <div className="stat-sub">{stats.outRM} out · {stats.lowRM} low · tap to view</div>
          </div>
          <div className="stat" style={{ borderTop:'3px solid var(--blue)' }}>
            <div className="stat-label">Orders This Week</div>
            <div className="stat-value" style={{ color:'var(--blue)' }}>{stats.weekOrders}</div>
            <div className="stat-sub">active orders</div>
          </div>
          <div className="stat" style={{ borderTop:'3px solid var(--kk-green)', cursor:'pointer' }} onClick={() => navigate('/orders')}>
            <div className="stat-label">Pack Today</div>
            <div className="stat-value" style={{ color: stats.packToday > 0 ? 'var(--kk-green)' : 'var(--ink3)' }}>{stats.packToday}</div>
            <div className="stat-sub">dispatch tomorrow · tap to view</div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--border)', marginBottom:20 }}>
          <button style={tabStyle('performance')} onClick={() => setActiveTab('performance')}>Performance</button>
          <button style={tabStyle('overview')}    onClick={() => setActiveTab('overview')}>Overview</button>
          <button style={tabStyle('schedule')}    onClick={() => setActiveTab('schedule')}>Delivery Schedule</button>
          <button style={tabStyle('map')}         onClick={() => setActiveTab('map')}>Zone Map</button>
        </div>

        {/* ─────────────────────────────────────────── */}
        {/* PERFORMANCE TAB                             */}
        {/* ─────────────────────────────────────────── */}
        {activeTab === 'performance' && (
          <div>
            {isAdmin && (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', background:'#EEEDFE', borderRadius:6, marginBottom:16, fontSize:12, color:'#3C3489' }}>
                <span>🔒</span> Revenue data visible to admin only
              </div>
            )}

            {/* Admin: revenue chart */}
            {isAdmin && weeklyRevenue.length > 0 && (
              <div className="card" style={{ marginBottom:16 }}>
                <div className="card-title">Weekly revenue — last 5 weeks</div>
                <div style={{ display:'flex', alignItems:'flex-end', gap:8, height:120, paddingTop:8 }}>
                  {weeklyRevenue.map((w,i) => (
                    <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                      <div style={{ fontSize:10, color:'var(--ink3)', fontFamily:'var(--mono)' }}>
                        ${w.revenue >= 1000 ? (w.revenue/1000).toFixed(1)+'k' : w.revenue}
                      </div>
                      <div style={{
                        width:'100%',
                        height: Math.max(4, Math.round((w.revenue/maxRev)*90))+'px',
                        background: i === weeklyRevenue.length-1 ? 'var(--kk-green)' : '#9FE1CB',
                        borderRadius:'3px 3px 0 0',
                      }} />
                      <div style={{ fontSize:10, color:'var(--ink3)' }}>{w.label}</div>
                    </div>
                  ))}
                </div>
                {weeklyRevenue.length >= 2 && (() => {
                  const curr = weeklyRevenue[weeklyRevenue.length-1]?.revenue || 0
                  const prev = weeklyRevenue[weeklyRevenue.length-2]?.revenue || 1
                  const pct  = Math.round(((curr-prev)/prev)*100)
                  return (
                    <div style={{ marginTop:8, fontSize:11, color: pct>=0?'var(--green)':'var(--red)', textAlign:'right' }}>
                      {pct>=0?'▲':'▼'} {Math.abs(pct)}% vs last week · this week: ${curr.toLocaleString()}
                    </div>
                  )
                })()}
              </div>
            )}

            <div className="grid2">
              {/* Top SKUs */}
              <div className="card">
                <div className="card-title">
                  Top SKUs — this month
                  <span style={{ fontSize:10, color:'var(--ink3)', fontWeight:400, letterSpacing:0, textTransform:'none' }}>by units dispatched</span>
                </div>
                {topSKUs.length === 0
                  ? <div style={{ fontSize:12, color:'var(--ink3)', textAlign:'center', padding:'20px 0' }}>No dispatch data this month</div>
                  : topSKUs.map((p,i) => (
                    <div key={p.code} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                      <span style={{ fontSize:11, color:'var(--ink3)', width:14 }}>{i+1}</span>
                      <span style={{ fontSize:10, fontFamily:'var(--mono)', background:'var(--surface2)', padding:'2px 5px', borderRadius:3, color:'var(--ink3)', whiteSpace:'nowrap' }}>{p.code}</span>
                      <span style={{ flex:1, color:'var(--ink)' }}>{p.name}</span>
                      <div style={{ width:60, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:Math.round((p.units/maxSKU)*100)+'%', background:'var(--kk-green)', borderRadius:2 }} />
                      </div>
                      <span style={{ fontSize:11, fontWeight:600, minWidth:32, textAlign:'right' }}>{p.units}</span>
                    </div>
                  ))
                }
              </div>

              {/* Top customers */}
              <div className="card">
                <div className="card-title">
                  Top customers — this month
                  <span style={{ fontSize:10, color:'var(--ink3)', fontWeight:400, letterSpacing:0, textTransform:'none' }}>
                    {isAdmin ? 'by revenue' : 'by orders'}
                  </span>
                </div>
                {topCustomers.length === 0
                  ? <div style={{ fontSize:12, color:'var(--ink3)', textAlign:'center', padding:'20px 0' }}>No order data this month</div>
                  : topCustomers.map((c,i) => {
                    const val = isAdmin ? c.revenue : c.orders
                    const displayVal = isAdmin ? '$'+Math.round(c.revenue).toLocaleString() : c.orders+' orders'
                    return (
                      <div key={c.name} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                        <span style={{ fontSize:11, color:'var(--ink3)', width:14 }}>{i+1}</span>
                        <span style={{ flex:1, color:'var(--ink)', fontSize:12 }}>{c.name}</span>
                        <div style={{ width:60, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:Math.round((val/maxCust)*100)+'%', background:'var(--kk-peach)', borderRadius:2 }} />
                        </div>
                        <span style={{ fontSize:11, fontWeight:600, minWidth:54, textAlign:'right', color: isAdmin ? 'var(--kk-green)' : 'var(--ink)' }}>{displayVal}</span>
                      </div>
                    )
                  })
                }
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────── */}
        {/* OVERVIEW TAB                                */}
        {/* ─────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="grid2">
            {/* Pack today */}
            <div className="card">
              <div className="card-title" style={{ display:'flex', justifyContent:'space-between' }}>
                Pack today — dispatch tomorrow
                <span style={{ fontSize:10, background:'var(--blue-l)', color:'var(--blue)', padding:'2px 8px', borderRadius:4 }}>
                  {packList.length} orders
                </span>
              </div>
              {packList.length === 0 ? (
                <div style={{ textAlign:'center', padding:'28px 0', color:'var(--ink3)', fontSize:13 }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>✅</div>
                  No orders to pack tomorrow
                </div>
              ) : packList.map(o => (
                <div key={o.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                  <span>📦</span>
                  <span style={{ flex:1, fontWeight:600 }}>{o.customer_name}</span>
                  <span style={{ fontSize:11, color:'var(--ink3)' }}>{o.order_items?.length || 0} items</span>
                </div>
              ))}
              {packList.length > 0 && (
                <Link to="/orders" style={{ display:'block', marginTop:10, fontSize:11, color:'var(--kk-green)', textDecoration:'none', textAlign:'center' }}>
                  View all orders →
                </Link>
              )}
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {/* Stock alerts */}
              <div className="card">
                <div className="card-title" style={{ display:'flex', justifyContent:'space-between' }}>
                  Stock alerts
                  <Link to="/inventory" style={{ fontSize:10, color:'var(--ink3)', textDecoration:'none', fontFamily:'inherit', letterSpacing:0, textTransform:'none', fontWeight:400 }}>
                    View inventory →
                  </Link>
                </div>
                {alerts.fgOut.length > 0 && (
                  <div style={{ background:'var(--red-l)', padding:'7px 10px', borderRadius:6, marginBottom:6, fontSize:12, color:'var(--red)' }}>
                    🔴 <strong>FG out:</strong> {alerts.fgOut.map(p => p.code).join(', ')}
                  </div>
                )}
                {alerts.fgLow.length > 0 && (
                  <div style={{ background:'var(--amber-l)', padding:'7px 10px', borderRadius:6, marginBottom:6, fontSize:12, color:'var(--amber)' }}>
                    ⚠️ <strong>FG low:</strong> {alerts.fgLow.map(p => p.code).join(', ')}
                  </div>
                )}
                {alerts.rmOut.length > 0 && (
                  <div style={{ background:'var(--red-l)', padding:'7px 10px', borderRadius:6, marginBottom:6, fontSize:12, color:'var(--red)' }}>
                    🌿 <strong>RM out:</strong> {alerts.rmOut.map(r => r.name).join(', ')}
                  </div>
                )}
                {alerts.rmLow.length > 0 && (
                  <div style={{ background:'var(--amber-l)', padding:'7px 10px', borderRadius:6, fontSize:12, color:'var(--amber)' }}>
                    🌿 <strong>RM low:</strong> {alerts.rmLow.map(r => r.name).join(', ')}
                  </div>
                )}
                {!alerts.fgOut.length && !alerts.fgLow.length && !alerts.rmOut.length && !alerts.rmLow.length && (
                  <div style={{ fontSize:12, color:'var(--green)', textAlign:'center', padding:'12px 0' }}>✅ All stock levels healthy</div>
                )}
              </div>

              {/* Activity */}
              <div className="card">
                <div className="card-title" style={{ display:'flex', justifyContent:'space-between' }}>
                  Recent activity
                  <Link to="/activity" style={{ fontSize:10, color:'var(--ink3)', textDecoration:'none', fontFamily:'inherit', letterSpacing:0, textTransform:'none', fontWeight:400 }}>
                    View all →
                  </Link>
                </div>
                {activity.length === 0 ? (
                  <div style={{ fontSize:12, color:'var(--ink3)', textAlign:'center', padding:'16px 0' }}>No activity yet</div>
                ) : activity.map(a => (
                  <div key={a.id} className="activity-item" style={{ padding:'8px 0' }}>
                    <div className={'activity-icon ' + a.type}>{icons[a.type] || '•'}</div>
                    <div className="activity-body">
                      <div className="activity-title" style={{ fontSize:12 }}>{a.title}</div>
                      <div className="activity-meta">
                        {a.description} · {new Date(a.created_at).toLocaleTimeString('en',{ hour:'2-digit', minute:'2-digit' })} · {a.created_by_name}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────── */}
        {/* DELIVERY SCHEDULE TAB                       */}
        {/* ─────────────────────────────────────────── */}
        {activeTab === 'schedule' && (
          <div>
            <div style={{ fontSize:12, color:'var(--ink3)', marginBottom:16 }}>
              Customers grouped by delivery zone and dispatch day.
            </div>
            <div className="grid2">
              {DISPATCH_DAYS.map(day => {
                const dayCusts = schedule[day] || []
                const zones = DAY_ZONES[day] || []
                return (
                  <div key={day} className="card">
                    <div className="card-title" style={{ display:'flex', justifyContent:'space-between' }}>
                      {day}
                      <span style={{ fontSize:10, background:'var(--surface2)', padding:'2px 8px', borderRadius:4, color:'var(--ink3)', fontWeight:400, letterSpacing:0, textTransform:'none' }}>
                        {dayCusts.length} customers
                      </span>
                    </div>
                    {zones.map(zone => {
                      const zc = ZONE_COLORS[zone] || ZONE_COLORS.Float
                      const zoneCusts = dayCusts.filter(c => c.zone === zone)
                      if (!zoneCusts.length) return null
                      return (
                        <div key={zone} style={{ marginBottom:12 }}>
                          <div style={{ fontSize:10, fontFamily:'var(--display)', letterSpacing:2, textTransform:'uppercase', color:zc.color, background:zc.bg, padding:'3px 8px', borderRadius:4, display:'inline-block', marginBottom:6 }}>
                            {zone}
                          </div>
                          {zoneCusts.map(c => (
                            <div key={c.name} style={{ display:'flex', alignItems:'center', padding:'5px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                              <span style={{ flex:1, color:'var(--ink)' }}>{c.name}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                    {dayCusts.length === 0 && (
                      <div style={{ fontSize:12, color:'var(--ink3)', textAlign:'center', padding:'12px 0' }}>No customers assigned</div>
                    )}
                  </div>
                )
              })}
            </div>

            {(schedule['Flexible'] || []).length > 0 && (
              <div className="card" style={{ marginTop:16 }}>
                <div className="card-title" style={{ display:'flex', justifyContent:'space-between' }}>
                  Float — flexible dispatch
                  <span style={{ fontSize:10, background:'var(--surface2)', padding:'2px 8px', borderRadius:4, color:'var(--ink3)', fontWeight:400, letterSpacing:0, textTransform:'none' }}>
                    {(schedule['Flexible']||[]).length} customers
                  </span>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:'2px 16px' }}>
                  {(schedule['Flexible']||[]).map(c => (
                    <div key={c.name} style={{ fontSize:12, padding:'5px 0', borderBottom:'1px solid var(--border)', color:'var(--ink2)' }}>
                      {c.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}


        {/* ─────────────────────────────────────────── */}
        {/* MAP TAB                                      */}
        {/* ─────────────────────────────────────────── */}
        {activeTab === 'map' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 190px', gap:14, alignItems:'start' }}>
              <div id="kk-zone-map" style={{ height:460, borderRadius:8, overflow:'hidden', border:'0.5px solid var(--border)' }} />
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <div style={{ fontSize:10, letterSpacing:'1.5px', textTransform:'uppercase', color:'var(--ink3)', marginBottom:4 }}>Zones · this month</div>
                {[
                  { key:'City',  label:'City',  day:'Friday',    color:'#7F77DD', bg:'#EEEDFE', textColor:'#3C3489', pct:100 },
                  { key:'West',  label:'West',  day:'Thursday',  color:'#EF9F27', bg:'#FAEEDA', textColor:'#633806', pct:78 },
                  { key:'ONFC',  label:'ONFC',  day:'Monday',    color:'#E24B4A', bg:'#FCEBEB', textColor:'#791F1F', pct:59 },
                  { key:'North', label:'North', day:'Wednesday', color:'#1D9E75', bg:'#E1F5EE', textColor:'#085041', pct:38 },
                  { key:'East',  label:'East',  day:'Wednesday', color:'#378ADD', bg:'#E6F1FB', textColor:'#0C447C', pct:19 },
                ].map(z => (
                  <div key={z.key} style={{ background:'var(--surface)', border:'0.5px solid var(--border)', borderRadius:8, padding:'10px 12px', cursor:'pointer' }}
                    onClick={() => {
                      if (window._kkMap) {
                        const coords = { City:[43.653,-79.383,12], West:[43.48,-79.85,10], ONFC:[43.72,-79.42,13], North:[44.05,-79.50,10], East:[43.88,-78.85,10] }
                        const [lat,lng,zoom] = coords[z.key] || [43.7,-79.4,10]
                        window._kkMap.flyTo([lat,lng], zoom, { duration:1.2 })
                      }
                    }}>
                    <div style={{ fontSize:10, fontWeight:500, letterSpacing:'1px', textTransform:'uppercase', color:z.textColor }}>{z.label} · {z.day}</div>
                    <div style={{ fontSize:22, fontWeight:500, color:z.textColor, lineHeight:1.2 }}>{(mapUnits[z.key]||0).toLocaleString()}</div>
                    <div style={{ fontSize:11, color:'var(--ink3)' }}>units dispatched</div>
                    <div style={{ height:4, background:z.bg, borderRadius:2, marginTop:6 }}>
                      <div style={{ height:4, width: mapUnits[z.key] > 0 ? Math.round((mapUnits[z.key] / Math.max(...Object.values(mapUnits),1)) * 100) + '%' : z.pct+'%', background:z.color, borderRadius:2 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <MapLoader units={mapUnits} />
          </div>
        )}

      </div>
    </>
  )
}

function MapLoader({ units }) {
  useEffect(() => {
    if (document.getElementById('leaflet-js')) {
      initMap(units)
      return
    }
    const script = document.createElement('script')
    script.id = 'leaflet-js'
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => initMap(units)
    document.head.appendChild(script)
  }, [units])
  return null
}

function initMap(units) {
  if (window._kkMap) { window._kkMap.remove(); window._kkMap = null }
  const el = document.getElementById('kk-zone-map')
  if (!el || !window.L) return
  const map = window.L.map('kk-zone-map', { zoomControl:true }).setView([43.75,-79.5], 10)
  window._kkMap = map
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '\u00a9 OpenStreetMap contributors', maxZoom:18
  }).addTo(map)
  const zones = [
    { key:'City',  lat:43.653, lng:-79.383, color:'#7F77DD', fill:'#EEEDFE', day:'Friday',    r:36 },
    { key:'ONFC',  lat:43.720, lng:-79.420, color:'#E24B4A', fill:'#FCEBEB', day:'Monday',    r:28 },
    { key:'West',  lat:43.480, lng:-79.850, color:'#EF9F27', fill:'#FAEEDA', day:'Thursday',  r:34 },
    { key:'North', lat:44.050, lng:-79.500, color:'#1D9E75', fill:'#E1F5EE', day:'Wednesday', r:24 },
    { key:'East',  lat:43.880, lng:-78.850, color:'#378ADD', fill:'#E6F1FB', day:'Wednesday', r:18 },
  ]
  zones.forEach(z => {
    const u = (units[z.key] || 0).toLocaleString()
    window.L.circleMarker([z.lat, z.lng], {
      radius: z.r, fillColor: z.fill, color: z.color, weight:2.5, fillOpacity:0.85
    }).addTo(map)
    .bindPopup('<strong style="color:' + z.color + ';font-size:14px">' + z.key + '</strong><br><span style="font-size:13px">' + u + ' units · ' + z.day + '</span>')
  })
}
