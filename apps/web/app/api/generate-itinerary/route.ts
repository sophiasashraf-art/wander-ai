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

    // Add times to stops that don't have them
    const startHour = 9
    step1.days = step1.days.map((day: any) => ({
      ...day,
      stops: day.stops.map((stop: any, i: number) => ({
        ...stop,
        time: stop.time || `${startHour + i * 2}:00 ${startHour + i * 2 < 12 ? 'AM' : 'PM'}`,
      }))
    }))

    console.log('Final days:', step1.days.map((d: any) => `Day ${d.day}: ${d.stops.length} stops`))
    return NextResponse.json(step1)

  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}