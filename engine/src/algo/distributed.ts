// 'distributed' algorithm demos: gossip, clocks, Raft log, CRDTs, Snowflake IDs.
import { registerDemo, type PanelRow, type Shape, type Tone } from './frames';
import { frame, polar, text } from './lib/draw';
import { Rng } from '../rng';

const GROUP = 'Distributed';

// ---------------- gossip ----------------

interface GossipInput {
  n: number;
  fanout: number;
  down: number[];
  seed: number;
}

registerDemo({
  slug: 'gossip',
  title: 'Gossip dissemination',
  group: GROUP,
  summary: 'Each round, every informed node pushes the update to a few random peers; it reaches everyone in ~log N rounds.',
  linkedFrom: ['KV store', 'Membership'],
  editable: 'none',
  inputs: [
    { id: 'fanout2', label: 'Fanout 2', data: { n: 12, fanout: 2, down: [], seed: 7 } satisfies GossipInput },
    { id: 'fanout1', label: 'Fanout 1', data: { n: 12, fanout: 1, down: [], seed: 7 } satisfies GossipInput },
    { id: 'down', label: 'With 2 nodes down', data: { n: 12, fanout: 2, down: [4, 9], seed: 11 } satisfies GossipInput },
  ],
  *run(raw) {
    const inp = raw as GossipInput;
    const n = Math.min(14, Math.max(3, inp.n));
    const rng = new Rng(inp.seed);
    const down = new Set(inp.down);
    const alive = n - down.size;
    const ids = Array.from({ length: n }, (_, i) => `g${i}`);
    const pos = ids.map((_, i) => polar(500, 500, 400, (360 * i) / n));
    const infected = new Set<number>([0]);
    const history: PanelRow[] = [{ label: 'Round 0', value: `1 / ${alive}` }];

    const draw = (fresh: Set<number>, msgs: [number, number][]): Shape[] => {
      const out: Shape[] = msgs.map(([a, b]) => ({
        t: 'edge', id: `m:${a}-${b}`, from: ids[a], to: ids[b], arrow: true,
        tone: (down.has(b) ? 'fail' : 'protocol') as Tone, dashed: infected.has(b) && !fresh.has(b),
      }));
      ids.forEach((id, i) => {
        const tone: Tone = down.has(i) ? 'fail' : fresh.has(i) ? 'current' : infected.has(i) ? 'ok' : 'default';
        out.push({ t: 'node', id, x: pos[i].x, y: pos[i].y, r: 42, label: String(i + 1), tone, badge: down.has(i) ? 'down' : undefined });
      });
      return out;
    };
    const panel = () => ({ title: 'Infected per round', rows: [...history] });

    yield frame(`Node 1 learns an update. Each round, every infected node tells ${inp.fanout} random peer${inp.fanout > 1 ? 's' : ''}.`, draw(new Set([0]), []), panel());

    let round = 0;
    while (infected.size < alive && round < 20) {
      round++;
      const msgs: [number, number][] = [];
      const fresh = new Set<number>();
      const senders = [...infected].sort((a, b) => a - b);
      for (const s of senders) {
        const peers = ids.map((_, i) => i).filter(i => i !== s);
        for (let k = 0; k < inp.fanout && peers.length; k++) {
          const t = peers.splice(rng.int(peers.length), 1)[0];
          msgs.push([s, t]);
          if (!down.has(t) && !infected.has(t)) fresh.add(t);
        }
      }
      const wasted = msgs.filter(([, t]) => down.has(t) || (infected.has(t) && !fresh.has(t))).length;
      for (const f of fresh) infected.add(f);
      history.push({ label: `Round ${round}`, value: `${infected.size} / ${alive}`, tone: fresh.size ? 'accent' : 'muted' });
      yield frame(
        `Round ${round}: ${senders.length} infected send ${msgs.length} message${msgs.length > 1 ? 's' : ''}; ${fresh.size} new → ${infected.size}/${alive}.${wasted ? ` ${wasted} wasted on infected or down peers.` : ''}`,
        draw(fresh, msgs), panel(),
      );
    }
    const logN = Math.log2(alive).toFixed(1);
    yield frame(
      `All ${alive} live nodes infected in ${round} rounds (log₂${alive} ≈ ${logN}).${down.size ? ` ${down.size} down nodes catch up when they rejoin.` : ''}`,
      draw(new Set(), []), panel(), true,
    );
  },
});

// ---------------- Lamport & vector clocks ----------------

