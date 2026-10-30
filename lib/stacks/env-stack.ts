import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from '../config';
import { Network } from '../constructs/network';
import { Secrets } from '../constructs/secrets';

export interface EnvStackProps extends StackProps {
  envName: string;
  config: EnvConfig;
}

/** One environment: composes the constructs. */
export class EnvStack extends Stack {
  public readonly network: Network;
  public readonly secrets: Secrets;

  constructor(scope: Construct, id: string, props: EnvStackProps) {
    super(scope, id, props);
    Tags.of(this).add('env', props.envName);
    this.network = new Network(this, 'Network', { natGateways: props.config.natGateways });
    this.secrets = new Secrets(this, 'Secrets', { destroyOnDelete: props.config.destroyOnDelete });
  }
}
