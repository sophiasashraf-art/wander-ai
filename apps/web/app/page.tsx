'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import ItineraryEditor, { Day, recalcTimes } from './components/ItineraryEditor'
import TripsSidebar from './components/TripsSidebar'
import AddMorePlaces from './components/AddMorePlaces'
import PlaceSearch from './components/PlaceSearch'

// ── Share dropdown ──
function ShareButton({ onShare }: { onShare: (viewOnly: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs px-3 py-1.5 border border-[#E8DFD0] text-[#8C8070] rounded-lg hover:border-[#C17B4E] hover:text-[#C17B4E] transition-colors"
      >
        Share
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-white border border-[#E8DFD0] rounded-xl shadow-lg overflow-hidden z-20 w-44">
            <button
              onClick={() => { onShare(false); setOpen(false) }}
              className="w-full text-left px-4 py-2.5 text-xs text-[#2C2416] hover:bg-[#FEF8F4] transition-colors"
            >
              ✏️ Copy edit link
            </button>
            <button
              onClick={() => { onShare(true); setOpen(false) }}
              className="w-full text-left px-4 py-2.5 text-xs text-[#2C2416] hover:bg-[#FEF8F4] transition-colors border-t border-[#F5F0E8]"
            >
              👁 Copy view-only link
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const DAY_COLORS = ['#C17B4E', '#7A9E7E', '#5C8AAE', '#9B6DAB', '#B85C38']

export default function Home() {
  const [destination, setDestination] = useState('')
  const [duration, setDuration] = useState(3)
  const [vibe, setVibe] = useState<'relaxed' | 'balanced' | 'everything'>('balanced')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [places, setPlaces] = useState<any[]>([])
  const [tripId, setTripId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [tripSaved, setTripSaved] = useState(false) // saved to sidebar
  const [startDate, setStartDate] = useState('') // YYYY-MM-DD
  const [itinerary, setItinerary] = useState<any>(null)
  const [editableDays, setEditableDays] = useState<Day[]>([])
  const [undoSnapshot, setUndoSnapshot] = useState<Day[] | null>(null)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isRestoringRef = useRef(false)
  const isRemoteUpdateRef = useRef(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [viewOnly, setViewOnly] = useState(false)
  const [shareToast, setShareToast] = useState<string | null>(null)
  const [inputTab, setInputTab] = useState<'ai' | 'manual'>('ai')
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Build empty day shells for manual building
  function buildEmptyDays(numDays: number): Day[] {
    return Array.from({ length: numDays }, (_, i) => ({
      day: i + 1,
      title: `Day ${i + 1}`,
      stops: [],
    }))
  }

  // When destination + duration change and no itinerary yet, show empty days
  useEffect(() => {
    if (!tripSaved && !itinerary && destination.trim() && duration > 0) {
      setEditableDays(buildEmptyDays(duration))
    }
  }, [duration, destination, tripSaved, itinerary])

  // Load trip from URL param on mount + set up Realtime
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('trip')
    const isView = params.get('view') === '1'
    if (isView) setViewOnly(true)
    if (!id) return

    isRestoringRef.current = true
    ;(async () => {
      const { data: trip } = await supabase.from('trips').select('*').eq('id', id).single()
      if (!trip) { isRestoringRef.current = false; return }

      const { data: placesData } = await supabase.from('places').select('*').eq('trip_id', id)

      setTripId(id)
      setDestination(trip.destination || '')
      setDuration(parseInt(trip.duration) || 3)
      setVibe(trip.vibe || 'balanced')
      setPlaces(placesData || [])
      setStartDate(trip.start_date || '')

      if (trip.itinerary?.days) {
        setItinerary(trip.itinerary)
        const normalized: Day[] = trip.itinerary.days.map((day: any) => ({
          ...day,
          stops: day.stops.map((stop: any, i: number) => ({
            ...stop,
            id: stop.id || `${day.day}-${i}-${stop.name}`,
          })),
        }))
        setEditableDays(normalized)
        setSaved(true)
        setTripSaved(trip.saved || false)
      }
      isRestoringRef.current = false

      // Subscribe to real-time changes on this trip
      const channel = supabase
        .channel(`trip-${id}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'trips',
          filter: `id=eq.${id}`,
        }, payload => {
          const updated = payload.new as any
          if (!updated.itinerary?.days) return
          isRemoteUpdateRef.current = true
          const normalized: Day[] = updated.itinerary.days.map((day: any) => ({
            ...day,
            stops: day.stops.map((stop: any, i: number) => ({
              ...stop,
              id: stop.id || `${day.day}-${i}-${stop.name}`,
            })),
          }))
          setEditableDays(normalized)
          setItinerary(updated.itinerary)
          if (updated.start_date !== undefined) setStartDate(updated.start_date || '')
          setTimeout(() => { isRemoteUpdateRef.current = false }, 100)
        })
        .subscribe()

      return () => { supabase.removeChannel(channel) }
    })()
  }, [])

  // Debounced save whenever editableDays changes
  const saveItinerary = useCallback((days: Day[], id: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      await supabase.from('trips').update({ itinerary: { days } }).eq('id', id)
    }, 1000)
  }, [])

  function handleDaysChange(days: Day[]) {
    setEditableDays(days)
    if (tripId && !isRestoringRef.current && !isRemoteUpdateRef.current) saveItinerary(days, tripId)
  }

  function snapshotAndReplace(days: Day[]) {
    setUndoSnapshot(editableDays)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => setUndoSnapshot(null), 12000)
    handleDaysChange(days)
  }

  function handleUndo() {
    if (!undoSnapshot) return
    handleDaysChange(undoSnapshot)
    setUndoSnapshot(null)
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
  }

  async function loadTrip(id: string) {
    isRestoringRef.current = true
    const { data: trip } = await supabase.from('trips').select('*').eq('id', id).single()
    if (!trip) { isRestoringRef.current = false; return }
    const { data: placesData } = await supabase.from('places').select('*').eq('trip_id', id)
    setTripId(id)
    setDestination(trip.destination || '')
    setDuration(parseInt(trip.duration) || 3)
    setVibe(trip.vibe || 'balanced')
    setPlaces(placesData || [])
    setInput('')
    setSaved(true)
    setStartDate(trip.start_date || '')
    if (trip.itinerary?.days) {
      const normalized: Day[] = trip.itinerary.days.map((day: any) => ({
        ...day,
        stops: day.stops.map((stop: any, i: number) => ({
          ...stop,
          id: stop.id || `${day.day}-${i}-${stop.name}`,
        })),
      }))
      setEditableDays(normalized)
    } else {
      setItinerary(null)
      setEditableDays([])
    }
    setTripSaved(trip.saved || false)
    window.history.replaceState({}, '', `?trip=${id}`)
    isRestoringRef.current = false
  }

  function resetTrip() {
    setTripId(null)
    setDestination('')
    setDuration(3)
    setVibe('balanced')
    setInput('')
    setPlaces([])
    setSaved(false)
    setTripSaved(false)
    setStartDate('')
    setItinerary(null)
    setEditableDays([])
    window.history.replaceState({}, '', '/')
  }

  // Create trip in Supabase if not yet created (for manual place adds before extract)
  async function ensureTripCreated(): Promise<string | null> {
    if (tripId) return tripId
    if (!destination.trim()) return null
    const { data: trip, error } = await supabase
      .from('trips')
      .insert({ destination, duration: `${duration} days`, vibe })
      .select()
      .single()
    if (error || !trip) return null
    setTripId(trip.id)
    return trip.id
  }

  async function handleStartDateChange(date: string) {
    setStartDate(date)
    if (tripId) {
      await supabase.from('trips').update({ start_date: date || null }).eq('id', tripId)
    }
  }

  function shareLink(viewOnlyMode: boolean) {
    const base = `${window.location.origin}?trip=${tripId}`
    const url = viewOnlyMode ? `${base}&view=1` : base
    navigator.clipboard.writeText(url)
    setShareToast(viewOnlyMode ? 'View-only link copied' : 'Edit link copied')
    setTimeout(() => setShareToast(null), 3000)
  }

  async function handleSaveTrip() {
    if (!tripId) return
    await supabase.from('trips').update({ saved: true }).eq('id', tripId)
    setTripSaved(true)
    window.history.replaceState({}, '', `?trip=${tripId}`)
  }

  async function handleExtract() {
    if ((!input.trim() && places.length === 0) || !destination.trim()) return
    setLoading(true)
    setSaved(false)

    let currentTripId = tripId
    let isNewTrip = false

    // If destination changed from the saved trip, start fresh
    if (currentTripId) {
      const { data: existingTrip } = await supabase.from('trips').select('destination').eq('id', currentTripId).single()
      if (existingTrip && existingTrip.destination !== destination) {
        currentTripId = null
        setTripId(null)
        setPlaces([])
        setItinerary(null)
        setEditableDays([])
        isNewTrip = true
      }
    } else {
      isNewTrip = true
    }

    if (!currentTripId) {
      const { data: trip, error: tripError } = await supabase
        .from('trips')
        .insert({ destination, duration: `${duration} days`, vibe })
        .select()
        .single()
      if (tripError || !trip) {
        console.error('Failed to create trip:', tripError)
        setLoading(false)
        return
      }
      currentTripId = trip.id
      setTripId(currentTripId)
    }

    if (!input.trim()) {
      // No text to extract, just go straight to generate
      setSaved(true)
      setLoading(false)
      return
    }

    // Check if input has URLs — those need scraping via extract-places
    const hasUrls = /(https?:\/\/[^\s]+)/g.test(input)

    if (!hasUrls) {
      // Use import-itinerary for all text input — it preserves any structure/times
      // and still works fine for unstructured lists
      const importRes = await fetch('/api/import-itinerary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input, tripId: currentTripId, destination, duration }),
      })
      const importData = await importRes.json()
      if (importData.days?.length > 0) {
        const normalized = importData.days.map((day: any, i: number) => ({
          ...day,
          stops: day.stops.map((stop: any, j: number) => ({
            ...stop,
            id: `imported-${i}-${j}-${stop.name}`,
          })),
        }))
        setItinerary({ days: normalized })
        setEditableDays(normalized)
        // Update places state so map markers work
        if (importData.places?.length > 0) {
          if (isNewTrip) {
            setPlaces(importData.places)
          } else {
            setPlaces(prev => {
              const existingNames = new Set(prev.map((p: any) => p.name.toLowerCase().trim()))
              const newPlaces = importData.places.filter((p: any) => !existingNames.has(p.name.toLowerCase().trim()))
              return [...prev, ...newPlaces]
            })
          }
        }
        if (importData.startDate) setStartDate(importData.startDate)
        // Persist itinerary to Supabase
        await supabase.from('trips').update({ itinerary: { days: normalized } }).eq('id', currentTripId!)
        window.history.replaceState({}, '', `?trip=${currentTripId}`)
        setSaved(true)
        setLoading(false)
        return
      }
    }

    // Fallback: extract-places (for URLs or if import returned nothing)
    const res = await fetch('/api/extract-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input, tripId: currentTripId }),
    })

    const data = await res.json()
    const newPlaces = data.places || []
    if (isNewTrip) {
      setPlaces(newPlaces)
    } else {
      setPlaces(prev => {
        const existingNames = new Set(prev.map((p: any) => p.name.toLowerCase().trim()))
        const merged = [...prev, ...newPlaces.filter((p: any) => !existingNames.has(p.name.toLowerCase().trim()))]
        return merged
      })
    }
    setSaved(true)
    setLoading(false)
  }

  async function handleGenerateItinerary() {
    if (!tripId) {
      console.error('No tripId — please extract places first')
      return
    }
    setGenerating(true)

    await supabase
      .from('trips')
      .update({ duration: `${duration} days`, vibe })
      .eq('id', tripId)

    const res = await fetch('/api/generate-itinerary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tripId }),
    })

    const data = await res.json()
    setItinerary(data)

    // Normalize AI-generated days: give every stop a stable id
    const aiDays: Day[] = (data.days || []).map((day: any) => ({
      ...day,
      stops: day.stops.map((stop: any, i: number) => ({
        ...stop,
        id: stop.id || `${day.day}-${i}-${stop.name}`,
      })),
    }))

    // Merge with any manually-added stops, deduplicating by name
    let merged: Day[]
    if (editableDays.length > 0) {
      // Collect all manually-added stop names (case-insensitive)
      const manualStopNames = new Set(
        editableDays.flatMap(d => d.stops.map(s => s.name.toLowerCase().trim()))
      )
      // Remove AI stops that duplicate manual ones
      const dedupedAiDays = aiDays.map(aiDay => {
        const existingDay = editableDays.find(d => d.day === aiDay.day)
        const manualStops = existingDay?.stops || []
        const manualNames = new Set(manualStops.map(s => s.name.toLowerCase().trim()))
        const newAiStops = aiDay.stops.filter(
          (s: any) => !manualNames.has(s.name.toLowerCase().trim())
        )
        // Merge: manual stops first, then new AI stops, re-sort by time
        const combined = [...manualStops, ...newAiStops]
        combined.sort((a, b) => {
          const parse = (t: string) => {
            const m = t?.match(/(\d+):(\d+)\s*(AM|PM)/i)
            if (!m) return 0
            let h = parseInt(m[1]); const min = parseInt(m[2]); const p = m[3].toUpperCase()
            if (p === 'PM' && h !== 12) h += 12; if (p === 'AM' && h === 12) h = 0
            return h * 60 + min
          }
          return parse(a.time) - parse(b.time)
        })
        return { ...aiDay, stops: combined }
      })
      merged = dedupedAiDays
      snapshotAndReplace(merged)
    } else {
      merged = aiDays
      handleDaysChange(merged)
    }

    // Save itinerary to Supabase + put trip in URL
    await supabase.from('trips').update({ itinerary: { days: merged } }).eq('id', tripId)
    window.history.replaceState({}, '', `?trip=${tripId}`)

    setGenerating(false)
  }

  const categoryColors: Record<string, string> = {
    restaurant: 'text-[#C17B4E]',
    activity: 'text-[#7A9E7E]',
    stay: 'text-[#8C8070]',
    cafe: 'text-[#C17B4E]',
    neighborhood: 'text-[#5C8AAE]',
    other: 'text-[#8C8070]',
  }

  const mapMarkers = editableDays.flatMap((day: Day, dayIndex: number) =>
    day.stops
      .map((stop: any) => {
        const place = places.find(p => p.name === stop.name)
        if (!place?.lat || !place?.lng) return null
        return {
          name: stop.name,
          lat: place.lat,
          lng: place.lng,
          day: day.day,
          color: DAY_COLORS[dayIndex % DAY_COLORS.length],
        }
      })
      .filter(Boolean)
  )

  const mapCenter = mapMarkers.length > 0
    ? { lat: (mapMarkers[0] as any).lat, lng: (mapMarkers[0] as any).lng }
    : { lat: 40.7128, lng: -74.0060 }

  const scheduledNames = new Set(
    editableDays.flatMap((d: Day) => d.stops.map((s: any) => s.name))
  )
  const unscheduledPlaces = places.filter(p => !scheduledNames.has(p.name))

  return (
    <main className="min-h-screen bg-[#FDFAF5] flex flex-col items-center p-8 pt-16">

      {/* Trips sidebar */}
      <TripsSidebar
        open={sidebarOpen}
        currentTripId={tripId}
        onClose={() => setSidebarOpen(false)}
        onSelect={loadTrip}
        onNew={resetTrip}
        onDelete={id => { if (id === tripId) resetTrip() }}
      />

      {/* Hamburger */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-5 left-5 z-30 flex flex-col gap-1.5 p-2 rounded-xl hover:bg-[#F5F0E8] transition-colors"
        aria-label="Open trips"
      >
        <span className="w-5 h-0.5 bg-[#8C8070] rounded" />
        <span className="w-5 h-0.5 bg-[#8C8070] rounded" />
        <span className="w-5 h-0.5 bg-[#8C8070] rounded" />
      </button>

      <h1 className="font-serif text-4xl text-[#2C2416] mb-2">
        wander<span className="text-[#C17B4E]">.</span>ai
      </h1>
      <p className="text-[#8C8070] text-lg mb-12">
        Turn inspiration into your perfect trip
      </p>

      {/* Only show the build form when not viewing a saved trip */}
      {!tripSaved && (<>
      <div className="w-full max-w-2xl">

        {/* Destination + Duration */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-white border border-[#E8DFD0] rounded-2xl p-4 focus-within:border-[#C17B4E] transition-colors">
            <label className="block text-xs font-medium text-[#C17B4E] uppercase tracking-widest mb-2">
              Destination
            </label>
            <input
              type="text"
              className="w-full bg-transparent outline-none text-[#2C2416] text-sm placeholder:text-[#8C8070]"
              placeholder="San Diego, Lisbon, Tokyo..."
              value={destination}
              onChange={e => setDestination(e.target.value)}
            />
          </div>
          <div className="bg-white border border-[#E8DFD0] rounded-2xl p-4 focus-within:border-[#C17B4E] transition-colors">
            <label className="block text-xs font-medium text-[#C17B4E] uppercase tracking-widest mb-2">
              Duration
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={30}
                className="w-16 bg-transparent outline-none text-[#2C2416] text-sm"
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
              />
              <span className="text-sm text-[#8C8070]">days</span>
            </div>
          </div>
        </div>

        {/* Start date */}
        {mounted && <>
        <div className="flex items-center gap-2 mb-3 pl-1 flex-wrap">
          <span className="text-xs text-[#8C8070]">Start date</span>
          <input
            type="date"
            min="2026-01-01"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="bg-white border border-[#E8DFD0] rounded-xl px-3 py-1.5 outline-none text-sm text-[#2C2416] focus:border-[#C17B4E] transition-colors"
          />
          <span className="text-xs text-[#C8BFB0]">optional</span>
        </div>
        </>}

        {/* Vibe selector */}
        <div className="bg-white border border-[#E8DFD0] rounded-2xl p-4 mb-3">
          <label className="block text-xs font-medium text-[#C17B4E] uppercase tracking-widest mb-3">
            Travel style
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'relaxed', emoji: '🌿', label: 'Slow & relaxed', desc: '2-3 stops/day' },
              { key: 'balanced', emoji: '⚖️', label: 'Balanced', desc: '4 stops/day' },
              { key: 'everything', emoji: '⚡', label: 'See everything', desc: '5-6 stops/day' },
            ].map(option => (
              <button
                key={option.key}
                onClick={() => setVibe(option.key as any)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  vibe === option.key
                    ? 'border-[#C17B4E] bg-[#FEF8F4]'
                    : 'border-[#E8DFD0] hover:border-[#C17B4E]'
                }`}
              >
                <div className="text-lg mb-1">{option.emoji}</div>
                <div className="text-xs font-medium text-[#2C2416]">{option.label}</div>
                <div className="text-xs text-[#8C8070]">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Tabbed input: AI Scraper vs Manual */}
        {mounted && <div className="bg-white border border-[#E8DFD0] rounded-2xl mb-4 overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-[#E8DFD0]">
            <button
              onClick={() => setInputTab('ai')}
              className={`flex-1 py-3 text-xs font-medium uppercase tracking-widest transition-colors ${
                inputTab === 'ai'
                  ? 'text-[#C17B4E] border-b-2 border-[#C17B4E] -mb-px'
                  : 'text-[#8C8070] hover:text-[#2C2416]'
              }`}
            >
              ✨ AI Scraper
            </button>
            <button
              onClick={() => setInputTab('manual')}
              className={`flex-1 py-3 text-xs font-medium uppercase tracking-widest transition-colors ${
                inputTab === 'manual'
                  ? 'text-[#C17B4E] border-b-2 border-[#C17B4E] -mb-px'
                  : 'text-[#8C8070] hover:text-[#2C2416]'
              }`}
            >
              🔍 Add manually
            </button>
          </div>

          {/* AI tab */}
          {inputTab === 'ai' && (
            <div className="p-5">
              <p className="text-xs text-[#8C8070] mb-3">Paste links, restaurant names, or notes — AI extracts the places for you.</p>
              <textarea
                className="w-full bg-transparent outline-none text-[#2C2416] text-sm leading-relaxed resize-none placeholder:text-[#8C8070]"
                rows={5}
                placeholder={"Example:\n- Scripps Pier for photos\n- Brunch in La Jolla\n- https://sandiego.eater.com/..."}
                value={input}
                onChange={e => setInput(e.target.value)}
              />
            </div>
          )}

          {/* Manual tab */}
          {inputTab === 'manual' && (
            <div className="p-5">
              <p className="text-xs text-[#8C8070] mb-3">Search any place — it gets added to your list and fed into the itinerary generator.</p>
              {destination.trim() ? (
                <PlaceSearch
                  tripId={tripId || ''}
                  destination={destination}
                  onSaved={place => setPlaces(prev => [...prev, place])}
                  onBeforeSave={ensureTripCreated}
                />
              ) : (
                <p className="text-xs text-[#C8BFB0]">Enter a destination above first</p>
              )}
            </div>
          )}
        </div>}

        <button
          onClick={handleExtract}
          disabled={loading || (!input.trim() && places.length === 0) || !destination.trim()}
          className="w-full py-4 bg-[#C17B4E] text-white rounded-xl font-medium text-sm hover:bg-[#8B5330] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Extracting places...' : places.length > 0 ? 'Generate itinerary →' : 'Extract & generate →'}
        </button>
      </div>

      {/* Extracted places */}
      {places.length > 0 && (
        <div className="w-full max-w-2xl mt-10">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs uppercase tracking-widest text-[#8C8070]">
              Found {places.length} places
            </p>
            {saved && (
              <p className="text-xs text-[#7A9E7E] font-medium">✓ Saved to your trip</p>
            )}
          </div>
          <div className="bg-white border border-[#E8DFD0] rounded-2xl overflow-hidden mb-6">
            {places.map((place, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[#F5F0E8] last:border-0 group">
                <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#C17B4E]" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-[#2C2416] font-medium">{place.name}</span>
                  {place.city && <span className="text-xs text-[#8C8070] ml-2">{place.city}</span>}
                </div>
                <span className={`text-xs shrink-0 ${categoryColors[place.category] || 'text-[#8C8070]'}`}>
                  {place.category}
                </span>
                <button
                  onClick={() => setPlaces(prev => prev.filter((_, j) => j !== i))}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[#C8BFB0] hover:text-red-400 text-lg leading-none shrink-0"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Generate / Regenerate */}
          <div className="flex gap-3">
            <input
              type="number"
              min={1}
              max={30}
              className="w-20 bg-white border border-[#E8DFD0] rounded-xl px-3 py-4 outline-none text-[#2C2416] text-sm text-center focus:border-[#C17B4E] transition-colors"
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
            />
            <button
              onClick={handleGenerateItinerary}
              disabled={generating || !tripId}
              className="flex-1 py-4 bg-[#2C2416] text-white rounded-xl font-medium text-sm hover:bg-[#5C5040] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Building your itinerary...' : itinerary ? 'Regenerate itinerary →' : 'Generate itinerary →'}
            </button>
          </div>
        </div>
      )}
      </>)} {/* end !tripSaved */}

      {/* Manual itinerary builder — shown before generate when no itinerary yet */}
      {!tripSaved && !itinerary && destination.trim() && editableDays.length > 0 && (
        <div className="w-full max-w-2xl mt-8">
          <p className="text-xs uppercase tracking-widest text-[#8C8070] mb-4">
            Build your itinerary — or generate with AI above
          </p>
          <ItineraryEditor
            days={editableDays}
            onChange={setEditableDays}
            startDate={startDate}
            destination={destination}
          />
        </div>
      )}

      {/* Map + Itinerary */}
      {itinerary?.days && (
        <div className="w-full max-w-2xl mt-10">
          {/* Share toast */}
          {shareToast && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#2C2416] text-white text-xs px-4 py-2.5 rounded-xl shadow-lg z-50">
              {shareToast}
            </div>
          )}
          {/* View-only banner */}
          {viewOnly && (
            <div className="mb-4 px-4 py-2.5 bg-[#F5F0E8] rounded-xl text-xs text-[#8C8070] text-center">
              👁 View-only — ask the trip owner for the edit link to make changes
            </div>
          )}
          <div className="flex items-center justify-between mb-6">
            <p className="text-xs uppercase tracking-widest text-[#8C8070]">
              Your {destination} itinerary
            </p>
            <div className="flex items-center gap-2">
              {!viewOnly && undoSnapshot && (
                <button
                  onClick={handleUndo}
                  className="text-xs px-3 py-1.5 border border-[#E8DFD0] text-[#8C8070] rounded-lg hover:border-[#C17B4E] hover:text-[#C17B4E] transition-colors"
                >
                  ↩ Undo
                </button>
              )}
              {tripId && !viewOnly && (
                <ShareButton onShare={shareLink} />
              )}
              {!viewOnly && !tripSaved && (
                <button
                  onClick={handleSaveTrip}
                  className="text-xs px-3 py-1.5 bg-[#2C2416] text-white rounded-lg hover:bg-[#5C5040] transition-colors"
                >
                  Save trip
                </button>
              )}
              {!viewOnly && tripSaved && (
                <span className="text-xs text-[#7A9E7E] font-medium">✓ Saved</span>
              )}
            </div>
          </div>

          {/* Date picker — available for all trips once itinerary exists */}
          {!tripSaved && !viewOnly && (
            <div className="flex items-center gap-2 mb-6">
              <div className="flex items-center gap-1.5 bg-white border border-[#E8DFD0] rounded-xl px-3 py-1.5 focus-within:border-[#C17B4E] transition-colors">
                <span className="text-xs text-[#8C8070]">Start date:</span>
                <input
                  type="date"
                  min="2026-01-01"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="bg-transparent outline-none text-sm text-[#2C2416]"
                />
              </div>
              <span className="text-xs text-[#C8BFB0]">optional</span>
            </div>
          )}
          {/* Duration editor for saved trips */}
          {tripSaved && !viewOnly && (
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <div className="flex items-center gap-1.5 bg-white border border-[#E8DFD0] rounded-xl px-3 py-1.5">
                <span className="text-xs text-[#8C8070]">Days:</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={duration}
                  onChange={e => setDuration(Number(e.target.value))}
                  className="w-10 bg-transparent outline-none text-sm text-[#2C2416] text-center"
                />
              </div>
              <div className="flex items-center gap-1.5 bg-white border border-[#E8DFD0] rounded-xl px-3 py-1.5 focus-within:border-[#C17B4E] transition-colors">
                <span className="text-xs text-[#8C8070]">Start:</span>
                <input
                  type="date"
                  min="2026-01-01"
                  value={startDate}
                  onChange={e => handleStartDateChange(e.target.value)}
                  className="bg-transparent outline-none text-sm text-[#2C2416]"
                />
              </div>
              <button
                onClick={handleGenerateItinerary}
                disabled={generating}
                className="text-xs px-3 py-1.5 bg-[#2C2416] text-white rounded-lg hover:bg-[#5C5040] transition-colors disabled:opacity-50"
              >
                {generating ? 'Regenerating...' : 'Regenerate'}
              </button>
            </div>
          )}

          {/* Map */}
          {mapMarkers.length > 0 && (
            <div className="rounded-2xl overflow-hidden mb-8 h-80 border border-[#E8DFD0]">
              <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
                <Map
                  defaultCenter={mapCenter}
                  defaultZoom={12}
                  mapId="wander-ai-map"
                  gestureHandling="greedy"
                  disableDefaultUI={false}
                >
                  {mapMarkers.map((marker: any, i: number) => (
                    <AdvancedMarker
                      key={i}
                      position={{ lat: marker.lat, lng: marker.lng }}
                      title={marker.name}
                    >
                      <div style={{
                        background: marker.color,
                        border: '2px solid white',
                        borderRadius: '20px',
                        padding: '4px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: 'white',
                        fontSize: 11,
                        fontWeight: 600,
                        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        maxWidth: 160,
                      }}>
                        <span style={{
                          background: 'rgba(255,255,255,0.3)',
                          borderRadius: '50%',
                          width: 16,
                          height: 16,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          fontSize: 10,
                        }}>
                          {marker.day}
                        </span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {marker.name}
                        </span>
                      </div>
                    </AdvancedMarker>
                  ))}
                </Map>
              </APIProvider>
            </div>
          )}

          {/* Day legend */}
          <div className="flex gap-3 mb-6 flex-wrap">
            {editableDays.map((day: Day, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: DAY_COLORS[i % DAY_COLORS.length]
                }} />
                <span className="text-xs text-[#8C8070]">Day {day.day} — {day.title}</span>
              </div>
            ))}
          </div>

          {/* Unscheduled places */}
          {!viewOnly && tripId && (
            <div className="mb-8">
              <p className="text-xs uppercase tracking-widest text-[#8C8070] mb-3">
                Also saved — didn't fit this trip
              </p>
              <div className="mb-3">
                <PlaceSearch
                  tripId={tripId}
                  destination={destination}
                  onSaved={place => setPlaces(prev => [...prev, place])}
                />
              </div>
              {unscheduledPlaces.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {unscheduledPlaces.map((place, i) => (
                  <div key={i} className="bg-white border border-[#E8DFD0] rounded-xl p-3 group relative">
                    <button
                      onClick={async () => {
                        setPlaces(prev => prev.filter(p => p.name !== place.name))
                        await supabase.from('places').delete().eq('trip_id', tripId).eq('name', place.name)
                      }}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[#C8BFB0] hover:text-red-400 text-lg leading-none"
                      aria-label="Remove place"
                    >
                      ×
                    </button>
                    <p className="text-xs text-[#C17B4E] uppercase tracking-wider mb-1">
                      {place.category}
                    </p>
                    <p className="text-sm font-medium text-[#2C2416] mb-2">{place.name}</p>
                    <select
                      defaultValue=""
                      onChange={e => {
                        const dayIndex = parseInt(e.target.value)
                        if (isNaN(dayIndex)) return
                        const day = editableDays[dayIndex]
                        const newStop = {
                          id: `unscheduled-${Date.now()}-${place.name}`,
                          name: place.name,
                          time: '',
                          category: place.category || 'other',
                          note: place.description || '',
                          suggested: false,
                        }
                        const newDays = editableDays.map((d, i) =>
                          i === dayIndex ? { ...d, stops: recalcTimes([...d.stops, newStop]) } : d
                        )
                        handleDaysChange(newDays)
                        e.target.value = ''
                      }}
                      className="w-full text-xs bg-[#FDFAF5] border border-[#E8DFD0] rounded-lg px-2 py-1.5 text-[#8C8070] outline-none focus:border-[#C17B4E] cursor-pointer"
                    >
                      <option value="" disabled>+ Add to day...</option>
                      {editableDays.map((day, idx) => (
                        <option key={idx} value={idx}>Day {day.day} — {day.title}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              )}
            </div>
          )}

          {/* Draggable day cards */}
          <ItineraryEditor days={editableDays} onChange={handleDaysChange} startDate={startDate} viewOnly={viewOnly} destination={destination} />
        </div>
      )}

      {/* Add more places to saved trip */}
      {tripSaved && tripId && !viewOnly && (
        <AddMorePlaces
          tripId={tripId}
          onMerged={days => {
            const normalized: Day[] = days.map((day: any) => ({
              ...day,
              stops: day.stops.map((stop: any, i: number) => ({
                ...stop,
                id: stop.id || `${day.day}-${i}-${stop.name}`,
              })),
            }))
            snapshotAndReplace(normalized)
            setItinerary({ days: normalized })
          }}
        />
      )}
    </main>
  )
}