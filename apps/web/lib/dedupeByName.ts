// The same real place can legitimately exist as separate `places` rows on
// separate trips — e.g. "Parc Monceau" saved independently to two different
// Paris trip plans. That's correct per-trip data (deleting one could break
// an itinerary stop on the other trip), but the city-aggregate views
// (Maptured, Saves) roll multiple trips for the same city into one list,
// which surfaces that legitimate per-trip duplication as what looks like a
// bug. Dedupe at the display layer only — never the underlying rows.
export function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const byName = new Map<string, T>()
  for (const item of items) {
    const key = item.name.trim().toLowerCase()
    if (!byName.has(key)) byName.set(key, item)
  }
  return [...byName.values()]
}

// Same idea, but for already-rated places: when two rows for the same place
// exist, keep whichever one the user actually engaged with (has a rating or
// note) rather than an arbitrary pick.
export function dedupeRatedByName<T extends { name: string; visited_rating: number | null; visited_note: string | null }>(
  items: T[],
): T[] {
  const byName = new Map<string, T>()
  for (const item of items) {
    const key = item.name.trim().toLowerCase()
    const existing = byName.get(key)
    if (!existing) { byName.set(key, item); continue }
    const score = (i: T) => (i.visited_rating != null ? 2 : 0) + (i.visited_note ? 1 : 0)
    if (score(item) > score(existing)) byName.set(key, item)
  }
  return [...byName.values()]
}
