import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

function lastNMonths(n) {
  const end = new Date(), start = new Date()
  start.setMonth(start.getMonth() - n)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}
function currentMonth() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1
  const last = new Date(y, m, 0).getDate()
  return { start: `${y}-${String(m).padStart(2,'0')}-01`, end: `${y}-${String(m).padStart(2,'0')}-${last}` }
}
function thisYear() { const y = new Date().getFullYear(); return { start: `${y}-01-01`, end: `${y}-12-31` } }
function fmt(n) { return n == null || isNaN(n) ? '—' : '$' + parseFloat(n).toFixed(2) }
function fmtDate(d) { if (!d) return '—'; return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) }

function DateRangePicker({ value, onChange }) {
  const inp = { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)' }
  const presets = [{ key: '1m', label: 'Last Month' }, { key: '3m', label: '3 Months' }, { key: 'year', label: 'This Year' }, { key: 'custom', label: 'Custom' }]
  function apply(key) {
    if (key === '1m') onChange({ preset: '1m', ...lastNMonths(1) })
    else if (key === '3m') onChange({ preset: '3m', ...lastNMonths(3) })
    else if (key === 'year') onChange({ preset: 'year', ...thisYear() })
    else onChange({ preset: 'custom', start: value.start || '', end: value.end || '' })
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {presets.map(p => (
          <button key={p.key} onClick={() => apply(p.key)}
            style={{ padding: '7px 12px', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--display)', letterSpacing: 0.5, textTransform: 'uppercase', background: value.preset === p.key ? 'var(--kk-green)' : 'var(--surface)', color: value.preset === p.key ? 'var(--kk-cream)' : 'var(--ink3)', fontWeight: value.preset === p.key ? 700 : 400, borderRight: '1px solid var(--border)' }}>
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>From</span>
          <input type="date" value={value.start} onChange={e => onChange({ ...value, start: e.target.value })} style={inp} />
          <span style={{ fontSize: 11, color: 'var(--ink3)' }}>To</span>
          <input type="date" value={value.end} onChange={e => onChange({ ...value, end: e.target.value })} style={inp} />
        </div>
      )}
      {value.preset !== 'custom' && value.start && <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{fmtDate(value.start)} – {fmtDate(value.end)}</span>}
    </div>
  )
}

// ── Labour vs Production ──────────────────────────────────────────────────────
function LabourReport({ products }) {
  const [dateRange, setDateRange] = useState({ preset: '1m', ...lastNMonths(1) })
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  async function load() {
    const { start, end } = dateRange
    if (!start || !end) return
    setLoading(true)
    const [prodRes, timeRes] = await Promise.all([
      supabase.from('productions').select('date,product_code,output_units').gte('date', start).lte('date', end).order('date'),
      supabase.from('time_entries').select('clock_in,hours_worked,employees(hourly_rate)').gte('clock_in', start + 'T00:00:00').lte('clock_in', end + 'T23:59:59'),
    ])
    const dayProd = {}
    ;(prodRes.data || []).forEach(p => {
      if (!dayProd[p.date]) dayProd[p.date] = { value: 0, items: [] }
      const prod = products[p.product_code]
      const pv = prod?.production_value != null ? parseFloat(prod.production_value) : parseFloat(prod?.price_per_pack || 0)
      const val = Math.round(p.output_units / (prod?.units_per_pack || 1)) * pv
      dayProd[p.date].value += val
      dayProd[p.date].items.push({ code: p.product_code, units: p.output_units })
    })
    const dayLabour = {}
    ;(timeRes.data || []).forEach(t => {
      const day = t.clock_in?.split('T')[0]; if (!day) return
      if (!dayLabour[day]) dayLabour[day] = { hours: 0, cost: 0 }
      dayLabour[day].hours += parseFloat(t.hours_worked || 0)
      dayLabour[day].cost += parseFloat(t.hours_worked || 0) * parseFloat(t.employees?.hourly_rate || 0)
    })
    const allDates = [...new Set([...Object.keys(dayProd), ...Object.keys(dayLabour)])].sort()
    setData(allDates.map(date => ({ date, prodValue: dayProd[date]?.value || 0, items: dayProd[date]?.items || [], labourHours: dayLabour[date]?.hours || 0, labourCost: dayLabour[date]?.cost || 0 })))
    setLoading(false)
  }

  useEffect(() => { load() }, [dateRange, products])

  const totals = data.reduce((s, r) => ({ value: s.value + r.prodValue, labourHours: s.labourHours + r.labourHours, labourCost: s.labourCost + r.labourCost }), { value: 0, labourHours: 0, labourCost: 0 })
  const ratio = totals.value > 0 ? (totals.labourCost / totals.value * 100).toFixed(1) : null

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}><DateRangePicker value={dateRange} onChange={setDateRange} /></div>
      {data.length > 0 && (
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
          <div className="stat" style={{ borderTop: '3px solid var(--kk-green)' }}><div className="stat-label">Production Value</div><div className="stat-value" style={{ color: 'var(--kk-green)' }}>{fmt(totals.value)}</div></div>
          <div className="stat" style={{ borderTop: '3px solid var(--kk-peach)' }}><div className="stat-label">Labour Cost</div><div className="stat-value" style={{ color: 'var(--kk-peach)' }}>{fmt(totals.labourCost)}</div><div className="stat-sub">{totals.labourHours.toFixed(1)}h worked</div></div>
          <div className="stat" style={{ borderTop: '3px solid ' + (ratio && parseFloat(ratio) < 30 ? 'var(--kk-green)' : ratio && parseFloat(ratio) < 50 ? 'var(--kk-peach)' : 'var(--red)') }}><div className="stat-label">Labour / Production</div><div className="stat-value">{ratio ? ratio + '%' : '—'}</div><div className="stat-sub">{!ratio ? '' : parseFloat(ratio) < 30 ? '🟢 Efficient' : parseFloat(ratio) < 50 ? '🟡 Watch' : '🔴 Review'}</div></div>
          <div className="stat"><div className="stat-label">Avg Labour / Hr</div><div className="stat-value">{totals.labourHours > 0 ? fmt(totals.labourCost / totals.labourHours) : '—'}</div></div>
        </div>
      )}
      <div className="card">
        {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>Loading...</div>
          : data.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>No data for this period.</div>
          : <div className="table-wrap"><table>
              <thead><tr><th>Date</th><th>Production Value</th><th>Labour Hours</th><th>Labour Cost</th><th>Labour %</th><th>Products</th></tr></thead>
              <tbody>
                {data.map(row => {
                  const dr = row.prodValue > 0 ? (row.labourCost / row.prodValue * 100) : null
                  return <tr key={row.date}>
                    <td style={{ fontWeight: 600 }}>{new Date(row.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td style={{ color: 'var(--kk-green)', fontWeight: 600 }}>{fmt(row.prodValue)}</td>
                    <td style={{ color: 'var(--ink2)' }}>{row.labourHours.toFixed(1)}h</td>
                    <td style={{ color: 'var(--kk-peach)', fontWeight: 600 }}>{fmt(row.labourCost)}</td>
                    <td>{dr === null ? <span style={{ color: 'var(--ink3)' }}>—</span> : <span style={{ fontFamily: 'var(--display)', fontSize: 13, color: dr < 30 ? 'var(--kk-green)' : dr < 50 ? 'var(--kk-peach)' : 'var(--red)' }}>{dr.toFixed(1)}%</span>}</td>
                    <td style={{ fontSize: 11 }}>{row.items.slice(0,3).map(i => <span key={i.code} style={{ display: 'inline-block', background: 'var(--surface2)', borderRadius: 3, padding: '1px 5px', marginRight: 3 }}>{i.code}×{i.units}</span>)}{row.items.length > 3 && <span style={{ color: 'var(--ink3)' }}>+{row.items.length-3}</span>}</td>
                  </tr>
                })}
              </tbody>
              <tfoot><tr style={{ background: 'var(--surface2)', fontWeight: 700 }}><td style={{ padding: '10px 14px' }}>TOTAL</td><td style={{ padding: '10px 14px', color: 'var(--kk-green)' }}>{fmt(totals.value)}</td><td style={{ padding: '10px 14px' }}>{totals.labourHours.toFixed(1)}h</td><td style={{ padding: '10px 14px', color: 'var(--kk-peach)' }}>{fmt(totals.labourCost)}</td><td style={{ padding: '10px 14px' }}>{ratio ? ratio + '%' : '—'}</td><td></td></tr></tfoot>
            </table></div>
        }
      </div>
    </div>
  )
}

// ── Customer Performance ──────────────────────────────────────────────────────
function CustomerReport() {
  const [dateRange, setDateRange] = useState({ preset: '1m', ...currentMonth() })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [custFilter, setCustFilter] = useState('All Customers')

  async function load() {
    const { start, end } = dateRange
    if (!start || !end) return
    setLoading(true)
    setCustFilter('All Customers')
    const { data } = await supabase.from('orders').select('customer_name,dispatch_date,total_value,order_items(product_code,packs,price_per_pack)').gte('dispatch_date', start).lte('dispatch_date', end)
    const custMap = {}
    ;(data || []).forEach(o => {
      const name = o.customer_name
      if (!custMap[name]) custMap[name] = { name, value: 0, orders: 0, products: {} }
      custMap[name].value += o.total_value || 0
      custMap[name].orders++
      ;(o.order_items || []).forEach(i => { if (!custMap[name].products[i.product_code]) custMap[name].products[i.product_code] = 0; custMap[name].products[i.product_code] += i.packs || 0 })
    })
    setRows(Object.values(custMap).sort((a, b) => b.value - a.value))
    setLoading(false)
  }

  useEffect(() => { load() }, [dateRange])

  const customerNames = useMemo(() => ['All Customers', ...rows.map(r => r.name)], [rows])
  const filteredRows = custFilter === 'All Customers' ? rows : rows.filter(r => r.name === custFilter)
  const filteredTotal = filteredRows.reduce((s, r) => s + r.value, 0)
  const sel = { padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)', minWidth: 200 }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <select value={custFilter} onChange={e => setCustFilter(e.target.value)} style={sel}>
            {customerNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      {!loading && filteredRows.length > 0 && (
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 20 }}>
          <div className="stat" style={{ borderTop: '3px solid var(--kk-green)' }}><div className="stat-label">Total Revenue</div><div className="stat-value" style={{ color: 'var(--kk-green)' }}>{fmt(filteredTotal)}</div><div className="stat-sub">{filteredRows.length} customer{filteredRows.length !== 1 ? 's' : ''}</div></div>
          <div className="stat"><div className="stat-label">Top Customer</div><div className="stat-value" style={{ fontSize: 16 }}>{filteredRows[0]?.name?.split(' ').slice(0,2).join(' ')}</div><div className="stat-sub">{fmt(filteredRows[0]?.value)}</div></div>
          <div className="stat"><div className="stat-label">Avg per Customer</div><div className="stat-value">{fmt(filteredTotal / filteredRows.length)}</div></div>
        </div>
      )}
      <div className="card">
        {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>Loading...</div>
          : filteredRows.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>No orders in this period.</div>
          : <div className="table-wrap"><table>
              <thead><tr><th>#</th><th>Customer</th><th>Revenue</th><th>Orders</th><th>Avg Order</th><th>% of Total</th><th>Top Products</th></tr></thead>
              <tbody>
                {filteredRows.map((row, i) => (
                  <tr key={row.name}>
                    <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{row.name}</td>
                    <td style={{ color: 'var(--kk-green)', fontWeight: 700 }}>{fmt(row.value)}</td>
                    <td style={{ color: 'var(--ink2)' }}>{row.orders}</td>
                    <td style={{ color: 'var(--ink2)' }}>{fmt(row.value / row.orders)}</td>
                    <td><span style={{ fontFamily: 'var(--display)', fontSize: 12 }}>{filteredTotal > 0 ? (row.value / filteredTotal * 100).toFixed(1) + '%' : '—'}</span></td>
                    <td style={{ fontSize: 11 }}>{Object.entries(row.products).sort((a,b) => b[1]-a[1]).slice(0,3).map(([code, packs]) => <span key={code} style={{ display: 'inline-block', background: 'var(--surface2)', borderRadius: 3, padding: '1px 5px', marginRight: 3 }}>{code} ×{packs}</span>)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ background: 'var(--surface2)', fontWeight: 700 }}><td></td><td style={{ padding: '10px 14px' }}>TOTAL</td><td style={{ padding: '10px 14px', color: 'var(--kk-green)' }}>{fmt(filteredTotal)}</td><td style={{ padding: '10px 14px' }}>{filteredRows.reduce((s,r) => s+r.orders,0)}</td><td></td><td></td><td></td></tr></tfoot>
            </table></div>
        }
      </div>
    </div>
  )
}

// ── Product Performance ───────────────────────────────────────────────────────
function ProductReport() {
  const [dateRange, setDateRange] = useState({ preset: '1m', ...currentMonth() })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [prodFilter, setProdFilter] = useState('All Products')

  async function load() {
    const { start, end } = dateRange
    if (!start || !end) return
    setLoading(true)
    setProdFilter('All Products')
    const { data } = await supabase.from('order_items').select('product_code,packs,price_per_pack,orders!inner(dispatch_date,customer_name)').gte('orders.dispatch_date', start).lte('orders.dispatch_date', end)
    const prodMap = {}
    ;(data || []).forEach(i => {
      const code = i.product_code
      if (!prodMap[code]) prodMap[code] = { code, packs: 0, value: 0, customers: new Set() }
      prodMap[code].packs += i.packs || 0
      prodMap[code].value += (i.packs || 0) * (i.price_per_pack || 0)
      if (i.orders?.customer_name) prodMap[code].customers.add(i.orders.customer_name)
    })
    setRows(Object.values(prodMap).map(r => ({ ...r, customers: r.customers.size })).sort((a, b) => b.value - a.value))
    setLoading(false)
  }

  useEffect(() => { load() }, [dateRange])

  const productCodes = useMemo(() => ['All Products', ...rows.map(r => r.code)], [rows])
  const filteredRows = prodFilter === 'All Products' ? rows : rows.filter(r => r.code === prodFilter)
  const filteredTotal = filteredRows.reduce((s, r) => s + r.value, 0)
  const sel = { padding: '7px 12px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)', minWidth: 180 }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <select value={prodFilter} onChange={e => setProdFilter(e.target.value)} style={sel}>
            {productCodes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {!loading && filteredRows.length > 0 && (
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 20 }}>
          <div className="stat" style={{ borderTop: '3px solid var(--kk-green)' }}><div className="stat-label">Total Revenue</div><div className="stat-value" style={{ color: 'var(--kk-green)' }}>{fmt(filteredTotal)}</div><div className="stat-sub">{filteredRows.length} products</div></div>
          <div className="stat"><div className="stat-label">Top Product</div><div className="stat-value" style={{ fontSize: 18 }}>{filteredRows[0]?.code}</div><div className="stat-sub">{fmt(filteredRows[0]?.value)}</div></div>
          <div className="stat"><div className="stat-label">Total Packs</div><div className="stat-value">{filteredRows.reduce((s,r) => s+r.packs,0).toLocaleString()}</div></div>
        </div>
      )}
      <div className="card">
        {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>Loading...</div>
          : filteredRows.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>No orders in this period.</div>
          : <div className="table-wrap"><table>
              <thead><tr><th>#</th><th>Product</th><th>Revenue</th><th>Packs Sold</th><th>Customers</th><th>Avg Pack Price</th><th>% of Total</th></tr></thead>
              <tbody>
                {filteredRows.map((row, i) => (
                  <tr key={row.code}>
                    <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{i + 1}</td>
                    <td><span className="code-tag">{row.code}</span></td>
                    <td style={{ color: 'var(--kk-green)', fontWeight: 700 }}>{fmt(row.value)}</td>
                    <td style={{ color: 'var(--ink2)' }}>{row.packs.toLocaleString()}</td>
                    <td style={{ color: 'var(--ink2)' }}>{row.customers}</td>
                    <td style={{ color: 'var(--ink2)' }}>{fmt(row.packs > 0 ? row.value / row.packs : null)}</td>
                    <td><span style={{ fontFamily: 'var(--display)', fontSize: 12 }}>{filteredTotal > 0 ? (row.value / filteredTotal * 100).toFixed(1) + '%' : '—'}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ background: 'var(--surface2)', fontWeight: 700 }}><td></td><td style={{ padding: '10px 14px' }}>TOTAL</td><td style={{ padding: '10px 14px', color: 'var(--kk-green)' }}>{fmt(filteredTotal)}</td><td style={{ padding: '10px 14px' }}>{filteredRows.reduce((s,r) => s+r.packs,0).toLocaleString()}</td><td></td><td></td><td></td></tr></tfoot>
            </table></div>
        }
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Reports() {
  const [tab, setTab] = useState('labour')
  const [products, setProducts] = useState({})

  useEffect(() => {
    supabase.from('products').select('code,price_per_pack,production_value,units_per_pack').then(({ data: p }) => {
      const map = {}; (p || []).forEach(x => { map[x.code] = x }); setProducts(map)
    })
  }, [])

  const tabs = [{ key: 'labour', label: '📊 Labour vs Production' }, { key: 'customer', label: '🏪 Customer Performance' }, { key: 'product', label: '📦 Product Performance' }]

  return (
    <div>
      <div className="page-header"><div><h2>REPORTS</h2><p>Performance analytics</p></div></div>
      <div className="page-body">
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 20 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ flex: 1, padding: '10px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--display)', letterSpacing: 0.5, textTransform: 'uppercase', background: tab === t.key ? 'var(--kk-green)' : 'var(--surface)', color: tab === t.key ? 'var(--kk-cream)' : 'var(--ink3)', fontWeight: tab === t.key ? 700 : 400, borderRight: '1px solid var(--border)' }}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'labour' && <LabourReport products={products} />}
        {tab === 'customer' && <CustomerReport />}
        {tab === 'product' && <ProductReport />}
      </div>
    </div>
  )
}
