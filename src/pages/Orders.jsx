import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import * as XLSX from 'xlsx-js-style'
import JSZip from 'jszip'

const STATUS_COLORS = { order_sheet: 'green', archived: 'purple' }
const STATUS_LABELS = { order_sheet: 'Active', archived: 'Archived' }
const DELIVERY_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const API_HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.REACT_APP_ANTHROPIC_KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
}

// ── Case → Pack conversion map ─────────────────────────────
// Default: 1 case = 6 packs
// PVBRG, KCOC: 1 case = 12 packs
// Cakes: 1 case = 4 packs
const PACKS_PER_CASE_MAP = {
  PVBRG: 12, KCOC: 12,
  KLRCKE: 4, KCCKE: 4, KVCKE: 4,
  KCC: 4, KVC: 4, KLRCup: 4,
  PRMC: 4, CMC: 4, LMC: 4, TMC: 4,
}

// Natures Emporium-specific bulk case sizes
const NATURES_BULK_CASE_MAP = {
  KWAL: 12, KAB: 12,       // 12 units per case
  KCC: 6, KVC: 6, KLRCup: 6, // 6 units per case
}

function getPacksPerCase(code) {
  return PACKS_PER_CASE_MAP[code] || 6
}

// ── Convert item to packs (canonical display unit) ──────────
function itemToPacks(item) {
  if (item.item_type === 'bulk') return null // bulk uses units
  if (item.packs) return Math.round(item.packs)
  if (item.cases) return Math.round(parseFloat(item.cases) * (item.packs_per_case || getPacksPerCase(item.product_code) || 6))
  // fallback: quantity / units_per_pack
  const upp = item.units_per_pack || 1
  return Math.round((item.quantity || 0) / upp)
}

const RETAIL_COLS = [
  { code: 'PBB', name: 'Protein Blueberry Muffins' }, { code: 'PCC', name: 'Protein Choco Muffins' }, { code: 'KLR', name: 'Keto Lemon Raspberry Muffins' },
  { code: 'NALCO-S', name: 'Natures Almond Cookie Single' }, { code: 'NALCO-D', name: 'Natures Almond Cookie Double' },
  { code: 'NALCOB', name: "Nature's Almond Coconut Bites" }, { code: 'NBFB', name: "Nature's Breakfast Bites" },
  { code: 'TRFC', name: 'Truffle Cake Whole' }, { code: 'KLRCKE', name: 'KLR Cake' }, { code: 'KCCKE', name: 'Keto Chocolate Cake' },
  { code: 'PVFB', name: 'Paleo Vegan Focaccia Bread' }, { code: 'PVBB', name: 'Protein Vegan Banana Bread' }, { code: 'KPL', name: 'Keto Pumpkin Loaf' }, { code: 'GBL', name: 'Paleo Ginger Bread Loaf' },
  { code: 'KSCD', name: 'Keto Cinnamon Donuts' }, { code: 'VPBD', name: 'Vegan PB Donuts' }, { code: 'KHD', name: 'Keto Hazelnut Donuts' },
  { code: 'PCrt', name: 'Paleo Carrot Cake' }, { code: 'VSCS', name: 'Vanilla Strawberry Cake Slice' }, { code: 'TRFCS', name: 'Truffle Cake Slices' }, { code: 'HRCS', name: 'Hazelnut Royale Cake Slices' },
  { code: 'POS', name: 'PO Shortbread' }, { code: 'PGCo', name: 'Ginger Cookies' }, { code: 'PVHC', name: 'Paleo Vegan Hemp Cookies' },
  { code: 'HPCo', name: 'Hazelnut Protein Cookies' }, { code: 'KCOC', name: 'Keto Collagen Cookies' }, { code: 'KSCO', name: 'Keto Snickerdoodle Cookies' },
  { code: 'KAB', name: 'Keto Almond Butter Cookies' }, { code: 'KWAL', name: 'Keto Walnut Cookies' }, { code: 'KABIS', name: 'Keto Almond Biscotti' },
  { code: 'PVBRG', name: 'Vegan Brownie Ganache' }, { code: 'PVBR', name: 'Paleo Vegan Brownie' }, { code: 'VPCAN', name: 'Vegan Pecan Bars' },
  { code: 'PNF', name: "Paleo No'tella Fudge" }, { code: 'VPB', name: 'Vegan Pistachio Bars' },
  { code: 'TMC', name: 'Truffle Mini Cake' }, { code: 'PRMC', name: 'Pistachio Raspberry Mini Cake' }, { code: 'CMC', name: 'Carrot Mini Cake' }, { code: 'LMC', name: 'Lemon Mini Cake' },
  { code: 'CCB', name: 'Chocolate Cinnamon Bark' }, { code: 'SFNL', name: 'Spiced Fruit & Nut Loaf' }, { code: 'CCBS', name: 'Chocolate Coconut Bliss Squares' },
  { code: 'CCKCU', name: 'Carrot Cake Cup' }, { code: 'LCKCU', name: 'Lemon Cake Cup' }, { code: 'KSCKCU', name: 'Keto Strawberry Cake Cup' }, { code: 'TCKCU', name: 'Chocolate Truffle Cake Cup' },
]

const BULK_COLS = [
  { code: 'KCC', name: 'Keto Chocolate Cupcake' }, { code: 'KVC', name: 'Keto Vanilla Cupcake' },
  { code: 'KLRCup', name: 'KLR Cupcake' }, { code: 'CKAC', name: 'Cupcake Almond Chocolate' },
  { code: 'CKHH', name: 'Cupcake Hazelnut Haven' },
  { code: 'PVBB', name: 'Protein Vegan Banana Bread' }, { code: 'PVBBSL', name: 'Banana Bread Slice Unfrosted' },
  { code: 'PVBBSLF', name: 'Banana Bread Slice Frosted' },
  { code: 'PBBBu', name: 'Blueberry Muffin Bulk' }, { code: 'PCCBu', name: 'Chocolate Chip Muffin Bulk' },
  { code: 'KLRBu', name: 'Lemon Raspberry Muffin Bulk' },
  { code: 'KABBu', name: 'Keto Almond Butter Cookies Bulk' }, { code: 'KWALBu', name: 'Keto Walnut Cookies Bulk' },
  { code: 'HPCoBu', name: 'Hazelnut Protein Cookies Bulk' }, { code: 'PVHCBu', name: 'Paleo Vegan Hemp Cookies Bulk' },
  { code: 'VPCANBu', name: 'Vegan Pecan Bars Bulk' }, { code: 'VPBBu', name: 'Vegan Pistachio Bars Bulk' },
  { code: 'PNFBu', name: "Paleo No'tella Fudge Bulk" }, { code: 'KABISBu', name: 'Almond Biscotti Bulk' },
  { code: 'KSCDBu', name: 'Cinnamon Donut Bulk' },
]

const BULK_CODES = new Set(BULK_COLS.map(c => c.code))

const BULK_MAP = {
  PBB: 'PBBBu', PCC: 'PCCBu', KLR: 'KLRBu',
  KAB: 'KABBu', KWAL: 'KWALBu', HPCo: 'HPCoBu', PVHC: 'PVHCBu', KABIS: 'KABISBu',
  KSCD: 'KSCDBu', VPCAN: 'VPCANBu', VPB: 'VPBBu', PNF: 'PNFBu',
}

const S = {
  KK_GREEN: '223824', KK_CREAM: 'E3DDD1', KK_PEACH: 'E79B81', CAT_GREEN: '2D4A35',
  TOTAL_BG: 'C8E6C9', TOTAL_FG: '1B5E20', GRAND_BG: '223824', GRAND_FG: 'E3DDD1',
  DAY_BG: '521B93', DAY_FG: 'F7FFAE', QTY_FG: '1A3A20', VAL_BG: 'E8F5E9',
  STORE_PALETTE: ['F7FFAE','F8C7F1','D4E6FF','C1C985','D19EB9','E8F5E9','FFE4B5','E6E0FF','FFDAB9','C8F5F0'],
}

function cellStyle(bg, fg, bold = false, size = 10, wrap = false, halign = 'center') {
  return {
    font: { name: 'Calibri', sz: size, bold, color: { rgb: fg || '000000' } },
    fill: { fgColor: { rgb: bg || 'FFFFFF' } },
    alignment: { horizontal: halign, vertical: 'center', wrapText: wrap },
    border: {
      top: { style: 'thin', color: { rgb: 'CCCCCC' } },
      bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
      left: { style: 'thin', color: { rgb: 'CCCCCC' } },
      right: { style: 'thin', color: { rgb: 'CCCCCC' } },
    }
  }
}

function applyStyles(ws, totalRows, numCols, dayRowIdxs, totalRowIdxs, storeRowIdxs, includePricing, grandTotalIdx, headerRowIdx, notesColIdx, catColorByCol) {
  const encode = (r, c) => XLSX.utils.encode_cell({ r, c })
  const storeArr = [...storeRowIdxs]
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const addr = encode(r, c)
      if (!ws[addr]) ws[addr] = { v: '', t: 's' }
      if (r === 0) { ws[addr].s = cellStyle(S.KK_GREEN, S.KK_CREAM, true, 14, false, c === 0 ? 'left' : 'center'); continue }
      if (r === headerRowIdx) {
        if (c === 0) ws[addr].s = cellStyle(S.KK_GREEN, S.KK_CREAM, true, 30, true, 'left')
        else if (notesColIdx !== undefined && c === notesColIdx) ws[addr].s = cellStyle('FBC02D', '3E2723', true, 10, true, 'center')
        else if (includePricing && c === numCols - 1) ws[addr].s = cellStyle(S.KK_PEACH, 'FFFFFF', true, 10, true, 'center')
        else ws[addr].s = cellStyle(S.KK_GREEN, S.KK_CREAM, true, 16, true, 'center')
        continue
      }
      if (r === 1 && headerRowIdx !== 1) {
        const bg = (catColorByCol && catColorByCol[c]) || S.CAT_GREEN
        ws[addr].s = cellStyle(bg, S.KK_CREAM, true, 25, false, 'center'); continue
      }
      if (grandTotalIdx !== undefined && r === grandTotalIdx) {
        ws[addr].s = c === 0 ? cellStyle(S.GRAND_BG, S.GRAND_FG, true, 11, false, 'left') : cellStyle(S.GRAND_BG, S.GRAND_FG, true, 20, false, 'center')
        continue
      }
      if (dayRowIdxs.has(r)) { ws[addr].s = cellStyle(S.DAY_BG, S.DAY_FG, true, 20, false, c === 0 ? 'left' : 'center'); continue }
      if (totalRowIdxs.has(r)) {
        if (c === 0) ws[addr].s = cellStyle(S.TOTAL_BG, S.TOTAL_FG, true, 20, false, 'left')
        else if (includePricing && c === numCols - 1 && notesColIdx === undefined) ws[addr].s = cellStyle(S.VAL_BG, S.TOTAL_FG, true, 20, false, 'center')
        else ws[addr].s = cellStyle(S.TOTAL_BG, S.TOTAL_FG, true, 20, false, 'center')
        continue
      }
      if (storeRowIdxs.has(r)) {
        const storePos = storeArr.indexOf(r)
        const rowBg = S.STORE_PALETTE[storePos % S.STORE_PALETTE.length]
        if (c === 0) ws[addr].s = cellStyle(rowBg, '111111', true, 20, false, 'left')
        else if (notesColIdx !== undefined && c === notesColIdx) {
          const hasNote = ws[addr].v && ws[addr].v !== ''
          ws[addr].s = hasNote
            ? { font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '3E2723' } }, fill: { fgColor: { rgb: 'FFF9C4' } }, alignment: { horizontal: 'left', vertical: 'center', wrapText: true }, border: { top: { style: 'medium', color: { rgb: 'FBC02D' } }, bottom: { style: 'medium', color: { rgb: 'FBC02D' } }, left: { style: 'medium', color: { rgb: 'FBC02D' } }, right: { style: 'medium', color: { rgb: 'FBC02D' } } } }
            : cellStyle(rowBg, 'BBBBBB', false, 10, false, 'center')
        }
        else if (includePricing && c === numCols - 1 && notesColIdx === undefined) { const hasVal = ws[addr].v && ws[addr].v !== ''; ws[addr].s = cellStyle(S.VAL_BG, S.TOTAL_FG, hasVal, 20, false, 'center') }
        else if (includePricing && notesColIdx !== undefined && c === numCols - 2) { const hasVal = ws[addr].v && ws[addr].v !== ''; ws[addr].s = cellStyle(S.VAL_BG, S.TOTAL_FG, hasVal, 20, false, 'center') }
        else if (c > 0 && ws[addr].v) ws[addr].s = cellStyle(rowBg, S.QTY_FG, true, 20, false, 'center')
        else ws[addr].s = cellStyle(rowBg, 'BBBBBB', false, 10, false, 'center')
        continue
      }
      ws[addr].s = { fill: { fgColor: { rgb: 'FFFFFF' } } }
    }
  }
}

