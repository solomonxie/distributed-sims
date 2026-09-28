import * as fs from 'fs';
import { createRun } from '../src';
import '../src/behaviors/tech-k8s';
import '../src/behaviors/tech-postgres';
import '../src/behaviors/tech-zk';

const yaml = require('js-yaml');
const ROOT = __dirname + '/../../content/';
const catalog: any = { groups: [], types: [], skins: [], containers: [] };
for (const f of fs.readdirSync(ROOT + 'catalog')) {
  const d: any = yaml.load(fs.readFileSync(ROOT + 'catalog/' + f, 'utf8'));
  catalog.groups.push(d.group);
  for (const t of d.types ?? []) catalog.types.push({ ...t, group: d.group.id });
  catalog.skins.push(...(d.skins ?? []));
}
const tpl = (slug: string) => JSON.parse(fs.readFileSync(`${ROOT}templates/${slug}.json`, 'utf8'));
const run = (slug: string, seed = 1) => createRun(tpl(slug), { catalog, seed });
const g = (r: any, id: string, k: string): number => r.snapshot().nodes[id].gauges[k] ?? 0;
const saw = (r: any, s: string) => r.events().some((e: any) => e.text.toLowerCase().includes(s.toLowerCase()));
const avail = (r: any) => r.snapshot().system.availability;

describe('kubernetes', () => {
  test('pods are created, scheduled, started and become endpoints; every change is an etcd write', () => {
    const r = run('tech-k8s-anatomy');
    r.step(8000, 1e9);
    expect(g(r, 'svc', 'endpoints')).toBe(3);
    expect(avail(r)).toBeGreaterThan(99);
    expect(g(r, 'api', 'resourceVersion')).toBeGreaterThanOrEqual(10);
    expect(r.protocol().some((p: any) => p.kind === 'k8s.bind')).toBe(true);
    expect(r.protocol().some((p: any) => p.kind === 'etcd.put')).toBe(true);
  });

  test('etcd quorum loss: API writes fail, running pods keep serving', () => {
    const r = run('tech-k8s-anatomy');
    r.step(8000, 1e9);
    r.fire({ kind: 'kill', target: 'etcd-1' });
    r.fire({ kind: 'kill', target: 'etcd-2' });
    r.fire({ kind: 'kill', target: 'etcd-3' });
    r.fire({ kind: 'config-push', target: 'ctrl' });
    r.step(14_000, 1e9);
    expect(saw(r, 'etcd write failed')).toBe(true);
    expect(g(r, 'ctrl', 'revision')).toBe(1);
    expect(avail(r)).toBeGreaterThan(99);
  });

  test('rolling update keeps capacity; a bad revision stalls at maxUnavailable', () => {
    const r = run('tech-k8s-rolling');
    r.step(6000, 1e9);
    r.fire({ kind: 'config-push', target: 'ctrl' });
    let minReady = 99;
    for (let t = 7; t <= 25; t++) {
      r.step(t * 1000, 1e9);
      minReady = Math.min(minReady, g(r, 'svc', 'endpoints'));
    }
    expect(saw(r, 'rollout to revision 2 complete')).toBe(true);
    expect(minReady).toBeGreaterThanOrEqual(3);
    r.fire({ kind: 'bad-deploy', target: 'ctrl' });
    r.step(50_000, 1e9);
    expect(saw(r, 'ProgressDeadlineExceeded')).toBe(true);
    expect(g(r, 'svc', 'endpoints')).toBe(3);
    expect(avail(r)).toBeGreaterThan(99);
  });

  test('maxUnavailable 100% + failing readiness = no endpoints; rollback restores', () => {
    const r = run('tech-k8s-no-endpoints');
    r.step(6000, 1e9);
    r.fire({ kind: 'bad-deploy', target: 'ctrl' });
    r.step(12_000, 1e9);
    expect(g(r, 'svc', 'endpoints')).toBe(0);
    expect(avail(r)).toBeLessThan(5);
    r.fire({ kind: 'config-push', target: 'ctrl' });
    r.step(20_000, 1e9);
    expect(g(r, 'svc', 'endpoints')).toBe(3);
  });

  test('crash loop backs off exponentially on the same node', () => {
    const r = run('tech-k8s-crashloop');
    r.step(6000, 1e9);
    r.fire({ kind: 'crash-loop', target: 'node-1' });
    r.step(25_000, 1e9);
    expect(saw(r, 'back-off 8s')).toBe(true);
    expect(g(r, 'node-1', 'restarts')).toBeGreaterThanOrEqual(4);
    expect(g(r, 'svc', 'endpoints')).toBe(2);
  });

  test('node NotReady → endpoints drop → eviction → rescheduled', () => {
    const r = run('tech-k8s-node-down');
    r.step(8000, 1e9);
    r.fire({ kind: 'kill', target: 'node-2' });
    r.step(12_000, 1e9);
    expect(avail(r)).toBeLessThan(90);
    r.step(40_000, 1e9);
    expect(saw(r, 'NotReady (no heartbeat')).toBe(true);
    expect(saw(r, 'Evicting')).toBe(true);
    expect(g(r, 'svc', 'endpoints')).toBe(3);
    expect(avail(r)).toBeGreaterThan(99);
  });

  test('HPA scales on CPU; API server down freezes changes but pods keep serving', () => {
    const r = run('tech-k8s-hpa');
    r.step(8000, 1e9);
    r.fire({ kind: 'traffic', action: 'burst', params: { x: 2.5 }, durationSec: 90 });
    r.step(30_000, 1e9);
    expect(g(r, 'ctrl', 'replicas')).toBeGreaterThanOrEqual(4);
    r.fire({ kind: 'kill', target: 'api', durationSec: 20 });
    r.step(45_000, 1e9);
    expect(saw(r, 'API server unreachable')).toBe(true);
    expect(avail(r)).toBeGreaterThan(99);
  });
});

