// Edge & operations (groups net-lb, net-tools): L4/L7 load balancers, health checks, stickiness, CDNs, debugging tools, latency numbers.
import type { Detail, Frame, Shape } from '../algo/frames';
import { box, Film, machineDemo, panel, text } from '../machine/lib/draw';
import { boardFrames, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { bdpBytes, laneFrames } from './lib';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });

// ---------------- load balancers ----------------
const LB4 = d('L4 load balancer', 'Balances TCP/UDP flows by the 5-tuple. It never parses HTTP: fast, protocol-agnostic, but every request on a connection goes to the same backend.', '# AWS NLB, Google Maglev, IPVS, HAProxy mode tcp\n$ ipvsadm -A -t 10.0.0.100:443 -s rr\n$ ipvsadm -a -t 10.0.0.100:443 -r 10.0.1.11 -g');
const LB7 = d('L7 load balancer / reverse proxy', 'Terminates TLS and HTTP, then routes each request by host, path or header. Adds retries, timeouts, auth, rate limits.', 'location /api/ { proxy_pass http://api_pool; }\nlocation /     { proxy_pass http://web_pool; }\nupstream api_pool { server 10.0.1.11; server 10.0.1.12; }');

const lbBoard = (k: string): Board => ({
  panel: 'Load balancer',
  nodes: [
    N('c', 40, 60, 280, 120, 'clients', '10k connections'),
    N('lb', 360, 60, 280, 120, k === 'l4' ? 'L4 LB' : 'L7 proxy', k === 'l4' ? 'TCP, 5-tuple' : 'TLS + HTTP', { detail: k === 'l4' ? LB4 : LB7 }),
    N('b1', 40, 360, 280, 130, 'backend 1', k === 'l7' ? 'api' : 'healthy'),
    N('b2', 360, 360, 280, 130, 'backend 2', k === 'l7' ? 'api' : 'healthy'),
    N('b3', 680, 360, 280, 130, 'backend 3', k === 'l7' ? 'web' : 'healthy'),
    N('hc', 680, 60, 280, 120, 'health checks', 'GET /healthz every 5 s', { detail: d('Health checks', 'Active checks probe each backend; after N failures it is ejected, after M passes restored. Passive outlier detection ejects on real 5xx rates.', 'health_check interval=5s fails=3 passes=2 uri=/healthz;') }),
    N('info', 40, 600, 920, 330, '', ''),
  ],
  edges: ['c>lb', 'lb>b1', 'lb>b2', 'lb>b3'],
  beats:
    k === 'l4'
      ? [
          { note: 'An L4 balancer sees only IPs and ports. It picks a backend per connection, not per request.', hot: { lb: 'current', 'lb>b1': 'accent' }, hide: ['hc', 'info'], rows: [['decides on', '5-tuple']] },
          { note: 'With direct server return, replies bypass the balancer, so one box can front huge traffic.', hot: { b1: 'current' }, label: { info: 'DSR: responses go straight back to the client' }, hide: ['hc'], rows: [['throughput', 'millions of pps']] },
          { note: 'A client with one long-lived HTTP/2 or gRPC connection pins all its requests to one backend.', hot: { b1: 'warn', b2: 'visited', b3: 'visited' }, label: { info: 'gRPC client → 1 connection → backend 1 gets 100%' }, hide: ['hc'], rows: [['imbalance', 'per-connection', 'warn']] },
          { note: 'Use L4 for raw TCP, databases and massive fan-in. Use L7 when you need per-request balancing.', hot: { lb: 'ok' }, label: { info: 'NLB, Maglev, IPVS, HAProxy tcp' }, hide: ['hc'] },
        ]
      : k === 'l7'
        ? [
            { note: 'An L7 proxy terminates TLS and reads each HTTP request.', hot: { lb: 'current' }, hide: ['hc', 'info'], rows: [['decides on', 'host, path, headers']] },
            { note: 'Requests to /api go to api backends, everything else to web.', hot: { 'lb>b1': 'accent', 'lb>b2': 'accent', 'lb>b3': 'accent' }, label: { info: '/api/* → api pool · / → web pool' }, hide: ['hc'], rows: [['routes', 2]] },
            { note: 'Each request is balanced separately, even on one HTTP/2 connection. Least-requests beats round robin when requests vary.', hot: { b1: 'ok', b2: 'ok' }, label: { info: 'least outstanding requests' }, hide: ['hc'], rows: [['balance', 'per request', 'ok']] },
            { note: 'It also adds X-Forwarded-For, retries, timeouts and TLS in one place. The cost is CPU and one more hop.', hot: { lb: 'ok' }, label: { info: 'X-Forwarded-For: 203.0.113.9' }, hide: ['hc'], rows: [['added latency', '~0.5–2 ms']] },
          ]
        : k === 'health'
          ? [
              { note: 'The balancer probes /healthz on every backend every few seconds.', hot: { hc: 'current', b1: 'ok', b2: 'ok', b3: 'ok' }, hide: ['info'], rows: [['healthy', 3]] },
              { note: 'Backend 2 fails three checks in a row and is ejected; traffic spreads over the rest.', hot: { b2: 'fail', 'lb>b2': 'fail' }, sub: { b2: '3 fails → ejected' }, hide: ['info'], rows: [['healthy', 2, 'warn']] },
              { note: 'A /healthz that checks the database takes every backend out when the database blips. Keep liveness shallow.', hot: { b1: 'fail', b3: 'fail', b2: 'fail' }, label: { info: 'deep health check → all ejected → total outage' }, rows: [['healthy', 0, 'fail']] },
              { note: 'During deploys, drain first: stop sending new requests, let in-flight ones finish, then stop the process.', hot: { b3: 'warn', b1: 'ok', b2: 'ok' }, sub: { b3: 'draining' }, label: { info: 'connection draining 30 s' }, rows: [['dropped requests', 0, 'ok']] },
            ]
          : [
              { note: 'Round robin sends a user\'s requests to different backends. Local caches and sessions miss every time.', hot: { 'lb>b1': 'accent', 'lb>b2': 'accent', 'lb>b3': 'accent' }, hide: ['hc', 'info'], rows: [['cache hit rate', 'low', 'warn']] },
              { note: 'Sticky sessions pin a user by cookie. Simple, but load gets uneven and a dead backend loses its sessions.', hot: { b1: 'current' }, label: { info: 'Set-Cookie: lb=b1' }, hide: ['hc'], rows: [['stickiness', 'cookie']] },
              { note: 'Consistent hashing on a key (user id, URL) keeps each key on one backend and moves few keys when backends change.', hot: { b2: 'current' }, label: { info: 'hash(user_id) → ring → backend 2' }, hide: ['hc'], rows: [['keys moved on change', '~1/N', 'ok']] },
              { note: 'Better still, keep backends stateless and put sessions in a shared store.', hot: { b1: 'ok', b2: 'ok', b3: 'ok' }, label: { info: 'sessions in Redis → any backend' }, hide: ['hc'], rows: [['stickiness', 'not needed', 'ok']] },
            ],
});

