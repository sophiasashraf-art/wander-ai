import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'
import { FirecrawlAppV1 as FirecrawlApp } from 'firecrawl'
import { Client } from '@googlemaps/google-maps-services-js'

const openai = new OpenAI()
const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! })
const maps = new Client()

function platformLabel(url: string): string {
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
  if (host.includes('tiktok.com')) return 'TikTok'
  if (host.includes('instagram.com')) return 'Instagram'
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube'
  return host.replace('www.', '') || 'a link'
}

function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const matches = text.match(urlRegex) || []
  // Strip already-matched URLs before scanning for bare domains — otherwise this
  // regex also matches the tail of a URL already captured above (e.g. it'd pull
  // "tiktok.com/@user/video/123" back out of "https://www.tiktok.com/@user/video/123",
  // producing a mangled www.-less duplicate that TikTok's oEmbed endpoint rejects.
  const textWithoutUrls = text.replace(urlRegex, ' ')
  const bareUrlRegex = /(?<![\/\w])([\w-]+\.[\w-]+(?:\.[\w-]+)*\/[^\s]*)/g
  const bareMatches = textWithoutUrls.match(bareUrlRegex) || []
  const withProtocol = bareMatches.map(u => `https://${u}`)
  return [...new Set([...matches, ...withProtocol])]
}