describe('postgres', () => {
  test('group commit: more commits per fsync under load; synchronous_commit=off loses commits on crash', () => {
    const r = run('tech-pg-wal');
    r.step(6000, 1e9);
    const calm = g(r, 'pg-on', 'commitsPerFsync');
    r.fire({ kind: 'traffic', action: 'burst', params: { x: 4 }, durationSec: 20 });
    r.step(14_000, 1e9);
    expect(g(r, 'pg-on', 'commitsPerFsync')).toBeGreaterThan(calm * 2);
    r.fire({ kind: 'kill', target: 'pg-on' });
    expect(r.snapshot().anomalies['lost-write'] ?? 0).toBe(0);
    r.fire({ kind: 'kill', target: 'pg-off' });
    expect(r.snapshot().anomalies['lost-write']).toBeGreaterThan(0);
  });

  test('a long transaction blocks vacuum: bloat grows and reads slow down', () => {
    const r = run('tech-pg-vacuum');
    r.step(10_000, 1e9);
    expect(g(r, 'pg', 'bloatPct')).toBeLessThan(40);
    const hit0 = g(r, 'pg', 'hitRatio');
    r.fire({ kind: 'long-txn', target: 'pg' });
    r.step(50_000, 1e9);
    expect(saw(r, 'still visible to an open transaction')).toBe(true);
    expect(g(r, 'pg', 'bloatPct')).toBeGreaterThan(100);
    expect(g(r, 'pg', 'hitRatio')).toBeLessThan(hit0 - 20);
  });

  test('connection storm hits max_connections; PgBouncer side stays healthy', () => {
    const r = run('tech-pg-conn-storm');
    r.step(5000, 1e9);
    r.fire({ kind: 'traffic', action: 'burst', params: { x: 5 }, durationSec: 40 });
    r.step(20_000, 1e9);
    const s = r.snapshot();
    expect(saw(r, 'too many clients')).toBe(true);
    expect(s.nodes['app-direct'].errRate).toBeGreaterThan(0.1);
    expect(s.nodes['app-pooled'].errRate).toBeLessThan(0.01);
    expect(g(r, 'bouncer', 'serverConns')).toBeLessThanOrEqual(20);
  });

  test('checkpoint storm: forced checkpoints, IO saturates', () => {
    const r = run('tech-pg-checkpoint');
    r.step(6000, 1e9);
    expect(g(r, 'pg', 'ioUtil')).toBeLessThan(20);
    r.fire({ kind: 'traffic', action: 'burst', params: { x: 4 }, durationSec: 40 });
    r.step(20_000, 1e9);
    expect(saw(r, 'checkpoints are occurring too frequently')).toBe(true);
    expect(g(r, 'pg', 'checkpointsReq')).toBeGreaterThan(2);
    expect(g(r, 'pg', 'ioUtil')).toBeGreaterThan(40);
  });

  test('standby lags under heavy writes, serves stale reads, then catches up', () => {
    const r = run('tech-pg-replica');
    r.step(6000, 1e9);
    r.fire({ kind: 'traffic', action: 'burst', params: { x: 3 }, durationSec: 20 });
    r.step(24_000, 1e9);
    expect(g(r, 'standby', 'lagMs')).toBeGreaterThan(2000);
    expect(r.snapshot().anomalies['stale-read']).toBeGreaterThan(100);
    r.step(42_000, 1e9);
    expect(g(r, 'standby', 'lagMs')).toBeLessThan(300);
    expect(r.protocol().some((p: any) => p.kind === 'pg.wal')).toBe(true);
  });

  test('restart: crash recovery then a cold cache', () => {
    const r = run('tech-pg-anatomy');
    r.step(10_000, 1e9);
    r.fire({ kind: 'restart', target: 'pg', params: { downSec: 1 } });
    r.step(12_500, 1e9);
    expect(saw(r, 'crash recovery replays')).toBe(true);
    expect(g(r, 'pg', 'hitRatio')).toBeLessThan(99);
  });
});

