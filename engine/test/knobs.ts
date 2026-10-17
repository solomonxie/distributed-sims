import type { Demo, DemoInput } from '../src/algo';

/** every input once with defaults, plus one run per knob value (choices: all options; numbers: min, default, max) */
export const runs = (d: Demo) =>
  d.inputs.flatMap((i) => [[i.id, i.data] as const, ...knobRuns(d, i)].map(([name, data]) => [`${d.slug}/${name}`, d.slug, data] as const));

const knobRuns = (d: Demo, i: DemoInput) =>
  (d.controls ?? [])
    .filter((c) => !c.for || c.for.includes(i.id))
    .flatMap((c) => (c.kind === 'choice' ? c.options.map((o) => o.id) : [c.min, c.value, c.max]).map((v) => [`${i.id}?${c.id}=${v}`, { ...(i.data as object), [c.id]: v }] as const));
