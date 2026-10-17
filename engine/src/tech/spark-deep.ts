// Spark internals (group tech-spark): lineage, stages, shuffle; Catalyst, codegen, joins, AQE; memory, caching, partitioning.
// Each scene is a picture rebuilt from the knobs under the stage; optimizer walk-throughs (Catalyst, codegen, AQE) stay as line traces.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, Film, line, panel, text } from '../machine/lib/draw';
import { cap, choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const liveDemo = liveGroup('tech-spark');
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const catalystTrace: Trace = {
  codeTitle: 'query.scala',
  code: ['sales.join(stores, "store_id")', '  .filter($"country" === "DE")', '  .select($"store_id", $"amount")', '  .groupBy("store_id").sum("amount")', '  .explain(true)'],
  stackTitle: 'phase',
  heapTitle: 'plan tree (root on top)',
  details: {
    analyzed: D('Analyzer', 'Resolves names, types and functions against the catalog. A typo in a column name fails here with AnalysisException.'),
    f: D('Predicate pushdown', 'The filter only touches stores columns, so it moves below the join and into the Parquet scan. Row groups whose min/max exclude DE are skipped.', 'PushedFilters: [EqualTo(country,DE)]'),
    s: D('Column pruning', 'Only columns the query uses are read. Columnar formats skip the rest on disk.', 'ReadSchema: struct<store_id:int,amount:double>'),
    physical: D('Physical planning', 'Strategies map logical nodes to operators, using size estimates to choose join types. Exchange nodes mark shuffles.'),
  },
  steps: [
    { note: 'The parser builds an unresolved logical plan. Names are just strings so far.', line: [0, 1, 2, 3], vars: [['parsed', 'unresolved', 'current']], heap: [['a', 'Aggregate [store_id]', 'default'], ['p', 'Project', 'default'], ['f', "Filter country = 'DE'", 'default'], ['j', 'Join store_id', 'default'], ['s', 'Relation sales, stores', 'muted', '?']], out: '' },
    { note: 'The analyzer resolves every column and type against the catalog.', line: 4, vars: [['parsed', 'done'], ['analyzed', 'resolved', 'current']], heap: [['a', 'Aggregate [store_id#1]', 'read'], ['p', 'Project', 'read'], ['f', "Filter country#9 = 'DE'", 'read'], ['j', 'Join store_id#1', 'read'], ['s', 'Relation sales, stores', 'read', 'parquet']], out: '== Analyzed Logical Plan ==' },
    { note: 'Rule-based optimization pushes the filter below the join, onto the stores side only.', line: 1, vars: [['analyzed', 'done'], ['optimized', 'pushdown', 'current']], heap: [['a', 'Aggregate [store_id]', 'read'], ['p', 'Project', 'read'], ['j', 'Join store_id', 'read'], ['f', "stores: Filter 'DE'", 'accent', 'moved down'], ['s', 'Relation sales, stores', 'read']], out: '== Optimized Logical Plan ==' },
    { note: 'Column pruning trims each scan to the columns actually used.', line: 2, vars: [['optimized', 'pruning', 'current']], heap: [['a', 'Aggregate [store_id]', 'read'], ['j', 'Join store_id', 'read'], ['f', "stores: Filter 'DE'", 'accent'], ['s', 'sales [store_id, amount]', 'accent', 'stores [store_id, country]']], out: '== Optimized Logical Plan ==' },
    { note: 'The planner picks operators: the filtered stores side is small, so it becomes a broadcast hash join.', line: 3, vars: [['optimized', 'done'], ['physical', 'selected', 'ok']], heap: [['a', 'HashAggregate (final)', 'ok'], ['x', 'Exchange hashpartitioning', 'protocol'], ['a0', 'HashAggregate (partial)', 'ok'], ['j', 'BroadcastHashJoin', 'ok'], ['s', 'FileScan parquet x2', 'ok', 'PushedFilters, ReadSchema']], out: '== Physical Plan ==' },
  ],
};

const codegenTrace: Trace = {
  codeTitle: 'query.scala',
  code: ['df.filter($"x" > 10)', '  .select(($"x" * 2).as("y"))', '  .agg(sum("y"))'],
  stackTitle: 'execution',
  heapTitle: 'generated code',
  details: {
    volcano: D('Volcano model', 'Each operator pulls rows from its child through a virtual next() call. Generic, but costs a call and a boxed row per operator per row.'),
    UnsafeRow: D('Tungsten row format', 'Rows are compact binary buffers managed by Spark, not JVM objects. Less GC and cache-friendly access.'),
    g: D('Whole-stage codegen', 'Fuses a pipeline of operators into one Java method compiled at runtime by Janino. Operators marked *(1) in explain share one function.', 'while (input.hasNext()) {\n  long x = row.getLong(0);\n  if (x > 10) agg_sum += x * 2;\n}'),
  },
  steps: [
    { note: 'Classic Volcano iteration: Aggregate calls Project.next(), which calls Filter.next(), per row.', line: [0, 1, 2], vars: [['volcano', '3 calls / row', 'warn'], ['rows', 'boxed objects', 'warn']], heap: [], out: '' },
    { note: 'Tungsten stores rows as UnsafeRow: fixed-width binary fields in managed memory.', line: 0, vars: [['volcano', '3 calls / row'], ['UnsafeRow', '[null bits|x|y]', 'accent']], heap: [], out: '' },
    { note: 'Whole-stage codegen fuses filter, project and partial aggregate into one generated loop.', line: [0, 1, 2], vars: [['UnsafeRow', '[null bits|x|y]'], ['codegen', 'stage 1 fused', 'ok']], heap: [['g', 'for row: if x > 10', 'write', 'sum += x * 2']], out: '' },
    { note: 'Values stay in local variables and CPU registers. No virtual call happens between operators.', line: 2, vars: [['codegen', 'stage 1 fused', 'ok'], ['calls', '0 / row', 'ok']], heap: [['g', 'for row: if x > 10', 'current', 'sum += x * 2']], out: '*(1) HashAggregate\n*(1) Project\n*(1) Filter (x > 10)' },
    { note: 'Fusion stops at pipeline breakers like Exchange. The final aggregate is a second codegen stage.', line: 2, vars: [['stage 1', 'partial sum', 'ok'], ['Exchange', 'shuffle', 'protocol'], ['stage 2', 'final sum', 'ok']], heap: [['g', 'codegen stage 1', 'read'], ['g2', 'codegen stage 2', 'write', 'merge partial sums']], out: '*(2) HashAggregate (final)\nExchange SinglePartition\n*(1) HashAggregate (partial)' },
  ],
};

const aqeTrace: Trace = {
  codeTitle: 'aqe.conf',
  code: ['spark.sql.adaptive.enabled = true    // default 3.2+', 'spark.sql.shuffle.partitions = 200', 'orders.join(users.filter(active), "uid")', '  .groupBy("country").count()'],
  stackTitle: 'runtime stats',
  heapTitle: 'query stages',
  details: {
    coalesce: D('Coalesce partitions', 'Adjacent small shuffle partitions are read together by one task, targeting advisoryPartitionSizeInBytes (64 MB).'),
    join: D('Join switch', 'The static plan chose sort-merge from estimates. Measured runtime size is small, so AQE swaps in a broadcast join and reads shuffle output locally.'),
    skew: D('Skew join', 'A partition larger than 5× the median and 256 MB is split into sub-partitions. The other side’s matching partition is replicated to each.', 'spark.sql.adaptive.skewJoin.enabled=true'),
  },
  steps: [
    { note: 'AQE splits the plan into query stages at each Exchange. After each stage it re-plans using real shuffle statistics.', line: 0, vars: [['plan', 'SortMergeJoin', 'current']], heap: [['q1', 'stage: orders scan', 'write'], ['q2', 'stage: users scan', 'write']], out: '' },
    { note: 'users.filter(active) turns out to be 8 MB at runtime. AQE replaces sort-merge with a broadcast join.', line: 2, vars: [['users', '8 MB actual', 'ok'], ['join', 'SMJ → BHJ', 'accent']], heap: [['q1', 'orders shuffle', 'read', 'local reader'], ['q2', 'users → broadcast', 'ok']], out: '' },
    { note: 'The groupBy shuffle has 200 partitions, most tiny. AQE coalesces them into 12 of about 64 MB.', line: [1, 3], vars: [['partitions', '200', 'warn'], ['coalesce', '200 → 12', 'ok']], heap: [['q3', 'aggregate stage', 'ok', '12 tasks']], out: '' },
    { note: 'In a sort-merge join, one uid partition is 2 GB against a 60 MB median. AQE splits it into sub-tasks.', line: 2, vars: [['p7', '2 GB', 'fail'], ['median', '60 MB'], ['skew', 'p7 → 8 splits', 'ok']], heap: [['k', 'p7 split × 8', 'ok', 'other side replicated']], out: '' },
    { note: 'The final plan shows isFinalPlan=true with the rewrites applied.', line: 3, vars: [['plan', 'final', 'ok']], heap: [['q1', 'BroadcastHashJoin', 'ok'], ['q3', 'AQEShuffleRead coalesced', 'ok']], out: 'AdaptiveSparkPlan isFinalPlan=true' },
  ],
};

/** one RDD: a labelled column of partitions */
function rdd(id: string, x: number, label: string, n: number, tone: (i: number) => Tone, o: { y0?: number; ph?: number; sub?: (i: number) => string | undefined; dashed?: (i: number) => boolean } = {}): Shape[] {
  const y0 = o.y0 ?? 200;
  const ph = o.ph ?? 110;
  const out: Shape[] = [text(`${id}t`, x + 85, y0 - 18, label, { size: 22, mono: true, bold: true, tone: 'muted' })];
  for (let i = 0; i < n; i++) out.push(box(`${id}${i}`, x, y0 + i * (ph + 14), 170, ph, `p${i}`, { sub: o.sub?.(i), mono: true, tone: tone(i), dashed: o.dashed?.(i) }));
  return out;
}

// ---------------- core: lineage, narrow vs wide, shuffle ----------------
const CHAIN = ['textFile', 'filter', 'map', 'reduceByKey'];

function lineage(p: P): Frame[] {
  const lose = pick(p.lose, ['none', 'p3'], 'p3') === 'p3';
  const f = new Film();
  const xs = [30, 270, 510, 750];
  const scene = (stmt: string, built: number, computed: number, o: { lost?: boolean; redo?: boolean } = {}): Shape[] => {
    const out: Shape[] = [...cap(stmt)];
    CHAIN.slice(0, built).forEach((c, k) =>
      out.push(
        ...rdd(`r${k}`, xs[k], c, 4, (i) => (o.redo && i === 3 && k < 3 ? 'write' : o.lost && k === 1 && i === 3 ? 'fail' : k < computed ? 'ok' : 'muted'), { dashed: (i) => k >= computed || (!!o.lost && k === 1 && i === 3), sub: (i) => (o.lost && k === 1 && i === 3 ? 'lost' : k < computed ? 'computed' : 'plan only') }),
      ),
    );
    for (let k = 1; k < built; k++) out.push(arrow(`l${k}`, xs[k], 150, xs[k - 1] + 170, 150, 'muted', { width: 3 }));
    return out;
  };
  f.add('textFile returns at once: no file has been opened. An RDD is a recipe with a pointer to its parent.', scene('val lines = sc.textFile("logs/*")', 1, 0), panel('Lineage', [['work done', 0, 'ok']]));
  f.add('filter, map and reduceByKey only record a function and a parent. The whole program so far is a plan, not a result.', scene('lines.filter(…).map(…).reduceByKey(_ + _)', 4, 0), panel('Lineage', [['RDDs', 4], ['work done', 0, 'ok']]));
  f.add('count() is an action. The driver submits a job that walks the lineage back to the files and computes every partition.', scene('counts.count()   // action', 4, 4), panel('Lineage', [['jobs', 1], ['tasks', 8]]));
  if (lose) {
    f.add('An executor dies, taking partition 3 of the filtered data with it. Nothing was replicated.', scene('// executor 2 lost', 4, 4, { lost: true }), panel('Lineage', [['lost', 'filter p3', 'fail']]));
    f.add('Spark does not restart the job: it follows the lineage and recomputes just p3, from the file split through filter and map.', scene('recompute p3 from lineage', 4, 4, { redo: true }), panel('Lineage', [['recomputed', '1 partition', 'ok'], ['replicas needed', 0, 'ok']]));
  } else f.add('Every partition survives this time. If one were lost, the lineage says exactly how to rebuild only that one.', scene('// no failure', 4, 4), panel('Lineage', [['fault tolerance', 'by recomputation', 'ok']]));
  f.add('take(5) is a new job. Its first stage shows as skipped because the shuffle files from count() still exist.', scene('counts.take(5)', 4, 4), panel('Lineage', [['jobs', 2], ['skipped stages', 1, 'ok']]));
  return f.frames;
}

const THIRD = ['reduceByKey', 'mapValues'];

function deps(p: P): Frame[] {
  const wide = pick(p.op, THIRD, 'reduceByKey') === 'reduceByKey';
  const f = new Film();
  const xs = [30, 290, 550, 810];
  const labels = ['textFile', 'map', 'filter', wide ? 'reduceByKey' : 'mapValues'];
  const narrow = (k: number, tone: Tone): Shape[] => [...Array(4).keys()].map((i) => line(`n${k}-${i}`, xs[k - 1] + 170, 255 + i * 124, xs[k], 255 + i * 124, tone, { width: 3 }));
  const all = (tone: Tone): Shape[] => [...Array(4).keys()].flatMap((i) => [...Array(4).keys()].map((j) => line(`w${i}-${j}`, xs[2] + 170, 255 + i * 124, xs[3], 255 + j * 124, tone, { width: 2 })));
  const stageBox = (id: string, x: number, w: number, label: string, tone: Tone): Shape[] => [box(id, x, 120, w, 600, undefined, { tone, filled: false, dashed: true }), text(`${id}t`, x + 12, 750, label, { align: 'left', size: 24, bold: true, tone })];
  const scene = (stmt: string, upto: number, o: { stages?: boolean } = {}): Shape[] => {
    const out: Shape[] = [...cap(stmt)];
    for (let k = 0; k <= upto; k++) out.push(...rdd(`r${k}`, xs[k], labels[k], 4, () => (k === upto ? 'current' : 'accent')));
    for (let k = 1; k <= Math.min(upto, 2); k++) out.push(...narrow(k, 'ok'));
    if (upto >= 3) out.push(...(wide ? all('warn') : narrow(3, 'ok')));
    if (o.stages) out.push(...(wide ? [...stageBox('s0', 20, 740, 'stage 0', 'accent'), ...stageBox('s1', 800, 190, 'stage 1', 'protocol')] : stageBox('s0', 20, 970, 'stage 0 (one pipeline)', 'ok')));
    return out;
  };
  f.add('map is narrow: output partition i depends only on input partition i. No data moves between machines.', scene('sc.textFile("in").map(parse)', 1), panel('Dependencies', [['map', 'narrow', 'ok']]));
  f.add('filter is narrow too, so one task can run read → map → filter row by row, in a single pass.', scene('  .filter(valid)', 2), panel('Dependencies', [['filter', 'narrow', 'ok']]));
  f.add(wide ? 'reduceByKey needs every row for a key in one place, so each output partition reads from every input: a shuffle.' : 'mapValues keeps each partition where it is: still narrow, no data moves.', scene(wide ? '  .reduceByKey(_ + _)' : '  .mapValues(fmt)', 3), panel('Dependencies', [[labels[3], wide ? 'wide (shuffle)' : 'narrow', wide ? 'warn' : 'ok']]));
  f.add(wide ? 'The DAG scheduler cuts a stage at the shuffle: stage 0 writes shuffle files, stage 1 reads them over the network.' : 'With no wide dependency there is nothing to cut: the whole chain is one stage of four tasks.', scene('// DAGScheduler', 3, { stages: true }), panel('Dependencies', [['stages', wide ? 2 : 1, wide ? 'warn' : 'ok'], ['tasks', wide ? 8 : 4]]));
  return f.frames;
}

function shuffle(p: P): Frame[] {
  const R = num(p.r, 3, 2, 4);
  const M = 3;
  const f = new Film();
  const RT: Tone[] = ['accent', 'protocol', 'ok', 'warn'];
  const mapOut = (m: number, y: number, show: boolean): Shape[] => {
    const out: Shape[] = [box(`m${m}`, 30, y, 200, 120, `map task ${m}`, { mono: true, tone: 'default' })];
    if (show) for (let r = 0; r < R; r++) out.push(box(`f${m}-${r}`, 250 + r * (300 / R), y + 20, 300 / R - 6, 80, `→r${r}`, { mono: true, tone: RT[r] }));
    return out;
  };
  const reduce = (r: number, fetched: boolean): Shape[] => [box(`r${r}`, 760, 140 + r * (720 / R), 210, 720 / R - 30, `reduce ${r}`, { sub: fetched ? `${M} blocks` : undefined, mono: true, tone: fetched ? RT[r] : 'muted' })];
  const scene = (stmt: string, o: { files?: boolean; fetch?: number; idx?: boolean } = {}): Shape[] => {
    const out: Shape[] = [...cap(stmt)];
    for (let m = 0; m < M; m++) out.push(...mapOut(m, 160 + m * 240, !!o.files));
    if (o.idx) out.push(text('ix', 250, 920, 'one .data file per map task, segments in reducer order, plus an .index of byte offsets', { align: 'left', size: 22, tone: 'muted' }));
    for (let r = 0; r < R; r++) out.push(...reduce(r, o.fetch !== undefined && r <= o.fetch));
    if (o.fetch !== undefined) for (let r = 0; r <= o.fetch; r++) for (let m = 0; m < M; m++) out.push(arrow(`x${m}-${r}`, 250 + r * (300 / R) + (300 / R - 6) / 2, 160 + m * 240 + 100, 760, 140 + r * (720 / R) + (720 / R - 30) / 2, RT[r], { width: 2 }));
    return out;
  };
  f.add(`Each map task hashes every record’s key to one of ${R} reduce partitions: hash(key) mod ${R}.`, scene(`partitioner.getPartition(key)   // 0..${R - 1}`), panel('Shuffle', [['map tasks', M], ['reduce partitions', R]]));
  f.add('Records are buffered in memory sorted by partition id; a full buffer spills a sorted run. At the end the runs merge into one file per map task.', scene('sort by partition, spill, merge', { files: true, idx: true }), panel('Shuffle', [['files', `${M} data + ${M} index`]]));
  for (let r = 0; r < R; r++) if (r === 0 || r === R - 1) f.add(r === 0 ? `Reduce task 0 asks the driver where the map outputs are, then fetches its segment from every one of the ${M} files.` : `Every reducer does the same: ${M} × ${R} = ${M * R} fetches across the network.`, scene(`reduce ${r}: fetch segment ${r} from every map output`, { files: true, fetch: r }), panel('Shuffle', [['fetches', M * (r + 1)]]));
  f.add(`More partitions mean smaller, more numerous blocks (${M * R} here). If a map output is lost, FetchFailed reruns just that map task.`, scene(`spark.sql.shuffle.partitions = ${R}`, { files: true, fetch: R - 1 }), panel('Shuffle', [['blocks', M * R], ['cost', 'disk + network', 'warn']]));
  return f.frames;
}

liveDemo(
  'spark-core',
  'RDDs, stages & shuffle',
  'Lineage as a plan that only runs on an action and rebuilds a lost partition, narrow vs wide dependencies cutting stages, and shuffle files fetched by every reducer.',
  {
    lineage: ['Lineage & laziness', lineage],
    deps: ['Narrow vs wide', deps],
    shuffle: ['Shuffle', shuffle],
  },
  [choice('lose', 'executor failure', ['p3', 'none'], 'p3', { for: ['lineage'], labels: ['lose p3', 'none'] }), choice('op', 'third step', THIRD, 'reduceByKey', { for: ['deps'] }), number('r', 'reducers', 2, 4, 3, { for: ['shuffle'] })],
  {
    r00: D('Partition', 'A slice of the dataset processed by one task. RDDs are immutable and remember how they were derived.'),
    m0: D('Map task', 'Writes its output sorted by reduce partition into one data file plus an index, on local disk.'),
    r0: D('Reduce task', 'Fetches its segment from every map output, then merges and aggregates.'),
  },
);

// ---------------- SQL: join strategies ----------------
const SIZES = ['5', '500', '50000'];

function joins(p: P): Frame[] {
  const mb = Number(pick(p.mb, SIZES, '5'));
  const bhj = mb <= 10;
  const f = new Film();
  const big = (x: number, label: string, tone: Tone, sub?: (i: number) => string | undefined) => rdd(label, x, label, 4, () => tone, { y0: 200, ph: 100, sub });
  const scene = (stmt: string, o: { bcast?: boolean; shuf?: boolean; sorted?: boolean } = {}): Shape[] => {
    const out: Shape[] = [...cap(stmt), ...big(30, 'orders', 'accent', () => '25 GB / 4')];
    if (bhj) {
      out.push(box('small', 400, 120, 220, 70, `users · ${mb} MB`, { mono: true, tone: 'ok' }));
      if (o.bcast) for (let i = 0; i < 4; i++) out.push(box(`h${i}`, 230, 210 + i * 114, 150, 80, 'hash table', { mono: true, tone: 'ok' }), arrow(`b${i}`, 510, 192, 380, 250 + i * 114, 'ok', { width: 2 }));
    } else {
      out.push(...big(780, 'users', 'protocol', () => (mb >= 50000 ? '50 GB / 4' : '500 MB / 4')));
      if (o.shuf) {
        out.push(...rdd('ex', 405, 'by uid', 4, () => 'warn', { y0: 200, ph: 100, sub: () => (o.sorted ? 'sorted · merge' : 'both sides') }));
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) out.push(line(`sa${i}-${j}`, 200, 250 + i * 114, 405, 250 + j * 114, 'warn', { width: 1 }), line(`sb${i}-${j}`, 780, 250 + i * 114, 575, 250 + j * 114, 'warn', { width: 1 }));
      }
    }
    return out;
  };
  f.add(`orders is 25 GB; users is ${mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`}. The planner compares the smaller side with autoBroadcastJoinThreshold (10 MB).`, scene('orders.join(users, "uid")'), panel('Join', [['users', mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`], ['threshold', '10 MB']]));
  if (bhj) {
    f.add('users is under the threshold, so it is broadcast: every executor gets a full copy and builds a hash table.', scene('BroadcastHashJoin', { bcast: true }), panel('Join', [['strategy', 'broadcast hash', 'ok']]));
    f.add('Each orders task probes its local hash table. The 25 GB side never moves: no shuffle at all.', scene('BroadcastHashJoin', { bcast: true }), panel('Join', [['shuffled', '0 B', 'ok'], ['stages', 1, 'ok']]));
    f.add('Forcing broadcast(…) on a big table copies it to the driver and every executor: OOM or a broadcast timeout.', scene('orders.join(broadcast(users), "uid")', { bcast: true }), panel('Join', [['risk', 'oversized broadcast', 'warn']]));
  } else {
    f.add('Too big to broadcast. Both sides are shuffled by uid so matching keys land in the same partition.', scene('Exchange hashpartitioning(uid)', { shuf: true }), panel('Join', [['strategy', 'sort-merge', 'warn'], ['shuffled', mb >= 50000 ? '75 GB' : '25.5 GB', 'warn']]));
    f.add('Each partition sorts both sides by uid and merges them like a zipper. Scales to any size, at the cost of two shuffles and sorts.', scene('SortMergeJoin', { shuf: true, sorted: true }), panel('Join', [['stages', 3], ['memory', 'spills if needed', 'ok']]));
    f.add(mb < 1000 ? 'If users shrinks after a filter at runtime, AQE can switch this to a broadcast join mid-query.' : 'A hot uid makes one partition huge; AQE’s skew join splits it into sub-tasks.', scene(mb < 1000 ? 'spark.sql.adaptive.enabled = true' : 'spark.sql.adaptive.skewJoin.enabled = true', { shuf: true, sorted: true }), panel('Join', [['AQE', mb < 1000 ? 'may broadcast' : 'skew split', 'ok']]));
  }
  return f.frames;
}

