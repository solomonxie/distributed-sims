// Transport (groups net-tcp, net-quic): handshake, seq/ack, teardown, loss & retransmission, congestion & flow control, UDP & QUIC.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { box, Film, machineDemo, panel, text } from '../machine/lib/draw';
import { barChart, bdpBytes, cwndTrace, laneFrames, rtoEstimate } from './lib';

const CLIENT: Detail = { title: 'Client socket', text: 'connect() on the client starts the handshake. The kernel picks an ephemeral source port and a random initial sequence number (ISN).', code: 'int fd = socket(AF_INET, SOCK_STREAM, 0);\nconnect(fd, (sockaddr*)&srv, sizeof srv);\n// returns after SYN-ACK arrives' };
const SERVER: Detail = { title: 'Server socket', text: 'A listening socket. The kernel completes handshakes on its own and queues finished connections until the app calls accept().', code: '$ ss -ltn\nState  Recv-Q Send-Q Local Address:Port\nLISTEN 0      4096   0.0.0.0:443' };
const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const SYN = d('SYN', 'Synchronise: "my byte numbering starts at x". Carries options: MSS, window scale, SACK permitted, timestamps.', '$ tcpdump -n -c3 port 443\nIP 10.0.0.5.52814 > 93.184.216.34.443:\n  Flags [S], seq 1000, win 64240,\n  options [mss 1460,sackOK,TS,nop,wscale 7]');
const SYNACK = d('SYN-ACK', 'The server picks its own ISN y and acknowledges x+1 (a SYN consumes one sequence number).', 'IP 93.184.216.34.443 > 10.0.0.5.52814:\n  Flags [S.], seq 5000, ack 1001, win 65160');
const ACK = d('ACK', 'Acknowledges y+1. The connection is ESTABLISHED on both sides; the client may already send data in this packet.', 'IP 10.0.0.5.52814 > 93.184.216.34.443:\n  Flags [.], ack 5001, win 502');

