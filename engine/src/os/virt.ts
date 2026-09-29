// Virtual machines & hypervisors (group machine-os-virt): what a VM is, VT-x traps, EPT, virtio, live migration, and the hypervisor landscape.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Beat, Board } from '../machine/lib/board';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const G = 'machine-os-virt';

// ---------------- one VM on one host ----------------
const VM_NODES = [
  N('hw', 40, 300, 280, 100, 'hardware', 'CPU (VT-x) · RAM · NIC', { detail: d('Hardware virtualisation', 'Intel VT-x and AMD-V (2005–06) add a guest mode below ring 0. Guest code runs on the real CPU at full speed; only sensitive instructions trap to the hypervisor.', '$ grep -oE "vmx|svm" /proc/cpuinfo | sort -u\nvmx\n$ lsmod | grep kvm\nkvm_intel  kvm') }),
  N('hv', 370, 300, 260, 100, 'hypervisor', 'KVM · ESXi · Xen', { detail: d('Hypervisor', 'Schedules virtual CPUs onto real ones and owns the hardware. Type 1 runs on bare metal; type 2 runs as an app inside a host OS. KVM makes the Linux kernel itself a type-1 hypervisor.', '$ ls -l /dev/kvm\ncrw-rw---- root kvm /dev/kvm\n# each vCPU: ioctl(vcpu_fd, KVM_RUN)') }),
  N('vmm', 700, 300, 260, 100, 'VMM (QEMU)', 'device models', { detail: d('Virtual machine monitor', 'The userspace half: allocates guest RAM, emulates devices (disk controller, NIC, UART, PCI bus) and handles the VM exits KVM cannot. One QEMU process per VM.', '$ ps -o pid,nlwp,cmd -C qemu-system-x86_64\n4711  9  qemu-system-x86_64 -enable-kvm -smp 4 -m 8G …\n# 4 vCPU threads + I/O threads') }),
  N('hostos', 40, 480, 280, 100, 'host OS', 'type 2 only', { dashed: true, detail: d('Type 2', 'VirtualBox, VMware Workstation and Parallels run inside a normal OS. Same VT-x underneath, one more layer of scheduling and memory management to go through.') }),
  N('guest', 370, 480, 260, 100, 'guest kernel', 'thinks it owns the box', { detail: d('Guest kernel', 'An unmodified OS. It programs page tables, handles interrupts and talks to “devices”, never knowing the hardware is shared. Its physical addresses are a fiction the hypervisor maintains.') }),
  N('app', 700, 480, 260, 100, 'guest apps', 'unchanged binaries', { detail: d('Guest applications', 'Run at native speed: user-mode instructions never trap. What costs is I/O and anything privileged.') }),
  N('vmcs', 40, 660, 280, 100, 'VMCS', 'guest ↔ host state', { detail: d('VM control structure', 'One per vCPU. On a VM exit the CPU saves guest registers here and loads the host’s; VMRESUME does the reverse. It also lists which events cause exits.', 'VM exit reasons (sample):\n  EXTERNAL_INTERRUPT   CPUID\n  IO_INSTRUCTION       EPT_VIOLATION\n  HLT                  CR_ACCESS') }),
  N('ept', 370, 660, 260, 100, 'EPT / NPT', 'guest phys → host phys', { detail: d('Extended page tables', 'A second set of page tables walked by the CPU: guest-physical to host-physical. The guest keeps its own tables untouched; a TLB miss walks both (up to 24 memory reads for 4-level × 4-level).', '# perf stat -e dTLB-load-misses on the host\n# huge pages (2 MB) shorten both walks') }),
  N('virtio', 700, 660, 260, 100, 'virtio-net / blk', 'shared rings', { detail: d('virtio', 'Paravirtual devices: the guest driver knows it is in a VM and exchanges buffers through shared-memory rings (virtqueues), one notification per batch instead of one VM exit per register write.', '$ lspci | grep -i virtio\nVirtio network device\nVirtio block device\n$ ls /sys/bus/virtio/drivers\nvirtio_blk  virtio_net  virtio_balloon') }),
  N('dst', 700, 840, 260, 100, 'destination host', 'live migration', { dashed: true, detail: d('Live migration', 'Move a running VM between hosts with milliseconds of pause: pre-copy memory in rounds, then stop-and-copy the last dirty pages and CPU state. Needs shared storage or disk mirroring.', '$ virsh migrate --live vm1 qemu+ssh://host2/system\n$ virsh domjobinfo vm1\nMemory remaining: 41 MiB\nDirty rate: 2400 pages/s') }),
];
const VM_ALL = VM_NODES.map((n) => n.id);
const only = (...keep: string[]) => VM_ALL.filter((x) => !keep.includes(x));
const VM_EDGES = ['hw>hv', 'hostos>hv', 'hv>guest', 'guest>app', 'vmm>guest', 'guest>vmcs', 'vmcs>hv', 'guest>ept', 'guest>virtio', 'virtio>vmm', 'hv>dst'];
const vm = (code: string[], beats: Beat[], panel = 'VM'): Board => ({ panel, codeTitle: 'notes', code, nodes: VM_NODES, edges: VM_EDGES, beats });
const CORE = ['hw', 'hv', 'vmm', 'guest', 'app'];

