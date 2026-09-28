import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { topics, templates } from '@dsims/content';
import type { RootStackParamList } from '../navigation/types';
import { useTheme, space } from '../theme';
import { Icon } from '../ui/Icon';
import { Button, Card, Mono, Text } from '../ui/primitives';
import { useProgress } from '../state/progress';
import { haptic } from '../lib/haptics';

/** Lesson steps for an algo-illustrated lesson; a step with `input` switches the player's preset. */
export function AlgoLesson({ topicId, lessonId, onInput }: { topicId: string; lessonId: string; onInput: (id: string) => void }) {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const topic = topics.find(t => t.id === topicId);
  const idx = topic?.lessons.findIndex(l => l.id === lessonId) ?? -1;
  const lesson = topic?.lessons[idx];
  const steps = lesson?.steps ?? [];
  const [i, setI] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (topic && lesson) useProgress.getState().setLast(topic.id, lesson.id);
  }, [topic, lesson]);

  useEffect(() => {
    for (let k = i; k >= 0; k--) {
      const inp = steps[k]?.input;
      if (inp) return onInput(inp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  if (!topic || !lesson || !steps.length) return null;
  const step = steps[i];
  const last = i === steps.length - 1;
  const next = topic.lessons[idx + 1];

  const finish = () => {
    useProgress.getState().completeLesson(`${topic.id}/${lesson.id}`);
    setFinished(true);
    haptic('success');
  };
  const openNext = () => {
    if (!next) return nav.goBack();
    const tpl = next.template;
    if (next.algo) nav.replace('AlgorithmPlayer', { slug: next.algo, lesson: { topicId: topic.id, lessonId: next.id } });
    else if (tpl && templates[tpl]) nav.replace('Editor', { doc: templates[tpl], readOnly: true, autoRun: true, guide: { kind: 'lesson', topicId: topic.id, lessonId: next.id } });
  };

  if (finished)
    return (
      <Card padded style={[styles.card, { borderColor: c.ok }]}>
        <View style={styles.row}>
          <Icon name="circle-check" size={20} color={c.ok} />
          <Text v="headline" style={{ flex: 1 }}>
            {lesson.title} — done
          </Text>
        </View>
        <View style={[styles.row, { justifyContent: 'flex-end', marginTop: space.m }]}>
          <Button small kind="text" title="Review" onPress={() => setFinished(false)} />
          <Button small kind="primary" title={next ? 'Next lesson' : 'Back to topic'} icon={next ? 'arrow-right' : undefined} onPress={openNext} />
        </View>
      </Card>
    );

  return (
    <Card padded style={styles.card}>
      <View style={styles.row}>
        <Icon name="lightbulb" size={15} color={c.accent} />
        <Mono color={c.accent} style={{ fontSize: 12 }}>
          {i + 1}/{steps.length}
        </Mono>
        <Text v="callout" color={c.text2} numberOfLines={1} style={{ flex: 1 }}>
          {lesson.title}
        </Text>
      </View>
      <Text v="headline" style={{ marginTop: 6 }}>
        {step.title}
      </Text>
      <Text v="callout" style={{ marginTop: 4, lineHeight: 20 }}>
        {step.body}
      </Text>
      {step.watch ? (
        <View style={[styles.row, { marginTop: 6, alignItems: 'flex-start' }]}>
          <Icon name="eye" size={14} color={c.text3} />
          <Text v="callout" color={c.text2} style={{ flex: 1, fontSize: 13.5 }}>
            {step.watch}
          </Text>
        </View>
      ) : null}
      <View style={[styles.row, { justifyContent: 'flex-end', marginTop: space.s }]}>
        {i > 0 && <Button small kind="text" title="‹ Back" onPress={() => setI(i - 1)} />}
        <Button small kind={last ? 'primary' : 'secondary'} title={last ? 'Finish' : 'Next ›'} onPress={last ? finish : () => setI(i + 1)} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
