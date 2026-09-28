// C++ demos (group 'machine-cpp'): build pipeline, object layout, stack/heap lifetime, move, vector, vtables, atomics, codegen.
import type { Detail, Frame, PanelRow, Shape, Tone } from '../algo/frames';
import { arrow, box, code, Film, line, machineDemo, panel, text } from './lib/draw';
import type { Row } from './lib/draw';
import { codeMapFrames } from './lib/code';
import type { CodeMap } from './lib/code';

const G = 'machine-cpp';
type Panel = { title: string; rows: PanelRow[] };

// Tap-to-explain details, keyed by box label (see machineDemo `details`).
const MATH_H = 'int square(int x);   // declaration only';
const DETAILS: Record<string, Detail> = {
  'main.cpp': {
    title: 'main.cpp — a source file',
    text: 'Plain text you write. The compiler reads it plus every header it #includes, and turns it into one object file. main() is where the program starts.',
    code: '#include <iostream>\n#include "math.h"\n\nint main() {\n  std::cout << square(3) << "\\n";  // 9\n}',
  },
  'math.h': {
    title: 'math.h — a header',
    text: 'Declarations shared between .cpp files: it says square exists, not how it works. #include literally pastes this text into each file that includes it.',
    code: '#pragma once        // paste at most once per .cpp\n\n' + MATH_H,
  },
  'math.cpp': {
    title: 'math.cpp — the definition',
    text: 'The one place the body of square lives. It is compiled on its own into math.o; main.cpp only needs the declaration from math.h.',
    code: '#include "math.h"\n\nint square(int x) {\n  return x * x;\n}',
  },
  'other.cpp': {
    title: 'other.cpp',
    text: 'Another source file that includes math.h. If math.h holds a function body (not inline), this file compiles its own copy too.',
    code: '#include "math.h"   // body pasted here too\n\nint cube(int x) { return x * square(x); }',
  },
  'main.cpp + math.h': {
    title: 'Translation unit',
    text: 'What the compiler actually sees: main.cpp after the preprocessor pasted in every #include and expanded macros. Try g++ -E main.cpp to print it.',
    code: '// g++ -E main.cpp  (heavily trimmed)\nint square(int x);        // from math.h\n// … 30,000 lines of <iostream> …\nint main() { std::cout << square(3); }',
  },
  'math.cpp + math.h': { title: 'Translation unit', text: 'math.cpp with math.h pasted in. Compiled independently of every other unit, possibly in parallel.', code: 'int square(int x);        // from math.h\nint square(int x) { return x * x; }' },
  'other.cpp + math.h': { title: 'Translation unit', text: 'other.cpp with the header body pasted in, so this unit defines square as well.', code: 'int square(int x) { return x * x; }  // from math.h\nint cube(int x) { return x * square(x); }' },
  'main.o': {
    title: 'main.o — object file',
    text: 'Machine code for one translation unit, plus a symbol table: what it defines (T) and what it still needs (U). Addresses of external calls are left as holes for the linker.',
    code: '$ g++ -c main.cpp        # → main.o\n$ nm -C main.o\n                 U square(int)\n0000000000000000 T main',
  },
  'math.o': { title: 'math.o — object file', text: 'Defines square. The linker will point main.o’s call at this code.', code: '$ g++ -c math.cpp\n$ nm math.o\n0000000000000000 T _Z6squarei\n$ c++filt _Z6squarei\nsquare(int)' },
  'other.o': { title: 'other.o — object file', text: 'Also defines _Z6squarei, because the body came in through the header. Two T entries for one name means a link error.', code: '$ nm other.o\n0000000000000000 T _Z6squarei\n0000000000000020 T _Z4cubei' },
  'T main': { title: 'T — defined symbol', text: 'T means the symbol is defined in this object’s text (code) section.', code: '$ nm main.o | grep main\n0000000000000000 T main' },
  'U _Z6squarei': { title: 'U — undefined symbol', text: 'main.o calls square but doesn’t contain it. _Z6squarei is the mangled name: _Z, then 6 chars “square”, then i for an int parameter.', code: '$ nm main.o\n                 U _Z6squarei\n$ echo _Z6squarei | c++filt\nsquare(int)' },
  'T _Z6squarei': { title: 'Definition of square(int)', text: 'The object that actually contains the code for square. Exactly one such definition may exist in the final program (the one-definition rule).', code: '$ nm math.o\n0000000000000000 T _Z6squarei' },
  'linker (ld)': {
    title: 'The linker',
    text: 'Combines object files and libraries into one executable. For every U it finds the single matching T and patches the call address.',
    code: '$ g++ main.o math.o -o app      # link step\n# same as: g++ main.cpp math.cpp -o app\n\n# errors you will meet:\n# undefined reference to `square(int)`\n# multiple definition of `square(int)`',
  },
  'a.out': { title: 'The executable', text: 'The linked program. Sections: .text (code), .rodata (constants), .data/.bss (globals). The OS loader maps it into memory and jumps to its entry point.', code: '$ ./a.out\n9\n$ size a.out\n   text    data     bss\n   1932     600       8' },
  loader: { title: 'The loader', text: 'Part of the OS. It maps the executable’s segments into pages, loads shared libraries, then calls main.', code: '$ ldd ./a.out\n  libstdc++.so.6 => /lib/x86_64-linux-gnu/…\n  libc.so.6 => /lib/x86_64-linux-gnu/…' },
  vptr: {
    title: 'vptr — hidden vtable pointer',
    text: 'The compiler adds this 8-byte pointer to every object of a class with virtual functions. It points at the class’s vtable, which is how a virtual call finds the right function at run time.',
    code: 'struct Shape {\n  virtual double area() const = 0;\n  virtual ~Shape() = default;\n};\n// sizeof(Shape) == 8: just the vptr',
  },
  'Circle::area': { title: 'Circle::area', text: 'The override the vtable slot points to for Circle objects.', code: 'struct Circle final : Shape {\n  double r;\n  double area() const override {\n    return 3.14159 * r * r;\n  }\n};' },
  'Square::area': { title: 'Square::area', text: 'Square’s override. Same slot index as Circle::area, different table.', code: 'struct Square : Shape {\n  double side;\n  double area() const override {\n    return side * side;\n  }\n};' },
  it: { title: 'Iterator', text: 'For a vector, an iterator is just a pointer into its heap block. If the vector reallocates, the block moves and the iterator dangles.', code: 'std::vector<int> v{1, 2, 3};\nauto it = v.begin();\nv.push_back(4);     // may reallocate\n// *it is now undefined behaviour' },
  'freed block': { title: 'Freed block', text: 'The vector’s old storage, released after growing. Anything still pointing here reads freed memory.', code: 'int* p = &v[0];\nv.reserve(100);   // new block, old one freed\n*p = 5;           // use-after-free' },
  counter: { title: 'Shared counter', text: 'One int in memory that both threads increment. Without std::atomic or a mutex this is a data race, which is undefined behaviour.', code: 'int counter = 0;              // racy\nstd::atomic<int> safe{0};     // fine\n\nstd::thread a([&] { counter++; safe++; });\nstd::thread b([&] { counter++; safe++; });' },
  'L1 line': { title: 'Cache line state (MESI)', text: 'Each core caches the 64-byte line holding counter. M = modified (only copy, dirty), E = exclusive, S = shared, I = invalid. Writes need the line in M, which invalidates other cores’ copies.' },
  eax: { title: 'eax register', text: 'Each thread runs on its own core with its own registers. A plain counter++ loads into a register, adds, and stores back, three separate steps another core can interleave with.' },
};

// ---------------- compile & link ----------------
type BuildMode = 'ok' | 'undefined' | 'duplicate';

