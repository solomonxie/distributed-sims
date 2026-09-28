// xoshiro128** — deterministic, forkable.
export class Rng {
  private s: Uint32Array;

  constructor(seed: number | string) {
    this.s = new Uint32Array(4);
    let h = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
    for (let i = 0; i < 4; i++) {
      h = splitmix32(h);
      this.s[i] = h;
    }
    if (this.s.every(v => v === 0)) this.s[0] = 1;
  }

  fork(label: string): Rng {
    return new Rng((this.nextU32() ^ hashString(label)) >>> 0);
  }

  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  next(): number {
    return this.nextU32() / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Lognormal parameterised by its p50 and p99. */
  lognormal(p50: number, p99: number): number {
    if (p50 <= 0) return 0;
    const sigma = p99 > p50 ? Math.log(p99 / p50) / 2.326 : 0;
    return p50 * Math.exp(sigma * this.normal());
  }

  exp(mean: number): number {
    return -mean * Math.log(Math.max(this.next(), 1e-12));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Zipf over [0, n) with exponent s, via rejection-inversion approximation. */
  zipf(n: number, s: number): number {
    if (s <= 0) return this.int(n);
    const u = this.next();
    if (Math.abs(s - 1) < 1e-6) {
      return Math.min(n - 1, Math.floor(Math.exp(u * Math.log(n + 1)) - 1));
    }
    const a = 1 - s;
    const x = Math.pow(u * (Math.pow(n + 1, a) - 1) + 1, 1 / a) - 1;
    return Math.min(n - 1, Math.max(0, Math.floor(x)));
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

function splitmix32(a: number): number {
  a = (a + 0x9e3779b9) >>> 0;
  let z = a;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
