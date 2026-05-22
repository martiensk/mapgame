import type { County, WorldConfig } from '../types/world'
import { polygonArea, polygonCentroid } from '../geometry/polygon'
import { mergeAdjacentPolygons } from '../geometry/polygon'
import { getLandMassIdAtPoint, type LandMassShape } from './landmass'
import type { SeededRandom } from './random'
import type { VoronoiCell } from './voronoi'

export interface CountyGenerationResult {
  counties: County[]
  countyIdsByLandMass: Map<string, string[]>
  countyIdByCellId: Map<string, string>
  cellIdByCountyId: Map<string, string>
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function shuffleInPlace<T>(values: T[], random: SeededRandom): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = random.int(0, index)
    const tmp = values[index]
    values[index] = values[swapIndex]
    values[swapIndex] = tmp
  }
}

export function mergeCountiesPhase(
  result: CountyGenerationResult,
  config: WorldConfig,
  random: SeededRandom,
): void {
  const reduction = Math.min(Math.max(config.countyMergeReduction, 0), 1)
  const target = Math.max(1, Math.floor(result.counties.length * (1 - reduction)))

  if (reduction <= 0 || result.counties.length <= target) {
    return
  }

  const countyById = new Map(result.counties.map((county) => [county.id, county]))
  const cellsForCounty = new Map<string, Set<string>>()
  const minimumSharedEdgeLength =
    Math.min(config.width, config.height) * 0.0015
  const mergedSurvivorCountyIds = new Set<string>()

  const tryMergeCounties = (survivorId: string, absorbedId: string): boolean => {
    const countyA = countyById.get(survivorId)
    const countyB = countyById.get(absorbedId)

    if (!countyA || !countyB || countyA.id === countyB.id) {
      return false
    }

    const mergedPolygon = mergeAdjacentPolygons(
      countyA.polygon,
      countyB.polygon,
      minimumSharedEdgeLength,
    )

    if (!mergedPolygon) {
      return false
    }

    countyA.polygon = mergedPolygon
    countyA.area = polygonArea(mergedPolygon)
    countyA.centroid = polygonCentroid(mergedPolygon)
    countyA.neighbors = unique(
      [...countyA.neighbors, ...countyB.neighbors].filter(
        (id) => id !== countyA.id && id !== countyB.id,
      ),
    )

    countyById.forEach((county) => {
      if (county.id === countyA.id || county.id === countyB.id) {
        return
      }

      if (!county.neighbors.includes(countyB.id)) {
        return
      }

      county.neighbors = unique(
        county.neighbors
          .map((id) => (id === countyB.id ? countyA.id : id))
          .filter((id) => id !== county.id && id !== countyB.id && countyById.has(id)),
      )
    })

    const countyACells = cellsForCounty.get(countyA.id) ?? new Set<string>()
    const countyBCells = cellsForCounty.get(countyB.id) ?? new Set<string>()

    countyBCells.forEach((cellId) => {
      countyACells.add(cellId)
      result.countyIdByCellId.set(cellId, countyA.id)
    })

    cellsForCounty.set(countyA.id, countyACells)
    cellsForCounty.delete(countyB.id)

    const landMassCountyIds = result.countyIdsByLandMass.get(countyB.landMassId)
    if (landMassCountyIds) {
      result.countyIdsByLandMass.set(
        countyB.landMassId,
        landMassCountyIds.filter((id) => id !== countyB.id),
      )
    }

    result.cellIdByCountyId.delete(countyB.id)
    countyById.delete(countyB.id)
    mergedSurvivorCountyIds.add(countyA.id)
    return true
  }

  result.counties.forEach((county) => {
    const sourceCellId = result.cellIdByCountyId.get(county.id)
    const coveredCellIds = new Set<string>()
    if (sourceCellId) {
      coveredCellIds.add(sourceCellId)
    }
    cellsForCounty.set(county.id, coveredCellIds)
  })

  const candidates = result.counties.map((county) => county.id)
  shuffleInPlace(candidates, random)

  let candidateIndex = 0
  while (countyById.size > target) {
    if (candidateIndex >= candidates.length) {
      break
    }

    const candidateId = candidates[candidateIndex]
    candidateIndex += 1

    const countyA = countyById.get(candidateId)
    if (!countyA) {
      continue
    }

    const landNeighbors = countyA.neighbors.filter((neighborId) => countyById.has(neighborId))
    if (landNeighbors.length === 0) {
      continue
    }

    shuffleInPlace(landNeighbors, random)

    let merged = false
    for (let index = 0; index < landNeighbors.length; index += 1) {
      const neighborId = landNeighbors[index]
      if (tryMergeCounties(countyA.id, neighborId)) {
        merged = true
        break
      }
    }

    if (!merged) {
      continue
    }
  }

  const mergedSurvivorCandidates = [...mergedSurvivorCountyIds].filter((countyId) =>
    countyById.has(countyId),
  )
  shuffleInPlace(mergedSurvivorCandidates, random)

  const boostedCountyCount = Math.floor(mergedSurvivorCandidates.length * 0.3)
  const boostedCountyIds = mergedSurvivorCandidates.slice(0, boostedCountyCount)

  boostedCountyIds.forEach((countyId) => {
    const county = countyById.get(countyId)
    if (!county) {
      return
    }

    const landNeighbors = county.neighbors.filter((neighborId) => countyById.has(neighborId))
    if (landNeighbors.length === 0) {
      return
    }

    shuffleInPlace(landNeighbors, random)
    for (let index = 0; index < landNeighbors.length; index += 1) {
      if (tryMergeCounties(county.id, landNeighbors[index])) {
        break
      }
    }
  })

  result.counties = [...countyById.values()]
}

