// Array patterns: two pointers, sliding window, binary search, prefix sums & hashing.
import type { Tone } from '../algo/frames';
import { D, ok, patternDemo, type Step } from './lib';

// ---------------- two pointers ----------------
export function twoSumSorted(nums: number[], target: number) {
  const steps: Step[] = [];
  let l = 0;
  let r = nums.length - 1;
  steps.push({ note: `Sorted input, so start with the smallest and largest values.`, arr: nums, ptrs: { l, r }, rows: [['target', target]] });
  while (l < r) {
    const s = nums[l] + nums[r];
    if (s === target) {
      steps.push({ note: `${nums[l]} + ${nums[r]} = ${s}, found it: indices ${l + 1} and ${r + 1} (1-based).`, arr: nums, ptrs: { l, r }, tones: { [l]: ok, [r]: ok }, rows: [['sum', s, 'ok'], ['target', target]] });
      return { pair: [l, r] as [number, number], steps };
    }
    const move = s < target ? 'l' : 'r';
    steps.push({ note: `${nums[l]} + ${nums[r]} = ${s} is too ${s < target ? 'small, so move l right' : 'big, so move r left'}.`, arr: nums, ptrs: { l, r }, tones: { [move === 'l' ? l : r]: 'warn' }, rows: [['sum', s], ['target', target]] });
    if (s < target) l++;
    else r--;
  }
  steps.push({ note: 'The pointers met: no pair adds up to the target.', arr: nums, rows: [['target', target]] });
  return { pair: null, steps };
}

export function maxArea(h: number[]) {
  const steps: Step[] = [];
  let l = 0;
  let r = h.length - 1;
  let best = 0;
  steps.push({ note: 'Start at both ends: the widest container.', arr: h, arrLabel: 'heights', ptrs: { l, r }, rows: [['best', 0]] });
  while (l < r) {
    const area = Math.min(h[l], h[r]) * (r - l);
    const better = area > best;
    best = Math.max(best, area);
    const low = h[l] <= h[r] ? l : r;
    steps.push({ note: `min(${h[l]}, ${h[r]}) × ${r - l} = ${area}${better ? ', a new best' : ''}. Move the shorter wall: the taller one can never do better with less width.`, arr: h, arrLabel: 'heights', ptrs: { l, r }, win: [l, r], tones: { [low]: 'warn' }, rows: [['area', area, better ? 'ok' : undefined], ['best', best]] });
    if (h[l] <= h[r]) l++;
    else r--;
  }
  steps.push({ note: `Done in one pass: the best container holds ${best}.`, arr: h, arrLabel: 'heights', rows: [['best', best, 'ok']] });
  return { best, steps };
}

export function threeSum(input: number[]) {
  const nums = [...input].sort((a, b) => a - b);
  const steps: Step[] = [{ note: 'Sort first, then fix one number and two-pointer the rest.', arr: nums, rows: [['found', 0]] }];
  const out: number[][] = [];
  for (let i = 0; i < nums.length - 2; i++) {
    if (i > 0 && nums[i] === nums[i - 1]) {
      steps.push({ note: `nums[${i}] = ${nums[i]} repeats the previous value, so skip it to avoid duplicates.`, arr: nums, ptrs: { i }, tones: { [i]: 'visited' }, rows: [['found', out.length]] });
      continue;
    }
    let l = i + 1;
    let r = nums.length - 1;
    while (l < r) {
      const s = nums[i] + nums[l] + nums[r];
      if (s === 0) {
        out.push([nums[i], nums[l], nums[r]]);
        steps.push({ note: `${nums[i]} + ${nums[l]} + ${nums[r]} = 0, record it and move both pointers past duplicates.`, arr: nums, ptrs: { i, l, r }, tones: { [i]: ok, [l]: ok, [r]: ok }, rows: [['found', out.length, 'ok']] });
        l++;
        r--;
        while (l < r && nums[l] === nums[l - 1]) l++;
        while (l < r && nums[r] === nums[r + 1]) r--;
      } else {
        steps.push({ note: `Sum ${s} is ${s < 0 ? 'below 0, so l moves right' : 'above 0, so r moves left'}.`, arr: nums, ptrs: { i, l, r }, tones: { [i]: 'current' }, rows: [['sum', s], ['found', out.length]] });
        if (s < 0) l++;
        else r--;
      }
    }
  }
  steps.push({ note: `${out.length} unique triplet(s): ${out.map((t) => `[${t.join(',')}]`).join(' ')}.`, arr: nums, rows: [['found', out.length, 'ok']] });
  return { triplets: out, steps };
}

