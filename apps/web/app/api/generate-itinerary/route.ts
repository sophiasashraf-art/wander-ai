import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import { geocodePlace } from '../../../lib/placeIngestion'

const openai = new OpenAI()

// Category-aware default hour
const CATEGORY_HOUR: Record<string, number> = {
  cafe: 9, bakery: 8, breakfast: 8, coffee: 9, brunch: 10,
  market: 10, park: 10, garden: 10, hike: 9, trail: 9, nature: 10,
  lunch: 12, food: 12,
  museum: 14, gallery: 14, shopping: 15, landmark: 14, monument: 14,
  temple: 14, church: 14, tour: 14,
  beach: 11, viewpoint: 17, sunset: 18,
  restaurant: 19, dinner: 19, bar: 20, nightlife: 21, pub: 20, club: 22,
}
function defaultHour(cat: string): number {
  const c = (cat || '').toLowerCase()
  for (const [k, h] of Object.entries(CATEGORY_HOUR)) if (c.includes(k)) return h
  return 14
}

// Hard time windows: [earliest, latest] in 24h minutes
// If GPT assigns a time outside this window, clamp it to the default
const CATEGORY_WINDOW: Record<string, [number, number]> = {
  cafe:       [7*60,  11*60],  // 7am–11am
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

function clampToWindow(timeStr: string, category: string): string {
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

  // Outside window — use the default hour for this category
  return fmtHour(defaultHour(category))
}
function fmtHour(h: number): string {
  const hh = h % 24
  return `${hh % 12 || 12}:00 ${hh < 12 ? 'AM' : 'PM'}`
}
function parseMin(t: string): number {
  const m = t?.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 0
  let h = parseInt(m[1]); const min = parseInt(m[2])
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
  return h * 60 + min
}
function fmtMin(mins: number): string {
  const total = Math.round(mins)
  const h = Math.floor(total / 60) % 24
  const m = ((total % 60) + 60) % 60
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
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
// is what stops a day from bouncing between neighborhoods: same-day stops are
// already geographically close (see the day-bucketing fix above), but without
// this pass their assigned times — and therefore visiting order — were still
// arbitrary relative to each other.
const DAY_START_FLOOR = 7 * 60 + 30  // 7:30 AM — don't route a flexible stop earlier than this
const DAY_END_CAP = 22 * 60 + 30     // 10:30 PM — don't route one later than this

function routeStopsForDay(stops: any[]): any[] {
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
        // No next anchor to bound this run (trailing stops after the last meal) —
        // space by up to 90min but compress toward DAY_END_CAP if there isn't
        // room, rather than marching unboundedly into the middle of the night.
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

export async function POST(req: Request) {
  try {
    const { tripId, arrivalTime, departureTime, fromScratch } = await req.json()

    const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).single()
    const { data: places } = await supabase.from('places').select('*').eq('trip_id', tripId)

    const vibeConfig = {
      relaxed: { stopsPerDay: 3 },
      balanced: { stopsPerDay: 4 },
      everything: { stopsPerDay: 6 },
    }
    const config = vibeConfig[(trip?.vibe as keyof typeof vibeConfig) || 'balanced']
    const numDays = parseInt(trip?.duration) || 3

    // ── "Plan for me" mode: build entire itinerary from scratch ──
    if (fromScratch || !places || places.length === 0) {
      const vibeNotes: Record<string, string> = {
        relaxed: 'Slow pace, long meals, rest time between stops. Quality over quantity.',
        balanced: 'Good mix of sightseeing, food, and downtime.',
        everything: 'Pack in as much as possible. Maximize the trip.',
      }
      const vNote = vibeNotes[(trip?.vibe as string) || 'balanced']

      let timeConstraints = ''
      if (arrivalTime) timeConstraints += `\nDay 1: Traveler arrives at ${arrivalTime}. Do NOT schedule anything before this time.`
      if (departureTime) timeConstraints += `\nDay ${numDays}: Traveler departs at ${departureTime}. Do NOT schedule anything at or after this time.`

      const scratchRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `You are an expert travel planner. Build a complete ${numDays}-day itinerary for ${trip?.destination}.

Style: ${vNote}
Stops per day: ${config.stopsPerDay}
${timeConstraints}

Rules:
- Only suggest real, well-known, highly-rated places
- Assign realistic times based on category:
  • Cafes/breakfast → 8–10 AM
  • Parks/markets/hikes → 10 AM–12 PM
  • Lunch restaurants → 12–2 PM
  • Museums/galleries/landmarks → 2–5 PM
  • Dinner restaurants → 7–9 PM
  • Bars/nightlife → 9 PM+
- Group geographically close places on the same day
- Give each day a descriptive title (area or theme)
- Write a one-sentence tip/note for each stop
- Mark every stop with "suggested": true
- Order stops chronologically within each day

Return valid JSON:
{"days": [{"day": 1, "title": "...", "stops": [{"time": "9:00 AM", "name": "...", "category": "...", "note": "...", "suggested": true}]}]}`,
        }, {
          role: 'user',
          content: `Plan a ${numDays}-day trip to ${trip?.destination} with ${config.stopsPerDay} stops per day.`,
        }],
        response_format: { type: 'json_object' },
      })

      const scratchResult = JSON.parse(scratchRes.choices[0].message.content || '{"days":[]}')

      // Geocode every stop — without this the workspace has no coordinates to put
      // on the map and silently falls back to a map-less list view.
      const allStopNames = (scratchResult.days || []).flatMap((d: any) => d.stops.map((s: any) => s.name))
      const geocoded = await Promise.all(
        allStopNames.map((name: string) => geocodePlace(name, trip?.destination || ''))
      )
      const coordMap: Record<string, { lat: number; lng: number; address?: string }> = {}
      allStopNames.forEach((name: string, i: number) => {
        if (geocoded[i]) coordMap[name] = geocoded[i]!
      })

      const geocodedDays = (scratchResult.days || []).map((day: any) => ({
        ...day,
        stops: day.stops.map((stop: any) => ({
          ...stop,
          lat: coordMap[stop.name]?.lat,
          lng: coordMap[stop.name]?.lng,
          address: coordMap[stop.name]?.address,
        })),
      }))

      return NextResponse.json({ days: geocodedDays })
    }

    // ── Step 1: Assign places to days IN CODE ──
    // Use geocoded places if available, fall back to all
    const geocoded = places.filter((p: any) => p.lat && p.lng)
    const allPool = geocoded.length > 0 ? geocoded : places

    // Build a coord lookup so we can re-attach lat/lng to stops later
    const coordLookup: Record<string, { lat: number; lng: number; opening_hours?: string[]; photo_reference?: string; rating?: number; price_level?: number; address?: string; tip?: string; why_recommended?: string; source_url?: string }> = {}
    allPool.forEach((p: any) => {
      if (p.lat && p.lng) coordLookup[p.name.toLowerCase().trim()] = {
        lat: p.lat, lng: p.lng,
        opening_hours: p.opening_hours,
        photo_reference: p.photo_reference,
        rating: p.rating,
        price_level: p.price_level,
        address: p.address,
        tip: p.tip,
        why_recommended: p.why_recommended,
        source_url: p.source_url,
      }
    })

    const pool = allPool.slice(0, config.stopsPerDay * numDays)

    const geocodedPool = pool.filter((p: any) => p.lat && p.lng)
    const ungeocodedPool = pool.filter((p: any) => !(p.lat && p.lng))

    // Build day buckets
    const buckets: any[][] = Array.from({ length: numDays }, () => [])

    if (geocodedPool.length > 0) {
      // Geo-cluster always, not just for multi-city-scale trips — a compact single
      // city still has real neighborhoods, and a category-based round robin (the
      // old approach here) ignored location entirely, so a day could easily end up
      // with a cafe on one side of town and dinner back near it, with a museum
      // across the city in between. Sort along whichever axis actually separates
      // the places (a city that's long north-south should cluster by lat, not
      // lng, or every day-block would span the full width) and slice into
      // contiguous day-sized blocks.
      const lngs = geocodedPool.map((p: any) => p.lng)
      const lats = geocodedPool.map((p: any) => p.lat)
      const lngSpread = geocodedPool.length > 1 ? Math.max(...lngs) - Math.min(...lngs) : 0
      const latSpread = geocodedPool.length > 1 ? Math.max(...lats) - Math.min(...lats) : 0
      const sortKey: 'lat' | 'lng' = latSpread > lngSpread ? 'lat' : 'lng'
      const sorted = [...geocodedPool].sort((a: any, b: any) => a[sortKey] - b[sortKey])
      sorted.forEach((p, i) => {
        const day = Math.min(Math.floor(i * numDays / sorted.length), numDays - 1)
        if (buckets[day].length < config.stopsPerDay) buckets[day].push(p)
      })
    }

    // Places with no coordinates can't be geo-clustered — spread them round-robin
    // across whichever days still have room (rare: only happens if Places lookup
    // failed for a place entirely).
    if (ungeocodedPool.length > 0) {
      let dayIdx = 0
      for (const p of ungeocodedPool) {
        let attempts = 0
        while (buckets[dayIdx].length >= config.stopsPerDay && attempts < numDays) {
          dayIdx = (dayIdx + 1) % numDays
          attempts++
        }
        if (attempts < numDays) {
          buckets[dayIdx].push(p)
          dayIdx = (dayIdx + 1) % numDays
        }
      }
    }

    console.log('Buckets:', buckets.map((b, i) => `Day ${i+1}: ${b.map((p:any)=>p.name).join(', ')}`))

    // ── Step 2: Ask GPT to add times, titles, notes ONLY ──
    // Build a prompt where each day's places are clearly listed
    const dayDescriptions = buckets.map((bucket, i) => {
      if (bucket.length === 0) return `Day ${i + 1}: (no places assigned — leave stops empty)`
      return `Day ${i + 1}: ${bucket.map((p: any) => `${p.name} [${p.category}]`).join(', ')}`
    }).join('\n')

    const gptRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a travel planner. The places have already been assigned to specific days — you MUST NOT move any place to a different day.

