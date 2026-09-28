// 'storage' algorithm demos: LSM tree, B-tree, Merkle diff, trie top-K, inverted index.
import { registerDemo, type Frame, type PanelRow, type Shape, type Tone } from './frames';
import { frame, layoutTree, text } from './lib/draw';
import { hashN, hex4 } from './lib/hash';

// ---------------------------------------------------------------- LSM tree

type LsmOp = { op: 'put'; k: string; v: string } | { op: 'del'; k: string } | { op: 'get'; k: string };

interface LsmInput {
  memLimit: number;
  ops: LsmOp[];
}

interface Sst {
  id: string;
  name: string;
  entries: { k: string; v: string | null }[];
  bloom: Set<number>;
}

const BLOOM_M = 16;
const bloomIdx = (k: string) => [hashN(k, 0, BLOOM_M), hashN(k, 1, BLOOM_M)];

function* lsm(input: unknown): Generator<Frame> {
  const cfg = input as LsmInput;
  const limit = cfg.memLimit ?? 3;
  let mem = new Map<string, string | null>();
  let wal = 0;
  let l0: Sst[] = [];
  let l1: Sst[] = [];
  let sstSeq = 0;
  let userWrites = 0;
  let diskWrites = 0;
  let probes = 0;
  const tones = new Map<string, Tone>();
  let memTone: Tone = 'accent';
  let query = '';

  const entryStr = (k: string, v: string | null) => `${k}:${v === null ? '†' : v}`;
  const makeSst = (entries: { k: string; v: string | null }[]): Sst => {
    const bloom = new Set<number>();
    for (const e of entries) for (const i of bloomIdx(e.k)) bloom.add(i);
    sstSeq++;
    return { id: `sst:${sstSeq}`, name: `SST-${sstSeq}`, entries, bloom };
  };

  const row = (tables: Sst[], y: number): Shape[] => {
    const gap = 30;
    const w = Math.min(250, (800 - gap * Math.max(0, tables.length - 1)) / Math.max(1, tables.length));
    return tables.map((t, i) => ({
      t: 'rect', id: t.id, x: 100 + i * (w + gap), y, w, h: 110, label: t.name,
      sub: t.entries.map(e => entryStr(e.k, e.v)).join(' '), tone: tones.get(t.id) ?? 'default', mono: true, radius: 10,
    }));
  };

  const shapes = (): Shape[] => {
    const memSorted = [...mem.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const s: Shape[] = [
      { t: 'rect', id: 'wal', x: 100, y: 100, w: 340, h: 130, label: 'WAL (disk)', sub: `${wal} entr${wal === 1 ? 'y' : 'ies'}`, tone: 'muted', radius: 10 },
      {
        t: 'rect', id: 'mem', x: 520, y: 100, w: 380, h: 130, label: `Memtable ${mem.size}/${limit}`,
        sub: memSorted.map(([k, v]) => entryStr(k, v)).join(' ') || 'empty', tone: memTone, mono: true, radius: 10,
      },
      text('lbl-l0', 100, 310, 'L0 · newest first, may overlap', { tone: 'default', size: 28, align: 'left' }),
      text('lbl-l1', 100, 560, 'L1 · sorted, no overlap', { tone: 'default', size: 28, align: 'left' }),
      ...row(l0, 340),
      ...row(l1, 590),
    ];
    if (query) s.push(text('query', 500, 820, query, { size: 34, bold: true, mono: true }));
    return s;
  };

  const panel = () => {
    const rows: PanelRow[] = [
      { label: 'Memtable', value: `${mem.size}/${limit}` },
      { label: 'L0 tables', value: String(l0.length) },
      { label: 'L1 tables', value: String(l1.length) },
      { label: 'Write amp', value: userWrites ? `${(diskWrites / userWrites).toFixed(1)}× (${diskWrites}/${userWrites})` : '–' },
      { label: 'Tables probed', value: String(probes) },
    ];
    return { title: 'LSM state', rows };
  };

  const f = (note: string) => frame(note, shapes(), panel());

  yield f(`Writes go to a WAL on disk and a sorted in-memory memtable. When it holds ${limit} keys it is flushed as an immutable SSTable.`);

  for (const op of cfg.ops) {
    tones.clear();
    memTone = 'accent';
    query = '';
    if (op.op === 'put' || op.op === 'del') {
      const v = op.op === 'put' ? op.v : null;
      mem.set(op.k, v);
      wal++;
      userWrites++;
      diskWrites++;
      memTone = 'write';
      query = op.op === 'put' ? `put ${op.k}=${op.v}` : `delete ${op.k}`;
      yield f(
        op.op === 'put'
          ? `put ${op.k}=${op.v}: append to WAL, insert into memtable (${mem.size}/${limit}).`
          : `delete ${op.k}: write a tombstone ✝ — deletes are just writes in an LSM.`,
      );
      if (mem.size >= limit) {
        const entries = [...mem.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ k, v }));
        const t = makeSst(entries);
        l0.unshift(t);
        mem = new Map();
        wal = 0;
        diskWrites += entries.length;
        tones.set(t.id, 'current');
        memTone = 'accent';
        query = '';
        yield f(`Memtable full (${limit} keys) → flush as sorted ${t.name} in L0 and truncate the WAL. One sequential write, no in-place updates.`);
        if (l0.length >= 2) yield* compact();
      }
    } else {
      yield* get(op.k);
    }
  }
  tones.clear();
  memTone = 'accent';
  query = '';
  yield frame(
    `Done: ${userWrites} user writes cost ${diskWrites} entry writes to disk (write amp ${(diskWrites / Math.max(1, userWrites)).toFixed(1)}×). Blooms let reads skip most tables.`,
    shapes(), panel(), true,
  );

  function* compact(): Generator<Frame> {
    const inputs = [...l0, ...l1];
    for (const t of inputs) tones.set(t.id, 'warn');
    const total = inputs.reduce((n, t) => n + t.entries.length, 0);
    yield f(`L0 has ${l0.length} tables → compact them with L1. Merge ${total} entries, newest version wins.`);
    const merged = new Map<string, string | null>();
    // newest first: L0 (already newest first), then L1
    for (const t of inputs) for (const e of t.entries) if (!merged.has(e.k)) merged.set(e.k, e.v);
    const tomb = [...merged.values()].filter(v => v === null).length;
    const live = [...merged.entries()].filter(([, v]) => v !== null).sort((a, b) => a[0].localeCompare(b[0]));
    const dropped = total - merged.size;
    const tables: Sst[] = [];
    for (let i = 0; i < live.length; i += 3) tables.push(makeSst(live.slice(i, i + 3).map(([k, v]) => ({ k, v }))));
    diskWrites += live.length;
    l0 = [];
    l1 = tables;
    tones.clear();
    for (const t of tables) tones.set(t.id, 'current');
    yield f(`Dropped ${dropped} old version${dropped === 1 ? '' : 's'} and ${tomb} tombstone${tomb === 1 ? '' : 's'}; ${live.length} live keys rewritten into ${tables.length} L1 table${tables.length === 1 ? '' : 's'}.`);
  }

  function* get(k: string): Generator<Frame> {
    query = `get ${k}`;
    memTone = 'read';
    if (mem.has(k)) {
      const v = mem.get(k)!;
      memTone = 'ok';
      yield f(v === null ? `get ${k}: memtable has a tombstone → not found. No disk reads.` : `get ${k}: found ${k}=${v} in the memtable. No disk reads.`);
      return;
    }
    yield f(`get ${k}: not in memtable → check L0 newest to oldest, then L1.`);
    for (const t of [...l0, ...l1]) {
      const idx = bloomIdx(k);
      const maybe = idx.every(i => t.bloom.has(i));
      if (!maybe) {
        tones.set(t.id, 'muted');
        yield f(`${t.name} bloom: bit ${idx.find(i => !t.bloom.has(i))} is 0 → ${k} definitely absent, skip.`);
        continue;
      }
      probes++;
      const e = t.entries.find(x => x.k === k);
      if (!e) {
        tones.set(t.id, 'warn');
        yield f(`${t.name} bloom bits ${[...new Set(idx)].join(',')} all set → read it. Not there: a bloom false positive.`);
        continue;
      }
      tones.set(t.id, 'ok');
      yield f(e.v === null ? `${t.name} bloom says maybe → read it: tombstone, so ${k} is deleted.` : `${t.name} bloom says maybe → read it: ${k}=${e.v}.`);
      return;
    }
    yield f(`${k} not found in any table.`);
  }
}

