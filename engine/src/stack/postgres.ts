// Self-managed Postgres from postgres-progress (group stack-postgres): Patroni HA with etcd/ZooKeeper, HAProxy, pgbouncer, RDS → PG17 migration.
import { boardDemo, N } from '../machine/lib/board';
import { D, seqDemo } from './lib';

const G = 'stack-postgres';

const PATRONI = D('Patroni', 'Runs and supervises PostgreSQL on its node (systemd’s postgresql.service is disabled). Holds or watches the leader key in the DCS and exposes a REST API on :8008.', 'scope: cluster1\nnamespace: /pg-cluster/\nname: node1\nrestapi:\n  listen: 0.0.0.0:8008\netcd:\n  host: 127.0.0.1:2379\npostgresql:\n  use_pg_rewind: true\n  data_dir: /mnt/pg_data/data');
const ETCD = D('etcd', 'The distributed configuration store: the source of truth for who is leader. Accepts writes only with a quorum of 2 of 3, which is why node3 runs etcd too.', 'etcdctl endpoint status --cluster\netcdctl get --prefix /pg-cluster/cluster1/leader');
const HAPROXY = D('HAProxy (node3)', 'Never talks to etcd. It health-checks each Patroni REST API and routes writes (:5432) to whoever answers 200 on /read-write, reads (:6432) round robin to /read-only.', 'backend write_backend\n  option httpchk HEAD /read-write\n  http-check expect status 200\n  default-server inter 3s fall 3 rise 2 \\\n    on-marked-down shutdown-sessions\n  server node1 node1:6432 check port 8008\n  server node2 node2:6432 check port 8008 backup');
const PGB = D('pgbouncer', 'Connection pooler in front of each PostgreSQL on :6432, so hundreds of client connections share a few backend processes.', '[databases]\napp_db = host=localhost port=5432 dbname=app_db\n[pgbouncer]\nlisten_port = 6432\nauth_type = md5');
const PG = (role: string) => D(`PostgreSQL 17 (${role})`, role === 'primary' ? 'Accepts writes and streams WAL to the replica.' : 'Replays the primary’s WAL as a hot standby; serves reads.', 'patronictl -c /etc/patroni.yml list\n+ Cluster: cluster1 ----+---------+-----------+\n| Member | Host      | Role    | State     |\n| node1  | 10.0.1.11 | Leader  | running   |\n| node2  | 10.0.1.12 | Replica | streaming |');

