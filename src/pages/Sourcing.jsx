// ── SOURCING ─────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export function Sourcing() {
  const { profile, isAdmin } = useAuth()
  const [rms, setRMs] = useState([])
  const [entries, setEntries] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [files, setFiles] = useState([])
  const [deletingId, setDeletingId] = useState(null)
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], rm_name: '', supplier: '', qty: '', unit: 'kg', batch: '', cost: '' })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [r, e] = await Promise.all([
      supabase.from('raw_materials').select('name,category,stock,unit,min_stock,supplier').order('name'),
      supabase.from('sourcing').select('*').order('created_at', { ascending: false }).limit(50),
    ])
    setRMs(r.data || [])
    setEntries(e.data || [])
  }

  async function saveSourcing() {
    const { date, rm_name, supplier, qty, unit, batch, cost } = form
    if (!rm_name || !qty) { alert('Fill in raw material and quantity.'); return }
    const q = parseFloat(qty)
    const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', rm_name).single()
    if (rm) await supabase.from('raw_materials').update({ stock: (rm.stock || 0) + q }).eq('name', rm_name)
    await supabase.from('sourcing').insert({ date, rm_name, supplier, qty_received: q, unit, batch_number: batch, cost: parseFloat(cost) || 0, image_urls: [], created_by_name: profile?.name })
    await supabase.from('activity').insert({ type: 'sourcing', title: `${rm_name} received`, description: `${q} ${unit} from ${supplier}`, created_by_name: profile?.name })
    setShowModal(false)
    setForm({ date: new Date().toISOString().split('T')[0], rm_name: '', supplier: '', qty: '', unit: 'kg', batch: '', cost: '' })
    setFiles([])
    loadData()
  }

  async function deleteSourcing(entry) {
    if (!window.confirm(`Delete sourcing entry for ${entry.rm_name} (+${entry.qty_received} ${entry.unit}) on ${entry.date}?\n\nThis will reverse the stock change.`)) return
    setDeletingId(entry.id)
    try {
      // Reverse RM stock
      const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', entry.rm_name).single()
      if (rm) await supabase.from('raw_materials').update({ stock: Math.max(0, rm.stock - entry.qty_received) }).eq('name', entry.rm_name)
      // Delete record
      await supabase.from('sourcing').delete().eq('id', entry.id)
      await supabase.from('activity').insert({
        type: 'sourcing', title: `Sourcing Deleted: ${entry.rm_name}`,
        description: `${entry.qty_received} ${entry.unit} reversed · ${entry.date}`,
        created_by_name: profile?.name || 'admin'
      })
      loadData()
    } catch(err) { alert('Delete failed: ' + err.message) }
    setDeletingId(null)
  }

  const zero = rms.filter(r => r.stock <= 0).length
  const low = rms.filter(r => r.stock > 0 && r.stock <= r.min_stock).length

  return (
    <>
      <div className="page-header">
        <div><h2>SOURCING</h2><p>Raw material intake & stock</p></div>
        <button className="btn btn-amber" onClick={() => setShowModal(true)}>+ Log RM</button>
      </div>
      <div className="page-body">
        <div className="grid4" style={{ marginBottom: 16 }}>
          <div className="stat blue"><div className="stat-label">Total RMs</div><div className="stat-value">{rms.length}</div></div>
          <div className="stat green"><div className="stat-label">In Stock</div><div className="stat-value">{rms.length - zero - low}</div></div>
          <div className="stat amber"><div className="stat-label">Low</div><div className="stat-value">{low}</div></div>
          <div className="stat red"><div className="stat-label">Zero Stock</div><div className="stat-value">{zero}</div></div>
        </div>

        <div className="grid2">
          <div className="card">
            <div className="card-title">Raw Material Stock</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Material</th><th>Stock</th><th>Unit</th><th>Supplier</th><th>Status</th></tr></thead>
                <tbody>
                  {rms.map(r => {
                    const s = r.stock <= 0 ? 'red' : r.stock <= r.min_stock ? 'amber' : 'green'
                    const label = r.stock <= 0 ? '🔴 OUT' : r.stock <= r.min_stock ? '⚠️' : '✅'
                    return (
                      <tr key={r.name}>
                        <td style={{ fontWeight: 500, fontSize: 12 }}>{r.name}</td>
                        <td style={{ fontWeight: 600, color: `var(--${s})` }}>{r.stock?.toFixed(2)}</td>
                        <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{r.unit}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink2)' }}>{r.supplier}</td>
                        <td><span className={`badge badge-${s}`}>{label}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Recent Sourcing</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Material</th><th>Qty</th><th>Supplier</th>{isAdmin && <th>Cost</th>}<th style={{width:60}}></th></tr></thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.id}>
                      <td style={{ fontSize: 11 }}>{e.date}</td>
                      <td style={{ fontWeight: 500, fontSize: 12 }}>{e.rm_name}</td>
                      <td style={{ color: 'var(--green)', fontWeight: 600 }}>+{e.qty_received} {e.unit}</td>
                      <td style={{ fontSize: 11 }}>{e.supplier}</td>
                      {isAdmin && <td style={{ fontSize: 11, color: 'var(--ink3)' }}>{e.cost ? `$${e.cost.toFixed(2)}` : '—'}</td>}
                      <td>
                        <button
                          onClick={() => deleteSourcing(e)}
                          disabled={deletingId === e.id}
                          style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)', opacity: deletingId === e.id ? 0.5 : 1 }}>
                          {deletingId === e.id ? '...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            <div className="modal-title">LOG SOURCING</div>
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">📸 Upload Receipt / Invoice</div>
              <div className="upload-zone" style={{ padding: 20 }}>
                <input type="file" accept="image/*,.pdf" multiple onChange={e => setFiles(Array.from(e.target.files))} />
                <div>🧾</div>
                <div style={{ fontSize: 12, color: 'var(--ink2)' }}>Tap to upload receipt (optional)</div>
              </div>
              {files.length > 0 && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 8 }}>✓ {files.length} file(s) selected</div>}
            </div>
            <div className="field-row">
              <div className="field" style={{ margin: 0 }}><label>Date</label><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
              <div className="field" style={{ margin: 0 }}><label>Batch/Lot #</label><input type="text" value={form.batch} onChange={e => setForm(f => ({ ...f, batch: e.target.value }))} placeholder="Optional" /></div>
            </div>
            <div className="field"><label>Supplier</label><input type="text" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Supplier name" /></div>
            <div className="field"><label>Raw Material</label>
              <select value={form.rm_name} onChange={e => { const rm = rms.find(r=>r.name===e.target.value); setForm(f=>({...f,rm_name:e.target.value,unit:rm?.unit||'kg'})) }}>
                <option value="">Select...</option>
                {rms.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <div className="field" style={{ margin: 0 }}><label>Qty Received</label><input type="number" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} placeholder="0" step="0.001" /></div>
              <div className="field" style={{ margin: 0 }}><label>Unit</label><select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}><option>kg</option><option>g</option><option>L</option><option>ml</option><option>units</option><option>ea</option><option>lbs</option></select></div>
            </div>
            {isAdmin && <div className="field"><label>Total Cost ($)</label><input type="number" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} placeholder="0.00" step="0.01" /></div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-amber btn-full" onClick={saveSourcing}>Save Entry</button>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── ACTIVITY ─────────────────────────────────────────────────
