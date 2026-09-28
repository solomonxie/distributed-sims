import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useTheme, space } from '../theme';
import { Icon } from './Icon';
import { Text } from './primitives';

/** ⓘ beside a heading → popover with the full explanation (mobile.md). */
export function InfoButton({ title, text }: { title: string; text: string }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable hitSlop={12} onPress={() => setOpen(true)} accessibilityLabel={`About ${title}`}>
        <Icon name="info" size={20} color={c.text3} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} onPress={() => setOpen(false)}>
          <View style={[styles.pop, { backgroundColor: c.surface2, borderColor: c.hairlineStrong }]}>
            <Text v="headline">{title}</Text>
            <Text style={{ marginTop: space.s, lineHeight: 21 }} color={c.text2}>
              {text}
            </Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pop: { marginTop: 140, marginHorizontal: 28, padding: 18, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
});
