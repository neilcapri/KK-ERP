import { useState } from 'react'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'

// ── Product column definitions ────────────────────────────────
const RETAIL_COLS = [
  // Muffins
  { code: 'PBB', label: 'PBB' },
  { code: 'PCC', label: 'PCC' },
  { code: 'KLR', label: 'KLR' },
  // Natures Private Label
  { code: 'NALCO-S', label: 'NACo Single' },
  { code: 'NALCO-D', label: 'NACo Double' },
  { code: 'NALCOB', label: 'NALCOB' },
  { code: 'NBFB', label: 'NBFB' },
  // Whole Cakes
  { code: 'TRFC', label: 'WTC' },
  { code: 'KLRCKE', label: 'KLRCKE' },
  { code: 'KCCKE', label: 'KCC' },
  // Bread & Loaves
  { code: 'PVFB', label: 'PFB' },
  { code: 'PVBB', label: 'PVBB' },
  { code: 'KPL', label: 'KPL' },
  { code: 'GBL', label: 'GBL' },
  // Doughnuts
  { code: 'KSCD', label: 'KSCD' },
  { code: 'VPBD', label: 'VPBD' },
  { code: 'KHD', label: 'KHD' },
  // Tarts
  { code: 'PCrt', label: 'PCrt' },
  // Cake Slices
  { code: 'VSCS', label: 'VSCS' },
  { code: 'TRFCS', label: 'TRFCS' },
  { code: 'HRCS', label: 'HRCS' },
  // Cookies
  { code: 'POS', label: 'POS' },
  { code: 'PGCo', label: 'PGCo' },
  { code: 'PVHC', label: 'PVHC' },
  { code: 'HPCo', label: 'HPCo' },
  { code: 'KCOC', label: 'KCCo' },
  { code: 'KSCO', label: 'KSCo' },
  { code: 'KAB', label: 'KAB' },
  { code: 'KWAL', label: 'KWAL' },
  { code: 'KABIS', label: 'KABIS' },
  // Brownies & Bars
  { code: 'PVBRG', label: 'PVBRG' },
  { code: 'PVBR', label: 'PVBr' },
  { code: 'VPCAN', label: 'VPCAN' },
  { code: 'PNF', label: 'PNF' },
  { code: 'VPB', label: 'VPB' },
  // Mini Cakes
  { code: 'TMC', label: 'TMC' },
  { code: 'PRMC', label: 'PRMC' },
  { code: 'CMC', label: 'CMC' },
  { code: 'LMC', label: 'LMC' },
  // New
  { code: 'CCB', label: 'CCB' },
  { code: 'SFNL', label: 'SFNL' },
  { code: 'CCBS', label: 'CCBS' },
  // Cake Cups
  { code: 'CCKCU', label: 'Carrot Cup' },
  { code: 'LCKCU', label: 'Lemon Cup' },
  { code: 'KSCKCU', label: 'Strawberry Cup' },
  { code: 'TCKCU', label: 'Truffle Cup' },
]

const BULK_COLS = [
  { code: 'KCC', label: 'Keto Choc Cup' },
  { code: 'KVC', label: 'Keto Van Cup' },
  { code: 'KLRCup', label: 'KLR Cup' },
  { code: 'CKAC', label: 'Almond Choc Cup' },
  { code: 'CKHH', label: 'Hazelnut Cup' },
  { code: 'PVBB', label: 'Banana Bread' },
  { code: 'PVBBSL', label: 'BB Slice Unfrost' },
  { code: 'PVBBSLF', label: 'BB Slice Frost' },
  { code: 'KAB', label: 'KAB' },
  { code: 'KWAL', label: 'KWAL' },
  { code: 'HPCo', label: 'HPCo' },
  { code: 'PVHC', label: 'PVHC' },
  { code: 'VPCAN', label: 'Pecan Bars' },
  { code: 'VPB', label: 'Pistachio Bars' },
  { code: 'PNF', label: "No'tella Bars" },
]

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const BULK_CODES = new Set(BULK_COLS.map(c => c.code))

const KK_GREEN = '223824'
const KK_PEACH = 'E79B81'
const LIGHT_GREEN = 'D6E0D4'
const TOTAL_BG = 'C8E6C9'

