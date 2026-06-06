import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const PACK_SIZE = { VPB:3,VPCAN:3,PNF:3,PVBRG:1,PVBR:4,PBB:2,PCC:2,KLR:2,KSCD:4,VPBD:2,KHD:2,HPC:5,KABIS:5,KAB:5,KWAL:5,PVHC:5,POS:5,PGCo:5,KCOC:1,KSCO:5,PVBB:1,GBL:1,KPL:1,CCL:1,BAGL:2,Focaccia:1,TRFCS:1,HRCS:1,VSCS:1,NALCOB:1,NBFB:1 }

const DATE_RANGES = [
  { label: '30 Days', days: 30 },
  { label: '3 Months', days: 90 },
  { label: '6 Months', days: 180 },
  { label: '12 Months', days: 365 },
]

export default function Inventory() {
  const { isAdmin, isKitchen } = useAuth()
  const [tab, setTab] = useState('fg')
  const [products, setProducts] = useState([])
  const [rms, setRMs] = useState([])
  const [catFilter, setCatFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [editItem, setEditItem] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [editReason, setEditReason] = useState('')
  const [showAlertsOnly, setShowAlertsOnly] = useState(false)

  // Product detail view
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedRM, setSelectedRM] = useState(null)
  const [dateRange, setDateRange] = useState(30)
  const [productHistory, setProductHistory] = useState({ productions: [], dispatches: [] })
  const [rmHistory, setRMHistory] = useState({ sourcing: [], used: [] })
  const [historyLoading, setHistoryLoading] = useState(false)

  const location = useLocation()

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const tabParam = params.get('tab')
    const filterParam = params.get('filter')
    if (tabParam === 'rm') setTab('rm')
    if (tabParam === 'fg') setTab('fg')
    if (filterParam === 'alerts') setShowAlertsOnly(true)
  }, [location.search])

  useEffect(() => {
    if (selectedProduct) loadProductHistory(selectedProduct, dateRange)
  }, [selectedProduct, dateRange])

  useEffect(() => {
    if (selectedRM) loadRMHistory(selectedRM, dateRange)
  }, [selectedRM, dateRange])

  async function loadData() {
    setLoading(true)
    const [p, r] = await Promise.all([
      supabase.from('products').select('*').order('category').order('code'),
      supabase.from('raw_materials').select('*').order('category').order('name'),
    ])
    setProducts(p.data || [])
    setRMs(r.data || [])
    setLoading(false)
  }

  async function loadProductHistory(code, days) {
    setHistoryLoading(true)
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString().split('T')[0]
    const [prod, disp] = await Promise.all([
      supabase.from('productions').select('*').eq('product_code', code).gte('date', sinceStr).order('date', { ascending: false }),
      supabase.from('dispatch_items').select('*, dispatches(date, customer_name, invoice_number)').eq('product_code', code).order('created_at', { ascending: false }),
    ])
    const filteredDisp = (disp.data || []).filter(d => d.dispatches?.date >= sinceStr)
    setProductHistory({ productions: prod.data || [], dispatches: filteredDisp })
    setHistoryLoading(false)
  }

  async function loadRMHistory(name, days) {
    setHistoryLoading(true)
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceStr = since.toISOString().split('T')[0]
    const [src, bom] = await Promise.all([
      supabase.from('sourcing').select('*').eq('rm_name', name).gte('date', sinceStr).order('date', { ascending: false }),
      supabase.from('bom').select('product_code').eq('rm_name', name),
    ])
    let usedInProd = []
    if (bom.data?.length) {
      const codes = bom.data.map(b => b.product_code)
      const { data: prods } = await supabase.from('productions').select('*').in('product_code', codes).gte('date', sinceStr).order('date', { ascending: false })
      usedInProd = prods || []
    }
    setRMHistory({ sourcing: src.data || [], used: usedInProd })
    setHistoryLoading(false)
  }

  async function saveEdit() {
    const newVal = parseFloat(editVal)
    if (isNaN(newVal)) return
    const table = tab === 'fg' ? 'products' : 'raw_materials'
    const field = tab === 'fg' ? 'units' : 'stock'
    const oldVal = tab === 'fg' ? editItem.units : editItem.stock
    const idField = tab === 'fg' ? 'code' : 'name'
    await supabase.from(table).update({ [field]: newVal }).eq(idField, editItem[idField])
    await supabase.from('stock_adjustments').insert({
      type: tab, item_code: editItem.code || editItem.name,
      item_name: editItem.name || editItem.code,
      old_value: oldVal, new_value: newVal, reason: editReason || 'Manual correction'
    })
    await supabase.from('activity').insert({
      type: 'stock', title: (editItem.code || editItem.name) + ' corrected',
      description: oldVal + ' -> ' + newVal + ' — ' + (editReason || 'Manual correction')
    })
    setEditItem(null); setEditVal(''); setEditReason('')
    loadData()
  }

  const fgCategories = ['all', ...new Set(products.map(p => p.category))]
  const rmCategories = ['all', ...new Set(rms.map(r => r.category))]

  const filteredFG = products.filter(p => {
    if (showAlertsOnly && p.units > p.min_stock) return false
    if (catFilter !== 'all' && p.category !== catFilter) return false
    if (search && !p.code.toLowerCase().includes(search.toLowerCase()) && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const filteredRM = rms.filter(r => {
    if (showAlertsOnly && r.stock > r.min_stock) return false
    if (catFilter !== 'all' && r.category !== catFilter) return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const fgStats = { total: products.reduce((s,p)=>s+Math.max(0,p.units),0), low: products.filter(p=>p.units>0&&p.units<=p.min_stock).length, out: products.filter(p=>p.units<=0).length }
  const rmStats = { total: rms.length, low: rms.filter(r=>r.stock>0&&r.stock<=r.min_stock).length, out: rms.filter(r=>r.stock<=0).length }

  const btnStyle = (active) => ({
    padding: '5px 12px', border: '1px solid var(--border)', borderRadius: 3,
    background: active ? 'var(--ink)' : 'var(--surface)', color: active ? 'var(--paper)' : 'var(--ink3)',
    cursor: 'pointer', fontSize: 11, fontFamily: 'var(--mono)'
  })

  return (
    <>
      <div className="page-header">
        <div><h2>INVENTORY</h2><p>Finished goods & raw materials</p></div>
        <button className="btn btn-secondary btn-sm" onClick={loadData}>↻ Refresh</button>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {['fg','rm'].map(t => (
            <button key={t} onClick={() => { setTab(t); setCatFilter('all'); setSearch(''); setSelectedProduct(null); setSelectedRM(null); }}
              style={{ padding: '12px 24px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: tab===t ? 'var(--ink)' : 'var(--ink3)', borderBottom: tab===t ? '2px solid var(--ink)' : '2px solid transparent', marginBottom: -1 }}>
              {t === 'fg' ? '📦 Finished Goods' : '🌿 Raw Materials'}
            </button>
          ))}
        </div>

        {tab === 'fg' ? (
          <div className="grid4" style={{ marginBottom: 16 }}>
            <div className="stat green"><div className="stat-label">Total Units</div><div className="stat-value">{fgStats.total.toLocaleString()}</div></div>
            <div className="stat"><div className="stat-label">SKUs</div><div className="stat-value">{products.length}</div></div>
            <div className="stat amber"><div className="stat-label">Low Stock</div><div className="stat-value">{fgStats.low}</div></div>
            <div className="stat red"><div className="stat-label">Out of Stock</div><div className="stat-value">{fgStats.out}</div></div>
          </div>
        ) : (
          <div className="grid4" style={{ marginBottom: 16 }}>
            <div className="stat blue"><div className="stat-label">Total RMs</div><div className="stat-value">{rmStats.total}</div></div>
            <div className="stat green"><div className="stat-label">In Stock</div><div className="stat-value">{rmStats.total - rmStats.out - rmStats.low}</div></div>
            <div className="stat amber"><div className="stat-label">Low Stock</div><div className="stat-value">{rmStats.low}</div></div>
            <div className="stat red"><div className="stat-label">Zero Stock</div><div className="stat-value">{rmStats.out}</div></div>
          </div>
        )}

        {showAlertsOnly && (
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px', background:'var(--amber-l)', borderRadius:6, marginBottom:12, fontSize:12, color:'var(--amber)' }}>
            <span>⚠️ Showing low stock & out of stock only</span>
            <button onClick={() => setShowAlertsOnly(false)} style={{ marginLeft:'auto', background:'none', border:'1px solid var(--amber)', color:'var(--amber)', borderRadius:4, padding:'2px 10px', fontSize:11, cursor:'pointer' }}>
              Show all
            </button>
          </div>
        )}
        <div className="filter-bar">
          {(tab === 'fg' ? fgCategories : rmCategories).map(cat => (
            <button key={cat} className={'filter-btn ' + (catFilter===cat?'active':'')} onClick={() => setCatFilter(cat)}>
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
          <input className="search-input" placeholder={'Search ' + (tab==='fg'?'product':'material') + '...'} value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>Loading...</div> : (
          tab === 'fg' ? (
            <div style={{ display: 'grid', gridTemplateColumns: selectedProduct ? '1fr 1fr' : '1fr', gap: 16 }}>
              <div className="stock-grid">
                {filteredFG.map(p => {
                  const ps = PACK_SIZE[p.code] || p.pack_size || 1
                  const cls = p.units <= 0 ? 'critical' : p.units <= p.min_stock ? 'low' : 'healthy'
                  const bar = p.units <= 0 ? 'var(--red)' : p.units <= p.min_stock ? 'var(--amber)' : 'var(--green)'
                  const isSelected = selectedProduct === p.code
                  return (
                    <div key={p.code} className={'stock-item ' + cls}
                      onClick={() => setSelectedProduct(isSelected ? null : p.code)}
                      style={{ cursor: 'pointer', outline: isSelected ? '2px solid var(--ink)' : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div className="si-code">{p.code}</div>
                        {(isAdmin || isKitchen) && <button onClick={e => { e.stopPropagation(); setEditItem(p); setEditVal(String(p.units)); }}
                          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '1px 6px', fontSize: 9, cursor: 'pointer', color: 'var(--ink3)' }}>edit</button>}
                      </div>
                      <div className="si-name">{p.name}</div>
                      <div className="si-units">{p.units}</div>
                      <div className="si-packs">{Math.floor(p.units/ps)}pk · {ps}/pk</div>
                      <div className="stock-bar"><div className="stock-bar-fill" style={{ width: Math.min(100,Math.max(0,p.units/(p.min_stock*2)*100)) + '%', background: bar }} /></div>
                    </div>
                  )
                })}
              </div>

              {selectedProduct && (
                <div className="card" style={{ alignSelf: 'start', position: 'sticky', top: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div className="card-title" style={{ margin: 0 }}>
                      <span className="code-tag">{selectedProduct}</span> History
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {DATE_RANGES.map(r => (
                        <button key={r.days} style={btnStyle(dateRange === r.days)} onClick={() => setDateRange(r.days)}>{r.label}</button>
                      ))}
                      <button onClick={() => setSelectedProduct(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--ink3)' }}>×</button>
                    </div>
                  </div>
                  {historyLoading ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--ink3)' }}>Loading...</div> : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--mono)' }}>🏭 Productions</div>
                        {productHistory.productions.length === 0
                          ? <div style={{ fontSize: 11, color: 'var(--ink3)' }}>None in period</div>
                          : productHistory.productions.map((p, i) => (
                            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                              <div style={{ fontWeight: 600, color: 'var(--green)' }}>+{p.output_units} units</div>
                              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{p.date} · {p.input_qty} {p.input_type}</div>
                              {p.notes && <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{p.notes}</div>}
                            </div>
                          ))
                        }
                      </div>
                      <div>
                        <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--mono)' }}>📋 Dispatches</div>
                        {productHistory.dispatches.length === 0
                          ? <div style={{ fontSize: 11, color: 'var(--ink3)' }}>None in period</div>
                          : productHistory.dispatches.map((d, i) => (
                            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                              <div style={{ fontWeight: 600, color: 'var(--red)' }}>-{d.units_dispatched} units</div>
                              <div style={{ fontSize: 11, color: 'var(--ink2)' }}>{d.dispatches?.customer_name}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{d.dispatches?.date} · {d.qty} {d.dispatch_type}</div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: selectedRM ? '1fr 1fr' : '1fr', gap: 16 }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Raw Material</th><th>Category</th><th>Stock</th><th>Unit</th>
                      <th>Supplier</th><th>Status</th>
                      {isAdmin && <th>$/Unit</th>}
                      {(isAdmin || isKitchen) && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRM.map(r => {
                      const cls = r.stock <= 0 ? 'red' : r.stock <= r.min_stock ? 'amber' : 'green'
                      const label = r.stock <= 0 ? '🔴 OUT' : r.stock <= r.min_stock ? '⚠️ LOW' : '✅ OK'
                      const isSelected = selectedRM === r.name
                      return (
                        <tr key={r.name} onClick={() => setSelectedRM(isSelected ? null : r.name)}
                          style={{ cursor: 'pointer', background: isSelected ? 'var(--surface2)' : '' }}>
                          <td style={{ fontWeight: 500 }}>{r.name}</td>
                          <td><span style={{ fontSize: 10, color: 'var(--ink3)' }}>{r.category}</span></td>
                          <td style={{ fontWeight: 600, color: 'var(--' + cls + ')' }}>{r.stock?.toFixed(3)}</td>
                          <td style={{ color: 'var(--ink3)' }}>{r.unit}</td>
                          <td style={{ fontSize: 11 }}>{r.supplier}</td>
                          <td><span className={'badge badge-' + cls}>{label}</span></td>
                          {isAdmin && <td style={{ color: 'var(--ink3)' }}>{r.price_per_unit > 0 ? '$' + r.price_per_unit.toFixed(2) : '—'}</td>}
                          {(isAdmin || isKitchen) && <td><button onClick={e => { e.stopPropagation(); setEditItem(r); setEditVal(String(r.stock)); }} className="btn btn-secondary btn-sm">edit</button></td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {selectedRM && (
                <div className="card" style={{ alignSelf: 'start', position: 'sticky', top: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div className="card-title" style={{ margin: 0, fontSize: 12 }}>{selectedRM}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {DATE_RANGES.map(r => (
                        <button key={r.days} style={btnStyle(dateRange === r.days)} onClick={() => setDateRange(r.days)}>{r.label}</button>
                      ))}
                      <button onClick={() => setSelectedRM(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--ink3)' }}>×</button>
                    </div>
                  </div>
                  {historyLoading ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--ink3)' }}>Loading...</div> : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--mono)' }}>📥 Sourced</div>
                        {rmHistory.sourcing.length === 0
                          ? <div style={{ fontSize: 11, color: 'var(--ink3)' }}>None in period</div>
                          : rmHistory.sourcing.map((s, i) => (
                            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                              <div style={{ fontWeight: 600, color: 'var(--green)' }}>+{s.qty_received} {s.unit}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink2)' }}>{s.supplier}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{s.date}{s.batch_number ? ' · Lot ' + s.batch_number : ''}</div>
                              {isAdmin && s.cost > 0 && <div style={{ fontSize: 10, color: 'var(--ink3)' }}>${s.cost.toFixed(2)}</div>}
                            </div>
                          ))
                        }
                      </div>
                      <div>
                        <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--mono)' }}>🏭 Used In</div>
                        {rmHistory.used.length === 0
                          ? <div style={{ fontSize: 11, color: 'var(--ink3)' }}>None in period</div>
                          : rmHistory.used.map((p, i) => (
                            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                              <div style={{ fontWeight: 600 }}><span className="code-tag" style={{ fontSize: 10 }}>{p.product_code}</span></div>
                              <div style={{ fontSize: 11, color: 'var(--green)' }}>+{p.output_units} units</div>
                              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{p.date}</div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        )}
      </div>

      {editItem && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setEditItem(null)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setEditItem(null)}>×</button>
            <div className="modal-title">EDIT STOCK</div>
            <div style={{ background: 'var(--surface2)', padding: 14, borderRadius: 3, marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: 'var(--ink3)', letterSpacing: 1, textTransform: 'uppercase' }}>{editItem.code || editItem.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>{editItem.name || editItem.code}</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 28, marginTop: 4 }}>{tab==='fg'?editItem.units:editItem.stock} {tab==='rm'?editItem.unit:'units'}</div>
            </div>
            <div className="field"><label>New Stock ({tab==='rm'?editItem.unit:'units'})</label>
              <input type="number" value={editVal} onChange={e => setEditVal(e.target.value)} step="0.001" style={{ fontSize: 20, textAlign: 'center' }} autoFocus />
            </div>
            <div className="field"><label>Reason</label>
              <input type="text" value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="e.g. Physical count correction" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary btn-full" onClick={saveEdit}>Save</button>
              <button className="btn btn-secondary" onClick={() => setEditItem(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
