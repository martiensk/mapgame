import type { SeaZone } from '../types/world'
import type { Point } from '../types/world'
import { mergeAdjacentPolygons } from '../geometry/polygon'
import type { SeededRandom } from './random'
import type { VoronoiCell } from './voronoi'

export interface SeaZoneGenerationResult {
  seaZones: SeaZone[]
  seaZoneIdByCellId: Map<string, string>
  cellIdBySeaZoneId: Map<string, string>
}

export interface SeaZoneMergeDiagnostics {
  mergeAttempts: number
  disconnectedMergeRejects: number
  areaCoverageRejects: number
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

const MAX_SEA_ZONE_MEMBER_COUNT = 4

function polygonPerimeter(polygon: Point[]): number {
  if (polygon.length < 2) {
    return 0
  }

  let perimeter = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    perimeter += Math.hypot(next.x - current.x, next.y - current.y)
  }

  return perimeter
}

function shapeCompactness(area: number, perimeter: number): number {
  if (area <= 0 || perimeter <= 0) {
    return 0
  }

  return (4 * Math.PI * area) / (perimeter * perimeter)
}

function safeAreaRatio(a: number, b: number): number {
  const maxArea = Math.max(a, b)
  if (maxArea <= 0) {
    return 0
  }

  return Math.min(a, b) / maxArea
}