const lsmWrites: LsmOp[] = [
  { op: 'put', k: 'a', v: '1' },
  { op: 'put', k: 'c', v: '3' },
  { op: 'put', k: 'b', v: '2' },
  { op: 'put', k: 'a', v: '4' },
  { op: 'del', k: 'c' },
  { op: 'put', k: 'd', v: '5' },
  { op: 'put', k: 'e', v: '6' },
  { op: 'put', k: 'a', v: '7' },
  { op: 'get', k: 'a' },
  { op: 'get', k: 'b' },
  { op: 'get', k: 'c' },
];

const lsmReads: LsmOp[] = [
  { op: 'put', k: 'k1', v: '1' },
  { op: 'put', k: 'k2', v: '2' },
  { op: 'put', k: 'k3', v: '3' },
  { op: 'put', k: 'k4', v: '4' },
  { op: 'put', k: 'k5', v: '5' },
  { op: 'put', k: 'k6', v: '6' },
  { op: 'put', k: 'k7', v: '7' },
  { op: 'put', k: 'k2', v: '8' },
  { op: 'put', k: 'k9', v: '9' },
  { op: 'get', k: 'k2' },
  { op: 'get', k: 'k5' },
  { op: 'get', k: 'k8' },
  { op: 'get', k: 'zz' },
];