const conn: Record<string, () => Frame[]> = {
  handshake: () =>
    laneFrames({
      lanes: ['client', 'server'],
      subs: ['SYN_SENT → ESTABLISHED', 'LISTEN → ESTABLISHED'],
      laneDetails: [CLIENT, SERVER],
      panel: 'TCP',
      intro: 'Before any data, both sides agree on starting sequence numbers: the three-way handshake.',
      rows: [['state', 'CLOSED']],
      msgs: [
        { from: 0, to: 1, label: 'SYN seq=1000', note: 'The client sends SYN with a random ISN, 1000 here, and moves to SYN_SENT.', detail: SYN, rows: [['client', 'SYN_SENT'], ['server', 'LISTEN']] },
        { from: 1, to: 1, label: 'SYN queue', note: 'The server stores a half-open entry in its SYN queue. SYN floods fill this queue; SYN cookies avoid storing state.', tone: 'warn', detail: d('SYN queue', 'Half-open connections waiting for the final ACK. Sized by tcp_max_syn_backlog.', '$ sysctl net.ipv4.tcp_max_syn_backlog\nnet.ipv4.tcp_max_syn_backlog = 4096'), rows: [['server', 'SYN_RECEIVED']] },
        { from: 1, to: 0, label: 'SYN-ACK seq=5000 ack=1001', note: 'The server answers with its own ISN and acknowledges 1001: the SYN used up one sequence number.', detail: SYNACK, rows: [['client', 'SYN_SENT'], ['server', 'SYN_RECEIVED']] },
        { from: 0, to: 1, label: 'ACK ack=5001', note: 'The client acknowledges and is ESTABLISHED. connect() returns now, after one round trip.', detail: ACK, tone: 'ok', rows: [['client', 'ESTABLISHED', 'ok'], ['server', 'ESTABLISHED', 'ok']] },
        { from: 1, to: 1, label: 'accept queue → accept()', note: 'The finished connection waits in the accept queue until the app calls accept().', tone: 'ok', detail: d('Accept queue', 'Completed connections waiting for accept(). If the app is slow and it fills past the listen() backlog, new handshakes are dropped.', '$ ss -ltn   # Recv-Q = queued, Send-Q = backlog\nLISTEN 12 4096 0.0.0.0:443') },
      ],
      outro: 'One full RTT before the first byte of data. Across regions that is 70 ms or more, which is why connections are pooled and reused.',
      outroRows: [['cost', '1 RTT'], ['cross-region', '~70 ms']],
    }),
  data: () =>
    laneFrames({
      lanes: ['client', 'server'],
      laneDetails: [CLIENT, SERVER],
      panel: 'Sequence numbers',
      intro: 'After the handshake, seq numbers count bytes. Client seq starts at 1001, server at 5001.',
      rows: [['client next seq', 1001], ['server next seq', 5001]],
      msgs: [
        { from: 0, to: 1, label: 'seq=1001 len=100', note: 'The client sends 100 bytes: bytes 1001 to 1100.', detail: d('Data segment', 'seq = number of the first byte in this segment; len = payload bytes.', 'Flags [P.], seq 1001:1101, ack 5001, length 100'), rows: [['client next seq', 1101]] },
        { from: 1, to: 0, label: 'ack=1101', note: 'The server acknowledges 1101, meaning every byte up to 1100 arrived.', rows: [['client unacked', 0, 'ok']] },
        { from: 1, to: 0, label: 'seq=5001 len=1460', note: 'The server replies with a full segment of 1460 bytes, one MSS.', rows: [['server next seq', 6461]] },
        { from: 1, to: 0, label: 'seq=6461 len=1460', note: 'It keeps sending without waiting, up to the congestion and receive windows.', rows: [['server in flight', '2920 B']] },
        { from: 0, to: 1, label: 'ack=7921', note: 'One cumulative ACK covers both segments. Delayed ACK sends one ACK per two segments or 40 ms.', tone: 'ok', detail: d('Cumulative & delayed ACK', 'An ACK confirms every byte before its number. Receivers usually ACK every second segment or after a short delay to save packets.', '$ tcpdump ... Flags [.], ack 7921, win 501'), rows: [['server in flight', 0, 'ok']] },
      ],
      outro: 'Sequence numbers let the receiver reorder, drop duplicates and tell the sender exactly what is missing.',
    }),
  close: () =>
    laneFrames({
      lanes: ['client', 'server'],
      laneDetails: [CLIENT, SERVER],
      panel: 'Teardown',
      intro: 'Each direction closes on its own. Four segments, and one side lingers in TIME_WAIT.',
      rows: [['client', 'ESTABLISHED'], ['server', 'ESTABLISHED']],
      msgs: [
        { from: 0, to: 1, label: 'FIN seq=1101', note: 'The client calls close(): FIN means "I will send no more".', rows: [['client', 'FIN_WAIT_1']] },
        { from: 1, to: 0, label: 'ACK', note: 'The server acknowledges. It can still send data: the connection is half-closed.', rows: [['client', 'FIN_WAIT_2'], ['server', 'CLOSE_WAIT']] },
        { from: 1, to: 1, label: 'app calls close()', note: 'The server stays in CLOSE_WAIT until its app closes the socket. Thousands of CLOSE_WAIT sockets mean your app leaks them.', tone: 'warn', detail: d('CLOSE_WAIT', 'The peer closed, your code hasn\'t. A growing count is a socket leak in the application.', '$ ss -tan state close-wait | wc -l\n4812'), rows: [['server', 'LAST_ACK']] },
        { from: 1, to: 0, label: 'FIN', note: 'The server sends its FIN.' },
        { from: 0, to: 1, label: 'ACK', note: 'The client acknowledges and enters TIME_WAIT for 2×MSL, 60 s on Linux.', tone: 'ok', rows: [['client', 'TIME_WAIT', 'warn'], ['server', 'CLOSED']] },
        { from: 0, to: 0, label: 'TIME_WAIT 60 s', note: 'TIME_WAIT keeps the 4-tuple reserved so late packets can\'t corrupt a new connection. Busy clients can run out of ports this way.', tone: 'warn', detail: d('TIME_WAIT', 'The side that closes first holds the 4-tuple for 60 s. Reusing connections (keep-alive, pools) avoids piling these up.', '$ ss -tan state time-wait | wc -l\n28113\n$ sysctl net.ipv4.tcp_tw_reuse=1'), rows: [['client', 'TIME_WAIT', 'warn']] },
      ],
      outro: 'Whoever closes first pays TIME_WAIT. Servers usually let clients close first, or keep connections alive.',
    }),
  rst: () =>
    laneFrames({
      lanes: ['client', 'server'],
      laneDetails: [CLIENT, SERVER],
      panel: 'RST',
      intro: 'RST aborts a connection immediately, with no handshake.',
      msgs: [
        { from: 0, to: 1, label: 'SYN :8080', note: 'The client connects to a port where nothing listens.' },
        { from: 1, to: 0, label: 'RST', note: 'The kernel answers RST at once, so connect() fails fast with ECONNREFUSED.', tone: 'fail', detail: d('Connection refused', 'Nothing is listening on that port (or a firewall rejects actively). Compare with a silent drop, which times out instead.', '$ curl localhost:8080\ncurl: (7) Failed to connect to localhost\n  port 8080: Connection refused'), rows: [['errno', 'ECONNREFUSED', 'fail']] },
        { from: 0, to: 1, label: 'SYN :443 (firewalled)', note: 'A firewall that drops silently gives no answer at all.', lost: true },
        { from: 0, to: 0, label: 'retry 1 s, 3 s, 7 s …', note: 'The client retries SYN with backoff and gives up after about 2 minutes on Linux: a timeout, not a refusal.', tone: 'warn', rows: [['errno', 'ETIMEDOUT', 'warn']] },
        { from: 1, to: 0, label: 'RST (mid-stream)', note: 'Mid-connection RSTs come from crashed processes, load balancers dropping idle flows, or writing to a closed socket.', tone: 'fail', rows: [['errno', 'ECONNRESET', 'fail']] },
      ],
      outro: 'Refused is fast and means nothing listens; timed out means something drops packets. Reset means the other end gave up.',
    }),
};