machineDemo({
  slug: 'nw-lb',
  title: 'Load balancers & proxies',
  group: 'net-lb',
  summary: 'L4 vs L7 balancing, health checks and draining, sticky sessions vs consistent hashing.',
  inputs: [
    { id: 'l4', label: 'L4 (TCP)', data: { k: 'l4' } },
    { id: 'l7', label: 'L7 (HTTP)', data: { k: 'l7' } },
    { id: 'health', label: 'Health checks', data: { k: 'health' } },
    { id: 'sticky', label: 'Stickiness', data: { k: 'sticky' } },
  ],
  build: ({ k }: { k: string }) => boardFrames(lbBoard(k)),
});

// ---------------- CDN ----------------
const EDGE = d('Edge PoP', 'A CDN server near the user. It terminates TLS and serves cached responses; misses go to a regional shield, then the origin.', '$ curl -sI https://cdn.example.com/app.js | grep -i -E "age|x-cache|cache-control"\ncache-control: public, max-age=31536000, immutable\nage: 5321\nx-cache: HIT');

const cdn: Record<string, () => Frame[]> = {
  miss: () =>
    laneFrames({
      lanes: ['user (Sydney)', 'edge (Sydney)', 'shield', 'origin (us-east)'],
      laneDetails: [undefined, EDGE, d('Origin shield', 'A mid-tier cache in front of the origin, so a cold object is fetched once instead of once per PoP.'), d('Origin', 'Your servers. With a good CDN hit rate they see a tiny fraction of traffic.')],
      panel: 'CDN miss',
      intro: 'The first request for /app.js in Sydney.',
      msgs: [
        { from: 0, to: 1, label: 'GET /app.js', note: 'The user connects to the nearest edge, 5 ms away.' },
        { from: 1, to: 2, label: 'miss → shield', note: 'Not cached here, so the edge asks the shield.', tone: 'warn' },
        { from: 2, to: 3, label: 'miss → origin', note: 'The shield misses too and fetches from the origin, 200 ms round trip.', tone: 'warn', rows: [['latency', '~250 ms', 'warn']] },
        { from: 3, to: 2, label: '200 · max-age=31536000', note: 'The origin answers with caching headers.', detail: d('Cache-Control', 'max-age sets freshness; immutable says never revalidate; s-maxage is for shared caches only. Fingerprinted file names make year-long caching safe.', 'Cache-Control: public, max-age=31536000, immutable') },
        { from: 2, to: 1, label: 'stored', note: 'Both tiers store a copy on the way back.' },
        { from: 1, to: 0, label: '200 (x-cache: MISS)', note: 'This user paid the full trip once.' },
      ],
      outro: 'Every later user in Sydney is served from the edge. The shield means other PoPs also avoid the origin.',
    }),
  hit: () =>
    laneFrames({
      lanes: ['user (Sydney)', 'edge (Sydney)', 'origin (us-east)'],
      laneDetails: [undefined, EDGE, undefined],
      panel: 'CDN hit',
      intro: 'Another user requests the same file.',
      msgs: [
        { from: 0, to: 1, label: 'GET /app.js', note: 'The request reaches the edge.' },
        { from: 1, to: 0, label: '200 (x-cache: HIT, age 5321)', note: 'Served from the edge in about 10 ms. The origin never hears about it.', tone: 'ok', detail: EDGE, rows: [['latency', '~10 ms', 'ok'], ['origin load', 0, 'ok']] },
        { from: 0, to: 1, label: 'GET /api/cart', note: 'Personalised API calls are usually not cacheable.' },
        { from: 1, to: 2, label: 'pass-through', note: 'The edge still helps: TLS ends nearby and it reuses a warm connection to the origin.', tone: 'warn', rows: [['saved', 'TCP+TLS handshakes']] },
      ],
      outro: 'Hit rate is the metric that matters. Vary headers and query strings that change the cache key quietly destroy it.',
    }),
  invalidate: () =>
    laneFrames({
      lanes: ['you', 'edges (×300)', 'origin'],
      panel: 'Invalidation',
      intro: 'You deploy a fixed /index.html, but edges hold the old copy for its max-age.',
      msgs: [
        { from: 0, to: 1, label: 'purge /index.html', note: 'A purge API call evicts the object from every PoP, usually within seconds.', detail: d('Purge', 'Instant invalidation by URL or by surrogate key (tag). Use keys to purge every page showing product 42 at once.', '$ curl -X POST .../purge -d \'{"files":["https://x.com/index.html"]}\'') },
        { from: 1, to: 2, label: 'refetch', note: 'The next request at each edge fetches the new version.' },
        { from: 1, to: 1, label: 'stale-while-revalidate', note: 'Or serve the stale copy while refetching in the background, so users never wait on the origin.', tone: 'ok', detail: d('stale-while-revalidate', 'Serve stale for up to N seconds while one request refreshes. stale-if-error keeps serving when the origin is down.', 'Cache-Control: max-age=60, stale-while-revalidate=600, stale-if-error=86400') },
        { from: 1, to: 1, label: 'stale-if-error', note: 'If the origin is down, edges keep serving the last good copy.', tone: 'ok', rows: [['origin down', 'site stays up', 'ok']] },
      ],
      outro: 'Short TTL plus purge for HTML, fingerprinted names with a one-year TTL for assets.',
    }),
};

