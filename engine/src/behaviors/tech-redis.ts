// Redis internals (technologies.md → Redis): one event-loop thread runs commands one at a
// time from a ready queue (epoll multiplexes the sockets); io-threads only offload read/parse
// and reply writes. fork()+COW snapshots, AOF fsync policy, async replicas, Sentinel failover.
import type { NodeLogic, Req, SimNode } from '../node';
import type { Badge, Msg } from '../types';
import { register } from './registry';
import { clusterOf } from '../composite';

/** exec cost multiplier by command mix (O(1) GET/SET = 1) */
const MIX: Record<string, { read: number; write: number; label: string }> = {
  'get-set': { read: 1, write: 1.3, label: 'GET/SET O(1)' },
  'sorted-set': { read: 4, write: 6, label: 'ZRANGE/ZADD O(log n)' },
  lists: { read: 8, write: 1.2, label: 'LRANGE 0 100 / LPUSH' },
  mixed: { read: 2, write: 2.5, label: 'mixed' },
};

export function redisServer(n: SimNode): NodeLogic {
  let roleNow: 'primary' | 'replica' = n.str('role', 'primary') === 'replica' ? 'replica' : 'primary';
  let started = false;
  const role = () => roleNow;
  const isPrimary = (x: SimNode) => x.up && (x.logic as any).isPrimary?.();
  let offset = 0; // replication offset = writes applied
  let lastFsync = 0;
  let unsynced = 0;
  let sinceSnapshot = 0;
  let snapshotUntil = 0;
  let snapshotStart = 0;
  let cowMb = 0;
  let diskX = 1;
  let blockedMs = 0;
  let opsW = 0;
  let slowCmd: { every: number; ms: number; label: string } | undefined;
  let primaryDown = 0;
  let replDelayMs = 0;
  let hist: [number, number][] = [];

  const datasetMb = () => n.num('datasetGb', 8) * 1024;
  const snapshotting = () => n.now < snapshotUntil;
  const peers = () => [...n.world.nodes.values()].filter(x => x !== n && x.type === 'redis-server' && clusterOf(x, 'r1') === clusterOf(n, 'r1'));

  /** main-thread µs per command: exec always here; parse/write shared with io-threads */
  function perCmdUs(op: 'read' | 'write') {
    const mix = MIX[n.str('mix', 'get-set')] ?? MIX['get-set'];
    const io = n.num('ioUs', 6) * (0.2 + 0.8 / Math.max(1, n.num('pipeline', 1)));
    return n.num('execUs', 1.5) * mix[op] + io / Math.max(1, Math.round(n.num('ioThreads', 1)));
  }

  /** Block the event loop: everything queued behind waits. */
  function block(ms: number, why: string) {
    blockedMs = Math.max(blockedMs, ms);
    n.log('info', `${n.name} event loop blocked ${Math.round(ms)}ms: ${why}`);
    n.process(1, ms, () => {});
  }

  function bgsave(reason: string) {
    if (snapshotting()) return;
    const gb = n.num('datasetGb', 8);
    const forkMs = gb * n.num('forkMsPerGb', 10);
    block(forkMs, `fork() copies page tables of ${gb} GB (${reason})`);
    snapshotStart = n.now + forkMs;
    snapshotUntil = snapshotStart + ((gb * 1024) / n.num('snapshotMBps', 2000)) * 1000;
    cowMb = 0;
    n.timer(snapshotUntil - n.now, () => {
      n.log('info', `${n.name} BGSAVE done; child exits, ${Math.round(cowMb)} MB of copied pages freed`);
      sinceSnapshot = 0;
      cowMb = 0;
    });
  }

  /** COW: a write to a page the child hasn't… the parent copies it (4 KB, or 2 MB with THP). */
  function cowCostUs(w: number) {
    if (!snapshotting() || n.now < snapshotStart) return 0;
    const left = 1 - (n.now - snapshotStart) / (snapshotUntil - snapshotStart);
    const pageKb = n.bool('hugePages', false) ? 2048 : 4;
    const uncopied = Math.max(0, 1 - cowMb / datasetMb());
    const copies = w * uncopied * Math.max(0.2, left);
    cowMb = Math.min(datasetMb(), cowMb + (copies * pageKb) / 1024);
    return (copies * (n.bool('hugePages', false) ? 250 : 2)) / Math.max(1, w);
  }

  function lostOnCrash(): number {
    if (n.bool('appendonly', false)) {
      const pol = n.str('appendfsync', 'everysec');
      return pol === 'always' ? 0 : unsynced;
    }
    return n.num('saveEverySec', 0) > 0 ? sinceSnapshot : 0;
  }

  function exec(req: Req) {
    const m = req.msg;
    const op = m.op ?? 'read';
    if (op === 'write' && role() !== 'primary') return req.reply({ ok: false, err: '5xx', data: 'READONLY' });
    let us = perCmdUs(op);
    const always = op === 'write' && n.bool('appendonly', false) && n.str('appendfsync', 'everysec') === 'always';
    if (op === 'write') us += cowCostUs(m.weight);
    n.process(m.weight, (us / 1000) * n.mods.slowX, ok => {
      if (!ok) return req.reply({ ok: false, err: '503' });
      opsW += m.weight;
      if (op === 'write') {
        offset += m.weight;
        unsynced += m.weight;
        sinceSnapshot += m.weight;
        if (n.num('saveEverySec', 0) > 0 && sinceSnapshot > 0 && n.now - snapshotUntil > n.num('saveEverySec', 0) * 1000) bgsave('save policy');
      }
      const reply = () => req.reply({ ok: true, value: m.value, version: offset });
      if (always) groupFsync(reply);
      else reply();
    });
  }

  /** appendfsync always: the loop fsyncs before replying; writes run meanwhile join the next fsync */
  let fsyncGroup: (() => void)[] = [];
  let fsyncQueued = false;
  function groupFsync(reply: () => void) {
    fsyncGroup.push(reply);
    if (fsyncQueued) return;
    fsyncQueued = true;
    n.process(1, n.num('fsyncMs', 1) * diskX, () => {
      fsyncQueued = false;
      const g = fsyncGroup;
      fsyncGroup = [];
      unsynced = 0;
      for (const f of g) f();
    });
  }

  return {
    handles: k => k.startsWith('redis.'),
    onStart() {
      n.cfg.instances = 1;
      n.cfg.slots = 1;
      n.cfg.queueLimit ??= 1_000_000;
      n.series.setCapacity(1);
      unsynced = 0;
      const other = started ? peers().find(isPrimary) : undefined;
      started = true;
      if (roleNow === 'primary' && other) {
        roleNow = 'replica';
        n.log('protocol', `${n.name} back; ${other.name} is primary now → rejoins as its replica (full resync)`);
      }
      // AOF fsync policy: everysec = background fsync each second; no = OS flushes ~30s
      n.every(1000, () => {
        const pol = n.str('appendfsync', 'everysec');
        if (!n.bool('appendonly', false)) return;
        if (pol === 'everysec' || (pol === 'no' && n.now - lastFsync >= 30000)) {
          const took = n.num('fsyncMs', 1) * diskX;
          n.timer(took, () => {
            unsynced = 0;
            lastFsync = n.now;
          });
          // fsync stuck > 2s: Redis delays the write(2) of the AOF buffer → main thread stalls
          if (took > 2000) block(Math.min(took - 2000, 1000), 'AOF fsync taking too long (disk busy)');
        }
        if (pol === 'always') unsynced = 0;
      });
      // async replication stream
      n.every(n.num('replLagMs', 100), () => {
        if (role() !== 'primary') return;
        hist.push([n.now, offset]);
        while (hist.length > 1 && hist[1][0] <= n.now - replDelayMs) hist.shift();
        const sent = replDelayMs ? hist[0][1] : offset;
        for (const r of peers()) if (r.up) n.send(r.id, { kind: 'redis.REPLCONF', data: { offset: sent } });
      });
      // Sentinel: replica promotes itself when the primary is gone for failoverMs
      n.every(500, () => {
        if (role() === 'primary' || !n.bool('autoFailover', true)) return;
        if (peers().some(isPrimary)) return void (primaryDown = 0);
        const prim = peers().find(x => !x.up && x.str('role', 'primary') === 'primary');
        primaryDown ||= n.now;
        if (n.now - primaryDown < n.num('failoverMs', 3000)) return;
        const best = [...peers(), n].filter(x => x.up).sort((a, b) => ((b.logic as any).offset?.() ?? 0) - ((a.logic as any).offset?.() ?? 0))[0];
        if (best !== n) return;
        const primOff = (prim?.logic as any)?.offset?.() ?? offset;
        const lost = primOff - offset;
        roleNow = 'primary';
        primaryDown = 0;
        n.log('protocol', `Sentinel: primary down → ${n.name} promoted` + (lost > 0 ? ` · ${Math.round(lost)} acknowledged writes never replicated (lost)` : ''));
        if (lost > 0) n.anomaly('lost-write', lost);
      });
      n.every(1000, () => {
        n.gauge('opsPerSec', opsW);
        n.gauge('loopBlockedMs', blockedMs);
        n.gauge('cowMb', Math.round(cowMb));
        n.gauge('memMb', Math.round(datasetMb() + cowMb));
        n.gauge('replOffset', offset);
        n.gauge('unsyncedWrites', lostOnCrash());
        n.gauge('clients', n.num('clients', 1000));
        n.memMb = datasetMb() + cowMb;
        const host = n.num('hostRamGb', 0) * 1024;
        if (host > 0 && n.memMb > host) {
          n.log('chaos', `${n.name} OOM-killed: dataset + COW copies (${Math.round(n.memMb)} MB) > host RAM`);
          n.kill();
          n.world.kernel.after(3000, () => n.restart());
        }
        opsW = 0;
        blockedMs = 0;
      });
      if (n.num('saveEverySec', 0) > 0) sinceSnapshot = 0;
    },
    onRequest(req: Req) {
      if (req.msg.kind === 'req') return exec(req);
      req.reply({ ok: true });
    },
    onMessage(msg: Msg) {
      if (msg.kind === 'redis.REPLCONF' && role() !== 'primary') {
        offset = Math.max(offset, msg.data?.offset ?? 0);
      }
    },
    onKill() {
      const lost = lostOnCrash();
      const hasReplica = peers().some(x => x.up);
      if (role() === 'primary' && !hasReplica && lost > 0) {
        n.anomaly('lost-write', lost);
        n.log('info', `${n.name} crashed: ${Math.round(lost)} writes not yet on disk are lost (${n.bool('appendonly', false) ? 'appendfsync ' + n.str('appendfsync', 'everysec') : 'last RDB snapshot'})`);
      }
      snapshotUntil = 0;
      cowMb = 0;
      fsyncGroup = [];
      fsyncQueued = false;
    },
    onChaos(kind, p, heal) {
      if (kind === 'slow-command' || kind === 'keys-scan') {
        if (heal) {
          slowCmd = undefined;
          return true;
        }
        const ms = Number(p.ms ?? (n.num('keys', 10_000_000) * 0.1) / 1000);
        slowCmd = { every: Number(p.everySec ?? 5) * 1000, ms, label: String(p.command ?? 'KEYS *') };
        const me = slowCmd;
        const fire = () => {
          if (slowCmd !== me) return;
          block(me.ms, `${me.label} walks ${(n.num('keys', 10_000_000) / 1e6).toFixed(0)}M keys — every client waits`);
          n.timer(me.every, fire);
        };
        fire();
        return true;
      }
      if (kind === 'bgsave') {
        if (!heal) bgsave('BGSAVE');
        return true;
      }
      if (kind === 'slow-disk') {
        const x = Number(p.x ?? 50);
        diskX = heal ? 1 : x;
        if (!heal) n.log('chaos', `${n.name} disk fsync ×${x} slower`);
        return true;
      }
      if (kind === 'replica-lag') {
        replDelayMs = heal ? 0 : Number(p.ms ?? 5000);
        if (!heal) n.log('chaos', `${n.name} replication stream ${replDelayMs}ms behind (slow link / replica busy)`);
        return true;
      }
      if (kind === 'kill-leader') {
        if (role() !== 'primary') return false;
        if (!heal) n.kill();
        else n.restart();
        return true;
      }
      return false;
    },
    view() {
      const badges: Badge[] = [];
      if (role() === 'primary') badges.push({ text: peers().length ? '👑 primary' : '1 thread', tone: 'accent' });
      else {
        const prim = peers().find(isPrimary);
        const lag = prim ? Math.max(0, (prim.logic as any).offset() - offset) : 0;
        badges.push({ text: `R lag ${Math.round(lag)}`, tone: 'muted' });
      }
      if (snapshotting()) badges.push({ text: `BGSAVE COW ${Math.round(cowMb)}MB`, tone: 'warn' });
      if (slowCmd) badges.push({ text: slowCmd.label, tone: 'fail' });
      return { badges };
    },
    // introspection for peers (Sentinel)
    ...({ offset: () => offset, isPrimary: () => role() === 'primary' } as object),
  };
}

register('redis-server', redisServer);
