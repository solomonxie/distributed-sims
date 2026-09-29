import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';
import { maxArea, minWindow, threeSum, trap, twoSumSorted, longestUnique, minSubLen, windowMax, binarySearch, searchRange, searchRotated, minEatingSpeed, twoSumHash, subarraySum, productExceptSelf, groupAnagrams } from '../src/patterns/arrays';
import { validParens, dailyTemps, largestRect, evalRPN, kthLargest, topKFrequent, mergeK, runningMedian, reverseList, hasCycle, mergeTwo, removeNth, MinHeap } from '../src/patterns/linear';
import { levelOrder, maxDepth, validBST, lca, numIslands, topoOrder, redundantConnection, Trie, longestCommonPrefix } from '../src/patterns/trees';
import { subsets, permutations, combinationSum, nQueens, climbStairs, rob, coinChange, lcs, canPartition, mergeIntervals, eraseOverlap, canJump, meetingRooms, sieve, fastPow, gcdSteps, trailingZeroes } from '../src/patterns/search';
import { lruRun, minStackRun, randomizedSet } from '../src/patterns/design';

const rnd = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

describe('array patterns vs brute force', () => {
  const r = rnd(7);
  const arr = (n: number, lo = -5, hi = 9) => Array.from({ length: n }, () => lo + Math.floor(r() * (hi - lo + 1)));
  test('two pointers', () => {
    for (let t = 0; t < 50; t++) {
      const h = arr(2 + (t % 8), 0, 9);
      let best = 0;
      for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) best = Math.max(best, Math.min(h[i], h[j]) * (j - i));
      expect(maxArea(h).best).toBe(best);
      let w = 0;
      for (let i = 0; i < h.length; i++) w += Math.max(0, Math.min(Math.max(...h.slice(0, i + 1)), Math.max(...h.slice(i))) - h[i]);
      expect(trap(h).water).toBe(w);
    }
    expect(twoSumSorted([1, 3, 4, 6, 8, 11], 10).pair).toEqual([2, 3]);
    expect(threeSum([-1, 0, 1, 2, -1, -4]).triplets).toEqual([[-1, -1, 2], [-1, 0, 1]]);
  });
  test('sliding window', () => {
    expect(longestUnique('abcabcbb').best).toBe(3);
    expect(longestUnique('pwwkew').best).toBe(3);
    expect(minSubLen(7, [2, 3, 1, 2, 4, 3]).best).toBe(2);
    expect(minWindow('ADOBECODEBANC', 'ABC').window).toBe('BANC');
    expect(windowMax([1, 3, -1, -3, 5, 3, 6, 7], 3).out).toEqual([3, 3, 5, 5, 6, 7]);
    for (let t = 0; t < 30; t++) {
      const a = arr(8, -3, 5);
      const k = 1 + (t % 4);
      const brute = a.slice(0, a.length - k + 1).map((_, i) => Math.max(...a.slice(i, i + k)));
      expect(windowMax(a, k).out).toEqual(brute);
    }
  });
  test('binary search', () => {
    const a = [-1, 0, 3, 5, 9, 12, 15];
    for (const x of [-1, 9, 15, 4]) expect(binarySearch(a, x).index).toBe(a.indexOf(x));
    expect(searchRange([5, 7, 7, 8, 8, 8, 10], 8).range).toEqual([3, 5]);
    expect(searchRange([5, 7, 7, 8, 8, 10], 6).range).toEqual([-1, -1]);
    const rot = [4, 5, 6, 7, 0, 1, 2];
    for (const x of [0, 4, 2, 3]) expect(searchRotated(rot, x).index).toBe(rot.indexOf(x));
    expect(minEatingSpeed([3, 6, 7, 11], 8).k).toBe(4);
    expect(minEatingSpeed([30, 11, 23, 4, 20], 6).k).toBe(23);
  });
  test('prefix sums & hashing', () => {
    expect(twoSumHash([2, 7, 11, 15], 18).pair).toEqual([1, 2]);
    for (let t = 0; t < 30; t++) {
      const a = arr(7, -2, 3);
      let c = 0;
      for (let i = 0; i < a.length; i++) for (let j = i; j < a.length; j++) if (a.slice(i, j + 1).reduce((x, y) => x + y, 0) === 3) c++;
      expect(subarraySum(a, 3).count).toBe(c);
    }
    expect(productExceptSelf([1, 2, 3, 4]).out).toEqual([24, 12, 8, 6]);
    expect(groupAnagrams(['eat', 'tea', 'tan', 'ate', 'nat', 'bat']).groups.length).toBe(3);
  });
});

