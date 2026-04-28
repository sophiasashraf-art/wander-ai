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

// ── Place popup for extracted places list ──
function PlaceListPopup({ name, destination, anchorRect, onClose }: {
  name: string; destination: string; anchorRect: DOMRect; onClose: () => void
}) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + (destination ? ` ${destination}` : ''))}`
  const POPUP_W = 260
  const POPUP_H = 280
  const viewW = window.innerWidth
  const viewH = window.innerHeight
  let left = anchorRect.right + 8
  if (left + POPUP_W > viewW - 12) left = anchorRect.left - POPUP_W - 8
  let top = anchorRect.top
  if (top + POPUP_H > viewH - 12) top = viewH - POPUP_H - 12

  const [fetched, setFetched] = useState<any>(null)
  const [fetchLoading, setFetchLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/place-search?name=${encodeURIComponent(name)}&location=${encodeURIComponent(destination)}`)
      .then(r => r.json())
      .then(data => { if (data.result) setFetched(data.result) })
      .catch(() => {})
      .finally(() => setFetchLoading(false))
  }, [name, destination])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const photoUrl = fetched?.photo_reference ? `/api/place-photo?ref=${encodeURIComponent(fetched.photo_reference)}` : null
  const priceStr = fetched?.price_level != null ? '$'.repeat(fetched.price_level + 1) : null

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white border border-[#E8DFD0] rounded-2xl shadow-2xl overflow-hidden"
        style={{ left, top, width: POPUP_W }}
        onClick={e => e.stopPropagation()}
      >
        {fetchLoading ? (
          <div className="w-full flex items-center justify-center bg-[#F5F0E8]" style={{ height: 100 }}>
            <span className="text-xs text-[#C8BFB0]">Loading...</span>
          </div>
        ) : photoUrl ? (
          <img src={photoUrl} alt={name} className="w-full object-cover" style={{ height: 140 }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <div className="w-full flex items-center justify-center bg-[#F5F0E8]" style={{ height: 80 }}>
            <span className="text-3xl">📍</span>
          </div>
        )}
        <div className="p-3">
          <p className="text-sm font-semibold text-[#2C2416] leading-snug">{name}</p>
          {(fetched?.rating || priceStr) && (
            <div className="flex items-center gap-2 mt-0.5">
              {fetched?.rating && <span className="text-xs text-[#8C8070]">⭐ {fetched.rating.toFixed(1)}</span>}
              {priceStr && <span className="text-xs text-[#8C8070]">{priceStr}</span>}
            </div>
          )}
          {fetched?.address && <p className="text-xs text-[#C8BFB0] mt-0.5 truncate">{fetched.address}</p>}
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1 text-xs text-[#C17B4E] hover:text-[#8B5330] font-medium transition-colors">
            Open in Google Maps ↗
          </a>
        </div>
      </div>
    </>
  )
}

// ── Place list item with popup ──
function PlaceListItem({ place, destination, categoryColors, onRemove }: {
  place: any; destination: string
  categoryColors: Record<string, string>; onRemove: () => void
}) {
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const isGeolocated = !!(place.lat && place.lng)

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#F5F0E8] last:border-0 group relative">
      <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#C17B4E]" />
      <div className="flex-1 min-w-0">
        {isGeolocated ? (
          <button
            onClick={e => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setAnchorRect(prev => prev ? null : rect)
            }}
            className="text-sm text-[#2C2416] font-medium hover:text-[#C17B4E] transition-colors text-left"
          >
            {place.name}
          </button>
        ) : (
          <span className="text-sm text-[#2C2416] font-medium">{place.name}</span>
        )}
        {place.city && <span className="text-xs text-[#8C8070] ml-2">{place.city}</span>}
      </div>
      <span className={`text-xs shrink-0 ${categoryColors[place.category] || 'text-[#8C8070]'}`}>
        {place.category}
      </span>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-[#C8BFB0] hover:text-red-400 text-lg leading-none shrink-0"
      >
        ×
      </button>
      {anchorRect && (
        <PlaceListPopup
          name={place.name}
          destination={destination}
          anchorRect={anchorRect}
          onClose={() => setAnchorRect(null)}
        />
      )}
    </div>
  )
}

