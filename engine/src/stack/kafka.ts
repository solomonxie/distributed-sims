// Kafka cluster ops from kafka-flow (group stack-kafka): KRaft bootstrap, topics, produce/consume path, failover, sizing.
import { boardDemo, N } from '../machine/lib/board';
import { D, seqDemo } from './lib';

const G = 'stack-kafka';

const PROPS = D(
  'server.properties (KRaft, 3 nodes)',
  'Every node is broker and controller. The three controllers form a static Raft quorum over port 9093; clients use 9092.',
  'process.roles=broker,controller\nnode.id=1            # 2, 3 on the others\ncontroller.quorum.voters=1@n1:9093,\\\n  2@n2:9093,3@n3:9093\ncontroller.listener.names=CONTROLLER\nlisteners=PLAINTEXT://0.0.0.0:9092,\\\n  CONTROLLER://0.0.0.0:9093\nadvertised.listeners=PLAINTEXT://<public-ip>:9092\nlog.dirs=/var/lib/kafka-logs',
);
const node = (n: number, extra = '') =>
  D(`node${n}`, `EC2 t2.small (1 vCPU, 2 GB), Kafka 4.3.1 in KRaft mode as broker + controller.${extra}`, `ssh ubuntu@$node${n}_ip\nsudo systemctl status kafka\nbin/kafka-metadata-quorum.sh \\\n  --bootstrap-server n${n}:9092 describe --status`);
const ADMIN = D('You (admin shell)', 'The commands from kafka_cluster/manual_build.sh, run over SSH or from any machine that can reach port 9092.', 'bin/kafka-topics.sh --bootstrap-server n1:9092 --list');
const PRODUCER = D('Producer', 'Lists all three brokers as bootstrap servers, so it survives any one being down. Any broker can answer the first Metadata request.', 'bin/kafka-console-producer.sh \\\n  --bootstrap-server n1:9092,n2:9092,n3:9092 \\\n  --topic clickstream-raw\n> {"event_type":"view","user_id":1001}');
const CONSUMER = D('Consumer', 'Reads partitions through their leaders, from the beginning or from its committed offset.', 'bin/kafka-console-consumer.sh \\\n  --bootstrap-server n1:9092,n2:9092,n3:9092 \\\n  --topic clickstream-raw --from-beginning');

