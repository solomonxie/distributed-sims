// Small 2D plot frame for the ML demos: data → viewBox mapping, axes, polylines clipped to the frame.
import type { Shape, Tone } from '../algo/frames';
import { dot, line, text } from '../machine/lib/draw';

export interface Plot {
  px: (v: number) => number;
  py: (v: number) => number;
  inside: (x: number, y: number) => boolean;
  axes: Shape[];
}

export function plot(id: string, x: number, y: number, w: number, h: number, xr: [number, number], yr: [number, number], labels: [string, string] = ['x', 'y']): Plot {
  const px = (v: number) => x + ((v - xr[0]) / (xr[1] - xr[0])) * w;
  const py = (v: number) => y + h - ((v - yr[0]) / (yr[1] - yr[0])) * h;
  const inside = (a: number, b: number) => a >= xr[0] && a <= xr[1] && b >= yr[0] && b <= yr[1];
  const axes: Shape[] = [
    line(`${id}-ax`, x, y + h, x + w, y + h, 'muted', { width: 2 }),
    line(`${id}-ay`, x, y, x, y + h, 'muted', { width: 2 }),
    text(`${id}-lx`, x + w, y + h + 30, labels[0], { align: 'right', size: 24, tone: 'muted' }),
    text(`${id}-ly`, x + 8, y + 16, labels[1], { align: 'left', size: 24, tone: 'muted' }),
  ];
  return { px, py, inside, axes };
}

/** A curve sampled at n points; segments leaving the y-range are dropped. */
export function curve(id: string, p: Plot, f: (x: number) => number, xr: [number, number], yr: [number, number], tone: Tone = 'accent', n = 40): Shape[] {
  const out: Shape[] = [];
  for (let i = 0; i < n; i++) {
    const a = xr[0] + ((xr[1] - xr[0]) * i) / n;
    const b = xr[0] + ((xr[1] - xr[0]) * (i + 1)) / n;
    const fa = f(a);
    const fb = f(b);
    if (!(fa >= yr[0] && fa <= yr[1] && fb >= yr[0] && fb <= yr[1])) continue;
    out.push(line(`${id}-${i}`, p.px(a), p.py(fa), p.px(b), p.py(fb), tone, { width: 4 }));
  }
  return out;
}

/** Points as dots; points outside the range are skipped. */
export function scatter(id: string, p: Plot, pts: [number, number][], tone: (i: number) => Tone = () => 'read', r = 12): Shape[] {
  return pts.flatMap(([a, b], i) => (p.inside(a, b) ? [dot(`${id}-${i}`, p.px(a), p.py(b), tone(i), undefined, r)] : []));
}
