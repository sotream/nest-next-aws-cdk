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
    expect(condition.StringEquals['token.actions.githubusercontent.com:sub']).toBe(sub);
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
            Condition: { ArnEquals: { 'ecs:cluster': Match.anyValue() } },
          }),
        ]),
      },
    });
  });

  it('uses a wildcard resource only for read-only ecs:DescribeTaskDefinition and the ECR token', () => {
    const wildcard = Object.values(t.findResources('AWS::IAM::Policy'))
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((s: { Resource: unknown }) => [s.Resource].flat().includes('*'))
      .flatMap((s: { Action: string | string[] }) => [s.Action].flat())
      .sort();
    expect(new Set(wildcard)).toEqual(
      new Set(['ecr:GetAuthorizationToken', 'ecs:DescribeTaskDefinition']),
    );
  });

  it('has no action wildcards', () => {
    const actions =
      JSON.stringify(t.toJSON().Resources).match(/"Action":(\[[^\]]*\]|"[^"]*")/g) ?? [];
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) expect(a).not.toMatch(/"(\*|[a-z0-9]+:\*)"/);
  });
});