liveDemo(
  'spark-sql',
  'Spark SQL engine',
  'Catalyst turning a query into a physical plan, whole-stage codegen, the join strategy picked by table size (broadcast vs both sides shuffled), and adaptive execution.',
  {
    catalyst: ['Catalyst optimizer', () => traceFrames(catalystTrace)],
    codegen: ['Whole-stage codegen', () => traceFrames(codegenTrace)],
    joins: ['Join strategies', joins],
    aqe: ['Adaptive execution', () => traceFrames(aqeTrace)],
  },
  [choice('mb', 'users table', SIZES, '5', { for: ['joins'], labels: ['5 MB', '500 MB', '50 GB'] })],
  { small: D('Broadcast side', 'Collected to the driver and sent to every executor once. Must fit in memory everywhere.', 'spark.sql.autoBroadcastJoinThreshold=10m'), ex0: D('Exchange', 'A shuffle that hash-partitions both sides by the join key so matching rows meet.') },
);

// ---------------- memory, caching, partitioning ----------------
const NEEDS = ['1', '2.3', '4'];

function memory(p: P): Frame[] {
  const need = Number(pick(p.need, NEEDS, '2.3'));
  const POOL = 4.8;
  const FLOOR = 2.4;
  const cached = 3.0;
  const f = new Film();
  const X = 40;
  const W = 920;
  const gb = (v: number) => (W * v) / POOL;
  const bar = (stmt: string, exec: number, cache: number, spill: number): Shape[] => {
    const out: Shape[] = [...cap(stmt), text('pt', X, 150, `unified pool · ${POOL} GB (60 % of heap after 300 MB reserved)`, { align: 'left', size: 22, bold: true, tone: 'muted' })];
    out.push(box('pool', X, 170, W, 140, undefined, { tone: 'muted', filled: false }));
    if (exec) out.push(box('exec', X, 170, gb(exec), 140, `execution ${exec.toFixed(1)} GB`, { mono: true, tone: 'warn' }));
    if (cache) out.push(box('stor', X + W - gb(cache), 170, gb(cache), 140, `cache ${cache.toFixed(1)} GB`, { mono: true, tone: 'accent' }));
    out.push(line('floor', X + W - gb(FLOOR), 150, X + W - gb(FLOOR), 330, 'ok', { width: 4, dashed: true }), text('floort', X + W - gb(FLOOR), 356, 'storage floor (50 %)', { size: 20, tone: 'ok' }));
    if (spill) out.push(box('spill', X, 420, Math.min(W, gb(spill)), 100, `spilled to disk ${spill.toFixed(1)} GB`, { mono: true, tone: 'fail', dashed: true }));
    return out;
  };
  f.add('Execution (joins, sorts) and storage (cached blocks) share one pool. 3 GB of cached data is in it now.', bar('spark.memory.fraction = 0.6', 0, cached, 0), panel('Memory', [['cache', '3.0 GB'], ['free', '1.8 GB']]));
  const free = POOL - cached;
  if (need <= free) {
    f.add(`The join needs ${need} GB and there is ${free.toFixed(1)} GB free, so execution just takes it. The cache is untouched.`, bar(`join needs ${need} GB`, need, cached, 0), panel('Memory', [['evicted', 0, 'ok'], ['spilled', 0, 'ok']]));
  } else {
    const evict = Math.min(cached - Math.min(cached, FLOOR), need - free);
    const cacheAfter = cached - evict;
    const exec = Math.min(need, POOL - cacheAfter);
    const spill = need - exec;
    f.add(`The join needs ${need} GB. Execution takes the ${free.toFixed(1)} GB free space first…`, bar(`join needs ${need} GB`, free, cached, 0), panel('Memory', [['short by', `${(need - free).toFixed(1)} GB`, 'warn']]));
    if (evict > 0) f.add(`…then evicts cached blocks, but only down to the storage floor. ${evict.toFixed(1)} GB of cache is dropped.`, bar('evict cached blocks', free + evict, cacheAfter, 0), panel('Memory', [['evicted', `${evict.toFixed(1)} GB`, 'warn']]));
    else f.add('…but the cache is already at the storage floor: execution may not evict below it.', bar('cache protected by the floor', free, cached, 0), panel('Memory', [['evicted', 0]]));
    f.add(spill > 0 ? `Still ${spill.toFixed(1)} GB short, so the sort spills runs to disk and keeps going. Slower, but no crash.` : 'That was enough: the join fits without spilling.', bar('// sort spills', exec, cacheAfter, spill), panel('Memory', [['spilled', `${spill.toFixed(1)} GB`, spill ? 'fail' : 'ok']]));
  }
  f.add('Off-heap memory (Python workers, netty buffers) is not in this pool. It counts against memoryOverhead; exceed that and YARN or Kubernetes kills the container.', bar('spark.executor.memoryOverhead = 10 %', 0, cached, 0), panel('Memory', [['container kill', 'overhead exceeded', 'warn']]));
  return f.frames;
}

