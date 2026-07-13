import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// ── Date helpers ──────────────────────────────────────────────────────────────
function getWeekBounds(date) {
  const d = new Date(date); const day = d.getDay()
  const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  return { start: mon.toISOString().split('T')[0], end: sun.toISOString().split('T')[0] }
}
function lastNMonths(n) {
  const end = new Date(); const start = new Date()
  start.setMonth(start.getMonth() - n)
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
}
function thisYear() {
  const y = new Date().getFullYear()
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}
function fmt(n) { return n == null ? '—' : '$' + parseFloat(n).toFixed(2) }
function fmtH(h) { return h == null ? '—' : parseFloat(h).toFixed(1) + 'h' }
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Shared DateRangePicker ────────────────────────────────────────────────────
function DateRangePicker({ value, onChange }) {
  const inp = { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)' }
  const presets = [
    { key: '1m', label: 'Last Month' },
    { key: '3m', label: '3 Months' },
    { key: 'year', label: 'This Year' },
    { key: 'custom', label: 'Custom' },
  ]
  function apply(key) {
    if (key === '1m') onChange({ preset: '1m', ...lastNMonths(1) })
    else if (key === '3m') onChange({ preset: '3m', ...lastNMonths(3) })
    else if (key === 'year') onChange({ preset: 'year', ...thisYear() })
    else onChange({ preset: 'custom', start: value.start, end: value.end })
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
        <>
          <input type="date" value={value.start} onChange={e => onChange({ ...value, start: e.target.value })} style={inp} />
          <span style={{ color: 'var(--ink3)', fontSize: 12 }}>to</span>
          <input type="date" value={value.end} onChange={e => onChange({ ...value, end: e.target.value })} style={inp} />
        </>
      )}
      {value.preset !== 'custom' && value.start && (
        <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{fmtDate(value.start)} – {fmtDate(value.end)}</span>
      )}
    </div>
  )
}

