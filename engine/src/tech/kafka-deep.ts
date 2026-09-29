// Kafka internals (group tech-kafka): storage, replication, exactly-once and consumer group protocol.
import type { Detail } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'tech-kafka';
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

function traceDemo(slug: string, title: string, summary: string, traces: Record<string, [string, Trace]>) {
  machineDemo({
    slug,
    title,
    group: G,
    summary,
    inputs: Object.entries(traces).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => traceFrames(traces[k][1]),
  });
}

// ---------------- storage ----------------
traceDemo('kafka-storage', 'Kafka storage', 'A partition is a directory of segment files with sparse indexes, served from the page cache with sendfile, and optionally compacted by key.', {
  segments: [
    'Segments & index',
    {
      codeTitle: '/var/kafka/orders-0/',
      code: ['00000000000000000000.log', '00000000000000000000.index', '00000000000000000000.timeindex', '00000000000000368769.log', '00000000000000368769.index', '00000000000000368769.timeindex', 'leader-epoch-checkpoint'],
      stackTitle: 'broker',
      heapTitle: '368769.index',
      details: {
        active: D('Active segment', 'The only segment that takes appends. It rolls when it reaches segment.bytes (1 GiB) or segment.ms (7 days).', 'log.segment.bytes=1073741824\nlog.roll.ms=604800000'),
        i2: D('Sparse index', 'One entry per index.interval.bytes (4 KiB) of log, not per record. Each entry is 8 bytes: relative offset and file position, and the file is memory-mapped.'),
        fetch: D('Lookup', 'Floor search on the segment base offsets, binary search in the index, then a short sequential scan of the .log file.'),
      },
      steps: [
        { note: 'A partition is a directory of segments. Each file is named after the first offset it holds.', line: [0, 3], vars: [['old', '0–368768 · closed', 'visited'], ['active', '368769– · appending', 'current']], out: '' },
        { note: 'Only the active segment takes appends. At segment.bytes or segment.ms it rolls to a new file.', line: 3, vars: [['old', '0–368768 · closed', 'visited'], ['active', 'append @ 368900', 'write']], out: '' },
        { note: 'The .index maps a relative offset to a byte position about every 4 KiB of log. It is sparse, so it stays small enough to mmap.', line: 4, vars: [['active', '368769– · appending', 'current']], heap: [['i0', '0 → byte 0', 'read'], ['i1', '41 → byte 4096', 'read'], ['i2', '87 → byte 8210', 'read'], ['i3', '130 → byte 12301', 'read']], out: '' },
        { note: 'Fetch offset 368870: the segment with the largest base offset at or below it is 368769, so relative offset 101.', line: 3, vars: [['fetch', 'offset 368870', 'current'], ['active', 'base 368769', 'accent']], heap: [['i0', '0 → byte 0', 'muted'], ['i1', '41 → byte 4096', 'muted'], ['i2', '87 → byte 8210', 'muted'], ['i3', '130 → byte 12301', 'muted']], out: 'segment 368769, relative 101' },
        { note: 'Binary search finds entry 87, the last one at or below 101. The broker scans forward from byte 8210 to the batch holding 101.', line: 4, vars: [['fetch', 'offset 368870', 'current', 'i2'], ['active', 'scan from 8210', 'read']], heap: [['i0', '0 → byte 0', 'muted'], ['i1', '41 → byte 4096', 'muted'], ['i2', '87 → byte 8210', 'ok', 'floor'], ['i3', '130 → byte 12301', 'muted']], out: 'segment 368769, relative 101\nindex hit 87 → byte 8210\nscan → batch at byte 9120' },
        { note: 'The .timeindex maps timestamps to offsets the same way, for offsetsForTimes and time-based retention. Retention deletes whole closed segments, never single records.', line: [2, 5], vars: [['old', 'past retention · deleted', 'fail'], ['active', '368769– · appending', 'current']], out: 'segment 368769, relative 101\nindex hit 87 → byte 8210\ndeleted 00000000000000000000.*' },
      ],
    },
  ],
  zerocopy: [
    'Page cache & zero-copy',
    {
      codeTitle: 'broker fetch path (simplified)',
      code: ['// classic copy', 'n = read(file, buf, len);      // kernel → JVM', 'write(socket, buf, n);         // JVM → kernel', '// Kafka: FileChannel.transferTo', 'sendfile(socket, file, &pos, len);'],
      stackTitle: 'user space',
      heapTitle: 'kernel',
      details: {
        cache: D('Page cache', 'Kafka writes to the OS page cache and does not fsync each batch. Durability comes from replication, and recent data is served from RAM.', 'log.flush.interval.messages  # unset: leave flushing to the OS'),
        buf: D('Extra copies', 'read then write moves every byte into the JVM heap and back out: two CPU copies, more syscalls and garbage for the collector.'),
        nic: D('Same format everywhere', 'Batches are stored exactly as producers sent them, compressed. Zero-copy works because the broker never needs to touch the bytes. TLS needs encryption in user space, so it loses sendfile.'),
      },
      steps: [
        { note: 'A produce request lands in the page cache and the call returns. The kernel writes it to disk later.', line: 0, vars: [['producer', 'batch 42 → leader', 'write']], heap: [['cache', 'page cache: batch 42', 'write', 'RAM'], ['disk', 'disk: flushed later', 'muted']], out: '' },
        { note: 'A consumer at the tail asks for batch 42 moments later. It is still in the page cache, so no disk read happens.', line: 0, vars: [['consumer', 'fetch batch 42', 'current', 'cache']], heap: [['cache', 'page cache: batch 42', 'ok', 'hit'], ['disk', 'disk: idle', 'muted']], out: '' },
        { note: 'The classic path reads into a JVM buffer, then writes it to the socket. The bytes cross the kernel boundary twice.', line: [1, 2], vars: [['consumer', 'fetch batch 42', 'current'], ['buf', 'byte[] copy', 'warn', 'cache']], heap: [['cache', 'page cache: batch 42', 'read'], ['sock', 'socket buffer: copy', 'warn'], ['nic', 'NIC', 'default']], out: 'copies: cache → heap → socket → NIC' },
        { note: 'transferTo calls sendfile, so the kernel hands page-cache pages straight to the socket. The data never enters the JVM.', line: [3, 4], vars: [['consumer', 'fetch batch 42', 'ok', 'cache']], heap: [['cache', 'page cache: batch 42', 'read'], ['sock', 'socket: page refs', 'ok'], ['nic', 'NIC · DMA', 'ok']], out: 'copies: cache → heap → socket → NIC\nsendfile: cache → NIC' },
        { note: 'A consumer far behind reads cold segments from disk. Those reads can evict pages the tail readers need.', line: 4, vars: [['consumer', 'fetch batch 42', 'ok', 'cache'], ['laggard', 'fetch 3 days old', 'warn', 'disk']], heap: [['cache', 'page cache: churn', 'warn'], ['disk', 'disk: busy reads', 'fail']], out: 'sendfile: cache → NIC\nlaggard: disk → cache → NIC' },
      ],
    },
  ],
  compaction: [
    'Log compaction',
    {
      codeTitle: 'topic users',
      code: ['cleanup.policy=compact', 'min.cleanable.dirty.ratio=0.5', 'delete.retention.ms=86400000'],
      stackTitle: 'cleaner',
      heapTitle: 'log (offset key=value)',
      details: {
        map: D('Offset map', 'The cleaner thread hashes each key in the dirty section to its latest offset. log.cleaner.dedupe.buffer.size bounds how much it can clean per pass.'),
        r5: D('Tombstone', 'A record with a null value deletes its key. It is kept for delete.retention.ms so slow consumers still see the delete.', 'producer.send(new ProducerRecord<>("users", "u2", null));'),
        clean: D('Clean vs dirty', 'The clean section has been compacted before and holds one record per key. The active segment is never cleaned.'),
      },
      steps: [
        { note: 'A compacted topic keeps at least the latest value for every key. Offsets 0–2 are clean; 3–5 were written since.', line: 0, vars: [['clean', 'offsets 0–2', 'visited'], ['dirty', 'offsets 3–5', 'warn']], heap: [['r0', '0 u1=Ann', 'visited'], ['r1', '1 u2=Bo', 'visited'], ['r2', '2 u3=Cy', 'visited'], ['r3', '3 u1=Anna', 'warn'], ['r4', '4 u3=Cyd', 'warn'], ['r5', '5 u2=null', 'warn']], out: '' },
        { note: 'Dirty is half the log, so min.cleanable.dirty.ratio is reached. The cleaner maps each dirty key to its latest offset.', line: 1, vars: [['clean', 'offsets 0–2', 'visited'], ['map', 'u1→3 u3→4 u2→5', 'current']], heap: [['r0', '0 u1=Ann', 'visited'], ['r1', '1 u2=Bo', 'visited'], ['r2', '2 u3=Cy', 'visited'], ['r3', '3 u1=Anna', 'read'], ['r4', '4 u3=Cyd', 'read'], ['r5', '5 u2=null', 'read']], out: '' },
        { note: 'It recopies the segments and drops every record whose key has a newer offset. The new files are swapped in atomically.', line: 1, vars: [['map', 'u1→3 u3→4 u2→5', 'current']], heap: [['r0', '0 u1=Ann', 'fail', 'superseded'], ['r1', '1 u2=Bo', 'fail', 'superseded'], ['r2', '2 u3=Cy', 'fail', 'superseded'], ['r3', '3 u1=Anna', 'ok'], ['r4', '4 u3=Cyd', 'ok'], ['r5', '5 u2=null', 'ok', 'tombstone']], out: 'removed offsets 0, 1, 2' },
        { note: 'Offsets never change, so the log now has gaps. A consumer asking for offset 1 simply gets offset 3.', line: 1, vars: [['clean', 'offsets 3–5', 'visited'], ['consumer', 'fetch 1 → gets 3', 'read']], heap: [['r3', '3 u1=Anna', 'ok'], ['r4', '4 u3=Cyd', 'ok'], ['r5', '5 u2=null', 'ok', 'tombstone']], out: 'removed offsets 0, 1, 2' },
        { note: 'The null value for u2 is a tombstone. After delete.retention.ms the next pass removes it too.', line: 2, vars: [['clean', 'offsets 3–4', 'visited']], heap: [['r3', '3 u1=Anna', 'ok'], ['r4', '4 u3=Cyd', 'ok'], ['r5', '5 u2=null', 'muted', 'removed']], out: 'removed offsets 0, 1, 2\nremoved tombstone 5' },
      ],
    },
  ],
});