registerDemo({
  slug: 'lsm-tree',
  title: 'LSM tree write + compaction',
  group: 'Storage',
  summary: 'Memtable, WAL, SSTable flushes, compaction and bloom-guided reads.',
  linkedFrom: ['KV store'],
  editable: 'none',
  inputs: [
    { id: 'writes', label: 'Writes + compaction', data: { memLimit: 3, ops: lsmWrites } },
    { id: 'reads', label: 'Read path + blooms', data: { memLimit: 3, ops: lsmReads } },
  ],
  run: lsm,
});

// ---------------------------------------------------------------- B-tree

interface BNode {
  id: string;
  keys: number[];
  children: BNode[];
}

const MAX_KEYS = 3;
const KEY_W = 66;

function* btree(input: unknown): Generator<Frame> {
  const keys = (input as { keys: number[] }).keys;
  let seq = 0;
  const mk = (k: number[], c: BNode[] = []): BNode => ({ id: `b${seq++}`, keys: k, children: c });
  let root: BNode | null = null;
  let splits = 0;
  const tones = new Map<string, Tone>();

  const height = () => {
    let h = 0;
    for (let n = root; n; n = n.children[0] ?? null) h++;
    return h;
  };
  const all = (): BNode[] => {
    const out: BNode[] = [];
    const walk = (n: BNode) => {
      out.push(n);
      n.children.forEach(walk);
    };
    if (root) walk(root);
    return out;
  };
  const shapes = (): Shape[] => {
    if (!root) return [text('empty', 500, 500, 'empty tree', { tone: 'muted', size: 32 })];
    const pos = layoutTree(root, 150, 850, 260, 300);
    const s: Shape[] = [];
    for (const n of all()) for (const c of n.children) s.push({ t: 'edge', id: `e:${n.id}-${c.id}`, from: n.id, to: c.id, tone: 'muted' });
    for (const n of all()) {
      const p = pos.get(n.id)!;
      s.push({
        t: 'node', id: n.id, shape: 'rect', x: p.x, y: p.y, w: Math.max(1, n.keys.length) * KEY_W + 24, h: 90,
        label: n.keys.join(' · '), tone: tones.get(n.id) ?? 'default',
      });
    }
    return s;
  };
  const panel = (k?: number) => ({
    title: 'B-tree (max 3 keys/node)',
    rows: [
      ...(k !== undefined ? [{ label: 'Inserting', value: String(k), tone: 'current' as Tone }] : []),
      { label: 'Height', value: String(height()) },
      { label: 'Nodes', value: String(all().length) },
      { label: 'Splits', value: String(splits) },
    ],
  });
  const f = (note: string, k?: number) => frame(note, shapes(), panel(k));
  const bracket = (n: BNode) => `[${n.keys.join(' ')}]`;

  yield f(`Insert ${keys.length} keys into a B-tree of order 4: each node holds at most ${MAX_KEYS} keys. Overflowing nodes split and push the median up.`);

  for (const k of keys) {
    tones.clear();
    if (!root) {
      root = mk([k]);
      tones.set(root.id, 'write');
      yield f(`Insert ${k}: tree is empty, so ${k} becomes the root leaf.`, k);
      continue;
    }
    const path: BNode[] = [];
    let n = root;
    let dup = false;
    while (true) {
      path.push(n);
      if (n.keys.includes(k)) {
        dup = true;
        break;
      }
      if (!n.children.length) break;
      const i = n.keys.filter(x => x < k).length;
      tones.set(n.id, 'current');
      const why =
        i === 0 ? `${k} < ${n.keys[0]}` : i === n.keys.length ? `${k} > ${n.keys[i - 1]}` : `${n.keys[i - 1]} < ${k} < ${n.keys[i]}`;
      yield f(`Insert ${k}: at ${bracket(n)}, ${why} → child ${i + 1}.`, k);
      tones.set(n.id, 'visited');
      n = n.children[i];
    }
    if (dup) {
      tones.set(n.id, 'warn');
      yield f(`${k} already exists in ${bracket(n)}; skip duplicate.`, k);
      continue;
    }
    n.keys.push(k);
    n.keys.sort((a, b) => a - b);
    tones.set(n.id, 'write');
    yield f(
      n.keys.length > MAX_KEYS
        ? `Add ${k} to leaf → ${bracket(n)}: ${n.keys.length} keys > ${MAX_KEYS}, overflow.`
        : `Add ${k} to leaf → ${bracket(n)} (${n.keys.length}/${MAX_KEYS} keys).`,
      k,
    );
    // split upward
    for (let d = path.length - 1; d >= 0 && path[d].keys.length > MAX_KEYS; d--) {
      const node = path[d];
      const before = bracket(node);
      const mid = 2;
      const median = node.keys[mid];
      const right = mk(node.keys.slice(mid + 1), node.children.slice(mid + 1));
      node.keys = node.keys.slice(0, mid);
      node.children = node.children.slice(0, mid + 1);
      splits++;
      tones.clear();
      tones.set(node.id, 'accent');
      tones.set(right.id, 'accent');
      if (d === 0) {
        root = mk([median], [node, right]);
        tones.set(root.id, 'current');
        yield f(`Split root ${before}: ${bracket(node)} | ${median} | ${bracket(right)}. ${median} becomes the new root; height is now ${height()}.`, k);
      } else {
        const parent = path[d - 1];
        const i = parent.children.indexOf(node);
        parent.keys.splice(i, 0, median);
        parent.children.splice(i + 1, 0, right);
        tones.set(parent.id, parent.keys.length > MAX_KEYS ? 'warn' : 'current');
        yield f(
          `Split ${before}: ${bracket(node)} | ${median} | ${bracket(right)}. Push ${median} up → parent ${bracket(parent)}${parent.keys.length > MAX_KEYS ? ' overflows too' : ''}.`,
          k,
        );
      }
    }
  }
  tones.clear();
  yield frame(
    `Done: ${keys.length} keys, height ${height()}, ${splits} splits. All leaves stay at the same depth, so every lookup costs ${height()} node reads.`,
    shapes(), panel(), true,
  );
}

