import React, { useEffect } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space } from '../theme';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/primitives';
import { TileGrid } from '../ui/Tile';
import { useProgress } from '../state/progress';
import { LANGUAGES, langTopics } from '../lib/languages';
import { TopicTile } from './HomeScreen';

/** One language: its topics as tiles. */
export function LanguageScreen() {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { id } = useRoute<RouteProp<RootStackParamList, 'Language'>>().params;
  useEffect(() => useProgress.getState().visit({ kind: 'language', id }), [id]);
  const l = LANGUAGES.find(x => x.id === id);
  const list = langTopics(id);
  return (
    <Screen>
      {l && (
        <Text v="callout" color={c.text2} style={{ marginBottom: space.m }}>
          {l.blurb}
        </Text>
      )}
      <TileGrid>
        {list.map(t => (
          <TopicTile key={t.id} t={t} nav={nav} />
        ))}
      </TileGrid>
      {!list.length && (
        <Text color={c.text2} style={{ textAlign: 'center', marginTop: space.xl }}>
          Lessons for this language are on the way.
        </Text>
      )}
    </Screen>
  );
}
