'use client'

import { useEffect, useState } from 'react'
import { X, Star, Camera, Plus, Search, ArrowLeft } from 'lucide-react'
import { createClient } from '../../lib/supabase/client'

const supabase = createClient()

interface BeenPlace {
  id: string
  name: string
  city: string | null
  visited_rating: number | null
  visited_note: string | null
  trip_id: string
  trips: { destination: string } | null
}

interface Candidate {
  id: string
  name: string
  city: string | null
  trips: { destination: string } | null
}

// "Been there" ranked feed — every place across every trip the signed-in user
// has personally marked visited (see PlaceReview), sorted highest-rated first,
// Beli-style. First slice of the broader Maptured panel (saves-across-trips
// and reusable past-trip templates are later additions, same panel).
export default function MapturedPanel({ open, onClose, onSelectTrip }: {
  open: boolean; onClose: () => void; onSelectTrip: (tripId: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [places, setPlaces] = useState<BeenPlace[]>([])

  // Quick-add: mark an already-saved place visited right from here, instead
  // of having to go find it inside whichever trip it's in first.
  const [showAdd, setShowAdd] = useState(false)
  const [addQuery, setAddQuery] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])

  async function fetchBeenPlaces() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setPlaces([]); setLoading(false); return }
    const { data } = await supabase
      .from('places')
      .select('id, name, city, visited_rating, visited_note, trip_id, trips!inner(destination, user_id)')
      .eq('visited', true)
      .eq('trips.user_id', user.id)
      .order('visited_rating', { ascending: false, nullsFirst: false })
    setPlaces(((data as any) || []))
    setLoading(false)
  }

  useEffect(() => {
    if (!open) return
    setShowAdd(false)
    fetchBeenPlaces()
  }, [open])

  // Searched server-side, not fetched-all-then-filtered: this account alone
  // has 700 unvisited places across its trips — pulling all of them down and
  // rendering 700 buttons client-side visibly froze the panel (confirmed
  // directly: the fetch itself took ~1.5s, but the resulting render never
  // recovered). ilike + limit(20), debounced, keeps this to a handful of
  // rows at a time regardless of how many trips/places exist.
  useEffect(() => {
    if (!showAdd || !addQuery.trim()) { setCandidates([]); setAddLoading(false); return }
    setAddLoading(true)
    const timer = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setCandidates([]); setAddLoading(false); return }
      const { data } = await supabase
        .from('places')
        .select('id, name, city, trips!inner(destination, user_id)')
        .eq('visited', false)
        .eq('trips.user_id', user.id)
        .ilike('name', `%${addQuery.trim()}%`)
        .order('name')
        .limit(20)
      setCandidates(((data as any) || []))
      setAddLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [showAdd, addQuery])

  async function handleMarkVisited(place: Candidate) {
    await supabase.from('places').update({ visited: true }).eq('id', place.id)
    setCandidates(prev => prev.filter(p => p.id !== place.id))
    setShowAdd(false)
    fetchBeenPlaces()
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[2px]" onClick={onClose} />
      )}
      <div className={`fixed top-0 right-0 h-full w-80 bg-white/80 backdrop-blur-xl border-l border-[rgba(0,0,0,0.06)] z-50 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-5 py-5 border-b border-[rgba(0,0,0,0.06)]">
          {showAdd ? (
            <button
              onClick={() => setShowAdd(false)}
              className="flex items-center gap-1.5 text-sm font-medium text-[#0A0A0A] hover:text-[#3D5AFE] transition-colors"
            >
              <ArrowLeft size={15} strokeWidth={2} /> Back
            </button>
          ) : (
            <span className="text-lg font-semibold tracking-tight text-[#0A0A0A]">
              maptured<span className="text-[#3D5AFE]">.</span>
            </span>
          )}
          <div className="flex items-center gap-1">
            {!showAdd && (
              <button
                onClick={() => setShowAdd(true)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-[#6B6B6B] hover:text-[#0A0A0A] hover:bg-[rgba(0,0,0,0.04)] transition-all"
                aria-label="Mark a place as been here"
              >
                <Plus size={16} strokeWidth={2} />
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[#6B6B6B] hover:text-[#0A0A0A] hover:bg-[rgba(0,0,0,0.04)] transition-all"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {showAdd ? (
          <>
            <div className="px-4 pt-3 pb-2 shrink-0">
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
            <div className="flex-1 overflow-y-auto py-1">
              {!addQuery.trim() && (
                <p className="text-xs text-[#A3A3A3] text-center py-8 px-6">Type to search your saved places</p>
              )}
              {addQuery.trim() && addLoading && (
                <p className="text-xs text-[#A3A3A3] text-center py-8">Searching...</p>
              )}
              {addQuery.trim() && !addLoading && candidates.length === 0 && (
                <p className="text-xs text-[#A3A3A3] text-center py-8 px-6">No matches — it may already be marked been here.</p>
              )}
              {candidates.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleMarkVisited(c)}
                  className="w-full text-left flex items-center justify-between gap-2 px-4 py-2.5 mx-2 rounded-md hover:bg-[rgba(0,0,0,0.03)] transition-all"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#0A0A0A] truncate">{c.name}</p>
                    <p className="text-xs text-[#A3A3A3] truncate">{c.trips?.destination || c.city}</p>
                  </div>
                  <Plus size={14} strokeWidth={2} className="text-[#3D5AFE] shrink-0" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto py-2">
            {loading && (
              <p className="text-xs text-[#A3A3A3] text-center py-8">Loading...</p>
            )}
            {!loading && places.length === 0 && (
              <div className="text-center py-12 px-6">
                <Camera size={26} strokeWidth={1.5} className="mx-auto mb-3 text-[#A3A3A3]" />
                <p className="text-sm text-[#6B6B6B]">No places marked yet</p>
                <p className="text-xs text-[#A3A3A3] mt-1">Mark a saved place as &quot;been here&quot; to start your log</p>
              </div>
            )}
            {places.map((p, i) => (
              <button
                key={p.id}
                onClick={() => { onSelectTrip(p.trip_id); onClose() }}
                className="w-full text-left flex items-start gap-3 px-4 py-3 mx-2 rounded-md hover:bg-[rgba(0,0,0,0.03)] transition-all"
              >
                <span className="text-xs font-semibold text-[#A3A3A3] w-4 pt-0.5 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#0A0A0A] truncate">{p.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {p.visited_rating && (
                      <span className="flex items-center gap-0.5 text-xs text-[#3D5AFE] font-medium shrink-0">
                        <Star size={10} strokeWidth={2} className="fill-[#3D5AFE]" /> {p.visited_rating}
                      </span>
                    )}
                    <span className="text-xs text-[#A3A3A3] truncate">{p.trips?.destination || p.city}</span>
                  </div>
                  {p.visited_note && (
                    <p className="text-xs text-[#6B6B6B] mt-1 line-clamp-2 leading-relaxed">{p.visited_note}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
