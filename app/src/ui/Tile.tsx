import React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTheme, space } from '../theme';
import { Icon } from './Icon';
import { Progress, Text } from './primitives';

const GAP = 8;
const COLS = 3;

/** Width of one tile in the 3-column grid. */
export function useTileWidth() {
  const { width } = useWindowDimensions();
  return (width - space.l * 2 - GAP * (COLS - 1)) / COLS;
}

/** Uniform grid tile: icon, 2-line title, one meta line (optional progress). */
export function Tile({ icon, title, meta, progress, done, onPress, onLongPress, tint }: { icon: string; title: string; meta?: string; progress?: number; done?: boolean; onPress: () => void; onLongPress?: () => void; tint?: string }) {
  const { c } = useTheme();
  const w = useTileWidth();
  const col = done ? c.ok : tint ?? c.accent;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [styles.tile, { width: w, backgroundColor: c.surface1, borderColor: c.hairline }, pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] }]}>
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: c.surface2 }]}>
          <Icon name={icon} size={16} color={col} />
        </View>
        {done && <Icon name="circle-check" size={14} color={c.ok} />}
      </View>
      <Text v="headline" style={{ fontSize: 13.5, lineHeight: 17 }} numberOfLines={2}>
        {title}
      </Text>
      <View style={{ flex: 1 }} />
      <View style={styles.meta}>
        {progress !== undefined && <Progress value={progress} color={col} style={{ flex: 1 }} />}
        {!!meta && (
          <Text v="callout" color={c.text2} style={{ fontSize: 11, flexShrink: 1 }} numberOfLines={1}>
            {meta}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export function TileGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/** Home section: caption header with count and "See all", then at most two rows of tiles. */
export function Section({ title, count, onSeeAll, children }: { title: string; count?: number; onSeeAll?: () => void; children: React.ReactNode[] }) {
  const { c } = useTheme();
  const shown = children.slice(0, COLS * 2);
  const more = onSeeAll && children.length > shown.length;
  return (
    <View style={{ marginTop: space.xl }}>
      <View style={styles.head}>
        <Text v="caption">{title}</Text>
        {count !== undefined && (
          <Text v="caption" color={c.text3} style={{ marginLeft: 6 }}>
            {count}
          </Text>
        )}
        <View style={{ flex: 1 }} />
        {onSeeAll && (
          <Pressable hitSlop={10} onPress={onSeeAll} style={styles.all} accessibilityRole="button" accessibilityLabel={`See all ${title}`}>
            <Text v="callout" color={c.accent}>
              {more ? 'See all' : 'Open'}
            </Text>
            <Icon name="chevron-right" size={14} color={c.accent} />
          </Pressable>
        )}
      </View>
      <TileGrid>{shown}</TileGrid>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { height: 112, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  all: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
