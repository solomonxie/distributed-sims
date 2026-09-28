// Application protocols (groups net-dns, net-http, net-tls): DNS resolution & records, HTTP/1.1 → 2 → 3, gRPC, real-time, TLS 1.3 & certificates.
import type { Detail, Frame } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { boardFrames, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { laneFrames } from './lib';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });

// ---------------- DNS ----------------
const DNSL = [
  d('Stub resolver', 'The tiny resolver in your OS or libc. It asks one recursive resolver and caches briefly.', '$ cat /etc/resolv.conf\nnameserver 10.0.0.2\n$ resolvectl query api.example.com'),
  d('Recursive resolver', 'Your ISP\'s, 8.8.8.8, 1.1.1.1 or the cloud VPC resolver. Walks the hierarchy on a miss and caches every answer for its TTL.', '$ dig @1.1.1.1 api.example.com'),
  d('Root & TLD servers', '13 root server names (hundreds of anycast instances) point to TLD servers like .com, which point to the domain\'s name servers.', '$ dig +trace api.example.com\n.            IN NS a.root-servers.net.\ncom.         IN NS a.gtld-servers.net.\nexample.com. IN NS ns1.example.com.'),
  d('Authoritative server', 'Holds the zone for example.com and gives the final answer. Route 53, Cloudflare DNS or your own BIND.', 'api.example.com. 60 IN A 93.184.216.34'),
];

const dnsLanes = (cached: boolean): Frame[] =>
  laneFrames({
    lanes: ['app', 'recursive', 'root / .com', 'authoritative'],
    subs: ['stub resolver', '1.1.1.1', 'hierarchy', 'ns1.example.com'],
    laneDetails: DNSL,
    panel: 'DNS',
    intro: cached ? 'Second lookup of the same name a few seconds later.' : 'The app asks for api.example.com. Nothing is cached anywhere yet.',
    rows: [['cache', cached ? 'warm' : 'cold']],
    msgs: cached
      ? [
          { from: 0, to: 1, label: 'A api.example.com?', note: 'The stub asks the recursive resolver.' },
          { from: 1, to: 1, label: 'cache hit (TTL 42 s left)', note: 'The resolver still has the answer cached, with 42 seconds of its TTL left.', tone: 'ok', rows: [['TTL left', '42 s']] },
          { from: 1, to: 0, label: '93.184.216.34', note: 'Answered in about 1 ms, with no walk up the hierarchy.', tone: 'ok', rows: [['latency', '~1 ms', 'ok']] },
        ]
      : [
          { from: 0, to: 1, label: 'A api.example.com?', note: 'The stub resolver asks the recursive resolver, which will do all the work.' },
          { from: 1, to: 2, label: 'api.example.com?', note: 'The resolver starts at the root, which only knows who runs .com.' },
          { from: 2, to: 1, label: 'NS a.gtld-servers.net', note: 'A referral: ask the .com servers. In reality this is cached for days.', detail: d('Referral', 'Not an answer, a pointer to servers that know more. Root and TLD referrals have long TTLs (days).') },
          { from: 1, to: 2, label: 'api.example.com? (.com)', note: 'The .com TLD server knows which name servers host example.com.' },
          { from: 2, to: 1, label: 'NS ns1.example.com', note: 'Another referral, to the domain\'s authoritative servers.' },
          { from: 1, to: 3, label: 'A api.example.com?', note: 'Finally the authoritative server is asked.' },
          { from: 3, to: 1, label: 'A 93.184.216.34 TTL 60', note: 'It answers with the address and a TTL of 60 seconds.', tone: 'ok', detail: DNSL[3], rows: [['TTL', '60 s']] },
          { from: 1, to: 0, label: '93.184.216.34', note: 'The resolver caches it for 60 s and returns it to the app.', tone: 'ok', rows: [['latency', '~80 ms'], ['cached for', '60 s']] },
        ],
    outro: cached ? 'Most lookups are cache hits. The TTL decides how fast a change, like a failover, reaches clients.' : 'A cold lookup costs several round trips. Every level caches, so it rarely happens in full.',
  });

