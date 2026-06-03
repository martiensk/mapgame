import terrainBiomeMapper from '../data/terrainBiomeMapper.json'
import { createSeededRandom } from '../generation/random'
import { computeSeaZoneLayerById } from '../generation/seaZoneLayers'
import type { Point, Polygon, SeaZone, WorldData } from '../types/world'
import type { SpriteFamilyRule, SpriteSystemConfig } from '../config/spriteConfig'
import type { SpriteAssetVariant, SpriteRegistry } from './spriteRegistry'

interface TerrainBiomeMapperDocument {
  terrainBiomes: Record<string, Record<string, string>>
}

const biomeLabelToBaseBiomeId = new Map<string, string>()

Object.values((terrainBiomeMapper as TerrainBiomeMapperDocument).terrainBiomes).forEach(
  (baseBiomeMap) => {
    Object.entries(baseBiomeMap).forEach(([baseBiomeId, terrainBiomeLabel]) => {
      biomeLabelToBaseBiomeId.set(terrainBiomeLabel, baseBiomeId)
    })
  },
)

export interface PlannedZoneSprite {
  id: string
  regionId: string
  regionKind: 'county' | 'sea-zone'
  familyId: string
  textureUrl: string
  position: Point
  baseSize: number
  baseScaleMultiplier: number
  rotationRadians: number
  priority: number
}

function hashUnit(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0) / 4294967295
}

function regionAreaToExpectedCount(area: number, densityPer100kArea: number): number {
  return (Math.max(0, area) / 100000) * Math.max(0, densityPer100kArea)
}

function resolveCount(expectedCount: number, maxPerRegion: number, probabilitySeed: string): number {
  if (expectedCount <= 0 || maxPerRegion <= 0) {
    return 0
  }

  const clampedExpected = Math.min(expectedCount, maxPerRegion)
  const baseCount = Math.floor(clampedExpected)
  const remainder = clampedExpected - baseCount
  const bump = hashUnit(probabilitySeed) < remainder ? 1 : 0

  return Math.min(maxPerRegion, baseCount + bump)
}

