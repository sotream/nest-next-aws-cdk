import { App } from 'aws-cdk-lib';
import { enableNag } from '../lib/nag';
import { resolveEnv } from '../lib/config';
import { SharedStack } from '../lib/stacks/shared-stack';
import { EnvStack } from '../lib/stacks/env-stack';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when a domain is set.`);
  return value;
}

const app = new App();
enableNag(app);
new SharedStack(app, 'nest-next-shared', {
  githubRepository: process.env.GITHUB_REPOSITORY ?? 'sotream/nest-next-aws-cdk',
  environments: ['dev', 'stage', 'prod'],
  oidcProviderArn: process.env.GITHUB_OIDC_PROVIDER_ARN || undefined,
});

const names = app.node.tryGetContext('env')
  ? [String(app.node.tryGetContext('env'))]
  : ['dev', 'stage', 'prod'];

for (const name of names) {
  const { config, stackName } = resolveEnv(name);
  const suffix = name.toUpperCase().replace('-', '_');
  const domainName = process.env[`DOMAIN_NAME_${suffix}`];
  const domain = domainName
    ? {
        name: domainName,
        hostedZoneId: requireEnv(`HOSTED_ZONE_ID_${suffix}`),
        hostedZoneName: requireEnv(`HOSTED_ZONE_NAME_${suffix}`),
      }
    : undefined;
  new EnvStack(app, stackName, {
    envName: name,
    config,
    stackName,
    domain,
    alarmEmail: process.env[`ALARM_EMAIL_${suffix}`] || undefined,
    imageTag: app.node.tryGetContext('imageTag') || undefined,
    migrateImageTag: app.node.tryGetContext('migrateImageTag') || undefined,
  });
}