machineDemo({
  slug: 'cpp-build',
  title: 'Compile & link',
  group: G,
  details: DETAILS,
  summary: 'Preprocess → compile each .cpp to an object file → link symbols into one executable; undefined and duplicate symbols.',
  linkedFrom: ['C++'],
  inputs: [
    { id: 'ok', label: 'Links fine', data: { mode: 'ok' } },
    { id: 'undefined', label: 'Undefined reference', data: { mode: 'undefined' } },
    { id: 'duplicate', label: 'Multiple definition', data: { mode: 'duplicate' } },
  ],
  build({ mode }: { mode: BuildMode }) {
    const f = new Film();
    const missing = mode === 'undefined';
    const dup = mode === 'duplicate';
    const header = dup ? 'int square(int x) {…}' : 'int square(int x);';
    const draw = (stage: number) => {
      const out: Shape[] = [];
      const src: [string, string, number][] = [
        ['main.cpp', 'calls square(3)', 40],
        ['math.h', header, 370],
        [dup ? 'other.cpp' : 'math.cpp', dup ? 'also includes math.h' : 'defines square', 700],
      ];
      src.forEach(([n, s, x], i) => out.push(box(`src${i}`, x, 40, 260, 110, n, { sub: s, mono: true, tone: stage === 0 ? 'current' : 'default', dashed: i === 2 && missing })));
      if (missing) out.push(text('nb', 830, 180, 'left out of the build', { size: 24, tone: 'warn' }));
      if (stage >= 1) {
        out.push(box('tu0', 40, 230, 420, 90, 'main.cpp + math.h', { sub: 'translation unit', mono: true, tone: stage === 1 ? 'current' : 'default' }));
        if (!missing) out.push(box('tu1', 540, 230, 420, 90, dup ? 'other.cpp + math.h' : 'math.cpp + math.h', { sub: 'translation unit', mono: true, tone: stage === 1 ? 'current' : 'default' }));
        out.push(arrow('a0', 170, 152, 200, 226, 'muted'), arrow('a1', 500, 152, 300, 226, 'muted'));
        if (!missing) out.push(arrow('a2', 500, 152, 700, 226, 'muted'), arrow('a3', 830, 152, 800, 226, 'muted'));
      }
      if (stage >= 2) {
        const sym = stage >= 3;
        const bad = stage >= 4 && dup;
        out.push(box('o0', 40, 380, 420, 70, 'main.o', { mono: true, tone: stage === 2 ? 'current' : 'default' }));
        out.push(arrow('a4', 250, 322, 250, 376, 'muted'));
        if (sym) {
          out.push(box('o0s0', 40, 460, 420, 56, 'T main', { mono: true }));
          out.push(box('o0s1', 40, 526, 420, 56, dup ? 'T _Z6squarei' : 'U _Z6squarei', { mono: true, tone: bad ? 'fail' : dup ? 'write' : 'warn' }));
        }
        if (!missing) {
          out.push(box('o1', 540, 380, 420, 70, dup ? 'other.o' : 'math.o', { mono: true, tone: stage === 2 ? 'current' : 'default' }));
          out.push(arrow('a5', 750, 322, 750, 376, 'muted'));
          if (sym) out.push(box('o1s0', 540, 460, 420, 56, 'T _Z6squarei', { mono: true, tone: bad ? 'fail' : 'write' }));
        }
      }
      if (stage >= 4) {
        const err = missing || dup;
        out.push(box('ld', 40, 660, 920, 90, 'linker (ld)', { sub: err ? 'resolve symbols: failed' : 'resolve U → T, patch call addresses', mono: true, tone: err ? 'fail' : 'current' }));
        out.push(arrow('a6', 250, 586, 250, 656, 'muted'));
        if (!missing) out.push(arrow('a7', 750, dup ? 520 : 520, 750, 656, 'muted'));
        if (!err) out.push(line('res', 460, 554, 540, 488, 'ok', { width: 4 }));
      }
      if (stage >= 5) {
        const err = missing ? 'undefined reference to `square(int)`' : dup ? 'multiple definition of `square(int)`' : '';
        if (err) out.push(box('out', 40, 820, 920, 110, err, { mono: true, tone: 'fail' }));
        else {
          out.push(box('out', 40, 820, 440, 110, 'a.out', { sub: '.text · .rodata · .data', mono: true, tone: 'ok' }));
          out.push(box('run', 520, 820, 440, 110, 'loader', { sub: 'maps segments to pages', mono: true, tone: 'protocol' }));
        }
        out.push(arrow('a8', 500, 752, 500, 816, err ? 'fail' : 'ok'));
      }
      return out;
    };
    const pn = (stage: number): Panel =>
      panel('Build', [
        ['translation units', stage >= 1 ? (missing ? 1 : 2) : 0],
        ['object files', stage >= 2 ? (missing ? 1 : 2) : 0],
        ['unresolved', stage >= 4 && missing ? 1 : 0, stage >= 4 && missing ? 'fail' : undefined],
        ['duplicates', stage >= 4 && dup ? 1 : 0, stage >= 4 && dup ? 'fail' : undefined],
        ['result', stage < 5 ? '—' : missing || dup ? 'link error' : 'a.out', stage < 5 ? undefined : missing || dup ? 'fail' : 'ok'],
      ]);
    const notes = [
      missing ? 'Same project, but math.cpp was left out of the build command.' : dup ? 'This time math.h holds the full body of square, not just its declaration.' : 'Two source files and a header. Nothing runs until the build turns them into one executable.',
      '#include pastes math.h into each .cpp. Each result is a translation unit, compiled on its own.',
      'The compiler turns each unit into machine code in an object file. main.o calls square without knowing where it lives.',
      dup ? 'Both units compiled the body, so both objects define _Z6squarei (T).' : 'Names are mangled: square(int) becomes _Z6squarei. main.o lists it as U (undefined), math.o as T (defined).',
      missing ? 'The linker looks for a T to satisfy main.o’s U and finds none.' : dup ? 'The linker finds two T definitions for one name: the one-definition rule is broken.' : 'The linker matches every U to exactly one T and patches the call address.',
      missing
        ? 'It compiled fine, but the link fails. Add math.cpp to the build, or the library that holds it.'
        : dup
          ? 'Fix: declare it inline (or define it in one .cpp). Templates and inline functions are exempt from the duplicate check.'
          : 'One executable: .text code, .rodata constants, .data globals. The loader maps it into memory at run time.',
    ];
    notes.forEach((n, i) => f.add(n, draw(i), pn(i)));
    return f.frames;
  },
});

// ---------------- struct layout ----------------
export interface Field {
  name: string;
  type: string;
  size: number;
  align: number;
}

export function layoutStruct(fields: Field[]) {
  let off = 0;
  let align = 1;
  const placed = fields.map((fd) => {
    const pad = (fd.align - (off % fd.align)) % fd.align;
    off += pad;
    const at = { ...fd, offset: off, padBefore: pad };
    off += fd.size;
    align = Math.max(align, fd.align);
    return at;
  });
  const tail = (align - (off % align)) % align;
  const size = off + tail;
  return { fields: placed, size, align, tail, padding: size - fields.reduce((a, fd) => a + fd.size, 0) };
}

const T = (name: string, type: string): Field => {
  const s = { char: 1, bool: 1, short: 2, int: 4, float: 4, double: 8, 'void*': 8 }[type] ?? 8;
  return { name, type, size: s, align: s };
};

const LAYOUTS: Record<string, { src: string[]; fields: Field[]; lines: number[]; intro: string }> = {
  bad: {
    src: ['struct Bad {', '  char   a;', '  double b;', '  char   c;', '  int    d;', '};'],
    fields: [T('a', 'char'), T('b', 'double'), T('c', 'char'), T('d', 'int')],
    lines: [1, 2, 3, 4],
    intro: 'Each type must sit at an offset that is a multiple of its alignment. Fields keep their declared order.',
  },
  good: {
    src: ['struct Good {', '  double b;', '  int    d;', '  char   a;', '  char   c;', '};'],
    fields: [T('b', 'double'), T('d', 'int'), T('a', 'char'), T('c', 'char')],
    lines: [1, 2, 3, 4],
    intro: 'Same four fields, sorted largest first. Watch how little padding is left.',
  },
  virtual: {
    src: ['struct Shape {', '  virtual ~Shape();', '  int  id;', '  char tag;', '};'],
    fields: [{ name: 'vptr', type: 'void*', size: 8, align: 8 }, T('id', 'int'), T('tag', 'char')],
    lines: [1, 2, 3],
    intro: 'A class with any virtual function carries a hidden pointer to its vtable, placed first.',
  },
};
const FIELD_TONES: Tone[] = ['read', 'write', 'protocol', 'accent', 'ok'];

