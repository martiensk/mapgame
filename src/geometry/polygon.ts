import type { Point, Polygon } from '../types/world'

function pointsAlmostEqual(a: Point, b: Point, epsilon: number): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}

function edgeLength(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function polygonArea(polygon: Polygon): number {
  if (polygon.length < 3) {
    return 0
  }

  let area = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    area += current.x * next.y - next.x * current.y
  }

  return Math.abs(area) * 0.5
}

export function polygonCentroid(polygon: Polygon): Point {
  if (polygon.length === 0) {
    return { x: 0, y: 0 }
  }

  const area = polygonArea(polygon)
  if (area === 0) {
    const sum = polygon.reduce(
      (accumulator, point) => ({
        x: accumulator.x + point.x,
        y: accumulator.y + point.y,
      }),
      { x: 0, y: 0 },
    )

    return {
      x: sum.x / polygon.length,
      y: sum.y / polygon.length,
    }
  }

  let sumX = 0
  let sumY = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    const factor = current.x * next.y - next.x * current.y
    sumX += (current.x + next.x) * factor
    sumY += (current.y + next.y) * factor
  }

  const normalization = 1 / (6 * area)
  return {
    x: sumX * normalization,
    y: sumY * normalization,
  }
}

export function distanceBetween(a: Point, b: Point): number {
  const deltaX = a.x - b.x
  const deltaY = a.y - b.y
  return Math.hypot(deltaX, deltaY)
}

export function polygonToFlatArray(polygon: Polygon): number[] {
  const flattened: number[] = []
  polygon.forEach((point) => {
    flattened.push(point.x, point.y)
  })
  return flattened
}

export function mergeAdjacentPolygons(
  a: Polygon,
  b: Polygon,
  minimumSharedEdgeLength = 0,
): Polygon | null {
  if (a.length < 3 || b.length < 3) {
    return null
  }

  const epsilon = 1e-6
  let sharedI = -1
  let sharedJ = -1
  let sharedCount = 0

  for (let indexA = 0; indexA < a.length; indexA += 1) {
    const nextA = (indexA + 1) % a.length

    for (let indexB = 0; indexB < b.length; indexB += 1) {
      const nextB = (indexB + 1) % b.length
      const matchesReversedEdge =
        pointsAlmostEqual(a[indexA], b[nextB], epsilon) &&
        pointsAlmostEqual(a[nextA], b[indexB], epsilon)

      if (!matchesReversedEdge) {
        continue
      }

      sharedCount += 1
      if (sharedCount > 1) {
        return null
      }

      sharedI = indexA
      sharedJ = indexB
    }
  }

  if (sharedCount !== 1 || sharedI < 0 || sharedJ < 0) {
    return null
  }

  const sharedEdgeLength = edgeLength(a[sharedI], a[(sharedI + 1) % a.length])
  if (sharedEdgeLength < minimumSharedEdgeLength) {
    return null
  }

  const merged: Polygon = []

  for (let offset = 0; offset < a.length; offset += 1) {
    const index = (sharedI + 1 + offset) % a.length
    merged.push(a[index])
  }

  for (let offset = 0; offset < b.length - 2; offset += 1) {
    const index = (sharedJ + 2 + offset) % b.length
    merged.push(b[index])
  }

  const deduped: Polygon = []
  merged.forEach((point) => {
    if (
      deduped.length === 0 ||
      !pointsAlmostEqual(deduped[deduped.length - 1], point, epsilon)
    ) {
      deduped.push(point)
    }
  })

  if (
    deduped.length > 1 &&
    pointsAlmostEqual(deduped[0], deduped[deduped.length - 1], epsilon)
  ) {
    deduped.pop()
  }

  return deduped.length >= 3 ? deduped : null
}
