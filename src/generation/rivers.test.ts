import { describe, expect, it } from 'vitest'
import { DEFAULT_WORLD_CONFIG, generateWorld } from './world'
import {
  buildCoastalCountySet,
  buildFlowMap,
  generateRivers,
  traceRiverPath,
} from './rivers'
import { createSeededRandom } from './random'
import type { Point } from '../types/world'

const RIVER_CONFIG = {
  riverDensityFactor: DEFAULT_WORLD_CONFIG.riverDensityFactor,
  riverMinSourceElevation: DEFAULT_WORLD_CONFIG.riverMinSourceElevation,
  riverMinLength: DEFAULT_WORLD_CONFIG.riverMinLength,
  riverSegmentWidth: DEFAULT_WORLD_CONFIG.riverSegmentWidth,
  riverCurveAmplitude: DEFAULT_WORLD_CONFIG.riverCurveAmplitude,
  riverWidthJitter: DEFAULT_WORLD_CONFIG.riverWidthJitter,
  riverDownstreamWidthGain: DEFAULT_WORLD_CONFIG.riverDownstreamWidthGain,
  riverWidthMinFactor: DEFAULT_WORLD_CONFIG.riverWidthMinFactor,
  riverWidthMaxFactor: DEFAULT_WORLD_CONFIG.riverWidthMaxFactor,
}

describe('rivers determinism', () => {
  it('produces identical rivers for the same seed', () => {
    const worldA = generateWorld('river-det-01', DEFAULT_WORLD_CONFIG)
    const worldB = generateWorld('river-det-01', DEFAULT_WORLD_CONFIG)

    expect(worldA.rivers.length).toBe(worldB.rivers.length)
    worldA.rivers.forEach((riverA, index) => {
      const riverB = worldB.rivers[index]
      expect(riverA.id).toBe(riverB.id)
      expect(riverA.countyPath).toEqual(riverB.countyPath)
      expect(riverA.segments.length).toBe(riverB.segments.length)
      riverA.segments.forEach((segmentA, segmentIndex) => {
        const segmentB = riverB.segments[segmentIndex]
        expect(segmentA.id).toBe(segmentB.id)
        expect(segmentA.countyNeighborIds).toEqual(segmentB.countyNeighborIds)
        expect(segmentA.flowIndex).toBe(segmentB.flowIndex)
        expect(segmentA.isMouth).toBe(segmentB.isMouth)
        expect(segmentA.area).toBeCloseTo(segmentB.area, 5)
        expect(segmentA.centroid.x).toBeCloseTo(segmentB.centroid.x, 5)
        expect(segmentA.centroid.y).toBeCloseTo(segmentB.centroid.y, 5)
        expect(segmentA.polygon).toHaveLength(segmentB.polygon.length)
        segmentA.polygon.forEach((pointA, pointIndex) => {
          expect(pointA.x).toBeCloseTo(segmentB.polygon[pointIndex].x, 5)
          expect(pointA.y).toBeCloseTo(segmentB.polygon[pointIndex].y, 5)
        })
      })
    })
  })

  it('produces different rivers for different seeds', () => {
    const worldA = generateWorld('river-seed-A', DEFAULT_WORLD_CONFIG)
    const worldB = generateWorld('river-seed-B', DEFAULT_WORLD_CONFIG)

    const pathsA = worldA.rivers.map((r) => r.countyPath.join(','))
    const pathsB = worldB.rivers.map((r) => r.countyPath.join(','))
    expect(pathsA).not.toEqual(pathsB)
  })
})

describe('rivers flow direction', () => {
  it('every step in a river path is non-increasing elevation (or the destination is coastal)', () => {
    const world = generateWorld('river-flow-01', DEFAULT_WORLD_CONFIG)
    const countiesById = new Map(world.counties.map((c) => [c.id, c]))
    const coastalSet = buildCoastalCountySet(world.seaZones)

    for (const river of world.rivers) {
      for (let index = 0; index < river.countyPath.length - 1; index += 1) {
        const current = countiesById.get(river.countyPath[index])
        const next = countiesById.get(river.countyPath[index + 1])
        expect(current).toBeDefined()
        expect(next).toBeDefined()

        if (!current || !next) {
          continue
        }

        const nextIsCoastal = coastalSet.has(next.id)
        // Either elevation drops/stays, or the next county is the coastal terminus
        expect(next.elevation <= current.elevation || nextIsCoastal).toBe(true)
      }
    }
  })
})