boardDemo(G, 'stk-pg-ha', 'Postgres HA with Patroni', 'The 3-node Patroni + etcd + HAProxy + pgbouncer design, how routing finds the primary, and swapping etcd for ZooKeeper.', {
  design: [
    'The design',
    {
      panel: 'Cluster',
      nodes: [
        N('client', 355, 20, 290, 90, 'client', 'app / psql'),
        N('hap', 355, 150, 290, 110, 'HAProxy', 'node3 · 5432 / 6432', { detail: HAPROXY }),
        N('pgb1', 40, 330, 280, 100, 'pgbouncer', 'node1 :6432', { detail: PGB }),
        N('pgb2', 680, 330, 280, 100, 'pgbouncer', 'node2 :6432', { detail: PGB }),
        N('pg1', 40, 480, 280, 110, 'PG primary', 'node1', { detail: PG('primary') }),
        N('pg2', 680, 480, 280, 110, 'PG replica', 'node2', { detail: PG('replica') }),
        N('pat1', 40, 640, 280, 100, 'Patroni', 'node1 :8008', { detail: PATRONI }),
        N('pat2', 680, 640, 280, 100, 'Patroni', 'node2 :8008', { detail: PATRONI }),
        N('etcd', 200, 830, 600, 120, 'etcd quorum', 'node1 · node2 · node3', { detail: ETCD }),
      ],
      edges: ['client>hap', 'hap>pgb1', 'hap>pgb2', 'pgb1>pg1', 'pgb2>pg2', 'pat1>etcd', 'pat2>etcd'],
      beats: [
        { note: 'Three nodes: PostgreSQL, Patroni and pgbouncer on node1 and node2, HAProxy on node3, etcd on all three.', hot: { hap: 'current', pg1: 'current', pg2: 'current', etcd: 'current' }, rows: [['nodes', 3]] },
        { note: 'Patroni, not systemd, starts and stops PostgreSQL on each data node.', hot: { pat1: 'write', pat2: 'write' }, rows: [['process owner', 'Patroni']] },
        { note: 'The Patroni holding the leader key in etcd runs the primary; the other streams WAL as a replica.', hot: { pat1: 'ok', etcd: 'ok', 'pat1>etcd': 'accent', pg1: 'ok' }, rows: [['leader', 'node1', 'ok']] },
        { note: 'Clients only know HAProxy: :5432 for writes, :6432 for reads, each through a pgbouncer.', hot: { client: 'current', 'client>hap': 'accent', 'hap>pgb1': 'accent', 'pgb1>pg1': 'accent' }, rows: [['write port', 5432], ['read port', 6432]] },
        { note: 'etcd needs 2 of 3 members for every write, so it runs on node3 as a tiebreaker even without a database there.', hot: { etcd: 'warn' }, rows: [['quorum', '2 of 3']] },
      ],
    },
  ],
  zk: [
    'etcd → ZooKeeper',
    {
      panel: 'DCS',
      nodes: [
        N('pat', 355, 40, 290, 120, 'Patroni', 'unchanged', { detail: PATRONI }),
        N('etcd', 40, 280, 420, 140, 'etcd', 'leader key /pg-cluster/…', { detail: ETCD }),
        N('zk', 540, 280, 420, 140, 'ZooKeeper', 'leader znode', { detail: D('ZooKeeper as DCS', 'Same design, three differences: install ZooKeeper with zoo.cfg and a myid per node, replace the etcd: block, install patroni[zookeeper].', '# patroni.yml\nzookeeper:\n  hosts:\n    - node1:2181\n    - node2:2181\n    - node3:2181\n# pip install "patroni[zookeeper]"') }),
        N('same', 40, 540, 920, 150, 'unchanged', 'patronictl, REST API, HAProxy, failover'),
      ],
      edges: ['pat>etcd', 'pat>zk'],
      beats: [
        { note: 'Patroni treats the configuration store as a pluggable backend.', hot: { pat: 'current' }, hide: ['same'], rows: [['DCS', 'pluggable']] },
        { note: 'The etcd design keeps the leader as a key with a TTL.', hot: { etcd: 'current', 'pat>etcd': 'accent' }, hide: ['same'], rows: [['backend', 'etcd']] },
        { note: 'Swapping in ZooKeeper changes the install, one patroni.yml block and a pip extra.', hot: { zk: 'current', 'pat>zk': 'accent' }, hide: ['same'], rows: [['files changed', 3]] },
        { note: 'Everything else behaves the same: the leader becomes a znode instead of a key.', hot: { same: 'ok' }, rows: [['failover', 'same', 'ok']] },
      ],
    },
  ],
});

const lanes = [
  { id: 'hap', label: 'HAProxy', detail: HAPROXY },
  { id: 'p1', label: 'Patroni 1', sub: 'node1', detail: PATRONI },
  { id: 'etcd', label: 'etcd', detail: ETCD },
  { id: 'p2', label: 'Patroni 2', sub: 'node2', detail: PATRONI },
];

