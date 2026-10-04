import * as fs from 'fs';
import * as path from 'path';
import { createRun } from '../src';
import type { Catalog, SystemDoc } from '../src/types';

const dist = path.join(__dirname, '../../content/dist');
const catalog: Catalog = JSON.parse(fs.readFileSync(path.join(dist, 'catalog.json'), 'utf8'));
const templates: Record<string, SystemDoc> = JSON.parse(fs.readFileSync(path.join(dist, 'templates.json'), 'utf8'));
const doc = templates['lesson-cpu-cache'];
const hit = (r: ReturnType<typeof createRun>, id: string) => r.snapshot().nodes[id].gauges.hitRatio ?? 0;
const until = (r: ReturnType<typeof createRun>, ms: number) => {
  while (r.now < ms) r.step(Math.min(ms, r.now + 1000), 1e9);
};

test('sequential loads hit L1 7 of 8 times', () => {
  const r = createRun(doc, { catalog, seed: 1 });
  until(r, 20_000);
  expect(hit(r, 'l1')).toBeGreaterThanOrEqual(80);
});

test('random and strided loads miss L1', () => {
  for (const ev of [{ kind: 'access-random' }, { kind: 'access-stride', params: { stride: 8 } }]) {
    const r = createRun(doc, { catalog, seed: 1 });
    until(r, 5_000);
    r.fire({ ...ev, target: 'core' } as any);
    until(r, 20_000);
    expect(hit(r, 'l1')).toBeLessThanOrEqual(30);
  }
});

test('a traced load carries its instruction down to RAM and the line back up', () => {
  const r = createRun({ ...doc, scenario: { ...doc.scenario!, sources: [] } }, { catalog, seed: 1 });
  const id = r.sendOne('core', 'read')!;
  until(r, 2_000);
  const fl = r.world.traceFlights.get(id) ?? [];
  const hops = fl.map((f) => `${f.from}>${f.to}`);
  expect(hops).toEqual(expect.arrayContaining(['core>l1', 'l1>l2', 'l2>l3', 'l3>ram']));
  const down = fl.find((f) => f.to === 'ram')!;
  expect(down.msg?.data?.asm).toMatch(/add rax/);
  expect(r.trace(id)!.ok).toBe(true);
});
