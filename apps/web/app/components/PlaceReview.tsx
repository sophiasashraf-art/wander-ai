'use client'

import { useEffect, useRef, useState } from 'react'
import { Star, Camera, X, Check } from 'lucide-react'
import { createClient } from '../../lib/supabase/client'

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
      setRating(place?.visited_rating ?? null)
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

  async function handleRate(stars: number) {
    setRating(stars)
    await supabase.from('places').update({ visited_rating: stars }).eq('id', placeId)
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
        className="mt-2.5 flex items-center gap-1.5 text-xs text-[#6B6B6B] hover:text-[#3D5AFE] font-medium transition-colors"
      >
        <Check size={12} strokeWidth={2} /> Mark as been here
      </button>
    )
  }

  return (
    <div className="mt-2.5 pt-2.5 border-t border-[#EFEFEF]">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} onClick={() => handleRate(n)} className="p-0.5">
              <Star
                size={13}
                strokeWidth={2}
                className={n <= (rating || 0) ? 'fill-[#3D5AFE] text-[#3D5AFE]' : 'text-[#D4D4D4]'}
              />
            </button>
          ))}
        </div>
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
