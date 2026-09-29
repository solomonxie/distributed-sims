// Trees (BFS/DFS), graphs (grid DFS, topological sort, union-find), trie.
import type { Tone } from '../algo/frames';
import { D, ok, patternDemo, treeLayout, type GEdge, type GNode, type Step } from './lib';

type T = (number | null)[];
const kids = (i: number) => [2 * i + 1, 2 * i + 2];
const has = (t: T, i: number) => i < t.length && t[i] !== null;

// ---------------- trees ----------------
export function levelOrder(t: T) {
  const steps: Step[] = [];
  const levels: number[][] = [];
  let q = has(t, 0) ? [0] : [];
  const done: Record<number, Tone> = {};
  while (q.length) {
    const lvl = q.map((i) => t[i] as number);
    levels.push(lvl);
    q.forEach((i) => (done[i] = 'current'));
    steps.push({ note: `Level ${levels.length - 1}: the queue holds exactly this level, ${lvl.join(', ')}.`, graph: treeLayout(t, { ...done }), lists: [{ label: 'queue', items: lvl }, { label: 'result', items: levels.map((l) => `[${l.join(',')}]`) }] });
    q.forEach((i) => (done[i] = 'ok'));
    q = q.flatMap((i) => kids(i).filter((k) => has(t, k)));
  }
  steps.push({ note: `${levels.length} levels, visited breadth first.`, graph: treeLayout(t, done), lists: [{ label: 'result', items: levels.map((l) => `[${l.join(',')}]`) }], rows: [['levels', levels.length, 'ok']] });
  return { levels, steps };
}

export function maxDepth(t: T) {
  const steps: Step[] = [];
  const tone: Record<number, Tone> = {};
  const depthAt: Record<number, number> = {};
  const go = (i: number): number => {
    if (!has(t, i)) return 0;
    tone[i] = 'current';
    steps.push({ note: `Visit ${t[i]}: ask both children for their depth first.`, graph: treeLayout(t, { ...tone }), lists: [{ label: 'depths', items: Object.entries(depthAt).map(([k, d]) => `${t[+k]}:${d}`) }] });
    const [l, r] = kids(i).map(go);
    depthAt[i] = 1 + Math.max(l, r);
    tone[i] = 'ok';
    steps.push({ note: `${t[i]} returns 1 + max(${l}, ${r}) = ${depthAt[i]}.`, graph: treeLayout(t, { ...tone }), lists: [{ label: 'depths', items: Object.entries(depthAt).map(([k, d]) => `${t[+k]}:${d}`) }] });
    return depthAt[i];
  };
  const d = go(0);
  steps.push({ note: `Max depth ${d}, computed bottom-up by post-order DFS.`, graph: treeLayout(t, tone), rows: [['depth', d, 'ok']] });
  return { depth: d, steps };
}

export function validBST(t: T) {
  const steps: Step[] = [];
  const tone: Record<number, Tone> = {};
  const go = (i: number, lo: number, hi: number): boolean => {
    if (!has(t, i)) return true;
    const v = t[i] as number;
    const fine = lo < v && v < hi;
    tone[i] = fine ? 'ok' : 'fail';
    steps.push({ note: `${v} must lie in (${lo === -Infinity ? '−∞' : lo}, ${hi === Infinity ? '∞' : hi})${fine ? ': it does' : ': it does not, so this is not a BST'}.`, graph: treeLayout(t, { ...tone }), rows: [['low', lo === -Infinity ? '−∞' : lo], ['high', hi === Infinity ? '∞' : hi]] });
    if (!fine) return false;
    return go(2 * i + 1, lo, v) && go(2 * i + 2, v, hi);
  };
  const res = go(0, -Infinity, Infinity);
  steps.push({ note: res ? 'Every node fits its bounds: valid BST.' : 'A node broke the bound inherited from an ancestor.', graph: treeLayout(t, tone), rows: [['valid', res ? 'yes' : 'no', res ? 'ok' : 'fail']] });
  return { valid: res, steps };
}

