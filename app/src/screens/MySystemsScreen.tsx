import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { pick, types as docTypes } from '@react-native-documents/picker';
import { templates } from '@dsims/content';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space, type as typo } from '../theme';
import { Screen } from '../ui/Screen';
import { Button, Card, Empty, IconButton, Text } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { MiniGraph } from '../ui/MiniGraph';
import { useLibrary, blankDoc, forkDoc, saveSystem, deleteSystem, importFile, pathFor } from '../state/library';
import { ago } from './ProblemScreen';
import { toast, ToastHost } from '../ui/Toast';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const STARTERS = [
  { slug: 'paradigm-layered', label: 'Layered monolith' },
  { slug: 'edge-lb-algorithms', label: 'API behind a load balancer' },
  { slug: 'compute-serverless', label: 'Serverless' },
  { slug: 'mq-fanout', label: 'Event-driven fan-out' },
  { slug: 'paradigm-ddd', label: 'DDD bounded contexts' },
  { slug: 'paradigm-cell-based', label: 'Cell-based' },
];

export function MySystemsScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { items, loaded, refresh } = useLibrary();
  const [q, setQ] = useState('');
  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = async (slug?: string) => {
    const doc = slug && templates[slug] ? forkDoc(templates[slug], STARTERS.find(s => s.slug === slug)?.label ?? templates[slug].name) : blankDoc();
    await saveSystem(doc);
    nav.navigate('Editor', { doc });
  };
  const plusMenu = () =>
    ActionSheetIOS.showActionSheetWithOptions({ options: ['New blank system', 'From template…', 'Import from Files…', 'Cancel'], cancelButtonIndex: 3 }, i => {
      if (i === 0) create();
      if (i === 1) templateMenu();
      if (i === 2) doImport();
    });
  const templateMenu = () => {
    const avail = STARTERS.filter(s => templates[s.slug]);
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Start from a template', options: [...avail.map(s => s.label), 'Cancel'], cancelButtonIndex: avail.length }, i => {
      if (i < avail.length) create(avail[i].slug);
    });
  };
  const doImport = async () => {
    try {
      const [f] = await pick({ type: [docTypes.json, docTypes.allFiles] });
      if (!f) return;
      const r = await importFile(decodeURI(f.uri.replace('file://', '')), f.name ?? 'file');
      if (r.ok) toast({ text: `Imported “${r.doc.name}”`, tone: 'ok', icon: 'download' });
      else toast({ text: r.error, tone: 'alert', icon: 'triangle-alert', ms: 5000 });
    } catch {
      // cancelled
    }
  };
  const itemMenu = (id: string, name: string) =>
    ActionSheetIOS.showActionSheetWithOptions({ title: name, options: ['Duplicate', 'Share', 'Delete', 'Cancel'], destructiveButtonIndex: 2, cancelButtonIndex: 3 }, async i => {
      const it = useLibrary.getState().items.find(x => x.id === id);
      if (!it) return;
      if (i === 0) await saveSystem(forkDoc(it.doc, `${it.name} copy`));
      if (i === 1) Share.share({ url: `file://${pathFor(id)}`, title: name });
      if (i === 2)
        Alert.alert(`Delete “${name}”?`, 'It moves to the app cache and is gone after the system clears it.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => deleteSystem(id) },
        ]);
    });

  const list = items.filter(i => !q || i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <View style={{ flex: 1 }}>
      <Screen
        title="Mine"
        right={
          <View style={{ flexDirection: 'row' }}>
            <IconButton name="settings" onPress={() => nav.navigate('Settings')} label="Settings" />
            <IconButton name="plus" size={26} color={c.accent} onPress={plusMenu} label="New system" />
          </View>
        }
      >
        {items.length > 0 && (
          <View style={[styles.search, { backgroundColor: c.surface1, borderColor: c.hairline }]}>
            <Icon name="search" size={16} color={c.text3} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={c.text3} style={[typo.body, { flex: 1, color: c.text, paddingVertical: 10 }]} clearButtonMode="while-editing" />
          </View>
        )}
        {loaded && !items.length ? (
          <Empty icon="layers" title="Nothing built yet" body="Start blank, or fork any problem's design.">
            <Button kind="primary" title="New system" icon="plus" onPress={() => create()} />
            <Button title="Browse problems" onPress={() => nav.navigate('Tabs', { screen: 'Problems' } as any)} />
            <Button kind="text" title="From a template…" onPress={templateMenu} />
          </Empty>
        ) : (
          <View style={{ gap: 10, marginTop: space.m }}>
            {list.map(it => (
              <Card key={it.id} onPress={() => nav.navigate('Editor', { doc: it.doc })}>
                <Pressable onLongPress={() => itemMenu(it.id, it.name)} delayLongPress={350} onPress={() => nav.navigate('Editor', { doc: it.doc })} style={styles.item}>
                  <View style={[styles.thumb, { borderColor: c.hairline }]}>
                    <MiniGraph doc={it.doc} width={84} height={64} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text v="headline" numberOfLines={1}>
                      {it.name}
                    </Text>
                    <Text v="callout" color={c.text2}>
                      {it.nodes} components · edited {ago(it.updatedAt)}
                    </Text>
                  </View>
                  <IconButton name="ellipsis" size={20} color={c.text3} onPress={() => itemMenu(it.id, it.name)} label="More" />
                </Pressable>
              </Card>
            ))}
          </View>
        )}
      </Screen>
      <ToastHost top={insets.top + 6} />
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  thumb: { width: 84, height: 64, borderRadius: 10, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
});
