// Object design: LRU cache, min stack, O(1) randomized set, parking lot.
import type { Tone } from '../algo/frames';
import { D, patternDemo, type GEdge, type GNode, type Step } from './lib';

type Op = [kind: 'get' | 'put', key: number, val?: number];

export function lruRun(cap: number, ops: Op[]) {
  const order: number[] = []; // most recent first
  const map = new Map<number, number>();
  const steps: Step[] = [];
  const results: (number | null)[] = [];
  const view = (hl: Record<number, Tone> = {}): { nodes: GNode[]; edges: GEdge[] } => {
    const nodes: GNode[] = [{ id: 'head', x: 80, y: 450, label: 'head', tone: 'muted' }];
    const w = Math.min(180, Math.floor(760 / Math.max(1, order.length + 1)));
    order.forEach((k, i) => nodes.push({ id: `k${k}`, x: 80 + (i + 1) * w, y: 450, label: `${k}:${map.get(k)}`, tone: hl[k] }));
    nodes.push({ id: 'tail', x: 80 + (order.length + 1) * w, y: 450, label: 'tail', tone: 'muted' });
    const edges: GEdge[] = [];
    for (let i = 0; i + 1 < nodes.length; i++) edges.push({ a: nodes[i].id, b: nodes[i + 1].id });
    return { nodes, edges };
  };
  const mapList = () => [...map.keys()].sort((a, b) => a - b).map((k) => `${k}→node`);
  steps.push({ note: `Capacity ${cap}. A hash map finds nodes in O(1); a doubly linked list keeps recency order, most recent next to head.`, graph: view(), lists: [{ label: 'map', items: [] }] });
  for (const [kind, key, val] of ops) {
    if (kind === 'get') {
      if (!map.has(key)) {
        results.push(null);
        steps.push({ note: `get(${key}): not in the map, return -1.`, graph: view(), lists: [{ label: 'map', items: mapList() }], rows: [['get', -1, 'fail']] });
        continue;
      }
      order.splice(order.indexOf(key), 1);
      order.unshift(key);
      results.push(map.get(key)!);
      steps.push({ note: `get(${key}) = ${map.get(key)}: unlink the node and move it to the front.`, graph: view({ [key]: 'ok' }), lists: [{ label: 'map', items: mapList() }], rows: [['get', map.get(key)!, 'ok']] });
    } else {
      let evicted: number | undefined;
      if (map.has(key)) order.splice(order.indexOf(key), 1);
      else if (map.size === cap) {
        evicted = order.pop()!;
        map.delete(evicted);
      }
      map.set(key, val!);
      order.unshift(key);
      steps.push({ note: `put(${key}, ${val})${evicted !== undefined ? `: full, so evict the least recent (${evicted}) from the tail` : ''}; the new node goes to the front.`, graph: view({ [key]: 'current' }), lists: [{ label: 'map', items: mapList() }], rows: evicted !== undefined ? [['evicted', evicted, 'warn']] : [] });
    }
  }
  return { results, order, steps };
}

export function minStackRun(ops: (['push', number] | ['pop'] | ['min'])[]) {
  const st: number[] = [];
  const mins: number[] = [];
  const steps: Step[] = [];
  const out: number[] = [];
  for (const op of ops) {
    if (op[0] === 'push') {
      st.push(op[1]);
      mins.push(Math.min(op[1], mins.length ? mins[mins.length - 1] : Infinity));
      steps.push({ note: `push(${op[1]}): also push the min so far, ${mins[mins.length - 1]}.`, lists: [{ label: 'stack', items: [...st] }, { label: 'min stack', items: [...mins], tones: { [mins.length - 1]: 'current' } }] });
    } else if (op[0] === 'pop') {
      const v = st.pop();
      mins.pop();
      steps.push({ note: `pop() removes ${v} and its min entry together.`, lists: [{ label: 'stack', items: [...st] }, { label: 'min stack', items: [...mins] }] });
    } else {
      out.push(mins[mins.length - 1]);
      steps.push({ note: `getMin() = ${mins[mins.length - 1]}, the top of the min stack: O(1).`, lists: [{ label: 'stack', items: [...st] }, { label: 'min stack', items: [...mins], tones: { [mins.length - 1]: 'ok' } }], rows: [['min', mins[mins.length - 1], 'ok']] });
    }
  }
  return { out, steps };
}

