import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { topics, templates, problems, type TopicDef } from '@dsims/content';
import { algo } from '@dsims/engine';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space } from '../theme';
import { Screen } from '../ui/Screen';
import { Card, Row, SectionHeader, Text, Mono } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { MiniGraph } from '../ui/MiniGraph';
import { useProgress } from '../state/progress';
import { openLesson } from '../learn/open';
import { InfoButton } from '../ui/Info';

export function TopicScreen() {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Topic'>>();
  const t = topics.find(x => x.id === route.params.topicId) as (TopicDef & { info?: string; algos?: string[]; problems?: string[] }) | undefined;
  const lessons = useProgress(s => s.lessons);
  const topicId = route.params.topicId;
  useEffect(() => useProgress.getState().visit({ kind: 'topic', id: topicId }), [topicId]);
  if (!t) return null;
  const nextIdx = t.lessons.findIndex(l => !lessons[`${t.id}/${l.id}`]);
  const heroTpl = t.lessons.map(l => (l as any).template).find((x: string | undefined) => x && templates[x]);
  const algos = (t.algos ?? []).map(slug => algo.getDemo(slug)).filter(Boolean) as algo.Demo[];
  const probs = (t.problems ?? []).map(id => problems.find(p => p.id === id)).filter(Boolean);
  return (
    <Screen contentStyle={{ paddingTop: space.m }}>
      {heroTpl ? (
        <View style={[styles.hero, { borderColor: c.hairline }]}>
          <MiniGraph doc={templates[heroTpl]} width={360} height={150} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: space.l }}>
        <Text v="body" color={c.text2} style={{ flex: 1, fontSize: 16, lineHeight: 22 }}>
          {t.summary}
        </Text>
        {t.info ? <InfoButton title={t.title} text={t.info} /> : null}
      </View>
      <SectionHeader title="LESSONS" right={`${t.lessons.filter(l => lessons[`${t.id}/${l.id}`]).length}/${t.lessons.length}`} />
      <Card>
        {t.lessons.map((l, i) => {
          const done = !!lessons[`${t.id}/${l.id}`];
          const next = i === nextIdx;
          const isAlgo = !!(l as any).algo;
          return (
            <Pressable key={l.id} onPress={() => openLesson(nav, t, l)} style={({ pressed }) => [styles.lesson, i < t.lessons.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }, pressed && { backgroundColor: c.hairline }]}>
              <View style={[styles.dot, { borderColor: done ? c.ok : next ? c.accent : c.text3, backgroundColor: done ? c.ok : 'transparent' }]}>{done && <Icon name="check" size={12} color={c.canvas} strokeWidth={3} />}</View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: next ? '700' : '400' }} numberOfLines={2}>
                  {l.title}
                </Text>
                <Text v="callout" color={c.text3}>
                  {isAlgo ? 'Animation' : 'Live system'} · {l.minutes} min
                </Text>
              </View>
              <Icon name={isAlgo ? 'play' : 'chevron-right'} size={16} color={next ? c.accent : c.text3} />
            </Pressable>
          );
        })}
      </Card>
      {algos.length > 0 && (
        <>
          <SectionHeader title="ALGORITHMS" />
          <Card>
            {algos.map((d, i) => (
              <Row key={d.slug} title={d.title} subtitle={d.summary} chevron last={i === algos.length - 1} onPress={() => nav.navigate('AlgorithmPlayer', { slug: d.slug })} left={<Icon name="diamond" size={18} color={c.protocol} />} />
            ))}
          </Card>
        </>
      )}
      {probs.length > 0 && (
        <>
          <SectionHeader title="USED IN PROBLEMS" />
          <Card>
            {probs.map((p, i) => (
              <Row key={p!.id} title={p!.title} chevron last={i === probs.length - 1} onPress={() => nav.navigate('Problem', { problemId: p!.id })} left={<Icon name={p!.icon} size={18} color={c.text2} />} />
            ))}
          </Card>
        </>
      )}
      <Mono color={c.text3} style={{ textAlign: 'center', marginTop: space.xl, fontSize: 11 }}>
        {t.lessons.length} lessons · every one runs live
      </Mono>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  lesson: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
