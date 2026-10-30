# AWS setup guide

From an empty AWS account and this repository to a working `dev` deployment and working preview environments.
Every step has the command and what you should see afterwards.

> **Nothing in this guide has been run against a real AWS account.** The commands and the expected output are
> written from the code in this repository and from the AWS, CDK and GitHub documentation. Read
> [What was verified and what was not](#16-what-was-verified-and-what-was-not) before you rely on it, and
> expect to fix small things on the first real run.

> **Cost warning.** A `dev` environment costs roughly 4 USD a day while it exists, and so does every open
> preview. Read [Cost](#13-cost) before step 8. Destroy what you do not use.

Placeholders: `<ACCOUNT_ID>` is your 12-digit AWS account id, `<REGION>` the region (for example
`eu-central-1`), `OWNER/REPO` your GitHub repository (this one is `sotream/nest-next-aws-cdk`).

---

## 1. Prerequisites

You need:

- **An AWS account** and a person who can act as an administrator in it **for the one-time setup** (steps 3
  and 4). Bootstrapping and the shared stack create IAM roles, an OIDC provider, ECR repositories and
  CloudFormation resources, so `AdministratorAccess` is the practical choice. The workflows afterwards use the
  narrower roles from step 4, not your user.
- **A region.** Pick one and use it everywhere. The code is single-region and defaults to `eu-central-1`
  where a default is needed (the workflows read the repository variable `AWS_REGION`). The shared stack, the
  bootstrap and `AWS_REGION` **must all name the same region**.
- **A GitHub repository** that holds this code, and GitHub Actions enabled. Private repositories need a plan
  that includes Environments with required reviewers and branch protection (Pro, Team or Enterprise), and
  Actions minutes.
- **On your computer:** the [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html),
  Node 24, pnpm, [GitHub CLI `gh`](https://cli.github.com/) (optional, every `gh` command has a click path),
  and `git`.
- **Optional:** a Route 53 hosted zone if you want HTTPS on your own domain (step 10). Without a domain,
  `dev` and previews run over plain HTTP on the load balancer's own name.

Check the tools:

```bash
aws --version          # aws-cli/2.x
node --version         # v24.x
pnpm --version
gh --version           # optional
```

## 2. Get the code and check it without AWS

```bash
git clone git@github.com:OWNER/REPO.git
cd REPO
pnpm install --frozen-lockfile
pnpm run build && pnpm run lint && pnpm run format:check
pnpm test
pnpm exec cdk synth -c env=dev --quiet
```

Expected: `tsc`, eslint and prettier print nothing alarming, jest ends with `Tests: ... passed`, and
`cdk synth` ends with `Successfully synthesized to .../cdk.out`. No AWS credentials are needed for any of it.

## 3. Prepare the account: log in and bootstrap CDK

Log in with an administrator identity and tell the CLI which region to use:

```bash
aws configure sso            # or: aws configure
export AWS_REGION=<REGION>
export AWS_DEFAULT_REGION=<REGION>
aws sts get-caller-identity
```

Expected: JSON with `"Account": "<ACCOUNT_ID>"` and the ARN of the identity you intended.

Bootstrap CDK in that account and region. This creates the `CDKToolkit` stack: an S3 bucket, an ECR repository
for assets, and the roles CDK deploys through. Do it once per account and region:

```bash
pnpm exec cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

Expected: the last line is `✅  Environment aws://<ACCOUNT_ID>/<REGION> bootstrapped.` Check it:

```bash
aws cloudformation describe-stacks --stack-name CDKToolkit --query "Stacks[0].StackStatus" --output text
```

Expected: `CREATE_COMPLETE` (or `UPDATE_COMPLETE`).

The deploy roles in step 4 are written for the **default bootstrap qualifier** `hnb659fds`. If you bootstrap with
another qualifier, change `qualifier` in `lib/constructs/github-deploy-role.ts` first.

> **Security note.** By default the bootstrap CloudFormation execution role has administrator rights, and the
> deploy and preview roles can assume the bootstrap roles. That is why a person who can push a branch to this
> repository can, in effect, create anything in the account. See
> [ADR 0003](adr/0003-preview-lifecycle.md). To narrow it, bootstrap with
> `--cloudformation-execution-policies` and a permissions boundary; this repository does not do that for you.

## 4. Create the GitHub OIDC trust and the deploy roles (the shared stack)

GitHub Actions authenticates to AWS with short-lived OpenID Connect tokens, so **no AWS access keys are stored
in GitHub**. The trust is created by the `nest-next-shared` stack in this repository. You deploy that stack
by hand, once.

**What the stack creates, and what stays manual:**

| Created by the `nest-next-shared` stack                                             | Done by hand                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| The GitHub OIDC identity provider `token.actions.githubusercontent.com`             | `cdk bootstrap` (step 3)                                   |
| ECR repositories `nest-next/api` and `nest-next/web` (immutable tags, scan on push) | Running `cdk deploy nest-next-shared` once (this step)     |
| Deploy roles for `dev`, `stage`, `prod`                                             | Copying the role ARNs into GitHub variables (step 5)       |
| One preview role for pull requests and the nightly clean-up                         | GitHub Environments, branch protection, variables (step 5) |

**Trust-policy subjects** (the `sub` claim GitHub puts in the token; the audience is always `sts.amazonaws.com`):

| Role                   | Allowed subject(s), exact match                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `dev`, `stage`, `prod` | `repo:OWNER/REPO:environment:dev` (respectively `stage`, `prod`): only a job in that GitHub Environment |
| Previews               | `repo:OWNER/REPO:pull_request` and `repo:OWNER/REPO:ref:refs/heads/main` (the nightly clean-up)         |

The roles act only on resources whose names start with their own prefix (`nest-next-dev-*`,
`nest-next-pr-*`); the environment roles cannot touch previews and the other way round.

**The repository name is read at synth time.** The stack trusts `GITHUB_REPOSITORY` if it is set and
`sotream/nest-next-aws-cdk` otherwise. On your own copy, set it, or the roles will trust the wrong repository:

```bash
export GITHUB_REPOSITORY=OWNER/REPO
```

An account can have only one GitHub OIDC provider. Check whether yours already has one:

```bash
aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[].Arn" --output text
```

- If the output contains `.../oidc-provider/token.actions.githubusercontent.com`, reuse it:

  ```bash
  export GITHUB_OIDC_PROVIDER_ARN=arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com
  ```

- Otherwise leave `GITHUB_OIDC_PROVIDER_ARN` unset and the stack creates the provider.

Look at what will change, then deploy (CDK asks you to confirm the IAM changes):

```bash
pnpm exec cdk diff nest-next-shared
pnpm exec cdk deploy nest-next-shared
```

Expected: a list of IAM and ECR resources to create, then `✅  nest-next-shared` and an `Outputs:` block with
`DeployRoleArnDev`, `DeployRoleArnStage`, `DeployRoleArnProd` and `PreviewRoleArn`. Write them down, or read
them again whenever you need:

```bash
aws cloudformation describe-stacks --stack-name nest-next-shared \
  --query "Stacks[0].Outputs[].[OutputKey,OutputValue]" --output text
```

## 5. Configure GitHub

There are **no GitHub secrets** to create: authentication is OIDC and the workflows use only the built-in
`GITHUB_TOKEN`. (One exception: if the repository belongs to a GitHub organisation, the gitleaks action in `ci`
needs a license key stored as the secret `GITLEAKS_LICENSE`; personal repositories do not.)

Everything below is a **variable** (Settings, Secrets and variables, Actions, Variables).

| Variable                                                              | Scope                      | Holds                                                                                    |
| --------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| `AWS_REGION`                                                          | repository                 | The region of step 3. Defaults to `eu-central-1` when unset                              |
| `AWS_PREVIEW_ROLE_ARN`                                                | repository                 | Output `PreviewRoleArn`. While it is unset, the preview workflows are skipped            |
| `STARTER_REF`                                                         | repository                 | Full 40-character commit SHA of `sotream/nest-next-starter` that previews build (step 9) |
| `AWS_DEPLOY_ROLE_ARN`                                                 | GitHub Environment `dev`   | Output `DeployRoleArnDev`                                                                |
| `AWS_DEPLOY_ROLE_ARN`                                                 | GitHub Environment `stage` | Output `DeployRoleArnStage`                                                              |
| `AWS_DEPLOY_ROLE_ARN`                                                 | GitHub Environment `prod`  | Output `DeployRoleArnProd`                                                               |
| `DOMAIN_NAME_<ENV>`, `HOSTED_ZONE_ID_<ENV>`, `HOSTED_ZONE_NAME_<ENV>` | repository, optional       | Domain, Route 53 zone id and zone name; `<ENV>` is `DEV`, `STAGE` or `PROD` (step 10)    |
| `ALARM_EMAIL_<ENV>`                                                   | repository, optional       | Recipient of the alarm topic; confirm the subscription email                             |

`AWS_DEPLOY_ROLE_ARN` is an **Environment** variable, not a repository variable: the role differs per
Environment. The per-environment domain and e-mail values are repository variables with a suffix, because the
deploy workflow reads them by name.

### 5.1 Variables with the GitHub CLI

```bash
gh variable set AWS_REGION --body "<REGION>" --repo OWNER/REPO
gh variable set AWS_PREVIEW_ROLE_ARN --body "<PreviewRoleArn>" --repo OWNER/REPO
```

Expected: `✓ Created variable AWS_REGION for OWNER/REPO` (and the same for the other).

### 5.2 GitHub Environments `dev`, `stage`, `prod`

Create the three Environments (Settings, Environments, New environment) or with the CLI:

```bash
for env in dev stage prod; do
  gh api --method PUT repos/OWNER/REPO/environments/$env --silent
done
```

Then set the role variable on each Environment (use the matching output from step 4):

```bash
gh variable set AWS_DEPLOY_ROLE_ARN --env dev   --body "<DeployRoleArnDev>"   --repo OWNER/REPO
gh variable set AWS_DEPLOY_ROLE_ARN --env stage --body "<DeployRoleArnStage>" --repo OWNER/REPO
gh variable set AWS_DEPLOY_ROLE_ARN --env prod  --body "<DeployRoleArnProd>"  --repo OWNER/REPO
```

Two protections matter. Set them in the UI (Settings, Environments, the environment) if you prefer:

1. **Required reviewers on `stage` and `prod`.** A deploy to them then waits for approval.
2. **Deployment branches limited to `main` on all three, including `dev`.** The OIDC `sub` names the
   Environment, not the branch. Without this limit, a branch with edited workflow code could deploy with the
   role.

```bash
REVIEWER_ID=$(gh api users/<your-github-login> --jq .id)
for env in stage prod; do
  gh api --method PUT repos/OWNER/REPO/environments/$env --input - <<EOF
{ "reviewers": [{ "type": "User", "id": $REVIEWER_ID }],
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
EOF
done
gh api --method PUT repos/OWNER/REPO/environments/dev --input - <<'EOF'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
EOF
for env in dev stage prod; do
  gh api --method POST repos/OWNER/REPO/environments/$env/deployment-branch-policies -f name=main --silent
done
```

Expected: no error output. In Settings, Environments you see the branch rule `main` on each Environment and the
reviewer on `stage` and `prod`. (The Environment API calls are written from the GitHub documentation and were
not run; use the UI if one fails.)

### 5.3 Protect `main`

Require pull requests and the two checks from `ci.yml`, **`check`** and **`secrets`**, and block force pushes.
In the UI: Settings, Branches, Add branch protection rule, `main`. Or:

```bash
gh api --method PUT repos/OWNER/REPO/branches/main/protection --input - <<'EOF'
{ "required_status_checks": { "strict": true, "contexts": ["check", "secrets"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null,
  "allow_force_pushes": false }
EOF
```

If you are the only maintainer you cannot approve your own pull request; set
`required_approving_review_count` to `0`.

## 6. First deploy of `dev`

### 6.1 Choose the starter commit

The deploy builds images from a **pinned commit** of `nest-next-starter`, never from a branch name:

```bash
git ls-remote https://github.com/sotream/nest-next-starter main
```

Expected: one line, `<40-character SHA>	refs/heads/main`. Copy the SHA.

### 6.2 Run the Deploy workflow

Actions, **deploy**, Run workflow: choose `dev`, paste the SHA, leave `allow_db_replacement` off. Or:

```bash
gh workflow run deploy.yml --repo OWNER/REPO -f environment=dev -f starter_ref=<SHA>
gh run watch --repo OWNER/REPO
```

### 6.3 What the workflow does and what to expect

| Step                     | What happens                                                                                  | Expected                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Validate the starter ref | Rejects anything that is not 40 hex characters                                                | Passes                                                              |
| Assume the role          | OIDC token for the `dev` Environment                                                          | `Assuming role with OIDC`                                           |
| Current image tag        | Asks ECS what runs now                                                                        | Nothing on the first run                                            |
| Diff                     | `cdk diff` goes to the job summary; blocks a deploy that would replace or delete the database | A long list of `[+]` resources on the first run                     |
| Roll out, infrastructure | `cdk deploy nest-next-dev` with the services at **zero tasks** (no image exists yet)          | The slow step: RDS and ElastiCache take the longest. Not measured   |
| Roll out, images         | Builds `api` and `web` from the SHA, tags them `<sha12>-<origin hash>`, pushes to ECR         | `api:<tag>` and `web:<tag>` pushed                                  |
| Roll out, migration      | Registers the migration task with the new image, runs it once, requires exit code 0           | `Migration task: arn:aws:ecs:...`, no error                         |
| Roll out, services       | `cdk deploy` with the new tag; ECS starts the tasks and waits for a steady state              | Stack `UPDATE_COMPLETE`                                             |
| Smoke test               | `GET <origin>/api/health/ready` and `GET <origin>/sign-in`                                    | The readiness JSON, then `Smoke test passed: http://<alb-dns-name>` |

Get the address of the environment:

```bash
aws cloudformation describe-stacks --stack-name nest-next-dev \
  --query "Stacks[0].Outputs[?OutputKey=='Origin'].OutputValue" --output text
```

Expected: `http://nest-next-dev-...elb.<REGION>.amazonaws.com`. Open it: the starter's sign-in page loads.
Without a domain the site is HTTP only, and `dev` runs the API as `APP_ENV=dev` because the starter refuses
`APP_ENV=prod` over HTTP.

`stage` and `prod` are deployed the same way (with required reviewers approving first), but **need a domain**
(step 10); without one they synthesise with a warning and run as `APP_ENV=dev`.

## 7. Check what is running

```bash
aws ecs describe-services --cluster nest-next-dev --services nest-next-dev-api nest-next-dev-web \
  --query "services[].[serviceName,runningCount,desiredCount]" --output text
```

Expected: both services with `runningCount` equal to `desiredCount` (1 in `dev`).

## 8. Preview environments

**Prerequisite:** repository variables `AWS_PREVIEW_ROLE_ARN` and `STARTER_REF` (step 5). While
`AWS_PREVIEW_ROLE_ARN` is unset, the workflows are skipped, not failed.

How it works:

1. Open a pull request **against `main` from a branch of this repository**. Fork pull requests are excluded.
2. The `preview` workflow assumes the preview role, deploys stack `nest-next-pr-<number>` with the `preview`
   profile (one NAT gateway, one task per service, smallest database and cache, no backups, destroyed with the
   stack), builds images from `STARTER_REF`, runs the migration and smoke-tests it.
3. **The URL appears as a comment on the pull request.** One comment is kept and edited on every push (it
   starts with a hidden marker). If the deploy fails, the same comment links to the failed run.
4. **On close or merge**, the `preview` workflow runs `cdk destroy` for `nest-next-pr-<number>` and updates
   the comment to `Preview destroyed.`
5. **Nightly safety net.** `preview-cleanup` runs at 03:17 UTC and destroys every `nest-next-pr-*` stack whose
   pull request is closed, merged or missing, or that is older than seven days.

Expected on a new pull request: the `deploy` job of `preview` succeeds and the comment
`Preview for <sha7> of this pull request: http://...` appears.

To change which starter code previews build, update `STARTER_REF`:

```bash
gh variable set STARTER_REF --body "<new 40-character SHA>" --repo OWNER/REPO
```

### Check for orphaned preview stacks

List all preview stacks and their age:

```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE ROLLBACK_COMPLETE CREATE_FAILED DELETE_FAILED \
  --query "StackSummaries[?starts_with(StackName, 'nest-next-pr-')].[StackName,CreationTime,StackStatus]" --output table
```

Compare with the open pull requests (`gh pr list --repo OWNER/REPO --state open`). Anything else is an
orphan. See what the nightly job would remove, without removing it:

```bash
gh workflow run preview-cleanup.yml --repo OWNER/REPO -f dry_run=true
gh run watch --repo OWNER/REPO
```

Expected in the log: `Would destroy nest-next-pr-<n>` for each orphan, or nothing. Run it with
`-f dry_run=false` to destroy them now. The scheduled run always destroys.

## 9. Pin the starter for previews

`STARTER_REF` is one commit for all previews. Take a SHA as in step 6.1 and set it as shown in step 8. A
preview of a pull request on this repository then deploys that starter commit with the infrastructure from
the pull request branch.

## 10. Optional: your own domain (HTTPS)

With a domain the load balancer serves HTTPS with an ACM certificate, redirects HTTP to HTTPS and a Route 53
alias points the name at it. You need a **public hosted zone in Route 53 in the same account**; the
certificate is validated through DNS in that zone.

Look up the zone:

```bash
aws route53 list-hosted-zones-by-name --dns-name example.com \
  --query "HostedZones[0].[Id,Name]" --output text
```

Expected: `/hostedzone/Z0123456789ABC	example.com.` Use `Z0123456789ABC` (without `/hostedzone/`) as the id and
`example.com` (without the trailing dot) as the zone name. Then set, for `prod` (replace the suffix with `DEV`
or `STAGE` as needed):

```bash
gh variable set DOMAIN_NAME_PROD      --body "app.example.com"  --repo OWNER/REPO
gh variable set HOSTED_ZONE_ID_PROD   --body "Z0123456789ABC"   --repo OWNER/REPO
gh variable set HOSTED_ZONE_NAME_PROD --body "example.com"      --repo OWNER/REPO
```

All three are required together: the app refuses to synthesise with a domain but no zone. Run the deploy
workflow again. Expected: the stack output `Origin` becomes `https://app.example.com`, the certificate
validates through DNS during the deploy (a few minutes), and `APP_ENV` becomes `prod`.

To receive alarms, set `ALARM_EMAIL_<ENV>` and confirm the subscription mail from SNS.

## 11. Roll back

- **A failed rollout rolls back by itself.** The ECS deployment circuit breaker returns the service to the
  previous task definition, and the deploy workflow fails at its last deploy step. The services keep the
  previous image.
- **Go back to an earlier version:** run the deploy workflow with the earlier starter SHA (images are reused
  from ECR). The migration task only moves the schema forward: undoing a schema change is a manual database
  task.
- **Re-run after a fix:** run the deploy workflow again. It is safe to repeat; existing image tags are reused.

## 12. Destroy an environment, rotate secrets

### Destroy

Previews: close the pull request. A long-lived environment:

```bash
pnpm exec cdk destroy nest-next-dev -c env=dev
```

Expected: `✅  nest-next-dev: destroyed`. Not removed on purpose: the database snapshot taken on delete, the
secrets and log groups of `dev`, `stage` and `prod` (their removal policy is Retain), and the ECR repositories
in `nest-next-shared`. Delete them by hand for a clean slate. Remove the shared stack last:
`pnpm exec cdk destroy nest-next-shared` removes the deploy roles (and the OIDC provider, if the stack created
it) but **keeps the two ECR repositories**, because they are retained; delete them by hand. Remove the
`CDKToolkit` stack only if you will not use CDK in this account again.

### Rotate a secret

Secrets are generated once and read when a task starts. To change one, replace the value in Secrets
Manager (for the database password, also change the database user's password), then restart the services:

```bash
aws ecs update-service --cluster nest-next-dev --service nest-next-dev-api --force-new-deployment
aws ecs update-service --cluster nest-next-dev --service nest-next-dev-web --force-new-deployment
```

The `DATABASE_URL` and `REDIS_URL` secrets are composed from the others by dynamic references and pick up a
change on the next stack update. Rotation is not automated.

## 13. Cost

Each environment, including every open preview, runs a NAT gateway, a load balancer, an RDS instance and a
Redis node. A `dev` or a preview is about **4 USD a day**; stage and prod are more. A preview that survives a
closed pull request is stopped by the nightly clean-up after at most seven days. There is no cheap pause, only
destroy and recreate. The numbers and their limits are in [cost-estimate.md](cost-estimate.md).

## 14. Troubleshooting

| Symptom                                                                                            | Likely cause                                                                                      | Fix                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SSM parameter /cdk-bootstrap/hnb659fds/version not found. Has the environment been bootstrapped?` | Bootstrap missing in this account or in the region of the workflow                                | Run `cdk bootstrap aws://<ACCOUNT_ID>/<REGION>` with the **same** region as `AWS_REGION`, then re-run                                                                                                                                                                                                                                                                            |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity`                                          | The token's `sub` is not one the role trusts                                                      | Compare: `aws iam get-role --role-name <role> --query Role.AssumeRolePolicyDocument`. Causes: the Environment name differs from `dev`/`stage`/`prod`; the shared stack was synthesised with another `GITHUB_REPOSITORY` (redeploy it with the right one); a preview from a fork; `AWS_DEPLOY_ROLE_ARN` set on the wrong Environment or at repository level                       |
| Deploy job queued forever, or `Environment ... branch not allowed`                                 | Required reviewers waiting, or the workflow was started from a branch other than `main`           | Approve the deployment; start the workflow from `main`                                                                                                                                                                                                                                                                                                                           |
| `Unable to assume role cdk-hnb659fds-...`                                                          | Bootstrapped with another qualifier, or in another region than the deploy                         | Use the default qualifier or change `qualifier` in `lib/constructs/github-deploy-role.ts` and redeploy `nest-next-shared`                                                                                                                                                                                                                                                        |
| Workflow stops with "would replace or delete the database"                                         | The guard saw a database replacement in `cdk diff`                                                | Read the diff. If it is intended and a snapshot exists, re-run with `allow_db_replacement`                                                                                                                                                                                                                                                                                       |
| Migration step fails: `Migration exited with code N. Services were not updated.`                   | The migration itself failed; the services still run the old image                                 | Read the log: `aws logs describe-log-groups --log-group-name-prefix nest-next-dev-Migration`, then `aws logs tail <group> --since 1h`. Fix the cause, run the workflow again                                                                                                                                                                                                     |
| `cdk deploy` fails at the services, or the services flap, then roll back                           | The ECS circuit breaker rolled back: new tasks failed their health check or could not start       | `aws ecs describe-services --cluster nest-next-<env> --services nest-next-<env>-api --query "services[0].events[:10]"`. Look at the service log groups (`nest-next-<env>-ApiLogs...`). A secret the execution role cannot read is a frequent cause. Fix and re-run                                                                                                               |
| Smoke test fails with HTTP 503 or a timeout                                                        | Targets not healthy yet, or the API cannot reach the database or Redis                            | `aws elbv2 describe-target-health --target-group-arn <arn>` and the service logs; the readiness endpoint checks the database and Redis                                                                                                                                                                                                                                           |
| Preview workflow is skipped                                                                        | `AWS_PREVIEW_ROLE_ARN` is unset, or the pull request comes from a fork, or its base is not `main` | Set the variable (step 5.1); open the pull request from a branch of this repository against `main`                                                                                                                                                                                                                                                                               |
| Preview deploy fails with `STARTER_REF must be a full 40-character commit SHA`                     | `STARTER_REF` unset or a branch name                                                              | Set it as in step 8                                                                                                                                                                                                                                                                                                                                                              |
| Preview stack stuck in `DELETE_FAILED`                                                             | A resource refused to delete (often a dependent network interface or security group still in use) | `aws cloudformation describe-stack-events --stack-name nest-next-pr-<n> --query "StackEvents[?ResourceStatus=='DELETE_FAILED'].[LogicalResourceId,ResourceStatusReason]" --output table`. Fix the blocker, then `aws cloudformation delete-stack --stack-name nest-next-pr-<n>`. Last resort: `delete-stack --retain-resources <logical ids>` and delete those resources by hand |
| Orphaned preview stacks keep costing money                                                         | The close workflow failed and the nightly job did not run, or the role was missing                | Step 8: list stacks, dry-run the clean-up, then run it with `dry_run=false`                                                                                                                                                                                                                                                                                                      |
| `AwsSolutions-...` error during `cdk synth`                                                        | cdk-nag found something unacknowledged                                                            | Fix it, or acknowledge it next to the construct with a written reason                                                                                                                                                                                                                                                                                                            |
| ACM certificate stays `PENDING_VALIDATION`                                                         | The hosted zone is not the one that serves the domain's DNS                                       | Check the zone's name servers match the registrar's; the zone must be public and in this account                                                                                                                                                                                                                                                                                 |

## 15. Reference: names the code and workflows use

| What                             | Name                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Stacks                           | `nest-next-shared`, `nest-next-dev`, `nest-next-stage`, `nest-next-prod`, `nest-next-pr-<number>`                                           |
| ECS cluster, services            | `nest-next-<env>`, `nest-next-<env>-api`, `nest-next-<env>-web`                                                                             |
| Migration task definition family | `nest-next-<env>-migrate`                                                                                                                   |
| ECR repositories                 | `nest-next/api`, `nest-next/web`                                                                                                            |
| Stack outputs, env stacks        | `Origin`, `ClusterName`, `MigrationTaskDefinition`, `MigrationSecurityGroup`, `PrivateSubnets`                                              |
| Stack outputs, shared stack      | `DeployRoleArnDev`, `DeployRoleArnStage`, `DeployRoleArnProd`, `PreviewRoleArn`                                                             |
| Workflows                        | `ci` (jobs `check`, `secrets`), `deploy`, `preview`, `preview-cleanup`                                                                      |
| `deploy` inputs                  | `environment` (`dev`, `stage`, `prod`), `starter_ref`, `allow_db_replacement`                                                               |
| `preview-cleanup` input          | `dry_run`                                                                                                                                   |
| Environment variables at synth   | `GITHUB_REPOSITORY`, `GITHUB_OIDC_PROVIDER_ARN`, `DOMAIN_NAME_<ENV>`, `HOSTED_ZONE_ID_<ENV>`, `HOSTED_ZONE_NAME_<ENV>`, `ALARM_EMAIL_<ENV>` |
| CDK context                      | `-c env=<name>`, `-c imageTag=<tag>`, `-c migrateImageTag=<tag>`                                                                            |

## 16. What was verified and what was not

**Verified, without an AWS account (locally, and in CI while Actions minutes were available):**

- `tsc`, eslint, prettier and the jest tests on the synthesised CloudFormation templates, including the test
  that every task's execution role can read every secret the task references.
- `cdk synth` for `dev`, `stage`, `prod`, a `pr-<number>` profile and the HTTPS variant with a domain.
- cdk-nag (AwsSolutions) on every synth: no unacknowledged finding, every acknowledgement carries a reason.
- Unit tests of the helper scripts that hold decisions: the database-replacement guard and the selection of
  orphaned previews.
- The variable, output, stack and workflow names in this guide were checked against the code (`bin/app.ts`,
  `lib/stacks`, `.github/workflows`).

**Not verified, because it needs an account:**

- An actual `cdk bootstrap`, `cdk deploy` or `cdk destroy`, and therefore every "Expected" line above that
  describes AWS or GitHub output.
- That CloudFormation resolves the dynamic references in the `DATABASE_URL` and `REDIS_URL` secrets.
- That the migration task and the services start, and that alarms reach the SNS topic.
- The `deploy`, `preview` and `preview-cleanup` workflows and the scripts they call (`rollout.sh`,
  `run-migration.sh`, `smoke-test.sh`, `current-image-tag.sh`, `preview-comment.sh`, `cleanup-previews.sh`):
  they have never run, and neither shellcheck nor actionlint was used on them.
- The `gh api` calls for Environments and branch protection in step 5 (written from the GitHub documentation).
- Timings, and the cost figures.
- The behaviour of `cdk diff` output that the database guard matches (`replace` or `destroy` on the
  `AWS::RDS::DBInstance` line).
