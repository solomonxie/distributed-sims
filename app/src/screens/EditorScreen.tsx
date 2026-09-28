import { useShallow } from 'zustand/react/shallow';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Dimensions, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { rules as engineRules, type ChaosEvent, type Flight, type SystemDoc, type TrafficEvent } from '@dsims/engine';
import { catalog, topics, type ChaosDef } from '@dsims/content';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space, spring } from '../theme';
import { SystemCanvas, fmtMs } from '../canvas/SystemCanvas';
import { computeLayout, hitTest, nodeIcon } from '../canvas/layout';
import { useDoc, flushSave } from '../state/doc';
import { useLibrary, forkDoc, saveSystem } from '../state/library';
import { useSettings } from '../state/settings';
import { RequestTip } from '../canvas/RequestTip';
import { controller, useRun, flightsSV, simTime, anchorsSV, hasTrafficOrigin, CHALLENGE_PACE, journeyOf, type JourneyHop } from '../state/run';
import { Sheet } from '../sheets/Sheet';
import { PaletteContent, type PaletteItem } from '../sheets/PaletteSheet';
import { NodeInspector, EdgeInspector, ContainerInspector } from '../sheets/Inspector';
import { TrafficContent, ChaosContent, ChaosParams, EventLogContent, TimelineContent, buildChaosEvent, fmtClock } from '../sheets/RunSheets';
import { TraceContent, SequenceContent } from '../sheets/TraceSheet';
import { HostView } from '../sheets/HostView';
import { DotDetails, HopDetails } from '../sheets/DotDetails';
import { Icon } from '../ui/Icon';
import { Button, Glass, IconButton, Mono, Text, Chip } from '../ui/primitives';
import { ToastHost, toast } from '../ui/Toast';
import { haptic } from '../lib/haptics';
import { GuideLayer } from '../learn/Guide';
import { bus } from '../debug/bus';

type SheetKind =
  | { k: 'palette' }
  | { k: 'node'; id: string }
  | { k: 'edge'; id: string }
  | { k: 'container'; id: string }
  | { k: 'group' }
  | { k: 'traffic' }
  | { k: 'chaos'; node?: string }
  | { k: 'chaos-params'; def: ChaosDef; node?: string }
  | { k: 'log' }
  | { k: 'timeline' }
  | { k: 'trace'; id: number }
  | { k: 'sequence'; node?: string }
  | { k: 'warnings' }
  | { k: 'list' }
  | { k: 'host'; id: string }
  | { k: 'dot'; flight: Flight }
  | { k: 'hop'; hop: JourneyHop }
  | null;

type Targeting = { def: ChaosDef; params: Record<string, number>; dur?: number; first?: string; schedule?: boolean } | { connectFrom: string } | { sendOne: true } | { pickBreak: true } | null;

const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 10];
const QUICK_SPEEDS = [0.5, 1, 2, 4];

