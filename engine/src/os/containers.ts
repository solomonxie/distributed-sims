// Namespaces & cgroups → containers (group machine-os-containers): what a container really is, Docker's layers, Firecracker microVMs.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Beat, Board } from '../machine/lib/board';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const G = 'machine-os-containers';

const NS_NODES = [
  N('host', 40, 290, 280, 110, 'host', 'pid 1 = systemd', { detail: d('The host', 'One kernel, one set of namespaces everyone starts in. ls -l /proc/$$/ns shows which ones a process uses.', '$ ls -l /proc/$$/ns\npid -> pid:[4026531836]\nnet -> net:[4026531840]\nmnt -> mnt:[4026531841]\nuts -> uts:[4026531838]') }),
  N('unshare', 370, 290, 260, 110, 'unshare()', 'clone(CLONE_NEW*)', { detail: d('unshare / clone', 'Syscalls that give a process new namespaces. The unshare command wraps them; container runtimes call clone() with CLONE_NEWPID|CLONE_NEWNET|CLONE_NEWNS|… flags.', '$ sudo unshare --pid --net --uts --mount --fork --mount-proc bash\n# hostname box1\n# ps aux\nPID USER COMMAND\n  1 root bash') }),
  N('box', 700, 290, 260, 110, 'the "container"', 'bash as pid 1', { detail: d('A process with its own view', 'Still an ordinary process on the host kernel. It just sees its own pid numbers, network stack, mount table and hostname.', '# inside: ps shows 2 processes\n# on the host: it is pid 51234\n$ ps -o pid,cmd -p 51234\n51234 bash') }),
  N('pidns', 40, 520, 210, 100, 'pid ns', 'own pid 1', { detail: d('PID namespace', 'Processes inside get their own numbering starting at 1 and can’t see or signal host processes. The first process becomes that namespace’s reaper: if it exits, all others die.', '$ sudo unshare --pid --fork --mount-proc ps\n  PID CMD\n    1 ps') }),
  N('netns', 270, 520, 210, 100, 'net ns', 'own interfaces', { detail: d('Network namespace', 'A fresh network stack with only lo, down. A veth pair plugs it into a host bridge; this is how docker0 networking works.', '$ sudo ip netns add box\n$ sudo ip link add veth0 type veth peer name veth1\n$ sudo ip link set veth1 netns box\n$ sudo ip netns exec box ip a') }),
  N('mntns', 500, 520, 210, 100, 'mnt ns', 'own mounts, own /', { detail: d('Mount namespace', 'Its own mount table. With pivot_root (or chroot) the container sees an image’s files as /, and its mounts don’t leak to the host.', '$ sudo unshare --mount bash\n# mount -t tmpfs none /mnt   # invisible outside\n# pivot_root new_root old_root') }),
  N('utsns', 730, 520, 230, 100, 'uts · user · ipc', 'hostname, uid map', { detail: d('UTS, user and IPC namespaces', 'UTS gives its own hostname. User namespaces map root inside to an unprivileged uid outside, which is what makes rootless containers safe. IPC isolates shared memory and queues.', '$ unshare --user --map-root-user id\nuid=0(root) gid=0(root)\n$ cat /proc/self/uid_map\n  0  1000  1') }),
  N('cg', 370, 740, 260, 110, 'cgroup v2', 'cpu.max · memory.max', { detail: d('cgroups', 'Namespaces limit what a process sees; cgroups limit what it uses. A directory under /sys/fs/cgroup with files for CPU, memory, IO and pid limits.', '$ sudo mkdir /sys/fs/cgroup/box\n$ echo 50M | sudo tee /sys/fs/cgroup/box/memory.max\n$ echo "50000 100000" | sudo tee …/box/cpu.max   # half a CPU\n$ echo $PID | sudo tee …/box/cgroup.procs') }),
  N('oom', 700, 740, 260, 110, 'OOM kill', 'exit 137', { detail: d('Hitting memory.max', 'Over the limit the kernel reclaims, then OOM-kills a process inside the cgroup, not the host. Docker reports OOMKilled and exit 137.', '$ cat /sys/fs/cgroup/box/memory.events\noom 1\noom_kill 1\n$ docker inspect -f "{{.State.OOMKilled}}" app\ntrue') }),
];
const NS_EDGES = ['host>unshare', 'unshare>box', 'box>pidns', 'box>netns', 'box>mntns', 'box>utsns', 'box>cg', 'cg>oom'];
const nsBoard = (code: string[], beats: Beat[]): Board => ({ panel: 'Isolation', codeTitle: 'shell', code, nodes: NS_NODES, edges: NS_EDGES, beats });
const NS_ALL = ['pidns', 'netns', 'mntns', 'utsns', 'cg', 'oom'];
const except = (...keep: string[]) => NS_ALL.filter((x) => !keep.includes(x));

