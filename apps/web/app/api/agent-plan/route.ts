import OpenAI from 'openai'
import {
  AGENT_TOOLS, executeAgentTool, toolTraceText, toolDoneText,
  type AgentContext, type FinalizeResult,
} from '../../../lib/agentTools'

const openai = new OpenAI()

const MAX_ITERS = 14

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { messages, destination, duration, vibe, arrivalTime, departureTime, cities, currentItinerary, savedPlaces } = body

  const stopsPerDay = vibe === 'relaxed' ? 3 : vibe === 'everything' ? 6 : 4
  const numDays = parseInt(duration) || 3

  let timeConstraints = ''
  if (arrivalTime) timeConstraints += `\n- Day 1: traveler arrives at ${arrivalTime} — don't schedule before this.`
  if (departureTime) timeConstraints += `\n- Day ${numDays}: traveler departs at ${departureTime} — don't schedule at or after this.`

  const cityList = cities?.length > 0 ? cities.map((c: any) => `${c.name} (${c.days} days)`).join(', then ') : ''
  const tripDescription = cityList
    ? `a multi-city trip: ${cityList} — ${numDays} days total`
    : `a trip to ${destination} for ${numDays} days`

  const cityRules = cities?.length > 0
    ? `\n- MULTI-CITY trip. Days for EVERY city, in order:\n${cities.map((c: any) => `  ${c.name}: ${c.days} day(s)`).join('\n')}\n- Assign sequentially (Tokyo=2, Kyoto=3 → Days 1-2 Tokyo, Days 3-5 Kyoto). Pass the right \`city\` to search_places. Title each day with its city.`
    : ''

  const hasExistingItinerary = currentItinerary?.days?.some((d: any) => d.stops?.length > 0)
  const hasSavedPlaces = !hasExistingItinerary && savedPlaces?.length > 0

  // Names the user already has (saved places or existing itinerary stops) + any
  // coords they carry. finalize uses this to set the `suggested` flag
  // deterministically and reuse coordinates instead of re-geocoding.
  const knownPlaces = new Map<string, { lat?: number; lng?: number }>()
  for (const p of (savedPlaces || [])) knownPlaces.set(String(p.name || '').trim().toLowerCase(), { lat: p.lat, lng: p.lng })
  for (const d of (currentItinerary?.days || [])) {
    for (const s of (d.stops || [])) knownPlaces.set(String(s.name || '').trim().toLowerCase(), { lat: s.lat, lng: s.lng })
  }

  const ctx: AgentContext = {
    destination: cityList ? cities.map((c: any) => c.name).join(', ') : destination,
    knownPlaces,
  }

  const editPrompt = `You are a friendly travel planner adjusting an EXISTING itinerary for ${tripDescription} (${stopsPerDay} stops/day, ${vibe} pace).${timeConstraints}

Current itinerary (real, already-planned):
${JSON.stringify((currentItinerary?.days || []).map((d: any) => ({ day: d.day, title: d.title, stops: d.stops.map((s: any) => ({ name: s.name, time: s.time, category: s.category, note: s.note })) })), null, 2)}

Apply ONLY the change the user asks for ("swap day 2 and 3", "add a bar to day 1 evening", "make Shibuya its own day", "reorder day 1"). Do not invent an unrelated itinerary.

Reply with the FULL updated itinerary — every day, every stop, modified and unmodified — as a \`\`\`json block:
{"days":[{"day":1,"title":"Area","stops":[{"time":"9:00 AM","name":"Exact real name","category":"cafe|restaurant|bar|activity|museum|landmark|park|shopping|nightlife|other","note":"one sentence","suggested":false}]}]}

Rules:
- Keep every existing stop's name/time/category/note EXACTLY unless the request means it changes (moved, retimed, removed) or adds one.
- Every stop appears on exactly ONE day. To swap two days, exchange their whole stops arrays and titles — do not merge.
- New stops: real, well-known places, exact names, "suggested": true.
- ${numDays} days total.${cityRules}
- If the user is only asking a question (not requesting a change), answer conversationally and omit the JSON block entirely.

Before the JSON, write one sentence on what you changed.`

  const toolRules = `
You have tools — USE them, don't rely on memory:
- search_places: find real venues by keyword. Every place in the itinerary must come from a search_places result (exact name + lat/lng), unless it's an unmistakable landmark you're certain of.
- check_day_route: run once per day before finalizing. If a warning can't be fixed by a quick reorder (e.g. a beach really is on the edge of town), leave it and mention the travel in that stop's note — do NOT keep re-checking the same day. At most two rounds of route-checking total.
- raise_checkpoint: ONLY for a genuine either/or the user must decide (e.g. every saved place is a restaurant and they haven't said what else they want). NOT for "these are a bit far apart" — just make a sensible call and finalize. At most once per plan.
- finalize_itinerary: call this as soon as you have a workable plan. A good-enough itinerary now beats a perfect one you never submit. You MUST call it — never end without it.

Work efficiently: do several searches in ONE message (multiple tool calls at once), then check routes, then finalize — aim to finish in 3-4 rounds.
Do NOT put a JSON itinerary — or a plain-text list of places — in your reply. Places only travel through finalize_itinerary. If you have places, you are building: call the tools.
A short phrase like "foodie trip" or "chill beaches and sunset spots" IS a request to build — treat it as the vibe and build the full itinerary. Only reply in plain text (no tools) if the user asks an actual question.

Rules:
- Real, well-known places only, exact names.
- Times by category: cafe/breakfast 8-10am, brunch 10am-12pm, park/market 10am-12pm, lunch 12-2pm, museum/landmark 2-5pm, dinner 7-9pm, bar 9pm+.
- Group nearby places on the same day.
- Each day spans the day: a morning stop (before noon), midday, afternoon, evening. Don't leave a day starting after 12pm.
- Every stop appears on exactly ONE day.
- ${numDays} days, ~${stopsPerDay} stops/day.${timeConstraints}${cityRules}`

  const systemPrompt = hasSavedPlaces
    ? `You are a friendly, knowledgeable travel planner building ${tripDescription} (${stopsPerDay} stops/day, ${vibe} pace).

The user already saved these real places — the raw material; use all of them unless one clearly doesn't fit (say so if you drop one):
${JSON.stringify((savedPlaces || []).map((p: any) => ({ name: p.name, category: p.category, note: p.description || p.note, city: p.city })), null, 2)}

Organize them into a realistic day-by-day plan grouped by proximity. Fill real gaps (no dinner among their saves, too few stops) with search_places results. The finalize step decides the "suggested" flag — just include every stop.
${toolRules}`
    : `You are a friendly, knowledgeable travel planner helping plan ${tripDescription} (${stopsPerDay} stops/day, ${vibe} pace).

If you need to narrow things down before building (their interests, or which part of town), use raise_checkpoint with 2-3 options rather than asking in plain text. If the user already gave enough or said "just plan it", build the full itinerary.
${toolRules}`

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (evt: any) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(evt) + '\n')) } catch {}
      }
      try {
        // ── Edit path: one well-instructed call, no discovery ──
        if (hasExistingItinerary) {
          emit({ type: 'phase', text: 'Applying your change' })
          const res = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: editPrompt }, ...(messages || [])],
          })
          const reply = res.choices[0].message.content || ''
          const jsonMatch = reply.match(/```json\s*([\s\S]*?)```/)
          const prose = reply.replace(/```json\s*[\s\S]*?```/g, '').trim()
          if (!jsonMatch) {
            emit({ type: 'done', reply: prose || reply, itinerary: null, places: [] })
            return
          }
          let days: any[] = []
          try {
            const clean = jsonMatch[1].replace(/,\s*([}\]])/g, '$1').replace(/\/\/.*$/gm, '')
            days = JSON.parse(clean).days || []
          } catch (e) {
            console.error('agent-plan edit: bad JSON', e)
            emit({ type: 'done', reply: prose || 'I could not apply that change — try rephrasing?', itinerary: null, places: [] })
            return
          }
          const finalized = await executeAgentTool('finalize_itinerary', { summary: prose, days }, ctx) as FinalizeResult
          emit({ type: 'done', reply: prose || 'Updated your itinerary.', itinerary: { days: finalized.days }, places: finalized.places })
          return
        }

        // ── Build path: agentic tool-use loop ──
        emit({ type: 'phase', text: 'Planning your trip' })
        const convo: any[] = [{ role: 'system', content: systemPrompt }, ...(messages || [])]
        let finalized: FinalizeResult | null = null
        let lastText = ''
        let toolCallCount = 0
        let nudges = 0

        for (let iter = 0; iter < MAX_ITERS && !finalized; iter++) {
          const res = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: convo,
            tools: AGENT_TOOLS,
            tool_choice: 'auto',
          })
          const msg = res.choices[0].message
          convo.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })
          if (msg.content) lastText = msg.content

          if (!msg.tool_calls?.length) {
            // A bare text turn early on usually means it listed places instead of
            // building. Nudge it once toward the tools before giving up.
            const looksLikeListing = /\d\.\s|[-*]\s|:\s*\n/.test(msg.content || '') || (msg.content || '').length > 200
            if (nudges < 2 && toolCallCount === 0 && looksLikeListing) {
              nudges++
              convo.push({ role: 'user', content: 'Build the itinerary now — call search_places, then check_day_route, then finalize_itinerary. Do not reply with a list of places in text.' })
              continue
            }
            emit({ type: 'done', reply: msg.content || '', itinerary: null, places: [] })
            return
          }

          let pendingCheckpoint: { question: string; options: any[]; tool_call_id: string } | null = null
          for (const call of msg.tool_calls) {
            if (call.type !== 'function') continue
            toolCallCount++
            let parsed: any = {}
            try { parsed = JSON.parse(call.function.arguments || '{}') } catch {}

            if (call.function.name === 'raise_checkpoint') {
              // Don't answer this one server-side — the client's choice becomes the
              // tool result on resume. Still record it so any sibling tool calls in
              // this same message get answered (OpenAI requires all to be).
              pendingCheckpoint = { question: parsed.question || '', options: parsed.options || [], tool_call_id: call.id }
              continue
            }

            emit({ type: 'tool', name: call.function.name, text: toolTraceText(call.function.name, parsed) })
            const result = await executeAgentTool(call.function.name, parsed, ctx)
            emit({ type: 'tool_done', name: call.function.name, text: toolDoneText(call.function.name, result) })

            if (call.function.name === 'finalize_itinerary' && (result as any)?.finalized) {
              finalized = result as FinalizeResult
              convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true }) })
            } else {
              convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) })
            }
          }

          if (pendingCheckpoint && !finalized) {
            console.log(`agent-plan: checkpoint raised after ${toolCallCount} tool calls`)
            emit({
              type: 'checkpoint',
              question: pendingCheckpoint.question,
              options: pendingCheckpoint.options,
              tool_call_id: pendingCheckpoint.tool_call_id,
              conversation: convo.slice(1), // drop the system message
            })
            return
          }
        }

        // Ran out of iterations without finalizing — force it to submit its best
        // draft rather than dead-ending on a non-answer.
        if (!finalized && toolCallCount > 0) {
          emit({ type: 'phase', text: 'Wrapping up' })
          try {
            const res = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [...convo, { role: 'user', content: 'Submit your best itinerary now with finalize_itinerary — do not search or check anything further.' }],
              tools: AGENT_TOOLS,
              tool_choice: { type: 'function', function: { name: 'finalize_itinerary' } },
            })
            const call = res.choices[0].message.tool_calls?.[0]
            if (call?.type === 'function') {
              let parsed: any = {}
              try { parsed = JSON.parse(call.function.arguments || '{}') } catch {}
              const result = await executeAgentTool('finalize_itinerary', parsed, ctx)
              if ((result as any)?.finalized) finalized = result as FinalizeResult
            }
          } catch (e) { console.error('forced finalize failed', e) }
        }

        console.log(`agent-plan: ${toolCallCount} tool calls, finalized=${!!finalized}`)
        if (!finalized) {
          emit({ type: 'done', reply: lastText || "I couldn't put a full plan together this time — try adding a bit more detail about the trip.", itinerary: null, places: [] })
          return
        }
        emit({ type: 'done', reply: finalized.summary, itinerary: { days: finalized.days }, places: finalized.places })
      } catch (e: any) {
        console.error('Agent error:', e)
        emit({ type: 'error', message: e?.message || 'Something went wrong.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}