const LEVELS = ['MEMORY_AND_DISK', 'MEMORY_ONLY', 'none'];

function cache(p: P): Frame[] {
  const lvl = pick(p.lvl, LEVELS, 'MEMORY_AND_DISK');
  const f = new Film();
  const where = (i: number): 'mem' | 'disk' | 'none' => (lvl === 'none' ? 'none' : i === 2 ? (lvl === 'MEMORY_AND_DISK' ? 'disk' : 'none') : 'mem');
  const T: Record<string, Tone> = { mem: 'ok', disk: 'warn', none: 'muted' };
  const scene = (stmt: string, o: { filled?: boolean; reuse?: boolean } = {}): Shape[] => [
    ...cap(stmt),
    ...rdd('pq', 30, 'parquet', 4, (i) => (o.reuse && where(i) === 'none' ? 'current' : 'default'), { sub: () => 'scan + filter' }),
    ...rdd('c', 400, `cached (${lvl === 'none' ? 'not persisted' : lvl})`, 4, (i) => (o.filled ? T[where(i)] : 'muted'), { dashed: (i) => !o.filled || where(i) === 'none', sub: (i) => (o.filled ? { mem: 'in memory', disk: 'on local disk', none: 'not stored' }[where(i)] : undefined) }),
    ...(o.reuse ? rdd('q', 770, 'next query', 4, (i) => (where(i) === 'none' ? 'warn' : 'ok'), { sub: (i) => (where(i) === 'none' ? 'recomputed' : 'from cache') }) : []),
  ];
  const recompute = [0, 1, 2, 3].filter((i) => where(i) === 'none').length;
  f.add(lvl === 'none' ? 'Without persist, a DataFrame is just a plan: every action re-reads Parquet and re-runs the filter.' : `persist(${lvl}) returns at once. It only tags the plan with a storage level.`, scene(lvl === 'none' ? 'val df = spark.read.parquet("events").filter(…)' : `df.persist(StorageLevel.${lvl})`), panel('Cache', [['stored', 0]]));
  f.add(lvl === 'none' ? 'count() computes every partition and throws them away afterwards.' : lvl === 'MEMORY_AND_DISK' ? 'count() computes every partition and stores it. p2 does not fit in storage memory, so it goes to local disk.' : 'count() computes every partition and stores it. p2 does not fit in memory and MEMORY_ONLY simply drops it.', scene('df.count()', { filled: true }), panel('Cache', [['in memory', [0, 1, 2, 3].filter((i) => where(i) === 'mem').length], ['on disk', [0, 1, 2, 3].filter((i) => where(i) === 'disk').length]]));
  f.add(recompute === 4 ? 'The next query recomputes everything from Parquet again.' : recompute ? `The next query reads 3 partitions from the cache and recomputes p2 from Parquet through the lineage.` : 'The next query reads every partition from cache (p2 from local disk). The scan and filter do not run again.', scene('df.groupBy("page").count()', { filled: true, reuse: true }), panel('Cache', [['recomputed', recompute, recompute ? 'warn' : 'ok']]));
  f.add('unpersist frees the blocks; otherwise they stay until evicted in LRU order. Cache what is reused, not everything.', scene('df.unpersist()', { filled: false }), panel('Cache', [['stored', 0]]));
  return f.frames;
}

