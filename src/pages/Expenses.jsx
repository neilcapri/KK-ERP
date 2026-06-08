import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

const EXPENSE_CATEGORIES = [
  'Raw Materials', 'Packaging', 'Kitchen Supplies', 'Rent / Utilities',
  'Shipping / Logistics', 'Marketing', 'Lab / Compliance', 'Equipment', 'Travel', 'Other Expense',
]
const PAYROLL_CATEGORIES = ['Full-time Staff', 'Part-time Staff', 'Contract / Freelance', 'Owner Draw']

const SOURCE_ICONS = { manual: '✏️', receipt_photo: '📷', gmail: '✉️' }

const today = () => new Date().toISOString().split('T')[0]

const fmtCAD = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const DATE_RANGES = [
  { label: '30 Days', days: 30 },
  { label: '3 Months', days: 90 },
  { label: '6 Months', days: 180 },
  { label: '12 Months', days: 365 },
]

function getStartDate(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 6,
  border: '1.5px solid var(--border)', fontSize: 12,
  outline: 'none', fontFamily: 'var(--body)', boxSizing: 'border-box', background: '#fff',
}

const fieldLabel = {
  display: 'block', fontSize: 10, fontFamily: 'var(--display)',
  letterSpacing: 2, textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 4,
}

const TABS = [
  { id: 'add', label: '➕ Add Expense' },
  { id: 'payroll', label: '👥 Payroll' },
  { id: 'receipt', label: '📷 Receipt Photo' },
  { id: 'gmail', label: '✉️ Gmail Invoices' },
  { id: 'ledger', label: '📋 Ledger' },
]

