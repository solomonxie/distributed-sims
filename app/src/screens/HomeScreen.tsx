import React, { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problems, templates, topics, type TopicDef } from '@dsims/content';
import type { SystemDoc } from '@dsims/engine';
import { MiniGraph } from '../ui/MiniGraph';
import { FrameThumb, thumbFrame } from '../canvas/FrameThumb';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space, radius, type as typo } from '../theme';
import { Button, Card, IconButton, Progress, Text } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { Section, SectionHead, Tile, TileGrid, useTileWidth } from '../ui/Tile';
import { useProgress } from '../state/progress';
import { useLibrary, blankDoc, forkDoc, saveSystem } from '../state/library';
import { openLesson } from '../learn/open';
import { demoGroups } from '../lib/demoGroups';
import { LANGUAGES, langTopics, type LangId } from '../lib/languages';
import { ago } from './ProblemScreen';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export type TopicGroup = Exclude<TopicDef['group'], 'languages'>;
export const TOPIC_SECTIONS: { id: TopicGroup; title: string; icon: string }[] = [
  { id: 'topics', title: 'Concepts', icon: 'network' },
  { id: 'network', title: 'Network', icon: 'globe' },
  { id: 'machine', title: 'Machine level', icon: 'cpu' },
  { id: 'under-the-hood', title: 'Tech stack', icon: 'layers' },
];
/** topic sections shown after Languages */
export const LATE_SECTIONS: { id: TopicGroup; title: string; icon: string }[] = [
  { id: 'ai', title: 'ML & LLMs', icon: 'sparkles' },
  { id: 'patterns', title: 'Algorithms', icon: 'shapes' },
];

export const STARTERS = [
  { slug: 'paradigm-layered', label: 'Layered monolith' },
  { slug: 'edge-lb-algorithms', label: 'API behind a load balancer' },
  { slug: 'compute-serverless', label: 'Serverless' },
  { slug: 'mq-fanout', label: 'Event-driven fan-out' },
  { slug: 'paradigm-ddd', label: 'DDD bounded contexts' },
  { slug: 'paradigm-cell-based', label: 'Cell-based' },
];

type Thumb = (w: number, h: number) => React.ReactNode;
const graphThumb = (doc?: SystemDoc, seed = 0): Thumb | undefined => (doc ? (w, h) => <MiniGraph doc={doc} width={w} height={h} seed={seed} /> : undefined);
const demoThumb = (slug?: string): Thumb | undefined => (slug && thumbFrame(slug) ? (w, h) => <FrameThumb slug={slug} width={w} height={h} /> : undefined);

/** A topic's preview: its first system template, else its first animation. */
function topicThumb(t: TopicDef): Thumb | undefined {
  const tpl = t.lessons.map(l => (l as any).template as string | undefined).find(x => x && templates[x]);
  if (tpl) return graphThumb(templates[tpl], t.order);
  const slug = t.lessons.map(l => (l as any).algo as string | undefined).find(Boolean) ?? (t as any).algos?.[0];
  return demoThumb(slug);
}
const langThumb =
  (icon: string): Thumb =>
  (_w, h) =>
    <Icon name={icon} size={h * 0.6} />;

const sortedTopics = () => [...topics].sort((a, b) => a.order - b.order);

export function useTopicDone() {
  const lessons = useProgress(s => s.lessons);
  return (t: TopicDef) => t.lessons.filter(l => lessons[`${t.id}/${l.id}`]).length;
}

export { topicThumb, demoThumb };

export function TopicTile({ t, nav }: { t: TopicDef; nav: Nav }) {
  const done = useTopicDone()(t);
  const n = t.lessons.length;
  return <Tile icon={t.icon} title={t.title} thumb={topicThumb(t)} meta={`${done}/${n}`} progress={done / Math.max(1, n)} done={n > 0 && done === n} onPress={() => nav.navigate('Topic', { topicId: t.id })} />;
}

