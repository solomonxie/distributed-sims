import React, { useEffect } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space } from '../theme';
import { Screen } from '../ui/Screen';
import { Card, Row, Text } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { TileGrid } from '../ui/Tile';
import { useProgress } from '../state/progress';
import { LANGUAGES, langTopics } from '../lib/languages';
import { LanguageTile, useTopicDone } from './HomeScreen';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** "See all" for languages. */
export function LanguagesScreen() {
  const nav = useNavigation<Nav>();
  return (
    <Screen>
      <TileGrid>
        {LANGUAGES.map(l => (
          <LanguageTile key={l.id} id={l.id} nav={nav} />
        ))}
      </TileGrid>
    </Screen>
  );
}

/** One language: its topics as a list. */
export function LanguageScreen() {
  const { c } = useTheme();
  const nav = useNavigation<Nav>();
  const { id } = useRoute<RouteProp<RootStackParamList, 'Language'>>().params;
  useEffect(() => useProgress.getState().visit({ kind: 'language', id }), [id]);
  const doneIn = useTopicDone();
  const l = LANGUAGES.find(x => x.id === id);
  const list = langTopics(id);
  return (
    <Screen>
      {l && (
        <Text v="callout" color={c.text2} style={{ marginBottom: space.m }}>
          {l.blurb}
        </Text>
      )}
      {list.length > 0 && (
        <Card>
          {list.map((t, i) => {
            const done = doneIn(t);
            const complete = done === t.lessons.length && done > 0;
            return (
              <Row key={t.id} title={t.title} subtitle={`${done}/${t.lessons.length} lessons`} chevron last={i === list.length - 1} onPress={() => nav.navigate('Topic', { topicId: t.id })} left={<Icon name={complete ? 'circle-check' : t.icon} size={18} color={complete ? c.ok : c.text2} />} />
            );
          })}
        </Card>
      )}
      {!list.length && (
        <Text color={c.text2} style={{ textAlign: 'center', marginTop: space.xl }}>
          Lessons for this language are on the way.
        </Text>
      )}
    </Screen>
  );
}
