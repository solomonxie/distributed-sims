// Deterministic string hashes for demos (FNV-1a + murmur3 finaliser).

export function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix(h);
}

export function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** i-th independent hash of s in [0, mod). */
export function hashN(s: string, i: number, mod: number): number {
  return fnv1a(s, (0x811c9dc5 ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0) % mod;
}

export function hex4(s: string): string {
  return fnv1a(s).toString(16).padStart(8, '0').slice(0, 4);
}

export function bits(n: number, width: number): string {
  return (n >>> 0).toString(2).padStart(32, '0').slice(32 - width);
}
