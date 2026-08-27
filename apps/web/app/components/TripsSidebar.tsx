'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { X, Compass, Leaf, Scale, Zap, Plus, Inbox, ChevronDown, MapPin } from 'lucide-react'

interface Trip {
  id: string
  destination: string
  duration: string
  vibe: string
  created_at: string
  itinerary: any
}

interface InboxCity {
  tripId: string
  city: string
  places: { name: string; category: string }[]
}

interface Props {
  open: boolean
  currentTripId: string | null
  onClose: () => void
  onSelect: (tripId: string) => void
  onNew: () => void
  onDelete?: (tripId: string) => void
  onStartFromInbox?: (tripId: string) => void
}

export default function TripsSidebar({ open, currentTripId, onClose, onSelect, onNew, onDelete, onStartFromInbox }: Props) {
  const [trips, setTrips] = useState<Trip[]>([])
  const [inboxCities, setInboxCities] = useState<InboxCity[]>([])
  const [expandedCity, setExpandedCity] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  async function handleDelete(e: React.MouseEvent, tripId: string) {
    e.stopPropagation()
    if (confirmDelete === tripId) {
      await supabase.from('places').delete().eq('trip_id', tripId)
      await supabase.from('trips').delete().eq('id', tripId)
      setTrips(prev => prev.filter(t => t.id !== tripId))
      setConfirmDelete(null)
      onDelete?.(tripId)
    } else {
      setConfirmDelete(tripId)
      setTimeout(() => setConfirmDelete(null), 3000)
    }
  }

  useEffect(() => {
    if (!open) return
    setLoading(true)
    supabase
      .from('trips')
      .select('id, destination, duration, vibe, created_at, itinerary')
      .eq('saved', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setTrips((data || []).filter((t: Trip) => t.destination))
        setLoading(false)
      })

    supabase
      .from('trips')
      .select('id, destination')
      .eq('is_inbox', true)
      .order('destination')
      .then(async ({ data: inboxTrips }) => {
        if (!inboxTrips || inboxTrips.length === 0) { setInboxCities([]); return }
        const tripIds = inboxTrips.map((t: any) => t.id)
        const { data: allPlaces } = await supabase
          .from('places')
          .select('trip_id, name, category')
          .in('trip_id', tripIds)
        setInboxCities(
          inboxTrips
            .map((t: any) => ({
              tripId: t.id,
              city: t.destination,
              places: (allPlaces || []).filter((p: any) => p.trip_id === t.id),
            }))
            .filter((c: InboxCity) => c.places.length > 0)
        )
      })
  }, [open])

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const vibeIcon: Record<string, React.ReactNode> = {
    relaxed: <Leaf size={12} strokeWidth={2} />,
    balanced: <Scale size={12} strokeWidth={2} />,
    everything: <Zap size={12} strokeWidth={2} />,
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[2px]"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div className={`fixed top-0 left-0 h-full w-80 bg-white/80 backdrop-blur-xl border-r border-[rgba(0,0,0,0.06)] z-50 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-[rgba(0,0,0,0.06)]">
          <span className="text-lg font-semibold tracking-tight text-[#0A0A0A]">
            mapture<span className="text-[#3D5AFE]">.</span>
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#6B6B6B] hover:text-[#0A0A0A] hover:bg-[rgba(0,0,0,0.04)] transition-all"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* New trip button */}
        <div className="px-4 py-4 border-b border-[rgba(0,0,0,0.06)]">
          <button
            onClick={() => { onNew(); onClose() }}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 btn-primary text-sm"
          >
            <Plus size={14} strokeWidth={2.25} /> New trip
          </button>
        </div>

        {/* Inbox — places saved via share, grouped by city, not yet a trip */}
        {inboxCities.length > 0 && (
          <div className="px-4 pt-4 pb-2 border-b border-[rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold text-[#A3A3A3] uppercase tracking-widest">
              <Inbox size={11} strokeWidth={2} />
              Inbox
            </div>
            <div className="flex flex-col gap-1">
              {inboxCities.map(c => (
                <div key={c.tripId} className="rounded-md overflow-hidden">
                  <button
                    onClick={() => setExpandedCity(prev => prev === c.tripId ? null : c.tripId)}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-[rgba(0,0,0,0.03)] transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <MapPin size={12} strokeWidth={2} className="text-[#3D5AFE] shrink-0" />
                      <span className="text-sm text-[#0A0A0A] font-medium truncate">{c.city}</span>
                      <span className="text-xs text-[#A3A3A3] shrink-0">{c.places.length}</span>
                    </span>
                    <ChevronDown size={13} strokeWidth={2} className={`text-[#A3A3A3] shrink-0 transition-transform ${expandedCity === c.tripId ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedCity === c.tripId && (
                    <div className="px-2.5 pb-2.5">
                      <div className="flex flex-col gap-1 mb-2">
                        {c.places.map((p, i) => (
                          <p key={i} className="text-xs text-[#6B6B6B] truncate pl-5">{p.name}</p>
                        ))}
                      </div>
                      <button
                        onClick={() => { onStartFromInbox?.(c.tripId); onClose() }}
                        className="ml-5 text-xs font-medium text-[#3D5AFE] hover:text-[#2E45D6] transition-colors"
                      >
                        Start a trip from these →
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trip list */}
        <div className="flex-1 overflow-y-auto py-2">
          {loading && (
            <p className="text-xs text-[#A3A3A3] text-center py-8">Loading trips...</p>
          )}
          {!loading && trips.length === 0 && (
            <div className="text-center py-12 px-6">
              <Compass size={26} strokeWidth={1.5} className="mx-auto mb-3 text-[#A3A3A3]" />
              <p className="text-sm text-[#6B6B6B]">No saved trips yet</p>
              <p className="text-xs text-[#A3A3A3] mt-1">Create your first trip to see it here</p>
            </div>
          )}
          {trips.map(trip => (
            <div
              key={trip.id}
              className={`relative group flex items-start px-4 py-3.5 mx-2 rounded-md cursor-pointer transition-all ${
                trip.id === currentTripId
                  ? 'bg-[#EEF0FF] border border-[#3D5AFE]/20'
                  : 'hover:bg-[rgba(0,0,0,0.03)] border border-transparent'
              }`}
              onClick={() => { onSelect(trip.id); onClose() }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-[#0A0A0A] truncate">
                    {trip.destination}
                  </span>
                  {trip.id === currentTripId && (
                    <span className="text-[10px] font-semibold text-[#3D5AFE] bg-[#3D5AFE]/10 px-1.5 py-0.5 rounded-md shrink-0 uppercase tracking-wide">active</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-[#6B6B6B]">
                  <span className="text-[#A3A3A3]">{vibeIcon[trip.vibe] || <Compass size={12} strokeWidth={2} />}</span>
                  <span>{trip.duration}</span>
                  <span className="text-[#A3A3A3]">·</span>
                  <span className="text-[#A3A3A3]">{formatDate(trip.created_at)}</span>
                </div>
                {trip.itinerary?.days && (
                  <p className="text-[11px] text-[#6B6B6B] mt-1.5 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#7A9E7E]"></span>
                    {trip.itinerary.days.length} days · {trip.itinerary.days.reduce((n: number, d: any) => n + d.stops.length, 0)} stops
                  </p>
                )}
              </div>
              <button
                onClick={e => handleDelete(e, trip.id)}
                className={`ml-2 shrink-0 text-xs px-2 py-1 rounded-lg transition-all ${
                  confirmDelete === trip.id
                    ? 'bg-red-50 text-red-500 opacity-100 font-medium'
                    : 'opacity-0 group-hover:opacity-100 text-[#A3A3A3] hover:text-red-400 hover:bg-red-50'
                }`}
              >
                {confirmDelete === trip.id ? 'confirm?' : '×'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
