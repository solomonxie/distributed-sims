import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTheme, space } from '../theme';
import { Mono, Segmented, Text } from '../ui/primitives';
import { controller, useRun } from '../state/run';
import { useDoc } from '../state/doc';
import { fmtMs } from '../canvas/SystemCanvas';
import { fmtClock } from './RunSheets';

export function TraceContent({ id }: { id: number }) {
  const { c } = useTheme();
  const [tab, setTab] = useState<'waterfall' | 'sequence'>('waterfall');
  useRun(s => s.t);
  const doc = useDoc(s => s.doc);
  const tr = controller.run?.trace(id);
  if (!tr) return <Text color={c.text2}>Trace not found.</Text>;
  const end = tr.end ?? controller.run!.now;
  const total = Math.max(1, end - tr.start);
  const spans = [...tr.spans].sort((a, b) => a.start - b.start);
  const name = (nid: string) => doc?.nodes.find(n => n.id === nid)?.name ?? nid;
  return (
    <View>
      <Text v="title">
        Trace {id.toString(16).padStart(4, '0')} · {fmtMs(total)} · {tr.end === undefined ? '⟳ in flight' : tr.ok ? '✓ 200' : '✗ failed'}
      </Text>
      <Segmented options={['waterfall', 'sequence'] as const} value={tab} onChange={setTab} style={{ marginTop: space.m }} />
      {tab === 'waterfall' ? (
        <View style={{ marginTop: space.m }}>
          <View style={styles.axis}>
            {[0, 0.25, 0.5, 1].map(f => (
              <Mono key={f} color={c.text3} style={{ fontSize: 11 }}>
                {fmtMs(f * total)}
              </Mono>
            ))}
          </View>
          {spans.map((s, i) => {
            const left = ((s.start - tr.start) / total) * 100;
            const width = Math.max(1.5, ((s.end - s.start) / total) * 100);
            const col = s.ok ? c.accent : c.fail;
            return (
              <View key={i} style={styles.span}>
                <Text v="callout" numberOfLines={1} style={{ width: 92 }}>
                  {name(s.node)}
                </Text>
                <View style={{ flex: 1, height: 16 }}>
                  <View style={{ position: 'absolute', left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, height: 16, borderRadius: 4, backgroundColor: col, opacity: 0.85 }} />
                </View>
                <Mono style={{ width: 62, textAlign: 'right', fontSize: 12 }} color={s.ok ? c.text : c.fail}>
                  {fmtMs(s.end - s.start)}
                </Mono>
              </View>
            );
          })}
          {!spans.length && <Text color={c.text2}>No spans recorded yet.</Text>}
          <Text v="callout" color={c.text3} style={{ marginTop: space.m }}>
            Each bar is time spent inside a component, including everything it waited on downstream.
          </Text>
        </View>
      ) : (
        <SequenceContent />
      )}
    </View>
  );
}

/** Protocol swimlanes from the engine's protocol log. */
export function SequenceContent({ node }: { node?: string }) {
  const { c } = useTheme();
  useRun(s => s.eventCount);
  const doc = useDoc(s => s.doc);
  const proto = controller.run?.protocol() ?? [];
  const recent = useMemo(() => {
    const list = node ? proto.filter(p => p.from === node || p.to === node) : proto;
    return list.slice(-36);
  }, [proto, node, proto.length]);
  const lanes = useMemo(() => {
    const ids: string[] = [];
    for (const m of recent) for (const x of [m.from, m.to]) if (!ids.includes(x)) ids.push(x);
    return ids.slice(0, 6);
  }, [recent]);
  if (!recent.length) return <Text color={c.text2} style={{ marginTop: space.l }}>No protocol messages in this system yet. Consensus groups, 2PC, sagas and gossip show here.</Text>;
  const name = (id: string) => doc?.nodes.find(n => n.id === id)?.name ?? id;
  const colW = 100 / lanes.length;
  const kindColor = (k: string, dropped: boolean) => (dropped ? c.fail : /vote|elect|prepare|promise/i.test(k) ? c.protocol : /commit|append|accept/i.test(k) ? c.ok : /abort|compensat/i.test(k) ? c.warn : c.accent);
  return (
    <View style={{ marginTop: space.m }}>
      <View style={styles.lanesHead}>
        {lanes.map(l => (
          <Text key={l} v="caption" numberOfLines={1} style={{ width: `${colW}%`, textAlign: 'center', color: c.text }}>
            {name(l)}
          </Text>
        ))}
      </View>
      <ScrollView style={{ maxHeight: 520 }} nestedScrollEnabled>
        <View>
          {lanes.map((l, i) => (
            <View key={l} style={[styles.laneLine, { left: `${colW * i + colW / 2}%`, backgroundColor: c.hairlineStrong }]} />
          ))}
          {recent.map((m, i) => {
            const a = lanes.indexOf(m.from);
            const b = lanes.indexOf(m.to);
            if (a < 0 || b < 0) return null;
            const x1 = colW * a + colW / 2;
            const x2 = colW * b + colW / 2;
            const left = Math.min(x1, x2);
            const width = Math.abs(x2 - x1);
            const col = kindColor(m.kind, m.dropped);
            return (
              <View key={i} style={styles.msgRow}>
                <View style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 16, height: 2, backgroundColor: col, opacity: m.dropped ? 0.5 : 1 }} />
                <Text v="callout" numberOfLines={1} style={{ position: 'absolute', left: `${left}%`, width: `${Math.max(width, 30)}%`, top: 0, fontSize: 10.5, color: col, textAlign: x2 >= x1 ? 'left' : 'right' }}>
                  {x2 >= x1 ? '' : '◀ '}
                  {m.kind.replace(/^[a-z]+\./, '')}
                  {m.data ? ` ${m.data}` : ''}
                  {m.dropped ? ' ✕' : ''}
                  {x2 >= x1 ? ' ▶' : ''}
                </Text>
                <Mono color={c.text3} style={{ position: 'absolute', right: 0, top: 18, fontSize: 9.5 }}>
                  {fmtClock(m.t)}
                </Mono>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginLeft: 92, marginRight: 62, marginBottom: 6 },
  span: { flexDirection: 'row', alignItems: 'center', height: 30 },
  lanesHead: { flexDirection: 'row', marginBottom: 6 },
  laneLine: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  msgRow: { height: 30 },
});
