// Databricks & Delta Lake from spark-line/hello-databricks (group stack-databricks).
import { boardDemo, N } from '../machine/lib/board';
import { D, seqDemo } from './lib';

const G = 'stack-databricks';

const LAPTOP = D('Your machine', 'Databricks Connect is a thin client: it builds query plans locally and sends them to the cluster over Spark Connect.', 'export DATABRICKS_HOST=https://<ws>.cloud.databricks.com\nexport DATABRICKS_TOKEN=<pat>\nexport DATABRICKS_CLUSTER_ID=$(terraform \\\n  -chdir=../terraform output -raw cluster_id)');
const CLUSTER = D('Cluster', 'Runs every DataFrame operation. Stops itself after the idle timeout.', 'spark = DatabricksSession.builder.remote(\n    host=..., token=..., cluster_id=...\n).getOrCreate()');
const UC = D('Unity Catalog', 'Governance layer: every table is catalog.schema.table with permissions and lineage, stored as Delta.', 'spark.table(f"{catalog}.{schema}.hello_cities")');
const STORE = D('Cloud storage', 'Parquet data files plus the _delta_log directory of JSON commits.', 's3://…/hello_cities/\n  _delta_log/00000000000000000000.json\n  _delta_log/00000000000000000001.json\n  part-00000-….snappy.parquet');

seqDemo(G, 'stk-databricks', 'Databricks from your laptop', 'Databricks Connect sessions, Unity Catalog tables, Delta MERGE and history, and submitting a Job.', {
  connect: [
    'Databricks Connect',
    {
      panel: 'Connect',
      lanes: [
        { id: 'me', label: 'laptop', sub: 'python', detail: LAPTOP },
        { id: 'cl', label: 'cluster', detail: CLUSTER },
      ],
      intro: 'No local[*] fallback: every script drives a real, running cluster.',
      msgs: [
        { from: 'me', to: 'cl', label: 'session (token)', note: 'DatabricksSession.remote() authenticates with host, token and cluster id.' },
        { from: 'cl', to: 'me', label: 'session id', reply: true, note: 'A Spark Connect session is open on the cluster.' },
        { from: 'me', to: 'me', label: 'plan range().count', note: 'spark.range(1, 1_000_001).count() is only a plan on your machine.' },
        { from: 'me', to: 'cl', label: 'plan over gRPC', note: 'The unresolved plan is sent to the cluster.' },
        { from: 'cl', to: 'cl', label: 'execute', note: 'The cluster runs the whole job.' },
        { from: 'cl', to: 'me', label: '1000000', reply: true, note: 'Only the result comes back.' },
      ],
      outro: 'Spark Connect is DataFrame and SQL only: no sparkContext and no RDDs from the client.',
      outroRows: [['data moved to laptop', 'results only', 'ok']],
    },
  ],
  table: [
    'Unity Catalog table',
    {
      panel: 'Unity Catalog',
      lanes: [
        { id: 'me', label: 'laptop', detail: LAPTOP },
        { id: 'cl', label: 'cluster', detail: CLUSTER },
        { id: 'uc', label: 'Unity Catalog', detail: UC },
        { id: 's3', label: 'storage', detail: STORE },
      ],
      intro: 'Write 4 cities to catalog.schema.hello_cities, then read them back by name.',
      msgs: [
        { from: 'me', to: 'cl', label: 'saveAsTable', note: 'df.write.mode("overwrite").saveAsTable(table) is sent as a plan.', detail: D('Managed Delta table', 'Tables are Delta by default and addressed by name, not path.', 'df.write.mode("overwrite").saveAsTable(\n    f"{catalog}.{schema}.hello_cities")') },
        { from: 'cl', to: 'uc', label: 'create / authorize', note: 'The cluster asks Unity Catalog for permission and the table’s storage location.' },
        { from: 'uc', to: 'cl', label: 'location + creds', reply: true, note: 'It gets a managed location and short-lived storage credentials.' },
        { from: 'cl', to: 's3', label: 'parquet files', note: 'Executors write the data files.' },
        { from: 'cl', to: 's3', label: '_delta_log/000', note: 'A JSON commit lists the files: version 0 exists only once this lands.' },
        { from: 'me', to: 'cl', label: 'spark.table(name)', note: 'Reading back needs only the three-part name.' },
        { from: 'cl', to: 'uc', label: 'resolve name', note: 'Unity Catalog resolves and authorizes it.' },
        { from: 'cl', to: 'me', label: '4 rows', reply: true, note: 'Rows come back to the laptop.' },
      ],
      outro: 'Unity Catalog owns names and permissions; Delta owns the files and their commit log.',
      outroRows: [['version', 0]],
    },
  ],
  merge: [
    'MERGE & history',
    {
      panel: 'Delta',
      lanes: [
        { id: 'me', label: 'laptop', detail: LAPTOP },
        { id: 'cl', label: 'cluster', detail: CLUSTER },
        { id: 'log', label: '_delta_log', detail: STORE },
      ],
      intro: 'Upsert: correct Reykjavik to 9.0 and add Nairobi, in one atomic statement.',
      msgs: [
        { from: 'me', to: 'cl', label: 'MERGE INTO', note: 'Plain SQL MERGE, since the DeltaTable Python API lags behind on Spark Connect.', detail: D('MERGE INTO', 'Matched rows update, unmatched rows insert, all in one transaction.', 'MERGE INTO hello_cities AS target\nUSING hello_cities_updates AS source\nON target.city = source.city\nWHEN MATCHED THEN UPDATE SET\n  target.temperature_c = source.temperature_c\nWHEN NOT MATCHED THEN INSERT (city, temperature_c)\n  VALUES (source.city, source.temperature_c)') },
        { from: 'cl', to: 'log', label: 'read v0', note: 'The writer reads the current snapshot, version 0.' },
        { from: 'cl', to: 'cl', label: 'rewrite file', note: 'The file holding Reykjavik is rewritten with the new value plus Nairobi.' },
        { from: 'cl', to: 'log', label: 'commit 001.json', note: 'Commit 1 removes the old file and adds the new one. It is an atomic put-if-absent.' },
        { from: 'log', to: 'cl', label: 'version 1', reply: true, note: 'Readers now see version 1; a reader mid-query keeps its version 0 snapshot.' },
        { from: 'me', to: 'cl', label: 'DESCRIBE HISTORY', note: 'History lists one row per commit.' },
        { from: 'cl', to: 'me', label: 'v0 WRITE, v1 MERGE', reply: true, note: 'Each row shows version, timestamp and operation.' },
        { from: 'me', to: 'cl', label: 'VERSION AS OF 0', note: 'Time travel reads the old snapshot, because the log still points at the old files until VACUUM removes them.' },
      ],
      outro: 'Two writers committing the same version race; one wins and the other retries against the new snapshot.',
      outroRows: [['versions', 2], ['isolation', 'snapshot', 'ok']],
    },
  ],
  job: [
    'Submit a Job',
    {
      panel: 'Jobs',
      lanes: [
        { id: 'me', label: 'laptop', sub: 'databricks-sdk', detail: LAPTOP },
        { id: 'ws', label: 'workspace', sub: 'Jobs API' },
        { id: 'cl', label: 'cluster', detail: CLUSTER },
      ],
      intro: 'The other model: instead of driving the cluster, ship code to run on it.',
      msgs: [
        { from: 'me', to: 'ws', label: 'import notebook', note: 'Upload the notebook source into the workspace.' },
        { from: 'me', to: 'ws', label: 'jobs.submit', note: 'Submit a one-time run of that notebook on the existing cluster.', detail: D('One-time run', 'Blocks until the run finishes when you call .result().', 'run = w.jobs.submit(run_name="hello-06", tasks=[\n  SubmitTask(task_key="hello",\n    existing_cluster_id=cluster_id,\n    notebook_task=NotebookTask(notebook_path=p))\n]).result()') },
        { from: 'ws', to: 'cl', label: 'start run', note: 'The Jobs service schedules it onto the cluster.' },
        { from: 'cl', to: 'cl', label: 'notebook runs', note: 'The code runs on the cluster itself; your laptop can disconnect.' },
        { from: 'cl', to: 'ws', label: 'SUCCESS', reply: true, note: 'The run reports its result state.' },
        { from: 'ws', to: 'me', label: 'result_state', reply: true, note: 'The SDK call returns once the run is terminal.' },
      ],
      outro: 'Connect for interactive work, Jobs for scheduled production runs that must not depend on a laptop.',
      outroRows: [['runs where', 'cluster', 'ok']],
    },
  ],
});

