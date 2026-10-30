import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Ecr } from '../lib/constructs/ecr';

describe('Ecr', () => {
  const stack = new Stack(new App(), 'Test');
  new Ecr(stack, 'Ecr');
  const t = Template.fromStack(stack);

  it('creates api and web repositories', () => {
    t.resourceCountIs('AWS::ECR::Repository', 2);
    t.hasResourceProperties('AWS::ECR::Repository', { RepositoryName: 'nest-next/api' });
    t.hasResourceProperties('AWS::ECR::Repository', { RepositoryName: 'nest-next/web' });
  });

  it('has immutable tags, scan on push and is never deleted with the stack', () => {
    t.allResourcesProperties('AWS::ECR::Repository', {
      ImageTagMutability: 'IMMUTABLE',
      ImageScanningConfiguration: { ScanOnPush: true },
    });
    for (const r of Object.values(t.findResources('AWS::ECR::Repository'))) {
      expect(r.DeletionPolicy).toBe('Retain');
    }
  });
});
