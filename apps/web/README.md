# wander.ai

AI-powered travel itinerary builder. Paste inspiration (links, notes, restaurant names) and get a day-by-day itinerary with a map.

## Stack

- Next.js 16 (App Router)
- Supabase (trips + places storage)
- OpenAI GPT-4o-mini (place extraction + itinerary generation)
- Firecrawl (URL scraping)
- Google Maps / Places API (coordinates + map)
- @dnd-kit (drag and drop)
- Tailwind CSS v4

## Features

- AI extracts places from freeform text and URLs
- Generates a multi-day itinerary grouped by geography
- Interactive itinerary editor:
  - Drag to reorder stops within and across days
  - Click any time to edit it (supports formats like `9pm`, `14:00`, `9:30 AM`)
  - Times auto-recalculate on reorder
  - Inline "Add a place" per day
  - Unscheduled places can be added to any day via dropdown
  - Delete stops on hover

## Env vars

Create `apps/web/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
OPENAI_API_KEY=
FIRECRAWL_API_KEY=
GOOGLE_PLACES_API_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
```

## Dev

```bash
pnpm install
pnpm --filter web dev
```
