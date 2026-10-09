'use client'

import { useEffect, useState } from 'react'
import { X, Star, Camera } from 'lucide-react'
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

// "Been there" ranked feed — every place across every trip the signed-in user
// has personally marked visited (see PlaceReview), sorted highest-rated first,
// Beli-style. First slice of the broader Maptured panel (saves-across-trips
// and reusable past-trip templates are later additions, same panel).
export default function MapturedPanel({ open, onClose, onSelectTrip }: {
  open: boolean; onClose: () => void; onSelectTrip: (tripId: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [places, setPlaces] = useState<BeenPlace[]>([])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    ;(async () => {
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
    })()
  }, [open])

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[2px]" onClick={onClose} />
      )}
      <div className={`fixed top-0 right-0 h-full w-80 bg-white/80 backdrop-blur-xl border-l border-[rgba(0,0,0,0.06)] z-50 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-5 py-5 border-b border-[rgba(0,0,0,0.06)]">
          <span className="text-lg font-semibold tracking-tight text-[#0A0A0A]">
            maptured<span className="text-[#3D5AFE]">.</span>
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#6B6B6B] hover:text-[#0A0A0A] hover:bg-[rgba(0,0,0,0.04)] transition-all"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

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
      </div>
    </>
  )
}
