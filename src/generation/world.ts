import { DEFAULT_MAP_SIZE, WORLD_SCALE_CONFIGS } from '../config/worldScaleConfig'
import biomeBaseMapper from '../data/biomeBaseMapper.json'
import moistureMapper from '../data/moistureMapper.json'
import terrainBiomeMapper from '../data/terrainBiomeMapper.json'
import terrainMapper from '../data/terrainMapper.json'
import temperatureMapper from '../data/temperatureMapper.json'
import type { County, SeaZone, WorldConfig, WorldData } from '../types/world'
import { generateCounties, mergeCountiesPhase } from './counties'
import { assignRegionElevations } from './elevation'
import { assignRegionMoisture, pickGlobalWindDirection } from './moisture'
import { generateLandMassShapes, toLandMassRecords } from './landmass'
import { createSeededRandom } from './random'
import { generateRivers } from './rivers'
import { computeSeaZoneLayerById } from './seaZoneLayers'
import { generateSeaZones, mergeCoastalSeaZonesPhase } from './seazones'
import { generateVoronoiWorld } from './voronoi'

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  ...WORLD_SCALE_CONFIGS[DEFAULT_MAP_SIZE],
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

const PLAINS_BIOME_ID = 'plains'
const OCEAN_BIOME_ID = 'ocean'
const FREEZING_OCEAN_BIOME_ID = 'freezing ocean'
const GLOBAL_TEMPERATURE_MODIFIER = 0
const MIN_TEMPERATURE = 0
const MAX_TEMPERATURE = 1
const BASE_TEMPERATURE_EDGE_EPSILON = 1e-6
const MIN_BASE_TEMPERATURE = 0.1 + BASE_TEMPERATURE_EDGE_EPSILON
const MAX_BASE_TEMPERATURE = 0.9 - BASE_TEMPERATURE_EDGE_EPSILON
const FREEZING_OCEAN_THRESHOLD = MIN_BASE_TEMPERATURE
const SEA_ZONE_LAYER_TEMPERATURE_STEP = 3 / 140

interface TemperatureMapperRange {
  min: number
  max: number
  climateId: string
}

interface TemperatureMapperDocument {
  ranges: TemperatureMapperRange[]
}

interface MoistureMapperRange {
  min: number
  max: number
  label: string
}

interface MoistureMapperDocument {
  ranges: MoistureMapperRange[]
}

interface BiomeBaseMapperDocument {
  matrix: Record<string, Record<string, string>>
}

interface TerrainMapperRange {
  min: number
  max: number
  label: string
}

interface TerrainMapperDocument {
  ranges: TerrainMapperRange[]
}

interface TerrainBiomeMapperDocument {
  terrainBiomes: Record<string, Record<string, string>>
}

const climateRanges = (temperatureMapper as TemperatureMapperDocument).ranges
const moistureRanges = (moistureMapper as MoistureMapperDocument).ranges
const biomeBaseMatrix = (biomeBaseMapper as BiomeBaseMapperDocument).matrix
const terrainRanges = (terrainMapper as TerrainMapperDocument).ranges
const terrainBiomeByClass = (terrainBiomeMapper as TerrainBiomeMapperDocument).terrainBiomes

function temperatureFromY(
  y: number,
  worldHeight: number,
  latitudeTemperatureGamma: number,
): number {
  if (worldHeight <= 0) {
    return MIN_BASE_TEMPERATURE
  }

  const halfHeight = worldHeight / 2
  if (halfHeight <= 0) {
    return MIN_BASE_TEMPERATURE
  }

  const normalizedDistanceFromEquator = Math.abs(y - halfHeight) / halfHeight
  const normalizedHeat = 1 - clamp(normalizedDistanceFromEquator, 0, 1)
  const safeGamma = Math.max(0.1, latitudeTemperatureGamma)
  const curvedHeat = Math.pow(normalizedHeat, safeGamma)
  const baseRange = MAX_BASE_TEMPERATURE - MIN_BASE_TEMPERATURE
  return MIN_BASE_TEMPERATURE + curvedHeat * baseRange
}

function composeTemperature(
  base: number,
  globalModifier: number,
  biomeModifier: number,
): number {
  return clamp(base + globalModifier + biomeModifier, MIN_TEMPERATURE, MAX_TEMPERATURE)
}

