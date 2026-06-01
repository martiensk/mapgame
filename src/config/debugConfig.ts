import type { MapDisplayMode } from '../render/pixiMap'

export interface DebugConfig {
  showWorldBorder: boolean
  defaultMapDisplayMode: MapDisplayMode
}

export const DEBUG_CONFIG: DebugConfig = {
  showWorldBorder: true,
  defaultMapDisplayMode: 'landscape',
}