// ---------------- replication ----------------
traceDemo('kafka-replication', 'Kafka replication', 'How the high watermark commits records, how leader epochs make replicas agree after failover, and how KRaft stores cluster metadata in a Raft log.', {
  hw: [
    'High watermark',
    {
      codeTitle: 'partition orders-0',
      code: ['acks=all', 'min.insync.replicas=2', 'replica.lag.time.max.ms=30000'],
      stackTitle: 'replicas',
      heapTitle: 'leader state',
      details: {
        hw: D('High watermark', 'The smallest log end offset across the ISR. Records below it are on every in-sync replica, so they are committed and visible to consumers.'),
        leader: D('Log end offset', 'LEO is the offset the replica will write next. The leader learns each follower’s LEO from the offset in its Fetch request.'),
        isr: D('ISR', 'Replicas that have caught up to the leader within replica.lag.time.max.ms. A follower that falls behind is removed and no longer holds back the HW.'),
      },
      steps: [
        { note: 'The leader appended offsets 3 and 4, so its log end offset (LEO) is 5. The followers still have 0–2.', line: 0, vars: [['leader', 'LEO 5', 'write'], ['f1', 'LEO 3'], ['f2', 'LEO 3']], heap: [['hw', 'HW 3', 'read'], ['isr', 'ISR {leader, f1, f2}']], out: '' },
        { note: 'Followers fetch from their LEO. Each fetch offset tells the leader how far that follower has got.', line: 0, vars: [['leader', 'LEO 5'], ['f1', 'fetch @3 → LEO 5', 'current'], ['f2', 'fetch @3 → LEO 4', 'current']], heap: [['hw', 'HW 3', 'read'], ['isr', 'ISR {leader, f1, f2}']], out: '' },
        { note: 'On their next fetch the leader sees LEO 5 and 4. The HW is the minimum across the ISR, so it moves to 4.', line: 0, vars: [['leader', 'LEO 5'], ['f1', 'LEO 5', 'ok'], ['f2', 'LEO 4', 'warn']], heap: [['hw', 'HW 4', 'ok', 'offsets 0–3 committed'], ['isr', 'ISR {leader, f1, f2}']], out: 'consumers may read 0–3' },
        { note: 'Followers learn the new HW in the next fetch response. Their HW trails the leader’s by one round trip.', line: 0, vars: [['leader', 'HW 4'], ['f1', 'HW 3 → 4', 'read'], ['f2', 'HW 3 → 4', 'read']], heap: [['hw', 'HW 4', 'ok'], ['isr', 'ISR {leader, f1, f2}']], out: 'consumers may read 0–3' },
        { note: 'f2 stops fetching for 30 s and is dropped from the ISR. The HW reaches 5 and acks=all producers of offset 4 get their reply.', line: [0, 2], vars: [['leader', 'LEO 5'], ['f1', 'LEO 5', 'ok'], ['f2', 'out of sync', 'fail']], heap: [['hw', 'HW 5', 'ok'], ['isr', 'ISR {leader, f1}', 'warn', '2 ≥ min.insync 2']], out: 'consumers may read 0–4\nack offset 4' },
      ],
    },
  ],
  epoch: [
    'Leader epoch',
    {
      codeTitle: 'leader-epoch-checkpoint (broker B)',
      code: ['0 0      // epoch 0 starts at offset 0', '1 4      // epoch 1 starts at offset 4'],
      stackTitle: 'brokers',
      heapTitle: 'offset 4',
      details: {
        A: D('Uncommitted tail', 'A wrote x at offset 4, but the HW was 4, so x was never committed and no acks=all producer was told it succeeded.'),
        B: D('OffsetsForLeaderEpoch', 'A returning follower asks the leader where its last epoch ended and truncates there, instead of trusting its own high watermark (KIP-101).', 'OffsetsForLeaderEpoch(epoch=0) → endOffset=4'),
      },
      steps: [
        { note: 'Broker A leads in epoch 0 and wrote x at offset 4. B has fetched only up to 3, so the HW is 4 and x is uncommitted.', vars: [['A', 'leader · e0 · LEO 5', 'current', 'xa'], ['B', 'follower · LEO 4'], ['hw', 'HW 4', 'read']], heap: [['xa', 'A: 4 = x (e0)', 'warn']], out: '' },
        { note: 'A dies. The controller makes B leader and bumps the leader epoch to 1.', line: 0, vars: [['A', 'dead', 'fail', 'xa'], ['B', 'leader · e1 · LEO 4', 'current'], ['hw', 'HW 4', 'read']], heap: [['xa', 'A: 4 = x (e0)', 'muted']], out: '' },
        { note: 'B takes a new write y at offset 4 and records that epoch 1 starts there.', line: 1, vars: [['A', 'dead', 'fail', 'xa'], ['B', 'leader · e1 · LEO 5', 'write', 'yb'], ['hw', 'HW 4', 'read']], heap: [['xa', 'A: 4 = x (e0)', 'muted'], ['yb', 'B: 4 = y (e1)', 'write']], out: '' },
        { note: 'A restarts as a follower and asks where epoch 0 ended. B answers offset 4, the start of epoch 1.', line: [0, 1], vars: [['A', 'follower · e0?', 'current', 'xa'], ['B', 'leader · e1', 'read', 'yb'], ['hw', 'HW 4', 'read']], heap: [['xa', 'A: 4 = x (e0)', 'warn'], ['yb', 'B: 4 = y (e1)', 'read']], out: 'A → OffsetsForLeaderEpoch(0)\nB → endOffset 4' },
        { note: 'A truncates to 4, dropping x, then fetches y. Both replicas now hold the same history.', line: 1, vars: [['A', 'follower · e1 · LEO 5', 'ok', 'ya'], ['B', 'leader · e1 · LEO 5', 'ok', 'yb'], ['hw', 'HW 5', 'ok']], heap: [['ya', 'A: 4 = y (e1)', 'ok'], ['yb', 'B: 4 = y (e1)', 'ok']], out: 'A → OffsetsForLeaderEpoch(0)\nB → endOffset 4\nA truncated to 4, fetched y' },
        { note: 'Truncating to its own HW instead could keep x or cut committed records. The epoch tells a follower exactly where its history diverged.', line: 1, vars: [['A', 'follower · e1', 'ok'], ['B', 'leader · e1', 'ok'], ['hw', 'HW 5', 'ok']], heap: [['ya', 'A: 4 = y (e1)', 'ok'], ['yb', 'B: 4 = y (e1)', 'ok']], out: 'A truncated to 4, fetched y' },
      ],
    },
  ],
  kraft: [
    'KRaft quorum',
    {
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
    },
  ],
});

