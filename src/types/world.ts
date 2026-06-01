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
}
