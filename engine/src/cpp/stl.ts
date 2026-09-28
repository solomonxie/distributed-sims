// STL (group cpp-stl): choosing containers, vector/string internals, sequence containers, map as a red-black tree,
// unordered_map buckets, iterators & invalidation, algorithms, heaps, tuples, non-owning views.
import type { Detail, Tone } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { boardDemo as demo, N } from '../machine/lib/board';
import type { Board } from '../machine/lib/board';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'cpp-stl';
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const all = (ids: string[], tone: Tone) => Object.fromEntries(ids.map((id) => [id, tone]));
const boardDemo = (slug: string, title: string, summary: string, boards: Record<string, [string, Board]>) => demo(G, slug, title, summary, boards);
function traceDemo(slug: string, title: string, summary: string, traces: Record<string, [label: string, trace: Trace]>) {
  machineDemo({
    slug,
    title,
    group: G,
    summary,
    inputs: Object.entries(traces).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => traceFrames(traces[k][1]),
  });
}

// ---------------- choosing a container ----------------
const VEC = D('std::vector', 'One contiguous heap array. Fast iteration, O(1) push_back at the end, cache friendly. The default choice.', 'std::vector<int> v{3, 1, 4};\nv.push_back(1);\nfor (int x : v) std::cout << x;');
const DEQ = D('std::deque', 'Fixed-size blocks plus a map of block pointers. O(1) push and pop at both ends; elements never move when you add at the ends.', 'std::deque<int> q;\nq.push_front(1);\nq.push_back(2);\nq.pop_front();');
const LST = D('std::list', 'Doubly linked nodes, one heap allocation each. Insert/erase anywhere is O(1) with an iterator, and nodes never move, but every hop is a cache miss.', 'std::list<int> l{1, 2, 3};\nauto it = std::next(l.begin());\nl.insert(it, 9);   // 1 9 2 3\nl.splice(l.end(), other);');
const MAP = D('std::map', 'A red-black tree of key/value nodes. Keys stay sorted; find, insert and erase are O(log n).', 'std::map<std::string, int> age;\nage["ann"] = 30;\nif (auto it = age.find("bob");\n    it != age.end())\n  std::cout << it->second;');
const UMAP = D('std::unordered_map', 'A hash table: an array of buckets, each a chain of nodes. O(1) average lookup, no ordering.', 'std::unordered_map<std::string, int> hits;\n++hits["/index.html"];\nstd::cout << hits.size();');
const ADAPT = D('Container adaptors', 'stack, queue and priority_queue wrap another container and expose a narrow interface.', 'std::stack<int> s;       // deque inside\nstd::queue<int> q;\nstd::priority_queue<int> pq; // vector heap\npq.push(5); pq.top();');
const VIEWS = D('Views', 'string_view and span point into memory someone else owns. Cheap to pass, but they dangle if the owner dies.', 'void print(std::string_view s);\nvoid sum(std::span<const int> xs);\nprint("literal");\nsum(vec);');

boardDemo('stl-containers', 'Choosing a container', 'The STL container families and a decision path: vector first, then deque, map, unordered_map, list only for special cases.', {
  families: [
    'Families',
    {
      panel: 'Containers',
      nodes: [
        N('seq', 40, 40, 440, 150, 'sequence', 'vector · deque · list · array', { detail: VEC }),
        N('ord', 520, 40, 440, 150, 'ordered', 'map · set (sorted tree)', { detail: MAP }),
        N('hash', 40, 240, 440, 150, 'unordered', 'hash map · hash set', { detail: UMAP }),
        N('adapt', 520, 240, 440, 150, 'adaptors', 'stack · queue · heap', { detail: ADAPT }),
        N('views', 40, 440, 920, 150, 'views (non-owning)', 'string_view · span', { detail: VIEWS }),
        N('algo', 40, 640, 920, 150, '<algorithm>', 'sort · find · lower_bound…', { detail: D('Algorithms', 'Algorithms take iterator ranges, so one sort works for any random-access container.', 'std::sort(v.begin(), v.end());\nauto it = std::find(v.begin(), v.end(), 42);\nstd::ranges::sort(v);  // C++20') }),
      ],
      edges: [],
      beats: [
        { note: 'The STL splits containers by how they find elements: by position, by sorted key, or by hash.', hot: { seq: 'current', ord: 'current', hash: 'current' }, rows: [['families', 3]] },
        { note: 'Adaptors wrap a container to give it a narrower interface, like stack or priority_queue.', hot: { adapt: 'current' }, rows: [['adaptors', 3]] },
        { note: 'Views own nothing: they are a pointer and a length into someone else’s memory.', hot: { views: 'current' }, rows: [['owns memory', 'no', 'warn']] },
        { note: 'Algorithms work on iterator ranges, so containers and algorithms mix freely. Tap any box for an example.', hot: { algo: 'current' }, rows: [['algorithms', '100+']] },
      ],
    },
  ],
  choose: [
    'Which one?',
    {
      panel: 'Decision',
      nodes: [
        N('q1', 40, 40, 920, 110, 'look up by key?'),
        N('q3', 40, 230, 440, 110, 'insert at the front?'),
        N('q2', 520, 230, 440, 110, 'need sorted keys?'),
        N('vec', 40, 420, 210, 110, 'vector', undefined, { detail: VEC }),
        N('deq', 270, 420, 210, 110, 'deque', undefined, { detail: DEQ }),
        N('map', 520, 420, 210, 110, 'map', undefined, { detail: MAP }),
        N('um', 750, 420, 210, 110, 'unordered', undefined, { detail: UMAP }),
        N('lst', 40, 620, 920, 120, 'list', 'only for stable nodes + splice', { detail: LST }),
        N('flat', 40, 800, 920, 120, 'sorted vector', 'small, read-mostly maps', { detail: D('Sorted vector as a map', 'For a few hundred read-mostly entries, a sorted vector with lower_bound beats map: one allocation and no pointer chasing. C++23 adds std::flat_map for this.', 'std::vector<std::pair<int, Row>> t;\nstd::sort(t.begin(), t.end());\nauto it = std::lower_bound(t.begin(), t.end(),\n    std::pair{id, Row{}});') }),
      ],
      edges: ['q1>q3', 'q1>q2', 'q3>vec', 'q3>deq', 'q2>map', 'q2>um'],
      beats: [
        { note: 'Start with the question: do you find elements by position or by key?', hot: { q1: 'current' }, hide: ['lst', 'flat'] },
        { note: 'By position: vector, unless you push at the front a lot, then deque.', hot: { q3: 'current', vec: 'ok', deq: 'default', 'q1>q3': 'accent', 'q3>vec': 'accent' }, hide: ['lst', 'flat'], rows: [['default', 'vector', 'ok']] },
        { note: 'By key: unordered_map for pure lookups, map when you also need order or range queries.', hot: { q2: 'current', um: 'ok', map: 'ok', 'q1>q2': 'accent', 'q2>um': 'accent', 'q2>map': 'accent' }, hide: ['lst', 'flat'], rows: [['lookup', 'O(1) vs O(log n)']] },
        { note: 'list is rarely right: pick it only when node addresses must never change or you splice lists.', hot: { lst: 'warn' }, hide: ['flat'], rows: [['cache misses', 'every hop', 'warn']] },
        { note: 'For small read-mostly tables, a sorted vector often beats both maps.', hot: { flat: 'ok' }, rows: [['allocations', 1, 'ok']] },
      ],
    },
  ],
});

