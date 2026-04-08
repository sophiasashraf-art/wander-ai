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
  const bareUrlRegex = /(?<![\/\w])([\w-]+\.[\w-]+(?:\.[\w-]+)*\/[^\s]*)/g
  const bareMatches = text.match(bareUrlRegex) || []
  const withProtocol = bareMatches.map(u => `https://${u}`)
  return [...new Set([...matches, ...withProtocol])]
}

async function scrapeUrl(url: string): Promise<string> {
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
    const response = await maps.findPlaceFromText({
      params: {
        input: `${place.name} ${place.city}`,
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
      const scrapedContent = scraped.filter(Boolean).join('\n\n')
      if (scrapedContent) {
        enrichedText = `${text}\n\nContent from links:\n${scrapedContent}`
      }
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: 'You are a travel assistant. Extract all specific places, restaurants, cafes, activities, and locations from the user\'s travel inspiration. Return valid JSON only, no markdown. Format: {"places": [{"name": "...", "category": "restaurant|activity|neighborhood|stay|cafe|other", "city": "...", "description": "..."}]}',
      }, {
        role: 'user',
        content: enrichedText,
      }],
      response_format: { type: 'json_object' },
    })

    const result = JSON.parse(response.choices[0].message.content || '{"places":[]}')

    // Enrich all places with real coordinates from Google Places
    const enrichedPlaces = await Promise.all(
      result.places.map((p: any) => enrichWithCoordinates(p))
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
    console.log('insertError:', insertError)
  }
}

    return NextResponse.json({ places: enrichedPlaces })

  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}