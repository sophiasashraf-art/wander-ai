import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { AGENT_TOOLS, executeAgentTool, type AgentContext, type FinalizeResult } from '../../../lib/agentTools'

const openai = new OpenAI()

const MAX_ITERS = 8

export async function POST(req: Request) {
  try {
    const { messages, destination, duration, vibe, arrivalTime, departureTime, cities, currentItinerary, savedPlaces } = await req.json()

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

    // ── Edit path: a precise structural change to an existing itinerary needs no
    // discovery, so one well-instructed call is more reliable than a tool loop. ──
    if (hasExistingItinerary) {
      const editPrompt = `You are a friendly travel planner adjusting an EXISTING itinerary for ${tripDescription} (${stopsPerDay} stops/day, ${vibe} pace).${timeConstraints}

Current itinerary (real, already-planned):
${JSON.stringify(currentItinerary.days.map((d: any) => ({ day: d.day, title: d.title, stops: d.stops.map((s: any) => ({ name: s.name, time: s.time, category: s.category, note: s.note })) })), null, 2)}

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

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: editPrompt }, ...(messages || [])],
      })
      const reply = res.choices[0].message.content || ''
      const jsonMatch = reply.match(/```json\s*([\s\S]*?)```/)
      const prose = reply.replace(/```json\s*[\s\S]*?```/g, '').trim()

      if (!jsonMatch) {
        return NextResponse.json({ reply: prose || reply, itinerary: null, places: [] })
      }
      let days: any[] = []
      try {
        const clean = jsonMatch[1].replace(/,\s*([}\]])/g, '$1').replace(/\/\/.*$/gm, '')
        days = JSON.parse(clean).days || []
      } catch (e) {
        console.error('agent-plan edit: bad JSON', e)
        return NextResponse.json({ reply: prose || 'I could not apply that change — try rephrasing?', itinerary: null, places: [] })
      }
      const finalized = await executeAgentTool('finalize_itinerary', { summary: prose, days }, ctx) as FinalizeResult
      return NextResponse.json({
        reply: prose || 'Updated your itinerary.',
        itinerary: { days: finalized.days },
        places: finalized.places,
      })
    }

    // ── Build path: agentic tool-use loop (discovery + route-checking pays off) ──
    const toolRules = `
You have tools — USE them, don't rely on memory:
- search_places: find real venues by keyword. Every place in the itinerary must come from a search_places result (exact name + lat/lng), unless it's an unmistakable landmark you're certain of.
- check_day_route: run on each day's stops (in visiting order, with coords + times) before finalizing. Fix backtracking / long-hop warnings by reordering or moving a stop to another day.
- finalize_itinerary: call once the plan is solid and every day passed check_day_route.

Do NOT put a JSON itinerary in your text — it only travels through finalize_itinerary.
If the user is just chatting or asking a question, answer normally and call no tools.

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
${JSON.stringify(savedPlaces.map((p: any) => ({ name: p.name, category: p.category, note: p.description || p.note, city: p.city })), null, 2)}

Organize them into a realistic day-by-day plan grouped by proximity. Fill real gaps (no dinner among their saves, too few stops) with search_places results. The finalize step decides the "suggested" flag — just include every stop.
${toolRules}`
      : `You are a friendly, knowledgeable travel planner helping plan ${tripDescription} (${stopsPerDay} stops/day, ${vibe} pace).

Chat naturally — ask a clarifying question if it helps (food, interests, pace, neighborhoods). When you have enough or the user says go ahead, build the full itinerary.
${toolRules}`

    const convo: any[] = [{ role: 'system', content: systemPrompt }, ...(messages || [])]
    let finalized: FinalizeResult | null = null
    let lastText = ''
    let toolCallCount = 0

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
        return NextResponse.json({ reply: msg.content || '', itinerary: null, places: [] })
      }

      for (const call of msg.tool_calls) {
        if (call.type !== 'function') continue
        toolCallCount++
        let parsed: any = {}
        try { parsed = JSON.parse(call.function.arguments || '{}') } catch {}
        const result = await executeAgentTool(call.function.name, parsed, ctx)
        if (call.function.name === 'finalize_itinerary' && (result as any)?.finalized) {
          finalized = result as FinalizeResult
          convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: true }) })
        } else {
          convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) })
        }
      }
    }

    console.log(`agent-plan: ${toolCallCount} tool calls, finalized=${!!finalized}`)

    if (!finalized) {
      return NextResponse.json({
        reply: lastText || "Tell me a bit more about what you're after and I'll put it together.",
        itinerary: null,
        places: [],
      })
    }

    return NextResponse.json({
      reply: finalized.summary,
      itinerary: { days: finalized.days },
      places: finalized.places,
    })
  } catch (e: any) {
    console.error('Agent error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
