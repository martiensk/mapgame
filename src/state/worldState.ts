import { DEFAULT_WORLD_CONFIG, generateWorld } from '../generation/world'
import type { WorldConfig, WorldData } from '../types/world'
import { createWorldIndex, type WorldIndex } from './worldIndex'

export interface WorldState {
  world: WorldData
  index: WorldIndex
  regenerate: (seed: string, config?: WorldConfig) => WorldData
}

export function createWorldState(
  initialSeed = 'duchy-001',
  initialConfig: WorldConfig = DEFAULT_WORLD_CONFIG,
): WorldState {
  let activeConfig = initialConfig
  let world = generateWorld(initialSeed, activeConfig)
  let index = createWorldIndex(world)

  return {
    get world() {
      return world
    },
    get index() {
      return index
    },
    regenerate: (seed: string, config?: WorldConfig) => {
      if (config) {
        activeConfig = config
      }
      world = generateWorld(seed, activeConfig)
      index = createWorldIndex(world)
      return world
    },
  }
}
