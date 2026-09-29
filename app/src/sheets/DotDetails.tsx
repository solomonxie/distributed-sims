import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { Flight } from '@dsims/engine';
import type { JourneyHop } from '../state/run';
import { useTheme, space } from '../theme';
import { Button, Card, Mono, Row, Text } from '../ui/primitives';
import { wireOf } from './wire';
import { Icon } from '../ui/Icon';
import { useDoc } from '../state/doc';
import { controller } from '../state/run';
import { fmtMs } from '../canvas/SystemCanvas';
import { fmtNum } from './Inspector';
import { Layers } from './Layers';
import { story } from '../learn/narrate';

/** What one dot on the canvas is carrying: a sample request, its response, or a protocol message. */
export function DotDetails({ f, onTrace }: { f: Flight; onTrace: (id: number) => void }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc);
  const name = (id: string) => doc?.nodes.find(n => n.id === id)?.name ?? id;
  const m = f.msg;
  const r = f.reply;
  const now = controller.run?.now ?? f.t0;
  const isReply = f.op === 'reply';
  const isProto = f.op === 'proto';
  const title = isProto ? prettyKind(m?.kind ?? 'message') : isReply ? `Response · ${r ? (r.ok ? 'OK' : errText(r.err)) : '…'}` : `Request · ${m?.op === 'write' ? 'write' : 'read'}`;
  const icon = isProto ? 'vote' : isReply ? (r && !r.ok ? 'circle-x' : 'corner-down-left') : m?.op === 'write' ? 'pencil' : 'eye';
  const tone = isProto ? c.protocol : isReply ? (r && !r.ok ? c.fail : c.ok) : m?.op === 'write' ? c.write : c.read;
  const rows: [string, string][] = [];
  rows.push(['Travelling', `${name(f.from)} → ${name(f.to)}`]);
  if (m?.key !== undefined && !isProto) rows.push(['Key', `#${m.key}`]);
  if (m?.value !== undefined && m.op === 'write' && !isReply) rows.push(['Writes value', String(m.value)]);
  if (isReply && r?.value !== undefined) rows.push(['Returns value', String(r.value)]);
  if (isReply && r?.version !== undefined) rows.push(['Version', `v${r.version}`]);
  if (isReply && r?.stale) rows.push(['Stale?', 'yes — an older copy of the data']);
  if (m?.tenant) rows.push(['Tenant', m.tenant]);
  if (m?.auth && m.auth !== 'ok') rows.push(['Auth token', m.auth]);
  if (m && m.weight > 1) rows.push(['Stands for', `${fmtNum(m.weight)} similar requests`]);
  if (m && !isProto) rows.push(['Hop', `#${Math.max(1, m.hops)} from the user`]);
  if (m && !isProto) rows.push(['Age', `${fmtMs(Math.max(0.001, now - m.born))} since it started`]);
  if (m?.size && !isProto) rows.push(['Size', m.size >= 1024 ? `${(m.size / 1024).toFixed(1)} KB` : `${m.size} B`]);
  if (isProto && m?.data !== undefined) rows.push(['Data', summarize(m.data)]);
  if (f.dropped) rows.push(['Fate', 'dropped on the way (partition or packet loss)']);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={tone} />
        </View>
        <View style={{ flex: 1 }}>
          <Text v="title">{title}</Text>
          <Text v="callout" color={c.text2}>
            {isProto ? 'A message the components exchange to stay in agreement' : isReply ? 'Coming back to the caller' : 'On its way to be handled'}
          </Text>
        </View>
      </View>
      <Card style={{ marginTop: space.m }}>
        {rows.map(([k, v], i) => (
          <Row key={k} title={k} value={v} last={i === rows.length - 1} />
        ))}
      </Card>
      {m?.traceId !== undefined && <Button kind="secondary" title="Follow this request end to end" icon="route" style={{ marginTop: space.m }} onPress={() => onTrace(m.traceId!)} />}
    </View>
  );
}

const errText = (e?: string) => (e === 'timeout' ? 'timed out' : e === '429' ? 'rate limited' : e === '503' ? 'server busy' : e === 'auth' ? 'not allowed' : e === 'conflict' ? 'conflict' : e === 'unavailable' ? 'unavailable' : 'error');

const prettyKind = (k: string) => k.replace(/^[a-z]+\./, '').replace(/([a-z])([A-Z])/g, '$1 $2');

function summarize(d: unknown): string {
  if (d == null) return '—';
  if (typeof d !== 'object') return String(d);
  try {
    return JSON.stringify(d).slice(0, 80);
  } catch {
    return '—';
  }
}

