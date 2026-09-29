// Spark internals (group tech-spark): lineage, stages, shuffle; Catalyst, codegen, joins, AQE; memory, caching, partitioning.
import type { Detail } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'tech-spark';
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

function traceDemo(slug: string, title: string, summary: string, traces: Record<string, [string, Trace]>) {
  machineDemo({
    slug,
    title,
    group: G,
    summary,
    inputs: Object.entries(traces).map(([id, [label]]) => ({ id, label, data: { k: id } })),
    build: ({ k }: { k: string }) => traceFrames(traces[k][1]),
  });
}

// ---------------- RDDs, stages & shuffle ----------------
traceDemo('spark-core', 'RDDs, stages & shuffle', 'Transformations build a lineage graph lazily; actions submit jobs; the DAG scheduler cuts stages at wide dependencies; shuffles move data through local files.', {
  lineage: [
    'Lineage & laziness',
    {
      codeTitle: 'Job.scala',
      code: ['val lines  = sc.textFile("logs/*")', 'val errs   = lines.filter(_.contains("ERROR"))', 'val pairs  = errs.map(l => (host(l), 1))', 'val counts = pairs.reduceByKey(_ + _)', 'counts.count()     // action', 'counts.take(5)     // action'],
      stackTitle: 'driver',
      heapTitle: 'lineage (RDD graph)',
      details: {
        lines: D('Transformation', 'Returns a new RDD that only describes the computation. Nothing is read or computed until an action runs.'),
        r3: D('Lineage', 'Each RDD keeps its parents and the function that derives it. Lost partitions are rebuilt by replaying just that chain.', 'counts.toDebugString\n(8) ShuffledRDD\n +-(4) MapPartitionsRDD\n    |  MapPartitionsRDD\n    |  HadoopRDD'),
        out: D('Action', 'count, collect, take, save and foreach return a value or write output, so they force a job.'),
      },
      steps: [
        { note: 'textFile returns immediately. No file has been opened yet.', line: 0, vars: [['lines', 'RDD (not read)', 'write', 'r0']], heap: [['r0', 'HadoopRDD', 'write', 'textFile']], out: '' },
        { note: 'filter and map only record a function plus a pointer to the parent.', line: [1, 2], vars: [['lines', 'RDD', 'default', 'r0'], ['errs', 'RDD', 'write', 'r1'], ['pairs', 'RDD', 'write', 'r2']], heap: [['r0', 'HadoopRDD', 'read'], ['r1', 'MapPartitionsRDD', 'write', 'filter'], ['r2', 'MapPartitionsRDD', 'write', 'map']], out: '' },
        { note: 'reduceByKey adds a ShuffledRDD. The whole program so far is a plan, not a result.', line: 3, vars: [['errs', 'RDD', 'default', 'r1'], ['pairs', 'RDD', 'default', 'r2'], ['counts', 'RDD', 'write', 'r3']], heap: [['r0', 'HadoopRDD', 'read'], ['r1', 'MapPartitionsRDD', 'read', 'filter'], ['r2', 'MapPartitionsRDD', 'read', 'map'], ['r3', 'ShuffledRDD', 'accent', 'reduceByKey']], out: '' },
        { note: 'count() is an action. The driver submits job 0, which walks the lineage back to the files.', line: 4, vars: [['counts', 'RDD', 'current', 'r3'], ['job 0', 'running', 'protocol']], heap: [['r0', 'HadoopRDD', 'current', 'reading'], ['r1', 'MapPartitionsRDD', 'current'], ['r2', 'MapPartitionsRDD', 'current'], ['r3', 'ShuffledRDD', 'current']], out: 'Job 0 submitted' },
        { note: 'An executor dies holding partition 3 of errs. Spark recomputes only that partition from its parents.', line: 4, vars: [['job 0', 'retry p3', 'warn'], ['lost', 'errs p3', 'fail', 'r1']], heap: [['r0', 'HadoopRDD', 'read', 'reread split 3'], ['r1', 'MapPartitionsRDD', 'warn', 'recompute p3'], ['r2', 'MapPartitionsRDD', 'read'], ['r3', 'ShuffledRDD', 'read']], out: 'Job 0 submitted\nJob 0 done: 42' },
        { note: 'take(5) is a new job. Its map stage shows as skipped because the shuffle files still exist.', line: 5, vars: [['job 0', 'done', 'ok'], ['job 1', 'stage 0 skipped', 'ok']], heap: [['r0', 'HadoopRDD', 'muted'], ['r1', 'MapPartitionsRDD', 'muted'], ['r2', 'MapPartitionsRDD', 'muted'], ['r3', 'ShuffledRDD', 'ok', 'shuffle reused']], out: 'Job 0 submitted\nJob 0 done: 42\nJob 1 done: 5 rows' },
      ],
    },
  ],
  deps: [
    'Narrow vs wide → stages',
    {
      codeTitle: 'Job.scala',
      code: ['sc.textFile("in")            // 4 partitions', '  .map(parse)                // narrow', '  .filter(valid)             // narrow', '  .reduceByKey(_ + _, 8)     // wide', '  .mapValues(fmt)            // narrow', '  .saveAsTextFile("out")     // action'],
      stackTitle: 'dependencies',
      heapTitle: 'stages',
      details: {
        map: D('Narrow dependency', 'Each child partition reads at most one parent partition. Consecutive narrow steps are pipelined inside one task, with no data movement.'),
        reduceByKey: D('Wide (shuffle) dependency', 'Each child partition needs rows from every parent partition, so data must be redistributed by key across the cluster.'),
        s0: D('ShuffleMapStage', 'Runs the pipeline up to the shuffle and writes its output bucketed by reduce partition. Tasks = input partitions.'),
        s1: D('ResultStage', 'The last stage of a job. It reads shuffle output and runs the action.', 'rdd.toDebugString  // indentation marks stage boundaries'),
      },
      steps: [
        { note: 'map is narrow: output partition i depends only on input partition i.', line: [0, 1], vars: [['map', '1 → 1', 'ok']], heap: [['s0', 'read → map', 'write', '4 tasks']], out: '' },
        { note: 'filter is narrow too, so it joins the same pipeline. One task runs read, map and filter row by row.', line: 2, vars: [['map', '1 → 1', 'ok'], ['filter', '1 → 1', 'ok']], heap: [['s0', 'read → map → filter', 'write', '4 tasks']], out: '' },
        { note: 'reduceByKey needs every row for a key in one place. Each of 8 outputs reads from all 4 inputs.', line: 3, vars: [['map', '1 → 1'], ['filter', '1 → 1'], ['reduceByKey', '4 → 8 (all)', 'warn']], heap: [['s0', 'read → map → filter', 'write', '4 tasks']], out: '' },
        { note: 'The DAG scheduler cuts a stage at the shuffle. Stage 0 writes shuffle files; stage 1 reads them.', line: 3, vars: [['map', '1 → 1'], ['filter', '1 → 1'], ['reduceByKey', 'shuffle', 'protocol']], heap: [['s0', 'ShuffleMapStage 0', 'accent', 'read → map → filter → write'], ['s1', 'ResultStage 1', 'current', 'shuffle read → reduce']], out: '' },
        { note: 'mapValues is narrow and keeps the partitioner, so it stays in stage 1.', line: 4, vars: [['reduceByKey', 'shuffle', 'protocol'], ['mapValues', '1 → 1', 'ok']], heap: [['s0', 'ShuffleMapStage 0', 'accent', '4 tasks'], ['s1', 'ResultStage 1', 'current', 'reduce → mapValues → save']], out: '' },
        { note: 'The action submits the job. Stages run in dependency order with one task per partition.', line: 5, vars: [['stage 0', '4 tasks', 'ok'], ['stage 1', '8 tasks', 'ok']], heap: [['s0', 'ShuffleMapStage 0', 'ok', 'done'], ['s1', 'ResultStage 1', 'ok', 'done']], out: 'stage 0: 4/4 tasks\nstage 1: 8/8 tasks\njob done' },
      ],
    },
  ],
  shuffle: [
    'Shuffle internals',
    {
      codeTitle: 'sort-based shuffle',
      code: ['// map task m (stage 0)', 'p = partitioner.getPartition(key)   // 0..R-1', 'buffer (p, key, value); sort by p; spill', 'merge runs → shuffle_0_m_0.data + .index', 'report MapStatus to driver', '// reduce task r (stage 1)', 'fetch segment r from every map output', 'merge → aggregate → next operator'],
      stackTitle: 'task',
      heapTitle: 'executor disk / network',
      details: {
        buffer: D('Map-side buffer', 'Records are kept in memory sorted by target partition, and combined early when the operator allows it. When memory runs out, a sorted run spills to disk.'),
        data: D('Data + index file', 'One data file per map task holds all partitions back to back. The index stores byte offsets, so a reducer’s segment is one seek.', 'offsets: [0, 120, 300, 410]\np1 = bytes 120..300'),
        ess: D('External shuffle service', 'A long-lived per-node process that serves shuffle files. Blocks outlive the executor that wrote them, which dynamic allocation relies on.', 'spark.shuffle.service.enabled=true'),
      },
      steps: [
        { note: 'Each record’s key is hashed to one of R reduce partitions.', line: [0, 1], vars: [['(a,1)', 'p0', 'write'], ['(b,1)', 'p1', 'write'], ['(c,1)', 'p2', 'write']], heap: [], out: '' },
        { note: 'Records are buffered in memory, sorted by partition id. A full buffer spills a sorted run to disk.', line: 2, vars: [['buffer', 'p0 p0 p1 p2 p2', 'current'], ['memory', 'full', 'warn']], heap: [['run1', 'spill run 1', 'write', 'sorted by p']], out: '' },
        { note: 'At task end the runs merge into one data file plus an index of byte offsets.', line: 3, vars: [['buffer', 'drained', 'ok']], heap: [['data', 'shuffle_0_0_0.data', 'write', 'p0 | p1 | p2'], ['index', 'shuffle_0_0_0.index', 'write', '0, 120, 300, 410']], out: '' },
        { note: 'The task reports a MapStatus to the driver. It holds the location and block sizes.', line: 4, vars: [['MapStatus', 'exec-2, sizes', 'protocol']], heap: [['data', 'shuffle_0_0_0.data', 'read'], ['index', 'shuffle_0_0_0.index', 'read']], out: 'MapOutputTracker: map 0 → exec-2' },
        { note: 'Reduce task 1 asks the tracker for locations, then fetches segment p1 from every map output.', line: [5, 6], vars: [['reduce 1', 'fetching', 'current'], ['from map 0', 'p1: 180 B', 'read'], ['from map 1', 'p1: 95 B', 'read']], heap: [['data', 'map 0 .data', 'read', 'seek 120..300'], ['data1', 'map 1 .data', 'read', 'seek via index']], out: 'MapOutputTracker: map 0 → exec-2\nfetch 2 blocks' },
        { note: 'Fetched blocks are merged and aggregated. If a file is gone, FetchFailed reruns the lost map tasks.', line: 7, vars: [['reduce 1', '(b, 7)', 'ok']], heap: [['ess', 'external shuffle service', 'accent', 'serves files if executor exits']], out: 'MapOutputTracker: map 0 → exec-2\nfetch 2 blocks\nreduce 1 done' },
      ],
    },
  ],
});

