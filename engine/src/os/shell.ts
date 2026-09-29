// Shell & tools (group machine-os-shell): fds and pipes, redirection order, exit codes, make's dependency graph.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Beat, Board } from '../machine/lib/board';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const G = 'machine-os-shell';

const PIPE_NODES = [
  N('sh', 360, 280, 280, 100, 'bash', 'parses the line', { detail: d('The shell', 'Parses the line, creates pipes, forks one child per command, wires their fds with dup2, then waits for the whole pipeline.', '$ strace -f -e trace=pipe2,dup2,execve bash -c "ps aux | grep nginx | wc -l"') }),
  N('ps', 40, 470, 260, 110, 'ps aux', 'fd1 → pipe A', { detail: d('ps aux', 'Writes every process line to fd 1, which is now pipe A instead of the terminal. It doesn’t know or care.', '$ ls -l /proc/<ps pid>/fd/1\n1 -> pipe:[88731]') }),
  N('grep', 370, 470, 260, 110, 'grep nginx', 'fd0 ← A · fd1 → B', { detail: d('grep nginx', 'Reads pipe A on fd 0, writes matches to pipe B on fd 1. All three commands run at the same time, streaming.', '$ ps aux | grep [n]ginx   # [n] trick: grep won’t match itself') }),
  N('wc', 700, 470, 260, 110, 'wc -l', 'fd0 ← B', { detail: d('wc -l', 'Counts lines from pipe B until it sees EOF, which happens once grep exits and closes its end.', '$ ps aux | grep -c nginx   # same result, one fewer process') }),
  N('pipeA', 200, 640, 260, 90, 'pipe A', '64 KiB kernel buffer', { detail: d('A pipe', 'A kernel buffer with a write end and a read end. A writer blocks when it is full and a reader blocks when it is empty; a writer to a pipe with no reader gets SIGPIPE.', '$ yes | head -1   # yes dies of SIGPIPE, exit 141\ny') }),
  N('pipeB', 540, 640, 260, 90, 'pipe B', 'kernel buffer'),
  N('tty', 360, 800, 280, 100, 'terminal', '/dev/pts/1', { detail: d('The terminal', 'Where fd 0/1/2 point by default. Redirections and pipes simply point them elsewhere before exec.', '$ tty\n/dev/pts/1\n$ ls -l /proc/$$/fd/0\n0 -> /dev/pts/1') }),
];
const PIPE_EDGES = ['sh>ps', 'sh>grep', 'sh>wc', 'ps>pipeA', 'pipeA>grep', 'grep>pipeB', 'pipeB>wc', 'wc>tty'];
const pipeBoard = (code: string[], beats: Beat[]): Board => ({ panel: 'Shell', codeTitle: 'shell', code, nodes: PIPE_NODES, edges: PIPE_EDGES, beats });

const REDIR_NODES = [
  N('cmd', 360, 300, 280, 100, 'cmd', 'fd 1 and fd 2'),
  N('fd1', 120, 500, 300, 100, 'fd 1 (stdout)', '→ terminal', { detail: d('stdout', 'Normal output. Redirected with > (truncate) or >> (append).', '$ cmd > out.log\n$ cmd >> out.log') }),
  N('fd2', 580, 500, 300, 100, 'fd 2 (stderr)', '→ terminal', { detail: d('stderr', 'Errors and diagnostics, unbuffered, kept separate so a pipe only carries data.', '$ cmd 2> err.log\n$ cmd 2>/dev/null') }),
  N('file', 120, 720, 300, 100, 'out.log', 'file', { detail: d('Redirection is dup2', '> out.log opens the file and dup2()s it onto fd 1 before exec. 2>&1 means "make fd 2 a copy of whatever fd 1 is right now", which is why order matters.', '$ cmd > out.log 2>&1   # both into the file\n$ cmd 2>&1 > out.log   # stderr still on terminal\n$ cmd &> out.log       # bash shorthand') }),
  N('term', 580, 720, 300, 100, 'terminal', '/dev/pts/1'),
];
const REDIR_EDGES = ['cmd>fd1', 'cmd>fd2', 'fd1>file', 'fd2>term'];
const redirBoard = (code: string[], beats: Beat[]): Board => ({ panel: 'Redirection', codeTitle: 'shell', code, nodes: REDIR_NODES, edges: REDIR_EDGES, beats });

const MAKE_NODES = [
  N('app', 360, 300, 280, 100, 'app', 'final binary', { detail: d('A target', 'A file make can build, with prerequisites and a recipe. Make rebuilds it only when a prerequisite is newer.', 'app: main.o util.o\n\t$(CC) -o $@ $^') }),
  N('main', 120, 500, 280, 100, 'main.o', '← main.c util.h', { detail: d('Pattern rule', 'One rule builds every .o from its .c; $< is the first prerequisite, $@ the target.', '%.o: %.c util.h\n\t$(CC) -c $< -o $@') }),
  N('util', 600, 500, 280, 100, 'util.o', '← util.c util.h'),
  N('mainc', 40, 720, 220, 90, 'main.c'),
  N('hdr', 390, 720, 220, 90, 'util.h', 'shared header', { detail: d('A shared header', 'Listed as a prerequisite of both objects, so touching it rebuilds both. Forget to list it and make silently uses stale objects; gcc -MMD generates these deps.', 'CFLAGS += -MMD -MP\n-include $(OBJS:.o=.d)') }),
  N('utilc', 740, 720, 220, 90, 'util.c'),
  N('phony', 40, 300, 260, 100, '.PHONY: clean', 'not a file', { detail: d('.PHONY', 'Targets that are commands, not files. Without .PHONY, a file named clean would make "make clean" do nothing.', '.PHONY: clean test\nclean:\n\trm -f app *.o') }),
];
const MAKE_EDGES = ['main>app', 'util>app', 'mainc>main', 'hdr>main', 'hdr>util', 'utilc>util'];
const makeBoard = (code: string[], beats: Beat[]): Board => ({ panel: 'make', codeTitle: 'Makefile', code, nodes: MAKE_NODES, edges: MAKE_EDGES, beats });
const MAKEFILE = ['app: main.o util.o', '  $(CC) -o $@ $^', '%.o: %.c util.h', '  $(CC) -c $< -o $@', '.PHONY: clean'];

