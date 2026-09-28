import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { zustandStorage } from '../lib/storage';

export interface ChallengeResult {
  passed: boolean;
  best?: number;
  at: string;
}

interface Progress {
  lessons: Record<string, boolean>;
  challenges: Record<string, ChallengeResult>;
  lastLesson?: { topic: string; lesson: string };
  designsOpened: Record<string, boolean>;
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
      completeLesson: id => set({ lessons: { ...get().lessons, [id]: true } }),
      setLast: (topic, lesson) => set({ lastLesson: { topic, lesson } }),
      recordChallenge: (id, passed, value) => {
        const prev = get().challenges[id];
        const best = value === undefined ? prev?.best : prev?.best === undefined ? value : Math.min(prev.best, value);
        set({ challenges: { ...get().challenges, [id]: { passed: passed || !!prev?.passed, best, at: new Date().toISOString() } } });
      },
      openedDesign: pid => set({ designsOpened: { ...get().designsOpened, [pid]: true } }),
      reset: () => set({ lessons: {}, challenges: {}, lastLesson: undefined, designsOpened: {} }),
    }),
    { name: 'progress', storage: createJSONStorage(() => zustandStorage) },
  ),
);
