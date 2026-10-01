// I/O scenes: sockets as kernel buffers that fill as packets arrive, one thread that walks between them or sleeps,
// an optional epoll ready list, and a CPU-time strip that records what the core spent each moment on.
import type { Detail, Frame, Shape, Tone } from '../../algo/frames';
import { box, dot, Film, framesDemo, panel, text } from './draw';
import type { Row } from './draw';

export type Cpu = 'work' | 'waste' | 'sleep';
const CPU_TONE: Record<Cpu, Tone> = { work: 'ok', waste: 'fail', sleep: 'muted' };

interface Sock {
  fd: string;
  kb: number;
  open: boolean;
  tone?: Tone;
  tag?: string;
}

interface Shot {
  note: string;
  socks: Sock[];
  /** thread column (fd) or null for "in epoll_wait / idle" */
  at: string | null;
  state: string;
  call: string;
  tone: Tone;
  ready: string[];
  cpu: Cpu[];
  arrive: [fd: string, n: number][];
  take: [fd: string, n: number][];
  rows?: Row[];
}

export class Io {
  private socks: Sock[];
  private at: string | null = null;
  private state = 'idle';
  private call = '';
  private tone: Tone = 'default';
  private readyList: string[] = [];
  private cpu: Cpu[] = [];
  private arrive: [string, number][] = [];
  private take: [string, number][] = [];
  private shots: Shot[] = [];

  /** fds starting with `+` are closed until `open()` */
  constructor(fds: string[], private o: { epoll?: boolean; cap?: number; unit?: string; details?: Record<string, Detail>; panel?: string } = {}) {
    this.socks = fds.map((f) => ({ fd: f.replace(/^\+/, ''), kb: 0, open: !f.startsWith('+') }));
  }

  private sock(fd: string) {
    return this.socks.find((s) => s.fd === fd)!;
  }

  /** bytes (in units) land in fd's buffer, drawn as packets falling from the network */
  in(fd: string, n: number) {
    this.sock(fd).kb += n;
    this.arrive.push([fd, n]);
    return this;
  }

  /** the thread reads n units from fd's buffer */
  read(fd: string, n: number) {
    const s = this.sock(fd);
    const k = Math.min(n, s.kb);
    s.kb -= k;
    if (k) this.take.push([fd, k]);
    return this;
  }

  open(fd: string) {
    this.sock(fd).open = true;
    return this;
  }

  /** move the thread: under a socket, or null for the middle */
  thread(at: string | null, state: string, call = '', tone: Tone = 'default') {
    this.at = at;
    this.state = state;
    this.call = call;
    this.tone = tone;
    return this;
  }

  ready(fds: string[]) {
    this.readyList = fds;
    return this;
  }

  mark(fd: string, tone?: Tone, tag?: string) {
    const s = this.sock(fd);
    s.tone = tone;
    s.tag = tag;
    return this;
  }

  /** append CPU time slices */
  cpuUse(kind: Cpu, n = 1) {
    for (let i = 0; i < n; i++) this.cpu.push(kind);
    return this;
  }

  snap(note: string, rows?: Row[]) {
    this.shots.push({ note, socks: this.socks.map((s) => ({ ...s })), at: this.at, state: this.state, call: this.call, tone: this.tone, ready: [...this.readyList], cpu: [...this.cpu], arrive: this.arrive, take: this.take, rows });
    this.arrive = [];
    this.take = [];
    return this;
  }

