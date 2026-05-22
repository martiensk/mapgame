import { DEFAULT_WORLD_CONFIG, generateWorld } from '../generation/world'
import type { WorldConfig, WorldData } from '../types/world'

export interface WorldState {
  world: WorldData
  regenerate: (seed: string, config?: WorldConfig) => WorldData
}

export function createWorldState(
  initialSeed = 'duchy-001',
  initialConfig: WorldConfig = DEFAULT_WORLD_CONFIG,
): WorldState {
  let activeConfig = initialConfig
  let world = generateWorld(initialSeed, activeConfig)

  return {
    get world() {
      return world
    },
    regenerate: (seed: string, config?: WorldConfig) => {
      if (config) {
        activeConfig = config
      }
      world = generateWorld(seed, activeConfig)
      return world
    },
  }
}
