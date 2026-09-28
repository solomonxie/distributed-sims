import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import type { AlertRule, EdgeConfig, Knob, SystemDoc } from '@dsims/engine';
import { rules as engineRules } from '@dsims/engine';
import { catalog, type ContainerDef } from '@dsims/content';
import { useTheme, space } from '../theme';
import { Icon } from '../ui/Icon';
import { Button, Card, Mono, Row, SectionHeader, Segmented, Text, Toggle } from '../ui/primitives';
import { useDoc } from '../state/doc';
import { useRun, controller } from '../state/run';
import { fmtMs, fmtRps } from '../canvas/SystemCanvas';
import { nodeIcon, nodeSubtitle } from '../canvas/layout';

type Tab = 'config' | 'run' | 'alerts';

export function NodeInspector({ id, onOpenMetrics, onFireChaos, onConnect, onDrill, onHost, onEditEdge }: { id: string; onOpenMetrics: () => void; onFireChaos: () => void; onConnect: () => void; onDrill?: () => void; onHost?: () => void; onEditEdge?: (id: string) => void }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc)!;
  const readOnly = useDoc(s => s.readOnly);
  const running = useRun(s => s.active);
  const [more, setMore] = useState(false);
  const node = doc.nodes.find(n => n.id === id);
  const type = catalog.types.find(t => t.type === node?.type);
  const skin = catalog.skins.find(s => s.name === node?.skin);
  if (!node) return null;
  const knobs = type?.knobs ?? [];
  const cfg = { ...Object.fromEntries(knobs.map(k => [k.key, k.default])), ...(skin?.defaults ?? {}), ...(node.config ?? {}) };
  const cost = (Number(cfg.costMonth) || type?.costPerInstanceMonth || 0) * Math.max(1, Number(cfg.instances) || 1);
  // the few settings that matter most: non-advanced, in catalog order, max 3
  const key = knobs.filter(k => !k.advanced).slice(0, 3);
  const rest = knobs.filter(k => !key.includes(k));
  const skins = catalog.skins.filter(s => s.type === node.type);
  const set = (k: string, v: unknown) => useDoc.getState().setNodeConfig(id, k, v);
  const isClient = !!type?.client;

  return (
    <View>
      <View style={styles.head}>
        <View style={[styles.iconTile, { backgroundColor: c.surface2 }]}>
          <Icon name={nodeIcon(node.type, node.skin)} size={24} />
        </View>
        <Pressable style={{ flex: 1 }} disabled={readOnly} onPress={() => Alert.prompt('Rename', undefined, t => t?.trim() && useDoc.getState().rename(id, t.trim()), 'plain-text', node.name)}>
          <Text v="title" numberOfLines={1}>
            {node.name}
          </Text>
          <Text v="callout" color={c.text2} numberOfLines={2}>
            {skin?.label ?? type?.label} — {lowerFirst(type?.description ?? '')}
          </Text>
        </Pressable>
      </View>

      {running && <NodeRunTab id={id} onOpenMetrics={onOpenMetrics} onFireChaos={onFireChaos} />}

      {key.length > 0 && (
        <>
          <SectionHeader title="SETTINGS" right={cost > 0 ? `≈ $${Math.round(cost).toLocaleString()}/mo` : undefined} />
          <Card>
            {key.map((k, i) => (
              <KnobRow key={k.key} k={{ ...k, help: undefined }} value={cfg[k.key]} last={i === key.length - 1} onChange={v => set(k.key, v)} />
            ))}
          </Card>
        </>
      )}

      {(() => {
        const outs = doc.edges.filter(e => e.from === id);
        if (!outs.length && readOnly) return null;
        return (
          <>
            <SectionHeader title="SENDS REQUESTS TO" />
            <Card>
              {outs.map((e, i) => {
                const to = doc.nodes.find(n => n.id === e.to);
                return (
                  <Row
                    key={e.id}
                    left={<Icon name={nodeIcon(to?.type ?? '', to?.skin)} size={18} />}
                    title={to?.name ?? e.to}
                    subtitle={edgeSummary(e.config)}
                    chevron={!!onEditEdge}
                    last={i === outs.length - 1 && (readOnly || running)}
                    onPress={onEditEdge ? () => onEditEdge(e.id) : undefined}
                  />
                );
              })}
              {!readOnly && !running && <Row title="Connect to…" left={<Icon name="plus" size={18} color={c.accent} />} titleStyle={{ color: c.accent }} last onPress={onConnect} />}
            </Card>
          </>
        );
      })()}

      <Pressable onPress={() => setMore(!more)} style={styles.moreRow} accessibilityRole="button">
        <Text color={c.accent}>{more ? 'Fewer settings' : 'More settings'}</Text>
        <Icon name={more ? 'chevron-up' : 'chevron-down'} size={16} color={c.accent} />
      </Pressable>

      {more && (
        <>
          {(skins.length > 1 || rest.length > 0) && (
            <Card>
              {skins.length > 1 && <EnumRow label="Technology" value={node.skin ?? ''} options={skins.map(s => s.name)} labels={Object.fromEntries(skins.map(s => [s.name, s.label]))} onChange={v => useDoc.getState().setSkin(id, v)} last={!rest.length} />}
              {rest.map((k, i) => (
                <KnobRow key={k.key} k={k} value={cfg[k.key]} last={i === rest.length - 1} onChange={v => set(k.key, v)} />
              ))}
            </Card>
          )}
          <SectionHeader title="ALERTS" />
          <AlertsTab target={id} doc={doc} />
          <View style={styles.actions}>
            {onDrill && <Button small title="Look inside" icon="maximize-2" onPress={onDrill} />}
            {onHost && !isClient && <Button small title="Host CPU & memory" icon="cpu" onPress={onHost} />}
            {!readOnly && !running && <Button small title="Duplicate" icon="copy" onPress={() => useDoc.getState().duplicate(id)} />}
            {!readOnly && !running && <Button small kind="destructive" title="Delete" icon="trash-2" onPress={() => useDoc.getState().remove({ kind: 'node', id })} />}
          </View>
        </>
      )}
    </View>
  );
}

