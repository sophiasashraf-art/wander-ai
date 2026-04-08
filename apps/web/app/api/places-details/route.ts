import { NextResponse } from 'next/server'
import { Client } from '@googlemaps/google-maps-services-js'

const maps = new Client()

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const placeId = searchParams.get('placeId') || ''
  const session = searchParams.get('session') || ''

  try {
    const res = await maps.placeDetails({
      params: {
        place_id: placeId,
        key: process.env.GOOGLE_PLACES_API_KEY!,
        sessiontoken: session,
        fields: ['name', 'geometry', 'types', 'formatted_address', 'address_components'] as any,
      },
    })
    return NextResponse.json({ result: res.data.result })
  } catch (e: any) {
    return NextResponse.json({ result: null, error: e.message })
  }
}
