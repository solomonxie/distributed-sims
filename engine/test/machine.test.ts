import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';
import { BELADY_REFS, missRate, pageWalk, replace, STANDARD_REFS, WALK_VA } from '../src/machine/lib/sims';
import { regValue, run, STACK_TOP } from '../src/machine/lib/x86';
import { layoutStruct, vectorGrowth } from '../src/machine/cpp';

const GROUPS = ['machine-cpu', 'machine-memory', 'machine-bus', 'machine-asm', 'machine-cpp'];
const machine = () => allDemos().filter((d) => GROUPS.includes(d.group));

function points(s: Shape): number[] {
  switch (s.t) {
    case 'rect':
      return [s.x, s.y, s.x + s.w, s.y + s.h];
    case 'line':
      return [s.x1, s.y1, s.x2, s.y2];
    case 'arc':
      return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
    case 'node':
      return s.r ? [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r] : [s.x, s.y];
    case 'edge':
      return [s.from, s.to].flatMap((p) => (typeof p === 'string' ? [] : [p.x, p.y]));
    default:
      return [s.x, s.y];
  }
}

test('every group has demos', () => {
  for (const g of GROUPS) expect(machine().filter((d) => d.group === g).length).toBeGreaterThanOrEqual(5);
});

describe.each(machine().flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
  const fs = frames(getDemo(slug)!, data);

  test('≥ 3 frames, ends done', () => {
    expect(fs.length).toBeGreaterThanOrEqual(3);
    expect(fs[fs.length - 1].done).toBe(true);
    expect(fs.slice(0, -1).some((f) => f.done)).toBe(false);
  });

  test('unique ids, coordinates in [0,1000], short notes', () => {
    for (const f of fs) {
      const ids = f.shapes.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of f.shapes) for (const v of points(s)) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1000);
      }
      expect(f.note.length).toBeGreaterThan(0);
      expect((f.note.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(2);
    }
  });
});

test('row-major miss rate < column-major', () => {
  const row = missRate('row');
  const col = missRate('col');
  expect(row).toBeCloseTo(1 / 16, 3);
  expect(col).toBeGreaterThan(0.9);
  expect(row).toBeLessThan(col);
});

test('LRU faults ≤ FIFO on the standard reference string', () => {
  const fifo = replace('fifo', STANDARD_REFS, 3).faults;
  const lru = replace('lru', STANDARD_REFS, 3).faults;
  expect(fifo).toBe(15);
  expect(lru).toBe(12);
  expect(lru).toBeLessThanOrEqual(fifo);
});

test('Belady preset: FIFO faults increase with more frames', () => {
  expect(replace('fifo', BELADY_REFS, 4).faults).toBeGreaterThan(replace('fifo', BELADY_REFS, 3).faults);
  const fs = frames(getDemo('mem-page-replacement')!, { policy: 'fifo', belady: true });
  const rows = fs[fs.length - 1].panel!.rows;
  const f3 = Number(rows.find((r) => r.label === 'faults (3 frames)')!.value);
  const f4 = Number(rows.find((r) => r.label === 'faults (4 frames)')!.value);
  expect(f4).toBeGreaterThan(f3);
});

test('page walk ends at frame 0x9C with offset 0xC41', () => {
  const w = pageWalk(WALK_VA);
  expect(w.frame).toBe(0x9c);
  expect(w.offset).toBe(0xc41);
  expect(w.pa).toBe(0x9cc41);
  expect(w.idx.slice(0, 3)).toEqual([0, 1, 505]);
  const fs = frames(getDemo('mem-paging')!, { tlb: 'miss' });
  const phys = fs[fs.length - 1].panel!.rows.find((r) => r.label === 'physical')!;
  expect(phys.value).toBe('0x9CC41');
});

