// Dagster from spark-line/hello-dagster (group stack-dagster): assets, ops/jobs, resources, IO managers, partitions, sensors.
import { boardDemo, N } from '../machine/lib/board';
import { D, seqDemo } from './lib';

const G = 'stack-dagster';

const asset = (id: string, x: number, y: number, label: string, sub: string, code: string) => N(id, x, y, 280, 120, label, sub, { detail: D(`asset ${label}`, 'A software-defined asset: a function that produces a persistent piece of data. Its parameters name its upstream assets.', code) });

boardDemo(G, 'stk-dagster', 'Dagster assets', 'Assets with dependencies from function signatures, ops and jobs, resources, and partitioned assets.', {
  assets: [
    'Assets',
    {
      panel: 'Assets',
      nodes: [
        asset('raw', 40, 80, 'raw_numbers', '[1..5]', '@asset\ndef raw_numbers() -> list[int]:\n    return [1, 2, 3, 4, 5]'),
        asset('dbl', 360, 80, 'doubled', '[2..10]', '@asset\ndef doubled(raw_numbers: list[int]):\n    return [n * 2 for n in raw_numbers]'),
        asset('tot', 680, 80, 'total', '30', '@asset\ndef total(doubled: list[int]) -> int:\n    return sum(doubled)'),
        N('sig', 40, 330, 920, 130, 'the parameter name is the edge', 'doubled(raw_numbers) depends on raw_numbers'),
        N('mat', 40, 560, 920, 130, 'materialize([...])', 'in-process, no daemon', { detail: D('materialize', 'Runs assets in-process for scripts and tests. A deployment instead loads a module-level Definitions object.', 'defs = Definitions(assets=[raw_numbers,\n                          doubled, total])\nmaterialize([raw_numbers, doubled, total])') }),
        N('vs', 40, 780, 920, 130, 'vs Airflow', 'no >>; data, not tasks'),
      ],
      edges: ['raw>dbl', 'dbl>tot'],
      beats: [
        { note: 'Each asset is a function that returns data.', hot: { raw: 'current', dbl: 'current', tot: 'current' }, hide: ['sig', 'mat', 'vs'], rows: [['assets', 3]] },
        { note: 'Dependencies come from parameter names: doubled takes raw_numbers.', hot: { sig: 'current', 'raw>dbl': 'accent', 'dbl>tot': 'accent' }, hide: ['mat', 'vs'], rows: [['edges', 'from signatures']] },
        { note: 'materialize runs them in order and passes each value along.', hot: { mat: 'ok', raw: 'ok', dbl: 'ok', tot: 'ok' }, hide: ['vs'], rows: [['total', 30, 'ok']] },
        { note: 'Airflow schedules tasks wired with >>. Dagster models the data each step produces, and lineage falls out.', hot: { vs: 'current' }, rows: [['model', 'assets']] },
      ],
    },
  ],
  jobs: [
    'Ops & jobs',
    {
      panel: 'Ops',
      nodes: [
        N('e', 40, 80, 280, 120, '@op extract', '[1..5]', { detail: D('Ops', 'The imperative building block under assets, closer to Airflow operators.', '@op\ndef extract() -> list[int]:\n    return [1, 2, 3, 4, 5]') }),
        N('t', 360, 80, 280, 120, '@op transform', 'doubles'),
        N('l', 680, 80, 280, 120, '@op load', 'prints'),
        N('job', 40, 340, 920, 130, '@job hello_job', 'load(transform(extract()))', { detail: D('Jobs', 'A job wires ops into a graph and is what schedules and sensors launch.', '@job\ndef hello_job():\n    load(transform(extract()))\nhello_job.execute_in_process()') }),
        N('when', 40, 580, 920, 150, 'use ops when', 'the step is not a durable dataset'),
      ],
      edges: ['e>t', 't>l'],
      beats: [
        { note: 'Ops are plain steps without a persistent output identity.', hot: { e: 'current', t: 'current', l: 'current' }, hide: ['job', 'when'], rows: [['ops', 3]] },
        { note: 'A job composes them by calls, like TaskFlow.', hot: { job: 'current', 'e>t': 'accent', 't>l': 'accent' }, hide: ['when'], rows: [['run', 'execute_in_process']] },
        { note: 'Prefer assets for data; use ops for side effects like notifications or kicking off external systems.', hot: { when: 'ok' }, rows: [['default', 'assets']] },
      ],
    },
  ],
  resources: [
    'Resources',
    {
      panel: 'Resources',
      nodes: [
        N('a', 355, 60, 290, 120, 'asset greet', 'needs a service'),
        N('r', 40, 320, 420, 140, 'GreetingService', 'greeting="hi"', { detail: D('ConfigurableResource', 'External dependencies (clients, connections) injected by name instead of hardcoded.', 'class GreetingService(ConfigurableResource):\n    greeting: str = "hello"\n    def greet(self, name):\n        return f"{self.greeting}, {name}!"') }),
        N('fake', 540, 320, 420, 140, 'fake in tests', 'same interface'),
        N('defs', 40, 600, 920, 140, 'Definitions(resources=...)', 'binds the name', { detail: D('Binding', 'The asset parameter name greeting_service must match a key in resources.', 'defs = Definitions(assets=[greet], resources={\n  "greeting_service": GreetingService(greeting="hi")})') }),
      ],
      edges: ['r>a', 'fake>a'],
      beats: [
        { note: 'greet takes a greeting_service parameter instead of building one.', hot: { a: 'current' }, hide: ['fake', 'defs'], rows: [['dependency', 'injected']] },
        { note: 'Definitions binds that name to a configured GreetingService.', hot: { r: 'ok', defs: 'current', 'r>a': 'accent' }, hide: ['fake'], rows: [['greeting', 'hi']] },
        { note: 'Tests bind a fake with the same interface, and the asset code never changes.', hot: { fake: 'ok', 'fake>a': 'accent' }, rows: [['asset changes', 0, 'ok']] },
      ],
    },
  ],
  partitions: [
    'Partitions',
    {
      panel: 'Partitions',
      nodes: [
        N('a', 355, 60, 290, 120, 'region_signups', 'partitioned asset', { detail: D('Partitioned asset', 'One definition, many logical slices; the body reads which slice it is running for.', 'regions = StaticPartitionsDefinition(\n    ["us", "eu", "apac"])\n@asset(partitions_def=regions)\ndef region_signups(context):\n    return counts[context.partition_key]') }),
        N('us', 40, 320, 280, 130, 'us', '120'),
        N('eu', 360, 320, 280, 130, 'eu', '80'),
        N('ap', 680, 320, 280, 130, 'apac', '45'),
        N('run', 40, 600, 920, 130, 'materialize(partition_key="eu")', 'one slice'),
      ],
      edges: ['a>us', 'a>eu', 'a>ap'],
      beats: [
        { note: 'A partitioned asset is many slices of one dataset, here one per region.', hot: { a: 'current' }, hide: ['run'], rows: [['partitions', 3]] },
        { note: 'Each slice is materialised and tracked on its own.', hot: { us: 'visited', eu: 'visited', ap: 'visited' }, hide: ['run'], rows: [['status', 'per slice']] },
        { note: 'Materialising eu runs just that slice, which makes backfills and reruns cheap.', hot: { eu: 'ok', run: 'current', 'a>eu': 'accent' }, rows: [['eu signups', 80, 'ok']] },
      ],
    },
  ],
});

