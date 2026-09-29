import React, { forwardRef, useMemo } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { SlideInRight, SlideOutRight } from 'react-native-reanimated';
import BottomSheet, { BottomSheetScrollView, type BottomSheetBackgroundProps } from '@gorhom/bottom-sheet';
import { BlurView } from '@react-native-community/blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, radius, space } from '../theme';
import { IconButton, Text } from '../ui/primitives';

export type SheetRef = BottomSheet;

interface Props {
  snapPoints: (string | number)[];
  index?: number;
  onClose?: () => void;
  /** returns to the sheet this one was opened from */
  onBack?: () => void;
  onChange?: (i: number) => void;
  children: React.ReactNode;
  scroll?: boolean;
  title?: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
}

function Background({ style }: BottomSheetBackgroundProps) {
  const { c, dark } = useTheme();
  return (
    <View style={[style, styles.bg, { borderColor: c.hairlineStrong }]} pointerEvents="none">
      <BlurView style={StyleSheet.absoluteFill} blurType={dark ? 'dark' : 'light'} blurAmount={30} reducedTransparencyFallbackColor={c.surface1} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: dark ? 'rgba(23,24,27,0.84)' : 'rgba(255,255,255,0.85)' }]} />
    </View>
  );
}

export const Sheet = forwardRef<BottomSheet, Props>(function Sheet({ snapPoints, index = 0, onClose, onBack, onChange, children, scroll = true, title, subtitle, headerRight, footer }, ref) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const points = useMemo(() => snapPoints, [snapPoints]);
  const { width, height } = useWindowDimensions();
  if (width >= 700 || width > height) {
    // iPad / landscape: a right-hand panel instead of a bottom sheet (UIUX_DESIGN.md → Landscape)
    const w = Math.min(420, Math.max(340, width * 0.4));
    return (
      <Animated.View entering={SlideInRight.springify().damping(22)} exiting={SlideOutRight.duration(180)} style={[styles.side, { width: w, top: insets.top + 8, bottom: insets.bottom + 8, borderColor: c.hairlineStrong }]}>
        <Background {...({ style: StyleSheet.absoluteFill } as any)} />
        {title ? (
          <View style={[styles.header, { paddingTop: space.m }]}>
            {onBack && <IconButton name="chevron-left" size={22} color={c.text2} onPress={onBack} label="Back" style={{ marginLeft: -8 }} />}
            <View style={{ flex: 1 }}>
              <Text v="title" numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text v="callout" color={c.text2} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {headerRight}
            {onClose && <IconButton name="x" size={20} color={c.text2} onPress={onClose} label="Close" />}
          </View>
        ) : onClose || onBack ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.s, paddingTop: space.s }}>
            <View>{onBack && <IconButton name="chevron-left" size={22} color={c.text2} onPress={onBack} label="Back" style={{ marginLeft: -8 }} />}
</View>
            {onClose && <IconButton name="x" size={20} color={c.text2} onPress={onClose} label="Close" />}
          </View>
        ) : null}
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer}
      </Animated.View>
    );
  }
  return (
    <BottomSheet
      ref={ref}
      index={index}
      snapPoints={points}
      enablePanDownToClose
      enableDynamicSizing={false}
      onClose={onClose}
      onChange={onChange}
      backgroundComponent={Background}
      handleIndicatorStyle={{ backgroundColor: c.text3, width: 36 }}
      style={styles.shadow}
    >
      {title ? (
        <View style={styles.header}>
          {onBack && <IconButton name="chevron-left" size={22} color={c.text2} onPress={onBack} label="Back" style={{ marginLeft: -8 }} />}
          <View style={{ flex: 1 }}>
            <Text v="title" numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text v="callout" color={c.text2} numberOfLines={1} style={{ marginTop: 2 }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {headerRight}
          {onClose && <IconButton name="x" size={20} color={c.text2} onPress={onClose} label="Close" />}
        </View>
      ) : onBack ? (
        <View style={[styles.header, { paddingLeft: space.s }]}>
          <IconButton name="chevron-left" size={22} color={c.text2} onPress={onBack} label="Back" />
          <Text v="callout" color={c.text2}>
            Back
          </Text>
        </View>
      ) : null}
      {scroll ? (
        <BottomSheetScrollView contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          {children}
        </BottomSheetScrollView>
      ) : (
        <View style={{ flex: 1, paddingHorizontal: space.l }}>{children}</View>
      )}
      {footer}
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  bg: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.l, paddingRight: space.s, paddingBottom: space.s },
  side: { position: 'absolute', right: 8, borderRadius: 24, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, zIndex: 70, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20 },
  shadow: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: -4 } },
});
