// Network servers (group cpp-network): sockets, TCP streams & framing, HTTP, thread-per-connection, non-blocking I/O, epoll, backpressure, C10K.
import type { Detail, Frame, Tone } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { boardFrames, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'cpp-network';
const all = (ids: string[], tone: Tone) => Object.fromEntries(ids.map((id) => [id, tone]));
const each = (ids: string[], v: string) => Object.fromEntries(ids.map((id) => [id, v]));

const D: Record<string, Detail> = {
  client: { title: 'Client', text: 'Any program that connects: curl, a browser, nc, or a load generator. It calls connect() and the kernel runs the TCP handshake.', code: '$ nc localhost 9090\n$ curl -v http://localhost:9090/' },
  'socket()': { title: 'socket()', text: 'Asks the kernel for a new endpoint and returns a file descriptor, a small int indexing the process’s fd table.', code: 'int fd = socket(AF_INET, SOCK_STREAM, 0);\nif (fd < 0) perror("socket");' },
  'bind()': { title: 'bind()', text: 'Attaches the socket to a local address and port. Fails with EADDRINUSE if something else holds the port.', code: 'sockaddr_in a{};\na.sin_family = AF_INET;\na.sin_addr.s_addr = INADDR_ANY;\na.sin_port = htons(9090);\nbind(fd, (sockaddr*)&a, sizeof a);' },
  'listen()': { title: 'listen()', text: 'Marks the socket passive. The kernel now completes handshakes on its own and queues finished connections, up to the backlog.', code: 'listen(fd, SOMAXCONN);' },
  'accept()': { title: 'accept()', text: 'Takes one finished connection off the accept queue and returns a NEW fd for it. The listening fd stays open for more.', code: 'int c = accept(fd, nullptr, nullptr);\n// or: accept4(fd, 0, 0, SOCK_NONBLOCK | SOCK_CLOEXEC)' },
  'recv()': { title: 'recv()', text: 'Copies up to n bytes from the socket’s receive buffer. Returns bytes read, 0 when the peer closed, or -1 with errno.', code: 'char buf[4096];\nssize_t n = recv(c, buf, sizeof buf, 0);\nif (n == 0) close_conn();       // peer closed\nif (n < 0 && errno == EAGAIN) {} // no data yet' },
  'send()': { title: 'send()', text: 'Copies bytes into the kernel send buffer. It may accept fewer than you asked for, so always check the return value.', code: 'ssize_t n = send(c, p, len, MSG_NOSIGNAL);\nif (n > 0) { p += n; len -= n; }' },
  'close()': { title: 'close()', text: 'Releases the fd number and starts TCP teardown. Forgetting it leaks an fd per connection until ulimit -n is hit.', code: 'close(c);  // also removes it from epoll' },
  'fd table': { title: 'File descriptor table', text: 'Per-process array: 0 stdin, 1 stdout, 2 stderr, then files and sockets. Each connection costs one entry.', code: '$ ls -l /proc/$(pidof srv)/fd | wc -l\n$ ulimit -n        # max entries' },
  'listen fd 3': { title: 'Listening socket', text: 'Never carries data. It only produces new connected sockets via accept().', code: 'int lfd = socket(...); bind(...); listen(lfd, 511);' },
  'conn fd 4': { title: 'Connected socket', text: 'One per client. Has its own receive and send buffers in the kernel.', code: 'int c = accept(lfd, nullptr, nullptr);  // 4' },
  'SYN queue': { title: 'SYN queue', text: 'Half-open connections: SYN received, SYN-ACK sent, waiting for the final ACK.', code: '$ sysctl net.ipv4.tcp_max_syn_backlog' },
  'accept queue': { title: 'Accept queue', text: 'Completed handshakes waiting for accept(). Its size is min(backlog, somaxconn); when full, new connections are dropped.', code: 'listen(fd, 4096);\n$ sysctl -w net.core.somaxconn=4096\n$ ss -lnt   # Recv-Q = queued, Send-Q = limit' },
  'recv buffer': { title: 'Socket receive buffer', text: 'Kernel memory where arriving bytes wait for recv(). TCP advertises its free space to the sender as the window.', code: '$ sysctl net.ipv4.tcp_rmem\nsetsockopt(fd, SOL_SOCKET, SO_RCVBUF, &n, sizeof n);' },
  'send buffer': { title: 'Socket send buffer', text: 'Bytes accepted by send() but not yet acknowledged by the peer. When full, send() blocks or returns EAGAIN.', code: '$ sysctl net.ipv4.tcp_wmem' },
  'app buffer': { title: 'Application buffer', text: 'Your per-connection std::string or vector that accumulates bytes until a full message is parsed.', code: 'std::string in;\nin.append(buf, n);\nwhile (auto msg = parse(in)) handle(*msg);' },
  parser: { title: 'Framing parser', text: 'Finds message boundaries in the byte stream: a length prefix, or a delimiter like \\r\\n\\r\\n for HTTP headers.', code: 'std::optional<Msg> parse(std::string& in) {\n  if (in.size() < 4) return {};\n  uint32_t len = read_be32(in.data());\n  if (in.size() < 4 + len) return {};\n  Msg m{in.substr(4, len)};\n  in.erase(0, 4 + len);\n  return m;\n}' },
  'request line': { title: 'Request line', text: 'METHOD SP PATH SP VERSION CRLF. The first line of every HTTP/1.1 request.', code: 'GET /index.html HTTP/1.1\\r\\n' },
  headers: { title: 'Headers', text: 'Name: value lines, ended by an empty line. Host is required in HTTP/1.1; Content-Length says how many body bytes follow.', code: 'Host: localhost:9090\\r\\n\nConnection: keep-alive\\r\\n\nContent-Length: 12\\r\\n\n\\r\\n' },
  body: { title: 'Body', text: 'Exactly Content-Length bytes (or chunked). You must keep reading until you have them all.', code: 'size_t need = std::stoul(h["content-length"]);\nwhile (body.size() < need) read_more();' },
  'status line': { title: 'Status line', text: 'VERSION SP CODE SP REASON CRLF, then headers, a blank line, and the body.', code: 'HTTP/1.1 200 OK\\r\\n\nContent-Type: text/html\\r\\n\nContent-Length: 13\\r\\n\n\\r\\n\n<h1>hi</h1>' },
  router: { title: 'Router', text: 'Maps method + path to a handler. A hash map covers exact paths; prefixes and params need a trie or ordered list.', code: 'std::unordered_map<std::string, Handler> routes{\n  {"GET /", home},\n  {"GET /health", health},\n};\nauto it = routes.find(req.method + " " + req.path);\nreturn it == routes.end() ? not_found() : it->second(req);' },
  handler: { title: 'Handler', text: 'A function from Request to Response. Keep it free of socket code so it is easy to test.', code: 'Response health(const Request&) {\n  return {200, "text/plain", "ok"};\n}' },
  'static files': { title: 'Static file handler', text: 'Maps the URL path under a root dir, rejects .. escapes, picks a Content-Type, and streams the file.', code: 'auto p = (root / req.path.substr(1)).lexically_normal();\nif (!p.string().starts_with(root.string()))\n  return {403};\nreturn file_response(p);' },
  'sendfile()': { title: 'sendfile()', text: 'Copies file → socket inside the kernel. No read() into user space, no second copy out.', code: 'off_t off = 0;\nwhile (off < size)\n  if (sendfile(c, filefd, &off, size - off) < 0) break;' },
  'thread per conn': { title: 'Thread per connection', text: 'Simple blocking code: each client gets a thread that reads, handles, writes. Fine for dozens of clients, not thousands.', code: 'for (;;) {\n  int c = accept(lfd, nullptr, nullptr);\n  std::thread([c] { serve(c); close(c); }).detach();\n}' },
  'O_NONBLOCK': { title: 'Non-blocking socket', text: 'recv/send/accept return -1 with EAGAIN instead of sleeping when they can’t make progress.', code: 'int fl = fcntl(fd, F_GETFL);\nfcntl(fd, F_SETFL, fl | O_NONBLOCK);' },
  epoll: { title: 'epoll instance', text: 'A kernel object holding the set of fds you care about and the list of ones that are ready. One per event loop.', code: 'int ep = epoll_create1(EPOLL_CLOEXEC);\nepoll_event ev{EPOLLIN, {.fd = lfd}};\nepoll_ctl(ep, EPOLL_CTL_ADD, lfd, &ev);' },
  'epoll_wait()': { title: 'epoll_wait()', text: 'Sleeps until at least one registered fd is ready, then returns only the ready ones. Cost scales with activity, not with connection count.', code: 'epoll_event evs[256];\nint n = epoll_wait(ep, evs, 256, -1);\nfor (int i = 0; i < n; ++i)\n  handle(evs[i].data.fd, evs[i].events);' },
  'event loop': { title: 'Event loop', text: 'One thread: wait for readiness, run the handler for each ready fd, never block. Every handler must return quickly.', code: 'for (;;) {\n  int n = epoll_wait(ep, evs, 256, -1);\n  for (int i = 0; i < n; ++i) {\n    auto* c = (Conn*)evs[i].data.ptr;\n    if (evs[i].events & EPOLLIN)  c->on_read();\n    if (evs[i].events & EPOLLOUT) c->on_write();\n  }\n}' },
  'ready list': { title: 'Ready list', text: 'Filled by the kernel as data arrives. epoll_wait copies it out; idle connections never appear here.', code: '// n = number of ready fds, often far fewer than open ones' },
  'Conn': { title: 'struct Conn', text: 'Per-connection state: fd, parse state, input buffer, output buffer with offset. This is the whole cost of an idle connection.', code: 'struct Conn {\n  int fd;\n  State st = State::ReadHeaders;\n  std::string in, out;\n  size_t out_off = 0;\n  Clock::time_point last_active;\n};' },
  'out buffer': { title: 'Outbound buffer', text: 'Bytes the kernel wouldn’t take yet. Flush on EPOLLOUT; cap its size so a slow reader can’t eat all memory.', code: 'if (c.out.size() - c.out_off > kMaxOut) {\n  close_conn(c);  // documented policy\n}' },
  signalfd: { title: 'Signal handling', text: 'Turn SIGTERM into a readable fd (signalfd, or a self-pipe) so the event loop handles shutdown like any other event.', code: 'sigset_t s; sigemptyset(&s);\nsigaddset(&s, SIGTERM); sigaddset(&s, SIGINT);\nsigprocmask(SIG_BLOCK, &s, nullptr);\nint sfd = signalfd(-1, &s, SFD_NONBLOCK);\n// add sfd to epoll' },
  'load generator': { title: 'Load generator', text: 'Runs on a separate machine so it doesn’t steal the server’s CPU. Opens thousands of connections and measures latency.', code: '$ wrk -t4 -c10000 -d60s --latency http://srv:9090/\n$ ulimit -n 65536  # on the client too' },
  metrics: { title: 'Server metrics', text: 'Expose connections, open fds, RSS and p99 latency so you can see limits before users do.', code: 'GET /metrics\nconns 10000\nfds 10004\nrss_mb 61\np99_ms 7.8' },
  'loop 0': { title: 'Event loop thread', text: 'Each loop owns its connections exclusively, so there is no locking on connection state.', code: 'std::vector<std::jthread> loops;\nfor (int i = 0; i < ncores; ++i)\n  loops.emplace_back([i] { run_loop(i); });' },
};

function demo(slug: string, title: string, summary: string, inputs: Record<string, [label: string, build: () => Frame[]]>) {
  machineDemo({
    slug,
    title,
    group: G,
    summary,
    inputs: Object.entries(inputs).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => inputs[k][1](),
    details: D,
  });
}
const B = (b: Board) => () => boardFrames(b);
const T = (t: Trace) => () => traceFrames(t);

// ---------------- sockets & fds ----------------
demo('net-socket', 'Sockets & file descriptors', 'socket → bind → listen → accept → recv/send → close; the fd table; SYN and accept queues.', {
  lifecycle: [
    'Server calls',
    B({
      panel: 'Socket',
      nodes: [
        N('s', 40, 40, 215, 110, 'socket()'),
        N('b', 275, 40, 215, 110, 'bind()', ':9090'),
        N('l', 510, 40, 215, 110, 'listen()'),
        N('a', 745, 40, 215, 110, 'accept()'),
        N('c', 745, 260, 215, 110, 'client'),
        N('r', 510, 260, 215, 110, 'recv()'),
        N('w', 275, 260, 215, 110, 'send()'),
        N('x', 40, 260, 215, 110, 'close()'),
        N('fd', 40, 480, 920, 110, 'fd table', '0 stdin · 1 stdout · 2 stderr'),
        N('lf', 40, 660, 440, 110, 'listen fd 3'),
        N('cf', 520, 660, 440, 110, 'conn fd 4'),
      ],
      edges: ['s>b', 'b>l', 'l>a', 'c>a', 'r>w', 'w>x'],
      beats: [
        { note: 'socket() creates an endpoint and returns the lowest free fd, 3.', hot: { s: 'current', lf: 'write' }, sub: { fd: '0 · 1 · 2 · 3' }, hide: ['cf', 'c', 'r', 'w', 'x'], rows: [['open fds', 4]] },
        { note: 'bind() claims port 9090, listen() tells the kernel to start queuing connections.', hot: { b: 'current', l: 'current', 's>b': 'accent', 'b>l': 'accent' }, sub: { fd: '0 · 1 · 2 · 3', lf: 'LISTEN :9090' }, hide: ['cf', 'c', 'r', 'w', 'x'], rows: [['state', 'LISTEN']] },
        { note: 'A client connects and accept() returns a new fd, 4, for that one conversation.', hot: { a: 'current', c: 'current', cf: 'write', 'c>a': 'accent' }, sub: { fd: '0 · 1 · 2 · 3 · 4', lf: 'LISTEN :9090', cf: 'ESTABLISHED' }, hide: ['r', 'w', 'x'], rows: [['open fds', 5]] },
        { note: 'recv() and send() on fd 4 move bytes; fd 3 keeps listening for the next client.', hot: { r: 'read', w: 'write', 'r>w': 'accent', cf: 'current' }, sub: { fd: '0 · 1 · 2 · 3 · 4', lf: 'LISTEN :9090', cf: 'ESTABLISHED' }, hide: ['x'], rows: [['data fd', 4]] },
        { note: 'close(4) frees the slot. Forget it and each client leaks an fd until accept() fails with EMFILE.', hot: { x: 'current', cf: 'visited', 'w>x': 'accent' }, sub: { fd: '0 · 1 · 2 · 3', lf: 'LISTEN :9090', cf: 'closed' }, rows: [['open fds', 4, 'ok']] },
      ],
    }),
  ],
  code: [
    'Minimal server code',
    T({
      codeTitle: 'srv_1_tcp.cpp',
      code: ['int lfd = socket(AF_INET, SOCK_STREAM, 0);', 'bind(lfd, (sockaddr*)&addr, sizeof addr);', 'listen(lfd, 16);', 'int c = accept(lfd, nullptr, nullptr);', 'char buf[2048];', 'ssize_t n = recv(c, buf, sizeof buf, 0);', 'std::string msg(buf, n);', 'send(c, reply.data(), reply.size(), 0);', 'close(c); close(lfd);'],
      stackTitle: 'variables',
      details: {
        lfd: D['listen fd 3'],
        c: D['conn fd 4'],
        n: D['recv()'],
        buf: { title: 'Receive buffer', text: 'A fixed stack array. recv fills at most sizeof buf bytes, and doesn’t null-terminate.', code: 'char buf[2048];\nstd::string s(buf, n);  // use n, not strlen' },
        out: { title: 'Server log', text: 'What the process prints. Run it and connect with nc localhost 9090.', code: '$ ./srv_1_tcp\n$ nc localhost 9090' },
      },
      steps: [
        { note: 'socket() returns fd 3.', line: 0, vars: [['lfd', '3', 'write']], out: 'Server FD: 3', rows: [['fds', 4]] },
        { note: 'bind and listen return 0 on success. Real code checks every return value.', line: [1, 2], vars: [['lfd', '3 (LISTEN)']], out: 'Server FD: 3\nbind: 0  listen: 0' },
        { note: 'accept() blocks until a client connects, then returns fd 4.', line: 3, vars: [['lfd', '3 (LISTEN)'], ['c', '4', 'write']], out: 'bind: 0  listen: 0\nAccepted client FD: 4', rows: [['fds', 5]] },
        { note: 'recv() blocks until bytes arrive and returns how many, here 6 for "hello\\n".', line: [4, 5, 6], vars: [['lfd', '3 (LISTEN)'], ['c', '4'], ['buf', '"hello\\n…"', 'read'], ['n', '6', 'write']], out: 'Accepted client FD: 4\nReceived: hello' },
        { note: 'send() echoes a reply and close() releases both fds.', line: [7, 8], vars: [['lfd', 'closed', 'visited'], ['c', 'closed', 'visited'], ['n', '6']], out: 'Received: hello\nSent bytes: 27', rows: [['fds', 3, 'ok']] },
      ],
    }),
  ],
  backlog: [
    'SYN & accept queues',
    B({
      panel: 'Backlog',
      nodes: [N('c', 40, 60, 920, 110, 'client', '10,000 connect() at once'), N('syn', 40, 300, 440, 130, 'SYN queue', 'handshake in progress'), N('acq', 520, 300, 440, 130, 'accept queue', 'backlog 16'), N('a', 520, 540, 440, 110, 'accept()', 'your loop'), N('res', 40, 760, 920, 130, 'result')],
      edges: ['c>syn', 'syn>acq', 'acq>a'],
      beats: [
        { note: 'The kernel runs the three-way handshake without your code.', hot: { syn: 'current', 'c>syn': 'accent' }, hide: ['res'], rows: [['handshakes', 'kernel']] },
        { note: 'Finished connections wait in the accept queue until you call accept().', hot: { acq: 'write', 'syn>acq': 'accent' }, sub: { acq: '16 / 16 full' }, hide: ['res'], rows: [['queued', 16]] },
        { note: 'With listen(fd, 16), a burst overflows the queue and extra connections are dropped or reset.', hot: { acq: 'fail', res: 'fail' }, sub: { acq: '16 / 16 full' }, label: { res: 'clients see timeouts and retries' }, rows: [['ListenOverflows', 'rising', 'fail']] },
        { note: 'Use listen(fd, SOMAXCONN), raise net.core.somaxconn, and accept in a loop until EAGAIN.', hot: { acq: 'ok', a: 'ok', res: 'ok' }, sub: { acq: 'backlog 4096' }, label: { res: 'burst absorbed' }, rows: [['check', 'ss -lnt, nstat'], ['backlog', 4096, 'ok']] },
      ],
    }),
  ],
});

// ---------------- TCP is a byte stream ----------------
const STREAM_NODES = [
  N('cl', 40, 60, 920, 110, 'client', 'send("PING") · send("PONG")'),
  N('rb', 40, 280, 920, 120, 'recv buffer', ''),
  N('app', 40, 480, 440, 120, 'app buffer', '""'),
  N('p', 520, 480, 440, 120, 'parser'),
  N('res', 40, 700, 920, 130, 'messages'),
];
demo('net-stream', 'TCP is a byte stream', 'No message boundaries: sends coalesce and split; length-prefix and delimiter framing with an accumulation buffer.', {
  coalesce: [
    'Sends coalesce',
    B({
      panel: 'Stream',
      nodes: STREAM_NODES,
      edges: ['cl>rb', 'rb>app', 'app>p'],
      beats: [
        { note: 'The client makes two send() calls, "PING" then "PONG".', hot: { cl: 'current' }, hide: ['app', 'p', 'res'], rows: [['sends', 2]] },
        { note: 'Both land in the receive buffer before the server reads. TCP keeps no boundary between them.', hot: { rb: 'write', 'cl>rb': 'accent' }, sub: { rb: 'PINGPONG' }, hide: ['app', 'p', 'res'], rows: [['bytes', 8]] },
        { note: 'One recv() returns all 8 bytes. Code that treats each recv as one message sees "PINGPONG".', hot: { rb: 'read', res: 'fail' }, sub: { rb: '' }, label: { res: 'got 1 message: "PINGPONG"' }, hide: ['app', 'p'], rows: [['recvs', 1], ['messages', 'wrong', 'fail']] },
      ],
    }),
  ],
  split: [
    'Messages split',
    B({
      panel: 'Stream',
      nodes: STREAM_NODES,
      edges: ['cl>rb', 'rb>app', 'app>p'],
      beats: [
        { note: 'Now the client sends one 6 KB HTTP request.', label: { cl: 'client' }, sub: { cl: 'send(request, 6144)' }, hot: { cl: 'current' }, hide: ['app', 'p', 'res'], rows: [['sent', '6144 B']] },
        { note: 'It arrives as several TCP segments. The first recv() returns what’s there so far, 2,896 bytes.', sub: { cl: 'send(request, 6144)', rb: '2896 B (2 segments)' }, hot: { rb: 'read' }, hide: ['p', 'res'], rows: [['recv 1', '2896 B']] },
        { note: 'Parsing that as a full request fails. The headers aren’t even complete yet.', sub: { cl: 'send(request, 6144)', app: 'GET /upload HTTP/1.1 …' }, hot: { app: 'fail', res: 'fail' }, label: { res: 'truncated request' }, hide: ['p'], rows: [['partial', 'yes', 'fail']] },
        { note: 'Short reads are normal, not errors. The next recv() brings the rest.', sub: { cl: 'send(request, 6144)', rb: '3248 B' }, hot: { rb: 'read', app: 'write' }, hide: ['p', 'res'], rows: [['recv 2', '3248 B']] },
      ],
    }),
  ],
  framing: [
    'Framing',
    B({
      panel: 'Framing',
      codeTitle: 'framing.cpp',
      code: ['in.append(buf, n);                 // accumulate', 'while (in.size() >= 4) {', '  uint32_t len = read_be32(in.data());', '  if (in.size() < 4 + len) break;    // wait for more', '  handle(in.substr(4, len)); in.erase(0, 4 + len); }'],
      nodes: [
        N('cl', 40, 250, 920, 100, 'client', '[4]PING [4]PONG'),
        N('rb', 40, 420, 920, 100, 'recv buffer', ''),
        N('app', 40, 600, 440, 110, 'app buffer', '""'),
        N('p', 520, 600, 440, 110, 'parser'),
        N('res', 40, 800, 920, 110, 'messages'),
      ],
      edges: ['cl>rb', 'rb>app', 'app>p'],
      beats: [
        { note: 'Fix: give messages a length prefix, and keep a per-connection buffer.', hl: [0], sub: { cl: '[4]PING [4]PONG', rb: '' }, hide: ['res'], rows: [['frame', 'u32 len + bytes']] },
        { note: 'Append whatever recv() returns. Here it’s one and a half frames.', hl: [0], hot: { app: 'write', rb: 'read' }, sub: { cl: '[4]PING [4]PONG', app: '[4]PING [4]PO' }, hide: ['res'], rows: [['buffered', '14 B']] },
        { note: 'Extract every complete frame, and stop at the partial one.', hl: [1, 2, 3, 4], hot: { p: 'current', 'app>p': 'accent', res: 'ok' }, sub: { cl: '[4]PING [4]PONG', app: '[4]PO' }, label: { res: '1 message: PING' }, rows: [['complete', 1, 'ok'], ['leftover', '6 B']] },
        { note: 'The next recv() completes PONG. HTTP does the same with \\r\\n\\r\\n and Content-Length.', hl: [0, 4], hot: { p: 'ok', res: 'ok' }, sub: { cl: '[4]PING [4]PONG', app: '""' }, label: { res: '2 messages: PING, PONG' }, rows: [['complete', 2, 'ok']] },
      ],
    }),
  ],
});

// ---------------- HTTP ----------------
demo('net-http', 'HTTP on raw sockets', 'Request and response anatomy, a request-line parser, a routing table, and serving static files safely.', {
  anatomy: [
    'Request & response',
    B({
      panel: 'HTTP',
      nodes: [N('rl', 40, 60, 920, 100, 'request line', 'GET /index.html HTTP/1.1'), N('h', 40, 190, 920, 130, 'headers', 'Host · Connection · Content-Length'), N('bd', 40, 350, 920, 90, 'body', '(none for GET)'), N('sl', 40, 520, 920, 100, 'status line', 'HTTP/1.1 200 OK'), N('rh', 40, 650, 920, 130, 'headers', 'Content-Type · Content-Length'), N('rb', 40, 810, 920, 100, 'body', '<h1>hi</h1>')],
      edges: [],
      beats: [
        { note: 'An HTTP/1.1 request is plain text: a request line, headers, a blank line, then an optional body.', hot: { rl: 'current' }, hide: ['sl', 'rh', 'rb'], rows: [['line ending', '\\r\\n']] },
        { note: 'Headers end at the first empty line, \\r\\n\\r\\n. That is how you know the head is complete.', hot: { h: 'current' }, hide: ['sl', 'rh', 'rb'], rows: [['end of head', '\\r\\n\\r\\n']] },
        { note: 'The response mirrors it, starting with a status line.', hot: { sl: 'current', rh: 'write', rb: 'write' }, rows: [['status', 200, 'ok']] },
        { note: 'Content-Length tells the client where the body ends, which lets the connection carry the next request.', hot: { rh: 'current', rb: 'ok' }, rows: [['keep-alive', 'needs length', 'ok']] },
      ],
    }),
  ],
  parse: [
    'Parsing',
    T({
      codeTitle: 'parse.cpp',
      code: ['auto end = raw.find("\\r\\n\\r\\n");', 'if (end == npos) return NeedMore;', 'std::istringstream s(raw.substr(0, end));', 's >> req.method >> req.path >> req.version;', 'for (std::string l; std::getline(s, l);)', '  parse_header(l, req.headers);', 'if (req.method.empty()) return BadRequest;'],
      stackTitle: 'Request',
      details: {
        raw: { title: 'Raw bytes', text: 'Everything read from the socket so far, possibly more than one request.', code: 'std::string raw;  // per-connection' },
        method: D['request line'],
        headers: D.headers,
      },
      steps: [
        { note: 'First check the head is complete. If \\r\\n\\r\\n isn’t there yet, read more.', line: [0, 1], vars: [['raw', '"GET / HTTP/1.1\\r\\nHost…"'], ['end', '38', 'write']], rows: [['state', 'complete head', 'ok']] },
        { note: 'Split the request line on spaces into method, path and version.', line: [2, 3], vars: [['raw', '…'], ['method', '"GET"', 'write'], ['path', '"/"', 'write'], ['version', '"HTTP/1.1"', 'write']] },
        { note: 'Each remaining line is Name: value. Names are case-insensitive, so lowercase them.', line: [4, 5], vars: [['method', '"GET"'], ['path', '"/"'], ['headers', '{host, connection}', 'write']] },
        { note: 'Reject garbage with 400 instead of crashing. Parsers face hostile input.', line: 6, vars: [['method', '"GET"', 'ok'], ['path', '"/"', 'ok'], ['headers', '{host, connection}', 'ok']], rows: [['bad input', '400', 'warn']] },
      ],
    }),
  ],
  route: [
    'Routing',
    B({
      panel: 'Router',
      nodes: [N('rq', 40, 60, 920, 110, 'request', 'GET /health'), N('rt', 200, 260, 600, 130, 'router', 'method + path → handler'), N('h1', 40, 480, 290, 110, 'handler', 'GET /'), N('h2', 355, 480, 290, 110, 'handler', 'GET /health'), N('h3', 670, 480, 290, 110, 'static files', 'GET /static/*'), N('res', 40, 720, 920, 130, 'response')],
      edges: ['rq>rt', 'rt>h1', 'rt>h2', 'rt>h3'],
      beats: [
        { note: 'The router looks up method and path and picks a handler.', hot: { rt: 'current', 'rq>rt': 'accent' }, hide: ['res'], rows: [['routes', 3]] },
        { note: 'GET /health matches exactly, so its handler builds a Response.', hot: { h2: 'ok', 'rt>h2': 'accent' }, hide: ['res'], rows: [['match', 'exact']] },
        { note: 'Handlers return a Response struct; one function serialises it to bytes.', hot: { res: 'ok' }, label: { res: 'HTTP/1.1 200 OK · text/plain · "ok"' }, rows: [['socket code in handler', 'none', 'ok']] },
        { note: 'No match gives 404, a matching path with the wrong method gives 405.', label: { rq: 'request', res: 'response' }, sub: { rq: 'POST /health' }, hot: { res: 'warn' }, rows: [['status', 405, 'warn']] },
      ],
    }),
  ],
  static: [
    'Static files',
    B({
      panel: 'Files',
      nodes: [N('rq', 40, 60, 920, 110, 'request', 'GET /static/app.js'), N('sf', 200, 260, 600, 130, 'static files', 'root = ./static'), N('fs', 40, 480, 440, 110, 'disk', 'app.js 48 KB'), N('sk', 520, 480, 440, 110, 'sendfile()', 'kernel copy'), N('res', 40, 700, 920, 130, 'response')],
      edges: ['rq>sf', 'sf>fs', 'fs>sk'],
      beats: [
        { note: 'Map the path under a root directory and pick Content-Type from the extension.', hot: { sf: 'current' }, hide: ['sk', 'res'], rows: [['type', 'text/javascript']] },
        { note: 'GET /static/../../etc/passwd must not escape the root. Normalise the path and check its prefix.', sub: { rq: 'GET /static/../../etc/passwd' }, hot: { rq: 'fail', sf: 'warn' }, hide: ['sk', 'res'], rows: [['path traversal', 'blocked → 403', 'warn']] },
        { note: 'read() then send() copies the file twice through user space. sendfile() lets the kernel do it in one step.', hot: { fs: 'read', sk: 'current', 'fs>sk': 'accent' }, hide: ['res'], rows: [['copies', '1 (was 2)', 'ok']] },
        { note: 'Send headers, then the file. Big files may need several sendfile calls on a non-blocking socket.', hot: { res: 'ok' }, label: { res: '200 · Content-Length: 49152' }, rows: [['caching', 'ETag / Last-Modified']] },
      ],
    }),
  ],
});

// ---------------- thread per connection ----------------
const TPC = [0, 1, 2, 3, 4].map((i) => N(`t${i}`, 40 + i * 186, 460, 170, 110, `thread ${i + 1}`));
const tIds = TPC.map((t) => t.id);
demo('net-threads', 'Thread per connection', 'One client at a time, then a thread per client, keep-alive, and why it stops scaling around a few thousand connections.', {
  iterative: [
    'One at a time',
    B({
      panel: 'Server',
      nodes: [N('c1', 40, 60, 440, 110, 'client', 'A: slow upload'), N('c2', 520, 60, 440, 110, 'client', 'B: GET /'), N('lp', 200, 260, 600, 120, 'accept()', 'loop, one thread'), N('res', 40, 720, 920, 130, 'result')],
      edges: ['c1>lp', 'c2>lp'],
      beats: [
        { note: 'The simplest server accepts a client, serves it, then accepts the next.', hot: { lp: 'current' }, hide: ['res'], rows: [['threads', 1]] },
        { note: 'Client A is slow to send. recv() blocks, so the whole server waits.', hot: { c1: 'warn', lp: 'warn', 'c1>lp': 'accent' }, sub: { lp: 'blocked in recv(A)' }, hide: ['res'], rows: [['serving', 'A only', 'warn']] },
        { note: 'B’s tiny request sits in the accept queue until A finishes.', hot: { c2: 'fail', res: 'fail' }, sub: { lp: 'blocked in recv(A)' }, label: { res: 'B waits 30 s for a 1 ms page' }, rows: [['concurrency', 1, 'fail']] },
      ],
    }),
  ],
  perthread: [
    'Thread per client',
    B({
      panel: 'Server',
      codeTitle: 'srv_7_threads.cpp',
      code: ['for (;;) {', '  int c = accept(lfd, nullptr, nullptr);', '  std::thread([c] { serve(c); close(c); }).detach();', '}'],
      nodes: [N('lp', 200, 240, 600, 120, 'thread per conn', 'acceptor'), ...TPC, N('res', 40, 720, 920, 130, 'result')],
      edges: tIds.map((t) => `lp>${t}`),
      beats: [
        { note: 'Hand each accepted fd to its own thread.', hl: [1, 2], hot: { lp: 'current' }, hide: [...tIds.slice(1), 'res'], rows: [['threads', 2]] },
        { note: 'Each thread runs simple blocking code, and a slow client blocks only its own thread.', hot: { ...all(tIds, 'ok'), t0: 'warn' }, sub: { t0: 'slow client' }, hide: ['res'], rows: [['threads', 6, 'ok']] },
        { note: 'Easy to write and fine up to a few hundred clients. The OS scheduler does the multiplexing.', hot: { res: 'ok' }, label: { res: 'A slow, B fast: both served' }, rows: [['model', 'blocking + threads']] },
      ],
    }),
  ],
  keepalive: [
    'Keep-alive',
    B({
      panel: 'Server',
      nodes: [N('lp', 200, 240, 600, 120, 'thread per conn', 'acceptor'), ...TPC, N('res', 40, 720, 920, 130, 'result')],
      edges: tIds.map((t) => `lp>${t}`),
      beats: [
        { note: 'With Connection: keep-alive, a client reuses one connection for many requests and skips new handshakes.', hot: all(tIds, 'ok'), hide: ['res'], rows: [['handshakes saved', 'per request', 'ok']] },
        { note: 'Between requests each thread sits in recv(), waiting for the next one.', hot: all(tIds, 'visited'), sub: each(tIds, 'idle in recv'), hide: ['res'], rows: [['busy threads', 0, 'warn']] },
        { note: 'Idle connections now pin threads. Add an idle timeout, and close when the client says Connection: close.', hot: { res: 'warn' }, label: { res: '5,000 idle clients = 5,000 sleeping threads' }, rows: [['idle timeout', '5–60 s']] },
      ],
    }),
  ],
  limits: [
    'Why it stops scaling',
    B({
      panel: 'Limits',
      nodes: [N('st', 40, 60, 440, 130, 'stacks', '10k × 8 MB virtual'), N('sw', 520, 60, 440, 130, 'context switches', 'kernel ↔ thread'), N('ca', 40, 260, 440, 130, 'cache misses', 'each switch cold'), N('lk', 520, 260, 440, 130, 'lock contention', 'shared state'), N('res', 40, 500, 920, 150, 'at 10,000 connections')],
      edges: [],
      beats: [
        { note: 'At 10,000 connections you have 10,000 threads. Each reserves a stack, 8 MB of address space by default.', hot: { st: 'warn' }, hide: ['res'], rows: [['threads', '10,000', 'warn']] },
        { note: 'Every wakeup is a context switch into a thread whose data is no longer in cache.', hot: { sw: 'warn', ca: 'warn' }, hide: ['res'], rows: [['switch cost', '2–5 µs + cache refill', 'warn']] },
        { note: 'Shared structures like a session map get hammered by thousands of threads at once.', hot: { lk: 'warn' }, hide: ['res'], rows: [['contention', 'high', 'warn']] },
        { note: 'Memory, scheduler and cache costs grow with connections, not with traffic. That is the C10K problem.', hot: { res: 'fail', st: 'fail', sw: 'fail' }, label: { res: 'fix: few threads, many sockets' }, rows: [['next', 'non-blocking + epoll']] },
      ],
    }),
  ],
});

// ---------------- non-blocking ----------------
const NB_NODES = [N('lp', 200, 60, 600, 120, 'event loop', 'one thread'), ...[0, 1, 2, 3, 4].map((i) => N(`s${i}`, 40 + i * 186, 300, 170, 110, `fd ${i + 5}`)), N('res', 40, 560, 920, 130, 'result')];
const sIds = [0, 1, 2, 3, 4].map((i) => `s${i}`);
demo('net-nonblock', 'Non-blocking I/O', 'Blocking recv stalls a thread; O_NONBLOCK returns EAGAIN; polling every socket wastes CPU, so we need readiness notification.', {
  blocking: [
    'Blocking',
    B({
      panel: 'I/O',
      nodes: NB_NODES,
      edges: sIds.map((s) => `lp>${s}`),
      beats: [
        { note: 'One thread wants to serve five sockets.', hot: { lp: 'current' }, hide: ['res'], rows: [['sockets', 5]] },
        { note: 'It calls recv() on fd 5, which has no data, and sleeps.', hot: { s0: 'warn', 'lp>s0': 'accent' }, sub: { lp: 'blocked in recv(5)' }, hide: ['res'], rows: [['thread', 'asleep', 'warn']] },
        { note: 'Meanwhile data arrives on fd 8, and nobody reads it.', hot: { s3: 'read', s0: 'warn', res: 'fail' }, sub: { s3: 'data!', lp: 'blocked in recv(5)' }, label: { res: 'one idle client blocks everyone' }, rows: [['served', 0, 'fail']] },
      ],
    }),
  ],
  eagain: [
    'O_NONBLOCK',
    B({
      panel: 'I/O',
      codeTitle: 'nonblock.cpp',
      code: ['fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);', 'ssize_t n = recv(fd, buf, sizeof buf, 0);', 'if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK))', '  /* nothing yet: go do something else */;'],
      nodes: [...NB_NODES.map((n) => (n.id === 'lp' ? { ...n, y: 250 } : n.id === 'res' ? { ...n, y: 720 } : { ...n, y: 480 }))],
      edges: sIds.map((s) => `lp>${s}`),
      beats: [
        { note: 'Set O_NONBLOCK on every socket.', hl: [0], hot: all(sIds, 'current'), hide: ['res'], rows: [['mode', 'non-blocking']] },
        { note: 'recv() on an empty socket now returns -1 with errno EAGAIN immediately.', hl: [1, 2], hot: { s0: 'visited', 'lp>s0': 'accent' }, sub: { s0: 'EAGAIN' }, hide: ['res'], rows: [['recv(5)', 'EAGAIN']] },
        { note: 'EAGAIN isn’t an error, it means try later. The thread moves on to the next socket.', hl: [3], hot: { s3: 'ok', 'lp>s3': 'accent' }, sub: { s0: 'EAGAIN', s3: 'read 212 B' }, hide: ['res'], rows: [['served', 1, 'ok']] },
        { note: 'The same applies to send() when the send buffer is full, and to accept() with no pending connection.', hot: { res: 'ok' }, label: { res: 'recv · send · accept all return EAGAIN' }, rows: [['calls', 'never sleep']] },
      ],
    }),
  ],
  polling: [
    'Polling everything',
    B({
      panel: 'I/O',
      nodes: [...NB_NODES, N('cpu', 40, 760, 920, 130, 'CPU', '')],
      edges: sIds.map((s) => `lp>${s}`),
      beats: [
        { note: 'Naive fix: loop over every socket forever, trying recv() on each.', hot: { ...all(sIds, 'visited'), lp: 'current' }, sub: each(sIds, 'EAGAIN'), hide: ['res'], label: { cpu: '100% of a core' }, rows: [['syscalls/s', 'millions', 'warn']] },
        { note: 'With 10,000 mostly idle sockets, almost every call returns EAGAIN.', hot: { cpu: 'fail' }, label: { cpu: '100% of a core', res: '99.9% wasted syscalls' }, rows: [['useful', '0.1%', 'fail']] },
        { note: 'We need the kernel to tell us which sockets are ready. That’s select, poll, and epoll.', hot: { lp: 'ok', res: 'ok' }, label: { res: 'readiness notification', cpu: 'idle when idle' }, rows: [['next', 'epoll']] },
      ],
    }),
  ],
});

// ---------------- epoll ----------------
const EP_NODES = [
  N('cl', 40, 40, 920, 100, 'client', '10,000 connections'),
  N('ep', 40, 230, 440, 130, 'epoll', 'interest: 10,001 fds'),
  N('rl', 520, 230, 440, 130, 'ready list', 'empty'),
  N('w', 280, 440, 440, 110, 'epoll_wait()'),
  N('lp', 280, 630, 440, 110, 'event loop', 'one thread'),
  N('res', 40, 830, 920, 120, 'result'),
];
demo('net-epoll', 'epoll event loop', 'epoll_create1/ctl/wait, the ready list, level- vs edge-triggered, and accepting in a loop.', {
  loop: [
    'The loop',
    B({
      panel: 'epoll',
      nodes: EP_NODES,
      edges: ['cl>ep', 'ep>rl', 'rl>w', 'w>lp'],
      beats: [
        { note: 'Register every socket once with epoll_ctl(ADD). The kernel keeps the interest set.', hot: { ep: 'current' }, hide: ['res'], rows: [['registered', '10,001']] },
        { note: 'The loop calls epoll_wait() and sleeps. Idle connections cost nothing.', hot: { w: 'current', lp: 'visited' }, sub: { lp: 'asleep' }, hide: ['res'], rows: [['CPU', '0%', 'ok']] },
        { note: 'Data arrives on 3 sockets. The kernel puts them on the ready list and wakes the loop.', hot: { rl: 'write', 'ep>rl': 'accent', 'rl>w': 'accent' }, sub: { rl: 'fd 17, 942, 6031' }, hide: ['res'], rows: [['ready', 3]] },
        { note: 'epoll_wait returns just those 3. The loop handles each and goes back to waiting.', hot: { lp: 'ok', 'w>lp': 'accent' }, sub: { rl: 'fd 17, 942, 6031', lp: 'handle 3, then wait' }, hide: ['res'], rows: [['work', 'O(ready)', 'ok']] },
        { note: 'select and poll rescan the whole set on every call. epoll’s cost grows with activity, not with idle connections.', hot: { res: 'ok' }, label: { res: 'select: O(n) per call · epoll: O(ready)' }, rows: [['scales to', '100k+ conns', 'ok']] },
      ],
    }),
  ],
  lt: [
    'Level-triggered',
    B({
      panel: 'epoll',
      codeTitle: 'lt.cpp',
      code: ['ev.events = EPOLLIN;                // level-triggered', 'epoll_ctl(ep, EPOLL_CTL_ADD, fd, &ev);', 'n = recv(fd, buf, 1024, 0);          // reads part'],
      nodes: EP_NODES.slice(1),
      edges: ['ep>rl', 'rl>w', 'w>lp'],
      beats: [
        { note: 'Level-triggered is the default: an fd is reported as long as it has unread data.', hl: [0, 1], hot: { ep: 'current' }, hide: ['res'], rows: [['mode', 'LT']] },
        { note: '4 KB arrive, and the loop reads only 1 KB.', hl: [2], hot: { lp: 'current', rl: 'write' }, sub: { rl: 'fd 17: 4 KB' }, hide: ['res'], rows: [['left', '3 KB']] },
        { note: 'Next epoll_wait reports fd 17 again, because data is still there.', hot: { rl: 'write', w: 'current' }, sub: { rl: 'fd 17: 3 KB' }, hide: ['res'], rows: [['reported again', 'yes', 'ok']] },
        { note: 'Forgiving and easy to get right. The cost is extra wakeups if you read in small pieces.', hot: { res: 'ok' }, label: { res: 'safe default' }, rows: [['bug risk', 'low', 'ok']] },
      ],
    }),
  ],
  et: [
    'Edge-triggered',
    B({
      panel: 'epoll',
      codeTitle: 'et.cpp',
      code: ['ev.events = EPOLLIN | EPOLLET;      // edge-triggered', 'for (;;) {                           // drain!', '  n = recv(fd, buf, sizeof buf, 0);', '  if (n < 0 && errno == EAGAIN) break; }'],
      nodes: EP_NODES.slice(1),
      edges: ['ep>rl', 'rl>w', 'w>lp'],
      beats: [
        { note: 'Edge-triggered reports an fd only when new data arrives, once per change.', hl: [0], hot: { ep: 'current' }, hide: ['res'], rows: [['mode', 'ET']] },
        { note: 'Read just 1 KB of 4 KB and return, and epoll never tells you about fd 17 again.', hot: { rl: 'fail', lp: 'fail' }, sub: { rl: 'empty (3 KB stuck)', lp: 'waits forever' }, hide: ['res'], rows: [['stalled conn', 1, 'fail']] },
        { note: 'With ET you must loop recv() until EAGAIN every time. Same for accept() and send().', hl: [1, 2, 3], hot: { lp: 'ok', rl: 'ok' }, sub: { rl: 'drained', lp: 'read to EAGAIN' }, hide: ['res'], rows: [['rule', 'drain to EAGAIN', 'ok']] },
        { note: 'ET saves wakeups, but one busy socket can starve others if you drain it all. Cap reads per turn.', hot: { res: 'warn' }, label: { res: 'fairness: max 64 KB per fd per turn' }, rows: [['used by', 'nginx, most C10K servers']] },
      ],
    }),
  ],
  accept: [
    'Accepting',
    B({
      panel: 'epoll',
      codeTitle: 'accept.cpp',
      code: ['// listening fd is in epoll too', 'while ((c = accept4(lfd, 0, 0,', '         SOCK_NONBLOCK | SOCK_CLOEXEC)) >= 0)', '  add_conn(ep, c);   // epoll_ctl ADD, new Conn', '// errno == EAGAIN: queue empty'],
      nodes: [N('lf', 40, 240, 440, 120, 'listen fd 3', 'readable = pending'), N('ep', 520, 240, 440, 120, 'epoll'), N('lp', 280, 440, 440, 110, 'event loop'), N('cn', 280, 620, 440, 110, 'Conn', 'fd 104 … 131'), N('res', 40, 820, 920, 120, 'result')],
      edges: ['lf>ep', 'ep>lp', 'lp>cn'],
      beats: [
        { note: 'The listening socket goes into epoll too. Readable means connections are waiting.', hl: [0], hot: { lf: 'current', 'lf>ep': 'accent' }, hide: ['cn', 'res'], rows: [['pending', 28]] },
        { note: 'Accept in a loop until EAGAIN, so a burst of 28 is taken in one wakeup.', hl: [1, 2, 4], hot: { lp: 'current', 'ep>lp': 'accent' }, hide: ['cn', 'res'], rows: [['accepted', 28, 'ok']] },
        { note: 'accept4 sets non-blocking and close-on-exec atomically, saving two fcntl calls per connection.', hl: [2], hot: { cn: 'write', 'lp>cn': 'accent' }, hide: ['res'], rows: [['syscalls saved', '2 per conn', 'ok']] },
        { note: 'Each new fd gets a Conn object and is registered with epoll.', hl: [3], hot: { cn: 'ok', res: 'ok' }, label: { res: '28 new Conns in 1 wakeup' }, rows: [['EMFILE', 'handle: stop accepting', 'warn']] },
      ],
    }),
  ],
});

// ---------------- connection state machine & partial I/O ----------------
const SM = ['rh', 'rb', 'hd', 'wr', 'ka', 'cl'];
const SM_NODES = [
  N('rh', 40, 60, 290, 110, 'read headers'),
  N('rb', 355, 60, 290, 110, 'read body'),
  N('hd', 670, 60, 290, 110, 'handle'),
  N('wr', 670, 260, 290, 110, 'write'),
  N('ka', 355, 260, 290, 110, 'keep-alive', 'idle'),
  N('cl', 40, 260, 290, 110, 'close()'),
  N('cn', 40, 460, 920, 120, 'Conn', 'fd 17 · in "" · out ""'),
  N('res', 40, 680, 920, 130, 'result'),
];
demo('net-conn', 'Connection state machines', 'Per-connection state instead of a stack: read headers → body → handle → write → keep-alive; partial reads and writes.', {
  states: [
    'States',
    B({
      panel: 'Conn',
      nodes: SM_NODES,
      edges: ['rh>rb', 'rb>hd', 'hd>wr', 'wr>ka', 'ka>rh', 'wr>cl'],
      beats: [
        { note: 'A thread-per-connection server keeps progress on the thread’s stack. An event loop can’t block, so each Conn records where it is.', hot: { cn: 'current' }, hide: ['res'], rows: [['state', 'explicit']] },
        { note: 'Readable: append bytes and try to parse. Until \\r\\n\\r\\n arrives, stay in read headers.', hot: { rh: 'current' }, sub: { cn: 'fd 17 · in "GET / HT" · out ""' }, hide: ['res'], rows: [['state', 'read headers']] },
        { note: 'Head complete with Content-Length 12: move to read body, then handle.', hot: { rb: 'current', hd: 'current', 'rh>rb': 'accent', 'rb>hd': 'accent' }, sub: { cn: 'fd 17 · body 12/12' }, hide: ['res'], rows: [['state', 'handle']] },
        { note: 'The handler fills the out buffer, and the state becomes write.', hot: { wr: 'current', 'hd>wr': 'accent' }, sub: { cn: 'fd 17 · out 1.2 KB' }, hide: ['res'], rows: [['state', 'write']] },
        { note: 'All sent: keep-alive goes back to read headers, Connection: close goes to close.', hot: { ka: 'ok', cl: 'visited', 'wr>ka': 'accent', 'ka>rh': 'accent' }, sub: { cn: 'fd 17 · idle since 12:00:03' }, hide: ['res'], rows: [['state', 'keep-alive', 'ok']] },
        { note: 'Every transition happens inside a short handler call. The loop serves thousands of Conns this way.', hot: { res: 'ok', ...all(SM, 'visited') }, label: { res: 'switch (c.state) { … }' }, rows: [['blocking calls', 0, 'ok']] },
      ],
    }),
  ],
  partialwrite: [
    'Partial writes',
    B({
      panel: 'Write',
      codeTitle: 'write.cpp',
      code: ['ssize_t n = send(c.fd, c.out.data() + c.out_off,', '                 c.out.size() - c.out_off, MSG_NOSIGNAL);', 'if (n > 0) c.out_off += n;', 'if (c.out_off < c.out.size()) want_write(c);   // EPOLLOUT'],
      nodes: [N('cn', 40, 250, 920, 120, 'out buffer', '0 / 200 KB sent'), N('sb', 40, 440, 440, 120, 'send buffer', 'kernel, 64 KB free'), N('cl', 520, 440, 440, 120, 'client'), N('res', 40, 680, 920, 130, 'result')],
      edges: ['cn>sb', 'sb>cl'],
      beats: [
        { note: 'The response is 200 KB, but the kernel send buffer has 64 KB free.', hl: [0, 1], hot: { cn: 'current' }, hide: ['res'], rows: [['to send', '200 KB']] },
        { note: 'send() accepts 64 KB and returns 65,536, not an error.', hl: [2], hot: { sb: 'write', 'cn>sb': 'accent' }, sub: { cn: '64 / 200 KB sent', sb: 'full' }, hide: ['res'], rows: [['sent', '64 KB']] },
        { note: 'Remember the offset. Code that ignores the return value silently truncates responses.', hl: [2], hot: { cn: 'warn' }, sub: { cn: 'out_off = 65536', sb: 'full' }, hide: ['res'], rows: [['bug if ignored', 'truncation', 'fail']] },
        { note: 'Ask epoll for EPOLLOUT and continue from the offset when space frees up.', hl: [3], hot: { cn: 'ok', sb: 'ok', 'sb>cl': 'accent', res: 'ok' }, sub: { cn: '200 / 200 KB sent', sb: 'draining' }, label: { res: 'complete after 4 writable events' }, rows: [['sent', '200 KB', 'ok']] },
      ],
    }),
  ],
});

// ---------------- backpressure ----------------
const BP_NODES = [
  N('src', 40, 60, 290, 110, 'client', 'fast publisher'),
  N('lp', 355, 60, 290, 110, 'event loop'),
  N('dst', 670, 60, 290, 110, 'client', 'slow reader'),
  N('ob', 355, 280, 605, 120, 'out buffer', '0 KB'),
  N('sb', 355, 480, 605, 110, 'send buffer', 'kernel'),
  N('mem', 40, 700, 920, 130, 'RSS'),
];
demo('net-backpressure', 'Backpressure & slow clients', 'A slow reader grows the outbound buffer; EPOLLOUT re-arm; bounded buffers and a disconnect policy.', {
  slow: [
    'Slow reader',
    B({
      panel: 'Backpressure',
      nodes: BP_NODES,
      edges: ['src>lp', 'lp>ob', 'ob>sb'],
      beats: [
        { note: 'A chat server broadcasts every message to every subscriber.', hot: { src: 'current', lp: 'current', 'src>lp': 'accent' }, label: { mem: '40 MB' }, rows: [['msgs/s in', 5000]] },
        { note: 'One subscriber is on a bad phone network. Its send buffer fills and send() returns EAGAIN.', hot: { dst: 'warn', sb: 'warn' }, sub: { sb: 'full → EAGAIN' }, label: { mem: '40 MB' }, rows: [['send()', 'EAGAIN', 'warn']] },
        { note: 'If the server keeps appending to that connection’s out buffer, it grows without limit.', hot: { ob: 'fail', mem: 'fail' }, sub: { ob: '1.8 GB queued', sb: 'full' }, label: { mem: '1.9 GB and rising' }, rows: [['out buffer', 'unbounded', 'fail']] },
        { note: 'One slow client can OOM-kill a process serving 10,000 healthy ones.', hot: { mem: 'fail', lp: 'fail' }, label: { mem: 'OOM killer' }, rows: [['blast radius', 'everyone', 'fail']] },
      ],
    }),
  ],
  epollout: [
    'EPOLLOUT re-arm',
    B({
      panel: 'Backpressure',
      codeTitle: 'flush.cpp',
      code: ['void flush(Conn& c) {', '  while (pending(c)) if (!write_some(c)) break;  // EAGAIN', '  set_events(c, pending(c) ? EPOLLIN | EPOLLOUT : EPOLLIN);', '}'],
      nodes: BP_NODES.map((n) => (n.id === 'src' || n.id === 'lp' || n.id === 'dst' ? { ...n, y: 220 } : n.id === 'ob' ? { ...n, y: 380 } : n.id === 'sb' ? { ...n, y: 540 } : n)),
      edges: ['lp>ob', 'ob>sb', 'sb>dst'],
      beats: [
        { note: 'On EAGAIN keep the rest in the out buffer and subscribe to EPOLLOUT.', hl: [1, 2], hot: { ob: 'write', lp: 'current' }, sub: { ob: '12 KB pending', sb: 'full' }, label: { mem: '40 MB' }, rows: [['events', 'IN | OUT']] },
        { note: 'When the client drains its window, epoll reports writable and flush() sends more.', hot: { sb: 'ok', 'ob>sb': 'accent', 'sb>dst': 'accent' }, sub: { ob: '0 KB pending', sb: 'draining' }, label: { mem: '40 MB' }, rows: [['flushed', '12 KB', 'ok']] },
        { note: 'Once empty, drop EPOLLOUT. Left on, a writable socket wakes the loop constantly and burns CPU.', hl: [2], hot: { lp: 'ok' }, sub: { ob: 'empty' }, label: { mem: '40 MB' }, rows: [['events', 'IN only', 'ok']] },
      ],
    }),
  ],
  bounded: [
    'Bounded buffer',
    B({
      panel: 'Backpressure',
      codeTitle: 'policy.cpp',
      code: ['if (c.out.size() - c.out_off > kMaxOut) {   // 256 KB', '  metrics.slow_disconnects++;', '  close_conn(c);                       // or drop msgs', '}'],
      nodes: BP_NODES.map((n) => (n.id === 'src' || n.id === 'lp' || n.id === 'dst' ? { ...n, y: 220 } : n.id === 'ob' ? { ...n, y: 380 } : n.id === 'sb' ? { ...n, y: 540 } : n)),
      edges: ['src>lp', 'lp>ob', 'ob>sb'],
      beats: [
        { note: 'Cap each connection’s pending output, for example at 256 KB.', hl: [0], hot: { ob: 'current' }, sub: { ob: '0 / 256 KB' }, label: { mem: 'max 10k × 256 KB' }, rows: [['cap', '256 KB']] },
        { note: 'The slow reader hits the cap.', hot: { ob: 'warn', dst: 'warn' }, sub: { ob: '256 / 256 KB' }, label: { mem: 'bounded' }, rows: [['over cap', 1, 'warn']] },
        { note: 'Apply a documented policy: disconnect it, drop old messages, or stop reading from its producer.', hl: [1, 2], hot: { dst: 'fail', ob: 'visited', lp: 'ok', mem: 'ok' }, sub: { ob: 'closed', dst: 'disconnected' }, label: { mem: '40 MB, flat' }, rows: [['slow_disconnects', 1], ['others', 'unaffected', 'ok']] },
        { note: 'Backpressure means the slow side sets the pace, and nothing grows without limit.', hot: { mem: 'ok', src: 'ok' }, label: { mem: 'memory bound = conns × cap' }, rows: [['policy', 'documented', 'ok']] },
      ],
    }),
  ],
});

// ---------------- lifecycle: churn, limits, shutdown ----------------
demo('net-lifecycle', 'Churn, limits & shutdown', 'Clean teardown on HUP/ERR/EOF to avoid fd leaks; ulimit, somaxconn, SO_REUSEADDR/REUSEPORT; graceful SIGTERM shutdown.', {
  churn: [
    'Connection churn',
    B({
      panel: 'Churn',
      codeTitle: 'close.cpp',
      code: ['if (ev & (EPOLLHUP | EPOLLERR) || n == 0) {', '  epoll_ctl(ep, EPOLL_CTL_DEL, c.fd, nullptr);', '  close(c.fd);', '  conns.erase(c.fd);        // free Conn + buffers', '}'],
      nodes: [N('ev', 40, 240, 290, 110, 'recv()', 'returns 0'), N('ep', 355, 240, 290, 110, 'epoll', 'DEL'), N('fd', 670, 240, 290, 110, 'close()'), N('cn', 40, 430, 920, 110, 'Conn', 'freed'), N('m', 40, 620, 920, 130, 'fd table', 'open fds over time')],
      edges: ['ev>ep', 'ep>fd'],
      beats: [
        { note: 'Clients come and go: 10% of 10,000 reconnect every second.', hot: { m: 'current' }, hide: ['cn'], sub: { m: '10,004 open' }, rows: [['churn', '1,000/s']] },
        { note: 'recv() returning 0, EPOLLHUP or EPOLLERR all mean the connection is over.', hl: [0], hot: { ev: 'current' }, hide: ['cn'], sub: { m: '10,004 open' }, rows: [['close signals', 3]] },
        { note: 'Remove it from epoll, close the fd, and free the Conn. Miss any step and something leaks.', hl: [1, 2, 3], hot: { ep: 'ok', fd: 'ok', cn: 'ok', 'ev>ep': 'accent', 'ep>fd': 'accent' }, sub: { m: '10,004 open' }, rows: [['per close', '3 steps']] },
        { note: 'Leak one fd per close and after an hour of churn accept() fails with EMFILE.', hot: { m: 'fail', fd: 'fail' }, sub: { m: '10,004 → 65,536 (EMFILE)' }, hide: ['cn'], rows: [['leak', '+1,000/s', 'fail']] },
        { note: 'Watch the open-fd count: after churn stops it must return to baseline.', hot: { m: 'ok' }, sub: { m: 'back to 10,004' }, rows: [['check', 'ls /proc/PID/fd | wc -l', 'ok']] },
      ],
    }),
  ],
  limits: [
    'OS limits',
    B({
      panel: 'Limits',
      nodes: [N('ul', 40, 60, 440, 130, 'ulimit -n', 'default 1024'), N('sc', 520, 60, 440, 130, 'somaxconn', 'default 4096'), N('ra', 40, 260, 440, 130, 'SO_REUSEADDR', 'restart after crash'), N('rp', 520, 260, 440, 130, 'SO_REUSEPORT', 'one listener per loop'), N('ep', 40, 460, 920, 110, 'ip_local_port_range', 'load generator side'), N('res', 40, 680, 920, 130, 'result')],
      edges: [],
      beats: [
        { note: 'Each connection is an fd, and the default soft limit is 1,024. Raise it explicitly and document it.', hot: { ul: 'fail' }, sub: { ul: '1024 → 65536' }, hide: ['res'], rows: [['nofile', 65536, 'ok']] },
        { note: 'The accept queue is capped by net.core.somaxconn as well as your listen backlog.', hot: { sc: 'current' }, hide: ['res'], rows: [['somaxconn', 4096]] },
        { note: 'After a restart, old connections in TIME_WAIT block bind(). SO_REUSEADDR allows it.', hot: { ra: 'ok' }, hide: ['res'], rows: [['EADDRINUSE', 'fixed', 'ok']] },
        { note: 'SO_REUSEPORT lets several sockets listen on one port, and the kernel spreads connections across them.', hot: { rp: 'ok' }, hide: ['res'], rows: [['use', 'one listener per core']] },
        { note: 'The client box needs limits raised too: one source IP has about 28,000 ephemeral ports by default.', hot: { ep: 'warn', res: 'ok' }, label: { res: 'tune both sides, write it down' }, rows: [['ports', '32768–60999', 'warn']] },
      ],
    }),
  ],
  shutdown: [
    'Graceful shutdown',
    B({
      panel: 'Shutdown',
      nodes: [N('sig', 40, 60, 440, 110, 'signalfd', 'SIGTERM'), N('lp', 520, 60, 440, 110, 'event loop'), N('lf', 40, 260, 440, 110, 'listen fd 3'), N('cn', 520, 260, 440, 110, 'Conn', '9,876 open'), N('res', 40, 480, 920, 130, 'exit')],
      edges: ['sig>lp', 'lp>cn'],
      beats: [
        { note: 'Kubernetes or systemd sends SIGTERM. Via signalfd it shows up as a normal epoll event.', hot: { sig: 'current', 'sig>lp': 'accent' }, hide: ['res'], rows: [['signal', 'SIGTERM']] },
        { note: 'First close the listening socket, so no new connections arrive.', hot: { lf: 'fail' }, sub: { lf: 'closed' }, hide: ['res'], rows: [['accepting', 'no']] },
        { note: 'Flush or drop in-flight output per your policy, and close each client cleanly.', hot: { cn: 'current', 'lp>cn': 'accent' }, sub: { lf: 'closed', cn: 'draining, 2 s deadline' }, hide: ['res'], rows: [['deadline', '< 10 s']] },
        { note: 'Exit with status 0 inside the deadline. Otherwise SIGKILL follows and messages are lost.', hot: { res: 'ok', cn: 'visited' }, sub: { lf: 'closed', cn: '0 open' }, label: { res: 'exit(0) in 1.4 s' }, rows: [['status', 0, 'ok']] },
      ],
    }),
  ],
});

// ---------------- scaling & benchmarking ----------------
const LOOPS = [0, 1].map((i) => N(`l${i}`, 40 + i * 480, 440, 440, 120, `loop ${i}`, `core ${i}`));
demo('net-scale', 'C10K: scaling & benchmarking', 'Load generation and acceptance metrics, per-connection memory budget, one loop per core, and zero-copy sends.', {
  bench: [
    'Benchmark',
    B({
      panel: 'Bench',
      nodes: [N('lg', 40, 60, 440, 130, 'load generator', 'separate EC2 host'), N('sv', 520, 60, 440, 130, 'server', 't3.medium · 2 vCPU'), N('m', 40, 300, 920, 130, 'metrics'), N('res', 40, 520, 920, 150, 'acceptance')],
      edges: ['lg>sv'],
      beats: [
        { note: 'Run the load generator on another machine, or it steals the CPU you’re measuring.', hot: { lg: 'current', 'lg>sv': 'accent' }, hide: ['m', 'res'], rows: [['hosts', 2]] },
        { note: 'Ramp 1K → 5K → 10K connections, then hold, then churn. Look for the step where things bend.', hot: { sv: 'current' }, hide: ['res'], sub: { m: 'conns 1k → 10k' }, rows: [['ramp', '< 2 min']] },
        { note: 'Watch p99 latency, RSS, open fds and CPU together. Averages hide the slow tail.', hot: { m: 'write' }, sub: { m: 'p99 7.8 ms · RSS 61 MB · fds 10,004 · CPU 3%' }, hide: ['res'], rows: [['p99', '7.8 ms', 'ok'], ['idle CPU', '3%', 'ok']] },
        { note: 'Compare against the targets: 10K held for 5 minutes, p99 under 50 ms, no fd growth, zero lost messages.', hot: { res: 'ok' }, sub: { m: 'p99 7.8 ms · RSS 61 MB · fds 10,004 · CPU 3%' }, label: { res: 'all criteria met' }, rows: [['result', 'pass', 'ok']] },
      ],
    }),
  ],
  memory: [
    'Memory per connection',
    B({
      panel: 'Memory',
      nodes: [N('k', 40, 60, 440, 120, 'kernel', 'socket + buffers'), N('cn', 520, 60, 440, 120, 'Conn', 'struct + in/out'), N('tot', 40, 280, 920, 130, 'total'), N('res', 40, 500, 920, 150, 'budget')],
      edges: [],
      beats: [
        { note: 'An idle TCP socket costs the kernel a few KB, more when its buffers hold data.', hot: { k: 'current' }, sub: { k: '~3 KB idle' }, hide: ['tot', 'res'], rows: [['kernel', '~3 KB']] },
        { note: 'Your Conn adds the struct plus buffers. Reserving 16 KB of std::string per connection adds up.', hot: { cn: 'warn' }, sub: { cn: '16 KB reserved each' }, hide: ['tot', 'res'], rows: [['user', '16 KB', 'warn']] },
        { note: 'At 10,000 connections that is 160 MB for mostly idle clients.', hot: { tot: 'warn' }, sub: { tot: '10k × 19 KB = 190 MB' }, hide: ['res'], rows: [['total', '190 MB', 'warn']] },
        { note: 'Allocate buffers lazily and free them when idle. Idle connections then cost about 1 KB of your memory.', hot: { cn: 'ok', tot: 'ok', res: 'ok' }, sub: { cn: '~1 KB idle', tot: '10k × 4 KB = 40 MB' }, label: { res: '20 MB base + 4 KB × conns' }, rows: [['total', '40 MB', 'ok']] },
      ],
    }),
  ],
  multiloop: [
    'Loop per core',
    B({
      panel: 'Threads',
      nodes: [N('lg', 40, 60, 920, 110, 'client', '10,000 connections'), N('k', 200, 250, 600, 110, 'SO_REUSEPORT', 'kernel spreads connections'), ...LOOPS, N('res', 40, 680, 920, 130, 'result')],
      edges: ['lg>k', 'k>l0', 'k>l1'],
      beats: [
        { note: 'One loop uses one core. The t3.medium has two.', hot: { l0: 'current' }, hide: ['l1', 'k>l1', 'res'], rows: [['cores used', 1, 'warn']] },
        { note: 'Run one event loop per core, each with its own epoll and its own listening socket.', hot: { l0: 'ok', l1: 'ok', k: 'current', 'k>l0': 'accent', 'k>l1': 'accent' }, sub: { l0: '5,012 conns', l1: '4,988 conns' }, hide: ['res'], rows: [['cores used', 2, 'ok']] },
        { note: 'A connection lives on one loop for its whole life, so its state needs no locks.', hot: { res: 'ok' }, label: { res: 'shared-nothing: no locks on hot path' }, sub: { l0: '5,012 conns', l1: '4,988 conns' }, rows: [['locks', 'none', 'ok']] },
        { note: 'Slow work like disk or crypto goes to a worker pool, with results posted back to the owning loop.', hot: { res: 'ok', l0: 'ok', l1: 'ok' }, label: { res: 'loops for I/O, pool for CPU-heavy work' }, sub: { l0: 'never blocks', l1: 'never blocks' }, rows: [['pattern', 'reactor + workers']] },
      ],
    }),
  ],
  zerocopy: [
    'Fewer copies & syscalls',
    B({
      panel: 'Copies',
      nodes: [N('d', 40, 60, 290, 120, 'disk', 'page cache'), N('u', 355, 60, 290, 120, 'user buffer'), N('s', 670, 60, 290, 120, 'send buffer'), N('sf', 200, 300, 600, 120, 'sendfile()'), N('res', 40, 560, 920, 130, 'result')],
      edges: ['d>u', 'u>s'],
      beats: [
        { note: 'read() then send() copies file bytes into your buffer and back out, with two syscalls per chunk.', hot: { u: 'warn', 'd>u': 'accent', 'u>s': 'accent' }, hide: ['sf', 'res'], rows: [['copies', 2, 'warn']] },
        { note: 'sendfile() moves page-cache pages to the socket inside the kernel.', hot: { sf: 'ok', d: 'read', s: 'write' }, hide: ['u', 'res'], rows: [['copies', 1, 'ok']] },
        { note: 'Also batch: writev for headers plus body, and handle many events per epoll_wait.', hot: { res: 'ok' }, label: { res: 'writev · batching · reuse buffers' }, hide: ['u'], rows: [['syscalls', 'fewer', 'ok']] },
        { note: 'Profile before tuning: perf and strace -c show where time goes.', hot: { res: 'ok' }, label: { res: 'perf top · strace -c -p PID' }, hide: ['u'], rows: [['rule', 'measure first']] },
      ],
    }),
  ],
});
