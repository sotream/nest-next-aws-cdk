import { ArnFormat, Stack, aws_ecr as ecr, aws_iam as iam } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface GitHubDeployRoleProps {
  provider: iam.IOpenIdConnectProvider;
  /** `owner/name` of the repository whose workflow may assume the role. */
  repository: string;
  /** Environment name; matches the GitHub Environment and the `nest-next-<env>` stack and cluster. */
  envName: string;
  repositories: ecr.IRepository[];
  /** CDK bootstrap qualifier. */
  qualifier?: string;
}

/**
 * Role for the deploy workflow of one long-lived environment. The trust policy names the repository and the
 * GitHub Environment, so only a job running in that Environment can assume it. The role does not deploy
 * resources itself: it assumes the CDK bootstrap roles, pushes images and runs the migration task.
 */
export class GitHubDeployRole extends Construct {
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GitHubDeployRoleProps) {
    super(scope, id);
    const stack = Stack.of(this);
    const qualifier = props.qualifier ?? 'hnb659fds';
    const prefix = `nest-next-${props.envName}`;
    const arn = (service: string, resource: string, name: string, region?: string) =>
      stack.formatArn({
        service,
        resource,
        resourceName: name,
        region,
        arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      });

    this.role = new iam.Role(this, 'Role', {
      description: `GitHub Actions deploy role for ${props.envName}`,
      assumedBy: new iam.WebIdentityPrincipal(props.provider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${props.repository}:environment:${props.envName}`,
        },
      }),
    });

    for (const repository of props.repositories) repository.grantPullPush(this.role);

    // CDK deploys through its bootstrap roles (deploy, file and image publishing, lookup). Their names differ
    // only in the middle part, so the pattern is the narrowest possible name for all of them.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          arn('iam', 'role', `cdk-${qualifier}-*-role-${stack.account}-${stack.region}`, ''),
        ],
      }),
    );

    // Read the stack outputs and ask ECS what runs now. Neither API supports resource-level permissions for
    // the Describe* calls below, hence "*" (read-only).
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [arn('cloudformation', 'stack', `${prefix}/*`)],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:DescribeTaskDefinition'],
        resources: ['*'],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:DescribeServices'],
        resources: [arn('ecs', 'service', `${prefix}/*`)],
      }),
    );

    // Run the migration task of this environment only, on its own cluster.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:RunTask'],
        resources: [arn('ecs', 'task-definition', `${prefix}-migrate:*`)],
        conditions: { ArnEquals: { 'ecs:cluster': arn('ecs', 'cluster', prefix) } },
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:DescribeTasks'],
        resources: [arn('ecs', 'task', `${prefix}/*`)],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [arn('iam', 'role', `${prefix}-*`, '')],
        conditions: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
      }),
    );
  }
}
