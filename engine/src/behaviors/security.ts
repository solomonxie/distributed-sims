// Security: identity provider (session vs JWT), auth middleware, KMS, secrets store, TLS cost.
import type { NodeLogic, Req, SimNode } from '../node';
import type { EdgeRt } from '../world';
import type { Msg, Op, Reply } from '../types';
import { register } from './registry';
import { RateWindow } from './stores';

// ---------- identity-provider ----------

interface IdpState {
  keyVersion: number;
  rotatedAt: number;
  revokedAt: number;
  revokedPct: number;
}

const idpState = new WeakMap<SimNode, IdpState>();

function stateOf(idp: SimNode): IdpState {
  let s = idpState.get(idp);
  if (!s) idpState.set(idp, (s = { keyVersion: 1, rotatedAt: -Infinity, revokedAt: -Infinity, revokedPct: 0 }));
  return s;
}

/**
 * Issues tokens (login, optional MFA) and validates sessions.
 * Kinds: 'auth.validate' (session lookup), 'auth.jwks' (key fetch), anything else = login.
 */
export function identityProvider(n: SimNode): NodeLogic {
  const st = stateOf(n);
  return {
    handles: kind => kind.startsWith('auth.'),
    onRequest(req: Req) {
      const m = req.msg;
      const w = m.weight;
      if (m.kind === 'auth.jwks') return n.process(w, n.serviceTime('p50Ms', 'p99Ms', 5, 30), ok => req.reply(ok ? { ok: true, version: st.keyVersion } : { ok: false, err: '503' }));
      if (m.kind === 'auth.validate') {
        return n.process(w, n.serviceTime('p50Ms', 'p99Ms', 5, 30), ok => {
          if (!ok) return req.reply({ ok: false, err: '503' });
          if (m.auth === 'expired' || isRevoked(n, st)) return req.reply({ ok: false, err: 'auth' });
          req.reply({ ok: true });
        });
      }
      // login: password check (+ MFA round trip for some users)
      let ms = n.serviceTime('loginP50Ms', 'loginP99Ms', 80, 400);
      if (n.rng.chance(n.num('mfaPct', 0) / 100)) ms += n.rng.lognormal(n.num('mfaMs', 8000), n.num('mfaMs', 8000) * 3);
      n.process(w, ms, ok => req.reply(ok ? { ok: true, version: st.keyVersion } : { ok: false, err: '503' }));
    },
    onChaos(kind, p, heal) {
      if (kind === 'key-rotation') {
        if (!heal) {
          st.keyVersion++;
          st.rotatedAt = n.now;
          n.log('protocol', `${n.name} rotated signing key → kid v${st.keyVersion}`);
        }
        return true;
      }
      if (kind === 'credential-leak' || kind === 'revoke-tokens') {
        st.revokedAt = heal ? -Infinity : n.now;
        st.revokedPct = heal ? 0 : Number(p.pct ?? 0.05);
        if (!heal) n.log('protocol', `${n.name} revoked ${Math.round(st.revokedPct * 100)}% of tokens`);
        return true;
      }
      return false;
    },
    view() {
      return { badges: [{ text: n.str('mode', 'jwt').toUpperCase(), tone: 'accent' }, { text: `kid v${st.keyVersion}`, tone: 'muted' }] };
    },
  };
}

function isRevoked(idp: SimNode, st: IdpState): boolean {
  return st.revokedPct > 0 && idp.rng.chance(st.revokedPct);
}

interface JwtCache {
  keyVersion: number;
  fetchedAt: number;
  fetching: boolean;
}
const jwtCaches = new WeakMap<SimNode, JwtCache>();

/** The IdP this node talks to (first out-edge to an identity-provider). */
export function idpEdge(n: SimNode): EdgeRt | undefined {
  return n.outEdges(e => n.world.nodes.get(e.to)?.type === 'identity-provider')[0];
}

/** Sync out-edges that aren't the IdP (what a service forwards to after auth). */
export function appEdges(n: SimNode, op?: Op): EdgeRt[] {
  return n.syncOut(op).filter(e => n.world.nodes.get(e.to)?.type !== 'identity-provider');
}

