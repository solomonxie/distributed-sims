// Sequence views for the classic system-design topics: transactions, caching, consistency, rate limiting, queues, migration, auth, architecture.
import { boardDemo, N } from '../machine/lib/board';
import type { Actor, SeqMsg } from './lib';
import { naiveFleetLimit, sdDemo, seqFrames, slidingEstimate } from './lib';

// ---------- distributed transactions ----------
const coord: Actor = { id: 'co', label: 'Coordinator', detail: { title: 'Transaction coordinator', text: 'Drives both phases and writes its decision to a log before telling anyone, so it can finish the job after a crash.' } };
const orders: Actor = { id: 'od', label: 'Orders DB' };
const stock: Actor = { id: 'st', label: 'Inventory DB' };
const orch: Actor = { id: 'or', label: 'Saga orchestrator', detail: { title: 'Orchestrated saga', text: 'Calls each step and, on failure, each completed step’s compensation in reverse order.', code: 'steps = [(reserve, release), (charge, refund), (ship, cancel)]\nfor i, (do, undo) in enumerate(steps):\n    if not do(order): \n        for _, u in reversed(steps[:i]): u(order)\n        break' } };
const orderSvc: Actor = { id: 'os', label: 'Order svc' };
const invSvc: Actor = { id: 'is', label: 'Inventory svc' };
const paySvc: Actor = { id: 'ps', label: 'Payment svc' };
const app: Actor = { id: 'ap', label: 'Order svc' };
const odb: Actor = { id: 'db', label: 'Order DB', detail: { title: 'Outbox table', text: 'The event row is written in the same local transaction as the business row, so both commit or neither does.', code: 'BEGIN;\nINSERT INTO orders (...) VALUES (...);\nINSERT INTO outbox (topic, payload)\n  VALUES (\'OrderPlaced\', \'{"id":42}\');\nCOMMIT;' } };
const relay: Actor = { id: 'rl', label: 'Relay / CDC', detail: { title: 'Outbox relay', text: 'Polls the outbox (or tails the change log with Debezium), publishes, then marks rows sent. Publishing can repeat, so consumers dedupe.' } };
const broker: Actor = { id: 'bk', label: 'Broker', detail: { title: 'Broker', text: 'Holds events until consumers take them. In choreography it is the only place the whole flow passes through.' } };
const consumer: Actor = { id: 'cs', label: 'Email svc' };

