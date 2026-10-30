import { App } from 'aws-cdk-lib';
import { resolveEnv } from '../lib/config';
import { EnvStack } from '../lib/env-stack';

const app = new App();
const names = app.node.tryGetContext('env')
  ? [String(app.node.tryGetContext('env'))]
  : ['dev', 'stage', 'prod'];

for (const name of names) {
  const { config, stackName } = resolveEnv(name);
  new EnvStack(app, stackName, { envName: name, config, stackName });
}