boardDemo(G, 'stk-delta-log', 'The Delta log', 'How a folder of Parquet files becomes a transactional table: ordered JSON commits, snapshots, time travel and VACUUM.', {
  log: [
    'Commits',
    {
      panel: '_delta_log',
      nodes: [
        N('c0', 40, 60, 290, 130, '000.json', 'add f1', { detail: D('Commit 0', 'Each commit is a JSON file of actions: add or remove data files, change schema.', '{"add": {"path": "part-0000-f1.parquet",\n         "size": 1024, "dataChange": true}}') }),
        N('c1', 355, 60, 290, 130, '001.json', 'remove f1, add f2'),
        N('c2', 670, 60, 290, 130, '002.json', 'add f3'),
        N('f1', 40, 330, 290, 120, 'f1.parquet', 'Reykjavik 7.2'),
        N('f2', 355, 330, 290, 120, 'f2.parquet', 'Reykjavik 9.0, Nairobi'),
        N('f3', 670, 330, 290, 120, 'f3.parquet', 'new rows'),
        N('snap', 40, 580, 920, 130, 'snapshot v2', 'f2 + f3'),
        N('vac', 40, 780, 920, 130, 'VACUUM', 'deletes f1 after retention', { detail: D('VACUUM', 'Removes files no longer referenced by any version inside the retention window. Time travel before that point stops working.', 'VACUUM hello_cities RETAIN 168 HOURS') }),
      ],
      edges: ['c0>f1', 'c1>f2', 'c2>f3'],
      beats: [
        { note: 'A Delta table is Parquet files plus an ordered log of JSON commits.', hot: { c0: 'current', f1: 'write', 'c0>f1': 'accent' }, hide: ['c1', 'c2', 'f2', 'f3', 'snap', 'vac'], rows: [['version', 0]] },
        { note: 'The MERGE commit removes f1 and adds f2, rewriting instead of updating in place.', hot: { c1: 'current', f2: 'write', f1: 'visited', 'c1>f2': 'accent' }, hide: ['c2', 'f3', 'snap', 'vac'], rows: [['version', 1]] },
        { note: 'An append only adds a file.', hot: { c2: 'current', f3: 'write', 'c2>f3': 'accent' }, hide: ['snap', 'vac'], rows: [['version', 2]] },
        { note: 'Replaying the log gives the live file set; old versions are just shorter replays.', hot: { snap: 'ok', f2: 'ok', f3: 'ok' }, hide: ['vac'], rows: [['live files', 2, 'ok']] },
        { note: 'VACUUM finally deletes unreferenced files like f1, which ends time travel to version 0.', hot: { vac: 'warn', f1: 'fail' }, rows: [['time travel to v0', 'gone', 'warn']] },
      ],
    },
  ],
});
