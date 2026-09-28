// 'Probabilistic' algorithm demos: Bloom filter, count-min sketch, HyperLogLog.
import { registerDemo, type PanelRow, type Shape, type Tone } from './frames';
import { bits, fnv1a, hashN } from './lib/hash';
import { frame, text } from './lib/draw';

const pct = (p: number) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`;

// ---- Bloom filter ----

export class Bloom {
  readonly bits: number[];

  constructor(readonly m: number, readonly k: number) {
    this.bits = new Array(m).fill(0);
  }

  /** k distinct bit positions (linear probe on collision). */
  indexes(s: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.k; i++) {
      let j = hashN(s, i, this.m);
      while (out.includes(j) && out.length < this.m) j = (j + 1) % this.m;
      out.push(j);
    }
    return out;
  }

  add(s: string): number[] {
    const idx = this.indexes(s);
    for (const i of idx) this.bits[i] = 1;
    return idx;
  }

  has(s: string): boolean {
    return this.indexes(s).every(i => this.bits[i] === 1);
  }
}

export const bloomFpRate = (m: number, k: number, n: number) => Math.pow(1 - Math.exp((-k * n) / m), k);

interface BloomInput {
  m: number;
  k: number;
  add: string[];
}

const CANDIDATES = ['owl', 'ant', 'bee', 'elk', 'fox', 'gnu', 'hen', 'jay', 'yak', 'emu', 'ram', 'pig', 'rat', 'bat', 'eel', 'cod', 'ape', 'koi', 'asp', 'boa', 'cub', 'doe', 'ewe', 'kid', 'orca', 'mole', 'lynx', 'moth', 'newt', 'puma', 'seal', 'swan', 'toad', 'wolf', 'wren', 'crab', 'deer', 'duck', 'frog', 'goat', 'hare', 'lark', 'lion', 'mink', 'mule', 'slug', 'tuna', 'vole'];

registerDemo({
  slug: 'bloom-filter',
  title: 'Bloom filter',
  group: 'Probabilistic',
  summary: 'k hashes set k bits per item. A query with any 0 bit is definitely absent; all 1s means "maybe", with a false-positive rate that grows as it fills.',
  linkedFrom: ['Web crawler', 'LSM'],
  editable: 'none',
  inputs: [
    { id: 'm16', label: 'm=16, k=3', data: { m: 16, k: 3, add: ['cat', 'dog', 'fish', 'bird', 'cow'] } satisfies BloomInput },
    { id: 'm32', label: 'm=32, k=2', data: { m: 32, k: 2, add: ['cat', 'dog', 'fish', 'bird', 'cow', 'hawk', 'bear', 'mouse'] } satisfies BloomInput },
  ],
  *run(raw) {
    const inp = (raw ?? { m: 16, k: 3, add: ['cat', 'dog', 'fish'] }) as BloomInput;
    const { m, k } = inp;
    const bf = new Bloom(m, k);
    const perRow = 8;
    const cw = 105;
    const top = Math.max(300, 560 - Math.ceil(m / perRow) * 70);
    const cellX = (j: number) => 80 + (j % perRow) * cw;
    const cellY = (j: number) => top + Math.floor(j / perRow) * 140;
    let n = 0;

    const draw = (word: string, hi: Map<number, Tone>, verdict?: { t: string; tone: Tone }, hashOf?: Map<number, number>): Shape[] => {
      const s: Shape[] = [
        text('hdr', 500, 60, `m = ${m} bits · k = ${k} hashes · n = ${n}`, { size: 30, mono: true, tone: 'default' }),
      ];
      if (word) s.push(text('word', 500, 150, word, { size: 40, bold: true, tone: verdict ? 'default' : 'current' }));
      if (verdict) s.push(text('verdict', 500, 220, verdict.t, { size: 34, bold: true, tone: verdict.tone }));
      for (let j = 0; j < m; j++) {
        const h = hashOf?.get(j);
        s.push({ t: 'rect', id: `b${j}`, x: cellX(j) + 4, y: cellY(j), w: cw - 8, h: 84, mono: true, label: String(bf.bits[j]), sub: h !== undefined ? `h${h + 1}` : undefined, tone: hi.get(j) ?? (bf.bits[j] ? 'default' : 'muted'), filled: bf.bits[j] === 1 || hi.has(j) });
        s.push(text(`i${j}`, cellX(j) + cw / 2, cellY(j) + 108, String(j), { size: 24, tone: 'muted' }));
      }
      const fp = bloomFpRate(m, k, n);
      s.push(text('fml', 500, 930, `FP ≈ (1 − e^(−${k}·${n}/${m}))^${k} = ${pct(fp)}`, { size: 30, mono: true }));
      return s;
    };
    const panel = (extra: PanelRow[] = []) => ({
      title: 'Bloom filter',
      rows: [
        { label: 'n / m / k', value: `${n} / ${m} / ${k}` },
        { label: 'Bits set', value: `${bf.bits.filter(b => b).length} / ${m}` },
        { label: 'FP rate', value: pct(bloomFpRate(m, k, n)), tone: 'warn' as Tone },
        ...extra,
      ],
    });

    yield frame(`An empty Bloom filter: ${m} bits, all 0. Each item sets ${k} bits chosen by ${k} hash functions.`, draw('', new Map()), panel());

    for (const w of inp.add) {
      const idx = bf.indexes(w);
      n++;
      bf.add(w);
      yield frame(
        `Add "${w}": ${idx.map((i, h) => `h${h + 1}=${i}`).join(', ')} → set those bits. FP rate is now ${pct(bloomFpRate(m, k, n))}.`,
        draw(`add "${w}"`, new Map(idx.map(i => [i, 'current'] as const)), undefined, new Map(idx.map((i, h) => [i, h] as const))),
        panel(),
      );
    }

    const added = new Set(inp.add);
    const pool = CANDIDATES.filter(c => !added.has(c));
    const neg = pool.find(c => !bf.has(c));
    const fp = pool.find(c => bf.has(c));
    const queries: { w: string; kind: 'tp' | 'neg' | 'fp' }[] = [{ w: inp.add[Math.min(1, inp.add.length - 1)], kind: 'tp' }];
    if (neg) queries.push({ w: neg, kind: 'neg' });
    if (fp) queries.push({ w: fp, kind: 'fp' });

    for (const q of queries) {
      const idx = bf.indexes(q.w);
      const vals = idx.map(i => bf.bits[i]);
      const hi = new Map(idx.map(i => [i, (bf.bits[i] ? 'ok' : 'fail') as Tone] as const));
      const hashes = new Map(idx.map((i, h) => [i, h] as const));
      const got = `${idx.map((i, h) => `h${h + 1}=${i}`).join(', ')} → ${vals.join(',')}`;
      if (q.kind === 'tp') {
        yield frame(`Query "${q.w}": ${got}. All 1s → "maybe", and it really was added.`, draw(`query "${q.w}"`, hi, { t: 'all 1s: maybe present', tone: 'ok' }, hashes), panel());
      } else if (q.kind === 'neg') {
        yield frame(`Query "${q.w}": ${got}. A 0 bit means definitely absent; no false negatives, ever.`, draw(`query "${q.w}"`, hi, { t: 'a 0 bit: definitely absent', tone: 'fail' }, hashes), panel());
      } else {
        yield frame(`Query "${q.w}": ${got}. All 1s but "${q.w}" was never added: a false positive.`, draw(`query "${q.w}"`, hi, { t: 'all 1s: false positive', tone: 'warn' }, hashes), panel());
      }
    }

    const fill = bf.bits.filter(b => b).length;
    yield frame(
      `${n} items filled ${fill} of ${m} bits; predicted FP rate ${pct(bloomFpRate(m, k, n))}. Bigger m, or k ≈ (m/n)·ln 2 = ${((m / n) * Math.LN2).toFixed(1)}, keeps it low.`,
      draw('', new Map()),
      panel([
        { label: 'Checked', value: `${queries.length} queries` },
        { label: 'False pos', value: fp ? `"${fp}"` : 'none found', tone: 'warn' },
      ]),
      true,
    );
  },
});

// ---- count-min sketch ----

interface CmsInput {
  d: number;
  w: number;
  stream: string[];
}

registerDemo({
  slug: 'count-min-sketch',
  title: 'Count-min sketch',
  group: 'Probabilistic',
  summary: 'd rows of w counters; each item bumps one counter per row. The estimate is the minimum across rows: never too low, sometimes too high.',
  linkedFrom: ['Telemetry', 'Top-K'],
  editable: 'none',
  inputs: [
    { id: 'tags', label: 'Hashtags (3 × 8)', data: { d: 3, w: 8, stream: ['cat', 'dog', 'cat', 'owl', 'cat', 'dog', 'emu', 'owl', 'cat', 'fox', 'dog', 'cat', 'yak', 'bee'] } satisfies CmsInput },
    { id: 'narrow', label: 'Narrow (2 × 5)', data: { d: 2, w: 5, stream: ['a', 'b', 'a', 'c', 'a', 'd', 'b', 'e', 'a', 'f'] } satisfies CmsInput },
  ],
  *run(raw) {
    const inp = (raw ?? { d: 3, w: 8, stream: ['cat', 'dog', 'cat'] }) as CmsInput;
    const { d, w, stream } = inp;
    const grid: number[][] = Array.from({ length: d }, () => new Array(w).fill(0));
    const truth = new Map<string, number>();
    const cw = Math.min(100, 760 / w);
    const x0 = 160 + (760 - cw * w) / 2;
    const cx = (c: number) => x0 + c * cw;
    const cy = (r: number) => 330 + r * 130;
    const col = (s: string, r: number) => fnv1a(`${s}#${r}`) % w;
    const estimate = (s: string) => Math.min(...grid.map((row, r) => row[col(s, r)]));

    const draw = (item: string, hi: Map<string, Tone>, sub?: string): Shape[] => {
      const s: Shape[] = [];
      if (item) s.push(text('item', 500, 120, item, { size: 40, bold: true, tone: 'current' }));
      if (sub) s.push(text('sub', 500, 200, sub, { size: 32, mono: true }));
      for (let c = 0; c < w; c++) s.push(text(`col${c}`, cx(c) + cw / 2, 300, String(c), { size: 24, tone: 'muted' }));
      for (let r = 0; r < d; r++) {
        s.push(text(`row${r}`, x0 - 24, cy(r) + 50, `h${r + 1}`, { size: 30, align: 'right', mono: true }));
        for (let c = 0; c < w; c++) {
          const key = `${r},${c}`;
          s.push({ t: 'rect', id: `c${r}_${c}`, x: cx(c) + 4, y: cy(r), w: cw - 8, h: 100, mono: true, label: String(grid[r][c]), tone: hi.get(key) ?? (grid[r][c] ? 'default' : 'muted'), filled: grid[r][c] > 0 || hi.has(key) });
        }
      }
      s.push(text('leg', 500, cy(d) + 40, `estimate(x) = min over ${d} rows`, { size: 28, tone: 'default' }));
      s.push(text('leg2', 500, cy(d) + 90, `memory: ${d} × ${w} = ${d * w} counters`, { size: 26, tone: 'muted' }));
      return s;
    };
    const panel = (extra: PanelRow[] = []) => ({
      title: 'True counts',
      rows: [...[...truth].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: `true ${v} · est ${estimate(k)}`, tone: (estimate(k) > v ? 'warn' : undefined) as Tone | undefined })), ...extra],
    });

    yield frame(`A count-min sketch with ${d} rows × ${w} counters, all 0. Each row has its own hash function.`, draw('', new Map()), panel());

    for (const s of stream) {
      const cols = grid.map((_, r) => col(s, r));
      cols.forEach((c, r) => grid[r][c]++);
      truth.set(s, (truth.get(s) ?? 0) + 1);
      yield frame(
        `Add "${s}": ${cols.map((c, r) => `h${r + 1}→${c}`).join(', ')}; each counter +1.`,
        draw(`add "${s}"`, new Map(cols.map((c, r) => [`${r},${c}`, 'current'] as const))),
        panel(),
      );
    }

    const top = [...truth].sort((a, b) => b[1] - a[1])[0][0];
    const over = [...truth.keys()].find(k => estimate(k) > truth.get(k)!) ?? CANDIDATES.find(k => !truth.has(k) && estimate(k) > 0);
    const queries = [top, ...(over && over !== top ? [over] : [])];
    for (const q of queries) {
      const vals = grid.map((row, r) => row[col(q, r)]);
      const est = Math.min(...vals);
      const t = truth.get(q) ?? 0;
      const hi = new Map(vals.map((v, r) => [`${r},${col(q, r)}`, (v === est ? 'ok' : 'warn') as Tone] as const));
      yield frame(
        est > t
          ? `Estimate "${q}" = min(${vals.join(', ')}) = ${est}, but true count is ${t}. Every row collided with another item: an overestimate.`
          : `Estimate "${q}" = min(${vals.join(', ')}) = ${est}; true count ${t}. The min discards rows inflated by collisions.`,
        draw(`count "${q}"`, hi, `min(${vals.join(', ')}) = ${est}`),
        panel([{ label: 'Query', value: `${q}: ${est} (true ${t})`, tone: est > t ? 'warn' : 'ok' }]),
      );
    }

    yield frame(
      `${stream.length} updates in ${d * w} counters. Error ≤ ${(Math.E / w).toFixed(2)}·N with probability 1 − e^−${d} ≈ ${pct(1 - Math.exp(-d))}; widen w or add rows to tighten.`,
      draw('', new Map()),
      panel(),
      true,
    );
  },
});

