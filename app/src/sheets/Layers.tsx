import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { SystemDoc } from '@dsims/engine';
import type { JourneyHop } from '../state/run';
import { useTheme, space } from '../theme';
import { Mono, Text } from '../ui/primitives';
import { wireOf } from './wire';

const PORT: Record<string, number> = { SQL: 5432, RESP: 6379, Kafka: 9092, KV: 443, gRPC: 443, 'HTTP/1.1': 443, 'HTTP/2': 443 };

function ipOf(doc: SystemDoc, id: string) {
  const i = Math.max(0, doc.nodes.findIndex(n => n.id === id));
  const client = /client|device|bot$/.test(doc.nodes[i]?.type ?? '');
  return client ? `203.0.113.${20 + i}` : `10.0.${1 + (i >> 6)}.${10 + (i % 64) * 3}`;
}
const macOf = (doc: SystemDoc, id: string) => `02:42:0a:00:${(Math.max(0, doc.nodes.findIndex(n => n.id === id)) + 16).toString(16).padStart(2, '0')}:01`;

/** What a SQL participant actually receives for a 2PC message. */
function protoLine(kind: string, data: any, toType: string): string {
  const txn = data?.txn ?? 'tx';
  const base = kind.replace(/\.reply$/, '');
  if (/relational|pg-|mysql/.test(toType) && !kind.endsWith('.reply')) {
    if (base === 'txn.prepare') return `PREPARE TRANSACTION '${txn}';`;
    if (base === 'txn.commit') return `COMMIT PREPARED '${txn}';`;
    if (base === 'txn.abort') return `ROLLBACK PREPARED '${txn}';`;
  }
  return `${kind} ${JSON.stringify(data ?? {}).slice(0, 48)}`;
}

/** The step as it crosses the wire: application data inside TCP inside IP inside Ethernet. */
export function Layers({ doc, h }: { doc: SystemDoc; h: JourneyHop }) {
  const { c } = useTheme();
  const client = h.reply ? h.to : h.from;
  const server = h.reply ? h.from : h.to;
  const toType = doc.nodes.find(n => n.id === server)?.type ?? '';
  const w = h.tcp || h.proto ? undefined : wireOf({ doc, from: client, to: server, msg: h.msg, res: h.res, ok: h.res?.ok ?? h.ok, err: h.res?.err ?? h.err, spanMs: h.spanMs, calls: h.calls, traceId: h.traceId });
  const dport = h.proto ? (/relational|pg-|mysql/.test(toType) ? 5432 : 7000) : (w && PORT[w.proto]) ?? 443;
  const sport = 49152 + ((h.traceId * 7919 + client.length * 131) % 16000);
  const [sp, dp] = h.reply ? [dport, sport] : [sport, dport];
  const x = 1000 + ((h.traceId * 104729) % 90000);
  const y = 5000 + ((h.traceId * 15485863) % 90000);
  const flags = h.tcp === 'SYN' ? 'SYN' : h.tcp === 'SYN-ACK' ? 'SYN, ACK' : h.tcp === 'ACK' ? 'ACK' : 'PSH, ACK';
  const seq = h.tcp === 'SYN' ? `seq=${x}` : h.tcp === 'SYN-ACK' ? `seq=${y} ack=${x + 1}` : h.reply ? `seq=${y + 1} ack=${x + 1 + 220}` : `seq=${x + 1} ack=${y + 1}`;
  const app = h.tcp ? undefined : h.proto ? protoLine(h.proto, h.msg?.data, toType) : h.reply ? w?.res.find(l => l && !l.startsWith('#')) : w?.req[0];
  const appName = h.proto ? (dport === 5432 ? 'PostgreSQL protocol' : 'RPC') : w?.proto === 'SQL' ? 'PostgreSQL protocol' : w?.proto === 'RESP' ? 'Redis protocol (RESP)' : w?.proto ?? 'HTTP';
  const [src, dst] = [h.from, h.to];
  return (
    <View style={{ marginTop: space.m }}>
      <Text v="caption" color={c.text3} style={{ marginBottom: 6 }}>
        NETWORK LAYERS · each wraps the one inside
      </Text>
      <Box tone={c.text3} title="L2 · Ethernet frame" lines={[`${macOf(doc, src)} → ${macOf(doc, dst)}`, 'type 0x0800 (IPv4) · rewritten at every router']}>
        <Box tone={c.protocol} title="L3 · IP packet" lines={[`${ipOf(doc, src)} → ${ipOf(doc, dst)}`, 'protocol 6 (TCP) · TTL 64']}>
          <Box tone={c.warn} title={`L4 · TCP segment${h.tcp ? ' (handshake)' : ''}`} lines={[`port ${sp} → ${dp}`, `[${flags}] ${seq}`]}>
            {app ? <Box tone={c.read} title={`L7 · ${appName}`} lines={[app]} /> : <Text v="callout" color={c.text3} style={{ fontSize: 12 }}>No payload: handshake segments carry only TCP headers.</Text>}
          </Box>
        </Box>
      </Box>
    </View>
  );
}

function Box({ tone, title, lines, children }: { tone: string; title: string; lines: string[]; children?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[styles.box, { borderColor: tone, backgroundColor: c.surface1 }]}>
      <Text v="caption" color={tone}>
        {title}
      </Text>
      {lines.map(l => (
        <Mono key={l} numberOfLines={2} style={styles.ln}>
          {l}
        </Mono>
      ))}
      {children ? <View style={{ marginTop: 6 }}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, padding: 8, gap: 2 },
  ln: { fontSize: 11.5, lineHeight: 16 },
});
