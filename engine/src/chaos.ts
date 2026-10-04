import type { World } from './world';
import type { ChaosEvent, Id } from './types';
import { nodesIn } from './model';

/** Apply a chaos event; returns a heal function, or undefined if not applicable. */
export function applyChaos(w: World, ev: ChaosEvent): (() => void) | undefined {
  const p = (ev.params ?? {}) as Record<string, any>;
  const node = ev.target ? w.nodes.get(ev.target) : undefined;
  const name = (id?: Id) => (id ? w.nodeName(id) ?? w.containers.get(id)?.name ?? id : '?');
  const log = (text: string) => w.log('chaos', text, ev.target);

  // behaviour-specific first (kill-leader, hot-key on data, replica-lag, ...)
  if (node?.logic.onChaos?.(ev.kind, p, false)) {
    log(`${label(ev.kind)} · ${name(ev.target)}`);
    return () => {
      node.logic.onChaos?.(ev.kind, p, true);
      w.log('info', `Healed: ${label(ev.kind)} · ${name(ev.target)}`, ev.target);
    };
  }

  const healed = (text: string) => w.log('info', `Healed: ${text}`, ev.target);

  switch (ev.kind) {
    case 'kill': {
      if (!node) return;
      node.kill();
      log(`Killed ${node.name}`);
      return () => {
        node.restart();
        healed(`${node.name} restarted`);
      };
    }
    case 'restart': {
      if (!node) return;
      node.kill();
      log(`Restarting ${node.name}`);
      w.kernel.after((p.downSec ?? 5) * 1000, () => node.restart());
      return () => {};
    }
    case 'crash-loop': {
      if (!node) return;
      let active = true;
      const loop = () => {
        if (!active) return;
        node.kill();
        w.kernel.after(3000, () => {
          node.restart();
          w.kernel.after(4000, loop);
        });
      };
      loop();
      log(`${node.name} crash-looping`);
      return () => {
        active = false;
        node.restart();
        healed(`${node.name} stable`);
      };
    }
    case 'slow': {
      if (!node) return;
      const x = p.x ?? 10;
      node.mods.slowX *= x;
      log(`${node.name} slowed ×${x}`);
      return () => {
        node.mods.slowX /= x;
        healed(`${node.name} speed`);
      };
    }
    case 'cpu-hog': {
      if (!node) return;
      const x = p.x ?? 0.3;
      node.mods.capacityX *= x;
      node.mods.slowX *= 1.5;
      log(`${node.name} CPU hog`);
      return () => {
        node.mods.capacityX /= x;
        node.mods.slowX /= 1.5;
        node.drain();
        healed(`${node.name} CPU`);
      };
    }
    case 'gc-pause': {
      if (!node) return;
      const ms = (p.sec ?? 2) * 1000;
      node.mods.pausedUntil = w.now + ms;
      w.kernel.after(ms, () => node.drain());
      log(`${node.name} GC pause ${ms / 1000}s`);
      return () => {};
    }
    case 'memory-leak': {
      if (!node) return;
      node.mods.memLeakMbPerSec = p.mbPerSec ?? 100;
      log(`${node.name} leaking memory`);
      return () => {
        node.mods.memLeakMbPerSec = 0;
        node.memMb = 0;
        healed(`${node.name} memory`);
      };
    }
    case 'disk-full': {
      if (!node) return;
      node.mods.diskFull = true;
      log(`${node.name} disk full`);
      return () => {
        node.mods.diskFull = false;
        healed(`${node.name} disk`);
      };
    }
    case 'conn-exhaustion': {
      if (!node) return;
      const x = 0.1;
      node.mods.capacityX *= x;
      log(`${node.name} connection pool exhausted`);
      return () => {
        node.mods.capacityX /= x;
        node.drain();
        healed(`${node.name} connections`);
      };
    }
    case 'bad-deploy': {
      if (!node) return;
      const r = (p.errPct ?? 30) / 100;
      node.mods.errRate = r;
      log(`Bad deploy on ${node.name} (${Math.round(r * 100)}% errors)`);
      return () => {
        node.mods.errRate = 0;
        healed(`${node.name} rolled back`);
      };
    }
    case 'config-push': {
      if (!node) return;
      node.kill();
      w.kernel.after(4000, () => node.restart());
      log(`Config push restarts all ${node.name} instances at once`);
      return () => {};
    }
    case 'clock-skew': {
      if (!node) return;
      const ms = p.ms ?? 500;
      node.mods.clockOffsetMs += ms;
      log(`${node.name} clock skew ${ms > 0 ? '+' : ''}${ms}ms`);
      return () => {
        node.mods.clockOffsetMs -= ms;
        healed(`${node.name} clock`);
      };
    }
    case 'clock-jump': {
      if (!node) return;
      node.mods.clockOffsetMs += p.ms ?? 60000;
      log(`${node.name} clock jumped`);
      return () => {};
    }
    case 'dns-failure': {
      if (!node) return;
      node.mods.dnsFail = true;
      log(`DNS for ${node.name} failing`);
      return () => {
        node.mods.dnsFail = false;
        healed(`DNS ${node.name}`);
      };
    }
    case 'cert-expired': {
      if (!node) return;
      node.mods.certExpired = true;
      log(`TLS cert expired on ${node.name}`);
      return () => {
        node.mods.certExpired = false;
        healed(`cert ${node.name}`);
      };
    }
    case 'partition': {
      const a = sideOf(w, ev.target);
      const b = sideOf(w, ev.target2);
      if (!a.size || !b.size) return;
      const id = Math.floor(w.rng.next() * 1e9);
      w.partitions.push({ a, b, oneWay: !!p.oneWay, id });
      log(`Partition ${name(ev.target)} ⟂ ${name(ev.target2)}`);
      return () => {
        w.partitions = w.partitions.filter(x => x.id !== id);
        healed(`partition ${name(ev.target)} ⟂ ${name(ev.target2)}`);
      };
    }
    case 'latency':
    case 'jitter':
    case 'loss':
    case 'bandwidth': {
      const edges = edgesFor(w, ev.target);
      if (!edges.length) return;
      const v = ev.kind === 'latency' ? p.ms ?? 200 : ev.kind === 'jitter' ? p.ms ?? 100 : ev.kind === 'loss' ? (p.pct ?? 5) / 100 : p.ms ?? 50;
      for (const e of edges) {
        if (ev.kind === 'latency' || ev.kind === 'bandwidth') e.extraLatencyMs += v;
        else if (ev.kind === 'jitter') e.jitterMs += v;
        else e.loss = Math.min(1, e.loss + v);
      }
      log(`${label(ev.kind)} on ${name(ev.target)}`);
      return () => {
        for (const e of edges) {
          if (ev.kind === 'latency' || ev.kind === 'bandwidth') e.extraLatencyMs -= v;
          else if (ev.kind === 'jitter') e.jitterMs -= v;
          else e.loss = Math.max(0, e.loss - v);
        }
        healed(`${label(ev.kind)} ${name(ev.target)}`);
      };
    }
    case 'az-down':
    case 'region-down':
    case 'cell-down': {
      const ids = ev.target && w.containers.has(ev.target) ? nodesIn(ev.target, w.doc.nodes, w.containers) : node ? [node.id] : [];
      if (!ids.length) return;
      for (const id of ids) w.nodes.get(id)!.kill();
      log(`${name(ev.target)} down (${ids.length} components)`);
      return () => {
        for (const id of ids) w.nodes.get(id)!.restart();
        healed(`${name(ev.target)} back`);
      };
    }
    case 'external-outage': {
      if (!node) return;
      node.kill();
      log(`${node.name} outage`);
      return () => {
        node.restart();
        healed(`${node.name}`);
      };
    }
    case 'heal-all':
      w.healAll();
      return undefined;
  }
  // data/protocol events on nodes whose behaviour doesn't know them: degrade gracefully
  if (node && ['hot-key', 'replica-lag', 'cache-flush', 'split-brain', 'lost-write', 'corrupt-write', 'rebalance', 'schema-lock', 'kill-leader', 'kill-coordinator', 'poison-message', 'drop-votes', 'key-rotation', 'credential-leak'].includes(ev.kind)) {
    log(`${label(ev.kind)} · ${name(ev.target)} (no effect on ${node.type})`);
    return () => {};
  }
  return undefined;
}

