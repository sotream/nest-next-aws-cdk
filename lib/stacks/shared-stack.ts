import { Stack, StackProps, aws_iam as iam } from 'aws-cdk-lib';
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
        repository: props.githubRepository,
        envName,
        repositories: [this.ecr.api, this.ecr.web],
      });
    }
  }
}
