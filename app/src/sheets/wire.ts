import type { ErrKind, Msg, Reply, SystemDoc } from '@dsims/engine';
import { catalog } from '@dsims/content';

/** What a request / response would look like on the wire, curl-style. */
export interface Wire {
  proto: string;
  req: string[];
  res: string[];
  status: string;
  ok: boolean;
  /** the same exchange in plain words */
  plain?: { req: string; res: string };
}

interface RouteHint {
  method?: string;
  path?: string;
  status?: number;
  location?: string;
  reqBody?: string;
  body?: string;
}

/** Optional per-design API shape (`doc.wire`), e.g. the URL shortener's redirects. */
export interface WireHint {
  host?: string;
  read?: RouteHint;
  write?: RouteHint;
  table?: string;
  keyCol?: string;
  valCol?: string;
  cachePrefix?: string;
  topic?: string;
}

export interface WireCtx {
  doc: SystemDoc;
  from: string;
  to: string;
  msg?: Msg;
  res?: Reply;
  ok: boolean;
  err?: string;
  spanMs: number;
  calls: boolean;
  traceId: number;
}

type Kind = 'http' | 'cache' | 'sql' | 'kv' | 'grpc' | 'queue' | 'search' | 's3' | 'rpc';

const SQL = /relational-db|pg-|airflow-metadata|columnar|warehouse|lakehouse|time-series/;
const CACHE = /cache|redis/;
const KV = /kv-store|document-db|dynamodb|cassandra|graph-db|shard-router/;
const QUEUE = /queue|log-stream|pub-sub|kafka|rabbitmq|celery-broker|outbox/;
const GRPC = /id-generator|kms|secrets|lock-service|identity|temporal|k8s-api|consensus|zk-server/;

function kindOf(type: string): Kind {
  if (CACHE.test(type)) return 'cache';
  if (SQL.test(type)) return 'sql';
  if (KV.test(type)) return 'kv';
  if (QUEUE.test(type)) return 'queue';
  if (/search|es-/.test(type)) return 'search';
  if (/object-store|blob/.test(type)) return 's3';
  if (GRPC.test(type)) return 'grpc';
  const g = catalog.types.find(t => t.type === type)?.group;
  if (g === 'coordination' || g === 'transactions') return 'rpc';
  return 'http';
}

const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function shortCode(key: number) {
  let n = (Math.imul(key + 1, 2654435761) >>> 0) * 31 + key;
  let s = '';
  for (let i = 0; i < 7; i++) {
    s += B62[n % 62];
    n = Math.floor(n / 62) || Math.imul(n + i + 7, 2246822519) >>> 0;
  }
  return s;
}

const fill = (tpl: string, key: number, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? (k === 'key' ? String(key) : `{${k}}`));

const ms = (x: number) => (x < 1 ? x.toFixed(2) : x < 100 ? x.toFixed(1) : Math.round(x).toString());

const HTTP_TEXT: Record<number, string> = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 401: 'Unauthorized', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };

export function wireOf(x: WireCtx): Wire {
  const nodes = x.doc.nodes;
  const from = nodes.find(n => n.id === x.from);
  const to = nodes.find(n => n.id === x.to);
  const toType = to?.type ?? 'service';
  const kind = kindOf(toType);
  const hint: WireHint = (x.doc as any).wire ?? {};
  const key = Math.max(0, Math.round(x.msg?.key ?? x.traceId * 37));
  const write = x.msg?.op === 'write';
  const code = shortCode(key);
  const vars = { code, key: String(key), host: hint.host ?? 'api.example.com' };
  const host = vars.host;
  const value = x.res?.value ?? x.msg?.value;
  const edge = x.doc.edges.find(e => e.from === x.from && e.to === x.to);
  const timeout = (edge?.config as any)?.timeoutMs ?? 3000;
  const err = (x.res?.err ?? x.err) as ErrKind | undefined;
  const ok = x.res ? x.res.ok : x.ok;
  const w = { kind, to, from, toType, hint, key, write, code, vars, host, value, timeout, err, ok, x };
  const wire = build(w);
  return { ...wire, plain: plainOf(w, wire) };
}

function build(w: W): Wire {
  switch (w.kind) {
    case 'cache':
      return cacheWire(w);
    case 'sql':
      return sqlWire(w);
    case 'kv':
      return kvWire(w);
    case 'queue':
      return queueWire(w);
    case 'grpc':
    case 'rpc':
      return grpcWire(w);
    case 'search':
      return searchWire(w);
    case 's3':
      return s3Wire(w);
    default:
      return httpWire(w);
  }
}

