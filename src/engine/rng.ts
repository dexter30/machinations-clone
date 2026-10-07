/** Small seedable PRNG (mulberry32) so simulations can be reproduced. */
export class Rng {
  private s: number;
  constructor(seed?: number) {
    this.s = (seed && seed !== 0 ? seed : (Math.random() * 0xffffffff) >>> 0) >>> 0;
  }
  /** Float in [0,1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    if (hi < lo) [lo, hi] = [hi, lo];
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  /** Roll `n` dice with `sides` faces. */
  dice(n: number, sides: number): number {
    let total = 0;
    for (let i = 0; i < n; i++) total += this.int(1, sides);
    return total;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}