export function Activity() {
  const [activities, setActivities] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadActivity() }, [filter])

  async function loadActivity() {
    setLoading(true)
    let q = supabase.from('activity').select('*').order('created_at', { ascending: false }).limit(50)
    if (filter !== 'all') q = q.eq('type', filter)
    const { data } = await q
    setActivities(data || [])
    setLoading(false)
  }

  const icons = { dispatch: '📋', production: '🏭', sourcing: '📥', stock: '📦', dispatch_deleted: '🗑️', production_deleted: '🗑️' }
  const filters = ['all', 'dispatch', 'production', 'sourcing', 'stock']

  return (
    <>
      <div className="page-header">
        <div><h2>ACTIVITY</h2><p>All recent operations</p></div>
        <button className="btn btn-secondary btn-sm" onClick={loadActivity}>↻ Refresh</button>
      </div>
      <div className="page-body">
        <div className="filter-bar" style={{ marginBottom: 16 }}>
          {filters.map(f => (
            <button key={f} className={`filter-btn ${filter===f?'active':''}`} onClick={() => setFilter(f)}>
              {icons[f] || ''} {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="card">
          {loading ? <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>Loading...</div> :
            activities.length === 0 ? <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>No activity yet.</div> :
            activities.map(a => (
              <div key={a.id} className="activity-item">
                <div className={`activity-icon ${a.type}`}>{icons[a.type] || '•'}</div>
                <div className="activity-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div className="activity-title">{a.title}</div>
                    <span className={`badge badge-${a.type==='dispatch'||a.type==='dispatch_deleted'?'blue':a.type==='production'||a.type==='production_deleted'?'green':a.type==='sourcing'?'amber':'purple'}`}>{a.type}</span>
                  </div>
                  <div className="activity-meta">
                    {a.description} · {new Date(a.created_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {a.created_by_name || '—'}
                  </div>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </>
  )
}

// ── REPORTS ──────────────────────────────────────────────────
export function Reports() {
  const [products, setProducts] = useState([])
  const [rms, setRMs] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeReport, setActiveReport] = useState('fg')

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

  function exportCSV(data, filename) {
    const rows = data.map(r => Object.values(r).join(','))
    const headers = Object.keys(data[0]).join(',')
    const csv = [headers, ...rows].join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = filename
    a.click()
  }

  const PACK_SIZE = { VPB:3,VPCAN:3,PNF:3,PVBRG:1,PVBR:4,PBB:2,PCC:2,KLR:2,KSCD:4,VPBD:2,KHD:2,HPC:5,KABIS:5,KAB:5,KWAL:5,PVHC:5,POS:5,PGCo:5,KCOC:1,KSCO:5,PVBB:1,GBL:1,KPL:1,CCL:1,BAGL:2,Focaccia:1,TRFCS:1,HRCS:1,VSCS:1,NALCOB:1,NBFB:1 }

  return (
    <>
      <div className="page-header">
        <div><h2>REPORTS</h2><p>Inventory & stock reports</p></div>
      </div>
      <div className="page-body">
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {['fg','rm'].map(r => (
            <button key={r} onClick={() => setActiveReport(r)} style={{ padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: activeReport===r?'var(--ink)':'var(--ink3)', borderBottom: activeReport===r?'2px solid var(--ink)':'2px solid transparent', marginBottom: -1 }}>
              {r === 'fg' ? '📦 Finished Goods' : '🌿 Raw Materials'}
            </button>
          ))}
        </div>

        {activeReport === 'fg' && !loading && (
          <div className="card">
            <div className="card-title">
              Finished Goods Inventory — {new Date().toLocaleDateString('en-CA')}
              <button className="btn btn-secondary btn-sm" onClick={() => exportCSV(products.map(p=>({code:p.code,name:p.name,category:p.category,units:p.units,packs:Math.floor(p.units/(PACK_SIZE[p.code]||1)),status:p.units<=0?'OUT':p.units<=p.min_stock?'LOW':'OK'})),'KK_FG_'+new Date().toISOString().split('T')[0]+'.csv')}>Export CSV</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Code</th><th>Product</th><th>Category</th><th>Units</th><th>Packs</th><th>Min Stock</th><th>Status</th></tr></thead>
                <tbody>
                  {products.map(p => {
                    const ps = PACK_SIZE[p.code] || 1
                    const s = p.units <= 0 ? 'red' : p.units <= p.min_stock ? 'amber' : 'green'
                    return (
                      <tr key={p.code}>
                        <td><span className="code-tag">{p.code}</span></td>
                        <td style={{ fontWeight: 500 }}>{p.name}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink3)' }}>{p.category}</td>
                        <td style={{ fontWeight: 600, color: `var(--${s})` }}>{p.units}</td>
                        <td>{Math.floor(p.units / ps)}</td>
                        <td style={{ color: 'var(--ink3)' }}>{p.min_stock}</td>
                        <td><span className={`badge badge-${s}`}>{p.units<=0?'OUT':p.units<=p.min_stock?'LOW':'OK'}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--surface2)', borderRadius: 3, fontSize: 12, display: 'flex', gap: 24 }}>
              <span>Total units: <strong>{products.reduce((s,p)=>s+Math.max(0,p.units),0).toLocaleString()}</strong></span>
              <span style={{ color: 'var(--red)' }}>Out: <strong>{products.filter(p=>p.units<=0).length}</strong></span>
              <span style={{ color: 'var(--amber)' }}>Low: <strong>{products.filter(p=>p.units>0&&p.units<=p.min_stock).length}</strong></span>
            </div>
          </div>
        )}

        {activeReport === 'rm' && !loading && (
          <div className="card">
            <div className="card-title">
              Raw Material Stock — {new Date().toLocaleDateString('en-CA')}
              <button className="btn btn-secondary btn-sm" onClick={() => exportCSV(rms.map(r=>({name:r.name,category:r.category,stock:r.stock,unit:r.unit,supplier:r.supplier,price:r.price_per_unit,status:r.stock<=0?'OUT':r.stock<=r.min_stock?'LOW':'OK'})),'KK_RM_'+new Date().toISOString().split('T')[0]+'.csv')}>Export CSV</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Material</th><th>Category</th><th>Stock</th><th>Unit</th><th>Supplier</th><th>$/Unit</th><th>Status</th></tr></thead>
                <tbody>
                  {rms.map(r => {
                    const s = r.stock <= 0 ? 'red' : r.stock <= r.min_stock ? 'amber' : 'green'
                    return (
                      <tr key={r.name}>
                        <td style={{ fontWeight: 500, fontSize: 12 }}>{r.name}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink3)' }}>{r.category}</td>
                        <td style={{ fontWeight: 600, color: `var(--${s})` }}>{r.stock?.toFixed(3)}</td>
                        <td style={{ color: 'var(--ink3)' }}>{r.unit}</td>
                        <td style={{ fontSize: 11 }}>{r.supplier}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink3)' }}>{r.price_per_unit > 0 ? `$${r.price_per_unit.toFixed(2)}` : '—'}</td>
                        <td><span className={`badge badge-${s}`}>{r.stock<=0?'OUT':r.stock<=r.min_stock?'LOW':'OK'}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--surface2)', borderRadius: 3, fontSize: 12, display: 'flex', gap: 24 }}>
              <span>Total RMs: <strong>{rms.length}</strong></span>
              <span style={{ color: 'var(--red)' }}>Zero stock: <strong>{rms.filter(r=>r.stock<=0).length}</strong></span>
              <span style={{ color: 'var(--amber)' }}>Low: <strong>{rms.filter(r=>r.stock>0&&r.stock<=r.min_stock).length}</strong></span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default Sourcing
