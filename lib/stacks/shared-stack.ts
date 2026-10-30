import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Ecr } from '../constructs/ecr';

/** Resources shared by all environments. The OIDC roles are added with the deploy workflow. */
export class SharedStack extends Stack {
  public readonly ecr: Ecr;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    this.ecr = new Ecr(this, 'Ecr');
  }
}