export function lca(t: T, p: number, q: number) {
  const steps: Step[] = [];
  const tone: Record<number, Tone> = {};
  const idx = (v: number) => t.indexOf(v);
  const pi = idx(p);
  const qi = idx(q);
  const go = (i: number): number => {
    if (!has(t, i)) return -1;
    if (i === pi || i === qi) {
      tone[i] = 'accent';
      steps.push({ note: `Found ${t[i]}: return it upward.`, graph: treeLayout(t, { ...tone, [pi]: 'accent', [qi]: 'accent' }) });
      return i;
    }
    const [l, r] = kids(i).map(go);
    if (l >= 0 && r >= 0) {
      tone[i] = 'ok';
      steps.push({ note: `${t[i]} gets a hit from both sides, so it is the lowest common ancestor.`, graph: treeLayout(t, { ...tone, [pi]: 'accent', [qi]: 'accent' }), rows: [['LCA', t[i] as number, 'ok']] });
      return i;
    }
    return l >= 0 ? l : r;
  };
  steps.push({ note: `Find the lowest node that has ${p} and ${q} in different subtrees (or is one of them).`, graph: treeLayout(t, { [pi]: 'accent', [qi]: 'accent' }) });
  const res = go(0);
  steps.push({ note: `Answer: ${t[res]}.`, graph: treeLayout(t, { [res]: 'ok', [pi]: 'accent', [qi]: 'accent' }), rows: [['LCA', t[res] as number, 'ok']] });
  return { lca: t[res] as number, steps };
}

const TREE: T = [3, 9, 20, null, null, 15, 7];
const BST: T = [8, 3, 10, 1, 6, null, 14, null, null, 4, 7];
patternDemo('algo-trees', 'lc-trees', 'Trees: BFS & DFS', 'Level-order BFS with a queue; recursive DFS that passes bounds down or results up.', [
  { id: 'level', label: 'LC 102 Level order', problem: 'LC 102 · Binary Tree Level Order Traversal', input: 'root = [3,9,20,null,null,15,7]', detail: D('BFS by level', 'Process the queue one level at a time: its length at the start of the loop is the level size.', 'q, res = deque([root]), []\nwhile q:\n    level = []\n    for _ in range(len(q)):\n        n = q.popleft()\n        level.append(n.val)\n        q.extend(c for c in (n.left, n.right) if c)\n    res.append(level)\nreturn res'), steps: () => levelOrder(TREE).steps },
  { id: 'depth', label: 'LC 104 Max depth', problem: 'LC 104 · Maximum Depth of Binary Tree', input: 'root = [3,9,20,null,null,15,7]', detail: D('Post-order DFS', 'Combine the children’s answers on the way back up.', 'def depth(n):\n    if not n:\n        return 0\n    return 1 + max(depth(n.left), depth(n.right))'), steps: () => maxDepth(TREE).steps },
  { id: 'bst', label: 'LC 98 Valid BST', problem: 'LC 98 · Validate Binary Search Tree', input: 'root = [8,3,10,1,6,null,14,null,null,4,7]', detail: D('Pre-order DFS with bounds', 'Checking only parent/child is wrong: every node must respect all ancestors, so pass (low, high) down.', 'def ok(n, lo=-inf, hi=inf):\n    if not n:\n        return True\n    if not lo < n.val < hi:\n        return False\n    return ok(n.left, lo, n.val) and ok(n.right, n.val, hi)'), steps: () => validBST(BST).steps },
  { id: 'lca', label: 'LC 236 LCA', problem: 'LC 236 · Lowest Common Ancestor', input: 'root = [8,3,10,1,6,null,14,null,null,4,7], p = 4, q = 1', detail: D('Return found nodes upward', 'A node whose left and right calls both return non-null is the LCA.', 'def lca(n, p, q):\n    if not n or n in (p, q):\n        return n\n    l, r = lca(n.left, p, q), lca(n.right, p, q)\n    if l and r:\n        return n\n    return l or r'), steps: () => lca(BST, 4, 1).steps },
]);

