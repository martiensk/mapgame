import type { County, LandMass, SeaZone, WorldConfig } from '../types/world'
import { createSeededRandom } from './random'

interface Point {
  x: number
  y: number
}

interface RangeFeature {
  start: Point
  end: Point
  width: number
  strength: number
}

interface PeakFeature {
  center: Point
  radius: number
  strength: number
}

interface LandMassElevationStats {
  min: number
  max: number
  mean: number
}

const MIN_ELEVATION = 0
const MAX_ELEVATION = 1

const MOUNTAIN_BAND_START = 0.7
const PEAK_BAND_START = 0.9

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function hashUnit(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0) / 4294967296
}

function distance(pointA: Point, pointB: Point): number {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y)
}

function pointToSegmentDistance(point: Point, segmentStart: Point, segmentEnd: Point): number {
  const dx = segmentEnd.x - segmentStart.x
  const dy = segmentEnd.y - segmentStart.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared <= 1e-8) {
    return distance(point, segmentStart)
  }

  const t = clamp(
    ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / lengthSquared,
    0,
    1,
  )

  return distance(point, {
    x: segmentStart.x + dx * t,
    y: segmentStart.y + dy * t,
  })
}

function weightedPick<T>(
  values: T[],
  weight: (value: T) => number,
  random: { next: () => number },
): T | null {
  if (values.length === 0) {
    return null
  }

  let totalWeight = 0
  const weightedValues = values.map((value) => {
    const nextWeight = Math.max(0, weight(value))
    totalWeight += nextWeight
    return { value, nextWeight }
  })

  if (totalWeight <= 1e-8) {
    return values[0]
  }

  let roll = random.next() * totalWeight
  for (let index = 0; index < weightedValues.length; index += 1) {
    const candidate = weightedValues[index]
    roll -= candidate.nextWeight
    if (roll <= 0) {
      return candidate.value
    }
  }

  return weightedValues[weightedValues.length - 1]?.value ?? values[0]
}

function computeCountyDistancesFromCoast(
  countyIds: string[],
  countiesById: Map<string, County>,
  coastalCountyIds: Set<string>,
): Map<string, number> {
  const distanceByCountyId = new Map<string, number>()
  const queue: string[] = []

  countyIds.forEach((countyId) => {
    if (coastalCountyIds.has(countyId)) {
      distanceByCountyId.set(countyId, 0)
      queue.push(countyId)
    }
  })

  if (queue.length === 0 && countyIds.length > 0) {
    const fallbackCountyId = [...countyIds].sort()[0]
    distanceByCountyId.set(fallbackCountyId, 0)
    queue.push(fallbackCountyId)
  }

  let cursor = 0
  while (cursor < queue.length) {
    const countyId = queue[cursor]
    cursor += 1

    const county = countiesById.get(countyId)
    if (!county) {
      continue
    }

    const currentDistance = distanceByCountyId.get(countyId) ?? 0

    county.neighbors.forEach((neighborId) => {
      if (!countiesById.has(neighborId)) {
        return
      }

      const neighborCounty = countiesById.get(neighborId)
      if (!neighborCounty || neighborCounty.landMassId !== county.landMassId) {
        return
      }

      const bestDistance = distanceByCountyId.get(neighborId)
      const nextDistance = currentDistance + 1
      if (bestDistance === undefined || nextDistance < bestDistance) {
        distanceByCountyId.set(neighborId, nextDistance)
        queue.push(neighborId)
      }
    })
  }

  countyIds.forEach((countyId) => {
    if (!distanceByCountyId.has(countyId)) {
      distanceByCountyId.set(countyId, 0)
    }
  })

  return distanceByCountyId
}