function buildRetailSheet(wb, orders, includePricing, weekLabel) {
  const ws = XLSX.utils.aoa_to_sheet([])
  
  const title = `KONSCIOUS KITCHEN — ORDER SHEET${weekLabel ? ' — ' + weekLabel : ''}`
  const numCols = RETAIL_COLS.length + 1 + (includePricing ? 1 : 0)

  // Build rows
  const rows = []
  
  // Row 1: Title
  const titleRow = [title]
  rows.push(titleRow)

  // Row 2: Category groups
  const catRow = ['']
  const categories = [
    [3, 'MUFFINS'], [4, 'NATURES PL'], [4, ''], [8, 'WHOLE CAKES'],
    [4, 'BREAD & LOAVES'], [3, 'DOUGHNUTS'], [1, 'TARTS'], [3, 'CAKE SLICES'],
    [9, 'COOKIES'], [5, 'BARS'], [4, 'MINI CAKES'], [3, 'NEW'], [4, 'CAKE CUPS']
  ]
  for (const [count, label] of categories) {
    catRow.push(label)
    for (let i = 1; i < count; i++) catRow.push('')
  }
  rows.push(catRow)

  // Row 3: Column headers
  const headerRow = ['Store']
  for (const col of RETAIL_COLS) headerRow.push(`${col.label}\n(${col.code})`)
  if (includePricing) headerRow.push('ORDER VALUE')
  rows.push(headerRow)

  // Group by day
  const byDay = {}
  for (const o of orders) {
    const day = o.delivery_day || 'Unknown'
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(o)
  }

  const merges = []
  const styles = {}
  let rowIdx = 3 // 0-indexed, row 3 = index 3

  for (const day of DAYS) {
    const dayOrders = byDay[day] || []
    if (!dayOrders.length) continue

    // Day header row
    const dayRow = [day.toUpperCase()]
    for (let i = 1; i < numCols; i++) dayRow.push('')
    rows.push(dayRow)
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: numCols - 1 } })
    rowIdx++

    const storeStart = rowIdx

    for (const order of dayOrders) {
      const items = order.order_items || []
      const qtyMap = {}
      // value calc mirrors Orders.jsx's own total_value logic: packs × price_per_pack
      // for pack items (item.packs is null for bulk items, where quantity is the multiplier).
      for (const item of items) {
        if (item.product_code) {
          qtyMap[item.product_code] = (qtyMap[item.product_code] || 0) + (item.quantity || 0)
        }
      }

      const storeRow = [order.customer_name]
      const rowTotal = items.reduce((sum, item) => {
        const price = parseFloat(item.price_per_pack || 0)
        const multiplier = item.packs !== null && item.packs !== undefined ? item.packs : (item.quantity || 0)
        return sum + multiplier * price
      }, 0)
      for (const col of RETAIL_COLS) {
        const qty = qtyMap[col.code]
        storeRow.push(qty || null)
      }
      if (includePricing) storeRow.push(rowTotal > 0 ? rowTotal : null)
      rows.push(storeRow)
      rowIdx++
    }

    // Total row
    const totalRow = ['TOTAL']
    for (let ci = 0; ci < RETAIL_COLS.length; ci++) {
      const colLetter = XLSX.utils.encode_col(ci + 1)
      totalRow.push({ f: `SUM(${colLetter}${storeStart + 1}:${colLetter}${rowIdx})` })
    }
    if (includePricing) {
      const valCol = XLSX.utils.encode_col(RETAIL_COLS.length + 1)
      totalRow.push({ f: `SUM(${valCol}${storeStart + 1}:${valCol}${rowIdx})` })
    }
    rows.push(totalRow)
    rowIdx += 2 // total + blank
  }

  XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A1' })
  ws['!merges'] = merges

  // Column widths
  const colWidths = [{ wch: 30 }]
  for (let i = 0; i < RETAIL_COLS.length; i++) colWidths.push({ wch: 7 })
  if (includePricing) colWidths.push({ wch: 14 })
  ws['!cols'] = colWidths

  // Row heights
  ws['!rows'] = [{ hpt: 20 }, { hpt: 16 }, { hpt: 50 }]

  XLSX.utils.book_append_sheet(wb, ws, 'Retail Packs')
}

