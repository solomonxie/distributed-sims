import React, { useMemo } from 'react';
import { SvgXml } from 'react-native-svg';
import { useTheme } from '../theme';
import { iconSvg } from '../lib/icons';

export function Icon({ name, size = 20, color, strokeWidth = 2 }: { name: string; size?: number; color?: string; strokeWidth?: number }) {
  const { c } = useTheme();
  const xml = useMemo(() => iconSvg(name, color ?? c.text, strokeWidth), [name, color, c.text, strokeWidth]);
  return <SvgXml xml={xml} width={size} height={size} />;
}
