import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { problems, templates, type ProblemDef } from '@dsims/content';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space } from '../theme';
import { Screen } from '../ui/Screen';
import { Card, Segmented, Text } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { MiniGraph } from '../ui/MiniGraph';
import { useProgress } from '../state/progress';

export function ProblemsScreen() {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [f, setF] = useState<'all' | 'classic' | 'product' | 'infra'>('all');
  const challenges = useProgress(s => s.challenges);
  const list = [...problems].sort((a, b) => a.order - b.order).filter(p => f === 'all' || p.category === f);
  const stars = (p: ProblemDef) => p.challenges.filter(ch => challenges[`${p.id}/${ch.id}`]?.passed).length;
  return (
    <Screen>
      <Text v="callout" color={c.text2} style={{ marginBottom: space.m }}>
        Real systems. Build, then survive the challenge.
      </Text>
      <Segmented options={['all', 'classic', 'product', 'infra'] as const} value={f} onChange={setF} labels={{ all: 'All', classic: 'Classic', product: 'Product', infra: 'Infra' }} />
      <View style={{ gap: 10, marginTop: space.l }}>
        {list.map(p => {
          const v2 = p.designs.find(d => d.id === 'v2') ?? p.designs[0];
          const n = stars(p);
          return (
            <Card key={p.id} onPress={() => nav.navigate('Problem', { problemId: p.id })}>
              <View style={styles.row}>
                <View style={[styles.thumb, { borderColor: c.hairline }]}>
                  <MiniGraph doc={v2 ? templates[v2.template] : undefined} width={92} height={70} seed={p.order} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name={p.icon} size={16} color={c.text2} />
                    <Text v="headline" numberOfLines={1} style={{ flex: 1 }}>
                      {p.title}
                    </Text>
                  </View>
                  <Text v="callout" color={c.text2} numberOfLines={2}>
                    {p.summary}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 2, marginTop: 2 }}>
                    {p.challenges.map((ch, i) => (
                      <Icon key={ch.id} name="star" size={13} color={i < n ? c.warn : c.text3} strokeWidth={i < n ? 2.6 : 1.6} />
                    ))}
                    <Text v="callout" color={c.text3} style={{ marginLeft: 6, fontSize: 12 }}>
                      {p.category}
                    </Text>
                  </View>
                </View>
                <Icon name="chevron-right" size={16} color={c.text3} />
              </View>
            </Card>
          );
        })}
        {!list.length && <Text color={c.text2} style={{ textAlign: 'center', marginTop: space.xl }}>No problems in this build yet.</Text>}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  thumb: { width: 92, height: 70, borderRadius: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
});
void Pressable;