// ---------------- graphs ----------------
export function numIslands(grid: string[][]) {
  const g = grid.map((r) => [...r]);
  const R = g.length;
  const C = g[0].length;
  const tones: Record<string, Tone> = {};
  const steps: Step[] = [];
  let count = 0;
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      if (g[r][c] !== '1') continue;
      count++;
      const stack = [[r, c]];
      g[r][c] = '#';
      const cells: string[] = [];
      while (stack.length) {
        const [y, x] = stack.pop()!;
        cells.push(`${y},${x}`);
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < R && nx >= 0 && nx < C && g[ny][nx] === '1') {
            g[ny][nx] = '#';
            stack.push([ny, nx]);
          }
        }
      }
      cells.forEach((k) => (tones[k] = count % 2 ? 'ok' : 'protocol'));
      tones[`${r},${c}`] = 'current';
      steps.push({ note: `Land at (${r}, ${c}) starts island ${count}; DFS sinks its ${cells.length} cell(s) so they aren't counted again.`, grid: { cells: grid, tones: { ...tones } }, rows: [['islands', count, 'ok']] });
      tones[`${r},${c}`] = count % 2 ? 'ok' : 'protocol';
    }
  steps.push({ note: `${count} islands.`, grid: { cells: grid, tones }, rows: [['islands', count, 'ok']] });
  return { count, steps };
}

const COURSE_POS: Record<number, [number, number]> = { 0: [150, 300], 1: [400, 220], 2: [400, 480], 3: [650, 350], 4: [880, 350], 5: [650, 620] };
export function topoOrder(n: number, prereq: [number, number][]) {
  const indeg = Array(n).fill(0);
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of prereq) {
    adj[b].push(a);
    indeg[a]++;
  }
  const steps: Step[] = [];
  const tone: Record<number, Tone> = {};
  const view = (): { nodes: GNode[]; edges: GEdge[] } => ({
    nodes: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, x: COURSE_POS[i][0], y: COURSE_POS[i][1], label: String(i), sub: `in ${indeg[i]}`, tone: tone[i] })),
    edges: prereq.map(([a, b]) => ({ a: `c${b}`, b: `c${a}`, dir: true, tone: tone[b] === 'ok' ? 'ok' : 'muted' })),
  });
  const q: number[] = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) q.push(i);
  q.forEach((i) => (tone[i] = 'current'));
  const order: number[] = [];
  steps.push({ note: `Courses with no prerequisites (in-degree 0) go in the queue: ${q.join(', ')}.`, graph: view(), lists: [{ label: 'queue', items: [...q] }, { label: 'order', items: [] }] });
  while (q.length) {
    const c = q.shift()!;
    order.push(c);
    tone[c] = 'ok';
    const freed: number[] = [];
    for (const nx of adj[c]) if (--indeg[nx] === 0) (q.push(nx), freed.push(nx), (tone[nx] = 'current'));
    steps.push({ note: `Take ${c}; ${freed.length ? `${freed.join(', ')} now ha${freed.length > 1 ? 've' : 's'} no unmet prerequisites` : 'nothing new unlocks'}.`, graph: view(), lists: [{ label: 'queue', items: [...q] }, { label: 'order', items: [...order] }] });
  }
  const ok2 = order.length === n;
  steps.push({ note: ok2 ? `All ${n} courses ordered: no cycle.` : 'Some courses never reach in-degree 0: a cycle.', graph: view(), lists: [{ label: 'order', items: order }], rows: [['possible', ok2 ? 'yes' : 'no', ok2 ? 'ok' : 'fail']] });
  return { order, steps };
}