registerDemo({
  slug: 'b-tree',
  title: 'B-tree insert / split',
  group: 'Storage',
  summary: 'Order-4 B-tree: descend, insert into a leaf, split and push the median up.',
  linkedFrom: ['Relational DB'],
  editable: 'none',
  inputs: [
    { id: 'asc', label: 'Ascending 10..90', data: { keys: [10, 20, 30, 40, 50, 60, 70, 80, 90] } },
    { id: 'mixed', label: 'Mixed', data: { keys: [50, 20, 80, 10, 30, 60, 90, 40, 25, 35] } },
    { id: 'deep', label: 'Root split (height 3)', data: { keys: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130] } },
  ],
  run: btree,
});

// ---------------------------------------------------------------- Merkle tree

function* merkle(input: unknown): Generator<Frame> {
  const diff = (input as { differ: number[] }).differ;
  const N = 8;
  const blockA = Array.from({ length: N }, (_, i) => `block${i}-v1`);
  const blockB = blockA.map((b, i) => (diff.includes(i) ? `block${i}-v2` : b));
  // heap-indexed tree: 1 = root, leaves 8..15
  const hA: string[] = [];
  const hB: string[] = [];
  for (let i = 0; i < N; i++) {
    hA[N + i] = hex4(blockA[i]);
    hB[N + i] = hex4(blockB[i]);
  }
  for (let i = N - 1; i >= 1; i--) {
    hA[i] = hex4(hA[2 * i] + hA[2 * i + 1]);
    hB[i] = hex4(hB[2 * i] + hB[2 * i + 1]);
  }
  const depth = (i: number) => Math.floor(Math.log2(i));
  const xOf = (i: number) => {
    const d = depth(i);
    const span = 800 / (1 << d);
    return 100 + span * (i - (1 << d)) + span / 2;
  };
  const ys = [170, 370, 570, 770];
  let built = 4; // depth levels not yet built (>= built are shown)
  const tones = new Map<number, Tone>();
  let comparisons = 0;
  const sync: number[] = [];
  let skipped = 0;

  const eqTone = (i: number): Tone => (hA[i] === hB[i] ? 'ok' : 'fail');
  const shapes = (): Shape[] => {
    const s: Shape[] = [text('legend', 500, 60, 'in box: replica A hash · below: replica B hash', { tone: 'default', size: 28 })];
    for (let i = 2; i < 2 * N; i++) s.push({ t: 'edge', id: `e:${i >> 1}-${i}`, from: `m${i >> 1}`, to: `m${i}`, tone: 'muted' });
    for (let i = 1; i < 2 * N; i++) {
      const shown = depth(i) >= built;
      s.push({
        t: 'node', id: `m${i}`, shape: 'rect', x: xOf(i), y: ys[depth(i)], w: 90, h: 64,
        label: shown ? hA[i] : '····', sub: shown ? hB[i] : '····', tone: shown ? (tones.get(i) ?? eqTone(i)) : 'muted',
      });
    }
    for (let i = 0; i < N; i++) s.push(text(`blk${i}`, xOf(N + i), 900, `B${i}`, { size: 28, bold: true, tone: sync.includes(i) ? 'fail' : 'default' }));
    return s;
  };
  const panel = () => ({
    title: 'Anti-entropy',
    rows: [
      { label: 'Hash comparisons', value: String(comparisons) },
      { label: 'Blocks skipped', value: String(skipped) },
      { label: 'Blocks to sync', value: sync.length ? sync.map(b => `B${b}`).join(' ') : '–', tone: (sync.length ? 'fail' : undefined) as Tone | undefined },
    ],
  });
  const f = (note: string, done?: boolean) => frame(note, shapes(), panel(), done);

  built = 3;
  yield f(
    diff.length
      ? `Both replicas hash their ${N} blocks. B${diff[0]} differs: ${hA[N + diff[0]]} vs ${hB[N + diff[0]]}.`
      : `Both replicas hash their ${N} blocks; all leaf hashes match.`,
  );
  built = 2;
  yield f('Each parent = hash(left + right). Level 2 has 4 nodes covering 2 blocks each.');
  built = 1;
  yield f('Level 1: 2 nodes, each covering 4 blocks.');
  built = 0;
  yield f(`Root = hash of everything: A ${hA[1]}, B ${hB[1]}. Replicas exchange only roots first.`);

  comparisons++;
  tones.set(1, 'current');
  if (hA[1] === hB[1]) {
    tones.set(1, 'ok');
    skipped = N;
    yield f(`Roots match (${hA[1]}) → replicas are identical. 1 comparison instead of ${N} blocks.`, true);
    return;
  }
  yield f(`Roots differ (${hA[1]} ≠ ${hB[1]}) → something diverged. Compare its 2 children.`);
  tones.set(1, 'fail');

  const queue = [1];
  while (queue.length) {
    const p = queue.shift()!;
    for (const c of [2 * p, 2 * p + 1]) {
      comparisons++;
      const span = N >> depth(c);
      if (hA[c] === hB[c]) {
        tones.set(c, 'ok');
        skipped += span;
        // prune: mute the subtree below
        const stack = c < N ? [2 * c, 2 * c + 1] : [];
        while (stack.length) {
          const x = stack.pop()!;
          tones.set(x, 'muted');
          if (x < N) stack.push(2 * x, 2 * x + 1);
        }
        yield f(c >= N ? `B${c - N} matches (${hA[c]}) → skip.` : `Child ${hA[c]} matches → skip its ${span} blocks without looking.`);
      } else if (c >= N) {
        tones.set(c, 'current');
        sync.push(c - N);
        yield f(`Leaf B${c - N} differs (${hA[c]} ≠ ${hB[c]}) → sync this block.`);
        tones.set(c, 'fail');
      } else {
        tones.set(c, 'current');
        yield f(`Child differs (${hA[c]} ≠ ${hB[c]}) → descend into its ${span} blocks.`);
        tones.set(c, 'fail');
        queue.push(c);
      }
    }
  }
  yield f(`Sync ${sync.length} of ${N} blocks (${sync.map(b => `B${b}`).join(', ')}) after ${comparisons} hash comparisons. Cost grows with the diff, not the data.`, true);
}

