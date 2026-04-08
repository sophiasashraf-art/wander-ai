import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import { Client } from '@googlemaps/google-maps-services-js'

const openai = new OpenAI()
const maps = new Client()

async function enrichWithCoordinates(place: any, destination: string): Promise<any> {
  try {
    const response = await maps.findPlaceFromText({
      params: {
        input: `${place.name} ${destination}`,
        inputtype: 'textquery' as any,
        fields: ['geometry', 'name', 'formatted_address'] as any,
        key: process.env.GOOGLE_PLACES_API_KEY!,
      }
    })
    const candidate = response.data.candidates?.[0]
    if (candidate?.geometry?.location) {
      return {
        ...place,
        lat: candidate.geometry.location.lat,
        lng: candidate.geometry.location.lng,
      }
    }
  } catch {}
  return place
}

export async function POST(req: Request) {
  try {
    const { text, tripId, destination } = await req.json()

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a travel assistant. Parse the provided itinerary text into a structured format.

Extract each day with its stops. For each stop include:
- The exact time if mentioned (e.g. "12:00 PM", "2:30 PM")
- The place/activity name (restaurant, attraction, hotel, etc.)
- A short note if there are specific details (e.g. "deep-dish pizza", "free admission")
- Category: restaurant | activity | stay | cafe | other

If dates are mentioned, extract the start date (YYYY-MM-DD format).

Return valid JSON only:
{
  "startDate": "2024-09-12",
  "days": [
    {
      "day": 1,
      "title": "Arrival and Exploration",
      "date": "Thursday, September 12",
      "stops": [
        {
          "time": "12:00 PM",
          "name": "O'Hare Airport",
          "category": "activity",
          "note": "Arrival"
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

    // Extract unique place names for coordinate enrichment
    const allPlaces = parsed.days?.flatMap((d: any) =>
      d.stops.map((s: any) => ({ name: s.name, category: s.category }))
    ) || []

    // Enrich with coordinates in parallel (limit to avoid rate limits)
    const enriched = await Promise.all(
      allPlaces.map((p: any) => enrichWithCoordinates(p, destination))
    )

    // Build a lookup map
    const coordMap: Record<string, { lat?: number; lng?: number }> = {}
    enriched.forEach((p: any) => {
      if (p.lat && p.lng) coordMap[p.name] = { lat: p.lat, lng: p.lng }
    })

    // Attach coordinates to stops
    const daysWithCoords = parsed.days?.map((day: any) => ({
      ...day,
      stops: day.stops.map((stop: any) => ({
        ...stop,
        lat: coordMap[stop.name]?.lat,
        lng: coordMap[stop.name]?.lng,
      }))
    })) || []

    // Save places to Supabase
    if (tripId) {
      const placesToInsert = enriched
        .filter((p: any) => p.lat && p.lng)
        .map((p: any) => ({
          name: p.name,
          category: p.category,
          city: destination,
          description: '',
          lat: p.lat,
          lng: p.lng,
          trip_id: tripId,
        }))

      if (placesToInsert.length > 0) {
        // Avoid duplicates
        const { data: existing } = await supabase
          .from('places')
          .select('name')
          .eq('trip_id', tripId)
        const existingNames = new Set((existing || []).map((p: any) => p.name.toLowerCase()))
        const newPlaces = placesToInsert.filter(
          (p: any) => !existingNames.has(p.name.toLowerCase())
        )
        if (newPlaces.length > 0) {
          await supabase.from('places').insert(newPlaces)
        }
      }
    }

    return NextResponse.json({
      days: daysWithCoords,
      startDate: parsed.startDate || null,
    })
  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
