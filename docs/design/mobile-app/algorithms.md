# Algorithm visualizer

Step-through animations of the algorithms distributed systems rely on.
Separate mode from the system simulator: its own canvas of **graph / ring /
grid / tree** primitives, a step engine, and a playback bar.

Source: `content/algorithms/<slug>.yaml` (default input + narration per step);
logic in `engine/algo/<slug>.ts` as a **generator** yielding frames:

```ts
function* dijkstra(g: Graph, src: Id): Generator<Frame> {
  // yield { highlight, dist, frontier, visited, note } at each step
}
```

Pure, deterministic, unit-tested on frame sequences. Playback = iterate
frames; step back = cached frames.

## Primitives (renderers)

| Primitive | Used by |
|---|---|
| Weighted graph (nodes, edges, weights, dist labels) | Dijkstra, A*, BFS/DFS, Bellman-Ford, topo sort, MST |
| Grid / map | A*, geohash, quadtree, S2-lite |
| Ring | consistent hashing, rendezvous hashing, Chord |
| Tree | trie, B-tree, LSM levels, Merkle tree, quadtree |
| Bit array / table | Bloom filter, count-min sketch, HyperLogLog |
| Cluster (nodes + messages) | gossip, vector clocks, Lamport clocks, Raft log |
| Timeline / bucket | token bucket, leaky bucket, sliding window |

## Demos (v1)

| Group | Demo | Linked from |
|---|---|---|
| Graph | Dijkstra shortest path | Google Maps, Network |
| | A* (grid + heuristic toggle) | Google Maps |
| | BFS / DFS traversal | Web crawler |
| | Contraction hierarchies (simplified) | Google Maps |
| | Topological sort (DAG of jobs) | YouTube pipeline, migrations |
| Partitioning | Consistent hashing + vnodes (add/remove node) | Sharding, KV store |
| | Rendezvous hashing | Sharding |
| Geo | Geohash encode + neighbour cells | Proximity, Yelp |
| | Quadtree insert / range query | Proximity |
| Probabilistic | Bloom filter (FP rate as it fills) | Web crawler, LSM |
| | Count-min sketch · HyperLogLog | Telemetry, top-K |
| Storage | LSM tree write + compaction | KV store |
| | B-tree insert / split | Relational DB |
| | Merkle tree diff (anti-entropy) | KV store |
| | Trie + top-K | Autocomplete |
| | Inverted index build + query | Search |
| Distributed | Gossip dissemination | KV store, membership |
| | Lamport & vector clocks | Consistency |
| | Raft log replication (zoomed) | Consensus |
| | CRDT merge (G-counter, OR-set) | Figma |
| | Snowflake ID bit layout | TinyURL, ID gen |
| Rate limit | Token / leaky bucket · sliding window | Rate limit |

User input: tap to add/remove nodes and edges, drag to move, tap an edge to
edit weight, pick source/target — then Play.
