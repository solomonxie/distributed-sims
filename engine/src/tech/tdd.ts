// Test-driven development (group tdd): red-green-refactor, a TDD'd token bucket, test doubles, pyramid, contracts, properties, retries.
// Behaviour scenes are pictures rebuilt from the knobs under the stage; the code-writing steps stay as line traces.
import type { Detail, Frame, Shape, Tone } from '../algo/frames';
import { arrow, box, dot, Film, panel, text } from '../machine/lib/draw';
import { cap, choice, liveGroup, num, number, pick } from '../machine/lib/live';
import type { P } from '../machine/lib/live';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const liveDemo = liveGroup('tdd');
const D = (title: string, text: string, code?: string): Detail => ({ title, text, code });

const redTrace: Trace = {
  codeTitle: 'backoff.test.js',
  code: ['test("backoff doubles, capped at 1 s", () => {', '  expect(backoff(0)).toBe(100);', '  expect(backoff(1)).toBe(200);', '  expect(backoff(5)).toBe(1000);', '});', '// backoff.js does not exist yet'],
  stackTitle: 'test run',
  details: {
    spec: D('Test first', 'The test is the first caller of the API. Writing it first forces decisions on names, inputs and outputs.'),
    'backoff(0)': D('Fail for the right reason', 'A test that passes before the code exists tests nothing. Check that the failure matches the missing behaviour.'),
    suite: D('One behaviour at a time', 'Keep a list of cases and pick the simplest next one. Each cycle takes minutes, not hours.'),
  },
  steps: [
    { note: 'Start with the behaviour you want, written as a test. No production code exists yet.', line: [0, 1, 2, 3], vars: [['spec', 'doubles, cap 1000 ms', 'write']], out: '' },
    { note: 'Run it. It fails because backoff is undefined, which proves the test can fail.', line: 1, vars: [['spec', 'doubles, cap 1000 ms'], ['backoff(0)', 'ReferenceError', 'fail']], out: 'FAIL backoff doubles, capped at 1 s' },
    { note: 'A red test for the right reason ends this phase. Only now is production code allowed.', line: 5, vars: [['spec', 'doubles, cap 1000 ms'], ['suite', '1 failing', 'fail']], out: 'FAIL backoff doubles, capped at 1 s\nTests: 1 failed' },
  ],
};

const greenTrace: Trace = {
  codeTitle: 'backoff.js',
  code: ['function backoff(n) {', '  if (n === 0) return 100;', '  if (n === 1) return 200;', '  return 1000;', '}', '// next test: backoff(2) === 400'],
  stackTitle: 'test run',
  details: {
    'backoff(0)': D('Least code', 'Hard-coding answers is fine in green. The goal is a passing test fast, not a finished design.'),
    'backoff(2)': D('Triangulation', 'A second example that the fake answer cannot satisfy forces the general rule. Tests pull the design forward.'),
    tests: D('Growing test list', 'Every case added stays in the suite forever and guards against regressions.'),
  },
  steps: [
    { note: 'Write the least code that passes. Hard-coded answers are allowed here.', line: [0, 1, 2, 3, 4], vars: [['backoff(0)', '100', 'ok'], ['backoff(1)', '200', 'ok'], ['backoff(5)', '1000', 'ok']], out: 'PASS 3 assertions' },
    { note: 'Green, but backoff(2) would return 1000. A new test exposes the gap.', line: [3, 5], vars: [['backoff(0)', '100', 'ok'], ['backoff(2)', '1000 ≠ 400', 'fail']], out: 'PASS 3 assertions\nFAIL expected 400, got 1000' },
    { note: 'Each new red forces a slightly more general green. Generalise only when an example demands it.', line: 5, vars: [['tests', '4', 'accent'], ['failing', '1', 'warn']], out: 'PASS 3 assertions\nFAIL expected 400, got 1000' },
  ],
};

