# 0003. Preview environments: lifecycle, roles and the limits of the sandbox

- Status: accepted
- Date: 2026-10-30

## Context

Every pull request gets its own environment. It must appear on open, update on push, disappear on close, and
never outlive its usefulness, because an orphaned preview costs about 4 USD a day. The workflow runs code from
a pull request branch with AWS access.

## Decision

- **Create and update**: `preview.yml` runs for pull requests against `main` from branches of this repository
  only. It deploys stack `nest-next-pr-<number>` with the `preview` profile from one pinned starter commit
  (variable `STARTER_REF`), through the same `scripts/rollout.sh` as the deploy workflow, smoke-tests it and
  keeps one comment with the URL, found by a hidden marker.
- **Destroy**: on close or merge the workflow runs `cdk destroy`. The `preview` profile uses `DESTROY` for the
  database, secrets and log groups, so nothing blocks deletion.
- **Safety net**: `preview-cleanup.yml` runs nightly and destroys `nest-next-pr-*` stacks whose pull request is
  closed, merged or missing, or that are older than seven days. It has a dry-run mode.
- **Roles**: long-lived environments have one deploy role each, assumable only from the matching GitHub
  Environment. Previews have one role that trusts `pull_request` workflows and the nightly job on `main`. Each
  role names resources by the stack prefix of its own environments, so the roles cannot act on each other's.
- **Hand-written statements**: the deploy roles assume the CDK bootstrap roles, run the migration task and read
  stack outputs. Those resources live in another stack, so a `grant*` method would need a cross-stack
  reference and create exactly the coupling ADR 0001 avoids. Each statement names its resources by prefix; the
  few `*` resources (ECR token, read-only Describe and List calls) have no resource-level permissions. A test
  pins the list and forbids action wildcards; cdk-nag acknowledges each wildcard with its reason.

## Consequences

- A preview costs about as much as `dev` while it exists; the seven-day cap bounds an orphan to roughly 28 USD.
- Previews get no seeded data and no domain; they run the API as `APP_ENV=dev` over HTTP.
- **The preview role is not a sandbox.** CDK creates resources through the bootstrap CloudFormation execution
  role, which is broad by default, and a same-repository pull request can change the CDK code and the workflow.
  A person who can push a branch here can therefore create what that execution role allows. Closing that gap
  needs a custom bootstrap with restricted execution policies and a permissions boundary. Until then, only
  trusted people should have write access to the repository. Fork pull requests are excluded in the workflow
  and receive no OIDC token from GitHub.
- The spec asks for a role limited to resources tagged `env=pr-*`. The role is limited by name prefix instead,
  which every action used supports and which is easier to reason about; the stacks are also tagged.
