import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SystemDoc } from '@dsims/engine';
import { problems, templates } from '@dsims/content';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space } from '../theme';
import { Screen } from '../ui/Screen';
import { Button, Card, Row, SectionHeader, Text } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { MiniGraph } from '../ui/MiniGraph';
import { useProgress } from '../state/progress';
import { useLibrary, forkDoc, saveSystem, blankDoc } from '../state/library';
import { openLink } from '../learn/open';

export function ProblemScreen() {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Problem'>>();
  const p = problems.find(x => x.id === route.params.problemId);
  const challenges = useProgress(s => s.challenges);
  const opened = useProgress(s => s.designsOpened);
  const mine = useLibrary(s => s.items.find(i => (i.doc as any).problemId === route.params.problemId));
  const [estOpen, setEstOpen] = useState(false);
  if (!p) return null;
  const v1 = p.designs.find(d => d.id === 'v1');
  const v2 = p.designs.find(d => d.id === 'v2');
  const attempted = p.challenges.some(ch => challenges[`${p.id}/${ch.id}`]) || !!opened[p.id];
  const startFrom = async (tpl?: string) => {
    const base: SystemDoc = tpl && templates[tpl] ? templates[tpl] : blankDoc();
    const doc = forkDoc(base, `${p.title} (my design)`);
    (doc as any).problemId = p.id;
    await saveSystem(doc);
    useProgress.getState().openedDesign(p.id);
    nav.navigate('Editor', { doc });
  };
  const runChallenge = (chId: string) => {
    const ch = p.challenges.find(x => x.id === chId) as any;
    const baseDoc: SystemDoc | undefined = mine?.doc ?? (ch.template ? templates[ch.template] : v2 ? templates[v2.template] : undefined);
    if (!baseDoc) return;
    const doc: SystemDoc = { ...baseDoc, scenario: ch.scenario ? { ...ch.scenario, challenge: { id: ch.id, title: ch.title, pass: ch.pass } } : baseDoc.scenario };
    nav.navigate('Editor', { doc, readOnly: !mine, autoRun: true, guide: { kind: 'challenge', problemId: p.id, challengeId: ch.id } });
  };
  return (
    <Screen contentStyle={{ paddingTop: space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name={p.icon} size={26} color={c.accent} />
        <Text v="body" color={c.text2} style={{ flex: 1, fontSize: 16 }}>
          {p.summary}
        </Text>
      </View>
      <SectionHeader title="REQUIREMENTS" />
      <Card padded>
        {p.requirements.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: i < p.requirements.length - 1 ? 6 : 0 }}>
            <Text color={c.accent}>•</Text>
            <Text style={{ flex: 1 }}>{r}</Text>
          </View>
        ))}
      </Card>
      <Pressable onPress={() => setEstOpen(!estOpen)}>
        <SectionHeader title="ESTIMATES" right={<Icon name={estOpen ? 'chevron-down' : 'chevron-right'} size={16} color={c.text3} />} />
      </Pressable>
      {estOpen && (
        <Card padded>
          {p.estimates.map((e, i) => (
            <Text key={i} v="callout" style={{ fontFamily: 'Menlo', marginBottom: 4 }}>
              {e}
            </Text>
          ))}
        </Card>
      )}
      <SectionHeader title="DESIGNS" />
      <Card>
        {v1 && <DesignRow title={`v1  ${v1.title}`} doc={templates[v1.template]} onPress={() => nav.navigate('Editor', { doc: templates[v1.template], readOnly: true })} />}
        {v2 && (
          <DesignRow
            title={`v2  ${v2.title}`}
            doc={templates[v2.template]}
            onPress={() => nav.navigate('Editor', { doc: templates[v2.template], readOnly: true })}
          />
        )}
        {mine && <DesignRow title={`✎  My design`} subtitle={`edited ${ago(mine.updatedAt)}`} doc={mine.doc} onPress={() => nav.navigate('Editor', { doc: mine.doc })} last />}
      </Card>
      <SectionHeader title="CHALLENGES" />
      <Card>
        {p.challenges.map((ch, i) => {
          const r = challenges[`${p.id}/${ch.id}`];
          return <Row key={ch.id} title={ch.title} left={<Icon name="star" size={18} color={r?.passed ? c.warn : c.text3} strokeWidth={r?.passed ? 2.6 : 1.6} />} right={r?.passed ? <Icon name="check" size={16} color={c.ok} /> : undefined} chevron={!r?.passed} last={i === p.challenges.length - 1} onPress={() => runChallenge(ch.id)} />;
        })}
      </Card>
      {p.keyIdeas.length > 0 && (
        <>
          <SectionHeader title="KEY IDEAS" />
          <View style={styles.ideas}>
            {p.keyIdeas.map(k => (
              <Pressable key={k.label} onPress={() => openLink(nav, k.link)} disabled={!k.link || k.link === 'none'} style={({ pressed }) => [styles.idea, { borderColor: c.hairlineStrong, backgroundColor: c.surface1 }, pressed && { opacity: 0.6 }]}>
                <Text v="callout" style={{ fontSize: 14 }}>
                  {k.label}
                </Text>
                {k.link && k.link !== 'none' ? <Icon name={k.link.startsWith('algo:') ? 'diamond' : 'graduation-cap'} size={13} color={c.accent} /> : null}
              </Pressable>
            ))}
          </View>
        </>
      )}
      <View style={{ gap: 10, marginTop: space.xl }}>
        <Button kind="primary" title={mine ? 'Continue my design' : 'Start from v1'} icon="pencil-ruler" onPress={() => (mine ? nav.navigate('Editor', { doc: mine.doc }) : startFrom(v1?.template))} />
        {!mine && <Button kind="text" title="Blank canvas" onPress={() => startFrom(undefined)} />}
      </View>
    </Screen>
  );
}

function DesignRow({ title, subtitle, doc, onPress, locked, last }: { title: string; subtitle?: string; doc?: SystemDoc; onPress: () => void; locked?: boolean; last?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.design, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }, pressed && { backgroundColor: c.hairline }]}>
      <View style={[styles.thumb, { borderColor: c.hairline, opacity: locked ? 0.35 : 1 }]}>
        <MiniGraph doc={doc} width={72} height={54} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={2} style={{ opacity: locked ? 0.5 : 1 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text v="callout" color={c.text3}>
            {subtitle}
          </Text>
        ) : doc ? (
          <Text v="callout" color={c.text3}>
            {doc.nodes.length} components
          </Text>
        ) : null}
      </View>
      <Icon name={locked ? 'lock' : 'chevron-right'} size={16} color={c.text3} />
    </Pressable>
  );
}

export function ago(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(d) || d < 60) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  design: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  thumb: { width: 72, height: 54, borderRadius: 8, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  ideas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  idea: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
});
