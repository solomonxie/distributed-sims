// Lua embedded in servers (group lang-lua): OpenResty request phases, cosockets, shared dicts; Redis EVAL atomicity, script cache, cluster keys.
import type { Detail } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'lang-lua';
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

// ---------------- nginx + Lua (OpenResty) ----------------
traceDemo('nginx-lua', 'nginx + Lua (OpenResty)', 'Lua hooks into request phases, cosockets yield instead of blocking the worker, and lua_shared_dict shares state across workers.', {
  phases: [
    'Request phases',
    {
      codeTitle: 'nginx.conf',
      code: ['location /api {', '  rewrite_by_lua_block { ngx.req.set_uri("/v2" .. ngx.var.uri) }', '  access_by_lua_block  {', '    if not ngx.var.http_authorization then return ngx.exit(401) end', '  }', '  content_by_lua_block { ngx.say("hello") }', '  log_by_lua_block     { ngx.log(ngx.INFO, ngx.var.status) }', '}'],
      stackTitle: 'phase',
      details: {
        access: D('access_by_lua', 'Runs before content for every request: auth, IP rules, rate limits. ngx.exit stops the request here.'),
        content: D('content_by_lua', 'Generates the response in Lua instead of proxying or serving a file.', 'content_by_lua_block {\n  ngx.header["Content-Type"] = "application/json"\n  ngx.say(cjson.encode({ ok = true }))\n}'),
      },
      steps: [
        { note: 'The Lua module runs a Lua VM inside every worker. Each block hooks one request phase.', line: 0, vars: [['request', 'GET /api/users', 'current']], out: '' },
        { note: 'rewrite runs first and changes the URI.', line: 1, vars: [['request', 'GET /v2/api/users'], ['rewrite', 'uri rewritten', 'ok']], out: '' },
        { note: 'access checks the Authorization header. Without it the request ends with 401.', line: [2, 3], vars: [['request', 'GET /v2/api/users'], ['rewrite', 'done'], ['access', 'token present', 'ok']], out: '' },
        { note: 'content writes the body, then log runs after the response is sent.', line: [5, 6], vars: [['rewrite', 'done'], ['access', 'done'], ['content', 'hello', 'ok'], ['log', 'status 200', 'read']], out: 'HTTP/1.1 200\nhello' },
      ],
    },
  ],
  cosocket: [
    'Cosockets',
    {
      codeTitle: 'nginx.conf',
      code: ['content_by_lua_block {', '  local sock = ngx.socket.tcp()', '  sock:connect("auth", 9000)      -- yields', '  local line = sock:receive()     -- yields', '  sock:setkeepalive(10000, 32)', '  ngx.say(line)', '}'],
      stackTitle: 'worker 1',
      details: {
        req1: D('Coroutine per request', 'Each request’s Lua runs in its own coroutine. I/O parks it and hands the worker back to the event loop.'),
        loop: D('Never block', 'os.execute, io.popen or LuaSocket block the whole worker. Use ngx.socket, ngx.timer and the lua-resty-* libraries.', 'local redis = require "resty.redis"\nlocal r = redis:new()\nr:connect("127.0.0.1", 6379) -- non-blocking'),
      },
      steps: [
        { note: 'Request 1 runs in a Lua coroutine on worker 1.', line: [0, 1], vars: [['req1', 'running', 'current'], ['req2', 'waiting'], ['loop', 'busy with req1', 'write']], out: '' },
        { note: 'connect() registers the socket with epoll and yields. The worker is free again.', line: 2, vars: [['req1', 'parked on connect', 'muted'], ['req2', 'running', 'current'], ['loop', 'serving req2', 'ok']], out: '' },
        { note: 'When auth replies, epoll wakes worker 1 and it resumes req1 where it left off.', line: 3, vars: [['req1', 'resumed', 'current'], ['req2', 'done', 'ok'], ['loop', 'serving req1', 'ok']], out: '' },
        { note: 'setkeepalive returns the connection to a pool for the next request. Code reads sequential but never blocks.', line: [4, 5], vars: [['req1', 'done', 'ok'], ['req2', 'done', 'ok'], ['loop', 'idle', 'read']], out: 'user=alice' },
      ],
    },
  ],
  shdict: [
    'Shared dict',
    {
      codeTitle: 'nginx.conf',
      code: ['lua_shared_dict limits 10m;', 'access_by_lua_block {', '  local d = ngx.shared.limits', '  local n = d:incr(ngx.var.remote_addr, 1, 0, 1)  -- ttl 1s', '  if n > 10 then return ngx.exit(429) end', '}'],
      stackTitle: 'workers',
      heapTitle: 'shared memory',
      details: {
        limits: D('lua_shared_dict', 'A key-value zone in shared memory, visible to every worker. Updates take a short lock and are atomic.'),
        w1: D('Why not a Lua table', 'Each worker has its own Lua VM, so a plain table only counts that worker’s traffic.', 'local counts = {}  -- per worker: wrong for rate limits'),
      },
      steps: [
        { note: 'Four workers, each with a private Lua VM, share one memory zone.', line: 0, vars: [['w1', 'Lua VM', 'default', 'limits'], ['w2', 'Lua VM', 'default', 'limits']], heap: [['limits', '{}', 'read', '10 MB zone']], out: '' },
        { note: 'Worker 1 handles a request from 1.2.3.4 and increments its counter.', line: 3, vars: [['w1', 'incr → 1', 'write', 'limits'], ['w2', 'Lua VM', 'default', 'limits']], heap: [['limits', '1.2.3.4 = 1', 'write', 'ttl 1s']], out: '' },
        { note: 'Worker 2 sees the same counter, so the limit holds across workers.', line: 3, vars: [['w1', 'Lua VM', 'default', 'limits'], ['w2', 'incr → 11', 'write', 'limits']], heap: [['limits', '1.2.3.4 = 11', 'write', 'ttl 1s']], out: '' },
        { note: 'Over 10 in one second, so the request gets 429 before reaching the upstream.', line: 4, vars: [['w1', 'Lua VM', 'default', 'limits'], ['w2', '429', 'fail', 'limits']], heap: [['limits', '1.2.3.4 = 11', 'warn']], out: 'HTTP/1.1 429 Too Many Requests' },
      ],
    },
  ],
});

