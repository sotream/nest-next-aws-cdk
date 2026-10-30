# Agent context: read this first

Handoff file for a Claude agent on another account or machine. It carries the working rules and the state of the owner's GitHub work. Private material (finances, interview preparation, personal facts) is left out on purpose.

## Owner

- Andrii Prisniak, Hamburg, senior fullstack/backend developer. GitHub: `sotream` (the personal repositories below).
- Talks to the agent in Ukrainian; replies should be short and plain. Code, commit messages, pull request text and repository docs are written in normal English.
- Commits in `sotream/*` use the repository's own configured identity. Never add `Co-Authored-By` or "Generated with" lines to commits or pull requests.

## How to work (rules from earlier sessions)

1. Work the way product companies do: one issue per feature, short spec, branch, small pull request with its tests in the same repository, required CI, human review, squash merge. No hidden test repositories, no big-bang runs.
2. Few commits, grouped by task. No chains of tiny commits.
3. Never push to `main` of a repository that has protected `main`; open a pull request. The owner reviews and merges, unless he explicitly grants the agent merge rights for a repository.
4. Fonts and assets are self-hosted, no CDN (IP privacy).
5. Ask choice questions through the interactive question tool, not as plain-text lists.
6. Do not publish, pin or link private repositories. Publication decisions are the owner's.
7. Do not touch a directory where another agent is working: clone to a scratch folder instead.
8. Do not run anything that changes a cloud account (`cdk deploy`, `terraform apply`) unless the owner asks for that exact action.
9. Facts about the owner come only from his own words; do not invent or infer them.

## Machine notes

- Repositories live in `~/projects`. GitHub over SSH; the host alias `github2.com` is used for `sotream/*` remotes. Check `git remote -v` in an existing clone.
- Node 24 with pnpm for the TypeScript projects.

## Repositories (`sotream`)

Public: `nest-next-starter` (NestJS + Next.js + PostgreSQL + Redis), `nest-next-aws-terraform` (Terraform for the starter on ECS Fargate, not applied to a real account), `nuxt-flagboard`, `kafka-pay-lab`, `access-control-lab`, `CodeSage`, `sotream` (profile).

Private: `paneloom` (self-hosted AI dashboard builder), `shortlink-lab`, `claims-lab`, `ledger-lab`, `lawwatch-lab`, `xrechnung`, `users-fastapi`, `nestjs-rbac`, `agent-lab`, `dark-factory-lab`, `portfolio-roadmap`, `senior-cheatsheets`, `nest-next-aws-cdk` (new).

## Current task: `sotream/nest-next-aws-cdk`

Private repository, created 2026-10-30. It holds `docs/spec.md` (the specification), `CLAUDE.md` (agent rules) and a README stub. Nothing is implemented yet.

Goal: deploy `nest-next-starter` with AWS CDK (TypeScript) and add a preview environment per pull request. It mirrors `nest-next-aws-terraform`, so read that repository's `docs/adr` and `docs/guides/ci-cd.md` for the shape of the infrastructure and the deploy flow.

Instruction for the agent:

1. Clone `git@github2.com:sotream/nest-next-aws-cdk.git` and read `CLAUDE.md` and `docs/spec.md`.
2. Open one GitHub issue per feature from spec section 9, in that order.
3. Implement feature 1 on a branch, with its tests, and open a pull request. Wait for CI. Do not merge.
4. Never run `cdk deploy`; `cdk synth` and tests only.
5. If the spec is ambiguous or impossible, say so in the pull request instead of guessing.
