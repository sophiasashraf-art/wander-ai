import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import { verifyPlace, upsertPlace, VerifiedPlace } from '../../../lib/placeIngestion'

const openai = new OpenAI()

// Wraps the shared verifyPlace() but keeps this file's existing downstream shape
// (coordMap / redistribution / response `places` all read p.lat, p.address, etc.
// directly) so nothing past this function needs to change. Keeps the raw
// VerifiedPlace on `_verified` so the persistence step below can reuse it
// without a second round of Places API calls.
async function enrichWithCoordinates(place: any, destination: string): Promise<any> {
  const verified = await verifyPlace(place.name, place.city || destination)
  if (!verified) return place
  return {
    ...place,
    lat: verified.lat,
    lng: verified.lng,
    opening_hours: verified.opening_hours || undefined,
    photo_reference: verified.photo_reference || undefined,
    rating: verified.rating || undefined,
    price_level: verified.price_level ?? undefined,
    address: verified.formatted_address || undefined,
    _verified: verified as VerifiedPlace,
  }
}

export async function POST(req: Request) {
  try {
    const { text, tripId, destination, duration } = await req.json()
    const numDays = parseInt(duration) || 3

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a travel assistant. Parse the provided itinerary text into a structured format.
${destination ? '' : '\nThe destination is not known yet — you MUST infer the city for each stop from context (place names, landmarks, neighborhoods mentioned). This is required.\n'}
The trip is ${numDays} days long. You MUST return exactly ${numDays} days.
- If the user's text only covers some days, create the remaining days as empty (with an empty stops array and a generic title like "Day 3").
- If the user's text has more days than ${numDays}, combine the extra days into the last day.

Extract each day with its stops. For each stop include:
- The exact time if mentioned by the user (e.g. "1:15 PM", "5:00 PM", "9pm" → "9:00 PM"). PRESERVE the user's times exactly — do not change or round them.
- If NO time is mentioned for a stop, assign a reasonable time based on the activity type (cafes in morning, restaurants at meal times, bars in evening, etc.)
- The place/activity name (restaurant, attraction, hotel, etc.)
- city: the actual trip-level city or town this stop is in (infer from context if not explicit) — the level someone would name as their travel destination (e.g. "San Diego", "Paris"). NEVER use a neighborhood, district, or area name here even if that's the only location mentioned (e.g. "La Jolla" or "Coronado" → "San Diego"; "Shibuya" → "Tokyo") — resolve it up to the real city. Getting this wrong causes real damage downstream: stops get incorrectly split into a multi-city trip instead of staying grouped as one destination.
- A short note if there are specific details
- tip: practical advice mentioned in the text (e.g. "arrive before 10am, there's a line", "cash only"). Omit if none is mentioned — don't invent one.
- why_recommended: what makes it stand out per the text — vibe, standout dish, unique feature. Omit if the text gives no real reason.
- Category: restaurant | bar | activity | stay | cafe | travel | personal | other
  - Use "personal" for logistical or social events that are NOT a real venue: arrivals ("Bram lands"), pickups ("Pick up Idil"), people arriving ("Jill and Alina come in"), etc.
  - Use "travel" only for flights/transit stops
  - Use "bar" for cocktail bars, pubs, lounges, clubs, and nightlife venues — not "activity"
  - Use the other categories for real places/venues
- geocodable: true ONLY if this is a specific named venue/place with a real address that can be found on Google Maps.
  Set geocodable: false for:
  - Generic food/drink descriptions without a venue name: "poke", "poke / coconut water", "tacos", "coffee", "ice cream", "drinks"
  - Vague activity descriptions: "beach day", "explore downtown", "shopping"
  - Personal/logistical events: arrivals, pickups, people coming/going
  - Anything with "/" that describes a food type rather than a place name
  Examples of geocodable: true → "Nomade", "An's Dry Cleaning", "Barista Botanist", "Windansea Beach"
  Examples of geocodable: false → "Poke / Coconut Water", "tacos somewhere", "coffee", "beach vibes"

If day names (friday, saturday, etc.) or dates are mentioned, use them as day titles and extract the start date if possible (YYYY-MM-DD format).

Also return a top-level boolean "userProvidedStructure":
- true if the user's text explicitly assigned stops to days and/or gave real times/sequencing (day names, "Day 1", "morning", explicit clock times, ordered lists implying sequence)
- false if it's just a flat list of places/activities with no day or time cues at all, and you had to invent which day/time each one goes in yourself
This must reflect what the USER wrote, not what you assigned — if you had to guess the schedule, it's false even though your output now has times and days filled in.

Return valid JSON only:
{
  "startDate": "2024-09-12",
  "userProvidedStructure": true,
  "days": [
    {
      "day": 1,
      "title": "Friday",
      "stops": [
        {
          "time": "1:15 PM",
          "name": "Solidcore Midtown",
          "city": "New York",
          "category": "activity",
          "note": "",
          "tip": "book ahead, classes fill up",
          "why_recommended": "",
          "geocodable": true
        },
        {
          "time": "6:00 PM",
          "name": "Bram lands",
          "city": "New York",
          "category": "personal",
          "note": "",
          "geocodable": false
        }
      ]
    }
  ]
}`,
      }, {
        role: 'user',
        content: text,
      }],
      response_format: { type: 'json_object' },
    })

    const parsed = JSON.parse(response.choices[0].message.content || '{"days":[]}')
    console.log('import-itinerary parsed:', JSON.stringify(parsed, null, 2))

    // Extract unique place names for coordinate enrichment
    const allPlaces = parsed.days?.flatMap((d: any) =>
      d.stops.map((s: any) => ({ name: s.name, category: s.category, geocodable: s.geocodable, city: s.city, tip: s.tip, why_recommended: s.why_recommended }))
    ) || []

    // Filter out personal/logistical events that aren't real geocodable places.
    // These are things like "Bram lands", "Pick up idil", "Jill arrives", etc.
    // Only attempt geocoding for stops that look like actual venues/locations.
    const PERSONAL_PATTERNS = [
      /\b(lands?|arrives?|arriving|arrival|coming in|come in)\b/i,
      /^(pick up|drop off|pickup|dropoff)\b/i,
      /\b(flight|uber|lyft|taxi|drive|driving|bus|train|transit)\b/i,
      /\b(dinner|lunch|breakfast|brunch|coffee|drinks?)\s+(with\s+)?\w+$/i,
      // Generic food/drink descriptions with slash (e.g. "Poke / Coconut Water")
      /^[\w\s]+\/[\w\s]+$/, // "X / Y" pattern without a proper venue name
    ]
    function isGeocodable(name: string, category: string, geocodable?: boolean): boolean {
      if (category === 'travel' || category === 'personal') return false
      // Trust GPT's explicit flag if provided
      if (geocodable === false) return false
      if (geocodable === true) return true
      // Fallback regex for older responses without the flag
      for (const pattern of PERSONAL_PATTERNS) {
        if (pattern.test(name)) return false
      }
      return true
    }

    // Enrich with coordinates in parallel (limit to avoid rate limits)
    const enriched = await Promise.all(
      allPlaces.map((p: any) =>
        isGeocodable(p.name, p.category, p.geocodable)
          ? enrichWithCoordinates(p, destination)
          : Promise.resolve(p)
      )
    )

    // Build a lookup map
    const coordMap: Record<string, { lat?: number; lng?: number; opening_hours?: string[]; photo_reference?: string; rating?: number; price_level?: number; address?: string }> = {}
    enriched.forEach((p: any) => {
      if (p.lat && p.lng) coordMap[p.name] = {
        lat: p.lat,
        lng: p.lng,
        opening_hours: p.opening_hours,
        photo_reference: p.photo_reference,
        rating: p.rating,
        price_level: p.price_level,
        address: p.address,
      }
    })

    // Attach coordinates and place details to stops
    const daysWithCoords = parsed.days?.map((day: any) => ({
      ...day,
      stops: day.stops.map((stop: any) => ({
        ...stop,
        lat: coordMap[stop.name]?.lat,
        lng: coordMap[stop.name]?.lng,
        opening_hours: coordMap[stop.name]?.opening_hours,
        photo_reference: coordMap[stop.name]?.photo_reference,
        rating: coordMap[stop.name]?.rating,
        price_level: coordMap[stop.name]?.price_level,
        address: coordMap[stop.name]?.address,
      }))
    })) || []

    // Save places to Supabase — real google_place_id dedup via the shared helper,
    // reusing the Places lookup already done in enrichWithCoordinates above.
    if (tripId) {
      const rawInput = text.slice(0, 2000)
      await Promise.all(
        enriched
          .filter((p: any) => p.lat && p.lng)
          .map((p: any) => upsertPlace({
            trip_id: tripId,
            name: p.name,
            category: p.category,
            city: p.city || destination,
            tip: p.tip || null,
            why_recommended: p.why_recommended || null,
            raw_input: rawInput,
            source: 'pasted_text',
          }, p._verified ?? null))
      )
    }

    // If all stops landed on day 1 and other days are empty, the input was an unstructured
    // list. Redistribute across days using vibe/duration settings.
    const stopsOnDay1 = daysWithCoords[0]?.stops.length ?? 0
    const totalStops = daysWithCoords.reduce((a: number, d: any) => a + d.stops.length, 0)
    const isUnstructured = numDays > 1 && totalStops > 0 && stopsOnDay1 === totalStops

    console.log('isUnstructured:', isUnstructured, 'stopsOnDay1:', stopsOnDay1, 'totalStops:', totalStops, 'numDays:', numDays)

    if (isUnstructured) {
      const vibeConfig: Record<string, number> = { relaxed: 3, balanced: 4, everything: 6 }
      let stopsPerDayLimit = 4
      if (tripId) {
        const { data: trip } = await supabase.from('trips').select('vibe').eq('id', tripId).single()
        stopsPerDayLimit = vibeConfig[(trip?.vibe as string) || 'balanced'] || 4
      }

      // Use enriched places directly (already geocoded, no DB round-trip needed)
      // Fall back to all stops from day 1 if geocoding failed
      const geocodableStops = daysWithCoords[0].stops.filter((s: any) => s.lat && s.lng)
      const pool: any[] = geocodableStops.length > 0 ? geocodableStops : daysWithCoords[0].stops

      // Detect geographic spread
      const lngs = pool.filter((p: any) => p.lng).map((p: any) => p.lng as number)
      const lats = pool.filter((p: any) => p.lat).map((p: any) => p.lat as number)
      const lngSpread = lngs.length > 1 ? Math.max(...lngs) - Math.min(...lngs) : 0
      const latSpread = lats.length > 1 ? Math.max(...lats) - Math.min(...lats) : 0
      const isSpread = lngSpread > 0.3 || latSpread > 0.3

      console.log('redistribution: pool size:', pool.length, 'isSpread:', isSpread, 'lngSpread:', lngSpread, 'latSpread:', latSpread)

      const buckets: any[][] = Array.from({ length: numDays }, () => [])

      if (isSpread && pool.length >= numDays) {
        const sorted = [...pool].sort((a: any, b: any) => (a.lng || 0) - (b.lng || 0))
        sorted.forEach((p, i) => {
          const day = Math.min(Math.floor(i * numDays / sorted.length), numDays - 1)
          if (buckets[day].length < stopsPerDayLimit) buckets[day].push(p)
        })
      } else {
        const CATEGORY_ORDER = ['cafe', 'breakfast', 'activity', 'museum', 'landmark', 'park', 'shopping', 'restaurant', 'bar', 'other']
        const sorted = [...pool].sort((a: any, b: any) => {
          const ai = CATEGORY_ORDER.findIndex(c => (a.category || '').toLowerCase().includes(c))
          const bi = CATEGORY_ORDER.findIndex(c => (b.category || '').toLowerCase().includes(c))
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
        })
        let dayIdx = 0
        for (const p of sorted) {
          let attempts = 0
          while (buckets[dayIdx].length >= stopsPerDayLimit && attempts < numDays) {
            dayIdx = (dayIdx + 1) % numDays
            attempts++
          }
          if (attempts < numDays) {
            buckets[dayIdx].push(p)
            dayIdx = (dayIdx + 1) % numDays
          }
        }
      }

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
      function defaultHour(cat: string): number {
        const c = (cat || '').toLowerCase()
        for (const [k, h] of Object.entries(CATEGORY_HOUR)) if (c.includes(k)) return h
        return 14
      }
      function fmtHour(h: number): string {
        const hh = h % 24
        return `${hh % 12 || 12}:00 ${hh < 12 ? 'AM' : 'PM'}`
      }
      function parseMinLocal(t: string): number {
        const m = t?.match(/(\d+):(\d+)\s*(AM|PM)/i)
        if (!m) return 0
        let h = parseInt(m[1]); const min = parseInt(m[2])
        if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
        if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
        return h * 60 + min
      }
      function clampTime(timeStr: string, category: string): string {
        const c = (category || '').toLowerCase()
        let window: [number, number] | null = null
        for (const [k, w] of Object.entries(CATEGORY_WINDOW)) {
          if (c.includes(k)) { window = w; break }
        }
        if (!window) return timeStr
        const mins = parseMinLocal(timeStr)
        if (mins === 0) return timeStr
        const [earliest, latest] = window
        if (mins >= earliest && mins <= latest) return timeStr
        return fmtHour(defaultHour(category))
      }

      const redistributed = buckets.map((bucket, i) => ({
        day: i + 1,
        title: `Day ${i + 1}`,
        stops: bucket
          .map((s: any) => ({
            time: clampTime(s.time || fmtHour(defaultHour(s.category)), s.category),
            name: s.name,
            category: s.category,
            note: s.note || '',
            suggested: false,
            lat: s.lat,
            lng: s.lng,
            opening_hours: s.opening_hours,
            photo_reference: s.photo_reference,
            rating: s.rating,
            price_level: s.price_level,
            address: s.address,
          }))
          .sort((a: any, b: any) => parseMinLocal(a.time) - parseMinLocal(b.time)),
      }))

      console.log('redistributed:', redistributed.map((d: any) => `Day ${d.day}: ${d.stops.map((s: any) => s.name).join(', ')}`))

      const responsePlaces = enriched.map(({ _verified, ...rest }: any) => rest)
      return NextResponse.json({
        days: redistributed,
        redistributed: true,
        userProvidedStructure: false,
        startDate: parsed.startDate || null,
        places: responsePlaces,
      })
    }

    const responsePlaces = enriched.map(({ _verified, ...rest }: any) => rest)
    return NextResponse.json({
      days: daysWithCoords,
      userProvidedStructure: parsed.userProvidedStructure ?? false,
      startDate: parsed.startDate || null,
      places: responsePlaces,
    })
  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
