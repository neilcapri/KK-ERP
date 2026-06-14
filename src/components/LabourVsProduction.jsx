import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PACK_SIZE = {
  PBB:2, PCC:2, KLR:2, VPCAN:3, PNF:3, VPB:3,
  KAB:5, KWAL:5, HPCo:5, PVHC:5, KABIS:5, KSCD:4,
  VPBD:2, KHD:2, PVBRG:1, KCOC:1, PVBR:1,
  CMC:1, LMC:1, PRMC:1, TMC:1, KCC:1, KVC:1,
  KLRCup:1, KCCKE:1, KVCKE:1, KLRCKE:1,
  NALCOB:1, NBFB:1, PVBB:1, GBL:1, KPL:1,
}

function sellableQty(code, units) {
  const ps = PACK_SIZE[code]
  if (!ps || !units) return units
  return Math.round(units / ps)
}

function getRange(period, customDate) {
  if (customDate) {
    return { start: customDate, end: customDate }
  }
  const now = new Date()
  if (period === 'day') {
    const today = now.toISOString().split('T')[0]
    return { start: today, end: today }
  }
  if (period === 'week') {
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    monday.setHours(0,0,0,0)
    return { start: monday.toISOString().split('T')[0], end: now.toISOString().split('T')[0] }
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: start.toISOString().split('T')[0], end: now.toISOString().split('T')[0] }
  }
}

export default function LabourVsProduction() {
  const [period, setPeriod] = useState('week')
  const [customDate, setCustomDate] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load(period, customDate) }, [period, customDate])

  async function load(p, cd) {
    setLoading(true)
    try {
      const { start, end } = getRange(p, cd || null)

      // ── 1. Labour cost ──
      const { data: entries } = await supabase
        .from('time_entries')
        .select('employee_id, hours_worked, clock_in')
        .gte('clock_in', start + 'T00:00:00')
        .lte('clock_in', end + 'T23:59:59')

      let labourCost = 0, totalHours = 0
      if (entries?.length) {
        const empIds = [...new Set(entries.map(e => e.employee_id))]
        const { data: emps } = await supabase.from('employees').select('id, hourly_rate').in('id', empIds)
        const rateMap = {}
        ;(emps || []).forEach(e => { rateMap[e.id] = e.hourly_rate || 0 })
        entries.forEach(e => {
          const hours = e.hours_worked || 0
          totalHours += hours
          labourCost += hours * (rateMap[e.employee_id] || 0)
        })
      }

      // ── 2. Production value ──
      const { data: prods } = await supabase
        .from('productions')
        .select('product_code, output_units, date')
        .gte('date', start)
        .lte('date', end)

      let prodValue = 0, totalUnits = 0
      if (prods?.length) {
        const codes = [...new Set(prods.map(p => p.product_code))]
        const { data: products } = await supabase.from('products').select('code, price_per_pack').in('code', codes)
        const priceMap = {}
        ;(products || []).forEach(p => { priceMap[p.code] = p.price_per_pack || 0 })
        prods.forEach(p => {
          totalUnits += p.output_units || 0
          const packs = sellableQty(p.product_code, p.output_units)
          prodValue += packs * (priceMap[p.product_code] || 0)
        })
      }

      // ── 3. Dispatch value ──
      const { data: dispatches } = await supabase
        .from('dispatches')
        .select('id')
        .gte('date', start)
        .lte('date', end)

      let dispatchValue = 0
      if (dispatches?.length) {
        const ids = dispatches.map(d => d.id)
        const { data: dispItems } = await supabase
          .from('dispatch_items')
          .select('product_code, qty, dispatch_type, units_dispatched')
          .in('dispatch_id', ids)

        if (dispItems?.length) {
          const dcodes = [...new Set(dispItems.map(i => i.product_code))]
          const { data: dprods } = await supabase.from('products').select('code, price_per_pack').in('code', dcodes)
          const dpriceMap = {}
          ;(dprods || []).forEach(p => { dpriceMap[p.code] = p.price_per_pack || 0 })
          dispItems.forEach(item => {
            const packs = item.dispatch_type === 'bulk'
              ? 1
              : item.qty || sellableQty(item.product_code, item.units_dispatched)
            dispatchValue += packs * (dpriceMap[item.product_code] || 0)
          })
        }
      }

      // ── 4. Packing value (auto-packing runs for dispatch) ──
      const { data: packRuns } = await supabase
        .from('packing_runs')
        .select('product_code, packs_produced')
        .gte('date', start)
        .lte('date', end)
        .eq('notes', 'Auto-packed for dispatch')

      let packingValue = 0
      if (packRuns?.length) {
        const pcodes = [...new Set(packRuns.map(r => r.product_code))]
        const { data: pprods } = await supabase.from('products').select('code, price_per_pack').in('code', pcodes)
        const ppriceMap = {}
        ;(pprods || []).forEach(p => { ppriceMap[p.code] = p.price_per_pack || 0 })
        packRuns.forEach(r => {
          packingValue += (r.packs_produced || 0) * (ppriceMap[r.product_code] || 0)
        })
      }

      const ratio = labourCost > 0 && prodValue > 0 ? (labourCost / prodValue * 100) : 0
      setData({ labourCost, prodValue, totalHours, totalUnits, ratio, dispatchValue, packingValue })
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

  const box = (label, value, sub, color) => (
    <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: '12px 16px' }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--display)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--display)', fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div className="card-title" style={{ margin: 0 }}>💰 Operations Summary</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {[['day','Today'],['week','This Week'],['month','This Month']].map(([key,label]) => (
            <button key={key} style={btnStyle(period === key && !customDate)} onClick={() => { setPeriod(key); setCustomDate('') }}>{label}</button>
          ))}
          <input
            type="date"
            value={customDate}
            onChange={e => { setCustomDate(e.target.value); setPeriod('') }}
            style={{ padding: '4px 8px', borderRadius: 20, border: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--mono)', background: customDate ? 'var(--kk-green)' : 'var(--surface)', color: customDate ? 'var(--kk-cream)' : 'var(--ink3)', cursor: 'pointer', outline: 'none' }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--ink3)' }}>Loading...</div>
      ) : !data ? null : (
        <div>
          {/* 5 boxes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
            {box('Labour Cost', '$' + data.labourCost.toFixed(0), data.totalHours.toFixed(1) + ' hrs worked', 'var(--red)')}
            {box('Production Value', '$' + data.prodValue.toFixed(0), data.totalUnits.toLocaleString() + ' units produced', 'var(--kk-green)')}
            {box('Labour %', data.prodValue > 0 ? data.ratio.toFixed(1) + '%' : '—',
              data.ratio > 30 ? '⚠️ High' : data.ratio > 20 ? '~ Watch' : data.prodValue > 0 ? '✅ Healthy' : 'No data',
              data.ratio > 30 ? 'var(--red)' : data.ratio > 20 ? 'var(--amber)' : 'var(--kk-green)'
            )}
            {box('Dispatch Value', '$' + data.dispatchValue.toFixed(0), 'retail value shipped', 'var(--blue)')}
            {box('Packing Value', '$' + data.packingValue.toFixed(0), 'auto-packed for dispatch', 'var(--purple)')}
          </div>

          {/* Ratio bar */}
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
                For every $1 of labour → ${data.labourCost > 0 ? (data.prodValue / data.labourCost).toFixed(2) : '—'} in production value
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
