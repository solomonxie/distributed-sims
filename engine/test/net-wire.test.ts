import { frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';
import { buildPacket, crc32, framesOnPath, HOPS_BEYOND, inetChecksum, ISN_C, ISN_S, layerSizes, MACS, ONE_WAY_MS, seqLen, tcpdumpLine, tcpScript } from '../src/net/wire';

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

const inputs = ['nw-wire-tcp', 'nw-wire-layers'].flatMap((slug) => getDemo(slug)!.inputs.map((i) => [`${slug}/${i.id}`, slug, i.data] as const));

describe.each(inputs)('%s', (_n, slug, data) => {
  const fs = frames(getDemo(slug)!, data);
  test('≥ 3 frames, ends done', () => {
    expect(fs.length).toBeGreaterThanOrEqual(3);
    expect(fs[fs.length - 1].done).toBe(true);
    expect(fs.slice(0, -1).some((f) => f.done)).toBe(false);
  });
  test('unique ids, bounds, short notes, details', () => {
    for (const f of fs) {
      const ids = f.shapes.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of f.shapes) {
        for (const v of points(s)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1000);
        }
        if ((s.t === 'rect' || s.t === 'node') && s.detail) expect(!!s.detail.title && !!(s.detail.text || s.detail.code)).toBe(true);
      }
      expect(f.note.length).toBeGreaterThan(0);
      expect([f.note, (f.note.match(/[.!?](\s|$)/g) ?? []).length <= 2]).toEqual([f.note, true]);
      expect(f.shapes.some((s) => (s.t === 'rect' || s.t === 'node') && s.detail)).toBe(true);
    }
  });
});

test('handshake seq/ack arithmetic', () => {
  const [syn, synack, ack] = tcpScript('handshake');
  expect(syn).toMatchObject({ seq: ISN_C, flags: ['SYN'] });
  expect(synack).toMatchObject({ seq: ISN_S, ack: ISN_C + 1 });
  expect(ack).toMatchObject({ seq: ISN_C + 1, ack: ISN_S + 1 });
  expect(tcpdumpLine(syn)).toBe('IP 192.168.1.20.52814 > 93.184.216.34.443: Flags [S], seq 1000, win 64240, options [mss 1460], length 0');
});

test('data, close, loss and rst segments', () => {
  const [psh, back] = tcpScript('data', 120);
  expect(psh).toMatchObject({ seq: ISN_C + 1, ack: ISN_S + 1, len: 120 });
  expect(back.ack).toBe(ISN_C + 121);
  const [fin1, a1, fin2, a2] = tcpScript('close', 120);
  expect(fin1.seq).toBe(ISN_C + 121);
  expect(a1.ack).toBe(ISN_C + 122);
  expect(fin2.seq).toBe(ISN_S + 1);
  expect(a2.ack).toBe(ISN_S + 2);
  expect(seqLen(fin1)).toBe(1);
  const loss = tcpScript('loss');
  expect(loss[0].seq).toBe(loss[1].seq);
  expect(loss[2].ack).toBe(ISN_C + 1);
  const [, rst] = tcpScript('rst');
  expect(rst.flags).toContain('RST');
  expect(rst.ack).toBe(ISN_C + 1);
  expect(ONE_WAY_MS).toBeCloseTo(19.13, 2);
});

test('layer sizes add up', () => {
  const s = layerSizes();
  const p = buildPacket();
  expect(p.tcp.length).toBe(20);
  expect(p.ip.length).toBe(20);
  expect(p.eth.length).toBe(14);
  expect(s.tcp - s.payload).toBe(20);
  expect(s.ip - s.tcp).toBe(20);
  expect(s.eth - s.ip).toBe(14);
  expect(s.fcs - s.eth).toBe(4);
});

test('checksums verify', () => {
  const p = buildPacket();
  expect(inetChecksum(p.ip)).toBe(0);
  expect(crc32([...'123456789'].map((c) => c.charCodeAt(0)))).toBe(0xcbf43926);
});

test('router decrements TTL and rewrites MACs; switch changes nothing', () => {
  const { lan, wan, last } = framesOnPath();
  expect(lan.ttl).toBe(64);
  expect(wan.ttl).toBe(63);
  expect(last.ttl).toBe(64 - 1 - HOPS_BEYOND);
  expect(wan.ipCsum).not.toBe(lan.ipCsum);
  expect(inetChecksum(wan.ip)).toBe(0);
  expect(wan.srcMac).toBe(MACS.routerWan);
  expect(wan.dstMac).toBe(MACS.isp);
  expect(lan.dstMac).toBe(MACS.routerLan);
  expect(wan.tcp).toEqual(lan.tcp);
  expect(wan.payload).toEqual(lan.payload);
  // the switch forwards exactly the bytes it received
  const again = buildPacket(0, { src: MACS.laptop, dst: MACS.routerLan });
  expect([...again.eth, ...again.ip, ...again.tcp, ...again.payload, ...again.fcs]).toEqual([...lan.eth, ...lan.ip, ...lan.tcp, ...lan.payload, ...lan.fcs]);
  const fs = frames(getDemo('nw-wire-layers')!, { k: 'path' });
  const eth = (i: number) => (fs[i].shapes.find((s) => s.id === 'ot-eth') as { text: string } | undefined)?.text;
  expect(eth(0)).toBe(eth(1));
});