// ---------------- vector ----------------
const VEC_VAR = D('The vector object', 'On the stack a vector is just three pointers: begin, end and end-of-capacity (24 bytes). The elements live in one heap block.', 'std::vector<int> v;\nstatic_assert(sizeof(v) == 24);\nv.size();      // end - begin\nv.capacity();  // cap - begin');
const BLOCK = D('Heap block', 'One contiguous allocation holding the elements back to back, plus spare capacity.', 'int* p = v.data();  // first element\np[2] == v[2];       // same memory');

traceDemo('stl-vector', 'vector in depth', 'size vs capacity, reserve, what insert and erase really cost, and emplace_back building in place.', {
  capacity: [
    'size & capacity',
    {
      code: ['std::vector<int> v;', 'v.reserve(2);', 'v.push_back(10);', 'v.push_back(20);', 'v.push_back(30);  // full: reallocate', 'std::cout << v.size() << " " << v.capacity();'],
      details: { v: VEC_VAR, blk: BLOCK, blk2: BLOCK, old: D('Freed block', 'After a reallocation the old block is deleted. Any pointer or iterator into it now dangles.', 'int* p = &v[0];\nv.push_back(x);   // may reallocate\n*p;               // undefined behaviour') },
      steps: [
        { line: 0, note: 'An empty vector owns no heap memory yet, just three null pointers.', vars: [['v', 'size 0 · cap 0']], out: '', rows: [['heap blocks', 0]] },
        { line: 1, note: 'reserve(2) allocates room for two ints, but size stays 0.', vars: [['v', 'size 0 · cap 2', 'current', 'blk']], heap: [['blk', '[ _ | _ ]', 'write', '2 slots']], out: '', rows: [['heap blocks', 1]] },
        { line: 2, note: 'push_back constructs 10 in the first free slot.', vars: [['v', 'size 1 · cap 2', 'current', 'blk']], heap: [['blk', '[ 10 | _ ]', 'write']], out: '' },
        { line: 3, note: 'Now the block is full.', vars: [['v', 'size 2 · cap 2', 'warn', 'blk']], heap: [['blk', '[ 10 | 20 ]', 'warn']], out: '' },
        { line: 4, note: 'No room, so push_back allocates a block twice the size, moves both elements and frees the old one.', vars: [['v', 'size 3 · cap 4', 'current', 'blk2']], heap: [['old', '[ 10 | 20 ]', 'visited', 'freed'], ['blk2', '[ 10 | 20 | 30 | _ ]', 'write', '4 slots']], out: '', rows: [['moves', 2, 'warn']] },
        { line: 5, note: 'size counts elements, capacity counts slots before the next reallocation.', vars: [['v', 'size 3 · cap 4', 'ok', 'blk2']], heap: [['blk2', '[ 10 | 20 | 30 | _ ]', 'ok']], out: '3 4', rows: [['size', 3], ['capacity', 4]] },
      ],
    },
  ],
  insert: [
    'insert & erase cost',
    {
      code: ['std::vector<int> v{1, 2, 3, 4};', 'v.insert(v.begin(), 0);   // shift right', 'v.push_back(5);           // amortised O(1)', 'v.erase(v.begin() + 1);   // shift left', 'v.pop_back();             // O(1)'],
      details: { v: VEC_VAR, blk: BLOCK },
      steps: [
        { line: 0, note: 'Four ints, contiguous.', vars: [['v', 'size 4 · cap 4', 'default', 'blk']], heap: [['blk', '1 2 3 4']], rows: [['moved', 0]] },
        { line: 1, note: 'Inserting at the front shifts every element one slot right: O(n). Here it also reallocates.', vars: [['v', 'size 5 · cap 8', 'current', 'blk']], heap: [['blk', '0 1 2 3 4 _ _ _', 'warn']], rows: [['moved', 4, 'warn']] },
        { line: 2, note: 'Appending at the end moves nothing while there is spare capacity.', vars: [['v', 'size 6 · cap 8', 'current', 'blk']], heap: [['blk', '0 1 2 3 4 5 _ _', 'ok']], rows: [['moved', 0, 'ok']] },
        { line: 3, note: 'Erasing from the middle shifts everything after it left: O(n) again.', vars: [['v', 'size 5 · cap 8', 'current', 'blk']], heap: [['blk', '0 2 3 4 5 _ _ _', 'warn']], rows: [['moved', 4, 'warn']] },
        { line: 4, note: 'Work at the back is cheap, work at the front is linear. Capacity never shrinks on its own; call shrink_to_fit.', vars: [['v', 'size 4 · cap 8', 'ok', 'blk']], heap: [['blk', '0 2 3 4 _ _ _ _', 'ok']], rows: [['capacity', 8]] },
      ],
    },
  ],
  emplace: [
    'emplace_back',
    {
      code: ['struct P { std::string name; int age; };', 'std::vector<P> v;', 'v.reserve(2);', 'v.push_back(P{"ann", 30});  // temp, then move', 'v.emplace_back("bob", 41);  // built in place'],
      details: {
        v: VEC_VAR,
        blk: BLOCK,
        tmp: D('Temporary P', 'P{"ann", 30} is built on the stack first, then moved into the vector and destroyed.', 'v.push_back(P{"ann", 30});\n// = construct tmp, move-construct\n//   into slot, destroy tmp'),
      },
      steps: [
        { line: [0, 1, 2], note: 'Room for two P objects, none constructed yet.', vars: [['v', 'size 0 · cap 2', 'default', 'blk']], heap: [['blk', '[ _ | _ ]']], rows: [['constructions', 0]] },
        { line: 3, note: 'push_back takes a finished object: a temporary is built, moved into the slot, then destroyed.', vars: [['v', 'size 1 · cap 2', 'current', 'blk']], heap: [['tmp', 'P{ann, 30}', 'visited', 'temporary'], ['blk', '[ ann,30 | _ ]', 'write']], rows: [['constructions', 2, 'warn']] },
        { line: 4, note: 'emplace_back forwards the arguments and constructs directly in the slot, with no temporary.', vars: [['v', 'size 2 · cap 2', 'ok', 'blk']], heap: [['blk', '[ ann,30 | bob,41 ]', 'ok']], rows: [['constructions', 1, 'ok']] },
      ],
    },
  ],
});

