import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import moistureMapper from './data/moistureMapper.json'
import terrainMapper from './data/terrainMapper.json'
import temperatureMapper from './data/temperatureMapper.json'
import {
  DEFAULT_MAP_SIZE,
  MAP_SIZE_ORDER,
  WORLD_SCALE_CONFIGS,
  type MapSize,
} from './config/worldScaleConfig'
import { DEBUG_CONFIG } from './config/debugConfig'
import { PixiMap, type MapDisplayMode, type SpriteDebugReport } from './render/pixiMap'
import { createWorldState } from './state/worldState'
import type { County, RiverSegment, SeaZone } from './types/world'

function generateRandomSeed(): string {
  const uuid = crypto.randomUUID().split('-')[0]
  return `seed-${uuid}`
}

function generateRandomMoistureBaseLevel(): number {
  const minimum = 0.1
  const maximum = 0.4
  const rawValue = minimum + Math.random() * (maximum - minimum)
  return Number(rawValue.toFixed(2))
}

interface MoistureMapperRange {
  min: number
  max: number
  label: string
}

interface MoistureMapperDocument {
  ranges: MoistureMapperRange[]
}

interface ClimateMapperRange {
  climateId: string
  label: string
}

interface ClimateMapperDocument {
  ranges: ClimateMapperRange[]
}

interface TerrainMapperRange {
  min: number
  max: number
  label: string
}

interface TerrainMapperDocument {
  seaLabel: string
  ranges: TerrainMapperRange[]
}

const moistureRanges = (moistureMapper as MoistureMapperDocument).ranges
const terrainMapping = terrainMapper as TerrainMapperDocument
const climateLabelById = new Map(
  (temperatureMapper as ClimateMapperDocument).ranges.map((range) => [range.climateId, range.label]),
)

function moistureNameFromValue(moisture: number): string {
  const clampedMoisture = Math.max(0, Math.min(1, moisture))

  for (let index = 0; index < moistureRanges.length; index += 1) {
    const range = moistureRanges[index]
    const isLastRange = index === moistureRanges.length - 1
    const insideRange =
      clampedMoisture >= range.min &&
      (isLastRange ? clampedMoisture <= range.max : clampedMoisture < range.max)

    if (insideRange) {
      return range.label
    }
  }

  return moistureRanges[moistureRanges.length - 1]?.label ?? 'Saturated'
}

function climateNameFromId(climateId: string): string {
  return climateLabelById.get(climateId) ?? climateId
}

function terrainTypeFromElevation(elevation: number, isSeaZone: boolean): string {
  if (isSeaZone) {
    return terrainMapping.seaLabel
  }

  const clampedElevation = Math.max(0, Math.min(1, elevation))

  let terrainClass = terrainMapping.ranges[terrainMapping.ranges.length - 1]?.label ?? 'Peaks'

  for (let index = 0; index < terrainMapping.ranges.length; index += 1) {
    const range = terrainMapping.ranges[index]
    const isLastRange = index === terrainMapping.ranges.length - 1
    const insideRange =
      clampedElevation >= range.min &&
      (isLastRange ? clampedElevation <= range.max : clampedElevation < range.max)

    if (insideRange) {
      terrainClass = range.label
      break
    }
  }

  return terrainClass
}

