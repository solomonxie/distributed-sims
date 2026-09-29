// Docker in depth (group machine-os-docker): builds and the layer cache, multi-stage, the registry, networking, volumes, compose, lifecycle.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Beat, Board } from '../machine/lib/board';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const G = 'machine-os-docker';

// ---------------- build, cache, registry ----------------
const BUILD_NODES = [
  N('ctx', 40, 300, 280, 90, 'build context', 'sent to the daemon', { detail: d('Build context', 'Everything in the directory you pass to docker build is tarred and sent to the daemon before the first step. .dockerignore keeps node_modules, .git and secrets out of it.', '$ cat .dockerignore\n.git\nnode_modules\n*.env') }),
  N('bk', 370, 300, 260, 90, 'BuildKit', 'runs each step', { detail: d('BuildKit', 'The builder: parses the Dockerfile into a graph, runs independent steps in parallel, and keys every step’s cache on its inputs. Each step runs inside a temporary container from the previous layer.', '$ docker build -t app:1.0 .\n[+] Building 42.1s (11/11) FINISHED\n => CACHED [2/6] WORKDIR /src') }),
  N('cache', 700, 300, 260, 90, 'layer cache', 'keyed by inputs', { detail: d('Cache keys', 'RUN is cached on the instruction text plus the parent layer. COPY and ADD are cached on the checksum of the copied files. One miss invalidates every step after it.') }),
  N('l1', 40, 450, 280, 64, 'FROM golang:1.23', 'base layers', { detail: d('Base image', 'The parent image’s layers, pulled from the registry and shared with every other image built on it.') }),
  N('l2', 40, 530, 280, 64, 'COPY go.mod go.sum', 'layer', { detail: d('Dependency manifest first', 'Copy only the files that decide dependencies, so the expensive download step below stays cached while your code changes.') }),
  N('l3', 40, 610, 280, 64, 'RUN go mod download', 'layer (slow)', { detail: d('Slow step', 'Minutes of network. Cached as long as go.mod and go.sum have not changed.') }),
  N('l4', 40, 690, 280, 64, 'COPY . .', 'layer', { detail: d('Source', 'Changes on every commit. Everything above it stays cached; everything below rebuilds.') }),
  N('l5', 40, 770, 280, 64, 'RUN go build', 'layer', { detail: d('Compile', 'Reruns whenever COPY . . missed.') }),
  N('cfg', 40, 850, 280, 64, 'CMD · ENV · EXPOSE', 'config only, no layer', { detail: d('Metadata instructions', 'WORKDIR, ENV, EXPOSE, CMD, ENTRYPOINT, LABEL change the image config JSON, not the filesystem. They add no layer and cost nothing.') }),
  N('img', 370, 500, 260, 100, 'image', 'manifest → config + layers', { detail: d('Image', 'A manifest JSON listing the config blob and the layer blobs by sha256 digest. The image ID is the digest of the config. Tags are just names pointing at a manifest.', '$ docker image inspect app:1.0 --format "{{.Id}}"\nsha256:9f2c…\n$ docker manifest inspect app:1.0') }),
  N('stage', 370, 660, 260, 100, 'builder stage', 'toolchain, 900 MB', { dashed: true, detail: d('Multi-stage builds', 'FROM … AS build compiles; a second FROM starts from a tiny base and COPY --from=build takes only the binary. Only the last stage is shipped.', 'FROM golang:1.23 AS build\nRUN go build -o /app\nFROM gcr.io/distroless/static\nCOPY --from=build /app /app\nENTRYPOINT ["/app"]') }),
  N('final', 370, 820, 260, 100, 'runtime stage', 'distroless, 12 MB', { dashed: true, detail: d('Distroless / scratch', 'No shell, no package manager: nothing for an attacker to run and nothing to patch. Debug with an ephemeral sidecar or a -debug tag instead.') }),
  N('reg', 700, 500, 260, 100, 'registry', 'blobs by digest', { detail: d('Registry', 'Docker Hub, ECR, GHCR and Harbor speak the OCI distribution API: blobs (layers, configs) addressed by sha256, and manifests looked up by tag or digest. Existing blobs are never re-uploaded.', '$ docker push ghcr.io/me/app:1.0\n5f70bf18a086: Layer already exists\n9c2b3d4e5f6a: Pushed\n1.0: digest: sha256:7ab1… size: 1364') }),
  N('tag', 700, 660, 260, 100, 'tag → digest', 'latest moves', { detail: d('Tags and digests', 'A tag is a mutable pointer: app:latest can mean something else tomorrow. Pin deployments to app@sha256:… for reproducibility, and use tags for humans.', 'image: ghcr.io/me/app@sha256:7ab1c…') }),
  N('multi', 700, 820, 260, 100, 'manifest list', 'amd64 · arm64', { detail: d('Multi-arch images', 'One tag can point to a manifest list (image index) with one manifest per platform. docker pull picks the one matching the host CPU.', '$ docker buildx build --platform linux/amd64,linux/arm64 …') }),
];
const B_ALL = BUILD_NODES.map((n) => n.id);
const bOnly = (...keep: string[]) => B_ALL.filter((x) => !keep.includes(x));
const LAYERS = ['l1', 'l2', 'l3', 'l4', 'l5', 'cfg'];
const B_EDGES = ['ctx>bk', 'bk>cache', 'bk>img', 'img>reg', 'stage>final', 'reg>tag', 'reg>multi'];
const DF = ['FROM golang:1.23', 'WORKDIR /src', 'COPY go.mod go.sum ./', 'RUN go mod download', 'COPY . .', 'RUN go build -o /app', 'CMD ["/app"]'];
const bb = (code: string[], beats: Beat[], panel = 'Build', codeTitle = 'Dockerfile'): Board => ({ panel, codeTitle, code, lh: 30, nodes: BUILD_NODES, edges: B_EDGES, beats });

