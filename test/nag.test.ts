import { App } from 'aws-cdk-lib';
import { resolveEnv } from '../lib/config';
import { enableNag } from '../lib/nag';
import { EnvStack } from '../lib/stacks/env-stack';
import { SharedStack } from '../lib/stacks/shared-stack';

type Build = (app: App) => void;

const domain = { name: 'app.example.com', hostedZoneId: 'Z123', hostedZoneName: 'example.com' };

const env =
  (name: string, imageTag?: string, withDomain = false): Build =>
  (app) => {
    const { config, stackName } = resolveEnv(name);
    new EnvStack(app, stackName, {
      envName: name,
      config,
      stackName,
      imageTag,
      domain: withDomain ? domain : undefined,
    });
  };

const shared: Build = (app) => {
  new SharedStack(app, 'Shared', { githubRepository: 'o/r', environments: ['dev', 'prod'] });
};

const cases: [string, Build][] = [
  ['shared stack', shared],
  ['dev without an image', env('dev')],
  ['dev', env('dev', 'abc')],
  ['stage', env('stage', 'abc')],
  ['prod', env('prod', 'abc')],
  ['prod with a domain', env('prod', 'abc', true)],
  ['preview', env('pr-1', 'abc')],
];

describe('cdk-nag AwsSolutions', () => {
  it.each(cases)('%s has no unacknowledged findings', (_name, build) => {
    const app = new App();
    enableNag(app);
    build(app);
    let message = '';
    try {
      app.synth();
    } catch (e) {
      message = String(e instanceof Error ? e.message : e);
    }
    expect(message).toBe('');
  });
});