interface ClockEvent {
  id: string;
  p: number;
  slot: number;
  kind: 'local' | 'send' | 'recv';
  msg?: string;
}

interface ClocksInput {
  events: ClockEvent[];
  compare: [string, string][];
}

registerDemo({
  slug: 'clocks',
  title: 'Lamport & vector clocks',
  group: GROUP,
  summary: 'Lamport clocks order events consistently; vector clocks also tell happened-before apart from concurrent.',
  linkedFrom: ['Consistency'],
  editable: 'none',
  inputs: [
    {
      id: 'three', label: '3 processes', data: {
        events: [
          { id: 'a', p: 0, slot: 1, kind: 'local' },
          { id: 'b', p: 0, slot: 2, kind: 'send', msg: 'm1' },
          { id: 'c', p: 1, slot: 1, kind: 'local' },
          { id: 'd', p: 1, slot: 3, kind: 'recv', msg: 'm1' },
          { id: 'e', p: 2, slot: 1, kind: 'local' },
          { id: 'f', p: 2, slot: 2, kind: 'local' },
          { id: 'g', p: 1, slot: 4, kind: 'send', msg: 'm2' },
          { id: 'h', p: 2, slot: 5, kind: 'recv', msg: 'm2' },
          { id: 'i', p: 0, slot: 4, kind: 'local' },
        ],
        compare: [['b', 'h'], ['i', 'g'], ['e', 'd']],
      } satisfies ClocksInput,
    },
  ],
  *run(raw) {
    const inp = raw as ClocksInput;
    const P = 3;
    const laneY = [250, 530, 810];
    const xOf = (slot: number) => 210 + (slot - 1) * 170;
    const L = [0, 0, 0];
    const V = [0, 1, 2].map(() => [0, 0, 0]);
    const done = new Map<string, { l: number; v: number[]; ev: ClockEvent }>();
    const inflight = new Map<string, { l: number; v: number[]; ev: ClockEvent }>();
    const sendOf = new Map(inp.events.filter(e => e.kind === 'send').map(e => [e.msg!, e]));
    const recvOf = new Map(inp.events.filter(e => e.kind === 'recv').map(e => [e.msg!, e]));
    const vc = (v: number[]) => `[${v.join(',')}]`;

    const draw = (hi: Record<string, Tone> = {}): Shape[] => {
      const out: Shape[] = [
        text('leg', 500, 60, 'inside: Lamport L · below: vector clock', { size: 26, tone: 'default' }),
      ];
      for (let p = 0; p < P; p++) {
        out.push({ t: 'line', id: `lane${p}`, x1: 130, y1: laneY[p], x2: 960, y2: laneY[p], tone: 'muted' });
        out.push(text(`pl${p}`, 70, laneY[p], `P${p + 1}`, { bold: true, align: 'center', size: 32 }));
      }
      for (const [msg, s] of sendOf) {
        const r = recvOf.get(msg);
        if (!r || !done.has(s.id)) continue;
        const got = done.has(r.id);
        out.push({
          t: 'edge', id: `msg:${msg}`, from: `ev:${s.id}`, to: got ? `ev:${r.id}` : { x: xOf(r.slot), y: laneY[r.p] },
          tone: 'protocol', dashed: !got, arrow: true,
        });
      }
      for (const [id, d] of done) {
        const x = xOf(d.ev.slot), y = laneY[d.ev.p];
        out.push({ t: 'node', id: `ev:${id}`, x, y, r: 36, tone: hi[id] ?? 'default', label: String(d.l), sub: vc(d.v) });
        out.push(text(`nm:${id}`, x, y - 62, id, { size: 30, bold: true, align: 'center', tone: hi[id] ?? 'default' }));
      }
      return out;
    };
    const panel = () => ({
      title: 'Clocks',
      rows: [0, 1, 2].map(p => ({ label: `P${p + 1}`, value: `L=${L[p]} · VC ${vc(V[p])}` })),
    });

    yield frame('3 processes, each with a Lamport counter and a vector clock. Local and send events tick; receive takes max + 1.', draw(), panel());

    for (const ev of inp.events) {
      const p = ev.p;
      let note: string;
      if (ev.kind === 'recv') {
        const m = inflight.get(ev.msg!)!;
        const before = L[p];
        const oldV = [...V[p]];
        L[p] = Math.max(L[p], m.l) + 1;
        V[p] = V[p].map((x, i) => Math.max(x, m.v[i]));
        V[p][p]++;
        note = `P${p + 1} receives ${ev.msg} (L=${m.l}): L = max(${before}, ${m.l}) + 1 = ${L[p]}. VC = max(${vc(oldV)}, ${vc(m.v)}), own +1 → ${vc(V[p])}.`;
      } else {
        L[p]++;
        V[p][p]++;
        note = ev.kind === 'send'
          ? `P${p + 1} sends ${ev.msg}: tick to L=${L[p]}, VC ${vc(V[p])}. Both clocks travel with the message.`
          : `Local event ${ev.id} on P${p + 1}: L=${L[p]}, VC ${vc(V[p])}.`;
      }
      const rec = { l: L[p], v: [...V[p]], ev };
      done.set(ev.id, rec);
      if (ev.kind === 'send') inflight.set(ev.msg!, rec);
      yield frame(note, draw({ [ev.id]: 'current' }), panel());
    }

    const leq = (a: number[], b: number[]) => a.every((x, i) => x <= b[i]);
    for (let k = 0; k < inp.compare.length; k++) {
      const [x, y] = inp.compare[k];
      const A = done.get(x)!, B = done.get(y)!;
      let note: string;
      let tone: Tone;
      if (leq(A.v, B.v) || leq(B.v, A.v)) {
        const [f, s] = leq(A.v, B.v) ? [x, y] : [y, x];
        const [F, S] = f === x ? [A, B] : [B, A];
        note = `${f} → ${s}: VC ${vc(F.v)} ≤ ${vc(S.v)} in every slot, so ${f} happened-before ${s}. Lamport agrees: ${F.l} < ${S.l}.`;
        tone = 'path';
      } else {
        const lo = A.l <= B.l ? x : y;
        note = `${x} and ${y} are concurrent: ${vc(A.v)} vs ${vc(B.v)} are incomparable. Lamport says L(${lo}) is smaller, yet neither caused the other.`;
        tone = 'warn';
      }
      yield frame(note, draw({ [x]: tone, [y]: tone }), panel(), k === inp.compare.length - 1);
    }
    if (!inp.compare.length) yield frame('Done.', draw(), panel(), true);
  },
});

