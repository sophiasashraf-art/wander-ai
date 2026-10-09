import { useState, useRef, useEffect } from 'react'

export interface RouteLeg { distanceMeters: number; durationSeconds: number }
interface StopLike { id: string; lat?: number; lng?: number }
interface DayLike { stops: StopLike[] }

// Walk time between consecutive stops, keyed by [dayIndex][stopId] = the leg
// from that stop to the next one. One computeRoutes call per day (not per
// pair) — see /api/route-distance. Fingerprinted on coordinates only (not
// times/notes/names) so editing a note doesn't re-trigger every day's fetch.
// Shared between ItineraryEditor (List view, both desktop and mobile) and
// page.tsx's mobile Map-view stop carousel — each calls this independently
// rather than prop-drilling a single fetch through both, which means an open
// trip can fire the per-day requests twice if both views are ever mounted at
// once; an acceptable tradeoff given the Routes API's free tier (10k/month).
export function useRouteLegs(days: DayLike[]): Record<number, Record<string, RouteLeg>> {
  const [legsByDay, setLegsByDay] = useState<Record<number, Record<string, RouteLeg>>>({})
  const fingerprintRef = useRef('')

  useEffect(() => {
    const fingerprint = days
      .map(d => d.stops.filter(s => s.lat && s.lng).map(s => `${s.id}:${s.lat?.toFixed(5)},${s.lng?.toFixed(5)}`).join(','))
      .join('|')
    if (fingerprint === fingerprintRef.current) return
    fingerprintRef.current = fingerprint

    days.forEach(async (day, dayIndex) => {
      const stopsWithCoords = day.stops.filter(s => s.lat && s.lng)
      if (stopsWithCoords.length < 2) return
      try {
        const res = await fetch('/api/route-distance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stops: stopsWithCoords.map(s => ({ lat: s.lat, lng: s.lng })) }),
        })
        const data = await res.json()
        const legs: RouteLeg[] = data.legs || []
        const byStopId: Record<string, RouteLeg> = {}
        stopsWithCoords.forEach((s, i) => { if (legs[i]) byStopId[s.id] = legs[i] })
        setLegsByDay(prev => ({ ...prev, [dayIndex]: byStopId }))
      } catch {
        // No distances for this day — callers just don't render a connector.
      }
    })
  }, [days])

  return legsByDay
}
