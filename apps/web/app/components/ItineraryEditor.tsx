'use client'

import { useState, useEffect, useRef } from 'react'
import { DndContext, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, closestCorners, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const DAY_COLORS = ['#C17B4E', '#7A9E7E', '#5C8AAE', '#9B6DAB', '#B85C38']

export interface Stop {
  id: string; time: string; manualTime?: boolean
  name: string; category: string; note?: string; suggested?: boolean
  lat?: number; lng?: number; opening_hours?: string[]
  photo_reference?: string; rating?: number; price_level?: number; address?: string
}

export interface Day {
  day: number; title: string; stops: Stop[]
}

interface Props {
  days: Day[]; onChange: (days: Day[]) => void
  startDate?: string; viewOnly?: boolean; destination?: string
}

// Parse time from text like "beach 9am" → { name: "beach", time: "9:00 AM" }
function extractTimeFromText(text: string): { name: string; time: string | null } {
  const timeRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  const m = text.match(timeRegex)
  if (!m) return { name: text.trim(), time: null }
  let h = parseInt(m[1])
  const min = parseInt(m[2] || '0')
  const p = m[3].toLowerCase()
  if (p === 'pm' && h !== 12) h += 12
  if (p === 'am' && h === 12) h = 0
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 || 12
  const time = `${display}:${String(min).padStart(2, '0')} ${period}`
  const name = text.replace(timeRegex, '').replace(/\s+/g, ' ').trim()
  return { name: name || text.trim(), time }
}

function getDayDate(startDate: string, dayIndex: number): string | null {
  if (!startDate) return null
  const d = new Date(startDate + 'T00:00:00')
  d.setDate(d.getDate() + dayIndex)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Parse "Monday: 8:00 AM – 10:00 PM" → { open: 480, close: 1320 } in minutes
function parseHoursLine(line: string): { open: number; close: number } | null {
  const m = line.match(/:\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!m) return null
  const toMin = (h: string, min: string, period: string) => {
    let hh = parseInt(h)
    if (period.toUpperCase() === 'PM' && hh !== 12) hh += 12
    if (period.toUpperCase() === 'AM' && hh === 12) hh = 0
    return hh * 60 + parseInt(min)
  }
  return { open: toMin(m[1], m[2], m[3]), close: toMin(m[4], m[5], m[6]) }
}

// Returns today's hours line from weekday_text array (uses current day of week as fallback)
function getTodayHours(opening_hours: string[]): string | null {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const today = days[new Date().getDay()]
  return opening_hours.find(h => h.startsWith(today)) || opening_hours[0] || null
}

// Returns true if the stop's scheduled time is outside opening hours
function isOutsideHours(time: string, opening_hours: string[]): boolean {
  const hoursLine = getTodayHours(opening_hours)
  if (!hoursLine) return false
  if (hoursLine.toLowerCase().includes('closed')) return true
  const range = parseHoursLine(hoursLine)
  if (!range) return false
  const stopMin = parseTime(time)
  if (stopMin === 0) return false
  return stopMin < range.open || stopMin >= range.close
}

// Format hours for display: "Mon: 8:00 AM – 10:00 PM" → "8 AM – 10 PM"
function formatHoursShort(line: string): string {
  return line.replace(/^[^:]+:\s*/, '').replace(/:00/g, '').trim()
}

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[#C8BFB0]">
      <circle cx="4" cy="3" r="1.2" fill="currentColor" />
      <circle cx="10" cy="3" r="1.2" fill="currentColor" />
      <circle cx="4" cy="7" r="1.2" fill="currentColor" />
      <circle cx="10" cy="7" r="1.2" fill="currentColor" />
      <circle cx="4" cy="11" r="1.2" fill="currentColor" />
      <circle cx="10" cy="11" r="1.2" fill="currentColor" />
    </svg>
  )
}

function StopRow({ stop, dayColor, onDelete, onTimeChange, onNoteChange, onNameChange, viewOnly = false, destination = '' }: {
  stop: Stop; dayColor: string; onDelete: () => void
  onTimeChange: (time: string) => void; onNoteChange: (note: string) => void
  onNameChange: (name: string) => void
  viewOnly?: boolean; destination?: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id })
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [showPopup, setShowPopup] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }

  return (
    <div ref={setNodeRef} style={style} className="flex gap-3 px-4 py-3 items-start group border-b border-[#F5F0E8] last:border-0 bg-white">
      {!viewOnly && (
        <button {...attributes} {...listeners} className="mt-1 cursor-grab active:cursor-grabbing opacity-40 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0 touch-none" aria-label="Drag to reorder">
          <GripIcon />
        </button>
      )}
      <div className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: stop.suggested ? 'transparent' : dayColor, border: stop.suggested ? `2px dashed ${dayColor}` : 'none' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {!viewOnly && editing ? (
            <div className="flex flex-col gap-0.5">
              <input type="text" autoFocus defaultValue={stop.time} placeholder="9:00 AM"
                onChange={() => setError(false)}
                onBlur={e => {
                  const val = e.target.value.trim()
                  if (!val) { setEditing(false); setError(false); return }
                  const n = normalizeTimeInput(val)
                  if (n) { setEditing(false); setError(false); onTimeChange(n) }
                  else { setError(true); e.target.focus() }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') { setEditing(false); setError(false) }
                }}
                className={`text-xs w-20 border-b outline-none bg-transparent pb-0.5 ${error ? 'border-red-400 text-red-400' : 'border-[#C17B4E] text-[#C17B4E]'}`}
              />
              {error && <span className="text-xs text-red-400">try "9:30 AM" or "14:00"</span>}
            </div>
          ) : (
            <button onClick={() => !viewOnly && setEditing(true)} className={`text-xs text-[#8C8070] w-14 shrink-0 text-left transition-colors ${!viewOnly ? 'hover:text-[#C17B4E] cursor-pointer' : 'cursor-default'}`}>
              {stop.time}
            </button>
          )}
          <div className="relative flex-1 min-w-0">
            {editingName ? (
              <input
                autoFocus
                type="text"
                defaultValue={stop.name}
                onBlur={e => {
                  setEditingName(false)
                  const val = e.target.value.trim()
                  if (val && val !== stop.name) onNameChange(val)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditingName(false)
                }}
                className="text-sm font-medium text-[#2C2416] w-full border-b border-[#C17B4E] outline-none bg-transparent pb-0.5"
              />
            ) : stop.lat && stop.lng ? (
              <button
                onClick={e => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setAnchorRect(rect)
                  setShowPopup(p => !p)
                }}
                onDoubleClick={() => { if (!viewOnly) setEditingName(true) }}
                className="text-sm font-medium text-[#2C2416] truncate hover:text-[#C17B4E] transition-colors text-left w-full flex items-center gap-1 group/place"
                title={!viewOnly ? 'Click for details · Double-click to edit name' : 'View place details'}
              >
                <span className="text-[#C8BFB0] group-hover/place:text-[#C17B4E] transition-colors shrink-0 text-xs">📍</span>
                <span className="truncate" style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', textDecorationColor: '#C8BFB0', textUnderlineOffset: '3px' }}>{stop.name}</span>
              </button>
            ) : (
              <p
                onDoubleClick={() => { if (!viewOnly) setEditingName(true) }}
                className={`text-sm font-medium text-[#2C2416] truncate ${!viewOnly ? 'cursor-text' : ''}`}
                title={!viewOnly ? 'Double-click to edit name' : undefined}
              >
                {stop.name}
              </p>
            )}
            {showPopup && anchorRect && (
              <PlacePopup
                stop={stop}
                destination={destination}
                anchorRect={anchorRect}
                onClose={() => setShowPopup(false)}
              />
            )}
          </div>
          {stop.suggested && <span className="text-xs px-2 py-0.5 rounded-full bg-[#F5F0E8] text-[#8C8070] shrink-0">suggested</span>}
          {stop.opening_hours && (
            <button
              onClick={() => setShowPopup(p => !p)}
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[#C8BFB0] hover:text-[#8C8070] text-xs"
              title="Show opening hours"
            >
              🕐
            </button>
          )}
        </div>
        {editingNote ? (
          <input autoFocus type="text" defaultValue={stop.note}
            onBlur={e => { setEditingNote(false); onNoteChange(e.target.value) }}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditingNote(false)
            }}
            className="text-xs text-[#8C8070] mt-0.5 ml-16 w-[calc(100%-4rem)] bg-transparent border-b border-[#C17B4E] outline-none pb-0.5"
          />
        ) : stop.note ? (
          <p onClick={() => !viewOnly && setEditingNote(true)} className={`text-xs text-[#8C8070] mt-0.5 leading-relaxed pl-16 ${!viewOnly ? 'cursor-pointer hover:text-[#C17B4E] transition-colors' : ''}`}>
            {stop.note}
          </p>
        ) : !viewOnly ? (
          <button onClick={() => setEditingNote(true)} className="text-xs text-[#C8BFB0] mt-0.5 ml-16 hover:text-[#8C8070] transition-colors opacity-0 group-hover:opacity-100">
            + add note
          </button>
        ) : null}
      </div>
      {!viewOnly && (
        <button onClick={onDelete} className="mt-0.5 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-[#C8BFB0] hover:text-red-400 shrink-0 text-lg leading-none" aria-label="Remove stop">×</button>
      )}
    </div>
  )
}

