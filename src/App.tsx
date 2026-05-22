import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  DEFAULT_MAP_SIZE,
  MAP_SIZE_ORDER,
  WORLD_SCALE_CONFIGS,
  type MapSize,
} from './config/worldScaleConfig'
import { DEBUG_CONFIG } from './config/debugConfig'
import { PixiMap } from './render/pixiMap'
import { createWorldState } from './state/worldState'
import type { County } from './types/world'

function generateRandomSeed(): string {
  const uuid = crypto.randomUUID().split('-')[0]
  return `seed-${uuid}`
}

function App() {
  const [mapSize, setMapSize] = useState<MapSize>(DEFAULT_MAP_SIZE)
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(true)
  const [showSeaZoneLayers, setShowSeaZoneLayers] = useState(
    DEBUG_CONFIG.showSeaZoneLayers,
  )
  const worldState = useMemo(
    () => createWorldState(generateRandomSeed(), WORLD_SCALE_CONFIGS[DEFAULT_MAP_SIZE]),
    [],
  )
  const [seed, setSeed] = useState('')
  const [world, setWorld] = useState(worldState.world)
  const [hoveredCounty, setHoveredCounty] = useState<County | null>(null)
  const [selectedCounty, setSelectedCounty] = useState<County | null>(null)
  const mapHostRef = useRef<HTMLDivElement | null>(null)
  const pixiMapRef = useRef<PixiMap | null>(null)
  const initialWorldRef = useRef(world)

  useEffect(() => {
    if (!mapHostRef.current) {
      return undefined
    }

    const pixiMap = new PixiMap(mapHostRef.current, {
      onHoverCounty: setHoveredCounty,
      onSelectCounty: setSelectedCounty,
    })

    void pixiMap.mount(initialWorldRef.current)
    pixiMapRef.current = pixiMap

    return () => {
      pixiMap.destroy()
      pixiMapRef.current = null
    }
  }, [])

  useEffect(() => {
    pixiMapRef.current?.updateWorld(world)
  }, [world, mapSize])

  useEffect(() => {
    pixiMapRef.current?.setShowWorldBorder(DEBUG_CONFIG.showWorldBorder)
  }, [])

  useEffect(() => {
    pixiMapRef.current?.setShowSeaZoneLayers(showSeaZoneLayers)
  }, [showSeaZoneLayers])

  const onRegenerate = (): void => {
    const typedSeed = seed.trim()
    const nextSeed = typedSeed || generateRandomSeed()
    const nextWorld = worldState.regenerate(nextSeed, WORLD_SCALE_CONFIGS[mapSize])
    setHoveredCounty(null)
    setSelectedCounty(null)
    setWorld(nextWorld)
  }

  return (
    <div className={`layout ${isMenuCollapsed ? 'menu-collapsed' : ''}`}>
      <button
        type="button"
        className="menu-toggle"
        onClick={() => setIsMenuCollapsed((previous) => !previous)}
        aria-expanded={!isMenuCollapsed}
        aria-controls="bootstrap-panel"
      >
        {isMenuCollapsed ? 'Show Menu' : 'Hide Menu'}
      </button>

      <aside id="bootstrap-panel" className="panel">
        <h1>Mapgame Bootstrap</h1>
        <p className="subtitle">
          Seeded world generation with PixiJS pan/zoom and county interaction.
        </p>

        <label htmlFor="seed" className="label">
          World Seed
        </label>
        <p className="subtitle">Leave empty to generate a new random seed.</p>
        <div className="seed-row">
          <input
            id="seed"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            placeholder="Optional manual seed"
          />
          <button type="button" onClick={onRegenerate}>
            Regenerate
          </button>
        </div>
        <p className="subtitle">Active seed: {world.metadata.seed}</p>

        <section className="details">
          <h2>Map Size</h2>
          <label className="scale-row" htmlFor="map-size">
            <span>Select scale</span>
            <select
              id="map-size"
              value={mapSize}
              onChange={(event) => setMapSize(event.target.value as MapSize)}
            >
              {MAP_SIZE_ORDER.map((size) => (
                <option key={size} value={size}>
                  {WORLD_SCALE_CONFIGS[size].label}
                </option>
              ))}
            </select>
          </label>
          <p>
            {WORLD_SCALE_CONFIGS[mapSize].width} x {WORLD_SCALE_CONFIGS[mapSize].height}
          </p>
          <p>Target cells: {WORLD_SCALE_CONFIGS[mapSize].voronoiCellTarget}</p>
        </section>

        <dl className="stats">
          <div>
            <dt>Counties</dt>
            <dd>{world.counties.length}</dd>
          </div>
          <div>
            <dt>Sea-zones</dt>
            <dd>{world.seaZones.length}</dd>
          </div>
          <div>
            <dt>Land-masses</dt>
            <dd>{world.landMasses.length}</dd>
          </div>
        </dl>

        <section className="details">
          <h2>Selected County</h2>
          {selectedCounty ? (
            <>
              <p>{selectedCounty.name}</p>
              <p>ID: {selectedCounty.id}</p>
              <p>Area: {Math.round(selectedCounty.area)}</p>
              <p>Neighbors: {selectedCounty.neighbors.length}</p>
            </>
          ) : (
            <p>Click a county to inspect metadata.</p>
          )}
        </section>

        <section className="details">
          <h2>Hovered County</h2>
          {hoveredCounty ? (
            <p>{hoveredCounty.id}</p>
          ) : (
            <p>Move the mouse over a county polygon.</p>
          )}
        </section>

        <section className="details">
          <h2>Debug Overlay</h2>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={showSeaZoneLayers}
              onChange={(event) => setShowSeaZoneLayers(event.target.checked)}
            />
            <span>Color sea-zones by coastline layer</span>
          </label>
        </section>
      </aside>

      <main className="map-area">
        <div ref={mapHostRef} className="map-canvas" />
      </main>
    </div>
  )
}

export default App