describe('rivers minimum length', () => {
  it('all rivers meet the minimum county path length', () => {
    const world = generateWorld('river-len-01', DEFAULT_WORLD_CONFIG)
    for (const river of world.rivers) {
      expect(river.countyPath.length).toBeGreaterThanOrEqual(DEFAULT_WORLD_CONFIG.riverMinLength)
    }
  })
})

describe('rivers source elevation', () => {
  it('all river sources meet the minimum elevation threshold', () => {
    const world = generateWorld('river-elev-01', DEFAULT_WORLD_CONFIG)
    const countiesById = new Map(world.counties.map((c) => [c.id, c]))

    for (const river of world.rivers) {
      const source = countiesById.get(river.countyPath[0])
      expect(source).toBeDefined()
      if (source) {
        expect(source.elevation).toBeGreaterThanOrEqual(DEFAULT_WORLD_CONFIG.riverMinSourceElevation)
      }
    }
  })
})

describe('rivers no cycles', () => {
  it('no county appears twice in a single river path', () => {
    const world = generateWorld('river-cycle-01', DEFAULT_WORLD_CONFIG)

    for (const river of world.rivers) {
      const seen = new Set<string>()
      for (const countyId of river.countyPath) {
        expect(seen.has(countyId)).toBe(false)
        seen.add(countyId)
      }
    }
  })

  it('does not reuse the same directed county edge across different rivers', () => {
    const world = generateWorld('river-overlap-01', DEFAULT_WORLD_CONFIG)
    const usedDirectedEdges = new Set<string>()

    for (const river of world.rivers) {
      for (let index = 0; index < river.countyPath.length - 1; index += 1) {
        const edgeKey = `${river.countyPath[index]}->${river.countyPath[index + 1]}`
        expect(usedDirectedEdges.has(edgeKey)).toBe(false)
        usedDirectedEdges.add(edgeKey)
      }
    }
  })
})

