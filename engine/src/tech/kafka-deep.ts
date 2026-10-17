// Kafka internals (group tech-kafka): storage, replication, exactly-once and consumer group protocol.
// Each scene is a picture rebuilt from the knobs under the stage; protocol walk-throughs (KRaft, the transaction
// coordinator, JoinGroup/SyncGroup) stay as line traces.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, line, panel, text } from '../machine/lib/draw';
import type { Row } from '../machine/lib/draw';
import { cap, choice, liveGroup, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const liveDemo = liveGroup('tech-kafka');
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const kraftTrace: Trace = {
  codeTitle: 'controller.properties',
  code: ['process.roles=controller', 'node.id=1', 'controller.quorum.voters=1@c1:9093,2@c2:9093,3@c3:9093', 'broker.session.timeout.ms=9000'],
  stackTitle: 'nodes',
  heapTitle: '__cluster_metadata',
  details: {
    c1: D('Active controller', 'The Raft leader of the metadata quorum. It alone writes metadata records and answers broker heartbeats.'),
    m2: D('Metadata records', 'Every change is a record: TopicRecord, PartitionRecord, PartitionChangeRecord, BrokerRegistration, FenceBroker. Snapshots let new nodes skip the old log.', 'kafka-metadata-shell.sh --snapshot 00000000000000001000-0000000003.checkpoint'),
    b1: D('Brokers as observers', 'Brokers fetch the metadata log but do not vote. Each tracks its offset, so it only applies what is new.'),
  },
  steps: [
    { note: 'Three controllers run Raft on the __cluster_metadata log. c1 is the leader, called the active controller.', line: 2, vars: [['c1', 'active · epoch 7', 'current'], ['c2', 'voter', 'read'], ['c3', 'voter', 'read']], heap: [['m1', '100 RegisterBroker b1', 'visited']], out: '' },
    { note: 'Creating a topic appends TopicRecord and PartitionRecord. They commit once a majority of voters has them.', line: 2, vars: [['c1', 'append 101–102', 'write'], ['c2', 'fetched 102', 'ok'], ['c3', 'fetching', 'muted']], heap: [['m1', '100 RegisterBroker b1', 'visited'], ['m2', '101 TopicRecord orders', 'ok', 'committed'], ['m3', '102 PartitionRecord P0', 'ok', 'committed']], out: 'committed 102 (2 of 3)' },
    { note: 'Brokers replicate the same log as observers and update their metadata cache. They apply only new records, not a full reload.', line: 2, vars: [['c1', 'active · epoch 7', 'current'], ['b1', 'observer @102', 'read', 'm3'], ['b2', 'observer @102', 'read', 'm3']], heap: [['m1', '100 RegisterBroker b1', 'visited'], ['m2', '101 TopicRecord orders', 'ok'], ['m3', '102 PartitionRecord P0', 'ok']], out: 'committed 102 (2 of 3)' },
    { note: 'b2 misses heartbeats for broker.session.timeout.ms. The controller fences it and writes new leaders for its partitions.', line: 3, vars: [['c1', 'active · epoch 7', 'current'], ['b1', 'observer @104', 'read'], ['b2', 'fenced', 'fail']], heap: [['m3', '102 PartitionRecord P0', 'visited'], ['m4', '103 FenceBroker b2', 'warn'], ['m5', '104 PartitionChange P0', 'write', 'leader b1']], out: 'committed 104' },
    { note: 'c1 dies. c2 and c3 elect c2 in epoch 8, and it already holds the full log, so it takes over at once.', line: 2, vars: [['c1', 'dead', 'fail'], ['c2', 'active · epoch 8', 'ok'], ['c3', 'voter', 'read']], heap: [['m4', '103 FenceBroker b2', 'visited'], ['m5', '104 PartitionChange P0', 'visited'], ['m6', '105 LeaderChange c2', 'ok']], out: 'committed 104\nnew active controller c2' },
  ],
};

const txnTrace: Trace = {
  codeTitle: 'Processor.java',
  code: ['producer.initTransactions();', 'producer.beginTransaction();', 'producer.send(new ProducerRecord<>("out", k, v));', 'producer.sendOffsetsToTransaction(offsets, group);', 'producer.commitTransaction();'],
  stackTitle: 'actors',
  heapTitle: 'logs',
  details: {
    coord: D('Transaction coordinator', 'The broker leading the __transaction_state partition that transactional.id hashes to. It stores each transaction’s state and partitions.'),
    o0: D('Control markers', 'COMMIT and ABORT markers are control batches written into every partition the transaction touched. Consumers never return them as records.'),
    zombie: D('Fencing', 'initTransactions bumps the epoch for the transactional.id. Writes from an older producer with the same id fail with ProducerFenced.', 'transactional.id=orders-processor-7'),
  },
  steps: [
    { note: 'initTransactions finds the coordinator for the transactional.id and bumps its epoch. An older instance with the same id is now fenced.', line: 0, vars: [['producer', 'PID 42 · epoch 3', 'current'], ['coord', 'broker 2', 'read', 'ts'], ['zombie', 'epoch 2 · fenced', 'fail']], heap: [['ts', 'txn: Empty', 'read', '__transaction_state']], out: '' },
    { note: 'Before the first write to a partition, the producer registers it with the coordinator. The state becomes Ongoing.', line: [1, 2], vars: [['producer', 'AddPartitionsToTxn', 'current'], ['coord', 'broker 2', 'read', 'ts']], heap: [['ts', 'Ongoing: out-0, offsets-12', 'write'], ['o0', 'out-0: record (txn)', 'write']], out: '' },
    { note: 'The consumed offsets go to __consumer_offsets inside the same transaction. They commit or abort together with the output.', line: 3, vars: [['producer', 'send offsets', 'current'], ['coord', 'broker 2', 'read', 'ts']], heap: [['ts', 'Ongoing: out-0, offsets-12', 'read'], ['o0', 'out-0: record (txn)', 'read'], ['o1', 'offsets-12: in=81 (txn)', 'write']], out: '' },
    { note: 'commitTransaction makes the coordinator log PrepareCommit. From here the transaction will commit even if the producer dies.', line: 4, vars: [['producer', 'commit', 'current'], ['coord', 'broker 2', 'accent', 'ts']], heap: [['ts', 'PrepareCommit', 'protocol'], ['o0', 'out-0: record (txn)', 'read'], ['o1', 'offsets-12: in=81 (txn)', 'read']], out: 'PrepareCommit logged' },
    { note: 'The coordinator writes a COMMIT marker into each partition, then logs CompleteCommit. Aborting writes ABORT markers instead and the data stays in the log.', line: 4, vars: [['producer', 'done', 'ok'], ['coord', 'broker 2', 'ok', 'ts']], heap: [['ts', 'CompleteCommit', 'ok'], ['o0', 'out-0: record + COMMIT', 'ok'], ['o1', 'offsets-12: in=81 + COMMIT', 'ok']], out: 'PrepareCommit logged\nmarkers written\nCompleteCommit' },
  ],
};

const joinTrace: Trace = {
  codeTitle: 'consumer.properties',
  code: ['group.id=billing', 'partition.assignment.strategy=CooperativeStickyAssignor', 'session.timeout.ms=45000', 'heartbeat.interval.ms=3000'],
  stackTitle: 'members',
  heapTitle: 'coordinator',
  details: {
    coord: D('Group coordinator', 'The broker leading the __consumer_offsets partition that hash(group.id) maps to. It tracks members, the generation and committed offsets.'),
    c1: D('Group leader', 'The first member to join. It runs the assignor on the client, so custom strategies need no broker change. In the newer protocol (group.protocol=consumer, KIP-848) the coordinator assigns instead.'),
  },
  steps: [
    { note: 'FindCoordinator hashes group.id to a __consumer_offsets partition. Its leader, broker 2, is the group coordinator.', line: 0, vars: [['c1', 'FindCoordinator', 'current'], ['c2', 'FindCoordinator', 'current']], heap: [['coord', 'broker 2 · billing', 'accent'], ['gen', 'generation 0', 'read']], out: '' },
    { note: 'Both send JoinGroup. The coordinator waits for members, bumps the generation and names c1 the group leader.', line: 0, vars: [['c1', 'leader · gen 1', 'accent'], ['c2', 'member · gen 1', 'read']], heap: [['coord', 'broker 2 · billing', 'accent'], ['gen', 'generation 1', 'write']], out: 'JoinGroup → gen 1, leader c1' },
    { note: 'c1 runs the assignor and sends the plan in SyncGroup. The coordinator hands each member its share.', line: 1, vars: [['c1', 'P0 P1 P2', 'ok'], ['c2', 'P3 P4 P5', 'ok']], heap: [['coord', 'broker 2 · billing', 'accent'], ['gen', 'generation 1', 'read']], out: 'JoinGroup → gen 1, leader c1\nSyncGroup → assignments' },
    { note: 'Members heartbeat every 3 s from a background thread. Missing session.timeout.ms or max.poll.interval.ms starts a rebalance.', line: [2, 3], vars: [['c1', 'heartbeat', 'read'], ['c2', 'silent 45 s', 'fail']], heap: [['coord', 'rebalancing', 'warn'], ['gen', 'generation 2', 'write']], out: 'SyncGroup → assignments\nc2 expired → rebalance' },
    { note: 'Offset commits carry the generation. A late commit from c2’s old generation is rejected, so it cannot overwrite the new owner’s progress.', line: 0, vars: [['c1', 'P0–P5 · gen 2', 'ok'], ['c2', 'commit gen 1', 'fail']], heap: [['coord', 'broker 2 · billing', 'accent'], ['gen', 'generation 2', 'read']], out: 'c2 expired → rebalance\nILLEGAL_GENERATION' },
  ],
};

interface Cell {
  label: string;
  sub?: string;
  tone?: Tone;
  dashed?: boolean;
}

/** a horizontal log: one box per offset, offset numbers underneath */
function logRow(pre: string, title: string, cells: (Cell | undefined)[], y: number, o: { x0?: number; w?: number; first?: number; titleTone?: Tone } = {}): Shape[] {
  const x0 = o.x0 ?? 180;
  const w = o.w ?? 1000 - x0 - 20;
  const cw = w / Math.max(1, cells.length);
  const out: Shape[] = [text(`${pre}t`, 30, y + 46, title, { align: 'left', size: 24, bold: true, tone: o.titleTone ?? 'muted' })];
  cells.forEach((c, i) => {
    if (c) out.push(box(`${pre}${i}`, x0 + i * cw + 2, y, cw - 4, 76, c.label, { sub: c.sub, mono: true, tone: c.tone ?? 'default', dashed: c.dashed }));
    out.push(text(`${pre}n${i}`, x0 + i * cw + cw / 2, y + 98, String((o.first ?? 0) + i), { size: 18, mono: true, tone: 'muted' }));
  });
  return out;
}

/** a vertical marker between offsets `at - 1` and `at` */
const mark = (id: string, x0: number, cw: number, at: number, y0: number, y1: number, label: string, tone: Tone, below = false): Shape[] => {
  const x = x0 + at * cw;
  return [line(id, x, y0, x, y1, tone, { width: 4 }), text(`${id}t`, x > 900 ? x - 6 : x, below ? y1 + 26 : y0 - 10, label, { size: 22, bold: true, tone, align: x > 900 ? 'right' : 'center' })];
};

// ---------------- storage: segments & index, page cache, compaction ----------------
const SEG_BASE = 368769;
const LEO = 368900;
const INDEX = [
  [0, 0],
  [41, 4096],
  [87, 8210],
  [119, 12290],
];
const OFFSETS = ['120', '368770', '368870', '368900'];

function segments(p: P): Frame[] {
  const off = Number(pick(p.off, OFFSETS, '368870'));
  const inOld = off < SEG_BASE;
  const atEnd = off >= LEO;
  const base = inOld ? 0 : SEG_BASE;
  const rel = off - base;
  const idx = inOld ? [[0, 0], [45, 4096], [93, 8190], [140, 12280]] : INDEX;
  const hit = [...idx].reverse().find(([r]) => r <= rel)!;
  const f = new Film();
  const seg = (tone0: Tone, tone1: Tone): Shape[] => [
    box('old', 40, 140, 440, 110, '00000000000000000000.log', { sub: 'offsets 0 – 368768 · closed', mono: true, tone: tone0 }),
    box('active', 520, 140, 440, 110, '00000000000000368769.log', { sub: `368769 – ${LEO - 1} · appending`, mono: true, tone: tone1 }),
  ];
  const index = (hl?: number, probe?: number[]): Shape[] => [
    text('it', 40, 330, `${base}.index · relative offset → byte position`, { align: 'left', size: 24, bold: true, tone: 'muted' }),
    ...idx.map(([r, b], k) => box(`i${k}`, 40 + k * 230, 350, 210, 90, `${r} → ${b}`, { mono: true, tone: k === hl ? 'ok' : probe?.includes(k) ? 'current' : 'default' })),
  ];
  const segTone = (want: boolean): Tone => (want ? 'current' : 'visited');
  f.add('A partition is a directory of segment files, each named after the first offset it holds. Only the newest takes appends.', [...cap('ls /var/kafka/orders-0/'), ...seg('visited', 'accent')], panel('Segments', [['segments', 2], ['log end offset', LEO]]));
  if (atEnd) {
    f.add(`Offset ${off} is the log end offset: nothing has been written there yet.`, [...cap(`fetch(offset=${off})`), ...seg('visited', 'current')], panel('Segments', [['fetch', off], ['LEO', LEO, 'warn']]));
    f.add('The broker holds the fetch open (fetch.max.wait.ms) and answers as soon as a producer appends: long polling, not busy polling.', [...cap('fetch.max.wait.ms=500'), ...seg('visited', 'ok')], panel('Segments', [['response', 'waits for data', 'ok']]));
    return f.frames;
  }
  f.add(`Fetch offset ${off}: pick the segment with the largest base offset at or below it, ${base}. Relative offset ${rel}.`, [...cap(`fetch(offset=${off})`), ...seg(segTone(inOld), segTone(!inOld))], panel('Lookup', [['segment', base], ['relative', rel]]));
  f.add(`Its .index is sparse: one 8-byte entry about every 4 KiB of log, so it stays small enough to memory-map.`, [...cap(`${base}.index (mmap)`), ...seg(segTone(inOld), segTone(!inOld)), ...index()], panel('Lookup', [['entries', idx.length], ['interval', '4 KiB']]));
  const k = idx.indexOf(hit);
  f.add(`Binary search finds entry ${hit[0]}, the last one at or below ${rel}: start reading at byte ${hit[1]}.`, [...cap(`binarySearch(index, ${rel})`), ...seg(segTone(inOld), segTone(!inOld)), ...index(k, [1, 2])], panel('Lookup', [['entry', `${hit[0]} → ${hit[1]}`, 'ok']]));
  f.add(`Scan the .log forward from byte ${hit[1]} to the batch holding relative offset ${rel}: a few KiB at most. Retention deletes whole closed segments, never single records.`, [...cap(`read ${base}.log from byte ${hit[1]}`), ...seg(segTone(inOld), segTone(!inOld)), ...index(k), box('scan', 40 + k * 230, 470, 400, 80, `scan → offset ${off}`, { mono: true, tone: 'ok' })], panel('Lookup', [['found', off, 'ok'], ['disk seeks', 1, 'ok']]));
  return f.frames;
}

function zerocopy(p: P): Frame[] {
  const send = pick(p.path, ['copy', 'sendfile'], 'sendfile') === 'sendfile';
  const lag = pick(p.reader, ['tail', 'laggard'], 'tail') === 'laggard';
  const f = new Film();
  const scene = (stmt: string, o: { cache?: Tone; disk?: Tone; buf?: boolean; sock?: Tone; nic?: Tone; flow?: [string, string, Tone][] } = {}): Shape[] => {
    const out: Shape[] = [...cap(stmt), box('user', 20, 110, 960, 200, undefined, { tone: 'muted', filled: false }), text('ut', 40, 138, 'user space · broker JVM', { align: 'left', size: 22, bold: true, tone: 'muted' }), box('kern', 20, 330, 960, 420, undefined, { tone: 'muted', filled: false }), text('kt', 40, 358, 'kernel', { align: 'left', size: 22, bold: true, tone: 'muted' })];
    out.push(box('buf', 360, 170, 280, 100, 'byte[] buffer', { sub: o.buf ? 'a copy of the batch' : 'unused', mono: true, tone: o.buf ? 'warn' : 'muted', dashed: !o.buf }));
    out.push(box('cache', 60, 420, 280, 110, 'page cache', { sub: 'recent batches in RAM', mono: true, tone: o.cache ?? 'default' }));
    out.push(box('sock', 660, 420, 280, 110, 'socket buffer', { mono: true, tone: o.sock ?? 'default' }));
    out.push(box('disk', 60, 820, 280, 110, 'disk', { sub: 'segment files', mono: true, tone: o.disk ?? 'muted' }), box('nic', 660, 820, 280, 110, 'NIC', { sub: 'to the consumer', mono: true, tone: o.nic ?? 'muted' }));
    const at: Record<string, [number, number]> = { cache: [200, 475], buf: [500, 220], sock: [800, 475], disk: [200, 875], nic: [800, 875] };
    (o.flow ?? []).forEach(([a, b, t], i) => out.push(arrow(`fl${i}`, at[a][0], at[a][1] + (at[b][1] > at[a][1] ? 56 : -56), at[b][0], at[b][1] + (at[b][1] > at[a][1] ? -56 : 56), t, { width: 5 })));
    return out;
  };
  f.add('A produce request lands in the page cache and returns. Kafka does not fsync each batch: durability comes from replication, and the kernel flushes later.', scene('append(batch 42)', { cache: 'write' }), panel('Fetch path', [['fsync', 'no', 'ok']]));
  if (lag) f.add('This consumer is days behind. Its batch left the page cache long ago, so it is read from disk, and those pages push out what tail readers need.', scene('fetch(offset from 3 days ago)', { disk: 'warn', cache: 'warn', flow: [['disk', 'cache', 'warn']] }), panel('Fetch path', [['source', 'disk', 'warn'], ['cache', 'churn', 'warn']]));
  else f.add('A consumer at the tail asks for batch 42 moments later. It is still in the page cache: no disk read at all.', scene('fetch(batch 42)', { cache: 'ok' }), panel('Fetch path', [['source', 'page cache', 'ok']]));
  if (send) f.add('transferTo calls sendfile: the kernel hands page-cache pages straight to the socket. The bytes never enter the JVM.', scene('FileChannel.transferTo → sendfile(socket, file, …)', { cache: 'ok', sock: 'ok', nic: 'ok', flow: [['cache', 'sock', 'ok'], ['sock', 'nic', 'ok']] }), panel('Fetch path', [['CPU copies', 0, 'ok'], ['JVM garbage', 'none', 'ok']]));
  else f.add('The classic path read()s into a JVM buffer and write()s it back out: the bytes cross the kernel boundary twice.', scene('n = read(file, buf); write(socket, buf, n);', { cache: 'default', buf: true, sock: 'warn', nic: 'default', flow: [['cache', 'buf', 'warn'], ['buf', 'sock', 'warn'], ['sock', 'nic', 'default']] }), panel('Fetch path', [['CPU copies', 2, 'warn'], ['JVM garbage', 'a buffer per fetch', 'warn']]));
  f.add(send ? 'This works because batches are stored exactly as producers sent them. TLS must encrypt in user space, so it loses sendfile.' : 'sendfile skips both copies. Kafka can use it because the broker never needs to read or change the bytes.', scene(send ? '// ssl.* forces the copy path' : '// use transferTo', send ? { cache: 'ok', sock: 'ok', nic: 'ok', flow: [['cache', 'sock', 'ok'], ['sock', 'nic', 'ok']] } : { buf: true, sock: 'warn', flow: [['cache', 'buf', 'warn'], ['buf', 'sock', 'warn']] }), panel('Fetch path', [['copies', send ? 0 : 2, send ? 'ok' : 'warn'], ['disk reads', lag ? 'yes' : 'none', lag ? 'warn' : 'ok']]));
  return f.frames;
}

function compaction(p: P): Frame[] {
  const tomb = pick(p.u2, ['null', 'Bea'], 'null') === 'null';
  const recs = [
    { k: 'u1', v: 'Ann' },
    { k: 'u2', v: 'Bo' },
    { k: 'u3', v: 'Cy' },
    { k: 'u1', v: 'Anna' },
    { k: 'u3', v: 'Cyd' },
    { k: 'u2', v: tomb ? 'null' : 'Bea' },
  ];
  const latest = new Map<string, number>();
  recs.forEach((r, i) => latest.set(r.k, i));
  const f = new Film();
  const cells = (o: { dropped?: boolean; tombGone?: boolean; map?: boolean } = {}): (Cell | undefined)[] =>
    recs.map((r, i) => {
      const superseded = latest.get(r.k) !== i;
      if (o.dropped && superseded) return undefined;
      if (o.tombGone && r.v === 'null') return undefined;
      return { label: `${r.k}=${r.v}`, sub: r.v === 'null' ? 'tombstone' : i < 3 ? 'clean' : 'dirty', tone: o.map && superseded ? 'fail' : r.v === 'null' ? 'warn' : o.dropped ? 'ok' : i < 3 ? 'visited' : 'default' };
    });
  const mapBox = (on: boolean): Shape[] => (on ? [box('map', 180, 360, 600, 90, 'offset map: u1→3  u3→4  u2→5', { mono: true, tone: 'current' })] : []);
  f.add('A compacted topic keeps at least the latest value for every key. Offsets 0–2 are already clean; 3–5 arrived since.', [...cap('cleanup.policy=compact'), ...logRow('r', 'users-0', cells(), 160)], panel('Compaction', [['records', 6], ['dirty', '50 %']]));
  f.add('Dirty has reached min.cleanable.dirty.ratio, so the cleaner hashes every key to its newest offset.', [...cap('min.cleanable.dirty.ratio=0.5'), ...logRow('r', 'users-0', cells({ map: true }), 160), ...mapBox(true)], panel('Compaction', [['superseded', 3, 'warn']]));
  f.add('It rewrites the segments without every record that has a newer value, and swaps the new files in atomically.', [...cap('// cleaner pass'), ...logRow('r', 'users-0', cells({ dropped: true }), 160), ...mapBox(true)], panel('Compaction', [['removed', '0, 1, 2', 'ok']]));
  f.add('Offsets never change, so the log now has gaps. A consumer asking for offset 1 simply gets offset 3.', [...cap('consumer.seek(1)  →  first record: offset 3'), ...logRow('r', 'users-0', cells({ dropped: true }), 160)], panel('Compaction', [['offsets', 'kept, with gaps', 'ok']]));
  if (tomb) f.add('u2=null is a tombstone: it deletes the key. It stays for delete.retention.ms so slow consumers see the delete, then the next pass removes it.', [...cap('delete.retention.ms=86400000'), ...logRow('r', 'users-0', cells({ dropped: true, tombGone: true }), 160)], panel('Compaction', [['u2', 'deleted', 'ok'], ['keys left', 2]]));
  else f.add('Without a tombstone, u2 lives forever as its latest value. Compaction never deletes a key on its own.', [...cap('// u2=Bea is kept'), ...logRow('r', 'users-0', cells({ dropped: true }), 160)], panel('Compaction', [['keys left', 3]]));
  return f.frames;
}

liveDemo(
  'kafka-storage',
  'Kafka storage',
  'Finding an offset through segment files and a sparse index, serving it from the page cache with or without the JVM copy, and compaction keeping the newest value per key.',
  {
    segments: ['Segments & index', segments],
    zerocopy: ['Page cache & zero-copy', zerocopy],
    compaction: ['Log compaction', compaction],
  },
  [
    choice('off', 'fetch offset', OFFSETS, '368870', { for: ['segments'] }),
    choice('path', 'send with', ['sendfile', 'copy'], 'sendfile', { for: ['zerocopy'], labels: ['sendfile', 'read + write'] }),
    choice('reader', 'consumer', ['tail', 'laggard'], 'tail', { for: ['zerocopy'], labels: ['at the tail', '3 days behind'] }),
    choice('u2', 'last write to u2', ['null', 'Bea'], 'null', { for: ['compaction'], labels: ['null (delete)', '"Bea"'] }),
  ],
  {
    active: D('Active segment', 'The only segment that takes appends. It rolls when it reaches segment.bytes (1 GiB) or segment.ms (7 days).', 'log.segment.bytes=1073741824\nlog.roll.ms=604800000'),
    i0: D('Sparse index', 'One entry per index.interval.bytes (4 KiB) of log, not per record. Each entry is 8 bytes: relative offset and file position, and the file is memory-mapped.'),
    cache: D('Page cache', 'Kafka writes to the OS page cache and does not fsync each batch. Durability comes from replication, and recent data is served from RAM.', 'log.flush.interval.messages  # unset: leave flushing to the OS'),
    buf: D('Extra copies', 'read then write moves every byte into the JVM heap and back out: two CPU copies, more syscalls and garbage for the collector.'),
    r5: D('Tombstone', 'A record with a null value deletes its key. It is kept for delete.retention.ms so slow consumers still see the delete.', 'producer.send(new ProducerRecord<>("users", "u2", null));'),
    map: D('Offset map', 'The cleaner thread hashes each key in the dirty section to its latest offset. log.cleaner.dedupe.buffer.size bounds how much it can clean per pass.'),
  },
);

// ---------------- replication: high watermark, leader epochs ----------------
function hw(p: P): Frame[] {
  const stuck = pick(p.f2, ['healthy', 'stuck'], 'healthy') === 'stuck';
  const f = new Film();
  const X0 = 180;
  const CW = 160;
  const row = (pre: string, title: string, n: number, y: number, o: { out?: boolean; fresh?: number } = {}): Shape[] =>
    logRow(pre, title, [...Array(5).keys()].map((i) => (i < n ? { label: `m${i}`, tone: (i >= (o.fresh ?? 99) ? 'write' : o.out ? 'visited' : 'default') as Tone } : undefined)), y, { x0: X0, w: CW * 5, titleTone: o.out ? 'fail' : 'muted' });
  const scene = (stmt: string, L: number, F1: number, F2: number, HW: number, o: { out?: boolean; fresh?: boolean } = {}): Shape[] => [
    ...cap(stmt),
    ...row('l', 'leader', L, 160, { fresh: o.fresh ? 3 : undefined }),
    ...row('a', 'f1', F1, 330),
    ...row('b', o.out ? 'f2 · out of ISR' : 'f2', F2, 500, { out: o.out }),
    ...mark('hw', X0, CW, HW, 150, 610, `HW ${HW}`, 'ok'),
    box('prod', 180, 700, 800, 90, HW >= 5 ? 'acks=all: offset 4 acknowledged' : 'acks=all: producer of offset 4 still waiting', { mono: true, tone: HW >= 5 ? 'ok' : 'warn' }),
  ];
  const rows = (L: number, F1: number, F2: number, HW: number, isr = 3): Row[] => [['LEO leader', L], ['LEO f1', F1], ['LEO f2', F2, F2 < L ? 'warn' : 'default'], ['ISR size', isr, isr < 3 ? 'warn' : 'ok'], ['HW', HW, 'ok']];
  f.add('The leader appended offsets 3 and 4, so its log end offset (LEO) is 5. Consumers may only read below the high watermark, still 3.', scene('produce(m3, m4)  acks=all', 5, 3, 3, 3, { fresh: true }), panel('Replication', rows(5, 3, 3, 3)));
  f.add(stuck ? 'f1 fetches both new records. f2 has stopped fetching (a GC pause, a dead disk): its LEO stays 3.' : 'Followers fetch from their own LEO. f1 gets both new records; f2 gets one so far.', scene(stuck ? 'f1: fetch(3)   f2: …' : 'f1: fetch(3)   f2: fetch(3)', 5, 5, stuck ? 3 : 4, 3), panel('Replication', rows(5, 5, stuck ? 3 : 4, 3)));
  f.add(`The HW is the minimum LEO across the in-sync replicas: min(5, 5, ${stuck ? 3 : 4}) = ${stuck ? 3 : 4}. ${stuck ? 'f2 is holding everyone back.' : 'Offset 3 is now committed.'}`, scene('HW = min(LEO of ISR)', 5, 5, stuck ? 3 : 4, stuck ? 3 : 4), panel('Replication', rows(5, 5, stuck ? 3 : 4, stuck ? 3 : 4)));
  if (stuck) {
    f.add('After replica.lag.time.max.ms (30 s) without catching up, f2 is dropped from the ISR. Now the minimum is over leader and f1 only: HW 5.', scene('replica.lag.time.max.ms=30000', 5, 5, 3, 5, { out: true }), panel('Replication', rows(5, 5, 3, 5, 2)));
    f.add('The producer finally gets its ack, but the partition now survives one fewer failure. min.insync.replicas=2 sets how far the ISR may shrink before writes are refused.', scene('min.insync.replicas=2', 5, 5, 3, 5, { out: true }), panel('Replication', [...rows(5, 5, 3, 5, 2), ['writes', 'still allowed (ISR ≥ 2)', 'warn']]));
  } else {
    f.add('On the next fetch f2 reaches LEO 5 and the HW moves to 5: offset 4 is committed and the acks=all producer gets its reply.', scene('f2: fetch(4)', 5, 5, 5, 5), panel('Replication', rows(5, 5, 5, 5)));
    f.add('Followers learn the new HW in their next fetch response, one round trip behind the leader. Committed means on every in-sync replica.', scene('// committed = below HW', 5, 5, 5, 5), panel('Replication', rows(5, 5, 5, 5)));
  }
  return f.frames;
}

function epoch(p: P): Frame[] {
  const useEpoch = pick(p.by, ['epoch', 'none'], 'epoch') === 'epoch';
  const f = new Film();
  const cells = (xs: string[], tones: (Tone | undefined)[] = []) => xs.map((s, i) => ({ label: s, sub: s === 'x' ? 'epoch 0' : s === 'y' ? 'epoch 1' : undefined, tone: tones[i] ?? ('default' as Tone) }));
  const A0 = ['m0', 'm1', 'm2', 'm3', 'x'];
  const B0 = ['m0', 'm1', 'm2', 'm3'];
  const scene = (stmt: string, a: Shape[], b: Shape[], extra: Shape[] = []) => [...cap(stmt), ...a, ...b, ...extra];
  const A = (xs: string[], tones?: (Tone | undefined)[], title = 'broker A') => logRow('a', title, cells(xs, tones), 180, { w: 800 });
  const B = (xs: string[], tones?: (Tone | undefined)[], title = 'broker B') => logRow('b', title, cells(xs, tones), 400, { w: 800 });
  f.add('A leads in epoch 0 and wrote x at offset 4. B has replicated only up to offset 3, so x is not committed yet.', scene('leader A · epoch 0', A(A0, [, , , , 'warn'], 'broker A · leader'), B(B0)), panel('Epochs', [['A LEO', 5], ['B LEO', 4], ['HW', 4]]));
  f.add('A dies. The controller makes B the leader and bumps the leader epoch to 1.', scene('controller: leader = B, epoch 1', A(A0, ['visited', 'visited', 'visited', 'visited', 'visited'], 'broker A · down'), B(B0, [], 'broker B · leader')), panel('Epochs', [['epoch', 1]]));
  f.add('B takes a new write y at offset 4 and records that epoch 1 starts there.', scene('produce(y)  →  B offset 4', A(A0, ['visited', 'visited', 'visited', 'visited', 'visited'], 'broker A · down'), B([...B0, 'y'], [, , , , 'write'], 'broker B · leader')), panel('Epochs', [['epoch 1 starts at', 4]]));
  if (useEpoch) {
    f.add('A restarts as a follower and asks: where did epoch 0 end? B answers 4, the first offset of epoch 1.', scene('OffsetForLeaderEpoch(epoch=0) → 4', A(A0, [, , , , 'warn'], 'broker A · follower'), B([...B0, 'y'], [], 'broker B · leader'), [arrow('ask', 500, 280, 500, 396, 'current', { width: 4 })]), panel('Epochs', [['epoch 0 ends at', 4]]));
    f.add('A truncates to offset 4, dropping the uncommitted x, then fetches y. Both replicas hold the same history.', scene('truncate(4); fetch(4)', A([...B0, 'y'], [, , , , 'ok'], 'broker A · follower'), B([...B0, 'y'], [, , , , 'ok'], 'broker B · leader')), panel('Epochs', [['logs', 'identical', 'ok'], ['x', 'dropped (never acked)', 'ok']]));
  } else {
    f.add('Suppose A just resumed fetching from its own log end. It already has an offset 4, so it fetches from 5 and keeps x.', scene('fetch(5)   // no epoch check', A(A0, [, , , , 'fail'], 'broker A · follower'), B([...B0, 'y'], [, , , , 'fail'], 'broker B · leader')), panel('Epochs', [['offset 4 on A', 'x', 'fail'], ['offset 4 on B', 'y', 'fail']]));
    f.add('Now offset 4 means x on A and y on B: the replicas silently disagree, and whichever leads next decides what consumers see. The leader epoch exists to find this divergence point.', scene('// diverged history', A(A0, [, , , , 'fail']), B([...B0, 'y'], [, , , , 'fail'])), panel('Epochs', [['logs', 'diverged', 'fail'], ['fix', 'truncate at epoch boundary', 'ok']]));
  }
  return f.frames;
}

liveDemo(
  'kafka-replication',
  'Kafka replication',
  'Three replica logs with the high watermark as the minimum of the in-sync ones (stall a follower to see the ISR shrink), leader epochs finding where histories diverged, and KRaft.',
  {
    hw: ['High watermark', hw],
    epoch: ['Leader epochs', epoch],
    kraft: ['KRaft metadata', () => traceFrames(kraftTrace)],
  },
  [choice('f2', 'follower f2', ['healthy', 'stuck'], 'healthy', { for: ['hw'] }), choice('by', 'A rejoins by', ['epoch', 'none'], 'epoch', { for: ['epoch'], labels: ['asking the epoch end', 'keeping its log'] })],
  {
    l0: D('Leader log', 'Producers write only to the leader. Its log end offset (LEO) is the next offset it will assign.'),
    hw: D('High watermark', 'The offset up to which every in-sync replica has the data. Consumers read only below it, so they never see a record that could vanish in a failover.'),
    a0: D('Leader epoch', 'A counter bumped on every leader change, stored with each batch. A rejoining follower asks where its epoch ended and truncates there.'),
  },
);

// ---------------- exactly-once: idempotence, LSO ----------------
function idempotent(p: P): Frame[] {
  const on = pick(p.idem, ['on', 'off'], 'on') === 'on';
  const f = new Film();
  const log = (n: number, dup: boolean): Shape[] => logRow('o', 'leader log', [...Array(5).keys()].map((i) => (i < n ? { label: i < 2 ? `batch ${i}` : i === 2 ? 'seq 10–19' : dup ? 'seq 10–19' : '', sub: i === 2 ? 'first copy' : dup && i === 3 ? 'retry, again' : undefined, tone: (i === 2 ? 'ok' : dup && i === 3 ? 'fail' : 'default') as Tone } : undefined)), 160, { first: 40 });
  const prod = (label: string, tone: Tone): Shape[] => [box('prod', 180, 420, 400, 110, label, { sub: on ? 'PID 7 · epoch 0' : 'no producer id', mono: true, tone })];
  f.add(on ? 'An idempotent producer gets a producer ID on start; every batch carries the PID and a per-partition sequence number.' : 'Without idempotence a batch carries no identity: the leader cannot tell a retry from new data.', [...cap(on ? 'enable.idempotence=true' : 'enable.idempotence=false'), ...log(2, false), ...prod('producer', 'accent')], panel('Producer', [['idempotence', on ? 'on' : 'off', on ? 'ok' : 'warn']]));
  f.add('The leader appends the batch (seq 10–19) at offset 42, but the response is lost on the network.', [...cap('send(seq 10–19)  →  offset 42'), ...log(3, false), ...prod('producer', 'current'), box('lost', 620, 420, 340, 110, 'ack lost', { mono: true, tone: 'fail', dashed: true })], panel('Producer', [['appended', 'offset 42'], ['ack', 'lost', 'fail']]));
  f.add('The producer times out and retries the same batch, with the same sequence numbers.', [...cap('retry(seq 10–19)'), ...log(3, false), ...prod('producer · retrying', 'warn'), arrow('rt', 380, 418, 560, 240, 'warn', { width: 4 })], panel('Producer', [['retries', 1, 'warn']]));
  if (on) {
    f.add('The leader recognises PID 7, seq 10–19 as a batch it already has. It returns the original offset 42 without appending again.', [...cap('duplicate detected → ack(offset 42)'), ...log(3, false), ...prod('producer · acked', 'ok')], panel('Producer', [['duplicates', 0, 'ok'], ['offset', 42, 'ok']]));
    f.add('A batch starting at seq 25 would leave a gap, so it is rejected (OutOfOrderSequence). That is how up to 5 in-flight batches stay in order.', [...cap('max.in.flight.requests.per.connection ≤ 5'), ...log(3, false), ...prod('producer', 'ok')], panel('Producer', [['ordering', 'kept', 'ok'], ['default since', 'Kafka 3.0', 'ok']]));
  } else {
    f.add('Nothing identifies the retry, so the leader appends it again at offset 43. Every consumer now sees the same ten records twice.', [...cap('append(…)  →  offset 43'), ...log(4, true), ...prod('producer · acked', 'warn')], panel('Producer', [['duplicates', 10, 'fail']]));
    f.add('At-least-once delivery: retries are safe only if consumers deduplicate. Idempotence (the default since 3.0) removes the problem at the broker.', [...cap('enable.idempotence=true   // fix'), ...log(4, true), ...prod('producer', 'warn')], panel('Producer', [['delivery', 'at least once', 'warn']]));
  }
  return f.frames;
}

const T2 = ['open', 'commit', 'abort'];

function lso(p: P): Frame[] {
  const t2 = pick(p.t2, T2, 'open');
  const rc = pick(p.iso, ['committed', 'uncommitted'], 'committed') === 'committed';
  const recs: { v: string; t: string; marker?: boolean }[] = [
    { v: 'a', t: 'T1' },
    { v: 'c', t: 'T2' },
    { v: 'b', t: 'T1' },
    { v: 'COMMIT', t: 'T1', marker: true },
    { v: 'e', t: 'T2' },
    { v: 'f', t: '—' },
  ];
  if (t2 !== 'open') recs.push({ v: t2 === 'commit' ? 'COMMIT' : 'ABORT', t: 'T2', marker: true });
  const HW = recs.length;
  const LSO = t2 === 'open' ? 1 : HW;
  const visible = (i: number) => {
    const r = recs[i];
    if (r.marker) return false;
    if (!rc) return i < HW;
    if (i >= LSO) return false;
    return !(r.t === 'T2' && t2 === 'abort');
  };
  const f = new Film();
  const X0 = 180;
  const CW = 780 / 7;
  const cells = (show: boolean): (Cell | undefined)[] => [...Array(7).keys()].map((i) => {
    const r = recs[i];
    if (!r) return undefined;
    const tone: Tone = r.marker ? 'muted' : show ? (visible(i) ? 'ok' : 'visited') : r.t === 'T1' ? 'accent' : r.t === 'T2' ? 'protocol' : 'default';
    return { label: r.v, sub: r.marker ? `${r.t} marker` : r.t === '—' ? 'no txn' : r.t, tone, dashed: show && !visible(i) && !r.marker };
  });
  const got = recs.map((r, i) => (visible(i) ? r.v : '')).filter(Boolean);
  const delivered = (on: boolean): Shape[] => (on ? [text('dt', 30, 500, 'consumer gets', { align: 'left', size: 24, bold: true, tone: 'muted' }), ...(got.length ? got.map((v, i) => box(`d${i}`, X0 + i * 130, 460, 110, 80, v, { mono: true, tone: 'ok' })) : [text('dn', X0, 500, 'nothing yet', { align: 'left', size: 26, tone: 'warn' })])] : []);
  const scene = (stmt: string, show: boolean, marks: boolean): Shape[] => [...cap(stmt), ...logRow('r', 'out-0', cells(show), 180, { x0: X0, w: 780 }), ...(marks ? [...mark('hw', X0, CW, HW, 160, 300, `HW ${HW}`, 'muted'), ...(rc && LSO !== HW ? mark('lso', X0, CW, LSO, 160, 300, `LSO ${LSO}`, 'warn', true) : [])] : []), ...delivered(show)];
  f.add(`Transactions T1 and T2 interleave in the partition: T1 has committed, T2 is ${t2 === 'open' ? 'still open' : t2 === 'commit' ? 'committed too' : 'aborted'}. f was written outside any transaction.`, scene('two producers, one partition', false, false), panel('Isolation', [['T1', 'committed', 'ok'], ['T2', t2, t2 === 'abort' ? 'fail' : t2 === 'open' ? 'warn' : 'ok']]));
  f.add(rc ? `read_committed stops at the last stable offset: the first offset of the oldest open transaction${t2 === 'open' ? ', 1, even though T1’s b and f after it are committed' : '. With no open transaction it equals the HW'}.` : 'read_uncommitted ignores transactions entirely and reads everything up to the high watermark.', scene(`isolation.level=read_${rc ? 'committed' : 'uncommitted'}`, false, true), panel('Isolation', [['HW', HW], ['LSO', rc ? LSO : '—', LSO < HW ? 'warn' : 'ok']]));
  f.add(rc ? (t2 === 'abort' ? 'T2 aborted: the fetch response lists it, so the consumer drops c and e. Markers are never delivered.' : t2 === 'open' ? 'So the consumer gets only a. Everything after waits until T2 finishes or times out.' : 'Both transactions committed, so every data record is delivered, in offset order. Markers are skipped.') : `It returns ${got.join(', ')}${t2 === 'abort' ? ', including c and e from the aborted T2' : t2 === 'open' ? ', including T2’s records that may still abort' : ''}.`, scene(`poll() → [${got.join(', ')}]`, true, true), panel('Isolation', [['delivered', got.join(' ') || 'nothing', got.length ? 'ok' : 'warn']]));
  f.add(rc && t2 === 'open' ? 'A hung transaction pins the LSO and stalls every read_committed consumer until transaction.timeout.ms aborts it.' : rc ? 'read_committed is what exactly-once pipelines use: a consumer never acts on output that could still be rolled back.' : 'Fine for monitoring, wrong for exactly-once pipelines: you may act on data that is later rolled back.', scene(rc && t2 === 'open' ? 'transaction.timeout.ms=60000' : `// read_${rc ? 'committed' : 'uncommitted'}`, true, true), panel('Isolation', [['risk', rc ? (t2 === 'open' ? 'stall' : 'none') : 'dirty reads', rc && t2 !== 'open' ? 'ok' : 'warn']]));
  return f.frames;
}

liveDemo(
  'kafka-eos',
  'Kafka exactly-once',
  'A retried batch deduplicated by producer id and sequence (or appended twice without them), the transaction coordinator, and what read_committed delivers for an open, committed or aborted transaction.',
  {
    idempotent: ['Idempotent producer', idempotent],
    txn: ['Transactions', () => traceFrames(txnTrace)],
    lso: ['read_committed & LSO', lso],
  },
  [choice('idem', 'idempotence', ['on', 'off'], 'on', { for: ['idempotent'] }), choice('t2', 'T2 is', T2, 'open', { for: ['lso'] }), choice('iso', 'consumer reads', ['committed', 'uncommitted'], 'committed', { for: ['lso'], labels: ['read_committed', 'read_uncommitted'] })],
  {
    prod: D('Idempotent producer', 'PID + per-partition sequence numbers let the leader drop retries it already has. On by default since Kafka 3.0.', 'enable.idempotence=true\nacks=all\nmax.in.flight.requests.per.connection=5'),
    r0: D('Transactional record', 'Written inside a transaction. It stays in the log whatever happens; a COMMIT or ABORT marker later decides whether read_committed consumers see it.'),
    r3: D('Control marker', 'A COMMIT or ABORT record written by the transaction coordinator. Consumers never receive it; it tells them how to treat the transaction’s records.'),
  },
);

// ---------------- consumer groups: rebalancing ----------------
const OWN_TONE: Record<string, Tone> = { c1: 'accent', c2: 'protocol', c3: 'ok', '': 'visited' };

function owners(pre: string, own: string[], y: number, note?: (i: number) => string | undefined): Shape[] {
  const out: Shape[] = [];
  own.forEach((o, i) => out.push(box(`${pre}${i}`, 40 + i * 155, y, 140, 110, `P${i}`, { sub: note?.(i) ?? (o || 'paused'), mono: true, tone: OWN_TONE[o], dashed: !o })));
  return out;
}

function cooperative(p: P): Frame[] {
  const coop = pick(p.mode, ['cooperative', 'eager'], 'cooperative') === 'cooperative';
  const f = new Film();
  const before = ['c1', 'c1', 'c1', 'c2', 'c2', 'c2'];
  const after = ['c1', 'c1', 'c3', 'c2', 'c2', 'c3'];
  const consumers = (n: number): Shape[] => ['c1', 'c2', 'c3'].slice(0, n).map((c, i) => box(`m${c}`, 40 + i * 320, 420, 290, 90, c, { sub: c === 'c3' ? 'joining' : 'member', mono: true, tone: OWN_TONE[c] }));
  f.add('c1 owns P0–P2 and c2 owns P3–P5. Then a third consumer, c3, joins the group.', [...cap('group "billing" · 6 partitions'), ...owners('p', before, 160), ...consumers(3)], panel('Rebalance', [['members', '2 → 3']]));
  let paused = 0;
  if (coop) {
    f.add('Cooperative: members rejoin while still consuming. The sticky assignor computes a plan that moves as little as possible: only P2 and P5.', [...cap('partition.assignment.strategy=CooperativeStickyAssignor'), ...owners('p', before, 160, (i) => (i === 2 || i === 5 ? 'to revoke' : undefined)), ...consumers(3)], panel('Rebalance', [['moving', 2]]));
    const mid = before.map((o, i) => (i === 2 || i === 5 ? '' : o));
    paused = 2;
    f.add('Round 1: only the two moving partitions are revoked. The other four never stop consuming.', [...cap('rebalance #1: revoke P2, P5'), ...owners('p', mid, 160), ...consumers(3)], panel('Rebalance', [['paused', 2, 'ok'], ['consuming', 4, 'ok']]));
    f.add('Round 2, moments later, assigns the freed partitions to c3. Two short rebalances, almost no pause.', [...cap('rebalance #2: assign P2, P5 → c3'), ...owners('p', after, 160), ...consumers(3)], panel('Rebalance', [['partitions paused', paused, 'ok']]));
  } else {
    paused = 6;
    f.add('Eager: on JoinGroup every member revokes every partition first. Nothing in the group is consumed until the new plan arrives.', [...cap('partition.assignment.strategy=RangeAssignor (eager)'), ...owners('p', ['', '', '', '', '', ''], 160), ...consumers(3)], panel('Rebalance', [['paused', 6, 'fail'], ['consuming', 0, 'fail']]));
    f.add('SyncGroup hands out the new plan and all six restart, four of them on the same consumer they just left: a stop-the-world pause for nothing.', [...cap('SyncGroup → new assignment'), ...owners('p', ['c1', 'c1', 'c2', 'c2', 'c3', 'c3'], 160), ...consumers(3)], panel('Rebalance', [['partitions paused', paused, 'fail'], ['moved', 4, 'warn']]));
  }
  f.add(coop ? 'Use the cooperative-sticky assignor so scaling a group does not stall it.' : 'Every join, leave or crash repeats this full stop. Cooperative rebalancing pauses only what moves.', [...cap(coop ? '// incremental rebalance' : '// stop-the-world rebalance'), ...owners('p', coop ? after : ['c1', 'c1', 'c2', 'c2', 'c3', 'c3'], 160), ...consumers(3)], panel('Rebalance', [['paused', paused, coop ? 'ok' : 'fail']]));
  return f.frames;
}

function staticMembers(p: P): Frame[] {
  const stat = pick(p.mem, ['static', 'dynamic'], 'static') === 'static';
  const long = pick(p.down, ['short', 'long'], 'short') === 'long';
  const f = new Film();
  const base = ['c1', 'c1', 'c2', 'c2', 'c3', 'c3'];
  const sc = (stmt: string, own: string[], note?: (i: number) => string | undefined): Shape[] => [...cap(stmt), ...owners('p', own, 160, note), box('c2', 40, 420, 600, 90, stat ? 'c2 · group.instance.id=billing-2' : 'c2 · dynamic member id', { mono: true, tone: 'protocol' })];
  f.add(`Three consumers share six partitions. c2 is about to restart for a deploy and will be down ${long ? 'for 3 minutes' : 'for 20 seconds'}.`, sc('session.timeout.ms=45000', base), panel('Static membership', [['membership', stat ? 'static' : 'dynamic']]));
  if (!stat) {
    f.add('A dynamic member sends LeaveGroup on shutdown, so the group rebalances at once and c1 and c3 take over P2 and P3.', sc('LeaveGroup → rebalance #1', ['c1', 'c1', 'c1', 'c3', 'c3', 'c3']), panel('Static membership', [['rebalances', 1, 'warn']]));
    f.add('When c2 comes back it is a brand-new member, so the group rebalances again to give it partitions. Two pauses for one restart.', sc('JoinGroup (new id) → rebalance #2', base), panel('Static membership', [['rebalances', 2, 'fail']]));
  } else if (!long) {
    f.add('With group.instance.id, c2 shuts down without LeaveGroup. The coordinator keeps P2 and P3 reserved for it; they just lag.', sc('shutdown, no LeaveGroup', ['c1', 'c1', '', '', 'c3', 'c3'], (i) => (i === 2 || i === 3 ? 'reserved' : undefined)), panel('Static membership', [['rebalances', 0, 'ok'], ['lagging', 'P2, P3', 'warn']]));
    f.add('c2 is back within session.timeout.ms with the same id. The coordinator returns its old assignment: no rebalance at all.', sc('JoinGroup(group.instance.id=billing-2)', base), panel('Static membership', [['rebalances', 0, 'ok']]));
  } else {
    f.add('c2 shuts down without LeaveGroup and its partitions are held for it…', sc('shutdown, no LeaveGroup', ['c1', 'c1', '', '', 'c3', 'c3'], (i) => (i === 2 || i === 3 ? 'reserved' : undefined)), panel('Static membership', [['lagging', 'P2, P3', 'warn']]));
    f.add('…but it stays away past session.timeout.ms, so the member is removed and a normal rebalance runs. P2 and P3 lagged for the whole timeout first.', sc('session timeout → rebalance', ['c1', 'c1', 'c1', 'c3', 'c3', 'c3']), panel('Static membership', [['rebalances', 1, 'warn'], ['lag', '45 s + restart', 'fail']]));
  }
  f.add(stat ? 'Set session.timeout.ms just above a normal restart: long enough to skip rebalances, short enough to recover from a real crash.' : 'Static membership (group.instance.id) turns rolling restarts into zero rebalances.', sc('// tune session.timeout.ms', stat && long ? ['c1', 'c1', 'c1', 'c3', 'c3', 'c3'] : base), panel('Static membership', [['rebalances', !stat ? 2 : long ? 1 : 0, !stat ? 'fail' : long ? 'warn' : 'ok']]));
  return f.frames;
}

liveDemo(
  'kafka-groups',
  'Kafka consumer groups',
  'JoinGroup and SyncGroup, a third consumer joining with eager or cooperative rebalancing (count the paused partitions), and a restart with or without static membership.',
  {
    join: ['Join & sync', () => traceFrames(joinTrace)],
    cooperative: ['Cooperative rebalancing', cooperative],
    static: ['Static membership', staticMembers],
  },
  [
    choice('mode', 'rebalancing', ['cooperative', 'eager'], 'cooperative', { for: ['cooperative'] }),
    choice('mem', 'membership', ['static', 'dynamic'], 'static', { for: ['static'] }),
    choice('down', 'c2 is down', ['short', 'long'], 'short', { for: ['static'], labels: ['20 s', '3 min'] }),
  ],
  {
    p0: D('Partition', 'The unit of parallelism: each partition is consumed by exactly one member of the group at a time.'),
    c2: D('group.instance.id', 'Static membership: the coordinator remembers this member across restarts and keeps its assignment until session.timeout.ms.', 'group.instance.id=billing-2\nsession.timeout.ms=45000'),
  },
);
