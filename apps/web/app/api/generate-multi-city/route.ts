import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import { Client } from '@googlemaps/google-maps-services-js'

const openai = new OpenAI()
const maps = new Client()

const CATEGORY_HOUR: Record<string, number> = {
  cafe: 9, bakery: 8, breakfast: 8, coffee: 9, brunch: 10,
  market: 10, park: 10, garden: 10, hike: 9, trail: 9, nature: 10,
  lunch: 12, food: 12,
  museum: 14, gallery: 14, shopping: 15, landmark: 14, monument: 14,
  temple: 14, church: 14, tour: 14,
  beach: 11, viewpoint: 17, sunset: 18,
  restaurant: 19, dinner: 19, bar: 20, nightlife: 21, pub: 20, club: 22,
}
const CATEGORY_WINDOW: Record<string, [number, number]> = {
  cafe: [7*60, 11*60], coffee: [7*60, 11*60], bakery: [7*60, 11*60],
  breakfast: [7*60, 11*60], brunch: [9*60, 13*60],
  market: [8*60, 14*60], park: [8*60, 18*60], garden: [8*60, 18*60],
  hike: [7*60, 14*60], trail: [7*60, 14*60], nature: [8*60, 17*60],
  lunch: [11*60, 14*60], museum: [9*60, 18*60], gallery: [10*60, 19*60],
  shopping: [10*60, 20*60], landmark: [8*60, 19*60], monument: [8*60, 19*60],
  temple: [8*60, 18*60], church: [8*60, 18*60], tour: [9*60, 17*60],
  beach: [8*60, 19*60], viewpoint: [8*60, 21*60], sunset: [16*60, 21*60],
  restaurant: [11*60, 22*60], dinner: [17*60, 22*60],
  bar: [17*60, 24*60], pub: [17*60, 24*60], nightlife: [20*60, 28*60], club: [21*60, 28*60],
}

