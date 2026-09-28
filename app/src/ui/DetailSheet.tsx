import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { algo } from '@dsims/engine';
import { useTheme, space } from '../theme';
import { Icon } from './Icon';
import { Mono, Text } from './primitives';

/** Topmost box with a detail under a point in the 1000×1000 viewBox. */
export function detailAt(shapes: algo.Shape[], x: number, y: number, slop = 8): algo.Detail | undefined {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.t === 'rect' && s.detail && x >= s.x - slop && x <= s.x + s.w + slop && y >= s.y - slop && y <= s.y + s.h + slop) return s.detail;
    if (s.t === 'node' && s.detail) {
      const w = s.w ?? (s.r ?? 30) * 2;
      const h = s.h ?? (s.r ?? 30) * 2;
      if (Math.abs(x - s.x) <= w / 2 + slop && Math.abs(y - s.y) <= h / 2 + slop) return s.detail;
    }
  }
  return undefined;
}

export function DetailSheet({ detail, onClose }: { detail?: algo.Detail; onClose: () => void }) {
  const { c } = useTheme();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={!!detail} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} onPress={onClose} />
      {detail && (
        <View style={[styles.sheet, { backgroundColor: c.surface2, borderColor: c.hairlineStrong, maxHeight: height * 0.75 }]}>
          <View style={styles.head}>
            <Text v="headline" style={{ flex: 1 }}>
              {detail.title}
            </Text>
            <Pressable hitSlop={12} onPress={onClose} accessibilityLabel="Close">
              <Icon name="x" size={22} color={c.text2} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            {!!detail.text && (
              <Text style={{ lineHeight: 22, marginTop: space.s }} color={c.text2}>
                {detail.text}
              </Text>
            )}
            {!!detail.code && (
              <ScrollView horizontal style={[styles.code, { backgroundColor: c.canvas, borderColor: c.hairline }]} contentContainerStyle={{ padding: 12 }}>
                <Mono style={{ fontSize: 13, lineHeight: 19 }}>{detail.code}</Mono>
              </ScrollView>
            )}
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  code: { marginTop: space.m, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
});
