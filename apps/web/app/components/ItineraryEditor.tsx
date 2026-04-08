'use client'

import { useState, useEffect, useRef } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const DAY_COLORS = ['#C17B4E', '#7A9E7E', '#5C8AAE', '#9B6DAB', '#B85C38']

export interface Stop {
  id: string
  time: string
  manualTime?: boolean
  name: string
  category: string
  note?: string
  suggested?: boolean
}

export interface Day {
  day: number
  title: string
  stops: Stop[]
}

interface Props {
  days: Day[]
  onChange: (days: Day[]) => void
  startDate?: string
  viewOnly?: boolean
  destination?: string
}

// Format a date offset from startDate
function getDayDate(startDate: string, dayIndex: number): string | null {
  if (!startDate) return null
  const d = new Date(startDate + 'T00:00:00')
  d.setDate(d.getDate() + dayIndex)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// ── Drag handle icon ──
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

// ── Single sortable stop row ──
function StopRow({
  stop,
  dayColor,
  onDelete,
  onTimeChange,
  viewOnly = false,
}: {
  stop: Stop
  dayColor: string
  onDelete: () => void
  onTimeChange: (time: string) => void
  viewOnly?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id })
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState(false)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex gap-3 px-4 py-3 items-start group border-b border-[#F5F0E8] last:border-0 bg-white"
    >
      {/* Drag handle */}
      {!viewOnly && (
        <button
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity shrink-0 touch-none"
          aria-label="Drag to reorder"
        >
          <GripIcon />
        </button>
      )}

      {/* Dot */}
      <div
        className="mt-1.5 w-2 h-2 rounded-full shrink-0"
        style={{
          background: stop.suggested ? 'transparent' : dayColor,
          border: stop.suggested ? `2px dashed ${dayColor}` : 'none',
        }}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Editable time */}
          {!viewOnly && editing ? (
            <div className="flex flex-col gap-0.5">
              <input
                type="text"
                autoFocus
                defaultValue={stop.time}
                placeholder="9:00 AM"
                onChange={() => setError(false)}
                onBlur={e => {
                  const val = e.target.value.trim()
                  if (!val) { setEditing(false); setError(false); return }
                  const normalized = normalizeTimeInput(val)
                  if (normalized) {
                    setEditing(false)
                    setError(false)
                    onTimeChange(normalized)
                  } else {
                    setError(true)
                    e.target.focus()
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') { setEditing(false); setError(false) }
                }}
                className={`text-xs w-20 border-b outline-none bg-transparent pb-0.5 ${
                  error ? 'border-red-400 text-red-400' : 'border-[#C17B4E] text-[#C17B4E]'
                }`}
              />
              {error && (
                <span className="text-xs text-red-400">try "9:30 AM" or "14:00"</span>
              )}
            </div>
          ) : (
            <button
              onClick={() => !viewOnly && setEditing(true)}
              title={viewOnly ? undefined : "Click to edit time"}
              className={`text-xs text-[#8C8070] w-14 shrink-0 text-left transition-colors ${!viewOnly ? 'hover:text-[#C17B4E] cursor-pointer' : 'cursor-default'}`}
            >
              {stop.time}
            </button>
          )}
          <p className="text-sm font-medium text-[#2C2416] truncate">{stop.name}</p>
          {stop.suggested && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#F5F0E8] text-[#8C8070] shrink-0">
              suggested
            </span>
          )}
        </div>
        {stop.note && (
          <p className="text-xs text-[#8C8070] mt-0.5 leading-relaxed pl-16">{stop.note}</p>
        )}
      </div>

      {/* Delete */}
      {!viewOnly && (
        <button
          onClick={onDelete}
          className="mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-[#C8BFB0] hover:text-red-400 shrink-0 text-lg leading-none"
          aria-label="Remove stop"
        >
          ×
        </button>
      )}
    </div>
  )
}

// ── Overlay card shown while dragging ──
function DragOverlayCard({ stop, dayColor }: { stop: Stop; dayColor: string }) {
  return (
    <div className="flex gap-3 px-4 py-3 items-start bg-white border border-[#E8DFD0] rounded-xl shadow-lg">
      <GripIcon />
      <div
        className="mt-1.5 w-2 h-2 rounded-full shrink-0"
        style={{ background: dayColor }}
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8C8070] w-14 shrink-0">{stop.time}</span>
          <p className="text-sm font-medium text-[#2C2416]">{stop.name}</p>
        </div>
      </div>
    </div>
  )
}