export function trap(h: number[]) {
  const steps: Step[] = [];
  let l = 0;
  let r = h.length - 1;
  let lmax = 0;
  let rmax = 0;
  let water = 0;
  const filled: number[] = h.map(() => 0);
  const row = () => ({ label: 'water', vals: filled.map((w) => (w ? w : '')) });
  steps.push({ note: 'Water above a bar = min(tallest left, tallest right) − its height. Two pointers track both maxima.', arr: h, arrLabel: 'heights', ptrs: { l, r }, arr2: row(), rows: [['water', 0]] });
  while (l < r) {
    if (h[l] < h[r]) {
      lmax = Math.max(lmax, h[l]);
      filled[l] = lmax - h[l];
      water += filled[l];
      steps.push({ note: `The right side is taller, so the left max (${lmax}) bounds bar ${l}: it holds ${filled[l]}.`, arr: h, arrLabel: 'heights', ptrs: { l, r }, tones: { [l]: 'current' }, arr2: row(), rows: [['lmax', lmax], ['rmax', rmax], ['water', water]] });
      l++;
    } else {
      rmax = Math.max(rmax, h[r]);
      filled[r] = rmax - h[r];
      water += filled[r];
      steps.push({ note: `The left side is at least as tall, so the right max (${rmax}) bounds bar ${r}: it holds ${filled[r]}.`, arr: h, arrLabel: 'heights', ptrs: { l, r }, tones: { [r]: 'current' }, arr2: row(), rows: [['lmax', lmax], ['rmax', rmax], ['water', water]] });
      r--;
    }
  }
  steps.push({ note: `Total trapped water: ${water}.`, arr: h, arrLabel: 'heights', arr2: row(), rows: [['water', water, 'ok']] });
  return { water, steps };
}

const TWO_PTR = `l, r = 0, len(a) - 1
while l < r:
    s = a[l] + a[r]
    if s == target:
        return [l, r]
    if s < target:
        l += 1
    else:
        r -= 1`;

patternDemo('algo-two-pointers', 'lc-two-pointers', 'Two pointers', 'Two indices walk toward each other (or in step) over a sorted or linear structure: O(n) instead of O(n²).', [
  { id: 'twosum', label: 'LC 167 Two Sum II', problem: 'LC 167 · Two Sum II (sorted)', input: 'a = [1,3,4,6,8,11], target = 10', detail: D('Opposite-end pointers', 'On sorted input the sum moves predictably: move l to grow it, r to shrink it. Each step discards one index for good.', TWO_PTR), steps: () => twoSumSorted([1, 3, 4, 6, 8, 11], 10).steps },
  { id: 'water', label: 'LC 11 Container', problem: 'LC 11 · Container With Most Water', input: 'height = [1,8,6,2,5,4,8,3,7]', detail: D('Greedy two pointers', 'Always move the shorter wall: keeping it can only lose width without gaining height.', 'l, r, best = 0, len(h) - 1, 0\nwhile l < r:\n    best = max(best, min(h[l], h[r]) * (r - l))\n    if h[l] <= h[r]:\n        l += 1\n    else:\n        r -= 1\nreturn best'), steps: () => maxArea([1, 8, 6, 2, 5, 4, 8, 3, 7]).steps },
  { id: '3sum', label: 'LC 15 3Sum', problem: 'LC 15 · 3Sum', input: 'nums = [-1,0,1,2,-1,-4]', detail: D('Fix one, two-pointer the rest', 'Sort, loop i, then run the two-pointer pair search on the suffix. Skip equal neighbours to avoid duplicate triplets.', 'nums.sort()\nfor i in range(len(nums) - 2):\n    if i and nums[i] == nums[i-1]:\n        continue\n    l, r = i + 1, len(nums) - 1\n    while l < r:\n        s = nums[i] + nums[l] + nums[r]\n        if s == 0:\n            res.append([nums[i], nums[l], nums[r]])\n            l += 1\n            while l < r and nums[l] == nums[l-1]:\n                l += 1\n        elif s < 0: l += 1\n        else: r -= 1'), steps: () => threeSum([-1, 0, 1, 2, -1, -4]).steps },
  { id: 'trap', label: 'LC 42 Rain water', problem: 'LC 42 · Trapping Rain Water', input: 'height = [0,1,0,2,1,0,1,3,2,1,2,1]', detail: D('Two pointers with running maxima', 'The lower side is the bottleneck, so its running max decides the water at that pointer.', 'l, r = 0, len(h) - 1\nlmax = rmax = water = 0\nwhile l < r:\n    if h[l] < h[r]:\n        lmax = max(lmax, h[l])\n        water += lmax - h[l]\n        l += 1\n    else:\n        rmax = max(rmax, h[r])\n        water += rmax - h[r]\n        r -= 1'), steps: () => trap([0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]).steps },
]);