// ---------------- exactly-once ----------------
traceDemo('kafka-eos', 'Kafka exactly-once', 'Idempotent producers drop retried duplicates, transactions make writes across partitions atomic, and read_committed consumers stop at the last stable offset.', {
  idempotent: [
    'Idempotent producer',
    {
      codeTitle: 'producer.properties',
      code: ['enable.idempotence=true            // default since 3.0', 'acks=all', 'max.in.flight.requests.per.connection=5'],
      stackTitle: 'producer',
      heapTitle: 'leader orders-0',
      details: {
        pid: D('Producer ID', 'Assigned on start by InitProducerId. With a new PID after a restart, sequence checks start over, so idempotence is per session unless transactional.id is set.'),
        state: D('Producer state', 'Per partition, the leader remembers the last 5 batches of each PID. It is rebuilt from the log on failover, so a new leader dedupes too.'),
      },
      steps: [
        { note: 'On start the producer gets a producer ID and epoch. Every batch carries the PID and a per-partition sequence number.', line: 0, vars: [['pid', '42 · epoch 0', 'current'], ['batch', 'seq 0–9', 'write']], heap: [['state', 'PID 42: last seq 9', 'write'], ['log', 'offsets 0–9', 'read']], out: 'append seq 0–9' },
        { note: 'The leader appends seq 10–19, but the response is lost on the network.', line: 1, vars: [['pid', '42 · epoch 0'], ['batch', 'seq 10–19', 'warn']], heap: [['state', 'PID 42: last seq 19', 'write'], ['log', 'offsets 0–19', 'read']], out: 'append seq 0–9\nappend seq 10–19\nresponse lost' },
        { note: 'The producer times out and retries the same batch with the same sequence numbers.', line: 1, vars: [['pid', '42 · epoch 0'], ['batch', 'retry seq 10–19', 'current', 'state']], heap: [['state', 'PID 42: last seq 19', 'read'], ['log', 'offsets 0–19', 'read']], out: 'append seq 10–19\nresponse lost\nretry seq 10–19' },
        { note: 'The leader recognises seq 10–19 as a batch it already has. It returns the original offset without appending again.', line: 1, vars: [['pid', '42 · epoch 0'], ['batch', 'seq 10–19 · acked', 'ok']], heap: [['state', 'PID 42: last seq 19', 'ok', 'duplicate'], ['log', 'offsets 0–19', 'ok', 'no copy']], out: 'response lost\nretry seq 10–19\nDUPLICATE → ack offset 10' },
        { note: 'A batch starting at seq 25 would leave a gap, so the leader rejects it with OutOfOrderSequence. Up to 5 in-flight batches therefore keep their order.', line: 2, vars: [['pid', '42 · epoch 0'], ['batch', 'seq 25–29', 'fail']], heap: [['state', 'PID 42: expects 20', 'warn'], ['log', 'offsets 0–19', 'read']], out: 'retry seq 10–19\nDUPLICATE → ack offset 10\nOUT_OF_ORDER_SEQUENCE' },
      ],
    },
  ],
  txn: [
    'Transactions',
    {
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
    },
  ],
  lso: [
    'read_committed & LSO',
    {
      codeTitle: 'consumer.properties',
      code: ['isolation.level=read_committed', 'transaction.timeout.ms=60000'],
      stackTitle: 'consumer',
      heapTitle: 'out-0',
      details: {
        lso: D('Last stable offset', 'The first offset of the oldest open transaction in the partition, or the HW if none is open. read_committed fetches stop there.'),
        r2: D('Aborted transactions', 'A fetch response lists aborted transactions in range, built from the .txnindex file. The consumer drops their records client-side.'),
      },
      steps: [
        { note: 'Transactions T1 and T2 interleave in out-0. T1 has committed; T2 is still open.', line: 0, vars: [['lso', 'LSO 2', 'accent'], ['hw', 'HW 6', 'read']], heap: [['r0', '0 plain a', 'ok'], ['r1', '1 T1 b', 'ok'], ['r2', '2 T2 c', 'warn', 'open'], ['r3', '3 T1 COMMIT', 'protocol'], ['r4', '4 T1 d', 'ok'], ['r5', '5 T2 e', 'warn', 'open']], out: '' },
        { note: 'The last stable offset is the first offset of the oldest open transaction. read_committed reads only below it, even though T1’s later records are committed.', line: 0, vars: [['lso', 'LSO 2', 'accent', 'r2'], ['poll', 'returns 0, 1', 'ok']], heap: [['r0', '0 plain a', 'visited'], ['r1', '1 T1 b', 'visited'], ['r2', '2 T2 c', 'warn', 'open'], ['r3', '3 T1 COMMIT', 'muted'], ['r4', '4 T1 d', 'muted', 'waits'], ['r5', '5 T2 e', 'warn', 'open']], out: 'a b' },
        { note: 'T2 aborts, so an ABORT marker lands at 6 and the LSO jumps to the HW. The fetch response lists T2 as aborted and the consumer drops c and e.', line: 0, vars: [['lso', 'LSO 7', 'accent'], ['poll', 'returns 4', 'ok']], heap: [['r2', '2 T2 c', 'fail', 'aborted'], ['r3', '3 T1 COMMIT', 'muted'], ['r4', '4 T1 d', 'ok'], ['r5', '5 T2 e', 'fail', 'aborted'], ['r6', '6 T2 ABORT', 'protocol']], out: 'a b\nd' },
        { note: 'read_uncommitted reads up to the HW and would have returned c and e. A hung transaction pins the LSO until transaction.timeout.ms aborts it.', line: 1, vars: [['lso', 'LSO 7', 'accent'], ['uncommitted', 'saw a b c d e', 'warn']], heap: [['r2', '2 T2 c', 'fail'], ['r4', '4 T1 d', 'ok'], ['r5', '5 T2 e', 'fail']], out: 'a b\nd' },
      ],
    },
  ],
});

