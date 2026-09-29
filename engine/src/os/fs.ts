// Filesystems (group machine-os-fs): open() path walk through VFS, inodes, page cache, writes + journal, links, mounts.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Beat, Board } from '../machine/lib/board';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const NODES = [
  N('proc', 360, 290, 280, 100, 'process', 'fd 3', { detail: d('A file descriptor', 'open() returns a small integer indexing the process’s fd table. 0, 1 and 2 are stdin, stdout and stderr; each entry points at an open file (offset, flags) that points at an inode.', '$ ls -l /proc/$$/fd\n0 -> /dev/pts/1\n1 -> /dev/pts/1\n2 -> /dev/pts/1\n3 -> /var/log/app.log') }),
  N('vfs', 360, 440, 280, 100, 'VFS', 'one API, many fs', { detail: d('Virtual File System', 'The kernel layer behind open/read/write. It walks paths, caches lookups and calls the right filesystem’s operations: ext4, xfs, btrfs, tmpfs, NFS, even /proc.', '$ df -T\nFilesystem     Type  Mounted on\n/dev/nvme0n1p2 ext4  /\ntmpfs          tmpfs /run\nproc           proc  /proc') }),
  N('dcache', 40, 440, 260, 100, 'dentry cache', 'name → inode', { detail: d('Dentry cache', 'Caches each path component → inode lookup, including misses (negative dentries). Opening /var/log/app.log walks /, var, log, app.log, usually all from RAM.', '$ grep dentry /proc/slabinfo | head -1\ndentry  812345 …') }),
  N('inode', 700, 440, 260, 100, 'inode 1312', 'metadata + block map', { detail: d('Inode', 'The file itself: size, owner, mode, timestamps, link count and where its data blocks are. A name is just a directory entry pointing at an inode number.', '$ ls -li app.log\n1312 -rw-r--r-- 1 app app 4096 app.log\n$ stat -c "%i %h %s %b" app.log\n1312 1 4096 8\n$ df -i /   # run out of inodes = no new files') }),
  N('pc', 360, 590, 280, 100, 'page cache', 'file pages in RAM', { detail: d('Page cache', 'File data cached in otherwise free RAM, 4 KiB per page. Reads hit it; writes dirty it and are flushed later. "free" memory that is really cache is reclaimed on demand.', '$ free -h\n       total  used  free  buff/cache\nMem:    15Gi  4.1Gi 1.2Gi  10Gi\n$ echo 3 | sudo tee /proc/sys/vm/drop_caches') }),
  N('fs', 40, 740, 260, 100, 'ext4', 'block allocation', { detail: d('ext4', 'Maps file offsets to disk blocks with extents, allocates new blocks and keeps a journal so a crash never leaves metadata half-written.', '$ sudo tune2fs -l /dev/nvme0n1p2 | grep -i journal\nJournal inode: 8\n$ sudo fsck -n /dev/sdb1') }),
  N('jrnl', 360, 740, 280, 100, 'journal', 'write-ahead log', { detail: d('Journal', 'Metadata changes go to the journal first, then to their home location. After a crash, replaying the journal restores consistency in seconds instead of a full fsck.', '# data=ordered (default): data before metadata commit\n$ mount | grep " / "\n/dev/nvme0n1p2 on / type ext4 (rw,relatime)') }),
  N('disk', 700, 740, 260, 100, 'disk blocks', 'NVMe / SSD', { detail: d('The block device', 'Where bytes finally land. The block layer queues and merges requests; the device has its own cache, which fsync also flushes.', '$ lsblk -o NAME,SIZE,ROTA\nnvme0n1 477G 0\n$ iostat -x 1   # await, %util') }),
];
const EDGES = ['proc>vfs', 'vfs>dcache', 'vfs>inode', 'vfs>pc', 'pc>jrnl', 'jrnl>fs', 'pc>disk', 'inode>disk'];
const board = (code: string[], beats: Beat[]): Board => ({ panel: 'Filesystem', codeTitle: 'app.c', code, nodes: NODES, edges: EDGES, beats });

