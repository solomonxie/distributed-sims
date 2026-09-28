import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-worklets';
import { catalog } from '@dsims/content';
import { useTheme, space, type as typo } from '../theme';
import { Icon } from '../ui/Icon';
import { Text, SectionHeader } from '../ui/primitives';
import { haptic } from '../lib/haptics';

export interface PaletteItem {
  type: string;
  skin?: string;
  label: string;
  icon: string;
  group: string;
  container?: string;
}

interface Props {
  onPlace: (item: PaletteItem) => void;
  onDragStart: (item: PaletteItem, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onGroup: (kind: string) => void;
}

const SHORT: Record<string, string> = {
  edge: 'Edge',
  compute: 'Compute',
  data: 'Data',
  messaging: 'Msg',
  coordination: 'Coord',
  security: 'Sec',
  observability: 'Obs',
  geo: 'Geo',
};

export function PaletteContent({ onPlace, onDragStart, onDragMove, onDragEnd, onGroup }: Props) {
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [skinFor, setSkinFor] = useState<string | null>(null);

  const groups = useMemo(() => [...catalog.groups].sort((a, b) => a.order - b.order), []);
  const byGroup = useMemo(() => {
    const m = new Map<string, PaletteItem[]>();
    for (const t of catalog.types) {
      const skins = catalog.skins.filter(s => s.type === t.type);
      const first = skins[0];
      const item: PaletteItem = { type: t.type, skin: first?.name, label: t.label, icon: first && !first.icon.startsWith('brand:') ? t.icon : first?.icon ?? t.icon, group: t.group };
      item.icon = t.icon;
      if (!m.has(t.group)) m.set(t.group, []);
      m.get(t.group)!.push(item);
    }
    return m;
  }, []);

  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!query) return null;
    const out: PaletteItem[] = [];
    for (const s of catalog.skins) {
      const t = catalog.types.find(x => x.type === s.type);
      if ([s.label, s.name, s.type, t?.label ?? '', ...(s.tags ?? [])].some(x => x.toLowerCase().includes(query))) out.push({ type: s.type, skin: s.name, label: s.label, icon: s.icon, group: t?.group ?? '' });
    }
    for (const t of catalog.types) {
      if ([t.label, t.type, t.description].some(x => x.toLowerCase().includes(query)) && !out.some(o => o.type === t.type)) out.push({ type: t.type, label: t.label, icon: t.icon, group: t.group });
    }
    return out.slice(0, 40);
  }, [query]);

  const filters = ['all', ...groups.filter(g => g.id !== 'clients').map(g => g.id)];

  return (
    <View>
      <View style={[styles.search, { backgroundColor: c.surface2, borderColor: c.hairline }]}>
        <Icon name="search" size={16} color={c.text3} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={`Search ${catalog.skins.length} components`}
          placeholderTextColor={c.text3}
          style={[typo.body, { flex: 1, color: c.text, paddingVertical: 9 }]}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>
      {!results && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.m, marginHorizontal: -space.l }} contentContainerStyle={{ gap: 8, paddingHorizontal: space.l }}>
          {filters.map(f => {
            const on = f === filter;
            return (
              <Pressable key={f} onPress={() => setFilter(f)} style={[styles.pill, { borderColor: on ? c.accent : c.hairlineStrong, backgroundColor: on ? c.surface2 : 'transparent' }]}>
                <Text v="callout" style={{ fontSize: 13.5, fontWeight: on ? '700' : '500', color: on ? c.text : c.text2 }}>
                  {f === 'all' ? 'All' : groups.find(g => g.id === f)?.label ?? f}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {results ? (
        <>
          <SectionHeader title={`${results.length} RESULTS`} />
          {results.length ? <Grid items={results} {...{ onPlace, onDragStart, onDragMove, onDragEnd }} onLong={() => {}} /> : <Text color={c.text2}>No components match “{q}”.</Text>}
        </>
      ) : (
        groups
          .filter(g => filter === 'all' || g.id === filter || (filter === 'all' && g.id === 'clients'))
          .map(g => (
            <View key={g.id}>
              <SectionHeader title={g.label.toUpperCase()} />
              <Grid items={byGroup.get(g.id) ?? []} {...{ onPlace, onDragStart, onDragMove, onDragEnd }} onLong={t => setSkinFor(skinFor === t ? null : t)} skinFor={skinFor} onPickSkin={it => { setSkinFor(null); onPlace(it); }} />
            </View>
          ))
      )}
      {!results && filter === 'all' && (
        <>
          <SectionHeader title="CONTAINERS" />
          <View style={styles.containerRow}>
            {catalog.containers.map(ct => (
              <Pressable key={ct.kind} onPress={() => onGroup(ct.kind)} style={({ pressed }) => [styles.containerChip, { borderColor: c.hairlineStrong, backgroundColor: c.surface1 }, pressed && { opacity: 0.6 }]}>
                <Icon name={ct.icon} size={14} color={c.text2} />
                <Text v="callout">{ct.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text v="callout" color={c.text3} style={{ marginTop: space.s }}>
            Tap a container to select components to group.
          </Text>
        </>
      )}
    </View>
  );
}

function Grid({
  items,
  onPlace,
  onDragStart,
  onDragMove,
  onDragEnd,
  onLong,
  skinFor,
  onPickSkin,
}: Pick<Props, 'onPlace' | 'onDragStart' | 'onDragMove' | 'onDragEnd'> & { items: PaletteItem[]; onLong: (type: string) => void; skinFor?: string | null; onPickSkin?: (it: PaletteItem) => void }) {
  const { c } = useTheme();
  const rows: PaletteItem[][] = [];
  for (let i = 0; i < items.length; i += 4) rows.push(items.slice(i, i + 4));
  return (
    <View style={{ gap: 8 }}>
      {rows.map((row, ri) => (
        <View key={ri}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {row.map(it => (
              <Tile key={it.type + (it.skin ?? '')} it={it} {...{ onPlace, onDragStart, onDragMove, onDragEnd }} active={skinFor === it.type} onInfo={() => onLong(it.type)} />
            ))}
            {Array.from({ length: 4 - row.length }).map((_, k) => (
              <View key={'pad' + k} style={{ flex: 1 }} />
            ))}
          </View>
          {skinFor && row.some(r => r.type === skinFor) && onPickSkin && (
            <View style={[styles.skins, { backgroundColor: c.surface2, borderColor: c.hairlineStrong }]}>
              {catalog.skins
                .filter(s => s.type === skinFor)
                .map((s, i, arr) => (
                  <Pressable key={s.name} onPress={() => onPickSkin({ type: s.type, skin: s.name, label: s.label, icon: s.icon, group: '' })} style={({ pressed }) => [styles.skinRow, i < arr.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }, pressed && { opacity: 0.6 }]}>
                    <Icon name={s.icon} size={18} color={c.text} />
                    <View style={{ flex: 1 }}>
                      <Text v="body">{s.label}</Text>
                      <Text v="callout" color={c.text2} numberOfLines={1}>
                        {s.description}
                      </Text>
                    </View>
                    <Icon name="plus" size={18} color={c.accent} />
                  </Pressable>
                ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function Tile({ it, onPlace, onDragStart, onDragMove, onDragEnd, active, onInfo }: Pick<Props, 'onPlace' | 'onDragStart' | 'onDragMove' | 'onDragEnd'> & { it: PaletteItem; active: boolean; onInfo: () => void }) {
  const { c } = useTheme();
  const drag = Gesture.Pan()
    .activateAfterLongPress(220)
    .onStart(e => {
      runOnJS(haptic)('light');
      runOnJS(onDragStart)(it, e.absoluteX, e.absoluteY);
    })
    .onUpdate(e => {
      runOnJS(onDragMove)(e.absoluteX, e.absoluteY);
    })
    .onEnd(e => {
      runOnJS(onDragEnd)(e.absoluteX, e.absoluteY);
    });
  const tap = Gesture.Tap().onEnd(() => {
    runOnJS(onPlace)(it);
  });
  const skinCount = catalog.skins.filter(s => s.type === it.type).length;
  return (
    <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
      <View accessible accessibilityRole="button" accessibilityLabel={`Add ${it.label}`} style={[styles.tile, { backgroundColor: active ? c.surface2 : c.surface1, borderColor: active ? c.accent : c.hairline }]}>
        <Icon name={it.icon} size={24} color={c.text} strokeWidth={1.8} />
        <Text v="callout" numberOfLines={2} style={{ textAlign: 'center', fontSize: 11.5, lineHeight: 14 }}>
          {it.label}
        </Text>
        {skinCount > 1 && (
          <Pressable hitSlop={10} onPress={onInfo} style={styles.more}>
            <Text v="callout" color={active ? c.accent : c.text3} style={{ fontSize: 10, fontWeight: '700' }}>
              {skinCount}
            </Text>
          </Pressable>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 14, height: 34, borderRadius: 17, borderWidth: 1, justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  tile: { flex: 1, aspectRatio: 0.92, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 4, borderWidth: StyleSheet.hairlineWidth },
  more: { position: 'absolute', top: 5, right: 7 },
  skins: { marginTop: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  skinRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  containerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  containerChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
});
