import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  BlendMode,
  BlurMask,
  Canvas,
  Circle,
  createPicture,
  DashPathEffect,
  Group,
  ImageSVG,
  Line,
  Path,
  Picture,
  PointMode,
  RoundedRect,
  Skia,
  Text as SkText,
  vec,
  type SkPicture,
  PaintStyle, StrokeCap,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-worklets';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { Snapshot, NodeSnap, EdgeSnap } from '@dsims/engine';
import { useTheme, healthColor, type Colors } from '../theme';
import { font, fit, svgIcon } from './assets';
import type { Layout, RContainer, REdge, RNode } from './layout';
import { NODE_W as WAIT_W, NODE_H as WAIT_H } from '../state/doc';

export interface Camera {
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  s: SharedValue<number>;
}

export type CanvasHit = { kind: 'node' | 'edge' | 'container' | 'container-header'; id: string } | null;

export interface SystemCanvasProps {
  layout: Layout;
  camera: Camera;
  mode: 'build' | 'run';
  selection?: { kind: string; id: string } | null;
  multi?: string[] | null;
  snapshot?: Snapshot | null;
  /** packed flights: [fromIdx, toIdx, t0, t1, op, flags] × n */
  flights?: SharedValue<number[]>;
  simTime?: SharedValue<number>;
  /** node positions for flights, packed [x,y] per node index */
  anchors?: SharedValue<number[]>;
  targets?: Set<string> | null;
  /** followed request: elapsed ms when it reached each component so far */
  stamps?: Record<string, number>;
  dim?: boolean;
  heat?: boolean;
  labels?: boolean;
  onTap?: (x: number, y: number) => void;
  onDoubleTap?: (x: number, y: number) => void;
  onLongPress?: (x: number, y: number, screenX: number, screenY: number) => void;
  onMoveNode?: (id: string, x: number, y: number, final: boolean) => void;
  onMoveContainer?: (id: string, dx: number, dy: number, final: boolean) => void;
  onConnect?: (from: string, to: string) => void;
  onConnectFail?: () => void;
  onDragStart?: () => void;
}

const PORT_R = 7;
/** half-distance between the two directed lanes of a connection */
const LANE = 5;

