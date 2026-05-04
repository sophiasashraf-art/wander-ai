import { NextResponse } from 'next/server'
import { Client } from '@googlemaps/google-maps-services-js'

const maps = new Client()

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || ''
  const session = searchParams.get('session') || ''

  if (!q.trim()) return NextResponse.json({ predictions: [] })

  try {
    const res = await maps.placeAutocomplete({
      params: {
        input: q,
        key: process.env.GOOGLE_PLACES_API_KEY!,
        sessiontoken: session,
        types: '(cities)' as any,
      },
    })
    return NextResponse.json({ predictions: res.data.predictions })
  } catch (e: any) {
    return NextResponse.json({ predictions: [], error: e.message })
  }
}