const refactorTrace: Trace = {
  codeTitle: 'backoff.js',
  code: ['function backoff(n) {', '  return Math.min(100 * 2 ** n, 1000);', '}', '', 'backoff(0) → 100    backoff(2) → 400', 'backoff(5) → 1000   backoff(9) → 1000'],
  stackTitle: 'test run',
  details: {
    rule: D('Remove duplication', 'The special cases share one rule. Refactoring replaces them with it without changing behaviour.', 'const backoff = n => Math.min(100 * 2 ** n, 1000);'),
    cycle: D('The loop', 'Red: a failing test. Green: the least code to pass. Refactor: improve the design with tests as a safety net.'),
  },
  steps: [
    { note: 'Replace the special cases with the rule they share. The tests stay unchanged.', line: [0, 1, 2], vars: [['rule', '100 · 2ⁿ, cap 1000', 'write']], out: 'PASS 3 assertions\nFAIL expected 400, got 1000' },
    { note: 'Rerun the whole suite. All four cases pass, so behaviour is preserved.', line: [4, 5], vars: [['rule', '100 · 2ⁿ, cap 1000'], ['backoff(0)', '100', 'ok'], ['backoff(2)', '400', 'ok'], ['backoff(5)', '1000', 'ok']], out: 'PASS 4 tests' },
    { note: 'Refactor only on green. If a test turns red, undo the last small step instead of debugging.', line: 1, vars: [['suite', 'green', 'ok'], ['cycle', 'red → green → refactor', 'accent']], out: 'PASS 4 tests' },
  ],
};

const doublesTrace: Trace = {
  codeTitle: 'doubles.test.js',
  code: ['const stub = { now: () => 1000 };                 // canned answer', 'const spy  = { calls: [], inc(m) { this.calls.push(m); } };', 'const mock = expectCall("metrics.inc", "rejected");', 'const fake = new InMemoryStore();                 // real logic, cheap', 'rl.allow(); expect(spy.calls).toEqual(["rejected"]);', 'mock.verify();'],
  stackTitle: 'doubles',
  details: {
    stub: D('Stub', 'Returns fixed answers to feed the code under test. It never fails a test by itself.'),
    spy: D('Spy', 'Records how it was called. The test asserts on the record afterwards.'),
    mock: D('Mock', 'Pre-programmed with expectations and fails if they are not met. It checks interactions, so it couples tests to internals.', 'mock.expects("inc").once().withArgs("rejected");'),
    fake: D('Fake', 'A working, simplified implementation: in-memory store, fake clock, fake network. It checks state, not calls.', 'class InMemoryStore {\n  m = new Map();\n  get(k) { return this.m.get(k); }\n  set(k, v) { this.m.set(k, v); }\n}'),
  },
  steps: [
    { note: 'A stub returns canned answers. It feeds inputs and checks nothing.', line: 0, vars: [['stub', 'now() → 1000', 'read']], out: '' },
    { note: 'A spy records its calls so the test can assert on them afterwards.', line: [1, 4], vars: [['stub', 'now() → 1000'], ['spy', 'calls: ["rejected"]', 'accent']], out: 'spy: 1 call' },
    { note: 'A mock carries expectations and fails verify() if the call never happens.', line: [2, 5], vars: [['stub', 'now() → 1000'], ['spy', 'calls: 1'], ['mock', 'expects inc(rejected)', 'warn']], out: 'spy: 1 call\nmock verified' },
    { note: 'A fake is real, lightweight logic like an in-memory store. Prefer fakes and state checks: mocks break when internals change.', line: 3, vars: [['stub', 'now() → 1000'], ['spy', 'calls: 1'], ['mock', 'verified'], ['fake', 'Map-backed store', 'ok']], out: 'spy: 1 call\nmock verified' },
  ],
};

