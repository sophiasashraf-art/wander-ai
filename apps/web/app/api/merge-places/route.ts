import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

const openai = new OpenAI()

export async function POST(req: Request) {
  try {
    const { tripId, newPlaces } = await req.json()

    const { data: trip } = await supabase
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .single()

    if (!trip?.itinerary?.days) {
      return NextResponse.json({ error: 'No existing itinerary found' }, { status: 400 })
    }

    const existingDays = trip.itinerary.days

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a travel planner. You have an existing itinerary and need to slot in new places.

RULES:
- Add each new place to the most geographically appropriate day based on lat/lng proximity to existing stops
- If a new place has no coordinates, add it to the day with the most thematically similar stops
- Do not remove or reorder any existing stops
- Append new stops at the end of the chosen day
- Mark all new stops with "suggested": false
- Return the complete updated itinerary with ALL days and ALL stops

Return valid JSON only.
Format: {"days": [{"day": 1, "title": "...", "stops": [...]}]}`,
      }, {
        role: 'user',
        content: `Existing itinerary for ${trip.destination}:
${JSON.stringify(existingDays, null, 2)}

New places to slot in:
${JSON.stringify(newPlaces.map((p: any) => ({
  name: p.name,
  category: p.category,
  lat: p.lat,
  lng: p.lng,
  note: p.description,
})), null, 2)}

Add each new place to the most geographically appropriate day.`,
      }],
      response_format: { type: 'json_object' },
    })

    const result = JSON.parse(response.choices[0].message.content || '{"days":[]}')

    // Save merged itinerary back to Supabase
    await supabase
      .from('trips')
      .update({ itinerary: result })
      .eq('id', tripId)

    return NextResponse.json(result)
  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
