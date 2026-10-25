// Beli-style 0-10 score bands, shared by the rating picker (PlaceReview) and
// the ranked leaderboard (Maptured) so a score always reads the same color
// everywhere. Bucket defaults are a starting point for phase 1 (tap a
// sentiment, get a score) — a later pass can replace them with precise
// placement via head-to-head comparisons against already-rated places.
export const RATING_BUCKETS = [
  { label: 'Not for me', score: 5.5, color: '#D14343' },
  { label: 'It was fine', score: 7.7, color: '#D99323' },
  { label: 'Loved it', score: 9.5, color: '#2F9E52' },
] as const

export function scoreColor(score: number): string {
  if (score >= 8.5) return '#2F9E52'
  if (score >= 7.0) return '#D99323'
  return '#D14343'
}

// A band color at low opacity, for a soft tinted fill behind a badge/pill
// instead of a flat white-on-color block — e.g. `background: scoreTint(8.7)`.
export function scoreTint(score: number): string {
  return `${scoreColor(score)}1A` // ~10% alpha (hex alpha suffix)
}

// Olympic-style podium accent for the top 3 ranks in a leaderboard — distinct
// from the red/yellow/green score bands so the two systems don't collide.
export function podiumColor(rank: number): string | null {
  if (rank === 1) return '#D4AF37'
  if (rank === 2) return '#A3A3A3'
  if (rank === 3) return '#B5724A'
  return null
}
