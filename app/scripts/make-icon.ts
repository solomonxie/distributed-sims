// Renders the app icon (uiux/visual.md → App icon) to a 1024×1024 opaque PNG.
// usage: npx tsx scripts/make-icon.ts <out.png>
import { writeFileSync } from 'fs';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb';

async function main() {
  await LoadSkiaWeb();
  const S = require('@shopify/react-native-skia/lib/commonjs/skia/web').JsiSkApi((global as any).CanvasKit);
  const N = 1024;
  const surface = S.Surface.MakeOffscreen(N, N)!;
  const c = surface.getCanvas();

  // background: deep navy with a soft radial lift toward the top
  const bg = S.Paint();
  bg.setShader(S.Shader.MakeRadialGradient(S.Point(N * 0.5, N * 0.32), N * 0.85, [S.Color('#18233A'), S.Color('#0A0D14')], null, 0));
  c.drawRect(S.XYWHRect(0, 0, N, N), bg);

  // faint dot grid
  const dot = S.Paint();
  dot.setAntiAlias(true);
  dot.setColor(S.Color('#1C2230'));
  for (let x = 64; x < N; x += 64) for (let y = 64; y < N; y += 64) c.drawCircle(x, y, 3.2, dot);

  const A = { x: 512, y: 300 };
  const B = { x: 292, y: 690 };
  const C = { x: 732, y: 690 };
  const cyan = S.Color('#5CE1FF');
  const violet = S.Color('#B28CFF');

  // edge glow + edges
  const glow = S.Paint();
  glow.setAntiAlias(true);
  glow.setStyle(1);
  glow.setStrokeWidth(46);
  glow.setStrokeCap(1);
  glow.setColor(cyan);
  glow.setAlphaf(0.16);
  glow.setMaskFilter(S.MaskFilter.MakeBlur(1, 28, true));
  const edge = S.Paint();
  edge.setAntiAlias(true);
  edge.setStyle(1);
  edge.setStrokeWidth(20);
  edge.setStrokeCap(1);
  edge.setColor(cyan);
  for (const [p, q] of [
    [A, B],
    [A, C],
    [B, C],
  ]) {
    c.drawLine(p.x, p.y, q.x, q.y, glow);
    c.drawLine(p.x, p.y, q.x, q.y, edge);
  }

  // nodes: dark core, cyan ring, health-green on one
  const core = S.Paint();
  core.setAntiAlias(true);
  core.setColor(S.Color('#121722'));
  const ring = S.Paint();
  ring.setAntiAlias(true);
  ring.setStyle(1);
  ring.setStrokeWidth(22);
  for (const [p, col] of [
    [A, '#5CE1FF'],
    [B, '#5CE1FF'],
    [C, '#3DDC97'],
  ] as const) {
    const halo = S.Paint();
    halo.setAntiAlias(true);
    halo.setColor(S.Color(col));
    halo.setAlphaf(0.22);
    halo.setMaskFilter(S.MaskFilter.MakeBlur(1, 36, true));
    c.drawCircle(p.x, p.y, 118, halo);
    c.drawCircle(p.x, p.y, 96, core);
    ring.setColor(S.Color(col));
    c.drawCircle(p.x, p.y, 96, ring);
    const pip = S.Paint();
    pip.setAntiAlias(true);
    pip.setColor(S.Color(col));
    c.drawCircle(p.x, p.y, 26, pip);
  }

  // one violet particle mid-edge (A→C), with a short trail
  const P = { x: A.x + (C.x - A.x) * 0.52, y: A.y + (C.y - A.y) * 0.52 };
  const dir = { x: (C.x - A.x) / Math.hypot(C.x - A.x, C.y - A.y), y: (C.y - A.y) / Math.hypot(C.x - A.x, C.y - A.y) };
  for (let k = 5; k >= 1; k--) {
    const t = S.Paint();
    t.setAntiAlias(true);
    t.setColor(violet);
    t.setAlphaf(0.1 * (6 - k));
    c.drawCircle(P.x - dir.x * k * 26, P.y - dir.y * k * 26, 30 - k * 3, t);
  }
  const pg = S.Paint();
  pg.setAntiAlias(true);
  pg.setColor(violet);
  pg.setAlphaf(0.5);
  pg.setMaskFilter(S.MaskFilter.MakeBlur(1, 30, true));
  c.drawCircle(P.x, P.y, 62, pg);
  const pc = S.Paint();
  pc.setAntiAlias(true);
  pc.setColor(violet);
  c.drawCircle(P.x, P.y, 38, pc);
  const hi = S.Paint();
  hi.setAntiAlias(true);
  hi.setColor(S.Color('#FFFFFF'));
  hi.setAlphaf(0.9);
  c.drawCircle(P.x, P.y, 13, hi);

  surface.flush();
  const out = process.argv[2] ?? '/tmp/dsims-icon.png';
  writeFileSync(out, surface.makeImageSnapshot().encodeToBytes());
  console.log('icon →', out);
}
main();
