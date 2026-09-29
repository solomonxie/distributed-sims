// Processes & signals (group machine-os-process): fork/exec/wait as syscalls, zombies and orphans, states, signals, scheduling.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Beat, Board } from '../machine/lib/board';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const G = 'machine-os-process';

const PROC_NODES = [
  N('parent', 40, 300, 280, 110, 'bash', 'pid 100', { detail: d('Parent process', 'Your shell. To run a command it forks a copy of itself, and the copy replaces its program with the command.', '$ echo $$\n100\n$ ps -o pid,ppid,stat,cmd -p $$\n  PID  PPID STAT CMD\n  100    99 Ss   -bash') }),
  N('child', 680, 300, 280, 110, 'child', 'pid 101', { detail: d('Child process', 'Starts as an exact copy of the parent (copy-on-write pages, same open fds). exec then loads a new program into it; the pid stays.', '$ ls &\n[1] 101\n$ cat /proc/101/status | head -4\nName:  ls\nState: R (running)\nPid:   101\nPPid:  100') }),
  N('kern', 270, 560, 460, 120, 'kernel', 'syscalls · scheduler', { detail: d('The kernel side', 'Every step here is a syscall: user space asks, the kernel does it and returns. strace shows the exact calls.', '$ strace -f -e trace=clone,execve,wait4 bash -c ls\nclone(…) = 101\n[pid 101] execve("/usr/bin/ls", …) = 0\nwait4(-1, [{WIFEXITED(s) && WEXITSTATUS(s) == 0}], …) = 101') }),
  N('init', 40, 800, 280, 110, 'systemd', 'pid 1 · reaper', { detail: d('PID 1 adopts orphans', 'When a parent dies first, its children are re-parented to PID 1 (or the nearest subreaper), which waits on them so they don’t stay zombies.', '$ ps -o pid,ppid,cmd -p 101\n  PID  PPID CMD\n  101     1 sleep 100') }),
  N('table', 680, 800, 280, 110, 'process table', 'task_struct', { detail: d('The process table', 'The kernel keeps a task_struct per process: state, pid, parent, open files, memory map. A zombie is just this entry kept until the parent reads the exit code.', '$ ps -eo pid,stat,cmd | awk \'$2 ~ /Z/\'\n  123 Z    [worker] <defunct>') }),
];
const PROC_EDGES = ['parent>kern', 'kern>child', 'child>kern', 'kern>parent', 'kern>table', 'kern>init'];
const procBoard = (code: string[], beats: Beat[]): Board => ({ panel: 'Process', codeTitle: 'run.c', code, nodes: PROC_NODES, edges: PROC_EDGES, beats });
const FORK = ['pid_t pid = fork();', 'if (pid == 0) {', '  execvp("ls", argv);   // child', '}', 'waitpid(pid, &status, 0); // parent'];