const REC = (type: string, value: string, text: string, code: string) => d(`${type} record`, text, code);
const recordsBoard: Board = {
  panel: 'Records',
  nodes: [
    N('a', 40, 60, 440, 120, 'A / AAAA', 'name → IPv4 / IPv6', { detail: REC('A', '', 'Maps a name to an IPv4 (A) or IPv6 (AAAA) address. Several records mean simple round-robin.', '$ dig +short example.com A\n93.184.216.34\n$ dig +short example.com AAAA\n2606:2800:220:1:248:1893:25c8:1946') }),
    N('cname', 520, 60, 440, 120, 'CNAME', 'alias → another name', { detail: REC('CNAME', '', 'An alias. The resolver restarts the lookup with the target. Not allowed at the zone apex (example.com itself).', 'www.example.com. 300 IN CNAME example.cdn.net.') }),
    N('mx', 40, 230, 440, 120, 'MX', 'mail servers + priority', { detail: REC('MX', '', 'Where email for the domain goes; lowest preference number wins.', '$ dig +short gmail.com MX\n5 gmail-smtp-in.l.google.com.') }),
    N('txt', 520, 230, 440, 120, 'TXT', 'SPF, DKIM, verification', { detail: REC('TXT', '', 'Free text. Used for SPF/DKIM/DMARC email policies and domain-ownership proofs.', 'example.com. TXT "v=spf1 include:_spf.google.com ~all"') }),
    N('ns', 40, 400, 440, 120, 'NS', 'who is authoritative', { detail: REC('NS', '', 'Delegates a zone to name servers. Changing DNS provider means changing these at the registrar.', '$ dig +short example.com NS\na.iana-servers.net.') }),
    N('srv', 520, 400, 440, 120, 'SRV', 'service → host:port', { detail: REC('SRV', '', 'Service discovery: priority, weight, port and target. Used by Kubernetes headless services, SIP, XMPP.', '_grpc._tcp.api.svc. SRV 10 50 8443 pod-1.api.svc.') }),
    N('ptr', 40, 570, 440, 120, 'PTR', 'IP → name (reverse)', { detail: REC('PTR', '', 'Reverse lookup under in-addr.arpa. Mail servers check it.', '$ dig -x 8.8.8.8 +short\ndns.google.') }),
    N('caa', 520, 570, 440, 120, 'CAA', 'which CAs may issue', { detail: REC('CAA', '', 'Restricts which certificate authorities may issue certificates for the domain.', 'example.com. CAA 0 issue "letsencrypt.org"') }),
    N('dig', 40, 760, 920, 190, '$ dig api.example.com', 'ANSWER: api.example.com. 60 IN A 93.184.216.34', { detail: d('Reading dig', 'The answer section shows name, TTL (seconds left in the cache), class IN, type and value. "Query time" tells you if it was cached.', '$ dig api.example.com\n;; ANSWER SECTION:\napi.example.com. 60 IN A 93.184.216.34\n;; Query time: 23 msec\n;; SERVER: 1.1.1.1#53') }),
  ],
  edges: [],
  beats: [
    { note: 'DNS is a distributed key-value store. The key is a name plus a record type.', hot: { a: 'current' }, rows: [['key', 'name + type']] },
    { note: 'A and AAAA give addresses; CNAME points to another name, which is how CDNs take over a hostname.', hot: { a: 'current', cname: 'current' }, rows: [['CNAME at apex', 'not allowed', 'warn']] },
    { note: 'MX, TXT and CAA hold policy: mail routing, SPF and DKIM, allowed certificate issuers.', hot: { mx: 'current', txt: 'current', caa: 'current' } },
    { note: 'NS delegates zones; SRV gives host and port for service discovery; PTR maps IPs back to names.', hot: { ns: 'current', srv: 'current', ptr: 'current' } },
    { note: 'dig shows the answer with its remaining TTL. Tap it for how to read the output.', hot: { dig: 'ok' }, rows: [['tool', 'dig / nslookup']] },
  ],
};