// ---------------- Spark SQL engine ----------------
traceDemo('spark-sql', 'Spark SQL engine', 'Catalyst turns a query into an optimized physical plan; Tungsten runs it as generated code; join strategy and AQE decide how data moves.', {
  catalyst: [
    'Catalyst optimizer',
    {
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
    },
  ],
  codegen: [
    'Tungsten & codegen',
    {
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
    },
  ],
  joins: [
    'Join strategies',
    {
      codeTitle: 'joins.scala',
      code: ['orders.join(countries, "cc")    // 5 MB side', 'orders.join(payments, "id")     // both huge', 'orders.join(users.hint("shuffle_hash"), "uid")', 'orders.join(broadcast(users), "uid")', 'spark.sql.autoBroadcastJoinThreshold = 10MB'],
      stackTitle: 'strategy',
      heapTitle: 'data movement',
      details: {
        BHJ: D('Broadcast hash join', 'The small side is collected and shipped to every executor, which builds a hash table. The big side is never shuffled.', 'spark.sql.autoBroadcastJoinThreshold=10MB'),
        SMJ: D('Sort-merge join', 'Default for two large tables. Both sides shuffle by key, sort within partitions, then stream-merge; sorting can spill, so it scales.'),
        SHJ: D('Shuffle hash join', 'Both sides shuffle, then the smaller side of each partition becomes a hash table. Skips the sort but that table must fit in memory.'),
      },
      steps: [
        { note: 'countries is under the 10 MB threshold, so Spark broadcasts it. Each task probes a local hash table.', line: [0, 4], vars: [['BHJ', 'countries → all', 'ok']], heap: [['bc', 'countries (5 MB)', 'write', 'broadcast to 50 executors'], ['o', 'orders partitions', 'read', 'not shuffled']], out: '' },
        { note: 'Two large tables use sort-merge join. Both sides shuffle by id, sort, and merge like a zipper.', line: 1, vars: [['BHJ', 'too big', 'muted'], ['SMJ', 'shuffle + sort', 'accent']], heap: [['o', 'orders → Exchange', 'protocol', 'hash(id) % 200'], ['pay', 'payments → Exchange', 'protocol', 'hash(id) % 200'], ['m', 'sort + merge per partition', 'ok']], out: '' },
        { note: 'Shuffle hash join also shuffles both sides but builds a hash table instead of sorting.', line: 2, vars: [['SMJ', 'default'], ['SHJ', 'shuffle + hash', 'accent']], heap: [['o', 'orders → Exchange', 'protocol'], ['u', 'users → Exchange', 'protocol'], ['h', 'hash table per partition', 'warn', 'must fit in memory']], out: '' },
        { note: 'A broadcast hint forces BHJ regardless of size. Too large a side can OOM the driver or time out.', line: 3, vars: [['hint', 'broadcast(users)', 'warn']], heap: [['bc', 'users (2 GB)', 'fail', 'collect to driver']], out: 'Broadcast timeout / driver OOM' },
      ],
    },
  ],
  aqe: [
    'Adaptive Query Execution',
    {
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
    },
  ],
});