boardDemo(G, 'os-process', 'fork, exec, wait', 'How a shell runs a command: fork → exec → exit → wait, zombies and orphans, process states and scheduling.', {
  fork: [
    'fork → exec → wait',
    procBoard(FORK, [
      { note: 'You type ls: the shell calls fork(), a syscall into the kernel.', hl: [0], hot: { parent: 'current', 'parent>kern': 'accent', kern: 'current' }, hide: ['child', 'init', 'table'], rows: [['syscall', 'clone()']] },
      { note: 'The kernel copies the process: new pid 101, same memory (copy-on-write) and same open fds.', hl: [0], hot: { child: 'write', 'kern>child': 'accent', table: 'write', 'kern>table': 'accent' }, hide: ['init'], rows: [['fork returns', 'child 0 · parent 101']] },
      { note: 'The child calls execve("ls"): the kernel throws away its memory and loads /usr/bin/ls.', hl: [1, 2], hot: { child: 'current', 'child>kern': 'accent' }, sub: { child: 'pid 101 · ls' }, hide: ['init'], rows: [['syscall', 'execve()'], ['pid', '101 (unchanged)']] },
      { note: 'Meanwhile the parent blocks in waitpid(), sleeping until its child changes state.', hl: [4], hot: { parent: 'visited', 'parent>kern': 'accent' }, sub: { parent: 'pid 100 · S (sleeping)', child: 'pid 101 · ls' }, hide: ['init'], rows: [['parent', 'S sleeping']] },
      { note: 'ls calls exit(0); the kernel frees its memory and sends SIGCHLD to the parent.', hot: { child: 'visited', 'child>kern': 'accent', 'kern>parent': 'accent', parent: 'current' }, sub: { child: 'exited (0)' }, hide: ['init'], rows: [['signal', 'SIGCHLD']] },
      { note: 'waitpid returns the exit status and the kernel removes pid 101 from the table.', hl: [4], hot: { parent: 'ok', table: 'ok' }, hide: ['child', 'init'], rows: [['$?', 0, 'ok']] },
    ]),
  ],
  zombie: [
    'Zombies & orphans',
    procBoard(['// parent forgot to call waitpid()', 'if (fork() == 0) exit(1);', 'for (;;) serve();'], [
      { note: 'The child exits, but its parent never calls wait.', hl: [1], hot: { child: 'visited', 'child>kern': 'accent' }, sub: { child: 'exited (1)' }, hide: ['init'], rows: [['child', 'exited']] },
      { note: 'Its memory is freed, yet its table entry stays so the exit code can still be read: a zombie, state Z.', hot: { table: 'warn', 'kern>table': 'accent' }, sub: { table: 'pid 101 · Z <defunct>' }, hide: ['init'], rows: [['state', 'Z', 'warn']] },
      { note: 'kill -9 does nothing to a zombie, since it is already dead; fix or restart the parent instead.', hot: { table: 'fail', parent: 'warn' }, sub: { table: 'pid 101 · Z <defunct>' }, hide: ['init'], rows: [['kill -9', 'no effect', 'fail']] },
      { note: 'If the parent dies, PID 1 adopts the child and reaps it right away.', hot: { init: 'ok', 'kern>init': 'accent', table: 'ok' }, sub: { parent: 'exited', table: 'pid 101 reaped' }, rows: [['new ppid', 1, 'ok']] },
    ]),
  ],
  states: [
    'Process states',
    procBoard(['$ ps -eo pid,stat,wchan,cmd'], [
      { note: 'R means running or ready: on a CPU, or in the run queue waiting for one.', hot: { child: 'current' }, sub: { child: 'R · running' }, hide: ['init'], rows: [['R', 'on CPU or runnable']] },
      { note: 'S is an interruptible sleep: blocked on a socket, a pipe or a timer, and a signal can wake it.', hot: { child: 'read' }, sub: { child: 'S · read(sock)' }, hide: ['init'], rows: [['S', 'waiting, wakeable']] },
      { note: 'D is uninterruptible sleep, usually disk or NFS I/O, and even SIGKILL waits until it returns.', hot: { child: 'warn' }, sub: { child: 'D · nfs_wait' }, hide: ['init'], rows: [['D', 'stuck in I/O', 'warn']] },
      { note: 'T is stopped by SIGSTOP or Ctrl-Z, and Z is a zombie awaiting wait().', hot: { child: 'visited', table: 'read' }, sub: { child: 'T · stopped' }, hide: ['init'], rows: [['load average', 'counts R + D']] },
    ]),
  ],
  sched: [
    'Scheduling & nice',
    procBoard(['$ nice -n 10 make -j8', '$ renice +5 -p 101', '$ ionice -c3 rsync …'], [
      { note: 'The scheduler (CFS/EEVDF) splits CPU time between runnable tasks by weight.', hot: { kern: 'current' }, hide: ['init', 'table'], rows: [['policy', 'SCHED_OTHER']] },
      { note: 'nice 10 lowers a task’s weight so it gets roughly a tenth of what a nice 0 task gets under contention.', hl: [0], hot: { child: 'read' }, sub: { child: 'nice 10 · make' }, hide: ['init', 'table'], rows: [['nice 0 weight', 1024], ['nice 10 weight', 110]] },
      { note: 'Only root can raise priority below 0; any user can renice their own tasks upward.', hl: [1], hot: { parent: 'current' }, hide: ['init', 'table'], rows: [['renice', '+5']] },
      { note: 'For hard limits, put the process in a cgroup with cpu.max, since nice only matters under contention.', hl: [2], hot: { kern: 'ok' }, hide: ['init', 'table'], rows: [['cap', 'cpu.max 50000 100000']] },
    ]),
  ],
});

// ---------------- signals ----------------
const SIG_NODES = [
  N('you', 40, 300, 260, 110, 'you', 'kill / Ctrl-C', { detail: d('Sending a signal', 'kill sends any signal by pid; the terminal turns Ctrl-C into SIGINT and Ctrl-Z into SIGTSTP for the foreground process group.', '$ kill -TERM 4242     # polite: please exit\n$ kill -KILL 4242     # no handler, no cleanup\n$ kill -l | head -2') }),
  N('kern', 370, 300, 260, 110, 'kernel', 'pending signals', { detail: d('Delivery', 'The kernel marks the signal pending on the target and delivers it when the process next returns to user space. Blocked signals wait until unblocked.', '$ grep Sig /proc/4242/status\nSigPnd: 0000000000000000\nSigBlk: 0000000000000000\nSigCgt: 0000000000004002') }),
  N('proc', 700, 300, 260, 110, 'server', 'pid 4242', { detail: d('The target process', 'Each signal has a default action (terminate, core dump, stop, ignore) unless the process installed a handler. SIGKILL and SIGSTOP can’t be caught.', 'trap \'echo cleaning up; rm -f $LOCK; exit 0\' TERM INT\n# Python: signal.signal(signal.SIGTERM, handler)') }),
  N('handler', 700, 520, 260, 110, 'handler', 'trap / sigaction', { detail: d('A signal handler', 'Runs on the process’s own stack, interrupting whatever it was doing. Keep it tiny: set a flag, let the main loop shut down cleanly.', 'volatile sig_atomic_t stop = 0;\nvoid on_term(int) { stop = 1; }\nsignal(SIGTERM, on_term);\nwhile (!stop) serve_one();') }),
  N('parent', 370, 520, 260, 110, 'parent', 'gets SIGCHLD', { detail: d('SIGCHLD', 'Sent to the parent whenever a child exits or stops. A server that forks workers handles it by calling waitpid in a loop.', 'while (waitpid(-1, &st, WNOHANG) > 0) {}') }),
  N('dead', 40, 520, 260, 110, 'exit status', '128 + signal', { detail: d('Exit status after a signal', 'A process killed by signal N exits with status 128+N in the shell: 130 for SIGINT, 137 for SIGKILL (the OOM killer’s signature), 143 for SIGTERM.', '$ sleep 100; echo $?\n^C\n130') }),
];
const SIG_EDGES = ['you>kern', 'kern>proc', 'proc>handler', 'proc>parent', 'parent>dead'];
const sigBoard = (beats: Beat[]): Board => ({ panel: 'Signal', nodes: SIG_NODES, edges: SIG_EDGES, beats });

