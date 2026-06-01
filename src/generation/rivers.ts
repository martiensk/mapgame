import {
  buildJoinedStripPolygon,
  findSharedEdge,
  sampleCatmullRomPolyline,
  polygonArea,
  polygonCentroid,
} from '../geometry/polygon'
import type {
  County,
  LandMass,
  Point,
  RegionId,
  River,
  RiverSegment,
  SeaZone,
  WorldConfig,
} from '../types/world'

const MAX_RIVER_TRACE_LENGTH = 600

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function hashToUnitInterval(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0) / 4294967295
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }
}

function normalizeVector(point: Point): Point {
  const length = Math.hypot(point.x, point.y)
  if (length === 0) {
    return { x: 0, y: 0 }
  }

  return {
    x: point.x / length,
    y: point.y / length,
  }
}

function vectorBetween(a: Point, b: Point): Point {
  return { x: b.x - a.x, y: b.y - a.y }
}

function unitNormal(from: Point, to: Point): Point {
  const direction = normalizeVector(vectorBetween(from, to))
  return {
    x: -direction.y,
    y: direction.x,
  }
}

function computeAnchorWidths(
  anchors: Point[],
  riverId: string,
  config: Pick<
    WorldConfig,
    'riverSegmentWidth' |
    'riverWidthJitter' |
    'riverDownstreamWidthGain' |
    'riverWidthMinFactor' |
    'riverWidthMaxFactor'
  >,
): number[] {
  const nodeCount = Math.max(1, anchors.length - 1)
  const baseWidth = config.riverSegmentWidth

  return anchors.map((_, index) => {
    const downstreamProgress = nodeCount <= 0 ? 0 : index / nodeCount
    const growthFactor = 1 + config.riverDownstreamWidthGain * downstreamProgress
    const jitterSeed = `${riverId}-width-${index}`
    const jitterValue = hashToUnitInterval(jitterSeed) * 2 - 1
    const jitterFactor = 1 + jitterValue * config.riverWidthJitter
    const unclampedWidth = baseWidth * growthFactor * jitterFactor
    const minWidth = baseWidth * config.riverWidthMinFactor
    const maxWidth = baseWidth * config.riverWidthMaxFactor

    return clamp(unclampedWidth, minWidth, maxWidth)
  })
}

function computeBendPoint(
  start: Point,
  end: Point,
  riverId: string,
  flowIndex: number,
  curveAmplitude: number,
  startWidth: number,
  endWidth: number,
): Point | undefined {
  if (curveAmplitude <= 0) {
    return undefined
  }

  const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
  if (segmentLength <= 1e-4) {
    return undefined
  }

  const midpointOnSegment = midpoint(start, end)
  const normal = unitNormal(start, end)
  const signedSeed = hashToUnitInterval(`${riverId}-curve-sign-${flowIndex}`)
  const magnitudeSeed = hashToUnitInterval(`${riverId}-curve-mag-${flowIndex}`)
  const sign = signedSeed < 0.5 ? -1 : 1
  const magnitude = 0.35 + magnitudeSeed * 0.65
  const averageWidth = (startWidth + endWidth) * 0.5
  const amplitude = clamp(
    averageWidth * curveAmplitude * magnitude,
    0,
    segmentLength * 0.18,
  )

  if (amplitude <= 1e-4) {
    return undefined
  }

  return {
    x: midpointOnSegment.x + normal.x * amplitude * sign,
    y: midpointOnSegment.y + normal.y * amplitude * sign,
  }
}

function interpolateSampledWidths(
  controlWidths: number[],
  samplesPerSpan: number,
): number[] {
  if (controlWidths.length <= 1 || samplesPerSpan <= 1) {
    return [...controlWidths]
  }

  const sampled: number[] = []
  for (let index = 0; index < controlWidths.length - 1; index += 1) {
    const startWidth = controlWidths[index]
    const endWidth = controlWidths[index + 1]

    for (let sampleIndex = 0; sampleIndex < samplesPerSpan; sampleIndex += 1) {
      const t = sampleIndex / samplesPerSpan
      sampled.push(startWidth + (endWidth - startWidth) * t)
    }
  }

  sampled.push(controlWidths[controlWidths.length - 1])
  return sampled
}

