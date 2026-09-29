// Telemetry (group sd-telemetry): three pillars + OpenTelemetry, trace context propagation, percentiles & cardinality, Prometheus, ELK.
import type { Frame, Shape } from '../algo/frames';
import { box, Film, line, panel, text } from '../machine/lib/draw';
import { boardDemo, N } from '../machine/lib/board';
import type { Actor, SeqMsg } from './lib';
import { cardinality, percentile, sdDemo, seqFrames } from './lib';

const G = 'sd-telemetry';

boardDemo(G, 'sd-tel-pillars', 'Logs, metrics, traces', 'The three pillars and where each one goes, with the OpenTelemetry collector in the middle.', {
  pillars: [
    'Three pillars',
    {
      panel: 'Telemetry',
      nodes: [
        N('svc', 355, 30, 290, 110, 'checkout service', 'OTel SDK', { detail: { title: 'Instrument once', text: 'The OpenTelemetry SDK emits traces, metrics and logs in one wire format (OTLP), independent of the backend.', code: 'tracer = trace.get_tracer("checkout")\nwith tracer.start_as_current_span("charge"):\n    charge(card)\nrequests.add(1, {"route": "/pay"})' } }),
        N('col', 355, 230, 290, 110, 'OTel collector', 'batch · sample · route', { detail: { title: 'Collector', text: 'A standalone process that receives OTLP, batches, filters and samples, then fans out to backends. Sampling policy lives here, not in app code.', code: 'processors:\n  tail_sampling:\n    policies: [{ type: status_code,\n      status_code: { status_codes: [ERROR] } }]' } }),
        N('logs', 30, 450, 290, 110, 'logs', 'Loki / Elasticsearch', { detail: { title: 'Logs: why', text: 'Discrete events with context. Structured, with a trace id in every line.', code: '{"level":"error","msg":"payment failed",\n "order_id":123,"trace_id":"4bf92f..."}' } }),
        N('met', 355, 450, 290, 110, 'metrics', 'Prometheus', { detail: { title: 'Metrics: that', text: 'Cheap numeric aggregates for dashboards and alerts. Expensive when labels have many values.' } }),
        N('trc', 680, 450, 290, 110, 'traces', 'Tempo / Jaeger', { detail: { title: 'Traces: where', text: 'One request as a tree of timed spans across services.' } }),
        N('graf', 355, 680, 290, 110, 'Grafana', 'one pane', { detail: { title: 'One pane of glass', text: 'Queries every backend through data source plugins. Dashboards are JSON in git, reviewed like code.' } }),
      ],
      edges: ['svc>col', 'col>logs', 'col>met', 'col>trc', 'logs>graf', 'met>graf', 'trc>graf'],
      beats: [
        { note: 'A service instrumented with OpenTelemetry sends all three signals to a local collector.', hot: { svc: 'current', 'svc>col': 'accent' } },
        { note: 'Metrics tell you that something is wrong: p99 latency jumped.', hot: { met: 'current', 'col>met': 'accent' }, rows: [['answers', 'is it healthy?']] },
        { note: 'Traces tell you where: the payment span inside checkout is slow.', hot: { trc: 'current', 'col>trc': 'accent' }, rows: [['answers', 'which hop?']] },
        { note: 'Logs tell you why: the exact error, joined by the same trace id.', hot: { logs: 'current', 'col>logs': 'accent' }, rows: [['answers', 'what exactly?']] },
        { note: 'Grafana puts them side by side. None of the three replaces the others.', hot: { graf: 'ok', 'logs>graf': 'accent', 'met>graf': 'accent', 'trc>graf': 'accent' } },
      ],
    },
  ],
  elk: [
    'ELK pipeline',
    {
      panel: 'Logs',
      nodes: [
        N('fb', 30, 60, 290, 110, 'Filebeat', 'on every host', { detail: { title: 'Beats', text: 'Lightweight shippers next to the source: Filebeat for log files, Metricbeat for host metrics.' } }),
        N('ls', 355, 60, 290, 110, 'Logstash', 'parse · enrich', { detail: { title: 'Logstash', text: 'Parses and enriches events. Grok patterns on free text are brittle; structured logs at the source avoid them.', code: 'filter {\n  grok { match => { "message" =>\n    "%{IP:client} %{WORD:method} %{URIPATH:path}" } }\n}' } }),
        N('hot', 680, 60, 290, 110, 'ES hot', 'SSD, 7 days'),
        N('warm', 680, 280, 290, 110, 'ES warm', 'HDD, 30 days'),
        N('cold', 680, 500, 290, 110, 'ES cold', 'snapshots, 1 year'),
        N('del', 680, 720, 290, 110, 'delete'),
        N('kb', 30, 400, 290, 110, 'Kibana', 'search, dashboards'),
      ],
      edges: ['fb>ls', 'ls>hot', 'hot>warm', 'warm>cold', 'cold>del', 'kb>hot'],
      beats: [
        { note: 'Filebeat tails log files on each host and ships them.', hot: { fb: 'current', 'fb>ls': 'accent' } },
        { note: 'Logstash parses lines into fields and enriches them before indexing.', hot: { ls: 'current', 'ls>hot': 'accent' } },
        { note: 'Elasticsearch indexes every field for fast search by trace id, user or message.', hot: { hot: 'write' }, rows: [['good at', 'high-cardinality search']] },
        { note: 'Index lifecycle management moves indices hot → warm → cold → deleted. Unmanaged retention is a classic runaway bill.', hot: { warm: 'current', cold: 'current', del: 'warn', 'hot>warm': 'accent', 'warm>cold': 'accent', 'cold>del': 'accent' }, rows: [['retention', 'a decision, not a default', 'warn']] },
        { note: 'Kibana searches it. Watch the cluster itself: a red cluster drops logs exactly during incidents.', hot: { kb: 'ok', 'kb>hot': 'accent' } },
      ],
    },
  ],
});