function climateFromTemperature(temperature: number): string {
  for (let index = 0; index < climateRanges.length; index += 1) {
    const range = climateRanges[index]
    const isLastRange = index === climateRanges.length - 1
    const insideRange =
      temperature >= range.min &&
      (isLastRange ? temperature <= range.max : temperature < range.max)

    if (insideRange) {
      return range.climateId
    }
  }

  if (temperature < MIN_TEMPERATURE) {
    return climateRanges[0]?.climateId ?? 'arctic'
  }

  return climateRanges[climateRanges.length - 1]?.climateId ?? 'extreme'
}

function moistureBandFromValue(moisture: number): string {
  const clampedMoisture = clamp(moisture, 0, 1)

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

  return moistureRanges[moistureRanges.length - 1]?.label ?? 'Balanced'
}

function terrainClassFromElevation(elevation: number): string {
  const clampedElevation = clamp(elevation, 0, 1)

  for (let index = 0; index < terrainRanges.length; index += 1) {
    const range = terrainRanges[index]
    const isLastRange = index === terrainRanges.length - 1
    const insideRange =
      clampedElevation >= range.min &&
      (isLastRange ? clampedElevation <= range.max : clampedElevation < range.max)

    if (insideRange) {
      return range.label
    }
  }

  return terrainRanges[terrainRanges.length - 1]?.label ?? 'Peaks'
}

function normalizeBaseBiomeForTerrain(baseBiomeId: string): string {
  switch (baseBiomeId) {
    case 'polar-desert':
      return 'desert'
    case 'taiga':
      return 'forest'
    case 'boreal-wetland':
      return 'wetland'
    case 'steppe':
      return 'grassland'
    case 'mangrove':
      return 'wetland'
    case 'frozen-wetland':
      return 'wetland'
    default:
      return baseBiomeId
  }
}

function assignCountyBiomes(counties: County[]): void {
  counties.forEach((county) => {
    const moistureBand = moistureBandFromValue(county.moisture)
    const biomeForClimate = biomeBaseMatrix[county.climateId] ?? {}
    const baseBiomeId = biomeForClimate[moistureBand] ?? PLAINS_BIOME_ID
    const normalizedBiomeId = normalizeBaseBiomeForTerrain(baseBiomeId)
    const terrainClass = terrainClassFromElevation(county.elevation)
    const terrainBiomes = terrainBiomeByClass[terrainClass]
    county.biomeId =
      terrainBiomes?.[normalizedBiomeId] ??
      terrainBiomes?.[baseBiomeId] ??
      terrainClass
  })
}