function defaultHour(cat: string): number {
  const c = (cat || '').toLowerCase()
  for (const [k, h] of Object.entries(CATEGORY_HOUR)) if (c.includes(k)) return h
  return 14
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
function clampToWindow(timeStr: string, category: string): string {
  const c = (category || '').toLowerCase()
  let window: [number, number] | null = null
  for (const [k, w] of Object.entries(CATEGORY_WINDOW)) {
    if (c.includes(k)) { window = w; break }
  }
  if (!window) return timeStr
  const mins = parseMin(timeStr)
  if (mins === 0) return timeStr
  const [earliest, latest] = window
  if (mins >= earliest && mins <= latest) return timeStr
  return fmtHour(defaultHour(category))
}

async function geocodePlace(name: string, city: string): Promise<{ lat: number; lng: number; address?: string; photo_reference?: string; rating?: number; price_level?: number; opening_hours?: string[] } | null> {
  try {
    const findRes = await maps.findPlaceFromText({
      params: {
        input: `${name} ${city}`,
        inputtype: 'textquery' as any,
        fields: ['place_id', 'geometry', 'name'] as any,
        key: process.env.GOOGLE_PLACES_API_KEY!,
      }
    })
    const candidate = findRes.data.candidates?.[0]
    if (!candidate?.geometry?.location) return null
    const result: any = {
      lat: candidate.geometry.location.lat,
      lng: candidate.geometry.location.lng,
    }
    if (candidate.place_id) {
      try {
        const detailRes = await maps.placeDetails({
          params: {
            place_id: candidate.place_id,
            key: process.env.GOOGLE_PLACES_API_KEY!,
            fields: ['opening_hours', 'photos', 'rating', 'price_level', 'formatted_address'] as any,
          }
        })
        const det = detailRes.data.result
        if (det?.opening_hours?.weekday_text?.length) result.opening_hours = det.opening_hours.weekday_text
        const photoRef = (det as any)?.photos?.[0]?.photo_reference
        if (photoRef) result.photo_reference = photoRef
        if (det?.rating) result.rating = det.rating
        if ((det as any)?.price_level != null) result.price_level = (det as any).price_level
        if (det?.formatted_address) result.address = det.formatted_address
      } catch {}
    }
    return result
  } catch {}
  return null
}

export async function POST(req: Request) {
  try {
    // cities: [{ name: string, days: number }]
    // vibe, text (optional scraped content), tripId
    const { cities, vibe, text, tripId, arrivalTime, departureTime } = await req.json()

    if (!cities?.length) return NextResponse.json({ error: 'No cities provided' }, { status: 400 })

    const vibeConfig: Record<string, number> = { relaxed: 3, balanced: 4, everything: 6 }
    const stopsPerDay = vibeConfig[vibe || 'balanced'] || 4
    const totalDays = cities.reduce((s: number, c: any) => s + (parseInt(c.days) || 1), 0)

    // ── Step 1: Extract places per city from text (if provided) or ask GPT to suggest ──
    let cityPlaces: Record<string, any[]> = {}

    if (text?.trim()) {
      // Parse the text to extract places, then assign to cities by geocoding
      const parseRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Extract all specific places from the text. For each place, identify which city it belongs to from this list: ${cities.map((c: any) => c.name).join(', ')}.
Return JSON: {"places": [{"name": "...", "city": "...", "category": "restaurant|cafe|activity|museum|landmark|park|shopping|bar|other"}]}`,
        }, { role: 'user', content: text }],
        response_format: { type: 'json_object' },
      })
      const parsed = JSON.parse(parseRes.choices[0].message.content || '{"places":[]}')
      for (const p of (parsed.places || [])) {
        const city = p.city || cities[0].name
        if (!cityPlaces[city]) cityPlaces[city] = []
        cityPlaces[city].push(p)
      }
    }

    // For cities with no scraped places, ask GPT to suggest top spots
    for (const city of cities) {
      const existing = cityPlaces[city.name] || []
      const needed = stopsPerDay * parseInt(city.days) - existing.length
      if (needed <= 0) continue

      const suggestRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Suggest ${needed} must-visit places in ${city.name}. Mix of cafes, landmarks, restaurants, and activities. Return JSON: {"places": [{"name": "...", "category": "..."}]}`,
        }, { role: 'user', content: `Top ${needed} places in ${city.name}` }],
        response_format: { type: 'json_object' },
      })
      const suggested = JSON.parse(suggestRes.choices[0].message.content || '{"places":[]}')
      const existingNames = new Set(existing.map((p: any) => p.name.toLowerCase()))
      const newSuggested = (suggested.places || [])
        .filter((p: any) => !existingNames.has(p.name.toLowerCase()))
        .map((p: any) => ({ ...p, city: city.name, suggested: true }))
      cityPlaces[city.name] = [...existing, ...newSuggested]
    }

    // ── Step 2: Geocode all places ──
    const geocoded: Record<string, any[]> = {}
    for (const city of cities) {
      const places = cityPlaces[city.name] || []
      const enriched = await Promise.all(
        places.map(async (p: any) => {
          const coords = await geocodePlace(p.name, city.name)
          return coords ? { ...p, ...coords } : p
        })
      )
      geocoded[city.name] = enriched
    }

    // ── Step 3: Build day buckets per city ──
    const CATEGORY_ORDER = ['cafe', 'breakfast', 'activity', 'museum', 'landmark', 'park', 'shopping', 'restaurant', 'bar', 'other']
    let dayNum = 1
    const allBuckets: { day: number; city: string; places: any[] }[] = []

    for (const city of cities) {
      const cityDays = parseInt(city.days) || 1
      const pool = (geocoded[city.name] || []).slice(0, stopsPerDay * cityDays)

      // Sort by category for variety
      const sorted = [...pool].sort((a: any, b: any) => {
        const ai = CATEGORY_ORDER.findIndex(c => (a.category || '').toLowerCase().includes(c))
        const bi = CATEGORY_ORDER.findIndex(c => (b.category || '').toLowerCase().includes(c))
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })

      const buckets: any[][] = Array.from({ length: cityDays }, () => [])
      let idx = 0
      for (const p of sorted) {
        let attempts = 0
        while (buckets[idx].length >= stopsPerDay && attempts < cityDays) {
          idx = (idx + 1) % cityDays
          attempts++
        }
        if (attempts < cityDays) {
          buckets[idx].push(p)
          idx = (idx + 1) % cityDays
        }
      }

      for (let i = 0; i < cityDays; i++) {
        allBuckets.push({ day: dayNum++, city: city.name, places: buckets[i] })
      }
    }

    // ── Step 4: Ask GPT to add times + titles ──
    const dayDescriptions = allBuckets.map(b => {
      if (b.places.length === 0) return `Day ${b.day} (${b.city}): (no places — leave stops empty)`
      return `Day ${b.day} (${b.city}): ${b.places.map((p: any) => `${p.name} [${p.category}]`).join(', ')}`
    }).join('\n')

    const gptRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a travel planner for a multi-city trip. Places are already assigned to days — do NOT move them.

Your jobs:
1. Give each day a title using the city name + area/theme (e.g. "Paris — Montmartre")
2. Assign realistic times per category:
   - cafe/coffee/bakery/breakfast → 8:00–10:00 AM ONLY
   - park/market/hike → 9:00 AM–12:00 PM
   - museum/gallery/landmark → 10:00 AM–5:00 PM
   - shopping → 11:00 AM–6:00 PM
   - restaurant (dinner) → 7:00 PM; if two restaurants → 12:30 PM lunch + 7:00 PM dinner
   - bar/pub → 8:00–10:00 PM
   - nightlife → 10:00 PM+
3. Write a one-sentence note tip for each place
4. Include ALL days, even empty ones (stops: [])

Return JSON: {"days": [{"day": 1, "title": "...", "stops": [{"time": "10:00 AM", "name": "...", "category": "...", "note": "...", "suggested": false}]}]}`,
      }, {
        role: 'user',
        content: `Multi-city trip: ${cities.map((c: any) => `${c.name} (${c.days} days)`).join(' → ')}