seqDemo(G, 'stk-kafka-ops', 'Running a KRaft cluster', 'Bootstrap a 3-node KRaft quorum, create a replicated topic, follow one record producer → leader → followers → consumer, and kill a leader.', {
  format: [
    'Bootstrap KRaft',
    {
      panel: 'KRaft',
      lanes: [
        { id: 'admin', label: 'you', sub: 'ssh', detail: ADMIN },
        { id: 'n1', label: 'node1', sub: 'id 1', detail: node(1) },
        { id: 'n2', label: 'node2', sub: 'id 2', detail: node(2) },
        { id: 'n3', label: 'node3', sub: 'id 3', detail: node(3) },
      ],
      intro: 'Three fresh EC2 nodes with Kafka unpacked in /opt/kafka. No ZooKeeper: the controllers are Kafka nodes themselves.',
      msgs: [
        { from: 'admin', to: 'n1', label: 'server.properties', note: 'Set process.roles=broker,controller, a unique node.id and the static controller.quorum.voters list.', detail: PROPS },
        { from: 'admin', to: 'n1', label: 'storage format', note: 'kafka-storage.sh format writes meta.properties with the shared cluster ID into log.dirs. It runs once per node, never again.', detail: D('Format storage', 'All nodes must be formatted with the same cluster ID, or they refuse to join each other.', 'export CLUSTER_ID=IxqT0OtiQfqRl3kGlGV6tQ\nsudo bin/kafka-storage.sh format \\\n  -t $CLUSTER_ID -c config/server.properties') },
        { from: 'admin', to: 'n2', label: 'same, id 2', note: 'Repeat on node2 with node.id=2 and the same cluster ID.' },
        { from: 'admin', to: 'n3', label: 'same, id 3', note: 'And node3 with node.id=3. Now start kafka-server-start.sh on all three.' },
        { from: 'n1', to: 'n2', label: 'VoteRequest', note: 'The controllers hold a Raft election for the metadata quorum over the CONTROLLER listener on 9093.' },
        { from: 'n2', to: 'n1', label: 'vote yes', reply: true, note: 'node2 grants its vote. Two of three votes make node1 the active controller.' },
        { from: 'n3', to: 'n1', label: 'Fetch metadata', note: 'The other controllers replicate the metadata log from the leader by fetching, exactly like partition followers do.' },
        { from: 'n1', to: 'n3', label: 'records', reply: true, note: 'node1 returns new metadata records: registered brokers, topics, leaders.' },
        { from: 'admin', to: 'n1', label: 'topics --list', note: 'The cluster answers on 9092 once all three are up. Before that, a replication factor of 3 is impossible.' },
        { from: 'n1', to: 'admin', label: '(empty)', reply: true, note: 'An empty list: the cluster works and has no topics yet.' },
      ],
      outro: 'That is the whole bootstrap: config, format once, start, and the quorum elects a controller by itself.',
      outroRows: [['quorum', '3 voters'], ['active controller', 'node1', 'ok']],
    },
  ],
  topic: [
    'Create a topic',
    {
      panel: 'Topic',
      lanes: [
        { id: 'admin', label: 'you', detail: ADMIN },
        { id: 'n1', label: 'node1', sub: 'controller', detail: node(1, ' Active controller.') },
        { id: 'n2', label: 'node2', detail: node(2) },
        { id: 'n3', label: 'node3', detail: node(3) },
      ],
      intro: 'Create clickstream-raw with 3 partitions, each copied to all 3 brokers.',
      msgs: [
        { from: 'admin', to: 'n2', label: 'CreateTopics', note: 'Any broker accepts the request and forwards it to the active controller.', detail: D('Create a replicated topic', 'Replication factor 3 needs 3 live brokers.', 'bin/kafka-topics.sh --create \\\n  --bootstrap-server n1:9092 \\\n  --replication-factor 3 --partitions 3 \\\n  --topic clickstream-raw') },
        { from: 'n2', to: 'n1', label: 'forward', note: 'node2 forwards it to node1, the only node allowed to write metadata.' },
        { from: 'n1', to: 'n1', label: 'assign', note: 'The controller spreads leaders round robin: P0 on broker 2, P1 on 3, P2 on 1.' },
        { from: 'n1', to: 'n2', label: 'ok', reply: true, note: 'The assignment is committed to the metadata log.' },
        { from: 'n2', to: 'admin', label: 'Created topic', reply: true, note: 'The CLI prints “Created topic clickstream-raw.”' },
        { from: 'n3', to: 'n1', label: 'Fetch metadata', note: 'Each broker learns its new partitions from the metadata log and creates their log directories.' },
        { from: 'n1', to: 'n3', label: 'P1 leader=3', reply: true, note: 'node3 now leads P1 and follows P0 and P2.' },
        { from: 'admin', to: 'n1', label: 'describe', note: 'Describe shows the leader, replica list and ISR of every partition.' },
        { from: 'n1', to: 'admin', label: 'L 2,3,1 · ISR 3', reply: true, note: 'P0 leader 2, P1 leader 3, P2 leader 1, and every ISR has all 3 replicas.', detail: D('kafka-topics --describe', 'Isr lists replicas that are caught up. It shrinks when a follower falls behind or dies.', 'Topic: clickstream-raw  PartitionCount: 3\n  Partition: 0  Leader: 2  Replicas: 2,3,1  Isr: 2,3,1\n  Partition: 1  Leader: 3  Replicas: 3,1,2  Isr: 3,1,2\n  Partition: 2  Leader: 1  Replicas: 1,2,3  Isr: 1,2,3') },
      ],
      outro: 'Leadership is spread so each broker leads one partition and follows the other two.',
      outroRows: [['partitions', 3], ['replication factor', 3], ['leaders per broker', 1, 'ok']],
    },
  ],
  produce: [
    'One record, end to end',
    {
      panel: 'Record',
      lanes: [
        { id: 'p', label: 'producer', detail: PRODUCER },
        { id: 'n1', label: 'node1', sub: 'P1 follower', detail: node(1) },
        { id: 'n2', label: 'node2', sub: 'P1 follower', detail: node(2) },
        { id: 'n3', label: 'node3', sub: 'P1 leader', detail: node(3) },
        { id: 'c', label: 'consumer', detail: CONSUMER },
      ],
      intro: 'One click event, key user 1001, hashed to partition P1, which node3 leads.',
      msgs: [
        { from: 'p', to: 'n1', label: 'Metadata', note: 'The producer asks any bootstrap broker where every partition leader lives.' },
        { from: 'n1', to: 'p', label: 'P1 → node3', reply: true, note: 'node1 answers from its metadata cache: P1 is led by broker 3.' },
        { from: 'p', to: 'n3', label: 'Produce P1', note: 'The batch goes straight to the leader, never through another broker.' },
        { from: 'n3', to: 'n3', label: 'append @0', note: 'The leader appends the record at offset 0 of P1 and waits, because acks=all.' },
        { from: 'n1', to: 'n3', label: 'Fetch P1 @0', note: 'Follower node1 long-polls the leader for anything after its log end.' },
        { from: 'n3', to: 'n1', label: 'record 0', reply: true, note: 'node1 appends the same bytes at the same offset.' },
        { from: 'n2', to: 'n3', label: 'Fetch P1 @0', note: 'node2 does the same.' },
        { from: 'n3', to: 'n2', label: 'record 0', reply: true, note: 'All three ISR members have offset 0, so the high watermark moves to 1.' },
        { from: 'n3', to: 'p', label: 'ack offset 0', reply: true, note: 'Only now does the producer get its ack. With acks=1 it would have come right after the leader append.' },
        { from: 'c', to: 'n3', label: 'Fetch P1', note: 'The consumer reads from the leader, and only below the high watermark.' },
        { from: 'n3', to: 'c', label: 'record 0', reply: true, note: 'The console consumer prints the JSON event.' },
        { from: 'c', to: 'n2', label: 'OffsetCommit 1', note: 'A consumer in a group then commits “next offset is 1” to its group coordinator, here node2.' },
        { from: 'n2', to: 'c', label: 'committed', reply: true, note: 'After a restart, the group resumes from offset 1.' },
      ],
      outro: 'Thirteen messages for one record: metadata, produce, two follower fetches, the ack, the read and the commit.',
      outroRows: [['partition', 'P1'], ['offset', 0], ['copies', 3, 'ok']],
    },
  ],
  failover: [
    'Kill the leader',
    {
      panel: 'Failover',
      lanes: [
        { id: 'p', label: 'producer', detail: PRODUCER },
        { id: 'n1', label: 'node1', sub: 'controller', detail: node(1) },
        { id: 'n2', label: 'node2', detail: node(2) },
        { id: 'n3', label: 'node3', sub: 'P1 leader', detail: node(3) },
      ],
      intro: 'The experiment from manual_build.sh: kill the broker leading a partition and re-describe the topic.',
      msgs: [
        { from: 'n3', to: 'n3', label: 'kill -9', note: 'node3 dies. It led P1 and was a follower for P0 and P2.' },
        { from: 'p', to: 'n3', label: 'Produce P1', lost: true, note: 'The producer’s next batch for P1 gets no answer and times out.' },
        { from: 'n1', to: 'n1', label: 'no heartbeat', note: 'The controller stops receiving node3’s broker heartbeats and fences it.' },
        { from: 'n1', to: 'n1', label: 'P1 leader=1', note: 'It picks a new P1 leader from the ISR, node1, and bumps the leader epoch.' },
        { from: 'n2', to: 'n1', label: 'Fetch metadata', note: 'Brokers learn the change through the metadata log.' },
        { from: 'n1', to: 'n2', label: 'P1 → 1, epoch 1', reply: true, note: 'node2 now follows node1 for P1.' },
        { from: 'p', to: 'n1', label: 'Metadata', note: 'The producer refreshes metadata after the error.' },
        { from: 'n1', to: 'p', label: 'P1 → node1', reply: true, note: 'P1 is now led by node1.' },
        { from: 'p', to: 'n1', label: 'Produce P1', note: 'The retry goes to the new leader.' },
        { from: 'n1', to: 'p', label: 'ack', reply: true, note: 'Acked with two replicas in the ISR. No acknowledged record was lost, because the new leader came from the ISR.' },
      ],
      outro: 'Describe now shows P1 Leader 1, Isr 1,2. When node3 returns it truncates to the new leader’s log and catches up.',
      outroRows: [['P1 leader', 'node1', 'ok'], ['ISR', '1,2', 'warn'], ['acked lost', 0, 'ok']],
    },
  ],
});

