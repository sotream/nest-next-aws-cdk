import {
  Duration,
  Fn,
  RemovalPolicy,
  SecretValue,
  Validations,
  aws_ec2 as ec2,
  aws_rds as rds,
  aws_secretsmanager as sm,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface DatabaseProps {
  vpc: ec2.IVpc;
  /** Generated `{ username, password }` secret. */
  credentials: sm.ISecret;
  /** RDS instance class, e.g. `db.t4g.micro`. */
  instanceClass: string;
  /** Multi-AZ standby. */
  highAvailability: boolean;
  /** Backups and deletion protection. Off for previews, which are destroyed with their stack. */
  backups: boolean;
  destroyOnDelete: boolean;
}

const DATABASE_NAME = 'app';

export const SECRET_ROTATION_REASON =
  'Derived from another secret by a dynamic reference; rotating it means rotating the credentials it is built from, which is manual for now (see the runbook).';

/** Private, encrypted PostgreSQL. Connections must use TLS (`rds.force_ssl`). */
export class Database extends Construct {
  public readonly instance: rds.DatabaseInstance;
  /** Secret holding the `DATABASE_URL` the starter expects. */
  public readonly url: sm.Secret;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);

    this.instance = new rds.DatabaseInstance(this, 'Instance', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: new ec2.InstanceType(props.instanceClass.replace(/^db\./, '')),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      publiclyAccessible: false,
      credentials: rds.Credentials.fromSecret(props.credentials),
      databaseName: DATABASE_NAME,
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: props.highAvailability,
      parameters: { 'rds.force_ssl': '1' },
      backupRetention: props.backups ? Duration.days(7) : Duration.days(0),
      deletionProtection: props.backups,
      removalPolicy: props.destroyOnDelete ? RemovalPolicy.DESTROY : RemovalPolicy.SNAPSHOT,
    });

    Validations.of(this.instance).acknowledge({
      id: 'AwsSolutions-RDS11',
      reason:
        'The default port is kept: only the API and migration security groups can reach the database, so a custom port adds little.',
    });
    if (!props.highAvailability) {
      Validations.of(this.instance).acknowledge({
        id: 'AwsSolutions-RDS3',
        reason: 'Single-AZ in dev and previews to keep them cheap; stage and prod are multi-AZ.',
      });
    }
    if (!props.backups) {
      Validations.of(this.instance).acknowledge({
        id: 'AwsSolutions-RDS10',
        reason: 'Previews are disposable and are destroyed with their pull request.',
      });
      Validations.of(this.instance).acknowledge({
        id: 'AwsSolutions-RDS13',
        reason: 'Previews hold no data worth restoring; they get no seeded data and no backups.',
      });
    }

    // The password is a CloudFormation dynamic reference resolved at deploy time, so the template
    // holds the reference and never the value. sslmode=no-verify encrypts without checking the RDS
    // certificate, which Node does not trust by default (same trade-off as nest-next-aws-terraform ADR 0008).
    const password = props.credentials.secretValueFromJson('password').unsafeUnwrap();
    const username = props.credentials.secretValueFromJson('username').unsafeUnwrap();
    this.url = new sm.Secret(this, 'Url', {
      description: 'DATABASE_URL',
      removalPolicy: props.destroyOnDelete ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      secretStringValue: SecretValue.unsafePlainText(
        Fn.join('', [
          'postgres://',
          username,
          ':',
          password,
          '@',
          this.instance.dbInstanceEndpointAddress,
          ':',
          this.instance.dbInstanceEndpointPort,
          `/${DATABASE_NAME}?sslmode=no-verify`,
        ]),
      ),
    });
    Validations.of(this.url).acknowledge({
      id: 'AwsSolutions-SMG4',
      reason: SECRET_ROTATION_REASON,
    });
  }

  get connections(): ec2.Connections {
    return this.instance.connections;
  }
}
