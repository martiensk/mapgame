import type { LandMass, WorldConfig } from '../types/world'
import type { SeededRandom } from './random'

export interface LandMassShape {
  id: string
  type: 'continent' | 'island'
  area: number
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
  targetCountyCount: number
  maskOffsetX: number
  maskOffsetY: number
  maskWidth: number
  maskHeight: number
  maskOccupancy: Uint8Array
}

interface MaskField {
  cols: number
  rows: number
  values: Float32Array
}

interface LandMaskComponent {
  cellIndices: number[]
  cellCount: number
  centroidX: number
  centroidY: number
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
}

interface ThresholdCandidate {
  threshold: number
  components: LandMaskComponent[]
  landFraction: number
  score: number
}

interface CandidateBalanceMetrics {
  largestShareOfLand: number
  secondLargestShareOfLand: number
  dominanceRatio: number
  minContinentSeparation: number
  meanNearestContinentSeparation: number
}

function computeContinentSeparationMetrics(
  components: LandMaskComponent[],
  continentCount: number,
  cols: number,
  rows: number,
): {
  minContinentSeparation: number
  meanNearestContinentSeparation: number
} {
  const sampledContinentCount = Math.min(continentCount, components.length)
  if (sampledContinentCount <= 1) {
    return {
      minContinentSeparation: 1,
      meanNearestContinentSeparation: 1,
    }
  }

  const topComponents = [...components]
    .sort((left, right) => right.cellCount - left.cellCount)
    .slice(0, sampledContinentCount)
  const diagonal = Math.max(1, Math.hypot(cols, rows))
  let minDistance = Number.POSITIVE_INFINITY
  const nearestDistances: number[] = []

  for (let index = 0; index < topComponents.length; index += 1) {
    const current = topComponents[index]
    let nearestForCurrent = Number.POSITIVE_INFINITY

    for (let otherIndex = 0; otherIndex < topComponents.length; otherIndex += 1) {
      if (index === otherIndex) {
        continue
      }

      const other = topComponents[otherIndex]
      const distance =
        Math.hypot(current.centroidX - other.centroidX, current.centroidY - other.centroidY) /
        diagonal

      if (distance < minDistance) {
        minDistance = distance
      }

      if (distance < nearestForCurrent) {
        nearestForCurrent = distance
      }
    }

    if (Number.isFinite(nearestForCurrent)) {
      nearestDistances.push(nearestForCurrent)
    }
  }

  const meanNearest =
    nearestDistances.length > 0
      ? nearestDistances.reduce((sum, value) => sum + value, 0) / nearestDistances.length
      : 1

  return {
    minContinentSeparation: Number.isFinite(minDistance) ? minDistance : 1,
    meanNearestContinentSeparation: meanNearest,
  }
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function hash2d(x: number, y: number, seed: number): number {
  let h = (x * 374761393) ^ (y * 668265263) ^ (seed * 362437)
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function valueNoise2d(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = x0 + 1
  const y1 = y0 + 1

  const tx = smoothStep(x - x0)
  const ty = smoothStep(y - y0)

  const v00 = hash2d(x0, y0, seed)
  const v10 = hash2d(x1, y0, seed)
  const v01 = hash2d(x0, y1, seed)
  const v11 = hash2d(x1, y1, seed)

  const vx0 = lerp(v00, v10, tx)
  const vx1 = lerp(v01, v11, tx)
  return lerp(vx0, vx1, ty)
}

function fractalNoise2d(
  x: number,
  y: number,
  seed: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let frequency = 1
  let amplitude = 1
  let sum = 0
  let totalAmplitude = 0

  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise2d(x * frequency, y * frequency, seed + octave * 97) * amplitude
    totalAmplitude += amplitude
    frequency *= lacunarity
    amplitude *= gain
  }

  return totalAmplitude > 0 ? sum / totalAmplitude : 0
}

function buildField(config: WorldConfig, random: SeededRandom): MaskField {
  const cols = Math.max(96, Math.floor(Math.sqrt(config.voronoiCellTarget) * 7))
  const rows = Math.max(64, Math.floor((cols * config.height) / config.width))
  const values = new Float32Array(cols * rows)
  const seedA = random.int(1, 1_000_000_000)
  const seedB = random.int(1, 1_000_000_000)
  const seedC = random.int(1, 1_000_000_000)
  const warpSeedX = random.int(1, 1_000_000_000)
  const warpSeedY = random.int(1, 1_000_000_000)
  const warpStrength = random.float(0.08, 0.15)
  const detailInfluence = random.float(0.18, 0.26)
  const macroInfluence = random.float(0.22, 0.32)
  const seaBias = random.float(0.08, 0.16)
  const edgeMargin = Math.max(0.02, config.edgeOceanMargin)
  const edgePenaltyStrength = Math.max(0, config.edgeOceanPenaltyStrength)

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const nx = cols > 1 ? col / (cols - 1) : 0
      const ny = rows > 1 ? row / (rows - 1) : 0
      const centeredX = nx - 0.5
      const centeredY = ny - 0.5

      const warpX = fractalNoise2d(nx * 3.2 + 11.3, ny * 3.2 - 7.7, warpSeedX, 3, 2.1, 0.55)
      const warpY = fractalNoise2d(nx * 3.2 - 4.9, ny * 3.2 + 9.1, warpSeedY, 3, 2.1, 0.55)
      const wx = nx + (warpX - 0.5) * warpStrength
      const wy = ny + (warpY - 0.5) * warpStrength

      const distanceToEdge = Math.min(nx, 1 - nx, ny, 1 - ny)
      const edgeNormalized = Math.min(1, Math.max(0, distanceToEdge / edgeMargin))
      const edgeInteriorBlend = smoothStep(edgeNormalized)
      const edgePenalty = (1 - edgeInteriorBlend) * edgePenaltyStrength

      const continental = 1 - Math.sqrt(centeredX * centeredX * 1.35 + centeredY * centeredY * 1.15)
      const macroNoise = fractalNoise2d(wx * 1.8 + 3.7, wy * 1.8 + 5.1, seedA, 4, 2.0, 0.52)
      const coastNoise = fractalNoise2d(wx * 5.1 - 2.4, wy * 5.1 + 1.8, seedB, 4, 2.15, 0.5)
      const detailNoise = fractalNoise2d(wx * 9.3 + 0.7, wy * 9.3 - 1.2, seedC, 2, 2.2, 0.45)

      const value =
        continental * macroInfluence +
        macroNoise * 0.52 +
        coastNoise * (1 - macroInfluence) +
        (detailNoise - 0.5) * detailInfluence -
        seaBias -
        edgePenalty

      values[row * cols + col] = value
    }
  }

  return {
    cols,
    rows,
    values,
  }
}

