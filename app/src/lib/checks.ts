import type { Run } from '@dsims/engine';

export interface Check {
  metric: string;
  target?: string;
  op: '>' | '<' | '>=' | '<=' | '=';
  value: number;
}

export function compare(v: number, op: Check['op'], x: number): boolean {
  switch (op) {
    case '>':
      return v > x;
    case '<':
      return v < x;
    case '>=':
      return v >= x;
    case '<=':
      return v <= x;
    default:
      return Math.abs(v - x) < 1e-9;
  }
}

/** Live value of a lesson check metric (see /content lesson schema). */
export function checkValue(run: Run, ch: Check): number | undefined {
  const snap = run.snapshot();
  const m = ch.metric;
  const node = ch.target ? snap.nodes[ch.target] : undefined;
  if (m === 'manual') return undefined;
  if (m === 'time') return run.now / 1000;
  if (m === 'availability') return node ? (1 - node.errRate) * 100 : snap.system.availability;
  if (m === 'p99') return node ? node.p99 : snap.system.p99;
  if (m === 'rps') return node ? node.rps : snap.system.rps;
  if (m === 'errRate') return (node ? node.errRate : snap.system.errRate) * 100;
  if (m === 'util') return node ? node.util * 100 : undefined;
  if (m === 'queue') return node?.queue;
  if (m === 'up') return node ? (node.up ? 1 : 0) : undefined;
  if (m === 'anomalies') return snap.anomalyTotal;
  if (m.startsWith('anomaly:')) return snap.anomalies[m.slice(8)] ?? 0;
  if (m === 'alerts') return snap.alertsFiring;
  if (m === 'chaosActive') return snap.chaos.length;
  if (m === 'costMonth') return snap.costMonth;
  if (m.startsWith('gauge:')) return node?.gauges[m.slice(6)] ?? 0;
  if (m.startsWith('badge:')) return node?.badges.some(b => b.text.includes(m.slice(6))) ? 1 : 0;
  if (m.startsWith('eventCount:')) return run.events().filter(e => e.kind === m.slice(11)).length;
  if (m.startsWith('eventMatch:')) {
    const q = m.slice(11).toLowerCase();
    return run.events().filter(e => e.text.toLowerCase().includes(q)).length;
  }
  return undefined;
}

export function checkPasses(run: Run, ch: Check): boolean {
  const v = checkValue(run, ch);
  return v !== undefined && compare(v, ch.op, ch.value);
}

export interface Score {
  metric: string;
  op: Check['op'];
  value: number;
  actual: number;
  pass: boolean;
}

/** Challenge scoring over the last 20s of the run. */
export function scoreRun(run: Run, pass: { metric: string; op: Check['op']; value: number }[]): Score[] {
  const pts = run.series('system').slice(-20);
  const mean = (f: (p: (typeof pts)[number]) => number) => (pts.length ? pts.reduce((a, p) => a + f(p), 0) / pts.length : 0);
  const snap = run.snapshot();
  return pass.map(p => {
    const actual =
      p.metric === 'p99'
        ? mean(x => x.p99)
        : p.metric === 'availability'
          ? mean(x => (1 - x.errRate) * 100)
          : p.metric === 'errRate'
            ? mean(x => x.errRate * 100)
            : p.metric === 'anomalies'
              ? snap.anomalyTotal
              : p.metric === 'costMonth'
                ? snap.costMonth
                : 0;
    return { metric: p.metric, op: p.op, value: p.value, actual, pass: compare(actual, p.op, p.value) };
  });
}

export function liveMetric(run: Run, metric: string): number {
  const pts = run.series('system').slice(-5);
  const snap = run.snapshot();
  if (metric === 'p99') return pts.length ? pts.reduce((a, p) => a + p.p99, 0) / pts.length : 0;
  if (metric === 'availability') return snap.system.availability;
  if (metric === 'errRate') return snap.system.errRate * 100;
  if (metric === 'anomalies') return snap.anomalyTotal;
  if (metric === 'costMonth') return snap.costMonth;
  return 0;
}
