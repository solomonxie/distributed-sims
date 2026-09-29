// Backtracking, dynamic programming, greedy & intervals, math & number theory.
import type { Tone } from '../algo/frames';
import { D, ok, patternDemo, type GEdge, type GNode, type Step, type Val } from './lib';

// ---------------- backtracking ----------------
/** Record a recursion tree as it is explored: nodes placed by DFS order within depth. */
class RecTree {
  nodes: GNode[] = [];
  edges: GEdge[] = [];
  private perDepth: number[] = [];
  constructor(private maxDepth: number, private width: number) {}
  add(label: string, depth: number, parent?: string, tone?: Tone) {
    const k = (this.perDepth[depth] = (this.perDepth[depth] ?? -1) + 1);
    const cols = Math.min(this.width, 2 ** depth || 1);
    const id = `r${depth}-${k}`;
    const x = Math.round(80 + ((k % Math.max(1, cols)) + 0.5) * (840 / Math.max(1, cols)));
    this.nodes.push({ id, x, y: 240 + depth * Math.min(130, 520 / Math.max(1, this.maxDepth)), label, tone });
    if (parent) this.edges.push({ a: parent, b: id });
    return id;
  }
  tone(id: string, t: Tone) {
    const n = this.nodes.find((x) => x.id === id);
    if (n) n.tone = t;
  }
  snap() {
    return { nodes: this.nodes.map((n) => ({ ...n })), edges: [...this.edges] };
  }
}

export function subsets(nums: number[]) {
  const res: number[][] = [];
  const steps: Step[] = [];
  const tree = new RecTree(nums.length, 8);
  const go = (i: number, path: number[], parent?: string) => {
    const id = tree.add(path.length ? path.join('') : '∅', i, parent, 'current');
    res.push([...path]);
    steps.push({ note: `Record [${path.join(', ')}]. Then try adding each later element.`, graph: tree.snap(), lists: [{ label: 'path', items: [...path] }, { label: 'found', items: res.map((r) => `[${r.join('')}]`) }] });
    tree.tone(id, 'ok');
    for (let j = i; j < nums.length; j++) {
      path.push(nums[j]);
      go(j + 1, path, id);
      path.pop();
    }
  };
  go(0, []);
  steps.push({ note: `${res.length} subsets = 2^${nums.length}.`, graph: tree.snap(), rows: [['subsets', res.length, 'ok']] });
  return { res, steps };
}

export function permutations(nums: number[]) {
  const res: number[][] = [];
  const steps: Step[] = [];
  const tree = new RecTree(nums.length, 6);
  const used = nums.map(() => false);
  const go = (path: number[], parent?: string) => {
    const id = tree.add(path.length ? path.join('') : '∅', path.length, parent, 'current');
    if (path.length === nums.length) {
      res.push([...path]);
      tree.tone(id, 'ok');
      steps.push({ note: `Full length: record [${path.join(', ')}], then backtrack.`, graph: tree.snap(), lists: [{ label: 'path', items: [...path] }, { label: 'found', items: res.map((r) => r.join('')) }] });
      return;
    }
    steps.push({ note: `Path [${path.join(', ')}]: try each unused number next.`, graph: tree.snap(), lists: [{ label: 'path', items: [...path] }, { label: 'found', items: res.map((r) => r.join('')) }] });
    tree.tone(id, 'visited');
    nums.forEach((x, j) => {
      if (used[j]) return;
      used[j] = true;
      path.push(x);
      go(path, id);
      path.pop();
      used[j] = false;
    });
  };
  go([]);
  return { res, steps };
}

