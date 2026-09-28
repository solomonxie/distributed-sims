import React, { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Canvas, Line, Path, Skia, vec, DashPathEffect, Group } from '@shopify/react-native-skia';
import type { MetricPoint } from '@dsims/engine';
import { useTheme, space } from '../theme';
import { Screen } from '../ui/Screen';
import { Card, Mono, Row, SectionHeader, Segmented, Text } from '../ui/primitives';
import { controller, useRun } from '../state/run';
import { useDoc } from '../state/doc';
import { fmtMs, fmtRps } from '../canvas/SystemCanvas';
import { fmtNum } from '../sheets/Inspector';
import { fmtClock } from '../sheets/RunSheets';

export function MetricsScreen() {
  const { c } = useTheme();
  const nav = useNavigation();
  const [tab, setTab] = useState<'system' | 'nodes' | 'edges'>('system');
  const [focus, setFocus] = useState<string | null>(null);
  const [sort, setSort] = useState<'p99' | 'util' | 'errRate'>('p99');
  useRun(s => s.t);
  const snap = useRun(s => s.snapshot);
  const doc = useDoc(s => s.doc);
  const { width } = useWindowDimensions();
  const W = width - space.l * 2 - 24;
  const run = controller.run;
  if (!run || !snap) return <Screen><Text color={c.text2}>Start a run to see metrics.</Text></Screen>;
  const pts = focus ? run.series(focus) : run.series('system');
  const chaosT = run.events().filter(e => e.kind === 'chaos').map(e => e.t / 1000);
  const name = (id: string) => doc?.nodes.find(n => n.id === id)?.name ?? id;
  const collecting = pts.length < 2;
  const avail = focus ? (1 - (snap.nodes[focus]?.errRate ?? 0)) * 100 : snap.system.availability;
  return (
    <Screen contentStyle={{ paddingTop: 8 }}>
      <Segmented options={['system', 'nodes', 'edges'] as const} value={tab} onChange={v => { setTab(v); setFocus(null); }} labels={{ system: 'System', nodes: 'Nodes', edges: 'Edges' }} />
      {tab === 'system' || focus ? (
        <>
          <View style={styles.head}>
            <Text v="headline" style={{ flex: 1 }}>
              {focus ? name(focus) : 'Entry points'}
            </Text>
            {focus && (
              <Pressable onPress={() => setFocus(null)}>
                <Text color={c.accent}>System</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.kpis}>
            <Kpi label="avail" value={`${avail.toFixed(avail >= 99.9 ? 2 : 1)}%`} bad={avail < 99.9} />
            <Kpi label="p99" value={fmtMs(focus ? snap.nodes[focus]?.p99 ?? 0 : snap.system.p99)} />
            <Kpi label="rps" value={fmtNum(focus ? snap.nodes[focus]?.rps ?? 0 : snap.system.rps)} />
          </View>
          <Chart title="p99 latency" unit="ms" pts={pts} pick={p => p.p99} width={W} color={c.accent} marks={chaosT} collecting={collecting} fmt={fmtMs} />
          <Chart title="Throughput" pts={pts} pick={p => p.rps} width={W} color={c.ok} marks={chaosT} collecting={collecting} fmt={v => fmtRps(v)} second={{ pick: p => p.rps * p.errRate, color: c.fail, label: 'errors' }} />
          {focus && <Chart title="Utilisation" pts={pts} pick={p => p.util * 100} width={W} color={c.warn} marks={chaosT} collecting={collecting} fmt={v => `${Math.round(v)}%`} max={100} />}
          <SectionHeader title="ANOMALIES" />
          <Card>
            {Object.entries(snap.anomalies).length ? (
              Object.entries(snap.anomalies).map(([k, v], i, arr) => <Row key={k} title={k.replace(/-/g, ' ')} value={String(Math.round(v))} last={i === arr.length - 1} />)
            ) : (
              <Row title="None so far" subtitle="Stale reads, lost writes, duplicates and double-sells are counted here." last />
            )}
          </Card>
          <SectionHeader title="COST" />
          <Card>
            <Row title="Estimated" value={`≈ $${Math.round(snap.costMonth).toLocaleString()} / mo`} last />
          </Card>
        </>
      ) : tab === 'nodes' ? (
        <>
          <Segmented options={['p99', 'util', 'errRate'] as const} value={sort} onChange={setSort} labels={{ p99: 'p99', util: 'Busy', errRate: 'Errors' }} style={{ marginTop: space.m }} />
          <Card style={{ marginTop: space.m }}>
            {Object.values(snap.nodes)
              .sort((a, b) => (b[sort] as number) - (a[sort] as number))
              .map((n, i, arr) => (
                <Row key={n.id} title={name(n.id)} subtitle={`${fmtMs(n.p99)} · ${Math.round(n.util * 100)}% · ${(n.errRate * 100).toFixed(1)}% err`} chevron last={i === arr.length - 1} onPress={() => setFocus(n.id)} />
              ))}
          </Card>
        </>
      ) : (
        <Card style={{ marginTop: space.m }}>
          {Object.values(snap.edges).map((e, i, arr) => {
            const ed = doc?.edges.find(x => x.id === e.id);
            return <Row key={e.id} title={`${name(ed?.from ?? '')} → ${name(ed?.to ?? '')}`} subtitle={`${fmtRps(e.rps)} · ${(e.errRate * 100).toFixed(1)}% err${e.breaker !== 'closed' ? ` · breaker ${e.breaker}` : ''}${e.partitioned ? ' · partitioned' : ''}`} last={i === arr.length - 1} />;
          })}
        </Card>
      )}
      <Mono color={c.text3} style={{ textAlign: 'center', marginTop: space.xl, fontSize: 11 }}>
        sim {fmtClock(run.now)} · seed {useRun.getState().seed}
      </Mono>
      {void nav}
    </Screen>
  );
}

function Kpi({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  const { c } = useTheme();
  return (
    <Card style={{ flex: 1 }} padded>
      <Text v="caption" numberOfLines={1}>
        {label}
      </Text>
      <Mono style={{ fontSize: 18, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit color={bad ? c.fail : c.text}>
        {value}
      </Mono>
    </Card>
  );
}

function Chart({ title, pts, pick, width, color, marks, collecting, fmt, second, max }: { title: string; unit?: string; pts: MetricPoint[]; pick: (p: MetricPoint) => number; width: number; color: string; marks: number[]; collecting: boolean; fmt: (v: number) => string; second?: { pick: (p: MetricPoint) => number; color: string; label: string }; max?: number }) {
  const { c } = useTheme();
  const H = 120;
  const data = pts.slice(-120);
  const vals = data.map(pick);
  const top = max ?? Math.max(1e-6, ...vals, ...(second ? data.map(second.pick) : [])) * 1.15;
  const t0 = data[0]?.t ?? 0;
  const t1 = data[data.length - 1]?.t ?? 1;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * width;
  const y = (v: number) => H - (v / top) * H;
  const path = (f: (p: MetricPoint) => number) => {
    const p = Skia.Path.Make();
    data.forEach((d, i) => (i ? p.lineTo(x(d.t), y(f(d))) : p.moveTo(x(d.t), y(f(d)))));
    return p;
  };
  const area = (() => {
    const p = path(pick);
    if (data.length) {
      p.lineTo(x(t1), H);
      p.lineTo(x(t0), H);
      p.close();
    }
    return p;
  })();
  return (
    <Card style={{ marginTop: space.m }} padded>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text v="caption" style={{ flex: 1 }}>
          {title}
        </Text>
        <Mono color={color}>{vals.length ? fmt(vals[vals.length - 1]) : '—'}</Mono>
        {second && data.length > 0 && <Mono color={second.color}> · {fmt(second.pick(data[data.length - 1]))} {second.label}</Mono>}
      </View>
      {collecting ? (
        <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
          <Text color={c.text3}>Collecting…</Text>
        </View>
      ) : (
        <Canvas style={{ width, height: H, marginTop: 8 }}>
          {[0.25, 0.5, 0.75].map(f => (
            <Line key={f} p1={vec(0, H * f)} p2={vec(width, H * f)} color={c.hairline} strokeWidth={1} />
          ))}
          <Path path={area} color={color} opacity={0.12} />
          <Path path={path(pick)} color={color} style="stroke" strokeWidth={2} strokeJoin="round" />
          {second && <Path path={path(second.pick)} color={second.color} style="stroke" strokeWidth={1.6} />}
          <Group>
            {marks
              .filter(m => m >= t0 && m <= t1)
              .map((m, i) => (
                <Line key={i} p1={vec(x(m), 0)} p2={vec(x(m), H)} color={c.warn} strokeWidth={1.2}>
                  <DashPathEffect intervals={[4, 4]} />
                </Line>
              ))}
          </Group>
        </Canvas>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Mono color={c.text3} style={{ fontSize: 10 }}>
          {fmtClock(t0 * 1000)}
        </Mono>
        <Mono color={c.text3} style={{ fontSize: 10 }}>
          {fmtClock(t1 * 1000)}
        </Mono>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginTop: space.l },
  kpis: { flexDirection: 'row', gap: 8, marginTop: space.m },
});
