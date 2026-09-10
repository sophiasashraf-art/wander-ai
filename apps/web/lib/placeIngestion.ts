import { Client } from '@googlemaps/google-maps-services-js'
import { FirecrawlAppV1 as FirecrawlApp } from 'firecrawl'
import { supabase } from './supabase'

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! })
const maps = new Client()

export function platformLabel(url: string): string {
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  if (host.includes('tiktok.com')) return 'TikTok'
  if (host.includes('instagram.com')) return 'Instagram'
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube'
  return host.replace('www.', '') || 'a link'
}

export function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const matches = text.match(urlRegex) || []
  // Strip already-matched URLs before scanning for bare domains — otherwise this
  // regex also matches the tail of a URL already captured above (e.g. it'd pull
  // "tiktok.com/@user/video/123" back out of "https://www.tiktok.com/@user/video/123",
  // producing a mangled www.-less duplicate that TikTok's oEmbed endpoint rejects.
  const textWithoutUrls = text.replace(urlRegex, ' ')
  const bareUrlRegex = /(?<![\/\w])([\w-]+\.[\w-]+(?:\.[\w-]+)*\/[^\s]*)/g
  const bareMatches = textWithoutUrls.match(bareUrlRegex) || []
  const withProtocol = bareMatches.map(u => `https://${u}`)
  return [...new Set([...matches, ...withProtocol])]
}