machineDemo({
  slug: 'nw-tcp-conn',
  title: 'TCP connections',
  group: 'net-tcp',
  summary: 'Three-way handshake, sequence and ACK numbers, FIN teardown and TIME_WAIT, RST and refused vs timed-out connects.',
  inputs: [
    { id: 'handshake', label: 'Handshake', data: { k: 'handshake' } },
    { id: 'data', label: 'Seq & ACK', data: { k: 'data' } },
    { id: 'close', label: 'Teardown', data: { k: 'close' } },
    { id: 'rst', label: 'RST & timeouts', data: { k: 'rst' } },
  ],
  build: ({ k }: { k: string }) => conn[k](),
});

// ---------------- loss & retransmission ----------------
const RTT_SAMPLES = [100, 120, 90, 300, 110];

const loss: Record<string, () => Frame[]> = {
  rto: () => {
    const est = rtoEstimate(RTT_SAMPLES);
    const rto = est[est.length - 1].rto;
    return laneFrames({
      lanes: ['sender', 'receiver'],
      panel: 'Retransmission',
      intro: 'Segment 2 of 3 is lost and nothing more follows it. Only a timer can notice.',
      rows: [['SRTT', `${est[est.length - 1].srtt} ms`], ['RTO', `${rto} ms`]],
      msgs: [
        { from: 0, to: 1, label: 'seg 1 (seq 1)', note: 'Segment 1 arrives.' },
        { from: 1, to: 0, label: 'ack 1461', note: 'The receiver acknowledges it.' },
        { from: 0, to: 1, label: 'seg 2 (seq 1461)', note: 'Segment 2 is dropped by a congested router.', lost: true },
        { from: 0, to: 0, label: `RTO timer ${rto} ms`, note: `No ACK arrives. The retransmission timeout is SRTT + 4×RTTVAR, here ${rto} ms from recent samples.`, tone: 'warn', gap: 1, detail: d('RTO (RFC 6298)', 'SRTT and RTTVAR are smoothed averages of measured RTTs. RTO = SRTT + 4·RTTVAR, at least 200 ms on Linux (1 s in the RFC). Each timeout doubles it.', `samples ${RTT_SAMPLES.join(', ')} ms\n${est.map((e) => `srtt ${e.srtt}  rttvar ${e.rttvar}  rto ${e.rto}`).join('\n')}`), rows: [['RTO', `${rto} ms`, 'warn']] },
        { from: 0, to: 1, label: 'seg 2 again', note: 'The sender retransmits and doubles the RTO in case the network is really in trouble.', tone: 'ok', rows: [['next RTO', `${rto * 2} ms`]] },
        { from: 1, to: 0, label: 'ack 2921', note: 'Recovered, but only after a whole timeout, and congestion control drops cwnd to 1.', tone: 'ok', rows: [['cwnd', '1 MSS', 'warn']] },
      ],
      outro: 'Timeouts are the slow path. A tail loss on a short response can add hundreds of milliseconds to p99 latency.',
    });
  },
  fastrtx: () =>
    laneFrames({
      lanes: ['sender', 'receiver'],
      panel: 'Fast retransmit',
      intro: 'When later segments keep arriving, the receiver can signal a gap long before any timer fires.',
      msgs: [
        { from: 0, to: 1, label: 'seg 2', note: 'Segment 2 is lost.', lost: true },
        { from: 0, to: 1, label: 'seg 3', note: 'Segment 3 arrives out of order.' },
        { from: 1, to: 0, label: 'dup ack 1461', note: 'The receiver repeats its last ACK: it still wants byte 1461.', tone: 'warn', detail: d('Duplicate ACK', 'Same ack number again: "I got something, but not what I need next". SACK options also list which later ranges arrived.', 'Flags [.], ack 1461, options [sack 1 {2921:4381}]'), rows: [['dup acks', 1]] },
        { from: 0, to: 1, label: 'seg 4', note: 'More segments, more duplicates.' },
        { from: 1, to: 0, label: 'dup ack 1461', note: 'Second duplicate.', tone: 'warn', rows: [['dup acks', 2]] },
        { from: 0, to: 1, label: 'seg 5', note: 'Segment 5 arrives too.' },
        { from: 1, to: 0, label: 'dup ack 1461', note: 'Three duplicates is the signal.', tone: 'warn', rows: [['dup acks', 3, 'warn']] },
        { from: 0, to: 1, label: 'seg 2 (fast rtx)', note: 'The sender resends segment 2 right away, without waiting for the RTO.', tone: 'ok' },
        { from: 1, to: 0, label: 'ack 7301', note: 'One ACK now covers everything through segment 5. cwnd halves instead of dropping to 1.', tone: 'ok', rows: [['recovered in', '~1 RTT', 'ok'], ['cwnd', 'halved']] },
      ],
      outro: 'Fast retransmit needs enough data after the loss. Small responses rarely have it, which is why tail losses hurt.',
    }),
  hol: () =>
    laneFrames({
      lanes: ['sender', 'receiver kernel', 'app'],
      panel: 'Head-of-line blocking',
      intro: 'TCP delivers bytes in order. One lost segment holds back everything behind it.',
      msgs: [
        { from: 0, to: 1, label: 'seg 1', note: 'Segment 1 arrives.' },
        { from: 1, to: 2, label: 'bytes 1–1460', note: 'The app reads it immediately.', tone: 'ok' },
        { from: 0, to: 1, label: 'seg 2', note: 'Segment 2 is lost.', lost: true },
        { from: 0, to: 1, label: 'seg 3, 4, 5', note: 'Segments 3 to 5 arrive fine.' },
        { from: 1, to: 1, label: 'buffered, not deliverable', note: 'The kernel holds them: it can\'t hand over bytes past a gap.', tone: 'warn', rows: [['buffered', '4380 B', 'warn'], ['app waiting', 'yes', 'warn']] },
        { from: 0, to: 1, label: 'seg 2 (retransmit)', note: 'The retransmission finally fills the gap.', tone: 'ok' },
        { from: 1, to: 2, label: 'bytes 1461–7300', note: 'Everything is released to the app at once.', tone: 'ok', rows: [['stall', '≥ 1 RTT', 'warn']] },
      ],
      outro: 'With HTTP/2, every stream shares one TCP connection, so one loss stalls all of them. QUIC fixes this.',
    }),
};

