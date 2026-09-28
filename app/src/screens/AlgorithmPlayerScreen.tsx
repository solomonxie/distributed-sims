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

const SPEEDS = [0.5, 1, 2, 4];

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
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const input = custom ?? demo?.inputs[presetIdx]?.data;
  const frames = useMemo(() => (demo ? algo.frames(demo, input) : []), [demo, input]);
  const prevRef = useRef<algo.Frame | undefined>(undefined);

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
    setPlaying(false);
    prevRef.current = undefined;
  }, [frames]);

  useEffect(() => {
    if (!playing) return;
    if (i >= frames.length - 1) {
      setPlaying(false);
      haptic('success');
      return;
    }
    const tmr = setTimeout(() => go(i + 1), 1300 / speed);
    return () => clearTimeout(tmr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, i, speed, frames.length]);

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

  const editGraph = editing && demo.editable === 'graph' ? (custom ?? (demo.inputs[presetIdx]?.data as algo.GraphInput)) : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <ScrollView contentContainerStyle={{ padding: space.l, paddingBottom: 140 }}>
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
          {editGraph ? <GraphEditor size={size} graph={editGraph} onChange={g => setCustom(g)} /> : frame ? <FrameCanvas frame={frame} prev={prevRef.current} size={size} /> : null}
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
          <IconButton name="skip-back" onPress={() => go(0)} label="First step" />
          <IconButton name="chevron-left" size={26} onPress={() => go(i - 1)} disabled={i === 0} label="Previous step" />
          <Pressable
            onPress={() => {
              haptic('light');
              if (i >= frames.length - 1) {
                prevRef.current = undefined;
                setI(0);
                setPlaying(true);
              } else setPlaying(!playing);
            }}
            style={({ pressed }) => [styles.play, { backgroundColor: c.accent }, pressed && { transform: [{ scale: 0.95 }] }]}
          >
            <Icon name={playing ? 'pause' : i >= frames.length - 1 ? 'rotate-ccw' : 'play'} size={24} color={c.onAccent} strokeWidth={2.6} />
          </Pressable>
          <IconButton name="chevron-right" size={26} onPress={() => go(i + 1)} disabled={i >= frames.length - 1} label="Next step" />
          <Pressable onPress={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} style={styles.speed}>
            <Mono color={c.text2}>×{speed}</Mono>
          </Pressable>
        </View>
      )}
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
  play: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  speed: { width: 50, height: 44, alignItems: 'center', justifyContent: 'center' },
});