boardDemo(G, 'os-signals', 'Signals', 'SIGTERM vs SIGKILL, handlers and traps, Ctrl-C to the foreground group, SIGCHLD and exit codes.', {
  term: [
    'SIGTERM + trap',
    sigBoard([
      { note: 'kill 4242 sends SIGTERM, the polite request to exit.', hot: { you: 'current', 'you>kern': 'accent' }, hide: ['handler', 'parent', 'dead'], rows: [['signal', 'SIGTERM (15)']] },
      { note: 'The kernel marks it pending and delivers it when the process next leaves a syscall.', hot: { kern: 'current', 'kern>proc': 'accent' }, hide: ['handler', 'parent', 'dead'], rows: [['pending', 'SIGTERM']] },
      { note: 'The process installed a handler, so its code runs instead of the default action.', hot: { handler: 'current', 'proc>handler': 'accent' }, hide: ['parent', 'dead'], rows: [['action', 'handler']] },
      { note: 'It finishes in-flight requests, removes its lock file and exits 0: a graceful shutdown.', hot: { handler: 'ok', proc: 'ok' }, sub: { proc: 'exit 0' }, hide: ['parent', 'dead'], rows: [['exit', 0, 'ok']] },
    ]),
  ],
  kill: [
    'SIGKILL',
    sigBoard([
      { note: 'kill -9 sends SIGKILL.', hot: { you: 'fail', 'you>kern': 'fail' }, hide: ['handler', 'parent', 'dead'], rows: [['signal', 'SIGKILL (9)']] },
      { note: 'SIGKILL can’t be caught or ignored: the kernel ends the process without running its code.', hot: { proc: 'fail', 'kern>proc': 'fail' }, hide: ['handler', 'parent', 'dead'], rows: [['cleanup', 'none', 'fail']] },
      { note: 'Locks, temp files and half-written data stay behind, and the parent gets SIGCHLD.', hot: { parent: 'current', 'proc>parent': 'accent' }, hide: ['handler', 'dead'], rows: [['leftovers', 'yes', 'warn']] },
      { note: 'The shell reports 137, the same code the OOM killer leaves; use -9 only after TERM failed.', hot: { dead: 'fail', 'parent>dead': 'accent' }, hide: ['handler'], rows: [['exit', 137, 'fail']] },
    ]),
  ],
  interrupt: [
    'Ctrl-C & Ctrl-Z',
    sigBoard([
      { note: 'Ctrl-C in the terminal becomes SIGINT for every process in the foreground group.', hot: { you: 'current', 'you>kern': 'accent' }, label: { you: 'terminal' }, hide: ['handler', 'parent', 'dead'], rows: [['signal', 'SIGINT (2)']] },
      { note: 'With no handler the default action terminates it, and the shell prints status 130.', hot: { proc: 'visited', dead: 'current', 'kern>proc': 'accent' }, label: { you: 'terminal' }, hide: ['handler', 'parent'], rows: [['exit', 130]] },
      { note: 'Ctrl-Z sends SIGTSTP: the job stops (state T) and bg or fg resumes it with SIGCONT.', hot: { proc: 'warn' }, label: { you: 'terminal' }, sub: { proc: 'T · stopped' }, hide: ['handler', 'parent', 'dead'], rows: [['resume', 'fg / bg']] },
    ]),
  ],
  chld: [
    'SIGCHLD & reaping',
    sigBoard([
      { note: 'A worker process exits.', hot: { proc: 'visited' }, label: { proc: 'worker' }, sub: { proc: 'exit 1' }, hide: ['handler', 'dead'], rows: [['child', 'exited']] },
      { note: 'The kernel sends SIGCHLD to its parent.', hot: { parent: 'current', 'proc>parent': 'accent' }, label: { proc: 'worker' }, hide: ['handler', 'dead'], rows: [['signal', 'SIGCHLD']] },
      { note: 'The parent calls waitpid(-1, WNOHANG) in a loop, collecting every finished child’s status.', hot: { parent: 'ok', dead: 'read', 'parent>dead': 'accent' }, label: { proc: 'worker' }, hide: ['handler'], rows: [['zombies', 0, 'ok']] },
    ]),
  ],
});