// Parse time from text like 'beach 9am' -> { name: 'beach', time: '9:00 AM' }
function extractTimeFromText(text: string): { name: string; time: string | null } {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
  let h = parseInt(m[1])
  const min = parseInt(m[2] || '0')
  const p = m[3].toLowerCase()
  if (p === 'pm' && h !== 12) h += 12
  if (p === 'am' && h === 12) h = 0
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 || 12
  const time = `${display}:${String(min).padStart(2, '0')} ${period}`
  const name = text.replace(m[0], '').replace(/\s+/g, ' ').trim()
  return { name: name || text.trim(), time }
}

// ── Add place inline input with autocomplete ──
function AddStopInput({ onAdd, destination }: { onAdd: (name: string, note?: string, time?: string) => void; destination: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionToken = useRef(crypto.randomUUID())

  useEffect(() => {
    if (!query.trim() || query.length < 2) { setSuggestions([]); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places-autocomplete?q=${encodeURIComponent(query)}&location=${encodeURIComponent(destination)}&session=${sessionToken.current}`)
        const data = await res.json()
        setSuggestions(data.predictions || [])
        setShowSuggestions(true)
      } catch { setSuggestions([]) }
    }, 300)
  }, [query, destination])

  async function handleSelect(prediction: any) {
    setShowSuggestions(false)
    const name = prediction.structured_formatting?.main_text || prediction.description
    const note = prediction.structured_formatting?.secondary_text || ''
    sessionToken.current = crypto.randomUUID()
    onAdd(name, note)
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
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-4 py-2.5 text-xs text-[#8C8070] hover:text-[#C17B4E] hover:bg-[#FEF8F4] transition-colors flex items-center gap-2"
      >
        <span className="text-base leading-none">+</span> Add a place
      </button>
    )
  }

  return (
    <div className="relative">
      <div className="px-4 py-2.5 flex items-center gap-2 bg-[#FDFAF5]">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { setShowSuggestions(false); handleManualAdd() }
            if (e.key === 'Escape') { setOpen(false); setQuery(''); setShowSuggestions(false) }
          }}
          placeholder="Search or type a place..."
          className="flex-1 bg-transparent outline-none text-sm text-[#2C2416] placeholder:text-[#C8BFB0]"
        />
        <button onClick={handleManualAdd} className="text-xs text-[#C17B4E] font-medium hover:text-[#8B5330]">Add</button>
        <button onClick={() => { setOpen(false); setQuery(''); setShowSuggestions(false) }} className="text-xs text-[#8C8070] hover:text-[#2C2416]">Cancel</button>
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowSuggestions(false)} />
          <div className="absolute left-0 right-0 bg-white border border-[#E8DFD0] rounded-xl shadow-lg overflow-hidden z-20 max-h-48 overflow-y-auto mx-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSelect(s)}
                className="w-full text-left px-4 py-2.5 hover:bg-[#FEF8F4] transition-colors border-b border-[#F5F0E8] last:border-0"
              >
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

// ── Main editor ──
export default function ItineraryEditor({ days, onChange, startDate = '', viewOnly = false, destination = '' }: Props) {
  const [activeStop, setActiveStop] = useState<{ stop: Stop; dayIndex: number } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: viewOnly ? { distance: 999999 } : { distance: 5 }
    })
  )

  // Helper: recalc times on all days then call onChange
  function update(newDays: Day[]) {
    onChange(newDays.map(d => ({ ...d, stops: recalcTimes(d.stops) })))
  }

  // Flat map of stopId → dayIndex for quick lookup
  function findDayIndexByStopId(stopId: string): number {
    return days.findIndex(d => d.stops.some(s => s.id === stopId))
  }

  function handleDragStart(event: DragStartEvent) {
    const stopId = event.active.id as string
    const dayIndex = findDayIndexByStopId(stopId)
    if (dayIndex === -1) return
    const stop = days[dayIndex].stops.find(s => s.id === stopId)!
    setActiveStop({ stop, dayIndex })
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string

    const activeDayIdx = findDayIndexByStopId(activeId)
    // over could be a stop id or a day container id (prefixed "day-")
    const overDayIdx = overId.startsWith('day-')
      ? days.findIndex(d => `day-${d.day}` === overId)
      : findDayIndexByStopId(overId)

    if (activeDayIdx === -1 || overDayIdx === -1 || activeDayIdx === overDayIdx) return

    // Move stop to the new day
    const newDays = days.map(d => ({ ...d, stops: [...d.stops] }))
    const stop = newDays[activeDayIdx].stops.find(s => s.id === activeId)!
    newDays[activeDayIdx].stops = newDays[activeDayIdx].stops.filter(s => s.id !== activeId)
    newDays[overDayIdx].stops.push(stop)
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

    const newDays = days.map((d, i) =>
      i === dayIdx ? { ...d, stops: arrayMove(d.stops, oldIndex, newIndex) } : d
    )
    update(newDays)
  }

  function updateStopTime(dayIndex: number, stopId: string, time: string) {
    const newDays = days.map((d, i) => {
      if (i !== dayIndex) return d
      const updated = d.stops.map(s => s.id === stopId ? { ...s, time } : s)
      const sorted = [...updated].sort((a, b) => parseTime(a.time) - parseTime(b.time))
      return { ...d, stops: sorted } // just sort, don't recalc times
    })
    onChange(newDays)
  }

  function deleteStop(dayIndex: number, stopId: string) {
    const newDays = days.map((d, i) =>
      i === dayIndex ? { ...d, stops: d.stops.filter(s => s.id !== stopId) } : d
    )
    update(newDays)
  }

  function addStop(dayIndex: number, name: string, note?: string, explicitTime?: string) {
    const day = days[dayIndex]
    const newStop: Stop = {
      id: `manual-${Date.now()}-${Math.random()}`,
      name,
      time: formatHour(9 + day.stops.length * 2),
      category: 'other',
      note: note || '',
      suggested: false,
    }
    const newDays = days.map((d, i) =>
      i === dayIndex ? { ...d, stops: [...d.stops, newStop] } : d
    )
    update(newDays)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-6">
        {days.map((day, dayIndex) => {
          const color = DAY_COLORS[dayIndex % DAY_COLORS.length]
          return (
            <div
              key={day.day}
              id={`day-${day.day}`}
              className="bg-white border border-[#E8DFD0] rounded-2xl overflow-hidden"
            >
              {/* Day header */}
              <div
                className="px-5 py-3 flex items-center gap-3"
                style={{ background: `${color}15` }}
              >
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span
                  className="text-xs font-medium uppercase tracking-widest"
                  style={{ color }}
                >
                  Day {day.day}
                </span>
                <span className="text-sm font-medium text-[#2C2416]">{day.title}</span>
                {getDayDate(startDate, dayIndex) && (
                  <span className="text-xs text-[#8C8070] ml-1">
                    · {getDayDate(startDate, dayIndex)}
                  </span>
                )}
                <span className="ml-auto text-xs text-[#C8BFB0]">{day.stops.length} stops</span>
              </div>

              {/* Stops */}
              <SortableContext
                items={day.stops.map(s => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {day.stops.map(stop => (
                  <StopRow
                    key={stop.id}
                    stop={stop}
                    dayColor={color}
                    onDelete={() => deleteStop(dayIndex, stop.id)}
                    onTimeChange={time => updateStopTime(dayIndex, stop.id, time)}
                    viewOnly={viewOnly}
                  />
                ))}
              </SortableContext>

              {/* Add stop */}
              {!viewOnly && <AddStopInput destination={destination} onAdd={(name, note, time) => addStop(dayIndex, name, note, time)} />}
            </div>
          )
        })}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeStop && (
          <DragOverlayCard
            stop={activeStop.stop}
            dayColor={DAY_COLORS[activeStop.dayIndex % DAY_COLORS.length]}
          />
        )}
      </DragOverlay>
    </DndContext>
  )
}

// Recalculate times for all stops in a day starting at 9 AM, 2hr intervals
// Stops with manualTime=true anchor their position; auto stops fill gaps
export function recalcTimes(stops: Stop[]): Stop[] {
  // Simple sequential reassignment — just space them 2hrs apart from 9 AM
  return stops.map((stop, i) => ({
    ...stop,
    time: formatHour(9 + i * 2),
    manualTime: false, // reset after reorder so times stay in sync
  }))
}

// Parse "9:00 AM" → minutes since midnight for sorting
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

// Normalize user input into "H:MM AM/PM", returns null if unparseable
function normalizeTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/[.\-]/g, ':')

  // Match patterns like: 11pm, 11:00pm, 11.00pm, 9am, 9:30 am, 23:00, 9, 14
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?$/)
  if (!m) return null

  let h = parseInt(m[1])
  const min = parseInt(m[2] || '0')
  const meridiem = m[3]

  if (min < 0 || min > 59) return null

  if (meridiem === 'pm' && h !== 12) h += 12
  else if (meridiem === 'am' && h === 12) h = 0
  else if (!meridiem && h > 23) return null
  // 24h format with no meridiem
  if (h > 23) return null

  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 || 12
  return `${display}:${String(min).padStart(2, '0')} ${period}`
}

function formatHour(hour: number): string {
  const h = hour % 24
  const period = h < 12 ? 'AM' : 'PM'
  const display = h % 12 || 12
  return `${display}:00 ${period}`
}