const ttlBoard: Board = {
  panel: 'TTL & failover',
  nodes: [
    N('rec', 330, 60, 340, 120, 'api → 1.2.3.4', 'TTL 3600', { detail: d('TTL', 'How long resolvers may cache the answer. Long TTLs mean fewer lookups but slow changes.', '$ dig +noall +answer api.example.com\napi.example.com. 3217 IN A 1.2.3.4\n# 3217 s left in this resolver\'s cache') }),
    N('p', 40, 300, 280, 130, 'primary', '1.2.3.4'),
    N('s', 680, 300, 280, 130, 'standby', '5.6.7.8'),
    N('c1', 40, 560, 280, 120, 'clients (ISP A)', 'cached 1.2.3.4'),
    N('c2', 360, 560, 280, 120, 'clients (ISP B)', 'cached 1.2.3.4'),
    N('c3', 680, 560, 280, 120, 'JVM app', 'caches forever?'),
    N('neg', 40, 780, 920, 150, 'negative caching', 'NXDOMAIN cached for the SOA minimum'),
  ],
  edges: ['rec>p', 'c1>p', 'c2>p', 'c3>p'],
  beats: [
    { note: 'The record points at the primary with a one-hour TTL.', hot: { rec: 'current', p: 'ok' }, hide: ['neg'], rows: [['TTL', '3600 s']] },
    { note: 'The primary dies and you update DNS to the standby. Resolvers that cached the old answer keep using it.', hot: { p: 'fail', s: 'ok', c1: 'fail', c2: 'fail' }, label: { rec: 'api → 5.6.7.8' }, hide: ['neg'], rows: [['outage', 'up to 60 min', 'fail']] },
    { note: 'Some clients cache longer than the TTL: old JVMs cache forever by default, connection pools never re-resolve.', hot: { c3: 'fail' }, label: { rec: 'api → 5.6.7.8' }, hide: ['neg'], rows: [['JVM', 'networkaddress.cache.ttl']] },
    { note: 'Lower the TTL to 60 s a day before a planned move. For fast failover use health-checked DNS or an anycast/LB IP that never changes.', hot: { rec: 'ok', s: 'ok' }, label: { rec: 'api → 5.6.7.8' }, sub: { rec: 'TTL 60' }, hide: ['neg'], rows: [['TTL', '60 s', 'ok']] },
    { note: 'Failures are cached too. A lookup before a record exists can be answered NXDOMAIN from cache for a while.', hot: { neg: 'warn' }, label: { rec: 'api → 5.6.7.8' }, rows: [['NXDOMAIN', 'cached', 'warn']] },
  ],
};

const anycastBoard: Board = {
  panel: 'Anycast',
  nodes: [
    N('ip', 330, 50, 340, 120, '1.1.1.1', 'one IP, many sites', { detail: d('Anycast', 'The same IP prefix is announced over BGP from many locations. Routers send each packet to the topologically nearest one.', '$ traceroute 1.1.1.1   # from Tokyo\n…  3 hops, 2 ms: the Tokyo PoP') }),
    N('fra', 40, 300, 280, 130, 'Frankfurt PoP', 'announces 1.1.1.0/24'),
    N('tyo', 360, 300, 280, 130, 'Tokyo PoP', 'announces 1.1.1.0/24'),
    N('sfo', 680, 300, 280, 130, 'San Jose PoP', 'announces 1.1.1.0/24'),
    N('u1', 40, 560, 280, 120, 'user in Berlin'),
    N('u2', 360, 560, 280, 120, 'user in Osaka'),
    N('u3', 680, 560, 280, 120, 'user in LA'),
    N('why', 40, 760, 920, 170, 'used by', 'root DNS, 8.8.8.8, CDNs, DDoS scrubbing'),
  ],
  edges: ['u1>fra', 'u2>tyo', 'u3>sfo'],
  beats: [
    { note: 'Anycast announces the same IP from many sites.', hot: { ip: 'current', fra: 'read', tyo: 'read', sfo: 'read' }, hide: ['why'] },
    { note: 'BGP routes each user to the nearest site. No DNS tricks, no client logic.', hot: { 'u1>fra': 'accent', 'u2>tyo': 'accent', 'u3>sfo': 'accent' }, hide: ['why'], rows: [['latency', 'nearest PoP', 'ok']] },
    { note: 'If Tokyo withdraws its route, Osaka traffic shifts to the next nearest site within seconds.', hot: { tyo: 'fail', u2: 'warn' }, hide: ['why'], rows: [['failover', 'BGP withdraw']] },
    { note: 'It suits short, stateless exchanges like DNS; long TCP flows risk breaking if routes change mid-connection.', hot: { why: 'current' }, rows: [['best for', 'UDP, short TCP']] },
  ],
};

