// Wire-level views: two machines exchanging real TCP segments hop by hop, and a frame peeled layer by layer through the hardware.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { box, dot, Film, line, machineDemo, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';

const d = (s: Shape, det?: Detail): Shape => {
  if (det && (s.t === 'rect' || s.t === 'node')) s.detail = det;
  return s;
};

// =====================================================================
// 1. Two machines, packet by packet
// =====================================================================

export const CLIENT = { ip: '192.168.1.20', port: 52814, mac: 'a4:83:e7:2b:5c:10' };
export const SERVER = { ip: '93.184.216.34', port: 443, mac: '52:54:00:12:34:56' };
export const ISN_C = 1000;
export const ISN_S = 5000;
export const MSS = 1460;
export const WIN = 64240;

export type Dir = 'c2s' | 's2c';
export interface Seg {
  dir: Dir;
  flags: ('SYN' | 'ACK' | 'PSH' | 'FIN' | 'RST')[];
  seq: number;
  ack?: number;
  len: number;
  win: number;
  mss?: boolean;
  port?: number;
}

/** tcpdump-style flag string: [S], [S.], [.], [P.], [F.], [R.] */
export function tcpdumpFlags(f: Seg['flags']): string {
  let s = '';
  if (f.includes('SYN')) s += 'S';
  if (f.includes('FIN')) s += 'F';
  if (f.includes('RST')) s += 'R';
  if (f.includes('PSH')) s += 'P';
  if (f.includes('ACK')) s += '.';
  return `[${s}]`;
}

export function tcpdumpLine(s: Seg): string {
  const a = s.dir === 'c2s' ? `${CLIENT.ip}.${CLIENT.port}` : `${SERVER.ip}.${s.port ?? SERVER.port}`;
  const b = s.dir === 'c2s' ? `${SERVER.ip}.${s.port ?? SERVER.port}` : `${CLIENT.ip}.${CLIENT.port}`;
  const ack = s.ack !== undefined && s.flags.includes('ACK') ? `, ack ${s.ack}` : '';
  const opts = s.mss ? `, options [mss ${MSS}]` : '';
  return `IP ${a} > ${b}: Flags ${tcpdumpFlags(s.flags)}, seq ${s.seq}${ack}, win ${s.win}${opts}, length ${s.len}`;
}

/** Sequence-space cost of a segment: payload bytes, plus one each for SYN and FIN. */
export const seqLen = (s: Seg) => s.len + (s.flags.includes('SYN') ? 1 : 0) + (s.flags.includes('FIN') ? 1 : 0);

/** The segments of each scenario, with seq/ack derived from the sender's state (not typed in). */
export function tcpScript(kind: 'handshake' | 'data' | 'close' | 'loss' | 'rst', payload = 120): Seg[] {
  let cNxt = ISN_C;
  let sNxt = ISN_S;
  let cRcv = 0;
  let sRcv = 0;
  const out: Seg[] = [];
  const send = (dir: Dir, flags: Seg['flags'], len = 0, extra: Partial<Seg> = {}) => {
    const s: Seg = { dir, flags, len, win: WIN, seq: dir === 'c2s' ? cNxt : sNxt, ...extra };
    if (flags.includes('ACK')) s.ack = dir === 'c2s' ? cRcv : sRcv;
    out.push(s);
    if (dir === 'c2s') {
      cNxt += seqLen(s);
      sRcv = s.seq + seqLen(s);
    } else {
      sNxt += seqLen(s);
      cRcv = s.seq + seqLen(s);
    }
    return s;
  };
  const established = () => {
    cNxt = ISN_C + 1;
    sNxt = ISN_S + 1;
    cRcv = ISN_S + 1;
    sRcv = ISN_C + 1;
  };
  if (kind === 'handshake') {
    send('c2s', ['SYN'], 0, { mss: true });
    send('s2c', ['SYN', 'ACK'], 0, { mss: true });
    send('c2s', ['ACK']);
  } else if (kind === 'loss') {
    const first = send('c2s', ['SYN'], 0, { mss: true });
    cNxt = first.seq; // retransmission reuses the same sequence number
    send('c2s', ['SYN'], 0, { mss: true });
    send('s2c', ['SYN', 'ACK'], 0, { mss: true });
    send('c2s', ['ACK']);
  } else if (kind === 'rst') {
    out.push({ dir: 'c2s', flags: ['SYN'], seq: ISN_C, len: 0, win: WIN, mss: true, port: 8080 });
    out.push({ dir: 's2c', flags: ['RST', 'ACK'], seq: 0, ack: ISN_C + 1, len: 0, win: 0, port: 8080 });
  } else if (kind === 'data') {
    established();
    send('c2s', ['PSH', 'ACK'], payload);
    send('s2c', ['ACK']);
  } else {
    established();
    cNxt += payload;
    sRcv += payload;
    send('c2s', ['FIN', 'ACK']);
    send('s2c', ['ACK']);
    send('s2c', ['FIN', 'ACK']);
    send('c2s', ['ACK']);
  }
  return out;
}

/** Where a segment is on its way: kernel → NIC → switch → router → internet → NIC → kernel. */
const POS: Record<string, [number, number]> = {
  'L-app': [175, 150],
  'L-kern': [175, 325],
  'L-nic': [175, 510],
  sw: [390, 510],
  rt: [495, 510],
  net: [605, 510],
  'R-nic': [825, 510],
  'R-kern': [825, 325],
  'R-app': [825, 150],
};
/** time (ms) for each link client → server: kernel→NIC, NIC→switch, switch→router, router→internet, internet→NIC, NIC→kernel */
const SEG_MS = [0.05, 0.01, 0.02, 1, 18, 0.05];
export const ONE_WAY_MS = SEG_MS.reduce((a, b) => a + b, 0);

interface Side {
  state: string;
  snd: string;
  rcv: string;
  buf: string;
  queue?: string;
}

