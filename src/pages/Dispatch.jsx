import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const PACK_SIZE = { VPB:3,VPCAN:3,PNF:3,PVBRG:1,PVBR:4,PBB:2,PCC:2,KLR:2,KSCD:4,VPBD:2,KHD:2,HPC:5,KABIS:5,KAB:5,KWAL:5,PVHC:5,POS:5,PGCo:5,KCOC:1,KSCO:5,PVBB:1,GBL:1,KPL:1,CCL:1,BAGL:2,Focaccia:1,TRFCS:1,HRCS:1,VSCS:1,NALCOB:1,NBFB:1 }

const AI_PROMPT = `You are reading Konscious Kitchen packing slips. Each slip is a printed form with labeled rows.

The form has these labeled fields at the top:
- "Date of Packing" — the dispatch date (e.g. May 11)
- "Customer" — the store/customer name (e.g. BC Danforth)
- "Invoice Number" — a 4-digit number (e.g. 4664). Look carefully at the handwritten value in the "Invoice Number" row — this is critical.

Below those fields is a table with columns: Product Name | Date | Qty
Each row has a product code, a date (ignore this), and a quantity number.

Product codes to recognize: VPB, VPCAN, PNF, PVBRG, PVBR, PBB, PCC, KLR, KSCD, VPBD, KHD, HPC, KABIS, KAB, KWAL, PVHC, POS, PGCo, KCOC, KSCO, PVBB, GBL, KPL, CCL, BAGL, Focaccia, TRFCS, HRCS, VSCS, NALCOB, NBFB, KSCO.
Also recognize: HPCo or HPCO = HPC, PCRT = skip (unknown code), PVBBS = PVBB slice type.

Rules:
- (BULK) after code = type "bulk"; default = "pack"
- PVBBS or "PVBB Slice" = type "slice"
- Crossed out items = skip
- If the slip continues on the same page (arrow pointing down to another section) = same slip, continue extracting
- Multiple separate slips per image = extract each as separate slip object

Return ONLY valid JSON, no markdown, no explanation:
{"slips":[{"date":"May 11","customer":"BC Danforth","invoice":"4664","items":[{"code":"PBB","qty":6,"type":"pack","note":""}],"flags":[]}]}`

