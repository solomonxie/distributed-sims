// Test-driven development (group tdd): red-green-refactor, a TDD'd token bucket, test doubles, pyramid, contracts, properties, retries.
import type { Detail } from '../algo/frames';
import { machineDemo } from '../machine/lib/draw';
import { traceFrames } from '../machine/lib/trace';
import type { Trace } from '../machine/lib/trace';

const G = 'tdd';
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

// ---------------- red, green, refactor ----------------
traceDemo('tdd-cycle', 'Red, green, refactor', 'Write a failing test, make it pass with the least code, then clean up while every test stays green.', {
  red: [
    'Red',
    {
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
    },
  ],
  green: [
    'Green',
    {
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
    },
  ],
  refactor: [
    'Refactor',
    {
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
    },
  ],
});

// ---------------- TDD a token-bucket rate limiter ----------------
traceDemo('tdd-limiter', 'TDD a rate limiter', 'Drive a token bucket test by test with an injected fake clock, and pick the right test double.', {
  clock: [
    'Fake clock',
    {
      codeTitle: 'limiter.test.js',
      code: ['class FakeClock { t = 0; now() { return this.t; } advance(ms) { this.t += ms; } }', 'const clock = new FakeClock();', 'const rl = new TokenBucket({ rate: 1, burst: 2, clock });', 'expect(rl.allow()).toBe(true);', 'expect(rl.allow()).toBe(true);', 'expect(rl.allow()).toBe(false);'],
      stackTitle: 'state',
      details: {
        'clock.t': D('Injected clock', 'Real time makes tests slow and flaky. A fake clock turns time into an input the test controls.', 'interface Clock { now(): number }'),
        tokens: D('Token bucket', 'Tokens refill at rate per second, up to burst. Each request spends one or is rejected.'),
        'allow()': D('Deterministic', 'Same inputs, same result on every run. No sleeps and no timing windows.'),
      },
      steps: [
        { note: 'Time is a dependency, so inject it. The test owns a fake clock that moves only when told.', line: [0, 1], vars: [['clock.t', '0 ms', 'write']], out: '' },
        { note: 'The bucket starts full with burst = 2 tokens.', line: 2, vars: [['clock.t', '0 ms'], ['tokens', '2', 'accent']], out: '' },
        { note: 'Two requests at the same instant spend both tokens.', line: [3, 4], vars: [['clock.t', '0 ms'], ['tokens', '0', 'warn']], out: 'true\ntrue' },
        { note: 'The third is rejected. No sleep and no flakiness: the result is exact.', line: 5, vars: [['clock.t', '0 ms'], ['tokens', '0'], ['allow()', 'false', 'fail']], out: 'true\ntrue\nfalse' },
      ],
    },
  ],
  refill: [
    'Refill & cap',
    {
      codeTitle: 'limiter.test.js',
      code: ['clock.advance(500);', 'expect(rl.allow()).toBe(false);   // half a token', 'clock.advance(500);', 'expect(rl.allow()).toBe(true);    // one token', 'clock.advance(10_000);', 'expect(rl.tokens()).toBe(2);      // capped at burst'],
      stackTitle: 'state',
      details: {
        tokens: D('Refill formula', 'Each failing test added one rule: spend, refill, cap.', 'const dt = clock.now() - last;\ntokens = Math.min(burst, tokens + dt * rate / 1000);'),
        'clock.t': D('Jump, don’t wait', 'advance(10_000) runs instantly. A real-time test would sleep for 10 seconds.'),
      },
      steps: [
        { note: 'Half a second refills half a token. That is not enough, so the request fails.', line: [0, 1], vars: [['clock.t', '500 ms', 'write'], ['tokens', '0.5', 'read'], ['allow()', 'false', 'fail']], out: 'false' },
        { note: 'Another 500 ms makes one whole token. The request passes and spends it.', line: [2, 3], vars: [['clock.t', '1000 ms', 'write'], ['tokens', '0', 'read'], ['allow()', 'true', 'ok']], out: 'false\ntrue' },
        { note: 'A long idle gap must not overfill the bucket. This test drives the cap into the code.', line: [4, 5], vars: [['clock.t', '11000 ms', 'write'], ['tokens', '2', 'ok']], out: 'false\ntrue\n2' },
        { note: 'Three rules, three tests, and a limiter no bigger than they demand.', line: 5, vars: [['clock.t', '11000 ms'], ['tokens', '2', 'ok'], ['suite', '5 passing', 'ok']], out: 'PASS limiter (5)' },
      ],
    },
  ],
  doubles: [
    'Test doubles',
    {
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
    },
  ],
});