machineDemo({
  slug: 'cpp-layout',
  title: 'Struct layout & padding',
  group: G,
  details: DETAILS,
  summary: 'sizeof, alignof and padding byte by byte; reordering fields; the hidden vptr.',
  linkedFrom: ['C++', 'CPU'],
  inputs: [
    { id: 'bad', label: 'char, double, char, int', data: { s: 'bad' } },
    { id: 'good', label: 'Largest first', data: { s: 'good' } },
    { id: 'virtual', label: 'With a vptr', data: { s: 'virtual' } },
  ],
  build({ s }: { s: string }) {
    const L = LAYOUTS[s];
    const lay = layoutStruct(L.fields);
    const rows = Math.ceil(lay.size / 8);
    const GX = 190;
    const CW = 95;
    const GY = 400;
    const RH = 110;
    const f = new Film();
    const draw = (upto: number, cur: number, tail: boolean) => {
      const out: Shape[] = [...code(L.src, 30, 44, cur >= 0 ? [L.lines[cur]] : [])];
      const placed = lay.fields.slice(0, upto);
      const used = (k: number) => placed.some((fd) => k >= fd.offset - fd.padBefore && k < fd.offset + fd.size) || (tail && k >= lay.size - lay.tail);
      for (let r = 0; r < rows; r++) {
        out.push(text(`off${r}`, GX - 24, GY + r * RH + RH / 2, `+${r * 8}`, { align: 'right', size: 26, mono: true }));
        for (let c = 0; c < 8; c++) if (!used(r * 8 + c)) out.push(box(`b${r}-${c}`, GX + c * CW + 3, GY + r * RH + 3, CW - 6, RH - 6, undefined, { tone: 'visited', filled: false, dashed: true }));
      }
      for (let c = 0; c < 8; c++) out.push(text(`bx${c}`, GX + c * CW + CW / 2, GY - 24, String(c), { size: 24, mono: true, tone: 'muted' }));
      const cell = (id: string, from: number, len: number, label: string, o: { tone: Tone; dashed?: boolean; sub?: string }) => {
        for (let k = from; k < from + len; ) {
          const r = Math.floor(k / 8);
          const n = Math.min(from + len, (r + 1) * 8) - k;
          out.push(box(`${id}-${k}`, GX + (k % 8) * CW + 3, GY + r * RH + 3, n * CW - 6, RH - 6, n >= 2 || len === 1 ? label : '', { mono: true, tone: o.tone, dashed: o.dashed, sub: n >= 2 ? o.sub : undefined, filled: !o.dashed }));
          k += n;
        }
      };
      lay.fields.slice(0, upto).forEach((fd, i) => {
        if (fd.padBefore) cell(`p${i}`, fd.offset - fd.padBefore, fd.padBefore, 'pad', { tone: 'warn', dashed: true });
        cell(`f${i}`, fd.offset, fd.size, fd.name, { tone: i === cur ? 'current' : FIELD_TONES[i % FIELD_TONES.length], sub: fd.type });
      });
      if (tail && lay.tail) cell('tail', lay.size - lay.tail, lay.tail, 'pad', { tone: 'warn', dashed: true });
      return out;
    };
    const pn = (upto: number, tail: boolean): Panel => {
      const last = lay.fields[upto - 1];
      const end = last ? last.offset + last.size : 0;
      const pad = lay.fields.slice(0, upto).reduce((a, fd) => a + fd.padBefore, 0) + (tail ? lay.tail : 0);
      return panel('Layout', [
        ['sizeof', tail ? lay.size : `${end}…`, tail ? 'ok' : undefined],
        ['alignof', tail ? lay.align : '…'],
        ['data bytes', lay.fields.slice(0, upto).reduce((a, fd) => a + fd.size, 0)],
        ['padding', pad, pad ? 'warn' : undefined],
        ['per 64 B line', tail ? (64 / lay.size).toFixed(1) : '…'],
      ]);
    };
    f.add(L.intro, draw(0, -1, false), pn(0, false));
    lay.fields.forEach((fd, i) => {
      const before = fd.offset - fd.padBefore;
      const note = fd.name === 'vptr'
        ? 'Hidden vptr: 8 bytes at offset 0, pointing to the class’s vtable.'
        : fd.padBefore
          ? `${fd.name}: ${fd.type}, align ${fd.align}. Offset ${before} is not a multiple of ${fd.align}, so ${fd.padBefore} padding bytes go first.`
          : `${fd.name}: ${fd.type}, ${fd.size} byte${fd.size > 1 ? 's' : ''} at offset ${fd.offset}, already aligned.`;
      f.add(note, draw(i + 1, i, false), pn(i + 1, false));
    });
    const endData = lay.size - lay.tail;
    f.add(
      lay.tail ? `Data ends at ${endData}, but sizeof must be a multiple of the largest alignment (${lay.align}) so arrays stay aligned: ${lay.tail} more bytes.` : `Data ends at ${endData}, already a multiple of ${lay.align}: no tail padding.`,
      draw(lay.fields.length, -1, true),
      pn(lay.fields.length, true),
    );
    f.add(
      s === 'bad'
        ? `sizeof = ${lay.size} for 14 bytes of data: ${lay.padding} bytes of padding. Sort fields largest first to fix it.`
        : s === 'good'
          ? `sizeof = ${lay.size}, down from 24: a third less memory and cache traffic for arrays of these.`
          : `sizeof = ${lay.size}: the vptr costs 8 bytes per object. That is the price of virtual dispatch.`,
      draw(lay.fields.length, -1, true),
      pn(lay.fields.length, true),
    );
    return f.frames;
  },
});

// ---------------- stack & heap scenes ----------------
interface Var {
  name: string;
  val: string;
  to?: string;
  tone?: Tone;
}
interface StackFrame {
  fn: string;
  vars: Var[];
  dead?: boolean;
}
interface Block {
  id: string;
  label: string;
  sub: string;
  bytes: number;
  state: 'live' | 'freed' | 'leaked';
}
interface Snap {
  line: number[];
  note: string;
  frames: StackFrame[];
  heap: Block[];
  extra: Row[];
}

/** Records stack/heap snapshots for a short C++ program. */
class Scene {
  frames: StackFrame[] = [];
  heap: Block[] = [];
  snaps: Snap[] = [];
  extra: Row[] = [];
  constructor(readonly src: string[]) {}
  call(fn: string) {
    this.frames = this.frames.filter((fr) => !fr.dead);
    this.frames.push({ fn, vars: [] });
    return this;
  }
  ret(ghost = false) {
    const top = this.frames[this.frames.length - 1];
    if (ghost) top.dead = true;
    else this.frames.pop();
    return this;
  }
  v(name: string, val: string, to?: string, tone?: Tone) {
    const fr = [...this.frames].reverse().find((x) => !x.dead)!;
    const cur = fr.vars.find((x) => x.name === name);
    if (cur) Object.assign(cur, { val, to, tone });
    else fr.vars.push({ name, val, to, tone });
    return this;
  }
  alloc(id: string, label: string, sub: string, bytes: number) {
    this.heap.push({ id, label, sub, bytes, state: 'live' });
    return this;
  }
  set(id: string, label: string) {
    this.heap.find((b) => b.id === id)!.label = label;
    return this;
  }
  free(id: string) {
    this.heap.find((b) => b.id === id)!.state = 'freed';
    return this;
  }
  leakAll() {
    for (const b of this.heap) if (b.state === 'live') b.state = 'leaked';
    return this;
  }
  snap(line: number | number[], note: string, extra: Row[] = []) {
    this.snaps.push({ line: typeof line === 'number' ? [line] : line, note, frames: JSON.parse(JSON.stringify(this.frames)), heap: JSON.parse(JSON.stringify(this.heap)), extra });
    return this;
  }
}

