import { NextResponse } from 'next/server'

interface LatLng { lat: number; lng: number }

// One computeRoutes call per day (origin + intermediates + destination) returns
// a per-leg breakdown directly — cheaper than N-1 separate calls for N stops.
// Walking mode always: stops within a single day's plan are assumed to be
// local to each other, and a long walk time still reads fine as a signal to
// the user ("maybe grab a cab") rather than needing mode-switching logic.
export async function POST(req: Request) {
  try {
    const { stops } = await req.json() as { stops: LatLng[] }
    if (!Array.isArray(stops) || stops.length < 2) {
      return NextResponse.json({ legs: [] })
    }

    const [origin, ...rest] = stops
    const destination = rest[rest.length - 1]
    const intermediates = rest.slice(0, -1)

    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY!,
        'X-Goog-FieldMask': 'routes.legs.duration,routes.legs.distanceMeters',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        intermediates: intermediates.map(s => ({ location: { latLng: { latitude: s.lat, longitude: s.lng } } })),
        travelMode: 'WALK',
      }),
    })

    if (!res.ok) {
      console.error('route-distance: Routes API returned', res.status, await res.text().catch(() => ''))
      return NextResponse.json({ legs: [] })
    }

    const data = await res.json()
    const legs = (data.routes?.[0]?.legs || []).map((leg: any) => ({
      distanceMeters: leg.distanceMeters || 0,
      durationSeconds: parseInt(String(leg.duration || '0').replace('s', '')) || 0,
    }))
    return NextResponse.json({ legs })
  } catch (e: any) {
    console.error('route-distance failed:', e?.message || e)
    return NextResponse.json({ legs: [] })
  }
}
