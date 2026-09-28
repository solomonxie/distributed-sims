import React, { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme, space, radius, type as typo } from '../theme';
import type { Colors } from '../theme/tokens';
import { Screen } from '../ui/Screen';
import { Button, Card, Chip, Empty, SectionHeader, Text } from '../ui/primitives';
import { haptic } from '../lib/haptics';
import { STATUSES, addFeedback, deleteFeedback, loadFeedback, setFeedbackStatus, type FeedbackItem, type FeedbackStatus } from '../lib/feedback';

const LABEL: Record<FeedbackStatus, string> = { open: 'Open', in_progress: 'In progress', done: 'Done', wontfix: "Won't fix" };
const toneOf = (c: Colors, s: string) => (s === 'open' ? c.accent : s === 'in_progress' ? c.warn : s === 'done' ? c.ok : c.text3);
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

export function FeedbackScreen() {
  const { c } = useTheme();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [draft, setDraft] = useState('');

  const run = useCallback((p: Promise<FeedbackItem[]>) => p.then(setItems).catch(e => Alert.alert('Feedback', String(e?.message ?? e))), []);

  useFocusEffect(
    useCallback(() => {
      run(loadFeedback());
    }, [run]),
  );

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    run(addFeedback(text));
  };

  const pickStatus = (it: FeedbackItem) =>
    Alert.alert('Status', undefined, [
      ...STATUSES.map(s => ({ text: LABEL[s], onPress: () => run(setFeedbackStatus(it.id, s)) })),
      { text: 'Delete', style: 'destructive' as const, onPress: () => confirmDelete(it) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  const confirmDelete = (it: FeedbackItem) => {
    haptic('medium');
    Alert.alert('Delete feedback?', it.text.slice(0, 120), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(deleteFeedback(it.id)) },
    ]);
  };

  return (
    <Screen contentStyle={{ paddingTop: 8 }}>
      <Card padded style={{ gap: space.m }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="What should change?"
          placeholderTextColor={c.text3}
          multiline
          style={[typo.body, styles.input, { color: c.text, backgroundColor: c.canvas, borderColor: c.hairlineStrong }]}
        />
        <Button title="Add" kind="primary" icon="plus" small disabled={!draft.trim()} onPress={add} />
      </Card>
      <SectionHeader title="FEEDBACK" right={items.length ? String(items.length) : undefined} />
      {items.length === 0 ? (
        <Empty icon="message-square" title="No feedback yet" body="Entries are saved on this device." />
      ) : (
        <View style={{ gap: space.s }}>
          {items.map(it => (
            <Pressable key={it.id} onLongPress={() => confirmDelete(it)} delayLongPress={400}>
              <Card padded style={{ gap: space.s }}>
                <Text v="body">{it.text}</Text>
                {it.note ? (
                  <Text v="callout" color={c.text2}>
                    {it.note}
                  </Text>
                ) : null}
                <View style={styles.meta}>
                  <Text v="callout" color={c.text3} style={{ flex: 1 }}>
                    {fmtDate(it.createdAt)}
                  </Text>
                  <Chip text={LABEL[it.status] ?? it.status} tone={toneOf(c, it.status)} onPress={() => pickStatus(it)} />
                </View>
              </Card>
            </Pressable>
          ))}
          <Text v="callout" color={c.text3} style={{ textAlign: 'center', marginTop: space.s }}>
            Tap a status to change it · long-press to delete
          </Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 88, maxHeight: 200, borderRadius: radius.chip, borderWidth: StyleSheet.hairlineWidth, padding: space.m, textAlignVertical: 'top' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.s },
});