function sideOf(w: World, id?: Id): Set<Id> {
  if (!id) return new Set();
  if (w.nodes.has(id)) return new Set([id]);
  if (w.containers.has(id)) return new Set(nodesIn(id, w.doc.nodes, w.containers));
  return new Set();
}

function edgesFor(w: World, id?: Id) {
  if (!id) return [];
  const e = w.edges.get(id);
  if (e) return [e];
  return [...w.edges.values()].filter(x => x.from === id || x.to === id);
}

export function label(kind: string): string {
  const map: Record<string, string> = {
    kill: 'Kill',
    'access-random': 'Random access',
    'access-stride': 'Strided access',
    slow: 'Slow',
    'cpu-hog': 'CPU hog',
    'gc-pause': 'GC pause',
    'memory-leak': 'Memory leak',
    'disk-full': 'Disk full',
    'bad-deploy': 'Bad deploy',
    partition: 'Partition',
    latency: '+Latency',
    jitter: 'Jitter',
    loss: 'Packet loss',
    bandwidth: 'Bandwidth cap',
    'hot-key': 'Hot key',
    'replica-lag': 'Replica lag',
    'cache-flush': 'Cache flush',
    'split-brain': 'Split brain',
    'kill-leader': 'Kill leader',
    'kill-coordinator': 'Kill coordinator',
  };
  return map[kind] ?? kind.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
}