function sceneFrames(sc: Scene, intro: string, title = 'Memory'): Frame[] {
  const lh = Math.min(40, 330 / sc.src.length);
  const top = 30 + sc.src.length * lh + 50;
  const draw = (s: Snap | undefined, prev: Snap | undefined): Shape[] => {
    const out: Shape[] = [...code(sc.src, 30, lh, s?.line ?? [])];
    out.push(text('sk', 20, top, 'stack', { align: 'left', size: 28, bold: true, tone: 'write' }), text('hp', 560, top, 'heap', { align: 'left', size: 28, bold: true, tone: 'read' }));
    if (!s) return out;
    const pos = new Map<string, { x: number; y: number }>();
    const prevVal = new Map<string, string>();
    prev?.frames.forEach((fr) => fr.vars.forEach((v) => prevVal.set(`${fr.fn}.${v.name}`, v.val + (v.to ?? ''))));
    let y = top + 30;
    s.frames.forEach((fr, fi) => {
      const h = 48 + Math.max(1, fr.vars.length) * 66;
      const frame = box(`fr${fi}`, 16, y, 470, h, undefined, { tone: fr.dead ? 'fail' : 'default', filled: false, dashed: fr.dead });
      if (frame.t === 'rect') frame.detail = { title: `Stack frame of ${fr.fn}()`, text: `Created when ${fr.fn}() is called, destroyed when it returns. Locals live here, so allocating them is just moving the stack pointer.`, code: `void ${fr.fn}() {\n  int x = 1;      // in this frame\n}                 // frame popped, x is gone` };
      out.push(frame);
      out.push(text(`frn${fi}`, 32, y + 26, fr.dead ? `${fr.fn}() — popped` : `${fr.fn}()`, { align: 'left', size: 26, bold: true, tone: fr.dead ? 'fail' : 'write' }));
      fr.vars.forEach((v, vi) => {
        const vy = y + 48 + vi * 66;
        const id = `${fr.fn}.${v.name}`;
        const changed = !fr.dead && prevVal.get(id) !== v.val + (v.to ?? '');
        out.push(text(`vn${fi}-${vi}`, 36, vy + 30, v.name, { align: 'left', size: 26, mono: true, tone: fr.dead ? 'muted' : undefined }));
        const val = box(`vv${fi}-${vi}`, 190, vy + 2, 280, 56, v.val, { mono: true, tone: v.tone ?? (fr.dead ? 'visited' : changed ? 'write' : 'default'), dashed: fr.dead });
        if (val.t === 'rect') val.detail = v.to ? { title: `${v.name} — a pointer`, text: `${v.name} lives on ${fr.fn}()’s stack and holds an address; the arrow shows what it points to. If that target is freed or its frame popped, ${v.name} dangles.`, code: `int* ${v.name} = new int(5);  // address of a heap int\n*${v.name} = 6;                 // write through it\ndelete ${v.name};               // now it dangles` } : { title: `${v.name} = ${v.val}`, text: `A local variable stored in ${fr.fn}()’s stack frame. It lives until the closing brace of its scope.` };
        out.push(val);
        pos.set(id, { x: 470, y: vy + 30 });
      });
      y += h + 14;
    });
    s.heap.forEach((b, bi) => {
      const by = top + 30 + bi * 104;
      const tone: Tone = b.state === 'freed' ? 'visited' : b.state === 'leaked' ? 'fail' : 'read';
      const blk = box(`hb-${b.id}`, 560, by, 420, 88, b.label, { sub: b.state === 'live' ? b.sub : `${b.sub} · ${b.state}`, mono: true, tone, dashed: b.state === 'freed' });
      if (blk.t === 'rect') blk.detail = { title: `Heap block (${b.bytes} B, ${b.state})`, text: b.state === 'leaked' ? 'Nothing points here any more and it was never freed: a leak. Owning it with std::unique_ptr or a container frees it automatically.' : b.state === 'freed' ? 'Returned to the allocator. Reading or writing it now is use-after-free, undefined behaviour.' : 'Memory from new or an allocating container. It outlives the function that created it, until delete or the owner’s destructor.', code: 'auto p = std::make_unique<int[]>(4);  // heap, owned\nstd::vector<int> v(4);                // heap, owned\nint* raw = new int[4];                // heap, you must delete[]' };
      out.push(blk);
      pos.set(b.id, { x: 560, y: by + 44 });
    });
    s.frames.forEach((fr, fi) =>
      fr.vars.forEach((v, vi) => {
        if (!v.to) return;
        const a = pos.get(`${fr.fn}.${v.name}`)!;
        const t = pos.get(v.to);
        if (!t) return;
        const tb = s.heap.find((b) => b.id === v.to);
        const bad = v.tone === 'fail' || v.tone === 'warn' || tb?.state === 'freed' || s.frames.some((x) => x.dead && v.to!.startsWith(`${x.fn}.`));
        const tone: Tone = bad ? 'fail' : 'accent';
        if (t.x === 470) out.push({ t: 'edge', id: `p${fi}-${vi}`, from: { x: 474, y: a.y }, to: { x: 474, y: t.y }, arrow: true, bend: a.y > t.y ? 70 : -70, tone, dashed: bad });
        else out.push(arrow(`p${fi}-${vi}`, 474, a.y, 552, t.y, tone, { dashed: bad }));
      }),
    );
    return out;
  };
  const pn = (s?: Snap): Panel => {
    const live = s?.heap.filter((b) => b.state === 'live') ?? [];
    const leaked = s?.heap.filter((b) => b.state === 'leaked') ?? [];
    return panel(title, [
      ['stack frames', s?.frames.filter((x) => !x.dead).length ?? 0],
      ['heap live', `${live.reduce((a, b) => a + b.bytes, 0)} B`],
      ['leaked', `${leaked.reduce((a, b) => a + b.bytes, 0)} B`, leaked.length ? 'fail' : undefined],
      ...(s?.extra ?? []),
    ]);
  };
  const f = new Film();
  f.add(intro, draw(undefined, undefined), pn());
  sc.snaps.forEach((s, i) => f.add(s.note, draw(s, sc.snaps[i - 1]), pn(s)));
  return f.frames;
}

const MEMORY: Record<string, () => { sc: Scene; intro: string }> = {
  pointers: () => {
    const sc = new Scene(['int main() {', '  int x = 5;', '  int* p = &x;', '  *p = 7;', '  int& r = x;', '  r = 9;', '  p = nullptr;', '}']);
    sc.call('main').snap(0, 'main gets a stack frame; its locals will live there.');
    sc.v('x', '5').snap(1, 'x is 4 bytes in main’s frame, at an address like 0x7ffc10.');
    sc.v('p', '0x7ffc10', 'main.x').snap(2, 'p holds x’s address. A pointer is a number that names a byte in memory.');
    sc.v('x', '7').snap(3, '*p = 7 writes through the pointer, so x changes without being named.');
    sc.v('r', '→ x', 'main.x').snap(4, 'A reference is another name for x. It cannot be null or re-pointed.');
    sc.v('x', '9').snap(5, 'r = 9 is x = 9. Under the hood a reference is usually just a pointer.');
    sc.v('p', 'nullptr').snap(6, 'nullptr points nowhere. Dereferencing it is undefined behaviour, usually a crash.');
    sc.ret().snap(7, 'The closing brace pops main’s frame: x, p and r vanish together, for free.');
    return { sc, intro: 'Pointers and references, drawn as arrows between memory cells.' };
  },
  heap: () => {
    const sc = new Scene(['int* make() {', '  int* a = new int[3]{1, 2, 3};', '  return a;', '}', 'int main() {', '  int* p = make();', '  p[1] = 20;', '  delete[] p;', '  p = make();', '}']);
    sc.call('main').v('p', '?').snap(4, 'main starts with one frame; p is not set yet.');
    sc.call('make').snap(5, 'Calling make pushes a new frame below main’s.');
    sc.alloc('b1', '1  2  3', 'int[3] · 12 B', 12).v('a', '0x5010', 'b1').snap(1, 'new asks the allocator for 12 bytes of heap. a, on the stack, points at them.');
    sc.ret().v('p', '0x5010', 'b1').snap([2, 5], 'make’s frame is gone but the heap block outlives it. p now owns it.');
    sc.set('b1', '1  20  3').snap(6, 'p[1] = 20 writes into the heap block.');
    sc.free('b1').v('p', '0x5010', 'b1', 'warn').snap(7, 'delete[] hands the block back. p still holds the old address: it dangles.');
    sc.alloc('b2', '1  2  3', 'int[3] · 12 B', 12).v('p', '0x5030', 'b2').snap(8, 'A second make() gives p a fresh block.');
    sc.ret().leakAll().snap(9, 'main ends without delete: 12 bytes leak. Stack memory frees itself, heap memory does not.');
    return { sc, intro: 'Stack memory lives as long as its frame. Heap memory lives until someone calls delete.' };
  },
  dangling: () => {
    const sc = new Scene(['int* bad() {', '  int local = 42;', '  return &local;', '}', 'int main() {', '  int* p = bad();', '  other();', '  int v = *p;', '}']);
    sc.call('main').v('p', '?').snap(4, 'main starts.');
    sc.call('bad').v('local', '42').snap(1, 'bad’s frame holds local = 42.');
    sc.ret(true);
    sc.frames[0].vars[0] = { name: 'p', val: '0x7ffb08', to: 'bad.local', tone: 'fail' };
    sc.snap([2, 5], 'bad’s frame is popped, but p still holds local’s address. It compiles, with a warning.');
    sc.call('other').v('tmp', '1234');
    sc.frames[0].vars[0] = { name: 'p', val: '0x7ffb08', to: 'other.tmp', tone: 'fail' };
    sc.snap(6, 'other() gets a frame in the same place and overwrites the slot.');
    sc.ret();
    sc.v('v', '1234', undefined, 'fail').snap(7, 'Reading *p is undefined behaviour. Here it returns 1234, left behind by other().');
    return { sc, intro: 'Returning the address of a local: the classic dangling pointer.' };
  },
};

machineDemo({
  slug: 'cpp-memory',
  title: 'Stack, heap & pointers',
  group: G,
  details: DETAILS,
  summary: 'Frames, locals and heap blocks with pointers drawn as arrows: new/delete, leaks, dangling pointers.',
  linkedFrom: ['C++', 'Memory'],
  inputs: [
    { id: 'pointers', label: 'Pointers & references', data: { p: 'pointers' } },
    { id: 'heap', label: 'new, delete, leak', data: { p: 'heap' } },
    { id: 'dangling', label: 'Dangling pointer', data: { p: 'dangling' } },
  ],
  build({ p }: { p: string }) {
    const { sc, intro } = MEMORY[p]();
    return sceneFrames(sc, intro);
  },
});

