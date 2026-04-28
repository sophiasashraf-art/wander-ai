import { NextResponse } from 'next/server'
import { Client } from '@googlemaps/google-maps-services-js'

const maps = new Client()

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name') || ''
  const location = searchParams.get('location') || ''

  console.log('[place-search] request:', { name, location })

  if (!name) return NextResponse.json({ result: null }, { status: 400 })

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    console.error('[place-search] GOOGLE_PLACES_API_KEY is not set')
    return NextResponse.json({ result: null, error: 'API key not configured' }, { status: 500 })
  }

  try {
    // Step 1: find place_id
    const input = location ? `${name} ${location}` : name
    console.log('[place-search] findPlaceFromText input:', input)
    const findRes = await maps.findPlaceFromText({
      params: {
        input,
        inputtype: 'textquery' as any,
        fields: ['place_id', 'geometry'] as any,
        key: apiKey,
      },
    })
    const placeId = findRes.data.candidates?.[0]?.place_id
    console.log('[place-search] placeId:', placeId, '| status:', findRes.data.status)
    if (!placeId) return NextResponse.json({ result: null })

    // Step 2: fetch details including photos
    const detailRes = await maps.placeDetails({
      params: {
        place_id: placeId,
        key: apiKey,
        fields: ['name', 'photos', 'rating', 'price_level', 'formatted_address', 'opening_hours'] as any,
      },
    })
    const result = detailRes.data.result as any
    console.log('[place-search] details status:', detailRes.data.status, '| hasPhoto:', !!result?.photos?.[0])
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
    console.error('[place-search] error:', e.message, e?.response?.data || '')
    return NextResponse.json({ result: null, error: e.message })
  }
}
