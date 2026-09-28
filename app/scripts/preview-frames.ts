// Headless preview (CanvasKit, no simulator): render algorithm/machine frames to PNGs for visual review.
// usage: npx tsx scripts/preview-frames.ts <outDir> [slug[:frameIdx] ...]
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb';
import { algo } from '../../engine/src';
import { drawShapes, FONT_SIZES } from '../src/canvas/drawFrame';
import { palette } from '../src/theme/tokens';

async function main() {
  await LoadSkiaWeb();
  const { Skia } = require('@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia') as any;
  const S = (global as any).SkiaApi ?? require('@shopify/react-native-skia/lib/commonjs/skia/web').JsiSkApi((global as any).CanvasKit);
  void Skia;
  const out = process.argv[2] ?? '/tmp/dsims-frames';
  mkdirSync(out, { recursive: true });
  const sans = S.Typeface.MakeFreeTypeFaceFromData(S.Data.fromBytes(new Uint8Array(readFileSync('/System/Library/Fonts/SFNS.ttf'))));
  const mono = S.Typeface.MakeFreeTypeFaceFromData(S.Data.fromBytes(new Uint8Array(readFileSync('/System/Library/Fonts/SFNSMono.ttf'))));
  const fonts = { byPx: {} as any, mono: {} as any, bold: {} as any };
  for (const s of FONT_SIZES) {
    fonts.byPx[s] = S.Font(sans, s);
    fonts.bold[s] = S.Font(sans, s);
    fonts.bold[s].setEmbolden(true);
    fonts.mono[s] = S.Font(mono, s);
  }
  const c = palette.dark;
  const pal: Record<string, string> = { default: c.text2, muted: c.text3, accent: c.accent, ok: c.ok, warn: c.warn, fail: c.fail, protocol: c.protocol, read: c.read, write: c.write, visited: c.text3, current: c.write, path: c.ok };
  const col = { surface: c.surface2, canvas: c.canvas, text: c.text, text2: c.text2 };
  const want = process.argv.slice(3);
  const demos = algo.allDemos().filter(d => !want.length || want.some(w => w.split(':')[0] === d.slug));
  for (const d of demos) {
    const fr = algo.frames(d);
    const spec = want.find(w => w.split(':')[0] === d.slug);
    const idxs = spec?.includes(':') ? [Number(spec.split(':')[1])] : [0, Math.floor(fr.length / 2), fr.length - 1];
    for (const i of idxs) {
      const f = fr[Math.min(i, fr.length - 1)];
      const size = 720;
      const surface = S.Surface.MakeOffscreen(size, size)!;
      const canvas = surface.getCanvas();
      canvas.clear(S.Color(c.surface1));
      canvas.save();
      canvas.scale(size / 1000, size / 1000);
      drawShapes(canvas, S, f.shapes, f.shapes, 1, pal, fonts, col);
      canvas.restore();
      surface.flush();
      const png = surface.makeImageSnapshot().encodeToBytes();
      writeFileSync(`${out}/${d.slug}-${String(i).padStart(2, '0')}.png`, png);
    }
  }
  console.log(`rendered ${demos.length} demos → ${out}`);
}
main();
