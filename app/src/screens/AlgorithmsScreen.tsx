import React, { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { algo } from '@dsims/engine';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, type as typo } from '../theme';
import { Screen } from '../ui/Screen';
import { Card, Row, SectionHeader, Segmented } from '../ui/primitives';
import { Icon } from '../ui/Icon';

const GROUP_ICON: Record<string, string> = {
  Graph: 'route',
  Partitioning: 'circle-dashed',
  Geo: 'map-pin',
  Probabilistic: 'dices',
  Storage: 'database',
  Distributed: 'network',
  'Rate limit': 'gauge',
  'machine-cpu': 'cpu',
  'machine-memory': 'memory-stick',
  'machine-bus': 'circuit-board',
};
const GROUP_LABEL: Record<string, string> = { 'machine-cpu': 'CPU', 'machine-memory': 'Memory', 'machine-bus': 'Chips, buses & I/O' };

export function AlgorithmsScreen() {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'algorithms' | 'machine'>('algorithms');
  const all = useMemo(() => algo.allDemos(), []);
  const query = q.trim().toLowerCase();
  const list = all.filter(d => (kind === 'machine') === d.group.startsWith('machine') && (!query || `${d.title} ${d.summary} ${d.group}`.toLowerCase().includes(query)));
  const groups = [...new Set(list.map(d => d.group))];
  return (
    <Screen title="Algorithms" subtitle="Step through the ideas systems are built on.">
      <Segmented options={['algorithms', 'machine'] as const} value={kind} onChange={setKind} labels={{ algorithms: 'Algorithms', machine: 'Machine level' }} />
      <View style={[styles.search, { backgroundColor: c.surface1, borderColor: c.hairline }]}>
        <Icon name="search" size={16} color={c.text3} />
        <TextInput value={q} onChangeText={setQ} placeholder={`Search ${all.length} animations`} placeholderTextColor={c.text3} style={[typo.body, { flex: 1, color: c.text, paddingVertical: 10 }]} clearButtonMode="while-editing" autoCorrect={false} />
      </View>
      {groups.map(g => (
        <View key={g}>
          <SectionHeader title={(GROUP_LABEL[g] ?? g).toUpperCase()} />
          <Card>
            {list
              .filter(d => d.group === g)
              .map((d, i, arr) => (
                <Row key={d.slug} left={<Icon name={GROUP_ICON[g] ?? 'diamond'} size={18} color={g.startsWith('machine') ? c.write : c.protocol} />} title={d.title} subtitle={d.summary} chevron last={i === arr.length - 1} onPress={() => nav.navigate('AlgorithmPlayer', { slug: d.slug })} />
              ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 12 },
});
