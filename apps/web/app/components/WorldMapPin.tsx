'use client'

import { useEffect, useState, type RefObject } from 'react'
import { projectLatLngToWorldMap, WORLD_MAP_VIEWBOX, WORLD_MAP_ANCHOR_Y_PX } from '../../lib/worldMapProjection'

// Must mirror `.bg-gradient-subtle { background-size: min(1400px, 100%) auto; background-position: center 85px; }`
// in globals.css, so the pin lands exactly where the background map places that spot.
const MAX_IMAGE_WIDTH = 1400

export default function WorldMapPin({ coords, containerRef }: {
  coords: { lat: number; lng: number } | null
  containerRef: RefObject<HTMLElement | null>
}) {
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(el.offsetWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  if (!coords || !width) return null
  const point = projectLatLngToWorldMap(coords.lat, coords.lng)
  if (!point) return null

  const imageWidth = Math.min(MAX_IMAGE_WIDTH, width)
  const scale = imageWidth / WORLD_MAP_VIEWBOX.width
  const offsetX = (width - imageWidth) / 2
  const offsetY = WORLD_MAP_ANCHOR_Y_PX

  const left = offsetX + point.x * scale
  const top = offsetY + point.y * scale

  return (
    // z-index: -1 keeps this pinned behind every real UI element (which are all
    // effectively z-index: auto/static, painted above negative-z children) while
    // staying above `main`'s own background — it should only ever touch the
    // decorative map, never sit in front of the composer, workspace, or map.
    <div className="absolute pointer-events-none transition-[left,top] duration-300 ease-out" style={{ left, top, zIndex: -1 }}>
      <div className="w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2 bg-[#D14343]/70" style={{ boxShadow: '0 0 0 5px rgba(209,67,67,0.12)' }} />
    </div>
  )
}
