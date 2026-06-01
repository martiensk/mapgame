import { describe, expect, it } from 'vitest'
import { DEFAULT_WORLD_CONFIG, generateWorld } from './world'

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

describe('moisture generation', () => {
  it('is deterministic for the same seed and config', () => {
    const first = generateWorld('moisture-determinism', DEFAULT_WORLD_CONFIG)
    const second = generateWorld('moisture-determinism', DEFAULT_WORLD_CONFIG)

    expect(first.counties.map((county) => county.moisture)).toEqual(
      second.counties.map((county) => county.moisture),
    )
    expect(first.seaZones.map((zone) => zone.moisture)).toEqual(
      second.seaZones.map((zone) => zone.moisture),
    )
  })

  it('keeps water-adjacent counties wetter on average than inland counties', () => {
    const world = generateWorld('moisture-water-influence', DEFAULT_WORLD_CONFIG)
    const coastalCountyIds = new Set<string>()
    const riverCountyIds = new Set(world.rivers.flatMap((river) => river.countyPath))

    world.seaZones.forEach((seaZone) => {
      seaZone.coastalCountyIds.forEach((countyId) => coastalCountyIds.add(countyId))
    })

    const waterCountyIds = new Set<string>([...coastalCountyIds, ...riverCountyIds])

    const waterAdjacentMoisture = world.counties
      .filter((county) => waterCountyIds.has(county.id))
      .map((county) => county.moisture)
    const inlandMoisture = world.counties
      .filter((county) => !waterCountyIds.has(county.id))
      .map((county) => county.moisture)

    expect(waterAdjacentMoisture.length).toBeGreaterThan(0)
    expect(inlandMoisture.length).toBeGreaterThan(0)
    expect(average(waterAdjacentMoisture)).toBeGreaterThan(average(inlandMoisture))
  })

  it('applies evaporation so hotter inland counties tend drier than cooler inland counties', () => {
    const world = generateWorld('moisture-evaporation-trend', DEFAULT_WORLD_CONFIG)
    const coastalCountyIds = new Set<string>()
    const riverCountyIds = new Set(world.rivers.flatMap((river) => river.countyPath))

    world.seaZones.forEach((seaZone) => {
      seaZone.coastalCountyIds.forEach((countyId) => coastalCountyIds.add(countyId))
    })

    const inlandCounties = world.counties.filter(
      (county) => !coastalCountyIds.has(county.id) && !riverCountyIds.has(county.id),
    )

    expect(inlandCounties.length).toBeGreaterThan(12)

    const sortedByTemperature = [...inlandCounties].sort(
      (left, right) => left.temperature - right.temperature,
    )
    const quartileSize = Math.max(4, Math.floor(sortedByTemperature.length * 0.25))

    const coolSample = sortedByTemperature.slice(0, quartileSize)
    const hotSample = sortedByTemperature.slice(-quartileSize)

    const coolMoisture = average(coolSample.map((county) => county.moisture))
    const hotMoisture = average(hotSample.map((county) => county.moisture))

    expect(coolMoisture).toBeGreaterThan(hotMoisture)
  })
})