export function combinationSum(cands: number[], target: number) {
  const res: number[][] = [];
  const steps: Step[] = [];
  const tree = new RecTree(4, 8);
  const go = (i: number, path: number[], left: number, parent?: string) => {
    const id = tree.add(`${left}`, path.length, parent, 'current');
    if (left === 0) {
      res.push([...path]);
      tree.tone(id, 'ok');
      steps.push({ note: `Remaining 0: [${path.join(', ')}] works.`, graph: tree.snap(), lists: [{ label: 'path', items: [...path] }, { label: 'found', items: res.map((r) => r.join('+')) }], rows: [['left', 0, 'ok']] });
      return;
    }
    steps.push({ note: `Remaining ${left} with [${path.join(', ')}]; candidates from index ${i} on (reuse allowed, no going back avoids duplicates).`, graph: tree.snap(), lists: [{ label: 'path', items: [...path] }, { label: 'found', items: res.map((r) => r.join('+')) }], rows: [['left', left]] });
    tree.tone(id, 'visited');
    for (let j = i; j < cands.length; j++) {
      if (cands[j] > left) {
        steps.push({ note: `${cands[j]} > ${left}: prune, and every larger candidate too (sorted).`, graph: tree.snap(), lists: [{ label: 'path', items: [...path] }, { label: 'found', items: res.map((r) => r.join('+')) }], rows: [['left', left, 'warn']] });
        break;
      }
      path.push(cands[j]);
      go(j, path, left - cands[j], id);
      path.pop();
    }
  };
  go(0, [], target);
  return { res, steps };
}

export function nQueens(n: number) {
  const steps: Step[] = [];
  const cols: number[] = [];
  const sols: number[][] = [];
  const board = (): Val[][] => Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (cols[r] === c ? 'Q' : '')));
  const tones = (bad?: [number, number]) => {
    const t: Record<string, Tone> = {};
    cols.forEach((c, r) => (t[`${r},${c}`] = 'ok'));
    if (bad) t[`${bad[0]},${bad[1]}`] = 'fail';
    return t;
  };
  const safe = (r: number, c: number) => cols.every((cc, rr) => cc !== c && Math.abs(cc - c) !== r - rr);
  const go = (r: number) => {
    if (r === n) {
      sols.push([...cols]);
      steps.push({ note: `All ${n} queens placed: solution ${sols.length}.`, grid: { cells: board(), tones: tones() }, rows: [['solutions', sols.length, 'ok']] });
      return;
    }
    for (let c = 0; c < n; c++) {
      if (!safe(r, c)) continue;
      cols.push(c);
      steps.push({ note: `Row ${r}: column ${c} is not attacked, place a queen.`, grid: { cells: board(), tones: tones() }, rows: [['row', r], ['solutions', sols.length]] });
      go(r + 1);
      cols.pop();
    }
    if (r > 0) steps.push({ note: `Row ${r} has no safe column left: backtrack to row ${r - 1}.`, grid: { cells: board(), tones: tones([r - 1, cols[r - 1]]) }, rows: [['row', r, 'warn']] });
  };
  go(0);
  return { sols, steps };
}

patternDemo('algo-backtracking', 'lc-backtracking', 'Backtracking', 'Build a candidate step by step, undo the last choice when it can’t lead anywhere: choose → explore → un-choose.', [
  { id: 'subsets', label: 'LC 78 Subsets', problem: 'LC 78 · Subsets', input: 'nums = [1,2,3]', detail: D('Choose, explore, un-choose', 'Every node of the recursion tree is a subset; start j at i so each set appears once.', 'res = []\ndef go(i, path):\n    res.append(path[:])\n    for j in range(i, len(nums)):\n        path.append(nums[j])\n        go(j + 1, path)\n        path.pop()\ngo(0, [])'), steps: () => subsets([1, 2, 3]).steps },
  { id: 'perm', label: 'LC 46 Permutations', problem: 'LC 46 · Permutations', input: 'nums = [1,2,3]', detail: D('Used-flags', 'Any unused element may come next; leaves at full length are the permutations. n! of them.', 'def go(path):\n    if len(path) == len(nums):\n        res.append(path[:]); return\n    for i, x in enumerate(nums):\n        if used[i]: continue\n        used[i] = True; path.append(x)\n        go(path)\n        path.pop(); used[i] = False'), steps: () => permutations([1, 2, 3]).steps },
  { id: 'combo', label: 'LC 39 Combination sum', problem: 'LC 39 · Combination Sum', input: 'candidates = [2,3,5], target = 8', detail: D('Prune on sorted candidates', 'Pass the remaining target down; stop the loop as soon as a candidate is too big.', 'cands.sort()\ndef go(i, path, left):\n    if left == 0:\n        res.append(path[:]); return\n    for j in range(i, len(cands)):\n        if cands[j] > left: break\n        path.append(cands[j])\n        go(j, path, left - cands[j])\n        path.pop()'), steps: () => combinationSum([2, 3, 5], 8).steps },
  { id: 'queens', label: 'LC 51 N-Queens', problem: 'LC 51 · N-Queens (n = 4)', input: 'place 4 queens, none attacking', detail: D('Constraint check per row', 'One queen per row; track used columns and both diagonals (r − c, r + c) in sets for O(1) checks.', 'def go(r):\n    if r == n:\n        res.append(cols[:]); return\n    for c in range(n):\n        if c in col or r-c in d1 or r+c in d2:\n            continue\n        col.add(c); d1.add(r-c); d2.add(r+c); cols.append(c)\n        go(r + 1)\n        col.remove(c); d1.remove(r-c); d2.remove(r+c); cols.pop()'), steps: () => nQueens(4).steps },
]);

