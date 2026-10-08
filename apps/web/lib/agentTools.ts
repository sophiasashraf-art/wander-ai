import { Client } from '@googlemaps/google-maps-services-js'
import { resolveCityRegion, geocodePlace } from './placeIngestion'
import { routeStopsForDay, haversineKm, parseMin, fmtMin, fmtHour, defaultHour, clampToWindow } from './itineraryRouting'

const maps = new Client()

// ── Tool schemas (OpenAI function-calling format) ──────────────────────────────

export const AGENT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_places',
      description:
        'Find real, existing venues in the destination by keyword (e.g. "rooftop bar", "seafood restaurant", "contemporary art museum", "specialty coffee"). Use it to discover options and to fill gaps in a plan. Returns up to 6 real places with coordinates and ratings. Never invent a place — search for it.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for, e.g. "traditional Portuguese restaurant" or "viewpoint with sunset views"' },
          city: { type: 'string', description: 'City to search in. Defaults to the trip destination; set this to target one city of a multi-city trip.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_day_route',
      description:
        "Sanity-check one day's travel AND pacing. Pass the day's stops in visiting order with coordinates and times. Returns total distance, per-leg distances, and warnings about backtracking, missing coordinates, or a multi-hour idle gap between two stops (fix by adding a stop in the gap or moving a time). Call this for each day before finalizing to catch a day that zigzags across the city or has dead time.",
      parameters: {
        type: 'object',
        properties: {
          stops: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                lat: { type: 'number' },
                lng: { type: 'number' },
                time: { type: 'string' },
              },
              required: ['name'],
            },
          },
        },
        required: ['stops'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'raise_checkpoint',
      description:
        "Ask the user one quick multiple-choice question when a real decision would change the plan — e.g. their saved places are lopsided (lots of food, no activities), or the scope/pace is ambiguous. Use at most ONCE per plan, and only when the answer genuinely changes what you build. The loop pauses until they pick.",
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'One short sentence, e.g. "You saved 6 restaurants but no activities — what should I do?"' },
          options: {
            type: 'array',
            description: '2-3 tappable choices',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'short slug, e.g. "add_activities"' },
                label: { type: 'string', description: 'button text, e.g. "Add a few activities"' },
              },
              required: ['id', 'label'],
            },
          },
        },
        required: ['question', 'options'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finalize_itinerary',
      description:
        'Submit the finished itinerary. Call this once the plan is solid and you have checked each day\'s route. After this the itinerary is saved and shown to the user.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Short friendly summary of the plan to show the user (2-3 sentences).' },
          days: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: { type: 'number' },
                title: { type: 'string', description: 'Area or theme for the day' },
                stops: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      time: { type: 'string', description: 'e.g. "9:00 AM"' },
                      name: { type: 'string', description: 'Exact real venue name' },
                      category: { type: 'string', description: 'cafe | restaurant | bar | activity | museum | landmark | park | shopping | nightlife | other' },
                      note: { type: 'string', description: 'One-sentence tip' },
                      suggested: { type: 'boolean', description: 'true if you added it (not from the user\'s saved places)' },
                      lat: { type: 'number' },
                      lng: { type: 'number' },
                    },
                    required: ['time', 'name', 'category'],
                  },
                },
              },
              required: ['day', 'title', 'stops'],
            },
          },
        },
        required: ['summary', 'days'],
      },
    },
  },
]

// ── Executors ─────────────────────────────────────────────────────────────────

export interface AgentContext {
  destination: string
  // Names the user already saved / already had on the itinerary. Used to set the
  // `suggested` flag and category deterministically instead of trusting the
  // model (which can relabel a saved bar as "activity" and lose its evening
  // time window), to reuse their coordinates, and to guarantee every saved
  // place survives even if the model drops one restating a large itinerary.
  // Keyed lowercased+trimmed; `name` keeps the original display casing.
  // `mustKeep` (saved places only, never currentItinerary edits) means: if the
  // model's final days don't include it, re-add it rather than lose it.
  knownPlaces?: Map<string, { name?: string; lat?: number; lng?: number; category?: string; mustKeep?: boolean }>
}

export interface FinalizeResult {
  finalized: true
  summary: string
  days: any[]
  places: any[]
}

