import { describe, expect, it } from 'vitest'
import type { SpriteSystemConfig } from '../config/spriteConfig'
import type { WorldData } from '../types/world'
import { buildPlannedZoneSprites } from './spritePlacement'
import type { SpriteRegistry } from './spriteRegistry'

const baseWorld: WorldData = {
  metadata: {
    seed: 'sprite-seed-1',
    width: 1000,
    height: 1000,
    countyDensity: 0,
    seaZoneTarget: 0,
    coastMergeValidationFailures: 0,
    generatedAt: '2026-06-03T00:00:00Z',
  },
  counties: [
    {
      id: 'c-1',
      name: 'County 1',
      polygon: [
        { x: 100, y: 100 },
        { x: 420, y: 100 },
        { x: 420, y: 420 },
        { x: 100, y: 420 },
      ],
      centroid: { x: 260, y: 260 },
      area: 102400,
      neighbors: [],
      landMassId: 'l-1',
      biomeId: 'Mountain Forest',
      climateId: 'temperate',
      temperatureBase: 0.5,
      temperatureGlobalModifier: 0,
      temperatureBiomeModifier: 0,
      temperature: 0.5,
      elevation: 0.82,
      moistureBase: 0.5,
      moistureWaterInfluence: 0.5,
      moistureWindModifier: 0,
      moistureOrographicModifier: 0,
      moistureEvaporationPenalty: 0,
      moisture: 0.6,
    },
  ],
  seaZones: [
    {
      id: 's-1',
      polygon: [
        { x: 460, y: 120 },
        { x: 900, y: 120 },
        { x: 900, y: 460 },
        { x: 460, y: 460 },
      ],
      centroid: { x: 680, y: 290 },
      area: 149600,
      neighbors: [],
      coastalCountyIds: ['c-1'],
      biomeId: 'open-ocean',
      climateId: 'temperate',
      temperatureBase: 0.5,
      temperatureGlobalModifier: 0,
      temperatureBiomeModifier: 0,
      temperature: 0.45,
      elevation: 0,
      moisture: 1,
    },
  ],
  landMasses: [
    {
      id: 'l-1',
      type: 'continent',
      area: 102400,
      countyIds: ['c-1'],
      elevationMin: 0.82,
      elevationMax: 0.82,
      elevationMean: 0.82,
    },
  ],
  rivers: [],
}

const spriteConfig: SpriteSystemConfig = {
  enabled: true,
  families: [
    {
      id: 'mountains',
      folder: 'mountains',
      regionKinds: ['county'],
      baseSize: 40,
      densityPer100kArea: 2,
      maxPerRegion: 10,
      minElevation: 0.6,
      biomeIds: ['forest'],
    },
  ],
}

const spriteRegistry: SpriteRegistry = {
  byFamilyId: new Map([
    [
      'mountains',
      [
        {
          textureUrl: '/m-1.png',
          scaleMultiplier: 1,
        },
        {
          textureUrl: '/m-2.png',
          scaleMultiplier: 1,
        },
      ],
    ],
  ]),
}

describe('buildPlannedZoneSprites', () => {
  it('is deterministic for same world seed and config', () => {
    const first = buildPlannedZoneSprites(baseWorld, spriteConfig, spriteRegistry)
    const second = buildPlannedZoneSprites(baseWorld, spriteConfig, spriteRegistry)

    expect(first.length).toBeGreaterThan(0)
    expect(first).toEqual(second)
  })

  it('changes output when world seed changes', () => {
    const worldA = baseWorld
    const worldB: WorldData = {
      ...baseWorld,
      metadata: {
        ...baseWorld.metadata,
        seed: 'sprite-seed-2',
      },
    }

    const first = buildPlannedZoneSprites(worldA, spriteConfig, spriteRegistry)
    const second = buildPlannedZoneSprites(worldB, spriteConfig, spriteRegistry)

    expect(second).not.toEqual(first)
  })
})
