import type { County, SeaZone, WorldConfig } from '../types/world'

export type WindDirection = 'west-to-east' | 'east-to-west'

interface DirectionalTrace {
  stepsTraversed: number
  oceanStep: number | null
  pathCountyIds: string[]
}

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

export function pickGlobalWindDirection(seed: string): WindDirection {
  return hashUnit(`${seed}::moisture::wind`) < 0.5 ? 'west-to-east' : 'east-to-west'
}

function buildCoastalCountySet(seaZones: SeaZone[]): Set<string> {
  const coastalCountyIds = new Set<string>()
  seaZones.forEach((seaZone) => {
    seaZone.coastalCountyIds.forEach((countyId) => coastalCountyIds.add(countyId))
  })
  return coastalCountyIds
}

function computeDistanceToWaterByLandMass(
  landMassCountyIds: string[],
  countiesById: Map<string, County>,
  waterCountyIds: Set<string>,
): { distanceByCountyId: Map<string, number>; maxDistance: number } {
  const distanceByCountyId = new Map<string, number>()
  const queue: string[] = []

  landMassCountyIds.forEach((countyId) => {
    if (!waterCountyIds.has(countyId)) {
      return
    }

    distanceByCountyId.set(countyId, 0)
    queue.push(countyId)
  })

  if (queue.length === 0 && landMassCountyIds.length > 0) {
    const fallbackCountyId = [...landMassCountyIds].sort()[0]
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
      const neighbor = countiesById.get(neighborId)
      if (!neighbor || neighbor.landMassId !== county.landMassId) {
        return
      }

      const knownDistance = distanceByCountyId.get(neighborId)
      const nextDistance = currentDistance + 1
      if (knownDistance === undefined || nextDistance < knownDistance) {
        distanceByCountyId.set(neighborId, nextDistance)
        queue.push(neighborId)
      }
    })
  }

  let maxDistance = 0
  landMassCountyIds.forEach((countyId) => {
    const distance = distanceByCountyId.get(countyId) ?? 0
    distanceByCountyId.set(countyId, distance)
    maxDistance = Math.max(maxDistance, distance)
  })

  return { distanceByCountyId, maxDistance }
}

function selectMostDirectionalNeighbor(
  county: County,
  sign: -1 | 1,
  countiesById: Map<string, County>,
): County | null {
  let bestNeighbor: County | null = null
  let bestPrimaryScore = 0
  let bestSecondaryScore = Number.POSITIVE_INFINITY

  county.neighbors.forEach((neighborId) => {
    const neighbor = countiesById.get(neighborId)
    if (!neighbor || neighbor.landMassId !== county.landMassId) {
      return
    }

    const deltaX = neighbor.centroid.x - county.centroid.x
    const primaryScore = sign * deltaX
    if (primaryScore <= 1e-6) {
      return
    }

    const secondaryScore = Math.abs(neighbor.centroid.y - county.centroid.y)
    const isBetter =
      !bestNeighbor ||
      primaryScore > bestPrimaryScore + 1e-6 ||
      (Math.abs(primaryScore - bestPrimaryScore) <= 1e-6 &&
        (secondaryScore < bestSecondaryScore - 1e-6 ||
          (Math.abs(secondaryScore - bestSecondaryScore) <= 1e-6 &&
            neighbor.id < bestNeighbor.id)))

    if (!isBetter) {
      return
    }

    bestNeighbor = neighbor
    bestPrimaryScore = primaryScore
    bestSecondaryScore = secondaryScore
  })

  return bestNeighbor
}

function traceDirectional(
  startCounty: County,
  sign: -1 | 1,
  countiesById: Map<string, County>,
  coastalCountyIds: Set<string>,
  maxSteps: number,
): DirectionalTrace {
  const visited = new Set<string>([startCounty.id])
  const pathCountyIds: string[] = [startCounty.id]

  let current = startCounty
  let stepsTraversed = 0
  let oceanStep: number | null = coastalCountyIds.has(startCounty.id) ? 0 : null

  while (stepsTraversed < maxSteps) {
    const nextCounty = selectMostDirectionalNeighbor(current, sign, countiesById)
    if (!nextCounty || visited.has(nextCounty.id)) {
      break
    }

    stepsTraversed += 1
    pathCountyIds.push(nextCounty.id)
    visited.add(nextCounty.id)
    current = nextCounty

    if (coastalCountyIds.has(nextCounty.id)) {
      oceanStep = stepsTraversed
      break
    }
  }

  return {
    stepsTraversed,
    oceanStep,
    pathCountyIds,
  }
}

function mountainModifierFromTrace(
  trace: DirectionalTrace,
  countiesById: Map<string, County>,
  config: Pick<
    WorldConfig,
    | 'moistureMountainThreshold'
    | 'moistureWindwardWeight'
    | 'moistureLeewardWeight'
    | 'moistureMountainDistanceDecay'
  >,
  side: 'windward' | 'leeward',
): number {
  const threshold = config.moistureMountainThreshold
  const decayDistance = Math.max(0.5, config.moistureMountainDistanceDecay)

  for (let index = 1; index < trace.pathCountyIds.length; index += 1) {
    const barrierCounty = countiesById.get(trace.pathCountyIds[index])
    if (!barrierCounty || barrierCounty.elevation < threshold) {
      continue
    }

    const barrierStrength = clamp(
      (barrierCounty.elevation - threshold) / Math.max(1e-6, 1 - threshold),
      0,
      1,
    )
    const distanceDecay = Math.exp(-index / decayDistance)

    if (side === 'windward') {
      return config.moistureWindwardWeight * barrierStrength * distanceDecay
    }

    return -config.moistureLeewardWeight * barrierStrength * distanceDecay
  }

  return 0
}

