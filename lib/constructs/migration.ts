import { RemovalPolicy, aws_ec2 as ec2, aws_ecs as ecs, aws_logs as logs } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { acknowledgeTaskDefinition } from '../nag';

export interface MigrationTaskProps {
  vpc: ec2.IVpc;
  family: string;
  image: ecs.ContainerImage;
  /** Same environment and secrets as the API: the starter validates all of it before any command. */
  environment: Record<string, string>;
  secrets: Record<string, ecs.Secret>;
  logRetentionDays: number;
  destroyOnDelete: boolean;
}

/**
 * A task definition without a service. The deploy workflow runs it once with `ecs run-task`
 * and requires exit code 0 before the services roll to the new image.
 */
export class MigrationTask extends Construct {
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: MigrationTaskProps) {
    super(scope, id);

    this.securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'Migration task',
    });

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'Task', {
      family: props.family,
      cpu: 256,
      memoryLimitMiB: 512,
    });
    this.taskDefinition.addContainer('migrate', {
      image: props.image,
      command: [
        'node',
        'node_modules/typeorm/cli.js',
        'migration:run',
        '-d',
        'dist/infrastructure/database/data-source.js',
      ],
      environment: props.environment,
      secrets: props.secrets,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'migrate',
        logGroup: new logs.LogGroup(this, 'Logs', {
          retention: props.logRetentionDays as logs.RetentionDays,
          removalPolicy: props.destroyOnDelete ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
        }),
      }),
    });
    acknowledgeTaskDefinition(this.taskDefinition);
  }
}