function edgeSummary(cfg?: EdgeConfig): string {
  const c = { mode: 'sync', timeoutMs: 2000, retries: 0, ...(cfg ?? {}) };
  if (c.mode === 'async') return 'fire and forget (doesn’t wait)';
  const wait = c.timeoutMs >= 1000 ? `${+(c.timeoutMs / 1000).toFixed(1)} s` : `${c.timeoutMs} ms`;
  const parts = [`waits up to ${wait}`, c.retries ? `retries ${c.retries}×` : 'no retries'];
  if (c.circuitBreaker) parts.push('circuit breaker');
  if (c.keepAlive === false) parts.push('new connection each call');
  if (c.ratio !== undefined && c.ratio < 1) parts.push(`${Math.round(c.ratio * 100)}% of requests`);
  return parts.join(' · ');
}

const lowerFirst = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

function NodeRunTab({ id, onOpenMetrics, onFireChaos }: { id: string; onOpenMetrics: () => void; onFireChaos: () => void }) {
  const { c } = useTheme();
  const snap = useRun(s => s.snapshot?.nodes[id]);
  const series = controller.run?.series(id) ?? [];
  const last = series.slice(-14);
  if (!snap) return <Text color={c.text2} style={{ marginTop: space.l }}>Collecting…</Text>;
  const rows: [string, number[], string, string?][] = [
    ['p99', last.map(p => p.p99), fmtMs(snap.p99), snap.p99 > 500 ? c.fail : undefined],
    ['rps', last.map(p => p.rps), fmtRps(snap.rps)],
    ['err', last.map(p => p.errRate), `${(snap.errRate * 100).toFixed(1)} %`, snap.errRate > 0.01 ? c.fail : undefined],
    ['util', last.map(p => p.util), `${Math.round(snap.util * 100)} %`, snap.util > 0.85 ? c.warn : undefined],
  ];
  return (
    <View style={{ marginTop: space.m }}>
      <Card padded>
        {rows.map(([label, vals, v, col]) => (
          <View key={label} style={styles.metricRow}>
            <Mono color={c.text2} style={{ width: 48 }}>
              {label}
            </Mono>
            <Bars vals={vals} color={col ?? c.accent} />
            <Mono style={{ width: 86, textAlign: 'right' }} color={col ?? c.text}>
              {v}
            </Mono>
          </View>
        ))}
        {!snap.up && (
          <Text v="callout" color={c.fail} style={{ marginTop: 8 }}>
            Down — callers are timing out.
          </Text>
        )}
        {snap.badges.length > 0 && (
          <Text v="callout" color={c.protocol} style={{ marginTop: 8 }}>
            {snap.badges.map(b => b.text).join(' · ')}
          </Text>
        )}
      </Card>
      <View style={styles.actions}>
        <Button small title="Charts" icon="line-chart" onPress={onOpenMetrics} />
        <Button small title="Break it…" icon="zap" onPress={onFireChaos} />
      </View>
    </View>
  );
}

