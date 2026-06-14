import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const PACK_SIZE = { VPB:3,VPCAN:3,PNF:3,PVBRG:1,PVBR:1,PBB:2,PCC:2,KLR:2,KSCD:4,VPBD:2,KHD:2,HPC:5,HPCo:5,KABIS:5,KAB:5,KWAL:5,PVHC:5,POS:5,PGCo:5,KCOC:1,KSCO:5,PVBB:1,GBL:1,KPL:1,CCL:1,BAGL:2,Focaccia:1,TRFCS:1,HRCS:1,VSCS:1,NALCOB:1,NBFB:1,PRMC:1,CMC:1,LMC:1,TMC:1,PCrt:1 }

const AI_PROMPT = `You are reading Konscious Kitchen packing slips. Each slip is a printed form with labeled rows.

The form has these labeled fields at the top:
- "Date of Packing" — the dispatch date (e.g. May 11)
- "Customer" — the store/customer name (e.g. BC Danforth, Natures Emporium Southcore)
- "Invoice Number" — a 4-digit number (e.g. 4702). Look carefully at the handwritten value.

Below is a table with columns: Product Name | Cs/Units | Prod. Date
- The Cs/Units column shows "X/Y" where X = cases and Y = units (e.g. "1/6" = 1 case, 6 units). Extract qty as the UNITS number (Y).
- The Prod. Date column has the PRODUCTION DATE — capture it exactly as written.

Product codes: VPB, VPCAN, PNF, PVBRG, PVBR, PBB, PCC, KLR, KSCD, VPBD, KHD, HPCo, KABIS, KAB, KWAL, PVHC, POS, PGCo, KCOC, KSCO, PVBB, GBL, KPL, CCL, BAGL, Focaccia, TRFCS, HRCS, VSCS, NALCOB, NBFB, PRMC, CMC, LMC, TMC.
Also: HPC/HPCO = HPCo, PCRT = skip.

Rules:
- (BULK) written after code or qty = type "bulk"; no label = "pack"
- PVBBS or "PVBB Slice" = type "slice"
- Crossed out items = skip entirely (do not include)
- Arrow pointing down = same slip continues below
- Multiple separate slips = extract each separately
- If qty column shows a standalone number (no X/Y format) treat it as units directly
- Do NOT confuse pack type — only mark "bulk" if explicitly written

SPECIAL RULES FOR NATURES EMPORIUM (when customer name contains "Natures Emporium"):
The following items are ALWAYS bulk (single units) for Natures Emporium — mark type as "bulk":
- Pecan / Vegan Pecan Bars → VPCAN, bulk
- Pistachio / Vegan Pistachio Bars → VPB, bulk
- Brownie Ganache / PVBRG → PVBRG, bulk
- Notella / No'tella Fudge → PNF, bulk
- Almond Butter Cookie / KAB → KAB, bulk
- Walnut Cookie / KWAL → KWAL, bulk
- Banana Bread Slice Frosted / PVBBSLF → PVBBSLF, slice
The following are ALWAYS pack for Natures Emporium (in 6s):
- Keto Cups (CKTC, CKTV, CKLR, CKAC, CKHH) → pack

Return ONLY valid JSON:
{"slips":[{"date":"May 11","customer":"BC Danforth","invoice":"4702","items":[{"code":"PBB","qty":6,"cases":1,"type":"pack","production_date":"May 08","note":""}],"flags":[]}]}`