export async function executeAgentTool(
  name: string,
  args: any,
  ctx: AgentContext,
): Promise<any> {
  try {
    if (name === 'search_places') return await searchPlaces(args, ctx)
    if (name === 'check_day_route') return checkDayRoute(args)
    if (name === 'raise_checkpoint') return args // handled by the route loop
    if (name === 'finalize_itinerary') return await finalizeItinerary(args, ctx)
    return { error: `unknown tool: ${name}` }
  } catch (e: any) {
    console.error('agent tool failed:', name, e?.message)
    return { error: e?.message || 'tool execution failed' }
  }
}

// Human-readable one-liner for the live trace shown to the user.
export function toolTraceText(name: string, args: any): string {
  if (name === 'search_places') return `Searching: ${args?.query || 'places'}${args?.city ? ` in ${args.city}` : ''}`
  if (name === 'check_day_route') return `Checking a day's route (${(args?.stops || []).length} stops)`
  if (name === 'raise_checkpoint') return 'Asking you a question'
  if (name === 'finalize_itinerary') return 'Finalizing the itinerary'
  return name
}

export function toolDoneText(name: string, result: any): string {
  if (name === 'search_places') return `Found ${(result?.places || []).length} places`
  if (name === 'check_day_route') {
    const w = (result?.warnings || []).length
    return w ? `${w} route issue${w > 1 ? 's' : ''} to fix` : 'Route looks good'
  }
  if (name === 'finalize_itinerary') return 'Itinerary ready'
  return 'Done'
}

function guessCategory(types: string[]): string {
  const t = new Set(types)
  if (t.has('cafe') || t.has('bakery')) return 'cafe'
  if (t.has('bar') || t.has('night_club')) return 'bar'
  if (t.has('restaurant') || t.has('meal_takeaway') || t.has('food')) return 'restaurant'
  if (t.has('museum') || t.has('art_gallery')) return 'museum'
  if (t.has('park') || t.has('natural_feature')) return 'park'
  if (t.has('shopping_mall') || t.has('store') || t.has('department_store')) return 'shopping'
  if (t.has('tourist_attraction') || t.has('point_of_interest') || t.has('church') || t.has('place_of_worship')) return 'landmark'
  return 'activity'
}

async function searchPlaces(args: { query: string; city?: string }, ctx: AgentContext) {
  const city = (args.city || ctx.destination || '').trim()
  const region = city ? await resolveCityRegion(city) : null
  const params: any = {
    query: [args.query, city].filter(Boolean).join(' in '),
    key: process.env.GOOGLE_PLACES_API_KEY!,
  }
  if (region) {
    params.location = { lat: region.lat, lng: region.lng }
    params.radius = 20000
  }
  const res = await maps.textSearch({ params })
  // Rank by rating weighted toward places with enough reviews to trust it — a
  // 5.0 from 3 reviews shouldn't outrank a 4.6 from 2,000. Unrated results sort
  // last but aren't dropped, so a sparse category still returns something.
  const ranked = [...(res.data.results || [])].sort((a: any, b: any) => {
    const score = (p: any) => (p.rating ? p.rating * Math.log10((p.user_ratings_total || 0) + 10) : -1)
    return score(b) - score(a)
  })
  const places = ranked.slice(0, 8).map((p) => ({
    name: p.name,
    lat: p.geometry?.location.lat,
    lng: p.geometry?.location.lng,
    rating: p.rating ?? null,
    rating_count: p.user_ratings_total ?? null,
    price_level: p.price_level ?? null,
    address: p.formatted_address ?? null,
    category: guessCategory(p.types || []),
  }))
  return { places }
}

