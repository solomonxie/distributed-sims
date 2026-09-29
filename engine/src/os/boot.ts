// Linux boot chain (group machine-os-boot): firmware → bootloader → kernel → initramfs → root fs → PID 1.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Board, Beat } from '../machine/lib/board';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const NODES = [
  N('fw', 360, 40, 280, 100, 'firmware', 'UEFI / BIOS', { detail: d('Firmware (UEFI or BIOS)', 'Runs from flash on power-on: POST checks RAM and devices, then picks a boot entry. UEFI reads a FAT partition (the ESP); legacy BIOS jumps to code in the disk’s first 512 bytes (MBR).', '$ [ -d /sys/firmware/efi ] && echo UEFI || echo BIOS\nUEFI\n$ efibootmgr\nBootCurrent: 0001\nBoot0001* ubuntu  HD(1,GPT,…)/File(\\EFI\\ubuntu\\shimx64.efi)') }),
  N('boot', 360, 190, 280, 100, 'GRUB', 'bootloader', { detail: d('GRUB, the bootloader', 'Shows the menu, loads the kernel image and the initramfs into RAM, and passes the kernel command line. Its config is generated, never hand-edited.', '# /etc/default/grub\nGRUB_TIMEOUT=5\nGRUB_CMDLINE_LINUX="quiet splash"\n$ sudo update-grub   # writes /boot/grub/grub.cfg') }),
  N('kern', 360, 340, 280, 100, 'kernel', 'vmlinuz', { detail: d('The Linux kernel', 'Decompresses itself, sets up memory management, probes hardware and starts drivers. It cannot mount the real root yet if the driver or LUKS key lives elsewhere, so it runs the initramfs first.', '$ dmesg | head -3\n[0.000000] Linux version 6.8.0-45-generic …\n[0.000000] Command line: BOOT_IMAGE=/vmlinuz-6.8… root=UUID=… ro quiet') }),
  N('initrd', 360, 490, 280, 100, 'initramfs', 'tiny root in RAM', { detail: d('initramfs', 'A compressed cpio archive unpacked into RAM as a temporary root. Its /init loads the storage drivers, unlocks LUKS, assembles LVM or RAID, then switches to the real root.', '$ lsinitramfs /boot/initrd.img-$(uname -r) | head\nusr/lib/modules/…/nvme.ko\nscripts/local-top/cryptroot\n$ sudo dracut --force   # Fedora/RHEL rebuild') }),
  N('root', 360, 640, 280, 100, 'real root fs', '/ mounted ro → rw', { detail: d('Switching to the real root', 'switch_root mounts the disk’s filesystem at / and frees the initramfs. It is mounted read-only first so fsck can check it, then remounted rw from /etc/fstab.', '$ findmnt /\nTARGET SOURCE         FSTYPE OPTIONS\n/      /dev/nvme0n1p2 ext4   rw,relatime') }),
  N('init', 360, 790, 280, 100, 'systemd', 'PID 1', { detail: d('PID 1: the init system', 'The first user-space process. It never exits, adopts orphans and starts everything else. systemd starts units in parallel from their dependency graph; OpenRC and sysvinit run scripts in order.', '$ ps -p 1 -o pid,comm\n  PID COMMAND\n    1 systemd\n$ systemd-analyze\nStartup finished in 3.1s (kernel) + 6.4s (userspace)') }),
  N('esp', 700, 190, 260, 100, 'ESP', '/boot/efi (FAT32)', { detail: d('EFI System Partition', 'A small FAT32 partition holding .efi binaries. UEFI boot entries in NVRAM point at files here; Secure Boot checks their signatures (shim → GRUB → kernel).', '$ lsblk -o NAME,FSTYPE,MOUNTPOINT\nnvme0n1p1 vfat /boot/efi\nnvme0n1p2 ext4 /\n$ mokutil --sb-state\nSecureBoot enabled') }),
  N('cmd', 700, 340, 260, 100, '/proc/cmdline', 'kernel params', { detail: d('Kernel command line', 'Parameters from GRUB: which root to mount, quiet or verbose, init= override, single-user mode. Press e in the GRUB menu to edit them for one boot.', '$ cat /proc/cmdline\nBOOT_IMAGE=/vmlinuz-6.8.0 root=UUID=3f… ro quiet\n# rescue: add  systemd.unit=rescue.target') }),
  N('disk', 40, 490, 260, 100, 'disk', 'LUKS · LVM · RAID', { detail: d('Storage the kernel can’t mount alone', 'Encrypted or layered disks need user-space tools (cryptsetup, lvm) before the root exists. That is exactly why the initramfs exists.', '$ lsblk\nnvme0n1            disk\n└─nvme0n1p3        part\n  └─cryptroot      crypt\n    └─vg0-root     lvm   /') }),
  N('units', 700, 790, 260, 100, 'units', 'targets · services', { detail: d('systemd units', 'Services, mounts, sockets and timers, each with Wants/After dependencies. A target like multi-user.target is just a group to reach.', '$ systemctl list-dependencies multi-user.target\n$ systemctl status nginx\n● nginx.service - active (running)\n$ systemd-analyze blame | head -3') }),
  N('svc', 40, 790, 260, 100, 'services', 'sshd · nginx · getty', { detail: d('Services and login', 'The last units: daemons, then getty on consoles or a display manager. The system is "up" when the default target is reached.', '$ systemctl get-default\ngraphical.target\n$ journalctl -b -u sshd | tail -1') }),
];
const EDGES = ['fw>boot', 'boot>kern', 'kern>initrd', 'initrd>root', 'root>init', 'esp>boot', 'cmd>kern', 'initrd>disk', 'init>units', 'init>svc'];
const LATER = ['boot', 'kern', 'initrd', 'root', 'init', 'esp', 'cmd', 'disk', 'units', 'svc'];

