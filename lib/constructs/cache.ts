import {
  Fn,
  RemovalPolicy,
  SecretValue,
  aws_ec2 as ec2,
  aws_elasticache as elasticache,
  aws_secretsmanager as sm,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface CacheProps {
  vpc: ec2.IVpc;
  /** Generated plain AUTH token. */
  authToken: sm.ISecret;
  /** Node type, e.g. `cache.t4g.micro`. */
  nodeType: string;
  /** One node per environment; a replica with automatic failover where backups are on. */
  highAvailability: boolean;
  destroyOnDelete: boolean;
}

const PORT = 6379;

/** Redis with TLS in transit, encryption at rest and AUTH. Private subnets only. */
export class Cache extends Construct {
  public readonly connections: ec2.Connections;
  /** Secret holding the `REDIS_URL` the starter expects. */
  public readonly url: sm.Secret;

  constructor(scope: Construct, id: string, props: CacheProps) {
    super(scope, id);

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Redis',
      allowAllOutbound: false,
    });
    this.connections = new ec2.Connections({
      securityGroups: [securityGroup],
      defaultPort: ec2.Port.tcp(PORT),
    });

    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'SubnetGroup', {
      description: 'Redis private subnets',
      subnetIds: props.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS })
        .subnetIds,
    });

    const nodes = props.highAvailability ? 2 : 1;
    const redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: 'Redis',
      engine: 'redis',
      cacheNodeType: props.nodeType,
      port: PORT,
      numCacheClusters: nodes,
      automaticFailoverEnabled: nodes > 1,
      multiAzEnabled: nodes > 1,
      cacheSubnetGroupName: subnetGroup.ref,
      securityGroupIds: [securityGroup.securityGroupId],
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      authToken: props.authToken.secretValue.unsafeUnwrap(),
    });
    redis.applyRemovalPolicy(props.destroyOnDelete ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN);

    this.url = new sm.Secret(this, 'Url', {
      description: 'REDIS_URL',
      removalPolicy: props.destroyOnDelete ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      secretStringValue: SecretValue.unsafePlainText(
        Fn.join('', [
          'rediss://:',
          props.authToken.secretValue.unsafeUnwrap(),
          '@',
          redis.attrPrimaryEndPointAddress,
          `:${PORT}`,
        ]),
      ),
    });
  }
}
