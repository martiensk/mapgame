import { WORLD_SCALE_CONFIGS } from '../config/worldScaleConfig'
import { describe, expect, it } from 'vitest'
import { computeSeaZoneLayerById } from './seaZoneLayers'
import { DEFAULT_WORLD_CONFIG, generateWorld } from './world'

const MIN_TEMPERATURE = 0
const MAX_TEMPERATURE = 1
const MIN_BASE_TEMPERATURE = 0.1
const MAX_BASE_TEMPERATURE = 0.9
const FREEZING_OCEAN_THRESHOLD = MIN_BASE_TEMPERATURE
const SEA_ZONE_LAYER_TEMPERATURE_STEP = 3 / 140

function clampTemperature(value: number): number {
  return Math.max(MIN_TEMPERATURE, Math.min(MAX_TEMPERATURE, value))
}

function climateFromTemperature(temperature: number): string {
  if (temperature < 0.1) {
    return 'arctic'
  }

  if (temperature < 0.26) {
    return 'subarctic'
  }

  if (temperature < 0.42) {
    return 'cool'
  }

  if (temperature < 0.58) {
    return 'temperate'
  }

  if (temperature < 0.74) {
    return 'warm'
  }

  if (temperature < 0.9) {
    return 'tropical'
  }

  return 'extreme'
}

function worldSignature(seed: string): string {
  const world = generateWorld(seed, DEFAULT_WORLD_CONFIG)
  return JSON.stringify({
    metadata: {
      seed: world.metadata.seed,
      width: world.metadata.width,
      height: world.metadata.height,
      countyDensity: world.metadata.countyDensity,
      seaZoneTarget: world.metadata.seaZoneTarget,
    },
    countyIds: world.counties.map((county) => county.id),
    countyCentroids: world.counties.map((county) => [
      Number(county.centroid.x.toFixed(2)),
      Number(county.centroid.y.toFixed(2)),
    ]),
    seaZoneIds: world.seaZones.map((zone) => zone.id),
    landMassTypes: world.landMasses.map((landMass) => landMass.type),
  })
}

