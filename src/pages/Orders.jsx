import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const STATUS_COLORS = {
  received: 'blue', order_sheet: 'green', archived: 'purple'
}
const STATUS_LABELS = {
  received: 'Received', order_sheet: 'Order Sheet', archived: 'Archived'
}
const DELIVERY_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const API_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.REACT_APP_ANTHROPIC_KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
}


// ── Case → Units helper ───────────────────────────────────────
function getUnitsPerCase(product) {
  return product?.units_per_case || 6
}
function casesToUnits(cases, product) {
  return parseFloat(cases) * getUnitsPerCase(product)
}

// ── Customer Combobox ─────────────────────────────────────────
function CustomerSelect({ customers, value, onChange, onAddNew }) {
  const [search, setSearch] = useState(value || '')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 20)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true); onChange('') }}
        onFocus={() => setOpen(true)}
        placeholder="Search or select customer..."
        style={{ width: '100%', padding: '10px 14px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--body)', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 200, maxHeight: 240, overflowY: 'auto' }}>
          {filtered.map(c => (
            <div key={c.id} onClick={() => { setSearch(c.name); onChange(c.id); setOpen(false) }}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f0f0f0' }}
              onMouseEnter={e => e.target.style.background = '#f5f5f5'}
              onMouseLeave={e => e.target.style.background = ''}>
              {c.name} <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>{c.type}</span>
            </div>
          ))}
          {search.length > 1 && !customers.find(c => c.name.toLowerCase() === search.toLowerCase()) && (
            <div onClick={() => { onAddNew(search); setOpen(false) }}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, color: 'var(--kk-green)', fontWeight: 600, borderTop: '1px solid #eee', background: '#f9f9f9' }}>
              + Add "{search}" as new customer
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Dispatch Slip Print — smart 4/3/2 per A4 ─────────────────
function printDispatchSlip(ordersInput) {
  // Determine how many slips fit per page based on total item count
  const totalItems = ordersInput.reduce((s, o) => s + (o.order_items?.length || 0), 0)
  const perPage = totalItems <= 16 ? 4 : totalItems <= 24 ? 3 : 2

  // Split orders into pages
  const pages = []
  for (let i = 0; i < ordersInput.length; i += perPage) {
    pages.push(ordersInput.slice(i, i + perPage))
  }

  const slipHeight = perPage === 4 ? '23%' : perPage === 3 ? '31%' : '47%'
  const fontSize = perPage === 4 ? '9px' : '10px'
  const tdPad = perPage === 4 ? '4px 8px' : '6px 10px'

  const renderOrder = (order) => `
    <div class="order-block">
      <div class="order-header">
        <div>
          <strong>${order.customer_name}</strong>
          <div style="font-size:9px;margin-top:1px">Order #${order.order_number} · ${order.order_source}${order.po_number ? ` · PO: ${order.po_number}` : ''} · ${order.slip_number || ''}</div>
        </div>
        <span>Dispatch: ${order.dispatch_date || order.delivery_day || '—'}</span>
      </div>
      <table><thead><tr>
        <th>Product</th>
        <th style="width:44px;text-align:center">Qty</th>
        <th style="width:100px;background:#fffde7">Prod. Date</th>
        <th style="width:80px">Notes</th>
      </tr></thead><tbody>
      ${(order.order_items || []).map(item => {
        const cases = item.cases || Math.round(item.quantity / (item.units_per_case || 6))
        return `
        <tr>
          <td>${item.product_name}${item.product_code ? ` <span style="color:#888;font-size:8px">(${item.product_code})</span>` : ''}</td>
          <td style="text-align:center;font-weight:700">${cases} cs / ${item.quantity} u</td>
          <td style="background:#fffde7">&nbsp;</td>
          <td>${item.notes || ''}</td>
        </tr>`}).join('')}
      </tbody></table>
    </div>`

  const renderPage = (pageOrders, pageNum, total) => `
    <div class="page">
      <div class="page-header">
        <div>
          <div class="logo">KK ERP</div>
          <div class="logo-sub">KONSCIOUS KITCHEN</div>
        </div>
        <div style="text-align:right">
          <div class="slip-title">DISPATCH SLIP</div>
          <div style="font-size:9px;color:#888">Page ${pageNum}/${total} · ${new Date().toLocaleDateString('en-CA')}</div>
        </div>
      </div>
      <div class="slips-grid">
        ${pageOrders.map(renderOrder).join('')}
      </div>
      <div class="footer">Konscious Kitchen · MAD CLEAN INGREDIENTS · konsciouskitchen.com</div>
    </div>`

  const html = `<!DOCTYPE html><html><head><title>KK Dispatch Slips</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: ${fontSize}; background: #fff; }
    .page { width: 210mm; min-height: 297mm; padding: 8mm; display: flex; flex-direction: column; page-break-after: always; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #223824; padding-bottom: 6px; margin-bottom: 8px; }
    .logo { font-size: 16px; font-weight: 900; letter-spacing: 3px; color: #223824; }
    .logo-sub { font-size: 6px; letter-spacing: 2px; color: #888; }
    .slip-title { font-size: 12px; font-weight: 700; color: #223824; }
    .slips-grid { display: grid; grid-template-columns: ${perPage === 1 ? '1fr' : '1fr 1fr'}; grid-template-rows: repeat(${perPage <= 2 ? perPage : Math.ceil(perPage/2)}, ${slipHeight}); gap: 6px; flex: 1; }
    .order-block { border: 1px solid #ccc; border-radius: 3px; overflow: hidden; display: flex; flex-direction: column; }
    .order-header { background: #223824; color: #fff; padding: 5px 8px; display: flex; justify-content: space-between; align-items: flex-start; flex-shrink: 0; }
    .order-header strong { font-size: ${perPage === 4 ? '10px' : '11px'}; }
    .order-header span { font-size: 9px; opacity: 0.85; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; flex: 1; }
    th { background: #f0f4f0; padding: ${tdPad}; text-align: left; font-size: 8px; letter-spacing: 0.5px; text-transform: uppercase; color: #555; border-bottom: 1px solid #ddd; }
    td { padding: ${tdPad}; border-bottom: 1px solid #eee; font-size: ${fontSize}; vertical-align: middle; }
    .footer { font-size: 8px; color: #bbb; text-align: center; padding-top: 6px; border-top: 1px solid #eee; margin-top: 6px; }
    @media print {
      body { margin: 0; }
      .page { page-break-after: always; }
    }
  </style></head><body>
    ${pages.map((pg, i) => renderPage(pg, i+1, pages.length)).join('')}
  </body></html>`

  const w = window.open('', '_blank')
  w.document.write(html)
  w.document.close()
  w.print()
}

