import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useShallow } from 'zustand/react/shallow';
import type { SystemDoc } from '@dsims/engine';
import { useTheme } from '../theme';
import { Mono, Text } from '../ui/primitives';
import { useRun } from '../state/run';
import { story, type Phase } from '../learn/narrate';
import type { Layout } from './layout';

/** must match SystemCanvas: dots keep to the right of their direction of travel */
const LANE = 5;
const GAP = 34;

type Camera = { tx: SharedValue<number>; ty: SharedValue<number>; s: SharedValue<number> };

/** A short phrase pinned to the followed dot while it is parked halfway along a hop, with a leader line to it. */
export function DotCallout({ doc, layout, camera }: { doc: SystemDoc; layout: Layout; camera: Camera }) {
  const { c } = useTheme();
  const { width } = useWindowDimensions();
  const { lead, midway, snap } = useRun(useShallow(s => ({ lead: s.lead, midway: s.midway, snap: s.snapshot })));
  const [box, setBox] = useState({ w: 0, h: 0 });
  const h = lead?.hops[lead.i];
  const a = h ? layout.anchor[h.from] : undefined;
  const b = h ? layout.anchor[h.to] : undefined;
  let px = 0;
  let py = 0;
  if (a && b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    px = a.x + dx / 2 - (dy / len) * LANE;
    py = a.y + dy / 2 + (dx / len) * LANE;
  }
  const boxStyle = useAnimatedStyle(() => {
    const sx = px * camera.s.value + camera.tx.value;
    const sy = py * camera.s.value + camera.ty.value;
    const left = sx > width / 2;
    return { transform: [{ translateX: left ? sx - GAP - box.w : sx + GAP }, { translateY: sy - GAP - box.h }] };
  }, [px, py, box, width]);
  const lineStyle = useAnimatedStyle(() => {
    const sx = px * camera.s.value + camera.tx.value;
    const sy = py * camera.s.value + camera.ty.value;
    const left = sx > width / 2;
    const ex = left ? sx - GAP : sx + GAP;
    const ey = sy - GAP;
    return { width: Math.hypot(ex - sx, ey - sy), transform: [{ translateX: sx }, { translateY: sy }, { rotate: `${Math.atan2(ey - sy, ex - sx)}rad` }] };
  }, [px, py, width]);

  if (!lead || !midway || !h || !a || !b) return null;
  const st = story(doc, lead.hops, lead.i, snap ?? null, lead.total, lead.ok);
  const tone = TONE(c)[st.phase];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={[styles.line, { backgroundColor: tone }, lineStyle]} />
      <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} onLayout={e => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} style={[styles.box, { borderColor: tone, backgroundColor: c.surface1 }, boxStyle]}>
        <Text v="headline" style={{ fontSize: 14 }}>
          {st.title}
        </Text>
        {st.wire ? (
          <Mono color={c.text2} style={{ fontSize: 11.5, marginTop: 2 }} numberOfLines={1}>
            {st.wire}
          </Mono>
        ) : null}
      </Animated.View>
    </View>
  );
}

const TONE = (c: { read: string; ok: string; fail: string; warn: string; text2: string }): Record<Phase, string> => ({ request: c.read, response: c.ok, failed: c.fail, waiting: c.warn, done: c.ok });

const styles = StyleSheet.create({
  line: { position: 'absolute', left: 0, top: 0, height: 1.5, transformOrigin: 'left center', opacity: 0.9 },
  box: { position: 'absolute', left: 0, top: 0, maxWidth: 230, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
});