const contractTrace: Trace = {
  codeTitle: 'checkout.pact.test.js',
  code: ['// consumer: checkout', 'pact.given("user 7 exists")', '  .uponReceiving("GET /users/7")', '  .willRespondWith({ status: 200, body: { id: 7, email: like("a@b.c") } });', '// → pact file published to the broker', '// provider (users) CI: replay pact against the real service'],
  stackTitle: 'contract',
  details: {
    consumer: D('Consumer-driven', 'The consumer states only the fields it reads. The provider may add anything else freely.'),
    pact: D('Pact file', 'A versioned JSON contract stored in a broker, one per consumer and provider pair.'),
    provider: D('Provider verification', 'The real provider replays each request and checks its response against the contract.', 'pact verify --provider users --broker $PACT_BROKER'),
    deploy: D('can-i-deploy', 'Before releasing, ask the broker whether this version satisfies every consumer it will meet in production.'),
  },
  steps: [
    { note: 'The consumer writes down exactly what it needs from the provider. Its own test runs against a mock built from this.', line: [0, 1, 2, 3], vars: [['consumer', 'needs id, email', 'write']], out: '' },
    { note: 'The pact file is published to a broker. It is the contract, versioned with the consumer.', line: 4, vars: [['consumer', 'needs id, email'], ['pact', 'checkout → users v12', 'accent']], out: '' },
    { note: 'The provider’s CI replays the pact against the real service. Renaming email to mail fails here, before deploy.', line: 5, vars: [['consumer', 'needs id, email'], ['pact', 'checkout → users v12'], ['provider', 'body.email missing', 'fail']], out: 'FAIL users vs checkout: $.email' },
    { note: 'Once the provider keeps email, the pact verifies. Both sides deploy independently without a shared e2e environment.', line: 5, vars: [['consumer', 'needs id, email'], ['pact', 'checkout → users v12'], ['provider', 'verified', 'ok'], ['deploy', 'yes', 'ok']], out: 'PASS users vs checkout' },
  ],
};

liveDemo(
  'tdd-cycle',
  'Red, green, refactor',
  'Write a failing test, make it pass with the least code, then clean up while every test stays green.',
  {
    red: ['Red', () => traceFrames(redTrace)],
    green: ['Green', () => traceFrames(greenTrace)],
    refactor: ['Refactor', () => traceFrames(refactorTrace)],
  },
);

// ---------------- token bucket under a fake clock ----------------
const TD: Record<string, Detail> = {
  clock: D('Fake clock', 'Time is a dependency, so the test injects it. The clock moves only when the test says advance(), so results are exact and instant.', 'class FakeClock {\n  t = 0;\n  now() { return this.t; }\n  advance(ms) { this.t += ms; }\n}'),
  bucket: D('Token bucket', 'Holds up to burst tokens and refills at rate per second. Each allowed request spends one token.', 'new TokenBucket({ rate: 1, burst: 2, clock })'),
};

function bucket(tokens: number, burst: number, label: string, tone: Tone, capHint?: number): Shape[] {
  const h = 420;
  const out: Shape[] = [box('bucket', 60, 160, 300, h, undefined, { tone, filled: false }), text('bl', 210, 160 + h + 34, label, { size: 24, mono: true, bold: true, tone })];
  const shown = Math.min(tokens, 12);
  for (let i = 0; i < Math.floor(shown); i++) out.push(dot(`tk${i}`, 120 + (i % 3) * 90, 160 + h - 50 - Math.floor(i / 3) * 90, 'ok', undefined, 24));
  const frac = shown - Math.floor(shown);
  if (frac > 0.01) out.push(box('half', 90 + (Math.floor(shown) % 3) * 90, 160 + h - 84 - Math.floor(Math.floor(shown) / 3) * 90 + 68 * (1 - frac), 60, 68 * frac, undefined, { tone: 'warn' }));
  if (capHint !== undefined) out.push(text('burstl', 210, 140, `burst = ${capHint}`, { size: 22, mono: true, tone: 'muted' }));
  return out;
}

const reqs = (results: boolean[]): Shape[] => results.map((ok, i) => box(`rq${i}`, 440, 160 + i * 110, 520, 90, `allow() → ${ok}`, { mono: true, tone: ok ? 'ok' : 'fail' }));
const clockBox = (t: number): Shape => box('clock', 440, 860, 520, 90, `clock.now() = ${t} ms`, { mono: true, tone: 'accent' });