function extractComponents(
  landMask: Uint8Array,
  cols: number,
  rows: number,
): LandMaskComponent[] {
  const visited = new Uint8Array(cols * rows)
  const components: LandMaskComponent[] = []
  const stack = new Array<number>(cols * rows)
  const neighborOffsets = [1, -1, cols, -cols]

  for (let index = 0; index < landMask.length; index += 1) {
    if (landMask[index] === 0 || visited[index] === 1) {
      continue
    }

    let stackSize = 0
    stack[stackSize] = index
    stackSize += 1
    visited[index] = 1

    const cells: number[] = []
    let cellCount = 0
    let sumCol = 0
    let sumRow = 0
    let minCol = cols
    let maxCol = 0
    let minRow = rows
    let maxRow = 0

    while (stackSize > 0) {
      stackSize -= 1
      const current = stack[stackSize]
      const row = Math.floor(current / cols)
      const col = current - row * cols

      cells.push(current)
      cellCount += 1
      sumCol += col
      sumRow += row
      minCol = Math.min(minCol, col)
      maxCol = Math.max(maxCol, col)
      minRow = Math.min(minRow, row)
      maxRow = Math.max(maxRow, row)

      for (let n = 0; n < neighborOffsets.length; n += 1) {
        const neighbor = current + neighborOffsets[n]
        if (neighbor < 0 || neighbor >= landMask.length) {
          continue
        }

        const neighborRow = Math.floor(neighbor / cols)
        const neighborCol = neighbor - neighborRow * cols
        const manhattan = Math.abs(neighborRow - row) + Math.abs(neighborCol - col)

        if (manhattan !== 1) {
          continue
        }

        if (landMask[neighbor] === 0 || visited[neighbor] === 1) {
          continue
        }

        visited[neighbor] = 1
        stack[stackSize] = neighbor
        stackSize += 1
      }
    }

    components.push({
      cellIndices: cells,
      cellCount,
      centroidX: sumCol / Math.max(1, cellCount),
      centroidY: sumRow / Math.max(1, cellCount),
      minCol,
      maxCol,
      minRow,
      maxRow,
    })
  }

  return components
}

