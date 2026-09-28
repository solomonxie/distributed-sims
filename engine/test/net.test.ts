import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';
import { bdpBytes, cidrContains, cwndTrace, intToIp, ipToInt, lpm, maskOf, rtoEstimate, subnet } from '../src/net/lib';

const net = () => allDemos().filter((d) => d.group.startsWith('net-'));

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

describe('ip helpers', () => {
  test('ip ↔ int round trip', () => {
    for (const ip of ['0.0.0.0', '10.1.2.3', '192.168.1.255', '255.255.255.255']) expect(intToIp(ipToInt(ip))).toBe(ip);
    expect(() => ipToInt('10.1.2')).toThrow();
    expect(() => ipToInt('10.1.2.256')).toThrow();
  });

  test('masks', () => {
    expect(intToIp(maskOf(0))).toBe('0.0.0.0');
    expect(intToIp(maskOf(24))).toBe('255.255.255.0');
    expect(intToIp(maskOf(26))).toBe('255.255.255.192');
    expect(intToIp(maskOf(32))).toBe('255.255.255.255');
  });

  test('subnet info', () => {
    expect(subnet('10.1.2.0/24')).toMatchObject({ network: '10.1.2.0', broadcast: '10.1.2.255', first: '10.1.2.1', last: '10.1.2.254', hosts: 254 });
    expect(subnet('192.168.1.64/26')).toMatchObject({ network: '192.168.1.64', broadcast: '192.168.1.127', hosts: 62 });
    expect(subnet('172.16.0.0/12')).toMatchObject({ broadcast: '172.31.255.255', hosts: 2 ** 20 - 2 });
    expect(subnet('10.0.0.0/31').hosts).toBe(2);
    expect(subnet('10.0.0.7/32')).toMatchObject({ network: '10.0.0.7', hosts: 1 });
  });

  test('cidrContains matches brute force over a /24 neighbourhood', () => {
    for (const len of [22, 24, 25, 26, 30]) {
      const cidr = `10.1.2.64/${len}`;
      const s = subnet(cidr);
      const lo = ipToInt(s.network);
      const hi = ipToInt(s.broadcast);
      for (let n = ipToInt('10.1.0.0'); n <= ipToInt('10.1.4.0'); n += 7) expect(cidrContains(cidr, intToIp(n))).toBe(n >= lo && n <= hi);
    }
  });

  test('longest prefix wins', () => {
    const table = [
      { prefix: '0.0.0.0/0', via: 'isp' },
      { prefix: '10.0.0.0/8', via: 'vpn' },
      { prefix: '10.1.0.0/16', via: 'dc' },
      { prefix: '10.1.2.0/24', via: 'eth1' },
    ];
    expect(lpm(table, '10.1.2.3').route?.via).toBe('eth1');
    expect(lpm(table, '10.1.2.3').matches).toHaveLength(4);
    expect(lpm(table, '10.1.9.9').route?.via).toBe('dc');
    expect(lpm(table, '10.7.0.9').route?.via).toBe('vpn');
    expect(lpm(table, '8.8.8.8').route?.via).toBe('isp');
    expect(lpm(table.slice(1), '8.8.8.8').route).toBeUndefined();
  });
});

describe('tcp helpers', () => {
  test('RTO follows RFC 6298', () => {
    const e = rtoEstimate([100, 120]);
    expect(e[0]).toMatchObject({ srtt: 100, rttvar: 50, rto: 300 });
    // rttvar = .75*50 + .25*20 = 42.5; srtt = .875*100 + .125*120 = 102.5; rto = 102.5 + 170 = 272.5 → 273
    expect(e[1]).toMatchObject({ srtt: 102.5, rttvar: 42.5, rto: 273 });
    expect(rtoEstimate([1, 1, 1, 1])[3].rto).toBe(200);
  });

  test('slow start doubles to ssthresh, then +1 per round', () => {
    expect(cwndTrace(9, {}, 16).map((p) => p.cwnd)).toEqual([1, 2, 4, 8, 16, 17, 18, 19, 20]);
    expect(cwndTrace(5, {}, 6).map((p) => p.cwnd)).toEqual([1, 2, 4, 6, 7]);
  });

  test('dup-ack halves, timeout resets to 1', () => {
    const a = cwndTrace(8, { 5: 'dupack' }, 16);
    expect(a[5]).toMatchObject({ cwnd: 17, event: 'dupack' });
    expect(a[6]).toMatchObject({ cwnd: 8, ssthresh: 8, phase: 'avoidance' });
    const t = cwndTrace(9, { 5: 'timeout' }, 16);
    expect(t[6]).toMatchObject({ cwnd: 1, ssthresh: 8, phase: 'slow start' });
    expect(t[8].cwnd).toBe(4);
  });

  test('bandwidth-delay product', () => {
    expect(bdpBytes(100, 40)).toBe(500000);
    expect(bdpBytes(1000, 80)).toBe(10000000);
  });
});

test('net demo groups exist', () => {
  expect(new Set(net().map((d) => d.group)).size).toBeGreaterThanOrEqual(8);
});

describe.each(net().flatMap((d) => d.inputs.map((i) => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_name, slug, data) => {
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
      expect([f.note, (f.note.match(/[.!?](\s|$)/g) ?? []).length <= 2]).toEqual([f.note, true]);
    }
  });
});
