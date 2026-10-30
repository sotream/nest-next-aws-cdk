import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { resolveEnv } from '../lib/config';
import { EnvStack } from '../lib/stacks/env-stack';

const synth = (env: string, tags: { imageTag?: string; migrateImageTag?: string } = {}) => {
  const { config, stackName } = resolveEnv(env);
  return Template.fromStack(
    new EnvStack(new App(), stackName, { envName: env, config, stackName, ...tags }),
  );
};

describe('migration task', () => {
  const t = synth('dev', { imageTag: 'current', migrateImageTag: 'next' });
  const migrate = () =>
    Object.values(t.findResources('AWS::ECS::TaskDefinition')).find(
      (r) => r.Properties.Family === 'nest-next-dev-migrate',
    );

  it('is a task definition without a service, so it only runs when the workflow starts it', () => {
    t.resourceCountIs('AWS::ECS::Service', 2);
    expect(migrate()).toBeDefined();
  });

  it('runs the TypeORM migrations with the API environment and secrets', () => {
    const c = migrate()?.Properties.ContainerDefinitions[0];
    expect(c.Command).toEqual([
      'node',
      'node_modules/typeorm/cli.js',
      'migration:run',
      '-d',
      'dist/infrastructure/database/data-source.js',
    ]);
    expect(c.Environment).toEqual(expect.arrayContaining([{ Name: 'APP_ENV', Value: 'dev' }]));
    expect(c.Secrets.map((s: { Name: string }) => s.Name).sort()).toEqual([
      'DATABASE_URL',
      'JWT_ACCESS_SECRET',
      'REDIS_URL',
    ]);
  });

  it('can use a different image tag than the services', () => {
    const image = (task: Record<string, unknown>) =>
      JSON.stringify(
        (task.Properties as { ContainerDefinitions: { Image: unknown }[] }).ContainerDefinitions[0]
          .Image,
      );
    const tasks = Object.values(t.findResources('AWS::ECS::TaskDefinition'));
    const migrateTask = migrate();
    if (!migrateTask) throw new Error('no migration task');
    expect(image(migrateTask)).toContain('next');
    expect(tasks.filter((x) => image(x).includes('current'))).toHaveLength(2);
  });

  it('exposes what the deploy workflow needs', () => {
    for (const name of [
      'Origin',
      'ClusterName',
      'MigrationTaskDefinition',
      'MigrationSecurityGroup',
      'PrivateSubnets',
    ]) {
      expect(t.findOutputs(name)).not.toEqual({});
    }
    t.hasOutput('ClusterName', { Value: Match.anyValue() });
  });
});

describe('first deployment', () => {
  it('creates the services without tasks until an image exists', () => {
    synth('dev').allResourcesProperties('AWS::ECS::Service', { DesiredCount: 0 });
  });

  it('names the cluster and services so the workflow can find them', () => {
    const t = synth('dev');
    t.hasResourceProperties('AWS::ECS::Cluster', { ClusterName: 'nest-next-dev' });
    t.hasResourceProperties('AWS::ECS::Service', { ServiceName: 'nest-next-dev-api' });
    t.hasResourceProperties('AWS::ECS::Service', { ServiceName: 'nest-next-dev-web' });
  });
});