export function Bars({ vals, color, height = 18 }: { vals: number[]; color: string; height?: number }) {
  const max = Math.max(1e-9, ...vals);
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2, height, marginHorizontal: 8 }}>
      {vals.map((v, i) => (
        <View key={i} style={{ flex: 1, height: Math.max(2, (v / max) * height), borderRadius: 1.5, backgroundColor: color, opacity: 0.35 + (i / vals.length) * 0.65 }} />
      ))}
    </View>
  );
}

function AlertsTab({ target, doc }: { target: string; doc: SystemDoc }) {
  const { c } = useTheme();
  const rules = (doc.alerts ?? []).filter(a => a.target === target);
  const add = (metric: string, op: '>' | '<', threshold: number) =>
    useDoc.getState().commit(d => {
      d.alerts = [...(d.alerts ?? []), { id: `a-${Date.now().toString(36)}`, target, metric, op, threshold, forSec: 10, enabled: true }];
    });
  const upd = (id: string, patch: Partial<AlertRule>) =>
    useDoc.getState().commit(d => {
      d.alerts = (d.alerts ?? []).map(a => (a.id === id ? { ...a, ...patch } : a));
    });
  return (
    <View style={{ marginTop: space.m }}>
      <Card>
        {rules.map((a, i) => (
          <Row
            key={a.id}
            title={`${a.metric} ${a.op} ${a.threshold}${a.metric === 'p99' ? 'ms' : a.metric === 'errRate' || a.metric === 'util' ? '%' : ''}`}
            subtitle={`for ${a.forSec ?? 0}s`}
            last={i === rules.length - 1}
            right={<Toggle value={a.enabled !== false} onChange={v => upd(a.id, { enabled: v })} />}
          />
        ))}
        {!rules.length && <Row title="No alerts yet" subtitle="Alerts fire during a run and show on the node." last />}
      </Card>
      <SectionHeader title="ADD ALERT" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button small title="p99 > 500ms" onPress={() => add('p99', '>', 500)} />
        <Button small title="errors > 1%" onPress={() => add('errRate', '>', 1)} />
        <Button small title="util > 90%" onPress={() => add('util', '>', 90)} />
        <Button small title="queue > 100" onPress={() => add('queue', '>', 100)} />
      </View>
      <Text v="callout" color={c.text3} style={{ marginTop: space.s }}>
        Fires after the condition holds for 10s.
      </Text>
    </View>
  );
}

// ---------- knob controls ----------