// ---------------- string ----------------
const STR = D('std::string', '32 bytes on the stack with libstdc++: a pointer, a size, and either a capacity or a 15-char inline buffer.', 'std::string s = "hi";\nsizeof(s);   // 32\ns.size();    // 2\ns.c_str();   // null-terminated');
traceDemo('stl-string', 'std::string & SSO', 'Short strings live inside the object (small string optimisation); long ones on the heap; copies are deep, moves steal.', {
  sso: [
    'Short vs long',
    {
      code: ['std::string a = "hi";', 'std::string b = "this one is longer than 15";', 'std::string c = a + b;', 'std::cout << c.size();'],
      details: { a: STR, b: STR, c: STR, hb: D('Heap buffer', 'Strings longer than the inline buffer allocate a heap buffer for their characters.', 'std::string b(100, \'x\');  // heap\nb.capacity();  // >= 100'), hc: D('Heap buffer', 'The result of a + b is a new string with its own buffer.', 's = a + b;       // new buffer\ns.reserve(64);   // avoid regrowth') },
      steps: [
        { line: 0, note: '"hi" fits in the object’s own 15-byte buffer: no allocation at all.', vars: [['a', '"hi" (inline)', 'ok']], out: '', rows: [['allocations', 0, 'ok']] },
        { line: 1, note: 'Too long for the inline buffer, so b allocates a heap buffer.', vars: [['a', '"hi" (inline)'], ['b', 'ptr → heap', 'current', 'hb']], heap: [['hb', '"this one is lon…"', 'write', '27 chars']], out: '', rows: [['allocations', 1]] },
        { line: 2, note: 'Concatenation builds a third string with its own buffer.', vars: [['a', '"hi" (inline)'], ['b', 'ptr → heap', 'default', 'hb'], ['c', 'ptr → heap', 'current', 'hc']], heap: [['hb', '"this one is lon…"'], ['hc', '"hithis one is…"', 'write', '29 chars']], out: '', rows: [['allocations', 2]] },
        { line: 3, note: 'Most real strings are short, so SSO removes most string allocations.', vars: [['a', '"hi" (inline)', 'ok'], ['b', 'ptr → heap', 'default', 'hb'], ['c', 'ptr → heap', 'default', 'hc']], heap: [['hb', '"this one is lon…"'], ['hc', '"hithis one is…"']], out: '29', rows: [['sizeof', '32 B']] },
      ],
    },
  ],
  copy: [
    'Copy vs move',
    {
      code: ['std::string s(40, \'x\');', 'std::string t = s;             // deep copy', 'std::string u = std::move(s);  // steal', 'std::cout << s.size();'],
      details: { s: STR, t: STR, u: STR, b1: D('s’s buffer', '40 chars on the heap.'), b2: D('t’s buffer', 'A copy allocates its own buffer and copies every char.', 'std::string t = s;  // malloc + memcpy') },
      steps: [
        { line: 0, note: 's owns a 40-char heap buffer.', vars: [['s', 'ptr → heap', 'current', 'b1']], heap: [['b1', 'xxxxxxxx… (40)', 'write']], out: '' },
        { line: 1, note: 'Copying allocates a second buffer and copies all 40 chars.', vars: [['s', 'ptr → heap', 'default', 'b1'], ['t', 'ptr → heap', 'current', 'b2']], heap: [['b1', 'xxxxxxxx… (40)'], ['b2', 'xxxxxxxx… (40)', 'write', 'copy']], out: '', rows: [['allocations', 2]] },
        { line: 2, note: 'Moving hands s’s pointer to u and leaves s empty. No allocation, no copying.', vars: [['s', '"" (moved-from)', 'visited'], ['t', 'ptr → heap', 'default', 'b2'], ['u', 'ptr → heap', 'ok', 'b1']], heap: [['b1', 'xxxxxxxx… (40)', 'ok', 'now u’s'], ['b2', 'xxxxxxxx… (40)']], out: '', rows: [['allocations', 2, 'ok']] },
        { line: 3, note: 'A moved-from string is valid but unspecified; in practice empty. Only assign to it or destroy it.', vars: [['s', '""', 'visited'], ['t', 'ptr → heap', 'default', 'b2'], ['u', 'ptr → heap', 'default', 'b1']], heap: [['b1', 'xxxxxxxx… (40)'], ['b2', 'xxxxxxxx… (40)']], out: '0' },
      ],
    },
  ],
  append: [
    'Building strings',
    {
      code: ['std::string out;', 'out.reserve(1000);', 'for (int i = 0; i < 100; ++i)', '  out += std::to_string(i) + ",";', 'std::cout << out.size();'],
      details: { out: STR, buf: D('Reserved buffer', 'reserve allocates once up front so the loop never reallocates.', 's.reserve(n);\nfor (…) s += piece;  // no regrowth') },
      steps: [
        { line: 0, note: 'Empty string, inline buffer.', vars: [['out', '"" · cap 15']], rows: [['reallocations', 0]] },
        { line: 1, note: 'reserve allocates 1000 bytes up front.', vars: [['out', '"" · cap 1000', 'current', 'buf']], heap: [['buf', '1000 bytes', 'write']], rows: [['reallocations', 0]] },
        { line: [2, 3], note: 'Appends fill the reserved space. Without reserve, the buffer would regrow about 7 times.', vars: [['i', '42', 'current'], ['out', '"0,1,…,41," · cap 1000', 'default', 'buf']], heap: [['buf', '"0,1,2,…"', 'write', '116 used']], rows: [['reallocations', 0, 'ok']] },
        { line: 4, note: 'For heavy formatting, std::format or an ostringstream is clearer; the reserve idea still applies.', vars: [['out', '290 chars · cap 1000', 'ok', 'buf']], heap: [['buf', '"0,1,…,99,"', 'ok']], out: '290', rows: [['reallocations', 0, 'ok']] },
      ],
    },
  ],
});

