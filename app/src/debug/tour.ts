import { captureScreen } from 'react-native-view-shot';
import * as FS from '@dr.pogodin/react-native-fs';
import type { NavigationContainerRef } from '@react-navigation/native';
import { templates, topics, problems } from '@dsims/content';
import type { RootStackParamList } from '../navigation/types';
import { blankDoc } from '../state/library';
import { useSettings } from '../state/settings';
import { bus } from './bus';

type Nav = NavigationContainerRef<RootStackParamList>;
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const TOUR_DIR = `${FS.DocumentDirectoryPath}/tour`;

interface Step {
  name: string;
  run: (nav: Nav) => void | Promise<void>;
  settle?: number;
}

const tpl = (slug: string, fallback?: string) => templates[slug] ?? (fallback ? templates[fallback] : undefined) ?? Object.values(templates)[0];

function steps(): Step[] {
  const firstTopic = [...topics].sort((a, b) => a.order - b.order)[0];
  const consensus = topics.find(t => t.id === 'consensus') ?? firstTopic;
  const raftLesson = consensus?.lessons.find(l => (l as any).template) ?? consensus?.lessons[0];
  const tiny = problems.find(p => p.id === 'tinyurl') ?? problems[0];
  const demoDoc = tpl('problem-tinyurl-v2', 'edge-lb-algorithms');
  const s: Step[] = [
    { name: 'home', run: nav => nav.navigate('Home') },
    ...(consensus ? [{ name: 'topic', run: (nav: Nav) => nav.navigate('Topic', { topicId: consensus.id }) }] : []),
    { name: 'problems', run: nav => (nav.goBack(), nav.navigate('Problems')) },
    ...(tiny ? [{ name: 'problem-brief', run: (nav: Nav) => nav.navigate('Problem', { problemId: tiny.id }) }] : []),
    { name: 'algorithms', run: nav => (nav.goBack(), nav.navigate('Algorithms', {})) },
    { name: 'player-dijkstra', run: nav => nav.navigate('AlgorithmPlayer', { slug: 'dijkstra' }), settle: 1200 },
    { name: 'player-dijkstra-step', run: () => bus.emit('player:steps', 4), settle: 1500 },
    { name: 'player-paging', run: nav => (nav.goBack(), nav.navigate('AlgorithmPlayer', { slug: 'mem-paging' })), settle: 1200 },
    { name: 'player-paging-step', run: () => bus.emit('player:steps', 3), settle: 1500 },
    { name: 'player-epoll', run: nav => (nav.goBack(), nav.navigate('AlgorithmPlayer', { slug: 'net-epoll' })), settle: 1200 },
    { name: 'player-epoll-step', run: () => bus.emit('player:steps', 4), settle: 1500 },
    { name: 'mine', run: nav => (nav.goBack(), nav.navigate('Mine')) },
    { name: 'settings', run: nav => nav.navigate('Settings') },
    { name: 'editor-empty', run: nav => (nav.goBack(), nav.navigate('Editor', { doc: blankDoc('Tour: blank'), readOnly: true })), settle: 1500 },
    { name: 'editor-palette', run: () => bus.emit('editor:sheet', 'palette'), settle: 1200 },
    { name: 'editor-build', run: nav => (nav.goBack(), nav.navigate('Editor', { doc: demoDoc, readOnly: true })), settle: 1800 },
    { name: 'editor-inspector', run: () => bus.emit('editor:select-first'), settle: 1200 },
    { name: 'editor-run', run: () => (bus.emit('editor:sheet', null), bus.emit('editor:run')), settle: 6000 },
    { name: 'editor-run-b', run: () => {}, settle: 1500 },
    { name: 'editor-run-c', run: () => {}, settle: 1500 },
    { name: 'editor-run-d', run: () => {}, settle: 1500 },
    { name: 'editor-dot', run: () => bus.emit('editor:pause-dot'), settle: 1200 },
    { name: 'editor-chaos', run: () => (bus.emit('editor:sheet', null), bus.emit('editor:play'), bus.emit('editor:sheet', 'chaos')), settle: 1200 },
    { name: 'editor-chaos-fired', run: () => (bus.emit('editor:sheet', null), bus.emit('editor:chaos-demo')), settle: 5000 },
    { name: 'editor-traffic', run: () => bus.emit('editor:sheet', 'traffic'), settle: 1200 },
    { name: 'editor-log', run: () => bus.emit('editor:sheet', 'log'), settle: 1200 },
    { name: 'editor-timeline', run: () => bus.emit('editor:sheet', 'timeline'), settle: 1200 },
    { name: 'metrics', run: nav => (bus.emit('editor:sheet', null), nav.navigate('Metrics')), settle: 1500 },
  ];
  if (consensus && raftLesson && (raftLesson as any).template && templates[(raftLesson as any).template]) {
    s.push({
      name: 'lesson',
      run: nav => (nav.goBack(), nav.goBack(), nav.navigate('Editor', { doc: templates[(raftLesson as any).template], readOnly: true, autoRun: true, guide: { kind: 'lesson', topicId: consensus.id, lessonId: raftLesson.id } })),
      settle: 5000,
    });
  }
  s.push({ name: 'done', run: nav => nav.goBack(), settle: 500 });
  return s;
}

export async function runTour(nav: Nav) {
  const savedSpeed = useSettings.getState().animSpeed;
  useSettings.getState().set({ animSpeed: 1 });
  if (await FS.exists(TOUR_DIR)) await FS.unlink(TOUR_DIR);
  await FS.mkdir(TOUR_DIR);
  const list = steps();
  const log: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const st = list[i];
    try {
      await st.run(nav);
      await wait(st.settle ?? 1000);
      if (st.name === 'done') break;
      const uri = await captureScreen({ format: 'png', quality: 1, result: 'tmpfile' });
      const dest = `${TOUR_DIR}/${String(i + 1).padStart(2, '0')}-${st.name}.png`;
      await FS.moveFile(uri.replace('file://', ''), dest);
      log.push(`ok ${st.name}`);
    } catch (e: any) {
      log.push(`fail ${st.name}: ${String(e?.message ?? e)}`);
    }
  }
  await FS.writeFile(`${TOUR_DIR}/log.txt`, log.join('\n'), 'utf8');
  useSettings.getState().set({ animSpeed: savedSpeed });
}

// Replays the tour up to `name` and stays there (simulator screenshots).
export async function runTourTo(nav: Nav, name: string) {
  useSettings.getState().set({ animSpeed: 1 });
  for (const st of steps()) {
    await st.run(nav);
    await wait(st.settle ?? 1000);
    if (st.name === name) return;
  }
}
