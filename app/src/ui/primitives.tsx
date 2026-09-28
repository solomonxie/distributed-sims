import React from 'react';
import { Pressable, StyleSheet, Text as RNText, View, type StyleProp, type TextStyle, type ViewStyle, type TextProps } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { useTheme, type as typo, space, radius, hit } from '../theme';
import { Icon } from './Icon';
import { haptic } from '../lib/haptics';

type Variant = keyof typeof typo;

export function Text({ v = 'body', color, style, ...rest }: TextProps & { v?: Variant; color?: string }) {
  const { c } = useTheme();
  return <RNText {...rest} style={[typo[v], { color: color ?? (v === 'caption' ? c.text2 : c.text) }, style]} />;
}

export function Mono({ style, color, ...rest }: TextProps & { color?: string }) {
  const { c } = useTheme();
  return <RNText {...rest} style={[typo.mono, { color: color ?? c.text }, style]} />;
}

export function Card({ children, style, onPress, padded = false }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean }) {
  const { c } = useTheme();
  const base = [styles.card, { backgroundColor: c.surface1, borderColor: c.hairline }, padded && { padding: space.l }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.75, transform: [{ scale: 0.985 }] }]}>
      {children}
    </Pressable>
  );
}

export function SectionHeader({ title, right, info, style }: { title: string; right?: React.ReactNode; info?: () => void; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[styles.section, style]}>
      <Text v="caption">{title}</Text>
      {info && (
        <Pressable hitSlop={12} onPress={info} style={{ marginLeft: 6 }}>
          <Icon name="info" size={14} color={c.text3} />
        </Pressable>
      )}
      <View style={{ flex: 1 }} />
      {typeof right === 'string' ? <Text v="callout" color={c.text2}>{right}</Text> : right}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  left,
  right,
  value,
  chevron,
  onPress,
  last,
  destructive,
  checked,
  titleStyle,
}: {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  value?: string;
  chevron?: boolean;
  onPress?: () => void;
  last?: boolean;
  destructive?: boolean;
  checked?: boolean;
  titleStyle?: StyleProp<TextStyle>;
}) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.hairline }]}>
      {left && <View style={styles.rowLeft}>{left}</View>}
      <View style={[styles.rowBody, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }]}>
        <View style={{ flex: 1, paddingRight: space.s }}>
          <Text v="body" numberOfLines={1} style={[{ color: destructive ? c.fail : c.text }, titleStyle]}>
            {title}
          </Text>
          {subtitle ? (
            <Text v="callout" color={c.text2} numberOfLines={2} style={{ marginTop: 2 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {value ? (
          <Text v="body" color={c.text2} numberOfLines={1} style={{ maxWidth: 170 }}>
            {value}
          </Text>
        ) : null}
        {right}
        {checked && <Icon name="check" size={18} color={c.accent} />}
        {chevron && <Icon name="chevron-right" size={18} color={c.text3} />}
      </View>
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  kind = 'secondary',
  icon,
  disabled,
  style,
  small,
}: {
  title: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'text' | 'destructive' | 'danger-filled';
  icon?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const { c } = useTheme();
  const bg = kind === 'primary' ? c.accent : kind === 'danger-filled' ? c.fail : kind === 'text' ? 'transparent' : c.surface2;
  const fg = kind === 'primary' ? c.onAccent : kind === 'danger-filled' ? '#fff' : kind === 'destructive' ? c.fail : kind === 'text' ? c.accent : c.text;
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        haptic('light');
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg, borderColor: kind === 'secondary' || kind === 'destructive' ? c.hairlineStrong : 'transparent' },
        pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={small ? 15 : 17} color={fg} strokeWidth={2.4} />}
      <RNText style={[typo.headline, { color: fg, fontSize: small ? 14 : 16 }]}>{title}</RNText>
    </Pressable>
  );
}