const DETAILS: Record<string, Detail> = {
  laptop: { title: 'Client machine', text: 'Your laptop: the app asks the kernel for a connection, the kernel runs TCP, the NIC puts bits on the wire.', code: '$ ip addr show en0\n    inet 192.168.1.20/24\n    link/ether a4:83:e7:2b:5c:10' },
  server: { title: 'Server machine', text: 'The server has a listening socket on :443. The kernel completes handshakes on its own and parks finished connections until the app calls accept().', code: '$ ss -ltn\nState  Recv-Q Send-Q Local Address:Port\nLISTEN 0      511    0.0.0.0:443' },
  'L-app': { title: 'curl (user space)', text: 'The app only calls connect(), write(), read() and close(). Every packet on this screen is sent by the kernel on its behalf.', code: 'int fd = socket(AF_INET, SOCK_STREAM, 0);\nconnect(fd, &srv, sizeof srv); // blocks for the handshake\nwrite(fd, req, 120);\nread(fd, buf, sizeof buf);\nclose(fd);' },
  'R-app': { title: 'nginx (user space)', text: 'It called listen() once, then accept() hands it one finished connection at a time from the accept queue.', code: 'int ls = socket(AF_INET, SOCK_STREAM, 0);\nbind(ls, &any443, sizeof any443);\nlisten(ls, 511);\nint c = accept(ls, NULL, NULL);' },
  'L-kern': { title: 'Client kernel TCP', text: 'Holds the connection state machine, sequence numbers, send and receive buffers, and the retransmission timer.', code: '$ ss -tni dst 93.184.216.34\nESTAB 0 0 192.168.1.20:52814 93.184.216.34:443\n  rto:204 rtt:38.3/4 mss:1460 cwnd:10' },
  'R-kern': { title: 'Server kernel TCP', text: 'A SYN to the listen socket creates a half-open entry in the SYN queue; the final ACK moves it to the accept queue.', code: '$ sysctl net.ipv4.tcp_max_syn_backlog\n512\n$ sysctl net.core.somaxconn\n4096' },
  'L-nic': { title: 'Client NIC', text: 'The network card DMAs the frame out of RAM, adds the checksum (FCS) and turns it into electrical or radio signal.', code: '$ ethtool -S en0 | grep tx_packets\n     tx_packets: 1839201' },
  'R-nic': { title: 'Server NIC', text: 'It keeps only frames addressed to its MAC, copies them into RAM (DMA) and raises an interrupt so the kernel picks them up.', code: '$ ethtool -S eth0 | grep rx_packets\n     rx_packets: 99201773' },
  switch: { title: 'Switch', text: 'Layer 2 only: it looks at the destination MAC, finds the port in its MAC table, and forwards the frame unchanged.', code: 'MAC table\n3c:22:fb:10:00:01  port 1 (router)\na4:83:e7:2b:5c:10  port 4 (laptop)' },
  router: { title: 'Home router', text: 'Layer 3: it reads the destination IP, picks a route, decrements TTL and re-wraps the packet in a new Ethernet frame. Home routers also NAT the source address, left out here.', code: '$ ip route\ndefault via 100.64.0.1 dev wan0\n192.168.1.0/24 dev lan0' },
  internet: { title: 'The internet', text: 'About a dozen more routers, each doing what the home router did. Almost all of the one-way 19 ms is spent here.', code: '$ traceroute -n 93.184.216.34\n 1  192.168.1.1  1.1 ms\n 2  100.64.0.1   6.0 ms\n …\n12  93.184.216.34  19.2 ms' },
};

