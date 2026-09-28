# Traffic & chaos events

Source: `content/chaos.yaml`, `content/traffic.yaml`. Everything here can be
fired live (Run mode) or scheduled on the scenario timeline.

## Traffic sources

| Shape | Knobs |
|---|---|
| Constant | rps |
| Ramp | from → to over duration |
| Burst | multiplier × for duration (e.g. 20× for 5s) |
| Spike train | period, height |
| Diurnal | peak, trough, period (compressed day) |
| Flash crowd | ticket drop / live event: instant 100× with decay |
| Replay | built-in traces (e.g. "Black Friday", "viral tweet") |

Per source: op mix (read/write %, per route), key distribution (uniform /
zipf s / hot-key %), payload size, tenant mix, client region mix, auth
(anonymous / token / expired-token %).

**Single message**: tap a client → "Send one" fires one traced request (w=1)
and follows it hop by hop — the teaching primitive.

## Destructive / fault events

| Group | Event | Target |
|---|---|---|
| Node | Kill · Restart · Crash-loop | node |
| | Slow (latency ×N) · CPU hog · GC pause (stop-the-world Xs) | node |
| | Memory leak (→ OOM) · Disk full · FD / conn-pool exhaustion | node |
| | Bad deploy (error rate %) · Config push (all instances at once) | node |
| Network | Partition (A ⟂ B, symmetric / asymmetric) | edge / container pair |
| | Latency +X ms · Jitter · Packet loss % · Bandwidth cap | edge |
| | DNS failure · TLS cert expired | node / edge |
| Data | Hot key · Replica lag +Xs · Cache flush (cold cache) | data node |
| | Corrupt write · Lost write (ack then crash) · Split brain | data node |
| | Shard rebalance · Schema migration lock | data node |
| Time | Clock skew ±X ms · Clock jump | node |
| Traffic | Thundering herd (N clients sync retry) · Retry storm | source |
| | Bot / DDoS · Poison message (always fails consumer) | source / queue |
| Infra | AZ down · Region down · Dependency (external API) outage | container / node |
| Security | Token signing key rotated · Credential leak (abusive client) | IdP / source |
| Protocol | Kill leader · Kill 2PC coordinator after prepare · Drop votes | consensus / txn |

Every event: optional duration (auto-heal) or permanent until "Heal".
"Heal all" always available.