function PlacePopup({ stop, destination, anchorRect, onClose }: {
  stop: Stop; destination: string; anchorRect: DOMRect; onClose: () => void
}) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name + (destination ? ` ${destination}` : ''))}`

  const POPUP_W = 260
  const POPUP_H = 300
  const viewW = typeof window !== 'undefined' ? window.innerWidth : 1200
  const viewH = typeof window !== 'undefined' ? window.innerHeight : 800
  const MARGIN = 8

  // On mobile (narrow screens), center horizontally and pin near anchor vertically
  let left: number
  let top: number
  if (viewW < 500) {
    left = Math.max(MARGIN, (viewW - POPUP_W) / 2)
    top = Math.min(anchorRect.bottom + 4, viewH - POPUP_H - MARGIN)
    if (top < MARGIN) top = MARGIN
  } else {
    left = anchorRect.right + MARGIN
    if (left + POPUP_W > viewW - MARGIN) left = anchorRect.left - POPUP_W - MARGIN
    left = Math.max(MARGIN, left)
    top = anchorRect.top
    if (top + POPUP_H > viewH - MARGIN) top = viewH - POPUP_H - MARGIN
    if (top < MARGIN) top = MARGIN
  }

  // Lazy-fetch place details if we don't already have a photo
  const [fetched, setFetched] = useState<{
    photo_reference?: string; rating?: number; price_level?: number
    address?: string; opening_hours?: string[]
  } | null>(null)
  const [fetchLoading, setFetchLoading] = useState(!stop.photo_reference)

  useEffect(() => {
    // Reset fetched state whenever the stop changes
    setFetched(null)
    if (stop.photo_reference) {
      setFetchLoading(false)
      return
    }
    setFetchLoading(true)
    fetch(`/api/place-search?name=${encodeURIComponent(stop.name)}&location=${encodeURIComponent(destination)}`)
      .then(r => r.json())
      .then(data => {
        if (data.result) setFetched(data.result)
        else console.warn('place-search returned no result for:', stop.name, data.error || '')
      })
      .catch(err => console.warn('place-search fetch error:', err))
      .finally(() => setFetchLoading(false))
  }, [stop.name, stop.photo_reference, destination])

  // Merge fetched data with stop data (stop data takes priority if already set)
  const photoRef = stop.photo_reference || fetched?.photo_reference
  const resolvedPhotoUrl = photoRef ? `/api/place-photo?ref=${encodeURIComponent(photoRef)}` : null
  const resolvedRating = stop.rating ?? fetched?.rating
  const resolvedPriceLevel = stop.price_level ?? fetched?.price_level
  const resolvedAddress = stop.address || fetched?.address
  const resolvedHours = stop.opening_hours || fetched?.opening_hours
  const resolvedHoursLine = resolvedHours ? getTodayHours(resolvedHours) : null
  const resolvedOutside = resolvedHours && stop.time ? isOutsideHours(stop.time, resolvedHours) : false
  const resolvedPriceStr = resolvedPriceLevel != null ? '$'.repeat(resolvedPriceLevel + 1) : null

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
        ) : resolvedPhotoUrl ? (
          <img
            key={resolvedPhotoUrl}
            src={resolvedPhotoUrl}
            alt={stop.name}
            className="w-full object-cover"
            style={{ height: 140 }}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="w-full flex items-center justify-center bg-[#F5F0E8]" style={{ height: 80 }}>
            <span className="text-3xl">📍</span>
          </div>
        )}
        <div className="p-3">
          <p className="text-sm font-semibold text-[#2C2416] leading-snug">{stop.name}</p>
          {(resolvedRating || resolvedPriceStr) && (
            <div className="flex items-center gap-2 mt-0.5">
              {resolvedRating && <span className="text-xs text-[#8C8070]">⭐ {resolvedRating.toFixed(1)}</span>}
              {resolvedPriceStr && <span className="text-xs text-[#8C8070]">{resolvedPriceStr}</span>}
            </div>
          )}
          {resolvedHoursLine && (
            <p className={`text-xs mt-1 ${resolvedOutside ? 'text-amber-500 font-medium' : 'text-[#8C8070]'}`}>
              {resolvedOutside ? '⚠️ May be closed · ' : ''}{formatHoursShort(resolvedHoursLine)}
            </p>
          )}
          {resolvedAddress && (
            <p className="text-xs text-[#C8BFB0] mt-0.5 truncate">{resolvedAddress}</p>
          )}
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 inline-flex items-center gap-1 text-xs text-[#C17B4E] hover:text-[#8B5330] font-medium transition-colors"
          >
            Open in Google Maps ↗
          </a>
        </div>
      </div>
    </>
  )
}

function DragOverlayCard({ stop, dayColor }: { stop: Stop; dayColor: string }) {
  return (
    <div className="flex gap-3 px-4 py-3 items-start bg-white border border-[#E8DFD0] rounded-xl shadow-lg">
      <GripIcon />
      <div className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: dayColor }} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8C8070] w-14 shrink-0">{stop.time}</span>
          <p className="text-sm font-medium text-[#2C2416]">{stop.name}</p>
        </div>
      </div>
    </div>
  )
}
function AddStopInput({ onAdd, destination }: {
  onAdd: (name: string, note?: string, time?: string, lat?: number, lng?: number) => void
  destination: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionToken = useRef<string>('')

  useEffect(() => { sessionToken.current = crypto.randomUUID() }, [])

  function updatePos() {
    const el = inputRef.current || wrapperRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280) })
  }

  useEffect(() => {
    if (!open) return
    const t = setTimeout(updatePos, 30)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!query.trim() || query.length < 2) { setSuggestions([]); setShowSuggestions(false); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places-autocomplete?q=${encodeURIComponent(query)}&location=${encodeURIComponent(destination)}&session=${sessionToken.current}`)
        const data = await res.json()
        setSuggestions(data.predictions || [])
        if (data.predictions?.length > 0) { updatePos(); setShowSuggestions(true) }
      } catch { setSuggestions([]) }
    }, 300)
  }, [query, destination])

  async function handleSelect(prediction: any) {
    setShowSuggestions(false)
    const name = prediction.structured_formatting?.main_text || prediction.description
    const note = prediction.structured_formatting?.secondary_text || ''
    const token = sessionToken.current
    sessionToken.current = crypto.randomUUID()

    // Fetch coordinates for the selected place
    let lat: number | undefined
    let lng: number | undefined
    try {
      const res = await fetch(`/api/places-details?placeId=${prediction.place_id}&session=${token}`)
      const data = await res.json()
      lat = data.result?.geometry?.location?.lat
      lng = data.result?.geometry?.location?.lng
    } catch {}

    onAdd(name, note, undefined, lat, lng)
    setQuery('')
    setOpen(false)
  }

  function handleManualAdd() {
    if (!query.trim()) return
    const { name, time } = extractTimeFromText(query)
    onAdd(name, undefined, time || undefined)
    setQuery('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full text-left px-4 py-2.5 text-xs text-[#8C8070] hover:text-[#C17B4E] hover:bg-[#FEF8F4] transition-colors flex items-center gap-2">
        <span className="text-base leading-none">+</span> Add a place
      </button>
    )
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="px-4 py-2.5 flex items-center gap-2 bg-[#FDFAF5]">
        <input
          ref={inputRef}
          autoFocus type="text" value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={updatePos}
          onKeyDown={e => {
            if (e.key === 'Enter') { setShowSuggestions(false); handleManualAdd() }
            if (e.key === 'Escape') { setOpen(false); setQuery(''); setShowSuggestions(false) }
          }}
          placeholder='e.g. "lunch 1pm" or search a place...'
          className="flex-1 bg-transparent outline-none text-sm text-[#2C2416] placeholder:text-[#C8BFB0]"
        />
        <button onClick={handleManualAdd} className="text-xs text-[#C17B4E] font-medium hover:text-[#8B5330]">Add</button>
        <button onClick={() => { setOpen(false); setQuery(''); setShowSuggestions(false) }} className="text-xs text-[#8C8070] hover:text-[#2C2416]">Cancel</button>
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowSuggestions(false)} />
          <div className="fixed bg-white border border-[#E8DFD0] rounded-xl shadow-lg overflow-hidden z-50 max-h-48 overflow-y-auto"
            style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}>
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => handleSelect(s)} className="w-full text-left px-4 py-2.5 hover:bg-[#FEF8F4] transition-colors border-b border-[#F5F0E8] last:border-0">
                <p className="text-sm text-[#2C2416] font-medium truncate">{s.structured_formatting?.main_text || s.description}</p>
                <p className="text-xs text-[#8C8070] truncate">{s.structured_formatting?.secondary_text || ''}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function DroppableDay({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id })
  return <div ref={setNodeRef} className="min-h-[2rem]">{children}</div>
}

