import { useShallow } from 'zustand/react/shallow';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { ChaosEvent, TrafficEvent, TrafficSource } from '@dsims/engine';
import { chaos as chaosDefs, traffic, type ChaosDef } from '@dsims/content';
import { useTheme, space, type as typo } from '../theme';
import { Icon } from '../ui/Icon';
import { Button, Card, Mono, Row, SectionHeader, Segmented, Text } from '../ui/primitives';
import { useDoc } from '../state/doc';
import { controller, useRun } from '../state/run';
import { Bars, fmtNum } from './Inspector';

// ---------------- Traffic ----------------

export function TrafficContent({ onSchedule }: { onSchedule?: () => void }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc)!;
  const running = useRun(s => s.active);
  const snap = useRun(s => s.snapshot);
  const sources = doc.scenario?.sources ?? [];
  const [target, setTarget] = useState<string | undefined>(sources[0]?.id);
  const [edit, setEdit] = useState<string | null>(null);
  if (edit) return <SourceEditor id={edit} onBack={() => setEdit(null)} />;
  const fire = (ev: TrafficEvent) => {
    if (running) controller.fire({ ...ev, source: target });
    else {
      useDoc.getState().commit(d => {
        d.scenario = d.scenario ?? { sources: [], events: [] };
        d.scenario.events.push({ atSec: 30, event: { ...ev, source: target } });
      });
    }
  };
  return (
    <View>
      <SectionHeader title="SOURCES" />
      <Card>
        {sources.map((s, i) => {
          const n = doc.nodes.find(x => x.id === s.node);
          const rps = snap?.nodes[s.node]?.rps;
          return (
            <Row
              key={s.id}
              title={n?.name ?? s.node}
              subtitle={shapeText(s)}
              value={running && rps !== undefined ? `${fmtNum(rps)} rps` : undefined}
              chevron
              last={i === sources.length - 1}
              onPress={() => setEdit(s.id)}
            />
          );
        })}
        {!sources.length && <Row title="No traffic sources" subtitle="Add a client (web, iOS, IoT…) — it becomes a source when you run." last />}
      </Card>
      <SectionHeader title={running ? 'QUICK FIRE' : 'SCHEDULE AT 0:30'} right={sources.length > 1 ? <Segmented options={sources.map(s => s.id)} value={target ?? sources[0].id} onChange={setTarget} labels={Object.fromEntries(sources.map(s => [s.id, doc.nodes.find(n => n.id === s.node)?.name ?? s.id]))} style={{ maxWidth: 220 }} /> : undefined} />
      <View style={styles.grid}>
        {traffic.presets.map(p => (
          <Pressable key={p.id} onPress={() => fire({ kind: 'traffic', ...(p as any).event })} style={({ pressed }) => [styles.tile, { backgroundColor: c.surface1, borderColor: c.hairline }, pressed && { transform: [{ scale: 0.96 }], opacity: 0.8 }]}>
            <Icon name={(p as any).icon ?? 'activity'} size={20} color={c.accent} />
            <Text v="headline" style={{ fontSize: 14 }} numberOfLines={1}>
              {p.label}
            </Text>
            <Text v="callout" color={c.text2} numberOfLines={1} style={{ fontSize: 11.5 }}>
              {presetSub(p as any)}
            </Text>
          </Pressable>
        ))}
      </View>
      {onSchedule && <Button kind="text" title="Edit schedule on timeline…" onPress={onSchedule} style={{ marginTop: space.m }} />}
    </View>
  );
}

function presetSub(p: { event: TrafficEvent }): string {
  const e = p.event;
  const x = e.params?.x;
  if (e.action === 'burst') return `${x ?? 20}× · ${e.durationSec ?? 5}s`;
  if (e.action === 'ramp') return `×${x ?? 3} · ${e.durationSec ?? 30}s`;
  if (e.action === 'hot-key') return `${Math.round((e.params?.hot ?? 0.4) * 100)}% on one key`;
  if (e.action === 'bots') return `+${fmtNum(e.params?.rps ?? 5000)} rps`;
  if (e.action === 'flash-crowd') return `${x ?? 100}× then decays`;
  if (e.action === 'herd') return 'synchronized retries';
  return '';
}

