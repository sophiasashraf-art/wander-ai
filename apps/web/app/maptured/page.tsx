'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Star, Plus, Search, X, Compass, MapPin, Camera as CameraIcon } from 'lucide-react'
import { createClient } from '../../lib/supabase/client'
import PlaceReview from '../components/PlaceReview'
import PlaceSearch from '../components/PlaceSearch'

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
  const [editingPlace, setEditingPlace] = useState<BeenPlace | null>(null)

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

      // Lightweight — head:true counts rows without transferring them, so
      // this stays cheap even though it's one query per city (a handful of
      // cities, not the 700-place scale problem the rest of this page
      // deliberately avoids by never fetching more than one city at a time).
      sorted.forEach(async city => {
        const { count } = await supabase
          .from('places')
          .select('id', { count: 'exact', head: true })
          .in('trip_id', city.tripIds)
          .eq('visited', true)
        setCountByCity(prev => ({ ...prev, [city.key]: count || 0 }))
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
    } catch {
      // Tile just falls back to its no-photo state — not worth surfacing an error for.
    }
  }

  async function fetchCityPlaces(city: CityGroup) {
    setLoadingCity(prev => ({ ...prev, [city.key]: true }))
    const { data } = await supabase
      .from('places')
      .select('id, name, visited_rating, visited_note')
      .in('trip_id', city.tripIds)
      .eq('visited', true)
      .order('visited_rating', { ascending: false, nullsFirst: false })
    const places: BeenPlace[] = data || []
    setPlacesByCity(prev => ({ ...prev, [city.key]: places }))
    setLoadingCity(prev => ({ ...prev, [city.key]: false }))
    places.forEach(p => fetchGoogleData(city.label, p))
  }

  function selectCity(city: CityGroup) {
    const next = activeCity === city.key ? null : city.key
    setActiveCity(next)
    if (next && !placesByCity[city.key]) fetchCityPlaces(city)
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
      setCandidates(((data as any) || []))
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

  async function handleNewPlaceSaved(place: { id?: string }) {
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
  }

  const activeCityGroup = cities.find(c => c.key === activeCity)
  const activePlaces = activeCity ? placesByCity[activeCity] : undefined

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
          {cities.map(city => (
            <button
              key={city.key}
              onClick={() => selectCity(city)}
              className={`text-left rounded-lg border p-4 transition-all ${
                activeCity === city.key
                  ? 'bg-[#0A0A0A] border-[#0A0A0A] text-white'
                  : 'bg-white border-[#E5E5E5] text-[#0A0A0A] hover:border-[#D4D4D4]'
              }`}
            >
              <p className="text-sm font-medium truncate">{city.label}</p>
              <p className={`text-xs mt-1 ${activeCity === city.key ? 'text-white/60' : 'text-[#A3A3A3]'}`}>
                {countByCity[city.key] > 0 ? `${countByCity[city.key]} been here` : 'Nothing yet'}
              </p>
            </button>
          ))}
        </div>

        {/* Place tiles for the selected city */}
        {activeCityGroup && (
          <div>
            <p className="text-xs uppercase tracking-widest text-[#A3A3A3] mb-3">{activeCityGroup.label}</p>
            {loadingCity[activeCityGroup.key] && (
              <p className="text-sm text-[#A3A3A3] text-center py-10">Loading...</p>
            )}
            {!loadingCity[activeCityGroup.key] && (activePlaces?.length ?? 0) === 0 && (
              <p className="text-sm text-[#A3A3A3] text-center py-10">
                Nothing marked been here yet in {activeCityGroup.label}.
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {activePlaces?.map(p => (
                <button
                  key={p.id}
                  onClick={() => setEditingPlace(p)}
                  className="text-left bg-white border border-[#E5E5E5] rounded-lg overflow-hidden hover:border-[#D4D4D4] transition-colors"
                >
                  <div className="aspect-[4/3] bg-[#F0F0F0] flex items-center justify-center overflow-hidden">
                    {p.photoRef ? (
                      <img
                        src={`/api/place-photo?ref=${encodeURIComponent(p.photoRef)}`}
                        alt={p.name}
                        className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <CameraIcon size={20} strokeWidth={1.5} className="text-[#C4C4C4]" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-[#0A0A0A] truncate">{p.name}</p>
                    {p.visited_rating && (
                      <span className="flex items-center gap-0.5 text-xs text-[#3D5AFE] font-medium mt-0.5">
                        <Star size={10} strokeWidth={2} className="fill-[#3D5AFE]" /> {p.visited_rating}
                      </span>
                    )}
                    {p.address && (
                      <p className="text-[11px] text-[#A3A3A3] mt-1 truncate">{p.address}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Place detail / review modal */}
      {editingPlace && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[2px]" onClick={() => setEditingPlace(null)} />
          <div className="fixed inset-x-5 top-16 bottom-16 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-96 sm:bottom-auto sm:max-h-[80vh] z-50 bg-white rounded-lg shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#EFEFEF] sticky top-0 bg-white">
              <span className="text-sm font-semibold text-[#0A0A0A] truncate pr-2">{editingPlace.name}</span>
              <button onClick={() => setEditingPlace(null)} className="text-[#A3A3A3] hover:text-[#0A0A0A] transition-colors shrink-0">
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            {editingPlace.photoRef && (
              <img
                src={`/api/place-photo?ref=${encodeURIComponent(editingPlace.photoRef)}`}
                alt={editingPlace.name}
                className="w-full h-40 object-cover"
              />
            )}
            {editingPlace.address && (
              <p className="text-xs text-[#A3A3A3] px-4 pt-3">{editingPlace.address}</p>
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
          <div className="fixed inset-x-5 top-20 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-96 z-50 bg-white rounded-lg shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#EFEFEF]">
              <span className="text-sm font-semibold text-[#0A0A0A]">Mark as been here</span>
              <button onClick={() => setShowAdd(false)} className="text-[#A3A3A3] hover:text-[#0A0A0A] transition-colors">
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div className="flex gap-1 px-4 pt-3">
              <button
                onClick={() => setAddMode('saves')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${addMode === 'saves' ? 'bg-[#EEF0FF] text-[#3D5AFE]' : 'text-[#6B6B6B] hover:bg-[rgba(0,0,0,0.03)]'}`}
              >
                From your saves
              </button>
              <button
                onClick={() => setAddMode('new')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${addMode === 'new' ? 'bg-[#EEF0FF] text-[#3D5AFE]' : 'text-[#6B6B6B] hover:bg-[rgba(0,0,0,0.03)]'}`}
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