const RAII: Record<string, () => { sc: Scene; intro: string }> = {
  raw: () => {
    const sc = new Scene(['void f() {', '  int*  buf = new int[4];', '  FILE* log = fopen("a.log", "w");', '  work();            // throws', '  fclose(log);', '  delete[] buf;', '}']);
    sc.call('f').snap(0, 'f() starts with an empty frame.');
    sc.alloc('buf', 'int[4]', '16 B', 16).v('buf', '0x5010', 'buf').snap(1, 'buf owns 16 heap bytes, but only by convention.');
    sc.alloc('log', 'FILE · fd 3', 'OS file handle', 0).v('log', '0x5040', 'log').snap(2, 'log holds an open file: a resource, not just memory.');
    sc.snap(3, 'work() throws. The exception starts unwinding f’s frame right away.', [['exception', 'in flight', 'warn']]);
    sc.ret().leakAll().snap(6, 'The frame is popped, but raw pointers have no destructor: the cleanup lines never run.', [['exception', 'propagated', 'warn']]);
    return { sc, intro: 'Manual cleanup at the end of a function only runs if control reaches the end.' };
  },
  raii: () => {
    const sc = new Scene(['void f() {', '  std::vector<int> buf(4);', '  std::ofstream log("a.log");', '  work();            // throws', '}                    // ~log, ~buf']);
    sc.call('f').snap(0, 'Same function, but every resource is owned by a stack object.');
    sc.alloc('buf', '0  0  0  0', 'int[4] · 16 B', 16).v('buf', 'size 4', 'buf').snap(1, 'vector’s constructor allocates; its destructor will free.');
    sc.alloc('log', 'fd 3', 'OS file handle', 0).v('log', 'open', 'log').snap(2, 'ofstream opens the file in its constructor and closes it in its destructor.');
    sc.snap(3, 'work() throws and unwinding begins.', [['exception', 'in flight', 'warn']]);
    sc.free('log');
    sc.frames[0].vars[1] = { name: 'log', val: '~ofstream()', tone: 'ok' };
    sc.snap(4, 'Destructors run in reverse order of construction: ~log closes the file first.', [['exception', 'in flight', 'warn']]);
    sc.free('buf');
    sc.frames[0].vars[0] = { name: 'buf', val: '~vector()', tone: 'ok' };
    sc.snap(4, '~buf returns its 16 bytes to the heap.', [['exception', 'in flight', 'warn']]);
    sc.ret().snap(4, 'Frame popped and nothing leaked, exception or not. That is RAII.', [['exception', 'propagated', 'warn']]);
    return { sc, intro: 'RAII: tie each resource to an object whose destructor releases it.' };
  },
};

machineDemo({
  slug: 'cpp-raii',
  title: 'RAII & destructors',
  group: G,
  details: DETAILS,
  summary: 'An exception unwinds the stack: raw new/fopen leak, vector/ofstream destructors clean up in reverse order.',
  linkedFrom: ['C++'],
  inputs: [
    { id: 'raw', label: 'Raw new + throw', data: { p: 'raw' } },
    { id: 'raii', label: 'RAII + throw', data: { p: 'raii' } },
  ],
  build({ p }: { p: string }) {
    const { sc, intro } = RAII[p]();
    return sceneFrames(sc, intro);
  },
});

const MOVE: Record<string, () => { sc: Scene; intro: string }> = {
  copy: () => {
    const sc = new Scene(['std::vector<int> a{1, 2, 3};', 'std::vector<int> b = a;', 'b[0] = 9;']);
    sc.call('main').alloc('A', '1  2  3', 'int[3] · 12 B', 12).v('a', 'size 3 cap 3', 'A').snap(0, 'A vector is 3 pointers on the stack (24 B); the elements live on the heap.', [['allocations', 1], ['bytes copied', 0]]);
    sc.alloc('B', '1  2  3', 'int[3] · 12 B', 12).v('b', 'size 3 cap 3', 'B').snap(1, 'Copy: allocate a new block, then copy every element into it.', [['allocations', 2], ['bytes copied', 12, 'warn']]);
    sc.set('B', '9  2  3').snap(2, 'The two are independent: changing b leaves a alone.', [['allocations', 2], ['bytes copied', 12, 'warn']]);
    return { sc, intro: 'Copying a vector copies what it owns, not just its pointer.' };
  },
  move: () => {
    const sc = new Scene(['std::vector<int> a{1, 2, 3};', 'std::vector<int> b = std::move(a);', 'a.size();   // 0']);
    sc.call('main').alloc('A', '1  2  3', 'int[3] · 12 B', 12).v('a', 'size 3 cap 3', 'A').snap(0, 'Same vector a with its heap block.', [['allocations', 1], ['bytes copied', 0]]);
    sc.v('b', 'size 3 cap 3', 'A').v('a', 'null · 0 · 0').snap(1, 'Move: b takes a’s three pointers and a is set to empty. No allocation, no element copied.', [['allocations', 1], ['bytes copied', 0, 'ok']]);
    sc.snap(2, 'a is still a valid, empty vector. Use it again only after assigning to it.', [['allocations', 1], ['bytes copied', 0, 'ok']]);
    return { sc, intro: 'std::move only casts to an rvalue; the move constructor does the stealing.' };
  },
  ret: () => {
    const sc = new Scene(['std::vector<int> make() {', '  std::vector<int> v{1, 2, 3};', '  return v;', '}', 'auto r = make();']);
    sc.call('main').v('r', '(not built)').snap(4, 'main reserves space for r, then calls make.', [['allocations', 0], ['bytes copied', 0]]);
    sc.call('make').alloc('A', '1  2  3', 'int[3] · 12 B', 12);
    sc.frames[0].vars[0] = { name: 'r', val: 'size 3 cap 3', to: 'A' };
    sc.v('v', '= r (same object)', 'main.r').snap(1, 'The compiler builds v directly in r’s slot: v and r are one object (NRVO).', [['allocations', 1], ['bytes copied', 0]]);
    sc.ret().snap([2, 4], 'return v copies nothing. At worst it would be a move, never a deep copy.', [['allocations', 1], ['bytes copied', 0, 'ok']]);
    return { sc, intro: 'Returning a big object by value is cheap in C++17.' };
  },
};

machineDemo({
  slug: 'cpp-move',
  title: 'Copy vs move',
  group: G,
  details: DETAILS,
  summary: 'Copying a vector duplicates its heap block; moving steals the pointer; return by value elides both.',
  linkedFrom: ['C++'],
  inputs: [
    { id: 'copy', label: 'Copy', data: { p: 'copy' } },
    { id: 'move', label: 'Move', data: { p: 'move' } },
    { id: 'ret', label: 'Return by value', data: { p: 'ret' } },
  ],
  build({ p }: { p: string }) {
    const { sc, intro } = MOVE[p]();
    return sceneFrames(sc, intro, 'Copy vs move');
  },
});

// ---------------- vector growth ----------------
/** push_back n times with doubling growth (libstdc++): capacities seen, allocations, element moves. */
export function vectorGrowth(n: number, reserve = 0) {
  let cap = reserve;
  let allocs = reserve ? 1 : 0;
  let moves = 0;
  const caps: number[] = reserve ? [reserve] : [];
  for (let size = 0; size < n; size++) {
    if (size === cap) {
      cap = cap ? cap * 2 : 1;
      allocs++;
      moves += size;
      caps.push(cap);
    }
  }
  return { caps, allocs, moves, cap };
}

const LIST_POS = [5, 12, 2, 9, 14, 0, 7, 11, 3];

