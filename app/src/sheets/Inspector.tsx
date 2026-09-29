import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import type { AlertRule, EdgeConfig, Knob, SystemDoc } from '@dsims/engine';
import { rules as engineRules } from '@dsims/engine';
import { catalog, type ContainerDef } from '@dsims/content';
import { useTheme, space } from '../theme';
import { Icon } from '../ui/Icon';
import { Button, Card, Mono, Row, SectionHeader, Segmented, Text, Toggle } from '../ui/primitives';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useDoc } from '../state/doc';
import { useRun, controller, type JourneyHop } from '../state/run';
import { stepLabel } from '../learn/narrate';
import { learnLinks } from '../learn/learnLinks';
import { fmtMs, fmtRps } from '../canvas/SystemCanvas';
import { nodeIcon } from '../canvas/layout';


export function NodeInspector({ id, onOpenMetrics, onFireChaos, onConnect, onDrill, onHost, onEditEdge, onOpenHop }: { id: string; onOpenMetrics: () => void; onFireChaos: () => void; onConnect: () => void; onDrill?: () => void; onHost?: () => void; onEditEdge?: (id: string) => void; onOpenHop?: (h: JourneyHop) => void }) {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
  const skins = catalog.skins.filter(s => s.type === node.type);
  const set = (k: string, v: unknown) => useDoc.getState().setNodeConfig(id, k, v);
  const isClient = !!type?.client;
  const links = learnLinks(node.type);
  const outs = doc.edges.filter(e => e.from === id);

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

      {running && isClient && <ClientSend id={id} />}
      {running && !isClient && <StatusLine id={id} onFireChaos={onFireChaos} />}

      {!isClient && <NodeSteps id={id} doc={doc} onOpen={onOpenHop} />}

      {links.length > 0 && (
        <>
          <SectionHeader title="HOW IT WORKS" />
          <Card>
            {links.map((l, i) => (
              <Row key={l.title} left={<Icon name={l.icon} size={18} color={c.accent} />} title={l.title} subtitle={l.subtitle} chevron last={i === links.length - 1} onPress={() => l.open(nav)} />
            ))}
          </Card>
        </>
      )}

      {(outs.length > 0 || !readOnly) && (
        <>
          <SectionHeader title="TALKS TO" />
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
      )}

      <Pressable onPress={() => setMore(!more)} style={styles.moreRow} accessibilityRole="button">
        <Text color={c.accent}>{more ? 'Less' : 'Settings, alerts & more'}</Text>
        <Icon name={more ? 'chevron-up' : 'chevron-down'} size={16} color={c.accent} />
      </Pressable>

      {more && (
        <>
          {(skins.length > 1 || knobs.length > 0) && (
            <>
              <SectionHeader title="SETTINGS" right={cost > 0 ? `≈ $${Math.round(cost).toLocaleString()}/mo` : undefined} />
              <Card>
                {skins.length > 1 && <EnumRow label="Technology" value={node.skin ?? ''} options={skins.map(s => s.name)} labels={Object.fromEntries(skins.map(s => [s.name, s.label]))} onChange={v => useDoc.getState().setSkin(id, v)} last={!knobs.length} />}
                {knobs.map((k, i) => (
                  <KnobRow key={k.key} k={k} value={cfg[k.key]} last={i === knobs.length - 1} onChange={v => set(k.key, v)} />
                ))}
              </Card>
            </>
          )}
          <SectionHeader title="ALERTS" />
          <AlertsTab target={id} doc={doc} />
          <View style={styles.actions}>
            {running && <Button small title="Charts" icon="line-chart" onPress={onOpenMetrics} />}
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

/** One line of live health, and the one action that matters while running. */
function StatusLine({ id, onFireChaos }: { id: string; onFireChaos: () => void }) {
  const { c } = useTheme();
  const snap = useRun(s => s.snapshot?.nodes[id]);
  const faults = useRun(s => s.snapshot?.chaos)?.filter(a => a.target === id || a.target2 === id) ?? [];
  if (!snap) return null;
  const bad = !snap.up || snap.errRate > 0.01 || snap.p99 > 500;
  const text = !snap.up ? 'Down — callers are timing out' : `p99 ${fmtMs(snap.p99)} · ${fmtRps(snap.rps)} · ${(snap.errRate * 100).toFixed(1)} % errors · ${Math.round(snap.util * 100)} % busy`;
  return (
    <View style={[styles.status, { borderColor: bad ? c.fail : faults.length ? c.warn : c.hairline }]}>
      <View style={{ flex: 1 }}>
        <Mono style={{ fontSize: 12.5 }} color={bad ? c.fail : c.text2}>
          {text}
        </Mono>
        {faults.length > 0 && (
          <Text v="callout" color={c.warn} style={{ marginTop: 2 }}>
            ⚡ {faults.map(a => `${a.label}${a.remainingSec !== undefined ? ` · ${Math.ceil(a.remainingSec)}s left` : ''}`).join(' · ')}
          </Text>
        )}
        {snap.badges.length > 0 && (
          <Text v="callout" color={c.protocol} style={{ marginTop: 2 }}>
            {snap.badges.map(b => b.text).join(' · ')}
          </Text>
        )}
      </View>
      {faults.length > 0 ? <Button small kind="primary" title="Heal" icon="heart-pulse" onPress={() => faults.forEach(a => controller.heal(a.id))} /> : <Button small title="Break it…" icon="zap" onPress={onFireChaos} />}
    </View>
  );
}

/** The followed request's steps that happen at this component, in order. */
function NodeSteps({ id, doc, onOpen }: { id: string; doc: SystemDoc; onOpen?: (h: JourneyHop) => void }) {
  const { c } = useTheme();
  const lead = useRun(s => s.lead);
  const running = useRun(s => s.active);
  const mine = (lead?.hops ?? []).map((h, k) => ({ h, k })).filter(({ h }) => h.to === id || (h.wait && h.from === id));
  // the journey is known in advance; only show what has happened so far
  const steps = mine.filter(({ k }) => lead && k <= lead.i);
  const ahead = mine.length - steps.length;
  return (
    <>
      <SectionHeader title="IN THIS REQUEST" />
      <Card>
        {steps.length === 0 ? (
          !(lead && ahead > 0) && <Row title={lead ? 'This request does not pass through here' : running ? 'Tap Send to follow a request through it' : 'Run the system, then Send a request'} last />
        ) : (
          steps.map(({ h, k }, i) => {
            const now = lead!.i === k;
            const past = k < lead!.i;
            const tone = h.tcp ? c.warn : h.proto ? c.protocol : h.reply ? (h.ok ? c.ok : c.fail) : h.wait ? c.text2 : c.read;
            return (
              <Pressable key={k} disabled={!onOpen} onPress={() => onOpen?.(h)} style={({ pressed }) => [styles.step, (i < steps.length - 1 || ahead > 0) && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }, now && { backgroundColor: c.surface2 }, pressed && { opacity: 0.6 }]}>
                <View style={[styles.stepNum, { borderColor: tone, backgroundColor: past ? tone : 'transparent' }]}>
                  <Mono style={{ fontSize: 11 }} color={past ? c.canvas : tone}>
                    {k + 1}
                  </Mono>
                </View>
                <Text numberOfLines={2} style={{ flex: 1, fontWeight: now ? '700' : '400' }} color={past || now ? c.text : c.text2}>
                  {stepLabel(doc, h)}
                </Text>
                {h.at !== undefined && (
                  <Mono style={{ fontSize: 11 }} color={c.text3}>
                    t+{fmtMs(h.at)}
                  </Mono>
                )}
                {now ? <Icon name="map-pin" size={14} color={c.accent} /> : onOpen ? <Icon name="chevron-right" size={14} color={c.text3} /> : null}
              </Pressable>
            );
          })
        )}
        {steps.length > 0 && ahead > 0 && <Row title={`${ahead} more step${ahead === 1 ? '' : 's'} here, later in this request`} last />}
        {steps.length === 0 && ahead > 0 && lead && <Row title="Comes through here later in this request" last />}
      </Card>
    </>
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

/** Fire one request or a burst from this client. */
/** Only a choice: what Next step fires from this client. Nothing is sent from here. */
function ClientSend({ id }: { id: string }) {
  const { c } = useTheme();
  const key = useRun(s => s.sendKey);
  const op = useRun(s => s.sendOp);
  useEffect(() => {
    useRun.setState({ sender: id });
  }, [id]);
  return (
    <>
      <SectionHeader title="NEXT REQUEST FROM HERE" />
      <Card padded>
        <Segmented options={['read', 'write'] as const} labels={{ read: 'Read', write: 'Write' }} value={op} onChange={v => useRun.setState({ sendOp: v })} />
        <View style={styles.burst}>
          <Segmented options={['cached', 'uncached'] as const} labels={{ cached: 'Cached key', uncached: 'Uncached key' }} value={key} onChange={v => useRun.setState({ sendKey: v })} style={{ flex: 1 }} />
        </View>
        <Text v="callout" color={c.text2} style={{ marginTop: 8 }}>
          {op === 'write' ? (key === 'cached' ? 'Writes the key, then clears its cached copy.' : 'Writes a key the cache has never seen.') : key === 'cached' ? 'A key already in the cache: the fast path.' : 'A key nobody has asked for yet: a cache miss, then it gets cached.'} Press Next step to fire it.
        </Text>
      </Card>
    </>
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

export function ContainerInspector({ id, onFireChaos }: { id: string; onFireChaos: () => void }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc)!;
  const running = useRun(s => s.active);
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
        {running && <Button small title="Break it…" icon="zap" onPress={onFireChaos} />}
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
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space.m, padding: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  stepNum: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  iconTile: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  burst: { flexDirection: 'row', gap: 8, marginTop: 12 },
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