const twoPc: SeqMsg[] = [
  { from: 'co', to: 'od', label: 'PREPARE tx42', note: 'Phase 1: the coordinator asks each participant to do the work and hold its locks, without committing.' },
  { from: 'co', to: 'st', label: 'PREPARE tx42', note: 'Both databases get the same request.' },
  { from: 'od', to: 'co', label: 'VOTE YES', kind: 'resp', note: 'Orders has written the change to its log and promises it can commit.' },
  { from: 'st', to: 'co', label: 'VOTE YES', kind: 'resp', note: 'Inventory promises too. Both are now holding locks.' },
  { from: 'co', to: 'co', label: 'log COMMIT', kind: 'self', note: 'All voted yes, so the coordinator durably records the decision first.' },
  { from: 'co', to: 'od', label: 'COMMIT tx42', note: 'Phase 2: every participant must now commit.' },
  { from: 'co', to: 'st', label: 'COMMIT tx42', note: 'Same decision to the other participant.' },
  { from: 'od', to: 'co', label: 'ACK', kind: 'resp', note: 'Orders committed and released its locks.' },
  { from: 'st', to: 'co', label: 'ACK', kind: 'resp', note: 'Inventory too. Eight messages and two log writes for one atomic change.' },
];
const twoPcAbort: SeqMsg[] = [
  { from: 'co', to: 'od', label: 'PREPARE tx43', note: 'Phase 1 again.' },
  { from: 'co', to: 'st', label: 'PREPARE tx43', note: 'Inventory is asked for the last unit, which someone else holds.' },
  { from: 'od', to: 'co', label: 'VOTE YES', kind: 'resp', note: 'Orders is ready and holding locks.' },
  { from: 'st', to: 'co', label: 'VOTE NO', kind: 'fail', note: 'Inventory cannot do it. One NO aborts the whole transaction.' },
  { from: 'co', to: 'od', label: 'ABORT tx43', note: 'The coordinator tells the prepared participant to roll back.' },
  { from: 'od', to: 'co', label: 'ACK', kind: 'resp', note: 'Orders releases its locks. If the coordinator had crashed before this, Orders would sit locked and blocked.' },
];
const saga: SeqMsg[] = [
  { from: 'or', to: 'os', label: 'create order', note: 'Each step is a local transaction that commits immediately.' },
  { from: 'os', to: 'or', label: 'ok (PENDING)', kind: 'resp', note: 'The order exists in a pending state that other readers can see.' },
  { from: 'or', to: 'is', label: 'reserve 1 unit', note: 'Next step: reserve stock.' },
  { from: 'is', to: 'or', label: 'ok', kind: 'resp', note: 'Stock is reserved and committed.' },
  { from: 'or', to: 'ps', label: 'charge $30', note: 'Then charge the card.' },
  { from: 'ps', to: 'or', label: 'ok', kind: 'resp', note: 'Charged.' },
  { from: 'or', to: 'os', label: 'confirm order', note: 'The last step flips the order to confirmed. There was never a global lock.' },
];
const sagaFail: SeqMsg[] = [
  { from: 'or', to: 'os', label: 'create order', note: 'Same saga, but the card will be declined.' },
  { from: 'or', to: 'is', label: 'reserve 1 unit', note: 'Stock is reserved and committed.' },
  { from: 'or', to: 'ps', label: 'charge $30', note: 'The charge is attempted.' },
  { from: 'ps', to: 'or', label: 'DECLINED', kind: 'fail', note: 'The card is declined, so the saga must undo what already committed.' },
  { from: 'or', to: 'is', label: 'release 1 unit', note: 'Compensations run in reverse order: first release the stock.' },
  { from: 'is', to: 'or', label: 'ok', kind: 'resp', note: 'Released. It must be idempotent, because a retry can call it twice.' },
  { from: 'or', to: 'os', label: 'cancel order', note: 'Then cancel the order.' },
  { from: 'os', to: 'or', label: 'ok (CANCELLED)', kind: 'resp', note: 'Consistent again, through compensation rather than rollback. Test compensations as hard as the happy path.' },
];
const outbox: SeqMsg[] = [
  { from: 'ap', to: 'db', label: 'BEGIN … orders + outbox', note: 'One local transaction writes the order row and an OrderPlaced row in the outbox table.' },
  { from: 'db', to: 'ap', label: 'COMMIT ok', kind: 'resp', note: 'Both rows committed, or neither did. No dual-write gap.' },
  { from: 'rl', to: 'db', label: 'SELECT unsent', note: 'Separately, the relay reads unsent outbox rows.' },
  { from: 'db', to: 'rl', label: 'OrderPlaced 42', kind: 'resp', note: 'It finds the new event.' },
  { from: 'rl', to: 'bk', label: 'publish', kind: 'async', note: 'It publishes to the broker.' },
  { from: 'rl', to: 'db', label: 'UPDATE sent=true', note: 'Then marks it sent. A crash between these two republishes the event.' },
  { from: 'bk', to: 'cs', label: 'OrderPlaced 42', kind: 'async', note: 'Consumers receive it at least once, so they dedupe by event id.' },
];
const choreo: SeqMsg[] = [
  { from: 'os', to: 'bk', label: 'OrderPlaced', kind: 'async', note: 'Choreography: no orchestrator. The order service just publishes an event.' },
  { from: 'bk', to: 'is', label: 'OrderPlaced', kind: 'async', note: 'Inventory reacts to it.' },
  { from: 'is', to: 'bk', label: 'StockReserved', kind: 'async', note: 'And publishes its own event.' },
  { from: 'bk', to: 'ps', label: 'StockReserved', kind: 'async', note: 'Payment reacts to that one.' },
  { from: 'ps', to: 'bk', label: 'PaymentFailed', kind: 'fail', note: 'Payment fails and says so.' },
  { from: 'bk', to: 'is', label: 'PaymentFailed', kind: 'async', note: 'Inventory listens for it and releases the stock.' },
  { from: 'bk', to: 'os', label: 'PaymentFailed', kind: 'async', note: 'Order listens too and cancels. The flow lives in every handler, so no one place shows it.' },
];
sdDemo('sd-txn', 'sd-txn-seq', 'Transactions, message by message', '2PC commit and abort, orchestrated and choreographed sagas, and the outbox, one request or response per step.', {
  '2pc': ['2PC commit', () => seqFrames({ actors: [coord, orders, stock], msgs: twoPc, intro: 'An order and a stock decrement in two databases must commit together.', panel: '2PC' })],
  '2pc-abort': ['2PC abort', () => seqFrames({ actors: [coord, orders, stock], msgs: twoPcAbort, intro: 'The same protocol when one participant says no.', panel: '2PC' })],
  saga: ['Saga', () => seqFrames({ actors: [orch, orderSvc, invSvc, paySvc], msgs: saga, intro: 'A saga replaces one global transaction with local steps.', panel: 'Saga' })],
  'saga-fail': ['Saga + compensation', () => seqFrames({ actors: [orch, orderSvc, invSvc, paySvc], msgs: sagaFail, intro: 'A late step fails after earlier ones committed.', panel: 'Saga' })],
  choreo: ['Choreography', () => seqFrames({ actors: [orderSvc, broker, invSvc, paySvc], msgs: choreo, intro: 'The same saga with events instead of an orchestrator.', panel: 'Saga' })],
  outbox: ['Outbox', () => seqFrames({ actors: [app, odb, relay, broker, consumer], msgs: outbox, intro: 'Write to your DB and publish an event, without losing either.', panel: 'Outbox' })],
});