machineDemo({
  slug: 'nw-dns',
  title: 'DNS',
  group: 'net-dns',
  summary: 'Recursive resolution through root, TLD and authoritative servers, caching, record types, TTL and failover, anycast.',
  inputs: [
    { id: 'recursive', label: 'Cold lookup', data: { k: 'recursive' } },
    { id: 'cached', label: 'Cache hit', data: { k: 'cached' } },
    { id: 'records', label: 'Record types', data: { k: 'records' } },
    { id: 'ttl', label: 'TTL & failover', data: { k: 'ttl' } },
    { id: 'anycast', label: 'Anycast', data: { k: 'anycast' } },
  ],
  build: ({ k }: { k: string }) => (k === 'recursive' ? dnsLanes(false) : k === 'cached' ? dnsLanes(true) : boardFrames({ records: recordsBoard, ttl: ttlBoard, anycast: anycastBoard }[k]!)),
});

// ---------------- HTTP ----------------
const REQ = d('HTTP/1.1 request', 'Plain text: method, path, version, headers, blank line, optional body.', 'GET /api/users/42 HTTP/1.1\nHost: api.example.com\nAccept: application/json\nConnection: keep-alive\n');
const RES = d('HTTP/1.1 response', 'Status line, headers, blank line, body. Content-Length or chunked encoding tells the client where the body ends.', 'HTTP/1.1 200 OK\nContent-Type: application/json\nContent-Length: 27\n\n{"id":42,"name":"Ada"}');

const http: Record<string, () => Frame[]> = {
  h1: () =>
    laneFrames({
      lanes: ['browser', 'server'],
      panel: 'HTTP/1.1',
      intro: 'HTTP/1.1 sends one request at a time per connection, in text.',
      msgs: [
        { from: 0, to: 1, label: 'GET /index.html', note: 'The browser requests the page.', detail: REQ },
        { from: 1, to: 0, label: '200 OK (html)', note: 'Response on the same connection, kept alive for reuse.', detail: RES },
        { from: 0, to: 1, label: 'GET /app.js', note: 'The next request must wait until the previous response is fully received.' },
        { from: 1, to: 0, label: '200 OK (slow js)', note: 'A slow response blocks everything queued behind it on this connection.', tone: 'warn', rows: [['blocked requests', 'all behind it', 'warn']] },
        { from: 0, to: 0, label: 'open 6 connections', note: 'Browsers work around this with up to 6 parallel connections per host, each paying its own handshakes.', tone: 'warn', rows: [['connections', 6]] },
      ],
      outro: 'Pipelining was specified but never worked in practice. HTTP/2 solves this properly.',
    }),
  h2: () =>
    laneFrames({
      lanes: ['browser', 'server'],
      panel: 'HTTP/2',
      intro: 'HTTP/2 multiplexes many requests as streams over one TCP connection, in binary frames.',
      msgs: [
        { from: 0, to: 1, label: 'HEADERS s1 (html)', note: 'Each request is a stream with an id. Headers are compressed with HPACK.', detail: d('HPACK', 'Header compression with a shared table: repeated headers like cookies and user-agent shrink to a byte or two.') },
        { from: 0, to: 1, label: 'HEADERS s3 (js) s5 (css)', note: 'More requests go out immediately without waiting.' },
        { from: 1, to: 0, label: 'DATA s3', note: 'Responses come back as interleaved frames in any order.', tone: 'ok' },
        { from: 1, to: 0, label: 'DATA s1', note: 'A slow stream no longer blocks the fast ones at the HTTP level.', tone: 'ok' },
        { from: 1, to: 0, label: 'DATA s5 (END_STREAM)', note: 'Everything completes over one connection with one handshake.', tone: 'ok', rows: [['connections', 1, 'ok']] },
      ],
      outro: 'But it is still one TCP stream underneath, so a lost packet stalls every stream. HTTP/3 moves to QUIC for that reason.',
    }),
  grpc: () =>
    laneFrames({
      lanes: ['client stub', 'server'],
      panel: 'gRPC',
      intro: 'gRPC is RPC over HTTP/2 with Protocol Buffers as the payload.',
      msgs: [
        { from: 0, to: 1, label: 'POST /users.Users/Get', note: 'A unary call is an HTTP/2 POST to /package.Service/Method.', detail: d('Protobuf contract', 'The .proto file is the API. Code generators build typed client stubs and server interfaces in every language.', 'service Users {\n  rpc Get(GetReq) returns (User);\n  rpc Watch(WatchReq) returns (stream Event);\n}\nmessage GetReq { int64 id = 1; }') },
        { from: 1, to: 0, label: 'User{id:42} + grpc-status 0', note: 'The response is a binary protobuf, with status in HTTP/2 trailers.', tone: 'ok' },
        { from: 0, to: 1, label: 'Watch (server stream)', note: 'Streaming calls keep the HTTP/2 stream open.' },
        { from: 1, to: 0, label: 'Event, Event, Event …', note: 'The server pushes messages as they happen, on one stream.', tone: 'ok' },
        { from: 0, to: 1, label: 'deadline 200 ms', note: 'Deadlines propagate across services, so a slow backend fails fast instead of piling up.', tone: 'warn', detail: d('Deadlines', 'The client sets grpc-timeout; each hop passes the remaining budget on. Always set one.') },
      ],
      outro: 'gRPC suits service-to-service calls; browsers need gRPC-Web or plain JSON over HTTP. HTTP/2 connections to one backend also need L7 load balancing.',
    }),
  h3: () =>
    laneFrames({
      lanes: ['browser', 'server'],
      panel: 'HTTP/3',
      intro: 'HTTP/3 is HTTP/2\'s model on top of QUIC instead of TCP.',
      msgs: [
        { from: 1, to: 0, label: 'Alt-Svc: h3=":443"', note: 'The first visit uses HTTP/2; the server advertises HTTP/3 in a header.', detail: d('Alt-Svc', 'Tells the browser the same origin is reachable over HTTP/3 on UDP 443. It tries QUIC next time and falls back to TCP if UDP is blocked.', 'alt-svc: h3=":443"; ma=86400') },
        { from: 0, to: 1, label: 'QUIC Initial + GET', note: 'Next time it connects with QUIC: one round trip, or zero when resuming.' },
        { from: 1, to: 0, label: 'stream 0: css (lost)', note: 'A lost packet affects only its own stream.', lost: true },
        { from: 1, to: 0, label: 'stream 4: js', note: 'Other streams keep flowing.', tone: 'ok' },
        { from: 1, to: 0, label: 'stream 0 resent', note: 'Only the css waited for recovery.', tone: 'ok', rows: [['HOL blocking', 'per stream', 'ok']] },
      ],
      outro: 'Some networks block UDP, so clients always keep TCP as a fallback.',
    }),
};