// ---- HyperLogLog ----

interface HllInput {
  p: number;
  first: number;
  total: number;
}

const alpha = (m: number) => (m <= 16 ? 0.673 : m <= 32 ? 0.697 : m <= 64 ? 0.709 : 0.7213 / (1 + 1.079 / m));

function hllEstimate(reg: number[]) {
  const m = reg.length;
  const sum = reg.reduce((s, r) => s + Math.pow(2, -r), 0);
  const raw = (alpha(m) * m * m) / sum;
  const zeros = reg.filter(r => r === 0).length;
  if (raw <= 2.5 * m && zeros > 0) return { est: m * Math.log(m / zeros), raw, sum, zeros, linear: true };
  return { est: raw, raw, sum, zeros, linear: false };
}

registerDemo({
  slug: 'hyperloglog',
  title: 'HyperLogLog',
  group: 'Probabilistic',
  summary: 'Hash each item; the first bits pick a register, the rest\'s leading zeros hint at how many distinct items were seen. Registers keep the max.',
  linkedFrom: ['Telemetry', 'Top-K'],
  editable: 'none',
  inputs: [
    { id: 'u200', label: '200 users', data: { p: 4, first: 8, total: 200 } satisfies HllInput },
    { id: 'u1000', label: '1,000 users', data: { p: 4, first: 8, total: 1000 } satisfies HllInput },
  ],
  *run(raw) {
    const inp = (raw ?? { p: 4, first: 8, total: 200 }) as HllInput;
    const { p, first, total } = inp;
    const m = 1 << p;
    const reg = new Array(m).fill(0);
    const seen = new Set<string>();
    const perRow = Math.min(8, m);
    const cw = 840 / perRow;
    const rx = (j: number) => 80 + (j % perRow) * cw;
    const ry = (j: number) => 420 + Math.floor(j / perRow) * 150;

    const split = (item: string) => {
      const h = fnv1a(`a:${item}`);
      const bucket = h >>> (32 - p);
      const rest = (h << p) >>> 0;
      const restBits = 32 - p;
      let lz = 0;
      while (lz < restBits && ((rest >>> (31 - lz)) & 1) === 0) lz++;
      return { h, bucket, rho: lz + 1, lz, restStr: bits(h, 32).slice(p) };
    };
    const draw = (item: string, cur: number | undefined, hash?: string): Shape[] => {
      const s: Shape[] = [];
      if (item) s.push(text('item', 500, 90, item, { size: 40, bold: true, tone: 'current' }));
      if (hash) s.push(text('hash', 500, 180, hash, { size: 34, mono: true }));
      if (hash) s.push(text('hleg', 500, 240, `first ${p} bits = register · leading zeros of the rest → ρ`, { size: 24, tone: 'default' }));
      for (let j = 0; j < m; j++) {
        s.push({ t: 'rect', id: `r${j}`, x: rx(j) + 4, y: ry(j), w: cw - 8, h: 90, mono: true, label: String(reg[j]), tone: j === cur ? 'current' : reg[j] ? 'default' : 'muted', filled: reg[j] > 0 || j === cur });
        s.push(text(`ri${j}`, rx(j) + cw / 2, ry(j) + 114, String(j), { size: 24, tone: 'muted' }));
      }
      s.push(text('rlabel', 80, 380, `${m} registers (max ρ seen)`, { size: 26, align: 'left', tone: 'default' }));
      const e = hllEstimate(reg);
      const ey = ry(m - 1) + 200;
      s.push(text('est', 500, ey, `E = α·m² / Σ2^−M = ${alpha(m)}·${m * m} / ${e.sum.toFixed(2)} = ${e.raw.toFixed(1)}`, { size: 26, mono: true }));
      if (e.linear) s.push(text('lin', 500, ey + 60, `${e.zeros} empty → linear count m·ln(m/V) = ${e.est.toFixed(1)}`, { size: 26, mono: true, tone: 'warn' }));
      return s;
    };
    const panel = (extra: PanelRow[] = []) => {
      const e = hllEstimate(reg);
      return {
        title: 'HyperLogLog',
        rows: [
          { label: 'True distinct', value: String(seen.size) },
          { label: 'Estimate', value: e.est.toFixed(1), tone: 'accent' as Tone },
          { label: 'Empty regs', value: `${e.zeros} / ${m}` },
          ...extra,
        ],
      };
    };

    yield frame(`${m} registers, all 0. Each item's hash picks a register with its first ${p} bits; the rest's leading zeros give ρ.`, draw('', undefined), panel());

    const addOne = (item: string) => {
      const sp = split(item);
      const old = reg[sp.bucket];
      reg[sp.bucket] = Math.max(old, sp.rho);
      seen.add(item);
      return { ...sp, old };
    };

    for (let i = 1; i <= first; i++) {
      const item = `u${i}`;
      const r = addOne(item);
      const hashStr = `${bits(r.h, 32).slice(0, p)} | ${r.restStr.slice(0, 14)}…`;
      yield frame(
        `"${item}" → register ${r.bucket}, ${r.lz} leading zero${r.lz === 1 ? '' : 's'} so ρ = ${r.rho}. Register ${r.bucket} = max(${r.old}, ${r.rho}) = ${reg[r.bucket]}.`,
        draw(`add "${item}"`, r.bucket, hashStr),
        panel(),
      );
    }

    const dup = `u${Math.min(3, first)}`;
    const rd = addOne(dup);
    yield frame(
      `Add "${dup}" again: same hash, same register ${rd.bucket}, same ρ = ${rd.rho}. Duplicates never change the registers.`,
      draw(`add "${dup}" (dup)`, rd.bucket, `${bits(rd.h, 32).slice(0, p)} | ${rd.restStr.slice(0, 14)}…`),
      panel(),
    );

    const e0 = hllEstimate(reg);
    yield frame(
      e0.linear
        ? `With ${seen.size} items, ${e0.zeros} registers are still empty, so use linear counting: ${m}·ln(${m}/${e0.zeros}) = ${e0.est.toFixed(1)}.`
        : `Raw estimate ${e0.raw.toFixed(1)} for ${seen.size} true distinct items.`,
      draw('', undefined),
      panel(),
    );

    for (let i = first + 1; i <= total; i++) addOne(`u${i}`);
    yield frame(
      `Fast-forward: add u${first + 1}…u${total}. Registers now hold max ρ values ${Math.min(...reg)}–${Math.max(...reg)}.`,
      draw(`+${total - first} users`, undefined),
      panel(),
    );

    const e = hllEstimate(reg);
    const err = (e.est - total) / total;
    yield frame(
      `Estimate ${e.est.toFixed(0)} vs true ${total} (${err >= 0 ? '+' : ''}${(err * 100).toFixed(1)}%). Standard error 1.04/√${m} = ${pct(1.04 / Math.sqrt(m))}, using just ${m} small registers.`,
      draw('', undefined),
      panel([{ label: 'Error', value: `${(err * 100).toFixed(1)}%`, tone: Math.abs(err) < 0.26 ? 'ok' : 'warn' }, { label: 'Std error', value: pct(1.04 / Math.sqrt(m)) }]),
      true,
    );
  },
});
