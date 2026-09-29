// Stack & monotonic stack, heap / top-k, linked list tricks.
import type { Tone } from '../algo/frames';
import { D, ok, patternDemo, type GEdge, type GNode, type Step } from './lib';

// ---------------- stack ----------------
export function validParens(s: string) {
  const a = s.split('');
  const pair: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const st: string[] = [];
  const steps: Step[] = [];
  for (let i = 0; i < a.length; i++) {
    const c = a[i];
    if (!pair[c]) {
      st.push(c);
      steps.push({ note: `'${c}' opens: push it.`, arr: a, ptrs: { i }, lists: [{ label: 'stack', items: [...st] }] });
    } else if (st[st.length - 1] === pair[c]) {
      st.pop();
      steps.push({ note: `'${c}' closes the '${pair[c]}' on top: pop.`, arr: a, ptrs: { i }, tones: { [i]: ok }, lists: [{ label: 'stack', items: [...st] }] });
    } else {
      steps.push({ note: `'${c}' doesn't match the top '${st[st.length - 1] ?? 'nothing'}': invalid.`, arr: a, ptrs: { i }, tones: { [i]: 'fail' }, lists: [{ label: 'stack', items: [...st] }], rows: [['valid', 'no', 'fail']] });
      return { valid: false, steps };
    }
  }
  const valid = st.length === 0;
  steps.push({ note: valid ? 'End of string with an empty stack: valid.' : 'Unclosed brackets remain on the stack: invalid.', arr: a, lists: [{ label: 'stack', items: [...st] }], rows: [['valid', valid ? 'yes' : 'no', valid ? 'ok' : 'fail']] });
  return { valid, steps };
}

export function dailyTemps(t: number[]) {
  const ans: (number | string)[] = t.map(() => '');
  const st: number[] = [];
  const steps: Step[] = [];
  for (let i = 0; i < t.length; i++) {
    const popped: number[] = [];
    while (st.length && t[st[st.length - 1]] < t[i]) {
      const j = st.pop()!;
      ans[j] = i - j;
      popped.push(j);
    }
    st.push(i);
    const tones: Record<number, Tone> = { [i]: 'current' };
    popped.forEach((j) => (tones[j] = 'ok'));
    steps.push({ note: popped.length ? `${t[i]}° is warmer than ${popped.map((j) => `${t[j]}° (day ${j})`).join(', ')}: pop and record the wait.` : `${t[i]}° warms nothing on the stack: push day ${i}.`, arr: t, ptrs: { i }, tones, arr2: { label: 'wait', vals: [...ans] }, lists: [{ label: 'stack (idx)', items: st.map((j) => `${j}:${t[j]}`) }] });
  }
  return { ans: ans.map((x) => (x === '' ? 0 : x)) as number[], steps };
}

export function largestRect(h: number[]) {
  const st: number[] = [];
  let best = 0;
  const steps: Step[] = [];
  const hh = [...h, 0];
  for (let i = 0; i < hh.length; i++) {
    while (st.length && hh[st[st.length - 1]] >= hh[i]) {
      const top = st.pop()!;
      const left = st.length ? st[st.length - 1] + 1 : 0;
      const area = h[top] * (i - left);
      best = Math.max(best, area);
      steps.push({ note: `Bar ${top} (height ${h[top]}) can't extend past ${i}: rectangle width ${i - left}, area ${area}.`, arr: h, ptrs: { i: Math.min(i, h.length - 1) }, win: [left, i - 1], tones: { [top]: 'warn' }, lists: [{ label: 'stack (idx)', items: st.map((j) => `${j}:${h[j]}`) }], rows: [['area', area], ['best', best, area === best ? 'ok' : undefined]] });
    }
    st.push(i);
    if (i < h.length) steps.push({ note: `Push bar ${i}: the stack keeps heights increasing.`, arr: h, ptrs: { i }, lists: [{ label: 'stack (idx)', items: st.map((j) => `${j}:${h[j]}`) }], rows: [['best', best]] });
  }
  steps.push({ note: `Largest rectangle: ${best}.`, arr: h, rows: [['best', best, 'ok']] });
  return { best, steps };
}