export function KnobRow({ k, value, onChange, last }: { k: Knob; value: unknown; onChange: (v: unknown) => void; last?: boolean }) {
  if (k.kind === 'bool') return <Row title={k.label} subtitle={k.help} last={last} right={<Toggle value={!!value} onChange={onChange} />} />;
  if (k.kind === 'enum') return <EnumRow label={k.label} value={String(value ?? k.default)} options={k.options ?? []} onChange={onChange} last={last} />;
  if (k.kind === 'string') return <Row title={k.label} value={String(value ?? '')} last={last} onPress={() => Alert.prompt(k.label, k.help, t => t !== undefined && onChange(t), 'plain-text', String(value ?? ''))} />;
  const v = typeof value === 'number' ? value : Number(k.default) || 0;
  const unit = k.kind === 'ms' ? 'ms' : k.kind === 'percent' ? '%' : k.unit ?? '';
  return <NumberRow k={k} v={v} unit={unit} onChange={onChange} last={last} />;
}

function NumberRow({ k, v, unit, onChange, last }: { k: Knob; v: number; unit: string; onChange: (v: unknown) => void; last?: boolean }) {
  const { c } = useTheme();
  const stepUp = () => onChange(clamp(nice(v, +1, k), k));
  const stepDown = () => onChange(clamp(nice(v, -1, k), k));
  return (
    <View style={[styles.numRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }]}>
      <View style={{ flex: 1 }}>
        <Text v="body">{k.label}</Text>
        {k.help ? (
          <Text v="callout" color={c.text3} numberOfLines={2}>
            {k.help}
          </Text>
        ) : null}
      </View>
      <View style={styles.stepper}>
        <StepBtn icon="minus" onPress={stepDown} />
        <Pressable onPress={() => Alert.prompt(k.label, unit ? `in ${unit}` : undefined, t => t !== undefined && isFinite(Number(t)) && onChange(clamp(Number(t), k)), 'plain-text', String(v), 'decimal-pad')}>
          <Mono style={{ minWidth: 70, textAlign: 'center' }}>{humanValue(v, unit)}</Mono>
        </Pressable>
        <StepBtn icon="plus" onPress={stepUp} />
      </View>
    </View>
  );
}