// TikTok's video pages are almost entirely client-rendered, so a plain scrape
// (Firecrawl included) usually comes back empty or with no caption text. TikTok
// publishes a public oEmbed endpoint specifically for this — no login/JS needed,
// and its "title" field is the video caption, which is where place names live.
async function scrapeTikTokOembed(url: string): Promise<string> {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`)
    if (!res.ok) return ''
    const data = await res.json()
    if (!data.title) return ''
    return `TikTok by ${data.author_name || 'unknown'}: ${data.title}`
  } catch {
    return ''
  }
}

async function scrapeUrl(url: string): Promise<string> {
  if (url.includes('tiktok.com')) {
    const oembed = await scrapeTikTokOembed(url)
    if (oembed) return oembed
  }
  try {
    const result = await firecrawl.scrapeUrl(url, { formats: ['markdown'] }) as any
    if (result.markdown) return result.markdown.slice(0, 15000)
    if (result.content) return result.content.slice(0, 15000)
  } catch (e) {
    console.error('Scrape failed for', url)
  }
  return ''
}

async function enrichWithCoordinates(place: any): Promise<any> {
  try {
    const searchQuery = [place.name, place.city].filter(Boolean).join(' ')
    const response = await maps.findPlaceFromText({
      params: {
        input: searchQuery,
        inputtype: 'textquery' as any,
        fields: ['geometry', 'name', 'formatted_address', 'place_id'] as any,
        key: process.env.GOOGLE_PLACES_API_KEY!,
      }
    })
    const candidate = response.data.candidates?.[0]
    if (candidate?.geometry?.location) {
      return {
        ...place,
        lat: candidate.geometry.location.lat,
        lng: candidate.geometry.location.lng,
        neighborhood: candidate.formatted_address || null,
      }
    }
  } catch (e: any) {
    console.error('Google Places failed for', place.name, e?.response?.data || e?.message)
  }
  return place
}

// Shared entry point for the iOS "Save to Mapture" Shortcut: takes whatever text/link
// was shared, extracts places, and files each one into a per-city inbox trip —
// no destination or trip context required up front.
export async function POST(req: Request) {
  try {
    if (process.env.INBOX_SHARED_SECRET && req.headers.get('x-inbox-key') !== process.env.INBOX_SHARED_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { text } = await req.json()
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 })
    }

    const urls = extractUrls(text)
    let enrichedText = text

    if (urls.length > 0) {
      const scraped = await Promise.all(urls.map(scrapeUrl))
      const scrapedContent = urls
        .map((url, i) => scraped[i] ? `[Source: ${url}]\n${scraped[i]}` : '')
        .filter(Boolean)
        .join('\n\n')
      if (scrapedContent) {
        enrichedText = `${text}\n\nContent from links:\n${scrapedContent}`
      }
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a travel assistant. Extract all specific places, restaurants, cafes, activities, and locations from the user's travel inspiration. Always infer the city each place is in — this is required.

For each place, also capture:
- tip: practical advice mentioned in the content (e.g. "arrive before 10am, there's a line", "cash only"). Omit if none is mentioned — don't invent one.
- why_recommended: what makes it stand out per the content — vibe, standout dish, unique feature. Omit if the content gives no real reason.
- source_url: if the content is broken into "[Source: <url>]" blocks (from scraped links) and this place clearly came from one specific block, use that block's exact URL. If there's only one link total and no blocks, or you can't tell which link a place came from, omit this field — don't guess.

Category must be one of: restaurant | bar | activity | neighborhood | stay | cafe | other
- Use "bar" for cocktail bars, pubs, lounges, clubs, and nightlife venues — not "activity".

city: the actual trip-level city or town this place is in — the level someone would name as their travel destination (e.g. "San Diego", "Paris", "Tokyo"). NEVER put a neighborhood, district, borough, or area name here, even if that's the only location mentioned in the content — resolve it up to the real city it belongs to (e.g. "La Jolla" or "Coronado" → "San Diego"; "Shibuya" or "Shimokitazawa" → "Tokyo"; "Le Marais" → "Paris"). If a place's neighborhood is worth naming, put it in the description instead. Getting this wrong causes real damage downstream: places get filed into separate city inboxes instead of staying grouped as one destination.

Return valid JSON only, no markdown. Format: {"places": [{"name": "...", "category": "restaurant|bar|activity|neighborhood|stay|cafe|other", "city": "...", "description": "...", "tip": "...", "why_recommended": "...", "source_url": "..."}]}`,
      }, {
        role: 'user',
        content: enrichedText,
      }],
      response_format: { type: 'json_object' },
    })

    const result = JSON.parse(response.choices[0].message.content || '{"places":[]}')
    // Fallback for the common case of a single shared link with no per-place
    // attribution from GPT — everything obviously came from that one source.
    const singleUrl = urls.length === 1 ? urls[0] : undefined
    if (singleUrl) {
      result.places = (result.places || []).map((p: any) => ({ ...p, source_url: p.source_url || singleUrl }))
    }

    // A link that scraped fine but named no identifiable place (e.g. a TikTok whose
    // caption is just emoji) would otherwise vanish with no feedback. Keep the link
    // itself as a placeholder save rather than silently dropping it.
    if ((result.places || []).length === 0 && singleUrl) {
      result.places = [{
        name: `Saved from ${platformLabel(singleUrl)}`,
        category: 'other',
        description: "Mapture couldn't identify a specific place in this link — open it to see what it was, or edit the name yourself.",
        source_url: singleUrl,
      }]
    }

    const enrichedPlaces = await Promise.all(
      (result.places || []).map((p: any) => enrichWithCoordinates(p))
    )

    if (enrichedPlaces.length === 0) {
      return NextResponse.json({ added: [] })
    }

    // Group by city so each location gets its own inbox bucket
    const byCity = new Map<string, any[]>()
    for (const p of enrichedPlaces) {
      const city = (p.city || 'Unsorted').trim()
      if (!byCity.has(city)) byCity.set(city, [])
      byCity.get(city)!.push(p)
    }

    const results: { city: string; added: number }[] = []

    for (const [city, cityPlaces] of byCity) {
      let { data: trip } = await supabase
        .from('trips')
        .select('id')
        .eq('is_inbox', true)
        .ilike('destination', city)
        .maybeSingle()

      if (!trip) {
        const { data: newTrip, error: tripError } = await supabase
          .from('trips')
          .insert({ destination: city, duration: '0 days', vibe: 'balanced', is_inbox: true, saved: false })
          .select()
          .single()
        if (tripError || !newTrip) {
          console.error('Failed to create inbox trip for', city, tripError)
          continue
        }
        trip = newTrip
      }

      const { data: existing } = await supabase
        .from('places')
        .select('name')
        .eq('trip_id', trip!.id)
      const existingNames = new Set((existing || []).map((p: any) => p.name.toLowerCase().trim()))

      const newPlaces = cityPlaces.filter((p: any) => !existingNames.has(p.name.toLowerCase().trim()))

      if (newPlaces.length > 0) {
        const { error: insertError } = await supabase.from('places').insert(
          newPlaces.map((p: any) => ({ ...p, trip_id: trip!.id }))
        )
        if (insertError) console.error('places insert failed:', insertError)
      }

      results.push({ city, added: newPlaces.length })
    }

    return NextResponse.json({ added: results })
  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
