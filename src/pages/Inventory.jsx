import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const PACK_SIZE = { VPB:3,VPCAN:3,PNF:3,PVBRG:1,PVBR:4,PBB:2,PCC:2,KLR:2,KSCD:4,VPBD:2,KHD:2,HPC:5,KABIS:5,KAB:5,KWAL:5,PVHC:5,POS:5,PGCo:5,KCOC:1,KSCO:5,PVBB:1,GBL:1,KPL:1,CCL:1,BAGL:2,Focaccia:1,TRFCS:1,HRCS:1,VSCS:1,NALCOB:1,NBFB:1 }

export default function Inventory() {
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState('fg')
  const [products, setProducts] = useState([])
  const [rms, setRMs] = useState([])
  const [catFilter, setCatFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [editItem, setEditItem] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [editReason, setEditReason] = useState('')

  useEffect(() => { loadData() }, [])

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
      type: 'stock', title: `${editItem.code || editItem.name} corrected`,
      description: `${oldVal} → ${newVal} — ${editReason || 'Manual correction'}`
    })
    setEditItem(null); setEditVal(''); setEditReason('')
    loadData()
  }

  const fgCategories = ['all', ...new Set(products.map(p => p.category))]
  const rmCategories = ['all', ...new Set(rms.map(r => r.category))]

  const filteredFG = products.filter(p => {
    if (catFilter !== 'all' && p.category !== catFilter) return false
    if (search && !p.code.toLowerCase().includes(search.toLowerCase()) && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const filteredRM = rms.filter(r => {
    if (catFilter !== 'all' && r.category !== catFilter) return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const fgStats = { total: products.reduce((s,p)=>s+Math.max(0,p.units),0), low: products.filter(p=>p.units>0&&p.units<=p.min_stock).length, out: products.filter(p=>p.units<=0).length }
  const rmStats = { total: rms.length, low: rms.filter(r=>r.stock>0&&r.stock<=r.min_stock).length, out: rms.filter(r=>r.stock<=0).length }

  return (
    <>
      <div className="page-header">
        <div><h2>INVENTORY</h2><p>Finished goods & raw materials</p></div>
        <button className="btn btn-secondary btn-sm" onClick={loadData}>↻ Refresh</button>
      </div>

      <div className="page-body">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {['fg','rm'].map(t => (
            <button key={t} onClick={() => { setTab(t); setCatFilter('all'); setSearch(''); }}
              style={{ padding: '12px 24px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: tab===t ? 'var(--ink)' : 'var(--ink3)', borderBottom: tab===t ? '2px solid var(--ink)' : '2px solid transparent', marginBottom: -1 }}>
              {t === 'fg' ? '📦 Finished Goods' : '🌿 Raw Materials'}
            </button>
          ))}
        </div>

        {/* Stats */}
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

        {/* Filters */}
        <div className="filter-bar">
          {(tab === 'fg' ? fgCategories : rmCategories).map(cat => (
            <button key={cat} className={`filter-btn ${catFilter===cat?'active':''}`} onClick={() => setCatFilter(cat)}>
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
          <input className="search-input" placeholder={`Search ${tab==='fg'?'product':'material'}...`} value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>Loading...</div> : (

          tab === 'fg' ? (
            <div className="stock-grid">
              {filteredFG.map(p => {
                const ps = PACK_SIZE[p.code] || p.pack_size || 1
                const cls = p.units <= 0 ? 'critical' : p.units <= p.min_stock ? 'low' : 'healthy'
                const bar = p.units <= 0 ? 'var(--red)' : p.units <= p.min_stock ? 'var(--amber)' : 'var(--green)'
                return (
                  <div key={p.code} className={`stock-item ${cls}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div className="si-code">{p.code}</div>
                      {isAdmin && <button onClick={() => { setEditItem(p); setEditVal(String(p.units)); }} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '1px 6px', fontSize: 9, cursor: 'pointer', color: 'var(--ink3)' }}>edit</button>}
                    </div>
                    <div className="si-name">{p.name}</div>
                    <div className="si-units">{p.units}</div>
                    <div className="si-packs">{Math.floor(p.units/ps)}pk · {ps}/pk</div>
                    <div className="stock-bar"><div className="stock-bar-fill" style={{ width: `${Math.min(100,Math.max(0,p.units/(p.min_stock*2)*100))}%`, background: bar }} /></div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Raw Material</th><th>Category</th><th>Stock</th><th>Unit</th>
                    <th>Supplier</th><th>Status</th>
                    {isAdmin && <th>$/Unit</th>}
                    {isAdmin && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredRM.map(r => {
                    const cls = r.stock <= 0 ? 'red' : r.stock <= r.min_stock ? 'amber' : 'green'
                    const label = r.stock <= 0 ? '🔴 OUT' : r.stock <= r.min_stock ? '⚠️ LOW' : '✅ OK'
                    return (
                      <tr key={r.name}>
                        <td style={{ fontWeight: 500 }}>{r.name}</td>
                        <td><span style={{ fontSize: 10, color: 'var(--ink3)' }}>{r.category}</span></td>
                        <td style={{ fontWeight: 600, color: `var(--${cls})` }}>{r.stock?.toFixed(3)}</td>
                        <td style={{ color: 'var(--ink3)' }}>{r.unit}</td>
                        <td style={{ fontSize: 11 }}>{r.supplier}</td>
                        <td><span className={`badge badge-${cls}`}>{label}</span></td>
                        {isAdmin && <td style={{ color: 'var(--ink3)' }}>{r.price_per_unit > 0 ? `$${r.price_per_unit.toFixed(2)}` : '—'}</td>}
                        {isAdmin && <td><button onClick={() => { setEditItem(r); setEditVal(String(r.stock)); }} className="btn btn-secondary btn-sm">edit</button></td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Edit Modal */}
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