export function randomizedSet(ops: (['insert', number] | ['remove', number])[]) {
  const arr: number[] = [];
  const idx = new Map<number, number>();
  const steps: Step[] = [];
  const mapList = () => [...idx].map(([v, i]) => `${v}→${i}`);
  for (const [kind, v] of ops) {
    if (kind === 'insert') {
      if (idx.has(v)) {
        steps.push({ note: `insert(${v}): already present, return false.`, arr: [...arr], lists: [{ label: 'value→idx', items: mapList() }] });
        continue;
      }
      idx.set(v, arr.length);
      arr.push(v);
      steps.push({ note: `insert(${v}): append at index ${arr.length - 1} and record it in the map.`, arr: [...arr], tones: { [arr.length - 1]: 'ok' }, lists: [{ label: 'value→idx', items: mapList() }] });
    } else {
      const i = idx.get(v);
      if (i === undefined) continue;
      const last = arr[arr.length - 1];
      steps.push({ note: `remove(${v}) at ${i}: copy the last value (${last}) into its slot so the pop is O(1).`, arr: [...arr], tones: { [i]: 'fail', [arr.length - 1]: 'warn' }, lists: [{ label: 'value→idx', items: mapList() }] });
      arr[i] = last;
      idx.set(last, i);
      arr.pop();
      idx.delete(v);
      steps.push({ note: `Pop the tail and update ${last}’s index; getRandom is just a random index into the array.`, arr: [...arr], tones: i < arr.length ? { [i]: 'ok' } : {}, lists: [{ label: 'value→idx', items: mapList() }] });
    }
  }
  return { arr, steps };
}

const PARK: GNode[] = [
  { id: 'lot', x: 500, y: 250, label: 'Lot' },
  { id: 'lvl', x: 250, y: 420, label: 'Level' },
  { id: 'spot', x: 250, y: 600, label: 'Spot' },
  { id: 'veh', x: 750, y: 420, label: 'Vehicle' },
  { id: 'car', x: 650, y: 600, label: 'Car' },
  { id: 'bike', x: 850, y: 600, label: 'Bike' },
  { id: 'tix', x: 500, y: 760, label: 'Ticket' },
];
const PARK_E: GEdge[] = [
  { a: 'lot', b: 'lvl', label: '1..n' },
  { a: 'lvl', b: 'spot', label: '1..n' },
  { a: 'veh', b: 'car', dir: true },
  { a: 'veh', b: 'bike', dir: true },
  { a: 'spot', b: 'tix' },
  { a: 'veh', b: 'tix' },
];
function parking(): Step[] {
  const g = (hl: Record<string, Tone>, eh: Record<number, Tone> = {}) => ({ nodes: PARK.map((n) => ({ ...n, tone: hl[n.id] })), edges: PARK_E.map((e, i) => ({ ...e, tone: eh[i] })) });
  return [
    { note: 'Start from nouns in the requirements: a lot has levels, levels have spots, vehicles park and get tickets.', graph: g({}) },
    { note: 'Composition: Lot owns Levels, a Level owns Spots. Each class hides its own data.', graph: g({ lot: 'current', lvl: 'current', spot: 'current' }, { 0: 'accent', 1: 'accent' }) },
    { note: 'Inheritance only where behaviour differs: Car and Bike are Vehicles with a size that spots check.', graph: g({ veh: 'current', car: 'read', bike: 'read' }, { 2: 'accent', 3: 'accent' }) },
    { note: 'park(vehicle): Lot asks each Level for a free Spot that fits, then issues a Ticket linking Spot and Vehicle.', graph: g({ lot: 'ok', lvl: 'ok', spot: 'ok', tix: 'ok' }, { 0: 'ok', 1: 'ok', 4: 'ok', 5: 'ok' }) },
    { note: 'leave(ticket): the Ticket finds its Spot in O(1) and frees it. Interviews grade clear responsibilities, not class count.', graph: g({ tix: 'current', spot: 'ok' }, { 4: 'ok' }) },
  ];
}