const board = (beats: Beat[]): Board => ({ panel: 'Boot', nodes: NODES, edges: EDGES, beats });
const hideAfter = (visible: string[]) => LATER.filter((x) => !visible.includes(x));

boardDemo(
  'machine-os-boot',
  'os-boot',
  'The Linux boot chain',
  'Power on → UEFI/BIOS → GRUB → kernel → initramfs → real root → systemd as PID 1 → services.',
  {
    chain: [
      'The whole chain',
      board([
        { note: 'Power on: the firmware runs POST and picks a boot device.', hot: { fw: 'current' }, hide: hideAfter([]), rows: [['stage', 'firmware'], ['t', '0 s']] },
        { note: 'The firmware hands control to GRUB, which loads the kernel and initramfs into RAM.', hot: { boot: 'current', 'fw>boot': 'accent' }, hide: hideAfter(['boot']), rows: [['stage', 'bootloader'], ['t', '~1 s']] },
        { note: 'The kernel starts with the command line GRUB passed it and brings up memory, CPUs and drivers.', hot: { kern: 'current', cmd: 'read', 'boot>kern': 'accent', 'cmd>kern': 'accent' }, hide: hideAfter(['boot', 'kern', 'cmd']), rows: [['stage', 'kernel'], ['mode', 'ring 0']] },
        { note: 'It unpacks the initramfs as a temporary root, whose scripts unlock and assemble the real disk.', hot: { initrd: 'current', disk: 'read', 'kern>initrd': 'accent', 'initrd>disk': 'accent' }, hide: hideAfter(['boot', 'kern', 'cmd', 'initrd', 'disk']), rows: [['stage', 'initramfs'], ['root', 'RAM']] },
        { note: 'switch_root mounts the real filesystem at / and throws the initramfs away.', hot: { root: 'current', 'initrd>root': 'accent' }, hide: hideAfter(['boot', 'kern', 'cmd', 'initrd', 'disk', 'root']), rows: [['stage', 'switch_root'], ['root', 'disk']] },
        { note: 'The kernel execs /sbin/init as PID 1, and systemd starts every unit toward the default target.', hot: { init: 'ok', units: 'write', svc: 'write', 'root>init': 'accent', 'init>units': 'accent', 'init>svc': 'accent' }, rows: [['stage', 'user space'], ['PID 1', 'systemd', 'ok']] },
      ]),
    ],
    uefi: [
      'UEFI & Secure Boot',
      board([
        { note: 'UEFI keeps boot entries in NVRAM, each pointing at an .efi file on the ESP.', hot: { fw: 'current', esp: 'read' }, hide: hideAfter(['esp']), rows: [['entry', 'Boot0001 ubuntu']] },
        { note: 'Secure Boot only runs binaries signed by a trusted key: shim, then GRUB, then the kernel.', hot: { esp: 'current', boot: 'write', 'esp>boot': 'accent' }, hide: hideAfter(['esp', 'boot']), rows: [['check', 'signature', 'ok']] },
        { note: 'Legacy BIOS has no ESP: it runs 446 bytes of MBR code, which chain-loads GRUB’s next stage.', hot: { fw: 'warn', boot: 'current' }, sub: { fw: 'legacy BIOS · MBR' }, hide: hideAfter(['boot']), rows: [['partition table', 'MBR (2 TB max)', 'warn']] },
        { note: 'Broken boot entry? Boot a live USB, mount the ESP and fix it with efibootmgr or grub-install.', hot: { esp: 'ok', fw: 'ok' }, hide: hideAfter(['esp', 'boot']), rows: [['tool', 'efibootmgr']] },
      ]),
    ],
    initramfs: [
      'Why initramfs',
      board([
        { note: 'The kernel needs the nvme driver and the LUKS key to reach /, but those live on / itself.', hot: { kern: 'current', disk: 'fail' }, hide: ['root', 'init', 'units', 'svc'], rows: [['root reachable', 'no', 'fail']] },
        { note: 'initramfs breaks the loop: a small root in RAM with just enough modules and tools.', hot: { initrd: 'current', 'kern>initrd': 'accent' }, hide: ['root', 'init', 'units', 'svc'], rows: [['size', '~60 MB']] },
        { note: 'Its scripts load drivers, ask for the passphrase, run cryptsetup and lvm, then mount the real root.', hot: { disk: 'ok', 'initrd>disk': 'accent' }, hide: ['root', 'init', 'units', 'svc'], rows: [['root reachable', 'yes', 'ok']] },
        { note: 'Changed disk layout or drivers? Rebuild it with update-initramfs or dracut, or the next boot drops to an emergency shell.', hot: { initrd: 'warn', root: 'write', 'initrd>root': 'accent' }, hide: ['init', 'units', 'svc'], rows: [['rebuild', 'update-initramfs -u']] },
      ]),
    ],
    systemd: [
      'PID 1 & systemd',
      board([
        { note: 'The kernel starts exactly one process, init, as PID 1.', hot: { init: 'current', 'root>init': 'accent' }, hide: ['units', 'svc'], rows: [['PID', 1]] },
        { note: 'systemd reads unit files and starts everything whose dependencies are met, in parallel.', hot: { units: 'current', 'init>units': 'accent' }, hide: ['svc'], rows: [['units', '~200']] },
        { note: 'Services run as its children, and it restarts them per Restart= when they crash.', hot: { svc: 'ok', 'init>svc': 'accent' }, rows: [['restart', 'on-failure']] },
        { note: 'PID 1 must never die: the kernel panics if it does, and it also reaps orphaned zombies.', hot: { init: 'warn' }, rows: [['if PID 1 exits', 'kernel panic', 'fail']] },
      ]),
    ],
  },
);