function App() {
  const [mapSize, setMapSize] = useState<MapSize>(DEFAULT_MAP_SIZE)
  const [latitudeTemperatureGamma, setLatitudeTemperatureGamma] = useState(
    WORLD_SCALE_CONFIGS[DEFAULT_MAP_SIZE].latitudeTemperatureGamma,
  )
  const [moistureBaseLevel, setMoistureBaseLevel] = useState(
    generateRandomMoistureBaseLevel(),
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
  const [hoveredRiverSegment, setHoveredRiverSegment] = useState<RiverSegment | null>(null)
  const [spriteDebug, setSpriteDebug] = useState<SpriteDebugReport | null>(null)
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
      onHoverRiverSegment: setHoveredRiverSegment,
      onSpriteDebugUpdate: setSpriteDebug,
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
    const nextMoistureBaseLevel = generateRandomMoistureBaseLevel()
    setMoistureBaseLevel(nextMoistureBaseLevel)
    const nextWorld = worldState.regenerate(nextSeed, {
      ...WORLD_SCALE_CONFIGS[mapSize],
      latitudeTemperatureGamma,
      moistureBaseLevel: nextMoistureBaseLevel,
    })
    setHoveredCounty(null)
    setHoveredSeaZone(null)
    setHoveredRiverSegment(null)
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
            <option value="biome">Biome</option>
            <option value="sea-zone">Sea zone</option>
            <option value="temperature">Temperature</option>
            <option value="climate">Climate</option>
            <option value="elevation">Elevation</option>
            <option value="moisture">Moisture</option>
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

          <label className="scale-row" htmlFor="moisture-base-level">
            <span>Moisture base level</span>
            <input
              id="moisture-base-level"
              type="range"
              min="0"
              max="0.6"
              step="0.01"
              value={moistureBaseLevel}
              onChange={(event) => setMoistureBaseLevel(Number(event.target.value))}
            />
          </label>
          <p>Base moisture: {moistureBaseLevel.toFixed(2)}</p>
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
          {hoveredRiverSegment ? (
            <>
              <p>ID: {hoveredRiverSegment.id}</p>
              <p>Type: River segment</p>
              <p>River: {hoveredRiverSegment.riverId}</p>
              <p>Flow index: {hoveredRiverSegment.flowIndex}</p>
              <p>County neighbors: {hoveredRiverSegment.countyNeighborIds.length}</p>
              <p>Mouth: {hoveredRiverSegment.isMouth ? 'Yes' : 'No'}</p>
              <p>Area: {Math.round(hoveredRiverSegment.area)}</p>
            </>
          ) : hoveredRegion ? (
            <>
              <p>Type: {hoveredCounty ? 'County' : 'Sea-zone'}</p>
              <p>Biome: {hoveredRegion.biomeId}</p>
              <p>Climate: {climateNameFromId(hoveredRegion.climateId)}</p>
              <p>
                Terrain:{' '}
                {terrainTypeFromElevation(
                  hoveredRegion.elevation,
                  Boolean(hoveredSeaZone),
                )}
              </p>
              <p>Moisture Band: {moistureNameFromValue(hoveredRegion.moisture)}</p>
              {hoveredSeaZone && hoveredSeaZoneLayer !== null ? (
                <p>Sea-zone layer: {hoveredSeaZoneLayer}</p>
              ) : null}
            </>
          ) : (
            <p>Move the mouse over a county, sea-zone, or river segment polygon.</p>
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

        <section className="details">
          <h2>Sprite Debug</h2>
          {spriteDebug ? (
            <>
              <p>Enabled: {spriteDebug.enabled ? 'Yes' : 'No'}</p>
              <p>Zoom: {spriteDebug.zoom.toFixed(2)}</p>
              <p>Loaded families: {spriteDebug.loadedFamilyCount}</p>
              <p>Loaded textures: {spriteDebug.loadedTextureCount}</p>
              <p>Planned sprites: {spriteDebug.plannedSpriteCount}</p>
              <p>Visible sprites: {spriteDebug.visibleSpriteCount}</p>
              {spriteDebug.familyStats.length > 0 ? (
                <div className="sprite-family-debug-list">
                  {spriteDebug.familyStats.map((stats) => (
                    <p key={stats.familyId}>
                      {stats.familyId}: textures={stats.loadedTextureCount}, planned={stats.plannedCount}, visible={stats.visibleCount}
                    </p>
                  ))}
                </div>
              ) : (
                <p>No sprite families discovered.</p>
              )}
            </>
          ) : (
            <p>Waiting for sprite debug data.</p>
          )}
        </section>
      </aside>
      
      <main className="map-area">
        <div ref={mapHostRef} className="map-canvas" />
      </main>

      {showHoveredCountyOverlay && (hoveredRegion || hoveredRiverSegment) ? (
        <section className="selected-county-overlay" aria-hidden="true">
          <h2>
            {hoveredRiverSegment
              ? 'Hovered River Segment'
              : hoveredCounty
                ? 'Hovered County'
                : 'Hovered Sea-zone'}
          </h2>
          {hoveredRiverSegment ? (
            <>
              <p>ID: {hoveredRiverSegment.id}</p>
              <p>River: {hoveredRiverSegment.riverId}</p>
              <p>Flow index: {hoveredRiverSegment.flowIndex}</p>
              <p>Area: {Math.round(hoveredRiverSegment.area)}</p>
              <p>County neighbors: {hoveredRiverSegment.countyNeighborIds.length}</p>
              <p>Neighbor IDs: {hoveredRiverSegment.countyNeighborIds.join(', ')}</p>
              <p>Mouth: {hoveredRiverSegment.isMouth ? 'Yes' : 'No'}</p>
            </>
          ) : hoveredCounty ? (
            <>
              <p>{hoveredCounty.name}</p>
              <p>Area: {Math.round(hoveredCounty.area)}</p>
              <p>Neighbors: {hoveredCounty.neighbors.length}</p>
              <p>Biome: {hoveredCounty.biomeId}</p>
              <p>Climate: {climateNameFromId(hoveredCounty.climateId)}</p>
              <p>
                Terrain: {terrainTypeFromElevation(hoveredCounty.elevation, false)}
              </p>
              <p>Moisture Band: {moistureNameFromValue(hoveredCounty.moisture)}</p>
            </>
          ) : hoveredSeaZone ? (
            <>
              <p>Land-distance: {hoveredSeaZoneLayer ?? 1}</p>
              <p>Area: {Math.round(hoveredSeaZone.area)}</p>
              <p>Neighbors: {hoveredSeaZone.neighbors.length}</p>
              <p>Coastal counties: {hoveredSeaZone.coastalCountyIds.length}</p>
              <p>Biome: {hoveredSeaZone.biomeId}</p>
              <p>Climate: {climateNameFromId(hoveredSeaZone.climateId)}</p>
              <p>
                Terrain: {terrainTypeFromElevation(hoveredSeaZone.elevation, true)}
              </p>
              <p>Moisture Band: {moistureNameFromValue(hoveredSeaZone.moisture)}</p>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

export default App
