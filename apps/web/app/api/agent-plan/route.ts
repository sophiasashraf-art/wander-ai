import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { Client } from '@googlemaps/google-maps-services-js'

const openai = new OpenAI()
const maps = new Client()

async function geocodePlace(name: string, destination: string): Promise<any> {
  try {
    const res = await maps.findPlaceFromText({
      params: {
        input: `${name} ${destination}`,
        inputtype: 'textquery' as any,
        fields: ['geometry', 'name', 'formatted_address', 'place_id'] as any,
        key: process.env.GOOGLE_PLACES_API_KEY!,
      }
    })
    const c = res.data.candidates?.[0]
    if (c?.geometry?.location) {
      return { lat: c.geometry.location.lat, lng: c.geometry.location.lng, address: c.formatted_address }
    }
  } catch {}
  return null
}

export async function POST(req: Request) {
  try {
    const { messages, destination, duration, vibe, arrivalTime, departureTime, cities } = await req.json()

    const stopsPerDay = vibe === 'relaxed' ? 3 : vibe === 'everything' ? 6 : 4
    const numDays = parseInt(duration) || 3

    let timeConstraints = ''
    if (arrivalTime) timeConstraints += `\nDay 1: Traveler arrives at ${arrivalTime}. Don't schedule before this.`
    if (departureTime) timeConstraints += `\nDay ${numDays}: Traveler departs at ${departureTime}. Don't schedule at or after this.`

    let tripDescription = ''
    if (cities?.length > 0) {
      const cityBreakdown = cities.map((c: any) => `${c.name} (${c.days} days)`).join(', then ')
      tripDescription = `a multi-city trip: ${cityBreakdown} — ${numDays} days total`
    } else {
      tripDescription = `a trip to ${destination} for ${numDays} days`
    }

    const cityRules = cities?.length > 0
      ? `\n- This is a MULTI-CITY trip. You MUST create days for EVERY city in order:\n${cities.map((c: any, i: number) => `  ${c.name}: ${c.days} day(s)`).join('\n')}\n- Total: ${numDays} days. Assign days sequentially (e.g. if Tokyo=2, Kyoto=3: Days 1-2 are Tokyo, Days 3-5 are Kyoto)\n- Title each day with the city name`
      : ''

    const systemPrompt = `You are a friendly, knowledgeable travel planner helping someone plan ${tripDescription} (${stopsPerDay} stops/day, ${vibe} pace).
${timeConstraints}

Your job:
1. Chat naturally — ask clarifying questions if needed (food preferences, interests, budget, neighborhoods, etc.)
2. When you have enough info OR the user says to go ahead, generate the full itinerary

When generating the itinerary, you MUST include a JSON block wrapped in \`\`\`json ... \`\`\` with this exact format:
{
  "days": [
    {
      "day": 1,
      "title": "Area or theme",
      "stops": [
        {
          "time": "9:00 AM",
          "name": "Exact real place name",
          "category": "cafe|restaurant|activity|museum|landmark|park|shopping|bar|nightlife|other",
          "note": "One sentence tip",
          "suggested": true
        }
      ]
    }
  ]
}

Rules for the itinerary:
- ONLY suggest real, well-known places that actually exist
- Use the exact real name of each place (as it appears on Google Maps)
- Assign times based on category: cafes 8-10am, parks/markets 10am-12pm, lunch 12-2pm, museums/landmarks 2-5pm, dinner 7-9pm, bars 9pm+
- Group nearby places on the same day
- ${numDays} days total, ${stopsPerDay} stops per day
- Every stop must have "suggested": true${cityRules}

Before the JSON, write a brief friendly summary of the plan. After the JSON, ask if they want to change anything.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    })

    const reply = response.choices[0].message.content || ''

    // Try to extract itinerary JSON from the response
    const jsonMatch = reply.match(/```json\s*([\s\S]*?)```/)
    let itinerary = null
    let places: any[] = []

    if (jsonMatch) {
      try {
        // Clean up common GPT JSON issues: trailing commas, comments
        const cleanJson = jsonMatch[1]
          .replace(/,\s*([}\]])/g, '$1')  // trailing commas
          .replace(/\/\/.*$/gm, '')        // line comments
          .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
        const parsed = JSON.parse(cleanJson)
        if (parsed.days?.length > 0) {
          // Geocode all places in parallel
          const allStops = parsed.days.flatMap((d: any) =>
            d.stops.map((s: any) => ({ name: s.name, category: s.category }))
          )
          const geocoded = await Promise.all(
            allStops.map(async (s: any) => {
              const geo = await geocodePlace(s.name, destination)
              return { ...s, ...geo }
            })
          )

          const coordMap: Record<string, any> = {}
          geocoded.forEach((p: any) => {
            if (p.lat && p.lng) coordMap[p.name] = p
          })

          // Attach coords to stops
          itinerary = {
            days: parsed.days.map((day: any) => ({
              ...day,
              stops: day.stops.map((stop: any) => ({
                ...stop,
                lat: coordMap[stop.name]?.lat,
                lng: coordMap[stop.name]?.lng,
                address: coordMap[stop.name]?.address,
              }))
            }))
          }

          places = geocoded.filter((p: any) => p.lat && p.lng)
        }
      } catch (e) {
        console.error('Failed to parse itinerary JSON from agent:', e)
      }
    }

    // Clean the reply — remove the JSON block for display
    const cleanReply = reply.replace(/```json\s*[\s\S]*?```/g, '').trim()

    return NextResponse.json({
      reply: cleanReply,
      itinerary,
      places,
    })
  } catch (e: any) {
    console.error('Agent error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
