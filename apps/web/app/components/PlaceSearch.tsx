'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

interface SavedPlace {
  name: string
  category: string
  city: string
  description: string
  lat?: number
  lng?: number
  neighborhood?: string
}

interface Props {
  tripId: string
  destination: string
  onSaved: (place: SavedPlace) => void
  onBeforeSave?: () => Promise<string | null> // returns resolved tripId
}

const CATEGORY_MAP: Record<string, string> = {
  restaurant: 'restaurant',
  food: 'restaurant',
  cafe: 'cafe',
  coffee: 'cafe',
  bar: 'activity',
  lodging: 'stay',
  hotel: 'stay',
  museum: 'activity',
  park: 'activity',
  store: 'other',
  shopping_mall: 'other',
  tourist_attraction: 'activity',
  point_of_interest: 'activity',
  establishment: 'other',
}

function inferCategory(types: string[]): string {
  for (const t of types) {
    if (CATEGORY_MAP[t]) return CATEGORY_MAP[t]
  }
  return 'other'
}

export default function PlaceSearch({ tripId, destination, onSaved, onBeforeSave }: Props) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 })
  const inputRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionTokenRef = useRef<string>('')

  useEffect(() => { sessionTokenRef.current = crypto.randomUUID() }, [])

  function updateDropdownPos() {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
  }

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places-autocomplete?q=${encodeURIComponent(query)}&location=${encodeURIComponent(destination)}&session=${sessionTokenRef.current}`)
        const data = await res.json()
        setSuggestions(data.predictions || [])
        updateDropdownPos()
        setOpen(true)
      } catch {
        setSuggestions([])
      }
    }, 300)
  }, [query, destination])

  async function handleSelect(prediction: any) {
    setOpen(false)
    setQuery(prediction.description)
    setSaving(true)

    try {
      // Resolve tripId — may need to create trip first
      const resolvedTripId = onBeforeSave ? await onBeforeSave() : tripId
      if (!resolvedTripId) { setSaving(false); return }
      const res = await fetch(`/api/places-details?placeId=${prediction.place_id}&session=${sessionTokenRef.current}`)
      const data = await res.json()
      const place = data.result

      // Reset session token after use
      sessionTokenRef.current = crypto.randomUUID()

      const category = inferCategory(place.types || [])
      const city = place.address_components?.find((c: any) =>
        c.types.includes('locality') || c.types.includes('administrative_area_level_1')
      )?.long_name || destination

      const saved: SavedPlace = {
        name: place.name,
        category,
        city,
        description: place.formatted_address || '',
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng,
        neighborhood: place.formatted_address,
      }

      await supabase.from('places').insert({ ...saved, trip_id: resolvedTripId })
      onSaved(saved)
      setQuery('')
    } catch (e) {
      console.error('Failed to save place', e)
    }
    setSaving(false)
  }

  return (
    <div className="relative">
      <div ref={inputRef} className="flex items-center gap-2 bg-white border border-[#E8DFD0] rounded-xl px-3 py-2.5 focus-within:border-[#C17B4E] transition-colors">
        <span className="text-[#8C8070] text-sm">🔍</span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) { updateDropdownPos(); setOpen(true) } }}
          placeholder={`Search a place in ${destination}...`}
          className="flex-1 bg-transparent outline-none text-sm text-[#2C2416] placeholder:text-[#C8BFB0]"
          disabled={saving}
        />
        {saving && <span className="text-xs text-[#8C8070]">Saving...</span>}
      </div>

      {open && suggestions.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed bg-white border border-[#E8DFD0] rounded-xl shadow-lg overflow-hidden z-50 max-h-64 overflow-y-auto"
            style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
          >
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSelect(s)}
                className="w-full text-left px-4 py-3 hover:bg-[#FEF8F4] transition-colors border-b border-[#F5F0E8] last:border-0"
              >
                <p className="text-sm text-[#2C2416] font-medium truncate">
                  {s.structured_formatting?.main_text || s.description}
                </p>
                <p className="text-xs text-[#8C8070] truncate mt-0.5">
                  {s.structured_formatting?.secondary_text || ''}
                </p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
