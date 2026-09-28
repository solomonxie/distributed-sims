import type { SystemDoc } from '@dsims/engine';

export interface GuideSpec {
  kind: 'lesson' | 'challenge' | 'tech';
  topicId?: string;
  lessonId?: string;
  problemId?: string;
  challengeId?: string;
}

export type RootStackParamList = {
  Tabs: undefined;
  Topic: { topicId: string };
  TechTopic: { techId: string };
  Problem: { problemId: string };
  Editor: { doc: SystemDoc; readOnly?: boolean; autoRun?: boolean; guide?: GuideSpec; title?: string; breadcrumb?: string[] };
  Metrics: undefined;
  AlgorithmPlayer: { slug: string };
  Settings: undefined;
  Feedback: undefined;
  Tour: undefined;
};

export type TabParamList = {
  Learn: undefined;
  Problems: undefined;
  Algorithms: undefined;
  Mine: undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
