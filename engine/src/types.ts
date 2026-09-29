export type Id = string;
export type Config = Record<string, unknown>;

// ---------- Catalog ----------

export interface Knob {
  key: string;
  label: string;
  kind: 'number' | 'int' | 'bool' | 'enum' | 'ms' | 'percent' | 'string';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  unit?: string;
  advanced?: boolean;
  help?: string;
}

export interface CatalogType {
  type: string;
  group: string;
  label: string;
  description: string;
  icon: string;
  knobs: Knob[];
  /** true for things traffic originates from */
  client?: boolean;
  costPerInstanceMonth?: number;
}

export interface CatalogSkin {
  name: string;
  type: string;
  label: string;
  description: string;
  icon: string;
  defaults: Config;
  tags?: string[];
  /** Composite internals (technologies.md) */
  internals?: SystemDoc;
  ports?: Record<string, Id>;
  tech?: string;
}

export interface Catalog {
  groups: { id: string; label: string }[];
  types: CatalogType[];
  skins: CatalogSkin[];
  containers: { kind: ContainerKind; label: string; icon: string; description: string }[];
}

// ---------- System document (.dsim.json) ----------

export type ContainerKind =
  | 'region'
  | 'availability-zone'
  | 'vpc'
  | 'bounded-context'
  | 'layer'
  | 'tenant'
  | 'cell'
  | 'k8s-namespace';

export interface Point {
  x: number;
  y: number;
}

export interface NodeSpec {
  id: Id;
  type: string;
  skin?: string;
  name: string;
  parent?: Id;
  pos: Point;
  config?: Config;
}

export interface EdgeConfig {
  protocol?: string;
  mode?: 'sync' | 'async';
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  jitter?: boolean;
  circuitBreaker?: boolean;
  mtls?: boolean;
  latencyMs?: number;
  /** probability a request traverses this edge (0..1); default 1 */
  ratio?: number;
  /** only requests with this op use the edge (read|write|any) */
  op?: 'read' | 'write' | 'any';
  /** route label for gateways */
  route?: string;
  /** false = new connection per call: pays handshakeRtts round trips first */
  keepAlive?: boolean;
  /** TCP (1) + TLS 1.3 (1) = 2; TLS 1.2 = 3 */
  handshakeRtts?: number;
}

export interface EdgeSpec {
  id: Id;
  from: Id;
  to: Id;
  config?: EdgeConfig;
}

export interface ContainerSpec {
  id: Id;
  kind: ContainerKind;
  name: string;
  parent?: Id;
  config?: Config;
  collapsed?: boolean;
  /** layer order for layered rules (0 = top) */
  order?: number;
}

export interface AlertRule {
  id: Id;
  target: Id | 'system';
  metric: MetricKey;
  op: '>' | '<';
  threshold: number;
  forSec?: number;
  enabled?: boolean;
}

export type MetricKey = 'p50' | 'p99' | 'rps' | 'errRate' | 'util' | 'queue' | 'lag' | 'availability' | string;

export interface SystemDoc {
  schemaVersion: 1;
  id: Id;
  name: string;
  description?: string;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  containers: ContainerSpec[];
  alerts?: AlertRule[];
  scenario?: Scenario;
  updatedAt?: string;
}

// ---------- Scenario ----------

export type TrafficShape =
  | { kind: 'constant'; rps: number }
  | { kind: 'ramp'; from: number; to: number; overSec: number }
  | { kind: 'diurnal'; peak: number; trough: number; periodSec: number }
  | { kind: 'spike-train'; base: number; height: number; periodSec: number; widthSec: number };

export interface KeyDist {
  kind: 'uniform' | 'zipf' | 'hot';
  s?: number;
  /** for 'hot': fraction of traffic to key 0 */
  hot?: number;
  keys?: number;
}

export interface TrafficSource {
  id: Id;
  node: Id;
  shape: TrafficShape;
  readRatio?: number;
  keys?: KeyDist;
  tenants?: Record<string, number>;
  payloadBytes?: number;
  expiredAuth?: number;
  /** multiplicative overlays from bursts (managed by engine) */
}

export interface ChaosEvent {
  kind: string;
  target?: Id;
  target2?: Id;
  params?: Record<string, number | string | boolean>;
  durationSec?: number;
}

export interface ScheduledEvent {
  atSec: number;
  event: ChaosEvent | TrafficEvent;
}

export interface TrafficEvent {
  kind: 'traffic';
  source?: Id;
  action: 'burst' | 'ramp' | 'set' | 'flash-crowd' | 'hot-key' | 'bots' | 'herd';
  params?: Record<string, number>;
  durationSec?: number;
}

export interface Scenario {
  durationSec?: number;
  sources: TrafficSource[];
  events: ScheduledEvent[];
  challenge?: Challenge;
}

export interface Challenge {
  id: Id;
  title: string;
  pass: { metric: 'p99' | 'availability' | 'anomalies' | 'costMonth' | 'errRate'; op: '<' | '<=' | '>=' | '>' | '='; value: number; at?: Id }[];
}

// ---------- Runtime ----------

export type Op = 'read' | 'write';

export interface Msg {
  id: number;
  kind: string;
  from: Id;
  to: Id;
  weight: number;
  op?: Op;
  key?: number;
  tenant?: string;
  size: number;
  traceId?: number;
  born: number;
  hops: number;
  proto?: boolean;
  data?: any;
  value?: number;
  version?: number;
  idem?: number;
  auth?: 'ok' | 'expired' | 'none';
  route?: string;
}

export interface Reply {
  ok: boolean;
  err?: ErrKind;
  data?: any;
  value?: number;
  version?: number;
  stale?: boolean;
  /** cache read: the key was not there (cache-aside; the caller fetches it) */
  miss?: boolean;
}

export type ErrKind = 'timeout' | '5xx' | '503' | '429' | 'refused' | 'auth' | 'conflict' | 'unavailable';

export type Health = 'ok' | 'warn' | 'fail' | 'down';

export interface Badge {
  text: string;
  tone?: 'accent' | 'ok' | 'warn' | 'fail' | 'protocol' | 'muted';
}
