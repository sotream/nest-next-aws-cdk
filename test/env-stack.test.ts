import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { resolveEnv } from '../lib/config';
import { EnvStack } from '../lib/stacks/env-stack';

describe('EnvStack', () => {
  it.each(['dev', 'stage', 'prod', 'pr-7'])('synthesises %s', (name) => {
    const { config, stackName } = resolveEnv(name);
    const stack = new EnvStack(new App(), stackName, { envName: name, config, stackName });
    expect(stack.stackName).toBe(stackName);
    expect(Template.fromStack(stack).toJSON()).toBeDefined();
  });
});