const SEG = D('Log segment', 'Each partition is a directory of segment files. Reads of recent data hit the OS page cache, not the disk.', '/var/lib/kafka-logs/clickstream-raw-1/\n  00000000000000000000.log\n  00000000000000000000.index\n  00000000000000000000.timeindex');

boardDemo(G, 'stk-kafka-sizing', 'Sizing a Kafka cluster', 'Replication factor, partition count, heap vs page cache on a small node, and hot/cold tiered storage.', {
  rf: [
    'Replication factor',
    {
      panel: 'Replication',
      nodes: [
        N('b1', 40, 60, 280, 110, 'broker 1', 'P0 copy', { detail: node(1) }),
        N('b2', 360, 60, 280, 110, 'broker 2', 'P0 copy', { detail: node(2) }),
        N('b3', 680, 60, 280, 110, 'broker 3', 'P0 copy', { detail: node(3) }),
        N('rf1', 40, 300, 440, 150, 'RF 1 (helloworld)', 'one broker, no copies', { detail: D('kafka_helloworld', 'One node in KRaft standalone mode. Fine for learning offsets and partitions, useless for durability.', 'bin/kafka-storage.sh format --standalone \\\n  -t $CLUSTER_ID -c config/server.properties\nbin/kafka-topics.sh --create --replication-factor 1 \\\n  --partitions 3 --topic clickstream-raw') }),
        N('rf3', 520, 300, 440, 150, 'RF 3 (cluster)', 'survives 1 broker loss', { detail: D('RF 3 + min.insync.replicas=2', 'The usual production setting: with acks=all a write needs 2 of 3 copies, so one broker can die without losing acked data or blocking writes.', 'kafka-topics.sh --create --replication-factor 3 \\\n  --config min.insync.replicas=2 --topic orders') }),
        N('cost', 40, 560, 920, 130, 'cost', 'disk × RF, network × (RF − 1)'),
        N('rule', 40, 760, 920, 150, 'rule of thumb', 'RF 3, min.insync.replicas 2, acks=all'),
      ],
      edges: ['b1>b2', 'b2>b3'],
      beats: [
        { note: 'Replication factor is how many brokers hold a copy of each partition.', hot: { b1: 'current', b2: 'current', b3: 'current' }, hide: ['rf1', 'rf3', 'cost', 'rule'], rows: [['RF', 3]] },
        { note: 'The helloworld node uses RF 1: one disk failure loses the data.', hot: { rf1: 'warn' }, hide: ['rf3', 'cost', 'rule'], rows: [['RF 1 survives', '0 failures', 'warn']] },
        { note: 'The 3-node cluster uses RF 3, and a topic cannot use more replicas than there are live brokers.', hot: { rf3: 'ok' }, hide: ['cost', 'rule'], rows: [['RF 3 survives', '1–2 failures', 'ok']] },
        { note: 'Every copy costs disk and replication traffic.', hot: { cost: 'warn' }, hide: ['rule'], rows: [['disk', '× 3'], ['replication traffic', '× 2']] },
        { note: 'Pair RF 3 with min.insync.replicas=2 and acks=all for durability without stalling on one slow broker.', hot: { rule: 'ok' }, rows: [['acks', 'all'], ['min ISR', 2, 'ok']] },
      ],
    },
  ],
  partitions: [
    'Partition count',
    {
      panel: 'Partitions',
      nodes: [
        N('topic', 355, 40, 290, 110, 'clickstream-raw', 'topic'),
        N('p0', 40, 230, 280, 110, 'P0', 'offsets 0..'),
        N('p1', 360, 230, 280, 110, 'P1', 'user 1001 → here', { detail: D('Key → partition', 'The default partitioner hashes the key (murmur2) modulo the partition count. Same key, same partition, so per-key order holds.', 'partition = murmur2(key) % numPartitions') }),
        N('p2', 680, 230, 280, 110, 'P2', 'offsets 0..'),
        N('c1', 40, 460, 440, 120, 'consumer 1', 'P0, P1'),
        N('c2', 520, 460, 440, 120, 'consumer 2', 'P2'),
        N('c3', 280, 660, 440, 120, 'consumer 4', 'idle', { detail: D('More consumers than partitions', 'Each partition goes to at most one member of a group, so extra consumers sit idle.') }),
        N('grow', 40, 850, 920, 110, 'adding partitions later', 'moves keys → breaks per-key order'),
      ],
      edges: ['topic>p0', 'topic>p1', 'topic>p2', 'p0>c1', 'p1>c1', 'p2>c2'],
      beats: [
        { note: 'Partitions are the unit of parallelism: one leader, one log, one consumer per group.', hot: { topic: 'current' }, hide: ['c1', 'c2', 'c3', 'grow'], rows: [['partitions', 3]] },
        { note: 'A key always hashes to the same partition, which is the only place Kafka keeps order.', hot: { p1: 'current', 'topic>p1': 'accent' }, hide: ['c1', 'c2', 'c3', 'grow'], rows: [['order', 'per partition']] },
        { note: 'A consumer group splits partitions between its members.', hot: { c1: 'ok', c2: 'ok' }, hide: ['c3', 'grow'], rows: [['max busy consumers', 3]] },
        { note: 'A fourth consumer gets nothing, so partitions cap consumer parallelism.', hot: { c3: 'warn' }, hide: ['grow'], rows: [['idle consumers', 1, 'warn']] },
        { note: 'Adding partitions later remaps keys to new partitions and breaks per-key ordering, so size for peak throughput up front.', hot: { grow: 'fail' }, rows: [['plan for', 'peak consumers', 'warn']] },
      ],
    },
  ],
  memory: [
    'Heap vs page cache',
    {
      panel: 'Memory (t2.small)',
      nodes: [
        N('ram', 40, 40, 920, 110, 'RAM 2 GB', 't2.small'),
        N('heap', 40, 220, 300, 130, 'JVM heap', '512 MB', { detail: D('KAFKA_HEAP_OPTS', 'Kafka keeps little data on the heap: request buffers, metadata, indexes. Set a small fixed heap so the kernel keeps the rest for page cache.', 'export KAFKA_HEAP_OPTS="-Xmx512M -Xms512M"\nbin/kafka-server-start.sh -daemon \\\n  config/server.properties') }),
        N('os', 360, 220, 200, 130, 'OS', '~300 MB'),
        N('pc', 580, 220, 380, 130, 'page cache', '~1.2 GB', { detail: D('Page cache', 'Recent segments stay in the kernel page cache. Consumers that keep up read from memory, and sendfile copies straight to the socket.', 'free -m   # buff/cache column\nvmtouch /var/lib/kafka-logs/*/  # what is cached') }),
        N('seg', 40, 440, 440, 130, 'active segment', 'written + cached', { detail: SEG }),
        N('old', 520, 440, 440, 130, 'old segments', 'on disk'),
        N('fast', 40, 650, 440, 130, 'consumer at tail', 'memory speed'),
        N('slow', 520, 650, 440, 130, 'replay from start', 'disk reads'),
      ],
      edges: ['pc>seg', 'seg>fast', 'old>slow'],
      beats: [
        { note: 'On a 2 GB node the heap must stay small.', hot: { ram: 'current' }, hide: ['seg', 'old', 'fast', 'slow'], rows: [['RAM', '2 GB']] },
        { note: 'KAFKA_HEAP_OPTS pins the heap at 512 MB, leaving the rest to the OS page cache.', hot: { heap: 'write', pc: 'ok' }, hide: ['seg', 'old', 'fast', 'slow'], rows: [['heap', '512 MB'], ['page cache', '~1.2 GB', 'ok']] },
        { note: 'Writes land in the page cache and the kernel flushes them to disk later.', hot: { seg: 'current', 'pc>seg': 'accent' }, hide: ['fast', 'slow'], rows: [['fsync per write', 'no']] },
        { note: 'A consumer reading near the tail is served from memory.', hot: { fast: 'ok', 'seg>fast': 'accent' }, hide: ['slow'], rows: [['tail read', 'page cache', 'ok']] },
        { note: 'Replaying from the beginning reads old segments from disk and evicts the hot pages everyone else needs.', hot: { slow: 'warn', old: 'warn', 'old>slow': 'warn' }, rows: [['cold read', 'disk', 'warn']] },
      ],
    },
  ],
  tiered: [
    'Hot / cold tiers',
    {
      panel: 'Tiered storage',
      nodes: [
        N('broker', 355, 40, 290, 110, 'broker', 'partition leader'),
        N('hot', 40, 250, 420, 140, 'hot tier', 'local disk, recent', { detail: SEG }),
        N('cold', 540, 250, 420, 140, 'cold tier', 'object store, old', { detail: D('Tiered storage', 'Closed segments are copied to remote storage and deleted locally after local.retention.ms. The topic keeps its full retention.ms.', 'remote.log.storage.system.enable=true\n# per topic\nremote.storage.enable=true\nlocal.retention.ms=86400000     # 1 day hot\nretention.ms=2592000000         # 30 days total') }),
        N('tail', 40, 500, 420, 130, 'tail consumers', 'hot tier'),
        N('replay', 540, 500, 420, 130, 'backfill job', 'fetches from cold'),
        N('win', 40, 720, 920, 160, 'why', 'cheap long retention, small local disks, fast broker replacement'),
      ],
      edges: ['broker>hot', 'hot>cold', 'hot>tail', 'cold>replay'],
      beats: [
        { note: 'Without tiering, retention is bounded by the broker’s local disk.', hot: { broker: 'current', hot: 'warn' }, hide: ['cold', 'tail', 'replay', 'win'], rows: [['retention', 'disk-bound', 'warn']] },
        { note: 'With tiered storage, closed segments are copied to an object store and local copies expire early.', hot: { cold: 'write', 'hot>cold': 'accent' }, hide: ['tail', 'replay', 'win'], rows: [['hot', '1 day'], ['total', '30 days', 'ok']] },
        { note: 'Consumers at the tail never notice.', hot: { tail: 'ok', 'hot>tail': 'accent' }, hide: ['replay', 'win'], rows: [['tail latency', 'unchanged', 'ok']] },
        { note: 'A backfill reading old offsets is fetched from the cold tier, slower but without churning local disk.', hot: { replay: 'current', 'cold>replay': 'accent' }, hide: ['win'], rows: [['cold read', 'remote', 'warn']] },
        { note: 'Long retention gets cheap and a replacement broker has far less data to copy.', hot: { win: 'ok' }, rows: [['rebalance data', 'hot tier only', 'ok']] },
      ],
    },
  ],
});