boardDemo(G, 'os-namespaces', 'Namespaces & cgroups', 'A container is a process: unshare gives it its own pid, net, mount, uts and user namespaces; cgroups cap its CPU and memory.', {
  pid: [
    'PID namespace',
    nsBoard(['$ sudo unshare --pid --fork --mount-proc bash', '# ps aux'], [
      { note: 'A normal shell sees every process on the host.', hot: { host: 'current' }, hide: ['unshare', 'box', ...NS_ALL], rows: [['visible pids', '~300']] },
      { note: 'unshare calls clone with CLONE_NEWPID, so the kernel starts a fresh pid numbering.', hl: [0], hot: { unshare: 'current', 'host>unshare': 'accent' }, hide: ['box', ...NS_ALL], rows: [['syscall', 'clone(CLONE_NEWPID)']] },
      { note: 'Inside, bash is pid 1 and ps shows only two processes.', hl: [1], hot: { box: 'current', pidns: 'write', 'unshare>box': 'accent', 'box>pidns': 'accent' }, hide: except('pidns'), rows: [['visible pids', 2, 'ok']] },
      { note: 'On the host it is just pid 51234, and host root can still see and kill it.', hot: { host: 'read', box: 'read' }, sub: { box: 'host pid 51234' }, hide: except('pidns'), rows: [['host view', 'pid 51234']] },
    ]),
  ],
  net: [
    'Network namespace',
    nsBoard(['$ sudo ip netns add box', '$ sudo ip netns exec box ip a'], [
      { note: 'A new network namespace has its own interfaces, routes, iptables and ports.', hl: [0], hot: { netns: 'current', 'box>netns': 'accent' }, hide: except('netns'), rows: [['interfaces', 'lo (down)']] },
      { note: 'It is cut off until a veth pair connects it to a bridge on the host.', hot: { netns: 'warn', host: 'read' }, hide: except('netns'), rows: [['reach host', 'no', 'warn']] },
      { note: 'With veth + bridge + NAT it gets 172.17.0.2 and reaches the internet, which is what docker0 does.', hl: [1], hot: { netns: 'ok', host: 'ok' }, sub: { netns: 'eth0 172.17.0.2' }, hide: except('netns'), rows: [['route', 'via 172.17.0.1'], ['NAT', 'MASQUERADE']] },
      { note: 'Two containers can both listen on port 80 because each namespace has its own port space.', hot: { box: 'ok' }, hide: except('netns'), rows: [['port 80', 'per namespace', 'ok']] },
    ]),
  ],
  mount: [
    'Mount namespace',
    nsBoard(['$ sudo unshare --mount bash', '# mount -t tmpfs none /mnt', '# pivot_root ./rootfs ./rootfs/old'], [
      { note: 'The new mount namespace starts as a copy of the host’s mount table.', hl: [0], hot: { mntns: 'current', 'box>mntns': 'accent' }, hide: except('mntns'), rows: [['mounts', 'copied']] },
      { note: 'Mounts made inside stay inside, and the host never sees the tmpfs.', hl: [1], hot: { mntns: 'write', host: 'visited' }, hide: except('mntns'), rows: [['leaks to host', 'no', 'ok']] },
      { note: 'pivot_root swaps / for an image’s directory, so the process sees only the image’s files.', hl: [2], hot: { mntns: 'ok', box: 'current' }, sub: { box: '/ = rootfs' }, hide: except('mntns'), rows: [['/', 'image rootfs']] },
    ]),
  ],
  cgroup: [
    'cgroup limits',
    nsBoard(['$ echo 50M > /sys/fs/cgroup/box/memory.max', '$ echo $PID > /sys/fs/cgroup/box/cgroup.procs'], [
      { note: 'Namespaces hide things but limit nothing: the box can still eat all RAM.', hot: { box: 'warn' }, hide: ['oom', 'pidns', 'netns', 'mntns', 'utsns'], rows: [['memory limit', 'none', 'warn']] },
      { note: 'Create a cgroup and set memory.max to 50 MB.', hl: [0], hot: { cg: 'current' }, hide: ['oom', 'pidns', 'netns', 'mntns', 'utsns'], rows: [['memory.max', '50M']] },
      { note: 'Move the process into it by writing its pid to cgroup.procs.', hl: [1], hot: { cg: 'current', 'box>cg': 'accent' }, hide: ['oom', 'pidns', 'netns', 'mntns', 'utsns'], rows: [['members', 1]] },
      { note: 'When it allocates past 50 MB, the kernel OOM-kills it inside the cgroup and the host is untouched.', hot: { oom: 'fail', 'cg>oom': 'fail', box: 'fail' }, hide: ['pidns', 'netns', 'mntns', 'utsns'], rows: [['exit', 137, 'fail'], ['host', 'fine', 'ok']] },
    ]),
  ],
  user: [
    'User namespace (rootless)',
    nsBoard(['$ unshare --user --map-root-user id'], [
      { note: 'An unprivileged user creates a user namespace, no sudo needed.', hl: [0], hot: { utsns: 'current', 'box>utsns': 'accent' }, hide: except('utsns'), rows: [['caller', 'uid 1000']] },
      { note: 'Inside, uid 0 is mapped to host uid 1000, so the process is root only within its box.', hot: { box: 'current', utsns: 'write' }, sub: { box: 'uid 0 → host 1000' }, hide: except('utsns'), rows: [['uid_map', '0 1000 1']] },
      { note: 'Escaping gives an attacker plain uid 1000, which is why rootless Podman and kern build on it.', hot: { host: 'ok' }, hide: except('utsns'), rows: [['breakout gets', 'uid 1000', 'ok']] },
    ]),
  ],
});

