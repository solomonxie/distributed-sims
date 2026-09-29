// Spark from spark-line (group stack-spark): the One Billion Row Challenge and the hello-spark study path.
import { boardDemo, N } from '../machine/lib/board';
import { D } from './lib';

const G = 'stack-spark';

/** 1BRC sizing: input splits, task waves on the cluster, and rows crossing the shuffle after map-side aggregation. */
export function sparkPlan(fileBytes: number, maxPartitionBytes: number, stations: number, cores: number) {
  const inputParts = Math.max(1, Math.ceil(fileBytes / maxPartitionBytes));
  const waves = Math.ceil(inputParts / cores);
  const shuffleRows = inputParts * stations;
  return { inputParts, waves, shuffleRows };
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const P = sparkPlan(15 * GB, 128 * MB, 1000, 4);

const JOB = D(
  'job.py (capstone)',
  'Explicit schema on read, one native groupBy().agg, sort, then collect only the small aggregated result.',
  'df = spark.read.csv(path, sep=";",\n    schema=MEASUREMENT_SCHEMA, header=False)\nagg = df.groupBy("station").agg(\n    F.min("temperature").alias("min_temp"),\n    F.avg("temperature").alias("mean_temp"),\n    F.max("temperature").alias("max_temp"),\n).orderBy("station")\nresult = format_result(agg.collect())',
);
const SUBMIT = D('spark-submit', 'Run on the node against the standalone master: one driver, two workers on one t3.xlarge.', 'spark-submit --master spark://<master>:7077 \\\n  job.py --input ~/data/measurements.txt \\\n  --output ~/results.txt');
const FILE = D('measurements.txt', 'About 1 billion lines of <station>;<temperature>, 15–20 GB, generated once by make generate-data.', 'Hamburg;12.0\nBulawayo;8.9\nPalembang;38.8\nSt. John\'s;15.2\n...');

boardDemo(G, 'stk-spark-1brc', 'Spark: the One Billion Row Challenge', '1B rows of station;temperature → min/mean/max per station with one shuffle, explicit schema, AQE and no driver collect of raw rows.', {
  schema: [
    'Explicit schema',
    {
      panel: 'Read',
      nodes: [
        N('file', 40, 60, 920, 120, 'measurements.txt', '~1B rows · 15 GB', { detail: FILE }),
        N('infer', 40, 300, 440, 150, 'inferSchema=true', 'extra full pass', { detail: D('inferSchema', 'Spark reads the whole file once just to guess types, then again for the job. On 15 GB that doubles the I/O.', 'spark.read.csv(path, inferSchema=True)') }),
        N('exp', 520, 300, 440, 150, 'explicit schema', 'one pass', { detail: D('MEASUREMENT_SCHEMA', 'Types known up front, no guessing pass, and no string → double surprises.', 'StructType([\n  StructField("station", StringType(), False),\n  StructField("temperature", DoubleType(), False),\n])') }),
        N('df', 280, 580, 440, 130, 'DataFrame', 'station, temperature'),
        N('verify', 40, 800, 920, 130, 'verify_sample.py', 'brute-force reference', { detail: D('Correctness first', 'Run the brute-force reference on a 10k-row sample before any Spark code. Mismatches are usually rounding: Python .1f is half-even, Spark round() is half-up.', 'python data/generate_measurements.py \\\n  --rows 10000 --stations 20 --output /tmp/sample.txt\npython tools/verify_sample.py /tmp/sample.txt') }),
      ],
      edges: ['file>infer', 'file>exp', 'exp>df'],
      beats: [
        { note: 'The input is one big text file of station;temperature lines.', hot: { file: 'current' }, hide: ['infer', 'exp', 'df', 'verify'], rows: [['rows', '~1,000,000,000'], ['size', '~15 GB']] },
        { note: 'inferSchema costs a throwaway full pass over the file.', hot: { infer: 'warn', 'file>infer': 'warn' }, hide: ['exp', 'df', 'verify'], rows: [['passes', 2, 'warn']] },
        { note: 'An explicit StructType reads the file once with known types.', hot: { exp: 'ok', 'file>exp': 'accent', 'exp>df': 'accent', df: 'ok' }, hide: ['verify'], rows: [['passes', 1, 'ok']] },
        { note: 'Before scaling, compare against the brute-force reference on a small sample.', hot: { verify: 'current' }, rows: [['sample', '10k rows'], ['check', 'rounding, sort']] },
      ],
    },
  ],
  plan: [
    'One shuffle',
    {
      panel: 'Physical plan',
      nodes: [
        N('scan', 40, 40, 920, 100, 'FileScan csv', `${P.inputParts} input partitions`, { detail: FILE }),
        N('partial', 40, 200, 920, 110, 'HashAggregate (partial)', 'map-side: ≤ 1000 rows per task', { detail: D('Partial aggregation', 'Each task pre-aggregates its own 128 MB split into at most one row per station before anything crosses the network.', '+- HashAggregate(keys=[station],\n     functions=[partial_min, partial_avg,\n                partial_max])') }),
        N('ex', 40, 370, 920, 110, 'Exchange hashpartitioning', `${P.shuffleRows.toLocaleString('en-US')} rows shuffled`, { detail: D('The only shuffle', 'Rows are hashed by station to reducer tasks. After map-side aggregation this is about a hundred thousand rows, not a billion.', '+- Exchange hashpartitioning(station, 200)') }),
        N('final', 40, 540, 920, 110, 'HashAggregate (final)', 'merge partials per station'),
        N('sort', 40, 710, 440, 110, 'Sort by station', '1000 rows'),
        N('collect', 520, 710, 440, 110, 'collect() → driver', '1000 rows only', { detail: JOB }),
        N('bad', 40, 870, 920, 110, 'anti-pattern', 'collect raw rows / Python UDF', { detail: D('What not to do', 'A Python UDF serialises every row to a Python worker; collecting raw rows ships 1B rows to the driver and OOMs it.', '# no:\nrows = df.collect()\n# no:\n@udf def parse(line): ...') }),
      ],
      edges: ['scan>partial', 'partial>ex', 'ex>final', 'final>sort', 'sort>collect'],
      beats: [
        { note: `The scan splits the file into about ${P.inputParts} partitions of 128 MB, one task each.`, hot: { scan: 'current' }, hide: ['partial', 'ex', 'final', 'sort', 'collect', 'bad'], rows: [['input partitions', P.inputParts]] },
        { note: 'Each task aggregates its own split first, keeping at most one row per station.', hot: { partial: 'current', 'scan>partial': 'accent' }, hide: ['ex', 'final', 'sort', 'collect', 'bad'], rows: [['rows per task out', '≤ 1000']] },
        { note: 'Only those partial rows cross the network in the single shuffle.', hot: { ex: 'write', 'partial>ex': 'accent' }, hide: ['final', 'sort', 'collect', 'bad'], rows: [['shuffled rows', P.shuffleRows.toLocaleString('en-US'), 'ok'], ['vs raw', '1,000,000,000']] },
        { note: 'Reducers merge the partials into one min, mean and max per station.', hot: { final: 'current', 'ex>final': 'accent' }, hide: ['sort', 'collect', 'bad'], rows: [['stations', 1000]] },
        { note: 'Only the 1000-row result is sorted and collected to the driver for formatting.', hot: { sort: 'ok', collect: 'ok', 'final>sort': 'accent', 'sort>collect': 'accent' }, hide: ['bad'], rows: [['driver gets', '1000 rows', 'ok']] },
        { note: 'Run .explain() and expect exactly this: partial aggregate, one Exchange, final aggregate. A UDF or a raw collect breaks it.', hot: { bad: 'fail' }, rows: [['Exchanges', 1, 'ok']] },
      ],
    },
  ],
  partitions: [
    'Partitions & slots',
    {
      panel: 'Cluster',
      nodes: [
        N('drv', 355, 40, 290, 110, 'driver', 'spark-submit', { detail: SUBMIT }),
        N('m', 355, 200, 290, 100, 'master :8080', 'standalone'),
        N('w1', 40, 370, 440, 130, 'worker 1 :8081', '2 cores'),
        N('w2', 520, 370, 440, 130, 'worker 2 :8082', '2 cores'),
        N('tasks', 40, 580, 920, 120, `${P.inputParts} tasks`, `${P.waves} waves of 4`, { detail: D('Input partitions', 'spark.sql.files.maxPartitionBytes (128 MB) decides the split size. Only lower it if the UI shows fewer partitions than cores.', 'spark.conf.get(\n  "spark.sql.files.maxPartitionBytes")\n# 134217728') }),
        N('ui', 40, 780, 920, 150, 'Spark UI :4040', 'spill · skew · shuffle size', { detail: D('What to watch', 'Spill (memory/disk) on the aggregation stage near zero, no single task much slower than its peers, shuffle size sane for the data.', 'open http://<node>:4040/stages/') }),
      ],
      edges: ['drv>m', 'm>w1', 'm>w2'],
      beats: [
        { note: 'One t3.xlarge runs the driver, a standalone master and two workers of 2 cores each.', hot: { drv: 'current', m: 'current', w1: 'current', w2: 'current' }, hide: ['tasks', 'ui'], rows: [['slots', 4]] },
        { note: `${P.inputParts} input tasks on 4 slots run in about ${P.waves} waves.`, hot: { tasks: 'write' }, hide: ['ui'], rows: [['tasks', P.inputParts], ['waves', P.waves]] },
        { note: 'Plenty of partitions for 4 cores, so maxPartitionBytes stays at its default.', hot: { tasks: 'ok' }, hide: ['ui'], rows: [['maxPartitionBytes', '128 MB', 'ok']] },
        { note: 'The Spark UI is the feedback loop: spill, skewed tasks and shuffle bytes per stage.', hot: { ui: 'current' }, rows: [['spill target', '≈ 0']] },
      ],
    },
  ],
  aqe: [
    'AQE coalescing',
    {
      panel: 'AQE',
      nodes: [
        N('ex', 40, 60, 920, 110, 'Exchange', 'spark.sql.shuffle.partitions = 200'),
        N('tiny', 40, 250, 920, 130, '200 reducer tasks', 'each gets ~600 rows', { detail: D('Too many reducers', 'After map-side aggregation the shuffle is tiny. 200 fixed partitions means 200 near-empty tasks, each paying scheduling overhead.') }),
        N('aqe', 40, 460, 920, 130, 'AQE re-plans at runtime', 'coalescePartitions', { detail: D('Adaptive Query Execution', 'AQE looks at real shuffle sizes after the map stage and merges small partitions, so nobody has to guess shuffle.partitions.', '.config("spark.sql.adaptive.enabled", "true")\n.config("spark.sql.adaptive\n         .coalescePartitions.enabled", "true")') }),
        N('few', 40, 670, 920, 130, '1 reducer task', 'same result, less overhead'),
      ],
      edges: ['ex>tiny', 'aqe>few'],
      beats: [
        { note: 'The shuffle defaults to 200 partitions no matter how much data crosses it.', hot: { ex: 'current' }, hide: ['tiny', 'aqe', 'few'], rows: [['shuffle.partitions', 200]] },
        { note: 'Here that means 200 tiny reducer tasks.', hot: { tiny: 'warn', 'ex>tiny': 'warn' }, hide: ['aqe', 'few'], rows: [['rows per reducer', '~600', 'warn']] },
        { note: 'AQE measures the real shuffle output and coalesces the small partitions.', hot: { aqe: 'current' }, hide: ['few'], rows: [['decided', 'at runtime']] },
        { note: 'The job left AQE on instead of hand-tuning shuffle.partitions.', hot: { few: 'ok', 'aqe>few': 'accent' }, rows: [['reducers', 1, 'ok']] },
      ],
    },
  ],
  ladder: [
    'Scale ladder',
    {
      panel: 'Progression',
      nodes: [
        N('t1', 40, 60, 920, 110, 'solve_01 · 10k rows', 'correctness vs reference'),
        N('t2', 40, 240, 920, 110, 'solve_02 · 1M rows', 'first real partitions'),
        N('t3', 40, 420, 920, 110, 'solve_03 · 100M rows', 'watch spill & skew'),
        N('t4', 40, 600, 920, 110, 'solve_04 · 1B rows', 'the real run', { detail: SUBMIT }),
        N('why', 40, 800, 920, 130, 'why a ladder', 'failures are cheaper small'),
      ],
      edges: ['t1>t2', 't2>t3', 't3>t4'],
      beats: [
        { note: 'Start at 10k rows and diff against verify_sample.py until output matches exactly.', hot: { t1: 'current' }, hide: ['why'], rows: [['rows', '10k']] },
        { note: 'At 1M rows the job is split into several partitions for the first time.', hot: { t2: 'current', 't1>t2': 'accent' }, hide: ['why'], rows: [['rows', '1M']] },
        { note: 'At 100M, spill or a straggler shows up in the UI if the plan is wrong.', hot: { t3: 'warn', 't2>t3': 'accent' }, hide: ['why'], rows: [['rows', '100M']] },
        { note: 'Only then run the full billion, unmodified.', hot: { t4: 'ok', 't3>t4': 'accent' }, hide: ['why'], rows: [['rows', '1B', 'ok']] },
        { note: 'Rounding bugs, OOM and extra shuffles are all cheaper to find at small scale.', hot: { why: 'current' }, rows: [['expected time', 'low minutes']] },
      ],
    },
  ],
});

const SESSION = D('SparkSession', 'The entry point. master() picks where work runs: local[*] uses this machine’s cores, spark://… uses the cluster.', 'spark = (SparkSession.builder\n  .appName("Hello01-SparkSession")\n  .master(os.environ.get("SPARK_MASTER_URL",\n                         "local[*]"))\n  .getOrCreate())');

boardDemo(G, 'stk-spark-study', 'Spark study path', 'hello-spark steps: session and master, lazy transformations vs actions, window functions, partitioned Parquet.', {
  session: [
    'Session & master',
    {
      panel: 'Session',
      nodes: [
        N('app', 355, 40, 290, 110, 'hello_01.py', 'driver', { detail: SESSION }),
        N('local', 40, 280, 420, 140, 'local[*]', 'all cores, one JVM'),
        N('cluster', 540, 280, 420, 140, 'spark://m:7077', 'standalone cluster'),
        N('w', 540, 520, 420, 120, 'executors', 'on workers'),
        N('jup', 40, 520, 420, 120, 'JupyterLab :8888', 'spark pre-made', { detail: D('Jupyter on the node', 'Every kernel gets a spark session from an IPython startup script, local[*] unless SPARK_MASTER_URL is set.', 'open "$(terraform -chdir=terraform \\\n  output -raw jupyter_url)"') }),
      ],
      edges: ['app>local', 'app>cluster', 'cluster>w'],
      beats: [
        { note: 'Every script starts by building a SparkSession.', hot: { app: 'current' }, hide: ['w', 'jup'], rows: [['app', 'Hello01']] },
        { note: 'Without SPARK_MASTER_URL it runs local[*], no cluster needed.', hot: { local: 'ok', 'app>local': 'accent' }, hide: ['w', 'jup'], rows: [['master', 'local[*]']] },
        { note: 'Export SPARK_MASTER_URL=spark://<master>:7077 and the same code runs on the cluster’s executors.', hot: { cluster: 'current', w: 'ok', 'app>cluster': 'accent', 'cluster>w': 'accent' }, hide: ['jup'], rows: [['master', 'spark://…:7077']] },
        { note: 'The node also serves JupyterLab with a spark session already made.', hot: { jup: 'current' }, rows: [['port', 8888]] },
      ],
    },
  ],
  lazy: [
    'Lazy vs action',
    {
      panel: 'Execution',
      nodes: [
        N('par', 40, 40, 920, 100, 'sc.parallelize(range(1, 11))', 'RDD'),
        N('map', 40, 200, 440, 110, 'map(x*x)', 'lazy', { detail: D('Transformations', 'map and filter only record lineage. Nothing runs yet.', 'squares = rdd.map(lambda x: x * x)\nevens = squares.filter(lambda x: x % 2 == 0)') }),
        N('filter', 520, 200, 440, 110, 'filter(even)', 'lazy'),
        N('act', 40, 400, 920, 120, 'collect() / count() / reduce()', 'action → job', { detail: D('Actions', 'An action makes the driver build stages from the lineage and launch tasks.', 'evens.collect()   # [4, 16, 36, 64, 100]\nsquares.reduce(lambda a, b: a + b)  # 385') }),
        N('job', 40, 600, 920, 120, 'job → stage → tasks', 'one task per partition'),
      ],
      edges: ['par>map', 'map>filter', 'act>job'],
      beats: [
        { note: 'parallelize splits a local list into partitions.', hot: { par: 'current' }, hide: ['map', 'filter', 'act', 'job'], rows: [['partitions', 'cores']] },
        { note: 'map and filter are transformations: they only add to the lineage.', hot: { map: 'write', filter: 'write', 'par>map': 'accent', 'map>filter': 'accent' }, hide: ['act', 'job'], rows: [['jobs run', 0]] },
        { note: 'An action like collect finally triggers a job.', hot: { act: 'current' }, hide: ['job'], rows: [['jobs run', 1]] },
        { note: 'The driver turns the lineage into a stage and runs one task per partition.', hot: { job: 'ok', 'act>job': 'accent' }, rows: [['result', '[4, 16, 36, 64, 100]', 'ok']] },
      ],
    },
  ],
  window: [
    'Window functions',
    {
      panel: 'Window',
      nodes: [
        N('trips', 40, 40, 920, 110, 'trips', 'borough, fare'),
        N('part', 40, 220, 920, 110, 'partitionBy(borough)', 'orderBy(fare desc)', { detail: D('Window spec', 'Rank rows within each group without collapsing them and without a self-join.', 'w = Window.partitionBy("borough") \\\n    .orderBy(col("fare").desc())\ntop = (df.withColumn("rank", dense_rank().over(w))\n       .filter(col("rank") <= 3))') }),
        N('man', 40, 420, 290, 150, 'Manhattan', '1, 2, 3 …'),
        N('bk', 355, 420, 290, 150, 'Brooklyn', '1, 2, 3 …'),
        N('qn', 670, 420, 290, 150, 'Queens', '1, 2, 3 …'),
        N('top', 40, 680, 920, 120, 'rank ≤ 3', 'top 3 trips per borough'),
      ],
      edges: ['trips>part', 'part>man', 'part>bk', 'part>qn'],
      beats: [
        { note: 'groupBy collapses each borough to one row; a window keeps every row.', hot: { trips: 'current' }, hide: ['part', 'man', 'bk', 'qn', 'top'], rows: [['rows', 200]] },
        { note: 'The window partitions rows by borough and orders them by fare.', hot: { part: 'current', 'trips>part': 'accent' }, hide: ['man', 'bk', 'qn', 'top'], rows: [['shuffle', 'by borough']] },
        { note: 'dense_rank numbers the trips inside each borough independently.', hot: { man: 'write', bk: 'write', qn: 'write' }, hide: ['top'], rows: [['function', 'dense_rank']] },
        { note: 'Filtering rank ≤ 3 keeps the top three per borough.', hot: { top: 'ok' }, rows: [['result rows', '≤ 9', 'ok']] },
      ],
    },
  ],
  parquet: [
    'Partitioned Parquet',
    {
      panel: 'Files',
      nodes: [
        N('df', 355, 40, 290, 110, 'DataFrame', 'cleaned trips'),
        N('w', 40, 230, 920, 110, 'write.partitionBy("borough")', '.parquet(out)', { detail: D('Partitioned write', 'One directory per borough, columnar files inside. Readers filtering on borough skip other directories entirely.', 'df.write.mode("overwrite") \\\n  .partitionBy("borough").parquet(out)\n# out/borough=Manhattan/part-0000.parquet') }),
        N('d1', 40, 420, 290, 120, 'borough=Manhattan/', 'part-*.parquet'),
        N('d2', 355, 420, 290, 120, 'borough=Brooklyn/', 'part-*.parquet'),
        N('d3', 670, 420, 290, 120, 'borough=Queens/', 'part-*.parquet'),
        N('r', 40, 650, 920, 130, 'read + filter borough', 'partition pruning', { detail: D('Pruning', 'The filter on the partition column becomes a directory filter; other boroughs are never opened.', 'spark.read.parquet(out) \\\n  .filter("borough = \'Queens\'")') }),
      ],
      edges: ['df>w', 'w>d1', 'w>d2', 'w>d3', 'd3>r'],
      beats: [
        { note: 'The ETL capstone ends by writing Parquet partitioned by borough.', hot: { df: 'current', w: 'current', 'df>w': 'accent' }, hide: ['d1', 'd2', 'd3', 'r'], rows: [['format', 'parquet']] },
        { note: 'Each borough becomes a directory of columnar files.', hot: { d1: 'write', d2: 'write', d3: 'write' }, hide: ['r'], rows: [['directories', 3]] },
        { note: 'A read that filters on borough opens only the matching directory.', hot: { r: 'ok', d3: 'ok', 'd3>r': 'accent', d1: 'visited', d2: 'visited' }, rows: [['dirs read', 1, 'ok']] },
      ],
    },
  ],
});
