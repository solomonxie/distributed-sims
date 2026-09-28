import React from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, space } from '../theme';
import { Text } from './primitives';

/** Scrolling page; with `title`, a full-screen page with an iOS-style large title, else a pushed page under the nav header. */
export function Screen({ title, right, children, contentStyle, subtitle }: { title?: string; right?: React.ReactNode; children: React.ReactNode; contentStyle?: StyleProp<ViewStyle>; subtitle?: string }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.canvas }} contentContainerStyle={[{ paddingTop: title ? insets.top + 8 : space.m, paddingHorizontal: space.l, paddingBottom: insets.bottom + 40 }, contentStyle]} contentInsetAdjustmentBehavior="never">
      {title ? (
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text v="display">{title}</Text>
            {subtitle ? (
              <Text v="callout" color={c.text2} style={{ marginTop: 2 }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: space.m, minHeight: 50 },
});
