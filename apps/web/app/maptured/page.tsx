'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Search, X, Compass, MapPin, Camera as CameraIcon, Trash2 } from 'lucide-react'
import { createClient } from '../../lib/supabase/client'
import PlaceReview from '../components/PlaceReview'
import PlaceSearch from '../components/PlaceSearch'
import CityPinMap from '../components/CityPinMap'
import { scoreColor, scoreTint, podiumColor } from '../../lib/beliScore'
import { dedupeByName, dedupeRatedByName } from '../../lib/dedupeByName'

const supabase = createClient()

interface CityGroup {
  key: string
  label: string
  tripIds: string[]
}

interface BeenPlace {
  id: string
  name: string
  visited_rating: number | null
  visited_note: string | null
  // Filled in lazily from Google (see fetchGoogleData) — a tile shouldn't
  // wait on this to render, it just upgrades in place once it arrives.
  photoRef?: string | null
  address?: string | null
  googleFetched?: boolean
}

interface Candidate {
  id: string
  name: string
  trip_id: string
  trips: { destination: string } | null
}

// Full page, not a side panel — this grew past what a 320px drawer could
// hold once it's city-grouped with per-city "been here" lists. Deliberately
// scoped to just Been There (the Beli-style memory log); saved-but-not-
// visited places live on the planning side (Trips sidebar) instead, since
// they're a different kind of thing — forward-looking "to do" vs. this
// being backward-looking "where I've gone."
//
// Cities are loaded as a lightweight list up front (just trip id/destination
// — cheap, ~80 rows), but each city's actual places are only fetched when
// selected. Loading every place for every city eagerly is exactly what
// froze the old add-search panel at 700 rows; same lesson applies here.
export default function MapturedPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [cities, setCities] = useState<CityGroup[]>([])
  const [activeCity, setActiveCity] = useState<string | null>(null)
  const [placesByCity, setPlacesByCity] = useState<Record<string, BeenPlace[]>>({})
  const [loadingCity, setLoadingCity] = useState<Record<string, boolean>>({})
  const [countByCity, setCountByCity] = useState<Record<string, number>>({})
  const [avgByCity, setAvgByCity] = useState<Record<string, number | null>>({})
  // One representative coordinate per city, for a pin on the world-map
  // background below — reuses an already-visited place's own lat/lng (pulled
  // in the same per-city count/avg query below) rather than a separate
  // geocoding call per city.
  const [pinByCity, setPinByCity] = useState<Record<string, { lat: number; lng: number }>>({})
  // Accumulated across the same per-city count/avg fetch below — a Spotify-
  // Wrapped-style "mirror" strip (total places, cities, overall score) gives
  // the page an identity/profile feel rather than reading as a plain utility
  // list of rows.
  const [overallStats, setOverallStats] = useState({ places: 0, ratingSum: 0, ratingCount: 0 })
  const [editingPlace, setEditingPlace] = useState<BeenPlace | null>(null)
  const [confirmDeleteCity, setConfirmDeleteCity] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [addMode, setAddMode] = useState<'saves' | 'new'>('saves')
  const [addQuery, setAddQuery] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [newPlaceCity, setNewPlaceCity] = useState('')

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }
      // saved=true only — matches the Saves list on the Trips sidebar. This
      // account has 149 trips total, 137 of them unsaved drafts (typos, odd
      // abbreviations like "atl", casing variants) from testing/exploration —
      // grouping on those too turned "Atlanta" into three separate sections.
      const { data: trips } = await supabase
        .from('trips')
        .select('id, destination')
        .eq('user_id', user.id)
        .eq('is_inbox', false)
        .eq('saved', true)
      const groups = new Map<string, CityGroup>()
      for (const t of trips || []) {
        const label = (t.destination || 'Unknown').trim()
        const key = label.toLowerCase()
        if (!groups.has(key)) groups.set(key, { key, label, tripIds: [] })
        groups.get(key)!.tripIds.push(t.id)
      }
      const sorted = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))
      setCities(sorted)
      setLoading(false)

      // One lightweight query per city (a handful of cities, not the
      // 700-place scale problem the rest of this page deliberately avoids by
      // never fetching more than one city's full place list at a time) —
      // fetches the rating + lat/lng columns so the city tile can show a
      // Beli-style "N been here · avg X.X" AND the world map can drop a pin,
      // without a second round trip for either.
      sorted.forEach(async city => {
        const { data } = await supabase
          .from('places')
          .select('name, visited_rating, visited_note, lat, lng')
          .in('trip_id', city.tripIds)
          .eq('visited', true)
        // Dedupe before counting/averaging — same place saved to more than
        // one trip for this city shouldn't inflate the "N been here" count.
        const rows = dedupeRatedByName(data || [])
        const ratings = rows.map(r => r.visited_rating).filter((n): n is number => n != null).map(Number)
        const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null
        setCountByCity(prev => ({ ...prev, [city.key]: rows.length }))
        setAvgByCity(prev => ({ ...prev, [city.key]: avg }))
        // One pin per city — any visited place's coordinates will do, they're
        // all in the same city.
        const pinPlace = (data || []).find((r: any) => typeof r.lat === 'number' && typeof r.lng === 'number')
        if (pinPlace) setPinByCity(prev => ({ ...prev, [city.key]: { lat: (pinPlace as any).lat, lng: (pinPlace as any).lng } }))
        setOverallStats(prev => ({
          places: prev.places + rows.length,
          ratingSum: prev.ratingSum + ratings.reduce((a, b) => a + b, 0),
          ratingCount: prev.ratingCount + ratings.length,
        }))
      })
    })()
  }, [router])

  async function fetchGoogleData(cityLabel: string, place: BeenPlace) {
    try {
      const res = await fetch(`/api/place-search?name=${encodeURIComponent(place.name)}&location=${encodeURIComponent(cityLabel)}`)
      const data = await res.json()
      setPlacesByCity(prev => {
        const list = prev[cityLabel.toLowerCase()]
        if (!list) return prev
        return {
          ...prev,
          [cityLabel.toLowerCase()]: list.map(p => p.id === place.id
            ? { ...p, photoRef: data.result?.photo_reference || null, address: data.result?.address || null, googleFetched: true }
            : p),
        }
      })
      // Write-through: persist to the row so the NEXT load skips the live
      // Google round-trip entirely for this place (see fetchCityPlaces below,
      // which was previously re-doing this 2-hop lookup for every place on
      // every single visit — the actual cause of the slow photo loading).
      if (data.result?.photo_reference) {
        await supabase.from('places')
          .update({ photo_reference: data.result.photo_reference, neighborhood: data.result.address || null })
          .eq('id', place.id)
      }
    } catch {
      // Tile just falls back to its no-photo state — not worth surfacing an error for.
    }
  }

  async function fetchCityPlaces(city: CityGroup) {
    setLoadingCity(prev => ({ ...prev, [city.key]: true }))
    const { data } = await supabase
      .from('places')
      .select('id, name, visited_rating, visited_note, photo_reference, neighborhood')
      .in('trip_id', city.tripIds)
      .eq('visited', true)
      .order('visited_rating', { ascending: false, nullsFirst: false })
    // PostgREST can serialize `numeric` as a string — coerce for .toFixed()/sorting downstream.
    // Places saved via the AI/TikTok pipeline already have a photo reference
    // + address cached on the row from when they were first verified — use
    // that immediately instead of re-resolving it from Google on every load.
    const coerced: BeenPlace[] = (data || []).map(p => ({
      ...p,
      visited_rating: p.visited_rating != null ? Number(p.visited_rating) : null,
      photoRef: p.photo_reference || undefined,
      address: p.neighborhood || undefined,
      googleFetched: !!p.photo_reference,
    }))
    // The same place can be saved to more than one trip for this city (see
    // dedupeByName.ts) — collapse those before ranking so it doesn't show twice.
    const places = dedupeRatedByName(coerced).sort((a, b) => (b.visited_rating ?? -1) - (a.visited_rating ?? -1))
    setPlacesByCity(prev => ({ ...prev, [city.key]: places }))
    setLoadingCity(prev => ({ ...prev, [city.key]: false }))
    // Only places added via manual search (no cached photo ref yet) need the
    // live lookup — e.g. a place added through PlaceSearch, which doesn't
    // capture photo data today.
    places.filter(p => !p.photoRef).forEach(p => fetchGoogleData(city.label, p))
  }

  function selectCity(city: CityGroup) {
    const next = activeCity === city.key ? null : city.key
    setActiveCity(next)
    setConfirmDeleteCity(null)
    if (next && !placesByCity[city.key]) fetchCityPlaces(city)
  }

  // Removes this city's "been here" log — only the visited places, scoped to
  // this city's trip ids. Doesn't touch the trips themselves (an itinerary
  // might still be live on one of them) or anything in Saves (unvisited
  // places for the same city survive this untouched).
  async function handleDeleteCity(city: CityGroup) {
    if (confirmDeleteCity !== city.key) { setConfirmDeleteCity(city.key); return }
    setConfirmDeleteCity(null)
    await supabase.from('places').delete().in('trip_id', city.tripIds).eq('visited', true)
    const removed = placesByCity[city.key] || []
    const removedRatings = removed.map(p => p.visited_rating).filter((n): n is number => n != null)
    setOverallStats(prev => ({
      places: prev.places - removed.length,
      ratingSum: prev.ratingSum - removedRatings.reduce((a, b) => a + b, 0),
      ratingCount: prev.ratingCount - removedRatings.length,
    }))
    setPlacesByCity(prev => ({ ...prev, [city.key]: [] }))
    setCountByCity(prev => ({ ...prev, [city.key]: 0 }))
    setAvgByCity(prev => ({ ...prev, [city.key]: null }))
    setPinByCity(prev => { const next = { ...prev }; delete next[city.key]; return next })
    setActiveCity(null)
  }

  // Same capped/debounced search pattern as before — never fetch-all.
  useEffect(() => {
    if (!showAdd) { setCandidates([]); setAddLoading(false); return }
    setAddLoading(true)
    const timer = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setCandidates([]); setAddLoading(false); return }
      let query = supabase
        .from('places')
        .select('id, name, trip_id, trips!inner(destination, user_id, saved)')
        .eq('visited', false)
        .eq('trips.user_id', user.id)
        .eq('trips.saved', true)
      query = addQuery.trim()
        ? query.ilike('name', `%${addQuery.trim()}%`).order('name')
        : query.order('created_at', { ascending: false })
      const { data } = await query.limit(20)
      // Same place saved to more than one trip shouldn't show as two picks.
      setCandidates(dedupeByName((data as any) || []))
      setAddLoading(false)
    }, addQuery.trim() ? 300 : 0)
    return () => clearTimeout(timer)
  }, [showAdd, addQuery])

  async function handleMarkVisited(place: Candidate) {
    await supabase.from('places').update({ visited: true }).eq('id', place.id)
    setCandidates(prev => prev.filter(p => p.id !== place.id))
    setShowAdd(false)
    const cityKey = (place.trips?.destination || '').trim().toLowerCase()
    const city = cities.find(c => c.key === cityKey)
    if (city) {
      setActiveCity(city.key)
      setCountByCity(prev => ({ ...prev, [city.key]: (prev[city.key] || 0) + 1 }))
      fetchCityPlaces(city)
    }
    // Beli-style: go straight into rating it rather than leaving it to sit
    // unrated at the bottom of the leaderboard until you happen to tap it.
    setEditingPlace({ id: place.id, name: place.name, visited_rating: null, visited_note: null })
  }

  // Not every "been here" place was ever saved to a trip first — someone
  // might just want to log a place they stumbled into. Reuses PlaceSearch
  // (Google autocomplete) rather than free text, so the row still gets real
  // coordinates/category instead of a placeholder with nothing fillable in.
  // A place still has to live on some trip (trip_id is required), so this
  // resolves an existing saved trip for the typed city or creates a minimal
  // one — same shape the iOS inbox share-target already creates for places
  // with nowhere else to go.
  async function resolveTripForCity(cityLabel: string): Promise<string | null> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const key = cityLabel.trim().toLowerCase()
    const existing = cities.find(c => c.key === key)
    if (existing) return existing.tripIds[0]
    const { data: trip } = await supabase
      .from('trips')
      .insert({ destination: cityLabel.trim(), duration: '0 days', vibe: 'balanced', saved: true, is_inbox: false, user_id: user.id })
      .select()
      .single()
    if (!trip) return null
    setCities(prev => [...prev, { key, label: cityLabel.trim(), tripIds: [trip.id] }].sort((a, b) => a.label.localeCompare(b.label)))
    return trip.id
  }

  async function handleNewPlaceSaved(place: { id?: string; name: string }) {
    if (!place.id) return
    await supabase.from('places').update({ visited: true }).eq('id', place.id)
    setShowAdd(false)
    const cityKey = newPlaceCity.trim().toLowerCase()
    setNewPlaceCity('')
    const city = cities.find(c => c.key === cityKey)
    if (city) {
      setActiveCity(city.key)
      setCountByCity(prev => ({ ...prev, [city.key]: (prev[city.key] || 0) + 1 }))
      fetchCityPlaces(city)
    }
    setEditingPlace({ id: place.id, name: place.name, visited_rating: null, visited_note: null })
  }

  const activeCityGroup = cities.find(c => c.key === activeCity)
  const activePlaces = activeCity ? placesByCity[activeCity] : undefined
  // `editingPlace` can be a frozen snapshot set before its photo/address were
  // resolved (the "rate it right after adding" flows set it from just
  // {id, name}) — once fetchCityPlaces/fetchGoogleData fill that in on the
  // live list, pull the fresher copy so the modal doesn't shimmer forever.
  const displayPlace = editingPlace
    ? activePlaces?.find(p => p.id === editingPlace.id) || editingPlace
    : null

  // One pin per city you've marked been here — any one of that city's
  // visited places' coordinates will do, they all land in the same spot.
  const cityPins = cities
    .filter(c => (countByCity[c.key] || 0) > 0 && pinByCity[c.key])
    .map(c => ({ key: c.key, coords: pinByCity[c.key] }))

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-1.5 text-sm font-medium text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors"
          >
            <ArrowLeft size={15} strokeWidth={2} /> Back
          </button>
          <span className="text-xl font-semibold tracking-tight text-[#0A0A0A]">
            maptured<span className="text-[#3D5AFE]">.</span>
          </span>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-sm font-medium text-[#3D5AFE] hover:text-[#2E45D6] transition-colors"
          >
            <Plus size={15} strokeWidth={2} /> Add
          </button>
        </div>

        {!loading && cityPins.length > 0 && <CityPinMap pins={cityPins} />}

        {/* Stats mirror — a Spotify-Wrapped-style identity strip (total
            places, cities, overall score) rather than diving straight into a
            utility list. Only renders once there's something to show. */}
        {!loading && overallStats.places > 0 && (
          <div
            className="relative overflow-hidden rounded-2xl mb-8 px-6 py-5 shadow-[0_8px_24px_-8px_rgba(61,90,254,0.45)]"
            style={{ background: 'radial-gradient(120% 140% at 0% 0%, #4A63FF 0%, #2E3FD8 60%, #26339E 100%)' }}
          >
            <div className="grid grid-cols-3 gap-4 relative">
              <div>
                <p className="text-2xl font-bold text-white tabular-nums">{overallStats.places}</p>
                <p className="text-[11px] text-white/70 uppercase tracking-wider mt-0.5">Places been</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {cities.filter(c => (countByCity[c.key] || 0) > 0).length}
                </p>
                <p className="text-[11px] text-white/70 uppercase tracking-wider mt-0.5">Cities</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {overallStats.ratingCount > 0 ? (overallStats.ratingSum / overallStats.ratingCount).toFixed(1) : '—'}
                </p>
                <p className="text-[11px] text-white/70 uppercase tracking-wider mt-0.5">Avg score</p>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <p className="text-sm text-[#A3A3A3] text-center py-12">Loading...</p>
        )}

        {!loading && cities.length === 0 && (
          <div className="text-center py-16">
            <Compass size={28} strokeWidth={1.5} className="mx-auto mb-3 text-[#A3A3A3]" />
            <p className="text-sm text-[#6B6B6B]">No trips yet</p>
          </div>
        )}

        {/* City tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
          {cities.map((city, ci) => {
            const active = activeCity === city.key
            const avg = avgByCity[city.key]
            return (
              <button
                key={city.key}
                onClick={() => selectCity(city)}
                style={active ? { background: 'linear-gradient(135deg, #4A63FF, #2E3FD8)', animationDelay: `${Math.min(ci, 8) * 30}ms` } : { animationDelay: `${Math.min(ci, 8) * 30}ms` }}
                className={`row-in text-left rounded-xl p-4 transition-all duration-150 active:scale-[0.97] ${
                  active
                    ? 'text-white shadow-[0_8px_20px_-6px_rgba(61,90,254,0.55)] scale-[1.02]'
                    : 'bg-white text-[#0A0A0A] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_6px_16px_-6px_rgba(0,0,0,0.12)] hover:-translate-y-0.5'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium truncate">{city.label}</p>
                  {avg != null && (
                    <span
                      className="shrink-0 w-2 h-2 rounded-full"
                      style={{ background: active ? 'rgba(255,255,255,0.8)' : scoreColor(avg) }}
                    />
                  )}
                </div>
                <p className={`text-xs mt-1 ${active ? 'text-white/70' : 'text-[#A3A3A3]'}`}>
                  {countByCity[city.key] > 0
                    ? `${countByCity[city.key]} been here${avg != null ? ` · avg ${avg.toFixed(1)}` : ''}`
                    : 'Nothing yet'}
                </p>
              </button>
            )
          })}
        </div>

        {/* Place tiles for the selected city */}
        {activeCityGroup && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-lg font-semibold tracking-tight text-[#0A0A0A]">{activeCityGroup.label}</p>
              {(countByCity[activeCityGroup.key] || 0) > 0 && (
                <button
                  onClick={() => handleDeleteCity(activeCityGroup)}
                  className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors ${
                    confirmDeleteCity === activeCityGroup.key
                      ? 'bg-red-50 text-red-500'
                      : 'text-[#A3A3A3] hover:text-red-400 hover:bg-red-50'
                  }`}
                >
                  <Trash2 size={12} strokeWidth={2} />
                  {confirmDeleteCity === activeCityGroup.key ? 'Delete all?' : 'Delete city'}
                </button>
              )}
            </div>
            {loadingCity[activeCityGroup.key] && (
              <p className="text-sm text-[#A3A3A3] text-center py-10">Loading...</p>
            )}
            {!loadingCity[activeCityGroup.key] && (activePlaces?.length ?? 0) === 0 && (
              <div className="text-center py-14 bg-white rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                <CameraIcon size={22} strokeWidth={1.5} className="mx-auto mb-2 text-[#D4D4D4]" />
                <p className="text-sm text-[#6B6B6B]">Nothing marked been here yet in {activeCityGroup.label}.</p>
              </div>
            )}
            {/* Ranked leaderboard, Beli-style — already sorted by score (desc,
                nulls last) from fetchCityPlaces's query, so rank is just row
                position. An unrated place sorts to the bottom with a "Rate
                it" nudge instead of a score badge. Top 3 get a podium-colored
                rank badge — distinct from the red/yellow/green score bands —
                for the leaderboard-flex feel Beli is known for. */}
            <div className="flex flex-col bg-white rounded-xl overflow-hidden divide-y divide-[#F2F2F2] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              {activePlaces?.map((p, i) => {
                const rank = i + 1
                const podium = podiumColor(rank)
                const photoPending = !p.photoRef && !p.googleFetched
                return (
                  <button
                    key={p.id}
                    onClick={() => setEditingPlace(p)}
                    style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                    className="row-in w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-[rgba(61,90,254,0.03)] active:scale-[0.99] transition-[background-color,transform]"
                  >
                    {podium ? (
                      <span
                        className="w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                        style={{ background: podium }}
                      >
                        {rank}
                      </span>
                    ) : (
                      <span className="w-6 shrink-0 text-center text-xs font-semibold text-[#A3A3A3]">{rank}</span>
                    )}
                    <div className={`w-12 h-12 shrink-0 rounded-lg flex items-center justify-center overflow-hidden ${photoPending ? 'skeleton-shimmer' : 'bg-[#F0F0F0]'}`}>
                      {p.photoRef ? (
                        <img
                          src={`/api/place-photo?ref=${encodeURIComponent(p.photoRef)}`}
                          alt={p.name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : !photoPending ? (
                        <CameraIcon size={16} strokeWidth={1.5} className="text-[#C4C4C4]" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#0A0A0A] truncate">{p.name}</p>
                      {p.address && <p className="text-[11px] text-[#A3A3A3] truncate">{p.address}</p>}
                    </div>
                    {p.visited_rating != null ? (
                      <span
                        className="shrink-0 flex items-baseline gap-0.5 text-white rounded-lg pl-2.5 pr-2 py-1.5 min-w-[3rem] justify-center"
                        style={{ background: scoreColor(p.visited_rating) }}
                      >
                        <span className="text-sm font-bold tabular-nums">{p.visited_rating.toFixed(1)}</span>
                        <span className="text-[9px] font-medium text-white/70">/10</span>
                      </span>
                    ) : (
                      <span
                        className="shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg"
                        style={{ background: 'rgba(61,90,254,0.08)', color: '#3D5AFE' }}
                      >
                        Rate it
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Place detail / review modal — a true bottom sheet on mobile (slides
          up from the bottom edge, rounded top corners, drag-handle bar) so it
          reads as a native mobile pattern rather than a shrunken desktop
          dialog; desktop keeps the floating centered card. */}
      {editingPlace && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[2px]" onClick={() => setEditingPlace(null)} />
          <div className="sheet-enter fixed inset-x-0 bottom-0 max-h-[85vh] z-50 bg-white rounded-t-3xl shadow-[0_-8px_40px_-8px_rgba(0,0,0,0.2)] overflow-y-auto sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:top-16 sm:bottom-auto sm:w-96 sm:max-h-[80vh] sm:rounded-2xl sm:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.25)] sm:animate-none">
            <div className="sm:hidden flex justify-center pt-2.5 pb-1">
              <div className="w-9 h-1 rounded-full bg-[#E5E5E5]" />
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#EFEFEF] sticky top-0 bg-white/95 backdrop-blur-sm">
              <span className="text-sm font-semibold text-[#0A0A0A] truncate pr-2">{editingPlace.name}</span>
              <button
                onClick={() => setEditingPlace(null)}
                className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full text-[#A3A3A3] hover:text-[#0A0A0A] hover:bg-[rgba(0,0,0,0.05)] transition-colors"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            {displayPlace?.photoRef ? (
              <img
                src={`/api/place-photo?ref=${encodeURIComponent(displayPlace.photoRef)}`}
                alt={editingPlace.name}
                loading="lazy"
                decoding="async"
                className="w-full h-40 object-cover"
              />
            ) : !displayPlace?.googleFetched && (
              <div className="w-full h-40 skeleton-shimmer" />
            )}
            {displayPlace?.address && (
              <p className="text-xs text-[#A3A3A3] px-4 pt-3">{displayPlace.address}</p>
            )}
            <div className="p-4">
              <PlaceReview
                placeId={editingPlace.id}
                onChange={() => { if (activeCityGroup) fetchCityPlaces(activeCityGroup) }}
              />
            </div>
          </div>
        </>
      )}

      {showAdd && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[2px]" onClick={() => setShowAdd(false)} />
          <div className="sheet-enter fixed inset-x-0 bottom-0 max-h-[85vh] z-50 bg-white rounded-t-3xl shadow-[0_-8px_40px_-8px_rgba(0,0,0,0.2)] overflow-y-auto sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:top-20 sm:bottom-auto sm:w-96 sm:max-h-none sm:rounded-2xl sm:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.25)] sm:animate-none">
            <div className="sm:hidden flex justify-center pt-2.5 pb-1">
              <div className="w-9 h-1 rounded-full bg-[#E5E5E5]" />
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#EFEFEF]">
              <span className="text-sm font-semibold text-[#0A0A0A]">Mark as been here</span>
              <button
                onClick={() => setShowAdd(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-[#A3A3A3] hover:text-[#0A0A0A] hover:bg-[rgba(0,0,0,0.05)] transition-colors"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="flex gap-1 px-4 pt-3">
              <button
                onClick={() => setAddMode('saves')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${addMode === 'saves' ? 'bg-[#3D5AFE] text-white' : 'text-[#6B6B6B] hover:bg-[rgba(0,0,0,0.03)]'}`}
              >
                From your saves
              </button>
              <button
                onClick={() => setAddMode('new')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${addMode === 'new' ? 'bg-[#3D5AFE] text-white' : 'text-[#6B6B6B] hover:bg-[rgba(0,0,0,0.03)]'}`}
              >
                New place
              </button>
            </div>

            {addMode === 'saves' ? (
              <>
                <div className="px-4 pt-3 pb-2">
                  <div className="relative">
                    <Search size={13} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A3A3A3]" />
                    <input
                      autoFocus
                      value={addQuery}
                      onChange={e => setAddQuery(e.target.value)}
                      placeholder="Search your saved places..."
                      className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-md pl-8 pr-3 py-2 outline-none text-sm text-[#0A0A0A] placeholder:text-[#A3A3A3] focus:border-[#3D5AFE] transition-colors"
                    />
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto pb-2">
                  {!addQuery.trim() && !addLoading && candidates.length > 0 && (
                    <p className="text-[10px] uppercase tracking-widest text-[#A3A3A3] px-4 pt-2 pb-1">Recently saved</p>
                  )}
                  {addLoading && (
                    <p className="text-xs text-[#A3A3A3] text-center py-8">{addQuery.trim() ? 'Searching...' : 'Loading...'}</p>
                  )}
                  {!addLoading && candidates.length === 0 && (
                    <p className="text-xs text-[#A3A3A3] text-center py-8 px-6">
                      {addQuery.trim() ? 'No matches — it may already be marked been here.' : "Everything you've saved is already marked been here."}
                    </p>
                  )}
                  {candidates.map(c => (
                    <button
                      key={c.id}
                      onClick={() => handleMarkVisited(c)}
                      className="w-full text-left flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-[rgba(0,0,0,0.03)] transition-all"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#0A0A0A] truncate">{c.name}</p>
                        <p className="text-xs text-[#A3A3A3] truncate">{c.trips?.destination}</p>
                      </div>
                      <Plus size={14} strokeWidth={2} className="text-[#3D5AFE] shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="px-4 pt-3 pb-4">
                <div className="relative mb-2">
                  <MapPin size={13} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A3A3A3]" />
                  <input
                    autoFocus
                    value={newPlaceCity}
                    onChange={e => setNewPlaceCity(e.target.value)}
                    placeholder="City (e.g. Lisbon, Portugal)"
                    className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-md pl-8 pr-3 py-2 outline-none text-sm text-[#0A0A0A] placeholder:text-[#A3A3A3] focus:border-[#3D5AFE] transition-colors"
                  />
                </div>
                {newPlaceCity.trim() ? (
                  <PlaceSearch
                    tripId=""
                    destination={newPlaceCity.trim()}
                    onBeforeSave={() => resolveTripForCity(newPlaceCity)}
                    onSaved={handleNewPlaceSaved}
                  />
                ) : (
                  <p className="text-xs text-[#A3A3A3] text-center py-4">Enter a city to search for a place.</p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
