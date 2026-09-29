// Permissions & users (group machine-os-perm): the kernel's access check, setuid, capabilities, sudo.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Beat, Board } from '../machine/lib/board';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const NODES = [
  N('proc', 40, 300, 280, 110, 'process', 'uid 1000 (alice)', { detail: d('Credentials of a process', 'Every process carries a real and an effective uid/gid plus supplementary groups. The kernel checks the effective ones.', '$ id\nuid=1000(alice) gid=1000(alice) groups=1000(alice),27(sudo)\n$ grep Uid /proc/$$/status\nUid: 1000 1000 1000 1000') }),
  N('kern', 370, 300, 260, 110, 'kernel', 'access check', { detail: d('The permission check', 'On open/exec the kernel compares: root (or a capability) bypasses; else if you own the file use the owner bits, else if you are in its group use group bits, else other bits. First match wins.', '# owner match → owner bits only, even if group bits allow more\n$ chmod 070 f && cat f\ncat: f: Permission denied') }),
  N('file', 700, 300, 260, 110, 'file', '-rw-r----- root adm', { detail: d('Mode bits', 'Nine bits: rwx for owner, group, other. Octal 640 = rw- r-- ---. On directories, r lists names, x lets you enter, w lets you create and delete entries.', '$ ls -l /var/log/syslog\n-rw-r----- 1 syslog adm 1.2M syslog\n$ chmod 640 f; chmod u+x,g-w f\n$ chown app:app f') }),
  N('users', 40, 540, 280, 110, '/etc/passwd', 'users & groups', { detail: d('Users and groups', 'Users live in /etc/passwd, password hashes in /etc/shadow (root-only), groups in /etc/group. Service accounts get a nologin shell.', '$ getent passwd app\napp:x:998:998::/srv/app:/usr/sbin/nologin\n$ sudo useradd -r -s /usr/sbin/nologin app\n$ sudo usermod -aG docker alice') }),
  N('special', 370, 540, 260, 110, 'special bits', 'setuid · setgid · sticky', { detail: d('setuid, setgid, sticky', 'setuid on an executable runs it with the file owner’s uid (passwd writes /etc/shadow this way). setgid on a directory makes new files inherit its group. Sticky on /tmp lets only owners delete their files.', '$ ls -l /usr/bin/passwd\n-rwsr-xr-x 1 root root … /usr/bin/passwd\n$ ls -ld /tmp\ndrwxrwxrwt … /tmp\n$ find / -perm -4000 2>/dev/null   # audit setuid') }),
  N('caps', 700, 540, 260, 110, 'capabilities', 'slices of root', { detail: d('Capabilities', 'Root’s power split into ~40 pieces. Give a binary just CAP_NET_BIND_SERVICE to listen on port 80 instead of running it as root.', '$ sudo setcap cap_net_bind_service=+ep ./server\n$ getcap ./server\n./server cap_net_bind_service=ep\n$ capsh --print | head -2') }),
  N('sudo', 370, 770, 260, 110, 'sudo', '/etc/sudoers', { detail: d('sudo', 'A setuid-root program that checks /etc/sudoers, asks for your password, logs the command and runs it as root. Edit rules with visudo only.', '# /etc/sudoers.d/deploy\ndeploy ALL=(root) NOPASSWD: /bin/systemctl restart app\n$ sudo -l   # what am I allowed to run?') }),
];
const EDGES = ['proc>kern', 'kern>file', 'users>proc', 'special>kern', 'caps>kern', 'sudo>special'];
const board = (code: string[], beats: Beat[]): Board => ({ panel: 'Permissions', codeTitle: 'shell', code, nodes: NODES, edges: EDGES, beats });

