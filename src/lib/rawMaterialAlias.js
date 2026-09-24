// Single source of truth for raw-material name aliases.
//
// Some BOM ingredient names aren't their own separately-sourced/stocked raw
// material — they're made in-house from a different raw material that IS
// actually tracked. Consuming them in a recipe should deduct from (and be
// costed against) that real raw material's stock, not a stray same-named
// row that never gets restocked or priced.
//
// "Hazelnut Flour" and plain "Hazelnut" are both cases of this: neither is
// purchased/stocked on its own — they're ground in-house from whole
// Hazelnuts. Both rows in raw_materials sit at 0 stock / $0 price — so
// before this alias, PNF's "Hazelnut Flour" (5g) and PNF/HPCo's "Hazelnut"
// (6g/0.9g) lines were silently costing $0 and never deducting anything
// real. This maps both to "Hazelnuts" (the actual 30kg+ tracked stock)
// instead.
//
// Deliberately NOT included: "Hazelnut Butter" (used in KHD, PNF, HRCS,
// WIPNotella) is a genuinely different, separately-priced ingredient
// ($29.25/kg) — aliasing it to whole Hazelnuts ($19.83/kg) would apply the
// wrong price and misrepresent those recipes, even though it also happens
// to sit at 0 stock right now.
//
// Add more entries here — never re-duplicate this map into another file —
// whenever the same situation comes up again. Keys are matched
// case/whitespace-insensitively; values must be the exact raw_materials.name
// to resolve to.
export const RM_ALIAS = {
  'hazelnut flour': 'Hazelnuts',
  'hazelnut': 'Hazelnuts',
}

export function resolveRMName(name) {
  if (!name) return name
  const key = name.trim().toLowerCase()
  return RM_ALIAS[key] || name
}
