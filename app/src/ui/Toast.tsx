import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { create } from 'zustand';
import { useTheme } from '../theme';
import { Icon } from './Icon';
import { Text } from './primitives';

export interface ToastItem {
  id: number;
  text: string;
  icon?: string;
  tone?: 'info' | 'alert' | 'ok' | 'chaos';
  action?: { label: string; onPress: () => void };
  ms?: number;
}

interface ToastState {
  items: ToastItem[];
  show: (t: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}

let seq = 1;
export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  show: t => {
    const id = seq++;
    set({ items: [...get().items.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.ms ?? (t.tone === 'alert' ? 3000 : 2000));
  },
  dismiss: id => set({ items: get().items.filter(x => x.id !== id) }),
}));

export const toast = (t: Omit<ToastItem, 'id'>) => useToasts.getState().show(t);

export function ToastHost({ top }: { top: number }) {
  const items = useToasts(s => s.items);
  return (
    <View pointerEvents="box-none" style={[styles.host, { top }]}>
      {items.map(t => (
        <ToastView key={t.id} t={t} />
      ))}
    </View>
  );
}

function ToastView({ t }: { t: ToastItem }) {
  const { c } = useTheme();
  const col = t.tone === 'alert' ? c.fail : t.tone === 'ok' ? c.ok : t.tone === 'chaos' ? c.warn : c.accent;
  useEffect(() => {}, []);
  return (
    <Animated.View entering={FadeInUp.springify().damping(18)} exiting={FadeOutUp.duration(160)} layout={LinearTransition}>
     <Pressable onPress={() => useToasts.getState().dismiss(t.id)} accessibilityHint="Dismiss" style={[styles.toast, { backgroundColor: c.surface2, borderColor: c.hairlineStrong }]}>
      <View style={[styles.dot, { backgroundColor: col }]} />
      {t.icon && <Icon name={t.icon} size={16} color={col} />}
      <Text v="callout" numberOfLines={2} style={{ flex: 1, fontSize: 14 }}>
        {t.text}
      </Text>
      {t.action && (
        <Pressable hitSlop={10} onPress={t.action.onPress}>
          <Text v="headline" color={c.accent} style={{ fontSize: 14 }}>
            {t.action.label}
          </Text>
        </Pressable>
      )}
     </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 12, right: 12, gap: 6, zIndex: 50 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  dot: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
});
