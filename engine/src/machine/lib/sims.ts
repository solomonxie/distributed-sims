// Pure step simulators behind the machine demos (deterministic, testable).

// ---------- set-associative LRU cache ----------
export interface CacheCfg {
  lineBytes: number;
  sets: number;
  ways: number;
}

export const L1D: CacheCfg = { lineBytes: 64, sets: 64, ways: 8 }; // 32 KB

export class Cache {
  private sets: number[][];
  constructor(readonly cfg: CacheCfg) {
    this.sets = Array.from({ length: cfg.sets }, () => []);
  }
  lineOf(addr: number) {
    return Math.floor(addr / this.cfg.lineBytes);
  }
  /** true on hit; LRU order kept with MRU at the end */
  access(addr: number): boolean {
    const line = this.lineOf(addr);
    const set = this.sets[line % this.cfg.sets];
    const i = set.indexOf(line);
    if (i >= 0) {
      set.splice(i, 1);
      set.push(line);
      return true;
    }
    set.push(line);
    if (set.length > this.cfg.ways) set.shift();
    return false;
  }
  lines(): number[] {
    return this.sets.flat();
  }
}

/** Addresses of an n×n array of elemBytes ints walked row- or column-major. */
export function traversal(order: 'row' | 'col', n: number, elemBytes = 4): number[] {
  const out: number[] = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) out.push(((order === 'row' ? a * n + b : b * n + a) * elemBytes));
  return out;
}

export function missRate(order: 'row' | 'col', n = 512, cfg: CacheCfg = L1D): number {
  const c = new Cache(cfg);
  let miss = 0;
  const addrs = traversal(order, n);
  for (const a of addrs) if (!c.access(a)) miss++;
  return miss / addrs.length;
}

// ---------- page replacement ----------
export type Policy = 'fifo' | 'lru' | 'clock';

export interface RepStep {
  ref: number;
  frames: (number | null)[];
  fault: boolean;
  slot: number;
  victim?: number;
  hand?: number;
  refBits?: boolean[];
}

export const STANDARD_REFS = [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1];
export const BELADY_REFS = [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5];

export function replace(policy: Policy, refs: number[], nFrames: number): { steps: RepStep[]; faults: number } {
  const frames: (number | null)[] = Array(nFrames).fill(null);
  const loadedAt: number[] = Array(nFrames).fill(0);
  const usedAt: number[] = Array(nFrames).fill(0);
  const bits: boolean[] = Array(nFrames).fill(false);
  let hand = 0;
  let faults = 0;
  const steps: RepStep[] = [];
  refs.forEach((ref, t) => {
    let slot = frames.indexOf(ref);
    const fault = slot < 0;
    let victim: number | undefined;
    if (fault) {
      faults++;
      slot = frames.indexOf(null);
      if (policy === 'clock') {
        if (slot < 0) {
          while (bits[hand]) {
            bits[hand] = false;
            hand = (hand + 1) % nFrames;
          }
          slot = hand;
        }
        hand = (slot + 1) % nFrames;
      } else if (slot < 0) {
        const key = policy === 'fifo' ? loadedAt : usedAt;
        slot = key.indexOf(Math.min(...key));
      }
      if (frames[slot] !== null) victim = frames[slot]!;
      frames[slot] = ref;
      loadedAt[slot] = t + 1;
    }
    usedAt[slot] = t + 1;
    bits[slot] = true;
    steps.push({ ref, frames: [...frames], fault, slot, victim, hand: policy === 'clock' ? hand : undefined, refBits: policy === 'clock' ? [...bits] : undefined });
  });
  return { steps, faults };
}

// ---------- x86-64 4-level page walk ----------
export const WALK_VA = 0x7f3a2c41;
/** VPN → physical frame for the demo's page table */
export const PAGE_TABLE: Record<number, number> = { 0x7f3a2: 0x9c, 0x7f3a1: 0x12, 0x00044: 0x03 };

export function pageWalk(va: number, table = PAGE_TABLE) {
  const offset = va & 0xfff;
  const vpn = Math.floor(va / 0x1000);
  const idx = [Math.floor(vpn / 2 ** 27) & 0x1ff, Math.floor(vpn / 2 ** 18) & 0x1ff, Math.floor(vpn / 2 ** 9) & 0x1ff, vpn & 0x1ff];
  const frame = table[vpn];
  const pa = frame === undefined ? undefined : frame * 0x1000 + offset;
  return { vpn, offset, idx, frame, pa };
}

// ---------- MESI ----------
export type Mesi = 'M' | 'E' | 'S' | 'I';

export function mesi(states: Mesi[], core: number, op: 'read' | 'write'): { states: Mesi[]; hit: boolean; bus: string } {
  const s = [...states];
  const others = s.map((_, i) => i).filter((i) => i !== core);
  const mine = s[core];
  if (op === 'read') {
    if (mine !== 'I') return { states: s, hit: true, bus: '—' };
    const shared = others.filter((i) => s[i] !== 'I');
    const dirty = shared.some((i) => s[i] === 'M');
    for (const i of shared) s[i] = 'S';
    s[core] = shared.length ? 'S' : 'E';
    return { states: s, hit: false, bus: dirty ? 'BusRd + writeback' : 'BusRd' };
  }
  if (mine === 'M') return { states: s, hit: true, bus: '—' };
  if (mine === 'E') {
    s[core] = 'M';
    return { states: s, hit: true, bus: '— (silent E→M)' };
  }
  const dirty = others.some((i) => s[i] === 'M');
  for (const i of others) s[i] = 'I';
  s[core] = 'M';
  return { states: s, hit: false, bus: mine === 'S' ? 'BusUpgr' : dirty ? 'BusRdX + writeback' : 'BusRdX' };
}

// ---------- 5-stage in-order pipeline ----------
export interface Instr {
  text: string;
  dst?: string;
  src?: string[];
  load?: boolean;
}

export interface Sched {
  IF: number;
  ID: number;
  EX: number;
  MEM: number;
  WB: number;
}

/** Cycle each instruction enters each stage (1-based). Reg file writes in 1st half, reads in 2nd. */
export function pipeline(prog: Instr[], forwarding: boolean): Sched[] {
  const out: Sched[] = [];
  prog.forEach((ins, i) => {
    const prev = out[i - 1];
    const IF = prev ? prev.ID : 1;
    const ID = prev ? Math.max(IF + 1, prev.EX) : IF + 1;
    let ready = 0;
    for (let j = 0; j < i; j++) {
      const p = prog[j];
      if (!p.dst || !ins.src?.includes(p.dst)) continue;
      const s = out[j];
      ready = Math.max(ready, forwarding ? (p.load ? s.MEM + 1 : s.EX + 1) : s.WB + 1);
    }
    const EX = Math.max(ID + 1, prev ? prev.MEM : 0, ready);
    out.push({ IF, ID, EX, MEM: EX + 1, WB: EX + 2 });
  });
  return out;
}

export function stageAt(s: Sched, c: number): { st: string; stall: boolean } | undefined {
  if (c < s.IF || c > s.WB) return undefined;
  if (c < s.ID) return { st: 'IF', stall: c > s.IF };
  if (c < s.EX) return { st: 'ID', stall: c > s.ID };
  return { st: c === s.EX ? 'EX' : c === s.MEM ? 'MEM' : 'WB', stall: false };
}
