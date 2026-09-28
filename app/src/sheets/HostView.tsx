import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space } from '../theme';
import { Card, Mono, Row, SectionHeader, Text } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { useRun, controller } from '../state/run';
import { useDoc } from '../state/doc';
import { fmtNum } from './Inspector';

const DATA = /db|store|cache|index|kv|stream|queue|broker/;

/** Machine-level view of one node's host, derived from the engine's resource model (machine.md → Host view). */
export function HostView({ id }: { id: string }) {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const node = useDoc(s => s.doc?.nodes.find(n => n.id === id));
  const snap = useRun(s => s.snapshot?.nodes[id]);
  const sim = controller.run?.world.nodes.get(id);
  if (!node) return null;
  const cores = Math.max(2, Math.min(16, Math.round(Number(sim?.cfg.slots ?? 8) / 2)));
  const util = snap?.util ?? 0;
  const up = snap?.up ?? true;
  const t = Math.floor((snap ? useRun.getState().t : 0) / 1000);
  const coreUtil = Array.from({ length: cores }, (_, i) => (up ? Math.max(0, Math.min(1, util + Math.sin(i * 1.7 + t * 0.9) * 0.12)) : 0));
  const runQ = up ? Math.round((snap?.queue ?? 0) + Math.max(0, util - 0.7) * cores * 6) : 0;
  const memLimit = Number(sim?.cfg.memoryMb ?? 4096);
  const memUsed = up ? Math.min(memLimit, (snap?.memMb ?? 0) + memLimit * (0.35 + util * 0.3)) : 0;
  const memPressure = memUsed / memLimit;
  const faults = up ? Math.round(memPressure > 0.85 ? (memPressure - 0.85) * 40000 : 20 + util * 80) : 0;
  const ctx = up ? Math.round((snap?.rps ?? 0) * 2.2 + cores * 400) : 0;
  const l3 = up ? 6 + util * 14 : 0;
  const isData = DATA.test(node.type);
  const iowait = up && isData ? Math.min(60, 2 + util * 18 + (sim?.mods.diskFull ? 30 : 0)) : 1;
  const nicGbps = up ? ((snap?.rps ?? 0) * 2 * 8 * 1024) / 1e9 : 0;
  const paused = sim && sim.mods.pausedUntil > (controller.run?.now ?? 0);
  const warnQ = runQ > cores * 2;
  const bar = (v: number) => (v > 0.85 ? c.fail : v > 0.65 ? c.warn : c.ok);

  return (
    <View>
      <Text v="title">host: {node.name}</Text>
      <Text v="callout" color={c.text2}>
        {cores} cores · {Math.round(memLimit / 1024)} GB RAM · {isData ? 'NVMe SSD' : 'EBS'} · 25G NIC {snap ? '' : '· start a run for live values'}
      </Text>
      <Card padded style={{ marginTop: space.m }}>
        <View style={styles.row}>
          <Mono color={c.text2} style={{ width: 44 }}>
            CPU
          </Mono>
          <View style={styles.cores}>
            {coreUtil.map((u, i) => (
              <View key={i} style={[styles.core, { backgroundColor: c.hairlineStrong }]}>
                <View style={{ height: `${Math.round(u * 100)}%`, backgroundColor: bar(u), borderRadius: 2 }} />
              </View>
            ))}
          </View>
          <Mono color={warnQ ? c.warn : c.text2} style={{ width: 86, textAlign: 'right' }}>
            run-q {runQ}
            {warnQ ? ' ⚠' : ''}
          </Mono>
        </View>
        <View style={styles.kv}>
          <Mono color={c.text2}>L3 miss {l3.toFixed(0)}%</Mono>
          <Mono color={c.text2}>ctx sw {fmtNum(ctx)}/s</Mono>
          {paused && <Mono color={c.fail}>GC stop-the-world</Mono>}
        </View>
      </Card>
      <Card padded style={{ marginTop: 8 }}>
        <View style={styles.row}>
          <Mono color={c.text2} style={{ width: 44 }}>
            RAM
          </Mono>
          <View style={[styles.track, { backgroundColor: c.hairlineStrong }]}>
            <View style={{ width: `${Math.round(memPressure * 100)}%`, height: '100%', backgroundColor: bar(memPressure), borderRadius: 3 }} />
          </View>
          <Mono style={{ width: 110, textAlign: 'right' }}>
            {(memUsed / 1024).toFixed(1)} / {(memLimit / 1024).toFixed(0)} GB
          </Mono>
        </View>
        <View style={styles.kv}>
          <Mono color={faults > 1000 ? c.fail : c.text2}>page faults {fmtNum(faults)}/s{faults > 1000 ? ' ⚠' : ''}</Mono>
          <Mono color={c.text2}>swap 0</Mono>
        </View>
      </Card>
      <Card padded style={{ marginTop: 8 }}>
        <View style={styles.kv}>
          <Mono color={iowait > 20 ? c.warn : c.text2}>
            {isData ? 'NVMe' : 'disk'} iowait {iowait.toFixed(0)}%
          </Mono>
          <Mono color={c.text2}>NIC {nicGbps.toFixed(2)} Gb/s</Mono>
        </View>
      </Card>
      <SectionHeader title="WHY? SEE IT AT MACHINE LEVEL" />
      <Card>
        <Row title="Run queue & context switches" subtitle="CPU scheduling" chevron left={<Icon name="cpu" size={18} color={c.write} />} onPress={() => nav.navigate('AlgorithmPlayer', { slug: 'cpu-scheduling' })} />
        <Row title="Page faults & the page walk" subtitle="Virtual memory" chevron left={<Icon name="memory-stick" size={18} color={c.write} />} onPress={() => nav.navigate('AlgorithmPlayer', { slug: 'mem-page-fault' })} />
        <Row title="GC pauses" subtitle="Allocation & garbage collection" chevron left={<Icon name="trash-2" size={18} color={c.write} />} onPress={() => nav.navigate('AlgorithmPlayer', { slug: 'mem-gc' })} />
        <Row title="Where network latency hides" subtitle="Host networking" chevron last left={<Icon name="network" size={18} color={c.write} />} onPress={() => nav.navigate('AlgorithmPlayer', { slug: 'bus-host-net' })} />
      </Card>
      <Text v="callout" color={c.text3} style={{ marginTop: space.m }}>
        Modelled from this component's load in the simulation, not measured.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cores: { flex: 1, flexDirection: 'row', gap: 3, height: 34, alignItems: 'flex-end' },
  core: { flex: 1, height: 34, borderRadius: 2, justifyContent: 'flex-end', overflow: 'hidden' },
  track: { flex: 1, height: 10, borderRadius: 3, overflow: 'hidden' },
  kv: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8 },
});