patternDemo('algo-design', 'lc-design', 'Object design', 'Compose data structures behind a small API with O(1) operations, and model real-world objects with clear responsibilities.', [
  { id: 'lru', label: 'LC 146 LRU cache', problem: 'LC 146 · LRU Cache (capacity 2)', input: 'put 1, put 2, get 1, put 3, get 2, put 4, get 1, get 3', detail: D('Hash map + doubly linked list', 'OrderedDict does exactly this in Python: move_to_end on access, popitem(last=False) to evict.', 'from collections import OrderedDict\nclass LRU:\n    def __init__(self, cap):\n        self.cap, self.d = cap, OrderedDict()\n    def get(self, k):\n        if k not in self.d: return -1\n        self.d.move_to_end(k)\n        return self.d[k]\n    def put(self, k, v):\n        self.d[k] = v\n        self.d.move_to_end(k)\n        if len(self.d) > self.cap:\n            self.d.popitem(last=False)'), steps: () => lruRun(2, [['put', 1, 1], ['put', 2, 2], ['get', 1], ['put', 3, 3], ['get', 2], ['put', 4, 4], ['get', 1], ['get', 3]]).steps },
  { id: 'minstack', label: 'LC 155 Min stack', problem: 'LC 155 · Min Stack', input: 'push 5, push 3, push 7, min, push 2, min, pop, min', detail: D('Paired stack of minima', 'Each entry remembers the minimum at the time it was pushed.', 'class MinStack:\n    def __init__(self):\n        self.st = []   # (value, min so far)\n    def push(self, x):\n        m = min(x, self.st[-1][1]) if self.st else x\n        self.st.append((x, m))\n    def pop(self):\n        self.st.pop()\n    def getMin(self):\n        return self.st[-1][1]'), steps: () => minStackRun([['push', 5], ['push', 3], ['push', 7], ['min'], ['push', 2], ['min'], ['pop'], ['min']]).steps },
  { id: 'randset', label: 'LC 380 O(1) set', problem: 'LC 380 · Insert Delete GetRandom O(1)', input: 'insert 10, 20, 30, 40 · remove 20 · insert 50', detail: D('Array + index map', 'Removal swaps with the last element so the array stays dense for random picks.', 'def remove(self, v):\n    i = self.idx.pop(v)\n    last = self.arr.pop()\n    if i < len(self.arr):\n        self.arr[i] = last\n        self.idx[last] = i\ndef getRandom(self):\n    return random.choice(self.arr)'), steps: () => randomizedSet([['insert', 10], ['insert', 20], ['insert', 30], ['insert', 40], ['remove', 20], ['insert', 50]]).steps },
  { id: 'parking', label: 'Parking lot', problem: 'OOD · Parking Lot', input: 'levels, spots, vehicles, tickets', detail: D('Object-oriented design', 'Classes from nouns, methods from verbs; composition for has-a, inheritance only for is-a with different behaviour.', 'class Spot:\n    def __init__(self, size): self.size, self.car = size, None\n    def fits(self, v): return not self.car and v.size <= self.size\nclass Level:\n    def __init__(self, spots): self.spots = spots\n    def park(self, v):\n        for s in self.spots:\n            if s.fits(v):\n                s.car = v\n                return Ticket(s, v)'), steps: parking },
]);
