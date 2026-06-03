import type { RegionId } from '../types/world'

// Valid biomeIds (from src/data/biomes.json):
// polar-desert, tundra, frozen-wetland, glacier, taiga, boreal-wetland,
// steppe, grassland, woodland, forest, wetland, desert, savanna, jungle,
// mangrove, plains, ocean, freezing ocean

export type SpriteRegionKind = 'county' | 'sea-zone'

export interface SpriteFamilyRule {
  id: string
  folder: string
  regionKinds: SpriteRegionKind[]
  baseSize: number
  densityPer100kArea: number
  maxPerRegion: number
  minElevation?: number
  maxElevation?: number
  biomeIds?: string[]
  coastalOnly?: boolean
  seaZoneLayerMin?: number
  seaZoneLayerMax?: number
  rotationJitterDegrees?: number
  scaleJitter?: number
  blockedRegionIds?: RegionId[]
}

export interface SpriteZoomConfig {
  minZoom: number
  maxZoom: number
  minVisibleFraction: number
  maxVisibleFraction: number
  zoomOutSizeMultiplier: number
}

export interface SpriteSystemConfig {
  enabled: boolean
  families: SpriteFamilyRule[]
}

export const SPRITE_SYSTEM_CONFIG: SpriteSystemConfig = {
  enabled: true,
  families: [
    {
      id: 'mountains',
      folder: 'mountains',
      regionKinds: ['county'],
      baseSize: 44,
      densityPer100kArea: 25,
      maxPerRegion: 100,
      minElevation: 0.55,
      biomeIds: [
        'polar-desert',
        'tundra',
        'frozen-wetland',
        'glacier',
        'taiga',
        'boreal-wetland',
        'steppe',
        'grassland',
        'woodland',
        'forest',
        'wetland',
        'desert',
        'savanna',
        'jungle',
        'mangrove',
        'plains',
      ],
      rotationJitterDegrees: 7,
      scaleJitter: 0.2,
    },
    {
      id: 'trees',
      folder: 'trees',
      regionKinds: ['county'],
      baseSize: 24,
      densityPer100kArea: 80,
      maxPerRegion: 200,
      maxElevation: 0.72,
      biomeIds: ['taiga', 'woodland', 'forest', 'savanna', 'jungle', 'mangrove', 'plains'],
      rotationJitterDegrees: 14,
      scaleJitter: 0.25,
    },
  ],
}
