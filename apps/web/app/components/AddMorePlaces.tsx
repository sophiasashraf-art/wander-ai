'use client'

import { useState } from 'react'

interface Props {
  tripId: string
  onMerged: (days: any[]) => void
}

export default function AddMorePlaces({ tripId, onMerged }: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function handleAdd() {
    if (!input.trim()) return
    setLoading(true)
    setStatus(null)

    // Step 1: extract places from new input
    const extractRes = await fetch('/api/extract-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input, tripId }),
    })
    const extracted = await extractRes.json()
    const newPlaces = extracted.places || []

    if (newPlaces.length === 0) {
      setStatus('No new places found — try adding more detail or a link.')
      setLoading(false)
      return
    }

    setStatus(`Found ${newPlaces.length} place${newPlaces.length > 1 ? 's' : ''}, merging into itinerary...`)

    // Step 2: merge into existing itinerary
    const mergeRes = await fetch('/api/merge-places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tripId, newPlaces }),
    })
    const merged = await mergeRes.json()

    if (merged.days) {
      onMerged(merged.days)
      setInput('')
      setStatus(`Added ${newPlaces.length} place${newPlaces.length > 1 ? 's' : ''} to your itinerary`)
      setTimeout(() => setStatus(null), 3000)
    } else {
      setStatus('Something went wrong merging places.')
    }

    setLoading(false)
  }

  return (
    <div className="w-full max-w-2xl mt-10 mb-16">
      <div className="bg-white border border-[#E8DFD0] rounded-2xl p-5">
        <label className="block text-xs font-medium text-[#C17B4E] uppercase tracking-widest mb-3">
          Add more places
        </label>
        <textarea
          className="w-full bg-transparent outline-none text-[#2C2416] text-sm leading-relaxed resize-none placeholder:text-[#8C8070] mb-4"
          rows={3}
          placeholder="Paste links, restaurant names, or notes to add to this trip..."
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading}
        />
        <div className="flex items-center justify-between gap-3">
          {status && (
            <p className="text-xs text-[#8C8070] flex-1">{status}</p>
          )}
          <button
            onClick={handleAdd}
            disabled={loading || !input.trim()}
            className="ml-auto px-4 py-2 bg-[#C17B4E] text-white rounded-xl text-sm font-medium hover:bg-[#8B5330] transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {loading ? 'Adding...' : 'Add to trip →'}
          </button>
        </div>
      </div>
    </div>
  )
}