export function LanguageTile({ id, nav }: { id: LangId; nav: Nav }) {
  const doneIn = useTopicDone();
  const l = LANGUAGES.find(x => x.id === id)!;
  const ts = langTopics(id);
  const n = ts.reduce((a, t) => a + t.lessons.length, 0);
  const done = ts.reduce((a, t) => a + doneIn(t), 0);
  return <Tile icon={l.icon} title={l.name} thumb={langThumb(l.icon)} meta={n ? `${ts.length} topics` : 'soon'} progress={n ? done / n : undefined} done={n > 0 && done === n} onPress={() => nav.navigate('Language', { id })} />;
}

export async function createSystem(nav: Nav, slug?: string) {
  const doc = slug && templates[slug] ? forkDoc(templates[slug], STARTERS.find(s => s.slug === slug)?.label ?? templates[slug].name) : blankDoc();
  await saveSystem(doc);
  nav.navigate('Editor', { doc });
}

export function templateMenu(nav: Nav) {
  const avail = STARTERS.filter(s => templates[s.slug]);
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: 'Start from a template',
      options: [...avail.map(s => s.label), 'Cancel'],
      cancelButtonIndex: avail.length,
    },
    i => {
      if (i < avail.length) createSystem(nav, avail[i].slug);
    },
  );
}

/** Text-first category card: icon, name, count, progress once started. */
function CategoryCard({ icon, title, meta, progress, onPress }: { icon: string; title: string; meta: string; progress: number; onPress: () => void }) {
  const { c } = useTheme();
  const w = useTileWidth();
  const done = progress >= 1;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [styles.cat, { width: w, backgroundColor: c.surface1, borderColor: c.hairline }, pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] }]}>
      <Icon name={done ? 'circle-check' : icon} size={22} color={done ? c.ok : c.accent} />
      <View style={{ gap: 6 }}>
        <Text v="headline" numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.catMeta}>
          <Text v="callout" color={c.text2}>
            {meta}
          </Text>
          {progress > 0 && <Progress value={progress} color={done ? c.ok : c.accent} style={{ flex: 1 }} />}
        </View>
      </View>
    </Pressable>
  );
}

const lessonCount = (ts: TopicDef[]) => ts.reduce((a, t) => a + t.lessons.length, 0);