function checkDayRoute(args: { stops: Array<{ name: string; lat?: number; lng?: number; time?: string; category?: string }> }) {
  const stops = [...(args.stops || [])].sort((a, b) => parseMin(a.time || '') - parseMin(b.time || ''))
  const warnings: string[] = []

  const missing = stops.filter((s) => typeof s.lat !== 'number' || typeof s.lng !== 'number').map((s) => s.name)
  if (missing.length) warnings.push(`Missing coordinates for: ${missing.join(', ')}. Use search_places to get the exact venue, then include lat/lng.`)

  // Idle-time gaps: two fixed meal/bar times hours apart with nothing between
  // them reads as dead time, not a plan — this doesn't show up in the distance
  // check at all since both stops can be right next to each other.
  for (let i = 1; i < stops.length; i++) {
    const gap = parseMin(stops[i].time || '') - parseMin(stops[i - 1].time || '')
    if (gap >= 240) {
      const h = Math.round(gap / 6) / 10
      warnings.push(`Idle gap: ${stops[i - 1].name} (${stops[i - 1].time}) to ${stops[i].name} (${stops[i].time}) is ${h}h with nothing in between — add a stop in that window or move one earlier/later.`)
    }
  }

  const geo = stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number') as Array<{ name: string; lat: number; lng: number }>
  const legs: Array<{ from: string; to: string; km: number }> = []
  let total = 0
  for (let i = 1; i < geo.length; i++) {
    const d = haversineKm(geo[i - 1], geo[i])
    total += d
    legs.push({ from: geo[i - 1].name, to: geo[i].name, km: Math.round(d * 10) / 10 })
    if (d > 10) warnings.push(`Long hop: ${geo[i - 1].name} → ${geo[i].name} is ${d.toFixed(1)}km — reorder if easy, otherwise note the travel and move on.`)
  }
  // Backtrack: a stop that lands right next to an earlier one it had already left behind.
  for (let i = 2; i < geo.length; i++) {
    for (let j = 0; j < i - 1; j++) {
      if (haversineKm(geo[i], geo[j]) < 0.6 && haversineKm(geo[i - 1], geo[j]) > 3) {
        warnings.push(`Backtrack: ${geo[i].name} is next to ${geo[j].name} (stop ${j + 1}) but comes after a detour — swap their order.`)
        break
      }
    }
  }
  // Cap so the model isn't drowned into a re-check loop.
  return { total_km: Math.round(total * 10) / 10, legs, warnings: warnings.slice(0, 3) }
}

// Nudge any stop that lands within 20min of the previous one 75min later.
function spreadCollidingTimes(stops: any[]): any[] {
  const result = [...stops]
  for (let i = 1; i < result.length; i++) {
    const prev = parseMin(result[i - 1].time)
    if (parseMin(result[i].time) <= prev + 20) result[i] = { ...result[i], time: fmtMin(prev + 75) }
  }
  return result
}

// Repeatedly find the single largest idle gap and fill it, rather than one
// left-to-right pass — a pass that inserts once per original pair can leave a
// real gap unfixed when a single huge gap needs two fillers (splitting an
// 11-hour gap once still leaves ~5.5 hours on each side).
async function fillIdleGaps(stops: any[], ctx: AgentContext): Promise<any[]> {
  let result = [...stops]
  const existingNames = new Set(result.map((s: any) => (s.name || '').trim().toLowerCase()))
  const MAX_FILLS = 4 // safety cap on API calls / stops added per day

  for (let fill = 0; fill < MAX_FILLS; fill++) {
    let worstIdx = -1, worstGap = 0
    for (let i = 1; i < result.length; i++) {
      const gap = parseMin(result[i].time || '') - parseMin(result[i - 1].time || '')
      if (gap > worstGap) { worstGap = gap; worstIdx = i }
    }
    if (worstIdx === -1 || worstGap < 240) break

    const prevMin = parseMin(result[worstIdx - 1].time || '')
    try {
      const query = worstGap >= 300 ? 'popular things to do' : 'things to do nearby'
      const found = await searchPlaces({ query, city: ctx.destination }, ctx)
      const pick = (found.places || []).find((p: any) => p.name && !existingNames.has(p.name.trim().toLowerCase()))
      if (!pick?.name) break // no more unique candidates — stop trying rather than loop forever
      existingNames.add(pick.name.trim().toLowerCase())
      const midMin = prevMin + Math.round(worstGap / 2)
      result.splice(worstIdx, 0, {
        name: pick.name,
        category: pick.category || 'activity',
        time: fmtMin(midMin),
        note: pick.rating ? `Well-rated local spot (${pick.rating}★) to fill the gap between your other stops.` : 'Added to fill the gap between your other stops.',
        suggested: true,
        lat: pick.lat,
        lng: pick.lng,
        address: pick.address ?? null,
      })
    } catch (e: any) {
      console.error('fillIdleGaps search failed:', e?.message)
      break
    }
  }
  return result
}