// ---------------- dynamic programming ----------------
export function climbStairs(n: number) {
  const dp: Val[] = Array(n + 1).fill('');
  dp[0] = 1;
  dp[1] = 1;
  const steps: Step[] = [{ note: 'dp[i] = ways to reach step i. Base: dp[0] = dp[1] = 1.', arr: dp.map((_, i) => i), arrLabel: 'step', arr2: { label: 'dp', vals: [...dp] } }];
  for (let i = 2; i <= n; i++) {
    dp[i] = (dp[i - 1] as number) + (dp[i - 2] as number);
    steps.push({ note: `dp[${i}] = dp[${i - 1}] + dp[${i - 2}] = ${dp[i]}: the last move was 1 step or 2.`, arr: dp.map((_, k) => k), arrLabel: 'step', ptrs: { i }, arr2: { label: 'dp', vals: [...dp], tones: { [i]: 'ok', [i - 1]: 'read', [i - 2]: 'read' } } });
  }
  return { ways: dp[n] as number, steps };
}

export function rob(nums: number[]) {
  const dp: Val[] = nums.map(() => '');
  const steps: Step[] = [];
  nums.forEach((x, i) => {
    const skip = i ? (dp[i - 1] as number) : 0;
    const take = x + (i > 1 ? (dp[i - 2] as number) : 0);
    dp[i] = Math.max(skip, take);
    steps.push({ note: `House ${i}: rob it (${take}) or skip it (${skip}), keep ${dp[i]}.`, arr: nums, arrLabel: 'money', ptrs: { i }, tones: { [i]: take >= skip ? 'ok' : 'visited' }, arr2: { label: 'best', vals: [...dp], tones: { [i]: 'ok' } } });
  });
  steps.push({ note: `Maximum without robbing neighbours: ${dp[nums.length - 1]}.`, arr: nums, arrLabel: 'money', arr2: { label: 'best', vals: dp }, rows: [['answer', dp[nums.length - 1], 'ok']] });
  return { best: dp[nums.length - 1] as number, steps };
}

export function coinChange(coins: number[], amount: number) {
  const dp: Val[] = Array(amount + 1).fill('∞');
  dp[0] = 0;
  const steps: Step[] = [{ note: 'dp[a] = fewest coins that make a. Build it up from 0.', arr: dp.map((_, i) => i), arrLabel: 'amount', arr2: { label: 'coins', vals: [...dp] }, rows: [['coins', coins.join(',')]] }];
  for (let a = 1; a <= amount; a++) {
    let best = Infinity;
    let from = -1;
    for (const c of coins) if (c <= a && dp[a - c] !== '∞' && (dp[a - c] as number) + 1 < best) (best = (dp[a - c] as number) + 1), (from = a - c);
    if (best < Infinity) dp[a] = best;
    steps.push({ note: best < Infinity ? `dp[${a}] = dp[${from}] + 1 = ${best}: add one coin of ${a - from}.` : `No coin combination reaches ${a}.`, arr: dp.map((_, i) => i), arrLabel: 'amount', ptrs: { a }, arr2: { label: 'coins', vals: [...dp], tones: { [a]: best < Infinity ? 'ok' : 'fail', ...(from >= 0 ? { [from]: 'read' as Tone } : {}) } } });
  }
  const res = dp[amount] === '∞' ? -1 : (dp[amount] as number);
  return { coins: res, steps };
}