// TikTok's video pages are almost entirely client-rendered, so a plain scrape
// (Firecrawl included) usually comes back empty or with no caption text. TikTok
// publishes a public oEmbed endpoint specifically for this — no login/JS needed,
// and its "title" field is the video caption, which is where place names live.
export async function scrapeTikTokOembed(url: string): Promise<string> {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`)
    if (!res.ok) return ''
    const data = await res.json()
    if (!data.title) return ''
    return `TikTok by ${data.author_name || 'unknown'}: ${data.title}`
  } catch {
    return ''
  }
}

export async function scrapeUrl(url: string): Promise<string> {
  if (url.includes('tiktok.com')) {
    const oembed = await scrapeTikTokOembed(url)
    if (oembed) return oembed
  }
  try {
    const result = await firecrawl.scrapeUrl(url, { formats: ['markdown'] }) as any
    if (result.markdown) return result.markdown.slice(0, 15000)
    if (result.content) return result.content.slice(0, 15000)
  } catch (e) {
    console.error('Scrape failed for', url)
  }
  return ''
}

export interface VerifiedPlace {
  google_place_id: string
  lat: number
  lng: number
  formatted_address: string | null
  rating: number | null
  price_level: number | null
  opening_hours: string[] | null
  photo_reference: string | null
}

interface CityRegion {
  lat: number
  lng: number
  sw: { lat: number; lng: number }
  ne: { lat: number; lng: number }
}

const cityRegionCache = new Map<string, CityRegion | null>()

// Resolve a destination string ("San Francisco", "Costa Rica") to a center +
// viewport. findPlaceFromText on its own returns the single globally "best"
// name match with no geographic constraint, so a generic name ("Blue Bottle",
// "Tartine") could resolve to a more prominent branch in another city — this is
// how a San Francisco itinerary ended up with a cafe pinned in LA. The viewport
// self-scales: a city's is tens of km, a country's is continental, so the guard
// below is strict for cities and effectively a no-op for whole-country trips.
async function resolveCityRegion(destination: string): Promise<CityRegion | null> {
  const key = destination.trim().toLowerCase()
  if (!key) return null
  if (cityRegionCache.has(key)) return cityRegionCache.get(key)!
  let region: CityRegion | null = null
  try {
    // The Geocoding API isn't enabled on this project — only Places — so resolve
    // the destination with findPlaceFromText. A place query for "San Francisco"
    // still comes back with a geometry.viewport, and it self-scales: a city's is
    // ~10km, a country's is continental (so the guard below no-ops for those).
    const res = await maps.findPlaceFromText({
      params: {
        input: destination,
        inputtype: 'textquery' as any,
        fields: ['geometry', 'name'] as any,
        key: process.env.GOOGLE_PLACES_API_KEY!,
      },
    })
    const c = res.data.candidates?.[0]
    const loc = c?.geometry?.location
    if (loc) {
      const vp = c!.geometry!.viewport
      region = {
        lat: loc.lat,
        lng: loc.lng,
        sw: vp?.southwest ?? { lat: loc.lat - 0.3, lng: loc.lng - 0.3 },
        ne: vp?.northeast ?? { lat: loc.lat + 0.3, lng: loc.lng + 0.3 },
      }
    }
  } catch (e: any) {
    console.error('resolveCityRegion failed for', destination, e?.response?.data || e?.message)
  }
  cityRegionCache.set(key, region)
  return region
}

// Accept a resolved place if it's inside the destination viewport expanded by
// 50% each side (headroom for legit suburbs / day-trip spots), rejecting the
// clearly-wrong-city matches.
function withinRegion(lat: number, lng: number, region: CityRegion): boolean {
  const latPad = (region.ne.lat - region.sw.lat) * 0.5
  const lngPad = (region.ne.lng - region.sw.lng) * 0.5
  if (lat < region.sw.lat - latPad || lat > region.ne.lat + latPad) return false
  if (region.ne.lng < region.sw.lng) return true // viewport crosses the antimeridian — skip lng check
  return lng >= region.sw.lng - lngPad && lng <= region.ne.lng + lngPad
}

function biasParam(region: CityRegion | null): string | undefined {
  if (!region) return undefined
  return `rectangle:${region.sw.lat},${region.sw.lng}|${region.ne.lat},${region.ne.lng}`
}

// Lightweight geocode: coords + address only, destination-biased and
// region-guarded. For itinerary generation where the extra placeDetails round
// trip verifyPlace does would be fetched and thrown away.
export async function geocodePlace(
  name: string,
  destination?: string | null,
): Promise<{ lat: number; lng: number; address: string | null } | null> {
  try {
    const region = destination ? await resolveCityRegion(destination) : null
    const params: any = {
      input: [name, destination].filter(Boolean).join(' '),
      inputtype: 'textquery',
      fields: ['geometry', 'formatted_address'],
      key: process.env.GOOGLE_PLACES_API_KEY!,
    }
    const bias = biasParam(region)
    if (bias) params.locationbias = bias
    const res = await maps.findPlaceFromText({ params })
    const c = res.data.candidates?.[0]
    if (!c?.geometry?.location) return null
    const { lat, lng } = c.geometry.location
    if (region && !withinRegion(lat, lng, region)) {
      console.warn(`geocodePlace: "${name}" -> ${lat},${lng} is outside ${destination} — rejecting`)
      return null
    }
    return { lat, lng, address: c.formatted_address || null }
  } catch {
    return null
  }
}

// The richest of the three enrichment functions this replaces (import-itinerary's):
// findPlaceFromText to locate the place, then placeDetails for the fields Places
// only returns on the detail lookup. extract-places/inbox previously requested
// place_id from findPlaceFromText but never chained into placeDetails, so
// paste-based saves never got rating/price_level/opening_hours/photo_reference —
// this fixes that for every caller at once.
export async function verifyPlace(name: string, destination?: string | null): Promise<VerifiedPlace | null> {
  try {
    const region = destination ? await resolveCityRegion(destination) : null
    const searchQuery = [name, destination].filter(Boolean).join(' ')
    const findParams: any = {
      input: searchQuery,
      inputtype: 'textquery',
      fields: ['place_id', 'geometry', 'name', 'formatted_address'],
      key: process.env.GOOGLE_PLACES_API_KEY!,
    }
    const bias = biasParam(region)
    if (bias) findParams.locationbias = bias
    const findRes = await maps.findPlaceFromText({ params: findParams })
    const candidate = findRes.data.candidates?.[0]
    if (!candidate?.geometry?.location || !candidate.place_id) return null
    // Reject a name match that landed in the wrong city entirely (see
    // resolveCityRegion) rather than saving a place with a misleading pin.
    if (region && !withinRegion(candidate.geometry.location.lat, candidate.geometry.location.lng, region)) {
      console.warn(`verifyPlace: "${name}" -> ${candidate.geometry.location.lat},${candidate.geometry.location.lng} is outside ${destination} — rejecting`)
      return null
    }

    let rating: number | null = null
    let price_level: number | null = null
    let opening_hours: string[] | null = null
    let photo_reference: string | null = null
    let formatted_address = candidate.formatted_address || null

    try {
      const detailsRes = await maps.placeDetails({
        params: {
          place_id: candidate.place_id,
          fields: ['opening_hours', 'photos', 'rating', 'price_level', 'formatted_address'] as any,
          key: process.env.GOOGLE_PLACES_API_KEY!,
        }
      })
      const details = detailsRes.data.result
      if (details) {
        rating = details.rating ?? null
        price_level = details.price_level ?? null
        opening_hours = details.opening_hours?.weekday_text || null
        photo_reference = details.photos?.[0]?.photo_reference || null
        formatted_address = details.formatted_address || formatted_address
      }
    } catch (e: any) {
      console.error('placeDetails failed for', name, e?.response?.data || e?.message)
    }

    return {
      google_place_id: candidate.place_id,
      lat: candidate.geometry.location.lat,
      lng: candidate.geometry.location.lng,
      formatted_address,
      rating,
      price_level,
      opening_hours,
      photo_reference,
    }
  } catch (e: any) {
    console.error('Google Places failed for', name, e?.response?.data || e?.message)
    return null
  }
}

export type PlaceSource = 'pasted_text' | 'manual' | 'discovered'

export interface PlaceCandidate {
  trip_id: string
  name: string
  category?: string | null
  city?: string | null
  description?: string | null
  tip?: string | null
  why_recommended?: string | null
  source_url?: string | null
  raw_input?: string | null
  source: PlaceSource
}

function buildFullFieldSet(candidate: PlaceCandidate, verified: VerifiedPlace | null) {
  return {
    name: candidate.name,
    category: candidate.category ?? null,
    city: candidate.city ?? null,
    description: candidate.description ?? verified?.formatted_address ?? null,
    neighborhood: verified?.formatted_address ?? null,
    lat: verified?.lat ?? null,
    lng: verified?.lng ?? null,
    rating: verified?.rating ?? null,
    price_level: verified?.price_level ?? null,
    opening_hours: verified?.opening_hours ?? null,
    photo_reference: verified?.photo_reference ?? null,
    google_place_id: verified?.google_place_id ?? null,
    tip: candidate.tip ?? null,
    why_recommended: candidate.why_recommended ?? null,
    source_url: candidate.source_url ?? null,
    raw_input: candidate.raw_input ?? null,
    source: candidate.source,
    trip_id: candidate.trip_id,
  }
}

// Real dedup, not the fragile name-string matching every route used to do
// independently. Can't use supabase-js .upsert() here — PostgREST's on_conflict
// can only target a plain column list, and it can't attach the partial index's
// "WHERE google_place_id IS NOT NULL" predicate Postgres needs for conflict
// inference against a partial unique index. So: manual select-then-write.
export async function upsertPlace(
  candidate: PlaceCandidate,
  verified: VerifiedPlace | null
): Promise<{ place: any; deduped: boolean }> {
  const write = buildFullFieldSet(candidate, verified)

  if (verified?.google_place_id) {
    const { data: existing } = await supabase
      .from('places')
      .select('id')
      .eq('trip_id', candidate.trip_id)
      .eq('google_place_id', verified.google_place_id)
      .maybeSingle()

    if (existing) {
      const { data } = await supabase.from('places').update(write).eq('id', existing.id).select().single()
      return { place: data, deduped: true }
    }

    const { data, error } = await supabase.from('places').insert(write).select().single()
    if (error?.code === '23505') {
      // Race on the unique index (e.g. a double-submit) — fall back to update.
      const { data: retry } = await supabase
        .from('places')
        .update(write)
        .eq('trip_id', candidate.trip_id)
        .eq('google_place_id', verified.google_place_id)
        .select()
        .single()
      return { place: retry, deduped: true }
    }
    if (error) console.error('places insert failed:', error)
    return { place: data, deduped: false }
  }

  // No confident Places match (e.g. the "Saved from TikTok" placeholder) — fall
  // back to trimmed/lowercased name dedup, scoped to rows that are also
  // unverified so a real matched place and a same-named placeholder don't merge.
  const { data: existing } = await supabase
    .from('places')
    .select('id, name')
    .eq('trip_id', candidate.trip_id)
    .is('google_place_id', null)
  const match = (existing || []).find(r => r.name?.trim().toLowerCase() === candidate.name.trim().toLowerCase())

  if (match) {
    const { data } = await supabase.from('places').update(write).eq('id', match.id).select().single()
    return { place: data, deduped: true }
  }
  const { data, error } = await supabase.from('places').insert(write).select().single()
  if (error) console.error('places insert failed:', error)
  return { place: data, deduped: false }
}