function tcpFrames(kind: 'handshake' | 'data' | 'close' | 'loss' | 'rst'): Frame[] {
  const f = new Film();
  const segs = tcpScript(kind);
  const L: Side = { state: 'CLOSED', snd: 'snd.nxt —', rcv: 'rcv.nxt —', buf: 'buf snd 0 · rcv 0' };
  const R: Side = { state: 'LISTEN :443', snd: 'snd.nxt —', rcv: 'rcv.nxt —', buf: 'buf snd 0 · rcv 0', queue: 'synq 0 · accq 0' };
  if (kind === 'data' || kind === 'close') {
    Object.assign(L, { state: 'ESTABLISHED', snd: `snd.nxt ${ISN_C + 1}`, rcv: `rcv.nxt ${ISN_S + 1}` });
    Object.assign(R, { state: 'ESTABLISHED', snd: `snd.nxt ${ISN_S + 1}`, rcv: `rcv.nxt ${ISN_C + 1}`, queue: 'accepted by nginx' });
  }
  if (kind === 'close') {
    L.snd = `snd.nxt ${ISN_C + 121}`;
    R.rcv = `rcv.nxt ${ISN_C + 121}`;
  }
  if (kind === 'rst') R.state = 'nothing on :8080';
  let t = 0;
  const history: string[] = [];
  const hot: Record<string, Tone> = {};
  let rtt = '—';

  const draw = (pkt?: { s: Seg; at: string; tone?: Tone; lost?: boolean }, timer?: string): Shape[] => {
    const out: Shape[] = [];
    // devices
    out.push(d(box('laptop', 20, 70, 310, 500, undefined, { filled: false, tone: 'default' }), DETAILS.laptop));
    out.push(d(box('server', 670, 70, 310, 500, undefined, { filled: false, tone: 'default' }), DETAILS.server));
    out.push(text('lt', 36, 92, `laptop ${CLIENT.ip}`, { align: 'left', size: 24, bold: true }));
    out.push(text('stt', 686, 92, `server ${SERVER.ip}`, { align: 'left', size: 24, bold: true }));
    for (const s of ['L', 'R'] as const) {
      const x0 = s === 'L' ? 40 : 690;
      const side = s === 'L' ? L : R;
      out.push(d(box(`${s}-app`, x0, 112, 270, 72, s === 'L' ? 'curl (app)' : 'nginx (app)', { mono: true, tone: hot[`${s}-app`] ?? 'default' }), DETAILS[`${s}-app`]));
      out.push(d(box(`${s}-kern`, x0, 196, 270, 264, undefined, { tone: hot[`${s}-kern`] ?? 'default' }), DETAILS[`${s}-kern`]));
      const lines = [`kernel TCP`, side.state, side.snd, side.rcv, side.buf, ...(side.queue ? [side.queue] : [])];
      lines.forEach((ln, i) => out.push(text(`${s}k${i}`, x0 + 12, 220 + i * 40, ln, { align: 'left', size: 24, mono: i > 0, bold: i === 0, tone: i === 1 && hot[`${s}-kern`] ? 'accent' : undefined })));
      out.push(d(box(`${s}-nic`, x0, 472, 270, 80, 'NIC', { sub: (s === 'L' ? CLIENT : SERVER).mac, mono: true, tone: hot[`${s}-nic`] ?? 'default' }), DETAILS[`${s}-nic`]));
    }
    // wire
    out.push(line('w1', 330, 510, 345, 510, 'muted', { width: 5 }), line('w2', 435, 510, 450, 510, 'muted', { width: 5 }), line('w3', 540, 510, 555, 510, 'muted', { width: 5 }), line('w4', 655, 510, 670, 510, 'muted', { width: 5 }));
    out.push(d(box('sw', 345, 482, 90, 56, 'switch', { tone: hot.sw ?? 'default' }), DETAILS.switch));
    out.push(d(box('rt', 450, 482, 90, 56, 'router', { tone: hot.rt ?? 'default' }), DETAILS.router));
    out.push(d(box('net', 555, 482, 100, 56, 'internet', { tone: hot.net ?? 'default', dashed: true }), DETAILS.internet));
    if (timer) out.push(text('timer', 175, 596, timer, { size: 26, bold: true, tone: 'warn' }));
    // packet
    if (pkt) {
      const [px, py] = POS[pkt.at];
      out.push(dot('pos', px, py, pkt.lost ? 'fail' : pkt.tone ?? 'accent', undefined, 12));
      const ex = Math.max(20, Math.min(640, px - 170));
      const s = pkt.s;
      const tone: Tone = pkt.lost ? 'fail' : s.flags.includes('RST') ? 'fail' : s.dir === 'c2s' ? 'write' : 'read';
      out.push(d(box('pkt', ex, 610, 340, 170, undefined, { tone, dashed: pkt.lost }), { title: `This segment: ${s.flags.join(', ')}`, text: 'Exactly what a packet capture on either machine would print for it. Sequence numbers count bytes: SYN and FIN each use one.', code: `$ tcpdump -n -i any port ${s.port ?? 443}\n${tcpdumpLine(s)}` }));
      out.push(text('pf', ex + 14, 640, s.flags.join('+') + (s.mss ? ` · mss ${MSS}` : '') + (pkt.lost ? ' ✕' : ''), { align: 'left', size: 28, bold: true, tone }));
      out.push(text('ps', ex + 14, 678, `seq ${s.seq}${s.flags.includes('ACK') ? ` ack ${s.ack}` : ''}`, { align: 'left', size: 24, mono: true }));
      out.push(text('pl', ex + 14, 712, `len ${s.len} win ${s.win}`, { align: 'left', size: 24, mono: true }));
      out.push(text('pp', ex + 14, 746, s.dir === 'c2s' ? `:${CLIENT.port} → :${s.port ?? 443}` : `:${s.port ?? 443} → :${CLIENT.port}`, { align: 'left', size: 24, mono: true }));
    }
    // capture so far
    out.push(text('hh', 20, 812, 'on the wire so far', { align: 'left', size: 24, bold: true, tone: 'muted' }));
    history.slice(-4).forEach((h, i) => out.push(text(`h${i}`, 20, 850 + i * 34, h, { align: 'left', size: 24, mono: true })));
    return out;
  };
  const rows = (ev: string): Row[] => [['t', `${t.toFixed(2)} ms`], ['event', ev], ['RTT', rtt]];
  const add = (note: string, ev: string, pkt?: Parameters<typeof draw>[0], timer?: string) => {
    f.add(note, draw(pkt, timer), panel('Wire', rows(ev)));
    for (const k of Object.keys(hot)) delete hot[k];
  };

  /** One segment's trip, one stop per frame; `arrive` updates the receiver and returns the note for that frame. */
  const trip = (s: Seg, build: string, arrive: () => string, opts: { dropAt?: string } = {}) => {
    const side = s.dir === 'c2s' ? 'L' : 'R';
    const other = s.dir === 'c2s' ? 'R' : 'L';
    const route = s.dir === 'c2s' ? ['L-kern', 'L-nic', 'sw', 'rt', 'net', 'R-nic', 'R-kern'] : ['R-kern', 'R-nic', 'net', 'rt', 'sw', 'L-nic', 'L-kern'];
    const who = side === 'L' ? 'Client' : 'Server';
    const hopNote: Record<string, string> = {
      [`${side}-nic`]: `The ${who.toLowerCase()} NIC wraps the segment in an Ethernet frame and puts it on the cable.`,
      sw: s.dir === 'c2s' ? 'The switch reads only the destination MAC (the router) and forwards the frame unchanged.' : 'The switch sees the laptop’s MAC and forwards the frame out port 4.',
      rt: s.dir === 'c2s' ? `The router looks up ${SERVER.ip} in its routing table and sends it to the ISP.` : 'The home router delivers it onto the LAN toward the laptop.',
      net: 'A dozen more routers pass it along, each re-wrapping it. Most of the one-way time is spent here.',
      [`${other}-nic`]: `The ${other === 'L' ? 'client' : 'server'} NIC sees its own MAC, copies the frame into RAM and raises an interrupt.`,
    };
    const start = t;
    for (const [i, stop] of route.entries()) {
      if (i) t += s.dir === 'c2s' ? SEG_MS[i - 1] : SEG_MS[SEG_MS.length - i];
      hot[stop] = stop.endsWith('kern') ? 'current' : 'accent';
      if (stop === opts.dropAt) {
        history.push(`${t.toFixed(2).padStart(6)}  ${s.dir === 'c2s' ? 'C→S' : 'S→C'} ${tcpdumpFlags(s.flags)} seq ${s.seq}  ✕ lost`);
        add('The router’s queue is full and it drops the SYN. Nobody tells the client.', 'dropped', { s, at: stop, lost: true });
        return false;
      }
      if (stop === route[0]) add(build, `${s.flags.join('+')} built`, { s, at: stop });
      else if (stop === route[route.length - 1]) {
        history.push(`${t.toFixed(2).padStart(6)}  ${s.dir === 'c2s' ? 'C→S' : 'S→C'} ${tcpdumpFlags(s.flags)} seq ${s.seq}${s.flags.includes('ACK') ? ` ack ${s.ack}` : ''}`);
        add(arrive(), `${s.flags.join('+')} received (${(t - start).toFixed(2)} ms)`, { s, at: stop });
      } else add(hopNote[stop], `${s.flags.join('+')} at ${stop.replace(/^[LR]-/, '')}`, { s, at: stop });
    }
    return true;
  };

  const synBuild = 'connect() makes the client kernel build a SYN: random start seq 1000, window 64240, MSS 1460. State → SYN_SENT.';
  const synArrive = () => {
    R.queue = 'synq 1 · accq 0';
    R.snd = `snd.nxt ${ISN_S + 1}`;
    R.rcv = `rcv.nxt ${ISN_C + 1}`;
    R.state = 'child SYN_RCVD';
    hot['R-kern'] = 'current';
    return 'The listen socket spawns a half-open connection in the SYN queue: SYN_RCVD, rcv.nxt = 1000 + 1.';
  };
  const handshakeRest = (c: Seg[]) => {
    const [synack, ack] = c;
    trip(synack, 'The server kernel answers by itself, no app involved: SYN-ACK with its own seq 5000 and ack 1001.', () => {
      L.state = 'ESTABLISHED';
      L.snd = `snd.nxt ${ISN_C + 1}`;
      L.rcv = `rcv.nxt ${ISN_S + 1}`;
      rtt = `${(2 * ONE_WAY_MS).toFixed(1)} ms`;
      hot['L-kern'] = 'current';
      return 'The SYN-ACK acknowledges 1001, so the client is ESTABLISHED and connect() returns. The kernel also takes its first RTT sample.';
    });
    trip(ack, 'The client’s ACK (ack 5001) finishes the handshake. It can already carry data.', () => {
      R.state = 'child ESTABLISHED';
      R.queue = 'synq 0 · accq 1';
      hot['R-kern'] = 'current';
      return 'The final ACK moves the connection from the SYN queue to the accept queue: ESTABLISHED.';
    });
    t += 0.1;
    R.queue = 'accepted by nginx';
    hot['R-app'] = 'current';
    add('nginx’s accept() takes it off the accept queue and gets a new file descriptor. Only now does the app see the client.', 'accept()');
  };

  if (kind === 'handshake') {
    add('curl calls connect(). The app waits; everything below happens inside the two kernels and the network.', 'connect()');
    L.state = 'SYN_SENT';
    L.snd = `snd.nxt ${ISN_C + 1}`;
    trip(segs[0], synBuild, synArrive);
    handshakeRest(segs.slice(1));
  } else if (kind === 'loss') {
    add('Same connect(), but the network is congested today.', 'connect()');
    L.state = 'SYN_SENT';
    L.snd = `snd.nxt ${ISN_C + 1}`;
    trip(segs[0], synBuild, synArrive, { dropAt: 'rt' });
    add('The client kernel started a 1 s retransmission timer when it sent the SYN. It waits with no idea why.', 'RTO armed', undefined, 'RTO 1000 ms');
    t = 1000;
    add('The timer fires after 1 s and the kernel resends the same SYN, seq 1000 again. The next timeout would be 2 s.', 'RTO fired', undefined, 'RTO fired · next 2000 ms');
    trip(segs[1], 'The retransmitted SYN leaves, identical to the first.', synArrive);
    handshakeRest(segs.slice(2));
    add('connect() took just over a second instead of 38 ms. One lost SYN is why cold connections have a 1 s latency cliff.', 'done');
  } else if (kind === 'rst') {
    add('curl connects to port 8080, where nothing is listening.', 'connect()');
    L.state = 'SYN_SENT';
    trip(segs[0], 'The client kernel sends a SYN to :8080, exactly like any other.', () => {
      hot['R-kern'] = 'fail';
      return 'The server kernel finds no socket for :8080. It answers with RST instead of SYN-ACK.';
    });
    trip(segs[1], 'The RST acknowledges the SYN (ack 1001) so the client knows it’s about this connection attempt.', () => {
      L.state = 'CLOSED';
      L.snd = 'snd.nxt —';
      hot['L-kern'] = 'fail';
      return 'connect() fails at once with ECONNREFUSED. A firewall that silently drops would instead cause a timeout.';
    });
  } else if (kind === 'data') {
    hot['L-app'] = 'current';
    L.buf = 'buf snd 120 · rcv 0';
    add('curl writes a 120-byte request. write() returns as soon as the bytes are copied into the kernel’s send buffer.', 'write(120)');
    L.snd = `snd.nxt ${ISN_C + 121}`;
    trip(segs[0], 'The kernel cuts a segment: PSH+ACK, seq 1001, 120 bytes, ack 5001.', () => {
      R.rcv = `rcv.nxt ${ISN_C + 121}`;
      R.buf = 'buf snd 0 · rcv 120';
      hot['R-kern'] = 'current';
      return 'The server kernel checks seq 1001 is what it expected, queues 120 bytes and moves rcv.nxt to 1121. Its free window shrinks to 64120.';
    });
    t += 0.2;
    R.buf = 'buf snd 0 · rcv 0';
    hot['R-app'] = 'current';
    add('nginx’s read() copies the 120 bytes out of the receive buffer. The window is back to 64240.', 'read(120)');
    trip(segs[1], 'The server kernel acknowledges: ack 1121 means “I have every byte before 1121”.', () => {
      L.buf = 'buf snd 0 · rcv 0';
      L.snd = `snd.una ${ISN_C + 121}`;
      hot['L-kern'] = 'current';
      return 'The ACK covers all 120 bytes, so the client frees its send buffer and stops the retransmission timer.';
    });
  } else {
    hot['L-app'] = 'current';
    add('curl calls close(). The kernel still owes the peer a proper goodbye.', 'close()');
    L.state = 'FIN_WAIT_1';
    L.snd = `snd.nxt ${ISN_C + 122}`;
    trip(segs[0], 'The client sends FIN (seq 1121): no more data from this side. State → FIN_WAIT_1.', () => {
      R.state = 'CLOSE_WAIT';
      R.rcv = `rcv.nxt ${ISN_C + 122}`;
      hot['R-kern'] = 'current';
      return 'The server kernel moves to CLOSE_WAIT and tells nginx read() = 0 (end of stream). The FIN used one sequence number.';
    });
    trip(segs[1], 'The server kernel ACKs the FIN right away: ack 1122.', () => {
      L.state = 'FIN_WAIT_2';
      hot['L-kern'] = 'current';
      return 'The client is now half-closed in FIN_WAIT_2, waiting for the server’s own FIN.';
    });
    hot['R-app'] = 'current';
    t += 0.3;
    add('nginx finishes and calls close() on its side. A server stuck in CLOSE_WAIT means the app never did this.', 'close()');
    R.state = 'LAST_ACK';
    R.snd = `snd.nxt ${ISN_S + 2}`;
    trip(segs[2], 'The server sends its FIN (seq 5001). State → LAST_ACK.', () => {
      L.state = 'TIME_WAIT';
      L.rcv = `rcv.nxt ${ISN_S + 2}`;
      hot['L-kern'] = 'current';
      return 'The client gets the FIN and enters TIME_WAIT. It must still ACK it.';
    });
    trip(segs[3], 'The client’s last ACK (ack 5002) says goodbye.', () => {
      R.state = 'CLOSED';
      R.queue = 'socket freed';
      hot['R-kern'] = 'current';
      return 'The server frees the connection immediately.';
    });
    t += 60000;
    L.state = 'CLOSED';
    hot['L-kern'] = 'current';
    add('The client keeps the 4-tuple in TIME_WAIT for 2×MSL (60 s on Linux) so late duplicates can’t leak into a new connection. Then it’s gone.', 'TIME_WAIT over', undefined, 'TIME_WAIT 60 s');
  }
  return f.frames;
}