registerDemo({
  slug: 'merkle-tree',
  title: 'Merkle tree diff (anti-entropy)',
  group: 'Storage',
  summary: 'Two replicas compare hash trees top-down to find only the blocks that differ.',
  linkedFrom: ['KV store'],
  editable: 'none',
  inputs: [
    { id: 'one', label: 'One block differs', data: { differ: [5] } },
    { id: 'two', label: 'Two blocks differ', data: { differ: [1, 6] } },
    { id: 'same', label: 'In sync', data: { differ: [] } },
  ],
  run: merkle,
});

// ---------------------------------------------------------------- Trie + top-K

interface TNode {
  id: string;
  ch: string;
  children: TNode[];
  freq?: number;
}

function* trie(input: unknown): Generator<Frame> {
  const cfg = input as { words: [string, number][]; prefix: string; k: number };
  const root: TNode = { id: 't:', ch: '', children: [] };
  const byId = new Map<string, TNode>([[root.id, root]]);
  const tones = new Map<string, Tone>();
  let results: [string, number][] = [];

  const shapes = (): Shape[] => {
    const pos = layoutTree(root, 110, 890, 110, 170);
    const s: Shape[] = [];
    for (const n of byId.values()) for (const c of n.children) s.push({ t: 'edge', id: `e:${n.id}-${c.id}`, from: n.id, to: c.id, tone: tones.get(c.id) === 'visited' || tones.get(c.id) === 'current' ? 'path' : 'muted' });
    for (const n of byId.values()) {
      const p = pos.get(n.id)!;
      const sh: Shape = { t: 'node', id: n.id, x: p.x, y: p.y, r: 38, label: n.ch || '•', tone: tones.get(n.id) ?? 'default' };
      if (n.freq !== undefined) sh.badge = String(n.freq);
      s.push(sh);
    }
    return s;
  };
  const panel = (title: string) => ({
    title,
    rows: results.length ? results.map(([w, c], i) => ({ label: `${i + 1}. ${w}`, value: String(c), tone: (i < cfg.k ? 'ok' : 'muted') as Tone })) : [{ label: 'Nodes', value: String(byId.size) }],
  });
  const f = (note: string, title = 'Trie', done?: boolean) => frame(note, shapes(), panel(title), done);

  yield f(`Build a trie of ${cfg.words.length} search terms with their counts. Shared prefixes share nodes.`);
  for (const [w, c] of cfg.words) {
    tones.clear();
    let n = root;
    const walked: string[] = [];
    const added: string[] = [];
    for (let i = 0; i < w.length; i++) {
      const id = `t:${w.slice(0, i + 1)}`;
      let child = byId.get(id);
      if (!child) {
        child = { id, ch: w[i], children: [] };
        n.children.push(child);
        n.children.sort((a, b) => a.ch.localeCompare(b.ch));
        byId.set(id, child);
        added.push(w[i]);
        tones.set(id, 'current');
      } else {
        walked.push(w[i]);
        tones.set(id, 'visited');
      }
      n = child;
    }
    n.freq = c;
    const how = walked.length
      ? `reuse ${walked.join('→')}${added.length ? `, add ${added.join('→')}` : ''}`
      : `add ${added.join('→')}`;
    yield f(`Insert "${w}" (${c}): ${how}. Mark the end with count ${c}.`);
  }

  tones.clear();
  let n: TNode | undefined = root;
  for (let i = 0; i < cfg.prefix.length; i++) {
    const id = `t:${cfg.prefix.slice(0, i + 1)}`;
    n = byId.get(id);
    if (!n) {
      yield f(`Query "${cfg.prefix}": no child '${cfg.prefix[i]}' → 0 suggestions.`, 'Suggestions', true);
      return;
    }
    tones.set(id, 'current');
    yield f(`Query "${cfg.prefix}": follow '${cfg.prefix[i]}' (${i + 1}/${cfg.prefix.length} chars).`, 'Suggestions');
    tones.set(id, 'visited');
  }
  const found: [string, number][] = [];
  const collect = (x: TNode) => {
    if (x.freq !== undefined) found.push([x.id.slice(2), x.freq]);
    x.children.forEach(collect);
  };
  collect(n!);
  for (const [w] of found) tones.set(`t:${w}`, 'accent');
  results = [...found].sort((a, b) => b[1] - a[1]);
  yield f(`Subtree of "${cfg.prefix}" holds ${found.length} words: ${results.map(([w, c]) => `${w} ${c}`).join(', ')}.`, 'Suggestions');
  const top = results.slice(0, cfg.k);
  for (const [w] of results) tones.set(`t:${w}`, 'muted');
  for (const [w] of top) tones.set(`t:${w}`, 'ok');
  yield f(`Top-${cfg.k}: ${top.map(([w, c]) => `${w} (${c})`).join(', ')}. Real systems cache top-K at each node so lookups cost only the prefix length.`, 'Suggestions', true);
}