// ---------------- Raft log replication ----------------

interface RaftInput {
  term: number;
  logs: number[][];
  down: number[];
  commit: number;
  cmds: string[];
}

interface Entry {
  term: number;
  cmd: string;
}

registerDemo({
  slug: 'raft-log',
  title: 'Raft log replication',
  group: GROUP,
  summary: 'Leader appends, sends AppendEntries with a consistency check, repairs lagging logs, and commits once a majority stores the entry.',
  linkedFrom: ['Consensus'],
  editable: 'none',
  inputs: [
    { id: 'conflict', label: 'Conflicting follower', data: { term: 3, logs: [[1, 1, 2, 3], [1, 1, 2, 3], [1, 1, 2, 2, 2], [1, 1], [1, 1, 2]], down: [4], commit: 3, cmds: ['x=5'] } satisfies RaftInput },
    { id: 'down', label: 'Follower down', data: { term: 3, logs: [[1, 1, 2, 3], [1, 1, 2, 3], [1, 1, 2], [1, 1, 2, 3], [1, 1, 2, 3]], down: [3, 4], commit: 4, cmds: ['x=5', 'y=7'] } satisfies RaftInput },
    { id: 'nomaj', label: 'No majority', data: { term: 3, logs: [[1, 1, 2, 3], [1, 1, 2, 3], [1, 1, 2, 3], [1, 1, 2, 3], [1, 1, 2, 3]], down: [2, 3, 4], commit: 4, cmds: ['x=5'] } satisfies RaftInput },
  ],
  *run(raw) {
    const inp = raw as RaftInput;
    const N = inp.logs.length;
    const maj = Math.floor(N / 2) + 1;
    const logs: Entry[][] = inp.logs.map(l => l.map(t => ({ term: t, cmd: '' })));
    const down = new Set(inp.down);
    const leader = logs[0];
    let commit = inp.commit;
    const next = logs.map(() => leader.length + 1);
    const match = logs.map((l, i) => (i === 0 ? l.length : 0));
    const rowY = (i: number) => 100 + i * 165;
    const colW = Math.min(115, 720 / Math.min(9, Math.max(...inp.logs.map(l => l.length)) + inp.cmds.length));
    const cellX = (idx: number) => 240 + (idx - 1) * colW;
    const maxLen = () => Math.max(...logs.map(l => l.length));

    const draw = (o: { msg?: { to: number; ok: boolean; label: string }; fresh?: Set<string> } = {}): Shape[] => {
      const out: Shape[] = [];
      const cols = Math.min(9, maxLen());
      for (let i = 1; i <= cols; i++) out.push(text(`ix${i}`, cellX(i) + (colW - 10) / 2, 50, String(i), { align: 'center', tone: 'default', size: 26 }));
      logs.forEach((log, s) => {
        const id = `S${s + 1}`;
        const target = o.msg?.to === s;
        out.push({
          t: 'node', id: `s:${id}`, x: 150, y: rowY(s) + 45, r: 44, label: id,
          tone: down.has(s) ? 'fail' : s === 0 ? 'accent' : target ? (o.msg!.ok ? 'ok' : 'fail') : 'default', badge: s === 0 ? 'leader' : down.has(s) ? 'down' : undefined,
          sub: target ? o.msg!.label : undefined,
        });
        log.slice(0, 9).forEach((e, k) => {
          const idx = k + 1;
          const known = s === 0 ? commit : Math.min(commit, match[s]);
          const conflict = s !== 0 && (leader[k]?.term ?? -1) !== e.term;
          const tone: Tone = o.fresh?.has(`${s}:${idx}`) ? 'current' : conflict ? 'fail' : idx <= known || (idx <= inp.commit && !conflict) ? 'ok' : 'default';
          out.push({ t: 'rect', id: `c:${id}:${idx}`, x: cellX(idx), y: rowY(s), w: colW - 10, h: 90, label: `t${e.term}`, sub: e.cmd || undefined, tone, filled: tone !== 'default', radius: 8 });
        });
      });
      const cx = cellX(commit) + colW - 5;
      out.push({ t: 'line', id: 'commit', x1: cx, y1: 75, x2: cx, y2: rowY(N - 1) + 105, tone: 'ok', dashed: true });
      out.push(text('commitL', cx, rowY(N - 1) + 140, `commit ${commit}`, { tone: 'ok', align: 'center', size: 28, bold: true }));
      if (o.msg) {
        out.push({ t: 'edge', id: `ae:${o.msg.to}`, from: 's:S1', to: `s:S${o.msg.to + 1}`, bend: 110 + 30 * o.msg.to, arrow: true, tone: o.msg.ok ? 'ok' : 'fail' });
      }
      return out;
    };
    const panel = () => ({
      title: `Leader S1 · term ${inp.term}`,
      rows: [
        ...logs.slice(1).map((_, k) => {
          const i = k + 1;
          return { label: `S${i + 1}`, value: down.has(i) ? 'down' : `next ${next[i]} · match ${match[i]}`, tone: (down.has(i) ? 'fail' : match[i] === leader.length ? 'ok' : undefined) as Tone | undefined };
        }),
        { label: 'commitIndex', value: String(commit), tone: 'ok' as Tone },
      ],
    });

    const conflicts = logs.slice(1).map((l, k) => ({ s: k + 2, n: l.filter((e, j) => (leader[j]?.term ?? -1) !== e.term).length })).filter(c => c.n);
    const facts = [
      conflicts.length ? `S${conflicts[0].s} holds ${conflicts[0].n} conflicting entr${conflicts[0].n > 1 ? 'ies' : 'y'}` : '',
      down.size ? `${[...down].map(d => `S${d + 1}`).join(', ')} ${down.size > 1 ? 'are' : 'is'} down` : '',
    ].filter(Boolean);
    const tail = facts.length ? ` ${facts.join('; ')}.` : '';
    yield frame(`Leader S1 (term ${inp.term}) has ${leader.length} entries, commitIndex ${commit}.${tail}`, draw(), panel());

    for (const cmd of inp.cmds) {
      leader.push({ term: inp.term, cmd });
      match[0] = leader.length;
      yield frame(`Client sends SET ${cmd}. Leader appends it at index ${leader.length} (term ${inp.term}); not committed yet.`, draw({ fresh: new Set([`0:${leader.length}`]) }), panel());
    }

    const tryCommit = function* () {
      for (let idx = leader.length; idx > commit; idx--) {
        const holders = match.map((m, i) => (m >= idx ? `S${i + 1}` : '')).filter(Boolean);
        if (holders.length >= maj && leader[idx - 1].term === inp.term) {
          commit = idx;
          yield frame(`Index ${idx} is on ${holders.length} of ${N} (${holders.join(', ')}) and from term ${inp.term} → commitIndex = ${idx}.`, draw(), panel());
          return;
        }
      }
    };

    const reportedDown = new Set<number>();
    for (let round = 0; round < 12; round++) {
      let pending = false;
      for (let s = 1; s < N; s++) {
        if (match[s] === leader.length) continue;
        if (down.has(s)) {
          if (!reportedDown.has(s)) {
            reportedDown.add(s);
            yield frame(`AppendEntries to S${s + 1} times out: it's down. The leader keeps retrying in the background.`, draw({ msg: { to: s, ok: false, label: 'timeout' } }), panel());
          }
          continue;
        }
        pending = true;
        const prev = next[s] - 1;
        const prevTerm = prev > 0 ? leader[prev - 1].term : 0;
        const log = logs[s];
        const ok = prev === 0 || (log.length >= prev && log[prev - 1].term === prevTerm);
        const label = `prev ${prev}/t${prevTerm}`;
        if (!ok) {
          const why = log.length < prev ? `it has no entry at index ${prev}` : `its index ${prev} has term ${log[prev - 1].term}, not ${prevTerm}`;
          next[s]--;
          yield frame(`S${s + 1} rejects AppendEntries(${label}): ${why}. Leader backs nextIndex off to ${next[s]}.`, draw({ msg: { to: s, ok: false, label } }), panel());
          continue;
        }
        const overwritten = log.slice(prev).filter((e, j) => leader[prev + j] && leader[prev + j].term !== e.term).length;
        const sent = leader.slice(prev);
        logs[s] = [...log.slice(0, prev), ...sent.map(e => ({ ...e }))];
        match[s] = leader.length;
        next[s] = leader.length + 1;
        const fresh = new Set(sent.map((_, j) => `${s}:${prev + j + 1}`));
        yield frame(
          `S${s + 1} accepts (${label} matches) and stores ${sent.length} entr${sent.length > 1 ? 'ies' : 'y'}${overwritten ? `, overwriting ${overwritten} conflicting` : ''}. matchIndex = ${match[s]}.`,
          draw({ msg: { to: s, ok: true, label }, fresh }), panel(),
        );
        yield* tryCommit();
      }
      if (!pending) break;
    }

    const holders = match.filter(m => m >= leader.length).length;
    const last = commit === leader.length
      ? `All live followers match the leader; commitIndex = ${commit}. Down servers get repaired the same way when they return.`
      : `Only ${holders} of ${N} servers hold index ${leader.length}, below a majority of ${maj}. It stays uncommitted and clients wait.`;
    yield frame(last, draw(), panel(), true);
  },
});