seqDemo(G, 'stk-pg-failover', 'Patroni: leader loop & failover', 'The leader-key renewal loop, HAProxy health checks, a primary crash with promotion, and pg_rewind rejoining the old primary.', {
  loop: [
    'Leader loop',
    {
      panel: 'Patroni',
      lanes,
      intro: 'Healthy cluster: node1 is leader. Every loop_wait (10 s) each Patroni talks to etcd.',
      msgs: [
        { from: 'p1', to: 'etcd', label: 'renew leader, ttl 30', note: 'node1 updates the leader key with its TTL, proving it is alive.' },
        { from: 'etcd', to: 'p1', label: 'ok', reply: true, note: 'Accepted by an etcd quorum.' },
        { from: 'p2', to: 'etcd', label: 'get leader', note: 'node2 reads the key: someone else leads, so it stays replica.' },
        { from: 'etcd', to: 'p2', label: 'node1', reply: true, note: 'Its PostgreSQL keeps streaming from node1.' },
        { from: 'hap', to: 'p1', label: 'HEAD /read-write', note: 'Every 3 s HAProxy health-checks each Patroni REST API.' },
        { from: 'p1', to: 'hap', label: '200', reply: true, note: 'node1 is primary, so it is the write backend.' },
        { from: 'hap', to: 'p2', label: 'HEAD /read-write', note: 'Same check on node2.' },
        { from: 'p2', to: 'hap', label: '503', reply: true, ok: false, note: 'A replica says 503 here but 200 on /read-only, so it only serves the read port.' },
      ],
      outro: 'No component asks “who is primary” at query time; routing follows health checks, and health follows the leader key.',
      outroRows: [['loop_wait', '10 s'], ['ttl', '30 s']],
    },
  ],
  failover: [
    'Primary dies',
    {
      panel: 'Failover',
      lanes,
      intro: 'node1 crashes. Clients writing through HAProxy start failing.',
      msgs: [
        { from: 'p1', to: 'p1', label: 'kill -9 / power off', note: 'The primary and its Patroni stop; nobody renews the leader key.' },
        { from: 'hap', to: 'p1', label: 'HEAD /read-write', lost: true, note: 'Health checks to node1 time out.' },
        { from: 'hap', to: 'hap', label: 'fall 3 → down', note: 'After 3 failed checks HAProxy marks node1 down and shuts its sessions.' },
        { from: 'etcd', to: 'etcd', label: 'leader key expires', note: 'After the 30 s TTL the leader key disappears.' },
        { from: 'p2', to: 'etcd', label: 'create leader (if absent)', note: 'node2 races to take the key with an atomic create; only one candidate can win.' },
        { from: 'etcd', to: 'p2', label: 'you are leader', reply: true, note: 'node2 won.' },
        { from: 'p2', to: 'p2', label: 'pg_ctl promote', note: 'Patroni promotes the replica to primary on a new timeline.' },
        { from: 'hap', to: 'p2', label: 'HEAD /read-write', note: 'The next health check asks node2 again.' },
        { from: 'p2', to: 'hap', label: '200', reply: true, note: 'rise 2: after two good checks node2 is the write backend.' },
      ],
      outro: 'Downtime is roughly TTL plus the check interval, tens of seconds. The client loop in test_ha.sh shows the gap and then writes resume.',
      outroRows: [['new primary', 'node2', 'ok'], ['write gap', '~30–40 s', 'warn']],
    },
  ],
  rejoin: [
    'Old primary rejoins',
    {
      panel: 'Rejoin',
      lanes,
      intro: 'node1 boots again, believing it was primary, with a few WAL records node2 never received.',
      msgs: [
        { from: 'p1', to: 'etcd', label: 'get leader', note: 'Patroni checks the DCS before starting anything.' },
        { from: 'etcd', to: 'p1', label: 'node2', reply: true, note: 'node2 leads now, so node1 must become a replica.' },
        { from: 'p1', to: 'p1', label: 'timelines diverged', note: 'Its WAL has records past the fork point of node2’s new timeline.' },
        { from: 'p1', to: 'p2', label: 'pg_rewind', note: 'use_pg_rewind: node1 copies back the blocks changed since the fork, discarding its extra records.', detail: D('pg_rewind', 'Needs wal_log_hints or data checksums, and a rewind user. Otherwise the only option is a full reinit.', 'postgresql:\n  use_pg_rewind: true\n  parameters:\n    wal_log_hints: true\npatronictl -c /etc/patroni.yml reinit cluster1 node1') },
        { from: 'p1', to: 'p2', label: 'stream WAL', note: 'It starts as a replica following node2.' },
        { from: 'hap', to: 'p1', label: 'HEAD /read-only', note: 'HAProxy sees node1 healthy for reads again.' },
        { from: 'p1', to: 'hap', label: '200', reply: true, note: 'Back in the read pool; the roles simply swapped.' },
      ],
      outro: 'Writes acknowledged by node1 but never streamed are lost in async replication. synchronous_mode trades latency to prevent that.',
      outroRows: [['lost on failover', 'unreplicated WAL', 'warn']],
    },
  ],
});

