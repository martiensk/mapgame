import { describe, expect, it } from 'vitest'
import { WORLD_SCALE_CONFIGS } from '../config/worldScaleConfig'
import { createSeededRandom } from './random'
import { generateVoronoiWorld } from './voronoi'

function hasWorldEdgeVertex(
  polygon: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): boolean {
  const epsilon = Math.max(width, height) * 1e-6
  return polygon.some(
    (point) =>
      point.x <= epsilon ||
      point.x >= width - epsilon ||
      point.y <= epsilon ||
      point.y >= height - epsilon,
  )
}

function axisAlignedEdgeRatio(
  polygons: Array<Array<{ x: number; y: number }>>,
  width: number,
  height: number,
): number {
  let axisAlignedEdges = 0
  let totalEdges = 0

  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
    const polygon = polygons[polygonIndex]
    if (polygon.length < 3 || hasWorldEdgeVertex(polygon, width, height)) {
      continue
    }

    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index]
      const next = polygon[(index + 1) % polygon.length]
      const dx = Math.abs(next.x - current.x)
      const dy = Math.abs(next.y - current.y)
      const dominant = Math.max(dx, dy)

      if (dominant < 1e-9) {
        continue
      }

      const orthogonalRatio = Math.min(dx, dy) / dominant
      if (orthogonalRatio < 0.2) {
        axisAlignedEdges += 1
      }
      totalEdges += 1
    }
  }

  if (totalEdges === 0) {
    return 1
  }

  return axisAlignedEdges / totalEdges
}

describe('generateVoronoiWorld', () => {
  it('is deterministic for same seed and config', () => {
    const config = WORLD_SCALE_CONFIGS.small

    const first = generateVoronoiWorld(config, createSeededRandom('voronoi-determinism'))
    const second = generateVoronoiWorld(config, createSeededRandom('voronoi-determinism'))

    const firstSignature = JSON.stringify(
      first.cells.slice(0, 120).map((cell) => [
        cell.id,
        Number(cell.centroid.x.toFixed(2)),
        Number(cell.centroid.y.toFixed(2)),
      ]),
    )
    const secondSignature = JSON.stringify(
      second.cells.slice(0, 120).map((cell) => [
        cell.id,
        Number(cell.centroid.x.toFixed(2)),
        Number(cell.centroid.y.toFixed(2)),
      ]),
    )

    expect(first.cells.length).toBe(second.cells.length)
    expect(firstSignature).toBe(secondSignature)
  })

  it('keeps interior edges from becoming predominantly axis-aligned', () => {
    const config = WORLD_SCALE_CONFIGS.medium
    const world = generateVoronoiWorld(config, createSeededRandom('voronoi-shape-quality'))

    const ratio = axisAlignedEdgeRatio(
      world.cells.map((cell) => cell.polygon),
      config.width,
      config.height,
    )

    expect(ratio).toBeLessThan(0.4)
  })
})