const REPART = ['repartition', 'coalesce', 'byday'];

function partition(p: P): Frame[] {
  const op = pick(p.op, REPART, 'coalesce');
  const f = new Film();
  const before = [3, 1, 2, 2, 1, 3];
  const scene = (stmt: string, after?: { sizes: number[]; tone: Tone; sub?: (i: number) => string }, lines?: Shape[]): Shape[] => {
    const out: Shape[] = [...cap(stmt), text('bt', 30, 150, '6 partitions (bar = size)', { align: 'left', size: 22, bold: true, tone: 'muted' })];
    before.forEach((s, i) => out.push(box(`b${i}`, 30, 170 + i * 120, 60 + s * 70, 90, `p${i}`, { mono: true, tone: 'default' })));
    if (after) after.sizes.forEach((s, i) => out.push(box(`a${i}`, 640, 170 + i * 120, Math.min(340, 30 + s * 30), 90, `p${i}`, { sub: after.sub?.(i), mono: true, tone: after.tone })));
    return [...out, ...(lines ?? [])];
  };
  f.add('The scan made 6 partitions of uneven size. Too many tiny partitions waste task overhead; too few waste cores.', scene('df.rdd.getNumPartitions   // 6'), panel('Partitions', [['count', 6]]));
  if (op === 'repartition') {
    const ls = before.flatMap((_, i) => [0, 1, 2].map((j) => line(`x${i}-${j}`, 300, 215 + i * 120, 640, 215 + j * 120, 'warn', { width: 1 })));
    f.add('repartition(3) shuffles every row: each old partition sends rows to every new one.', scene('df.repartition(3)', { sizes: [4, 4, 4], tone: 'warn' }, ls), panel('Partitions', [['shuffle', 'full', 'warn']]));
    f.add('The result is 3 evenly sized partitions. Worth it to fix skew or raise parallelism, at the price of moving all the data.', scene('df.repartition(3)', { sizes: [4, 4, 4], tone: 'ok', sub: () => 'even' }), panel('Partitions', [['sizes', 'even', 'ok'], ['data moved', 'all', 'warn']]));
  } else if (op === 'coalesce') {
    const groups = [[0, 1], [2, 3], [4, 5]];
    const ls = groups.flatMap((g, j) => g.map((i) => line(`x${i}`, 300, 215 + i * 120, 640, 215 + j * 120, 'ok', { width: 3 })));
    f.add('coalesce(3) merges neighbouring partitions on the same executor. No shuffle: each new partition just reads a few old ones.', scene('df.coalesce(3)', { sizes: groups.map((g) => g.reduce((a, i) => a + before[i], 0)), tone: 'ok' }, ls), panel('Partitions', [['shuffle', 'none', 'ok']]));
    f.add('Cheap, but sizes follow whatever went in: here 4, 4 and 4 by luck. Coalescing to 1 before a write funnels everything through one task.', scene('df.coalesce(3)', { sizes: groups.map((g) => g.reduce((a, i) => a + before[i], 0)), tone: 'ok', sub: (i) => `from p${groups[i][0]}+p${groups[i][1]}` }, ls), panel('Partitions', [['use for', 'fewer output files', 'ok']]));
  } else {
    const ls = before.flatMap((_, i) => [0, 1, 2].map((j) => line(`x${i}-${j}`, 300, 215 + i * 120, 640, 215 + j * 120, 'warn', { width: 1 })));
    f.add('repartition(3, $"day") hash-partitions on day: all rows for one day land in the same partition.', scene('df.repartition(3, $"day")', { sizes: [9, 2, 1], tone: 'warn', sub: (i) => ['mon (Black Friday)', 'tue', 'wed'][i] }, ls), panel('Partitions', [['key', 'day']]));
    f.add('One hot day makes one huge partition, and one straggler task holds up the whole stage. Partitioning by a key is only as even as the key.', scene('// skew', { sizes: [9, 2, 1], tone: 'warn', sub: (i) => (i === 0 ? 'straggler' : 'done early') }, ls), panel('Partitions', [['skew', '9 : 2 : 1', 'fail']]));
  }
  return f.frames;
}

