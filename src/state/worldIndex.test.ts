import { describe, expect, it } from 'vitest'
import { WORLD_SCALE_CONFIGS } from '../config/worldScaleConfig'
import { generateWorld } from '../generation/world'
import { createWorldState } from './worldState'
import { createWorldIndex } from './worldIndex'

describe('createWorldIndex', () => {
  it('creates direct lookup maps for all world regions', () => {
    const world = generateWorld('index-lookup-check', WORLD_SCALE_CONFIGS.small)
    const index = createWorldIndex(world)

    expect(index.countiesById.size).toBe(world.counties.length)
    expect(index.seaZonesById.size).toBe(world.seaZones.length)
    expect(index.landMassesById.size).toBe(world.landMasses.length)
  })

  it('resolves county and sea-zone neighbors to concrete objects', () => {
    const world = generateWorld('index-neighbor-check', WORLD_SCALE_CONFIGS.small)
    const index = createWorldIndex(world)

    world.counties.forEach((county) => {
      const resolvedNeighbors = index.countyNeighborsByCountyId.get(county.id) ?? []
      expect(resolvedNeighbors.map((neighbor) => neighbor.id)).toEqual(county.neighbors)
    })

    world.seaZones.forEach((seaZone) => {
      const resolvedNeighbors = index.seaZoneNeighborsBySeaZoneId.get(seaZone.id) ?? []
      expect(resolvedNeighbors.map((neighbor) => neighbor.id)).toEqual(seaZone.neighbors)
    })
  })

  it('builds consistent coastal bidirectional indexes', () => {
    const world = generateWorld('index-coastal-check', WORLD_SCALE_CONFIGS.small)
    const index = createWorldIndex(world)

    world.seaZones.forEach((seaZone) => {
      const coastalCountyIds = index.coastalCountyIdsBySeaZoneId.get(seaZone.id) ?? []
      expect(coastalCountyIds).toEqual(seaZone.coastalCountyIds)

      coastalCountyIds.forEach((countyId) => {
        const linkedSeaZoneIds = index.seaZoneIdsByCountyId.get(countyId) ?? []
        expect(linkedSeaZoneIds).toContain(seaZone.id)
      })
    })
  })

  it('assigns a layer entry to every sea-zone', () => {
    const world = generateWorld('index-layer-check', WORLD_SCALE_CONFIGS.small)
    const index = createWorldIndex(world)

    expect(index.seaZoneLayerById.size).toBe(world.seaZones.length)
    world.seaZones.forEach((seaZone) => {
      expect(index.seaZoneLayerById.has(seaZone.id)).toBe(true)
    })
  })
})

describe('createWorldState', () => {
  it('keeps world and index synchronized after regenerate', () => {
    const worldState = createWorldState('sync-initial', WORLD_SCALE_CONFIGS.small)
    const nextWorld = worldState.regenerate('sync-next', WORLD_SCALE_CONFIGS.medium)

    expect(worldState.world).toBe(nextWorld)
    expect(worldState.index.countiesById.size).toBe(nextWorld.counties.length)
    expect(worldState.index.seaZonesById.size).toBe(nextWorld.seaZones.length)
  })
})