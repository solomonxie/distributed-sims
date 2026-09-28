import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { topics, templates, type TopicDef } from '@dsims/content';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space, type as typo } from '../theme';
import { Screen } from '../ui/Screen';
import { Button, Card, Progress, SectionHeader, Text, IconButton } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { MiniGraph } from '../ui/MiniGraph';
import { useProgress } from '../state/progress';
import { useSettings } from '../state/settings';
import { openLesson } from '../learn/open';

const GROUPS: { id: TopicDef['group']; title: string }[] = [
  { id: 'topics', title: 'TOPICS' },
  { id: 'under-the-hood', title: 'UNDER THE HOOD' },
  { id: 'machine', title: 'MACHINE LEVEL' },
];

export function LearnScreen() {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width } = useWindowDimensions();
  const lessons = useProgress(s => s.lessons);
  const last = useProgress(s => s.lastLesson);
  const firstRunDismissed = useSettings(s => s.firstRunDismissed);
  const [q, setQ] = useState('');
  const cardW = (width - space.l * 2 - 10) / 2;

  const doneIn = (t: TopicDef) => t.lessons.filter(l => lessons[`${t.id}/${l.id}`]).length;
  const sorted = useMemo(() => [...topics].sort((a, b) => a.order - b.order), []);
  const query = q.trim().toLowerCase();
  const hits = useMemo(() => {
    if (!query) return [];
    const out: { t: TopicDef; l: TopicDef['lessons'][number] }[] = [];
    for (const t of topics) for (const l of t.lessons) if (`${t.title} ${l.title}`.toLowerCase().includes(query)) out.push({ t, l });
    return out.slice(0, 30);
  }, [query]);

  const lastTopic = last ? topics.find(t => t.id === last.topic) : undefined;
  const lastLesson = lastTopic?.lessons.find(l => l.id === last!.lesson);
  const totalDone = topics.filter(t => t.group === 'topics' && t.lessons.length && doneIn(t) === t.lessons.length).length;

  return (
    <Screen title="Learn">
      <View style={[styles.search, { backgroundColor: c.surface1, borderColor: c.hairline }]}>
        <Icon name="search" size={16} color={c.text3} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search topics and lessons" placeholderTextColor={c.text3} style={[typo.body, { flex: 1, color: c.text, paddingVertical: 10 }]} clearButtonMode="while-editing" autoCorrect={false} />
      </View>
      {query ? (
        <>
          <SectionHeader title={`${hits.length} LESSONS`} />
          <Card>
            {hits.map(({ t, l }, i) => (
              <Pressable key={t.id + l.id} onPress={() => openLesson(nav, t, l)} style={({ pressed }) => [styles.hit, i < hits.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }, pressed && { opacity: 0.6 }]}>
                <Icon name={t.icon} size={18} color={c.text2} />
                <View style={{ flex: 1 }}>
                  <Text>{l.title}</Text>
                  <Text v="callout" color={c.text3}>
                    {t.title}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={c.text3} />
              </Pressable>
            ))}
          </Card>
          {!hits.length && (
            <View style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
              <Text color={c.text2}>No lessons match “{q}”.</Text>
              <Button small kind="text" title="Clear" onPress={() => setQ('')} />
            </View>
          )}
        </>
      ) : (
        <>
          {lastTopic && lastLesson ? (
            <>
              <SectionHeader title="CONTINUE" />
              <Card onPress={() => openLesson(nav, lastTopic, lastLesson)}>
                <View style={styles.cont}>
                  <View style={[styles.thumb, { borderColor: c.hairline }]}>
                    <MiniGraph doc={(lastLesson as any).template ? templates[(lastLesson as any).template] : undefined} width={112} height={84} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text v="callout" color={c.text2}>
                      {lastTopic.title}
                    </Text>
                    <Text v="headline" numberOfLines={2}>
                      {lastLesson.title}
                    </Text>
                    <Text v="callout" color={c.text3}>
                      {doneIn(lastTopic)}/{lastTopic.lessons.length} · {lastLesson.minutes} min
                    </Text>
                    <Progress value={doneIn(lastTopic) / Math.max(1, lastTopic.lessons.length)} style={{ marginTop: 4 }} />
                  </View>
                </View>
              </Card>
            </>
          ) : !firstRunDismissed && sorted[0] ? (
            <Card style={{ marginTop: space.m }}>
              <View style={[styles.cont, { alignItems: 'center' }]}>
                <Icon name="sparkles" size={22} color={c.accent} />
                <Text style={{ flex: 1 }}>
                  New here? Start with {sorted[0].title} › {sorted[0].lessons[0]?.title}
                </Text>
                <IconButton name="x" size={16} color={c.text3} onPress={() => useSettings.getState().set({ firstRunDismissed: true })} />
              </View>
              <Button kind="primary" title="Start" icon="play" style={{ margin: space.m, marginTop: 0 }} onPress={() => sorted[0].lessons[0] && openLesson(nav, sorted[0], sorted[0].lessons[0])} />
            </Card>
          ) : null}
          {GROUPS.map(g => {
            const list = sorted.filter(t => t.group === g.id);
            if (!list.length) return null;
            return (
              <View key={g.id}>
                <SectionHeader title={g.title} right={g.id === 'topics' ? `${totalDone} of ${list.length} ✓` : undefined} />
                <View style={styles.grid}>
                  {list.map((t, i) => (
                    <TopicCard key={t.id} t={t} w={cardW} done={doneIn(t)} seed={i} onPress={() => nav.navigate('Topic', { topicId: t.id })} />
                  ))}
                </View>
              </View>
            );
          })}
          {!topics.length && <Text color={c.text2} style={{ marginTop: space.xl, textAlign: 'center' }}>Lessons are loading into this build.</Text>}
        </>
      )}
    </Screen>
  );
}

function TopicCard({ t, w, done, seed, onPress }: { t: TopicDef; w: number; done: number; seed: number; onPress: () => void }) {
  const { c } = useTheme();
  const tplLesson = t.lessons.find(l => (l as any).template && templates[(l as any).template]);
  const doc = tplLesson ? templates[(tplLesson as any).template] : undefined;
  const complete = t.lessons.length > 0 && done === t.lessons.length;
  return (
    <Card onPress={onPress} style={{ width: w }}>
      <View style={{ height: 86, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairline, alignItems: 'center', justifyContent: 'center' }}>
        {doc ? <MiniGraph doc={doc} width={w} height={86} seed={seed} /> : <Icon name={t.icon} size={34} color={c.text3} strokeWidth={1.5} />}
        <View style={[styles.badgeIcon, { backgroundColor: c.surface2 }]}>
          <Icon name={t.icon} size={14} color={complete ? c.ok : c.accent} />
        </View>
      </View>
      <View style={{ padding: 12, gap: 6 }}>
        <Text v="headline" style={{ fontSize: 15 }} numberOfLines={2}>
          {t.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Progress value={done / Math.max(1, t.lessons.length)} color={complete ? c.ok : c.accent} style={{ flex: 1 }} />
          <Text v="callout" color={c.text2} style={{ fontSize: 12 }}>
            {done}/{t.lessons.length}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cont: { flexDirection: 'row', gap: 12, padding: 12 },
  thumb: { width: 112, height: 84, borderRadius: 12, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  hit: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  badgeIcon: { position: 'absolute', left: 8, top: 8, width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