describe('x86 interpreter', () => {
  const last = (src: string[], init = {}, mem: [number, number][] = [], entry?: string) => {
    const r = run(src, init, mem, entry);
    return r.steps[r.steps.length - 1].state;
  };

  test('INT_MAX + 1 sets OF and SF; 0xFFFFFFFF + 1 sets CF and ZF', () => {
    const a = last(['mov eax, 0x7FFFFFFF', 'add eax, 1']);
    expect(regValue(a, 'eax')).toBe(-2147483648);
    expect(a.flags).toMatchObject({ OF: true, SF: true, CF: false, ZF: false });
    const b = last(['mov ecx, -1', 'add ecx, 1']);
    expect(b.flags).toMatchObject({ CF: true, ZF: true, OF: false });
  });

  test('cmp 5, 9: SF and CF set; jl taken', () => {
    const r = run(['mov eax, 5', 'cmp eax, 9', 'jl .x', 'mov eax, 0', '.x:', 'inc eax']);
    expect(r.steps.find((s) => s.taken !== undefined)!.taken).toBe(true);
    expect(regValue(r.steps[r.steps.length - 1].state, 'eax')).toBe(6);
  });

  test('loop sums 1..4 and array sums with scaled index', () => {
    expect(regValue(last(['xor eax, eax', 'mov ecx, 1', '.l:', 'cmp ecx, edi', 'jg .d', 'add eax, ecx', 'inc ecx', 'jmp .l', '.d:', 'ret'], { edi: 4 }), 'eax')).toBe(10);
    const mem: [number, number][] = [3, 1, 4, 1, 5].map((v, i) => [0x1000 + 4 * i, v]);
    expect(regValue(last(['xor eax, eax', 'xor ecx, ecx', '.l:', 'add eax, DWORD PTR [rdi+rcx*4]', 'inc rcx', 'cmp rcx, rsi', 'jne .l', 'ret'], { rdi: 0x1000, rsi: 5 }, mem), 'eax')).toBe(14);
  });

  test('recursive fact(3) = 6 and the stack is balanced', () => {
    const src = ['main:', 'mov edi, 3', 'call fact', 'ret', 'fact:', 'push rbp', 'mov rbp, rsp', 'push rbx', 'mov ebx, edi', 'mov eax, 1', 'cmp edi, 1', 'jle .out', 'dec edi', 'call fact', 'imul eax, ebx', '.out:', 'pop rbx', 'pop rbp', 'ret'];
    const st = last(src, {}, [], 'main');
    expect(regValue(st, 'eax')).toBe(6);
    expect(st.regs.rsp).toBe(STACK_TOP);
  });

  test('asm-stack frames demo ends with fact(3) = 6', () => {
    const fs = frames(getDemo('asm-stack')!, { p: 'frames' });
    expect(fs[fs.length - 1].shapes.some((s) => s.t === 'rect' && s.id === 'r-eax' && s.label === '6')).toBe(true);
  });
});

test('struct layout: padding and reordering', () => {
  const t = (name: string, size: number) => ({ name, type: '', size, align: size });
  const bad = layoutStruct([t('a', 1), t('b', 8), t('c', 1), t('d', 4)]);
  expect(bad.fields.map((f) => f.offset)).toEqual([0, 8, 16, 20]);
  expect(bad).toMatchObject({ size: 24, align: 8, padding: 10 });
  expect(layoutStruct([t('b', 8), t('d', 4), t('a', 1), t('c', 1)])).toMatchObject({ size: 16, padding: 2, tail: 2 });
});

test('vector doubling: amortised < 2 moves per element; reserve avoids reallocation', () => {
  const g = vectorGrowth(9);
  expect(g.caps).toEqual([1, 2, 4, 8, 16]);
  expect(g).toMatchObject({ allocs: 5, moves: 15 });
  for (const n of [10, 100, 1000]) expect(vectorGrowth(n).moves).toBeLessThan(2 * n);
  expect(vectorGrowth(9, 9)).toMatchObject({ allocs: 1, moves: 0 });
});

test('algo lessons reference real demos and inputs', () => {
  const topics: { id: string; lessons: { id: string; algo?: string; steps: { input?: string }[] }[] }[] = require('../../content/dist/topics.json');
  for (const t of topics)
    for (const l of t.lessons) {
      if (!l.algo) continue;
      const d = getDemo(l.algo);
      expect(d).toBeDefined();
      for (const s of l.steps) if (s.input) expect([`${t.id}/${l.id}`, d!.inputs.some((i) => i.id === s.input)]).toEqual([`${t.id}/${l.id}`, true]);
    }
});
