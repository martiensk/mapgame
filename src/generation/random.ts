export interface SeededRandom {
  next: () => number
  int: (minimum: number, maximum: number) => number
  float: (minimum: number, maximum: number) => number
}

function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createMulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state += 0x6d2b79f5
    let result = Math.imul(state ^ (state >>> 15), 1 | state)
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

export function createSeededRandom(seed: string): SeededRandom {
  const generator = createMulberry32(hashSeed(seed))

  return {
    next: () => generator(),
    int: (minimum: number, maximum: number) => {
      const normalizedMinimum = Math.ceil(minimum)
      const normalizedMaximum = Math.floor(maximum)
      return (
        Math.floor(generator() * (normalizedMaximum - normalizedMinimum + 1)) +
        normalizedMinimum
      )
    },
    float: (minimum: number, maximum: number) => {
      return minimum + (maximum - minimum) * generator()
    },
  }
}
