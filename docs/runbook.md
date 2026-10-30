# Runbook

None of this has been run against an AWS account. Commands are what is expected to work; each step that
changes an account is **yours**: the agent rules in `CLAUDE.md` forbid `cdk deploy`.

## Setup, once per account

See the step-by-step [AWS setup guide](aws-setup.md): CDK bootstrap, the shared stack with the GitHub OIDC
trust and deploy roles, the GitHub variables and Environments, and the first deploy.

## Deploy an environment

Actions, deploy, Run workflow: choose the environment and the full 40-character commit SHA of
`sotream/nest-next-starter`. Branch and tag names are rejected.

```bash
git ls-remote https://github.com/sotream/nest-next-starter main
```

Read the `cdk diff` in the job summary. If the workflow stops with "would replace or delete the database",
do not re-run with `allow_db_replacement` unless that is intended and a snapshot exists.

## Previews

Open a pull request against `main` from a branch of this repository. The `preview` workflow deploys it and
posts the URL; closing the pull request destroys it. To check what the nightly clean-up would remove:
Actions, preview-cleanup, Run workflow, with `dry_run` on.

## Roll back

- A failing rollout rolls back by itself (ECS circuit breaker). The deploy workflow then fails at the deploy
  step; the services keep the previous image.
- To go back to an earlier image, run the deploy workflow with the earlier starter SHA. The migration task
  only moves the schema forward: reverting a schema change is a manual database task.

## Rotate a secret

Secrets are generated once and read at task start. To change one, replace its value in Secrets Manager (for
the database, also change the database user's password), then restart the services:

```bash
aws ecs update-service --cluster nest-next-<env> --service nest-next-<env>-api --force-new-deployment
aws ecs update-service --cluster nest-next-<env> --service nest-next-<env>-web --force-new-deployment
```

The URL secrets are derived from the others by dynamic references; they pick up a change on the next stack
update.

## Destroy an environment

Previews: close the pull request. Others:

```bash
pnpm exec cdk destroy nest-next-<env> -c env=<env>
```

The database takes a final snapshot (`Snapshot` removal policy) and the secrets and log groups are retained;
delete those by hand if you want a clean slate. The `shared` stack retains the ECR repositories on purpose.

## Troubleshooting

| Symptom                                    | Look at                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Migration step fails                       | The `migrate` log group of the stack; the workflow prints the stopped reason               |
| Tasks stop right after start               | Log groups of the services; a secret the execution role cannot read is the usual cause     |
| Preview comment missing                    | `AWS_PREVIEW_ROLE_ARN` unset (the workflow is skipped), or the pull request is from a fork |
| `AccessDenied` on assume role              | The Environment's branch restriction, the role's trust subject, the variable value         |
| Synth fails with an `AwsSolutions` finding | Fix it or acknowledge it next to the construct with a written reason                       |