const FAIL: Partial<Record<ErrKind, string>> = {
  timeout: 'No answer in time: the caller gave up waiting.',
  refused: 'Nobody answered: the server is down.',
  unavailable: 'Nobody answered: the server is down.',
  '429': 'Too many requests: slow down and retry shortly.',
  '503': 'Too busy right now: try again later.',
  auth: 'Not allowed: the login token is missing or expired.',
  conflict: 'Conflict: someone else changed it first.',
};

/** What the request asks and what the answer means, for a human. */
function plainOf(w: W, wire: Wire): { req: string; res: string } {
  const who = w.to?.name ?? 'the server';
  const item = `item ${w.hint.keyCol ? w.code : w.key}`;
  const v = w.value ?? w.key;
  const fail = FAIL[w.err as ErrKind] ?? 'Something went wrong on the server.';
  switch (w.kind) {
    case 'cache':
      return {
        req: w.write ? `Remember ${item} for an hour.` : `Do you have ${item} in memory?`,
        res: !w.ok ? fail : w.write ? 'Stored.' : w.x.calls ? 'Not cached, so it was loaded from the database and kept for next time.' : `Yes, here it is: ${v}.`,
      };
    case 'sql':
    case 'kv':
      return {
        req: w.write ? `Save ${item} with value ${v}.` : `Look up ${item}.`,
        res: !w.ok ? fail : w.write ? 'Saved.' : `Found it: ${v}${w.x.res?.stale ? ', but from a copy that is behind' : ''}.`,
      };
    case 'queue':
      return { req: `Post an event about ${item} for others to pick up later.`, res: !w.ok ? fail : 'Queued. Consumers will handle it on their own time.' };
    case 'grpc':
    case 'rpc':
      if (w.toType === 'id-generator') return { req: 'Give me a new unique ID.', res: !w.ok ? fail : 'Here is a fresh ID, unique across all servers.' };
      return { req: w.write ? `Ask ${who} to update ${item}.` : `Ask ${who} for ${item}.`, res: !w.ok ? fail : w.write ? 'Done.' : `Here it is: ${v}.` };
    case 'search':
      return { req: `Search for things matching "q${w.key}".`, res: !w.ok ? fail : 'Here are the best matches.' };
    case 's3':
      return { req: w.write ? `Upload file ${w.key}.bin.` : `Download file ${w.key}.bin.`, res: !w.ok ? fail : w.write ? 'Stored.' : 'Here is the file.' };
  }
  const st = Number(wire.status);
  const loc = wire.res.find(l => l.startsWith('location: '))?.slice(10);
  const cdn = wire.res.find(l => l.startsWith('x-cache: '));
  return {
    req: w.write ? `Please save this for ${item}.` : `Please send me ${item}.`,
    res: !w.ok ? fail : loc ? `It lives elsewhere: go to ${loc}.` : w.write ? `Saved as ${item}.` : `Here is ${item}${cdn ? (/Hit/.test(cdn) ? ', straight from the CDN edge' : ', fetched from the origin by the CDN') : ''}.${st === 200 ? '' : ` (${wire.status})`}`,
  };
}

type W = {
  kind: Kind;
  to?: SystemDoc['nodes'][number];
  from?: SystemDoc['nodes'][number];
  toType: string;
  hint: WireHint;
  key: number;
  write: boolean;
  code: string;
  vars: Record<string, string>;
  host: string;
  value?: number;
  timeout: number;
  err?: ErrKind;
  ok: boolean;
  x: WireCtx;
};

const isEdgeProxy = (t: string) => /cdn|load-balancer|api-gateway|waf|nginx|rate-limiter|sidecar|dns/.test(t);