// ---------------- consumer groups ----------------
traceDemo('kafka-groups', 'Kafka consumer groups', 'The group coordinator runs JoinGroup and SyncGroup, cooperative rebalancing moves only the partitions that change owner, and static members restart without a rebalance.', {
  join: [
    'Join & sync',
    {
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
    },
  ],
  cooperative: [
    'Eager vs cooperative',
    {
      codeTitle: 'consumer.properties',
      code: ['// eager', 'partition.assignment.strategy=RangeAssignor', '// cooperative', 'partition.assignment.strategy=CooperativeStickyAssignor'],
      stackTitle: 'members',
      details: {
        c3: D('Incremental rebalance', 'Cooperative protocols revoke only partitions that move, then run a second quick rebalance to assign them. Consumption of the rest never stops (KIP-429).'),
      },
      steps: [
        { note: 'c1 owns P0–P2 and c2 owns P3–P5. Then c3 joins.', line: 3, vars: [['c1', 'P0 P1 P2', 'ok'], ['c2', 'P3 P4 P5', 'ok'], ['c3', 'joining', 'current']], out: '' },
        { note: 'Eager: every member revokes all its partitions before JoinGroup. Nothing is consumed until SyncGroup finishes.', line: 1, vars: [['c1', 'revoked all · paused', 'fail'], ['c2', 'revoked all · paused', 'fail'], ['c3', 'waiting', 'muted']], out: 'eager: stop the world' },
        { note: 'Cooperative: members rejoin while still consuming. The sticky plan moves only P2 and P5 to c3.', line: 3, vars: [['c1', 'P0 P1 · give up P2', 'warn'], ['c2', 'P3 P4 · give up P5', 'warn'], ['c3', 'nothing yet', 'muted']], out: 'eager: stop the world\ncooperative: revoke P2, P5' },
        { note: 'A second quick rebalance assigns the freed partitions to c3. Four of six partitions never stopped.', line: 3, vars: [['c1', 'P0 P1', 'ok'], ['c2', 'P3 P4', 'ok'], ['c3', 'P2 P5', 'ok']], out: 'eager: stop the world\ncooperative: revoke P2, P5\nassigned P2, P5 → c3' },
      ],
    },
  ],
  static: [
    'Static membership',
    {
      codeTitle: 'consumer.properties',
      code: ['group.instance.id=billing-c2', 'session.timeout.ms=45000'],
      stackTitle: 'members',
      heapTitle: 'coordinator',
      details: {
        c2: D('group.instance.id', 'A stable identity per instance, such as the pod name. The coordinator maps it to the member’s assignment across restarts (KIP-345).'),
      },
      steps: [
        { note: 'Without static membership, a rolling restart sends LeaveGroup, rebalances, then rejoins and rebalances again. Two pauses per instance.', line: 1, vars: [['c1', 'P0 P1 P2', 'ok'], ['c2', 'restarting', 'warn']], heap: [['coord', '2 rebalances', 'fail']], out: '' },
        { note: 'With group.instance.id, c2 shuts down without LeaveGroup. The coordinator keeps its partitions reserved.', line: 0, vars: [['c1', 'P0 P1 P2', 'ok'], ['c2', 'down', 'muted']], heap: [['coord', 'billing-c2 → P3 P4 P5', 'read', 'held']], out: '' },
        { note: 'It comes back within session.timeout.ms with the same id. The coordinator returns its old assignment with no rebalance.', line: [0, 1], vars: [['c1', 'P0 P1 P2', 'ok'], ['c2', 'P3 P4 P5', 'ok']], heap: [['coord', 'billing-c2 → P3 P4 P5', 'ok', 'no rebalance']], out: 'billing-c2 rejoined, gen unchanged' },
        { note: 'If it stays away past the timeout, the member is removed and a normal rebalance runs. P3–P5 lag while it is down, so keep the timeout near the restart time.', line: 1, vars: [['c1', 'P0–P5', 'warn'], ['c2', 'gone', 'fail']], heap: [['coord', 'expired → rebalance', 'warn']], out: 'billing-c2 rejoined, gen unchanged\nbilling-c2 expired' },
      ],
    },
  ],
});