Total days: ${totalDays}

Places per day:
${dayDescriptions}

Return all ${totalDays} days.`,
      }],
      response_format: { type: 'json_object' },
    })

    const gptResult = JSON.parse(gptRes.choices[0].message.content || '{"days":[]}')

    // ── Step 5: Validate, re-attach coords, clamp times ──
    const gptByDay: Record<number, any> = {}
    gptResult.days?.forEach((d: any) => { gptByDay[d.day] = d })

    // Build coord lookup
    const coordLookup: Record<string, any> = {}
    for (const city of cities) {
      for (const p of (geocoded[city.name] || [])) {
        if (p.lat && p.lng) coordLookup[p.name.toLowerCase().trim()] = p
      }
    }

    const finalDays = allBuckets.map(bucket => {
      const gptDay = gptByDay[bucket.day]
      let stops: any[]

      if (gptDay?.stops) {
        const gptNames = new Set(gptDay.stops.map((s: any) => s.name.toLowerCase().trim()))
        const bucketNames = bucket.places.map((p: any) => p.name.toLowerCase().trim())
        const allPresent = bucketNames.every(n => gptNames.has(n))
        if (allPresent) {
          stops = gptDay.stops
        } else {
          stops = bucket.places.map((p: any) => ({
            time: fmtHour(defaultHour(p.category)),
            name: p.name, category: p.category, note: '', suggested: p.suggested || false,
          }))
        }
      } else {
        stops = bucket.places.map((p: any) => ({
          time: fmtHour(defaultHour(p.category)),
          name: p.name, category: p.category, note: '', suggested: p.suggested || false,
        }))
      }

      // Re-attach coords + clamp times
      stops = stops.map((s: any) => {
        const coords = coordLookup[s.name.toLowerCase().trim()]
        const rawTime = s.time || fmtHour(defaultHour(s.category))
        return {
          ...s,
          time: clampToWindow(rawTime, s.category),
          ...(coords ? {
            lat: coords.lat, lng: coords.lng,
            opening_hours: coords.opening_hours,
            photo_reference: coords.photo_reference,
            rating: coords.rating,
            price_level: coords.price_level,
            address: coords.address,
          } : {}),
        }
      })

      stops.sort((a: any, b: any) => parseMin(a.time) - parseMin(b.time))

      return {
        day: bucket.day,
        title: gptDay?.title || `${bucket.city} — Day ${bucket.day}`,
        city: bucket.city,
        stops,
      }
    })

    // ── Step 6: Fill any missing notes in one batch ──
    const stopsNeedingNotes = finalDays.flatMap((d: any) =>
      d.stops.filter((s: any) => !s.note?.trim()).map((s: any) => ({ name: s.name, category: s.category, city: d.city }))
    )
    let enrichedDays: any[] = finalDays
    if (stopsNeedingNotes.length > 0) {
      const noteRes = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Write a short, specific one-sentence tip for each place — what to do, order, see, or experience there. Be concrete and useful, not generic. Return JSON: {"notes": {"place name": "tip..."}}`,
        }, {
          role: 'user',
          content: `Cities: ${cities.map((c: any) => c.name).join(', ')}\n\nPlaces needing tips:\n${stopsNeedingNotes.map((s: any) => `- ${s.name} [${s.category}] in ${s.city}`).join('\n')}`,
        }],
        response_format: { type: 'json_object' },
      })
      const noteResult = JSON.parse(noteRes.choices[0].message.content || '{"notes":{}}')
      const notes: Record<string, string> = noteResult.notes || {}
      enrichedDays = finalDays.map((day: any) => ({
        ...day,
        stops: day.stops.map((s: any) => ({
          ...s,
          note: s.note?.trim() || notes[s.name] || notes[s.name.toLowerCase()] || '',
        })),
      }))
    }

    // Save to Supabase if tripId provided
    if (tripId) {
      const allPlaces = Object.values(geocoded).flat().filter((p: any) => p.lat && p.lng)
      if (allPlaces.length > 0) {
        const { data: existing } = await supabase.from('places').select('name').eq('trip_id', tripId)
        const existingNames = new Set((existing || []).map((p: any) => p.name.toLowerCase()))
        const toInsert = allPlaces
          .filter((p: any) => !existingNames.has(p.name.toLowerCase()))
          .map((p: any) => ({
            name: p.name, category: p.category, city: p.city,
            description: p.address || '', lat: p.lat, lng: p.lng,
            trip_id: tripId,
            opening_hours: p.opening_hours || null,
            photo_reference: p.photo_reference || null,
            rating: p.rating || null,
            price_level: p.price_level ?? null,
          }))
        if (toInsert.length > 0) await supabase.from('places').insert(toInsert)
      }
      await supabase.from('trips').update({ itinerary: { days: enrichedDays } }).eq('id', tripId)
    }

    return NextResponse.json({ days: enrichedDays })
  } catch (e: any) {
    console.error('generate-multi-city error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
