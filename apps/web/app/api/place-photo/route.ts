import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ref = searchParams.get('ref')
  if (!ref) return NextResponse.json({ error: 'missing ref' }, { status: 400 })

  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${encodeURIComponent(ref)}&key=${process.env.GOOGLE_PLACES_API_KEY}`

  try {
    const res = await fetch(url)
    if (!res.ok) return NextResponse.json({ error: 'photo fetch failed' }, { status: 502 })
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const buffer = await res.arrayBuffer()
    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
