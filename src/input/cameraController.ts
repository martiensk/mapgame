import type { Container } from 'pixi.js'

export interface CameraBounds {
  width: number
  height: number
}

export interface CameraControllerOptions {
  viewport: Container
  canvas: HTMLCanvasElement
  bounds: CameraBounds
  minZoom?: number
  maxZoom?: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export class CameraController {
  private readonly viewport: Container
  private readonly canvas: HTMLCanvasElement
  private bounds: CameraBounds
  private readonly minZoom: number
  private readonly maxZoom: number
  private dragging = false
  private lastPointer = { x: 0, y: 0 }

  constructor(options: CameraControllerOptions) {
    this.viewport = options.viewport
    this.canvas = options.canvas
    this.bounds = options.bounds
    this.minZoom = options.minZoom ?? 0.15
    this.maxZoom = options.maxZoom ?? 2.8

    this.bindEvents()
    this.clampToBounds()
  }

  public destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointerleave', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
  }

  public setBounds(bounds: CameraBounds): void {
    this.bounds = bounds
    this.clampToBounds()
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointerleave', this.onPointerUp)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.dragging = true
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.canvas.setPointerCapture(event.pointerId)
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) {
      return
    }

    const deltaX = event.clientX - this.lastPointer.x
    const deltaY = event.clientY - this.lastPointer.y
    this.lastPointer = { x: event.clientX, y: event.clientY }

    this.viewport.x += deltaX
    this.viewport.y += deltaY
    this.clampToBounds()
  }

  private onPointerUp = (event: PointerEvent): void => {
    this.dragging = false
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId)
    }
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()

    const zoomDirection = event.deltaY > 0 ? -1 : 1
    const zoomStep = zoomDirection > 0 ? 1.1 : 0.9
    const previousScale = this.viewport.scale.x
    const effectiveMinZoom = Math.min(this.maxZoom, this.getEffectiveMinZoom())
    const nextScale = clamp(
      previousScale * zoomStep,
      effectiveMinZoom,
      this.maxZoom,
    )

    const rectangle = this.canvas.getBoundingClientRect()
    const cursorX = event.clientX - rectangle.left
    const cursorY = event.clientY - rectangle.top
    const worldX = (cursorX - this.viewport.x) / previousScale
    const worldY = (cursorY - this.viewport.y) / previousScale

    this.viewport.scale.set(nextScale)
    this.viewport.x = cursorX - worldX * nextScale
    this.viewport.y = cursorY - worldY * nextScale
    this.clampToBounds()
  }

  private getViewportSize(): { width: number; height: number } {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight

    if (width > 0 && height > 0) {
      return { width, height }
    }

    const rectangle = this.canvas.getBoundingClientRect()
    return {
      width: rectangle.width,
      height: rectangle.height,
    }
  }

  private getEffectiveMinZoom(): number {
    const viewportSize = this.getViewportSize()
    const boundsWidth = Math.max(1, this.bounds.width)
    const boundsHeight = Math.max(1, this.bounds.height)
    const fitX = viewportSize.width / boundsWidth
    const fitY = viewportSize.height / boundsHeight

    return Math.max(this.minZoom, fitX, fitY)
  }

  private clampToBounds(): void {
    const effectiveMinZoom = Math.min(this.maxZoom, this.getEffectiveMinZoom())
    const scale = clamp(this.viewport.scale.x, effectiveMinZoom, this.maxZoom)
    if (scale !== this.viewport.scale.x) {
      this.viewport.scale.set(scale)
    }

    const viewportSize = this.getViewportSize()
    const minX = Math.min(0, viewportSize.width - this.bounds.width * scale)
    const minY = Math.min(0, viewportSize.height - this.bounds.height * scale)

    this.viewport.x = clamp(this.viewport.x, minX, 0)
    this.viewport.y = clamp(this.viewport.y, minY, 0)
  }
}