Your only jobs:
1. Give each day a short title (area or theme)
2. Assign a realistic time to each place. Follow these rules STRICTLY — do not deviate:
   - cafe / coffee / bakery / breakfast → 8:00 AM – 10:00 AM ONLY. Never in the afternoon or evening.
   - brunch → 10:00 AM – 12:00 PM
   - park / market / hike / trail / nature → 9:00 AM – 12:00 PM
   - museum / gallery / landmark / monument / temple / church → 10:00 AM – 5:00 PM
   - shopping → 11:00 AM – 6:00 PM
   - tour → 10:00 AM – 4:00 PM
   - beach → 10:00 AM – 6:00 PM
   - viewpoint → 10:00 AM or 5:30 PM
   - sunset → 5:30 PM – 7:30 PM
   - lunch / food (if category is lunch) → 12:00 PM – 1:30 PM
   - restaurant (dinner) → 7:00 PM. If two restaurants on same day: one at 12:30 PM (lunch) + one at 7:00 PM (dinner)
   - bar / pub → 8:00 PM – 10:00 PM
   - nightlife / club → 10:00 PM or later${arrivalTime ? `\n   - Day 1 constraint: traveler arrives at ${arrivalTime} — do NOT schedule anything before this time on Day 1` : ''}${departureTime ? `\n   - Day ${numDays} constraint: traveler departs at ${departureTime} — do NOT schedule anything at or after this time on Day ${numDays}` : ''}