/**
 * Validate the caller's credential; for gateways/services. `next(null)` = allowed, else the error reply.
 * Mode = node knob `authMode` (session|jwt) or, if 'inherit'/unset, the IdP's `mode`.
 *  - session: every request is looked up at the IdP → IdP outage fails requests.
 *  - jwt: verified locally with cached JWKS (jwksTtlSec); IdP outage only bites as tokens expire
 *    (clients can't refresh); revoked tokens pass until expiry unless `denylist` (extra lookup).
 *  - key-rotation on the IdP: new-kid tokens fail validation until the JWKS cache refreshes.
 */
export function authCheck(n: SimNode, req: Req, next: (err: Reply | null) => void) {
  const m = req.msg;
  const e = idpEdge(n);
  if (!e) return next(m.auth === 'expired' ? { ok: false, err: 'auth' } : null);
  const idp = n.world.nodes.get(e.to)!;
  if (m.auth === 'expired') return next({ ok: false, err: 'auth' });
  const own = n.str<string>('authMode', 'inherit');
  const mode = own === 'session' || own === 'jwt' ? own : idp.str<string>('mode', 'jwt');
  if (mode === 'session') {
    return n.call(e, { ...n.world.child(m, n.id, e.to), kind: 'auth.validate' }, r => next(r.ok ? null : r));
  }
  const st = stateOf(idp);
  const ttlMs = idp.num('tokenTtlSec', 900) * 1000;
  let c = jwtCaches.get(n);
  if (!c) jwtCaches.set(n, (c = { keyVersion: st.keyVersion, fetchedAt: n.now, fetching: false }));
  // refresh JWKS in the background when stale (keep using the old keys meanwhile)
  const jwksTtl = idp.num('jwksTtlSec', 300) * 1000;
  if (n.now - c.fetchedAt > jwksTtl && !c.fetching) {
    c.fetching = true;
    const cache = c;
    n.call(e, n.world.newMsg({ from: n.id, to: e.to, kind: 'auth.jwks', weight: 1, op: 'read' }), r => {
      cache.fetching = false;
      if (r.ok) {
        cache.keyVersion = r.version ?? st.keyVersion;
        cache.fetchedAt = n.now;
      }
    });
  }
  // tokens signed with a kid we don't have yet: share = tokens issued since rotation
  if (c.keyVersion < st.keyVersion) {
    const share = Math.min(1, (n.now - st.rotatedAt) / Math.max(1, ttlMs));
    if (n.rng.chance(share)) {
      n.anomaly('jwks-miss', m.weight);
      return next({ ok: false, err: 'auth' });
    }
  }
  // IdP down: clients can't refresh, so tokens expire over one TTL
  if (!idp.up && n.rng.chance(Math.min(1, (n.now - idp.downSince) / Math.max(1, ttlMs)))) return next({ ok: false, err: 'auth' });
  const verify = n.num('jwtVerifyMs', 0.1) + (idp.bool('denylist', false) ? n.num('denylistMs', 1) : 0);
  n.timer(verify, () => {
    const revoked = n.now - st.revokedAt < ttlMs && n.rng.chance(st.revokedPct);
    if (revoked) {
      if (idp.bool('denylist', false)) return next({ ok: false, err: 'auth' });
      n.anomaly('revoked-token-accepted', m.weight);
    }
    next(null);
  });
}

/** Auth middleware / proxy: authCheck, then forward to app edges. */
export function authMiddleware(n: SimNode): NodeLogic {
  return {
    onRequest(req: Req) {
      n.process(req.msg.weight, n.serviceTime('p50Ms', 'p99Ms', 0.5, 3) + tlsInCost(n, req.msg), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        authCheck(n, req, err => {
          if (err) return req.reply(err);
          n.forward(req, appEdges(n, req.msg.op), 'one');
        });
      });
    },
  };
}

// ---------- TLS / mTLS ----------

/**
 * Per-request CPU ms for TLS on an edge (mtls flag): record crypto + amortised handshakes.
 * Services add this to their service time: `n.serviceTime() + tlsCost(edge)`.
 */