function clockScene(p: P): Frame[] {
  const burst = num(p.burst, 2, 1, 3);
  const f = new Film();
  const res: boolean[] = [];
  let tokens = burst;
  f.add(`The test owns a fake clock at t = 0 and builds a bucket with rate 1/s and burst ${burst}. It starts full.`, [...cap(`new TokenBucket({ rate: 1, burst: ${burst}, clock })`), ...bucket(tokens, burst, `${tokens} tokens`, 'accent', burst), clockBox(0)], panel('Token bucket', [['tokens', tokens], ['t', '0 ms']]));
  for (let i = 0; i < 3; i++) {
    const ok = tokens >= 1;
    if (ok) tokens -= 1;
    res.push(ok);
    f.add(ok ? `Request ${i + 1} at the same instant spends a token.` : `Request ${i + 1} finds the bucket empty and is rejected. No sleep, no flakiness: the result is exact.`, [...cap('expect(rl.allow()).toBe(' + ok + ');'), ...bucket(tokens, burst, `${tokens} tokens`, ok ? 'accent' : 'fail', burst), ...reqs(res), clockBox(0)], panel('Token bucket', [['tokens', tokens, tokens ? 'ok' : 'warn'], ['allowed', res.filter(Boolean).length]]));
  }
  f.add(`burst ${burst} allows ${Math.min(burst, 3)} of 3 instant requests. Each expectation in the test pins one of these outcomes.`, [...cap('// three expectations, three behaviours'), ...bucket(tokens, burst, `${tokens} tokens`, 'muted', burst), ...reqs(res), clockBox(0)], panel('Token bucket', [['test time', '< 1 ms', 'ok']]));
  return f.frames;
}

function refill(p: P): Frame[] {
  const capped = pick(p.cap, ['yes', 'no'], 'yes') === 'yes';
  const f = new Film();
  const burst = 2;
  let t = 0;
  let tokens = 0;
  const res: boolean[] = [];
  const step = (ms: number) => {
    t += ms;
    tokens = capped ? Math.min(burst, tokens + ms / 1000) : tokens + ms / 1000;
  };
  const show = (stmt: string, note: string, tone: Tone, rows: [string, string | number, Tone?][]) => f.add(note, [...cap(stmt), ...bucket(tokens, burst, `${+tokens.toFixed(2)} tokens`, tone, burst), ...reqs(res), clockBox(t)], panel('Refill', rows));
  show('// bucket just emptied', 'The bucket was just emptied. The rate is 1 token per second.', 'accent', [['tokens', 0]]);
  step(500);
  res.push(false);
  show('clock.advance(500); expect(rl.allow()).toBe(false);', 'Half a second refills half a token. Not enough, so the request fails.', 'warn', [['tokens', 0.5, 'warn']]);
  step(500);
  res.push(true);
  show('clock.advance(500); expect(rl.allow()).toBe(true);', 'Another 500 ms makes one whole token, which the request spends.', 'ok', [['tokens', '1 → 0', 'ok']]);
  tokens -= 1;
  step(10000);
  show('clock.advance(10_000);', capped ? 'Ten idle seconds would add ten tokens, but the bucket is capped at burst: it holds 2.' : 'Without a cap, ten idle seconds add ten tokens: the bucket now allows a burst of ten.', capped ? 'ok' : 'fail', [['tokens', +tokens.toFixed(1), capped ? 'ok' : 'fail']]);
  show(`expect(rl.tokens()).toBe(${burst});`, capped ? 'The cap test passes. Three rules, three tests, and a limiter no bigger than they demand.' : `This test fails: tokens is ${tokens}, not 2. Red tells you exactly which rule the code is missing: Math.min(burst, …).`, capped ? 'ok' : 'fail', [['test', capped ? 'green' : 'red', capped ? 'ok' : 'fail']]);
  return f.frames;
}

liveDemo(
  'tdd-limiter',
  'TDD a rate limiter',
  'Drive a token bucket test by test with an injected fake clock: the burst you allow, refill by elapsed time, and the cap test that catches a missing Math.min. Then the kinds of test double.',
  {
    clock: ['Fake clock', clockScene],
    refill: ['Refill & cap', refill],
    doubles: ['Test doubles', () => traceFrames(doublesTrace)],
  },
  [number('burst', 'burst', 1, 3, 2, { for: ['clock'] }), choice('cap', 'cap at burst', ['yes', 'no'], 'yes', { for: ['refill'], labels: ['implemented', 'forgotten'] })],
  TD,
);