export function buildRiverAnchors(
  countyPath: RegionId[],
  countiesById: Map<RegionId, County>,
  seaZones: SeaZone[],
  terminalNextCountyId?: RegionId,
): Point[] {
  if (countyPath.length < 2) {
    return []
  }

  const firstCounty = countiesById.get(countyPath[0])
  if (!firstCounty) {
    return []
  }

  const sharedEdgeMidpoints: Point[] = []

  for (let index = 0; index < countyPath.length - 1; index += 1) {
    const countyA = countiesById.get(countyPath[index])
    const countyB = countiesById.get(countyPath[index + 1])

    if (!countyA || !countyB) {
      return []
    }

    const edge = findSharedEdge(countyA.polygon, countyB.polygon)
    if (!edge) {
      return []
    }

    sharedEdgeMidpoints.push(midpoint(edge.start, edge.end))
  }

  const mouthCounty = countiesById.get(countyPath[countyPath.length - 1])
  const penultimateCounty = countiesById.get(countyPath[countyPath.length - 2])
  if (!mouthCounty || !penultimateCounty) {
    return []
  }

  const terminalEdge = terminalNextCountyId
    ? (() => {
      const terminalNextCounty = countiesById.get(terminalNextCountyId)
      if (!terminalNextCounty) {
        return null
      }

      return findSharedEdge(mouthCounty.polygon, terminalNextCounty.polygon)
    })()
    : findMouthEdge(mouthCounty, penultimateCounty, seaZones)

  if (!terminalEdge) {
    return []
  }

  return [
    firstCounty.centroid,
    ...sharedEdgeMidpoints,
    midpoint(terminalEdge.start, terminalEdge.end),
  ]
}

export function buildRiverRenderGeometry(
  countyPath: RegionId[],
  countiesById: Map<RegionId, County>,
  seaZones: SeaZone[],
  riverId: string,
  config: Pick<
    WorldConfig,
    'riverSegmentWidth' |
    'riverCurveAmplitude' |
    'riverWidthJitter' |
    'riverDownstreamWidthGain' |
    'riverWidthMinFactor' |
    'riverWidthMaxFactor'
  >,
  terminalNextCountyId?: RegionId,
): { centerline: Point[]; centerlineWidths: number[] } {
  const anchors = buildRiverAnchors(
    countyPath,
    countiesById,
    seaZones,
    terminalNextCountyId,
  )
  if (anchors.length < 2) {
    return { centerline: [], centerlineWidths: [] }
  }

  const anchorWidths = computeAnchorWidths(anchors, riverId, config)
  const controlPoints: Point[] = [anchors[0]]
  const controlWidths: number[] = [anchorWidths[0]]

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index]
    const end = anchors[index + 1]
    const bendPoint = computeBendPoint(
      start,
      end,
      riverId,
      index,
      config.riverCurveAmplitude,
      anchorWidths[index],
      anchorWidths[index + 1],
    )

    if (bendPoint) {
      controlPoints.push(bendPoint)
      controlWidths.push((anchorWidths[index] + anchorWidths[index + 1]) * 0.5)
    }

    controlPoints.push(end)
    controlWidths.push(anchorWidths[index + 1])
  }

  const samplesPerSpan = 10

  return {
    centerline: sampleCatmullRomPolyline(controlPoints, samplesPerSpan),
    centerlineWidths: interpolateSampledWidths(controlWidths, samplesPerSpan),
  }
}

export function buildCoastalCountySet(seaZones: SeaZone[]): Set<RegionId> {
  const coastal = new Set<RegionId>()
  for (const zone of seaZones) {
    for (const id of zone.coastalCountyIds) {
      coastal.add(id)
    }
  }
  return coastal
}

export function buildFlowMap(
  counties: County[],
  countiesById: Map<RegionId, County>,
  coastalSet: Set<RegionId>,
): Map<RegionId, RegionId | null> {
  const flowMap = new Map<RegionId, RegionId | null>()

  for (const county of counties) {
    if (coastalSet.has(county.id)) {
      flowMap.set(county.id, null)
      continue
    }

    let bestNeighbor: County | null = null
    let bestElevation = county.elevation

    for (const neighborId of county.neighbors) {
      const neighbor = countiesById.get(neighborId)
      if (!neighbor) {
        continue
      }

      const isLower = neighbor.elevation < bestElevation
      const isTiedButCoastal =
        neighbor.elevation === bestElevation &&
        coastalSet.has(neighborId) &&
        (bestNeighbor === null || !coastalSet.has(bestNeighbor.id))
      const isTiedAndLexLower =
        neighbor.elevation === bestElevation &&
        !isTiedButCoastal &&
        (bestNeighbor === null || neighborId < bestNeighbor.id)

      if (isLower || isTiedButCoastal || isTiedAndLexLower) {
        bestNeighbor = neighbor
        bestElevation = neighbor.elevation
      }
    }

    flowMap.set(county.id, bestNeighbor?.id ?? null)
  }

  return flowMap
}

