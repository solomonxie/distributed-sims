// Source ↔ assembly view shared by the Assembly and C++ demos: step through source lines, highlight the asm they become.
import type { Frame, Shape } from '../../algo/frames';
import { arrow, box, Film, panel, text } from './draw';
import type { Row } from './draw';

export interface CodeMap {
  srcTitle: string;
  asmTitle: string;
  src: string[];
  asm: string[];
  intro: string;
  steps: { src: number[]; asm: number[]; note: string }[];
  outro: string;
  rows?: (i: number) => Row[];
}

/** Lines in 1–2 columns; contiguous highlighted lines share one box. Returns each line's anchor (right edge, mid y). */
function listing(prefix: string, lines: string[], y0: number, y1: number, hi: number[], tone: 'current' | 'write'): { shapes: Shape[]; at: { x: number; y: number }[] } {
  const cols = lines.length > 16 ? 2 : 1;
  const per = Math.ceil(lines.length / cols);
  const lh = Math.min(42, (y1 - y0) / Math.max(1, per));
  const size = cols === 2 ? 24 : lh >= 38 ? 28 : lh >= 32 ? 26 : 24;
  const colW = 972 / cols;
  const out: Shape[] = [];
  const at: { x: number; y: number }[] = [];
  const pos = (i: number) => ({ x: 14 + Math.floor(i / per) * colW, y: y0 + (i % per) * lh });
  for (let i = 0; i < lines.length; i++) {
    if (!hi.includes(i) || (hi.includes(i - 1) && i % per !== 0)) continue;
    let j = i;
    while (hi.includes(j + 1) && (j + 1) % per !== 0) j++;
    const p = pos(i);
    out.push(box(`${prefix}h${i}`, p.x, p.y + 1, colW - 8, (j - i + 1) * lh - 2, undefined, { tone }));
  }
  lines.forEach((ln, i) => {
    const p = pos(i);
    at.push({ x: p.x + colW - 30, y: p.y + lh / 2 });
    const t = ln.trim();
    const muted = t.startsWith(';') || t.startsWith('//');
    out.push(text(`${prefix}${i}`, p.x + 14, p.y + lh / 2, ln, { align: 'left', size, mono: true, tone: muted ? 'muted' : t.endsWith(':') ? 'accent' : undefined }));
  });
  return { shapes: out, at };
}

export function codeMapFrames(m: CodeMap): Frame[] {
  const f = new Film();
  const srcEnd = 60 + Math.min(40, 300 / m.src.length) * m.src.length;
  const asmY = srcEnd + 70;
  const draw = (s: number[], a: number[]) => {
    const top = listing('s', m.src, 60, srcEnd, s, 'current');
    const bot = listing('a', m.asm, asmY, 985, a, 'write');
    const out: Shape[] = [text('st', 20, 30, m.srcTitle, { align: 'left', size: 28, bold: true, tone: 'current' }), text('at', 20, asmY - 32, m.asmTitle, { align: 'left', size: 28, bold: true, tone: 'write' }), ...top.shapes, ...bot.shapes];
    if (s.length && a.length && m.asm.length <= 16) {
      const from = top.at[s[s.length - 1]];
      const to = bot.at[a[0]];
      out.push(arrow('link', Math.max(from.x, to.x) - 10, from.y + 14, to.x, to.y - 14, 'write', { dashed: true, width: 3 }));
    }
    return out;
  };
  const rows = (i: number) => panel('Code', [['source lines', m.src.filter((l) => l.trim() && !l.trim().startsWith('//')).length], ['asm instructions', m.asm.filter((l) => /^\s+[a-z]/.test(l)).length], ...(m.rows?.(i) ?? [])]);
  f.add(m.intro, draw([], []), rows(0));
  m.steps.forEach((s, i) => f.add(s.note, draw(s.src, s.asm), rows(i + 1)));
  f.add(m.outro, draw([], []), rows(m.steps.length + 1));
  return f.frames;
}
