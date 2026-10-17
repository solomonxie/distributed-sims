// Lua inside other programs (group lang-lua): nginx/OpenResty request phases, cosockets and shared dicts; Redis scripts,
// EVALSHA and Cluster key rules. Each scene is a picture rebuilt from the knobs under the stage.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, panel, text } from '../machine/lib/draw';
import { cap, choice, liveGroup, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';

const liveDemo = liveGroup('lang-lua');
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

// ---------------- nginx + Lua ----------------
const PHASES = ['rewrite', 'access', 'content', 'log'];

function phases(p: P): Frame[] {
  const auth = pick(p.auth, ['yes', 'no'], 'yes') === 'yes';
  const f = new Film();
  const scene = (stmt: string, st: Record<string, [Tone, string]>, resp?: [string, Tone]): Shape[] => {
    const out: Shape[] = [...cap(stmt), box('req', 40, 120, 920, 80, `GET /api/orders${auth ? '  Authorization: Bearer …' : '  (no Authorization)'}`, { mono: true, tone: 'accent' })];
    PHASES.forEach((ph, k) => {
      const [tone, sub] = st[ph] ?? ['muted', 'waiting'];
      out.push(box(`ph${k}`, 40 + k * 235, 300, 215, 150, `${ph}_by_lua`, { sub, mono: true, tone, dashed: sub === 'skipped' }));
      if (k) out.push(arrow(`pa${k}`, 40 + k * 235 - 20, 375, 40 + k * 235, 375, 'muted', { width: 3 }));
    });
    if (resp) out.push(box('resp', 40, 560, 920, 90, resp[0], { mono: true, tone: resp[1] }));
    return out;
  };
  f.add('Every nginx worker embeds a Lua VM. Each *_by_lua block hooks one phase of the request, in a fixed order.', scene('location /api { … }', {}), panel('Phases', [['phases', 4]]));
  f.add('rewrite runs first and changes the URI to /v2/api/orders.', scene('ngx.req.set_uri("/v2" .. ngx.var.uri)', { rewrite: ['ok', '/v2/api/orders'] }), panel('Phases', [['uri', '/v2/api/orders']]));
  if (auth) {
    f.add('access checks the Authorization header. It is there, so the request continues.', scene('if not ngx.var.http_authorization then …', { rewrite: ['ok', 'done'], access: ['ok', 'allowed'] }), panel('Phases', [['auth', 'present', 'ok']]));
    f.add('content writes the body. The upstream never had to deal with auth.', scene('ngx.say(cjson.encode(orders))', { rewrite: ['ok', 'done'], access: ['ok', 'allowed'], content: ['ok', '200 body'] }, ['200 OK', 'ok']), panel('Phases', [['status', 200, 'ok']]));
  } else {
    f.add('access finds no Authorization header and calls ngx.exit(401). The request ends right here.', scene('return ngx.exit(401)', { rewrite: ['ok', 'done'], access: ['fail', 'exit(401)'] }, ['401 Unauthorized', 'fail']), panel('Phases', [['auth', 'missing', 'fail']]));
    f.add('content is skipped entirely: no upstream call, no body work. Rejecting early is what the access phase is for.', scene('-- content_by_lua never runs', { rewrite: ['ok', 'done'], access: ['fail', 'exit(401)'], content: ['visited', 'skipped'] }, ['401 Unauthorized', 'fail']), panel('Phases', [['content', 'skipped', 'ok']]));
  }
  f.add('log runs after the response is sent, whatever the outcome, so metrics and logging never delay the client.', scene('log_by_lua_block { metrics.observe(…) }', { rewrite: ['ok', 'done'], access: auth ? ['ok', 'allowed'] : ['fail', 'exit(401)'], content: auth ? ['ok', '200 body'] : ['visited', 'skipped'], log: ['ok', 'after send'] }, [auth ? '200 OK' : '401 Unauthorized', auth ? 'ok' : 'fail']), panel('Phases', [['log', 'always runs', 'ok']]));
  return f.frames;
}

function cosocket(p: P): Frame[] {
  const co = pick(p.sock, ['cosocket', 'blocking'], 'cosocket') === 'cosocket';
  const f = new Film();
  const T0 = 200;
  const tx = (ms: number) => T0 + ms * 7;
  const scene = (stmt: string, upto: number): Shape[] => {
    const out: Shape[] = [...cap(stmt), text('w1', 40, 200, 'worker 1', { align: 'left', size: 24, bold: true, tone: 'muted' }), text('ax', T0, 150, '0 ms', { size: 20, tone: 'muted' }), text('ax2', tx(100), 150, '100 ms', { size: 20, tone: 'muted' })];
    const seg = (id: string, a: number, b: number, y: number, label: string, tone: Tone) => (upto >= a ? [box(id, tx(a), y, Math.max(8, tx(Math.min(b, upto)) - tx(a)), 70, Math.min(b, upto) - a > 12 ? label : undefined, { mono: true, tone })] : []);
    if (co) {
      out.push(...seg('r1a', 0, 2, 165, 'req1', 'accent'), ...seg('r1w', 2, 50, 245, 'req1 waits on auth (yielded)', 'muted'), ...seg('r2', 2, 12, 165, 'req2', 'protocol'), ...seg('r3', 12, 22, 165, 'req3', 'ok'), ...seg('r1b', 50, 52, 165, 'req1', 'accent'));
    } else {
      out.push(...seg('r1a', 0, 2, 165, 'req1', 'accent'), ...seg('blk', 2, 50, 165, 'blocked in recv()', 'fail'), ...seg('r1b', 50, 52, 165, 'req1', 'accent'), ...seg('r2', 52, 62, 165, 'req2', 'protocol'), ...seg('r3', 62, 72, 165, 'req3', 'ok'));
      if (upto >= 2) out.push(box('queue', 40, 380, 600, 80, upto < 52 ? 'req2, req3 waiting in the accept queue' : 'queue drained', { mono: true, tone: upto < 52 ? 'warn' : 'muted' }));
    }
    return out;
  };
  f.add('Request 1 runs in a Lua coroutine on worker 1 and needs a 48 ms call to the auth service.', scene('local sock = ngx.socket.tcp()', 2), panel('Worker', [['in flight', 1]]));
  f.add(co ? 'sock:connect and sock:receive register with epoll and yield. The worker is free at once and runs requests 2 and 3.' : 'A blocking socket library waits inside recv(). The whole worker, with every request it could serve, is stuck.', scene(co ? 'sock:receive()   -- yields' : 'socket.tcp():receive()   -- blocks', 30), panel('Worker', [['served while waiting', co ? 2 : 0, co ? 'ok' : 'fail']]));
  f.add(co ? 'When auth replies, epoll wakes worker 1 and req1 resumes exactly where it left off.' : 'Only when auth answers can the worker finish req1 and get to the others, 50 ms late.', scene('ngx.say(line)', 80), panel('Worker', [['req2 latency', co ? '10 ms' : '60 ms', co ? 'ok' : 'fail']]));
  f.add(co ? 'setkeepalive returns the connection to a pool for the next request. Code reads sequentially but never blocks the worker.' : 'Never use blocking I/O in OpenResty: use ngx.socket.tcp (cosockets) or resty.* libraries built on it.', scene(co ? 'sock:setkeepalive(10000, 32)' : '-- use ngx.socket.tcp()', 80), panel('Worker', [['model', co ? 'event loop + coroutines' : 'blocked', co ? 'ok' : 'fail']]));
  return f.frames;
}

function shdict(p: P): Frame[] {
  const shared = pick(p.store, ['shared', 'local'], 'shared') === 'shared';
  const f = new Film();
  const W = 4;
  const counts = [0, 0, 0, 0];
  let total = 0;
  let rejected = 0;
  const scene = (stmt: string, hot?: number): Shape[] => {
    const out: Shape[] = [...cap(stmt)];
    for (let w = 0; w < W; w++) out.push(box(`w${w}`, 40 + w * 235, 130, 215, 150, `worker ${w + 1}`, { sub: shared ? 'private Lua VM' : `table: ${counts[w]}`, mono: true, tone: w === hot ? 'current' : shared ? 'default' : counts[w] > 10 ? 'fail' : 'accent' }));
    if (shared) {
      out.push(box('dict', 40, 380, 920, 120, `ngx.shared.limits["1.2.3.4"] = ${total}`, { sub: 'one memory zone for all workers', mono: true, tone: total > 10 ? 'fail' : 'accent' }));
      for (let w = 0; w < W; w++) out.push(arrow(`a${w}`, 147 + w * 235, 282, 147 + w * 235, 378, w === hot ? 'current' : 'muted', { width: 3 }));
    }
    out.push(box('res', 40, 600, 920, 90, `requests: ${total}  ·  rejected with 429: ${rejected}`, { mono: true, tone: rejected ? 'ok' : total > 10 ? 'fail' : 'default' }));
    return out;
  };
  f.add(shared ? 'Four workers, each with its own Lua VM, share one memory zone declared with lua_shared_dict.' : 'Four workers, each with its own Lua VM, each counting in a plain Lua table. Nothing is shared between them.', scene(shared ? 'lua_shared_dict limits 10m;' : 'local counts = {}   -- module-level table'), panel('Rate limit', [['limit', '10 / s per IP']]));
  for (let r = 1; r <= 16; r++) {
    const w = (r - 1) % W;
    total++;
    counts[w]++;
    const n = shared ? total : counts[w];
    if (n > 10) rejected++;
    if (r === 1 || r === 2 || r === 11 || r === 16) f.add(r === 1 ? 'The first request from 1.2.3.4 lands on worker 1, which increments the counter.' : r === 2 ? `The next lands on worker 2. ${shared ? 'It sees the same counter: 2.' : 'Its own table says 1: it has no idea about worker 1.'}` : r === 11 ? (shared ? 'Request 11 pushes the shared counter over 10, so it gets 429 before reaching the upstream.' : 'Request 11 arrives, but no worker’s own count is over 10 (they are near 3 each), so it is let through.') : shared ? `By request 16, six were rejected: the limit holds across workers.` : `16 requests, none rejected: the real limit is 4 × 10 = 40. A per-worker counter divides your limit by nothing.`, scene(shared ? `local n = d:incr(ip, 1, 0, 1)  -- ${n}` : `counts[ip] = (counts[ip] or 0) + 1  -- ${n}`, w), panel('Rate limit', [['requests', total], ['rejected', rejected, rejected ? 'ok' : r > 10 ? 'fail' : 'default']]));
  }
  return f.frames;
}

liveDemo(
  'nginx-lua',
  'nginx + Lua (OpenResty)',
  'Lua hooked into request phases (drop the auth header to stop at access), a cosocket yielding where a blocking socket freezes the worker, and a rate limit that only holds when the counter is shared.',
  {
    phases: ['Request phases', phases],
    cosocket: ['Cosockets', cosocket],
    shdict: ['Shared dict', shdict],
  },
  [
    choice('auth', 'Authorization header', ['yes', 'no'], 'yes', { for: ['phases'], labels: ['sent', 'missing'] }),
    choice('sock', 'socket', ['cosocket', 'blocking'], 'cosocket', { for: ['cosocket'], labels: ['ngx.socket.tcp', 'blocking library'] }),
    choice('store', 'counter in', ['shared', 'local'], 'shared', { for: ['shdict'], labels: ['lua_shared_dict', 'per-worker table'] }),
  ],
  {
    ph1: D('access_by_lua', 'Runs before content; the place for auth, rate limits and IP rules. ngx.exit ends the request early.', 'access_by_lua_block {\n  if not ok then return ngx.exit(403) end\n}'),
    r1w: D('Cosocket', 'A non-blocking socket: on I/O the coroutine yields to nginx’s event loop and resumes on readiness.'),
    blk: D('Blocking call', 'One blocked worker stalls every connection it owns. OpenResty has a few workers, not a thread per request.'),
    dict: D('lua_shared_dict', 'A shared-memory zone with atomic incr, visible to every worker. Lost on restart; not shared across machines.', 'lua_shared_dict limits 10m;\nlocal d = ngx.shared.limits\nd:incr(key, 1, 0, 1)  -- init 0, ttl 1 s'),
    w0: D('Worker', 'An nginx worker process with its own Lua VM. Module-level Lua tables live per worker.'),
  },
);

// ---------------- Redis Lua ----------------
function atomic(p: P): Frame[] {
  const script = pick(p.how, ['script', 'two'], 'script') === 'script';
  const f = new Film();
  const lane = (id: string, x: number, label: string, tone: Tone): Shape => box(id, x, 120, 260, 70, label, { mono: true, tone });
  const ev = (id: string, x: number, y: number, label: string, tone: Tone): Shape => box(id, x, y, 260, 70, label, { mono: true, tone });
  const lanes = [lane('A', 40, 'client A', 'accent'), lane('R', 370, 'redis (one thread)', 'muted'), lane('B', 700, 'client B', 'protocol')];
  const key = (v: string, tone: Tone): Shape => box('key', 370, 830, 590, 90, `lock:order-7 = ${v}`, { mono: true, tone });
  f.add('Client A holds the lock (value token-A) and its lease is about to expire. It wants to release only if it still owns it.', [...cap('GET → compare → DEL'), ...lanes, key('token-A', 'accent')], panel('Lock release', [['owner', 'A']]));
  if (!script) {
    f.add('A sends GET and sees token-A: still mine.', [...cap('GET lock:order-7  → token-A'), ...lanes, ev('e1', 370, 230, 'GET → token-A', 'accent'), key('token-A', 'accent')], panel('Lock release', [['A thinks', 'I own it']]));
    f.add('Between A’s GET and DEL the lease expires and B acquires the lock. Separate commands can interleave.', [...cap('SET lock:order-7 token-B NX PX 30000'), ...lanes, ev('e1', 370, 230, 'GET → token-A', 'accent'), ev('e2', 370, 330, 'SET token-B (B)', 'protocol'), key('token-B', 'protocol')], panel('Lock release', [['owner', 'B', 'warn']]));
    f.add('A’s DEL now deletes B’s lock. B believes it holds a lock that no longer exists, and a third client can take it.', [...cap('DEL lock:order-7'), ...lanes, ev('e1', 370, 230, 'GET → token-A', 'accent'), ev('e2', 370, 330, 'SET token-B (B)', 'protocol'), ev('e3', 370, 430, 'DEL (A) ← wrong lock', 'fail'), key('(deleted)', 'fail')], panel('Lock release', [['B’s lock', 'deleted by A', 'fail']]));
  } else {
    f.add('A sends one EVAL. Redis runs the whole script on its single thread: no other command can run in between.', [...cap('EVAL <script> 1 lock:order-7 token-A'), ...lanes, box('blk', 370, 230, 260, 270, 'script: GET, compare, DEL', { sub: 'atomic', mono: true, tone: 'accent' }), key('token-A', 'accent')], panel('Lock release', [['interleaving', 'impossible', 'ok']]));
    f.add('B’s SET arrives meanwhile but has to wait until the script returns. GET matched token-A, so DEL removes A’s own lock.', [...cap('if redis.call("GET", KEYS[1]) == ARGV[1] then DEL'), ...lanes, box('blk', 370, 230, 260, 270, 'script: GET, compare, DEL', { sub: 'returns 1', mono: true, tone: 'ok' }), ev('e2', 370, 530, 'SET token-B (B)', 'protocol'), key('(deleted by A)', 'ok')], panel('Lock release', [['A released', 'its own lock', 'ok']]));
    f.add('Then B gets the lock cleanly. A long script blocks every client, so keep scripts short.', [...cap('SET lock:order-7 token-B NX PX 30000  → OK'), ...lanes, box('blk', 370, 230, 260, 270, 'script: GET, compare, DEL', { sub: 'done', mono: true, tone: 'ok' }), ev('e2', 370, 530, 'SET token-B (B)', 'protocol'), key('token-B', 'protocol')], panel('Lock release', [['owner', 'B', 'ok']]));
  }
  return f.frames;
}

function evalsha(p: P): Frame[] {
  const restart = pick(p.ev, ['restart', 'none'], 'restart') === 'restart';
  const f = new Film();
  const cache = (has: boolean, tone: Tone = 'accent'): Shape => box('cache', 560, 160, 400, 120, has ? 'script cache: 5332… → INCR' : 'script cache: (empty)', { mono: true, tone: has ? tone : 'fail', dashed: !has });
  const call = (id: string, y: number, label: string, tone: Tone): Shape => box(id, 40, y, 480, 80, label, { mono: true, tone });
  f.add('SCRIPT LOAD compiles the script once and returns its SHA1.', [...cap('SCRIPT LOAD "return redis.call(\'INCR\', KEYS[1])"'), cache(true, 'write'), call('c0', 160, 'SCRIPT LOAD → 5332…', 'accent')], panel('EVALSHA', [['cached', 1]]));
  f.add('Later calls send only the 40-byte hash instead of the script body.', [...cap('EVALSHA 5332… 1 hits'), cache(true, 'ok'), call('c0', 160, 'SCRIPT LOAD → 5332…', 'accent'), call('c1', 270, 'EVALSHA 5332… → 1', 'ok'), call('c2', 380, 'EVALSHA 5332… → 2', 'ok')], panel('EVALSHA', [['bytes per call', 'hash only', 'ok']]));
  if (restart) {
    f.add('The server restarts (or fails over). The script cache is not persisted, so it comes back empty.', [...cap('-- restart / failover'), cache(false), call('c1', 270, 'EVALSHA 5332… → 1', 'ok'), call('c2', 380, 'EVALSHA 5332… → 2', 'ok')], panel('EVALSHA', [['cached', 0, 'fail']]));
    f.add('The next EVALSHA gets NOSCRIPT. Good clients catch it and resend the full script with EVAL, which caches it again.', [...cap('EVALSHA 5332…  → NOSCRIPT;  EVAL <script> …'), cache(true, 'write'), call('c3', 490, 'EVALSHA → NOSCRIPT', 'fail'), call('c4', 600, 'EVAL <full script> → 3', 'ok')], panel('EVALSHA', [['fallback', 'EVAL', 'ok']]));
  } else f.add('As long as the server keeps running the cache holds, and every call ships only the hash.', [...cap('EVALSHA 5332… 1 hits'), cache(true, 'ok'), call('c1', 270, 'EVALSHA 5332… → 1', 'ok'), call('c2', 380, 'EVALSHA 5332… → 2', 'ok'), call('c3', 490, 'EVALSHA 5332… → 3', 'ok')], panel('EVALSHA', [['NOSCRIPT', 'never seen yet', 'warn']]));
  f.add('Redis 7 functions (FUNCTION LOAD, FCALL) are stored with the data and replicated, so they survive restarts.', [...cap('FUNCTION LOAD … ;  FCALL incr_hits 1 hits'), cache(true, 'ok')], panel('EVALSHA', [['Redis 7', 'functions', 'ok']]));
  return f.frames;
}

/** Redis Cluster key slot: CRC16/XMODEM of the hash tag (or whole key) mod 16384 */
function crc(s: string): number {
  const m = s.match(/\{([^}]+)\}/);
  let c = 0;
  for (const ch of m ? m[1] : s) {
    c ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c % 16384;
}

function cluster(p: P): Frame[] {
  const tagged = pick(p.keys, ['tagged', 'plain'], 'tagged') === 'tagged';
  const keys = tagged ? ['{user:7}:balance', '{user:7}:log'] : ['user:7:balance', 'user:7:log'];
  const slots = keys.map(crc);
  const node = (s: number) => Math.floor(s / 5462);
  const f = new Film();
  const nodes = ['A · 0–5460', 'B · 5461–10922', 'C · 10923–16383'];
  const scene = (stmt: string, o: { route?: boolean; run?: boolean; err?: boolean } = {}): Shape[] => {
    const out: Shape[] = [...cap(stmt)];
    nodes.forEach((n, i) => out.push(box(`n${i}`, 40 + i * 315, 520, 290, 120, `node ${n}`, { mono: true, tone: o.route && slots.some((s) => node(s) === i) ? (o.err ? 'warn' : 'accent') : 'muted' })));
    keys.forEach((k, j) => {
      out.push(box(`k${j}`, 40 + j * 470, 140, 450, 110, k, { sub: o.route ? `slot ${slots[j]}` : 'KEYS[' + (j + 1) + ']', mono: true, tone: 'protocol' }));
      if (o.route) out.push(arrow(`r${j}`, 265 + j * 470, 252, 185 + node(slots[j]) * 315, 516, o.err ? 'warn' : 'accent', { width: 3 }));
    });
    if (o.run) out.push(box('res', 40, 760, 920, 90, o.err ? '(error) CROSSSLOT Keys in request don’t hash to the same slot' : 'read, check and write both keys atomically on one node', { mono: true, tone: o.err ? 'fail' : 'ok' }));
    return out;
  };
  const same = slots[0] === slots[1];
  f.add('The script declares the two keys it touches in KEYS. In Cluster that is how Redis knows where to run it.', scene(`EVAL <script> 2 ${keys.join(' ')} 50`), panel('Cluster', [['keys', 2]]));
  f.add(tagged ? 'Only the part inside {…} is hashed, so both keys share the tag user:7 and land in the same slot.' : 'Each whole key name is hashed, so the two keys get different slots, possibly on different nodes.', scene('CRC16(key) mod 16384', { route: true, err: !same }), panel('Cluster', [['slots', same ? `${slots[0]} (same)` : `${slots[0]} vs ${slots[1]}`, same ? 'ok' : 'warn']]));
  const sameNode = node(slots[0]) === node(slots[1]);
  f.add(same ? 'One node owns both keys, so the script runs there atomically.' : sameNode ? 'Both slots happen to live on one node today, but the rule is per slot (slots move during resharding), so Redis rejects it with CROSSSLOT.' : 'A script must run on one node, so Redis rejects it with CROSSSLOT before running anything.', scene(same ? `node ${'ABC'[node(slots[0])]} runs the script` : '-- rejected', { route: true, run: true, err: !same }), panel('Cluster', [['result', same ? 'ok' : 'CROSSSLOT', same ? 'ok' : 'fail']]));
  f.add('Design keys that change together with a shared hash tag. Too many keys under one tag, though, makes one hot slot.', scene('{user:7}:balance  {user:7}:log', { route: true, run: true, err: !same }), panel('Cluster', [['rule', 'one slot per script', 'ok']]));
  return f.frames;
}

liveDemo(
  'redis-lua',
  'Redis Lua scripts',
  'A lock release that races when split into GET and DEL but not as one script, EVALSHA losing its cache on restart, and Cluster routing a script by its keys’ hash slots.',
  {
    atomic: ['Atomic scripts', atomic],
    evalsha: ['EVALSHA & caching', evalsha],
    cluster: ['Scripts in Cluster', cluster],
  },
  [
    choice('how', 'release with', ['script', 'two'], 'script', { for: ['atomic'], labels: ['one EVAL', 'GET then DEL'] }),
    choice('ev', 'server', ['restart', 'none'], 'restart', { for: ['evalsha'], labels: ['restarts', 'keeps running'] }),
    choice('keys', 'key names', ['tagged', 'plain'], 'tagged', { for: ['cluster'], labels: ['{user:7}:…', 'user:7:…'] }),
  ],
  {
    key: D('Lock key', 'SET key token NX PX 30000 acquires; only the holder of the token may release.'),
    blk: D('Atomic script', 'Redis is single-threaded: a script runs start to finish with nothing in between, like a transaction with logic.'),
    cache: D('Script cache', 'Per-server and in memory. Lost on restart or failover, hence NOSCRIPT and the EVAL fallback.'),
    k0: D('Hash tag', 'Only the part between { and } is hashed, so related keys can be forced into one slot.', '{user:7}:balance\n{user:7}:log   -- same slot'),
  },
);
