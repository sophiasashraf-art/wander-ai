import { NextResponse } from 'next/server'
import { Client } from '@googlemaps/google-maps-services-js'

const maps = new Client()

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name') || ''
  const location = searchParams.get('location') || ''

  if (!name) return NextResponse.json({ result: null }, { status: 400 })

  try {
    // Step 1: find place_id
    const findRes = await maps.findPlaceFromText({
      params: {
        input: location ? `${name} ${location}` : name,
        inputtype: 'textquery' as any,
        fields: ['place_id', 'geometry'] as any,
        key: process.env.GOOGLE_PLACES_API_KEY!,
      },
    })
    const placeId = findRes.data.candidates?.[0]?.place_id
    if (!placeId) return NextResponse.json({ result: null })

    // Step 2: fetch details including photos
    const detailRes = await maps.placeDetails({
      params: {
        place_id: placeId,
        key: process.env.GOOGLE_PLACES_API_KEY!,
        fields: ['name', 'photos', 'rating', 'price_level', 'formatted_address', 'opening_hours'] as any,
      },
    })
    const result = detailRes.data.result as any
    return NextResponse.json({
      result: {
        name: result?.name,
        photo_reference: result?.photos?.[0]?.photo_reference || null,
        rating: result?.rating || null,
        price_level: result?.price_level ?? null,
        address: result?.formatted_address || null,
        opening_hours: result?.opening_hours?.weekday_text || null,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ result: null, error: e.message })
  }
}
