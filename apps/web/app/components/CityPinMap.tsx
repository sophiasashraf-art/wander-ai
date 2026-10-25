'use client'

import { useEffect, useRef, useState } from 'react'
import { projectLatLngToWorldMap, WORLD_MAP_VIEWBOX } from '../../lib/worldMapProjection'

interface Pin {
  key: string
  coords: { lat: number; lng: number }
}

// A self-contained map card (not the page-wide background WorldMapPin uses
// on the homepage) — that approach was tried first here and broke, because
// Maptured's content is opaque cards almost edge-to-edge, so pins landing
// behind a city tile were just invisible. This instead fills its OWN
// fixed-aspect box with the map at `background-size: 100% 100%`, so a pin's
// position is a simple linear scale of the box's rendered size — no card can
// ever cover it since nothing else shares this space.
export default function CityPinMap({ pins }: { pins: Pin[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="relative w-full rounded-2xl overflow-hidden mb-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      style={{
        aspectRatio: `${WORLD_MAP_VIEWBOX.width} / ${WORLD_MAP_VIEWBOX.height}`,
        backgroundColor: '#F4F5FB',
        backgroundImage: "url('/world-contour.svg')",
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {size && pins.map(p => {
        const pt = projectLatLngToWorldMap(p.coords.lat, p.coords.lng)
        if (!pt) return null
        const left = (pt.x / WORLD_MAP_VIEWBOX.width) * size.w
        const top = (pt.y / WORLD_MAP_VIEWBOX.height) * size.h
        return (
          <div key={p.key} className="absolute" style={{ left, top }}>
            <div
              className="w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 bg-[#3D5AFE]"
              style={{ boxShadow: '0 0 0 6px rgba(61,90,254,0.15)' }}
            />
          </div>
        )
      })}
    </div>
  )
}