function buildThresholdCandidates(
  field: MaskField,
  config: WorldConfig,
): ThresholdCandidate[] {
  const candidates: ThresholdCandidate[] = []
  const thresholdSequence = [0.68, 0.66, 0.64, 0.62, 0.6, 0.58, 0.56, 0.54]
  const minContinents = Math.max(1, Math.floor(config.minContinents))
  const minIslands = Math.max(0, Math.floor(config.minIslands))
  const targetComponents = minContinents + minIslands
  const targetLandFraction = 0.31
  const minLandFraction = 0.14
  const maxLandFraction = 0.42

  for (let i = 0; i < thresholdSequence.length; i += 1) {
    const threshold = thresholdSequence[i]
    const mask = new Uint8Array(field.cols * field.rows)
    let landCells = 0

    for (let index = 0; index < field.values.length; index += 1) {
      if (field.values[index] >= threshold) {
        mask[index] = 1
        landCells += 1
      }
    }

    const landFraction = landCells / Math.max(1, field.values.length)
    const components = extractComponents(mask, field.cols, field.rows)
    const componentScore =
      Math.min(components.length, targetComponents) * 1000 -
      Math.abs(components.length - targetComponents) * 200
    const targetPenalty = Math.abs(landFraction - targetLandFraction) * 2200
    const tooMuchLandPenalty =
      landFraction > maxLandFraction ? (landFraction - maxLandFraction) * 9000 : 0
    const tooLittleLandPenalty =
      landFraction < minLandFraction ? (minLandFraction - landFraction) * 6000 : 0

    const sortedComponentCellCounts = [...components]
      .map((component) => component.cellCount)
      .sort((left, right) => right - left)
    const largestComponentCells = sortedComponentCellCounts[0] ?? 0
    const secondLargestComponentCells = sortedComponentCellCounts[1] ?? 0
    const largestShareOfLand = largestComponentCells / Math.max(1, landCells)
    const secondLargestShareOfLand = secondLargestComponentCells / Math.max(1, landCells)
    const dominanceRatio =
      largestComponentCells / Math.max(1, secondLargestComponentCells)

    const targetLargestShare = Math.max(0.42, 0.62 - (minContinents - 1) * 0.05)
    const dominantLargestPenalty =
      largestShareOfLand > targetLargestShare
        ? Math.pow(largestShareOfLand - targetLargestShare, 2) * 38000
        : 0
    const weakSecondMassPenalty =
      secondLargestShareOfLand < 0.12 && components.length >= minContinents
        ? (0.12 - secondLargestShareOfLand) * 5200
        : 0
    const dominanceRatioPenalty =
      dominanceRatio > 3.4 ? Math.pow(dominanceRatio - 3.4, 2) * 320 : 0

    const separationMetrics = computeContinentSeparationMetrics(
      components,
      minContinents,
      field.cols,
      field.rows,
    )
    const targetMinContinentSeparation =
      minContinents >= 4 ? 0.18 : minContinents >= 3 ? 0.165 : 0.14
    const targetMeanNearestSeparation = targetMinContinentSeparation * 1.4
    const minSeparationPenalty =
      separationMetrics.minContinentSeparation < targetMinContinentSeparation
        ? Math.pow(
            targetMinContinentSeparation - separationMetrics.minContinentSeparation,
            2,
          ) * 68000
        : 0
    const nearestSeparationPenalty =
      separationMetrics.meanNearestContinentSeparation < targetMeanNearestSeparation
        ? Math.pow(
            targetMeanNearestSeparation - separationMetrics.meanNearestContinentSeparation,
            2,
          ) * 36000
        : 0

    const score =
      componentScore -
      targetPenalty -
      tooMuchLandPenalty -
      tooLittleLandPenalty -
      dominantLargestPenalty -
      weakSecondMassPenalty -
      minSeparationPenalty -
      nearestSeparationPenalty -
      dominanceRatioPenalty -
      i

    candidates.push({ threshold, components, landFraction, score })
  }

  return candidates.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score
    }

    return left.threshold - right.threshold
  })
}

