// Kubernetes on one node (group machine-os-k8s): pod → process via CRI, Services via kube-proxy and CoreDNS, requests/limits → cgroups, probes.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Beat, Board } from '../machine/lib/board';

const d = (title: string, text: string, code?: string): Detail => ({ title, text, code });
const G = 'machine-os-k8s';

const NODES = [
  N('api', 40, 300, 280, 90, 'API server', 'watch: pods on node-1', { detail: d('API server', 'The only thing the kubelet talks to. It watches for pods bound to its node and reports status back. Every object here is backed by etcd.', '$ kubectl get pod web-7d4f -o jsonpath="{.spec.nodeName}"\nnode-1') }),
  N('kubelet', 370, 300, 260, 90, 'kubelet', 'node agent', { detail: d('kubelet', 'Runs on every node. Turns pod specs into containers, runs probes, reports status, and enforces requests/limits through cgroups. It does not run containers itself: it drives a CRI runtime.', '$ journalctl -u kubelet | grep web-7d4f\nSyncPod … Creating sandbox\nStarted container web') }),
  N('cri', 700, 300, 260, 90, 'CRI (gRPC)', 'containerd · CRI-O', { detail: d('Container Runtime Interface', 'A gRPC API: RunPodSandbox, PullImage, CreateContainer, StartContainer, … Dockershim is gone; containerd or CRI-O implement it directly and call runc.', '$ crictl pods\n$ crictl ps\n$ crictl inspect <id> | jq .info.runtimeSpec.linux') }),
  N('pause', 700, 470, 260, 90, 'pause container', 'holds the netns', { detail: d('The pause container', 'A tiny process that does nothing but hold the pod’s network (and IPC) namespace open. App containers join it, which is why containers in a pod share localhost and one IP.', '$ crictl ps -a | grep pause\nregistry.k8s.io/pause:3.9') }),
  N('cni', 370, 470, 260, 90, 'CNI plugin', 'veth + pod IP', { detail: d('CNI', 'After the sandbox exists, the runtime calls the CNI plugin (Calico, Cilium, Flannel, AWS VPC CNI). It creates the veth, assigns the pod IP from the node’s range and installs routes or eBPF.', '$ cat /etc/cni/net.d/10-calico.conflist\n$ kubectl get pod web-7d4f -o wide   # IP 10.244.1.17') }),
  N('web', 700, 630, 260, 90, 'web container', 'joins pause netns', { detail: d('App container', 'CreateContainer + StartContainer: runc puts it in the pause container’s net and IPC namespaces, its own pid and mount namespaces, and the pod’s cgroup.') }),
  N('side', 700, 790, 260, 90, 'log sidecar', 'same IP, localhost', { detail: d('Sidecar', 'Another container in the same pod: same IP, can reach web on localhost, shares volumes. Since 1.29 init containers with restartPolicy: Always are the native sidecar form.') }),
  N('cg', 370, 630, 260, 90, 'pod cgroup', 'cpu.max · memory.max', { detail: d('Requests and limits', 'Requests decide scheduling and cpu.weight. Limits become cpu.max (CFS quota per 100 ms) and memory.max. Over memory.max → OOMKilled (137); over cpu.max → throttled, not killed.', '$ cat /sys/fs/cgroup/kubepods.slice/…/memory.max\n268435456\n$ cat …/cpu.max\n50000 100000    # 0.5 CPU') }),
  N('svc', 40, 470, 280, 90, 'Service web', 'ClusterIP 10.96.0.42', { detail: d('Service', 'A stable virtual IP and DNS name in front of a changing set of pods. The ClusterIP is not on any interface; it exists only as NAT rules on every node.', '$ kubectl get svc web\nweb  ClusterIP  10.96.0.42  80/TCP\n$ kubectl get endpointslice -l kubernetes.io/service-name=web') }),
  N('kp', 40, 630, 280, 90, 'kube-proxy', 'iptables / IPVS', { detail: d('kube-proxy', 'Watches Services and EndpointSlices and programs iptables (or IPVS, nftables) on every node: ClusterIP:port → one of the Ready pod IPs, picked at random. Cilium replaces it with eBPF.', '$ iptables -t nat -L KUBE-SERVICES -n | grep 10.96.0.42\nKUBE-SVC-… tcp dpt:80\n# → KUBE-SEP-… DNAT to 10.244.1.17:80 (prob 0.33)') }),
  N('dns', 40, 790, 280, 90, 'CoreDNS', 'web.default.svc → ClusterIP', { detail: d('CoreDNS', 'Runs as pods; every pod’s /etc/resolv.conf points at its Service. web resolves via search domains to web.default.svc.cluster.local → the ClusterIP.', '$ kubectl exec api -- getent hosts web\n10.96.0.42  web.default.svc.cluster.local') }),
  N('probe', 370, 790, 260, 90, 'probes', 'startup · readiness · liveness', { detail: d('Probes', 'startup gates the others while the app boots. readiness failing removes the pod from EndpointSlices (no traffic, no restart). liveness failing makes the kubelet kill and restart the container.', 'livenessProbe:  { httpGet: { path: /healthz, port: 8080 }, periodSeconds: 10, failureThreshold: 3 }\nreadinessProbe: { httpGet: { path: /ready,   port: 8080 } }') }),
];
const ALL = NODES.map((n) => n.id);
const only = (...keep: string[]) => ALL.filter((x) => !keep.includes(x));
const EDGES = ['api>kubelet', 'kubelet>cri', 'cri>pause', 'cni>pause', 'pause>web', 'pause>side', 'cg>web', 'svc>kp', 'kp>web', 'dns>svc', 'kubelet>probe', 'probe>web', 'probe>svc', 'kubelet>cg'];
const kb = (code: string[], beats: Beat[], panel: string, codeTitle = 'shell'): Board => ({ panel, codeTitle, code, nodes: NODES, edges: EDGES, beats });