machineDemo({
  slug: 'nw-cdn',
  title: 'CDNs & edge caching',
  group: 'net-lb',
  summary: 'Edge and shield tiers on a miss, hits served near users, Cache-Control, purges and stale-while-revalidate.',
  inputs: [
    { id: 'miss', label: 'Cache miss', data: { k: 'miss' } },
    { id: 'hit', label: 'Cache hit', data: { k: 'hit' } },
    { id: 'invalidate', label: 'Invalidation', data: { k: 'invalidate' } },
  ],
  build: ({ k }: { k: string }) => cdn[k](),
});

// ---------------- debugging toolbox ----------------
interface ToolLine {
  text: string;
  note: string;
  explain?: Detail;
}

const TOOLS: Record<string, { cmd: string; lines: ToolLine[]; intro: string; outro: string; detail: Detail }> = {
  ping: {
    cmd: '$ ping -c 4 api.example.com',
    detail: d('ping', 'ICMP echo: is the host reachable, what is the round-trip time, is there loss? Many hosts drop ICMP, so no reply doesn\'t prove it is down.', '$ ping -c 20 -i 0.2 10.0.1.12'),
    intro: 'ping answers three questions: reachable, how far in time, how lossy.',
    lines: [
      { text: '64 bytes from 93.184.216.34: icmp_seq=1 ttl=56 time=11.2 ms', note: 'Each line is one echo reply with its round-trip time.' },
      { text: '64 bytes from 93.184.216.34: icmp_seq=2 ttl=56 time=11.0 ms', note: 'ttl=56 hints at the hop count: it probably started at 64, so about 8 hops.' },
      { text: 'Request timeout for icmp_seq 3', note: 'A missing reply is loss, or ICMP rate limiting.', explain: d('Loss or filtering?', 'Occasional ICMP loss with perfect TCP is usually rate limiting. Confirm with a TCP-level probe (mtr --tcp, curl).') },
      { text: '4 packets transmitted, 3 received, 25% packet loss', note: 'The summary gives loss rate and min/avg/max/stddev RTT.' },
      { text: 'rtt min/avg/max/mdev = 10.9/11.1/11.4/0.2 ms', note: 'Low mdev means a stable path. Jitter shows up here first.' },
    ],
    outro: 'Use ping for a quick reachability and latency check, not as proof that a service works.',
  },
  traceroute: {
    cmd: '$ mtr -rwc 50 api.example.com',
    detail: d('traceroute / mtr', 'Maps the path hop by hop using TTL. mtr keeps probing and shows per-hop loss and latency.', '$ traceroute -T -p 443 api.example.com  # TCP probes'),
    intro: 'mtr combines traceroute and ping: every hop, probed 50 times.',
    lines: [
      { text: ' 1. 10.0.0.1          0.0%   0.8 ms', note: 'Hop 1 is your gateway.' },
      { text: ' 2. 100.64.0.1        0.0%   4.9 ms', note: 'Hop 2 is the ISP edge.' },
      { text: ' 5. ae-2.r01.lax      30.0%  12.1 ms', note: '30% loss at hop 5 but not after it is only ICMP rate limiting at that router.', explain: d('Loss at one hop only', 'If later hops show 0% loss, the router just deprioritises ICMP to itself. Real loss persists to the destination.') },
      { text: ' 9. edge.example.com  0.0%  11.3 ms', note: 'The destination has no loss, so the path is fine.' },
    ],
    outro: 'Only loss that continues to the final hop is real. Latency jumps show where distance or congestion is.',
  },
  dig: {
    cmd: '$ dig +trace api.example.com',
    detail: d('dig', 'Queries DNS directly and shows the answer, the TTL left and which server answered. +trace walks from the root.', '$ dig @8.8.8.8 api.example.com +short'),
    intro: 'dig shows exactly what DNS says, bypassing your OS cache.',
    lines: [
      { text: '.            518400 IN NS a.root-servers.net.', note: 'The root delegates, with a TTL of six days.' },
      { text: 'com.         172800 IN NS a.gtld-servers.net.', note: 'The .com TLD delegates to the domain\'s name servers.' },
      { text: 'api.example.com. 60 IN A 93.184.216.34', note: 'The authoritative answer, with a 60 s TTL.' },
      { text: ';; Query time: 23 msec  SERVER: 1.1.1.1', note: 'Query time near 0 means a cache hit; tens of ms means the resolver went to fetch it.' },
    ],
    outro: 'Compare dig against several resolvers to spot stale caches after a DNS change.',
  },
  curl: {
    cmd: '$ curl -w "@timing" -o /dev/null -s https://api.example.com',
    detail: d('curl timing', 'curl -w prints where time went on a request.', 'dns:     %{time_namelookup}\nconnect: %{time_connect}\ntls:     %{time_appconnect}\nttfb:    %{time_starttransfer}\ntotal:   %{time_total}'),
    intro: 'curl -w breaks one request\'s latency into phases.',
    lines: [
      { text: 'dns        0.021 s', note: '21 ms resolving the name.' },
      { text: 'connect    0.093 s', note: 'TCP handshake done at 93 ms, so the RTT is about 72 ms.', explain: d('connect − dns ≈ 1 RTT', 'The TCP handshake is one round trip, so this difference is your network RTT to the server.') },
      { text: 'tls        0.168 s', note: 'TLS took another 75 ms, one more round trip.' },
      { text: 'ttfb       0.412 s', note: 'First byte at 412 ms: the server spent about 170 ms thinking after one more RTT.', explain: d('Server time', 'ttfb − tls − 1 RTT ≈ time spent in the backend. Here ~170 ms, so the app, not the network, is the slow part.') },
      { text: 'total      0.430 s', note: 'Transfer of the body took the last 18 ms.' },
    ],
    outro: 'Now you know whether to fix DNS, distance, handshakes (reuse connections) or the server itself.',
  },
  tcpdump: {
    cmd: '$ tcpdump -ni eth0 host 10.0.1.12 and port 5432',
    detail: d('tcpdump', 'Captures packets on an interface with a BPF filter. Write with -w file.pcap and open in Wireshark for deep analysis.', '$ tcpdump -ni any -w /tmp/db.pcap port 5432\n$ tshark -r /tmp/db.pcap -q -z conv,tcp'),
    intro: 'A capture of an app connecting to Postgres, read line by line.',
    lines: [
      { text: '10.0.0.5.52814 > 10.0.1.12.5432: Flags [S], seq 1000', note: '[S] is a SYN from the app.' },
      { text: '10.0.1.12.5432 > 10.0.0.5.52814: Flags [S.], seq 5000, ack 1001', note: '[S.] is SYN-ACK: the server is listening.' },
      { text: '10.0.0.5.52814 > 10.0.1.12.5432: Flags [.], ack 5001', note: '[.] is a bare ACK. Handshake done.' },
      { text: '10.0.0.5.52814 > 10.0.1.12.5432: Flags [P.], length 84', note: '[P.] carries data: the startup message.' },
      { text: '10.0.0.5.52814 > 10.0.1.12.5432: Flags [P.], length 84 (retransmission)', note: 'A retransmission means loss somewhere. Many of them point at the network, not the database.', explain: d('Retransmissions', 'Count them across a capture. A few per thousand are normal; bursts correlate with latency spikes.', '$ tshark -r x.pcap -Y tcp.analysis.retransmission | wc -l') },
      { text: '10.0.1.12.5432 > 10.0.0.5.52814: Flags [R.]', note: '[R] is a reset: something killed the connection, often a proxy idle timeout.', explain: d('Unexpected RST', 'A middlebox (NAT, LB, firewall) timed out an idle flow and resets when traffic resumes. Fix with keepalives shorter than its timeout.') },
    ],
    outro: 'Flags tell the story: S handshake, P data, F graceful close, R abort.',
  },
  ss: {
    cmd: '$ ss -tanp',
    detail: d('ss', 'Lists sockets with state, queue sizes and owning process. Replaces netstat.', '$ ss -tan state established | wc -l\n$ ss -s   # summary by state'),
    intro: 'ss shows every socket on the box, with state and queues.',
    lines: [
      { text: 'LISTEN  0    4096  0.0.0.0:443     users:(("nginx"))', note: 'A listener: Send-Q is the backlog, Recv-Q the queued connections not yet accepted.' },
      { text: 'ESTAB   0    0     10.0.0.5:443  203.0.113.9:51234', note: 'An established connection with empty queues: healthy.' },
      { text: 'ESTAB   0  2.1M    10.0.0.5:443  203.0.113.7:40022', note: 'Send-Q of 2 MB means the client isn\'t reading fast enough, a slow consumer.', explain: d('Send-Q growing', 'Bytes your app wrote that the peer hasn\'t acknowledged. A large Send-Q is a slow client or a congested path.') },
      { text: 'CLOSE-WAIT 1   0   10.0.0.5:39122 10.0.1.12:5432', note: 'CLOSE-WAIT means the peer closed and your code didn\'t. Many of these are a socket leak.' },
      { text: 'TIME-WAIT  0   0   10.0.0.5:39110 10.0.1.12:5432', note: 'TIME-WAIT means you closed first. Thousands suggest missing connection reuse.' },
    ],
    outro: 'Count sockets by state before and after an incident: it points straight at leaks and slow consumers.',
  },
};