boardDemo(G, 'os-vms', 'Virtual machines', 'A whole computer in software: hypervisor types, VT-x traps, extended page tables, virtio devices and live migration.', {
  types: [
    'Type 1 vs type 2',
    vm(['# type 1: hypervisor on bare metal', '  ESXi · Xen · Hyper-V · KVM', '# type 2: an app on a host OS', '  VirtualBox · Workstation · Parallels'], [
      { note: 'A virtual machine is a whole computer in software. The guest kernel boots as if it owned the CPU, memory and devices.', hot: { guest: 'current', app: 'read' }, hide: only(...CORE), rows: [['guest sees', 'a normal PC']] },
      { note: 'Type 1: the hypervisor runs directly on the hardware and schedules VMs the way an OS schedules processes.', hl: [0, 1], hot: { hv: 'current', hw: 'read', 'hw>hv': 'accent' }, hide: only(...CORE), rows: [['layers', 'hw → hypervisor → guest']] },
      { note: 'Type 2: the hypervisor is an application inside a host OS. Same CPU features underneath, one extra layer of scheduling.', hl: [2, 3], hot: { hostos: 'current', hv: 'read', 'hostos>hv': 'accent' }, hide: only(...CORE, 'hostos'), rows: [['layers', 'hw → host OS → hypervisor → guest']] },
      { note: 'KVM blurs the line: a kernel module turns Linux itself into the type-1 hypervisor, and QEMU in userspace models the devices.', hot: { hv: 'ok', vmm: 'ok', 'vmm>guest': 'accent' }, sub: { hv: 'Linux + kvm.ko' }, hide: only(...CORE), rows: [['KVM', 'in-kernel'], ['QEMU', 'userspace']] },
      { note: 'To the host, each VM is one process and each virtual CPU is one thread, scheduled like any other.', hot: { vmm: 'read', hw: 'read' }, sub: { vmm: 'pid 4711 · 4 vCPU threads' }, hide: only(...CORE), rows: [['a VM is', 'a process', 'ok']] },
    ]),
  ],
  trap: [
    'VT-x: trap and resume',
    vm(['guest:  out 0x3f8, al     ; write to serial port', '→ VM exit  (reason: IO_INSTRUCTION)', 'host:   KVM → QEMU emulates the UART', '→ VMRESUME'], [
      { note: 'Ordinary guest instructions run on the real CPU at full speed. VT-x adds a guest mode underneath ring 0 for them.', hot: { guest: 'current', app: 'ok', hw: 'ok' }, hide: only(...CORE), rows: [['user code', 'native speed', 'ok']] },
      { note: 'A sensitive instruction (port I/O, CPUID, HLT, writing CR3) triggers a VM exit: the CPU saves guest state in the VMCS and jumps to the hypervisor.', hl: [0, 1], hot: { guest: 'warn', vmcs: 'current', 'guest>vmcs': 'accent', hv: 'current', 'vmcs>hv': 'accent' }, hide: only(...CORE, 'vmcs'), rows: [['exit reason', 'IO_INSTRUCTION']] },
      { note: 'KVM handles cheap exits itself. Device I/O goes up to QEMU, which pretends to be the UART in software.', hl: [2], hot: { hv: 'read', vmm: 'current', 'vmm>guest': 'accent' }, hide: only(...CORE, 'vmcs'), rows: [['handled by', 'QEMU']] },
      { note: 'VMRESUME reloads the guest state and the guest continues, unaware. An exit costs about a microsecond of the vCPU’s time.', hl: [3], hot: { guest: 'ok', vmcs: 'read' }, hide: only(...CORE, 'vmcs'), rows: [['round trip', '~1 µs']] },
      { note: 'A guest doing 200k exits a second spends a fifth of its time in the hypervisor, which is why devices are the thing to fix (see virtio).', hot: { guest: 'warn', vmm: 'warn' }, hide: only(...CORE, 'vmcs'), rows: [['200k exits/s', '~20% overhead', 'warn']] },
      { note: 'Before VT-x, VMware rewrote sensitive instructions on the fly (binary translation) and Xen asked guests to be modified (paravirtualisation).', hot: { hw: 'visited' }, hide: only(...CORE), rows: [['2005', 'VT-x ships'], ['before', 'binary translation · PV']] },
    ]),
  ],
  memory: [
    'Memory: EPT',
    vm(['guest virtual  → guest physical   (guest page tables)', 'guest physical → host physical    (EPT)', 'TLB caches the combined mapping'], [
      { note: 'The guest kernel builds page tables like always, but its “physical” addresses are made up. Where those pages really live is the hypervisor’s decision.', hl: [0], hot: { guest: 'current' }, hide: only(...CORE), rows: [['guest RAM', '8 GB (fiction)']] },
      { note: 'Extended page tables add a second level the CPU walks in hardware: guest-physical to host-physical. No trapping on page-table updates.', hl: [1], hot: { ept: 'current', 'guest>ept': 'accent', hw: 'read' }, hide: only(...CORE, 'ept'), rows: [['2nd level', 'walked by CPU']] },
      { note: 'A TLB miss now walks both tables: up to 24 memory reads instead of 4. Huge pages shorten both walks.', hl: [2], hot: { ept: 'warn', hw: 'warn' }, hide: only(...CORE, 'ept'), rows: [['worst walk', '24 reads', 'warn'], ['fix', '2 MB pages']] },
      { note: 'Pages the guest never touches cost nothing, so hosts overcommit. A balloon driver lets the hypervisor take memory back by inflating inside the guest.', hot: { ept: 'read', guest: 'read' }, sub: { guest: 'virtio_balloon' }, hide: only(...CORE, 'ept'), rows: [['overcommit', '1.5×'], ['reclaim', 'balloon']] },
      { note: 'KSM scans for identical pages across VMs (same kernel, same libraries) and keeps one copy, copy-on-write.', hot: { hv: 'ok', ept: 'ok' }, hide: only(...CORE, 'ept'), rows: [['dedupe', 'KSM', 'ok']] },
    ], 'Memory'),
  ],
  virtio: [
    'Devices: virtio',
    vm(['# emulated:  e1000 NIC, IDE disk', '#   one VM exit per register write', '# paravirtual:  virtio-net, virtio-blk', '#   shared rings, one kick per batch'], [
      { note: 'Emulating a real NIC faithfully means a VM exit for every register the driver pokes: thousands per packet.', hl: [0, 1], hot: { guest: 'warn', vmm: 'warn', 'vmm>guest': 'fail' }, hide: only(...CORE), rows: [['e1000', 'exits per packet', 'fail']] },
      { note: 'virtio is a device designed for VMs. The guest driver knows it is virtual and puts buffers into rings in shared memory.', hl: [2, 3], hot: { virtio: 'current', 'guest>virtio': 'accent' }, hide: only(...CORE, 'virtio'), rows: [['virtqueue', 'shared ring']] },
      { note: 'The guest fills many buffers and kicks once; the host drains the whole ring. vhost moves the host side into the kernel to skip QEMU entirely.', hot: { virtio: 'ok', 'virtio>vmm': 'accent', vmm: 'read' }, sub: { vmm: 'or vhost-net in kernel' }, hide: only(...CORE, 'virtio'), rows: [['exits', 'per batch', 'ok']] },
      { note: 'For the last bit of speed, SR-IOV or PCI passthrough hands a slice of a real device straight to the guest: near bare metal, but the VM can no longer live-migrate.', hot: { hw: 'ok', guest: 'ok', 'hw>hv': 'muted' }, hide: only(...CORE), rows: [['passthrough', 'native speed'], ['live migration', 'lost', 'warn']] },
    ], 'Devices'),
  ],
  migrate: [
    'Live migration',
    vm(['$ virsh migrate --live vm1 qemu+ssh://host2/system', '# rounds: copy · re-copy dirty pages · stop-and-copy'], [
      { note: 'Live migration moves a running VM to another host with a pause of milliseconds. Users keep their TCP connections.', hl: [0], hot: { dst: 'current', 'hv>dst': 'accent' }, hide: only(...CORE, 'dst'), rows: [['downtime', '~50 ms']] },
      { note: 'Pre-copy: send all of memory while the guest keeps running. EPT write-protects pages so dirtied ones can be tracked.', hot: { ept: 'read', dst: 'write', 'hv>dst': 'accent' }, hide: only(...CORE, 'dst', 'ept'), rows: [['round 1', '8 GB'], ['dirty', '300 MB']] },
      { note: 'Re-send only what got dirty. Each round is smaller, until what is left fits inside the pause budget.', hot: { dst: 'write', 'hv>dst': 'accent' }, hide: only(...CORE, 'dst', 'ept'), rows: [['round 2', '300 MB'], ['round 3', '40 MB']] },
      { note: 'Stop-and-copy: pause, ship the last pages plus CPU and device state, resume there. A gratuitous ARP moves the MAC to the new host.', hot: { guest: 'warn', dst: 'ok', vmcs: 'read' }, hide: only(...CORE, 'dst', 'vmcs'), rows: [['paused', '50 ms'], ['GARP', 'sent']] },
      { note: 'A guest dirtying memory faster than the link can carry never converges. Post-copy flips it: move the CPU first, fetch pages on demand.', hot: { dst: 'read', guest: 'warn' }, hide: only(...CORE, 'dst'), rows: [['needs', 'shared storage or disk mirror'], ['fallback', 'post-copy']] },
    ], 'Migration'),
  ],
});

