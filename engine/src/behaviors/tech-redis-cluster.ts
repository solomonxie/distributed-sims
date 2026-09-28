// Redis Cluster internals: 16384 hash slots (CRC16 mod 16384) over primaries, async replicas,
// a gossip bus (PING/PONG with failure reports → PFAIL → FAIL → replica election), smart
// clients that follow MOVED / ASK redirects, live resharding (MIGRATING / IMPORTING slots).
// Protocol kinds: cluster.PING, cluster.FAIL, cluster.AUTH (failover votes), cluster.SLOTS,
// cluster.MIGRATE, redis.cmd, redis.REPL.
import type { NodeLogic, Req, SimNode } from '../node';
import type { World } from '../world';
import type { Badge, Msg } from '../types';
import { register } from './registry';
import { clusterOf } from '../composite';

export const SLOTS = 16384;

/** CRC16-XMODEM, the hash Redis Cluster uses. */
export function crc16(s: string): number {
  let crc = 0;
  for (let i = 0; i < s.length; i++) {
    crc ^= (s.charCodeAt(i) & 0xff) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** HASH_SLOT: only the part inside the first non-empty {…} is hashed (hash tags). */
export function keySlot(key: string): number {
  const a = key.indexOf('{');
  if (a >= 0) {
    const b = key.indexOf('}', a + 1);
    if (b > a + 1) return crc16(key.slice(a + 1, b)) % SLOTS;
  }
  return crc16(key) % SLOTS;
}

function parseRanges(s: string): [number, number][] {
  return s
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(r => {
      const [a, b] = r.split('-').map(Number);
      return [a, isFinite(b) ? b : a] as [number, number];
    });
}

function toRanges(slots: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const s of slots) {
    const last = out[out.length - 1];
    if (last && last[1] === s - 1) last[1] = s;
    else out.push([s, s]);
  }
  return out;
}
const fmtRanges = (r: [number, number][]) => (r.length ? r.slice(0, 3).map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',') + (r.length > 3 ? '…' : '') : 'none');

/** stable 0..1 per key (which keys a slot migration has already moved) */
const frac = (key: string) => (crc16(key + '#') % 1000) / 1000;

interface Ledger {
  promos: Map<string, { by: string; offset: number }>;
  counted: Map<string, number>;
}
const ledgers = new WeakMap<World, Ledger>();
function ledger(w: World): Ledger {
  let l = ledgers.get(w);
  if (!l) ledgers.set(w, (l = { promos: new Map(), counted: new Map() }));
  return l;
}

const cluster = (n: SimNode) => clusterOf(n, 'redis-cluster');
const clusterNodes = (n: SimNode) =>
  [...n.world.nodes.values()]
    .filter(x => x.type === 'redis-cluster-node' && cluster(x) === cluster(n))
    .sort((a, b) => (a.id < b.id ? -1 : 1));

function ref(n: SimNode, id: string): string {
  if (!id || n.world.nodes.has(id)) return id;
  const i = n.id.lastIndexOf('/');
  return i > 0 ? `${n.id.slice(0, i)}/${id}` : id;
}