export function lcs(a: string, b: string) {
  const R = a.length;
  const C = b.length;
  const dp: number[][] = Array.from({ length: R + 1 }, () => Array(C + 1).fill(0));
  const cells = (): Val[][] => dp.map((r) => r.map((v) => v));
  const steps: Step[] = [];
  for (let i = 1; i <= R; i++)
    for (let j = 1; j <= C; j++) {
      const same = a[i - 1] === b[j - 1];
      dp[i][j] = same ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
      const tones: Record<string, Tone> = { [`${i},${j}`]: same ? 'ok' : 'current' };
      if (same) tones[`${i - 1},${j - 1}`] = 'read';
      else (tones[`${i - 1},${j}`] = 'read'), (tones[`${i},${j - 1}`] = 'read');
      steps.push({ note: same ? `'${a[i - 1]}' matches: diagonal + 1 = ${dp[i][j]}.` : `'${a[i - 1]}' ≠ '${b[j - 1]}': take the better of up and left, ${dp[i][j]}.`, grid: { cells: cells(), tones, colHead: ['', ...b], rowHead: ['', ...a] }, rows: [['LCS so far', dp[i][j]]] });
    }
  steps.push({ note: `LCS length = dp[${R}][${C}] = ${dp[R][C]}.`, grid: { cells: cells(), tones: { [`${R},${C}`]: 'ok' }, colHead: ['', ...b], rowHead: ['', ...a] }, rows: [['LCS', dp[R][C], 'ok']] });
  return { len: dp[R][C], steps };
}

export function canPartition(nums: number[]) {
  const total = nums.reduce((x, y) => x + y, 0);
  const steps: Step[] = [];
  if (total % 2) return { ok: false, steps: [{ note: 'Odd total: impossible.', arr: nums }] as Step[] };
  const t = total / 2;
  const dp: boolean[] = Array(t + 1).fill(false);
  dp[0] = true;
  const row = (hl: Record<number, Tone> = {}) => ({ label: 'reachable', vals: dp.map((v) => (v ? 'T' : '')), tones: hl });
  steps.push({ note: `Can some subset sum to half of ${total}, ${t}? dp[s] = sum s is reachable.`, arr: nums, arrLabel: 'nums', arr2: row({ 0: 'ok' }) });
  nums.forEach((x, i) => {
    const hl: Record<number, Tone> = {};
    for (let s = t; s >= x; s--)
      if (dp[s - x] && !dp[s]) {
        dp[s] = true;
        hl[s] = 'ok';
      }
    steps.push({ note: `Use ${x} (0/1 knapsack): loop sums downward so ${x} is used at most once.`, arr: nums, arrLabel: 'nums', ptrs: { i }, arr2: row(hl), rows: [['target', t], ['reachable', dp[t] ? 'yes' : 'not yet', dp[t] ? 'ok' : undefined]] });
  });
  return { ok: dp[t], steps };
}

