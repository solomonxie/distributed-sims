import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Picture, Skia, createPicture, type SkFont } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import type { algo } from '@dsims/engine';
import { useTheme, toneColor, type Colors } from '../theme';
import { font } from './assets';
import { drawShapes, type Fonts } from './drawFrame';

type Frame = algo.Frame;
type Shape = algo.Shape;

const TONES = ['default', 'muted', 'accent', 'ok', 'warn', 'fail', 'protocol', 'read', 'write', 'visited', 'current', 'path'] as const;

/** Renders a frame (1000×1000 viewBox) and animates shapes with stable ids between frames. */
export function FrameCanvas({ frame, prev, size }: { frame: Frame; prev?: Frame; size: number }) {
  const { c } = useTheme();
  const progress = useSharedValue(1);
  const cur = useSharedValue<Shape[]>(frame.shapes);
  const old = useSharedValue<Shape[]>(prev?.shapes ?? frame.shapes);

  useEffect(() => {
    old.value = prev?.shapes ?? frame.shapes;
    cur.value = frame.shapes;
    progress.value = 0;
    progress.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
  }, [frame, prev, cur, old, progress]);

  const palette = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of TONES) m[t] = toneColor(c, t);
    m.default = c.text2;
    m.visited = c.text3;
    return m;
  }, [c]);
  const fonts = useMemo(() => fontSet(size), [size]);
  const colors = useMemo(() => ({ surface: c.surface2, canvas: c.canvas, text: c.text, text2: c.text2 }), [c]);

  const pic = useDerivedValue(() =>
    createPicture(canvas => {
      const k = size / 1000;
      canvas.scale(k, k);
      drawShapes(canvas, Skia, old.value, cur.value, progress.value, palette, fonts, colors);
    }),
  );

  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Picture picture={pic} />
      </Canvas>
    </View>
  );
}

function fontSet(size: number): Fonts {
  // fonts are created in viewBox units (canvas is pre-scaled)
  const sizes = [18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 44, 48, 56];
  const byPx: Record<number, SkFont> = {};
  const mono: Record<number, SkFont> = {};
  const bold: Record<number, SkFont> = {};
  for (const s of sizes) {
    byPx[s] = font(s, 500);
    mono[s] = font(s, 500, true);
    bold[s] = font(s, 700);
  }
  void size;
  return { byPx, mono, bold };
}

export type { Colors };
