// Single source of truth for WIP cake-layer "slab" weights.
//
// These 12 WIP codes are tracked in whole-slab stock (wip_unit 'ea') but
// their BOM recipes are stored per-gram-of-finished-slab (2026-09-15
// rescale, see Production.jsx). Any file that needs to convert between
// "1 ea of this WIP" and its true gram weight — Production (raw-material
// deduction), Inventory (display), Costing (pricing) — should import
// SLAB_WEIGHT_G from here instead of keeping its own copy.
//
// Why this file exists: this exact map used to be copy-pasted separately
// into Production.jsx, Inventory.jsx, and Costing.jsx. When the 6"/9"/tray
// weights were fixed, Costing.jsx's copy was missed, and every finished
// good using one of these WIPs in 'ea' units silently priced that
// ingredient at ~$0.00 for two days. A single shared copy means a future
// change here only has to happen once — there's no second (or third) copy
// to forget.
export const SLAB_WEIGHT_G = {
  WIPKVCKE6: 270, WIPPVCKE6: 270, WIPKCCKE6: 270, WIPPCCKE6: 270, WIPkVCKE6: 270, WIPKLRCKE6: 270, // 6" slab
  WIPPVCKE9: 550, WIPPCCKE9: 550, // 9" slab
  WIPKCCKETR: 3000, WIPPCCKETR: 3000, WIPPVCKETR: 3000, WIPPCRTCKETR: 3000, // tray slab
}
