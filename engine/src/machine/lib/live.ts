// Knob-driven demos: each scene is a picture rebuilt from the controls under the stage.
import type { Control, Detail, Frame, Shape } from '../../algo/frames';
import { box, machineDemo, text } from './draw';

export type P = Record<string, unknown>;

export const num = (v: unknown, d: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d));
export const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);

export const choice = (id: string, label: string, options: string[], value: string, o: { for?: string[]; labels?: string[] } = {}): Control => ({ id, label, kind: 'choice', options: options.map((x, i) => ({ id: x, label: o.labels?.[i] ?? x })), value, for: o.for });
export const number = (id: string, label: string, min: number, max: number, value: number, o: { for?: string[] } = {}): Control => ({ id, label, kind: 'number', min, max, value, for: o.for });

export function liveDemo(group: string, slug: string, title: string, summary: string, scenes: Record<string, [label: string, build: (p: P) => Frame[]]>, controls?: Control[], details?: Record<string, Detail>) {
  machineDemo({
    slug,
    title,
    group,
    summary,
    controls,
    inputs: Object.entries(scenes).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: (p: P & { k: string }) => scenes[p.k][1](p),
    details,
  });
}

/** the statement the picture shows, in a strip across the top */
export const cap = (s: string): Shape[] => [box('cap', 20, 16, 960, 70, undefined, { tone: 'muted' }), text('capt', 44, 51, s, { align: 'left', size: 28, mono: true })];

/** liveDemo with the group filled in */
export const liveGroup = (group: string) => (...a: Parameters<typeof liveDemo> extends [string, ...infer R] ? R : never) => liveDemo(group, ...a);
