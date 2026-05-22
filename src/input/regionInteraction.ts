import type { Graphics } from 'pixi.js'
import type { County } from '../types/world'

export interface RegionInteractionCallbacks {
  onHoverStart?: (county: County) => void
  onHoverEnd?: (county: County) => void
  onSelect?: (county: County) => void
}

export function bindCountyInteraction(
  graphic: Graphics,
  county: County,
  callbacks: RegionInteractionCallbacks,
): () => void {
  const onPointerOver = () => callbacks.onHoverStart?.(county)
  const onPointerOut = () => callbacks.onHoverEnd?.(county)
  const onPointerDown = () => callbacks.onSelect?.(county)

  graphic.eventMode = 'static'
  graphic.cursor = 'pointer'
  graphic.on('pointerover', onPointerOver)
  graphic.on('pointerout', onPointerOut)
  graphic.on('pointerdown', onPointerDown)

  return () => {
    graphic.off('pointerover', onPointerOver)
    graphic.off('pointerout', onPointerOut)
    graphic.off('pointerdown', onPointerDown)
  }
}
