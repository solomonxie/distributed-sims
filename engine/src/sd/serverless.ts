// Serverless (group sd-serverless): cold starts, event sources, cost crossover, and a standardised deploy (serverless-formation).
import type { Frame, Shape } from '../algo/frames';
import { box, Film, line, panel, text } from '../machine/lib/draw';
import { boardDemo, N } from '../machine/lib/board';
import type { Actor, Lane, SeqMsg } from './lib';
import { sdDemo, seqFrames, serverlessCrossover, serverlessMonthly, timelineFrames } from './lib';

const G = 'sd-serverless';

const COLD: Lane = {
  id: 'cold',
  label: 'cold start',
  segs: [
    { from: 0, to: 120, label: 'fetch code', tone: 'read' },
    { from: 120, to: 330, label: 'runtime boot', tone: 'warn' },
    { from: 330, to: 820, label: 'your init', tone: 'fail' },
    { from: 820, to: 880, label: 'handler', tone: 'ok' },
  ],
  detail: { title: 'Cold start', text: 'No warm instance: the platform downloads the package, boots the runtime and runs your module-level init before the handler.', code: 'import boto3, pandas      # init: runs once per instance\nclient = boto3.client("s3")\n\ndef handler(event, ctx):  # runs per request\n    return {"statusCode": 200}' },
};
const WARM: Lane = { id: 'warm', label: 'warm', segs: [{ from: 0, to: 60, label: 'handler', tone: 'ok' }], detail: { title: 'Warm invoke', text: 'An instance from a recent request is reused, so only the handler runs.' } };
const PROV: Lane = { id: 'prov', label: 'provisioned', segs: [{ from: 0, to: 60, label: 'handler', tone: 'ok' }], detail: { title: 'Provisioned concurrency', text: 'Instances are initialised ahead of time and kept warm, for a fixed hourly price.', code: 'aws lambda put-provisioned-concurrency-config \\\n  --function-name checkout --qualifier live \\\n  --provisioned-concurrent-executions 20' } };
const cold = () =>
  timelineFrames({
    lanes: [COLD, WARM, PROV],
    span: 1000,
    unit: 'ms',
    panel: 'Invoke',
    beats: [
      { note: 'A request arrives after the function sat idle, so there is no warm instance.', at: 120, lanes: ['cold'], rows: [['instances', 0]] },
      { note: 'The runtime boots, then your module-level code runs: imports, clients, config.', at: 820, lanes: ['cold'], rows: [['init', '700 ms', 'warn']] },
      { note: 'Only then does the handler run. The user waited 880 ms for 60 ms of work.', at: 1000, lanes: ['cold'], marks: [[880, 'response']], rows: [['p99 driver', 'cold starts', 'warn']] },
      { note: 'The next request reuses that instance and pays only the handler time.', at: 1000, lanes: ['cold', 'warm'], rows: [['warm', '60 ms', 'ok']] },
      { note: 'Provisioned concurrency keeps instances initialised ahead of time. It buys back latency with part of the cost savings.', at: 1000, lanes: ['cold', 'warm', 'prov'], rows: [['fix', 'provisioned or smaller init', 'ok']] },
    ],
  });

// ---------- event sources ----------
const apigw: Actor = { id: 'gw', label: 'API Gateway', detail: { title: 'API Gateway → Lambda', text: 'A direct connection: the gateway invokes the function synchronously and maps its return value to the HTTP response.' } };
const fn: Actor = { id: 'fn', label: 'Lambda', detail: { title: 'Function', text: 'Stateless per invocation. Anything it must remember goes to a store, and a retried invocation must be safe.' } };
const ddb: Actor = { id: 'db', label: 'DynamoDB' };
const eb: Actor = { id: 'eb', label: 'EventBridge', detail: { title: 'EventBridge schedule', text: 'Cron-style rules that invoke a function or state machine.', code: 'ScheduleExpression: cron(0 3 * * ? *)\nTargets:\n  - Arn: !GetAtt NightlyReport.Arn' } };
const sfn: Actor = { id: 'sf', label: 'Step Functions', detail: { title: 'State machine', text: 'Orchestrates several functions with retries and error branches, so long jobs are split into short steps.' } };
const user: Actor = { id: 'u', label: 'Client' };
const api: SeqMsg[] = [
  { from: 'u', to: 'gw', label: 'POST /orders', note: 'A client calls the HTTP endpoint.' },
  { from: 'gw', to: 'fn', label: 'invoke (sync)', note: 'API Gateway invokes the function with the request as an event.' },
  { from: 'fn', to: 'db', label: 'PutItem', note: 'The function writes to a managed store; it keeps no state of its own.' },
  { from: 'db', to: 'fn', label: 'ok', kind: 'resp', note: 'The write is acknowledged.' },
  { from: 'fn', to: 'gw', label: '{statusCode:201}', kind: 'resp', note: 'The return value becomes the HTTP response.' },
  { from: 'gw', to: 'u', label: '201 Created', kind: 'resp', note: 'Scaling happens per invocation: a second concurrent request gets another instance.' },
];
const sched: SeqMsg[] = [
  { from: 'eb', to: 'sf', label: '03:00 cron fires', note: 'A nightly rule starts a state machine instead of one long function.' },
  { from: 'sf', to: 'fn', label: 'step 1: extract', note: 'Each step is a short invocation, well under the 15 minute limit.' },
  { from: 'fn', to: 'sf', label: 'ok', kind: 'resp', note: 'The state machine records the result.' },
  { from: 'sf', to: 'fn', label: 'step 2: transform', note: 'The next step runs with the previous output as input.' },
  { from: 'fn', to: 'sf', label: 'error (throttled)', kind: 'fail', note: 'A step fails.' },
  { from: 'sf', to: 'fn', label: 'retry after 2 s', note: 'The state machine retries with backoff, as declared in its definition.' },
  { from: 'fn', to: 'sf', label: 'ok', kind: 'resp', note: 'Retries mean every step must be idempotent.' },
];
sdDemo(G, 'sd-sls-events', 'Event sources', 'API Gateway, schedules and Step Functions invoking functions, message by message.', {
  api: ['HTTP API', () => seqFrames({ actors: [user, apigw, fn, ddb], msgs: api, intro: 'The most common shape: an HTTP endpoint backed by a function.', panel: 'Invoke' })],
  schedule: ['Schedule + steps', () => seqFrames({ actors: [eb, sfn, fn], msgs: sched, intro: 'Long jobs become several short, retried steps.', panel: 'Invoke' })],
});