machineDemo({
  slug: 'cpp-vector',
  title: 'std::vector growth',
  group: G,
  details: DETAILS,
  summary: 'push_back doubles capacity, moves elements and invalidates iterators; reserve avoids it; vector vs list in cache lines.',
  linkedFrom: ['C++', 'CPU'],
  inputs: [
    { id: 'grow', label: 'push_back × 9', data: { mode: 'grow' } },
    { id: 'reserve', label: 'reserve(9) first', data: { mode: 'reserve' } },
    { id: 'list', label: 'vector vs list', data: { mode: 'list' } },
  ],
  build({ mode }: { mode: 'grow' | 'reserve' | 'list' }) {
    const f = new Film();
    if (mode === 'list') return listFrames();
    const N = 9;
    const reserve = mode === 'reserve' ? N : 0;
    let cap = reserve;
    let size = 0;
    let allocs = reserve ? 1 : 0;
    let moves = 0;
    let itDead = false;
    const src = [reserve ? 'std::vector<int> v; v.reserve(9);' : 'std::vector<int> v;', 'auto it = v.begin();   // after 1st push', 'for (int i = 1; i <= 9; i++) v.push_back(i);'];
    const draw = (hi: number, old?: { cap: number; size: number }, freed = false) => {
      const out: Shape[] = [...code(src, 30, 44, [hi])];
      out.push(box('hdr', 20, 190, 460, 80, `size ${size} · cap ${cap}`, { sub: 'v: data · size · cap (stack)', mono: true, tone: 'write' }));
      const cw = Math.min(100, 940 / Math.max(cap, old?.cap ?? 1, 1));
      const row = (id: string, y: number, c: number, sz: number, tone: Tone, dashed = false) => {
        for (let k = 0; k < c; k++) out.push(box(`${id}${k}`, 30 + k * cw, y, cw - 6, 80, k < sz ? String(k + 1) : '', { mono: true, tone: k < sz ? tone : 'visited', dashed: dashed || k >= sz, filled: k < sz && !dashed }));
      };
      if (cap) {
        out.push(text('nl', 30, 360, `heap block · ${cap * 4} B`, { align: 'left', size: 26, bold: true, tone: 'read' }));
        row('n', 390, cap, size, 'read');
        out.push(arrow('dp', 250, 272, 250, 386, 'accent'));
      }
      if (old) {
        out.push(text('ol', 30, 560, freed ? 'old block · freed' : `old block · ${old.cap * 4} B`, { align: 'left', size: 26, bold: true, tone: freed ? 'fail' : 'default' }));
        row('o', 590, old.cap, old.size, freed ? 'visited' : 'default', freed);
        if (!freed) out.push(arrow('mv', 30 + (old.cap * cw) / 2, 588, 30 + (old.cap * cw) / 2, 474, 'write', { dashed: true }));
      }
      if (size >= 1 && !reserve) {
        out.push(box('it', 700, 840, 280, 90, 'it', { sub: itDead ? 'dangling' : 'v.begin()', mono: true, tone: itDead ? 'fail' : 'accent' }));
        if (itDead) {
          out.push(box('itg', 700, 700, 280, 80, 'freed block', { sub: 'where it still points', mono: true, tone: 'fail', dashed: true, filled: false }));
          out.push(arrow('itp', 840, 838, 840, 784, 'fail', { dashed: true }));
        } else out.push(arrow('itp', 700, 885, 30 + cw / 2, 474, 'accent'));
      }
      return out;
    };
    const pn = (): Panel =>
      panel('vector', [
        ['size', size],
        ['capacity', cap],
        ['allocations', allocs],
        ['elements moved', moves, moves ? 'warn' : undefined],
        ...(reserve ? [] : ([['it', size === 0 ? '—' : itDead ? 'invalid' : 'valid', itDead ? 'fail' : 'ok']] as Row[])),
      ]);
    f.add(reserve ? 'reserve(9) allocates room for 9 ints up front; size stays 0.' : 'An empty vector owns no heap memory: data = nullptr, cap = 0.', draw(0), pn());
    for (let i = 1; i <= N; i++) {
      if (size === cap) {
        const old = { cap, size };
        cap = cap ? cap * 2 : 1;
        allocs++;
        if (old.cap) {
          f.add(`push_back(${i}): full at capacity ${old.cap}. Allocate a new block of ${cap}.`, draw(2, old), pn());
          moves += old.size;
          if (size >= 1) itDead = true;
          f.add(`Move ${old.size} element${old.size > 1 ? 's' : ''} over and free the old block. Every pointer or iterator into it is now dangling.`, draw(2, old, true), pn());
        }
      }
      size++;
      f.add(i === 1 && !reserve ? 'push_back(1): first allocation, capacity 1. it now points at element 0.' : `push_back(${i}): fits, size ${size} of ${cap}.`, draw(i === 1 ? 1 : 2), pn());
    }
    f.add(
      reserve ? '1 allocation and 0 moves. Reserve when you know the size, and iterators stay valid.' : `${allocs} allocations and ${moves} moves for 9 elements; doubling keeps it under 2 moves per element on average.`,
      draw(2),
      pn(),
    );
    return f.frames;
  },
});

function listFrames(): Frame[] {
  const f = new Film();
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  let vMiss = 0;
  let lMiss = 0;
  const draw = (k: number) => {
    const out: Shape[] = [text('vt', 20, 40, 'std::vector<int> · 9 × 4 B contiguous', { align: 'left', size: 28, bold: true, tone: 'read' })];
    out.push(box('vline', 20, 70, 960, 100, undefined, { tone: k >= 0 ? 'ok' : 'default', filled: false, dashed: true }));
    for (let i = 0; i < 16; i++) out.push(box(`v${i}`, 26 + i * 59.5, 80, 54, 80, i < 9 ? String(vals[i]) : '', { mono: true, tone: i === k ? 'current' : i < k ? 'visited' : i < 9 ? 'read' : 'visited', filled: i < 9, dashed: i >= 9 }));
    out.push(text('vl', 500, 200, 'one 64-byte cache line', { size: 24, tone: 'muted' }));
    out.push(text('lt', 20, 270, 'std::list<int> · nodes scattered on the heap', { align: 'left', size: 28, bold: true, tone: 'write' }));
    const cell = (p: number) => ({ x: 20 + (p % 4) * 245, y: 310 + Math.floor(p / 4) * 160 });
    for (let p = 0; p < 16; p++) {
      const c = cell(p);
      const n = LIST_POS.indexOf(p);
      out.push(box(`l${p}`, c.x, c.y, 225, 130, n >= 0 ? `node ${vals[n]}` : '', { sub: n >= 0 ? 'val · prev · next' : '64 B line', mono: true, tone: n < 0 ? 'visited' : n === k ? 'current' : n < k ? 'visited' : 'write', dashed: n < 0, filled: n >= 0 }));
    }
    for (let n = 0; n < Math.min(k, 8); n++) {
      const a = cell(LIST_POS[n]);
      const b = cell(LIST_POS[n + 1]);
      out.push(arrow(`ln${n}`, a.x + 112, a.y + 65, b.x + 112, b.y + 65, n === k - 1 ? 'write' : 'visited', { width: n === k - 1 ? 4 : 2 }));
    }
    return out;
  };
  const pn = (): Panel =>
    panel('Traversal', [
      ['vector misses', vMiss, 'ok'],
      ['list misses', lMiss, lMiss > 1 ? 'fail' : undefined],
      ['vector time', `~${vMiss * 100 + (9 - vMiss)} ns`],
      ['list time', `~${lMiss * 100} ns`],
    ]);
  f.add('Sum 9 ints stored two ways. A cache miss costs ~100 ns, a hit ~1 ns.', draw(-1), pn());
  for (let k = 0; k < 9; k++) {
    if (k === 0) vMiss++;
    lMiss++;
    f.add(
      k === 0 ? 'Element 1: both miss. The vector’s miss brings in its whole line, all 9 values.' : `Element ${k + 1}: the vector hits in L1; the list must load node ${k}’s next pointer first, another miss.`,
      draw(k),
      pn(),
    );
  }
  f.add('Same O(n) loop, ~9× the memory stalls. The prefetcher can’t help either: the next address is unknown until the load returns.', draw(9), pn());
  return f.frames;
}