describe('linear structures', () => {
  test('stack', () => {
    expect(validParens('{[()]}(]').valid).toBe(false);
    expect(validParens('([]{})').valid).toBe(true);
    expect(dailyTemps([73, 74, 75, 71, 69, 72, 76, 73]).ans).toEqual([1, 1, 4, 2, 1, 1, 0, 0]);
    expect(largestRect([2, 1, 5, 6, 2, 3]).best).toBe(10);
    expect(evalRPN(['2', '1', '+', '3', '*', '4', '-']).value).toBe(5);
  });
  test('heap', () => {
    const h = new MinHeap();
    const xs = [5, 3, 9, 1, 7, 2, 8];
    xs.forEach((x) => h.push(x));
    expect(Array.from({ length: xs.length }, () => h.pop())).toEqual([...xs].sort((a, b) => a - b));
    expect(kthLargest([3, 2, 1, 5, 6, 4], 2).kth).toBe(5);
    expect(topKFrequent([1, 1, 1, 2, 2, 3, 4, 4, 4, 4], 2).top).toEqual([4, 1]);
    expect(mergeK([[1, 4, 5], [1, 3, 4], [2, 6]]).out).toEqual([1, 1, 2, 3, 4, 4, 5, 6]);
    expect(runningMedian([5, 15, 1, 3, 8]).med).toEqual([5, 10, 5, 4, 5]);
  });
  test('linked list', () => {
    expect(reverseList([1, 2, 3, 4, 5]).order).toEqual([5, 4, 3, 2, 1]);
    expect(hasCycle([3, 2, 0, -4], 1).cycle).toBe(true);
    expect(hasCycle([1, 2, 3], -1).cycle).toBe(false);
    expect(mergeTwo([1, 2, 4], [1, 3, 4]).out).toEqual([1, 1, 2, 3, 4, 4]);
    expect(removeNth([1, 2, 3, 4, 5], 2).removed).toBe(4);
  });
});

describe('trees, graphs, trie', () => {
  test('trees', () => {
    expect(levelOrder([3, 9, 20, null, null, 15, 7]).levels).toEqual([[3], [9, 20], [15, 7]]);
    expect(maxDepth([3, 9, 20, null, null, 15, 7]).depth).toBe(3);
    expect(validBST([8, 3, 10, 1, 6, null, 14, null, null, 4, 7]).valid).toBe(true);
    expect(validBST([5, 1, 4, null, null, 3, 6]).valid).toBe(false);
    expect(lca([8, 3, 10, 1, 6, null, 14, null, null, 4, 7], 4, 1).lca).toBe(3);
  });
  test('graphs', () => {
    expect(numIslands([['1', '1', '0', '0', '0'], ['1', '1', '0', '0', '1'], ['0', '0', '1', '0', '1'], ['0', '0', '0', '1', '1']]).count).toBe(3);
    const order = topoOrder(6, [[1, 0], [2, 0], [3, 1], [3, 2], [4, 3], [5, 2]]).order;
    expect(order.length).toBe(6);
    for (const [a, b] of [[1, 0], [2, 0], [3, 1], [3, 2], [4, 3], [5, 2]]) expect(order.indexOf(b)).toBeLessThan(order.indexOf(a));
    expect(topoOrder(2, [[0, 1], [1, 0]]).order.length).toBe(0);
    expect(redundantConnection([[1, 2], [1, 3], [2, 4], [3, 5], [4, 5], [2, 6]]).edge).toEqual([4, 5]);
  });
  test('trie', () => {
    const t = new Trie();
    ['apple', 'app', 'apt', 'bat'].forEach((w) => t.insert(w));
    expect(t.search('app')).toBe(true);
    expect(t.search('ap')).toBe(false);
    expect(t.search('ap', true)).toBe(true);
    const d = new Trie();
    ['bad', 'dad', 'mad'].forEach((w) => d.insert(w));
    expect([d.match('pad'), d.match('.ad'), d.match('b..')]).toEqual([false, true, true]);
    expect(longestCommonPrefix(['flower', 'flow', 'flight']).prefix).toBe('fl');
  });
});

