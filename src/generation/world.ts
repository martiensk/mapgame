import { DEFAULT_MAP_SIZE, WORLD_SCALE_CONFIGS } from '../config/worldScaleConfig'
import type { County, SeaZone, WorldConfig, WorldData } from '../types/world'
import { generateCounties, mergeCountiesPhase } from './counties'
import { generateLandMassShapes, toLandMassRecords } from './landmass'
import { createSeededRandom } from './random'
import { generateSeaZones, mergeCoastalSeaZonesPhase } from './seazones'
import { generateVoronoiWorld } from './voronoi'

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  ...WORLD_SCALE_CONFIGS[DEFAULT_MAP_SIZE],
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function assignCountyNeighbors(
  counties: County[],
  cellIdByCountyId: Map<string, string>,
  countyIdByCellId: Map<string, string>,
  neighborCellIdsById: Map<string, string[]>,
): void {
  counties.forEach((county) => {
    const sourceCellId = cellIdByCountyId.get(county.id)
    if (!sourceCellId) {
      county.neighbors = []
      return
    }

    const neighbors = (neighborCellIdsById.get(sourceCellId) ?? [])
      .map((neighborCellId) => countyIdByCellId.get(neighborCellId) ?? '')
      .filter((neighborCountyId) =>
        Boolean(neighborCountyId) && neighborCountyId !== county.id,
      )

    county.neighbors = unique(neighbors)
  })
}

function assignSeaZoneNeighbors(
  seaZones: SeaZone[],
  cellIdBySeaZoneId: Map<string, string>,
  seaZoneIdByCellId: Map<string, string>,
  neighborCellIdsById: Map<string, string[]>,
): void {
  seaZones.forEach((seaZone) => {
    const sourceCellId = cellIdBySeaZoneId.get(seaZone.id)
    if (!sourceCellId) {
      seaZone.neighbors = []
      return
    }

    const neighbors = (neighborCellIdsById.get(sourceCellId) ?? [])
      .map((neighborCellId) => seaZoneIdByCellId.get(neighborCellId) ?? '')
      .filter((neighborSeaZoneId) =>
        Boolean(neighborSeaZoneId) && neighborSeaZoneId !== seaZone.id,
      )

    seaZone.neighbors = unique(neighbors)
  })
}

function assignCoastalCounties(
  seaZones: SeaZone[],
  cellIdBySeaZoneId: Map<string, string>,
  countyIdByCellId: Map<string, string>,
  neighborCellIdsById: Map<string, string[]>,
): void {
  seaZones.forEach((seaZone) => {
    const sourceCellId = cellIdBySeaZoneId.get(seaZone.id)
    if (!sourceCellId) {
      seaZone.coastalCountyIds = []
      return
    }

    const coastalCounties = (neighborCellIdsById.get(sourceCellId) ?? [])
      .map((neighborCellId) => countyIdByCellId.get(neighborCellId) ?? '')
      .filter(Boolean)

    seaZone.coastalCountyIds = unique(coastalCounties)
  })
}

export function generateWorld(
  seed: string,
  config: WorldConfig = DEFAULT_WORLD_CONFIG,
): WorldData {
  const random = createSeededRandom(seed)
  const { cells, neighborCellIdsById } = generateVoronoiWorld(config, random)
  const landMassShapes = generateLandMassShapes(config, random)
  const countyResult = generateCounties(
    cells,
    landMassShapes,
    config,
    neighborCellIdsById,
    random,
  )

  assignCountyNeighbors(
    countyResult.counties,
    countyResult.cellIdByCountyId,
    countyResult.countyIdByCellId,
    neighborCellIdsById,
  )
  mergeCountiesPhase(countyResult, config, random)

  const { seaZones, seaZoneIdByCellId, cellIdBySeaZoneId } = generateSeaZones(
    cells,
    countyResult.countyIdByCellId,
  )
  assignSeaZoneNeighbors(
    seaZones,
    cellIdBySeaZoneId,
    seaZoneIdByCellId,
    neighborCellIdsById,
  )
  assignCoastalCounties(
    seaZones,
    cellIdBySeaZoneId,
    countyResult.countyIdByCellId,
    neighborCellIdsById,
  )
  mergeCoastalSeaZonesPhase(
    { seaZones, seaZoneIdByCellId, cellIdBySeaZoneId },
    random,
  )

  return {
    metadata: {
      seed,
      width: config.width,
      height: config.height,
      countyDensity: config.countyDensity,
      seaZoneTarget: config.seaZoneTarget,
      generatedAt: new Date().toISOString(),
    },
    counties: countyResult.counties,
    seaZones,
    landMasses: toLandMassRecords(landMassShapes, countyResult.countyIdsByLandMass),
  }
}
