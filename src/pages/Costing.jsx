import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const MARGIN_THRESHOLD = 30 // %
const BULK_CODES = new Set([
  'PBBBu','PCCBu','KLRBu','KABBu','KWALBu','HPCoBu','PVHCBu',
  'VPCANBu','VPBBu','PNFBu','KABISBu','KSCDBu',
])
const LABOUR_PCT_OF_PRICE = 0.22

function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return '$' + n.toFixed(2)
}

export default function Costing() {
  const { isAdmin } = useAuth()
  const [products, setProducts] = useState([])
  const [bom, setBom] = useState([])
  const [rmPriceMap, setRmPriceMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [flagOnly, setFlagOnly] = useState(false)
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('fg') // 'fg' | 'wip'

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: prods }, { data: bomRows }, { data: rms }] = await Promise.all([
      supabase.from('products').select('*').order('category').order('code'),
      supabase.from('bom').select('product_code, rm_name, qty_per_unit, unit'),
      supabase.from('raw_materials').select('name, price_per_unit, unit'),
    ])
    const priceMap = {}
    ;(rms || []).forEach(r => { priceMap[r.name] = { price: r.price_per_unit || 0, unit: r.unit } })
    setProducts(prods || [])
    setBom(bomRows || [])
    setRmPriceMap(priceMap)
    setLoading(false)
  }

  const bomByProduct = useMemo(() => {
    const map = {}
    bom.forEach(b => {
      if (!map[b.product_code]) map[b.product_code] = []
      map[b.product_code].push(b)
    })
    return map
  }, [bom])

  function rmCostFor(code, depth = 0) {
    if (depth > 5) return 0
    const items = bomByProduct[code] || []
    return items.reduce((sum, item) => {
      const isWIP = products.some(p => p.code === item.rm_name && p.category === 'WIP')
      let cost = 0
      if (isWIP) {
        // Get the WIP's total BOM cost
        const wipTotalCost = rmCostFor(item.rm_name, depth + 1)
        // Sum all qty_per_unit in the WIP's BOM to get total yield in gms
        const wipBomItems = bomByProduct[item.rm_name] || []
        const wipYieldGms = wipBomItems.reduce((s, i) => s + (parseFloat(i.qty_per_unit) || 0), 0)
        if (wipYieldGms > 0) {
          // Cost per gram of WIP × qty used
          const costPerGm = wipTotalCost / wipYieldGms
          cost = costPerGm * item.qty_per_unit
        }
      } else {
        const rm = rmPriceMap[item.rm_name] || { price: 0, unit: 'kg' }
        const price = rm.price
        if (item.unit === 'ea') {
          cost = price * item.qty_per_unit
        } else if (rm.unit === 'batch') {
          cost = (item.qty_per_unit / 6000) * price
        } else {
          cost = (item.qty_per_unit / 1000) * price
        }
      }
      return sum + cost
    }, 0)
  }

  function rowFor(p) {
    const rmCost = rmCostFor(p.code)
    const packagingCost = p.packaging_cost_per_unit || 0
    const unitsPerPack = p.units_per_pack || 1
    const listPricePerUnit = (p.price_per_pack || 0) / unitsPerPack
    const labourCost = listPricePerUnit > 0 ? listPricePerUnit * LABOUR_PCT_OF_PRICE : null
    const totalCost = rmCost + packagingCost + (labourCost || 0)
    const marginDollar = listPricePerUnit > 0 ? listPricePerUnit - totalCost : null
    const marginPct = listPricePerUnit > 0 ? (marginDollar / listPricePerUnit) * 100 : null
    return { rmCost, packagingCost, unitsPerPack, listPricePerUnit, labourCost, totalCost, marginDollar, marginPct }
  }

  // Split products into FG and WIP
  const fgProducts = useMemo(() => products.filter(p => p.category !== 'WIP' && !BULK_CODES.has(p.code)), [products])
  const bulkProducts = useMemo(() => products.filter(p => BULK_CODES.has(p.code)), [products])
  const wipProducts = useMemo(() => products.filter(p => p.category === 'WIP'), [products])

  const fgCategories = useMemo(() => {
    const set = new Set(fgProducts.map(p => p.category).filter(Boolean))
    return ['all', ...Array.from(set).sort()]
  }, [fgProducts])

  const filteredFG = useMemo(() => {
    return fgProducts.filter(p => {
      if (catFilter !== 'all' && p.category !== catFilter) return false
      if (search && !(p.name?.toLowerCase().includes(search.toLowerCase()) || p.code?.toLowerCase().includes(search.toLowerCase()))) return false
      if (flagOnly) {
        const r = rowFor(p)
        if (r.marginPct === null || r.marginPct >= MARGIN_THRESHOLD) return false
      }
      return true
    })
  }, [fgProducts, search, catFilter, flagOnly, bomByProduct, rmPriceMap])

  const filteredBulk = useMemo(() => {
    if (!search) return bulkProducts
    return bulkProducts.filter(p =>
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.code?.toLowerCase().includes(search.toLowerCase())
    )
  }, [bulkProducts, search])

  const filteredWIP = useMemo(() => {
    if (!search) return wipProducts
    return wipProducts.filter(p =>
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.code?.toLowerCase().includes(search.toLowerCase())
    )
  }, [wipProducts, search])

  async function savePackagingCost(code, value) {
    const num = value === '' ? null : parseFloat(value)
    await supabase.from('products').update({ packaging_cost_per_unit: num }).eq('code', code)
    setProducts(prev => prev.map(p => p.code === code ? { ...p, packaging_cost_per_unit: num } : p))
  }

  async function saveListPricePerUnit(p, value) {
    const perUnit = value === '' ? 0 : parseFloat(value)
    const unitsPerPack = p.units_per_pack || 1
    const newPricePerPack = Math.round(perUnit * unitsPerPack * 100) / 100
    await supabase.from('products').update({ price_per_pack: newPricePerPack }).eq('code', p.code)
    setProducts(prev => prev.map(x => x.code === p.code ? { ...x, price_per_pack: newPricePerPack } : x))
  }

  async function saveWIPPrice(code, value) {
    const num = value === '' ? null : parseFloat(value)
    // Save to products table
    await supabase.from('products').update({ price_per_pack: num }).eq('code', code)
    // Sync to raw_materials so BOM costing picks it up for finished goods that use this WIP
    await supabase.from('raw_materials').update({ price_per_unit: num || 0 }).eq('name', code)
    setProducts(prev => prev.map(p => p.code === code ? { ...p, price_per_pack: num } : p))
    setRmPriceMap(prev => ({ ...prev, [code]: { ...(prev[code] || {}), price: num || 0 } }))
  }

  const sel = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)' }
  const editInput = { width: 70, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11, background: 'var(--surface)', color: 'var(--ink)', textAlign: 'right' }

  const flaggedCount = useMemo(() => fgProducts.filter(p => {
    const r = rowFor(p)
    return r.marginPct !== null && r.marginPct < MARGIN_THRESHOLD
  }).length, [fgProducts, bomByProduct, rmPriceMap])

  const avgMargin = useMemo(() => {
    const withPrice = fgProducts.map(p => rowFor(p)).filter(r => r.marginPct !== null)
    if (withPrice.length === 0) return null
    return withPrice.reduce((s, r) => s + r.marginPct, 0) / withPrice.length
  }, [fgProducts, bomByProduct, rmPriceMap])

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: 'var(--ink3)' }}>Loading product costing...</div>

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, letterSpacing: 1, margin: '0 0 4px' }}>Product Costing</h2>
        <p style={{ color: 'var(--ink3)', fontSize: 12, margin: 0 }}>
          RM auto-calculated from BOM · Labour = {(LABOUR_PCT_OF_PRICE * 100).toFixed(0)}% of list price
        </p>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 20, maxWidth: 320 }}>
        {[{ key: 'fg', label: `📦 Finished Goods (${fgProducts.length})` }, { key: 'bulk', label: `🧺 Bulk (${bulkProducts.length})` }, { key: 'wip', label: `🏭 WIP (${wipProducts.length})` }].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSearch(''); setCatFilter('all'); setFlagOnly(false) }}
            style={{ flex: 1, padding: '10px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--display)', letterSpacing: 0.5, textTransform: 'uppercase', background: tab === t.key ? 'var(--kk-green)' : 'var(--surface)', color: tab === t.key ? 'var(--kk-cream)' : 'var(--ink3)', fontWeight: tab === t.key ? 700 : 400, borderRight: '1px solid var(--border)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── FINISHED GOODS TAB ── */}
      {tab === 'fg' && (<>
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
          <div className="stat">
            <div className="stat-label">Products Tracked</div>
            <div className="stat-value">{fgProducts.length}</div>
          </div>
          <div className="stat" style={{ borderTop: '3px solid ' + (avgMargin === null ? 'var(--border)' : avgMargin >= 50 ? 'var(--kk-green)' : avgMargin >= MARGIN_THRESHOLD ? 'var(--kk-peach)' : 'var(--red)') }}>
            <div className="stat-label">Avg Margin (priced items)</div>
            <div className="stat-value">{avgMargin === null ? '—' : avgMargin.toFixed(1) + '%'}</div>
          </div>
          <div className="stat" style={{ borderTop: '3px solid ' + (flaggedCount > 0 ? 'var(--red)' : 'var(--kk-green)') }}>
            <div className="stat-label">Below {MARGIN_THRESHOLD}% Margin</div>
            <div className="stat-value" style={{ color: flaggedCount > 0 ? 'var(--red)' : 'inherit' }}>{flaggedCount}</div>
            <div className="stat-sub">{flaggedCount > 0 ? '🔴 Needs review' : '🟢 All healthy'}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Search product..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...sel, width: 200 }} />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={sel}>
            {fgCategories.map(c => <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={flagOnly} onChange={e => setFlagOnly(e.target.checked)} />
            Flagged only
          </label>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th><th>Product</th><th>RM Cost</th><th>Packaging /u</th>
                  <th>Labour /u ({(LABOUR_PCT_OF_PRICE * 100).toFixed(0)}%)</th>
                  <th>Total Cost</th><th>List Price /u</th><th>Margin %</th>
                </tr>
              </thead>
              <tbody>
                {filteredFG.map(p => {
                  const r = rowFor(p)
                  const flagged = r.marginPct !== null && r.marginPct < MARGIN_THRESHOLD
                  return (
                    <tr key={p.code} style={flagged ? { background: 'rgba(200,60,60,0.06)' } : {}}>
                      <td><span className="code-tag" style={{ cursor: 'pointer' }} onClick={() => setSelected(p.code)}>{p.code}</span></td>
                      <td style={{ fontWeight: 500, cursor: 'pointer' }} onClick={() => setSelected(p.code)}>{p.name}</td>
                      <td style={{ color: 'var(--ink2)' }}>{fmt(r.rmCost)}</td>
                      <td>{isAdmin ? <input type="number" step="0.01" style={editInput} defaultValue={p.packaging_cost_per_unit || ''} onBlur={e => savePackagingCost(p.code, e.target.value)} /> : fmt(r.packagingCost)}</td>
                      <td style={{ color: 'var(--ink2)' }}>{r.labourCost === null ? '—' : fmt(r.labourCost)}</td>
                      <td style={{ fontFamily: 'var(--display)', fontSize: 13 }}>{fmt(r.totalCost)}</td>
                      <td>{isAdmin ? <input type="number" step="0.01" style={editInput} defaultValue={r.listPricePerUnit ? r.listPricePerUnit.toFixed(2) : ''} onBlur={e => saveListPricePerUnit(p, e.target.value)} /> : fmt(r.listPricePerUnit)}</td>
                      <td>
                        {r.marginPct === null
                          ? <span style={{ color: 'var(--ink3)', fontSize: 11 }}>No price set</span>
                          : <span style={{ fontFamily: 'var(--display)', fontSize: 13, color: r.marginPct >= 50 ? 'var(--kk-green)' : r.marginPct >= MARGIN_THRESHOLD ? 'var(--kk-peach)' : 'var(--red)' }}>
                              {flagged && '🔴 '}{r.marginPct.toFixed(1)}%
                            </span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>)}

      {/* ── BULK TAB ── */}
      {tab === 'bulk' && (<>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <input placeholder="Search bulk..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...sel, width: 200 }} />
        </div>
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th><th>Product</th><th>RM Cost</th>
                  <th>Labour /u ({(LABOUR_PCT_OF_PRICE * 100).toFixed(0)}%)</th>
                  <th>Total Cost</th><th>List Price /u</th><th>Margin %</th>
                </tr>
              </thead>
              <tbody>
                {filteredBulk.map(p => {
                  const rmCost = rmCostFor(p.code)
                  const unitsPerPack = p.units_per_pack || 1
                  const listPricePerUnit = (p.price_per_pack || 0) / unitsPerPack
                  const labourCost = listPricePerUnit > 0 ? listPricePerUnit * LABOUR_PCT_OF_PRICE : null
                  const totalCost = rmCost + (labourCost || 0) // no packaging for bulk
                  const marginDollar = listPricePerUnit > 0 ? listPricePerUnit - totalCost : null
                  const marginPct = listPricePerUnit > 0 ? (marginDollar / listPricePerUnit) * 100 : null
                  const flagged = marginPct !== null && marginPct < MARGIN_THRESHOLD
                  return (
                    <tr key={p.code} style={flagged ? { background: 'rgba(200,60,60,0.06)' } : {}}>
                      <td><span className="code-tag" style={{ cursor: 'pointer' }} onClick={() => setSelected(p.code)}>{p.code}</span></td>
                      <td style={{ fontWeight: 500, cursor: 'pointer' }} onClick={() => setSelected(p.code)}>{p.name}</td>
                      <td style={{ color: 'var(--ink2)' }}>{fmt(rmCost)}</td>
                      <td style={{ color: 'var(--ink2)' }}>{labourCost === null ? '—' : fmt(labourCost)}</td>
                      <td style={{ fontFamily: 'var(--display)', fontSize: 13 }}>{fmt(totalCost)}</td>
                      <td>{isAdmin ? <input type="number" step="0.01" style={editInput} defaultValue={listPricePerUnit ? listPricePerUnit.toFixed(2) : ''} onBlur={e => saveListPricePerUnit(p, e.target.value)} /> : fmt(listPricePerUnit)}</td>
                      <td>
                        {marginPct === null
                          ? <span style={{ color: 'var(--ink3)', fontSize: 11 }}>No price set</span>
                          : <span style={{ fontFamily: 'var(--display)', fontSize: 13, color: marginPct >= 50 ? 'var(--kk-green)' : marginPct >= MARGIN_THRESHOLD ? 'var(--kk-peach)' : 'var(--red)' }}>
                              {flagged && '🔴 '}{marginPct.toFixed(1)}%
                            </span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>)}

      {/* ── WIP TAB ── */}
      {tab === 'wip' && (<>
        <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--ink3)' }}>
          🏭 WIP intermediates — RM cost calculated from BOM · List price to be set later
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <input placeholder="Search WIP..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...sel, width: 200 }} />
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Product</th>
                  <th>Unit</th>
                  <th>RM Cost /u</th>
                  <th>List Price /u</th>
                  <th>BOM Items</th>
                </tr>
              </thead>
              <tbody>
                {filteredWIP.map(p => {
                  const rmCost = rmCostFor(p.code)
                  const bomItems = bomByProduct[p.code] || []
                  const listPrice = p.price_per_pack || null
                  return (
                    <tr key={p.code}>
                      <td><span className="code-tag" style={{ cursor: 'pointer' }} onClick={() => setSelected(p.code)}>{p.code}</span></td>
                      <td style={{ fontWeight: 500, cursor: 'pointer' }} onClick={() => setSelected(p.code)}>{p.name}</td>
                      <td><span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: p.wip_unit === 'ea' ? 'var(--green-l)' : 'var(--blue-l)', color: p.wip_unit === 'ea' ? 'var(--kk-green)' : 'var(--blue)' }}>{p.wip_unit || '—'}</span></td>
                      <td style={{ color: 'var(--ink2)' }}>{rmCost > 0 ? fmt(rmCost) : <span style={{ color: 'var(--ink3)', fontSize: 11 }}>No BOM</span>}</td>
                      <td>
                        {isAdmin
                          ? <input type="number" step="0.01" style={editInput} defaultValue={listPrice || ''} placeholder="Set price" onBlur={e => saveWIPPrice(p.code, e.target.value)} />
                          : listPrice ? fmt(listPrice) : <span style={{ color: 'var(--ink3)', fontSize: 11 }}>Not set</span>
                        }
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--ink3)' }}>{bomItems.length > 0 ? `${bomItems.length} ingredients` : <span style={{ color: 'var(--red)' }}>No BOM</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>)}

      {/* ── DETAIL MODAL ── */}
      {selected && (() => {
        const p = products.find(x => x.code === selected)
        if (!p) return null
        const r = rowFor(p)
        const bomItems = bomByProduct[p.code] || []
        const isWIP = p.category === 'WIP'
        return (
          <div className="modal-bg" onClick={() => setSelected(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setSelected(null)}>×</button>
              <div className="modal-title">{p.name}</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 16 }}>
                <span className="code-tag">{p.code}</span> · {p.category}{isWIP && p.wip_unit ? ` · ${p.wip_unit}` : ''}
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: 11, letterSpacing: 1, color: 'var(--ink3)', marginBottom: 8 }}>RAW MATERIALS</div>
                {bomItems.length === 0
                  ? <div style={{ fontSize: 12, color: 'var(--ink3)' }}>No BOM defined</div>
                  : bomItems.map((b, i) => {
                      const isWIPIngredient = products.some(prod => prod.code === b.rm_name && prod.category === 'WIP')
                      let cost = 0
                      if (isWIPIngredient) {
                        const wipTotal = rmCostFor(b.rm_name, 1)
                        const wipBom = bomByProduct[b.rm_name] || []
                        const wipYield = wipBom.reduce((s, i) => s + (parseFloat(i.qty_per_unit) || 0), 0)
                        if (wipYield > 0) cost = (wipTotal / wipYield) * b.qty_per_unit
                      } else {
                        const rm = rmPriceMap[b.rm_name] || { price: 0, unit: 'kg' }
                        if (b.unit === 'ea') cost = rm.price * b.qty_per_unit
                        else if (rm.unit === 'batch') cost = (b.qty_per_unit / 6000) * rm.price
                        else cost = (b.qty_per_unit / 1000) * rm.price
                      }
                      const label = isWIPIngredient ? `${b.rm_name} (${b.qty_per_unit}${b.unit}) [WIP]` : `${b.rm_name} (${b.qty_per_unit}${b.unit})`
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ color: isWIPIngredient ? 'var(--kk-peach)' : 'inherit' }}>{label}</span>
                          <span style={{ color: 'var(--ink2)' }}>{fmt(cost)}</span>
                        </div>
                      )
                    })
                }
              </div>

              {isWIP ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  <Row label="RM Cost" value={fmt(r.rmCost)} />
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--display)', fontSize: 15 }}>
                    <span>TOTAL RM COST</span>
                    <span style={{ color: 'var(--kk-brown)' }}>{fmt(r.rmCost)}</span>
                  </div>
                  <Row label="List Price" value={p.price_per_pack ? fmt(p.price_per_pack) : 'Not set yet'} />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, marginBottom: 16 }}>
                  <Row label="RM Cost" value={fmt(r.rmCost)} />
                  <Row label="Packaging Cost" value={fmt(r.packagingCost)} />
                  <Row label={`Labour Cost (${(LABOUR_PCT_OF_PRICE * 100).toFixed(0)}% of list price)`} value={r.labourCost === null ? 'Set list price' : fmt(r.labourCost)} />
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--display)', fontSize: 15 }}>
                    <span>TOTAL COST /u</span>
                    <span style={{ color: 'var(--kk-brown)' }}>{fmt(r.totalCost)}</span>
                  </div>
                  <Row label="List Price /u" value={fmt(r.listPricePerUnit)} sub={`= price_per_pack (${fmt(p.price_per_pack)}) ÷ ${r.unitsPerPack} unit(s)/pack`} />
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--display)', fontSize: 16 }}>
                    <span>MARGIN</span>
                    <span style={{ color: r.marginPct === null ? 'var(--ink3)' : r.marginPct >= 50 ? 'var(--kk-green)' : r.marginPct >= MARGIN_THRESHOLD ? 'var(--kk-peach)' : 'var(--red)' }}>
                      {r.marginPct === null ? '—' : `${fmt(r.marginDollar)} (${r.marginPct.toFixed(1)}%)`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function Row({ label, value, sub }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <div style={{ color: 'var(--ink2)' }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{sub}</div>}
      </div>
      <span>{value}</span>
    </div>
  )
}
