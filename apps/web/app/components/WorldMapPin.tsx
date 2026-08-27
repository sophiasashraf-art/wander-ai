'use client'

import { useEffect, useState, type RefObject } from 'react'
import { projectLatLngToWorldMap, WORLD_MAP_VIEWBOX } from '../../lib/worldMapProjection'

// Must mirror `.bg-gradient-subtle { background-size: 1400px auto; background-position: center 15%; }`
// in globals.css, so the pin lands exactly where the background map places that spot.
const IMAGE_WIDTH = 1400
const IMAGE_HEIGHT = IMAGE_WIDTH * (WORLD_MAP_VIEWBOX.height / WORLD_MAP_VIEWBOX.width)
const POSITION_Y_PERCENT = 0.15

export default function WorldMapPin({ coords, containerRef }: {
  coords: { lat: number; lng: number } | null
  containerRef: RefObject<HTMLElement | null>
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setBox({ width: el.offsetWidth, height: el.offsetHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  if (!coords || !box) return null
  const point = projectLatLngToWorldMap(coords.lat, coords.lng)
  if (!point) return null

  const scale = IMAGE_WIDTH / WORLD_MAP_VIEWBOX.width
  const offsetX = (box.width - IMAGE_WIDTH) / 2
  const offsetY = (box.height - IMAGE_HEIGHT) * POSITION_Y_PERCENT

  const left = offsetX + point.x * scale
  const top = offsetY + point.y * scale

  return (
    <div className="absolute pointer-events-none transition-[left,top] duration-300 ease-out" style={{ left, top }}>
      <div className="w-1.5 h-1.5 rounded-full -translate-x-1/2 -translate-y-1/2 bg-[#D14343]/70" style={{ boxShadow: '0 0 0 5px rgba(209,67,67,0.12)' }} />
    </div>
  )
}
