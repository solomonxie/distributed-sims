// 'Partitioning' algorithm demos: consistent hashing, rendezvous hashing.
import { registerDemo, type Shape, type Tone } from './frames';
import { fnv1a } from './lib/hash';
import { frame, polar, text } from './lib/draw';

const OWNER_TONES: Tone[] = ['accent', 'ok', 'warn', 'protocol', 'read'];

// ---- consistent hashing ----

interface Point {
  id: string;
  server: number;
  angle: number;
}

const angleOf = (s: string) => (fnv1a(s) / 4294967296) * 360;

function ringPoints(servers: number, vnodes: number): Point[] {
  const pts: Point[] = [];
  for (let s = 0; s < servers; s++) {
    for (let v = 0; v < vnodes; v++) {
      const hashKey = vnodes === 1 ? `node-n${s + 1}` : `n${s + 1}/${v}`;
      pts.push({ id: vnodes === 1 ? `s:n${s + 1}` : `s:n${s + 1}#${v}`, server: s, angle: angleOf(hashKey) });
    }
  }
  return pts.sort((a, b) => a.angle - b.angle);
}

function ownerPoint(pts: Point[], angle: number): Point {
  return pts.find(p => p.angle >= angle) ?? pts[0];
}

const keyAngles = (keys: number) => Array.from({ length: keys }, (_, i) => angleOf(`key-${i}`));

export function consistentHashMove(servers: number, vnodes: number, keys: number): { moved: number; total: number; allToNew: boolean } {
  const before = ringPoints(servers, vnodes);
  const after = ringPoints(servers + 1, vnodes);
  let moved = 0;
  let allToNew = true;
  for (const a of keyAngles(keys)) {
    const o0 = ownerPoint(before, a).server;
    const o1 = ownerPoint(after, a).server;
    if (o0 !== o1) {
      moved++;
      if (o1 !== servers) allToNew = false;
    }
  }
  return { moved, total: keys, allToNew };
}

interface ChInput {
  servers: number;
  vnodes: number;
  keys: number;
}

const CX = 500;
const CY = 480;
const R = 320;
const KR = 262;

