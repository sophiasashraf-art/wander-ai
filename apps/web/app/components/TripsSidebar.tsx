'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Trip {
  id: string
  destination: string
  duration: string
  vibe: string
  created_at: string
  itinerary: any
}

interface Props {
  open: boolean
  currentTripId: string | null
  onClose: () => void
  onSelect: (tripId: string) => void
  onNew: () => void
  onDelete?: (tripId: string) => void
}

export default function TripsSidebar({ open, currentTripId, onClose, onSelect, onNew, onDelete }: Props) {
  const [trips, setTrips] = useState<Trip[]>([])
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
  }, [open])

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const vibeEmoji: Record<string, string> = {
    relaxed: '🌿',
    balanced: '⚖️',
    everything: '⚡',
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div className={`fixed top-0 left-0 h-full w-80 bg-[#FDFAF5] border-r border-[#E8DFD0] z-50 flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8DFD0]">
          <span className="font-serif text-lg text-[#2C2416]">
            mapture<span className="text-[#C17B4E]">.</span>
          </span>
          <button
            onClick={onClose}
            className="text-[#8C8070] hover:text-[#2C2416] text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* New trip button */}
        <div className="px-4 py-3 border-b border-[#E8DFD0]">
          <button
            onClick={() => { onNew(); onClose() }}
            className="w-full py-2.5 bg-[#C17B4E] text-white rounded-xl text-sm font-medium hover:bg-[#8B5330] transition-colors"
          >
            + New trip
          </button>
        </div>

        {/* Trip list */}
        <div className="flex-1 overflow-y-auto py-3">
          {loading && (
            <p className="text-xs text-[#8C8070] text-center py-8">Loading trips...</p>
          )}
          {!loading && trips.length === 0 && (
            <p className="text-xs text-[#8C8070] text-center py-8">No saved trips yet</p>
          )}
          {trips.map(trip => (
            <div
              key={trip.id}
              className={`relative group flex items-start px-4 py-3 border-b border-[#F5F0E8] last:border-0 cursor-pointer hover:bg-[#F5F0E8] transition-colors ${
                trip.id === currentTripId ? 'bg-[#FEF8F4]' : ''
              }`}
              onClick={() => { onSelect(trip.id); onClose() }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-[#2C2416] truncate">
                    {trip.destination}
                  </span>
                  {trip.id === currentTripId && (
                    <span className="text-xs text-[#C17B4E] shrink-0">current</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-[#8C8070]">
                  <span>{vibeEmoji[trip.vibe] || '✈️'}</span>
                  <span>{trip.duration}</span>
                  <span>·</span>
                  <span>{formatDate(trip.created_at)}</span>
                </div>
                {trip.itinerary?.days && (
                  <p className="text-xs text-[#7A9E7E] mt-1">
                    {trip.itinerary.days.length} days · {trip.itinerary.days.reduce((n: number, d: any) => n + d.stops.length, 0)} stops
                  </p>
                )}
              </div>
              <button
                onClick={e => handleDelete(e, trip.id)}
                className={`ml-2 shrink-0 text-xs px-2 py-1 rounded-lg transition-colors ${
                  confirmDelete === trip.id
                    ? 'bg-red-50 text-red-400 opacity-100'
                    : 'opacity-0 group-hover:opacity-100 text-[#C8BFB0] hover:text-red-400'
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
