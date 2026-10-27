import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx-js-style'
import { supabase } from '../lib/supabase'
import { LABOUR_PCT_OF_PRICE, SHIPPING_PCT_OF_PRICE, OTHER_PCT_OF_PRICE } from '../lib/costingAssumptions'

const EXPENSE_CATEGORIES = [
  'Raw Materials', 'Packaging', 'Kitchen Supplies', 'Rent / Utilities', 'Insurance',
  'Software / Subscriptions', 'Shipping / Logistics', 'Marketing', 'Lab / Compliance',
  'Equipment', 'Travel', 'Contract / Freelance', 'Other Expense',
]
const PRODUCT_COST_CATS = ['Raw Materials', 'Packaging']   // "product cost" in Product Costing
const SHIPPING_CAT = 'Shipping / Logistics'
const LABOUR_EXPENSE_CAT = 'Contract / Freelance'          // counted as labour alongside time-tracked payroll

// One-tap suggestions on the Monthly tab
const MONTHLY_SUGGESTIONS = [
  { name: 'Rent', category: 'Rent / Utilities' },
  { name: 'QuickBooks', category: 'Software / Subscriptions' },
  { name: 'Insurance', category: 'Insurance' },
  { name: 'Utilities', category: 'Rent / Utilities' },
  { name: 'Phone / Internet', category: 'Rent / Utilities' },
]

const SOURCE_ICONS = { manual: '✏️', receipt_photo: '📷', sourcing: '🧺', monthly: '📅' }

// Local dates (not UTC) so an evening entry never lands on "tomorrow".
const localISO = (d) => d.toLocaleDateString('en-CA')
const today = () => localISO(new Date())
function getStartDate(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return localISO(d)
}

const fmtCAD = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n, d) => (d > 0 ? (n / d) * 100 : null)
const fmtPct = (v) => (v === null || v === undefined || isNaN(v) ? '—' : v.toFixed(1) + '%')
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }

