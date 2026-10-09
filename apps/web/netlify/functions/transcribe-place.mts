import OpenAI from 'openai'
import { createAdminClient } from '../../lib/supabase/admin'
import { transcribeViaApify, verifyPlace, buildFullFieldSet, upsertPlace, platformLabel } from '../../lib/placeIngestion'

// Runs out of band after extract-places (or inbox/add) inserts a "Fetching…"
// placeholder row for a TikTok/Instagram link whose caption/scrape came back
// too thin. Transcription alone took 37.7s on a 19s test clip — well past
// Netlify's 26s synchronous ceiling — which is why this exists as a real
// Netlify Background Function (up to 15 min) instead of running inline.
// Service-role client: this runs detached from the original request, no
// browser session/cookies to carry RLS — the caller already verified the
// placeholder's trip belongs to a real signed-in user before triggering this.
export default async (req: Request) => {
  // Runs with the service-role key (bypasses RLS) and has no browser session
  // to check, so this shared secret is the only thing standing between this
  // URL and anyone being able to overwrite any place in any trip.
  const secret = process.env.BACKGROUND_FUNCTION_SECRET
  if (!secret || req.headers.get('x-internal-secret') !== secret) return

  const { placeholderId, tripId, url } = await req.json()
  if (!placeholderId || !tripId || !url) return

  const supabase = createAdminClient()
  const openai = new OpenAI()

  // Only ever touch the specific row extract-places just created for this job
  // — never an arbitrary/already-completed place, even if this were replayed.
  const { data: placeholder } = await supabase
    .from('places')
    .select('id')
    .eq('id', placeholderId)
    .eq('trip_id', tripId)
    .eq('processing', true)
    .maybeSingle()
  if (!placeholder) return

  try {
    const transcript = await transcribeViaApify(url)

    if (!transcript) {
      await supabase.from('places').update({
        name: `Saved from ${platformLabel(url)}`,
        description: "Mapture couldn't get a transcript for this link — open it to see what it was, or edit the name yourself.",
        processing: false,
      }).eq('id', placeholderId)
      return
    }

    const { data: trip } = await supabase.from('trips').select('destination').eq('id', tripId).single()
    const destination = trip?.destination || ''

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a travel assistant. Extract all specific places, restaurants, cafes, activities, and locations mentioned in this video transcript.

For each place, also capture:
- tip: practical advice mentioned (e.g. "arrive before 10am, there's a line", "cash only"). Omit if none is mentioned — don't invent one.
- why_recommended: what makes it stand out per the transcript — vibe, standout dish, unique feature. Omit if the transcript gives no real reason.

Category must be one of: restaurant | bar | activity | neighborhood | stay | cafe | other
- Use "bar" for cocktail bars, pubs, lounges, clubs, and nightlife venues — not "activity".

city: the actual trip-level city or town this place is in — the level someone would name as their travel destination (e.g. "San Diego", "Paris", "Tokyo"). NEVER put a neighborhood, district, borough, or area name here — resolve it up to the real city it belongs to. If a place's neighborhood is worth naming, put it in the description instead.

Return valid JSON only, no markdown. Format: {"places": [{"name": "...", "category": "restaurant|bar|activity|neighborhood|stay|cafe|other", "city": "...", "description": "...", "tip": "...", "why_recommended": "..."}]}`,
      }, {
        role: 'user',
        content: transcript,
      }],
      response_format: { type: 'json_object' },
    })

    const result = JSON.parse(response.choices[0].message.content || '{"places":[]}')
    const places = result.places || []

    if (places.length === 0) {
      await supabase.from('places').update({
        name: `Saved from ${platformLabel(url)}`,
        description: "Mapture couldn't identify a specific place in this link — open it to see what it was, or edit the name yourself.",
        processing: false,
      }).eq('id', placeholderId)
      return
    }

    const rawInput = transcript.slice(0, 2000)
    const [first, ...rest] = places

    const verifiedFirst = await verifyPlace(first.name, destination)
    await supabase.from('places').update({
      ...buildFullFieldSet({
        trip_id: tripId,
        name: first.name,
        category: first.category,
        city: first.city,
        description: first.description,
        tip: first.tip,
        why_recommended: first.why_recommended,
        source_url: url,
        raw_input: rawInput,
        source: 'pasted_text',
      }, verifiedFirst),
      processing: false,
    }).eq('id', placeholderId)

    // Rare (one video, multiple distinct places) — file the rest as new rows.
    await Promise.all(rest.map(async (p: any) => {
      const verified = await verifyPlace(p.name, destination)
      await upsertPlace({
        trip_id: tripId,
        name: p.name,
        category: p.category,
        city: p.city,
        description: p.description,
        tip: p.tip,
        why_recommended: p.why_recommended,
        source_url: url,
        raw_input: rawInput,
        source: 'pasted_text',
      }, verified, supabase)
    }))
  } catch (e) {
    console.error('transcribe-place failed for', url, e)
    await supabase.from('places').update({
      name: `Saved from ${platformLabel(url)}`,
      description: "Something went wrong processing this link — open it to see what it was, or edit the name yourself.",
      processing: false,
    }).eq('id', placeholderId)
  }
}

export const config = {
  background: true,
  path: '/bg/transcribe-place',
}