/** Each node's (and client's) own copy of the cluster config. */
class View {
  ids: string[];
  owner: Int16Array;
  epoch = new Map<string, number>();
  role = new Map<string, 'primary' | 'replica'>();
  primaryOf = new Map<string, string>();
  constructor(nodes: SimNode[]) {
    this.ids = nodes.map(x => x.id);
    this.owner = new Int16Array(SLOTS).fill(-1);
    nodes.forEach((x, i) => {
      const replica = x.str('role', 'primary') === 'replica';
      this.role.set(x.id, replica ? 'replica' : 'primary');
      if (replica) this.primaryOf.set(x.id, ref(x, x.str('replicaOf', '')));
      else {
        this.epoch.set(x.id, i + 1);
        for (const [a, b] of parseRanges(x.str('slotRange', ''))) for (let s = a; s <= b && s < SLOTS; s++) this.owner[s] = i;
      }
    });
  }
  ownerOf(slot: number): string | undefined {
    const i = this.owner[slot];
    return i >= 0 ? this.ids[i] : undefined;
  }
  slotsOf(id: string): number[] {
    const i = this.ids.indexOf(id);
    const out: number[] = [];
    for (let s = 0; s < SLOTS; s++) if (this.owner[s] === i) out.push(s);
    return out;
  }
  /** apply a node's claim; higher configEpoch wins each slot */
  claim(id: string, epoch: number, ranges: [number, number][]): string[] {
    const i = this.ids.indexOf(id);
    if (i < 0) return [];
    const losers = new Set<string>();
    for (const [a, b] of ranges)
      for (let s = a; s <= b; s++) {
        const cur = this.owner[s];
        if (cur === i) continue;
        const curId = cur >= 0 ? this.ids[cur] : undefined;
        if (curId && (this.epoch.get(curId) ?? 0) >= epoch) continue;
        if (curId) losers.add(curId);
        this.owner[s] = i;
      }
    this.epoch.set(id, Math.max(this.epoch.get(id) ?? 0, epoch));
    this.role.set(id, 'primary');
    this.primaryOf.delete(id);
    return [...losers];
  }
  primaries(): string[] {
    return this.ids.filter(id => this.role.get(id) === 'primary' && this.owner.includes(this.ids.indexOf(id)));
  }
  copyFrom(v: View) {
    this.owner = Int16Array.from(v.owner);
    this.epoch = new Map(v.epoch);
    this.role = new Map(v.role);
    this.primaryOf = new Map(v.primaryOf);
  }
}