// ---------------- virtual dispatch ----------------
machineDemo({
  slug: 'cpp-vtable',
  title: 'Virtual dispatch',
  group: G,
  details: DETAILS,
  summary: 's->area(): load the vptr, load the vtable slot, jump indirect; vs a direct, inlined call.',
  linkedFrom: ['C++'],
  inputs: [
    { id: 'circle', label: 's is a Circle', data: { obj: 'circle' } },
    { id: 'square', label: 's is a Square', data: { obj: 'square' } },
    { id: 'direct', label: 'Known type (final)', data: { obj: 'direct' } },
  ],
  build({ obj }: { obj: 'circle' | 'square' | 'direct' }) {
    const f = new Film();
    const direct = obj === 'direct';
    const sq = obj === 'square';
    const src = direct ? ['double f(const Circle* s) {   // Circle is final', '  return s->area();', '}'] : ['double f(const Shape* s) {', '  return s->area();', '}'];
    const asm = direct
      ? ['f(Circle const*):', '  movsd xmm0, QWORD PTR [rdi+8]', '  mulsd xmm0, xmm0', '  mulsd xmm0, QWORD PTR .LC0   ; π', '  ret']
      : ['f(Shape const*):', '  mov  rax, QWORD PTR [rdi]', '  jmp  QWORD PTR [rax+16]'];
    const draw = (stage: number) => {
      const out: Shape[] = [...code(src, 30, 40, stage > 0 ? [1] : [])];
      out.push(text('at', 20, 175, 'x86-64 -O2', { align: 'left', size: 24, bold: true, tone: 'write' }));
      out.push(...code(asm, 190, 38, direct ? (stage > 0 ? [1, 2, 3] : []) : stage === 1 ? [1] : stage === 2 ? [2] : [], 28, 'a'));
      const OY = 470;
      const objs: [string, string, number][] = [
        ['Circle', 'r = 2.0', OY],
        ['Square', 'side = 3.0', OY + 250],
      ];
      out.push(text('oh', 30, OY - 40, 'objects', { align: 'left', size: 26, bold: true }), text('vh', 370, OY - 40, 'vtables (.rodata)', { align: 'left', size: 26, bold: true }), text('fh', 720, OY - 40, 'code (.text)', { align: 'left', size: 26, bold: true }));
      objs.forEach(([name, field, y], i) => {
        const mine = (i === 0 && !sq) || (i === 1 && sq);
        out.push(text(`on${i}`, 30, y + 10, name, { align: 'left', size: 24, tone: 'muted' }));
        out.push(box(`vp${i}`, 30, y + 30, 270, 60, 'vptr', { mono: true, tone: mine && stage === 1 && !direct ? 'current' : 'default', dashed: direct }));
        out.push(box(`fd${i}`, 30, y + 94, 270, 60, field, { mono: true, tone: mine && direct && stage > 0 ? 'current' : 'default' }));
        const slots = [`~${name}()`, `~${name}() del`, `${name}::area`];
        slots.forEach((s, k) => out.push(box(`vt${i}-${k}`, 370, y + 10 + k * 62, 300, 56, s, { mono: true, sub: undefined, tone: mine && k === 2 && stage === 2 ? 'current' : 'default' })));
        out.push(text(`vo${i}`, 685, y + 10 + 2 * 62 + 28, '+16', { align: 'left', size: 24, mono: true, tone: 'muted' }));
        out.push(box(`fn${i}`, 740, y + 40, 240, 80, `${name}::area`, { mono: true, tone: mine && stage >= 3 ? 'current' : mine && direct && stage > 0 ? 'current' : 'default' }));
        out.push(arrow(`pv${i}`, 300, y + 60, 366, y + 38, mine && stage === 1 ? 'accent' : 'muted', { dashed: direct }));
        out.push(arrow(`pf${i}`, 670, y + 10 + 2 * 62 + 28, 736, y + 80, mine && stage >= 2 && !direct ? 'accent' : 'muted', { dashed: direct }));
      });
      const target = sq ? OY + 250 : OY;
      out.push(text('s', 330, 380, 's', { align: 'left', size: 30, bold: true, mono: true, tone: 'accent' }));
      out.push(arrow('sp', 336, 400, 304, target + 56, stage > 0 ? 'accent' : 'muted'));
      return out;
    };
    const pn = (stage: number): Panel =>
      panel('Call', [
        ['loads before call', direct ? 0 : Math.min(stage, 2)],
        ['branch', direct ? 'none (inlined)' : 'indirect'],
        ['inlinable', direct ? 'yes' : 'no', direct ? 'ok' : 'warn'],
        ['object size', '16 B'],
      ]);
    if (direct) {
      f.add('If the compiler knows the exact type (final class, or it can see the object), it skips the vtable.', draw(0), pn(0));
      f.add('The call is direct, so Circle::area is inlined: π·r² computed right here from the r field.', draw(1), pn(1));
      f.add('No vptr load, no table, no indirect branch, and the optimiser sees through the call. Devirtualisation is why final matters.', draw(1), pn(1));
      return f.frames;
    }
    const who = sq ? 'Square' : 'Circle';
    f.add(sq ? 'Same call site, but s now points to a Square.' : 'Each object starts with a hidden vptr; each class has one vtable of function pointers.', draw(0), pn(0));
    f.add('Load 1: read the vptr from the object at [rdi], where rdi = s.', draw(1), pn(1));
    f.add(`Load 2: slot 2 at [vptr + 16] holds the address of ${who}::area.`, draw(2), pn(2));
    f.add(`Indirect jump into ${who}::area. The CPU predicts the target from history, like any branch.`, draw(3), pn(3));
    f.add('Two dependent loads and an indirect branch: cheap when predicted. The real cost is that the call can’t be inlined.', draw(3), pn(3));
    return f.frames;
  },
});

// ---------------- threads & atomics ----------------
interface Cell {
  k: string;
  v: string;
  tone?: Tone;
}
interface Ev {
  core: 0 | 1 | -1;
  line: number;
  a: Cell[];
  b: Cell[];
  ram: Cell[];
  note: string;
}

const ATOMICS: Record<string, { codeA: string[]; codeB: string[]; intro: string; evs: Ev[]; expect: string; outro: string; result: (e: Ev) => string }> = {
  race: {
    codeA: ['// counter++ (plain int)', 'mov eax, [counter]', 'add eax, 1', 'mov [counter], eax'],
    codeB: ['// counter++ (plain int)', 'mov eax, [counter]', 'add eax, 1', 'mov [counter], eax'],
    intro: 'Two threads each run counter++ once on a plain int. counter++ is three instructions.',
    expect: '2',
    evs: [
      { core: 0, line: 1, a: [{ k: 'eax', v: '0', tone: 'write' }, { k: 'L1 line', v: 'E · 0' }], b: [{ k: 'eax', v: '—' }, { k: 'L1 line', v: 'I' }], ram: [{ k: 'counter', v: '0' }], note: 'Thread A loads counter = 0 into its register.' },
      { core: 1, line: 1, a: [{ k: 'eax', v: '0' }, { k: 'L1 line', v: 'S · 0' }], b: [{ k: 'eax', v: '0', tone: 'write' }, { k: 'L1 line', v: 'S · 0' }], ram: [{ k: 'counter', v: '0' }], note: 'Thread B loads it too, before A has written. Both saw 0.' },
      { core: 0, line: 2, a: [{ k: 'eax', v: '1', tone: 'write' }, { k: 'L1 line', v: 'S · 0' }], b: [{ k: 'eax', v: '0' }, { k: 'L1 line', v: 'S · 0' }], ram: [{ k: 'counter', v: '0' }], note: 'A adds 1 in its register.' },
      { core: 1, line: 2, a: [{ k: 'eax', v: '1' }, { k: 'L1 line', v: 'S · 0' }], b: [{ k: 'eax', v: '1', tone: 'write' }, { k: 'L1 line', v: 'S · 0' }], ram: [{ k: 'counter', v: '0' }], note: 'B adds 1 in its own register.' },
      { core: 0, line: 3, a: [{ k: 'eax', v: '1' }, { k: 'L1 line', v: 'M · 1', tone: 'write' }], b: [{ k: 'eax', v: '1' }, { k: 'L1 line', v: 'I', tone: 'fail' }], ram: [{ k: 'counter', v: '1' }], note: 'A stores 1: its core takes the line Modified and invalidates B’s copy (MESI).' },
      { core: 1, line: 3, a: [{ k: 'eax', v: '1' }, { k: 'L1 line', v: 'I', tone: 'fail' }], b: [{ k: 'eax', v: '1' }, { k: 'L1 line', v: 'M · 1', tone: 'write' }], ram: [{ k: 'counter', v: '1', tone: 'fail' }], note: 'B stores its stale 1 over A’s. One increment is lost.' },
    ],
    outro: 'Two increments, counter = 1. A data race is undefined behaviour in C++; in practice it loses updates like this.',
    result: (e) => e.ram[0].v,
  },
  atomic: {
    codeA: ['// counter.fetch_add(1)', 'mov eax, 1', 'lock xadd [counter], eax'],
    codeB: ['// counter.fetch_add(1)', 'mov eax, 1', 'lock xadd [counter], eax'],
    intro: 'Same increments on std::atomic<int>. fetch_add becomes one locked instruction.',
    expect: '2',
    evs: [
      { core: 0, line: 2, a: [{ k: 'eax', v: '0 (old)', tone: 'write' }, { k: 'L1 line', v: 'M · 1', tone: 'write' }], b: [{ k: 'eax', v: '1' }, { k: 'L1 line', v: 'I' }], ram: [{ k: 'counter', v: '1' }], note: 'A’s core takes the line Modified and holds it for the whole read-add-write. Nobody can sneak in.' },
      { core: 1, line: 2, a: [{ k: 'eax', v: '0 (old)' }, { k: 'L1 line', v: 'I', tone: 'fail' }], b: [{ k: 'eax', v: '1 (old)', tone: 'write' }, { k: 'L1 line', v: 'M · 2', tone: 'write' }], ram: [{ k: 'counter', v: '2', tone: 'ok' }], note: 'B must first pull the line over from A (~50 ns), then adds: 2.' },
    ],
    outro: 'Correct, but every increment moves the cache line between cores. Hot shared counters don’t scale: shard them per thread.',
    result: (e) => e.ram[0].v,
  },
  publish: {
    codeA: ['data = 42;', 'ready.store(true, release);'],
    codeB: ['while (!ready.load(acquire));', 'use(data);'],
    intro: 'A publishes data to B through an atomic flag. Ordering, not atomicity, is the question here.',
    expect: '42',
    evs: [
      { core: 1, line: 0, a: [], b: [{ k: 'sees ready', v: 'false' }, { k: 'sees data', v: '—' }], ram: [{ k: 'data', v: '0' }, { k: 'ready', v: 'false' }], note: 'B spins, reading ready = false.' },
      { core: 0, line: 0, a: [{ k: 'wrote', v: 'data = 42', tone: 'write' }], b: [{ k: 'sees ready', v: 'false' }, { k: 'sees data', v: '—' }], ram: [{ k: 'data', v: '42', tone: 'write' }, { k: 'ready', v: 'false' }], note: 'A writes data, a plain int.' },
      { core: 0, line: 1, a: [{ k: 'wrote', v: 'ready = true', tone: 'write' }], b: [{ k: 'sees ready', v: 'false' }, { k: 'sees data', v: '—' }], ram: [{ k: 'data', v: '42' }, { k: 'ready', v: 'true', tone: 'write' }], note: 'Release store: every write before it, data included, becomes visible no later than ready.' },
      { core: 1, line: 0, a: [], b: [{ k: 'sees ready', v: 'true', tone: 'ok' }, { k: 'sees data', v: '—' }], ram: [{ k: 'data', v: '42' }, { k: 'ready', v: 'true' }], note: 'The acquire load sees true and pairs with the release.' },
      { core: 1, line: 1, a: [], b: [{ k: 'sees ready', v: 'true' }, { k: 'sees data', v: '42', tone: 'ok' }], ram: [{ k: 'data', v: '42' }, { k: 'ready', v: 'true' }], note: 'So B is guaranteed to read data = 42, never a stale 0.' },
    ],
    outro: 'With relaxed ordering an ARM core may see ready before data. On x86 stores are already ordered, so release and acquire only stop the compiler reordering.',
    result: (e) => e.b[1]?.v ?? '—',
  },
};

