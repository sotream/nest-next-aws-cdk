# nest-next-aws-cdk

AWS CDK (TypeScript) deployment of nest-next-starter with per-PR preview environments. The source of truth is `docs/spec.md`. If code and spec disagree, the code is wrong; if the spec is ambiguous or impossible, say so in the pull request instead of guessing.

## Flow

- Work feature by feature in the order of spec section 9. One GitHub issue, one branch, one small pull request per feature, tests in the same pull request.
- Open the pull request and wait for CI. Do not merge your own pull request; the owner reviews and squash-merges.
- Never push to `main` after the initial commit.

## Rules

- Node 24, pnpm, TypeScript strict.
- Never run `cdk deploy` or any command that changes an AWS account. `cdk synth` and tests only.
- No secrets, keys or account ids in the repository. Use placeholders and repository variables.
- IAM policies come from `grant*` methods, not hand-written wildcards.
- Commit with the identity already configured in the repository. No Co-Authored-By trailer, no "Generated with" line, in commits or pull request descriptions.
- Few commits, grouped by task; no chains of tiny commits.
- Keep code small and readable. Do not add abstractions the spec does not ask for.
