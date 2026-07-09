import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const TRAY_YIELD = { VPB:64,VPCAN:36,PNF:40,PVBRG:36,PVBR:12,VSCS:48,NALCOB:21,NBFB:21,HRCS:64,CMC:24,LMC:24,PRMC:24,TMC:24 }
const CAKE_YIELD  = { TRFCS:8 }  // per 9-inch cake
const CAKE_PRICES = { '6inch': 15, '9inch': 25 } // frosting cake prices per cake
const LOG_YIELD  = { KABIS:11, WSBIS:10, COBIS:10 }

const PACK_SIZE = {
  PBB:2, PCC:2, KLR:2,
  VPCAN:3, PNF:3, VPB:3,
  KAB:5, KWAL:5, HPCo:5, PVHC:5, KABIS:5, WSBIS:5, COBIS:5,
  KSCD:4,
  VPBD:2, KHD:2,
}

function packsDisplay(code, units) {
  const ps = PACK_SIZE[code]
  if (!ps || !units) return units + ' units'
  const packs = Math.round(units / ps)
  return units + ' units = ' + packs + ' packs'
}

function sellableQty(code, units) {
  const ps = PACK_SIZE[code]
  if (!ps || !units) return units
  return Math.round(units / ps)
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return dateStr }
}

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
  const [selectedSchedDates, setSelectedSchedDates] = useState(new Set())

  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], code: '', inputType: 'units', inputQty: '', outputUnits: '', notes: '' })
  const [schedForm, setSchedForm] = useState({ scheduled_date: '', product_code: '', planned_input: '', input_type: 'trays', notes: '' })
  const [editForm, setEditForm] = useState({ scheduled_date: '', product_code: '', planned_input: '', input_type: 'trays', notes: '' })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [p, s, h] = await Promise.all([
      supabase.from('products').select('code,name,category,price_per_pack,production_value').order('code'),
      supabase.from('production_schedule').select('*').order('scheduled_date').limit(50),
      supabase.from('productions').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(100),
    ])
    setProducts(p.data || [])
    setSchedule(s.data || [])
    setHistory(h.data || [])
    setLoading(false)
  }

  function calcOutput(code, inputType, qty) {
    const q = parseFloat(qty) || 0
    if (inputType === 'trays' && TRAY_YIELD[code]) return Math.round(q * TRAY_YIELD[code])
    if (inputType === 'logs' && LOG_YIELD[code]) return Math.round(q * LOG_YIELD[code])
    if (inputType === 'logs') return Math.round(q * 10)
    if (inputType === 'cakes' && CAKE_YIELD[code]) return Math.round(q * CAKE_YIELD[code])
    if (inputType === '6inch' || inputType === '9inch') return Math.round(q) // 1 cake = 1 unit
    return Math.round(q)
  }

  // Fetch all WIP product codes once for lookup
  async function getWIPCodes() {
    const { data } = await supabase.from('products').select('code,name,units').eq('category', 'WIP')
    return data || []
  }

  // Recursively flatten a BOM into raw material requirements
  // Returns { rm_name -> total_grams_needed }
  async function flattenToRM(productCode, multiplier, wipCodes, visited = new Set()) {
    if (visited.has(productCode)) return {}
    visited.add(productCode)
    const { data: bom } = await supabase.from('bom').select('rm_name,qty_per_unit,unit').eq('product_code', productCode)
    if (!bom?.length) return {}
    const rmNeeds = {}
    for (const item of bom) {
      if (!item.rm_name) continue
      const wipProduct = wipCodes.find(w => w.code.toLowerCase() === item.rm_name.toLowerCase())
      if (wipProduct) {
        // WIP ingredient — recurse into its BOM
        let wipMultiplier = multiplier
        if (item.unit === 'ea') {
          // fraction of a full batch
          wipMultiplier = multiplier * item.qty_per_unit
        } else {
          // gms of WIP — need to know WIP batch yield to scale
          const { data: wipBom } = await supabase.from('bom').select('qty_per_unit,unit').eq('product_code', wipProduct.code)
          const wipYield = (wipBom || []).reduce((s, i) => s + (i.unit === 'ml' ? 0 : (parseFloat(i.qty_per_unit) || 0)), 0)
          wipMultiplier = wipYield > 0 ? multiplier * (item.qty_per_unit / wipYield) : multiplier
        }
        const subNeeds = await flattenToRM(wipProduct.code, wipMultiplier, wipCodes, visited)
        for (const [name, qty] of Object.entries(subNeeds)) {
          rmNeeds[name] = (rmNeeds[name] || 0) + qty
        }
      } else {
        // Raw material
        const qtyGms = item.unit === 'ea' ? item.qty_per_unit * multiplier * 1000 : item.qty_per_unit * multiplier
        rmNeeds[item.rm_name] = (rmNeeds[item.rm_name] || 0) + qtyGms
      }
    }
    return rmNeeds
  }

  async function checkRM(code, outputUnits) {
    const wipCodes = await getWIPCodes()
    const { data: bom } = await supabase.from('bom').select('rm_name,qty_per_unit,component_type,wip_code,unit').eq('product_code', code)
    if (!bom?.length) return []
    const warns = []

    // ── Level 1: WIP stock check ──────────────────────────────
    for (const item of bom) {
      if (!item.rm_name) continue
      const wipProduct = wipCodes.find(w => w.code.toLowerCase() === item.rm_name.toLowerCase())
      if (wipProduct || item.component_type === 'wip') {
        const wip = wipProduct || wipCodes.find(w => w.code === item.wip_code)
        if (!wip) continue
        let needed = 0
        if (item.unit === 'ea') {
          needed = item.qty_per_unit * outputUnits
        } else {
          // gms of WIP needed
          needed = item.qty_per_unit * outputUnits
        }
        const have = wip.units || 0
        const unitLabel = item.unit === 'ea' ? ' ea' : 'g'
        if (have < needed) {
          warns.push({
            rm: (wip.name || item.rm_name) + ' [WIP]',
            needed: needed.toFixed(item.unit === 'ea' ? 2 : 0) + unitLabel,
            have: have.toFixed(item.unit === 'ea' ? 2 : 0) + unitLabel,
            isWip: true
          })
        }
      }
    }

    // ── Level 2: Flatten to raw materials ─────────────────────
    const rmNeeds = await flattenToRM(code, outputUnits, wipCodes)
    const rmNames = Object.keys(rmNeeds)
    if (rmNames.length > 0) {
      const { data: stocks } = await supabase.from('raw_materials').select('name,stock,unit').in('name', rmNames)
      const stockMap = {}
      ;(stocks || []).forEach(r => { stockMap[r.name] = r })
      for (const [rmName, neededGms] of Object.entries(rmNeeds)) {
        const rm = stockMap[rmName]
        if (!rm) continue
        const neededKg = neededGms / 1000
        if (rm.stock < neededKg) {
          warns.push({
            rm: rmName + ' [RM]',
            needed: neededKg.toFixed(3) + 'kg',
            have: (rm.stock || 0).toFixed(3) + 'kg',
            isWip: false
          })
        }
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
    setEditForm({ scheduled_date: s.scheduled_date, product_code: s.product_code, planned_input: String(s.planned_input), input_type: s.input_type, notes: s.notes || '' })
    setEditRMWarnings([])
    setShowEditModal(true)
  }

  async function saveEdit() {
    const { scheduled_date, product_code, planned_input, input_type, notes } = editForm
    if (!scheduled_date || !product_code) { alert('Please fill in date and product.'); return }
    const { data: p } = await supabase.from('products').select('name').eq('code', product_code).single()
    const planned_output = calcOutput(product_code, input_type, planned_input)
    const { error } = await supabase.from('production_schedule').update({
      scheduled_date, product_code, product_name: p?.name || product_code,
      planned_input: parseFloat(planned_input) || 0, input_type, planned_output, notes,
    }).eq('id', editingSchedule.id)
    if (error) { alert('Update failed: ' + error.message); return }
    setShowEditModal(false); setEditingSchedule(null); setEditRMWarnings([])
    loadData()
  }

  function addLog(msg, type = '') {
    setLog(l => [...l, { msg, type, time: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }])
  }

  async function saveProduction() {
    const { code, date, inputType, inputQty, outputUnits, notes } = form
    if (!code || !inputQty || !outputUnits) { alert('Please fill in all fields.'); return }
    const output = parseInt(outputUnits)
    addLog('Saving ' + code + ' +' + output + ' units...')
    const { data: prod } = await supabase.from('products').select('units,freezer_units,name').eq('code', code).single()
    const newUnits = (prod?.units || 0) + output
    const newFreezer = (prod?.freezer_units || 0) + output
    await supabase.from('products').update({ units: newUnits, freezer_units: newFreezer }).eq('code', code)
    addLog('✓ FG stock updated: ' + prod?.units + ' → ' + newUnits + ' (freezer +' + output + ')', 'ok')
    const { data: bom } = await supabase.from('bom').select('rm_name,qty_per_unit,component_type,wip_code,unit').eq('product_code', code)
    if (bom?.length) {
      // Fetch all WIP product codes for lookup
      const { data: wipProds } = await supabase.from('products').select('code,name,units').eq('category', 'WIP')
      const wipMap = {}
      ;(wipProds || []).forEach(w => { wipMap[w.code.toLowerCase()] = w })
      let rmCount = 0, wipCount = 0
      for (const item of bom) {
        if (!item.rm_name) continue
        // Detect WIP by component_type OR by rm_name matching a WIP product code
        const wipProduct = wipMap[item.rm_name.toLowerCase()]
        const wipCode = item.component_type === 'wip' ? item.wip_code : (wipProduct ? wipProduct.code : null)
        if (wipCode) {
          const wip = wipProduct || (wipProds || []).find(w => w.code === wipCode)
          if (wip) {
            let deductQty = 0
            if (item.unit === 'ea') {
              deductQty = item.qty_per_unit * output
            } else {
              deductQty = item.qty_per_unit * output // gms of WIP used
            }
            await supabase.from('products').update({ units: Math.max(0, (wip.units || 0) - deductQty) }).eq('code', wipCode)
            wipCount++
          }
        } else {
          const deductKg = (item.qty_per_unit * output) / 1000
          const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', item.rm_name).single()
          if (rm) { await supabase.from('raw_materials').update({ stock: Math.max(0, rm.stock - deductKg) }).eq('name', item.rm_name); rmCount++ }
        }
      }
      addLog('✓ ' + rmCount + ' RMs' + (wipCount ? ' + ' + wipCount + ' WIP components' : '') + ' deducted via BOM', 'ok')
    }
    await supabase.from('productions').insert({ date, product_code: code, product_name: prod?.name || code, input_qty: parseFloat(inputQty), input_type: inputType, output_units: output, notes, created_by_name: profile?.name })
    await supabase.from('activity').insert({ type: 'production', title: code + ': +' + output + ' units', description: inputQty + ' ' + inputType + ' · ' + (prod?.name), created_by_name: profile?.name })
    addLog('✓ Production saved successfully!', 'ok')
    setForm({ date: new Date().toISOString().split('T')[0], code: '', inputType: 'units', inputQty: '', outputUnits: '', notes: '' })
    setRmWarnings([])
    loadData()
  }

  async function deleteProduction(h) {
    if (!window.confirm('Delete production entry for ' + h.product_code + ' (+' + h.output_units + ' units) on ' + h.date + '?\n\nThis will reverse the stock change.')) return
    setDeletingId(h.id)
    try {
      const { data: prod } = await supabase.from('products').select('units,freezer_units').eq('code', h.product_code).single()
      if (prod) await supabase.from('products').update({
        units: Math.max(0, prod.units - h.output_units),
        freezer_units: Math.max(0, (prod.freezer_units || 0) - h.output_units),
      }).eq('code', h.product_code)
      const { data: bom } = await supabase.from('bom').select('rm_name,qty_per_unit,component_type,wip_code,unit').eq('product_code', h.product_code)
      if (bom?.length) {
        const { data: wipProds } = await supabase.from('products').select('code,units').eq('category', 'WIP')
        const wipMap = {}
        ;(wipProds || []).forEach(w => { wipMap[w.code.toLowerCase()] = w })
        for (const item of bom) {
          if (!item.rm_name) continue
          const wipProduct = wipMap[item.rm_name.toLowerCase()]
          const wipCode = item.component_type === 'wip' ? item.wip_code : (wipProduct ? wipProduct.code : null)
          if (wipCode) {
            const wip = wipProduct || (wipProds || []).find(w => w.code === wipCode)
            if (wip) {
              const restoreQty = item.qty_per_unit * h.output_units
              await supabase.from('products').update({ units: (wip.units || 0) + restoreQty }).eq('code', wipCode)
            }
          } else {
            const restoreKg = (item.qty_per_unit * h.output_units) / 1000
            const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', item.rm_name).single()
            if (rm) await supabase.from('raw_materials').update({ stock: rm.stock + restoreKg }).eq('name', item.rm_name)
          }
        }
      }
      await supabase.from('productions').delete().eq('id', h.id)
      await supabase.from('activity').insert({ type: 'production', title: 'Production Deleted: ' + h.product_code, description: h.output_units + ' units reversed · ' + h.date, created_by_name: profile?.name || 'admin' })
      loadData()
    } catch(err) { alert('Delete failed: ' + err.message) }
    setDeletingId(null)
  }

  async function saveSchedule() {
    const { scheduled_date, product_code, planned_input, input_type, notes } = schedForm
    if (!scheduled_date || !product_code) { alert('Please fill in date and product.'); return }
    const { data: p } = await supabase.from('products').select('name').eq('code', product_code).single()
    const planned_output = calcOutput(product_code, input_type, planned_input)
    const { error } = await supabase.from('production_schedule').insert({ scheduled_date, product_code, product_name: p?.name || product_code, planned_input: parseFloat(planned_input) || 0, input_type, planned_output, notes, status: 'planned', created_by_name: profile?.name }).select()
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

  function startFromSchedule(s) {
    setForm({ date: new Date().toISOString().split('T')[0], code: s.product_code, inputType: s.input_type || 'trays', inputQty: String(s.planned_input), outputUnits: String(s.planned_output || calcOutput(s.product_code, s.input_type, s.planned_input)), notes: s.notes || '' })
    setView('log')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function deleteSchedule(id, productCode) {
    if (!window.confirm('Delete this scheduled production for ' + productCode + '?')) return
    await supabase.from('production_schedule').delete().eq('id', id)
    loadData()
  }

  function sendScheduleEmail() {
    const byDate = {}
    schedule.forEach(s => { if (!byDate[s.scheduled_date]) byDate[s.scheduled_date] = []; byDate[s.scheduled_date].push(s) })
    const dates = Object.keys(byDate).sort()
    const selected = selectedSchedDates.size > 0 ? dates.filter(d => selectedSchedDates.has(d)) : dates
    let body = 'KK PRODUCTION SCHEDULE%0A%0A'
    selected.forEach(date => {
      const rows = byDate[date] || []
      const label = new Date(date + 'T12:00:00').toLocaleDateString('en-CA', { weekday:'long', month:'long', day:'numeric' }).toUpperCase()
      body += label + '%0A'
      rows.forEach(s => { body += '  ' + s.product_code + ' - ' + s.product_name + ': ' + s.planned_input + ' ' + s.input_type + ' → ' + (s.planned_output || 0) + ' units (' + s.status + ')%0A' })
      body += '%0A'
    })
    window.location.href = 'mailto:?subject=KK Production Schedule&body=' + body
  }

  // Group history by date
  const historyByDate = {}
  history.forEach(h => {
    const d = h.date || h.created_at?.split('T')[0] || 'Unknown'
    if (!historyByDate[d]) historyByDate[d] = []
    historyByDate[d].push(h)
  })

  const statusColors = { planned: 'blue', in_progress: 'amber', completed: 'green', cancelled: 'red' }
  const selectStyle = { width: '100%', padding: '12px 14px', fontSize: '14px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink)', fontFamily: 'var(--mono)', cursor: 'pointer', height: '48px' }
  const btnToggle = (active) => ({ padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--display)', background: active ? 'var(--kk-green)' : 'var(--surface)', color: active ? 'var(--kk-cream)' : 'var(--ink3)', fontWeight: active ? 600 : 400 })

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
                  {products.map(p => <option key={p.code} value={p.code}>{p.category==='WIP' ? '🧁 ' : ''}{p.code} — {p.name}</option>)}
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
                    <option value="cakes">Cakes (9 inch)</option>
                    <option value="6inch">6 inch Frosting Cake ($15 each)</option>
                    <option value="9inch">9 inch Frosting Cake ($25 each)</option>
                  </select>
                </div>
                <div className="field" style={{margin:0}}>
                  <label>Quantity</label>
                  <input type="number" value={form.inputQty} onChange={e => handleQtyChange(e.target.value)} placeholder="0" />
                </div>
              </div>
              {form.outputUnits && (
                <div style={{ background: 'var(--green-l)', padding: 12, borderRadius: 3, marginBottom: 14, fontSize: 12, color: 'var(--green)' }}>
                  <strong>Output: {packsDisplay(form.code, parseInt(form.outputUnits))}</strong>
                </div>
              )}
              {rmWarnings.length > 0 && (
                <div className="alert alert-red" style={{ flexDirection: 'column', gap: 4 }}>
                  <strong>⚠️ Insufficient RM stock:</strong>
                  {rmWarnings.map((w,i) => <div key={i} style={{fontSize:11}}>{w.rm}: need {w.needed}, have {w.have}</div>)}
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
              <div className="card-title">Yields Reference</div>
              <div className="table-wrap">
                <div style={{ fontSize:10, letterSpacing:'1.5px', textTransform:'uppercase', color:'var(--ink3)', fontFamily:'var(--display)', marginBottom:6 }}>Tray Yields</div>
                <table>
                  <thead><tr><th>Code</th><th>Product</th><th>Units/Tray</th></tr></thead>
                  <tbody>
                    {Object.entries(TRAY_YIELD).map(([code, y]) => (
                      <tr key={code}>
                        <td><span className="code-tag">{code}</span></td>
                        <td style={{fontSize:11}}>{products.find(p=>p.code===code)?.name||code}</td>
                        <td style={{fontWeight:500,color:'var(--green)'}}>{y}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize:10, letterSpacing:'1.5px', textTransform:'uppercase', color:'var(--ink3)', fontFamily:'var(--display)', margin:'14px 0 6px' }}>Log Yields (Biscotti)</div>
                <table>
                  <thead><tr><th>Code</th><th>Product</th><th>Units/Log</th></tr></thead>
                  <tbody>
                    {Object.entries(LOG_YIELD).map(([code, y]) => (
                      <tr key={code}>
                        <td><span className="code-tag">{code}</span></td>
                        <td style={{fontSize:11}}>{products.find(p=>p.code===code)?.name||code}</td>
                        <td style={{fontWeight:500,color:'var(--blue)'}}>{y}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ fontSize:10, letterSpacing:'1.5px', textTransform:'uppercase', color:'var(--ink3)', fontFamily:'var(--display)', margin:'14px 0 6px' }}>Cake Yields (per 9" cake)</div>
                <table>
                  <thead><tr><th>Code</th><th>Product</th><th>Units/Cake</th></tr></thead>
                  <tbody>
                    {Object.entries(CAKE_YIELD).map(([code, y]) => (
                      <tr key={code}>
                        <td><span className="code-tag">{code}</span></td>
                        <td style={{fontSize:11}}>{products.find(p=>p.code===code)?.name||code}</td>
                        <td style={{fontWeight:500,color:'var(--purple)'}}>{y}</td>
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
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:10 }}>
              <div className="card-title" style={{ margin:0 }}>Production Schedule</div>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                {(() => {
                  const dates = [...new Set(schedule.map(s => s.scheduled_date))].sort()
                  return dates.map(date => {
                    const label = new Date(date + 'T12:00:00').toLocaleDateString('en-CA', { month:'short', day:'numeric' })
                    const active = selectedSchedDates.has(date)
                    return (
                      <button key={date} onClick={() => setSelectedSchedDates(prev => { const next = new Set(prev); next.has(date) ? next.delete(date) : next.add(date); return next })} style={btnToggle(active)}>{label}</button>
                    )
                  })
                })()}
                {schedule.length > 0 && (
                  <button onClick={() => setSelectedSchedDates(selectedSchedDates.size > 0 ? new Set() : new Set(schedule.map(s => s.scheduled_date)))} style={btnToggle(selectedSchedDates.size > 0)}>
                    {selectedSchedDates.size > 0 ? 'Clear' : 'All'}
                  </button>
                )}
                <button onClick={sendScheduleEmail} style={{ padding:'6px 14px', borderRadius:6, border:'none', cursor:'pointer', fontSize:12, fontFamily:'var(--display)', letterSpacing:1, background:'var(--kk-green)', color:'var(--kk-cream)' }}>
                  ✉️ Send Schedule
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowScheduleModal(true)}>+ Add</button>
              </div>
            </div>

            {schedule.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)' }}>No scheduled production. Click "+ Schedule" to add.</div>
            ) : (() => {
              const byDate = {}
              schedule.forEach(s => { if (!byDate[s.scheduled_date]) byDate[s.scheduled_date] = []; byDate[s.scheduled_date].push(s) })
              const datesToShow = selectedSchedDates.size > 0 ? Object.entries(byDate).filter(([d]) => selectedSchedDates.has(d)) : Object.entries(byDate)
              return (
                <div>
                  {datesToShow.sort(([a],[b]) => a.localeCompare(b)).map(([date, rows]) => (
                    <div key={date} style={{ marginBottom: 24 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--kk-green)', borderRadius: '6px 6px 0 0' }}>
                        <div style={{ fontFamily: 'var(--display)', fontSize: 14, letterSpacing: 2, color: 'var(--kk-cream)' }}>
                          {new Date(date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
                        </div>
                        <DailyTotal rows={rows} products={products} />
                      </div>
                      <div className="table-wrap" style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
                        <table>
                          <thead>
                            <tr><th>Product</th><th>Planned Input</th><th>Planned Output</th><th>Batch Value</th><th>RM Check</th><th>Status</th><th></th><th style={{width:100}}></th></tr>
                          </thead>
                          <tbody>
                            {rows.map(s => (
                              <ScheduleRow key={s.id} s={s} allSchedule={schedule} statusColors={statusColors}
                                onStatusChange={updateScheduleStatus} onDelete={deleteSchedule}
                                onEdit={openEditModal} calcOutput={calcOutput} onStart={startFromSchedule} />
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
          <div>
            {Object.keys(historyByDate).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>No production history yet.</div>
            ) : Object.entries(historyByDate).map(([date, entries]) => {
              const dayValue = entries.reduce((sum, h) => {
                const prod = products.find(p => p.code === h.product_code)
                const ppp = productionValueFor(prod)
                const packs = sellableQty(h.product_code, h.output_units)
                return sum + (packs * ppp)
              }, 0)
              const dayUnits = entries.reduce((sum, h) => sum + (h.output_units || 0), 0)
              return (
                <div key={date} style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: 'var(--kk-green)', borderRadius: '6px 6px 0 0' }}>
                    <div style={{ fontFamily: 'var(--display)', fontSize: 13, letterSpacing: 2, color: 'var(--kk-cream)', textTransform: 'uppercase' }}>
                      {new Date(date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                    <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, letterSpacing: 1, color: 'rgba(227,221,209,.5)', fontFamily: 'var(--display)', textTransform: 'uppercase' }}>Units</div>
                        <div style={{ fontFamily: 'var(--display)', fontSize: 16, color: 'var(--kk-cream)', letterSpacing: 1 }}>{dayUnits.toLocaleString()}</div>
                      </div>
                      {dayValue > 0 && (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 9, letterSpacing: 1, color: 'rgba(227,221,209,.5)', fontFamily: 'var(--display)', textTransform: 'uppercase' }}>Retail Value</div>
                          <div style={{ fontFamily: 'var(--display)', fontSize: 16, color: 'var(--kk-peach)', letterSpacing: 1 }}>${dayValue.toFixed(0)}</div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 6px 6px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr>
                          {['Product','Input','Output','Value','By','Notes',''].map((h,i) => (
                            <th key={i} style={{ background: 'var(--surface2)', padding: '8px 14px', textAlign: 'left', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--ink3)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map(h => {
                          const prod = products.find(p => p.code === h.product_code)
                          const ppp = productionValueFor(prod)
                          const packs = sellableQty(h.product_code, h.output_units)
                          const batchVal = packs * ppp
                          return (
                            <tr key={h.id} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '10px 14px' }}><span className="code-tag">{h.product_code}</span></td>
                              <td style={{ padding: '10px 14px', color: 'var(--ink3)' }}>{h.input_qty} {h.input_type}</td>
                              <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--green)' }}>+{h.output_units}</td>
                              <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--kk-brown)' }}>
                                {batchVal > 0 ? '$' + batchVal.toFixed(0) : <span style={{ color: 'var(--ink3)' }}>—</span>}
                              </td>
                              <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--ink3)' }}>{h.created_by_name}</td>
                              <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--ink3)' }}>{h.notes}</td>
                              <td style={{ padding: '10px 14px' }}>
                                <button onClick={() => deleteProduction(h)} disabled={deletingId === h.id}
                                  style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)', opacity: deletingId === h.id ? 0.5 : 1 }}>
                                  {deletingId === h.id ? '...' : 'Del'}
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ADD SCHEDULE MODAL */}
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
                {products.map(p => <option key={p.code} value={p.code}>{p.category==='WIP' ? '🧁 ' : ''}{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <div className="field" style={{margin:0}}>
                <label>Input Type</label>
                <select style={selectStyle} value={schedForm.input_type} onChange={e => setSchedForm(f=>({...f,input_type:e.target.value}))}>
                  <option value="trays">Trays</option>
                  <option value="units">Units</option>
                  <option value="loaves">Loaves</option>
                  <option value="logs">Logs (Biscotti)</option>
                  <option value="cakes">Cakes (9 inch)</option>
                  <option value="6inch">6 inch Frosting Cake ($15 each)</option>
                  <option value="9inch">9 inch Frosting Cake ($25 each)</option>
                </select>
              </div>
              <div className="field" style={{margin:0}}><label>Planned Qty</label>
                <input type="number" value={schedForm.planned_input} onChange={e => handleSchedQtyChange(e.target.value)} />
              </div>
            </div>
            {schedForm.product_code && schedForm.planned_input && (
              <div style={{ background: 'var(--green-l)', padding: 10, borderRadius: 3, marginBottom: 12, fontSize: 12, color: 'var(--green)' }}>
                <strong>Expected output: {packsDisplay(schedForm.product_code, calcOutput(schedForm.product_code, schedForm.input_type, schedForm.planned_input))}</strong>
              </div>
            )}
            {scheduleRMWarnings.length > 0 && (
              <div className="alert alert-red" style={{ flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                <strong>⚠️ Insufficient RM stock:</strong>
                {scheduleRMWarnings.map((w,i) => <div key={i} style={{fontSize:11}}>{w.rm}: need {w.needed}, have {w.have}</div>)}
              </div>
            )}
            {scheduleRMWarnings.length === 0 && schedForm.product_code && schedForm.planned_input && (
              <div style={{ background: 'var(--green-l)', padding: 8, borderRadius: 3, marginBottom: 12, fontSize: 11, color: 'var(--green)' }}>✅ RM stock sufficient</div>
            )}
            <div className="field"><label>Notes</label><textarea value={schedForm.notes} onChange={e => setSchedForm(f=>({...f,notes:e.target.value}))} rows={2} /></div>
            <div style={{display:'flex',gap:10}}>
              <button className="btn btn-primary btn-full" onClick={saveSchedule}>Save Schedule</button>
              <button className="btn btn-secondary" onClick={() => setShowScheduleModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT SCHEDULE MODAL */}
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
                {products.map(p => <option key={p.code} value={p.code}>{p.category==='WIP' ? '🧁 ' : ''}{p.code} — {p.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <div className="field" style={{margin:0}}>
                <label>Input Type</label>
                <select style={selectStyle} value={editForm.input_type} onChange={e => setEditForm(f=>({...f,input_type:e.target.value}))}>
                  <option value="trays">Trays</option>
                  <option value="units">Units</option>
                  <option value="loaves">Loaves</option>
                  <option value="logs">Logs (Biscotti)</option>
                  <option value="cakes">Cakes (9 inch)</option>
                  <option value="6inch">6 inch Frosting Cake ($15 each)</option>
                  <option value="9inch">9 inch Frosting Cake ($25 each)</option>
                </select>
              </div>
              <div className="field" style={{margin:0}}><label>Planned Qty</label>
                <input type="number" value={editForm.planned_input} onChange={e => handleEditQtyChange(e.target.value)} />
              </div>
            </div>
            {editForm.product_code && editForm.planned_input && (
              <div style={{ background: 'var(--green-l)', padding: 10, borderRadius: 3, marginBottom: 12, fontSize: 12, color: 'var(--green)' }}>
                <strong>Expected output: {packsDisplay(editForm.product_code, calcOutput(editForm.product_code, editForm.input_type, editForm.planned_input))}</strong>
              </div>
            )}
            {editRMWarnings.length > 0 && (
              <div className="alert alert-red" style={{ flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                <strong>⚠️ Insufficient RM stock:</strong>
                {editRMWarnings.map((w,i) => <div key={i} style={{fontSize:11}}>{w.rm}: need {w.needed}, have {w.have}</div>)}
              </div>
            )}
            {editRMWarnings.length === 0 && editForm.product_code && editForm.planned_input && (
              <div style={{ background: 'var(--green-l)', padding: 8, borderRadius: 3, marginBottom: 12, fontSize: 11, color: 'var(--green)' }}>✅ RM stock sufficient</div>
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
        const { data: p } = await supabase.from('products').select('price_per_pack,production_value').eq('code', s.product_code).single()
        if (p) { const pv = p.production_value != null ? parseFloat(p.production_value) : (parseFloat(p.price_per_pack) || 0); sum += sellableQty(s.product_code, s.planned_output || 0) * pv }
      }
      setTotal(sum)
    }
    calc()
  }, [rows.map(r => r.id).join(',')])
  if (total === null) return <span style={{ fontSize: 12, color: 'rgba(227,221,209,.5)' }}>...</span>
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 10, letterSpacing: 1, color: 'rgba(227,221,209,.5)', fontFamily: 'var(--display)' }}>DAY TOTAL</div>
      <div style={{ fontFamily: 'var(--display)', fontSize: 20, color: 'var(--kk-peach)', letterSpacing: 1 }}>${total.toFixed(2)}</div>
    </div>
  )
}

function ScheduleRow({ s, allSchedule, statusColors, onStatusChange, onDelete, onEdit, calcOutput, onStart }) {
  const [rmStatus, setRMStatus] = useState(null)
  const [batchValue, setBatchValue] = useState(null)

  // Use production_value for batch tracking if set, otherwise fall back to price_per_pack
  function productionValueFor(prod) {
    if (!prod) return 0
    return prod.production_value != null ? parseFloat(prod.production_value) : (parseFloat(prod.price_per_pack) || 0)
  }
  useEffect(() => {
    async function check() {
      const out = s.planned_output || calcOutput(s.product_code, s.input_type, s.planned_input)
      const { data: p } = await supabase.from('products').select('price_per_pack,production_value').eq('code', s.product_code).single()
      if (p) { const pv = p.production_value != null ? parseFloat(p.production_value) : (parseFloat(p.price_per_pack) || 0); setBatchValue(sellableQty(s.product_code, out) * pv) } else setBatchValue(0)
      const { data: bom } = await supabase.from('bom').select('rm_name,qty_per_unit,component_type,wip_code').eq('product_code', s.product_code)
      if (!bom?.length) { setRMStatus([]); return }
      const rmNames = bom.filter(b => b.component_type !== 'wip').map(b => b.rm_name)
      const wipCodes = bom.filter(b => b.component_type === 'wip').map(b => b.wip_code)
      const [rmsRes, wipsRes] = await Promise.all([
        rmNames.length ? supabase.from('raw_materials').select('name,stock').in('name', rmNames) : Promise.resolve({ data: [] }),
        wipCodes.length ? supabase.from('products').select('code,units').in('code', wipCodes) : Promise.resolve({ data: [] }),
      ])
      const stockMap = {}
      ;(rmsRes.data || []).forEach(r => { stockMap[r.name] = r.stock })
      const wipStockMap = {}
      ;(wipsRes.data || []).forEach(w => { wipStockMap[w.code] = w.units })
      const myIndex = allSchedule.findIndex(x => x.id === s.id)
      const priorBatches = allSchedule.slice(0, myIndex).filter(x => x.status === 'planned' || x.status === 'in_progress')
      const committedMap = {}
      const committedWipMap = {}
      for (const prior of priorBatches) {
        const { data: priorBom } = await supabase.from('bom').select('rm_name,qty_per_unit,component_type,wip_code').eq('product_code', prior.product_code)
        const priorOut = prior.planned_output || calcOutput(prior.product_code, prior.input_type, prior.planned_input)
        ;(priorBom || []).forEach(item => {
          if (item.component_type === 'wip') {
            committedWipMap[item.wip_code] = (committedWipMap[item.wip_code] || 0) + item.qty_per_unit * priorOut
          } else {
            const needed = (item.qty_per_unit * priorOut) / 1000
            committedMap[item.rm_name] = (committedMap[item.rm_name] || 0) + needed
          }
        })
      }
      const warns = []
      for (const item of bom) {
        if (item.component_type === 'wip') {
          const needed = item.qty_per_unit * out
          const currentStock = wipStockMap[item.wip_code] || 0
          const committed = committedWipMap[item.wip_code] || 0
          const remaining = currentStock - committed
          if (remaining < needed) warns.push({ rm: item.wip_code + ' (WIP)', needed: needed.toFixed(1), remaining: remaining.toFixed(1), shortBy: (needed - remaining).toFixed(1) })
        } else {
          const neededKg = (item.qty_per_unit * out) / 1000
          const currentStock = stockMap[item.rm_name] || 0
          const committed = committedMap[item.rm_name] || 0
          const remaining = currentStock - committed
          if (remaining < neededKg) warns.push({ rm: item.rm_name, needed: neededKg.toFixed(3), remaining: remaining.toFixed(3), shortBy: (neededKg - remaining).toFixed(3) })
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
      <td style={{fontWeight:500,color:'var(--green)'}}>{packsDisplay(s.product_code, s.planned_output)}</td>
      <td style={{fontWeight:600,color:'var(--kk-brown)'}}>
        {batchValue === null ? '...' : batchValue > 0 ? '$' + batchValue.toFixed(2) : <span style={{color:'var(--ink3)'}}>—</span>}
      </td>
      <td>
        {rmStatus === null ? <span style={{fontSize:11,color:'var(--ink3)'}}>...</span>
          : rmStatus.length === 0 ? <span style={{fontSize:11,color:'var(--green)'}}>✅ All OK</span>
          : rmStatus.map((w,i) => (
            <div key={i} style={{fontSize:10,color:'var(--red)',lineHeight:1.6}}>
              ⚠️ {w.rm.split(' ').slice(0,2).join(' ')}: need {w.needed}kg, {parseFloat(w.remaining) < 0 ? 'none left' : w.remaining + 'kg left'} (short {w.shortBy}kg)
            </div>
          ))
        }
      </td>
      <td><span className={'badge badge-' + statusColors[s.status]}>{s.status}</span></td>
      <td>
        <select value={s.status} onChange={e => onStatusChange(s.id, e.target.value)}
          style={{ fontSize:10, padding:'3px 6px', border:'1px solid var(--border)', borderRadius:2, fontFamily:'var(--display)', background:'var(--surface)' }}>
          <option value="planned">Planned</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </td>
      <td>
        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
          {(s.status === 'planned' || s.status === 'in_progress') && (
            <button onClick={() => onStart(s)} style={{ background:'#E79B81', border:'none', color:'#fff', borderRadius:3, padding:'3px 8px', fontSize:11, cursor:'pointer', fontFamily:'var(--display)', fontWeight:700 }}>▶ Run</button>
          )}
          <button onClick={() => onEdit(s)} style={{ background:'var(--kk-green)', border:'none', color:'#fff', borderRadius:3, padding:'3px 8px', fontSize:11, cursor:'pointer', fontFamily:'var(--display)' }}>Edit</button>
          <button onClick={() => onDelete(s.id, s.product_code)} style={{ background:'none', border:'1px solid var(--red)', color:'var(--red)', borderRadius:3, padding:'3px 8px', fontSize:11, cursor:'pointer', fontFamily:'var(--display)' }}>Del</button>
        </div>
      </td>
    </tr>
  )
}