function parseSlipDate(dateStr) {
  if (!dateStr) return new Date().toISOString().split('T')[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  try {
    const year = new Date().getFullYear()
    const d = new Date(`${dateStr} ${year}`)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  } catch(e) {}
  return new Date().toISOString().split('T')[0]
}

// ── Auto-packing logic ──────────────────────────────────────
// Called before dispatching each pack item.
// If packed_units < packsNeeded, auto-creates a packing run for the shortfall.
async function autoPackIfNeeded(productCode, packsNeeded, dispatchDate, createdByName, addLog) {
  if (!productCode || !packsNeeded) return

  // Get current product state
  const { data: prod } = await supabase
    .from('products')
    .select('code, name, units, freezer_units, packed_units')
    .eq('code', productCode)
    .single()

  if (!prod) return

  const packedAvailable = prod.packed_units || 0
  if (packedAvailable >= packsNeeded) return // enough packed stock, no auto-pack needed

  const shortfallPacks = packsNeeded - packedAvailable
  const ps = PACK_SIZE[productCode] || 1
  const shortfallUnits = shortfallPacks * ps

  const freezerAvailable = prod.freezer_units || 0
  if (freezerAvailable < shortfallUnits) {
    if (addLog) addLog(`⚠ ${productCode}: not enough freezer stock for auto-pack (need ${shortfallUnits}, have ${freezerAvailable})`, 'warn')
    return
  }

  if (addLog) addLog(`📦 Auto-packing ${shortfallPacks} packs (${shortfallUnits} units) of ${productCode}...`, '')

  // 1. Log packing run
  await supabase.from('packing_runs').insert({
    date: dispatchDate,
    product_code: productCode,
    product_name: prod.name,
    units_packed: shortfallUnits,
    packs_produced: shortfallPacks,
    units_per_pack: ps,
    notes: 'Auto-packed for dispatch',
    created_by_name: createdByName || 'auto',
  })

  // 2. Update freezer and packed
  const newFreezer = freezerAvailable - shortfallUnits
  const newPacked = packedAvailable + shortfallPacks
  const newTotal = newFreezer + (newPacked * ps)
  await supabase.from('products').update({
    freezer_units: newFreezer,
    packed_units: newPacked,
    units: newTotal,
  }).eq('code', productCode)

  // 3. Deduct packaging materials
  const { data: bomItems } = await supabase
    .from('packaging_bom')
    .select('*')
    .eq('product_code', productCode)

  if (bomItems?.length) {
    for (const item of bomItems) {
      const { data: rm } = await supabase
        .from('raw_materials')
        .select('stock')
        .eq('name', item.material_name)
        .single()
      if (rm) {
        const newStock = Math.max(0, (rm.stock || 0) - (item.qty_per_pack * shortfallPacks))
        await supabase.from('raw_materials').update({ stock: newStock }).eq('name', item.material_name)
      }
    }
    if (addLog) addLog(`✓ Auto-packed ${productCode}: ${shortfallPacks} packs, packaging deducted`, 'ok')
  }
}

// Deduct from packed_units after dispatch
async function deductFromPacked(productCode, packsDispatched) {
  const { data: prod } = await supabase
    .from('products')
    .select('units, freezer_units, packed_units')
    .eq('code', productCode)
    .single()
  if (!prod) return

  const ps = PACK_SIZE[productCode] || 1
  const unitsDispatched = packsDispatched * ps

  // Pull from packed first, then freezer
  let fromPacked = Math.min(prod.packed_units || 0, packsDispatched)
  let fromFreezer = packsDispatched - fromPacked

  const newPacked = (prod.packed_units || 0) - fromPacked
  const newFreezer = (prod.freezer_units || 0) - (fromFreezer * ps)
  const newTotal = Math.max(0, (prod.units || 0) - unitsDispatched)

  await supabase.from('products').update({
    packed_units: Math.max(0, newPacked),
    freezer_units: Math.max(0, newFreezer),
    units: newTotal,
  }).eq('code', productCode)
}

export default function Dispatch() {
  const { profile } = useAuth()
  const [view, setView] = useState('ai')
  const [files, setFiles] = useState([])
  const [processing, setProcessing] = useState(false)
  const [extracted, setExtracted] = useState([])
  const [editingExtracted, setEditingExtracted] = useState(false)
  const [verifiedItems, setVerifiedItems] = useState({})
  const [log, setLog] = useState([])
  const [products, setProducts] = useState([])
  const [dispatches, setDispatches] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [manForm, setManForm] = useState({ date: new Date().toISOString().split('T')[0], customer: '', invoice: '' })
  const [manLines, setManLines] = useState([])
  const [manCode, setManCode] = useState('')
  const [manQty, setManQty] = useState('')
  const [manType, setManType] = useState('pack')

  const [editingDispatch, setEditingDispatch] = useState(null)
  const [editForm, setEditForm] = useState({ date: '', customer_name: '', invoice_number: '' })
  const [editItems, setEditItems] = useState([])
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [p, d] = await Promise.all([
      supabase.from('products').select('code,name').order('code'),
      supabase.from('dispatches').select('*,dispatch_items(*)').order('created_at', { ascending: false }).limit(100),
    ])
    setProducts(p.data || [])
    setDispatches(d.data || [])
  }

  function calcUnits(code, qty, type) {
    if (type === 'slice') return Math.round(qty / 3)
    if (type === 'bulk') return qty
    return qty * (PACK_SIZE[code] || 1)
  }

  function addLog(msg, type = '') {
    setLog(l => [...l, { msg, type, time: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }])
  }

  async function fileToB64(f) {
    return new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result.split(',')[1])
      r.onerror = rej
      r.readAsDataURL(f)
    })
  }

  async function verifyProductionDates(slips) {
    const verified = {}
    for (const slip of slips) {
      for (const item of slip.items || []) {
        if (!item.production_date) continue
        const dateStr = parseSlipDate(item.production_date)
        const key = `${item.code}_${dateStr}`
        const { data } = await supabase.from('productions')
          .select('id').eq('product_code', item.code).eq('date', dateStr).limit(1)
        verified[key] = data && data.length > 0
      }
    }
    return verified
  }

  async function processSlips() {
    if (!files.length) return
    setProcessing(true); setLog([]); setExtracted([]); setVerifiedItems({})
    addLog(`Processing ${files.length} file(s)...`)
    const allSlips = []
    for (let i = 0; i < files.length; i += 4) {
      const batch = files.slice(i, i + 4)
      try {
        const content = []
        for (const f of batch) {
          const b64 = await fileToB64(f)
          const isPDF = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
          content.push(isPDF
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
            : { type: 'image', source: { type: 'base64', media_type: f.type || 'image/jpeg', data: b64 } }
          )
        }
        content.push({ type: 'text', text: 'Extract all packing slip data. Capture the Date column for each line item as production_date. Return JSON only.' })
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.REACT_APP_ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 4000, system: AI_PROMPT, messages: [{ role: 'user', content }] })
        })
        const data = await res.json()
        if (data.error) { addLog(`Error: ${data.error.message}`, 'err'); continue }
        const raw = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim()
        const parsed = JSON.parse(raw)
        ;(parsed.slips || []).forEach(slip => {
          allSlips.push(slip)
          addLog(`✓ ${slip.customer} — Inv #${slip.invoice || '?'} — ${slip.items?.length || 0} lines`, 'ok')
          ;(slip.flags || []).forEach(f => addLog(`⚠ ${f}`, 'warn'))
        })
      } catch (err) { addLog(`Error: ${err.message}`, 'err') }
    }
    setExtracted(allSlips)
    if (allSlips.length > 0) {
      addLog('Verifying production dates...', '')
      const verified = await verifyProductionDates(allSlips)
      setVerifiedItems(verified)
      const found = Object.values(verified).filter(Boolean).length
      const total = Object.keys(verified).length
      addLog(`✓ Production date check: ${found}/${total} verified`, 'ok')
    }
    addLog('Done!', 'ok')
    setProcessing(false)
  }

  async function saveExtracted() {
    let savedSlips = 0
    let savedLines = 0
    for (const slip of extracted) {
      const dateStr = parseSlipDate(slip.date)
      addLog(`Saving: ${slip.customer} — date: ${dateStr}`)

      const { data: dispatch, error: dispatchErr } = await supabase
        .from('dispatches').insert({
          date: dateStr, customer_name: slip.customer,
          invoice_number: slip.invoice || '',
          created_by_name: profile?.name || 'admin'
        }).select().single()
      if (dispatchErr) { addLog(`❌ Dispatch save error: ${dispatchErr.message}`, 'err'); continue }
      savedSlips++

      for (const item of slip.items || []) {
        const units = calcUnits(item.code, item.qty, item.type)
        const packs = item.type === 'pack' ? item.qty : null
        const prodDateStr = item.production_date ? parseSlipDate(item.production_date) : null
        const key = `${item.code}_${prodDateStr}`
        const prodVerified = prodDateStr ? verifiedItems[key] : null

        // ── Auto-pack if needed (pack items only) ──
        if (item.type === 'pack' && packs) {
          await autoPackIfNeeded(item.code, packs, dateStr, profile?.name, addLog)
        }

        const { error: itemErr } = await supabase.from('dispatch_items').insert({
          dispatch_id: dispatch.id,
          product_code: item.code,
          product_name: products.find(p => p.code === item.code)?.name || item.code,
          qty: item.qty, dispatch_type: item.type, units_dispatched: units,
          production_date: prodDateStr,
          production_verified: prodVerified
        })
        if (itemErr) { addLog(`❌ Item error (${item.code}): ${itemErr.message}`, 'err'); continue }

        // ── Deduct stock (packed first, then freezer) ──
        if (item.type === 'pack' && packs) {
          await deductFromPacked(item.code, packs)
        } else {
          // bulk/slice — deduct from units directly
          const { data: prod } = await supabase.from('products').select('units').eq('code', item.code).single()
          if (prod) await supabase.from('products').update({ units: Math.max(0, prod.units - units) }).eq('code', item.code)
        }

        savedLines++
      }

      await supabase.from('activity').insert({
        type: 'dispatch', title: `Dispatch: ${slip.customer}`,
        description: `${slip.items?.length} lines · Inv #${slip.invoice || '—'}`,
        created_by_name: profile?.name || 'admin'
      })
    }
    addLog(`✓ Saved ${savedSlips} slip(s), ${savedLines} lines. Stock updated.`, 'ok')
    setExtracted([]); setFiles([]); setVerifiedItems({}); loadData()
  }

  async function saveManual() {
    if (!manForm.customer || !manLines.length) { alert('Add customer and at least one line.'); return }
    const { data: dispatch, error: err } = await supabase
      .from('dispatches').insert({ date: manForm.date, customer_name: manForm.customer, invoice_number: manForm.invoice, created_by_name: profile?.name || 'admin' })
      .select().single()
    if (err) { alert('Save error: ' + err.message); return }

    for (const line of manLines) {
      const units = calcUnits(line.code, line.qty, line.type)
      const packs = line.type === 'pack' ? line.qty : null

      // ── Auto-pack if needed ──
      if (line.type === 'pack' && packs) {
        await autoPackIfNeeded(line.code, packs, manForm.date, profile?.name, null)
      }

      await supabase.from('dispatch_items').insert({
        dispatch_id: dispatch.id, product_code: line.code,
        product_name: products.find(p => p.code === line.code)?.name || line.code,
        qty: line.qty, dispatch_type: line.type, units_dispatched: units
      })

      // ── Deduct stock ──
      if (line.type === 'pack' && packs) {
        await deductFromPacked(line.code, packs)
      } else {
        const { data: prod } = await supabase.from('products').select('units').eq('code', line.code).single()
        if (prod) await supabase.from('products').update({ units: Math.max(0, prod.units - units) }).eq('code', line.code)
      }
    }

    await supabase.from('activity').insert({
      type: 'dispatch', title: `Dispatch: ${manForm.customer}`,
      description: `${manLines.length} lines · Inv #${manForm.invoice || '—'}`,
      created_by_name: profile?.name || 'admin'
    })
    setManLines([]); setManForm({ date: new Date().toISOString().split('T')[0], customer: '', invoice: '' }); loadData()
  }

  async function deleteDispatch(dispatch) {
    if (!window.confirm(`Delete dispatch for ${dispatch.customer_name || 'unknown'} (Inv #${dispatch.invoice_number || '—'})?\n\nThis will restore stock levels.`)) return
    setDeletingId(dispatch.id)
    try {
      for (const item of dispatch.dispatch_items || []) {
        const { data: prod } = await supabase.from('products').select('units').eq('code', item.product_code).single()
        if (prod) await supabase.from('products').update({ units: prod.units + item.units_dispatched }).eq('code', item.product_code)
      }
      await supabase.from('dispatch_items').delete().eq('dispatch_id', dispatch.id)
      await supabase.from('dispatches').delete().eq('id', dispatch.id)
      await supabase.from('activity').insert({
        type: 'dispatch', title: `Dispatch Deleted: ${dispatch.customer_name}`,
        description: `Inv #${dispatch.invoice_number || '—'} — stock restored`,
        created_by_name: profile?.name || 'admin'
      })
      loadData()
    } catch(err) { alert('Delete failed: ' + err.message) }
    setDeletingId(null)
  }

  function openEdit(dispatch) {
    setEditingDispatch(dispatch)
    setEditForm({ date: dispatch.date, customer_name: dispatch.customer_name, invoice_number: dispatch.invoice_number || '' })
    setEditItems((dispatch.dispatch_items || []).map(i => ({ ...i })))
  }

  function updateEditItem(idx, field, val) {
    setEditItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      const updated = { ...item, [field]: val }
      if (field === 'qty' || field === 'dispatch_type') {
        updated.units_dispatched = calcUnits(updated.product_code, parseFloat(field === 'qty' ? val : updated.qty) || 0, field === 'dispatch_type' ? val : updated.dispatch_type)
      }
      return updated
    }))
  }

  function removeEditItem(idx) { setEditItems(prev => prev.filter((_, i) => i !== idx)) }
  function addEditItem() { setEditItems(prev => [...prev, { product_code: '', product_name: '', qty: 1, dispatch_type: 'pack', units_dispatched: 0, production_date: '', isNew: true }]) }

  async function saveEdit() {
    if (!editForm.customer_name) { alert('Customer name required'); return }
    setEditSaving(true)
    try {
      for (const item of editingDispatch.dispatch_items || []) {
        const { data: prod } = await supabase.from('products').select('units').eq('code', item.product_code).single()
        if (prod) await supabase.from('products').update({ units: prod.units + item.units_dispatched }).eq('code', item.product_code)
      }
      await supabase.from('dispatches').update({ date: editForm.date, customer_name: editForm.customer_name, invoice_number: editForm.invoice_number }).eq('id', editingDispatch.id)
      await supabase.from('dispatch_items').delete().eq('dispatch_id', editingDispatch.id)
      for (const item of editItems) {
        if (!item.product_code) continue
        const units = calcUnits(item.product_code, parseFloat(item.qty) || 0, item.dispatch_type)
        await supabase.from('dispatch_items').insert({
          dispatch_id: editingDispatch.id, product_code: item.product_code,
          product_name: products.find(p => p.code === item.product_code)?.name || item.product_code,
          qty: parseFloat(item.qty) || 0, dispatch_type: item.dispatch_type, units_dispatched: units,
          production_date: item.production_date || null, production_verified: item.production_verified || null,
        })
        const { data: prod } = await supabase.from('products').select('units').eq('code', item.product_code).single()
        if (prod) await supabase.from('products').update({ units: prod.units - units }).eq('code', item.product_code)
      }
      await supabase.from('activity').insert({ type: 'dispatch', title: `Dispatch Updated: ${editForm.customer_name}`, description: `Inv #${editForm.invoice_number || '—'} — edited`, created_by_name: profile?.name || 'admin' })
      setEditingDispatch(null); setEditItems([]); loadData()
    } catch(err) { alert('Update failed: ' + err.message) }
    setEditSaving(false)
  }

  const prodBadge = (verified) => {
    if (verified === null || verified === undefined) return null
    return verified
      ? <span style={{ fontSize: 10, background: 'var(--green-l)', color: 'var(--green)', padding: '1px 5px', borderRadius: 2, fontFamily: 'var(--mono)' }}>✓ prod</span>
      : <span style={{ fontSize: 10, background: 'var(--red-l)', color: 'var(--red)', padding: '1px 5px', borderRadius: 2, fontFamily: 'var(--mono)' }}>✗ prod</span>
  }

  const sel = { width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)', color: 'var(--ink)', fontSize: 12 }

  return (
    <>
      <div className="page-header">
        <div><h2>DISPATCH</h2><p>Process orders & packing slips</p></div>
      </div>
      <div className="page-body">
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {['ai','manual','history'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: view===v?'var(--ink)':'var(--ink3)', borderBottom: view===v?'2px solid var(--ink)':'2px solid transparent', marginBottom: -1 }}>
              {v === 'ai' ? '📸 AI Reader' : v === 'manual' ? '✏️ Manual' : '📜 History'}
            </button>
          ))}
        </div>

        {view === 'ai' && (
          <div className="grid2">
            <div>
              <div className="card">
                <div className="card-title">Upload Packing Slips</div>
                <div className="upload-zone">
                  <input type="file" accept="image/*,.pdf,application/pdf" multiple onChange={e => setFiles(Array.from(e.target.files))} />
                  <div className="upload-icon" style={{fontSize:32}}>📋</div>
                  <div style={{fontSize:12,color:'var(--ink2)',lineHeight:1.8}}>
                    <strong>Tap to upload packing slips</strong><br/>
                    📷 Camera · 🖼 Gallery · 📄 PDF · Multiple OK
                  </div>
                </div>
                {files.length > 0 && (
                  <div className="thumb-row">
                    {files.map((f, i) => (
                      <div key={i} className="thumb-wrap">
                        {f.type === 'application/pdf' || f.name.endsWith('.pdf')
                          ? <div style={{width:64,height:64,background:'var(--red-l)',border:'1px solid var(--red)',borderRadius:3,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2}}><span style={{fontSize:20}}>📄</span><span style={{fontSize:8,color:'var(--red)'}}>PDF</span></div>
                          : <img src={URL.createObjectURL(f)} alt="" style={{width:64,height:64,objectFit:'cover',border:'1px solid var(--border)',borderRadius:3}} />
                        }
                        <button className="thumb-x" onClick={() => setFiles(files.filter((_,j)=>j!==i))}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                <button className="btn btn-primary btn-full" style={{marginTop:12}} onClick={processSlips} disabled={!files.length || processing}>
                  {processing ? <><span className="spinner" style={{borderTopColor:'#fff',borderColor:'rgba(255,255,255,.3)'}} /> Reading...</> : 'Read Slips with AI'}
                </button>
              </div>
              <div className="log">
                {log.length === 0
                  ? <span style={{color:'var(--ink3)'}}>Ready — upload images to begin</span>
                  : log.map((l,i) => <div key={i} className={l.type}>{l.time} — {l.msg}</div>)
                }
              </div>
            </div>
            <div>
              {extracted.length > 0 && (
                <div className="card">
                  <div className="card-title">✅ Review Extracted Data</div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <span style={{fontSize:12,color:'var(--ink3)'}}>Review and correct before saving</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingExtracted(e => !e)}>
                      {editingExtracted ? '✓ Done Editing' : '✏️ Edit'}
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Customer</th><th>Inv #</th><th>Code</th><th>Qty</th><th>Type</th><th>Units</th><th>Prod Date</th>{editingExtracted && <th></th>}</tr></thead>
                      <tbody>
                        {extracted.map((slip, si) => (slip.items || []).map((item, ii) => {
                          const prodDateStr = item.production_date ? parseSlipDate(item.production_date) : null
                          const key = `${item.code}_${prodDateStr}`
                          const verified = prodDateStr ? verifiedItems[key] : undefined
                          return (
                            <tr key={`${si}-${ii}`}>
                              <td style={{fontSize:11}}>{ii === 0 ? (editingExtracted
                                ? <input defaultValue={slip.customer} onChange={e => { const s = [...extracted]; s[si].customer = e.target.value; setExtracted(s) }} style={{width:'100%',fontSize:11,padding:'2px 4px',border:'1px solid var(--border)',borderRadius:3}} />
                                : slip.customer) : ''}</td>
                              <td style={{fontSize:11,color:'var(--ink3)'}}>{ii === 0 ? (editingExtracted
                                ? <input defaultValue={slip.invoice} onChange={e => { const s = [...extracted]; s[si].invoice = e.target.value; setExtracted(s) }} style={{width:60,fontSize:11,padding:'2px 4px',border:'1px solid var(--border)',borderRadius:3}} />
                                : (slip.invoice || '—')) : ''}</td>
                              <td>{editingExtracted
                                ? <input defaultValue={item.code} onChange={e => { const s = [...extracted]; s[si].items[ii].code = e.target.value.toUpperCase(); setExtracted(s) }} style={{width:70,fontSize:11,padding:'2px 4px',border:'1px solid var(--border)',borderRadius:3,fontFamily:'var(--mono)'}} />
                                : <span className="code-tag">{item.code}</span>}</td>
                              <td>{editingExtracted
                                ? <input type="number" defaultValue={item.qty} onChange={e => { const s = [...extracted]; s[si].items[ii].qty = parseInt(e.target.value)||0; setExtracted(s) }} style={{width:50,fontSize:11,padding:'2px 4px',border:'1px solid var(--border)',borderRadius:3}} />
                                : item.qty}</td>
                              <td>{editingExtracted
                                ? <select defaultValue={item.type} onChange={e => { const s = [...extracted]; s[si].items[ii].type = e.target.value; setExtracted(s) }} style={{fontSize:11,padding:'2px 4px',border:'1px solid var(--border)',borderRadius:3}}>
                                    <option value="pack">pack</option><option value="bulk">bulk</option><option value="slice">slice</option>
                                  </select>
                                : <span className={`badge badge-${item.type==='pack'?'amber':'blue'}`}>{item.type}</span>}</td>
                              <td style={{color:'var(--green)',fontWeight:500}}>{calcUnits(item.code,item.qty,item.type)}</td>
                              <td style={{fontSize:11}}>{editingExtracted
                                ? <input defaultValue={item.production_date} onChange={e => { const s = [...extracted]; s[si].items[ii].production_date = e.target.value; setExtracted(s) }} style={{width:80,fontSize:11,padding:'2px 4px',border:'1px solid var(--border)',borderRadius:3}} />
                                : <>{item.production_date || '—'}{prodDateStr && verified !== undefined && <span style={{marginLeft:4}}>{prodBadge(verified)}</span>}</>}</td>
                              {editingExtracted && <td>
                                <button onClick={() => { const s = [...extracted]; s[si].items.splice(ii,1); setExtracted([...s]) }} style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:14}}>×</button>
                              </td>}
                            </tr>
                          )
                        }))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{display:'flex',gap:10,marginTop:12}}>
                    <button className="btn btn-primary btn-full" onClick={saveExtracted}>Save All to Inventory</button>
                    <button className="btn btn-secondary" onClick={() => { setExtracted([]); setVerifiedItems({}); setEditingExtracted(false) }}>Discard</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'manual' && (
          <div className="grid2">
            <div className="card">
              <div className="card-title">Manual Dispatch Entry</div>
              <div className="field"><label>Customer</label><input type="text" value={manForm.customer} onChange={e=>setManForm(f=>({...f,customer:e.target.value}))} placeholder="Customer name" /></div>
              <div className="field-row">
                <div className="field" style={{margin:0}}><label>Date</label><input type="date" value={manForm.date} onChange={e=>setManForm(f=>({...f,date:e.target.value}))} /></div>
                <div className="field" style={{margin:0}}><label>Invoice #</label><input type="text" value={manForm.invoice} onChange={e=>setManForm(f=>({...f,invoice:e.target.value}))} placeholder="4601" /></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr auto',gap:8,marginBottom:12,alignItems:'flex-end'}}>
                <div className="field" style={{margin:0}}><label>Product</label><select value={manCode} onChange={e=>setManCode(e.target.value)}><option value="">Select...</option>{products.map(p=><option key={p.code} value={p.code}>{p.code}</option>)}</select></div>
                <div className="field" style={{margin:0}}><label>Qty</label><input type="number" value={manQty} onChange={e=>setManQty(e.target.value)} placeholder="0" /></div>
                <div className="field" style={{margin:0}}><label>Type</label><select value={manType} onChange={e=>setManType(e.target.value)}><option value="pack">Pack</option><option value="bulk">Bulk</option><option value="slice">Slice</option></select></div>
                <button className="btn btn-secondary btn-sm" style={{marginBottom:0}} onClick={() => { if(manCode&&manQty){setManLines(l=>[...l,{code:manCode,qty:parseInt(manQty),type:manType}]);setManCode('');setManQty('')} }}>+</button>
              </div>
              {manLines.map((l,i) => (
                <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'var(--surface2)',borderRadius:3,marginBottom:6,fontSize:12}}>
                  <span className="code-tag">{l.code}</span>
                  <span style={{flex:1}}>{l.qty} {l.type}</span>
                  <span style={{color:'var(--green)',fontWeight:500}}>={calcUnits(l.code,l.qty,l.type)}u</span>
                  <button onClick={()=>setManLines(manLines.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:16}}>×</button>
                </div>
              ))}
              {manLines.length > 0 && <button className="btn btn-primary btn-full" style={{marginTop:8}} onClick={saveManual}>Save Dispatch</button>}
            </div>
          </div>
        )}

        {view === 'history' && (
          <div className="card">
            <div className="card-title">Recent Dispatches</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{width:20}}></th>
                    <th>Date</th><th>Customer</th><th>Invoice</th><th>Lines</th><th>By</th>
                    <th style={{width:120}}></th>
                  </tr>
                </thead>
                <tbody>
                  {dispatches.map(d => (
                    <React.Fragment key={d.id}>
                      <tr style={{ background: expandedId === d.id ? 'var(--surface2)' : '' }}>
                        <td style={{fontSize:11,color:'var(--ink3)',cursor:'pointer'}} onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>{expandedId === d.id ? '▼' : '▶'}</td>
                        <td style={{fontSize:12,cursor:'pointer'}} onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>{d.date}</td>
                        <td style={{fontWeight:500,cursor:'pointer'}} onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>{d.customer_name}</td>
                        <td style={{fontSize:11,color:'var(--ink3)',cursor:'pointer'}} onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>{d.invoice_number || '—'}</td>
                        <td style={{cursor:'pointer'}} onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>{d.dispatch_items?.length || 0}</td>
                        <td style={{fontSize:11,color:'var(--ink3)',cursor:'pointer'}} onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>{d.created_by_name}</td>
                        <td>
                          <div style={{ display:'flex', gap:4 }}>
                            <button onClick={() => openEdit(d)} style={{ background: 'var(--kk-green)', border: 'none', color: '#fff', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)' }}>Edit</button>
                            <button onClick={() => deleteDispatch(d)} disabled={deletingId === d.id} style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)', opacity: deletingId === d.id ? 0.5 : 1 }}>
                              {deletingId === d.id ? '...' : 'Del'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === d.id && (
                        <tr>
                          <td colSpan={7} style={{padding:'0 0 12px 32px',background:'var(--surface2)'}}>
                            <table style={{width:'100%',fontSize:12}}>
                              <thead>
                                <tr>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Code</th>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Product</th>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Qty</th>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Type</th>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Units</th>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Prod Date</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(d.dispatch_items || []).map((item, i) => (
                                  <tr key={i} style={{borderTop:'1px solid var(--border)'}}>
                                    <td style={{padding:'6px 8px'}}><span className="code-tag">{item.product_code}</span></td>
                                    <td style={{padding:'6px 8px',color:'var(--ink2)'}}>{item.product_name}</td>
                                    <td style={{padding:'6px 8px'}}>{item.qty}</td>
                                    <td style={{padding:'6px 8px'}}><span className={`badge badge-${item.dispatch_type==='pack'?'amber':'blue'}`}>{item.dispatch_type}</span></td>
                                    <td style={{padding:'6px 8px',color:'var(--green)',fontWeight:500}}>{item.units_dispatched}</td>
                                    <td style={{padding:'6px 8px',fontSize:11}}>
                                      {item.production_date || '—'}
                                      {item.production_date && item.production_verified !== null && item.production_verified !== undefined && (
                                        <span style={{marginLeft:4}}>
                                          {item.production_verified ? <span style={{color:'var(--green)'}}>✓</span> : <span style={{color:'var(--red)'}}>✗</span>}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {editingDispatch && (
        <div className="modal-bg" onClick={e => e.target === e.currentTarget && setEditingDispatch(null)}>
          <div className="modal" style={{ maxWidth: 680 }}>
            <button className="modal-close" onClick={() => setEditingDispatch(null)}>×</button>
            <div className="modal-title">EDIT DISPATCH</div>
            <div style={{ fontSize:13, color:'var(--ink3)', marginBottom:16 }}>
              Original: {editingDispatch.customer_name} · Inv #{editingDispatch.invoice_number || '—'}
            </div>
            <div className="field-row">
              <div className="field" style={{margin:0}}><label>Date</label><input type="date" value={editForm.date} onChange={e => setEditForm(f => ({...f, date: e.target.value}))} /></div>
              <div className="field" style={{margin:0}}><label>Invoice #</label><input type="text" value={editForm.invoice_number} onChange={e => setEditForm(f => ({...f, invoice_number: e.target.value}))} placeholder="e.g. 4664" /></div>
            </div>
            <div className="field"><label>Customer</label><input type="text" value={editForm.customer_name} onChange={e => setEditForm(f => ({...f, customer_name: e.target.value}))} /></div>
            <div style={{ fontSize:11, letterSpacing:2, textTransform:'uppercase', color:'var(--ink3)', marginBottom:8, fontFamily:'var(--display)' }}>Line Items ({editItems.length})</div>
            {editItems.map((item, idx) => (
              <div key={idx} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6, background:'var(--surface2)', padding:'8px 10px', borderRadius:6, flexWrap:'wrap' }}>
                <select style={{...sel, flex:2, minWidth:120}} value={item.product_code}
                  onChange={e => { const p = products.find(p => p.code === e.target.value); setEditItems(prev => prev.map((it, i) => i === idx ? { ...it, product_code: e.target.value, product_name: p?.name || e.target.value } : it)) }}>
                  <option value="">Select...</option>
                  {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
                </select>
                <input type="number" value={item.qty} onChange={e => updateEditItem(idx, 'qty', e.target.value)} style={{...sel, width:64}} placeholder="Qty" />
                <select style={{...sel, width:90}} value={item.dispatch_type} onChange={e => updateEditItem(idx, 'dispatch_type', e.target.value)}>
                  <option value="pack">Pack</option><option value="bulk">Bulk</option><option value="slice">Slice</option>
                </select>
                <input type="date" value={item.production_date || ''} onChange={e => updateEditItem(idx, 'production_date', e.target.value)} style={{...sel, flex:1, minWidth:120}} />
                <span style={{ fontSize:11, color:'var(--kk-green)', fontWeight:600, whiteSpace:'nowrap' }}>= {calcUnits(item.product_code, parseFloat(item.qty)||0, item.dispatch_type)} u</span>
                <button onClick={() => removeEditItem(idx)} style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:18 }}>×</button>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" onClick={addEditItem} style={{ marginBottom:16 }}>+ Add Line</button>
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-green btn-full" onClick={saveEdit} disabled={editSaving}>{editSaving ? 'Saving...' : 'Save Changes'}</button>
              <button className="btn btn-secondary" onClick={() => setEditingDispatch(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
