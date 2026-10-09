import { NextResponse } from 'next/server'

interface LatLng { lat: number; lng: number }

// Past this, walking stops being realistic for most people — switch to
// driving instead. 20 minutes is a commonly used rule of thumb for "people
// still choose to walk this" in transit/UX literature; not configurable per
// user yet, but a single constant here if that ever needs to change.
const MAX_WALK_SECONDS = 20 * 60

async function computeRoute(stops: LatLng[], travelMode: 'WALK' | 'DRIVE') {
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
      travelMode,
    }),
  })

  if (!res.ok) {
    console.error(`route-distance: Routes API (${travelMode}) returned`, res.status, await res.text().catch(() => ''))
    return null
  }

  const data = await res.json()
  return (data.routes?.[0]?.legs || []).map((leg: any) => ({
    distanceMeters: leg.distanceMeters || 0,
    durationSeconds: parseInt(String(leg.duration || '0').replace('s', '')) || 0,
  }))
}

// One computeRoutes call per mode per day (origin + intermediates +
// destination) returns a per-leg breakdown directly — cheaper than N-1
// separate calls per mode for N stops. Both modes are fetched for every leg
// (not just the ones that look long) so the walk-vs-drive decision is based
// on the real route, not a straight-line guess that could be wrong around
// water, parks, or one-way streets.
export async function POST(req: Request) {
  try {
    const { stops } = await req.json() as { stops: LatLng[] }
    if (!Array.isArray(stops) || stops.length < 2) {
      return NextResponse.json({ legs: [] })
    }

    const [walkLegs, driveLegs] = await Promise.all([
      computeRoute(stops, 'WALK'),
      computeRoute(stops, 'DRIVE'),
    ])

    const count = Math.max(walkLegs?.length || 0, driveLegs?.length || 0)
    const legs = Array.from({ length: count }, (_, i) => {
      const walk = walkLegs?.[i]
      const drive = driveLegs?.[i]
      if (walk && walk.durationSeconds <= MAX_WALK_SECONDS) {
        return { ...walk, mode: 'walk' as const }
      }
      if (drive) return { ...drive, mode: 'drive' as const }
      if (walk) return { ...walk, mode: 'walk' as const }
      return null
    }).filter(Boolean)

    return NextResponse.json({ legs })
  } catch (e: any) {
    console.error('route-distance failed:', e?.message || e)
    return NextResponse.json({ legs: [] })
  }
}
