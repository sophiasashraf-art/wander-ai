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

export async function POST(req: Request) {
  try {
    const { tripId, arrivalTime, departureTime } = await req.json()

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