// ---------------- array, deque, list ----------------
const cells = (prefix: string, vals: string[], x0: number, y: number, w: number, detail?: Detail) => vals.map((v, i) => N(`${prefix}${i}`, x0 + i * (w + 10), y, w, 100, v, undefined, detail ? { detail } : {}));
boardDemo('stl-sequence', 'array, deque & list', 'Memory shapes of the other sequence containers: array inline, deque as blocks, list as linked nodes.', {
  array: [
    'std::array',
    {
      panel: 'array',
      code: ['std::array<int, 4> a{1, 2, 3, 4};', 'a[2] = 9;', 'a.at(7);   // throws std::out_of_range'],
      nodes: [N('obj', 40, 220, 920, 90, 'a (on the stack)', '16 bytes, no heap', { detail: D('std::array', 'A fixed-size C array wrapped in a struct. Lives wherever you put it, knows its size, and copies by value.', 'std::array<int, 3> a{1, 2, 3};\nauto b = a;        // copies 3 ints\na.size();          // 3, constexpr') }), ...cells('c', ['1', '2', '3', '4'], 40, 350, 222, D('Element', 'Elements sit inline in the object, back to back.')), N('err', 40, 520, 920, 110, 'a.at(7)', 'std::out_of_range')],
      edges: [],
      beats: [
        { note: 'std::array is a C array in a struct: the four ints are inside the object itself.', hl: [0], hot: { obj: 'current' }, hide: ['err'], rows: [['heap', 'none', 'ok']] },
        { note: 'Indexing is a plain address calculation, no bounds check.', hl: [1], hot: { c2: 'write' }, label: { c2: '9' }, hide: ['err'], rows: [['a[2]', 9]] },
        { note: 'at() checks bounds and throws instead of corrupting memory.', hl: [2], hot: { err: 'fail' }, label: { c2: '9' }, rows: [['bounds check', 'at() only', 'warn']] },
      ],
    },
  ],
  deque: [
    'std::deque',
    {
      panel: 'deque',
      code: ['std::deque<int> q{1, 2, 3, 4, 5};', 'q.push_front(0);', 'q.push_back(6);'],
      nodes: [
        N('map', 40, 200, 180, 400, 'map', 'block ptrs', { detail: D('Block map', 'A small array of pointers to fixed-size blocks. Growing at either end adds a block, never moves elements.', 'std::deque<int> q;\nq.push_front(1);  // new block if needed\nq[3];             // two hops: map, block') }),
        N('b0', 300, 200, 660, 110, '_ _ _ _', 'block 0'),
        N('b1', 300, 345, 660, 110, '_ 1 2 3', 'block 1'),
        N('b2', 300, 490, 660, 110, '4 5 _ _', 'block 2'),
        N('note', 40, 700, 920, 150, 'references stay valid', 'on push_front / push_back', { detail: D('Stability', 'Adding at the ends never moves existing elements, so pointers and references to them stay valid (iterators do not).') }),
      ],
      edges: ['map>b0', 'map>b1', 'map>b2'],
      beats: [
        { note: 'A deque stores elements in fixed-size blocks, found through a map of block pointers.', hl: [0], hot: { map: 'current', b1: 'write', b2: 'write' }, hide: ['b0', 'note'], rows: [['blocks', 2]] },
        { note: 'push_front fills the free slot before 1; a new block is added when the front one is full.', hl: [1], hot: { b1: 'write' }, label: { b1: '0 1 2 3' }, hide: ['b0', 'note'], rows: [['moved', 0, 'ok']] },
        { note: 'push_back fills block 2. Existing elements never move.', hl: [2], hot: { b2: 'write', note: 'ok' }, label: { b1: '0 1 2 3', b2: '4 5 6 _' }, hide: ['b0'], rows: [['moved', 0, 'ok']] },
        { note: 'The price: indexing takes two hops and iteration is less cache-friendly than a vector.', hot: { map: 'warn', 'map>b1': 'accent' }, label: { b1: '0 1 2 3', b2: '4 5 6 _' }, rows: [['index cost', '2 loads', 'warn']] },
      ],
    },
  ],
  list: [
    'std::list',
    {
      panel: 'list',
      code: ['std::list<int> l{1, 2, 3};', 'auto it = std::next(l.begin());', 'l.insert(it, 9);          // 1 9 2 3'],
      nodes: [
        N('n1', 40, 260, 200, 120, '1', 'prev|next', { detail: LST }),
        N('n2', 290, 260, 200, 120, '2', 'prev|next', { detail: LST }),
        N('n3', 540, 260, 200, 120, '3', 'prev|next', { detail: LST }),
        N('n9', 290, 470, 200, 120, '9', 'new node', { detail: LST }),
        N('it', 540, 470, 200, 120, 'it', '→ node 2', { detail: D('List iterator', 'A pointer to a node. Stays valid until that node is erased.') }),
        N('mem', 40, 690, 920, 140, 'each node: 1 malloc', 'value + 2 pointers = 24 B for an int', { detail: D('Overhead', 'An int in a list costs 24 bytes plus allocator overhead, and nodes are scattered in memory.') }),
      ],
      edges: ['n1>n2', 'n2>n3', 'n1>n9', 'n9>n2'],
      beats: [
        { note: 'Each element is its own heap node with prev and next pointers.', hl: [0], hot: { n1: 'current', n2: 'current', n3: 'current' }, hide: ['n9', 'it', 'n1>n9', 'n9>n2', 'mem'], rows: [['allocations', 3]] },
        { note: 'it points at node 2.', hl: [1], hot: { it: 'accent', n2: 'accent' }, hide: ['n9', 'n1>n9', 'n9>n2', 'mem'] },
        { note: 'insert allocates one node and relinks four pointers. Nothing moves.', hl: [2], hot: { n9: 'write', 'n1>n9': 'accent', 'n9>n2': 'accent', 'n1>n2': 'visited' }, hide: ['mem', 'n1>n2'], rows: [['moved', 0, 'ok']] },
        { note: 'But every node is scattered in memory, so walking a list is a chain of cache misses.', hot: { mem: 'warn' }, hide: ['n1>n2'], rows: [['bytes per int', 24, 'warn']] },
      ],
    },
  ],
});

// ---------------- map: red-black tree ----------------
const RB = (k: string) => D(`Node ${k}`, 'A heap node holding the key, the value, a colour bit and three pointers (parent, left, right).', 'struct Node {\n  Node *parent, *left, *right;\n  bool red;\n  std::pair<const int, std::string> kv;\n};');
const TREE_NODES = [
  N('n50', 400, 240, 200, 90, '50', 'black', { detail: RB('50') }),
  N('n30', 170, 400, 200, 90, '30', 'red', { detail: RB('30') }),
  N('n70', 630, 400, 200, 90, '70', 'red', { detail: RB('70') }),
  N('n20', 40, 570, 180, 90, '20', 'black', { detail: RB('20') }),
  N('n40', 280, 570, 180, 90, '40', 'black', { detail: RB('40') }),
  N('n60', 540, 570, 180, 90, '60', 'black', { detail: RB('60') }),
  N('n80', 780, 570, 180, 90, '80', 'black', { detail: RB('80') }),
  N('out', 40, 760, 920, 150, 'output', ''),
];
const TREE_EDGES = ['n50>n30', 'n50>n70', 'n30>n20', 'n30>n40', 'n70>n60', 'n70>n80'];
const mapBoard = (beats: Board['beats']): Board => ({
  panel: 'std::map',
  code: ['std::map<int, std::string> m;   // 7 keys', 'auto it = m.find(40);', 'for (auto& [k, v] : m) std::cout << k;', 'auto lo = m.lower_bound(45);'],
  nodes: TREE_NODES,
  edges: TREE_EDGES,
  beats,
});
boardDemo('stl-map', 'map as a red-black tree', 'std::map and std::set are balanced binary search trees: O(log n) find, sorted in-order iteration, lower_bound range queries.', {
  find: [
    'find',
    mapBoard([
      { note: 'std::map keeps its keys in a red-black tree: a binary search tree that stays balanced.', hl: [0], hide: ['out'], rows: [['keys', 7], ['height', 3]] },
      { note: 'find(40) starts at the root: 40 < 50, go left.', hl: [1], hot: { n50: 'current', 'n50>n30': 'accent' }, hide: ['out'], rows: [['compares', 1]] },
      { note: '40 > 30, go right.', hl: [1], hot: { n50: 'visited', n30: 'current', 'n30>n40': 'accent' }, hide: ['out'], rows: [['compares', 2]] },
      { note: 'Found in 3 compares. A million keys take about 20.', hl: [1], hot: { n50: 'visited', n30: 'visited', n40: 'ok' }, hide: ['out'], rows: [['compares', 3, 'ok'], ['1M keys', '~20']] },
    ]),
  ],
  iterate: [
    'Sorted iteration',
    mapBoard([
      { note: 'Iterating a map walks the tree in order: left subtree, node, right subtree.', hl: [2], hot: { n20: 'current' }, sub: { out: '20' }, rows: [['visited', 1]] },
      { note: 'So keys always come out sorted, whatever order you inserted them in.', hl: [2], hot: { n20: 'visited', n30: 'visited', n40: 'visited', n50: 'current' }, sub: { out: '20 30 40 50' }, rows: [['visited', 4]] },
      { note: 'Each ++it follows parent or child pointers, a pointer hop per step.', hl: [2], hot: { ...all(['n20', 'n30', 'n40', 'n50', 'n60', 'n70'], 'visited'), n80: 'current' }, sub: { out: '20 30 40 50 60 70 80' }, rows: [['visited', 7, 'ok']] },
    ]),
  ],
  range: [
    'lower_bound',
    mapBoard([
      { note: 'lower_bound(45) finds the first key not less than 45.', hl: [3], hot: { n50: 'current' }, hide: ['out'], rows: [['target', 45]] },
      { note: '45 < 50, so 50 is a candidate; go left to look for something smaller.', hl: [3], hot: { n50: 'accent', n30: 'current', 'n50>n30': 'accent' }, hide: ['out'] },
      { note: '45 > 30 and 45 > 40, so nothing smaller qualifies. The answer is 50.', hl: [3], hot: { n30: 'visited', n40: 'visited', n50: 'ok' }, sub: { out: 'lo → 50' }, rows: [['result', 50, 'ok']] },
      { note: 'lower_bound plus ++ gives range queries, like all orders between two timestamps. unordered_map can’t do this.', hot: { n50: 'ok', n60: 'ok', n70: 'ok' }, sub: { out: '[45, 75): 50 60 70' }, rows: [['range query', 'O(log n + k)', 'ok']] },
    ]),
  ],
});

