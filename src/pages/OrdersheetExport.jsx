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

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">
        📊 Order Sheet Export
        {count !== null && <span style={{ color: 'var(--ink3)', fontSize: 11 }}>{count} orders in sheet</span>}
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 16 }}>
        Exports all orders with status <strong>Order Sheet</strong> into the weekly Excel format.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-green" onClick={exportFull} disabled={loading}>
          {loading ? '⏳ Generating...' : '📥 Export Full (with pricing)'}
        </button>
        <button className="btn btn-secondary" onClick={exportTeam} disabled={loading}>
          {loading ? '⏳ Generating...' : '📥 Export Team Sheet'}
        </button>
      </div>
    </div>
  )
}