export function evalRPN(tokens: string[]) {
  const st: number[] = [];
  const steps: Step[] = [];
  tokens.forEach((tk, i) => {
    if (['+', '-', '*', '/'].includes(tk)) {
      const b = st.pop()!;
      const a = st.pop()!;
      const r = tk === '+' ? a + b : tk === '-' ? a - b : tk === '*' ? a * b : Math.trunc(a / b);
      st.push(r);
      steps.push({ note: `Operator ${tk}: pop ${b} and ${a}, push ${a} ${tk} ${b} = ${r}.`, arr: tokens, ptrs: { i }, tones: { [i]: 'current' }, lists: [{ label: 'stack', items: [...st] }] });
    } else {
      st.push(+tk);
      steps.push({ note: `Number ${tk}: push.`, arr: tokens, ptrs: { i }, lists: [{ label: 'stack', items: [...st] }] });
    }
  });
  steps.push({ note: `One value left: ${st[0]}.`, arr: tokens, lists: [{ label: 'stack', items: [...st] }], rows: [['result', st[0], 'ok']] });
  return { value: st[0], steps };
}

patternDemo('algo-stack', 'lc-stack', 'Stack & monotonic stack', 'Last in, first out: matching brackets, evaluating expressions, and a monotonic stack for "next greater" questions in O(n).', [
  { id: 'parens', label: 'LC 20 Parentheses', problem: 'LC 20 · Valid Parentheses', input: 's = "{[()]}(]"', detail: D('Stack of openers', 'Push openers; each closer must match the top.', 'pair = {")": "(", "]": "[", "}": "{"}\nst = []\nfor c in s:\n    if c not in pair:\n        st.append(c)\n    elif not st or st.pop() != pair[c]:\n        return False\nreturn not st'), steps: () => validParens('{[()]}(]').steps },
  { id: 'temps', label: 'LC 739 Temperatures', problem: 'LC 739 · Daily Temperatures', input: 'T = [73,74,75,71,69,72,76,73]', detail: D('Monotonic decreasing stack', 'The stack holds days still waiting for a warmer one; a warmer day resolves them all at once.', 'ans, st = [0] * len(T), []\nfor i, t in enumerate(T):\n    while st and T[st[-1]] < t:\n        j = st.pop()\n        ans[j] = i - j\n    st.append(i)\nreturn ans'), steps: () => dailyTemps([73, 74, 75, 71, 69, 72, 76, 73]).steps },
  { id: 'rect', label: 'LC 84 Histogram', problem: 'LC 84 · Largest Rectangle in Histogram', input: 'heights = [2,1,5,6,2,3]', detail: D('Monotonic increasing stack', 'When a shorter bar arrives, every taller bar on the stack has found its right edge; the new top is its left edge.', 'st, best = [], 0\nfor i, h in enumerate(heights + [0]):\n    while st and heights[st[-1]] >= h:\n        top = st.pop()\n        left = st[-1] + 1 if st else 0\n        best = max(best, heights[top] * (i - left))\n    st.append(i)\nreturn best'), steps: () => largestRect([2, 1, 5, 6, 2, 3]).steps },
  { id: 'rpn', label: 'LC 150 RPN', problem: 'LC 150 · Evaluate Reverse Polish Notation', input: '2 1 + 3 * 4 -', detail: D('Operand stack', 'Numbers push; an operator pops two, applies, pushes the result.', 'st = []\nfor t in tokens:\n    if t in "+-*/":\n        b, a = st.pop(), st.pop()\n        st.append(int(eval(f"{a}{t}{b}")))\n    else:\n        st.append(int(t))\nreturn st[0]'), steps: () => evalRPN(['2', '1', '+', '3', '*', '4', '-']).steps },
]);

// ---------------- heap ----------------
function heapTree(h: number[], tone: Record<number, Tone> = {}): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  h.slice(0, 15).forEach((v, i) => {
    const level = Math.floor(Math.log2(i + 1));
    const idx = i - (2 ** level - 1);
    const span = 1000 / 2 ** level;
    nodes.push({ id: `h${i}`, x: Math.round(span * idx + span / 2), y: 480 + level * 105, label: String(v), tone: tone[i] });
    if (i) edges.push({ a: `h${(i - 1) >> 1}`, b: `h${i}` });
  });
  return { nodes, edges };
}

