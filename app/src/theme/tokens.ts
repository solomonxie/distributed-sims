// Tokens from docs/design/mobile-app/uiux/visual.md — nothing else hard-codes colour or spacing.

/** Colours the animations are drawn with (algorithm frames, the system canvas). Kept as-is while the app chrome moved to `palette`. */
export const canvasPalette = {
  dark: {
    canvas: '#0A0D14',
    gridDot: '#1C2230',
    surface1: '#121722',
    surface2: '#1A2030',
    glass: 'rgba(18,23,34,0.72)',
    glassSolid: '#141A26',
    hairline: 'rgba(255,255,255,0.08)',
    hairlineStrong: 'rgba(255,255,255,0.14)',
    text: '#E8ECF4',
    text2: '#8A93A6',
    text3: '#566074',
    accent: '#5CE1FF',
    accentPressed: '#2FC4E8',
    onAccent: '#04121A',
    ok: '#3DDC97',
    warn: '#FFB547',
    fail: '#FF5C6C',
    down: '#566074',
    partition: '#B28CFF',
    read: '#5CE1FF',
    write: '#FF9F5C',
    protocol: '#B28CFF',
    error: '#FF5C6C',
    scrim: 'rgba(0,0,0,0.5)',
  },
  light: {
    canvas: '#F5F6F8',
    gridDot: '#D9DDE4',
    surface1: '#FFFFFF',
    surface2: '#FFFFFF',
    glass: 'rgba(255,255,255,0.72)',
    glassSolid: '#FFFFFF',
    hairline: 'rgba(10,13,20,0.08)',
    hairlineStrong: 'rgba(10,13,20,0.14)',
    text: '#0A0D14',
    text2: '#5A6376',
    text3: '#8A93A6',
    accent: '#0095C8',
    accentPressed: '#007AA6',
    onAccent: '#FFFFFF',
    ok: '#0F9D63',
    warn: '#C77800',
    fail: '#D6263B',
    down: '#8A93A6',
    partition: '#7B4FE0',
    read: '#0095C8',
    write: '#E0701F',
    protocol: '#7B4FE0',
    error: '#D6263B',
    scrim: 'rgba(0,0,0,0.3)',
  },
};

/** App chrome: calm neutral surfaces, one soft accent, muted status colours. */
export const palette: typeof canvasPalette = {
  dark: {
    canvas: '#0F1012',
    gridDot: '#232428',
    surface1: '#17181B',
    surface2: '#1F2023',
    glass: 'rgba(23,24,27,0.78)',
    glassSolid: '#1A1B1E',
    hairline: 'rgba(255,255,255,0.07)',
    hairlineStrong: 'rgba(255,255,255,0.12)',
    text: '#ECECEE',
    text2: '#9B9CA2',
    text3: '#64656B',
    accent: '#A3AEF5',
    accentPressed: '#8793E6',
    onAccent: '#111217',
    ok: '#86C3A3',
    warn: '#DDB679',
    fail: '#E39494',
    down: '#64656B',
    partition: '#B7A8E6',
    read: '#96B4E0',
    write: '#DFAA85',
    protocol: '#B7A8E6',
    error: '#E39494',
    scrim: 'rgba(0,0,0,0.55)',
  },
  light: {
    canvas: '#F6F6F4',
    gridDot: '#E2E2DF',
    surface1: '#FFFFFF',
    surface2: '#F0F0EE',
    glass: 'rgba(255,255,255,0.8)',
    glassSolid: '#FFFFFF',
    hairline: 'rgba(0,0,0,0.06)',
    hairlineStrong: 'rgba(0,0,0,0.1)',
    text: '#1C1C1E',
    text2: '#6B6B70',
    text3: '#A1A1A6',
    accent: '#4F5BD5',
    accentPressed: '#3E49BD',
    onAccent: '#FFFFFF',
    ok: '#3F8F6B',
    warn: '#B7791F',
    fail: '#C24141',
    down: '#A1A1A6',
    partition: '#6E5AC4',
    read: '#3F6FB5',
    write: '#B8662F',
    protocol: '#6E5AC4',
    error: '#C24141',
    scrim: 'rgba(0,0,0,0.25)',
  },
};

export type Colors = typeof canvasPalette.dark;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 } as const;
export const radius = { node: 14, card: 16, sheet: 28, pill: 999, chip: 10 } as const;
export const hit = 44;

export const type = {
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.37 },
  title: { fontSize: 22, fontWeight: '600' as const, letterSpacing: 0.35 },
  headline: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.41 },
  body: { fontSize: 15, fontWeight: '400' as const, letterSpacing: -0.24 },
  callout: { fontSize: 13, fontWeight: '500' as const, letterSpacing: -0.08 },
  caption: { fontSize: 12, fontWeight: '600' as const, letterSpacing: 0.6, textTransform: 'uppercase' as const },
  mono: { fontSize: 13, fontWeight: '500' as const, fontFamily: 'Menlo', fontVariant: ['tabular-nums'] as ['tabular-nums'] },
};

export const spring = { damping: 22, stiffness: 240, mass: 1 } as const;

export type Tone = 'default' | 'muted' | 'accent' | 'ok' | 'warn' | 'fail' | 'protocol' | 'read' | 'write' | 'visited' | 'current' | 'path' | 'partition' | 'down';

export function toneColor(c: Colors, tone?: Tone | string): string {
  switch (tone) {
    case 'muted':
      return c.text3;
    case 'accent':
      return c.accent;
    case 'current':
      return c.write;
    case 'ok':
    case 'path':
      return c.ok;
    case 'warn':
      return c.warn;
    case 'fail':
      return c.fail;
    case 'protocol':
    case 'partition':
      return c.protocol;
    case 'read':
      return c.read;
    case 'write':
      return c.write;
    case 'visited':
      return c.text2;
    case 'down':
      return c.down;
    default:
      return c.text;
  }
}

export function healthColor(c: Colors, h: string): string {
  return h === 'ok' ? c.ok : h === 'warn' ? c.warn : h === 'fail' ? c.fail : h === 'down' ? c.down : c.text3;
}
