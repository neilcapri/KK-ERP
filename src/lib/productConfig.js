// Single source of truth for per-product settings: pack size, tray/log/cake yield
// and "made from another product's stock" links.
//
// The values live in the `products` table:
//   units_per_pack, tray_yield, log_yield, cake_yield, stock_base_code, stock_units_per_base
// Edit them there (or via SQL) and every page picks them up — no code change needed.
//
// How pages use this:
//   import { PACK_SIZE, TRAY_YIELD, LOG_YIELD, CAKE_YIELD, STOCK_ALIAS, loadProductConfig } from '../lib/productConfig'
//   ...inside the page's existing load function:   await loadProductConfig()
// PACK_SIZE / TRAY_YIELD / ... are plain objects exactly like the old per-page maps, so
// existing lookups like PACK_SIZE[code] keep working. They start out holding the built-in
// fallback values below and are overwritten in place with whatever the database says as soon
// as loadProductConfig() finishes. If the database can't be reached (or a product has no
// value there) the fallback value stays, so nothing ever breaks or reads 0.

import { supabase } from './supabase'

// ── Built-in fallback (last-resort copy of the database values, 2026-10) ──────────────────
const FALLBACK_PACK_SIZE = {
  VPB:3, VPCAN:3, PNF:3, PVBRG:1, PVBR:1, PBB:2, PCC:2, KLR:2, KSCD:4, VPBD:2, KHD:2,
  HPCo:5, KABIS:5, WSBIS:5, COBIS:5, KAB:5, KWAL:5, PVHC:5, POS:5, PGCo:5,
  KCOC:1, KSCo:5, PVBB:1, GBL:1, KPL:1, CCL:1, BAGL:4, PVFB:1,
  TRFCS:1, HRCS:1, VSCS:1, NALCOB:1, NBFB:1,
  KCC:1, KVC:1, KLRCup:1, KCCKE:1, KVCKE:1, KLRCKE:1,
  TRFC:1, PCrt:1, TMC:1, PRMC:1, CMC:1, LMC:1,
  TCKCU:1, KSCKCU:1, LCKCU:1, CCKCU:1, SFNL:1,
  PRMNTBG:2, // Peppermint Brownie Ganache Pouch — 2 per pack
}
const FALLBACK_TRAY_YIELD = {
  VPB:64, VPCAN:36, PNF:40, PVBRG:36, PVBR:12, VSCS:54, NALCOB:21, NBFB:21, HRCS:84,
  CMC:24, LMC:24, PRMC:24, TMC:24, CCB:17, PRMNTBG:36,
}
const FALLBACK_LOG_YIELD = { KABIS:11, WSBIS:10, COBIS:10 }
const FALLBACK_CAKE_YIELD = { TRFCS:8, PCrt:4 }
// code -> { base, unitsPerBase }: products with no stock of their own, made from `base`.
// units = base units consumed × unitsPerBase  (e.g. PVBBSL: 3 slices per PVBB loaf;
// VPB2P: 0.5 — each 2-pack uses 2 loose bars)
const FALLBACK_STOCK_ALIAS = {
  PBBBu:   { base: 'PBB',   unitsPerBase: 1 },
  PCCBu:   { base: 'PCC',   unitsPerBase: 1 },
  KLRBu:   { base: 'KLR',   unitsPerBase: 1 },
  KABBu:   { base: 'KAB',   unitsPerBase: 1 },
  KWALBu:  { base: 'KWAL',  unitsPerBase: 1 },
  HPCoBu:  { base: 'HPCo',  unitsPerBase: 1 },
  PVHCBu:  { base: 'PVHC',  unitsPerBase: 1 },
  VPCANBu: { base: 'VPCAN', unitsPerBase: 1 },
  VPBBu:   { base: 'VPB',   unitsPerBase: 1 },
  PNFBu:   { base: 'PNF',   unitsPerBase: 1 },
  KABISBu: { base: 'KABIS', unitsPerBase: 1 },
  KSCDBu:  { base: 'KSCD',  unitsPerBase: 1 },
  PVBBSL:  { base: 'PVBB',  unitsPerBase: 3 },
  PVBBSLF: { base: 'PVBB',  unitsPerBase: 3 },
  KLRCup:  { base: 'KLR',   unitsPerBase: 1 },
  VPB2P:   { base: 'VPB',   unitsPerBase: 0.5 },
  PNF2P:   { base: 'PNF',   unitsPerBase: 0.5 },
  VPCAN2P: { base: 'VPCAN', unitsPerBase: 0.5 },
}

// ── Live maps (same shape as the old per-page maps) ───────────────────────────────────────
export const PACK_SIZE   = { ...FALLBACK_PACK_SIZE }
export const TRAY_YIELD  = { ...FALLBACK_TRAY_YIELD }
export const LOG_YIELD   = { ...FALLBACK_LOG_YIELD }
export const CAKE_YIELD  = { ...FALLBACK_CAKE_YIELD }
export const STOCK_ALIAS = JSON.parse(JSON.stringify(FALLBACK_STOCK_ALIAS))

const CACHE_MS = 60 * 1000 // tabs left open all day re-read the database at most once a minute
let loadedAt = 0
let inflight = null

const pos = v => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function applyRows(rows) {
  for (const r of rows) {
    const code = r.code
    if (!code) continue
    const upp = pos(r.units_per_pack)
    if (upp != null) PACK_SIZE[code] = upp
    const tray = pos(r.tray_yield)
    if (tray != null) TRAY_YIELD[code] = tray
    const log = pos(r.log_yield)
    if (log != null) LOG_YIELD[code] = log
    const cake = pos(r.cake_yield)
    if (cake != null) CAKE_YIELD[code] = cake
    const per = pos(r.stock_units_per_base)
    if (r.stock_base_code && per != null) {
      STOCK_ALIAS[code] = { base: r.stock_base_code, unitsPerBase: per }
    }
  }
}

// Read the settings from the database into the live maps. Safe to call from every page's
// load function — results are cached for a minute and it never throws.
export function loadProductConfig({ force = false } = {}) {
  if (!force && loadedAt && Date.now() - loadedAt < CACHE_MS) return Promise.resolve(true)
  if (inflight) return inflight
  inflight = supabase
    .from('products')
    .select('code, units_per_pack, tray_yield, log_yield, cake_yield, stock_base_code, stock_units_per_base')
    .then(({ data, error }) => {
      if (error || !data) {
        console.warn('[productConfig] using built-in fallback values:', error && error.message)
        return false
      }
      applyRows(data)
      loadedAt = Date.now()
      return true
    })
    .catch(err => {
      console.warn('[productConfig] using built-in fallback values:', err && err.message)
      return false
    })
    .finally(() => { inflight = null })
  return inflight
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────
// Own units in one sellable pack (1 if unknown).
export const packSize = code => PACK_SIZE[code] || 1
// Units one tray / log / cake makes (undefined if the product has none).
export const trayYield = code => TRAY_YIELD[code]
export const logYield  = code => LOG_YIELD[code]
export const cakeYield = code => CAKE_YIELD[code]
// { base, unitsPerBase } or undefined.
export const stockAlias = code => STOCK_ALIAS[code]