// ---------------- CRDTs ----------------

type CrdtStep =
  | { op: 'inc'; r: number; n?: number }
  | { op: 'merge'; from: number; to: number }
  | { op: 'add'; r: number; el: string }
  | { op: 'rm'; r: number; el: string };

interface CrdtInput {
  kind: 'gcounter' | 'orset';
  replicas: number;
  steps: CrdtStep[];
}

registerDemo({
  slug: 'crdt',
  title: 'CRDT merge',
  group: GROUP,
  summary: 'Replicas update independently and merge in any order, any number of times, and still converge.',
  linkedFrom: ['Figma'],
  editable: 'none',
  inputs: [
    {
      id: 'gcounter', label: 'G-counter', data: {
        kind: 'gcounter', replicas: 3, steps: [
          { op: 'inc', r: 0, n: 2 }, { op: 'inc', r: 1 }, { op: 'inc', r: 2, n: 3 },
          { op: 'merge', from: 0, to: 1 }, { op: 'merge', from: 2, to: 0 }, { op: 'merge', from: 1, to: 2 },
          { op: 'merge', from: 2, to: 0 }, { op: 'merge', from: 0, to: 1 }, { op: 'merge', from: 0, to: 1 },
        ],
      } satisfies CrdtInput,
    },
    {
      id: 'orset', label: 'OR-set', data: {
        kind: 'orset', replicas: 2, steps: [
          { op: 'add', r: 0, el: 'milk' }, { op: 'add', r: 1, el: 'milk' }, { op: 'add', r: 1, el: 'eggs' },
          { op: 'rm', r: 0, el: 'milk' }, { op: 'merge', from: 1, to: 0 }, { op: 'merge', from: 0, to: 1 },
        ],
      } satisfies CrdtInput,
    },
  ],
  *run(raw) {
    const inp = raw as CrdtInput;
    if (inp.kind === 'orset') yield* orSet(inp);
    else yield* gCounter(inp);
  },
});

