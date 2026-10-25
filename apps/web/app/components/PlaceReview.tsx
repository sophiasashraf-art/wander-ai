'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, X, Check } from 'lucide-react'
import { createClient } from '../../lib/supabase/client'
import { RATING_BUCKETS, scoreColor, scoreTint } from '../../lib/beliScore'

const supabase = createClient()
const PHOTO_BUCKET = 'place-photos'

interface Photo {
  id: string
  storage_path: string
  url: string | null
}

export default function PlaceReview({ placeId, onChange }: { placeId: string; onChange?: () => void }) {
  const [loading, setLoading] = useState(true)
  const [visited, setVisited] = useState(false)
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: place } = await supabase
        .from('places')
        .select('visited, visited_rating, visited_note')
        .eq('id', placeId)
        .single()
      const { data: photoRows } = await supabase
        .from('place_photos')
        .select('id, storage_path')
        .eq('place_id', placeId)
        .order('created_at', { ascending: true })

      const withUrls = await Promise.all(
        (photoRows || []).map(async (p: any) => {
          const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(p.storage_path, 3600)
          return { id: p.id, storage_path: p.storage_path, url: data?.signedUrl || null }
        })
      )

      if (cancelled) return
      setVisited(place?.visited || false)
      // PostgREST can serialize `numeric` columns as strings to avoid float
      // precision loss — coerce so .toFixed()/comparisons below don't choke.
      setRating(place?.visited_rating != null ? Number(place.visited_rating) : null)
      setNote(place?.visited_note || '')
      setPhotos(withUrls)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [placeId])

  async function handleMarkVisited() {
    setVisited(true)
    await supabase.from('places').update({ visited: true }).eq('id', placeId)
    onChange?.()
  }

  async function handleUnmarkVisited() {
    setVisited(false)
    await supabase.from('places').update({ visited: false }).eq('id', placeId)
    onChange?.()
  }

  async function handleRate(score: number) {
    setRating(score)
    await supabase.from('places').update({ visited_rating: score }).eq('id', placeId)
    onChange?.()
  }

  function handleNoteChange(value: string) {
    setNote(value)
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => {
      supabase.from('places').update({ visited_note: value }).eq('id', placeId)
      onChange?.()
    }, 600)
  }

  async function handlePhotoSelect(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const path = `${placeId}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file)
      if (uploadError) { console.error('photo upload failed:', uploadError); continue }
      const { data: row } = await supabase
        .from('place_photos')
        .insert({ place_id: placeId, storage_path: path })
        .select()
        .single()
      const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600)
      if (row) setPhotos(prev => [...prev, { id: row.id, storage_path: path, url: signed?.signedUrl || null }])
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleRemovePhoto(photo: Photo) {
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path])
    await supabase.from('place_photos').delete().eq('id', photo.id)
  }

  if (loading) return null

  if (!visited) {
    return (
      <button
        onClick={handleMarkVisited}
        className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
        style={{ background: 'rgba(61,90,254,0.08)', color: '#3D5AFE' }}
      >
        <Check size={12} strokeWidth={2.5} /> Mark as been here
      </button>
    )
  }

  return (
    <div className="mt-2.5 pt-2.5 border-t border-[#EFEFEF]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {RATING_BUCKETS.map(b => {
            const active = rating != null && Math.abs(rating - b.score) < 0.9
            return (
              <button
                key={b.label}
                onClick={() => handleRate(b.score)}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-full transition-all"
                style={active
                  ? { background: b.color, color: '#FFFFFF', boxShadow: `0 2px 6px -1px ${b.color}66` }
                  : { background: scoreTint(b.score), color: b.color }}
              >
                {b.label}
              </button>
            )
          })}
        </div>
        {rating != null && (
          <span
            className="shrink-0 text-sm font-bold text-white rounded-lg px-2 py-1"
            style={{ background: scoreColor(rating), boxShadow: `0 2px 6px -1px ${scoreColor(rating)}66` }}
          >
            {rating.toFixed(1)}
          </span>
        )}
      </div>
      <div className="flex justify-end mb-1.5">
        <button
          onClick={handleUnmarkVisited}
          className="text-[10px] text-[#A3A3A3] hover:text-[#D14343] transition-colors"
        >
          Unmark
        </button>
      </div>

      <textarea
        value={note}
        onChange={e => handleNoteChange(e.target.value)}
        placeholder="What did you think?"
        rows={2}
        className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-md px-2 py-1.5 outline-none text-xs text-[#0A0A0A] placeholder:text-[#A3A3A3] focus:border-[#3D5AFE] transition-colors resize-none"
      />

      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {photos.map(photo => (
          <div key={photo.id} className="relative group w-11 h-11 shrink-0">
            {photo.url && (
              <img src={photo.url} alt="" className="w-full h-full object-cover rounded-md" />
            )}
            <button
              onClick={() => handleRemovePhoto(photo)}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={9} strokeWidth={2.5} />
            </button>
          </div>
        ))}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-11 h-11 shrink-0 rounded-md border border-dashed border-[#D4D4D4] flex items-center justify-center text-[#A3A3A3] hover:border-[#3D5AFE] hover:text-[#3D5AFE] transition-colors disabled:opacity-50"
        >
          <Camera size={14} strokeWidth={2} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={e => handlePhotoSelect(e.target.files)}
          className="hidden"
        />
      </div>
    </div>
  )
}