machineDemo({
  slug: 'nw-tcp-loss',
  title: 'Loss & retransmission',
  group: 'net-tcp',
  summary: 'RTO timers from smoothed RTT, fast retransmit on three duplicate ACKs, and head-of-line blocking.',
  inputs: [
    { id: 'rto', label: 'Timeout (RTO)', data: { k: 'rto' } },
    { id: 'fastrtx', label: 'Fast retransmit', data: { k: 'fastrtx' } },
    { id: 'hol', label: 'Head-of-line', data: { k: 'hol' } },
  ],
  build: ({ k }: { k: string }) => loss[k](),
});

// ---------------- congestion window ----------------
const CW: Record<string, { rounds: number; loss: Record<number, 'dupack' | 'timeout'>; ss: number; intro: string; outro: string }> = {
  slowstart: { rounds: 10, loss: {}, ss: 32, intro: 'A new connection doesn\'t know the path capacity. cwnd starts at 1 segment (10 on modern Linux) and grows.', outro: 'Slow start is exponential, then congestion avoidance adds one MSS per RTT. Short transfers finish before cwnd ever gets big.' },
  aimd: { rounds: 16, loss: { 8: 'dupack', 13: 'dupack' }, ss: 16, intro: 'Congestion avoidance probes gently for bandwidth. Loss signals it went too far.', outro: 'Additive increase, multiplicative decrease: the sawtooth. Many flows sharing a link converge to a fair share this way.' },
  timeout: { rounds: 14, loss: { 7: 'timeout' }, ss: 64, intro: 'A retransmission timeout is treated as severe congestion.', outro: 'After a timeout cwnd restarts at 1 and slow-starts up to half the old window. That is why RTOs hurt so much more than fast retransmits.' },
};