// ---------------- cluster node ----------------
register('redis-cluster-node', n => {
  let view: View | undefined;
  let offset = 0;
  let currentEpoch = 0;
  const lastPong = new Map<string, number>();
  const pinging = new Set<string>();
  const pfail = new Set<string>();
  const fail = new Set<string>();
  const reports = new Map<string, Map<string, number>>();
  let votedEpoch = 0;
  let electionAt = 0;
  let electing = false;
  let fenced = false;
  let uncovered = false;
  let ops = 0;
  let mineCache: [number, number][] | undefined;
  const migrating = new Map<number, { to: string; start: number; ms: number }>();
  const importing = new Map<number, string>();
  let reshard: { total: number; done: number } | undefined;

  const timeout = () => n.num('nodeTimeoutMs', 3000);
  const me = () => n.id;
  const v = () => (view ??= new View(clusterNodes(n)));
  const isPrimary = () => v().role.get(me()) === 'primary';
  const myPrimary = () => v().primaryOf.get(me());
  const nodeOf = (id: string) => n.world.nodes.get(id);
  const logicOf = (id: string) => nodeOf(id)?.logic as any;
  const nm = (id: string) => n.world.nodeName(id);
  const mine = () => (mineCache ??= toRanges(v().slotsOf(me())));
  const dirty = () => (mineCache = undefined);
  const majority = () => Math.floor(v().primaries().length / 2) + 1;

  function header() {
    const gossip = v()
      .ids.filter(id => id !== me())
      .map(id => [id, fail.has(id) ? 2 : pfail.has(id) ? 1 : 0] as [string, number]);
    return isPrimary()
      ? { role: 'primary', epoch: v().epoch.get(me()) ?? 0, cur: currentEpoch, slots: mine(), gossip }
      : { role: 'replica', primary: myPrimary(), cur: currentEpoch, gossip };
  }

  function onHeader(from: string, h: any) {
    lastPong.set(from, n.now);
    if (pfail.delete(from) && !fail.has(from)) n.log('protocol', `${n.name}: ${nm(from)} reachable again (PFAIL cleared)`);
    if (fail.has(from) && (h.role === 'replica' || !h.slots?.length)) fail.delete(from);
    currentEpoch = Math.max(currentEpoch, h.cur ?? 0);
    if (h.role === 'primary') {
      const had = isPrimary();
      const losers = v().claim(from, h.epoch, h.slots ?? []);
      if (losers.length) dirty();
      if (fail.has(from) && h.slots?.length) fail.delete(from);
      if (had && losers.includes(me()) && !mine().length) demote(from);
    } else if (h.primary) {
      v().role.set(from, 'replica');
      v().primaryOf.set(from, h.primary);
    }
    // failure reports from primaries
    if (h.role === 'primary')
      for (const [id, st] of h.gossip ?? []) {
        if (id === me()) continue;
        const r = reports.get(id) ?? new Map<string, number>();
        reports.set(id, r);
        if (st > 0) r.set(from, n.now);
        else r.delete(from);
      }
  }

  function demote(to: string) {
    const l = ledger(n.world);
    const p = l.promos.get(me());
    let lost = 0;
    if (p) {
      lost = Math.max(0, offset - Math.max(p.offset, l.counted.get(me()) ?? 0));
      l.counted.set(me(), offset);
    }
    v().role.set(me(), 'replica');
    v().primaryOf.set(me(), to);
    dirty();
    n.log('protocol', `${n.name} sees ${nm(to)} owns its slots with a newer configEpoch → rejoins as its replica and flushes its data` + (lost ? ` · ${Math.round(lost)} writes it accepted are lost` : ''));
    if (lost > 0) n.anomaly('lost-write', lost);
    offset = logicOf(to)?.offset?.() ?? 0;
    fenced = false;
  }

  function ping(to: string) {
    if (pinging.has(to)) return;
    pinging.add(to);
    n.rpc(to, { kind: 'cluster.PING', data: header() }, timeout(), r => {
      pinging.delete(to);
      if (r.ok && r.data) onHeader(to, r.data);
    });
  }

  function tick() {
    const peers = v().ids.filter(id => id !== me());
    if (!peers.length) return;
    ping(peers[n.rng.int(peers.length)]);
    for (const p of peers) if (n.now - (lastPong.get(p) ?? 0) > timeout() / 2) ping(p);
    // failure detection
    for (const p of peers) {
      const silent = n.now - (lastPong.get(p) ?? n.now) > timeout();
      if (silent && !pfail.has(p) && !fail.has(p)) {
        pfail.add(p);
        n.log('protocol', `${n.name} marks ${nm(p)} PFAIL (no PONG for ${(timeout() / 1000).toFixed(1)}s)`);
      }
      if (pfail.has(p) && !fail.has(p)) {
        const r = reports.get(p) ?? new Map();
        const agree = [...r].filter(([by, t]) => n.now - t < timeout() * 2 && by !== p && v().role.get(by) === 'primary').length + (isPrimary() ? 1 : 0);
        if (agree >= majority()) {
          markFail(p, `${agree} of ${v().primaries().length} primaries agree`);
          for (const q of peers) if (q !== p) n.send(q, { kind: 'cluster.FAIL', data: { id: p } });
        }
      }
    }
    // a primary cut off from the majority stops taking writes
    if (isPrimary()) {
      const seen = v().primaries().filter(id => id === me() || (!pfail.has(id) && !fail.has(id))).length;
      const f = seen < majority();
      if (f !== fenced) n.log('protocol', f ? `${n.name} can't reach a majority of primaries → CLUSTERDOWN, stops accepting writes` : `${n.name} sees the majority again`);
      fenced = f;
    }
    uncovered = [...fail].some(f => v().role.get(f) === 'primary' && v().owner.includes(v().ids.indexOf(f)));
    maybeFailover();
  }

  function markFail(p: string, why: string) {
    if (fail.has(p)) return;
    fail.add(p);
    pfail.delete(p);
    n.log('protocol', `${n.name}: ${nm(p)} is FAIL (${why})`);
  }

  function maybeFailover() {
    const prim = myPrimary();
    if (isPrimary() || !prim || !fail.has(prim) || electing) return;
    if (!electionAt) {
      electionAt = n.now + 500 + n.rng.int(500);
      return;
    }
    if (n.now < electionAt) return;
    electing = true;
    const epoch = ++currentEpoch;
    const voters = v()
      .primaries()
      .filter(id => id !== prim);
    const need = majority();
    let yes = 0;
    let left = voters.length;
    n.log('protocol', `${n.name} (replica of ${nm(prim)}) asks primaries for votes, epoch ${epoch}`);
    const done = () => {
      if (--left > 0 && yes < need) return;
      if (!electing) return;
      electing = false;
      electionAt = 0;
      if (yes < need) return void (electionAt = n.now + timeout() * 2);
      promote(prim, epoch, yes);
    };
    if (!voters.length) return void (electing = false);
    for (const id of voters)
      n.rpc(id, { kind: 'cluster.AUTH', data: { epoch, primary: prim } }, timeout(), r => {
        if (r.ok) yes++;
        done();
      });
  }

  function promote(prim: string, epoch: number, votes: number) {
    const slots = v().slotsOf(prim);
    const l = ledger(n.world);
    const old = nodeOf(prim);
    const oldOff = logicOf(prim)?.offset?.() ?? offset;
    l.promos.set(prim, { by: me(), offset });
    if (old && !old.up && oldOff > offset) {
      n.anomaly('lost-write', oldOff - offset);
      l.counted.set(prim, oldOff);
    }
    v().claim(me(), epoch, toRanges(slots));
    v().role.set(prim, 'replica');
    v().primaryOf.set(prim, me());
    dirty();
    n.log(
      'protocol',
      `${n.name} won the election (${votes} votes) → promoted to primary for slots ${fmtRanges(toRanges(slots))}, configEpoch ${epoch}` +
        (old && !old.up && oldOff > offset ? ` · ${Math.round(oldOff - offset)} acknowledged writes never replicated (lost)` : ''),
    );
    for (const id of v().ids) if (id !== me()) n.send(id, { kind: 'cluster.PING', data: header() });
  }

  function exec(req: Req) {
    const m = req.msg;
    const d = m.data ?? {};
    const keys: string[] = d.keys ?? [];
    const slot = keySlot(keys[0] ?? '');
    const err = (code: string, extra: any = {}) => req.reply({ ok: false, err: '5xx', data: { code, ...extra } });
    if (keys.some(k => keySlot(k) !== slot)) return err('CROSSSLOT');
    if (fenced || (uncovered && n.bool('requireFullCoverage', true))) return err('CLUSTERDOWN');
    const owner = v().ownerOf(slot);
    if (owner !== me()) {
      if (d.asking && importing.has(slot)) return serve(req, 'imported');
      return req.reply({ ok: true, data: { code: 'MOVED', slot, to: owner } });
    }
    const mig = migrating.get(slot);
    if (mig && keys.every(k => frac(k) < (n.now - mig.start) / mig.ms)) return req.reply({ ok: true, data: { code: 'ASK', slot, to: mig.to } });
    serve(req, 'own');
  }

  function serve(req: Req, _why: string) {
    const op = req.msg.op ?? 'read';
    n.process(req.msg.weight, (n.num('execUs', 20) / 1000) * n.mods.slowX, ok => {
      if (!ok) return req.reply({ ok: false, err: '503' });
      ops += req.msg.weight;
      if (op === 'write') offset += req.msg.weight;
      req.reply({ ok: true, version: offset });
    });
  }

  // ---- resharding (redis-cli --cluster rebalance): this node takes an equal share ----
  function rebalance(sec: number) {
    if (reshard) return;
    const prims = v()
      .primaries()
      .filter(id => id !== me());
    if (!prims.length) return;
    const share = Math.floor(SLOTS / (prims.length + 1) / prims.length) * prims.length;
    const per = Math.floor(share / prims.length);
    const plan: { slot: number; from: string }[] = [];
    for (const p of prims) for (const s of v().slotsOf(p).slice(0, per)) plan.push({ slot: s, from: p });
    // sampled keys decide how long each slot takes (empty slots move instantly)
    const keysIn = new Map<number, number>();
    for (let k = 0; k < 1024; k++) {
      const s = keySlot(`user:${k}`);
      keysIn.set(s, (keysIn.get(s) ?? 0) + 1);
    }
    const heavy = plan.reduce((a, x) => a + (keysIn.get(x.slot) ?? 0), 0);
    const perKeyMs = (sec * 1000) / Math.max(1, heavy);
    reshard = { total: plan.length, done: 0 };
    n.log('protocol', `Resharding: moving ${plan.length} slots to ${n.name} from ${prims.map(nm).join(', ')} (MIGRATE key by key)`);
    let i = 0;
    const next = () => {
      if (!n.up) return;
      while (i < plan.length) {
        const { slot, from } = plan[i];
        const ms = (keysIn.get(slot) ?? 0) * perKeyMs;
        const src = logicOf(from);
        if (!nodeOf(from)?.up || !src) {
          i++;
          continue;
        }
        importing.set(slot, from);
        src.setMigrating(slot, me(), ms);
        if (ms <= 0) {
          finishSlot(slot, from);
          i++;
          continue;
        }
        n.send(from, { kind: 'cluster.MIGRATE', data: { slot, keys: keysIn.get(slot) } });
        n.timer(ms, () => {
          finishSlot(slot, from);
          i++;
          next();
        });
        return;
      }
      n.log('protocol', `Resharding done: ${n.name} now owns ${v().slotsOf(me()).length} slots`);
      reshard = undefined;
    };
    next();
  }

  function finishSlot(slot: number, from: string) {
    importing.delete(slot);
    // bump configEpoch without consensus only if another node's epoch is >= ours
    const mineE = v().epoch.get(me()) ?? 0;
    const others = Math.max(0, ...v().ids.filter(id => id !== me()).map(id => v().epoch.get(id) ?? 0));
    if (mineE <= others) currentEpoch = Math.max(currentEpoch, others) + 1;
    v().claim(me(), Math.max(mineE, currentEpoch), [[slot, slot]]);
    dirty();
    logicOf(from)?.slotMoved(slot, me(), v().epoch.get(me()));
    if (reshard) reshard.done++;
  }

  return {
    handles: k => k.startsWith('cluster.') || k.startsWith('redis.'),
    onStart() {
      n.cfg.instances = 1;
      n.cfg.slots = 1;
      n.series.setCapacity(1);
      v();
      currentEpoch = Math.max(currentEpoch, ...v().epoch.values());
      for (const id of v().ids) lastPong.set(id, n.now);
      pinging.clear();
      pfail.clear();
      electing = false;
      electionAt = 0;
      n.every(n.num('pingMs', 100), tick);
      n.every(n.num('replLagMs', 100), () => {
        if (!isPrimary()) return;
        for (const id of v().ids) if (v().primaryOf.get(id) === me()) n.send(id, { kind: 'redis.REPL', data: { offset } });
      });
      n.every(1000, () => {
        n.gauge('opsPerSec', ops);
        n.gauge('slots', isPrimary() ? v().slotsOf(me()).length : 0);
        n.gauge('offset', offset);
        n.gauge('epoch', v().epoch.get(me()) ?? 0);
        n.gauge('pfail', pfail.size);
        n.gauge('fail', fail.size);
        n.gauge('primary', isPrimary() ? 1 : 0);
        n.gauge('migrating', migrating.size + importing.size);
        if (reshard) n.gauge('reshardPct', Math.round((reshard.done / Math.max(1, reshard.total)) * 100));
        ops = 0;
      });
    },
    onRestart() {
      offset = 0; // no persistence: memory is gone
      fail.clear();
      reports.clear();
      migrating.clear();
      importing.clear();
      reshard = undefined;
    },
    onRequest(req: Req) {
      const k = req.msg.kind;
      if (k === 'cluster.PING') {
        onHeader(req.msg.from, req.msg.data);
        return req.reply({ ok: true, data: header() });
      }
      if (k === 'cluster.AUTH') {
        const { epoch, primary } = req.msg.data;
        const grant = isPrimary() && fail.has(primary) && epoch > votedEpoch;
        if (grant) votedEpoch = epoch;
        return req.reply({ ok: grant });
      }
      if (k === 'cluster.SLOTS') {
        const copy = new View([]);
        copy.ids = v().ids;
        copy.copyFrom(v());
        return req.reply({ ok: true, data: copy });
      }
      exec(req);
    },
    onMessage(m: Msg) {
      if (m.kind === 'cluster.PING') onHeader(m.from, m.data);
      else if (m.kind === 'cluster.FAIL') {
        const id = m.data.id;
        if (id !== me() && !fail.has(id)) markFail(id, `FAIL message from ${nm(m.from)}`);
      } else if (m.kind === 'redis.REPL') {
        if (!isPrimary()) offset = Math.max(offset, m.data.offset);
      }
    },
    onChaos(kind, p, heal) {
      if (kind === 'rebalance') {
        if (!heal) rebalance(Number(p.sec ?? 20));
        return true;
      }
      if (kind === 'kill-leader') {
        if (!isPrimary()) return false;
        if (!heal) n.kill();
        else n.restart();
        return true;
      }
      return false;
    },
    view() {
      const b: Badge[] = [];
      if (isPrimary()) {
        const r = mine();
        b.push({ text: `👑 ${fmtRanges(r)}`, tone: 'accent' });
      } else b.push({ text: `R of ${nm(myPrimary() ?? '?')}`, tone: 'muted' });
      if (fenced) b.unshift({ text: 'CLUSTERDOWN', tone: 'fail' });
      if (migrating.size) b.push({ text: 'MIGRATING', tone: 'warn' });
      if (importing.size) b.push({ text: 'IMPORTING', tone: 'protocol' });
      if (pfail.size || fail.size) b.push({ text: `${[...pfail].map(x => nm(x) + '?').concat([...fail].map(x => nm(x) + '✗')).join(' ')}`, tone: 'warn' });
      return { badges: b };
    },
    ...({
      offset: () => offset,
      setMigrating: (slot: number, to: string, ms: number) => migrating.set(slot, { to, start: n.now, ms: Math.max(1, ms) }),
      slotMoved: (slot: number, to: string, epoch: number) => {
        migrating.delete(slot);
        v().claim(to, epoch, [[slot, slot]]);
        dirty();
      },
    } as object),
  };
});