function buildBulkSheet(wb, orders, weekLabel) {
  const ws = XLSX.utils.aoa_to_sheet([])
  const title = `KONSCIOUS KITCHEN — BULK ORDERS${weekLabel ? ' — ' + weekLabel : ''}`

  const rows = []
  rows.push([title])

  const headerRow = ['Store']
  for (const col of BULK_COLS) headerRow.push(`${col.label}\n(${col.code})`)
  rows.push(headerRow)

  const byDay = {}
  for (const o of orders) {
    const day = o.delivery_day || 'Unknown'
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(o)
  }

  const merges = []
  let rowIdx = 2

  for (const day of DAYS) {
    const dayOrders = (byDay[day] || []).filter(o =>
      (o.order_items || []).some(item => BULK_CODES.has(item.product_code))
    )
    if (!dayOrders.length) continue

    const dayRow = [day.toUpperCase()]
    for (let i = 1; i <= BULK_COLS.length; i++) dayRow.push('')
    rows.push(dayRow)
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: BULK_COLS.length } })
    rowIdx++

    const storeStart = rowIdx

    for (const order of dayOrders) {
      const items = order.order_items || []
      const qtyMap = {}
      for (const item of items) {
        if (item.product_code) qtyMap[item.product_code] = (qtyMap[item.product_code] || 0) + (item.quantity || 0)
      }
      const storeRow = [order.customer_name]
      for (const col of BULK_COLS) storeRow.push(qtyMap[col.code] || null)
      rows.push(storeRow)
      rowIdx++
    }

    // Totals
    const totalRow = ['TOTAL']
    for (let ci = 0; ci < BULK_COLS.length; ci++) {
      const colLetter = XLSX.utils.encode_col(ci + 1)
      totalRow.push({ f: `SUM(${colLetter}${storeStart + 1}:${colLetter}${rowIdx})` })
    }
    rows.push(totalRow)
    rowIdx += 2
  }

  XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A1' })
  ws['!merges'] = merges

  const colWidths = [{ wch: 30 }]
  for (let i = 0; i < BULK_COLS.length; i++) colWidths.push({ wch: 10 })
  ws['!cols'] = colWidths
  ws['!rows'] = [{ hpt: 20 }, { hpt: 50 }]

  XLSX.utils.book_append_sheet(wb, ws, 'Bulk Orders')
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function buildRetailHTML(orders, includePricing, weekLabel) {
  const byDay = {}
  for (const o of orders) {
    const day = o.delivery_day || 'Unknown'
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(o)
  }

  const categories = [
    [3, 'MUFFINS'], [4, 'NATURES PL'], [4, ''], [8, 'WHOLE CAKES'],
    [4, 'BREAD & LOAVES'], [3, 'DOUGHNUTS'], [1, 'TARTS'], [3, 'CAKE SLICES'],
    [9, 'COOKIES'], [5, 'BARS'], [4, 'MINI CAKES'], [3, 'NEW'], [4, 'CAKE CUPS']
  ]
  const catCells = categories.map(([count, label]) => `<th colspan="${count}" class="cat">${escapeHtml(label)}</th>`).join('')

  let colCells = RETAIL_COLS.map(c => `<th>${escapeHtml(c.label)}<br><span class="code">(${escapeHtml(c.code)})</span></th>`).join('')
  if (includePricing) colCells += `<th>ORDER VALUE</th>`

  const numCols = RETAIL_COLS.length + 1 + (includePricing ? 1 : 0)
  let bodyRows = ''

  for (const day of DAYS) {
    const dayOrders = byDay[day] || []
    if (!dayOrders.length) continue

    bodyRows += `<tr class="day-row"><td colspan="${numCols}">${escapeHtml(day.toUpperCase())}</td></tr>`

    const colTotals = new Array(RETAIL_COLS.length).fill(0)
    let valueTotal = 0

    for (const order of dayOrders) {
      const items = order.order_items || []
      const qtyMap = {}
      for (const item of items) {
        if (item.product_code) qtyMap[item.product_code] = (qtyMap[item.product_code] || 0) + (item.quantity || 0)
      }
      const rowTotal = items.reduce((sum, item) => {
        const price = parseFloat(item.price_per_pack || 0)
        const multiplier = item.packs !== null && item.packs !== undefined ? item.packs : (item.quantity || 0)
        return sum + multiplier * price
      }, 0)
      valueTotal += rowTotal

      let rowCells = `<td class="store">${escapeHtml(order.customer_name)}</td>`
      RETAIL_COLS.forEach((col, i) => {
        const qty = qtyMap[col.code]
        if (qty) colTotals[i] += qty
        rowCells += `<td>${qty || ''}</td>`
      })
      if (includePricing) rowCells += `<td>${rowTotal > 0 ? '$' + rowTotal.toFixed(2) : ''}</td>`
      bodyRows += `<tr>${rowCells}</tr>`
    }

    let totalCells = `<td class="total-label">TOTAL</td>`
    colTotals.forEach(t => { totalCells += `<td>${t || ''}</td>` })
    if (includePricing) totalCells += `<td>$${valueTotal.toFixed(2)}</td>`
    bodyRows += `<tr class="total-row">${totalCells}</tr>`
    bodyRows += `<tr class="spacer"><td colspan="${numCols}"></td></tr>`
  }

  return `
    <h1>KONSCIOUS KITCHEN — ORDER SHEET${weekLabel ? ' — ' + escapeHtml(weekLabel) : ''}</h1>
    <table class="ordersheet">
      <thead>
        <tr><th class="store-head"></th>${catCells}</tr>
        <tr><th>Store</th>${colCells}</tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`
}