// ── Freeze panes ──────────────────────────────────────────
// xlsx-js-style's writer has no native freeze-pane support, so we write the
// workbook normally, then post-process the raw xlsx (a zip) to inject the
// <pane>/<selection> XML into each target sheet's <sheetView>.
async function addFreezePanes(buffer, freezeConfig) {
  const zip = await JSZip.loadAsync(buffer)
  const wbXml = await zip.file('xl/workbook.xml').async('string')
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string')

  const sheetNameToRid = {}
  const sheetRe = /<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g
  let m
  while ((m = sheetRe.exec(wbXml))) sheetNameToRid[m[1]] = m[2]

  const ridToTarget = {}
  const relRe = /<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g
  while ((m = relRe.exec(relsXml))) ridToTarget[m[1]] = m[2]

  for (const [sheetName, freeze] of Object.entries(freezeConfig)) {
    const rid = sheetNameToRid[sheetName]
    if (!rid) continue
    const target = ridToTarget[rid]
    if (!target) continue
    const path = 'xl/' + target
    const file = zip.file(path)
    if (!file) continue
    let xml = await file.async('string')
    const { xSplit, ySplit, topLeftCell } = freeze
    const paneXml = '<pane xSplit="' + xSplit + '" ySplit="' + ySplit + '" topLeftCell="' + topLeftCell + '" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="' + topLeftCell + '" sqref="' + topLeftCell + '"/>'
    if (/<sheetView([^>]*)\/>/.test(xml)) {
      xml = xml.replace(/<sheetView([^>]*)\/>/, '<sheetView$1>' + paneXml + '</sheetView>')
    } else if (/<sheetView([^>]*)>/.test(xml)) {
      xml = xml.replace(/<sheetView([^>]*)>/, '<sheetView$1>' + paneXml)
    }
    zip.file(path, xml)
  }
  return zip.generateAsync({ type: 'blob' })
}

// Writes the workbook with freeze panes applied, falling back to a normal
// write (no freeze) if anything in the post-processing step fails.
async function writeWorkbookWithFreeze(wb, filename, freezeConfig) {
  try {
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const blob = await addFreezePanes(buf, freezeConfig)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (err) {
    console.error('Freeze-pane post-processing failed, exporting without freeze panes:', err)
    XLSX.writeFile(wb, filename)
  }
}

// ── Helper: get packs from an order_item (always packs, never cases/units) ──
function getItemPacks(item) {
  if (item.packs) return Math.round(item.packs)
  const ppc = item.packs_per_case || getPacksPerCase(item.product_code) || 6
  if (item.cases) return Math.round(parseFloat(item.cases) * ppc)
  const upp = item.units_per_pack || 1
  return Math.round((item.quantity || 0) / Math.max(1, upp))
}

function buildRetailSheet(wb, orders, includePricing, weekLabel) {
  const ws = XLSX.utils.aoa_to_sheet([])
  const title = 'KONSCIOUS KITCHEN — ORDER SHEET' + (weekLabel ? ' — ' + weekLabel : '')
  const numCols = RETAIL_COLS.length + 1 + (includePricing ? 1 : 0) + 1 // +1 store, +1 notes (always)
  const notesColIdx = numCols - 1
  const rows = []
  const titleRow = [title]; for (let i = 1; i < numCols; i++) titleRow.push(''); rows.push(titleRow)
  const catGroups = [[3,'MUFFINS'],[4,'NATURES PL'],[3,'WHOLE CAKES'],[4,'BREAD & LOAVES'],[3,'DOUGHNUTS'],[4,'CAKE SLICES'],[4,'PALEO COOKIES'],[5,'KETO COOKIES'],[5,'BARS'],[4,'MINI CAKES'],[3,'NEW'],[4,'CAKE CUPS']]
  const catRow = ['']
  for (const [count, label] of catGroups) { catRow.push(label); for (let i = 1; i < count; i++) catRow.push('') }
  if (includePricing) catRow.push('')
  catRow.push(''); rows.push(catRow)
  const headerRow = ['Store']
  for (const col of RETAIL_COLS) headerRow.push(col.name + '\n(' + col.code + ')')
  if (includePricing) headerRow.push('ORDER VALUE ($)')
  headerRow.push('NOTES'); rows.push(headerRow)
  const byDay = {}
  for (const o of orders) { const day = o.delivery_day || 'Unscheduled'; if (!byDay[day]) byDay[day] = []; byDay[day].push(o) }
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } }]
  let catColIdx = 1
  for (const [count] of catGroups) { if (count > 1) merges.push({ s: { r: 1, c: catColIdx }, e: { r: 1, c: catColIdx + count - 1 } }); catColIdx += count }
  const CAT_COLORS = ['8D6E63','558B2F','AD1457','795548','EF6C00','C2185B','6D4C41','00695C','A0522D','8E24AA','00897B','D84315']
  const catColorByCol = {}
  let ccIdx = 1
  catGroups.forEach(([count], gi) => { for (let k = 0; k < count; k++) catColorByCol[ccIdx + k] = CAT_COLORS[gi % CAT_COLORS.length]; ccIdx += count })
  const dayRowIdxs = new Set(), totalRowIdxs = new Set(), storeRowIdxs = new Set()
  const ALL_DAY_GROUPS = [...DELIVERY_DAYS, 'Unscheduled']
  for (const day of ALL_DAY_GROUPS) {
    const dayOrders = byDay[day] || []; if (!dayOrders.length) continue
    const dayLabel = day === 'Unscheduled' ? 'UNSCHEDULED / NO PACKING DAY SET' : day.toUpperCase()
    const dayRow = [dayLabel]; for (let i = 1; i < numCols; i++) dayRow.push('')
    dayRowIdxs.add(rows.length); merges.push({ s: { r: rows.length, c: 0 }, e: { r: rows.length, c: numCols - 1 } }); rows.push(dayRow)
    for (const order of dayOrders) {
      const items = order.order_items || []
      const packsMap = {}, priceMap = {}
      for (const item of items) {
        if (!item.product_code) continue
        const packs = getItemPacks(item)
        packsMap[item.product_code] = (packsMap[item.product_code] || 0) + packs
        priceMap[item.product_code] = item.price_per_pack || 0
      }
      const storeLabel = order.customer_name + (order.po_number ? '  (PO: ' + order.po_number + ')' : '')
      const storeRow = [storeLabel]; let rowTotal = 0
      for (const col of RETAIL_COLS) {
        const packs = packsMap[col.code]
        storeRow.push(packs || null)
        if (packs && priceMap[col.code]) rowTotal += packs * priceMap[col.code]
      }
      if (includePricing) storeRow.push(rowTotal > 0 ? Math.round(rowTotal * 100) / 100 : null)
      storeRow.push(order.notes || null)
      storeRowIdxs.add(rows.length); rows.push(storeRow)
    }
    const colTotals = new Array(RETAIL_COLS.length).fill(0); let grandTotal = 0
    for (const order of dayOrders) {
      const packsMap = {}, priceMap = {}
      for (const item of (order.order_items || [])) {
        if (!item.product_code) continue
        const packs = getItemPacks(item)
        packsMap[item.product_code] = (packsMap[item.product_code] || 0) + packs
        priceMap[item.product_code] = item.price_per_pack || 0
      }
      RETAIL_COLS.forEach((col, ci) => {
        const packs = packsMap[col.code] || 0
        colTotals[ci] += packs
        if (packs && priceMap[col.code]) grandTotal += packs * priceMap[col.code]
      })
    }
    const totalRow = ['TOTAL', ...colTotals.map(v => v || null)]
    if (includePricing) totalRow.push(grandTotal > 0 ? Math.round(grandTotal * 100) / 100 : null)
    totalRow.push('')
    totalRowIdxs.add(rows.length); rows.push(totalRow); rows.push([])
  }
  const grandColTotals = new Array(RETAIL_COLS.length).fill(0); let grandOrderTotal = 0
  for (const order of orders) {
    const packsMap = {}, priceMap = {}
    for (const item of (order.order_items || [])) {
      if (!item.product_code) continue
      const packs = getItemPacks(item)
      packsMap[item.product_code] = (packsMap[item.product_code] || 0) + packs
      priceMap[item.product_code] = item.price_per_pack || 0
    }
    RETAIL_COLS.forEach((col, ci) => {
      const packs = packsMap[col.code] || 0
      grandColTotals[ci] += packs
      if (packs && priceMap[col.code]) grandOrderTotal += packs * priceMap[col.code]
    })
  }
  const grandTotalRow = ['GRAND TOTAL', ...grandColTotals.map(v => v || null)]
  if (includePricing) grandTotalRow.push(grandOrderTotal > 0 ? Math.round(grandOrderTotal * 100) / 100 : null)
  grandTotalRow.push('')
  const grandTotalIdx = rows.length; rows.push(grandTotalRow)
  XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A1' }); ws['!merges'] = merges
  const colWidths = [{ wch: 52 }]; for (let i = 0; i < RETAIL_COLS.length; i++) colWidths.push({ wch: 12 }); if (includePricing) colWidths.push({ wch: 14 })
  colWidths.push({ wch: 32 })
  ws['!cols'] = colWidths; ws['!rows'] = [{ hpt: 24 }, { hpt: 52 }, { hpt: 120 }]
  for (let i = 3; i < rows.length; i++) { if (!ws['!rows'][i]) ws['!rows'][i] = {}; ws['!rows'][i].hpt = 50 }
  applyStyles(ws, rows.length, numCols, dayRowIdxs, totalRowIdxs, storeRowIdxs, includePricing, grandTotalIdx, 2, notesColIdx, catColorByCol)
  XLSX.utils.book_append_sheet(wb, ws, 'Retail Packs')
}