export function mergeCoastalSeaZonesPhase(
  result: SeaZoneGenerationResult,
  random: SeededRandom,
): SeaZoneMergeDiagnostics {
  const diagnostics: SeaZoneMergeDiagnostics = {
    mergeAttempts: 0,
    disconnectedMergeRejects: 0,
    areaCoverageRejects: 0,
  }

  const seaZoneById = new Map(result.seaZones.map((zone) => [zone.id, zone]))
  const zoneMemberCountById = new Map<string, number>(
    result.seaZones.map((zone) => [zone.id, 1]),
  )
  const absorberToSurvivorId = new Map<string, string>()
  const toRemove = new Set<string>()

  interface SectorState {
    id: string
    survivorId: string
    memberIds: Set<string>
  }

  const sectors = new Map<string, SectorState>()
  const zoneIdToSectorId = new Map<string, string>()

  const shuffleInPlace = <T>(values: T[]): void => {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const swapIndex = random.int(0, index)
      const tmp = values[index]
      values[index] = values[swapIndex]
      values[swapIndex] = tmp
    }
  }

  const computeLayerByZoneId = (): Map<string, number> => {
    const layerByZoneId = new Map<string, number>()
    const queue: string[] = []

    result.seaZones.forEach((zone) => {
      if (zone.coastalCountyIds.length > 0) {
        layerByZoneId.set(zone.id, 1)
        queue.push(zone.id)
      }
    })

    let queueIndex = 0
    while (queueIndex < queue.length) {
      const currentId = queue[queueIndex]
      queueIndex += 1

      const currentLayer = layerByZoneId.get(currentId)
      const currentZone = seaZoneById.get(currentId)
      if (!currentLayer || !currentZone) {
        continue
      }

      currentZone.neighbors.forEach((neighborId) => {
        if (!seaZoneById.has(neighborId) || layerByZoneId.has(neighborId)) {
          return
        }

        layerByZoneId.set(neighborId, currentLayer + 1)
        queue.push(neighborId)
      })
    }

    return layerByZoneId
  }

  const mergeIntoSectorSurvivor = (
    sectorId: string,
    absorberIds: string[],
    survivorOverrideId?: string,
  ): string[] => {
    const sector = sectors.get(sectorId)
    if (!sector || absorberIds.length === 0) {
      return []
    }

    const survivorId = survivorOverrideId ?? sector.survivorId
    if (toRemove.has(survivorId) || absorberToSurvivorId.has(survivorId)) {
      return []
    }
    const survivor = seaZoneById.get(survivorId)
    if (!survivor) {
      return []
    }
    let survivorMemberCount = zoneMemberCountById.get(survivor.id) ?? 1
    if (survivorMemberCount >= MAX_SEA_ZONE_MEMBER_COUNT) {
      return []
    }

    const candidateIds = absorberIds.filter(
      (absorberId) =>
        absorberId !== survivor.id &&
        !toRemove.has(absorberId) &&
        !absorberToSurvivorId.has(absorberId),
    )
    if (candidateIds.length === 0) {
      return []
    }

    const absorbedIds: string[] = []
    const minimumSharedEdgeLength = 1e-6
    const allCoastalIds = new Set(survivor.coastalCountyIds)
    const allNeighbors = new Set(survivor.neighbors)

    candidateIds.forEach((absorberId) => {
      const absorber = seaZoneById.get(absorberId)
      if (!absorber) {
        return
      }
      const absorberMemberCount = zoneMemberCountById.get(absorber.id) ?? 1
      if (survivorMemberCount + absorberMemberCount > MAX_SEA_ZONE_MEMBER_COUNT) {
        return
      }

      diagnostics.mergeAttempts += 1
      const mergedPolygon = mergeAdjacentPolygons(
        survivor.polygon,
        absorber.polygon,
        minimumSharedEdgeLength,
      )
      if (!mergedPolygon) {
        diagnostics.disconnectedMergeRejects += 1
        return
      }

      const mergedArea = survivor.area + absorber.area
      const weightedSurvivorArea = survivor.area / Math.max(1e-6, mergedArea)
      const weightedAbsorberArea = absorber.area / Math.max(1e-6, mergedArea)

      survivor.polygon = mergedPolygon
      survivor.area = mergedArea
      survivor.centroid = {
        x:
          survivor.centroid.x * weightedSurvivorArea +
          absorber.centroid.x * weightedAbsorberArea,
        y:
          survivor.centroid.y * weightedSurvivorArea +
          absorber.centroid.y * weightedAbsorberArea,
      }
      survivorMemberCount += absorberMemberCount
      zoneMemberCountById.set(survivor.id, survivorMemberCount)

      absorbedIds.push(absorberId)

      toRemove.add(absorberId)
      absorberToSurvivorId.set(absorberId, survivor.id)
      zoneIdToSectorId.set(absorberId, sector.id)
      sector.memberIds.add(absorberId)

      absorber.coastalCountyIds.forEach((id) => allCoastalIds.add(id))
      absorber.neighbors.forEach((id) => {
        if (id !== survivor.id && !toRemove.has(id)) {
          allNeighbors.add(id)
        }
      })
    })

    if (absorbedIds.length === 0) {
      return []
    }

    survivor.coastalCountyIds = [...allCoastalIds]
    survivor.neighbors = unique(
      [...allNeighbors]
        .map((id) => absorberToSurvivorId.get(id) ?? id)
        .filter((id) => id !== survivor.id),
    )

    return absorbedIds
  }

  const layerByZoneId = computeLayerByZoneId()
  const maxLayer = [...layerByZoneId.values()].reduce(
    (max, layer) => Math.max(max, layer),
    0,
  )
  if (maxLayer === 0) {
    return diagnostics
  }

  // Build layer-1 sectors from coastal chains and merge each chain into one sector survivor.
  const unassignedCoastal = new Set<string>()
  result.seaZones.forEach((zone) => {
    if (layerByZoneId.get(zone.id) === 1) {
      unassignedCoastal.add(zone.id)
    }
  })

  while (unassignedCoastal.size > 0) {
    const coastalCandidates = [...unassignedCoastal]
    shuffleInPlace(coastalCandidates)
    const startId = coastalCandidates[0]
    const targetChainLength = 3 + random.int(0, 1)

    const chain: string[] = [startId]
    unassignedCoastal.delete(startId)
    let currentId = startId

    while (chain.length < targetChainLength) {
      const currentZone = seaZoneById.get(currentId)
      if (!currentZone) {
        break
      }

      const currentCoastalIds = new Set(currentZone.coastalCountyIds)
      const layerOneNeighbors = currentZone.neighbors.filter(
        (neighborId) =>
          unassignedCoastal.has(neighborId) && layerByZoneId.get(neighborId) === 1,
      )
      if (layerOneNeighbors.length === 0) {
        break
      }

      const rankedNeighbors = layerOneNeighbors
        .map((neighborId) => {
          const neighbor = seaZoneById.get(neighborId)
          const sharedCoastalCount = (neighbor?.coastalCountyIds ?? []).reduce(
            (sum, countyId) => sum + (currentCoastalIds.has(countyId) ? 1 : 0),
            0,
          )
          return {
            neighborId,
            sharedCoastalCount,
            coastalDegree: neighbor?.coastalCountyIds.length ?? 0,
          }
        })
        .sort((a, b) => {
          if (a.sharedCoastalCount !== b.sharedCoastalCount) {
            return b.sharedCoastalCount - a.sharedCoastalCount
          }
          if (a.coastalDegree !== b.coastalDegree) {
            return b.coastalDegree - a.coastalDegree
          }
          return a.neighborId.localeCompare(b.neighborId)
        })

      const nextId = rankedNeighbors[0].neighborId
      chain.push(nextId)
      unassignedCoastal.delete(nextId)
      currentId = nextId
    }

    const survivorId = chain[0]
    const sector: SectorState = {
      id: survivorId,
      survivorId,
      memberIds: new Set(chain),
    }

    sectors.set(sector.id, sector)
    chain.forEach((zoneId) => {
      zoneIdToSectorId.set(zoneId, sector.id)
    })

    mergeIntoSectorSurvivor(sector.id, chain.slice(1))
  }

  // Expand persistent sectors outward by graph-distance layer from coast.
  // Deeper outward merging keeps far-ocean zones from staying tiny compared to coastal zones.
  const lastMergedLayer = maxLayer
  for (let layer = 2; layer <= lastMergedLayer; layer += 1) {
    const layerZones = result.seaZones
      .map((zone) => zone.id)
      .filter(
        (zoneId) =>
          layerByZoneId.get(zoneId) === layer &&
          !zoneIdToSectorId.has(zoneId) &&
          !toRemove.has(zoneId),
      )

    const assignmentsBySectorId = new Map<string, string[]>()

    layerZones.forEach((zoneId) => {
      const zone = seaZoneById.get(zoneId)
      if (!zone) {
        return
      }

      const scoresBySectorId = new Map<string, number>()
      zone.neighbors.forEach((neighborId) => {
        if (layerByZoneId.get(neighborId) !== layer - 1) {
          return
        }

        const sectorId = zoneIdToSectorId.get(neighborId)
        if (!sectorId) {
          return
        }

        scoresBySectorId.set(sectorId, (scoresBySectorId.get(sectorId) ?? 0) + 1)
      })

      if (scoresBySectorId.size === 0) {
        return
      }

      const winner = [...scoresBySectorId.entries()].sort((a, b) => {
        if (a[1] !== b[1]) {
          return b[1] - a[1]
        }
        return a[0].localeCompare(b[0])
      })[0][0]

      if (!assignmentsBySectorId.has(winner)) {
        assignmentsBySectorId.set(winner, [])
      }
      assignmentsBySectorId.get(winner)?.push(zoneId)
    })

    assignmentsBySectorId.forEach((zoneIds, sectorId) => {
      const activeZoneIds = zoneIds.filter(
        (zoneId) => !toRemove.has(zoneId) && !absorberToSurvivorId.has(zoneId),
      )
      if (activeZoneIds.length === 0) {
        return
      }

      const absorbContiguousLayerCandidates = (
        survivorId: string,
        candidateIds: string[],
        maxAbsorbCount: number,
      ): string[] => {
        const absorbedAll: string[] = []
        const remaining = new Set(candidateIds)
        let frontier = [survivorId]

        while (frontier.length > 0 && remaining.size > 0) {
          if (absorbedAll.length >= maxAbsorbCount) {
            break
          }

          const contiguousBatch = new Set<string>()

          frontier.forEach((frontierId) => {
            const frontierZone = seaZoneById.get(frontierId)
            if (!frontierZone) {
              return
            }

            frontierZone.neighbors.forEach((neighborId) => {
              if (!remaining.has(neighborId)) {
                return
              }
              contiguousBatch.add(neighborId)
            })
          })

          if (contiguousBatch.size === 0) {
            break
          }

          const remainingCapacity = maxAbsorbCount - absorbedAll.length
          const boundedBatch = [...contiguousBatch]
            .sort((a, b) => a.localeCompare(b))
            .slice(0, remainingCapacity)

          if (boundedBatch.length === 0) {
            break
          }

          const absorbedIds = mergeIntoSectorSurvivor(
            sectorId,
            boundedBatch,
            survivorId,
          )
          absorbedIds.forEach((zoneId) => {
            remaining.delete(zoneId)
            zoneIdToSectorId.set(zoneId, sectorId)
          })
          absorbedAll.push(...absorbedIds)
          frontier = absorbedIds
        }

        return absorbedAll
      }

      // Reserve ownership of this layer's assignment so extra passes do not steal
      // zones from other sectors while processing order iterates.
      activeZoneIds.forEach((zoneId) => {
        zoneIdToSectorId.set(zoneId, sectorId)
      })

      // Keep layer bands distinct: merge assigned zones into a survivor from this same layer,
      // rather than absorbing outward layers directly into the coastal (layer-1) survivor.
      const layerSurvivorId = [...activeZoneIds].sort((a, b) => {
        const aArea = seaZoneById.get(a)?.area ?? 0
        const bArea = seaZoneById.get(b)?.area ?? 0
        if (aArea !== bArea) {
          return bArea - aArea
        }
        return a.localeCompare(b)
      })[0]

      const deepLayerMergeFraction =
        layer >= 9 ? 0.25 : layer >= 6 ? 0.25 : 1
      const assignedCandidateCount = activeZoneIds.length - 1
      const maxAbsorbFromAssigned = Math.max(
        0,
        Math.floor(assignedCandidateCount * deepLayerMergeFraction),
      )
      const absorbedIds = absorbContiguousLayerCandidates(
        layerSurvivorId,
        activeZoneIds.filter((zoneId) => zoneId !== layerSurvivorId),
        maxAbsorbFromAssigned,
      )

      zoneIdToSectorId.set(layerSurvivorId, sectorId)

      // Deeper layers get extra same-layer growth passes so outer bands become thicker.
      let frontier = [layerSurvivorId, ...absorbedIds]
      const extraGrowthPasses =
        layer >= 9 ? 1 : layer >= 6 ? 0 : Math.min(3, Math.max(0, layer - 1))

      for (let pass = 0; pass < extraGrowthPasses && frontier.length > 0; pass += 1) {
        const candidates = new Set<string>()

        frontier.forEach((frontierId) => {
          const frontierZone = seaZoneById.get(frontierId)
          if (!frontierZone) {
            return
          }

          frontierZone.neighbors.forEach((neighborId) => {
            if (
              layerByZoneId.get(neighborId) !== layer ||
              (zoneIdToSectorId.has(neighborId) &&
                zoneIdToSectorId.get(neighborId) !== sectorId) ||
              toRemove.has(neighborId) ||
              absorberToSurvivorId.has(neighborId)
            ) {
              return
            }

            candidates.add(neighborId)
          })
        })

        if (candidates.size === 0) {
          frontier = []
          continue
        }

        const passAbsorbedIds = absorbContiguousLayerCandidates(
          layerSurvivorId,
          [...candidates],
          layer >= 9
            ? Math.max(1, Math.floor(candidates.size * 0.25))
            : layer >= 6
              ? Math.max(1, Math.floor(candidates.size * 0.2))
              : candidates.size,
        )

        frontier = passAbsorbedIds
      }
    })
  }

  // Consolidate deepest ocean (layer 9+) with an additional non-ring merge pass.
  // This intentionally relaxes ring structure in the far ocean to create larger deep zones.
  const deepestLayer = 9
  const deepZoneIds = new Set(
    result.seaZones
      .map((zone) => zone.id)
      .filter(
        (zoneId) =>
          (layerByZoneId.get(zoneId) ?? 1) >= deepestLayer &&
          !toRemove.has(zoneId) &&
          !absorberToSurvivorId.has(zoneId),
      ),
  )

  const deepUnvisited = new Set(deepZoneIds)
  while (deepUnvisited.size > 0) {
    const startId = [...deepUnvisited][0]
    const component: string[] = []
    const queue: string[] = [startId]
    deepUnvisited.delete(startId)
    let queueIndex = 0

    while (queueIndex < queue.length) {
      const currentId = queue[queueIndex]
      queueIndex += 1
      component.push(currentId)

      const current = seaZoneById.get(currentId)
      if (!current) {
        continue
      }

      current.neighbors.forEach((neighborId) => {
        if (!deepZoneIds.has(neighborId) || !deepUnvisited.has(neighborId)) {
          return
        }

        deepUnvisited.delete(neighborId)
        component.push(neighborId)
        queue.push(neighborId)
      })
    }

    if (component.length <= 1) {
      continue
    }

    // Process very deep ocean in local contiguous clusters to avoid creating
    // a single oversized zone inside a large deep-ocean component.
    const componentUnassigned = new Set(component)
    const maxClusterSize = 28

    while (componentUnassigned.size > 0) {
      const clusterStartId = [...componentUnassigned][0]
      const cluster: string[] = [clusterStartId]
      const clusterQueue: string[] = [clusterStartId]
      componentUnassigned.delete(clusterStartId)
      let clusterQueueIndex = 0

      while (
        clusterQueueIndex < clusterQueue.length &&
        cluster.length < maxClusterSize
      ) {
        const currentId = clusterQueue[clusterQueueIndex]
        clusterQueueIndex += 1

        const current = seaZoneById.get(currentId)
        if (!current) {
          continue
        }

        current.neighbors.forEach((neighborId) => {
          if (!componentUnassigned.has(neighborId)) {
            return
          }

          componentUnassigned.delete(neighborId)
          cluster.push(neighborId)
          clusterQueue.push(neighborId)
        })
      }

      if (cluster.length <= 1) {
        continue
      }

      const survivorId = [...cluster].sort((a, b) => {
        const aArea = seaZoneById.get(a)?.area ?? 0
        const bArea = seaZoneById.get(b)?.area ?? 0
        if (aArea !== bArea) {
          return bArea - aArea
        }
        return a.localeCompare(b)
      })[0]

      const deepSectorId = `deep-${survivorId}`
      sectors.set(deepSectorId, {
        id: deepSectorId,
        survivorId,
        memberIds: new Set(cluster),
      })

      const absorberCandidates = cluster.filter((zoneId) => zoneId !== survivorId)
      if (absorberCandidates.length < 6) {
        continue
      }

      const absorbCount = Math.max(1, Math.floor(absorberCandidates.length * 0.1))
      const remaining = new Set(absorberCandidates)
      const selectedAbsorbers: string[] = []
      let frontier = [survivorId]

      while (frontier.length > 0 && selectedAbsorbers.length < absorbCount) {
        const contiguousCandidates = new Set<string>()

        frontier.forEach((frontierId) => {
          const frontierZone = seaZoneById.get(frontierId)
          if (!frontierZone) {
            return
          }

          frontierZone.neighbors.forEach((neighborId) => {
            if (!remaining.has(neighborId)) {
              return
            }
            contiguousCandidates.add(neighborId)
          })
        })

        if (contiguousCandidates.size === 0) {
          break
        }

        const nextBatch = [...contiguousCandidates]
        shuffleInPlace(nextBatch)

        const batchCapacity = absorbCount - selectedAbsorbers.length
        const chosen = nextBatch.slice(0, batchCapacity)
        chosen.forEach((zoneId) => {
          remaining.delete(zoneId)
        })

        selectedAbsorbers.push(...chosen)
        frontier = chosen
      }

      if (selectedAbsorbers.length === 0) {
        continue
      }

      const absorbedIds = mergeIntoSectorSurvivor(
        deepSectorId,
        selectedAbsorbers,
        survivorId,
      )

      zoneIdToSectorId.set(survivorId, deepSectorId)
      absorbedIds.forEach((zoneId) => {
        zoneIdToSectorId.set(zoneId, deepSectorId)
        deepZoneIds.delete(zoneId)
      })
    }
  }

  // Final cleanup: merge tiny leftover deep zones into neighboring deep survivors
  // to reduce isolated single-cell blocks in the far ocean.
  const maxCleanupRounds = 1
  const maxCleanupMergesPerRound = 20
  for (let cleanupRound = 0; cleanupRound < maxCleanupRounds; cleanupRound += 1) {
    const activeDeepIds = [...deepZoneIds].filter(
      (zoneId) => !toRemove.has(zoneId) && !absorberToSurvivorId.has(zoneId),
    )
    const avgDeepArea =
      activeDeepIds.length > 0
        ? activeDeepIds.reduce(
            (sum, zoneId) => sum + (seaZoneById.get(zoneId)?.area ?? 0),
            0,
          ) / activeDeepIds.length
        : 0

    if (avgDeepArea <= 0) {
      break
    }

    const cleanupCandidates = [...activeDeepIds].sort((a, b) => {
      const aArea = seaZoneById.get(a)?.area ?? 0
      const bArea = seaZoneById.get(b)?.area ?? 0
      return aArea - bArea
    })

    let cleanupMergeCount = 0

    for (const zoneId of cleanupCandidates) {
      if (cleanupMergeCount >= maxCleanupMergesPerRound) {
        break
      }
      if (toRemove.has(zoneId) || absorberToSurvivorId.has(zoneId)) {
        continue
      }

      const zone = seaZoneById.get(zoneId)
      if (!zone || zone.area >= avgDeepArea * 0.9) {
        continue
      }

      const deepNeighbors = zone.neighbors
        .filter(
          (neighborId) =>
            neighborId !== zoneId &&
            deepZoneIds.has(neighborId) &&
            !toRemove.has(neighborId) &&
            !absorberToSurvivorId.has(neighborId),
        )
        .sort((leftId, rightId) => {
          const leftArea = seaZoneById.get(leftId)?.area ?? 0
          const rightArea = seaZoneById.get(rightId)?.area ?? 0
          if (leftArea !== rightArea) {
            return leftArea - rightArea
          }
          return leftId.localeCompare(rightId)
        })

      if (deepNeighbors.length === 0) {
        continue
      }
      if (deepNeighbors.length > 3) {
        continue
      }

      const survivorId = deepNeighbors[0]
      const cleanupSectorId = `deep-clean-${survivorId}`
      if (!sectors.has(cleanupSectorId)) {
        sectors.set(cleanupSectorId, {
          id: cleanupSectorId,
          survivorId,
          memberIds: new Set<string>([survivorId]),
        })
      }

      const absorbedIds = mergeIntoSectorSurvivor(
        cleanupSectorId,
        [zoneId],
        survivorId,
      )
      if (absorbedIds.length === 0) {
        continue
      }

      absorbedIds.forEach((absorbedId) => {
        zoneIdToSectorId.set(absorbedId, cleanupSectorId)
        deepZoneIds.delete(absorbedId)
      })
      zoneIdToSectorId.set(survivorId, cleanupSectorId)
      cleanupMergeCount += absorbedIds.length
    }

    if (cleanupMergeCount === 0) {
      break
    }
  }

  const activeZoneIds = (): string[] =>
    result.seaZones
      .map((zone) => zone.id)
      .filter(
        (zoneId) => !toRemove.has(zoneId) && !absorberToSurvivorId.has(zoneId),
      )

  const minimumExpectedMerges = Math.max(1, Math.floor(result.seaZones.length * 0.02))
  if (toRemove.size < minimumExpectedMerges) {
    const fallbackTargetCount = Math.max(1, Math.floor(activeZoneIds().length * 0.9))
    const maxFallbackRounds = 6

    for (let round = 0; round < maxFallbackRounds; round += 1) {
      const ids = activeZoneIds()
      if (ids.length <= fallbackTargetCount) {
        break
      }

      shuffleInPlace(ids)
      let mergedInRound = false

      for (let index = 0; index < ids.length; index += 1) {
        const survivorId = ids[index]
        if (toRemove.has(survivorId) || absorberToSurvivorId.has(survivorId)) {
          continue
        }

        const survivor = seaZoneById.get(survivorId)
        if (!survivor) {
          continue
        }
        const survivorMemberCount = zoneMemberCountById.get(survivor.id) ?? 1
        if (survivorMemberCount >= MAX_SEA_ZONE_MEMBER_COUNT) {
          continue
        }

        const neighborIds = survivor.neighbors.filter(
          (neighborId) =>
            neighborId !== survivorId &&
            !toRemove.has(neighborId) &&
            !absorberToSurvivorId.has(neighborId) &&
            seaZoneById.has(neighborId),
        )

        if (neighborIds.length === 0) {
          continue
        }

        let bestAbsorberId = ''
        let bestScore = Number.NEGATIVE_INFINITY

        for (let neighborIndex = 0; neighborIndex < neighborIds.length; neighborIndex += 1) {
          const absorberId = neighborIds[neighborIndex]
          const absorber = seaZoneById.get(absorberId)
          if (!absorber) {
            continue
          }
          const absorberMemberCount = zoneMemberCountById.get(absorber.id) ?? 1
          if (survivorMemberCount + absorberMemberCount > MAX_SEA_ZONE_MEMBER_COUNT) {
            continue
          }

          const mergedPolygon = mergeAdjacentPolygons(
            survivor.polygon,
            absorber.polygon,
            1e-6,
          )
          if (!mergedPolygon) {
            continue
          }

          const mergedArea = survivor.area + absorber.area
          const mergedPerimeter = polygonPerimeter(mergedPolygon)
          const mergedCompactness = shapeCompactness(mergedArea, mergedPerimeter)
          const survivorPerimeter = polygonPerimeter(survivor.polygon)
          const absorberPerimeter = polygonPerimeter(absorber.polygon)
          const survivorCompactness = shapeCompactness(survivor.area, survivorPerimeter)
          const absorberCompactness = shapeCompactness(absorber.area, absorberPerimeter)
          const weightedInputCompactness =
            (survivorCompactness * survivor.area + absorberCompactness * absorber.area) /
            Math.max(1e-6, survivor.area + absorber.area)
          const compactnessGain = mergedCompactness - weightedInputCompactness

          const centroidDistance = Math.hypot(
            survivor.centroid.x - absorber.centroid.x,
            survivor.centroid.y - absorber.centroid.y,
          )
          const centroidDistanceNormalized =
            centroidDistance / Math.max(1e-6, Math.sqrt(mergedArea))
          const areaBalance = safeAreaRatio(survivor.area, absorber.area)

          const score =
            mergedCompactness * 2.4 +
            compactnessGain * 2.1 +
            areaBalance * 0.9 -
            centroidDistanceNormalized * 0.7

          if (score > bestScore) {
            bestScore = score
            bestAbsorberId = absorberId
          }
        }

        if (!bestAbsorberId) {
          continue
        }

        const fallbackSectorId = `fallback-${survivorId}`
        if (!sectors.has(fallbackSectorId)) {
          sectors.set(fallbackSectorId, {
            id: fallbackSectorId,
            survivorId,
            memberIds: new Set<string>([survivorId]),
          })
        }
        zoneIdToSectorId.set(survivorId, fallbackSectorId)

        const absorbedIds = mergeIntoSectorSurvivor(
          fallbackSectorId,
          [bestAbsorberId],
          survivorId,
        )

        if (absorbedIds.length > 0) {
          mergedInRound = true
          absorbedIds.forEach((absorbedId) => {
            zoneIdToSectorId.set(absorbedId, fallbackSectorId)
          })
        }

        if (activeZoneIds().length <= fallbackTargetCount) {
          break
        }
      }

      if (!mergedInRound) {
        break
      }
    }
  }

  // Remove absorbed zones from result by filtering in-place
  let removeIndex = 0
  for (let i = 0; i < result.seaZones.length; i++) {
    if (!toRemove.has(result.seaZones[i].id)) {
      result.seaZones[removeIndex] = result.seaZones[i]
      removeIndex++
    }
  }
  result.seaZones.length = removeIndex

  result.seaZones.forEach((zone) => {
    zone.neighbors = unique(
      zone.neighbors
        .map((neighborId) => absorberToSurvivorId.get(neighborId) ?? neighborId)
        .filter((neighborId) => neighborId !== zone.id && !toRemove.has(neighborId)),
    )
  })

  // Update mappings for removed zones
  toRemove.forEach((absorberId) => {
    const survivorId = absorberToSurvivorId.get(absorberId)
    if (!survivorId) {
      return
    }

    // Update all cell mappings that pointed to absorbed zone
    result.seaZoneIdByCellId.forEach((zoneId, cellId) => {
      if (zoneId === absorberId) {
        result.seaZoneIdByCellId.set(cellId, survivorId)
      }
    })

    // Update the survivor's representative cell mapping to include absorbed cells
    const cellId = result.cellIdBySeaZoneId.get(absorberId)
    if (cellId) {
      // Map absorbed cell to survivor
      result.seaZoneIdByCellId.set(cellId, survivorId)
    }

    // Remove absorbed zone from mappings
    result.cellIdBySeaZoneId.delete(absorberId)
  })

  return diagnostics
}

export function generateSeaZones(
  cells: VoronoiCell[],
  countyIdByCellId: Map<string, string>,
): SeaZoneGenerationResult {
  const seaZones: SeaZone[] = []
  const seaZoneIdByCellId = new Map<string, string>()
  const cellIdBySeaZoneId = new Map<string, string>()

  cells.forEach((cell) => {
    if (countyIdByCellId.has(cell.id)) {
      return
    }

    const id = `sea-zone-${seaZones.length + 1}`
    seaZones.push({
      id,
      polygon: cell.polygon,
      centroid: cell.centroid,
      area: cell.area,
      neighbors: [],
      coastalCountyIds: [],
      biomeId: 'ocean',
      climateId: 'temperate',
      elevation: 0,
      temperatureBase: 0,
      temperatureGlobalModifier: 0,
      temperatureBiomeModifier: 0,
      temperature: 0,
      moisture: 1,
    })

    seaZoneIdByCellId.set(cell.id, id)
    cellIdBySeaZoneId.set(id, cell.id)
  })

  return {
    seaZones,
    seaZoneIdByCellId,
    cellIdBySeaZoneId,
  }
}