export function redundantConnection(edges: [number, number][]) {
  const n = Math.max(...edges.flat());
  const parent = Array.from({ length: n + 1 }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const pos = (i: number) => ({ x: 200 + ((i - 1) % 3) * 300, y: 300 + Math.floor((i - 1) / 3) * 260 });
  const used: GEdge[] = [];
  const steps: Step[] = [];
  const view = (extra?: GEdge) => ({ nodes: Array.from({ length: n }, (_, k) => ({ id: `u${k + 1}`, ...pos(k + 1), label: String(k + 1), sub: `root ${find(k + 1)}` })), edges: [...used, ...(extra ? [extra] : [])] });
  for (const [a, b] of edges) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) {
      steps.push({ note: `${a} and ${b} already share root ${ra}: edge ${a}-${b} closes a cycle, so it is redundant.`, graph: view({ a: `u${a}`, b: `u${b}`, tone: 'fail' }), lists: [{ label: 'parent', items: parent.slice(1).map((p, i) => `${i + 1}→${p}`) }], rows: [['answer', `[${a}, ${b}]`, 'ok']] });
      return { edge: [a, b], steps };
    }
    parent[ra] = rb;
    used.push({ a: `u${a}`, b: `u${b}`, tone: 'ok' });
    steps.push({ note: `${a} (root ${ra}) and ${b} (root ${rb}) are in different sets: union them.`, graph: view(), lists: [{ label: 'parent', items: parent.slice(1).map((p, i) => `${i + 1}→${p}`) }] });
  }
  return { edge: null, steps };
}

const ISLANDS = [
  ['1', '1', '0', '0', '0'],
  ['1', '1', '0', '0', '1'],
  ['0', '0', '1', '0', '1'],
  ['0', '0', '0', '1', '1'],
];
patternDemo('algo-graphs', 'lc-graphs', 'Graphs: DFS, topological sort, union-find', 'Flood fill on grids, Kahn’s algorithm for dependencies, union-find for connectivity and cycles.', [
  { id: 'islands', label: 'LC 200 Islands', problem: 'LC 200 · Number of Islands', input: '4 × 5 grid of land (1) and water (0)', detail: D('Grid DFS / flood fill', 'Each unvisited land cell starts a new island; sink everything reachable from it.', 'def sink(r, c):\n    if 0 <= r < R and 0 <= c < C and g[r][c] == "1":\n        g[r][c] = "0"\n        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):\n            sink(r + dr, c + dc)\ncount = 0\nfor r in range(R):\n    for c in range(C):\n        if g[r][c] == "1":\n            count += 1; sink(r, c)'), steps: () => numIslands(ISLANDS).steps },
  { id: 'topo', label: 'LC 207 Courses', problem: 'LC 207/210 · Course Schedule', input: '6 courses, edges b → a mean "take b before a"', detail: D("Kahn's algorithm", 'Repeatedly take a node with in-degree 0. If some never reach 0, there is a cycle.', 'indeg = [0] * n; adj = defaultdict(list)\nfor a, b in pre:\n    adj[b].append(a); indeg[a] += 1\nq = deque(i for i in range(n) if not indeg[i])\norder = []\nwhile q:\n    c = q.popleft(); order.append(c)\n    for nx in adj[c]:\n        indeg[nx] -= 1\n        if not indeg[nx]: q.append(nx)\nreturn len(order) == n'), steps: () => topoOrder(6, [[1, 0], [2, 0], [3, 1], [3, 2], [4, 3], [5, 2]]).steps },
  { id: 'uf', label: 'LC 684 Union-find', problem: 'LC 684 · Redundant Connection', input: 'edges = [1,2] [1,3] [2,4] [3,5] [4,5] [2,6]', detail: D('Union-find (disjoint set)', 'find with path compression, union by linking roots. An edge whose ends already share a root closes a cycle.', 'parent = list(range(n + 1))\ndef find(x):\n    if parent[x] != x:\n        parent[x] = find(parent[x])\n    return parent[x]\nfor a, b in edges:\n    ra, rb = find(a), find(b)\n    if ra == rb:\n        return [a, b]\n    parent[ra] = rb'), steps: () => redundantConnection([[1, 2], [1, 3], [2, 4], [3, 5], [4, 5], [2, 6]]).steps },
]);

