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

export function buildStripPolygon(
  edge: { start: Point; end: Point },
  width: number,
): Polygon {
  const deltaX = edge.end.x - edge.start.x
  const deltaY = edge.end.y - edge.start.y
  const length = Math.hypot(deltaX, deltaY)

  if (length === 0) {
    return [edge.start, edge.end, edge.end, edge.start]
  }

  const halfWidth = width * 0.5
  const perpendicularX = -deltaY / length
  const perpendicularY = deltaX / length
  const offsetX = perpendicularX * halfWidth
  const offsetY = perpendicularY * halfWidth

  return [
    { x: edge.start.x + offsetX, y: edge.start.y + offsetY },
    { x: edge.end.x + offsetX, y: edge.end.y + offsetY },
    { x: edge.end.x - offsetX, y: edge.end.y - offsetY },
    { x: edge.start.x - offsetX, y: edge.start.y - offsetY },
  ]
}

function normalizeVector(x: number, y: number): Point {
  const length = Math.hypot(x, y)
  if (length === 0) {
    return { x: 0, y: 0 }
  }

  return {
    x: x / length,
    y: y / length,
  }
}

function computeJoinOffset(
  previousPoint: Point | null,
  point: Point,
  nextPoint: Point | null,
  halfWidth: number,
): Point {
  if (!nextPoint) {
    if (!previousPoint) {
      return { x: 0, y: 0 }
    }

    const direction = normalizeVector(point.x - previousPoint.x, point.y - previousPoint.y)
    return {
      x: -direction.y * halfWidth,
      y: direction.x * halfWidth,
    }
  }

  if (!previousPoint) {
    const direction = normalizeVector(nextPoint.x - point.x, nextPoint.y - point.y)
    return {
      x: -direction.y * halfWidth,
      y: direction.x * halfWidth,
    }
  }

  const previousDirection = normalizeVector(
    point.x - previousPoint.x,
    point.y - previousPoint.y,
  )
  const nextDirection = normalizeVector(nextPoint.x - point.x, nextPoint.y - point.y)
  const previousNormal = { x: -previousDirection.y, y: previousDirection.x }
  const nextNormal = { x: -nextDirection.y, y: nextDirection.x }
  const miter = normalizeVector(
    previousNormal.x + nextNormal.x,
    previousNormal.y + nextNormal.y,
  )

  if (miter.x === 0 && miter.y === 0) {
    return {
      x: nextNormal.x * halfWidth,
      y: nextNormal.y * halfWidth,
    }
  }

  const projection = miter.x * nextNormal.x + miter.y * nextNormal.y
  if (Math.abs(projection) < 1e-4) {
    return {
      x: nextNormal.x * halfWidth,
      y: nextNormal.y * halfWidth,
    }
  }

  const miterLength = Math.min(halfWidth / projection, halfWidth * 2)
  return {
    x: miter.x * miterLength,
    y: miter.y * miterLength,
  }
}

export function buildJoinedStripPolygon(
  previousPoint: Point | null,
  start: Point,
  end: Point,
  nextPoint: Point | null,
  startWidth: number,
  endWidth: number,
  bendPoint?: Point,
): Polygon {
  const startHalfWidth = startWidth * 0.5
  const endHalfWidth = endWidth * 0.5
  const startOffset = computeJoinOffset(previousPoint, start, end, startHalfWidth)
  const endOffset = computeJoinOffset(start, end, nextPoint, endHalfWidth)

  if (bendPoint) {
    const direction = normalizeVector(end.x - start.x, end.y - start.y)
    const bendNormal = {
      x: -direction.y,
      y: direction.x,
    }
    const bendHalfWidth = (startHalfWidth + endHalfWidth) * 0.5
    const bendOffset = {
      x: bendNormal.x * bendHalfWidth,
      y: bendNormal.y * bendHalfWidth,
    }

    return [
      { x: start.x + startOffset.x, y: start.y + startOffset.y },
      { x: bendPoint.x + bendOffset.x, y: bendPoint.y + bendOffset.y },
      { x: end.x + endOffset.x, y: end.y + endOffset.y },
      { x: end.x - endOffset.x, y: end.y - endOffset.y },
      { x: bendPoint.x - bendOffset.x, y: bendPoint.y - bendOffset.y },
      { x: start.x - startOffset.x, y: start.y - startOffset.y },
    ]
  }

  return [
    { x: start.x + startOffset.x, y: start.y + startOffset.y },
    { x: end.x + endOffset.x, y: end.y + endOffset.y },
    { x: end.x - endOffset.x, y: end.y - endOffset.y },
    { x: start.x - startOffset.x, y: start.y - startOffset.y },
  ]
}

