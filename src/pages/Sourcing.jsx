// ── SOURCING ─────────────────────────────────────────────────
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Financials from './Financials'

const API_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.REACT_APP_ANTHROPIC_KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
}

export function Sourcing() {
  const { profile, isAdmin } = useAuth()
  const [rms, setRMs] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [entries, setEntries] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [editingEntry, setEditingEntry] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editSaving, setEditSaving] = useState(false)
  const [lotPhoto, setLotPhoto] = useState(null)
  const [lotPhotoPreview, setLotPhotoPreview] = useState(null)
  const [lotOCR, setLotOCR] = useState('')
  const [ocrLoading, setOcrLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const photoInputRef = useRef(null)

  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    rm_name: '',
    supplier: '',
    qty_bags: '',
    qty_kg: '',
    unit: 'kg',
    manual_entry: false,
    lot_number: '',
  })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [r, e, s] = await Promise.all([
      supabase.from('raw_materials')
        .select('name,category,stock,unit,min_stock,supplier,package_size,package_unit,package_label')
        .not('category', 'eq', 'Packaging')
        .not('category', 'eq', 'WIP')
        .order('name'),
      supabase.from('sourcing').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('suppliers').select('name').order('name'),
    ])
    setRMs(r.data || [])
    setEntries(e.data || [])
    setSuppliers(s.data || [])
  }

  function handleRMChange(name) {
    const rm = rms.find(r => r.name === name)
    const defaultSupplier = rm?.supplier && rm.supplier !== 'TBD' ? rm.supplier : ''
    setForm(f => ({
      ...f,
      rm_name: name,
      supplier: defaultSupplier,
      unit: rm?.unit || 'kg',
      qty_bags: '',
      qty_kg: '',
    }))
  }

  function handleBagsChange(bags) {
    const rm = rms.find(r => r.name === form.rm_name)
    const qty_kg = rm?.package_size ? (parseFloat(bags) * rm.package_size).toFixed(3) : ''
    setForm(f => ({ ...f, qty_bags: bags, qty_kg }))
  }

  function handleManualQtyChange(qty) {
    setForm(f => ({ ...f, qty_kg: qty, qty_bags: '' }))
  }

  async function handleLotPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLotPhoto(file)
    const preview = URL.createObjectURL(file)
    setLotPhotoPreview(preview)
    setOcrLoading(true)
    setLotOCR('')

    try {
      // Convert to base64
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result.split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(file)
      })

      // Use Claude vision to read lot number
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: file.type, data: base64 }
              },
              {
                type: 'text',
                text: 'Look at this food ingredient package label. Extract ONLY the lot number, batch number, or lot code. It may be labelled as LOT, LOT#, LOT NO, BATCH, BEST BY LOT, or similar. Return just the alphanumeric lot number value with no explanation, no label, no punctuation. If you cannot find a lot number, return the word NOTFOUND.'
              }
            ]
          }]
        })
      })
      const data = await response.json()
      const text = data.content?.[0]?.text?.trim()
      if (text && text !== 'NOTFOUND') {
        setLotOCR(text)
        setForm(f => ({ ...f, lot_number: text }))
      } else {
        setLotOCR('')
      }
    } catch (err) {
      console.error('OCR failed', err)
    }
    setOcrLoading(false)
    photoInputRef.current.value = ''
  }

  function openEdit(entry) {
    setEditingEntry(entry)
    setEditForm({
      date: entry.date,
      rm_name: entry.rm_name,
      supplier: entry.supplier || '',
      qty_received: String(entry.qty_received),
      unit: entry.unit,
      lot_number: entry.lot_number || entry.batch_number || '',
    })
  }

  async function saveEdit() {
    if (!editForm.qty_received) { alert('Please enter a quantity.'); return }
    setEditSaving(true)
    try {
      const oldQty = editingEntry.qty_received
      const newQty = parseFloat(editForm.qty_received)
      const diff = newQty - oldQty

      // Adjust stock by the difference
      if (diff !== 0) {
        const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', editingEntry.rm_name).single()
        if (rm) await supabase.from('raw_materials').update({ stock: Math.max(0, rm.stock + diff) }).eq('name', editingEntry.rm_name)
      }

      await supabase.from('sourcing').update({
        date: editForm.date,
        supplier: editForm.supplier,
        qty_received: newQty,
        unit: editForm.unit,
        lot_number: editForm.lot_number,
        batch_number: editForm.lot_number,
      }).eq('id', editingEntry.id)

      await supabase.from('activity').insert({
        type: 'sourcing',
        title: `${editingEntry.rm_name} entry updated`,
        description: `Qty: ${oldQty} → ${newQty} ${editForm.unit}${editForm.lot_number ? ` · Lot: ${editForm.lot_number}` : ''}`,
        created_by_name: profile?.name
      })

      setEditingEntry(null)
      setEditForm({})
      loadData()
    } catch(err) { alert('Update failed: ' + err.message) }
    setEditSaving(false)
  }

  async function saveSourcing() {
    const { date, rm_name, supplier, qty_kg, unit, lot_number } = form
    if (!rm_name || !qty_kg) { alert('Fill in raw material and quantity.'); return }
    setSaving(true)

    try {
      // Upload lot photo if present
      let lot_photo_url = null
      if (lotPhoto) {
        const ext = lotPhoto.name.split('.').pop()
        const path = `lot-photos/${Date.now()}-${rm_name.replace(/\s+/g, '-')}.${ext}`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('sourcing-photos')
          .upload(path, lotPhoto, { contentType: lotPhoto.type })
        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage.from('sourcing-photos').getPublicUrl(path)
          lot_photo_url = publicUrl
        }
      }

      const q = parseFloat(qty_kg)
      const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', rm_name).single()
      if (rm) await supabase.from('raw_materials').update({ stock: (rm.stock || 0) + q }).eq('name', rm_name)

      await supabase.from('sourcing').insert({
        date, rm_name, supplier,
        qty_received: q, unit,
        batch_number: lot_number,
        lot_photo_url,
        lot_number,
        cost: 0,
        image_urls: lot_photo_url ? [lot_photo_url] : [],
        created_by_name: profile?.name
      })

      await supabase.from('activity').insert({
        type: 'sourcing',
        title: `${rm_name} received`,
        description: `${q} ${unit} from ${supplier}${lot_number ? ` · Lot: ${lot_number}` : ''}`,
        created_by_name: profile?.name
      })

      // Reset
      setShowModal(false)
      setForm({ date: new Date().toISOString().split('T')[0], rm_name: '', supplier: '', qty_bags: '', qty_kg: '', unit: 'kg', manual_entry: false, lot_number: '' })
      setLotPhoto(null)
      setLotPhotoPreview(null)
      setLotOCR('')
      loadData()
    } catch (err) {
      alert('Save failed: ' + err.message)
    }
    setSaving(false)
  }

  async function deleteSourcing(entry) {
    if (!window.confirm(`Delete sourcing entry for ${entry.rm_name} (+${entry.qty_received} ${entry.unit}) on ${entry.date}?\n\nThis will reverse the stock change.`)) return
    setDeletingId(entry.id)
    try {
      const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', entry.rm_name).single()
      if (rm) await supabase.from('raw_materials').update({ stock: Math.max(0, rm.stock - entry.qty_received) }).eq('name', entry.rm_name)
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

  const selectedRM = rms.find(r => r.name === form.rm_name)
  const zero = rms.filter(r => r.stock <= 0).length
  const low = rms.filter(r => r.stock > 0 && r.stock <= r.min_stock).length

  const selectStyle = { width: '100%', padding: '12px 14px', fontSize: '14px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--mono)', height: '48px' }

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
                <thead><tr><th>Date</th><th>Material</th><th>Qty</th><th>Supplier</th><th>Lot #</th><th style={{width:60}}></th></tr></thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.id}>
                      <td style={{ fontSize: 11 }}>{e.date}</td>
                      <td style={{ fontWeight: 500, fontSize: 12 }}>{e.rm_name}</td>
                      <td style={{ color: 'var(--green)', fontWeight: 600 }}>+{e.qty_received} {e.unit}</td>
                      <td style={{ fontSize: 11 }}>{e.supplier}</td>
                      <td style={{ fontSize: 11, color: 'var(--ink3)' }}>
                        {e.lot_number || e.batch_number || '—'}
                        {e.lot_photo_url && (
                          <a href={e.lot_photo_url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 4, fontSize: 10, color: 'var(--kk-green)' }}>📷</a>
                        )}
                      </td>
                      <td style={{ display:'flex', gap:4 }}>
                        <button onClick={() => openEdit(e)}
                          style={{ background: 'var(--kk-green)', border: 'none', color: '#fff', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--display)' }}>
                          Edit
                        </button>
                        <button onClick={() => deleteSourcing(e)} disabled={deletingId === e.id}
                          style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer', opacity: deletingId === e.id ? 0.5 : 1 }}>
                          {deletingId === e.id ? '...' : 'Del'}
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
            <div className="modal-title">LOG RM RECEIPT</div>

            {/* Date */}
            <div className="field">
              <label>Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>

            {/* RM Dropdown */}
            <div className="field">
              <label>Raw Material</label>
              <select style={selectStyle} value={form.rm_name} onChange={e => handleRMChange(e.target.value)}>
                <option value="">Select RM...</option>
                {rms.map(r => (
                  <option key={r.name} value={r.name}>
                    {r.name}{r.package_label ? ` (${r.package_label})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Supplier Dropdown */}
            <div className="field">
              <label>Supplier</label>
              <select style={selectStyle} value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}>
                <option value="">Select supplier...</option>
                {suppliers.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>

            {/* Qty — package count or manual */}
            {selectedRM?.package_size && !form.manual_entry ? (
              <div>
                <div className="field">
                  <label>Number of {selectedRM.package_label || 'packages'}</label>
                  <input type="number" value={form.qty_bags} onChange={e => handleBagsChange(e.target.value)} placeholder="0" min="0" step="1" style={{ fontSize: 16, padding: '12px 14px' }} />
                </div>
                {form.qty_bags && form.qty_kg && (
                  <div style={{ background: 'var(--green-l)', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13, color: 'var(--green)' }}>
                    <strong>Total: {form.qty_kg} {selectedRM.unit}</strong>
                    <span style={{ fontSize: 11, color: 'var(--ink3)', marginLeft: 8 }}>
                      ({form.qty_bags} × {selectedRM.package_size}{selectedRM.package_unit})
                    </span>
                  </div>
                )}
                <div style={{ marginBottom: 12 }}>
                  <button style={{ background: 'none', border: 'none', color: 'var(--ink3)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => setForm(f => ({ ...f, manual_entry: true, qty_bags: '' }))}>
                    Enter qty manually instead
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="field-row">
                  <div className="field" style={{ margin: 0 }}>
                    <label>Qty Received</label>
                    <input type="number" value={form.qty_kg} onChange={e => handleManualQtyChange(e.target.value)} placeholder="0" step="0.001" style={{ fontSize: 16, padding: '12px 14px' }} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Unit</label>
                    <select style={selectStyle} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                      <option>kg</option><option>g</option><option>L</option><option>ml</option><option>units</option><option>ea</option><option>lbs</option>
                    </select>
                  </div>
                </div>
                {selectedRM?.package_size && (
                  <div style={{ marginBottom: 12 }}>
                    <button style={{ background: 'none', border: 'none', color: 'var(--ink3)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => setForm(f => ({ ...f, manual_entry: false, qty_kg: '' }))}>
                      ← Back to package count
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Lot # Photo */}
            <div className="field">
              <label>📷 Lot # Photo</label>
              <input ref={photoInputRef} type="file" accept="image/*" capture="environment"
                onChange={handleLotPhoto} style={{ display: 'none' }} />
              <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginBottom: 8 }}
                onClick={() => photoInputRef.current.click()}>
                {lotPhotoPreview ? '📷 Retake Photo' : '📷 Take Photo of Lot #'}
              </button>
              {lotPhotoPreview && (
                <img src={lotPhotoPreview} alt="Lot label" style={{ width: '100%', borderRadius: 8, maxHeight: 150, objectFit: 'contain', background: '#f5f5f5', marginBottom: 8 }} />
              )}
              {ocrLoading && <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 8 }}>⏳ Reading lot number...</div>}
              {lotOCR && <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 8 }}>✅ Lot # detected: <strong>{lotOCR}</strong></div>}
            </div>

            {/* Lot # field (auto-filled or manual) */}
            <div className="field">
              <label>Lot # {lotOCR ? '(auto-filled — edit if needed)' : '(type manually)'}</label>
              <input type="text" value={form.lot_number} onChange={e => setForm(f => ({ ...f, lot_number: e.target.value }))} placeholder="e.g. LOT2024-001" />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-amber btn-full" onClick={saveSourcing} disabled={saving}>
                {saving ? 'Saving...' : 'Save Entry'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {editingEntry && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setEditingEntry(null)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setEditingEntry(null)}>×</button>
            <div className="modal-title">EDIT RM ENTRY</div>
            <div style={{ fontSize:13, color:'var(--ink3)', marginBottom:16 }}>{editingEntry.rm_name}</div>
            <div className="field">
              <label>Date</label>
              <input type="date" value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="field">
              <label>Supplier</label>
              <select style={selectStyle} value={editForm.supplier} onChange={e => setEditForm(f => ({ ...f, supplier: e.target.value }))}>
                <option value="">Select supplier...</option>
                {suppliers.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <div className="field" style={{ margin:0 }}>
                <label>Qty Received</label>
                <input type="number" value={editForm.qty_received} onChange={e => setEditForm(f => ({ ...f, qty_received: e.target.value }))} step="0.001" style={{ fontSize:16, padding:'12px 14px' }} />
              </div>
              <div className="field" style={{ margin:0 }}>
                <label>Unit</label>
                <select style={selectStyle} value={editForm.unit} onChange={e => setEditForm(f => ({ ...f, unit: e.target.value }))}>
                  <option>kg</option><option>g</option><option>L</option><option>ml</option><option>units</option><option>ea</option><option>lbs</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Lot #</label>
              <input type="text" value={editForm.lot_number} onChange={e => setEditForm(f => ({ ...f, lot_number: e.target.value }))} placeholder="e.g. LOT2024-001" />
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-amber btn-full" onClick={saveEdit} disabled={editSaving}>
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn btn-secondary" onClick={() => setEditingEntry(null)}>Cancel</button>
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

  const icons = { dispatch: '📋', production: '🏭', sourcing: '📥', dispatch_deleted: '🗑️', production_deleted: '🗑️' }
  const filters = ['all', 'dispatch', 'production', 'sourcing']

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
  const { profile, isAdmin } = useAuth()
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

  const PACK_SIZE = { VPB:3,VPCAN:3,PNF:3,PVBRG:1,PVBR:4,PBB:2,PCC:2,KLR:2,KSCD:4,VPBD:2,KHD:2,HPC:5,KABIS:5,KAB:5,KWAL:5,PVHC:5,POS:5,PGCo:5,KCOC:1,KSCO:5,PVBB:1,GBL:1,KPL:1,CCL:1,BAGL:2,Focaccia:1,TRFCS:1,HRCS:1,VSCS:1,NALCOB:1,NBFB:1,PRMC:1,CMC:1,LMC:1 }

  return (
    <>
      <div className="page-header">
        <div><h2>REPORTS</h2><p>Inventory & stock reports</p></div>
      </div>
      <div className="page-body">
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {[
            { key: 'fg', label: '📦 Finished Goods' },
            { key: 'rm', label: '🌿 Raw Materials' },
            ...(isAdmin || profile?.role === 'analyst' ? [{ key: 'financials', label: '💰 Financials' }] : [])
          ].map(r => (
            <button key={r.key} onClick={() => setActiveReport(r.key)} style={{ padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--display)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: activeReport===r.key?'var(--ink)':'var(--ink3)', borderBottom: activeReport===r.key?'2px solid var(--kk-green)':'2px solid transparent', marginBottom: -1 }}>
              {r.label}
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

        {activeReport === 'financials' && (isAdmin || profile?.role === 'analyst') && (
          <Financials />
        )}
      </div>
    </>
  )
}

export default Sourcing
