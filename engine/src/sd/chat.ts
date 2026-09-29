// Live chat (group sd-chat): transports, message delivery through gateways, fan-out, catch-up, ordering and dedupe.
import { boardDemo, N } from '../machine/lib/board';
import type { Actor, SeqMsg } from './lib';
import { sdDemo, seqFrames } from './lib';

const G = 'sd-chat';

const client: Actor = { id: 'c', label: 'Client', sub: 'chat app', detail: { title: 'Chat client', text: 'Keeps the last message id it has seen per conversation, so it can ask for anything newer after a reconnect.', code: 'const ws = new WebSocket("wss://chat.example/ws");\nws.onmessage = e => render(JSON.parse(e.data));\nws.send(JSON.stringify({ id: uuid(), to: "room7", text }));' } };
const server: Actor = { id: 's', label: 'Chat server', detail: { title: 'Chat server', text: 'Holds the transport open (or answers polls). Capacity is concurrent connections, not requests per second.' } };

const poll: SeqMsg[] = [
  { from: 'c', to: 's', label: 'GET /msgs?since=41', note: 'Polling: every 5 s the client asks whether anything is new.' },
  { from: 's', to: 'c', label: '200 []', kind: 'resp', note: 'Usually nothing is. The request still cost a round trip and a server lookup.' },
  { from: 's', to: 's', label: 'msg 42 arrives', kind: 'self', note: 'A message lands on the server right after that poll.' },
  { from: 'c', to: 's', label: 'GET /msgs?since=41', note: 'The client only finds out at its next poll, up to 5 s later.', rows: [['added latency', '≤ 5 s', 'warn']] },
  { from: 's', to: 'c', label: '200 [msg 42]', kind: 'resp', note: 'Delivered, late. Polling trades latency against wasted requests and wins neither.' },
];
const longPoll: SeqMsg[] = [
  { from: 'c', to: 's', label: 'GET /msgs?since=41', note: 'Long polling: the client asks, and the server does not answer yet.' },
  { from: 's', to: 's', label: 'hold up to 30 s', kind: 'self', note: 'The server parks the request until there is something to say or it times out.', rows: [['open requests', '1 per user', 'warn']] },
  { from: 's', to: 's', label: 'msg 42 arrives', kind: 'self', note: 'A message arrives while the request is parked.' },
  { from: 's', to: 'c', label: '200 [msg 42]', kind: 'resp', note: 'It goes out immediately on the held request. Latency is one network trip.' },
  { from: 'c', to: 's', label: 'GET /msgs?since=42', note: 'The client re-asks at once, so there is almost always a request parked.' },
];
const ws: SeqMsg[] = [
  { from: 'c', to: 's', label: 'GET /ws Upgrade', note: 'WebSocket starts as an ordinary HTTP request asking to upgrade the connection.' },
  { from: 's', to: 'c', label: '101 Switching', kind: 'resp', note: 'The server agrees; from here the same TCP connection carries frames both ways.' },
  { from: 's', to: 'c', label: 'frame: msg 42', kind: 'async', note: 'The server pushes a message the moment it has one. No request needed.' },
  { from: 'c', to: 's', label: 'frame: send c-17', note: 'The client sends over the same socket, with a tiny frame header instead of HTTP headers.' },
  { from: 'c', to: 's', label: 'ping', note: 'Idle connections exchange pings so proxies and NATs keep them open.' },
  { from: 's', to: 'c', label: 'pong', kind: 'resp', note: 'The cost moves to holding many idle sockets, so size for concurrent connections.' },
];
const sse: SeqMsg[] = [
  { from: 'c', to: 's', label: 'GET /events', note: 'Server-Sent Events: one long HTTP response that the server keeps writing to.' },
  { from: 's', to: 'c', label: '200 event-stream', kind: 'resp', note: 'Headers go out and the response stays open. It works over plain HTTP/2.' },
  { from: 's', to: 'c', label: 'event: msg 42', kind: 'async', note: 'Each new message is one more event line on that response.' },
  { from: 'c', to: 's', label: 'POST /msgs c-17', note: 'SSE is one-way, so the client sends with an ordinary POST.' },
  { from: 's', to: 'c', label: '201 Created', kind: 'resp', note: 'Fine when the client rarely pushes. For chatty two-way traffic use WebSocket.' },
];

