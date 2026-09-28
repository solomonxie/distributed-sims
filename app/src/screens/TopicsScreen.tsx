import React from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { topics } from '@dsims/content';
import type { RootStackParamList } from '../navigation/types';
import { Screen } from '../ui/Screen';
import { TileGrid } from '../ui/Tile';
import { TopicTile } from './HomeScreen';

/** "See all" for one topic group. */
export function TopicsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { group } = useRoute<RouteProp<RootStackParamList, 'Topics'>>().params;
  const list = [...topics].filter(t => t.group === group).sort((a, b) => a.order - b.order);
  return (
    <Screen>
      <TileGrid>
        {list.map(t => (
          <TopicTile key={t.id} t={t} nav={nav} />
        ))}
      </TileGrid>
    </Screen>
  );
}