export function pickRiverSources(
  landMass: LandMass,
  countiesById: Map<RegionId, County>,
  coastalSet: Set<RegionId>,
  config: Pick<WorldConfig, 'riverDensityFactor' | 'riverMinSourceElevation'>,
  rng: { next: () => number },
): RegionId[] {
  if (landMass.countyIds.length < 3) {
    return []
  }

  const candidates = landMass.countyIds
    .filter((id) => {
      const county = countiesById.get(id)
      return (
        county !== undefined &&
        !coastalSet.has(id) &&
        county.elevation >= config.riverMinSourceElevation
      )
    })
    .sort((aId, bId) => {
      const aElev = countiesById.get(aId)?.elevation ?? 0
      const bElev = countiesById.get(bId)?.elevation ?? 0
      return bElev - aElev
    })

  if (candidates.length === 0) {
    return []
  }

  const targetCount = config.riverDensityFactor <= 0
    ? 0
    : Math.max(1, Math.round((landMass.countyIds.length * config.riverDensityFactor) / 100))
  const poolSize = Math.min(candidates.length, targetCount * 2)
  const pool = candidates.slice(0, poolSize)

  // Seeded shuffle of the pool then take targetCount
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng.next() * (index + 1))
    const temp = pool[index]
    pool[index] = pool[swapIndex]
    pool[swapIndex] = temp
  }

  return pool.slice(0, Math.min(targetCount, pool.length))
}

export function traceRiverPath(
  sourceId: RegionId,
  flowMap: Map<RegionId, RegionId | null>,
  coastalSet: Set<RegionId>,
): RegionId[] {
  const path: RegionId[] = [sourceId]
  const visited = new Set<RegionId>([sourceId])
  let current = sourceId

  while (path.length < MAX_RIVER_TRACE_LENGTH) {
    if (coastalSet.has(current)) {
      break
    }

    const nextId = flowMap.get(current)
    if (nextId === null || nextId === undefined) {
      break
    }

    if (visited.has(nextId)) {
      break
    }

    path.push(nextId)
    visited.add(nextId)
    current = nextId
  }

  return path
}

export function findMouthEdge(
  mouthCounty: County,
  penultimateCounty: County,
  seaZones: SeaZone[],
): { start: Point; end: Point } | null {
  const flowDirection = normalizeVector(
    vectorBetween(penultimateCounty.centroid, mouthCounty.centroid),
  )
  let bestEdge: { start: Point; end: Point } | null = null
  let bestScore = Number.NEGATIVE_INFINITY

  for (const seaZone of seaZones) {
    if (!seaZone.coastalCountyIds.includes(mouthCounty.id)) {
      continue
    }

    const edge = findSharedEdge(mouthCounty.polygon, seaZone.polygon)
    if (!edge) {
      continue
    }

    const edgeMidpoint = midpoint(edge.start, edge.end)
    const seaDirection = normalizeVector(
      vectorBetween(mouthCounty.centroid, edgeMidpoint),
    )
    const alignment =
      flowDirection.x * seaDirection.x + flowDirection.y * seaDirection.y
    const distanceScore = Math.hypot(
      edgeMidpoint.x - mouthCounty.centroid.x,
      edgeMidpoint.y - mouthCounty.centroid.y,
    )
    const score = alignment * 1_000 + distanceScore

    if (score > bestScore) {
      bestScore = score
      bestEdge = edge
    }
  }

  return bestEdge
}

export function buildRiverSegments(
  countyPath: RegionId[],
  countiesById: Map<RegionId, County>,
  seaZones: SeaZone[],
  riverId: string,
  config: Pick<
    WorldConfig,
    'riverSegmentWidth' |
    'riverCurveAmplitude' |
    'riverWidthJitter' |
    'riverDownstreamWidthGain' |
    'riverWidthMinFactor' |
    'riverWidthMaxFactor'
  >,
  terminalNextCountyId?: RegionId,
): RiverSegment[] {
  const anchors = buildRiverAnchors(
    countyPath,
    countiesById,
    seaZones,
    terminalNextCountyId,
  )
  if (anchors.length < 2) {
    return []
  }
  const anchorWidths = computeAnchorWidths(anchors, riverId, config)

  const segments: RiverSegment[] = []

  for (let index = 0; index < countyPath.length; index += 1) {
    const start = anchors[index]
    const end = anchors[index + 1]

    if (!start || !end) {
      return []
    }

    const startWidth = anchorWidths[index]
    const endWidth = anchorWidths[index + 1]
    if (!startWidth || !endWidth) {
      return []
    }

    const bendPoint = computeBendPoint(
      start,
      end,
      riverId,
      index,
      config.riverCurveAmplitude,
      startWidth,
      endWidth,
    )

    const polygon = buildJoinedStripPolygon(
      index > 0 ? anchors[index - 1] : null,
      start,
      end,
      index + 2 < anchors.length ? anchors[index + 2] : null,
      startWidth,
      endWidth,
      bendPoint,
    )

    const isMouth = index === countyPath.length - 1
    segments.push({
      id: isMouth ? `${riverId}-segment-mouth` : `${riverId}-segment-${index}`,
      riverId,
      polygon,
      centroid: polygonCentroid(polygon),
      area: polygonArea(polygon),
      countyNeighborIds: isMouth
        ? [countyPath[countyPath.length - 1]]
        : [countyPath[index], countyPath[index + 1]],
      flowIndex: index,
      isMouth,
    })
  }

  return segments
}

