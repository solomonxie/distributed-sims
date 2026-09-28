import React, { useMemo } from 'react';
import { Canvas, Circle, Group, Line, RoundedRect, vec } from '@shopify/react-native-skia';
import type { SystemDoc } from '@dsims/engine';
import { useTheme } from '../theme';

/** Static mini-render of a system (visual.md → Thumbnails). */
export function MiniGraph({ doc, width, height, seed = 0 }: { doc?: SystemDoc; width: number; height: number; seed?: number }) {
  const { c } = useTheme();
  const g = useMemo(() => {
    if (!doc || !doc.nodes.length) return null;
    const xs = doc.nodes.map(n => n.pos.x);
    const ys = doc.nodes.map(n => n.pos.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 14;
    const sx = (width - pad * 2) / Math.max(1, maxX - minX);
    const sy = (height - pad * 2) / Math.max(1, maxY - minY);
    const s = Math.min(sx, sy, 0.6);
    const ox = (width - (maxX - minX) * s) / 2 - minX * s;
    const oy = (height - (maxY - minY) * s) / 2 - minY * s;
    const pos = new Map(doc.nodes.map(n => [n.id, { x: n.pos.x * s + ox, y: n.pos.y * s + oy }]));
    return { pos, s };
  }, [doc, width, height]);
  if (!doc || !g) return <Canvas style={{ width, height }} />;
  const nodeCol = (i: number) => (i % 7 === (seed % 7) ? c.accent : i % 11 === 3 ? c.protocol : c.text2);
  return (
    <Canvas style={{ width, height }}>
      <RoundedRect x={0} y={0} width={width} height={height} r={12} color={c.canvas} />
      <Group>
        {doc.edges.map(e => {
          const a = g.pos.get(e.from);
          const b = g.pos.get(e.to);
          if (!a || !b) return null;
          return <Line key={e.id} p1={vec(a.x, a.y)} p2={vec(b.x, b.y)} color={c.accent} opacity={0.35} strokeWidth={1.2} />;
        })}
        {doc.edges.slice(0, 3).map((e, i) => {
          const a = g.pos.get(e.from);
          const b = g.pos.get(e.to);
          if (!a || !b) return null;
          const k = 0.3 + i * 0.22;
          return <Circle key={'p' + e.id} cx={a.x + (b.x - a.x) * k} cy={a.y + (b.y - a.y) * k} r={2.2} color={i === 1 ? c.write : c.read} />;
        })}
        {doc.nodes.map((n, i) => {
          const p = g.pos.get(n.id)!;
          return (
            <Group key={n.id}>
              <Circle cx={p.x} cy={p.y} r={5.5} color={c.surface2} />
              <Circle cx={p.x} cy={p.y} r={5.5} color={nodeCol(i)} style="stroke" strokeWidth={1.6} />
            </Group>
          );
        })}
      </Group>
    </Canvas>
  );
}