3. Write a one-sentence "note" tip for each place
4. Include ALL days in your response, even empty ones (stops: [])

Return valid JSON:
{"days": [{"day": 1, "title": "...", "stops": [{"time": "10:00 AM", "name": "exact name", "category": "...", "note": "...", "suggested": false}]}]}`,
      }, {
        role: 'user',
        content: `Destination: ${trip?.destination}
Total days: ${numDays}

Places assigned to each day (DO NOT change these assignments):
${dayDescriptions}

Return all ${numDays} days with times and titles.`,
      }],
      response_format: { type: 'json_object' },
    })

    const gptResult = JSON.parse(gptRes.choices[0].message.content || '{"days":[]}')
    console.log('GPT result:', gptResult.days?.map((d: any) => `Day ${d.day}: ${d.stops?.length} stops`))

    // ── Step 3: Validate GPT output — rebuild any day that got wrong stop count ──
    const gptByDay: Record<number, any> = {}
    gptResult.days?.forEach((d: any) => { gptByDay[d.day] = d })

    let finalDays = buckets.map((bucket, i) => {
      const dayNum = i + 1
      const gptDay = gptByDay[dayNum]

      // Accept GPT's version if it has the right stops (by name match)
      if (gptDay?.stops) {
        const gptNames = new Set(gptDay.stops.map((s: any) => s.name.toLowerCase().trim()))
        const bucketNames = bucket.map((p: any) => p.name.toLowerCase().trim())
        const allPresent = bucketNames.every(n => gptNames.has(n))
        if (allPresent) return gptDay
      }

      // GPT moved stops around — rebuild this day with default times
      const stops = bucket.map((p: any) => ({
        time: fmtHour(defaultHour(p.category)),
        name: p.name,
        category: p.category,
        note: '',
        suggested: false,
        lat: p.lat,
        lng: p.lng,
        opening_hours: p.opening_hours,
        photo_reference: p.photo_reference,
        rating: p.rating,
        price_level: p.price_level,
        address: p.address,
      }))
      stops.sort((a: any, b: any) => parseMin(a.time) - parseMin(b.time))
      return { day: dayNum, title: gptDay?.title || `Day ${dayNum}`, stops }
    })

    // ── Step 4: Fill thin days, and days missing an evening stop, with suggestions ──
    // days needing MORE stops overall, plus days that have stops but none in the evening
    const daysNeedingEvening = finalDays.filter((d: any) =>
      d.stops.length > 0 && !d.stops.some((s: any) => parseMin(s.time) >= 17 * 60)
    )
    const thinDays = finalDays.filter((d: any) =>
      d.stops.length < 2 || daysNeedingEvening.some((e: any) => e.day === d.day)
    )
    if (thinDays.length > 0) {
      const step2Res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Suggest ADDITIONAL real, well-known places in the destination to round out the given days. Mark each with "suggested": true. Aim for ${config.stopsPerDay} total stops per day (existing + new). If a day has no evening (7-9 PM) stop, include one dinner or bar suggestion timed accordingly. Return ONLY the new stops to add for each day — do not repeat the existing stops back.`,
        }, {
          role: 'user',
          content: `Destination: ${trip?.destination}.

Days and their existing stops:
${JSON.stringify(thinDays.map((d: any) => ({ day: d.day, existingStops: d.stops.map((s: any) => ({ name: s.name, time: s.time, category: s.category })) })), null, 2)}

Already scheduled anywhere in the trip (don't repeat these):
${JSON.stringify(finalDays.flatMap((d: any) => d.stops.map((s: any) => s.name)), null, 2)}

Return JSON: {"days": [{"day": 1, "stops": [{"time": "7:00 PM", "name": "...", "category": "...", "note": "...", "suggested": true}]}]}`,
        }],
        response_format: { type: 'json_object' },
      })

      const step2 = JSON.parse(step2Res.choices[0].message.content || '{"days":[]}')
      step2.days?.forEach((filled: any) => {
        const idx = finalDays.findIndex((d: any) => d.day === filled.day)
        if (idx === -1) return
        const existingNames = new Set(finalDays[idx].stops.map((s: any) => s.name.toLowerCase().trim()))
        let newStops = (filled.stops || []).filter((s: any) => !existingNames.has((s.name || '').toLowerCase().trim()))
        // GPT is asked to "aim for stopsPerDay total" but nothing enforced that —
        // it would routinely suggest more than needed, piling days up well past
        // the target (and, once routed, past reasonable hours). Cap it here:
        // keep an evening suggestion first if this day needed one, then fill the
        // rest of the remaining room in the order GPT returned them.
        const room = Math.max(0, config.stopsPerDay - finalDays[idx].stops.length)
        const neededEvening = daysNeedingEvening.some((e: any) => e.day === filled.day)
        if (neededEvening) {
          const eveningIdx = newStops.findIndex((s: any) => parseMin(s.time) >= 17 * 60)
          if (eveningIdx > 0) newStops = [newStops[eveningIdx], ...newStops.filter((_: any, i: number) => i !== eveningIdx)]
        }
        newStops = newStops.slice(0, room)
        finalDays[idx] = { ...finalDays[idx], stops: [...finalDays[idx].stops, ...newStops] }
      })
    }

    // ── Step 5: Sort stops chronologically, route them geographically, re-attach coords ──
    finalDays = finalDays.map((day: any) => {
      let stops = day.stops.map((s: any) => {
        const coords = coordLookup[s.name.toLowerCase().trim()]
        const rawTime = s.time || fmtHour(defaultHour(s.category))
        const clampedTime = clampToWindow(rawTime, s.category)
        return {
          ...s,
          time: clampedTime,
          // Re-attach coordinates and place details from DB (GPT strips these)
          ...(coords ? {
            lat: coords.lat,
            lng: coords.lng,
            opening_hours: coords.opening_hours,
            photo_reference: coords.photo_reference,
            rating: coords.rating,
            price_level: coords.price_level,
            address: coords.address,
            tip: coords.tip,
            why_recommended: coords.why_recommended,
            source_url: coords.source_url,
          } : {}),
        }
      })
      // If nothing is scheduled in the evening but a restaurant/bar is available,
      // anchor it to its category's evening default rather than trusting a GPT time
      // that technically passed the wide window check but isn't actually a dinner slot.
      const hasEveningStop = stops.some((s: any) => parseMin(s.time) >= 17 * 60)
      if (!hasEveningStop) {
        const anchorIdx = stops.findIndex((s: any) => ['restaurant', 'bar'].includes((s.category || '').toLowerCase()))
        if (anchorIdx !== -1) {
          const cat = stops[anchorIdx].category.toLowerCase()
          stops[anchorIdx] = { ...stops[anchorIdx], time: fmtHour(defaultHour(cat)) }
        }
      }

      stops.sort((a: any, b: any) => parseMin(a.time) - parseMin(b.time))

      // Reorder + retime the flexible (non-meal) stops around the fixed meal
      // anchors so the day's physical route doesn't backtrack across the city —
      // this is what actually fixes the zigzag; the plain time sort above just
      // establishes the anchors' order for it to route around.
      stops = routeStopsForDay(stops)

      for (let i = 1; i < stops.length; i++) {
        if (stops[i].category === stops[i-1].category) {
          const prev = parseMin(stops[i-1].time)
          const curr = parseMin(stops[i].time)
          if (curr <= prev + 30) {
            stops[i] = { ...stops[i], time: fmtMin(prev + 90) }
          }
        }
      }
      return { ...day, stops }
    })

    // ── Step 5.5: Remove stops that violate arrival/departure constraints ──
    if (arrivalTime || departureTime) {
      const toMins = (t: string) => {
        const [h, m] = t.split(':').map(Number)
        return h * 60 + (m || 0)
      }
      const arrivalMins = arrivalTime ? toMins(arrivalTime) : 0
      const departureMins = departureTime ? toMins(departureTime) : 24 * 60

      finalDays = finalDays.map((day: any, i: number) => {
        const isFirstDay = i === 0
        const isLastDay = i === finalDays.length - 1
        if (!isFirstDay && !isLastDay) return day
        const stops = day.stops.filter((s: any) => {
          const mins = parseMin(s.time)
          if (isFirstDay && arrivalTime && mins < arrivalMins) return false
          if (isLastDay && departureTime && mins >= departureMins) return false
          return true
        })
        return { ...day, stops }
      })
    }

    console.log('Final:', finalDays.map((d: any) => `Day ${d.day}: ${d.stops.length} stops`))

    // ── Step 6: Fill any missing notes in one batch ──
    const stopsNeedingNotes = finalDays.flatMap((d: any) =>
      d.stops.filter((s: any) => !s.note?.trim()).map((s: any) => ({ name: s.name, category: s.category }))
    )
    if (stopsNeedingNotes.length > 0) {
      const noteRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Write a short, specific one-sentence tip for each place — what to do, order, see, or experience there. Be concrete and useful, not generic. Return JSON: {"notes": {"place name": "tip..."}}`,
        }, {
          role: 'user',
          content: `Destination: ${trip?.destination}\n\nPlaces needing tips:\n${stopsNeedingNotes.map((s: any) => `- ${s.name} [${s.category}]`).join('\n')}`,
        }],
        response_format: { type: 'json_object' },
      })
      const noteResult = JSON.parse(noteRes.choices[0].message.content || '{"notes":{}}')
      const notes: Record<string, string> = noteResult.notes || {}
      finalDays = finalDays.map((day: any) => ({
        ...day,
        stops: day.stops.map((s: any) => ({
          ...s,
          note: s.note?.trim() || notes[s.name] || notes[s.name.toLowerCase()] || '',
        })),
      }))
    }

    return NextResponse.json({ days: finalDays })

  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