const realtime: Record<string, () => Frame[]> = {
  polling: () =>
    laneFrames({
      lanes: ['client', 'server'],
      panel: 'Short polling',
      intro: 'The client asks "anything new?" on a timer.',
      msgs: [
        { from: 0, to: 1, label: 'GET /events', note: 'Poll.' },
        { from: 1, to: 0, label: '204 nothing', note: 'Nothing new: a wasted round trip.', tone: 'warn' },
        { from: 0, to: 1, label: 'GET /events (5 s later)', note: 'Poll again after the interval.', gap: 1 },
        { from: 1, to: 0, label: '200 [msg]', note: 'An event that happened 4.9 s ago is finally delivered.', tone: 'warn', rows: [['latency', 'up to 5 s', 'warn']] },
      ],
      outro: 'Simple and cache-friendly, but slow or wasteful. Fine for dashboards refreshing every minute.',
    }),
  longpoll: () =>
    laneFrames({
      lanes: ['client', 'server'],
      panel: 'Long polling',
      intro: 'The server holds the request open until there is something to say.',
      msgs: [
        { from: 0, to: 1, label: 'GET /events?since=41', note: 'The client asks, and the server doesn\'t answer yet.' },
        { from: 1, to: 1, label: 'hold up to 30 s', note: 'The request parks on the server.', tone: 'warn', gap: 1 },
        { from: 1, to: 0, label: '200 [msg 42]', note: 'An event arrives and is sent immediately.', tone: 'ok', rows: [['latency', '~0', 'ok']] },
        { from: 0, to: 1, label: 'GET /events?since=42', note: 'The client immediately re-requests.' },
      ],
      outro: 'Near real time over plain HTTP, but each message costs a request and the server holds many idle connections.',
    }),
  sse: () =>
    laneFrames({
      lanes: ['client', 'server'],
      panel: 'Server-Sent Events',
      intro: 'SSE keeps one HTTP response open and streams text events down it.',
      msgs: [
        { from: 0, to: 1, label: 'GET /stream', note: 'Accept: text/event-stream.', detail: d('SSE', 'One-way server → client over plain HTTP. The browser EventSource reconnects automatically and resends Last-Event-ID.', 'const es = new EventSource("/stream");\nes.onmessage = (e) => render(JSON.parse(e.data));\n\n// server writes:\n// id: 42\n// data: {"price": 101.5}\n') },
        { from: 1, to: 0, label: 'data: {...} id: 42', note: 'Events flow as they happen.', tone: 'ok' },
        { from: 1, to: 0, label: 'data: {...} id: 43', note: 'Same response, next event.', tone: 'ok' },
        { from: 0, to: 1, label: 'reconnect, Last-Event-ID: 43', note: 'After a drop, the browser resumes where it left off.', tone: 'ok', gap: 1 },
      ],
      outro: 'Perfect for feeds, notifications and LLM token streaming. For client → server you still use normal requests.',
    }),
  websocket: () =>
    laneFrames({
      lanes: ['client', 'server'],
      panel: 'WebSocket',
      intro: 'WebSocket upgrades an HTTP connection into a two-way message channel.',
      msgs: [
        { from: 0, to: 1, label: 'GET /ws Upgrade: websocket', note: 'It starts as an HTTP/1.1 request asking to upgrade.', detail: d('WebSocket upgrade', 'After 101 Switching Protocols the TCP connection carries framed messages both ways.', 'GET /ws HTTP/1.1\nUpgrade: websocket\nConnection: Upgrade\nSec-WebSocket-Key: dGhlIHNhbXBsZQ==') },
        { from: 1, to: 0, label: '101 Switching Protocols', note: 'From here it is no longer HTTP.', tone: 'ok' },
        { from: 0, to: 1, label: 'msg: typing…', note: 'Either side sends frames any time.' },
        { from: 1, to: 0, label: 'msg: new message', note: 'Full duplex, low overhead per message.', tone: 'ok' },
        { from: 1, to: 0, label: 'ping / pong', note: 'Heartbeats keep NATs and load balancers from dropping idle connections.', tone: 'warn', gap: 1 },
      ],
      outro: 'Best for chat, games and collaboration. Stateful connections make scaling and deploys harder: plan for reconnects.',
    }),
};