// ---------------- the hypervisor landscape ----------------
const HV_NODES = [
  N('virsh', 40, 300, 280, 90, 'virsh / libvirt', 'management API', { detail: d('libvirt', 'A daemon and API that manages VMs across KVM, Xen and others: defines domains in XML, starts QEMU with the right flags, handles networks and storage pools. virsh, virt-manager, OpenStack and Vagrant all sit on it.', '$ virsh list --all\n$ virsh dumpxml vm1 | head\n<domain type="kvm">') }),
  N('qemu', 370, 300, 260, 90, 'QEMU', 'one process per VM', { detail: d('QEMU', 'Emulates the machine: firmware, chipset, PCI devices, disks, NICs. With -enable-kvm it hands CPU execution to the kernel and only handles I/O.', '$ qemu-system-x86_64 -enable-kvm -m 4G -smp 2 \\\n    -drive file=disk.qcow2,if=virtio \\\n    -netdev user,id=n0 -device virtio-net,netdev=n0') }),
  N('kvm', 700, 300, 260, 90, 'KVM', 'kvm.ko · /dev/kvm', { detail: d('KVM', 'Kernel-based Virtual Machine: an ioctl API on /dev/kvm to create VMs and vCPUs and run them with VT-x. Linux does scheduling, memory and drivers; KVM adds only the guest-mode plumbing.', 'fd  = open("/dev/kvm")\nvm  = ioctl(fd, KVM_CREATE_VM)\ncpu = ioctl(vm, KVM_CREATE_VCPU, 0)\nfor (;;) { ioctl(cpu, KVM_RUN); handle(exit_reason); }') }),
  N('xen', 40, 470, 280, 90, 'Xen', 'dom0 + domU', { detail: d('Xen', 'A thin bare-metal hypervisor. A privileged VM, dom0 (usually Linux), holds the device drivers and management tools; guests (domU) get paravirtual or HVM devices through it. Ran the first decade of EC2.', '$ xl list\nName      ID  Mem VCPUs State\nDomain-0   0 4096     4 r-----\nweb-1      3 2048     2 -b----') }),
  N('hyperv', 370, 470, 260, 90, 'Hyper-V', 'root partition', { detail: d('Hyper-V', 'Same shape as Xen: a microkernel hypervisor with a “root partition” running Windows that owns the drivers. WSL2 and Docker Desktop on Windows are Hyper-V VMs.') }),
  N('esxi', 700, 470, 260, 90, 'VMware ESXi', 'vSphere · vMotion', { detail: d('ESXi', 'A purpose-built type-1 kernel (VMkernel) with its own drivers and scheduler. vCenter manages fleets; vMotion is its live migration; DRS balances load.') }),
  N('nitro', 40, 640, 280, 90, 'AWS Nitro', 'cards + tiny hypervisor', { detail: d('Nitro', 'Networking, storage and security run on dedicated Nitro cards; the KVM-based Nitro hypervisor left on the host does almost nothing else. Bare-metal instances skip the hypervisor and still use the cards.', 'instance ⇄ Nitro card (ENA, EBS, security chip)\nhost CPU: Nitro hypervisor (KVM-based, minimal)') }),
  N('fc', 370, 640, 260, 90, 'Firecracker', 'microVM', { detail: d('Firecracker', 'A minimal VMM on KVM: ~5 devices, no BIOS, boots a guest kernel in ~125 ms with a few MB of overhead. Lambda and Fargate run one microVM per function or task.') }),
  N('ctr', 700, 640, 260, 90, 'container', 'shared kernel', { detail: d('Container', 'No hypervisor at all: a process with private namespaces and a cgroup on the host kernel. Fastest and densest, weakest boundary (one kernel bug from escape).') }),
  N('l0', 40, 810, 280, 90, 'L0 host', 'real hardware', { dashed: true }),
  N('l1', 370, 810, 260, 90, 'L1 guest = hypervisor', 'nested virt', { detail: d('Nested virtualisation', 'The host exposes VT-x to a guest so it can run its own VMs. Every L2 exit traps to L0 first, so it is slower, but it is how cloud CI boxes and dev laptops run KVM or Android emulators.', '$ cat /sys/module/kvm_intel/parameters/nested\nY') }),
  N('l2', 700, 810, 260, 90, 'L2 guest', 'VM inside a VM', { dashed: true }),
];
const HV_ALL = HV_NODES.map((n) => n.id);
const hvOnly = (...keep: string[]) => HV_ALL.filter((x) => !keep.includes(x));
const HV_EDGES = ['virsh>qemu', 'qemu>kvm', 'xen>hyperv', 'l0>l1', 'l1>l2'];
const hv = (code: string[], beats: Beat[], panel = 'Hypervisors'): Board => ({ panel, codeTitle: 'notes', code, nodes: HV_NODES, edges: HV_EDGES, beats });

