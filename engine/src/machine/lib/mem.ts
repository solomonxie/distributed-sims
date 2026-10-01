// Memory-map scenes: variables are boxes with real-looking addresses, grouped in regions (stack frames, heap).
// A pointer box holds another box's address and draws an arrow to it; a highlight hops along arrows on each `*`.
// One statement is shown as a caption; the picture, not the listing, carries the lesson.
import type { Detail, Frame, Shape, Tone } from '../../algo/frames';
import { box, Film, framesDemo, panel, text } from './draw';
import type { Row } from './draw';

interface Cell {
  id: string;
  region: string;
  slot: number;
  name: string;
  addr: string;
  val: string;
  /** levels of indirection: 0 value, 1 pointer, 2 pointer to pointer */
  lv: number;
  to?: string;
  /** non-owning link (weak_ptr): drawn dashed */
  weak?: boolean;
  dead?: boolean;
}

interface Region {
  id: string;
  title: string;
  tight?: boolean;
  dead?: boolean;
}

export interface MemSnap {
  /** cell the highlight sits on; null hides it */
  finger?: string | null;
  hot?: Record<string, Tone>;
  rows?: Row[];
  /** [from, to]: a copy of the value glides from one box to the other; `x.addr` starts at x's address label */
  fly?: [string, string];
  /** big expression line under a single region, e.g. the step-by-step rewrite of **pp */
  eq?: string;
  out?: string;
}

interface Shot {
  note: string;
  code?: string;
  s: MemSnap;
  cells: Cell[];
  regions: Region[];
  finger?: string;
  was?: string;
  changed: Set<string>;
}

const LV_TONE: Tone[] = ['default', 'accent', 'protocol', 'protocol'];

export class Mem {
  private cells = new Map<string, Cell>();
  private regions: Region[] = [];
  private shots: Shot[] = [];
  private changed = new Set<string>();
  private finger?: string;

  constructor(private o: { panel?: string; details?: Record<string, Detail>; out?: boolean } = {}) {}

  region(id: string, title: string, o: { tight?: boolean } = {}) {
    this.regions.push({ id, title, ...o });
    return this;
  }

  /** marks a region and its boxes dead (a returned stack frame, a freed block) */
  kill(region: string, title?: string) {
    const r = this.regions.find((x) => x.id === region)!;
    r.dead = true;
    if (title) r.title = title;
    for (const c of this.cells.values()) if (c.region === region) c.dead = true;
    return this;
  }

  /** reuses a dead region for something new (the next call lands in the same stack slots) */
  revive(region: string, title: string) {
    const r = this.regions.find((x) => x.id === region)!;
    r.dead = false;
    r.title = title;
    for (const [id, c] of this.cells) if (c.region === region) this.cells.delete(id);
    return this;
  }

  drop(region: string) {
    this.regions = this.regions.filter((x) => x.id !== region);
    for (const [id, c] of this.cells) if (c.region === region) this.cells.delete(id);
    return this;
  }

  v(id: string, region: string, slot: number, name: string, addr: string, val: string, o: { lv?: number; to?: string; weak?: boolean } = {}) {
    this.cells.set(id, { id, region, slot, name, addr, val, lv: o.lv ?? (o.to || o.weak ? 1 : 0), to: o.to, weak: o.weak });
    this.changed.add(id);
    return this;
  }

  set(id: string, val: string, to?: string | null) {
    const c = this.cells.get(id)!;
    c.val = val;
    if (to !== undefined) c.to = to ?? undefined;
    this.changed.add(id);
    return this;
  }

  /** marks one box dead (a freed heap block) */
  free(id: string) {
    this.cells.get(id)!.dead = true;
    return this;
  }

  /** removes one box */
  gone(id: string) {
    this.cells.delete(id);
    return this;
  }

  rename(id: string, name: string) {
    this.cells.get(id)!.name = name;
    return this;
  }

  snap(note: string, code?: string, s: MemSnap = {}) {
    const was = this.finger;
    if (s.finger !== undefined) this.finger = s.finger ?? undefined;
    this.shots.push({ note, code, s, cells: [...this.cells.values()].map((c) => ({ ...c })), regions: this.regions.map((r) => ({ ...r })), finger: this.finger, was, changed: this.changed });
    this.changed = new Set();
    return this;
  }

