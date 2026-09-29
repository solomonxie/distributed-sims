import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-worklets';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { algo } from '@dsims/engine';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space, toneColor } from '../theme';
import { FrameCanvas } from '../canvas/FrameCanvas';
import { Button, IconButton, Mono, Text, Card } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { InfoButton } from '../ui/Info';
import { haptic } from '../lib/haptics';
import { bus } from '../debug/bus';
import { AlgoLesson } from '../learn/AlgoLesson';
import { useProgress } from '../state/progress';
import { DetailSheet, detailAt } from '../ui/DetailSheet';


export function AlgorithmPlayerScreen() {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AlgorithmPlayer'>>();
  const demo = algo.getDemo(route.params.slug);
  const { width } = useWindowDimensions();
  const size = width - space.l * 2;
  const [presetIdx, setPresetIdx] = useState(0);
  const [custom, setCustom] = useState<algo.GraphInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [i, setI] = useState(0);
  const [detail, setDetail] = useState<algo.Detail | undefined>(undefined);
  const input = custom ?? demo?.inputs[presetIdx]?.data;
  const frames = useMemo(() => (demo ? algo.frames(demo, input) : []), [demo, input]);
  const prevRef = useRef<algo.Frame | undefined>(undefined);

  const slug = route.params.slug;
  const inLesson = !!route.params.lesson;
  useEffect(() => {
    if (!inLesson) useProgress.getState().visit({ kind: 'demo', slug });
  }, [slug, inLesson]);

  useLayoutEffect(() => {
    nav.setOptions({
      title: demo?.title ?? 'Algorithm',
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {demo?.editable === 'graph' && <IconButton name={editing ? 'check' : 'pencil'} size={20} color={c.accent} onPress={() => setEditing(!editing)} label={editing ? 'Done editing' : 'Edit graph'} />}
          {demo && <InfoButton title={demo.title} text={demo.summary} />}
        </View>
      ),
    });
  }, [nav, demo, editing, c.accent]);

  useEffect(() => {
    setI(0);
    prevRef.current = undefined;
  }, [frames]);

  useEffect(() => {
    const off = bus.on('player:steps', n => setI(Math.min(frames.length - 1, n)));
    return () => {
      off();
    };
  }, [frames.length]);

  if (!demo) return null;
  const frame = frames[i];
  const go = (n: number) => {
    const k = Math.max(0, Math.min(frames.length - 1, n));
    prevRef.current = frames[i];
    setI(k);
  };

  const lesson = route.params.lesson;
  const pickInput = (id: string) => {
    const k = demo.inputs.findIndex(x => x.id === id);
    if (k < 0) return;
    setCustom(null);
    setPresetIdx(k);
  };
  const tapStage = (sx: number, sy: number) => {
    const d = frames[i] && detailAt(frames[i].shapes, (sx / size) * 1000, (sy / size) * 1000);
    if (!d) return;
    haptic('light');
    setDetail(d);
  };
  const stageTap = Gesture.Tap().onEnd(e => runOnJS(tapStage)(e.x, e.y));
  const editGraph = editing && demo.editable === 'graph' ? (custom ?? (demo.inputs[presetIdx]?.data as algo.GraphInput)) : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView contentContainerStyle={{ padding: space.l, paddingBottom: 140 }}>
        {lesson && !editing && <AlgoLesson topicId={lesson.topicId} lessonId={lesson.lessonId} onInput={pickInput} />}
        {demo.inputs.length > 1 && !editing && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: space.m }}>
            {demo.inputs.map((inp, k) => (
              <Pressable
                key={inp.id}
                onPress={() => {
                  setCustom(null);
                  setPresetIdx(k);
                  haptic('select');
                }}
                style={[styles.preset, { borderColor: k === presetIdx && !custom ? c.accent : c.hairlineStrong, backgroundColor: k === presetIdx && !custom ? c.surface2 : c.surface1 }]}
              >
                <Text v="callout" style={{ fontSize: 13.5, fontWeight: k === presetIdx && !custom ? '700' : '500' }}>
                  {inp.label}
                </Text>
              </Pressable>
            ))}
            {custom && (
              <View style={[styles.preset, { borderColor: c.accent, backgroundColor: c.surface2 }]}>
                <Text v="callout" style={{ fontWeight: '700' }}>
                  My graph
                </Text>
              </View>
            )}
          </ScrollView>
        )}
        <View style={[styles.stage, { backgroundColor: c.surface1, borderColor: c.hairline }]}>
          {editGraph ? <GraphEditor size={size} graph={editGraph} onChange={g => setCustom(g)} /> : frame ? (
            <GestureDetector gesture={stageTap}>
              <View>
                <FrameCanvas frame={frame} prev={prevRef.current} size={size} />
              </View>
            </GestureDetector>
          ) : null}
        </View>
        {editing ? (
          <Text v="callout" color={c.text2} style={{ marginTop: space.m }}>
            Tap empty space to add a node · tap two nodes to link or unlink · tap a weight to change it · long-press a node for source, target or delete.
          </Text>
        ) : frame ? (
          <>
            <View style={styles.stepRow}>
              <Mono color={c.accent}>
                Step {i + 1} / {frames.length}
              </Mono>
              {frame.done && <Icon name="circle-check" size={16} color={c.ok} />}
            </View>
            <Text style={{ fontSize: 16, lineHeight: 23, marginTop: 4 }}>{frame.note}</Text>
            {frame.shapes.some(s => (s.t === 'rect' || s.t === 'node') && s.detail) && (
              <Text v="caption" color={c.text3} style={{ marginTop: 6 }}>
                Tap a box marked i for details and sample code.
              </Text>
            )}
            {frame.panel && frame.panel.rows.length > 0 && (
              <Card style={{ marginTop: space.m }} padded>
                <Text v="caption">{frame.panel.title}</Text>
                <View style={styles.panelRows}>
                  {frame.panel.rows.map((r, k) => (
                    <View key={k} style={[styles.panelChip, { borderColor: r.tone ? toneColor(c, r.tone) : c.hairlineStrong }]}>
                      <Mono color={c.text2} style={{ fontSize: 12 }}>
                        {r.label}
                      </Mono>
                      <Mono color={r.tone ? toneColor(c, r.tone) : c.text} style={{ fontSize: 13 }}>
                        {r.value}
                      </Mono>
                    </View>
                  ))}
                </View>
              </Card>
            )}
          </>
        ) : null}
      </ScrollView>
      {!editing && (
        <View style={[styles.bar, { backgroundColor: c.surface1, borderTopColor: c.hairline }]}>
          <IconButton name="chevron-left" size={22} onPress={() => go(i - 1)} disabled={i === 0} label="Previous step" style={styles.side} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next step"
            disabled={i >= frames.length - 1}
            onPress={() => {
              haptic('light');
              go(i + 1);
              if (i + 1 >= frames.length - 1) haptic('success');
            }}
            style={({ pressed }) => [styles.next, { backgroundColor: c.accent }, i >= frames.length - 1 && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.97 }] }]}
          >
            <Icon name="step-forward" size={22} color={c.onAccent} strokeWidth={2.4} />
            <View>
              <Text v="headline" color={c.onAccent}>
                {i >= frames.length - 1 ? 'Done' : 'Next step'}
              </Text>
              <Text v="callout" color={c.onAccent} style={{ opacity: 0.8, fontSize: 12 }}>
                {i + 1} of {frames.length}
              </Text>
            </View>
          </Pressable>
          <IconButton name="rotate-ccw" size={18} color={c.text3} onPress={() => go(0)} disabled={i === 0} label="Back to the first step" style={styles.side} />
        </View>
      )}
      <DetailSheet detail={detail} onClose={() => setDetail(undefined)} />
      {editing && (
        <View style={[styles.bar, { backgroundColor: c.surface1, borderTopColor: c.hairline, justifyContent: 'center', gap: 12 }]}>
          <Button title="Reset" onPress={() => setCustom(null)} />
          <Button kind="primary" title="Done" onPress={() => setEditing(false)} />
        </View>
      )}
    </View>
  );
}

