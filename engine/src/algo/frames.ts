/**
 * Frame protocol shared by the algorithm visualizer and machine-level models.
 * A demo is a generator of frames; the app renders shapes in a 1000×1000
 * viewBox and animates shapes that keep the same id between frames.
 */
export type Tone =
  | 'default'
  | 'muted'
  | 'accent'
  | 'ok'
  | 'warn'
  | 'fail'
  | 'protocol'
  | 'read'
  | 'write'
  | 'visited'
  | 'current'
  | 'path';

/** Tap-to-open explainer for a box: what it is, plus a small sample. */
export interface Detail {
  title: string;
  text?: string;
  code?: string;
}

export type Shape =
  | { t: 'node'; id: string; x: number; y: number; r?: number; w?: number; h?: number; shape?: 'circle' | 'rect' | 'diamond'; label?: string; sub?: string; tone?: Tone; badge?: string; detail?: Detail }
  | { t: 'edge'; id: string; from: string | { x: number; y: number }; to: string | { x: number; y: number }; label?: string; tone?: Tone; arrow?: boolean; dashed?: boolean; bend?: number; width?: number }
  | { t: 'rect'; id: string; x: number; y: number; w: number; h: number; label?: string; sub?: string; tone?: Tone; filled?: boolean; mono?: boolean; radius?: number; dashed?: boolean; detail?: Detail }
  | { t: 'text'; id: string; x: number; y: number; text: string; tone?: Tone; size?: number; align?: 'left' | 'center' | 'right'; mono?: boolean; bold?: boolean }
  | { t: 'arc'; id: string; cx: number; cy: number; r: number; a0: number; a1: number; tone?: Tone; width?: number }
  | { t: 'dot'; id: string; x: number; y: number; r?: number; tone?: Tone; label?: string }
  | { t: 'line'; id: string; x1: number; y1: number; x2: number; y2: number; tone?: Tone; dashed?: boolean; width?: number; arrow?: boolean };

export interface PanelRow {
  label: string;
  value: string;
  tone?: Tone;
}

export interface Frame {
  /** narration, ≤ 2 short sentences */
  note: string;
  shapes: Shape[];
  /** side data (priority queue, registers, counters) */
  panel?: { title: string; rows: PanelRow[] };
  done?: boolean;
}

export interface DemoInput {
  id: string;
  label: string;
  data: unknown;
}

export interface Demo {
  slug: string;
  title: string;
  group: string;
  summary: string;
  /** e.g. ['Google Maps', 'Network'] */
  linkedFrom?: string[];
  inputs: DemoInput[];
  /** graph demos accept user-edited graphs */
  editable?: 'graph' | 'none';
  run(input: unknown): Generator<Frame>;
}

const demos = new Map<string, Demo>();

export function registerDemo(d: Demo) {
  demos.set(d.slug, d);
}

export function getDemo(slug: string): Demo | undefined {
  return demos.get(slug);
}

export function allDemos(): Demo[] {
  return [...demos.values()];
}

/** Materialise frames (demos are small; cache enables step-back). */
export function frames(d: Demo, input?: unknown, max = 2000): Frame[] {
  const out: Frame[] = [];
  const it = d.run(input ?? d.inputs[0]?.data);
  for (let r = it.next(); !r.done && out.length < max; r = it.next()) out.push(r.value);
  return out;
}

export interface GraphInput {
  nodes: { id: string; x: number; y: number; label?: string }[];
  edges: { from: string; to: string; w: number; directed?: boolean }[];
  source?: string;
  target?: string;
}