// ---------------- containers: images, docker, microVMs ----------------
const CT_NODES = [
  N('cli', 40, 290, 260, 100, 'docker CLI', 'REST over a socket', { detail: d('docker CLI', 'Only a client: it sends REST calls to dockerd over /var/run/docker.sock. Access to that socket is root on the host.', '$ docker run -d -p 8080:80 --memory 256m nginx\n$ curl --unix-socket /var/run/docker.sock http://x/containers/json') }),
  N('dockerd', 370, 290, 260, 100, 'dockerd', 'images · networks', { detail: d('dockerd', 'Pulls images, sets up networks and volumes, and delegates running containers to containerd.', '$ systemctl status docker\n$ docker info | grep -i "storage driver"\nStorage Driver: overlay2') }),
  N('ctrd', 700, 290, 260, 100, 'containerd → runc', 'OCI runtime', { detail: d('containerd and runc', 'containerd supervises containers; runc reads the OCI spec and makes the clone/unshare/cgroup/pivot_root syscalls, then execs your entrypoint and exits.', '$ sudo ctr -n moby containers ls\n$ runc spec   # config.json: namespaces, cgroups, mounts') }),
  N('l1', 40, 470, 280, 70, 'layer: ubuntu base', 'read-only', { detail: d('Image layers', 'Each Dockerfile instruction that changes files makes a read-only layer, content-addressed by digest and shared between images.', '$ docker history nginx\nIMAGE   CREATED BY                SIZE\n…       CMD ["nginx" …]           0B\n…       RUN apt-get install …     58MB') }),
  N('l2', 40, 560, 280, 70, 'layer: apt install', 'read-only'),
  N('l3', 40, 650, 280, 70, 'layer: COPY app', 'read-only'),
  N('upper', 40, 740, 280, 70, 'container layer', 'read-write', { detail: d('The writable layer', 'Each container gets a thin writable layer on top. Changing a lower file copies it up first. It disappears with the container, so data goes in volumes.', '$ docker diff app\nC /etc\nA /etc/app.conf\n$ docker run -v data:/var/lib/app …') }),
  N('merged', 370, 600, 260, 110, 'overlayfs', 'merged view = /', { detail: d('overlayfs', 'Stacks the layers into one directory tree: lookups go top-down, writes go to the upper layer. This is what the container sees as /.', '$ mount | grep overlay\noverlay on /var/lib/docker/overlay2/…/merged type overlay\n(lowerdir=…:…,upperdir=…/diff,workdir=…/work)') }),
  N('proc', 700, 600, 260, 110, 'your process', 'namespaces + cgroup', { detail: d('The running container', 'In the end: your entrypoint process in fresh namespaces, a cgroup with your limits, and overlayfs as its root. Nothing more.', '$ docker top app\nUID   PID    CMD\nroot  51234  nginx: master process\n$ cat /proc/51234/cgroup') }),
  N('vm', 700, 800, 260, 110, 'Firecracker microVM', 'own guest kernel', { detail: d('Firecracker', 'A KVM-based VMM that boots a minimal guest kernel in ~125 ms with ~5 MB overhead. A real VM boundary for untrusted code: Lambda and Fargate run on it.', '$ curl --unix-socket /tmp/fc.sock -X PUT \\\n  http://localhost/boot-source \\\n  -d \'{"kernel_image_path":"vmlinux"}\'\n$ curl … -X PUT …/actions -d \'{"action_type":"InstanceStart"}\'') }),
];
const CT_EDGES = ['cli>dockerd', 'dockerd>ctrd', 'ctrd>proc', 'merged>proc', 'l3>merged'];
const ctBoard = (code: string[], beats: Beat[]): Board => ({ panel: 'Container', codeTitle: 'shell', code, nodes: CT_NODES, edges: CT_EDGES, beats });