function cwndFrames(k: string): Frame[] {
  const c = CW[k];
  const pts = cwndTrace(c.rounds, c.loss, c.ss);
  const max = Math.max(...pts.map((p) => Math.max(p.cwnd, p.ssthresh <= 64 ? p.ssthresh : 0))) + 2;
  const f = new Film();
  const legend = (): Shape[] => [
    text('lg1', 560, 120, '■ cwnd (MSS)', { align: 'left', size: 26, tone: 'read' }),
    text('lg2', 560, 160, '- - ssthresh', { align: 'left', size: 26, tone: 'warn' }),
  ];
  const chart = (upto: number): Shape[] => {
    const bars = pts.slice(0, upto + 1).map((p) => ({ value: p.cwnd, tone: (p.event ? 'fail' : p.phase === 'slow start' ? 'read' : 'write') as Tone, label: String(p.cwnd) }));
    const s = barChart('c', bars, max, { axis: 'round trips →', yAxis: 'cwnd', threshold: pts.slice(0, upto + 1).map((p) => (p.ssthresh <= max ? p.ssthresh : undefined)) });
    const head = box('cw', 20, 30, 500, 110, `cwnd ${pts[upto].cwnd} MSS`, { sub: pts[upto].phase, mono: true, tone: pts[upto].event ? 'fail' : 'current' });
    if (head.t === 'rect') head.detail = d('Congestion window', 'How many unacknowledged bytes the sender allows in flight, set by the sender from loss signals. The receiver\'s window (rwnd) is a separate limit; the smaller wins.', '$ ss -ti dst 93.184.216.34\n  cubic wscale:7,7 rto:204 rtt:3.1/1.2\n  mss:1448 cwnd:10 ssthresh:7 bytes_acked:…');
    return [head, ...legend(), ...s];
  };
  f.add(c.intro, chart(0), panel('Congestion', [['cwnd', pts[0].cwnd], ['ssthresh', pts[0].ssthresh]]));
  pts.forEach((p, i) => {
    if (i === 0) return;
    const prev = pts[i - 1];
    const note = prev.event === 'dupack' ? `Three dup ACKs in round ${i - 1}: ssthresh and cwnd drop to half, ${p.cwnd}.` : prev.event === 'timeout' ? `Timeout in round ${i - 1}: ssthresh halves to ${p.ssthresh} and cwnd restarts at 1.` : p.phase === 'slow start' || prev.phase === 'slow start' ? `Slow start: every ACK adds one MSS, so cwnd doubles per round trip to ${p.cwnd}.` : `Congestion avoidance: one more MSS per round trip, ${p.cwnd}.`;
    f.add(note, chart(i), panel('Congestion', [['round', i], ['cwnd', p.cwnd, p.event ? 'fail' : undefined], ['ssthresh', p.ssthresh], ['phase', p.phase]]));
  });
  f.add(c.outro, chart(pts.length - 1), panel('Congestion', [['rounds', pts.length], ['losses', Object.keys(c.loss).length]]));
  return f.frames;
}

