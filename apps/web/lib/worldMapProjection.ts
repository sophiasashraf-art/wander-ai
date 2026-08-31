import { geoNaturalEarth1 } from 'd3-geo'

// Must match the projection used to generate public/world-contour.svg exactly
// (see scripts/gen-world-map.mjs): a Natural Earth projection fit to a
// 1580x680 box, then nudged by the SVG's own translate(10,10) wrapper.
export const WORLD_MAP_VIEWBOX = { width: 1600, height: 700 }

// Must match `background-position: center 85px` on .bg-gradient-subtle in
// globals.css — a fixed pixel offset (not a %) so the map stays anchored
// just below the header regardless of how tall the page grows.
export const WORLD_MAP_ANCHOR_Y_PX = 85

const projection = geoNaturalEarth1().fitSize(
  [WORLD_MAP_VIEWBOX.width - 20, WORLD_MAP_VIEWBOX.height - 20],
  { type: 'Sphere' } as any
)

// Returns the point's position in the SVG's own 1600x700 coordinate space,
// so callers can place a marker by scaling to wherever the image is displayed.
export function projectLatLngToWorldMap(lat: number, lng: number): { x: number; y: number } | null {
  const p = projection([lng, lat])
  if (!p) return null
  return { x: p[0] + 10, y: p[1] + 10 }
}