// ---------- trace context ----------
const cl: Actor = { id: 'cl', label: 'Browser' };
const gw: Actor = { id: 'gw', label: 'Gateway', detail: { title: 'Starts the trace', text: 'Creates a trace id if none came in and passes it on in the W3C traceparent header.', code: 'traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736\n             -00f067aa0ba902b7-01\n# version-traceid-parentspan-flags' } };
const ord: Actor = { id: 'or', label: 'Orders' };
const pay: Actor = { id: 'pa', label: 'Payments' };
const q: Actor = { id: 'q', label: 'Queue', detail: { title: 'Async boundary', text: 'Nothing propagates context across a queue unless the producer writes it into message headers and the consumer reads it back.', code: 'headers = {}\ninject(headers)          # OTel propagator\nproducer.send(topic, value, headers=headers)' } };
const mail: Actor = { id: 'ml', label: 'Mailer' };
const sync: SeqMsg[] = [
  { from: 'cl', to: 'gw', label: 'POST /checkout', note: 'A request enters with no trace context.' },
  { from: 'gw', to: 'or', label: 'traceparent 4bf9…/a1', note: 'The gateway starts trace 4bf9 and span a1, and forwards the header.' },
  { from: 'or', to: 'pa', label: 'traceparent 4bf9…/b2', note: 'Orders opens child span b2 and passes the same trace id on.' },
  { from: 'pa', to: 'or', label: '200 (span 380 ms)', kind: 'resp', note: 'Payments reports its span back to the collector with parent b2.' },
  { from: 'or', to: 'q', label: 'publish + headers 4bf9', kind: 'async', note: 'Orders injects the context into the message headers on publish.' },
  { from: 'q', to: 'ml', label: 'deliver + headers', kind: 'async', note: 'The mailer extracts it, so its span joins the same trace minutes later.' },
  { from: 'or', to: 'gw', label: '201', kind: 'resp', note: 'The trace now shows every hop, sync and async, under one id.' },
];
const broken: SeqMsg[] = [
  { from: 'cl', to: 'gw', label: 'POST /checkout', note: 'Same request, but the queue client drops headers.' },
  { from: 'gw', to: 'or', label: 'traceparent 4bf9', note: 'The synchronous part propagates fine.' },
  { from: 'or', to: 'q', label: 'publish (no headers)', kind: 'fail', note: 'The publish carries no context.' },
  { from: 'q', to: 'ml', label: 'deliver', kind: 'async', note: 'The mailer receives a message with no trace id.' },
  { from: 'ml', to: 'ml', label: 'new trace 77c0', kind: 'self', note: 'It starts an unrelated trace, so the email step can’t be tied back to the order.' },
  { from: 'or', to: 'gw', label: '201', kind: 'resp', note: 'Async boundaries need deliberate wiring. They are exactly where “why did this happen” goes dark.' },
];
sdDemo(G, 'sd-tel-trace', 'Trace context propagation', 'traceparent across services and a queue, and how one missing header truncates the trace.', {
  sync: ['Propagated', () => seqFrames({ actors: [cl, gw, ord, pay, q, mail], msgs: sync, intro: 'One trace id travels with the request, even through the queue.', panel: 'Trace' })],
  broken: ['Broken at queue', () => seqFrames({ actors: [cl, gw, ord, q, mail], msgs: broken, intro: 'The same flow with a queue that drops headers.', panel: 'Trace' })],
});