// ---------------- testing distributed systems ----------------
const SHAPES = ['pyramid', 'cone'];

function pyramid(p: P): Frame[] {
  const cone = pick(p.shape, SHAPES, 'pyramid') === 'cone';
  const layers = cone
    ? [
        { id: 'unit', n: 200, s: 0.0025, flaky: 0, tone: 'ok' as Tone },
        { id: 'integration', n: 60, s: 0.8, flaky: 0.01, tone: 'accent' as Tone },
        { id: 'contract', n: 0, s: 0.75, flaky: 0, tone: 'protocol' as Tone },
        { id: 'e2e', n: 300, s: 90, flaky: 0.03, tone: 'warn' as Tone },
      ]
    : [
        { id: 'unit', n: 2000, s: 0.0025, flaky: 0, tone: 'ok' as Tone },
        { id: 'integration', n: 150, s: 0.8, flaky: 0.01, tone: 'accent' as Tone },
        { id: 'contract', n: 40, s: 0.75, flaky: 0, tone: 'protocol' as Tone },
        { id: 'e2e', n: 10, s: 90, flaky: 0.03, tone: 'warn' as Tone },
      ];
  const f = new Film();
  const maxN = Math.max(...layers.map((l) => l.n));
  const mins = (l: (typeof layers)[0]) => (l.n * l.s) / 60;
  const scene = (upto: number, stmt: string): Shape[] => {
    const out: Shape[] = [...cap(stmt)];
    layers.slice(0, upto + 1).forEach((l, k) => {
      const w = Math.max(320, (900 * Math.sqrt(l.n)) / Math.sqrt(maxN));
      const y = 820 - k * 170;
      out.push(box(`L${l.id}`, 500 - w / 2, y, w, 140, `${l.id} · ${l.n}`, { sub: `${mins(l) < 1 ? `${Math.round(mins(l) * 60)} s` : `${Math.round(mins(l))} min`}${l.flaky ? ` · ${Math.round(l.flaky * 100)} % flaky` : ''}`, mono: true, tone: l.n ? l.tone : 'muted', dashed: !l.n }));
    });
    return out;
  };
  const total = layers.reduce((a, l) => a + mins(l), 0);
  const pFlaky = 1 - layers.reduce((a, l) => a * (1 - l.flaky) ** Math.min(l.n, 50), 1);
  const notes = cone
    ? ['A thin layer of unit tests: whatever was easy to test in isolation.', 'Some integration tests against a real database.', 'No contract tests: service boundaries are checked only end to end.', 'Hundreds of end-to-end tests through the whole stack. The cone is upside down.']
    : ['Unit tests are the wide base: in memory, milliseconds each, never flaky.', 'Integration tests use a real database or broker. Slower, but they catch wiring bugs units miss.', 'Contract tests pin each service boundary cheaply, without starting the other side.', 'A handful of end-to-end tests prove the whole stack works.'];
  layers.forEach((l, k) => f.add(notes[k], scene(k, `${l.id}: ${l.n} tests`), panel('Suite', [['tests', layers.slice(0, k + 1).reduce((a, x) => a + x.n, 0)], ['runtime', `${Math.round(layers.slice(0, k + 1).reduce((a, x) => a + mins(x), 0))} min`]])));
  f.add(cone ? `The suite takes about ${Math.round(total)} minutes and a run fails for no reason ${Math.round(pFlaky * 100)} % of the time. People stop trusting red.` : `About ${Math.round(total)} minutes in total and almost never flaky. Fast feedback at the bottom, a few slow checks at the top.`, scene(3, cone ? '// ice-cream cone' : '// test pyramid'), panel('Suite', [['runtime', `${Math.round(total)} min`, cone ? 'fail' : 'ok'], ['flaky runs', `${Math.round(pFlaky * 100)} %`, cone ? 'fail' : 'ok']]));
  return f.frames;
}

