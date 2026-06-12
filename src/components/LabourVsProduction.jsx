// LabourVsProduction widget — add to Dashboard.jsx
// Import this component and add it to the Performance tab

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PACK_SIZE = {
  PBB:2, PCC:2, KLR:2, VPCAN:3, PNF:3, VPB:3,
  KAB:5, KWAL:5, HPCo:5, PVHC:5, KABIS:5, KSCD:4, VPBD:2, KHD:2,
}

function sellableQty(code, units) {
  const ps = PACK_SIZE[code]
  if (!ps || !units) return units
  return Math.round(units / ps)
}

function getRange(period) {
  const now = new Date()
  if (period === 'day') {
    const start = new Date(now); start.setHours(0,0,0,0)
    return { start: start.toISOString().split('T')[0], end: now.toISOString().split('T')[0] }
  }
  if (period === 'week') {
    const day = now.getDay()
    const monday = new Date(now); monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1)); monday.setHours(0,0,0,0)
    return { start: monday.toISOString().split('T')[0], end: now.toISOString().split('T')[0] }
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: start.toISOString().split('T')[0], end: now.toISOString().split('T')[0] }
  }
}

export default function LabourVsProduction() {
  const [period, setPeriod] = useState('week')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load(period) }, [period])

  async function load(p) {
    setLoading(true)
    try {
      const { start, end } = getRange(p)

      // 1. Labour cost — from time_entries joined with employees
      const { data: entries } = await supabase
        .from('time_entries')
        .select('employee_id, hours_worked, clock_in')
        .gte('clock_in', start + 'T00:00:00')
        .lte('clock_in', end + 'T23:59:59')

      let labourCost = 0
      let totalHours = 0
      if (entries?.length) {
        const empIds = [...new Set(entries.map(e => e.employee_id))]
        const { data: emps } = await supabase
          .from('employees')
          .select('id, name, hourly_rate')
          .in('id', empIds)
        const rateMap = {}
        ;(emps || []).forEach(e => { rateMap[e.id] = e.hourly_rate || 0 })
        entries.forEach(e => {
          const hours = e.hours_worked || 0
          totalHours += hours
          labourCost += hours * (rateMap[e.employee_id] || 0)
        })
      }

      // 2. Production value — from productions + price_per_pack
      const { data: prods } = await supabase
        .from('productions')
        .select('product_code, output_units, date')
        .gte('date', start)
        .lte('date', end)

      let prodValue = 0
      let totalUnits = 0
      if (prods?.length) {
        const codes = [...new Set(prods.map(p => p.product_code))]
        const { data: products } = await supabase
          .from('products')
          .select('code, price_per_pack')
          .in('code', codes)
        const priceMap = {}
        ;(products || []).forEach(p => { priceMap[p.code] = p.price_per_pack || 0 })
        prods.forEach(p => {
          totalUnits += p.output_units || 0
          const packs = sellableQty(p.product_code, p.output_units)
          prodValue += packs * (priceMap[p.product_code] || 0)
        })
      }

      const ratio = labourCost > 0 ? (labourCost / prodValue * 100) : 0
      setData({ labourCost, prodValue, totalHours, totalUnits, ratio })
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  const btnStyle = (active) => ({
    padding: '4px 12px', borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer',
    fontSize: 11, fontFamily: 'var(--display)', letterSpacing: 0.5,
    background: active ? 'var(--kk-green)' : 'var(--surface)',
    color: active ? 'var(--kk-cream)' : 'var(--ink3)',
    fontWeight: active ? 600 : 400,
  })

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div className="card-title" style={{ margin: 0 }}>💰 Labour vs Production Value</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['day','Today'],['week','This Week'],['month','This Month']].map(([key,label]) => (
            <button key={key} style={btnStyle(period === key)} onClick={() => setPeriod(key)}>{label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--ink3)' }}>Loading...</div>
      ) : !data ? null : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: '12px 16px' }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--display)', marginBottom: 4 }}>Labour Cost</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 800, color: 'var(--red)', lineHeight: 1 }}>${data.labourCost.toFixed(0)}</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>{data.totalHours.toFixed(1)} hrs worked</div>
            </div>
            <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: '12px 16px' }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--display)', marginBottom: 4 }}>Production Value</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 800, color: 'var(--kk-green)', lineHeight: 1 }}>${data.prodValue.toFixed(0)}</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>{data.totalUnits.toLocaleString()} units produced</div>
            </div>
            <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: '12px 16px' }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--display)', marginBottom: 4 }}>Labour % of Value</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 800, color: data.ratio > 30 ? 'var(--red)' : data.ratio > 20 ? 'var(--amber)' : 'var(--kk-green)', lineHeight: 1 }}>
                {data.prodValue > 0 ? data.ratio.toFixed(1) + '%' : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>
                {data.ratio > 30 ? '⚠️ High' : data.ratio > 20 ? '~ Watch' : data.prodValue > 0 ? '✅ Healthy' : 'No production data'}
              </div>
            </div>
          </div>

          {/* Visual bar */}
          {data.prodValue > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink3)', marginBottom: 4, fontFamily: 'var(--mono)' }}>
                <span>Labour ${data.labourCost.toFixed(0)}</span>
                <span>Production value ${data.prodValue.toFixed(0)}</span>
              </div>
              <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: Math.min(100, data.ratio) + '%', background: data.ratio > 30 ? 'var(--red)' : data.ratio > 20 ? 'var(--amber)' : 'var(--kk-green)', borderRadius: 4, transition: 'width 0.4s' }} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 4, textAlign: 'center' }}>
                For every $1 of labour → ${data.prodValue > 0 && data.labourCost > 0 ? (data.prodValue / data.labourCost).toFixed(2) : '—'} in production value
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
