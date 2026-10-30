import { CfnOutput, Stack, StackProps, aws_iam as iam } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Ecr } from '../constructs/ecr';
import { GitHubDeployRole } from '../constructs/github-deploy-role';

export interface SharedStackProps extends StackProps {
  /** `owner/name` of this repository; the deploy roles trust only its workflows. */
  githubRepository: string;
  /** Long-lived environments that get a deploy role. */
  environments: string[];
  /** An account has one GitHub OIDC provider. Pass its ARN to reuse it instead of creating one. */
  oidcProviderArn?: string;
}

/** Resources shared by all environments: image repositories and the GitHub OIDC trust. */
export class SharedStack extends Stack {
  public readonly ecr: Ecr;
  public readonly deployRoles: Record<string, GitHubDeployRole> = {};
  public readonly previewRole: GitHubDeployRole;

  constructor(scope: Construct, id: string, props: SharedStackProps) {
    super(scope, id, props);
    this.ecr = new Ecr(this, 'Ecr');

    const provider = props.oidcProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          'GitHub',
          props.oidcProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, 'GitHub', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        });

    for (const envName of props.environments) {
      this.deployRoles[envName] = new GitHubDeployRole(this, `Deploy-${envName}`, {
        provider,
        name: envName,
        // Only a job running in this GitHub Environment can assume the role.
        subjects: [`repo:${props.githubRepository}:environment:${envName}`],
        stackPrefix: `nest-next-${envName}`,
        repositories: [this.ecr.api, this.ecr.web],
      });
    }

    // Previews: pull request workflows deploy and destroy, the nightly job on main cleans up orphans.
    this.previewRole = new GitHubDeployRole(this, 'Deploy-previews', {
      provider,
      name: 'previews',
      subjects: [
        `repo:${props.githubRepository}:pull_request`,
        `repo:${props.githubRepository}:ref:refs/heads/main`,
      ],
      stackPrefix: 'nest-next-pr-*',
      repositories: [this.ecr.api, this.ecr.web],
      listStacks: true,
    });

    // Values for the GitHub variables and Environments (see docs/runbook.md).
    for (const [envName, deployRole] of Object.entries(this.deployRoles)) {
      new CfnOutput(this, `DeployRoleArn${envName[0].toUpperCase()}${envName.slice(1)}`, {
        value: deployRole.role.roleArn,
      });
    }
    new CfnOutput(this, 'PreviewRoleArn', { value: this.previewRole.role.roleArn });
  }
}