function DayTitle({ title, dayIndex, viewOnly, onChange }: {
  title: string; dayIndex: number; viewOnly: boolean; onChange: (t: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== title) onChange(trimmed)
    else setDraft(title)
  }
  if (editing) {
    return (
      <input autoFocus type="text" value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(title); setEditing(false) }
        }}
        className="text-sm font-medium text-[#2C2416] bg-transparent border-b border-[#C17B4E] outline-none pb-0.5 w-40"
      />
    )
  }
  return (
    <span
      onDoubleClick={() => { if (!viewOnly) { setDraft(title); setEditing(true) } }}
      className={`text-sm font-medium text-[#2C2416] ${!viewOnly ? 'cursor-text select-none' : ''}`}
      title={!viewOnly ? 'Double-click to edit' : undefined}
    >
      {title}
    </span>
  )
}

export default function ItineraryEditor({ days, onChange, startDate = '', viewOnly = false, destination = '' }: Props) {
  const [activeStop, setActiveStop] = useState<{ stop: Stop; dayIndex: number } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: viewOnly ? { distance: 999999 } : { distance: 5 } }))

  function update(newDays: Day[]) {
    onChange(newDays.map(d => ({ ...d, stops: recalcTimes(d.stops) })))
  }

  function findDayIndexByStopId(stopId: string): number {
    return days.findIndex(d => d.stops.some(s => s.id === stopId))
  }

  function updateDayTitle(dayIndex: number, title: string) {
    onChange(days.map((d, i) => i === dayIndex ? { ...d, title } : d))
  }

  function handleDragStart(event: DragStartEvent) {
    const stopId = event.active.id as string
    const dayIndex = findDayIndexByStopId(stopId)
    if (dayIndex === -1) return
    setActiveStop({ stop: days[dayIndex].stops.find(s => s.id === stopId)!, dayIndex })
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = active.id as string
    const overId = over.id as string
    const activeDayIdx = findDayIndexByStopId(activeId)
    const overDayIdx = overId.startsWith('day-') ? days.findIndex(d => `day-${d.day}` === overId) : findDayIndexByStopId(overId)
    if (activeDayIdx === -1 || overDayIdx === -1 || activeDayIdx === overDayIdx) return
    const newDays = days.map(d => ({ ...d, stops: [...d.stops] }))
    const stop = newDays[activeDayIdx].stops.find(s => s.id === activeId)!
    newDays[activeDayIdx].stops = newDays[activeDayIdx].stops.filter(s => s.id !== activeId)
    // When moving to a new day, keep the stop's time but clear manualTime so recalcTimes
    // can assign a sensible default if the time is a category default
    newDays[overDayIdx].stops.push({ ...stop, manualTime: !!stop.manualTime })
    update(newDays)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveStop(null)
    if (!over || active.id === over.id) return
    const activeId = active.id as string
    const overId = over.id as string
    const dayIdx = findDayIndexByStopId(activeId)
    if (dayIdx === -1) return
    const stops = days[dayIdx].stops
    const oldIndex = stops.findIndex(s => s.id === activeId)
    const newIndex = stops.findIndex(s => s.id === overId)
    if (oldIndex === -1 || newIndex === -1) return

    // Reorder the stops array to match the drag result
    const reordered = arrayMove(stops, oldIndex, newIndex)

    // Redistribute times to match the new visual order:
    // collect all times sorted ascending, then assign them in position order
    const sortedTimes = [...reordered]
      .map(s => parseTime(s.time))
      .filter(t => t > 0)
      .sort((a, b) => a - b)

    const reassigned = reordered.map((s, i) => {
      const mins = sortedTimes[i]
      if (mins == null) return s
      const h = Math.floor(mins / 60)
      const m = mins % 60
      const period = h < 12 ? 'AM' : 'PM'
      const display = h % 12 || 12
      return { ...s, time: `${display}:${String(m).padStart(2, '0')} ${period}`, manualTime: true }
    })

    onChange(days.map((d, i) => i === dayIdx ? { ...d, stops: reassigned } : d))
  }

  function updateStopTime(dayIndex: number, stopId: string, time: string) {
    const newDays = days.map((d, i) => {
      if (i !== dayIndex) return d
      const updated = d.stops.map(s => s.id === stopId ? { ...s, time, manualTime: true } : s)
      return { ...d, stops: [...updated].sort((a, b) => parseTime(a.time) - parseTime(b.time)) }
    })
    onChange(newDays)
  }

  function updateStopNote(dayIndex: number, stopId: string, note: string) {
    onChange(days.map((d, i) => i === dayIndex ? { ...d, stops: d.stops.map(s => s.id === stopId ? { ...s, note } : s) } : d))
  }

  function updateStopName(dayIndex: number, stopId: string, name: string) {
    onChange(days.map((d, i) => i === dayIndex ? { ...d, stops: d.stops.map(s => s.id === stopId ? { ...s, name } : s) } : d))
  }

  function deleteStop(dayIndex: number, stopId: string) {
    update(days.map((d, i) => i === dayIndex ? { ...d, stops: d.stops.filter(s => s.id !== stopId) } : d))
  }

  function addStop(dayIndex: number, name: string, note?: string, explicitTime?: string, lat?: number, lng?: number) {
    const day = days[dayIndex]
    const time = explicitTime || formatHour(9 + day.stops.length * 2)
    const newStop: Stop = { id: `manual-${Date.now()}-${Math.random()}`, name, time, category: 'other', note: note || '', suggested: false, lat, lng, manualTime: !!explicitTime }
    if (explicitTime) {
      const newStops = [...day.stops, newStop].sort((a, b) => parseTime(a.time) - parseTime(b.time))
      onChange(days.map((d, i) => i === dayIndex ? { ...d, stops: newStops } : d))
    } else {
      update(days.map((d, i) => i === dayIndex ? { ...d, stops: [...d.stops, newStop] } : d))
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-6">
        {days.map((day, dayIndex) => {
          const color = DAY_COLORS[dayIndex % DAY_COLORS.length]
          return (
            <div key={day.day} id={`day-${day.day}`} className="bg-white border border-[#E8DFD0] rounded-2xl overflow-visible">
              <div className="px-5 py-3 flex items-center gap-3 rounded-t-2xl" style={{ background: `${color}15` }}>
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-xs font-medium uppercase tracking-widest" style={{ color }}>Day {day.day}</span>
                <DayTitle
                  title={day.title}
                  dayIndex={dayIndex}
                  viewOnly={viewOnly}
                  onChange={title => updateDayTitle(dayIndex, title)}
                />
                {getDayDate(startDate, dayIndex) && <span className="text-xs text-[#8C8070] ml-1">· {getDayDate(startDate, dayIndex)}</span>}
                <span className="ml-auto text-xs text-[#C8BFB0]">{day.stops.length} stops</span>
              </div>
              <div className="border border-[#E8DFD0] rounded-b-2xl overflow-hidden">
                <DroppableDay id={`day-${day.day}`}>
                  <SortableContext items={day.stops.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    {day.stops.map(stop => (
                      <StopRow key={stop.id} stop={stop} dayColor={color}
                        onDelete={() => deleteStop(dayIndex, stop.id)}
                        onTimeChange={time => updateStopTime(dayIndex, stop.id, time)}
                        onNoteChange={note => updateStopNote(dayIndex, stop.id, note)}
                        onNameChange={name => updateStopName(dayIndex, stop.id, name)}
                        viewOnly={viewOnly}
                        destination={destination}
                      />
                    ))}
                  </SortableContext>
                </DroppableDay>
                {!viewOnly && <AddStopInput destination={destination} onAdd={(name, note, time, lat, lng) => addStop(dayIndex, name, note, time, lat, lng)} />}
              </div>
            </div>
          )
        })}
      </div>
      <DragOverlay>
        {activeStop && <DragOverlayCard stop={activeStop.stop} dayColor={DAY_COLORS[activeStop.dayIndex % DAY_COLORS.length]} />}
      </DragOverlay>
    </DndContext>
  )
}

const CATEGORY_HOUR: Record<string, number> = {
  // Morning only
  cafe: 9, bakery: 8, breakfast: 8, coffee: 9, brunch: 10,
  // Late morning
  market: 10, park: 10, garden: 10, hike: 9, trail: 9, nature: 10,
  // Midday
  lunch: 12, food: 12,
  // Afternoon
  museum: 14, gallery: 14, shopping: 15, landmark: 14, monument: 14,
  temple: 14, church: 14, tour: 14,
  // Flexible
  beach: 11, viewpoint: 17, sunset: 18,
  // Evening only — never schedule these in the morning
  restaurant: 19, dinner: 19, bar: 20, nightlife: 21, pub: 20, club: 22,
}
function preferredHour(category: string): number {
  const cat = (category || '').toLowerCase()
  for (const [key, hour] of Object.entries(CATEGORY_HOUR)) {
    if (cat.includes(key)) return hour
  }
  return 12
}

export function recalcTimes(stops: Stop[]): Stop[] {
  // Only assign a new time to stops that have a default/empty time — never overwrite manually-set times.
  // A stop is considered manually-timed if it has manualTime: true OR if its time doesn't match
  // the category default (meaning the user changed it).
  return stops.map(stop => {
    if (stop.manualTime) return stop // explicitly flagged as manual
    const defaultTime = formatHour(preferredHour(stop.category))
    if (stop.time && stop.time !== defaultTime && stop.time !== '12:00 PM') {
      // Time differs from what we'd auto-assign — treat as manually set, preserve it
      return stop
    }
    return { ...stop, time: defaultTime }
  })
}

function parseTime(t: string): number {
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 0
  let h = parseInt(m[1])
  const min = parseInt(m[2])
  const p = m[3].toUpperCase()
  if (p === 'PM' && h !== 12) h += 12
  if (p === 'AM' && h === 12) h = 0
  return h * 60 + min
}

function formatHour(hour: number): string {
  const h = hour % 24
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 || 12
  return `${display}:00 ${period}`
}

function normalizeTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/[.\-]/g, ':')
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?$/)
  if (!m) return null
  let h = parseInt(m[1])
  const min = parseInt(m[2] || '0')
  const meridiem = m[3]
  if (min < 0 || min > 59) return null
  if (meridiem === 'pm' && h !== 12) h += 12
  else if (meridiem === 'am' && h === 12) h = 0
  else if (!meridiem && h > 23) return null
  if (h > 23) return null
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 || 12
  return `${display}:${String(min).padStart(2, '0')} ${period}`
}