// ---------- caching ----------
const appS: Actor = { id: 'a', label: 'App ×3' };
const redis: Actor = { id: 'r', label: 'Redis', detail: { title: 'Distributed cache', text: 'Shared by all instances, so one place to invalidate. Its outage must make things slower, never wrong.', code: 'SET lock:user:7 1 NX PX 2000   # single-flight\nGET user:7\nSET user:7 "{...}" EX 300' } };
const dbS: Actor = { id: 'd', label: 'Database' };
const stampede: SeqMsg[] = [
  { from: 'r', to: 'r', label: 'user:7 expires', kind: 'self', note: 'A hot key’s TTL runs out.' },
  { from: 'a', to: 'r', label: '500 × GET user:7', note: 'Hundreds of in-flight requests look it up in the same millisecond.' },
  { from: 'r', to: 'a', label: '500 × miss', kind: 'resp', note: 'All of them miss.' },
  { from: 'a', to: 'd', label: '500 × SELECT', kind: 'fail', note: 'All of them go to the database for the same row. That is a stampede.' },
  { from: 'd', to: 'a', label: 'slow, then timeouts', kind: 'fail', note: 'The database saturates and even unrelated queries slow down.' },
];
const single: SeqMsg[] = [
  { from: 'a', to: 'r', label: 'GET user:7 → miss', note: 'The first request misses.' },
  { from: 'a', to: 'r', label: 'SET lock NX → ok', note: 'It wins a short lock, so it alone refills.' },
  { from: 'a', to: 'r', label: '499 × lock NX → taken', note: 'Everyone else sees the lock and waits briefly instead of hitting the DB.' },
  { from: 'a', to: 'd', label: '1 × SELECT', note: 'Exactly one query reaches the database.' },
  { from: 'a', to: 'r', label: 'SET user:7 EX 300', note: 'The winner writes the value back with a jittered TTL.' },
  { from: 'r', to: 'a', label: '499 × hit', kind: 'resp', note: 'The waiters retry and hit. One DB query instead of five hundred.' },
];
const swr: SeqMsg[] = [
  { from: 'a', to: 'r', label: 'GET user:7', note: 'Stale-while-revalidate keeps a soft TTL inside the value.' },
  { from: 'r', to: 'a', label: 'hit (soft-expired)', kind: 'resp', note: 'The value is past its soft TTL but still present.' },
  { from: 'a', to: 'a', label: 'serve stale now', kind: 'self', note: 'The user gets the slightly old value immediately.' },
  { from: 'a', to: 'd', label: 'refresh in background', kind: 'async', note: 'One background refresh runs.' },
  { from: 'a', to: 'r', label: 'SET fresh value', note: 'The cache is fresh again. No request ever waited on the database.' },
];
sdDemo('sd-caching', 'sd-cache-herd', 'Cache stampede', 'A hot key expiring under load, then single-flight locking and stale-while-revalidate.', {
  stampede: ['Stampede', () => seqFrames({ actors: [appS, redis, dbS], msgs: stampede, intro: 'Cache-aside works until a hot key expires under load.', panel: 'Cache' })],
  singleflight: ['Single-flight', () => seqFrames({ actors: [appS, redis, dbS], msgs: single, intro: 'Only one request may refill a key.', panel: 'Cache' })],
  swr: ['Stale-while-revalidate', () => seqFrames({ actors: [appS, redis, dbS], msgs: swr, intro: 'Serve the old value while fetching a new one.', panel: 'Cache' })],
});
boardDemo('sd-caching', 'sd-cache-layers', 'Where caches live', 'Browser, CDN, in-process and distributed caches: speed, sharing and how invalidation reaches each.', {
  layers: [
    'Layers',
    {
      panel: 'Caches',
      nodes: [
        N('br', 355, 20, 290, 110, 'browser', 'Cache-Control', { detail: { title: 'Client cache', text: 'Free when it hits, but you cannot push an invalidation to every client. Only the TTL you set.', code: 'Cache-Control: private, max-age=60' } }),
        N('cdn', 355, 200, 290, 110, 'CDN edge', 'purge API'),
        N('app', 355, 380, 290, 110, 'app ×3', 'in-process LRU', { detail: { title: 'In-process cache', text: 'Fastest possible hit, but each replica has its own copy: cold after deploy, invalidated one instance at a time.' } }),
        N('redis', 355, 560, 290, 110, 'Redis', 'shared'),
        N('db', 355, 740, 290, 110, 'database', 'source of truth'),
      ],
      edges: ['br>cdn', 'cdn>app', 'app>redis', 'redis>db'],
      beats: [
        { note: 'The closer a cache is to the user, the faster the hit and the harder the invalidation.', hot: { br: 'current' }, rows: [['invalidate', 'TTL only', 'warn']] },
        { note: 'The CDN caches static assets and cacheable responses; invalidation is a purge that propagates over seconds.', hot: { cdn: 'current', 'br>cdn': 'accent' } },
        { note: 'An in-process cache costs nothing per hit but is not shared across replicas.', hot: { app: 'current', 'cdn>app': 'accent' }, rows: [['copies', 'one per instance', 'warn']] },
        { note: 'A distributed cache is one shared place to invalidate, one network hop away.', hot: { redis: 'current', 'app>redis': 'accent' }, rows: [['copies', 'one', 'ok']] },
        { note: 'The database stays the truth. Alert on cache hit rate: a silent drop shows up as database load.', hot: { db: 'ok', 'redis>db': 'accent' } },
      ],
    },
  ],
});

