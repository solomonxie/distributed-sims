// Number pictures: a bit strip (one cell per bit, weights underneath) and a wrap-around ring (a value is a needle on 0 … 2^w − 1).
import type { Shape, Tone } from '../../algo/frames';
import { arrow, box, dot, line, text } from './draw';

export const mask = (v: number, w: number) => ((v % 2 ** w) + 2 ** w) % 2 ** w;
export const asSigned = (v: number, w: number) => (v >= 2 ** (w - 1) ? v - 2 ** w : v);

interface StripOpts {
  /** tone per bit index (0 = least significant) */
  tone?: (bit: number, on: boolean) => Tone;
  /** a dropped carry/borrow cell drawn left of the strip */
  carry?: boolean;
  weights?: boolean;
}

/** `w` cells, most significant first, `width` wide in total; cells are square-ish, labels sit under them. */
export function bitStrip(prefix: string, v: number, w: number, x: number, y: number, width: number, o: StripOpts = {}): Shape[] {
  const cw = width / w;
  const h = Math.min(90, cw * 0.9);
  const out: Shape[] = [];
  for (let i = 0; i < w; i++) {
    const bit = w - 1 - i;
    const on = ((v >>> bit) & 1) === 1;
    const tone = o.tone?.(bit, on) ?? (on ? 'accent' : 'default');
    out.push(box(`${prefix}b${bit}`, x + i * cw + 3, y, cw - 6, h, on ? '1' : '0', { mono: true, tone }));
    if (o.weights !== false && w <= 8) out.push(text(`${prefix}w${bit}`, x + i * cw + cw / 2, y + h + 22, String(2 ** bit), { size: 24, mono: true, tone: 'muted' }));
  }
  if (o.carry) {
    out.push(box(`${prefix}carry`, x - cw + 3, y, cw - 6, h, '1', { mono: true, tone: 'fail', dashed: true }));
    out.push(text(`${prefix}carryt`, x - cw / 2, y + h + 22, 'lost', { size: 24, tone: 'fail' }));
  }
  return out;
}

interface RingOpts {
  signed?: boolean;
  /** highlight the arc walked from `from` to `at` (clockwise for a positive step) */
  from?: number;
  step?: number;
  tone?: Tone;
}

/** A clock face for a `w`-bit type: 0 at the top, values increase clockwise, the seam is where the value wraps. */
export function ring(prefix: string, cx: number, cy: number, r: number, w: number, at: number, o: RingOpts = {}): Shape[] {
  const n = 2 ** w;
  const ang = (v: number) => (360 * mask(v, w)) / n;
  const pt = (v: number, rr: number) => ({ x: cx + rr * Math.sin((ang(v) * Math.PI) / 180), y: cy - rr * Math.cos((ang(v) * Math.PI) / 180) });
  const out: Shape[] = [{ t: 'arc', id: `${prefix}ring`, cx, cy, r, a0: 0, a1: 359.9, tone: 'muted', width: 6 }];
  if (o.from !== undefined && o.step) {
    const a = ang(o.from);
    const sweep = (360 * Math.min(Math.abs(o.step), n)) / n;
    const a0 = o.step > 0 ? a : a - sweep;
    out.push({ t: 'arc', id: `${prefix}walk`, cx, cy, r, a0, a1: a0 + sweep, tone: o.tone ?? 'current', width: 14 });
  }
  const seam = o.signed ? n / 2 : 0;
  const sp = pt(seam, r);
  const sq = pt(seam, r + 26);
  out.push(line(`${prefix}seam`, sp.x, sp.y, sq.x, sq.y, 'fail', { width: 6 }));
  const labels = 8;
  for (let k = 0; k < labels; k++) {
    const v = (k * n) / labels;
    const p = pt(v, r + 48);
    const shown = o.signed ? asSigned(v, w) : v;
    out.push(text(`${prefix}l${k}`, p.x, p.y, String(shown), { size: 24, mono: true, tone: v === seam ? 'fail' : 'muted' }));
  }
  const tip = pt(at, r - 10);
  out.push(arrow(`${prefix}needle`, cx, cy, tip.x, tip.y, o.tone ?? 'accent', { width: 6 }));
  out.push(dot(`${prefix}hub`, cx, cy, o.tone ?? 'accent', undefined, 10));
  return out;
}