function httpWire(w: W): Wire {
  const { hint, x } = w;
  const fromType = w.from?.type ?? '';
  const fromClient = !!catalog.types.find(t => t.type === fromType)?.client;
  const r = w.write ? hint.write : hint.read;
  const method = r?.method ?? (w.write ? 'POST' : 'GET');
  const path = fill(r?.path ?? (w.write ? '/api/items' : '/api/items/{key}'), w.key, w.vars);
  const ver = fromClient ? 'HTTP/2' : 'HTTP/1.1';
  const req = [`${method} ${path} ${ver}`, `host: ${w.host}`];
  if (fromClient) req.push(w.from?.type === 'mobile-client' ? 'user-agent: MyApp/4.2 (iOS 19)' : 'user-agent: Mozilla/5.0 (iPhone; CPU iPhone OS 19_0)', 'accept: text/html,*/*');
  else {
    req.push(`x-forwarded-for: 203.0.113.${(w.key % 250) + 1}`, `x-request-id: ${reqId(x.traceId)}`);
    if (w.from?.skin === 'cloudfront' || w.from?.type === 'cdn') req.push('via: 2.0 cloudfront');
  }
  if (x.msg?.auth === 'ok' || x.msg?.auth === 'expired') req.push('authorization: Bearer eyJhbGciOi…');
  if (x.msg?.tenant) req.push(`x-tenant-id: ${x.msg.tenant}`);
  if (w.write) {
    const body = fill(hint.write?.reqBody ?? '{"value": {value}}', w.key, { ...w.vars, value: String(w.value ?? w.key) });
    req.push(`content-type: application/json`, `content-length: ${body.length}`, '', body);
  }
  if (!w.ok) return httpErr(w, req, ver);
  const status = r?.status ?? (w.write ? 201 : 200);
  const res = [`${ver} ${status} ${HTTP_TEXT[status] ?? ''}`.trim()];
  if (r?.location || status === 301 || status === 302) res.push(`location: ${fill(r?.location ?? 'https://example.com/{key}', w.key, w.vars)}`);
  const cdn = w.toType === 'cdn' || w.to?.skin === 'cloudfront';
  if (!w.write && status < 400) res.push(status === 301 ? 'cache-control: public, max-age=86400' : 'cache-control: private, max-age=60');
  if (cdn) res.push(`x-cache: ${x.calls ? 'Miss' : 'Hit'} from cloudfront`, ...(x.calls ? [] : [`age: ${(w.key * 13) % 3600}`]));
  res.push(`server-timing: ${w.to?.id ?? 'app'};dur=${ms(x.spanMs)}`);
  const body = fill(r?.body ?? (w.write ? '{"id": {key}, "version": 1}' : status >= 300 && status < 400 ? '' : '{"id": {key}, "value": {value}}'), w.key, { ...w.vars, value: String(w.value ?? '"…"') });
  if (body) res.push(`content-type: application/json`, '', body);
  return { proto: ver, req, res, status: `${status}`, ok: true };
}

function httpErr(w: W, req: string[], ver: string): Wire {
  const proxy = isEdgeProxy(w.toType);
  const e = w.err;
  if (e === 'timeout') return { proto: ver, req, res: [`curl: (28) Operation timed out after ${w.timeout} milliseconds with 0 bytes received`, `# ${w.to?.name ?? 'server'} didn't answer within the ${w.timeout} ms timeout`], status: 'timeout', ok: false };
  if (e === 'refused' || e === 'unavailable') return { proto: ver, req, res: [`curl: (7) Failed to connect to ${w.to?.id ?? w.host} port 443: Connection refused`, '# nothing is listening: the process is down'], status: 'refused', ok: false };
  const code = e === '429' ? 429 : e === '503' ? 503 : e === 'auth' ? 401 : e === 'conflict' ? 409 : proxy ? 502 : 500;
  const res = [`${ver} ${code} ${HTTP_TEXT[code]}`];
  if (code === 429) res.push('retry-after: 1', 'x-ratelimit-limit: 100', 'x-ratelimit-remaining: 0');
  if (code === 503) res.push('retry-after: 2');
  if (code === 401) res.push('www-authenticate: Bearer error="invalid_token", error_description="The access token expired"');
  res.push(`server-timing: ${w.to?.id ?? 'app'};dur=${ms(w.x.spanMs)}`, 'content-type: application/json', '', `{"error": "${HTTP_TEXT[code].toLowerCase()}"}`);
  return { proto: ver, req, res, status: String(code), ok: false };
}

function cacheWire(w: W): Wire {
  const k = `${w.hint.cachePrefix ?? 'item:'}${w.hint.keyCol ? w.code : w.key}`;
  const val = w.hint.read?.location ? `"${fill(w.hint.read.location, w.key, w.vars)}"` : `"${w.value ?? w.key}"`;
  const req = w.write ? [`SET ${k} ${val} EX 3600`] : [`GET ${k}`];
  if (!w.ok) return { proto: 'RESP', req, res: [respErr(w)], status: w.err ?? 'error', ok: false };
  const res = w.write ? ['OK'] : w.x.calls ? ['(nil)', `# miss: loaded from the database, cached, then returned`, val] : [val];
  res.push(`# ${ms(w.x.spanMs)} ms`);
  return { proto: 'RESP', req, res, status: w.write ? 'OK' : w.x.calls ? 'miss' : 'hit', ok: true };
}