boardDemo(G, 'stk-pg-migrate', 'RDS → self-hosted PG17', 'The migration runbook from postgres-progress: snapshot, pre-checks, roles, parallel dump/restore, verify, cutover, rollback window.', {
  plan: [
    'Runbook',
    {
      panel: 'Migration',
      nodes: [
        N('snap', 40, 20, 920, 100, '1. snapshot RDS', 'rollback point'),
        N('pre', 40, 140, 920, 100, '2. pre-migration checks', 'sizes, connections, roles', { detail: D('pre_migration_checks.sql', 'Know what you move and who is connected.', "SELECT relname,\n  pg_size_pretty(pg_total_relation_size(relid))\nFROM pg_catalog.pg_statio_user_tables\nORDER BY pg_total_relation_size(relid) DESC;\nSELECT client_addr, count(*)\nFROM pg_stat_activity GROUP BY 1;") }),
        N('roles', 40, 260, 920, 100, '3. roles & grants', 'reader/writer + per-app', { detail: D('roles_example.sql', 'Recreate roles first: the dump is taken with --no-owner --no-privileges.', 'CREATE ROLE app_reader NOLOGIN;\nCREATE ROLE app_writer NOLOGIN IN ROLE app_reader;\nCREATE ROLE orders_svc LOGIN IN ROLE app_writer;') }),
        N('dump', 40, 380, 920, 100, '4. pg_dump -F d -j 8', 'parallel directory dump', { detail: D('Dump', 'Directory format allows parallel jobs for both dump and restore.', 'pg_dump -h <rds> -U postgres -d app_db \\\n  --no-owner --no-privileges -F d -j 8 \\\n  -f app_db_dump_$(date +%Y%m%d)/') }),
        N('restore', 40, 500, 920, 100, '5. pg_restore via pgbouncer', ':6432 on the new cluster', { detail: D('Restore', 'Into the Patroni cluster, through pgbouncer.', 'pg_restore -h localhost -p 6432 -U postgres \\\n  -d app_db --clean --if-exists -F d \\\n  -j 8 app_db_dump_20250101/') }),
        N('verify', 40, 620, 920, 100, '6. verify', 'row counts, sample queries', { detail: D('Verify', 'Compare source and target before any client moves.', 'psql -h <rds> -c "SELECT count(1) FROM orders;"\npsql -h localhost -p 6432 \\\n  -c "SELECT count(1) FROM orders;"\npython verify_connection.py   # expects PG 17') }),
        N('cut', 40, 740, 920, 100, '7. cutover', 'connection strings → HAProxy'),
        N('rb', 40, 860, 920, 100, '8. rollback window', 'RDS kept idle, then removed'),
      ],
      edges: ['snap>pre', 'pre>roles', 'roles>dump', 'dump>restore', 'restore>verify', 'verify>cut', 'cut>rb'],
      beats: [
        { note: 'Take an RDS snapshot first, so every later step can be undone.', hot: { snap: 'current' }, rows: [['step', 1]] },
        { note: 'Measure table sizes and live connections, and list existing roles.', hot: { pre: 'current', 'snap>pre': 'accent' }, rows: [['step', 2]] },
        { note: 'Recreate roles on the target, because the dump carries no owners or grants.', hot: { roles: 'current', 'pre>roles': 'accent' }, rows: [['step', 3]] },
        { note: 'Dump in directory format with 8 parallel jobs.', hot: { dump: 'write', 'roles>dump': 'accent' }, rows: [['format', 'directory'], ['jobs', 8]] },
        { note: 'Restore into the new cluster through pgbouncer on 6432.', hot: { restore: 'write', 'dump>restore': 'accent' }, rows: [['target', 'PG 17 via pgbouncer']] },
        { note: 'Compare row counts and sampled queries on both sides.', hot: { verify: 'ok', 'restore>verify': 'accent' }, rows: [['counts match', 'required', 'ok']] },
        { note: 'Switch applications to HAProxy while watching connections and error rates.', hot: { cut: 'current', 'verify>cut': 'accent' }, rows: [['writes', 'new cluster']] },
        { note: 'Keep RDS idle for a rollback window before deleting it.', hot: { rb: 'ok', 'cut>rb': 'accent' }, rows: [['rollback', 'possible', 'ok']] },
      ],
    },
  ],
  downtime: [
    'Downtime & logical replication',
    {
      panel: 'Downtime',
      nodes: [
        N('app', 355, 40, 290, 110, 'application', 'writes'),
        N('rds', 40, 260, 420, 140, 'RDS (source)', 'writes frozen during dump'),
        N('new', 540, 260, 420, 140, 'PG17 (target)', 'restored copy'),
        N('gap', 40, 500, 920, 130, 'dump + restore window', 'writes must stop or be lost'),
        N('logical', 40, 720, 920, 160, 'logical replication', 'publication → subscription', { detail: D('Near-zero downtime', 'Copy once, then stream changes until cutover. Sequences and DDL are not replicated and need a final sync.', "-- on RDS (rds.logical_replication=1)\nCREATE PUBLICATION mig FOR ALL TABLES;\n-- on PG17 (schema restored first)\nCREATE SUBSCRIPTION mig CONNECTION\n  'host=<rds> dbname=app_db user=repl'\n  PUBLICATION mig;") }),
      ],
      edges: ['app>rds', 'rds>new'],
      beats: [
        { note: 'With dump and restore, any write after the dump started is missing from the target.', hot: { rds: 'warn', 'rds>new': 'accent' }, hide: ['gap', 'logical'], rows: [['consistent as of', 'dump start']] },
        { note: 'So writes stop for the whole dump, restore and verify window.', hot: { gap: 'fail', app: 'fail' }, hide: ['logical'], rows: [['downtime', 'dump + restore', 'fail']] },
        { note: 'For large or busy databases, logical replication copies once and then streams every change until cutover.', hot: { logical: 'ok', new: 'ok' }, rows: [['downtime', 'seconds', 'ok'], ['watch', 'sequences, DDL', 'warn']] },
      ],
    },
  ],
});