// ---------------- unordered_map ----------------
const BK = (i: number) => D(`Bucket ${i}`, 'Each bucket is the head of a chain of nodes whose hash lands here. Lookup hashes the key, picks the bucket, then compares keys along the chain.', 'size_t b = std::hash<std::string>{}(key)\n           % m.bucket_count();\nm.bucket("cat");        // which bucket\nm.bucket_size(b);       // chain length');
const BUCKETS = Array.from({ length: 6 }, (_, i) => N(`b${i}`, 40, 250 + i * 110, 150, 90, `b${i}`, undefined, { detail: BK(i) }));
const HNODE = D('Hash node', 'One heap allocation per element: the key, the value, the cached hash and a next pointer.', 'm["cat"] = 1;   // allocates a node');
boardDemo('stl-hash', 'unordered_map & hashing', 'Buckets and chains, collisions, load factor and rehashing, and why a bad hash makes O(1) become O(n).', {
  insert: [
    'insert & collide',
    {
      panel: 'unordered_map',
      code: ['std::unordered_map<std::string, int> m;', 'm["cat"] = 1;   // hash % 6 == 3', 'm["dog"] = 2;   // hash % 6 == 1', 'm["owl"] = 3;   // hash % 6 == 3 again'],
      nodes: [...BUCKETS, N('cat', 260, 580, 300, 90, 'cat: 1', undefined, { detail: HNODE }), N('dog', 260, 360, 300, 90, 'dog: 2', undefined, { detail: HNODE }), N('owl', 620, 580, 300, 90, 'owl: 3', undefined, { detail: HNODE })],
      edges: ['b3>cat', 'b1>dog', 'cat>owl'],
      beats: [
        { note: 'An unordered_map is an array of buckets. Each key hashes to one bucket.', hl: [0], hide: ['cat', 'dog', 'owl'], rows: [['buckets', 6], ['size', 0]] },
        { note: '"cat" hashes to bucket 3, so a node is allocated and hung off b3.', hl: [1], hot: { b3: 'current', cat: 'write', 'b3>cat': 'accent' }, hide: ['dog', 'owl'], rows: [['size', 1]] },
        { note: '"dog" lands in bucket 1.', hl: [2], hot: { b1: 'current', dog: 'write', 'b1>dog': 'accent' }, hide: ['owl'], rows: [['size', 2]] },
        { note: '"owl" also lands in bucket 3: a collision, so it joins the chain.', hl: [3], hot: { b3: 'warn', owl: 'write', 'cat>owl': 'accent' }, rows: [['size', 3], ['longest chain', 2, 'warn']] },
        { note: 'find("owl") hashes, jumps to b3, then compares keys along the chain. Short chains keep it O(1).', hot: { b3: 'current', cat: 'visited', owl: 'ok' }, rows: [['compares', 2]] },
      ],
    },
  ],
  rehash: [
    'Load factor & rehash',
    {
      panel: 'unordered_map',
      code: ['// max_load_factor() == 1.0', 'for (auto& w : words) m[w]++;   // 7th insert', 'm.reserve(100);   // pre-size, no rehash later'],
      nodes: [...BUCKETS, ...[0, 1, 2, 3, 4, 5].map((i) => N(`k${i}`, 260, 250 + i * 110, 300, 90, `key ${i}`, undefined, { detail: HNODE })), N('k6', 620, 470, 300, 90, 'key 6', undefined, { detail: HNODE })],
      edges: ['b0>k0', 'b1>k1', 'b2>k2', 'b3>k3', 'b4>k4', 'b5>k5', 'k2>k6'],
      beats: [
        { note: 'Load factor is size / bucket_count. Six keys in six buckets is 1.0, the default maximum.', hl: [0], hide: ['k6'], rows: [['load factor', '1.0', 'warn']] },
        { note: 'The 7th insert would exceed it, so the table rehashes: a bigger bucket array and every node relinked.', hl: [1], hot: { ...all(BUCKETS.map((b) => b.id), 'write'), k6: 'write' }, rows: [['buckets', '6 → 13'], ['relinked', 7, 'warn']] },
        { note: 'Rehashing invalidates all iterators and costs O(n), a latency spike on a hot path.', hot: { ...all(BUCKETS.map((b) => b.id), 'warn') }, rows: [['iterators', 'invalidated', 'fail']] },
        { note: 'If you know the size, reserve it up front. Also make sure the hash spreads keys, or every key piles into one chain.', hl: [2], hot: { ...all(BUCKETS.map((b) => b.id), 'ok') }, rows: [['rehashes', 0, 'ok']] },
      ],
    },
  ],
});