describe('rivers valid segments', () => {
  it('all rivers have valid polygon segments with monotonic flow indexes', () => {
    const world = generateWorld('river-segments-01', DEFAULT_WORLD_CONFIG)
    for (const river of world.rivers) {
      expect(river.segments.length).toBeGreaterThanOrEqual(river.countyPath.length)

      river.segments.forEach((segment, index) => {
        expect(segment.riverId).toBe(river.id)
        expect(segment.id.length).toBeGreaterThan(0)
        expect(segment.polygon.length).toBeGreaterThanOrEqual(4)
        expect(segment.area).toBeGreaterThan(0)
        expect(Number.isFinite(segment.centroid.x)).toBe(true)
        expect(Number.isFinite(segment.centroid.y)).toBe(true)
        expect(segment.flowIndex).toBe(index)

        if (segment.isMouth) {
          expect(segment.countyNeighborIds).toHaveLength(1)
        } else {
          expect(segment.countyNeighborIds).toHaveLength(2)
        }
      })

      const mouthSegments = river.segments.filter((segment) => segment.isMouth)
      expect(mouthSegments).toHaveLength(1)
      expect(mouthSegments[0].flowIndex).toBe(river.segments.length - 1)
    }
  })

  it('adjacent river segments share a joined boundary at their connection point', () => {
    const world = generateWorld('river-connectivity-01', DEFAULT_WORLD_CONFIG)

    const pointsAlmostEqual = (a: Point, b: Point, epsilon = 1e-3): boolean => (
      Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
    )

    for (const river of world.rivers) {
      for (let index = 0; index < river.segments.length - 1; index += 1) {
        const current = river.segments[index]
        const next = river.segments[index + 1]
        const sharedVertices = current.polygon.filter((currentPoint) =>
          next.polygon.some((nextPoint) => pointsAlmostEqual(currentPoint, nextPoint)),
        )

        expect(sharedVertices.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('generates at least some curved segment polygons when curvature is enabled', () => {
    const world = generateWorld('river-curves-01', DEFAULT_WORLD_CONFIG)
    const curvedSegmentCount = world.rivers
      .flatMap((river) => river.segments)
      .filter((segment) => segment.polygon.length > 4)
      .length

    expect(curvedSegmentCount).toBeGreaterThan(0)
  })

  it('keeps width variation deterministic for a fixed seed', () => {
    const worldA = generateWorld('river-width-det-01', DEFAULT_WORLD_CONFIG)
    const worldB = generateWorld('river-width-det-01', DEFAULT_WORLD_CONFIG)

    const extractStartWidth = (polygon: Point[]): number => {
      if (polygon.length < 4) {
        return 0
      }

      const startA = polygon[0]
      const startB = polygon[polygon.length - 1]
      return Math.hypot(startA.x - startB.x, startA.y - startB.y)
    }

    worldA.rivers.forEach((riverA, riverIndex) => {
      const riverB = worldB.rivers[riverIndex]
      expect(riverA.segments.length).toBe(riverB.segments.length)

      riverA.segments.forEach((segmentA, segmentIndex) => {
        const segmentB = riverB.segments[segmentIndex]
        const widthA = extractStartWidth(segmentA.polygon)
        const widthB = extractStartWidth(segmentB.polygon)
        expect(widthA).toBeCloseTo(widthB, 5)
      })
    })
  })
})

describe('buildFlowMap', () => {
  it('returns null for coastal counties', () => {
    const world = generateWorld('flow-map-01', DEFAULT_WORLD_CONFIG)
    const countiesById = new Map(world.counties.map((c) => [c.id, c]))
    const coastalSet = buildCoastalCountySet(world.seaZones)
    const flowMap = buildFlowMap(world.counties, countiesById, coastalSet)

    for (const countyId of coastalSet) {
      expect(flowMap.get(countyId)).toBeNull()
    }
  })

  it('flow target has lower or equal elevation than source', () => {
    const world = generateWorld('flow-map-02', DEFAULT_WORLD_CONFIG)
    const countiesById = new Map(world.counties.map((c) => [c.id, c]))
    const coastalSet = buildCoastalCountySet(world.seaZones)
    const flowMap = buildFlowMap(world.counties, countiesById, coastalSet)

    for (const county of world.counties) {
      if (coastalSet.has(county.id)) {
        continue
      }

      const nextId = flowMap.get(county.id)
      if (nextId === null || nextId === undefined) {
        continue
      }

      const next = countiesById.get(nextId)
      if (!next) {
        continue
      }

      expect(next.elevation).toBeLessThanOrEqual(county.elevation)
    }
  })
})

describe('traceRiverPath', () => {
  it('terminates without infinite loop', () => {
    const world = generateWorld('trace-01', DEFAULT_WORLD_CONFIG)
    const countiesById = new Map(world.counties.map((c) => [c.id, c]))
    const coastalSet = buildCoastalCountySet(world.seaZones)
    const flowMap = buildFlowMap(world.counties, countiesById, coastalSet)

    // Trace from every county — none should hang
    for (const county of world.counties) {
      const path = traceRiverPath(county.id, flowMap, coastalSet)
      expect(path.length).toBeGreaterThan(0)
      expect(path[0]).toBe(county.id)
    }
  })
})

describe('generateRivers with custom config', () => {
  it('returns empty array when density is 0', () => {
    const world = generateWorld('river-density-zero', DEFAULT_WORLD_CONFIG)
    const rng = createSeededRandom('river-density-zero')
    const rivers = generateRivers(world.counties, world.seaZones, world.landMasses, {
      ...RIVER_CONFIG,
      riverDensityFactor: 0,
    }, rng)
    expect(rivers).toHaveLength(0)
  })
})