patternDemo('algo-dp', 'lc-dp', 'Dynamic programming', 'Define a state, write the recurrence from smaller states, fill a table in dependency order.', [
  { id: 'stairs', label: 'LC 70 Stairs', problem: 'LC 70 · Climbing Stairs', input: 'n = 7', detail: D('1D DP', 'dp[i] depends on the last two states, so two variables suffice.', 'a, b = 1, 1\nfor _ in range(n - 1):\n    a, b = b, a + b\nreturn b'), steps: () => climbStairs(7).steps },
  { id: 'rob', label: 'LC 198 House robber', problem: 'LC 198 · House Robber', input: 'nums = [2,7,9,3,1,4]', detail: D('Take or skip', 'best[i] = max(best[i−1], nums[i] + best[i−2]).', 'prev, cur = 0, 0\nfor x in nums:\n    prev, cur = cur, max(cur, prev + x)\nreturn cur'), steps: () => rob([2, 7, 9, 3, 1, 4]).steps },
  { id: 'coins', label: 'LC 322 Coin change', problem: 'LC 322 · Coin Change', input: 'coins = [1,3,4], amount = 6', detail: D('Unbounded knapsack', 'Greedy fails here (4+1+1); DP tries every last coin.', 'dp = [0] + [inf] * amount\nfor a in range(1, amount + 1):\n    for c in coins:\n        if c <= a:\n            dp[a] = min(dp[a], dp[a - c] + 1)\nreturn dp[amount] if dp[amount] < inf else -1'), steps: () => coinChange([1, 3, 4], 6).steps },
  { id: 'lcs', label: 'LC 1143 LCS', problem: 'LC 1143 · Longest Common Subsequence', input: 'text1 = "ABCBD", text2 = "BDCB"', detail: D('2D DP over two strings', 'Match → diagonal + 1; otherwise the max of up and left.', 'dp = [[0] * (m + 1) for _ in range(n + 1)]\nfor i in range(1, n + 1):\n    for j in range(1, m + 1):\n        if a[i-1] == b[j-1]:\n            dp[i][j] = dp[i-1][j-1] + 1\n        else:\n            dp[i][j] = max(dp[i-1][j], dp[i][j-1])\nreturn dp[n][m]'), steps: () => lcs('ABCBD', 'BDCB').steps },
  { id: 'knap', label: 'LC 416 Partition', problem: 'LC 416 · Partition Equal Subset Sum', input: 'nums = [1,5,11,5]', detail: D('0/1 knapsack in one row', 'Iterate sums from high to low so each item is used at most once.', 'total = sum(nums)\nif total % 2: return False\nt = total // 2\ndp = [True] + [False] * t\nfor x in nums:\n    for s in range(t, x - 1, -1):\n        dp[s] = dp[s] or dp[s - x]\nreturn dp[t]'), steps: () => canPartition([1, 5, 11, 5]).steps },
]);

// ---------------- greedy & intervals ----------------
const ivs = (xs: [number, number][]) => xs.map(([a, b]) => `${a}-${b}`);

export function mergeIntervals(input: [number, number][]) {
  const xs = [...input].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  const steps: Step[] = [{ note: 'Sort by start; then each interval either extends the last merged one or starts a new one.', arr: ivs(xs), arrLabel: 'sorted', lists: [{ label: 'merged', items: [] }] }];
  xs.forEach((iv, i) => {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) {
      last[1] = Math.max(last[1], iv[1]);
      steps.push({ note: `${iv[0]}-${iv[1]} overlaps the last merged interval: extend it to ${last[0]}-${last[1]}.`, arr: ivs(xs), arrLabel: 'sorted', ptrs: { i }, tones: { [i]: 'warn' }, lists: [{ label: 'merged', items: ivs(out), tones: { [out.length - 1]: 'ok' } }] });
    } else {
      out.push([...iv]);
      steps.push({ note: `${iv[0]}-${iv[1]} starts after the last one ends: new interval.`, arr: ivs(xs), arrLabel: 'sorted', ptrs: { i }, tones: { [i]: 'ok' }, lists: [{ label: 'merged', items: ivs(out), tones: { [out.length - 1]: 'ok' } }] });
    }
  });
  return { out, steps };
}

