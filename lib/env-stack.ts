import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from './config';

export interface EnvStackProps extends StackProps {
  envName: string;
  config: EnvConfig;
}

/** One environment. Constructs are added by later features. */
export class EnvStack extends Stack {
  constructor(scope: Construct, id: string, props: EnvStackProps) {
    super(scope, id, props);
    Tags.of(this).add('env', props.envName);
  }
}