function computeCandidateBalanceMetrics(
  candidate: ThresholdCandidate,
  minContinents: number,
  cols: number,
  rows: number,
): CandidateBalanceMetrics {
  let landCells = 0
  for (let index = 0; index < candidate.components.length; index += 1) {
    landCells += candidate.components[index].cellCount
  }

  if (landCells <= 0) {
    return {
      largestShareOfLand: 0,
      secondLargestShareOfLand: 0,
      dominanceRatio: 0,
      minContinentSeparation: 1,
      meanNearestContinentSeparation: 1,
    }
  }

  const sortedComponentCellCounts = [...candidate.components]
    .map((component) => component.cellCount)
    .sort((left, right) => right - left)
  const largestComponentCells = sortedComponentCellCounts[0] ?? 0
  const secondLargestComponentCells = sortedComponentCellCounts[1] ?? 0

  const separationMetrics = computeContinentSeparationMetrics(
    candidate.components,
    minContinents,
    cols,
    rows,
  )

  return {
    largestShareOfLand: largestComponentCells / landCells,
    secondLargestShareOfLand: secondLargestComponentCells / landCells,
    dominanceRatio: largestComponentCells / Math.max(1, secondLargestComponentCells),
    minContinentSeparation: separationMetrics.minContinentSeparation,
    meanNearestContinentSeparation: separationMetrics.meanNearestContinentSeparation,
  }
}

