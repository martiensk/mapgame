import type { SeaZone } from '../types/world'
import type { Point } from '../types/world'
import { polygonArea } from '../geometry/polygon'
import type { SeededRandom } from './random'
import type { VoronoiCell } from './voronoi'

export interface SeaZoneGenerationResult {
  seaZones: SeaZone[]
  seaZoneIdByCellId: Map<string, string>
  cellIdBySeaZoneId: Map<string, string>
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function mergeZoneGeometry(
  survivor: SeaZone,
  absorbers: SeaZone[],
): {
  polygon: SeaZone['polygon']
  absorbedIds: string[]
  area: number
  centroid: SeaZone['centroid']
} {
  const allZones = [survivor, ...absorbers]
  const epsilonDigits = 6
  const totalArea = allZones.reduce((sum, zone) => sum + zone.area, 0)
  let weightedX = 0
  let weightedY = 0

  allZones.forEach((zone) => {
    const weight = zone.area / Math.max(1e-6, totalArea)
    weightedX += zone.centroid.x * weight
    weightedY += zone.centroid.y * weight
  })

  const pointKey = (point: Point): string =>
    `${point.x.toFixed(epsilonDigits)},${point.y.toFixed(epsilonDigits)}`

  const pointByKey = new Map<string, Point>()
  const edgeCount = new Map<string, number>()

  allZones.forEach((zone) => {
    const polygon = zone.polygon
    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index]
      const b = polygon[(index + 1) % polygon.length]
      const keyA = pointKey(a)
      const keyB = pointKey(b)

      pointByKey.set(keyA, a)
      pointByKey.set(keyB, b)

      const undirectedKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`
      edgeCount.set(undirectedKey, (edgeCount.get(undirectedKey) ?? 0) + 1)
    }
  })

  const adjacency = new Map<string, Set<string>>()
  edgeCount.forEach((count, edgeKey) => {
    if (count !== 1) {
      return
    }

    const [left, right] = edgeKey.split('|')
    if (!adjacency.has(left)) {
      adjacency.set(left, new Set<string>())
    }
    if (!adjacency.has(right)) {
      adjacency.set(right, new Set<string>())
    }
    adjacency.get(left)?.add(right)
    adjacency.get(right)?.add(left)
  })

  const visitedDirected = new Set<string>()
  const loops: SeaZone['polygon'][] = []

  const edgeId = (from: string, to: string): string => `${from}>${to}`

  adjacency.forEach((neighbors, start) => {
    neighbors.forEach((firstNeighbor) => {
      if (visitedDirected.has(edgeId(start, firstNeighbor))) {
        return
      }

      const loopKeys: string[] = [start]
      let previous = start
      let current = firstNeighbor

      visitedDirected.add(edgeId(start, firstNeighbor))

      while (current !== start) {
        loopKeys.push(current)
        const currentNeighbors = [...(adjacency.get(current) ?? new Set<string>())]

        if (currentNeighbors.length === 0) {
          break
        }

        let next = ''
        if (currentNeighbors.length === 1) {
          next = currentNeighbors[0]
        } else {
          next = currentNeighbors[0] === previous ? currentNeighbors[1] : currentNeighbors[0]
        }

        if (!next) {
          break
        }

        visitedDirected.add(edgeId(current, next))
        previous = current
        current = next
      }

      if (current !== start || loopKeys.length < 3) {
        return
      }

      const loop: SeaZone['polygon'] = loopKeys
        .map((key) => pointByKey.get(key))
        .filter((point): point is Point => Boolean(point))

      if (loop.length >= 3) {
        loops.push(loop)
      }
    })
  })

  if (loops.length === 0) {
    return {
      polygon: survivor.polygon,
      absorbedIds: [],
      area: survivor.area,
      centroid: survivor.centroid,
    }
  }

  const largestLoop = loops.sort((a, b) => polygonArea(b) - polygonArea(a))[0]

  return {
    polygon: largestLoop,
    absorbedIds: absorbers.map((zone) => zone.id),
    area: totalArea,
    centroid: { x: weightedX, y: weightedY },
  }
}

export function mergeCoastalSeaZonesPhase(
  result: SeaZoneGenerationResult,
  random: SeededRandom,
): void {
  const seaZoneById = new Map(result.seaZones.map((zone) => [zone.id, zone]))
  const allPoints = result.seaZones.flatMap((zone) => zone.polygon)
  const minX = allPoints.reduce((min, point) => Math.min(min, point.x), Infinity)
  const maxX = allPoints.reduce((max, point) => Math.max(max, point.x), -Infinity)
  const minY = allPoints.reduce((min, point) => Math.min(min, point.y), Infinity)
  const maxY = allPoints.reduce((max, point) => Math.max(max, point.y), -Infinity)
  const edgeEpsilon = 1e-4

  const borderZoneIds = new Set(
    result.seaZones
      .filter((zone) =>
        zone.polygon.some(
          (point) =>
            Math.abs(point.x - minX) <= edgeEpsilon ||
            Math.abs(point.x - maxX) <= edgeEpsilon ||
            Math.abs(point.y - minY) <= edgeEpsilon ||
            Math.abs(point.y - maxY) <= edgeEpsilon,
        ),
      )
      .map((zone) => zone.id),
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
    if (borderZoneIds.has(survivorId)) {
      return []
    }
    const survivor = seaZoneById.get(survivorId)
    if (!survivor) {
      return []
    }

    const candidateIds = absorberIds.filter(
      (absorberId) =>
        absorberId !== survivor.id &&
        !toRemove.has(absorberId) &&
        !absorberToSurvivorId.has(absorberId) &&
        !borderZoneIds.has(absorberId),
    )
    if (candidateIds.length === 0) {
      return []
    }

    const absorberZones: SeaZone[] = []
    candidateIds.forEach((absorberId) => {
      const absorber = seaZoneById.get(absorberId)
      if (absorber) {
        absorberZones.push(absorber)
      }
    })

    const mergedGeometry = mergeZoneGeometry(survivor, absorberZones)
    if (mergedGeometry.absorbedIds.length === 0) {
      return []
    }

    const candidateSet = new Set(mergedGeometry.absorbedIds)
    const allCoastalIds = new Set(survivor.coastalCountyIds)
    const allNeighbors = new Set(survivor.neighbors)

    mergedGeometry.absorbedIds.forEach((absorberId) => {
      const absorber = seaZoneById.get(absorberId)
      if (!absorber) {
        return
      }

      toRemove.add(absorberId)
      absorberToSurvivorId.set(absorberId, survivor.id)
      zoneIdToSectorId.set(absorberId, sector.id)
      sector.memberIds.add(absorberId)

      absorber.coastalCountyIds.forEach((id) => allCoastalIds.add(id))
      absorber.neighbors.forEach((id) => {
        if (id !== survivor.id && !candidateSet.has(id) && !toRemove.has(id)) {
          allNeighbors.add(id)
        }
      })
    })

    survivor.polygon = mergedGeometry.polygon
    survivor.area = mergedGeometry.area
    survivor.centroid = mergedGeometry.centroid
    survivor.coastalCountyIds = [...allCoastalIds]
    survivor.neighbors = unique(
      [...allNeighbors]
        .map((id) => absorberToSurvivorId.get(id) ?? id)
        .filter((id) => id !== survivor.id),
    )

    return mergedGeometry.absorbedIds
  }

  const layerByZoneId = computeLayerByZoneId()
  const maxLayer = [...layerByZoneId.values()].reduce(
    (max, layer) => Math.max(max, layer),
    0,
  )
  if (maxLayer === 0) {
    return
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
          !absorberToSurvivorId.has(zoneId) &&
          !borderZoneIds.has(zoneId),
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
      if (toRemove.has(zoneId) || absorberToSurvivorId.has(zoneId) || borderZoneIds.has(zoneId)) {
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
            !absorberToSurvivorId.has(neighborId) &&
            !borderZoneIds.has(neighborId),
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