boardDemo(G, 'os-docker-build', 'Images: build, cache, registry', 'How a Dockerfile becomes layers, why step order decides cache hits, multi-stage builds, and what push and pull actually move.', {
  build: [
    'docker build',
    bb(DF, [
      { note: 'docker build first tars the build context and sends it to the daemon. .dockerignore decides what goes in.', hot: { ctx: 'current', 'ctx>bk': 'accent' }, hide: bOnly('ctx', 'bk'), rows: [['context', '2.1 MB']] },
      { note: 'FROM pulls the base image’s layers. Every image starts from someone else’s layers, or from scratch.', hl: [0], hot: { bk: 'current', l1: 'write' }, hide: bOnly('ctx', 'bk', 'l1'), rows: [['step 1/7', 'FROM']] },
      { note: 'Each COPY and RUN runs in a throwaway container from the previous layer, and its filesystem diff becomes a new read-only layer.', hl: [2, 3], hot: { bk: 'current', l2: 'write', l3: 'write' }, hide: bOnly('ctx', 'bk', 'l1', 'l2', 'l3'), rows: [['step 3/7', 'COPY → layer'], ['step 4/7', 'RUN → layer']] },
      { note: 'The source COPY and go build add two more layers, stacked in Dockerfile order.', hl: [4, 5], hot: { l4: 'write', l5: 'write' }, hide: bOnly('ctx', 'bk', ...LAYERS.slice(0, 5)), rows: [['layers so far', 5]] },
      { note: 'WORKDIR, ENV, EXPOSE and CMD touch no files. They go into the image config JSON and add no layer.', hl: [1, 6], hot: { cfg: 'read' }, hide: bOnly('bk', ...LAYERS), rows: [['fs layers', 5], ['config only', 'WORKDIR · CMD']] },
      { note: 'The result is a manifest: the config blob plus the layer digests. The image ID is the hash of the config.', hot: { img: 'ok', 'bk>img': 'accent' }, hide: bOnly('bk', ...LAYERS, 'img'), rows: [['image', 'sha256:9f2c…', 'ok']] },
    ]),
  ],
  cache: [
    'The layer cache',
    bb(DF, [
      { note: 'Rebuild after editing main.go. BuildKit checks each step against the cache, top down.', hot: { bk: 'current', cache: 'read', 'bk>cache': 'accent' }, hide: bOnly('bk', 'cache', ...LAYERS), rows: [['changed', 'main.go']] },
      { note: 'FROM and WORKDIR: same inputs, cache hit. COPY go.mod go.sum: file checksums unchanged, hit.', hl: [0, 1, 2], hot: { l1: 'ok', l2: 'ok' }, hide: bOnly('bk', 'cache', ...LAYERS), rows: [['steps 1–3', 'CACHED', 'ok']] },
      { note: 'RUN go mod download: same command, same parent layer, hit. The slow step is skipped entirely.', hl: [3], hot: { l3: 'ok' }, hide: bOnly('bk', 'cache', ...LAYERS), rows: [['step 4', 'CACHED', 'ok'], ['saved', '~3 min']] },
      { note: 'COPY . .: main.go’s checksum changed, so this step misses, and every step after it must rerun.', hl: [4, 5], hot: { l4: 'fail', l5: 'warn', cfg: 'warn' }, hide: bOnly('bk', 'cache', ...LAYERS), rows: [['step 5', 'miss', 'fail'], ['steps 6–7', 'rerun', 'warn']] },
      { note: 'Had the source COPY come before go mod download, every code change would re-download all dependencies: order from rarely to often changed.', hl: [2, 3, 4], hot: { l2: 'ok', l3: 'ok', l4: 'read' }, hide: bOnly('bk', 'cache', ...LAYERS), rows: [['rule', 'deps before source', 'ok']] },
      { note: 'In CI the cache is empty each run unless you export it: --cache-to/--cache-from a registry, or a mounted cache for package managers.', hot: { cache: 'read', reg: 'read' }, hide: bOnly('bk', 'cache', 'reg'), rows: [['CI', '--cache-from type=registry'], ['RUN --mount', 'type=cache']] },
    ], 'Cache'),
  ],
  multistage: [
    'Multi-stage builds',
    bb(['FROM golang:1.23 AS build', 'RUN go build -o /app', '', 'FROM gcr.io/distroless/static', 'COPY --from=build /app /app', 'ENTRYPOINT ["/app"]'], [
      { note: 'A single-stage image ships the whole toolchain: compiler, git, apt, a shell. 900 MB to run one binary.', hl: [0, 1], hot: { stage: 'warn' }, hide: bOnly('stage'), rows: [['image', '900 MB', 'warn']] },
      { note: 'A second FROM starts a fresh stage from a tiny base. Nothing from the first stage comes along by default.', hl: [3], hot: { final: 'current' }, hide: bOnly('stage', 'final'), rows: [['base', 'distroless/static']] },
      { note: 'COPY --from=build takes just the binary across. Only the last stage becomes the image.', hl: [4, 5], hot: { final: 'ok', 'stage>final': 'accent', stage: 'visited' }, hide: bOnly('stage', 'final', 'img'), rows: [['image', '12 MB', 'ok']] },
      { note: 'No shell and no package manager means less to patch and nothing for an attacker to run. Debug with a -debug tag or an ephemeral container.', hot: { final: 'ok' }, hide: bOnly('stage', 'final'), rows: [['CVEs', 'far fewer', 'ok'], ['docker exec sh', 'no shell']] },
    ]),
  ],
  registry: [
    'Push, pull, tags',
    bb(['$ docker push ghcr.io/me/app:1.0', '5f70bf18a086: Layer already exists', '9c2b3d4e5f6a: Pushed', '1.0: digest: sha256:7ab1… size: 1364'], [
      { note: 'push uploads blobs by digest: the layers and the config. A blob the registry already has is skipped, even from another repository.', hl: [0, 1, 2], hot: { img: 'read', reg: 'current', 'img>reg': 'accent' }, hide: bOnly('img', 'reg'), rows: [['uploaded', '1 of 6 layers'], ['skipped', 'already exists']] },
      { note: 'Last, the manifest is uploaded and the tag 1.0 is pointed at its digest.', hl: [3], hot: { reg: 'ok', tag: 'write', 'reg>tag': 'accent' }, hide: bOnly('img', 'reg', 'tag'), rows: [['tag 1.0', '→ sha256:7ab1…']] },
      { note: 'pull does the reverse: fetch the manifest by tag, then only the layer blobs missing locally.', hot: { reg: 'read', img: 'write', 'img>reg': 'accent' }, hide: bOnly('img', 'reg', 'tag'), rows: [['pull', 'manifest, then missing blobs']] },
      { note: 'A tag is a mutable pointer. latest today is not latest tomorrow, so deploy by digest and let tags be for humans.', hot: { tag: 'warn' }, sub: { tag: 'app@sha256:7ab1…' }, hide: bOnly('reg', 'tag'), rows: [['deploy by', 'digest', 'ok'], ['latest', 'moves', 'warn']] },
      { note: 'One tag can point at a manifest list with an entry per platform. pull picks the one that matches the host CPU.', hot: { multi: 'current', 'reg>multi': 'accent' }, hide: bOnly('reg', 'tag', 'multi'), rows: [['platforms', 'amd64 · arm64'], ['buildx', '--platform']] },
    ], 'Registry', 'shell'),
  ],
});

