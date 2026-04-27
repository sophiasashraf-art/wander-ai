import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

const openai = new OpenAI()

export async function POST(req: Request) {
  try {
    const { tripId } = await req.json()

    const { data: trip } = await supabase
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .single()

    const { data: places } = await supabase
      .from('places')
      .select('*')
      .eq('trip_id', tripId)

    console.log('tripId:', tripId)
    console.log('places count:', places?.length)

    if (!places || places.length === 0) {
      return NextResponse.json({ error: 'No places found' }, { status: 400 })
    }

    const vibeConfig = {
      relaxed: { stopsPerDay: 3, notes: 'Slow pace, include rest time and long meals.' },
      balanced: { stopsPerDay: 4, notes: 'Mix of activity and downtime.' },
      everything: { stopsPerDay: 6, notes: 'Pack in as many places as possible.' },
    }

    const config = vibeConfig[(trip?.vibe as keyof typeof vibeConfig) || 'balanced']
    const numDays = parseInt(trip?.duration) || 3
    const arrivalInfo = ''
    const departureInfo = ''

    // Build travel context for the prompt
    let travelContext = ''
    if (arrivalInfo) travelContext += `\nARRIVAL: The traveler arrives on Day 1 — ${arrivalInfo}. Do NOT schedule anything before their arrival time.`
    if (departureInfo) travelContext += `\nDEPARTURE: The traveler departs on the last day — ${departureInfo}. Do NOT schedule anything after their departure time. Leave room before departure for getting to the airport/station.`

    // ── STEP 1: Group saved places into days by geography ──
    const step1Response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a travel planner. Your ONLY job is to group the provided places into days based on geographic proximity.

RULES:
- Create exactly ${numDays} days
- Group places that are close together (similar lat/lng) on the same day
- Spread places evenly across days — don't put everything on day 1
- Use ALL provided places — every single one must appear exactly once
- Each stop must have "suggested": false
- Give each day a title based on the area or theme
- Assign realistic times based on the category of each place:
  • Cafes, bakeries, breakfast spots → morning only (8:00–10:00 AM) — NEVER schedule these at night
  • Markets, parks, gardens, hikes → late morning (10:00 AM–12:00 PM)
  • Lunch spots → midday (12:00–2:00 PM)
  • Museums, galleries, shopping, landmarks → afternoon (2:00–5:00 PM)
  • Restaurants (dinner), bars, nightlife, pubs → evening only (6:00–10:00 PM) — NEVER schedule these in the morning
  • Beaches, viewpoints → flexible but prefer late morning or late afternoon (sunset)
- Order stops within each day chronologically by their assigned time
- NEVER schedule two stops of the same category back to back (e.g. no two cafes in a row, no two restaurants in a row). Vary the types of stops throughout the day.
${travelContext}

Return valid JSON only.
Format: {"days": [{"day": 1, "title": "Area name", "stops": [{"time": "9:00 AM", "name": "exact place name from list", "category": "...", "note": "one sentence tip", "suggested": false}]}]}`,
      }, {
        role: 'user',
        content: `Group these ${places.length} places into exactly ${numDays} days for ${trip?.destination}.

Use the lat/lng coordinates to group geographically close places together. Here are the places sorted by longitude (west to east) to help you see which are far apart:

${JSON.stringify(places
  .sort((a: any, b: any) => a.lng - b.lng)
  .map((p: any) => ({
    name: p.name,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    note: p.description,
  })), null, 2)}

IMPORTANT: Places with very different coordinates (more than 0.5 degrees apart) are far from each other and should be on different days. For example if one place has lng 45.9 and another has lng 46.6 they are far apart — do not put them on the same day unless there are no other options.`,
      }],
      response_format: { type: 'json_object' },
    })

    const step1 = JSON.parse(step1Response.choices[0].message.content || '{"days":[]}')

    // Remove exact duplicate stops across days
    const seenPlaces = new Set<string>()
    step1.days = step1.days.map((day: any) => ({
      ...day,
      stops: day.stops.filter((stop: any) => {
        const key = stop.name.toLowerCase().trim()
        if (seenPlaces.has(key)) return false
        seenPlaces.add(key)
        return true
      })
    }))

    console.log('Step 1 days:', step1.days.map((d: any) => `Day ${d.day}: ${d.stops.length} stops`))

    // ── STEP 2: Fill thin days with suggestions ──
    const thinDays = step1.days.filter((d: any) => d.stops.length < 2)

    if (thinDays.length > 0) {
      const step2Response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `You are a travel planner. Fill in thin days with realistic suggested places.
- Only suggest real, well-known places in the destination
- Mark every suggested stop with "suggested": true
- Match the geographic area/theme of the day
- Suggest ${config.stopsPerDay} total stops per day
- Return only the days that need filling`,
        }, {
          role: 'user',
          content: `These days in ${trip?.destination} need more stops. Add suggestions to reach ${config.stopsPerDay} stops per day.

Days needing suggestions:
${JSON.stringify(thinDays, null, 2)}

Full itinerary context (don't repeat these places):
${JSON.stringify(step1.days.flatMap((d: any) => d.stops.map((s: any) => s.name)), null, 2)}

Return JSON: {"days": [{"day": 1, "title": "...", "stops": [...existing stops with suggested:false..., ...new stops with suggested:true...]}]}`,
        }],
        response_format: { type: 'json_object' },
      })

      const step2 = JSON.parse(step2Response.choices[0].message.content || '{"days":[]}')

      // Merge step2 days back into step1
      step2.days?.forEach((filledDay: any) => {
        const idx = step1.days.findIndex((d: any) => d.day === filledDay.day)
        if (idx !== -1) {
          step1.days[idx] = filledDay
        }
      })
    }

    // Add times to stops that don't have them, using category-aware defaults
    const categoryTimeDefaults: Record<string, number> = {
      // Morning only
      cafe: 9, bakery: 8, breakfast: 8, coffee: 9, brunch: 10,
      // Late morning
      market: 10, park: 10, garden: 10, hike: 9, trail: 9, nature: 10,
      // Midday
      lunch: 12, food: 12,
      // Afternoon
      museum: 14, gallery: 14, shopping: 15, landmark: 14, monument: 14,
      temple: 14, church: 14, tour: 14,
      // Flexible
      beach: 11, viewpoint: 17, sunset: 18,
      // Evening only
      restaurant: 19, dinner: 19, bar: 20, nightlife: 21, pub: 20, club: 22,
    }
    function getDefaultHour(category: string): number {
      const cat = (category || '').toLowerCase()
      for (const [key, hour] of Object.entries(categoryTimeDefaults)) {
        if (cat.includes(key)) return hour
      }
      return 12
    }
    function formatHourFallback(hour: number): string {
      const h = hour % 24
      const period = h < 12 ? 'AM' : 'PM'
      const display = h % 12 || 12
      return `${display}:00 ${period}`
    }
    step1.days = step1.days.map((day: any) => {
      const stops = day.stops.map((stop: any) => ({
        ...stop,
        time: stop.time || formatHourFallback(getDefaultHour(stop.category)),
      }))
      // Sort by time so the day reads chronologically
      stops.sort((a: any, b: any) => {
        const parse = (t: string) => {
          const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i)
          if (!m) return 0
          let h = parseInt(m[1]); const min = parseInt(m[2]); const p = m[3].toUpperCase()
          if (p === 'PM' && h !== 12) h += 12; if (p === 'AM' && h === 12) h = 0
          return h * 60 + min
        }
        return parse(a.time) - parse(b.time)
      })

      // Nudge consecutive same-category stops apart by 90 min
      for (let i = 1; i < stops.length; i++) {
        const prev = stops[i - 1]
        const curr = stops[i]
        if (prev.category && curr.category && prev.category === curr.category) {
          const parseMin = (t: string) => {
            const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i)
            if (!m) return 0
            let h = parseInt(m[1]); const min = parseInt(m[2]); const p = m[3].toUpperCase()
            if (p === 'PM' && h !== 12) h += 12; if (p === 'AM' && h === 12) h = 0
            return h * 60 + min
          }
          const fmtMin = (total: number) => {
            const h = Math.floor(total / 60) % 24
            const min = total % 60
            const period = h < 12 ? 'AM' : 'PM'
            const display = h % 12 || 12
            return `${display}:${String(min).padStart(2, '0')} ${period}`
          }
          const prevMin = parseMin(prev.time)
          const currMin = parseMin(curr.time)
          if (currMin <= prevMin + 30) {
            stops[i] = { ...curr, time: fmtMin(prevMin + 90) }
          }
        }
      }
      return { ...day, stops }
    })

    // ── Parse travel info into clean stops using GPT ──
    async function parseTravelInfo(info: string, type: 'arrival' | 'departure', dest: string): Promise<{ time: string; name: string; note: string }> {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `You parse travel details from user input. Return valid JSON with: time, name, note.

Example input: "DL0711 4/19/2026 atl-las landing at 6:27pm"
Example output: {"time": "6:27 PM", "name": "✈ Delta DL0711 · ATL → LAS", "note": "Lands at Harry Reid International Airport (LAS) · April 19, 2026"}

Example input: "driving in around 10am"
Example output: {"time": "10:00 AM", "name": "🚗 Arrive by car", "note": ""}

Example input: "AA 2381 departing 3pm"
Example output: {"time": "3:00 PM", "name": "✈ American AA2381", "note": ""}

Known airline codes: DL=Delta, AA=American, UA=United, WN=Southwest, B6=JetBlue, NK=Spirit, F9=Frontier, AS=Alaska.
Know your airport codes — ATL=Hartsfield-Jackson Atlanta, LAS=Harry Reid Las Vegas, LAX=Los Angeles, JFK=John F. Kennedy New York, ORD=O'Hare Chicago, etc.
The trip destination is ${dest}. Use this to fill in airport names when you recognize the codes.
Always replace airport codes with the actual route using → arrow.
Format times as H:MM AM/PM. If no time given, use "TBD".`,
        }, {
          role: 'user',
          content: `Parse this ${type} info: ${info}`,
        }],
        response_format: { type: 'json_object' },
      })
      try {
        const parsed = JSON.parse(res.choices[0].message.content || '{}')
        if (!parsed.time || parsed.time === 'N/A' || parsed.time === 'TBD') {
          parsed.time = parseTimeFromText(info) || 'TBD'
        }
        return parsed
      } catch {
        const time = parseTimeFromText(info) || 'TBD'
        return { time, name: `${type === 'arrival' ? '✈ Arrive' : '✈ Depart'} — ${info}`, note: '' }
      }
    }

    if (arrivalInfo && step1.days?.length > 0) {
      const parsed = await parseTravelInfo(arrivalInfo, 'arrival', trip?.destination || '')
      step1.days[0].stops.unshift({
        time: parsed.time,
        name: parsed.name,
        category: 'travel',
        note: parsed.note,
        suggested: false,
      })
    }

    if (departureInfo && step1.days?.length > 0) {
      const parsed = await parseTravelInfo(departureInfo, 'departure', trip?.destination || '')
      const lastDay = step1.days[step1.days.length - 1]
      lastDay.stops.push({
        time: parsed.time,
        name: parsed.name,
        category: 'travel',
        note: parsed.note,
        suggested: false,
      })
    }

    console.log('Final days:', step1.days.map((d: any) => `Day ${d.day}: ${d.stops.length} stops`))
    return NextResponse.json(step1)

  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}