// ---------------- memory, caching & partitioning ----------------
traceDemo('spark-mem', 'Memory, caching & partitioning', 'Execution and storage share one memory pool; persist keeps computed partitions; repartition shuffles while coalesce merges.', {
  memory: [
    'Unified memory model',
    {
      codeTitle: 'executor 8 GB heap',
      code: ['reserved                        = 300 MB', 'spark.memory.fraction           = 0.6', 'spark.memory.storageFraction    = 0.5', 'user memory = rest (UDF objects, metadata)', 'spark.executor.memoryOverhead   = 10%'],
      stackTitle: 'demand',
      heapTitle: 'heap regions',
      details: {
        unified: D('Unified region', 'fraction × (heap − 300 MB). Execution and storage borrow from each other; the boundary moves at runtime.'),
        storage: D('Storage', 'Cached blocks and broadcast variables. Execution may evict cached blocks, but only down to storageFraction of the region.'),
        exec: D('Execution', 'Buffers for shuffles, joins, sorts and aggregations. Cached data never evicts it, so it spills when it cannot grow.'),
        spill: D('Spill', 'Sorted runs written to local disk and merged later. Shows as Spill (Memory/Disk) in the stage UI.'),
      },
      steps: [
        { note: 'After 300 MB reserved, 60% of the heap becomes one unified pool. The rest is user memory.', line: [0, 1, 3], vars: [['heap', '8192 MB']], heap: [['r', 'reserved 300 MB', 'muted'], ['user', 'user 3.1 GB', 'default'], ['unified', 'unified 4.6 GB', 'accent']], out: '' },
        { note: 'Execution and storage share the pool. Half is the storage floor that execution cannot take from cache.', line: 2, vars: [['cache', '3.0 GB', 'read'], ['sort', '1.0 GB', 'write']], heap: [['storage', 'storage 3.0 GB', 'read', 'floor 2.3 GB'], ['exec', 'execution 1.0 GB', 'write'], ['free', 'free 0.6 GB', 'muted']], out: '' },
        { note: 'A join needs 2.3 GB. Execution takes the free space, then evicts cached blocks down to the floor.', line: 2, vars: [['join', '2.3 GB', 'warn'], ['evicted', '0.7 GB', 'warn']], heap: [['storage', 'storage 2.3 GB', 'warn', 'at floor'], ['exec', 'execution 2.3 GB', 'write']], out: '' },
        { note: 'Execution wants more but cannot evict below the floor. The sort spills runs to disk and continues.', line: 2, vars: [['join', 'needs 3.3 GB', 'fail'], ['spill', '1 GB to disk', 'warn']], heap: [['storage', 'storage 2.3 GB', 'read', 'protected'], ['exec', 'execution 2.3 GB', 'warn', 'full'], ['disk', 'local disk', 'write', 'spill files']], out: 'Spill (Disk): 1.0 GB' },
        { note: 'Off-heap use like Python workers and netty buffers counts against overhead. Exceeding it gets the container killed.', line: 4, vars: [['overhead', '819 MB', 'read'], ['pyspark', '900 MB', 'fail']], heap: [['k8s', 'container limit 9 GB', 'fail', 'OOMKilled']], out: 'Container killed: exceeding memory limits' },
      ],
    },
  ],
  cache: [
    'Caching & persist levels',
    {
      codeTitle: 'cache.scala',
      code: ['val df = spark.read.parquet("events")', '  .filter($"type" === "click")', 'df.persist(StorageLevel.MEMORY_AND_DISK)', 'df.count()                     // fills cache', 'df.groupBy("page").count().show()', 'df.unpersist()'],
      stackTitle: 'driver',
      heapTitle: 'BlockManager (executors)',
      details: {
        df: D('persist / cache', 'Lazy: only marks the plan. The first action stores each computed partition as a block.', 'MEMORY_ONLY         RDD cache() default\nMEMORY_AND_DISK     Dataset cache() default\nMEMORY_ONLY_SER     compact, CPU to read\nDISK_ONLY\nMEMORY_AND_DISK_2   two replicas\nOFF_HEAP'),
        b2: D('Disk fallback', 'Under MEMORY_AND_DISK, blocks that do not fit go to local disk. MEMORY_ONLY would drop them and recompute from lineage on each use.'),
        scan: D('InMemoryTableScan', 'Dataset caches are stored columnar and compressed. Later plans scan them instead of the files.'),
      },
      steps: [
        { note: 'persist returns at once. It only tags the plan with a storage level.', line: [0, 1, 2], vars: [['df', 'marked', 'write']], heap: [], out: '' },
        { note: 'count() computes every partition and stores each as a cached block.', line: 3, vars: [['df', 'materializing', 'current']], heap: [['b0', 'rdd_7_0', 'write', 'memory, columnar'], ['b1', 'rdd_7_1', 'write', 'memory, columnar']], out: '12,400,113' },
        { note: 'Partition 2 does not fit in storage memory. MEMORY_AND_DISK writes it to local disk.', line: 3, vars: [['df', 'cached', 'ok']], heap: [['b0', 'rdd_7_0', 'read', 'memory'], ['b1', 'rdd_7_1', 'read', 'memory'], ['b2', 'rdd_7_2', 'warn', 'disk']], out: '12,400,113' },
        { note: 'The next query reads the blocks instead of Parquet. The filter is not re-run.', line: 4, vars: [['df', 'cached', 'ok'], ['scan', 'InMemoryTableScan', 'accent']], heap: [['b0', 'rdd_7_0', 'current'], ['b1', 'rdd_7_1', 'current'], ['b2', 'rdd_7_2', 'current', 'disk read']], out: '12,400,113\n+----+-----+\n|page|count|' },
        { note: 'unpersist frees the blocks. Otherwise they stay until evicted in LRU order.', line: 5, vars: [['df', 'uncached', 'muted']], heap: [['b0', 'freed', 'muted'], ['b1', 'freed', 'muted'], ['b2', 'freed', 'muted']], out: 'blocks removed: 3' },
      ],
    },
  ],
  partition: [
    'repartition vs coalesce',
    {
      codeTitle: 'partitions.scala',
      code: ['df.rdd.getNumPartitions        // 400', 'df.repartition(100)            // full shuffle', 'df.coalesce(10)                // merge, no shuffle', 'df.repartition(50, $"day")     // hash by column', 'df.write.partitionBy("day")    // folders'],
      stackTitle: 'call',
      heapTitle: 'partitions',
      details: {
        repartition: D('repartition(n)', 'A full shuffle that spreads rows round-robin into n even partitions. Can raise or lower the count.'),
        coalesce: D('coalesce(n)', 'Merges existing partitions without a shuffle, so it can only reduce the count. It also narrows the upstream stage: coalesce(1) runs the whole stage as one task.', 'df.coalesce(1).write.csv(out)   // one task does all'),
        partitionBy: D('write.partitionBy', 'A directory layout on disk, not the in-memory partitioning. Readers skip folders whose day does not match.', 'out/day=2024-05-01/part-00000.parquet'),
      },
      steps: [
        { note: 'The scan creates 400 partitions from input splits of about 128 MB.', line: 0, vars: [['input', '400 parts', 'read']], heap: [['a', 'p0 … p399', 'read', '~128 MB each']], out: '' },
        { note: 'repartition(100) shuffles every row into 100 evenly sized partitions.', line: 1, vars: [['repartition', '400 → 100', 'protocol']], heap: [['a', 'Exchange RoundRobin', 'protocol', 'all rows move'], ['b', 'p0 … p99', 'ok', 'even sizes']], out: '' },
        { note: 'coalesce(10) groups existing partitions on the same executor. No shuffle, but sizes can be uneven.', line: 2, vars: [['coalesce', '100 → 10', 'ok']], heap: [['b', 'p0 … p99', 'read'], ['c', 'p0 … p9', 'warn', 'uneven, fewer tasks']], out: '' },
        { note: 'repartition by column hash-partitions on day. All rows for a day land together, so a hot day skews one task.', line: 3, vars: [['repartition', 'hash(day) % 50', 'protocol']], heap: [['d', 'p0 … p49', 'accent', 'by day'], ['hot', 'p17 (Black Friday)', 'warn', 'skewed']], out: '' },
        { note: 'partitionBy writes one folder per day. Each task writes a file into every folder it holds rows for.', line: 4, vars: [['partitionBy', 'day', 'write']], heap: [['f1', 'day=2024-05-01/', 'write', 'part-00000..'], ['f2', 'day=2024-05-02/', 'write', 'part-00000..']], out: 'written: 50 files' },
      ],
    },
  ],
});