function StepBtn({ icon, onPress }: { icon: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable hitSlop={6} onPress={onPress} style={({ pressed }) => [styles.stepBtn, { backgroundColor: c.surface2, borderColor: c.hairlineStrong }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={16} />
    </Pressable>
  );
}

export function EnumRow({ label, value, options, labels, onChange, last }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void; last?: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  if (options.length <= 3 && !labels) {
    return (
      <View style={[styles.numRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }]}>
        <Text v="body" style={{ flex: 1 }}>
          {label}
        </Text>
        <Segmented options={options} value={value} onChange={onChange} style={{ minWidth: 170 }} />
      </View>
    );
  }
  return (
    <View>
      <Row title={label} value={labels?.[value] ?? value} last={last && !open} onPress={() => setOpen(!open)} right={<Icon name={open ? 'chevron-down' : 'chevron-right'} size={18} color={c.text3} />} />
      {open &&
        options.map((o, i) => (
          <Row
            key={o}
            title={labels?.[o] ?? o}
            checked={o === value}
            last={last && i === options.length - 1}
            titleStyle={{ paddingLeft: 12 }}
            onPress={() => {
              onChange(o);
              setOpen(false);
            }}
          />
        ))}
    </View>
  );
}

// ---------- edge ----------

const PROTOCOLS = ['HTTP/1.1', 'HTTP/2', 'gRPC', 'SQL/TCP', 'RESP', 'AMQP', 'Kafka', 'WebSocket', 'TCP'];

export function EdgeInspector({ id }: { id: string }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc)!;
  const e = doc.edges.find(x => x.id === id);
  const warnings = useMemo(() => {
    try {
      return (engineRules as any).checkRules?.(doc, catalog)?.filter((w: any) => w.edgeId === id) ?? [];
    } catch {
      return [];
    }
  }, [doc, id]);
  if (!e) return null;
  const cfg: EdgeConfig = { mode: 'sync', timeoutMs: 2000, retries: 0, backoffMs: 50, ...(e.config ?? {}) };
  const set = (patch: Partial<EdgeConfig>) => useDoc.getState().setEdgeConfig(id, patch);
  const from = doc.nodes.find(n => n.id === e.from)?.name ?? e.from;
  const to = doc.nodes.find(n => n.id === e.to)?.name ?? e.to;
  const k = (key: string, label: string, kind: Knob['kind'], def: number, min: number, max: number) => ({ key, label, kind, default: def, min, max }) as Knob;
  return (
    <View>
      <View style={styles.head}>
        <Text v="title" numberOfLines={1} style={{ flex: 1 }}>
          {from} → {to}
        </Text>
      </View>
      <Card style={{ marginTop: space.m }}>
        <EnumRow label="Protocol" value={cfg.protocol ?? 'HTTP/1.1'} options={PROTOCOLS} labels={Object.fromEntries(PROTOCOLS.map(p => [p, p]))} onChange={v => set({ protocol: v })} />
        <EnumRow label="Call" value={cfg.mode ?? 'sync'} options={['sync', 'async']} onChange={v => set({ mode: v as 'sync' | 'async' })} />
        <NumberRow k={k('timeoutMs', 'Timeout', 'ms', 2000, 1, 120000)} v={cfg.timeoutMs!} unit="ms" onChange={v => set({ timeoutMs: v as number })} />
        <NumberRow k={k('retries', 'Retries', 'int', 0, 0, 10)} v={cfg.retries!} unit="" onChange={v => set({ retries: v as number })} />
        <NumberRow k={k('backoffMs', 'Backoff', 'ms', 50, 1, 10000)} v={cfg.backoffMs!} unit="ms" onChange={v => set({ backoffMs: v as number })} />
        <Row title="Jitter" right={<Toggle value={cfg.jitter !== false} onChange={v => set({ jitter: v })} />} />
        <Row title="Circuit breaker" right={<Toggle value={!!cfg.circuitBreaker} onChange={v => set({ circuitBreaker: v })} />} />
        <Row title="mTLS" right={<Toggle value={!!cfg.mtls} onChange={v => set({ mtls: v })} />} />
        <Row title="Keep-alive" right={<Toggle value={cfg.keepAlive !== false} onChange={v => set({ keepAlive: v })} />} />
        <EnumRow label="Carries" value={cfg.op ?? 'any'} options={['any', 'read', 'write']} onChange={v => set({ op: v as any })} />
        <NumberRow k={k('ratio', 'Share of requests', 'percent', 100, 0, 100)} v={Math.round((cfg.ratio ?? 1) * 100)} unit="%" onChange={v => set({ ratio: (v as number) / 100 })} last />
      </Card>
      {warnings.map((w: any) => (
        <View key={w.id} style={[styles.warn, { borderColor: c.warn, backgroundColor: c.surface1 }]}>
          <Icon name="triangle-alert" size={16} color={c.warn} />
          <Text v="callout" style={{ flex: 1 }}>
            {w.message}
          </Text>
        </View>
      ))}
      <View style={styles.actions}>
        <View style={{ flex: 1 }} />
        <Button small kind="destructive" title="Delete edge" icon="trash-2" onPress={() => useDoc.getState().remove({ kind: 'edge', id })} />
      </View>
    </View>
  );
}

// ---------- container ----------