registerDemo({
  slug: 'consistent-hashing',
  title: 'Consistent hashing',
  group: 'Partitioning',
  summary: 'Servers and keys hash onto a ring; each key goes to the next server clockwise. Adding a server moves only ~1/N of keys.',
  linkedFrom: ['Sharding', 'KV store'],
  editable: 'none',
  inputs: [
    { id: 'plain', label: 'Plain (3 servers)', data: { servers: 3, vnodes: 1, keys: 100 } satisfies ChInput },
    { id: 'vnodes', label: 'Vnodes (3 × 4)', data: { servers: 3, vnodes: 4, keys: 100 } satisfies ChInput },
  ],
  *run(raw) {
    const inp = (raw ?? { servers: 3, vnodes: 1, keys: 100 }) as ChInput;
    const { servers, vnodes, keys } = inp;
    const name = (s: number) => `n${s + 1}`;
    const deg = (a: number) => `${Math.round(a)}°`;
    const angles = keyAngles(keys);
    const before = ringPoints(servers, vnodes);
    const after = ringPoints(servers + 1, vnodes);
    const own0 = angles.map(a => ownerPoint(before, a));
    const own1 = angles.map(a => ownerPoint(after, a));
    const moved = angles.map((_, i) => own0[i].server !== own1[i].server);
    const movedCount = moved.filter(Boolean).length;
    const small = vnodes > 1;

    const ring: Shape = { t: 'arc', id: 'ring', cx: CX, cy: CY, r: R, a0: 0, a1: 360, tone: 'muted', width: 4 };
    const serverShapes = (pts: Point[], fresh = -1): Shape[] =>
      pts.map(p => {
        const { x, y } = polar(CX, CY, R, p.angle);
        return {
          t: 'node', id: p.id, x, y, r: small ? 26 : 38,
          label: small ? String(p.server + 1) : name(p.server),
          tone: p.server === fresh ? 'current' : OWNER_TONES[p.server % OWNER_TONES.length],
        } as Shape;
      });
    const keyDots = (owner: Point[], hi?: (i: number) => boolean): Shape[] =>
      angles.map((a, i) => {
        const { x, y } = polar(CX, CY, KR, a);
        const h = hi?.(i);
        return { t: 'dot', id: `k${i}`, x, y, r: h ? 9 : 6, tone: h ? 'current' : OWNER_TONES[owner[i].server % OWNER_TONES.length] } as Shape;
      });
    const load = (owner: Point[], n: number) => {
      const c = new Array(n).fill(0);
      for (const o of owner) c[o.server]++;
      return c as number[];
    };
    const loadRows = (owner: Point[], n: number) => load(owner, n).map((c, s) => ({ label: name(s), value: `${c} keys`, tone: OWNER_TONES[s % OWNER_TONES.length] }));
    const legend = (t: string) => text('legend', 500, 920, t, { size: 28, tone: 'default' });

    const firstPts = before.filter((p, i, arr) => arr.findIndex(q => q.server === p.server) === i).sort((a, b) => a.server - b.server);
    yield frame(
      small
        ? `Each of ${servers} servers hashes to ${vnodes} vnodes, giving ${before.length} points on a 0–360° ring.`
        : `Hash each server onto a 0–360° ring: ${firstPts.map(p => `${name(p.server)} at ${deg(p.angle)}`).join(', ')}.`,
      [ring, ...serverShapes(before), legend('ring position = hash(server)')],
      { title: 'Ring', rows: [{ label: 'Servers', value: String(servers) }, { label: 'Ring points', value: String(before.length) }] },
    );

    yield frame(
      `Hash ${keys} keys onto the same ring. Each key belongs to the first server point clockwise.`,
      [ring, ...serverShapes(before), ...keyDots(own0), legend('dot colour = owner')],
      { title: 'Load', rows: loadRows(own0, servers) },
    );

    // One key's clockwise walk.
    const ki = 7 % keys;
    const ka = angles[ki];
    const kp = own0[ki];
    const a1 = kp.angle >= ka ? kp.angle : kp.angle + 360;
    yield frame(
      `key-${ki} hashes to ${deg(ka)}. Walk clockwise: the first server point is ${name(kp.server)} at ${deg(kp.angle)}.`,
      [
        ring,
        { t: 'arc', id: 'walk', cx: CX, cy: CY, r: KR, a0: ka, a1, tone: 'current', width: 8 },
        ...serverShapes(before),
        ...keyDots(own0, i => i === ki),
        legend(`key-${ki} → ${name(kp.server)}`),
      ],
      { title: 'Load', rows: loadRows(own0, servers) },
    );

    // Add a server: highlight arcs it takes over.
    const fresh = servers;
    const freshPts = after.filter(p => p.server === fresh);
    const stolen: Shape[] = freshPts.map((p, j) => {
      const idx = after.indexOf(p);
      const prev = after[(idx - 1 + after.length) % after.length];
      const a0 = prev.angle <= p.angle ? prev.angle : prev.angle - 360;
      return { t: 'arc', id: `steal${j}`, cx: CX, cy: CY, r: R, a0, a1: p.angle, tone: 'warn', width: 12 } as Shape;
    });
    const fp = freshPts[0];
    const fpIdx = after.indexOf(fp);
    const fpPrev = after[(fpIdx - 1 + after.length) % after.length];
    yield frame(
      small
        ? `Add ${name(fresh)} with ${vnodes} vnodes. Each takes over only the arc just before it (orange).`
        : `Add ${name(fresh)} at ${deg(fp.angle)}. It takes over only the arc from ${name(fpPrev.server)} (${deg(fpPrev.angle)}) to ${deg(fp.angle)}.`,
      [ring, ...stolen, ...serverShapes(after, fresh), ...keyDots(own0), legend(`adding ${name(fresh)}`)],
      { title: 'Load', rows: loadRows(own0, servers) },
    );

    const modMoved = angles.filter((_, i) => (fnv1a(`key-${i}`) % servers) !== (fnv1a(`key-${i}`) % (servers + 1))).length;
    const ideal = Math.round(keys / (servers + 1));
    yield frame(
      `${movedCount} of ${keys} keys moved, all to ${name(fresh)} (ideal ≈ ${keys}/${servers + 1} = ${ideal}). Modulo hashing would move ${modMoved}.`,
      [ring, ...stolen, ...serverShapes(after, fresh), ...keyDots(own0, i => moved[i]), legend('highlighted = moved keys')],
      {
        title: 'Rebalance',
        rows: [
          { label: 'Moved', value: `${movedCount} / ${keys}`, tone: 'current' },
          { label: 'Ideal', value: `≈ ${ideal}` },
          { label: 'hash % N', value: `${modMoved} / ${keys}`, tone: 'fail' },
        ],
      },
    );

    const l1 = load(own1, servers + 1);
    yield frame(
      `Keys now spread ${l1.join(' · ')} across ${servers + 1} servers. ${small ? 'More vnodes per server (100+ in practice) even it out further.' : 'Few ring points make load uneven; vnodes help.'}`,
      [ring, ...serverShapes(after), ...keyDots(own1), legend('ring after adding a server')],
      { title: 'Load', rows: [{ label: 'Moved', value: `${movedCount} / ${keys}`, tone: 'current' }, ...loadRows(own1, servers + 1)] },
      true,
    );
  },
});

// ---- rendezvous hashing ----

interface RvInput {
  servers: string[];
  keys: string[];
  remove: string;
}

function score(key: string, server: string) {
  const h = fnv1a(`${key}|${server}`);
  return { s: h % 100, h };
}

function winner(key: string, servers: string[]) {
  let best = servers[0];
  let bs = score(key, best);
  for (const sv of servers.slice(1)) {
    const sc = score(key, sv);
    if (sc.s > bs.s || (sc.s === bs.s && sc.h > bs.h)) {
      best = sv;
      bs = sc;
    }
  }
  return best;
}