const RN = ['A', 'B', 'C', 'D'];

function* gCounter(inp: CrdtInput) {
  const R = Math.min(3, inp.replicas);
  const vec = Array.from({ length: R }, () => new Array(R).fill(0) as number[]);
  const rowY = (i: number) => 280 + i * 250;
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  const draw = (hi: Set<string> = new Set(), msg?: [number, number]): Shape[] => {
    const out: Shape[] = [];
    for (let c = 0; c < R; c++) out.push(text(`h${c}`, 365 + c * 150, rowY(0) - 100, `${RN[c]}'s slot`, { align: 'center', tone: 'default', size: 28 }));
    out.push(text('hsum', 870, rowY(0) - 100, 'value', { align: 'center', tone: 'default', size: 28 }));
    if (msg) out.push({ t: 'edge', id: `mg${msg[0]}-${msg[1]}`, from: `r${msg[0]}`, to: `r${msg[1]}`, bend: (msg[0] < msg[1] ? 1 : -1) * (120 + 60 * Math.abs(msg[1] - msg[0])), arrow: true, tone: 'protocol', width: 5 });
    for (let r = 0; r < R; r++) {
      out.push({ t: 'node', id: `r${r}`, x: 170, y: rowY(r), r: 44, label: RN[r], tone: hi.has(`r${r}`) ? 'current' : 'default' });
      for (let c = 0; c < R; c++) {
        const k = `${r}:${c}`;
        out.push({ t: 'rect', id: `v${k}`, x: 300 + c * 150, y: rowY(r) - 50, w: 130, h: 100, label: String(vec[r][c]), tone: hi.has(k) ? 'current' : 'default', filled: hi.has(k) || c === r, mono: true, radius: 8 });
      }
      out.push(text(`val${r}`, 870, rowY(r), `= ${sum(vec[r])}`, { align: 'center', size: 40, bold: true }));
    }
    return out;
  };
  const panel = () => ({ title: 'Value per replica', rows: vec.map((v, i) => ({ label: RN[i], value: `[${v.join(',')}] = ${sum(v)}` })) });

  yield frame(`G-counter: each of ${R} replicas keeps one slot per replica and only increments its own. Value = sum of slots.`, draw(), panel());
  for (const st of inp.steps) {
    if (st.op === 'inc') {
      const n = st.n ?? 1;
      vec[st.r][st.r] += n;
      yield frame(`${RN[st.r]} increments ${n}× locally: its own slot → ${vec[st.r][st.r]}. No coordination needed.`, draw(new Set([`${st.r}:${st.r}`, `r${st.r}`])), panel());
    } else if (st.op === 'merge') {
      const a = vec[st.from], b = vec[st.to];
      const before = [...b];
      const changed = new Set<string>();
      b.forEach((x, i) => {
        if (a[i] > x) changed.add(`${st.to}:${i}`);
        b[i] = Math.max(x, a[i]);
      });
      const note = changed.size
        ? `${RN[st.from]} → ${RN[st.to]}: max([${a.join(',')}], [${before.join(',')}]) = [${b.join(',')}]. ${RN[st.to]} now reads ${sum(b)}.`
        : `${RN[st.from]} → ${RN[st.to]} again: max changes nothing (idempotent). Adding counts instead would double-count to ${sum(before) + sum(a)}.`;
      yield frame(note, draw(changed, [st.from, st.to]), panel());
    }
  }
  const vals = vec.map(sum);
  const converged = vals.every(v => v === vals[0]);
  yield frame(
    converged
      ? `All replicas converge to ${vals[0]} = ${vec[0].join(' + ')}, regardless of merge order.`
      : `Values ${vals.join(', ')} differ until every replica has merged every other.`,
    draw(), panel(), true,
  );
}

