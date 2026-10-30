import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { resolveEnv } from '../lib/config';
import { EnvStack } from '../lib/stacks/env-stack';

const domain = { name: 'app.example.com', hostedZoneId: 'Z123', hostedZoneName: 'example.com' };

const synth = (env: string, withDomain = false) => {
  const { config, stackName } = resolveEnv(env);
  const stack = new EnvStack(new App(), stackName, {
    envName: env,
    config,
    stackName,
    domain: withDomain ? domain : undefined,
    imageTag: 'abc123',
  });
  return { stack, template: Template.fromStack(stack) };
};

describe('services', () => {
  const { template: t } = synth('prod');

  it('runs api and web as separate Fargate services with the profile task count', () => {
    t.resourceCountIs('AWS::ECS::Service', 2);
    t.allResourcesProperties('AWS::ECS::Service', { LaunchType: 'FARGATE', DesiredCount: 2 });
  });

  it('keeps one task per service in previews', () => {
    synth('pr-9').template.allResourcesProperties('AWS::ECS::Service', { DesiredCount: 1 });
  });

  it('rolls back failed deployments', () => {
    t.allResourcesProperties('AWS::ECS::Service', {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it('gives every container a health check and logs with the profile retention', () => {
    t.allResourcesProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: [
        Match.objectLike({
          HealthCheck: Match.objectLike({ Command: Match.arrayWith(['CMD', 'node', '-e']) }),
          LogConfiguration: Match.objectLike({ LogDriver: 'awslogs' }),
        }),
      ],
    });
    t.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 30 });
    synth('pr-9').template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 3 });
  });

  it('routes /api/* to the API and everything else to web', () => {
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Priority: 10,
      Conditions: [Match.objectLike({ PathPatternConfig: { Values: ['/api/*'] } })],
    });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Priority: 100,
      Conditions: [Match.objectLike({ PathPatternConfig: { Values: ['/*'] } })],
    });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/api/health/live',
      Port: 4000,
    });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/sign-in',
      Port: 3000,
    });
  });

  it('passes the starter its environment and secrets', () => {
    const api = Object.values(t.findResources('AWS::ECS::TaskDefinition'))
      .map((r) => r.Properties.ContainerDefinitions[0])
      .find((c) => c.PortMappings[0].ContainerPort === 4000);
    const env = Object.fromEntries(
      api.Environment.map((e: { Name: string; Value: unknown }) => [e.Name, e.Value]),
    );
    expect(env).toMatchObject({
      APP_ENV: 'dev',
      PORT: '4000',
      KAFKA_ENABLED: 'false',
      LOG_LEVEL: 'info',
    });
    expect(api.Secrets.map((s: { Name: string }) => s.Name).sort()).toEqual([
      'DATABASE_URL',
      'JWT_ACCESS_SECRET',
      'REDIS_URL',
    ]);
  });

  it('lets only the API reach the database and cache', () => {
    const ingress = Object.values(t.findResources('AWS::EC2::SecurityGroupIngress')).map(
      (r) => r.Properties,
    );
    const sourcesInto = (group: string) =>
      ingress
        .filter((i) => JSON.stringify(i.GroupId).includes(group))
        .map((i) => JSON.stringify(i.SourceSecurityGroupId));
    for (const group of ['DatabaseInstanceSecurityGroup', 'CacheSecurityGroup']) {
      const sources = sourcesInto(group);
      expect(sources).toHaveLength(1);
      expect(sources[0]).toContain('ApiServiceSecurityGroup');
    }
  });
});

describe('with a domain', () => {
  const { template: t } = synth('prod', true);

  it('serves HTTPS, redirects HTTP and aliases the name', () => {
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
    });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      DefaultActions: [Match.objectLike({ Type: 'redirect' })],
    });
    t.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    t.hasResourceProperties('AWS::Route53::RecordSet', { Name: 'app.example.com.', Type: 'A' });
  });

  it('runs the API as prod with an https origin', () => {
    const containers = Object.values(t.findResources('AWS::ECS::TaskDefinition')).map(
      (r) => r.Properties.ContainerDefinitions[0],
    );
    const api = containers.find((c) => c.PortMappings[0].ContainerPort === 4000);
    expect(api.Environment).toEqual(
      expect.arrayContaining([
        { Name: 'APP_ENV', Value: 'prod' },
        { Name: 'WEB_ORIGIN', Value: 'https://app.example.com' },
      ]),
    );
  });
});

/**
 * Regression test for a real incident: a task role could not read a newly added secret. Every
 * secret a task definition references must be readable by that task definition's execution role.
 */
interface IamPolicyProps {
  Roles: unknown[];
  PolicyDocument: { Statement: { Action: string | string[]; Resource: unknown }[] };
}

describe('execution role secret access', () => {
  const { template } = synth('dev');
  const json = template.toJSON();

  const refOf = (value: unknown): string | undefined => {
    const v = value as { Ref?: string };
    return v?.Ref;
  };

  it.each(Object.entries(template.findResources('AWS::ECS::TaskDefinition')))(
    '%s can read every secret it references',
    (_id, taskDef) => {
      const referenced = (
        taskDef.Properties.ContainerDefinitions as { Secrets?: { ValueFrom: unknown }[] }[]
      )
        .flatMap((c) => c.Secrets ?? [])
        .map((s) => refOf(s.ValueFrom));

      const roleId =
        refOf(taskDef.Properties.ExecutionRoleArn) ??
        taskDef.Properties.ExecutionRoleArn['Fn::GetAtt'][0];
      const readable = Object.values(
        json.Resources as Record<string, { Type: string; Properties: IamPolicyProps }>,
      )
        .filter(
          (r) =>
            r.Type === 'AWS::IAM::Policy' &&
            r.Properties.Roles.some((x: unknown) => refOf(x) === roleId),
        )
        .flatMap((r) => r.Properties.PolicyDocument.Statement)
        .filter((s: { Action: string | string[] }) =>
          [s.Action].flat().includes('secretsmanager:GetSecretValue'),
        )
        .flatMap((s: { Resource: unknown }) => [s.Resource].flat())
        .map((r) => refOf(r));

      for (const secret of referenced) {
        expect(secret).toBeDefined();
        expect(readable).toContain(secret);
      }
    },
  );

  it('has no wildcard secret access', () => {
    expect(JSON.stringify(json)).not.toMatch(
      /"Resource":"\*".{0,80}secretsmanager|secretsmanager:\*/,
    );
  });
});
