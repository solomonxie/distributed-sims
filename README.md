# Distributed Systems Simulator

An interactive web UI for drawing real distributed-system topologies —
microservices, monoliths, CDNs, distributed DBs, Kafka/event streams, API
gateways, load balancers, frontend/backend clients — and simulating traffic
and incidents against them. Change one component's behavior live (e.g. bump
a service's latency from 50ms to 500ms) and watch how the change cascades
through the rest of the system, with alerts firing where you've defined
them (p99 latency, error rate, saturation...). Useful both for reproducing
real-world distributed-systems incidents in a safe, visual way, and as a
general-purpose system-design canvas with preset reference architectures
and incident scenarios.

## Features

- Canvas editor (Excalidraw-style interactions) with a fixed palette of
  real, supported components instead of freeform shapes
- System topologies and traffic/incident scenarios defined as portable,
  git-friendly YAML
- Simulation engine that propagates load/latency/saturation through the
  dependency graph and animates it live
- Per-component alert rules (p99 latency, error rate, saturation, ...)
- Live "tweak and watch it cascade" interaction while a simulation runs
- Preset architectures and preset incident scenarios as reference material
- Rough cloud cost estimate per system

See [DESIGN.md](DESIGN.md) for the architecture, YAML schemas, simulation
model, and roadmap.

## Quick start

Not yet functional — scaffold stage only (see roadmap in DESIGN.md).

```
make install
make dev
```

## License

MIT — see [LICENSE](LICENSE).
