import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ref = searchParams.get('ref')
  if (!ref) return NextResponse.json({ error: 'missing ref' }, { status: 400 })

  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    console.error('[place-photo] GOOGLE_PLACES_API_KEY is not set')
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${encodeURIComponent(ref)}&key=${apiKey}`
  console.log('[place-photo] fetching photo, ref length:', ref.length)

  try {
    const res = await fetch(url)
    console.log('[place-photo] Google response status:', res.status, res.statusText)
    if (!res.ok) {
      const body = await res.text()
      console.error('[place-photo] Google error body:', body.slice(0, 300))
      return NextResponse.json({ error: 'photo fetch failed', status: res.status }, { status: 502 })
    }
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const buffer = await res.arrayBuffer()
    console.log('[place-photo] success, contentType:', contentType, 'bytes:', buffer.byteLength)
    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=0',
        'Vary': 'Accept',
      },
    })
  } catch (e: any) {
    console.error('[place-photo] error:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
