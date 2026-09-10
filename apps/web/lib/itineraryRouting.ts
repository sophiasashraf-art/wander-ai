// Time + geographic helpers for arranging a day's stops. Extracted from
// app/api/generate-itinerary so the agent's finalize step can reuse the exact
// same routing/time logic instead of re-deriving it.

// Category-aware default hour
export const CATEGORY_HOUR: Record<string, number> = {
  cafe: 9, bakery: 8, breakfast: 8, coffee: 9, brunch: 10,
  market: 10, park: 10, garden: 10, hike: 9, trail: 9, nature: 10,
  lunch: 12, food: 12,
  museum: 14, gallery: 14, shopping: 15, landmark: 14, monument: 14,
  temple: 14, church: 14, tour: 14,
  beach: 11, viewpoint: 17, sunset: 18,
  restaurant: 19, dinner: 19, bar: 20, nightlife: 21, pub: 20, club: 22,
}
export function defaultHour(cat: string): number {
  const c = (cat || '').toLowerCase()
  for (const [k, h] of Object.entries(CATEGORY_HOUR)) if (c.includes(k)) return h
  return 14
}

// Hard time windows: [earliest, latest] in 24h minutes. A time outside its
// category's window gets clamped back to the category default.
export const CATEGORY_WINDOW: Record<string, [number, number]> = {
  cafe:       [7*60,  11*60],
  coffee:     [7*60,  11*60],
  bakery:     [7*60,  11*60],
  breakfast:  [7*60,  11*60],
  brunch:     [9*60,  13*60],
  market:     [8*60,  14*60],
  park:       [8*60,  18*60],
  garden:     [8*60,  18*60],
  hike:       [7*60,  14*60],
  trail:      [7*60,  14*60],
  nature:     [8*60,  17*60],
  lunch:      [11*60, 14*60],
  museum:     [9*60,  18*60],
  gallery:    [10*60, 19*60],
  shopping:   [10*60, 20*60],
  landmark:   [8*60,  19*60],
  monument:   [8*60,  19*60],
  temple:     [8*60,  18*60],
  church:     [8*60,  18*60],
  tour:       [9*60,  17*60],
  beach:      [8*60,  19*60],
  viewpoint:  [8*60,  21*60],
  sunset:     [16*60, 21*60],
  restaurant: [11*60, 22*60],
  dinner:     [17*60, 22*60],
  bar:        [17*60, 24*60],
  pub:        [17*60, 24*60],
  nightlife:  [20*60, 28*60],
  club:       [21*60, 28*60],
}

export function clampToWindow(timeStr: string, category: string): string {
  const c = (category || '').toLowerCase()
  let window: [number, number] | null = null
  for (const [k, w] of Object.entries(CATEGORY_WINDOW)) {
    if (c.includes(k)) { window = w; break }
  }
  if (!window) return timeStr

  const mins = parseMin(timeStr)
  if (mins === 0) return timeStr // unparseable, leave it

  const [earliest, latest] = window
  if (mins >= earliest && mins <= latest) return timeStr
  return fmtHour(defaultHour(category))
}

