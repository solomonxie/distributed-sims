// Git internals (group git-internals): the object store, refs and the index; merge vs rebase, reflog recovery, packfiles, progressive commits.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Beat, Board } from '../machine/lib/board';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const G = 'git-internals';

const OBJ_NODES = [
  N('wt', 40, 280, 280, 100, 'working tree', 'README · src/', { detail: d('Working tree', 'The files you edit. Git only notices them when you add them to the index.', '$ git status --short\n M README.md\n?? notes.txt') }),
  N('idx', 370, 280, 260, 100, 'index', '.git/index', { detail: d('The index (staging area)', 'A binary list of path → blob hash → mode for the next commit. git add hashes the file into a blob and records it here; git commit turns the index into trees.', '$ git ls-files --stage\n100644 ce01362… 0  README.md\n100644 8baef1b… 0  src/main.c') }),
  N('head', 700, 280, 260, 100, 'HEAD', 'ref: refs/heads/main', { detail: d('HEAD and branches', 'A branch is a 41-byte file holding a commit hash. HEAD usually points at a branch; "detached HEAD" means it holds a hash directly.', '$ cat .git/HEAD\nref: refs/heads/main\n$ cat .git/refs/heads/main\na1b2c3d4…\n$ git rev-parse HEAD') }),
  N('commit', 700, 460, 260, 110, 'commit a1b2c3d', 'tree · parent · author', { detail: d('Commit object', 'Points at one tree (the snapshot), its parent commit(s), author, committer and message. Change anything and the hash changes, so history is tamper-evident.', '$ git cat-file -p a1b2c3d\ntree 9f8e7d6…\nparent 5e4d3c2…\nauthor Solomon <…> 1727520000 -0700\n\nAdd README') }),
  N('tree', 370, 460, 260, 110, 'tree 9f8e7d6', 'names → hashes', { detail: d('Tree object', 'A directory listing: mode, type, hash and name for each entry. Subdirectories are trees; unchanged ones are reused by hash, which is why snapshots are cheap.', '$ git cat-file -p 9f8e7d6\n100644 blob ce01362…  README.md\n040000 tree 4b825dc…  src') }),
  N('blob', 40, 460, 280, 110, 'blob ce01362', '"hello\\n"', { detail: d('Blob object', 'Just the file’s bytes, zlib-compressed, named by the SHA-1 of "blob <size>\\0<content>". No filename: identical files share one blob.', '$ echo hello | git hash-object --stdin\nce013625030ba8dba906f756967f9e9ca394464a\n$ git cat-file -t ce01362\nblob') }),
  N('odb', 370, 660, 260, 110, '.git/objects', 'content-addressed', { detail: d('The object database', 'Every blob, tree and commit is a file named by its hash (first 2 hex chars are the directory). Nothing is ever modified in place, only added.', '$ find .git/objects -type f | head -2\n.git/objects/ce/013625030ba8dba906f756967f9e9ca394464a\n.git/objects/9f/8e7d6…\n$ git count-objects -v') }),
  N('pack', 700, 660, 260, 110, 'packfile', 'deltas + index', { detail: d('Packfiles', 'git gc and every push/fetch pack loose objects into one file, storing similar objects as deltas against each other. That is how a repo with thousands of versions stays small.', '$ git gc\n$ git verify-pack -v .git/objects/pack/pack-*.idx | head -3\n$ git count-objects -vH\nsize-pack: 18.2 MiB') }),
];
const OBJ_EDGES = ['wt>idx', 'idx>head', 'head>commit', 'commit>tree', 'tree>blob', 'tree>odb', 'odb>pack'];
const objBoard = (code: string[], beats: Beat[]): Board => ({ panel: 'Git', codeTitle: 'shell', code, nodes: OBJ_NODES, edges: OBJ_EDGES, beats });