export function generateCounties(
  cells: VoronoiCell[],
  landMassShapes: LandMassShape[],
  config: WorldConfig,
  neighborCellIdsById: Map<string, string[]>,
  random: SeededRandom,
): CountyGenerationResult {
  const counties: County[] = []
  const countyIdsByLandMass = new Map<string, string[]>()
  const countyIdByCellId = new Map<string, string>()
  const cellIdByCountyId = new Map<string, string>()
  const countersByLandMass = new Map<string, number>()
  const landMassById = new Map(landMassShapes.map((landMass) => [landMass.id, landMass]))
  const chosenLandMassByCellId = new Map<string, string>()
  const cellById = new Map(cells.map((cell) => [cell.id, cell]))

  landMassShapes.forEach((shape) => {
    countyIdsByLandMass.set(shape.id, [])
  })

  cells.forEach((cell) => {
    const insideLandMassId = getLandMassIdAtPoint(
      cell.centroid.x,
      cell.centroid.y,
      landMassShapes,
    )

    if (insideLandMassId) {
      chosenLandMassByCellId.set(cell.id, insideLandMassId)
    }
  })

  const targetCountyCount = Math.min(
    cells.length,
    Math.max(1, Math.floor(config.minCountyCount)),
  )

  if (chosenLandMassByCellId.size < targetCountyCount) {
    const oceanCandidates = cells
      .filter((cell) => !chosenLandMassByCellId.has(cell.id))
      .map((cell) => {
        let bestLandMassId = ''
        let bestScore = Number.POSITIVE_INFINITY

        landMassShapes.forEach((landMass) => {
          const normalizedX =
            (cell.centroid.x - landMass.centerX) / Math.max(1e-6, landMass.radiusX)
          const normalizedY =
            (cell.centroid.y - landMass.centerY) / Math.max(1e-6, landMass.radiusY)
          const score = normalizedX * normalizedX + normalizedY * normalizedY

          if (score < bestScore) {
            bestScore = score
            bestLandMassId = landMass.id
          }
        })

        return {
          cell,
          bestLandMassId,
          bestScore,
        }
      })
      .sort((left, right) => {
        if (left.bestScore !== right.bestScore) {
          return left.bestScore - right.bestScore
        }
        return left.cell.id.localeCompare(right.cell.id)
      })

    const needed = targetCountyCount - chosenLandMassByCellId.size
    oceanCandidates.slice(0, needed).forEach((candidate) => {
      chosenLandMassByCellId.set(candidate.cell.id, candidate.bestLandMassId)
    })
  }

  const maxLandCount = Math.floor(cells.length / 3)
  let toRemove = Math.max(0, chosenLandMassByCellId.size - maxLandCount)
  const edgeEpsilon = Math.max(config.width, config.height) * 1e-6

  const getOceanNeighborCount = (cellId: string): number => {
    const neighborCellIds = neighborCellIdsById.get(cellId) ?? []
    let oceanNeighborCount = 0

    for (let index = 0; index < neighborCellIds.length; index += 1) {
      if (!chosenLandMassByCellId.has(neighborCellIds[index])) {
        oceanNeighborCount += 1
      }
    }

    return oceanNeighborCount
  }

  const touchesWorldEdge = (cellId: string): boolean => {
    const cell = cellById.get(cellId)
    if (!cell) {
      return false
    }

    return cell.polygon.some(
      (point) =>
        point.x <= edgeEpsilon ||
        point.x >= config.width - edgeEpsilon ||
        point.y <= edgeEpsilon ||
        point.y >= config.height - edgeEpsilon,
    )
  }

  let edgeRemoved = 1
  while (edgeRemoved > 0) {
    const edgeLandCandidates = [...chosenLandMassByCellId.keys()].filter((cellId) =>
      touchesWorldEdge(cellId),
    )

    edgeRemoved = edgeLandCandidates.length
    edgeLandCandidates.forEach((cellId) => {
      chosenLandMassByCellId.delete(cellId)
    })
  }

  const softMarginPx = config.edgeSoftMargin * Math.min(config.width, config.height)
  if (softMarginPx > 0) {
    const softMarginCandidates = [...chosenLandMassByCellId.keys()]
      .sort()
      .filter((cellId) => {
        const cell = cellById.get(cellId)
        if (!cell) {
          return false
        }

        const d = Math.min(
          cell.centroid.x,
          config.width - cell.centroid.x,
          cell.centroid.y,
          config.height - cell.centroid.y,
        )

        return d < softMarginPx
      })

    softMarginCandidates.forEach((cellId) => {
      const cell = cellById.get(cellId)
      if (!cell) {
        return
      }

      const d = Math.min(
        cell.centroid.x,
        config.width - cell.centroid.x,
        cell.centroid.y,
        config.height - cell.centroid.y,
      )

      const t = 1 - d / softMarginPx
      const removalProb = Math.pow(t, 0.7)

      if (random.float(0, 1) < removalProb) {
        chosenLandMassByCellId.delete(cellId)
      }
    })
  }

  toRemove = Math.max(0, chosenLandMassByCellId.size - maxLandCount)

  while (toRemove > 0 && chosenLandMassByCellId.size > 0) {
    const coastlineCandidates: Array<{
      cellId: string
      oceanNeighborCount: number
    }> = []

    chosenLandMassByCellId.forEach((_landMassId, cellId) => {
      const oceanNeighborCount = getOceanNeighborCount(cellId)

      if (oceanNeighborCount > 0) {
        coastlineCandidates.push({
          cellId,
          oceanNeighborCount,
        })
      }
    })

    if (coastlineCandidates.length === 0) {
      break
    }

    coastlineCandidates
      .sort((left, right) => {
        if (left.oceanNeighborCount !== right.oceanNeighborCount) {
          return right.oceanNeighborCount - left.oceanNeighborCount
        }

        return left.cellId.localeCompare(right.cellId)
      })
      .slice(0, toRemove)
      .forEach((candidate) => {
        chosenLandMassByCellId.delete(candidate.cellId)
      })

    toRemove = Math.max(0, chosenLandMassByCellId.size - maxLandCount)
  }

  cells.forEach((cell) => {
    const landMassId = chosenLandMassByCellId.get(cell.id)

    if (!landMassId) {
      return
    }

    const sequence = (countersByLandMass.get(landMassId) ?? 0) + 1
    countersByLandMass.set(landMassId, sequence)

    const id = `county-${landMassId}-${sequence}`

    counties.push({
      id,
      name: `County ${counties.length + 1}`,
      polygon: cell.polygon,
      centroid: cell.centroid,
      area: cell.area,
      neighbors: [],
      landMassId,
    })

    countyIdsByLandMass.get(landMassId)?.push(id)
    countyIdByCellId.set(cell.id, id)
    cellIdByCountyId.set(id, cell.id)

    const landMass = landMassById.get(landMassId)
    if (landMass) {
      landMass.targetCountyCount = Math.max(
        landMass.targetCountyCount,
        countyIdsByLandMass.get(landMassId)?.length ?? 0,
      )
    }
  })

  return {
    counties,
    countyIdsByLandMass,
    countyIdByCellId,
    cellIdByCountyId,
  }
}
