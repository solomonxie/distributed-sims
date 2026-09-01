Brand icons in this folder are sourced from two open icon sets:

- [Simple Icons](https://simpleicons.org) — CC0 1.0 (public domain)
- [Devicon](https://devicon.dev) — MIT License (used for AWS-family
  services and Memcached, which Simple Icons doesn't carry)

Filenames match `name:` entries in `catalog/catalog.yaml` and don't
always match the upstream project's own slug (e.g. `bigquery.svg` came
from Simple Icons' `googlebigquery` icon). Every AWS-branded catalog entry
(API Gateway, ALB, CloudFront, DynamoDB, SQS, Lambda, Step Functions,
EventBridge) points at the single generic `aws.svg` — neither icon set
ships per-service AWS icons.

`microservice.svg` and `monolith.svg` are hand-drawn placeholders (no
upstream brand to represent — compute is intentionally generic, see
DESIGN.md section 5).