export function eraseOverlap(input: [number, number][]) {
  const xs = [...input].sort((a, b) => a[1] - b[1]);
  let end = -Infinity;
  let removed = 0;
  const steps: Step[] = [{ note: 'Sort by END: keeping the interval that finishes first leaves the most room for the rest.', arr: ivs(xs), arrLabel: 'by end', rows: [['removed', 0]] }];
  const tones: Record<number, Tone> = {};
  xs.forEach((iv, i) => {
    if (iv[0] >= end) {
      end = iv[1];
      tones[i] = 'ok';
      steps.push({ note: `Keep ${iv[0]}-${iv[1]}; the next kept one must start at ${end} or later.`, arr: ivs(xs), arrLabel: 'by end', ptrs: { i }, tones: { ...tones }, rows: [['removed', removed]] });
    } else {
      removed++;
      tones[i] = 'fail';
      steps.push({ note: `${iv[0]}-${iv[1]} starts before ${end}: remove it.`, arr: ivs(xs), arrLabel: 'by end', ptrs: { i }, tones: { ...tones }, rows: [['removed', removed, 'warn']] });
    }
  });
  return { removed, steps };
}

export function canJump(nums: number[]) {
  let reach = 0;
  const steps: Step[] = [];
  for (let i = 0; i < nums.length; i++) {
    if (i > reach) {
      steps.push({ note: `Index ${i} is beyond the furthest reach (${reach}): stuck.`, arr: nums, ptrs: { i }, win: [0, reach], tones: { [i]: 'fail' }, rows: [['reach', reach], ['can reach end', 'no', 'fail']] });
      return { ok: false, steps };
    }
    reach = Math.max(reach, i + nums[i]);
    steps.push({ note: `From ${i} you can jump to ${i + nums[i]}; furthest reach is ${reach}.`, arr: nums, ptrs: { i }, win: [0, Math.min(reach, nums.length - 1)], rows: [['reach', reach]] });
    if (reach >= nums.length - 1) {
      steps.push({ note: 'The last index is within reach.', arr: nums, win: [0, nums.length - 1], tones: { [nums.length - 1]: ok }, rows: [['can reach end', 'yes', 'ok']] });
      return { ok: true, steps };
    }
  }
  return { ok: true, steps };
}

export function meetingRooms(input: [number, number][]) {
  const starts = input.map((x) => x[0]).sort((a, b) => a - b);
  const ends = input.map((x) => x[1]).sort((a, b) => a - b);
  let e = 0;
  let rooms = 0;
  let best = 0;
  const steps: Step[] = [{ note: 'Sweep sorted start and end times: a start needs a room unless a meeting already ended.', arr: starts, arrLabel: 'starts', arr2: { label: 'ends', vals: ends }, rows: [['rooms', 0]] }];
  starts.forEach((s, i) => {
    if (s >= ends[e]) {
      e++;
      steps.push({ note: `A meeting ended at ${ends[e - 1]} ≤ ${s}: reuse its room.`, arr: starts, arrLabel: 'starts', ptrs: { s: i }, arr2: { label: 'ends', vals: ends, tones: { [e - 1]: 'ok' } }, rows: [['rooms in use', rooms], ['max', best]] });
    } else {
      rooms++;
      best = Math.max(best, rooms);
      steps.push({ note: `Starts at ${s} before the earliest end (${ends[e]}): open a room.`, arr: starts, arrLabel: 'starts', ptrs: { s: i }, arr2: { label: 'ends', vals: ends, tones: { [e]: 'warn' } }, rows: [['rooms in use', rooms], ['max', best, 'ok']] });
    }
  });
  return { rooms: best, steps };
}