sdDemo(G, 'sd-chat-transport', 'Chat transports', 'Polling, long polling, WebSocket and SSE, message by message.', {
  poll: ['Polling', () => seqFrames({ actors: [client, server], msgs: poll, intro: 'The same message delivered four ways. First, plain polling.', panel: 'Transport' })],
  longpoll: ['Long polling', () => seqFrames({ actors: [client, server], msgs: longPoll, intro: 'Long polling keeps a request waiting at the server.', panel: 'Transport' })],
  websocket: ['WebSocket', () => seqFrames({ actors: [client, server], msgs: ws, intro: 'WebSocket upgrades one HTTP connection into a two-way channel.', panel: 'Transport' })],
  sse: ['SSE', () => seqFrames({ actors: [client, server], msgs: sse, intro: 'SSE streams server-to-client over plain HTTP.', panel: 'Transport' })],
});

// ---------- delivery through gateways ----------
const alice: Actor = { id: 'a', label: 'Alice' };
const gwA: Actor = { id: 'ga', label: 'Gateway A', detail: { title: 'Gateway (connection layer)', text: 'Stateful servers that hold the open WebSockets. A user is pinned to one gateway while connected, so delivery has to find that gateway.', code: 'on connect(user):\n  redis.set(f"presence:{user}", GW_ID, ex=60)\non heartbeat(user):\n  redis.expire(f"presence:{user}", 60)' } };
const chat: Actor = { id: 'ch', label: 'Chat svc', detail: { title: 'Chat service', text: 'Assigns a per-conversation sequence number, writes the message durably, then hands it to the real-time path.' } };
const db: Actor = { id: 'db', label: 'DB', detail: { title: 'Message store', text: 'Durable history, independent of the real-time path. Catch-up after a reconnect reads from here.', code: 'INSERT INTO messages (conv_id, seq, client_id, body)\nVALUES (7, 42, \'c-17\', \'hi\')\nON CONFLICT (conv_id, client_id) DO NOTHING;' } };
const presence: Actor = { id: 'pr', label: 'Presence', sub: 'Redis', detail: { title: 'Presence registry', text: 'Ephemeral user → gateway map with a TTL. A few seconds stale is fine; it is never the source of truth.', code: 'GET presence:bob\n"gw-b"\nTTL presence:bob\n(integer) 43' } };
const pubsub: Actor = { id: 'ps', label: 'Pub/Sub', detail: { title: 'Fan-out layer', text: 'Gateways subscribe to the rooms their connected users are in. One publish reaches every gateway with a member online.', code: 'SUBSCRIBE room:7      # gateway B, C\nPUBLISH room:7 "{seq:42,...}"\n(integer) 2' } };
const gwB: Actor = { id: 'gb', label: 'Gateway B' };
const gwC: Actor = { id: 'gc', label: 'Gateway C' };
const bob: Actor = { id: 'b', label: 'Bob' };