boardDemo(G, 'git-objects', 'Git objects, index & refs', 'What git add and git commit actually write: blobs, trees and commits in a content-addressed store, the index, branches as pointers, and packfiles.', {
  add: [
    'git add',
    objBoard(['$ echo hello > README.md', '$ git add README.md'], [
      { note: 'You edit README.md in the working tree; git doesn’t know yet.', hl: [0], hot: { wt: 'current' }, hide: ['commit', 'tree', 'pack'], rows: [['status', 'modified']] },
      { note: 'git add hashes the bytes into a blob object named ce01362, its SHA-1.', hl: [1], hot: { blob: 'write', odb: 'write' }, hide: ['commit', 'tree', 'pack'], rows: [['object', 'blob ce01362']] },
      { note: 'The index records README.md → ce01362, ready for the next commit.', hot: { idx: 'current', 'wt>idx': 'accent' }, hide: ['commit', 'tree', 'pack'], rows: [['staged', 'README.md', 'ok']] },
      { note: 'Same content anywhere gives the same hash, so identical files are stored once.', hot: { blob: 'ok' }, hide: ['commit', 'tree', 'pack'], rows: [['dedupe', 'by content', 'ok']] },
    ]),
  ],
  commit: [
    'git commit',
    objBoard(['$ git commit -m "Add README"', '$ git cat-file -p HEAD'], [
      { note: 'git commit turns the index into tree objects, one per directory.', hl: [0], hot: { idx: 'read', tree: 'write', 'tree>blob': 'accent' }, hide: ['commit', 'pack'], rows: [['trees written', 2]] },
      { note: 'It writes a commit object pointing at the root tree and at the previous commit as parent.', hot: { commit: 'write', 'commit>tree': 'accent' }, hide: ['pack'], rows: [['commit', 'a1b2c3d']] },
      { note: 'Then it moves the branch HEAD points at, main, to the new commit: a 41-byte file write.', hl: [1], hot: { head: 'current', 'head>commit': 'accent', 'idx>head': 'accent' }, hide: ['pack'], rows: [['main', 'a1b2c3d', 'ok']] },
      { note: 'Nothing was copied: unchanged subtrees and blobs are reused by hash.', hot: { tree: 'ok', blob: 'ok', odb: 'ok', 'tree>odb': 'accent' }, hide: ['pack'], rows: [['new objects', 3]] },
    ]),
  ],
  refs: [
    'Branches & HEAD',
    objBoard(['$ git switch -c feature', '$ git checkout a1b2c3d'], [
      { note: 'A branch is only a file containing a commit hash.', hot: { head: 'current' }, sub: { head: 'main → a1b2c3d' }, hide: ['wt', 'idx', 'pack'], rows: [['refs/heads/main', 'a1b2c3d']] },
      { note: 'git switch -c feature writes one more such file and points HEAD at it, instantly.', hl: [0], hot: { head: 'write', 'head>commit': 'accent' }, sub: { head: 'feature → a1b2c3d' }, hide: ['wt', 'idx', 'pack'], rows: [['cost', 'one tiny file', 'ok']] },
      { note: 'Checking out a hash leaves HEAD detached: new commits there belong to no branch.', hl: [1], hot: { head: 'warn' }, sub: { head: 'detached · a1b2c3d' }, hide: ['wt', 'idx', 'pack'], rows: [['HEAD', 'detached', 'warn']] },
    ]),
  ],
  pack: [
    'Packfiles',
    objBoard(['$ git gc', '$ git count-objects -vH'], [
      { note: 'Each change writes new loose objects, one zlib-compressed file per object.', hot: { odb: 'current' }, hide: ['wt', 'idx', 'head'], rows: [['loose objects', 5321, 'warn']] },
      { note: 'git gc packs them into one packfile, storing similar versions as deltas.', hl: [0], hot: { pack: 'write', 'odb>pack': 'accent' }, hide: ['wt', 'idx', 'head'], rows: [['loose objects', 0, 'ok'], ['pack size', '18 MiB']] },
      { note: 'Pushes and fetches send packfiles too, which is why cloning a big history is fast.', hl: [1], hot: { pack: 'ok' }, hide: ['wt', 'idx', 'head'], rows: [['transfer', 'thin packs']] },
      { note: 'A secret committed once lives in the pack even after you delete the file, so rewrite history and rotate the secret.', hot: { pack: 'fail' }, hide: ['wt', 'idx', 'head'], rows: [['fix', 'git filter-repo + rotate', 'warn']] },
    ]),
  ],
});