// ---------------- iterators ----------------
const CAT = (t: string, text: string, code: string) => D(t, text, code);
boardDemo('stl-iterators', 'Iterators', 'Iterator categories (what each container can do) and the invalidation rules that cause real bugs.', {
  categories: [
    'Categories',
    {
      panel: 'Iterators',
      nodes: [
        N('in', 40, 40, 920, 120, 'input', 'read once, ++ · istream', { detail: CAT('Input iterator', 'Read each element once, moving forward only. Enough for std::find.', 'std::istream_iterator<int> it(std::cin);') }),
        N('fwd', 40, 200, 920, 120, 'forward', 'multi-pass · forward_list', { detail: CAT('Forward iterator', 'Can pass over the range several times. Singly linked lists and hash containers.', 'std::forward_list<int> f;\nfor (auto it = f.begin(); …; ++it)') }),
        N('bid', 40, 360, 920, 120, 'bidirectional', '-- too · list, map, set', { detail: CAT('Bidirectional iterator', 'Adds --. std::reverse works, std::sort does not.', 'std::list<int> l;\nstd::reverse(l.begin(), l.end());\nl.sort();   // member sort instead') }),
        N('ra', 40, 520, 920, 120, 'random access', 'it + n · deque', { detail: CAT('Random-access iterator', 'Jumps in O(1): it + n, it[n], it2 - it1. Needed by std::sort and binary search.', 'std::sort(d.begin(), d.end());\nauto mid = d.begin() + d.size() / 2;') }),
        N('ct', 40, 680, 920, 120, 'contiguous', 'raw memory · vector, array, string', { detail: CAT('Contiguous iterator', 'Elements are adjacent in memory, so &*it + 1 == &*(it + 1). Can be passed to C APIs via data().', 'write(fd, v.data(), v.size() * sizeof(int));') }),
      ],
      edges: ['in>fwd', 'fwd>bid', 'bid>ra', 'ra>ct'],
      beats: [
        { note: 'An iterator is a generalised pointer. Categories say which operations it supports, each adding to the last.', hot: { in: 'current' } },
        { note: 'Algorithms state the category they need. std::sort needs random access, so it won’t compile on a list.', hot: { ra: 'current', bid: 'fail' }, rows: [['std::sort(list)', 'compile error', 'fail']] },
        { note: 'Contiguous iterators are raw memory underneath, which is why vector and string are fastest to scan.', hot: { ct: 'ok' }, rows: [['fastest scan', 'contiguous', 'ok']] },
      ],
    },
  ],
});
traceDemo('stl-invalidation', 'Iterator invalidation', 'Which operations invalidate iterators, and the classic erase-while-iterating bug.', {
  pushback: [
    'push_back',
    {
      code: ['std::vector<int> v{1, 2, 3};   // cap 3', 'auto it = v.begin();', 'v.push_back(4);                // reallocates', 'std::cout << *it;               // UB'],
      details: {
        it: D('Iterator into a vector', 'For vector it is essentially a pointer into the heap block. Any reallocation leaves it pointing at freed memory.', 'auto it = v.begin();\nv.push_back(x);  // it may dangle\nit = v.begin();  // re-fetch after'),
        old: D('Freed block', 'The old storage was deallocated during reallocation.'),
        nb: D('New block', 'Elements were moved here; only fresh iterators point at it.'),
      },
      steps: [
        { line: 0, note: 'A full vector: size 3, capacity 3.', vars: [['v', 'size 3 · cap 3', 'default', 'old']], heap: [['old', '1 2 3']], out: '' },
        { line: 1, note: 'it points at the first element.', vars: [['v', 'size 3 · cap 3', 'default', 'old'], ['it', '&v[0]', 'current', 'old']], heap: [['old', '1 2 3']], out: '' },
        { line: 2, note: 'push_back reallocates. v moves to a new block and the old one is freed.', vars: [['v', 'size 4 · cap 6', 'write', 'nb'], ['it', 'old address', 'fail', 'old']], heap: [['old', '1 2 3', 'visited', 'freed'], ['nb', '1 2 3 4', 'write']], out: '' },
        { line: 3, note: 'Dereferencing it reads freed memory: undefined behaviour. ASan reports heap-use-after-free.', vars: [['v', 'size 4 · cap 6', 'default', 'nb'], ['it', 'dangling', 'fail', 'old']], heap: [['old', '??? (freed)', 'fail'], ['nb', '1 2 3 4']], out: '1?  or garbage, or a crash', rows: [['bug', 'use-after-free', 'fail']] },
      ],
    },
  ],
  erase: [
    'Erase while iterating',
    {
      code: ['for (auto it = v.begin(); it != v.end(); ) {', '  if (*it % 2 == 0) it = v.erase(it);', '  else ++it;', '}', '// or: std::erase_if(v, is_even);  // C++20'],
      details: { it: D('Using erase’s return value', 'erase invalidates the erased iterator and everything after it, but returns a valid iterator to the next element.', 'it = v.erase(it);  // correct\nv.erase(it); ++it; // bug') },
      steps: [
        { line: 0, note: 'Remove even numbers from 1 2 4 5.', vars: [['v', '1 2 4 5'], ['it', '→ 1', 'current']], rows: [['size', 4]] },
        { line: 1, note: 'At 2: erase shifts 4 and 5 left. The old it is invalid, so take the one erase returns.', vars: [['v', '1 4 5', 'write'], ['it', '→ 4', 'current']], rows: [['size', 3]] },
        { line: 1, note: 'At 4: erase again, and don’t ++ afterwards or 5 would be skipped.', vars: [['v', '1 5', 'write'], ['it', '→ 5', 'current']], rows: [['size', 2]] },
        { line: 4, note: 'C++20 std::erase_if does all of this in one call and in O(n).', vars: [['v', '1 5', 'ok'], ['it', 'end', 'visited']], rows: [['vector: invalidates', 'erased + after'], ['map: invalidates', 'erased only']] },
      ],
    },
  ],
});

// ---------------- algorithms ----------------
const ALG_V = D('The data', 'A std::vector<int>. Algorithms only see the iterator range [begin, end).');
traceDemo('stl-algorithms', 'Algorithms', 'sort, binary search with lower_bound, the erase-remove idiom, transform and accumulate.', {
  sort: [
    'sort & stable_sort',
    {
      code: ['std::vector<int> v{5, 2, 8, 1, 9, 3};', 'std::sort(v.begin(), v.end());', 'std::sort(v.begin(), v.end(), std::greater{});', 'std::stable_sort(people.begin(), people.end(),', '  [](auto& a, auto& b) { return a.age < b.age; });'],
      details: { v: ALG_V, people: D('stable_sort', 'Keeps equal elements in their original order. Sort by name first, then stable_sort by age, and people of the same age stay alphabetical.', 'std::sort(p.begin(), p.end(), by_name);\nstd::stable_sort(p.begin(), p.end(), by_age);') },
      steps: [
        { line: 0, note: 'Six unsorted ints.', vars: [['v', '5 2 8 1 9 3']], rows: [['sorted', 'no']] },
        { line: 1, note: 'std::sort is introsort: quicksort that falls back to heapsort, O(n log n) worst case.', vars: [['v', '1 2 3 5 8 9', 'write']], rows: [['compares', '~n log n']] },
        { line: 2, note: 'Pass a comparator to change the order. std::greater sorts descending.', vars: [['v', '9 8 5 3 2 1', 'write']] },
        { line: [3, 4], note: 'sort may reorder equal elements. stable_sort keeps their original order.', vars: [['v', '9 8 5 3 2 1'], ['people', 'ann 30, bob 25, cy 30 → bob, ann, cy', 'ok']], rows: [['stable', 'yes', 'ok']] },
      ],
    },
  ],
  search: [
    'Binary search',
    {
      code: ['std::vector<int> v{1, 3, 5, 7, 9, 11, 13};', 'auto it = std::lower_bound(v.begin(), v.end(), 8);', 'std::cout << *it << " at " << it - v.begin();'],
      details: { v: D('Sorted range', 'lower_bound, upper_bound, equal_range and binary_search all require the range to be sorted by the same comparator.'), lo: D('lower_bound', 'Returns the first position where the value could be inserted without breaking the order: the first element not less than it.', 'auto it = std::lower_bound(b, e, x);\nbool found = it != e && *it == x;') },
      steps: [
        { line: 1, note: 'lower_bound halves the range each step. Middle is 7, and 7 < 8, so keep the right half.', vars: [['v', '1 3 5 [7] 9 11 13'], ['lo', 'idx 4..7', 'current']], out: '', rows: [['steps', 1]] },
        { line: 1, note: 'Middle of 9 11 13 is 11, and 11 ≥ 8, so keep the left half.', vars: [['v', '1 3 5 7 9 [11] 13'], ['lo', 'idx 4..5', 'current']], out: '', rows: [['steps', 2]] },
        { line: 1, note: '9 ≥ 8, so the answer is index 4: the first element not less than 8.', vars: [['v', '1 3 5 7 [9] 11 13'], ['lo', 'idx 4', 'ok']], out: '', rows: [['steps', 3, 'ok']] },
        { line: 2, note: '8 isn’t present, but lower_bound still tells you where it would go. O(log n) on any random-access range.', vars: [['v', '1 3 5 7 9 11 13'], ['lo', 'idx 4', 'ok']], out: '9 at 4', rows: [['1M elements', '20 steps']] },
      ],
    },
  ],
  eraseRemove: [
    'erase-remove',
    {
      code: ['std::vector<int> v{1, 0, 2, 0, 3};', 'auto end = std::remove(v.begin(), v.end(), 0);', 'v.erase(end, v.end());', '// C++20: std::erase(v, 0);'],
      details: { v: ALG_V, end: D('The new logical end', 'std::remove can’t change the container’s size; it only has iterators. It returns where the kept elements end.', 'auto e = std::remove_if(b, v.end(), pred);\nv.erase(e, v.end());') },
      steps: [
        { line: 0, note: 'Remove all zeros.', vars: [['v', '1 0 2 0 3 · size 5']], rows: [['size', 5]] },
        { line: 1, note: 'std::remove shifts the kept elements to the front. The tail is leftover junk and the size is unchanged.', vars: [['v', '1 2 3 | 0 3 · size 5', 'warn'], ['end', '→ idx 3', 'current']], rows: [['size', 5, 'warn']] },
        { line: 2, note: 'erase(end, v.end()) actually shrinks the vector.', vars: [['v', '1 2 3 · size 3', 'ok'], ['end', 'invalid now', 'visited']], rows: [['size', 3, 'ok']] },
        { line: 3, note: 'Forgetting the erase is a classic bug. C++20 std::erase and std::erase_if do both steps.', vars: [['v', '1 2 3', 'ok']], rows: [['passes', 1, 'ok']] },
      ],
    },
  ],
  fold: [
    'transform & accumulate',
    {
      code: ['std::vector<int> v{1, 2, 3, 4};', 'std::vector<int> sq(v.size());', 'std::transform(v.begin(), v.end(), sq.begin(),', '               [](int x) { return x * x; });', 'int sum = std::accumulate(sq.begin(), sq.end(), 0);'],
      details: { sq: D('Destination range', 'transform writes through an output iterator; the destination must already have room, or use std::back_inserter.', 'std::vector<int> out;\nstd::transform(b, e, std::back_inserter(out), f);'), sum: D('accumulate', 'Folds a range with + (or any binary op) from an initial value. The init type sets the result type: 0 gives int, 0.0 gives double.', 'double avg = std::accumulate(b, e, 0.0) / n;') },
      steps: [
        { line: [0, 1], note: 'sq is pre-sized to hold the results.', vars: [['v', '1 2 3 4'], ['sq', '0 0 0 0']] },
        { line: [2, 3], note: 'transform applies the lambda to each element and writes the result.', vars: [['v', '1 2 3 4'], ['sq', '1 4 9 16', 'write']] },
        { line: 4, note: 'accumulate folds them with + starting from 0.', vars: [['v', '1 2 3 4'], ['sq', '1 4 9 16'], ['sum', '30', 'ok']], rows: [['loops written', 0, 'ok']] },
        { line: 4, note: 'Named algorithms say what the loop does. With std::execution::par some run in parallel too.', vars: [['sum', '30', 'ok']], rows: [['parallel', 'reduce, transform']] },
      ],
    },
  ],
});