export function SystemCanvas(p: SystemCanvasProps) {
  const { k: c, dark } = useTheme();
  const { layout, camera } = p;
  const { tx, ty, s } = camera;

  // UI-thread hit-test data
  const nodesSV = useSharedValue<number[]>([]);
  const nodeIds = useSharedValue<string[]>([]);
  const headersSV = useSharedValue<number[]>([]);
  const headerIds = useSharedValue<string[]>([]);
  useEffect(() => {
    const vis = layout.nodes.filter(n => !n.hidden);
    nodesSV.value = vis.flatMap(n => [n.x, n.y, n.w, n.h]);
    nodeIds.value = vis.map(n => n.id);
    const hs = layout.containers.filter(x => !x.hidden);
    headersSV.value = hs.flatMap(x => [x.x, x.y, x.collapsed ? x.w : Math.min(x.w, 220), x.collapsed ? x.h : 30]);
    headerIds.value = hs.map(x => x.id);
  }, [layout, nodesSV, nodeIds, headersSV, headerIds]);

  const selectedNode = p.selection?.kind === 'node' ? p.selection.id : '';
  const selSV = useSharedValue('');
  const buildSV = useSharedValue(p.mode === 'build');
  useEffect(() => {
    selSV.value = selectedNode;
    buildSV.value = p.mode === 'build';
  }, [selectedNode, p.mode, selSV, buildSV]);

  // gesture state
  const gMode = useSharedValue<0 | 1 | 2 | 3 | 4>(0); // 0 none,1 camera,2 drag node,3 drag container,4 connect
  const dragId = useSharedValue('');
  const dragDx = useSharedValue(0);
  const dragDy = useSharedValue(0);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startS = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostTarget = useSharedValue('');
  const connectFrom = useSharedValue<number[]>([0, 0]);
  const pinching = useSharedValue(false);

  const hitNode = (wx: number, wy: number, slop: number) => {
    'worklet';
    const a = nodesSV.value;
    for (let i = a.length / 4 - 1; i >= 0; i--) {
      if (Math.abs(wx - a[i * 4]) <= a[i * 4 + 2] / 2 + slop && Math.abs(wy - a[i * 4 + 1]) <= a[i * 4 + 3] / 2 + slop) return nodeIds.value[i];
    }
    return '';
  };
  const hitHeader = (wx: number, wy: number) => {
    'worklet';
    const a = headersSV.value;
    for (let i = a.length / 4 - 1; i >= 0; i--) {
      if (wx >= a[i * 4] && wx <= a[i * 4] + a[i * 4 + 2] && wy >= a[i * 4 + 1] - 4 && wy <= a[i * 4 + 1] + a[i * 4 + 3]) return headerIds.value[i];
    }
    return '';
  };
  const portOf = (id: string) => {
    'worklet';
    const ids = nodeIds.value;
    for (let i = 0; i < ids.length; i++) if (ids[i] === id) return [nodesSV.value[i * 4] + nodesSV.value[i * 4 + 2] / 2, nodesSV.value[i * 4 + 1]];
    return null;
  };

  const { onDragStart, onMoveNode, onMoveContainer, onConnect, onConnectFail, onTap, onDoubleTap, onLongPress } = p;
  const pan = Gesture.Pan()
    .minDistance(4)
    .maxPointers(1)
    .onStart(e => {
      const wx = (e.x - e.translationX - tx.value) / s.value;
      const wy = (e.y - e.translationY - ty.value) / s.value;
      startTx.value = tx.value;
      startTy.value = ty.value;
      gMode.value = 1;
      if (!buildSV.value) return;
      const sel = selSV.value;
      if (sel) {
        const port = portOf(sel);
        if (port && Math.hypot(wx - port[0], wy - port[1]) < 26 / s.value) {
          gMode.value = 4;
          dragId.value = sel;
          connectFrom.value = port;
          ghostX.value = wx;
          ghostY.value = wy;
          if (onDragStart) runOnJS(onDragStart)();
          return;
        }
      }
      const n = hitNode(wx, wy, 2);
      if (n) {
        gMode.value = 2;
        dragId.value = n;
        dragDx.value = 0;
        dragDy.value = 0;
        if (onDragStart) runOnJS(onDragStart)();
        return;
      }
      const h = hitHeader(wx, wy);
      if (h) {
        gMode.value = 3;
        dragId.value = h;
        dragDx.value = 0;
        dragDy.value = 0;
      }
    })
    .onUpdate(e => {
      if (pinching.value) return;
      if (gMode.value === 1) {
        tx.value = startTx.value + e.translationX;
        ty.value = startTy.value + e.translationY;
      } else if (gMode.value === 2 || gMode.value === 3) {
        dragDx.value = e.translationX / s.value;
        dragDy.value = e.translationY / s.value;
      } else if (gMode.value === 4) {
        ghostX.value = (e.x - tx.value) / s.value;
        ghostY.value = (e.y - ty.value) / s.value;
        const t = hitNode(ghostX.value, ghostY.value, 8);
        ghostTarget.value = t !== dragId.value ? t : '';
      }
    })
    .onEnd(() => {
      const id = dragId.value;
      if (gMode.value === 2 && onMoveNode) {
        const a = nodesSV.value;
        const ids = nodeIds.value;
        for (let i = 0; i < ids.length; i++) {
          if (ids[i] === id) {
            runOnJS(onMoveNode)(id, a[i * 4] + dragDx.value, a[i * 4 + 1] + dragDy.value, true);
            break;
          }
        }
      } else if (gMode.value === 3 && onMoveContainer) {
        runOnJS(onMoveContainer)(id, dragDx.value, dragDy.value, true);
      } else if (gMode.value === 4) {
        if (ghostTarget.value && onConnect) runOnJS(onConnect)(id, ghostTarget.value);
        else if (onConnectFail) runOnJS(onConnectFail)();
      }
    })
    .onFinalize(() => {
      gMode.value = 0;
      ghostTarget.value = '';
      // keep drag offset until layout re-renders with committed position
    });

  // reset drag offset once the committed layout arrives
  useEffect(() => {
    dragId.value = '';
    dragDx.value = 0;
    dragDy.value = 0;
  }, [layout, dragId, dragDx, dragDy]);

  const pinch = Gesture.Pinch()
    .onStart(e => {
      pinching.value = true;
      startS.value = s.value;
      startTx.value = tx.value;
      startTy.value = ty.value;
      focalX.value = e.focalX;
      focalY.value = e.focalY;
    })
    .onUpdate(e => {
      const ns = Math.min(3, Math.max(0.15, startS.value * e.scale));
      const k = ns / startS.value;
      tx.value = focalX.value - (focalX.value - startTx.value) * k + (e.focalX - focalX.value);
      ty.value = focalY.value - (focalY.value - startTy.value) * k + (e.focalY - focalY.value);
      s.value = ns;
    })
    .onFinalize(() => {
      pinching.value = false;
    });

  const tap = Gesture.Tap()
    .maxDuration(300)
    .onEnd(e => {
      if (onTap) runOnJS(onTap)((e.x - tx.value) / s.value, (e.y - ty.value) / s.value);
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(e => {
      if (onDoubleTap) runOnJS(onDoubleTap)((e.x - tx.value) / s.value, (e.y - ty.value) / s.value);
    });
  const longPress = Gesture.LongPress()
    .minDuration(380)
    .onStart(e => {
      if (onLongPress) runOnJS(onLongPress)((e.x - tx.value) / s.value, (e.y - ty.value) / s.value, e.absoluteX, e.absoluteY);
    });

  const gesture = Gesture.Simultaneous(Gesture.Simultaneous(pan, pinch), Gesture.Exclusive(longPress, doubleTap, tap));

  const cam = useDerivedValue(() => [{ translateX: tx.value }, { translateY: ty.value }, { scale: s.value }]);

  // dot grid (world space, regenerated as camera moves)
  const gridPts = useDerivedValue(() => {
    const sc = s.value;
    if (sc < 0.4) return [];
    const step = 24;
    const x0 = Math.floor(-tx.value / sc / step) * step;
    const y0 = Math.floor(-ty.value / sc / step) * step;
    const w = 1400 / sc;
    const h = 2000 / sc;
    const pts = [];
    for (let x = x0; x < x0 + w; x += step) for (let y = y0; y < y0 + h; y += step) pts.push(vec(x, y));
    return pts;
  });
  const gridDim = p.mode === 'run' ? 0.6 : 1;
  const gridOpacity = useDerivedValue(() => Math.min(1, Math.max(0, (s.value - 0.4) / 0.25)) * gridDim);

  const ghostLine = useDerivedValue(() => {
    const path = Skia.Path.Make();
    if (gMode.value === 4) {
      path.moveTo(connectFrom.value[0], connectFrom.value[1]);
      path.lineTo(ghostX.value, ghostY.value);
    }
    return path;
  });
  const ghostOpacity = useDerivedValue(() => (gMode.value === 4 ? 1 : 0));

  const snapNodes = p.snapshot?.nodes;
  const snapEdges = p.snapshot?.edges;
  const visibleContainers = layout.containers.filter(x => !x.hidden);
  const visibleEdges = layout.edges.filter(e => !e.hidden);
  const visibleNodes = layout.nodes.filter(n => !n.hidden);

  const particlePic = useParticles(p.flights, p.simTime, p.anchors, c, p.heat);

  const multiSet = useMemo(() => new Set(p.multi ?? []), [p.multi]);

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        <Canvas style={[StyleSheet.absoluteFill, { backgroundColor: c.canvas }]}>
          <Group transform={cam}>
            <Group opacity={gridOpacity}>
              <SkPoints points={gridPts} color={c.gridDot} />
            </Group>
            {visibleContainers.map(ct => (
              <ContainerView
                key={ct.id}
                ct={ct}
                c={c}
                selected={p.selection?.kind === 'container' && p.selection.id === ct.id}
                dragId={dragId}
                dx={dragDx}
                dy={dragDy}
                snap={ct.collapsed ? aggregate(ct, layout, snapNodes) : undefined}
                dim={!!p.targets && !p.targets.has(ct.id)}
              />
            ))}
            {visibleEdges.map(e => (
              <EdgeView key={e.id} e={e} c={c} layout={layout} snap={snapEdges?.[e.id]} selected={p.selection?.kind === 'edge' && p.selection.id === e.id} dragId={dragId} dx={dragDx} dy={dragDy} run={p.mode === 'run'} dim={!!p.targets} />
            ))}
            {p.mode === 'run' && particlePic && <Picture picture={particlePic} />}
            <Path path={ghostLine} color={c.accent} style="stroke" strokeWidth={2} opacity={ghostOpacity}>
              <DashPathEffect intervals={[6, 5]} />
            </Path>
            {visibleNodes.map(n => (
              <NodeView
                key={n.id}
                n={n}
                c={c}
                dark={dark}
                snap={snapNodes?.[n.id]}
                run={p.mode === 'run'}
                selected={selectedNode === n.id || multiSet.has(n.id)}
                showPort={p.mode === 'build' && selectedNode === n.id}
                dragId={dragId}
                dx={dragDx}
                dy={dragDy}
                ghostTarget={ghostTarget}
                simTime={p.simTime}
                dim={!!p.targets && !p.targets.has(n.id)}
                glow={!!p.targets && p.targets.has(n.id)}
                labels={p.labels !== false}
                stamp={p.stamps?.[n.id]}
              />
            ))}
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

function SkPoints({ points, color }: { points: SharedValue<ReturnType<typeof vec>[]>; color: string }) {
  const path = useDerivedValue(() => {
    const pa = Skia.Path.Make();
    const pts = points.value;
    for (let i = 0; i < pts.length; i++) pa.addCircle(pts[i].x, pts[i].y, 1.1);
    return pa;
  });
  return <Path path={path} color={color} />;
}

function aggregate(ct: RContainer, layout: Layout, snaps?: Record<string, NodeSnap>) {
  if (!snaps) return undefined;
  const members = layout.nodes.filter(n => n.hidden && layout.anchor[n.id].x === ct.x + ct.w / 2 && layout.anchor[n.id].y === ct.y + ct.h / 2);
  const ss = members.map(m => snaps[m.id]).filter(Boolean);
  if (!ss.length) return undefined;
  const worst = ss.some(x => x.health === 'down') ? 'down' : ss.some(x => x.health === 'fail') ? 'fail' : ss.some(x => x.health === 'warn') ? 'warn' : 'ok';
  return { health: worst, p99: Math.max(...ss.map(x => x.p99)), rps: Math.max(...ss.map(x => x.rps)) };
}

const CONTAINER_TINT: Record<string, string> = {
  region: '#5CE1FF',
  'availability-zone': '#8A93A6',
  vpc: '#3DDC97',
  'bounded-context': '#B28CFF',
  layer: '#8A93A6',
  tenant: '#3DDC97',
  cell: '#FFB547',
  'k8s-namespace': '#5CE1FF',
};

function ContainerView({
  ct,
  c,
  selected,
  dragId,
  dx,
  dy,
  snap,
  dim,
}: {
  ct: RContainer;
  c: Colors;
  selected: boolean;
  dragId: SharedValue<string>;
  dx: SharedValue<number>;
  dy: SharedValue<number>;
  snap?: { health: string; p99: number; rps: number };
  dim: boolean;
}) {
  const tr = useDerivedValue(() => (dragId.value === ct.id ? [{ translateX: dx.value }, { translateY: dy.value }] : [{ translateX: 0 }]));
  const tint = CONTAINER_TINT[ct.kind] ?? c.text2;
  const f = font(12, 600);
  const fm = font(11, 500, true);
  const icon = svgIcon(ct.icon, tint, 2.2);
  const label = fit(ct.name, f, Math.min(ct.w, 220) - 46);
  const chipW = Math.min(ct.w - 12, f.measureText(label).width + 40 + (ct.collapsed ? 0 : 0));
  return (
    <Group transform={tr} opacity={dim ? 0.35 : 1}>
      <RoundedRect x={ct.x} y={ct.y} width={ct.w} height={ct.h} r={ct.collapsed ? 16 : 20} color={tint} opacity={ct.collapsed ? 0.12 : 0.045} />
      <RoundedRect x={ct.x} y={ct.y} width={ct.w} height={ct.h} r={ct.collapsed ? 16 : 20} color={selected ? c.accent : tint} style="stroke" strokeWidth={selected ? 2 : 1} opacity={selected ? 1 : 0.45}>
        {!ct.collapsed && <DashPathEffect intervals={[5, 4]} />}
      </RoundedRect>
      <RoundedRect x={ct.x + 8} y={ct.y + 7} width={chipW} height={22} r={11} color={c.surface2} opacity={0.95} />
      {icon && <ImageSVG svg={icon} x={ct.x + 14} y={ct.y + 11} width={14} height={14} />}
      <SkText x={ct.x + 34} y={ct.y + 22.5} text={label} font={f} color={c.text} />
      {ct.collapsed && (
        <>
          <SkText x={ct.x + ct.w - 44} y={ct.y + 22.5} text={`(${ct.count})`} font={fm} color={c.text2} />
          <Circle cx={ct.x + 20} cy={ct.y + 48} r={5} color={snap ? healthColor(c, snap.health) : c.text3} />
          <SkText x={ct.x + 32} y={ct.y + 52} text={snap ? `p99 ${fmtMs(snap.p99)}  ${fmtRps(snap.rps)}` : `${ct.count} components`} font={fm} color={c.text2} />
        </>
      )}
    </Group>
  );
}

function EdgeView({
  e,
  c,
  layout,
  snap,
  selected,
  dragId,
  dx,
  dy,
  run,
  dim,
}: {
  e: REdge;
  c: Colors;
  layout: Layout;
  snap?: EdgeSnap;
  selected: boolean;
  dragId: SharedValue<string>;
  dx: SharedValue<number>;
  dy: SharedValue<number>;
  run: boolean;
  dim: boolean;
}) {
  const a = layout.anchor[e.from];
  const b = layout.anchor[e.to];
  // two directed lanes (right-hand traffic): requests a→b on one side, replies b→a on the other
  const lanes = useDerivedValue(() => {
    let ax = a.x;
    let ay = a.y;
    let bx = b.x;
    let by = b.y;
    if (dragId.value === e.from) {
      ax += dx.value;
      ay += dy.value;
    }
    if (dragId.value === e.to) {
      bx += dx.value;
      by += dy.value;
    }
    const p1 = border(ax, ay, a.w, a.h, bx, by, 3);
    const p2 = border(bx, by, b.w, b.h, ax, ay, 7);
    const q1 = border(ax, ay, a.w, a.h, bx, by, 7);
    const q2 = border(bx, by, b.w, b.h, ax, ay, 3);
    const ddx = bx - ax;
    const ddy = by - ay;
    const len = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
    const ox = (-ddy / len) * LANE;
    const oy = (ddx / len) * LANE;
    const arrow = (pa: ReturnType<typeof Skia.Path.Make>, fx: number, fy: number, tx: number, ty: number) => {
      pa.moveTo(fx, fy);
      pa.lineTo(tx, ty);
      const ang = Math.atan2(ty - fy, tx - fx);
      pa.moveTo(tx - 7 * Math.cos(ang - 0.5), ty - 7 * Math.sin(ang - 0.5));
      pa.lineTo(tx, ty);
      pa.lineTo(tx - 7 * Math.cos(ang + 0.5), ty - 7 * Math.sin(ang + 0.5));
    };
    const fwd = Skia.Path.Make();
    const back = Skia.Path.Make();
    if (e.async) arrow(fwd, p1[0], p1[1], p2[0], p2[1]);
    else {
      arrow(fwd, p1[0] + ox, p1[1] + oy, p2[0] + ox, p2[1] + oy);
      arrow(back, q2[0] - ox, q2[1] - oy, q1[0] - ox, q1[1] - oy);
    }
    return [fwd, back];
  });
  const path = useDerivedValue(() => lanes.value[0]);
  const backPath = useDerivedValue(() => lanes.value[1]);
  const partitioned = run && snap?.partitioned;
  const errors = run && snap && snap.errRate > 0.01;
  const active = run && snap && snap.rps > 0;
  const color = selected ? c.accent : partitioned ? c.partition : errors ? c.fail : snap?.degraded ? c.warn : active ? c.read : c.text3;
  const width = selected ? 2.5 : active ? Math.min(4, 1.3 + Math.log10(1 + (snap?.rps ?? 0)) * 0.6) : 1.5;
  const mx = (e.x1 + e.x2) / 2;
  const my = (e.y1 + e.y2) / 2;
  const breaker = run && snap && snap.breaker !== 'closed' ? snap.breaker : null;
  const ang = Math.atan2(e.y2 - e.y1, e.x2 - e.x1);
  const px = Math.cos(ang + Math.PI / 2) * 8;
  const py = Math.sin(ang + Math.PI / 2) * 8;
  return (
    <Group opacity={dim ? 0.25 : active || selected ? 0.95 : 0.7}>
      <Path path={path} color={color} style="stroke" strokeWidth={width} strokeCap="round" strokeJoin="round">
        {(e.async || partitioned || snap?.degraded) && <DashPathEffect intervals={e.async ? [2, 5] : [7, 5]} />}
      </Path>
      {!e.async && (
        <Path path={backPath} color={selected ? c.accent : partitioned ? c.partition : active ? c.ok : c.text3} style="stroke" strokeWidth={Math.max(1.2, width * 0.7)} strokeCap="round" strokeJoin="round" opacity={active || selected ? 0.8 : 0.55}>
          {partitioned && <DashPathEffect intervals={[7, 5]} />}
        </Path>
      )}
      {partitioned || breaker ? <Circle cx={mx} cy={my} r={10} color={c.canvas} /> : null}
      {partitioned ? (
        <>
          <Line p1={vec(mx - px, my - py)} p2={vec(mx + px, my + py)} color={color} strokeWidth={2.5} strokeCap="round" />
          <Line p1={vec(mx - px * 0.6 + Math.cos(ang) * 4, my - py * 0.6 + Math.sin(ang) * 4)} p2={vec(mx + px * 0.6 + Math.cos(ang) * 4, my + py * 0.6 + Math.sin(ang) * 4)} color={color} strokeWidth={2.5} strokeCap="round" />
        </>
      ) : breaker ? (
        <>
          <Circle cx={mx} cy={my} r={6} color={color} style="stroke" strokeWidth={2} />
          {breaker === 'half' && <Path path={halfDisc(mx, my, 6)} color={color} />}
        </>
      ) : null}
    </Group>
  );
}

function border(cx: number, cy: number, w: number, h: number, tx: number, ty: number, inflate: number) {
  'worklet';
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const hw = w / 2 + inflate;
  const hh = h / 2 + inflate;
  const sx = Math.abs(dx) > 0 ? hw / Math.abs(dx) : 1e9;
  const sy = Math.abs(dy) > 0 ? hh / Math.abs(dy) : 1e9;
  const k = Math.min(sx, sy);
  return [cx + dx * k, cy + dy * k];
}

function NodeView({
  n,
  c,
  dark,
  snap,
  run,
  selected,
  showPort,
  dragId,
  dx,
  dy,
  ghostTarget,
  simTime,
  dim,
  glow,
  labels,
  stamp,
}: {
  n: RNode;
  c: Colors;
  dark: boolean;
  snap?: NodeSnap;
  run: boolean;
  selected: boolean;
  showPort: boolean;
  dragId: SharedValue<string>;
  dx: SharedValue<number>;
  dy: SharedValue<number>;
  ghostTarget: SharedValue<string>;
  simTime?: SharedValue<number>;
  dim: boolean;
  glow: boolean;
  labels: boolean;
  stamp?: number;
}) {
  const tr = useDerivedValue(() => (dragId.value === n.id ? [{ translateX: dx.value }, { translateY: dy.value }] : [{ translateX: 0 }]));
  const targetOpacity = useDerivedValue(() => (ghostTarget.value === n.id ? 1 : 0));
  const x = n.x - n.w / 2;
  const y = n.y - n.h / 2;
  const fName = font(13, 600);
  const fSub = font(10.5, 500, !!(run && snap));
  const down = run && snap && !snap.up;
  const health = run && snap ? healthColor(c, snap.health) : undefined;
  const iconColor = down ? c.text3 : c.text;
  const icon = svgIcon(n.icon, iconColor, 2);
  const icx = x + 24;
  const icy = n.y;
  const name = fit(n.name, fName, n.w - 54);
  // minimal: name only; while running, one number (latency) once there is data
  const subText = run && snap ? (down ? 'down' : snap.p99 > 0 ? fmtMs(snap.p99) : '') : '';
  const sub = subText ? fit(subText, fSub, n.w - 54) : '';
  const ring = useMemo(() => {
    const pa = Skia.Path.Make();
    const u = Math.max(0.02, Math.min(1, snap?.util ?? 0));
    pa.addArc({ x: icx - 16, y: icy - 16, width: 32, height: 32 }, -90, u * 359.9);
    return pa;
  }, [icx, icy, snap?.util]);
  const pulse = useDerivedValue(() => {
    if (!snap?.alerting || !simTime) return 0;
    const t = (simTime.value % 1200) / 1200;
    return 0.25 + 0.35 * Math.sin(t * Math.PI);
  });
  const badgeText = !labels ? '' : canvasText(snap?.badges?.map(b => b.text).join(' ') ?? '');
  const fBadge = font(10, 700);
  const bw = badgeText ? fBadge.measureText(badgeText).width + 12 : 0;
  const stampText = stamp !== undefined ? `t+${fmtMs(stamp)}` : '';
  const sw = stampText ? fBadge.measureText(stampText).width + 12 : 0;
  const chaos = !!(run && snap?.chaos?.length);
  const zap = svgIcon('zap', c.canvas, 2.6);
  const expand = svgIcon('maximize-2', c.text3, 2.2);
  const hatch = useMemo(() => {
    if (!down) return null;
    const pa = Skia.Path.Make();
    for (let k = -n.h; k < n.w; k += 9) {
      pa.moveTo(x + Math.max(0, k), y + Math.max(0, -k));
      pa.lineTo(x + Math.min(n.w, k + n.h), y + Math.min(n.h, n.h - (k + n.h - Math.min(n.w, k + n.h))));
    }
    return pa;
  }, [down, x, y, n.w, n.h]);
  return (
    <Group transform={tr} opacity={dim ? 0.3 : 1}>
      {(selected || glow) && (
        <RoundedRect x={x - 3} y={y - 3} width={n.w + 6} height={n.h + 6} r={17} color={c.accent} opacity={0.35}>
          <BlurMask blur={10} style="normal" />
        </RoundedRect>
      )}
      {run && snap?.alerting && (
        <RoundedRect x={x - 4} y={y - 4} width={n.w + 8} height={n.h + 8} r={18} color={c.fail} opacity={pulse}>
          <BlurMask blur={12} style="normal" />
        </RoundedRect>
      )}
      <RoundedRect x={x} y={y + 2} width={n.w} height={n.h} r={14} color="#000" opacity={dark ? 0.35 : 0.08}>
        <BlurMask blur={4} style="normal" />
      </RoundedRect>
      <RoundedRect x={x} y={y} width={n.w} height={n.h} r={14} color={c.surface1} />
      <RoundedRect x={x + 0.5} y={y + 0.5} width={n.w - 1} height={n.h - 1} r={13.5} color={selected ? c.accent : c.hairlineStrong} style="stroke" strokeWidth={selected ? 2 : 1} />
      {hatch && <Path path={hatch} color={c.text3} style="stroke" strokeWidth={1} opacity={0.35} />}
      <Circle cx={icx} cy={icy} r={15} color={c.surface2} />
      {run && snap && !down && (
        <>
          <Circle cx={icx} cy={icy} r={16} color={c.hairlineStrong} style="stroke" strokeWidth={2} />
          <Path path={ring} color={health} style="stroke" strokeWidth={2.2} strokeCap="round" />
        </>
      )}
      {icon && <ImageSVG svg={icon} x={icx - 9} y={icy - 9} width={18} height={18} opacity={down ? 0.5 : 1} />}
      <SkText x={x + 46} y={sub ? n.y - 2 : n.y + 4.5} text={name} font={fName} color={down ? c.text3 : c.text} />
      {sub ? <SkText x={x + 46} y={n.y + 13.5} text={sub} font={fSub} color={down ? c.fail : run && snap && snap.health !== 'ok' ? health : c.text2} /> : null}
      {labels && run && snap && !down && snap.spark.length > 1 && <Spark x={x + n.w - 26} y={y + 8} vals={snap.spark} color={health ?? c.text2} />}
      {badgeText ? (
        <>
          <RoundedRect x={x + n.w - bw - 6} y={y - 10} width={bw} height={18} r={9} color={c.surface2} />
          <RoundedRect x={x + n.w - bw - 6} y={y - 10} width={bw} height={18} r={9} color={c.protocol} style="stroke" strokeWidth={1} opacity={0.7} />
          <SkText x={x + n.w - bw} y={y + 3} text={badgeText} font={fBadge} color={c.text} />
        </>
      ) : null}
      {stampText ? (
        <>
          <RoundedRect x={x + n.w - sw - 6} y={y + n.h - 8} width={sw} height={18} r={9} color={c.accent} />
          <SkText x={x + n.w - sw} y={y + n.h + 5} text={stampText} font={fBadge} color={c.onAccent} />
        </>
      ) : null}
      {chaos && zap ? (
        <>
          <Circle cx={x + 2} cy={y + 2} r={11} color={c.warn} />
          <ImageSVG svg={zap} x={x - 5} y={y - 5} width={14} height={14} />
        </>
      ) : null}
      {n.composite && !run && expand ? <ImageSVG svg={expand} x={x + n.w - 20} y={y + 6} width={13} height={13} /> : null}
      {showPort && (
        <>
          <Circle cx={x + n.w} cy={n.y} r={PORT_R + 5} color={c.accent} opacity={0.18} />
          <Circle cx={x + n.w} cy={n.y} r={PORT_R} color={c.accent} />
          <Circle cx={x + n.w} cy={n.y} r={2.5} color={c.onAccent} />
        </>
      )}
      <RoundedRect x={x - 2} y={y - 2} width={n.w + 4} height={n.h + 4} r={16} color={c.accent} style="stroke" strokeWidth={2} opacity={targetOpacity} />
    </Group>
  );
}

function Spark({ x, y, vals, color }: { x: number; y: number; vals: number[]; color: string }) {
  const max = Math.max(1, ...vals);
  const last = vals.slice(-5);
  return (
    <Group>
      {last.map((v, i) => {
        const h = Math.max(1.5, (v / max) * 12);
        return <RoundedRect key={i} x={x + i * 4} y={y + 12 - h} width={2.6} height={h} r={1} color={color} opacity={0.5 + (i / last.length) * 0.5} />;
      })}
    </Group>
  );
}

/** Particles: one Skia picture per frame on the UI thread. */
function useParticles(flights?: SharedValue<number[]>, simTime?: SharedValue<number>, anchors?: SharedValue<number[]>, c?: Colors, heat?: boolean): SharedValue<SkPicture> | null {
  const colors = useMemo(() => (c ? [c.read, c.write, c.protocol, c.ok, c.fail] : []), [c]);
  const pic = useDerivedValue(() => {
    return createPicture(canvas => {
      if (!flights || !simTime || !anchors || heat) return;
      const f = flights.value;
      const an = anchors.value;
      const t = simTime.value;
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      const glowPaint = Skia.Paint();
      glowPaint.setAntiAlias(true);
      glowPaint.setBlendMode(BlendMode.Plus);
      for (let i = 0; i + 5 < f.length; i += 6) {
        const t0 = f[i + 2];
        const t1 = f[i + 3];
        if (t < t0 || t > t1) continue;
        const a = f[i] * 2;
        const b = f[i + 1] * 2;
        if (a < 0 || b < 0 || a + 1 >= an.length || b + 1 >= an.length) continue;
        const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
        if ((f[i + 5] & 64) === 64) {
          // waiting inside a component: its box pulses and a bar fills over the wait
          const cx = an[a];
          const cy = an[a + 1];
          const hw = WAIT_W / 2 + 5;
          const hh = WAIT_H / 2 + 5;
          const wc = Skia.Color(colors[f[i + 4]] ?? '#fff');
          const ring = Skia.Paint();
          ring.setAntiAlias(true);
          ring.setStyle(PaintStyle.Stroke);
          ring.setStrokeWidth(2);
          ring.setColor(wc);
          ring.setAlphaf(0.45 + 0.4 * Math.sin(t / 160));
          canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(cx - hw, cy - hh, hw * 2, hh * 2), 17, 17), ring);
          ring.setStrokeWidth(3.5);
          ring.setStrokeCap(StrokeCap.Round);
          ring.setAlphaf(0.95);
          const x0 = cx - WAIT_W / 2 + 14;
          canvas.drawLine(x0, cy + hh + 6, x0 + (WAIT_W - 28) * Math.min(1, k), cy + hh + 6, ring);
          continue;
        }
        // travel from the edge of one box to the edge of the other, so a parked dot is visible on the border
        const ddx = an[b] - an[a];
        const ddy = an[b + 1] - an[a + 1];
        const len = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        const ux = ddx / len;
        const uy = ddy / len;
        const clip = Math.min(len / 2, Math.min((WAIT_W / 2 + 4) / Math.max(1e-6, Math.abs(ux)), (WAIT_H / 2 + 4) / Math.max(1e-6, Math.abs(uy))));
        const sx = an[a] + ux * clip;
        const sy = an[a + 1] + uy * clip;
        const span = Math.max(0, len - 2 * clip);
        // two lanes: every dot keeps to the right of its direction of travel
        const lane = LANE;
        const x = sx + ux * span * k - uy * lane;
        const y = sy + uy * span * k + ux * lane;
        const op = f[i + 4];
        const flags = f[i + 5];
        const traced = (flags & 1) === 1;
        const dropped = (flags & 2) === 2;
        const size = (flags >> 2) & 15;
        const col = Skia.Color(colors[op] ?? '#fff');
        const reply = op === 3;
        const r = traced ? 4.2 : reply ? 2.6 + size * 0.15 : 3.2 + size * 0.2;
        // soft halo
        glowPaint.setColor(col);
        glowPaint.setAlphaf(reply ? 0.16 : 0.28);
        canvas.drawCircle(x, y, r * 2, glowPaint);
        // dark rim for contrast on any background
        paint.setColor(Skia.Color('#000000'));
        paint.setAlphaf(0.55);
        canvas.drawCircle(x, y, r + 1, paint);
        // solid dot
        paint.setColor(col);
        paint.setAlphaf((dropped && k > 0.5 ? Math.max(0.15, 1 - (k - 0.5) * 2) : 1) * (reply ? 0.75 : 1));
        canvas.drawCircle(x, y, r, paint);
        // bright core
        paint.setColor(Skia.Color('#FFFFFF'));
        paint.setAlphaf(traced ? 1 : 0.85);
        canvas.drawCircle(x, y, traced ? 1.6 : r * 0.35, paint);
      }
    });
  });
  return flights ? pic : null;
}

/** hardware designs (CPU core, caches, RAM) run 1 sim ms = 1 CPU cycle */
let cycleUnit = false;
export const setCycleUnit = (on: boolean) => {
  cycleUnit = on;
};

export function fmtMs(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '—';
  if (cycleUnit) return `${Math.max(1, Math.round(ms)).toLocaleString()} cyc`;
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

export function fmtRps(r: number): string {
  if (r < 1000) return `${Math.round(r)} rps`;
  if (r < 1e6) return `${(r / 1000).toFixed(r < 10000 ? 1 : 0)}k rps`;
  return `${(r / 1e6).toFixed(1)}M rps`;
}

void PointMode;

function halfDisc(cx: number, cy: number, r: number) {
  const pa = Skia.Path.Make();
  pa.addArc({ x: cx - r, y: cy - r, width: r * 2, height: r * 2 }, -90, 180);
  pa.close();
  return pa;
}

const EMOJI: Record<string, string> = { '👑': 'leader', '🔒': 'locked', '🔑': 'key', '🐢': 'slow', '🪦': 'dead', '⚠️': '!', '⚠': '!', '🗄': '', '⚡': '' };

/** Skia draws with one font (no emoji fallback): swap emoji for words, drop any other pictographs. */
export function canvasText(t: string): string {
  let out = t;
  for (const [k, v] of Object.entries(EMOJI)) out = out.split(k).join(v);
  return out.replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').replace(/\s+/g, ' ').trim();
}