function* orSet(inp: CrdtInput) {
  const R = Math.min(2, inp.replicas);
  const adds = Array.from({ length: R }, () => new Map<string, Set<string>>());
  const removed = Array.from({ length: R }, () => new Set<string>());
  const tagN = new Array(R).fill(0);
  const elems: string[] = [];
  const rowY = (i: number) => 280 + i * 360;
  const live = (r: number, el: string) => [...(adds[r].get(el) ?? [])].filter(t => !removed[r].has(t));
  const present = (r: number) => elems.filter(el => live(r, el).length);
  const draw = (hi: Set<string> = new Set(), msg?: [number, number]): Shape[] => {
    const out: Shape[] = [];
    for (let r = 0; r < R; r++) {
      out.push({ t: 'node', id: `r${r}`, x: 170, y: rowY(r), r: 44, label: RN[r], tone: hi.has(`r${r}`) ? 'current' : 'default' });
      elems.forEach((el, k) => {
        const tags = live(r, el);
        if (!tags.length) return;
        out.push({ t: 'rect', id: `el${r}:${el}`, x: 290 + k * 230, y: rowY(r) - 60, w: 210, h: 120, label: el, sub: `{${tags.join(', ')}}`, tone: hi.has(`${r}:${el}`) ? 'current' : 'default', filled: true, radius: 10 });
      });
      out.push(text(`rm${r}`, 290, rowY(r) + 110, `removed tags: {${[...removed[r]].join(', ')}}`, { tone: 'default', size: 26, mono: true, align: 'left' }));
    }
    if (msg) out.push({ t: 'edge', id: `mg${msg[0]}-${msg[1]}`, from: `r${msg[0]}`, to: `r${msg[1]}`, arrow: true, tone: 'protocol', width: 5 });
    return out;
  };
  const panel = () => ({ title: 'Visible set', rows: Array.from({ length: R }, (_, r) => ({ label: RN[r], value: `{${present(r).join(', ')}}` })) });

  yield frame('OR-set: every add gets a unique tag; remove deletes only the tags it has seen. Merge = union of adds and removes.', draw(), panel());
  for (const st of inp.steps) {
    if (st.op === 'add') {
      if (!elems.includes(st.el)) elems.push(st.el);
      const tag = `${RN[st.r].toLowerCase()}${++tagN[st.r]}`;
      if (!adds[st.r].has(st.el)) adds[st.r].set(st.el, new Set());
      adds[st.r].get(st.el)!.add(tag);
      yield frame(`${RN[st.r]} adds "${st.el}" with tag ${tag}.`, draw(new Set([`${st.r}:${st.el}`, `r${st.r}`])), panel());
    } else if (st.op === 'rm') {
      const seen = live(st.r, st.el);
      seen.forEach(t => removed[st.r].add(t));
      yield frame(`${RN[st.r]} removes "${st.el}": tombstones only the tags it observed {${seen.join(', ')}}.`, draw(new Set([`r${st.r}`])), panel());
    } else if (st.op === 'merge') {
      const { from, to } = st;
      const before = present(to);
      for (const [el, tags] of adds[from]) {
        if (!adds[to].has(el)) adds[to].set(el, new Set());
        tags.forEach(t => adds[to].get(el)!.add(t));
      }
      removed[from].forEach(t => removed[to].add(t));
      const after = present(to);
      const survivor = after.find(el => live(to, el).some(t => !t.startsWith(RN[to].toLowerCase())) && removed[to].size);
      const note = survivor
        ? `${RN[from]} → ${RN[to]}: union gives {${after.join(', ')}}. "${survivor}" survives via ${live(to, survivor).join(', ')}, a concurrent add ${RN[to]} never saw: add wins.`
        : `${RN[from]} → ${RN[to]}: union of tags and tombstones. {${before.join(', ')}} → {${after.join(', ')}}.`;
      yield frame(note, draw(new Set(after.map(el => `${to}:${el}`)), [from, to]), panel());
    }
  }
  const sets = Array.from({ length: R }, (_, r) => present(r).join(', '));
  const same = sets.every(s => s === sets[0]);
  yield frame(same ? `Both replicas converge to {${sets[0]}}. Remove only beat the adds it had observed.` : `Replicas still differ: {${sets.join('} vs {')}}.`, draw(), panel(), true);
}