function buildBulkHTML(orders, weekLabel) {
  const byDay = {}
  for (const o of orders) {
    const day = o.delivery_day || 'Unknown'
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(o)
  }

  const colCells = BULK_COLS.map(c => `<th>${escapeHtml(c.label)}<br><span class="code">(${escapeHtml(c.code)})</span></th>`).join('')
  const numCols = BULK_COLS.length + 1
  let bodyRows = ''

  for (const day of DAYS) {
    const dayOrders = (byDay[day] || []).filter(o => (o.order_items || []).some(item => BULK_CODES.has(item.product_code)))
    if (!dayOrders.length) continue

    bodyRows += `<tr class="day-row"><td colspan="${numCols}">${escapeHtml(day.toUpperCase())}</td></tr>`

    const colTotals = new Array(BULK_COLS.length).fill(0)

    for (const order of dayOrders) {
      const items = order.order_items || []
      const qtyMap = {}
      for (const item of items) {
        if (item.product_code) qtyMap[item.product_code] = (qtyMap[item.product_code] || 0) + (item.quantity || 0)
      }
      let rowCells = `<td class="store">${escapeHtml(order.customer_name)}</td>`
      BULK_COLS.forEach((col, i) => {
        const qty = qtyMap[col.code]
        if (qty) colTotals[i] += qty
        rowCells += `<td>${qty || ''}</td>`
      })
      bodyRows += `<tr>${rowCells}</tr>`
    }

    let totalCells = `<td class="total-label">TOTAL</td>`
    colTotals.forEach(t => { totalCells += `<td>${t || ''}</td>` })
    bodyRows += `<tr class="total-row">${totalCells}</tr>`
    bodyRows += `<tr class="spacer"><td colspan="${numCols}"></td></tr>`
  }

  return `
    <h1>KONSCIOUS KITCHEN — BULK ORDERS${weekLabel ? ' — ' + escapeHtml(weekLabel) : ''}</h1>
    <table class="ordersheet">
      <thead><tr><th>Store</th>${colCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`
}

