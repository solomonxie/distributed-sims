// Airflow from spark-line/hello-airflow (group stack-airflow): DAG shapes, XCom, retries, sensors.
import { boardDemo, N } from '../machine/lib/board';
import { D, seqDemo } from './lib';

const G = 'stack-airflow';

const task = (id: string, x: number, y: number, label: string, sub?: string, code?: string) => N(id, x, y, 260, 110, label, sub, code ? { detail: D(label, 'A task: one node of the DAG, run by a worker as a task instance per DagRun.', code) } : {});

boardDemo(G, 'stk-airflow-dags', 'Airflow DAGs', 'hello-airflow steps: dependencies with >>, branching with trigger rules, and the TaskFlow API.', {
  deps: [
    'Dependencies',
    {
      panel: 'DAG',
      nodes: [
        N('dag', 40, 40, 920, 120, 'DAG hello_airflow_02', 'schedule=None, catchup=False', { detail: D('A DAG file', 'The file only declares tasks and edges. The shape comes from >>, not from the order tasks are written.', 'with DAG(dag_id="hello_airflow_02",\n         start_date=datetime(2024, 1, 1),\n         schedule=None, catchup=False) as dag:\n    t_extract >> t_transform >> t_load') }),
        task('e', 40, 300, 'extract', 'PythonOperator', 'PythonOperator(task_id="extract",\n               python_callable=extract)'),
        task('t', 370, 300, 'transform', 'PythonOperator'),
        task('l', 700, 300, 'load', 'PythonOperator'),
        N('test', 40, 560, 920, 130, 'dag.test()', 'runs in order, no scheduler', { detail: D('DAG.test()', 'Airflow 2.5+ runs every task in dependency order against a throwaway local DB. That is why each study file runs with plain python3.', 'if __name__ == "__main__":\n    dag.test()') }),
        N('log', 40, 760, 920, 130, 'output', 'extracting → transforming → loading'),
      ],
      edges: ['e>t', 't>l'],
      beats: [
        { note: 'A DAG groups tasks and the edges between them.', hot: { dag: 'current' }, hide: ['test', 'log'], rows: [['tasks', 3]] },
        { note: 'extract >> transform >> load sets the order; defining them in another order changes nothing.', hot: { e: 'write', t: 'write', l: 'write', 'e>t': 'accent', 't>l': 'accent' }, hide: ['test', 'log'], rows: [['edges', 2]] },
        { note: 'dag.test() runs the tasks one after another without any Airflow services.', hot: { test: 'current' }, hide: ['log'], rows: [['scheduler', 'none']] },
        { note: 'Each task ran after its upstream succeeded.', hot: { e: 'ok', t: 'ok', l: 'ok', log: 'ok' }, rows: [['state', 'success', 'ok']] },
      ],
    },
  ],
  branch: [
    'Branching',
    {
      panel: 'DAG',
      nodes: [
        N('b', 355, 40, 290, 120, 'branch', 'BranchPythonOperator', { detail: D('Branching', 'The callable returns the task_id to run next; every other direct downstream task is skipped.', 'def choose_branch():\n    return "high_path" if x > 0.5 else "low_path"\nbranch = BranchPythonOperator(\n    task_id="branch", python_callable=choose_branch)') }),
        task('hi', 40, 320, 'high_path', 'runs'),
        task('lo', 700, 320, 'low_path', 'skipped'),
        N('j', 355, 580, 290, 120, 'join', 'EmptyOperator', { detail: D('trigger_rule', 'The default all_success would mark join skipped, because one upstream is always skipped by design.', 'join = EmptyOperator(\n    task_id="join",\n    trigger_rule="none_failed_min_one_success")') }),
        N('rule', 40, 800, 920, 130, 'trigger_rule', 'none_failed_min_one_success'),
      ],
      edges: ['b>hi', 'b>lo', 'hi>j', 'lo>j'],
      beats: [
        { note: 'branch decides at run time which path to take.', hot: { b: 'current' }, hide: ['rule'], rows: [['paths', 2]] },
        { note: 'It returns high_path, so low_path is skipped.', hot: { hi: 'ok', lo: 'visited', 'b>hi': 'accent' }, hide: ['rule'], rows: [['skipped', 'low_path', 'warn']] },
        { note: 'With the default all_success, join would be skipped too, because one parent was skipped.', hot: { j: 'fail' }, hide: ['rule'], rows: [['join (default)', 'skipped', 'fail']] },
        { note: 'none_failed_min_one_success lets join run after either path.', hot: { j: 'ok', rule: 'ok', 'hi>j': 'accent' }, rows: [['join', 'success', 'ok']] },
      ],
    },
  ],
  taskflow: [
    'TaskFlow API',
    {
      panel: 'TaskFlow',
      nodes: [
        N('dag', 40, 40, 920, 110, '@dag hello_taskflow()', 'decorators'),
        task('e', 40, 250, 'extract()', '→ {"count": 42}', '@task\ndef extract():\n    return {"count": 42}'),
        task('t', 370, 250, 'transform(d)', '→ 84', '@task\ndef transform(data: dict):\n    return data["count"] * 2'),
        task('l', 700, 250, 'load(v)', 'prints 84', '@task\ndef load(value: int):\n    print(f"loaded: {value}")'),
        N('call', 40, 490, 920, 120, 'load(transform(extract()))', 'deps + XCom inferred', { detail: D('Calls become edges', 'Passing one task’s return value into another both adds the edge and wires the XCom push/pull.', '@dag(dag_id="hello_airflow_05", schedule=None,\n     start_date=datetime(2024, 1, 1), catchup=False)\ndef hello_taskflow():\n    load(transform(extract()))') }),
        N('x', 40, 700, 920, 120, 'XCom under the hood', 'return_value stored in the metadata DB'),
      ],
      edges: ['e>t', 't>l'],
      beats: [
        { note: 'TaskFlow replaces operators and >> with decorated Python functions.', hot: { dag: 'current' }, hide: ['call', 'x'], rows: [['style', '@task']] },
        { note: 'Nesting the calls declares both the order and the data flow.', hot: { call: 'current', 'e>t': 'accent', 't>l': 'accent' }, hide: ['x'], rows: [['edges', 'inferred']] },
        { note: 'Return values still travel as XComs, just without explicit xcom_pull.', hot: { x: 'write', e: 'ok', t: 'ok', l: 'ok' }, rows: [['load prints', 84, 'ok']] },
      ],
    },
  ],
});

