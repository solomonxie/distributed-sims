// Draws one algorithm/machine frame (1000×1000 viewBox). Pure: Skia is injected so the
// same code runs as a UI-thread worklet on device and in the headless preview script.
import type { algo } from '@dsims/engine';

type Shape = algo.Shape;

export interface Fonts {
  byPx: Record<number, any>;
  mono: Record<number, any>;
  bold: Record<number, any>;
}

export const FONT_SIZES = [18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 48, 56];

export function drawShapes(canvas: any, Skia: any, prev: Shape[], cur: Shape[], t: number, pal: Record<string, string>, fonts: Fonts, col: { surface: string; canvas: string; text: string; text2: string }) {
  'worklet';
  const pick = (f: Record<number, any>, s: number) => {
    const keys = [18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 48, 56];
    let best = keys[0];
    for (let i = 0; i < keys.length; i++) if (Math.abs(keys[i] - s) < Math.abs(best - s)) best = keys[i];
    return f[best];
  };
  const fontOf = (size: number, mono?: boolean, bold?: boolean) => (mono ? pick(fonts.mono, size) : bold ? pick(fonts.bold, size) : pick(fonts.byPx, size));
  // largest size <= want (>= min) whose text fits maxW
  const fitSize = (text: string, want: number, maxW: number, min: number, mono?: boolean, bold?: boolean) => {
    const keys = [56, 48, 44, 40, 36, 34, 32, 30, 28, 26, 24, 22, 20, 18];
    let size = min;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] > want + 0.5 || keys[i] < min) continue;
      if (fontOf(keys[i], mono, bold).measureText(text).width <= maxW) {
        size = keys[i];
        break;
      }
    }
    return size;
  };
  const prevById: Record<string, Shape> = {};
  for (let i = 0; i < prev.length; i++) prevById[prev[i].id] = prev[i];
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const nodePos: Record<string, { x: number; y: number; r: number; w: number; h: number; shape: string }> = {};
  for (let i = 0; i < cur.length; i++) {
    const s = cur[i];
    if (s.t === 'node') {
      const p = prevById[s.id] as any;
      const x = p && p.t === 'node' ? lerp(p.x, s.x) : s.x;
      const y = p && p.t === 'node' ? lerp(p.y, s.y) : s.y;
      nodePos[s.id] = { x, y, r: s.r ?? 30, w: s.w ?? (s.r ?? 30) * 2, h: s.h ?? (s.r ?? 30) * 2, shape: s.shape ?? 'circle' };
    }
  }
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  const stroke = Skia.Paint();
  stroke.setAntiAlias(true);
  stroke.setStyle(1);
  const dashed = (on: boolean, a: number, b: number) => {
    if (!on) return stroke;
    const d = stroke.copy();
    d.setPathEffect(Skia.PathEffect.MakeDash([a, b], 0));
    return d;
  };
  const textPaint = Skia.Paint();
  textPaint.setAntiAlias(true);
  const toneOf = (tone?: string) => pal[tone ?? 'default'] ?? pal.default;
  const alphaIn = (id: string) => (prevById[id] ? 1 : t);

  const drawTextC = (text: string, x: number, y: number, size: number, color: string, mono?: boolean, bold?: boolean, align?: string, alpha = 1) => {
    const f = fontOf(size, mono, bold);
    const w = f.measureText(text).width;
    const dx = align === 'left' ? 0 : align === 'right' ? -w : -w / 2;
    textPaint.setColor(Skia.Color(color));
    textPaint.setAlphaf(alpha);
    canvas.drawText(text, x + dx, y + size * 0.35, textPaint, f);
  };

  const edgePoint = (id: string | { x: number; y: number }, towards: { x: number; y: number }) => {
    if (typeof id !== 'string') return { x: id.x, y: id.y };
    const n = nodePos[id];
    if (!n) return null;
    const dx = towards.x - n.x;
    const dy = towards.y - n.y;
    const d = Math.hypot(dx, dy) || 1;
    if (n.shape === 'rect') {
      const sx = Math.abs(dx) > 0 ? n.w / 2 / Math.abs(dx) : 1e9;
      const sy = Math.abs(dy) > 0 ? n.h / 2 / Math.abs(dy) : 1e9;
      const k = Math.min(sx, sy);
      return { x: n.x + dx * k, y: n.y + dy * k };
    }
    return { x: n.x + (dx / d) * (n.r + 2), y: n.y + (dy / d) * (n.r + 2) };
  };
  const centerOf = (id: string | { x: number; y: number }) => (typeof id === 'string' ? nodePos[id] : id);

  // pass 1: rects, arcs, lines, edges (below nodes)
  for (let i = 0; i < cur.length; i++) {
    const s = cur[i] as any;
    const a = alphaIn(s.id);
    if (s.t === 'rect') {
      const p = prevById[s.id] as any;
      const x = p && p.t === 'rect' ? lerp(p.x, s.x) : s.x;
      const y = p && p.t === 'rect' ? lerp(p.y, s.y) : s.y;
      const w = p && p.t === 'rect' ? lerp(p.w, s.w) : s.w;
      const h = p && p.t === 'rect' ? lerp(p.h, s.h) : s.h;
      const r = s.radius ?? 10;
      const color = toneOf(s.tone);
      const rr = Skia.RRectXY(Skia.XYWHRect(x, y, w, h), r, r);
      if (s.tone === 'current') {
        paint.setColor(Skia.Color(color));
        paint.setAlphaf(0.2 * a);
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x - 6, y - 6, w + 12, h + 12), r + 6, r + 6), paint);
      }
      if (s.filled) {
        paint.setColor(Skia.Color(color));
        paint.setAlphaf(0.16 * a);
        canvas.drawRRect(rr, paint);
      } else {
        paint.setColor(Skia.Color(col.surface));
        paint.setAlphaf(a);
        canvas.drawRRect(rr, paint);
      }
      stroke.setColor(Skia.Color(color));
      stroke.setAlphaf((s.tone && s.tone !== 'default' ? 0.9 : 0.35) * a);
      stroke.setStrokeWidth(s.tone === 'current' || s.tone === 'accent' ? 3 : 2);
      canvas.drawRRect(rr, dashed(!!s.dashed, 10, 8));
      const want = Math.min(34, Math.max(22, s.sub ? (h - 8) / 1.85 : h * 0.46));
      const lc = s.tone === 'muted' ? col.text2 : col.text;
      let ls = want;
      if (s.label) {
        ls = fitSize(s.label, want, w - 12, 18, s.mono);
        const sp = s.label.indexOf(' ');
        const wrap = !s.sub && sp > 0 && ls <= want - 6 && h >= Math.min(want, 30) * 2.4;
        if (wrap) {
          // two lines, split at the space nearest the middle
          let cut = sp;
          for (let k = sp; k >= 0 && k < s.label.length; k = s.label.indexOf(' ', k + 1)) if (Math.abs(k - s.label.length / 2) < Math.abs(cut - s.label.length / 2)) cut = k;
          const l1 = s.label.slice(0, cut);
          const l2 = s.label.slice(cut + 1);
          const ws = Math.min(fitSize(l1, want, w - 12, 18, s.mono), fitSize(l2, want, w - 12, 18, s.mono));
          drawTextC(l1, x + w / 2, y + h / 2 - ws * 0.55, ws, lc, s.mono, false, 'center', a);
          drawTextC(l2, x + w / 2, y + h / 2 + ws * 0.55, ws, lc, s.mono, false, 'center', a);
        } else drawTextC(s.label, x + w / 2, y + h / 2 - (s.sub ? ls * 0.45 : 0), ls, lc, s.mono, false, 'center', a);
      }
      if (s.sub) {
        const ss = fitSize(s.sub, Math.max(20, ls * 0.78), w - 10, 18, s.mono);
        drawTextC(s.sub, x + w / 2, y + h / 2 + (s.label ? ls * 0.62 : 0), ss, col.text2, s.mono, false, 'center', a);
      }
    } else if (s.t === 'arc') {
      stroke.setColor(Skia.Color(toneOf(s.tone)));
      stroke.setAlphaf(a);
      stroke.setStrokeWidth(s.width ?? 6);
      const path = Skia.Path.Make();
      path.addArc(Skia.XYWHRect(s.cx - s.r, s.cy - s.r, s.r * 2, s.r * 2), s.a0 - 90, s.a1 - s.a0);
      canvas.drawPath(path, stroke);
    } else if (s.t === 'line') {
      stroke.setColor(Skia.Color(toneOf(s.tone)));
      stroke.setAlphaf(a);
      stroke.setStrokeWidth(s.width ?? 3);
      canvas.drawLine(s.x1, s.y1, s.x2, s.y2, dashed(!!s.dashed, 10, 8));
      if (s.arrow) {
        const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        const path = Skia.Path.Make();
        path.moveTo(s.x2 - 18 * Math.cos(ang - 0.45), s.y2 - 18 * Math.sin(ang - 0.45));
        path.lineTo(s.x2, s.y2);
        path.lineTo(s.x2 - 18 * Math.cos(ang + 0.45), s.y2 - 18 * Math.sin(ang + 0.45));
        canvas.drawPath(path, stroke);
      }
    } else if (s.t === 'edge') {
      const c1 = centerOf(s.from);
      const c2 = centerOf(s.to);
      if (!c1 || !c2) continue;
      const p1 = edgePoint(s.from, c2);
      const p2 = edgePoint(s.to, c1);
      if (!p1 || !p2) continue;
      const color = toneOf(s.tone);
      stroke.setColor(Skia.Color(color));
      const strong = s.tone && s.tone !== 'default' && s.tone !== 'muted';
      stroke.setAlphaf((strong ? 1 : 0.45) * a);
      stroke.setStrokeWidth(s.width ?? (s.tone === 'path' ? 7 : strong ? 5 : 3));
      const edgePaint = dashed(!!s.dashed, 12, 9);
      const path = Skia.Path.Make();
      path.moveTo(p1.x, p1.y);
      let mx = (p1.x + p2.x) / 2;
      let my = (p1.y + p2.y) / 2;
      if (s.bend) {
        const nx = -(p2.y - p1.y);
        const ny = p2.x - p1.x;
        const d = Math.hypot(nx, ny) || 1;
        mx += (nx / d) * s.bend;
        my += (ny / d) * s.bend;
        path.quadTo(mx, my, p2.x, p2.y);
      } else path.lineTo(p2.x, p2.y);
      canvas.drawPath(path, edgePaint);
      if (s.arrow) {
        const ang = Math.atan2(p2.y - my, p2.x - mx);
        const ah = Skia.Path.Make();
        ah.moveTo(p2.x - 20 * Math.cos(ang - 0.42), p2.y - 20 * Math.sin(ang - 0.42));
        ah.lineTo(p2.x, p2.y);
        ah.lineTo(p2.x - 20 * Math.cos(ang + 0.42), p2.y - 20 * Math.sin(ang + 0.42));
        canvas.drawPath(ah, stroke);
      }
      if (s.label) {
        // on-curve midpoint (a quad's control point sits twice as far out)
        const lx = s.bend ? (p1.x + 2 * mx + p2.x) / 4 : mx;
        const ly = s.bend ? (p1.y + 2 * my + p2.y) / 4 : my;
        const f = pick(fonts.bold, 26);
        const w = f.measureText(s.label).width + 16;
        paint.setColor(Skia.Color(col.canvas));
        paint.setAlphaf(0.92 * a);
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(lx - w / 2, ly - 18, w, 36), 10, 10), paint);
        drawTextC(s.label, lx, ly, 26, strong ? color : col.text2, false, true, 'center', a);
      }
    }
  }
  // pass 2: nodes, dots, text
  for (let i = 0; i < cur.length; i++) {
    const s = cur[i] as any;
    const a = alphaIn(s.id);
    if (s.t === 'node') {
      const n = nodePos[s.id];
      const color = toneOf(s.tone);
      const hot = s.tone === 'current' || s.tone === 'accent' || s.tone === 'path';
      if (hot) {
        paint.setColor(Skia.Color(color));
        paint.setAlphaf(0.18 * a);
        if (n.shape === 'rect') canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(n.x - n.w / 2 - 8, n.y - n.h / 2 - 8, n.w + 16, n.h + 16), 18, 18), paint);
        else canvas.drawCircle(n.x, n.y, n.r + 12, paint);
      }
      paint.setColor(Skia.Color(col.surface));
      paint.setAlphaf(a);
      stroke.setColor(Skia.Color(color));
      stroke.setAlphaf((s.tone === 'muted' || s.tone === 'visited' ? 0.5 : 1) * a);
      stroke.setStrokeWidth(hot ? 5 : 3);
      if (n.shape === 'rect') {
        const rr = Skia.RRectXY(Skia.XYWHRect(n.x - n.w / 2, n.y - n.h / 2, n.w, n.h), 14, 14);
        canvas.drawRRect(rr, paint);
        canvas.drawRRect(rr, stroke);
      } else if (n.shape === 'diamond') {
        const pth = Skia.Path.Make();
        pth.moveTo(n.x, n.y - n.r);
        pth.lineTo(n.x + n.r, n.y);
        pth.lineTo(n.x, n.y + n.r);
        pth.lineTo(n.x - n.r, n.y);
        pth.close();
        canvas.drawPath(pth, paint);
        canvas.drawPath(pth, stroke);
      } else {
        canvas.drawCircle(n.x, n.y, n.r, paint);
        canvas.drawCircle(n.x, n.y, n.r, stroke);
      }
      if (s.label) {
        const want = Math.min(34, Math.max(20, (n.shape === 'rect' ? n.h * 0.5 : n.r * 0.9)));
        const room = n.shape === 'rect' ? n.w - 14 : n.shape === 'diamond' ? n.r * 1.1 : n.r * 1.7;
        drawTextC(s.label, n.x, n.y, fitSize(s.label, want, room, 18, false, true), s.tone === 'muted' || s.tone === 'visited' ? col.text2 : col.text, false, true, 'center', a);
      }
      if (s.sub) {
        const sy = n.y + (n.shape === 'rect' ? n.h / 2 : n.r) + 30;
        const sw = pick(fonts.mono, 32).measureText(s.sub).width + 14;
        paint.setColor(Skia.Color(col.canvas));
        paint.setAlphaf(0.8 * a);
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(n.x - sw / 2, sy - 19, sw, 38), 9, 9), paint);
        drawTextC(s.sub, n.x, sy, 32, hot ? color : col.text2, true, false, 'center', a);
      }
      if (s.badge) {
        const f = pick(fonts.bold, 24);
        const w = Math.max(32, f.measureText(s.badge).width + 16);
        const bx = n.x + (n.shape === 'rect' ? n.w / 2 : n.r * 0.7) - w / 2;
        const by = n.y - (n.shape === 'rect' ? n.h / 2 : n.r) - 20;
        paint.setColor(Skia.Color(color));
        paint.setAlphaf(0.95 * a);
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(bx, by, w, 32), 16, 16), paint);
        drawTextC(s.badge, bx + w / 2, by + 16, 24, col.canvas, false, true, 'center', a);
      }
    } else if (s.t === 'dot') {
      const p = prevById[s.id] as any;
      const x = p && p.t === 'dot' ? lerp(p.x, s.x) : s.x;
      const y = p && p.t === 'dot' ? lerp(p.y, s.y) : s.y;
      const color = toneOf(s.tone ?? 'accent');
      paint.setColor(Skia.Color(color));
      paint.setAlphaf(0.25 * a);
      canvas.drawCircle(x, y, (s.r ?? 10) * 2, paint);
      paint.setAlphaf(a);
      canvas.drawCircle(x, y, s.r ?? 10, paint);
      if (s.label) drawTextC(s.label, x, y - (s.r ?? 10) - 18, 24, col.text2, true, false, 'center', a);
    } else if (s.t === 'text') {
      const p = prevById[s.id] as any;
      const x = p && p.t === 'text' ? lerp(p.x, s.x) : s.x;
      const y = p && p.t === 'text' ? lerp(p.y, s.y) : s.y;
      drawTextC(s.text, x, y, s.size ?? 28, s.tone ? toneOf(s.tone) : col.text, s.mono, s.bold, s.align ?? 'center', a);
    }
  }
}