boardDemo(G, 'os-containers', 'Images, Docker & microVMs', 'docker run end to end: CLI → dockerd → containerd → runc syscalls; image layers merged by overlayfs; and Firecracker microVMs for stronger isolation.', {
  run: [
    'docker run, end to end',
    ctBoard(['$ docker run -d --memory 256m -p 8080:80 nginx'], [
      { note: 'The CLI sends a create request to dockerd over its unix socket.', hl: [0], hot: { cli: 'current', 'cli>dockerd': 'accent' }, hide: ['vm'], rows: [['API', 'POST /containers/create']] },
      { note: 'dockerd pulls missing layers and prepares the overlay root, network and port mapping.', hot: { dockerd: 'current', merged: 'write', l1: 'read', l2: 'read', l3: 'read' }, hide: ['vm'], rows: [['layers', 3], ['port', '8080 → 80']] },
      { note: 'containerd hands an OCI spec to runc, which calls clone with new namespaces, joins a 256 MB cgroup and pivots into the overlay.', hot: { ctrd: 'current', 'dockerd>ctrd': 'accent', 'ctrd>proc': 'accent' }, hide: ['vm'], rows: [['syscalls', 'clone · pivot_root']] },
      { note: 'runc execs nginx as pid 1 of the container and exits; your app is just a process now.', hot: { proc: 'ok', 'merged>proc': 'accent' }, hide: ['vm'], rows: [['runtime left running', 'none'], ['container', 'up', 'ok']] },
    ]),
  ],
  layers: [
    'Image layers & overlayfs',
    ctBoard(['FROM ubuntu:24.04', 'RUN apt-get install -y nginx', 'COPY app /srv/app'], [
      { note: 'Each instruction that changes files becomes a read-only, content-addressed layer.', hl: [0, 1, 2], hot: { l1: 'current', l2: 'current', l3: 'current' }, hide: ['cli', 'dockerd', 'ctrd', 'upper', 'vm'], rows: [['layers', 3]] },
      { note: 'Starting a container adds one thin writable layer on top.', hot: { upper: 'write' }, hide: ['cli', 'dockerd', 'ctrd', 'vm'], rows: [['writable', 'container layer']] },
      { note: 'overlayfs merges them: reads search top-down, and the first write to a lower file copies it up.', hot: { merged: 'current', 'l3>merged': 'accent', proc: 'read', 'merged>proc': 'accent' }, hide: ['cli', 'dockerd', 'ctrd', 'vm'], rows: [['copy-up', 'on first write']] },
      { note: 'Order the Dockerfile from rarely to often changed, so a code change rebuilds only the last layer.', hl: [2], hot: { l3: 'warn', l1: 'ok', l2: 'ok' }, hide: ['cli', 'dockerd', 'ctrd', 'vm'], rows: [['cached layers', 2, 'ok']] },
    ]),
  ],
  microvm: [
    'Firecracker microVMs',
    ctBoard(['$ firecracker --api-sock /tmp/fc.sock'], [
      { note: 'Containers share the host kernel, so one kernel bug can let untrusted code escape.', hot: { proc: 'warn' }, hide: ['cli', 'dockerd', 'ctrd', 'vm'], rows: [['boundary', 'syscalls', 'warn']] },
      { note: 'Firecracker gives each workload its own guest kernel inside a tiny KVM virtual machine.', hl: [0], hot: { vm: 'current' }, hide: ['cli', 'dockerd', 'ctrd'], rows: [['boundary', 'hardware virtualisation', 'ok']] },
      { note: 'It emulates only a few devices, so it boots in about 125 ms with a few MB of overhead.', hot: { vm: 'ok' }, hide: ['cli', 'dockerd', 'ctrd'], rows: [['boot', '~125 ms'], ['overhead', '~5 MB']] },
      { note: 'The jailer wraps each VMM in namespaces, cgroups and seccomp too, so defence is layered.', hot: { vm: 'ok', proc: 'read' }, hide: ['cli', 'dockerd', 'ctrd'], rows: [['used by', 'Lambda · Fargate']] },
    ]),
  ],
});
