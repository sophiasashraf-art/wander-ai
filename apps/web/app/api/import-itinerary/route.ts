import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import { Client } from '@googlemaps/google-maps-services-js'

const openai = new OpenAI()
const maps = new Client()

async function enrichWithCoordinates(place: any, destination: string): Promise<any> {
  try {
    // Step 1: find the place to get a place_id
    const findRes = await maps.findPlaceFromText({
      params: {
        input: `${place.name} ${destination}`,
        inputtype: 'textquery' as any,
        fields: ['place_id', 'geometry', 'name'] as any,
        key: process.env.GOOGLE_PLACES_API_KEY!,
      }
    })
    const candidate = findRes.data.candidates?.[0]
    if (!candidate?.geometry?.location) return place

    const enriched: any = {
      ...place,
      lat: candidate.geometry.location.lat,
      lng: candidate.geometry.location.lng,
    }

    // Step 2: fetch opening hours + photo reference if we have a place_id
    if (candidate.place_id) {
      try {
        const detailRes = await maps.placeDetails({
          params: {
            place_id: candidate.place_id,
            key: process.env.GOOGLE_PLACES_API_KEY!,
            fields: ['opening_hours', 'photos', 'rating', 'price_level', 'formatted_address'] as any,
          }
        })
        const result = detailRes.data.result
        const hours = result?.opening_hours
        if (hours?.weekday_text?.length) {
          enriched.opening_hours = hours.weekday_text
          enriched.open_now = hours.open_now
        }
        // Store first photo reference for the popup
        const photoRef = (result as any)?.photos?.[0]?.photo_reference
        if (photoRef) enriched.photo_reference = photoRef
        if (result?.rating) enriched.rating = result.rating
        if ((result as any)?.price_level !== undefined) enriched.price_level = (result as any).price_level
        if (result?.formatted_address) enriched.address = result.formatted_address
      } catch {
        // best-effort, don't fail enrichment
      }
    }

    return enriched
  } catch {}
  return place
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

The trip is ${numDays} days long. You MUST return exactly ${numDays} days.
- If the user's text only covers some days, create the remaining days as empty (with an empty stops array and a generic title like "Day 3").
- If the user's text has more days than ${numDays}, combine the extra days into the last day.

Extract each day with its stops. For each stop include:
- The exact time if mentioned by the user (e.g. "1:15 PM", "5:00 PM", "9pm" → "9:00 PM"). PRESERVE the user's times exactly — do not change or round them.
- If NO time is mentioned for a stop, assign a reasonable time based on the activity type (cafes in morning, restaurants at meal times, bars in evening, etc.)
- The place/activity name (restaurant, attraction, hotel, etc.)
- A short note if there are specific details
- Category: restaurant | activity | stay | cafe | travel | personal | other
  - Use "personal" for logistical or social events that are NOT a real venue: arrivals ("Bram lands"), pickups ("Pick up Idil"), people arriving ("Jill and Alina come in"), etc.
  - Use "travel" only for flights/transit stops
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

Return valid JSON only:
{
  "startDate": "2024-09-12",
  "days": [
    {
      "day": 1,
      "title": "Friday",
      "stops": [
        {
          "time": "1:15 PM",
          "name": "Solidcore Midtown",
          "category": "activity",
          "note": "",
          "geocodable": true
        },
        {
          "time": "6:00 PM",
          "name": "Bram lands",
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
      d.stops.map((s: any) => ({ name: s.name, category: s.category, geocodable: s.geocodable }))
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

    // Save places to Supabase
    if (tripId) {
      const placesToInsert = enriched
        .filter((p: any) => p.lat && p.lng)
        .map((p: any) => ({
          name: p.name,
          category: p.category,
          city: destination,
          description: p.address || '',
          lat: p.lat,
          lng: p.lng,
          trip_id: tripId,
          opening_hours: p.opening_hours || null,
          photo_reference: p.photo_reference || null,
          rating: p.rating || null,
          price_level: p.price_level ?? null,
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
      places: enriched,
    })
  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
