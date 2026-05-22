import { Application, Container, Graphics, Text } from 'pixi.js'
import { CAMERA_CONFIG } from '../config/cameraConfig'
import { polygonToFlatArray } from '../geometry/polygon'
import { CameraController } from '../input/cameraController'
import {
  bindCountyInteraction,
  type RegionInteractionCallbacks,
} from '../input/regionInteraction'
import type { County, SeaZone, WorldData } from '../types/world'

interface CountyGraphicEntry {
  county: County
  graphic: Graphics
}

export interface PixiMapCallbacks {
  onHoverCounty?: (county: County | null) => void
  onSelectCounty?: (county: County) => void
}

export class PixiMap {
  private readonly host: HTMLElement
  private readonly callbacks: PixiMapCallbacks
  private app: Application | null = null
  private worldContainer: Container = new Container()
  private cameraController: CameraController | null = null
  private world: WorldData | null = null
  private countyGraphics = new Map<string, CountyGraphicEntry>()
  private disposeInteractions: Array<() => void> = []
  private selectedCountyId = ''
  private hoveredCountyId = ''
  private isDestroyed = false
  private mountNonce = 0
  private showWorldBorder = false
  private showSeaZoneLayers = false

  constructor(host: HTMLElement, callbacks: PixiMapCallbacks = {}) {
    this.host = host
    this.callbacks = callbacks
  }

  public async mount(world: WorldData): Promise<void> {
    if (this.isDestroyed) {
      return
    }

    this.world = world
    const app = new Application()
    const mountNonce = ++this.mountNonce

    await app.init({
      antialias: true,
      resizeTo: this.host,
      background: '#081022',
    })

    if (this.isDestroyed || mountNonce !== this.mountNonce) {
      app.destroy({ removeView: true }, true)
      return
    }

    this.app = app

    this.host.innerHTML = ''
    this.host.appendChild(app.canvas)

    this.worldContainer = new Container()
    app.stage.addChild(this.worldContainer)

    this.cameraController = new CameraController({
      viewport: this.worldContainer,
      canvas: app.canvas,
      bounds: {
        width: world.metadata.width,
        height: world.metadata.height,
      },
      minZoom: CAMERA_CONFIG.minZoom,
      maxZoom: CAMERA_CONFIG.maxZoom,
    })

    this.renderWorld()
  }

  public updateWorld(world: WorldData): void {
    if (this.isDestroyed) {
      return
    }

    this.world = world
    this.cameraController?.setBounds({
      width: world.metadata.width,
      height: world.metadata.height,
    })
    this.selectedCountyId = ''
    this.hoveredCountyId = ''
    this.renderWorld()
  }

  public setShowWorldBorder(show: boolean): void {
    if (this.showWorldBorder === show) {
      return
    }

    this.showWorldBorder = show
    this.renderWorld()
  }

  public setShowSeaZoneLayers(show: boolean): void {
    if (this.showSeaZoneLayers === show) {
      return
    }

    this.showSeaZoneLayers = show
    this.renderWorld()
  }

  public destroy(): void {
    if (this.isDestroyed) {
      return
    }

    this.isDestroyed = true
    this.mountNonce += 1
    this.disposeInteractions.forEach((dispose) => dispose())
    this.disposeInteractions = []
    this.cameraController?.destroy()
    this.cameraController = null
    this.app?.destroy({ removeView: true }, true)
    this.app = null
    this.worldContainer.destroy({ children: true })
    this.host.replaceChildren()
  }