sdDemo(G, 'sd-sls-coldstart', 'Cold starts', 'Where the first-request latency goes, and provisioned concurrency.', { cold: ['Cold vs warm', cold] }, {});

// ---------- cost ----------
const FLEET = 150;
const LEVELS = [1e6, 5e6, 10e6, 30e6, 60e6, 100e6];
function costFrames(avgMs: number, memMb: number, label: string): Frame[] {
  const f = new Film();
  const costs = LEVELS.map((r) => serverlessMonthly(r, avgMs, memMb));
  const cross = serverlessCrossover(avgMs, memMb, FLEET);
  const max = Math.max(FLEET * 1.4, ...costs);
  const y = (v: number) => 840 - (v / max) * 680;
  const draw = (upto: number): Shape[] => {
    const out: Shape[] = [text('tt', 20, 40, `${label}: USD / month`, { align: 'left', size: 26, bold: true })];
    out.push(line('fleet', 60, y(FLEET), 980, y(FLEET), 'warn', { dashed: true, width: 3 }), text('fl', 975, y(FLEET) - 22, `always-on fleet $${FLEET}`, { align: 'right', size: 24, tone: 'warn' }));
    LEVELS.forEach((r, i) => {
      const x = 80 + i * 150;
      out.push(text(`xl${i}`, x + 55, 890, `${r / 1e6}M`, { size: 24, tone: 'muted' }));
      if (i > upto) return;
      const c = costs[i];
      const b = box(`b${i}`, x, y(c), 110, 840 - y(c), c >= 40 ? `$${Math.round(c)}` : undefined, { tone: c > FLEET ? 'fail' : 'ok' });
      if (b.t === 'rect') b.detail = { title: `${r / 1e6}M requests / month`, text: `GB-seconds × price plus a per-request fee: $${c.toFixed(2)} a month at ${avgMs} ms and ${memMb} MB.`, code: `${r / 1e6}M × ${avgMs / 1000} s × ${memMb / 1024} GB\n  × $0.0000166667 per GB-s\n+ ${r / 1e6} × $0.20 per million` };
      out.push(b);
    });
    out.push(text('xa', 500, 940, 'requests per month', { size: 24, tone: 'muted' }));
    return out;
  };
  f.add(`Each request runs ${avgMs} ms at ${memMb} MB. The dashed line is a small always-on fleet.`, draw(-1), panel('Cost', [['fleet', `$${FLEET}/mo`]]));
  LEVELS.forEach((r, i) => f.add(`${r / 1e6}M requests a month cost $${costs[i].toFixed(2)} on per-invocation pricing.`, draw(i), panel('Cost', [['serverless', `$${costs[i].toFixed(2)}`, costs[i] > FLEET ? 'fail' : 'ok'], ['fleet', `$${FLEET}`]])));
  f.add(`The lines cross near ${(cross / 1e6).toFixed(1)}M requests a month. Model your own traffic shape before assuming serverless is cheaper.`, draw(LEVELS.length - 1), panel('Cost', [['crossover', `${(cross / 1e6).toFixed(1)}M req/mo`, 'warn']]));
  return f.frames;
}
sdDemo(G, 'sd-sls-cost', 'Serverless cost crossover', 'Per-invocation pricing against an always-on fleet as traffic grows.', {
  light: ['100 ms, 256 MB', () => costFrames(100, 256, '100 ms × 256 MB')],
  heavy: ['400 ms, 1 GB', () => costFrames(400, 1024, '400 ms × 1 GB')],
});