function toolFrames(k: string): Frame[] {
  const t = TOOLS[k];
  const f = new Film();
  const draw = (upto: number): Shape[] => {
    const out: Shape[] = [];
    const head = box('cmd', 20, 30, 960, 90, t.cmd, { mono: true, tone: 'current' });
    if (head.t === 'rect') head.detail = t.detail;
    out.push(head);
    t.lines.forEach((l, i) => {
      if (i > upto) return;
      const b = box(`l${i}`, 20, 150 + i * 130, 960, 110, l.text, { mono: true, tone: i === upto ? 'current' : 'default' });
      if (b.t === 'rect' && l.explain) b.detail = l.explain;
      out.push(b);
    });
    return out;
  };
  f.add(t.intro, draw(-1), panel('Output', [['tool', t.cmd.split(' ')[1]]]));
  t.lines.forEach((l, i) => f.add(l.note, draw(i), panel('Output', [['line', `${i + 1} / ${t.lines.length}`]])));
  f.add(t.outro, draw(t.lines.length - 1), panel('Output', [['lines read', t.lines.length]]));
  return f.frames;
}

machineDemo({
  slug: 'nw-tools',
  title: 'Network debugging toolbox',
  group: 'net-tools',
  summary: 'Reading ping, mtr, dig, curl timing, tcpdump and ss output like an SRE.',
  inputs: Object.keys(TOOLS).map((id) => ({ id, label: id, data: { k: id } })),
  build: ({ k }: { k: string }) => toolFrames(k),
});