// ---------------- sliding window ----------------
export function longestUnique(s: string) {
  const a = s.split('');
  const steps: Step[] = [];
  const last = new Map<string, number>();
  let l = 0;
  let best = 0;
  let bestAt: [number, number] = [0, -1];
  for (let r = 0; r < a.length; r++) {
    const ch = a[r];
    const seen = last.get(ch);
    if (seen !== undefined && seen >= l) {
      steps.push({ note: `'${ch}' is already in the window at ${seen}, so l jumps to ${seen + 1}.`, arr: a, ptrs: { l, r }, win: [l, r - 1], tones: { [r]: 'fail', [seen]: 'warn' }, lists: [{ label: 'last seen', items: [...last].map(([k, v]) => `${k}:${v}`) }], rows: [['best', best]] });
      l = seen + 1;
    }
    last.set(ch, r);
    if (r - l + 1 > best) {
      best = r - l + 1;
      bestAt = [l, r];
    }
    steps.push({ note: `Window [${l}, ${r}] = "${a.slice(l, r + 1).join('')}" has no repeats, length ${r - l + 1}.`, arr: a, ptrs: { l, r }, win: [l, r], lists: [{ label: 'last seen', items: [...last].map(([k, v]) => `${k}:${v}`) }], rows: [['length', r - l + 1], ['best', best]] });
  }
  steps.push({ note: `Longest: "${a.slice(bestAt[0], bestAt[1] + 1).join('')}", length ${best}.`, arr: a, win: bestAt, rows: [['best', best, 'ok']] });
  return { best, steps };
}

export function minSubLen(target: number, nums: number[]) {
  const steps: Step[] = [];
  let l = 0;
  let sum = 0;
  let best = Infinity;
  for (let r = 0; r < nums.length; r++) {
    sum += nums[r];
    steps.push({ note: `Grow: add ${nums[r]}, window sum ${sum}.`, arr: nums, ptrs: { l, r }, win: [l, r], rows: [['sum', sum], ['target', target], ['best', best === Infinity ? '—' : best]] });
    while (sum >= target) {
      best = Math.min(best, r - l + 1);
      steps.push({ note: `Sum ${sum} ≥ ${target}: length ${r - l + 1} works, now shrink from the left.`, arr: nums, ptrs: { l, r }, win: [l, r], tones: { [l]: 'warn' }, rows: [['sum', sum, 'ok'], ['best', best, 'ok']] });
      sum -= nums[l++];
    }
  }
  const res = best === Infinity ? 0 : best;
  steps.push({ note: `Shortest window with sum ≥ ${target}: ${res}.`, arr: nums, rows: [['best', res, 'ok']] });
  return { best: res, steps };
}