// ---------- standardised deploy (serverless-formation) ----------
boardDemo(G, 'sd-sls-deploy', 'A serverless deploy standard', 'One template.yaml → enforced naming, least-privilege IAM, content-addressed packages, alias switch and rollback.', {
  deploy: [
    'Deploy',
    {
      panel: 'Deploy',
      nodes: [
        N('tpl', 30, 40, 290, 110, 'template.yaml', 'services + resources', { detail: { title: 'One declarative file', text: 'Services set shared defaults; resources list the functions, APIs, schedules and state machines. Everything else is derived.', code: 'services:\n  lambda:\n    handler: app.svc.handler\nresources:\n  lambda:\n    - name: "func-get-user"\n      handler: app.users.get' } }),
        N('name', 355, 40, 290, 110, 'naming formula', 'stage-sub-app-name', { detail: { title: 'Enforced naming', text: 'Every resource name is derived, so tooling, cost reports and IAM scoping can rely on it.', code: '${Stage}-${SubStage}-${App}-${Function}\n# prod-blue-billing-func-get-user' } }),
        N('pkg', 680, 40, 290, 110, 'package → S3', 'hashed, versioned', { detail: { title: 'Content-addressed packages', text: 'Code and dependency layers are built, hashed and uploaded to fixed paths, so deploys are reproducible.', code: 'lambda-function/${FunctionFullName}/${BUILD_NO}.zip\nlambda-layer-${ManifestMd5}' } }),
        N('iam', 30, 260, 290, 110, 'IAM role', 'least privilege', { detail: { title: 'Least privilege by default', text: 'Each role gets only the statements its resources need. A function that never touches Step Functions never gets states:*.', code: '- Effect: Allow\n  Action: dynamodb:GetItem\n  Resource: arn:aws:dynamodb:*:*:table/users' } }),
        N('ver', 355, 260, 290, 110, 'new version v42', 'immutable'),
        N('alias', 680, 260, 290, 110, 'alias live', 'v41 → v42', { detail: { title: 'Alias switch', text: 'API Gateway points at the alias, not a version. Deploying moves the alias; rollback moves it back.', code: 'aws lambda update-alias --function-name f \\\n  --name live --function-version 42' } }),
        N('api', 355, 480, 290, 110, 'API Gateway', 'invokes :live'),
        N('manual', 30, 700, 940, 110, 'indirect access: ticket', 'S3, databases, Lambda → other services'),
      ],
      edges: ['tpl>name', 'name>pkg', 'tpl>iam', 'pkg>ver', 'ver>alias', 'alias>api'],
      beats: [
        { note: 'A team describes its app in one template.yaml. There is no path to deploy something that skips the standard.', hot: { tpl: 'current' }, hide: ['manual'] },
        { note: 'Names are derived from stage, sub-stage, app and function, never typed by hand.', hot: { name: 'current', 'tpl>name': 'accent' }, hide: ['manual'] },
        { note: 'Code is packaged, hashed and uploaded to a fixed S3 path; the IAM role is generated with only the permissions needed.', hot: { pkg: 'write', iam: 'write', 'name>pkg': 'accent', 'tpl>iam': 'accent' }, hide: ['manual'] },
        { note: 'Deploying publishes an immutable version and then moves the live alias to it.', hot: { ver: 'current', alias: 'ok', 'ver>alias': 'accent', 'alias>api': 'accent' }, hide: ['manual'], rows: [['live', 'v42', 'ok']] },
        { note: 'Direct wiring (gateway, schedules, state machines to functions) is automated. Anything touching data stores goes through a human ticket.', hot: { manual: 'warn' }, rows: [['automated', 'direct connections']] },
      ],
    },
  ],
  rollback: [
    'Rollback',
    {
      panel: 'Deploy',
      nodes: [
        N('v41', 30, 200, 290, 110, 'version v41', 'last good'),
        N('v42', 680, 200, 290, 110, 'version v42', 'errors 12%'),
        N('alias', 355, 420, 290, 110, 'alias live', undefined, { detail: { title: 'Rollback = move the alias', text: 'The API invokes function:live. Pointing live at the previous version is instant.', code: 'aws lambda update-alias --function-name f \\\n  --name live --function-version 41' } }),
        N('api', 355, 640, 290, 110, 'API Gateway'),
      ],
      edges: ['alias>v41', 'alias>v42', 'api>alias'],
      beats: [
        { note: 'Version v42 went live and error rate jumped.', hot: { v42: 'fail', 'alias>v42': 'fail' }, hide: ['alias>v41'], rows: [['errors', '12%', 'fail']] },
        { note: 'Rollback does not redeploy anything: the alias simply points back at v41.', hot: { v41: 'ok', 'alias>v41': 'ok', alias: 'current' }, hide: ['alias>v42'], rows: [['rollback time', 'seconds', 'ok']] },
        { note: 'Old versions are kept for rollback and pruned later, since Lambda has a version storage quota.', hot: { v42: 'visited' }, hide: ['alias>v42'], rows: [['kept', 'last N versions']] },
      ],
    },
  ],
});
