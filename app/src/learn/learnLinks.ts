import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { topics } from '@dsims/content';
import { algo } from '@dsims/engine';
import type { RootStackParamList } from '../navigation/types';
import { openLesson } from './open';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export interface LearnLink {
  title: string;
  subtitle: string;
  icon: string;
  open: (nav: Nav) => void;
}

const lesson = (topicId: string, lessonId: string, subtitle: string): LearnLink | undefined => {
  const t = topics.find(x => x.id === topicId);
  const l = t?.lessons.find(x => x.id === lessonId);
  return t && l ? { title: l.title, subtitle, icon: (l as any).algo ? 'play' : 'workflow', open: nav => openLesson(nav, t, l) } : undefined;
};
const demo = (slug: string, subtitle: string): LearnLink | undefined => {
  const d = algo.getDemo(slug);
  return d ? { title: d.title, subtitle, icon: 'play', open: nav => nav.navigate('AlgorithmPlayer', { slug }) } : undefined;
};
const topic = (topicId: string): LearnLink | undefined => {
  const t = topics.find(x => x.id === topicId);
  return t ? { title: `All ${t.title} lessons`, subtitle: `${t.lessons.length} lessons`, icon: 'book-open', open: nav => nav.navigate('Topic', { topicId }) } : undefined;
};

/** What to open to learn how a component of this type works, most specific first. First pass: only the cache-aside system's types. */
const BY_TYPE: Record<string, () => (LearnLink | undefined)[]> = {
  'relational-db': () => [
    lesson('postgres', 'anatomy', 'What runs inside one Postgres server'),
    demo('b-tree', 'How an index finds a row'),
    demo('mem-page-cache', 'How a read reaches disk and back'),
    lesson('postgres', 'wal-group-commit', 'What a commit costs'),
    topic('postgres'),
  ],
  cache: () => [
    lesson('redis', 'lifecycle', 'One GET, from socket to reply'),
    lesson('redis', 'vs-disk-db', 'Why a cache answers in microseconds'),
    lesson('caching', 'cache-layers', 'Where caches sit in a system'),
    topic('redis'),
  ],
  service: () => [lesson('net-http', 'http1', 'How a request arrives'), topic('microservices')],
  'web-client': () => [topic('net-http')],
  'cpu-core': () => [demo('perf-switch', 'How the core switches between threads'), demo('perf-locality', 'Why access order decides the hit rate'), topic('cpp-performance')],
  'cpu-cache': () => [demo('perf-cache', 'A miss, step by step, and how a line fills each tier'), demo('perf-sharing', 'When two cores fight over one line'), topic('cpp-performance')],
  dram: () => [demo('bus-cycle', 'One memory read on the bus'), demo('perf-cache', 'What a trip to RAM costs'), topic('cpp-performance')],
};

export function learnLinks(type: string): LearnLink[] {
  return (BY_TYPE[type]?.() ?? []).filter((x): x is LearnLink => !!x);
}
