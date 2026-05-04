'use client'

import { useState, useRef, useEffect } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export default function CityAutocomplete({ value, onChange, placeholder = 'City or country...', className = '', disabled }: Props) {
  const [query, setQuery] = useState(value)
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 })
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionRef = useRef(crypto.randomUUID())

  useEffect(() => { setQuery(value) }, [value])

  function updatePos() {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 260) })
  }

  useEffect(() => {
    if (!query.trim() || query.length < 2 || query === value) {
      setSuggestions([])
      setOpen(false)
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cities-autocomplete?q=${encodeURIComponent(query)}&session=${sessionRef.current}`)
        const data = await res.json()
        if (data.predictions?.length > 0) {
          setSuggestions(data.predictions)
          updatePos()
          setOpen(true)
        } else {
          setSuggestions([])
          setOpen(false)
        }
      } catch { setSuggestions([]); setOpen(false) }
    }, 250)
  }, [query])

  function handleSelect(prediction: any) {
    const desc = prediction.description || ''
    setQuery(desc)
    onChange(desc)
    setOpen(false)
    setSuggestions([])
    sessionRef.current = crypto.randomUUID()
  }

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); if (!e.target.value.trim()) onChange('') }}
        onBlur={() => { setTimeout(() => setOpen(false), 200); if (query.trim() && query !== value) onChange(query) }}
        onFocus={() => { if (suggestions.length > 0) { updatePos(); setOpen(true) } }}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
      />
      {open && suggestions.length > 0 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed bg-white border border-[#E8DFD0] rounded-xl shadow-lg overflow-hidden z-50 max-h-48 overflow-y-auto"
            style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
          >
            {suggestions.map((s, i) => (
              <button
                key={i}
                onMouseDown={e => { e.preventDefault(); handleSelect(s) }}
                className="w-full text-left px-4 py-2.5 hover:bg-[#FEF8F4] transition-colors border-b border-[#F5F0E8] last:border-0"
              >
                <p className="text-sm text-[#2C2416] font-medium truncate">
                  {s.structured_formatting?.main_text || s.description}
                </p>
                {s.structured_formatting?.secondary_text && (
                  <p className="text-xs text-[#8C8070] truncate">{s.structured_formatting.secondary_text}</p>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}