function buildBulkSheet(wb, orders, weekLabel, includePricing) {
  const ws = XLSX.utils.aoa_to_sheet([])
  const title = 'KONSCIOUS KITCHEN — BULK ORDERS' + (weekLabel ? ' — ' + weekLabel : '')
  const numCols = BULK_COLS.length + 1 + (includePricing ? 1 : 0) + 1 // +1 store, +1 notes (always)
  const notesColIdx = numCols - 1
  const rows = []; const titleRow = [title]; for (let i = 1; i < numCols; i++) titleRow.push(''); rows.push(titleRow)
  const headerRow = ['Store']; for (const col of BULK_COLS) headerRow.push(col.name + '\n(' + col.code + ')\nUNITS')
  if (includePricing) headerRow.push('ORDER VALUE ($)')
  headerRow.push('NOTES'); rows.push(headerRow)
  const byDay = {}; for (const o of orders) { const day = o.delivery_day || 'Unscheduled'; if (!byDay[day]) byDay[day] = []; byDay[day].push(o) }
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } }]
  const dayRowIdxs = new Set(), totalRowIdxs = new Set(), storeRowIdxs = new Set()
  const ALL_DAY_GROUPS_BULK = [...DELIVERY_DAYS, 'Unscheduled']
  for (const day of ALL_DAY_GROUPS_BULK) {
    const dayOrders = (byDay[day] || []).filter(o => (o.order_items || []).some(item => BULK_CODES.has(item.product_code))); if (!dayOrders.length) continue
    const dayLabel = day === 'Unscheduled' ? 'UNSCHEDULED / NO PACKING DAY SET' : day.toUpperCase()
    const dayRow = [dayLabel]; for (let i = 1; i < numCols; i++) dayRow.push('')
    dayRowIdxs.add(rows.length); merges.push({ s: { r: rows.length, c: 0 }, e: { r: rows.length, c: numCols - 1 } }); rows.push(dayRow)
    for (const order of dayOrders) {
      const items = order.order_items || []; const qtyMap = {}, priceMap = {}
      for (const item of items) { if (item.product_code) { qtyMap[item.product_code] = (qtyMap[item.product_code] || 0) + (item.quantity || 0); priceMap[item.product_code] = item.price_per_pack || 0 } }
      const storeLabel = order.customer_name + (order.po_number ? '  (PO: ' + order.po_number + ')' : '')
      const storeRow = [storeLabel]; let rowTotal = 0
      for (const col of BULK_COLS) { const qty = qtyMap[col.code] || null; storeRow.push(qty); if (qty && priceMap[col.code]) rowTotal += qty * priceMap[col.code] }
      if (includePricing) storeRow.push(rowTotal > 0 ? Math.round(rowTotal * 100) / 100 : null)
      storeRow.push(order.notes || null)
      storeRowIdxs.add(rows.length); rows.push(storeRow)
    }
    const bulkTotals = new Array(BULK_COLS.length).fill(0); let dayBulkTotal = 0
    for (const order of dayOrders) { const qtyMap = {}, priceMap = {}; for (const item of (order.order_items || [])) { if (item.product_code) { qtyMap[item.product_code] = (qtyMap[item.product_code] || 0) + (item.quantity || 0); priceMap[item.product_code] = item.price_per_pack || 0 } }; BULK_COLS.forEach((col, ci) => { const qty = qtyMap[col.code] || 0; bulkTotals[ci] += qty; if (qty && priceMap[col.code]) dayBulkTotal += qty * priceMap[col.code] }) }
    const totalRow = ['TOTAL', ...bulkTotals.map(v => v || null)]
    if (includePricing) totalRow.push(dayBulkTotal > 0 ? Math.round(dayBulkTotal * 100) / 100 : null)
    totalRow.push('')
    totalRowIdxs.add(rows.length); rows.push(totalRow); rows.push([])
  }
  const grandBulkTotals = new Array(BULK_COLS.length).fill(0); let grandBulkValue = 0
  for (const order of orders) { for (const item of (order.order_items || [])) { if (BULK_CODES.has(item.product_code)) { grandBulkTotals[BULK_COLS.findIndex(c => c.code === item.product_code)] += item.quantity || 0; grandBulkValue += (item.quantity || 0) * (item.price_per_pack || 0) } } }
  const grandTotalRow = ['GRAND TOTAL', ...grandBulkTotals.map(v => v || null)]
  if (includePricing) grandTotalRow.push(grandBulkValue > 0 ? Math.round(grandBulkValue * 100) / 100 : null)
  grandTotalRow.push('')
  const grandTotalIdx = rows.length; rows.push(grandTotalRow)
  XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A1' }); ws['!merges'] = merges
  const colWidths = [{ wch: 52 }]; for (let i = 0; i < BULK_COLS.length; i++) colWidths.push({ wch: 16 }); if (includePricing) colWidths.push({ wch: 14 })
  colWidths.push({ wch: 32 })
  ws['!cols'] = colWidths; ws['!rows'] = [{ hpt: 24 }, { hpt: 120 }]
  for (let i = 2; i < rows.length; i++) { if (!ws['!rows'][i]) ws['!rows'][i] = {}; ws['!rows'][i].hpt = 50 }
  applyStyles(ws, rows.length, numCols, dayRowIdxs, totalRowIdxs, storeRowIdxs, includePricing, grandTotalIdx, 1, notesColIdx)
  XLSX.utils.book_append_sheet(wb, ws, 'Bulk Orders')
}


function getWeekBounds(offset = 0) {
  const now = new Date(); const day = now.getDay(); const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + (offset * 7)); monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23, 59, 59, 999)
  return { monday, sunday }
}
function getWeekLabel(offset = 0) {
  const { monday, sunday } = getWeekBounds(offset)
  const fmt = d => d.toLocaleString('en-CA', { month: 'short', day: 'numeric' })
  return fmt(monday) + '\u2013' + fmt(sunday) + ', ' + monday.getFullYear()
}
function isWeekOrder(order, offset = 0) {
  if (order.status === 'archived') return false
  if (!order.dispatch_date) return false // undated orders don't auto-appear — must set a dispatch date
  const { monday, sunday } = getWeekBounds(offset)
  const d = new Date(order.dispatch_date + 'T00:00:00'); return d >= monday && d <= sunday
}

const UNITS_PER_PACK_MAP = {
  PBB: 2, PCC: 2, KLR: 2,
  KAB: 5, KWAL: 5, HPCo: 5, PVHC: 5, KABIS: 5,
  VPCAN: 3, VPB: 3, PNF: 3,
  KSCD: 4, KHD: 2, VPBD: 2,
  PVBRG: 1, KCOC: 1, PVBR: 1,
  CMC: 1, LMC: 1, PRMC: 1, TMC: 1,
  KCC: 1, KVC: 1, KLRCup: 1, KCCKE: 1, KVCKE: 1, KLRCKE: 1,
  NALCOB: 1, NBFB: 1,
}

// ── Dispatch slip — packs only for pack items, units for bulk ──
function printDispatchSlip(ordersInput) {
  const pages = []
  for (let i = 0; i < ordersInput.length; i += 2) pages.push(ordersInput.slice(i, i + 2))

  function renderOrder(order) {
    const itemRows = (order.order_items || []).map(function(item) {
      const isBulk = item.item_type === 'bulk' || (item.product_code && (item.product_code.endsWith('Bu') || BULK_CODES.has(item.product_code)))
      let displayQty
      if (isBulk) {
        displayQty = String(item.quantity || 0)
      } else {
        const packs = item.packs
          || (item.cases ? Math.round(parseFloat(item.cases) * (item.packs_per_case || getPacksPerCase(item.product_code) || 6)) : null)
          || (item.units_per_pack > 1 ? Math.round((item.quantity || 0) / item.units_per_pack) : (item.quantity || 0))
        displayQty = String(Math.round(packs))
      }
      const colHeader = isBulk ? 'Units' : 'Packs'
      return '<tr>' +
        '<td>' + (item.product_name || '') + ' <span style="font-weight:700">(' + (item.product_code || '') + ')</span></td>' +
        '<td style="text-align:center;font-weight:900">' + displayQty + '</td>' +
        '<td style="background:#fffde7">&nbsp;</td>' +
        '</tr>'
    }).join('')

    return '<div class="order-block">' +
      '<div class="order-header">' +
        '<strong>' + (order.customer_name || '') + '</strong>' +
        '<div class="order-meta">' + (order.slip_number || '') + ' &middot; <b>Inv #: ___________</b> &middot; ' + (order.dispatch_date || order.delivery_day || '&mdash;') + '</div>' +
      '</div>' +
      '<div class="table-wrap"><table>' +
        '<thead><tr>' +
          '<th>Product</th>' +
          '<th style="width:90px;text-align:center">Packs / Units</th>' +
          '<th style="width:80px;background:#fffde7">Prod. Date</th>' +
        '</tr></thead>' +
        '<tbody>' + itemRows + '</tbody>' +
      '</table></div>' +
    '</div>'
  }

  function renderPage(pageOrders, pageNum, total) {
    return '<div class="page">' +
      '<div class="page-header"><span class="logo">KONSCIOUS KITCHEN</span><span style="font-size:10px;color:#555">DISPATCH &middot; Page ' + pageNum + '/' + total + ' &middot; ' + new Date().toLocaleDateString('en-CA') + '</span></div>' +
      '<div class="slips-grid">' + pageOrders.map(renderOrder).join('') + '</div>' +
    '</div>'
  }

  const css = [
    '* { box-sizing: border-box; margin: 0; padding: 0; }',
    'body { font-family: Arial, sans-serif; background: #fff; color: #000; }',
    '.page { width: 210mm; min-height: 297mm; padding: 6mm 6mm 4mm 6mm; display: flex; flex-direction: column; page-break-after: always; }',
    '.page-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 3px; margin-bottom: 6px; flex-shrink: 0; }',
    '.logo { font-size: 12px; font-weight: 900; letter-spacing: 2px; }',
    '.slips-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; flex: 1; }',
    '.order-block { border: 1.5px solid #000; display: flex; flex-direction: column; break-inside: avoid; page-break-inside: avoid; }',
    '.order-header { border-bottom: 1.5px solid #000; padding: 4px 7px; background: #f0f0f0; flex-shrink: 0; }',
    '.order-header strong { font-size: 15px; font-weight: 900; display: block; line-height: 1.3; }',
    '.order-meta { font-size: 11px; font-weight: 600; color: #333; margin-top: 1px; }',
    '.table-wrap { flex: 1; }',
    'table { width: 100%; border-collapse: collapse; }',
    'th { background: #e0e0e0; padding: 3px 6px; font-size: 10px; text-transform: uppercase; font-weight: 700; border-bottom: 1.5px solid #000; text-align: left; }',
    'td { padding: 5px 7px; border-bottom: 1px solid #ddd; font-size: 13px; vertical-align: middle; word-break: break-word; }',
    'tr:last-child td { border-bottom: none; }',
    '@media print { body { margin: 0; } .page { page-break-after: always; } }',
  ].join('\n')

  const html = '<!DOCTYPE html><html><head><title>KK Dispatch Slips</title><style>' + css + '</style></head><body>' +
    pages.map(function(pg, i) { return renderPage(pg, i + 1, pages.length) }).join('') + '</body></html>'
  const w = window.open('', '_blank'); w.document.write(html); w.document.close(); w.print()
}