  private renderWorld(): void {
    if (!this.world) {
      return
    }

    this.disposeInteractions.forEach((dispose) => dispose())
    this.disposeInteractions = []
    this.countyGraphics.clear()
    this.worldContainer.removeChildren().forEach((child) => child.destroy())

    if (this.showWorldBorder) {
      const borderStrokeWidth = 3
      const borderInset = borderStrokeWidth / 2
      const borderGraphic = new Graphics()
      borderGraphic.rect(
        borderInset,
        borderInset,
        this.world.metadata.width - borderStrokeWidth,
        this.world.metadata.height - borderStrokeWidth,
      )
      borderGraphic.stroke({ color: 0xff0000, width: borderStrokeWidth, alpha: 0.8 })
      this.worldContainer.addChild(borderGraphic)
    }

    const layerBySeaZoneId = this.computeSeaZoneLayerById(this.world.seaZones)

    this.world.seaZones.forEach((zone) => {
      const layer = layerBySeaZoneId.get(zone.id) ?? 1
      const fillColor = this.seaZoneLayerColor(layer, this.showSeaZoneLayers)
      const graphic = this.drawPolygon(zone.polygon, fillColor, 0x3f5f8f, 0.8)
      this.worldContainer.addChild(graphic)

      if (this.showSeaZoneLayers) {
        const fontSize = Math.max(11, Math.min(18, Math.sqrt(zone.area) * 0.08))
        const label = new Text(String(layer), {
          fill: 0xffe766,
          fontSize,
          fontWeight: '700',
        })

        label.anchor.set(0.5)
        label.position.set(zone.centroid.x, zone.centroid.y)
        this.worldContainer.addChild(label)
      }
    })

    const regionCallbacks: RegionInteractionCallbacks = {
      onHoverStart: (county) => {
        this.hoveredCountyId = county.id
        this.callbacks.onHoverCounty?.(county)
        this.applyCountyStyles()
      },
      onHoverEnd: () => {
        this.hoveredCountyId = ''
        this.callbacks.onHoverCounty?.(null)
        this.applyCountyStyles()
      },
      onSelect: (county) => {
        this.selectedCountyId = county.id
        this.callbacks.onSelectCounty?.(county)
        this.applyCountyStyles()
      },
    }

    this.world.counties.forEach((county) => {
      const graphic = this.drawPolygon(county.polygon, 0x6a9f5a, 0x0c1a0e, 1)
      const disposeInteraction = bindCountyInteraction(
        graphic,
        county,
        regionCallbacks,
      )

      this.disposeInteractions.push(disposeInteraction)
      this.countyGraphics.set(county.id, { county, graphic })
      this.worldContainer.addChild(graphic)
    })

    this.applyCountyStyles()
  }

  private applyCountyStyles(): void {
    this.countyGraphics.forEach(({ county, graphic }) => {
      const isSelected = county.id === this.selectedCountyId
      const isHovered = county.id === this.hoveredCountyId

      let fillColor = 0x5f8d52
      let strokeColor = 0x102112
      let alpha = 0.88

      if (isHovered) {
        fillColor = 0xa9d57a
        strokeColor = 0x203c0e
      }

      if (isSelected) {
        fillColor = 0xf1cc5b
        strokeColor = 0x2f2a0e
        alpha = 1
      }

      graphic.clear()
      this.drawPolygonToGraphic(
        graphic,
        county.polygon,
        fillColor,
        strokeColor,
        alpha,
      )
    })
  }

  private drawPolygon(
    polygon: County['polygon'] | SeaZone['polygon'],
    fillColor: number,
    strokeColor: number,
    alpha: number,
  ): Graphics {
    const graphic = new Graphics()
    this.drawPolygonToGraphic(graphic, polygon, fillColor, strokeColor, alpha)
    return graphic
  }

  private drawPolygonToGraphic(
    graphic: Graphics,
    polygon: County['polygon'] | SeaZone['polygon'],
    fillColor: number,
    strokeColor: number,
    alpha: number,
  ): void {
    const points = polygonToFlatArray(polygon)
    graphic.poly(points, true)
    graphic.fill({ color: fillColor, alpha })
    graphic.stroke({ color: strokeColor, width: 1, alpha: 0.9 })
  }

  private computeSeaZoneLayerById(seaZones: SeaZone[]): Map<string, number> {
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

  private seaZoneLayerColor(layer: number, debugMode: boolean): number {
    const layerIndex = Math.max(0, layer - 1)

    const debugPalette = [
      0x8fe8ff, // layer 1 (light blue)
      0x5fcbf3,
      0x3ea9e5,
      0x2f86d0,
      0x2267b7,
      0x184b97,
      0x103678,
      0x0a265e,
      0x071c49, // deepest
    ]

    const normalPalette = [
      0x2f6da3, // subtle near-coast blue
      0x2a6498,
      0x255c8d,
      0x205383,
      0x1c4b79,
      0x18436f,
      0x153a65,
      0x12325b,
      0x102a52, // subtle deep navy
    ]

    const palette = debugMode ? debugPalette : normalPalette
    return palette[Math.min(palette.length - 1, layerIndex)]
  }
}