export function IconButton({ name, onPress, color, size = 22, disabled, label, style }: { name: string; onPress?: () => void; color?: string; size?: number; disabled?: boolean; label?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }, disabled && { opacity: 0.35 }, style]}
    >
      <Icon name={name} size={size} color={color ?? c.text} />
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange, labels, style }: { options: readonly T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>>; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[styles.seg, { backgroundColor: c.surface2, borderColor: c.hairline }, style]}>
      {options.map(o => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => {
              haptic('select');
              onChange(o);
            }}
            style={[styles.segItem, on && { backgroundColor: c.canvas === '#0A0D14' ? '#2A3246' : '#FFFFFF', shadowOpacity: 0.15 }]}
          >
            <RNText numberOfLines={1} style={[typo.callout, { color: on ? c.text : c.text2, fontWeight: on ? '700' : '500' }]}>
              {labels?.[o] ?? cap(o)}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max = 1e9, step = 1, format }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; format?: (v: number) => string }) {
  const { c } = useTheme();
  const b = (d: number) => (
    <Pressable
      hitSlop={6}
      onPress={() => {
        haptic('select');
        onChange(Math.min(max, Math.max(min, +(value + d).toFixed(4))));
      }}
      style={({ pressed }) => [styles.stepBtn, { backgroundColor: c.surface2, borderColor: c.hairlineStrong }, pressed && { opacity: 0.6 }]}
    >
      <Icon name={d < 0 ? 'minus' : 'plus'} size={16} color={c.text} />
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {b(-step)}
      <Mono style={{ minWidth: 44, textAlign: 'center' }}>{format ? format(value) : String(value)}</Mono>
      {b(step)}
    </View>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      hitSlop={8}
      onPress={() => {
        haptic('select');
        onChange(!value);
      }}
      style={[styles.toggle, { backgroundColor: value ? c.accent : c.surface2, borderColor: c.hairlineStrong }]}
    >
      <View style={[styles.knob, { transform: [{ translateX: value ? 20 : 0 }] }]} />
    </Pressable>
  );
}

export function Progress({ value, color, style }: { value: number; color?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[styles.progress, { backgroundColor: c.hairlineStrong }, style]}>
      <View style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, height: '100%', borderRadius: 3, backgroundColor: color ?? c.accent }} />
    </View>
  );
}

export function Chip({ icon, text, tone, onPress, style }: { icon?: string; text: string; tone?: string; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const col = tone ?? c.text;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.chip, { borderColor: c.hairlineStrong, backgroundColor: c.glassSolid }, pressed && { opacity: 0.7 }, style]}>
      {icon && <Icon name={icon} size={13} color={col} strokeWidth={2.4} />}
      <RNText style={[typo.mono, { color: col, fontSize: 12 }]} numberOfLines={1}>
        {text}
      </RNText>
    </Pressable>
  );
}

export function Glass({ children, style, radius: r = radius.pill }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; radius?: number }) {
  const { c, dark } = useTheme();
  return (
    <View style={[{ borderRadius: r, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairlineStrong }, style]}>
      <BlurView style={StyleSheet.absoluteFill} blurType={dark ? 'dark' : 'light'} blurAmount={24} reducedTransparencyFallbackColor={c.glassSolid} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: dark ? 'rgba(18,23,34,0.55)' : 'rgba(255,255,255,0.55)' }]} />
      {children}
    </View>
  );
}

export function Empty({ icon, title, body, children }: { icon: string; title: string; body?: string; children?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32, gap: 10 }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={26} color={c.text2} />
      </View>
      <Text v="headline" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text v="body" color={c.text2} style={{ textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
      <View style={{ gap: 8, marginTop: 8, alignSelf: 'stretch' }}>{children}</View>
    </View>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  section: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, marginTop: space.xl, marginBottom: space.s },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.l, minHeight: hit + 4 },
  rowLeft: { marginRight: space.m, width: 28, alignItems: 'center' },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingRight: space.l, gap: 6, minHeight: hit + 4 },
  btn: { minHeight: 48, borderRadius: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth },
  btnSmall: { minHeight: 36, borderRadius: 10, paddingHorizontal: 12 },
  iconBtn: { width: hit, height: hit, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', borderRadius: 10, padding: 2, borderWidth: StyleSheet.hairlineWidth },
  segItem: { flex: 1, paddingVertical: 7, paddingHorizontal: 6, alignItems: 'center', borderRadius: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowRadius: 3, shadowOpacity: 0 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: { width: 34, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  toggle: { width: 51, height: 31, borderRadius: 16, padding: 2, borderWidth: StyleSheet.hairlineWidth },
  knob: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
  progress: { height: 6, borderRadius: 3, overflow: 'hidden' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 30, borderRadius: radius.chip, borderWidth: StyleSheet.hairlineWidth },
});