function property(p: P): Frame[] {
  const fixed = pick(p.fix, ['no', 'yes'], 'no') === 'yes';
  const f = new Film();
  const row = (id: string, y: number, label: string, xs: number[], tone: Tone, bad?: number): Shape[] => [text(`${id}l`, 40, y + 48, label, { align: 'left', size: 22, mono: true, bold: true, tone: 'muted' }), ...xs.map((x, i) => box(`${id}${i}`, 230 + i * 150, y, 135, 76, String(x), { mono: true, tone: i === bad ? 'fail' : tone }))];
  const rule = box('rule', 40, 110, 920, 80, '∀ gaps: 0 ≤ tokens ≤ burst', { mono: true, tone: 'accent' });
  f.add('State a rule that must hold for every input, not one example: whatever the gaps between requests, tokens stay between 0 and burst.', [...cap('fc.property(fc.array(fc.integer({ min: -1000, max: 5000 })), …)'), rule], panel('Property', [['inputs', 'generated']]));
  f.add('The generator throws random gap sequences at it, including the clock stepping backwards. The first runs pass.', [...cap('run 1 … 57'), rule, ...row('a', 230, 'run 1', [120, 40, 900], 'ok'), ...row('b', 330, 'run 2', [3000, 0], 'ok'), ...row('c', 430, 'run 57', [7, 4999, 12, 300], 'ok')], panel('Property', [['runs', 57, 'ok']]));
  if (fixed) {
    f.add('With negative elapsed time ignored, the backwards steps are harmless. All 100 runs pass, and [-1] stays as a pinned example test.', [...cap('if (elapsed < 0) elapsed = 0;'), rule, ...row('d', 230, 'run 58', [300, -1, 20, 4000], 'ok'), ...row('e', 330, 'run 100', [-800, 15, 2], 'ok')], panel('Property', [['runs', 100, 'ok'], ['failures', 0, 'ok']]));
    f.add('A property test explores inputs nobody would write by hand; the example tests document the cases you already know.', [...cap('fc.assert(…)   // 100 / 100'), rule, ...row('d', 230, 'run 58', [300, -1, 20, 4000], 'ok')], panel('Property', [['status', 'green', 'ok']]));
    return f.frames;
  }
  f.add('Run 58 breaks the rule: after this sequence tokens is negative. But the input is noisy: which part matters?', [...cap('run 58 failed: tokens = -0.001'), rule, ...row('d', 230, 'run 58', [300, -1, 20, 4000], 'fail', 1)], panel('Property', [['failed at', 'run 58', 'fail']]));
  f.add('Shrinking tries smaller inputs that still fail: drop elements, move numbers toward zero.', [...cap('shrinking…'), rule, ...row('d', 230, 'run 58', [300, -1, 20, 4000], 'visited', 1), ...row('e', 330, 'shrink', [-1, 20], 'warn', 0), ...row('g', 430, 'shrink', [-1], 'fail', 0)], panel('Property', [['shrink steps', 6]]));
  f.add('The minimal case is one backward clock step of 1 ms. Now the bug is obvious: negative elapsed time drains the bucket.', [...cap('counterexample: [-1]'), rule, ...row('g', 330, 'minimal', [-1], 'fail', 0)], panel('Property', [['minimal input', '[-1]', 'fail'], ['fix', 'clamp elapsed ≥ 0', 'ok']]));
  return f.frames;
}