const SCHED = D('Scheduler', 'A loop over the metadata DB: creates DagRuns, marks task instances scheduled/queued, and reacts to results.', 'airflow scheduler\n# standalone on the node:\nairflow standalone   # :8080, admin/admin');
const DB = D('Metadata DB', 'Every DagRun, task instance state, retry count and XCom value lives here.', 'SELECT task_id, state, try_number\nFROM task_instance\nWHERE dag_id = \'hello_airflow_06\';');
const WORKER = D('Worker', 'Runs the task’s Python callable in its own process, possibly on another machine than the upstream task.');

seqDemo(G, 'stk-airflow-runtime', 'Airflow at run time', 'What the scheduler, metadata DB and workers say to each other for XCom, a retried task and a sensor.', {
  xcom: [
    'XCom',
    {
      panel: 'XCom',
      lanes: [
        { id: 's', label: 'scheduler', detail: SCHED },
        { id: 'w1', label: 'worker A', sub: 'extract', detail: WORKER },
        { id: 'db', label: 'metadata DB', detail: DB },
        { id: 'w2', label: 'worker B', sub: 'load', detail: WORKER },
      ],
      intro: 'extract returns 42 and load needs it, possibly on a different machine.',
      msgs: [
        { from: 's', to: 'w1', label: 'run extract', note: 'The scheduler queues extract and a worker picks it up.' },
        { from: 'w1', to: 'db', label: 'XCom 42', note: 'The return value is pushed as XCom key return_value.', detail: D('Push', 'Return values are pushed automatically.', 'def extract(**context):\n    return 42   # → XCom "return_value"') },
        { from: 'w1', to: 'db', label: 'state=success', note: 'The task instance is marked success.' },
        { from: 's', to: 'db', label: 'poll states', note: 'The scheduler sees extract succeeded, so load’s dependencies are met.' },
        { from: 's', to: 'w2', label: 'run load', note: 'load is queued, maybe to another worker.' },
        { from: 'w2', to: 'db', label: 'xcom_pull', note: 'load reads the value back from the metadata DB.', detail: D('Pull', 'Keep XComs small: they go through the database.', 'value = context["ti"].xcom_pull(\n    task_ids="extract")') },
        { from: 'db', to: 'w2', label: '42', reply: true, note: 'Workers never talk to each other directly. The DB is the hand-off point.' },
        { from: 'w2', to: 'db', label: 'state=success', note: 'load finishes and the DagRun is complete.' },
      ],
      outro: 'XCom is for small values like ids and paths. Large data belongs in storage, with only its location in XCom.',
      outroRows: [['XCom size', 'small', 'warn']],
    },
  ],
  retries: [
    'Retries',
    {
      panel: 'Retries',
      lanes: [
        { id: 's', label: 'scheduler', detail: SCHED },
        { id: 'db', label: 'metadata DB', detail: DB },
        { id: 'w', label: 'worker', detail: WORKER },
      ],
      intro: 'flaky fails on its first attempt; default_args gives it two retries 1 s apart.',
      rows0: [['retries', 2], ['retry_delay', '1 s']],
      msgs: [
        { from: 's', to: 'w', label: 'run flaky #1', note: 'Attempt 1 starts.', detail: D('default_args', 'Applies to every task in the DAG.', 'default_args={"retries": 2,\n              "retry_delay": timedelta(seconds=1)}') },
        { from: 'w', to: 'db', label: 'up_for_retry', ok: false, reply: true, note: 'It raises RuntimeError. With retries left, the state becomes up_for_retry, not failed.' },
        { from: 's', to: 's', label: 'wait 1 s', note: 'The scheduler waits retry_delay before queueing again.' },
        { from: 's', to: 'w', label: 'run flaky #2', note: 'Attempt 2, possibly on a different worker.' },
        { from: 'w', to: 'db', label: 'success', reply: true, note: 'It succeeds; try_number is 2 in the DB.' },
      ],
      outro: 'Retries re-run the whole task, so tasks must be idempotent. Module-level counters, as in the demo, would not survive a real worker change.',
      outroRows: [['attempts', 2], ['result', 'success', 'ok']],
    },
  ],
  sensor: [
    'Schedule & sensor',
    {
      panel: 'Sensor',
      lanes: [
        { id: 's', label: 'scheduler', detail: SCHED },
        { id: 'db', label: 'metadata DB', detail: DB },
        { id: 'w', label: 'worker', detail: WORKER },
      ],
      intro: 'hello_airflow_07 runs hourly; wait_for_ready polls a condition before do_work may start.',
      msgs: [
        { from: 's', to: 'db', label: 'DagRun 10:00', note: 'schedule=timedelta(hours=1): when the interval passes, the scheduler creates a DagRun.', detail: D('Schedule', 'Only a live scheduler honours schedule; dag.test() runs immediately.', 'schedule=timedelta(hours=1), catchup=False') },
        { from: 's', to: 'w', label: 'run sensor', note: 'The sensor task starts on a worker.', detail: D('PythonSensor', 'poke_interval seconds between checks, timeout gives up.', 'PythonSensor(task_id="wait_for_ready",\n             python_callable=check_ready,\n             poke_interval=1, timeout=10)') },
        { from: 'w', to: 'w', label: 'poke: False', note: 'check_ready returns False, so it sleeps poke_interval and checks again, holding its worker slot.' },
        { from: 'w', to: 'w', label: 'poke: True', note: 'The condition holds.' },
        { from: 'w', to: 'db', label: 'success', reply: true, note: 'The sensor succeeds, unblocking downstream.' },
        { from: 's', to: 'w', label: 'run do_work', note: 'do_work runs now that its upstream succeeded.' },
      ],
      outro: 'A poking sensor occupies a worker slot the whole time. Deferrable sensors hand the wait to the triggerer instead.',
      outroRows: [['slot held', 'while poking', 'warn']],
    },
  ],
});