// ---------------- testing distributed systems ----------------
traceDemo('tdd-dist', 'Testing distributed systems', 'The test pyramid, consumer-driven contracts, property-based tests with shrinking, and deterministic retry and timeout tests.', {
  pyramid: [
    'Test pyramid',
    {
      codeTitle: 'ci.yaml',
      code: ['unit:         2000 tests   ~5 s', 'integration:   150 tests   ~2 min    # real DB, broker', 'contract:       40 tests   ~30 s', 'e2e:            10 tests   ~15 min   # full stack'],
      stackTitle: 'layers',
      details: {
        unit: D('Unit', 'In-memory, milliseconds each, no network. Run on every save.'),
        integration: D('Integration', 'Real database or broker in a container. Catches SQL, serialisation and wiring bugs.', 'docker run -d -p 5432:5432 postgres:16'),
        e2e: D('End-to-end', 'Drives the deployed system like a user. Slow and flaky from timing, shared data and network.'),
        contract: D('Contract', 'Checks the API between two services without running both. Cheap cover for the widest gap.'),
      },
      steps: [
        { note: 'Unit tests are the wide base. They run in memory in milliseconds and do not flake.', line: 0, vars: [['unit', '2000 · 5 s', 'ok']], out: '' },
        { note: 'Integration tests use a real database or broker. Slower, but they catch wiring bugs units miss.', line: 1, vars: [['unit', '2000 · 5 s', 'ok'], ['integration', '150 · 2 min', 'accent']], out: '' },
        { note: 'End-to-end tests drive the whole stack. Keep them few: they are slow and flaky.', line: 3, vars: [['unit', '2000 · 5 s', 'ok'], ['integration', '150 · 2 min', 'accent'], ['e2e', '10 · 15 min', 'warn']], out: '' },
        { note: 'Contract tests cover service boundaries cheaply. Many fast tests at the bottom, few slow ones at the top.', line: 2, vars: [['unit', '2000 · 5 s', 'ok'], ['integration', '150 · 2 min', 'accent'], ['contract', '40 · 30 s', 'ok'], ['e2e', '10 · 15 min', 'warn']], out: 'pipeline: 18 min' },
      ],
    },
  ],
  contract: [
    'Contract tests',
    {
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
    },
  ],
  property: [
    'Property-based',
    {
      codeTitle: 'limiter.prop.test.js',
      code: ['fc.assert(fc.property(', '  fc.array(fc.integer({ min: -1000, max: 5000 })),   // clock may step back', '  gaps => {', '    const rl = bucketAfter(gaps);', '    return rl.tokens() >= 0 && rl.tokens() <= 2;', '  }));'],
      stackTitle: 'fast-check',
      details: {
        property: D('Property', 'A statement true for every input, instead of one hand-picked example.'),
        input: D('Shrinking', 'The framework repeatedly simplifies a failing input, removing elements and moving numbers toward zero, while it still fails.'),
        run: D('Generators', 'Random but seeded, so a failure can be replayed exactly.', 'fc.assert(prop, { seed: 1337, numRuns: 1000 });'),
      },
      steps: [
        { note: 'State a rule that must hold for all inputs. Tokens always stay between 0 and burst.', line: [0, 4], vars: [['property', '0 ≤ tokens ≤ 2', 'write']], out: '' },
        { note: 'A generator produces random gap sequences, including clock steps backwards. Run 58 breaks the rule.', line: [1, 3], vars: [['property', '0 ≤ tokens ≤ 2'], ['run', '58 / 100', 'accent'], ['input', '[12, 4100, -377, 9]', 'fail']], out: 'tokens = -0.37' },
        { note: 'Shrinking simplifies the input while it still fails. The minimal case is one backward step of 1 ms.', line: 1, vars: [['property', '0 ≤ tokens ≤ 2'], ['run', '58 / 100'], ['input', '[-1]', 'warn']], out: 'tokens = -0.37\nshrunk: [-1]' },
        { note: 'Fix: ignore negative elapsed time, and keep [-1] as an example test. The property now holds on every run.', line: 4, vars: [['property', '0 ≤ tokens ≤ 2', 'ok'], ['run', '100 / 100', 'ok']], out: 'OK, passed 100 tests' },
      ],
    },
  ],
  retries: [
    'Retries & idempotency',
    {
      codeTitle: 'payments.test.js',
      code: ['const net = new FakeNetwork({ dropReplies: 1 });', 'const pay = new Client(net, { timeout: 200, retries: 3, clock });', 'const p = pay.charge({ key: "k-42", amount: 10 });', 'clock.advance(200);                     // first reply lost', 'await p;', 'expect(net.attempts).toBe(2);', 'expect(ledger.charges("k-42")).toBe(1);'],
      stackTitle: 'state',
      details: {
        attempts: D('Fake network', 'Drops, delays or duplicates messages on command. Failures become repeatable test inputs.'),
        key: D('Idempotency key', 'The server stores the result per key and returns it on a retry instead of redoing the work.', 'if (seen.has(key)) return seen.get(key);'),
        charges: D('Assert the outcome', 'The test checks the ledger, not the calls. Exactly one charge, however many attempts.'),
        'without key': D('Why the key matters', 'A timeout does not mean the request failed. Retrying a non-idempotent call can apply it twice.'),
      },
      steps: [
        { note: 'The fake network drops the first reply. The server charged, but the client never hears back.', line: [0, 1, 2], vars: [['attempts', '1', 'accent'], ['charges', '1', 'write']], out: '' },
        { note: 'Advancing the fake clock fires the 200 ms timeout instantly. The client retries with the same key.', line: 3, vars: [['attempts', '2', 'warn'], ['key', 'k-42', 'read'], ['charges', '1']], out: 'timeout, retry 1' },
        { note: 'The server has seen k-42 and returns the stored result. No second charge.', line: [4, 5, 6], vars: [['attempts', '2'], ['key', 'k-42'], ['charges', '1', 'ok']], out: 'timeout, retry 1\nPASS' },
        { note: 'Remove the key and this test goes red with two charges. Timeouts, retries and dedupe are tested in milliseconds.', line: 6, vars: [['charges', '1 with key', 'ok'], ['without key', '2 charges', 'fail']], out: 'timeout, retry 1\nPASS' },
      ],
    },
  ],
});
