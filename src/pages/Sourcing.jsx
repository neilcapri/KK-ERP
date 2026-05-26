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
  const [packagingRMs, setPackagingRMs] = useState([])
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
  // 'ingredient' | 'packaging'
  const [entryType, setEntryType] = useState('ingredient')
  const photoInputRef = useRef(null)
  const cameraInputRef = useRef(null)

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
    const [r, pkg, e, s] = await Promise.all([
      supabase.from('raw_materials')
        .select('name,category,stock,unit,min_stock,supplier,package_size,package_unit,package_label')
        .not('category', 'eq', 'Packaging')
        .not('category', 'eq', 'WIP')
        .order('name'),
      supabase.from('raw_materials')
        .select('name,category,stock,unit,min_stock,supplier,package_size,package_unit,package_label')
        .eq('category', 'Packaging')
        .order('name'),
      supabase.from('sourcing').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('suppliers').select('name').order('name'),
    ])
    setRMs(r.data || [])
    setPackagingRMs(pkg.data || [])
    setEntries(e.data || [])
    setSuppliers(s.data || [])
  }

  // The active RM list depends on which toggle is selected
  const activeRMs = entryType === 'packaging' ? packagingRMs : rms

  function resetForm() {
    setForm({
      date: new Date().toISOString().split('T')[0],
      rm_name: '', supplier: '', qty_bags: '', qty_kg: '',
      unit: entryType === 'packaging' ? 'units' : 'kg',
      manual_entry: false, lot_number: '',
    })
    setLotPhoto(null)
    setLotPhotoPreview(null)
    setLotOCR('')
  }

  // When toggle switches, reset the RM selection
  function switchEntryType(type) {
    setEntryType(type)
    setForm(f => ({
      ...f,
      rm_name: '', supplier: '', qty_bags: '', qty_kg: '',
      unit: type === 'packaging' ? 'units' : 'kg',
      manual_entry: false,
    }))
  }

  function handleRMChange(name) {
    const rm = activeRMs.find(r => r.name === name)
    const defaultSupplier = rm?.supplier && rm.supplier !== 'TBD' ? rm.supplier : ''
    setForm(f => ({
      ...f,
      rm_name: name,
      supplier: defaultSupplier,
      unit: rm?.unit || (entryType === 'packaging' ? 'units' : 'kg'),
      qty_bags: '',
      qty_kg: '',
    }))
  }

  function handleBagsChange(bags) {
    const rm = activeRMs.find(r => r.name === form.rm_name)
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
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result.split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(file)
      })

      const rmContext = form.rm_name
        ? ' This label is for: ' + form.rm_name + (form.supplier ? ' from supplier ' + form.supplier : '') + '.'
        : ''

      const promptText = 'You are reading a food ingredient package label to extract the lot or batch number.' + rmContext + ' Study the entire image carefully.\n\nLook for these patterns (in order of priority):\n1. LOT: or LOT# or LOT followed by numbers/letters (e.g. "LOT:26 069", "LOT #261222", "LOT 21926")\n2. B.NO: or BATCH NO or Batch No: (e.g. "B.NO:CNC-2573-2025", "Batch No:173J72110216")\n3. A standalone alphanumeric code near best before date (e.g. "AP26073" above a best before line)\n4. Long barcode-style strings starting with letters then hyphens (e.g. "R-915-F-020-BP-25-...")\n5. Inkjet/dot-matrix printed codes on packaging seams\n\nRules:\n- Return ONLY the lot number value itself, no labels, no punctuation\n- If lot has spaces like "26 069" return it as "26 069"\n- If multiple codes exist, prefer the one labeled LOT or BATCH\n- Do NOT return best before dates or expiry dates\n- If you truly cannot find any lot or batch number, return NOTFOUND\n\nReturn just the lot number, nothing else.'

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: API_HEADERS,
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20251001',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } },
              { type: 'text', text: promptText }
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
    if (photoInputRef.current) photoInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
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
        title: editingEntry.rm_name + ' entry updated',
        description: 'Qty: ' + oldQty + ' \u2192 ' + newQty + ' ' + editForm.unit + (editForm.lot_number ? ' \u00b7 Lot: ' + editForm.lot_number : ''),
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
      let lot_photo_url = null
      if (lotPhoto) {
        const ext = lotPhoto.name.split('.').pop()
        const path = 'lot-photos/' + Date.now() + '-' + rm_name.replace(/\s+/g, '-') + '.' + ext
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
        title: rm_name + ' received' + (entryType === 'packaging' ? ' (Packaging)' : ''),
        description: q + ' ' + unit + ' from ' + supplier + (lot_number ? ' \u00b7 Lot: ' + lot_number : ''),
        created_by_name: profile?.name
      })

      setShowModal(false)
      resetForm()
      loadData()
    } catch (err) {
      alert('Save failed: ' + err.message)
    }
    setSaving(false)
  }

  async function deleteSourcing(entry) {
    if (!window.confirm('Delete sourcing entry for ' + entry.rm_name + ' (+' + entry.qty_received + ' ' + entry.unit + ') on ' + entry.date + '?\n\nThis will reverse the stock change.')) return
    setDeletingId(entry.id)
    try {
      const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', entry.rm_name).single()
      if (rm) await supabase.from('raw_materials').update({ stock: Math.max(0, rm.stock - entry.qty_received) }).eq('name', entry.rm_name)
      await supabase.from('sourcing').delete().eq('id', entry.id)
      await supabase.from('activity').insert({
        type: 'sourcing', title: 'Sourcing Deleted: ' + entry.rm_name,
        description: entry.qty_received + ' ' + entry.unit + ' reversed \u00b7 ' + entry.date,
        created_by_name: profile?.name || 'admin'
      })
      loadData()
    } catch(err) { alert('Delete failed: ' + err.message) }
    setDeletingId(null)
  }

  const selectedRM = activeRMs.find(r => r.name === form.rm_name)

  // Stats based on non-packaging RMs only (ingredient stock)
  const zero = rms.filter(r => r.stock <= 0).length
  const low = rms.filter(r => r.stock > 0 && r.stock <= r.min_stock).length
  const pkgZero = packagingRMs.filter(r => r.stock <= 0).length
  const pkgLow = packagingRMs.filter(r => r.stock > 0 && r.stock <= r.min_stock).length

  const selectStyle = {
    width: '100%', padding: '12px 14px', fontSize: '14px', borderRadius: '6px',
    border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)',
    fontFamily: 'var(--mono)', height: '48px'
  }

  const toggleBtnStyle = (active, color) => ({
    flex: 1, padding: '10px 16px', border: 'none', cursor: 'pointer', fontSize: 13,
    fontFamily: 'var(--display)', letterSpacing: 1, textTransform: 'uppercase',
    fontWeight: active ? 700 : 400,
    background: active ? (color === 'green' ? 'var(--kk-green)' : '#8B5E3C') : 'var(--surface)',
    color: active ? 'var(--kk-cream)' : 'var(--ink3)',
    borderRight: '1px solid var(--border)',
    transition: 'background 0.15s',
  })

  return (
    <>
      <div className="page-header">
        <div><h2>SOURCING</h2><p>Raw material &amp; packaging intake</p></div>
        <button className="btn btn-amber" onClick={() => { resetForm(); setShowModal(true) }}>+ Log Receipt</button>
      </div>
      <div className="page-body">

        {/* Stats row */}
        <div className="grid4" style={{ marginBottom: 16 }}>
          <div className="stat blue"><div className="stat-label">Ingredients</div><div className="stat-value">{rms.length}</div></div>
          <div className="stat green"><div className="stat-label">In Stock</div><div className="stat-value">{rms.length - zero - low}</div></div>
          <div className="stat amber"><div className="stat-label">Low</div><div className="stat-value">{low + pkgLow}</div></div>
          <div className="stat red"><div className="stat-label">Zero Stock</div><div className="stat-value">{zero + pkgZero}</div></div>
        </div>

        <div className="grid2">
          {/* Ingredient stock table */}
          <div className="card">
            <div className="card-title">🌿 Ingredient Stock</div>
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
                        <td style={{ fontWeight: 600, color: 'var(--' + s + ')' }}>{r.stock?.toFixed(2)}</td>
                        <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{r.unit}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink2)' }}>{r.supplier}</td>
                        <td><span className={'badge badge-' + s}>{label}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right column: Packaging stock + Recent log */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Packaging stock */}
            <div className="card">
              <div className="card-title">📦 Packaging Stock</div>
              {packagingRMs.length === 0 ? (
                <div style={{ padding: '16px 0', fontSize: 12, color: 'var(--ink3)' }}>No packaging materials found. Add items with category "Packaging" in raw_materials.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Material</th><th>Stock</th><th>Unit</th><th>Supplier</th><th>Status</th></tr></thead>
                    <tbody>
                      {packagingRMs.map(r => {
                        const s = r.stock <= 0 ? 'red' : r.stock <= r.min_stock ? 'amber' : 'green'
                        const label = r.stock <= 0 ? '🔴 OUT' : r.stock <= r.min_stock ? '⚠️' : '✅'
                        return (
                          <tr key={r.name}>
                            <td style={{ fontWeight: 500, fontSize: 12 }}>{r.name}</td>
                            <td style={{ fontWeight: 600, color: 'var(--' + s + ')' }}>{r.stock?.toFixed(0)}</td>
                            <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{r.unit}</td>
                            <td style={{ fontSize: 11, color: 'var(--ink2)' }}>{r.supplier}</td>
                            <td><span className={'badge badge-' + s}>{label}</span></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent sourcing log */}
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
      </div>

      {/* ── LOG RECEIPT MODAL ── */}
      {showModal && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            <div className="modal-title">LOG RECEIPT</div>

            {/* Ingredient / Packaging toggle */}
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 18 }}>
              <button style={toggleBtnStyle(entryType === 'ingredient', 'green')}
                onClick={() => switchEntryType('ingredient')}>
                🌿 Ingredient
              </button>
              <button style={{ ...toggleBtnStyle(entryType === 'packaging', 'brown'), borderRight: 'none' }}
                onClick={() => switchEntryType('packaging')}>
                📦 Packaging
              </button>
            </div>

            {/* Date */}
            <div className="field">
              <label>Date</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>

            {/* RM Dropdown — list depends on toggle */}
            <div className="field">
              <label>{entryType === 'packaging' ? 'Packaging Material' : 'Raw Material'}</label>
              <select style={selectStyle} value={form.rm_name} onChange={e => handleRMChange(e.target.value)}>
                <option value="">Select {entryType === 'packaging' ? 'packaging' : 'RM'}...</option>
                {activeRMs.map(r => (
                  <option key={r.name} value={r.name}>
                    {r.name}{r.package_label ? ' (' + r.package_label + ')' : ''}
                  </option>
                ))}
              </select>
              {activeRMs.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
                  ⚠️ No {entryType === 'packaging' ? 'packaging' : 'ingredient'} materials found in raw_materials table.
                </div>
              )}
            </div>

            {/* Supplier */}
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
                    <input type="number" value={form.qty_kg} onChange={e => handleManualQtyChange(e.target.value)} placeholder="0" step={entryType === 'packaging' ? '1' : '0.001'} style={{ fontSize: 16, padding: '12px 14px' }} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Unit</label>
                    <select style={selectStyle} value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                      {entryType === 'packaging'
                        ? <><option>units</option><option>rolls</option><option>sheets</option><option>boxes</option><option>cases</option><option>kg</option><option>g</option></>
                        : <><option>kg</option><option>g</option><option>L</option><option>ml</option><option>units</option><option>ea</option><option>lbs</option></>
                      }
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

            {/* Lot # Photo — optional for packaging, useful for ingredients */}
            <div className="field">
              <label>{entryType === 'packaging' ? '📷 Reference Photo (optional)' : '📷 Lot # Photo'}</label>
              <input ref={photoInputRef} type="file" accept="image/*"
                onChange={handleLotPhoto} style={{ display: 'none' }} />
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
                onChange={handleLotPhoto} style={{ display: 'none' }} />
              <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                <button className="btn btn-secondary" style={{ flex:1 }}
                  onClick={() => photoInputRef.current.click()}>
                  📁 Upload Photo
                </button>
                <button className="btn btn-secondary" style={{ flex:1 }}
                  onClick={() => cameraInputRef.current.click()}>
                  📷 Take Photo
                </button>
              </div>
              {lotPhotoPreview && (
                <img src={lotPhotoPreview} alt="Label" style={{ width: '100%', borderRadius: 8, maxHeight: 150, objectFit: 'contain', background: '#f5f5f5', marginBottom: 8 }} />
              )}
              {ocrLoading && <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 8 }}>⏳ Reading lot number...</div>}
              {lotOCR && <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 8 }}>✅ Lot # detected: <strong>{lotOCR}</strong></div>}
            </div>

            {/* Lot # / Ref # field */}
            <div className="field">
              <label>
                {entryType === 'packaging' ? 'Ref / PO # (optional)' : ('Lot # ' + (lotOCR ? '(auto-filled — edit if needed)' : '(type manually)'))}
              </label>
              <input type="text"
                value={form.lot_number}
                onChange={e => setForm(f => ({ ...f, lot_number: e.target.value }))}
                placeholder={entryType === 'packaging' ? 'e.g. PO-1234 or batch ref' : 'e.g. LOT2024-001'}
              />
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

      {/* ── EDIT MODAL ── */}
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
                  <option>kg</option><option>g</option><option>L</option><option>ml</option><option>units</option><option>ea</option><option>lbs</option><option>rolls</option><option>sheets</option><option>boxes</option><option>cases</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Lot / Ref #</label>
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
            <button key={f} className={'filter-btn ' + (filter===f ? 'active' : '')} onClick={() => setFilter(f)}>
              {icons[f] || ''} {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="card">
          {loading ? <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>Loading...</div> :
            activities.length === 0 ? <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>No activity yet.</div> :
            activities.map(a => (
              <div key={a.id} className="activity-item">
                <div className={'activity-icon ' + a.type}>{icons[a.type] || '•'}</div>
                <div className="activity-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div className="activity-title">{a.title}</div>
                    <span className={'badge badge-' + (a.type==='dispatch'||a.type==='dispatch_deleted'?'blue':a.type==='production'||a.type==='production_deleted'?'green':a.type==='sourcing'?'amber':'purple')}>{a.type}</span>
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


// ── BACKUP & EXPORT ──────────────────────────────────────────
function BackupExport() {
  const [exporting, setExporting] = useState({})

  const tables = [
    { key: 'orders',       label: 'Orders',           icon: '🛒', desc: 'All customer orders with items', query: () => supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }) },
    { key: 'customers',    label: 'Customers',        icon: '🏪', desc: 'Customer list with addresses',   query: () => supabase.from('customers').select('*').order('name') },
    { key: 'products',     label: 'Products',         icon: '📦', desc: 'Product catalog with pricing',   query: () => supabase.from('products').select('*').order('code') },
    { key: 'productions',  label: 'Productions',      icon: '🏭', desc: 'All production batch logs',      query: () => supabase.from('productions').select('*').order('date', { ascending: false }) },
    { key: 'dispatches',   label: 'Dispatches',       icon: '🚚', desc: 'Dispatch history with items',    query: () => supabase.from('dispatches').select('*, dispatch_items(*)').order('created_at', { ascending: false }) },
    { key: 'sourcing',     label: 'Sourcing / RM',    icon: '🌿', desc: 'Raw material receipts',          query: () => supabase.from('sourcing').select('*').order('date', { ascending: false }) },
    { key: 'raw_materials',label: 'Raw Materials',    icon: '🧪', desc: 'RM stock levels and pricing',    query: () => supabase.from('raw_materials').select('*').order('name') },
    { key: 'bom',          label: 'Bill of Materials', icon: '📋', desc: 'BOM for all products',          query: () => supabase.from('bom').select('*').order('product_code') },
    { key: 'time_entries', label: 'Time Entries',     icon: '⏱', desc: 'All employee time records',      query: () => supabase.from('time_entries').select('*, employees(name)').order('clock_in', { ascending: false }) },
  ]

  async function exportTable(table) {
    setExporting(e => ({ ...e, [table.key]: true }))
    try {
      const { data, error } = await table.query()
      if (error) throw error
      if (!data || data.length === 0) { alert('No data to export.'); return }

      const flat = data.map(row => {
        const result = {}
        for (const [k, v] of Object.entries(row)) {
          if (Array.isArray(v)) {
            result[k] = JSON.stringify(v)
          } else if (v && typeof v === 'object') {
            for (const [k2, v2] of Object.entries(v)) {
              result[k + '_' + k2] = v2
            }
          } else {
            result[k] = v
          }
        }
        return result
      })

      const headers = Object.keys(flat[0])
      const csvRows = [
        headers.join(','),
        ...flat.map(row => headers.map(h => {
          const val = row[h] ?? ''
          const str = String(val).replace(/"/g, '""')
          return str.includes(',') || str.includes('\n') || str.includes('"') ? '"' + str + '"' : str
        }).join(','))
      ]

      const csv = csvRows.join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'KK_' + table.key + '_' + new Date().toISOString().split('T')[0] + '.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch(err) {
      alert('Export failed: ' + err.message)
    }
    setExporting(e => ({ ...e, [table.key]: false }))
  }

  async function exportAll() {
    for (const table of tables) {
      await exportTable(table)
      await new Promise(r => setTimeout(r, 300))
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Export & Backup</div>
          <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 2 }}>Download your data as CSV files for backup or analysis</div>
        </div>
        <button className="btn btn-green" onClick={exportAll}>⬇️ Export All Tables</button>
      </div>

      <div className="grid2">
        {tables.map(table => (
          <div key={table.key} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 24 }}>{table.icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{table.label}</div>
                <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{table.desc}</div>
              </div>
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => exportTable(table)}
              disabled={exporting[table.key]}
              style={{ whiteSpace: 'nowrap' }}>
              {exporting[table.key] ? '⏳...' : '⬇️ CSV'}
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--amber-l)', borderRadius: 8, fontSize: 12, color: 'var(--ink2)' }}>
        💡 <strong>Tip:</strong> Run "Export All Tables" weekly and save the files to Google Drive or Dropbox as a backup. All data is stored in Supabase — regular exports protect against accidental deletion.
      </div>
    </div>
  )
}

// ── REPORTS ──────────────────────────────────────────────────
export function Reports() {
  const { profile, isAdmin } = useAuth()
  const [products, setProducts] = useState([])
  const [rms, setRMs] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeReport, setActiveReport] = useState('fg')

  const [labourRange, setLabourRange] = useState('week')
  const [labourDate, setLabourDate] = useState(new Date().toISOString().split('T')[0].slice(0,7))
  const [labourCustomStart, setLabourCustomStart] = useState('')
  const [labourCustomEnd, setLabourCustomEnd] = useState('')
  const [labourData, setLabourData] = useState([])
  const [labourLoading, setLabourLoading] = useState(false)

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

  function getLabourDateRange() {
    if (labourRange === 'custom' && labourCustomStart && labourCustomEnd) {
      return { start: labourCustomStart, end: labourCustomEnd }
    }
    if (labourRange === 'month') {
      const [y, m] = labourDate.split('-').map(Number)
      const start = y + '-' + String(m).padStart(2,'0') + '-01'
      const lastDay = new Date(y, m, 0).getDate()
      const end = y + '-' + String(m).padStart(2,'0') + '-' + lastDay
      return { start, end }
    }
    const d = new Date(labourDate + '-01' || new Date())
    const day = d.getDay()
    const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
    return { start: mon.toISOString().split('T')[0], end: sun.toISOString().split('T')[0] }
  }

  async function loadLabourVsProduction() {
    setLabourLoading(true)
    const { start, end } = getLabourDateRange()

    const [prodRes, timeRes, empRes] = await Promise.all([
      supabase.from('productions').select('date, product_code, output_units').gte('date', start).lte('date', end).order('date'),
      supabase.from('time_entries').select('clock_in, clock_out, hours_worked, employee_id').gte('clock_in', start + 'T00:00:00').lte('clock_in', end + 'T23:59:59'),
      supabase.from('employees').select('id, hourly_rate'),
    ])

    const empRateMap = {}
    ;(empRes.data || []).forEach(e => { empRateMap[e.id] = e.hourly_rate || 0 })

    const dayMap = {}
    ;(prodRes.data || []).forEach(p => {
      if (!dayMap[p.date]) dayMap[p.date] = { date: p.date, units: 0, labour_hours: 0, labour_cost: 0 }
      dayMap[p.date].units += p.output_units || 0
    })
    ;(timeRes.data || []).forEach(t => {
      const day = t.clock_in.split('T')[0]
      if (!dayMap[day]) dayMap[day] = { date: day, units: 0, labour_hours: 0, labour_cost: 0 }
      const hrs = parseFloat(t.hours_worked || 0)
      const rate = empRateMap[t.employee_id] || 0
      dayMap[day].labour_hours += hrs
      dayMap[day].labour_cost += hrs * rate
    })

    const rows = Object.values(dayMap).sort((a,b) => a.date.localeCompare(b.date)).map(d => ({
      ...d, cost_per_unit: d.units > 0 ? d.labour_cost / d.units : null
    }))

    setLabourData(rows)
    setLabourLoading(false)
  }

  useEffect(() => {
    if (activeReport === 'labour') loadLabourVsProduction()
  }, [activeReport, labourRange, labourDate, labourCustomStart, labourCustomEnd])

  function exportCSV(data, filename) {
    const rows = data.map(r => Object.values(r).join(','))
    const headers = Object.keys(data[0]).join(',')
    const csv = [headers, ...rows].join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = filename
    a.click()
  }

  const PACK_SIZE = { VPB:3,VPCAN:3,PNF:3,PVBRG:1,PVBR:4,PBB:2,PCC:2,KLR:2,KSCD:4,VPBD:2,KHD:2,HPCo:5,KABIS:5,KAB:5,KWAL:5,PVHC:5,POS:5,PGCo:5,KCOC:1,KSCO:5,PVBB:1,GBL:1,KPL:1,CCL:1,BAGL:2,Focaccia:1,TRFCS:1,HRCS:1,VSCS:1,NALCOB:1,NBFB:1,PRMC:1,CMC:1,LMC:1 }

  const tabStyle = (key) => ({
    padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
    fontFamily: 'var(--display)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase',
    color: activeReport===key ? 'var(--ink)' : 'var(--ink3)',
    borderBottom: activeReport===key ? '2px solid var(--kk-green)' : '2px solid transparent',
    marginBottom: -1
  })

  const sel = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)' }

  const totalLabourHours = labourData.reduce((s,d) => s + d.labour_hours, 0)
  const totalLabourCost = labourData.reduce((s,d) => s + d.labour_cost, 0)
  const totalUnits = labourData.reduce((s,d) => s + d.units, 0)
  const avgCostPerUnit = totalUnits > 0 ? totalLabourCost / totalUnits : null

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
            ...(isAdmin || profile?.role === 'analyst' ? [
              { key: 'financials', label: '💰 Financials' },
              { key: 'labour', label: '👷 Labour vs Production' },
              { key: 'backup', label: '📦 Export & Backup' },
            ] : [])
          ].map(r => (
            <button key={r.key} onClick={() => setActiveReport(r.key)} style={tabStyle(r.key)}>
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
                        <td style={{ fontWeight: 600, color: 'var(--' + s + ')' }}>{p.units}</td>
                        <td>{Math.floor(p.units / ps)}</td>
                        <td style={{ color: 'var(--ink3)' }}>{p.min_stock}</td>
                        <td><span className={'badge badge-' + s}>{p.units<=0?'OUT':p.units<=p.min_stock?'LOW':'OK'}</span></td>
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
              <button className="btn btn-secondary btn-sm" onClick={() => exportCSV(rms.map(r=>({name:r.name,category:r.category,stock:r.stock,unit:r.unit,supplier:r.supplier,price:r.price_per_pack,status:r.stock<=0?'OUT':r.stock<=r.min_stock?'LOW':'OK'})),'KK_RM_'+new Date().toISOString().split('T')[0]+'.csv')}>Export CSV</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Material</th><th>Category</th><th>Stock</th><th>Unit</th><th>Supplier</th><th>$/Pack</th><th>Status</th></tr></thead>
                <tbody>
                  {rms.map(r => {
                    const s = r.stock <= 0 ? 'red' : r.stock <= r.min_stock ? 'amber' : 'green'
                    return (
                      <tr key={r.name}>
                        <td style={{ fontWeight: 500, fontSize: 12 }}>{r.name}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink3)' }}>{r.category}</td>
                        <td style={{ fontWeight: 600, color: 'var(--' + s + ')' }}>{r.stock?.toFixed(3)}</td>
                        <td style={{ color: 'var(--ink3)' }}>{r.unit}</td>
                        <td style={{ fontSize: 11 }}>{r.supplier}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink3)' }}>{r.price_per_pack > 0 ? '$' + r.price_per_pack.toFixed(2) : '—'}</td>
                        <td><span className={'badge badge-' + s}>{r.stock<=0?'OUT':r.stock<=r.min_stock?'LOW':'OK'}</span></td>
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

        {activeReport === 'backup' && isAdmin && (
          <BackupExport />
        )}

        {activeReport === 'labour' && (isAdmin || profile?.role === 'analyst') && (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {['week','month','custom'].map(r => (
                  <button key={r} onClick={() => setLabourRange(r)} style={{
                    padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12,
                    fontFamily: 'var(--display)', textTransform: 'uppercase', letterSpacing: 1,
                    background: labourRange === r ? 'var(--kk-green)' : 'var(--surface)',
                    color: labourRange === r ? 'var(--kk-cream)' : 'var(--ink3)',
                    fontWeight: labourRange === r ? 700 : 400,
                  }}>{r}</button>
                ))}
              </div>
              {labourRange !== 'custom' && (
                <input type="month" value={labourDate} onChange={e => setLabourDate(e.target.value)} style={sel} />
              )}
              {labourRange === 'custom' && <>
                <input type="date" value={labourCustomStart} onChange={e => setLabourCustomStart(e.target.value)} style={sel} />
                <span style={{ color: 'var(--ink3)' }}>to</span>
                <input type="date" value={labourCustomEnd} onChange={e => setLabourCustomEnd(e.target.value)} style={sel} />
              </>}
              <button className="btn btn-secondary btn-sm" onClick={loadLabourVsProduction}>↻ Refresh</button>
            </div>

            <div className="grid4" style={{ marginBottom: 16 }}>
              <div className="stat green">
                <div className="stat-label">Total Units</div>
                <div className="stat-value">{totalUnits.toLocaleString()}</div>
                <div className="stat-sub">Produced</div>
              </div>
              <div className="stat amber">
                <div className="stat-label">Labour Hours</div>
                <div className="stat-value">{Math.floor(totalLabourHours)}h {Math.round((totalLabourHours % 1) * 60)}m</div>
                <div className="stat-sub">Total worked</div>
              </div>
              <div className="stat blue">
                <div className="stat-label">Labour Cost</div>
                <div className="stat-value">${totalLabourCost.toFixed(0)}</div>
                <div className="stat-sub">Total spend</div>
              </div>
              <div className="stat" style={{ borderTop: '3px solid var(--kk-peach)' }}>
                <div className="stat-label">Labour / Unit</div>
                <div className="stat-value">{avgCostPerUnit != null ? '$' + avgCostPerUnit.toFixed(2) : '—'}</div>
                <div className="stat-sub">Avg cost per unit</div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Daily Breakdown</div>
              {labourLoading ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>Loading...</div>
              ) : labourData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>No data for this period</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th><th>Units Produced</th><th>Labour Hours</th>
                        <th>Labour Cost</th><th>Cost / Unit</th><th>Efficiency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {labourData.map(d => {
                        const effColor = d.cost_per_unit == null ? 'var(--ink3)'
                          : d.cost_per_unit < 0.5 ? 'var(--green)'
                          : d.cost_per_unit < 1.0 ? 'var(--amber)'
                          : 'var(--red)'
                        const hrs = Math.floor(d.labour_hours)
                        const mins = Math.round((d.labour_hours % 1) * 60)
                        return (
                          <tr key={d.date}>
                            <td style={{ fontWeight: 500 }}>{new Date(d.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                            <td style={{ fontWeight: 600, color: 'var(--kk-green)' }}>{d.units > 0 ? d.units.toLocaleString() : <span style={{ color: 'var(--ink3)' }}>—</span>}</td>
                            <td>{d.labour_hours > 0 ? hrs + 'h ' + mins + 'm' : <span style={{ color: 'var(--ink3)' }}>—</span>}</td>
                            <td style={{ fontWeight: 600 }}>{d.labour_cost > 0 ? '$' + d.labour_cost.toFixed(2) : <span style={{ color: 'var(--ink3)' }}>—</span>}</td>
                            <td style={{ fontWeight: 700, color: effColor }}>{d.cost_per_unit != null ? '$' + d.cost_per_unit.toFixed(2) : '—'}</td>
                            <td>{d.units > 0 && d.labour_hours > 0 ? <span style={{ fontSize: 11, color: 'var(--ink2)' }}>{(d.units / d.labour_hours).toFixed(1)} units/hr</span> : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                        <td style={{ fontFamily: 'var(--display)', fontSize: 13, letterSpacing: 1 }}>TOTAL</td>
                        <td style={{ fontWeight: 700, color: 'var(--kk-green)' }}>{totalUnits.toLocaleString()}</td>
                        <td style={{ fontWeight: 700 }}>{Math.floor(totalLabourHours)}h {Math.round((totalLabourHours % 1) * 60)}m</td>
                        <td style={{ fontWeight: 700 }}>${totalLabourCost.toFixed(2)}</td>
                        <td style={{ fontWeight: 700 }}>{avgCostPerUnit != null ? '$' + avgCostPerUnit.toFixed(2) : '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink2)' }}>{totalUnits > 0 && totalLabourHours > 0 ? (totalUnits / totalLabourHours).toFixed(1) + ' units/hr avg' : ''}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default Sourcing