boardDemo('machine-os-fs', 'os-fs', 'Files, inodes & the page cache', 'open() walks the path through VFS and the dentry cache to an inode; reads hit the page cache; writes dirty pages, fsync and the ext4 journal; hard vs symbolic links; mounts.', {
  open: [
    'open(): path to inode',
    board(['int fd = open("/var/log/app.log", O_RDONLY);'], [
      { note: 'open() is a syscall: the process hands a path to the kernel’s VFS.', hl: [0], hot: { proc: 'current', 'proc>vfs': 'accent', vfs: 'current' }, hide: ['pc', 'fs', 'jrnl', 'disk'], rows: [['syscall', 'openat']] },
      { note: 'VFS walks /, var, log and app.log one component at a time, each found in the dentry cache.', hot: { dcache: 'current', 'vfs>dcache': 'accent' }, hide: ['pc', 'fs', 'jrnl', 'disk'], rows: [['lookups', 4], ['cache hits', 4, 'ok']] },
      { note: 'The last entry names inode 1312, and the kernel checks your uid against its mode bits.', hot: { inode: 'current', 'vfs>inode': 'accent' }, hide: ['pc', 'fs', 'jrnl', 'disk'], rows: [['inode', 1312], ['permission', 'r--', 'ok']] },
      { note: 'The kernel creates an open-file entry and returns fd 3, the lowest free slot.', hot: { proc: 'ok' }, hide: ['pc', 'fs', 'jrnl', 'disk'], rows: [['return', 'fd 3', 'ok']] },
    ]),
  ],
  read: [
    'read(): page cache',
    board(['char buf[4096];', 'read(fd, buf, sizeof buf);'], [
      { note: 'read() asks VFS for 4 KiB at the current offset.', hl: [1], hot: { proc: 'current', 'proc>vfs': 'accent' }, hide: ['fs', 'jrnl'], rows: [['offset', 0]] },
      { note: 'First read: the page is not cached, so the kernel reads the block from disk while the process sleeps.', hot: { pc: 'warn', disk: 'current', 'pc>disk': 'accent', 'inode>disk': 'accent' }, hide: ['fs', 'jrnl'], rows: [['page cache', 'miss', 'warn'], ['latency', '~80 µs NVMe']] },
      { note: 'The page stays cached, so the next read of it is a memory copy.', hot: { pc: 'ok', 'vfs>pc': 'accent' }, hide: ['fs', 'jrnl'], rows: [['page cache', 'hit', 'ok'], ['latency', '~1 µs']] },
      { note: 'Sequential reads trigger readahead, fetching the next pages before you ask.', hot: { pc: 'current', disk: 'read' }, hide: ['fs', 'jrnl'], rows: [['readahead', '128 KiB']] },
    ]),
  ],
  write: [
    'write(), fsync & the journal',
    board(['write(fd, "order 42 paid\\n", 14);', 'fsync(fd);'], [
      { note: 'write() only copies into the page cache and marks the page dirty, then returns.', hl: [0], hot: { proc: 'current', pc: 'warn', 'vfs>pc': 'accent' }, hide: ['dcache'], rows: [['durable', 'no', 'warn']] },
      { note: 'Pull the power now and those bytes are lost, because nothing reached the disk yet.', hot: { pc: 'fail' }, hide: ['dcache'], rows: [['dirty pages', 1, 'warn']] },
      { note: 'fsync() forces the flush: ext4 writes the data, then commits the metadata change to its journal.', hl: [1], hot: { jrnl: 'current', fs: 'write', 'pc>jrnl': 'accent', 'jrnl>fs': 'accent' }, hide: ['dcache'], rows: [['journal', 'commit']] },
      { note: 'The device flushes its own cache, fsync returns, and now the write survives a crash.', hot: { disk: 'ok', 'pc>disk': 'accent', proc: 'ok' }, hide: ['dcache'], rows: [['durable', 'yes', 'ok'], ['cost', '~1 ms']] },
    ]),
  ],
  links: [
    'Hard & symbolic links',
    board(['$ ln app.log hard.log', '$ ln -s app.log soft.log', '$ ls -li'], [
      { note: 'A hard link is a second directory entry pointing at the same inode.', hl: [0], hot: { dcache: 'current', inode: 'current', 'vfs>inode': 'accent' }, sub: { dcache: 'app.log, hard.log → 1312' }, hide: ['pc', 'fs', 'jrnl', 'disk'], rows: [['link count', 2]] },
      { note: 'Deleting app.log removes one name; the data lives until the count and open fds reach zero.', hot: { inode: 'ok' }, sub: { dcache: 'hard.log → 1312' }, hide: ['pc', 'fs', 'jrnl', 'disk'], rows: [['link count', 1]] },
      { note: 'A symlink is its own tiny inode holding a path, so it can cross filesystems and can dangle.', hl: [1], hot: { dcache: 'warn' }, sub: { dcache: 'soft.log → "app.log"' }, hide: ['pc', 'fs', 'jrnl', 'disk'], rows: [['symlink target', 'missing', 'warn']] },
      { note: 'Classic gotcha: deleting a huge log a process still holds open frees nothing until it closes it.', hl: [2], hot: { proc: 'warn', disk: 'fail' }, hide: ['pc', 'fs', 'jrnl'], rows: [['find it', 'lsof +L1']] },
    ]),
  ],
  mounts: [
    'Mounts',
    board(['$ mount /dev/sdb1 /data', '$ findmnt /data'], [
      { note: 'Every filesystem is grafted onto one tree at a mount point.', hl: [0], hot: { vfs: 'current' }, hide: ['pc', 'jrnl'], rows: [['mount point', '/data']] },
      { note: 'A path under /data crosses into sdb1, so VFS switches to that filesystem’s operations.', hot: { fs: 'current', 'jrnl>fs': 'accent' }, hide: ['pc'], rows: [['fs', 'ext4 on sdb1']] },
      { note: 'Options change behaviour: noatime skips a write per read, ro blocks writes entirely.', hl: [1], hot: { fs: 'read' }, sub: { fs: 'rw,noatime' }, hide: ['pc'], rows: [['options', 'rw,noatime']] },
      { note: 'Put it in /etc/fstab by UUID, not /dev/sdb1, since device names can change between boots.', hot: { fs: 'ok' }, hide: ['pc'], rows: [['fstab', 'UUID=…  /data  ext4  noatime  0 2']] },
    ]),
  ],
});