export function tlsCost(edge: EdgeRt | undefined, handshakeMs = 1.5, newConnPct = 0.05): number {
  if (!edge?.cfg.mtls) return 0;
  return 0.05 + handshakeMs * newConnPct;
}

/** tlsCost of the edge a message arrived on. */
export function tlsInCost(n: SimNode, msg: Msg): number {
  const e = n.world.out.get(msg.from)?.find(x => x.to === n.id);
  return tlsCost(e);
}

// ---------- kms ----------

/**
 * Envelope encryption: each request = GenerateDataKey/Decrypt call, capped by a shared quota (429).
 * dataKeyCache: callers reuse a data key for `keyReuse` messages → only 1/keyReuse reaches KMS.
 * key-rotation chaos starts a re-encrypt job that eats half the quota.
 */
export function kms(n: SimNode): NodeLogic {
  const quota = new RateWindow();
  let reencLeft = 0;
  let cacheSeq = 0;
  return {
    onStart() {
      n.every(1000, () => {
        if (reencLeft > 0) {
          const burn = Math.min(reencLeft, n.num('quotaRps', 5500) * 0.5);
          quota.add(n.now, burn);
          reencLeft -= burn;
        }
        n.gauge('reencryptLeft', Math.round(reencLeft));
        n.gauge('kmsCallsPerSec', Math.round(quota.last));
      });
    },
    onRequest(req: Req) {
      const w = req.msg.weight;
      let real = w;
      if (n.bool('dataKeyCache', false)) {
        const reuse = Math.max(1, n.num('keyReuse', 1000));
        const before = Math.floor(cacheSeq / reuse);
        cacheSeq += w;
        real = Math.floor(cacheSeq / reuse) - before;
        if (real <= 0) return req.reply({ ok: true }); // served from the caller's data-key cache
      }
      if (!quota.take(n.now, real, n.num('quotaRps', 5500))) {
        n.gauge('throttled', 1);
        return req.reply({ ok: false, err: '429' });
      }
      n.process(real, n.serviceTime('p50Ms', 'p99Ms', 3, 15), ok => req.reply(ok ? { ok: true } : { ok: false, err: '503' }));
    },
    onChaos(kind, p, heal) {
      if (kind !== 'key-rotation') return false;
      if (!heal) reencLeft = Number(p.objects ?? n.num('reencryptObjects', 100_000));
      return true;
    },
    view() {
      return reencLeft > 0 ? { badges: [{ text: 're-encrypting', tone: 'warn' }] } : {};
    },
  };
}

// ---------- secrets-store ----------

/** Secret reads with a quota; rotation leaves consumers with the old secret briefly → 'auth'. */
export function secretsStore(n: SimNode): NodeLogic {
  const quota = new RateWindow();
  let rotatedAt = -Infinity;
  const rotate = () => {
    rotatedAt = n.now;
    n.log('protocol', `${n.name} rotated secret`);
  };
  return {
    onStart() {
      const every = n.num('rotateEverySec', 0);
      if (every > 0) n.every(every * 1000, rotate);
    },
    onRequest(req: Req) {
      const w = req.msg.weight;
      if (!quota.take(n.now, w, n.num('quotaRps', 10_000))) return req.reply({ ok: false, err: '429' });
      n.process(w, n.serviceTime('p50Ms', 'p99Ms', 5, 25), ok => {
        if (!ok) return req.reply({ ok: false, err: '503' });
        const win = n.num('rotationWindowSec', 5) * 1000;
        const since = n.now - rotatedAt;
        // consumers holding the old version fail until they re-fetch
        if (since < win && n.rng.chance(1 - since / win)) return req.reply({ ok: false, err: 'auth' });
        req.reply({ ok: true });
      });
    },
    onChaos(kind, _p, heal) {
      if (kind !== 'key-rotation' && kind !== 'secret-rotation') return false;
      if (!heal) rotate();
      return true;
    },
  };
}

register('identity-provider', identityProvider);
register('auth-middleware', authMiddleware);
register('kms', kms);
register('secrets-store', secretsStore);
