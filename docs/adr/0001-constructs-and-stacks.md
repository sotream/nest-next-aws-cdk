# 0001. Small constructs, one environment stack, a thin app entry

- Status: accepted
- Date: 2026-10-30

## Context

The project exists to show how CDK code can be structured. CDK makes it easy to put everything into one large
stack class, which is hard to test and hard to read. The Terraform sibling uses single-purpose modules, one
composition module and thin environment roots.

## Decision

- `lib/constructs/*` hold one single-purpose construct per file (network, database, cache, secrets, ecr, alb,
  service, migration, alarms, github-deploy-role). A construct takes plain props, exposes what others need
  (`vpc`, `connections`, `url`) and knows nothing about environments by name.
- `lib/stacks/env-stack.ts` is the only place that composes them for one environment. `shared-stack.ts` holds
  what all environments share: ECR repositories and the GitHub OIDC trust.
- `bin/app.ts` only reads configuration (context and environment variables), picks a profile from
  `lib/config.ts` and instantiates stacks. It contains no resources.
- Profiles (`dev`, `stage`, `prod`, `preview`) are data in `lib/config.ts`. A preview is not a fifth stack
  class: `pr-<number>` resolves to the `preview` profile.
- Environment stacks refer to the shared ECR repositories by name, not by cross-stack reference, so deploying
  a preview never depends on an export of the shared stack.
- Grants come from `grant*` methods and `ecs.Secret` where the resource is in the same stack. The deploy roles
  are the exception (ADR 0003).

## Consequences

- Each construct can be synthesised and asserted alone, and the tests read like the spec.
- Adding an environment means adding a profile, not a class.
- CDK's generated logical ids depend on the construct tree, so moving a construct later replaces its resource.
  Renames need care once something is deployed.
- Fixed names for the cluster and services (`nest-next-<env>`) are needed by the deploy workflow and make a
  later rename a replacement.
