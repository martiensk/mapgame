import type { Graphics } from 'pixi.js'

export interface RegionInteractionCallbacks<TRegion> {
  onHoverStart?: (region: TRegion) => void
  onHoverEnd?: (region: TRegion) => void
  onSelect?: (region: TRegion) => void
}

export function bindRegionInteraction<TRegion>(
  graphic: Graphics,
  region: TRegion,
  callbacks: RegionInteractionCallbacks<TRegion>,
  options?: { selectable?: boolean },
): () => void {
  const selectable = options?.selectable ?? true
  const onPointerOver = () => callbacks.onHoverStart?.(region)
  const onPointerOut = () => callbacks.onHoverEnd?.(region)
  const onPointerDown = () => callbacks.onSelect?.(region)

  graphic.eventMode = 'static'
  graphic.cursor = 'pointer'
  graphic.on('pointerover', onPointerOver)
  graphic.on('pointerout', onPointerOut)
  if (selectable) {
    graphic.on('pointerdown', onPointerDown)
  }

  return () => {
    graphic.off('pointerover', onPointerOver)
    graphic.off('pointerout', onPointerOut)
    if (selectable) {
      graphic.off('pointerdown', onPointerDown)
    }
  }
}