  frames(): Frame[] {
    const shots = this.shots;
    const top = shots.some((x) => x.code !== undefined) ? 104 : 20;
    const bottom = this.o.out ? 785 : 985;
    const slots = Math.max(1, ...shots.flatMap((x) => x.cells.map((c) => c.slot + 1)));
    const nreg = Math.max(1, ...shots.map((x) => x.regions.length));
    const tightOnly = shots.every((x) => x.regions.every((r) => r.tight));
    const k = Math.min(1.6, 920 / (slots * (tightOnly ? 130 : 150)), (bottom - top) / (nreg * 226));
    const x0 = (1000 - slots * (tightOnly ? 130 : 150) * k) / 2 + (tightOnly ? 0 : 10 * k);
    const rh = Math.min(330, (bottom - top - 12 * (nreg - 1)) / nreg);
    const ch = 96 * k;
    const fs = (n: number) => Math.min(56, Math.round(n * k));
    const ver: Record<string, number> = {};
    const film = new Film();
    let flyN = 0;

    let prev: Map<string, Cell> = new Map();
    for (const sh of shots) {
      const s = sh.s;
      const byId = new Map(sh.cells.map((c) => [c.id, c]));
      const geom = (c: Cell) => {
        const ri = sh.regions.findIndex((r) => r.id === c.region);
        const r = sh.regions[ri];
        const pitch = (r.tight ? 130 : 150) * k;
        const w = pitch - (r.tight ? 0 : 20 * k);
        const x = x0 + c.slot * pitch;
        const y = top + ri * (rh + 12) + rh / 2 - ch / 2 + 10 * k;
        return { x, y, w, h: ch, cx: x + w / 2, cy: y + ch / 2 };
      };
      const out: Shape[] = [];
      const from: Record<string, { x: number; y: number } & Record<string, unknown>> = {};
      if (sh.code !== undefined) out.push(box('cap', 20, 16, 960, 70, undefined, { tone: 'muted' }), text('capt', 44, 51, sh.code, { align: 'left', size: 28, mono: true }));
      sh.regions.forEach((r, i) => {
        const y = top + i * (rh + 12);
        out.push(box(`rg-${r.id}`, 20, y, 960, rh, undefined, { tone: r.dead ? 'fail' : 'muted', filled: false, dashed: r.dead }));
        out.push(text(`rt-${r.id}`, 40, y + 26, r.title, { align: 'left', size: 24, bold: true, tone: r.dead ? 'fail' : 'muted' }));
      });
      const fc = sh.finger ? byId.get(sh.finger) : undefined;
      if (fc) {
        const g = geom(fc);
        out.push(box('finger', g.x - 8, g.y - 8, g.w + 16, g.h + 16, undefined, { tone: 'current' }));
      }
      for (const c of sh.cells) {
        const t = c.to ? byId.get(c.to) : undefined;
        if (!t) continue;
        const a = geom(c);
        const b = geom(t);
        const bad = !!t.dead && !c.dead;
        const hot = sh.was === c.id && sh.finger === t.id;
        const tone: Tone = bad ? 'fail' : hot ? 'current' : c.dead ? 'muted' : LV_TONE[c.lv];
        const e = { t: 'edge' as const, id: `ar-${c.id}-${t.id}`, arrow: true, tone: c.weak && !bad && !hot ? ('muted' as Tone) : tone, dashed: bad || c.dead || c.weak, width: hot ? 7 : 4 };
        if (a.y === b.y) {
          const dx = b.cx - a.cx;
          out.push({ ...e, from: { x: a.cx, y: a.y + a.h + 2 }, to: { x: b.cx + (dx > 0 ? -12 : 12), y: b.y + b.h + 4 }, bend: Math.sign(dx) * Math.min(55 * k, 26 + Math.abs(dx) * 0.12) });
        } else if (b.y > a.y) out.push({ ...e, from: { x: a.cx, y: a.y + a.h + 2 }, to: { x: b.x + b.w * 0.8, y: b.y - 4 } });
        else out.push({ ...e, from: { x: a.cx, y: a.y - 2 }, to: { x: b.cx, y: b.y + b.h + 4 } });
      }
      const pointedBy = new Map<string, Cell>();
      for (const c of sh.cells) if (c.to && !c.dead && !pointedBy.has(c.to)) pointedBy.set(c.to, c);
      for (const c of sh.cells) {
        const g = geom(c);
        const changed = sh.changed.has(c.id);
        if (changed) ver[c.id] = (ver[c.id] ?? 0) + 1;
        const tone: Tone = s.hot?.[c.id] ?? (c.dead ? 'visited' : changed ? 'write' : LV_TONE[c.lv]);
        const b = box(`cell-${c.id}`, g.x, g.y, g.w, g.h, undefined, { tone, dashed: c.dead });
        const d = this.o.details?.[c.id];
        if (d && b.t === 'rect') b.detail = d;
        out.push(b);
        out.push(text(`val-${c.id}-${ver[c.id] ?? 0}`, g.cx, g.cy - 10 * k, c.val, { size: fs(c.val.length > 6 ? 24 : 30), mono: true, tone: c.dead ? 'muted' : undefined }));
        out.push(text(`nm-${c.id}`, g.x + 2, g.y - 18 * k, c.name, { align: 'left', size: fs(24), bold: true, tone: c.dead ? 'muted' : c.lv ? LV_TONE[c.lv] : undefined }));
        const by = pointedBy.get(c.id);
        out.push(text(`ad-${c.id}`, g.cx, g.y + g.h - 17 * k, c.addr, { size: fs(20), mono: true, tone: by ? LV_TONE[by.lv] : 'muted' }));
      }
      if (s.fly) {
        const fly = s.fly;
        const [srcId, part] = fly[0].split('.');
        const gs = geom(byId.get(srcId)!);
        const dst = byId.get(fly[1])!;
        const gd = geom(dst);
        const id = `fly-${flyN++}`;
        const size = fs(dst.val.length > 6 ? 24 : 30);
        out.push(text(id, gd.cx, gd.cy - 10 * k, dst.val, { size, mono: true, bold: true, tone: 'current' }));
        // starts as a twin of the source label, so it is invisible until it moves
        const src = byId.get(srcId)!;
        if (part === 'addr') {
          const by = sh.cells.find((c) => c.to === srcId && !c.dead && c.id !== fly[1]);
          from[id] = { x: gs.cx, y: gs.y + gs.h - 17 * k, size: Math.max(24, fs(20)), bold: false, tone: by ? LV_TONE[by.lv] : 'muted' };
        } else {
          const was = prev.get(srcId)?.val ?? src.val;
          from[id] = { x: gs.cx, y: gs.cy - 10 * k, size: Math.max(24, fs(was.length > 6 ? 24 : 30)), bold: false, tone: undefined, text: was };
        }
      }
      if (s.eq && sh.regions.length === 1) out.push(text('eq', 500, (top + rh + bottom) / 2, s.eq, { size: 48, mono: true, bold: true, tone: 'current' }));
      if (this.o.out) {
        out.push(box('out', 20, 800, 960, 185, undefined, { tone: 'muted', filled: false }));
        out.push(text('oh', 40, 828, 'output', { align: 'left', size: 24, bold: true, tone: 'muted' }));
        (s.out ?? '').split('\n').slice(-3).forEach((l, i) => out.push(text(`o${i}`, 40, 870 + i * 36, l, { align: 'left', size: 28, mono: true })));
      }
      film.add(sh.note, out, s.rows ? panel(this.o.panel ?? 'Memory', s.rows) : undefined, from);
      prev = byId;
    }
    return film.frames;
  }
}

/** One demo, one memory scene per input: `scenes[id] = [chip label, build]`. */
export function memDemo(group: string, slug: string, title: string, summary: string, scenes: Record<string, [label: string, build: () => Mem]>) {
  framesDemo(group, slug, title, summary, Object.fromEntries(Object.entries(scenes).map(([id, [label, b]]) => [id, [label, () => b().frames()]])));
}