// ---------- consistency ----------
const user: Actor = { id: 'u', label: 'User' };
const primary: Actor = { id: 'p', label: 'Primary', detail: { title: 'Primary', text: 'Takes all writes and streams its log to replicas asynchronously.', code: 'SELECT pg_current_wal_lsn();\n-- 0/3A1F9812' } };
const replica: Actor = { id: 'r1', label: 'Replica 1', sub: 'lag 800 ms', detail: { title: 'Replica lag', text: 'How far a replica trails the primary. Nothing is broken; it is simply behind.', code: 'SELECT now() - pg_last_xact_replay_timestamp()\n  AS lag;  -- 00:00:00.8' } };
const replica2: Actor = { id: 'r2', label: 'Replica 2', sub: 'lag 50 ms' };
const ryw: SeqMsg[] = [
  { from: 'u', to: 'p', label: 'UPDATE name="Ann"', note: 'The user renames their profile; writes go to the primary.' },
  { from: 'p', to: 'u', label: 'ok', kind: 'resp', note: 'Committed on the primary.' },
  { from: 'u', to: 'r1', label: 'GET profile', note: 'The page reloads and the read is routed to a replica for scale.' },
  { from: 'r1', to: 'u', label: 'name="Anne"', kind: 'fail', note: 'The replica is 800 ms behind, so the user sees their old name. Their own write vanished.' },
  { from: 'p', to: 'r1', label: 'replicate', kind: 'async', note: 'The change arrives a moment later. Nothing failed; this is ordinary replica lag.' },
];
const rywFix: SeqMsg[] = [
  { from: 'u', to: 'p', label: 'UPDATE name="Ann"', note: 'Same write.' },
  { from: 'p', to: 'u', label: 'ok, lsn 9812', kind: 'resp', note: 'The response carries the write’s log position, kept in the session.' },
  { from: 'u', to: 'p', label: 'GET profile (recent write)', note: 'For a few seconds after writing, this user’s reads go to the primary, or a replica past lsn 9812.' },
  { from: 'p', to: 'u', label: 'name="Ann"', kind: 'resp', note: 'Read-your-writes holds for this user. Others may still see the old name briefly.' },
];
const mono: SeqMsg[] = [
  { from: 'u', to: 'r2', label: 'GET comments', note: 'The first read lands on a replica that is nearly caught up.' },
  { from: 'r2', to: 'u', label: '12 comments', kind: 'resp', note: 'The user sees 12 comments.' },
  { from: 'u', to: 'r1', label: 'GET comments', note: 'The refresh is load-balanced to a laggier replica.' },
  { from: 'r1', to: 'u', label: '10 comments', kind: 'fail', note: 'Two comments disappear: time went backwards. Monotonic reads forbids that.' },
  { from: 'u', to: 'r2', label: 'sticky: same replica', note: 'Pin each session to one replica, or read from one at least as fresh as last time.' },
];
sdDemo('sd-consistency', 'sd-consistency-seq', 'Consistency you can feel', 'Read-your-writes and monotonic reads broken by ordinary replica lag, and the fixes.', {
  ryw: ['Read-your-writes broken', () => seqFrames({ actors: [user, primary, replica], msgs: ryw, intro: 'Reads from replicas scale, until a user reads their own write.', panel: 'Consistency' })],
  'ryw-fix': ['Read-your-writes fixed', () => seqFrames({ actors: [user, primary, replica], msgs: rywFix, intro: 'Route a user’s reads by their own recent writes.', panel: 'Consistency' })],
  monotonic: ['Monotonic reads', () => seqFrames({ actors: [user, primary, replica, replica2], msgs: mono, intro: 'Two replicas with different lag.', panel: 'Consistency' })],
});