const words: [string, number][] = [
  ['car', 50], ['cart', 20], ['cat', 80], ['cab', 10], ['do', 30], ['dog', 60], ['dot', 15],
];

registerDemo({
  slug: 'trie-topk',
  title: 'Trie + top-K autocomplete',
  group: 'Storage',
  summary: 'Prefix tree of search terms; walk the prefix, rank completions by count.',
  linkedFrom: ['Autocomplete'],
  editable: 'none',
  inputs: [
    { id: 'ca', label: 'Prefix "ca"', data: { words, prefix: 'ca', k: 2 } },
    { id: 'do', label: 'Prefix "do"', data: { words, prefix: 'do', k: 2 } },
    { id: 'miss', label: 'Prefix "da" (miss)', data: { words, prefix: 'da', k: 2 } },
  ],
  run: trie,
});

// ---------------------------------------------------------------- Inverted index

const STOP = new Set(['for', 'the', 'a', 'of', 'and', 'to']);

function* inverted(input: unknown): Generator<Frame> {
  const cfg = input as { docs: string[]; query: [string, string] };
  const post = new Map<string, number[]>();
  const docTone = new Map<number, Tone>();
  const termTone = new Map<string, Tone>();
  const postTone = new Map<string, Tone>();
  const results: number[] = [];

  const shapes = (): Shape[] => {
    const s: Shape[] = [];
    cfg.docs.forEach((d, i) =>
      s.push({ t: 'rect', id: `doc${i}`, x: 70, y: 110 + i * 170, w: 290, h: 130, label: `D${i + 1}`, sub: d, tone: docTone.get(i) ?? 'default', radius: 10 }),
    );
    const terms = [...post.keys()].sort();
    const dy = Math.min(100, 780 / Math.max(1, terms.length));
    terms.forEach((t, r) => {
      const y = 110 + r * dy;
      s.push({ t: 'rect', id: `term:${t}`, x: 420, y, w: 180, h: dy - 20, label: t, tone: termTone.get(t) ?? 'default', mono: true, radius: 8 });
      post.get(t)!.forEach((d, j) =>
        s.push({ t: 'rect', id: `p:${t}:${d}`, x: 630 + j * 80, y, w: 66, h: dy - 20, label: `D${d + 1}`, tone: postTone.get(`${t}:${d}`) ?? 'muted', mono: true, radius: 8 }),
      );
    });
    return s;
  };
  const panel = (extra: PanelRow[] = []) => ({
    title: 'Index',
    rows: [
      { label: 'Terms', value: String(post.size) },
      { label: 'Postings', value: String([...post.values()].reduce((n, l) => n + l.length, 0)) },
      ...extra,
    ],
  });
  const f = (note: string, extra?: PanelRow[], done?: boolean) => frame(note, shapes(), panel(extra), done);

  yield f(`Build an inverted index over ${cfg.docs.length} documents: term → sorted list of doc ids.`);
  for (let i = 0; i < cfg.docs.length; i++) {
    const d = cfg.docs[i];
    docTone.clear();
    termTone.clear();
    postTone.clear();
    docTone.set(i, 'current');
    const toks = d.toLowerCase().split(/\s+/);
    const kept = [...new Set(toks.filter(t => !STOP.has(t)))];
    const stop = toks.filter(t => STOP.has(t));
    for (const t of kept) {
      if (!post.has(t)) post.set(t, []);
      post.get(t)!.push(i);
      termTone.set(t, 'write');
      postTone.set(`${t}:${i}`, 'current');
    }
    yield f(`Tokenize D${i + 1}: ${kept.join(', ')}${stop.length ? ` ('${stop.join("', '")}' is a stopword)` : ''}. Append D${i + 1} to ${kept.length} posting lists.`);
  }

  docTone.clear();
  termTone.clear();
  postTone.clear();
  const [a, b] = cfg.query;
  const la = post.get(a) ?? [];
  const lb = post.get(b) ?? [];
  termTone.set(a, 'read');
  termTone.set(b, 'read');
  const listStr = (l: number[]) => l.map(d => `D${d + 1}`).join(' ') || '∅';
  yield f(`Query "${a} AND ${b}": fetch ${a} → ${listStr(la)} and ${b} → ${listStr(lb)}. Walk both sorted lists with two pointers.`);

  let i = 0;
  let j = 0;
  let steps = 0;
  const ptrRows = () => [
    { label: `${a} ptr`, value: la[i] !== undefined ? `D${la[i] + 1}` : 'end' },
    { label: `${b} ptr`, value: lb[j] !== undefined ? `D${lb[j] + 1}` : 'end' },
    { label: 'Matches', value: results.map(d => `D${d + 1}`).join(' ') || '–', tone: 'ok' as Tone },
  ];
  while (i < la.length && j < lb.length) {
    const x = la[i];
    const y = lb[j];
    postTone.set(`${a}:${x}`, 'current');
    postTone.set(`${b}:${y}`, 'current');
    let note: string;
    if (x === y) {
      results.push(x);
      docTone.set(x, 'ok');
      note = `D${x + 1} = D${y + 1} → match. Advance both pointers.`;
    } else if (x < y) note = `D${x + 1} < D${y + 1} → advance the ${a} pointer.`;
    else note = `D${y + 1} < D${x + 1} → advance the ${b} pointer.`;
    steps++;
    yield f(note, ptrRows());
    if (x === y) {
      postTone.set(`${a}:${x}`, 'ok');
      postTone.set(`${b}:${y}`, 'ok');
      i++;
      j++;
    } else if (x < y) {
      postTone.set(`${a}:${x}`, 'muted');
      postTone.set(`${b}:${y}`, 'read');
      i++;
    } else {
      postTone.set(`${b}:${y}`, 'muted');
      postTone.set(`${a}:${x}`, 'read');
      j++;
    }
  }
  yield f(
    `One list is exhausted. "${a} AND ${b}" → ${results.length ? results.map(d => `D${d + 1}`).join(', ') : 'no documents'} after ${steps} comparisons, without scanning any document.`,
    ptrRows(),
    true,
  );
}

registerDemo({
  slug: 'inverted-index',
  title: 'Inverted index build + query',
  group: 'Storage',
  summary: 'Tokenize documents into posting lists, then AND two terms by intersecting sorted lists.',
  linkedFrom: ['Search'],
  editable: 'none',
  inputs: [
    { id: 'fast-db', label: 'fast AND db', data: { docs: ['fast cache for db', 'db index tuning', 'fast db writes', 'cache eviction'], query: ['fast', 'db'] } },
    { id: 'cache-db', label: 'cache AND db', data: { docs: ['fast cache for db', 'db index tuning', 'fast db writes', 'cache eviction'], query: ['cache', 'db'] } },
  ],
  run: inverted,
});
