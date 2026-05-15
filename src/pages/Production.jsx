import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const TRAY_YIELD = { VPB:64,VPCAN:36,PNF:40,PVBRG:36,PVBR:12,VSCS:54 }

export default function Production() {
  const { profile, isAdmin } = useAuth()
  const [view, setView] = useState('log')
  const [products, setProducts] = useState([])
  const [schedule, setSchedule] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [rmWarnings, setRmWarnings] = useState([])
  const [scheduleRMWarnings, setScheduleRMWarnings] = useState([])
  const [editRMWarnings, setEditRMWarnings] = useState([])
  const [log, setLog] = useState([])
  const [deletingId, setDeletingId] = useState(null)

  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], code: '', inputType: 'units', inputQty: '', outputUnits: '', notes: '' })
  const [schedForm, setSchedForm] = useState({ scheduled_date: '', product_code: '', planned_input: '', input_type: 'trays', notes: '' })
  const [editForm, setEditForm] = useState({ scheduled_date: '', product_code: '', planned_input: '', input_type: 'trays', notes: '' })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [p, s, h] = await Promise.all([
      supabase.from('products').select('code,name,category').order('code'),
      supabase.from('production_schedule').select('*').order('scheduled_date').limit(50),
      supabase.from('productions').select('*').order('created_at', { ascending: false }).limit(50),
    ])
    setProducts(p.data || [])
    setSchedule(s.data || [])
    setHistory(h.data || [])
    setLoading(false)
  }

  function calcOutput(code, inputType, qty) {
    const q = parseFloat(qty) || 0
    if (inputType === 'trays' && TRAY_YIELD[code]) return Math.round(q * TRAY_YIELD[code])
    if (inputType === 'logs') return Math.round(q * 11)
    return Math.round(q)
  }

  async function checkRM(code, outputUnits) {
    const { data: bom } = await supabase.from('bom').select('rm_name,qty_per_unit').eq('product_code', code)
    if (!bom?.length) return []
    const warns = []
    for (const item of bom) {
      const neededKg = (item.qty_per_unit * outputUnits) / 1000
      const { data: rm } = await supabase.from('raw_materials').select('stock,unit').eq('name', item.rm_name).single()
      if (rm && rm.stock < neededKg) warns.push({ rm: item.rm_name, needed: neededKg.toFixed(3), have: rm.stock.toFixed(3) })
    }
    return warns
  }

  async function handleCodeChange(code) {
    setForm(f => ({ ...f, code }))
    if (code && form.inputQty) {
      const out = calcOutput(code, form.inputType, form.inputQty)
      setForm(f => ({ ...f, outputUnits: String(out) }))
      const warns = await checkRM(code, out)
      setRmWarnings(warns)
    }
  }

  async function handleQtyChange(qty) {
    setForm(f => ({ ...f, inputQty: qty }))
    if (form.code) {
      const out = calcOutput(form.code, form.inputType, qty)
      setForm(f => ({ ...f, outputUnits: String(out) }))
      if (out > 0) {
        const warns = await checkRM(form.code, out)
        setRmWarnings(warns)
      }
    }
  }

  async function handleSchedProductChange(code) {
    setSchedForm(f => ({ ...f, product_code: code }))
    if (code && schedForm.planned_input) {
      const out = calcOutput(code, schedForm.input_type, schedForm.planned_input)
      const warns = await checkRM(code, out)
      setScheduleRMWarnings(warns)
    }
  }

  async function handleSchedQtyChange(qty) {
    setSchedForm(f => ({ ...f, planned_input: qty }))
    if (schedForm.product_code) {
      const out = calcOutput(schedForm.product_code, schedForm.input_type, qty)
      if (out > 0) {
        const warns = await checkRM(schedForm.product_code, out)
        setScheduleRMWarnings(warns)
      }
    }
  }

  async function handleEditProductChange(code) {
    setEditForm(f => ({ ...f, product_code: code }))
    if (code && editForm.planned_input) {
      const out = calcOutput(code, editForm.input_type, editForm.planned_input)
      const warns = await checkRM(code, out)
      setEditRMWarnings(warns)
    }
  }

  async function handleEditQtyChange(qty) {
    setEditForm(f => ({ ...f, planned_input: qty }))
    if (editForm.product_code) {
      const out = calcOutput(editForm.product_code, editForm.input_type, qty)
      if (out > 0) {
        const warns = await checkRM(editForm.product_code, out)
        setEditRMWarnings(warns)
      }
    }
  }

  function openEditModal(s) {
    setEditingSchedule(s)
    setEditForm({
      scheduled_date: s.scheduled_date,
      product_code: s.product_code,
      planned_input: String(s.planned_input),
      input_type: s.input_type,
      notes: s.notes || ''
    })
    setEditRMWarnings([])
    setShowEditModal(true)
  }

  async function saveEdit() {
    const { scheduled_date, product_code, planned_input, input_type, notes } = editForm
    if (!scheduled_date || !product_code) { alert('Please fill in date and product.'); return }
    const { data: p } = await supabase.from('products').select('name').eq('code', product_code).single()
    const planned_output = calcOutput(product_code, input_type, planned_input)
    const { error } = await supabase.from('production_schedule').update({
      scheduled_date,
      product_code,
      product_name: p?.name || product_code,
      planned_input: parseFloat(planned_input) || 0,
      input_type,
      planned_output,
      notes,
    }).eq('id', editingSchedule.id)
    if (error) { alert('Update failed: ' + error.message); return }
    setShowEditModal(false)
    setEditingSchedule(null)
    setEditRMWarnings([])
    loadData()
  }

  function addLog(msg, type = '') {
    setLog(l => [...l, { msg, type, time: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }])
  }

  async function saveProduction() {
    const { code, date, inputType, inputQty, outputUnits, notes } = form
    if (!code || !inputQty || !outputUnits) { alert('Please fill in all fields.'); return }
    const output = parseInt(outputUnits)
    addLog(`Saving ${code} +${output} units...`)
    const { data: prod } = await supabase.from('products').select('units,name').eq('code', code).single()
    const newUnits = (prod?.units || 0) + output
    await supabase.from('products').update({ units: newUnits }).eq('code', code)
    addLog(`✓ FG stock updated: ${prod?.units} → ${newUnits}`, 'ok')
    const { data: bom } = await supabase.from('bom').select('rm_name,qty_per_unit').eq('product_code', code)
    if (bom?.length) {
      for (const item of bom) {
        const deductKg = (item.qty_per_unit * output) / 1000
        const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', item.rm_name).single()
        if (rm) await supabase.from('raw_materials').update({ stock: Math.max(0, rm.stock - deductKg) }).eq('name', item.rm_name)
      }
      addLog(`✓ ${bom.length} RMs deducted via BOM`, 'ok')
    }
    await supabase.from('productions').insert({
      date, product_code: code, product_name: prod?.name || code,
      input_qty: parseFloat(inputQty), input_type: inputType,
      output_units: output, notes, created_by_name: profile?.name
    })
    await supabase.from('activity').insert({
      type: 'production', title: `${code}: +${output} units`,
      description: `${inputQty} ${inputType} · ${prod?.name}`,
      created_by_name: profile?.name
    })
    addLog(`✓ Production saved successfully!`, 'ok')
    setForm({ date: new Date().toISOString().split('T')[0], code: '', inputType: 'units', inputQty: '', outputUnits: '', notes: '' })
    setRmWarnings([])
    loadData()
  }

  async function deleteProduction(h) {
    if (!window.confirm(`Delete production entry for ${h.product_code} (+${h.output_units} units) on ${h.date}?\n\nThis will reverse the stock change.`)) return
    setDeletingId(h.id)
    try {
      const { data: prod } = await supabase.from('products').select('units').eq('code', h.product_code).single()
      if (prod) await supabase.from('products').update({ units: Math.max(0, prod.units - h.output_units) }).eq('code', h.product_code)
      const { data: bom } = await supabase.from('bom').select('rm_name,qty_per_unit').eq('product_code', h.product_code)
      if (bom?.length) {
        for (const item of bom) {
          const restoreKg = (item.qty_per_unit * h.output_units) / 1000
          const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', item.rm_name).single()
          if (rm) await supabase.from('raw_materials').update({ stock: rm.stock + restoreKg }).eq('name', item.rm_name)
        }
      }
      await supabase.from('productions').delete().eq('id', h.id)
      await supabase.from('activity').insert({
        type: 'production', title: `Production Deleted: ${h.product_code}`,
        description: `${h.output_units} units reversed · ${h.date}`,
        created_by_name: profile?.name || 'admin'
      })
      loadData()
    } catch(err) { alert('Delete failed: ' + err.message) }
    setDeletingId(null)
  }

  async function saveSchedule() {
    const { scheduled_date, product_code, planned_input, input_type, notes } = schedForm
    if (!scheduled_date || !product_code) { alert('Please fill in date and product.'); return }
    const { data: p } = await supabase.from('products').select('name').eq('code', product_code).single()
    const planned_output = calcOutput(product_code, input_type, planned_input)
    const { error } = await supabase.from('production_schedule').insert({
      scheduled_date, product_code, product_name: p?.name || product_code,
      planned_input: parseFloat(planned_input) || 0, input_type,
      planned_output, notes, status: 'planned', created_by_name: profile?.name
    }).select()
    if (error) { alert('Schedule save error: ' + error.message); return }
    setShowScheduleModal(false)
    setSchedForm({ scheduled_date: '', product_code: '', planned_input: '', input_type: 'trays', notes: '' })
    setScheduleRMWarnings([])
    loadData()
  }

  async function updateScheduleStatus(id, status) {
    await supabase.from('production_schedule').update({ status }).eq('id', id)
    loadData()
  }

  async function deleteSchedule(id, productCode) {
    if (!window.confirm(`Delete this scheduled production for ${productCode}?`)) return
    await supabase.from('production_schedule').delete().eq('id', id)
    loadData()
  }

  const statusColors = { planned: 'blue', in_progress: 'amber', completed: 'green', cancelled: 'red' }

  // Shared large select style
  const selectStyle = {
    width: '100%',
    padding: '12px 14px',
    fontSize: '14px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    fontFamily: 'var(--mono)',
    cursor: 'pointer',
    height: '48px',
  }

  return (
    <>
      <div className="page-header">
        <div><h2>PRODUCTION</h2><p>Log batches & manage schedule</p></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowScheduleModal(true)}>+ Schedule</button>
          <button className="btn btn-green" onClick={() => setView('log')}>+ Log Batch</button>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {['log','schedule','history'].map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: view===v?'var(--ink)':'var(--ink3)', borderBottom: view===v?'2px solid var(--ink)':'2px solid transparent', marginBottom: -1 }}>
              {v === 'log' ? '📝 Log Batch' : v === 'schedule' ? '📅 Schedule' : '📜 History'}
            </button>
          ))}
        </div>

        {view === 'log' && (
          <div className="grid2">
            <div className="card">
              <div className="card-title">Log Production Batch</div>
              <div className="field"><label>Date</label><input type="date" value={form.date} onChange={e => setForm(f=>({...f,date:e.target.value}))} /></div>
              <div className="field">
                <label>Product</label>
                <select style={selectStyle} value={form.code} onChange={e => handleCodeChange(e.target.value)}>
                  <option value="">Select product...</option>
                  {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
                </select>
              </div>
              <div className="field-row">
                <div className="field" style={{margin:0}}>
                  <label>Input Type</label>
                  <select style={selectStyle} value={form.inputType} onChange={e => { setForm(f=>({...f,inputType:e.target.value})); handleQtyChange(form.inputQty) }}>
                    <option value="units">Units</option>
                    <option value="trays">Trays</option>
                    <option value="loaves">Loaves</option>
                    <option value="logs">Logs (Biscotti)</option>
                  </select>
                </div>
                <div className="field" style={{margin:0}}>
                  <label>Quantity</label>
                  <input type="number" value={form.inputQty} onChange={e => handleQtyChange(e.target.value)} placeholder="0" />
                </div>
              </div>
              {form.outputUnits && (
                <div style={{ background: 'var(--green-l)', padding: 12, borderRadius: 3, marginBottom: 14, fontSize: 12, color: 'var(--green)' }}>
                  <strong>Output: {form.outputUnits} units</strong>
                </div>
              )}
              {rmWarnings.length > 0 && (
                <div className="alert alert-red" style={{ flexDirection: 'column', gap: 4 }}>
                  <strong>⚠️ Insufficient RM stock:</strong>
                  {rmWarnings.map((w,i) => <div key={i} style={{fontSize:11}}>{w.rm}: need {w.needed}kg, have {w.have}kg</div>)}
                </div>
              )}
              <div className="field"><label>Notes</label><textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} placeholder="Batch notes..." rows={2} /></div>
              <button className="btn btn-green btn-full" onClick={saveProduction}>✓ Save & Update Stock</button>
              {log.length > 0 && (
                <div className="log" style={{ marginTop: 12 }}>
                  {log.map((l,i) => <div key={i} className={l.type}>{l.time} — {l.msg}</div>)}
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-title">Tray Yields Reference</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Code</th><th>Product</th><th>Units/Tray</th></tr></thead>
                  <tbody>
                    {Object.entries(TRAY_YIELD).map(([code, yield_]) => (
                      <tr key={code}>
                        <td><span className="code-tag">{code}</span></td>
                        <td style={{fontSize:11}}>{products.find(p=>p.code===code)?.name||code}</td>
                        <td style={{fontWeight:500,color:'var(--green)'}}>{yield_}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {view === 'schedule' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title" style={{ margin: 0 }}>Production Schedule</div>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowScheduleModal(true)}>+ Add</button>
            </div>
            {schedule.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>No scheduled production. Click "+ Schedule" to add.</div>
            ) : (() => {
              const byDate = {}
              schedule.forEach(s => {
                if (!byDate[s.scheduled_date]) byDate[s.scheduled_date] = []
                byDate[s.scheduled_date].push(s)
              })
              return (
                <div>
                  {Object.entries(byDate).sort(([a],[b]) => a.localeCompare(b)).map(([date, rows]) => (
                    <div key={date} style={{ marginBottom: 24 }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 14px', background: 'var(--kk-green)',
                        borderRadius: '6px 6px 0 0',
                      }}>
                        <div style={{ fontFamily: 'var(--display)', fontSize: 14, letterSpacing: 2, color: 'var(--kk-cream)' }}>
                          {new Date(date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
                        </div>
                        <DailyTotal rows={rows} products={products} />
                      </div>
                      <div className="table-wrap" style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
                        <table>
                          <thead>
                            <tr>
                              <th>Product</th><th>Planned Input</th><th>Planned Output</th>
                              <th>Batch Value</th><th>RM Check</th><th>Status</th><th></th><th style={{width:100}}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(s => (
                              <ScheduleRow key={s.id} s={s} allSchedule={schedule} statusColors={statusColors}
                                onStatusChange={updateScheduleStatus} onDelete={deleteSchedule}
                                onEdit={openEditModal} calcOutput={calcOutput} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {view === 'history' && (
          <div className="card">
            <div className="card-title">Production History</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Product</th><th>Input</th><th>Output</th><th>By</th><th>Notes</th><th style={{width:60}}></th></tr></thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id}>
                      <td style={{fontSize:12}}>{h.date}</td>
                      <td><span className="code-tag">{h.product_code}</span></td>
                      <td style={{fontSize:12}}>{h.input_qty} {h.input_type}</td>
                      <td style={{fontWeight:600,color:'var(--green)'}}>+{h.output_units}</td>
                      <td style={{fontSize:11,color:'var(--ink3)'}}>{h.created_by_name}</td>
                      <td style={{fontSize:11,color:'var(--ink3)'}}>{h.notes}</td>
                      <td>
                        <button onClick={() => deleteProduction(h)} disabled={deletingId === h.id}
                          style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)', opacity: deletingId === h.id ? 0.5 : 1 }}>
                          {deletingId === h.id ? '...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── ADD SCHEDULE MODAL ── */}
      {showScheduleModal && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowScheduleModal(false)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setShowScheduleModal(false)}>×</button>
            <div className="modal-title">SCHEDULE PRODUCTION</div>
            <div className="field"><label>Date</label><input type="date" value={schedForm.scheduled_date} onChange={e => setSchedForm(f=>({...f,scheduled_date:e.target.value}))} /></div>
            <div className="field">
              <label>Product</label>
              <select style={selectStyle} value={schedForm.product_code} onChange={e => handleSchedProductChange(e.target.value)}>
                <option value="">Select...</option>
                {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <div className="field" style={{margin:0}}>
                <label>Input Type</label>
                <select style={selectStyle} value={schedForm.input_type} onChange={e => setSchedForm(f=>({...f,input_type:e.target.value}))}>
                  <option value="trays">Trays</option><option value="units">Units</option><option value="loaves">Loaves</option>
                </select>
              </div>
              <div className="field" style={{margin:0}}><label>Planned Qty</label>
                <input type="number" value={schedForm.planned_input} onChange={e => handleSchedQtyChange(e.target.value)} />
              </div>
            </div>
            {schedForm.product_code && schedForm.planned_input && (
              <div style={{ background: 'var(--green-l)', padding: 10, borderRadius: 3, marginBottom: 12, fontSize: 12, color: 'var(--green)' }}>
                <strong>Expected output: {calcOutput(schedForm.product_code, schedForm.input_type, schedForm.planned_input)} units</strong>
              </div>
            )}
            {scheduleRMWarnings.length > 0 && (
              <div className="alert alert-red" style={{ flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                <strong>⚠️ Insufficient RM stock:</strong>
                {scheduleRMWarnings.map((w,i) => <div key={i} style={{fontSize:11}}>{w.rm}: need {w.needed}kg, have {w.have}kg</div>)}
              </div>
            )}
            {scheduleRMWarnings.length === 0 && schedForm.product_code && schedForm.planned_input && (
              <div style={{ background: 'var(--green-l)', padding: 8, borderRadius: 3, marginBottom: 12, fontSize: 11, color: 'var(--green)' }}>
                ✅ RM stock sufficient
              </div>
            )}
            <div className="field"><label>Notes</label><textarea value={schedForm.notes} onChange={e => setSchedForm(f=>({...f,notes:e.target.value}))} rows={2} /></div>
            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-primary btn-full" onClick={saveSchedule}>Save Schedule</button>
              <button className="btn btn-secondary" onClick={() => setShowScheduleModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT SCHEDULE MODAL ── */}
      {showEditModal && editingSchedule && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowEditModal(false)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setShowEditModal(false)}>×</button>
            <div className="modal-title">EDIT SCHEDULE</div>
            <div className="field"><label>Date</label>
              <input type="date" value={editForm.scheduled_date} onChange={e => setEditForm(f=>({...f,scheduled_date:e.target.value}))} />
            </div>
            <div className="field">
              <label>Product</label>
              <select style={selectStyle} value={editForm.product_code} onChange={e => handleEditProductChange(e.target.value)}>
                <option value="">Select...</option>
                {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <div className="field" style={{margin:0}}>
                <label>Input Type</label>
                <select style={selectStyle} value={editForm.input_type} onChange={e => setEditForm(f=>({...f,input_type:e.target.value}))}>
                  <option value="trays">Trays</option><option value="units">Units</option><option value="loaves">Loaves</option>
                </select>
              </div>
              <div className="field" style={{margin:0}}><label>Planned Qty</label>
                <input type="number" value={editForm.planned_input} onChange={e => handleEditQtyChange(e.target.value)} />
              </div>
            </div>
            {editForm.product_code && editForm.planned_input && (
              <div style={{ background: 'var(--green-l)', padding: 10, borderRadius: 3, marginBottom: 12, fontSize: 12, color: 'var(--green)' }}>
                <strong>Expected output: {calcOutput(editForm.product_code, editForm.input_type, editForm.planned_input)} units</strong>
              </div>
            )}
            {editRMWarnings.length > 0 && (
              <div className="alert alert-red" style={{ flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                <strong>⚠️ Insufficient RM stock:</strong>
                {editRMWarnings.map((w,i) => <div key={i} style={{fontSize:11}}>{w.rm}: need {w.needed}kg, have {w.have}kg</div>)}
              </div>
            )}
            {editRMWarnings.length === 0 && editForm.product_code && editForm.planned_input && (
              <div style={{ background: 'var(--green-l)', padding: 8, borderRadius: 3, marginBottom: 12, fontSize: 11, color: 'var(--green)' }}>
                ✅ RM stock sufficient
              </div>
            )}
            <div className="field"><label>Notes</label>
              <textarea value={editForm.notes} onChange={e => setEditForm(f=>({...f,notes:e.target.value}))} rows={2} />
            </div>
            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-primary btn-full" onClick={saveEdit}>Save Changes</button>
              <button className="btn btn-secondary" onClick={() => setShowEditModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function DailyTotal({ rows, products }) {
  const [total, setTotal] = useState(null)

  useEffect(() => {
    async function calc() {
      let sum = 0
      for (const s of rows) {
        const { data: p } = await supabase.from('products').select('price_per_unit').eq('code', s.product_code).single()
        if (p?.price_per_unit) sum += (s.planned_output || 0) * p.price_per_unit
      }
      setTotal(sum)
    }
    calc()
  }, [rows.map(r => r.id).join(',')])

  if (total === null) return <span style={{ fontSize: 12, color: 'rgba(227,221,209,.5)' }}>...</span>
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 10, letterSpacing: 1, color: 'rgba(227,221,209,.5)', fontFamily: 'var(--display)' }}>DAY TOTAL</div>
      <div style={{ fontFamily: 'var(--display)', fontSize: 20, color: 'var(--kk-peach)', letterSpacing: 1 }}>
        ${total.toFixed(2)}
      </div>
    </div>
  )
}

function ScheduleRow({ s, allSchedule, statusColors, onStatusChange, onDelete, onEdit, calcOutput }) {
  const [rmStatus, setRMStatus] = useState(null)
  const [batchValue, setBatchValue] = useState(null)

  useEffect(() => {
    async function check() {
      const out = s.planned_output || calcOutput(s.product_code, s.input_type, s.planned_input)
      const { data: p } = await supabase.from('products').select('price_per_unit').eq('code', s.product_code).single()
      setBatchValue(p?.price_per_unit ? out * p.price_per_unit : 0)
      const { data: bom } = await supabase.from('bom').select('rm_name,qty_per_unit').eq('product_code', s.product_code)
      if (!bom?.length) { setRMStatus([]); return }
      const rmNames = bom.map(b => b.rm_name)
      const { data: rms } = await supabase.from('raw_materials').select('name,stock').in('name', rmNames)
      const stockMap = {}
      ;(rms || []).forEach(r => { stockMap[r.name] = r.stock })
      const myIndex = allSchedule.findIndex(x => x.id === s.id)
      const priorBatches = allSchedule.slice(0, myIndex).filter(x => x.status === 'planned' || x.status === 'in_progress')
      const committedMap = {}
      for (const prior of priorBatches) {
        const { data: priorBom } = await supabase.from('bom').select('rm_name,qty_per_unit').eq('product_code', prior.product_code)
        const priorOut = prior.planned_output || calcOutput(prior.product_code, prior.input_type, prior.planned_input)
        ;(priorBom || []).forEach(item => {
          const needed = (item.qty_per_unit * priorOut) / 1000
          committedMap[item.rm_name] = (committedMap[item.rm_name] || 0) + needed
        })
      }
      const warns = []
      for (const item of bom) {
        const neededKg = (item.qty_per_unit * out) / 1000
        const currentStock = stockMap[item.rm_name] || 0
        const committed = committedMap[item.rm_name] || 0
        const remaining = currentStock - committed
        if (remaining < neededKg) {
          warns.push({
            rm: item.rm_name,
            needed: neededKg.toFixed(3),
            remaining: remaining.toFixed(3),
            shortBy: (neededKg - remaining).toFixed(3)
          })
        }
      }
      setRMStatus(warns)
    }
    check()
  }, [s.id, allSchedule.map(x => x.id).join(',')])

  return (
    <tr>
      <td><span className="code-tag">{s.product_code}</span> <span style={{fontSize:11,color:'var(--ink2)'}}>{s.product_name}</span></td>
      <td style={{fontSize:12}}>{s.planned_input} {s.input_type}</td>
      <td style={{fontWeight:500,color:'var(--green)'}}>{s.planned_output} units</td>
      <td style={{fontWeight:600, color:'var(--kk-brown)'}}>
        {batchValue === null ? '...' : batchValue > 0 ? `$${batchValue.toFixed(2)}` : <span style={{color:'var(--ink3)'}}>—</span>}
      </td>
      <td>
        {rmStatus === null
          ? <span style={{fontSize:11,color:'var(--ink3)'}}>...</span>
          : rmStatus.length === 0
            ? <span style={{fontSize:11,color:'var(--green)'}}>✅ All OK</span>
            : (
              <div>
                {rmStatus.map((w, i) => (
                  <div key={i} style={{fontSize:10, color:'var(--red)', lineHeight:1.6}}>
                    ⚠️ {w.rm.split(' ').slice(0,2).join(' ')}: need {w.needed}kg, {parseFloat(w.remaining) < 0 ? 'none left' : `${w.remaining}kg left`} (short {w.shortBy}kg)
                  </div>
                ))}
              </div>
            )
        }
      </td>
      <td><span className={`badge badge-${statusColors[s.status]}`}>{s.status}</span></td>
      <td>
        <select value={s.status} onChange={e => onStatusChange(s.id, e.target.value)}
          style={{ fontSize: 10, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 2, fontFamily: 'var(--display)', background: 'var(--surface)' }}>
          <option value="planned">Planned</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => onEdit(s)}
            style={{ background: 'var(--kk-green)', border: 'none', color: '#fff', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--display)' }}>
            Edit
          </button>
          <button onClick={() => onDelete(s.id, s.product_code)}
            style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--display)' }}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}