boardDemo(G, 'os-k8s-node', 'Inside a Kubernetes node', 'What the kubelet does with a pod: CRI calls, the pause container and CNI, Services as iptables rules, requests and limits as cgroups, and what each probe really does.', {
  pod: [
    'Pod → process',
    kb(['kubelet: watch pods where spec.nodeName == node-1', 'CRI: PullImage → RunPodSandbox → CreateContainer → StartContainer'], [
      { note: 'The scheduler wrote spec.nodeName = node-1. The kubelet on node-1 sees the pod in its watch and starts syncing it.', hl: [0], hot: { api: 'current', kubelet: 'current', 'api>kubelet': 'accent' }, hide: only('api', 'kubelet'), rows: [['pod', 'web-7d4f'], ['phase', 'Pending']] },
      { note: 'It pulls the image and asks the runtime, over CRI, to create the sandbox: a pause container that holds the pod’s network namespace.', hl: [1], hot: { cri: 'current', pause: 'write', 'kubelet>cri': 'accent', 'cri>pause': 'accent' }, hide: only('api', 'kubelet', 'cri', 'pause'), rows: [['RunPodSandbox', 'pause']] },
      { note: 'The runtime calls the CNI plugin, which adds a veth into that namespace and gives the pod its IP. One IP per pod, not per container.', hot: { cni: 'current', pause: 'ok', 'cni>pause': 'accent' }, sub: { pause: '10.244.1.17' }, hide: only('api', 'kubelet', 'cri', 'pause', 'cni'), rows: [['pod IP', '10.244.1.17']] },
      { note: 'Each app container is created and started into the pause container’s net and IPC namespaces, with its own pid and mount namespaces. Underneath it is runc, the same as Docker.', hot: { web: 'current', 'pause>web': 'accent', cri: 'read' }, hide: only('api', 'kubelet', 'cri', 'pause', 'cni', 'web'), rows: [['StartContainer', 'web'], ['runtime', 'runc']] },
      { note: 'A sidecar shares the IP and can reach web on localhost. The kubelet reports Running back to the API server.', hot: { side: 'ok', web: 'ok', 'pause>side': 'accent', api: 'write' }, hide: only('api', 'kubelet', 'pause', 'web', 'side'), rows: [['containers', 2], ['phase', 'Running', 'ok']] },
    ], 'Pod'),
  ],
  service: [
    'Service → pod',
    kb(['$ kubectl get svc web', 'web  ClusterIP  10.96.0.42  80/TCP', '$ iptables -t nat -L KUBE-SERVICES -n | grep 10.96.0.42'], [
      { note: 'A Service gets a ClusterIP from a virtual range. No interface anywhere has this address.', hl: [0, 1], hot: { svc: 'current' }, hide: only('svc'), rows: [['ClusterIP', '10.96.0.42 (virtual)']] },
      { note: 'The EndpointSlice controller lists the IPs of Ready pods matching the selector. Not Ready means not in the list.', hot: { svc: 'read', web: 'ok' }, sub: { svc: 'endpoints: 3 pods' }, hide: only('svc', 'web'), rows: [['endpoints', '10.244.1.17, .2.9, .3.4']] },
      { note: 'kube-proxy on every node turns that into NAT rules: traffic to 10.96.0.42:80 is DNATed to one endpoint, chosen at random.', hl: [2], hot: { kp: 'current', 'svc>kp': 'accent', 'kp>web': 'accent', web: 'read' }, hide: only('svc', 'kp', 'web'), rows: [['DNAT', '→ 10.244.1.17:80'], ['pick', 'random, per connection']] },
      { note: 'CoreDNS maps web (via search domains, web.default.svc.cluster.local) to the ClusterIP, so clients never see pod IPs.', hot: { dns: 'current', 'dns>svc': 'accent', svc: 'read' }, hide: only('svc', 'kp', 'web', 'dns'), rows: [['web →', '10.96.0.42']] },
      { note: 'NodePort opens the same rules on a host port; LoadBalancer asks the cloud for an external IP pointing at those node ports. Ingress adds HTTP routing on top.', hot: { svc: 'ok', kp: 'ok' }, sub: { svc: 'ClusterIP ⊂ NodePort ⊂ LoadBalancer' }, hide: only('svc', 'kp', 'web', 'dns'), rows: [['NodePort', ':30080 on every node'], ['LoadBalancer', 'cloud LB → NodePorts']] },
    ], 'Service'),
  ],
  limits: [
    'Requests, limits, cgroups',
    kb(['resources:', '  requests: { cpu: 250m, memory: 128Mi }', '  limits:   { cpu: 500m, memory: 256Mi }'], [
      { note: 'Requests are for the scheduler: a node must have that much unreserved CPU and memory to take the pod. They also set cpu.weight for contention.', hl: [1], hot: { api: 'read', kubelet: 'read' }, hide: only('api', 'kubelet'), rows: [['fits if', 'Σ requests ≤ allocatable']] },
      { note: 'Limits are for the kubelet: it writes them into the pod’s cgroup as memory.max and cpu.max.', hl: [2], hot: { cg: 'current', 'kubelet>cg': 'accent', 'cg>web': 'accent' }, sub: { cg: 'memory.max 256Mi · cpu.max 0.5' }, hide: only('kubelet', 'cg', 'web'), rows: [['memory.max', '268435456'], ['cpu.max', '50000 100000']] },
      { note: 'Use more than 256 MiB and the kernel OOM-kills the container: exit 137, reason OOMKilled, then a restart with back-off.', hot: { cg: 'fail', web: 'fail' }, sub: { web: 'OOMKilled · exit 137' }, hide: only('kubelet', 'cg', 'web'), rows: [['memory limit', 'kill', 'fail']] },
      { note: 'CPU is different: over 500m the container is throttled to 50 ms of every 100 ms period, then waits. Tail latency spikes, nothing dies.', hot: { cg: 'warn', web: 'warn' }, sub: { web: 'throttled' }, hide: only('kubelet', 'cg', 'web'), rows: [['cpu limit', 'throttle, not kill', 'warn'], ['nr_throttled', 'rising']] },
      { note: 'requests == limits → Guaranteed; requests < limits → Burstable; none → BestEffort. Under node pressure the kubelet evicts BestEffort first.', hl: [1, 2], hot: { cg: 'ok', kubelet: 'read' }, hide: only('kubelet', 'cg', 'web'), rows: [['QoS', 'Burstable'], ['evicted first', 'BestEffort']] },
    ], 'Resources'),
  ],
  probes: [
    'Probes',
    kb(['startupProbe:   /healthz  failureThreshold: 30', 'readinessProbe: /ready    periodSeconds: 5', 'livenessProbe:  /healthz  failureThreshold: 3'], [
      { note: 'The kubelet runs the probes, not the API server. A startup probe gates the other two while a slow app boots.', hl: [0], hot: { kubelet: 'read', probe: 'current', 'kubelet>probe': 'accent' }, hide: only('kubelet', 'probe', 'web'), rows: [['startup', 'up to 30 × 10 s']] },
      { note: 'Readiness failing removes the pod from the Service’s endpoints: traffic stops but the container keeps running. It comes back when the probe passes.', hl: [1], hot: { probe: 'warn', 'probe>svc': 'fail', svc: 'warn', web: 'read' }, sub: { svc: 'endpoints: 2 pods' }, hide: only('kubelet', 'probe', 'web', 'svc'), rows: [['readiness fail', 'out of rotation', 'warn'], ['restart', 'no']] },
      { note: 'Liveness failing three times makes the kubelet kill the container and start a new one in the same pod. Restart count goes up.', hl: [2], hot: { probe: 'fail', 'probe>web': 'fail', web: 'fail' }, sub: { web: 'restarts: 1' }, hide: only('kubelet', 'probe', 'web'), rows: [['liveness fail', 'restart', 'fail']] },
      { note: 'Repeated crashes back off: 10 s, 20 s, 40 s… up to 5 minutes. That is CrashLoopBackOff.', hot: { web: 'fail', kubelet: 'warn' }, sub: { web: 'CrashLoopBackOff' }, hide: only('kubelet', 'probe', 'web'), rows: [['back-off', '10 s → 5 min']] },
      { note: 'A liveness check that calls the database turns a database blip into a restart storm. Liveness asks whether the process is stuck, readiness whether it can serve right now.', hot: { probe: 'ok', web: 'ok' }, hide: only('kubelet', 'probe', 'web', 'svc'), rows: [['liveness', 'process alive?', 'ok'], ['readiness', 'dependencies ok?', 'ok']] },
    ], 'Probes'),
  ],
});
