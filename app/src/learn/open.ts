import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { templates, type LessonDef, type TopicDef } from '@dsims/content';
import type { RootStackParamList } from '../navigation/types';
import { toast } from '../ui/Toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function openLesson(nav: Nav, t: TopicDef, l: LessonDef) {
  const algo = (l as any).algo as string | undefined;
  const tpl = (l as any).template as string | undefined;
  if (algo) return nav.navigate('AlgorithmPlayer', { slug: algo, lesson: { topicId: t.id, lessonId: l.id } });
  if (tpl && templates[tpl]) {
    const doc = templates[tpl];
    return nav.navigate('Editor', { doc, readOnly: true, autoRun: true, guide: { kind: 'lesson', topicId: t.id, lessonId: l.id } });
  }
  toast({ text: 'This lesson has no illustration yet.', tone: 'info' });
}

export function openLink(nav: Nav, link?: string) {
  if (!link || link === 'none') return;
  if (link.startsWith('algo:')) return nav.navigate('AlgorithmPlayer', { slug: link.slice(5) });
  if (link.startsWith('topic:')) return nav.navigate('Topic', { topicId: link.slice(6) });
  if (link.startsWith('lesson:')) {
    const [topicId] = link.slice(7).split('/');
    return nav.navigate('Topic', { topicId });
  }
}
