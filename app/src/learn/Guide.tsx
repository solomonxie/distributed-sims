import { useShallow } from 'zustand/react/shallow';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { problems, topics, templates, type LessonDef } from '@dsims/content';
import type { GuideSpec, RootStackParamList } from '../navigation/types';
import { useTheme, space } from '../theme';
import { Icon } from '../ui/Icon';
import { Button, Mono, Text } from '../ui/primitives';
import { controller, useRun } from '../state/run';
import { useProgress } from '../state/progress';
import { checkPasses, liveMetric, scoreRun, type Check, type Score } from '../lib/checks';
import { haptic } from '../lib/haptics';
import { Sheet } from '../sheets/Sheet';
import { fmtMs } from '../canvas/SystemCanvas';

export function GuideLayer({ guide, top }: { guide: GuideSpec; top: number }) {
  if (guide.kind === 'challenge') return <ChallengeLayer guide={guide} top={top} />;
  return <LessonLayer guide={guide} top={top} />;
}

type Step = LessonDef['steps'][number] & { action?: { event: any; label?: string } };

function LessonLayer({ guide, top }: { guide: GuideSpec; top: number }) {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const topic = topics.find(t => t.id === guide.topicId);
  const lessonIdx = topic?.lessons.findIndex(l => l.id === guide.lessonId) ?? -1;
  const lesson = topic?.lessons[lessonIdx];
  const steps = (lesson?.steps ?? []) as Step[];
  const [i, setI] = useState(0);
  const [passed, setPassed] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [gone, setGone] = useState(false);
  const [done, setDone] = useState(false);
  const t = useRun(s => s.t);
  const active = useRun(s => s.active);
  const step = steps[i];

  useEffect(() => {
    if (topic && lesson) useProgress.getState().setLast(topic.id, lesson.id);
  }, [topic, lesson]);

  useEffect(() => {
    if (!step || passed || !controller.run) return;
    const ch = step.check as Check | undefined;
    if (!ch || ch.metric === 'manual') return;
    if (checkPasses(controller.run, ch)) {
      setPassed(true);
      haptic('success');
    }
  }, [t, step, passed]);

  if (!topic || !lesson || !steps.length) return null;
  const manual = !step.check || (step.check as Check).metric === 'manual';
  const canNext = passed || manual;
  const next = () => {
    if (i + 1 < steps.length) {
      setI(i + 1);
      setPassed(false);
      setHidden(true);
      haptic('light');
    } else {
      useProgress.getState().completeLesson(`${topic.id}/${lesson.id}`);
      setDone(true);
      haptic('success');
    }
  };
  const nextLesson = topic.lessons[lessonIdx + 1];

  if (gone)
    return (
      <Pressable accessibilityLabel="Show lesson tips" onPress={() => setGone(false)} style={[styles.bulb, { top, backgroundColor: c.surface2, borderColor: passed ? c.ok : c.hairlineStrong }]}>
        <Icon name="lightbulb" size={16} color={passed ? c.ok : c.accent} />
      </Pressable>
    );

  if (hidden)
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Lesson tips, step ${i + 1} of ${steps.length}: ${step.title}`} onPress={() => setHidden(false)} style={[styles.tipBar, { top, backgroundColor: c.surface2, borderColor: passed ? c.ok : c.hairlineStrong }]}>
        <Icon name="lightbulb" size={15} color={passed ? c.ok : c.accent} />
        <Mono color={c.text2} style={{ fontSize: 12 }}>
          {i + 1}/{steps.length}
        </Mono>
        <Text v="callout" numberOfLines={1} style={{ flex: 1, fontSize: 13.5 }}>
          {step.title}
        </Text>
        {passed ? (
          <Pressable hitSlop={10} onPress={next}>
            <Text v="headline" color={c.ok} style={{ fontSize: 13.5 }}>
              {i + 1 === steps.length ? 'Finish' : 'Next ›'}
            </Text>
          </Pressable>
        ) : (
          <Text v="callout" color={c.accent} style={{ fontSize: 13 }}>
            Tips
          </Text>
        )}
        <Pressable hitSlop={12} accessibilityLabel="Hide lesson tips" onPress={() => setGone(true)} style={{ marginLeft: 4 }}>
          <Icon name="x" size={16} color={c.text3} />
        </Pressable>
      </Pressable>
    );

  if (done)
    return (
      <Animated.View entering={ZoomIn.springify()} style={[styles.card, { top, backgroundColor: c.surface2, borderColor: c.ok }]}>
        <View style={styles.row}>
          <Icon name="circle-check" size={22} color={c.ok} />
          <Text v="headline" style={{ flex: 1 }}>
            {lesson.title} — done
          </Text>
        </View>
        <View style={[styles.row, { marginTop: space.m, justifyContent: 'flex-end' }]}>
          <Button small kind="text" title="Stay here" onPress={() => setHidden(true)} />
          {nextLesson ? (
            <Button
              small
              kind="primary"
              title="Next lesson"
              icon="arrow-right"
              onPress={() => {
                const tpl = (nextLesson as any).template as string | undefined;
                if ((nextLesson as any).algo) nav.replace('AlgorithmPlayer', { slug: (nextLesson as any).algo });
                else if (tpl && templates[tpl]) nav.replace('Editor', { doc: templates[tpl], readOnly: true, autoRun: true, guide: { kind: 'lesson', topicId: topic.id, lessonId: nextLesson.id } });
              }}
            />
          ) : (
            <Button small kind="primary" title="Back to topic" onPress={() => nav.goBack()} />
          )}
        </View>
      </Animated.View>
    );

  return (
    <Animated.View key={i} entering={FadeInDown.springify().damping(18)} exiting={FadeOut} layout={LinearTransition} style={[styles.card, { top, backgroundColor: c.surface2, borderColor: passed ? c.ok : c.hairlineStrong }]}>
      <View style={styles.row}>
        <Mono color={c.accent}>
          {i + 1} / {steps.length}
        </Mono>
        <Text v="headline" style={{ flex: 1 }} numberOfLines={2}>
          {step.title}
        </Text>
        {passed && <Icon name="circle-check" size={20} color={c.ok} />}
      </View>
      <Text v="body" style={{ marginTop: 6, fontSize: 14.5, lineHeight: 20 }}>
        {step.body}
      </Text>
      {step.watch ? (
        <Text v="callout" color={c.text2} style={{ marginTop: 6 }}>
          Watch: {step.watch}
        </Text>
      ) : null}
      <View style={[styles.row, { marginTop: space.m }]}>
        <Button small kind="text" title="Hide" onPress={() => setHidden(true)} />
        <Button small kind="text" title="Close" onPress={() => setGone(true)} />
        <View style={{ flex: 1 }} />
        {step.action && active && !passed && (
          <Button
            small
            title={step.action.label ?? 'Do it for me'}
            icon="wand-sparkles"
            onPress={() => {
              controller.fire(step.action!.event);
            }}
          />
        )}
        <Button small kind={canNext ? 'primary' : 'secondary'} title={i + 1 === steps.length ? 'Finish' : 'Next'} disabled={!canNext} onPress={next} />
      </View>
    </Animated.View>
  );
}

function ChallengeLayer({ guide, top }: { guide: GuideSpec; top: number }) {
  const { c } = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const problem = problems.find(p => p.id === guide.problemId);
  const ch = problem?.challenges.find(x => x.id === guide.challengeId) as any;
  const { t, ended, active } = useRun(useShallow(s => ({ t: s.t, ended: s.ended, active: s.active })));
  const [result, setResult] = useState<Score[] | null>(null);
  const first = (ch?.pass ?? [])[0];
  const live = useMemo(() => (controller.run && first ? liveMetric(controller.run, first.metric) : 0), [t, first]);
  useEffect(() => {
    if (ended && controller.run && ch && !result) {
      const r = scoreRun(controller.run, ch.pass);
      setResult(r);
      const ok = r.every(x => x.pass);
      const p99 = r.find(x => x.metric === 'p99')?.actual;
      useProgress.getState().recordChallenge(`${problem!.id}/${ch.id}`, ok, p99);
      haptic(ok ? 'success' : 'error');
    }
    if (!ended) setResult(null);
  }, [ended, ch, result, problem]);
  if (!problem || !ch) return null;
  const fmt = (m: string, v: number) => (m === 'p99' ? fmtMs(v) : m === 'availability' || m === 'errRate' ? `${v.toFixed(2)}%` : m === 'costMonth' ? `$${Math.round(v).toLocaleString()}` : String(Math.round(v)));
  const nextCh = problem.challenges[problem.challenges.findIndex(x => x.id === ch.id) + 1];
  return (
    <>
      {active && first && !result && (
        <View style={[styles.pill, { top, backgroundColor: c.surface2, borderColor: c.hairlineStrong }]}>
          <Icon name="target" size={15} color={c.accent} />
          <Mono>
            {first.metric} {fmt(first.metric, live)} / {first.op} {fmt(first.metric, first.value)}
          </Mono>
        </View>
      )}
      {result && (
        <Sheet snapPoints={['52%']} onClose={() => setResult(null)}>
          <View style={styles.row}>
            <Icon name={result.every(r => r.pass) ? 'star' : 'target'} size={24} color={result.every(r => r.pass) ? c.warn : c.text2} />
            <Text v="title" style={{ flex: 1 }}>
              {ch.title} — {result.every(r => r.pass) ? 'passed' : 'not yet'}
            </Text>
          </View>
          <View style={{ marginTop: space.m, gap: 8 }}>
            {result.map(r => (
              <View key={r.metric} style={styles.row}>
                <Icon name={r.pass ? 'check' : 'x'} size={18} color={r.pass ? c.ok : c.fail} />
                <Text style={{ flex: 1 }}>{label(r.metric)}</Text>
                <Mono color={r.pass ? c.text : c.fail}>{fmt(r.metric, r.actual)}</Mono>
                <Mono color={c.text3} style={{ width: 90, textAlign: 'right' }}>
                  {r.op} {fmt(r.metric, r.value)}
                </Mono>
              </View>
            ))}
          </View>
          {!result.every(r => r.pass) && <WorstHop />}
          <View style={[styles.row, { marginTop: space.xl }]}>
            {result.every(r => r.pass) && nextCh ? (
              <>
                <Button kind="secondary" title="Back to brief" onPress={() => nav.goBack()} style={{ flex: 1 }} />
                <Button kind="primary" title="Next challenge" onPress={() => nav.goBack()} style={{ flex: 1 }} />
              </>
            ) : (
              <>
                <Button kind="secondary" title="See reference v2" onPress={() => {
                  const v2 = problem.designs.find(d => d.id === 'v2');
                  if (v2 && templates[v2.template]) nav.replace('Editor', { doc: templates[v2.template], readOnly: true });
                }} style={{ flex: 1 }} />
                <Button kind="primary" title="Try again" icon="rotate-ccw" onPress={() => { setResult(null); controller.replay(); }} style={{ flex: 1 }} />
              </>
            )}
          </View>
        </Sheet>
      )}
    </>
  );
}

function WorstHop() {
  const { c } = useTheme();
  const snap = controller.run?.snapshot();
  if (!snap) return null;
  const worst = Object.values(snap.nodes)
    .filter(n => !/client|device|bot$/.test(controller.run!.world.nodes.get(n.id)?.type ?? ''))
    .sort((a, b) => b.util + b.errRate * 2 - (a.util + a.errRate * 2))[0];
  if (!worst) return null;
  const name = controller.run!.world.nodes.get(worst.id)?.name ?? worst.id;
  return (
    <Text v="callout" color={c.text2} style={{ marginTop: space.m }}>
      Worst hop: {name} — {Math.round(worst.util * 100)}% busy, p99 {fmtMs(worst.p99)}
      {worst.errRate > 0.01 ? `, ${(worst.errRate * 100).toFixed(1)}% errors` : ''}.
    </Text>
  );
}

const label = (m: string) => ({ p99: 'p99 at entry', availability: 'Availability', anomalies: 'Anomalies', costMonth: 'Cost', errRate: 'Error rate' })[m] ?? m;

const styles = StyleSheet.create({
  card: { position: 'absolute', left: 12, right: 12, padding: 14, borderRadius: 18, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, zIndex: 30 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulb: { position: 'absolute', right: 12, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, zIndex: 30 },
  tipBar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 36, borderRadius: 18, borderWidth: 1, zIndex: 30 },
  pill: { position: 'absolute', right: 12, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, zIndex: 30 },
});
