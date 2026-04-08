'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import ItineraryEditor, { Day, recalcTimes } from './components/ItineraryEditor'
import TripsSidebar from './components/TripsSidebar'
import AddMorePlaces from './components/AddMorePlaces'

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
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Load trip from URL param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('trip')
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
    if (tripId && !isRestoringRef.current) saveItinerary(days, tripId)
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
      setItinerary(trip.itinerary)
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

  async function handleStartDateChange(date: string) {
    setStartDate(date)
    if (tripId) {
      await supabase.from('trips').update({ start_date: date || null }).eq('id', tripId)
    }
  }

  async function handleSaveTrip() {
    if (!tripId) return
    await supabase.from('trips').update({ saved: true }).eq('id', tripId)
    setTripSaved(true)
    window.history.replaceState({}, '', `?trip=${tripId}`)
  }

  async function handleExtract() {
    if (!input.trim() || !destination.trim()) return
    setLoading(true)
    setPlaces([])
    setSaved(false)
    setItinerary(null)

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

    const currentTripId = trip.id
    setTripId(currentTripId)

    const res = await fetch('/api/extract-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input, tripId: currentTripId }),
    })

    const data = await res.json()
    setPlaces(data.places || [])
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
    // Normalize: give every stop a stable id
    const normalized: Day[] = (data.days || []).map((day: any) => ({
      ...day,
      stops: day.stops.map((stop: any, i: number) => ({
        ...stop,
        id: stop.id || `${day.day}-${i}-${stop.name}`,
      })),
    }))
    if (editableDays.length > 0) snapshotAndReplace(normalized)
    else handleDaysChange(normalized)

    // Save itinerary to Supabase + put trip in URL
    await supabase.from('trips').update({ itinerary: { days: normalized } }).eq('id', tripId)
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

        {/* Inspiration input */}
        <div className="bg-white border border-[#E8DFD0] rounded-2xl p-5 mb-4 focus-within:border-[#C17B4E] transition-colors">
          <label className="block text-xs font-medium text-[#C17B4E] uppercase tracking-widest mb-3">
            Paste your inspiration
          </label>
          <textarea
            className="w-full bg-transparent outline-none text-[#2C2416] text-sm leading-relaxed resize-none placeholder:text-[#8C8070]"
            rows={5}
            placeholder={"Paste anything — links, restaurant names, notes...\n\nExample:\n- Scripps Pier for photos\n- Brunch in La Jolla\n- Sunset Cliffs\n- https://sandiego.eater.com/..."}
            value={input}
            onChange={e => setInput(e.target.value)}
          />
        </div>

        <button
          onClick={handleExtract}
          disabled={loading || !input.trim() || !destination.trim()}
          className="w-full py-4 bg-[#C17B4E] text-white rounded-xl font-medium text-sm hover:bg-[#8B5330] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Extracting places...' : 'Extract places with AI →'}
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
          <div className="grid grid-cols-1 gap-3 mb-6">
            {places.map((place, i) => (
              <div key={i} className="bg-white border border-[#E8DFD0] rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`text-xs font-medium uppercase tracking-wider mb-1 ${categoryColors[place.category] || 'text-[#8C8070]'}`}>
                      {place.category}
                    </p>
                    <p className="font-medium text-[#2C2416]">{place.name}</p>
                    {place.description && (
                      <p className="text-sm text-[#8C8070] mt-1">{place.description}</p>
                    )}
                  </div>
                  <span className="text-xs text-[#8C8070] whitespace-nowrap pt-1">{place.city}</span>
                </div>
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

      {/* Map + Itinerary */}
      {itinerary?.days && (
        <div className="w-full max-w-2xl mt-10">
          <div className="flex items-center justify-between mb-6">
            <p className="text-xs uppercase tracking-widest text-[#8C8070]">
              Your {destination} itinerary
            </p>
            <div className="flex items-center gap-2">
              {undoSnapshot && (
                <button
                  onClick={handleUndo}
                  className="text-xs px-3 py-1.5 border border-[#E8DFD0] text-[#8C8070] rounded-lg hover:border-[#C17B4E] hover:text-[#C17B4E] transition-colors"
                >
                  ↩ Undo
                </button>
              )}
              {!tripSaved ? (
                <button
                  onClick={handleSaveTrip}
                  className="text-xs px-3 py-1.5 bg-[#2C2416] text-white rounded-lg hover:bg-[#5C5040] transition-colors"
                >
                  Save trip
                </button>
              ) : (
                <span className="text-xs text-[#7A9E7E] font-medium">✓ Saved</span>
              )}
            </div>
          </div>

          {/* Date picker — available for all trips once itinerary exists */}
          {!tripSaved && (
            <div className="flex items-center gap-2 mb-6">
              <div className="flex items-center gap-1.5 bg-white border border-[#E8DFD0] rounded-xl px-3 py-1.5 focus-within:border-[#C17B4E] transition-colors">
                <span className="text-xs text-[#8C8070]">Start date:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="bg-transparent outline-none text-sm text-[#2C2416]"
                />
              </div>
              <span className="text-xs text-[#C8BFB0]">optional</span>
            </div>
          )}
          {/* Duration editor for saved trips */}
          {tripSaved && (
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
          {unscheduledPlaces.length > 0 && (
            <div className="mb-8">
              <p className="text-xs uppercase tracking-widest text-[#8C8070] mb-3">
                Also saved — didn't fit this trip
              </p>
              <div className="grid grid-cols-2 gap-2">
                {unscheduledPlaces.map((place, i) => (
                  <div key={i} className="bg-white border border-[#E8DFD0] rounded-xl p-3">
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
            </div>
          )}

          {/* Draggable day cards */}
          <ItineraryEditor days={editableDays} onChange={handleDaysChange} startDate={startDate} />
        </div>
      )}

      {/* Add more places to saved trip */}
      {tripSaved && tripId && (
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