function catmullRomPoint(
  point0: Point,
  point1: Point,
  point2: Point,
  point3: Point,
  t: number,
): Point {
  const t2 = t * t
  const t3 = t2 * t

  return {
    x: 0.5 * (
      (2 * point1.x) +
      (-point0.x + point2.x) * t +
      (2 * point0.x - 5 * point1.x + 4 * point2.x - point3.x) * t2 +
      (-point0.x + 3 * point1.x - 3 * point2.x + point3.x) * t3
    ),
    y: 0.5 * (
      (2 * point1.y) +
      (-point0.y + point2.y) * t +
      (2 * point0.y - 5 * point1.y + 4 * point2.y - point3.y) * t2 +
      (-point0.y + 3 * point1.y - 3 * point2.y + point3.y) * t3
    ),
  }
}

export function sampleCatmullRomPolyline(
  points: Point[],
  samplesPerSpan: number,
): Point[] {
  if (points.length <= 2 || samplesPerSpan <= 1) {
    return points.map((point) => ({ ...point }))
  }

  const sampled: Point[] = []

  for (let index = 0; index < points.length - 1; index += 1) {
    const point0 = points[Math.max(0, index - 1)]
    const point1 = points[index]
    const point2 = points[index + 1]
    const point3 = points[Math.min(points.length - 1, index + 2)]

    for (let sampleIndex = 0; sampleIndex < samplesPerSpan; sampleIndex += 1) {
      const t = sampleIndex / samplesPerSpan
      sampled.push(catmullRomPoint(point0, point1, point2, point3, t))
    }
  }

  sampled.push({ ...points[points.length - 1] })
  return sampled
}

export function buildRibbonPolygon(
  centerline: Point[],
  widths: number[],
): Polygon {
  if (centerline.length < 2 || centerline.length !== widths.length) {
    return []
  }

  const leftSide: Point[] = []
  const rightSide: Point[] = []

  for (let index = 0; index < centerline.length; index += 1) {
    const previous = centerline[Math.max(0, index - 1)]
    const current = centerline[index]
    const next = centerline[Math.min(centerline.length - 1, index + 1)]
    const tangent = normalizeVector(next.x - previous.x, next.y - previous.y)
    const normal = {
      x: -tangent.y,
      y: tangent.x,
    }
    const halfWidth = widths[index] * 0.5

    leftSide.push({
      x: current.x + normal.x * halfWidth,
      y: current.y + normal.y * halfWidth,
    })
    rightSide.push({
      x: current.x - normal.x * halfWidth,
      y: current.y - normal.y * halfWidth,
    })
  }

  return [...leftSide, ...rightSide.reverse()]
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

export function findSharedEdge(
  a: Polygon,
  b: Polygon,
  epsilon = 1e-3,
): { start: Point; end: Point } | null {
  for (let indexA = 0; indexA < a.length; indexA += 1) {  
    const aStart = a[indexA]
    const aEnd = a[(indexA + 1) % a.length]

    for (let indexB = 0; indexB < b.length; indexB += 1) {
      const bStart = b[indexB]
      const bEnd = b[(indexB + 1) % b.length]

      const reversedMatch =
        pointsAlmostEqual(aStart, bEnd, epsilon) &&
        pointsAlmostEqual(aEnd, bStart, epsilon)

      if (reversedMatch) {
        return { start: aStart, end: aEnd }
      }
    }
  }

  return null
}
