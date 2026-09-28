import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';
import {
  canIWin, canPartitionK, countBits, divide, findComplement, findRepeatedDna, getSum, gosper, grayCode, hamming, hasAlternatingBits,
  isPowerOfFour, isPowerOfTwo, letterCasePermutation, maxProductWords, maxXor, minFlips, minXorSum, missingNumber, parity, popcount,
  rangeBitwiseAnd, readBinaryWatch, reverseBits, shortestPathAllNodes, singleNumber, singleNumberII, singleNumberIII, subarrayBitwiseORs,
  submasks, totalHamming, validUtf8, xorUpTo,
} from '../src/machine/bits';

const naivePop = (n: number) => (n >>> 0).toString(2).split('').filter((c) => c === '1').length;

describe('bit helpers vs brute force', () => {
  test('popcount, countBits, parity', () => {
    for (const n of [0, 1, 7, 180, 255, 0x7fffffff, -1, 123456789]) {
      expect(popcount(n)).toBe(naivePop(n));
      expect(parity(n)).toBe(naivePop(n) % 2);
    }
    expect(countBits(20)).toEqual(Array.from({ length: 21 }, (_, i) => naivePop(i)));
  });
  test('hamming and total hamming', () => {
    expect(hamming(1, 4)).toBe(2);
    const nums = [4, 14, 2, 9, 31, 0];
    let t = 0;
    for (let i = 0; i < nums.length; i++) for (let j = i + 1; j < nums.length; j++) t += hamming(nums[i], nums[j]);
    expect(totalHamming(nums)).toBe(t);
    expect(totalHamming([4, 14, 2])).toBe(6);
  });
  test('reverse bits', () => {
    expect(reverseBits(0b00000010100101000001111010011100)).toBe(964176192);
    expect(reverseBits(0b00010110, 8)).toBe(0b01101000);
  });
  test('gray code differs by one bit', () => {
    const g = grayCode(4);
    expect(new Set(g).size).toBe(16);
    for (let i = 1; i < g.length; i++) expect(popcount(g[i] ^ g[i - 1])).toBe(1);
  });
  test('submasks and gosper', () => {
    const m = 0b101101;
    const brute = [];
    for (let s = m; s > 0; s--) if ((s & m) === s) brute.push(s);
    expect(submasks(m)).toEqual(brute);
    let x = 0b111;
    const seen = [x];
    while (true) {
      x = gosper(x);
      if (x >= 1 << 6) break;
      seen.push(x);
    }
    const combos = Array.from({ length: 64 }, (_, i) => i).filter((i) => naivePop(i) === 3);
    expect(seen).toEqual(combos);
  });
  test('single number family', () => {
    expect(singleNumber([4, 1, 2, 1, 2])).toBe(4);
    expect(singleNumberII([2, 2, 3, 2])).toBe(3);
    expect(singleNumberII([0, 1, 0, 1, 0, 1, 99])).toBe(99);
    expect(singleNumberIII([1, 2, 1, 3, 2, 5])).toEqual([3, 5]);
    expect(missingNumber([3, 0, 1])).toBe(2);
    expect(missingNumber([9, 6, 4, 2, 3, 5, 7, 0, 1])).toBe(8);
    for (let n = 0; n < 40; n++) {
      let x = 0;
      for (let i = 0; i <= n; i++) x ^= i;
      expect(xorUpTo(n)).toBe(x);
    }
  });
  test('arithmetic', () => {
    for (const [a, b] of [[5, 3], [-7, 2], [-1, 1], [1000, -2000], [0, 0]]) expect(getSum(a, b)).toBe(a + b);
    for (const [a, b] of [[43, 5], [10, 3], [7, -3], [-2147483648, -1], [-2147483648, 1], [1, 1]]) {
      const q = Math.trunc(a / b);
      expect(divide(a, b)).toBe(Math.max(-2147483648, Math.min(2147483647, q)));
    }
  });
  test('powers, complement, alternating', () => {
    for (let n = -4; n < 300; n++) {
      expect(isPowerOfTwo(n)).toBe(n > 0 && Number.isInteger(Math.log2(n)));
      expect(isPowerOfFour(n)).toBe(n > 0 && Number.isInteger(Math.log2(n) / 2));
      const alt = n > 0 && !/(00|11)/.test(n.toString(2));
      if (n > 0) expect(hasAlternatingBits(n)).toBe(alt);
    }
    expect(findComplement(5)).toBe(2);
    expect(findComplement(1)).toBe(0);
    expect(findComplement(0)).toBe(1);
  });
  test('range AND, flips, subarray ORs', () => {
    for (const [m, n] of [[5, 7], [0, 0], [1, 2147483647], [12, 15], [26, 30]]) {
      let a = m;
      if (n - m < 1000) for (let i = m; i <= n; i++) a &= i;
      else a = 0;
      expect(rangeBitwiseAnd(m, n)).toBe(a >>> 0);
    }
    expect(minFlips(2, 6, 5)).toBe(3);
    expect(minFlips(4, 2, 7)).toBe(1);
    expect(minFlips(1, 2, 3)).toBe(0);
    const arr = [1, 2, 4, 1, 3];
    const set = new Set<number>();
    for (let i = 0; i < arr.length; i++) {
      let o = 0;
      for (let j = i; j < arr.length; j++) set.add((o |= arr[j]));
    }
    expect(subarrayBitwiseORs(arr)).toBe(set.size);
    expect(subarrayBitwiseORs([1, 1, 2])).toBe(3);
  });
  test('max xor vs brute force', () => {
    const nums = [3, 10, 5, 25, 2, 8];
    let best = 0;
    for (const a of nums) for (const b of nums) best = Math.max(best, a ^ b);
    expect(maxXor(nums)).toBe(best);
    expect(maxXor(nums, 5)).toBe(28);
  });
  test('encodings', () => {
    expect(maxProductWords(['abcw', 'baz', 'foo', 'bar', 'xtfn', 'abcdef'])).toBe(16);
    expect(maxProductWords(['a', 'aa', 'aaa'])).toBe(0);
    expect(validUtf8([197, 130, 1])).toBe(true);
    expect(validUtf8([235, 140, 4])).toBe(false);
    expect(findRepeatedDna('AAAAACCCCCAAAAACCCCCCAAAAAGGGTTT').sort()).toEqual(['AAAAACCCCC', 'CCCCCAAAAA']);
    expect(readBinaryWatch(1).length).toBe(10);
    expect(readBinaryWatch(9).length).toBe(0);
    expect(letterCasePermutation('a1b2').sort()).toEqual(['A1B2', 'A1b2', 'a1B2', 'a1b2']);
  });
  test('bitmask DP', () => {
    expect(shortestPathAllNodes([[1, 2, 3], [0], [0], [0]])).toBe(4);
    expect(shortestPathAllNodes([[1], [0, 2, 4], [1, 3, 4], [2], [1, 2]])).toBe(4);
    expect(canPartitionK([4, 3, 2, 3, 5, 2, 1], 4)).toBe(true);
    expect(canPartitionK([1, 2, 3, 4], 3)).toBe(false);
    expect(minXorSum([1, 2], [2, 3])).toBe(2);
    expect(minXorSum([1, 0, 3], [5, 3, 4])).toBe(8);
    expect(canIWin(10, 11)).toBe(false);
    expect(canIWin(10, 0)).toBe(true);
    expect(canIWin(10, 1)).toBe(true);
  });
});

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

const bits = () => allDemos().filter((d) => d.group === 'machine-bits');

test('bit demos exist', () => {
  expect(bits().length).toBeGreaterThanOrEqual(12);
});

describe.each(bits().flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
  const fs = frames(getDemo(slug)!, data);

  test('≥ 3 frames, ends done', () => {
    expect(fs.length).toBeGreaterThanOrEqual(3);
    expect(fs[fs.length - 1].done).toBe(true);
    expect(fs.slice(0, -1).some((f) => f.done)).toBe(false);
  });

  test('unique ids, coordinates in [0,1000], short notes, well-formed details', () => {
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
      expect((f.note.match(/[.!?](\s|$)/g) ?? []).length).toBeLessThanOrEqual(2);
    }
  });

  test('some box is tappable', () => {
    expect(fs.some((f) => f.shapes.some((s) => (s.t === 'rect' || s.t === 'node') && s.detail))).toBe(true);
  });
});
