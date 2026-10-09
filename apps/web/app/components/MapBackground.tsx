'use client'

import { useEffect, useState } from 'react'
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps'

const SPOTS = [
  { name: 'Paris', lat: 48.8566, lng: 2.3522 },
  { name: 'Tokyo', lat: 35.6762, lng: 139.6503 },
  { name: 'New York', lat: 40.7128, lng: -74.006 },
  { name: 'Bali', lat: -8.4095, lng: 115.1889 },
  { name: 'Cape Town', lat: -33.9249, lng: 18.4241 },
  { name: 'Reykjavik', lat: 64.1466, lng: -21.9426 },
  { name: 'Marrakech', lat: 31.6295, lng: -7.9811 },
  { name: 'Sydney', lat: -33.8688, lng: 151.2093 },
]

export default function MapBackground() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIndex(i => (i + 1) % SPOTS.length), 4500)
    return () => clearInterval(id)
  }, [])

  const spot = SPOTS[index]
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  if (!apiKey) return null

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
      <APIProvider apiKey={apiKey}>
        <Map
          center={{ lat: spot.lat, lng: spot.lng }}
          zoom={5.5}
          mapId="mapture-map"
          disableDefaultUI
          gestureHandling="none"
          keyboardShortcuts={false}
          style={{ width: '100%', height: '100%' }}
        >
          <AdvancedMarker key={index} position={{ lat: spot.lat, lng: spot.lng }}>
            <div className="map-pin-drop">
              <svg width="30" height="40" viewBox="0 0 30 40" fill="none">
                <path
                  d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25C30 6.7 23.3 0 15 0z"
                  fill="#3D5AFE"
                />
                <circle cx="15" cy="15" r="6" fill="white" />
              </svg>
            </div>
          </AdvancedMarker>
        </Map>
      </APIProvider>
      <div className="absolute inset-0 bg-white/78 backdrop-blur-[2px]" />
    </div>
  )
}