registerDemo({
  slug: 'rendezvous-hashing',
  title: 'Rendezvous hashing',
  group: 'Partitioning',
  summary: 'Each key scores every server with hash(key, server) and picks the highest. Removing a server only moves its own keys.',
  linkedFrom: ['Sharding'],
  editable: 'none',
  inputs: [
    { id: 'four', label: '4 servers, 6 keys', data: { servers: ['n1', 'n2', 'n3', 'n4'], keys: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'], remove: 'n2' } satisfies RvInput },
    { id: 'three', label: '3 servers, 5 keys', data: { servers: ['A', 'B', 'C'], keys: ['k1', 'k2', 'k3', 'k4', 'k5'], remove: 'C' } satisfies RvInput },
  ],
  *run(raw) {
    const inp = (raw ?? { servers: ['n1', 'n2', 'n3', 'n4'], keys: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'], remove: 'n2' }) as RvInput;
    const { servers, keys, remove } = inp;
    const sx = (i: number) => (servers.length === 1 ? 500 : 160 + (680 * i) / (servers.length - 1));
    const kx = (i: number) => (keys.length === 1 ? 500 : 110 + (780 * i) / (keys.length - 1));
    const tone = (s: string) => OWNER_TONES[servers.indexOf(s) % OWNER_TONES.length];
    const assigned = new Map<string, string>();

    const serverNodes = (down?: string): Shape[] =>
      servers.map((s, i) => ({ t: 'node', id: `s:${s}`, x: sx(i), y: 190, r: 36, label: s, tone: s === down ? 'fail' : tone(s) }) as Shape);
    const keyNodes = (cur?: string, hi?: Set<string>): Shape[] =>
      keys.map((k, i) => ({
        t: 'node', id: `k:${k}`, x: kx(i), y: 760, r: 32, label: k,
        tone: k === cur || hi?.has(k) ? 'current' : assigned.has(k) ? tone(assigned.get(k)!) : 'default',
      }) as Shape);
    const assignedEdges = (skip?: string, tn: Tone = 'muted'): Shape[] =>
      [...assigned].filter(([k]) => k !== skip).map(([k, s]) => ({ t: 'edge', id: `e:${k}-${s}`, from: `k:${k}`, to: `s:${s}`, tone: tn }) as Shape);
    const rows = () => keys.map(k => ({ label: k, value: assigned.get(k) ?? '—', tone: assigned.has(k) ? tone(assigned.get(k)!) : undefined }));

    yield frame(
      `${keys.length} keys, ${servers.length} servers. Each key computes hash(key, server) for every server and picks the top score.`,
      [...serverNodes(), ...keyNodes()],
      { title: 'Owners', rows: rows() },
    );

    for (const k of keys) {
      const scores = servers.map(s => score(k, s).s);
      const w = winner(k, servers);
      const edges: Shape[] = servers.map((s, i) => ({
        t: 'edge', id: `e:${k}-${s}`, from: `k:${k}`, to: `s:${s}`, label: String(scores[i]),
        tone: s === w ? 'path' : 'muted', width: s === w ? 4 : 2,
      }) as Shape);
      assigned.delete(k);
      const note = `${k}: scores ${servers.map((s, i) => `${s} ${scores[i]}`).join(', ')}. ${w} wins.`;
      const shapes = [...assignedEdges(k), ...edges, ...serverNodes(), ...keyNodes(k)];
      assigned.set(k, w);
      yield frame(note, shapes, { title: 'Owners', rows: rows() });
    }

    // Remove a server.
    const remaining = servers.filter(s => s !== remove);
    const movers = keys.filter(k => assigned.get(k) === remove);
    const hi = new Set(movers);
    yield frame(
      `Remove ${remove}. Only its ${movers.length} key${movers.length === 1 ? '' : 's'}${movers.length ? ` (${movers.join(', ')})` : ''} must move; every other key keeps its top score.`,
      [...assignedEdges(undefined, 'muted'), ...serverNodes(remove), ...keyNodes(undefined, hi)],
      { title: 'Owners', rows: rows() },
    );
    const moves: string[] = [];
    for (const k of movers) {
      const w = winner(k, remaining);
      moves.push(`${k} → ${w}`);
      assigned.set(k, w);
    }
    const edges = [...assigned].map(([k, s]) => ({
      t: 'edge', id: `e:${k}-${s}`, from: `k:${k}`, to: `s:${s}`, tone: hi.has(k) ? 'current' : 'muted', width: hi.has(k) ? 4 : 2,
    }) as Shape);
    yield frame(
      movers.length
        ? `Moved keys take their next-highest score: ${moves.join(', ')}. ${keys.length - movers.length} of ${keys.length} keys stayed put.`
        : `${remove} owned no keys, so nothing moves.`,
      [...edges, ...serverNodes(remove), ...keyNodes(undefined, hi)],
      { title: 'Owners', rows: [...rows(), { label: 'Moved', value: `${movers.length} / ${keys.length}`, tone: 'current' }] },
      true,
    );
  },
});