export default function Expenses() {
  const [activeTab, setActiveTab] = useState('add')
  const [dateRange, setDateRange] = useState(30)
  const [transactions, setTransactions] = useState([])
  const [txLoading, setTxLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [txFilter, setTxFilter] = useState('all')

  const emptyForm = { date: today(), type: 'expense', category: '', description: '', amount: '', vendor: '', notes: '' }
  const [form, setForm] = useState(emptyForm)

  // Receipt photo
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()

  // Gmail
  const [gmailLoading, setGmailLoading] = useState(false)
  const [gmailResults, setGmailResults] = useState([])

  useEffect(() => { loadTransactions() }, [dateRange])

  async function loadTransactions() {
    setTxLoading(true)
    const { data } = await supabase
      .from('financial_transactions')
      .select('*')
      .gte('date', getStartDate(dateRange))
      .order('date', { ascending: false })
    setTransactions(data || [])
    setTxLoading(false)
  }

  async function saveTransaction(tx) {
    const { error } = await supabase.from('financial_transactions').insert([tx])
    if (error) { alert('Save failed: ' + error.message); return false }
    await loadTransactions()
    return true
  }

  async function deleteTransaction(id) {
    if (!window.confirm('Delete this entry?')) return
    await supabase.from('financial_transactions').delete().eq('id', id)
    setTransactions(prev => prev.filter(t => t.id !== id))
  }

  const handleSubmit = async () => {
    if (!form.description || !form.amount || !form.category) return alert('Fill in description, category, and amount.')
    setSaving(true)
    const ok = await saveTransaction({ ...form, amount: parseFloat(form.amount), source: 'manual' })
    if (ok) setForm({ ...emptyForm, type: form.type })
    setSaving(false)
  }

  // Receipt OCR
  const handlePhotoUpload = async (file) => {
    if (!file) return
    setAiLoading(true)
    setAiResult(null)
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result.split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })
      const apiKey = process.env.REACT_APP_ANTHROPIC_KEY
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } },
              { type: 'text', text: `Extract expense details from this receipt/invoice for Konscious Kitchen, a Toronto CPG food brand. Return ONLY valid JSON (no markdown):
{"date":"YYYY-MM-DD","description":"what was purchased","amount":number,"vendor":"supplier name","category":"one of: Raw Materials, Packaging, Kitchen Supplies, Rent / Utilities, Shipping / Logistics, Marketing, Lab / Compliance, Equipment, Travel, Other Expense","notes":"invoice # or ref if present"}` }
            ]
          }]
        })
      })
      const data = await resp.json()
      const text = data.content?.find(b => b.type === 'text')?.text || ''
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
      setAiResult({ ...parsed, type: 'expense', amount: parsed.amount || '' })
    } catch {
      alert('Could not read receipt — try a clearer photo.')
    }
    setAiLoading(false)
  }

  const importAiResult = async () => {
    setSaving(true)
    const ok = await saveTransaction({ ...aiResult, amount: parseFloat(aiResult.amount) || 0, source: 'receipt_photo' })
    if (ok) { setAiResult(null); setActiveTab('ledger') }
    setSaving(false)
  }

  // Gmail invoice scan
  const handleGmailScan = async () => {
    setGmailLoading(true)
    setGmailResults([])
    const since = getStartDate(dateRange)
    try {
      const apiKey = process.env.REACT_APP_ANTHROPIC_KEY
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'mcp-client-2025-04-04' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          mcp_servers: [{ type: 'url', url: 'https://gmailmcp.googleapis.com/mcp/v1', name: 'gmail-mcp' }],
          messages: [{
            role: 'user',
            content: `You are processing financial emails for Konscious Kitchen (KK), a Toronto CPG food brand.

Do TWO Gmail searches:

SEARCH 1 — QuickBooks invoices KK sent to wholesale customers:
Query: after:${since} invoice intuit
Customers include: Natures Emporium, Big Carrot, Whole Foods, Loblaws, Fresh City, Fiddleheads, Summerhill Market, Sweat & Tonic, ONFC, Kupfert & Kim, Kimberton, Happier Grocery, Westerly, Mother's Market.

SEARCH 2 — Payment confirmations received:
Query: after:${since} (payment OR "e-transfer" OR "payment received" OR "paid") -in:sent

For every email extract:
{"date":"YYYY-MM-DD","invoice_number":"# if present","customer":"store name","description":"e.g. Invoice #1234 - Natures Emporium","amount":number,"status":"invoiced" or "received","category":"Wholesale Order" or "Distributor Payment" or "DTC / Shopify" or "Other Revenue","type":"revenue","notes":"any ref numbers"}

Return ONLY a flat JSON array. No markdown.`
          }]
        })
      })
      const data = await resp.json()
      let found = []
      for (const block of (data.content || [])) {
        if (block.type === 'text') {
          try { const m = block.text.replace(/```json|```/g, '').match(/\[[\s\S]*\]/); if (m) { const a = JSON.parse(m[0]); if (Array.isArray(a)) found = a } } catch {}
        }
        if (block.type === 'mcp_tool_result') {
          try { const m = (block.content?.[0]?.text || '').replace(/```json|```/g, '').match(/\[[\s\S]*\]/); if (m) { const a = JSON.parse(m[0]); if (Array.isArray(a)) found = a } } catch {}
        }
      }
      const seen = new Set()
      const deduped = found.filter(r => { const k = r.invoice_number || (r.customer + r.amount); if (seen.has(k)) return false; seen.add(k); return true })
      setGmailResults(deduped)
      if (!deduped.length) alert('No invoice emails found in this date range.')
    } catch {
      alert('Gmail scan failed — ensure Gmail is connected in Claude settings.')
    }
    setGmailLoading(false)
  }

  const importGmailRow = async (row) => {
    const tx = {
      date: row.date || today(), type: 'revenue',
      category: row.category || 'Wholesale Order',
      description: row.description || `Invoice — ${row.customer}`,
      amount: parseFloat(row.amount) || 0,
      vendor: row.customer || '',
      notes: [row.invoice_number ? `Invoice #${row.invoice_number}` : '', '[Gmail]'].filter(Boolean).join(' · '),
      source: 'gmail',
    }
    const ok = await saveTransaction(tx)
    if (ok) setGmailResults(prev => prev.filter(r => r !== row))
  }

  // Stats
  const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const totalPayroll = transactions.filter(t => t.type === 'payroll').reduce((s, t) => s + Number(t.amount), 0)
  const totalRevenue = transactions.filter(t => t.type === 'revenue').reduce((s, t) => s + Number(t.amount), 0)
  const filteredTx = txFilter === 'all' ? transactions : transactions.filter(t => t.type === txFilter)

  const btnStyle = (active) => ({
    padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border)',
    background: active ? 'var(--kk-green)' : 'var(--surface)',
    color: active ? 'var(--kk-cream)' : 'var(--ink3)',
    cursor: 'pointer', fontSize: 10, fontFamily: 'var(--display)', letterSpacing: 1, textTransform: 'uppercase',
  })

  const tabStyle = (active) => ({
    padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
    fontFamily: 'var(--display)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase',
    color: active ? 'var(--ink)' : 'var(--ink3)',
    borderBottom: active ? '2px solid var(--kk-green)' : '2px solid transparent',
    marginBottom: -1, whiteSpace: 'nowrap',
  })

  const categoryOptions = form.type === 'payroll' ? PAYROLL_CATEGORIES : EXPENSE_CATEGORIES

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 10, letterSpacing: 3, color: 'var(--kk-peach)', textTransform: 'uppercase', marginBottom: 2 }}>Admin Only</div>
        <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontSize: 22, letterSpacing: 2, color: 'var(--kk-green)' }}>EXPENSES</h2>
      </div>

      {/* Stat cards */}
      <div className="grid4" style={{ marginBottom: 24 }}>
        <div className="stat amber">
          <div className="stat-label">Total Expenses</div>
          <div className="stat-value">{fmtCAD(totalExpenses)}</div>
          <div className="stat-sub">Last {dateRange} days</div>
        </div>
        <div className="stat">
          <div className="stat-label">Payroll</div>
          <div className="stat-value" style={{ color: 'var(--kk-brown)' }}>{fmtCAD(totalPayroll)}</div>
          <div className="stat-sub">Staff + contractors</div>
        </div>
        <div className="stat green">
          <div className="stat-label">Revenue Logged</div>
          <div className="stat-value">{fmtCAD(totalRevenue)}</div>
          <div className="stat-sub">From Gmail imports</div>
        </div>
        <div className="stat" style={{ borderTop: '3px solid var(--kk-green)' }}>
          <div className="stat-label">Total Outflow</div>
          <div className="stat-value" style={{ color: 'var(--red)' }}>{fmtCAD(totalExpenses + totalPayroll)}</div>
          <div className="stat-sub">Expenses + payroll</div>
        </div>
      </div>

      {/* Date range + tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
          {TABS.map(t => (
            <button key={t.id} style={tabStyle(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {DATE_RANGES.map(r => (
            <button key={r.days} style={btnStyle(dateRange === r.days)} onClick={() => setDateRange(r.days)}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* ── ADD EXPENSE ── */}
      {activeTab === 'add' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20 }}>
          <div className="card">
            <div className="card-title">New Entry</div>

            {/* Type toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {['expense', 'payroll'].map(t => (
                <button key={t} onClick={() => setForm(p => ({ ...p, type: t, category: '' }))}
                  style={{ ...btnStyle(form.type === t), flex: 1, padding: '8px' }}>
                  {t === 'expense' ? '💸 Expense' : '👥 Payroll'}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={fieldLabel}>Date</label>
                  <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={fieldLabel}>Amount (CAD)</label>
                  <input type="number" placeholder="0.00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={fieldLabel}>Category</label>
                <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={inputStyle}>
                  <option value="">Select…</option>
                  {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>{form.type === 'payroll' ? 'Employee / Contractor' : 'Vendor / Supplier'}</label>
                <input type="text" placeholder={form.type === 'payroll' ? 'e.g. Krishanth' : 'e.g. Tootsi Impex'} value={form.vendor} onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={fieldLabel}>Description</label>
                <input type="text" placeholder="Brief description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={fieldLabel}>Notes (optional)</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
              <button onClick={handleSubmit} disabled={saving}
                style={{ background: 'var(--kk-green)', color: '#fff', border: 'none', borderRadius: 8, padding: '12px', fontFamily: 'var(--display)', letterSpacing: 2, fontSize: 10, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'SAVING…' : `+ SAVE ${form.type.toUpperCase()}`}
              </button>
            </div>
          </div>

          {/* Breakdown */}
          <div className="card">
            <div className="card-title">Expense Breakdown <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>— last {dateRange} days</span></div>
            {txLoading ? <div style={{ color: 'var(--ink3)', fontSize: 12 }}>Loading…</div> : (() => {
              const expTx = transactions.filter(t => t.type === 'expense')
              const byCat = expTx.reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + Number(t.amount); return acc }, {})
              const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1])
              const total = expTx.reduce((s, t) => s + Number(t.amount), 0)
              if (sorted.length === 0) return <div style={{ color: 'var(--ink3)', fontSize: 12 }}>No expenses recorded yet.</div>
              return sorted.map(([cat, amt]) => (
                <div key={cat} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{cat}</span>
                    <span style={{ fontFamily: 'var(--display)', color: 'var(--kk-brown)' }}>{fmtCAD(amt)} <span style={{ color: 'var(--ink3)', fontSize: 10 }}>({(amt / total * 100).toFixed(0)}%)</span></span>
                  </div>
                  <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (amt / total * 100) + '%', background: 'var(--kk-peach)', borderRadius: 3 }} />
                  </div>
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* ── PAYROLL ── */}
      {activeTab === 'payroll' && (
        <div className="card">
          <div className="card-title">Payroll Entries <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>— last {dateRange} days</span></div>
          {txLoading ? <div style={{ color: 'var(--ink3)', fontSize: 12 }}>Loading…</div> : (() => {
            const payTx = transactions.filter(t => t.type === 'payroll')
            if (payTx.length === 0) return (
              <div style={{ color: 'var(--ink3)', fontSize: 12 }}>
                No payroll entries yet. <button onClick={() => { setForm(p => ({ ...p, type: 'payroll', category: '' })); setActiveTab('add') }} style={{ background: 'none', border: 'none', color: 'var(--kk-green)', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Add one →</button>
              </div>
            )
            return (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Employee</th><th>Category</th><th>Description</th><th>Amount</th><th>Notes</th><th></th></tr></thead>
                  <tbody>
                    {payTx.map((t, i) => (
                      <tr key={t.id} style={{ background: i % 2 === 0 ? '#fff' : 'var(--bg)' }}>
                        <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{t.date}</td>
                        <td style={{ fontWeight: 600 }}>{t.vendor}</td>
                        <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{t.category}</td>
                        <td>{t.description}</td>
                        <td style={{ fontFamily: 'var(--display)', color: 'var(--kk-brown)', fontWeight: 700 }}>{fmtCAD(t.amount)}</td>
                        <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{t.notes}</td>
                        <td><button onClick={() => deleteTransaction(t.id)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer' }}>🗑</button></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                      <td colSpan={4} style={{ fontFamily: 'var(--display)', fontSize: 12, letterSpacing: 1 }}>TOTAL</td>
                      <td style={{ fontFamily: 'var(--display)', color: 'var(--kk-green)', fontSize: 14 }}>{fmtCAD(totalPayroll)}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── RECEIPT PHOTO ── */}
      {activeTab === 'receipt' && (
        <div style={{ maxWidth: 520 }}>
          <div className="card">
            <div className="card-title">📷 Receipt / Invoice Photo</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 16 }}>Upload a photo of any receipt, supplier bill, or invoice. AI reads it and fills in all the details.</div>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handlePhotoUpload(f) }}
              onClick={() => fileRef.current.click()}
              style={{ border: `2px dashed ${dragOver ? 'var(--kk-green)' : 'var(--kk-peach)'}`, borderRadius: 10, padding: 40, textAlign: 'center', cursor: 'pointer', background: dragOver ? '#f0f5f0' : 'var(--bg)', transition: 'all 0.2s', marginBottom: 16 }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>🧾</div>
              <div style={{ fontFamily: 'var(--display)', letterSpacing: 1, fontSize: 10, color: 'var(--kk-green)' }}>DROP RECEIPT HERE OR CLICK TO UPLOAD</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>JPG · PNG · HEIC</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (f) handlePhotoUpload(f) }} />
            {aiLoading && <div style={{ textAlign: 'center', padding: 20, color: 'var(--kk-green)', fontFamily: 'var(--display)', letterSpacing: 2, fontSize: 10 }}>READING RECEIPT…</div>}
            {aiResult && (
              <div style={{ background: '#f0f5f0', borderRadius: 8, padding: 16, border: '1.5px solid var(--kk-green)' }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: 10, letterSpacing: 2, color: 'var(--kk-green)', marginBottom: 12 }}>✅ EXTRACTED FROM RECEIPT</div>
                {[['Date', aiResult.date], ['Description', aiResult.description], ['Amount', fmtCAD(aiResult.amount)], ['Vendor', aiResult.vendor], ['Category', aiResult.category], ['Notes', aiResult.notes]].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--ink3)', fontWeight: 600 }}>{k}</span><span>{v}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={importAiResult} disabled={saving} style={{ flex: 1, background: 'var(--kk-green)', color: '#fff', border: 'none', borderRadius: 6, padding: '10px', fontFamily: 'var(--display)', letterSpacing: 1, fontSize: 9, cursor: 'pointer' }}>+ SAVE TO LEDGER</button>
                  <button onClick={() => setAiResult(null)} style={{ flex: 1, background: 'var(--border)', color: 'var(--ink)', border: 'none', borderRadius: 6, padding: '10px', fontFamily: 'var(--display)', letterSpacing: 1, fontSize: 9, cursor: 'pointer' }}>DISCARD</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── GMAIL INVOICES ── */}
      {activeTab === 'gmail' && (
        <div style={{ maxWidth: 800 }}>
          <div className="card">
            <div className="card-title">✉️ Gmail Invoice Scanner</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 6 }}>Scans Gmail for QuickBooks invoices sent to wholesale customers + incoming payment confirmations. Imports directly as Revenue.</div>
            <div style={{ fontSize: 11, color: 'var(--ink3)', background: 'var(--bg)', borderRadius: 6, padding: '8px 12px', marginBottom: 16 }}>
              📌 Scanning: last <strong>{dateRange} days</strong> · Looks for outgoing QBO invoices + e-transfer / payment received emails
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
              <button onClick={handleGmailScan} disabled={gmailLoading}
                style={{ background: gmailLoading ? 'var(--border)' : 'var(--kk-green)', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 24px', fontFamily: 'var(--display)', letterSpacing: 2, fontSize: 10, cursor: gmailLoading ? 'not-allowed' : 'pointer' }}>
                {gmailLoading ? '⏳ SCANNING…' : '🔍 SCAN GMAIL FOR INVOICES'}
              </button>
              {gmailResults.length > 0 && (
                <button onClick={async () => { for (const row of gmailResults.filter(r => r.amount > 0)) await importGmailRow(row) }}
                  style={{ background: 'var(--kk-peach)', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 18px', fontFamily: 'var(--display)', letterSpacing: 1, fontSize: 9, cursor: 'pointer' }}>
                  + IMPORT ALL ({gmailResults.filter(r => r.amount > 0).length})
                </button>
              )}
            </div>

            {gmailResults.length > 0 && (
              <>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  {[
                    { label: 'Found', val: gmailResults.length },
                    { label: 'Invoiced', val: gmailResults.filter(r => r.status === 'invoiced').length },
                    { label: 'Received', val: gmailResults.filter(r => r.status === 'received').length },
                    { label: 'Total Value', val: fmtCAD(gmailResults.reduce((s, r) => s + (r.amount || 0), 0)) },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--bg)', borderRadius: 7, padding: '10px 14px', flex: 1 }}>
                      <div style={{ fontSize: 9, fontFamily: 'var(--display)', letterSpacing: 2, color: 'var(--ink3)', textTransform: 'uppercase' }}>{s.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--kk-green)', fontFamily: 'var(--display)' }}>{s.val}</div>
                    </div>
                  ))}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Date</th><th>Customer</th><th>Invoice #</th><th>Category</th><th>Status</th><th>Amount</th><th></th></tr></thead>
                    <tbody>
                      {gmailResults.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : 'var(--bg)' }}>
                          <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{row.date}</td>
                          <td style={{ fontWeight: 600 }}>{row.customer}</td>
                          <td style={{ fontFamily: 'var(--display)', fontSize: 10, color: 'var(--ink3)' }}>{row.invoice_number || '—'}</td>
                          <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{row.category}</td>
                          <td>
                            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontFamily: 'var(--display)', letterSpacing: 1, fontWeight: 700, background: row.status === 'received' ? '#d4edda' : '#fff3cd', color: row.status === 'received' ? '#1a5c2a' : '#6b4c00' }}>
                              {row.status === 'received' ? '✅ RECEIVED' : '📤 INVOICED'}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--kk-green)' }}>
                            {row.amount > 0 ? fmtCAD(row.amount) : <span style={{ color: 'var(--ink3)', fontWeight: 400, fontSize: 10 }}>In PDF</span>}
                          </td>
                          <td>
                            {row.amount > 0 && (
                              <button onClick={() => importGmailRow(row)} style={{ background: 'var(--kk-peach)', color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontFamily: 'var(--display)', fontSize: 9, cursor: 'pointer' }}>+ ADD</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 8 }}>ℹ️ "In PDF" means the amount is in an attachment — open the email to verify, then add manually.</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── LEDGER ── */}
      {activeTab === 'ledger' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div className="card-title" style={{ margin: 0 }}>Full Ledger</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['all', 'All'], ['revenue', 'Revenue'], ['expense', 'Expenses'], ['payroll', 'Payroll']].map(([val, label]) => (
                <button key={val} onClick={() => setTxFilter(val)} style={btnStyle(txFilter === val)}>{label}</button>
              ))}
            </div>
          </div>
          {txLoading ? <div style={{ color: 'var(--ink3)', fontSize: 12 }}>Loading…</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Vendor</th><th>Src</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {filteredTx.map((tx, i) => (
                    <tr key={tx.id} style={{ background: i % 2 === 0 ? '#fff' : 'var(--bg)' }}>
                      <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{tx.date}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontFamily: 'var(--display)', letterSpacing: 1, fontWeight: 700, background: tx.type === 'revenue' ? '#d4edda' : tx.type === 'payroll' ? '#fff3cd' : '#fde8df', color: tx.type === 'revenue' ? '#1a5c2a' : tx.type === 'payroll' ? '#6b4c00' : '#8b3a1e' }}>
                          {tx.type.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{tx.category}</td>
                      <td style={{ fontWeight: 500 }}>{tx.description}</td>
                      <td style={{ color: 'var(--ink3)' }}>{tx.vendor}</td>
                      <td title={tx.source}>{SOURCE_ICONS[tx.source] || '✏️'}</td>
                      <td style={{ fontFamily: 'var(--display)', fontWeight: 700, color: tx.type === 'revenue' ? 'var(--kk-green)' : 'var(--ink)' }}>
                        {tx.type === 'revenue' ? '+' : '−'}{fmtCAD(tx.amount)}
                      </td>
                      <td><button onClick={() => deleteTransaction(tx.id)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer' }}>🗑</button></td>
                    </tr>
                  ))}
                </tbody>
                {filteredTx.length === 0 && (
                  <tbody><tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)', fontSize: 12 }}>No entries in this range.</td></tr></tbody>
                )}
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
