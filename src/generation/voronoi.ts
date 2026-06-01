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

type SitePoint = [number, number]

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function buildVoronoi(points: SitePoint[], width: number, height: number) {
  const delaunay = Delaunay.from(points)
  const voronoi = delaunay.voronoi([0, 0, width, height])
  return { delaunay, voronoi }
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

interface SiteGenerationResult {
  points: SitePoint[]
  minDistance: number
}

function generatePoissonSites(
  config: WorldConfig,
  targetCells: number,
  random: SeededRandom,
): SiteGenerationResult {
  const spacingFactor = clamp(config.voronoiPoissonSpacingFactor, 0.5, 1.5)
  const worldArea = config.width * config.height
  const minDistance = Math.max(
    1,
    spacingFactor * Math.sqrt((2 * worldArea) / (Math.sqrt(3) * targetCells)),
  )
  const gridCellSize = minDistance / Math.SQRT2
  const gridColumns = Math.max(1, Math.ceil(config.width / gridCellSize))
  const gridRows = Math.max(1, Math.ceil(config.height / gridCellSize))
  const grid = new Int32Array(gridColumns * gridRows)
  grid.fill(-1)

  const points: SitePoint[] = []
  const activePointIndices: number[] = []

  const gridIndexFor = (x: number, y: number): number => {
    const column = clamp(Math.floor(x / gridCellSize), 0, gridColumns - 1)
    const row = clamp(Math.floor(y / gridCellSize), 0, gridRows - 1)
    return row * gridColumns + column
  }

  const canPlacePoint = (x: number, y: number, requiredDistance: number): boolean => {
    const centerColumn = clamp(Math.floor(x / gridCellSize), 0, gridColumns - 1)
    const centerRow = clamp(Math.floor(y / gridCellSize), 0, gridRows - 1)
    const searchRadius = 2
    const requiredDistanceSquared = requiredDistance * requiredDistance

    for (
      let row = Math.max(0, centerRow - searchRadius);
      row <= Math.min(gridRows - 1, centerRow + searchRadius);
      row += 1
    ) {
      for (
        let column = Math.max(0, centerColumn - searchRadius);
        column <= Math.min(gridColumns - 1, centerColumn + searchRadius);
        column += 1
      ) {
        const candidateIndex = grid[row * gridColumns + column]
        if (candidateIndex < 0) {
          continue
        }

        const [existingX, existingY] = points[candidateIndex]
        const dx = x - existingX
        const dy = y - existingY
        if (dx * dx + dy * dy < requiredDistanceSquared) {
          return false
        }
      }
    }

    return true
  }

  const addPoint = (x: number, y: number, addToActive: boolean): void => {
    points.push([x, y])
    const pointIndex = points.length - 1
    grid[gridIndexFor(x, y)] = pointIndex
    if (addToActive) {
      activePointIndices.push(pointIndex)
    }
  }

  addPoint(random.float(0, config.width), random.float(0, config.height), true)

  const poissonAttemptsPerActivePoint = 24

  while (activePointIndices.length > 0 && points.length < targetCells) {
    const activeIndex = random.int(0, activePointIndices.length - 1)
    const sourcePointIndex = activePointIndices[activeIndex]
    const [sourceX, sourceY] = points[sourcePointIndex]

    let foundCandidate = false
    for (
      let attempt = 0;
      attempt < poissonAttemptsPerActivePoint && points.length < targetCells;
      attempt += 1
    ) {
      const angle = random.float(0, Math.PI * 2)
      const radius = minDistance * (1 + random.next())
      const x = sourceX + Math.cos(angle) * radius
      const y = sourceY + Math.sin(angle) * radius

      if (x < 0 || x > config.width || y < 0 || y > config.height) {
        continue
      }

      if (!canPlacePoint(x, y, minDistance)) {
        continue
      }

      addPoint(x, y, true)
      foundCandidate = true
    }

    if (!foundCandidate) {
      const lastActiveIndex = activePointIndices.length - 1
      activePointIndices[activeIndex] = activePointIndices[lastActiveIndex]
      activePointIndices.pop()
    }
  }

  if (points.length < targetCells) {
    const fallbackDistance = minDistance * 0.78
    const maximumAttempts = targetCells * 40
    let attempt = 0

    while (points.length < targetCells && attempt < maximumAttempts) {
      attempt += 1
      const x = random.float(0, config.width)
      const y = random.float(0, config.height)

      if (!canPlacePoint(x, y, fallbackDistance)) {
        continue
      }

      addPoint(x, y, false)
    }
  }

  if (points.length < targetCells) {
    const aspectRatio = config.width / config.height
    const columns = Math.max(2, Math.ceil(Math.sqrt(targetCells * aspectRatio)))
    const rows = Math.max(2, Math.ceil(targetCells / columns))
    const spacingX = config.width / columns
    const spacingY = config.height / rows

    for (let row = 0; row < rows && points.length < targetCells; row += 1) {
      const yBase = (row + 0.5) * spacingY
      for (let column = 0; column < columns && points.length < targetCells; column += 1) {
        const xBase = (column + 0.5 + (row % 2 === 0 ? 0 : 0.5 / columns)) * spacingX
        const x = clamp(xBase + random.float(-spacingX * 0.25, spacingX * 0.25), 0, config.width)
        const y = clamp(yBase + random.float(-spacingY * 0.25, spacingY * 0.25), 0, config.height)

        addPoint(x, y, false)
      }
    }
  }

  if (points.length > targetCells) {
    points.length = targetCells
  }

  return { points, minDistance }
}

function relaxSites(
  points: SitePoint[],
  config: WorldConfig,
  random: SeededRandom,
  minDistance: number,
): SitePoint[] {
  const lloydRelaxations = Math.max(0, Math.floor(config.voronoiLloydRelaxations))
  if (lloydRelaxations === 0) {
    return points
  }

  const microJitterRatio = clamp(config.voronoiSiteMicroJitter, 0, 0.2)
  const jitterDistance = minDistance * microJitterRatio
  let relaxedPoints = points

  for (let iteration = 0; iteration < lloydRelaxations; iteration += 1) {
    const { voronoi } = buildVoronoi(relaxedPoints, config.width, config.height)

    relaxedPoints = relaxedPoints.map((point, index) => {
      const polygonPoints = voronoi.cellPolygon(index)
      if (!polygonPoints) {
        return point
      }

      const polygon = toPolygon(polygonPoints as Array<[number, number]>)
      if (polygon.length < 3) {
        return point
      }

      const centroid = polygonCentroid(polygon)
      const jitterX = jitterDistance > 0 ? random.float(-jitterDistance, jitterDistance) : 0
      const jitterY = jitterDistance > 0 ? random.float(-jitterDistance, jitterDistance) : 0

      return [
        clamp(centroid.x + jitterX, 0, config.width),
        clamp(centroid.y + jitterY, 0, config.height),
      ]
    })
  }

  return relaxedPoints
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

  const { points: sampledPoints, minDistance } = generatePoissonSites(
    config,
    targetCells,
    random,
  )
  const points = relaxSites(sampledPoints, config, random, minDistance)
  const { delaunay, voronoi } = buildVoronoi(points, config.width, config.height)

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
