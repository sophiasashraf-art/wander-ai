# Bugfix Requirements Document

## Introduction

When a user generates an itinerary from places extracted via the URL-scraping path (`extract-places`), two related bugs cause the output to be unusable:

1. **All places land on Day 1** — places are not distributed across the trip duration.
2. **Geolocation is broken for the URL path** — places extracted from URLs are saved to Supabase without `lat`/`lng` coordinates, which cascades into the distribution logic failing silently.

The root cause is a missing geocoding step in `extract-places/route.ts` combined with a round-robin distribution bug in `generate-itinerary/route.ts`. The `import-itinerary` path (text/paste) correctly geocodes places via Google Maps, but the `extract-places` path (URL scraping) does not call `enrichWithCoordinates` before saving to Supabase. Without coordinates, the geographic spread detection in `generate-itinerary` always evaluates to `false`, and the round-robin fallback has a capacity bug that fills Day 1 before any other day gets stops.

The whole purpose of wander.ai is to produce an optimized itinerary spread across multiple days, so this bug renders the core feature non-functional for the URL input path.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user submits a URL as input and `extract-places` scrapes and saves places to Supabase THEN the system saves those places without `lat` or `lng` values

1.2 WHEN `generate-itinerary` reads places from Supabase and none have `lat`/`lng` THEN the system falls back to the ungeocoded `places` array and computes `lngSpread = 0` and `latSpread = 0`

1.3 WHEN `lngSpread` and `latSpread` are both 0 THEN the system sets `isSpread = false` and enters the round-robin branch regardless of the actual geographic spread of the destination

1.4 WHEN the round-robin interleaving loop runs and `config.stopsPerDay` is reached for `buckets[0]` THEN the system stops adding places to later days because the `stopsPerDay` cap is hit on Day 1 before other days receive any places

1.5 WHEN the final day buckets are built with all places in `buckets[0]` THEN the system generates an itinerary where Day 1 contains all stops and Days 2–N are empty or filled only with GPT suggestions

### Expected Behavior (Correct)

2.1 WHEN a user submits a URL as input and `extract-places` scrapes places THEN the system SHALL geocode each place via Google Maps before saving to Supabase, storing valid `lat` and `lng` values

2.2 WHEN `generate-itinerary` reads places from Supabase and geocoded places are available THEN the system SHALL use those coordinates to correctly compute `lngSpread` and `latSpread`

2.3 WHEN `lngSpread` or `latSpread` exceeds the spread threshold THEN the system SHALL use geographic block assignment to distribute places across days

2.4 WHEN the round-robin distribution runs for a same-city trip THEN the system SHALL distribute places evenly across all `numDays` days such that no single day receives more than `config.stopsPerDay` stops while other days remain empty

2.5 WHEN the final day buckets are built THEN the system SHALL produce a distribution where each day receives approximately `config.stopsPerDay` stops (or as many as available), spread across all `numDays` days

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user submits plain text (no URLs) via the `import-itinerary` path THEN the system SHALL CONTINUE TO geocode places and generate a correctly distributed itinerary

3.2 WHEN a user submits text that already contains structured day-by-day content THEN the system SHALL CONTINUE TO preserve the user's day assignments and times

3.3 WHEN places are already geocoded and stored in Supabase with valid `lat`/`lng` THEN the system SHALL CONTINUE TO use geographic spread detection to assign places to days

3.4 WHEN a trip has fewer total places than `config.stopsPerDay * numDays` THEN the system SHALL CONTINUE TO fill thin days with GPT-suggested places marked `suggested: true`

3.5 WHEN a user manually adds stops via the `ItineraryEditor` drag-and-drop interface THEN the system SHALL CONTINUE TO preserve those stops and their day assignments when regenerating

3.6 WHEN the `vibe` setting is `relaxed`, `balanced`, or `everything` THEN the system SHALL CONTINUE TO apply the correct `stopsPerDay` cap (3, 4, or 6 respectively) during distribution

---

## Bug Condition Pseudocode

**Bug Condition Function** — identifies inputs that trigger the distribution bug:

```pascal
FUNCTION isBugCondition(input, places)
  INPUT: input of type TripInput, places of type Place[]
  OUTPUT: boolean

  // Bug is triggered when places reach generate-itinerary without coordinates
  RETURN (input.hasUrls = true AND places.every(p => p.lat = NULL AND p.lng = NULL))
      OR (places.length > 0 AND places.every(p => p.lat = NULL AND p.lng = NULL))
END FUNCTION
```

**Property: Fix Checking** — correct behavior for buggy inputs:

```pascal
// Property: Fix Checking — geocoding and distribution
FOR ALL input WHERE isBugCondition(input, places) DO
  result ← generateItinerary'(input)
  ASSERT result.days.length = numDays
  ASSERT FOR ALL day IN result.days: day.stops.length >= 1
  ASSERT SUM(day.stops.length FOR day IN result.days) = MIN(places.length, stopsPerDay * numDays)
END FOR
```

**Property: Preservation Checking** — non-buggy inputs are unaffected:

```pascal
// Property: Preservation Checking
FOR ALL input WHERE NOT isBugCondition(input, places) DO
  ASSERT generateItinerary(input) = generateItinerary'(input)
END FOR
```