// ---------------- trie ----------------
interface TNode {
  ch: string;
  kids: Map<string, TNode>;
  end: boolean;
  id: number;
}
export class Trie {
  root: TNode = { ch: '·', kids: new Map(), end: false, id: 0 };
  private n = 1;
  insert(w: string) {
    let cur = this.root;
    for (const c of w) {
      if (!cur.kids.has(c)) cur.kids.set(c, { ch: c, kids: new Map(), end: false, id: this.n++ });
      cur = cur.kids.get(c)!;
    }
    cur.end = true;
  }
  path(w: string): number[] {
    const out = [0];
    let cur = this.root;
    for (const c of w) {
      const nx = cur.kids.get(c);
      if (!nx) return out;
      out.push(nx.id);
      cur = nx;
    }
    return out;
  }
  search(w: string, prefix = false) {
    let cur = this.root;
    for (const c of w) {
      const nx = cur.kids.get(c);
      if (!nx) return false;
      cur = nx;
    }
    return prefix || cur.end;
  }
  /** '.' matches any letter */
  match(w: string, node: TNode = this.root, i = 0, visit?: (id: number) => void): boolean {
    visit?.(node.id);
    if (i === w.length) return node.end;
    const c = w[i];
    if (c === '.') {
      for (const k of node.kids.values()) if (this.match(w, k, i + 1, visit)) return true;
      return false;
    }
    const nx = node.kids.get(c);
    return !!nx && this.match(w, nx, i + 1, visit);
  }
  layout(tone: Record<number, Tone> = {}): { nodes: GNode[]; edges: GEdge[] } {
    const nodes: GNode[] = [];
    const edges: GEdge[] = [];
    const leaves = (t: TNode): number => (t.kids.size ? [...t.kids.values()].reduce((a, k) => a + leaves(k), 0) : 1);
    const total = leaves(this.root);
    const depth = (t: TNode): number => 1 + Math.max(0, ...[...t.kids.values()].map(depth));
    const dy = Math.min(110, 560 / Math.max(1, depth(this.root) - 1));
    const place = (t: TNode, x0: number, d: number) => {
      const w = (leaves(t) / total) * 900;
      nodes.push({ id: `t${t.id}`, x: Math.round(50 + x0 + w / 2), y: Math.round(250 + d * dy), label: t.ch, tone: tone[t.id] ?? (t.end ? 'ok' : undefined) });
      let x = x0;
      for (const k of t.kids.values()) {
        edges.push({ a: `t${t.id}`, b: `t${k.id}` });
        place(k, x, d + 1);
        x += (leaves(k) / total) * 900;
      }
    };
    place(this.root, 0, 0);
    return { nodes, edges };
  }
}

export function trieBuild(words: string[], queries: [string, boolean][]) {
  const t = new Trie();
  const steps: Step[] = [];
  for (const w of words) {
    t.insert(w);
    const hl: Record<number, Tone> = {};
    t.path(w).forEach((id) => (hl[id] = 'current'));
    steps.push({ note: `Insert "${w}": walk existing letters, create the missing ones, mark the last as a word end.`, graph: t.layout(hl), lists: [{ label: 'words', items: words.slice(0, words.indexOf(w) + 1) }] });
  }
  for (const [q, prefix] of queries) {
    const found = t.search(q, prefix);
    const hl: Record<number, Tone> = {};
    t.path(q).forEach((id) => (hl[id] = found ? 'ok' : 'warn'));
    steps.push({ note: `${prefix ? 'startsWith' : 'search'}("${q}") → ${found}${!found && !prefix && t.path(q).length === q.length + 1 ? ': the path exists but its end is not marked as a word' : ''}.`, graph: t.layout(hl), rows: [[prefix ? 'startsWith' : 'search', found ? 'true' : 'false', found ? 'ok' : 'fail']] });
  }
  return { trie: t, steps };
}

