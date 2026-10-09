import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { extractUrls, scrapeUrl, verifyPlace, upsertPlace, platformLabel, isTranscribableLink } from '../../../lib/placeIngestion'

const openai = new OpenAI()

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
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

city: the actual trip-level city or town this place is in — the level someone would name as their travel destination (e.g. "San Diego", "Paris", "Tokyo"). NEVER put a neighborhood, district, borough, or area name here, even if that's the only location mentioned in the content — resolve it up to the real city it belongs to (e.g. "La Jolla" or "Coronado" → "San Diego"; "Shibuya" or "Shimokitazawa" → "Tokyo"; "Le Marais" → "Paris"). If a place's neighborhood is worth naming, put it in the description instead. Getting this wrong causes real damage downstream: places get incorrectly split into a multi-city trip instead of staying grouped as one destination.

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

    // A TikTok/Instagram link GPT found nothing in is worth a real transcript —
    // captions are frequently long (hashtags, generic blurb) but name zero actual
    // places, which is exactly the case a scrape-length heuristic can't catch;
    // this checks the real thing, what GPT actually got out of it. Transcription
    // takes 30+ seconds though, too slow for this request — hand off to a
    // background job instead, and only when there's a real trip to attach the
    // result to later (not a guest's local-only session).
    const yieldedUrls = new Set(result.places.map((p: any) => p.source_url).filter(Boolean))
    const emptyTranscribableUrls = urls.filter(url => isTranscribableLink(url) && !yieldedUrls.has(url))
    const { data: { user } } = await supabase.auth.getUser()
    const placeholders: any[] = []

    if (emptyTranscribableUrls.length > 0 && user && tripId) {
      const inserted = await Promise.all(emptyTranscribableUrls.map(async url => {
        const { data } = await supabase.from('places').insert({
          trip_id: tripId,
          name: `Fetching ${platformLabel(url)} content…`,
          category: 'other',
          source_url: url,
          source: 'pasted_text',
          processing: true,
        }).select().single()
        return data
      }))
      placeholders.push(...inserted.filter(Boolean))

      // Just confirming Netlify accepted the invocation (202), not waiting for
      // it to finish. Signed with a shared secret since this background
      // function runs with the service-role key (bypasses RLS) and has no
      // other way to verify the request came from us and not an arbitrary
      // caller who found the URL.
      await Promise.all(placeholders.map(p =>
        fetch(`${new URL(req.url).origin}/bg/transcribe-place`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.BACKGROUND_FUNCTION_SECRET! },
          body: JSON.stringify({ placeholderId: p.id, tripId, url: p.source_url }),
        }).catch(e => console.error('Failed to trigger transcribe-place background job:', e))
      ))
    }

    // A link that named no place and isn't covered by a transcribing placeholder
    // above (guest, no trip yet, or not TikTok/Instagram) would otherwise vanish
    // with no feedback. Keep the link itself as a placeholder save instead.
    if (result.places.length === 0 && singleUrl && !placeholders.some(p => p.source_url === singleUrl)) {
      result.places = [{
        name: `Saved from ${platformLabel(singleUrl)}`,
        category: 'other',
        description: "Mapture couldn't identify a specific place in this link — open it to see what it was, or edit the name yourself.",
        source_url: singleUrl,
      }]
    }

    // Get destination from the trip if available, for Places search context
    let destination = ''
    if (tripId) {
      const { data: trip } = await supabase.from('trips').select('destination').eq('id', tripId).single()
      destination = trip?.destination || ''
    }

    const rawInput = text.slice(0, 2000)

    const enrichedPlaces = await Promise.all(
      result.places.map(async (p: any) => {
        const verified = await verifyPlace(p.name, destination)
        if (!tripId) {
          // No trip yet to persist against — just return the enriched shape.
          return {
            ...p,
            lat: verified?.lat ?? null,
            lng: verified?.lng ?? null,
            neighborhood: verified?.formatted_address ?? null,
            rating: verified?.rating ?? null,
            price_level: verified?.price_level ?? null,
            opening_hours: verified?.opening_hours ?? null,
            photo_reference: verified?.photo_reference ?? null,
          }
        }
        const { place } = await upsertPlace({
          trip_id: tripId,
          name: p.name,
          category: p.category,
          city: p.city,
          description: p.description,
          tip: p.tip,
          why_recommended: p.why_recommended,
          source_url: p.source_url,
          raw_input: rawInput,
          source: 'pasted_text',
        }, verified, supabase)
        return place
      })
    )

    // upsertPlace can come back with place: null (e.g. an insert RLS silently
    // rejected — a stale/expired session with a stale tripId still in hand)
    // rather than throwing, so this isn't caught by the outer try/catch either.
    const validPlaces = enrichedPlaces.filter(Boolean)
    console.log('enriched places:', validPlaces.map((p: any) => `${p.name}: ${p.lat},${p.lng}`))

    // Placeholders are already real rows (inserted above) — include them so the
    // client shows "fetching…" right away instead of waiting on a realtime event.
    return NextResponse.json({ places: [...validPlaces, ...placeholders] })

  } catch (e: any) {
    console.error('ERROR:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