boardDemo(G, 'os-hypervisors', 'Hypervisors in practice', 'The KVM/QEMU/libvirt chain, Xen and Hyper-V’s privileged-VM model, ESXi, AWS Nitro, and containers vs microVMs vs VMs.', {
  kvm: [
    'KVM + QEMU + libvirt',
    hv(['$ virsh start vm1', '→ libvirtd exec qemu-system-x86_64 -enable-kvm …', '→ ioctl(/dev/kvm, KVM_RUN)  per vCPU thread'], [
      { note: 'virsh (or OpenStack, Vagrant, virt-manager) asks libvirtd to start a domain defined in XML.', hl: [0], hot: { virsh: 'current' }, hide: hvOnly('virsh', 'qemu', 'kvm'), rows: [['API', 'libvirt']] },
      { note: 'libvirtd launches one QEMU process with the right disks, NICs and memory. QEMU is the machine: firmware, PCI bus, devices.', hl: [1], hot: { qemu: 'current', 'virsh>qemu': 'accent' }, hide: hvOnly('virsh', 'qemu', 'kvm'), rows: [['process', 'qemu-system-x86_64']] },
      { note: 'Each vCPU thread loops on ioctl(KVM_RUN). The kernel flips the CPU into guest mode; on an exit it returns with the reason.', hl: [2], hot: { kvm: 'current', 'qemu>kvm': 'accent' }, hide: hvOnly('virsh', 'qemu', 'kvm'), rows: [['per vCPU', 'one thread'], ['loop', 'KVM_RUN → exit → handle']] },
      { note: 'Split of labour: KVM does CPU and memory (EPT), QEMU does devices, Linux does scheduling, drivers and cgroups for the VM’s process.', hot: { kvm: 'ok', qemu: 'ok', virsh: 'read' }, hide: hvOnly('virsh', 'qemu', 'kvm'), rows: [['KVM', 'CPU · memory'], ['QEMU', 'devices'], ['Linux', 'everything else']] },
    ]),
  ],
  xen: [
    'Xen, Hyper-V, ESXi',
    hv(['# Xen: hypervisor + dom0 (drivers) + domU guests', '# Hyper-V: hypervisor + root partition (Windows)', '# ESXi: VMkernel with its own drivers'], [
      { note: 'Xen keeps the hypervisor tiny and puts drivers in a privileged Linux VM, dom0. Guests reach disks and NICs through dom0’s backend drivers.', hl: [0], hot: { xen: 'current' }, hide: hvOnly('xen', 'hyperv', 'esxi'), rows: [['drivers live in', 'dom0']] },
      { note: 'Hyper-V has the same shape: a root partition running Windows owns the hardware. WSL2 and Docker Desktop on Windows are Hyper-V guests.', hl: [1], hot: { hyperv: 'current', 'xen>hyperv': 'accent' }, hide: hvOnly('xen', 'hyperv', 'esxi'), rows: [['root partition', 'Windows']] },
      { note: 'ESXi is a self-contained kernel with its own drivers and scheduler, managed by vCenter. vMotion is its live migration.', hl: [2], hot: { esxi: 'current' }, hide: hvOnly('xen', 'hyperv', 'esxi'), rows: [['fleet mgmt', 'vCenter'], ['migration', 'vMotion']] },
      { note: 'Trade-off: a driver crash in dom0 or the root partition takes every VM down; ESXi and KVM avoid the extra hop but carry the drivers themselves.', hot: { xen: 'warn', hyperv: 'warn', esxi: 'ok' }, hide: hvOnly('xen', 'hyperv', 'esxi'), rows: [['dom0 down', 'all VMs down', 'warn']] },
    ]),
  ],
  cloud: [
    'AWS Nitro',
    hv(['# EC2 before 2017: Xen, drivers in dom0', '# Nitro: NIC + EBS + security on cards', '#        host runs a minimal KVM hypervisor'], [
      { note: 'Early EC2 ran Xen: every packet and disk block crossed into dom0, which stole CPU from the instances you paid for.', hl: [0], hot: { xen: 'warn' }, hide: hvOnly('xen', 'nitro'), rows: [['overhead', 'up to 30%', 'warn']] },
      { note: 'Nitro moves networking, storage and the security root onto dedicated cards. The instance talks to them as PCIe devices.', hl: [1], hot: { nitro: 'current' }, hide: hvOnly('xen', 'nitro'), rows: [['ENA · EBS', 'on cards']] },
      { note: 'What is left on the host is a KVM-based hypervisor that only schedules and maps memory. Nearly all CPU and RAM go to the instance.', hl: [2], hot: { nitro: 'ok' }, hide: hvOnly('nitro'), rows: [['overhead', '<1%', 'ok']] },
      { note: 'Bare-metal instances drop the hypervisor entirely and still use the cards, which is how you run your own VMware or KVM on EC2.', hot: { nitro: 'ok', l0: 'read' }, hide: hvOnly('nitro', 'l0'), rows: [['.metal', 'no hypervisor']] },
    ]),
  ],
  compare: [
    'VM vs microVM vs container',
    hv(['boot       overhead   boundary', 'VM        ~30 s     GBs        hardware', 'microVM  ~125 ms    ~5 MB      hardware', 'container ~10 ms    ~0         syscalls'], [
      { note: 'A full VM boots a whole OS: tens of seconds and gigabytes, but a hardware boundary between tenants.', hl: [1], hot: { qemu: 'current' }, hide: hvOnly('qemu', 'fc', 'ctr'), rows: [['VM', '~30 s · GBs']] },
      { note: 'A microVM keeps the hardware boundary but strips the machine to a few virtio devices: ~125 ms and a few MB.', hl: [2], hot: { fc: 'current' }, hide: hvOnly('qemu', 'fc', 'ctr'), rows: [['microVM', '~125 ms · ~5 MB']] },
      { note: 'A container is just a process: milliseconds and almost no overhead, but one shared kernel is the only wall between tenants.', hl: [3], hot: { ctr: 'current' }, hide: hvOnly('qemu', 'fc', 'ctr'), rows: [['container', '~10 ms · ~0']] },
      { note: 'Rule of thumb: your own code → containers; other people’s code → a VM boundary. Lambda runs each customer in a microVM and containers inside it.', hot: { fc: 'ok', ctr: 'ok', qemu: 'read' }, hide: hvOnly('qemu', 'fc', 'ctr'), rows: [['untrusted code', 'microVM', 'ok'], ['your code', 'container', 'ok']] },
    ]),
  ],
  nested: [
    'Nested virtualisation',
    hv(['$ cat /sys/module/kvm_intel/parameters/nested', 'Y', '# L0 host → L1 guest (runs KVM) → L2 guest'], [
      { note: 'The host can expose VT-x to a guest, so the guest can be a hypervisor too.', hl: [0, 1], hot: { l0: 'current', l1: 'read', 'l0>l1': 'accent' }, hide: hvOnly('l0', 'l1', 'l2'), rows: [['L1 sees', 'vmx flag']] },
      { note: 'Every VM exit in L2 really traps to L0, which forwards it to L1’s hypervisor and back. Exits get several times more expensive.', hl: [2], hot: { l2: 'current', l1: 'warn', 'l1>l2': 'accent' }, hide: hvOnly('l0', 'l1', 'l2'), rows: [['exit path', 'L2 → L0 → L1 → L0 → L2', 'warn']] },
      { note: 'It is how a cloud VM runs KVM for CI, how Android emulators work on a cloud desktop, and how Docker Desktop on a Mac runs Linux containers inside a Linux VM.', hot: { l1: 'ok', l2: 'ok' }, sub: { l1: 'e.g. Linux VM on macOS' }, hide: hvOnly('l0', 'l1', 'l2'), rows: [['Docker Desktop', 'containers in a VM']] },
    ]),
  ],
});