const DATE_RANGES = [
  { label: '30 Days', days: 30, months: 1 },
  { label: '3 Months', days: 90, months: 3 },
  { label: '6 Months', days: 180, months: 6 },
  { label: '12 Months', days: 365, months: 12 },
]

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
  { id: 'receipt', label: '📷 Upload Receipts' },
  { id: 'add', label: '✏️ Type One In' },
  { id: 'payroll', label: '👥 Payroll' },
  { id: 'monthly', label: '📅 Monthly' },
  { id: 'ledger', label: '📋 Ledger' },
  { id: 'pnl', label: '📊 P&L & Export' },
]

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function downloadText(filename, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Supabase returns at most 1000 rows per request — page through so a year of time entries isn't cut off.
async function fetchAll(buildQuery) {
  const out = []
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await buildQuery().range(from, from + 999)
    if (error) return { data: out, error }
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return { data: out, error: null }
}

// Same structure as Product Costing:
//   gross profit = sales − (raw materials + packaging) − labour      (≈ "gross margin")
//   net profit   = gross profit − shipping − all other expenses       (≈ "net margin")
// labour = time-tracked payroll + any "Contract / Freelance" expenses.
function computePL(txs, sales, payroll) {
  const exp = txs.filter(t => t.type === 'expense')
  const sum = (arr) => arr.reduce((s, t) => s + num(t.amount), 0)
  const rawMaterials = sum(exp.filter(t => t.category === 'Raw Materials'))
  const packaging = sum(exp.filter(t => t.category === 'Packaging'))
  const contractors = sum(exp.filter(t => t.category === LABOUR_EXPENSE_CAT))
  const labour = payroll + contractors
  const shipping = sum(exp.filter(t => t.category === SHIPPING_CAT))
  const other = sum(exp.filter(t => !PRODUCT_COST_CATS.includes(t.category) && t.category !== SHIPPING_CAT && t.category !== LABOUR_EXPENSE_CAT))
  const grossProfit = sales - rawMaterials - packaging - labour
  const netProfit = grossProfit - shipping - other
  return { sales, rawMaterials, packaging, payroll, contractors, labour, shipping, other, grossProfit, netProfit }
}

export default function Expenses() {
  const [activeTab, setActiveTab] = useState('receipt')
  const [dateRange, setDateRange] = useState(30)
  const [transactions, setTransactions] = useState([])
  const [sourcing, setSourcing] = useState([])
  const [orders, setOrders] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [employees, setEmployees] = useState([])
  const [monthly, setMonthly] = useState([])
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [txLoading, setTxLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [txFilter, setTxFilter] = useState('all')
  const [ledgerCat, setLedgerCat] = useState('all')
  const [ledgerSearch, setLedgerSearch] = useState('')
  const [includeSourcing, setIncludeSourcing] = useState(true)

  const emptyForm = { date: today(), category: '', description: '', amount: '', vendor: '', notes: '' }
  const [form, setForm] = useState(emptyForm)
  const emptyMonthly = { name: '', category: '', amount: '' }
  const [monthlyForm, setMonthlyForm] = useState(emptyMonthly)

  // Receipts
  const [receipts, setReceipts] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()


  const months = DATE_RANGES.find(r => r.days === dateRange)?.months || 1
  const rangeStart = getStartDate(dateRange)

  useEffect(() => { loadAll() }, [dateRange])

  async function loadAll() {
    setTxLoading(true)
    const [tx, src, ord, time, emps, mon] = await Promise.all([
      supabase.from('financial_transactions').select('*').gte('date', rangeStart).order('date', { ascending: false }),
      supabase.from('sourcing').select('id,date,rm_name,supplier,qty_received,unit,cost').gte('date', rangeStart).order('date', { ascending: false }),
      supabase.from('orders').select('id,dispatch_date,total_value,status').gte('dispatch_date', rangeStart),
      fetchAll(() => supabase.from('time_entries').select('employee_id, hours_worked, clock_in').gte('clock_in', rangeStart + 'T00:00:00').lte('clock_in', today() + 'T23:59:59').order('clock_in')),
      supabase.from('employees').select('*'),
      supabase.from('monthly_expenses').select('*').order('created_at'),
    ])
    setTransactions(tx.data || [])
    setSourcing(src.data || [])
    setOrders(ord.data || [])
    setTimeEntries(time.data || [])
    setEmployees(emps.data || [])
    setSetupNeeded(!!mon.error)
    setMonthly(mon.data || [])
    setTxLoading(false)
  }

  async function saveTransaction(tx) {
    const clean = { ...tx, amount: num(tx.amount), type: 'expense' }
    const { error } = await supabase.from('financial_transactions').insert([clean])
    if (error) { alert('Save failed: ' + error.message); return false }
    await loadAll()
    return true
  }

  async function deleteTransaction(tx) {
    if (tx.readonly) return alert(tx.source === 'monthly' ? 'This comes from the Monthly tab — change it there.' : 'This comes from Sourcing — change it there.')
    if (!window.confirm('Delete this entry?')) return
    await supabase.from('financial_transactions').delete().eq('id', tx.id)
    setTransactions(prev => prev.filter(t => t.id !== tx.id))
  }

  const handleSubmit = async () => {
    if (!form.description || !form.amount || !form.category) return alert('Fill in description, category, and amount.')
    setSaving(true)
    const ok = await saveTransaction({ ...form, source: 'manual' })
    if (ok) setForm(emptyForm)
    setSaving(false)
  }

  // ── Monthly (fixed) expenses ──
  async function addMonthly() {
    if (!monthlyForm.name || !monthlyForm.category || !monthlyForm.amount) return alert('Fill in name, category and monthly amount.')
    const { error } = await supabase.from('monthly_expenses').insert([{ name: monthlyForm.name, category: monthlyForm.category, amount: num(monthlyForm.amount) }])
    if (error) return alert('Could not save: ' + error.message)
    setMonthlyForm(emptyMonthly)
    await loadAll()
  }
  async function saveMonthlyAmount(m, value) {
    const v = num(value)
    if (v === num(m.amount)) return
    await supabase.from('monthly_expenses').update({ amount: v }).eq('id', m.id)
    setMonthly(prev => prev.map(x => x.id === m.id ? { ...x, amount: v } : x))
  }
  async function toggleMonthly(m) {
    await supabase.from('monthly_expenses').update({ active: !m.active }).eq('id', m.id)
    setMonthly(prev => prev.map(x => x.id === m.id ? { ...x, active: !x.active } : x))
  }
  async function deleteMonthly(m) {
    if (!window.confirm(`Delete "${m.name}"?`)) return
    await supabase.from('monthly_expenses').delete().eq('id', m.id)
    setMonthly(prev => prev.filter(x => x.id !== m.id))
  }

  // ── Derived data ──
  const sourcingTx = useMemo(() => includeSourcing
    ? sourcing.filter(s => num(s.cost) > 0).map(s => ({
        id: 'src-' + s.id, date: s.date, type: 'expense', category: 'Raw Materials',
        description: `${s.rm_name} — ${s.qty_received} ${s.unit || ''}`.trim(), vendor: s.supplier || '',
        amount: num(s.cost), source: 'sourcing', readonly: true,
      }))
    : [], [sourcing, includeSourcing])

  // Fixed monthly costs counted once per month of the selected range (30 Days = 1, 3 Months = 3, ...)
  const monthlyTx = useMemo(() => monthly.filter(m => m.active !== false).map(m => ({
    id: 'mon-' + m.id, date: today(), type: 'expense', category: m.category,
    description: `${m.name} — monthly × ${months}`, vendor: '', amount: num(m.amount) * months, source: 'monthly', readonly: true,
  })), [monthly, months])

  // Old manual payroll rows are no longer counted — payroll now comes from time tracking.
  const manualPayrollCount = transactions.filter(t => t.type === 'payroll').length
  const entryTx = useMemo(() => transactions.filter(t => t.type !== 'payroll'), [transactions])
  const inRange = useMemo(() =>
    [...entryTx, ...sourcingTx, ...monthlyTx].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [entryTx, sourcingTx, monthlyTx])

  // Payroll from time tracking: hours × hourly rate, per employee
  const payrollRows = useMemo(() => {
    const byEmp = {}
    employees.forEach(e => {
      const name = e.name || e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' ') || String(e.id).slice(0, 6)
      byEmp[e.id] = { id: e.id, name, rate: num(e.hourly_rate), hours: 0, days: new Set() }
    })
    timeEntries.forEach(t => {
      if (!byEmp[t.employee_id]) byEmp[t.employee_id] = { id: t.employee_id, name: String(t.employee_id).slice(0, 6), rate: 0, hours: 0, days: new Set() }
      byEmp[t.employee_id].hours += num(t.hours_worked)
      byEmp[t.employee_id].days.add(String(t.clock_in).slice(0, 10))
    })
    return Object.values(byEmp)
      .filter(r => r.hours > 0)
      .map(r => ({ ...r, days: r.days.size, cost: r.hours * r.rate }))
      .sort((a, b) => b.cost - a.cost)
  }, [employees, timeEntries])
  const totalPayroll = payrollRows.reduce((s, r) => s + r.cost, 0)
  const totalHours = payrollRows.reduce((s, r) => s + r.hours, 0)

  const totalExpenses = inRange.filter(t => t.type === 'expense').reduce((s, t) => s + num(t.amount), 0)
  const ordersSales = useMemo(() => orders
    .filter(o => o.dispatch_date && o.dispatch_date >= rangeStart && o.dispatch_date <= today())
    .reduce((s, o) => s + num(o.total_value), 0), [orders, rangeStart])
  const sales = ordersSales
  const pl = useMemo(() => computePL(inRange, sales, totalPayroll), [inRange, sales, totalPayroll])
  const monthlyPerMonth = monthly.filter(m => m.active !== false).reduce((s, m) => s + num(m.amount), 0)
  const netResult = sales - totalExpenses - totalPayroll

  // ── Receipts (multi-file, editable before saving) ──
  // Phone photos are huge (often 5-12 MB, sometimes HEIC) and the AI rejects anything over ~5 MB.
  // So every photo is rotated upright, shrunk to 2000px and re-saved as a JPEG before it is sent.
  const fileToBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1])
    r.onerror = () => rej(new Error('Could not read the file'))
    r.readAsDataURL(file)
  })
  const prepareImage = async (file) => {
    const MAX = 2000
    const lower = file.name.toLowerCase()
    const isHeic = /heic|heif/.test(file.type) || /\.(heic|heif)$/.test(lower)
    let bmp = null
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { bmp = null }
    if (!bmp) {
      try {
        bmp = await new Promise((res, rej) => {
          const url = URL.createObjectURL(file)
          const img = new Image()
          img.onload = () => { URL.revokeObjectURL(url); res(img) }
          img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')) }
          img.src = url
        })
      } catch { bmp = null }
    }
    if (!bmp) {
      if (isHeic) throw new Error('This browser cannot open HEIC photos. On iPhone: Settings > Camera > Formats > Most Compatible, or share the photo as JPEG.')
      if (file.size < 3.5 * 1024 * 1024 && /^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
        return { data: await fileToBase64(file), media_type: file.type }
      }
      throw new Error('Could not open this image. Try a JPG or PNG.')
    }
    const w0 = bmp.width, h0 = bmp.height
    const scale = Math.min(1, MAX / Math.max(w0, h0))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w0 * scale); canvas.height = Math.round(h0 * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    if (bmp.close) bmp.close()
    return { data: canvas.toDataURL('image/jpeg', 0.88).split(',')[1], media_type: 'image/jpeg' }
  }

  const RECEIPT_PROMPT = () => `You are reading a receipt, invoice or bill for Konscious Kitchen, a food manufacturer (baked goods) in Toronto, Canada. Today is ${today()}. All amounts are Canadian dollars unless the document clearly says otherwise.

The image may be a phone photo: crumpled, slightly rotated, dim, thermal-paper faded, or only part of a long receipt. Read carefully, rotate it mentally if needed, and use every part you can see.

Fields:
- "date": the transaction/invoice date as YYYY-MM-DD. Dates in Canada are usually DD/MM/YYYY or YYYY-MM-DD; use the context to decide. If the year is missing, assume the most recent matching date on or before today. If there is no date at all, use "${today()}".
- "vendor": the store or supplier name (the business that was paid), not the card brand or the cashier.
- "amount": the FINAL TOTAL actually paid, including tax and after discounts (look for TOTAL, AMOUNT DUE, BALANCE DUE, GRAND TOTAL, or the card/debit charge). Not the subtotal, not the amount tendered in cash, not the change. A number only, no currency symbol.
- "description": a short plain summary of what was bought (e.g. "Almond flour 25kg, coconut oil 2 tubs"). For a long list, summarise the main items.
- "category": the best fit from exactly this list: ${EXPENSE_CATEGORIES.join(', ')}. Hints: ingredients and food inputs = Raw Materials; boxes, bags, pouches, labels, tape = Packaging; gloves, cleaning, parchment, tools = Kitchen Supplies; courier, freight, delivery = Shipping / Logistics; ads, promotions, samples = Marketing; lab tests, permits, certifications = Lab / Compliance; rent, hydro, gas, water = Rent / Utilities; software, apps, subscriptions = Software / Subscriptions.
- "notes": invoice or receipt number, plus the tax amount if shown (e.g. "Inv 10234 · HST 13.00").

If a field is unreadable, use null (or "" for text). Never invent a number.

Reply with ONLY one JSON object, no markdown, no commentary:
{"date":"YYYY-MM-DD","vendor":"","amount":0,"description":"","category":"","notes":""}`

  const processReceiptFile = async (file) => {
    const id = Math.random().toString(36).slice(2)
    setReceipts(prev => [...prev, { id, name: file.name, state: 'reading', data: null }])
    const fail = (msg) => setReceipts(prev => prev.map(r => r.id === id ? { ...r, state: 'error', error: msg } : r))
    try {
      if (!process.env.REACT_APP_ANTHROPIC_KEY) return fail('The AI key (REACT_APP_ANTHROPIC_KEY) is not set in Vercel.')
      const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      let block
      if (isPDF) {
        if (file.size > 20 * 1024 * 1024) return fail('PDF is over 20 MB.')
        block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await fileToBase64(file) } }
      } else {
        const img = await prepareImage(file)
        block = { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } }
      }
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.REACT_APP_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 1500,
          messages: [{ role: 'user', content: [block, { type: 'text', text: RECEIPT_PROMPT() }] }],
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) return fail(data?.error?.message || `AI request failed (${resp.status})`)
      const text = data.content?.find(b => b.type === 'text')?.text || ''
      const m = text.match(/\{[\s\S]*\}/)
      if (!m) return fail('The AI did not return any details. Try a clearer photo.')
      const parsed = JSON.parse(m[0])
      const amt = typeof parsed.amount === 'string' ? parseFloat(parsed.amount.replace(/[^0-9.\-]/g, '')) : parsed.amount
      const d = {
        date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : today(),
        description: parsed.description || '',
        amount: Number.isFinite(amt) ? amt : '',
        vendor: parsed.vendor || '',
        category: EXPENSE_CATEGORIES.includes(parsed.category) ? parsed.category : '',
        notes: parsed.notes || '',
      }
      setReceipts(prev => prev.map(r => r.id === id ? { ...r, state: 'ready', data: d } : r))
    } catch (e) {
      fail(e?.message || 'Could not read this file.')
    }
  }
  const handleFiles = (files) => { Array.from(files || []).forEach(processReceiptFile) }
  const updateReceipt = (id, patch) => setReceipts(prev => prev.map(r => r.id === id ? { ...r, data: { ...r.data, ...patch } } : r))
  const dropReceipt = (id) => setReceipts(prev => prev.filter(r => r.id !== id))

  const isDuplicate = (d) => d && inRange.some(t =>
    t.type === 'expense' && t.date === d.date &&
    Math.abs(num(t.amount) - num(d.amount)) < 0.01 &&
    String(t.vendor || '').trim().toLowerCase() === String(d.vendor || '').trim().toLowerCase())

  const saveReceipt = async (r) => {
    if (!r.data.category || !r.data.amount) return alert('Pick a category and check the amount first.')
    setSaving(true)
    const ok = await saveTransaction({ ...r.data, source: 'receipt_photo' })
    if (ok) dropReceipt(r.id)
    setSaving(false)
  }

  // ── Export ──
  const byCategory = useMemo(() => {
    const map = {}
    inRange.filter(t => t.type === 'expense').forEach(t => {
      const k = t.category || 'Uncategorised'
      if (!map[k]) map[k] = { category: k, count: 0, total: 0 }
      map[k].count += 1; map[k].total += num(t.amount)
    })
    if (totalPayroll > 0) map['Payroll (time tracking)'] = { category: 'Payroll (time tracking)', count: payrollRows.length, total: totalPayroll }
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [inRange, totalPayroll, payrollRows])

  const ledgerHeader = ['Date', 'Type', 'Category', 'Vendor', 'Description', 'Amount (CAD)', 'Source', 'Notes']
  const ledgerRow = (t) => [t.date, t.type, t.category, t.vendor, t.description, num(t.amount), t.source || '', t.notes || '']
  const sortedLedger = () => inRange.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))

  function exportCSV() {
    const rows = [ledgerHeader, ...sortedLedger().map(ledgerRow)]
    downloadText(`KK_Ledger_${rangeStart}_to_${today()}.csv`, rows.map(r => r.map(csvEscape).join(',')).join('\r\n'))
  }
  function exportExcel() {
    const wb = XLSX.utils.book_new()
    const add = (name, aoa, widths) => {
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      if (widths) ws['!cols'] = widths.map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, ws, name)
    }
    add('P&L', [
      [`Konscious Kitchen — Profit & Loss (${rangeStart} to ${today()})`],
      ['Sales source: Orders dispatched'],
      [],
      ['Line', 'Amount (CAD)', '% of sales'],
      ['Sales', pl.sales, 100],
      ['Raw materials', -pl.rawMaterials, pct(pl.rawMaterials, pl.sales)],
      ['Packaging', -pl.packaging, pct(pl.packaging, pl.sales)],
      ['Labour (payroll + contractors)', -pl.labour, pct(pl.labour, pl.sales)],
      ['Gross profit', pl.grossProfit, pct(pl.grossProfit, pl.sales)],
      ['Shipping / Logistics', -pl.shipping, pct(pl.shipping, pl.sales)],
      ['Other expenses', -pl.other, pct(pl.other, pl.sales)],
      ['Net profit', pl.netProfit, pct(pl.netProfit, pl.sales)],
    ], [34, 16, 12])
    add('By Category', [['Category', 'Entries', 'Total (CAD)'], ...byCategory.map(c => [c.category, c.count, c.total])], [34, 10, 16])
    add('Payroll', [['Employee', 'Hours', 'Rate', 'Cost (CAD)'], ...payrollRows.map(r => [r.name, Number(r.hours.toFixed(2)), r.rate, Number(r.cost.toFixed(2))])], [28, 10, 10, 14])
    add('Ledger', [ledgerHeader, ...sortedLedger().map(ledgerRow)], [12, 10, 24, 24, 44, 14, 12, 30])
    XLSX.writeFile(wb, `KK_Expenses_${rangeStart}_to_${today()}.xlsx`)
  }

  // ── Styles ──
  const btnStyle = (active) => ({
    padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border)',
    background: active ? 'var(--kk-green)' : 'var(--surface)',
    color: active ? 'var(--kk-cream)' : 'var(--ink3)',
    cursor: 'pointer', fontSize: 10, fontFamily: 'var(--display)', letterSpacing: 1, textTransform: 'uppercase',
  })
  const tabStyle = (active) => ({
    padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer',
    fontFamily: 'var(--display)', fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase',
    color: active ? 'var(--ink)' : 'var(--ink3)',
    borderBottom: active ? '2px solid var(--kk-green)' : '2px solid transparent',
    marginBottom: -1, whiteSpace: 'nowrap',
  })
  const primaryBtn = (disabled) => ({
    background: 'var(--kk-green)', color: '#fff', border: 'none', borderRadius: 8, padding: '12px',
    fontFamily: 'var(--display)', letterSpacing: 2, fontSize: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1,
  })
  const smallBtn = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 9px', fontSize: 10, cursor: 'pointer', fontFamily: 'var(--display)', letterSpacing: 1 }

  const ledgerRows = inRange.filter(t =>
    (txFilter === 'all' || t.type === txFilter) &&
    (ledgerCat === 'all' || t.category === ledgerCat) &&
    (!ledgerSearch || `${t.description} ${t.vendor} ${t.notes}`.toLowerCase().includes(ledgerSearch.toLowerCase())))
  const ledgerCats = ['all', ...Array.from(new Set(inRange.map(t => t.category).filter(Boolean))).sort()]

  const Line = ({ label, value, bold, color, sub }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--border)', fontWeight: bold ? 700 : 400, fontSize: bold ? 14 : 12 }}>
      <span style={{ color: bold ? 'var(--ink)' : 'var(--ink2)' }}>{label}{sub && <span style={{ color: 'var(--ink3)', fontSize: 10, marginLeft: 8 }}>{sub}</span>}</span>
      <span style={{ fontFamily: 'var(--display)', color: color || 'inherit' }}>{value}</span>
    </div>
  )

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 10, letterSpacing: 3, color: 'var(--kk-peach)', textTransform: 'uppercase', marginBottom: 2 }}>Admin Only</div>
        <h2 style={{ margin: 0, fontFamily: 'var(--display)', fontSize: 22, letterSpacing: 2, color: 'var(--kk-green)' }}>EXPENSES</h2>
      </div>

      {setupNeeded && (
        <div style={{ background: '#fff3cd', border: '1px solid #e0c36a', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#6b4c00' }}>
          ⚠️ The Monthly tab needs one small database table — run <strong>step5_monthly_expenses.sql</strong> in the Supabase SQL Editor, then refresh. Everything else works meanwhile.
        </div>
      )}

      {/* Stat cards */}
      <div className="grid4" style={{ marginBottom: 20 }}>
        <div className="stat amber">
          <div className="stat-label">Total Expenses</div>
          <div className="stat-value">{fmtCAD(totalExpenses)}</div>
          <div className="stat-sub">Last {dateRange} days · incl. monthly{includeSourcing ? ' & Sourcing' : ''}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Payroll</div>
          <div className="stat-value" style={{ color: 'var(--kk-brown)' }}>{fmtCAD(totalPayroll)}</div>
          <div className="stat-sub">{totalHours.toFixed(1)} hrs from time tracking</div>
        </div>
        <div className="stat green">
          <div className="stat-label">Sales</div>
          <div className="stat-value">{fmtCAD(sales)}</div>
          <div className="stat-sub">Orders dispatched</div>
        </div>
        <div className="stat" style={{ borderTop: '3px solid ' + (netResult >= 0 ? 'var(--kk-green)' : 'var(--red)') }}>
          <div className="stat-label">Net Result</div>
          <div className="stat-value" style={{ color: netResult >= 0 ? 'var(--kk-green)' : 'var(--red)' }}>{netResult < 0 ? '−' : ''}{fmtCAD(Math.abs(netResult))}</div>
          <div className="stat-sub">Sales − expenses − payroll</div>
        </div>
      </div>

      {/* Tabs + date range */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', overflowX: 'auto', maxWidth: '100%' }}>
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

      {/* ── ADD ── */}
      {activeTab === 'add' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20 }}>
          <div className="card">
            <div className="card-title">New Expense</div>
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 12 }}>For one-off costs. Rent, QuickBooks and other regular costs go on the Monthly tab; payroll comes from time tracking.</div>
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
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel}>Vendor / Supplier</label>
                <input type="text" list="vendor-list" placeholder="e.g. Tootsi Impex" value={form.vendor} onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))} style={inputStyle} />
                <datalist id="vendor-list">
                  {Array.from(new Set(inRange.map(t => t.vendor).filter(Boolean))).sort().map(v => <option key={v} value={v} />)}
                </datalist>
              </div>
              <div>
                <label style={fieldLabel}>Description</label>
                <input type="text" placeholder="Brief description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={fieldLabel}>Notes (optional)</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
              <button onClick={handleSubmit} disabled={saving} style={primaryBtn(saving)}>{saving ? 'SAVING…' : '+ SAVE EXPENSE'}</button>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Expense Breakdown <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>— last {dateRange} days</span></div>
            {txLoading ? <div style={{ color: 'var(--ink3)', fontSize: 12 }}>Loading…</div> : (() => {
              const total = byCategory.reduce((s, c) => s + c.total, 0)
              if (byCategory.length === 0) return <div style={{ color: 'var(--ink3)', fontSize: 12 }}>No expenses recorded yet.</div>
              return byCategory.map(c => (
                <div key={c.category} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{c.category}</span>
                    <span style={{ fontFamily: 'var(--display)', color: 'var(--kk-brown)' }}>{fmtCAD(c.total)} <span style={{ color: 'var(--ink3)', fontSize: 10 }}>({(c.total / total * 100).toFixed(0)}%)</span></span>
                  </div>
                  <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (c.total / total * 100) + '%', background: 'var(--kk-peach)', borderRadius: 3 }} />
                  </div>
                </div>
              ))
            })()}
          </div>
        </div>
      )}

      {/* ── RECEIPTS ── */}
      {activeTab === 'receipt' && (
        <div style={{ maxWidth: 720 }}>
          <div className="card">
            <div className="card-title">📷 Receipt / Invoice Capture</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 16 }}>Upload one or several photos or PDFs. AI reads vendor, date, total and category — check each one, fix anything, then save.</div>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
              onClick={() => fileRef.current.click()}
              style={{ border: `2px dashed ${dragOver ? 'var(--kk-green)' : 'var(--kk-peach)'}`, borderRadius: 10, padding: 36, textAlign: 'center', cursor: 'pointer', background: dragOver ? '#f0f5f0' : 'var(--bg)', transition: 'all 0.2s', marginBottom: 16 }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>🧾</div>
              <div style={{ fontFamily: 'var(--display)', letterSpacing: 1, fontSize: 10, color: 'var(--kk-green)' }}>DROP RECEIPTS HERE OR CLICK TO UPLOAD</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4 }}>JPG · PNG · HEIC · PDF · several at once is fine</div>
            </div>
            <input ref={fileRef} type="file" accept="image/*,.pdf,application/pdf" multiple style={{ display: 'none' }} onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />

            {receipts.map(r => (
              <div key={r.id} style={{ background: '#f0f5f0', borderRadius: 8, padding: 14, border: '1.5px solid var(--kk-green)', marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--display)', fontSize: 10, letterSpacing: 2, color: 'var(--kk-green)', marginBottom: 10 }}>
                  <span>{r.state === 'reading' ? '⏳ READING…' : r.state === 'error' ? '❌ COULD NOT READ' : '✅ EXTRACTED'} — {r.name}</span>
                  <button onClick={() => dropReceipt(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink3)' }}>✕</button>
                </div>
                {r.state === 'error' && <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{r.error ? r.error + ' — ' : ''}Try again, or enter it on the Type One In tab.</div>}
                {r.state === 'ready' && (
                  <>
                    {isDuplicate(r.data) && <div style={{ background: '#fff3cd', border: '1px solid #e0c36a', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#6b4c00', marginBottom: 10 }}>⚠️ An expense with the same vendor, date and amount already exists — this may be a duplicate.</div>}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div><label style={fieldLabel}>Date</label><input type="date" value={r.data.date} onChange={e => updateReceipt(r.id, { date: e.target.value })} style={inputStyle} /></div>
                      <div><label style={fieldLabel}>Total (CAD)</label><input type="number" value={r.data.amount} onChange={e => updateReceipt(r.id, { amount: e.target.value })} style={inputStyle} /></div>
                      <div><label style={fieldLabel}>Vendor</label><input type="text" value={r.data.vendor} onChange={e => updateReceipt(r.id, { vendor: e.target.value })} style={inputStyle} /></div>
                      <div style={{ gridColumn: 'span 2' }}><label style={fieldLabel}>Description</label><input type="text" value={r.data.description} onChange={e => updateReceipt(r.id, { description: e.target.value })} style={inputStyle} /></div>
                      <div><label style={fieldLabel}>Category</label>
                        <select value={r.data.category} onChange={e => updateReceipt(r.id, { category: e.target.value })} style={inputStyle}>
                          <option value="">Select…</option>
                          {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => saveReceipt(r)} disabled={saving} style={{ ...primaryBtn(saving), flex: 1, padding: '10px', fontSize: 9, letterSpacing: 1 }}>+ SAVE TO LEDGER</button>
                      <button onClick={() => dropReceipt(r.id)} style={{ flex: 1, background: 'var(--border)', color: 'var(--ink)', border: 'none', borderRadius: 6, padding: '10px', fontFamily: 'var(--display)', letterSpacing: 1, fontSize: 9, cursor: 'pointer' }}>DISCARD</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PAYROLL (from time tracking) ── */}
      {activeTab === 'payroll' && (
        <div className="card">
          <div className="card-title">Payroll from Time Tracking <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>— last {dateRange} days</span></div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 14 }}>Hours clocked in the Time Tracking page × each person's hourly rate — the same numbers the Dashboard uses. Nothing to type in here.</div>
          {txLoading ? <div style={{ color: 'var(--ink3)', fontSize: 12 }}>Loading…</div> : payrollRows.length === 0 ? (
            <div style={{ color: 'var(--ink3)', fontSize: 12 }}>No clocked hours in this range.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Employee</th><th>Days worked</th><th>Hours</th><th>Hourly rate</th><th>Cost</th></tr></thead>
                <tbody>
                  {payrollRows.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td style={{ color: 'var(--ink3)' }}>{r.days}</td>
                      <td>{r.hours.toFixed(1)}</td>
                      <td style={{ color: r.rate ? 'inherit' : 'var(--red)' }}>{r.rate ? fmtCAD(r.rate) : 'No rate set'}</td>
                      <td style={{ fontFamily: 'var(--display)', color: 'var(--kk-brown)', fontWeight: 700 }}>{fmtCAD(r.cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                    <td colSpan={2} style={{ fontFamily: 'var(--display)', fontSize: 12, letterSpacing: 1 }}>TOTAL</td>
                    <td style={{ fontWeight: 700 }}>{totalHours.toFixed(1)}</td>
                    <td></td>
                    <td style={{ fontFamily: 'var(--display)', color: 'var(--kk-green)', fontSize: 14 }}>{fmtCAD(totalPayroll)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 12 }}>
            Contractors and owner draws aren't clocked — add them as an expense under "Contract / Freelance" and they're counted as labour in the P&amp;L.
            {manualPayrollCount > 0 && <> {manualPayrollCount} older manually-entered payroll row{manualPayrollCount === 1 ? '' : 's'} in this range {manualPayrollCount === 1 ? 'is' : 'are'} no longer counted, so payroll isn't doubled.</>}
          </div>
        </div>
      )}

      {/* ── MONTHLY ── */}
      {activeTab === 'monthly' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20 }}>
          <div className="card">
            <div className="card-title">Add a Monthly Expense</div>
            <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 12 }}>Fixed costs that repeat every month. Enter the amount once — it's counted automatically for every month in the selected range.</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {MONTHLY_SUGGESTIONS.map(s => (
                <button key={s.name} onClick={() => setMonthlyForm(p => ({ ...p, name: s.name, category: s.category }))} style={smallBtn}>{s.name}</button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div><label style={fieldLabel}>Name</label><input type="text" placeholder="e.g. Rent" value={monthlyForm.name} onChange={e => setMonthlyForm(p => ({ ...p, name: e.target.value }))} style={inputStyle} /></div>
              <div><label style={fieldLabel}>Category</label>
                <select value={monthlyForm.category} onChange={e => setMonthlyForm(p => ({ ...p, category: e.target.value }))} style={inputStyle}>
                  <option value="">Select…</option>
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><label style={fieldLabel}>Amount per month (CAD)</label><input type="number" placeholder="0.00" value={monthlyForm.amount} onChange={e => setMonthlyForm(p => ({ ...p, amount: e.target.value }))} style={inputStyle} /></div>
              <button onClick={addMonthly} disabled={setupNeeded} style={primaryBtn(setupNeeded)}>+ ADD MONTHLY EXPENSE</button>
            </div>
          </div>
          <div className="card">
            <div className="card-title">Monthly Expenses {monthly.length > 0 && <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>— {fmtCAD(monthlyPerMonth)} per month</span>}</div>
            {monthly.length === 0 ? <div style={{ color: 'var(--ink3)', fontSize: 12 }}>None yet — tap Rent, QuickBooks or Insurance on the left to start.</div> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Category</th><th>Per month</th><th>In last {dateRange} days</th><th></th></tr></thead>
                  <tbody>
                    {monthly.map(m => (
                      <tr key={m.id} style={{ opacity: m.active === false ? 0.45 : 1 }}>
                        <td style={{ fontWeight: 500 }}>{m.name}</td>
                        <td style={{ fontSize: 11, color: 'var(--ink3)' }}>{m.category}</td>
                        <td><input type="number" step="0.01" defaultValue={m.amount} onBlur={e => saveMonthlyAmount(m, e.target.value)} style={{ ...inputStyle, width: 100, textAlign: 'right' }} /></td>
                        <td style={{ fontFamily: 'var(--display)', fontWeight: 700 }}>{m.active === false ? '—' : fmtCAD(num(m.amount) * months)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button onClick={() => toggleMonthly(m)} style={smallBtn}>{m.active === false ? 'Resume' : 'Pause'}</button>{' '}
                          <button onClick={() => deleteMonthly(m)} style={{ ...smallBtn, color: 'var(--red)' }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── LEDGER ── */}
      {activeTab === 'ledger' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div className="card-title" style={{ margin: 0 }}>Full Ledger <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>— {ledgerRows.length} entries</span></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['all', 'All'], ['revenue', 'Revenue'], ['expense', 'Expenses']].map(([val, label]) => (
                <button key={val} onClick={() => setTxFilter(val)} style={btnStyle(txFilter === val)}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <input placeholder="Search description, vendor, notes…" value={ledgerSearch} onChange={e => setLedgerSearch(e.target.value)} style={{ ...inputStyle, width: 260 }} />
            <select value={ledgerCat} onChange={e => setLedgerCat(e.target.value)} style={{ ...inputStyle, width: 200 }}>
              {ledgerCats.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ink3)', marginBottom: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={includeSourcing} onChange={e => setIncludeSourcing(e.target.checked)} />
            Include ingredient purchases from Sourcing 🧺 as Raw Materials (automatic). Turn off if you also log the same supplier bills here, so they aren't counted twice.
          </label>
          {txLoading ? <div style={{ color: 'var(--ink3)', fontSize: 12 }}>Loading…</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Vendor</th><th>Src</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  {ledgerRows.map((tx, i) => (
                    <tr key={tx.id} style={{ background: i % 2 === 0 ? '#fff' : 'var(--bg)' }}>
                      <td style={{ color: 'var(--ink3)', fontSize: 11 }}>{tx.date}</td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontFamily: 'var(--display)', letterSpacing: 1, fontWeight: 700, background: tx.type === 'revenue' ? '#d4edda' : '#fde8df', color: tx.type === 'revenue' ? '#1a5c2a' : '#8b3a1e' }}>
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
                      <td>{tx.readonly ? <span title={tx.source === 'monthly' ? 'From the Monthly tab' : 'From Sourcing'} style={{ color: '#ccc' }}>🔒</span> : <button onClick={() => deleteTransaction(tx)} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer' }}>🗑</button>}</td>
                    </tr>
                  ))}
                </tbody>
                {ledgerRows.length === 0 && (
                  <tbody><tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--ink3)', fontSize: 12 }}>No entries in this range.</td></tr></tbody>
                )}
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── P&L & EXPORT ── */}
      {activeTab === 'pnl' && (
        <div style={{ display: 'grid', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div className="card-title" style={{ margin: 0 }}>Profit &amp; Loss <span style={{ color: 'var(--ink3)', fontWeight: 400 }}>— last {dateRange} days</span></div>
              </div>
              <Line label="Sales" value={fmtCAD(pl.sales)} bold sub="orders dispatched up to today" />
              <Line label="Raw materials" value={'−' + fmtCAD(pl.rawMaterials)} sub={fmtPct(pct(pl.rawMaterials, pl.sales)) + ' of sales'} />
              <Line label="Packaging" value={'−' + fmtCAD(pl.packaging)} sub={fmtPct(pct(pl.packaging, pl.sales)) + ' of sales'} />
              <Line label="Labour (payroll + contractors)" value={'−' + fmtCAD(pl.labour)} sub={fmtPct(pct(pl.labour, pl.sales)) + ' of sales'} />
              <Line label="Gross profit" value={(pl.grossProfit < 0 ? '−' : '') + fmtCAD(Math.abs(pl.grossProfit))} bold color={pl.grossProfit < 0 ? 'var(--red)' : 'var(--kk-green)'} sub={fmtPct(pct(pl.grossProfit, pl.sales)) + ' gross margin'} />
              <Line label="Shipping / Logistics" value={'−' + fmtCAD(pl.shipping)} sub={fmtPct(pct(pl.shipping, pl.sales)) + ' of sales'} />
              <Line label="Other (rent, insurance, software, …)" value={'−' + fmtCAD(pl.other)} sub={fmtPct(pct(pl.other, pl.sales)) + ' of sales'} />
              <Line label="Net profit" value={(pl.netProfit < 0 ? '−' : '') + fmtCAD(Math.abs(pl.netProfit))} bold color={pl.netProfit < 0 ? 'var(--red)' : 'var(--kk-green)'} sub={fmtPct(pct(pl.netProfit, pl.sales)) + ' net margin'} />
            </div>

            <div className="card">
              <div className="card-title">Costing assumptions vs actual</div>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 12 }}>The rates Product Costing uses, against what you actually spent over the same period.</div>
              {[
                { label: 'Labour', assumed: LABOUR_PCT_OF_PRICE * 100, actual: pct(pl.labour, pl.sales) },
                { label: 'Shipping / Logistics', assumed: SHIPPING_PCT_OF_PRICE * 100, actual: pct(pl.shipping, pl.sales) },
                { label: 'Other costs', assumed: OTHER_PCT_OF_PRICE * 100, actual: pct(pl.other, pl.sales) },
              ].map(r => {
                const diff = r.actual === null ? null : r.actual - r.assumed
                const bad = diff !== null && diff > 1
                return (
                  <div key={r.label} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ fontWeight: 600 }}>{r.label}</span>
                      <span style={{ fontFamily: 'var(--display)', color: bad ? 'var(--red)' : 'var(--kk-green)' }}>{fmtPct(r.actual)} actual</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>
                      Costing assumes {r.assumed.toFixed(0)}%
                      {diff !== null && <> · <span style={{ color: bad ? 'var(--red)' : 'var(--ink3)' }}>{diff > 0 ? '+' : ''}{diff.toFixed(1)} pts {bad ? '— higher than assumed' : diff < -1 ? '— lower than assumed' : '— in line'}</span></>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="card" style={{ maxWidth: 640 }}>
            <div className="card-title">📤 Export for your accountant</div>
            <div style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 14 }}>Everything in the selected date range (<strong>{rangeStart}</strong> to <strong>{today()}</strong>) — change the range with the buttons at the top.</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={exportExcel} style={{ ...primaryBtn(false), padding: '12px 20px' }}>📊 DOWNLOAD EXCEL PACK</button>
              <button onClick={exportCSV} style={{ ...primaryBtn(false), padding: '12px 20px', background: 'var(--kk-peach)' }}>⬇ LEDGER CSV</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink3)' }}>The Excel pack has four sheets: P&amp;L, By Category, Payroll (per employee) and the full Ledger.</div>
          </div>
        </div>
      )}
    </div>
  )
}