// ---------- rate limiting ----------
const cli: Actor = { id: 'c', label: 'Client' };
const lb: Actor = { id: 'lb', label: 'LB' };
const i1: Actor = { id: 'i1', label: 'API 1', detail: { title: 'Local counter', text: 'An in-memory counter only sees this instance’s share of traffic.', code: 'counts[key] += 1\nif counts[key] > LIMIT: return 429' } };
const i2: Actor = { id: 'i2', label: 'API 2' };
const i3: Actor = { id: 'i3', label: 'API 3' };
const rr: Actor = { id: 'rd', label: 'Redis', detail: { title: 'Shared counter', text: 'One counter per key and window for the whole fleet. Decide up front whether to fail open or closed if Redis is down.', code: 'MULTI\nINCR rl:key42:1717430400\nEXPIRE rl:key42:1717430400 60\nEXEC' } };
const naive: SeqMsg[] = [
  { from: 'c', to: 'lb', label: '300 req in 1 min', note: 'The plan allows 100 requests a minute per API key.' },
  { from: 'lb', to: 'i1', label: '100 req', note: 'The load balancer spreads them across three instances.' },
  { from: 'lb', to: 'i2', label: '100 req', note: 'Each instance counts in its own memory.' },
  { from: 'lb', to: 'i3', label: '100 req', note: 'Each sees exactly 100, under the limit.' },
  { from: 'i1', to: 'c', label: '300 × 200 OK', kind: 'fail', note: `Local counters make the real limit ${naiveFleetLimit(100, 3)} a minute. It grows with every instance you add.` },
];
const shared: SeqMsg[] = [
  { from: 'c', to: 'lb', label: 'request 101', note: 'The same client, now with a shared counter.' },
  { from: 'lb', to: 'i2', label: 'request 101', note: 'It lands on any instance.' },
  { from: 'i2', to: 'rd', label: 'INCR rl:key42:min', note: 'The instance increments the fleet-wide counter for this key and minute.' },
  { from: 'rd', to: 'i2', label: '101', kind: 'resp', note: 'The count is 101, over the limit.' },
  { from: 'i2', to: 'c', label: '429 Retry-After: 23', kind: 'resp', note: 'Rejected with a 429 and a Retry-After, so good clients back off instead of hammering.' },
];
const sliding: SeqMsg[] = [
  { from: 'c', to: 'i1', label: '90 req at 0:59', note: 'A fixed per-minute window: 90 requests in the last second of a minute.' },
  { from: 'c', to: 'i1', label: '90 req at 1:01', note: 'The counter resets at 1:00, so 90 more pass two seconds later.' },
  { from: 'i1', to: 'i1', label: '180 in 2 s', kind: 'fail', note: 'Nearly double the limit got through around the boundary.' },
  { from: 'i1', to: 'i1', label: 'sliding estimate', kind: 'self', note: `The sliding counter weighs the previous window by its overlap: 90 × 0.98 + 90 ≈ ${Math.round(slidingEstimate(90, 90, 0.02))}.` },
  { from: 'i1', to: 'c', label: '429', kind: 'resp', note: 'Over 100, so the second burst is rejected. Nearly as accurate as a log, nearly as cheap as a counter.' },
];
sdDemo('sd-ratelimit', 'sd-ratelimit-seq', 'Enforcing a limit', 'Per-instance counters multiplying the limit, a shared Redis counter with 429 + Retry-After, and the window-boundary burst.', {
  naive: ['Local counters', () => seqFrames({ actors: [cli, lb, i1, i2, i3], msgs: naive, intro: 'Three API instances, each limiting on its own.', panel: 'Limit 100/min' })],
  shared: ['Shared counter', () => seqFrames({ actors: [cli, lb, i2, rr], msgs: shared, intro: 'One counter for the whole fleet.', panel: 'Limit 100/min' })],
  boundary: ['Window boundary', () => seqFrames({ actors: [cli, i1], msgs: sliding, intro: 'Fixed windows let bursts straddle the reset.', panel: 'Limit 100/min' })],
});