// ---------------- networking, volumes, compose, lifecycle ----------------
const RT_NODES = [
  N('cli', 40, 300, 280, 90, 'docker CLI', 'REST → dockerd', { detail: d('docker CLI', 'Sends REST calls to dockerd over /var/run/docker.sock. Whoever can write to that socket is root on the host.') }),
  N('dockerd', 370, 300, 260, 90, 'dockerd', 'networks · volumes · images', { detail: d('dockerd', 'Owns networks, volumes and images; delegates the actual containers to containerd. A restart of dockerd need not kill containers (live-restore).') }),
  N('shim', 700, 300, 260, 90, 'containerd-shim', 'one per container', { detail: d('containerd-shim', 'A tiny process that stays as the container’s parent, holds its stdio and exit code, so containerd and dockerd can restart without killing your app.', '$ ps -ef | grep containerd-shim\ncontainerd-shim-runc-v2 -namespace moby -id 3f9…') }),
  N('eth0', 40, 470, 280, 90, 'host eth0', '203.0.113.7', { detail: d('Host interface', 'The only address the outside world sees. iptables NAT translates between it and the private bridge network.') }),
  N('nat', 370, 470, 260, 90, 'iptables NAT', 'DNAT · MASQUERADE', { detail: d('NAT rules', 'Outbound: MASQUERADE rewrites container source IPs to the host’s. Inbound: -p 8080:80 adds a DNAT rule from host port 8080 to the container IP:80.', '$ sudo iptables -t nat -L DOCKER -n\nDNAT tcp dpt:8080 to:172.17.0.2:80\n$ sudo iptables -t nat -L POSTROUTING -n\nMASQUERADE 172.17.0.0/16') }),
  N('br', 700, 470, 260, 90, 'docker0 bridge', '172.17.0.1/16', { detail: d('docker0', 'A Linux bridge (virtual switch) on the host. Each container’s veth plugs into it; the bridge has 172.17.0.1 and is the containers’ default gateway.', '$ ip addr show docker0\ninet 172.17.0.1/16\n$ bridge link\nveth3a1b: master docker0') }),
  N('c1', 700, 630, 260, 90, 'nginx', 'eth0 172.17.0.2', { detail: d('Container network namespace', 'Its own eth0 is one end of a veth pair; the other end sits in the bridge. Own routes, own port space, so two containers can both listen on :80.', '$ docker exec nginx ip addr\neth0: 172.17.0.2/16\n$ docker exec nginx ip route\ndefault via 172.17.0.1') }),
  N('c2', 700, 790, 260, 90, 'api', 'eth0 172.17.0.3'),
  N('dns', 370, 630, 260, 90, 'embedded DNS', '127.0.0.11', { detail: d('Container DNS', 'On user-defined networks dockerd runs a resolver at 127.0.0.11 inside each container that answers service and container names. The default bridge has no name resolution (only the old --link).', '$ docker exec api getent hosts db\n172.18.0.3  db') }),
  N('upper', 40, 630, 280, 70, 'writable layer', 'dies with the container', { detail: d('Writable layer', 'Copy-on-write on top of the image. docker rm deletes it; it is also slow for heavy writes because of overlayfs copy-up.') }),
  N('vol', 40, 720, 280, 70, 'named volume', '/var/lib/docker/volumes', { detail: d('Named volume', 'Managed by Docker, survives container removal, portable across hosts with plugins. The default answer for databases.', '$ docker volume create pgdata\n$ docker run -v pgdata:/var/lib/postgresql/data postgres') }),
  N('bind', 40, 810, 280, 70, 'bind mount', 'host path', { detail: d('Bind mount', 'A host directory mounted straight in. Great for source code in development; couples you to the host’s paths and uids in production.', '$ docker run -v $PWD:/src -w /src node npm test') }),
  N('tmpfs', 40, 900, 280, 70, 'tmpfs', 'RAM only', { detail: d('tmpfs mount', 'Lives in memory, never touches disk. For secrets and scratch files.', '$ docker run --tmpfs /run:rw,size=64m …') }),
  N('state', 370, 790, 260, 90, 'created → running → exited', 'exit 0 · 137 · 143', { detail: d('Container states', 'created (namespaces, no process) → running → paused/exited. Exit code 143 = SIGTERM, 137 = SIGKILL (or OOM). docker rm deletes the writable layer.', '$ docker inspect -f "{{.State.Status}} {{.State.ExitCode}}" api\nexited 143') }),
];
const R_ALL = RT_NODES.map((n) => n.id);
const rOnly = (...keep: string[]) => R_ALL.filter((x) => !keep.includes(x));
const R_EDGES = ['cli>dockerd', 'dockerd>shim', 'eth0>nat', 'nat>br', 'br>c1', 'br>c2', 'dns>c1', 'dns>c2', 'shim>state'];
const rb = (code: string[], beats: Beat[], panel: string, codeTitle = 'shell'): Board => ({ panel, codeTitle, code, nodes: RT_NODES, edges: R_EDGES, beats });
const NET = ['eth0', 'nat', 'br', 'c1'];