const dm: SeqMsg[] = [
  { from: 'a', to: 'ga', label: 'send c-17', note: 'Alice sends a frame to the gateway her socket is on, with an id her app generated.' },
  { from: 'ga', to: 'ch', label: 'SendMessage', note: 'The gateway passes it to the chat service.' },
  { from: 'ch', to: 'db', label: 'INSERT seq 42', note: 'The chat service assigns the next sequence number for this conversation and stores it durably first.' },
  { from: 'db', to: 'ch', label: 'ok', kind: 'resp', note: 'History is safe before anyone is notified, so a dropped socket never loses the message.' },
  { from: 'ch', to: 'pr', label: 'where is Bob?', note: 'To push it live, the service asks the presence registry which gateway holds Bob.' },
  { from: 'pr', to: 'ch', label: 'gateway B', kind: 'resp', note: 'Bob is connected to gateway B.' },
  { from: 'ch', to: 'gb', label: 'deliver 42', note: 'The message is routed to exactly that gateway.' },
  { from: 'gb', to: 'b', label: 'frame msg 42', kind: 'async', note: 'Gateway B pushes it down Bob’s open socket.' },
  { from: 'b', to: 'gb', label: 'ack 42', note: 'Bob’s app acks, which becomes the delivery receipt.' },
  { from: 'gb', to: 'ch', label: 'delivered 42', note: 'The receipt travels back through the service.' },
  { from: 'ch', to: 'ga', label: 'receipt 42', note: 'The service routes the receipt to Alice’s gateway.' },
  { from: 'ga', to: 'a', label: '✓✓ delivered', kind: 'resp', note: 'Alice sees two ticks. Every hop here is a separate message that can fail.' },
];
const group: SeqMsg[] = [
  { from: 'a', to: 'ga', label: 'send c-18 room 7', note: 'Alice posts to a room with members on several gateways.' },
  { from: 'ga', to: 'ch', label: 'SendMessage', note: 'Same entry path as a direct message.' },
  { from: 'ch', to: 'db', label: 'INSERT seq 43', note: 'Stored durably with the room’s next sequence number.' },
  { from: 'db', to: 'ch', label: 'ok', kind: 'resp', note: 'Now it is safe to fan out.' },
  { from: 'ch', to: 'ps', label: 'PUBLISH room:7', note: 'One publish, instead of one send per member.' },
  { from: 'ps', to: 'gb', label: 'msg 43', kind: 'async', note: 'Every gateway subscribed to room 7 gets a copy.' },
  { from: 'ps', to: 'gc', label: 'msg 43', kind: 'async', note: 'Gateway C too, because another member is connected there.' },
  { from: 'gb', to: 'gb', label: 'push to local members', kind: 'self', note: 'Each gateway pushes to its own local members of the room.' },
  { from: 'ga', to: 'a', label: 'sent ✓', kind: 'resp', note: 'Fan-out cost grows with members online. A 100k-member channel needs batching or a separate broadcast path.' },
];
const reconnect: SeqMsg[] = [
  { from: 'ch', to: 'pr', label: 'where is Bob?', note: 'A message for Bob is stored as usual, then the service looks him up.' },
  { from: 'pr', to: 'ch', label: '(no entry)', kind: 'resp', note: 'His presence key expired: his phone went into a tunnel. Nothing to push to.' },
  { from: 'b', to: 'gb', label: 'connect last=41', note: 'Later Bob reconnects, possibly to a different gateway, and says the last seq he has.' },
  { from: 'gb', to: 'pr', label: 'SET bob=gw-b', note: 'His presence is registered again with a fresh TTL.' },
  { from: 'gb', to: 'ch', label: 'fetch since 41', note: 'The catch-up path: ask for everything newer than 41.' },
  { from: 'ch', to: 'db', label: 'SELECT seq > 41', note: 'History comes from the durable store, not the real-time path.' },
  { from: 'db', to: 'ch', label: '42, 43', kind: 'resp', note: 'Two messages were missed while he was away.' },
  { from: 'ch', to: 'gb', label: '42, 43', kind: 'resp', note: 'Returned in sequence order.' },
  { from: 'gb', to: 'b', label: 'frames 42, 43', kind: 'resp', note: 'Bob is caught up. Design this recovery path together with the live path, never after.' },
];

sdDemo(G, 'sd-chat-delivery', 'Chat delivery', 'Gateways, presence and pub/sub: every hop of a message, a receipt and a reconnect catch-up.', {
  dm: ['Direct message', () => seqFrames({ actors: [alice, gwA, chat, db, presence, gwB, bob], msgs: dm, intro: 'Alice and Bob are connected to different gateways. Follow one message and its receipt.', panel: 'Delivery' })],
  group: ['Group fan-out', () => seqFrames({ actors: [alice, gwA, chat, db, pubsub, gwB, gwC], msgs: group, intro: 'A room with members on several gateways.', panel: 'Delivery' })],
  reconnect: ['Offline & catch-up', () => seqFrames({ actors: [chat, db, presence, gwB, bob], msgs: reconnect, intro: 'Bob is offline when a message arrives.', panel: 'Delivery' })],
});

// ---------- ordering & dedupe ----------
const retry: SeqMsg[] = [
  { from: 'a', to: 'ch', label: 'send c-17 "hi"', note: 'Alice sends with a client-generated id.' },
  { from: 'ch', to: 'db', label: 'INSERT c-17 seq 42', note: 'Stored, but the ack back to Alice is lost on a flaky network.' },
  { from: 'ch', to: 'a', label: 'ack (lost)', kind: 'fail', note: 'Alice never hears back and her app retries.' },
  { from: 'a', to: 'ch', label: 'send c-17 "hi"', note: 'Same id, second attempt: at-least-once delivery at work.' },
  { from: 'ch', to: 'db', label: 'INSERT c-17 → conflict', note: 'A unique key on (conversation, client id) rejects the duplicate atomically.' },
  { from: 'ch', to: 'a', label: 'ack seq 42', kind: 'resp', note: 'The service answers with the original seq. Nobody sees "hi" twice.' },
];
const order: SeqMsg[] = [
  { from: 'ch', to: 'b', label: 'msg 43', kind: 'async', note: 'Message 43 overtakes 42 on another path and arrives first.' },
  { from: 'b', to: 'b', label: 'gap: have 41, got 43', kind: 'self', note: 'Bob’s app knows seq 42 is missing because numbers are per conversation.' },
  { from: 'ch', to: 'b', label: 'msg 42', kind: 'async', note: 'Message 42 arrives a moment later.' },
  { from: 'b', to: 'b', label: 'render 42, 43', kind: 'self', note: 'Now the gap is filled, so both show in order.' },
  { from: 'b', to: 'ch', label: 'fetch 42 (if slow)', note: 'If the gap persists, the client fetches it instead of waiting forever. No global order is needed.' },
];
sdDemo(G, 'sd-chat-order', 'Ordering & duplicates', 'Per-conversation sequence numbers and client ids make at-least-once delivery look exactly-once.', {
  dedupe: ['Retry dedupe', () => seqFrames({ actors: [alice, chat, db], msgs: retry, intro: 'Networks drop acks, so clients retry. Watch the same message sent twice.', panel: 'Guarantees' })],
  order: ['Out of order', () => seqFrames({ actors: [chat, bob], msgs: order, intro: 'Two messages take different paths and swap places.', panel: 'Guarantees' })],
});