function buildRangeFeatures(
  countyIds: string[],
  inlandByCountyId: Map<string, number>,
  countiesById: Map<string, County>,
  random: { next: () => number; int: (minimum: number, maximum: number) => number; float: (minimum: number, maximum: number) => number },
  config: Pick<WorldConfig, 'elevationRangeDensity' | 'elevationRangeStrength'>,
  averageCountyScale: number,
): RangeFeature[] {
  const rangeCount = Math.max(1, Math.round(Math.sqrt(countyIds.length) * config.elevationRangeDensity))
  const features: RangeFeature[] = []

  for (let index = 0; index < rangeCount; index += 1) {
    const startId = weightedPick(
      countyIds,
      (countyId) => {
        const inland = inlandByCountyId.get(countyId) ?? 0
        return 0.1 + inland * inland * 1.8
      },
      random,
    )

    if (!startId) {
      continue
    }

    const startCounty = countiesById.get(startId)
    if (!startCounty) {
      continue
    }

    const endId = weightedPick(
      countyIds.filter((countyId) => countyId !== startId),
      (countyId) => {
        const endCounty = countiesById.get(countyId)
        if (!endCounty) {
          return 0
        }

        const inland = inlandByCountyId.get(countyId) ?? 0
        const separation = distance(startCounty.centroid, endCounty.centroid)
        const normalizedSeparation = separation / Math.max(1, averageCountyScale * 5)
        return Math.max(0.05, inland) * (0.25 + normalizedSeparation)
      },
      random,
    )

    if (!endId) {
      continue
    }

    const endCounty = countiesById.get(endId)
    if (!endCounty) {
      continue
    }

    const width = averageCountyScale * random.float(2.2, 5.4)
    const strength = config.elevationRangeStrength * random.float(0.75, 1.25)

    features.push({
      start: startCounty.centroid,
      end: endCounty.centroid,
      width,
      strength,
    })
  }

  return features
}

function buildPeakFeatures(
  countyIds: string[],
  inlandByCountyId: Map<string, number>,
  countiesById: Map<string, County>,
  random: { next: () => number; int: (minimum: number, maximum: number) => number; float: (minimum: number, maximum: number) => number },
  config: Pick<WorldConfig, 'elevationPeakDensity' | 'elevationPeakStrength'>,
  averageCountyScale: number,
): PeakFeature[] {
  // Keep standalone peaks rarer than ranges so the mountain band stays broader.
  const peakCount = Math.max(
    1,
    Math.round(Math.sqrt(countyIds.length) * config.elevationPeakDensity * 0.72),
  )
  const features: PeakFeature[] = []

  for (let index = 0; index < peakCount; index += 1) {
    const countyId = weightedPick(
      countyIds,
      (candidateId) => {
        const inland = inlandByCountyId.get(candidateId) ?? 0
        return 0.04 + Math.pow(inland, 2.2)
      },
      random,
    )

    if (!countyId) {
      continue
    }

    const county = countiesById.get(countyId)
    if (!county) {
      continue
    }

    features.push({
      center: county.centroid,
      radius: averageCountyScale * random.float(1.0, 2.1),
      strength: config.elevationPeakStrength * random.float(0.68, 1.05),
    })
  }

  return features
}

function rebalanceHighElevationBands(elevation: number): number {
  const clampedElevation = clamp(elevation, MIN_ELEVATION, MAX_ELEVATION)
  if (clampedElevation <= MOUNTAIN_BAND_START) {
    return clampedElevation
  }

  if (clampedElevation <= PEAK_BAND_START) {
    const t = (clampedElevation - MOUNTAIN_BAND_START) / (PEAK_BAND_START - MOUNTAIN_BAND_START)
    const expandedMountain = Math.pow(t, 0.82)
    return MOUNTAIN_BAND_START + expandedMountain * (PEAK_BAND_START - MOUNTAIN_BAND_START)
  }

  const t = (clampedElevation - PEAK_BAND_START) / (MAX_ELEVATION - PEAK_BAND_START)
  const compressedPeak = Math.pow(t, 2.4)
  return PEAK_BAND_START + compressedPeak * (MAX_ELEVATION - PEAK_BAND_START)
}

