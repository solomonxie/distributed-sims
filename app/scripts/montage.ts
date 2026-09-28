import { readFileSync, writeFileSync } from 'fs';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb';
(async () => {
  await LoadSkiaWeb();
  const S = require('@shopify/react-native-skia/lib/commonjs/skia/web').JsiSkApi((global as any).CanvasKit);
  const files = process.argv.slice(3);
  const imgs = files.map(f => S.Image.MakeImageFromEncoded(S.Data.fromBytes(new Uint8Array(readFileSync(f))))!);
  const w = imgs[0].width(), h = imgs[0].height();
  const surf = S.Surface.MakeOffscreen(w * imgs.length, h)!;
  const c = surf.getCanvas();
  imgs.forEach((im: any, i: number) => c.drawImage(im, i * w, 0));
  surf.flush();
  writeFileSync(process.argv[2], surf.makeImageSnapshot().encodeToBytes());
})();