export function minWindow(s: string, t: string) {
  const a = s.split('');
  const need = new Map<string, number>();
  for (const c of t) need.set(c, (need.get(c) ?? 0) + 1);
  let missing = t.length;
  let l = 0;
  let best: [number, number] = [0, -1];
  const steps: Step[] = [];
  const needList = () => [...need].map(([k, v]) => `${k}:${v}`);
  for (let r = 0; r < a.length; r++) {
    const c = a[r];
    if ((need.get(c) ?? 0) > 0) missing--;
    need.set(c, (need.get(c) ?? 0) - 1);
    if (missing > 0) {
      steps.push({ note: `Take '${c}'. Still missing ${missing} character(s) of "${t}".`, arr: a, ptrs: { l, r }, win: [l, r], lists: [{ label: 'need', items: needList() }], rows: [['missing', missing]] });
      continue;
    }
    while ((need.get(a[l]) ?? 0) < 0) {
      need.set(a[l], need.get(a[l])! + 1);
      l++;
    }
    if (best[1] < 0 || r - l < best[1] - best[0]) best = [l, r];
    steps.push({ note: `All of "${t}" covered by "${a.slice(l, r + 1).join('')}"; shrink l past extras, then drop one needed char to keep searching.`, arr: a, ptrs: { l, r }, win: [l, r], tones: { [l]: 'warn' }, lists: [{ label: 'need', items: needList() }], rows: [['window', r - l + 1, 'ok'], ['best', best[1] - best[0] + 1]] });
    need.set(a[l], need.get(a[l])! + 1);
    missing++;
    l++;
  }
  const res = best[1] < 0 ? '' : a.slice(best[0], best[1] + 1).join('');
  steps.push({ note: `Minimum window: "${res}".`, arr: a, win: best[1] < 0 ? undefined : best, rows: [['answer', res || '—', 'ok']] });
  return { window: res, steps };
}

export function windowMax(nums: number[], k: number) {
  const dq: number[] = [];
  const out: number[] = [];
  const steps: Step[] = [];
  for (let i = 0; i < nums.length; i++) {
    while (dq.length && dq[0] <= i - k) dq.shift();
    while (dq.length && nums[dq[dq.length - 1]] <= nums[i]) dq.pop();
    dq.push(i);
    if (i >= k - 1) out.push(nums[dq[0]]);
    steps.push({ note: i >= k - 1 ? `Window [${i - k + 1}, ${i}]: the deque front holds the max, ${nums[dq[0]]}.` : `Filling the first window; smaller values behind ${nums[i]} are popped.`, arr: nums, ptrs: { i }, win: [Math.max(0, i - k + 1), i], tones: { [dq[0]]: 'ok' }, lists: [{ label: 'deque (idx)', items: dq.map((d) => `${d}:${nums[d]}`) }, { label: 'maxes', items: out }], rows: [['k', k]] });
  }
  return { out, steps };
}

const WINDOW = `l = 0
for r, x in enumerate(a):
    add(x)                 # grow right
    while invalid():
        remove(a[l])       # shrink left
        l += 1
    best = max(best, r - l + 1)`;

