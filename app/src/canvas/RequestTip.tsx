import React from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useShallow } from 'zustand/react/shallow';
import type { SharedValue } from 'react-native-reanimated';
import type { SystemDoc } from '@dsims/engine';
import { useTheme } from '../theme';
import { Icon } from '../ui/Icon';
import { Glass, Mono, Text } from '../ui/primitives';
import { useRun, type JourneyHop } from '../state/run';
import { story, loadChip, type Phase } from '../learn/narrate';
import type { Layout } from './layout';

/** Narrates the followed request, one beat at a time; docks on the half of the screen away from where it is. */
export function RequestTip({ doc, layout, camera, top, bottom, sender, onOpen, onSteps, onClose }: { doc: SystemDoc; layout: Layout; camera: { tx: SharedValue<number>; ty: SharedValue<number>; s: SharedValue<number> }; top: number; bottom: number; sender?: string; onOpen: (h: JourneyHop) => void; onSteps: () => void; onClose: () => void }) {
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  const { lead, snap, auto, pending, baseRps } = useRun(useShallow(s => ({ lead: s.lead, snap: s.snapshot, auto: s.auto, pending: s.pending, baseRps: s.baseRps })));
  const name = (id?: string) => doc.nodes.find(n => n.id === id)?.name ?? id ?? '';
  const load = loadChip(snap, baseRps);

  if (!lead) {
    if (auto) return null;
    return (
      <Animated.View entering={FadeIn} exiting={FadeOut} style={[styles.dock, { bottom }]} pointerEvents="box-none">
        <Glass radius={18} style={styles.card}>
          <View style={styles.row}>
            <Icon name="send" size={16} color={c.accent} />
            <Text v="headline" style={{ flex: 1, fontSize: 15 }}>
              {pending ? 'Sending…' : `Tap Send to fire a request${sender ? ` from ${name(sender)}` : ''}`}
            </Text>
            <Chips chips={load} />
          </View>
          {!pending && (
            <Text v="callout" color={c.text2} style={{ marginTop: 4 }}>
              Then step through its life with Next and Prev. Tap any step for its details.
            </Text>
          )}
        </Glass>
      </Animated.View>
    );
  }

  const st = story(doc, lead.hops, lead.i, snap, lead.total, lead.ok);
  const a = layout.anchor[st.at];
  const sy = a ? a.y * camera.s.value + camera.ty.value : height / 2;
  const atBottom = sy < (top + height - bottom) / 2;
  const tone = TONE(c)[st.phase];
  const n = lead.hops.length;
  const h = lead.hops[lead.i];
  return (
    <Animated.View layout={LinearTransition.duration(220)} entering={FadeIn} style={[styles.dock, atBottom ? { bottom } : { top }]} pointerEvents="box-none">
      <Pressable onPress={() => onOpen(h)} accessibilityRole="button" accessibilityHint="Shows the full request and response">
        <Glass radius={18} style={[styles.card, { borderColor: tone }]}>
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: tone }]} />
            <Text v="caption" color={tone}>
              {LABEL[st.phase]}
            </Text>
            <Progress n={n} i={lead.i} color={tone} />
            <Pressable hitSlop={12} onPress={onSteps} accessibilityLabel="All steps">
              <Icon name="list-ordered" size={16} color={c.text2} />
            </Pressable>
            <Pressable hitSlop={12} onPress={onClose} accessibilityLabel="Hide request tips">
              <Icon name="x" size={16} color={c.text3} />
            </Pressable>
          </View>
          <Text v="headline" numberOfLines={1} style={{ marginTop: 6, fontSize: 16 }}>
            {st.title}
          </Text>
          {!!st.body && (
            <Text v="callout" color={c.text2} numberOfLines={3} style={{ marginTop: 2, fontSize: 13.5 }}>
              {st.body}
            </Text>
          )}
          {!!st.wire && (
            <View style={[styles.wire, { backgroundColor: c.surface1 }]}>
              <Mono numberOfLines={1} style={{ fontSize: 12 }} color={st.phase === 'failed' ? c.fail : st.phase === 'response' || st.phase === 'done' ? (lead.ok === false && st.phase === 'done' ? c.fail : c.ok) : c.text}>
                {st.wire}
              </Mono>
              <Icon name="chevron-right" size={14} color={c.text3} />
            </View>
          )}
          <Chips chips={[...st.chips, ...load]} />
          <StepPills hops={lead.hops} i={lead.i} onOpen={onOpen} />
        </Glass>
      </Pressable>
    </Animated.View>
  );
}

const LABEL: Record<Phase, string> = { request: 'REQUEST', waiting: 'WAITING', response: 'RESPONSE', failed: 'FAILED', done: 'DONE' };
const TONE = (c: ReturnType<typeof useTheme>['c']): Record<Phase, string> => ({ request: c.read, waiting: c.warn, response: c.ok, failed: c.fail, done: c.accent });

function Progress({ n, i, color }: { n: number; i: number; color: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.progress}>
      <View style={[styles.track, { backgroundColor: c.hairlineStrong }]}>
        <View style={{ width: `${((i + 1) / n) * 100}%`, height: '100%', backgroundColor: color, borderRadius: 2 }} />
      </View>
      <Mono color={c.text3} style={{ fontSize: 11 }}>
        {i + 1}/{n}
      </Mono>
    </View>
  );
}

/** Every step of the request as a numbered pill: done, here, to come. Tap one for its details. */
function StepPills({ hops, i, onOpen }: { hops: JourneyHop[]; i: number; onOpen: (h: JourneyHop) => void }) {
  const { c } = useTheme();
  const ref = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  React.useEffect(() => ref.current?.scrollTo({ x: Math.max(0, i * 30 - 90), animated: true }), [i]);
  return (
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 6 }}>
      {hops.map((h, k) => {
        const tone = h.tcp ? c.warn : h.proto ? c.protocol : h.reply || h.done ? (h.ok ? c.ok : c.fail) : h.wait ? c.text2 : c.read;
        const here = k === i;
        return (
          <Pressable key={k} hitSlop={4} onPress={() => onOpen(h)} accessibilityLabel={`Step ${k + 1}`} style={[styles.pill, { borderColor: tone, backgroundColor: k < i ? tone : here ? c.surface2 : 'transparent', transform: [{ scale: here ? 1.15 : 1 }] }]}>
            <Mono style={{ fontSize: 10.5, fontWeight: here ? '700' : '400' }} color={k < i ? c.canvas : tone}>
              {k + 1}
            </Mono>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Chips({ chips }: { chips: { text: string; tone: 'warn' | 'fail' | 'ok' | 'muted' }[] }) {
  const { c } = useTheme();
  if (!chips.length) return null;
  const col = { warn: c.warn, fail: c.fail, ok: c.ok, muted: c.text3 };
  return (
    <View style={[styles.row, { flexWrap: 'wrap', marginTop: 8, gap: 6 }]}>
      {chips.map(ch => (
        <View key={ch.text} style={[styles.chip, { borderColor: col[ch.tone] }]}>
          <Text v="callout" color={col[ch.tone]} style={{ fontSize: 12 }}>
            {ch.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 12, right: 12, zIndex: 30, alignItems: 'center' },
  card: { width: '100%', maxWidth: 460, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  progress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 4 },
  track: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden' },
  wire: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pill: { minWidth: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