machineDemo({
  slug: 'nw-wire-tcp',
  title: 'Two machines, packet by packet',
  group: 'net-tcp',
  summary: 'A real client and server exchange TCP segments hop by hop: app, kernel, NIC, switch, router, internet; states, queues, seq/ack and timers at every step.',
  linkedFrom: ['Network'],
  inputs: [
    { id: 'handshake', label: 'Handshake', data: { k: 'handshake' } },
    { id: 'data', label: 'Send data', data: { k: 'data' } },
    { id: 'close', label: 'Close', data: { k: 'close' } },
    { id: 'loss', label: 'Lost SYN', data: { k: 'loss' } },
    { id: 'rst', label: 'Refused (RST)', data: { k: 'rst' } },
  ],
  build: ({ k }: { k: 'handshake' | 'data' | 'close' | 'loss' | 'rst' }) => tcpFrames(k),
});

// =====================================================================
// 2. Peeling the onion
// =====================================================================

const ascii = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);
const macBytes = (m: string) => m.split(':').map((h) => parseInt(h, 16));
const ipBytes = (ip: string) => ip.split('.').map(Number);
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const hex = (n: number, w = 4) => '0x' + n.toString(16).padStart(w, '0');

/** Internet checksum (RFC 1071): ones' complement of the ones' complement sum of 16-bit words. */
export function inetChecksum(bytes: number[]): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += (bytes[i] << 8) + (bytes[i + 1] ?? 0);
  while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
  return ~sum & 0xffff;
}

