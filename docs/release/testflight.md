# TestFlight external testing

App Store Connect → TestFlight → External Testing → **+** group → add the build. First build of a version goes through Beta App Review (~1 day).

## Test Information

Beta App Description (≤4000):

```
Distributed is an offline system-design simulator. Drag gateways, load balancers, databases, caches, queues and consensus groups onto a canvas, wire them up, fire traffic at them and watch what happens. Then break things: kill a node, partition the network, skew a clock, take a region down, force a split brain.

No account, no network; everything is built in.

What's in this beta:
• Sandbox canvas with traffic patterns and fault injection
• Runnable lessons across system-design topics
• 20 design problems with pass/fail challenges
• Step-through algorithm animations
```

Feedback Email: `you@example.com`

## Contact Information

| Field | Value |
|---|---|
| First Name | `Solomon` |
| Last Name | `Xie` |
| Phone number | TODO — yours, with country code (`+1 …`) |
| Email | `you@example.com` |

## Sign-In Information

Sign-in required: **off** (no account in the app). Leave User Name / Password blank.

Review Notes: paste the App Review Notes block from [listing.md](listing.md) if present.

## Per build: What to Test

```
Open a lesson from Home and run it to the end. Build a small design in the Sandbox, send traffic, then inject a fault and watch the result. Try one design problem and get it to pass. Report anything confusing, any wrong explanation, and any lag on the canvas, with a screenshot via TestFlight.
```