async function readOrderWithAI(content, products, customerName = '', isImage = false, fileType = '', orderMode = 'cases') {
  const productList = products.map(p => p.code + ': ' + p.name).join('\n')
  const isNaturesEmporium = customerName.toLowerCase().includes('natures emporium') || customerName.toLowerCase().includes('nature emporium')
  const neRule = isNaturesEmporium ? '\nSPECIAL RULE FOR THIS CUSTOMER (Natures Emporium):\n- "brownie ganache 90g" or "brownie ganache pouch" = PVBRG (packaged, retail)\n- "brownie ganache" without 90g or pouch = PVBRG-BULK (bulk order)\n' : ''
  const orderModeInstruction = orderMode === 'packs'
    ? 'ORDER MODE: PACKS — every quantity in this order is in PACKS. Set quantity_type="packs" for ALL items.'
    : orderMode === 'bulk'
    ? 'ORDER MODE: BULK/UNITS — all quantities are individual units. Set quantity_type="units" and is_bulk=true for ALL items.'
    : orderMode === 'cases'
    ? 'ORDER MODE: CASES — all quantities are full cases. Set quantity_type="cases" for ALL items.'
    : 'ORDER MODE: MIXED — determine quantity_type (cases/packs/units) per item from context.'
  const prompt = 'You are an order reader for Konscious Kitchen, a premium bakery. Extract all products and quantities from this customer order.\n\n'
    + orderModeInstruction + '\n\n'
    + 'INVOICE FORMAT RULES (critical):\n'
    + '- Lines often follow: PRODUCT NAME  QUANTITY  UNIT_PRICE  EXTENDED_PRICE\n'
    + '- The QUANTITY is the FIRST standalone number after the product name, appearing BEFORE any dollar sign\n'
    + '- Dollar amounts like $8.40 or $84.00 are PRICES — NEVER use them as quantities\n'
    + '- Notations like "4PK", "5 PK", "350G", "90G" in the product name are PACK SIZE DESCRIPTIONS — ignore them for quantity\n'
    + '- If a product spans multiple lines (e.g. "KONKI KETO COOKIE ALMOND BUTTE\\n5 PK\\n4 $8.40"), the quantity is the number on the LAST line before the first dollar sign (4 in this example)\n'
    + '- A line that is only a number followed by a dollar total (e.g. "38 $308.68") is a GRAND TOTAL — skip it\n'
    + '- BOTH CASES AND PACKS MENTIONED: If a customer specifies both cases and packs for the same item (e.g. "2 cases 12 packs" or "blueberry muffins 2 case 12 packs"), ALWAYS return the PACKS number and set quantity_type="packs". The packs figure is the authoritative quantity — ignore the cases figure entirely.\n\n'
    + 'OUR PRODUCT LIST:\n' + productList + '\n\n'
    + 'SEMANTIC MATCHING GUIDE:\n'
    + '- blueberry muffin / paleo muffin = PBB\n'
    + '- chocolate muffin / choc muffin = PCC\n'
    + '- lemon raspberry muffin / lemon muffin = KLR\n'
    + '- hazelnut donut / hazelnut doughnut = KHD\n'
    + '- peanut butter donut / PB donut / vegan donut = VPBD\n'
    + '- cinnamon donut = KSCD\n'
    + '- brownie / mini brownie / brownie bar (NOT ganache) = PVBR\n'
    + '- brownie ganache / ganache pouch / brownie ganache 90g = PVBRG\n'
    + neRule
    + '- pecan bar = VPCAN\n'
    + '- notella / nutella bar = PNF\n'
    + '- pistachio bar = VPB\n'
    + '- hemp cookies = PVHC\n'
    + '- hazelnut protein cookie = HPCo\n'
    + '- ginger cookie / ginger snap = PGCo\n'
    + '- shortbread = POS\n'
    + '- keto almond butter cookie = KAB\n'
    + '- keto walnut cookie = KWAL\n'
    + '- snickerdoodle = KSCo\n'
    + '- collagen cookie = KCCo (KCOC)\n'
    + '- banana bread / banana loaf = PVBB\n'
    + '- ginger loaf = GBL\n'
    + '- pumpkin loaf = KPL\n'
    + '- focaccia = PVFB\n'
    + '- vanilla strawberry slice = VSCS\n'
    + '- truffle cake slice = TRFCS\n'
    + '- hazelnut royale slice = HRCS\n'
    + '- truffle cake whole = WTC (TRFC)\n'
    + '- pistachio raspberry mini cake = PRMC\n'
    + '- carrot mini cake = CMC\n'
    + '- lemon mini cake = LMC\n'
    + '- truffle mini cake = TMC\n'
    + '- almond biscotti / keto biscotti = KABIS\n'
    + '- keto chocolate cupcake = KCC\n'
    + '- keto vanilla cupcake = KVC\n'
    + '- klr cupcake = KLRCup\n'
    + '- keto chocolate cake = KCCKE\n'
    + '- keto vanilla cake = KVCKE\n'
    + '- klr cake = KLRCKE\n'
    + '- carrot cake cup = CCKCU\n'
    + '- lemon cake cup = LCKCU\n'
    + '- strawberry cake cup / keto strawberry cake cup = KSCKCU\n'
    + '- truffle cake cup / chocolate truffle cake cup = TCKCU\n\n'
    + 'BULK DETECTION: If a SKU/code starts with BLK OR description says bulk, set is_bulk=true.\n\n'
    + 'Return ONLY a JSON array:\n'
    + '[\n'
    + '  {"product_name": "exact name", "quantity": 12, "quantity_type": "packs", "is_bulk": false, "product_code": "MATCHED_CODE", "matched": true}\n'
    + ']\n'
    + 'Return ONLY the JSON array, no other text.'
  const isPDF = fileType === 'application/pdf'
  const messages = isImage
    ? [{ role: 'user', content: [isPDF ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: content } } : { type: 'image', source: { type: 'base64', media_type: fileType, data: content } }, { type: 'text', text: prompt }] }]
    : [{ role: 'user', content: 'This is a customer order:\n\n' + content + '\n\n' + prompt }]
  const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: API_HEADERS, body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1000, messages }) })
  const data = await response.json()
  if (!response.ok) throw new Error('API ' + response.status + ': ' + JSON.stringify(data))
  const text = data.content?.[0]?.text?.trim()
  if (!text) throw new Error('Empty response from AI. Please try again.')
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (!arrayMatch) throw new Error('AI did not return a valid order list. Try again or use paste mode.')
  return JSON.parse(arrayMatch[0])
}