describe('search, dp, greedy, math', () => {
  test('backtracking', () => {
    expect(subsets([1, 2, 3]).res.length).toBe(8);
    expect(permutations([1, 2, 3]).res.length).toBe(6);
    expect(combinationSum([2, 3, 5], 8).res).toEqual([[2, 2, 2, 2], [2, 3, 3], [3, 5]]);
    expect(nQueens(4).sols).toEqual([[1, 3, 0, 2], [2, 0, 3, 1]]);
  });
  test('dp', () => {
    expect(climbStairs(7).ways).toBe(21);
    expect(rob([2, 7, 9, 3, 1, 4]).best).toBe(15);
    expect(coinChange([1, 3, 4], 6).coins).toBe(2);
    expect(coinChange([2], 3).coins).toBe(-1);
    expect(lcs('ABCBD', 'BDCB').len).toBe(3);
    expect(canPartition([1, 5, 11, 5]).ok).toBe(true);
    expect(canPartition([1, 2, 3, 5]).ok).toBe(false);
  });
  test('greedy', () => {
    expect(mergeIntervals([[1, 3], [8, 10], [2, 6], [15, 18], [9, 12]]).out).toEqual([[1, 6], [8, 12], [15, 18]]);
    expect(eraseOverlap([[1, 2], [2, 3], [3, 4], [1, 3], [2, 5]]).removed).toBe(2);
    expect(canJump([2, 3, 1, 1, 4]).ok).toBe(true);
    expect(canJump([3, 2, 1, 0, 4]).ok).toBe(false);
    expect(meetingRooms([[0, 30], [5, 10], [15, 20], [10, 25]]).rooms).toBe(3);
  });
  test('math', () => {
    expect(sieve(20).count).toBe(8);
    expect(sieve(30).count).toBe(10);
    expect(fastPow(3, 13).value).toBe(3 ** 13);
    expect(gcdSteps(84, 36).gcd).toBe(12);
    expect(trailingZeroes(130).zeros).toBe(32);
  });
  test('design', () => {
    expect(lruRun(2, [['put', 1, 1], ['put', 2, 2], ['get', 1], ['put', 3, 3], ['get', 2], ['put', 4, 4], ['get', 1], ['get', 3]]).results).toEqual([1, null, null, 3]);
    expect(minStackRun([['push', 5], ['push', 3], ['push', 7], ['min'], ['push', 2], ['min'], ['pop'], ['min']]).out).toEqual([3, 2, 3]);
    expect(randomizedSet([['insert', 10], ['insert', 20], ['insert', 30], ['insert', 40], ['remove', 20], ['insert', 50]]).arr).toEqual([10, 40, 30, 50]);
  });
});

const pats = () => allDemos().filter((d) => d.group.startsWith('algo-'));

function points(s: Shape): number[] {
  switch (s.t) {
    case 'rect':
      return [s.x, s.y, s.x + s.w, s.y + s.h];
    case 'line':
      return [s.x1, s.y1, s.x2, s.y2];
    case 'arc':
      return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
    case 'node':
      return s.r ? [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r] : [s.x, s.y];
    case 'edge':
      return [s.from, s.to].flatMap((p) => (typeof p === 'string' ? [] : [p.x, p.y]));
    default:
      return [s.x, s.y];
  }
}

test('pattern demos exist', () => {
  expect(pats().length).toBeGreaterThanOrEqual(14);
});

describe.each(pats().flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
  const fs = frames(getDemo(slug)!, data);

  test('≥ 3 frames, ends done', () => {
    expect(fs.length).toBeGreaterThanOrEqual(3);
    expect(fs[fs.length - 1].done).toBe(true);
    expect(fs.slice(0, -1).some((f) => f.done)).toBe(false);
  });

  test('unique ids, coordinates in [0,1000], short notes, a tappable box', () => {
    for (const f of fs) {
      const ids = f.shapes.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of f.shapes) {
        for (const v of points(s)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1000);
        }
        if ((s.t === 'rect' || s.t === 'node') && s.detail) {
          expect(s.detail.title.length).toBeGreaterThan(0);
          expect(!!(s.detail.text || s.detail.code)).toBe(true);
        }
      }
      expect(f.note.length).toBeGreaterThan(0);
      expect([f.note, (f.note.match(/[.!?](\s|$)/g) ?? []).length <= 2]).toEqual([f.note, true]);
      expect(f.shapes.some((s) => s.t === 'rect' && !!s.detail)).toBe(true);
    }
  });
});