function assignRegionTemperatures(world: {
  metadata: Pick<WorldData['metadata'], 'height'>
  config: Pick<WorldConfig, 'latitudeTemperatureGamma' | 'riverCountyTemperatureCooling'>
  counties: County[]
  seaZones: SeaZone[]
  rivers: WorldData['rivers']
}): void {
  const { height } = world.metadata
  const { latitudeTemperatureGamma, riverCountyTemperatureCooling } = world.config
  const layerBySeaZoneId = computeSeaZoneLayerById(world.seaZones)
  const riverCountyIds = new Set(world.rivers.flatMap((river) => river.countyPath))

  world.counties.forEach((county) => {
    const base = temperatureFromY(
      county.centroid.y,
      height,
      latitudeTemperatureGamma,
    )
    const biomeModifier = riverCountyIds.has(county.id)
      ? -riverCountyTemperatureCooling
      : 0
    county.temperatureBase = base
    county.temperatureGlobalModifier = GLOBAL_TEMPERATURE_MODIFIER
    county.temperatureBiomeModifier = biomeModifier
    county.temperature = composeTemperature(
      base,
      county.temperatureGlobalModifier,
      county.temperatureBiomeModifier,
    )
    county.climateId = climateFromTemperature(county.temperature)
  })

  world.seaZones.forEach((seaZone) => {
    const base = temperatureFromY(
      seaZone.centroid.y,
      height,
      latitudeTemperatureGamma,
    )
    const layer = layerBySeaZoneId.get(seaZone.id) ?? 1
    const biomeModifier = -(layer * SEA_ZONE_LAYER_TEMPERATURE_STEP)
    seaZone.biomeId = OCEAN_BIOME_ID
    seaZone.temperatureBase = base
    seaZone.temperatureGlobalModifier = GLOBAL_TEMPERATURE_MODIFIER
    seaZone.temperatureBiomeModifier = biomeModifier
    seaZone.temperature = composeTemperature(
      base,
      seaZone.temperatureGlobalModifier,
      seaZone.temperatureBiomeModifier,
    )
    seaZone.climateId = climateFromTemperature(seaZone.temperature)

    if (seaZone.temperature < FREEZING_OCEAN_THRESHOLD) {
      seaZone.biomeId = FREEZING_OCEAN_BIOME_ID
    }
  })
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
  const seaZoneMergeDiagnostics = mergeCoastalSeaZonesPhase(
    { seaZones, seaZoneIdByCellId, cellIdBySeaZoneId },
    random,
  )

  const landMasses = toLandMassRecords(
    landMassShapes,
    countyResult.countyIdsByLandMass,
  )
  const elevationStatsByLandMassId = assignRegionElevations({
    seed,
    counties: countyResult.counties,
    seaZones,
    landMasses,
    config: {
      elevationInlandPower: config.elevationInlandPower,
      elevationRangeDensity: config.elevationRangeDensity,
      elevationPeakDensity: config.elevationPeakDensity,
      elevationRangeStrength: config.elevationRangeStrength,
      elevationPeakStrength: config.elevationPeakStrength,
      elevationNoiseStrength: config.elevationNoiseStrength,
      elevationCoastalReliefChance: config.elevationCoastalReliefChance,
    },
  })

  const rivers = generateRivers(
    countyResult.counties,
    seaZones,
    landMasses,
    {
      riverDensityFactor: config.riverDensityFactor,
      riverMinSourceElevation: config.riverMinSourceElevation,
      riverMinLength: config.riverMinLength,
      riverSegmentWidth: config.riverSegmentWidth,
      riverCurveAmplitude: config.riverCurveAmplitude,
      riverWidthJitter: config.riverWidthJitter,
      riverDownstreamWidthGain: config.riverDownstreamWidthGain,
      riverWidthMinFactor: config.riverWidthMinFactor,
      riverWidthMaxFactor: config.riverWidthMaxFactor,
    },
    random,
  )

  const moistureWindDirection = pickGlobalWindDirection(seed)

  assignRegionTemperatures({
    metadata: { height: config.height },
    config: {
      latitudeTemperatureGamma: config.latitudeTemperatureGamma,
      riverCountyTemperatureCooling: config.riverCountyTemperatureCooling,
    },
    counties: countyResult.counties,
    seaZones,
    rivers,
  })

  assignRegionMoisture({
    seed,
    windDirection: moistureWindDirection,
    counties: countyResult.counties,
    seaZones,
    rivers,
    config: {
      moistureBaseLevel: config.moistureBaseLevel,
      moistureMaxWaterDistanceSteps: config.moistureMaxWaterDistanceSteps,
      moistureWaterWeight: config.moistureWaterWeight,
      moistureWindOceanBoostWeight: config.moistureWindOceanBoostWeight,
      moistureWindLandPenaltyPerStep: config.moistureWindLandPenaltyPerStep,
      moistureWindMaxTraceSteps: config.moistureWindMaxTraceSteps,
      moistureMountainThreshold: config.moistureMountainThreshold,
      moistureWindwardWeight: config.moistureWindwardWeight,
      moistureLeewardWeight: config.moistureLeewardWeight,
      moistureMountainDistanceDecay: config.moistureMountainDistanceDecay,
      moistureEvaporationBase: config.moistureEvaporationBase,
      moistureEvaporationHeatStart: config.moistureEvaporationHeatStart,
      moistureEvaporationHeatFactor: config.moistureEvaporationHeatFactor,
      moistureNoiseStrength: config.moistureNoiseStrength,
    },
  })

  assignCountyBiomes(countyResult.counties)

  landMasses.forEach((landMass) => {
    const stats = elevationStatsByLandMassId.get(landMass.id)
    if (!stats) {
      return
    }

    landMass.elevationMin = stats.min
    landMass.elevationMean = stats.mean
    landMass.elevationMax = stats.max
  })

  return {
    metadata: {
      seed,
      width: config.width,
      height: config.height,
      countyDensity: config.countyDensity,
      seaZoneTarget: config.seaZoneTarget,
      coastMergeValidationFailures:
        seaZoneMergeDiagnostics.disconnectedMergeRejects +
        seaZoneMergeDiagnostics.areaCoverageRejects,
      generatedAt: new Date().toISOString(),
    },
    counties: countyResult.counties,
    seaZones,
    landMasses,
    rivers,
  }
}