/** A featured request's current hop: what's on the wire, curl-style. */
export function HopDetails({ h, onTrace }: { h: JourneyHop; onTrace: (id: number) => void }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc);
  if (!doc) return null;
  const name = (id: string) => doc.nodes.find(n => n.id === id)?.name ?? id;
  const tr = controller.run?.trace(h.traceId);
  const total = tr?.end !== undefined ? tr.end - tr.start : undefined;
  if (h.tcp || h.proto || h.wait || h.done) {
    const st = story(doc, [h], 0, null, total, tr?.ok);
    const tone = h.tcp ? c.warn : h.proto ? c.protocol : h.done ? (tr?.ok ? c.ok : c.fail) : c.text2;
    return (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={h.tcp ? 'handshake' : h.proto ? 'vote' : h.done ? 'flag' : 'hourglass'} size={20} color={tone} />
          </View>
          <View style={{ flex: 1 }}>
            <Text v="title">{st.title}</Text>
            <Text v="callout" color={c.text2}>
              {st.body}
            </Text>
          </View>
        </View>
        {(h.tcp || h.proto) && <Layers doc={doc} h={h} />}
      </View>
    );
  }
  const callFrom = h.reply ? h.to : h.from;
  const callTo = h.reply ? h.from : h.to;
  const w = wireOf({ doc, from: callFrom, to: callTo, msg: h.msg, res: h.res, ok: h.res?.ok ?? h.ok, err: h.res?.err ?? h.err, spanMs: h.spanMs, calls: h.calls, traceId: h.traceId });
  const title = h.reply ? `Response · ${w.status}` : 'Request';
  const tone = h.reply ? (w.ok ? c.ok : c.fail) : c.read;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={h.reply ? (w.ok ? 'corner-down-left' : 'circle-x') : 'send'} size={20} color={tone} />
        </View>
        <View style={{ flex: 1 }}>
          <Text v="title">{title}</Text>
          <Text v="callout" color={c.text2}>
            {name(callFrom)} → {name(callTo)} · {w.proto}
          </Text>
        </View>
      </View>
      <WireBlock label="REQUEST" dir=">" lines={w.req} head={c.read} here={!h.reply} />
      <WireBlock label={`RESPONSE · ${fmtMs(Math.max(0.001, h.spanMs))}`} dir="<" lines={w.res} head={w.ok ? c.ok : c.fail} here={h.reply} />
      <Layers doc={doc} h={h} />
      {total !== undefined && tr && (
        <Text v="callout" color={c.text2} style={{ marginTop: space.m }}>
          Whole request: {fmtMs(total)} · {tr.ok ? 'succeeded' : 'failed'} for the user
        </Text>
      )}
      <Button kind="secondary" title="Follow this request end to end" icon="route" style={{ marginTop: space.m }} onPress={() => onTrace(h.traceId)} />
    </View>
  );
}

/** curl -v style: `>` request lines, `<` response lines; headers dimmed by name. */
function WireBlock({ label, dir, lines, head, here }: { label: string; dir: string; lines: string[]; head: string; here: boolean }) {
  const { c } = useTheme();
  let inBody = false;
  return (
    <View style={{ marginTop: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Text v="caption" color={c.text3}>
          {label}
        </Text>
        {here && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: head }} />}
        {here && (
          <Text v="caption" color={head}>
            this dot
          </Text>
        )}
      </View>
      <View style={[styles.wire, { backgroundColor: c.surface1, borderColor: here ? head : c.hairline }]}>
        {lines.map((ln, i) => {
          if (ln === '') inBody = true;
          const comment = ln.startsWith('#');
          const hdr = !inBody && i > 0 && !comment ? /^([a-z0-9-]+): (.*)$/i.exec(ln) : null;
          return (
            <View key={i} style={{ flexDirection: 'row' }}>
              <Mono color={c.text3} style={styles.gutter}>
                {comment || ln === '' ? ' ' : dir}
              </Mono>
              {hdr ? (
                <Mono style={styles.ln}>
                  <Mono color={c.text3} style={styles.ln}>
                    {hdr[1]}:{' '}
                  </Mono>
                  {hdr[2]}
                </Mono>
              ) : (
                <Mono color={comment ? c.text3 : i === 0 ? head : c.text} style={[styles.ln, i === 0 && { fontWeight: '700' }, comment && { fontStyle: 'italic' }]}>
                  {ln}
                </Mono>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wire: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 10, paddingRight: 10 },
  gutter: { width: 22, textAlign: 'center', fontSize: 12.5, lineHeight: 18 },
  ln: { flex: 1, fontSize: 12.5, lineHeight: 18 },
});
