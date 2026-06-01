import { describe, expect, it } from 'vitest'
import type { SeaZone } from '../types/world'
import { createSeededRandom } from './random'
import {
  mergeCoastalSeaZonesPhase,
  type SeaZoneGenerationResult,
} from './seazones'

function buildSeaZone(id: string, polygon: SeaZone['polygon'], neighbors: string[]): SeaZone {
  const centroid = {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  }

  return {
    id,
    polygon,
    centroid,
    area: 100,
    neighbors,
    coastalCountyIds: ['county-1'],
    biomeId: 'ocean',
    climateId: 'temperate',
    temperatureBase: 0,
    temperatureGlobalModifier: 0,
    temperatureBiomeModifier: 0,
    temperature: 0,
    elevation: 0,
  }
}

describe('mergeCoastalSeaZonesPhase', () => {
  it('merges neighboring sea-zones in a minimal coastal case', () => {
    const zoneA = buildSeaZone(
      'sea-zone-1',
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      ['sea-zone-2'],
    )
    const zoneB = buildSeaZone(
      'sea-zone-2',
      [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
      ],
      ['sea-zone-1'],
    )

    const result: SeaZoneGenerationResult = {
      seaZones: [zoneA, zoneB],
      seaZoneIdByCellId: new Map([
        ['cell-1', 'sea-zone-1'],
        ['cell-2', 'sea-zone-2'],
      ]),
      cellIdBySeaZoneId: new Map([
        ['sea-zone-1', 'cell-1'],
        ['sea-zone-2', 'cell-2'],
      ]),
    }

    const diagnostics = mergeCoastalSeaZonesPhase(
      result,
      createSeededRandom('sea-zone-merge-test'),
    )

    expect(result.seaZones.length).toBe(1)
    expect(diagnostics.mergeAttempts).toBeGreaterThan(0)
    expect(result.seaZones[0].id).toBe('sea-zone-1')
    expect(result.seaZoneIdByCellId.get('cell-2')).toBe('sea-zone-1')
    expect(result.cellIdBySeaZoneId.has('sea-zone-2')).toBe(false)
  })

  it('caps merged sea-zone membership to four source zones', () => {
    const seaZones: SeaZone[] = []
    const seaZoneIdByCellId = new Map<string, string>()
    const cellIdBySeaZoneId = new Map<string, string>()

    for (let index = 0; index < 10; index += 1) {
      const left = index * 10
      const right = left + 10
      const id = `sea-zone-${index + 1}`
      const neighbors: string[] = []

      if (index > 0) {
        neighbors.push(`sea-zone-${index}`)
      }
      if (index < 9) {
        neighbors.push(`sea-zone-${index + 2}`)
      }

      const zone = buildSeaZone(
        id,
        [
          { x: left, y: 0 },
          { x: right, y: 0 },
          { x: right, y: 10 },
          { x: left, y: 10 },
        ],
        neighbors,
      )

      seaZones.push(zone)
      const cellId = `cell-${index + 1}`
      seaZoneIdByCellId.set(cellId, id)
      cellIdBySeaZoneId.set(id, cellId)
    }

    const result: SeaZoneGenerationResult = {
      seaZones,
      seaZoneIdByCellId,
      cellIdBySeaZoneId,
    }

    const diagnostics = mergeCoastalSeaZonesPhase(
      result,
      createSeededRandom('sea-zone-cap-test'),
    )

    const survivorCellCounts = new Map<string, number>()
    result.seaZoneIdByCellId.forEach((survivorId) => {
      survivorCellCounts.set(
        survivorId,
        (survivorCellCounts.get(survivorId) ?? 0) + 1,
      )
    })

    const maxMergedMemberCount = [...survivorCellCounts.values()].reduce(
      (max, count) => Math.max(max, count),
      0,
    )

    expect(diagnostics.mergeAttempts).toBeGreaterThan(0)
    expect(maxMergedMemberCount).toBeLessThanOrEqual(4)
  })
})
