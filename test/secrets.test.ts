import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Secrets } from '../lib/constructs/secrets';

const synth = (destroyOnDelete: boolean) => {
  const stack = new Stack(new App(), 'Test');
  new Secrets(stack, 'Secrets', { destroyOnDelete });
  return Template.fromStack(stack);
};

describe('Secrets', () => {
  it('generates three secrets and never carries a value', () => {
    const t = synth(false);
    t.resourceCountIs('AWS::SecretsManager::Secret', 3);
    for (const secret of Object.values(t.findResources('AWS::SecretsManager::Secret'))) {
      expect(secret.Properties).toHaveProperty('GenerateSecretString');
      expect(secret.Properties).not.toHaveProperty('SecretString');
    }
  });

  it('puts the database user into the generated JSON', () => {
    synth(false).hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({
        GenerateStringKey: 'password',
        SecretStringTemplate: '{"username":"app"}',
      }),
    });
  });

  it('keeps the Redis token inside the characters Redis allows', () => {
    synth(false).hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({ PasswordLength: 48, ExcludePunctuation: true }),
    });
  });

  it('destroys secrets only when asked to', () => {
    const policies = (t: Template) =>
      Object.values(t.findResources('AWS::SecretsManager::Secret')).map((r) => r.DeletionPolicy);
    expect(policies(synth(true))).toEqual(['Delete', 'Delete', 'Delete']);
    expect(policies(synth(false))).toEqual(['Retain', 'Retain', 'Retain']);
  });
});
