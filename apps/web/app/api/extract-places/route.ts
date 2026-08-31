import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'
import { FirecrawlAppV1 as FirecrawlApp } from 'firecrawl'
import { Client } from '@googlemaps/google-maps-services-js'

const openai = new OpenAI()
const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! })
const maps = new Client()

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

async function enrichWithCoordinates(place: any, destination?: string): Promise<any> {
  try {
    const searchQuery = [place.name, place.city, destination].filter(Boolean).join(' ')
    const response = await maps.findPlaceFromText({
      params: {
        input: searchQuery,
        inputtype: 'textquery' as any,
        fields: ['geometry', 'name', 'formatted_address', 'place_id'] as any,        key: process.env.GOOGLE_PLACES_API_KEY!,
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

export async function POST(req: Request) {
  try {
    const { text, tripId } = await req.json()

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
        content: `You are a travel assistant. Extract all specific places, restaurants, cafes, activities, and locations from the user's travel inspiration.

For each place, also capture the context around why it was saved — this is important, don't skip it:
- tip: practical advice mentioned in the content (e.g. "arrive before 10am, there's a line", "cash only", "book ahead"). Omit if none is mentioned.
- why_recommended: what makes it stand out per the content — vibe, standout dish, unique feature (e.g. "unique cocktails, intimate setting", "best matcha in the city"). Omit if the content gives no real reason.
- source_url: if the content is broken into "[Source: <url>]" blocks (from scraped links) and this place clearly came from one specific block, use that block's exact URL. If there's only one link total and no blocks, or you can't tell which link a place came from, omit this field — don't guess.

Don't invent tips, reasons, or source URLs that aren't supported by the content — omit the field rather than guess.

Category must be one of: restaurant | bar | activity | neighborhood | stay | cafe | other
- Use "bar" for cocktail bars, pubs, lounges, clubs, and nightlife venues — not "activity".

Return valid JSON only, no markdown. Format: {"places": [{"name": "...", "category": "restaurant|bar|activity|neighborhood|stay|cafe|other", "city": "...", "description": "...", "tip": "...", "why_recommended": "...", "source_url": "..."}]}`,
      }, {
        role: 'user',
        content: enrichedText,
      }],
      response_format: { type: 'json_object' },
    })

    const result = JSON.parse(response.choices[0].message.content || '{"places":[]}')
    // Fallback for the common case of a single pasted link with no per-place
    // attribution from GPT — everything obviously came from that one source.
    const singleUrl = urls.length === 1 ? urls[0] : undefined
    if (singleUrl) {
      result.places = result.places.map((p: any) => ({ ...p, source_url: p.source_url || singleUrl }))
    }

    // Enrich all places with real coordinates from Google Places
    // Get destination from the trip if available
    let destination = ''
    if (tripId) {
      const { data: trip } = await supabase.from('trips').select('destination').eq('id', tripId).single()
      destination = trip?.destination || ''
    }

    const enrichedPlaces = await Promise.all(
      result.places.map((p: any) => enrichWithCoordinates(p, destination))
    )

    console.log('enriched places:', enrichedPlaces.map((p: any) => `${p.name}: ${p.lat},${p.lng}`))

if (tripId && enrichedPlaces.length > 0) {
  // Fetch existing place names for this trip
  const { data: existing } = await supabase
    .from('places')
    .select('name')
    .eq('trip_id', tripId)

  const existingNames = new Set(
    (existing || []).map((p: any) => p.name.toLowerCase().trim())
  )

  // Only insert places that don't already exist
  const newPlaces = enrichedPlaces.filter(
    (p: any) => !existingNames.has(p.name.toLowerCase().trim())
  )

  console.log(`Skipping ${enrichedPlaces.length - newPlaces.length} duplicates, inserting ${newPlaces.length} new places`)

  if (newPlaces.length > 0) {
    const { error: insertError } = await supabase.from('places').insert(
      newPlaces.map((p: any) => ({ ...p, trip_id: tripId }))
    )
    if (insertError) console.error('places insert failed:', insertError)
  }
}

    return NextResponse.json({ places: enrichedPlaces })

  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}