function selectBalancedThresholdCandidate(
  candidates: ThresholdCandidate[],
  minContinents: number,
  cols: number,
  rows: number,
): ThresholdCandidate | undefined {
  if (candidates.length === 0) {
    return undefined
  }

  const strictLargestShare = minContinents >= 3 ? 0.58 : 0.66
  const strictSecondLargestShare = minContinents >= 3 ? 0.14 : 0.1
  const strictDominanceRatio = minContinents >= 3 ? 2.8 : 3.5
  const strictMinContinentSeparation = minContinents >= 4 ? 0.18 : minContinents >= 3 ? 0.165 : 0.14
  const strictMeanNearestSeparation = strictMinContinentSeparation * 1.4
  const relaxedLargestShare = strictLargestShare + 0.08
  const relaxedSecondLargestShare = Math.max(0.06, strictSecondLargestShare - 0.04)
  const relaxedDominanceRatio = strictDominanceRatio + 1.2
  const relaxedMinContinentSeparation = strictMinContinentSeparation - 0.03
  const relaxedMeanNearestSeparation = strictMeanNearestSeparation - 0.04

  const strictCandidate = candidates.find((candidate) => {
    if (candidate.components.length < minContinents) {
      return false
    }

    const metrics = computeCandidateBalanceMetrics(candidate, minContinents, cols, rows)
    return (
      metrics.largestShareOfLand <= strictLargestShare &&
      metrics.secondLargestShareOfLand >= strictSecondLargestShare &&
      metrics.dominanceRatio <= strictDominanceRatio &&
      metrics.minContinentSeparation >= strictMinContinentSeparation &&
      metrics.meanNearestContinentSeparation >= strictMeanNearestSeparation
    )
  })

  if (strictCandidate) {
    return strictCandidate
  }

  const relaxedCandidate = candidates.find((candidate) => {
    if (candidate.components.length < minContinents) {
      return false
    }

    const metrics = computeCandidateBalanceMetrics(candidate, minContinents, cols, rows)
    return (
      metrics.largestShareOfLand <= relaxedLargestShare &&
      metrics.secondLargestShareOfLand >= relaxedSecondLargestShare &&
      metrics.dominanceRatio <= relaxedDominanceRatio &&
      metrics.minContinentSeparation >= relaxedMinContinentSeparation &&
      metrics.meanNearestContinentSeparation >= relaxedMeanNearestSeparation
    )
  })

  return relaxedCandidate ?? candidates[0]
}

function sortComponentsForStability(components: LandMaskComponent[]): LandMaskComponent[] {
  return [...components].sort((left, right) => {
    if (left.cellCount !== right.cellCount) {
      return right.cellCount - left.cellCount
    }

    if (left.centroidY !== right.centroidY) {
      return left.centroidY - right.centroidY
    }

    return left.centroidX - right.centroidX
  })
}

function componentToShape(
  component: LandMaskComponent,
  id: string,
  type: 'continent' | 'island',
  config: WorldConfig,
  field: MaskField,
): LandMassShape {
  const worldCellWidth = config.width / field.cols
  const worldCellHeight = config.height / field.rows
  const area = component.cellCount * worldCellWidth * worldCellHeight
  const centerX = (component.centroidX + 0.5) * worldCellWidth
  const centerY = (component.centroidY + 0.5) * worldCellHeight
  const radiusX = Math.max(1, ((component.maxCol - component.minCol + 1) * worldCellWidth) / 2)
  const radiusY = Math.max(1, ((component.maxRow - component.minRow + 1) * worldCellHeight) / 2)
  const maskWidth = component.maxCol - component.minCol + 1
  const maskHeight = component.maxRow - component.minRow + 1
  const maskOccupancy = new Uint8Array(maskWidth * maskHeight)

  for (let i = 0; i < component.cellIndices.length; i += 1) {
    const index = component.cellIndices[i]
    const row = Math.floor(index / field.cols)
    const col = index - row * field.cols
    const localX = col - component.minCol
    const localY = row - component.minRow
    maskOccupancy[localY * maskWidth + localX] = 1
  }

  return {
    id,
    type,
    area,
    centerX,
    centerY,
    radiusX,
    radiusY,
    targetCountyCount:
      type === 'continent'
        ? Math.max(30, Math.round(area * config.countyDensity))
        : Math.max(1, Math.round(area * config.countyDensity)),
    maskOffsetX: component.minCol,
    maskOffsetY: component.minRow,
    maskWidth,
    maskHeight,
    maskOccupancy,
  }
}

export function pointInLandMass(
  x: number,
  y: number,
  landMass: LandMassShape,
): boolean {
  if (landMass.maskWidth <= 0 || landMass.maskHeight <= 0) {
    return false
  }

  const worldCellWidth = (landMass.radiusX * 2) / landMass.maskWidth
  const worldCellHeight = (landMass.radiusY * 2) / landMass.maskHeight
  const minWorldX = landMass.centerX - landMass.radiusX
  const minWorldY = landMass.centerY - landMass.radiusY

  const localCol = Math.floor((x - minWorldX) / Math.max(1e-6, worldCellWidth))
  const localRow = Math.floor((y - minWorldY) / Math.max(1e-6, worldCellHeight))

  if (
    localCol < 0 ||
    localCol >= landMass.maskWidth ||
    localRow < 0 ||
    localRow >= landMass.maskHeight
  ) {
    return false
  }

  return landMass.maskOccupancy[localRow * landMass.maskWidth + localCol] === 1
}

