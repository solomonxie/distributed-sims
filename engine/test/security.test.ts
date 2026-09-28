import { createRun } from '../src';
import { doc, edge, node, testCatalog } from './fixtures';

const authDoc = (mode: 'session' | 'jwt', extra: Record<string, unknown> = {}, src = {}) =>
  doc(
    [node('c', 'web-client'), node('mw', 'auth-middleware'), node('api'), node('idp', 'identity-provider', { mode, ...extra })],
    [edge('c', 'mw'), edge('mw', 'idp', { timeoutMs: 300 }), edge('mw', 'api')],
    { sources: [{ id: 's', node: 'c', shape: { kind: 'constant', rps: 200 }, ...src }] },
  );

const availAfterIdpDown = (mode: 'session' | 'jwt') => {
  const r = createRun(authDoc(mode), { catalog: testCatalog, seed: 4 });
  r.step(3000);
  expect(r.snapshot().system.availability).toBeGreaterThan(99);
  r.fire({ kind: 'kill', target: 'idp' });
  r.step(10_000);
  return r.snapshot().system.availability;
};

test('JWT survives IdP outage while session mode fails', () => {
  expect(availAfterIdpDown('session')).toBeLessThan(10);
  expect(availAfterIdpDown('jwt')).toBeGreaterThan(97);
});

test('JWT tokens expire over one TTL while the IdP is down', () => {
  const r = createRun(authDoc('jwt', { tokenTtlSec: 10 }), { catalog: testCatalog, seed: 4 });
  r.step(2000);
  r.fire({ kind: 'kill', target: 'idp' });
  r.step(14_000);
  expect(r.snapshot().system.availability).toBeLessThan(10);
});

test('expired tokens are rejected with auth', () => {
  const r = createRun(authDoc('jwt', {}, { expiredAuth: 0.2 }), { catalog: testCatalog, seed: 5 });
  r.step(6000);
  const p = r.series('mw').slice(-1)[0];
  expect(p.errs.auth! / p.rps).toBeGreaterThan(0.1);
  expect(p.errs.auth! / p.rps).toBeLessThan(0.3);
});

test('key rotation causes JWKS validation errors until the cache refreshes', () => {
  const r = createRun(authDoc('jwt', { jwksTtlSec: 6, tokenTtlSec: 10 }), { catalog: testCatalog, seed: 6 });
  r.step(7000);
  r.fire({ kind: 'key-rotation', target: 'idp' });
  r.step(11_000);
  expect(r.snapshot().anomalies['jwks-miss'] ?? 0).toBeGreaterThan(0);
  r.step(14_000);
  const before = r.snapshot().anomalies['jwks-miss'];
  r.step(20_000);
  expect(r.snapshot().anomalies['jwks-miss']).toBe(before);
});

test('revoked JWTs are accepted until expiry unless a denylist is used', () => {
  const run = (denylist: boolean) => {
    const r = createRun(authDoc('jwt', { denylist }), { catalog: testCatalog, seed: 8 });
    r.step(2000);
    r.fire({ kind: 'credential-leak', target: 'idp', params: { pct: 0.1 } });
    r.step(6000);
    return { accepted: r.snapshot().anomalies['revoked-token-accepted'] ?? 0, auth: r.series('mw').slice(-1)[0].errs.auth ?? 0 };
  };
  expect(run(false).accepted).toBeGreaterThan(0);
  const d = run(true);
  expect(d.accepted).toBe(0);
  expect(d.auth).toBeGreaterThan(0);
});

const kmsDoc = (dataKeyCache: boolean) =>
  doc([node('c', 'web-client'), node('api', 'service', { instances: 20 }), node('kms', 'kms', { quotaRps: 1000, dataKeyCache, slots: 256 })], [edge('c', 'api'), edge('api', 'kms')]);

test('KMS throttles under burst without data-key caching', () => {
  const run = (cache: boolean) => {
    const r = createRun(kmsDoc(cache), { catalog: testCatalog, seed: 3 });
    r.step(2000);
    r.fire({ kind: 'traffic', action: 'burst', params: { x: 20 }, durationSec: 5 });
    r.step(5000);
    return r.series('kms').slice(-1)[0].errs['429'] ?? 0;
  };
  expect(run(false)).toBeGreaterThan(1000);
  expect(run(true)).toBe(0);
});

test('secret rotation causes brief auth errors', () => {
  const d = doc([node('c', 'web-client'), node('api'), node('sec', 'secrets-store', { rotationWindowSec: 3 })], [edge('c', 'api'), edge('api', 'sec')]);
  const r = createRun(d, { catalog: testCatalog, seed: 2 });
  r.step(2000);
  r.fire({ kind: 'key-rotation', target: 'sec' });
  r.step(3000);
  expect(r.series('sec').slice(-1)[0].errs.auth ?? 0).toBeGreaterThan(0);
  r.step(8000);
  expect(r.series('sec').slice(-1)[0].errs.auth ?? 0).toBe(0);
});