// ---------- architecture ----------
boardDemo(G, 'sd-chat-arch', 'Chat architecture', 'Connection layer, presence, fan-out and durable history, and what changes for huge channels.', {
  arch: [
    'Components',
    {
      panel: 'Chat',
      nodes: [
        N('users', 355, 30, 290, 100, 'users', '1M sockets'),
        N('lb', 355, 190, 290, 100, 'L4 load balancer', 'sticky TCP'),
        N('gw', 355, 350, 290, 110, 'gateways ×40', '25k conns each'),
        N('pr', 30, 540, 290, 110, 'presence', 'Redis + TTL', { detail: presence.detail }),
        N('svc', 355, 540, 290, 110, 'chat service', 'stateless'),
        N('ps', 680, 540, 290, 110, 'pub/sub', 'per room', { detail: pubsub.detail }),
        N('db', 355, 730, 290, 110, 'message store', 'by conversation', { detail: db.detail }),
      ],
      edges: ['users>lb', 'lb>gw', 'gw>svc', 'svc>pr', 'svc>ps', 'svc>db'],
      beats: [
        { note: 'Users hold sockets open through an L4 balancer to the gateway fleet.', hot: { users: 'current', lb: 'current', gw: 'current' }, rows: [['sized by', 'open connections']] },
        { note: 'Gateways are stateful: each owns its sockets. The chat service behind them stays stateless.', hot: { gw: 'write', svc: 'current' }, rows: [['stateful', 'gateways only']] },
        { note: 'Presence maps user → gateway in memory with a TTL, refreshed by heartbeats.', hot: { pr: 'current', 'svc>pr': 'accent' }, rows: [['staleness', 'seconds, OK']] },
        { note: 'Pub/sub fans a room’s messages out to the gateways that have members online.', hot: { ps: 'current', 'svc>ps': 'accent' }, rows: [['fan-out', 'per gateway']] },
        { note: 'The message store is the durable history and the catch-up source. The real-time path is best effort on top.', hot: { db: 'ok', 'svc>db': 'accent' }, rows: [['source of truth', 'message store', 'ok']] },
      ],
    },
  ],
  bigroom: [
    'Huge channels',
    {
      panel: 'Chat',
      nodes: [
        N('src', 355, 40, 290, 110, 'streamer chat', '3k msg/s'),
        N('svc', 355, 230, 290, 110, 'chat service'),
        N('agg', 355, 420, 290, 110, 'batcher', '1 batch / 250 ms', { detail: { title: 'Batch and sample', text: 'Collect a room’s messages for a short window and send one batch; in very busy rooms, keep a sample.', code: 'every 250ms:\n  batch = room.drain(max=50)\n  broadcast(room.id, batch)' } }),
        N('edge', 355, 610, 290, 110, 'broadcast tier', 'CDN-like'),
        N('view', 355, 800, 290, 110, '200k viewers'),
      ],
      edges: ['src>svc', 'svc>agg', 'agg>edge', 'edge>view'],
      beats: [
        { note: 'A live-stream channel has 200k members and thousands of messages a second.', hot: { src: 'warn', view: 'warn' }, rows: [['naive pushes', '600M / s', 'fail']] },
        { note: 'Per-member fan-out cannot keep up, so messages are batched every 250 ms.', hot: { agg: 'current' }, rows: [['pushes', '4 batches / s × viewers']] },
        { note: 'Busy rooms also sample: viewers see a representative subset, not every line.', hot: { agg: 'write' }, rows: [['shown', '~50 msg/s']] },
        { note: 'A broadcast tier sends the same batch to everyone, like a CDN for messages. Small chats keep the per-user path.', hot: { edge: 'ok', view: 'ok' }, rows: [['design', 'split by group size', 'ok']] },
      ],
    },
  ],
});
