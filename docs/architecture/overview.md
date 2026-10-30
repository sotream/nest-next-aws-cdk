# Architecture overview

Two kinds of stacks, both defined in `bin/app.ts` and composed from the constructs in `lib/constructs/`.

```
nest-next-shared            one per account
  ECR repositories           nest-next/api, nest-next/web (immutable tags)
  GitHub OIDC provider
  deploy roles               dev, stage, prod  (one per GitHub Environment)
  preview role               pull_request workflows and the nightly job

nest-next-<env>             dev, stage, prod, and pr-<number> for previews
  Network                    VPC, 2 AZs, public and private subnets, NAT, flow logs
  Secrets                    database, Redis token, JWT key (generated)
  Database                   RDS PostgreSQL, private, encrypted, TLS enforced -> DATABASE_URL secret
  Cache                      ElastiCache Redis, TLS and AUTH                  -> REDIS_URL secret
  Alb                        public, HTTP or HTTPS with a domain
  Cluster                    ECS, Container Insights
  Service api                port 4000, /api/*   (target health: /api/health/live)
  Service web                port 3000, /*       (target health: /sign-in)
  MigrationTask              task definition only, started by the deploy workflow
  Alarms                     SNS topic (KMS) and 11 alarms
```

## Request path

Browser to the ALB. `/api/*` goes to the `api` service, everything else to `web`. Both run in private subnets;
only the API's security group can reach the database and Redis, and the migration task's can reach the
database. Without a domain the ALB serves plain HTTP on its own name and the API runs as `APP_ENV=dev`, because
the starter refuses `APP_ENV=prod` over HTTP.

## Profiles

| Profile   | NAT | Tasks per service | Database                        | Redis             | Logs | Deleted with stack |
| --------- | --- | ----------------- | ------------------------------- | ----------------- | ---- | ------------------ |
| `dev`     | 1   | 1                 | `t4g.micro`, single-AZ, backups | 1 node            | 7 d  | no                 |
| `stage`   | 2   | 2                 | `t4g.small`, Multi-AZ, backups  | 2 nodes, failover | 14 d | no                 |
| `prod`    | 2   | 2                 | `t4g.medium`, Multi-AZ, backups | 2 nodes, failover | 30 d | no                 |
| `preview` | 1   | 1                 | `t4g.micro`, no backups         | 1 node            | 3 d  | yes                |

The values are in `lib/config.ts`. They are defaults chosen for this repository, not requirements.

## Deployment flow

`scripts/rollout.sh`, used by both the deploy and the preview workflow:

1. Deploy the stack with the services on the image they run now (none on the first deployment, so they start
   with zero tasks).
2. Build the API and web images from the pinned starter commit and push them. The web image inlines the public
   origin at build time, so the tag is the commit plus a hash of the origin. Existing tags are reused.
3. Deploy again with the new image on the migration task, run it once with `ecs run-task` and require exit 0.
4. Deploy the services on the new image. The ECS circuit breaker rolls a failing rollout back.
5. Smoke test `/api/health/ready` and `/sign-in` through the public origin.

## Guardrails

- `cdk-nag` (AwsSolutions) runs on every synth and in the tests. Acknowledgements live next to the construct
  they concern and carry a reason.
- Tests assert the properties the spec lists: no action wildcards, private and encrypted data stores, the
  execution role can read every secret its task references, previews are destroyed and others are not.
- CI runs `tsc`, eslint, prettier, jest, `cdk synth` for dev, stage, prod and a preview, and gitleaks.
- The deploy workflow posts `cdk diff` to the job summary and blocks a deploy that would replace or delete the
  database unless an input allows it.
