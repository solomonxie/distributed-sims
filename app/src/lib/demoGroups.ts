import { algo } from '@dsims/engine';

export type DemoKind = 'algorithms' | 'machine' | 'cpp';

const ICON: Record<string, string> = {
  Graph: 'route',
  Partitioning: 'circle-dashed',
  Geo: 'map-pin',
  Probabilistic: 'dices',
  Storage: 'database',
  Distributed: 'network',
  'Rate limit': 'gauge',
  'machine-cpu': 'cpu',
  'machine-memory': 'memory-stick',
  'machine-bus': 'circuit-board',
  'machine-asm': 'binary',
  'machine-bits': 'toggle-right',
  'machine-cpp': 'braces',
  'cpp-basics': 'braces',
  'cpp-oop': 'boxes',
  'cpp-stl': 'library',
  'cpp-modern': 'sparkles',
  'cpp-concurrency': 'git-fork',
  'cpp-cmake': 'hammer',
  'cpp-projects': 'network',
  'cpp-patterns': 'shapes',
  'cpp-network': 'server',
};

const LABEL: Record<string, string> = {
  'machine-cpu': 'CPU',
  'machine-memory': 'Memory',
  'machine-bus': 'Chips, buses & I/O',
  'machine-asm': 'Assembly',
  'machine-bits': 'Bit manipulation',
  'machine-cpp': 'C++ under the hood',
  'cpp-basics': 'C++ basics',
  'cpp-oop': 'Classes & OOP',
  'cpp-stl': 'STL',
  'cpp-modern': 'Modern C++',
  'cpp-concurrency': 'Concurrency',
  'cpp-cmake': 'CMake',
  'cpp-projects': 'Large projects',
  'cpp-patterns': 'Design patterns',
  'cpp-network': 'Network servers',
};

export const KIND_LABEL: Record<DemoKind, string> = { algorithms: 'Algorithms', machine: 'Machine level', cpp: 'C++' };

export const kindOf = (g: string): DemoKind => (g === 'machine-cpp' || g.startsWith('cpp-') ? 'cpp' : g.startsWith('machine') ? 'machine' : 'algorithms');
export const groupIcon = (g: string) => ICON[g] ?? 'diamond';
export const groupLabel = (g: string) => LABEL[g] ?? g;

export interface DemoGroup {
  id: string;
  kind: DemoKind;
  label: string;
  icon: string;
  demos: algo.Demo[];
}

const KIND_ORDER: DemoKind[] = ['algorithms', 'machine', 'cpp'];

/** All demo groups, algorithms → machine → C++, in registration order within each kind. */
export function demoGroups(): DemoGroup[] {
  const by = new Map<string, algo.Demo[]>();
  for (const d of algo.allDemos()) by.set(d.group, [...(by.get(d.group) ?? []), d]);
  return [...by.entries()]
    .map(([id, demos]) => ({ id, kind: kindOf(id), label: groupLabel(id), icon: groupIcon(id), demos }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