// ---------- delivery guarantees ----------
const prod: Actor = { id: 'pr', label: 'Producer' };
const q: Actor = { id: 'q', label: 'Queue' };
const worker: Actor = { id: 'w', label: 'Consumer', detail: { title: 'Idempotent consumer', text: 'The dedupe check is atomic with the side effect: same transaction, unique key on the message id.', code: 'BEGIN;\nINSERT INTO processed (msg_id) VALUES ($1);\n-- unique violation → already done, skip\nUPDATE accounts SET balance = balance - 30 ...;\nCOMMIT;' } };
const bank: Actor = { id: 'db', label: 'Accounts DB' };
const atMost: SeqMsg[] = [
  { from: 'q', to: 'w', label: 'deliver m7', note: 'At-most-once: the consumer acks as soon as it receives.' },
  { from: 'w', to: 'q', label: 'ack m7', kind: 'resp', note: 'The queue deletes the message.' },
  { from: 'w', to: 'w', label: 'crash before work', kind: 'fail', note: 'The consumer dies before doing the work.' },
  { from: 'q', to: 'q', label: 'm7 gone', kind: 'self', note: 'Nobody will ever process m7. Usually an accident, not a choice.' },
];
const atLeast: SeqMsg[] = [
  { from: 'q', to: 'w', label: 'deliver m7', note: 'At-least-once: ack only after the work is done.' },
  { from: 'w', to: 'db', label: 'debit $30', note: 'The consumer does the work.' },
  { from: 'w', to: 'w', label: 'crash before ack', kind: 'fail', note: 'It crashes after the debit but before acking.' },
  { from: 'q', to: 'w', label: 'redeliver m7', note: 'The visibility timeout expires and the queue redelivers.' },
  { from: 'w', to: 'db', label: 'debit $30 again', kind: 'fail', note: 'The customer is charged twice. Duplicates are normal here, not a bug in the queue.' },
];
const idem: SeqMsg[] = [
  { from: 'q', to: 'w', label: 'deliver m7', note: 'The same flow with an idempotent consumer.' },
  { from: 'w', to: 'db', label: 'BEGIN; mark m7; debit', note: 'Recording m7 as processed and the debit happen in one transaction.' },
  { from: 'w', to: 'w', label: 'crash before ack', kind: 'fail', note: 'It crashes before acking.' },
  { from: 'q', to: 'w', label: 'redeliver m7', note: 'The queue redelivers.' },
  { from: 'w', to: 'db', label: 'mark m7 → conflict', note: 'The unique key on the message id rejects it.' },
  { from: 'w', to: 'q', label: 'ack m7 (skip)', kind: 'resp', note: 'Skipped and acked. At-least-once plus idempotency gives the exactly-once outcome.' },
];
const publish: SeqMsg[] = [
  { from: 'pr', to: 'q', label: 'send m7', note: 'Duplicates also start at the producer.' },
  { from: 'q', to: 'pr', label: 'ack (lost)', kind: 'fail', note: 'The queue stored it, but the ack is lost.' },
  { from: 'pr', to: 'q', label: 'send m7 again', note: 'The producer retries, and now there are two copies.' },
  { from: 'q', to: 'w', label: 'deliver m7 ×2', note: 'Only the consumer’s idempotency key can tell them apart.' },
];
sdDemo('sd-mq', 'sd-mq-delivery', 'Delivery guarantees', 'At-most-once, at-least-once with duplicates, and the idempotent consumer, message by message.', {
  atmost: ['At-most-once', () => seqFrames({ actors: [q, worker, bank], msgs: atMost, intro: 'Ack first, work second.', panel: 'Delivery' })],
  atleast: ['At-least-once', () => seqFrames({ actors: [q, worker, bank], msgs: atLeast, intro: 'Work first, ack second.', panel: 'Delivery' })],
  idempotent: ['Idempotent consumer', () => seqFrames({ actors: [q, worker, bank], msgs: idem, intro: 'Dedupe atomically with the side effect.', panel: 'Delivery' })],
  producer: ['Producer retry', () => seqFrames({ actors: [prod, q, worker], msgs: publish, intro: 'Retries on the send side create duplicates too.', panel: 'Delivery' })],
});