patternDemo('algo-greedy', 'lc-greedy', 'Greedy & intervals', 'Make the locally best choice when an exchange argument proves it safe; sort intervals by start to merge, by end to schedule.', [
  { id: 'merge', label: 'LC 56 Merge', problem: 'LC 56 · Merge Intervals', input: '[1,3] [8,10] [2,6] [15,18] [9,12]', detail: D('Sort by start', 'After sorting, overlaps are always with the last merged interval.', 'out = []\nfor s, e in sorted(iv):\n    if out and s <= out[-1][1]:\n        out[-1][1] = max(out[-1][1], e)\n    else:\n        out.append([s, e])\nreturn out'), steps: () => mergeIntervals([[1, 3], [8, 10], [2, 6], [15, 18], [9, 12]]).steps },
  { id: 'erase', label: 'LC 435 Non-overlap', problem: 'LC 435 · Non-overlapping Intervals', input: '[1,2] [2,3] [3,4] [1,3] [2,5]', detail: D('Earliest end first', 'The classic activity-selection greedy: keep the interval that ends first.', 'end, removed = -inf, 0\nfor s, e in sorted(iv, key=lambda x: x[1]):\n    if s >= end:\n        end = e\n    else:\n        removed += 1\nreturn removed'), steps: () => eraseOverlap([[1, 2], [2, 3], [3, 4], [1, 3], [2, 5]]).steps },
  { id: 'jump', label: 'LC 55 Jump game', problem: 'LC 55 · Jump Game', input: 'nums = [2,3,1,1,4], then [3,2,1,0,4]', detail: D('Furthest reach', 'Track the furthest index reachable so far; fail if you ever step past it.', 'reach = 0\nfor i, x in enumerate(nums):\n    if i > reach:\n        return False\n    reach = max(reach, i + x)\nreturn True'), steps: () => [...canJump([2, 3, 1, 1, 4]).steps, ...canJump([3, 2, 1, 0, 4]).steps] },
  { id: 'rooms', label: 'LC 253 Rooms', problem: 'LC 253 · Meeting Rooms II', input: '[0,30] [5,10] [15,20] [10,25]', detail: D('Sweep line', 'Two sorted lists (or a min-heap of end times): the peak overlap is the room count.', 'starts = sorted(s for s, _ in iv)\nends = sorted(e for _, e in iv)\nrooms = best = j = 0\nfor s in starts:\n    if s >= ends[j]:\n        j += 1\n    else:\n        rooms += 1\n        best = max(best, rooms)\nreturn best'), steps: () => meetingRooms([[0, 30], [5, 10], [15, 20], [10, 25]]).steps },
]);

// ---------------- math & number theory ----------------
export function sieve(n: number) {
  const prime = Array(n).fill(true);
  prime[0] = prime[1] = false;
  const vals = Array.from({ length: n }, (_, i) => i);
  const tones = (): Record<number, Tone> => Object.fromEntries(vals.map((i) => [i, prime[i] ? 'ok' : 'visited']));
  const steps: Step[] = [{ note: `Assume every number below ${n} is prime, then cross out multiples.`, arr: vals, tones: tones() }];
  for (let p = 2; p * p < n; p++) {
    if (!prime[p]) continue;
    for (let m = p * p; m < n; m += p) prime[m] = false;
    steps.push({ note: `${p} is prime: cross out ${p * p}, ${p * p + p}, … (smaller multiples were already crossed).`, arr: vals, ptrs: { p }, tones: tones(), rows: [['primes left', prime.filter(Boolean).length]] });
  }
  const count = prime.filter(Boolean).length;
  steps.push({ note: `Stop once p² ≥ ${n}: ${count} primes remain.`, arr: vals, tones: tones(), rows: [['count', count, 'ok']] });
  return { count, steps };
}

export function fastPow(x: number, n: number) {
  let result = 1;
  let base = x;
  let e = n;
  const steps: Step[] = [{ note: `x^${n}: square the base and halve the exponent; multiply into the result on odd bits.`, arr: n.toString(2).split(''), arrLabel: `${n} in binary`, rows: [['result', 1], ['base', base]] }];
  let bit = n.toString(2).length - 1;
  while (e > 0) {
    const odd = e & 1;
    if (odd) result *= base;
    steps.push({ note: `Exponent ${e} is ${odd ? `odd: result × ${base} = ${result}` : 'even: skip'}; then base² and exponent ÷ 2.`, arr: n.toString(2).split(''), arrLabel: `${n} in binary`, ptrs: { bit }, tones: { [bit]: odd ? 'ok' : 'visited' }, rows: [['result', result], ['base', base], ['exp', e]] });
    base *= base;
    e >>= 1;
    bit--;
  }
  steps.push({ note: `${x}^${n} = ${result} in ${n.toString(2).length} squarings instead of ${n - 1} multiplications.`, arr: n.toString(2).split(''), arrLabel: `${n} in binary`, rows: [['result', result, 'ok']] });
  return { value: result, steps };
}

