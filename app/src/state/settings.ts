import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { zustandStorage } from '../lib/storage';

export interface Settings {
  theme: 'system' | 'dark' | 'light';
  haptics: boolean;
  defaultSpeed: number;
  traceEvery: number;
  particles: 'low' | 'med' | 'high';
  /** minimum on-screen time for one hop */
  flow: 'slow' | 'normal' | 'fast';
  /** show status pills on canvas nodes */
  labels: boolean;
  /** animation speed, 0.1×–10× */
  animSpeed: number;
  launches: number;
  /** narrate the followed request in a tip box */
  requestTips: boolean;
  set: (p: Partial<Omit<Settings, 'set'>>) => void;
}

export const useSettings = create<Settings>()(
  persist(
    set => ({
      theme: 'dark',
      haptics: true,
      defaultSpeed: 0.001,
      traceEvery: 50,
      particles: 'med',
      flow: 'normal',
      labels: false,
      animSpeed: 1,
      launches: 0,
      requestTips: true,
      set: p => set(p),
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => zustandStorage),
      version: 6,
      // v2: slow default speed so traffic is followable
      migrate: (state: any, version) => ({ ...state, ...(version < 5 ? { labels: false, animSpeed: 1 } : {}), requestTips: true }),
    },
  ),
);
