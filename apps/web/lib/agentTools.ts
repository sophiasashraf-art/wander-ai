import { Client } from '@googlemaps/google-maps-services-js'
import { resolveCityRegion, geocodePlace } from './placeIngestion'
import { routeStopsForDay, haversineKm, parseMin, fmtMin, clampToWindow } from './itineraryRouting'

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
        "Sanity-check one day's travel. Pass the day's stops in visiting order with coordinates and times. Returns total distance, per-leg distances, and warnings about backtracking or missing coordinates. Call this for each day before finalizing to catch a day that zigzags across the city.",
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
  // `suggested` flag deterministically instead of trusting the model, and to
  // reuse their coordinates. Lowercased, trimmed.
  knownPlaces?: Map<string, { lat?: number; lng?: number }>
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
    if (name === 'finalize_itinerary') return await finalizeItinerary(args, ctx)
    return { error: `unknown tool: ${name}` }
  } catch (e: any) {
    console.error('agent tool failed:', name, e?.message)
    return { error: e?.message || 'tool execution failed' }
  }
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
  const places = (res.data.results || []).slice(0, 6).map((p) => ({
    name: p.name,
    lat: p.geometry?.location.lat,
    lng: p.geometry?.location.lng,
    rating: p.rating ?? null,
    price_level: p.price_level ?? null,
    address: p.formatted_address ?? null,
    category: guessCategory(p.types || []),
  }))
  return { places }
}

function checkDayRoute(args: { stops: Array<{ name: string; lat?: number; lng?: number; time?: string }> }) {
  const stops = [...(args.stops || [])].sort((a, b) => parseMin(a.time || '') - parseMin(b.time || ''))
  const warnings: string[] = []

  const missing = stops.filter((s) => typeof s.lat !== 'number' || typeof s.lng !== 'number').map((s) => s.name)
  if (missing.length) warnings.push(`Missing coordinates for: ${missing.join(', ')}. Use search_places to get the exact venue, then include lat/lng.`)

  const geo = stops.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number') as Array<{ name: string; lat: number; lng: number }>
  const legs: Array<{ from: string; to: string; km: number }> = []
  let total = 0
  for (let i = 1; i < geo.length; i++) {
    const d = haversineKm(geo[i - 1], geo[i])
    total += d
    legs.push({ from: geo[i - 1].name, to: geo[i].name, km: Math.round(d * 10) / 10 })
    if (d > 6) warnings.push(`Long hop: ${geo[i - 1].name} → ${geo[i].name} is ${d.toFixed(1)}km. Consider reordering or moving one to another day.`)
  }
  // Backtrack: a stop that lands right next to an earlier one it had already left behind.
  for (let i = 2; i < geo.length; i++) {
    for (let j = 0; j < i - 1; j++) {
      if (haversineKm(geo[i], geo[j]) < 0.6 && haversineKm(geo[i - 1], geo[j]) > 2) {
        warnings.push(`Backtrack: ${geo[i].name} is right by ${geo[j].name} (stop ${j + 1}) but is visited after a detour. Reorder so nearby stops are consecutive.`)
      }
    }
  }
  return { total_km: Math.round(total * 10) / 10, legs, warnings }
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

  const finalDays = days.map((d: any) => {
    let stops = (d.stops || []).map((s: any) => {
      const category = s.category || 'activity'
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
    // Spread stops that collided on the same/near time.
    for (let i = 1; i < stops.length; i++) {
      const prev = parseMin(stops[i - 1].time)
      if (parseMin(stops[i].time) <= prev + 20) stops[i] = { ...stops[i], time: fmtMin(prev + 75) }
    }
    return { day: d.day, title: d.title || `Day ${d.day}`, stops }
  })

  const places = finalDays
    .flatMap((d: any) => d.stops)
    .filter((s: any) => typeof s.lat === 'number' && typeof s.lng === 'number')
    .map((s: any) => ({ name: s.name, category: s.category, lat: s.lat, lng: s.lng, address: s.address ?? null }))

  return { finalized: true, summary: args.summary, days: finalDays, places }
}