patternDemo('algo-sliding-window', 'lc-sliding-window', 'Sliding window', 'A window [l, r] grows on the right and shrinks on the left, keeping a running summary so each element enters and leaves once.', [
  { id: 'unique', label: 'LC 3 No repeats', problem: 'LC 3 · Longest Substring Without Repeating', input: 's = "abcabcbb"', detail: D('Variable window + last-seen map', 'On a repeat, jump l past the previous occurrence instead of stepping one by one.', 'last, l, best = {}, 0, 0\nfor r, ch in enumerate(s):\n    if last.get(ch, -1) >= l:\n        l = last[ch] + 1\n    last[ch] = r\n    best = max(best, r - l + 1)\nreturn best'), steps: () => longestUnique('abcabcbb').steps },
  { id: 'minlen', label: 'LC 209 Min length', problem: 'LC 209 · Minimum Size Subarray Sum', input: 'target = 7, nums = [2,3,1,2,4,3]', detail: D('Shrink while valid', 'Positive numbers make the sum monotonic, so shrinking while sum ≥ target finds every minimal window.', WINDOW), steps: () => minSubLen(7, [2, 3, 1, 2, 4, 3]).steps },
  { id: 'minwin', label: 'LC 76 Min window', problem: 'LC 76 · Minimum Window Substring', input: 's = "ADOBECODEBANC", t = "ABC"', detail: D('Counts + missing counter', 'need[c] goes negative for extras; missing hits 0 when the window covers t.', 'need = Counter(t); missing = len(t)\nl = start = 0; end = -1\nfor r, c in enumerate(s):\n    if need[c] > 0: missing -= 1\n    need[c] -= 1\n    if missing == 0:\n        while need[s[l]] < 0:\n            need[s[l]] += 1; l += 1\n        if end < 0 or r - l < end - start:\n            start, end = l, r\n        need[s[l]] += 1; missing += 1; l += 1'), steps: () => minWindow('ADOBECODEBANC', 'ABC').steps },
  { id: 'max', label: 'LC 239 Window max', problem: 'LC 239 · Sliding Window Maximum', input: 'nums = [1,3,-1,-3,5,3,6,7], k = 3', detail: D('Monotonic deque', 'Keep indices with decreasing values; the front is the window max, expired fronts are dropped.', 'dq, out = deque(), []\nfor i, x in enumerate(nums):\n    if dq and dq[0] <= i - k:\n        dq.popleft()\n    while dq and nums[dq[-1]] <= x:\n        dq.pop()\n    dq.append(i)\n    if i >= k - 1:\n        out.append(nums[dq[0]])'), steps: () => windowMax([1, 3, -1, -3, 5, 3, 6, 7], 3).steps },
]);