boardDemo('machine-os-perm', 'os-perm', 'Users, permissions & capabilities', 'How the kernel decides "Permission denied": uid/gid vs rwx bits, setuid binaries, capabilities instead of root, and sudo.', {
  rwx: [
    'rwx check',
    board(['$ cat /var/log/syslog'], [
      { note: 'alice (uid 1000) runs cat, which calls open() on the log.', hl: [0], hot: { proc: 'current', 'proc>kern': 'accent' }, hide: ['special', 'caps', 'sudo'], rows: [['euid', 1000]] },
      { note: 'She is not the owner, so the kernel checks whether she is in group adm.', hot: { kern: 'current', users: 'read', 'users>proc': 'accent' }, hide: ['special', 'caps', 'sudo'], rows: [['owner', 'syslog (no)'], ['group adm', 'no']] },
      { note: 'Neither matches, so the other bits apply, and they are ---.', hot: { file: 'fail', 'kern>file': 'fail' }, hide: ['special', 'caps', 'sudo'], rows: [['other', '---', 'fail']] },
      { note: 'open() returns EACCES; the fix is usermod -aG adm alice, not chmod 777.', hot: { proc: 'fail' }, hide: ['special', 'caps', 'sudo'], rows: [['errno', 'EACCES'], ['fix', 'add to group adm', 'ok']] },
    ]),
  ],
  setuid: [
    'setuid: passwd',
    board(['$ passwd', '$ ls -l /usr/bin/passwd /etc/shadow'], [
      { note: 'alice runs passwd, which must write /etc/shadow, a root-only file.', hl: [0], hot: { proc: 'current', file: 'read' }, label: { file: '/etc/shadow' }, sub: { file: '-rw-r----- root shadow' }, hide: ['caps', 'sudo'], rows: [['euid', 1000]] },
      { note: 'The passwd binary has the setuid bit, so exec gives the process the file owner’s uid.', hl: [1], hot: { special: 'current', 'special>kern': 'accent' }, label: { file: '/etc/shadow' }, hide: ['caps', 'sudo'], rows: [['mode', '-rwsr-xr-x']] },
      { note: 'Effective uid is now 0 while the real uid stays 1000, so passwd knows who called it.', hot: { proc: 'warn', kern: 'current' }, sub: { proc: 'ruid 1000 · euid 0' }, label: { file: '/etc/shadow' }, hide: ['caps', 'sudo'], rows: [['euid', 0, 'warn']] },
      { note: 'The write is allowed; every setuid-root binary is attack surface, so audit them with find -perm -4000.', hot: { file: 'ok', 'kern>file': 'accent' }, label: { file: '/etc/shadow' }, hide: ['caps', 'sudo'], rows: [['write', 'allowed', 'ok']] },
    ]),
  ],
  caps: [
    'Capabilities',
    board(['$ ./server --port 80', '$ sudo setcap cap_net_bind_service=+ep ./server'], [
      { note: 'Binding a port below 1024 is privileged, so as alice the bind fails.', hl: [0], hot: { proc: 'fail', 'proc>kern': 'fail' }, label: { file: 'port 80' }, sub: { file: 'privileged port' }, hide: ['special', 'sudo'], rows: [['bind', 'EACCES', 'fail']] },
      { note: 'Running the whole server as root would work, but then any bug in it owns the machine.', hot: { kern: 'warn' }, label: { file: 'port 80' }, sub: { file: 'privileged port' }, hide: ['special', 'sudo'], rows: [['as root', 'too much power', 'warn']] },
      { note: 'Grant just CAP_NET_BIND_SERVICE on the binary instead.', hl: [1], hot: { caps: 'current', 'caps>kern': 'accent' }, label: { file: 'port 80' }, sub: { file: 'privileged port' }, hide: ['special', 'sudo'], rows: [['caps', 'net_bind_service']] },
      { note: 'Now the kernel lets it bind 80 while everything else is checked as plain uid 1000.', hot: { file: 'ok', proc: 'ok', 'kern>file': 'accent' }, label: { file: 'port 80' }, sub: { file: 'listening' }, hide: ['special', 'sudo'], rows: [['bind', 'ok', 'ok']] },
    ]),
  ],
  sudo: [
    'sudo',
    board(['$ sudo systemctl restart app'], [
      { note: 'sudo is itself a setuid-root binary.', hl: [0], hot: { sudo: 'current', proc: 'current' }, hide: ['caps'], rows: [['sudo mode', '-rwsr-xr-x']] },
      { note: 'It reads /etc/sudoers to see whether alice may run this command as root.', hot: { sudo: 'read', users: 'read' }, hide: ['caps'], rows: [['rule', '%sudo ALL=(ALL) ALL']] },
      { note: 'It asks for her password, logs the command, then execs systemctl with uid 0.', hot: { special: 'current', 'sudo>special': 'accent', 'special>kern': 'accent' }, hide: ['caps'], rows: [['log', '/var/log/auth.log']] },
      { note: 'Grant narrow rules like one exact command with NOPASSWD, and always edit with visudo.', hot: { sudo: 'ok', kern: 'ok' }, hide: ['caps'], rows: [['edit with', 'visudo']] },
    ]),
  ],
});
