// dbt from spark-line/hello-dbt (group stack-dbt): project/profile, ref() DAG, materializations, incremental, tests, macros.
import { boardDemo, N } from '../machine/lib/board';
import { D, seqDemo } from './lib';

const G = 'stack-dbt';

const PROJECT = D('dbt_project.yml', 'What the project is: name, paths, and default config per model folder. Connection details live elsewhere.', 'name: hello_dbt\nprofile: hello_dbt\nmodel-paths: ["models"]\nmacro-paths: ["macros"]\nmodels:\n  hello_dbt:\n    +materialized: view');
const PROFILE = D('profiles.yml', 'How to connect: adapter and credentials, looked up by the profile name. Kept apart so secrets stay out of the repo.', 'hello_dbt:\n  target: duckdb\n  outputs:\n    duckdb:\n      type: duckdb\n      path: hello_dbt.duckdb\n      threads: 4');
const model = (id: string, x: number, y: number, label: string, sub: string, code: string) => N(id, x, y, 440, 120, label, sub, { detail: D(`${label}.sql`, 'A model is one SELECT. dbt wraps it in CREATE VIEW / TABLE AS for you.', code) });

boardDemo(G, 'stk-dbt', 'dbt models', 'hello-dbt steps: project vs profile, ref() and the model DAG, materializations, schema tests and macros.', {
  project: [
    'Project & profile',
    {
      panel: 'dbt',
      nodes: [
        N('proj', 40, 60, 440, 140, 'dbt_project.yml', 'what: models, config', { detail: PROJECT }),
        N('prof', 520, 60, 440, 140, 'profiles.yml', 'where: duckdb file', { detail: PROFILE }),
        N('models', 40, 320, 440, 130, 'models/*.sql', 'one SELECT each'),
        N('duck', 520, 320, 440, 130, 'hello_dbt.duckdb', 'warehouse'),
        N('run', 40, 580, 920, 140, 'dbt run --profiles-dir .', 'compile → execute', { detail: D('dbt run', 'Compiles Jinja to SQL, sorts models by ref(), and runs them against the target, up to threads in parallel.', 'pip install dbt-duckdb\ndbt run --profiles-dir .\ndbt test --profiles-dir .') }),
      ],
      edges: ['proj>models', 'prof>duck', 'models>duck'],
      beats: [
        { note: 'dbt_project.yml says what the project is and defaults every model to a view.', hot: { proj: 'current', 'proj>models': 'accent' }, hide: ['prof', 'duck', 'run'], rows: [['default', 'view']] },
        { note: 'profiles.yml says where to run: a local DuckDB file with 4 threads.', hot: { prof: 'current', duck: 'write', 'prof>duck': 'accent' }, hide: ['run'], rows: [['adapter', 'duckdb']] },
        { note: 'dbt run compiles each model and executes it in the warehouse. dbt itself moves no data.', hot: { run: 'ok', models: 'ok', 'models>duck': 'accent' }, rows: [['compute', 'in the warehouse', 'ok']] },
      ],
    },
  ],
  ref: [
    'ref() & the DAG',
    {
      panel: 'DAG',
      nodes: [
        model('up', 40, 80, 'dbt_05a_upstream_orders', 'orders rows', 'select * from (values\n  (1, \'Toronto\', 42.50),\n  (2, \'Miami\', 18.00)\n) as t(order_id, city, amount)'),
        model('down', 520, 80, 'dbt_05b_downstream_summary', 'per-city totals', 'select city, count(*) as order_count,\n       sum(amount) as total_amount\nfrom {{ ref(\'dbt_05a_upstream_orders\') }}\ngroup by city'),
        N('compiled', 40, 330, 920, 140, 'compiled SQL', 'from "main"."dbt_05a_upstream_orders"', { detail: D('Compile', 'ref() resolves to the real relation for the current target, dev or prod, view or table.', 'dbt compile --select dbt_05b_downstream_summary\n# from "hello_dbt"."main"."dbt_05a_upstream_orders"') }),
        N('order', 40, 560, 920, 130, 'run order', '05a, then 05b'),
        N('sel', 40, 760, 920, 130, 'dbt run --select +dbt_05b…', '+ pulls in upstream'),
      ],
      edges: ['up>down'],
      beats: [
        { note: 'The downstream model selects from ref(upstream), never from a hardcoded table name.', hot: { down: 'current', up: 'current' }, hide: ['compiled', 'order', 'sel'], rows: [['models', 2]] },
        { note: 'At compile time ref() becomes the real relation name for this target.', hot: { compiled: 'write' }, hide: ['order', 'sel'], rows: [['target', 'duckdb']] },
        { note: 'Every ref() is also an edge, so dbt knows to build 05a before 05b.', hot: { order: 'ok', 'up>down': 'accent' }, hide: ['sel'], rows: [['edges', 1]] },
        { note: 'The + selector runs a model together with everything upstream of it.', hot: { sel: 'current' }, rows: [['selected', '05a, 05b', 'ok']] },
      ],
    },
  ],
  materialize: [
    'Materializations',
    {
      panel: 'Materialization',
      nodes: [
        N('view', 40, 60, 290, 160, 'view', 'recomputed on read', { detail: D('view', 'The default here. Cheap to build, cost paid by every query.', 'create view dbt_01_hello_model as (\n  select 1 as id, \'hello from dbt\' as message)') }),
        N('table', 355, 60, 290, 160, 'table', 'rebuilt each run', { detail: D('table', 'Fast to query, full rebuild each run.', '{{ config(materialized=\'table\') }}') }),
        N('inc', 670, 60, 290, 160, 'incremental', 'only new rows', { detail: D('incremental', 'Full build the first time, then only rows that pass the is_incremental() filter.', "{{ config(materialized='incremental',\n          unique_key='event_id') }}") }),
        N('pick', 40, 320, 920, 150, 'pick by', 'read cost vs build cost vs data size'),
      ],
      edges: [],
      beats: [
        { note: 'A view stores only the query; every read recomputes it.', hot: { view: 'current' }, hide: ['pick'], rows: [['build', 'instant'], ['read', 'full query']] },
        { note: 'A table stores the result and is rebuilt from scratch each run.', hot: { table: 'current' }, hide: ['pick'], rows: [['build', 'full'], ['read', 'fast']] },
        { note: 'An incremental model inserts only new rows after the first build.', hot: { inc: 'current' }, hide: ['pick'], rows: [['build', 'new rows only', 'ok']] },
        { note: 'Views for light transforms, tables for heavy reads, incremental for big append-only sources.', hot: { pick: 'ok' }, rows: [['rule', 'cost-driven']] },
      ],
    },
  ],
  tests: [
    'Schema tests & macros',
    {
      panel: 'Tests',
      nodes: [
        N('schema', 40, 60, 920, 140, 'models/schema.yml', 'not_null · unique', { detail: D('schema.yml', 'Declarative column tests. Each one compiles to a query that returns the failing rows.', 'models:\n  - name: dbt_04_aggregation\n    columns:\n      - name: borough\n        tests: [not_null, unique]') }),
        N('q', 40, 290, 920, 140, 'compiled test', 'rows returned = failures', { detail: D('unique, compiled', 'Zero rows means the test passes.', 'select borough, count(*)\nfrom dbt_04_aggregation\ngroup by borough\nhaving count(*) > 1') }),
        N('macro', 40, 520, 920, 140, 'macro celsius_to_fahrenheit', 'Jinja, reused SQL', { detail: D('Macro', 'A Jinja function that expands into SQL at compile time.', "{% macro celsius_to_fahrenheit(col) %}\n  ({{ col }} * 9.0 / 5.0 + 32)\n{% endmacro %}\nround({{ celsius_to_fahrenheit('temperature_c') }}, 1)") }),
        N('ci', 40, 760, 920, 140, 'dbt build', 'run + test in DAG order'),
      ],
      edges: ['schema>q'],
      beats: [
        { note: 'schema.yml declares expectations about columns.', hot: { schema: 'current' }, hide: ['q', 'macro', 'ci'], rows: [['tests', 5]] },
        { note: 'dbt test turns each into a query that returns the violating rows.', hot: { q: 'write', 'schema>q': 'accent' }, hide: ['macro', 'ci'], rows: [['pass when', '0 rows', 'ok']] },
        { note: 'Macros are Jinja functions that expand to SQL before anything runs.', hot: { macro: 'current' }, hide: ['ci'], rows: [['expands at', 'compile']] },
        { note: 'dbt build runs and tests in DAG order, so a failing test stops its downstream models.', hot: { ci: 'ok' }, rows: [['bad data spreads', 'no', 'ok']] },
      ],
    },
  ],
});

