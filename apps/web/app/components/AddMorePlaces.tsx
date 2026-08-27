'use client'

import { useState, useRef } from 'react'
import { Check, Camera, ArrowRight } from 'lucide-react'

interface Props {
  tripId: string
  onMerged: (days: any[]) => void
}

export default function AddMorePlaces({ tripId, onMerged }: Props) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)
  const [previews, setPreviews] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function processImages(files: File[]) {
    const images = files.filter(f => f.type.startsWith('image/'))
    if (!images.length) return
    setPreviews(prev => [...prev, ...images.map(f => URL.createObjectURL(f))])
    setImageLoading(true)
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
      if (combined) setInput(prev => prev ? `${prev}\n${combined}` : combined)
    } catch {}
    setImageLoading(false)
  }

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
      setPreviews([])
      setStatus(`Added ${newPlaces.length} place${newPlaces.length > 1 ? 's' : ''} to your itinerary`)
      setTimeout(() => setStatus(null), 3000)
    } else {
      setStatus('Something went wrong merging places.')
    }

    setLoading(false)
  }

  return (
    <div className="w-full max-w-2xl mt-10 mb-16">
      <div className="bg-white border border-[#E5E5E5] rounded-lg p-5">
        <label className="block text-xs font-medium text-[#3D5AFE] uppercase tracking-widest mb-3">
          Add more places
        </label>
        <textarea
          className="w-full bg-transparent outline-none text-[#0A0A0A] text-sm leading-relaxed resize-none placeholder:text-[#6B6B6B] mb-3"
          rows={3}
          placeholder="Paste links, restaurant names, or notes to add to this trip..."
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={loading}
        />

        {/* Image upload */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); processImages(Array.from(e.dataTransfer.files)) }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-md px-4 py-3 cursor-pointer transition-colors mb-4 ${
            dragOver ? 'border-[#3D5AFE] bg-[#EEF0FF]' : 'border-[#E5E5E5] hover:border-[#3D5AFE] hover:bg-[#EEF0FF]'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => { if (e.target.files?.length) processImages(Array.from(e.target.files)) }}
          />
          {previews.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              {previews.map((src, i) => (
                <img key={i} src={src} alt="" className="w-10 h-10 object-cover rounded-lg shrink-0" />
              ))}
              <span className="flex items-center gap-1 text-xs text-[#6B6B6B]">
                {imageLoading ? 'Reading images...' : <><Check size={12} strokeWidth={2.5} className="text-[#7A9E7E]" /> {previews.length} image{previews.length > 1 ? 's' : ''} extracted — click to add more</>}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Camera size={16} strokeWidth={1.5} className="text-[#A3A3A3]" />
              <span className="text-xs text-[#6B6B6B]">
                {imageLoading ? 'Reading image...' : 'Drop screenshots or click to upload'}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          {status && (
            <p className="text-xs text-[#6B6B6B] flex-1">{status}</p>
          )}
          <button
            onClick={handleAdd}
            disabled={loading || (!input.trim() && !imageLoading)}
            className="group ml-auto flex items-center gap-1.5 px-4 py-2 bg-[#3D5AFE] text-white rounded-md text-sm font-medium hover:bg-[#2E45D6] transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {loading ? 'Adding...' : <>Add to trip <ArrowRight size={13} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" /></>}
          </button>
        </div>
      </div>
    </div>
  )
}
