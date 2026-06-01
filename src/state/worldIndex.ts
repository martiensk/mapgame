import { computeSeaZoneLayerById } from '../generation/seaZoneLayers'
import type {
  County,
  LandMass,
  RegionId,
  SeaZone,
  WorldData,
} from '../types/world'

export interface WorldIndex {
  countiesById: Map<RegionId, County>
  seaZonesById: Map<RegionId, SeaZone>
  landMassesById: Map<RegionId, LandMass>
  countyNeighborsByCountyId: Map<RegionId, County[]>
  seaZoneNeighborsBySeaZoneId: Map<RegionId, SeaZone[]>
  coastalCountyIdsBySeaZoneId: Map<RegionId, RegionId[]>
  seaZoneIdsByCountyId: Map<RegionId, RegionId[]>
  seaZoneLayerById: Map<RegionId, number>
}

export function createWorldIndex(world: WorldData): WorldIndex {
  const countiesById = new Map(world.counties.map((county) => [county.id, county]))
  const seaZonesById = new Map(world.seaZones.map((seaZone) => [seaZone.id, seaZone]))
  const landMassesById = new Map(
    world.landMasses.map((landMass) => [landMass.id, landMass]),
  )

  const countyNeighborsByCountyId = new Map<RegionId, County[]>()
  world.counties.forEach((county) => {
    const neighbors = county.neighbors
      .map((neighborId) => countiesById.get(neighborId))
      .filter((neighbor): neighbor is County => Boolean(neighbor))

    countyNeighborsByCountyId.set(county.id, neighbors)
  })

  const seaZoneNeighborsBySeaZoneId = new Map<RegionId, SeaZone[]>()
  world.seaZones.forEach((seaZone) => {
    const neighbors = seaZone.neighbors
      .map((neighborId) => seaZonesById.get(neighborId))
      .filter((neighbor): neighbor is SeaZone => Boolean(neighbor))

    seaZoneNeighborsBySeaZoneId.set(seaZone.id, neighbors)
  })

  const coastalCountyIdsBySeaZoneId = new Map<RegionId, RegionId[]>()
  const seaZoneIdsByCountyId = new Map<RegionId, RegionId[]>()

  world.counties.forEach((county) => {
    seaZoneIdsByCountyId.set(county.id, [])
  })

  world.seaZones.forEach((seaZone) => {
    coastalCountyIdsBySeaZoneId.set(seaZone.id, [...seaZone.coastalCountyIds])

    seaZone.coastalCountyIds.forEach((countyId) => {
      const linkedSeaZoneIds = seaZoneIdsByCountyId.get(countyId)
      if (!linkedSeaZoneIds) {
        return
      }

      linkedSeaZoneIds.push(seaZone.id)
    })
  })

  return {
    countiesById,
    seaZonesById,
    landMassesById,
    countyNeighborsByCountyId,
    seaZoneNeighborsBySeaZoneId,
    coastalCountyIdsBySeaZoneId,
    seaZoneIdsByCountyId,
    seaZoneLayerById: computeSeaZoneLayerById(world.seaZones),
  }
}