export function ContainerInspector({ id }: { id: string }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc)!;
  const ct = doc.containers.find(x => x.id === id);
  const def = (catalog.containers as ContainerDef[]).find(x => x.kind === ct?.kind);
  if (!ct) return null;
  const members = doc.nodes.filter(n => n.parent === id).length;
  const cfg = { ...Object.fromEntries((def?.knobs ?? []).map(k => [k.key, k.default])), ...(ct.config ?? {}) };
  return (
    <View>
      <View style={styles.head}>
        <View style={[styles.iconTile, { backgroundColor: c.surface2 }]}>
          <Icon name={def?.icon ?? 'square-dashed'} size={22} />
        </View>
        <Pressable style={{ flex: 1 }} onPress={() => Alert.prompt('Rename', undefined, t => t?.trim() && useDoc.getState().rename(id, t.trim()), 'plain-text', ct.name)}>
          <Text v="title" numberOfLines={1}>
            {ct.name}
          </Text>
          <Text v="callout" color={c.text2}>
            {def?.label ?? ct.kind} · {members} components
          </Text>
        </Pressable>
      </View>
      {def?.description ? (
        <Text v="callout" color={c.text2} style={{ marginTop: space.m }}>
          {def.description}
        </Text>
      ) : null}
      <Card style={{ marginTop: space.m }}>
        {(def?.knobs ?? []).map(k => (
          <KnobRow
            key={k.key}
            k={k}
            value={cfg[k.key]}
            onChange={v =>
              useDoc.getState().commit(d => {
                const x = d.containers.find(y => y.id === id);
                if (x) {
                  x.config = { ...(x.config ?? {}), [k.key]: v };
                  if (k.key === 'order') x.order = v as number;
                  if (k.key === 'name' || k.key === 'region') x.name = String(v);
                }
              })
            }
          />
        ))}
        <Row title="Collapsed" subtitle="Shows as one node with aggregate health" last right={<Toggle value={!!ct.collapsed} onChange={() => useDoc.getState().toggleCollapse(id)} />} />
      </Card>
      <View style={styles.actions}>
        <View style={{ flex: 1 }} />
        <Button small kind="destructive" title="Ungroup" icon="ungroup" onPress={() => useDoc.getState().remove({ kind: 'container', id })} />
      </View>
    </View>
  );
}

// ---------- helpers ----------

const SEQ = [1, 2, 5];
function nice(v: number, dir: 1 | -1, k: Knob): number {
  if (k.step) return +(v + dir * k.step).toFixed(4);
  if (k.kind === 'int') {
    if (v < 10 || (k.max ?? 0) <= 64) return v + dir;
  }
  if (k.kind === 'percent') return v + dir * 5;
  if (v <= 0) return dir > 0 ? (k.kind === 'int' ? 1 : 1) : 0;
  const exp = Math.floor(Math.log10(v));
  const cand: number[] = [];
  for (let e = exp - 1; e <= exp + 1; e++) for (const m of SEQ) cand.push(m * Math.pow(10, e));
  cand.sort((a, b) => a - b);
  if (dir > 0) return cand.find(x => x > v + 1e-9) ?? v * 2;
  return [...cand].reverse().find(x => x < v - 1e-9) ?? v / 2;
}

function clamp(v: number, k: Knob) {
  let x = Math.min(k.max ?? Infinity, Math.max(k.min ?? 0, v));
  if (k.kind === 'int') x = Math.round(x);
  return x;
}

export function fmtNum(v: number): string {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 10000) return `${(v / 1000).toFixed(0)}k`;
  if (a >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (a >= 100 || Number.isInteger(v)) return String(Math.round(v));
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  iconTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 8, marginTop: space.l, flexWrap: 'wrap' },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 14, justifyContent: 'center' },
  metricRow: { flexDirection: 'row', alignItems: 'center', height: 30 },
  numRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.l, paddingVertical: 9, minHeight: 50, gap: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 34, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  warn: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 12, borderWidth: 1, marginTop: space.m },
});

/** 86400 s → "1 day", 1500 ms → "1.5 s", 90 % → "90%". */
function humanValue(v: number, unit: string): string {
  if (unit === 'ms' || unit === 's') {
    const ms = unit === 's' ? v * 1000 : v;
    if (ms < 1) return `${+ms.toFixed(2)} ms`;
    if (ms < 1000) return `${fmtNum(ms)} ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${+sec.toFixed(1)} s`;
    if (sec < 3600) return `${+(sec / 60).toFixed(1)} min`;
    if (sec < 86400) return `${+(sec / 3600).toFixed(1)} h`;
    return `${+(sec / 86400).toFixed(1)} day${sec >= 172800 ? 's' : ''}`;
  }
  if (unit === '%') return `${fmtNum(v)}%`;
  return unit ? `${fmtNum(v)} ${unit}` : fmtNum(v);
}