boardDemo(G, 'os-docker-runtime', 'Networking, volumes & compose', 'Where -p 8080:80 really goes (veth, bridge, iptables), which storage survives what, how compose wires services by name, and what stop actually sends.', {
  bridge: [
    'Bridge networking',
    rb(['$ docker run -d -p 8080:80 nginx', '$ curl http://203.0.113.7:8080'], [
      { note: 'The container gets a network namespace with its own eth0: one end of a veth pair. The other end plugs into the docker0 bridge.', hl: [0], hot: { c1: 'current', br: 'current', 'br>c1': 'accent' }, hide: rOnly('br', 'c1'), rows: [['container IP', '172.17.0.2'], ['gateway', '172.17.0.1']] },
      { note: 'Outbound traffic leaves via the bridge and is MASQUERADEd to the host’s address, so the internet sees 203.0.113.7.', hot: { c1: 'read', nat: 'current', eth0: 'ok', 'nat>br': 'accent', 'eth0>nat': 'accent' }, hide: rOnly(...NET), rows: [['outbound', 'MASQUERADE']] },
      { note: '-p 8080:80 adds a DNAT rule: packets arriving at host port 8080 are rewritten to 172.17.0.2:80 and forwarded over the bridge.', hl: [1], hot: { eth0: 'current', nat: 'current', c1: 'ok', 'eth0>nat': 'accent', 'nat>br': 'accent', 'br>c1': 'accent' }, hide: rOnly(...NET), rows: [['inbound', 'DNAT :8080 → 172.17.0.2:80']] },
      { note: 'Every container has its own port space, so nginx and api can both listen on 80. Only published ports collide on the host.', hot: { c1: 'ok', c2: 'ok' }, hide: rOnly(...NET, 'c2'), rows: [['port 80', 'per container', 'ok']] },
      { note: 'On the default bridge containers reach each other only by IP. Put them on a user-defined network and names resolve too.', hot: { dns: 'warn', c1: 'read', c2: 'read' }, hide: rOnly(...NET, 'c2', 'dns'), rows: [['default bridge', 'IPs only', 'warn'], ['docker network create', 'names + DNS']] },
    ], 'Network'),
  ],
  volumes: [
    'Where data lives',
    rb(['$ docker run -v pgdata:/var/lib/postgresql/data postgres', '$ docker run -v $PWD:/src -w /src node npm test', '$ docker run --tmpfs /run:size=64m app'], [
      { note: 'Anything written inside the container lands in its writable layer. docker rm deletes it, and overlayfs copy-up makes it slow for databases.', hot: { upper: 'warn' }, hide: rOnly('upper'), rows: [['survives rm', 'no', 'fail']] },
      { note: 'A named volume is a directory Docker manages under /var/lib/docker/volumes, mounted straight in. It outlives the container.', hl: [0], hot: { vol: 'ok' }, hide: rOnly('upper', 'vol'), rows: [['survives rm', 'yes', 'ok'], ['for', 'databases, uploads']] },
      { note: 'A bind mount exposes a host directory. Ideal for source code while developing, but it ties the image to host paths and uids.', hl: [1], hot: { bind: 'current' }, hide: rOnly('upper', 'vol', 'bind'), rows: [['for', 'dev loops'], ['gotcha', 'host uid ≠ container uid', 'warn']] },
      { note: 'tmpfs stays in RAM and never hits disk: secrets, sockets, scratch space.', hl: [2], hot: { tmpfs: 'current' }, hide: rOnly('upper', 'vol', 'bind', 'tmpfs'), rows: [['for', 'secrets, /run']] },
      { note: 'Rule: image = code, volume = state. If you would be sad to lose it, it does not belong in the writable layer.', hot: { vol: 'ok', upper: 'read' }, hide: rOnly('upper', 'vol', 'bind', 'tmpfs'), rows: [['state', 'volumes', 'ok'], ['code', 'image', 'ok']] },
    ], 'Storage'),
  ],
  compose: [
    'docker compose',
    rb(['services:', '  api: { build: ., ports: ["8080:80"], depends_on: [db] }', '  db:  { image: postgres, volumes: [pgdata:/var/lib/postgresql/data] }', 'volumes: { pgdata: {} }'], [
      { note: 'compose up reads the file and creates a private network named after the project. Every service joins it.', hl: [0], hot: { dockerd: 'current', br: 'write' }, sub: { br: 'proj_default 172.18.0.0/16' }, hide: rOnly('dockerd', 'br'), rows: [['network', 'proj_default']] },
      { note: 'Volumes declared at the bottom are created once and reused across restarts, so the database keeps its data.', hl: [3], hot: { vol: 'write' }, sub: { vol: 'proj_pgdata' }, hide: rOnly('dockerd', 'br', 'vol'), rows: [['volume', 'proj_pgdata']] },
      { note: 'Containers start as proj-db-1 and proj-api-1. depends_on orders the starts; with condition: service_healthy it also waits for the healthcheck.', hl: [1, 2], hot: { c2: 'current', c1: 'current', 'br>c1': 'accent', 'br>c2': 'accent' }, label: { c1: 'db', c2: 'api' }, sub: { c1: '172.18.0.2', c2: '172.18.0.3' }, hide: rOnly('br', 'c1', 'c2', 'vol'), rows: [['start order', 'db, then api']] },
      { note: 'api connects to postgres://db:5432. The embedded DNS at 127.0.0.11 resolves db to its container IP on this network.', hot: { dns: 'ok', 'dns>c2': 'accent', 'dns>c1': 'accent', c2: 'read' }, label: { c1: 'db', c2: 'api' }, sub: { c1: '172.18.0.2', c2: '172.18.0.3' }, hide: rOnly('br', 'c1', 'c2', 'dns'), rows: [['db →', '172.18.0.2', 'ok']] },
      { note: 'Only api publishes a port. db is reachable from api but not from the host or the internet, which is the default you want.', hl: [1], hot: { eth0: 'read', nat: 'read', c2: 'ok', c1: 'ok' }, label: { c1: 'db', c2: 'api' }, sub: { c1: 'no ports', c2: ':8080 → 80' }, hide: rOnly('eth0', 'nat', 'br', 'c1', 'c2'), rows: [['exposed', 'api only', 'ok']] },
    ], 'Compose', 'compose.yaml'),
  ],
  lifecycle: [
    'Start, stop, exit codes',
    rb(['$ docker stop api        # SIGTERM, wait 10 s, SIGKILL', '$ docker inspect -f "{{.State.ExitCode}}" api', '143'], [
      { note: 'docker run = create + start. create sets up namespaces, cgroup and the writable layer; start execs the entrypoint under a containerd-shim.', hot: { cli: 'current', dockerd: 'read', shim: 'write', 'cli>dockerd': 'accent', 'dockerd>shim': 'accent', state: 'write' }, sub: { state: 'created → running' }, hide: rOnly('cli', 'dockerd', 'shim', 'state'), rows: [['state', 'running']] },
      { note: 'The shim stays as the parent process and holds stdout/stderr. dockerd can restart underneath without your container noticing.', hot: { shim: 'ok', 'shim>state': 'accent' }, hide: rOnly('cli', 'dockerd', 'shim', 'state'), rows: [['docker logs', 'reads shim’s json-file'], ['live-restore', 'survives dockerd restart']] },
      { note: 'docker stop sends SIGTERM to pid 1 of the container and waits 10 seconds. If pid 1 is a shell that ignores signals, nothing happens until…', hl: [0], hot: { state: 'warn' }, sub: { state: 'SIGTERM → grace 10 s' }, hide: rOnly('cli', 'dockerd', 'shim', 'state'), rows: [['signal', 'SIGTERM'], ['grace', '10 s']] },
      { note: '…SIGKILL. A clean exit on SIGTERM gives 143 (128 + 15); a kill gives 137 (128 + 9), the same code as an OOM kill.', hl: [1, 2], hot: { state: 'fail' }, sub: { state: 'exited 143 / 137' }, hide: rOnly('cli', 'dockerd', 'shim', 'state'), rows: [['143', 'SIGTERM handled'], ['137', 'SIGKILL or OOM', 'fail']] },
      { note: 'Use exec-form ENTRYPOINT so your app is pid 1 and gets the signal, or tini as a tiny init. --restart=unless-stopped brings it back after crashes.', hot: { state: 'ok' }, sub: { state: 'ENTRYPOINT ["/app"]' }, hide: rOnly('cli', 'dockerd', 'shim', 'state'), rows: [['pid 1', 'your app or tini', 'ok'], ['restart policy', 'unless-stopped']] },
    ], 'Lifecycle'),
  ],
});