export function gcdSteps(a0: number, b0: number) {
  let a = a0;
  let b = b0;
  const pairs: string[] = [];
  const steps: Step[] = [];
  while (b) {
    pairs.push(`${a},${b}`);
    steps.push({ note: `gcd(${a}, ${b}) = gcd(${b}, ${a} mod ${b} = ${a % b}).`, lists: [{ label: '(a, b)', items: [...pairs] }], rows: [['a', a], ['b', b]] });
    [a, b] = [b, a % b];
  }
  pairs.push(`${a},0`);
  steps.push({ note: `b hit 0, so gcd = ${a}; lcm = ${a0} × ${b0} / ${a} = ${(a0 * b0) / a}.`, lists: [{ label: '(a, b)', items: pairs }], rows: [['gcd', a, 'ok'], ['lcm', (a0 * b0) / a]] });
  return { gcd: a, steps };
}

export function trailingZeroes(n: number) {
  let k = 5;
  let z = 0;
  const parts: string[] = [];
  const steps: Step[] = [{ note: `Zeros come from 2×5 pairs, and 5s are rarer: count factors of 5 in ${n}!.`, rows: [['n', n]] }];
  while (k <= n) {
    z += Math.floor(n / k);
    parts.push(`${n}/${k}=${Math.floor(n / k)}`);
    steps.push({ note: `Multiples of ${k} add ${Math.floor(n / k)} more five(s).`, lists: [{ label: 'terms', items: [...parts] }], rows: [['zeros', z]] });
    k *= 5;
  }
  steps.push({ note: `${n}! ends in ${z} zeros.`, lists: [{ label: 'terms', items: parts }], rows: [['zeros', z, 'ok']] });
  return { zeros: z, steps };
}

patternDemo('algo-math', 'lc-math', 'Math & number theory', 'Sieve, fast exponentiation, Euclid’s GCD and counting factors. For bit tricks see Machine level → Bit manipulation.', [
  { id: 'sieve', label: 'LC 204 Count primes', problem: 'LC 204 · Count Primes', input: 'n = 20', detail: D('Sieve of Eratosthenes', 'O(n log log n): cross out multiples of each prime starting from p².', 'is_p = [True] * n\nis_p[0:2] = [False, False]\nfor p in range(2, int(n ** 0.5) + 1):\n    if is_p[p]:\n        is_p[p*p::p] = [False] * len(is_p[p*p::p])\nreturn sum(is_p)'), steps: () => sieve(20).steps },
  { id: 'pow', label: 'LC 50 Pow(x, n)', problem: 'LC 50 · Pow(x, n)', input: 'x = 3, n = 13', detail: D('Exponentiation by squaring', 'Walk the exponent’s bits: O(log n) multiplications.', 'def pow(x, n):\n    if n < 0: x, n = 1 / x, -n\n    res = 1\n    while n:\n        if n & 1: res *= x\n        x *= x\n        n >>= 1\n    return res'), steps: () => fastPow(3, 13).steps },
  { id: 'gcd', label: 'LC 1979 GCD', problem: 'LC 1979 · GCD of Array (Euclid)', input: 'gcd(84, 36)', detail: D("Euclid's algorithm", 'gcd(a, b) = gcd(b, a mod b); lcm = a·b / gcd.', 'def gcd(a, b):\n    while b:\n        a, b = b, a % b\n    return a'), steps: () => gcdSteps(84, 36).steps },
  { id: 'zeros', label: 'LC 172 Zeros', problem: 'LC 172 · Factorial Trailing Zeroes', input: 'n = 130', detail: D('Count factors of 5', 'n/5 + n/25 + n/125 + …', 'z = 0\nwhile n:\n    n //= 5\n    z += n\nreturn z'), steps: () => trailingZeroes(130).steps },
]);
