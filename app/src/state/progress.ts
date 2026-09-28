import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { zustandStorage } from '../lib/storage';

export interface ChallengeResult {
  passed: boolean;
  best?: number;
  at: string;
}

/** A place the user opened; newest first in `recent`. */
export type Visit =
  | { kind: 'lesson'; topic: string; lesson: string }
  | { kind: 'topic'; id: string }
  | { kind: 'problem'; id: string }
  | { kind: 'demo'; slug: string }
  | { kind: 'language'; id: string };

export const visitKey = (v: Visit) => (v.kind === 'lesson' ? `lesson:${v.topic}/${v.lesson}` : v.kind === 'demo' ? `demo:${v.slug}` : `${v.kind}:${v.id}`);
const MAX_RECENT = 12;

interface Progress {
  lessons: Record<string, boolean>;
  challenges: Record<string, ChallengeResult>;
  lastLesson?: { topic: string; lesson: string };
  designsOpened: Record<string, boolean>;
  recent: Visit[];
  visit: (v: Visit) => void;
  completeLesson: (id: string) => void;
  setLast: (topic: string, lesson: string) => void;
  recordChallenge: (id: string, passed: boolean, value?: number) => void;
  openedDesign: (problemId: string) => void;
  reset: () => void;
}

export const useProgress = create<Progress>()(
  persist(
    (set, get) => ({
      lessons: {},
      challenges: {},
      designsOpened: {},
      recent: [],
      visit: v => {
        const k = visitKey(v);
        set({ recent: [v, ...(get().recent ?? []).filter(x => visitKey(x) !== k)].slice(0, MAX_RECENT) });
      },
      completeLesson: id => set({ lessons: { ...get().lessons, [id]: true } }),
      setLast: (topic, lesson) => {
        set({ lastLesson: { topic, lesson } });
        get().visit({ kind: 'lesson', topic, lesson });
      },
      recordChallenge: (id, passed, value) => {
        const prev = get().challenges[id];
        const best = value === undefined ? prev?.best : prev?.best === undefined ? value : Math.min(prev.best, value);
        set({ challenges: { ...get().challenges, [id]: { passed: passed || !!prev?.passed, best, at: new Date().toISOString() } } });
      },
      openedDesign: pid => set({ designsOpened: { ...get().designsOpened, [pid]: true } }),
      reset: () => set({ lessons: {}, challenges: {}, lastLesson: undefined, designsOpened: {}, recent: [] }),
    }),
    { name: 'progress', storage: createJSONStorage(() => zustandStorage) },
  ),
);
