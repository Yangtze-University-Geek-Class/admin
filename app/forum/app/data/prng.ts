/**
 * Seeded pseudo-random generator (mulberry32). The seed data must be identical
 * on every load, so nothing under `app/` may use the global random source;
 * every "random" choice goes through an instance of this.
 */
export interface Prng {
  /** Uniform float in `[0, 1)`. */
  next: () => number
  /** Uniform integer in `[min, max]`, both ends inclusive. */
  int: (min: number, max: number) => number
  /** One element of a non-empty array. */
  pick: <T>(items: readonly T[]) => T
  /** A shuffled copy (Fisher–Yates). */
  shuffle: <T>(items: readonly T[]) => T[]
  /** `true` with probability `p`. */
  chance: (p: number) => boolean
}

export function mulberry32(seed: number): Prng {
  let a = seed >>> 0

  const next = (): number => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const int = (min: number, max: number): number => {
    const lo = Math.ceil(min)
    const hi = Math.floor(max)
    return lo + Math.floor(next() * (hi - lo + 1))
  }

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0)
      throw new Error('Prng.pick: cannot pick from an empty array')
    return items[int(0, items.length - 1)] as T
  }

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i)
      const tmp = copy[i] as T
      copy[i] = copy[j] as T
      copy[j] = tmp
    }
    return copy
  }

  const chance = (p: number): boolean => next() < p

  return { next, int, pick, shuffle, chance }
}