function pointInPolygon(point: Point, polygon: Polygon): boolean {
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function polygonBounds(polygon: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  polygon.forEach((point) => {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  })

  return { minX, minY, maxX, maxY }
}

function randomPointInPolygon(
  polygon: Polygon,
  fallback: Point,
  seed: string,
  minDistance: number,
  existing: Point[],
): Point {
  const rng = createSeededRandom(seed)
  const bounds = polygonBounds(polygon)

  for (let attempt = 0; attempt < 56; attempt += 1) {
    const candidate = {
      x: rng.float(bounds.minX, bounds.maxX),
      y: rng.float(bounds.minY, bounds.maxY),
    }

    if (!pointInPolygon(candidate, polygon)) {
      continue
    }

    const tooClose = existing.some((point) => {
      const dx = point.x - candidate.x
      const dy = point.y - candidate.y
      return dx * dx + dy * dy < minDistance * minDistance
    })

    if (tooClose) {
      continue
    }

    return candidate
  }

  return fallback
}

function isFamilyEligibleForSeaZone(
  family: SpriteFamilyRule,
  zone: SeaZone,
  zoneLayer: number,
): boolean {
  if (!family.regionKinds.includes('sea-zone')) {
    return false
  }

  if (family.coastalOnly && zone.coastalCountyIds.length === 0) {
    return false
  }

  if (typeof family.seaZoneLayerMin === 'number' && zoneLayer < family.seaZoneLayerMin) {
    return false
  }

  if (typeof family.seaZoneLayerMax === 'number' && zoneLayer > family.seaZoneLayerMax) {
    return false
  }

  if (family.biomeIds && !family.biomeIds.includes(zone.biomeId)) {
    return false
  }

  return true
}

function isFamilyEligibleForCounty(family: SpriteFamilyRule, countyElevation: number, biomeId: string): boolean {
  if (!family.regionKinds.includes('county')) {
    return false
  }

  if (typeof family.minElevation === 'number' && countyElevation < family.minElevation) {
    return false
  }

  if (typeof family.maxElevation === 'number' && countyElevation > family.maxElevation) {
    return false
  }

  const normalizedBiomeId = biomeLabelToBaseBiomeId.get(biomeId) ?? biomeId
  if (family.biomeIds && !family.biomeIds.includes(normalizedBiomeId)) {
    return false
  }

  return true
}

function pickTextureVariant(textureVariants: SpriteAssetVariant[], seed: string): SpriteAssetVariant | null {
  if (textureVariants.length === 0) {
    return null
  }

  const index = Math.floor(hashUnit(seed) * textureVariants.length)
  return textureVariants[Math.min(textureVariants.length - 1, Math.max(0, index))]
}

function familyCountForRegion(area: number, family: SpriteFamilyRule, seed: string): number {
  const expected = regionAreaToExpectedCount(area, family.densityPer100kArea)
  return resolveCount(expected, family.maxPerRegion, seed)
}

export function buildPlannedZoneSprites(
  world: WorldData,
  config: SpriteSystemConfig,
  registry: SpriteRegistry,
): PlannedZoneSprite[] {
  if (!config.enabled) {
    return []
  }

  const planned: PlannedZoneSprite[] = []
  const seaZoneLayerById = computeSeaZoneLayerById(world.seaZones)

  world.counties.forEach((county) => {
    config.families.forEach((family) => {
      if (family.blockedRegionIds?.includes(county.id)) {
        return
      }

      const textureVariants = registry.byFamilyId.get(family.id) ?? []
      if (textureVariants.length === 0) {
        return
      }

      if (!isFamilyEligibleForCounty(family, county.elevation, county.biomeId)) {
        return
      }

      const spriteCount = familyCountForRegion(
        county.area,
        family,
        `${world.metadata.seed}:${county.id}:${family.id}:count`,
      )

      if (spriteCount <= 0) {
        return
      }

      const existingPoints: Point[] = []
      const minDistance = Math.max(6, family.baseSize * 0.65)

      for (let index = 0; index < spriteCount; index += 1) {
        const seed = `${world.metadata.seed}:${county.id}:${family.id}:${index}`
        const position = randomPointInPolygon(
          county.polygon,
          county.centroid,
          `${seed}:point`,
          minDistance,
          existingPoints,
        )
        existingPoints.push(position)

        const textureVariant = pickTextureVariant(textureVariants, `${seed}:texture`)
        if (!textureVariant) {
          continue
        }

        const jitterStrength = family.scaleJitter ?? 0
        const jitterSign = hashUnit(`${seed}:scaleSign`) > 0.5 ? 1 : -1
        const scaleJitter = 1 + jitterSign * hashUnit(`${seed}:scaleMag`) * jitterStrength
        const rotationJitterDegrees = family.rotationJitterDegrees ?? 0
        const rotationJitterRadians =
          ((hashUnit(`${seed}:rotation`) * 2 - 1) * rotationJitterDegrees * Math.PI) / 180

        planned.push({
          id: `${county.id}:${family.id}:${index}`,
          regionId: county.id,
          regionKind: 'county',
          familyId: family.id,
          textureUrl: textureVariant.textureUrl,
          position,
          baseSize: family.baseSize,
          baseScaleMultiplier: Math.max(0.1, scaleJitter * textureVariant.scaleMultiplier),
          rotationRadians: rotationJitterRadians,
          priority: hashUnit(`${seed}:priority`),
        })
      }
    })
  })

  world.seaZones.forEach((zone) => {
    config.families.forEach((family) => {
      if (family.blockedRegionIds?.includes(zone.id)) {
        return
      }

      const textureVariants = registry.byFamilyId.get(family.id) ?? []
      if (textureVariants.length === 0) {
        return
      }

      const zoneLayer = seaZoneLayerById.get(zone.id) ?? 1
      if (!isFamilyEligibleForSeaZone(family, zone, zoneLayer)) {
        return
      }

      const spriteCount = familyCountForRegion(
        zone.area,
        family,
        `${world.metadata.seed}:${zone.id}:${family.id}:count`,
      )

      if (spriteCount <= 0) {
        return
      }

      const existingPoints: Point[] = []
      const minDistance = Math.max(6, family.baseSize * 0.65)

      for (let index = 0; index < spriteCount; index += 1) {
        const seed = `${world.metadata.seed}:${zone.id}:${family.id}:${index}`
        const position = randomPointInPolygon(
          zone.polygon,
          zone.centroid,
          `${seed}:point`,
          minDistance,
          existingPoints,
        )
        existingPoints.push(position)

        const textureVariant = pickTextureVariant(textureVariants, `${seed}:texture`)
        if (!textureVariant) {
          continue
        }

        const jitterStrength = family.scaleJitter ?? 0
        const jitterSign = hashUnit(`${seed}:scaleSign`) > 0.5 ? 1 : -1
        const scaleJitter = 1 + jitterSign * hashUnit(`${seed}:scaleMag`) * jitterStrength
        const rotationJitterDegrees = family.rotationJitterDegrees ?? 0
        const rotationJitterRadians =
          ((hashUnit(`${seed}:rotation`) * 2 - 1) * rotationJitterDegrees * Math.PI) / 180

        planned.push({
          id: `${zone.id}:${family.id}:${index}`,
          regionId: zone.id,
          regionKind: 'sea-zone',
          familyId: family.id,
          textureUrl: textureVariant.textureUrl,
          position,
          baseSize: family.baseSize,
          baseScaleMultiplier: Math.max(0.1, scaleJitter * textureVariant.scaleMultiplier),
          rotationRadians: rotationJitterRadians,
          priority: hashUnit(`${seed}:priority`),
        })
      }
    })
  })

  return planned
}
