import React from 'react';
import { ActionSheetIOS, Pressable, StyleSheet, View } from 'react-native';
import { algo } from '@dsims/engine';
import { topics } from '@dsims/content';
import { useTheme, space } from '../theme';
import { Icon } from '../ui/Icon';
import { Button, Card, Mono, Text } from '../ui/primitives';
import { haptic } from '../lib/haptics';

export interface Chapter {
  title: string;
  body?: string;
  watch?: string;
  input?: string;
  start: number;
  len: number;
}

export function lessonOf(topicId: string, lessonId: string) {
  const topic = topics.find(t => t.id === topicId);
  const idx = topic?.lessons.findIndex(l => l.id === lessonId) ?? -1;
  const lesson = topic?.lessons[idx];
  return topic && lesson ? { topic, lesson, next: topic.lessons[idx + 1] } : undefined;
}

type Step = { title: string; body?: string; watch?: string; input?: string };

/** One timeline for the whole demo: each preset (or lesson step) is a chapter; a text-only lesson step holds the last frame. */
export function planChapters(demo: algo.Demo, steps: Step[] | undefined, custom: unknown) {
  const cache = new Map<string, algo.Frame[]>();
  const run = (id: string) => {
    if (!cache.has(id)) cache.set(id, algo.frames(demo, demo.inputs.find(x => x.id === id)?.data));
    return cache.get(id)!;
  };
  const frames: algo.Frame[] = [];
  const chapters: Chapter[] = [];
  const push = (c: Omit<Chapter, 'start' | 'len'>, fs: algo.Frame[]) => {
    chapters.push({ ...c, start: frames.length, len: fs.length });
    frames.push(...fs);
  };
  if (custom) push({ title: 'My graph' }, algo.frames(demo, custom));
  else if (steps?.length) {
    let cur: string | undefined;
    for (const s of steps) {
      const inp = s.input ?? cur ?? demo.inputs[0]?.id;
      if (!inp) continue;
      const fs = run(inp);
      push({ title: s.title, body: s.body, watch: s.watch, input: inp }, inp === cur ? fs.slice(-1) : fs);
      cur = inp;
    }
  } else for (const inp of demo.inputs) push({ title: inp.label, input: inp.id }, run(inp.id));
  return { frames, chapters };
}

export function chapterAt(chapters: Chapter[], i: number) {
  let k = 0;
  while (k + 1 < chapters.length && chapters[k + 1].start <= i) k++;
  return k;
}

/** Chapter title (tap to jump) over a segmented progress bar, one segment per chapter. */
export function ChapterHeader({ chapters, i, onJump }: { chapters: Chapter[]; i: number; onJump: (i: number) => void }) {
  const { c } = useTheme();
  const k = chapterAt(chapters, i);
  const ch = chapters[k];
  if (!ch) return null;
  const many = chapters.length > 1;
  const pick = () => {
    haptic('select');
    ActionSheetIOS.showActionSheetWithOptions({ options: [...chapters.map((x, j) => `${j + 1}. ${x.title}`), 'Cancel'], cancelButtonIndex: chapters.length }, j => {
      if (j < chapters.length) onJump(chapters[j].start);
    });
  };
  return (
    <View style={{ marginBottom: space.m }}>
      <Pressable disabled={!many} onPress={pick} accessibilityRole="button" accessibilityLabel="Jump to a part" style={styles.row}>
        {many && (
          <Mono color={c.accent} style={{ fontSize: 13 }}>
            {k + 1}/{chapters.length}
          </Mono>
        )}
        <Text v="headline" numberOfLines={1} style={{ flex: 1 }}>
          {ch.title}
        </Text>
        {many && <Icon name="chevron-down" size={18} color={c.text3} />}
      </Pressable>
      {many && (
        <View style={styles.bar}>
          {chapters.map((x, j) => {
            const f = j < k ? 1 : j > k ? 0 : (i - x.start + 1) / x.len;
            return (
              <View key={j} style={[styles.seg, { backgroundColor: c.hairlineStrong }]}>
                <View style={{ width: `${f * 100}%`, height: '100%', backgroundColor: c.accent }} />
              </View>
            );
          })}
        </View>
      )}
      {ch.body ? (
        <Text v="callout" style={{ marginTop: space.s, lineHeight: 20 }}>
          {ch.body}
        </Text>
      ) : null}
      {ch.watch ? (
        <View style={[styles.row, { marginTop: 6, alignItems: 'flex-start' }]}>
          <Icon name="eye" size={14} color={c.text3} />
          <Text v="callout" color={c.text2} style={{ flex: 1, fontSize: 13.5 }}>
            {ch.watch}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function LessonDone({ title, hasNext, onReview, onNext }: { title: string; hasNext: boolean; onReview: () => void; onNext: () => void }) {
  const { c } = useTheme();
  return (
    <Card padded style={{ marginBottom: space.m, borderColor: c.ok }}>
      <View style={styles.row}>
        <Icon name="circle-check" size={20} color={c.ok} />
        <Text v="headline" style={{ flex: 1 }}>
          {title} — done
        </Text>
      </View>
      <View style={[styles.row, { justifyContent: 'flex-end', marginTop: space.m }]}>
        <Button small kind="text" title="Review" onPress={onReview} />
        <Button small kind="primary" title={hasNext ? 'Next lesson' : 'Back to topic'} icon={hasNext ? 'arrow-right' : undefined} onPress={onNext} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: { flexDirection: 'row', gap: 3, marginTop: 8 },
  seg: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
});