// ---------------- history: merge, rebase, reflog, progressive commits ----------------
const HN = (id: string, x: number, y: number, label: string, sub?: string, detail?: Detail) => N(id, x, y, 150, 90, label, sub, { detail });
const HIST_NODES = [
  HN('c1', 40, 400, 'A', 'base'),
  HN('c2', 230, 400, 'B', 'main'),
  HN('c3', 420, 400, 'C', 'main', d('A commit on main', 'Someone else’s work landed on main while you were on your branch.', '$ git log --oneline --graph --all')),
  HN('f1', 230, 600, 'X', 'feature'),
  HN('f2', 420, 600, 'Y', 'feature'),
  HN('m', 640, 400, 'M', 'merge commit', d('Merge commit', 'A commit with two parents. It records exactly how history happened; nothing is rewritten, so it is safe on shared branches.', '$ git switch main && git merge feature\nMerge made by the \'ort\' strategy.\n$ git cat-file -p HEAD | grep parent\nparent C…\nparent Y…')),
  HN('x2', 640, 600, "X'", 'rebased', d('Rebased commits are new commits', 'Rebase replays each commit on top of the new base. Same diff, new parent, so a new hash: X becomes X′.', '$ git rebase main\nSuccessfully rebased and updated refs/heads/feature.\n# never rebase commits others already pulled')),
  HN('y2', 830, 600, "Y'", 'feature'),
  N('ref', 640, 780, 320, 100, 'reflog', 'where HEAD has been', { detail: d('The reflog', 'Every move of HEAD and each branch is logged locally for ~90 days. After a bad reset or rebase, the old commits still exist; the reflog tells you their hashes.', '$ git reflog\na1b2c3d HEAD@{0}: reset: moving to HEAD~3\n9f8e7d6 HEAD@{1}: commit: add payment retries\n$ git reset --hard HEAD@{1}   # undo the reset') }),
  N('plan', 40, 780, 560, 100, 'progressive commits', 'core → side changes → features', { detail: d('Progressive commits (git-progressive)', 'Reorganise one big diff into layered commits a reviewer reads in order: core change first, then side changes, then features on top. Real hunks only, never rewritten code.', '$ git-progressive master\nphase 1: interfaces + config\nphase 2: core implementation\nphase 3: logging, docs, tests') }),
];
const HIST_EDGES = ['c1>c2', 'c2>c3', 'c1>f1', 'f1>f2', 'c3>m', 'f2>m', 'c3>x2', 'x2>y2'];
const histBoard = (code: string[], beats: Beat[]): Board => ({ panel: 'History', codeTitle: 'shell', code, nodes: HIST_NODES, edges: HIST_EDGES, beats });