export function assignRegionMoisture(input: {
  seed: string
  windDirection: WindDirection
  counties: County[]
  seaZones: SeaZone[]
  rivers: Array<{ countyPath: string[] }>
  config: Pick<
    WorldConfig,
    | 'moistureBaseLevel'
    | 'moistureMaxWaterDistanceSteps'
    | 'moistureWaterWeight'
    | 'moistureWindOceanBoostWeight'
    | 'moistureWindLandPenaltyPerStep'
    | 'moistureWindMaxTraceSteps'
    | 'moistureMountainThreshold'
    | 'moistureWindwardWeight'
    | 'moistureLeewardWeight'
    | 'moistureMountainDistanceDecay'
    | 'moistureEvaporationBase'
    | 'moistureEvaporationHeatStart'
    | 'moistureEvaporationHeatFactor'
    | 'moistureNoiseStrength'
  >
}): void {
  const countiesById = new Map(input.counties.map((county) => [county.id, county]))
  const countiesByLandMassId = new Map<string, string[]>()
  const riverCountyIds = new Set(input.rivers.flatMap((river) => river.countyPath))
  const coastalCountyIds = buildCoastalCountySet(input.seaZones)
  const waterCountyIds = new Set<string>([...coastalCountyIds, ...riverCountyIds])

  input.counties.forEach((county) => {
    const countyIds = countiesByLandMassId.get(county.landMassId) ?? []
    countyIds.push(county.id)
    countiesByLandMassId.set(county.landMassId, countyIds)
  })

  const upwindSign: -1 | 1 = input.windDirection === 'west-to-east' ? -1 : 1
  const downwindSign: -1 | 1 = input.windDirection === 'west-to-east' ? 1 : -1

  const distanceByCountyId = new Map<string, number>()
  const maxDistanceByLandMassId = new Map<string, number>()

  countiesByLandMassId.forEach((landMassCountyIds, landMassId) => {
    const { distanceByCountyId: perLandMassDistanceByCountyId, maxDistance } =
      computeDistanceToWaterByLandMass(landMassCountyIds, countiesById, waterCountyIds)

    perLandMassDistanceByCountyId.forEach((distance, countyId) => {
      distanceByCountyId.set(countyId, distance)
    })

    const boundedMaxDistance = Math.max(
      1,
      Math.min(maxDistance, input.config.moistureMaxWaterDistanceSteps),
    )
    maxDistanceByLandMassId.set(landMassId, boundedMaxDistance)
  })

  input.counties.forEach((county) => {
    const maxDistance = maxDistanceByLandMassId.get(county.landMassId) ?? 1
    const distanceToWater = distanceByCountyId.get(county.id) ?? 0
    const waterInfluence = clamp(1 - distanceToWater / maxDistance, 0, 1)

    const upwindTrace = traceDirectional(
      county,
      upwindSign,
      countiesById,
      coastalCountyIds,
      input.config.moistureWindMaxTraceSteps,
    )
    const downwindTrace = traceDirectional(
      county,
      downwindSign,
      countiesById,
      coastalCountyIds,
      input.config.moistureWindMaxTraceSteps,
    )

    const oceanRecency =
      upwindTrace.oceanStep === null ? 0 : Math.exp(-upwindTrace.oceanStep / 5)
    const windModifier =
      input.config.moistureWindOceanBoostWeight * oceanRecency -
      input.config.moistureWindLandPenaltyPerStep * upwindTrace.stepsTraversed

    const windwardModifier = mountainModifierFromTrace(
      downwindTrace,
      countiesById,
      input.config,
      'windward',
    )
    const leewardModifier = mountainModifierFromTrace(
      upwindTrace,
      countiesById,
      input.config,
      'leeward',
    )
    const orographicModifier = windwardModifier + leewardModifier

    const heatExcess = Math.max(0, county.temperature - input.config.moistureEvaporationHeatStart)
    const evaporationPenalty =
      input.config.moistureEvaporationBase +
      input.config.moistureEvaporationHeatFactor * heatExcess

    const noise =
      (hashUnit(`${input.seed}::moisture::${county.id}`) * 2 - 1) *
      input.config.moistureNoiseStrength

    const moistureRaw =
      input.config.moistureBaseLevel +
      input.config.moistureWaterWeight * waterInfluence +
      windModifier +
      orographicModifier -
      evaporationPenalty +
      noise

    county.moistureBase = input.config.moistureBaseLevel
    county.moistureWaterInfluence = waterInfluence
    county.moistureWindModifier = windModifier
    county.moistureOrographicModifier = orographicModifier
    county.moistureEvaporationPenalty = evaporationPenalty
    county.moisture = clamp(moistureRaw, 0, 1)
  })

  input.seaZones.forEach((seaZone) => {
    seaZone.moisture = 1
  })
}