const RUNNER = D('Run worker', 'The process executing a run. Assets never touch storage themselves.');
const IOM = D('IO manager', 'Decides how asset outputs are stored and loaded: pickle by default, JSON files here, S3 or a warehouse in real projects.', 'class JSONIOManager(ConfigurableIOManager):\n    base_dir: str\n    def handle_output(self, context, obj):\n        json.dump(obj, open(self._path(context), "w"))\n    def load_input(self, context):\n        return json.load(open(self._path(context)))');

seqDemo(G, 'stk-dagster-runtime', 'Dagster at run time', 'IO manager calls around each asset, and the daemon evaluating schedules and sensors.', {
  io: [
    'IO manager',
    {
      panel: 'IO manager',
      lanes: [
        { id: 'run', label: 'run worker', detail: RUNNER },
        { id: 'io', label: 'IO manager', detail: IOM },
        { id: 'fs', label: 'storage', sub: '*.json' },
      ],
      intro: 'numbers → doubled, with a custom JSON IO manager. Watch who calls whom.',
      msgs: [
        { from: 'run', to: 'run', label: 'numbers()', note: 'The asset function returns [1, 2, 3]. It does not save anything itself.' },
        { from: 'run', to: 'io', label: 'handle_output', note: 'Dagster hands the return value to the IO manager.' },
        { from: 'io', to: 'fs', label: 'write numbers.json', note: 'The IO manager writes it wherever it is configured to.' },
        { from: 'run', to: 'io', label: 'load_input', note: 'Before running doubled, Dagster asks the IO manager for its input.' },
        { from: 'io', to: 'fs', label: 'read numbers.json', note: 'It reads the stored value back.' },
        { from: 'io', to: 'run', label: '[1, 2, 3]', reply: true, note: 'doubled receives a plain list as its parameter.' },
        { from: 'run', to: 'run', label: 'doubled(...)', note: 'The asset computes [2, 4, 6].' },
        { from: 'run', to: 'io', label: 'handle_output', note: 'And its output goes through the IO manager too.' },
      ],
      outro: 'Swapping JSON for S3 or a warehouse changes the IO manager only, never the assets.',
      outroRows: [['asset code changed', 0, 'ok']],
    },
  ],
  sensors: [
    'Schedules & sensors',
    {
      panel: 'Daemon',
      lanes: [
        { id: 'd', label: 'dagster-daemon', detail: D('dagster-daemon', 'Polls schedules and sensors continuously in a deployment. Locally, build_schedule_context/build_sensor_context call them directly.') },
        { id: 's', label: 'schedule/sensor' },
        { id: 'r', label: 'run launcher' },
      ],
      intro: 'Neither a schedule nor a sensor runs anything itself; they only return RunRequests.',
      msgs: [
        { from: 'd', to: 's', label: 'tick 00:00', note: 'At midnight the daemon evaluates daily_schedule.', detail: D('Schedule', 'Cron expression plus the job to launch.', '@schedule(cron_schedule="0 0 * * *", job=hello_job)\ndef daily_schedule(context):\n    return RunRequest(run_key=None)') },
        { from: 's', to: 'd', label: 'RunRequest', reply: true, note: 'It returns a RunRequest.' },
        { from: 'd', to: 'r', label: 'launch hello_job', note: 'The daemon launches the run.' },
        { from: 'd', to: 's', label: 'sensor tick', note: 'Sensors are polled every 30 s by default.' },
        { from: 's', to: 'd', label: 'SkipReason', reply: true, note: 'Nothing new yet, so the sensor skips.' },
        { from: 'd', to: 's', label: 'sensor tick', note: 'Next tick.' },
        { from: 's', to: 'd', label: 'RunRequest(key)', reply: true, note: 'A new file appeared. The run_key dedupes, so the same file never launches twice.' },
        { from: 'd', to: 'r', label: 'launch', note: 'Another run starts.' },
      ],
      outro: 'Test them without a daemon by calling the decorated function with a built context.',
      outroRows: [['runs launched', 2]],
    },
  ],
});