// ---------------- heap / priority_queue ----------------
const HN = D('Heap slot', 'A binary heap stores a complete tree in an array: children of index i are 2i+1 and 2i+2. Every parent is ≥ its children.', 'std::priority_queue<int> pq;\npq.push(7);\npq.top();   // largest\npq.pop();');
const heapNodes = (vals: string[]) => [
  N('h0', 400, 220, 200, 90, vals[0], 'idx 0', { detail: HN }),
  N('h1', 170, 380, 200, 90, vals[1], 'idx 1', { detail: HN }),
  N('h2', 630, 380, 200, 90, vals[2], 'idx 2', { detail: HN }),
  N('h3', 40, 540, 180, 90, vals[3], 'idx 3', { detail: HN }),
  N('h4', 280, 540, 180, 90, vals[4], 'idx 4', { detail: HN }),
  N('h5', 540, 540, 180, 90, vals[5], 'idx 5', { detail: HN }),
  N('arr', 40, 720, 920, 120, 'array', vals.join(' '), { detail: D('The real storage', 'The tree is only a picture: the heap is a plain vector, so push and pop are O(log n) with no pointers.') }),
];
const HEAP_EDGES = ['h0>h1', 'h0>h2', 'h1>h3', 'h1>h4', 'h2>h5'];
boardDemo('stl-heap', 'priority_queue & heaps', 'A binary max-heap in a vector: push sifts up, pop sifts down, top is O(1).', {
  push: [
    'push',
    {
      panel: 'priority_queue',
      code: ['std::priority_queue<int> pq;   // 9 7 8 3 5', 'pq.push(10);'],
      nodes: heapNodes(['9', '7', '8', '3', '5', '_']),
      edges: HEAP_EDGES,
      beats: [
        { note: 'A max-heap: every parent is at least as large as its children, so the maximum is at index 0.', hl: [0], hot: { h0: 'ok' }, hide: ['h5'], rows: [['top', 9]] },
        { note: 'push(10) appends at the end of the array, index 5.', hl: [1], hot: { h5: 'write' }, label: { h5: '10' }, sub: { arr: '9 7 8 3 5 10' }, rows: [['size', 6]] },
        { note: '10 > its parent 8, so swap them.', hl: [1], hot: { h5: 'write', h2: 'write', 'h2>h5': 'accent' }, label: { h5: '8', h2: '10' }, sub: { arr: '9 7 10 3 5 8' }, rows: [['swaps', 1]] },
        { note: '10 > 9, swap again. It reaches the root after log2(n) swaps at most.', hl: [1], hot: { h0: 'ok', h2: 'write', 'h0>h2': 'accent' }, label: { h0: '10', h2: '9', h5: '8' }, sub: { arr: '10 7 9 3 5 8' }, rows: [['swaps', 2], ['top', 10, 'ok']] },
      ],
    },
  ],
  pop: [
    'pop',
    {
      panel: 'priority_queue',
      code: ['pq.pop();   // remove 10', '// top-k: keep a min-heap of size k'],
      nodes: heapNodes(['10', '7', '9', '3', '5', '8']),
      edges: HEAP_EDGES,
      beats: [
        { note: 'pop removes the root: the last element, 8, moves to the root.', hl: [0], hot: { h0: 'warn' }, label: { h0: '8' }, hide: ['h5'], sub: { arr: '8 7 9 3 5' }, rows: [['size', 5]] },
        { note: '8 sifts down, swapping with its larger child, 9.', hl: [0], hot: { h0: 'write', h2: 'write', 'h0>h2': 'accent' }, label: { h0: '9', h2: '8' }, hide: ['h5'], sub: { arr: '9 7 8 3 5' }, rows: [['swaps', 1]] },
        { note: 'The heap property holds again. push and pop are O(log n), top is O(1).', hot: { h0: 'ok' }, label: { h0: '9', h2: '8' }, hide: ['h5'], sub: { arr: '9 7 8 3 5' }, rows: [['top', 9, 'ok']] },
        { note: 'For top-k of a stream, keep a min-heap of size k and pop whenever it grows past k.', hl: [1], hot: { arr: 'accent' }, label: { h0: '9', h2: '8' }, hide: ['h5'], sub: { arr: 'O(n log k)' }, rows: [['use', 'schedulers, top-k, Dijkstra']] },
      ],
    },
  ],
});