export function wildcard(words: string[], queries: string[]) {
  const t = new Trie();
  words.forEach((w) => t.insert(w));
  const steps: Step[] = [{ note: `Dictionary: ${words.join(', ')}.`, graph: t.layout() }];
  for (const q of queries) {
    const seen: Record<number, Tone> = {};
    const found = t.match(q, t.root, 0, (id) => (seen[id] = 'current'));
    steps.push({ note: `"${q}": a '.' tries every child at that level (backtracking)${found ? ', and one branch ends on a word' : ', and no branch ends on a word'}.`, graph: t.layout(seen), rows: [['match', found ? 'true' : 'false', found ? 'ok' : 'fail']] });
  }
  return { steps };
}

export function longestCommonPrefix(words: string[]) {
  const t = new Trie();
  words.forEach((w) => t.insert(w));
  const steps: Step[] = [{ note: `Insert all words: ${words.join(', ')}.`, graph: t.layout() }];
  let cur = t.root;
  let pre = '';
  const hl: Record<number, Tone> = { 0: 'current' };
  while (cur.kids.size === 1 && !cur.end) {
    cur = [...cur.kids.values()][0];
    pre += cur.ch;
    hl[cur.id] = 'current';
    steps.push({ note: `Only one child ('${cur.ch}'): every word shares "${pre}".`, graph: t.layout({ ...hl }), rows: [['prefix', pre]] });
  }
  steps.push({ note: `The path branches (or a word ends) here, so the common prefix is "${pre}".`, graph: t.layout(Object.fromEntries(Object.keys(hl).map((k) => [k, ok]))), rows: [['prefix', pre || '—', 'ok']] });
  return { prefix: pre, steps };
}

patternDemo('algo-trie', 'lc-trie', 'Trie (prefix tree)', 'One node per letter, shared prefixes share a path: prefix queries in O(length of word).', [
  { id: 'build', label: 'LC 208 Trie', problem: 'LC 208 · Implement Trie', input: 'insert apple, app, apt, bat · search app, ap', detail: D('Trie node', 'A dict of children plus an end-of-word flag.', 'class Trie:\n    def __init__(self):\n        self.kids, self.end = {}, False\n    def insert(self, w):\n        n = self\n        for c in w:\n            n = n.kids.setdefault(c, Trie())\n        n.end = True\n    def find(self, w):\n        n = self\n        for c in w:\n            n = n.kids.get(c)\n            if not n: return None\n        return n'), steps: () => trieBuild(['apple', 'app', 'apt', 'bat'], [['app', false], ['ap', false], ['ap', true]]).steps },
  { id: 'dots', label: 'LC 211 Wildcards', problem: 'LC 211 · Design Add and Search Words', input: 'bad dad mad · search pad, .ad, b..', detail: D('DFS over the trie', "A '.' branches into every child; a letter follows one edge.", 'def match(n, w, i=0):\n    if i == len(w):\n        return n.end\n    if w[i] == ".":\n        return any(match(k, w, i + 1) for k in n.kids.values())\n    k = n.kids.get(w[i])\n    return bool(k) and match(k, w, i + 1)'), steps: () => wildcard(['bad', 'dad', 'mad'], ['pad', '.ad', 'b..']).steps },
  { id: 'prefix', label: 'LC 14 Common prefix', problem: 'LC 14 · Longest Common Prefix', input: 'flower, flow, flight', detail: D('Follow single-child nodes', 'Walk from the root while there is exactly one child and no word ends.', 'node, pre = trie, ""\nwhile len(node.kids) == 1 and not node.end:\n    (c, node), = node.kids.items()\n    pre += c\nreturn pre'), steps: () => longestCommonPrefix(['flower', 'flow', 'flight']).steps },
]);