// ---------------- smart cluster client ----------------
register('redis-cluster-client', n => {
  let view: View | undefined;
  let lastRefresh = -1e9;
  let moved = 0;
  let ask = 0;
  let crossSlot = 0;
  let down = 0;
  let hops = 0;
  let reqs = 0;
  let logged = 0;
  let traced = false;
  const nodes = () => clusterNodes(n);
  const v = () => (view ??= new View(nodes()));

  function refresh(why: string) {
    if (n.now - lastRefresh < 1000) return;
    lastRefresh = n.now;
    const ups = v().ids.filter(id => n.world.nodes.get(id)?.up);
    const from = ups[n.rng.int(Math.max(1, ups.length))];
    if (!from) return;
    n.rpc(from, { kind: 'cluster.SLOTS' }, 500, r => {
      if (r.ok && r.data) {
        v().copyFrom(r.data as View);
        if (logged++ < 4) n.log('protocol', `${n.name} refreshed its slot map from ${n.world.nodeName(from)} (CLUSTER SLOTS, after ${why})`);
      }
    });
  }

  function keysFor(req: Req): string[] {
    const k = req.msg.key ?? 0;
    const multi = n.rng.chance(n.num('multiKeyPct', 0) / 100);
    if (!multi) return [`user:${k}`];
    return n.bool('hashTags', false) ? [`{user:${k}}:cart`, `{user:${k}}:profile`] : [`user:${k}:cart`, `user:${k}:profile`];
  }

  function send(req: Req, keys: string[], to: string | undefined, asking: boolean, attempt: number, trace = false) {
    if (!to) {
      refresh('an uncovered slot');
      return req.reply({ ok: false, err: 'unavailable' });
    }
    hops++;
    const slot = keySlot(keys[0]);
    n.rpc(to, { kind: 'redis.cmd', op: req.msg.op, weight: req.msg.weight, key: req.msg.key, data: { keys, asking } }, n.num('timeoutMs', 500), r => {
      const code = r.data?.code;
      if (trace && r.ok && !code) n.log('protocol', `${n.world.nodeName(to)} ran it on its single thread and replied${req.msg.op === 'write' ? '; the write streams to its replica asynchronously' : ''}`);
      if (r.ok && !code) return req.reply({ ok: true, version: r.version });
      if ((code === 'MOVED' || code === 'ASK') && attempt < 5) {
        if (code === 'MOVED') {
          moved += req.msg.weight;
          const i = v().ids.indexOf(r.data.to);
          if (i >= 0) v().owner[r.data.slot] = i;
          if (moved <= req.msg.weight) n.log('protocol', `MOVED ${slot} ${n.world.nodeName(r.data.to)}: ${n.name} updates its slot map and retries (extra hop)`);
        } else {
          ask += req.msg.weight;
          if (ask <= req.msg.weight) n.log('protocol', `ASK ${slot} ${n.world.nodeName(r.data.to)}: key already migrated; ${n.name} sends ASKING + command there once (map unchanged)`);
        }
        return send(req, keys, r.data.to, code === 'ASK', attempt + 1);
      }
      if (code === 'CROSSSLOT') {
        crossSlot += req.msg.weight;
        if (crossSlot <= req.msg.weight) n.log('info', `CROSSSLOT: ${req.msg.op === 'write' ? 'MSET' : 'MGET'} ${keys.join(' ')} — keys hash to slots ${keys.map(keySlot).join(' and ')}`);
        return req.reply({ ok: false, err: '5xx' });
      }
      down += req.msg.weight;
      refresh(code === 'CLUSTERDOWN' ? 'CLUSTERDOWN' : r.err === 'timeout' ? 'a timeout' : 'an error');
      req.reply({ ok: false, err: r.err === 'timeout' ? 'timeout' : '5xx' });
    });
  }

  return {
    onStart() {
      n.every(1000, () => {
        n.gauge('moved', Math.round(moved));
        n.gauge('ask', Math.round(ask));
        n.gauge('crossSlot', Math.round(crossSlot));
        n.gauge('errors', Math.round(down));
        n.gauge('hopsPerReq', reqs ? Math.round((hops / reqs) * 100) / 100 : 1);
        hops = 0;
        reqs = 0;
      });
    },
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.2, 1), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        reqs++;
        const keys = keysFor(req);
        const to = v().ownerOf(keySlot(keys[0]));
        const trace = !traced && n.now > 1000 && keys.length === 1;
        if (trace) {
          traced = true;
          n.log('protocol', `${req.msg.op === 'write' ? 'SET' : 'GET'} ${keys[0]}: CRC16 mod 16384 = slot ${keySlot(keys[0])}; cached slot map says ${to ? n.world.nodeName(to) : '?'} → sent straight there`);
        }
        send(req, keys, to, false, 0, trace);
      });
    },
    view() {
      return { badges: [{ text: n.bool('hashTags', false) ? '{hash tags}' : 'cluster client', tone: 'muted' }] as Badge[] };
    },
  };
});

export {};