function bbrFrames(): Frame[] {
  const f = new Film();
  const bdp = bdpBytes(100, 40);
  const segs = Math.round(bdp / 1460);
  const pipe = (fill: number, queue: number, tone: Tone): Shape[] => {
    const out: Shape[] = [text('pl', 40, 250, 'the pipe: 100 Mbit/s × 40 ms RTT', { align: 'left', size: 28, bold: true })];
    out.push(box('pipe', 40, 300, 700, 160, undefined, { tone: 'default', filled: false }));
    out.push(box('fill', 44, 304, Math.max(8, 692 * Math.min(1, fill)), 152, fill >= 1 ? 'full' : `${Math.round(fill * 100)}%`, { tone }));
    out.push(box('q', 760, 300, 200, 160, queue ? `queue ${queue}` : 'queue', { tone: queue > 0 ? 'warn' : 'default', sub: queue ? '+ latency' : 'empty' }));
    return out;
  };
  const card = (label: string, sub: string, tone: Tone) => {
    const b = box('bdp', 40, 560, 920, 160, label, { sub, mono: true, tone });
    if (b.t === 'rect') b.detail = d('Bandwidth-delay product', 'The bytes that must be in flight to keep a link busy: bandwidth × RTT. Buffers (and windows) smaller than this cap throughput.', `100 Mbit/s × 40 ms = ${bdp} B ≈ ${segs} segments\n$ sysctl net.core.rmem_max  # must exceed BDP`);
    return b;
  };
  f.add(`To fill this path the sender needs one bandwidth-delay product in flight: ${bdp} bytes, about ${segs} segments.`, [...pipe(0.2, 0, 'read'), card(`BDP = ${bdp} B`, `${segs} segments in flight`, 'current')], panel('BBR', [['BDP', `${bdp} B`]]));
  f.add('Loss-based control (Reno, CUBIC) keeps growing until a buffer overflows. The queue it builds adds latency first.', [...pipe(1, 40, 'write'), card('CUBIC: fills buffers', 'bufferbloat: RTT 40 → 120 ms', 'warn')], panel('BBR', [['RTT', '120 ms', 'warn']]));
  f.add('BBR instead measures bottleneck bandwidth and minimum RTT, and paces at exactly that rate.', [...pipe(1, 2, 'ok'), card('BBR: pace at BtlBw', 'keeps queue near empty', 'ok')], panel('BBR', [['RTT', '~41 ms', 'ok']]));
  f.add('Every few seconds BBR probes for more bandwidth, then drains. Linux: sysctl net.ipv4.tcp_congestion_control=bbr.', [...pipe(1, 6, 'ok'), card('probe, then drain', 'good on lossy long paths', 'ok')], panel('BBR', [['default in Linux', 'CUBIC']]));
  return f.frames;
}

machineDemo({
  slug: 'nw-cwnd',
  title: 'Congestion control',
  group: 'net-tcp',
  summary: 'cwnd over round trips: slow start, AIMD sawtooth, fast recovery vs timeout, and BBR with the bandwidth-delay product.',
  inputs: [
    { id: 'slowstart', label: 'Slow start', data: { k: 'slowstart' } },
    { id: 'aimd', label: 'AIMD sawtooth', data: { k: 'aimd' } },
    { id: 'timeout', label: 'After a timeout', data: { k: 'timeout' } },
    { id: 'bbr', label: 'BBR & BDP', data: { k: 'bbr' } },
  ],
  build: ({ k }: { k: string }) => (k === 'bbr' ? bbrFrames() : cwndFrames(k)),
});

// ---------------- flow control & Nagle ----------------
const flow: Record<string, () => Frame[]> = {
  rwnd: () =>
    laneFrames({
      lanes: ['fast sender', 'slow receiver'],
      panel: 'Flow control',
      intro: 'The receiver advertises how much buffer space it has left in every ACK: the receive window.',
      rows: [['rwnd', '64 KB']],
      msgs: [
        { from: 0, to: 1, label: '32 KB', note: 'The sender pushes data. The receiving app is busy and doesn\'t read.' },
        { from: 1, to: 0, label: 'ack, win=32K', note: 'Half the buffer is full, so the window shrinks.', rows: [['rwnd', '32 KB']] },
        { from: 0, to: 1, label: '32 KB', note: 'The sender fills the rest.' },
        { from: 1, to: 0, label: 'ack, win=0', note: 'Zero window: stop. The sender must wait.', tone: 'fail', detail: d('Zero window', 'The receiver\'s socket buffer is full because the application isn\'t reading. Visible in tcpdump as win 0 and in ss as a full Recv-Q.', '$ ss -tn\nESTAB 65536 0 10.0.0.9:5432 10.0.0.5:52814\n# Recv-Q full: app not reading'), rows: [['rwnd', 0, 'fail']] },
        { from: 0, to: 1, label: 'window probe', note: 'The sender probes periodically in case the update got lost.', gap: 1, tone: 'warn' },
        { from: 1, to: 0, label: 'win=48K', note: 'The app finally read 48 KB, so the window reopens.', tone: 'ok', rows: [['rwnd', '48 KB', 'ok']] },
      ],
      outro: 'Flow control protects the receiver; congestion control protects the network. The sender obeys the smaller window.',
    }),
  nagle: () =>
    laneFrames({
      lanes: ['client app', 'client kernel', 'server'],
      panel: 'Nagle + delayed ACK',
      intro: 'An app writes a request header and body in two small write() calls.',
      msgs: [
        { from: 0, to: 1, label: 'write(header, 200 B)', note: 'The first small write goes out immediately.' },
        { from: 1, to: 2, label: '200 B', note: 'The server receives the header and waits for the body.' },
        { from: 0, to: 1, label: 'write(body, 50 B)', note: 'Nagle holds this small write until the previous one is ACKed.', tone: 'warn', detail: d('Nagle\'s algorithm', 'Coalesces small writes while earlier data is unacknowledged. Great for telnet, bad for request/response protocols.', 'int one = 1;\nsetsockopt(fd, IPPROTO_TCP, TCP_NODELAY,\n           &one, sizeof one);') },
        { from: 2, to: 2, label: 'delayed ACK 40 ms', note: 'The server delays its ACK, hoping to piggyback it on a response that can\'t come yet.', tone: 'fail', gap: 1, rows: [['stall', '40 ms', 'fail']] },
        { from: 2, to: 1, label: 'ACK', note: 'The delayed ACK finally fires.' },
        { from: 1, to: 2, label: '50 B', note: 'Only now does the body go out. Every request pays 40 ms extra.', tone: 'warn', rows: [['latency added', '40 ms / request', 'fail']] },
      ],
      outro: 'Fix with one write per message (writev or buffering) or TCP_NODELAY. Most RPC frameworks and databases set NODELAY.',
    }),
};

