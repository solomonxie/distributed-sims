import React, { useMemo } from 'react';
import { Canvas, Picture, Skia, createPicture } from '@shopify/react-native-skia';
import { algo } from '@dsims/engine';
import { drawShapes } from './drawFrame';
import { useFrameStyle } from './FrameCanvas';

const cache = new Map<string, algo.Frame | null>();

/** Final frame of a demo's default input (the fullest picture), memoised. */
export function thumbFrame(slug?: string): algo.Frame | null {
  if (!slug) return null;
  if (!cache.has(slug)) {
    const d = algo.getDemo(slug);
    const fs = d ? algo.frames(d, undefined, 200) : [];
    cache.set(slug, fs[fs.length - 1] ?? null);
  }
  return cache.get(slug)!;
}

/** Static render of a demo frame, scaled to the width and cropped to the vertical middle. */
export function FrameThumb({ slug, width, height }: { slug?: string; width: number; height: number }) {
  const { palette, fonts, colors } = useFrameStyle();
  const frame = thumbFrame(slug);
  const pic = useMemo(() => {
    if (!frame) return null;
    return createPicture(canvas => {
      const k = width / 1000;
      canvas.translate(0, (height - 1000 * k) / 2);
      canvas.scale(k, k);
      drawShapes(canvas, Skia, frame.shapes, frame.shapes, 1, palette, fonts, colors);
    });
  }, [frame, width, height, palette, fonts, colors]);
  if (!pic) return null;
  return (
    <Canvas style={{ width, height }}>
      <Picture picture={pic} />
    </Canvas>
  );
}
