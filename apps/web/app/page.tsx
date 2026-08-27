'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import ItineraryEditor, { Day, recalcTimes } from './components/ItineraryEditor'
import TripsSidebar from './components/TripsSidebar'
import AddMorePlaces from './components/AddMorePlaces'
import PlaceSearch from './components/PlaceSearch'
import CityAutocomplete from './components/CityAutocomplete'
import DurationSpinner from './components/DurationSpinner'
import WorldMapPin from './components/WorldMapPin'
import {
  Menu, MapPin, Route, Sparkles, CalendarDays, Bot, Search, Camera,
  Leaf, Scale, Zap, ArrowRight, Pencil, Eye, Star, Check, Undo2,
  ChevronDown, SlidersHorizontal, Plus,
  Lightbulb, Link as LinkIcon,
  Utensils, Coffee, Compass, BedDouble, Tag, MoreHorizontal, X, Martini,
  ChevronsUpDown, GripVertical,
} from 'lucide-react'

// ── Share dropdown ──
function ShareButton({ onShare }: { onShare: (viewOnly: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs px-3 py-1.5 border border-[#E5E5E5] text-[#6B6B6B] rounded-lg hover:border-[#3D5AFE] hover:text-[#3D5AFE] transition-colors"
      >
        Share
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 bg-white border border-[#E5E5E5] rounded-md shadow-lg overflow-hidden z-20 w-44">
            <button
              onClick={() => { onShare(false); setOpen(false) }}
              className="w-full flex items-center gap-2 text-left px-4 py-2.5 text-xs text-[#0A0A0A] hover:bg-[#EEF0FF] transition-colors"
            >
              <Pencil size={12} strokeWidth={2} className="text-[#6B6B6B]" /> Copy edit link
            </button>
            <button
              onClick={() => { onShare(true); setOpen(false) }}
              className="w-full flex items-center gap-2 text-left px-4 py-2.5 text-xs text-[#0A0A0A] hover:bg-[#EEF0FF] transition-colors border-t border-[#EFEFEF]"
            >
              <Eye size={12} strokeWidth={2} className="text-[#6B6B6B]" /> Copy view-only link
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const DAY_COLORS = ['#3D5AFE', '#7A9E7E', '#5C8AAE', '#9B6DAB', '#B85C38']

// Imperative map control: pans to a hovered stop, and re-fits bounds with
// left padding equal to the floating panel's current width so markers
// never end up hidden underneath it.
function MapController({ markers, hoveredMarker, panelPaddingLeft }: {
  markers: { lat: number; lng: number }[]
  hoveredMarker: { lat: number; lng: number } | null
  panelPaddingLeft: number
}) {
  const map = useMap()

  useEffect(() => {
    if (map && hoveredMarker) {
      map.panTo(hoveredMarker)
    }
  }, [map, hoveredMarker])

  useEffect(() => {
    if (!map || markers.length === 0) return
    const bounds = new google.maps.LatLngBounds()
    markers.forEach(m => bounds.extend(m))
    map.fitBounds(bounds, { left: panelPaddingLeft, top: 40, right: 40, bottom: 40 })
    // Re-fit only when the panel width changes meaningfully, not on every marker re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, panelPaddingLeft])

  return null
}

// ── Place popup for extracted places list ──
function PlaceListPopup({ place, destination, anchorRect, onClose }: {
  place: any; destination: string; anchorRect: DOMRect; onClose: () => void
}) {
  const name = place.name
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
        className="fixed z-50 bg-white border border-[#E5E5E5] rounded-lg shadow-2xl overflow-hidden"
        style={{ left, top, width: POPUP_W }}
        onClick={e => e.stopPropagation()}
      >
        {fetchLoading ? (
          <div className="w-full flex items-center justify-center bg-[#EFEFEF]" style={{ height: 100 }}>
            <span className="text-xs text-[#A3A3A3]">Loading...</span>
          </div>
        ) : photoUrl ? (
          <img key={photoUrl} src={photoUrl} alt={name} className="w-full object-cover" style={{ height: 140 }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <div className="w-full flex items-center justify-center bg-[#EFEFEF]" style={{ height: 80 }}>
            <MapPin size={22} strokeWidth={1.5} className="text-[#A3A3A3]" />
          </div>
        )}
        <div className="p-3">
          <p className="text-sm font-semibold text-[#0A0A0A] leading-snug">{name}</p>
          {(fetched?.rating || priceStr) && (
            <div className="flex items-center gap-2 mt-0.5">
              {fetched?.rating && <span className="flex items-center gap-0.5 text-xs text-[#6B6B6B]"><Star size={11} strokeWidth={2} className="fill-[#3D5AFE] text-[#3D5AFE]" /> {fetched.rating.toFixed(1)}</span>}
              {priceStr && <span className="text-xs text-[#6B6B6B]">{priceStr}</span>}
            </div>
          )}
          {fetched?.address && <p className="text-xs text-[#A3A3A3] mt-0.5 truncate">{fetched.address}</p>}
          {place.why_recommended && (
            <p className="flex items-start gap-1.5 text-xs text-[#0A0A0A] mt-2 leading-relaxed">
              <Sparkles size={12} strokeWidth={2} className="text-[#3D5AFE] shrink-0 mt-0.5" />
              {place.why_recommended}
            </p>
          )}
          {place.tip && (
            <p className="flex items-start gap-1.5 text-xs text-[#6B6B6B] mt-1.5 leading-relaxed">
              <Lightbulb size={12} strokeWidth={2} className="text-[#A3A3A3] shrink-0 mt-0.5" />
              {place.tip}
            </p>
          )}
          {place.source_url && (
            <a href={place.source_url} target="_blank" rel="noopener noreferrer"
              className="mt-1.5 flex items-center gap-1 text-xs text-[#A3A3A3] hover:text-[#3D5AFE] truncate transition-colors">
              <LinkIcon size={11} strokeWidth={2} /> Source
            </a>
          )}
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1 text-xs text-[#3D5AFE] hover:text-[#2E45D6] font-medium transition-colors">
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
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[#EFEFEF] last:border-0 group relative">
      <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#3D5AFE]" />
      <div className="flex-1 min-w-0">
        {isGeolocated ? (
          <button
            onClick={e => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setAnchorRect(prev => prev ? null : rect)
            }}
            className="text-sm text-[#0A0A0A] font-medium hover:text-[#3D5AFE] transition-colors text-left"
          >
            {place.name}
          </button>
        ) : (
          <span className="text-sm text-[#0A0A0A] font-medium">{place.name}</span>
        )}
        {place.city && <span className="text-xs text-[#6B6B6B] ml-2">{place.city}</span>}
      </div>
      <span className={`text-xs shrink-0 ${categoryColors[place.category] || 'text-[#6B6B6B]'}`}>
        {place.category}
      </span>
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-[#A3A3A3] hover:text-red-400 text-lg leading-none shrink-0"
      >
        ×
      </button>
      {anchorRect && (
        <PlaceListPopup
          place={place}
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
        className={`border-2 border-dashed rounded-md px-4 py-3 cursor-pointer transition-colors ${
          dragOver ? 'border-[#3D5AFE] bg-[#EEF0FF]' : 'border-[#E5E5E5] hover:border-[#3D5AFE] hover:bg-[#EEF0FF]'
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
            <span className="flex items-center gap-1 text-xs text-[#6B6B6B]">
              {loading ? 'Reading images...' : <><Check size={12} strokeWidth={2.5} className="text-[#7A9E7E]" /> {previews.length} image{previews.length > 1 ? 's' : ''} extracted — click to add more</>}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Camera size={18} strokeWidth={1.5} className="text-[#A3A3A3]" />
            <span className="text-xs text-[#6B6B6B]">
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
  const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lng: number } | null>(null)
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
  const [buildMode, setBuildMode] = useState<'ai' | 'build' | 'agent'>('ai')
  const [tripMode, setTripMode] = useState<'single' | 'multi'>('single')
  const [cities, setCities] = useState<{ name: string; days: number }[]>([{ name: '', days: 2 }])
  const [arrivalTime, setArrivalTime] = useState('')   // e.g. "14:00"
  const [departureTime, setDepartureTime] = useState('') // e.g. "11:00"
  const [agentMessages, setAgentMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [agentInput, setAgentInput] = useState('')
  const [agentLoading, setAgentLoading] = useState(false)
  const agentChatRef = useRef<HTMLDivElement>(null)
  const workspaceBoxRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const [showCustomize, setShowCustomize] = useState(false)
  const [showTripMenu, setShowTripMenu] = useState(false)
  const [showAskMapture, setShowAskMapture] = useState(false)
  const [hoveredStopId, setHoveredStopId] = useState<string | null>(null)
  const [showUnscheduledMobile, setShowUnscheduledMobile] = useState(false)
  const [markerPopup, setMarkerPopup] = useState<{ stopId: string; anchorRect: DOMRect } | null>(null)
  const [panelWidthPx, setPanelWidthPx] = useState(400)
  const [sheetHeightVh, setSheetHeightVh] = useState(55)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Register service worker for PWA
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

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

  async function promoteFromInbox(id: string) {
    await supabase.from('trips').update({ is_inbox: false }).eq('id', id)
    await loadTrip(id)
  }

  function resetTrip() {
    setTripId(null)
    setDestination('')
    setDestinationCoords(null)
    setDuration(3)
    setVibe('balanced')
    setInput('')
    setPlaces([])
    setSaved(false)
    setTripSaved(false)
    setStartDate('')
    setItinerary(null)
    setEditableDays([])
    setAgentMessages([])
    setAgentInput('')
    window.history.replaceState({}, '', '/')
  }

  // Create trip in Supabase if not yet created (for manual place adds before extract)
  async function ensureTripCreated(): Promise<string | null> {
    if (tripId) return tripId
    const dest = tripMode === 'multi'
      ? cities.filter(c => c.name.trim()).map(c => c.name.trim()).join(', ')
      : destination.trim()
    if (!dest) return null
    const { data: trip, error } = await supabase
      .from('trips')
      .insert({ destination: dest, duration: `${duration} days`, vibe })
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

  // Desktop: drag the panel's right edge to resize it; the map re-fits its bounds
  // around the new width via MapController's panelPaddingLeft effect.
  function handlePanelResizeStart(e: React.PointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panelWidthPx
    function onMove(moveEvent: PointerEvent) {
      const newWidth = Math.min(880, Math.max(320, startWidth + (moveEvent.clientX - startX)))
      setPanelWidthPx(newWidth)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Mobile: drag the sheet handle to reveal more/less of the itinerary over the map,
  // snapping to a peek/half/full position on release.
  function handleSheetDragStart(e: React.PointerEvent) {
    e.preventDefault()
    const boxHeight = workspaceBoxRef.current?.getBoundingClientRect().height || 600
    const startY = e.clientY
    const startHeightVh = sheetHeightVh
    function onMove(moveEvent: PointerEvent) {
      const deltaPercent = ((startY - moveEvent.clientY) / boxHeight) * 100
      setSheetHeightVh(Math.min(92, Math.max(12, startHeightVh + deltaPercent)))
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setSheetHeightVh(prev => {
        const snapPoints = [22, 55, 90]
        return snapPoints.reduce((closest, p) => Math.abs(p - prev) < Math.abs(closest - prev) ? p : closest)
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Clicking a pin should surface its stop in the itinerary list: highlight it
  // (same highlight state hovering a row already drives) and scroll it into view.
  // On mobile the sheet may be collapsed too low to show anything, so open it first.
  function handleMarkerClick(stopId: string, anchorRect: DOMRect) {
    setMarkerPopup({ stopId, anchorRect })
    setHoveredStopId(stopId)
    const isMobile = window.innerWidth < 1024
    if (isMobile && sheetHeightVh < 55) setSheetHeightVh(55)
    setTimeout(() => {
      document.getElementById(`stop-${stopId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }, isMobile && sheetHeightVh < 55 ? 200 : 0)
  }

  async function handleAgentSend(userMsg?: string) {
    const msg = userMsg || agentInput.trim()
    const agentDestination = tripMode === 'multi'
      ? cities.filter(c => c.name.trim()).map(c => c.name.trim()).join(', ')
      : destination.trim()
    if (!msg || !agentDestination) return
    setAgentInput('')
    const newMessages = [...agentMessages, { role: 'user' as const, content: msg }]
    setAgentMessages(newMessages)
    setAgentLoading(true)
    setTimeout(() => agentChatRef.current?.scrollTo({ top: agentChatRef.current.scrollHeight, behavior: 'smooth' }), 50)

    try {
      const res = await fetch('/api/agent-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          destination: agentDestination,
          duration: tripMode === 'multi'
            ? `${cities.filter(c => c.name.trim()).reduce((sum, c) => sum + c.days, 0)}`
            : `${duration}`,
          cities: tripMode === 'multi'
            ? cities.filter(c => c.name.trim()).map(c => ({ name: c.name.trim(), days: c.days }))
            : undefined,
          vibe,
          arrivalTime: arrivalTime || undefined,
          departureTime: departureTime || undefined,
          currentItinerary: editableDays.some(d => d.stops.length > 0) ? { days: editableDays } : undefined,
        }),
      })
      const data = await res.json()
      setAgentMessages(prev => [...prev, { role: 'assistant', content: data.reply }])

      if (data.itinerary?.days?.length > 0) {
        const id = await ensureTripCreated()
        if (id) {
          const normalized: Day[] = data.itinerary.days.map((day: any) => ({
            ...day,
            stops: day.stops.map((stop: any, i: number) => ({
              ...stop,
              id: stop.id || `agent-${day.day}-${i}-${stop.name}`,
            })),
          }))
          setItinerary({ days: normalized })
          setEditableDays(normalized)
          if (data.places?.length > 0) {
            setPlaces(data.places)
          }
          await supabase.from('trips').update({ itinerary: { days: normalized } }).eq('id', id)
          window.history.replaceState({}, '', `?trip=${id}`)
        }
      }
    } catch (e) {
      setAgentMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Try again?' }])
    }
    setAgentLoading(false)
    setTimeout(() => agentChatRef.current?.scrollTo({ top: agentChatRef.current.scrollHeight, behavior: 'smooth' }), 50)
  }

  // Groups extracted places by their detected city, most common first
  function detectCityGroups(extractedPlaces: any[]): { city: string; count: number }[] {
    const counts: Record<string, number> = {}
    for (const p of extractedPlaces) {
      const city = (p.city || '').trim()
      if (!city) continue
      counts[city] = (counts[city] || 0) + 1
    }
    return Object.entries(counts)
      .map(([city, count]) => ({ city, count }))
      .sort((a, b) => b.count - a.count)
  }

  // After an auto-detected extraction, either fill in the single destination or
  // switch to multi-city mode and split places into per-city buckets.
  async function applyAutoDetectedLocation(extractedPlaces: any[], forTripId: string) {
    const groups = detectCityGroups(extractedPlaces)
    if (groups.length === 0) return
    if (groups.length === 1) {
      setDestination(groups[0].city)
      await supabase.from('trips').update({ destination: groups[0].city }).eq('id', forTripId)
      return
    }
    const totalPlaces = groups.reduce((s, g) => s + g.count, 0)
    const baseDuration = duration || groups.length * 2
    const newCities = groups.map(g => ({
      name: g.city,
      days: Math.max(1, Math.round((baseDuration * g.count) / totalPlaces)),
    }))
    setTripMode('multi')
    setCities(newCities)
    const label = newCities.map(c => c.name).join(', ')
    const totalDays = newCities.reduce((s, c) => s + c.days, 0)
    await supabase.from('trips').update({ destination: label, duration: `${totalDays} days` }).eq('id', forTripId)
  }

  async function handleExtract() {
    // Destination is optional in single mode — AI detects it from the pasted content.
    // Multi-city mode still requires explicit cities since that's a deliberate structured choice.
    const hasDestination = tripMode === 'multi' ? cities.some(c => c.name.trim()) : true
    if ((!input.trim() && places.length === 0) || !hasDestination) return
    const autoDetectDestination = tripMode === 'single' && !destination.trim()
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
      if (importData.days?.length > 0 && importData.userProvidedStructure) {
        // The user's text already had real day/time structure (e.g. a friend's plan) —
        // this is faithful parsing, not AI-invented scheduling, so it's fine to show right away.
        const normalized: Day[] = importData.days.map((day: any, i: number) => ({
          ...day,
          stops: day.stops.map((stop: any, j: number) => ({
            ...stop,
            id: `imported-${i}-${j}-${stop.name}`,
          })),
        }))
        const finalDays = mergeIntoExisting(normalized, currentDays)
        setItinerary({ days: finalDays })
        if (currentDays.some(d => d.stops.length > 0)) snapshotAndReplace(finalDays)
        else handleDaysChange(finalDays)
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
        if (autoDetectDestination && importData.places?.length > 0) {
          await applyAutoDetectedLocation(importData.places, currentTripId!)
        }
        setSaved(true)
        setLoading(false)
        return
      }
      if (importData.places?.length > 0) {
        // Unstructured list — the API invented a day distribution, but we deliberately
        // don't show a generated itinerary yet. Surface the found places first;
        // generating a day-by-day plan is a separate, explicit action.
        if (isNewTrip) {
          setPlaces(importData.places)
        } else {
          setPlaces(prev => {
            const existingNames = new Set(prev.map((p: any) => p.name.toLowerCase().trim()))
            const newPlaces = importData.places.filter((p: any) => !existingNames.has(p.name.toLowerCase().trim()))
            return [...prev, ...newPlaces]
          })
        }
        window.history.replaceState({}, '', `?trip=${currentTripId}`)
        if (autoDetectDestination) {
          await applyAutoDetectedLocation(importData.places, currentTripId!)
        }
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
    if (autoDetectDestination && newPlaces.length > 0) {
      await applyAutoDetectedLocation(newPlaces, currentTripId!)
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
    restaurant: 'text-[#3D5AFE]',
    bar: 'text-[#9B6DAB]',
    activity: 'text-[#7A9E7E]',
    stay: 'text-[#6B6B6B]',
    cafe: 'text-[#3D5AFE]',
    neighborhood: 'text-[#5C8AAE]',
    other: 'text-[#6B6B6B]',
  }

  const mapMarkers = editableDays.flatMap((day: Day, dayIndex: number) =>
    day.stops
      .map((stop: any) => {
        // First check if the stop itself has coordinates (from import-itinerary enrichment)
        const lat = stop.lat ?? places.find((p: any) => p.name.toLowerCase().trim() === stop.name.toLowerCase().trim())?.lat
        const lng = stop.lng ?? places.find((p: any) => p.name.toLowerCase().trim() === stop.name.toLowerCase().trim())?.lng
        if (!lat || !lng) return null
        return {
          id: stop.id,
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
    <main ref={mainRef} className="relative min-h-screen bg-gradient-subtle flex flex-col items-center px-6 py-12 pt-20">
      {!tripSaved && <WorldMapPin coords={destinationCoords} containerRef={mainRef} />}

      {/* Trips sidebar */}
      <TripsSidebar
        open={sidebarOpen}
        currentTripId={tripId}
        onClose={() => setSidebarOpen(false)}
        onSelect={loadTrip}
        onNew={resetTrip}
        onDelete={id => { if (id === tripId) resetTrip() }}
        onStartFromInbox={promoteFromInbox}
      />

      {/* Hamburger */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="fixed top-5 left-5 z-30 flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/70 hover:shadow-sm transition-all"
        aria-label="Open trips"
      >
        <Menu size={18} strokeWidth={1.75} className="text-[#6B6B6B]" />
      </button>

      <h1 className="text-[2.75rem] leading-none font-semibold tracking-tight text-[#0A0A0A] mb-2.5">
        mapture<span className="text-[#3D5AFE]">.</span>
      </h1>
      <p className="text-[#6B6B6B] text-base mb-14">
        Turn all your travel finds into a trip
      </p>

      {/* Only show the build form when not viewing a saved trip */}
      {!tripSaved && (<>
      <div className="w-full max-w-2xl">

        {/* Build mode — three equally-visible ways to start, compact single row */}
        {mounted && (
          <div className="flex gap-1 mb-3 p-1 bg-black/[0.03] rounded-md">
            <button
              onClick={() => setBuildMode('ai')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${buildMode === 'ai' ? 'bg-white text-[#0A0A0A] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)]' : 'text-[#6B6B6B] hover:text-[#0A0A0A]'}`}
            >
              <Sparkles size={13} strokeWidth={2} className={buildMode === 'ai' ? 'text-[#3D5AFE]' : ''} />
              Paste &amp; extract
            </button>
            <button
              onClick={() => setBuildMode('build')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${buildMode === 'build' ? 'bg-white text-[#0A0A0A] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)]' : 'text-[#6B6B6B] hover:text-[#0A0A0A]'}`}
            >
              <CalendarDays size={13} strokeWidth={2} className={buildMode === 'build' ? 'text-[#3D5AFE]' : ''} />
              Plan it myself
            </button>
            <button
              onClick={() => setBuildMode('agent')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${buildMode === 'agent' ? 'bg-white text-[#0A0A0A] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)]' : 'text-[#6B6B6B] hover:text-[#0A0A0A]'}`}
            >
              <Bot size={13} strokeWidth={2} className={buildMode === 'agent' ? 'text-[#3D5AFE]' : ''} />
              Explore ideas
            </button>
          </div>
        )}

        {/* Composer: destination + primary input, one card */}
        <div className="bg-white border border-[#E5E5E5] rounded-lg shadow-sm overflow-hidden mb-3">
          {/* Destination row — always visible, required for every mode */}
          {tripMode === 'single' ? (
            <div className="flex items-center gap-2 px-5 pt-4 pb-3 border-b border-[#EFEFEF]">
              <MapPin size={14} strokeWidth={2} className="text-[#3D5AFE] shrink-0" />
              <span className="text-sm text-[#6B6B6B] shrink-0">Trip to</span>
              <CityAutocomplete
                value={destination}
                onChange={(v, coords) => { setDestination(v); setDestinationCoords(coords ?? null) }}
                placeholder="Optional — AI can detect it from what you paste"
                className="flex-1 min-w-0 bg-transparent outline-none text-[#0A0A0A] text-sm font-medium placeholder:text-[#A3A3A3] placeholder:font-normal"
              />
              <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-[#EFEFEF]">
                <DurationSpinner value={duration} onChange={setDuration} label="days" />
              </div>
              <button
                onClick={() => {
                  setTripMode('multi')
                  if (destination.trim() && cities[0]?.name === '') {
                    setCities(prev => [{ name: destination.trim(), days: duration || 2 }, ...prev.slice(1)])
                  }
                }}
                title="Switch to multi-city / road trip"
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[#A3A3A3] hover:text-[#3D5AFE] hover:bg-[#EEF0FF] transition-colors"
              >
                <Route size={14} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3 border-b border-[#EFEFEF]">
              <div className="flex items-center gap-2 min-w-0">
                <Route size={14} strokeWidth={2} className="text-[#3D5AFE] shrink-0" />
                <span className="text-sm text-[#0A0A0A] font-medium truncate">
                  {cities.filter(c => c.name.trim()).map(c => c.name).join(' → ') || 'Add your cities'}
                </span>
                <span className="text-xs text-[#A3A3A3] shrink-0">{cities.reduce((s, c) => s + (c.days || 0), 0)}d</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setShowCustomize(true)}
                  className="text-xs text-[#3D5AFE] hover:text-[#2E45D6] transition-colors"
                >
                  Edit cities
                </button>
                <button
                  onClick={() => setTripMode('single')}
                  title="Switch to single destination"
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-[#A3A3A3] hover:text-[#3D5AFE] hover:bg-[#EEF0FF] transition-colors"
                >
                  <MapPin size={13} strokeWidth={2} />
                </button>
              </div>
            </div>
          )}

          {/* Primary content per mode */}
          {mounted && buildMode === 'ai' && inputTab === 'ai' && (
            <div className="p-5">
              <textarea
                className="w-full bg-transparent outline-none text-[#0A0A0A] text-sm leading-relaxed resize-none placeholder:text-[#A3A3A3]"
                rows={4}
                placeholder={"Paste a link, or list some places — e.g. Scripps Pier for photos, https://sandiego.eater.com/..."}
                value={input}
                onChange={e => setInput(e.target.value)}
              />
              <ImageUpload onExtracted={text => setInput(prev => prev ? `${prev}\n${text}` : text)} />
            </div>
          )}
          {mounted && buildMode === 'ai' && inputTab === 'manual' && (
            <div className="p-5">
              {destination.trim() ? (
                <PlaceSearch
                  tripId={tripId || ''}
                  destination={destination}
                  onSaved={place => setPlaces(prev => [...prev, place])}
                  onBeforeSave={ensureTripCreated}
                />
              ) : (
                <p className="text-xs text-[#A3A3A3]">Enter a destination above first</p>
              )}
            </div>
          )}
          {mounted && buildMode === 'build' && (
            <p className="px-5 py-4 text-xs text-[#A3A3A3]">
              {destination.trim() ? 'Add your stops day by day below ↓' : 'Enter a destination above to start building'}
            </p>
          )}
          {mounted && buildMode === 'agent' && (
            <p className="px-5 py-4 text-xs text-[#A3A3A3]">
              {destination.trim() ? 'Chat with the trip assistant below ↓' : 'Enter a destination above first'}
            </p>
          )}
        </div>

        {/* Primary CTA (AI mode) */}
        {mounted && buildMode === 'ai' && (<>
          <button
            onClick={handleExtract}
            disabled={loading || (!input.trim() && places.length === 0) || (tripMode === 'multi' && !cities.some(c => c.name.trim()))}
            className="group w-full py-4 btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none inline-flex items-center justify-center gap-1.5"
          >
            {loading ? 'Extracting places...' : places.length > 0 ? 'Generate itinerary' : 'Extract & generate'}
            {!loading && <ArrowRight size={15} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" />}
          </button>
          <p className="text-xs text-[#A3A3A3] text-center mt-2">We’ll put it together. You can tweak anything after.</p>
        </>)}

        {/* Minor variant within paste & extract mode */}
        {mounted && buildMode === 'ai' && (
          <div className="flex items-center justify-center mt-3 text-xs text-[#A3A3A3]">
            <button onClick={() => setInputTab(t => t === 'ai' ? 'manual' : 'ai')} className="hover:text-[#3D5AFE] transition-colors">
              {inputTab === 'ai' ? 'Search a specific place instead' : 'Paste a link instead'}
            </button>
          </div>
        )}

        {/* Customize disclosure — trip mode, duration/cities, dates, travel style */}
        {mounted && (
          <div className="text-center mt-3 mb-1">
            <button
              onClick={() => setShowCustomize(v => !v)}
              className="inline-flex items-center gap-1 text-xs text-[#A3A3A3] hover:text-[#6B6B6B] transition-colors"
            >
              <SlidersHorizontal size={11} strokeWidth={2} />
              Customize
              <ChevronDown size={11} strokeWidth={2} className={`transition-transform ${showCustomize ? 'rotate-180' : ''}`} />
            </button>
          </div>
        )}
        {mounted && showCustomize && (
          <div className="glass-card p-4 mt-2 mb-5 space-y-4">
            {/* City builder (multi-city only — single mode has duration inline above) */}
            {tripMode === 'multi' && (
              <div>
                <label className="block text-[10px] font-semibold text-[#3D5AFE] uppercase tracking-widest mb-2">Cities &amp; days</label>
                <div className="flex flex-col gap-2">
                  {cities.map((city, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-[#A3A3A3] w-4 shrink-0">{i + 1}.</span>
                      <CityAutocomplete
                        value={city.name}
                        onChange={v => setCities(prev => prev.map((c, j) => j === i ? { ...c, name: v } : c))}
                        placeholder="City or country..."
                        className="flex-1 bg-[#FFFFFF] border border-[#E5E5E5] rounded-md px-3 py-2 text-sm text-[#0A0A0A] outline-none focus:border-[#3D5AFE] transition-colors placeholder:text-[#A3A3A3]"
                      />
                      <DurationSpinner
                        value={city.days}
                        onChange={v => setCities(prev => prev.map((c, j) => j === i ? { ...c, days: v } : c))}
                        min={1}
                        max={14}
                      />
                      {cities.length > 1 && (
                        <button
                          onClick={() => setCities(prev => prev.filter((_, j) => j !== i))}
                          className="text-[#A3A3A3] hover:text-red-400 text-lg leading-none shrink-0"
                        >×</button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setCities(prev => [...prev, { name: '', days: 2 }])}
                    className="text-xs text-[#3D5AFE] hover:text-[#2E45D6] text-left mt-1 transition-colors"
                  >
                    + Add city
                  </button>
                </div>
                <div className="mt-3 pt-3 border-t border-[#EFEFEF] flex items-center gap-2 text-xs text-[#6B6B6B]">
                  <span>Total:</span>
                  <span className="font-medium text-[#0A0A0A]">{cities.reduce((s, c) => s + (c.days || 0), 0)} days</span>
                  <span>·</span>
                  <span>{cities.filter(c => c.name.trim()).length} cities</span>
                </div>
              </div>
            )}

            {/* Start date + arrival/departure */}
            <div>
              <label className="block text-[10px] font-semibold text-[#3D5AFE] uppercase tracking-widest mb-2">Dates</label>
              <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap">
                <span className="text-xs text-[#6B6B6B] shrink-0">Start</span>
                <input
                  type="date"
                  min="2026-01-01"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="bg-white border border-[#E5E5E5] rounded-lg px-2 py-1 outline-none text-xs text-[#0A0A0A] focus:border-[#3D5AFE] transition-colors"
                />
                <span className="text-xs text-[#A3A3A3]">·</span>
                <span className="text-xs text-[#A3A3A3] shrink-0">arrive</span>
                <input
                  type="time"
                  value={arrivalTime}
                  onChange={e => setArrivalTime(e.target.value)}
                  className="bg-transparent border-b border-[#E5E5E5] outline-none text-xs text-[#6B6B6B] focus:border-[#3D5AFE] transition-colors w-16 py-0.5"
                />
                <span className="text-xs text-[#A3A3A3] shrink-0">depart</span>
                <input
                  type="time"
                  value={departureTime}
                  onChange={e => setDepartureTime(e.target.value)}
                  className="bg-transparent border-b border-[#E5E5E5] outline-none text-xs text-[#6B6B6B] focus:border-[#3D5AFE] transition-colors w-16 py-0.5"
                />
                <span className="text-xs text-[#A3A3A3] shrink-0">optional</span>
              </div>
            </div>

            {/* Vibe selector */}
            <div>
              <label className="block text-[10px] font-semibold text-[#3D5AFE] uppercase tracking-widest mb-2">Travel style</label>
              <div className="flex items-center gap-2">
                {vibe === 'relaxed' && <Leaf size={14} strokeWidth={2} className="text-[#7A9E7E] shrink-0" />}
                {vibe === 'balanced' && <Scale size={14} strokeWidth={2} className="text-[#3D5AFE] shrink-0" />}
                {vibe === 'everything' && <Zap size={14} strokeWidth={2} className="text-[#B85C38] shrink-0" />}
                <select
                  value={vibe}
                  onChange={e => setVibe(e.target.value as any)}
                  className="w-full bg-transparent outline-none text-sm text-[#0A0A0A] cursor-pointer"
                >
                  <option value="relaxed">Slow &amp; relaxed — 2-3 stops/day</option>
                  <option value="balanced">Balanced — 4 stops/day</option>
                  <option value="everything">See everything — 5-6 stops/day</option>
                </select>
              </div>
            </div>
          </div>
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
              className="w-full mt-4 py-4 bg-[#0A0A0A] text-white rounded-md font-medium text-sm hover:bg-[#0A0A0A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save itinerary →
            </button>
          </div>
        )}

        {/* Plan for me mode — chat agent */}
        {mounted && buildMode === 'agent' && (<>
          <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden mb-4">
            {/* Chat messages */}
            <div ref={agentChatRef} className="max-h-80 overflow-y-auto p-4 space-y-3">
              {agentMessages.length === 0 && (
                <div className="text-center py-6">
                  <p className="text-sm text-[#0A0A0A] mb-2">Tell me what kind of trip you want!</p>
                  <p className="text-xs text-[#6B6B6B] mb-4">Describe your vibe, interests, or just say "plan it" and I'll build your whole trip.</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {[
                      'Urban sightseeing with shopping',
                      'Foodie trip — best local eats',
                      'Chill beaches and sunset spots',
                      'Just plan the whole thing for me',
                    ].map(suggestion => (
                      <button
                        key={suggestion}
                        onClick={() => handleAgentSend(suggestion)}
                        className="text-xs px-3 py-1.5 border border-[#E5E5E5] rounded-full text-[#6B6B6B] hover:border-[#3D5AFE] hover:text-[#3D5AFE] transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {agentMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#3D5AFE] text-white rounded-br-md'
                      : 'bg-[#EFEFEF] text-[#0A0A0A] rounded-bl-md'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {agentLoading && (
                <div className="flex justify-start">
                  <div className="bg-[#EFEFEF] rounded-lg rounded-bl-md px-4 py-2.5 text-sm text-[#6B6B6B]">
                    <span className="inline-flex gap-1">
                      <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                      <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                      <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
            {/* Input */}
            <div className="border-t border-[#E5E5E5] px-4 py-3 flex gap-2">
              <input
                type="text"
                value={agentInput}
                onChange={e => setAgentInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAgentSend() } }}
                placeholder={(tripMode === 'multi' ? cities.some(c => c.name.trim()) : destination.trim()) ? 'Describe your ideal trip...' : 'Set a destination above first'}
                disabled={(tripMode === 'multi' ? !cities.some(c => c.name.trim()) : !destination.trim()) || agentLoading}
                className="flex-1 bg-transparent outline-none text-sm text-[#0A0A0A] placeholder:text-[#A3A3A3] disabled:opacity-50"
              />
              <button
                onClick={() => handleAgentSend()}
                disabled={!agentInput.trim() || (tripMode === 'multi' ? !cities.some(c => c.name.trim()) : !destination.trim()) || agentLoading}
                className="text-xs px-4 py-1.5 bg-[#3D5AFE] text-white rounded-lg hover:bg-[#2E45D6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </div>
          <p className="text-xs text-[#A3A3A3] text-center mt-2">We’ll put it together. You can tweak anything after.</p>
        </>)}
      </div>

      {/* Extracted places */}
      {places.length > 0 && (
        <div className="w-full max-w-2xl mt-10">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs uppercase tracking-widest text-[#6B6B6B]">
              {destination ? `${destination} · ` : ''}{places.length} saved place{places.length > 1 ? 's' : ''}
            </p>
            {saved && (
              <p className="flex items-center gap-1 text-xs text-[#7A9E7E] font-medium"><Check size={12} strokeWidth={2.5} /> Saved to your trip</p>
            )}
          </div>
          {(() => {
            const categoryMeta: Record<string, { label: string; icon: any }> = {
              restaurant: { label: 'Food', icon: Utensils },
              bar: { label: 'Bars & nightlife', icon: Martini },
              cafe: { label: 'Cafés', icon: Coffee },
              activity: { label: 'Things to do', icon: Compass },
              stay: { label: 'Stays', icon: BedDouble },
              neighborhood: { label: 'Neighborhoods', icon: MapPin },
              other: { label: 'Other', icon: Tag },
            }
            const counts: Record<string, number> = {}
            for (const p of places) counts[p.category] = (counts[p.category] || 0) + 1
            const groups = Object.entries(counts).sort((a, b) => b[1] - a[1])
            if (groups.length < 2) return null
            return (
              <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mb-4">
                {groups.map(([cat, count]) => {
                  const meta = categoryMeta[cat] || { label: cat, icon: Tag }
                  const Icon = meta.icon
                  return (
                    <span key={cat} className="flex items-center gap-1.5 text-xs text-[#6B6B6B]">
                      <Icon size={12} strokeWidth={2} className="text-[#A3A3A3]" />
                      {meta.label} <span className="text-[#0A0A0A] font-medium">{count}</span>
                    </span>
                  )
                })}
              </div>
            )
          })()}
          <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden mb-6">
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
                className="w-20 bg-white border border-[#E5E5E5] rounded-md px-3 py-4 outline-none text-[#0A0A0A] text-sm text-center focus:border-[#3D5AFE] transition-colors"
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
              />
            )}
            <button
              onClick={tripMode === 'multi' ? handleGenerateMultiCity : handleGenerateItinerary}
              disabled={generating || (tripMode === 'single' ? !tripId : !cities.some(c => c.name.trim()))}
              className="flex-1 py-4 bg-[#0A0A0A] text-white rounded-md font-medium text-sm hover:bg-[#0A0A0A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Building your itinerary...' : itinerary ? 'Regenerate itinerary →' : 'Generate itinerary →'}
            </button>
            <p className="text-xs text-[#A3A3A3] text-center mt-2">We’ll put it together. You can tweak anything after.</p>
          </div>
        </div>
      )}
      </>)} {/* end !tripSaved */}

      {/* Manual itinerary builder — shown before generate when no itinerary yet, AI mode only */}
      {!tripSaved && !itinerary && buildMode === 'ai' && destination.trim() && editableDays.length > 0 && (
        <div className="w-full max-w-2xl mt-8">
          <p className="text-xs uppercase tracking-widest text-[#6B6B6B] mb-4">
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
        <div className="w-full max-w-[1400px] mt-10">
          {/* Share toast */}
          {shareToast && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#0A0A0A] text-white text-xs px-4 py-2.5 rounded-md shadow-lg z-50">
              {shareToast}
            </div>
          )}
          {/* View-only banner */}
          {viewOnly && (
            <div className="flex items-center justify-center gap-1.5 mb-4 px-4 py-2.5 bg-[#EFEFEF] rounded-md text-xs text-[#6B6B6B] text-center">
              <Eye size={12} strokeWidth={2} /> View-only — ask the trip owner for the edit link to make changes
            </div>
          )}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold text-[#0A0A0A] leading-tight">{destination || 'Your trip'}</h2>
              <p className="text-xs text-[#6B6B6B] mt-0.5">
                {editableDays.length} day{editableDays.length !== 1 ? 's' : ''}
                {startDate && ` · starts ${new Date(startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                {!viewOnly && tripSaved && <span className="inline-flex items-center gap-1 text-[#7A9E7E] font-medium ml-2"><Check size={11} strokeWidth={2.5} /> Saved</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 relative">
              {tripId && !viewOnly && (
                <ShareButton onShare={shareLink} />
              )}
              {!viewOnly && !tripSaved && (
                <button
                  onClick={handleSaveTrip}
                  className="text-xs px-3 py-1.5 bg-[#0A0A0A] text-white rounded-lg hover:bg-[#0A0A0A] transition-colors"
                >
                  Save trip
                </button>
              )}
              {!viewOnly && (
                <button
                  onClick={() => setShowTripMenu(v => !v)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6B6B6B] hover:text-[#0A0A0A] hover:bg-black/[0.04] transition-colors"
                  aria-label="Trip options"
                >
                  <MoreHorizontal size={16} strokeWidth={2} />
                </button>
              )}
              {showTripMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowTripMenu(false)} />
                  <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-[#E5E5E5] rounded-lg shadow-lg z-40 p-4 space-y-4">
                    {undoSnapshot && (
                      <button
                        onClick={() => { handleUndo(); setShowTripMenu(false) }}
                        className="w-full flex items-center gap-2 text-xs text-[#6B6B6B] hover:text-[#3D5AFE] transition-colors"
                      >
                        <Undo2 size={13} strokeWidth={2} /> Undo last change
                      </button>
                    )}
                    {canExport && (
                      <button
                        onClick={() => { exportToICS(); setShowTripMenu(false) }}
                        className="w-full flex items-center gap-2 text-xs text-[#6B6B6B] hover:text-[#3D5AFE] transition-colors"
                      >
                        <CalendarDays size={13} strokeWidth={2} /> Export to calendar
                      </button>
                    )}
                    <div className="pt-3 border-t border-[#EFEFEF]">
                      <label className="block text-[10px] font-semibold text-[#3D5AFE] uppercase tracking-widest mb-2">Start date</label>
                      <input
                        type="date"
                        min="2026-01-01"
                        value={startDate}
                        onChange={e => tripSaved ? handleStartDateChange(e.target.value) : setStartDate(e.target.value)}
                        className="w-full bg-white border border-[#E5E5E5] rounded-md px-3 py-1.5 outline-none text-sm text-[#0A0A0A] focus:border-[#3D5AFE] transition-colors"
                      />
                    </div>
                    {tripSaved && (
                      <div>
                        <label className="block text-[10px] font-semibold text-[#3D5AFE] uppercase tracking-widest mb-2">
                          {tripMode === 'multi' ? 'Days per city' : 'Duration'}
                        </label>
                        {tripMode === 'multi' ? (
                          <div className="flex flex-col gap-1.5">
                            {cities.map((city, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className="text-xs text-[#0A0A0A] font-medium flex-1 truncate">{city.name}</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={14}
                                  value={city.days}
                                  onChange={e => setCities(prev => prev.map((c, j) => j === i ? { ...c, days: Number(e.target.value) } : c))}
                                  className="w-12 bg-white border border-[#E5E5E5] rounded-md px-2 py-1 text-xs text-[#0A0A0A] outline-none focus:border-[#3D5AFE] text-center"
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={duration}
                            onChange={e => setDuration(Number(e.target.value))}
                            className="w-16 bg-white border border-[#E5E5E5] rounded-md px-2 py-1.5 text-sm text-[#0A0A0A] outline-none focus:border-[#3D5AFE] text-center"
                          />
                        )}
                        <button
                          onClick={() => { (tripMode === 'multi' ? handleGenerateMultiCity : handleGenerateItinerary)(); setShowTripMenu(false) }}
                          disabled={generating}
                          className="w-full mt-3 text-xs px-3 py-1.5 bg-[#0A0A0A] text-white rounded-lg hover:bg-[#0A0A0A] transition-colors disabled:opacity-50"
                        >
                          {generating ? 'Regenerating...' : 'Regenerate'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Workspace: map is the main character. Single-city trips get a full-bleed map
              with the planner floating on top (bottom sheet on mobile, side card on desktop).
              Multi-city trips keep a side-by-side layout since they render several stacked maps. */}
          {(() => {
            const isMultiCity = destination.includes('→') || editableDays.some((d: any) => d.city)

            const unscheduledInner = (
              <>
                <div className="mb-3">
                  <PlaceSearch
                    tripId={tripId || ''}
                    destination={destination}
                    onSaved={place => setPlaces(prev => [...prev, place])}
                  />
                </div>
                {unscheduledPlaces.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {unscheduledPlaces.map((place, i) => (
                    <div key={i} className="bg-white border border-[#E5E5E5] rounded-md p-3 group relative">
                      <button
                        onClick={async () => {
                          setPlaces(prev => prev.filter(p => p.name !== place.name))
                          await supabase.from('places').delete().eq('trip_id', tripId).eq('name', place.name)
                        }}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[#A3A3A3] hover:text-red-400 text-lg leading-none"
                        aria-label="Remove place"
                      >
                        ×
                      </button>
                      <p className="text-xs text-[#3D5AFE] uppercase tracking-wider mb-1">
                        {place.category}
                      </p>
                      <p className="text-sm font-medium text-[#0A0A0A] mb-2">{place.name}</p>
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
                        className="w-full text-xs bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg px-2 py-1.5 text-[#6B6B6B] outline-none focus:border-[#3D5AFE] cursor-pointer"
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
              </>
            )

            const renderItineraryPanel = (layout: 'stack' | 'carousel' = 'stack') => (
              <>
                {/* Unscheduled places — always visible on desktop; collapsed behind a toggle
                    on mobile so it doesn't push the actual itinerary below the fold. */}
                {!viewOnly && tripId && (
                  layout === 'carousel' ? (
                    <div className="shrink-0 mb-2">
                      <button
                        onClick={() => setShowUnscheduledMobile(v => !v)}
                        className="w-full flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black/[0.03] text-xs text-[#6B6B6B] hover:text-[#0A0A0A] transition-colors"
                      >
                        <Plus size={12} strokeWidth={2} />
                        Also saved{unscheduledPlaces.length > 0 ? ` (${unscheduledPlaces.length})` : ''}
                        <ChevronDown size={12} strokeWidth={2} className={`ml-auto transition-transform ${showUnscheduledMobile ? 'rotate-180' : ''}`} />
                      </button>
                      {showUnscheduledMobile && <div className="mt-2">{unscheduledInner}</div>}
                    </div>
                  ) : (
                    <div className="mb-8">
                      <p className="text-xs uppercase tracking-widest text-[#6B6B6B] mb-3">
                        Also saved — didn't fit this trip
                      </p>
                      {unscheduledInner}
                    </div>
                  )
                )}
                {/* Draggable day cards */}
                <div className={layout === 'carousel' ? 'flex-1 min-h-0' : ''}>
                  <ItineraryEditor days={editableDays} onChange={handleDaysChange} startDate={startDate} viewOnly={viewOnly} destination={destination} onHoverStop={setHoveredStopId} highlightedStopId={hoveredStopId} layout={layout} />
                </div>
              </>
            )

            // Tap a day to jump straight to its card — a lighter-weight alternative
            // to a full swipe carousel that still works well on mobile.
            const dayLegend = (
              <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {editableDays.map((day: Day, i: number) => (
                  <button
                    key={i}
                    onClick={() => document.getElementById(`day-${day.day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full border border-[#E5E5E5] hover:border-[#3D5AFE] transition-colors"
                  >
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: DAY_COLORS[i % DAY_COLORS.length]
                    }} />
                    <span className="text-xs text-[#6B6B6B] whitespace-nowrap">Day {day.day} — {day.title}</span>
                  </button>
                ))}
              </div>
            )

            const MarkerPin = ({ marker, highlighted }: { marker: any; highlighted?: boolean }) => (
              <div style={{
                background: highlighted ? marker.color : 'rgba(255,255,255,0.92)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderRadius: '20px',
                padding: highlighted ? '6px 12px' : '5px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                fontWeight: 600,
                boxShadow: highlighted ? `0 4px 16px ${marker.color}66, 0 0 0 3px ${marker.color}33` : '0 2px 8px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                maxWidth: 180,
                color: highlighted ? 'white' : '#0A0A0A',
                transform: highlighted ? 'scale(1.12)' : 'scale(1)',
                transition: 'all 0.15s ease',
                zIndex: highlighted ? 10 : 1,
              }}>
                <span style={{
                  background: highlighted ? 'rgba(255,255,255,0.3)' : marker.color,
                  borderRadius: '50%',
                  width: 18,
                  height: 18,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: 10,
                  color: 'white',
                  fontWeight: 700,
                }}>{marker.day}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{marker.name}</span>
              </div>
            )

            // No geocoded stops yet (e.g. just-added manual stops) — show the planner
            // without a map rather than rendering an empty one.
            if (mapMarkers.length === 0) {
              return (
                <div className="flex flex-col gap-4">
                  {dayLegend}
                  {renderItineraryPanel()}
                </div>
              )
            }

            if (!isMultiCity) {
              const hoveredMarker = mapMarkers.find((m: any) => m.id === hoveredStopId) || null
              const geoMarkers = mapMarkers.map((m: any) => ({ lat: m.lat, lng: m.lng }))

              const buildMapNode = (panelPaddingLeft: number) => (
                <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
                  <Map
                    defaultCenter={mapCenter}
                    defaultZoom={12}
                    mapId="mapture-map"
                    gestureHandling="greedy"
                    disableDefaultUI
                    zoomControl
                    style={{ width: '100%', height: '100%' }}
                  >
                    <MapController markers={geoMarkers} hoveredMarker={hoveredMarker} panelPaddingLeft={panelPaddingLeft} />
                    {mapMarkers.map((marker: any, i: number) => (
                      <AdvancedMarker
                        key={i}
                        position={{ lat: marker.lat, lng: marker.lng }}
                        title={marker.name}
                        zIndex={marker.id === hoveredStopId ? 999 : i}
                        onClick={(e: any) => {
                          const de = e.domEvent
                          if (de) handleMarkerClick(marker.id, new DOMRect(de.clientX, de.clientY, 0, 0))
                        }}
                      >
                        <MarkerPin marker={marker} highlighted={marker.id === hoveredStopId} />
                      </AdvancedMarker>
                    ))}
                  </Map>
                </APIProvider>
              )

              return (
                <>
                  {/* Desktop: full-bleed map with the planner floating on top as a side card.
                      Drag the handle on its right edge to resize — the map re-centers around it.
                      Hovering a stop pans the map to it and highlights its pin. */}
                  <div className="hidden lg:block relative w-full rounded-lg overflow-hidden" style={{ height: '72vh', minHeight: 460 }}>
                    <div className="absolute inset-0">{buildMapNode(panelWidthPx + 32)}</div>
                    <div className="absolute z-10 bg-white shadow-2xl flex flex-col rounded-lg left-4 top-4 bottom-4" style={{ width: panelWidthPx }}>
                      <div className="overflow-y-auto p-4 flex-1">
                        <div className="mb-4">{dayLegend}</div>
                        {renderItineraryPanel()}
                      </div>
                      <div
                        onPointerDown={handlePanelResizeStart}
                        className="absolute top-0 bottom-0 -right-2.5 w-5 cursor-ew-resize group flex items-center justify-center"
                        title="Drag to resize"
                      >
                        <div className="flex items-center justify-center w-4 h-9 rounded-full bg-white border border-[#E5E5E5] shadow-sm group-hover:border-[#3D5AFE] group-active:border-[#3D5AFE] transition-colors">
                          <GripVertical size={11} strokeWidth={2} className="text-[#A3A3A3] group-hover:text-[#3D5AFE] transition-colors" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Mobile: map always visible as the base layer, itinerary as a draggable sheet on top.
                      Drag the handle to reveal more or less — never a full stack, never map-less. */}
                  <div ref={workspaceBoxRef} className="lg:hidden relative w-full rounded-lg overflow-hidden" style={{ height: '80vh', minHeight: 520 }}>
                    <div className="absolute inset-0">{buildMapNode(0)}</div>
                    <div
                      className="absolute z-10 inset-x-0 bottom-0 bg-white shadow-2xl flex flex-col rounded-t-2xl"
                      style={{ height: `${sheetHeightVh}%`, transition: 'height 0.15s ease' }}
                    >
                      <div
                        onPointerDown={handleSheetDragStart}
                        className="flex flex-col items-center gap-1 pt-2 pb-2.5 shrink-0 cursor-ns-resize touch-none active:bg-black/[0.02]"
                      >
                        <div className="w-12 h-1.5 rounded-full bg-[#D4D4D4]" />
                        <ChevronsUpDown size={12} strokeWidth={2} className="text-[#C4C4C4]" />
                      </div>
                      {editableDays.length > 1 && (
                        <div className="px-4 pb-2 shrink-0">{dayLegend}</div>
                      )}
                      <div className="flex flex-col flex-1 min-h-0 px-4 pb-3 overflow-hidden">
                        {renderItineraryPanel('carousel')}
                      </div>
                    </div>
                  </div>
                </>
              )
            }

            // Multi-city: group markers by city, render one map per city, planner alongside
            const cityGroups: Record<string, { markers: any[]; color: string }> = {}
            editableDays.forEach((day: any, dayIndex: number) => {
              // Use day.city if present, otherwise extract from title (e.g. "Paris — Montmartre" → "Paris")
              const city = day.city || (day.title?.includes('—') ? day.title.split('—')[0].trim() : day.title) || `Day ${day.day}`
              if (!cityGroups[city]) cityGroups[city] = { markers: [], color: DAY_COLORS[dayIndex % DAY_COLORS.length] }
              day.stops.forEach((stop: any) => {
                if (stop.lat && stop.lng) {
                  cityGroups[city].markers.push({ id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lng, day: day.day, color: DAY_COLORS[dayIndex % DAY_COLORS.length] })
                }
              })
            })

            return (
              <div className="flex flex-col lg:flex-row gap-6 items-start">
                <div className="w-full lg:w-[58%] lg:sticky lg:top-6 flex flex-col gap-4">
                  <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
                    <div className="flex flex-col gap-5">
                      {Object.entries(cityGroups).filter(([, g]) => g.markers.length > 0).map(([city, group]) => {
                        const lats = group.markers.map(m => m.lat)
                        const lngs = group.markers.map(m => m.lng)
                        const centerLat = (Math.max(...lats) + Math.min(...lats)) / 2
                        const centerLng = (Math.max(...lngs) + Math.min(...lngs)) / 2
                        const spread = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs))
                        const zoom = spread < 0.02 ? 14 : spread < 0.1 ? 13 : spread < 0.5 ? 12 : 11
                        return (
                          <div key={city}>
                            <p className="text-[11px] font-semibold text-[#6B6B6B] uppercase tracking-widest mb-2">{city}</p>
                            <div className="map-container h-56">
                              <Map
                                defaultCenter={{ lat: centerLat, lng: centerLng }}
                                defaultZoom={zoom}
                                mapId={`mapture-map-${city.replace(/\s+/g, '-').toLowerCase()}`}
                                gestureHandling="greedy"
                                disableDefaultUI
                                zoomControl
                                style={{ width: '100%', height: '100%' }}
                              >
                                {group.markers.map((marker: any, i: number) => (
                                  <AdvancedMarker
                                    key={i}
                                    position={{ lat: marker.lat, lng: marker.lng }}
                                    title={marker.name}
                                    onClick={(e: any) => {
                                      const de = e.domEvent
                                      if (de) handleMarkerClick(marker.id, new DOMRect(de.clientX, de.clientY, 0, 0))
                                    }}
                                  >
                                    <MarkerPin marker={marker} />
                                  </AdvancedMarker>
                                ))}
                              </Map>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </APIProvider>
                  {dayLegend}
                </div>
                <div className="w-full lg:w-[42%] flex flex-col gap-4">
                  {renderItineraryPanel()}
                </div>
              </div>
            )
          })()}
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

      {/* Map pin click → same rich popup used for place names (photo, rating, hours, tip) */}
      {markerPopup && (() => {
        const clickedStop = editableDays.flatMap((d: Day) => d.stops).find((s: any) => s.id === markerPopup.stopId)
        if (!clickedStop) return null
        return (
          <PlaceListPopup
            place={clickedStop}
            destination={destination}
            anchorRect={markerPopup.anchorRect}
            onClose={() => setMarkerPopup(null)}
          />
        )
      })()}

      {/* Persistent AI assist — small footprint, not a page takeover */}
      {itinerary?.days && !viewOnly && (
        <>
          <button
            onClick={() => setShowAskMapture(v => !v)}
            className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 bg-[#0A0A0A] text-white rounded-full shadow-lg hover:bg-black transition-colors"
          >
            <Sparkles size={15} strokeWidth={2} className="text-[#3D5AFE]" />
            Ask Mapture
          </button>

          {showAskMapture && (
            <div className="fixed bottom-24 right-6 z-40 w-80 bg-white border border-[#E5E5E5] rounded-lg shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: 440 }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#EFEFEF] shrink-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[#0A0A0A]">
                  <Sparkles size={13} strokeWidth={2} className="text-[#3D5AFE]" /> Ask Mapture
                </span>
                <button onClick={() => setShowAskMapture(false)} className="text-[#A3A3A3] hover:text-[#0A0A0A] transition-colors">
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
              <div ref={agentChatRef} className="flex-1 overflow-y-auto p-3 space-y-2" style={{ minHeight: 160 }}>
                {agentMessages.length === 0 && (
                  <p className="text-xs text-[#6B6B6B] p-1 leading-relaxed">
                    Ask me to adjust your trip — "make Shibuya its own day," "what's a good order for these stops," "swap day 2 and day 3."
                  </p>
                )}
                {agentMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`text-xs rounded-lg px-3 py-2 max-w-[85%] leading-relaxed ${msg.role === 'user' ? 'bg-[#3D5AFE] text-white ml-auto' : 'bg-[#EFEFEF] text-[#0A0A0A]'}`}
                  >
                    {msg.content}
                  </div>
                ))}
                {agentLoading && <div className="text-xs text-[#A3A3A3] px-1 py-1">Thinking...</div>}
              </div>
              <div className="flex items-center gap-2 p-2.5 border-t border-[#EFEFEF] shrink-0">
                <input
                  value={agentInput}
                  onChange={e => setAgentInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !agentLoading) { e.preventDefault(); handleAgentSend() } }}
                  placeholder="Ask about your trip..."
                  className="flex-1 text-xs bg-white border border-[#E5E5E5] rounded-md px-3 py-2 outline-none focus:border-[#3D5AFE] transition-colors"
                  disabled={agentLoading}
                />
                <button
                  onClick={() => handleAgentSend()}
                  disabled={!agentInput.trim() || agentLoading}
                  className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md bg-[#3D5AFE] text-white disabled:opacity-40 hover:bg-[#2E45D6] transition-colors"
                >
                  <ArrowRight size={14} strokeWidth={2} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}