liveDemo(
  'spark-mem',
  'Memory, caching & partitioning',
  'Execution and storage sharing one pool (grow the join until it evicts and spills), what each storage level keeps when a partition does not fit, and repartition vs coalesce vs partitioning by a key.',
  {
    memory: ['Unified memory', memory],
    cache: ['Caching', cache],
    partition: ['Partitioning', partition],
  },
  [choice('need', 'join needs', NEEDS, '2.3', { for: ['memory'], labels: ['1 GB', '2.3 GB', '4 GB'] }), choice('lvl', 'storage level', LEVELS, 'MEMORY_AND_DISK', { for: ['cache'], labels: ['MEMORY_AND_DISK', 'MEMORY_ONLY', 'no persist'] }), choice('op', 'operation', REPART, 'coalesce', { for: ['partition'], labels: ['repartition(3)', 'coalesce(3)', 'repartition by day'] })],
  {
    pool: D('Unified memory', 'Execution and storage borrow from each other; execution can evict cache down to spark.memory.storageFraction, never below.', 'spark.memory.fraction=0.6\nspark.memory.storageFraction=0.5'),
    c0: D('Cached block', 'A computed partition kept by the block manager. MEMORY_AND_DISK writes what does not fit to local disk; MEMORY_ONLY recomputes it.'),
    b0: D('Partition', 'One task’s worth of data. Aim for roughly 100–200 MB per partition.'),
  },
);
