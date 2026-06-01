import { computeSeaZoneLayerById } from '../generation/seaZoneLayers'
import type {
  County,
  LandMass,
  RegionId,
  River,
  RiverSegment,
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
  riversById: Map<string, River>
  riversByCountyId: Map<RegionId, River[]>
  riverSegmentsById: Map<RegionId, RiverSegment>
  riverSegmentsByCountyId: Map<RegionId, RiverSegment[]>
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

  function buildRiversByCountyId(rivers: River[]): Map<RegionId, River[]> {
    const map = new Map<RegionId, River[]>()
    for (const river of rivers) {
      for (const countyId of river.countyPath) {
        const existing = map.get(countyId)
        if (existing) {
          existing.push(river)
        } else {
          map.set(countyId, [river])
        }
      }
    }
    return map
  }

  function buildRiverSegmentsByCountyId(rivers: River[]): Map<RegionId, RiverSegment[]> {
    const map = new Map<RegionId, RiverSegment[]>()

    for (const river of rivers) {
      for (const segment of river.segments) {
        for (const countyId of segment.countyNeighborIds) {
          const existing = map.get(countyId)
          if (existing) {
            existing.push(segment)
          } else {
            map.set(countyId, [segment])
          }
        }
      }
    }

    return map
  }

  const riverSegments = world.rivers.flatMap((river) => river.segments)

  return {
    countiesById,
    seaZonesById,
    landMassesById,
    countyNeighborsByCountyId,
    seaZoneNeighborsBySeaZoneId,
    coastalCountyIdsBySeaZoneId,
    seaZoneIdsByCountyId,
    seaZoneLayerById: computeSeaZoneLayerById(world.seaZones),
    riversById: new Map(world.rivers.map((river) => [river.id, river])),
    riversByCountyId: buildRiversByCountyId(world.rivers),
    riverSegmentsById: new Map(riverSegments.map((segment) => [segment.id, segment])),
    riverSegmentsByCountyId: buildRiverSegmentsByCountyId(world.rivers),
  }
}