import type { WorldConfig } from '../types/world'

export type MapSize = 'small' | 'medium' | 'large' | 'huge'

export interface WorldScaleConfig extends WorldConfig {
  label: string
}

export const WORLD_SCALE_CONFIGS: Record<MapSize, WorldScaleConfig> = {
  small: {
    label: 'Small',
    width: 8800,
    height: 5200,
    countyDensity: 0.0003,
    countyMergeReduction: 0.4,
    seaZoneTarget: 110,
    minContinents: 1,
    maxContinents: 2,
    minIslands: 2,
    maxIslands: 4,
    minCountyCount: 360,
    voronoiCellTarget: 2800,
    edgeOceanMargin: 0.08,
    edgeOceanPenaltyStrength: 0.18,
    edgeSoftMargin: 0.06,
  },
  medium: {
    label: 'Medium',
    width: 12800,
    height: 7600,
    countyDensity: 0.0003,
    countyMergeReduction: 0.4,
    seaZoneTarget: 160,
    minContinents: 2,
    maxContinents: 4,
    minIslands: 4,
    maxIslands: 8,
    minCountyCount: 700,
    voronoiCellTarget: 5600,
    edgeOceanMargin: 0.1,
    edgeOceanPenaltyStrength: 0.21,
    edgeSoftMargin: 0.07,
  },
  large: {
    label: 'Large',
    width: 18400,
    height: 10800,
    countyDensity: 0.0003,
    countyMergeReduction: 0.4,
    seaZoneTarget: 240,
    minContinents: 3,
    maxContinents: 5,
    minIslands: 6,
    maxIslands: 12,
    minCountyCount: 1400,
    voronoiCellTarget: 11200,
    edgeOceanMargin: 0.12,
    edgeOceanPenaltyStrength: 0.24,
    edgeSoftMargin: 0.08,
  },
  huge: {
    label: 'Huge',
    width: 26400,
    height: 15600,
    countyDensity: 0.0003,
    countyMergeReduction: 0.4,
    seaZoneTarget: 360,
    minContinents: 4,
    maxContinents: 7,
    minIslands: 8,
    maxIslands: 16,
    minCountyCount: 2800,
    voronoiCellTarget: 22400,
    edgeOceanMargin: 0.14,
    edgeOceanPenaltyStrength: 0.27,
    edgeSoftMargin: 0.09,
  },
}

export const DEFAULT_MAP_SIZE: MapSize = 'medium'

export const MAP_SIZE_ORDER: MapSize[] = ['small', 'medium', 'large', 'huge']