function CustomerSelect({ customers, value, onChange, onAddNew }) {
  const [search, setSearch] = useState(value || '')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler); return () => document.removeEventListener('mousedown', handler)
  }, [])
  const filtered = customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase())).slice(0, 20)
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input value={search} onChange={e => { setSearch(e.target.value); setOpen(true); onChange('') }} onFocus={() => setOpen(true)}
        placeholder="Search or select customer..."
        style={{ width: '100%', padding: '10px 14px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--body)', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }} />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 200, maxHeight: 240, overflowY: 'auto' }}>
          {filtered.map(c => (
            <div key={c.id} onClick={() => { setSearch(c.name); onChange(c.id); setOpen(false) }}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f0f0f0' }}
              onMouseEnter={e => e.target.style.background = '#f5f5f5'} onMouseLeave={e => e.target.style.background = ''}>
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

export default function Orders() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const isKitchen = profile?.role === 'kitchen'
  const canEdit = isAdmin || isKitchen
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
  const [exportLoading, setExportLoading] = useState(false)
  const [exportWeek, setExportWeek] = useState('current')
  const [selectedOrders, setSelectedOrders] = useState(new Set())
  const fileInputRef = useRef(null)
  const [form, setForm] = useState({ customer_id: '', customer_name: '', order_source: 'Email', po_number: '', delivery_day: '', dispatch_date: '', notes: '', attachment: null, attachment_preview: null, order_input_mode: '' })
  const [orderItems, setOrderItems] = useState([])
  const [unmatchedItems, setUnmatchedItems] = useState([])

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [o, c, p] = await Promise.all([
      supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }).limit(200),
      supabase.from('customers').select('*').order('name'),
      supabase.from('products').select('code,name,category,price_per_pack,units_per_case,packs_per_case,units_per_pack').not('code','like','WIP%').order('code'),
    ])
    setOrders(o.data || []); setCustomers(c.data || []); setProducts(p.data || []); setLoading(false)
  }

  async function handleAddNewCustomer(name) {
    const { data } = await supabase.from('customers').insert({ name, type: 'retail' }).select().single()
    if (data) { setCustomers(prev => [...prev, data].sort((a,b) => a.name.localeCompare(b.name))); setForm(f => ({ ...f, customer_id: data.id, customer_name: data.name })) }
  }

  async function handleCustomerChange(id) {
    const c = customers.find(c => c.id === id); if (!c) return
    setForm(f => ({ ...f, customer_id: id, customer_name: c.name, delivery_day: c.preferred_delivery_day || f.delivery_day }))
  }

  function processAIItems(items) {
    const matched = items.filter(i => i.matched)
    const unmatched = items.filter(i => !i.matched)
    const orderMode = form.order_input_mode || 'cases'

    const enriched = matched.map(i => {
      let productCode = i.product_code
      // Detect bulk from AI flag or order mode or BLK prefix in original name
      const aiBulk = i.is_bulk === true
      let itemType = (orderMode === 'bulk' || aiBulk) ? 'bulk' : 'pack'
      if (itemType === 'bulk') { productCode = BULK_MAP[i.product_code] || i.product_code }

      const p = products.find(p => p.code === productCode)
      const isNatures = form.customer_name.toLowerCase().includes('natures emporium') || form.customer_name.toLowerCase().includes('nature emporium')
      const ppc = (isNatures && itemType === 'bulk' && NATURES_BULK_CASE_MAP[productCode])
        ? NATURES_BULK_CASE_MAP[productCode]
        : PACKS_PER_CASE_MAP[productCode] || parseInt(p?.packs_per_case) || 6
      const upp = UNITS_PER_PACK_MAP[productCode] || parseInt(p?.units_per_pack) || 1

      // Convert AI quantity to packs
      const qType = i.quantity_type || (orderMode === 'packs' ? 'packs' : orderMode === 'bulk' ? 'units' : 'cases')
      let packs = null, quantity = 0

      if (itemType === 'bulk') {
        quantity = Math.max(1, parseFloat(i.quantity) || 0)
      } else if (qType === 'cases') {
        packs = Math.round(parseFloat(i.quantity) * ppc)
        quantity = packs * upp
      } else if (qType === 'packs') {
        packs = Math.round(parseFloat(i.quantity))
        quantity = packs * upp
      } else {
        // units — convert to packs
        quantity = parseFloat(i.quantity) || 0
        packs = Math.round(quantity / Math.max(1, upp))
      }

      return {
        product_code: productCode,
        product_name: p?.name || i.product_name,
        input_mode: itemType === 'bulk' ? 'units' : 'packs',
        item_type: itemType,
        packs: itemType === 'bulk' ? null : packs,
        cases: null,
        quantity,
        packs_per_case: ppc,
        units_per_pack: upp,
        price_per_pack: p?.price_per_pack || 0,
        notes: ''
      }
    })
    setOrderItems(enriched)
    setUnmatchedItems(unmatched.map(i => ({ ...i, selected_code: '', quantity: i.quantity })))
  }

  async function handleAttachment(e) {
    const file = e.target.files?.[0]; if (!file) return
    setForm(f => ({ ...f, attachment: file, attachment_preview: URL.createObjectURL(file) }))
    setAiLoading(true); setOrderItems([]); setUnmatchedItems([])
    try {
      const base64 = await new Promise((res, rej) => { const reader = new FileReader(); reader.onload = () => res(reader.result.split(',')[1]); reader.onerror = rej; reader.readAsDataURL(file) })
      processAIItems(await readOrderWithAI(base64, products, form.customer_name, true, file.type, form.order_input_mode || 'cases'))
    } catch(err) { alert('Error: ' + err.message) }
    setAiLoading(false); if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handlePasteRead() {
    if (!pasteText.trim()) { alert('Please paste order text first'); return }
    setAiLoading(true); setOrderItems([]); setUnmatchedItems([])
    try { processAIItems(await readOrderWithAI(pasteText, products, form.customer_name, false, '', form.order_input_mode || 'cases')) }
    catch(err) { alert('Error: ' + err.message) }
    setAiLoading(false)
  }

  function handleUnmatchedSelect(idx, code) {
    const p = products.find(p => p.code === code); if (!p) return
    const ppc = PACKS_PER_CASE_MAP[code] || parseInt(p?.packs_per_case) || 6
    const upp = UNITS_PER_PACK_MAP[code] || parseInt(p?.units_per_pack) || 1
    const qty = unmatchedItems[idx].quantity || 1
    const packs = Math.round(qty / Math.max(1, upp))
    setOrderItems(prev => [...prev, { product_code: code, product_name: p.name, input_mode: 'packs', item_type: 'pack', packs, cases: null, quantity: packs * upp, packs_per_case: ppc, units_per_pack: upp, price_per_pack: p.price_per_pack || 0, notes: '' }])
    setUnmatchedItems(prev => prev.filter((_, i) => i !== idx))
  }

  function updateItem(idx, field, val) { setOrderItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item)) }
  function removeItem(idx) { setOrderItems(prev => prev.filter((_, i) => i !== idx)) }

  function addManualItem() {
    const m = form.order_input_mode || 'packs'
    const isBulk = m === 'bulk'
    setOrderItems(prev => [...prev, {
      product_code: '', product_name: '', input_mode: isBulk ? 'units' : 'packs',
      item_type: isBulk ? 'bulk' : 'pack', packs: isBulk ? null : 1,
      cases: null, quantity: isBulk ? 1 : 1, packs_per_case: 6, units_per_pack: 1, price_per_pack: 0, notes: ''
    }])
  }

  function updateEditItem(idx, field, val) { setEditItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item)) }
  function removeEditItem(idx) { setEditItems(prev => prev.filter((_, i) => i !== idx)) }
  function addEditItem() {
    setEditItems(prev => [...prev, { product_code: '', product_name: '', input_mode: 'packs', item_type: 'pack', packs: 1, cases: null, quantity: 1, packs_per_case: 6, units_per_pack: 1, price_per_pack: 0, notes: '', isNew: true }])
  }
  function startEditOrder(order) { setEditingOrder({ ...order }); setEditItems((order.order_items || []).map(i => ({ ...i }))); setViewOrder(null) }

  async function saveEditOrder() {
    if (editItems.length === 0) { alert('Please add at least one product'); return }
    setEditSaving(true)
    try {
      const total = editItems.reduce((sum, i) => {
        const isBulkE = i.item_type === 'bulk' || (i.packs === null && i.cases === null)
        const value = isBulkE
          ? (i.quantity || 0) * parseFloat(i.price_per_pack || 0)
          : (i.packs || (i.cases ? parseFloat(i.cases) * (i.packs_per_case || 6) : Math.round((i.quantity || 0) / Math.max(1, i.units_per_pack || 1)))) * parseFloat(i.price_per_pack || 0)
        return sum + value
      }, 0)
      await supabase.from('orders').update({ delivery_day: editingOrder.delivery_day || null, dispatch_date: editingOrder.dispatch_date || null, po_number: editingOrder.po_number || null, order_source: editingOrder.order_source, notes: editingOrder.notes || null, status: editingOrder.status, total_value: total, updated_at: new Date().toISOString() }).eq('id', editingOrder.id)
      await supabase.from('order_items').delete().eq('order_id', editingOrder.id)
      const editItemsToInsert = editItems.map(i => {
        const isBulk = i.item_type === 'bulk'
        const upp = i.units_per_pack || UNITS_PER_PACK_MAP[i.product_code] || 1
        const ppc = i.packs_per_case || PACKS_PER_CASE_MAP[i.product_code] || 6
        const packs = isBulk ? null : (i.packs ? parseFloat(i.packs) : Math.round((i.quantity || 0) / Math.max(1, upp)))
        return { order_id: editingOrder.id, product_code: i.product_code || null, product_name: i.product_name || '', packs, cases: null, quantity: parseFloat(i.quantity || 0), packs_per_case: ppc, units_per_pack: upp, price_per_pack: parseFloat(i.price_per_pack || 0), notes: i.notes || null }
      })
      const { error: editItemsError } = await supabase.from('order_items').insert(editItemsToInsert)
      if (editItemsError) throw new Error('Items save failed: ' + editItemsError.message)
      setEditingOrder(null); setEditItems([]); await loadData()
    } catch(err) { alert('Save failed: ' + err.message) }
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
        const path = 'orders/' + Date.now() + '-' + form.customer_name.replace(/\s+/g,'-') + '.' + ext
        const { data: upData } = await supabase.storage.from('order-attachments').upload(path, form.attachment, { contentType: form.attachment.type })
        if (upData) { const { data: { publicUrl } } = supabase.storage.from('order-attachments').getPublicUrl(path); attachment_url = publicUrl }
      }
      const order_number = 'KK' + Date.now()
      const total = orderItems.reduce((sum, i) => {
        const isBulk = i.item_type === 'bulk' || (i.packs === null && i.cases === null)
        const value = isBulk
          ? (i.quantity || 0) * parseFloat(i.price_per_pack || 0)
          : (i.packs || Math.round((i.quantity || 0) / Math.max(1, i.units_per_pack || 1))) * parseFloat(i.price_per_pack || 0)
        return sum + value
      }, 0)
      const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true })
      const slipNum = 'SLIP-' + String((count || 0) + 1).padStart(3, '0')
      const { data: order, error } = await supabase.from('orders').insert({
        order_number, customer_id: form.customer_id || null, customer_name: form.customer_name,
        order_source: form.order_source, po_number: form.po_number || null,
        delivery_day: form.delivery_day || null, dispatch_date: form.dispatch_date || null,
        notes: form.notes || null, order_attachment_url: attachment_url,
        total_value: total, status: 'order_sheet', created_by_name: profile?.name, slip_number: slipNum
      }).select().single()
      if (error) throw error
      const itemsToInsert = orderItems.map(i => {
        const isBulk = i.item_type === 'bulk'
        const upp = i.units_per_pack || UNITS_PER_PACK_MAP[i.product_code] || 1
        const ppc = i.packs_per_case || PACKS_PER_CASE_MAP[i.product_code] || 6
        // Always calculate packs for pack items — never let it be null
        let packs = null
        if (!isBulk) {
          packs = i.packs
            ? parseFloat(i.packs)
            : i.cases
              ? Math.round(parseFloat(i.cases) * ppc)
              : Math.round((i.quantity || 0) / Math.max(1, upp))
        }
        return {
          order_id: order.id,
          product_code: i.product_code || null,
          product_name: i.product_name || '',
          packs: packs,
          cases: null,
          quantity: Math.max(isBulk ? 1 : 0, parseFloat(i.quantity || 0)),
          packs_per_case: ppc,
          units_per_pack: upp,
          price_per_pack: parseFloat(i.price_per_pack || 0),
          notes: i.notes || null
        }
      })
      const { error: itemsError } = await supabase.from('order_items').insert(itemsToInsert)
      if (itemsError) throw new Error('Items save failed: ' + itemsError.message)
      if (form.customer_id && form.delivery_day) await supabase.from('customers').update({ preferred_delivery_day: form.delivery_day }).eq('id', form.customer_id)
      await supabase.from('activity').insert({ type: 'dispatch', title: 'Order received: ' + form.customer_name, description: order_number + ' · ' + slipNum + ' · ' + orderItems.length + ' items · $' + total.toFixed(2), created_by_name: profile?.name })
      setShowModal(false); resetForm(); await loadData()
    } catch(err) { alert('Save failed: ' + err.message) }
    setSaving(false)
  }

  function resetForm() {
    setForm({ customer_id:'', customer_name:'', order_source:'Email', po_number:'', delivery_day:'', dispatch_date:'', notes:'', attachment:null, attachment_preview:null, order_input_mode:'' })
    setOrderItems([]); setUnmatchedItems([]); setPasteText(''); setInputMode('upload')
  }

  async function updateStatus(id, status) {
    await supabase.from('orders').update({ status }).eq('id', id)
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o))
    if (viewOrder?.id === id) setViewOrder(v => ({ ...v, status }))
  }

  async function exportManifest() {
    if (!selectedOrders.size) { alert('Select orders first.'); return }
    const toExport = orders.filter(o => selectedOrders.has(o.id))
    const customerNames = [...new Set(toExport.map(o => o.customer_name))]
    const { data: custData } = await supabase.from('customers').select('name, street_address, city, province, postal_code, phone').in('name', customerNames)
    const custMap = {}; (custData || []).forEach(c => { custMap[c.name] = c })
    const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet([])
    const rows = []
    rows.push(['KONSCIOUS KITCHEN — DELIVERY MANIFEST — ' + new Date().toLocaleDateString('en-CA')]); rows.push([])
    rows.push(['#', 'Store Name', 'Address', 'City', 'Special Notes'])
    toExport.forEach((order, i) => { const cust = custMap[order.customer_name] || {}; const addr = [cust.street_address, cust.province, cust.postal_code].filter(Boolean).join(', '); rows.push([i + 1, order.customer_name, addr || '—', cust.city || '—', order.notes || '—']) })
    XLSX.utils.sheet_add_aoa(ws, rows, { origin: 'A1' }); ws['!cols'] = [{ wch: 4 }, { wch: 32 }, { wch: 40 }, { wch: 18 }, { wch: 35 }]
    const encode = (r, c) => XLSX.utils.encode_cell({ r, c })
    for (let c = 0; c < 5; c++) { const a = encode(0, c); if (!ws[a]) ws[a] = { v: '', t: 's' }; ws[a].s = { font: { bold: true, sz: 13, color: { rgb: 'E3DDD1' } }, fill: { fgColor: { rgb: '223824' } }, alignment: { horizontal: 'left' } } }
    for (let c = 0; c < 5; c++) { const a = encode(2, c); if (!ws[a]) ws[a] = { v: '', t: 's' }; ws[a].s = { font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '2D4A35' } }, alignment: { horizontal: 'left' } } }
    for (let r = 3; r < rows.length; r++) { const bg = r % 2 === 0 ? 'F5F5F5' : 'FFFFFF'; for (let c = 0; c < 5; c++) { const a = encode(r, c); if (!ws[a]) ws[a] = { v: '', t: 's' }; ws[a].s = { font: { sz: 12 }, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: 'left', wrapText: true } } } }
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }]; ws['!rows'] = [{ hpt: 24 }, { hpt: 6 }, { hpt: 20 }]
    for (let i = 3; i < rows.length; i++) { if (!ws['!rows'][i]) ws['!rows'][i] = {}; ws['!rows'][i].hpt = 40 }
    XLSX.utils.book_append_sheet(wb, ws, 'Delivery Manifest')
    XLSX.writeFile(wb, 'KK_Delivery_Manifest_' + new Date().toISOString().split('T')[0] + '.xlsx')
  }

  async function exportOrderSheet(includePricing) {
    setExportLoading(true)
    try {
      const offset = exportWeek === 'next' ? 1 : 0
      const sheetOrders = orders.filter(o => isWeekOrder(o, offset))
      if (!sheetOrders.length) { alert('No active orders for ' + (exportWeek === 'next' ? 'next' : 'this') + ' week.'); setExportLoading(false); return }
      const weekLabel = getWeekLabel(offset); const wb = XLSX.utils.book_new()
      buildRetailSheet(wb, sheetOrders, includePricing, weekLabel)
      buildBulkSheet(wb, sheetOrders, weekLabel, includePricing)
      const suffix = includePricing ? 'FULL' : 'TEAM'
      await writeWorkbookWithFreeze(wb, 'KK_Order_Sheet_' + weekLabel.replace(/[^a-zA-Z0-9]/g, '_') + '_' + suffix + '.xlsx', {
        'Retail Packs': { xSplit: 1, ySplit: 3, topLeftCell: 'B4' },
        'Bulk Orders': { xSplit: 1, ySplit: 2, topLeftCell: 'B3' },
      })
    } catch(err) { alert('Export failed: ' + err.message) }
    setExportLoading(false)
  }

  async function resetWeek() {
    const weekLabel = getWeekLabel(0)
    if (!window.confirm('Archive all active orders for week of ' + weekLabel + '?\n\nNext-week orders will NOT be affected.')) return
    const currentWeekOrders = orders.filter(o => o.status !== 'archived' && isWeekOrder(o, 0))
    if (!currentWeekOrders.length) { alert('No active orders for this week to archive.'); return }
    const { error } = await supabase.from('orders').update({ status: 'archived' }).in('id', currentWeekOrders.map(o => o.id))
    if (error) { alert('Reset failed: ' + error.message); return }
    await loadData()
  }

  function toggleOrder(id) { setSelectedOrders(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next }) }
  function toggleAll(orderList) {
    const allIds = orderList.map(o => o.id); const allSelected = allIds.every(id => selectedOrders.has(id))
    if (allSelected) setSelectedOrders(prev => { const next = new Set(prev); allIds.forEach(id => next.delete(id)); return next })
    else setSelectedOrders(prev => { const next = new Set(prev); allIds.forEach(id => next.add(id)); return next })
  }
  function printSelected() { const toPrint = orders.filter(o => selectedOrders.has(o.id)); if (!toPrint.length) { alert('No orders selected.'); return }; printDispatchSlip(toPrint) }

  const activeOrders = orders.filter(o => o.status !== 'archived')
  const archivedOrders = orders.filter(o => o.status === 'archived')
  const filteredByStatus = filterStatus === 'archived' ? archivedOrders : activeOrders
  const sel = { padding: '10px 14px', border: '1.5px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--body)', fontSize: 13, background: 'var(--surface)', color: 'var(--ink)', width: '100%', outline: 'none' }

  return (
    <>
      <div className="page-header">
        <div><h2>ORDERS</h2><p>Incoming order management</p></div>
        <div style={{ display:'flex', gap:8 }}>
          {selectedOrders.size > 0 && (<>
            <button className="btn btn-secondary" onClick={printSelected}>🖨️ Print {selectedOrders.size} Slip{selectedOrders.size > 1 ? 's' : ''}</button>
            <button className="btn btn-secondary" onClick={exportManifest}>📋 Manifest ({selectedOrders.size})</button>
          </>)}
          {canEdit && <button className="btn btn-green" onClick={() => setShowModal(true)}>+ New Order</button>}
        </div>
      </div>
      <div className="page-body">
        <div className="grid2" style={{ marginBottom: 16, maxWidth: 400 }}>
          <div className="stat green"><div className="stat-label">Active Orders</div><div className="stat-value">{activeOrders.length}</div></div>
          <div className="stat purple"><div className="stat-label">Archived</div><div className="stat-value">{archivedOrders.length}</div></div>
        </div>
        {canEdit && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">📊 Order Sheet Export</div>
            <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
              <select style={{ ...sel, width:'auto', fontSize:12, padding:'6px 12px' }} value={exportWeek} onChange={e => setExportWeek(e.target.value)}>
                <option value="current">This Week ({getWeekLabel(0)})</option>
                <option value="next">Next Week ({getWeekLabel(1)})</option>
              </select>
              <span style={{ fontSize:11, color:'var(--ink3)' }}>{orders.filter(o => o.status !== 'archived' && isWeekOrder(o, exportWeek === 'next' ? 1 : 0)).length} orders</span>
            </div>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
              <button className="btn btn-green" onClick={() => exportOrderSheet(true)} disabled={exportLoading}>{exportLoading ? '⏳ Generating...' : '📥 Export Full (with pricing)'}</button>
              <button className="btn btn-secondary" onClick={() => exportOrderSheet(false)} disabled={exportLoading}>{exportLoading ? '⏳ Generating...' : '📥 Export Team Sheet'}</button>
              <button className="btn btn-red" onClick={resetWeek} disabled={exportLoading} style={{ marginLeft:'auto' }}>🗄 Reset Week</button>
            </div>
          </div>
        )}
        <div className="filter-bar">
          {[{ key:'active',label:'All Active' },{ key:'archived',label:'Archived' }].map(f => (
            <button key={f.key} className={'filter-btn ' + (filterStatus===f.key?'active':'')} onClick={() => setFilterStatus(f.key)}>{f.label}</button>
          ))}
        </div>
        <div className="card">
          <div className="card-title">{filteredByStatus.length} orders</div>
          {loading ? <div style={{ textAlign:'center', padding:32, color:'var(--ink3)' }}>Loading...</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th style={{width:36}}><input type="checkbox" checked={filteredByStatus.length > 0 && filteredByStatus.every(o => selectedOrders.has(o.id))} onChange={() => toggleAll(filteredByStatus)} style={{cursor:'pointer'}} /></th>
                  <th>Slip #</th><th>Order #</th><th>Customer</th><th>Source</th><th>Dispatch Date</th><th>Items</th>{isAdmin && <th>Value</th>}<th>Status</th><th></th>
                </tr></thead>
                <tbody>
                  {filteredByStatus.length === 0 && <tr><td colSpan={10} style={{ textAlign:'center', padding:32, color:'var(--ink3)' }}>No orders</td></tr>}
                  {filteredByStatus.map(o => {
                    const isStale = o.status !== 'archived' && o.dispatch_date && !isWeekOrder(o, 0) && !isWeekOrder(o, 1)
                    return (
                      <tr key={o.id} style={{ background: selectedOrders.has(o.id) ? 'var(--green-l)' : isStale ? '#FFF8E1' : '' }}>
                        <td><input type="checkbox" checked={selectedOrders.has(o.id)} onChange={() => toggleOrder(o.id)} style={{cursor:'pointer'}} /></td>
                        <td><span style={{ fontSize:11, color:'var(--ink3)', fontFamily:'var(--mono)' }}>{o.slip_number || '—'}</span></td>
                        <td><span className="code-tag">{o.order_number}</span></td>
                        <td style={{ fontWeight:500 }}>{o.customer_name}</td>
                        <td style={{ fontSize:11 }}>{o.order_source}</td>
                        <td style={{ fontSize:11 }}>{o.dispatch_date || o.delivery_day || '—'}</td>
                        <td style={{ fontSize:11 }}>{o.order_items?.length || 0}</td>
                        {isAdmin && <td style={{ fontWeight:600, color:'var(--kk-green)', fontSize:12 }}>${(o.total_value||0).toFixed(2)}</td>}
                        <td><span className={'badge badge-' + STATUS_COLORS[o.status]}>{STATUS_LABELS[o.status]}</span></td>
                        <td style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                          <button onClick={() => setViewOrder(o)} className="btn btn-secondary btn-sm">View</button>
                          {canEdit && <button onClick={() => startEditOrder(o)} className="btn btn-secondary btn-sm">Edit</button>}
                          {canEdit && <button onClick={() => updateStatus(o.id, o.status === 'archived' ? 'order_sheet' : 'archived')} className="btn btn-sm" style={{ background: o.status === 'archived' ? '#7e57c2' : 'var(--surface)', color: o.status === 'archived' ? '#fff' : 'var(--ink3)', border: '1px solid var(--border)' }}>{o.status === 'archived' ? '↩' : '🗄'}</button>}
                          {canEdit && <button onClick={async () => { if(window.confirm('Delete order ' + o.order_number + '?')) { await supabase.from('orders').delete().eq('id', o.id); await loadData() }}} className="btn btn-red btn-sm">Del</button>}
                        </td>
                      </tr>
                    )
                  })}
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
            <button className="modal-close" onClick={() => { setShowModal(false); resetForm() }}>&times;</button>
            <div className="modal-title">NEW ORDER</div>
            <div className="field"><label>Customer</label><CustomerSelect customers={customers} value={form.customer_name} onChange={handleCustomerChange} onAddNew={handleAddNewCustomer} /></div>
            <div className="field-row">
              <div className="field" style={{ margin:0 }}><label>Order Source</label><select style={sel} value={form.order_source} onChange={e => setForm(f=>({...f,order_source:e.target.value}))}><option>Email</option><option>PO</option><option>Direct</option><option>KK Website</option></select></div>
              <div className="field" style={{ margin:0 }}><label>PO Number (optional)</label><input style={sel} value={form.po_number} onChange={e => setForm(f=>({...f,po_number:e.target.value}))} placeholder="e.g. PO-12345" /></div>
            </div>
            <div className="field-row">
              <div className="field" style={{ margin:0 }}><label>Packing Day</label><select style={sel} value={form.delivery_day} onChange={e => setForm(f=>({...f,delivery_day:e.target.value}))}><option value="">Select day...</option>{DELIVERY_DAYS.map(d => <option key={d}>{d}</option>)}</select></div>
              <div className="field" style={{ margin:0 }}><label>Dispatch Date</label><input type="date" style={sel} value={form.dispatch_date} onChange={e => setForm(f=>({...f,dispatch_date:e.target.value}))} /></div>
            </div>
            <div className="field">
              <label>Order Type</label>
              <div style={{ display:'flex', gap:0, border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden', marginBottom:8 }}>
                {[{ key:'cases', label:'📦 Cases' },{ key:'packs', label:'📦 Packs' },{ key:'bulk', label:'🧺 Bulk' },{ key:'mix', label:'🔀 Mix' }].map(m => (
                  <button key={m.key} onClick={() => setForm(f => ({ ...f, order_input_mode: m.key }))} style={{ flex:1, padding:'10px 8px', border:'none', cursor:'pointer', fontSize:12, fontFamily:'var(--display)', letterSpacing:0.5, textTransform:'uppercase', background: form.order_input_mode === m.key ? 'var(--kk-green)' : 'var(--surface)', color: form.order_input_mode === m.key ? 'var(--kk-cream)' : 'var(--ink3)', fontWeight: form.order_input_mode === m.key ? 700 : 400, borderRight: '1px solid var(--border)' }}>{m.label}</button>
                ))}
              </div>
              {!form.order_input_mode && <div style={{ fontSize:11, color:'var(--amber)' }}>⚠️ Select order type to continue</div>}
              {form.order_input_mode === 'cases' && <div style={{ fontSize:11, color:'var(--ink3)' }}>📦 Enter cases — display will show packs. PVBRG/KCOC = 12 pks/case · Cakes = 4 pks/case · Default = 6 pks/case</div>}
              {form.order_input_mode === 'packs' && <div style={{ fontSize:11, color:'var(--ink3)' }}>📦 Enter pack count directly.</div>}
              {form.order_input_mode === 'bulk' && <div style={{ fontSize:11, color:'var(--ink3)' }}>🧺 Enter units. Products auto-switch to bulk codes.</div>}
              {form.order_input_mode === 'mix' && <div style={{ fontSize:11, color:'var(--ink3)' }}>🔀 Set Pack or Bulk per item.</div>}
            </div>
            {form.order_input_mode && (
              <div className="field">
                <label>Order Input</label>
                <div style={{ display:'flex', gap:0, marginBottom:10, border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>
                  {['upload','paste'].map(mode => (
                    <button key={mode} onClick={() => setInputMode(mode)} style={{ flex:1, padding:'8px 12px', border:'none', cursor:'pointer', fontSize:12, fontFamily:'var(--display)', letterSpacing:1, textTransform:'uppercase', background: inputMode===mode ? 'var(--kk-green)' : 'var(--surface)', color: inputMode===mode ? 'var(--kk-cream)' : 'var(--ink3)' }}>{mode === 'upload' ? '📎 Upload' : '📋 Paste Text'}</button>
                  ))}
                </div>
                {inputMode === 'upload' && (<>
                  <input ref={fileInputRef} type="file" accept="image/*,application/pdf" onChange={handleAttachment} style={{ display:'none' }} />
                  <button className="btn btn-secondary btn-full" onClick={() => fileInputRef.current.click()}>{form.attachment ? '📎 Change Attachment' : '📎 Upload Photo or PDF'}</button>
                  {form.attachment_preview && form.attachment?.type?.includes('image') && <img src={form.attachment_preview} alt="Order" style={{ width:'100%', maxHeight:150, objectFit:'contain', borderRadius:6, marginTop:8, background:'#f5f5f5' }} />}
                  {form.attachment && !form.attachment?.type?.includes('image') && <div style={{ marginTop:8, fontSize:12, color:'var(--kk-green)' }}>✅ {form.attachment.name}</div>}
                </>)}
                {inputMode === 'paste' && (<>
                  <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="Paste the order email or text here..." style={{ width:'100%', minHeight:120, padding:'10px 14px', border:'1.5px solid var(--border)', borderRadius:'var(--radius)', fontFamily:'var(--body)', fontSize:12, background:'var(--surface)', color:'var(--ink)', outline:'none', resize:'vertical', boxSizing:'border-box' }} />
                  <button className="btn btn-green btn-full" style={{ marginTop:8 }} onClick={handlePasteRead} disabled={aiLoading || !pasteText.trim()}>{aiLoading ? '⏳ Reading...' : '🤖 Read Order with AI'}</button>
                </>)}
              </div>
            )}
            {aiLoading && inputMode === 'upload' && <div style={{ background:'var(--blue-l)', border:'1px solid var(--blue)', borderRadius:6, padding:'10px 14px', fontSize:12, color:'var(--blue)', marginBottom:12 }}>⏳ Reading order with AI...</div>}
            {unmatchedItems.length > 0 && (
              <div style={{ background:'var(--amber-l)', border:'1px solid var(--amber)', borderRadius:6, padding:12, marginBottom:12 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#9E5A3E', marginBottom:8 }}>⚠️ {unmatchedItems.length} item(s) not matched:</div>
                {unmatchedItems.map((item, idx) => (
                  <div key={idx} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:6 }}>
                    <span style={{ fontSize:12, flex:1 }}>{item.product_name} × {item.quantity}</span>
                    <select style={{ ...sel, width:'auto', flex:2, padding:'6px 10px' }} onChange={e => handleUnmatchedSelect(idx, e.target.value)} defaultValue=""><option value="">Select product...</option>{products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}</select>
                    <button onClick={() => setUnmatchedItems(prev => prev.filter((_,i)=>i!==idx))} style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:16 }}>&times;</button>
                  </div>
                ))}
              </div>
            )}
            {orderItems.length > 0 && (
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, letterSpacing:2, textTransform:'uppercase', color:'var(--ink3)', marginBottom:8, fontFamily:'var(--display)' }}>Order Items ({orderItems.length})</div>
                {orderItems.map((item, idx) => {
                  const isBulk = item.item_type === 'bulk'
                  const ppc = PACKS_PER_CASE_MAP[item.product_code] || item.packs_per_case || 6
                  const upp = item.units_per_pack || 1
                  return (
                    <div key={idx} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6, background:'var(--surface2)', padding:'8px 10px', borderRadius:6, flexWrap:'wrap' }}>
                      <div style={{ flex:3, minWidth:180 }}>
                        {form.order_input_mode === 'mix' && (
                          <div style={{ display:'flex', border:'1px solid var(--border)', borderRadius:4, overflow:'hidden', marginBottom:4 }}>
                            {['pack','bulk'].map(t => (
                              <button key={t} onClick={() => {
                                const isBulkT = t === 'bulk'; let newCode = item.product_code
                                if (isBulkT && BULK_MAP[item.product_code]) newCode = BULK_MAP[item.product_code]
                                if (!isBulkT) { const rev = Object.entries(BULK_MAP).find(([, v]) => v === item.product_code); if (rev) newCode = rev[0] }
                                const p = products.find(p => p.code === newCode)
                                updateItem(idx, 'item_type', t)
                                updateItem(idx, 'input_mode', isBulkT ? 'units' : 'packs')
                                updateItem(idx, 'product_code', newCode)
                                updateItem(idx, 'product_name', p?.name || item.product_name)
                                updateItem(idx, 'price_per_pack', p?.price_per_pack || 0)
                              }} style={{ flex:1, padding:'3px 8px', border:'none', cursor:'pointer', fontSize:10, fontFamily:'var(--display)', textTransform:'uppercase', background: (item.item_type || 'pack') === t ? '#E79B81' : 'var(--surface)', color: (item.item_type || 'pack') === t ? '#fff' : 'var(--ink3)' }}>{t}</button>
                            ))}
                          </div>
                        )}
                        <select style={{ ...sel, padding:'6px 10px', fontSize:12 }} value={item.product_code || ''} onChange={e => {
                          const p = products.find(p => p.code === e.target.value)
                          const newPpc = PACKS_PER_CASE_MAP[e.target.value] || parseInt(p?.packs_per_case) || 6
                          const newUpp = UNITS_PER_PACK_MAP[e.target.value] || parseInt(p?.units_per_pack) || 1
                          updateItem(idx, 'product_code', p?.code || '')
                          updateItem(idx, 'product_name', p?.name || '')
                          updateItem(idx, 'price_per_pack', p?.price_per_pack || 0)
                          updateItem(idx, 'packs_per_case', newPpc)
                          updateItem(idx, 'units_per_pack', newUpp)
                          if (item.packs) updateItem(idx, 'quantity', item.packs * newUpp)
                        }}>
                          <option value="">{item.product_name || 'Select product...'}</option>
                          {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
                        </select>
                      </div>

                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        {isBulk
                          ? <span style={{ fontSize:10, color:'#E79B81', fontFamily:'var(--display)', letterSpacing:1, padding:'4px 8px', background:'#fff3ee', borderRadius:4 }}>UNITS</span>
                          : (form.order_input_mode === 'cases' && (
                            <span style={{ fontSize:10, color:'var(--ink3)', padding:'4px 6px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:4 }}>
                              1 case = {ppc} packs
                            </span>
                          ))
                        }
                        <input type="number"
                          value={isBulk ? (item.quantity || '') : (form.order_input_mode === 'cases' ? (item.cases || '') : (item.packs || ''))}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0
                            if (isBulk) {
                              updateItem(idx, 'quantity', val)
                            } else if (form.order_input_mode === 'cases') {
                              const packs = Math.round(val * ppc)
                              updateItem(idx, 'cases', val)
                              updateItem(idx, 'packs', packs)
                              updateItem(idx, 'quantity', packs * upp)
                            } else {
                              updateItem(idx, 'packs', Math.round(val))
                              updateItem(idx, 'cases', null)
                              updateItem(idx, 'quantity', Math.round(val) * upp)
                            }
                          }}
                          placeholder={isBulk ? 'Units' : form.order_input_mode === 'cases' ? 'Cases' : 'Packs'}
                          style={{ ...sel, width:70, padding:'6px 8px', fontSize:14, fontWeight:700 }} />
                        {/* Display: show packs result */}
                        {!isBulk && form.order_input_mode === 'cases' && item.packs && (
                          <span style={{ fontSize:12, color:'var(--kk-green)', fontWeight:700, whiteSpace:'nowrap' }}>
                            = {item.packs} pks
                          </span>
                        )}
                        {!isBulk && form.order_input_mode !== 'cases' && item.packs && (
                          <span style={{ fontSize:11, color:'var(--ink3)' }}>pks</span>
                        )}
                      </div>

                      <input type="text" value={item.notes || ''} placeholder="Notes" onChange={e => updateItem(idx,'notes',e.target.value)} style={{ ...sel, flex:1, minWidth:80, padding:'6px 8px', fontSize:11 }} />
                      <button onClick={() => removeItem(idx)} style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:18, lineHeight:1 }}>&times;</button>
                    </div>
                  )
                })}
              </div>
            )}
            <button className="btn btn-secondary btn-sm" onClick={addManualItem} style={{ marginBottom:12 }}>+ Add Item Manually</button>
            <div className="field"><label>Notes</label><textarea style={{ ...sel, minHeight:60 }} value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} placeholder="Special instructions..." /></div>
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-green btn-full" onClick={saveOrder} disabled={saving || !form.order_input_mode}>{saving ? 'Saving...' : 'Save Order'}</button>
              <button className="btn btn-secondary" onClick={() => { setShowModal(false); resetForm() }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW ORDER MODAL ── */}
      {viewOrder && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setViewOrder(null)}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <button className="modal-close" onClick={() => setViewOrder(null)}>&times;</button>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexWrap:'wrap', gap:8 }}>
              <div>
                <div className="modal-title" style={{ marginBottom:4 }}>{viewOrder.customer_name}</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <span className="code-tag">{viewOrder.order_number}</span>
                  {viewOrder.slip_number && <span style={{ fontSize:11, color:'var(--ink3)', fontFamily:'var(--mono)' }}>{viewOrder.slip_number}</span>}
                  <span className={'badge badge-' + STATUS_COLORS[viewOrder.status]}>{STATUS_LABELS[viewOrder.status]}</span>
                  <span style={{ fontSize:11, color:'var(--ink3)' }}>{viewOrder.order_source}{viewOrder.po_number ? ' · PO: ' + viewOrder.po_number : ''}</span>
                </div>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => printDispatchSlip([viewOrder])}>🖨️ Print Slip</button>
                {canEdit && <button className="btn btn-amber btn-sm" onClick={() => startEditOrder(viewOrder)}>✏️ Edit</button>}
                {canEdit && <button className="btn btn-red btn-sm" onClick={async () => { if(window.confirm('Delete order ' + viewOrder.order_number + '?')) { await supabase.from('orders').delete().eq('id', viewOrder.id); setViewOrder(null); await loadData() }}}>🗑️ Delete</button>}
              </div>
            </div>
            {canEdit && (
              <div style={{ display:'flex', gap:6, marginBottom:16 }}>
                <button onClick={() => updateStatus(viewOrder.id, viewOrder.status === 'archived' ? 'order_sheet' : 'archived')} style={{ padding:'6px 14px', borderRadius:20, border:'1px solid var(--border)', cursor:'pointer', fontSize:11, fontFamily:'var(--display)', letterSpacing:1, textTransform:'uppercase', background: viewOrder.status === 'archived' ? '#7e57c2' : 'var(--surface)', color: viewOrder.status === 'archived' ? '#fff' : 'var(--ink3)' }}>{viewOrder.status === 'archived' ? '↩ Unarchive' : '🗄 Archive'}</button>
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16, fontSize:12 }}>
              <div><span style={{ color:'var(--ink3)' }}>Packing Day:</span> <strong>{viewOrder.delivery_day || '—'}</strong></div>
              <div><span style={{ color:'var(--ink3)' }}>Dispatch Date:</span> <strong>{viewOrder.dispatch_date || '—'}</strong></div>
              {isAdmin && <div><span style={{ color:'var(--ink3)' }}>Total Value:</span> <strong style={{ color:'var(--kk-green)' }}>${(viewOrder.total_value||0).toFixed(2)}</strong></div>}
              <div><span style={{ color:'var(--ink3)' }}>Created by:</span> <strong>{viewOrder.created_by_name}</strong></div>
            </div>
            {viewOrder.order_attachment_url && <div style={{ marginBottom:16 }}><a href={viewOrder.order_attachment_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">📎 View Original Order</a></div>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Code</th>
                    <th>Packs</th>
                    {isAdmin && <th>Pack $</th>}
                    {isAdmin && <th>Line Total</th>}
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewOrder.order_items || []).map(item => {
                    const isBulk = item.item_type === 'bulk' || (item.product_code && BULK_CODES.has(item.product_code))
                    const packs = isBulk ? null : getItemPacks(item)
                    const lineTotal = isBulk ? (item.quantity * (item.price_per_pack || 0)) : (packs * (item.price_per_pack || 0))
                    return (
                      <tr key={item.id}>
                        <td style={{ fontWeight:500, fontSize:12 }}>{item.product_name}</td>
                        <td>{item.product_code ? <span className="code-tag">{item.product_code}</span> : '—'}</td>
                        <td style={{ fontWeight:700, color: isBulk ? 'var(--blue)' : 'var(--kk-green)', fontSize:13 }}>
                          {isBulk ? `${item.quantity} units` : `${packs} packs`}
                        </td>
                        {isAdmin && <td style={{ fontSize:11, color:'var(--ink3)' }}>${(item.price_per_pack||0).toFixed(2)}</td>}
                        {isAdmin && <td style={{ fontSize:11, fontWeight:600, color:'var(--kk-green)' }}>${lineTotal.toFixed(2)}</td>}
                        <td style={{ fontSize:11, color:'var(--ink3)' }}>{item.notes || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {viewOrder.notes && <div style={{ marginTop:12, padding:'10px 14px', background:'var(--surface2)', borderRadius:6, fontSize:12, color:'var(--ink2)' }}>📝 {viewOrder.notes}</div>}
          </div>
        </div>
      )}

      {/* ── EDIT ORDER MODAL ── */}
      {editingOrder && (
        <div className="modal-bg" onClick={e => e.target===e.currentTarget && setEditingOrder(null)}>
          <div className="modal" style={{ maxWidth: 640 }}>
            <button className="modal-close" onClick={() => setEditingOrder(null)}>&times;</button>
            <div className="modal-title">EDIT ORDER — {editingOrder.order_number}</div>
            <div style={{ fontSize:13, color:'var(--ink3)', marginBottom:16 }}>{editingOrder.customer_name} · {editingOrder.slip_number}</div>
            <div className="field-row">
              <div className="field" style={{ margin:0 }}><label>Order Source</label><select style={sel} value={editingOrder.order_source} onChange={e => setEditingOrder(o=>({...o,order_source:e.target.value}))}><option>Email</option><option>PO</option><option>Direct</option><option>KK Website</option></select></div>
              <div className="field" style={{ margin:0 }}><label>PO Number</label><input style={sel} value={editingOrder.po_number || ''} onChange={e => setEditingOrder(o=>({...o,po_number:e.target.value}))} placeholder="e.g. PO-12345" /></div>
            </div>
            <div className="field-row">
              <div className="field" style={{ margin:0 }}><label>Packing Day</label><select style={sel} value={editingOrder.delivery_day || ''} onChange={e => setEditingOrder(o=>({...o,delivery_day:e.target.value}))}><option value="">Select day...</option>{DELIVERY_DAYS.map(d => <option key={d}>{d}</option>)}</select></div>
              <div className="field" style={{ margin:0 }}><label>Dispatch Date</label><input type="date" style={sel} value={editingOrder.dispatch_date || ''} onChange={e => setEditingOrder(o=>({...o,dispatch_date:e.target.value}))} /></div>
            </div>
            <div className="field"><label>Status</label><select style={sel} value={editingOrder.status} onChange={e => setEditingOrder(o=>({...o,status:e.target.value}))}><option value="order_sheet">Active</option><option value="archived">Archived</option></select></div>
            <div style={{ fontSize:11, letterSpacing:2, textTransform:'uppercase', color:'var(--ink3)', marginBottom:8, fontFamily:'var(--display)' }}>Order Items ({editItems.length})</div>
            {editItems.map((item, idx) => {
              const isBulk = item.item_type === 'bulk'
              const ppc = PACKS_PER_CASE_MAP[item.product_code] || item.packs_per_case || 6
              const upp = item.units_per_pack || UNITS_PER_PACK_MAP[item.product_code] || 1
              return (
                <div key={idx} style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6, background:'var(--surface2)', padding:'8px 10px', borderRadius:6, flexWrap:'wrap' }}>
                  <div style={{ flex:3, minWidth:180 }}>
                    <select style={{ ...sel, padding:'6px 10px', fontSize:12 }} value={item.product_code || ''} onChange={e => {
                      const p = products.find(p => p.code === e.target.value)
                      updateEditItem(idx, 'product_code', p?.code || '')
                      updateEditItem(idx, 'product_name', p?.name || '')
                      updateEditItem(idx, 'price_per_pack', p?.price_per_pack || 0)
                      updateEditItem(idx, 'packs_per_case', PACKS_PER_CASE_MAP[p?.code] || parseInt(p?.packs_per_case) || 6)
                      updateEditItem(idx, 'units_per_pack', UNITS_PER_PACK_MAP[p?.code] || parseInt(p?.units_per_pack) || 1)
                    }}>
                      <option value="">{item.product_name || 'Select product...'}</option>
                      {products.map(p => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
                    </select>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    {isBulk
                      ? <span style={{ fontSize:10, color:'#E79B81', fontFamily:'var(--display)', letterSpacing:1, padding:'4px 8px', background:'#fff3ee', borderRadius:4 }}>UNITS</span>
                      : <span style={{ fontSize:10, color:'var(--ink3)' }}>packs</span>
                    }
                    <input type="number"
                      value={isBulk ? (item.quantity || '') : (item.packs || Math.round((item.quantity || 0) / Math.max(1, upp)) || '')}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0
                        if (isBulk) {
                          updateEditItem(idx, 'quantity', val)
                        } else {
                          updateEditItem(idx, 'packs', Math.round(val))
                          updateEditItem(idx, 'quantity', Math.round(val) * upp)
                          updateEditItem(idx, 'cases', null)
                        }
                      }}
                      style={{ ...sel, width:70, padding:'6px 8px', fontSize:14, fontWeight:700 }} />
                  </div>
                  <input type="text" value={item.notes || ''} placeholder="Notes" onChange={e => updateEditItem(idx,'notes',e.target.value)} style={{ ...sel, flex:1, minWidth:80, padding:'6px 8px', fontSize:11 }} />
                  <button onClick={() => removeEditItem(idx)} style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:18, lineHeight:1 }}>&times;</button>
                </div>
              )
            })}
            <button className="btn btn-secondary btn-sm" onClick={addEditItem} style={{ marginBottom:12 }}>+ Add Item</button>
            <div className="field"><label>Notes</label><textarea style={{ ...sel, minHeight:60 }} value={editingOrder.notes || ''} onChange={e => setEditingOrder(o=>({...o,notes:e.target.value}))} placeholder="Special instructions..." /></div>
            <div style={{ display:'flex', gap:10 }}>
              <button className="btn btn-green btn-full" onClick={saveEditOrder} disabled={editSaving}>{editSaving ? 'Saving...' : 'Save Changes'}</button>
              <button className="btn btn-secondary" onClick={() => setEditingOrder(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
