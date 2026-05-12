import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const TRAY_YIELD = { VPB:64,VPCAN:36,PNF:40,PVBRG:36,PVBR:36 }

export default function Production() {
  const { profile, isAdmin } = useAuth()
  const [view, setView] = useState('log')
  const [products, setProducts] = useState([])
  const [schedule, setSchedule] = useState([])
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [rmWarnings, setRmWarnings] = useState([])
  const [log, setLog] = useState([])

  // Form state
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], code: '', inputType: 'units', inputQty: '', outputUnits: '', notes: '' })
  const [schedForm, setSchedForm] = useState({ scheduled_date: '', product_code: '', planned_input: '', input_type: 'trays', notes: '' })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [p, s, h] = await Promise.all([
      supabase.from('products').select('code,name,category').order('code'),
      supabase.from('production_schedule').select('*').gte('scheduled_date', new Date().toISOString().split('T')[0]).order('scheduled_date').limit(30),
      supabase.from('productions').select('*').order('created_at', { ascending: false }).limit(20),
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
      const neededG = item.qty_per_unit * outputUnits
      const neededKg = neededG / 1000
      const { data: rm } = await supabase.from('raw_materials').select('stock,unit').eq('name', item.rm_name).single()
      if (rm && rm.stock < neededKg) {
        warns.push({ rm: item.rm_name, needed: neededKg.toFixed(3), have: rm.stock.toFixed(3) })
      }
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

  function addLog(msg, type = '') {
    setLog(l => [...l, { msg, type, time: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }])
  }

  async function saveProduction() {
    const { code, date, inputType, inputQty, outputUnits, notes } = form
    if (!code || !inputQty || !outputUnits) { alert('Please fill in all fields.'); return }
    const output = parseInt(outputUnits)
    addLog(`Saving ${code} +${output} units...`)

    // Get current stock
    const { data: prod } = await supabase.from('products').select('units,name').eq('code', code).single()
    const newUnits = (prod?.units || 0) + output

    // Update FG stock
    await supabase.from('products').update({ units: newUnits }).eq('code', code)
    addLog(`✓ FG stock updated: ${prod?.units} → ${newUnits}`, 'ok')

    // Deduct RMs via BOM
    const { data: bom } = await supabase.from('bom').select('rm_name,qty_per_unit').eq('product_code', code)
    if (bom?.length) {
      for (const item of bom) {
        const deductKg = (item.qty_per_unit * output) / 1000
        const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', item.rm_name).single()
        if (rm) {
          const newStock = Math.max(0, rm.stock - deductKg)
          await supabase.from('raw_materials').update({ stock: newStock }).eq('name', item.rm_name)
        }
      }
      addLog(`✓ ${bom.length} RMs deducted via BOM`, 'ok')
    }

    // Log production record
    await supabase.from('productions').insert({
      date, product_code: code, product_name: prod?.name || code,
      input_qty: parseFloat(inputQty), input_type: inputType,
      output_units: output, notes, created_by_name: profile?.name
    })

    // Log activity
    await supabase.from('activity').insert({
      type: 'production', title: `${code}: +${output} units`,
      description: `${inputQty} ${inputType} · ${prod?.name}`,
      created_by_name: profile?.name
    })

    addLog(`✓ Production saved successfully!`, 'ok')
    setForm({ date: new Date().toISOString().split('T')[0], code: '', inputType: 'units', inputQty: '', outputUnits: '', notes: '' })
    setRmWarnings([])
    setShowModal(false)
    loadData()
  }

  async function saveSchedule() {
    const { scheduled_date, product_code, planned_input, input_type, notes } = schedForm
    if (!scheduled_date || !product_code) { alert('Please fill in date and product.'); return }
    const { data: p } = await supabase.from('products').select('name').eq('code', product_code).single()
    const planned_output = calcOutput(product_code, input_type, planned_input)
    await supabase.from('production_schedule').insert({
      scheduled_date, product_code, product_name: p?.name || product_code,
      planned_input: parseFloat(planned_input) || 0, input_type,
      planned_output, notes, status: 'planned', created_by_name: profile?.name
    })
    setShowScheduleModal(false)
    setSchedForm({ scheduled_date: '', product_code: '', planned_input: '', input_type: 'trays', notes: '' })
    loadData()
  }

  async function updateScheduleStatus(id, status) {
    await supabase.from('production_schedule').update({ status }).eq('id', id)
    loadData()
  }

  const statusColors = { planned: 'blue', in_progress: 'amber', completed: 'green', cancelled: 'red' }

  return (
    <>
      <div className="page-header">
        <div><h2>PRODUCTION</h2><p>Log batches & manage schedule</p></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowScheduleModal(true)}>+ Schedule</button>
          <button className="btn btn-green" onClick={() => setShowModal(true)}>+ Log Batch</button>
        </div>
      </div>

      <div className="page-body">
        {/* View Toggle */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {['log','schedule','history'].map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: view===v?'var(--ink)':'var(--ink3)', borderBottom: view===v?'2px solid var(--ink)':'2px solid transparent', marginBottom: -1 }}>
              {v === 'log' ? '📝 Log Batch' : v === 'schedule' ? '📅 Schedule' : '📜 History'}
            </button>
          ))}
        </div>

        {/* QUICK LOG FORM */}
        {view === 'log' && (
          <div className="grid2">
            <div className="card">
              <div className="card-title">Log Production Batch</div>
              <div className="field">
                <label>Date</label>
                <input type="date" value={form.date} onChange={e => setForm(f=>({...f,date:e.target.value}))} />
              </div>
              <div className="field">
                <label>Product</label>
                <select value={form.code} onChange={e => handleCodeChange(e.target.value)}>
                  <option value="">Select product...</option>
                  {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
                </select>
              </div>
              <div className="field-row">
                <div className="field" style={{margin:0}}>
                  <label>Input Type</label>
                  <select value={form.inputType} onChange={e => { setForm(f=>({...f,inputType:e.target.value})); handleQtyChange(form.inputQty) }}>
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
              <div className="field">
                <label>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} placeholder="Batch notes..." rows={2} />
              </div>
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

        {/* SCHEDULE */}
        {view === 'schedule' && (
          <div className="card">
            <div className="card-title">Upcoming Production Schedule</div>
            {schedule.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>No scheduled production. Click "+ Schedule" to add.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Product</th><th>Planned Input</th><th>Planned Output</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {schedule.map(s => (
                      <tr key={s.id}>
                        <td style={{fontSize:12}}>{s.scheduled_date}</td>
                        <td><span className="code-tag">{s.product_code}</span> <span style={{fontSize:11,color:'var(--ink2)'}}>{s.product_name}</span></td>
                        <td style={{fontSize:12}}>{s.planned_input} {s.input_type}</td>
                        <td style={{fontWeight:500,color:'var(--green)'}}>{s.planned_output} units</td>
                        <td><span className={`badge badge-${statusColors[s.status]}`}>{s.status}</span></td>
                        <td>
                          <select value={s.status} onChange={e => updateScheduleStatus(s.id, e.target.value)}
                            style={{ fontSize: 10, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 2, fontFamily: 'var(--mono)', background: 'var(--surface)' }}>
                            <option value="planned">Planned</option>
                            <option value="in_progress">In Progress</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* HISTORY */}
        {view === 'history' && (
          <div className="card">
            <div className="card-title">Production History (Last 20)</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Product</th><th>Input</th><th>Output</th><th>By</th><th>Notes</th></tr></thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id}>
                      <td style={{fontSize:12}}>{h.date}</td>
                      <td><span className="code-tag">{h.product_code}</span></td>
                      <td style={{fontSize:12}}>{h.input_qty} {h.input_type}</td>
                      <td style={{fontWeight:600,color:'var(--green)'}}>+{h.output_units}</td>
                      <td style={{fontSize:11,color:'var(--ink3)'}}>{h.created_by_name}</td>
                      <td style={{fontSize:11,color:'var(--ink3)'}}>{h.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowScheduleModal(false)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setShowScheduleModal(false)}>×</button>
            <div className="modal-title">SCHEDULE PRODUCTION</div>
            <div className="field"><label>Date</label><input type="date" value={schedForm.scheduled_date} onChange={e => setSchedForm(f=>({...f,scheduled_date:e.target.value}))} /></div>
            <div className="field"><label>Product</label>
              <select value={schedForm.product_code} onChange={e => setSchedForm(f=>({...f,product_code:e.target.value}))}>
                <option value="">Select...</option>
                {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <div className="field" style={{margin:0}}><label>Input Type</label>
                <select value={schedForm.input_type} onChange={e => setSchedForm(f=>({...f,input_type:e.target.value}))}>
                  <option value="trays">Trays</option><option value="units">Units</option><option value="loaves">Loaves</option>
                </select>
              </div>
              <div className="field" style={{margin:0}}><label>Planned Qty</label>
                <input type="number" value={schedForm.planned_input} onChange={e => setSchedForm(f=>({...f,planned_input:e.target.value}))} />
              </div>
            </div>
            <div className="field"><label>Notes</label><textarea value={schedForm.notes} onChange={e => setSchedForm(f=>({...f,notes:e.target.value}))} rows={2} /></div>
            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-primary btn-full" onClick={saveSchedule}>Save Schedule</button>
              <button className="btn btn-secondary" onClick={() => setShowScheduleModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