// ── Image upload for AI scraper ──
function ImageUpload({ onExtracted }: { onExtracted: (text: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [previews, setPreviews] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  async function processFiles(files: File[]) {
    const images = files.filter(f => f.type.startsWith('image/'))
    if (!images.length) return
    setPreviews(prev => [...prev, ...images.map(f => URL.createObjectURL(f))])
    setLoading(true)
    try {
      const results = await Promise.all(
        images.map(async file => {
          const fd = new FormData()
          fd.append('image', file)
          const res = await fetch('/api/extract-from-image', { method: 'POST', body: fd })
          const data = await res.json()
          return data.text?.trim() || ''
        })
      )
      const combined = results.filter(Boolean).join('\n')
      if (combined) onExtracted(combined)
    } catch {}
    setLoading(false)
  }

  return (
    <div className="mt-3">
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); processFiles(Array.from(e.dataTransfer.files)) }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl px-4 py-3 cursor-pointer transition-colors ${
          dragOver ? 'border-[#C17B4E] bg-[#FEF8F4]' : 'border-[#E8DFD0] hover:border-[#C17B4E] hover:bg-[#FEF8F4]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files?.length) processFiles(Array.from(e.target.files)) }}
        />
        {previews.length > 0 ? (
          <div className="flex items-center gap-2 flex-wrap">
            {previews.map((src, i) => (
              <img key={i} src={src} alt="" className="w-10 h-10 object-cover rounded-lg shrink-0" />
            ))}
            <span className="text-xs text-[#8C8070]">
              {loading ? 'Reading images...' : `✓ ${previews.length} image${previews.length > 1 ? 's' : ''} extracted — click to add more`}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-lg">📷</span>
            <span className="text-xs text-[#8C8070]">
              {loading ? 'Reading image...' : 'Drop screenshots or click to upload — select multiple at once'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

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
  const [buildMode, setBuildMode] = useState<'ai' | 'build'>('ai')
  const [tripMode, setTripMode] = useState<'single' | 'multi'>('single')
  const [cities, setCities] = useState<{ name: string; days: number }[]>([{ name: '', days: 2 }])
  const [arrivalTime, setArrivalTime] = useState('')   // e.g. "14:00"
  const [departureTime, setDepartureTime] = useState('') // e.g. "11:00"
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
  // But don't overwrite days that already have manually-entered stops
  useEffect(() => {
    if (!tripSaved && !itinerary && destination.trim() && duration > 0) {
      setEditableDays(prev => {
        const hasManualStops = prev.some(d => d.stops.length > 0)
        if (hasManualStops) {
          // Just resize: add/remove days without touching existing stops
          if (prev.length === duration) return prev
          if (prev.length < duration) {
            return [...prev, ...Array.from({ length: duration - prev.length }, (_, i) => ({
              day: prev.length + i + 1, title: `Day ${prev.length + i + 1}`, stops: [],
            }))]
          }
          return prev.slice(0, duration)
        }
        return buildEmptyDays(duration)
      })
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

      // Restore multi-city mode if destination contains →
      if (trip.destination?.includes('→')) {
        setTripMode('multi')
        const parts = trip.destination.split('→').map((s: string) => s.trim()).filter(Boolean)
        const totalDays = parseInt(trip.duration) || parts.length * 2
        const daysEach = Math.max(1, Math.floor(totalDays / parts.length))
        setCities(parts.map((name: string, i: number) => ({
          name,
          days: i === parts.length - 1 ? totalDays - daysEach * (parts.length - 1) : daysEach,
        })))
      }

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

    // Restore multi-city mode if destination contains →
    if (trip.destination?.includes('→')) {
      setTripMode('multi')
      const parts = trip.destination.split('→').map((s: string) => s.trim()).filter(Boolean)
      const totalDays = parseInt(trip.duration) || parts.length * 2
      const daysEach = Math.max(1, Math.floor(totalDays / parts.length))
      setCities(parts.map((name: string, i: number) => ({
        name,
        days: i === parts.length - 1 ? totalDays - daysEach * (parts.length - 1) : daysEach,
      })))
    } else {
      setTripMode('single')
    }
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
    const hasDestination = tripMode === 'multi'
      ? cities.some(c => c.name.trim())
      : destination.trim()
    if ((!input.trim() && places.length === 0) || !hasDestination) return
    setLoading(true)
    setSaved(false)

    // Capture manual stops before any async operations
    const currentDays = editableDays

    let currentTripId = tripId
    let isNewTrip = false

    // Resolve effective destination label
    const effectiveDestination = tripMode === 'multi'
      ? cities.filter(c => c.name.trim()).map(c => c.name).join(', ')
      : destination
    const effectiveDuration = tripMode === 'multi'
      ? cities.reduce((s, c) => s + (c.days || 0), 0)
      : duration

    // If destination changed from the saved trip, start fresh
    if (currentTripId) {
      const { data: existingTrip } = await supabase.from('trips').select('destination').eq('id', currentTripId).single()
      if (existingTrip && existingTrip.destination !== effectiveDestination) {
        currentTripId = null
        setTripId(null)
        setPlaces([])
        setItinerary(null)
        setEditableDays(buildEmptyDays(effectiveDuration))
        isNewTrip = true
      }
    } else {
      isNewTrip = true
    }

    if (!currentTripId) {
      const { data: trip, error: tripError } = await supabase
        .from('trips')
        .insert({ destination: effectiveDestination, duration: `${effectiveDuration} days`, vibe })
        .select()
        .single()
      if (tripError || !trip) {
        console.error('Failed to create trip:', tripError)
        setLoading(false)
        return
      }
      currentTripId = trip.id
      setTripId(currentTripId)
      if (tripMode === 'multi') {
        setDestination(effectiveDestination)
        setDuration(effectiveDuration)
      }
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
        body: JSON.stringify({ text: input, tripId: currentTripId, destination: effectiveDestination, duration: effectiveDuration }),
      })
      const importData = await importRes.json()
      if (importData.days?.length > 0) {
        const normalized: Day[] = importData.days.map((day: any, i: number) => ({
          ...day,
          stops: day.stops.map((stop: any, j: number) => ({
            ...stop,
            id: `imported-${i}-${j}-${stop.name}`,
          })),
        }))
        // If the API redistributed an unstructured list, use it as-is (full replace)
        // Otherwise merge with any manually-entered stops
        const finalDays = importData.redistributed
          ? normalized
          : mergeIntoExisting(normalized, currentDays)
        setItinerary({ days: finalDays })
        if (currentDays.some(d => d.stops.length > 0)) snapshotAndReplace(finalDays)
        else handleDaysChange(finalDays)
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
        // Only use extracted date if user hasn't set one and it's a valid future date (2026+)
        if (importData.startDate && !startDate && importData.startDate >= '2026-01-01') {
          setStartDate(importData.startDate)
        }
        await supabase.from('trips').update({ itinerary: { days: finalDays } }).eq('id', currentTripId!)
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

  // Merge incoming days into existing editableDays, preserving manual stops and their times
  function mergeIntoExisting(incomingDays: Day[], existing: Day[]): Day[] {
    if (existing.length === 0) return incomingDays
    return incomingDays.map(incomingDay => {
      const existingDay = existing.find(d => d.day === incomingDay.day)
      const manualStops = existingDay?.stops || []
      const manualNames = new Set(manualStops.map(s => s.name.toLowerCase().trim()))
      // Only add AI stops that aren't already manually entered
      const newAiStops = incomingDay.stops.filter(
        (s: any) => !manualNames.has(s.name.toLowerCase().trim())
      )
      // Manual stops go first (preserving their order and times), AI stops appended after
      // Sort only the AI stops among themselves, don't re-sort manual stops
      const parseMin = (t: string) => {
        const m = t?.match(/(\d+):(\d+)\s*(AM|PM)/i)
        if (!m) return 0
        let h = parseInt(m[1]); const min = parseInt(m[2]); const p = m[3].toUpperCase()
        if (p === 'PM' && h !== 12) h += 12; if (p === 'AM' && h === 12) h = 0
        return h * 60 + min
      }
      newAiStops.sort((a: any, b: any) => parseMin(a.time) - parseMin(b.time))
      return { ...incomingDay, stops: [...manualStops, ...newAiStops] }
    })
  }

  async function handleGenerateItinerary() {
    if (!tripId) {
      console.error('No tripId — please extract places first')
      return
    }
    setGenerating(true)

    // Capture current manual stops before any async operations
    const currentDays = editableDays

    await supabase
      .from('trips')
      .update({ duration: `${duration} days`, vibe })
      .eq('id', tripId)

    const res = await fetch('/api/generate-itinerary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tripId, arrivalTime: arrivalTime || undefined, departureTime: departureTime || undefined }),
    })

    const data = await res.json()

    // If generate returned no days (e.g. no geocoded places in Supabase),
    // keep the existing itinerary — the user already has their work
    if (!data.days?.length) {
      setGenerating(false)
      return
    }

    setItinerary(data)

    // Normalize AI-generated days: give every stop a stable id
    const aiDays: Day[] = (data.days || []).map((day: any) => ({
      ...day,
      stops: day.stops.map((stop: any, i: number) => ({
        ...stop,
        id: stop.id || `${day.day}-${i}-${stop.name}`,
      })),
    }))

    // If user already has a working itinerary, only add NEW places — never touch existing stops
    const hasExistingWork = currentDays.some(d => d.stops.length > 0)
    const isRegenerate = !!itinerary // user already had an itinerary before clicking

    let finalDays: Day[]
    if (hasExistingWork && !isRegenerate) {
      // First-time generate with manual pre-work: merge AI output with manual stops
      const existingNames = new Set(
        currentDays.flatMap(d => d.stops.map(s => s.name.toLowerCase().trim()))
      )
      const newAiStops = aiDays.flatMap(d => d.stops).filter(
        (s: any) => !existingNames.has(s.name.toLowerCase().trim())
      )
      if (newAiStops.length === 0) {
        finalDays = currentDays
      } else {
        finalDays = currentDays.map((existingDay) => {
          const matchingAiDay = aiDays.find(d => d.day === existingDay.day)
          if (!matchingAiDay) return existingDay
          const newForThisDay = matchingAiDay.stops.filter(
            (s: any) => !existingNames.has(s.name.toLowerCase().trim())
          )
          if (newForThisDay.length === 0) return existingDay
          const combined = [...existingDay.stops, ...newForThisDay]
          combined.sort((a, b) => {
            const parseMin = (t: string) => {
              const m = t?.match(/(\d+):(\d+)\s*(AM|PM)/i)
              if (!m) return 0
              let h = parseInt(m[1]); const min = parseInt(m[2]); const p = m[3].toUpperCase()
              if (p === 'PM' && h !== 12) h += 12; if (p === 'AM' && h === 12) h = 0
              return h * 60 + min
            }
            return parseMin(a.time) - parseMin(b.time)
          })
          return { ...existingDay, stops: combined }
        })
      }
      snapshotAndReplace(finalDays)
    } else {
      // Regenerate or first generate with no manual work — use AI output as-is
      finalDays = aiDays
      if (currentDays.some(d => d.stops.length > 0)) snapshotAndReplace(finalDays)
      else handleDaysChange(finalDays)
    }

    // Save itinerary to Supabase + put trip in URL
    await supabase.from('trips').update({ itinerary: { days: finalDays } }).eq('id', tripId)
    window.history.replaceState({}, '', `?trip=${tripId}`)

    setGenerating(false)
  }

  async function handleGenerateMultiCity() {
    const validCities = cities.filter(c => c.name.trim())
    if (!validCities.length) return
    setGenerating(true)

    // Create trip if needed
    let currentTripId = tripId
    if (!currentTripId) {
      const label = validCities.map(c => c.name).join(' → ')
      const totalDays = validCities.reduce((s, c) => s + c.days, 0)
      const { data: trip } = await supabase
        .from('trips')
        .insert({ destination: label, duration: `${totalDays} days`, vibe })
        .select().single()
      if (trip) {
        currentTripId = trip.id
        setTripId(trip.id)
      }
    } else {
      const label = validCities.map(c => c.name).join(' → ')
      const totalDays = validCities.reduce((s, c) => s + c.days, 0)
      await supabase.from('trips').update({ destination: label, duration: `${totalDays} days`, vibe }).eq('id', currentTripId)
      setDestination(label)
      setDuration(totalDays)
    }

    const res = await fetch('/api/generate-multi-city', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cities: validCities, vibe, text: input || undefined, tripId: currentTripId, arrivalTime: arrivalTime || undefined, departureTime: departureTime || undefined }),
    })
    const data = await res.json()
    if (!data.days?.length) { setGenerating(false); return }

    const normalized = data.days.map((day: any) => ({
      ...day,
      stops: day.stops.map((stop: any, i: number) => ({
        ...stop,
        id: stop.id || `${day.day}-${i}-${stop.name}`,
      })),
    }))

    setItinerary({ days: normalized })
    setEditableDays(normalized)
    setDestination(validCities.map(c => c.name).join(' → '))
    setDuration(validCities.reduce((s, c) => s + c.days, 0))
    if (currentTripId) {
      window.history.replaceState({}, '', `?trip=${currentTripId}`)
    }
    setGenerating(false)
  }

  function exportToICS() {
    if (!editableDays.length) return

    // Fall back to today if no start date set
    const baseDate = startDate || new Date().toISOString().slice(0, 10)

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//mapture//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ]

    function parseTimeToHHMM(time: string): string {
      const m = time?.match(/(\d+):(\d+)\s*(AM|PM)/i)
      if (!m) return '090000'
      let h = parseInt(m[1]); const min = parseInt(m[2])
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0
      return `${String(h).padStart(2,'0')}${String(min).padStart(2,'0')}00`
    }

    function dateStr(dayIndex: number, timeHHMM: string): string {
      const d = new Date(baseDate + 'T00:00:00')
      d.setDate(d.getDate() + dayIndex)
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${yyyy}${mm}${dd}T${timeHHMM}`
    }

    editableDays.forEach((day, dayIndex) => {
      day.stops.forEach(stop => {
        const startHHMM = parseTimeToHHMM(stop.time)
        // Default duration: 1 hour
        const startMinutes = parseInt(startHHMM.slice(0,2)) * 60 + parseInt(startHHMM.slice(2,4))
        const endMinutes = startMinutes + 60
        const endH = Math.floor(endMinutes / 60) % 24
        const endM = endMinutes % 60
        const endHHMM = `${String(endH).padStart(2,'0')}${String(endM).padStart(2,'0')}00`

        const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@mapture`
        const mapsUrl = stop.lat && stop.lng
          ? `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name + ' ' + destination)}`

        const description = [
          stop.note,
          stop.address,
          mapsUrl,
        ].filter(Boolean).join('\\n')

        lines.push('BEGIN:VEVENT')
        lines.push(`UID:${uid}`)
        lines.push(`DTSTART:${dateStr(dayIndex, startHHMM)}`)
        lines.push(`DTEND:${dateStr(dayIndex, endHHMM)}`)
        lines.push(`SUMMARY:${stop.name}`)
        if (description) lines.push(`DESCRIPTION:${description}`)
        if (stop.address) lines.push(`LOCATION:${stop.address.replace(/,/g, '\\,')}`)
        lines.push('END:VEVENT')
      })
    })

    lines.push('END:VCALENDAR')

    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${destination.replace(/\s+/g, '-').toLowerCase()}-itinerary.ics`
    a.click()
    URL.revokeObjectURL(url)
  }

  const canExport = editableDays.some(d => d.stops.length > 0)

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
        // First check if the stop itself has coordinates (from import-itinerary enrichment)
        const lat = stop.lat ?? places.find((p: any) => p.name.toLowerCase().trim() === stop.name.toLowerCase().trim())?.lat
        const lng = stop.lng ?? places.find((p: any) => p.name.toLowerCase().trim() === stop.name.toLowerCase().trim())?.lng
        if (!lat || !lng) return null
        return {
          name: stop.name,
          lat,
          lng,
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
        mapture<span className="text-[#C17B4E]">.</span>
      </h1>
      <p className="text-[#8C8070] text-lg mb-12">
        Turn inspiration into your perfect trip
      </p>

      {/* Only show the build form when not viewing a saved trip */}
      {!tripSaved && (<>
      <div className="w-full max-w-2xl">

        {/* Trip mode toggle */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setTripMode('single')}
            className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all ${tripMode === 'single' ? 'border-[#C17B4E] bg-[#FEF8F4] text-[#C17B4E]' : 'border-[#E8DFD0] text-[#8C8070] hover:border-[#C17B4E]'}`}
          >
            📍 Single destination
          </button>
          <button
            onClick={() => setTripMode('multi')}
            className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all ${tripMode === 'multi' ? 'border-[#C17B4E] bg-[#FEF8F4] text-[#C17B4E]' : 'border-[#E8DFD0] text-[#8C8070] hover:border-[#C17B4E]'}`}
          >
            🗺️ Multi-city / Road trip
          </button>
        </div>

        {/* Destination + Duration */}
        {tripMode === 'single' && (
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
        )}

        {/* Multi-city builder */}
        {tripMode === 'multi' && (
        <div className="bg-white border border-[#E8DFD0] rounded-2xl p-4 mb-3">
          <label className="block text-xs font-medium text-[#C17B4E] uppercase tracking-widest mb-3">
            Cities &amp; days
          </label>
          <div className="flex flex-col gap-2">
            {cities.map((city, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-[#C8BFB0] w-4 shrink-0">{i + 1}.</span>
                <input
                  type="text"
                  placeholder="City or country..."
                  value={city.name}
                  onChange={e => setCities(prev => prev.map((c, j) => j === i ? { ...c, name: e.target.value } : c))}
                  className="flex-1 bg-[#FDFAF5] border border-[#E8DFD0] rounded-xl px-3 py-2 text-sm text-[#2C2416] outline-none focus:border-[#C17B4E] transition-colors placeholder:text-[#C8BFB0]"
                />
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={city.days}
                  onChange={e => setCities(prev => prev.map((c, j) => j === i ? { ...c, days: Number(e.target.value) } : c))}
                  className="w-12 bg-[#FDFAF5] border border-[#E8DFD0] rounded-xl px-2 py-2 text-sm text-[#2C2416] outline-none focus:border-[#C17B4E] transition-colors text-center"
                />
                <span className="text-xs text-[#8C8070] shrink-0">days</span>
                {cities.length > 1 && (
                  <button
                    onClick={() => setCities(prev => prev.filter((_, j) => j !== i))}
                    className="text-[#C8BFB0] hover:text-red-400 text-lg leading-none shrink-0"
                  >×</button>
                )}
              </div>
            ))}
            <button
              onClick={() => setCities(prev => [...prev, { name: '', days: 2 }])}
              className="text-xs text-[#C17B4E] hover:text-[#8B5330] text-left mt-1 transition-colors"
            >
              + Add city
            </button>
          </div>
          <div className="mt-3 pt-3 border-t border-[#F5F0E8] flex items-center gap-2 text-xs text-[#8C8070]">
            <span>Total:</span>
            <span className="font-medium text-[#2C2416]">{cities.reduce((s, c) => s + (c.days || 0), 0)} days</span>
            <span>·</span>
            <span>{cities.filter(c => c.name.trim()).length} cities</span>
          </div>
        </div>
        )}

        {/* Start date + arrival/departure */}
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
          <span className="text-xs text-[#C8BFB0] mx-1">·</span>
          <span className="text-xs text-[#C8BFB0]">arrive</span>
          <input
            type="time"
            value={arrivalTime}
            onChange={e => setArrivalTime(e.target.value)}
            className="bg-transparent border-b border-[#E8DFD0] outline-none text-xs text-[#8C8070] focus:border-[#C17B4E] transition-colors w-20 py-0.5"
          />
          <span className="text-xs text-[#C8BFB0]">depart</span>
          <input
            type="time"
            value={departureTime}
            onChange={e => setDepartureTime(e.target.value)}
            className="bg-transparent border-b border-[#E8DFD0] outline-none text-xs text-[#8C8070] focus:border-[#C17B4E] transition-colors w-20 py-0.5"
          />
          <span className="text-xs text-[#C8BFB0]">optional</span>
        </div>
        </>}

        {/* Vibe selector */}
        <div className="bg-white border border-[#E8DFD0] rounded-2xl p-4 mb-3 focus-within:border-[#C17B4E] transition-colors">
          <label className="block text-xs font-medium text-[#C17B4E] uppercase tracking-widest mb-2">
            Travel style
          </label>
          <select
            value={vibe}
            onChange={e => setVibe(e.target.value as any)}
            className="w-full bg-transparent outline-none text-sm text-[#2C2416] cursor-pointer"
          >
            <option value="relaxed">🌿 Slow &amp; relaxed — 2-3 stops/day</option>
            <option value="balanced">⚖️ Balanced — 4 stops/day</option>
            <option value="everything">⚡ See everything — 5-6 stops/day</option>
          </select>
        </div>

        {/* Mode picker */}
        {mounted && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              onClick={() => setBuildMode('ai')}
              className={`p-4 rounded-2xl border text-left transition-all ${
                buildMode === 'ai'
                  ? 'border-[#C17B4E] bg-[#FEF8F4]'
                  : 'border-[#E8DFD0] bg-white hover:border-[#C17B4E]'
              }`}
            >
              <div className="text-xl mb-1">✨</div>
              <div className="text-xs font-medium text-[#2C2416]">AI Scraper</div>
              <div className="text-xs text-[#8C8070] mt-0.5">Paste links or notes, AI builds it</div>
            </button>
            <button
              onClick={() => setBuildMode('build')}
              className={`p-4 rounded-2xl border text-left transition-all ${
                buildMode === 'build'
                  ? 'border-[#C17B4E] bg-[#FEF8F4]'
                  : 'border-[#E8DFD0] bg-white hover:border-[#C17B4E]'
              }`}
            >
              <div className="text-xl mb-1">🗓️</div>
              <div className="text-xs font-medium text-[#2C2416]">Build your own</div>
              <div className="text-xs text-[#8C8070] mt-0.5">Add places day by day yourself</div>
            </button>
          </div>
        )}

        {/* AI Scraper mode */}
        {mounted && buildMode === 'ai' && (
          <div className="bg-white border border-[#E8DFD0] rounded-2xl mb-4 overflow-hidden">
            <div className="flex border-b border-[#E8DFD0]">
              <button
                onClick={() => setInputTab('ai')}
                className={`flex-1 py-3 text-xs font-medium uppercase tracking-widest transition-colors ${
                  inputTab === 'ai'
                    ? 'text-[#C17B4E] border-b-2 border-[#C17B4E] -mb-px'
                    : 'text-[#8C8070] hover:text-[#2C2416]'
                }`}
              >
                ✨ Paste & extract
              </button>
              <button
                onClick={() => setInputTab('manual')}
                className={`flex-1 py-3 text-xs font-medium uppercase tracking-widest transition-colors ${
                  inputTab === 'manual'
                    ? 'text-[#C17B4E] border-b-2 border-[#C17B4E] -mb-px'
                    : 'text-[#8C8070] hover:text-[#2C2416]'
                }`}
              >
                🔍 Search a place
              </button>
            </div>
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
                {/* Image upload */}
                <ImageUpload onExtracted={text => setInput(prev => prev ? `${prev}\n${text}` : text)} />
              </div>
            )}
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
          </div>
        )}

        {/* AI mode extract button */}
        {mounted && buildMode === 'ai' && (
          <button
            onClick={handleExtract}
            disabled={loading || (!input.trim() && places.length === 0) || (tripMode === 'single' ? !destination.trim() : !cities.some(c => c.name.trim()))}
            className="w-full py-4 bg-[#C17B4E] text-white rounded-xl font-medium text-sm hover:bg-[#8B5330] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Extracting places...' : places.length > 0 ? 'Generate itinerary →' : 'Extract & generate →'}
          </button>
        )}

        {/* Build your own mode — inline itinerary editor */}
        {mounted && buildMode === 'build' && destination.trim() && editableDays.length > 0 && (
          <div className="mt-2">
            <ItineraryEditor
              days={editableDays}
              onChange={days => {
                setEditableDays(days)
                if (tripId) saveItinerary(days, tripId)
              }}
              startDate={startDate}
              destination={destination}
            />
            <button
              onClick={async () => {
                const id = await ensureTripCreated()
                if (!id) return
                setSaved(true)
                setItinerary({ days: editableDays })
                await supabase.from('trips').update({ itinerary: { days: editableDays } }).eq('id', id)
                window.history.replaceState({}, '', `?trip=${id}`)
              }}
              disabled={!destination.trim() || editableDays.every(d => d.stops.length === 0)}
              className="w-full mt-4 py-4 bg-[#2C2416] text-white rounded-xl font-medium text-sm hover:bg-[#5C5040] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save itinerary →
            </button>
          </div>
        )}
        {mounted && buildMode === 'build' && !destination.trim() && (
          <p className="text-xs text-[#C8BFB0] text-center py-4">Enter a destination above to start building</p>
        )}
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
              <PlaceListItem
                key={i}
                place={place}
                destination={destination}
                categoryColors={categoryColors}
                onRemove={() => setPlaces(prev => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>

          {/* Generate / Regenerate */}
          <div className="flex gap-3">
            {tripMode === 'single' && (
              <input
                type="number"
                min={1}
                max={30}
                className="w-20 bg-white border border-[#E8DFD0] rounded-xl px-3 py-4 outline-none text-[#2C2416] text-sm text-center focus:border-[#C17B4E] transition-colors"
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
              />
            )}
            <button
              onClick={tripMode === 'multi' ? handleGenerateMultiCity : handleGenerateItinerary}
              disabled={generating || (tripMode === 'single' ? !tripId : !cities.some(c => c.name.trim()))}
              className="flex-1 py-4 bg-[#2C2416] text-white rounded-xl font-medium text-sm hover:bg-[#5C5040] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Building your itinerary...' : itinerary ? 'Regenerate itinerary →' : 'Generate itinerary →'}
            </button>
          </div>
        </div>
      )}
      </>)} {/* end !tripSaved */}

      {/* Manual itinerary builder — shown before generate when no itinerary yet, AI mode only */}
      {!tripSaved && !itinerary && buildMode === 'ai' && destination.trim() && editableDays.length > 0 && (
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
      {(itinerary?.days || (saved && editableDays.some(d => d.stops.length > 0))) && (
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
              {canExport && (
                <button
                  onClick={exportToICS}
                  className="text-xs px-3 py-1.5 border border-[#E8DFD0] text-[#8C8070] rounded-lg hover:border-[#C17B4E] hover:text-[#C17B4E] transition-colors"
                  title="Export to Google Calendar / Apple Calendar"
                >
                  📅 Export
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
              {tripMode === 'multi' ? (
                // Multi-city: show per-city day editors
                <div className="bg-white border border-[#E8DFD0] rounded-xl px-3 py-2 flex flex-col gap-1.5">
                  <span className="text-xs text-[#8C8070] mb-0.5">Days per city:</span>
                  {cities.map((city, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-[#2C2416] font-medium w-24 truncate">{city.name}</span>
                      <input
                        type="number"
                        min={1}
                        max={14}
                        value={city.days}
                        onChange={e => setCities(prev => prev.map((c, j) => j === i ? { ...c, days: Number(e.target.value) } : c))}
                        className="w-10 bg-[#FDFAF5] border border-[#E8DFD0] rounded-lg px-2 py-1 text-xs text-[#2C2416] outline-none focus:border-[#C17B4E] text-center"
                      />
                      <span className="text-xs text-[#8C8070]">days</span>
                    </div>
                  ))}
                </div>
              ) : (
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
              )}
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
                onClick={tripMode === 'multi' ? handleGenerateMultiCity : handleGenerateItinerary}
                disabled={generating}
                className="text-xs px-3 py-1.5 bg-[#2C2416] text-white rounded-lg hover:bg-[#5C5040] transition-colors disabled:opacity-50"
              >
                {generating ? 'Regenerating...' : 'Regenerate'}
              </button>
            </div>
          )}

          {/* Map — per-city for multi-city trips, single map otherwise */}
          {mapMarkers.length > 0 && (() => {
            const isMultiCity = destination.includes('→') || editableDays.some((d: any) => d.city)
            if (!isMultiCity) {
              return (
                <div className="rounded-2xl overflow-hidden mb-8 h-80 border border-[#E8DFD0]">
                  <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
                    <Map
                      defaultCenter={mapCenter}
                      defaultZoom={12}
                      mapId="mapture-map"
                      gestureHandling="greedy"
                      disableDefaultUI={false}
                    >
                      {mapMarkers.map((marker: any, i: number) => (
                        <AdvancedMarker key={i} position={{ lat: marker.lat, lng: marker.lng }} title={marker.name}>
                          <div style={{ background: marker.color, border: '2px solid white', borderRadius: '20px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, color: 'white', fontSize: 11, fontWeight: 600, boxShadow: '0 2px 6px rgba(0,0,0,0.25)', cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: 160 }}>
                            <span style={{ background: 'rgba(255,255,255,0.3)', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10 }}>{marker.day}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{marker.name}</span>
                          </div>
                        </AdvancedMarker>
                      ))}
                    </Map>
                  </APIProvider>
                </div>
              )
            }

            // Multi-city: group markers by city, render one map per city
            const cityGroups: Record<string, { markers: any[]; color: string }> = {}
            editableDays.forEach((day: any, dayIndex: number) => {
              // Use day.city if present, otherwise extract from title (e.g. "Paris — Montmartre" → "Paris")
              const city = day.city || (day.title?.includes('—') ? day.title.split('—')[0].trim() : day.title) || `Day ${day.day}`
              if (!cityGroups[city]) cityGroups[city] = { markers: [], color: DAY_COLORS[dayIndex % DAY_COLORS.length] }
              day.stops.forEach((stop: any) => {
                if (stop.lat && stop.lng) {
                  cityGroups[city].markers.push({ name: stop.name, lat: stop.lat, lng: stop.lng, day: day.day, color: DAY_COLORS[dayIndex % DAY_COLORS.length] })
                }
              })
            })

            return (
              <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
                <div className="flex flex-col gap-4 mb-8">
                  {Object.entries(cityGroups).filter(([, g]) => g.markers.length > 0).map(([city, group]) => {
                    const lats = group.markers.map(m => m.lat)
                    const lngs = group.markers.map(m => m.lng)
                    const centerLat = (Math.max(...lats) + Math.min(...lats)) / 2
                    const centerLng = (Math.max(...lngs) + Math.min(...lngs)) / 2
                    const spread = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs))
                    const zoom = spread < 0.02 ? 14 : spread < 0.1 ? 13 : spread < 0.5 ? 12 : 11
                    return (
                      <div key={city}>
                        <p className="text-xs font-medium text-[#8C8070] uppercase tracking-widest mb-2">{city}</p>
                        <div className="rounded-2xl overflow-hidden h-56 border border-[#E8DFD0]">
                          <Map
                            defaultCenter={{ lat: centerLat, lng: centerLng }}
                            defaultZoom={zoom}
                            mapId={`mapture-map-${city.replace(/\s+/g, '-').toLowerCase()}`}
                            gestureHandling="greedy"
                            disableDefaultUI={false}
                          >
                            {group.markers.map((marker: any, i: number) => (
                              <AdvancedMarker key={i} position={{ lat: marker.lat, lng: marker.lng }} title={marker.name}>
                                <div style={{ background: marker.color, border: '2px solid white', borderRadius: '20px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, color: 'white', fontSize: 11, fontWeight: 600, boxShadow: '0 2px 6px rgba(0,0,0,0.25)', cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: 160 }}>
                                  <span style={{ background: 'rgba(255,255,255,0.3)', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 10 }}>{marker.day}</span>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{marker.name}</span>
                                </div>
                              </AdvancedMarker>
                            ))}
                          </Map>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </APIProvider>
            )
          })()}

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