// ---------------- latency numbers ----------------
const LAT: [string, number, string][] = [
  ['same host (loopback)', 0.02, 'syscalls + kernel only'],
  ['same rack / AZ', 0.3, 'one switch hop'],
  ['cross-AZ, same region', 1.2, 'a few km of fibre'],
  ['US east ↔ US west', 65, '~4,000 km'],
  ['US east ↔ Europe', 80, 'transatlantic'],
  ['US east ↔ Sydney', 200, 'half the planet'],
  ['4G mobile last mile', 50, 'radio + carrier core'],
];

function latencyFrames(): Frame[] {
  const f = new Film();
  const max = Math.log10(250) - Math.log10(0.01);
  const draw = (upto: number): Shape[] => {
    const out: Shape[] = [text('t', 20, 40, 'round-trip times (log scale)', { align: 'left', size: 30, bold: true })];
    LAT.forEach(([name, ms, sub], i) => {
      if (i > upto) return;
      const w = Math.max(40, (560 * (Math.log10(ms) - Math.log10(0.01))) / max);
      const b = box(`n${i}`, 20, 100 + i * 118, 360, 100, name, { sub, tone: i === upto ? 'current' : 'default' });
      if (b.t === 'rect') b.detail = d(name, `Typical RTT ≈ ${ms} ms. ${ms >= 50 ? 'Every sequential round trip at this distance adds visibly to page and API latency.' : 'Small enough that chatty protocols are fine here.'}`, `$ ping -c 10 <host>\n# expect ~${ms} ms`);
      out.push(b);
      out.push(box(`b${i}`, 400, 110 + i * 118, w, 80, `${ms} ms`, { mono: true, tone: ms >= 50 ? 'warn' : ms >= 1 ? 'read' : 'ok' }));
    });
    return out;
  };
  f.add('Latency is set by distance: light in fibre covers about 200 km per millisecond.', draw(-1), panel('Latency', [['fibre', '~200 km/ms']]));
  LAT.forEach(([name, ms], i) => f.add(`${name}: about ${ms} ms round trip.`, draw(i), panel('Latency', [['RTT', `${ms} ms`, ms >= 50 ? 'warn' : undefined]])));
  const bdp = bdpBytes(1000, 80);
  f.add(`A request that makes 10 sequential calls across the Atlantic spends 800 ms just waiting. Batch, parallelise or move the data closer.`, draw(LAT.length - 1), panel('Latency', [['10 × 80 ms', '800 ms', 'fail']]));
  f.add(`Long fat pipes need big windows: 1 Gbit/s at 80 ms needs ${(bdp / 1e6).toFixed(0)} MB in flight to stay full.`, draw(LAT.length - 1), panel('Latency', [['BDP', `${(bdp / 1e6).toFixed(1)} MB`]]));
  return f.frames;
}

machineDemo({
  slug: 'nw-latency',
  title: 'Latency numbers',
  group: 'net-tools',
  summary: 'Round-trip times from loopback to intercontinental, why sequential calls hurt, and the bandwidth-delay product.',
  inputs: [{ id: 'rtt', label: 'Round-trip times', data: {} }],
  build: () => latencyFrames(),
});