// ── Labour vs Production Report ───────────────────────────────────────────────
function LabourReport({ products }) {
  const [range, setRange] = useState('week')
  const [weekOf, setWeekOf] = useState(new Date().toISOString().split('T')[0])
  const [monthOf, setMonthOf] = useState(new Date().toISOString().slice(0, 7))
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const inp = { padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)' }

  function getDateRange() {
    if (range === 'week') return getWeekBounds(weekOf)
    if (range === 'month') {
      const [y, m] = monthOf.split('-').map(Number)
      return { start: `${y}-${String(m).padStart(2,'0')}-01`, end: `${y}-${String(m).padStart(2,'0')}-${new Date(y, m, 0).getDate()}` }
    }
    return { start: customStart, end: customEnd }
  }

  async function load() {
    const { start, end } = getDateRange()
    if (!start || !end) return
    setLoading(true)
    const [prodRes, timeRes] = await Promise.all([
      supabase.from('productions').select('date,product_code,output_units').gte('date', start).lte('date', end).order('date'),
      supabase.from('time_entries').select('clock_in,hours_worked,employees(hourly_rate)').gte('clock_in', start + 'T00:00:00').lte('clock_in', end + 'T23:59:59'),
    ])
    const dayProd = {}
    ;(prodRes.data || []).forEach(p => {
      if (!dayProd[p.date]) dayProd[p.date] = { value: 0, units: 0, items: [] }
      const prod = products[p.product_code]
      const pv = prod?.production_value != null ? parseFloat(prod.production_value) : parseFloat(prod?.price_per_pack || 0)
      const upp = prod?.units_per_pack || 1
      const val = Math.round(p.output_units / upp) * pv
      dayProd[p.date].value += val; dayProd[p.date].units += p.output_units || 0
      dayProd[p.date].items.push({ code: p.product_code, units: p.output_units })
    })
    const dayLabour = {}
    ;(timeRes.data || []).forEach(t => {
      const day = t.clock_in?.split('T')[0]; if (!day) return
      if (!dayLabour[day]) dayLabour[day] = { hours: 0, cost: 0 }
      const hrs = parseFloat(t.hours_worked || 0); const rate = parseFloat(t.employees?.hourly_rate || 0)
      dayLabour[day].hours += hrs; dayLabour[day].cost += hrs * rate
    })
    const allDates = [...new Set([...Object.keys(dayProd), ...Object.keys(dayLabour)])].sort()
    setData(allDates.map(date => ({ date, ...dayProd[date] || { value: 0, units: 0, items: [] }, labourHours: dayLabour[date]?.hours || 0, labourCost: dayLabour[date]?.cost || 0 })))
    setLoading(false)
  }

  useEffect(() => { load() }, [range, weekOf, monthOf, customStart, customEnd, products])

  const totals = data.reduce((s, r) => ({ value: s.value + r.value, units: s.units + r.units, labourHours: s.labourHours + r.labourHours, labourCost: s.labourCost + r.labourCost }), { value: 0, units: 0, labourHours: 0, labourCost: 0 })
  const ratio = totals.value > 0 ? (totals.labourCost / totals.value * 100).toFixed(1) : null

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {['week','month','custom'].map(r => (
              <button key={r} onClick={() => setRange(r)} style={{ padding: '7px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--display)', letterSpacing: 0.5, textTransform: 'uppercase', background: range === r ? 'var(--kk-green)' : 'var(--surface)', color: range === r ? 'var(--kk-cream)' : 'var(--ink3)', fontWeight: range === r ? 700 : 400, borderRight: '1px solid var(--border)' }}>{r}</button>
            ))}
          </div>
          {range === 'week' && <input type="date" value={weekOf} onChange={e => setWeekOf(e.target.value)} style={inp} />}
          {range === 'month' && <input type="month" value={monthOf} onChange={e => setMonthOf(e.target.value)} style={inp} />}
          {range === 'custom' && <><input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={inp} /><span style={{ color: 'var(--ink3)', fontSize: 12 }}>to</span><input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={inp} /></>}
        </div>
      </div>
      {data.length > 0 && (
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
          <div className="stat" style={{ borderTop: '3px solid var(--kk-green)' }}><div className="stat-label">Production Value</div><div className="stat-value" style={{ color: 'var(--kk-green)' }}>{fmt(totals.value)}</div><div className="stat-sub">{totals.units.toLocaleString()} units</div></div>
          <div className="stat" style={{ borderTop: '3px solid var(--kk-peach)' }}><div className="stat-label">Labour Cost</div><div className="stat-value" style={{ color: 'var(--kk-peach)' }}>{fmt(totals.labourCost)}</div><div className="stat-sub">{fmtH(totals.labourHours)} worked</div></div>
          <div className="stat" style={{ borderTop: '3px solid ' + (ratio && parseFloat(ratio) < 30 ? 'var(--kk-green)' : ratio && parseFloat(ratio) < 50 ? 'var(--kk-peach)' : 'var(--red)') }}><div className="stat-label">Labour / Production</div><div className="stat-value">{ratio ? ratio + '%' : '—'}</div><div className="stat-sub">{ratio && parseFloat(ratio) < 30 ? '🟢 Efficient' : ratio && parseFloat(ratio) < 50 ? '🟡 Watch' : '🔴 Review'}</div></div>
          <div className="stat"><div className="stat-label">Avg Labour / Hr</div><div className="stat-value">{totals.labourHours > 0 ? fmt(totals.labourCost / totals.labourHours) : '—'}</div><div className="stat-sub">cost per hour</div></div>
        </div>
      )}
      <div className="card">
        {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>Loading...</div> : data.length === 0 ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>No data for this period.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Production Value</th><th>Units</th><th>Labour Hours</th><th>Labour Cost</th><th>Labour %</th><th>Products</th></tr></thead>
            <tbody>
              {data.map(row => {
                const dr = row.value > 0 ? (row.labourCost / row.value * 100) : null
                return (
                  <tr key={row.date}>
                    <td style={{ fontWeight: 600 }}>{new Date(row.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td style={{ color: 'var(--kk-green)', fontWeight: 600 }}>{fmt(row.value)}</td>
                    <td style={{ color: 'var(--ink2)' }}>{row.units.toLocaleString()}</td>
                    <td style={{ color: 'var(--ink2)' }}>{fmtH(row.labourHours)}</td>
                    <td style={{ color: 'var(--kk-peach)', fontWeight: 600 }}>{fmt(row.labourCost)}</td>
                    <td>{dr === null ? <span style={{ color: 'var(--ink3)' }}>—</span> : <span style={{ fontFamily: 'var(--display)', fontSize: 13, color: dr < 30 ? 'var(--kk-green)' : dr < 50 ? 'var(--kk-peach)' : 'var(--red)' }}>{dr.toFixed(1)}%</span>}</td>
                    <td style={{ fontSize: 11 }}>{row.items.slice(0,3).map(i => <span key={i.code} style={{ display: 'inline-block', background: 'var(--surface2)', borderRadius: 3, padding: '1px 5px', marginRight: 3 }}>{i.code} ×{i.units}</span>)}{row.items.length > 3 && <span style={{ color: 'var(--ink3)' }}>+{row.items.length - 3}</span>}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot><tr style={{ background: 'var(--surface2)', fontWeight: 700 }}><td style={{ padding: '10px 14px' }}>TOTAL</td><td style={{ padding: '10px 14px', color: 'var(--kk-green)' }}>{fmt(totals.value)}</td><td style={{ padding: '10px 14px' }}>{totals.units.toLocaleString()}</td><td style={{ padding: '10px 14px' }}>{fmtH(totals.labourHours)}</td><td style={{ padding: '10px 14px', color: 'var(--kk-peach)' }}>{fmt(totals.labourCost)}</td><td style={{ padding: '10px 14px' }}>{ratio ? ratio + '%' : '—'}</td><td></td></tr></tfoot>
          </table></div>
        )}
      </div>
    </div>
  )
}

// ── Customer Performance Report ───────────────────────────────────────────────
function CustomerReport() {
  const [customers, setCustomers] = useState([])
  const [selected, setSelected] = useState('')
  const [dateRange, setDateRange] = useState({ preset: '1m', ...lastNMonths(1) })
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('customers').select('id,name').order('name').then(({ data }) => setCustomers(data || []))
  }, [])

  useEffect(() => { if (selected && dateRange.start && dateRange.end) load() }, [selected, dateRange])

  async function load() {
    setLoading(true)
    const cust = customers.find(c => c.id === selected)
    if (!cust) { setLoading(false); return }
    const { data } = await supabase.from('orders')
      .select('id,dispatch_date,total_value,status,order_items(product_code,packs,price_per_pack)')
      .eq('customer_name', cust.name)
      .gte('dispatch_date', dateRange.start)
      .lte('dispatch_date', dateRange.end)
      .order('dispatch_date', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  const totals = useMemo(() => {
    const val = orders.reduce((s, o) => s + (o.total_value || 0), 0)
    const productMap = {}
    orders.forEach(o => {
      (o.order_items || []).forEach(i => {
        if (!productMap[i.product_code]) productMap[i.product_code] = { packs: 0, value: 0 }
        productMap[i.product_code].packs += i.packs || 0
        productMap[i.product_code].value += (i.packs || 0) * (i.price_per_pack || 0)
      })
    })
    return { value: val, orderCount: orders.length, avgOrder: orders.length ? val / orders.length : 0, productMap }
  }, [orders])

  const topProducts = Object.entries(totals.productMap).sort((a, b) => b[1].value - a[1].value).slice(0, 8)

  const sel = { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', minWidth: 240 }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={selected} onChange={e => setSelected(e.target.value)} style={sel}>
            <option value="">Select customer...</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {!selected ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink3)' }}>Select a customer to view their performance.</div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink3)' }}>Loading...</div>
      ) : orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink3)' }}>No orders found for this customer in the selected period.</div>
      ) : (
        <>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
            <div className="stat" style={{ borderTop: '3px solid var(--kk-green)' }}><div className="stat-label">Total Revenue</div><div className="stat-value" style={{ color: 'var(--kk-green)' }}>{fmt(totals.value)}</div><div className="stat-sub">{dateRange.start} → {dateRange.end}</div></div>
            <div className="stat"><div className="stat-label">Orders</div><div className="stat-value">{totals.orderCount}</div><div className="stat-sub">in period</div></div>
            <div className="stat"><div className="stat-label">Avg Order Value</div><div className="stat-value">{fmt(totals.avgOrder)}</div></div>
            <div className="stat"><div className="stat-label">Top Product</div><div className="stat-value" style={{ fontSize: 18 }}>{topProducts[0] ? topProducts[0][0] : '—'}</div><div className="stat-sub">{topProducts[0] ? fmt(topProducts[0][1].value) : ''}</div></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Top products */}
            <div className="card">
              <div className="card-title">Top Products</div>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead><tr><th style={{ textAlign: 'left', padding: '4px 0', color: 'var(--ink3)', fontSize: 10, letterSpacing: 1 }}>PRODUCT</th><th style={{ textAlign: 'right', padding: '4px 0', color: 'var(--ink3)', fontSize: 10 }}>PACKS</th><th style={{ textAlign: 'right', padding: '4px 0', color: 'var(--ink3)', fontSize: 10 }}>VALUE</th></tr></thead>
                <tbody>
                  {topProducts.map(([code, d]) => (
                    <tr key={code} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 0' }}><span className="code-tag">{code}</span></td>
                      <td style={{ textAlign: 'right', padding: '8px 0', color: 'var(--ink2)' }}>{d.packs}</td>
                      <td style={{ textAlign: 'right', padding: '8px 0', fontWeight: 600, color: 'var(--kk-green)' }}>{fmt(d.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Order history */}
            <div className="card">
              <div className="card-title">Order History</div>
              <div className="table-wrap" style={{ maxHeight: 300 }}>
                <table style={{ width: '100%', fontSize: 12 }}>
                  <thead><tr><th>Date</th><th>Value</th><th>Status</th><th>Items</th></tr></thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 14px' }}>{fmtDate(o.dispatch_date)}</td>
                        <td style={{ padding: '8px 14px', fontWeight: 600, color: 'var(--kk-green)' }}>{fmt(o.total_value)}</td>
                        <td style={{ padding: '8px 14px' }}><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: o.status === 'archived' ? 'var(--surface2)' : 'var(--green-l)', color: o.status === 'archived' ? 'var(--ink3)' : 'var(--kk-green)' }}>{o.status}</span></td>
                        <td style={{ padding: '8px 14px', color: 'var(--ink3)', fontSize: 11 }}>{(o.order_items || []).length} items</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Product Performance Report ────────────────────────────────────────────────
function ProductReport() {
  const [productList, setProductList] = useState([])
  const [selected, setSelected] = useState('')
  const [dateRange, setDateRange] = useState({ preset: '1m', ...lastNMonths(1) })
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('products').select('code,name').neq('category','WIP').order('name').then(({ data }) => setProductList(data || []))
  }, [])

  useEffect(() => { if (selected && dateRange.start && dateRange.end) load() }, [selected, dateRange])

  async function load() {
    setLoading(true)
    const { data: orderItems } = await supabase.from('order_items')
      .select('packs,price_per_pack,orders(customer_name,dispatch_date,status)')
      .eq('product_code', selected)
      .gte('orders.dispatch_date', dateRange.start)
      .lte('orders.dispatch_date', dateRange.end)
    // Filter out nulls (orders outside date range)
    const filtered = (orderItems || []).filter(i => i.orders?.dispatch_date)
    setItems(filtered)
    setLoading(false)
  }

  const totals = useMemo(() => {
    const packs = items.reduce((s, i) => s + (i.packs || 0), 0)
    const value = items.reduce((s, i) => s + (i.packs || 0) * (i.price_per_pack || 0), 0)
    const custMap = {}
    items.forEach(i => {
      const name = i.orders?.customer_name || 'Unknown'
      if (!custMap[name]) custMap[name] = { packs: 0, value: 0 }
      custMap[name].packs += i.packs || 0
      custMap[name].value += (i.packs || 0) * (i.price_per_pack || 0)
    })
    // Group by month
    const monthMap = {}
    items.forEach(i => {
      const month = i.orders?.dispatch_date?.slice(0, 7)
      if (!month) return
      if (!monthMap[month]) monthMap[month] = { packs: 0, value: 0 }
      monthMap[month].packs += i.packs || 0
      monthMap[month].value += (i.packs || 0) * (i.price_per_pack || 0)
    })
    return { packs, value, custMap, monthMap, orderCount: items.length }
  }, [items])

  const topCustomers = Object.entries(totals.custMap).sort((a, b) => b[1].value - a[1].value).slice(0, 8)
  const monthlyData = Object.entries(totals.monthMap).sort((a, b) => a[0].localeCompare(b[0]))
  const sel = { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', minWidth: 240 }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={selected} onChange={e => setSelected(e.target.value)} style={sel}>
            <option value="">Select product...</option>
            {productList.map(p => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
          </select>
          <DateRangePicker value={dateRange} onChange={setDateRange} />
        </div>
      </div>

      {!selected ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink3)' }}>Select a product to view its sales performance.</div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink3)' }}>Loading...</div>
      ) : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink3)' }}>No orders found for this product in the selected period.</div>
      ) : (
        <>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
            <div className="stat" style={{ borderTop: '3px solid var(--kk-green)' }}><div className="stat-label">Total Revenue</div><div className="stat-value" style={{ color: 'var(--kk-green)' }}>{fmt(totals.value)}</div></div>
            <div className="stat"><div className="stat-label">Total Packs Sold</div><div className="stat-value">{totals.packs.toLocaleString()}</div></div>
            <div className="stat"><div className="stat-label">Unique Customers</div><div className="stat-value">{Object.keys(totals.custMap).length}</div></div>
            <div className="stat"><div className="stat-label">Avg Pack Price</div><div className="stat-value">{totals.packs > 0 ? fmt(totals.value / totals.packs) : '—'}</div></div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Top customers */}
            <div className="card">
              <div className="card-title">Top Customers</div>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead><tr><th style={{ textAlign: 'left', padding: '4px 0', color: 'var(--ink3)', fontSize: 10, letterSpacing: 1 }}>CUSTOMER</th><th style={{ textAlign: 'right', padding: '4px 0', color: 'var(--ink3)', fontSize: 10 }}>PACKS</th><th style={{ textAlign: 'right', padding: '4px 0', color: 'var(--ink3)', fontSize: 10 }}>VALUE</th></tr></thead>
                <tbody>
                  {topCustomers.map(([name, d]) => (
                    <tr key={name} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 0', fontWeight: 500 }}>{name}</td>
                      <td style={{ textAlign: 'right', padding: '8px 0', color: 'var(--ink2)' }}>{d.packs}</td>
                      <td style={{ textAlign: 'right', padding: '8px 0', fontWeight: 600, color: 'var(--kk-green)' }}>{fmt(d.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Monthly trend */}
            <div className="card">
              <div className="card-title">Monthly Trend</div>
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead><tr><th style={{ textAlign: 'left', padding: '4px 0', color: 'var(--ink3)', fontSize: 10, letterSpacing: 1 }}>MONTH</th><th style={{ textAlign: 'right', padding: '4px 0', color: 'var(--ink3)', fontSize: 10 }}>PACKS</th><th style={{ textAlign: 'right', padding: '4px 0', color: 'var(--ink3)', fontSize: 10 }}>VALUE</th></tr></thead>
                <tbody>
                  {monthlyData.map(([month, d]) => (
                    <tr key={month} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 0' }}>{new Date(month + '-01T12:00:00').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}</td>
                      <td style={{ textAlign: 'right', padding: '8px 0', color: 'var(--ink2)' }}>{d.packs}</td>
                      <td style={{ textAlign: 'right', padding: '8px 0', fontWeight: 600, color: 'var(--kk-green)' }}>{fmt(d.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Reports Page ─────────────────────────────────────────────────────────
export default function Reports() {
  const [tab, setTab] = useState('labour')
  const [products, setProducts] = useState({})

  useEffect(() => {
    supabase.from('products').select('code,name,price_per_pack,production_value,units_per_pack').then(({ data: p }) => {
      const map = {}
      ;(p || []).forEach(x => { map[x.code] = x })
      setProducts(map)
    })
  }, [])

  const tabs = [
    { key: 'labour', label: '📊 Labour vs Production' },
    { key: 'customer', label: '🏪 Customer Performance' },
    { key: 'product', label: '📦 Product Performance' },
  ]

  return (
    <div>
      <div className="page-header">
        <div><h2>REPORTS</h2><p>Performance analytics</p></div>
      </div>
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
