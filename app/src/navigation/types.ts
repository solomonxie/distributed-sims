import type { SystemDoc } from '@dsims/engine';

export interface GuideSpec {
  kind: 'lesson' | 'challenge' | 'tech';
  topicId?: string;
  lessonId?: string;
  problemId?: string;
  challengeId?: string;
}

export type RootStackParamList = {
  Home: undefined;
  Topics: { group: 'topics' | 'under-the-hood' | 'network' | 'machine' | 'ai' | 'patterns' };
  Languages: undefined;
  Language: { id: 'cpp' | 'go' | 'python' | 'java' | 'rust' | 'csharp' | 'fp' };
  Problems: undefined;
  Algorithms: { group?: string };
  Mine: undefined;
  Topic: { topicId: string };
  TechTopic: { techId: string };
  Problem: { problemId: string };
  Editor: { doc: SystemDoc; readOnly?: boolean; autoRun?: boolean; guide?: GuideSpec; title?: string; breadcrumb?: string[] };
  Metrics: undefined;
  AlgorithmPlayer: { slug: string; lesson?: { topicId: string; lessonId: string } };
  Settings: undefined;
  Tour: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
