import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const PACK_SIZE = { VPB:3,VPCAN:3,PNF:3,PVBRG:1,PVBR:4,PBB:2,PCC:2,KLR:2,KSCD:4,VPBD:2,KHD:2,HPC:5,KABIS:5,WSBIS:5,COBIS:5,KAB:5,KWAL:5,PVHC:5,POS:5,PGCo:5,KCOC:1,KSCO:5,PVBB:1,GBL:1,KPL:1,CCL:1,BAGL:2,Focaccia:1,TRFCS:1,HRCS:1,VSCS:1,NALCOB:1,NBFB:1,KCC:1,KVC:1,KLRCup:1,KCCKE:1,KVCKE:1,KLRCKE:1 }
const TRAY_SIZE = { VPB: 64, VPCAN: 36, PNF: 40, PVBRG: 36, PVBR: 12 }
const DATE_RANGES = [
  { label: '3 Months', days: 90 },
  { label: '6 Months', days: 180 },
  { label: '12 Months', days: 365 },
]

// Bulk codes — tracked via freezer_units, excluded from FG inventory cards
const BULK_FG_EXCLUDE = new Set([
  'PBBBu','PCCBu','KLRBu','KABBu','KWALBu','HPCoBu','PVHCBu',
  'VPCANBu','VPBBu','PNFBu','KABISBu','KSCDBu',
  'PVBBSL','PVBBSLF',
  'CKAC','CKHH',
])

// Conversion map: rm name (lowercase) → { divisor, unit, label }
const RM_DISPLAY = {
  'eggs':               { divisor: 9000,  unit: 'cases', detail: '180 eggs/case' },
  'coconut milk':       { divisor: 2400,  unit: 'cases', detail: '6 cans × 400g' },
  'almond butter jar':  { divisor: 750,   unit: 'jars',  detail: '750g/jar' },
  'almond butter tub':  { divisor: 10000, unit: 'tubs',  detail: '10kg/tub' },
}