  frames(): Frame[] {
    const ep = !!this.o.epoll;
    const cap = this.o.cap ?? 4;
    const unit = this.o.unit ?? 'KB';
    const n = this.socks.length;
    const pitch = 920 / n;
    const sw = Math.min(190, pitch - 24);
    const colX = (i: number) => 40 + i * pitch + (pitch - sw) / 2;
    const kTop = 96;
    const sTop = kTop + 50;
    const sH = ep ? 220 : 250;
    const kBot = ep ? sTop + sH + 110 : sTop + sH + 24;
    const uTop = kBot + 16;
    const tY = uTop + 56;
    const tH = ep ? 120 : 150;
    const uBot = tY + tH + 22;
    const cTop = uBot + 16;
    const ticks = Math.max(1, ...this.shots.map((s) => s.cpu.length));
    const tw = Math.min(60, 900 / ticks);
    const film = new Film();
    let pk = 0;
    for (const sh of this.shots) {
      const out: Shape[] = [];
      const from: Record<string, { x: number; y: number }> = {};
      out.push(text('net', 40, 46, 'network', { align: 'left', size: 24, bold: true, tone: 'muted' }));
      out.push(box('kb', 20, kTop, 960, kBot - kTop, undefined, { tone: 'muted', filled: false }));
      out.push(text('kt', 40, kTop + 26, 'kernel · socket receive buffers', { align: 'left', size: 24, bold: true, tone: 'muted' }));
      const wellTop = (i: number) => ({ x: colX(i) + 14, y: sTop + 56, w: sw - 28, h: sH - 76 });
      sh.socks.forEach((s, i) => {
        if (!s.open) return;
        const x = colX(i);
        const rd = sh.ready.includes(s.fd);
        const b = box(`s-${s.fd}`, x, sTop, sw, sH, undefined, { tone: s.tone ?? (rd ? 'accent' : 'default') });
        const d = this.o.details?.[s.fd] ?? this.o.details?.socket;
        if (d && b.t === 'rect') b.detail = d;
        out.push(b);
        out.push(text(`sl-${s.fd}`, x + sw / 2, sTop + 28, s.fd, { size: 26, bold: true, mono: true }));
        const w = wellTop(i);
        out.push(box(`w-${s.fd}`, w.x, w.y, w.w, w.h, undefined, { tone: 'muted', filled: false }));
        const fh = Math.max(0, (Math.min(cap, s.kb) / cap) * (w.h - 8));
        out.push(box(`f-${s.fd}`, w.x + 4, w.y + w.h - 4 - fh, w.w - 8, fh, undefined, { tone: s.kb ? 'read' : 'muted' }));
        out.push(text(`fk-${s.fd}`, x + sw / 2, w.y + w.h / 2, s.kb ? `${s.kb} ${unit}` : 'empty', { size: 24, mono: true, tone: s.kb ? undefined : 'muted' }));
        if (s.tag) out.push(text(`tg-${s.fd}`, x + sw / 2, w.y + 24, s.tag, { size: 24, bold: true, tone: s.tone ?? 'warn' }));
      });
      for (const [fd, k] of sh.arrive) {
        const i = this.socks.findIndex((s) => s.fd === fd);
        const w = wellTop(i);
        for (let j = 0; j < Math.min(3, k); j++) {
          const id = `pk-${pk++}`;
          const x = w.x + w.w / 2 + (j - 1) * 22;
          out.push(dot(id, x, w.y + w.h - 18, 'read', undefined, 10));
          from[id] = { x, y: 66 };
        }
      }
      if (ep) {
        const ry = sTop + sH + 30;
        out.push(text('rlt', 40, ry + 34, 'epoll ready list', { align: 'left', size: 24, bold: true, tone: 'muted' }));
        out.push(box('rl', 260, ry, 700, 68, undefined, { tone: sh.ready.length ? 'accent' : 'muted', filled: false }));
        if (!sh.ready.length) out.push(text('rle', 610, ry + 34, 'empty', { size: 24, tone: 'muted' }));
        sh.ready.forEach((fd, j) => {
          const r = box(`rc-${fd}`, 276 + j * 150, ry + 10, 136, 48, fd, { tone: 'accent', mono: true });
          if (r.t === 'rect') r.detail = this.o.details?.ready;
          out.push(r);
        });
      }
      out.push(box('ub', 20, uTop, 960, uBot - uTop, undefined, { tone: 'muted', filled: false }));
      out.push(text('ut', 40, uTop + 26, 'your process · one thread', { align: 'left', size: 24, bold: true, tone: 'muted' }));
      const ti = sh.at ? this.socks.findIndex((s) => s.fd === sh.at) : -1;
      const tw2 = Math.max(sw, 260);
      const tx = ti >= 0 ? Math.min(980 - tw2, Math.max(20, colX(ti) + sw / 2 - tw2 / 2)) : 500 - tw2 / 2;
      const tb = box('thr', tx, tY, tw2, tH, sh.state, { tone: sh.tone, sub: sh.call || undefined });
      if (tb.t === 'rect') tb.detail = this.o.details?.thread;
      out.push(tb);
      if (ti >= 0) out.push({ t: 'line', id: `tl-${sh.at}`, x1: colX(ti) + sw / 2, y1: tY - 4, x2: colX(ti) + sw / 2, y2: sTop + sH + 4, tone: sh.tone === 'muted' ? 'muted' : 'accent', width: 4, dashed: sh.tone === 'muted' });
      else if (ep) out.push({ t: 'line', id: 'tl-ep', x1: 500, y1: tY - 4, x2: 500, y2: sTop + sH + 98, tone: sh.ready.length ? 'accent' : 'muted', width: 4, dashed: !sh.ready.length });
      for (const [fd, k] of sh.take) {
        const i = this.socks.findIndex((s) => s.fd === fd);
        const w = wellTop(i);
        for (let j = 0; j < Math.min(3, k); j++) {
          const id = `pk-${pk++}`;
          const x = tx + tw2 / 2 + (j - 1) * 24;
          out.push(dot(id, x, tY + tH - 18, 'ok', undefined, 10));
          from[id] = { x: w.x + w.w / 2 + (j - 1) * 22, y: w.y + w.h - 18 };
        }
      }
      out.push(text('ct', 40, cTop + 18, 'CPU time on this core', { align: 'left', size: 24, bold: true, tone: 'muted' }));
      const sy = cTop + 40;
      out.push(box('cs', 40, sy, 920, 64, undefined, { tone: 'muted', filled: false }));
      sh.cpu.forEach((c, j) => out.push({ t: 'line', id: `cp-${j}`, x1: 50 + j * tw + 2, y1: sy + 32, x2: 50 + (j + 1) * tw - 2, y2: sy + 32, tone: CPU_TONE[c], width: 44 }));
      const used = (['work', 'waste', 'sleep'] as Cpu[]).filter((c) => this.shots.some((x) => x.cpu.includes(c)));
      const lab: Record<Cpu, string> = { work: 'useful work', waste: 'wasted (EAGAIN)', sleep: 'asleep · core free' };
      used.forEach((c, j) => {
        out.push({ t: 'line', id: `lg-${c}`, x1: 40 + j * 310, y1: sy + 100, x2: 68 + j * 310, y2: sy + 100, tone: CPU_TONE[c], width: 26 });
        out.push(text(`lt-${c}`, 80 + j * 310, sy + 100, lab[c], { align: 'left', size: 24 }));
      });
      film.add(sh.note, out, sh.rows ? panel(this.o.panel ?? 'I/O', sh.rows) : undefined, from);
    }
    return film.frames;
  }
}

/** One demo, one I/O scene per input: `scenes[id] = [chip label, build]`. */
export function ioDemo(group: string, slug: string, title: string, summary: string, scenes: Record<string, [label: string, build: () => Io]>) {
  framesDemo(group, slug, title, summary, Object.fromEntries(Object.entries(scenes).map(([id, [label, b]]) => [id, [label, () => b().frames()]])));
}