machineDemo({
  slug: 'nw-http',
  title: 'HTTP versions & gRPC',
  group: 'net-http',
  summary: 'HTTP/1.1 head-of-line and 6 connections, HTTP/2 multiplexing and HPACK, HTTP/3 over QUIC, gRPC unary and streaming.',
  inputs: [
    { id: 'h1', label: 'HTTP/1.1', data: { k: 'h1' } },
    { id: 'h2', label: 'HTTP/2', data: { k: 'h2' } },
    { id: 'h3', label: 'HTTP/3', data: { k: 'h3' } },
    { id: 'grpc', label: 'gRPC', data: { k: 'grpc' } },
  ],
  build: ({ k }: { k: string }) => http[k](),
});

machineDemo({
  slug: 'nw-realtime',
  title: 'Real-time: polling to WebSockets',
  group: 'net-http',
  summary: 'Short polling, long polling, Server-Sent Events and WebSockets compared on latency and cost.',
  inputs: [
    { id: 'polling', label: 'Polling', data: { k: 'polling' } },
    { id: 'longpoll', label: 'Long polling', data: { k: 'longpoll' } },
    { id: 'sse', label: 'SSE', data: { k: 'sse' } },
    { id: 'websocket', label: 'WebSocket', data: { k: 'websocket' } },
  ],
  build: ({ k }: { k: string }) => realtime[k](),
});

