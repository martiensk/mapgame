import { Application, Container, Graphics, Text } from 'pixi.js'
import { CAMERA_CONFIG } from '../config/cameraConfig'
import { computeSeaZoneLayerById } from '../generation/seaZoneLayers'
import { polygonToFlatArray } from '../geometry/polygon'
import { CameraController } from '../input/cameraController'
import {
  bindRegionInteraction,
  type RegionInteractionCallbacks,
} from '../input/regionInteraction'
import type { County, Point, SeaZone, WorldData } from '../types/world'

interface CountyGraphicEntry {
  county: County
  graphic: Graphics
}

interface SeaZoneGraphicEntry {
  seaZone: SeaZone
  graphic: Graphics
  baseFillColor: number
}

export interface PixiMapCallbacks {
  onHoverCounty?: (county: County | null) => void
  onHoverSeaZone?: (seaZone: SeaZone | null) => void
  onSelectCounty?: (county: County) => void
  onArtifactDetected?: (report: CoastArtifactReport) => void
}

export interface CoastArtifactReport {
  detected: boolean
  sampledPixelCount: number
  darkPixelCount: number
  sharedEdgeCount: number
}

export type MapDisplayMode =
  | 'landscape'
  | 'sea-zone'
  | 'temperature'
  | 'climate'
  | 'elevation'

