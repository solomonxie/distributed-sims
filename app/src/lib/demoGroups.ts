import { algo } from '@dsims/engine';

export type DemoKind = 'algorithms' | 'network' | 'machine' | 'languages';

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
  'lang-go': 'zap',
  'lang-python': 'terminal',
  'lang-java': 'coffee',
  'lang-rust': 'cog',
  'lang-csharp': 'hash',
  'net-layers': 'layers',
  'net-link': 'cable',
  'net-ip': 'route',
  'net-tcp': 'arrow-left-right',
  'net-quic': 'zap',
  'net-dns': 'signpost',
  'net-http': 'globe',
  'net-tls': 'lock',
  'net-lb': 'split',
  'net-tools': 'wrench',
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
  'cpp-network': 'C++ network servers',
  'lang-go': 'Go',
  'lang-python': 'Python',
  'lang-java': 'Java',
  'lang-rust': 'Rust',
  'lang-csharp': 'C#',
  'net-layers': 'Layers & encapsulation',
  'net-link': 'Ethernet & ARP',
  'net-ip': 'IP & routing',
  'net-tcp': 'TCP',
  'net-quic': 'UDP & QUIC',
  'net-dns': 'DNS',
  'net-http': 'HTTP & real-time',
  'net-tls': 'TLS',
  'net-lb': 'Load balancers & CDNs',
  'net-tools': 'Debugging tools',
};

export const KIND_LABEL: Record<DemoKind, string> = { algorithms: 'Algorithms', network: 'Network', machine: 'Machine level', languages: 'Languages' };

export const kindOf = (g: string): DemoKind => (g === 'machine-cpp' || g.startsWith('cpp-') || g.startsWith('lang-') ? 'languages' : g.startsWith('net-') ? 'network' : g.startsWith('machine') ? 'machine' : 'algorithms');
export const groupIcon = (g: string) => ICON[g] ?? (g.startsWith('net-') ? 'network' : 'diamond');
/** Known label, else the id without its prefix, capitalised (`net-tcp` → `Tcp`). */
export const groupLabel = (g: string) => LABEL[g] ?? (g.includes('-') ? g.slice(g.indexOf('-') + 1) : g).replace(/-/g, ' ').replace(/^./, ch => ch.toUpperCase());

export interface DemoGroup {
  id: string;
  kind: DemoKind;
  label: string;
  icon: string;
  demos: algo.Demo[];
}

const KIND_ORDER: DemoKind[] = ['algorithms', 'network', 'machine', 'languages'];

/** All demo groups, algorithms → network → machine → languages, in registration order within each kind. */
export function demoGroups(): DemoGroup[] {
  const by = new Map<string, algo.Demo[]>();
  for (const d of algo.allDemos()) by.set(d.group, [...(by.get(d.group) ?? []), d]);
  return [...by.entries()]
    .map(([id, demos]) => ({ id, kind: kindOf(id), label: groupLabel(id), icon: groupIcon(id), demos }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