seqDemo(G, 'stk-dbt-incremental', 'dbt incremental, two runs', 'What dbt sends to the warehouse on the first and second run of an incremental model.', {
  runs: [
    'First & second run',
    {
      panel: 'Incremental',
      lanes: [
        { id: 'dbt', label: 'dbt', detail: D('dbt_06_incremental_model', 'Run it twice: 3 rows the first time, 0 the second.', "{{ config(materialized='incremental',\n          unique_key='event_id') }}\nselect * from (values (1,'signup',now()), ...)\n{% if is_incremental() %}\nwhere event_id > (select coalesce(max(event_id), 0)\n                  from {{ this }})\n{% endif %}") },
        { id: 'db', label: 'DuckDB', sub: 'warehouse', detail: PROFILE },
      ],
      intro: 'The model reads 3 events; the table does not exist yet.',
      msgs: [
        { from: 'dbt', to: 'db', label: 'table exists?', note: 'Run 1: dbt checks for the target relation.' },
        { from: 'db', to: 'dbt', label: 'no', reply: true, note: 'It does not exist, so is_incremental() is false and the filter is left out.' },
        { from: 'dbt', to: 'db', label: 'CREATE TABLE AS', note: 'Full build of all rows.' },
        { from: 'db', to: 'dbt', label: '3 rows', reply: true, note: 'The table now holds events 1 to 3.' },
        { from: 'dbt', to: 'db', label: 'table exists?', note: 'Run 2, nothing new upstream.' },
        { from: 'db', to: 'dbt', label: 'yes', reply: true, note: 'Now is_incremental() is true, so the where clause is compiled in.' },
        { from: 'dbt', to: 'db', label: 'select … > max', note: 'Only rows with event_id above the current max are selected into a temp relation.' },
        { from: 'dbt', to: 'db', label: 'MERGE on key', note: 'They are merged on unique_key, so a replayed row updates instead of duplicating.' },
        { from: 'db', to: 'dbt', label: '0 rows', reply: true, note: 'Nothing was newer, so nothing changed, which is exactly the point.' },
      ],
      outro: 'Use --full-refresh to rebuild from scratch after a logic change, or the old rows keep the old logic.',
      outroRows: [['run 1', '3 rows'], ['run 2', '0 rows', 'ok']],
    },
  ],
});