export function getLandMassIdAtPoint(
  x: number,
  y: number,
  landMasses: LandMassShape[],
): string | null {
  let winningId: string | null = null
  let winningScore = Number.POSITIVE_INFINITY

  landMasses.forEach((landMass) => {
    if (!pointInLandMass(x, y, landMass)) {
      return
    }

    const normalizedX = (x - landMass.centerX) / Math.max(1e-6, landMass.radiusX)
    const normalizedY = (y - landMass.centerY) / Math.max(1e-6, landMass.radiusY)
    const score = normalizedX * normalizedX + normalizedY * normalizedY

    if (score < winningScore) {
      winningScore = score
      winningId = landMass.id
    }
  })

  return winningId
}

export function generateLandMassShapes(
  config: WorldConfig,
  random: SeededRandom,
): LandMassShape[] {
  const field = buildField(config, random)
  const minContinents = Math.max(2, Math.floor(config.minContinents))
  const maxContinents = Math.max(minContinents, Math.floor(config.maxContinents))
  const minIslands = Math.max(0, Math.floor(config.minIslands))
  const maxIslands = Math.max(minIslands, Math.floor(config.maxIslands))

  const continentCount = random.int(minContinents, maxContinents)
  const islandCount = random.int(minIslands, maxIslands)
  const candidates = buildThresholdCandidates(field, config)
  const selectedCandidate = selectBalancedThresholdCandidate(
    candidates,
    minContinents,
    field.cols,
    field.rows,
  )
  const components = sortComponentsForStability(selectedCandidate?.components ?? [])

  if (components.length === 0) {
    return []
  }

  const minimumContinents = Math.min(minContinents, components.length)
  const reservableIslands = Math.max(0, components.length - minimumContinents)
  const reservedIslands = Math.min(Math.max(1, minIslands), reservableIslands)
  let continentSlots = Math.min(continentCount, components.length - reservedIslands)
  continentSlots = Math.max(minimumContinents, continentSlots)

  const continentComponents = components.slice(0, continentSlots)
  const islandPool = components.slice(continentComponents.length)
  const islandComponents = islandPool.slice(0, Math.min(islandCount, islandPool.length))

  const shapes: LandMassShape[] = []

  for (let index = 0; index < continentComponents.length; index += 1) {
    shapes.push(
      componentToShape(
        continentComponents[index],
        `lm-continent-${index + 1}`,
        'continent',
        config,
        field,
      ),
    )
  }

  for (let index = 0; index < islandComponents.length; index += 1) {
    shapes.push(
      componentToShape(
        islandComponents[index],
        `lm-island-${index + 1}`,
        'island',
        config,
        field,
      ),
    )
  }

  if (islandComponents.length < minIslands && islandPool.length > islandComponents.length) {
    const needed = minIslands - islandComponents.length
    for (
      let index = 0;
      index < needed && index + islandComponents.length < islandPool.length;
      index += 1
    ) {
      const poolIndex = islandComponents.length + index
      shapes.push(
        componentToShape(
          islandPool[poolIndex],
          `lm-island-${islandComponents.length + index + 1}`,
          'island',
          config,
          field,
        ),
      )
    }
  }

  return shapes
}

export function toLandMassRecords(
  shapes: LandMassShape[],
  countyIdsByLandMass: Map<string, string[]>,
): LandMass[] {
  return shapes.map((shape) => ({
    id: shape.id,
    type: shape.type,
    area: shape.area,
    countyIds: countyIdsByLandMass.get(shape.id) ?? [],
  }))
}
