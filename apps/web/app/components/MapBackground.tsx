'use client'

import { useEffect, useRef, useState } from 'react'
import { projectLatLngToWorldMap, WORLD_MAP_VIEWBOX, WORLD_MAP_ANCHOR_Y_PX } from '../../lib/worldMapProjection'

// Must mirror `.bg-gradient-subtle { background-size: min(1400px, 100%) auto; }`
// in globals.css, so the pin lands exactly where the background map places that spot.
const MAX_IMAGE_WIDTH = 1400

// Same world-contour map as the homepage (WorldMapPin.tsx, .bg-gradient-subtle)
// — here the pin just cycles through cities instead of a typed destination,
// sized up and brightened since it's the whole point of this background
// rather than a subtle detail behind other content.
const SPOTS = [
  { lat: 48.8566, lng: 2.3522 },    // Paris
  { lat: 35.6762, lng: 139.6503 },  // Tokyo
  { lat: 40.7128, lng: -74.006 },   // New York
  { lat: -8.4095, lng: 115.1889 },  // Bali
  { lat: -33.9249, lng: 18.4241 },  // Cape Town
  { lat: 64.1466, lng: -21.9426 },  // Reykjavik
  { lat: 31.6295, lng: -7.9811 },   // Marrakech
  { lat: -33.8688, lng: 151.2093 }, // Sydney
  { lat: 41.0082, lng: 28.9784 },   // Istanbul
  { lat: 19.4326, lng: -99.1332 },  // Mexico City
]

export default function MapBackground() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(el.offsetWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const id = setInterval(() => setIndex(i => (i + 1) % SPOTS.length), 2800)
    return () => clearInterval(id)
  }, [])

  const point = width ? projectLatLngToWorldMap(SPOTS[index].lat, SPOTS[index].lng) : null
  const imageWidth = width ? Math.min(MAX_IMAGE_WIDTH, width) : 0
  const scale = width ? imageWidth / WORLD_MAP_VIEWBOX.width : 0
  const offsetX = width ? (width - imageWidth) / 2 : 0

  return (
    <div ref={containerRef} className="absolute inset-0 bg-gradient-subtle overflow-hidden pointer-events-none select-none">
      {!!(point && width) && (
        <div
          className="absolute transition-[left,top] duration-[1400ms] ease-in-out"
          style={{ left: offsetX + point.x * scale, top: WORLD_MAP_ANCHOR_Y_PX + point.y * scale }}
        >
          <div className="relative -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5">
            <div className="absolute inset-0 rounded-full bg-[#D14343]/40 animate-ping" />
            <div className="absolute inset-0 rounded-full bg-[#D14343] ring-4 ring-[#D14343]/20" />
          </div>
        </div>
      )}
    </div>
  )
}