function shapeText(s: TrafficSource): string {
  const sh = s.shape;
  const mix = `${Math.round((s.readRatio ?? 0.9) * 100)}/${100 - Math.round((s.readRatio ?? 0.9) * 100)} r/w`;
  if (sh.kind === 'constant') return `${fmtNum(sh.rps)} rps · ${mix}`;
  if (sh.kind === 'ramp') return `${fmtNum(sh.from)}→${fmtNum(sh.to)} rps over ${sh.overSec}s`;
  if (sh.kind === 'diurnal') return `diurnal ${fmtNum(sh.trough)}–${fmtNum(sh.peak)} rps`;
  return `spikes +${fmtNum(sh.height)} every ${sh.periodSec}s`;
}

function SourceEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc)!;
  const src = doc.scenario?.sources.find(s => s.id === id);
  if (!src) return null;
  const name = doc.nodes.find(n => n.id === src.node)?.name ?? src.node;
  const upd = (patch: Partial<TrafficSource>) =>
    useDoc.getState().commit(
      d => {
        const s = d.scenario?.sources.find(x => x.id === id);
        if (s) Object.assign(s, patch);
      },
      { coalesce: 'src:' + id + Object.keys(patch).join() },
    );
  const rps = src.shape.kind === 'constant' ? src.shape.rps : src.shape.kind === 'ramp' ? src.shape.to : src.shape.kind === 'diurnal' ? src.shape.peak : src.shape.base;
  const setRps = (v: number) => {
    const sh = src.shape;
    if (sh.kind === 'constant') upd({ shape: { ...sh, rps: v } });
    else if (sh.kind === 'ramp') upd({ shape: { ...sh, to: v } });
    else if (sh.kind === 'diurnal') upd({ shape: { ...sh, peak: v } });
    else upd({ shape: { ...sh, base: v } });
  };
  const steps = [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  const idx = steps.findIndex(s => s >= rps);
  const read = Math.round((src.readRatio ?? 0.9) * 100);
  const kd = src.keys?.kind ?? 'zipf';
  return (
    <View>
      <Pressable onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 }}>
        <Icon name="chevron-left" size={18} color={c.accent} />
        <Text color={c.accent}>Traffic</Text>
        <View style={{ flex: 1 }} />
        <Text v="headline">{name}</Text>
      </Pressable>
      <SectionHeader title="SHAPE" />
      <Segmented
        options={['constant', 'ramp', 'diurnal', 'spike-train'] as const}
        value={src.shape.kind}
        labels={{ 'spike-train': 'Spikes' }}
        onChange={k =>
          upd({
            shape:
              k === 'constant'
                ? { kind: 'constant', rps }
                : k === 'ramp'
                  ? { kind: 'ramp', from: Math.round(rps / 10), to: rps, overSec: 60 }
                  : k === 'diurnal'
                    ? { kind: 'diurnal', peak: rps, trough: Math.round(rps / 5), periodSec: 60 }
                    : { kind: 'spike-train', base: Math.round(rps / 4), height: rps, periodSec: 20, widthSec: 3 },
          })
        }
      />
      <Card style={{ marginTop: space.m }}>
        <View style={styles.sliderRow}>
          <Text style={{ width: 90 }}>Rate</Text>
          <StepDots count={steps.length} index={idx < 0 ? steps.length - 1 : idx} onChange={i => setRps(steps[i])} />
          <Mono style={{ width: 90, textAlign: 'right' }}>{fmtNum(rps)} rps</Mono>
        </View>
        <View style={styles.sliderRow}>
          <Text style={{ width: 90 }}>Reads</Text>
          <StepDots count={11} index={Math.round(read / 10)} onChange={i => upd({ readRatio: i / 10 })} />
          <Mono style={{ width: 90, textAlign: 'right' }}>
            {read} / {100 - read}
          </Mono>
        </View>
      </Card>
      <SectionHeader title="KEYS" />
      <Segmented options={['uniform', 'zipf', 'hot'] as const} value={kd} labels={{ zipf: 'Zipf', hot: 'Hot key' }} onChange={k => upd({ keys: { kind: k, s: 1.1, hot: 0.4 } })} />
      <Text v="callout" color={c.text3} style={{ marginTop: 6 }}>
        {kd === 'uniform' ? 'Every key equally likely.' : kd === 'zipf' ? 'A few keys get most traffic (s = 1.1), like real users.' : '40% of requests hit one key.'}
      </Text>
      <SectionHeader title="TENANTS" />
      <Segmented
        options={['none', 'mixed', 'noisy'] as const}
        value={!src.tenants ? 'none' : Object.values(src.tenants).some(v => v >= 0.8) ? 'noisy' : 'mixed'}
        labels={{ none: 'Single', mixed: 'acme · globex · tiny', noisy: 'Noisy acme' }}
        onChange={v => upd({ tenants: v === 'none' ? undefined : v === 'mixed' ? { acme: 0.6, globex: 0.3, tiny: 0.1 } : { acme: 0.85, globex: 0.1, tiny: 0.05 } })}
      />
      <SectionHeader title="AUTH" />
      <Segmented options={['0', '2', '20'] as const} value={String(Math.round((src.expiredAuth ?? 0) * 100)) as any} labels={{ '0': 'All valid', '2': '2% expired', '20': '20% expired' }} onChange={v => upd({ expiredAuth: Number(v) / 100 })} />
    </View>
  );
}

