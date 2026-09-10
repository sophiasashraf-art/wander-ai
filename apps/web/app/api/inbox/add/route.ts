import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'
import { extractUrls, scrapeUrl, verifyPlace, upsertPlace, platformLabel } from '../../../../lib/placeIngestion'

const openai = new OpenAI()

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

    const places = result.places || []
    if (places.length === 0) {
      return NextResponse.json({ added: [] })
    }

    const rawInput = text.slice(0, 2000)
    const verifiedPlaces = await Promise.all(
      places.map(async (p: any) => ({ ...p, _verified: await verifyPlace(p.name, p.city) }))
    )

    // Group by city so each location gets its own inbox bucket
    const byCity = new Map<string, any[]>()
    for (const p of verifiedPlaces) {
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

      const upserted = await Promise.all(
        cityPlaces.map((p: any) => upsertPlace({
          trip_id: trip!.id,
          name: p.name,
          category: p.category,
          city: p.city,
          description: p.description,
          tip: p.tip,
          why_recommended: p.why_recommended,
          source_url: p.source_url,
          raw_input: rawInput,
          source: 'pasted_text',
        }, p._verified))
      )

      results.push({ city, added: upserted.filter(r => !r.deduped).length })
    }

    return NextResponse.json({ added: results })
  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