// ---------- migration ----------
boardDemo('sd-migration', 'sd-migration-phases', 'Expand / contract', 'Zero-downtime schema change in independently reversible phases, and dual-write vs CDC for datastore moves.', {
  expand: [
    'Expand / contract',
    {
      panel: 'Rename full_name → name',
      nodes: [
        N('p1', 30, 60, 440, 130, '1 expand', 'ADD COLUMN name NULL', { detail: { title: 'Expand', text: 'Additive only: old code ignores the new column, so a rolling deploy is safe.', code: 'ALTER TABLE users ADD COLUMN name text;\n-- app v2 writes full_name AND name' } }),
        N('p2', 530, 60, 440, 130, '2 backfill', 'batched, throttled', { detail: { title: 'Backfill', text: 'Small batches, rate-limited, resumable. One giant UPDATE means long locks and replica lag.', code: 'UPDATE users SET name = full_name\nWHERE id BETWEEN $1 AND $1 + 999\n  AND name IS NULL;' } }),
        N('p3', 30, 300, 440, 130, '3 migrate reads', 'read name, write both'),
        N('p4', 530, 300, 440, 130, '4 contract', 'DROP full_name', { detail: { title: 'Contract', text: 'Only once nothing reads the old column. Never in the same release that stops using it.', code: 'ALTER TABLE users DROP COLUMN full_name;' } }),
        N('ver', 30, 560, 940, 130, 'verify', 'counts, checksums, sampled diffs'),
        N('rb', 30, 780, 940, 130, 'rollback at any phase', 'no phase leaves the system broken'),
      ],
      edges: ['p1>p2', 'p2>p3', 'p3>p4'],
      beats: [
        { note: 'Old and new code run side by side during every rolling deploy, so each step must work with both.', hide: ['ver', 'rb'], rows: [['phases', 4]] },
        { note: 'Expand: add the new column and deploy code that writes both. Nothing reads it yet.', hot: { p1: 'current' }, hide: ['ver', 'rb'] },
        { note: 'Backfill existing rows in small, throttled, resumable batches.', hot: { p2: 'current', 'p1>p2': 'accent' }, hide: ['ver', 'rb'] },
        { note: 'Verify before trusting it: row counts, checksums, sampled diffs.', hot: { ver: 'warn' }, hide: ['rb'], rows: [['silent corruption', 'caught here', 'ok']] },
        { note: 'Migrate reads to the new column while still writing both.', hot: { p3: 'current', 'p2>p3': 'accent' } },
        { note: 'Contract: drop the old column in a later release. Every phase was independently reversible.', hot: { p4: 'ok', rb: 'ok', 'p3>p4': 'accent' }, rows: [['downtime', 0, 'ok']] },
      ],
    },
  ],
});
const svc: Actor = { id: 'sv', label: 'App' };
const oldDb: Actor = { id: 'od', label: 'Old DB' };
const cdc: Actor = { id: 'cd', label: 'CDC (Debezium)', detail: { title: 'Change data capture', text: 'Tails the old database’s write-ahead log and replays every change into the new store, keeping one write path in the app.' } };
const newDb: Actor = { id: 'nd', label: 'New DB', detail: { title: 'Target store', text: 'Filled by backfill plus ongoing changes, verified with counts and checksums before any read moves to it.' } };
const dual: SeqMsg[] = [
  { from: 'sv', to: 'od', label: 'INSERT order 9', note: 'Dual-write: the app writes to the old store.' },
  { from: 'od', to: 'sv', label: 'ok', kind: 'resp', note: 'Committed there.' },
  { from: 'sv', to: 'nd', label: 'INSERT order 9', kind: 'fail', note: 'Then to the new one, but this write times out.' },
  { from: 'sv', to: 'sv', label: 'stores diverged', kind: 'self', note: 'The two writes were not atomic, so the stores now disagree. Dual-write needs a reconciliation job.' },
];
const viaCdc: SeqMsg[] = [
  { from: 'sv', to: 'od', label: 'INSERT order 9', note: 'With CDC the app keeps a single write path.' },
  { from: 'od', to: 'sv', label: 'ok', kind: 'resp', note: 'Committed and appended to the WAL.' },
  { from: 'cd', to: 'od', label: 'read WAL', note: 'The CDC connector tails the log.' },
  { from: 'cd', to: 'nd', label: 'apply order 9', kind: 'async', note: 'And applies each change to the new store, in commit order.' },
  { from: 'sv', to: 'nd', label: 'shadow read + compare', note: 'Before cutover, compare reads from both stores.' },
  { from: 'sv', to: 'nd', label: 'cut reads over 1% → 100%', note: 'Then shift reads gradually, keeping the old store as the rollback for a defined window.' },
];
sdDemo('sd-migration', 'sd-migration-seq', 'Moving datastores', 'Dual-write drifting on a partial failure vs change data capture and a gradual read cutover.', {
  dual: ['Dual-write', () => seqFrames({ actors: [svc, oldDb, newDb], msgs: dual, intro: 'Moving orders to a new database while live.', panel: 'Migration' })],
  cdc: ['CDC + cutover', () => seqFrames({ actors: [svc, oldDb, cdc, newDb], msgs: viaCdc, intro: 'Replicate from the log instead of writing twice.', panel: 'Migration' })],
});

// ---------- authentication ----------
const browser: Actor = { id: 'b', label: 'Browser' };
const webapp: Actor = { id: 'w', label: 'App backend' };
const idp: Actor = { id: 'i', label: 'IdP (OIDC)', detail: { title: 'Identity provider', text: 'Authenticates the user and issues an ID token (who) plus an access token (what the app may call).' } };
const apiA: Actor = { id: 'a', label: 'API' };
const oidc: SeqMsg[] = [
  { from: 'b', to: 'w', label: 'GET /login', note: 'The user clicks "Sign in with Google".' },
  { from: 'w', to: 'b', label: '302 → IdP + challenge', kind: 'resp', note: 'The app redirects to the IdP with a PKCE code challenge and a state value.' },
  { from: 'b', to: 'i', label: 'GET /authorize', note: 'The browser lands on the IdP.' },
  { from: 'i', to: 'i', label: 'password + MFA', kind: 'self', note: 'The user authenticates at the IdP; the app never sees the password.' },
  { from: 'i', to: 'b', label: '302 → app?code=…', kind: 'resp', note: 'The IdP redirects back with a one-time code, not a token.' },
  { from: 'b', to: 'w', label: 'GET /callback?code', note: 'The code reaches the app backend.' },
  { from: 'w', to: 'i', label: 'POST /token code+verifier', note: 'Server to server, the app swaps the code plus the PKCE verifier for tokens.' },
  { from: 'i', to: 'w', label: 'id_token + access + refresh', kind: 'resp', note: 'Tokens never passed through the URL bar.' },
  { from: 'w', to: 'b', label: 'Set-Cookie session (httpOnly)', kind: 'resp', note: 'The app sets its own httpOnly session cookie. Logged in.' },
];
const refresh: SeqMsg[] = [
  { from: 'w', to: 'a', label: 'GET /me Bearer (JWT)', note: 'Access tokens are short-lived JWTs, verified by signature with no lookup.' },
  { from: 'a', to: 'w', label: '200', kind: 'resp', note: 'Fast and stateless on the hot path.' },
  { from: 'w', to: 'a', label: 'GET /me (expired)', note: 'Fifteen minutes later the token has expired.' },
  { from: 'a', to: 'w', label: '401 expired', kind: 'fail', note: 'The API rejects it.' },
  { from: 'w', to: 'i', label: 'POST /token refresh', note: 'The app presents the long-lived refresh token.' },
  { from: 'i', to: 'i', label: 'check revocation', kind: 'self', note: 'Refresh tokens are checked against a database, so this is the revocation point.' },
  { from: 'i', to: 'w', label: 'new access + refresh', kind: 'resp', note: 'A new pair is issued and the old refresh token is retired.' },
  { from: 'w', to: 'a', label: 'retry GET /me', note: 'The call succeeds. A stolen access token stays valid until it expires, so keep it short.' },
];
sdDemo('sd-auth', 'sd-auth-seq', 'OIDC login & token refresh', 'Authorization code flow with PKCE hop by hop, then short-lived access tokens and refresh-time revocation.', {
  oidc: ['OIDC login', () => seqFrames({ actors: [browser, webapp, idp], msgs: oidc, intro: 'Signing in with an external identity provider.', panel: 'Auth' })],
  refresh: ['Refresh tokens', () => seqFrames({ actors: [webapp, idp, apiA], msgs: refresh, intro: 'JWTs are fast but not revocable, so they are kept short.', panel: 'Auth' })],
});