boardDemo(G, 'os-shell', 'Shell, fds & make', 'What the shell does for a pipeline (fork, pipe, dup2), why 2>&1 order matters, exit codes, and how make decides what to rebuild.', {
  pipe: [
    'A pipeline',
    pipeBoard(['$ ps aux | grep nginx | wc -l'], [
      { note: 'bash parses the line and calls pipe() twice, creating two kernel buffers.', hl: [0], hot: { sh: 'current', pipeA: 'write', pipeB: 'write' }, hide: ['ps', 'grep', 'wc', 'tty'], rows: [['syscalls', 'pipe2 ×2']] },
      { note: 'It forks three children; each one dup2s its pipe ends onto fd 0 or fd 1, then execs its program.', hot: { ps: 'current', grep: 'current', wc: 'current', 'sh>ps': 'accent', 'sh>grep': 'accent', 'sh>wc': 'accent' }, hide: ['tty'], rows: [['processes', 3], ['running', 'at once']] },
      { note: 'ps writes lines into pipe A while grep reads them, and grep’s matches flow into pipe B.', hot: { 'ps>pipeA': 'accent', 'pipeA>grep': 'accent', 'grep>pipeB': 'accent' }, hide: ['tty'], rows: [['data', 'streaming']] },
      { note: 'wc reads until EOF, which arrives when grep exits and closes pipe B, then prints 3.', hot: { wc: 'ok', tty: 'ok', 'pipeB>wc': 'accent', 'wc>tty': 'accent' }, rows: [['output', 3, 'ok']] },
      { note: 'The pipeline’s status is wc’s alone; set -o pipefail makes any failure count.', hot: { sh: 'warn' }, rows: [['$?', 'last command'], ['fix', 'set -euo pipefail']] },
    ]),
  ],
  redirect: [
    '2>&1 order',
    redirBoard(['$ cmd > out.log 2>&1', '$ cmd 2>&1 > out.log'], [
      { note: 'Every process starts with fd 1 and fd 2 pointing at the terminal.', hot: { cmd: 'current' }, rows: [['fd 1', 'tty'], ['fd 2', 'tty']] },
      { note: 'In > out.log 2>&1, fd 1 is pointed at the file first, then fd 2 copies fd 1, so both land in the file.', hl: [0], hot: { file: 'ok', 'fd1>file': 'accent', fd2: 'ok' }, sub: { fd1: '→ out.log', fd2: '→ out.log' }, hide: ['term'], rows: [['fd 2', 'out.log', 'ok']] },
      { note: 'Reversed, 2>&1 copies fd 1 while it is still the terminal, and only then does fd 1 move to the file.', hl: [1], hot: { fd2: 'warn', term: 'warn', 'fd2>term': 'accent', 'fd1>file': 'accent' }, sub: { fd1: '→ out.log', fd2: '→ terminal' }, rows: [['fd 2', 'terminal', 'warn']] },
      { note: 'Redirections apply left to right, each one a dup2; &> is bash shorthand for both.', hot: { file: 'ok' }, sub: { fd1: '→ out.log', fd2: '→ out.log' }, hide: ['term'], rows: [['shorthand', '&> out.log']] },
    ]),
  ],
  make: [
    'make: what to rebuild',
    makeBoard(MAKEFILE, [
      { note: 'make reads rules as a dependency graph: app needs main.o and util.o, each needs its .c and util.h.', hl: [0, 2], hot: { app: 'current', 'main>app': 'accent', 'util>app': 'accent' }, rows: [['targets', 3]] },
      { note: 'It compares modification times bottom-up, and nothing is newer than its target, so it does nothing.', hot: { main: 'ok', util: 'ok', app: 'ok' }, rows: [['make', 'up to date', 'ok']] },
      { note: 'Edit util.c: util.o is now older than a prerequisite, so it recompiles, and app relinks.', hl: [3], hot: { utilc: 'warn', util: 'write', app: 'write', 'utilc>util': 'accent', 'util>app': 'accent' }, rows: [['rebuilt', 'util.o, app']] },
      { note: 'Edit util.h: both objects depend on it, so both recompile, and make -j2 builds them in parallel.', hot: { hdr: 'warn', main: 'write', util: 'write', app: 'write', 'hdr>main': 'accent', 'hdr>util': 'accent' }, rows: [['rebuilt', 'main.o, util.o, app'], ['parallel', 'make -j2']] },
      { note: 'Mark command targets .PHONY so a stray file named clean can’t block them.', hl: [4], hot: { phony: 'current' }, rows: [['automatic vars', '$@ $< $^']] },
    ]),
  ],
});