describe('zookeeper / etcd', () => {
  test('election recipe: one leader, sequential znodes, zxids increase', () => {
    const r = run('tech-zk-anatomy');
    r.step(6000, 1e9);
    const leaders = ['app-1', 'app-2', 'app-3'].reduce((a, id) => a + g(r, id, 'leaders'), 0);
    expect(leaders).toBe(1);
    expect(g(r, 'zk-1', 'znodes')).toBe(3);
    expect(saw(r, 'zxid 0x1000000')).toBe(true);
    expect(r.snapshot().anomalyTotal).toBe(0);
  });

  test('ensemble leader loss keeps sessions; new epoch in zxid', () => {
    const r = run('tech-zk-anatomy');
    r.step(6000, 1e9);
    r.fire({ kind: 'kill-leader', target: 'zk-1' });
    r.step(12_000, 1e9);
    expect(g(r, 'app-1', 'leaders')).toBe(1);
    expect(saw(r, 'expired after')).toBe(false);
    r.fire({ kind: 'kill', target: 'app-3' });
    r.step(20_000, 1e9);
    expect(saw(r, 'zxid 0x2')).toBe(true);
  });

  test('GC pause longer than the session timeout → two leaders briefly', () => {
    const r = run('tech-zk-session');
    r.step(6000, 1e9);
    r.fire({ kind: 'gc-pause', target: 'app-a', params: { sec: 8 } });
    r.step(20_000, 1e9);
    expect(g(r, 'app-b', 'leaders')).toBe(1);
    expect(g(r, 'app-a', 'leaders')).toBe(0);
    expect(r.snapshot().anomalies['double-holder']).toBeGreaterThan(0);
    expect(saw(r, 'NOT the leader')).toBe(true);
  });

  test('herd: parent watch wakes everyone; predecessor watch wakes one', () => {
    const wake = (slug: string) => {
      const r = run(slug);
      r.step(6000, 1e9);
      r.fire({ kind: 'kill', target: 'leader-app' });
      r.step(14_000, 1e9);
      expect(g(r, 'workers', 'leaders')).toBe(1);
      return g(r, 'zk-1', 'lastWake');
    };
    expect(wake('tech-zk-herd')).toBeGreaterThanOrEqual(10);
    expect(wake('tech-zk-predecessor')).toBe(1);
  });

  test('quorum loss: writes fail, local reads keep working', () => {
    const r = run('tech-zk-quorum');
    r.step(5000, 1e9);
    r.fire({ kind: 'kill', target: 'zk-2' });
    r.step(10_000, 1e9);
    expect(avail(r)).toBeGreaterThan(99);
    r.fire({ kind: 'kill', target: 'zk-3' });
    r.step(25_000, 1e9);
    expect(avail(r)).toBeLessThan(95);
    expect(avail(r)).toBeGreaterThan(80);
  });
});

describe('composite skins', () => {
  test.each([
    ['kubernetes-internals', 'k8s-service', 1],
    ['postgres-internals', 'pgbouncer', 0.8],
    ['zookeeper-internals', 'zk-server', 0.9],
  ])('%s expands and serves traffic', (skin, type, readRatio) => {
    const doc: any = {
      schemaVersion: 1, id: 'c', name: 'c', containers: [],
      nodes: [
        { id: 'users', type: 'web-client', name: 'Users', pos: { x: 0, y: 0 } },
        { id: 'sys', type, skin, name: 'sys', pos: { x: 0, y: 100 } },
      ],
      edges: [{ id: 'e', from: 'users', to: 'sys' }],
      scenario: { sources: [{ id: 's', node: 'users', shape: { kind: 'constant', rps: 100 }, readRatio }], events: [] },
    };
    const r = createRun(doc, { catalog, seed: 1 });
    r.step(15_000, 1e9);
    expect(r.snapshot().nodes.sys).toBeDefined();
    expect(avail(r)).toBeGreaterThan(99);
  });
});