// ---------------- TLS ----------------
const tls: Record<string, () => Frame[]> = {
  handshake: () =>
    laneFrames({
      lanes: ['client', 'server'],
      panel: 'TLS 1.3',
      intro: 'TLS 1.3 agrees on keys, proves the server\'s identity and encrypts, all in one round trip.',
      msgs: [
        { from: 0, to: 1, label: 'ClientHello + key_share + SNI', note: 'The client sends supported ciphers, a Diffie-Hellman key share and the hostname (SNI).', detail: d('ClientHello', 'Offers cipher suites and an ephemeral ECDHE public key, guessing the server\'s group. SNI names the site, still in plaintext unless ECH is used.', '$ openssl s_client -connect example.com:443 \\\n    -servername example.com -tls1_3') },
        { from: 1, to: 1, label: 'derive keys (ECDHE)', note: 'The server combines both key shares into a shared secret. Nobody on the wire can compute it.', tone: 'warn', detail: d('ECDHE', 'Ephemeral Diffie-Hellman gives forward secrecy: stealing the server\'s private key later can\'t decrypt recorded traffic.') },
        { from: 1, to: 0, label: 'ServerHello + {Cert, Verify, Finished}', note: 'Everything after ServerHello is already encrypted, including the certificate.' },
        { from: 0, to: 0, label: 'verify cert chain + signature', note: 'The client checks the certificate chain and that the server signed the handshake with the matching private key.', tone: 'warn' },
        { from: 0, to: 1, label: '{Finished} + GET /', note: 'The client finishes and sends the first request in the same flight.', tone: 'ok', rows: [['RTTs', 1, 'ok']] },
      ],
      outro: 'TLS 1.2 needed two round trips. On top of TCP that makes 2 RTTs before the first request.',
    }),
  resume: () =>
    laneFrames({
      lanes: ['client', 'server'],
      panel: 'Resumption',
      intro: 'On reconnect the client reuses a pre-shared key from a session ticket.',
      msgs: [
        { from: 1, to: 0, label: 'NewSessionTicket', note: 'After the first handshake, the server sends a ticket the client can present later.' },
        { from: 0, to: 1, label: 'ClientHello + PSK + early data', note: 'Next time the client resumes and sends 0-RTT data immediately.', gap: 1, tone: 'ok' },
        { from: 1, to: 0, label: 'ServerHello + response', note: 'The server answers the early request right away.', tone: 'ok', rows: [['RTTs', 0, 'ok']] },
        { from: 0, to: 1, label: 'attacker replays early data', note: 'Early data has no replay protection, so an attacker can resend it.', tone: 'fail', rows: [['risk', 'replay', 'fail']] },
      ],
      outro: 'Only allow 0-RTT for idempotent requests. Never for payments or anything that changes state.',
    }),
  mtls: () =>
    laneFrames({
      lanes: ['service A', 'service B'],
      panel: 'mTLS',
      intro: 'Mutual TLS: both sides present certificates. Service meshes use it for service identity.',
      msgs: [
        { from: 0, to: 1, label: 'ClientHello', note: 'A connects to B.' },
        { from: 1, to: 0, label: 'Cert(B) + CertificateRequest', note: 'B proves itself and asks A for a certificate too.' },
        { from: 0, to: 1, label: 'Cert(A) + Verify', note: 'A presents its certificate, issued by the internal CA with a SPIFFE id.', detail: d('Workload certificate', 'Short-lived certificates (hours) from an internal CA, identity in the SAN, rotated automatically by Istio, Linkerd or SPIRE.', 'URI SAN: spiffe://prod/ns/payments/sa/api\nNot After: +24h') },
        { from: 1, to: 1, label: 'authz: A may call B?', note: 'B now knows exactly which service is calling and can enforce policy on it.', tone: 'ok' },
      ],
      outro: 'Identity comes from certificates, not IP addresses. That is the basis of zero-trust networking.',
    }),
};