// ---------------- binary search ----------------
export function binarySearch(nums: number[], target: number) {
  const steps: Step[] = [];
  let lo = 0;
  let hi = nums.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (nums[mid] === target) {
      steps.push({ note: `nums[${mid}] = ${target}, found.`, arr: nums, ptrs: { lo, mid, hi }, win: [lo, hi], tones: { [mid]: ok }, rows: [['target', target]] });
      return { index: mid, steps };
    }
    steps.push({ note: `nums[${mid}] = ${nums[mid]} is ${nums[mid] < target ? 'too small: discard the left half' : 'too big: discard the right half'}.`, arr: nums, ptrs: { lo, mid, hi }, win: [lo, hi], tones: { [mid]: 'warn' }, rows: [['target', target], ['range', hi - lo + 1]] });
    if (nums[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  steps.push({ note: 'lo passed hi: the target is not present.', arr: nums, rows: [['target', target]] });
  return { index: -1, steps };
}

/** first index with nums[i] >= target */
export function lowerBound(nums: number[], target: number, steps: Step[], tag: string) {
  let lo = 0;
  let hi = nums.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const right = nums[mid] >= target;
    steps.push({ note: `${tag}: nums[${mid}] = ${nums[mid]} ${right ? `≥ ${target}, so the answer is at mid or left` : `< ${target}, so it is right of mid`}.`, arr: nums, ptrs: { lo, mid, ...(hi < nums.length ? { hi } : {}) }, win: [lo, Math.min(hi, nums.length) - 1], tones: { [mid]: right ? 'ok' : 'warn' }, rows: [['target', target]] });
    if (right) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function searchRange(nums: number[], target: number) {
  const steps: Step[] = [{ note: 'Two lower-bound searches: the first target, and the first value past it.', arr: nums, rows: [['target', target]] }];
  const a = lowerBound(nums, target, steps, 'first');
  const b = lowerBound(nums, target + 1, steps, 'end') - 1;
  const res: [number, number] = a < nums.length && nums[a] === target ? [a, b] : [-1, -1];
  steps.push({ note: `Range: [${res[0]}, ${res[1]}].`, arr: nums, win: res[0] >= 0 ? res : undefined, rows: [['answer', `[${res.join(', ')}]`, 'ok']] });
  return { range: res, steps };
}

export function searchRotated(nums: number[], target: number) {
  const steps: Step[] = [];
  let lo = 0;
  let hi = nums.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (nums[mid] === target) {
      steps.push({ note: `nums[${mid}] = ${target}, found.`, arr: nums, ptrs: { lo, mid, hi }, win: [lo, hi], tones: { [mid]: ok }, rows: [['target', target]] });
      return { index: mid, steps };
    }
    const leftSorted = nums[lo] <= nums[mid];
    const inLeft = leftSorted ? nums[lo] <= target && target < nums[mid] : !(nums[mid] < target && target <= nums[hi]);
    steps.push({ note: `The ${leftSorted ? 'left' : 'right'} half is sorted; the target ${inLeft ? 'lies in the left half' : 'lies in the right half'}.`, arr: nums, ptrs: { lo, mid, hi }, win: [lo, hi], tones: { [mid]: 'warn' }, rows: [['target', target]] });
    if (inLeft) hi = mid - 1;
    else lo = mid + 1;
  }
  steps.push({ note: 'Not present.', arr: nums, rows: [['target', target]] });
  return { index: -1, steps };
}

export function minEatingSpeed(piles: number[], h: number) {
  const steps: Step[] = [];
  let lo = 1;
  let hi = Math.max(...piles);
  const hours = (k: number) => piles.reduce((a, p) => a + Math.ceil(p / k), 0);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const t = hours(mid);
    steps.push({ note: `Try speed ${mid}: ${t} hours ${t <= h ? `≤ ${h}, so ${mid} works; look slower` : `> ${h}, too slow; look faster`}.`, arr: piles, arrLabel: 'piles', arr2: { label: `hours at k=${mid}`, vals: piles.map((p) => Math.ceil(p / mid)) }, rows: [['lo', lo], ['mid', mid, t <= h ? 'ok' : 'warn'], ['hi', hi], ['hours', t]] });
    if (t <= h) hi = mid;
    else lo = mid + 1;
  }
  steps.push({ note: `The smallest speed that finishes in ${h} hours is ${lo}.`, arr: piles, arrLabel: 'piles', arr2: { label: `hours at k=${lo}`, vals: piles.map((p) => Math.ceil(p / lo)) }, rows: [['answer', lo, 'ok']] });
  return { k: lo, steps };
}

patternDemo('algo-binary-search', 'lc-binary-search', 'Binary search', 'Halve a sorted range, or a monotonic answer space, every step: O(log n).', [
  { id: 'basic', label: 'LC 704 Search', problem: 'LC 704 · Binary Search', input: 'nums = [-1,0,3,5,9,12,15], target = 9', detail: D('Closed interval [lo, hi]', 'Loop while lo ≤ hi; mid = (lo + hi) // 2; discard the half that cannot hold the target.', 'lo, hi = 0, len(nums) - 1\nwhile lo <= hi:\n    mid = (lo + hi) // 2\n    if nums[mid] == target:\n        return mid\n    if nums[mid] < target:\n        lo = mid + 1\n    else:\n        hi = mid - 1\nreturn -1'), steps: () => binarySearch([-1, 0, 3, 5, 9, 12, 15], 9).steps },
  { id: 'range', label: 'LC 34 First & last', problem: 'LC 34 · First and Last Position', input: 'nums = [5,7,7,8,8,8,10], target = 8', detail: D('Lower bound', 'Half-open [lo, hi): find the first index where the predicate turns true. bisect_left in Python.', 'def lower_bound(a, x):\n    lo, hi = 0, len(a)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if a[mid] >= x:\n            hi = mid\n        else:\n            lo = mid + 1\n    return lo\n# [lower_bound(a,t), lower_bound(a,t+1)-1]'), steps: () => searchRange([5, 7, 7, 8, 8, 8, 10], 8).steps },
  { id: 'rotated', label: 'LC 33 Rotated', problem: 'LC 33 · Search in Rotated Sorted Array', input: 'nums = [4,5,6,7,0,1,2], target = 0', detail: D('One half is always sorted', 'Check which half is sorted, then whether the target falls inside it.', 'lo, hi = 0, len(a) - 1\nwhile lo <= hi:\n    mid = (lo + hi) // 2\n    if a[mid] == t: return mid\n    if a[lo] <= a[mid]:\n        if a[lo] <= t < a[mid]: hi = mid - 1\n        else: lo = mid + 1\n    else:\n        if a[mid] < t <= a[hi]: lo = mid + 1\n        else: hi = mid - 1\nreturn -1'), steps: () => searchRotated([4, 5, 6, 7, 0, 1, 2], 0).steps },
  { id: 'answer', label: 'LC 875 Koko', problem: 'LC 875 · Koko Eating Bananas', input: 'piles = [3,6,7,11], h = 8', detail: D('Binary search on the answer', 'If speed k works, every faster speed works too. That monotonic yes/no lets you binary search k itself.', 'lo, hi = 1, max(piles)\nwhile lo < hi:\n    k = (lo + hi) // 2\n    hours = sum((p + k - 1) // k for p in piles)\n    if hours <= h:\n        hi = k\n    else:\n        lo = k + 1\nreturn lo'), steps: () => minEatingSpeed([3, 6, 7, 11], 8).steps },
]);

// ---------------- prefix sums & hashing ----------------
export function twoSumHash(nums: number[], target: number) {
  const seen = new Map<number, number>();
  const steps: Step[] = [];
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) {
      steps.push({ note: `Need ${need}, and the map has it at ${seen.get(need)}: answer [${seen.get(need)}, ${i}].`, arr: nums, ptrs: { i }, tones: { [i]: ok, [seen.get(need)!]: ok }, lists: [{ label: 'value→idx', items: [...seen].map(([k, v]) => `${k}:${v}`) }], rows: [['need', need, 'ok']] });
      return { pair: [seen.get(need)!, i], steps };
    }
    seen.set(nums[i], i);
    steps.push({ note: `Need ${need}: not seen yet, so remember ${nums[i]} at ${i}.`, arr: nums, ptrs: { i }, lists: [{ label: 'value→idx', items: [...seen].map(([k, v]) => `${k}:${v}`) }], rows: [['need', need]] });
  }
  return { pair: null, steps };
}