function buildOrderSheetPage(orders, includePricing, weekLabel) {
  const retailHTML = buildRetailHTML(orders, includePricing, weekLabel)
  const bulkHTML = buildBulkHTML(orders, weekLabel)
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>KK Order Sheet — ${escapeHtml(weekLabel)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; background: #E3DDD1; margin: 0; padding: 24px; color: #223824; }
  h1 { font-size: 16px; letter-spacing: 1px; margin: 24px 0 8px; text-transform: uppercase; }
  table.ordersheet { border-collapse: collapse; width: 100%; margin-bottom: 32px; background: #fff; }
  table.ordersheet th, table.ordersheet td { border: 1px solid #ccc; padding: 4px 6px; font-size: 11px; text-align: center; white-space: pre-line; }
  table.ordersheet th.cat { background: #223824; color: #E3DDD1; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
  table.ordersheet thead tr:last-child th { background: #E79B81; color: #223824; font-weight: 700; }
  table.ordersheet .code { font-size: 9px; color: #666; }
  table.ordersheet td.store, table.ordersheet th.store-head { text-align: left; font-weight: 600; min-width: 160px; white-space: normal; }
  table.ordersheet tr.day-row td { background: #223824; color: #fff; font-weight: 700; text-align: left; padding: 6px 8px; letter-spacing: 1px; }
  table.ordersheet tr.total-row td { background: #C8E6C9; font-weight: 700; }
  table.ordersheet tr.total-row td.total-label { text-align: left; }
  table.ordersheet tr.spacer td { border: none; padding: 4px; background: transparent; }
  .print-bar { margin-bottom: 16px; }
  .print-bar button { background: #223824; color: #E3DDD1; border: none; padding: 8px 16px; border-radius: 6px; font-size: 13px; cursor: pointer; }
  @media print { .print-bar { display: none; } body { background: #fff; padding: 0; } }
</style>
</head>
<body>
  <div class="print-bar"><button onclick="window.print()">🖨️ Print / Save as PDF</button></div>
  ${retailHTML}
  ${bulkHTML}
</body>
</html>`
}

export default function OrderSheetExport() {
  const [loading, setLoading] = useState(false)
  const [count, setCount] = useState(null)

  async function fetchOrderSheetOrders() {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('status', 'order_sheet')
      .order('delivery_day', { ascending: true })
    return data || []
  }

  function getWeekLabel() {
    const now = new Date()
    const month = now.toLocaleString('en-CA', { month: 'long' })
    return `${month} ${now.getFullYear()}`
  }

  async function exportFull() {
    setLoading(true)
    try {
      const orders = await fetchOrderSheetOrders()
      setCount(orders.length)
      const weekLabel = getWeekLabel()
      const wb = XLSX.utils.book_new()
      buildRetailSheet(wb, orders, true, weekLabel)
      buildBulkSheet(wb, orders, weekLabel)
      XLSX.writeFile(wb, `KK_Order_Sheet_${weekLabel.replace(' ', '_')}_FULL.xlsx`)
    } catch(err) {
      alert('Export failed: ' + err.message)
    }
    setLoading(false)
  }

  async function exportTeam() {
    setLoading(true)
    try {
      const orders = await fetchOrderSheetOrders()
      const weekLabel = getWeekLabel()
      const wb = XLSX.utils.book_new()
      buildRetailSheet(wb, orders, false, weekLabel)
      buildBulkSheet(wb, orders, weekLabel)
      XLSX.writeFile(wb, `KK_Order_Sheet_${weekLabel.replace(' ', '_')}_TEAM.xlsx`)
    } catch(err) {
      alert('Export failed: ' + err.message)
    }
    setLoading(false)
  }

  async function viewInBrowser(includePricing) {
    setLoading(true)
    try {
      const orders = await fetchOrderSheetOrders()
      setCount(orders.length)
      const weekLabel = getWeekLabel()
      const html = buildOrderSheetPage(orders, includePricing, weekLabel)
      const win = window.open('', '_blank')
      if (!win) { alert('Please allow pop-ups to view the order sheet in your browser.'); setLoading(false); return }
      win.document.open()
      win.document.write(html)
      win.document.close()
    } catch(err) {
      alert('View failed: ' + err.message)
    }
    setLoading(false)
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">
        📊 Order Sheet Export
        {count !== null && <span style={{ color: 'var(--ink3)', fontSize: 11 }}>{count} orders in sheet</span>}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 16 }}>
        Exports all orders with status <strong>Order Sheet</strong> into the weekly Excel format.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-green" onClick={exportFull} disabled={loading}>
          {loading ? '⏳ Generating...' : '📥 Export Full (with pricing)'}
        </button>
        <button className="btn btn-secondary" onClick={exportTeam} disabled={loading}>
          {loading ? '⏳ Generating...' : '📥 Export Team Sheet'}
        </button>
        <button className="btn btn-secondary" onClick={() => viewInBrowser(true)} disabled={loading}>
          {loading ? '⏳ Generating...' : '🌐 View Full (browser)'}
        </button>
        <button className="btn btn-secondary" onClick={() => viewInBrowser(false)} disabled={loading}>
          {loading ? '⏳ Generating...' : '🌐 View Team (browser)'}
        </button>
      </div>
    </div>
  )
}