const CERT = (title: string, text: string, code: string) => d(title, text, code);
const certBoard = (k: string): Board => ({
  panel: 'Certificates',
  nodes: [
    N('root', 330, 40, 340, 130, 'Root CA', 'in the OS trust store', { detail: CERT('Root CA', 'Self-signed, shipped with the OS or browser. Kept offline; signs intermediates only.', '$ ls /etc/ssl/certs | head\n$ security find-certificate -a  # macOS') }),
    N('int', 330, 260, 340, 130, 'Intermediate CA', 'signed by root', { detail: CERT('Intermediate', 'Signs leaf certificates. The server must send it along with its leaf; forgetting it breaks some clients.', 'ssl_certificate fullchain.pem;  # leaf + intermediate') }),
    N('leaf', 330, 480, 340, 130, 'api.example.com', 'leaf · 90 days', { detail: CERT('Leaf certificate', 'Binds the hostnames in its SAN to a public key, signed by the intermediate. Let\'s Encrypt issues 90-day ones.', '$ openssl s_client -connect api.example.com:443 \\\n  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName') }),
    N('srv', 40, 700, 440, 130, 'server', 'private key + fullchain'),
    N('cli', 520, 700, 440, 130, 'client', 'verifies chain → root'),
    N('err', 40, 870, 920, 110, '', ''),
  ],
  edges: ['root>int', 'int>leaf'],
  beats:
    k === 'chain'
      ? [
          { note: 'A root CA the client already trusts signs an intermediate CA.', hot: { root: 'current', 'root>int': 'accent' }, hide: ['err'] },
          { note: 'The intermediate signs the leaf certificate for api.example.com.', hot: { int: 'current', 'int>leaf': 'accent' }, hide: ['err'] },
          { note: 'The server sends leaf plus intermediate and proves it holds the leaf\'s private key.', hot: { srv: 'current', leaf: 'current' }, hide: ['err'], rows: [['sent', 'leaf + intermediate']] },
          { note: 'The client walks the signatures up to a root in its trust store, then checks the name and the dates.', hot: { cli: 'ok', root: 'ok', int: 'ok', leaf: 'ok' }, hide: ['err'], rows: [['trusted', 'yes', 'ok']] },
        ]
      : k === 'sni'
        ? [
            { note: 'One IP hosts many sites, each with its own certificate.', hot: { srv: 'current' }, label: { srv: '1 IP · 300 sites' }, hide: ['err'] },
            { note: 'SNI in the ClientHello says which hostname the client wants, so the server picks the right certificate.', hot: { leaf: 'current' }, label: { err: 'ClientHello SNI = api.example.com' }, rows: [['SNI', 'api.example.com']] },
            { note: 'SNI travels in plaintext, so networks can see which site you visit. Encrypted Client Hello hides it.', hot: { err: 'warn' }, label: { err: 'visible on the wire (ECH hides it)' }, rows: [['privacy', 'SNI leaks host', 'warn']] },
          ]
        : [
            { note: 'Expired certificate: every client fails at once when the date passes. Automate renewal and alert 30 days ahead.', hot: { leaf: 'fail', err: 'fail' }, sub: { leaf: 'expired yesterday' }, label: { err: 'x509: certificate has expired' }, rows: [['error', 'expired', 'fail']] },
            { note: 'Name mismatch: the SAN doesn\'t list the hostname you dialled, often from connecting by IP or a new subdomain.', hot: { leaf: 'fail', err: 'fail' }, sub: { leaf: 'SAN: www.example.com' }, label: { err: 'certificate is not valid for api.example.com' }, rows: [['error', 'name mismatch', 'fail']] },
            { note: 'Missing intermediate: browsers may fetch it themselves, but curl, Java and Go fail. Always serve the full chain.', hot: { int: 'fail', err: 'fail' }, label: { err: 'unable to get local issuer certificate' }, rows: [['error', 'incomplete chain', 'fail']] },
            { note: 'Private CA not in the trust store: add it to the client, never switch verification off.', hot: { root: 'fail', err: 'fail' }, label: { err: 'self-signed certificate in chain' }, rows: [['never', 'verify=False', 'fail']] },
          ],
});

machineDemo({
  slug: 'nw-tls',
  title: 'TLS 1.3 handshake',
  group: 'net-tls',
  summary: 'One-round-trip TLS 1.3 with ECDHE, session resumption and 0-RTT replay risk, mutual TLS between services.',
  inputs: [
    { id: 'handshake', label: 'Full handshake', data: { k: 'handshake' } },
    { id: 'resume', label: 'Resumption & 0-RTT', data: { k: 'resume' } },
    { id: 'mtls', label: 'Mutual TLS', data: { k: 'mtls' } },
  ],
  build: ({ k }: { k: string }) => tls[k](),
});

machineDemo({
  slug: 'nw-certs',
  title: 'Certificates & trust',
  group: 'net-tls',
  summary: 'Root → intermediate → leaf chain of trust, SNI for many sites on one IP, and the common certificate failures.',
  inputs: [
    { id: 'chain', label: 'Chain of trust', data: { k: 'chain' } },
    { id: 'sni', label: 'SNI', data: { k: 'sni' } },
    { id: 'failures', label: 'Failure modes', data: { k: 'failures' } },
  ],
  build: ({ k }: { k: string }) => boardFrames(certBoard(k)),
});
