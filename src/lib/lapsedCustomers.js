import { supabase } from './supabase'

// Who hasn't ordered lately? Uses the date an order came in (created_at), counts
// active + archived orders (drafts are ignored), and works out each customer's
// usual ordering rhythm so fortnightly stores aren't flagged after 8 days.

export const BUCKETS = [
  { key: 'b15', label: '15–29 days', min: 15, max: 29, color: '#c05621', bg: '#fdebe0' },
  { key: 'b30', label: '30+ days', min: 30, max: Infinity, color: '#c53030', bg: '#fde8e8' },
]

// Not store accounts — tracked separately, so left out of this report.
// Matches names containing these words, any customer whose `type` is one of EXCLUDED_TYPES,
// and the personal accounts listed by name below (add more here as needed).
const EXCLUDED_NAME_WORDS = /sample|website/i
const EXCLUDED_TYPES = ['sample', 'samples', 'website', 'personal', 'individual']
const EXCLUDED_NAMES = ['loriann pacenti', 'delivered cold']
export const isExcludedCustomer = (name, type) => {
  const n = String(name || '').trim().toLowerCase()
  return EXCLUDED_NAME_WORDS.test(n) || EXCLUDED_NAMES.includes(n) || EXCLUDED_TYPES.includes(String(type || '').trim().toLowerCase())
}

const localISO = (d) => d.toLocaleDateString('en-CA')
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000)
const median = (arr) => {
  if (!arr.length) return null
  const s = [...arr].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function fetchAll(buildQuery) {
  const out = []
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await buildQuery().range(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

export function bucketOf(days) {
  if (days === null) return null
  return BUCKETS.find(b => days >= b.min && days <= b.max) || null
}

export async function loadLapsedCustomers() {
  const [customers, orders] = await Promise.all([
    fetchAll(() => supabase.from('customers').select('*').order('name').order('id')),
    fetchAll(() => supabase.from('orders').select('id,customer_id,customer_name,created_at,total_value,status').neq('status', 'draft').order('created_at').order('id')),
  ])

  const today = localISO(new Date())
  const byId = {}, byName = {}
  customers.forEach(c => {
    const rec = { customer: c, dates: [], orders: [] }
    byId[c.id] = rec
    if (c.name) byName[c.name.trim().toLowerCase()] = rec
  })

  orders.forEach(o => {
    const nameKey = String(o.customer_name || '').trim().toLowerCase()
    let rec = (o.customer_id && byId[o.customer_id]) || byName[nameKey]
    if (!rec) {
      // Order for a customer that isn't in the customers table — still track it by name
      if (!nameKey) return
      rec = byName[nameKey] = { customer: { id: 'name:' + nameKey, name: o.customer_name }, dates: [], orders: [] }
    }
    const date = localISO(new Date(o.created_at))
    rec.orders.push({ date, value: num(o.total_value) })
  })

  const seen = new Set()
  const rows = []
  Object.values(byName).concat(Object.values(byId)).forEach(rec => {
    if (seen.has(rec)) return
    seen.add(rec)
    const c = rec.customer
    if (isExcludedCustomer(c.name, c.type)) return
    const dates = [...new Set(rec.orders.map(o => o.date))].sort()
    const first = dates[0] || null
    const last = dates[dates.length - 1] || null
    const daysSince = last ? dayDiff(today, last) : null

    // Ordering pattern = median days between the last (up to) 10 distinct order dates
    const recent = dates.slice(-11)
    const gaps = recent.slice(1).map((d, i) => dayDiff(d, recent[i]))
    const usualGap = gaps.length >= 2 ? Math.max(1, Math.round(median(gaps))) : null
    // Overdue = clearly past their own pattern (1.5× usual gap, never sooner than 7 days)
    const overdue = daysSince !== null && usualGap !== null && daysSince >= 7 && daysSince > usualGap * 1.5

    // Avg monthly order = order value over the last 6 months (or since their first order if newer), per 30 days
    const valueBetween = (fromDays, toDays) => rec.orders
      .filter(o => { const a = dayDiff(today, o.date); return a >= fromDays && a < toDays })
      .reduce((s, o) => s + o.value, 0)
    const historyDays = first ? Math.min(180, Math.max(30, dayDiff(today, first) + 1)) : 0
    const avgMonthly = historyDays ? valueBetween(0, historyDays) / (historyDays / 30) : 0

    // Trend = last 30 days vs their average 30 days over the 90 days before that
    const last30 = valueBetween(0, 30)
    const priorDays = first ? Math.min(90, Math.max(0, dayDiff(today, first) + 1 - 30)) : 0
    const prior30 = priorDays >= 15 ? valueBetween(30, 30 + priorDays) / (priorDays / 30) : null
    let trend = null, trendPct = null
    if (prior30 === null) trend = last30 > 0 ? 'new' : null
    else if (prior30 === 0) trend = last30 > 0 ? 'up' : 'flat'
    else {
      trendPct = (last30 - prior30) / prior30 * 100
      trend = trendPct > 10 ? 'up' : trendPct < -10 ? 'down' : 'flat'
    }

    rows.push({
      id: c.id, name: c.name, zone: c.zone || '',
      lastOrder: last, daysSince, usualGap, overdue,
      avgMonthly, last30, prior30, trend, trendPct,
      bucket: bucketOf(daysSince), never: !last,
    })
  })

  return rows
}

export function summarize(rows) {
  const count = (k) => rows.filter(r => r.bucket?.key === k).length
  return {
    b15: count('b15'), b30: count('b30'),
    overdue: rows.filter(r => r.overdue).length,
    never: rows.filter(r => r.never).length,
  }
}