export default function Dispatch() {
  const { profile } = useAuth()
  const [view, setView] = useState('ai')
  const [files, setFiles] = useState([])
  const [processing, setProcessing] = useState(false)
  const [extracted, setExtracted] = useState([])
  const [log, setLog] = useState([])
  const [products, setProducts] = useState([])
  const [dispatches, setDispatches] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [manForm, setManForm] = useState({ date: new Date().toISOString().split('T')[0], customer: '', invoice: '' })
  const [manLines, setManLines] = useState([])
  const [manCode, setManCode] = useState(''); const [manQty, setManQty] = useState(''); const [manType, setManType] = useState('pack')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [p, d] = await Promise.all([
      supabase.from('products').select('code,name').order('code'),
      supabase.from('dispatches').select('*,dispatch_items(*)').order('created_at', { ascending: false }).limit(50),
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
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(f) })
  }

  async function processSlips() {
    if (!files.length) return
    setProcessing(true); setLog([]); setExtracted([])
    addLog(`Processing ${files.length} file(s)...`)
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
        content.push({ type: 'text', text: 'Extract all packing slip data including the Invoice Number from the labeled Invoice Number row. Return JSON only, no markdown.' })
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
          setExtracted(e => [...e, slip])
          addLog(`✓ ${slip.customer} — Inv #${slip.invoice || '?'} — ${slip.items?.length || 0} lines`, 'ok')
          ;(slip.flags || []).forEach(f => addLog(`⚠ ${f}`, 'warn'))
        })
      } catch (err) { addLog(`Error: ${err.message}`, 'err') }
    }
    addLog('Done!', 'ok')
    setProcessing(false)
  }

  async function saveExtracted() {
    let count = 0
    for (const slip of extracted) {
      const { data: dispatch } = await supabase.from('dispatches').insert({
        date: slip.date || new Date().toISOString().split('T')[0],
        customer_name: slip.customer,
        invoice_number: slip.invoice || '',
        created_by_name: profile?.name
      }).select().single()
      if (!dispatch) continue
      for (const item of slip.items || []) {
        const units = calcUnits(item.code, item.qty, item.type)
        await supabase.from('dispatch_items').insert({
          dispatch_id: dispatch.id,
          product_code: item.code,
          product_name: products.find(p=>p.code===item.code)?.name || item.code,
          qty: item.qty,
          dispatch_type: item.type,
          units_dispatched: units
        })
        const { data: prod } = await supabase.from('products').select('units').eq('code', item.code).single()
        if (prod) await supabase.from('products').update({ units: prod.units - units }).eq('code', item.code)
        count++
      }
      await supabase.from('activity').insert({
        type: 'dispatch',
        title: `Dispatch: ${slip.customer}`,
        description: `${slip.items?.length} lines · Inv #${slip.invoice || '—'}`,
        created_by_name: profile?.name
      })
    }
    addLog(`✓ Saved ${extracted.length} slip(s), ${count} lines. Stock updated.`, 'ok')
    setExtracted([]); setFiles([]); loadData()
  }

  async function saveManual() {
    if (!manForm.customer || !manLines.length) { alert('Add customer and at least one line.'); return }
    const { data: dispatch } = await supabase.from('dispatches').insert({
      date: manForm.date, customer_name: manForm.customer, invoice_number: manForm.invoice, created_by_name: profile?.name
    }).select().single()
    for (const line of manLines) {
      const units = calcUnits(line.code, line.qty, line.type)
      await supabase.from('dispatch_items').insert({
        dispatch_id: dispatch.id,
        product_code: line.code,
        product_name: products.find(p=>p.code===line.code)?.name || line.code,
        qty: line.qty, dispatch_type: line.type, units_dispatched: units
      })
      const { data: prod } = await supabase.from('products').select('units').eq('code', line.code).single()
      if (prod) await supabase.from('products').update({ units: prod.units - units }).eq('code', line.code)
    }
    await supabase.from('activity').insert({
      type: 'dispatch',
      title: `Dispatch: ${manForm.customer}`,
      description: `${manLines.length} lines · Inv #${manForm.invoice || '—'}`,
      created_by_name: profile?.name
    })
    setManLines([]); setManForm({ date: new Date().toISOString().split('T')[0], customer: '', invoice: '' }); loadData()
  }

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
                  <div style={{fontSize:12,color:'var(--ink2)',lineHeight:1.8}}><strong>Tap to upload packing slips</strong><br/>📷 Camera · 🖼 Gallery · 📄 PDF · Multiple OK</div>
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
                {log.length === 0 ? <span style={{color:'var(--ink3)'}}>Ready — upload images to begin</span> : log.map((l,i) => <div key={i} className={l.type}>{l.time} — {l.msg}</div>)}
              </div>
            </div>
            <div>
              {extracted.length > 0 && (
                <div className="card">
                  <div className="card-title">✅ Review Extracted Data</div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Customer</th><th>Inv #</th><th>Code</th><th>Qty</th><th>Type</th><th>Units</th></tr></thead>
                      <tbody>
                        {extracted.map((slip, si) => (slip.items || []).map((item, ii) => (
                          <tr key={`${si}-${ii}`}>
                            <td style={{fontSize:11}}>{ii === 0 ? slip.customer : ''}</td>
                            <td style={{fontSize:11,color:'var(--ink3)'}}>{ii === 0 ? (slip.invoice || '—') : ''}</td>
                            <td><span className="code-tag">{item.code}</span></td>
                            <td>{item.qty}</td>
                            <td><span className={`badge badge-${item.type==='pack'?'amber':'blue'}`}>{item.type}</span></td>
                            <td style={{color:'var(--green)',fontWeight:500}}>{calcUnits(item.code,item.qty,item.type)}</td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{display:'flex',gap:10,marginTop:12}}>
                    <button className="btn btn-primary btn-full" onClick={saveExtracted}>Save All to Inventory</button>
                    <button className="btn btn-secondary" onClick={() => setExtracted([])}>Discard</button>
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
                    <th></th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Invoice</th>
                    <th>Lines</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatches.map(d => (
                    <>
                      <tr
                        key={d.id}
                        onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                        style={{ cursor: 'pointer', background: expandedId === d.id ? 'var(--surface2)' : '' }}
                      >
                        <td style={{fontSize:11,color:'var(--ink3)',width:20}}>
                          {expandedId === d.id ? '▼' : '▶'}
                        </td>
                        <td style={{fontSize:12}}>{d.date}</td>
                        <td style={{fontWeight:500}}>{d.customer_name}</td>
                        <td style={{fontSize:11,color:'var(--ink3)'}}>{d.invoice_number || '—'}</td>
                        <td>{d.dispatch_items?.length || 0}</td>
                        <td style={{fontSize:11,color:'var(--ink3)'}}>{d.created_by_name}</td>
                      </tr>
                      {expandedId === d.id && (
                        <tr key={`${d.id}-expanded`}>
                          <td colSpan={6} style={{padding:'0 0 12px 32px',background:'var(--surface2)'}}>
                            <table style={{width:'100%',fontSize:12}}>
                              <thead>
                                <tr>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Code</th>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Product</th>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Qty</th>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Type</th>
                                  <th style={{textAlign:'left',padding:'6px 8px',color:'var(--ink3)',fontWeight:500}}>Units</th>
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
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