function retries(p: P): Frame[] {
  const keyed = pick(p.key, ['yes', 'no'], 'yes') === 'yes';
  const f = new Film();
  const L = { c: 160, n: 500, s: 840 };
  const lanes: Shape[] = [box('lc', 60, 120, 200, 70, 'client', { mono: true, tone: 'accent' }), box('ln', 400, 120, 200, 70, 'fake net', { mono: true, tone: 'muted' }), box('ls', 740, 120, 200, 70, 'server', { mono: true, tone: 'protocol' })];
  const msg = (id: string, from: number, to: number, y: number, label: string, tone: Tone, dashed = false): Shape[] => [arrow(id, from, y, to, y + 30, tone, { dashed, width: 4 }), text(`${id}t`, (from + to) / 2, y - 6, label, { size: 20, mono: true, tone })];
  const ledger = (n: number): Shape => box('ledger', 700, 860, 280, 90, `charges: ${n}`, { mono: true, tone: n > 1 ? 'fail' : 'ok' });
  const s1 = [...msg('m1', L.c, L.s, 240, `charge(${keyed ? 'key k-42' : 'no key'}, 10)`, 'accent')];
  const s2 = [...msg('m2', L.s, L.n, 340, 'ok #1', 'ok'), text('drop', L.n, 400, 'reply dropped', { size: 22, bold: true, tone: 'fail' })];
  const s3 = [text('m3t', 60, 476, 'clock.advance(200) → timeout fires', { align: 'left', size: 20, mono: true, tone: 'warn' }), ...msg('m4', L.c, L.s, 560, `retry(${keyed ? 'key k-42' : 'no key'}, 10)`, 'warn')];
  f.add('The fake network will drop the first reply. The test controls the network and the clock, so this failure happens on every run.', [...cap('new FakeNetwork({ dropReplies: 1 })'), ...lanes, ...s1, ledger(1)], panel('Retry test', [['charges', 1]]));
  f.add('The server charged, but the reply is lost: the client cannot tell this from a request that never arrived.', [...cap('// server charged, client heard nothing'), ...lanes, ...s1, ...s2, ledger(1)], panel('Retry test', [['client knows', 'nothing', 'warn']]));
  f.add('Advancing the fake clock fires the 200 ms timeout instantly, and the client retries.', [...cap('clock.advance(200);'), ...lanes, ...s1, ...s2, ...s3, ledger(1)], panel('Retry test', [['retries', 1]]));
  const s4 = keyed ? msg('m5', L.s, L.c, 660, 'stored result #1', 'ok') : msg('m5', L.s, L.c, 660, 'ok #2', 'fail');
  f.add(keyed ? 'The server has already seen k-42 and returns the stored result. No second charge.' : 'With no key the server cannot recognise the retry and charges again.', [...cap(keyed ? 'expect(server.charges).toBe(1);   // green' : 'expect(server.charges).toBe(1);   // red: 2'), ...lanes, ...s1, ...s2, ...s3, ...s4, ledger(keyed ? 1 : 2)], panel('Retry test', [['charges', keyed ? 1 : 2, keyed ? 'ok' : 'fail']]));
  f.add(keyed ? 'Remove the key and this test goes red. Timeouts, retries and deduplication, tested deterministically in milliseconds.' : 'The test caught a double charge in milliseconds, with no real network. Add an idempotency key and it goes green.', [...cap('// deterministic distributed test'), ...lanes, ...s1, ...s2, ...s3, ...s4, ledger(keyed ? 1 : 2)], panel('Retry test', [['test time', '< 5 ms', 'ok']]));
  return f.frames;
}

liveDemo(
  'tdd-dist',
  'Testing distributed systems',
  'A test pyramid against an ice-cream cone (runtime and flakiness), consumer-driven contracts, a property test shrinking its counterexample, and a deterministic retry test that catches a double charge.',
  {
    pyramid: ['Test pyramid', pyramid],
    contract: ['Contract tests', () => traceFrames(contractTrace)],
    property: ['Property-based', property],
    retries: ['Retries & timeouts', retries],
  },
  [choice('shape', 'suite shape', SHAPES, 'pyramid', { for: ['pyramid'], labels: ['pyramid', 'ice-cream cone'] }), choice('fix', 'clamp elapsed ≥ 0', ['no', 'yes'], 'no', { for: ['property'], labels: ['not yet', 'fixed'] }), choice('key', 'idempotency key', ['yes', 'no'], 'yes', { for: ['retries'] })],
  {
    Lunit: D('Unit tests', 'In-memory, milliseconds each. The base of the suite.'),
    Le2e: D('End-to-end tests', 'Drive the whole stack. Valuable but slow and flaky; keep them few.'),
    rule: D('Property', 'An invariant checked against hundreds of generated inputs. On failure the framework shrinks the input to a minimal counterexample.', 'fc.assert(fc.property(arb, x => invariant(x)))'),
    ledger: D('Idempotency key', 'The client sends the same key on every retry; the server stores the result per key and replays it instead of charging again.'),
  },
);