// ---------------- pair, tuple, structured bindings ----------------
traceDemo('stl-tuple', 'pair, tuple & structured bindings', 'Grouping values without a struct, returning several values, and unpacking them with auto [a, b].', {
  bindings: [
    'Structured bindings',
    {
      code: ['std::pair<std::string, int> p{"ann", 30};', 'auto [name, age] = p;', 'std::tuple<int, double, char> t{1, 2.5, \'x\'};', 'auto [i, d, c] = t;', 'for (auto& [k, v] : ages) std::cout << k;'],
      details: {
        p: D('std::pair', 'Two public members, first and second. map stores its elements as pair<const Key, Value>.', 'auto p = std::make_pair("ann", 30);\np.first; p.second;'),
        name: D('Structured binding', 'auto [a, b] = x; makes a hidden copy of x and names its parts. auto& [a, b] binds to x itself.', 'auto& [k, v] = *m.begin();\nv = 42;  // edits the map'),
        t: D('std::tuple', 'Any number of values of any types. Access by std::get<0>(t) or by type.', 'auto t = std::make_tuple(1, 2.5);\nstd::get<1>(t);  // 2.5'),
      },
      steps: [
        { line: 0, note: 'A pair groups two values of different types.', vars: [['p', '{ "ann", 30 }', 'current']] },
        { line: 1, note: 'Structured bindings unpack it into named variables.', vars: [['p', '{ "ann", 30 }'], ['name', '"ann"', 'write'], ['age', '30', 'write']] },
        { line: [2, 3], note: 'Tuples hold any number of elements and unpack the same way.', vars: [['t', '{ 1, 2.5, x }', 'current'], ['i', '1', 'write'], ['d', '2.5', 'write'], ['c', "'x'", 'write']] },
        { line: 4, note: 'The most common use is looping over a map. For anything long-lived or public, prefer a named struct.', vars: [['k', '"ann"', 'current'], ['v', '30', 'current']], rows: [['readability', 'struct > tuple', 'warn']] },
      ],
    },
  ],
});

// ---------------- views ----------------
const SV = D('std::string_view', 'A pointer plus a length into characters someone else owns. 16 bytes, never allocates, never frees.', 'void log(std::string_view msg);\nlog("literal");       // no std::string built\nlog(s);               // no copy\nlog(s.substr(0, 3));  // copy! use sv.substr');
traceDemo('stl-views', 'string_view & span', 'Non-owning views: cheap parameters that avoid copies, and the dangling views they make easy to write.', {
  view: [
    'string_view',
    {
      code: ['std::string s = "GET /index.html HTTP/1.1";', 'std::string_view sv = s;', 'auto path = sv.substr(4, 11);', 'std::cout << path;'],
      details: { s: STR, sv: SV, path: SV, buf: D('The owner’s buffer', 's owns these characters. Both views just point into it.') },
      steps: [
        { line: 0, note: 's owns a heap buffer with the request line.', vars: [['s', 'owner', 'current', 'buf']], heap: [['buf', 'GET /index.html HTTP/1.1', 'write']], out: '' },
        { line: 1, note: 'sv is just a pointer and a length into s’s buffer. No copy.', vars: [['s', 'owner', 'default', 'buf'], ['sv', 'ptr + len 24', 'current', 'buf']], heap: [['buf', 'GET /index.html HTTP/1.1']], out: '', rows: [['allocations', 0, 'ok']] },
        { line: 2, note: 'substr on a view returns another view: parsing without allocating.', vars: [['s', 'owner', 'default', 'buf'], ['sv', 'ptr + len 24', 'default', 'buf'], ['path', 'ptr+4 · len 11', 'write', 'buf']], heap: [['buf', 'GET [/index.html] HTTP/1.1']], out: '', rows: [['allocations', 0, 'ok']] },
        { line: 3, note: 'Take string_view parameters for read-only text. Views are great for parsers.', vars: [['path', 'ptr+4 · len 11', 'ok', 'buf']], heap: [['buf', 'GET [/index.html] HTTP/1.1']], out: '/index.html' },
      ],
    },
  ],
  dangling: [
    'Dangling view',
    {
      code: ['std::string_view name() {', '  std::string s = "temporary";', '  return s;          // view into a dying string', '}', 'std::cout << name();   // UB'],
      details: { s: STR, sv: SV, buf: D('Freed buffer', 'Destroyed at the closing brace. The returned view still points here.') },
      steps: [
        { line: 1, note: 'Inside name(), s owns its characters.', vars: [['s', 'owner', 'current', 'buf']], heap: [['buf', '"temporary"', 'write']], out: '' },
        { line: 2, note: 'Returning s as a string_view copies only the pointer and length.', vars: [['s', 'owner', 'default', 'buf'], ['sv', 'ptr + len 9', 'current', 'buf']], heap: [['buf', '"temporary"']], out: '' },
        { line: 3, note: 's is destroyed at the brace and frees its buffer. The view now dangles.', vars: [['sv', 'ptr + len 9', 'fail', 'buf']], heap: [['buf', '(freed)', 'fail']], out: '', rows: [['owner', 'dead', 'fail']] },
        { line: 4, note: 'Printing reads freed memory. Never return a view of a local, or store one longer than its owner.', vars: [['sv', 'dangling', 'fail', 'buf']], heap: [['buf', '(freed)', 'fail']], out: '�emp�r…', rows: [['bug', 'use-after-free', 'fail']] },
      ],
    },
  ],
  span: [
    'std::span',
    {
      code: ['int sum(std::span<const int> xs) {', '  int t = 0; for (int x : xs) t += x; return t;', '}', 'std::vector<int> v{1, 2, 3}; int a[] = {4, 5};', 'sum(v) + sum(a) + sum({v.data() + 1, 2});'],
      details: { xs: D('std::span', 'A pointer plus a count over contiguous elements. One function accepts vectors, arrays and C arrays without templates or copies.', 'void fill(std::span<int> out);\nfill(vec);\nfill(arr);\nfill({p, n});'), vb: D('vector’s buffer', 'Owned by v; the span only borrows it.') },
      steps: [
        { line: 3, note: 'Two different containers of ints.', vars: [['v', 'vector', 'default', 'vb'], ['a', '{4, 5} (stack)']], heap: [['vb', '1 2 3']], out: '' },
        { line: [0, 4], note: 'sum(v) sees a span over v’s buffer: pointer and length, no copy.', vars: [['v', 'vector', 'default', 'vb'], ['xs', 'ptr + 3', 'current', 'vb']], heap: [['vb', '1 2 3', 'read']], out: '', rows: [['copies', 0, 'ok']] },
        { line: 4, note: 'The same function takes a C array or any slice of contiguous memory.', vars: [['xs', 'ptr + 2 (a)', 'current']], heap: [['vb', '1 2 3']], out: '' },
        { line: 4, note: 'span replaces the old (int* p, size_t n) pair. Like string_view, it must not outlive the data.', vars: [['xs', 'ptr+1 · 2 (v)', 'current', 'vb']], heap: [['vb', '1 [2 3]', 'read']], out: '20', rows: [['result', 20, 'ok']] },
      ],
    },
  ],
});
