// Single source of truth for raw-material name aliases.
//
// Some BOM ingredient names aren't their own separately-sourced/stocked raw
// material — they're made in-house from a different raw material that IS
// actually tracked. Consuming them in a recipe should deduct from (and be
// costed against) that real raw material's stock, not a stray same-named
// row that never gets restocked or priced.
//
// "Hazelnut Flour" is the first case: it's ground in-house from whole
// Hazelnuts, not purchased/stocked on its own. The "Hazelnut Flour" row in
// raw_materials sits at 0 stock / $0 price — so before this alias, PNF's
// 5g of "Hazelnut Flour" per unit was silently costing $0 and never
// deducting anything real. This maps it to "Hazelnuts" (the actual
// 30kg+ tracked stock) instead.
//
// Add more entries here — never re-duplicate this map into another file —
// whenever the same situation comes up again. Keys are matched
// case/whitespace-insensitively; values must be the exact raw_materials.name
// to resolve to.
export const RM_ALIAS = {
  'hazelnut flour': 'Hazelnuts',
}

export function resolveRMName(name) {
  if (!name) return name
  const key = name.trim().toLowerCase()
  return RM_ALIAS[key] || name
}
