import React, { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problems, templates, topics, type ProblemDef, type TopicDef } from '@dsims/content';
import type { SystemDoc } from '@dsims/engine';
import { MiniGraph } from '../ui/MiniGraph';
import { FrameThumb, thumbFrame } from '../canvas/FrameThumb';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space, type as typo } from '../theme';
import { Button, Card, IconButton, Text } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { Section, Tile } from '../ui/Tile';
import { useProgress } from '../state/progress';
import { useSettings } from '../state/settings';
import { useLibrary, blankDoc, forkDoc, saveSystem } from '../state/library';
import { openLesson } from '../learn/open';
import { demoGroups } from '../lib/demoGroups';
import { LANGUAGES, langTopics, type LangId } from '../lib/languages';
import { ago } from './ProblemScreen';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export type TopicGroup = Exclude<TopicDef['group'], 'languages'>;
export const TOPIC_SECTIONS: { id: TopicGroup; title: string }[] = [
  { id: 'topics', title: 'System design' },
  { id: 'under-the-hood', title: 'Tech stack' },
  { id: 'network', title: 'Network' },
  { id: 'machine', title: 'Machine level' },
];
/** topic sections shown after Languages */
export const LATE_SECTIONS: { id: TopicGroup; title: string }[] = [
  { id: 'ai', title: 'AI & LLMs' },
  { id: 'patterns', title: 'Coding patterns' },
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
const problemThumb = (p: ProblemDef) => {
  const d = p.designs.find(x => x.id === 'v2') ?? p.designs[0];
  return graphThumb(d ? templates[d.template] : undefined, p.order);
};

const langThumb = (icon: string): Thumb => (_w, h) => <Icon name={icon} size={h * 0.6} />;

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

export function ProblemTile({ p, nav }: { p: ProblemDef; nav: Nav }) {
  const challenges = useProgress(s => s.challenges);
  const stars = p.challenges.filter(ch => challenges[`${p.id}/${ch.id}`]?.passed).length;
  return <Tile icon={p.icon} title={p.title} thumb={problemThumb(p)} meta={`${stars}/${p.challenges.length} ★`} done={p.challenges.length > 0 && stars === p.challenges.length} onPress={() => nav.navigate('Problem', { problemId: p.id })} />;
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
  ActionSheetIOS.showActionSheetWithOptions({ title: 'Start from a template', options: [...avail.map(s => s.label), 'Cancel'], cancelButtonIndex: avail.length }, i => {
    if (i < avail.length) createSystem(nav, avail[i].slug);
  });
}

export function HomeScreen() {
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const firstRunDismissed = useSettings(s => s.firstRunDismissed);
  const { items: systems, refresh } = useLibrary();
  const [q, setQ] = useState('');
  useEffect(() => {
    refresh();
  }, [refresh]);

  const all = useMemo(sortedTopics, []);
  const probs = useMemo(() => [...problems].sort((a, b) => a.order - b.order), []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.canvas }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: space.l, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
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
          {!firstRunDismissed && all[0]?.lessons[0] ? (
            <Card style={{ marginTop: space.l }}>
              <View style={[styles.cont, { alignItems: 'center' }]}>
                <Icon name="sparkles" size={20} color={c.accent} />
                <Text style={{ flex: 1 }}>
                  New here? Start with {all[0].title} › {all[0].lessons[0].title}
                </Text>
                <IconButton name="x" size={16} color={c.text3} onPress={() => useSettings.getState().set({ firstRunDismissed: true })} label="Dismiss" />
              </View>
              <Button kind="primary" title="Start" icon="play" style={{ margin: space.m, marginTop: 0 }} onPress={() => openLesson(nav, all[0], all[0].lessons[0])} />
            </Card>
          ) : null}

          {TOPIC_SECTIONS.map(s => {
            const list = all.filter(t => t.group === s.id);
            if (!list.length) return null;
            return (
              <React.Fragment key={s.id}>
                <Section title={s.title} count={list.length} onSeeAll={() => nav.navigate('Topics', { group: s.id })}>
                  {list.map(t => (
                    <TopicTile key={t.id} t={t} nav={nav} />
                  ))}
                </Section>
                {s.id === 'under-the-hood' && (
                  <Section title="Problems" count={probs.length} onSeeAll={() => nav.navigate('Problems')}>
                    {probs.map(p => (
                      <ProblemTile key={p.id} p={p} nav={nav} />
                    ))}
                  </Section>
                )}
              </React.Fragment>
            );
          })}

          <Section title="Languages" count={LANGUAGES.length} onSeeAll={() => nav.navigate('Languages')}>
            {LANGUAGES.map(l => (
              <LanguageTile key={l.id} id={l.id} nav={nav} />
            ))}
          </Section>

          {LATE_SECTIONS.map(s => {
            const list = all.filter(t => t.group === s.id);
            if (!list.length) return null;
            return (
              <Section key={s.id} title={s.title} count={list.length} onSeeAll={() => nav.navigate('Topics', { group: s.id })}>
                {list.map(t => (
                  <TopicTile key={t.id} t={t} nav={nav} />
                ))}
              </Section>
            );
          })}

          <Section title="My systems" count={systems.length} onSeeAll={() => nav.navigate('Mine')}>
            {[
              <Tile key="new" icon="plus" title="New system" meta="blank canvas" onPress={() => createSystem(nav)} />,
              ...(systems.length ? [] : [<Tile key="tpl" icon="layout-template" title="From a template" meta={`${STARTERS.length} starters`} onPress={() => templateMenu(nav)} />]),
              ...systems.map(it => <Tile key={it.id} icon="layers" title={it.name} thumb={graphThumb(it.doc)} meta={`${it.nodes} parts · ${ago(it.updatedAt)}`} onPress={() => nav.navigate('Editor', { doc: it.doc })} />),
            ]}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

function SearchResults({ q, nav, onClear }: { q: string; nav: Nav; onClear: () => void }) {
  const { c } = useTheme();
  const hits = useMemo(() => {
    const out: { key: string; icon: string; title: string; sub: string; go: () => void }[] = [];
    for (const t of topics) for (const l of t.lessons) if (`${t.title} ${l.title}`.toLowerCase().includes(q)) out.push({ key: `l-${t.id}-${l.id}`, icon: t.icon, title: l.title, sub: `Lesson · ${t.title}`, go: () => openLesson(nav, t, l) });
    for (const p of problems) if (`${p.title} ${p.summary}`.toLowerCase().includes(q)) out.push({ key: `p-${p.id}`, icon: p.icon, title: p.title, sub: 'Problem', go: () => nav.navigate('Problem', { problemId: p.id }) });
    for (const g of demoGroups()) for (const d of g.demos) if (`${d.title} ${d.summary}`.toLowerCase().includes(q)) out.push({ key: `d-${d.slug}`, icon: g.icon, title: d.title, sub: `Animation · ${g.label}`, go: () => nav.navigate('AlgorithmPlayer', { slug: d.slug }) });
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
        <Pressable key={h.key} onPress={h.go} style={({ pressed }) => [styles.hit, i < hits.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }, pressed && { opacity: 0.6 }]}>
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
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: space.m, minHeight: 44 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  cont: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
});