// ---------- percentiles & cardinality ----------
/** 100 latencies: 94 fast, 6 slow — the shape that makes averages lie. */
export const LATENCIES = Array.from({ length: 100 }, (_, i) => (i < 94 ? 40 + ((i * 7) % 30) : 2000 + i * 40));

function pctFrames(): Frame[] {
  const f = new Film();
  const xs = LATENCIES;
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  const p50 = percentile(xs, 50);
  const p95 = percentile(xs, 95);
  const p99 = percentile(xs, 99);
  const bars = (hl: 'none' | 'avg' | 'p50' | 'p99'): Shape[] => {
    const out: Shape[] = [text('t', 20, 40, '100 requests, sorted by latency', { align: 'left', size: 26, bold: true })];
    const sorted = [...xs].sort((a, b) => a - b);
    const max = sorted[sorted.length - 1];
    sorted.forEach((v, i) => {
      const h = Math.max(4, (v / max) * 560);
      out.push(box(`b${i}`, 40 + i * 9.2, 700 - h, 7, h, undefined, { tone: v > 1000 ? 'fail' : 'accent' }));
    });
    const mark = (id: string, v: number, lbl: string, tone: 'warn' | 'ok' | 'fail', row: number) => {
      const y = 700 - (v / max) * 560;
      out.push(line(id, 40, y, 960, y, tone, { dashed: true, width: 3 }), text(`${id}t`, 960, y - 20 - row * 0, lbl, { align: 'right', size: 26, tone, bold: true }));
    };
    if (hl === 'avg' || hl === 'p99') mark('avg', avg, `avg ${Math.round(avg)} ms`, 'warn', 0);
    if (hl === 'p50' || hl === 'p99') mark('p50', p50, `p50 ${p50} ms`, 'ok', 1);
    if (hl === 'p99') mark('p99', p99, `p99 ${p99} ms`, 'fail', 2);
    const leg = box('leg', 40, 780, 920, 140, 'alert on p95/p99, split by success and error', { sub: 'histogram_quantile(0.99, rate(..._bucket[5m]))', tone: hl === 'p99' ? 'current' : 'default' });
    if (leg.t === 'rect') leg.detail = { title: 'p99 from a histogram', text: 'Histograms store bucket counts; PromQL estimates the quantile across all instances.', code: 'histogram_quantile(0.99,\n  sum by (le) (rate(\n    http_request_duration_seconds_bucket[5m])))' };
    out.push(leg);
    return out;
  };
  const rows = (): [string, string, ('ok' | 'warn' | 'fail')?][] => [['avg', `${Math.round(avg)} ms`, 'warn'], ['p50', `${p50} ms`, 'ok'], ['p95', `${p95} ms`], ['p99', `${p99} ms`, 'fail']];
  f.add('94 requests are fast and 6 are very slow, which is a typical tail.', bars('none'), panel('Latency', []));
  f.add(`The average says ${Math.round(avg)} ms, which describes nobody: fast requests were faster, slow ones far slower.`, bars('avg'), panel('Latency', rows().slice(0, 1)));
  f.add(`The median is ${p50} ms, the typical request.`, bars('p50'), panel('Latency', rows().slice(0, 2)));
  f.add(`p99 is ${p99} ms: one user in a hundred waits that long. Those are often your biggest customers or coldest caches.`, bars('p99'), panel('Latency', rows()));
  return f.frames;
}

