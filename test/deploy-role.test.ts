import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SharedStack } from '../lib/stacks/shared-stack';

const synth = (oidcProviderArn?: string) =>
  Template.fromStack(
    new SharedStack(new App(), 'Shared', {
      githubRepository: 'sotream/nest-next-aws-cdk',
      environments: ['dev', 'prod'],
      oidcProviderArn,
      env: { account: '111111111111', region: 'eu-central-1' },
    }),
  );

describe('GitHub deploy roles', () => {
  const t = synth();

  it('creates one OIDC provider for GitHub', () => {
    t.resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 1);
    t.hasResourceProperties('Custom::AWSCDKOpenIdConnectProvider', {
      Url: 'https://token.actions.githubusercontent.com',
      ClientIDList: ['sts.amazonaws.com'],
    });
  });

  it('reuses an existing provider when its ARN is given', () => {
    synth(
      'arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com',
    ).resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 0);
  });

  it.each(['dev', 'prod'])('trusts only the %s environment of this repository', (env) => {
    const sub = `repo:sotream/nest-next-aws-cdk:environment:${env}`;
    const roles = Object.values(t.findResources('AWS::IAM::Role')).filter((r) =>
      JSON.stringify(r.Properties.AssumeRolePolicyDocument).includes(sub),
    );
    expect(roles).toHaveLength(1);
    const condition = roles[0].Properties.AssumeRolePolicyDocument.Statement[0].Condition;
    expect(condition.StringEquals['token.actions.githubusercontent.com:sub']).toEqual([sub]);
    expect(condition.StringEquals['token.actions.githubusercontent.com:aud']).toBe(
      'sts.amazonaws.com',
    );
    expect(JSON.stringify(condition)).not.toContain('StringLike');
  });

  it('scopes the migration task to the cluster of its own environment', () => {
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ecs:RunTask',
            Condition: { ArnLike: { 'ecs:cluster': Match.anyValue() } },
          }),
        ]),
      },
    });
  });

  it('uses a wildcard resource only for the ECR token and read-only Describe and List calls', () => {
    const wildcard = Object.values(t.findResources('AWS::IAM::Policy'))
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((s: { Resource: unknown }) => [s.Resource].flat().includes('*'))
      .flatMap((s: { Action: string | string[] }) => [s.Action].flat())
      .sort();
    expect(new Set(wildcard)).toEqual(
      new Set([
        'ecr:GetAuthorizationToken',
        'ecs:DescribeTaskDefinition',
        'cloudformation:ListStacks',
      ]),
    );
  });

  it('has no action wildcards', () => {
    const actions =
      JSON.stringify(t.toJSON().Resources).match(/"Action":(\[[^\]]*\]|"[^"]*")/g) ?? [];
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) expect(a).not.toMatch(/"(\*|[a-z0-9]+:\*)"/);
  });
});

describe('preview role', () => {
  const t = synth();
  const preview = Object.values(t.findResources('AWS::IAM::Role')).find(
    (r) => r.Properties.Description === 'GitHub Actions deploy role for previews',
  );
  const policyOf = (role: string) =>
    JSON.stringify(
      Object.values(t.findResources('AWS::IAM::Policy')).find((p) =>
        JSON.stringify(p.Properties.Roles).includes(role),
      ),
    );

  it('trusts pull request workflows and the nightly job on main of this repository only', () => {
    const condition = preview?.Properties.AssumeRolePolicyDocument.Statement[0].Condition;
    expect(condition.StringEquals['token.actions.githubusercontent.com:sub']).toEqual([
      'repo:sotream/nest-next-aws-cdk:pull_request',
      'repo:sotream/nest-next-aws-cdk:ref:refs/heads/main',
    ]);
    expect(JSON.stringify(condition)).not.toContain('StringLike');
  });

  it('acts only on preview stacks, clusters and roles', () => {
    const policy = policyOf('Deploypreviews');
    for (const resource of [
      'stack/nest-next-pr-*/*',
      'service/nest-next-pr-*/*',
      'task-definition/nest-next-pr-*-migrate:*',
      'cluster/nest-next-pr-*',
      'role/nest-next-pr-*',
    ]) {
      expect(policy).toContain(resource);
    }
    expect(policy).not.toContain('nest-next-dev');
    expect(policy).not.toContain('nest-next-prod');
  });

  it('is the only role that may list stacks, and the environment roles cannot touch previews', () => {
    expect(policyOf('Deploypreviews')).toContain('cloudformation:ListStacks');
    expect(policyOf('Deploydev')).not.toContain('ListStacks');
    expect(policyOf('Deploydev')).not.toContain('nest-next-pr-');
  });
});
