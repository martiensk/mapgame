import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  DEFAULT_MAP_SIZE,
  MAP_SIZE_ORDER,
  WORLD_SCALE_CONFIGS,
  type MapSize,
} from './config/worldScaleConfig'
import { DEBUG_CONFIG } from './config/debugConfig'
import { PixiMap, type MapDisplayMode } from './render/pixiMap'
import { createWorldState } from './state/worldState'
import type { County, SeaZone } from './types/world'

function generateRandomSeed(): string {
  const uuid = crypto.randomUUID().split('-')[0]
  return `seed-${uuid}`
}

function formatTemperature(value: number): string {
  return value.toFixed(3)
}

function App() {
  const [mapSize, setMapSize] = useState<MapSize>(DEFAULT_MAP_SIZE)
  const [latitudeTemperatureGamma, setLatitudeTemperatureGamma] = useState(
    WORLD_SCALE_CONFIGS[DEFAULT_MAP_SIZE].latitudeTemperatureGamma,
  )
  const [isMenuCollapsed, setIsMenuCollapsed] = useState(true)
  const [displayMode, setDisplayMode] = useState<MapDisplayMode>(
    DEBUG_CONFIG.defaultMapDisplayMode,
  )
  const worldState = useMemo(
    () => createWorldState(generateRandomSeed(), WORLD_SCALE_CONFIGS[DEFAULT_MAP_SIZE]),
    [],
  )
  const [seed, setSeed] = useState('')
  const [world, setWorld] = useState(worldState.world)
  const [hoveredCounty, setHoveredCounty] = useState<County | null>(null)
  const [hoveredSeaZone, setHoveredSeaZone] = useState<SeaZone | null>(null)
  const [showHoveredCountyOverlay, setShowHoveredCountyOverlay] = useState(true)
  const mapHostRef = useRef<HTMLDivElement | null>(null)
  const pixiMapRef = useRef<PixiMap | null>(null)
  const initialWorldRef = useRef(world)
  const seaZoneLayerById = worldState.index.seaZoneLayerById
  const hoveredSeaZoneLayer = hoveredSeaZone
    ? seaZoneLayerById.get(hoveredSeaZone.id) ?? 1
    : null

  useEffect(() => {
    if (!mapHostRef.current) {
      return undefined
    }

    const pixiMap = new PixiMap(mapHostRef.current, {
      onHoverCounty: setHoveredCounty,
      onHoverSeaZone: setHoveredSeaZone,
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
    pixiMapRef.current?.setDisplayMode(displayMode)
  }, [displayMode])

  const onRegenerate = (): void => {
    const typedSeed = seed.trim()
    const nextSeed = typedSeed || generateRandomSeed()
    const nextWorld = worldState.regenerate(nextSeed, {
      ...WORLD_SCALE_CONFIGS[mapSize],
      latitudeTemperatureGamma,
    })
    setHoveredCounty(null)
    setHoveredSeaZone(null)
    setWorld(nextWorld)
  }

  const hoveredRegion = hoveredCounty ?? hoveredSeaZone

  return (
    <div className={`layout ${isMenuCollapsed ? 'menu-collapsed' : ''}`}>
      <header className="site-header">
        <button
          type="button"
          className="hamburger-toggle"
          onClick={() => setIsMenuCollapsed((previous) => !previous)}
          aria-expanded={!isMenuCollapsed}
          aria-controls="bootstrap-panel"
          aria-label={isMenuCollapsed ? 'Open debug menu' : 'Close debug menu'}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <h1 className="site-title">Map Generator</h1>
        <label className="header-mode-row" htmlFor="map-display-mode">
          <span>Map mode</span>
          <select
            id="map-display-mode"
            className="header-mode-select"
            value={displayMode}
            onChange={(event) => setDisplayMode(event.target.value as MapDisplayMode)}
          >
            <option value="landscape">Landscape</option>
            <option value="sea-zone">Sea zone</option>
            <option value="temperature">Temperature</option>
            <option value="climate">Climate</option>
          </select>
        </label>
        <button type="button" className="header-generate" onClick={onRegenerate}>
          Generate
        </button>
      </header>

      <aside id="bootstrap-panel" className="panel">
        <h2>Debug Menu</h2>
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

          <label className="scale-row" htmlFor="latitude-temperature-gamma">
            <span>Latitude temp curve</span>
            <input
              id="latitude-temperature-gamma"
              type="range"
              min="0.6"
              max="2.4"
              step="0.05"
              value={latitudeTemperatureGamma}
              onChange={(event) =>
                setLatitudeTemperatureGamma(Number(event.target.value))
              }
            />
          </label>
          <p>Gamma: {latitudeTemperatureGamma.toFixed(2)}</p>
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
          <h2>Hovered Region</h2>
          {hoveredRegion ? (
            <>
              <p>ID: {hoveredRegion.id}</p>
              <p>Type: {hoveredCounty ? 'County' : 'Sea-zone'}</p>
              <p>Biome: {hoveredRegion.biomeId}</p>
              <p>Climate: {hoveredRegion.climateId}</p>
              <p>Base Temp: {formatTemperature(hoveredRegion.temperatureBase)}</p>
              <p>Final Temp: {formatTemperature(hoveredRegion.temperature)}</p>
              {hoveredSeaZone && hoveredSeaZoneLayer !== null ? (
                <p>Sea-zone layer: {hoveredSeaZoneLayer}</p>
              ) : null}
            </>
          ) : (
            <p>Move the mouse over a county or sea-zone polygon.</p>
          )}
        </section>

        <section className="details">
          <h2>Debug Overlay</h2>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={showHoveredCountyOverlay}
              onChange={(event) => setShowHoveredCountyOverlay(event.target.checked)}
            />
            <span>Show hovered region overlay</span>
          </label>
        </section>
      </aside>

      <main className="map-area">
        <div ref={mapHostRef} className="map-canvas" />
      </main>

      {showHoveredCountyOverlay && hoveredRegion ? (
        <section className="selected-county-overlay" aria-hidden="true">
          <h2>{hoveredCounty ? 'Hovered County' : 'Hovered Sea-zone'}</h2>
          {hoveredCounty ? (
            <>
              <p>{hoveredCounty.name}</p>
              <p>ID: {hoveredCounty.id}</p>
              <p>Area: {Math.round(hoveredCounty.area)}</p>
              <p>Neighbors: {hoveredCounty.neighbors.length}</p>
              <p>Land-mass: {hoveredCounty.landMassId}</p>
              <p>Biome: {hoveredCounty.biomeId}</p>
              <p>Climate: {hoveredCounty.climateId}</p>
              <p>Base Temp: {formatTemperature(hoveredCounty.temperatureBase)}</p>
              <p>Final Temp: {formatTemperature(hoveredCounty.temperature)}</p>
            </>
          ) : hoveredSeaZone ? (
            <>
              <p>ID: {hoveredSeaZone.id}</p>
              <p>Land-distance: {hoveredSeaZoneLayer ?? 1}</p>
              <p>Area: {Math.round(hoveredSeaZone.area)}</p>
              <p>Neighbors: {hoveredSeaZone.neighbors.length}</p>
              <p>Coastal counties: {hoveredSeaZone.coastalCountyIds.length}</p>
              <p>Biome: {hoveredSeaZone.biomeId}</p>
              <p>Climate: {hoveredSeaZone.climateId}</p>
              <p>Base Temp: {formatTemperature(hoveredSeaZone.temperatureBase)}</p>
              <p>Final Temp: {formatTemperature(hoveredSeaZone.temperature)}</p>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

export default App