export function generateRivers(
  counties: County[],
  seaZones: SeaZone[],
  landMasses: LandMass[],
  config: Pick<
    WorldConfig,
    'riverDensityFactor' |
    'riverMinSourceElevation' |
    'riverMinLength' |
    'riverSegmentWidth' |
    'riverCurveAmplitude' |
    'riverWidthJitter' |
    'riverDownstreamWidthGain' |
    'riverWidthMinFactor' |
    'riverWidthMaxFactor'
  >,
  rng: { next: () => number },
): River[] {
  const countiesById = new Map(counties.map((county) => [county.id, county]))
  const coastalSet = buildCoastalCountySet(seaZones)
  const flowMap = buildFlowMap(counties, countiesById, coastalSet)
  const rivers: River[] = []
  const usedDirectedEdges = new Set<string>()

  function toEdgeKey(fromCountyId: RegionId, toCountyId: RegionId): string {
    return `${fromCountyId}->${toCountyId}`
  }

  for (const landMass of landMasses) {
    const sources = pickRiverSources(landMass, countiesById, coastalSet, config, rng)

    sources.forEach((sourceId, index) => {
      const countyPath = traceRiverPath(sourceId, flowMap, coastalSet)

      if (countyPath.length < config.riverMinLength) {
        return
      }

      let candidateCountyPath = countyPath
      let terminalNextCountyId: RegionId | undefined

      for (let pathIndex = 0; pathIndex < countyPath.length - 1; pathIndex += 1) {
        const edgeKey = toEdgeKey(countyPath[pathIndex], countyPath[pathIndex + 1])
        if (!usedDirectedEdges.has(edgeKey)) {
          continue
        }

        if (pathIndex === 0) {
          return
        }

        candidateCountyPath = countyPath.slice(0, pathIndex + 1)
        terminalNextCountyId = countyPath[pathIndex + 1]
        break
      }

      if (candidateCountyPath.length < config.riverMinLength) {
        return
      }

      const riverId = `river-${landMass.id}-${index}`
      const segments = buildRiverSegments(
        candidateCountyPath,
        countiesById,
        seaZones,
        riverId,
        {
          riverSegmentWidth: config.riverSegmentWidth,
          riverCurveAmplitude: config.riverCurveAmplitude,
          riverWidthJitter: config.riverWidthJitter,
          riverDownstreamWidthGain: config.riverDownstreamWidthGain,
          riverWidthMinFactor: config.riverWidthMinFactor,
          riverWidthMaxFactor: config.riverWidthMaxFactor,
        },
        terminalNextCountyId,
      )
      if (segments.length === 0) {
        return
      }

      for (let pathIndex = 0; pathIndex < candidateCountyPath.length - 1; pathIndex += 1) {
        usedDirectedEdges.add(
          toEdgeKey(candidateCountyPath[pathIndex], candidateCountyPath[pathIndex + 1]),
        )
      }

      rivers.push({
        id: riverId,
        landMassId: landMass.id,
        countyPath: candidateCountyPath,
        terminalNextCountyId,
        ...buildRiverRenderGeometry(
          candidateCountyPath,
          countiesById,
          seaZones,
          riverId,
          {
            riverSegmentWidth: config.riverSegmentWidth,
            riverCurveAmplitude: config.riverCurveAmplitude,
            riverWidthJitter: config.riverWidthJitter,
            riverDownstreamWidthGain: config.riverDownstreamWidthGain,
            riverWidthMinFactor: config.riverWidthMinFactor,
            riverWidthMaxFactor: config.riverWidthMaxFactor,
          },
          terminalNextCountyId,
        ),
        segments,
      })
    })
  }

  return rivers
}