machineDemo({
  slug: 'nw-flow',
  title: 'Flow control & Nagle',
  group: 'net-tcp',
  summary: 'The receive window and zero-window stalls, and the Nagle + delayed-ACK 40 ms trap with TCP_NODELAY.',
  inputs: [
    { id: 'rwnd', label: 'Receive window', data: { k: 'rwnd' } },
    { id: 'nagle', label: 'Nagle + delayed ACK', data: { k: 'nagle' } },
  ],
  build: ({ k }: { k: string }) => flow[k](),
});

// ---------------- UDP & QUIC ----------------
const QUICD = d('QUIC', 'A transport over UDP with TLS 1.3 built in: encrypted headers, independent streams, connection IDs. HTTP/3 runs on it.', '$ curl --http3 -v https://cloudflare.com\n* using HTTP/3\n* QUIC cipher selection: TLS_AES_128_GCM_SHA256');

const quic: Record<string, () => Frame[]> = {
  udp: () =>
    laneFrames({
      lanes: ['client', 'server'],
      panel: 'UDP',
      intro: 'UDP sends datagrams with no handshake and no delivery guarantee.',
      msgs: [
        { from: 0, to: 1, label: 'DNS query (1 datagram)', note: 'A DNS query is one datagram. No connection setup at all.', detail: d('UDP send', 'sendto() hands one datagram to the kernel. It may be lost, duplicated or reordered, and nobody tells you.', 'int fd = socket(AF_INET, SOCK_DGRAM, 0);\nsendto(fd, buf, len, 0, (sockaddr*)&dns, sizeof dns);') },
        { from: 1, to: 0, label: 'answer', note: 'The answer arrives. Total: one round trip.', tone: 'ok' },
        { from: 0, to: 1, label: 'query 2', note: 'The next query is lost. UDP doesn\'t notice.', lost: true },
        { from: 0, to: 0, label: 'app timer → retry', note: 'The application must time out and retry itself. DNS resolvers retry after about a second.', tone: 'warn', gap: 1 },
        { from: 0, to: 1, label: 'query 2 again', note: 'The app-level retry succeeds.', tone: 'ok' },
      ],
      outro: 'UDP gives you the network raw. Use it when you want to decide reliability yourself: DNS, games, VoIP, QUIC.',
    }),
  'tcp-tls': () =>
    laneFrames({
      lanes: ['client', 'server'],
      panel: 'TCP + TLS 1.3',
      intro: 'HTTPS over TCP needs two handshakes before the first request.',
      msgs: [
        { from: 0, to: 1, label: 'SYN', note: 'TCP handshake first.' },
        { from: 1, to: 0, label: 'SYN-ACK', note: 'One round trip for TCP.', rows: [['RTTs', 1]] },
        { from: 0, to: 1, label: 'ACK + ClientHello', note: 'Then TLS 1.3 starts on top.' },
        { from: 1, to: 0, label: 'ServerHello … Finished', note: 'A second round trip for TLS.', rows: [['RTTs', 2]] },
        { from: 0, to: 1, label: 'Finished + GET /', note: 'Only now can the request go out.', tone: 'ok' },
        { from: 1, to: 0, label: '200 OK', note: 'The response arrives after three round trips in total.', tone: 'ok', rows: [['RTTs to response', 3, 'warn']] },
      ],
      outro: 'At 100 ms RTT that is 300 ms before the first byte of content, on every new connection.',
    }),
  quic: () =>
    laneFrames({
      lanes: ['client', 'server'],
      laneDetails: [QUICD, QUICD],
      panel: 'QUIC',
      intro: 'QUIC merges the transport and TLS handshakes into one.',
      msgs: [
        { from: 0, to: 1, label: 'Initial: ClientHello', note: 'The first UDP packet carries the TLS ClientHello with a key share.' },
        { from: 1, to: 0, label: 'ServerHello + cert + Finished', note: 'The server answers with everything in one flight.', rows: [['RTTs', 1]] },
        { from: 0, to: 1, label: 'Finished + GET /', note: 'The request goes out after one round trip.', tone: 'ok' },
        { from: 1, to: 0, label: '200 OK', note: 'Response after two round trips instead of three.', tone: 'ok', rows: [['RTTs to response', 2, 'ok']] },
        { from: 0, to: 1, label: '0-RTT: ClientHello + GET /', note: 'On a return visit the client resumes with a saved key and sends the request in the very first packet.', tone: 'ok', gap: 1, detail: d('0-RTT resumption', 'Early data encrypted with a key from a previous session. It can be replayed by an attacker, so only idempotent requests (GET) should use it.'), rows: [['RTTs to request', 0, 'ok']] },
        { from: 1, to: 0, label: '200 OK', note: 'One round trip to the response, total.', tone: 'ok', rows: [['RTTs to response', 1, 'ok']] },
      ],
      outro: '0-RTT data can be replayed, so servers accept it only for idempotent requests.',
    }),
  streams: () =>
    laneFrames({
      lanes: ['client', 'server'],
      panel: 'QUIC streams',
      intro: 'Three HTTP/3 requests share one QUIC connection as independent streams.',
      msgs: [
        { from: 1, to: 0, label: 'stream 1: css', note: 'Stream 1 data is lost.', lost: true },
        { from: 1, to: 0, label: 'stream 2: js', note: 'Stream 2 arrives and is delivered right away.', tone: 'ok', rows: [['stream 2', 'delivered', 'ok']] },
        { from: 1, to: 0, label: 'stream 3: img', note: 'Stream 3 arrives and is delivered too.', tone: 'ok', rows: [['stream 3', 'delivered', 'ok']] },
        { from: 0, to: 1, label: 'ACK (gap in stream 1)', note: 'QUIC ACKs report exactly which packets are missing.' },
        { from: 1, to: 0, label: 'stream 1 (resent)', note: 'Only stream 1 waited for its retransmission.', tone: 'ok', rows: [['blocked streams', 1]] },
      ],
      outro: 'Loss now blocks only the stream it hit. Over TCP the same loss would stall all three responses.',
    }),
  migration: () =>
    laneFrames({
      lanes: ['phone', 'server'],
      panel: 'Connection migration',
      intro: 'A TCP connection is its 4-tuple, so a new IP means a new connection. QUIC uses a connection ID instead.',
      msgs: [
        { from: 0, to: 1, label: 'Wi-Fi 192.168.1.20 · CID 7f', note: 'The phone is on Wi-Fi, downloading.' },
        { from: 0, to: 0, label: 'walks outside → 5G', note: 'The phone switches to cellular and gets a new IP.', tone: 'warn', gap: 1 },
        { from: 0, to: 1, label: '5G 100.64.3.9 · CID 7f', note: 'Packets arrive from a new address but with the same connection ID.', tone: 'ok', detail: d('Connection ID', 'An opaque id chosen by each side. Load balancers route QUIC by CID so a migrated connection reaches the same server.') },
        { from: 1, to: 0, label: 'path challenge', note: 'The server validates the new path, then continues the same connection.', tone: 'ok' },
        { from: 1, to: 0, label: 'data continues', note: 'No reconnect, no new handshake, no restarted download.', tone: 'ok', rows: [['reconnects', 0, 'ok']] },
      ],
      outro: 'TCP would have reset and redone TCP + TLS handshakes. This matters most on mobile.',
    }),
};

machineDemo({
  slug: 'nw-quic',
  title: 'UDP & QUIC',
  group: 'net-quic',
  summary: 'Datagrams without guarantees, TCP+TLS vs QUIC handshakes, 0-RTT, independent streams, connection migration.',
  inputs: [
    { id: 'udp', label: 'UDP', data: { k: 'udp' } },
    { id: 'tcp-tls', label: 'TCP + TLS', data: { k: 'tcp-tls' } },
    { id: 'quic', label: 'QUIC handshake', data: { k: 'quic' } },
    { id: 'streams', label: 'Streams', data: { k: 'streams' } },
    { id: 'migration', label: 'Migration', data: { k: 'migration' } },
  ],
  build: ({ k }: { k: string }) => quic[k](),
});

