import { WORLD_SCALE_CONFIGS } from '../config/worldScaleConfig'
import { describe, expect, it } from 'vitest'
import { DEFAULT_WORLD_CONFIG, generateWorld } from './world'

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
    const maxLandCount = Math.floor(totalRegions / 3)

    expect(world.counties.length).toBeLessThanOrEqual(maxLandCount)
  })
})