describe('generateWorld', () => {
  it('returns deterministic output for the same seed and config', () => {
    expect(worldSignature('atlas-42')).toBe(worldSignature('atlas-42'))
  })

  it('creates non-empty land and sea region collections', () => {
    const world = generateWorld('smoke-check', DEFAULT_WORLD_CONFIG)

    expect(world.landMasses.length).toBeGreaterThan(0)
    expect(world.counties.length).toBeGreaterThan(0)
    expect(world.seaZones.length).toBeGreaterThan(0)

    const landMassTypes = new Set(world.landMasses.map((landMass) => landMass.type))
    expect(landMassTypes.has('continent')).toBe(true)
    expect(landMassTypes.has('island')).toBe(true)

    const continents = world.landMasses.filter(
      (landMass) => landMass.type === 'continent',
    )
    expect(continents.length).toBeGreaterThanOrEqual(2)
  })

  it('partitions the full world area with counties and sea-zones', () => {
    const world = generateWorld('coverage-check', DEFAULT_WORLD_CONFIG)
    const worldArea = world.metadata.width * world.metadata.height
    const regionArea =
      world.counties.reduce((sum, county) => sum + county.area, 0) +
      world.seaZones.reduce((sum, seaZone) => sum + seaZone.area, 0)

    const relativeDelta = Math.abs(regionArea - worldArea) / worldArea
    expect(relativeDelta).toBeLessThan(0.01)
  })

  it('honors configured minimum county count', () => {
    const world = generateWorld('county-floor-check', {
      ...DEFAULT_WORLD_CONFIG,
      minCountyCount: 900,
    })

    expect(world.counties.length).toBeGreaterThanOrEqual(900)
  })

  it('increases generated region count by map scale', () => {
    const small = generateWorld('scale-check', WORLD_SCALE_CONFIGS.small)
    const medium = generateWorld('scale-check', WORLD_SCALE_CONFIGS.medium)
    const large = generateWorld('scale-check', WORLD_SCALE_CONFIGS.large)
    const huge = generateWorld('scale-check', WORLD_SCALE_CONFIGS.huge)

    const smallCells = small.counties.length + small.seaZones.length
    const mediumCells = medium.counties.length + medium.seaZones.length
    const largeCells = large.counties.length + large.seaZones.length
    const hugeCells = huge.counties.length + huge.seaZones.length

    expect(mediumCells).toBeGreaterThan(smallCells)
    expect(largeCells).toBeGreaterThan(mediumCells)
    expect(hugeCells).toBeGreaterThan(largeCells)

    expect(smallCells).toBeLessThanOrEqual(WORLD_SCALE_CONFIGS.small.voronoiCellTarget)
    expect(mediumCells).toBeLessThanOrEqual(WORLD_SCALE_CONFIGS.medium.voronoiCellTarget)
    expect(largeCells).toBeLessThanOrEqual(WORLD_SCALE_CONFIGS.large.voronoiCellTarget)
    expect(hugeCells).toBeLessThanOrEqual(WORLD_SCALE_CONFIGS.huge.voronoiCellTarget)
  }, 15000)

  it('caps land counties to one third of total regions', () => {
    const world = generateWorld('coastline-cap-check', DEFAULT_WORLD_CONFIG)
    const totalRegions = world.counties.length + world.seaZones.length
    const landShare = world.counties.length / totalRegions

    // Keep land regions constrained well below half while allowing
    // topology variance from Voronoi sampling and compact merge scoring.
    expect(landShare).toBeLessThanOrEqual(0.38)
  })

  it('keeps sea-zone references valid after merge passes', () => {
    const world = generateWorld('sea-merge-integrity-check', DEFAULT_WORLD_CONFIG)
    const countyIds = new Set(world.counties.map((county) => county.id))
    const seaZoneIds = new Set(world.seaZones.map((seaZone) => seaZone.id))

    world.seaZones.forEach((seaZone) => {
      const uniqueNeighbors = new Set(seaZone.neighbors)
      expect(uniqueNeighbors.size).toBe(seaZone.neighbors.length)
      expect(uniqueNeighbors.has(seaZone.id)).toBe(false)

      seaZone.neighbors.forEach((neighborId) => {
        expect(seaZoneIds.has(neighborId)).toBe(true)
      })

      const uniqueCoastalCountyIds = new Set(seaZone.coastalCountyIds)
      expect(uniqueCoastalCountyIds.size).toBe(seaZone.coastalCountyIds.length)
      seaZone.coastalCountyIds.forEach((countyId) => {
        expect(countyIds.has(countyId)).toBe(true)
      })
    })
  })

  it('composes temperatures from base, global modifier, and biome modifier', () => {
    const world = generateWorld('temperature-range-check', DEFAULT_WORLD_CONFIG)

    world.counties.forEach((county) => {
      expect(county.biomeId).toBe('plains')
      expect(county.temperatureGlobalModifier).toBe(0)
      expect(county.temperatureBiomeModifier).toBe(0)
      const unclampedTemperature =
        county.temperatureBase +
        county.temperatureGlobalModifier +
        county.temperatureBiomeModifier
      expect(county.temperatureBase).toBeGreaterThanOrEqual(MIN_BASE_TEMPERATURE)
      expect(county.temperatureBase).toBeLessThanOrEqual(MAX_BASE_TEMPERATURE)
      expect(county.temperature).toBeCloseTo(
        clampTemperature(unclampedTemperature),
      )
      expect(county.temperature).toBeGreaterThanOrEqual(MIN_TEMPERATURE)
      expect(county.temperature).toBeLessThanOrEqual(MAX_TEMPERATURE)
      expect(county.climateId).toBe(climateFromTemperature(county.temperature))
      expect(county.climateId).not.toBe('arctic')
      expect(county.climateId).not.toBe('extreme')
    })

    const layerBySeaZoneId = computeSeaZoneLayerById(world.seaZones)

    world.seaZones.forEach((seaZone) => {
      const layer = layerBySeaZoneId.get(seaZone.id) ?? 1
      expect(seaZone.temperatureGlobalModifier).toBe(0)
      expect(seaZone.temperatureBiomeModifier).toBeCloseTo(
        -(layer * SEA_ZONE_LAYER_TEMPERATURE_STEP),
      )
      const unclampedTemperature =
        seaZone.temperatureBase +
        seaZone.temperatureGlobalModifier +
        seaZone.temperatureBiomeModifier
      expect(seaZone.temperatureBase).toBeGreaterThanOrEqual(MIN_BASE_TEMPERATURE)
      expect(seaZone.temperatureBase).toBeLessThanOrEqual(MAX_BASE_TEMPERATURE)
      expect(seaZone.temperature).toBeCloseTo(
        clampTemperature(unclampedTemperature),
      )
      expect(seaZone.temperature).toBeGreaterThanOrEqual(MIN_TEMPERATURE)
      expect(seaZone.temperature).toBeLessThanOrEqual(MAX_TEMPERATURE)
      expect(seaZone.climateId).toBe(climateFromTemperature(seaZone.temperature))

      if (seaZone.temperature < FREEZING_OCEAN_THRESHOLD) {
        expect(seaZone.biomeId).toBe('freezing ocean')
      } else {
        expect(seaZone.biomeId).toBe('ocean')
      }
    })
  })

  it('generates deterministic temperatures for a fixed seed', () => {
    const first = generateWorld('temperature-determinism', DEFAULT_WORLD_CONFIG)
    const second = generateWorld('temperature-determinism', DEFAULT_WORLD_CONFIG)

    expect(
      first.counties.map((county) => ({
        biomeId: county.biomeId,
        climateId: county.climateId,
        base: county.temperatureBase,
        biomeModifier: county.temperatureBiomeModifier,
        globalModifier: county.temperatureGlobalModifier,
        final: county.temperature,
      })),
    ).toEqual(
      second.counties.map((county) => ({
        biomeId: county.biomeId,
        climateId: county.climateId,
        base: county.temperatureBase,
        biomeModifier: county.temperatureBiomeModifier,
        globalModifier: county.temperatureGlobalModifier,
        final: county.temperature,
      })),
    )
    expect(
      first.seaZones.map((seaZone) => ({
        biomeId: seaZone.biomeId,
        climateId: seaZone.climateId,
        base: seaZone.temperatureBase,
        biomeModifier: seaZone.temperatureBiomeModifier,
        globalModifier: seaZone.temperatureGlobalModifier,
        final: seaZone.temperature,
      })),
    ).toEqual(
      second.seaZones.map((seaZone) => ({
        biomeId: seaZone.biomeId,
        climateId: seaZone.climateId,
        base: seaZone.temperatureBase,
        biomeModifier: seaZone.temperatureBiomeModifier,
        globalModifier: seaZone.temperatureGlobalModifier,
        final: seaZone.temperature,
      })),
    )
  })
})