export function subarraySum(nums: number[], k: number) {
  const count = new Map<number, number>([[0, 1]]);
  let sum = 0;
  let res = 0;
  const steps: Step[] = [];
  const prefix: (number | string)[] = nums.map(() => '');
  steps.push({ note: `A subarray (i, j] sums to k when prefix[j] − prefix[i] = k. Count earlier prefixes equal to prefix − k.`, arr: nums, arr2: { label: 'prefix', vals: prefix }, lists: [{ label: 'prefix count', items: ['0:1'] }], rows: [['k', k], ['answer', 0]] });
  nums.forEach((x, i) => {
    sum += x;
    prefix[i] = sum;
    const hit = count.get(sum - k) ?? 0;
    res += hit;
    count.set(sum, (count.get(sum) ?? 0) + 1);
    steps.push({ note: `prefix = ${sum}; ${sum} − ${k} = ${sum - k} was seen ${hit} time(s), so ${hit} subarray(s) end here.`, arr: nums, ptrs: { j: i }, arr2: { label: 'prefix', vals: [...prefix], tones: { [i]: hit ? 'ok' : 'current' } }, lists: [{ label: 'prefix count', items: [...count].map(([a, b]) => `${a}:${b}`) }], rows: [['k', k], ['answer', res, hit ? 'ok' : undefined]] });
  });
  return { count: res, steps };
}