export function assignRegionElevations(input: {
  seed: string
  counties: County[]
  seaZones: SeaZone[]
  landMasses: LandMass[]
  config: Pick<
    WorldConfig,
    | 'elevationInlandPower'
    | 'elevationRangeDensity'
    | 'elevationPeakDensity'
    | 'elevationRangeStrength'
    | 'elevationPeakStrength'
    | 'elevationNoiseStrength'
    | 'elevationCoastalReliefChance'
  >
}): Map<string, LandMassElevationStats> {
  const random = createSeededRandom(`${input.seed}::elevation`)
  const countiesById = new Map(input.counties.map((county) => [county.id, county]))
  const countyIdsByLandMass = new Map<string, string[]>()
  const coastalCountyIds = new Set<string>()

  input.counties.forEach((county) => {
    const countyIds = countyIdsByLandMass.get(county.landMassId) ?? []
    countyIds.push(county.id)
    countyIdsByLandMass.set(county.landMassId, countyIds)
  })

  input.seaZones.forEach((seaZone) => {
    seaZone.elevation = 0
    seaZone.coastalCountyIds.forEach((countyId) => coastalCountyIds.add(countyId))
  })

  const statsByLandMassId = new Map<string, LandMassElevationStats>()

  input.landMasses.forEach((landMass) => {
    const countyIds = (countyIdsByLandMass.get(landMass.id) ?? []).slice().sort()
    if (countyIds.length === 0) {
      statsByLandMassId.set(landMass.id, {
        min: 0,
        max: 0,
        mean: 0,
      })
      return
    }

    const distanceByCountyId = computeCountyDistancesFromCoast(
      countyIds,
      countiesById,
      coastalCountyIds,
    )

    const maximumDistance = countyIds.reduce(
      (maxDistance, countyId) => Math.max(maxDistance, distanceByCountyId.get(countyId) ?? 0),
      0,
    )

    const inlandByCountyId = new Map<string, number>()
    countyIds.forEach((countyId) => {
      const distanceFromCoast = distanceByCountyId.get(countyId) ?? 0
      const inland = maximumDistance > 0 ? distanceFromCoast / maximumDistance : 0
      inlandByCountyId.set(countyId, clamp(inland, 0, 1))
    })

    const averageCountyScale = Math.sqrt(Math.max(1, landMass.area / countyIds.length))
    const rangeFeatures = buildRangeFeatures(
      countyIds,
      inlandByCountyId,
      countiesById,
      random,
      {
        elevationRangeDensity: input.config.elevationRangeDensity,
        elevationRangeStrength: input.config.elevationRangeStrength,
      },
      averageCountyScale,
    )

    const peakFeatures = buildPeakFeatures(
      countyIds,
      inlandByCountyId,
      countiesById,
      random,
      {
        elevationPeakDensity: input.config.elevationPeakDensity,
        elevationPeakStrength: input.config.elevationPeakStrength,
      },
      averageCountyScale,
    )

    let minElevation = MAX_ELEVATION
    let maxElevation = MIN_ELEVATION
    let totalElevation = 0

    countyIds.forEach((countyId) => {
      const county = countiesById.get(countyId)
      if (!county) {
        return
      }

      const inland = inlandByCountyId.get(countyId) ?? 0
      const isCoastalCounty = coastalCountyIds.has(countyId)

      const baseElevation = 0.02 + Math.pow(inland, Math.max(0.5, input.config.elevationInlandPower)) * 0.43

      let rangeContribution = 0
      for (let index = 0; index < rangeFeatures.length; index += 1) {
        const feature = rangeFeatures[index]
        const distanceToRange = pointToSegmentDistance(
          county.centroid,
          feature.start,
          feature.end,
        )
        const influence = Math.exp(-Math.pow(distanceToRange / Math.max(1, feature.width), 2))
        rangeContribution += influence * feature.strength * (0.35 + 0.65 * inland)
      }

      let peakContribution = 0
      for (let index = 0; index < peakFeatures.length; index += 1) {
        const feature = peakFeatures[index]
        const distanceToPeak = distance(county.centroid, feature.center)
        const influence = Math.exp(-Math.pow(distanceToPeak / Math.max(1, feature.radius), 2))
        peakContribution += influence * feature.strength
      }

      const noise =
        (hashUnit(`${input.seed}::elevation::${county.id}`) * 2 - 1) *
        Math.max(0, input.config.elevationNoiseStrength)

      let elevation = baseElevation + rangeContribution + peakContribution + noise

      if (isCoastalCounty) {
        elevation *= 0.82
        const coastalReliefRoll = hashUnit(`${input.seed}::coastal-relief::${county.id}`)
        if (coastalReliefRoll < input.config.elevationCoastalReliefChance) {
          elevation += 0.16
        }
      }

      elevation = rebalanceHighElevationBands(elevation)

      if (elevation >= PEAK_BAND_START) {
        const peakRetentionChance = clamp(0.1 + inland * 0.3, 0.1, 0.5)
        const peakRoll = hashUnit(`${input.seed}::peak-gate::${county.id}`)

        if (peakRoll > peakRetentionChance) {
          const t =
            (elevation - PEAK_BAND_START) / (MAX_ELEVATION - PEAK_BAND_START)
          elevation = 0.82 + Math.pow(clamp(t, 0, 1), 0.8) * 0.07
        }
      }

      county.elevation = elevation

      minElevation = Math.min(minElevation, elevation)
      maxElevation = Math.max(maxElevation, elevation)
      totalElevation += elevation
    })

    statsByLandMassId.set(landMass.id, {
      min: minElevation,
      max: maxElevation,
      mean: totalElevation / countyIds.length,
    })
  })

  return statsByLandMassId
}