export function fmtHour(h: number): string {
  const hh = h % 24
  return `${hh % 12 || 12}:00 ${hh < 12 ? 'AM' : 'PM'}`
}
export function parseMin(t: string): number {
  const m = t?.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 0
  let h = parseInt(m[1]); const min = parseInt(m[2])
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
  return h * 60 + min
}
export function fmtMin(mins: number): string {
  const total = Math.round(mins)
  const h = Math.floor(total / 60) % 24
  const m = ((total % 60) + 60) % 60
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Meal/nightlife stops have hard time windows (breakfast is breakfast) so their
// clock times stay fixed as route anchors. Everything else (museums, shopping,
// parks, landmarks...) has real flexibility in when it happens — so instead of
// trusting a category-default hour that ignores where the place actually is,
// insert each one wherever it adds the least extra travel between anchors. This
// is what stops a day from bouncing between neighborhoods.
export const DAY_START_FLOOR = 7 * 60 + 30  // 7:30 AM — don't route a flexible stop earlier than this
export const DAY_END_CAP = 22 * 60 + 30     // 10:30 PM — don't route one later than this

export function routeStopsForDay(stops: any[]): any[] {
  const isAnchor = (s: any) => ['cafe', 'coffee', 'bakery', 'breakfast', 'brunch', 'restaurant', 'bar', 'pub', 'nightlife', 'club'].includes((s.category || '').toLowerCase())
  const hasCoords = (s: any) => typeof s.lat === 'number' && typeof s.lng === 'number'

  const anchors = stops.filter(isAnchor).sort((a, b) => parseMin(a.time) - parseMin(b.time))
  const flexible = stops.filter(s => !isAnchor(s))
  if (flexible.filter(hasCoords).length === 0) return stops // nothing to route

  let route: any[]
  if (anchors.length === 0) {
    // No meal stops to anchor around — chain everything nearest-neighbor from
    // whichever stop was originally earliest, keep the original times' sequence.
    const sorted = [...flexible].sort((a, b) => parseMin(a.time) - parseMin(b.time))
    const withCoords = sorted.filter(hasCoords)
    const withoutCoords = sorted.filter(s => !hasCoords(s))
    if (withCoords.length < 2) return stops
    const chained: any[] = [withCoords[0]]
    const remaining = [...withCoords.slice(1)]
    while (remaining.length) {
      const last = chained[chained.length - 1]
      let bestIdx = 0, bestDist = Infinity
      remaining.forEach((s, i) => {
        const d = haversineKm(last, s)
        if (d < bestDist) { bestDist = d; bestIdx = i }
      })
      chained.push(remaining.splice(bestIdx, 1)[0])
    }
    const times = sorted.map(s => s.time)
    return [...chained.map((s, i) => ({ ...s, time: times[i] })), ...withoutCoords]
  }

  // Cheapest-insertion: for each flexible stop, find the position between two
  // consecutive route stops (or before the first / after the last) that adds
  // the least extra distance, and insert it there.
  route = [...anchors]
  for (const stop of flexible) {
    if (!hasCoords(stop)) { route.push(stop); continue }
    let bestPos = route.length
    let bestCost = Infinity
    for (let i = 0; i <= route.length; i++) {
      const prev = route[i - 1]
      const next = route[i]
      const prevOk = prev && hasCoords(prev)
      const nextOk = next && hasCoords(next)
      let cost = 0
      if (prevOk && nextOk) cost = haversineKm(prev, stop) + haversineKm(stop, next) - haversineKm(prev, next)
      else if (prevOk) cost = haversineKm(prev, stop)
      else if (nextOk) cost = haversineKm(stop, next)
      if (cost < bestCost) { bestCost = cost; bestPos = i }
    }
    route.splice(bestPos, 0, stop)
  }

  // Assign times: walk the route, and for each run of consecutive flexible
  // stops between two anchors (or a boundary), space them evenly across the gap.
  let i = 0
  while (i < route.length) {
    if (isAnchor(route[i])) { i++; continue }
    let j = i
    while (j < route.length && !isAnchor(route[j])) j++
    const prevTime = i > 0 ? parseMin(route[i - 1].time) : null
    const nextTime = j < route.length ? parseMin(route[j].time) : null
    const runLen = j - i
    for (let k = 0; k < runLen; k++) {
      let assigned: number
      if (prevTime !== null && nextTime !== null && nextTime > prevTime) {
        assigned = prevTime + (nextTime - prevTime) * (k + 1) / (runLen + 1)
      } else if (prevTime !== null) {
        const span = Math.max(DAY_END_CAP - prevTime, 30 * runLen)
        const step = Math.min(90, span / (runLen + 1))
        assigned = Math.min(prevTime + step * (k + 1), DAY_END_CAP)
      } else if (nextTime !== null) {
        const span = Math.max(nextTime - DAY_START_FLOOR, 30 * runLen)
        const step = Math.min(90, span / (runLen + 1))
        assigned = Math.max(nextTime - step * (runLen - k), DAY_START_FLOOR)
      } else {
        assigned = parseMin(route[i + k].time) || defaultHour(route[i + k].category) * 60
      }
      route[i + k] = { ...route[i + k], time: fmtMin(assigned) }
    }
    i = j
  }
  return route
}
