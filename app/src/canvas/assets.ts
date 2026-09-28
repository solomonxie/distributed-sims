import { Skia, matchFont, type SkFont, type SkSVG } from '@shopify/react-native-skia';
import { iconSvg } from '../lib/icons';

const FAMILIES = ['SF Pro Text', 'SF Pro', '.SF UI Text', 'Helvetica Neue', 'Helvetica'];
const MONO = ['SF Mono', 'Menlo', 'Courier New'];

const fontMgr = Skia.FontMgr.System();
const families = (() => {
  const s = new Set<string>();
  for (let i = 0; i < fontMgr.countFamilies(); i++) s.add(fontMgr.getFamilyName(i));
  return s;
})();

const pick = (list: string[]) => list.find(f => families.has(f)) ?? 'Helvetica';
const SANS = pick(FAMILIES);
const MONOF = pick(MONO);

const fonts = new Map<string, SkFont>();

export function font(size: number, weight: 400 | 500 | 600 | 700 = 400, mono = false): SkFont {
  const key = `${size}|${weight}|${mono}`;
  let f = fonts.get(key);
  if (!f) {
    f = matchFont({ fontFamily: mono ? MONOF : SANS, fontSize: size, fontWeight: String(weight) as any, fontStyle: 'normal' });
    fonts.set(key, f);
  }
  return f;
}

const svgs = new Map<string, SkSVG | null>();

export function svgIcon(name: string, color: string, strokeWidth = 2): SkSVG | null {
  const key = `${name}|${color}|${strokeWidth}`;
  if (!svgs.has(key)) svgs.set(key, Skia.SVG.MakeFromString(iconSvg(name, color, strokeWidth)));
  return svgs.get(key) ?? null;
}

/** Truncate text to width, middle-out for ids (keeps suffix like -3). */
export function fit(text: string, f: SkFont, maxW: number): string {
  if (f.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 3 && f.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
