import { Delaunay } from 'd3-delaunay'
import { polygonArea, polygonCentroid } from '../geometry/polygon'
import type { Polygon, WorldConfig } from '../types/world'
import type { SeededRandom } from './random'

export interface VoronoiCell {
  id: string
  polygon: Polygon
  centroid: { x: number; y: number }
  area: number
}

export interface VoronoiWorld {
  cells: VoronoiCell[]
  neighborCellIdsById: Map<string, string[]>
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function jitterNoiseHash(x: number, y: number, seed: number): number {
  let h = ((seed ^ (x * 374761393)) ^ (y * 668265263)) >>> 0
  h = (Math.imul(h ^ (h >>> 13), 1274126177)) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function jitterNoise(nx: number, ny: number, seed: number): number {
  const freq = 3.5
  const fx = nx * freq
  const fy = ny * freq
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const ux = tx * tx * (3 - 2 * tx)
  const uy = ty * ty * (3 - 2 * ty)
  const a = jitterNoiseHash(ix, iy, seed)
  const b = jitterNoiseHash(ix + 1, iy, seed)
  const c = jitterNoiseHash(ix, iy + 1, seed)
  const d = jitterNoiseHash(ix + 1, iy + 1, seed)
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy
}

function toPolygon(points: Array<[number, number]>): Polygon {
  if (points.length === 0) {
    return []
  }

  const normalized = points.map(([x, y]) => ({ x, y }))
  const first = normalized[0]
  const last = normalized[normalized.length - 1]

  if (first.x === last.x && first.y === last.y) {
    normalized.pop()
  }

  return normalized
}

export function generateVoronoiWorld(
  config: WorldConfig,
  random: SeededRandom,
): VoronoiWorld {
  const targetCells = Math.max(
    100,
    Math.floor(config.voronoiCellTarget),
    config.minCountyCount + config.seaZoneTarget,
  )

  const aspectRatio = config.width / config.height
  const columns = Math.max(2, Math.ceil(Math.sqrt(targetCells * aspectRatio)))
  const rows = Math.max(2, Math.ceil(targetCells / columns))
  const spacingX = config.width / columns
  const spacingY = config.height / rows
  const baseSpacing = Math.min(spacingX, spacingY)
  const jitterMin = 0.08
  const jitterMax = 0.65
  const jitterNoiseSeed = Math.floor(random.next() * 0xffffffff)

  const points: Array<[number, number]> = []
  for (let row = 0; row < rows && points.length < targetCells; row += 1) {
    const yBase = (row + 0.5) * (config.height / rows)

    for (let column = 0; column < columns && points.length < targetCells; column += 1) {
      const xBase =
        (column + 0.5 + (row % 2 === 0 ? 0 : 0.5 / columns)) *
        (config.width / columns)

      const noiseVal = jitterNoise(column / columns, row / rows, jitterNoiseSeed)
      const jitter = baseSpacing * (jitterMin + (jitterMax - jitterMin) * noiseVal)

      const x = clamp(xBase + random.float(-jitter, jitter), 0, config.width)
      const y = clamp(yBase + random.float(-jitter, jitter), 0, config.height)
      points.push([x, y])
    }
  }

  const delaunay = Delaunay.from(points)
  const voronoi = delaunay.voronoi([0, 0, config.width, config.height])

  const cells: VoronoiCell[] = []
  const cellIdByIndex: string[] = []

  for (let index = 0; index < points.length; index += 1) {
    const polygonPoints = voronoi.cellPolygon(index)
    if (!polygonPoints) {
      continue
    }

    const polygon = toPolygon(polygonPoints as Array<[number, number]>)
    if (polygon.length < 3) {
      continue
    }

    const id = `cell-${index + 1}`
    cellIdByIndex[index] = id

    cells.push({
      id,
      polygon,
      centroid: polygonCentroid(polygon),
      area: polygonArea(polygon),
    })
  }

  const neighborCellIdsById = new Map<string, string[]>()

  for (let index = 0; index < points.length; index += 1) {
    const sourceId = cellIdByIndex[index]
    if (!sourceId) {
      continue
    }

    const neighbors = [...delaunay.neighbors(index)]
      .map((neighborIndex) => cellIdByIndex[neighborIndex])
      .filter((neighborId): neighborId is string => Boolean(neighborId))

    neighborCellIdsById.set(sourceId, neighbors)
  }

  return { cells, neighborCellIdsById }
}