boardDemo(G, 'git-history', 'Merge, rebase & recovery', 'Commit DAG: merge keeps history with a two-parent commit, rebase replays commits with new hashes, reflog recovers "lost" work, and progressive commits make big diffs reviewable.', {
  merge: [
    'Merge',
    histBoard(['$ git switch main', '$ git merge feature'], [
      { note: 'main and feature forked at A, and each gained commits since.', hot: { c3: 'current', f2: 'current' }, hide: ['m', 'x2', 'y2', 'ref', 'plan'], rows: [['diverged', '2 + 2 commits']] },
      { note: 'git merge finds the common ancestor A and combines both sides’ changes.', hl: [1], hot: { c1: 'read' }, hide: ['m', 'x2', 'y2', 'ref', 'plan'], rows: [['merge base', 'A']] },
      { note: 'It writes merge commit M with two parents, C and Y, and moves main to it.', hot: { m: 'write', 'c3>m': 'accent', 'f2>m': 'accent' }, hide: ['x2', 'y2', 'ref', 'plan'], rows: [['parents', 'C, Y'], ['rewritten', 'none', 'ok']] },
      { note: 'Conflicts appear only where both sides changed the same lines; fix them, git add, then commit.', hot: { m: 'ok' }, hide: ['x2', 'y2', 'ref', 'plan'], rows: [['safe on shared branches', 'yes', 'ok']] },
    ]),
  ],
  rebase: [
    'Rebase',
    histBoard(['$ git switch feature', '$ git rebase main'], [
      { note: 'Same starting point: feature branched from A while main moved on to C.', hot: { f1: 'current', f2: 'current', c3: 'read' }, hide: ['m', 'x2', 'y2', 'ref', 'plan'], rows: [['base', 'A']] },
      { note: 'Rebase replays X on top of C, producing X′, a new commit with a new hash.', hl: [1], hot: { x2: 'write', 'c3>x2': 'accent' }, hide: ['m', 'y2', 'ref', 'plan'], rows: [['replayed', "X → X'"]] },
      { note: 'Then Y becomes Y′, and the feature branch moves there, so history is a straight line.', hot: { y2: 'write', 'x2>y2': 'accent', f1: 'visited', f2: 'visited' }, hide: ['m', 'ref', 'plan'], rows: [['history', 'linear', 'ok']] },
      { note: 'The old X and Y still exist but nothing points at them; anyone who pulled them now has diverged.', hot: { f1: 'warn', f2: 'warn' }, hide: ['m', 'ref', 'plan'], rows: [['rule', "don't rebase pushed shared work", 'warn']] },
    ]),
  ],
  reflog: [
    'Reflog rescue',
    histBoard(['$ git reset --hard HEAD~2   # oops', '$ git reflog', '$ git reset --hard HEAD@{1}'], [
      { note: 'A hard reset moves main back to A, and B and C seem gone.', hl: [0], hot: { c1: 'current', c2: 'fail', c3: 'fail' }, hide: ['f1', 'f2', 'm', 'x2', 'y2', 'plan'], rows: [['main', 'A', 'warn']] },
      { note: 'Commits are never deleted by a reset, only unreferenced, and the reflog kept every position of HEAD.', hl: [1], hot: { ref: 'current' }, hide: ['f1', 'f2', 'm', 'x2', 'y2', 'plan'], rows: [['HEAD@{1}', 'C']] },
      { note: 'Reset back to HEAD@{1} and C is on main again, with B behind it.', hl: [2], hot: { c2: 'ok', c3: 'ok', ref: 'ok' }, hide: ['f1', 'f2', 'm', 'x2', 'y2', 'plan'], rows: [['main', 'C', 'ok']] },
      { note: 'Unreferenced commits survive about 90 days until gc prunes them, so act before then.', hot: { ref: 'warn' }, hide: ['f1', 'f2', 'm', 'x2', 'y2', 'plan'], rows: [['expiry', '~90 days']] },
    ]),
  ],
  progressive: [
    'Progressive commits',
    histBoard(['$ git-progressive feature', '# phase 1: skeleton · 2: core · 3: extras'], [
      { note: 'A feature branch arrives as one huge diff that is hard to review.', hot: { f2: 'warn' }, hide: ['m', 'x2', 'y2', 'ref'], rows: [['diff', '2,400 lines', 'warn']] },
      { note: 'Split its real hunks into phases: interfaces and config first, then the core change.', hl: [0], hot: { plan: 'current', x2: 'write' }, label: { x2: 'phase 1' }, hide: ['m', 'ref', 'y2'], rows: [['phase 1', 'skeleton']] },
      { note: 'Side changes and features layer on top, each commit readable on its own.', hl: [1], hot: { y2: 'write', 'x2>y2': 'accent' }, label: { x2: 'phase 1', y2: 'phase 2' }, hide: ['m', 'ref'], rows: [['phase 2', 'core'], ['phase 3', 'logging, tests']] },
      { note: 'Only the grouping and order change, never the code, so the final tree is byte-identical.', hot: { plan: 'ok', y2: 'ok' }, label: { x2: 'phase 1', y2: 'phase 2' }, hide: ['m', 'ref'], rows: [['final tree', 'identical', 'ok']] },
    ]),
  ],
});
