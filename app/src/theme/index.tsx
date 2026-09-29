import React, { createContext, useContext, useMemo } from 'react';
import { canvasPalette, palette, type Colors } from './tokens';

export * from './tokens';

interface Theme {
  /** app chrome */
  c: Colors;
  /** animation canvases */
  k: Colors;
  dark: boolean;
}

const Ctx = createContext<Theme>({ c: palette.dark, k: canvasPalette.dark, dark: true });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // dark only for now (light theme parked)
  const dark = true;
  const value = useMemo(() => ({ c: dark ? palette.dark : palette.light, k: dark ? canvasPalette.dark : canvasPalette.light, dark }), [dark]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
