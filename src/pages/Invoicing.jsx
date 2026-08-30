import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const HST_RATE = 0.13
const EXPORT_CUSTOMERS = ['ontario natural food'] // 0% tax

function isExport(customerName) {
  return EXPORT_CUSTOMERS.some(e => (customerName || '').toLowerCase().includes(e))
}

function getTaxRate(customerName) {
  return isExport(customerName) ? 0 : HST_RATE
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { year:'numeric', month:'short', day:'numeric' })
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const STATUS_COLORS = {
  draft:    { bg:'var(--surface2)', color:'var(--ink3)' },
  sent:     { bg:'var(--blue-l)',   color:'var(--blue)' },
  paid:     { bg:'var(--green-l)',  color:'var(--green)' },
  partial:  { bg:'var(--amber-l)', color:'var(--amber)' },
  overdue:  { bg:'var(--red-l)',   color:'var(--red)' },
  void:     { bg:'var(--surface2)', color:'var(--ink3)' },
}

export default function Invoicing() {
  const { profile, isAdmin } = useAuth()
  const [tab, setTab] = useState('invoices')
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [viewInvoice, setViewInvoice] = useState(null)
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])

  // Create form
  const [createForm, setCreateForm] = useState({
    order_id: '', customer_name: '', customer_email: '',
    issue_date: new Date().toISOString().split('T')[0],
    payment_terms: 'Net 30', notes: ''
  })
  const [createItems, setCreateItems] = useState([])
  const [creating, setCreating] = useState(false)

  // Payment form
  const [paymentForm, setPaymentForm] = useState({
    amount: '', payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'e-transfer', reference: '', notes: ''
  })
  const [payments, setPayments] = useState([])
  const [savingPayment, setSavingPayment] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [invRes, ordRes, prodRes] = await Promise.all([
      supabase.from('invoices').select('*, invoice_items(*), invoice_payments(*)').order('created_at', { ascending: false }),
      supabase.from('orders').select('id,order_number,customer_name,total_value,dispatch_date,order_items(*)').eq('status','order_sheet').order('created_at', { ascending: false }).limit(100),
      supabase.from('products').select('code,name,price_per_pack').order('code'),
    ])
    // Auto-mark overdue
    const today = new Date().toISOString().split('T')[0]
    const inv = (invRes.data || []).map(i => {
      if (i.status === 'sent' && i.due_date < today) return { ...i, status: 'overdue' }
      return i
    })
    setInvoices(inv)
    setOrders(ordRes.data || [])
    setProducts(prodRes.data || [])
    setLoading(false)
  }

  function getAmountPaid(inv) {
    return (inv.invoice_payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0)
  }

  function getBalance(inv) {
    return parseFloat(inv.total_amount || 0) - getAmountPaid(inv)
  }

  function openCreate(order = null) {
    if (order) {
      const taxRate = getTaxRate(order.customer_name)
      const items = (order.order_items || []).map(item => {
        const packs = item.packs || (item.cases ? item.cases * (item.packs_per_case || 6) : (item.quantity || 0))
        const lineTotal = packs * (item.price_per_pack || 0)
        return {
          product_code: item.product_code,
          description: item.product_name || item.product_code,
          quantity: packs,
          unit_price: item.price_per_pack || 0,
          line_total: lineTotal,
        }
      })
      const subtotal = items.reduce((s, i) => s + i.line_total, 0)
      setCreateForm({
        order_id: order.id,
        customer_name: order.customer_name,
        customer_email: '',
        issue_date: new Date().toISOString().split('T')[0],
        payment_terms: 'Net 30',
        notes: '',
        _taxRate: taxRate,
        _subtotal: subtotal,
      })
      setCreateItems(items)
    } else {
      setCreateForm({
        order_id: '', customer_name: '', customer_email: '',
        issue_date: new Date().toISOString().split('T')[0],
        payment_terms: 'Net 30', notes: '', _taxRate: HST_RATE, _subtotal: 0,
      })
      setCreateItems([{ product_code: '', description: '', quantity: 1, unit_price: 0, line_total: 0 }])
    }
    setShowCreateModal(true)
  }

  function recalcItems(items, customerName) {
    return items.map(i => ({ ...i, line_total: parseFloat(i.quantity || 0) * parseFloat(i.unit_price || 0) }))
  }

  function updateCreateItem(idx, field, value) {
    setCreateItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      if (field === 'quantity' || field === 'unit_price') {
        next[idx].line_total = parseFloat(next[idx].quantity || 0) * parseFloat(next[idx].unit_price || 0)
      }
      return next
    })
  }

  async function saveInvoice() {
    const { order_id, customer_name, customer_email, issue_date, payment_terms, notes } = createForm
    if (!customer_name) { alert('Please enter a customer name.'); return }
    setCreating(true)
    try {
      const taxRate = getTaxRate(customer_name)
      const subtotal = createItems.reduce((s, i) => s + (parseFloat(i.line_total) || 0), 0)
      const taxAmount = Math.round(subtotal * taxRate * 100) / 100
      const totalAmount = Math.round((subtotal + taxAmount) * 100) / 100
      const daysMap = { 'Net 30': 30, 'Net 15': 15, 'Due on Receipt': 0 }
      const dueDate = addDays(issue_date, daysMap[payment_terms] || 30)

      // Get next invoice number
      const { data: numData } = await supabase.rpc('next_invoice_number')
      const invoiceNumber = numData || ('INV-' + Date.now())

      const { data: inv, error } = await supabase.from('invoices').insert({
        invoice_number: invoiceNumber,
        order_id: order_id || null,
        customer_name, customer_email, issue_date,
        due_date: dueDate, payment_terms,
        subtotal, tax_amount: taxAmount, total_amount: totalAmount,
        status: 'draft', notes,
        created_by_name: profile?.name
      }).select().single()

      if (error) throw error

      // Insert line items
      const itemsToInsert = createItems.filter(i => i.description).map(i => ({
        invoice_id: inv.id,
        product_code: i.product_code || null,
        description: i.description,
        quantity: parseFloat(i.quantity) || 0,
        unit_price: parseFloat(i.unit_price) || 0,
        line_total: parseFloat(i.line_total) || 0,
      }))
      if (itemsToInsert.length > 0) {
        await supabase.from('invoice_items').insert(itemsToInsert)
      }

      setShowCreateModal(false)
      await loadData()
    } catch(e) { alert('Error creating invoice: ' + e.message) }
    setCreating(false)
  }

  async function openView(inv) {
    const { data } = await supabase.from('invoices')
      .select('*, invoice_items(*), invoice_payments(*)')
      .eq('id', inv.id).single()
    setViewInvoice(data)
    setPayments(data.invoice_payments || [])
    setShowViewModal(true)
  }

  async function updateStatus(id, status) {
    await supabase.from('invoices').update({ status }).eq('id', id)
    setInvoices(prev => prev.map(i => i.id === id ? { ...i, status } : i))
    if (viewInvoice?.id === id) setViewInvoice(v => ({ ...v, status }))
  }

  async function savePayment() {
    if (!viewInvoice || !paymentForm.amount) return
    setSavingPayment(true)
    const amt = parseFloat(paymentForm.amount)
    const balance = getBalance(viewInvoice)
    await supabase.from('invoice_payments').insert({
      invoice_id: viewInvoice.id,
      amount: amt,
      payment_date: paymentForm.payment_date,
      payment_method: paymentForm.payment_method,
      reference: paymentForm.reference || null,
      notes: paymentForm.notes || null,
      created_by_name: profile?.name,
    })
    const newPaid = getAmountPaid(viewInvoice) + amt
    const newStatus = newPaid >= parseFloat(viewInvoice.total_amount) ? 'paid' : 'partial'
    await supabase.from('invoices').update({ status: newStatus }).eq('id', viewInvoice.id)
    setPaymentForm({ amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'e-transfer', reference: '', notes: '' })
    setSavingPayment(false)
    setShowPaymentModal(false)
    await loadData()
    openView(viewInvoice)
  }

  async function deleteInvoice(id) {
    if (!window.confirm('Delete this invoice? This cannot be undone.')) return
    await supabase.from('invoice_items').delete().eq('invoice_id', id)
    await supabase.from('invoice_payments').delete().eq('invoice_id', id)
    await supabase.from('invoices').delete().eq('id', id)
    setShowViewModal(false)
    await loadData()
  }

  function printInvoice(inv) {
    const taxRate = getTaxRate(inv.customer_name)
    const taxLabel = taxRate === 0 ? 'Tax (Export - 0%)' : 'HST (13%)'
    const paid = getAmountPaid(inv)
    const balance = getBalance(inv)
    const win = window.open('', '_blank')
    const taxRate2 = getTaxRate(inv.customer_name)
    const taxLabel = taxRate2 === 0 ? 'Tax (Export - 0%)' : 'HST (13%)'
    const paid2 = getAmountPaid(inv)
    const balance2 = getBalance(inv)
    const sc2 = STATUS_COLORS[inv.status] || STATUS_COLORS.draft
    const itemRows = (inv.invoice_items || []).map(function(item) {
      const codeHtml = item.product_code
        ? '<span style="font-family:monospace;background:#f0f0f0;padding:2px 6px;border-radius:3px">' + item.product_code + '</span>'
        : '—'
      return '<tr><td>' + item.description + '</td><td>' + codeHtml + '</td>' +
        '<td style="text-align:right">' + item.quantity + '</td>' +
        '<td style="text-align:right">$' + parseFloat(item.unit_price).toFixed(2) + '</td>' +
        '<td style="text-align:right;font-weight:600">$' + parseFloat(item.line_total).toFixed(2) + '</td></tr>'
    }).join('')
    const paidRow = paid2 > 0
      ? '<div class="total-row" style="color:#27ae60"><span>Payments Received</span><span>-$' + paid2.toFixed(2) + '</span></div>'
      : ''
    const notesHtml = inv.notes
      ? '<div class="pay-info"><strong>Notes:</strong> ' + inv.notes + '</div>'
      : ''
    const emailHtml = inv.customer_email
      ? '<div style="font-size:12px;color:#888;margin-top:4px">' + inv.customer_email + '</div>'
      : ''
    const balColor = balance2 > 0 ? '#c0392b' : '#27ae60'

    const html = '<!DOCTYPE html><html><head><title>Invoice ' + inv.invoice_number + '</title>' +
    '<style>' +
    'body{font-family:Helvetica Neue,sans-serif;color:#222;margin:0;padding:40px}' +
    '.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;border-bottom:3px solid #223824;padding-bottom:20px}' +
    '.logo{font-size:24px;font-weight:700;color:#223824;letter-spacing:2px}' +
    '.inv-number{font-size:28px;font-weight:700;color:#223824}' +
    '.bill-section{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:30px}' +
    '.bill-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#888;margin-bottom:6px}' +
    '.bill-name{font-size:16px;font-weight:600;color:#223824}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:24px}' +
    'th{background:#223824;color:#E3DDD1;padding:10px 14px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase}' +
    'td{padding:10px 14px;border-bottom:1px solid #f0f0f0;font-size:13px}' +
    '.totals{margin-left:auto;width:300px}' +
    '.total-row{display:flex;justify-content:space-between;padding:8px 0;font-size:13px;border-bottom:1px solid #eee}' +
    '.grand-total{font-size:18px;font-weight:700;color:#223824;border-top:2px solid #223824;padding-top:10px;margin-top:4px}' +
    '.pay-info{background:#f8f8f8;border-left:4px solid #223824;padding:16px 20px;margin:20px 0;border-radius:4px}' +
    '.footer{margin-top:40px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#888;text-align:center}' +
    '@media print{body{padding:20px}}' +
    '</style></head><body>' +
    '<div class="header">' +
    '<div><div class="logo">KK ERP</div>' +
    '<div style="font-size:12px;color:#888;margin-top:4px">Konscious Kitchen</div>' +
    '<div style="font-size:11px;color:#888">Toronto, Ontario, Canada</div>' +
    '<div style="font-size:11px;color:#888">konsciouskitchen.com</div></div>' +
    '<div style="text-align:right"><div class="inv-number">' + inv.invoice_number + '</div>' +
    '<div style="font-size:12px;color:#888;margin-top:4px">Issue Date: ' + fmtDate(inv.issue_date) + '</div>' +
    '<div style="font-size:12px;color:#888">Due Date: ' + fmtDate(inv.due_date) + '</div>' +
    '<div style="font-size:12px;color:#888">Terms: ' + inv.payment_terms + '</div>' +
    '<div style="margin-top:6px;font-size:11px;font-weight:600;text-transform:uppercase;background:' + sc2.bg + ';color:' + sc2.color + ';padding:4px 12px;border-radius:20px;display:inline-block">' + inv.status + '</div></div></div>' +
    '<div class="bill-section"><div><div class="bill-label">Bill To</div>' +
    '<div class="bill-name">' + inv.customer_name + '</div>' + emailHtml + '</div>' +
    '<div><div class="bill-label">Payment Info</div>' +
    '<div style="font-size:12px;color:#555"><div>E-Transfer: <strong>accounting@konsciousskitchen.com</strong></div>' +
    '<div style="margin-top:4px">Reference: <strong>' + inv.invoice_number + '</strong></div></div></div></div>' +
    '<table><thead><tr><th>Description</th><th>Code</th><th style="text-align:right">Qty (Packs)</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Line Total</th></tr></thead>' +
    '<tbody>' + itemRows + '</tbody></table>' +
    '<div style="display:flex;justify-content:flex-end"><div class="totals">' +
    '<div class="total-row"><span>Subtotal</span><span>$' + parseFloat(inv.subtotal).toFixed(2) + '</span></div>' +
    '<div class="total-row"><span>' + taxLabel + '</span><span>$' + parseFloat(inv.tax_amount).toFixed(2) + '</span></div>' +
    '<div class="total-row grand-total"><span>Total</span><span>$' + parseFloat(inv.total_amount).toFixed(2) + '</span></div>' +
    paidRow +
    '<div class="total-row" style="font-weight:700;font-size:16px;color:' + balColor + '"><span>Balance Due</span><span>$' + balance2.toFixed(2) + '</span></div>' +
    '</div></div>' + notesHtml +
    '<div class="footer"><p>Konscious Kitchen &middot; Toronto, Ontario, Canada &middot; MAD CLEAN INGREDIENTS</p>' +
    '<p>Please include invoice number <strong>' + inv.invoice_number + '</strong> as reference with your payment.</p></div>' +
    '<scr' + 'ipt>window.onload=function(){window.print();}</scr' + 'ipt>' +
    '</body></html>'
    win.document.write(html)
    win.document.close()
  }

  function sendEmail(inv) {
    const balance = getBalance(inv)
    const subject = 'Invoice ' + inv.invoice_number + ' from Konscious Kitchen'
    const body = 'Hi,' +
      '%0A%0APlease find attached your invoice ' + inv.invoice_number + ' for $' + parseFloat(inv.total_amount).toFixed(2) + '.' +
      '%0A%0ACustomer: ' + inv.customer_name +
      '%0AIssue Date: ' + fmtDate(inv.issue_date) +
      '%0ADue Date: ' + fmtDate(inv.due_date) +
      '%0AAmount Due: $' + balance.toFixed(2) +
      '%0A%0APayment can be made via Interac e-Transfer to accounting@konsciousskitchen.com' +
      '%0APlease use ' + inv.invoice_number + ' as your reference.' +
      '%0A%0AThank you for your business!' +
      '%0A%0AKonscious Kitchen Team'
    const to = inv.customer_email || ''
    window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + body
    if (inv.status === 'draft') updateStatus(inv.id, 'sent')
  }

  // AR Summary
  const totalOutstanding = invoices.filter(i => ['sent','partial','overdue'].includes(i.status)).reduce((s, i) => s + getBalance(i), 0)
  const totalOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + getBalance(i), 0)
  const totalPaid30 = invoices.filter(i => i.status === 'paid' && i.issue_date >= addDays(new Date().toISOString().split('T')[0], -30)).reduce((s, i) => s + parseFloat(i.total_amount || 0), 0)

  const filtered = invoices.filter(i => {
    const matchStatus = statusFilter === 'all' || i.status === statusFilter
    const matchSearch = !search || i.customer_name.toLowerCase().includes(search.toLowerCase()) || i.invoice_number.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const tabStyle = (key) => ({
    padding: '10px 20px', border: 'none', background: 'none', cursor: 'pointer',
    fontFamily: 'var(--display)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase',
    color: tab === key ? 'var(--ink)' : 'var(--ink3)',
    borderBottom: tab === key ? '2px solid var(--kk-green)' : '2px solid transparent',
    marginBottom: -1,
  })

  const sel = { width:'100%', padding:'10px 12px', border:'1px solid var(--border)', borderRadius:6, background:'var(--surface)', color:'var(--ink)', fontSize:13 }

  if (!isAdmin) return <div style={{ padding:40, textAlign:'center', color:'var(--ink3)' }}>Admin access required</div>

  return (
    <>
      <div className="page-header">
        <div><h2>INVOICING</h2><p>Accounts receivable & payment tracking</p></div>
        <div style={{ display:'flex', gap:10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => openCreate()}>+ New Invoice</button>
          <button className="btn btn-green" onClick={() => { setShowCreateModal(true); setCreateForm(f => ({...f, order_id:''})) }}>From Order</button>
        </div>
      </div>

      <div className="page-body">
        {/* ── AR Summary cards ── */}
        <div className="grid4" style={{ marginBottom:16 }}>
          <div className="stat" style={{ borderTop:'3px solid var(--red)' }}>
            <div className="stat-label">Outstanding AR</div>
            <div className="stat-value" style={{ color:'var(--red)' }}>${totalOutstanding.toFixed(0)}</div>
            <div className="stat-sub">total balance due</div>
          </div>
          <div className="stat" style={{ borderTop:'3px solid var(--amber)' }}>
            <div className="stat-label">Overdue</div>
            <div className="stat-value" style={{ color: totalOverdue > 0 ? 'var(--red)' : 'var(--ink3)' }}>${totalOverdue.toFixed(0)}</div>
            <div className="stat-sub">{invoices.filter(i => i.status === 'overdue').length} invoices past due</div>
          </div>
          <div className="stat" style={{ borderTop:'3px solid var(--kk-green)' }}>
            <div className="stat-label">Collected (30d)</div>
            <div className="stat-value" style={{ color:'var(--kk-green)' }}>${totalPaid30.toFixed(0)}</div>
            <div className="stat-sub">paid last 30 days</div>
          </div>
          <div className="stat" style={{ borderTop:'3px solid var(--blue)' }}>
            <div className="stat-label">Total Invoices</div>
            <div className="stat-value" style={{ color:'var(--blue)' }}>{invoices.length}</div>
            <div className="stat-sub">{invoices.filter(i => i.status === 'draft').length} draft · {invoices.filter(i => i.status === 'sent').length} sent</div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', marginBottom:16 }}>
          <button style={tabStyle('invoices')} onClick={() => setTab('invoices')}>Invoices</button>
          <button style={tabStyle('aging')} onClick={() => setTab('aging')}>Aging Report</button>
        </div>

        {tab === 'invoices' && (
          <div className="card">
            <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
              <input placeholder="Search customer or invoice #..." value={search} onChange={e => setSearch(e.target.value)}
                style={{ flex:1, minWidth:200, padding:'8px 12px', border:'1px solid var(--border)', borderRadius:6, fontSize:12, background:'var(--surface)', color:'var(--ink)' }} />
              {['all','draft','sent','partial','paid','overdue','void'].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} style={{
                  padding:'6px 14px', borderRadius:20, border:'1px solid var(--border)', cursor:'pointer', fontSize:11,
                  fontFamily:'var(--display)', letterSpacing:1, textTransform:'uppercase',
                  background: statusFilter === s ? 'var(--kk-green)' : 'var(--surface)',
                  color: statusFilter === s ? 'var(--kk-cream)' : 'var(--ink3)',
                }}>{s}</button>
              ))}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Invoice #</th><th>Customer</th><th>Issue Date</th><th>Due Date</th>
                    <th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th style={{width:140}}></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} style={{ textAlign:'center', padding:40, color:'var(--ink3)' }}>Loading...</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={9} style={{ textAlign:'center', padding:40, color:'var(--ink3)' }}>No invoices found</td></tr>
                  ) : filtered.map(inv => {
                    const paid = getAmountPaid(inv)
                    const balance = getBalance(inv)
                    const sc = STATUS_COLORS[inv.status] || STATUS_COLORS.draft
                    return (
                      <tr key={inv.id} style={{ cursor:'pointer' }} onClick={() => openView(inv)}>
                        <td style={{ fontFamily:'var(--mono)', fontWeight:600, color:'var(--kk-green)' }}>{inv.invoice_number}</td>
                        <td style={{ fontWeight:500 }}>{inv.customer_name}</td>
                        <td style={{ fontSize:12, color:'var(--ink3)' }}>{fmtDate(inv.issue_date)}</td>
                        <td style={{ fontSize:12, color: inv.status === 'overdue' ? 'var(--red)' : 'var(--ink3)' }}>{fmtDate(inv.due_date)}</td>
                        <td style={{ fontFamily:'var(--display)', color:'var(--ink)' }}>${parseFloat(inv.total_amount).toFixed(2)}</td>
                        <td style={{ fontSize:12, color:'var(--green)' }}>{paid > 0 ? '$' + paid.toFixed(2) : '—'}</td>
                        <td style={{ fontWeight:700, color: balance > 0 ? 'var(--red)' : 'var(--green)' }}>
                          ${balance.toFixed(2)}
                        </td>
                        <td>
                          <span style={{ fontSize:10, padding:'3px 8px', borderRadius:20, background:sc.bg, color:sc.color, fontWeight:600, letterSpacing:1, textTransform:'uppercase' }}>
                            {inv.status}
                          </span>
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display:'flex', gap:4 }}>
                            <button onClick={() => printInvoice(inv)} style={{ background:'var(--surface2)', border:'none', borderRadius:4, padding:'4px 8px', fontSize:11, cursor:'pointer' }}>🖨️</button>
                            <button onClick={() => sendEmail(inv)} style={{ background:'var(--surface2)', border:'none', borderRadius:4, padding:'4px 8px', fontSize:11, cursor:'pointer' }}>✉️</button>
                            <button onClick={() => { setViewInvoice(inv); setShowPaymentModal(true) }} style={{ background:'var(--green-l)', border:'none', borderRadius:4, padding:'4px 8px', fontSize:11, cursor:'pointer', color:'var(--green)' }}>+ Pay</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'aging' && (
          <div className="card">
            <div className="card-title">Accounts Receivable Aging Report</div>
            {(() => {
              const today = new Date()
              const buckets = { current: [], d30: [], d60: [], d90: [], d90plus: [] }
              invoices.filter(i => ['sent','partial','overdue'].includes(i.status)).forEach(inv => {
                const due = new Date(inv.due_date + 'T12:00:00')
                const days = Math.floor((today - due) / (1000 * 60 * 60 * 24))
                const balance = getBalance(inv)
                if (balance <= 0) return
                const entry = { ...inv, balance, daysOverdue: days }
                if (days <= 0) buckets.current.push(entry)
                else if (days <= 30) buckets.d30.push(entry)
                else if (days <= 60) buckets.d60.push(entry)
                else if (days <= 90) buckets.d90.push(entry)
                else buckets.d90plus.push(entry)
              })
              const bucketDefs = [
                { key:'current', label:'Current', color:'var(--green)' },
                { key:'d30',     label:'1-30 Days', color:'var(--amber)' },
                { key:'d60',     label:'31-60 Days', color:'var(--kk-peach)' },
                { key:'d90',     label:'61-90 Days', color:'var(--red)' },
                { key:'d90plus', label:'90+ Days', color:'#8B0000' },
              ]
              return (
                <div>
                  <div className="grid4" style={{ marginBottom:20 }}>
                    {bucketDefs.map(b => {
                      const total = buckets[b.key].reduce((s, i) => s + i.balance, 0)
                      return (
                        <div key={b.key} style={{ background:'var(--surface2)', borderRadius:8, padding:'12px 16px', borderTop:'3px solid ' + b.color }}>
                          <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:1, color:'var(--ink3)', marginBottom:4 }}>{b.label}</div>
                          <div style={{ fontFamily:'var(--display)', fontSize:22, color:b.color }}>${total.toFixed(0)}</div>
                          <div style={{ fontSize:11, color:'var(--ink3)' }}>{buckets[b.key].length} invoices</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Invoice #</th><th>Customer</th><th>Due Date</th><th>Days Overdue</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead>
                      <tbody>
                        {bucketDefs.flatMap(b => buckets[b.key].map(inv => (
                          <tr key={inv.id} style={{ cursor:'pointer' }} onClick={() => openView(inv)}>
                            <td style={{ fontFamily:'var(--mono)', color:'var(--kk-green)', fontWeight:600 }}>{inv.invoice_number}</td>
                            <td style={{ fontWeight:500 }}>{inv.customer_name}</td>
                            <td style={{ fontSize:12 }}>{fmtDate(inv.due_date)}</td>
                            <td style={{ color: inv.daysOverdue > 0 ? 'var(--red)' : 'var(--green)', fontWeight:600 }}>
                              {inv.daysOverdue > 0 ? inv.daysOverdue + ' days' : 'Current'}
                            </td>
                            <td>${parseFloat(inv.total_amount).toFixed(2)}</td>
                            <td style={{ fontWeight:700, color:'var(--red)' }}>${inv.balance.toFixed(2)}</td>
                            <td><span style={{ fontSize:10, padding:'3px 8px', borderRadius:20, background:STATUS_COLORS[inv.status]?.bg, color:STATUS_COLORS[inv.status]?.color, fontWeight:600 }}>{inv.status}</span></td>
                          </tr>
                        )))}
                        {Object.values(buckets).every(b => b.length === 0) && (
                          <tr><td colSpan={7} style={{ textAlign:'center', padding:40, color:'var(--ink3)' }}>No outstanding invoices</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* ── CREATE INVOICE MODAL ── */}
      {showCreateModal && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowCreateModal(false)}>
          <div className="modal" style={{ maxWidth:720 }}>
            <button className="modal-close" onClick={() => setShowCreateModal(false)}>&times;</button>
            <div className="modal-title">CREATE INVOICE</div>

            {/* From order picker */}
            {!createForm.order_id && (
              <div className="field">
                <label>From Order (optional)</label>
                <select style={sel} onChange={e => {
                  const order = orders.find(o => o.id === e.target.value)
                  if (order) openCreate(order)
                }}>
                  <option value="">Create blank invoice or select an order...</option>
                  {orders.map(o => (
                    <option key={o.id} value={o.id}>{o.order_number} — {o.customer_name} (${(o.total_value||0).toFixed(2)})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="field-row">
              <div className="field" style={{margin:0}}>
                <label>Customer Name *</label>
                <input style={sel} value={createForm.customer_name} onChange={e => setCreateForm(f=>({...f,customer_name:e.target.value}))} placeholder="Customer name..." />
              </div>
              <div className="field" style={{margin:0}}>
                <label>Customer Email</label>
                <input style={sel} type="email" value={createForm.customer_email} onChange={e => setCreateForm(f=>({...f,customer_email:e.target.value}))} placeholder="email@example.com" />
              </div>
            </div>
            <div className="field-row">
              <div className="field" style={{margin:0}}>
                <label>Issue Date</label>
                <input style={sel} type="date" value={createForm.issue_date} onChange={e => setCreateForm(f=>({...f,issue_date:e.target.value}))} />
              </div>
              <div className="field" style={{margin:0}}>
                <label>Payment Terms</label>
                <select style={sel} value={createForm.payment_terms} onChange={e => setCreateForm(f=>({...f,payment_terms:e.target.value}))}>
                  <option>Net 30</option>
                  <option>Net 15</option>
                  <option>Due on Receipt</option>
                </select>
              </div>
            </div>

            {/* Tax indicator */}
            {createForm.customer_name && (
              <div style={{ padding:'6px 12px', borderRadius:6, marginBottom:12, fontSize:11,
                background: isExport(createForm.customer_name) ? 'var(--blue-l)' : 'var(--green-l)',
                color: isExport(createForm.customer_name) ? 'var(--blue)' : 'var(--green)' }}>
                {isExport(createForm.customer_name) ? '🌐 Export customer — 0% tax' : '🍁 Canadian customer — HST 13% will be applied'}
              </div>
            )}

            {/* Line items */}
            <div style={{ fontSize:11, letterSpacing:2, textTransform:'uppercase', color:'var(--ink3)', marginBottom:8, fontFamily:'var(--display)' }}>Line Items</div>
            {createItems.map((item, idx) => (
              <div key={idx} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6, background:'var(--surface2)', padding:'8px 10px', borderRadius:6 }}>
                <input placeholder="Description" value={item.description} onChange={e => updateCreateItem(idx,'description',e.target.value)}
                  style={{ ...sel, flex:3, padding:'6px 8px', fontSize:12 }} />
                <input placeholder="Code" value={item.product_code || ''} onChange={e => updateCreateItem(idx,'product_code',e.target.value)}
                  style={{ ...sel, width:70, padding:'6px 8px', fontSize:11 }} />
                <input type="number" placeholder="Qty" value={item.quantity} onChange={e => updateCreateItem(idx,'quantity',e.target.value)}
                  style={{ ...sel, width:60, padding:'6px 8px', fontSize:12, fontWeight:700 }} />
                <input type="number" placeholder="Price" value={item.unit_price} onChange={e => updateCreateItem(idx,'unit_price',e.target.value)}
                  style={{ ...sel, width:80, padding:'6px 8px', fontSize:12 }} />
                <div style={{ minWidth:70, fontSize:12, fontWeight:600, color:'var(--kk-green)', textAlign:'right' }}>
                  ${(parseFloat(item.line_total)||0).toFixed(2)}
                </div>
                <button onClick={() => setCreateItems(prev => prev.filter((_,i) => i !== idx))}
                  style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:18 }}>&times;</button>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" style={{ marginBottom:12 }}
              onClick={() => setCreateItems(prev => [...prev, { product_code:'', description:'', quantity:1, unit_price:0, line_total:0 }])}>
              + Add Line
            </button>

            {/* Totals preview */}
            {(() => {
              const subtotal = createItems.reduce((s,i) => s + (parseFloat(i.line_total)||0), 0)
              const taxRate = getTaxRate(createForm.customer_name)
              const tax = subtotal * taxRate
              const total = subtotal + tax
              return (
                <div style={{ background:'var(--surface2)', padding:'12px 16px', borderRadius:6, marginBottom:12 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                    <span>Subtotal</span><span>${subtotal.toFixed(2)}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4, color:'var(--ink3)' }}>
                    <span>HST ({(taxRate*100).toFixed(0)}%)</span><span>${tax.toFixed(2)}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:16, fontWeight:700, color:'var(--kk-green)', borderTop:'1px solid var(--border)', paddingTop:8, marginTop:4 }}>
                    <span>Total</span><span>${total.toFixed(2)}</span>
                  </div>
                </div>
              )
            })()}

            <div className="field">
              <label>Notes</label>
              <textarea style={{ ...sel, minHeight:50 }} value={createForm.notes} onChange={e => setCreateForm(f=>({...f,notes:e.target.value}))} placeholder="Payment instructions, special terms..." />
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-green btn-full" onClick={saveInvoice} disabled={creating}>{creating ? 'Creating...' : 'Create Invoice'}</button>
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW INVOICE MODAL ── */}
      {showViewModal && viewInvoice && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowViewModal(false)}>
          <div className="modal" style={{ maxWidth:680 }}>
            <button className="modal-close" onClick={() => setShowViewModal(false)}>&times;</button>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
              <div>
                <div style={{ fontFamily:'var(--display)', fontSize:22, letterSpacing:2, color:'var(--kk-green)' }}>{viewInvoice.invoice_number}</div>
                <div style={{ fontSize:14, fontWeight:600, marginTop:2 }}>{viewInvoice.customer_name}</div>
                <div style={{ fontSize:11, color:'var(--ink3)' }}>Issue: {fmtDate(viewInvoice.issue_date)} · Due: {fmtDate(viewInvoice.due_date)} · {viewInvoice.payment_terms}</div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
                <span style={{ fontSize:11, padding:'4px 12px', borderRadius:20, background:STATUS_COLORS[viewInvoice.status]?.bg, color:STATUS_COLORS[viewInvoice.status]?.color, fontWeight:600, textTransform:'uppercase' }}>
                  {viewInvoice.status}
                </span>
                <select value={viewInvoice.status} onChange={e => updateStatus(viewInvoice.id, e.target.value)}
                  style={{ fontSize:11, padding:'4px 8px', border:'1px solid var(--border)', borderRadius:4, background:'var(--surface)' }}>
                  {['draft','sent','paid','partial','overdue','void'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="table-wrap" style={{ marginBottom:16 }}>
              <table>
                <thead><tr><th>Description</th><th>Code</th><th>Qty</th><th>Unit Price</th><th>Line Total</th></tr></thead>
                <tbody>
                  {(viewInvoice.invoice_items || []).map(item => (
                    <tr key={item.id}>
                      <td style={{ fontWeight:500 }}>{item.description}</td>
                      <td>{item.product_code ? <span className="code-tag">{item.product_code}</span> : '—'}</td>
                      <td>{item.quantity}</td>
                      <td>${parseFloat(item.unit_price).toFixed(2)}</td>
                      <td style={{ fontWeight:600, color:'var(--kk-green)' }}>${parseFloat(item.line_total).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:16 }}>
              <div style={{ width:260 }}>
                {[
                  ['Subtotal', '$' + parseFloat(viewInvoice.subtotal).toFixed(2)],
                  ['HST', '$' + parseFloat(viewInvoice.tax_amount).toFixed(2)],
                  ['Total', '$' + parseFloat(viewInvoice.total_amount).toFixed(2)],
                  ['Payments Received', '-$' + getAmountPaid(viewInvoice).toFixed(2)],
                  ['Balance Due', '$' + getBalance(viewInvoice).toFixed(2)],
                ].map(([label, val], i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
                    fontSize: i === 4 ? 16 : 13, fontWeight: i >= 2 ? 600 : 400,
                    color: i === 4 ? (getBalance(viewInvoice) > 0 ? 'var(--red)' : 'var(--green)') : 'var(--ink)' }}>
                    <span>{label}</span><span>{val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment history */}
            {(viewInvoice.invoice_payments || []).length > 0 && (
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, letterSpacing:2, textTransform:'uppercase', color:'var(--ink3)', marginBottom:8, fontFamily:'var(--display)' }}>Payment History</div>
                {(viewInvoice.invoice_payments || []).map(p => (
                  <div key={p.id} style={{ display:'flex', gap:12, padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:12 }}>
                    <span style={{ color:'var(--green)', fontWeight:600 }}>+${parseFloat(p.amount).toFixed(2)}</span>
                    <span style={{ color:'var(--ink3)' }}>{fmtDate(p.payment_date)}</span>
                    <span style={{ background:'var(--surface2)', padding:'1px 8px', borderRadius:4 }}>{p.payment_method}</span>
                    {p.reference && <span style={{ color:'var(--ink3)' }}>Ref: {p.reference}</span>}
                  </div>
                ))}
              </div>
            )}

            {viewInvoice.notes && (
              <div style={{ padding:'10px 14px', background:'var(--surface2)', borderRadius:6, fontSize:12, marginBottom:16 }}>
                📝 {viewInvoice.notes}
              </div>
            )}

            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button className="btn btn-green" onClick={() => { setShowPaymentModal(true) }}>+ Record Payment</button>
              <button className="btn btn-secondary" onClick={() => printInvoice(viewInvoice)}>🖨️ Print / PDF</button>
              <button className="btn btn-secondary" onClick={() => sendEmail(viewInvoice)}>✉️ Send Email</button>
              <button style={{ marginLeft:'auto', background:'none', border:'1px solid var(--red)', color:'var(--red)', borderRadius:6, padding:'8px 14px', fontSize:12, cursor:'pointer' }}
                onClick={() => deleteInvoice(viewInvoice.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── RECORD PAYMENT MODAL ── */}
      {showPaymentModal && viewInvoice && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setShowPaymentModal(false)}>
          <div className="modal" style={{ maxWidth:440 }}>
            <button className="modal-close" onClick={() => setShowPaymentModal(false)}>&times;</button>
            <div className="modal-title">RECORD PAYMENT</div>
            <div style={{ fontSize:13, color:'var(--ink3)', marginBottom:16 }}>
              {viewInvoice.invoice_number} · {viewInvoice.customer_name} · Balance: <strong style={{ color:'var(--red)' }}>${getBalance(viewInvoice).toFixed(2)}</strong>
            </div>
            <div className="field-row">
              <div className="field" style={{margin:0}}>
                <label>Amount *</label>
                <input style={sel} type="number" step="0.01" value={paymentForm.amount}
                  onChange={e => setPaymentForm(f=>({...f,amount:e.target.value}))}
                  placeholder={getBalance(viewInvoice).toFixed(2)} />
              </div>
              <div className="field" style={{margin:0}}>
                <label>Payment Date</label>
                <input style={sel} type="date" value={paymentForm.payment_date}
                  onChange={e => setPaymentForm(f=>({...f,payment_date:e.target.value}))} />
              </div>
            </div>
            <div className="field">
              <label>Payment Method</label>
              <select style={sel} value={paymentForm.payment_method} onChange={e => setPaymentForm(f=>({...f,payment_method:e.target.value}))}>
                <option value="e-transfer">Interac e-Transfer</option>
                <option value="stripe">Stripe (Credit Card)</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="field">
              <label>Reference Number</label>
              <input style={sel} value={paymentForm.reference} onChange={e => setPaymentForm(f=>({...f,reference:e.target.value}))}
                placeholder="e-Transfer confirmation, cheque #, etc." />
            </div>
            <div className="field">
              <label>Notes</label>
              <input style={sel} value={paymentForm.notes} onChange={e => setPaymentForm(f=>({...f,notes:e.target.value}))} placeholder="Optional notes..." />
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-green btn-full" onClick={savePayment} disabled={savingPayment}>
                {savingPayment ? 'Saving...' : 'Record Payment'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowPaymentModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
