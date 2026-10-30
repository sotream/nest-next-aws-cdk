import { Stack, StackProps, Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from '../config';
import { Cache } from '../constructs/cache';
import { Database } from '../constructs/database';
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
  public readonly database: Database;
  public readonly cache: Cache;

  constructor(scope: Construct, id: string, props: EnvStackProps) {
    super(scope, id, props);
    Tags.of(this).add('env', props.envName);
    this.network = new Network(this, 'Network', { natGateways: props.config.natGateways });
    this.secrets = new Secrets(this, 'Secrets', { destroyOnDelete: props.config.destroyOnDelete });
    const { config } = props;
    this.database = new Database(this, 'Database', {
      vpc: this.network.vpc,
      credentials: this.secrets.database,
      instanceClass: config.dbInstanceClass,
      backups: config.backups,
      destroyOnDelete: config.destroyOnDelete,
    });
    this.cache = new Cache(this, 'Cache', {
      vpc: this.network.vpc,
      authToken: this.secrets.redisAuthToken,
      nodeType: config.cacheNodeType,
      highAvailability: config.backups,
      destroyOnDelete: config.destroyOnDelete,
    });
  }
}