// ── AI helper ─────────────────────────────────────────────────
async function readOrderWithAI(content, products, customerName = '', isImage = false, fileType = '') {
  const productList = products.map(p => `${p.code}: ${p.name}`).join('\n')
  const isNaturesEmporium = customerName.toLowerCase().includes('natures emporium') || customerName.toLowerCase().includes('nature emporium')

  const prompt = `You are an order reader for Konscious Kitchen, a premium bakery. Extract all products and quantities from this customer order, then match each item to our product list using smart semantic understanding.

OUR PRODUCT LIST:
${productList}

SEMANTIC MATCHING GUIDE (common customer names → our product code):
- blueberry muffin / paleo muffin = PBB
- chocolate muffin / choc muffin = PCC
- lemon raspberry muffin / lemon muffin = KLR
- hazelnut donut / hazelnut doughnut = KHD
- peanut butter donut / PB donut / vegan donut = VPBD
- cinnamon donut = KSCD
- brownie / mini brownie / brownie bar (NOT ganache) = PVBR
- brownie ganache / ganache pouch / brownie ganache 90g = PVBRG
${isNaturesEmporium ? `
SPECIAL RULE FOR THIS CUSTOMER (Natures Emporium):
- "brownie ganache 90g" or "brownie ganache pouch" = PVBRG (packaged, retail)
- "brownie ganache" without 90g or pouch = PVBRG-BULK (bulk order)
` : ''}
- pecan bar = VPCAN
- notella / nutella bar / no'tella = PNF
- pistachio bar = VPB
- hemp cookies / hemp vegan cookie = PVHC
- hazelnut protein cookie / hazelnut cookie = HPCo
- ginger cookie / ginger snap = PGCo
- shortbread / PO shortbread = POS
- keto almond butter cookie = KAB
- keto walnut cookie = KWAL
- snickerdoodle = KSCo
- collagen cookie / keto collagen = KCCo
- banana bread / banana loaf = PVBB
- ginger loaf = GBL
- pumpkin loaf = KPL
- focaccia = PFB
- vanilla strawberry slice = VSCS
- truffle cake slice = TRFCS
- hazelnut royale slice / hazel royale = HRCS
- truffle cake whole = WTC
- pistachio raspberry mini cake = PRMC
- carrot mini cake = CMC
- lemon mini cake = LMC
- truffle mini cake = TMC
- Use semantic understanding for anything not listed above
- If 60% confident it matches, mark matched: true

Return ONLY a JSON array:
[
  {"product_name": "exact name from order", "quantity": 12, "product_code": "MATCHED_CODE", "matched": true},
  {"product_name": "truly unrecognized item", "quantity": 6, "product_code": null, "matched": false}
]
Return ONLY the JSON array, no other text.`

  const isPDF = fileType === 'application/pdf'

  const messages = isImage
    ? [{ role: 'user', content: [
        isPDF
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content } }
          : { type: 'image', source: { type: 'base64', media_type: fileType, data: content } },
        { type: 'text', text: prompt }
      ]}]
    : [{ role: 'user', content: `This is a customer order:\n\n${content}\n\n${prompt}` }]

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: API_HEADERS,
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1000, messages })
  })
  const data = await response.json()
  if (!response.ok) throw new Error('API ' + response.status + ': ' + JSON.stringify(data))
  const text = data.content?.[0]?.text?.trim()
  if (!text) throw new Error('Empty response: ' + JSON.stringify(data))
  const clean = text.replace(/```json|```/g, '').trim()
  return JSON.parse(clean)
}