// ---------------- Snowflake ----------------

interface SnowflakeInput {
  dc: number;
  worker: number;
  /** observed clock readings, ms offsets from base */
  times: number[];
}

const SF_EPOCH = 1288834974657n;
const SF_BASE = 1790000000000n;

registerDemo({
  slug: 'snowflake',
  title: 'Snowflake ID bit layout',
  group: GROUP,
  summary: '64-bit IDs: timestamp, machine and sequence bits give unique, time-sortable IDs with no coordination.',
  linkedFrom: ['TinyURL', 'ID gen'],
  editable: 'none',
  inputs: [
    { id: 'burst', label: 'Same-ms burst', data: { dc: 3, worker: 7, times: [0, 0, 0, 1, 1] } satisfies SnowflakeInput },
    { id: 'back', label: 'Clock goes backwards', data: { dc: 3, worker: 7, times: [0, 1, -2, 2] } satisfies SnowflakeInput },
  ],
  *run(raw) {
    const inp = raw as SnowflakeInput;
    const segs = [
      { id: 'sign', label: 'sign', bits: 1, x: 40, w: 90 },
      { id: 'ts', label: 'timestamp', bits: 41, x: 130, w: 390 },
      { id: 'dc', label: 'dc', bits: 5, x: 520, w: 130 },
      { id: 'wk', label: 'worker', bits: 5, x: 650, w: 140 },
      { id: 'seq', label: 'sequence', bits: 12, x: 790, w: 170 },
    ];
    let cur: { ts: bigint; seq: number; id: bigint } | undefined;
    const history: bigint[] = [];
    const draw = (hi?: string): Shape[] => {
      const out: Shape[] = segs.map(s => {
        const val = cur ? { sign: '0', ts: String(cur.ts), dc: String(inp.dc), wk: String(inp.worker), seq: String(cur.seq) }[s.id] : undefined;
        return { t: 'rect', id: `seg:${s.id}`, x: s.x + 3, y: 110, w: s.w - 6, h: 140, label: s.label, sub: val, tone: hi === s.id ? 'current' : 'default', filled: hi === s.id, radius: 8 } as Shape;
      });
      segs.forEach(s => out.push(text(`bits:${s.id}`, s.x + s.w / 2, 60, `${s.bits} bit${s.bits > 1 ? 's' : ''}`, { align: 'center', tone: 'default', size: 26 })));
      if (cur) out.push(text('dec', 500, 360, cur.id.toString(), { mono: true, align: 'center', size: 48, bold: true }));
      history.forEach((h, i) => out.push(text(`hist${i}`, 500, 480 + i * 70, `${i + 1}. ${h.toString()}`, { mono: true, align: 'center', size: 32, tone: i === history.length - 1 ? 'accent' : 'default' })));
      return out;
    };
    const panel = () => ({
      title: 'Fields',
      rows: [
        { label: 'timestamp', value: cur ? `${cur.ts} ms` : '—' },
        { label: 'datacenter', value: String(inp.dc) },
        { label: 'worker', value: String(inp.worker) },
        { label: 'sequence', value: cur ? String(cur.seq) : '—' },
      ],
    });

    yield frame('A Snowflake ID packs 64 bits: 1 sign, 41 timestamp, 10 machine, 12 sequence.', draw(), panel());
    yield frame('The sign bit stays 0 so IDs are positive in signed 64-bit integers.', draw('sign'), panel());
    yield frame('41 bits of milliseconds since a custom epoch: 2^41 ms ≈ 69.7 years of IDs.', draw('ts'), panel());
    yield frame(`5 datacenter + 5 worker bits = 1024 generators, assigned once. This one is dc ${inp.dc}, worker ${inp.worker}.`, draw('dc'), panel());
    yield frame('12-bit sequence: 4096 IDs per millisecond per worker, ~4M per second.', draw('seq'), panel());

    let last = -1n;
    let seq = 0;
    for (const off of inp.times) {
      let ts = SF_BASE + BigInt(off) - SF_EPOCH;
      let note: string;
      if (ts < last) {
        const back = last - ts;
        ts = last + 1n;
        seq = 0;
        note = `Clock jumped back ${back} ms. The generator waits until ${ts} ms (last + 1) so it never reissues an ID.`;
      } else if (ts === last) {
        seq++;
        note = `Same ms (${ts}) as the last ID → sequence ${seq}.`;
      } else {
        seq = 0;
        note = `New ms ${ts} → sequence resets to 0.`;
      }
      last = ts;
      const id = (ts << 22n) | (BigInt(inp.dc) << 17n) | (BigInt(inp.worker) << 12n) | BigInt(seq);
      cur = { ts, seq, id };
      history.push(id);
      if (history.length > 6) history.shift();
      yield frame(history.length === 1 ? `${note} ID = ts<<22 | dc<<17 | worker<<12 | seq.` : note, draw(seq > 0 ? 'seq' : 'ts'), panel());
    }
    const sorted = history.every((h, i) => i === 0 || history[i - 1] < h);
    yield frame(`${history.length} IDs, ${sorted ? 'strictly increasing' : 'not sorted'}: newer IDs sort later, so they index well.`, draw(), panel(), true);
  },
});
