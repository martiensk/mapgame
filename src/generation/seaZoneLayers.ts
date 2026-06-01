import type { SeaZone } from '../types/world'

export function computeSeaZoneLayerById(seaZones: SeaZone[]): Map<string, number> {
  const maxDisplayLayer = 9
  const byId = new Map(seaZones.map((zone) => [zone.id, zone]))
  const layerById = new Map<string, number>()
  const queue: string[] = []

  seaZones.forEach((zone) => {
    if (zone.coastalCountyIds.length > 0) {
      layerById.set(zone.id, 1)
      queue.push(zone.id)
    }
  })

  let queueIndex = 0
  while (queueIndex < queue.length) {
    const currentId = queue[queueIndex]
    queueIndex += 1

    const current = byId.get(currentId)
    const currentLayer = layerById.get(currentId)
    if (!current || !currentLayer) {
      continue
    }

    current.neighbors.forEach((neighborId) => {
      if (!byId.has(neighborId) || layerById.has(neighborId)) {
        return
      }

      layerById.set(neighborId, Math.min(maxDisplayLayer, currentLayer + 1))
      queue.push(neighborId)
    })
  }

  // Some ocean components can become disconnected from coastal BFS seeds.
  // Instead of forcing those zones to deepest depth (which creates isolated
  // dark artifacts), inherit the nearest existing zone layer by centroid.
  const assigned = seaZones
    .map((zone) => ({ zone, layer: layerById.get(zone.id) }))
    .filter((entry): entry is { zone: SeaZone; layer: number } =>
      entry.layer !== undefined,
    )

  seaZones.forEach((zone) => {
    if (layerById.has(zone.id)) {
      return
    }

    if (assigned.length === 0) {
      layerById.set(zone.id, 1)
      return
    }

    let nearestLayer = 1
    let nearestDistanceSq = Number.POSITIVE_INFINITY
    assigned.forEach(({ zone: candidate, layer }) => {
      const dx = candidate.centroid.x - zone.centroid.x
      const dy = candidate.centroid.y - zone.centroid.y
      const distanceSq = dx * dx + dy * dy

      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq
        nearestLayer = layer
      }
    })

    layerById.set(zone.id, Math.min(maxDisplayLayer, Math.max(1, nearestLayer)))
  })

  return layerById
}