// ── Main Orders Component ─────────────────────────────────────
export default function Orders() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [orders, setOrders] = useState([])
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [viewOrder, setViewOrder] = useState(null)
  const [editingOrder, setEditingOrder] = useState(null)
  const [editItems, setEditItems] = useState([])
  const [editSaving, setEditSaving] = useState(false)
  const [filterStatus, setFilterStatus] = useState('active')
  const [aiLoading, setAiLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [inputMode, setInputMode] = useState('upload')
  const [pasteText, setPasteText] = useState('')
  const fileInputRef = useRef(null)

  const [form, setForm] = useState({
    customer_id: '', customer_name: '', order_source: 'Email',
    po_number: '', delivery_day: '', dispatch_date: '',
    notes: '', attachment: null, attachment_preview: null,
  })
  const [orderItems, setOrderItems] = useState([])
  const [unmatchedItems, setUnmatchedItems] = useState([])

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [o, c, p] = await Promise.all([
      supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(200),
      supabase.from('customers').select('*').order('name'),
      supabase.from('products').select('code,name,category,price_per_unit,units_per_case').not('code','like','WIP%').order('code'),
    ])
    setOrders(o.data || [])
    setCustomers(c.data || [])
    setProducts(p.data || [])
    setLoading(false)
  }

  async function handleAddNewCustomer(name) {
    const { data } = await supabase.from('customers').insert({ name, type: 'retail' }).select().single()
    if (data) {
      setCustomers(prev => [...prev, data].sort((a,b) => a.name.localeCompare(b.name)))
      setForm(f => ({ ...f, customer_id: data.id, customer_name: data.name }))
    }
  }

  async function handleCustomerChange(id) {
    const c = customers.find(c => c.id === id)
    if (!c) return
    setForm(f => ({ ...f, customer_id: id, customer_name: c.name, delivery_day: c.preferred_delivery_day || f.delivery_day }))
  }

  function processAIItems(items) {
    const matched = items.filter(i => i.matched)
    const unmatched = items.filter(i => !i.matched)
    const enriched = matched.map(i => {
      const p = products.find(p => p.code === i.product_code)
      const upc = getUnitsPerCase(p)
      const units = parseFloat(i.quantity) * upc
      return { product_code: i.product_code, product_name: p?.name || i.product_name, cases: i.quantity, quantity: units, units_per_case: upc, unit_price: p?.price_per_unit || 0, notes: '' }
    })
    setOrderItems(enriched)
    setUnmatchedItems(unmatched.map(i => ({ ...i, selected_code: '', quantity: i.quantity })))
  }

  async function handleAttachment(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setForm(f => ({ ...f, attachment: file, attachment_preview: URL.createObjectURL(file) }))
    setAiLoading(true)
    setOrderItems([])
    setUnmatchedItems([])
    try {
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result.split(',')[1])
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      const items = await readOrderWithAI(base64, products, form.customer_name, true, file.type)
      processAIItems(items)
    } catch(err) {
      console.error('AI read failed', err)
      alert('Error: ' + err.message)
    }
    setAiLoading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handlePasteRead() {
    if (!pasteText.trim()) { alert('Please paste order text first'); return }
    setAiLoading(true)
    setOrderItems([])
    setUnmatchedItems([])
    try {
      const items = await readOrderWithAI(pasteText, products, form.customer_name, false)
      processAIItems(items)
    } catch(err) {
      console.error('AI paste read failed', err)
      alert('Error: ' + err.message)
    }
    setAiLoading(false)
  }

  function handleUnmatchedSelect(idx, code) {
    const p = products.find(p => p.code === code)
    if (!p) return
    const item = { product_code: code, product_name: p.name, quantity: unmatchedItems[idx].quantity, unit_price: p.price_per_unit || 0, notes: '' }
    setOrderItems(prev => [...prev, item])
    setUnmatchedItems(prev => prev.filter((_, i) => i !== idx))
  }

  function updateItem(idx, field, val) { setOrderItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item)) }
  function removeItem(idx) { setOrderItems(prev => prev.filter((_, i) => i !== idx)) }
  function addManualItem() { setOrderItems(prev => [...prev, { product_code: '', product_name: '', cases: 1, quantity: 6, units_per_case: 6, unit_price: 0, notes: '' }]) }

  function updateEditItem(idx, field, val) { setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item)) }
  function removeEditItem(idx) { setEditItems(prev => prev.filter((_, i) => i !== idx)) }
  function addEditItem() { setEditItems(prev => [...prev, { product_code: '', product_name: '', cases: 1, quantity: 6, units_per_case: 6, unit_price: 0, notes: '', isNew: true }]) }

  function startEditOrder(order) {
    setEditingOrder({ ...order })
    setEditItems((order.order_items || []).map(i => ({ ...i })))
    setViewOrder(null)
  }

  async function saveEditOrder() {
    if (editItems.length === 0) { alert('Please add at least one product'); return }
    setEditSaving(true)
    try {
      const total = editItems.reduce((sum, i) => sum + (parseFloat(i.quantity) * parseFloat(i.unit_price || 0)), 0)
      await supabase.from('orders').update({
        delivery_day: editingOrder.delivery_day || null,
        dispatch_date: editingOrder.dispatch_date || null,
        po_number: editingOrder.po_number || null,
        order_source: editingOrder.order_source,
        notes: editingOrder.notes || null,
        status: editingOrder.status,
        total_value: total,
        updated_at: new Date().toISOString(),
      }).eq('id', editingOrder.id)
      await supabase.from('order_items').delete().eq('order_id', editingOrder.id)
      await supabase.from('order_items').insert(
        editItems.map(i => ({
          order_id: editingOrder.id, product_code: i.product_code || null,
          product_name: i.product_name,
          cases: parseFloat(i.cases || 1),
          quantity: parseFloat(i.quantity),
          units_per_case: parseInt(i.units_per_case || 6),
          unit_price: parseFloat(i.unit_price || 0), notes: i.notes || null,
        }))
      )
      setEditingOrder(null)
      setEditItems([])
      await loadData()
    } catch(err) {
      alert('Save failed: ' + err.message)
    }
    setEditSaving(false)
  }

  async function saveOrder() {
    if (!form.customer_name) { alert('Please select a customer'); return }
    if (orderItems.length === 0) { alert('Please add at least one product'); return }
    setSaving(true)
    try {
      let attachment_url = null
      if (form.attachment) {
        const ext = form.attachment.name.split('.').pop()
        const path = `orders/${Date.now()}-${form.customer_name.replace(/\s+/g,'-')}.${ext}`
        const { data: upData } = await supabase.storage.from('order-attachments').upload(path, form.attachment, { contentType: form.attachment.type })
        if (upData) {
          const { data: { publicUrl } } = supabase.storage.from('order-attachments').getPublicUrl(path)
          attachment_url = publicUrl
        }
      }
      const { data: numData } = await supabase.rpc('generate_order_number')
      const order_number = numData || `KK${Date.now()}`
      const total = orderItems.reduce((sum, i) => sum + (parseFloat(i.quantity) * parseFloat(i.unit_price || 0)), 0)

      // Generate slip number
      const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true })
      const slipNum = 'SLIP-' + String((count || 0) + 1).padStart(3, '0')

      const { data: order, error } = await supabase.from('orders').insert({
        order_number, customer_id: form.customer_id || null, customer_name: form.customer_name,
        order_source: form.order_source, po_number: form.po_number || null,
        delivery_day: form.delivery_day || null, dispatch_date: form.dispatch_date || null,
        notes: form.notes || null, order_attachment_url: attachment_url,
        total_value: total, status: 'received', created_by_name: profile?.name,
        slip_number: slipNum,
      }).select().single()
      if (error) throw error
      await supabase.from('order_items').insert(
        orderItems.map(i => ({
          order_id: order.id, product_code: i.product_code || null,
          product_name: i.product_name,
          cases: parseFloat(i.cases || 1),
          quantity: parseFloat(i.quantity),
          units_per_case: parseInt(i.units_per_case || 6),
          unit_price: parseFloat(i.unit_price || 0), notes: i.notes || null,
        }))
      )
      if (form.customer_id && form.delivery_day) {
        await supabase.from('customers').update({ preferred_delivery_day: form.delivery_day }).eq('id', form.customer_id)
      }
      await supabase.from('activity').insert({
        type: 'dispatch', title: `Order received: ${form.customer_name}`,
        description: `${order_number} · ${slipNum} · ${orderItems.length} items · $${total.toFixed(2)}`,
        created_by_name: profile?.name,
      })
      setShowModal(false)
      resetForm()
      await loadData()
    } catch(err) {
      alert('Save failed: ' + err.message)
    }
    setSaving(false)
  }

  function resetForm() {
    setForm({ customer_id:'', customer_name:'', order_source:'Email', po_number:'', delivery_day:'', dispatch_date:'', notes:'', attachment:null, attachment_preview:null })
    setOrderItems([])
    setUnmatchedItems([])
    setPasteText('')
    setInputMode('upload')
  }

  async function updateStatus(id, status) {
    await supabase.from('orders').update({ status }).eq('id', id)
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o))
    if (viewOrder?.id === id) setViewOrder(v => ({ ...v, status }))
  }

  // Active = received + order_sheet, Archived = archived
  const activeOrders = orders.filter(o => o.status === 'received' || o.status === 'order_sheet')
  const archivedOrders = orders.filter(o => o.status === 'archived')
  const filtered = filterStatus === 'archived' ? archivedOrders : activeOrders
  const filteredByStatus = filterStatus === 'received' ? activeOrders.filter(o => o.status === 'received')
    : filterStatus === 'order_sheet' ? activeOrders.filter(o => o.status === 'order_sheet')
    : filtered

  const sel = { padding: '10px 14px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--body)', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', width: '100%', outline: 'none' }

  return (
    <>
      <div className="page-header">
        <div><h2>ORDERS</h2><p>Incoming order management</p></div>
        {isAdmin && <button className="btn btn-green" onClick={() => setShowModal(true)}>+ New Order</button>}
      </div>

      <div className="page-body">
        {/* Stats — just 2 */}
        <div className="grid2" style={{ marginBottom: 16, maxWidth: 400 }}>
          <div className="stat blue">
            <div className="stat-label">Received</div>
            <div className="stat-value">{orders.filter(o => o.status === 'received').length}</div>
          </div>
          <div className="stat green">
            <div className="stat-label">Order Sheet</div>
            <div className="stat-value">{orders.filter(o => o.status === 'order_sheet').length}</div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="filter-bar">
          {[
            { key: 'active', label: 'All Active' },
            { key: 'received', label: 'Received' },
            { key: 'order_sheet', label: 'Order Sheet' },
            { key: 'archived', label: 'Archived' },
          ].map(f => (
            <button key={f.key} className={`filter-btn ${filterStatus===f.key?'active':''}`} onClick={() => setFilterStatus(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="card">
          <div className="card-title">{filteredByStatus.length} orders</div>
          {loading ? <div style={{ textAlign:'center', padding:32, color:'var(--ink3)' }}>Loading...</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Slip #</th><th>Order #</th><th>Customer</th><th>Source</th>
                  <th>Dispatch Date</th><th>Items</th>{isAdmin && <th>Value</th>}<th>Status</th><th></th>
                </tr></thead>
                <tbody>
                  {filteredByStatus.length === 0 && <tr><td colSpan={9} style={{ textAlign:'center', padding:32, color:'var(--ink3)' }}>No orders</td></tr>}
                  {filteredByStatus.map(o => (
                    <tr key={o.id}>
                      <td><span style={{ fontSize:11, color:'var(--ink3)', fontFamily:'var(--mono)' }}>{o.slip_number || '—'}</span></td>
                      <td><span className="code-tag">{o.order_number}</span></td>
                      <td style={{ fontWeight:500 }}>{o.customer_name}</td>
                      <td style={{ fontSize:11 }}>{o.order_source}</td>
                      <td style={{ fontSize:11 }}>{o.dispatch_date || o.delivery_day || '—'}</td>
                      <td style={{ fontSize:11 }}>{o.order_items?.length || 0}</td>
                      {isAdmin && <td style={{ fontWeight:600, color:'var(--kk-green)', fontSize:12 }}>${(o.total_value||0).toFixed(2)}</td>}
                      <td><span className={`badge badge-${STATUS_COLORS[o.status]}`}>{STATUS_LABELS[o.status]}</span></td>
                      <td style={{ display:'flex', gap:4 }}>
                        <button onClick={() => setViewOrder(o)} className="btn btn-secondary btn-sm">View</button>
                        {isAdmin && <button onClick={() => startEditOrder(o)} className="btn btn-secondary btn-sm">Edit</button>}
                        {isAdmin && <button onClick={async () => { if(window.confirm('Delete order ' + o.order_number + '?')) { await supabase.from('orders').delete().eq('id', o.id); await loadData(); }}} className="btn btn-red btn-sm">Del</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── NEW ORDER MODAL ── */}
      {showModal && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <button className="modal-close" onClick={() => { setShowModal(false); resetForm() }}>×</button>
            <div className="modal-title">NEW ORDER</div>

            <div className="field">
              <label>Customer</label>
              <CustomerSelect customers={customers} value={form.customer_name}
                onChange={handleCustomerChange} onAddNew={handleAddNewCustomer} />
            </div>

            <div className="field-row">
              <div className="field" style={{ margin:0 }}>
                <label>Order Source</label>
                <select style={sel} value={form.order_source} onChange={e => setForm(f=>({...f,order_source:e.target.value}))}>
                  <option>Email</option><option>PO</option><option>Direct</option><option>KK Website</option>
                </select>
              </div>
              <div className="field" style={{ margin:0 }}>
                <label>PO Number (optional)</label>
                <input style={sel} value={form.po_number} onChange={e => setForm(f=>({...f,po_number:e.target.value}))} placeholder="e.g. PO-12345" />
              </div>
            </div>

            <div className="field-row">
              <div className="field" style={{ margin:0 }}>
                <label>Delivery Day</label>
                <select style={sel} value={form.delivery_day} onChange={e => setForm(f=>({...f,delivery_day:e.target.value}))}>
                  <option value="">Select day...</option>
                  {DELIVERY_DAYS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin:0 }}>
                <label>Dispatch Date</label>
                <input type="date" style={sel} value={form.dispatch_date} onChange={e => setForm(f=>({...f,dispatch_date:e.target.value}))} />
              </div>
            </div>

            <div className="field">
              <label>Order Input</label>
              <div style={{ display:'flex', gap:0, marginBottom:10, border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>
                {['upload','paste'].map(mode => (
                  <button key={mode} onClick={() => setInputMode(mode)} style={{
                    flex:1, padding:'8px 12px', border:'none', cursor:'pointer', fontSize:12,
                    fontFamily:'var(--display)', letterSpacing:1, textTransform:'uppercase',
                    background: inputMode===mode ? 'var(--kk-green)' : 'var(--surface)',
                    color: inputMode===mode ? 'var(--kk-cream)' : 'var(--ink3)',
                  }}>
                    {mode === 'upload' ? '📎 Upload' : '📋 Paste Text'}
                  </button>
                ))}
              </div>

              {inputMode === 'upload' && (
                <>
                  <input ref={fileInputRef} type="file" accept="image/*,application/pdf"
                    onChange={handleAttachment} style={{ display:'none' }} />
                  <button className="btn btn-secondary btn-full" onClick={() => fileInputRef.current.click()}>
                    {form.attachment ? '📎 Change Attachment' : '📎 Upload Photo or PDF'}
                  </button>
                  {form.attachment_preview && form.attachment?.type?.includes('image') && (
                    <img src={form.attachment_preview} alt="Order" style={{ width:'100%', maxHeight:150, objectFit:'contain', borderRadius:6, marginTop:8, background:'#f5f5f5' }} />
                  )}
                  {form.attachment && !form.attachment?.type?.includes('image') && (
                    <div style={{ marginTop:8, fontSize:12, color:'var(--kk-green)' }}>✅ {form.attachment.name}</div>
                  )}
                </>
              )}

              {inputMode === 'paste' && (
                <>
                  <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
                    placeholder="Paste the order email or text here..."
                    style={{ width:'100%', minHeight:120, padding:'10px 14px', border:'1.5px solid var(--border)', borderRadius:'var(--radius)', fontFamily:'var(--body)', fontSize:12, background:'var(--surface)', color:'var(--ink)', outline:'none', resize:'vertical', boxSizing:'border-box' }}
                  />
                  <button className="btn btn-green btn-full" style={{ marginTop:8 }}
                    onClick={handlePasteRead} disabled={aiLoading || !pasteText.trim()}>
                    {aiLoading ? '⏳ Reading...' : '🤖 Read Order with AI'}
                  </button>
                </>
              )}
            </div>

            {aiLoading && inputMode === 'upload' && (
              <div style={{ background:'var(--blue-l)', border:'1px solid var(--blue)', borderRadius:6, padding:'10px 14px', fontSize:12, color:'var(--blue)', marginBottom:12 }}>
                ⏳ Reading order with AI...
              </div>
            )}

            {unmatchedItems.length > 0 && (
              <div style={{ background:'var(--amber-l)', border:'1px solid var(--amber)', borderRadius:6, padding:12, marginBottom:12 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#9E5A3E', marginBottom:8 }}>⚠️ {unmatchedItems.length} item(s) not matched — please select manually:</div>
                {unmatchedItems.map((item, idx) => (
                  <div key={idx} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6 }}>
                    <span style={{ fontSize:12, flex:1 }}>{item.product_name} × {item.quantity}</span>
                    <select style={{ ...sel, width:'auto', flex:2, padding:'6px 10px' }}
                      onChange={e => handleUnmatchedSelect(idx, e.target.value)} defaultValue="">
                      <option value="">Select product...</option>
                      {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
                    </select>
                    <button onClick={() => setUnmatchedItems(prev => prev.filter((_,i)=>i!==idx))}
                      style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:16 }}>×</button>
                  </div>
                ))}
              </div>
            )}

            {orderItems.length > 0 && (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, letterSpacing:2, textTransform:'uppercase', color:'var(--ink3)', marginBottom:8, fontFamily:'var(--display)' }}>
                  Order Items ({orderItems.length})
                </div>
                {orderItems.map((item, idx) => (
                  <div key={idx} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6, background:'var(--surface2)', padding:'8px 10px', borderRadius:6, flexWrap:'wrap' }}>
                    <div style={{ flex:3, minWidth:180 }}>
                      <select style={{ ...sel, padding:'6px 10px', fontSize:12 }}
                        value={item.product_code || ''}
                        onChange={e => {
                          const p = products.find(p => p.code === e.target.value)
                          updateItem(idx, 'product_code', p?.code || '')
                          updateItem(idx, 'product_name', p?.name || item.product_name)
                          updateItem(idx, 'unit_price', p?.price_per_unit || 0)
                        }}>
                        <option value="">{item.product_name || 'Select product...'}</option>
                        {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
                      </select>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <span style={{ fontSize:11, color:'var(--ink3)' }}>Cases:</span>
                      <input type="number" value={item.cases || item.quantity} onChange={e => {
                        const p = products.find(p => p.code === item.product_code)
                        const upc = getUnitsPerCase(p)
                        const units = parseFloat(e.target.value) * upc
                        updateItem(idx, 'cases', e.target.value)
                        updateItem(idx, 'quantity', units)
                        updateItem(idx, 'units_per_case', upc)
                      }}
                        style={{ ...sel, width:64, padding:'6px 8px', fontSize:13, fontWeight:600 }} />
                      <span style={{ fontSize:11, color:'var(--ink3)' }}>= {item.quantity} units</span>
                    </div>
                    <input type="text" value={item.notes || ''} placeholder="Notes"
                      onChange={e => updateItem(idx,'notes',e.target.value)}
                      style={{ ...sel, flex:1, minWidth:80, padding:'6px 8px', fontSize:11 }} />
                    <button onClick={() => removeItem(idx)}
                      style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:18, lineHeight:1 }}>×</button>
                  </div>
                ))}
              </div>
            )}

            <button className="btn btn-secondary btn-sm" onClick={addManualItem} style={{ marginBottom:12 }}>+ Add Item Manually</button>

            <div className="field">
              <label>Notes</label>
              <textarea style={{ ...sel, minHeight:60 }} value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} placeholder="Special instructions..." />
            </div>

            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-green btn-full" onClick={saveOrder} disabled={saving}>
                {saving ? 'Saving...' : 'Save Order'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setShowModal(false); resetForm() }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW ORDER MODAL ── */}
      {viewOrder && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setViewOrder(null)}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <button className="modal-close" onClick={() => setViewOrder(null)}>×</button>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexWrap:'wrap', gap:8 }}>
              <div>
                <div className="modal-title" style={{ marginBottom:4 }}>{viewOrder.customer_name}</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <span className="code-tag">{viewOrder.order_number}</span>
                  {viewOrder.slip_number && <span style={{ fontSize:11, color:'var(--ink3)', fontFamily:'var(--mono)' }}>{viewOrder.slip_number}</span>}
                  <span className={`badge badge-${STATUS_COLORS[viewOrder.status]}`}>{STATUS_LABELS[viewOrder.status]}</span>
                  <span style={{ fontSize:11, color:'var(--ink3)' }}>{viewOrder.order_source}{viewOrder.po_number ? ` · PO: ${viewOrder.po_number}` : ''}</span>
                </div>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => printDispatchSlip([viewOrder])}>🖨️ Print Slip</button>
                {isAdmin && <button className="btn btn-amber btn-sm" onClick={() => startEditOrder(viewOrder)}>✏️ Edit</button>}
                {isAdmin && <button className="btn btn-red btn-sm" onClick={async () => { if(window.confirm('Delete order ' + viewOrder.order_number + '?')) { await supabase.from('orders').delete().eq('id', viewOrder.id); setViewOrder(null); await loadData(); }}}>🗑️ Delete</button>}
              </div>
            </div>

            {/* Status toggle — just Received / Order Sheet / Archived */}
            {isAdmin && (
              <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' }}>
                {Object.entries(STATUS_LABELS).map(([k,v]) => (
                  <button key={k} onClick={() => updateStatus(viewOrder.id, k)} style={{
                    padding:'6px 14px', borderRadius:20, border:'1px solid var(--border)', cursor:'pointer',
                    fontSize:11, fontFamily:'var(--display)', letterSpacing:1, textTransform:'uppercase',
                    background: viewOrder.status===k ? 'var(--kk-green)' : 'var(--surface)',
                    color: viewOrder.status===k ? 'var(--kk-cream)' : 'var(--ink3)',
                  }}>{v}</button>
                ))}
              </div>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16, fontSize:12 }}>
              <div><span style={{ color:'var(--ink3)' }}>Delivery Day:</span> <strong>{viewOrder.delivery_day || '—'}</strong></div>
              <div><span style={{ color:'var(--ink3)' }}>Dispatch Date:</span> <strong>{viewOrder.dispatch_date || '—'}</strong></div>
              {isAdmin && <div><span style={{ color:'var(--ink3)' }}>Total Value:</span> <strong style={{ color:'var(--kk-green)' }}>${(viewOrder.total_value||0).toFixed(2)}</strong></div>}
              <div><span style={{ color:'var(--ink3)' }}>Created by:</span> <strong>{viewOrder.created_by_name}</strong></div>
            </div>

            {viewOrder.order_attachment_url && (
              <div style={{ marginBottom:16 }}>
                <a href={viewOrder.order_attachment_url} target="_blank" rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm">📎 View Original Order</a>
              </div>
            )}

            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Code</th><th>Cases</th><th>Units</th>{isAdmin && <th>Unit $</th>}{isAdmin && <th>Line Total</th>}<th>Notes</th></tr></thead>
                <tbody>
                  {(viewOrder.order_items || []).map(item => (
                    <tr key={item.id}>
                      <td style={{ fontWeight:500, fontSize:12 }}>{item.product_name}</td>
                      <td>{item.product_code ? <span className="code-tag">{item.product_code}</span> : '—'}</td>
                      <td style={{ fontWeight:600 }}>{item.cases || Math.round(item.quantity / (item.units_per_case || 6))}</td>
                      <td style={{ fontWeight:600, color:'var(--kk-green)' }}>{item.quantity}</td>
                      {isAdmin && <td style={{ fontSize:11, color:'var(--ink3)' }}>${(item.unit_price||0).toFixed(2)}</td>}
                      {isAdmin && <td style={{ fontSize:11, fontWeight:600, color:'var(--kk-green)' }}>${((item.quantity||0) * (item.unit_price||0)).toFixed(2)}</td>}
                      <td style={{ fontSize:11, color:'var(--ink3)' }}>{item.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {viewOrder.notes && (
              <div style={{ marginTop:12, padding:'10px 14px', background:'var(--surface2)', borderRadius:6, fontSize:12, color:'var(--ink2)' }}>
                📝 {viewOrder.notes}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── EDIT ORDER MODAL ── */}
      {editingOrder && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setEditingOrder(null)}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <button className="modal-close" onClick={() => setEditingOrder(null)}>×</button>
            <div className="modal-title">EDIT ORDER — {editingOrder.order_number}</div>
            <div style={{ fontSize:13, color:'var(--ink3)', marginBottom:16 }}>{editingOrder.customer_name} · {editingOrder.slip_number}</div>

            <div className="field-row">
              <div className="field" style={{ margin:0 }}>
                <label>Order Source</label>
                <select style={sel} value={editingOrder.order_source} onChange={e => setEditingOrder(o=>({...o,order_source:e.target.value}))}>
                  <option>Email</option><option>PO</option><option>Direct</option><option>KK Website</option>
                </select>
              </div>
              <div className="field" style={{ margin:0 }}>
                <label>PO Number</label>
                <input style={sel} value={editingOrder.po_number || ''} onChange={e => setEditingOrder(o=>({...o,po_number:e.target.value}))} placeholder="e.g. PO-12345" />
              </div>
            </div>

            <div className="field-row">
              <div className="field" style={{ margin:0 }}>
                <label>Delivery Day</label>
                <select style={sel} value={editingOrder.delivery_day || ''} onChange={e => setEditingOrder(o=>({...o,delivery_day:e.target.value}))}>
                  <option value="">Select day...</option>
                  {DELIVERY_DAYS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin:0 }}>
                <label>Dispatch Date</label>
                <input type="date" style={sel} value={editingOrder.dispatch_date || ''} onChange={e => setEditingOrder(o=>({...o,dispatch_date:e.target.value}))} />
              </div>
            </div>

            <div className="field">
              <label>Status</label>
              <select style={sel} value={editingOrder.status} onChange={e => setEditingOrder(o=>({...o,status:e.target.value}))}>
                {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <div style={{ fontSize:11, letterSpacing:2, textTransform:'uppercase', color:'var(--ink3)', marginBottom:8, fontFamily:'var(--display)' }}>
              Order Items ({editItems.length})
            </div>
            {editItems.map((item, idx) => (
              <div key={idx} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6, background:'var(--surface2)', padding:'8px 10px', borderRadius:6, flexWrap:'wrap' }}>
                <div style={{ flex:3, minWidth:180 }}>
                  <select style={{ ...sel, padding:'6px 10px', fontSize:12 }}
                    value={item.product_code || ''}
                    onChange={e => {
                      const p = products.find(p => p.code === e.target.value)
                      updateEditItem(idx, 'product_code', p?.code || '')
                      updateEditItem(idx, 'product_name', p?.name || item.product_name)
                      updateEditItem(idx, 'unit_price', p?.price_per_unit || 0)
                    }}>
                    <option value="">{item.product_name || 'Select product...'}</option>
                    {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
                  </select>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <span style={{ fontSize:11, color:'var(--ink3)' }}>Cases:</span>
                  <input type="number" value={item.cases || Math.round(item.quantity / (item.units_per_case || 6))} onChange={e => {
                    const p = products.find(p => p.code === item.product_code)
                    const upc = getUnitsPerCase(p)
                    const units = parseFloat(e.target.value) * upc
                    updateEditItem(idx, 'cases', e.target.value)
                    updateEditItem(idx, 'quantity', units)
                    updateEditItem(idx, 'units_per_case', upc)
                  }}
                    style={{ ...sel, width:64, padding:'6px 8px', fontSize:13, fontWeight:600 }} />
                  <span style={{ fontSize:11, color:'var(--ink3)' }}>= {item.quantity} units</span>
                </div>
                <input type="text" value={item.notes || ''} placeholder="Notes"
                  onChange={e => updateEditItem(idx,'notes',e.target.value)}
                  style={{ ...sel, flex:1, minWidth:80, padding:'6px 8px', fontSize:11 }} />
                <button onClick={() => removeEditItem(idx)}
                  style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:18, lineHeight:1 }}>×</button>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" onClick={addEditItem} style={{ marginBottom:12 }}>+ Add Item</button>

            <div className="field">
              <label>Notes</label>
              <textarea style={{ ...sel, minHeight:60 }} value={editingOrder.notes || ''} onChange={e => setEditingOrder(o=>({...o,notes:e.target.value}))} placeholder="Special instructions..." />
            </div>

            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-green btn-full" onClick={saveEditOrder} disabled={editSaving}>
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn btn-secondary" onClick={() => setEditingOrder(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
