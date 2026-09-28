import React from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTheme, space, radius } from '../theme';
import { Icon } from './Icon';
import { Progress, Text } from './primitives';

const GAP = 10;
const THUMB_H = 96;
/** Tiles shown in a home row before "See all". */
const ROW_MAX = 10;

/** Width of one tile: half the screen, so a home row shows two and hints at more. */
export function useTileWidth() {
  const { width } = useWindowDimensions();
  return (width - space.l * 2 - GAP) / 2;
}

export const TILE_THUMB_H = THUMB_H;

/** Uniform tile: thumbnail (or a large faded icon), icon badge, 2-line title, one meta line. */
export function Tile({ icon, title, meta, progress, done, thumb, onPress, onLongPress, tint }: { icon: string; title: string; meta?: string; progress?: number; done?: boolean; thumb?: (w: number, h: number) => React.ReactNode; onPress: () => void; onLongPress?: () => void; tint?: string }) {
  const { c } = useTheme();
  const w = useTileWidth();
  const col = done ? c.ok : tint ?? c.accent;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [styles.tile, { width: w, backgroundColor: c.surface1, borderColor: c.hairline }, pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] }]}>
      <View style={[styles.thumb, { borderBottomColor: c.hairline, backgroundColor: c.canvas }]}>
        {thumb?.(w, THUMB_H) ?? <Icon name={icon} size={38} color={c.text3} strokeWidth={1.4} />}
        <View style={[styles.badge, { backgroundColor: c.surface2 }]}>
          <Icon name={icon} size={14} color={col} />
        </View>
        {done && (
          <View style={[styles.done, { backgroundColor: c.surface2 }]}>
            <Icon name="circle-check" size={14} color={c.ok} />
          </View>
        )}
      </View>
      <View style={styles.body}>
        <Text v="headline" style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.meta}>
          {progress !== undefined && <Progress value={progress} color={col} style={styles.bar} />}
          {!!meta && (
            <Text v="callout" color={c.text2} style={styles.metaText} numberOfLines={1}>
              {meta}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

/** Wrapping 2-column grid for "See all" pages. */
export function TileGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/** Home section: caption header with count and "See all", then one horizontally scrolling row of the first 10 tiles. */
export function Section({ title, count, onSeeAll, children }: { title: string; count?: number; onSeeAll?: () => void; children: React.ReactNode[] }) {
  const { c } = useTheme();
  const w = useTileWidth();
  const shown = children.filter(Boolean).slice(0, ROW_MAX);
  return (
    <View style={{ marginTop: space.xl }}>
      <View style={styles.head}>
        <Text v="caption">{title}</Text>
        {count !== undefined && (
          <Text v="caption" color={c.text3} style={styles.count}>
            {count}
          </Text>
        )}
        <View style={styles.grow} />
        {onSeeAll && (
          <Pressable hitSlop={10} onPress={onSeeAll} style={styles.all} accessibilityRole="button" accessibilityLabel={`See all ${title}`}>
            <Text v="callout" color={c.accent}>
              See all
            </Text>
            <Icon name="chevron-right" size={14} color={c.accent} />
          </Pressable>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row} contentContainerStyle={styles.rowContent} snapToInterval={w + GAP} decelerationRate="fast">
        {shown}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  thumb: { height: THUMB_H, alignItems: 'center', justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  badge: { position: 'absolute', left: 8, top: 8, width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  done: { position: 'absolute', right: 8, top: 8, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 12, gap: 8, height: 78, justifyContent: 'space-between' },
  title: { fontSize: 15, lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 16 },
  bar: { flex: 1 },
  metaText: { fontSize: 12, flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  count: { marginLeft: 6 },
  grow: { flex: 1 },
  all: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  row: { marginHorizontal: -space.l },
  rowContent: { paddingHorizontal: space.l, gap: GAP },
});
