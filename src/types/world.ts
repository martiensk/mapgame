export type RegionId = string

export interface Point {
  x: number
  y: number
}

export type Polygon = Point[]

export interface WorldMetadata {
  seed: string
  width: number
  height: number
  countyDensity: number
  seaZoneTarget: number
  coastMergeValidationFailures: number
  generatedAt: string
}

export interface County {
  id: RegionId
  name: string
  polygon: Polygon
  centroid: Point
  area: number
  neighbors: RegionId[]
  landMassId: RegionId
  biomeId: string
  climateId: string
  temperatureBase: number
  temperatureGlobalModifier: number
  temperatureBiomeModifier: number
  temperature: number
  elevation: number
  moistureBase: number
  moistureWaterInfluence: number
  moistureWindModifier: number
  moistureOrographicModifier: number
  moistureEvaporationPenalty: number
  moisture: number
}

export interface SeaZone {
  id: RegionId
  polygon: Polygon
  centroid: Point
  area: number
  neighbors: RegionId[]
  coastalCountyIds: RegionId[]
  biomeId: string
  climateId: string
  temperatureBase: number
  temperatureGlobalModifier: number
  temperatureBiomeModifier: number
  temperature: number
  elevation: number
  moisture: number
}

export interface RiverSegment {
  id: RegionId
  riverId: string
  polygon: Polygon
  centroid: Point
  area: number
  countyNeighborIds: RegionId[]
  flowIndex: number
  isMouth: boolean
}

export interface River {
  id: string
  landMassId: RegionId
  countyPath: RegionId[]
  terminalNextCountyId?: RegionId
  centerline: Point[]
  centerlineWidths: number[]
  segments: RiverSegment[]
}

export interface LandMass {
  id: RegionId
  type: 'continent' | 'island'
  area: number
  countyIds: RegionId[]
  elevationMin: number
  elevationMax: number
  elevationMean: number
}

export interface WorldData {
  metadata: WorldMetadata
  counties: County[]
  seaZones: SeaZone[]
  landMasses: LandMass[]
  rivers: River[]
}

export interface WorldConfig {
  width: number
  height: number
  countyDensity: number
  countyMergeReduction: number
  voronoiPoissonSpacingFactor: number
  voronoiLloydRelaxations: number
  voronoiSiteMicroJitter: number
  seaZoneTarget: number
  minContinents: number
  maxContinents: number
  minIslands: number
  maxIslands: number
  minCountyCount: number
  voronoiCellTarget: number
  edgeOceanMargin: number
  edgeOceanPenaltyStrength: number
  edgeSoftMargin: number
  latitudeTemperatureGamma: number
  elevationInlandPower: number
  elevationRangeDensity: number
  elevationPeakDensity: number
  elevationRangeStrength: number
  elevationPeakStrength: number
  elevationNoiseStrength: number
  elevationCoastalReliefChance: number
  riverDensityFactor: number
  riverMinSourceElevation: number
  riverMinLength: number
  riverSegmentWidth: number
  riverCurveAmplitude: number
  riverWidthJitter: number
  riverDownstreamWidthGain: number
  riverWidthMinFactor: number
  riverWidthMaxFactor: number
  riverCountyTemperatureCooling: number
  moistureBaseLevel: number
  moistureMaxWaterDistanceSteps: number
  moistureWaterWeight: number
  moistureWindOceanBoostWeight: number
  moistureWindLandPenaltyPerStep: number
  moistureWindMaxTraceSteps: number
  moistureMountainThreshold: number
  moistureWindwardWeight: number
  moistureLeewardWeight: number
  moistureMountainDistanceDecay: number
  moistureEvaporationBase: number
  moistureEvaporationHeatStart: number
  moistureEvaporationHeatFactor: number
  moistureNoiseStrength: number
}