function displayStock(name, stock) {
  const conv = RM_DISPLAY[name?.toLowerCase()]
  if (!conv || !stock) return null
  const converted = stock / conv.divisor
  return { value: converted % 1 === 0 ? converted : converted.toFixed(2), unit: conv.unit, detail: conv.detail, raw: stock }
}

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
  const [editFreezerVal, setEditFreezerVal] = useState('')
  const [editPackedVal, setEditPackedVal] = useState('')
  const [showAlertsOnly, setShowAlertsOnly] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedRM, setSelectedRM] = useState(null)
  const [dateRange, setDateRange] = useState(90)
  const [productHistory, setProductHistory] = useState({ productions: [], dispatches: [] })
  const [rmHistory, setRMHistory] = useState({ sourcing: [], used: [] })
  const [historyLoading, setHistoryLoading] = useState(false)

  const [packForm, setPackForm] = useState({ product_code: '', packs: '', date: new Date().toISOString().split('T')[0], notes: '' })
  const [packSaving, setPackSaving] = useState(false)
  const [packLog, setPackLog] = useState([])
  const [packingRuns, setPackingRuns] = useState([])
  const [packPreview, setPackPreview] = useState(null)

  const location = useLocation()

  useEffect(() => { loadData() }, [])
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const tabParam = params.get('tab')
    const filterParam = params.get('filter')
    if (tabParam === 'rm') setTab('rm')
    if (tabParam === 'fg') setTab('fg')
    if (tabParam === 'pack') setTab('pack')
    if (filterParam === 'alerts') setShowAlertsOnly(true)
  }, [location.search])
  useEffect(() => { if (selectedProduct) loadProductHistory(selectedProduct, dateRange) }, [selectedProduct, dateRange])
  useEffect(() => { if (selectedRM) loadRMHistory(selectedRM, dateRange) }, [selectedRM, dateRange])
  useEffect(() => { if (tab === 'pack') loadPackingRuns() }, [tab])
  useEffect(() => {
    if (packForm.product_code && packForm.packs) {
      const p = products.find(x => x.code === packForm.product_code)
      if (!p) return setPackPreview(null)
      const ps = PACK_SIZE[packForm.product_code] || 1
      const packs = parseInt(packForm.packs) || 0
      const units = packs * ps
      setPackPreview({ ps, units, freezer: p.freezer_units || 0, packed: p.packed_units || 0, canPack: (p.freezer_units || 0) >= units })
    } else setPackPreview(null)
  }, [packForm.product_code, packForm.packs, products])

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

  async function loadPackingRuns() {
    const { data } = await supabase.from('packing_runs').select('*').order('created_at', { ascending: false }).limit(50)
    setPackingRuns(data || [])
  }

  async function loadProductHistory(code, days) {
    setHistoryLoading(true)
    const since = new Date(); since.setDate(since.getDate() - days)
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
    const since = new Date(); since.setDate(since.getDate() - days)
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

  async function savePacking() {
    if (!packForm.product_code || !packForm.packs) return
    const p = products.find(x => x.code === packForm.product_code)
    if (!p) return
    const ps = PACK_SIZE[packForm.product_code] || 1
    const packs = parseInt(packForm.packs)
    const units = packs * ps
    if ((p.freezer_units || 0) < units) {
      alert(`Not enough freezer stock. Need ${units} units, have ${p.freezer_units || 0}.`)
      return
    }
    setPackSaving(true)
    try {
      await supabase.from('packing_runs').insert({
        date: packForm.date, product_code: packForm.product_code, product_name: p.name,
        units_packed: units, packs_produced: packs, units_per_pack: ps, notes: packForm.notes || null,
      })
      const newFreezer = (p.freezer_units || 0) - units
      const newPacked = (p.packed_units || 0) + packs
      const newTotal = newFreezer + (newPacked * ps)
      await supabase.from('products').update({ freezer_units: newFreezer, packed_units: newPacked, units: newTotal }).eq('code', packForm.product_code)
      const { data: bomItems } = await supabase.from('packaging_bom').select('*').eq('product_code', packForm.product_code)
      if (bomItems?.length) {
        for (const item of bomItems) {
          const { data: rm } = await supabase.from('raw_materials').select('stock').eq('name', item.material_name).single()
          if (rm) {
            const newStock = Math.max(0, (rm.stock || 0) - (item.qty_per_pack * packs))
            await supabase.from('raw_materials').update({ stock: newStock }).eq('name', item.material_name)
          }
        }
      }
      await supabase.from('activity').insert({ type: 'production', title: `Packed: ${p.name}`, description: `${packs} packs (${units} units) · ${packForm.date}` })
      setPackLog(l => [`✓ Packed ${packs} packs (${units} units) of ${p.name}`, ...l])
      setPackForm(f => ({ ...f, product_code: '', packs: '', notes: '' }))
      setPackPreview(null)
      await loadData(); await loadPackingRuns()
    } catch(err) { alert('Error: ' + err.message) }
    setPackSaving(false)
  }

  async function saveEdit() {
    const newVal = parseFloat(editVal)
    if (isNaN(newVal)) return
    const oldVal = tab === 'fg' ? editItem.units : editItem.stock
    if (tab === 'fg') {
      const freezerVal = parseFloat(editFreezerVal)
      const packedVal = parseFloat(editPackedVal)
      const update = { units: newVal }
      if (!isNaN(freezerVal)) update.freezer_units = freezerVal
      if (!isNaN(packedVal)) update.packed_units = packedVal
      await supabase.from('products').update(update).eq('code', editItem.code)
    } else {
      await supabase.from('raw_materials').update({ stock: newVal }).eq('name', editItem.name)
    }
    await supabase.from('stock_adjustments').insert({ type: tab, item_code: editItem.code || editItem.name, item_name: editItem.name || editItem.code, old_value: oldVal, new_value: newVal, reason: editReason || 'Manual correction' })
    await supabase.from('activity').insert({ type: 'stock', title: (editItem.code || editItem.name) + ' corrected', description: oldVal + ' -> ' + newVal + ' — ' + (editReason || 'Manual correction') })
    setEditItem(null); setEditVal(''); setEditReason(''); setEditFreezerVal(''); setEditPackedVal('')
    loadData()
  }

  const fgCategories = ['all', ...new Set(
    products.filter(p => !BULK_FG_EXCLUDE.has(p.code)).map(p => p.category)
  )]
  const rmCategories = ['all', ...new Set(rms.map(r => r.category))]

  const filteredFG = products.filter(p => {
    if (BULK_FG_EXCLUDE.has(p.code)) return false
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

  const fgStats = {
    total: products.filter(p => !BULK_FG_EXCLUDE.has(p.code)).reduce((s,p)=>s+Math.max(0,p.units),0),
    low: products.filter(p => !BULK_FG_EXCLUDE.has(p.code) && p.units>0 && p.units<=p.min_stock).length,
    out: products.filter(p => !BULK_FG_EXCLUDE.has(p.code) && p.units<=0).length
  }
  const rmStats = { total: rms.length, low: rms.filter(r=>r.stock>0&&r.stock<=r.min_stock).length, out: rms.filter(r=>r.stock<=0).length }

  const btnStyle = (active) => ({
    padding: '5px 12px', border: '1px solid var(--border)', borderRadius: 3,
    background: active ? 'var(--kk-green)' : 'var(--surface)',
    color: active ? '#fff' : 'var(--ink3)',
    cursor: 'pointer', fontSize: 11, fontFamily: 'var(--mono)'
  })
  const sel = { width: '100%', padding: '10px 14px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--body)', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', outline: 'none' }

  const selectedProductData = selectedProduct ? products.find(p => p.code === selectedProduct) : null
  const selectedRMData = selectedRM ? rms.find(r => r.name === selectedRM) : null

  return (
    <>
      <div className="page-header">
        <div><h2>INVENTORY</h2><p>Finished goods & raw materials</p></div>
        <button className="btn btn-secondary btn-sm" onClick={loadData}>↻ Refresh</button>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {[
            { key: 'fg', label: '📦 Finished Goods' },
            { key: 'pack', label: '📦 Packing' },
            { key: 'rm', label: '🌿 Raw Materials' },
          ].map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setCatFilter('all'); setSearch(''); setSelectedProduct(null); setSelectedRM(null); }}
              style={{ padding: '12px 24px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: tab===t.key ? 'var(--ink)' : 'var(--ink3)', borderBottom: tab===t.key ? '2px solid var(--ink)' : '2px solid transparent', marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'pack' && (
          <div className="grid2" style={{ alignItems: 'start' }}>
            <div>
              <div className="card">
                <div className="card-title">📦 Log Packing Run</div>
                <div className="field">
                  <label>Product</label>
                  <select style={sel} value={packForm.product_code} onChange={e => setPackForm(f => ({ ...f, product_code: e.target.value, packs: '' }))}>
                    <option value="">Select product...</option>
                    {products.filter(p => !p.code.startsWith('WIP') && !BULK_FG_EXCLUDE.has(p.code)).map(p => (
                      <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
                    ))}
                  </select>
                </div>
                {packForm.product_code && (
                  <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
                    <div style={{ display: 'flex', gap: 24 }}>
                      <div>
                        <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>Freezer</div>
                        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--display)', color: 'var(--kk-green)' }}>
                          {products.find(p => p.code === packForm.product_code)?.freezer_units || 0}
                          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink3)', marginLeft: 4 }}>units</span>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>Already Packed</div>
                        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--display)', color: 'var(--blue)' }}>
                          {products.find(p => p.code === packForm.product_code)?.packed_units || 0}
                          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink3)', marginLeft: 4 }}>packs</span>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>Pack Size</div>
                        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--display)', color: 'var(--ink2)' }}>
                          {PACK_SIZE[packForm.product_code] || 1}
                          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--ink3)', marginLeft: 4 }}>units/pk</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="field-row">
                  <div className="field" style={{ margin: 0 }}>
                    <label>Number of Packs</label>
                    <input type="number" style={sel} value={packForm.packs} onChange={e => setPackForm(f => ({ ...f, packs: e.target.value }))} placeholder="e.g. 50" min="1" />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Date</label>
                    <input type="date" style={sel} value={packForm.date} onChange={e => setPackForm(f => ({ ...f, date: e.target.value }))} />
                  </div>
                </div>
                {packPreview && (
                  <div style={{ background: packPreview.canPack ? 'var(--green-l)' : 'var(--red-l)', border: '1px solid ' + (packPreview.canPack ? 'var(--green)' : 'var(--red)'), borderRadius: 6, padding: '10px 14px', margin: '12px 0', fontSize: 12 }}>
                    {packPreview.canPack ? (
                      <>
                        <div style={{ fontWeight: 600, color: 'var(--kk-green)', marginBottom: 4 }}>✓ Ready to pack</div>
                        <div style={{ color: 'var(--ink2)' }}>Will use <strong>{packPreview.units} freezer units</strong> → produce <strong>{packForm.packs} packs</strong></div>
                        <div style={{ color: 'var(--ink3)', marginTop: 2 }}>Freezer after: {packPreview.freezer - packPreview.units} units · Packed after: {packPreview.packed + parseInt(packForm.packs)} packs</div>
                      </>
                    ) : (
                      <div style={{ color: 'var(--red)', fontWeight: 600 }}>✗ Not enough freezer stock. Need {packPreview.units} units, have {packPreview.freezer}.</div>
                    )}
                  </div>
                )}
                <div className="field">
                  <label>Notes (optional)</label>
                  <input type="text" style={sel} value={packForm.notes} onChange={e => setPackForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Saturday batch" />
                </div>
                <button className="btn btn-green btn-full" onClick={savePacking} disabled={packSaving || !packForm.product_code || !packForm.packs || (packPreview && !packPreview.canPack)}>
                  {packSaving ? 'Saving...' : '📦 Log Packing Run'}
                </button>
                {packLog.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    {packLog.map((l, i) => <div key={i} style={{ fontSize: 11, color: 'var(--kk-green)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>✓ {l}</div>)}
                  </div>
                )}
              </div>
              {packForm.product_code && packForm.packs && packPreview?.canPack && (
                <PackagingPreview productCode={packForm.product_code} packs={parseInt(packForm.packs)} rms={rms} />
              )}
            </div>
            <div className="card">
              <div className="card-title">Recent Packing Runs</div>
              {packingRuns.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--ink3)', textAlign: 'center', padding: 24 }}>No packing runs yet</div>
                : <div style={{ overflowY: 'auto', maxHeight: 600 }}>
                    {packingRuns.map((run, i) => (
                      <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{run.product_name || run.product_code}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{run.packs_produced} packs · {run.units_packed} units · {run.date}</div>
                          {run.notes && <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{run.notes}</div>}
                        </div>
                        <span className="code-tag">{run.product_code}</span>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </div>
        )}

        {tab !== 'pack' && (
          <>
            {tab === 'fg' ? (
              <div className="grid4" style={{ marginBottom: 16 }}>
                <div className="stat green"><div className="stat-label">Total Units</div><div className="stat-value">{fgStats.total.toLocaleString()}</div></div>
                <div className="stat"><div className="stat-label">SKUs</div><div className="stat-value">{filteredFG.length}</div></div>
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
                <button onClick={() => setShowAlertsOnly(false)} style={{ marginLeft:'auto', background:'none', border:'1px solid var(--amber)', color:'var(--amber)', borderRadius:4, padding:'2px 10px', fontSize:11, cursor:'pointer' }}>Show all</button>
              </div>
            )}

            <div className="filter-bar">
              {(tab === 'fg' ? fgCategories : rmCategories).map(cat => (
                <button key={cat} className={'filter-btn ' + (catFilter===cat?'active':'')} onClick={() => setCatFilter(cat)}>{cat === 'all' ? 'All' : cat}</button>
              ))}
              <input className="search-input" placeholder={'Search ' + (tab==='fg'?'product':'material') + '...'} value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--ink3)' }}>Loading...</div> : (
              tab === 'fg' ? (
                <div style={{ display: 'grid', gridTemplateColumns: selectedProduct ? '1fr 420px' : '1fr', gap: 16, alignItems: 'start' }}>
                  <div className="stock-grid">
                    {filteredFG.map(p => {
                      const ps = PACK_SIZE[p.code] || p.pack_size || 1
                      const cls = p.units <= 0 ? 'critical' : p.units <= p.min_stock ? 'low' : 'healthy'
                      const bar = p.units <= 0 ? 'var(--red)' : p.units <= p.min_stock ? 'var(--amber)' : 'var(--green)'
                      const isSelected = selectedProduct === p.code
                      const frozenUnits = p.freezer_units ?? p.units
                      const packedPacks = p.packed_units ?? 0
                      return (
                        <div key={p.code} className={'stock-item ' + cls}
                          onClick={() => setSelectedProduct(isSelected ? null : p.code)}
                          style={{ cursor: 'pointer', outline: isSelected ? '2px solid var(--kk-green)' : 'none', minHeight: 140 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div className="si-code">{p.code}</div>
                            {(isAdmin || isKitchen) && <button onClick={e => { e.stopPropagation(); setEditItem(p); setEditVal(String(p.units)); setEditFreezerVal(String(p.freezer_units ?? p.units)); setEditPackedVal(String(p.packed_units ?? 0)); }}
                              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 2, padding: '1px 6px', fontSize: 9, cursor: 'pointer', color: 'var(--ink3)' }}>edit</button>}
                          </div>
                          <div className="si-name">{p.name}</div>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginTop: 4 }}>
                            <div>
                              <div style={{ fontSize: 32, fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--blue)', lineHeight: 1 }}>{packedPacks}</div>
                              <div style={{ fontSize: 10, color: 'var(--ink3)' }}>packed</div>
                            </div>
                            <div style={{ color: 'var(--border2)', fontSize: 20 }}>·</div>
                            <div>
                              {TRAY_SIZE[p.code] ? (
                                <>
                                  <div style={{ fontSize: 22, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--kk-green)', lineHeight: 1 }}>{(frozenUnits / TRAY_SIZE[p.code]).toFixed(1)}</div>
                                  <div style={{ fontSize: 10, color: 'var(--ink3)' }}>trays frozen</div>
                                </>
                              ) : (
                                <>
                                  <div style={{ fontSize: 22, fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--kk-green)', lineHeight: 1 }}>{frozenUnits}</div>
                                  <div style={{ fontSize: 10, color: 'var(--ink3)' }}>units frozen</div>
                                </>
                              )}
                            </div>
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 4 }}>{p.units} total units</div>
                          <div className="stock-bar"><div className="stock-bar-fill" style={{ width: Math.min(100,Math.max(0,p.units/(p.min_stock*2)*100)) + '%', background: bar }} /></div>
                        </div>
                      )
                    })}
                  </div>

                  {selectedProduct && (
                    <div className="card" style={{ position: 'sticky', top: 16, maxHeight: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexShrink: 0 }}>
                        <div>
                          <div className="card-title" style={{ margin: 0 }}><span className="code-tag">{selectedProduct}</span> History</div>
                          {selectedProductData && (
                            <div style={{ marginTop: 8, display: 'flex', gap: 16 }}>
                              <div>
                                <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>Packed</div>
                                <div style={{ fontSize: 24, fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--blue)', lineHeight: 1 }}>{selectedProductData.packed_units ?? 0}</div>
                                <div style={{ fontSize: 10, color: 'var(--ink3)' }}>packs</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>Frozen</div>
                                <div style={{ fontSize: 24, fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--kk-green)', lineHeight: 1 }}>
                                  {TRAY_SIZE[selectedProduct] ? (selectedProductData.freezer_units / TRAY_SIZE[selectedProduct]).toFixed(1) : (selectedProductData.freezer_units ?? 0)}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--ink3)' }}>{TRAY_SIZE[selectedProduct] ? 'trays' : 'units'}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>Total</div>
                                <div style={{ fontSize: 24, fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--ink2)', lineHeight: 1 }}>{selectedProductData.units}</div>
                                <div style={{ fontSize: 10, color: 'var(--ink3)' }}>units</div>
                              </div>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          {DATE_RANGES.map(r => <button key={r.days} style={btnStyle(dateRange === r.days)} onClick={() => setDateRange(r.days)}>{r.label}</button>)}
                          <button onClick={() => setSelectedProduct(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--ink3)' }}>×</button>
                        </div>
                      </div>
                      {historyLoading ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--ink3)' }}>Loading...</div> : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, overflow: 'hidden', flex: 1 }}>
                          <div>
                            <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--mono)' }}>🏭 Productions</div>
                            <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', paddingRight: 4 }}>
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
                          </div>
                          <div>
                            <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--mono)' }}>📋 Dispatches</div>
                            <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', paddingRight: 4 }}>
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
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: selectedRM ? '1fr 420px' : '1fr', gap: 16, alignItems: 'start' }}>
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
                          const disp = displayStock(r.name, r.stock)
                          return (
                            <tr key={r.name} onClick={() => setSelectedRM(isSelected ? null : r.name)}
                              style={{ cursor: 'pointer', background: isSelected ? 'var(--surface2)' : '' }}>
                              <td style={{ fontWeight: 500 }}>{r.name}</td>
                              <td><span style={{ fontSize: 10, color: 'var(--ink3)' }}>{r.category}</span></td>
                              <td style={{ fontWeight: 600, color: 'var(--' + cls + ')' }}>
                                {disp ? (
                                  <span>
                                    {disp.value} <span style={{ fontWeight: 400, color: 'var(--ink3)', fontSize: 11 }}>{disp.unit}</span>
                                    <div style={{ fontSize: 10, color: 'var(--ink3)', fontWeight: 400 }}>{disp.raw.toLocaleString()}g</div>
                                  </span>
                                ) : r.stock?.toFixed(3)}
                              </td>
                              <td style={{ color: 'var(--ink3)' }}>{disp ? disp.unit : r.unit}</td>
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
                    <div className="card" style={{ position: 'sticky', top: 16, maxHeight: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexShrink: 0 }}>
                        <div>
                          <div className="card-title" style={{ margin: 0, fontSize: 12 }}>{selectedRM}</div>
                          {selectedRMData && (() => {
                            const disp = displayStock(selectedRM, selectedRMData.stock)
                            return (
                              <div style={{ marginTop: 8 }}>
                                <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--mono)' }}>Current Stock</div>
                                {disp ? (
                                  <>
                                    <div style={{ fontSize: 32, fontFamily: 'var(--display)', fontWeight: 800, color: selectedRMData.stock <= 0 ? 'var(--red)' : selectedRMData.stock <= selectedRMData.min_stock ? 'var(--amber)' : 'var(--kk-green)', lineHeight: 1 }}>
                                      {disp.value} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--ink3)' }}>{disp.unit}</span>
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{disp.raw.toLocaleString()}g · {disp.detail}</div>
                                  </>
                                ) : (
                                  <div style={{ fontSize: 28, fontFamily: 'var(--display)', fontWeight: 800, color: selectedRMData.stock <= 0 ? 'var(--red)' : selectedRMData.stock <= selectedRMData.min_stock ? 'var(--amber)' : 'var(--kk-green)', lineHeight: 1 }}>
                                    {selectedRMData.stock?.toFixed(2)} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--ink3)' }}>{selectedRMData.unit}</span>
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          {DATE_RANGES.map(r => <button key={r.days} style={btnStyle(dateRange === r.days)} onClick={() => setDateRange(r.days)}>{r.label}</button>)}
                          <button onClick={() => setSelectedRM(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--ink3)' }}>×</button>
                        </div>
                      </div>
                      {historyLoading ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--ink3)' }}>Loading...</div> : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, overflow: 'hidden', flex: 1 }}>
                          <div>
                            <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--mono)' }}>📥 Sourced</div>
                            <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 320px)', paddingRight: 4 }}>
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
                          </div>
                          <div>
                            <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--mono)' }}>🏭 Used In</div>
                            <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 320px)', paddingRight: 4 }}>
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
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            )}
          </>
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
            {tab === 'fg' ? (() => {
              const ps = PACK_SIZE[editItem.code] || 1
              const freezer = parseFloat(editFreezerVal) || 0
              const packed = parseFloat(editPackedVal) || 0
              const total = freezer + (packed * ps)
              return (
                <div>
                  <div className="field-row" style={{ marginBottom: 12 }}>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Freezer Units</label>
                      <input type="number" value={editFreezerVal} onChange={e => { setEditFreezerVal(e.target.value); const f = parseFloat(e.target.value)||0; setEditVal(String(f + (parseFloat(editPackedVal)||0) * ps)) }} style={{ fontSize: 16, textAlign: 'center' }} autoFocus />
                    </div>
                    <div className="field" style={{ margin: 0 }}>
                      <label>Packed Packs</label>
                      <input type="number" value={editPackedVal} onChange={e => { setEditPackedVal(e.target.value); const pk = parseFloat(e.target.value)||0; setEditVal(String((parseFloat(editFreezerVal)||0) + pk * ps)) }} style={{ fontSize: 16, textAlign: 'center' }} />
                    </div>
                  </div>
                  <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 12 }}>
                    <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--mono)', marginBottom: 4 }}>Total Units (auto-calculated)</div>
                    <div style={{ fontSize: 28, fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--kk-green)' }}>{total}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{freezer} freezer + ({packed} packs × {ps} u/pk) = {total}</div>
                  </div>
                </div>
              )
            })() : (() => {
              const disp = displayStock(editItem.name, editItem.stock)
              return (
                <div>
                  {disp && (
                    <div style={{ background: 'var(--surface2)', borderRadius: 6, padding: '10px 14px', marginBottom: 12, fontSize: 12 }}>
                      <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase', fontFamily: 'var(--mono)', marginBottom: 4 }}>Enter in grams — displays as {disp.unit}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{disp.detail}</div>
                    </div>
                  )}
                  <div className="field"><label>New Stock (g)</label>
                    <input type="number" value={editVal} onChange={e => setEditVal(e.target.value)} step="0.001" style={{ fontSize: 20, textAlign: 'center' }} autoFocus />
                  </div>
                  {disp && editVal && !isNaN(parseFloat(editVal)) && (
                    <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12 }}>
                      = {(parseFloat(editVal) / disp.divisor).toFixed(2)} {disp.unit}
                    </div>
                  )}
                </div>
              )
            })()}
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

function PackagingPreview({ productCode, packs, rms }) {
  const [items, setItems] = useState([])
  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('packaging_bom').select('*').eq('product_code', productCode)
      setItems(data || [])
    }
    load()
  }, [productCode])
  if (!items.length) return null
  return (
    <div className="card" style={{ marginTop: 0 }}>
      <div className="card-title">📋 Packaging to be used</div>
      {items.map((item, i) => {
        const qty = item.qty_per_pack * packs
        const rm = rms.find(r => r.name.toLowerCase() === item.material_name.toLowerCase())
        const hasStock = rm ? rm.stock >= qty : null
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
            <div>
              <div style={{ fontWeight: 500 }}>{item.material_name}</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>{qty} {item.unit} · ${(item.cost_per_unit * qty).toFixed(2)}</div>
            </div>
            {rm !== undefined && (
              <span style={{ fontSize: 11, fontWeight: 600, color: hasStock ? 'var(--kk-green)' : 'var(--red)' }}>
                {hasStock ? `✓ ${rm.stock} in stock` : `✗ Only ${rm?.stock || 0} in stock`}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
