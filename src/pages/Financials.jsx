import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const DATE_RANGES = [
  { label: '30 Days', days: 30 },
  { label: '3 Months', days: 90 },
  { label: '6 Months', days: 180 },
  { label: '12 Months', days: 365 },
]

function getStartDate(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

function getWeekLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const monday = new Date(d)
  monday.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1))
  return monday.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

// Derive pack count from an order_item row — mirrors the order sheet logic
function getPacksFromItem(item) {
  // If packs is explicitly stored, use it
  if (item.packs && item.packs > 0) return item.packs
  // If cases + packs_per_case, derive
  if (item.cases && item.cases > 0) {
    const ppc = item.packs_per_case || 6
    return item.cases * ppc
  }
  // Bulk items (no cases/packs): quantity IS the unit count, price_per_pack is per unit
  // units_per_pack = 1 means pack === unit
  const upp = item.units_per_pack || 1
  if (upp <= 1) return item.quantity || 0
  // Fall back: quantity / units_per_pack
  return (item.quantity || 0) / upp
}

export default function Financials() {
  const [dateRange, setDateRange] = useState(30)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  const [revenue, setRevenue] = useState(0)
  const [cogs, setCogs] = useState(0)
  const [revenueByProduct, setRevenueByProduct] = useState([])
  const [revenueByCustomer, setRevenueByCustomer] = useState([])
  const [revenueByDate, setRevenueByDate] = useState([])
  const [topProducts, setTopProducts] = useState([])

  useEffect(() => { loadFinancials(dateRange) }, [dateRange])

  async function loadFinancials(days) {
    setLoading(true)
    const since = getStartDate(days)

    const { data: orders } = await supabase
      .from('orders')
      .select('id, customer_name, dispatch_date, created_at, status, order_items(*)')
      .or('dispatch_date.gte.' + since + ',created_at.gte.' + since)

    const filteredOrders = (orders || []).filter(o => {
      const d = o.dispatch_date || o.created_at?.split('T')[0]
      return d >= since
    })

    let totalRevenue = 0
    const byProduct = {}
    const byCustomer = {}
    const byDate = {}

    for (const order of filteredOrders) {
      const items = order.order_items || []
      for (const item of items) {
        // ── Correct revenue: packs × price_per_pack ──────────
        const packs = getPacksFromItem(item)
        const lineRevenue = packs * (item.price_per_pack || 0)
        totalRevenue += lineRevenue

        // By product
        const code = item.product_code || 'OTHER'
        if (!byProduct[code]) {
          byProduct[code] = { code, name: item.product_name || code, revenue: 0, units: 0, packs: 0 }
        }
        byProduct[code].revenue += lineRevenue
        byProduct[code].units += item.quantity || 0
        byProduct[code].packs += packs

        // By customer
        const cname = order.customer_name || 'Unknown'
        if (!byCustomer[cname]) byCustomer[cname] = { name: cname, revenue: 0, orders: new Set() }
        byCustomer[cname].revenue += lineRevenue
        byCustomer[cname].orders.add(order.id)

        // By week
        const dateStr = order.dispatch_date || order.created_at?.split('T')[0]
        const week = getWeekLabel(dateStr)
        if (!byDate[week]) byDate[week] = { week, date: dateStr, revenue: 0 }
        byDate[week].revenue += lineRevenue
      }
    }

    // ── COGS from productions in range ───────────────────────
    const { data: productions } = await supabase
      .from('productions')
      .select('product_code, output_units')
      .gte('date', since)

    const { data: bom } = await supabase.from('bom').select('product_code, rm_name, qty_per_unit, unit')
    const { data: rms } = await supabase.from('raw_materials').select('name, price_per_unit')

    const rmPriceMap = {}
    ;(rms || []).forEach(r => { rmPriceMap[r.name] = r.price_per_unit || 0 })

    const bomMap = {}
    ;(bom || []).forEach(b => {
      if (!bomMap[b.product_code]) bomMap[b.product_code] = []
      bomMap[b.product_code].push(b)
    })

    let totalCogs = 0
    for (const prod of (productions || [])) {
      const bomItems = bomMap[prod.product_code] || []
      for (const item of bomItems) {
        const rmPrice = rmPriceMap[item.rm_name] || 0
        const cost = item.unit === 'ea'
          ? rmPrice * item.qty_per_unit * prod.output_units
          : rmPrice * (item.qty_per_unit * prod.output_units) / 1000
        totalCogs += cost
      }
    }

    setRevenue(totalRevenue)
    setCogs(totalCogs)
    setRevenueByProduct(Object.values(byProduct).sort((a, b) => b.revenue - a.revenue))
    setRevenueByCustomer(Object.values(byCustomer).map(c => ({ ...c, orders: c.orders.size })).sort((a, b) => b.revenue - a.revenue))
    setRevenueByDate(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)))
    setTopProducts(Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 5))
    setLoading(false)
  }

  const grossMargin = revenue > 0 ? ((revenue - cogs) / revenue * 100) : 0
  const grossProfit = revenue - cogs

  const btnStyle = (active) => ({
    padding: '6px 14px', borderRadius: 20,
    border: '1px solid var(--border)',
    background: active ? 'var(--kk-green)' : 'var(--surface)',
    color: active ? 'var(--kk-cream)' : 'var(--ink3)',
    cursor: 'pointer', fontSize: 10,
    fontFamily: 'var(--display)', letterSpacing: 1,
    textTransform: 'uppercase',
  })

  const tabStyle = (active) => ({
    padding: '10px 20px', border: 'none', background: 'none',
    cursor: 'pointer', fontFamily: 'var(--display)', fontSize: 11,
    letterSpacing: '2px', textTransform: 'uppercase',
    color: active ? 'var(--ink)' : 'var(--ink3)',
    borderBottom: active ? '2px solid var(--kk-green)' : '2px solid transparent',
    marginBottom: -1,
  })

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink3)' }}>Loading financials...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
          {['overview', 'by product', 'by customer', 'by week'].map(t => (
            <button key={t} style={tabStyle(activeTab === t)} onClick={() => setActiveTab(t)}>{t}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {DATE_RANGES.map(r => (
            <button key={r.days} style={btnStyle(dateRange === r.days)} onClick={() => setDateRange(r.days)}>{r.label}</button>
          ))}
        </div>
      </div>

      <div className="grid4" style={{ marginBottom: 20 }}>
        <div className="stat green">
          <div className="stat-label">Revenue</div>
          <div className="stat-value">${revenue.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
          <div className="stat-sub">Last {dateRange} days</div>
        </div>
        <div className="stat amber">
          <div className="stat-label">COGS</div>
          <div className="stat-value">${cogs.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
          <div className="stat-sub">Raw material cost</div>
        </div>
        <div className="stat blue">
          <div className="stat-label">Gross Profit</div>
          <div className="stat-value" style={{ color: grossProfit >= 0 ? 'var(--kk-green)' : 'var(--red)' }}>
            ${Math.abs(grossProfit).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className="stat-sub">Revenue minus COGS</div>
        </div>
        <div className="stat" style={{ borderTop: '3px solid ' + (grossMargin >= 50 ? 'var(--kk-green)' : grossMargin >= 30 ? 'var(--kk-peach)' : 'var(--red)') }}>
          <div className="stat-label">Gross Margin</div>
          <div className="stat-value" style={{ color: grossMargin >= 50 ? 'var(--kk-green)' : grossMargin >= 30 ? 'var(--kk-peach)' : 'var(--red)' }}>
            {grossMargin.toFixed(1)}%
          </div>
          <div className="stat-sub">{grossMargin >= 60 ? '🟢 Healthy' : grossMargin >= 40 ? '🟡 OK' : '🔴 Low'}</div>
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="grid2">
          <div className="card">
            <div className="card-title">Top Products by Revenue</div>
            {topProducts.length === 0
              ? <div style={{ color: 'var(--ink3)', fontSize: 12 }}>No order data in this period</div>
              : topProducts.map((p, i) => (
                <div key={p.code} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--ink3)', width: 24 }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{p.packs.toFixed(0)} packs · {p.units} units</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--display)', fontSize: 16, color: 'var(--kk-brown)' }}>${p.revenue.toFixed(2)}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{((p.revenue / revenue) * 100).toFixed(1)}% of total</div>
                  </div>
                </div>
              ))
            }
          </div>
          <div className="card">
            <div className="card-title">Revenue by Week</div>
            {revenueByDate.length === 0
              ? <div style={{ color: 'var(--ink3)', fontSize: 12 }}>No data in this period</div>
              : revenueByDate.map((w, i) => {
                const maxRev = Math.max(...revenueByDate.map(d => d.revenue))
                const pct = maxRev > 0 ? (w.revenue / maxRev * 100) : 0
                return (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                      <span style={{ color: 'var(--ink2)' }}>Wk of {w.week}</span>
                      <span style={{ fontFamily: 'var(--display)', color: 'var(--kk-brown)' }}>${w.revenue.toFixed(0)}</span>
                    </div>
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: pct + '%', background: 'var(--kk-green)', borderRadius: 3, transition: 'width .4s' }} />
                    </div>
                  </div>
                )
              })
            }
          </div>
        </div>
      )}

      {activeTab === 'by product' && (
        <div className="card">
          <div className="card-title">Revenue by Product</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Product</th><th>Packs</th><th>Units</th><th>Revenue</th><th>% of Total</th></tr></thead>
              <tbody>
                {revenueByProduct.map(p => (
                  <tr key={p.code}>
                    <td><span className="code-tag">{p.code}</span></td>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td style={{ color: 'var(--ink2)' }}>{p.packs.toFixed(0)}</td>
                    <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{p.units.toLocaleString()}</td>
                    <td style={{ fontFamily: 'var(--display)', color: 'var(--kk-brown)', fontSize: 14 }}>${p.revenue.toFixed(2)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 60, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: (p.revenue / revenue * 100) + '%', background: 'var(--kk-green)', borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{(p.revenue / revenue * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                  <td colSpan={2} style={{ fontFamily: 'var(--display)', fontSize: 13, letterSpacing: 1 }}>TOTAL</td>
                  <td>{revenueByProduct.reduce((s, p) => s + p.packs, 0).toFixed(0)}</td>
                  <td>{revenueByProduct.reduce((s, p) => s + p.units, 0).toLocaleString()}</td>
                  <td style={{ fontFamily: 'var(--display)', fontSize: 16, color: 'var(--kk-green)' }}>${revenue.toFixed(2)}</td>
                  <td>100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'by customer' && (
        <div className="card">
          <div className="card-title">Revenue by Customer</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Orders</th><th>Revenue</th><th>Avg per Order</th><th>% of Total</th></tr></thead>
              <tbody>
                {revenueByCustomer.map((c, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td>{c.orders}</td>
                    <td style={{ fontFamily: 'var(--display)', color: 'var(--kk-brown)', fontSize: 14 }}>${c.revenue.toFixed(2)}</td>
                    <td style={{ color: 'var(--ink2)' }}>${(c.revenue / c.orders).toFixed(2)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 60, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: (c.revenue / revenue * 100) + '%', background: 'var(--kk-peach)', borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{(c.revenue / revenue * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                  <td style={{ fontFamily: 'var(--display)', fontSize: 13, letterSpacing: 1 }}>TOTAL</td>
                  <td>{revenueByCustomer.reduce((s, c) => s + c.orders, 0)}</td>
                  <td style={{ fontFamily: 'var(--display)', fontSize: 16, color: 'var(--kk-green)' }}>${revenue.toFixed(2)}</td>
                  <td></td><td>100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'by week' && (
        <div className="card">
          <div className="card-title">Weekly Revenue Breakdown</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Week of</th><th>Revenue</th><th>vs Total</th></tr></thead>
              <tbody>
                {revenueByDate.slice().reverse().map((w, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>Wk of {w.week}</td>
                    <td style={{ fontFamily: 'var(--display)', color: 'var(--kk-brown)', fontSize: 16 }}>${w.revenue.toFixed(2)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 100, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: (w.revenue / revenue * 100) + '%', background: 'var(--kk-green)', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{(w.revenue / revenue * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                  <td style={{ fontFamily: 'var(--display)', fontSize: 13, letterSpacing: 1 }}>TOTAL</td>
                  <td style={{ fontFamily: 'var(--display)', fontSize: 16, color: 'var(--kk-green)' }}>${revenue.toFixed(2)}</td>
                  <td>100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