let CRC_TABLE: number[] | undefined;
/** CRC-32 (IEEE 802.3), as the NIC computes the Ethernet FCS. */
export function crc32(bytes: number[]): number {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE.push(c >>> 0);
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const HTTP_REQ = 'GET /index.html HTTP/1.1\r\nHost: example.com\r\nUser-Agent: curl/8.4.0\r\nAccept: */*\r\n\r\n';
export const HOPS_BEYOND = 12;
export const MACS = {
  laptop: 'a4:83:e7:2b:5c:10',
  routerLan: '3c:22:fb:10:00:01',
  routerWan: '00:1b:21:aa:00:01',
  isp: '00:1b:21:aa:00:02',
  lastHop: '0c:c4:7a:00:00:09',
  server: SERVER.mac,
};

export interface Headers {
  payload: number[];
  tcp: number[];
  ip: number[];
  eth: number[];
  fcs: number[];
  ttl: number;
  ipCsum: number;
  tcpCsum: number;
  srcMac: string;
  dstMac: string;
}

/** Build every header byte for the request as it looks after `routersPassed` routers. */
export function buildPacket(routersPassed = 0, macs?: { src: string; dst: string }): Headers {
  const payload = ascii(HTTP_REQ);
  const srcIp = ipBytes(CLIENT.ip);
  const dstIp = ipBytes(SERVER.ip);
  const tcpLen = 20 + payload.length;
  const tcpNoSum = [...u16(CLIENT.port), ...u16(80), ...u32(ISN_C + 1), ...u32(ISN_S + 1), 0x50, 0x18, ...u16(502), 0, 0, 0, 0];
  const pseudo = [...srcIp, ...dstIp, 0, 6, ...u16(tcpLen)];
  const tcpCsum = inetChecksum([...pseudo, ...tcpNoSum, ...payload]);
  const tcp = [...tcpNoSum.slice(0, 16), ...u16(tcpCsum), 0, 0];
  const ttl = 64 - routersPassed;
  const ipNoSum = [0x45, 0, ...u16(20 + tcpLen), ...u16(0x1c46), 0x40, 0, ttl, 6, 0, 0, ...srcIp, ...dstIp];
  const ipCsum = inetChecksum(ipNoSum);
  const ip = [...ipNoSum.slice(0, 10), ...u16(ipCsum), ...ipNoSum.slice(12)];
  const src = macs?.src ?? MACS.laptop;
  const dst = macs?.dst ?? MACS.routerLan;
  const eth = [...macBytes(dst), ...macBytes(src), 0x08, 0x00];
  const fcsVal = crc32([...eth, ...ip, ...tcp, ...payload]);
  const fcs = [fcsVal & 0xff, (fcsVal >>> 8) & 0xff, (fcsVal >>> 16) & 0xff, (fcsVal >>> 24) & 0xff];
  return { payload, tcp, ip, eth, fcs, ttl, ipCsum, tcpCsum, srcMac: src, dstMac: dst };
}

/** The frame on each wire segment of the path. */
export function framesOnPath() {
  const lan = buildPacket(0, { src: MACS.laptop, dst: MACS.routerLan });
  const wan = buildPacket(1, { src: MACS.routerWan, dst: MACS.isp });
  const last = buildPacket(1 + HOPS_BEYOND, { src: MACS.lastHop, dst: MACS.server });
  return { lan, wan, last };
}

type Layer = 'eth' | 'ip' | 'tcp' | 'pay';
const LAYER_TONE: Record<Layer, Tone> = { eth: 'protocol', ip: 'read', tcp: 'write', pay: 'ok' };

/** Components down the sender (left) and up the receiver (right). */
const ROWS = [
  { k: 'app', label: 'app', l: 'curl (user space)', r: 'nginx (user space)' },
  { k: 'tcp', label: 'socket + TCP', l: 'kernel: tcp_sendmsg', r: 'kernel: tcp_v4_rcv' },
  { k: 'ip', label: 'IP', l: 'kernel: ip_output', r: 'kernel: ip_rcv' },
  { k: 'arp', label: 'neighbour / ARP', l: 'kernel: neigh cache', r: 'kernel: (not needed)' },
  { k: 'drv', label: 'NIC driver', l: 'dev_queue_xmit', r: 'NAPI poll' },
  { k: 'phy', label: 'NIC + PHY', l: 'NIC ASIC', r: 'NIC ASIC' },
] as const;
const ROW_Y = (i: number) => 80 + i * 90;

const COMP: Record<string, Detail> = {
  'L-app': { title: 'The app writes bytes', text: 'curl hands the kernel a buffer. It never sees a header: everything below is added for it.', code: 'write(fd, "GET /index.html HTTP/1.1\\r\\n…", 78);' },
  'L-tcp': { title: 'TCP (kernel)', text: 'tcp_sendmsg copies the bytes into the socket’s send buffer; tcp_write_xmit cuts a segment and prepends the 20-byte TCP header with ports, seq/ack and a checksum over a pseudo-header.', code: '// net/ipv4/tcp_output.c\ntcp_transmit_skb()\n  th->source = htons(52814);\n  th->dest   = htons(80);\n  th->seq    = htonl(tp->write_seq);' },
  'L-ip': { title: 'IP (kernel)', text: 'ip_queue_xmit looks up the route for the destination, fills in the 20-byte IPv4 header (TTL 64) and its header checksum.', code: '$ ip route get 93.184.216.34\n93.184.216.34 via 192.168.1.1 dev en0 src 192.168.1.20' },
  'L-arp': { title: 'Neighbour / ARP', text: 'The next hop is the gateway 192.168.1.1, so the frame needs the gateway’s MAC, not the server’s. The neighbour cache has it; otherwise ARP asks the LAN “who has 192.168.1.1?”.', code: '$ ip neigh show 192.168.1.1\n192.168.1.1 dev en0 lladdr 3c:22:fb:10:00:01 REACHABLE' },
  'L-drv': { title: 'NIC driver', text: 'dev_queue_xmit passes the packet through the qdisc, the driver prepends the 14-byte Ethernet header and places a descriptor in the NIC’s TX ring. The NIC then DMAs the bytes out of RAM.', code: '$ ethtool -g en0\nRX: 1024  TX: 1024   # ring sizes\n$ tc qdisc show dev en0\nqdisc fq_codel 0: root' },
  'L-phy': { title: 'NIC + PHY (hardware)', text: 'The NIC ASIC computes the CRC-32 frame check sequence, the PHY adds a 7-byte preamble and start delimiter, and serialises it all as signal on the cable.', code: 'preamble 55 55 55 55 55 55 55\nSFD      d5\nframe    3c 22 fb 10 00 01 a4 83 …\nFCS      (CRC-32, 4 bytes)' },
  'R-phy': { title: 'Server NIC (hardware)', text: 'It recovers the bits, checks the FCS, drops frames not addressed to its MAC, and DMAs good ones into the RX ring in RAM.', code: '$ ethtool -S eth0 | grep -E "rx_crc|rx_packets"\n     rx_packets: 99201773\n     rx_crc_errors: 0' },
  'R-drv': { title: 'Driver + NAPI', text: 'An interrupt wakes the driver, which polls the RX ring (NAPI), strips the Ethernet header and hands the packet to the stack via netif_receive_skb.', code: '$ cat /proc/interrupts | grep eth0\n 45:  8812773  PCI-MSI  eth0-rx-0' },
  'R-arp': { title: 'No ARP on receive', text: 'Receiving needs no address lookup: the packet already carries the destination IP.' },
  'R-ip': { title: 'IP (kernel)', text: 'ip_rcv checks the version, header checksum and that the destination is one of this host’s addresses, then strips the IP header.', code: '$ ip addr show eth0\n    inet 93.184.216.34/24' },
  'R-tcp': { title: 'TCP (kernel)', text: 'tcp_v4_rcv verifies the checksum, finds the socket by 4-tuple (src ip:port, dst ip:port), strips the TCP header and queues the payload in the receive buffer. An ACK is scheduled.', code: '$ ss -tn sport = :80\nESTAB 78 0 93.184.216.34:80 192.168.1.20:52814' },
  'R-app': { title: 'The app reads bytes', text: 'nginx’s read() gets exactly the 78 bytes curl wrote. It never sees a header either.', code: 'n = read(fd, buf, sizeof buf); // n == 78' },
  sw: { title: 'Switch', text: 'Reads the destination MAC, finds the port in its MAC table and forwards the frame bit for bit. It never looks inside.', code: 'MAC table\n3c:22:fb:10:00:01  port 1\na4:83:e7:2b:5c:10  port 4' },
  rt: { title: 'Router', text: 'Checks the FCS, strips the Ethernet header, reads the destination IP, decrements TTL, recomputes the IP checksum, and wraps a new Ethernet header for the next hop.', code: '$ ip route\ndefault via 100.64.0.1 dev wan0\n192.168.1.0/24 dev lan0' },
  net: { title: `${HOPS_BEYOND} more routers`, text: 'Each one repeats the same strip, decrement, re-wrap. The IP and TCP headers survive the whole trip; the Ethernet header is new on every link.', code: `$ traceroute -n ${SERVER.ip}\n 1  192.168.1.1\n 2  100.64.0.1\n …\n${HOPS_BEYOND + 1}  ${SERVER.ip}` },
};

interface Onion {
  layers: Layer[];
  pkt: Headers;
  fcs: boolean;
  bits?: boolean;
}

const bytesOf = (o: Onion) => o.layers.reduce((a, l) => a + (l === 'eth' ? o.pkt.eth.length : l === 'ip' ? o.pkt.ip.length : l === 'tcp' ? o.pkt.tcp.length : o.pkt.payload.length), 0) + (o.fcs ? 4 : 0) + (o.bits ? 8 : 0);

/** Packet size after each layer is added on the sender. */
export function layerSizes() {
  const p = buildPacket();
  const pay = p.payload.length;
  return { payload: pay, tcp: pay + 20, ip: pay + 40, eth: pay + 54, fcs: pay + 58, wire: pay + 66 };
}

function onionShapes(o: Onion, hot?: Layer, fcsHot = false): Shape[] {
  const out: Shape[] = [];
  const p = o.pkt;
  const has = (l: Layer) => o.layers.includes(l);
  const hdr: Record<Layer, string> = {
    eth: `ETH 14B dst ${p.dstMac} src ${p.srcMac}`,
    ip: `IP 20B ${CLIENT.ip} → ${SERVER.ip} TTL ${p.ttl}`,
    tcp: `TCP 20B :${CLIENT.port} → :80 seq ${ISN_C + 1} [P.]`,
    pay: `payload ${p.payload.length}B (HTTP request)`,
  };
  const det: Record<Layer, Detail> = {
    eth: { title: 'Ethernet header (14 bytes)', text: 'Who is next on this link. Rewritten at every router.', code: `dst  ${p.dstMac}\nsrc  ${p.srcMac}\ntype 0x0800 (IPv4)\nFCS  ${hex(crc32([...p.eth, ...p.ip, ...p.tcp, ...p.payload]), 8)} (trailer)` },
    ip: { title: 'IPv4 header (20 bytes)', text: 'Where the packet is going across networks. Only TTL and the checksum change on the way.', code: `ver 4 ihl 5  total ${20 + 20 + p.payload.length}\nid 0x1c46 flags DF\nttl ${p.ttl} proto 6 (TCP)\nchecksum ${hex(p.ipCsum)}\nsrc ${CLIENT.ip}\ndst ${SERVER.ip}` },
    tcp: { title: 'TCP header (20 bytes)', text: 'Which process, and where these bytes sit in the stream. Untouched end to end.', code: `src port ${CLIENT.port}  dst port 80\nseq ${ISN_C + 1}\nack ${ISN_S + 1}\nflags PSH,ACK  window 502\nchecksum ${hex(p.tcpCsum)}` },
    pay: { title: 'Payload', text: 'The bytes curl wrote. Every layer below exists only to deliver this.', code: HTTP_REQ.replace(/\r\n/g, '\\r\\n\n').trim() },
  };
  const geom: Record<Layer, [number, number, number, number]> = {
    eth: [20, 700, 960, 290],
    ip: [50, 744, 900, 234],
    tcp: [80, 788, 840, 178],
    pay: [110, 832, 780, 122],
  };
  for (const l of ['eth', 'ip', 'tcp', 'pay'] as Layer[]) {
    if (!has(l)) continue;
    const [x, y, w, h] = geom[l];
    out.push(d(box(`on-${l}`, x, y, w, h, undefined, { tone: hot === l ? 'current' : LAYER_TONE[l], filled: l === 'pay' }), det[l]));
    out.push(text(`ot-${l}`, x + 12, y + 20, hdr[l], { align: 'left', size: 24, mono: true, bold: hot === l, tone: hot === l ? 'accent' : undefined }));
  }
  if (has('pay')) out.push(text('ot-req', 128, 900, 'GET /index.html HTTP/1.1 …', { align: 'left', size: 24, mono: true, tone: 'muted' }));
  if (o.fcs) out.push(text('ot-fcs', 970, 978, `FCS ${hex(crc32([...p.eth, ...p.ip, ...p.tcp, ...p.payload]), 8)}`, { align: 'right', size: 24, mono: true, tone: fcsHot ? 'accent' : 'muted' }));
  if (o.bits) out.push(text('ot-bits', 500, 660, 'preamble 55×7 d5 → 1 0 1 0 1 0 1 0 … on the cable', { size: 24, mono: true, tone: 'accent' }));
  return out;
}

type Step = { note: string; at: string; o: Onion; hot?: Layer; fcsHot?: boolean; peel?: string; table?: string[]; ev: string };

function layerSteps(): Record<'send' | 'path' | 'receive', Step[]> {
  const { lan, wan, last } = framesOnPath();
  const send: Step[] = [
    { at: 'L-app', ev: 'write()', o: { layers: ['pay'], pkt: lan, fcs: false }, hot: 'pay', note: `curl writes ${lan.payload.length} bytes of HTTP. So far it is just bytes, no addresses anywhere.` },
    { at: 'L-tcp', ev: '+TCP header', o: { layers: ['tcp', 'pay'], pkt: lan, fcs: false }, hot: 'tcp', note: 'TCP wraps it: source port 52814, destination port 80, seq 1001 and a checksum. +20 bytes.' },
    { at: 'L-ip', ev: 'route lookup', o: { layers: ['tcp', 'pay'], pkt: lan, fcs: false }, table: ['route get', SERVER.ip, 'via 192.168.1.1 en0'], note: 'IP asks the routing table how to reach 93.184.216.34. The answer is the default gateway 192.168.1.1.' },
    { at: 'L-ip', ev: '+IP header', o: { layers: ['ip', 'tcp', 'pay'], pkt: lan, fcs: false }, hot: 'ip', note: `IP wraps it: source and destination address, TTL 64, protocol TCP, header checksum ${hex(lan.ipCsum)}. +20 bytes.` },
    { at: 'L-arp', ev: 'neighbour lookup', o: { layers: ['ip', 'tcp', 'pay'], pkt: lan, fcs: false }, table: ['neigh 192.168.1.1', MACS.routerLan, 'REACHABLE'], note: 'The next hop is the router, so the frame needs the router’s MAC. The neighbour cache already has it.' },
    { at: 'L-drv', ev: '+Ethernet header', o: { layers: ['eth', 'ip', 'tcp', 'pay'], pkt: lan, fcs: false }, hot: 'eth', note: 'The driver adds the Ethernet header: destination = router’s MAC, source = laptop’s MAC. +14 bytes, then a descriptor goes into the TX ring.' },
    { at: 'L-phy', ev: '+FCS', o: { layers: ['eth', 'ip', 'tcp', 'pay'], pkt: lan, fcs: true }, fcsHot: true, note: 'The NIC hardware computes a CRC-32 over the whole frame and appends it as the FCS. +4 bytes.' },
    { at: 'L-phy', ev: 'serialise', o: { layers: ['eth', 'ip', 'tcp', 'pay'], pkt: lan, fcs: true, bits: true }, note: 'The PHY adds a preamble so the receiver can lock on, then sends the frame as 1s and 0s on the cable.' },
  ];
  const path: Step[] = [
    { at: 'sw', ev: 'MAC lookup', o: { layers: ['eth', 'ip', 'tcp', 'pay'], pkt: lan, fcs: true }, hot: 'eth', table: ['MAC table', `${MACS.routerLan} p1`, `${MACS.laptop} p4`], note: 'The switch reads only the destination MAC and finds it on port 1. It opens nothing.' },
    { at: 'sw', ev: 'forward unchanged', o: { layers: ['eth', 'ip', 'tcp', 'pay'], pkt: lan, fcs: true }, note: 'The frame leaves port 1 bit for bit identical, FCS included.' },
    { at: 'rt', ev: 'check FCS, strip ETH', o: { layers: ['ip', 'tcp', 'pay'], pkt: lan, fcs: false }, peel: `Ethernet header + FCS removed (18 B)`, note: 'The router checks the FCS, then peels off the Ethernet header and trailer. They only mattered on the LAN link.' },
    { at: 'rt', ev: 'route lookup', o: { layers: ['ip', 'tcp', 'pay'], pkt: lan, fcs: false }, hot: 'ip', table: ['ip route', 'default via 100.64.0.1', '192.168.1.0/24 lan0'], note: 'It reads the destination IP and matches the default route toward the ISP.' },
    { at: 'rt', ev: 'TTL 64→63', o: { layers: ['ip', 'tcp', 'pay'], pkt: wan, fcs: false }, hot: 'ip', note: `TTL drops from 64 to 63, so the IP header checksum is recomputed: ${hex(lan.ipCsum)} → ${hex(wan.ipCsum)}. TCP and payload are untouched.` },
    { at: 'rt', ev: '+new Ethernet header', o: { layers: ['eth', 'ip', 'tcp', 'pay'], pkt: wan, fcs: true }, hot: 'eth', note: `A new Ethernet header for the next link: source ${MACS.routerWan}, destination the ISP’s ${MACS.isp}. New FCS too.` },
    { at: 'net', ev: `${HOPS_BEYOND} more routers`, o: { layers: ['eth', 'ip', 'tcp', 'pay'], pkt: last, fcs: true }, hot: 'eth', note: `${HOPS_BEYOND} more routers repeat that peel, decrement and re-wrap. The last one addresses the frame to the server’s own MAC, TTL ${last.ttl}.` },
  ];
  const receive: Step[] = [
    { at: 'R-phy', ev: 'check MAC + FCS', o: { layers: ['eth', 'ip', 'tcp', 'pay'], pkt: last, fcs: true }, hot: 'eth', fcsHot: true, note: 'The server NIC sees its own MAC as destination and the FCS matches, so it keeps the frame.' },
    { at: 'R-drv', ev: 'strip ETH', o: { layers: ['ip', 'tcp', 'pay'], pkt: last, fcs: false }, peel: 'Ethernet header + FCS removed (18 B)', note: 'The NIC DMAs it into the RX ring and interrupts; the driver peels off the Ethernet header and trailer.' },
    { at: 'R-ip', ev: 'check IP', o: { layers: ['ip', 'tcp', 'pay'], pkt: last, fcs: false }, hot: 'ip', note: `IP checks the header checksum and that ${SERVER.ip} is one of its own addresses.` },
    { at: 'R-ip', ev: 'strip IP', o: { layers: ['tcp', 'pay'], pkt: last, fcs: false }, peel: 'IP header removed (20 B)', note: 'Protocol field 6 says TCP, so the IP header comes off and the rest goes to TCP.' },
    { at: 'R-tcp', ev: 'find socket', o: { layers: ['tcp', 'pay'], pkt: last, fcs: false }, hot: 'tcp', table: ['4-tuple lookup', `${CLIENT.ip}:${CLIENT.port}`, `${SERVER.ip}:80`, 'fd 12 (nginx)'], note: 'TCP verifies its checksum and finds the socket by the 4-tuple of both addresses and ports.' },
    { at: 'R-tcp', ev: 'strip TCP', o: { layers: ['pay'], pkt: last, fcs: false }, peel: 'TCP header removed (20 B)', note: 'Seq 1001 is the next expected byte, so the header comes off and the payload joins the receive buffer. An ACK is scheduled.' },
    { at: 'R-app', ev: 'read()', o: { layers: ['pay'], pkt: last, fcs: false }, hot: 'pay', note: `nginx’s read() returns the same ${last.payload.length} bytes curl wrote. Every header has been peeled away.` },
  ];
  return { send, path, receive };
}

function layerFrames(k: 'send' | 'path' | 'receive' | 'full'): Frame[] {
  const st = layerSteps();
  const steps = k === 'full' ? [...st.send, ...st.path, ...st.receive] : st[k];
  const f = new Film();
  steps.forEach((s, i) => {
    const out: Shape[] = [];
    for (const side of ['L', 'R'] as const) {
      const x = side === 'L' ? 20 : 700;
      ROWS.forEach((r, ri) => {
        const id = `${side}-${r.k}`;
        out.push(d(box(id, x, ROW_Y(ri), 280, 76, r.label, { sub: side === 'L' ? r.l : r.r, mono: true, tone: s.at === id ? 'current' : 'default' }), COMP[id]));
      });
    }
    out.push(text('lh', 160, 60, 'laptop', { size: 26, bold: true }), text('rh', 840, 60, 'server', { size: 26, bold: true }));
    const yw = ROW_Y(5) + 38;
    out.push(line('c1', 300, yw, 318, yw, 'muted', { width: 5 }), line('c2', 412, yw, 426, yw, 'muted', { width: 5 }), line('c3', 520, yw, 534, yw, 'muted', { width: 5 }), line('c4', 680, yw, 700, yw, 'muted', { width: 5 }));
    out.push(d(box('sw', 318, yw - 32, 94, 64, 'switch', { tone: s.at === 'sw' ? 'current' : 'default' }), COMP.sw));
    out.push(d(box('rt', 426, yw - 32, 94, 64, 'router', { tone: s.at === 'rt' ? 'current' : 'default' }), COMP.rt));
    out.push(d(box('net', 534, yw - 32, 146, 64, `+${HOPS_BEYOND} routers`, { dashed: true, tone: s.at === 'net' ? 'current' : 'default' }), COMP.net));
    if (s.table) {
      out.push(box('tbl', 318, 110, 362, 40 + s.table.length * 40, undefined, { tone: 'accent', filled: false }));
      s.table.forEach((row, ri) => out.push(text(`tb${ri}`, 332, 140 + ri * 40, row, { align: 'left', size: 24, mono: true, bold: ri === 0 })));
    }
    if (s.peel) out.push(box('peel', 20, 630, 960, 52, s.peel, { tone: 'muted', dashed: true, filled: false, mono: true }));
    out.push(...onionShapes(s.o, s.hot, s.fcsHot));
    const prev = steps[i - 1];
    const delta = prev ? bytesOf(s.o) - bytesOf(prev.o) : 0;
    f.add(s.note, out, panel('Packet', [['step', s.ev], ['size', `${bytesOf(s.o)} B`], ['change', delta ? `${delta > 0 ? '+' : ''}${delta} B` : '—', delta > 0 ? 'write' : delta < 0 ? 'read' : undefined], ['TTL', s.o.layers.includes('ip') ? s.o.pkt.ttl : '—']]));
  });
  return f.frames;
}

machineDemo({
  slug: 'nw-wire-layers',
  title: 'Peeling the onion',
  group: 'net-layers',
  summary: 'One HTTP request wrapped layer by layer down the laptop’s stack, re-wrapped by the router, and peeled layer by layer up the server’s stack, with the real header bytes.',
  linkedFrom: ['Network'],
  inputs: [
    { id: 'send', label: 'Down the sender', data: { k: 'send' } },
    { id: 'path', label: 'Switch & router', data: { k: 'path' } },
    { id: 'receive', label: 'Up the receiver', data: { k: 'receive' } },
    { id: 'full', label: 'End to end', data: { k: 'full' } },
  ],
  build: ({ k }: { k: 'send' | 'path' | 'receive' | 'full' }) => layerFrames(k),
});