function cardFrames(): Frame[] {
  const f = new Film();
  const steps: [string, number, string][] = [
    ['method', 4, 'GET POST PUT DELETE'],
    ['status', 6, '200 201 400 404 500 503'],
    ['route', 40, '/users/:id template'],
    ['region', 5, 'us-east … ap-south'],
    ['user_id', 200000, 'every user!'],
  ];
  const draw = (upto: number): Shape[] => {
    const out: Shape[] = [text('t', 20, 40, 'http_requests_total{...}', { align: 'left', size: 28, bold: true, tone: 'current' })];
    steps.forEach(([name, n, sub], i) => {
      const on = i <= upto;
      out.push(box(`l${i}`, 40, 100 + i * 130, 560, 110, `${name}: ${n.toLocaleString('en-US')} values`, { sub, tone: !on ? 'visited' : name === 'user_id' ? 'fail' : 'accent', dashed: !on }));
    });
    const series = cardinality(steps.slice(0, upto + 1).map((s) => s[1]));
    const tot = box('tot', 640, 360, 320, 180, series.toLocaleString('en-US'), { sub: 'time series', tone: series > 1e6 ? 'fail' : 'ok' });
    if (tot.t === 'rect') tot.detail = { title: 'Series = product of label values', text: 'Every distinct label combination is its own series held in memory. Unbounded labels belong in logs and traces.', code: 'count({__name__=~".+"})         # total series\ntopk(10, count by (__name__)({__name__=~".+"}))' };
    out.push(tot);
    return out;
  };
  steps.forEach(([name], i) => {
    const series = cardinality(steps.slice(0, i + 1).map((s) => s[1]));
    const note = name === 'user_id' ? `Adding user_id makes ${series.toLocaleString('en-US')} series. Prometheus holds each in memory and falls over.` : `With ${name} it is ${series.toLocaleString('en-US')} series: labels multiply, they don’t add.`;
    f.add(note, draw(i), panel('Cardinality', [['series', series.toLocaleString('en-US'), series > 1e6 ? 'fail' : 'ok']]));
  });
  f.add('Keep metric labels bounded. Put per-user and per-request ids in traces and logs, which are built for that.', draw(3), panel('Cardinality', [['series', cardinality(steps.slice(0, 4).map((s) => s[1])).toLocaleString('en-US'), 'ok']]));
  return f.frames;
}

sdDemo(G, 'sd-tel-metrics', 'Percentiles & cardinality', 'Why p99 beats the average, and how one unbounded label explodes a metrics backend.', {
  percentiles: ['Percentiles', pctFrames],
  cardinality: ['Cardinality', cardFrames],
});

// ---------- Prometheus ----------
const prom: Actor = { id: 'pr', label: 'Prometheus', detail: { title: 'Pull model', text: 'Prometheus scrapes each target’s /metrics on an interval. A failed scrape is itself a signal (up == 0).', code: 'scrape_configs:\n  - job_name: api\n    scrape_interval: 15s\n    kubernetes_sd_configs: [{ role: pod }]' } };
const tgt: Actor = { id: 'tg', label: 'api pod', detail: { title: '/metrics', text: 'A plain text endpoint the app exposes. Counters, gauges and histogram buckets.', code: '# TYPE http_requests_total counter\nhttp_requests_total{code="200"} 10423\nhttp_requests_total{code="500"} 17' } };
const k8s: Actor = { id: 'sd', label: 'K8s API', sub: 'discovery' };
const am: Actor = { id: 'am', label: 'Alertmanager', detail: { title: 'Alertmanager', text: 'Rules fire in Prometheus; dedupe, grouping, silences and routing to on-call live here.', code: 'route:\n  group_by: [alertname, service]\n  receiver: pagerduty\n  repeat_interval: 4h' } };
const pd: Actor = { id: 'pd', label: 'PagerDuty' };
const scrape: SeqMsg[] = [
  { from: 'pr', to: 'sd', label: 'list pods job=api', note: 'Service discovery tells Prometheus which targets exist right now.' },
  { from: 'sd', to: 'pr', label: '3 pods', kind: 'resp', note: 'New pods are picked up automatically as they start.' },
  { from: 'pr', to: 'tg', label: 'GET /metrics', note: 'Every 15 s Prometheus pulls the current values.' },
  { from: 'tg', to: 'pr', label: '200 text format', kind: 'resp', note: 'The pod just prints counters; no batching or retries in the app.' },
  { from: 'pr', to: 'pr', label: 'rule: p99 > 300ms 10m', kind: 'self', note: 'Recording and alert rules run on the stored series.' },
  { from: 'pr', to: 'am', label: 'alert FIRING', note: 'The rule has been true for 10 minutes, so an alert fires.' },
  { from: 'am', to: 'am', label: 'group + dedupe', kind: 'self', note: 'Alertmanager groups the same alert from three pods into one.' },
  { from: 'am', to: 'pd', label: 'page on-call', note: 'One page, routed to the owning team. Alert on symptoms users feel, not on CPU.' },
];
sdDemo(G, 'sd-tel-prom', 'Prometheus scrape to page', 'Discovery, scrape, rule evaluation and Alertmanager routing, message by message.', {
  scrape: ['Scrape → alert', () => seqFrames({ actors: [prom, k8s, tgt, am, pd], msgs: scrape, intro: 'From a metric on a pod to a page on someone’s phone.', panel: 'Prometheus' })],
});