export function HomeScreen() {
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { items: systems, refresh } = useLibrary();
  const challenges = useProgress(s => s.challenges);
  const doneIn = useTopicDone();
  const [q, setQ] = useState('');
  useEffect(() => {
    refresh();
  }, [refresh]);

  const all = useMemo(sortedTopics, []);
  const started = all.filter(t => {
    const d = doneIn(t);
    return d > 0 && d < t.lessons.length;
  });
  const ratio = (ts: TopicDef[]) => ts.reduce((a, t) => a + doneIn(t), 0) / Math.max(1, lessonCount(ts));
  const langs = LANGUAGES.flatMap(l => langTopics(l.id));
  const cats = [
    ...TOPIC_SECTIONS.map(s => ({
      ...s,
      list: all.filter(t => t.group === s.id),
      go: () => nav.navigate('Topics', { group: s.id }),
    })),
    {
      id: 'languages',
      title: 'Languages',
      icon: 'code-xml',
      list: langs,
      meta: `${LANGUAGES.length} languages`,
      go: () => nav.navigate('Languages'),
    },
    ...LATE_SECTIONS.map(s => ({
      ...s,
      list: all.filter(t => t.group === s.id),
      go: () => nav.navigate('Topics', { group: s.id }),
    })),
  ].filter(x => x.list.length);
  const stars = problems.reduce((a, p) => a + p.challenges.filter(ch => challenges[`${p.id}/${ch.id}`]?.passed).length, 0);
  const maxStars = problems.reduce((a, p) => a + p.challenges.length, 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingHorizontal: space.l,
        paddingBottom: insets.bottom + 40,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.head}>
        <Text v="display" style={{ flex: 1, fontSize: 30 }}>
          Distributed Sims
        </Text>
        <IconButton name="settings" onPress={() => nav.navigate('Settings')} label="Settings" />
      </View>
      <View style={[styles.search, { backgroundColor: c.surface1, borderColor: c.hairline }]}>
        <Icon name="search" size={16} color={c.text3} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search lessons, problems, animations" placeholderTextColor={c.text3} style={[typo.body, { flex: 1, color: c.text, paddingVertical: 10 }]} clearButtonMode="while-editing" autoCorrect={false} />
      </View>

      {q.trim() ? (
        <SearchResults q={q.trim().toLowerCase()} nav={nav} onClear={() => setQ('')} />
      ) : (
        <>
          {started.length > 0 && (
            <Section title="Continue learning">
              {started.slice(0, 6).map(t => (
                <TopicTile key={t.id} t={t} nav={nav} />
              ))}
            </Section>
          )}

          <View style={{ marginTop: space.xxl }}>
            <SectionHead title="Learn" />
            <TileGrid>
              {cats.map(k => (
                <CategoryCard key={k.id} icon={k.icon} title={k.title} meta={'meta' in k ? k.meta : `${k.list.length} topics`} progress={ratio(k.list)} onPress={k.go} />
              ))}
            </TileGrid>
          </View>

          <View style={{ marginTop: space.xxl }}>
            <SectionHead title="Practice" />
            <Card onPress={() => nav.navigate('Problems')}>
              <View style={styles.cont}>
                <Icon name="trophy" size={22} color={c.accent} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text v="headline">Design problems</Text>
                  <Text v="callout" color={c.text2}>
                    {`${problems.length} real systems · ${stars}/${maxStars} ★`}
                  </Text>
                </View>
                <Icon name="chevron-right" size={18} color={c.text3} />
              </View>
            </Card>
          </View>

          <Section title="Build" count={systems.length} onSeeAll={() => nav.navigate('Mine')}>
            {[<Tile key="new" icon="plus" title="New system" meta="blank canvas" onPress={() => createSystem(nav)} />, ...(systems.length ? [] : [<Tile key="tpl" icon="layout-template" title="From a template" meta={`${STARTERS.length} starters`} onPress={() => templateMenu(nav)} />]), ...systems.map(it => <Tile key={it.id} icon="layers" title={it.name} thumb={graphThumb(it.doc)} meta={`${it.nodes} parts · ${ago(it.updatedAt)}`} onPress={() => nav.navigate('Editor', { doc: it.doc })} />)]}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

function SearchResults({ q, nav, onClear }: { q: string; nav: Nav; onClear: () => void }) {
  const { c } = useTheme();
  const hits = useMemo(() => {
    const out: {
      key: string;
      icon: string;
      title: string;
      sub: string;
      go: () => void;
    }[] = [];
    for (const t of topics)
      for (const l of t.lessons)
        if (`${t.title} ${l.title}`.toLowerCase().includes(q))
          out.push({
            key: `l-${t.id}-${l.id}`,
            icon: t.icon,
            title: l.title,
            sub: `Lesson · ${t.title}`,
            go: () => openLesson(nav, t, l),
          });
    for (const p of problems)
      if (`${p.title} ${p.summary}`.toLowerCase().includes(q))
        out.push({
          key: `p-${p.id}`,
          icon: p.icon,
          title: p.title,
          sub: 'Problem',
          go: () => nav.navigate('Problem', { problemId: p.id }),
        });
    for (const g of demoGroups())
      for (const d of g.demos)
        if (`${d.title} ${d.summary}`.toLowerCase().includes(q))
          out.push({
            key: `d-${d.slug}`,
            icon: g.icon,
            title: d.title,
            sub: `Animation · ${g.label}`,
            go: () => nav.navigate('AlgorithmPlayer', { slug: d.slug }),
          });
    return out.slice(0, 40);
  }, [q, nav]);
  if (!hits.length)
    return (
      <View style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}>
        <Text color={c.text2}>Nothing matches “{q}”.</Text>
        <Button small kind="text" title="Clear" onPress={onClear} />
      </View>
    );
  return (
    <Card style={{ marginTop: space.l }}>
      {hits.map((h, i) => (
        <Pressable
          key={h.key}
          onPress={h.go}
          style={({ pressed }) => [
            styles.hit,
            i < hits.length - 1 && {
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: c.hairlineStrong,
            },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Icon name={h.icon} size={18} color={c.text2} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1}>{h.title}</Text>
            <Text v="callout" color={c.text3} numberOfLines={1}>
              {h.sub}
            </Text>
          </View>
          <Icon name="chevron-right" size={16} color={c.text3} />
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.m,
    minHeight: 44,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cont: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  cat: {
    height: 104,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
  },
  catMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
});