function respErr(w: W) {
  if (w.err === 'timeout') return `(error) i/o timeout after ${w.timeout} ms`;
  if (w.err === 'refused' || w.err === 'unavailable') return `Could not connect to Redis at ${w.to?.id ?? 'redis'}:6379: Connection refused`;
  if (w.err === '503' || w.err === '429') return '(error) ERR max number of clients reached';
  return '(error) LOADING Redis is loading the dataset in memory';
}

const GENERIC = /^(db|database|store|primary|replica|leader|follower|shard|node|postgres|pg|mysql|cassandra|dynamo|dynamodb|mongo|mongodb|main|old|new|source|target|standby|sql|kv|data)$/;

/** several databases: each one's table comes from its name ("Payments DB" → payments) */
function tableOf(w: W): string {
  const t = w.hint.table ?? 'items';
  const dbs = w.x.doc.nodes.filter(n => SQL.test(n.type) || KV.test(n.type));
  if (dbs.length < 2 || !w.to) return t;
  const base = w.to.name.toLowerCase().replace(/\b(db|database|store|table|primary|replica|leader|follower|shard|pg|postgres|mysql)\b/g, '').replace(/[^a-z]+/g, ' ').replace(/\b[a-z]\b/g, '').trim().replace(/ +/g, '_');
  return base.length >= 3 && !GENERIC.test(base) ? base : t;
}

function sqlWire(w: W): Wire {
  const t = tableOf(w);
  const kc = w.hint.keyCol ?? 'id';
  const vc = w.hint.valCol ?? 'value';
  const kv = w.hint.keyCol ? `'${w.code}'` : String(w.key);
  const v = w.hint.read?.location ? fill(w.hint.read.location, w.key, w.vars) : String(w.value ?? w.key);
  const req = w.write ? [`INSERT INTO ${t} (${kc}, ${vc})`, `VALUES (${kv}, '${v}');`] : [`SELECT ${vc} FROM ${t}`, `WHERE ${kc} = ${kv};`];
  if (!w.ok) {
    const e =
      w.err === 'timeout' ? 'ERROR:  canceling statement due to statement timeout' : w.err === 'refused' || w.err === 'unavailable' ? `psql: error: connection to server at "${w.to?.id ?? 'db'}" port 5432 failed: Connection refused` : w.err === 'conflict' ? `ERROR:  duplicate key value violates unique constraint "${t}_pkey"` : w.err === '503' || w.err === '429' ? 'FATAL:  sorry, too many clients already' : 'ERROR:  could not serialize access due to concurrent update';
    return { proto: 'SQL', req, res: [e], status: 'error', ok: false };
  }
  const res = w.write ? ['INSERT 0 1'] : [` ${vc}`, ` ${'─'.repeat(Math.min(34, Math.max(vc.length, v.length) + 1))}`, ` ${v}`, '(1 row)'];
  res.push(`Time: ${ms(w.x.spanMs)} ms`);
  if (w.x.res?.stale) res.push('# from a replica that is behind: an older copy');
  return { proto: 'SQL', req, res, status: w.write ? 'INSERT 0 1' : '1 row', ok: true };
}

function kvWire(w: W): Wire {
  const t = tableOf(w);
  const k = w.hint.keyCol ? w.code : String(w.key);
  const req = w.write ? [`PutItem`, `{ "TableName": "${t}", "Item": { "pk": "${k}", "value": ${w.value ?? 0} } }`] : [`GetItem`, `{ "TableName": "${t}", "Key": { "pk": "${k}" }, "ConsistentRead": false }`];
  if (!w.ok) return { proto: 'KV', req, res: [w.err === '429' || w.err === '503' ? 'ProvisionedThroughputExceededException: rate of requests exceeds the allowed throughput' : w.err === 'timeout' ? `RequestTimeout after ${w.timeout} ms` : w.err === 'conflict' ? 'ConditionalCheckFailedException' : 'InternalServerError'], status: w.err ?? 'error', ok: false };
  const res = w.write ? ['{}'] : [`{ "Item": { "pk": "${k}", "value": ${w.value ?? 0}${w.x.res?.version !== undefined ? `, "ver": ${w.x.res.version}` : ''} } }`];
  res.push(`# ${ms(w.x.spanMs)} ms`);
  return { proto: 'KV', req, res, status: '200', ok: true };
}