// ---------- architecture ----------
boardDemo('sd-arch', 'sd-arch-boundaries', 'Service boundaries', 'Modular monolith, the distributed monolith anti-pattern, and chattiness as the signal a boundary is wrong.', {
  modular: [
    'Modular monolith',
    {
      panel: 'One deploy',
      nodes: [
        N('orders', 30, 100, 290, 130, 'orders module', 'public API only'),
        N('billing', 355, 100, 290, 130, 'billing module'),
        N('ship', 680, 100, 290, 130, 'shipping module'),
        N('db', 355, 420, 290, 130, 'one database', 'tables owned per module'),
        N('lint', 30, 700, 940, 130, 'boundary test fails the build', 'no cross-module table access', { detail: { title: 'Enforced boundaries', text: 'A dependency rule in CI keeps modules honest, so extracting one later is moving a folder, not an untangling project.', code: '// dependency-cruiser\n{ from: { path: "^src/orders" },\n  to: { path: "^src/billing/internal" },\n  severity: "error" }' } }),
      ],
      edges: ['orders>billing', 'billing>ship', 'orders>db', 'billing>db', 'ship>db'],
      beats: [
        { note: 'One deploy, but modules talk only through each other’s public interfaces.', hot: { orders: 'current', billing: 'current', ship: 'current' }, hide: ['lint'] },
        { note: 'Calls are in-process: no network, no partial failure, one ACID transaction.', hot: { 'orders>billing': 'accent', 'billing>ship': 'accent' }, hide: ['lint'], rows: [['call cost', 'ns', 'ok']] },
        { note: 'Each module owns its tables and nobody else touches them.', hot: { db: 'current' }, hide: ['lint'] },
        { note: 'A build-time rule enforces it. Most of microservices’ maintainability, none of the distributed-systems tax.', hot: { lint: 'ok' }, rows: [['default for', 'new products', 'ok']] },
      ],
    },
  ],
  distmono: [
    'Distributed monolith',
    {
      panel: 'Anti-pattern',
      nodes: [
        N('a', 30, 100, 290, 130, 'orders svc'),
        N('b', 355, 100, 290, 130, 'billing svc'),
        N('c', 680, 100, 290, 130, 'shipping svc'),
        N('db', 355, 420, 290, 130, 'shared database', 'everyone’s tables', { detail: { title: 'Shared database', text: 'Services that share tables are coupled through the schema, whatever their repos say. Each service should own its data.' } }),
        N('dep', 30, 700, 940, 130, 'release train', 'all three deploy together'),
      ],
      edges: ['a>b', 'b>a', 'b>c', 'c>b', 'a>db', 'b>db', 'c>db'],
      beats: [
        { note: 'Three services, split out of the monolith.', hot: { a: 'current', b: 'current', c: 'current' }, hide: ['dep'] },
        { note: 'Every request bounces between them: 14 calls per checkout. The boundary cuts through one workflow.', hot: { 'a>b': 'warn', 'b>a': 'warn', 'b>c': 'warn', 'c>b': 'warn' }, hide: ['dep'], rows: [['calls / request', 14, 'warn']] },
        { note: 'They still share one database, so a schema change breaks all three.', hot: { db: 'fail' }, hide: ['dep'] },
        { note: 'So they deploy in lockstep. Microservices’ costs with none of the independence.', hot: { dep: 'fail' }, rows: [['independent deploys', 'none', 'fail']] },
      ],
    },
  ],
});