// ---------------- Redis + Lua ----------------
traceDemo('redis-lua', 'Redis Lua scripts', 'EVAL runs a script atomically on the single thread, EVALSHA reuses cached scripts, and keys must be declared for Cluster.', {
  atomic: [
    'Atomic check-and-set',
    {
      codeTitle: 'unlock.lua',
      code: ['-- release a lock only if we still own it', 'if redis.call("GET", KEYS[1]) == ARGV[1] then', '  return redis.call("DEL", KEYS[1])', 'end', 'return 0', '', 'EVAL <script> 1 lock:order-7 token-A'],
      stackTitle: 'redis thread',
      heapTitle: 'keyspace',
      details: {
        race: D('Race without Lua', 'GET then DEL from the client are two round trips. The lock can expire and be taken by B in between, and A deletes B’s lock.'),
        script: D('Atomic script', 'The whole script runs as one command. No other client’s command can run in the middle.', "redis.call('INCR', KEYS[1])\nredis.call('EXPIRE', KEYS[1], ARGV[1])"),
      },
      steps: [
        { note: 'Client A holds the lock with token-A and wants to release it.', line: 6, vars: [['script', 'queued', 'current']], heap: [['lock', 'lock:order-7 = token-A', 'read', 'ttl 3s']], out: '' },
        { note: 'Without a script, B could grab the lock between A’s GET and DEL.', line: 0, vars: [['race', 'GET … DEL', 'warn']], heap: [['lock', 'lock:order-7 = token-A', 'read']], out: '' },
        { note: 'In the script, GET matches token-A. No other command can interleave.', line: 1, vars: [['script', 'running', 'current'], ['others', 'wait', 'muted']], heap: [['lock', 'lock:order-7 = token-A', 'read']], out: '' },
        { note: 'DEL runs in the same atomic step and the script returns 1.', line: 2, vars: [['script', 'done', 'ok'], ['others', 'run', 'ok']], heap: [['lock', 'deleted', 'visited']], out: '(integer) 1' },
      ],
    },
  ],
  evalsha: [
    'EVALSHA & FUNCTION',
    {
      codeTitle: 'redis-cli',
      code: ['SCRIPT LOAD "return redis.call(\'INCR\', KEYS[1])"', 'EVALSHA 5332… 1 hits', 'EVALSHA 5332… 1 hits', '-- after restart or failover:', 'EVALSHA 5332… 1 hits   -- NOSCRIPT'],
      stackTitle: 'client',
      heapTitle: 'script cache',
      details: {
        sha: D('Script cache', 'Scripts are cached by SHA1 so clients send 40 bytes instead of the whole body. The cache is not persisted.'),
        fn: D('Functions (Redis 7)', 'FUNCTION LOAD stores named functions that are persisted and replicated, so they survive restarts.', "#!lua name=mylib\nredis.register_function('hit', function(keys)\n  return redis.call('INCR', keys[1])\nend)\n-- FCALL hit 1 hits"),
      },
      steps: [
        { note: 'SCRIPT LOAD compiles the script once and returns its SHA1.', line: 0, vars: [['sha', '5332…', 'write', 'c']], heap: [['c', '5332… → INCR script', 'write']], out: '"5332…"' },
        { note: 'Later calls send only the hash.', line: [1, 2], vars: [['sha', '5332…', 'default', 'c']], heap: [['c', '5332… → INCR script', 'read']], out: '"5332…"\n(integer) 1\n(integer) 2' },
        { note: 'The cache is lost on restart, so EVALSHA fails. Clients retry with EVAL.', line: 4, vars: [['sha', '5332…', 'fail']], heap: [['c', 'empty', 'visited', 'after restart']], out: '"5332…"\n(integer) 1\n(integer) 2\n(error) NOSCRIPT' },
        { note: 'Redis 7 functions are stored with the data and replicated, which avoids this.', line: 4, vars: [['fn', 'FCALL hit 1 hits', 'ok']], heap: [['c', 'mylib.hit', 'ok', 'persisted']], out: '(integer) 3' },
      ],
    },
  ],
  cluster: [
    'Keys & Cluster',
    {
      codeTitle: 'transfer.lua',
      code: ['-- EVAL <script> 2 {user:7}:balance {user:7}:log 50', 'local b = tonumber(redis.call("GET", KEYS[1]))', 'if b < tonumber(ARGV[1]) then return redis.error_reply("low") end', 'redis.call("DECRBY", KEYS[1], ARGV[1])', 'redis.call("RPUSH", KEYS[2], "-" .. ARGV[1])'],
      stackTitle: 'routing',
      details: {
        keys: D('Declare keys', 'Every key a script touches must be passed in KEYS so Redis can route it and check it lives on this node.'),
        tag: D('Hash tags', 'Only the part inside {…} is hashed, so keys sharing a tag land in the same slot and one script can use them together.', 'CLUSTER KEYSLOT {user:7}:balance\nCLUSTER KEYSLOT {user:7}:log  -- same slot'),
      },
      steps: [
        { note: 'The script declares two keys. Cluster routes by their hash slots.', line: 0, vars: [['keys', 'balance, log', 'current']], out: '' },
        { note: 'Both share the tag {user:7}, so both hash to slot 1234 on one node.', line: 0, vars: [['keys', 'balance, log'], ['tag', 'slot 1234 · node B', 'ok']], out: '' },
        { note: 'The script reads, checks and writes both keys atomically on node B.', line: [1, 2, 3, 4], vars: [['tag', 'slot 1234 · node B'], ['balance', '100 → 50', 'write'], ['log', '[-50]', 'write']], out: 'OK' },
        { note: 'Keys in different slots would be rejected with CROSSSLOT.', line: 0, vars: [['tag', 'no shared tag', 'fail']], out: 'OK\n(error) CROSSSLOT Keys in request don’t hash to the same slot' },
      ],
    },
  ],
});