machineDemo({
  slug: 'cpp-atomics',
  title: 'Threads, atomics & ordering',
  group: G,
  details: DETAILS,
  summary: 'counter++ races and loses updates; std::atomic fetch_add via lock xadd and MESI; release/acquire publishing.',
  linkedFrom: ['C++', 'CPU'],
  inputs: [
    { id: 'race', label: 'Plain int race', data: { p: 'race' } },
    { id: 'atomic', label: 'std::atomic', data: { p: 'atomic' } },
    { id: 'publish', label: 'Release / acquire', data: { p: 'publish' } },
  ],
  build({ p }: { p: string }) {
    const A = ATOMICS[p];
    const f = new Film();
    const draw = (e?: Ev) => {
      const out: Shape[] = [];
      ([A.codeA, A.codeB] as const).forEach((src, c) => {
        const x = c === 0 ? 20 : 510;
        const on = e?.core === c;
        out.push(box(`core${c}`, x, 20, 470, 700, undefined, { tone: on ? 'current' : 'default', filled: false }));
        out.push(text(`ch${c}`, x + 20, 56, `core ${c} · thread ${c ? 'B' : 'A'}`, { align: 'left', size: 28, bold: true, tone: on ? 'current' : undefined }));
        src.forEach((l, i) => {
          const y = 110 + i * 50;
          if (on && e!.line === i) out.push(box(`h${c}-${i}`, x + 8, y - 22, 454, 44, undefined, { tone: 'write' }));
          const sz = Math.max(24, Math.min(26, Math.floor(430 / (0.6 * l.length) / 2) * 2));
          out.push(text(`c${c}-${i}`, x + 20, y, l, { align: 'left', size: sz, mono: true, tone: l.startsWith('//') ? 'muted' : undefined }));
        });
        (e ? (c ? e.b : e.a) : []).forEach((cell, i) => out.push(box(`s${c}-${i}`, x + 20, 380 + i * 110, 430, 90, cell.v, { sub: cell.k, mono: true, tone: cell.tone ?? 'default' })));
      });
      out.push(text('rt', 20, 770, 'memory (coherent value)', { align: 'left', size: 26, bold: true, tone: 'read' }));
      const ram: Cell[] = e?.ram ?? A.evs[0].ram.map((r) => ({ k: r.k, v: r.k === 'ready' ? 'false' : '0' }));
      ram.forEach((r, i) => out.push(box(`ram${i}`, 20 + i * 490, 800, 470, 100, r.v, { sub: r.k, mono: true, tone: r.tone ?? 'read' })));
      return out;
    };
    const pn = (e?: Ev): Panel => panel('Result', [['expected', A.expect], ['observed', e ? A.result(e) : '—', e && e === A.evs[A.evs.length - 1] ? (A.result(e) === A.expect ? 'ok' : 'fail') : undefined]]);
    f.add(A.intro, draw(), pn());
    A.evs.forEach((e) => f.add(e.note, draw(e), pn(e)));
    const last = A.evs[A.evs.length - 1];
    f.add(A.outro, draw({ ...last, core: -1 }), pn(last));
    return f.frames;
  },
});

// ---------------- what C++ compiles to ----------------
const CODEGEN: Record<string, CodeMap> = {
  template: {
    srcTitle: 'C++',
    asmTitle: 'x86-64 · g++ -O2',
    src: ['template <class T>', 'T twice(T x) { return x + x; }', '', 'int    f(int a)    { return twice(a); }', 'double g(double b) { return twice(b); }'],
    asm: ['f(int):', '  lea   eax, [rdi+rdi]', '  ret', 'g(double):', '  addsd xmm0, xmm0', '  ret'],
    intro: 'A template is a recipe, not code: on its own it emits nothing.',
    steps: [
      { src: [3], asm: [0, 1, 2], note: 'twice<int> is stamped out for f and inlined: x + x on an int becomes one lea.' },
      { src: [4], asm: [3, 4, 5], note: 'twice<double> is a separate instantiation: addsd on an SSE register.' },
    ],
    outro: 'Each type gets its own specialised code with no runtime type checks. The cost is compile time and binary size.',
  },
  rangefor: {
    srcTitle: 'C++',
    asmTitle: 'x86-64 · g++ -O2',
    src: ['int sum(const std::vector<int>& v) {', '  int s = 0;', '  for (int x : v)', '    s += x;', '  return s;', '}'],
    asm: ['sum(std::vector<int> const&):', '  mov  rax, QWORD PTR [rdi]', '  mov  rcx, QWORD PTR [rdi+8]', '  xor  edx, edx', '  cmp  rcx, rax', '  je   .L1', '.L3:', '  add  edx, DWORD PTR [rax]', '  add  rax, 4', '  cmp  rcx, rax', '  jne  .L3', '.L1:', '  mov  eax, edx', '  ret'],
    intro: 'A range-for over a vector: iterators, begin(), end(), operator++ and operator*, all templates.',
    steps: [
      { src: [0], asm: [1, 2], note: 'A vector is begin, end and capacity pointers. Load begin and end.' },
      { src: [1], asm: [3], note: 's lives in edx.' },
      { src: [2], asm: [4, 5], note: 'Empty vector? Skip the loop.' },
      { src: [3], asm: [7], note: 's += x: one add straight from memory.' },
      { src: [2], asm: [8, 9, 10], note: '++it is pointer += 4 and it != end is one compare. The iterator is gone.' },
      { src: [4], asm: [12, 13], note: 'Move s into the return register.' },
    ],
    outro: 'The same 4-instruction loop as hand-written C with pointers. That is what zero-cost abstraction means.',
  },
  overflow: {
    srcTitle: 'C++',
    asmTitle: 'x86-64 · g++ -O2',
    src: ['bool always(int x) {', '  return x + 1 > x;', '}'],
    asm: ['always(int):', '  mov   eax, 1', '  ret', '; same code with -fwrapv:', '  cmp   edi, 2147483647', '  setne al', '  ret'],
    intro: 'For x = INT_MAX, x + 1 wraps on the hardware. So is this ever false?',
    steps: [
      { src: [1], asm: [1, 2], note: 'Signed overflow is UB, so the compiler may assume x + 1 never wraps. Then the answer is always true.' },
      { src: [1], asm: [4, 5, 6], note: 'With -fwrapv overflow is defined to wrap, and the honest code returns false for INT_MAX.' },
    ],
    outro: 'UB is not whatever the hardware does. It is a promise to the optimiser, and the optimiser uses it.',
  },
  nullcheck: {
    srcTitle: 'C++',
    asmTitle: 'x86-64 · g++ -O2',
    src: ['int get(int* p) {', '  int v = *p;', '  if (!p) return -1;', '  return v;', '}'],
    asm: ['get(int*):', '  mov  eax, DWORD PTR [rdi]', '  ret'],
    intro: 'The null check comes after the dereference.',
    steps: [
      { src: [1], asm: [1], note: 'Load *p.' },
      { src: [2], asm: [1], note: 'p was already dereferenced and a null dereference is UB, so p cannot be null. The check is deleted.' },
      { src: [3], asm: [2], note: 'Return v.' },
    ],
    outro: 'This pattern once removed a null check in the Linux kernel. Check before you dereference.',
  },
};

machineDemo({
  slug: 'cpp-codegen',
  title: 'What C++ compiles to',
  group: G,
  details: DETAILS,
  summary: 'Templates instantiate per type, range-for becomes a pointer loop, and UB lets the optimiser delete code.',
  linkedFrom: ['C++'],
  inputs: [
    { id: 'template', label: 'Templates', data: { m: 'template' } },
    { id: 'rangefor', label: 'Zero-cost range-for', data: { m: 'rangefor' } },
    { id: 'overflow', label: 'UB: x + 1 > x', data: { m: 'overflow' } },
    { id: 'nullcheck', label: 'UB: late null check', data: { m: 'nullcheck' } },
  ],
  build: ({ m }: { m: string }) => codeMapFrames(CODEGEN[m]),
});
