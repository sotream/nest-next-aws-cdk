# Runbook

None of this has been run against an AWS account. Commands are what is expected to work; each step that
changes an account is **yours**: the agent rules in `CLAUDE.md` forbid `cdk deploy`.

## Setup, once per account

1. **Bootstrap CDK** in the account and region:

   ```bash
   pnpm exec cdk bootstrap aws://<account-id>/<region>
   ```

   The deploy roles assume the bootstrap roles named `cdk-hnb659fds-*`. If you bootstrap with another
   qualifier, change `qualifier` in `lib/constructs/github-deploy-role.ts`.

2. **Deploy the shared stack** (ECR, OIDC provider, roles). If the account already has a GitHub OIDC provider,
   pass its ARN so a second one is not created:

   ```bash
   GITHUB_OIDC_PROVIDER_ARN=arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com \
     pnpm exec cdk deploy nest-next-shared
   ```

   The outputs are the role ARNs for the next step.

3. **GitHub repository variables** (Settings, Secrets and variables, Actions, Variables). There are no secrets:
   authentication is OIDC.

   | Variable                                                              | Scope                | Used for                                             |
   | --------------------------------------------------------------------- | -------------------- | ---------------------------------------------------- |
   | `AWS_PREVIEW_ROLE_ARN`                                                | repository           | Output `PreviewRoleArn`; without it previews are off |
   | `STARTER_REF`                                                         | repository           | Full SHA of the starter commit previews build        |
   | `AWS_REGION`                                                          | repository, optional | Defaults to `eu-central-1`                           |
   | `DOMAIN_NAME_<ENV>`, `HOSTED_ZONE_ID_<ENV>`, `HOSTED_ZONE_NAME_<ENV>` | repository           | Public domain; `<ENV>` is `DEV`, `STAGE`, `PROD`     |
   | `ALARM_EMAIL_<ENV>`                                                   | repository, optional | Alarm recipient (confirm the subscription email)     |
   | `AWS_DEPLOY_ROLE_ARN`                                                 | GitHub Environment   | Output `DeployRoleArn<Env>` of that environment      |

4. **GitHub Environments** `dev`, `stage`, `prod`. Add required reviewers to `stage` and `prod`. On **every**
   Environment, including `dev`, restrict **Deployment branches** to `main`: the OIDC subject names the
   Environment, not the branch, so without this a branch with edited workflow code could deploy with the role.
5. **Branch protection** for `main`: require pull requests and the `check` and `secrets` checks, block force
   pushes. The repository does not configure this.
6. **Stage and prod need a domain**: without one they synthesise with a warning and run the API as
   `APP_ENV=dev` over HTTP.

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