export class PixiMap {
  private readonly host: HTMLElement
  private readonly callbacks: PixiMapCallbacks
  private app: Application | null = null
  private worldContainer: Container = new Container()
  private cameraController: CameraController | null = null
  private world: WorldData | null = null
  private countyGraphics = new Map<string, CountyGraphicEntry>()
  private seaZoneGraphics = new Map<string, SeaZoneGraphicEntry>()
  private disposeInteractions: Array<() => void> = []
  private selectedCountyId = ''
  private hoveredCountyId = ''
  private hoveredSeaZoneId = ''
  private isDestroyed = false
  private mountNonce = 0
  private showWorldBorder = false
  private displayMode: MapDisplayMode = 'landscape'

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
    this.hoveredSeaZoneId = ''
    this.callbacks.onHoverCounty?.(null)
    this.callbacks.onHoverSeaZone?.(null)
    this.renderWorld()
  }

  public setShowWorldBorder(show: boolean): void {
    if (this.showWorldBorder === show) {
      return
    }

    this.showWorldBorder = show
    this.renderWorld()
  }

  public setDisplayMode(mode: MapDisplayMode): void {
    if (this.displayMode === mode) {
      return
    }

    this.displayMode = mode
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
    this.seaZoneGraphics.clear()
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

    const layerBySeaZoneId = computeSeaZoneLayerById(this.world.seaZones)

    const seaZoneCallbacks: RegionInteractionCallbacks<SeaZone> = {
      onHoverStart: (zone) => {
        this.hoveredSeaZoneId = zone.id
        this.hoveredCountyId = ''
        this.callbacks.onHoverCounty?.(null)
        this.callbacks.onHoverSeaZone?.(zone)
        this.applyCountyStyles()
        this.applySeaZoneStyles()
      },
      onHoverEnd: () => {
        this.hoveredSeaZoneId = ''
        this.callbacks.onHoverSeaZone?.(null)
        this.applySeaZoneStyles()
      },
    }

    this.world.seaZones.forEach((zone) => {
      const layer = layerBySeaZoneId.get(zone.id) ?? 1
      const fillColor = this.seaZoneBaseFillColor(zone, layer)
      const graphic = this.drawPolygon(zone.polygon, fillColor, 0x3f5f8f, 0.8)
      const disposeInteraction = bindRegionInteraction(graphic, zone, seaZoneCallbacks, {
        selectable: false,
      })
      this.disposeInteractions.push(disposeInteraction)
      this.seaZoneGraphics.set(zone.id, {
        seaZone: zone,
        graphic,
        baseFillColor: fillColor,
      })
      this.worldContainer.addChild(graphic)

      if (this.displayMode === 'sea-zone') {
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

    const regionCallbacks: RegionInteractionCallbacks<County> = {
      onHoverStart: (county) => {
        this.hoveredCountyId = county.id
        this.hoveredSeaZoneId = ''
        this.callbacks.onHoverCounty?.(county)
        this.callbacks.onHoverSeaZone?.(null)
        this.applyCountyStyles()
        this.applySeaZoneStyles()
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
      const graphic = this.drawPolygon(
        county.polygon,
        this.countyBaseFillColor(county),
        0x0c1a0e,
        1,
      )
      const disposeInteraction = bindRegionInteraction(
        graphic,
        county,
        regionCallbacks,
      )

      this.disposeInteractions.push(disposeInteraction)
      this.countyGraphics.set(county.id, { county, graphic })
      this.worldContainer.addChild(graphic)
    })

    this.applyCountyStyles()
    this.applySeaZoneStyles()
    this.scheduleArtifactDetection()
  }

  private scheduleArtifactDetection(): void {
    const app = this.app
    const world = this.world
    if (!app || !world || !this.callbacks.onArtifactDetected) {
      return
    }

    requestAnimationFrame(() => {
      if (this.isDestroyed || this.app !== app || this.world !== world) {
        return
      }

      this.callbacks.onArtifactDetected?.(this.detectCoastArtifact())
    })
  }

  private detectCoastArtifact(): CoastArtifactReport {
    if (!this.app || !this.world) {
      return {
        detected: false,
        sampledPixelCount: 0,
        darkPixelCount: 0,
        sharedEdgeCount: 0,
      }
    }

    const sampleSet = this.collectCoastSamplePoints(this.world)
    if (sampleSet.points.length === 0) {
      return {
        detected: false,
        sampledPixelCount: 0,
        darkPixelCount: 0,
        sharedEdgeCount: sampleSet.sharedEdgeCount,
      }
    }

    const extracted = this.app.renderer.extract.pixels(this.app.stage)
    const resolution = this.app.renderer.resolution || 1
    const maxX = extracted.width - 1
    const maxY = extracted.height - 1
    let darkPixelCount = 0

    sampleSet.points.forEach((point) => {
      const globalPoint = this.worldContainer.toGlobal(point)
      const pixelX = Math.max(0, Math.min(maxX, Math.round(globalPoint.x * resolution)))
      const pixelY = Math.max(0, Math.min(maxY, Math.round(globalPoint.y * resolution)))
      const offset = (pixelY * extracted.width + pixelX) * 4
      const red = extracted.pixels[offset]
      const green = extracted.pixels[offset + 1]
      const blue = extracted.pixels[offset + 2]
      const alpha = extracted.pixels[offset + 3]

      if (this.isSuspiciouslyDark(red, green, blue, alpha)) {
        darkPixelCount += 1
      }
    })

    const sampledPixelCount = sampleSet.points.length
    const darkRatio = sampledPixelCount > 0 ? darkPixelCount / sampledPixelCount : 0
    const detected = darkPixelCount >= 2 && darkRatio >= 0.003

    return {
      detected,
      sampledPixelCount,
      darkPixelCount,
      sharedEdgeCount: sampleSet.sharedEdgeCount,
    }
  }

  private isSuspiciouslyDark(
    red: number,
    green: number,
    blue: number,
    alpha: number,
  ): boolean {
    if (alpha < 200) {
      return false
    }

    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
    return luminance < 26 && Math.max(red, green, blue) < 44
  }

  private collectCoastSamplePoints(world: WorldData): {
    points: Point[]
    sharedEdgeCount: number
  } {
    const countyById = new Map(world.counties.map((county) => [county.id, county]))
    const points: Point[] = []
    const sampleSpacing = 3
    const maxSamples = 1800
    const edgeEpsilon = 1e-3
    let sharedEdgeCount = 0

    for (const seaZone of world.seaZones) {
      if (seaZone.coastalCountyIds.length === 0) {
        continue
      }

      for (const countyId of seaZone.coastalCountyIds) {
        const county = countyById.get(countyId)
        if (!county) {
          continue
        }

        const sharedEdges = this.findSharedEdges(
          county.polygon,
          seaZone.polygon,
          edgeEpsilon,
        )

        for (const edge of sharedEdges) {
          sharedEdgeCount += 1
          const edgeSamples = this.sampleEdge(edge.start, edge.end, sampleSpacing)

          for (const samplePoint of edgeSamples) {
            points.push(samplePoint)
            if (points.length >= maxSamples) {
              return { points, sharedEdgeCount }
            }
          }
        }
      }
    }

    return { points, sharedEdgeCount }
  }

  private findSharedEdges(
    first: Point[],
    second: Point[],
    epsilon: number,
  ): Array<{ start: Point; end: Point }> {
    const sharedEdges: Array<{ start: Point; end: Point }> = []

    for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
      const firstNext = first[(firstIndex + 1) % first.length]
      const firstCurrent = first[firstIndex]

      for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
        const secondNext = second[(secondIndex + 1) % second.length]
        const secondCurrent = second[secondIndex]

        const reversedMatch =
          this.pointsAlmostEqual(firstCurrent, secondNext, epsilon) &&
          this.pointsAlmostEqual(firstNext, secondCurrent, epsilon)

        if (!reversedMatch) {
          continue
        }

        sharedEdges.push({ start: firstCurrent, end: firstNext })
      }
    }

    return sharedEdges
  }

  private pointsAlmostEqual(first: Point, second: Point, epsilon: number): boolean {
    return (
      Math.abs(first.x - second.x) <= epsilon &&
      Math.abs(first.y - second.y) <= epsilon
    )
  }

  private sampleEdge(start: Point, end: Point, spacing: number): Point[] {
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    const sampleCount = Math.max(1, Math.floor(length / spacing))
    const points: Point[] = []

    for (let index = 0; index < sampleCount; index += 1) {
      const t = (index + 0.5) / (sampleCount + 1)
      points.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      })
    }

    return points
  }

  private applyCountyStyles(): void {
    this.countyGraphics.forEach(({ county, graphic }) => {
      const isSelected = county.id === this.selectedCountyId
      const isHovered = county.id === this.hoveredCountyId

      let fillColor = this.countyBaseFillColor(county)
      let strokeColor = 0x102112
      let alpha = 0.88

      if (
        this.displayMode === 'temperature' ||
        this.displayMode === 'climate' ||
        this.displayMode === 'elevation'
      ) {
        if (isHovered) {
          fillColor = this.lightenTowardWhite(fillColor, 0.18)
          strokeColor = 0x203c0e
        }

        if (isSelected) {
          fillColor = this.lightenTowardWhite(fillColor, 0.28)
          strokeColor = 0x2f2a0e
          alpha = 1
        }
      } else {
        if (isHovered) {
          fillColor = 0xa9d57a
          strokeColor = 0x203c0e
        }

        if (isSelected) {
          fillColor = 0xf1cc5b
          strokeColor = 0x2f2a0e
          alpha = 1
        }
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

  private applySeaZoneStyles(): void {
    this.seaZoneGraphics.forEach(({ seaZone, graphic, baseFillColor }) => {
      const isHovered = seaZone.id === this.hoveredSeaZoneId

      let fillColor = baseFillColor
      let strokeColor = 0x3f5f8f
      let alpha = 0.8

      if (isHovered) {
        fillColor = this.lightenTowardWhite(baseFillColor, 0.1)
        strokeColor = this.lightenTowardWhite(0x3f5f8f, 0.1)
        alpha = 0.88
      }

      graphic.clear()
      this.drawPolygonToGraphic(
        graphic,
        seaZone.polygon,
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

  private seaZoneBaseFillColor(zone: SeaZone, layer: number): number {
    if (this.displayMode === 'temperature') {
      return this.applyTemperatureOverlay(this.seaZoneLayerColor(layer, false), zone.temperature)
    }

    if (this.displayMode === 'sea-zone') {
      return this.seaZoneLayerColor(layer, true)
    }

    return this.seaZoneLayerColor(layer, false)
  }

  private countyBaseFillColor(county: County): number {
    if (this.displayMode === 'climate') {
      return this.climateColor(county.climateId)
    }

    if (this.displayMode === 'elevation') {
      return this.elevationColor(county.elevation)
    }

    if (this.displayMode !== 'temperature') {
      return 0x5f8d52
    }

    return this.applyTemperatureOverlay(0x5f8d52, county.temperature)
  }

  private climateColor(climateId: string): number {
    switch (climateId) {
      case 'arctic':
        return 0xd9f2ff
      case 'subarctic':
        return 0xa7d3ff
      case 'cool':
        return 0x8bcf9d
      case 'temperate':
        return 0x66b55f
      case 'warm':
        return 0xd8c85b
      case 'tropical':
        return 0xe89a4f
      case 'extreme':
        return 0xc85b3d
      default:
        return 0x5f8d52
    }
  }

  private applyTemperatureOverlay(baseColor: number, temperature: number): number {
    const normalizedTemperature = Math.max(0, Math.min(1, temperature))
    const temperatureColor = this.temperatureGradientColor(normalizedTemperature)
    return this.blendColors(baseColor, temperatureColor, 0.48)
  }

  private elevationColor(elevation: number): number {
    const e = Math.max(0, Math.min(1, elevation))

    if (e <= 0.05) {
      return this.blendColors(0xdac68e, 0xb7a26a, e / 0.05)
    }

    if (e <= 0.35) {
      return this.blendColors(0x8eb668, 0x5f8d52, (e - 0.05) / 0.3)
    }

    if (e <= 0.6) {
      return this.blendColors(0x6f8a4c, 0x85744f, (e - 0.35) / 0.25)
    }

    if (e <= 0.7) {
      return this.blendColors(0x85744f, 0x9c8266, (e - 0.6) / 0.1)
    }

    if (e <= 0.9) {
      return this.blendColors(0x6e6d6e, 0xababab, (e - 0.7) / 0.2)
    }

    return this.blendColors(0xcccccc, 0xf5f5f5, (e - 0.9) / 0.1)
  }

  private temperatureGradientColor(normalizedTemperature: number): number {
    const t = Math.max(0, Math.min(1, normalizedTemperature))
    const red = Math.round(255 * t)
    const blue = Math.round(255 * (1 - t))
    const green = 0
    return (red << 16) | (green << 8) | blue
  }

  private blendColors(baseColor: number, overlayColor: number, amount: number): number {
    const safeAmount = Math.max(0, Math.min(1, amount))
    const inverse = 1 - safeAmount

    const baseRed = (baseColor >> 16) & 0xff
    const baseGreen = (baseColor >> 8) & 0xff
    const baseBlue = baseColor & 0xff

    const overlayRed = (overlayColor >> 16) & 0xff
    const overlayGreen = (overlayColor >> 8) & 0xff
    const overlayBlue = overlayColor & 0xff

    const red = Math.round(baseRed * inverse + overlayRed * safeAmount)
    const green = Math.round(baseGreen * inverse + overlayGreen * safeAmount)
    const blue = Math.round(baseBlue * inverse + overlayBlue * safeAmount)

    return (red << 16) | (green << 8) | blue
  }

  private lightenTowardWhite(color: number, amount: number): number {
    const safeAmount = Math.max(0, Math.min(1, amount))
    const red = (color >> 16) & 0xff
    const green = (color >> 8) & 0xff
    const blue = color & 0xff

    const nextRed = Math.round(red + (255 - red) * safeAmount)
    const nextGreen = Math.round(green + (255 - green) * safeAmount)
    const nextBlue = Math.round(blue + (255 - blue) * safeAmount)

    return (nextRed << 16) | (nextGreen << 8) | nextBlue
  }
}