export function EditorScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Editor'>>();
  const { doc, selection, multi, readOnly } = useDoc(useShallow(s => ({ doc: s.doc, selection: s.selection, multi: s.multi, readOnly: s.readOnly })));
  const past = useDoc(s => s.past.length);
  const future = useDoc(s => s.future.length);
  const run = useRun();
  const mode: 'build' | 'run' = run.active ? 'run' : 'build';
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [targeting, setTargeting] = useState<Targeting>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [titleMenu, setTitleMenu] = useState(false);
  const [speedMenu, setSpeedMenu] = useState(false);
  const [groupKind, setGroupKind] = useState<string | null>(null);
  const sheetRef = useRef<any>(null);
  const labels = useSettings(st => st.labels);
  const requestTips = useSettings(st => st.requestTips);
  const [sender, setSender] = useState<string | undefined>();
  const [sendMenu, setSendMenu] = useState(false);
  const [sendOp, setSendOp] = useState<'read' | 'write'>('read');
  const [reduceMotion, setReduceMotion] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const a = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const b = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      a.remove();
      b.remove();
    };
  }, []);

  // load (the doc store and run controller are global; stacked editors take turns owning them)
  const myDocId = route.params.doc.id;
  useEffect(() => {
    useDoc.getState().load(route.params.doc, { readOnly: route.params.readOnly });
    return () => {
      if (controller.owner === myDocId) controller.stop();
      if (useDoc.getState().doc?.id === myDocId) {
        flushSave();
        useDoc.getState().close();
      }
    };
  }, [route.params.doc, route.params.readOnly, myDocId]);
  useEffect(
    () =>
      nav.addListener('focus', () => {
        if (useDoc.getState().doc?.id !== myDocId) {
          const saved = useLibrary.getState().items.find(i => i.id === myDocId)?.doc;
          useDoc.getState().load(saved ?? route.params.doc, { readOnly: route.params.readOnly });
          fitted.current = false;
        }
      }),
    [nav, myDocId, route.params.doc, route.params.readOnly],
  );

  const layout = useMemo(() => (doc ? computeLayout(doc) : null), [doc]);
  const nameOf = useCallback((id: string) => doc?.nodes.find(n => n.id === id)?.name ?? id, [doc]);

  // camera
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const s = useSharedValue(1);
  const camera = useMemo(() => ({ tx, ty, s }), [tx, ty, s]);
  const { width: W, height: H } = Dimensions.get('window');
  const fitted = useRef(false);
  const fit = useCallback(
    (animated = true) => {
      if (!layout) return;
      const b = layout.bounds;
      const top = insets.top + (route.params.guide ? 110 : 70);
      const bottom = insets.bottom + 92;
      const availH = H - top - bottom;
      const sc = Math.min(1.25, (W - 32) / Math.max(1, b.w), availH / Math.max(1, b.h));
      const nx = W / 2 - (b.x + b.w / 2) * sc;
      const ny = top + availH / 2 - (b.y + b.h / 2) * sc;
      if (animated) {
        s.value = withSpring(sc, spring);
        tx.value = withSpring(nx, spring);
        ty.value = withSpring(ny, spring);
      } else {
        s.value = sc;
        tx.value = nx;
        ty.value = ny;
      }
    },
    [layout, W, H, insets, s, tx, ty],
  );
  useEffect(() => {
    // fit once per loaded doc — the store may still hold the previous editor's doc on first render
    if (layout && doc?.id === myDocId && !fitted.current) {
      fitted.current = true;
      fit(false);
    }
  }, [layout, fit, doc?.id, myDocId]);

  useEffect(() => {
    if (layout && run.active) controller.setLayout(layout);
  }, [layout, run.active]);

  // auto-run for lessons / challenges
  const autoStarted = useRef(false);
  useEffect(() => {
    if (route.params.autoRun && layout && doc?.id === myDocId && !autoStarted.current) {
      autoStarted.current = true;
      setTimeout(() => startRun(), 350);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.autoRun, layout, doc?.id]);

  // events → toasts
  useEffect(() => {
    controller.onEvent = e => {
      if (e.kind === 'alert') toast({ text: `🔔 ${e.text}`, tone: 'alert', action: e.node ? { label: 'View', onPress: () => openNode(e.node!) } : undefined });
    };
    return () => {
      controller.onEvent = undefined;
    };
  }, []);

  // snapshot-tour hooks
  useEffect(() => {
    const offs = [
      bus.on('editor:sheet', k => setSheet(k ? ({ k } as SheetKind) : null)),
      bus.on('editor:run', () => startRun()),
      bus.on('editor:select-first', () => {
        const d = useDoc.getState().doc;
        const n = d?.nodes.find(x => !/client|device|bot$/.test(x.type));
        if (n) openNode(n.id);
      }),
      bus.on('editor:play', () => controller.play()),
      bus.on('editor:pause-dot', () => {
        controller.pause();
        const tr = controller.run?.traces().filter(x => x.end !== undefined && x.spans.length > 1).slice(-1)[0];
        const hop = tr && controller.run ? journeyOf(tr, controller.run)[0] : undefined;
        if (hop) setSheet({ k: 'hop', hop });
      }),
      bus.on('editor:chaos-demo', () => {
        const d = useDoc.getState().doc;
        const n = d?.nodes.find(x => /db|store|cache/.test(x.type)) ?? d?.nodes.find(x => !/client|device|bot$/.test(x.type));
        if (n) controller.fire({ kind: 'slow', target: n.id, params: { x: 20 }, durationSec: 30 });
      }),
    ];
    return () => offs.forEach(o => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const warnings = useMemo(() => {
    if (!doc) return [];
    try {
      return (engineRules as any).checkRules?.(doc, catalog) ?? [];
    } catch {
      return [];
    }
  }, [doc]);

  const openNode = (id: string) => {
    useDoc.getState().select({ kind: 'node', id });
    setSheet({ k: 'node', id });
  };

  const startRun = () => {
    if (!doc || !layout) return;
    if (!hasTrafficOrigin(doc)) {
      toast({ text: 'Add a client and a service to run', tone: 'info', icon: 'info' });
      return;
    }
    if (!doc.scenario?.sources.length) toast({ text: 'Added 100 rps from every client', tone: 'info', icon: 'activity' });
    const g = route.params.guide;
    const lessonSpeed = g?.kind === 'lesson' ? ((topics.find(t => t.id === g.topicId)?.lessons.find(l => l.id === g.lessonId) as any)?.speed ?? 1) : g ? 1 : undefined;
    controller.start(doc, layout, { autoplay: true, owner: myDocId, speed: lessonSpeed, pace: g?.kind === 'challenge' ? CHALLENGE_PACE : undefined, auto: false });
    setSender(s0 => s0 && doc.nodes.some(n => n.id === s0) ? s0 : defaultSender(doc));
    haptic('medium');
    setSheet(null);
  };
  const stopRun = () => {
    controller.stop();
    setSheet(null);
    setTargeting(null);
  };

  // ---------- canvas interactions ----------
  const onTap = (x: number, y: number) => {
    if (!layout || !doc) return;
    setMenu(null);
    setTitleMenu(false);
    setSpeedMenu(false);
    // tapping a dot (moving or paused) pauses and shows what it carries
    if (run.active && !targeting) {
      const h = controller.pickJourney(x, y, 30);
      const f = !h ? controller.pickDot(x, y, 26) : undefined;
      if (h || f) {
        if (run.playing) controller.pause();
        haptic('select');
        setSheet(h ? { k: 'hop', hop: h } : { k: 'dot', flight: f! });
        return;
      }
    }
    const hit = hitTest(layout, x, y);
    if (targeting) return handleTarget(hit);
    if (multi) {
      if (hit?.kind === 'node') {
        haptic('select');
        const next = multi.includes(hit.id) ? multi.filter(i => i !== hit.id) : [...multi, hit.id];
        useDoc.getState().setMulti(next);
      }
      return;
    }
    if (!hit) {
      useDoc.getState().select(null);
      if (sheet && sheet.k !== 'palette' && sheet.k !== 'traffic' && sheet.k !== 'chaos' && sheet.k !== 'timeline' && sheet.k !== 'log') setSheet(null);
      return;
    }
    haptic('select');
    const kind = hit.kind === 'container-header' ? 'container' : hit.kind;
    useDoc.getState().select({ kind, id: hit.id });
    if (kind === 'node') setSheet({ k: 'node', id: hit.id });
    else if (kind === 'edge') setSheet({ k: 'edge', id: hit.id });
    else setSheet({ k: 'container', id: hit.id });
  };

  const onDoubleTap = (x: number, y: number) => {
    if (!layout) return;
    const hit = hitTest(layout, x, y);
    if (hit && (hit.kind === 'container' || hit.kind === 'container-header') && !readOnly) {
      useDoc.getState().toggleCollapse(hit.id);
      haptic('light');
    } else if (!hit) fit();
  };

  const onLongPress = (x: number, y: number, sx: number, sy: number) => {
    if (!layout) return;
    const hit = hitTest(layout, x, y);
    if (hit?.kind === 'node') {
      haptic('medium');
      useDoc.getState().select({ kind: 'node', id: hit.id });
      setMenu({ id: hit.id, x: sx, y: sy });
    }
  };

  const handleTarget = (hit: ReturnType<typeof hitTest>) => {
    const t = targeting!;
    if ('connectFrom' in t) {
      if (hit?.kind === 'node' && hit.id !== t.connectFrom) {
        useDoc.getState().connect(t.connectFrom, hit.id);
        haptic('light');
        setSheet({ k: 'edge', id: `${t.connectFrom}->${hit.id}` });
      }
      setTargeting(null);
      return;
    }
    if ('pickBreak' in t) {
      const id = hit?.kind === 'container-header' ? hit.id : hit?.id;
      if (id && hit?.kind !== 'edge') {
        haptic('select');
        setTargeting(null);
        setSheet({ k: 'chaos', node: id });
      }
      return;
    }
    if ('sendOne' in t) {
      if (hit?.kind === 'node') {
        setSender(hit.id);
        controller.send(hit.id, sendOp);
      }
      setTargeting(null);
      return;
    }
    const def = t.def;
    const id = hit?.kind === 'container-header' ? hit.id : hit?.id;
    if (!id) return;
    const needsTwo = def.target === 'pair';
    if (needsTwo && !t.first) {
      haptic('select');
      setTargeting({ ...t, first: id });
      return;
    }
    const isSource = doc?.scenario?.sources.find(sx => sx.node === id)?.id;
    const ev = buildChaosEvent(def, t.params, t.dur, needsTwo ? t.first : id, needsTwo ? id : undefined, isSource);
    fireOrSchedule(ev, def, !!t.schedule);
    setTargeting(null);
  };

  const fireOrSchedule = (ev: ChaosEvent | TrafficEvent, def: ChaosDef, schedule: boolean) => {
    if (schedule || !run.active) {
      const at = run.active ? Math.round(run.t / 1000) : 30;
      useDoc.getState().commit(d => {
        d.scenario = d.scenario ?? { sources: [], events: [] };
        d.scenario.events.push({ atSec: at, event: ev });
      });
      toast({ text: `${def.label} scheduled at ${fmtClock(at * 1000)}`, tone: 'chaos', icon: 'calendar-clock' });
      return;
    }
    const id = controller.fire(ev);
    const dur = (ev as ChaosEvent).durationSec;
    toast({ text: `${def.label}${dur ? ` for ${dur}s` : ''}`, tone: 'chaos', icon: def.icon, action: id !== undefined ? { label: 'Heal', onPress: () => controller.heal(id) } : undefined });
  };


  // ---------- palette drag ghost ----------
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostOn = useSharedValue(0);
  const [ghost, setGhost] = useState<PaletteItem | null>(null);
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: withTiming(ghostOn.value, { duration: 120 }),
    transform: [{ translateX: ghostX.value - 66 }, { translateY: ghostY.value - 28 }, { scale: withSpring(ghostOn.value ? 1 : 0.85, spring) }],
  }));
  const dropAt = (item: PaletteItem, sx: number, sy: number) => {
    const wx = (sx - tx.value) / s.value;
    const wy = (sy - ty.value) / s.value;
    useDoc.getState().addNode(item.type, item.skin, { x: wx, y: wy });
    haptic('light');
  };
  const placeCenter = (item: PaletteItem) => {
    const cx = (W / 2 - tx.value) / s.value;
    const cy = (H / 2 - 80 - ty.value) / s.value;
    const d = useDoc.getState().doc!;
    let y = cy;
    while (d.nodes.some(n => Math.abs(n.pos.x - cx) < 100 && Math.abs(n.pos.y - y) < 60)) y += 72;
    const id = useDoc.getState().addNode(item.type, item.skin, { x: cx, y });
    haptic('light');
    setSheet({ k: 'node', id });
  };

  // ---------- render ----------
  if (!doc || !layout || doc.id !== myDocId) return <View style={{ flex: 1, backgroundColor: c.canvas }} />;
  const isEmpty = doc.nodes.length === 0;
  const snap = run.snapshot;
  const targets = targeting && 'pickBreak' in targeting ? new Set([...layout.nodes.map(n => n.id), ...layout.containers.map(ct => ct.id)]) : targeting && 'def' in targeting ? targetSet(targeting, layout) : targeting && ('connectFrom' in targeting || 'sendOne' in targeting) ? new Set(layout.nodes.filter(n => ('sendOne' in targeting ? /client|device|bot$/.test(n.type) : n.id !== (targeting as any).connectFrom)).map(n => n.id)) : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <SystemCanvas
        layout={layout}
        camera={camera}
        mode={mode}
        selection={selection}
        multi={multi}
        snapshot={snap}
        flights={flightsSV}
        simTime={simTime}
        anchors={anchorsSV}
        targets={targets}
        heat={reduceMotion}
        labels={labels}
        onTap={onTap}
        onDoubleTap={onDoubleTap}
        onLongPress={onLongPress}
        onMoveNode={(id, x, y) => !readOnly && mode === 'build' && useDoc.getState().moveNode(id, { x, y }, true)}
        onMoveContainer={(id, dx, dy) => !readOnly && mode === 'build' && useDoc.getState().moveContainer(id, dx, dy, true)}
        onConnect={(a, b) => {
          const id = useDoc.getState().connect(a, b);
          haptic('light');
          if (id) setSheet({ k: 'edge', id });
        }}
        onDragStart={() => haptic('select')}
      />

      {isEmpty && !run.active && (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={[styles.empty, { top: H * 0.3 }]} pointerEvents="box-none">
          <Icon name="waypoints" size={34} color={c.text3} />
          <Text v="headline" style={{ textAlign: 'center' }}>
            Tap + to add a component,{'\n'}or start from a template.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <Button kind="primary" title="Add component" icon="plus" onPress={() => setSheet({ k: 'palette' })} />
          </View>
        </Animated.View>
      )}

      {mode === 'build' ? (
        <View style={[styles.bottomRow, { bottom: insets.bottom + 10 }]} pointerEvents="box-none">
          <Glass style={styles.bar}>
            <IconButton name="chevron-left" onPress={() => nav.goBack()} label="Back" />
            <Text v="headline" numberOfLines={1} style={{ flex: 1, paddingHorizontal: 2 }}>
              {route.params.breadcrumb ? route.params.breadcrumb.join(' › ') : doc.name}
            </Text>
            {!readOnly && <IconButton name="plus" onPress={() => setSheet({ k: 'palette' })} label="Add component" />}
            <IconButton name="ellipsis" onPress={() => setTitleMenu(!titleMenu)} label="More" />
          </Glass>
          <Pressable accessibilityLabel="Run" onPress={() => { haptic('medium'); startRun(); }} style={({ pressed }) => [styles.round, { backgroundColor: c.accent }, pressed && { transform: [{ scale: 0.94 }] }]}>
            <Icon name="play" size={24} color={c.onAccent} strokeWidth={2.6} />
          </Pressable>
        </View>
      ) : (
        <View style={[styles.runDock, { bottom: insets.bottom + 10 }]} pointerEvents="box-none">
          {/* playback: what the dots do */}
          <Glass style={styles.transport}>
            <BarBtn icon="step-back" label="Back" disabled={!run.canBack || run.rewinding} onPress={() => { haptic('select'); controller.stepBack(); }} />
            <BarBtn
              icon={run.ended ? 'rotate-ccw' : run.playing ? 'pause' : 'play'}
              label={run.ended ? 'Replay' : run.playing ? 'Pause' : 'Play'}
              big
              onPress={() => { haptic('select'); if (run.ended) controller.replay(); else if (run.playing) controller.pause(); else controller.play(); }}
            />
            <BarBtn icon="step-forward" label="Next" disabled={run.ended} onPress={() => { haptic('select'); controller.stepForward(); }} />
            <View style={[styles.sep, { backgroundColor: c.hairlineStrong }]} />
            <BarBtn
              text={`${run.speed}×`}
              label="Speed"
              tone={run.overloaded ? c.warn : undefined}
              onPress={() => { haptic('select'); controller.setSpeed(QUICK_SPEEDS[(QUICK_SPEEDS.indexOf(run.speed) + 1) % QUICK_SPEEDS.length]); }}
              onLongPress={() => setSpeedMenu(true)}
            />
          </Glass>
          {/* actions: what the user does to the system */}
          <View style={styles.actions}>
            <Glass style={styles.roundSm}>
              <IconButton name="chevron-left" onPress={() => nav.goBack()} label="Back" />
            </Glass>
            <Glass style={styles.roundSm}>
              <IconButton name="ellipsis" onPress={() => setTitleMenu(!titleMenu)} label="More" />
            </Glass>
            <View style={{ flex: 1 }} />
            <Pressable accessibilityLabel="Break something" onPress={() => setTargeting({ pickBreak: true })} style={({ pressed }) => [styles.pill, { backgroundColor: c.fail }, pressed && { transform: [{ scale: 0.95 }] }]}>
              <Icon name="zap" size={20} color="#fff" strokeWidth={2.4} />
              <Text v="headline" color="#fff">Break</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Send a request"
              accessibilityHint="Long press for writes, several at once, or another client"
              disabled={run.ended || !sender}
              onPress={() => { haptic('medium'); sender && controller.send(sender, sendOp); }}
              onLongPress={() => (haptic('select'), setSendMenu(true))}
              style={({ pressed }) => [styles.pill, { backgroundColor: c.accent }, (run.ended || !sender) && { opacity: 0.4 }, pressed && { transform: [{ scale: 0.95 }] }]}
            >
              <Icon name={sendOp === 'write' ? 'pencil' : 'send'} size={20} color={c.onAccent} strokeWidth={2.6} />
              <Text v="headline" color={c.onAccent}>Send</Text>
              {run.pending > 0 && (
                <View style={[styles.badge, { backgroundColor: c.surface2, borderColor: c.accent }]}>
                  <Mono style={{ fontSize: 11 }}>{run.pending}</Mono>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {/* one plain-English status line while running */}
      {mode === 'run' && snap && (
        <Animated.View entering={FadeIn} style={[styles.statusWrap, { top: insets.top + 6 }]} pointerEvents="box-none">
          <StatusLine onPress={() => nav.navigate('Metrics')} names={nameOf} />
        </Animated.View>
      )}

      {mode === 'run' && requestTips && layout && (
        <RequestTip
          doc={doc}
          layout={layout}
          camera={camera}
          top={insets.top + 54 + (route.params.guide ? 56 : 0)}
          bottom={insets.bottom + 136}
          sender={sender}
          onOpen={h => {
            if (run.playing) controller.pause();
            setSheet({ k: 'hop', hop: h });
          }}
          onClose={() => {
            useSettings.getState().set({ requestTips: false });
            toast({ text: 'Request tips hidden · ⋯ to show again', tone: 'info', icon: 'eye-off' });
          }}
        />
      )}

      {sendMenu && (
        <Menu
          at={{ bottom: insets.bottom + 72, right: 12 }}
          items={[
            { label: 'Read request (GET)', icon: 'eye', on: () => { setSendOp('read'); sender && controller.send(sender, 'read'); } },
            { label: 'Write request (POST)', icon: 'pencil', on: () => { setSendOp('write'); sender && controller.send(sender, 'write'); } },
            { label: 'Send 5 at once', icon: 'layers', on: () => { for (let k = 0; k < 5; k++) sender && controller.send(sender, sendOp); } },
            { label: 'Send from…', icon: 'mouse-pointer-click', on: () => setTargeting({ sendOne: true }) },
          ]}
          onClose={() => setSendMenu(false)}
        />
      )}

      {titleMenu && (
        <Menu
          at={mode === 'run' ? { bottom: insets.bottom + 72, left: 12 } : { bottom: insets.bottom + 72, right: 12 }}
          items={[
            { label: 'Stop simulation', icon: 'square', on: stopRun, hidden: mode === 'build', destructive: true },
            { label: 'Traffic', icon: 'activity', on: () => setSheet({ k: 'traffic' }) },
            { label: 'Send from…', icon: 'send', on: () => setTargeting({ sendOne: true }), hidden: mode === 'build' },
            { label: 'Show request tips', icon: 'message-square-text', on: () => useSettings.getState().set({ requestTips: true }), hidden: mode === 'build' || requestTips },
            { label: 'Events', icon: 'scroll-text', on: () => setSheet({ k: 'log' }), hidden: mode === 'build' },
            { label: 'Metrics', icon: 'line-chart', on: () => nav.navigate('Metrics'), hidden: mode === 'build' },
            { label: 'Timeline', icon: 'history', on: () => setSheet({ k: 'timeline' }), hidden: mode === 'build' },
            { label: 'Protocol messages', icon: 'list-ordered', on: () => setSheet({ k: 'sequence' }), hidden: mode === 'build' },
            { label: 'Connect…', icon: 'spline', on: () => selection?.kind === 'node' && setTargeting({ connectFrom: selection.id }), hidden: mode === 'run' || readOnly || selection?.kind !== 'node' },
            { label: 'Group…', icon: 'square-dashed', on: () => { setGroupKind(null); useDoc.getState().setMulti(selection?.kind === 'node' ? [selection.id] : []); }, hidden: mode === 'run' || readOnly },
            { label: 'Undo', icon: 'undo-2', on: () => useDoc.getState().undo(), hidden: mode === 'run' || readOnly || !past },
            { label: 'Redo', icon: 'redo-2', on: () => useDoc.getState().redo(), hidden: mode === 'run' || readOnly || !future },
            { label: 'Make a copy to edit', icon: 'copy-plus', on: makeCopy, hidden: !readOnly || mode === 'run' },
            { label: 'Rename…', icon: 'pencil', on: () => Alert.prompt('Rename system', undefined, t => t?.trim() && useDoc.getState().rename(doc.id, t.trim()), 'plain-text', doc.name), hidden: readOnly || mode === 'run' },
            { label: 'Fit to screen', icon: 'maximize', on: () => fit() },
            { label: labels ? 'Hide details on nodes' : 'Show details on nodes', icon: labels ? 'eye-off' : 'eye', on: () => useSettings.getState().set({ labels: !labels }) },
            { label: 'Component list', icon: 'list', on: () => setSheet({ k: 'list' }) },
            { label: `Warnings (${warnings.length})`, icon: 'triangle-alert', on: () => setSheet({ k: 'warnings' }), hidden: !warnings.length },
            { label: 'Share…', icon: 'share', on: () => Share.share({ message: JSON.stringify(doc, null, 1), title: `${doc.name}.dsim.json` }) },
          ]}
          onClose={() => setTitleMenu(false)}
        />
      )}
      {speedMenu && (
        <Menu
          at={{ bottom: insets.bottom + 140, left: 12 }}
          items={SPEEDS.map(sp => ({ label: `Animation ×${sp}`, icon: sp === run.speed ? 'check' : 'gauge', on: () => controller.setSpeed(sp) }))}
          onClose={() => setSpeedMenu(false)}
        />
      )}

      {/* banners */}
      {(targeting || multi) && (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={[styles.banner, { top: insets.top + (mode === 'run' ? 54 : 8), backgroundColor: c.surface2, borderColor: c.accent }]}>
          <Icon name={multi ? 'square-dashed-mouse-pointer' : targeting && 'def' in targeting ? targeting.def.icon : 'mouse-pointer-click'} size={18} color={c.accent} />
          <Text v="callout" style={{ flex: 1, fontSize: 14 }}>
            {multi ? `Tap components to group · ${multi.length} selected` : bannerText(targeting!)}
          </Text>
          {multi ? (
            <>
              <Button small kind="text" title="Cancel" onPress={() => useDoc.getState().setMulti(null)} />
              <Button small kind="primary" title="Group" disabled={!multi.length} onPress={() => setSheet({ k: 'group' })} />
            </>
          ) : (
            <>
              {targeting && 'pickBreak' in targeting && <Button small kind="text" title="All faults" onPress={() => { setTargeting(null); setSheet({ k: 'chaos' }); }} />}
              <Button small kind="text" title="Cancel" onPress={() => setTargeting(null)} />
            </>
          )}
        </Animated.View>
      )}

      {/* warnings chip */}
      {mode === 'build' && warnings.length > 0 && !sheet && (
        <View style={[styles.warnChip, { bottom: insets.bottom + 80 }]}>
          <Chip icon="triangle-alert" text={String(warnings.length)} tone={c.warn} onPress={() => setSheet({ k: 'warnings' })} />
        </View>
      )}

      {screenReader && !sheet && (
        <View style={[styles.warnChip, { left: 16, right: undefined, bottom: insets.bottom + 80 }]}>
          <Chip icon="list" text="Components" onPress={() => setSheet({ k: 'list' })} />
        </View>
      )}

      {/* guide overlay (lessons / challenges) */}
      {route.params.guide && <GuideLayer guide={route.params.guide} top={insets.top + (mode === 'run' ? 54 : 8)} />}

      {ghost && (
        <Animated.View pointerEvents="none" style={[styles.ghost, { backgroundColor: c.surface1, borderColor: c.accent }, ghostStyle]}>
          <Icon name={nodeIcon(ghost.type, ghost.skin)} size={20} />
          <Text v="headline" style={{ fontSize: 13 }}>
            {ghost.label}
          </Text>
        </Animated.View>
      )}

      {menu && (
        <Menu
          at={{ top: Math.min(menu.y + 8, H - 320), left: Math.min(Math.max(12, menu.x - 90), W - 220) }}
          items={[
            { label: 'Connect to…', icon: 'spline', on: () => setTargeting({ connectFrom: menu.id }), hidden: mode === 'run' || readOnly },
            { label: 'Duplicate', icon: 'copy', on: () => useDoc.getState().duplicate(menu.id), hidden: mode === 'run' || readOnly },
            { label: 'Send a request from here', icon: 'send', on: () => { setSender(menu.id); controller.send(menu.id, sendOp); }, hidden: mode === 'build' || !/client|device|bot$/.test(doc.nodes.find(n => n.id === menu.id)?.type ?? '') },
            { label: 'Fire chaos…', icon: 'zap', on: () => setSheet({ k: 'chaos' }), hidden: mode === 'build' },
            { label: 'Host (CPU, memory)', icon: 'cpu', on: () => setSheet({ k: 'host', id: menu.id }), hidden: /client|device|bot$/.test(doc.nodes.find(n => n.id === menu.id)?.type ?? '') },
            { label: 'Show protocol', icon: 'list-ordered', on: () => setSheet({ k: 'sequence', node: menu.id }), hidden: mode === 'build' },
            { label: 'Inspect', icon: 'sliders-horizontal', on: () => openNode(menu.id) },
            { label: 'Delete', icon: 'trash-2', on: () => useDoc.getState().remove({ kind: 'node', id: menu.id }), destructive: true, hidden: mode === 'run' || readOnly },
          ]}
          onClose={() => setMenu(null)}
        />
      )}

      <ToastHost top={insets.top + (mode === 'run' ? 54 : 8) + (route.params.guide ? 44 : 0)} />

      {sheet && (
        <SheetHost
          key={sheetKey(sheet)}
          sheet={sheet}
          sheetRef={sheetRef}
          onClose={() => {
            setSheet(null);
            if (sheet.k === 'node' || sheet.k === 'edge' || sheet.k === 'container') useDoc.getState().select(null);
          }}
          palette={{
            onPlace: placeCenter,
            onDragStart: (item, x, y) => {
              setGhost(item);
              ghostX.value = x;
              ghostY.value = y;
              ghostOn.value = 1;
              sheetRef.current?.snapToIndex?.(0);
            },
            onDragMove: (x, y) => {
              ghostX.value = x;
              ghostY.value = y;
            },
            onDragEnd: (x, y) => {
              ghostOn.value = 0;
              const item = ghost;
              setTimeout(() => setGhost(null), 140);
              if (y < H * 0.62 && item) {
                dropAt(item, x, y);
                setSheet(null);
              }
            },
            onGroup: kind => {
              setGroupKind(kind);
              setSheet(null);
              useDoc.getState().setMulti([]);
            },
          }}
          groupKind={groupKind}
          onTraffic={ev => {
            setSheet(null);
            controller.fire(ev);
            toast({ text: `${ev.action === 'burst' ? 'Burst' : ev.action.replace('-', ' ')} from ${nameOf(doc!.scenario?.sources.find(s => s.id === ev.source)?.node ?? ev.source?.replace(/^src-/, '') ?? '')}`, tone: 'chaos', icon: 'activity' });
          }}
          onPickChaos={(def, node) => {
            // one tap: with a chosen component and a fault that needs nothing else, fire right away with defaults
            if (node && def.target !== 'pair' && run.active) {
              const params = Object.fromEntries((def.params ?? []).map(pp => [pp.key, Number(pp.default)]));
              const src = doc!.scenario?.sources.find(sx => sx.node === node)?.id;
              setSheet(null);
              fireOrSchedule(buildChaosEvent(def, params, def.defaultDurationSec ?? undefined, node, undefined, src), def, false);
              return;
            }
            setSheet({ k: 'chaos-params', def, node });
          }}
          onChaosGo={(def, params, dur, node) => {
            setSheet(null);
            if (node && def.target === 'pair') setTargeting({ def, params, dur, first: node, schedule: !run.active });
            else if (node) fireOrSchedule(buildChaosEvent(def, params, dur, node, undefined, doc!.scenario?.sources.find(sx => sx.node === node)?.id), def, !run.active);
            else if (def.target === 'none') {
              const ev = buildChaosEvent(def, params, dur);
              fireOrSchedule(ev, def, !run.active);
            } else setTargeting({ def, params, dur, schedule: !run.active });
          }}
          onJump={(t, node) => {
            controller.rewind(t);
            if (node) useDoc.getState().select({ kind: 'node', id: node });
            setSheet(null);
          }}
          openMetrics={() => nav.navigate('Metrics')}
          onConnectFrom={id => {
            setSheet(null);
            setTargeting({ connectFrom: id });
          }}
          warnings={warnings}
          onWarning={w => {
            if (w.edgeId) {
              useDoc.getState().select({ kind: 'edge', id: w.edgeId });
              setSheet({ k: 'edge', id: w.edgeId });
            } else if (w.nodeId) openNode(w.nodeId);
          }}
          onOpenTrace={id => setSheet({ k: 'trace', id })}
          onDrill={id => drillInto(id)}
          onHost={id => setSheet({ k: 'host', id })}
          onOpenChaos={() => setSheet({ k: 'chaos' })}
          onEditEdge={eid => { useDoc.getState().select({ kind: 'edge', id: eid }); setSheet({ k: 'edge', id: eid }); }}
        />
      )}
    </View>
  );

  async function makeCopy() {
    const copy = forkDoc(doc!, `${doc!.name} (copy)`);
    await saveSystem(copy);
    toast({ text: 'Saved to Mine — you can edit the copy', tone: 'ok', icon: 'copy-plus' });
    nav.replace('Editor', { doc: copy });
  }

  function drillInto(id: string) {
    const n = doc!.nodes.find(x => x.id === id);
    const skin = catalog.skins.find(sk => sk.name === n?.skin);
    if (!skin?.internals) return;
    nav.push('Editor', { doc: { ...skin.internals, name: `${n!.name} (${skin.label})` }, readOnly: true, autoRun: run.active, breadcrumb: [doc!.name, `${n!.name} (${skin.label})`] });
  }
}

function sheetKey(s: NonNullable<SheetKind>) {
  return s.k === 'node' || s.k === 'edge' || s.k === 'container' ? `${s.k}:${s.id}` : s.k;
}

function bannerText(t: NonNullable<Targeting>): string {
  if ('connectFrom' in t) return 'Tap a component to connect to';
  if ('sendOne' in t) return 'Tap a client to send one request';
  if ('pickBreak' in t) return 'Tap what to break, or a client for a burst';
  if (t.def.target === 'pair') return t.first ? 'Tap the other side' : `${t.def.label}: tap the first side`;
  if (t.def.target === 'container') return `${t.def.label}: tap a region, zone or cell`;
  if (t.def.target === 'edge') return `${t.def.label}: tap a connection or component`;
  if (t.def.target === 'source') return `${t.def.label}: tap a client`;
  return `${t.def.label}: tap a component${t.schedule ? ' (scheduled)' : ''}`;
}

function targetSet(t: { def: ChaosDef; first?: string }, layout: ReturnType<typeof computeLayout>): Set<string> {
  const def = t.def;
  const out = new Set<string>();
  const applies = (type: string) => def.appliesTo === 'any' || !Array.isArray(def.appliesTo) || def.appliesTo.includes(type);
  if (def.target === 'container') {
    for (const ct of layout.containers) out.add(ct.id);
    return out;
  }
  for (const n of layout.nodes) {
    if (n.id === t.first) continue;
    if (def.target === 'source' ? /client|device|bot$/.test(n.type) : applies(n.type)) out.add(n.id);
  }
  if (def.target === 'pair') for (const ct of layout.containers) out.add(ct.id);
  return out;
}

/** One sentence that says what's happening right now. */
function StatusLine({ onPress, names }: { onPress: () => void; names: (id: string) => string }) {
  const { c } = useTheme();
  const snap = useRun(st => st.snapshot);
  if (!snap) return null;
  const nodes = Object.values(snap.nodes);
  const down = nodes.find(n => !n.up);
  const failing = nodes.filter(n => n.up && n.errRate > 0.05).sort((a, b) => b.errRate - a.errRate)[0];
  const hot = nodes.filter(n => n.up && n.util > 0.9).sort((a, b) => b.util - a.util)[0];
  const avail = snap.system.availability;
  const p99 = snap.system.p99;
  let tone = c.ok;
  let text: string;
  if (snap.system.rps === 0 && p99 === 0) {
    tone = c.text3;
    text = snap.flights.length ? 'Requests flowing — first numbers in a moment' : 'Starting — first requests on their way';
  } else if (down) {
    tone = c.fail;
    text = `${names(down.id)} is down${avail < 99.5 ? ` — ${(100 - avail).toFixed(0)}% of requests fail` : ''}`;
  } else if (avail < 99) {
    tone = c.fail;
    text = `${(100 - avail).toFixed(1)}% of requests fail${failing ? ` at ${names(failing.id)}` : ''}`;
  } else if (hot) {
    tone = c.warn;
    text = `${names(hot.id)} is overloaded — users wait ${fmtMs(p99)}`;
  } else if (snap.anomalyTotal > 0) {
    tone = c.protocol;
    const top = Object.entries(snap.anomalies).sort((a, b) => b[1] - a[1])[0];
    text = `${Math.round(snap.anomalyTotal)} data problems${top ? ` (${top[0].replace(/-/g, ' ')})` : ''}`;
  } else {
    text = `All good · ${fmtMs(p99)} · ${avail.toFixed(avail >= 99.99 ? 0 : 2)}%`;
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${text}. Open metrics`}>
      <Glass style={styles.status}>
        <View style={[styles.statusDot, { backgroundColor: tone }]} />
        <Text v="callout" numberOfLines={1} style={{ fontSize: 14, flexShrink: 1 }}>
          {text}
        </Text>
        {snap.chaos.length > 0 && (
          <Text v="callout" color={c.warn} style={{ fontSize: 13 }}>
            · {snap.chaos.length} fault{snap.chaos.length > 1 ? 's' : ''}
          </Text>
        )}
      </Glass>
    </Pressable>
  );
}

function DockBtn({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        haptic('light');
        onPress();
      }}
      style={({ pressed }) => [styles.dockBtn, pressed && { opacity: 0.55 }, disabled && { opacity: 0.35 }]}
    >
      <Icon name={icon} size={21} color={c.text} />
      <Text v="callout" color={c.text2} style={{ fontSize: 10, marginTop: 2 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function TimelineStrip({ onOpen }: { onOpen: () => void }) {
  const { c } = useTheme();
  const { t, duration, playing, ended, rewinding } = useRun(useShallow(s => ({ t: s.t, duration: s.duration, playing: s.playing, ended: s.ended, rewinding: s.rewinding })));
  useRun(s => s.eventCount);
  const events = controller.run?.events() ?? [];
  const marks = events.filter(e => e.kind === 'chaos' || e.kind === 'alert').slice(-40);
  const [w, setW] = useState(1);
  const scrub = (x: number) => controller.rewind(Math.max(0, Math.min(1, x / w)) * duration);
  return (
    <Glass radius={18} style={styles.strip}>
      <IconButton name={ended ? 'rotate-ccw' : playing ? 'pause' : 'play'} size={18} onPress={() => (ended ? controller.replay() : playing ? controller.pause() : controller.play())} label={playing ? 'Pause' : 'Play'} />
      <IconButton name="skip-forward" size={16} onPress={() => controller.stepBy(1000)} label="Step 1 second" />
      <Pressable style={{ flex: 1, height: 36, justifyContent: 'center' }} onLayout={e => setW(e.nativeEvent.layout.width)} onPress={e => scrub(e.nativeEvent.locationX)} onLongPress={onOpen}>
        <View style={[styles.track, { backgroundColor: c.hairlineStrong }]}>
          <View style={{ width: `${Math.min(100, (t / Math.max(1, duration)) * 100)}%`, height: '100%', backgroundColor: c.accent, borderRadius: 2 }} />
        </View>
        {marks.map((m, i) => (
          <View key={i} style={[styles.mark, { left: `${Math.min(100, (m.t / duration) * 100)}%`, backgroundColor: m.kind === 'alert' ? c.fail : c.warn }]} />
        ))}
        <View style={[styles.head, { left: `${Math.min(100, (t / Math.max(1, duration)) * 100)}%`, backgroundColor: c.text }]} />
      </Pressable>
      <Mono color={c.text2} style={{ fontSize: 12, width: 46, textAlign: 'right' }}>
        {rewinding ? '⏪' : fmtClock(t)}
      </Mono>
      <IconButton name="chevron-up" size={18} onPress={onOpen} label="Open timeline" />
    </Glass>
  );
}

function Menu({ at, items, onClose }: { at: { top?: number; bottom?: number; left?: number; right?: number }; items: { label: string; icon: string; on: () => void; destructive?: boolean; hidden?: boolean }[]; onClose: () => void }) {
  const { c } = useTheme();
  const shown = items.filter(i => !i.hidden);
  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)} style={[styles.menu, { top: at.top, bottom: at.bottom, left: at.left, right: at.right, backgroundColor: c.surface2, borderColor: c.hairlineStrong }]}>
        <ScrollView style={{ maxHeight: 470 }} bounces={false}>
        {shown.map((it, i) => (
          <Pressable
            key={it.label}
            onPress={() => {
              onClose();
              haptic('select');
              it.on();
            }}
            style={({ pressed }) => [styles.menuItem, i < shown.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }, pressed && { backgroundColor: c.hairline }]}
          >
            <Text style={{ flex: 1, color: it.destructive ? c.fail : c.text }}>{it.label}</Text>
            <Icon name={it.icon} size={17} color={it.destructive ? c.fail : c.text2} />
          </Pressable>
        ))}
        </ScrollView>
      </Animated.View>
    </>
  );
}

// ---------- sheet host ----------

function SheetHost(p: {
  sheet: NonNullable<SheetKind>;
  sheetRef: React.MutableRefObject<any>;
  onClose: () => void;
  palette: React.ComponentProps<typeof PaletteContent>;
  groupKind: string | null;
  onPickChaos: (d: ChaosDef, node?: string) => void;
  onTraffic: (ev: TrafficEvent) => void;
  onChaosGo: (d: ChaosDef, params: Record<string, number>, dur?: number, node?: string) => void;
  onJump: (t: number, node?: string) => void;
  openMetrics: () => void;
  onConnectFrom: (id: string) => void;
  warnings: any[];
  onWarning: (w: any) => void;
  onOpenTrace: (id: number) => void;
  onDrill: (id: string) => void;
  onHost: (id: string) => void;
  onOpenChaos: () => void;
  onEditEdge: (id: string) => void;
}) {
  const { c } = useTheme();
  const running = useRun(s => s.active);
  const { sheet } = p;
  const common = { ref: p.sheetRef, onClose: p.onClose };
  switch (sheet.k) {
    case 'palette':
      return (
        <Sheet {...common} snapPoints={['52%', '90%']} title="Add component">
          <PaletteContent {...p.palette} />
        </Sheet>
      );
    case 'node': {
      const n = useDoc.getState().doc?.nodes.find(x => x.id === sheet.id);
      const composite = !!catalog.skins.find(sk => sk.name === n?.skin)?.internals;
      return (
        <Sheet {...common} snapPoints={['40%', '62%', '92%']} index={running ? 1 : 1}>
          <NodeInspector id={sheet.id} onEditEdge={eid => p.onEditEdge(eid)} onHost={() => p.onHost(sheet.id)} onOpenMetrics={p.openMetrics} onFireChaos={() => p.onOpenChaos()} onConnect={() => p.onConnectFrom(sheet.id)} onDrill={composite ? () => p.onDrill(sheet.id) : undefined} />
        </Sheet>
      );
    }
    case 'edge':
      return (
        <Sheet {...common} snapPoints={['45%', '85%']}>
          <EdgeInspector id={sheet.id} />
        </Sheet>
      );
    case 'container':
      return (
        <Sheet {...common} snapPoints={['40%', '80%']}>
          <ContainerInspector id={sheet.id} />
        </Sheet>
      );
    case 'group':
      return (
        <Sheet {...common} snapPoints={['62%']} title={`Group ${useDoc.getState().multi?.length ?? 0} components`}>
          <GroupContent initial={p.groupKind} onDone={p.onClose} />
        </Sheet>
      );
    case 'traffic':
      return (
        <Sheet {...common} snapPoints={['50%', '90%']} title="Traffic">
          <TrafficContent />
        </Sheet>
      );
    case 'chaos':
      return (
        <Sheet {...common} snapPoints={sheet.node ? ['52%', '85%'] : ['60%', '92%']} title={sheet.node ? `Break ${useDoc.getState().doc?.nodes.find(n => n.id === sheet.node)?.name ?? useDoc.getState().doc?.containers.find(x => x.id === sheet.node)?.name ?? ''}` : running ? 'Break something' : 'Schedule a fault'} subtitle={running ? undefined : 'Happens at 0:30 in every run'}>
          <ChaosContent onPick={def => p.onPickChaos(def, sheet.node)} onTraffic={running ? p.onTraffic : undefined} scheduling={!running} node={sheet.node} />
        </Sheet>
      );
    case 'chaos-params':
      return (
        <Sheet {...common} snapPoints={['48%']}>
          <ChaosParams def={sheet.def} onGo={(params, dur) => p.onChaosGo(sheet.def, params, dur, sheet.node)} onCancel={p.onClose} />
        </Sheet>
      );
    case 'log':
      return (
        <Sheet {...common} snapPoints={['55%', '92%']} title="Events">
          <EventLogContent onJump={p.onJump} />
        </Sheet>
      );
    case 'timeline':
      return (
        <Sheet {...common} snapPoints={['55%', '90%']} title="Timeline">
          <TimelineContent onAdd={p.onOpenChaos} />
        </Sheet>
      );
    case 'trace':
      return (
        <Sheet {...common} snapPoints={['55%', '92%']}>
          <TraceContent id={sheet.id} />
        </Sheet>
      );
    case 'sequence':
      return (
        <Sheet {...common} snapPoints={['60%', '92%']} title="Protocol">
          <SequenceContent node={sheet.node} />
        </Sheet>
      );
    case 'hop':
      return (
        <Sheet {...common} snapPoints={['44%', '80%']}>
          <HopDetails h={sheet.hop} onTrace={p.onOpenTrace} />
        </Sheet>
      );
    case 'dot':
      return (
        <Sheet {...common} snapPoints={['46%', '80%']}>
          <DotDetails f={sheet.flight} onTrace={p.onOpenTrace} />
        </Sheet>
      );
    case 'host':
      return (
        <Sheet {...common} snapPoints={['62%', '92%']}>
          <HostView id={sheet.id} />
        </Sheet>
      );
    case 'list':
      return (
        <Sheet {...common} snapPoints={['60%', '92%']} title="Components">
          <ComponentList onPick={id => p.onWarning({ nodeId: id })} />
        </Sheet>
      );
    case 'warnings':
      return (
        <Sheet {...common} snapPoints={['50%', '85%']} title={`${p.warnings.length} warnings`}>
          {p.warnings.map((w: any) => (
            <Pressable key={w.id} onPress={() => p.onWarning(w)} style={({ pressed }) => [styles.warnRow, { borderColor: w.severity === 'warn' ? c.warn : c.hairlineStrong, backgroundColor: c.surface1 }, pressed && { opacity: 0.6 }]}>
              <Icon name={w.severity === 'warn' ? 'triangle-alert' : 'info'} size={17} color={w.severity === 'warn' ? c.warn : c.accent} />
              <View style={{ flex: 1 }}>
                <Text v="callout" style={{ fontSize: 14 }}>
                  {w.message}
                </Text>
                {w.help ? (
                  <Text v="callout" color={c.text2} style={{ marginTop: 3 }}>
                    {w.help}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </Sheet>
      );
  }
}

function ComponentList({ onPick }: { onPick: (id: string) => void }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc);
  const snap = useRun(s => s.snapshot);
  if (!doc) return null;
  return (
    <View>
      {doc.nodes.map(n => {
        const ns = snap?.nodes[n.id];
        const state = ns ? `${ns.up ? ns.health : 'down'}, p99 ${fmtMs(ns.p99)}, ${Math.round(ns.util * 100)}% busy` : '';
        return (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            accessibilityLabel={`${n.name}, ${n.skin ?? n.type}${state ? ', ' + state : ''}`}
            onPress={() => onPick(n.id)}
            style={({ pressed }) => [styles.radio, { borderBottomColor: c.hairlineStrong }, pressed && { opacity: 0.6 }]}
          >
            <Icon name={nodeIcon(n.type, n.skin)} size={18} />
            <View style={{ flex: 1 }}>
              <Text>{n.name}</Text>
              <Text v="callout" color={c.text3}>
                {n.skin ?? n.type}
                {state ? ` · ${state}` : ''}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function GroupContent({ initial, onDone }: { initial: string | null; onDone: () => void }) {
  const { c } = useTheme();
  const [kind, setKind] = useState<string>(initial ?? 'region');
  const multi = useDoc(s => s.multi) ?? [];
  const def = catalog.containers.find(x => x.kind === kind);
  return (
    <View>
      {catalog.containers.map(ct => (
        <Pressable key={ct.kind} onPress={() => setKind(ct.kind)} style={[styles.radio, { borderBottomColor: c.hairlineStrong }]}>
          <View style={[styles.radioDot, { borderColor: kind === ct.kind ? c.accent : c.text3 }]}>{kind === ct.kind && <View style={[styles.radioIn, { backgroundColor: c.accent }]} />}</View>
          <Icon name={ct.icon} size={18} color={c.text2} />
          <View style={{ flex: 1 }}>
            <Text>{ct.label}</Text>
            <Text v="callout" color={c.text3} numberOfLines={1}>
              {ct.description}
            </Text>
          </View>
        </Pressable>
      ))}
      <Button
        kind="primary"
        title="Group"
        style={{ marginTop: space.l }}
        disabled={!multi.length}
        onPress={() => {
          const name = kind === 'region' ? 'us-east-1' : kind === 'availability-zone' ? 'az-a' : kind === 'bounded-context' ? 'Orders' : kind === 'layer' ? 'Domain' : kind === 'tenant' ? 'acme' : kind === 'cell' ? 'cell-a' : def?.label ?? kind;
          useDoc.getState().group(multi, kind as any, name);
          haptic('success');
          onDone();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { position: 'absolute', left: 32, right: 32, alignItems: 'center', gap: 10 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 14, maxWidth: 360 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  bottomRow: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  bar: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 4 },
  runDock: { position: 'absolute', left: 12, right: 12, gap: 8, alignItems: 'center' },
  transport: { flexDirection: 'row', alignItems: 'center', height: 58, paddingHorizontal: 6, borderRadius: 29 },
  barBtn: { width: 64, height: 54, alignItems: 'center', justifyContent: 'center', gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch' },
  roundSm: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 52, paddingHorizontal: 20, borderRadius: 26, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  round: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  statusWrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  topWrap: { position: 'absolute', left: 12, right: 12 },
  topPill: { flexDirection: 'row', alignItems: 'center', height: 50, paddingHorizontal: 4 },
  titleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, height: 44 },
  clock: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 44 },
  chips: { flexDirection: 'row', gap: 6, paddingRight: 12 },
  banner: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 6, height: 50, borderRadius: 16, borderWidth: 1, zIndex: 40 },
  warnChip: { position: 'absolute', right: 16 },
  dockWrap: { position: 'absolute', left: 12, right: 12, gap: 8 },
  dock: { flexDirection: 'row', alignItems: 'center', height: 64, paddingHorizontal: 6 },
  dockBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 56 },
  sep: { width: StyleSheet.hairlineWidth, height: 32, marginHorizontal: 4 },
  runBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 48, paddingHorizontal: 18, borderRadius: 18, marginLeft: 4 },
  strip: { flexDirection: 'row', alignItems: 'center', height: 44, paddingRight: 2 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  mark: { position: 'absolute', width: 3, height: 12, borderRadius: 1.5, marginLeft: -1.5, top: 12 },
  head: { position: 'absolute', width: 3, height: 18, borderRadius: 1.5, marginLeft: -1.5, top: 9 },
  ghost: { position: 'absolute', top: 0, left: 0, width: 132, height: 56, borderRadius: 14, borderWidth: 2, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16 },
  menu: { position: 'absolute', width: 230, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, zIndex: 60 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 46 },
  warnRow: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  radio: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  radioDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioIn: { width: 10, height: 10, borderRadius: 5 },
});

/** the client that fires requests: the one with configured traffic, else the first client */
function defaultSender(doc: SystemDoc): string | undefined {
  const isClient = (t: string) => /client|device|bot$/.test(t);
  return doc.scenario?.sources.find(x => doc.nodes.some(n => n.id === x.node && isClient(n.type)))?.node ?? doc.nodes.find(n => isClient(n.type))?.id;
}

/** transport button: icon (or text) over a caption, so each control says what it does */
function BarBtn({ icon, text, label, onPress, onLongPress, disabled, big, tone }: { icon?: string; text?: string; label: string; onPress: () => void; onLongPress?: () => void; disabled?: boolean; big?: boolean; tone?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.barBtn, pressed && { opacity: 0.6 }, disabled && { opacity: 0.35 }]}>
      {icon ? <Icon name={icon} size={big ? 26 : 22} color={tone ?? c.text} /> : <Mono style={{ fontSize: 17, lineHeight: 22 }} color={tone ?? c.text}>{text}</Mono>}
      <Text v="caption" style={{ fontSize: 11 }} color={c.text2}>
        {label}
      </Text>
    </Pressable>
  );
}