/** array min-heap with push/pop that record sift paths */
export class MinHeap {
  a: number[] = [];
  constructor(private cmp: (x: number, y: number) => number = (x, y) => x - y) {}
  push(v: number) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i && this.cmp(a[i], a[(i - 1) >> 1]) < 0) {
      [a[i], a[(i - 1) >> 1]] = [a[(i - 1) >> 1], a[i]];
      i = (i - 1) >> 1;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.cmp(a[l], a[m]) < 0) m = l;
        if (r < a.length && this.cmp(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  peek() {
    return this.a[0];
  }
  get size() {
    return this.a.length;
  }
}

export function kthLargest(nums: number[], k: number) {
  const h = new MinHeap();
  const steps: Step[] = [];
  nums.forEach((x, i) => {
    h.push(x);
    let popped: number | undefined;
    if (h.size > k) popped = h.pop();
    steps.push({ note: popped !== undefined ? `Push ${x}; the heap exceeds k = ${k}, so pop the smallest (${popped}).` : `Push ${x}; the heap has ${h.size} of ${k}.`, arr: nums, ptrs: { i }, graph: heapTree(h.a, { 0: 'accent' }), rows: [['k', k], ['heap top', h.peek()]] });
  });
  steps.push({ note: `The min-heap holds the k largest; its top, ${h.peek()}, is the k-th largest.`, arr: nums, graph: heapTree(h.a, { 0: 'ok' }), rows: [['answer', h.peek(), 'ok']] });
  return { kth: h.peek(), steps };
}

export function topKFrequent(nums: number[], k: number) {
  const cnt = new Map<number, number>();
  for (const x of nums) cnt.set(x, (cnt.get(x) ?? 0) + 1);
  const h = new MinHeap((a, b) => cnt.get(a)! - cnt.get(b)! || b - a);
  const steps: Step[] = [{ note: 'Count each value first, then keep a size-k min-heap keyed by count.', arr: nums, lists: [{ label: 'counts', items: [...cnt].map(([v, c]) => `${v}×${c}`) }], rows: [['k', k]] }];
  for (const v of cnt.keys()) {
    h.push(v);
    let popped: number | undefined;
    if (h.size > k) popped = h.pop();
    steps.push({ note: popped !== undefined ? `Add ${v} (×${cnt.get(v)}); too many, drop the least frequent, ${popped}.` : `Add ${v} (×${cnt.get(v)}).`, arr: nums, graph: heapTree(h.a.map((x) => x)), lists: [{ label: 'counts', items: [...cnt].map(([x, c]) => `${x}×${c}`) }], rows: [['k', k]] });
  }
  const res = [...h.a].sort((a, b) => cnt.get(b)! - cnt.get(a)!);
  steps.push({ note: `Top ${k}: ${res.join(', ')}.`, arr: nums, graph: heapTree(h.a, { 0: 'ok' }), rows: [['answer', res.join(','), 'ok']] });
  return { top: res, steps };
}

export function mergeK(lists: number[][]) {
  const h = new MinHeap();
  const pos = lists.map(() => 0);
  const out: number[] = [];
  const steps: Step[] = [];
  const key = (li: number) => lists[li][pos[li]] * 100 + li;
  lists.forEach((l, i) => l.length && h.push(key(i)));
  const view = () => ({ nodes: heapTree(h.a.map((kk) => Math.floor(kk / 100))).nodes, edges: heapTree(h.a).edges });
  steps.push({ note: 'Put the head of every list in a min-heap.', graph: view(), lists: [{ label: 'merged', items: [] }], rows: [['lists', lists.map((l) => `[${l.join(',')}]`).join(' ')]] });
  while (h.size) {
    const kk = h.pop();
    const li = kk % 100;
    out.push(lists[li][pos[li]]);
    pos[li]++;
    if (pos[li] < lists[li].length) h.push(key(li));
    steps.push({ note: `Pop ${out[out.length - 1]} from list ${li}${pos[li] < lists[li].length ? `, push its next, ${lists[li][pos[li]]}` : ', which is now empty'}.`, graph: view(), lists: [{ label: 'merged', items: [...out], tones: { [out.length - 1]: 'ok' } }], rows: [['heap size', h.size]] });
  }
  return { out, steps };
}

export function runningMedian(nums: number[]) {
  const lo = new MinHeap((a, b) => b - a);
  const hi = new MinHeap();
  const steps: Step[] = [];
  const med: number[] = [];
  nums.forEach((x, i) => {
    if (!lo.size || x <= lo.peek()) lo.push(x);
    else hi.push(x);
    if (lo.size > hi.size + 1) hi.push(lo.pop());
    else if (hi.size > lo.size) lo.push(hi.pop());
    const m = lo.size > hi.size ? lo.peek() : (lo.peek() + hi.peek()) / 2;
    med.push(m);
    steps.push({ note: `Add ${x} and rebalance: lower half max ${lo.peek()}${hi.size ? `, upper half min ${hi.peek()}` : ''}; median ${m}`, arr: nums, ptrs: { i }, lists: [{ label: 'low (max)', items: [...lo.a].sort((a, b) => a - b) }, { label: 'high (min)', items: [...hi.a].sort((a, b) => a - b) }], rows: [['median', m, 'ok']] });
  });
  return { med, steps };
}

patternDemo('algo-heap', 'lc-heap', 'Heap / top-k', 'A binary heap gives the min (or max) in O(1) and updates in O(log n): top-k, k-way merge, running medians.', [
  { id: 'kth', label: 'LC 215 Kth largest', problem: 'LC 215 · Kth Largest Element', input: 'nums = [3,2,1,5,6,4], k = 2', detail: D('Size-k min-heap', 'Keep only the k largest seen so far; the smallest of them is the answer. O(n log k).', 'import heapq\nh = []\nfor x in nums:\n    heapq.heappush(h, x)\n    if len(h) > k:\n        heapq.heappop(h)\nreturn h[0]'), steps: () => kthLargest([3, 2, 1, 5, 6, 4], 2).steps },
  { id: 'topk', label: 'LC 347 Top k freq', problem: 'LC 347 · Top K Frequent Elements', input: 'nums = [1,1,1,2,2,3,4,4,4,4], k = 2', detail: D('Count, then heap by count', 'Counter + nlargest; or bucket sort by frequency for O(n).', 'from collections import Counter\nimport heapq\ncnt = Counter(nums)\nreturn heapq.nlargest(k, cnt, key=cnt.get)'), steps: () => topKFrequent([1, 1, 1, 2, 2, 3, 4, 4, 4, 4], 2).steps },
  { id: 'merge', label: 'LC 23 Merge k', problem: 'LC 23 · Merge k Sorted Lists', input: '[1,4,5] [1,3,4] [2,6]', detail: D('K-way merge', 'The heap holds one candidate per list; pop the smallest, push its successor. O(N log k).', 'h = [(l.val, i, l) for i, l in enumerate(lists) if l]\nheapq.heapify(h)\nwhile h:\n    v, i, node = heapq.heappop(h)\n    tail.next = node; tail = node\n    if node.next:\n        heapq.heappush(h, (node.next.val, i, node.next))'), steps: () => mergeK([[1, 4, 5], [1, 3, 4], [2, 6]]).steps },
  { id: 'median', label: 'LC 295 Median', problem: 'LC 295 · Find Median from Data Stream', input: 'stream: 5 15 1 3 8', detail: D('Two heaps', 'A max-heap for the lower half and a min-heap for the upper half, sizes within one.', 'lo, hi = [], []   # lo is a max-heap (negated)\ndef add(x):\n    heapq.heappush(lo, -x)\n    heapq.heappush(hi, -heapq.heappop(lo))\n    if len(hi) > len(lo):\n        heapq.heappush(lo, -heapq.heappop(hi))\ndef median():\n    if len(lo) > len(hi): return -lo[0]\n    return (-lo[0] + hi[0]) / 2'), steps: () => runningMedian([5, 15, 1, 3, 8]).steps },
]);

// ---------------- linked list ----------------
function listGraph(vals: (number | string)[], next: number[], tones: Record<number, Tone> = {}, labels: Record<number, string> = {}): { nodes: GNode[]; edges: GEdge[] } {
  const n = vals.length;
  const w = Math.min(160, Math.floor(900 / n));
  // a tail pointing back: lay the loop out on a circle so the back edge is visible
  const loopAt = next.findIndex((j, i) => j >= 0 && j <= i);
  const start = loopAt >= 0 ? next[loopAt] : -1;
  const xy = (i: number) => {
    if (start < 0 || i < start) return { x: 80 + i * w, y: 450 };
    const m = n - start;
    const ang = Math.PI + ((i - start) / m) * 2 * Math.PI;
    return { x: Math.round(80 + start * w + 180 + 180 * Math.cos(ang)), y: Math.round(450 + 180 * Math.sin(ang)) };
  };
  const nodes = vals.map((v, i) => ({ id: `ln${i}`, ...xy(i), label: String(v), tone: tones[i], sub: labels[i] }));
  const edges: GEdge[] = [];
  next.forEach((j, i) => {
    if (j >= 0) edges.push({ a: `ln${i}`, b: `ln${j}`, dir: true, tone: j < i ? 'warn' : 'muted' });
  });
  return { nodes, edges };
}

export function reverseList(vals: number[]) {
  const next = vals.map((_, i) => (i + 1 < vals.length ? i + 1 : -1));
  let prev = -1;
  let cur = 0;
  const steps: Step[] = [{ note: 'Walk the list once, flipping each next pointer to the previous node.', graph: listGraph(vals, next, { 0: 'current' }, { 0: 'cur' }), rows: [['prev', 'None'], ['cur', vals[0]]] }];
  while (cur >= 0) {
    const nxt = next[cur];
    next[cur] = prev;
    const labels: Record<number, string> = { [cur]: 'prev' };
    if (nxt >= 0) labels[nxt] = 'cur';
    steps.push({ note: `Save next (${nxt >= 0 ? vals[nxt] : 'None'}), point ${vals[cur]} back at ${prev >= 0 ? vals[prev] : 'None'}, then advance.`, graph: listGraph(vals, next, { [cur]: 'ok', ...(nxt >= 0 ? { [nxt]: 'current' } : {}) }, labels), rows: [['prev', vals[cur]], ['cur', nxt >= 0 ? vals[nxt] : 'None']] });
    prev = cur;
    cur = nxt;
  }
  steps.push({ note: `The new head is ${vals[prev]}.`, graph: listGraph(vals, next, { [prev]: 'ok' }, { [prev]: 'head' }), rows: [['head', vals[prev], 'ok']] });
  return { order: (() => { const o: number[] = []; for (let c = prev; c >= 0; c = next[c]) o.push(vals[c]); return o; })(), steps };
}

export function hasCycle(vals: number[], pos: number) {
  const next = vals.map((_, i) => (i + 1 < vals.length ? i + 1 : pos));
  let slow = 0;
  let fast = 0;
  const steps: Step[] = [{ note: `Tail links back to index ${pos}. Slow moves 1, fast moves 2.`, graph: listGraph(vals, next, { 0: 'current' }, { 0: 'S F' }) }];
  for (let k = 0; k < 20; k++) {
    if (fast < 0 || next[fast] < 0) {
      steps.push({ note: 'Fast fell off the end: no cycle.', graph: listGraph(vals, next), rows: [['cycle', 'no']] });
      return { cycle: false, steps };
    }
    slow = next[slow];
    fast = next[next[fast]];
    const labels: Record<number, string> = {};
    labels[slow] = 'S';
    labels[fast] = labels[fast] ? 'S F' : 'F';
    if (slow === fast) {
      steps.push({ note: `They meet at ${vals[slow]}: there is a cycle.`, graph: listGraph(vals, next, { [slow]: 'ok' }, labels), rows: [['cycle', 'yes', 'ok']] });
      return { cycle: true, steps };
    }
    steps.push({ note: `slow at ${vals[slow]}, fast at ${vals[fast]}. Inside a loop fast gains one node per step.`, graph: listGraph(vals, next, { [slow]: 'current', [fast]: 'accent' }, labels) });
  }
  return { cycle: false, steps };
}

export function mergeTwo(a: number[], b: number[]) {
  let i = 0;
  let j = 0;
  const out: number[] = [];
  const steps: Step[] = [];
  const view = () => [{ label: 'list 1', items: a.map((x, k) => (k === i ? `▸${x}` : x)), tones: { [i]: 'current' as Tone } }, { label: 'list 2', items: b.map((x, k) => (k === j ? `▸${x}` : x)), tones: { [j]: 'current' as Tone } }];
  while (i < a.length || j < b.length) {
    const takeA = j >= b.length || (i < a.length && a[i] <= b[j]);
    const v = takeA ? a[i++] : b[j++];
    out.push(v);
    steps.push({ note: `Take ${v} from list ${takeA ? 1 : 2}; append after the dummy tail.`, arr: out, arrLabel: 'merged', tones: { [out.length - 1]: 'ok' }, lists: view() });
  }
  return { out, steps };
}

export function removeNth(vals: number[], n: number) {
  const len = vals.length;
  const next = vals.map((_, i) => (i + 1 < len ? i + 1 : -1));
  const steps: Step[] = [];
  let fast = 0;
  for (let k = 0; k < n; k++) fast = next[fast];
  steps.push({ note: `Move fast ${n} nodes ahead, so the gap between fast and slow is ${n}.`, graph: listGraph(vals, next, { [fast]: 'accent' }, { 0: 'S', [fast]: 'F' }) });
  let slow = -1;
  while (fast >= 0) {
    fast = next[fast];
    slow = slow < 0 ? 0 : next[slow];
    steps.push({ note: fast >= 0 ? 'Move both one step.' : 'Fast is past the end, so slow sits just before the node to remove.', graph: listGraph(vals, next, { [slow]: 'current', ...(fast >= 0 ? { [fast]: 'accent' } : {}) }, { [slow]: 'S', ...(fast >= 0 ? { [fast]: 'F' } : {}) }) });
  }
  const target = slow < 0 ? 0 : next[slow];
  if (slow >= 0) next[slow] = next[target];
  steps.push({ note: `Unlink ${vals[target]}: slow.next = slow.next.next.`, graph: listGraph(vals, next, { [target]: 'fail' }, { [target]: 'removed' }), rows: [['removed', vals[target], 'ok']] });
  return { removed: vals[target], steps };
}

patternDemo('algo-linked-list', 'lc-linked-list', 'Linked list tricks', 'Pointer rewiring, fast/slow runners and dummy heads solve most list problems in O(1) extra space.', [
  { id: 'reverse', label: 'LC 206 Reverse', problem: 'LC 206 · Reverse Linked List', input: '1 → 2 → 3 → 4 → 5', detail: D('Three pointers', 'prev, cur, next: save next, flip cur.next, advance.', 'prev, cur = None, head\nwhile cur:\n    nxt = cur.next\n    cur.next = prev\n    prev, cur = cur, nxt\nreturn prev'), steps: () => reverseList([1, 2, 3, 4, 5]).steps },
  { id: 'cycle', label: 'LC 141 Cycle', problem: 'LC 141 · Linked List Cycle', input: '3 → 2 → 0 → -4 → back to 2', detail: D("Floyd's tortoise and hare", 'Fast moves two, slow one. In a loop the gap shrinks by one per step, so they must meet.', 'slow = fast = head\nwhile fast and fast.next:\n    slow = slow.next\n    fast = fast.next.next\n    if slow is fast:\n        return True\nreturn False'), steps: () => hasCycle([3, 2, 0, -4], 1).steps },
  { id: 'merge', label: 'LC 21 Merge two', problem: 'LC 21 · Merge Two Sorted Lists', input: '[1,2,4] and [1,3,4]', detail: D('Dummy head', 'A dummy node removes the special case for the first append.', 'dummy = tail = ListNode()\nwhile a and b:\n    if a.val <= b.val:\n        tail.next, a = a, a.next\n    else:\n        tail.next, b = b, b.next\n    tail = tail.next\ntail.next = a or b\nreturn dummy.next'), steps: () => mergeTwo([1, 2, 4], [1, 3, 4]).steps },
  { id: 'nth', label: 'LC 19 Remove nth', problem: 'LC 19 · Remove Nth Node From End', input: '1 → 2 → 3 → 4 → 5, n = 2', detail: D('Gap of n', 'Advance fast n steps, then move both until fast ends; slow stops before the target.', 'dummy = ListNode(0, head)\nfast = slow = dummy\nfor _ in range(n + 1):\n    fast = fast.next\nwhile fast:\n    fast, slow = fast.next, slow.next\nslow.next = slow.next.next\nreturn dummy.next'), steps: () => removeNth([1, 2, 3, 4, 5], 2).steps },
]);
