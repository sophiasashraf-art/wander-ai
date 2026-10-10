'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Star, ChevronDown, Plus, Search, X, Compass } from 'lucide-react'
import { createClient } from '../../lib/supabase/client'
import PlaceReview from '../components/PlaceReview'

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
// expanded. Loading every place for every city eagerly is exactly what
// froze the old add-search panel at 700 rows; same lesson applies here.
export default function MapturedPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [cities, setCities] = useState<CityGroup[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [placesByCity, setPlacesByCity] = useState<Record<string, BeenPlace[]>>({})
  const [loadingCity, setLoadingCity] = useState<Record<string, boolean>>({})
  const [countByCity, setCountByCity] = useState<Record<string, number>>({})
  const [editingPlace, setEditingPlace] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])

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

  async function fetchCityPlaces(city: CityGroup) {
    setLoadingCity(prev => ({ ...prev, [city.key]: true }))
    const { data } = await supabase
      .from('places')
      .select('id, name, visited_rating, visited_note')
      .in('trip_id', city.tripIds)
      .eq('visited', true)
      .order('visited_rating', { ascending: false, nullsFirst: false })
    setPlacesByCity(prev => ({ ...prev, [city.key]: data || [] }))
    setLoadingCity(prev => ({ ...prev, [city.key]: false }))
  }

  function toggleCity(city: CityGroup) {
    const next = !expanded[city.key]
    setExpanded(prev => ({ ...prev, [city.key]: next }))
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
      setExpanded(prev => ({ ...prev, [city.key]: true }))
      setCountByCity(prev => ({ ...prev, [city.key]: (prev[city.key] || 0) + 1 }))
      fetchCityPlaces(city)
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="max-w-2xl mx-auto px-5 py-8">
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

        <div className="space-y-2">
          {cities.map(city => (
            <div key={city.key} className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
              <button
                onClick={() => toggleCity(city)}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-[rgba(0,0,0,0.02)] transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-[#0A0A0A] truncate">{city.label}</span>
                  {countByCity[city.key] > 0 && (
                    <span className="text-xs text-[#A3A3A3] shrink-0">{countByCity[city.key]}</span>
                  )}
                </span>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className={`text-[#A3A3A3] shrink-0 transition-transform ${expanded[city.key] ? 'rotate-180' : ''}`}
                />
              </button>
              {expanded[city.key] && (
                <div className="border-t border-[#EFEFEF]">
                  {loadingCity[city.key] && (
                    <p className="text-xs text-[#A3A3A3] text-center py-6">Loading...</p>
                  )}
                  {!loadingCity[city.key] && (placesByCity[city.key]?.length ?? 0) === 0 && (
                    <p className="text-xs text-[#A3A3A3] text-center py-6 px-4">
                      Nothing marked been here yet in {city.label}.
                    </p>
                  )}
                  {placesByCity[city.key]?.map((p, i) => (
                    <div key={p.id} className="px-4 py-3 border-b border-[#F5F5F5] last:border-0">
                      <button
                        onClick={() => setEditingPlace(prev => prev === p.id ? null : p.id)}
                        className="w-full flex items-start gap-3 text-left"
                      >
                        <span className="text-xs font-semibold text-[#A3A3A3] w-4 pt-0.5 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#0A0A0A] truncate">{p.name}</p>
                          {p.visited_rating && (
                            <span className="flex items-center gap-0.5 text-xs text-[#3D5AFE] font-medium mt-0.5">
                              <Star size={10} strokeWidth={2} className="fill-[#3D5AFE]" /> {p.visited_rating}
                            </span>
                          )}
                          {p.visited_note && (
                            <p className="text-xs text-[#6B6B6B] mt-1 leading-relaxed">{p.visited_note}</p>
                          )}
                        </div>
                      </button>
                      {editingPlace === p.id && (
                        <div className="pl-7">
                          <PlaceReview
                            placeId={p.id}
                            onChange={() => fetchCityPlaces(city)}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

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
          </div>
        </>
      )}
    </div>
  )
}
