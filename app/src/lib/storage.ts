import { createMMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

export const kv = createMMKV({ id: 'dsims' });

export const zustandStorage: StateStorage = {
  getItem: name => kv.getString(name) ?? null,
  setItem: (name, value) => kv.set(name, value),
  removeItem: name => {
    kv.remove(name);
  },
};
