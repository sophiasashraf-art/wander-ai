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
          className="fixed inset-0 bg-black/30 z-40 backdrop-blur-[2px]"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div className={`fixed top-0 left-0 h-full w-80 bg-white/80 backdrop-blur-xl border-r border-[rgba(0,0,0,0.06)] z-50 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-[rgba(0,0,0,0.06)]">
          <span className="text-lg font-semibold tracking-tight text-[#1A1A1A]">
            mapture<span className="text-[#E07A4C]">.</span>
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#6B6B6B] hover:text-[#1A1A1A] hover:bg-[rgba(0,0,0,0.04)] transition-all text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* New trip button */}
        <div className="px-4 py-4 border-b border-[rgba(0,0,0,0.06)]">
          <button
            onClick={() => { onNew(); onClose() }}
            className="w-full py-2.5 btn-primary text-sm"
          >
            + New trip
          </button>
        </div>

        {/* Trip list */}
        <div className="flex-1 overflow-y-auto py-2">
          {loading && (
            <p className="text-xs text-[#A3A3A3] text-center py-8">Loading trips...</p>
          )}
          {!loading && trips.length === 0 && (
            <div className="text-center py-12 px-6">
              <p className="text-2xl mb-2">✈️</p>
              <p className="text-sm text-[#6B6B6B]">No saved trips yet</p>
              <p className="text-xs text-[#A3A3A3] mt-1">Create your first trip to see it here</p>
            </div>
          )}
          {trips.map(trip => (
            <div
              key={trip.id}
              className={`relative group flex items-start px-4 py-3.5 mx-2 rounded-xl cursor-pointer transition-all ${
                trip.id === currentTripId
                  ? 'bg-[#FFF4EF] border border-[#E07A4C]/20'
                  : 'hover:bg-[rgba(0,0,0,0.03)] border border-transparent'
              }`}
              onClick={() => { onSelect(trip.id); onClose() }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-[#1A1A1A] truncate">
                    {trip.destination}
                  </span>
                  {trip.id === currentTripId && (
                    <span className="text-[10px] font-semibold text-[#E07A4C] bg-[#E07A4C]/10 px-1.5 py-0.5 rounded-md shrink-0 uppercase tracking-wide">active</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-[#6B6B6B]">
                  <span>{vibeEmoji[trip.vibe] || '✈️'}</span>
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