function StepDots({ count, index, onChange }: { count: number; index: number; onChange: (i: number) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: 32 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Pressable key={i} hitSlop={{ top: 12, bottom: 12 }} onPress={() => onChange(i)} style={{ flex: 1, height: 32, justifyContent: 'center' }}>
          <View style={{ height: 4, marginHorizontal: 1, borderRadius: 2, backgroundColor: i <= index ? c.accent : c.hairlineStrong }} />
          {i === index && <View style={[styles.knob, { borderColor: c.accent, backgroundColor: c.surface1 }]} />}
        </Pressable>
      ))}
    </View>
  );
}

// ---------------- Chaos ----------------

const GROUP_ORDER = ['Node', 'Network', 'Data', 'Time', 'Traffic', 'Infra', 'Security', 'Protocol'];

export function ChaosContent({ onPick, onTraffic, scheduling, node }: { onPick: (def: ChaosDef) => void; onTraffic?: (ev: TrafficEvent) => void; scheduling?: boolean; node?: string }) {
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const activeRaw = useRun(s => s.snapshot?.chaos);
  const active = activeRaw ?? [];
  const doc = useDoc(s => s.doc);
  const types = useMemo(() => new Set(doc?.nodes.map(n => n.type) ?? []), [doc]);
  const list = chaosDefs.filter(d => !q || `${d.label} ${d.description} ${d.group}`.toLowerCase().includes(q.toLowerCase()));
  const relevant = (d: ChaosDef) => d.appliesTo === 'any' || !Array.isArray(d.appliesTo) || d.appliesTo.some(t => types.has(t));
  const [all, setAll] = useState(false);
  const target = node ? doc?.nodes.find(n => n.id === node) : undefined;
  const container = node && !target ? doc?.containers.find(x => x.id === node) : undefined;
  if ((target || container) && !all) {
    const fits = chaosDefs.filter(d =>
      container
        ? d.target === 'container' || d.target === 'pair'
        : (d.target === 'node' || d.target === 'pair' || d.target === 'edge' || (d.target === 'source' && /client|device|bot$/.test(target!.type))) &&
          (d.appliesTo === 'any' || (Array.isArray(d.appliesTo) && d.appliesTo.includes(target!.type))),
    );
    // specific faults for this component first, then generic ones
    fits.sort((a, b) => Number(a.appliesTo === 'any') - Number(b.appliesTo === 'any'));
    const client = target && /client|device|bot$/.test(target.type) && onTraffic;
    const shown = fits.slice(0, client ? 4 : 8);
    const sourceId = doc?.scenario?.sources.find(s => s.node === node)?.id ?? `src-${node}`;
    return (
      <View>
        <Text v="callout" color={c.text2} style={{ marginBottom: space.m }}>
          {target ? `What should happen to ${target.name}?` : `What should happen to ${container!.name}?`}
        </Text>
        {client && (
          <>
            <SectionHeader title="MORE TRAFFIC" />
            <View style={[styles.grid, { marginBottom: space.m }]}>
              {traffic.presets.map(p => (
                <Pressable key={p.id} onPress={() => onTraffic!({ kind: 'traffic', ...(p as any).event, source: sourceId })} style={({ pressed }) => [styles.tile, { backgroundColor: c.surface1, borderColor: c.hairline }, pressed && { transform: [{ scale: 0.96 }] }]}>
                  <Icon name={(p as any).icon ?? 'activity'} size={20} color={c.accent} />
                  <Text v="headline" style={{ fontSize: 14 }} numberOfLines={1}>
                    {p.label}
                  </Text>
                  <Text v="callout" color={c.text2} numberOfLines={1} style={{ fontSize: 11.5 }}>
                    {presetSub(p as any)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <SectionHeader title="FAULTS" />
          </>
        )}
        <View style={styles.grid}>
          {shown.map(d => (
            <Pressable key={d.kind} onPress={() => onPick(d)} style={({ pressed }) => [styles.tile, { backgroundColor: c.surface1, borderColor: c.hairline }, pressed && { transform: [{ scale: 0.96 }] }]}>
              <Icon name={d.icon} size={20} color={d.group === 'Protocol' ? c.protocol : c.warn} />
              <Text v="headline" style={{ fontSize: 14 }} numberOfLines={1}>
                {d.label}
              </Text>
              <Text v="callout" color={c.text2} numberOfLines={2} style={{ fontSize: 11.5 }}>
                {d.description}
              </Text>
            </Pressable>
          ))}
        </View>
        <Button kind="text" title={`All ${chaosDefs.length} faults`} onPress={() => setAll(true)} style={{ marginTop: space.m }} />
      </View>
    );
  }
  return (
    <View>
      <View style={[styles.search, { backgroundColor: c.surface2, borderColor: c.hairline }]}>
        <Icon name="search" size={16} color={c.text3} />
        <TextInput value={q} onChangeText={setQ} placeholder={`Search ${chaosDefs.length} events`} placeholderTextColor={c.text3} style={[typo.body, { flex: 1, color: c.text, paddingVertical: 9 }]} autoCorrect={false} />
      </View>
      {!scheduling && active.length > 0 && (
        <>
          <SectionHeader title={`ACTIVE (${active.length})`} />
          <Card>
            {active.map((a, i) => (
              <Row
                key={a.id}
                left={<Icon name="zap" size={18} color={c.warn} />}
                title={`${a.label} · ${[a.target, a.target2].filter(Boolean).join(' ⟂ ')}`}
                subtitle={a.remainingSec !== undefined ? `${Math.ceil(a.remainingSec)}s left` : 'until healed'}
                last={i === active.length - 1}
                right={<Button small title="Heal" onPress={() => controller.heal(a.id)} />}
              />
            ))}
          </Card>
        </>
      )}
      {GROUP_ORDER.map(g => {
        const items = list.filter(d => d.group === g).sort((a, b) => Number(relevant(b)) - Number(relevant(a)));
        if (!items.length) return null;
        return (
          <View key={g}>
            <SectionHeader title={g.toUpperCase()} />
            <View style={styles.grid}>
              {items.map(d => {
                const ok = relevant(d);
                return (
                  <Pressable key={d.kind} onPress={() => onPick(d)} style={({ pressed }) => [styles.tile, { backgroundColor: c.surface1, borderColor: c.hairline, opacity: ok ? 1 : 0.45 }, pressed && { transform: [{ scale: 0.96 }] }]}>
                    <Icon name={d.icon} size={20} color={g === 'Protocol' ? c.protocol : c.warn} />
                    <Text v="headline" style={{ fontSize: 13.5 }} numberOfLines={1}>
                      {d.label}
                    </Text>
                    <Text v="callout" color={c.text2} numberOfLines={2} style={{ fontSize: 11 }}>
                      {d.description}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
      {!scheduling && <Button kind="secondary" title="Heal all" icon="heart-pulse" onPress={() => controller.heal('all')} style={{ marginTop: space.xl }} />}
    </View>
  );
}

/** Param popover content before targeting. */
export function ChaosParams({ def, onGo, onCancel }: { def: ChaosDef; onGo: (params: Record<string, number>, durationSec?: number) => void; onCancel: () => void }) {
  const { c } = useTheme();
  const [vals, setVals] = useState<Record<string, number>>(() => Object.fromEntries((def.params ?? []).map(p => [p.key, Number(p.default)])));
  const [dur, setDur] = useState<number | undefined>(undefined);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name={def.icon} size={22} color={c.warn} />
        <Text v="title" style={{ flex: 1 }}>
          {def.label}
        </Text>
      </View>
      <Text v="callout" color={c.text2} style={{ marginTop: 6 }}>
        {def.description}
      </Text>
      <Card style={{ marginTop: space.m }}>
        {(def.params ?? []).map(p => (
          <Row
            key={p.key}
            title={p.label}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Button small title="−" onPress={() => setVals({ ...vals, [p.key]: Math.max(p.min ?? 0, niceStep(vals[p.key], -1)) })} />
                <Mono style={{ minWidth: 64, textAlign: 'center' }}>
                  {fmtNum(vals[p.key])} {p.unit ?? ''}
                </Mono>
                <Button small title="+" onPress={() => setVals({ ...vals, [p.key]: Math.min(p.max ?? 1e9, niceStep(vals[p.key], 1)) })} />
              </View>
            }
          />
        ))}
        <Row
          title="Duration"
          last
          right={<Segmented options={['10', '30', '60', 'heal'] as const} value={dur === undefined ? 'heal' : (String(dur) as any)} labels={{ '10': '10s', '30': '30s', '60': '60s', heal: 'Until healed' }} onChange={v => setDur(v === 'heal' ? undefined : Number(v))} style={{ width: 230 }} />}
        />
      </Card>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: space.l }}>
        <Button title="Cancel" kind="secondary" onPress={onCancel} style={{ flex: 1 }} />
        <Button title={def.target === 'none' ? 'Fire' : 'Choose target'} kind="danger-filled" icon="zap" onPress={() => onGo(vals, dur)} style={{ flex: 1.4 }} />
      </View>
    </View>
  );
}

function niceStep(v: number, d: 1 | -1) {
  const seq = [0, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000, 30000, 60000];
  if (d > 0) return seq.find(x => x > v) ?? v * 2;
  return [...seq].reverse().find(x => x < v) ?? 0;
}

export function buildChaosEvent(def: ChaosDef, params: Record<string, number>, durationSec: number | undefined, target?: string, target2?: string, sourceId?: string): ChaosEvent | TrafficEvent {
  const tr = (def as any).traffic as { action: TrafficEvent['action']; params?: Record<string, number>; scale?: Record<string, number>; whenTarget?: string } | undefined;
  if (tr && (!tr.whenTarget || tr.whenTarget !== 'source' || sourceId)) {
    const p: Record<string, number> = { ...(tr.params ?? {}) };
    for (const [k, v] of Object.entries(params)) p[k] = v * (tr.scale?.[k] ?? 1);
    return { kind: 'traffic', action: tr.action, params: p, durationSec: durationSec ?? 0, source: sourceId };
  }
  return { kind: def.kind, target, target2, params, durationSec };
}

// ---------------- Event log ----------------

export function EventLogContent({ onJump }: { onJump: (t: number, node?: string) => void }) {
  const { c } = useTheme();
  const [f, setF] = useState<'all' | 'alert' | 'chaos' | 'protocol'>('all');
  useRun(s => s.eventCount);
  const events = (controller.run?.events() ?? []).filter(e => f === 'all' || e.kind === f || (f === 'chaos' && (e.kind === 'traffic' || e.kind === 'info'))).slice(-150).reverse();
  const icon = (k: string) => (k === 'alert' ? 'bell' : k === 'chaos' ? 'zap' : k === 'protocol' ? 'vote' : k === 'traffic' ? 'activity' : 'info');
  const col = (k: string) => (k === 'alert' ? c.fail : k === 'chaos' ? c.warn : k === 'protocol' ? c.protocol : k === 'traffic' ? c.accent : c.text2);
  return (
    <View>
      <Segmented options={['all', 'alert', 'chaos', 'protocol'] as const} value={f} onChange={setF} labels={{ all: 'All', alert: 'Alerts', chaos: 'Chaos', protocol: 'Protocol' }} />
      <View style={{ marginTop: space.m }}>
        {events.map((e, i) => (
          <Pressable key={i} onPress={() => onJump(e.t, e.node)} style={({ pressed }) => [styles.logRow, { borderBottomColor: c.hairline }, pressed && { opacity: 0.6 }]}>
            <Mono color={c.text3} style={{ width: 62, fontSize: 12 }}>
              {fmtClock(e.t)}
            </Mono>
            <Icon name={icon(e.kind)} size={15} color={col(e.kind)} />
            <Text v="callout" style={{ flex: 1, fontSize: 13.5 }}>
              {e.text}
            </Text>
          </Pressable>
        ))}
        {!events.length && (
          <Text color={c.text2} style={{ paddingVertical: 24, textAlign: 'center' }}>
            Nothing yet. Fire traffic or chaos to see events.
          </Text>
        )}
      </View>
    </View>
  );
}

// ---------------- Timeline sheet ----------------

export function TimelineContent({ onAdd }: { onAdd: () => void }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc)!;
  const { t, duration, seed } = useRun(useShallow(s => ({ t: s.t, duration: s.duration, seed: s.seed })));
  useRun(s => s.eventCount);
  const events = controller.run?.events() ?? [];
  const sched = doc.scenario?.events ?? [];
  const W = 1;
  const pos = (ms: number) => `${Math.min(100, (ms / Math.max(1, duration)) * 100)}%` as const;
  const alerts = events.filter(e => e.kind === 'alert');
  const chaos = events.filter(e => e.kind === 'chaos');
  const sys = controller.run?.series('system') ?? [];
  void W;
  return (
    <View>
      <View style={styles.axis}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <Mono key={f} color={c.text3} style={{ fontSize: 11 }}>
            {fmtClock(f * duration)}
          </Mono>
        ))}
      </View>
      <Lane label="Traffic" color={c.accent}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 26 }}>
          <Bars vals={sys.map(p => p.rps)} color={c.accent} height={24} />
        </View>
      </Lane>
      <Lane label="Chaos" color={c.warn}>
        {[...sched.filter(s => (s.event as any).kind !== 'traffic').map(s => s.atSec * 1000), ...chaos.map(e => e.t)].map((ms, i) => (
          <View key={i} style={[styles.marker, { left: pos(ms), backgroundColor: c.warn }]} />
        ))}
      </Lane>
      <Lane label="Alerts" color={c.fail}>
        {alerts.map((e, i) => (
          <View key={i} style={[styles.marker, { left: pos(e.t), backgroundColor: c.fail }]} />
        ))}
      </Lane>
      <View style={[styles.playhead, { left: `${(t / Math.max(1, duration)) * 100}%` as any, backgroundColor: c.accent }]} pointerEvents="none" />
      <SectionHeader title="SCHEDULED" />
      <Card>
        {sched.map((s, i) => (
          <Row
            key={i}
            left={<Icon name={(s.event as any).kind === 'traffic' ? 'activity' : 'zap'} size={16} color={(s.event as any).kind === 'traffic' ? c.accent : c.warn} />}
            title={(s.event as any).kind === 'traffic' ? `Traffic · ${(s.event as TrafficEvent).action}` : `${(s.event as ChaosEvent).kind} · ${(s.event as ChaosEvent).target ?? ''}`}
            value={fmtClock(s.atSec * 1000)}
            last={i === sched.length - 1}
            right={
              <Pressable hitSlop={10} onPress={() => useDoc.getState().commit(d => d.scenario!.events.splice(i, 1))}>
                <Icon name="x" size={16} color={c.text3} />
              </Pressable>
            }
          />
        ))}
        {!sched.length && <Row title="Nothing scheduled" subtitle="Scheduled events replay every run." last />}
      </Card>
      <Button kind="text" title="+ Add at playhead…" onPress={onAdd} style={{ marginTop: space.s }} />
      <Mono color={c.text3} style={{ marginTop: space.m, textAlign: 'center' }}>
        Seed {seed} · deterministic replay
      </Mono>
      <Button kind="secondary" title="Replay same run" icon="rotate-ccw" onPress={() => controller.replay()} style={{ marginTop: space.s }} />
    </View>
  );
}

function Lane({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={styles.lane}>
      <Text v="caption" style={{ width: 62, color }}>
        {label}
      </Text>
      <View style={[styles.laneTrack, { borderColor: c.hairline }]}>{children}</View>
    </View>
  );
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, ms / 1000);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(r < 60 && m === 0 ? 1 : 0)}`;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48.6%', minHeight: 88, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 4 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  sliderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l, height: 52 },
  knob: { position: 'absolute', alignSelf: 'center', width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: 62, marginTop: 4 },
  lane: { flexDirection: 'row', alignItems: 'center', height: 34 },
  laneTrack: { flex: 1, height: 28, borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  marker: { position: 'absolute', width: 4, height: 16, borderRadius: 2, marginLeft: -2 },
  playhead: { position: 'absolute', top: 18, height: 108, width: 2, marginLeft: 61 },
});
