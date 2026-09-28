# Inspector, cost drawer, presets

## Inspector rail — a component selected

300px, right, collapsible. Editable specs first, then alert rules.

```
┌────────────────────────────┐
│ orders-db                  │ ← instance name, editable
│ postgres · relational-db   │ ← catalog entry · type, mono, not editable
│ ────────────────────────   │
│ SPECS                      │
│ avg response ms      500   │ ← every field edits in place; editing one
│ max rps              200   │   during a run re-animates downstream
│ pool size             20   │   immediately — no "apply" step
│ replicas               3   │
│ ────────────────────────   │
│ ALERTS                     │
│ Orders DB Latency Spike    │
│ firing · critical          │ ← the badge repeats the canvas callout
│ p99 > 500ms                │
│ [ + Add alert rule ]       │
└────────────────────────────┘
```

## An edge selected

```
┌────────────────────────────┐
│ kong → order-service       │
│ ────────────────────────   │
│ Protocol           HTTP ▾  │
│ Payload size       2 KB    │
└────────────────────────────┘
```

## Nothing selected

```
┌────────────────────────────┐
│ Nothing selected           │
│ Click a component on the   │ ← a placeholder that says what to do, not
│ canvas to inspect it.      │   an empty rail
└────────────────────────────┘
```

## Cost drawer — replaces the rail, not stacked on it

340px.

```
┌──────────────────────────────┐
│ Cost Estimate            ✕   │
│ ──────────────────────────   │
│ orders-db                    │
│ db.r6g.large × 3       $312  │
│ kong                         │
│ 2 × t3.medium           $60  │
│ cloudfront                   │
│ 1 TB egress             $73  │
│ ──────────────────────────   │
│ Total            $445 / mo   │
│ Rough estimate, not a quote. │ ← said where the number is, not in a
│                              │   footnote elsewhere
│ No simulation running        │ ← what the estimate is based on
└──────────────────────────────┘
```

## Preset gallery — modal over a dimmed canvas

```
        ┌──────────────────────────────────────────────────┐
        │ Start from a preset                          ✕   │
        │ [ ARCHITECTURES | Incidents ]                    │
        │ ┌──────────────────────────────────────────────┐ │
        │ │ Sample E-commerce Microservices              │ │
        │ │ Client → gateway → order service → db +      │ │
        │ │ async event stream                           │ │
        │ │                              [[ Use this ]]  │ │
        │ ├──────────────────────────────────────────────┤ │
        │ │ 3-Tier Web App                               │ │
        │ │ Classic LB → app tier → relational DB        │ │
        │ │                              Coming soon  ·  │ │ ← named, and
        │ ├──────────────────────────────────────────────┤ │   disabled,
        │ │ Kafka Fan-out Pipeline                       │ │   rather than
        │ │ Event stream → parallel consumers →          │ │   hidden
        │ │ warehouse                                    │ │
        │ │                              Coming soon  ·  │ │
        │ └──────────────────────────────────────────────┘ │
        └──────────────────────────────────────────────────┘
```

Each card names the topology in one arrow line — a preset is chosen by
what it is shaped like, not by its title alone.