async function finalizeItinerary(
  args: { summary: string; days: any[] },
  ctx: AgentContext,
): Promise<FinalizeResult> {
  const rawDays = Array.isArray(args.days) ? args.days : []
  const known = ctx.knownPlaces ?? new Map()
  const norm = (n: string) => (n || '').trim().toLowerCase()

  // Drop duplicate stops across days (first day wins) — the model sometimes
  // copies a stop onto two days, e.g. when asked to "swap day 1 and 2".
  const seen = new Set<string>()
  const days = rawDays.map((d: any) => ({
    ...d,
    stops: (d.stops || []).filter((s: any) => {
      const k = norm(s.name)
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    }),
  }))

  // Reuse coordinates the user's places already have; geocode the rest
  // (region-guarded, so a wrong-city match is dropped rather than pinned).
  const needGeo: any[] = []
  for (const d of days) for (const s of d.stops || []) {
    const hit = known.get(norm(s.name))
    if (hit?.lat != null && hit?.lng != null && (typeof s.lat !== 'number' || typeof s.lng !== 'number')) {
      s.lat = hit.lat; s.lng = hit.lng
    }
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') needGeo.push(s)
  }
  await Promise.all(
    needGeo.map(async (s) => {
      const g = await geocodePlace(s.name, ctx.destination)
      if (g) { s.lat = g.lat; s.lng = g.lng; s.address = g.address }
    }),
  )

  const finalDays = await Promise.all(days.map(async (d: any) => {
    let stops = (d.stops || []).map((s: any) => {
      // Ground truth over the model's memory: a saved bar restated as a plain
      // "activity" loses its evening time window and can land anywhere,
      // including the morning. If we already know this place's real category
      // (it's one of the user's saves), that wins over whatever the model wrote.
      const knownCategory = known.get(norm(s.name))?.category
      const category = knownCategory || s.category || 'activity'
      return {
        ...s,
        category,
        note: s.note || '',
        // Deterministic: it's "the user's" only if we've seen that name before.
        suggested: known.size > 0 ? !known.has(norm(s.name)) : true,
        // Pull an out-of-window time back to the category's sane hours
        // (e.g. a museum the model scheduled at 9pm).
        time: clampToWindow(s.time || '', category),
      }
    })
    stops.sort((a: any, b: any) => parseMin(a.time) - parseMin(b.time))
    stops = routeStopsForDay(stops)
    // routeStopsForDay re-times flexible stops by position, which can push a
    // museum/landmark past its window if it landed after an evening anchor —
    // clamp once more and re-sort.
    stops = stops.map((s: any) => ({ ...s, time: clampToWindow(s.time || '', s.category) }))
    stops.sort((a: any, b: any) => parseMin(a.time) - parseMin(b.time))
    stops = spreadCollidingTimes(stops)
    // Belt-and-suspenders: the model is told to fix multi-hour idle gaps via
    // check_day_route but doesn't always do it (or rewrites the day afterward
    // without re-checking). Guarantee it here instead of just hoping — search
    // for one real thing to do and drop it in the gap rather than shipping
    // dead time.
    stops = await fillIdleGaps(stops, ctx)
    // fillIdleGaps can itself insert a stop at a time that collides with an
    // existing one — spread once more.
    stops = spreadCollidingTimes(stops)
    return { day: d.day, title: d.title || `Day ${d.day}`, stops }
  }))

  // Guarantee every saved place survives — the model can silently drop one
  // when restating a large itinerary, which is a worse outcome than placing
  // it at an imperfect time. Append any missing one to the lightest day.
  const placedNames = new Set(finalDays.flatMap((d: any) => d.stops.map((s: any) => norm(s.name))))
  for (const [key, info] of known) {
    if (!info.mustKeep || placedNames.has(key)) continue
    const target = finalDays.reduce((a: any, b: any) => (a.stops.length <= b.stops.length ? a : b))
    const category = info.category || 'activity'
    target.stops.push({
      name: info.name || key,
      category,
      time: fmtHour(defaultHour(category)),
      note: '',
      suggested: false,
      lat: info.lat,
      lng: info.lng,
    })
    target.stops.sort((a: any, b: any) => parseMin(a.time) - parseMin(b.time))
  }

  const places = finalDays
    .flatMap((d: any) => d.stops)
    .filter((s: any) => typeof s.lat === 'number' && typeof s.lng === 'number')
    .map((s: any) => ({ name: s.name, category: s.category, lat: s.lat, lng: s.lng, address: s.address ?? null }))

  return { finalized: true, summary: args.summary, days: finalDays, places }
}
