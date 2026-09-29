import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space } from '../theme';
import { Screen } from '../ui/Screen';
import { Card, Row, SectionHeader } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { Tile, TileGrid } from '../ui/Tile';
import { demoGroups, KIND_LABEL, type DemoKind } from '../lib/demoGroups';
import { demoThumb } from './HomeScreen';

/** Without `group`: every animation group as tiles, by kind. With `group`: that group's animations. */
export function AlgorithmsScreen() {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const group = useRoute<RouteProp<RootStackParamList, 'Algorithms'>>().params?.group;
  const groups = useMemo(demoGroups, []);

  const one = group ? groups.find(g => g.id === group) : undefined;
  if (one)
    return (
      <Screen>
        <Card>
          {one.demos.map((d, i, arr) => (
            <Row key={d.slug} left={<Icon name={one.icon} size={18} color={c.protocol} />} title={d.title} subtitle={d.summary} chevron last={i === arr.length - 1} onPress={() => nav.navigate('AlgorithmPlayer', { slug: d.slug })} />
          ))}
        </Card>
      </Screen>
    );

  const kinds = [...new Set(groups.map(g => g.kind))] as DemoKind[];
  return (
    <Screen>
      {kinds.map((k, i) => (
        <View key={k} style={{ marginTop: i ? space.l : 0 }}>
          <SectionHeader title={KIND_LABEL[k].toUpperCase()} />
          <TileGrid>
            {groups
              .filter(g => g.kind === k)
              .map(g => (
                <Tile key={g.id} icon={g.icon} title={g.label} thumb={demoThumb(g.demos[0]?.slug)} meta={`${g.demos.length} animations`} onPress={() => nav.push('Algorithms', { group: g.id })} />
              ))}
          </TileGrid>
        </View>
      ))}
    </Screen>
  );
}