function queueWire(w: W): Wire {
  const topic = w.hint.topic ?? 'events';
  const part = w.key % 6;
  const req = [`PRODUCE topic=${topic} partition=${part} acks=all`, `key=${w.hint.keyCol ? w.code : w.key}  value=${JSON.stringify({ id: w.key, op: w.write ? 'write' : 'read' })}`];
  if (!w.ok) return { proto: 'Kafka', req, res: [w.err === 'timeout' ? `REQUEST_TIMED_OUT after ${w.timeout} ms` : w.err === '503' || w.err === '429' ? 'THROTTLING_QUOTA_EXCEEDED' : 'NOT_LEADER_OR_FOLLOWER'], status: w.err ?? 'error', ok: false };
  return { proto: 'Kafka', req, res: [`ack  partition=${part} offset=${1000 + w.x.traceId * 3}`, `# ${ms(w.x.spanMs)} ms`], status: 'ack', ok: true };
}

function grpcWire(w: W): Wire {
  const svc = w.toType === 'id-generator' ? 'snowflake.IdService/NextId' : `${w.toType.replace(/-/g, '')}.Service/${w.write ? 'Write' : 'Get'}`;
  const req = [`POST /${svc} HTTP/2`, `content-type: application/grpc`, `grpc-timeout: ${w.timeout}m`, '', w.toType === 'id-generator' ? '{}' : `{ "key": ${w.key} }`];
  if (!w.ok) {
    const st = w.err === 'timeout' ? '4 DEADLINE_EXCEEDED' : w.err === 'refused' || w.err === 'unavailable' ? '14 UNAVAILABLE' : w.err === '429' || w.err === '503' ? '8 RESOURCE_EXHAUSTED' : w.err === 'auth' ? '16 UNAUTHENTICATED' : w.err === 'conflict' ? '10 ABORTED' : '13 INTERNAL';
    return { proto: 'gRPC', req, res: [`grpc-status: ${st}`], status: st.split(' ')[1], ok: false };
  }
  const body = w.toType === 'id-generator' ? `{ "id": "${snowflake(w)}" }` : `{ "key": ${w.key}, "value": ${w.value ?? 0} }`;
  return { proto: 'gRPC', req, res: ['HTTP/2 200', 'grpc-status: 0 OK', '', body, `# ${ms(w.x.spanMs)} ms`], status: 'OK', ok: true };
}

function snowflake(w: W) {
  const t = BigInt(1767225600000 + Math.round(w.x.msg?.born ?? w.x.traceId));
  return ((t << 22n) | (BigInt(w.key % 1024) << 12n) | BigInt(w.x.traceId % 4096)).toString();
}

function searchWire(w: W): Wire {
  const req = [`GET /items/_search`, `{ "query": { "match": { "title": "q${w.key}" } }, "size": 10 }`];
  if (!w.ok) return { proto: 'HTTP/1.1', req, res: [w.err === 'timeout' ? `{"timed_out": true, "took": ${w.timeout}}` : '{"error": {"type": "es_rejected_execution_exception"}, "status": 429}'], status: w.err ?? 'error', ok: false };
  return { proto: 'HTTP/1.1', req, res: [`{ "took": ${Math.round(w.x.spanMs)}, "hits": { "total": ${(w.key % 90) + 3}, "hits": [ … ] } }`], status: '200', ok: true };
}

function s3Wire(w: W): Wire {
  const req = [`${w.write ? 'PUT' : 'GET'} /media/${w.key}.bin HTTP/1.1`, `host: bucket.s3.amazonaws.com`, `x-amz-date: 20260927T090000Z`, 'authorization: AWS4-HMAC-SHA256 Credential=…'];
  if (!w.ok) return { proto: 'HTTP/1.1', req, res: [w.err === 'timeout' ? `curl: (28) Operation timed out after ${w.timeout} milliseconds` : 'HTTP/1.1 503 Slow Down'], status: w.err ?? 'error', ok: false };
  const size = w.x.msg?.size ?? 4096;
  return { proto: 'HTTP/1.1', req, res: ['HTTP/1.1 200 OK', `content-length: ${size}`, `etag: "${reqId(w.key).slice(0, 12)}"`, `# ${ms(w.x.spanMs)} ms`], status: '200', ok: true };
}

const reqId = (n: number) => ((Math.imul(n + 17, 2246822519) >>> 0).toString(16).padStart(8, '0') + (Math.imul(n + 3, 3266489917) >>> 0).toString(16).padStart(8, '0'));