export function productExceptSelf(nums: number[]) {
  const n = nums.length;
  const out: (number | string)[] = nums.map(() => '');
  const steps: Step[] = [];
  let acc = 1;
  for (let i = 0; i < n; i++) {
    out[i] = acc;
    steps.push({ note: `Left pass: out[${i}] = product of everything left of ${i} = ${acc}.`, arr: nums, ptrs: { i }, win: i ? [0, i - 1] : undefined, arr2: { label: 'out', vals: [...out], tones: { [i]: 'current' } }, rows: [['left', acc]] });
    acc *= nums[i];
  }
  acc = 1;
  for (let i = n - 1; i >= 0; i--) {
    out[i] = (out[i] as number) * acc;
    steps.push({ note: `Right pass: multiply by everything right of ${i} (${acc}), out[${i}] = ${out[i]}.`, arr: nums, ptrs: { i }, win: i < n - 1 ? [i + 1, n - 1] : undefined, arr2: { label: 'out', vals: [...out], tones: { [i]: 'ok' } }, rows: [['right', acc]] });
    acc *= nums[i];
  }
  return { out: out as number[], steps };
}

export function groupAnagrams(words: string[]) {
  const groups = new Map<string, string[]>();
  const steps: Step[] = [];
  words.forEach((w, i) => {
    const key = [...w].sort().join('');
    groups.set(key, [...(groups.get(key) ?? []), w]);
    steps.push({ note: `"${w}" sorted is "${key}": anagrams share that key.`, arr: words, ptrs: { i }, tones: { [i]: 'current' }, lists: [{ label: 'key→words', items: [...groups].map(([k, v]) => `${k}:${v.length}`) }], rows: [['groups', groups.size]] });
  });
  steps.push({ note: `${groups.size} groups: ${[...groups.values()].map((g) => g.join('/')).join(', ')}.`, arr: words, lists: [{ label: 'key→words', items: [...groups].map(([k, v]) => `${k}:${v.length}`) }], rows: [['groups', groups.size, 'ok']] });
  return { groups: [...groups.values()], steps };
}

patternDemo('algo-prefix-hash', 'lc-prefix-hash', 'Prefix sums & hashing', 'Trade memory for time: a hash map of what you have seen, or running prefix sums, turns nested loops into one pass.', [
  { id: 'twosum', label: 'LC 1 Two Sum', problem: 'LC 1 · Two Sum', input: 'nums = [2,7,11,15], target = 18', detail: D('Complement lookup', 'For each x, ask the map whether target − x was already seen. One pass, O(n).', 'seen = {}\nfor i, x in enumerate(nums):\n    if target - x in seen:\n        return [seen[target - x], i]\n    seen[x] = i'), steps: () => twoSumHash([2, 7, 11, 15], 18).steps },
  { id: 'subarray', label: 'LC 560 Sum = k', problem: 'LC 560 · Subarray Sum Equals K', input: 'nums = [1,2,1,-1,2,1], k = 3', detail: D('Prefix sum + count map', 'Handles negatives, where a sliding window cannot.', 'count = {0: 1}\ns = res = 0\nfor x in nums:\n    s += x\n    res += count.get(s - k, 0)\n    count[s] = count.get(s, 0) + 1\nreturn res'), steps: () => subarraySum([1, 2, 1, -1, 2, 1], 3).steps },
  { id: 'product', label: 'LC 238 Product', problem: 'LC 238 · Product of Array Except Self', input: 'nums = [1,2,3,4]', detail: D('Prefix and suffix products', 'No division: a left-to-right prefix pass, then a right-to-left suffix pass.', 'out = [1] * n\nacc = 1\nfor i in range(n):\n    out[i] = acc; acc *= nums[i]\nacc = 1\nfor i in reversed(range(n)):\n    out[i] *= acc; acc *= nums[i]\nreturn out'), steps: () => productExceptSelf([1, 2, 3, 4]).steps },
  { id: 'anagrams', label: 'LC 49 Anagrams', problem: 'LC 49 · Group Anagrams', input: 'eat tea tan ate nat bat', detail: D('Canonical key', 'Map each word to a key all its anagrams share (sorted letters, or a 26-count tuple).', 'groups = defaultdict(list)\nfor w in words:\n    groups["".join(sorted(w))].append(w)\nreturn list(groups.values())'), steps: () => groupAnagrams(['eat', 'tea', 'tan', 'ate', 'nat', 'bat']).steps },
]);

export type { Tone };