/** Minimal graph editor over the same 1000×1000 space. */
function GraphEditor({ size, graph, onChange }: { size: number; graph: algo.GraphInput; onChange: (g: algo.GraphInput) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const k = size / 1000;
  const g = graph;
  const nodeAt = (x: number, y: number) => g.nodes.find(n => Math.hypot(n.x - x, n.y - y) < 60)?.id;
  const edgeAt = (x: number, y: number) =>
    g.edges.findIndex(e => {
      const a = g.nodes.find(n => n.id === e.from)!;
      const b = g.nodes.find(n => n.id === e.to)!;
      return a && b && Math.hypot((a.x + b.x) / 2 - x, (a.y + b.y) / 2 - y) < 45;
    });
  const tap = (sx: number, sy: number) => {
    const x = sx / k;
    const y = sy / k;
    const n = nodeAt(x, y);
    if (n) {
      if (sel && sel !== n) {
        const idx = g.edges.findIndex(e => (e.from === sel && e.to === n) || (e.from === n && e.to === sel));
        const edges = idx >= 0 ? g.edges.filter((_, j) => j !== idx) : [...g.edges, { from: sel, to: n, w: 1 }];
        onChange({ ...g, edges });
        setSel(null);
      } else setSel(n === sel ? null : n);
      haptic('select');
      return;
    }
    const ei = edgeAt(x, y);
    if (ei >= 0) {
      const edges = g.edges.map((e, j) => (j === ei ? { ...e, w: (e.w % 9) + 1 } : e));
      onChange({ ...g, edges });
      haptic('select');
      return;
    }
    const used = new Set(g.nodes.map(n2 => n2.id));
    const id = 'ABCDEFGHIJKLMNOPQRSUVWXYZ'.split('').find(ch => !used.has(ch)) ?? `N${g.nodes.length}`;
    if (g.nodes.length >= 14) return;
    onChange({ ...g, nodes: [...g.nodes, { id, x: Math.max(60, Math.min(940, x)), y: Math.max(60, Math.min(940, y)), label: id }] });
    haptic('light');
  };
  const long = (sx: number, sy: number) => {
    const n = nodeAt(sx / k, sy / k);
    if (!n) return;
    Alert.alert(n, undefined, [
      { text: 'Set as source', onPress: () => onChange({ ...g, source: n }) },
      { text: 'Set as target', onPress: () => onChange({ ...g, target: n }) },
      { text: 'Delete', style: 'destructive', onPress: () => onChange({ ...g, nodes: g.nodes.filter(x => x.id !== n), edges: g.edges.filter(e => e.from !== n && e.to !== n) }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const gesture = Gesture.Exclusive(
    Gesture.LongPress().onStart(e => runOnJS(long)(e.x, e.y)),
    Gesture.Tap().onEnd(e => runOnJS(tap)(e.x, e.y)),
  );
  const frame: algo.Frame = {
    note: '',
    shapes: [
      ...g.edges.map((e, j) => ({ t: 'edge' as const, id: `e${j}`, from: e.from, to: e.to, label: String(e.w), arrow: !!e.directed })),
      ...g.nodes.map(n => ({ t: 'node' as const, id: n.id, x: n.x, y: n.y, r: 34, label: n.label ?? n.id, tone: (n.id === sel ? 'current' : n.id === g.source ? 'accent' : n.id === g.target ? 'path' : 'default') as any, badge: n.id === g.source ? 'src' : n.id === g.target ? 'dst' : undefined })),
    ],
  };
  return (
    <GestureDetector gesture={gesture}>
      <View>
        <FrameCanvas frame={frame} size={size} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  stage: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  preset: { paddingHorizontal: 14, height: 34, borderRadius: 17, borderWidth: 1, justifyContent: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: space.l },
  panelRows: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  panelChip: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 10, height: 30, borderRadius: 8, borderWidth: 1 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 30, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', borderTopWidth: StyleSheet.hairlineWidth },
  next: { flex: 1, maxWidth: 260, height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  side: { width: 48, alignItems: 'center' },
});
