import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

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

export async function POST(req: Request) {
  try {
    const { tripId } = await req.json()

    const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).single()
    const { data: places } = await supabase.from('places').select('*').eq('trip_id', tripId)

    if (!places || places.length === 0) {
      return NextResponse.json({ error: 'No places found' }, { status: 400 })
    }

    const vibeConfig = {
      relaxed: { stopsPerDay: 3 },
      balanced: { stopsPerDay: 4 },
      everything: { stopsPerDay: 6 },
    }
    const config = vibeConfig[(trip?.vibe as keyof typeof vibeConfig) || 'balanced']
    const numDays = parseInt(trip?.duration) || 3

    // ── Step 1: Assign places to days IN CODE ──
    // Use geocoded places if available, fall back to all
    const geocoded = places.filter((p: any) => p.lat && p.lng)
    const allPool = geocoded.length > 0 ? geocoded : places

    // Build a coord lookup so we can re-attach lat/lng to stops later
    const coordLookup: Record<string, { lat: number; lng: number; opening_hours?: string[]; photo_reference?: string; rating?: number; price_level?: number; address?: string }> = {}
    allPool.forEach((p: any) => {
      if (p.lat && p.lng) coordLookup[p.name.toLowerCase().trim()] = {
        lat: p.lat, lng: p.lng,
        opening_hours: p.opening_hours,
        photo_reference: p.photo_reference,
        rating: p.rating,
        price_level: p.price_level,
        address: p.address,
      }
    })

    const pool = allPool.slice(0, config.stopsPerDay * numDays)

    // Detect geographic spread
    const geocodedPool = pool.filter((p: any) => p.lat && p.lng)
    const lngs = geocodedPool.map((p: any) => p.lng)
    const lats = geocodedPool.map((p: any) => p.lat)
    const lngSpread = geocodedPool.length > 1 ? Math.max(...lngs) - Math.min(...lngs) : 0
    const latSpread = geocodedPool.length > 1 ? Math.max(...lats) - Math.min(...lats) : 0
    const isSpread = lngSpread > 0.3 || latSpread > 0.3

    // Build day buckets
    const buckets: any[][] = Array.from({ length: numDays }, () => [])

    if (isSpread && geocodedPool.length >= numDays) {
      // Multi-city / spread: cluster by proximity using a simple greedy nearest-neighbor per day
      // Sort by lng to get a rough geographic ordering, then assign in blocks
      const sorted = [...pool].sort((a: any, b: any) => (a.lng || 0) - (b.lng || 0))
      sorted.forEach((p, i) => {
        const day = Math.min(Math.floor(i * numDays / sorted.length), numDays - 1)
        if (buckets[day].length < config.stopsPerDay) buckets[day].push(p)
      })
    } else {
      // Same city: distribute evenly across days, mixing categories
      // Sort by category so we interleave different types, then round-robin across days
      const CATEGORY_ORDER = ['cafe', 'breakfast', 'activity', 'museum', 'landmark', 'park', 'shopping', 'restaurant', 'bar', 'other']
      const sorted = [...pool].sort((a: any, b: any) => {
        const ai = CATEGORY_ORDER.findIndex(c => (a.category || '').toLowerCase().includes(c))
        const bi = CATEGORY_ORDER.findIndex(c => (b.category || '').toLowerCase().includes(c))
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })

      // Distribute round-robin: place 0→day0, place 1→day1, ..., place N→day(N%numDays)
      // This guarantees even spread regardless of category distribution
      let dayIdx = 0
      for (const p of sorted) {
        // Find next day that still has room
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
2. Assign a realistic time to each place based on category:
   - cafe/coffee/bakery/breakfast → 8:00–10:00 AM
   - park/market/hike → 10:00–12:00 PM  
   - museum/gallery/landmark/shopping → 1:00–5:00 PM
   - restaurant: if only one → 7:00 PM; if two on same day → one at 12:30 PM (lunch) + one at 7:00 PM (dinner)
   - bar/pub/nightlife → 9:00 PM
   - beach/viewpoint → 11:00 AM or 5:30 PM
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

    // ── Step 4: Fill thin days with suggestions ──
    const thinDays = finalDays.filter((d: any) => d.stops.length < 2)
    if (thinDays.length > 0) {
      const step2Res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Fill thin days with real, well-known suggested places in the destination. Mark each with "suggested": true. Aim for ${config.stopsPerDay} stops per day. Return only the days that need filling.`,
        }, {
          role: 'user',
          content: `Destination: ${trip?.destination}. Add suggestions to reach ${config.stopsPerDay} stops/day.

Days needing suggestions:
${JSON.stringify(thinDays, null, 2)}

Already scheduled (don't repeat):
${JSON.stringify(finalDays.flatMap((d: any) => d.stops.map((s: any) => s.name)), null, 2)}

Return JSON: {"days": [...]}`,
        }],
        response_format: { type: 'json_object' },
      })

      const step2 = JSON.parse(step2Res.choices[0].message.content || '{"days":[]}')
      step2.days?.forEach((filled: any) => {
        const idx = finalDays.findIndex((d: any) => d.day === filled.day)
        if (idx !== -1) finalDays[idx] = filled
      })
    }

    // ── Step 5: Sort stops chronologically, nudge same-category apart, re-attach coords ──
    finalDays = finalDays.map((day: any) => {
      const stops = day.stops.map((s: any) => {
        const coords = coordLookup[s.name.toLowerCase().trim()]
        return {
          ...s,
          time: s.time || fmtHour(defaultHour(s.category)),
          // Re-attach coordinates and place details from DB (GPT strips these)
          ...(coords ? {
            lat: coords.lat,
            lng: coords.lng,
            opening_hours: coords.opening_hours,
            photo_reference: coords.photo_reference,
            rating: coords.rating,
            price_level: coords.price_level,
            address: coords.address,
          } : {}),
        }
      })
      stops.sort((a: any, b: any) => parseMin(a.time) - parseMin(b.time))

      for (let i = 1; i < stops.length; i++) {
        if (stops[i].category === stops[i-1].category) {
          const prev = parseMin(stops[i-1].time)
          const curr = parseMin(stops[i].time)
          if (curr <= prev + 30) {
            const newMin = prev + 90
            const h = Math.floor(newMin / 60) % 24
            const m = newMin % 60
            stops[i] = { ...stops[i], time: `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h < 12 ? 'AM' : 'PM'}` }
          }
        }
      }
      return { ...day, stops }
    })

    console.log('Final:', finalDays.map((d: any) => `Day ${d.day}: ${d.stops.length} stops`))
    return NextResponse.json({ days: finalDays })

  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
