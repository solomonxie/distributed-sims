import * as lucide from 'lucide';
import { icons as brand } from '@dsims/content';

type IconNode = [string, Record<string, string | number>][];

const toPascal = (s: string) => s.replace(/(^|-)([a-z0-9])/g, (_m, _d, ch: string) => ch.toUpperCase());

const cache = new Map<string, string>();

/** SVG markup for a lucide name or `brand:<file>`; colour applies to lucide strokes. */
export function iconSvg(name: string, color: string, strokeWidth = 2): string {
  const key = `${name}|${color}|${strokeWidth}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let svg: string;
  if (name.startsWith('brand:') && (brand as Record<string, string>)[name.slice(6)]) {
    svg = (brand as Record<string, string>)[name.slice(6)];
  } else {
    const node = ((lucide as unknown as Record<string, IconNode>)[toPascal(name.replace(/^brand:/, ''))] ?? (lucide as any).Box) as IconNode;
    const body = node
      .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
      .join('');
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }
  cache.set(key, svg);
  return svg;
}

export function hasIcon(name: string) {
  if (name.startsWith('brand:')) return !!(brand as Record<string, string>)[name.slice(6)];
  return !!(lucide as unknown as Record<string, unknown>)[toPascal(name)];
}
